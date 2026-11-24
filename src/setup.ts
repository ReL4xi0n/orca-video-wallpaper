// First-run setup and Orca shortcut handling.
// ensureSetup writes the theme and launcher files from src/bundled.ts into ~/orca-video-theme.
// shortcuts() reads or changes the user's Orca.lnk shortcuts so they open Orca through the
// transparency launcher (repair) or directly again (restore).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { BUNDLED } from './bundled'
import { run } from './media'
import { ORCA_EXE } from './paths'

/**
 * Theme files are written only when missing (the worker edits them afterwards).
 * Launcher files are kept identical to this plugin version, so plugin updates reach them;
 * the launcher reads them once when it starts Orca.
 */
export function ensureSetup(home: string): void {
  for (const [rel, text] of Object.entries(BUNDLED)) {
    const target = join(home, ...rel.split('/'))
    const exists = existsSync(target)
    if (exists && !rel.startsWith('tools/')) continue
    if (exists && readFileSync(target, 'utf8') === text) continue
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, text, 'utf8')
  }
}

export interface ShortcutStatus {
  /** Orca.lnk shortcuts found (Desktop, Start menu, pinned taskbar). */
  found: number
  /** How many of them open Orca through the launcher. */
  redirected: number
  /** Orca is currently running with the launcher's control pipe. */
  launcherActive: boolean
}

const quote = (s: string) => `'${s.replace(/'/g, "''")}'`

/**
 * Only shortcuts that already point at Orca.exe or at this launcher are touched. Editing the
 * existing .lnk in place keeps its AppUserModelID, so taskbar grouping keeps working.
 */
export async function shortcuts(mode: 'status' | 'repair' | 'restore', vbs: string): Promise<ShortcutStatus> {
  const script = `
$ErrorActionPreference = 'Stop'
$mode = ${quote(mode)}; $vbs = ${quote(vbs)}; $exe = ${quote(ORCA_EXE)}
$wscript = Join-Path ([Environment]::GetFolderPath('System')) 'wscript.exe'
$want = '"' + $vbs + '"'
$sh = New-Object -ComObject WScript.Shell
$files = @()
foreach ($d in @([Environment]::GetFolderPath('Desktop'), (Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'Microsoft\\Internet Explorer\\Quick Launch\\User Pinned\\TaskBar'))) {
  $p = Join-Path $d 'Orca.lnk'; if (Test-Path -LiteralPath $p) { $files += $p }
}
$start = [Environment]::GetFolderPath('Programs')
if (Test-Path -LiteralPath $start) { $files += @(Get-ChildItem -LiteralPath $start -Recurse -Filter 'Orca.lnk' | ForEach-Object { $_.FullName }) }
$found = 0; $redirected = 0
foreach ($p in $files) {
  $l = $sh.CreateShortcut($p)
  $direct = $l.TargetPath -ieq $exe
  $ours = ($l.TargetPath -ieq $wscript) -and ($l.Arguments -like '*launch-orca.vbs*')
  if (-not ($direct -or $ours)) { continue }
  $found++
  if ($mode -eq 'repair' -and ($direct -or $l.Arguments -ne $want)) {
    $l.TargetPath = $wscript; $l.Arguments = $want; $l.IconLocation = "$exe,0"; $l.WorkingDirectory = Split-Path $exe; $l.Save(); $ours = $true
  } elseif ($mode -eq 'restore' -and $ours) {
    $l.TargetPath = $exe; $l.Arguments = ''; $l.IconLocation = "$exe,0"; $l.WorkingDirectory = Split-Path $exe; $l.Save(); $ours = $false
  }
  if ($ours) { $redirected++ }
}
$running = @(Get-CimInstance Win32_Process -Filter "Name='Orca.exe'" | Where-Object { $_.CommandLine -match '--remote-debugging-pipe' }).Count
Write-Output "$found $redirected $running"
`
  const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script])
  const [found, redirected, running] = r.stdout.trim().split(/\s+/).map(Number)
  if (r.code !== 0 || !Number.isFinite(found)) {
    if (mode === 'status') return { found: 0, redirected: 0, launcherActive: false }
    throw new Error(`Kısayollar değiştirilemedi: ${(r.stderr || r.stdout).trim().split('\n')[0]}`)
  }
  return { found, redirected, launcherActive: running > 0 }
}
