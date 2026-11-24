(() => {
  const ID = 'video-wallpaper-css';
  const PANELS = '__PANELS__'; // side panels opacity %: higher = darker
  const CENTER = '__CENTER__'; // center chat area opacity %: lower = more video
  const css = `
:root[data-theme-background] .bg-worktree-sidebar{background-color:color-mix(in srgb,var(--worktree-sidebar) ${PANELS}%,transparent)!important}
:root[data-theme-background] .bg-sidebar{background-color:color-mix(in srgb,var(--sidebar) ${PANELS}%,transparent)!important}
:root[data-theme-background] .bg-tab-bar{background-color:color-mix(in srgb,var(--tab-bar,var(--card)) ${PANELS}%,transparent)!important}
:root[data-theme-background] .titlebar,:root[data-theme-background] .titlebar-left{background:color-mix(in srgb,var(--worktree-sidebar) ${PANELS}%,transparent)!important}
:root[data-theme-background] .workspace-sidebar-seam{background:transparent!important}
:root[data-theme-background] [data-native-chat-root].bg-chat-canvas{background-color:color-mix(in srgb,var(--background) ${CENTER}%,transparent)!important}
`;
  const apply = () => {
    let el = document.getElementById(ID);
    if (!el) { el = document.createElement('style'); el.id = ID; (document.head || document.documentElement).appendChild(el); }
    if (el.textContent !== css) el.textContent = css;
  };
  if (document.documentElement) apply();
  else document.addEventListener('DOMContentLoaded', apply, { once: true });
  return 'ok';
})()
