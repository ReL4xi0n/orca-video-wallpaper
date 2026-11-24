// Windows folders the worker needs. Orca starts plugin workers with a trimmed environment (no
// LOCALAPPDATA, APPDATA or ProgramFiles), so each one falls back to a path built from the home
// folder, and child processes get a completed environment.
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'

export const LOCAL_APPDATA = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local')
export const ROAMING_APPDATA = process.env.APPDATA || join(homedir(), 'AppData', 'Roaming')
export const PROGRAM_FILES = process.env.ProgramFiles || `${process.env.SystemDrive || 'C:'}\\Program Files`

/** Inside Orca the worker runs in Orca.exe itself; elsewhere (tests) use the default install. */
export const ORCA_DIR = basename(process.execPath).toLowerCase() === 'orca.exe'
  ? dirname(process.execPath)
  : join(LOCAL_APPDATA, 'Programs', 'orca')
export const ORCA_EXE = join(ORCA_DIR, 'Orca.exe')

/** Environment for programs the worker starts. ELECTRON_RUN_AS_NODE is Orca's own setting for
 *  this worker; passed on, it would turn an Electron program it starts into plain Node. */
export function childEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, LOCALAPPDATA: LOCAL_APPDATA, APPDATA: ROAMING_APPDATA, ProgramFiles: PROGRAM_FILES }
  delete env.ELECTRON_RUN_AS_NODE
  return env
}
