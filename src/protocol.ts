// The panel <-> worker contract, declared once: src/panel.tsx and src/worker.ts both read it.
export {}

declare module 'orca' {
  interface VideoItem {
    id: string
    title: string
    /** Local path or URL it was added from. */
    source: string
    /** Seconds of the converted loop. */
    duration: number
    createdAt: number
  }

  interface WallpaperState {
    library: VideoItem[]
    activeId: string | null
    /** Side panel opacity %, 0-100 (higher = darker). */
    panels: number
    /** Center chat area opacity %, 0-100 (lower = more video). */
    center: number
    tools: { ffmpeg: boolean; ytdlp: boolean; node: boolean }
    /** Orca was opened through the transparency launcher (panel opacity works). */
    launcherActive: boolean
    /** Orca.lnk shortcuts found and how many open Orca through the launcher. */
    shortcuts: { found: number; redirected: number }
    job: JobState | null
  }

  interface JobState {
    id: string
    stage: 'download' | 'convert' | 'install' | 'done' | 'error'
    /** 0-100 when known. */
    percent: number | null
    message: string
  }

  interface PluginRequests {
    'state.get': { output: WallpaperState }
    /** Opens a native file dialog; null when cancelled. */
    'file.pick': { output: { path: string | null } }
    /** Starts download/convert/apply in the background; progress arrives as `job.progress`. */
    'video.add': { input: { source: string; start?: number }; output: { jobId: string } }
    'video.apply': { input: { id: string }; output: WallpaperState }
    'video.remove': { input: { id: string }; output: WallpaperState }
    /** "Boş": no video, Orca's plain theme colours. */
    'video.clear': { output: WallpaperState }
    /** The card image as a data URL, or null when there is none. */
    'video.thumb': { input: { id: string }; output: { src: string | null } }
    'opacity.set': { input: { panels?: number; center?: number }; output: { ok: true } }
    /** Installs missing ffmpeg / yt-dlp / Node.js with winget. */
    'tools.install': { output: { ffmpeg: boolean; ytdlp: boolean; node: boolean } }
    /** Points the Orca shortcuts at the transparency launcher. */
    'shortcuts.repair': { output: WallpaperState }
    /** Points the Orca shortcuts back at Orca.exe. */
    'shortcuts.restore': { output: WallpaperState }
  }

  interface PluginPanelEvents {
    'job.progress': JobState
    'state.changed': WallpaperState
  }
}
