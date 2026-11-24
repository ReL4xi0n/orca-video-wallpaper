// Video Wallpaper panel. No build step: Orca strips the types and compiles the JSX on load.
import {
  atom,
  Button,
  Callout,
  Card,
  Heading,
  Input,
  List,
  ListItem,
  plugin,
  Progress,
  read,
  Row,
  set,
  Slider,
  Spinner,
  Stack,
  Switch,
  Text,
  type JobState,
  type PanelContext,
  type WallpaperState
} from 'orca'

const state = atom<WallpaperState | null>(null)
const job = atom<JobState | null>(null)
const source = atom('source', '', { persist: 'memory' })
const start = atom('start', '0', { persist: 'memory' })
const panels = atom<number>(85)
const center = atom<number>(65)
const strength = atom<number>(90)
const busy = atom<string | null>(null) // id of the video being applied, or 'pick' / 'tools'
const error = atom<string | null>(null)
const deleteMode = atom<boolean>(false)

function adopt(s: WallpaperState): void {
  set(state, s)
  set(panels, s.panels)
  set(center, s.center)
  set(strength, s.videoStrength)
  if (s.job) set(job, s.job)
}

function fail(e: unknown): void {
  set(error, e instanceof Error ? e.message : String(e))
}

async function pickFile(): Promise<void> {
  set(busy, 'pick')
  set(error, null)
  try {
    const r = await plugin.request('file.pick', undefined, { timeoutMs: 120000 })
    if (r.path) set(source, r.path)
  } catch (e) { fail(e) } finally { set(busy, null) }
}

async function addVideo(): Promise<void> {
  set(error, null)
  try {
    await plugin.request('video.add', { source: read(source), start: Number(read(start)) || 0 })
    set(source, '')
    set(start, '0')
  } catch (e) { fail(e) }
}

async function applyVideo(id: string): Promise<void> {
  set(busy, id)
  set(error, null)
  try { adopt(await plugin.request('video.apply', { id })) } catch (e) { fail(e) } finally { set(busy, null) }
}

async function removeVideo(id: string): Promise<void> {
  set(error, null)
  try {
    adopt(await plugin.request('video.remove', { id }))
    if ((read(state)?.library.length ?? 0) <= 1) set(deleteMode, false)
  } catch (e) { fail(e) }
}

async function installTools(): Promise<void> {
  set(busy, 'tools')
  set(error, null)
  try { await plugin.request('tools.install', undefined, { timeoutMs: 120000 }) } catch (e) { fail(e) } finally { set(busy, null) }
}

async function changeShortcuts(mode: 'repair' | 'restore'): Promise<void> {
  set(busy, 'shortcuts')
  set(error, null)
  try { adopt(await plugin.request(mode === 'repair' ? 'shortcuts.repair' : 'shortcuts.restore', undefined, { timeoutMs: 60000 })) }
  catch (e) { fail(e) } finally { set(busy, null) }
}

function onPanels(v: number): void { set(panels, v); void plugin.request('opacity.set', { panels: v }).catch(fail) }
function onCenter(v: number): void { set(center, v); void plugin.request('opacity.set', { center: v }).catch(fail) }
function onStrength(v: number): void { set(strength, v); void plugin.request('strength.set', { value: v }).catch(fail) }

export function setup(ctx: PanelContext): void {
  ctx.subscriptions.push(plugin.on('state.changed', adopt))
  ctx.subscriptions.push(plugin.on('job.progress', (j) => set(job, j)))
  void plugin.request('state.get').then(adopt).catch(fail)
}

const formatDuration = (s: number) => (s >= 60 ? `${Math.floor(s / 60)} dk ${Math.round(s % 60)} sn` : `${Math.round(s)} sn`)
const isRunning = (j: JobState | null) => j !== null && j.stage !== 'done' && j.stage !== 'error'

export default function Panel() {
  const s = read(state)
  const j = read(job)
  const working = isRunning(j)
  const b = read(busy)
  const err = read(error)
  const del = read(deleteMode)

  if (!s) return <Spinner label="Yükleniyor" />
  const needsRepair = s.shortcuts.redirected < s.shortcuts.found

  return (
    <Stack gap="md">
      <Heading>Video Arka Plan</Heading>

      {s.shortcuts.found === 0 && (
        <Callout tone="warning" title="Orca kısayolu bulunamadı">
          <Text size="xs">
            Panel saydamlığı, Orca'yı açan kısayol üzerinden çalışır. Masaüstünde, Başlat menüsünde veya görev çubuğunda bir Orca kısayolu olsun, sonra bu paneli yeniden aç.
          </Text>
        </Callout>
      )}

      {needsRepair && (
        <Callout tone="warning" title="Kısayollar ayarlı değil">
          <Stack gap="xs">
            <Text size="xs">
              {`Orca kısayollarından ${s.shortcuts.found - s.shortcuts.redirected} tanesi saydamlık başlatıcısını kullanmıyor (Orca güncellemesi sıfırlamış olabilir).`}
            </Text>
            <Button size="sm" icon="wrench" disabled={b === 'shortcuts' || !s.tools.node} onPress={() => changeShortcuts('repair')}>
              {b === 'shortcuts' ? 'Ayarlanıyor…' : 'Kısayolları ayarla'}
            </Button>
          </Stack>
        </Callout>
      )}

      {!needsRepair && s.shortcuts.found > 0 && !s.launcherActive && (
        <Callout tone="warning" title="Panel saydamlığı kapalı">
          <Text size="xs">
            Kenar panel ve orta alan saydamlığı için Orca'yı kapatıp masaüstü, Başlat menüsü veya görev çubuğundaki Orca kısayolundan yeniden aç.
          </Text>
        </Callout>
      )}

      {(!s.tools.ffmpeg || !s.tools.ytdlp || !s.tools.node) && (
        <Callout tone="warning" title="Eksik araç">
          <Stack gap="xs">
            <Text size="xs">
              {!s.tools.ffmpeg ? 'ffmpeg (video dönüştürme için gerekli). ' : ''}
              {!s.tools.ytdlp ? 'yt-dlp (YouTube gibi sitelerden indirmek için). ' : ''}
              {!s.tools.node ? 'Node.js (panel saydamlığı başlatıcısı için).' : ''}
            </Text>
            <Button size="sm" icon="download" disabled={b === 'tools'} onPress={installTools}>
              {b === 'tools' ? 'Kuruluyor…' : 'Kur (winget)'}
            </Button>
          </Stack>
        </Callout>
      )}

      <Card title="Saydamlık">
        <Stack gap="sm">
          <Slider label="Kenar paneller (yüksek = koyu)" min={0} max={100} step={1} showValue value={read(panels)} onChange={onPanels} />
          <Slider label="Orta alan (düşük = daha çok video)" min={0} max={100} step={1} showValue value={read(center)} onChange={onCenter} />
          <Slider label="Video gücü" min={10} max={100} step={1} showValue value={read(strength)} onChange={onStrength} />
        </Stack>
      </Card>

      <Card title="Video ekle" description="Bilgisayardan bir dosya ya da URL (YouTube veya doğrudan video linki). En fazla 58 saniye alınır.">
        <Stack gap="sm">
          <Input
            label="Dosya yolu veya URL"
            placeholder="C:\…\video.mp4 veya https://…"
            value={read(source)}
            disabled={working}
            onChange={(v) => set(source, v)}
            onSubmit={addVideo}
          />
          <Row gap="xs">
            <Button variant="outline" icon="folder" disabled={working || b === 'pick'} onPress={pickFile}>
              Dosya seç…
            </Button>
            <Input label="Başlangıç (sn)" value={read(start)} disabled={working} onChange={(v) => set(start, v.replace(/[^\d.]/g, ''))} />
          </Row>
          <Button icon="add" disabled={working || read(source).trim() === ''} onPress={addVideo}>
            Ekle ve uygula
          </Button>
          {j && (
            <Stack gap="xs">
              {working && (j.percent === null ? <Spinner label={j.message} /> : <Progress label={j.message} value={j.percent} />)}
              {!working && <Text size="xs" tone={j.stage === 'error' ? 'danger' : 'success'}>{j.message}</Text>}
            </Stack>
          )}
        </Stack>
      </Card>

      {err && <Callout tone="danger" title="Hata"><Text size="xs">{err}</Text></Callout>}

      <Row justify="between">
        <Heading level={3}>Videolarım</Heading>
        <Switch label="Silme modu" checked={del} onChange={(v) => set(deleteMode, v)} />
      </Row>
      <List label="Videolarım">
        {s.library.map((v) => {
          const active = v.id === s.activeId
          return (
            <ListItem
              title={v.title}
              description={
                del
                  ? active ? 'Kullanımda, silinemez' : 'Silmek için dokun'
                  : `${formatDuration(v.duration)}${active ? ' · kullanımda' : ''}${b === v.id ? ' · uygulanıyor…' : ''}`
              }
              icon={del ? 'delete' : active ? 'play' : 'file'}
              current={active}
              disabled={(b !== null && b !== 'pick') || (del && active)}
              onPress={() => (del ? removeVideo(v.id) : applyVideo(v.id))}
            />
          )
        })}
      </List>
      {s.library.length === 0 && (
        <Callout tone="accent" title="İlk kurulum">
          <Text size="xs">
            Henüz video yok. Yukarıdan bir tane ekle. İlk videodan sonra Orca ayarlarında tema olarak "Video Background"u seç ve arka plan opaklığını 1'in altına çek; orta alan ancak o zaman videoyu gösterir.
          </Text>
        </Callout>
      )}

      {s.shortcuts.redirected > 0 && (
        <Button variant="ghost" size="sm" icon="refresh" disabled={b === 'shortcuts'} onPress={() => changeShortcuts('restore')}>
          Kısayolları eski haline getir
        </Button>
      )}
    </Stack>
  )
}
