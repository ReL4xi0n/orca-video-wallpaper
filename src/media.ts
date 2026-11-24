// Finding and running ffmpeg / ffprobe / yt-dlp, downloading and converting videos
// to the limits Orca's theme background accepts (H.264, no audio, <=60 s, <=8 MB,
// <=2,304,000 pixels, >=640x360).
import { spawn } from 'node:child_process'
import { createWriteStream, existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

export type Tool = 'ffmpeg' | 'ffprobe' | 'yt-dlp' | 'node'

const cache = new Map<Tool, string | null>()

/** Finds a tool on PATH, in WinGet's Links folder, or inside WinGet's package folders. */
export function findTool(name: Tool, fresh = false): string | null {
  if (!fresh && cache.has(name)) return cache.get(name) ?? null
  const exe = `${name}.exe`
  const dirs = (process.env.PATH ?? '').split(';').filter(Boolean)
  const local = process.env.LOCALAPPDATA ?? ''
  dirs.push(join(local, 'Microsoft', 'WinGet', 'Links'))
  // Node.js installers put it here without always updating this process's PATH.
  if (name === 'node') dirs.push(join(process.env.ProgramFiles ?? 'C:\\Program Files', 'nodejs'), join(local, 'Programs', 'nodejs'))
  let found: string | null = null
  for (const d of dirs) {
    const p = join(d, exe)
    if (existsSync(p)) { found = p; break }
  }
  if (!found) {
    // WinGet portable packages: Packages\<id>\<version folder>\bin\<tool>.exe or Packages\<id>\<tool>.exe
    const pkgs = join(local, 'Microsoft', 'WinGet', 'Packages')
    try {
      for (const pkg of readdirSync(pkgs)) {
        const base = join(pkgs, pkg)
        const direct = join(base, exe)
        if (existsSync(direct)) { found = direct; break }
        for (const sub of safeList(base)) {
          const p = join(base, sub, 'bin', exe)
          if (existsSync(p)) { found = p; break }
        }
        if (found) break
      }
    } catch {}
  }
  cache.set(name, found)
  return found
}

function safeList(dir: string): string[] {
  try { return readdirSync(dir).filter((n) => statSync(join(dir, n)).isDirectory()) } catch { return [] }
}

export interface RunResult { code: number; stdout: string; stderr: string }

/** Runs a program without a shell (arguments are never parsed by cmd.exe). */
export function run(
  program: string,
  args: string[],
  opts: { onLine?: (line: string) => void; signal?: AbortSignal } = {}
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { windowsHide: true, signal: opts.signal })
    let stdout = ''
    let stderr = ''
    let pending = ''
    const feed = (chunk: Buffer, sink: 'out' | 'err') => {
      const text = chunk.toString('utf8')
      if (sink === 'out') stdout += text
      else stderr += text
      if (!opts.onLine) return
      pending += text
      const lines = pending.split(/\r\n|\r|\n/)
      pending = lines.pop() ?? ''
      for (const l of lines) if (l.trim()) opts.onLine(l)
    }
    child.stdout.on('data', (c) => feed(c, 'out'))
    child.stderr.on('data', (c) => feed(c, 'err'))
    child.on('error', reject)
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr: stderr.slice(-4000) }))
  })
}

export async function probeDuration(file: string): Promise<number> {
  const ffprobe = findTool('ffprobe')
  if (!ffprobe) throw new Error('ffprobe bulunamadı')
  const r = await run(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file])
  const d = Number.parseFloat(r.stdout.trim())
  if (!Number.isFinite(d) || d <= 0) throw new Error('Video süresi okunamadı (geçerli bir video mu?)')
  return d
}

export type Downloader = 'yt-dlp' | 'direct'

/**
 * Decides how a URL is fetched: yt-dlp understands pages (YouTube, Vimeo, ...),
 * a plain fetch is enough for a direct link to a media file.
 */
export function chooseDownloader(url: URL, ytdlpAvailable: boolean): Downloader {
  // A link that ends in a media file is fetched directly: faster and needs no extra program.
  if (/\.(mp4|m4v|webm|mov|mkv|avi|gif)$/i.test(url.pathname)) return 'direct'
  // Anything else is most likely a page (YouTube, Vimeo, ...); only yt-dlp can read those.
  return ytdlpAvailable ? 'yt-dlp' : 'direct'
}

/** Downloads `url` into `dir`; returns the file path and a title guess. */
export async function download(
  url: URL,
  dir: string,
  onProgress: (percent: number | null) => void,
  signal?: AbortSignal
): Promise<{ file: string; title: string }> {
  const ytdlp = findTool('yt-dlp')
  const how = chooseDownloader(url, ytdlp !== null)
  if (how === 'yt-dlp') {
    if (!ytdlp) throw new Error('yt-dlp kurulu değil')
    let title = ''
    let file = ''
    const r = await run(
      ytdlp,
      [
        '--no-playlist', '--newline', '--progress',
        '-f', 'bv*[height<=1080][ext=mp4]/bv*[height<=1080]/b[height<=1080]/b',
        '-o', join(dir, 'source.%(ext)s'),
        '--print', 'before_dl:TITLE:%(title)s',
        '--print', 'after_move:FILE:%(filepath)s',
        url.href
      ],
      {
        signal,
        onLine: (line) => {
          const m = line.match(/\[download\]\s+([\d.]+)%/)
          if (m) onProgress(Number(m[1]))
          else if (line.startsWith('TITLE:')) title = line.slice(6).trim()
          else if (line.startsWith('FILE:')) file = line.slice(5).trim()
        }
      }
    )
    if (r.code !== 0 || !file || !existsSync(file)) {
      throw new Error(`İndirme başarısız: ${lastLine(r.stderr) || 'yt-dlp hata verdi'}`)
    }
    return { file, title: title || url.hostname }
  }

  const res = await fetch(url, { signal, redirect: 'follow' })
  if (!res.ok || !res.body) throw new Error(`İndirme başarısız: HTTP ${res.status}`)
  const total = Number(res.headers.get('content-length')) || 0
  const maxBytes = 1024 * 1024 * 1024 // refuse more than 1 GB
  if (total > maxBytes) throw new Error('Dosya çok büyük (1 GB üstü)')
  const file = join(dir, 'source.bin')
  let got = 0
  const body = Readable.fromWeb(res.body as never)
  body.on('data', (c: Buffer) => {
    got += c.length
    if (got > maxBytes) body.destroy(new Error('Dosya çok büyük (1 GB üstü)'))
    onProgress(total ? (got / total) * 100 : null)
  })
  await pipeline(body, createWriteStream(file))
  const name = decodeURIComponent(url.pathname.split('/').pop() || url.hostname).replace(/\.[^.]+$/, '')
  return { file, title: name || url.hostname }
}

const VF =
  "scale='min(1920,iw)':'min(1080,ih)':force_original_aspect_ratio=decrease," +
  "scale='max(640,iw)':'max(360,ih)':force_original_aspect_ratio=increase," +
  'scale=trunc(iw/2)*2:trunc(ih/2)*2,fps=30,format=yuv420p'

/** Converts `input` into `outVideo` + `outPoster` within Orca's limits; returns the loop length. */
export async function convert(
  input: string,
  start: number,
  outVideo: string,
  outPoster: string,
  onProgress: (percent: number) => void,
  signal?: AbortSignal
): Promise<number> {
  const ffmpeg = findTool('ffmpeg')
  if (!ffmpeg) throw new Error('ffmpeg kurulu değil')
  const full = await probeDuration(input)
  const from = Math.max(0, Math.min(start, Math.max(0, full - 1)))
  const len = Math.min(58, Math.max(1, full - from))
  // Stay under 8 MB: ~7.2 MB budget spread over the clip, capped at 6 Mbit/s.
  const kbps = Math.min(6000, Math.floor((7.2 * 8 * 1024) / len))

  const r = await run(
    ffmpeg,
    [
      '-y', '-v', 'error', '-progress', 'pipe:1', '-nostats',
      '-ss', String(from), '-t', String(len), '-i', input,
      '-an', '-vf', VF, '-c:v', 'libx264', '-preset', 'medium', '-profile:v', 'high',
      '-b:v', `${kbps}k`, '-maxrate', `${kbps}k`, '-bufsize', `${kbps * 2}k`,
      '-movflags', '+faststart', outVideo
    ],
    {
      signal,
      onLine: (line) => {
        const m = line.match(/^out_time_(?:us|ms)=(\d+)/)
        if (m) onProgress(Math.min(100, (Number(m[1]) / 1e6 / len) * 100))
      }
    }
  )
  if (r.code !== 0) throw new Error(`Dönüştürme başarısız: ${lastLine(r.stderr)}`)
  const size = statSync(outVideo).size
  if (size > 8 * 1024 * 1024) throw new Error('Dönüştürülen video 8 MB üstünde kaldı; daha kısa bir başlangıç deneyin')

  const p = await run(ffmpeg, ['-y', '-v', 'error', '-ss', String(from), '-i', input, '-frames:v', '1', '-vf', VF, '-q:v', '3', outPoster], { signal })
  if (p.code !== 0) throw new Error(`Kapak resmi oluşturulamadı: ${lastLine(p.stderr)}`)
  return Math.round(len * 10) / 10
}

function lastLine(text: string): string {
  return text.trim().split(/\r?\n/).pop()?.slice(0, 300) ?? ''
}
