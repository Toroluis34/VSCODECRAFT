export const STYLE = `
body { padding: 0; overflow: hidden; }
.lang-root { display: flex; flex-direction: column; height: 100vh; padding: 10px 14px 6px; gap: 6px; }
.lang-toolbar { margin-bottom: 0; }
.lang-title { margin-right: 6px; white-space: nowrap; }
.lang-search { width: 240px; }
.lang-check { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; cursor: pointer; }
.lang-form { display: flex; gap: 10px; flex-wrap: wrap; align-items: flex-end; }
.lang-banner { padding: 4px 8px; border-left: 3px solid var(--vscode-editorWarning-foreground, #cca700); background: rgba(204,167,0,.08); font-size: .92em; }
.lang-banner.error { border-left-color: var(--vscode-errorForeground); background: rgba(244,135,113,.08); }
.lang-grid { flex: 1 1 auto; min-height: 120px; overflow: auto; border: 1px solid var(--vscode-panel-border, rgba(128,128,128,.35)); border-radius: 3px; position: relative; }
.lang-row { display: grid; height: ${30}px; align-items: stretch; border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,.18)); }
.lang-row:hover .lang-cell { background-color: var(--vscode-list-hoverBackground); }
.lang-row.selected .lang-cell { background-color: var(--vscode-list-inactiveSelectionBackground, rgba(128,128,128,.18)); }
.lang-head { position: sticky; top: 0; z-index: 3; height: auto; min-height: 44px; background: var(--vscode-editor-background); border-bottom: 2px solid var(--vscode-panel-border, rgba(128,128,128,.35)); }
.lang-head .lang-cell { flex-direction: column; align-items: stretch; justify-content: center; gap: 3px; font-weight: 600; background: var(--vscode-editor-background); }
.lang-cell { display: flex; align-items: center; gap: 6px; padding: 0 6px; min-width: 0; overflow: hidden; border-right: 1px solid var(--vscode-panel-border, rgba(128,128,128,.12)); background-color: var(--vscode-editor-background); }
.lang-keycell { position: sticky; left: 0; z-index: 2; font-family: var(--vscode-editor-font-family, monospace); font-size: .92em; }
.lang-head .lang-keycell { z-index: 4; }
.lang-key { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: text; }
.lang-noicon { width: 20px; flex: 0 0 20px; }
.lang-warn { color: var(--vscode-editorWarning-foreground, #cca700); margin-left: auto; }
.lang-ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.lang-value { cursor: text; }
.lang-value:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
.lang-value.missing { background-image: repeating-linear-gradient(-45deg, transparent 0 6px, rgba(244,135,113,.10) 6px 12px); }
.lang-value.empty { box-shadow: inset 3px 0 0 var(--vscode-errorForeground); }
.lang-value.untranslated { box-shadow: inset 3px 0 0 var(--vscode-editorWarning-foreground, #cca700); }
.lang-value.untranslated .lang-ellipsis { opacity: .75; font-style: italic; }
.lang-value.mismatch { box-shadow: inset 0 0 0 1px var(--vscode-errorForeground); }
.lang-value.readonly { cursor: default; opacity: .7; }
.lang-placeholder { color: var(--vscode-descriptionForeground); opacity: .55; font-style: italic; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lang-edit { width: 100%; height: 24px; }
.lang-mc { background: #1d1d1d; color: #fff; padding: 1px 5px; border-radius: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-shadow: 1px 1px 0 #3f3f3f; }
.lang-mc .mc-text { white-space: nowrap; }
.lang-actions { justify-content: center; gap: 0; opacity: .35; }
.lang-row:hover .lang-actions { opacity: 1; }
.lang-grouprow { display: flex; align-items: center; gap: 8px; padding: 0 8px; cursor: pointer; user-select: none; background: var(--vscode-sideBar-background, rgba(128,128,128,.08)); position: sticky; left: 0; }
.lang-twisty { width: 12px; }
.lang-progress { position: relative; height: 14px; border-radius: 7px; background: rgba(128,128,128,.25); overflow: hidden; font-size: 10px; font-weight: 600; }
.lang-progress > div { height: 100%; background: var(--vscode-progressBar-background, #0e70c0); opacity: .8; }
.lang-progress > div.done { background: #3fa34d; }
.lang-progress > span { position: absolute; inset: 0; text-align: center; line-height: 14px; color: var(--vscode-foreground); }
.lang-empty { padding: 20px; text-align: center; }
.lang-status { font-size: .85em; }
.lang-detail { flex: 0 0 auto; max-height: 38vh; overflow: auto; display: flex; flex-direction: column; gap: 6px; }
.lang-detail-key { font-size: 1.05em; }
.lang-previews { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 6px; }
.lang-preview { display: flex; flex-direction: column; gap: 2px; }
.lang-chat { background: rgba(0,0,0,.78); color: #fff; padding: 4px 6px; font-family: 'Minecraft', 'Monocraft', var(--vscode-editor-font-family, monospace); text-shadow: 2px 2px 0 #3f3f3f; border-radius: 2px; min-height: 24px; }
.lang-chat-missing { color: #ff5555; font-style: italic; }
`;
