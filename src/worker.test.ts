// `orca plugin test .` runs this in Node. The worker works on ~/orca-video-theme, so the test
// points the home folder at a temporary one before loading it; the real library is never touched.
import { assert, mountWorker, test } from 'orca/testing'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'vw-test-'))
process.env.USERPROFILE = home
process.env.HOME = home
const lib = join(home, 'orca-video-theme', 'library')

function addVideo(id: string, title: string, createdAt: number, thumb = true): void {
  const dir = join(lib, id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'video.mp4'), 'not a real video')
  if (thumb) writeFileSync(join(dir, 'thumb.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]))
  writeFileSync(join(dir, 'meta.json'), JSON.stringify({ id, title, source: 'x', duration: 12, createdAt }))
}

test('sets up the folder, serves card images and deletes videos', async () => {
  addVideo('autumn-1', 'Autumn', 2)
  addVideo('rain-2', 'Rain', 1)
  mkdirSync(join(home, 'orca-video-theme'), { recursive: true })
  writeFileSync(join(home, 'orca-video-theme', 'state.json'), JSON.stringify({ activeId: 'autumn-1', videoStrength: 90 }))

  const worker = await mountWorker(await import('./worker'))
  try {
    assert.ok(existsSync(join(home, 'orca-video-theme', 'theme', 'orca-plugin.json')), 'writes the theme on first run')
    assert.ok(existsSync(join(home, 'orca-video-theme', 'tools', 'launcher.mjs')), 'writes the launcher on first run')

    const state = await worker.request('state.get')
    assert.deepEqual(state.library.map((v) => v.title), ['Autumn', 'Rain'], 'newest first')
    assert.equal(state.activeId, 'autumn-1')

    const thumb = await worker.request('video.thumb', { id: 'autumn-1' })
    assert.equal(thumb.src, 'data:image/jpeg;base64,/9j/2Q==')

    await assert.rejects(worker.request('video.thumb', { id: '../secret' }), /Geçersiz video/) // ids that leave the library are refused
    await assert.rejects(worker.request('video.remove', { id: 'autumn-1' }), /Kullanımdaki video silinemez/)

    const after = await worker.request('video.remove', { id: 'rain-2' })
    assert.deepEqual(after.library.map((v) => v.id), ['autumn-1'])
    assert.equal(existsSync(join(lib, 'rain-2')), false)

    // "Boş" turns the video off (the fresh theme has no background, so nothing is reinstalled);
    // after that the former video is no longer in use and can be deleted.
    const cleared = await worker.request('video.clear')
    assert.equal(cleared.activeId, null)
    const empty = await worker.request('video.remove', { id: 'autumn-1' })
    assert.deepEqual(empty.library, [])
  } finally {
    await worker.deactivate()
    rmSync(home, { recursive: true, force: true })
  }
})
