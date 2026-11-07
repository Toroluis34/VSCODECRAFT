// Styles specific to the recipe webviews (injected once). Shared look comes from media/webview.css.
const CSS = `
.rc-app { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.rc-header { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.rc-header h1 { font-size: 1.15em; margin: 0; font-weight: 600; }
.rc-header .mono { opacity: .8; }
.rc-main { display: flex; gap: 16px; align-items: flex-start; flex-wrap: wrap; }
.rc-stage { display: flex; flex-direction: column; gap: 10px; align-items: flex-start; min-width: 0; flex: 1 1 360px; }
.rc-side { display: flex; flex-direction: column; gap: 10px; flex: 0 1 340px; min-width: 260px; }
.rc-gui { min-width: 240px; }
.rc-gui .mc-gui-title { display: flex; align-items: center; gap: 6px; }
.rc-row { display: flex; align-items: center; gap: 6px; }
.rc-col { display: flex; flex-direction: column; align-items: center; gap: 4px; }
.rc-grid { display: grid; gap: 0; }
.rc-slot-wrap { display: flex; flex-direction: column; align-items: center; gap: 2px; }
.rc-slot-label { font-size: 10.5px; color: #4a4a4a; max-width: 64px; text-align: center; line-height: 1.1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rc-gui .mc-slot { cursor: default; }
.rc-editable .rc-gui .mc-slot { cursor: pointer; }
.rc-slot-off { opacity: .45; }
.rc-slot-off.mc-slot:hover { background: var(--mc-slot-bg); }
.rc-bad { position: absolute; inset: -2px; border: 2px solid #ff4040; pointer-events: none; }
.rc-custom-badge { position: absolute; right: 0; top: -3px; font-size: 10px; color: #55ffff; text-shadow: 1px 1px 0 #3f3f3f; pointer-events: none; }
.rc-comp-badge { position: absolute; left: 1px; bottom: -2px; font-size: 11px; color: #ff55ff; text-shadow: 1px 1px 0 #3f3f3f; pointer-events: none; }
.rc-arrow-wrap { display: flex; flex-direction: column; align-items: center; gap: 0; color: #3f3f3f; font-size: 11px; min-width: 52px; }
.rc-arrow-down { width: 22px; height: 30px; transform: rotate(90deg); margin: 0; }
.rc-note { font-size: 11px; color: #4a4a4a; margin-top: 6px; max-width: 330px; }
.rc-xp { color: #3d8a1f; font-weight: 600; font-size: 11px; }
.rc-badges { display: flex; gap: 4px; flex-wrap: wrap; }
.rc-shapeless { font-size: 13px; color: #555; }
.rc-special { display: flex; gap: 12px; align-items: center; max-width: 520px; }
.rc-special p { margin: 4px 0 0; }
.rc-section-title { font-weight: 600; margin: 0 0 6px; display: flex; align-items: center; gap: 6px; }
.rc-props { display: grid; grid-template-columns: auto 1fr; gap: 6px 8px; align-items: center; }
.rc-props > label { color: var(--vscode-descriptionForeground); font-size: .92em; }
.rc-props .mc-input, .rc-props .mc-select { width: 100%; }
.rc-props input[type='number'].mc-input { width: 90px; }
.rc-warnings { display: flex; flex-direction: column; gap: 4px; margin: 0; padding: 0; list-style: none; }
.rc-warnings li { display: flex; gap: 6px; align-items: flex-start; }
.rc-sev-error::before { content: '⛔'; }
.rc-sev-warning::before { content: '⚠'; color: var(--vscode-editorWarning-foreground, #cca700); }
.rc-sev-info::before { content: 'ℹ'; color: var(--vscode-editorInfo-foreground, #3794ff); }
.rc-components { max-height: 160px; overflow: auto; margin: 4px 0 0; font-size: 11.5px; white-space: pre; background: var(--vscode-textCodeBlock-background, rgba(128,128,128,.12)); padding: 6px; border-radius: 3px; }
.rc-menu { position: fixed; z-index: 50; min-width: 200px; max-width: 320px; background: var(--vscode-menu-background, var(--vscode-editorWidget-background)); color: var(--vscode-menu-foreground, var(--vscode-foreground)); border: 1px solid var(--vscode-menu-border, var(--vscode-widget-border, #454545)); border-radius: 4px; box-shadow: 0 2px 8px rgba(0,0,0,.36); padding: 4px 0; }
.rc-menu button { display: flex; width: 100%; gap: 6px; align-items: center; text-align: left; background: none; border: none; color: inherit; padding: 4px 12px; font: inherit; cursor: pointer; }
.rc-menu button:hover { background: var(--vscode-menu-selectionBackground, var(--vscode-list-hoverBackground)); color: var(--vscode-menu-selectionForeground, inherit); }
.rc-menu hr { border: none; border-top: 1px solid var(--vscode-menu-separatorBackground, rgba(128,128,128,.35)); margin: 4px 0; }
.rc-menu .rc-menu-title { padding: 2px 12px 4px; font-size: .9em; color: var(--vscode-descriptionForeground); }
.rc-menu input { margin: 2px 8px 4px; width: calc(100% - 16px); }
.rc-taglist { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
.rc-chip { display: inline-flex; align-items: center; gap: 4px; padding: 1px 6px; border-radius: 10px; border: 1px solid var(--vscode-widget-border, rgba(128,128,128,.4)); background: transparent; color: inherit; font: inherit; font-size: .9em; cursor: pointer; }
.rc-chip:hover { background: var(--vscode-list-hoverBackground); }
.rc-sel-info { display: flex; gap: 8px; align-items: center; }
.rc-sel-info .mono { word-break: break-all; }
.rc-hint { font-size: .9em; color: var(--vscode-descriptionForeground); }
.rc-results { display: flex; flex-direction: column; gap: 4px; }
.rc-chance { font-size: 10px; color: #3f3f3f; }
.rc-generic-ings { display: flex; flex-wrap: wrap; gap: 6px 4px; max-width: 360px; }
.rc-error-box { border-left: 3px solid var(--vscode-errorForeground); padding: 6px 10px; }
.rc-potion { font-size: 11px; color: #3f3f3f; text-align: center; max-width: 120px; }
.rc-trim-label { font-size: 11px; color: #3f3f3f; }
`;

let injected = false;
export function injectStyles(): void {
  if (injected) return;
  injected = true;
  const s = document.createElement('style');
  s.textContent = CSS;
  document.head.appendChild(s);
}
