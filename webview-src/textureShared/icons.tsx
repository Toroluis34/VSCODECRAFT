// Tiny inline SVG icons (codicons are not available inside webviews).
import type { JSX } from 'preact';

const PATHS: Record<string, string> = {
  pencil: 'M11 2l3 3-8 8H3v-3z M9.5 3.5l3 3',
  eraser: 'M6 14h8 M2.5 9.5l6-6a1.4 1.4 0 0 1 2 0l2 2a1.4 1.4 0 0 1 0 2l-6 6H5z M5.5 6.5l4 4',
  fill: 'M3 8l5-5 5 5-5 5z M3 8h10 M14 11c0 1-1 2-1 2s-1-1-1-2 1-2 1-2 1 1 1 2z',
  picker: 'M10 2.5l3.5 3.5 M12 1.5l2.5 2.5-2 2-2.5-2.5z M10.5 5.5l-7 7V14h1.5l7-7',
  line: 'M3 13L13 3',
  rect: 'M3 4h10v8H3z',
  select: 'M2 2h3 M7 2h2 M11 2h3v3 M14 7v2 M14 11v3h-3 M9 14H7 M5 14H2v-3 M2 9V7 M2 5V2',
  mirrorX: 'M8 1v14 M6 4L2 8l4 4z M10 4l4 4-4 4z',
  mirrorY: 'M1 8h14 M4 6l4-4 4 4z M4 10l4 4 4-4z',
  grid: 'M2 2h12v12H2z M6 2v12 M10 2v12 M2 6h12 M2 10h12',
  zoomIn: 'M7 2a5 5 0 1 0 0 10A5 5 0 1 0 7 2z M10.5 10.5L14 14 M5 7h4 M7 5v4',
  zoomOut: 'M7 2a5 5 0 1 0 0 10A5 5 0 1 0 7 2z M10.5 10.5L14 14 M5 7h4',
  undo: 'M5 3L2 6l3 3 M2 6h7a4 4 0 0 1 0 8H6',
  redo: 'M11 3l3 3-3 3 M14 6H7a4 4 0 0 0 0 8h3',
  flipH: 'M8 2v12 M6 4H2l4 8z M10 4h4l-4 8z',
  flipV: 'M2 8h12 M4 6V2l8 4z M4 10v4l8-4z',
  rotateCw: 'M13 3v4H9 M13 7A5.5 5.5 0 1 0 12 12',
  rotateCcw: 'M3 3v4h4 M3 7A5.5 5.5 0 1 1 4 12',
  adjust: 'M8 1.5a6.5 6.5 0 1 0 0 13z M8 1.5a6.5 6.5 0 0 1 0 13',
  palette: 'M8 1.5a6.5 6.5 0 0 0 0 13c1 0 1.5-.7 1.5-1.4 0-1.1-1-1.3-1-2.1s.6-1 1.5-1H12a2.5 2.5 0 0 0 2.5-2.5C14.5 4.2 11.6 1.5 8 1.5z M4.5 7.5h.01 M6.5 4.5h.01 M10 4.5h.01',
  resize: 'M2 6V2h4 M14 10v4h-4 M2 2l5 5 M14 14L9 9',
  save: 'M2 2h9l3 3v9H2z M5 2v4h6V2 M5 14v-4h6v4',
  play: 'M4 2l10 6-10 6z',
  pause: 'M4 2h3v12H4z M9 2h3v12H9z',
  plus: 'M8 2v12 M2 8h12',
  copy: 'M5 5h9v9H5z M2 11V2h9',
  trash: 'M2 4h12 M6 4V2h4v2 M3.5 4l1 10h7l1-10',
  left: 'M10 3L5 8l5 5',
  right: 'M6 3l5 5-5 5',
  onion: 'M8 2c3 3 5 5 5 8a5 5 0 0 1-10 0c0-3 2-5 5-8z M8 8v6',
  swap: 'M3 5h10l-3-3 M13 11H3l3 3',
  cube: 'M8 1.5l6 3v7l-6 3-6-3v-7z M2 4.5l6 3 6-3 M8 7.5v7',
  tiles: 'M2 2h5v5H2z M9 2h5v5H9z M2 9h5v5H2z M9 9h5v5H9z',
  variant: 'M5 2a3 3 0 1 0 0 6 3 3 0 1 0 0-6z M11 8a3 3 0 1 0 0 6 3 3 0 1 0 0-6z M9 3h4v4',
  open: 'M9 2h5v5 M14 2L7 9 M12 9v5H2V4h5',
  refresh: 'M13 3v4H9 M13 7a5.5 5.5 0 1 0 .5 3',
  warning: 'M8 1.5l7 12.5H1z M8 6v4 M8 12v.5',
  film: 'M3 1.5h10v13H3z M3 4.5h10 M3 11.5h10 M1.5 3h1 M1.5 6h1 M1.5 9h1 M1.5 12h1 M13.5 3h1 M13.5 6h1 M13.5 9h1 M13.5 12h1',
};

export function Icon({ name, size = 16, title }: { name: keyof typeof PATHS | string; size?: number; title?: string }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden={title ? undefined : 'true'}>
      {title ? <title>{title}</title> : null}
      <path d={PATHS[name] ?? ''} />
    </svg>
  );
}

/** Icon button for toolbars. */
export function ToolButton(p: { icon: string; title: string; active?: boolean; disabled?: boolean; onClick?: () => void; label?: string }): JSX.Element {
  return (
    <button class={`tex-tool ${p.active ? 'active' : ''}`} title={p.title} aria-label={p.title} aria-pressed={p.active} disabled={p.disabled} onClick={p.onClick}>
      <Icon name={p.icon} />
      {p.label ? <span class="tex-tool-label">{p.label}</span> : null}
    </button>
  );
}

export const ICON_CSS = `
.tex-tool {
  display: inline-flex; align-items: center; justify-content: center; gap: 4px; min-width: 28px; height: 28px; padding: 0 6px;
  background: transparent; color: var(--vscode-icon-foreground, var(--vscode-foreground)); border: 1px solid transparent; border-radius: 4px; cursor: pointer; font: inherit; font-size: 12px;
}
.tex-tool:hover:not(:disabled) { background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,.2)); }
.tex-tool.active { background: var(--vscode-inputOption-activeBackground, rgba(0,127,212,.25)); border-color: var(--vscode-inputOption-activeBorder, var(--vscode-focusBorder)); color: var(--vscode-inputOption-activeForeground, inherit); }
.tex-tool:disabled { opacity: .4; cursor: default; }
.tex-tool svg { flex: 0 0 auto; }
.tex-sep { width: 1px; height: 20px; background: var(--vscode-panel-border, rgba(128,128,128,.35)); margin: 0 4px; }
`;
