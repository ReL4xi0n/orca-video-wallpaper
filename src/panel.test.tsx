// `orca plugin test .` runs this in Node with the same runtime and checks Orca uses.
import { assert, mockHost, mount, test } from 'orca/testing'
import * as panel from './panel'

const baseState = {
  library: [
    { id: 'a-1', title: 'Autumn', source: 'C:\\a.mp4', duration: 26, createdAt: 2 },
    { id: 'b-2', title: 'Rain', source: 'https://x/y.mp4', duration: 58, createdAt: 1 }
  ],
  activeId: 'a-1',
  videoStrength: 90,
  panels: 85,
  center: 65,
  tools: { ffmpeg: true, ytdlp: true, node: true },
  launcherActive: true,
  shortcuts: { found: 2, redirected: 2 },
  job: null
}

test('lists videos, applies one and sends slider values', async () => {
  const calls: { name: string; input: unknown }[] = []
  let current = structuredClone(baseState)
  const host = mockHost({
    requests: {
      'state.get': () => current,
      'video.apply': ({ id }) => { calls.push({ name: 'video.apply', input: id }); current = { ...current, activeId: id }; return current },
      'opacity.set': (input) => { calls.push({ name: 'opacity.set', input }); return { ok: true } },
      'video.add': (input) => { calls.push({ name: 'video.add', input }); return { jobId: 'j1' } }
    }
  })
  const view = await mount(panel, { host })
  assert.ok(view.find({ label: 'Autumn' }), 'shows the library')
  assert.ok(view.find({ label: 'Rain' }))

  await view.press({ label: 'Rain' })
  assert.deepEqual(calls.find((c) => c.name === 'video.apply')?.input, 'b-2')

  await view.post('job.progress', { id: 'j1', stage: 'convert', percent: 40, message: 'Dönüştürülüyor…' })
  assert.ok(view.find({ label: 'Dönüştürülüyor…' }), 'shows conversion progress')

  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
  await view.unmount()
})

test('delete mode removes a video instead of applying it', async () => {
  const calls: string[] = []
  let current = structuredClone(baseState)
  const host = mockHost({
    requests: {
      'state.get': () => current,
      'video.apply': () => { calls.push('apply'); return current },
      'video.remove': ({ id }) => {
        calls.push(`remove:${id}`)
        current = { ...current, library: current.library.filter((v) => v.id !== id) }
        return current
      }
    }
  })
  const view = await mount(panel, { host })
  await view.toggle({ label: 'Silme modu' })
  await view.press({ label: 'Rain' })
  assert.deepEqual(calls, ['remove:b-2'])
  assert.equal(view.find({ label: 'Rain' }), null)
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('warns when the launcher is not active and tools are missing', async () => {
  const host = mockHost({
    requests: { 'state.get': () => ({ ...baseState, launcherActive: false, tools: { ffmpeg: false, ytdlp: true, node: true } }) }
  })
  const view = await mount(panel, { host })
  assert.ok(view.find({ label: 'Panel saydamlığı kapalı' }))
  assert.ok(view.find({ label: 'Eksik araç' }))
  assert.equal(view.find({ label: 'Kısayollar ayarlı değil' }), null, 'no repair prompt when all shortcuts are set')
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('repairs reset shortcuts and can restore them', async () => {
  const calls: string[] = []
  let current = structuredClone({ ...baseState, launcherActive: false, shortcuts: { found: 2, redirected: 1 } })
  const host = mockHost({
    requests: {
      'state.get': () => current,
      'shortcuts.repair': () => { calls.push('repair'); current = { ...current, shortcuts: { found: 2, redirected: 2 } }; return current },
      'shortcuts.restore': () => { calls.push('restore'); current = { ...current, shortcuts: { found: 2, redirected: 0 } }; return current }
    }
  })
  const view = await mount(panel, { host })
  assert.ok(view.find({ label: 'Kısayollar ayarlı değil' }))
  await view.press({ type: 'Button', text: 'Kısayolları ayarla' })
  assert.equal(view.find({ label: 'Kısayollar ayarlı değil' }), null)
  assert.ok(view.find({ label: 'Panel saydamlığı kapalı' }), 'asks to reopen Orca through the shortcut')
  await view.press({ type: 'Button', text: 'Kısayolları eski haline getir' })
  assert.deepEqual(calls, ['repair', 'restore'])
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('first run with no shortcuts and no videos explains the setup', async () => {
  const host = mockHost({
    requests: { 'state.get': () => ({ ...baseState, library: [], activeId: null, shortcuts: { found: 0, redirected: 0 } }) }
  })
  const view = await mount(panel, { host })
  assert.ok(view.find({ label: 'Orca kısayolu bulunamadı' }))
  assert.ok(view.find({ label: 'İlk kurulum' }))
  assert.equal(view.find({ type: 'Button', text: 'Kısayolları eski haline getir' }), null)
  assert.deepEqual(view.errors, [])
  await view.unmount()
})
