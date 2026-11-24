// Video Wallpaper worker: sets up ~/orca-video-theme on first run (src/setup.ts), keeps a
// video library, converts new videos, writes the
// generated theme plugin (~/orca-video-theme/theme) and reinstalls it so Orca shows the
// chosen video, and writes ~/orca-video-theme/config.json, which the transparency
// launcher (~/orca-video-theme/tools/launcher.mjs) applies to the side panels live.
import type { OrcaWorkerApi } from 'orca/worker'
import type { JobState, VideoItem, WallpaperState } from 'orca'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { convert, download, findTool, makeThumb, run } from './media'
import { ORCA_DIR } from './paths'
import { ensureSetup, shortcuts, type ShortcutStatus } from './setup'

const HOME = join(homedir(), 'orca-video-theme')
const LIBRARY = join(HOME, 'library')
const THEME = join(HOME, 'theme')
const CONFIG = join(HOME, 'config.json')
const STATE = join(HOME, 'state.json')
const LAUNCHER_VBS = join(HOME, 'tools', 'launch-orca.vbs')
const ORCA_CLI = join(ORCA_DIR, 'resources', 'bin', 'orca.exe')

const clamp = (v: unknown, lo: number, hi: number, dflt: number) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : dflt
}

function readJson<T>(file: string, fallback: T): T {
  try { return { ...fallback, ...JSON.parse(readFileSync(file, 'utf8')) } } catch { return fallback }
}
function writeJson(file: string, value: unknown): void {
  writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf8')
}

function listLibrary(): VideoItem[] {
  const items: VideoItem[] = []
  for (const id of safeReaddir(LIBRARY)) {
    if (id.startsWith('.')) continue
    const dir = join(LIBRARY, id)
    if (!existsSync(join(dir, 'video.mp4'))) continue
    const meta = readJson<Partial<VideoItem>>(join(dir, 'meta.json'), {})
    items.push({
      id,
      title: String(meta.title ?? id),
      source: String(meta.source ?? ''),
      duration: Number(meta.duration ?? 0),
      createdAt: Number(meta.createdAt ?? 0)
    })
  }
  return items.sort((a, b) => b.createdAt - a.createdAt)
}

function safeReaddir(dir: string): string[] {
  try { return readdirSync(dir) } catch { return [] }
}

let shortcutCache: { at: number; value: ShortcutStatus } | null = null
async function shortcutStatus(): Promise<ShortcutStatus> {
  if (shortcutCache && Date.now() - shortcutCache.at < 30_000) return shortcutCache.value
  const value = await shortcuts('status', LAUNCHER_VBS).catch(() => ({ found: 0, redirected: 0, launcherActive: false }))
  shortcutCache = { at: Date.now(), value }
  return value
}

let job: JobState | null = null

async function currentState(): Promise<WallpaperState> {
  const st = readJson(STATE, { activeId: null as string | null, videoStrength: 90 })
  const cfg = readJson(CONFIG, { panels: 85, center: 65 })
  const sc = await shortcutStatus()
  return {
    library: listLibrary(),
    activeId: st.activeId,
    panels: clamp(cfg.panels, 0, 100, 85),
    center: clamp(cfg.center, 0, 100, 65),
    tools: { ffmpeg: findTool('ffmpeg') !== null, ytdlp: findTool('yt-dlp') !== null, node: findTool('node') !== null },
    launcherActive: sc.launcherActive,
    shortcuts: { found: sc.found, redirected: sc.redirected },
    job
  }
}

/**
 * Edits the generated theme and reinstalls it (Orca applies it live). `change` returns false when
 * there is nothing to change, which skips the reinstall. Installs run one at a time.
 */
let installChain: Promise<unknown> = Promise.resolve()
function updateTheme(change: (theme: Record<string, unknown>) => boolean): Promise<void> {
  const next = installChain.then(async () => {
    const themeFile = join(THEME, 'themes', 'dark.json')
    const theme = JSON.parse(readFileSync(themeFile, 'utf8'))
    if (!change(theme)) return
    writeJson(themeFile, theme)

    // A new version tells Orca the files changed.
    const manifestFile = join(THEME, 'orca-plugin.json')
    const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'))
    const parts = String(manifest.version ?? '0.1.0').split('.').map((n: string) => Number.parseInt(n, 10) || 0)
    parts[2] = (parts[2] ?? 0) + 1
    manifest.version = parts.slice(0, 3).join('.')
    writeJson(manifestFile, manifest)

    const r = await run(ORCA_CLI, ['plugin', 'install', THEME, '--json'])
    if (r.code !== 0) {
      let msg = r.stderr || r.stdout
      try { msg = JSON.parse(r.stdout).error?.message ?? msg } catch {}
      throw new Error(`Tema kurulamadı: ${String(msg).split('\n')[0]}`)
    }
  })
  installChain = next.catch(() => undefined)
  return next
}

/** Shows library video `id` behind Orca. `strength` is its opacity over the theme colour (there
 *  is no control for it any more; the saved value, default 90, is kept). */
function applyTheme(id: string, strength: number): Promise<void> {
  return updateTheme((theme) => {
    const src = join(LIBRARY, id)
    if (!existsSync(join(src, 'video.mp4'))) throw new Error('Video kütüphanede bulunamadı')
    mkdirSync(join(THEME, 'media'), { recursive: true })
    copyFileSync(join(src, 'video.mp4'), join(THEME, 'media', 'bg.mp4'))
    copyFileSync(join(src, 'poster.jpg'), join(THEME, 'media', 'bg.jpg'))
    theme.background = { path: 'media/bg.jpg', videoPath: 'media/bg.mp4', opacity: strength / 100, size: 'cover', position: 'center' }
    return true
  })
}

/** "Boş": the theme without a background, so Orca shows its plain colours. */
function clearTheme(): Promise<void> {
  return updateTheme((theme) => {
    if (!('background' in theme)) return false
    delete theme.background
    return true
  })
}

function makeId(title: string): string {
  const slug = title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
  return `${slug || 'video'}-${Date.now().toString(36)}`
}

export default function activate(orca: OrcaWorkerApi): void {
  const publishState = async () => orca.panels.post('state.changed', await currentState())
  const progress = (next: JobState) => { job = next; orca.panels.post('job.progress', next) }

  try { ensureSetup(HOME) } catch (e) { orca.log(`setup failed: ${e instanceof Error ? e.stack : e}`) }

  const changeShortcuts = async (mode: 'repair' | 'restore') => {
    shortcutCache = { at: Date.now(), value: await shortcuts(mode, LAUNCHER_VBS) }
    const state = await currentState()
    orca.panels.post('state.changed', state)
    return state
  }
  orca.panels.handle('shortcuts.repair', () => changeShortcuts('repair'))
  orca.panels.handle('shortcuts.restore', () => changeShortcuts('restore'))

  orca.panels.handle('state.get', () => currentState())

  orca.panels.handle('file.pick', async () => {
    const script =
      "[Console]::OutputEncoding=[Text.Encoding]::UTF8;" +
      'Add-Type -AssemblyName System.Windows.Forms;' +
      '$o=New-Object System.Windows.Forms.Form -Property @{TopMost=$true;ShowInTaskbar=$false};' +
      '$d=New-Object System.Windows.Forms.OpenFileDialog;' +
      "$d.Title='Arka plan videosu seç';" +
      "$d.Filter='Videolar|*.mp4;*.mkv;*.webm;*.mov;*.avi;*.m4v;*.gif|Tüm dosyalar|*.*';" +
      "if($d.ShowDialog($o) -eq 'OK'){[Console]::Out.Write($d.FileName)}"
    const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-Command', script])
    const path = r.stdout.trim()
    return { path: path || null }
  })

  orca.panels.handle('video.add', async ({ source, start }) => {
    if (job && job.stage !== 'done' && job.stage !== 'error') {
      throw Object.assign(new Error('Zaten bir video işleniyor, bitmesini bekleyin'), { code: 'conflict' })
    }
    const text = String(source ?? '').trim().replace(/^"(.*)"$/, '$1')
    if (!text) throw Object.assign(new Error('Dosya yolu veya URL girin'), { code: 'invalid_params' })
    const jobId = Date.now().toString(36)
    const startAt = clamp(start ?? 0, 0, 24 * 3600, 0)

    void (async () => {
      const tmp = join(LIBRARY, `.tmp-${jobId}`)
      try {
        mkdirSync(tmp, { recursive: true })
        let input = text
        let title = text.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '') || 'Video'
        if (/^https?:\/\//i.test(text)) {
          progress({ id: jobId, stage: 'download', percent: 0, message: 'İndiriliyor…' })
          const got = await download(new URL(text), tmp, (p) =>
            progress({ id: jobId, stage: 'download', percent: p === null ? null : Math.round(p), message: 'İndiriliyor…' })
          )
          input = got.file
          title = got.title
        } else if (!existsSync(input)) {
          throw new Error('Dosya bulunamadı')
        }

        const id = makeId(title)
        const dir = join(LIBRARY, id)
        mkdirSync(dir, { recursive: true })
        progress({ id: jobId, stage: 'convert', percent: 0, message: 'Dönüştürülüyor…' })
        const duration = await convert(input, startAt, join(dir, 'video.mp4'), join(dir, 'poster.jpg'), (p) =>
          progress({ id: jobId, stage: 'convert', percent: Math.round(p), message: 'Dönüştürülüyor…' })
        ).catch((e) => { rmSync(dir, { recursive: true, force: true }); throw e })
        writeJson(join(dir, 'meta.json'), { id, title, source: text, duration, createdAt: Date.now() })
        await makeThumb(join(dir, 'poster.jpg'), join(dir, 'thumb.jpg')).catch((e) => orca.log(`thumb failed: ${e}`))

        progress({ id: jobId, stage: 'install', percent: null, message: 'Arka plana uygulanıyor…' })
        const st = readJson(STATE, { activeId: null as string | null, videoStrength: 90 })
        await applyTheme(id, clamp(st.videoStrength, 10, 100, 90))
        writeJson(STATE, { ...st, activeId: id })
        progress({ id: jobId, stage: 'done', percent: 100, message: `"${title}" eklendi ve uygulandı` })
      } catch (e) {
        progress({ id: jobId, stage: 'error', percent: null, message: e instanceof Error ? e.message : String(e) })
        orca.log(`video.add failed: ${e instanceof Error ? e.stack : e}`)
      } finally {
        rmSync(tmp, { recursive: true, force: true })
        await publishState()
      }
    })()

    return { jobId }
  })

  orca.panels.handle('video.apply', async ({ id }) => {
    const st = readJson(STATE, { activeId: null as string | null, videoStrength: 90 })
    await applyTheme(id, clamp(st.videoStrength, 10, 100, 90))
    writeJson(STATE, { ...st, activeId: id })
    const state = await currentState()
    orca.panels.post('state.changed', state)
    return state
  })

  orca.panels.handle('video.clear', async () => {
    await clearTheme()
    const st = readJson(STATE, { activeId: null as string | null, videoStrength: 90 })
    writeJson(STATE, { ...st, activeId: null })
    const state = await currentState()
    orca.panels.post('state.changed', state)
    return state
  })

  // Panels cannot load files outside the plugin, so the card image travels as a data URL.
  // Answers are capped at 1 MiB; a 480 px JPEG is a few dozen KB.
  orca.panels.handle('video.thumb', async ({ id }) => {
    if (!/^[a-z0-9-]+$/.test(id)) throw Object.assign(new Error('Geçersiz video'), { code: 'invalid_params' })
    const dir = join(LIBRARY, id)
    const thumb = join(dir, 'thumb.jpg')
    if (!existsSync(thumb) && existsSync(join(dir, 'poster.jpg'))) {
      await makeThumb(join(dir, 'poster.jpg'), thumb).catch((e) => orca.log(`thumb failed: ${e}`))
    }
    if (!existsSync(thumb)) return { src: null }
    const data = readFileSync(thumb)
    if (data.length > 700 * 1024) return { src: null }
    return { src: `data:image/jpeg;base64,${data.toString('base64')}` }
  })

  orca.panels.handle('video.remove', async ({ id }) => {
    const st = readJson(STATE, { activeId: null as string | null, videoStrength: 90 })
    if (st.activeId === id) throw Object.assign(new Error('Kullanımdaki video silinemez; önce başka bir video seçin'), { code: 'conflict' })
    if (!/^[a-z0-9-]+$/.test(id)) throw Object.assign(new Error('Geçersiz video'), { code: 'invalid_params' })
    rmSync(join(LIBRARY, id), { recursive: true, force: true })
    const state = await currentState()
    orca.panels.post('state.changed', state)
    return state
  })

  orca.panels.handle('opacity.set', ({ panels, center }) => {
    const cfg = readJson(CONFIG, { panels: 85, center: 65 })
    writeJson(CONFIG, {
      panels: panels === undefined ? cfg.panels : clamp(panels, 0, 100, 85),
      center: center === undefined ? cfg.center : clamp(center, 0, 100, 65)
    })
    return { ok: true as const }
  })


  orca.panels.handle('tools.install', async () => {
    const winget = 'winget.exe'
    const common = ['--exact', '--silent', '--accept-source-agreements', '--accept-package-agreements', '--disable-interactivity']
    if (!findTool('ffmpeg', true)) await run(winget, ['install', '--id', 'Gyan.FFmpeg.Essentials', ...common]).catch(() => null)
    if (!findTool('yt-dlp', true)) await run(winget, ['install', '--id', 'yt-dlp.yt-dlp', ...common]).catch(() => null)
    if (!findTool('node', true)) await run(winget, ['install', '--id', 'OpenJS.NodeJS.LTS', ...common]).catch(() => null)
    const result = { ffmpeg: findTool('ffmpeg', true) !== null, ytdlp: findTool('yt-dlp', true) !== null, node: findTool('node', true) !== null }
    findTool('ffprobe', true)
    await publishState()
    return result
  })
}
