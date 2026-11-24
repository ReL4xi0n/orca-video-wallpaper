// Video Wallpaper panel (HTML frame). Talks to src/worker.ts through window.orca.plugin;
// src/protocol.ts types both sides. Video titles come from files and websites, so they are
// only ever set with textContent, never parsed as HTML.
import type { JobState, VideoItem, WallpaperState } from 'orca'

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T

const plugin = orca.plugin
let state: WallpaperState | null = null
let busyId: string | null = null
const thumbs = new Map<string, string | null>()

// ---------- helpers ----------

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

let errorTimer: ReturnType<typeof setTimeout> | undefined
function showError(e: unknown): void {
  const box = $('notices')
  box.querySelector('.notice.error')?.remove()
  const n = notice('Hata', errorText(e), true)
  box.prepend(n)
  clearTimeout(errorTimer)
  errorTimer = setTimeout(() => n.remove(), 8000)
}

function notice(title: string, text: string, isError = false, action?: { label: string; run: () => void; disabled?: boolean }): HTMLElement {
  const el = document.createElement('div')
  el.className = isError ? 'notice error' : 'notice'
  el.setAttribute('role', isError ? 'alert' : 'status')
  const strong = document.createElement('strong')
  strong.textContent = title
  const p = document.createElement('p')
  p.textContent = text
  el.append(strong, p)
  if (action) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'btn primary'
    b.textContent = action.label
    b.disabled = !!action.disabled
    b.addEventListener('click', action.run)
    el.append(b)
  }
  return el
}

const formatDuration = (s: number) => (s >= 60 ? `${Math.floor(s / 60)} dk ${Math.round(s % 60)} sn` : `${Math.round(s)} sn`)
const isRunning = (j: JobState | null) => j !== null && j.stage !== 'done' && j.stage !== 'error'

// ---------- sliders ----------

function syncSlider(input: HTMLInputElement): void {
  input.style.setProperty('--value', input.value)
  input.style.setProperty('--min', input.min || '0')
  input.style.setProperty('--max', input.max || '100')
  const out = $(`o-${input.id.slice(2)}`)
  out.textContent = `%${input.value}`
  input.setAttribute('aria-valuetext', `yüzde ${input.value}`)
}

function bindSlider(id: string, send: (v: number) => Promise<unknown>): void {
  const input = $<HTMLInputElement>(id)
  input.addEventListener('input', () => {
    syncSlider(input)
    void send(Number(input.value)).catch(showError)
  })
}

bindSlider('s-panels', (v) => plugin.request('opacity.set', { panels: v }))
bindSlider('s-center', (v) => plugin.request('opacity.set', { center: v }))

function setSlider(id: string, value: number): void {
  const input = $<HTMLInputElement>(id)
  if (document.activeElement === input) return // do not fight the person dragging it
  input.value = String(value)
  syncSlider(input)
}

// ---------- notices (shortcuts, tools) ----------

function renderNotices(s: WallpaperState): void {
  const box = $('notices')
  const err = box.querySelector('.notice.error')
  box.replaceChildren()
  if (err) box.append(err)

  const { found, redirected } = s.shortcuts
  if (found === 0) {
    box.append(notice('Orca kısayolu bulunamadı',
      "Panel saydamlığı Orca'yı açan kısayol üzerinden çalışır. Masaüstünde, Başlat menüsünde veya görev çubuğunda bir Orca kısayolu olsun, sonra bu paneli yeniden aç."))
  } else if (redirected < found) {
    box.append(notice('Kısayollar ayarlı değil',
      `Orca kısayollarından ${found - redirected} tanesi saydamlık başlatıcısını kullanmıyor (Orca güncellemesi sıfırlamış olabilir).`,
      false, { label: busyId === 'shortcuts' ? 'Ayarlanıyor…' : 'Kısayolları ayarla', run: () => changeShortcuts('repair'), disabled: busyId === 'shortcuts' || !s.tools.node }))
  } else if (!s.launcherActive) {
    box.append(notice('Panel saydamlığı kapalı',
      "Kenar panel ve orta alan saydamlığı için Orca'yı kapatıp masaüstü, Başlat menüsü veya görev çubuğundaki Orca kısayolundan yeniden aç."))
  }

  const missing = [
    !s.tools.ffmpeg && 'ffmpeg (video dönüştürme için gerekli)',
    !s.tools.ytdlp && 'yt-dlp (YouTube gibi sitelerden indirmek için)',
    !s.tools.node && 'Node.js (panel saydamlığı başlatıcısı için)'
  ].filter(Boolean)
  if (missing.length) {
    box.append(notice('Eksik araç', `${missing.join(', ')}.`, false,
      { label: busyId === 'tools' ? 'Kuruluyor…' : 'Kur (winget)', run: installTools, disabled: busyId === 'tools' }))
  }
}

async function changeShortcuts(mode: 'repair' | 'restore'): Promise<void> {
  busyId = 'shortcuts'
  if (state) render(state)
  try { adopt(await plugin.request(mode === 'repair' ? 'shortcuts.repair' : 'shortcuts.restore', undefined, { timeoutMs: 60000 })) }
  catch (e) { showError(e) }
  finally { busyId = null; if (state) render(state) }
}

async function installTools(): Promise<void> {
  busyId = 'tools'
  if (state) render(state)
  try { await plugin.request('tools.install', undefined, { timeoutMs: 600000 }) }
  catch (e) { showError(e) }
  finally { busyId = null; if (state) render(state) }
}

// ---------- library ----------

const cardTpl = $<HTMLTemplateElement>('card-tpl')

function renderGrid(s: WallpaperState): void {
  const grid = $('grid')
  const cards = s.library.map((v) => makeCard(v, v.id === s.activeId))
  grid.replaceChildren(makeNoneCard(s.activeId === null), ...cards)
  $('empty').hidden = s.library.length > 0
}

function makeCard(v: VideoItem, active: boolean): HTMLElement {
  const li = cardTpl.content.firstElementChild!.cloneNode(true) as HTMLElement
  const card = li.querySelector<HTMLElement>('.card')!
  const img = card.querySelector('img')!
  const link = card.querySelector<HTMLButtonElement>('.card-link')!
  const meta = card.querySelector('.meta')!
  const del = card.querySelector<HTMLButtonElement>('.delete')!

  link.textContent = v.title
  link.title = v.title
  meta.textContent = `${formatDuration(v.duration)}${busyId === v.id ? ' · uygulanıyor…' : ''}`
  if (active) {
    card.dataset.active = ''
    link.setAttribute('aria-current', 'true')
    const badge = document.createElement('span')
    badge.className = 'badge'
    badge.textContent = 'Kullanımda'
    card.append(badge)
  }
  if (busyId === v.id) card.setAttribute('aria-busy', 'true')
  link.disabled = busyId !== null && busyId !== 'shortcuts' && busyId !== 'tools'
  link.addEventListener('click', () => { if (!active) void applyVideo(v.id) })

  del.setAttribute('aria-label', `${v.title} videosunu sil`)
  del.title = active ? 'Kullanımdaki video silinemez' : 'Sil'
  del.disabled = active
  del.addEventListener('click', () => askDelete(v))

  setThumb(card, img, v.id)
  return li
}

function setThumb(card: HTMLElement, img: HTMLImageElement, id: string): void {
  const known = thumbs.get(id)
  if (known) { img.src = known; return }
  card.dataset.thumb = 'none'
  if (known === null) return
  void plugin.request('video.thumb', { id }, { timeoutMs: 30000 }).then(({ src }) => {
    thumbs.set(id, src)
    if (src) { img.src = src; delete card.dataset.thumb }
  }).catch(() => thumbs.set(id, null))
}

/** "Boş": turns the video off. Same card shape, an icon instead of a cover, nothing to delete. */
function makeNoneCard(active: boolean): HTMLElement {
  const li = cardTpl.content.firstElementChild!.cloneNode(true) as HTMLElement
  const card = li.querySelector<HTMLElement>('.card')!
  const link = card.querySelector<HTMLButtonElement>('.card-link')!
  card.dataset.thumb = 'none'
  card.classList.add('none')
  card.querySelector('img')!.remove()
  card.querySelector('footer')!.remove()
  card.querySelector('.no-thumb use')!.setAttribute('href', '#i-off')
  link.textContent = 'Boş'
  link.title = 'Video yok, Orca normal görünür'
  card.querySelector('.meta')!.textContent = busyId === 'none' ? 'Uygulanıyor…' : 'Video yok'
  if (active) {
    card.dataset.active = ''
    link.setAttribute('aria-current', 'true')
    const badge = document.createElement('span')
    badge.className = 'badge'
    badge.textContent = 'Kullanımda'
    card.append(badge)
  }
  if (busyId === 'none') card.setAttribute('aria-busy', 'true')
  link.disabled = busyId !== null && busyId !== 'shortcuts' && busyId !== 'tools'
  link.addEventListener('click', () => { if (!active) void clearVideo() })
  return li
}

async function applyVideo(id: string): Promise<void> {
  busyId = id
  if (state) render(state)
  try { adopt(await plugin.request('video.apply', { id }, { timeoutMs: 60000 })) }
  catch (e) { showError(e) }
  finally { busyId = null; if (state) render(state) }
}

async function clearVideo(): Promise<void> {
  busyId = 'none'
  if (state) render(state)
  try { adopt(await plugin.request('video.clear', undefined, { timeoutMs: 60000 })) }
  catch (e) { showError(e) }
  finally { busyId = null; if (state) render(state) }
}

// ---------- delete confirmation ----------

const confirmDialog = $<HTMLDialogElement>('confirm')
let pendingDelete: VideoItem | null = null

function askDelete(v: VideoItem): void {
  pendingDelete = v
  $('confirm-text').textContent = `“${v.title}” kütüphaneden kalıcı olarak silinecek.`
  confirmDialog.returnValue = ''
  confirmDialog.showModal()
}

confirmDialog.addEventListener('close', () => {
  const v = pendingDelete
  const choice = confirmDialog.returnValue
  confirmDialog.returnValue = ''
  pendingDelete = null
  if (!v || choice !== 'delete') return
  thumbs.delete(v.id)
  void plugin.request('video.remove', { id: v.id }).then(adopt).catch(showError)
})

// ---------- add dialog ----------

const addDialog = $<HTMLDialogElement>('add')
const urlInput = $<HTMLInputElement>('url')

$('open-add').addEventListener('click', () => {
  urlInput.value = ''
  addDialog.showModal()
})

async function addVideo(source: string): Promise<void> {
  try {
    await plugin.request('video.add', { source })
    addDialog.close()
  } catch (e) { showError(e) }
}

$('pick').addEventListener('click', async () => {
  const pick = $<HTMLButtonElement>('pick')
  pick.disabled = true
  try {
    const r = await plugin.request('file.pick', undefined, { timeoutMs: 300000 })
    if (r.path) await addVideo(r.path)
  } catch (e) { showError(e) } finally { pick.disabled = false }
})

$<HTMLFormElement>('url-form').addEventListener('submit', (e) => {
  e.preventDefault()
  const value = urlInput.value.trim()
  if (value) void addVideo(value)
})

// Light dismiss where <dialog closedby> is missing (press and release both outside the box).
if (!('closedBy' in HTMLDialogElement.prototype)) {
  const outside = (e: PointerEvent, d: HTMLDialogElement) => {
    const r = d.getBoundingClientRect()
    return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom
  }
  let pressedOutside = false
  addDialog.addEventListener('pointerdown', (e) => { pressedOutside = outside(e, addDialog) })
  addDialog.addEventListener('pointerup', (e) => { if (pressedOutside && outside(e, addDialog)) addDialog.close() })
}

// ---------- job progress ----------

let jobHideTimer: ReturnType<typeof setTimeout> | undefined
function renderJob(j: JobState | null): void {
  const box = $('job')
  clearTimeout(jobHideTimer)
  if (!j) { box.hidden = true; return }
  box.hidden = false
  box.className = `job${j.stage === 'error' ? ' error' : j.stage === 'done' ? ' done' : ''}`
  $('job-text').textContent = j.message
  $('job-pct').textContent = isRunning(j) && j.percent !== null ? `%${j.percent}` : ''
  const bar = $<HTMLProgressElement>('job-bar')
  bar.hidden = !isRunning(j)
  if (j.percent === null) bar.removeAttribute('value')
  else bar.value = j.percent
  $<HTMLButtonElement>('open-add').disabled = isRunning(j)
  if (j.stage === 'done') jobHideTimer = setTimeout(() => { box.hidden = true }, 6000)
}

// ---------- state ----------

function render(s: WallpaperState): void {
  renderNotices(s)
  renderGrid(s)
  $('restore').hidden = s.shortcuts.redirected === 0
}

function adopt(s: WallpaperState): void {
  state = s
  setSlider('s-panels', s.panels)
  setSlider('s-center', s.center)
  render(s)
  // A finished job stays in the worker's state; only a running one is worth showing again.
  if (isRunning(s.job)) renderJob(s.job)
}

$('restore').addEventListener('click', () => changeShortcuts('restore'))
plugin.on('state.changed', adopt)
plugin.on('job.progress', renderJob)
void plugin.request('state.get').then(adopt).catch(showError)
