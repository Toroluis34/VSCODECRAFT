export const STYLE = `
.tc-root { max-width: 1400px; }
.tc-layout { display: grid; grid-template-columns: minmax(380px, 1fr) minmax(360px, 1fr); gap: 16px; align-items: start; }
@media (max-width: 860px) { .tc-layout { grid-template-columns: 1fr; } }
.tc-left, .tc-right { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.tc-right h3 { margin: 4px 0 0; font-size: .95em; color: var(--vscode-descriptionForeground); }
.tc-inline { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
.tc-mono { font-family: var(--vscode-editor-font-family, monospace); }
.tc-parts { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
.tc-parts > .mc-card { align-self: stretch; }
.tc-part { display: flex; flex-direction: column; gap: 8px; }
.tc-part.selected { border-color: var(--vscode-focusBorder); }
.tc-part-head { flex-wrap: nowrap; }
.tc-mini-preview { background: #1d1d1d; padding: 1px 6px; border-radius: 2px; max-width: 220px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-family: 'Minecraft', 'Monocraft', var(--vscode-editor-font-family, monospace); }
.tc-text { width: 100%; resize: vertical; min-height: 28px; }
.tc-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.tc-span2 { grid-column: span 2; }
.tc-grid2 > * { min-width: 0; }
.tc-grid2 .mc-field > .mc-input { width: 100%; }
.tc-grid2 .mc-row > .mc-input { flex: 1 1 50px; width: 50px; }
.tc-grid2 .mc-row > input[type='number'].mc-input { flex: 0 0 60px; }
.tc-more { border-top: 1px dashed var(--vscode-panel-border, rgba(128,128,128,.35)); padding-top: 8px; }
.tc-style { gap: 6px; }
.tc-swatches { display: flex; flex-wrap: wrap; gap: 2px; max-width: 190px; }
.tc-swatch { width: 18px; height: 18px; border: 1px solid rgba(128,128,128,.6); border-radius: 2px; padding: 0; cursor: pointer; font-size: 11px; line-height: 16px; color: var(--vscode-foreground); background: transparent; }
.tc-swatch.on { outline: 2px solid var(--vscode-focusBorder); outline-offset: 1px; }
.tc-color { width: 30px; height: 24px; padding: 0; border: 1px solid var(--vscode-input-border, rgba(128,128,128,.4)); background: none; cursor: pointer; }
.tc-hex { width: 96px; }
.tc-toggle { min-width: 26px; height: 24px; border: 1px solid var(--vscode-input-border, rgba(128,128,128,.4)); background: var(--vscode-input-background); color: var(--vscode-input-foreground); border-radius: 2px; cursor: pointer; font: inherit; }
.tc-toggle.on { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border-color: var(--vscode-button-background); }
.tc-target { font-size: .9em; }
.tc-mc { font-family: 'Minecraft', 'Monocraft', var(--vscode-editor-font-family, monospace); }
.tc-chat-bg { padding: 14px 10px; border-radius: 3px; background: linear-gradient(180deg, #5d7a3a 0%, #4a6630 40%, #6b5a3e 41%, #5a4a32 100%); }
.tc-chat-line { background: rgba(0,0,0,.5); padding: 2px 6px; font-size: 15px; line-height: 1.5; color: #fff; min-height: 1.5em; }
.tc-item-bg { padding: 12px; background: #8b8b8b; border-radius: 3px; }
.tc-item-tooltip { display: inline-block; background: rgba(16,0,16,.94); border: 2px solid #28007a; border-radius: 3px; padding: 4px 8px; font-size: 15px; color: #fff; }
.tc-outputs { display: flex; flex-direction: column; gap: 6px; margin-top: 6px; }
.tc-outputs .mc-tabs { margin-bottom: 0; }
.tc-output { margin: 0; padding: 8px; max-height: 260px; overflow: auto; white-space: pre-wrap; word-break: break-all; background: var(--vscode-textCodeBlock-background, rgba(128,128,128,.12)); border: 1px solid var(--vscode-panel-border, rgba(128,128,128,.3)); border-radius: 3px; }
.tc-note { font-size: .88em; }
.tc-codes { gap: 3px; }
.tc-server { display: flex; gap: 8px; padding: 6px; width: 560px; max-width: 100%; background: #1b1b1b; border: 1px solid #808080; image-rendering: pixelated; }
.tc-server-icon { width: 64px; height: 64px; flex: 0 0 64px; background: #3a3a3a; display: flex; align-items: center; justify-content: center; color: #777; font-size: 36px; }
.tc-server-text { display: flex; flex-direction: column; gap: 1px; font-size: 15px; min-width: 0; flex: 1; }
.tc-server-top { display: flex; justify-content: space-between; }
.tc-server-ping { white-space: nowrap; }
.tc-bars { color: #55ff55; letter-spacing: -2px; }
.tc-server-line { white-space: pre; overflow: hidden; }
`;
