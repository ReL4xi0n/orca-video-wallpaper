// Starts Orca as a child process with --remote-debugging-pipe (no network port:
// only this process holds the control channel) and keeps the transparency CSS
// applied to Orca's windows, including after reloads. Exits when Orca exits.
// Values live in ../config.json ({ "panels": 85, "center": 65 }); edits apply live.
import { spawn } from 'node:child_process';
import * as require_fs from 'node:fs';
import { readFileSync, watch, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const configPath = join(here, '..', 'config.json');
const exe = join(process.env.LOCALAPPDATA, 'Programs', 'orca', 'Orca.exe');
if (!existsSync(exe)) process.exit(1);
// Security: inject.js is read once at launch and never re-read, so code written
// into it while Orca runs never reaches Orca.
const injectTemplate = readFileSync(join(here, 'inject.js'), 'utf8');

const clamp = v => String(Math.max(0, Math.min(100, Math.round(Number(v)))));
function buildScript() {
  let cfg = { panels: 85, center: 65 };
  try { cfg = { ...cfg, ...JSON.parse(readFileSync(configPath, 'utf8')) }; } catch {}
  return injectTemplate
    .replaceAll('__PANELS__', clamp(cfg.panels))
    .replaceAll('__CENTER__', clamp(cfg.center));
}

const child = spawn(exe, ['--remote-debugging-pipe', ...process.argv.slice(2)], {
  stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'],
  windowsHide: false
});
child.on('exit', () => process.exit(0));
const toBrowser = child.stdio[3];
const fromBrowser = child.stdio[4];
toBrowser.on('error', () => {});
fromBrowser.on('error', () => {});

let nextId = 0;
const pending = new Map();
function send(method, params = {}, sessionId) {
  return new Promise(resolve => {
    const msg = { id: ++nextId, method, params };
    if (sessionId) msg.sessionId = sessionId;
    pending.set(msg.id, resolve);
    try { toBrowser.write(JSON.stringify(msg) + '\0'); } catch { resolve(null); }
  });
}

const sessions = new Map(); // sessionId -> { scriptId }
let script = buildScript();
const isOrcaPage = info => info.type === 'page' && /\/out\/renderer\/(index|popout)\.html/.test(info.url || '');

const attaching = new Set(); // targetIds attached or being attached
async function attach(info) {
  if (!isOrcaPage(info) || attaching.has(info.targetId)) return;
  attaching.add(info.targetId);
  const r = await send('Target.attachToTarget', { targetId: info.targetId, flatten: true });
  const sessionId = r?.result?.sessionId;
  if (!sessionId) { attaching.delete(info.targetId); return; }
  const entry = { targetId: info.targetId, scriptId: null };
  sessions.set(sessionId, entry);
  await send('Page.enable', {}, sessionId);
  const s = await send('Page.addScriptToEvaluateOnNewDocument', { source: script }, sessionId);
  entry.scriptId = s?.result?.identifier ?? null;
  const ev = await send('Runtime.evaluate', { expression: script }, sessionId);
  debug(`attached ${info.url} -> ${ev?.result?.result?.value ?? JSON.stringify(ev?.result?.exceptionDetails ?? ev?.error)}`);
}

function debug(line) {
  if (!process.env.VW_DEBUG_LOG) return;
  try { require_fs.appendFileSync(process.env.VW_DEBUG_LOG, `${new Date().toISOString()} ${line}\n`); } catch {}
}

async function reapplyAll() {
  script = buildScript();
  for (const [sessionId, entry] of sessions) {
    if (entry.scriptId) await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: entry.scriptId }, sessionId);
    const s = await send('Page.addScriptToEvaluateOnNewDocument', { source: script }, sessionId);
    entry.scriptId = s?.result?.identifier ?? null;
    const ev = await send('Runtime.evaluate', { expression: script + ";document.getElementById('video-wallpaper-css')?.textContent.match(/\\d+%/g)?.join(',')" }, sessionId);
    debug(`reapplied -> ${ev?.result?.result?.value}`);
  }
}

let buf = '';
fromBrowser.on('data', chunk => {
  buf += chunk.toString('utf8');
  let i;
  while ((i = buf.indexOf('\0')) >= 0) {
    let msg; try { msg = JSON.parse(buf.slice(0, i)); } catch { msg = null; }
    buf = buf.slice(i + 1);
    if (!msg) continue;
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); continue; }
    if (msg.method === 'Target.targetCreated' || msg.method === 'Target.targetInfoChanged') attach(msg.params.targetInfo);
    if (msg.method === 'Target.detachedFromTarget') {
      const entry = sessions.get(msg.params.sessionId);
      if (entry) attaching.delete(entry.targetId);
      sessions.delete(msg.params.sessionId);
    }
    if (msg.method === 'Target.targetDestroyed') attaching.delete(msg.params.targetId);
  }
});

await send('Target.setDiscoverTargets', { discover: true });

// Only config.json is watched; it contributes two numbers clamped to 0-100.
let timer = null;
try {
  watch(dirname(configPath), (_e, name) => {
    if (name !== 'config.json') return;
    clearTimeout(timer); timer = setTimeout(reapplyAll, 200);
  });
} catch {}
