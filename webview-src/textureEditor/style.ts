export const EDITOR_CSS = `
body { padding: 0; overflow: hidden; }
.tex-pad { padding: 16px; }
.tex-app { display: flex; flex-direction: column; height: 100vh; position: relative; }
.tex-toolbar {
  display: flex; align-items: center; gap: 2px; flex-wrap: wrap; padding: 6px 10px;
  border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,.35));
  background: var(--vscode-editorWidget-background, var(--vscode-sideBar-background));
}
.tex-zoom { min-width: 48px; text-align: center; font-size: 12px; font-variant-numeric: tabular-nums; color: var(--vscode-descriptionForeground); }
.tex-body { flex: 1; display: flex; min-height: 0; }
.tex-colors { width: 220px; flex: 0 0 220px; overflow-y: auto; border-right: 1px solid var(--vscode-panel-border, rgba(128,128,128,.35)); }
.tex-side { width: 260px; flex: 0 0 260px; overflow-y: auto; border-left: 1px solid var(--vscode-panel-border, rgba(128,128,128,.35)); }
.tex-panel { padding: 10px 12px; }
.tex-side .tex-panel + .tex-panel { border-top: 1px solid var(--vscode-panel-border, rgba(128,128,128,.35)); }
.tex-center { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; padding: 8px; }
.tex-stage { flex: 1; overflow: auto; display: flex; min-height: 0; }
.tex-canvas { margin: auto; display: block; image-rendering: pixelated; box-shadow: 0 0 0 1px var(--vscode-panel-border, rgba(128,128,128,.5)), 0 4px 18px rgba(0,0,0,.25); touch-action: none; cursor: crosshair; }
.tex-canvas.tool-select { cursor: default; }
.tex-canvas.tool-picker { cursor: copy; }
.tex-canvas.tool-fill { cursor: cell; }
.tex-status { display: flex; gap: 14px; align-items: center; font-size: 12px; color: var(--vscode-descriptionForeground); padding: 2px 4px; flex-wrap: wrap; }
.tex-status .mono { display: inline-flex; align-items: center; gap: 4px; }
.tex-dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; overflow: hidden; vertical-align: middle; flex: 0 0 auto; background-size: 6px 6px; }
.tex-dot > span { display: block; width: 100%; height: 100%; }
.tex-row { display: flex; gap: 4px; align-items: center; flex-wrap: wrap; }
.tex-row-between { display: flex; justify-content: space-between; align-items: center; gap: 6px; margin-bottom: 6px; }
.tex-row-between .tex-section-title { margin: 0; }
.tex-gap { margin-top: 12px; }
.tex-full { width: 100%; margin-bottom: 6px; }
.tex-hint { font-size: 11px; margin-top: 8px; }
.tex-small { font-size: 12px; }

.tex-color-pair { position: relative; height: 64px; margin-bottom: 10px; }
.tex-big-swatch { position: absolute; width: 42px; height: 42px; padding: 0; border: 2px solid var(--vscode-editor-background); outline: 1px solid var(--vscode-widget-border, rgba(128,128,128,.6)); border-radius: 4px; cursor: pointer; background-size: 10px 10px; }
.tex-big-swatch > span { display: block; width: 100%; height: 100%; border-radius: 2px; }
.tex-big-swatch.primary { left: 0; top: 0; z-index: 1; }
.tex-big-swatch.secondary { left: 22px; top: 20px; }
.tex-big-swatch.active { outline: 2px solid var(--vscode-focusBorder); }
.tex-swap { position: absolute; left: 76px; top: 0; }
.tex-color-edit { display: flex; gap: 6px; align-items: center; margin-bottom: 6px; }
.tex-color-edit input[type=color] { width: 36px; height: 26px; padding: 0; border: 1px solid var(--vscode-input-border, rgba(128,128,128,.4)); background: transparent; cursor: pointer; }
.tex-hex { flex: 1; width: 100%; }
.tex-colors .tex-slider { grid-template-columns: 42px 1fr 38px; }
.tex-swatches { display: flex; flex-wrap: wrap; gap: 3px; }
.tex-swatch { padding: 0; border: 1px solid var(--vscode-widget-border, rgba(128,128,128,.5)); border-radius: 2px; cursor: pointer; background-size: 6px 6px; }
.tex-swatch > span { display: block; width: 100%; height: 100%; }
.tex-swatch:hover { outline: 2px solid var(--vscode-focusBorder); outline-offset: 0; z-index: 1; }

.tex-previews { display: flex; flex-direction: column; align-items: center; gap: 10px; }
.tex-preview-canvas { width: 168px; height: 168px; border-radius: 4px; }
.tex-preview-3d { cursor: grab; background: radial-gradient(circle at 50% 40%, rgba(128,128,128,.18), transparent 70%); }

.tex-frames { display: flex; gap: 6px; overflow-x: auto; padding: 2px 2px 6px; margin-bottom: 6px; }
.tex-frame { display: flex; flex-direction: column; align-items: center; gap: 2px; font-size: 10px; cursor: pointer; padding: 3px; border-radius: 4px; border: 1px solid transparent; color: var(--vscode-descriptionForeground); }
.tex-frame:hover { background: var(--vscode-list-hoverBackground); }
.tex-frame.active { border-color: var(--vscode-focusBorder); color: var(--vscode-foreground); }
.tex-frame.playing { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
.tex-frame canvas { background-size: 8px 8px; }
.tex-anim-settings { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; font-size: 12px; }
.tex-field-row { display: flex; gap: 6px; align-items: center; font-size: 12px; flex-wrap: wrap; }
.tex-field-row input[type=number] { width: 64px; }
.tex-field-col { display: flex; flex-direction: column; gap: 3px; font-size: 12px; }
.tex-check { display: inline-flex; gap: 6px; align-items: center; font-size: 12px; cursor: pointer; }
.tex-invalid { outline: 1px solid var(--vscode-inputValidation-errorBorder, #be1100) !important; }

.tex-dialog-layer { position: absolute; top: 52px; right: 276px; z-index: 20; }
.tex-dialog {
  width: 340px; display: flex; flex-direction: column; gap: 8px; padding: 12px 14px;
  background: var(--vscode-editorWidget-background, var(--vscode-sideBar-background));
  color: var(--vscode-editorWidget-foreground, var(--vscode-foreground));
  border: 1px solid var(--vscode-editorWidget-border, var(--vscode-widget-border, rgba(128,128,128,.45)));
  border-radius: 6px; box-shadow: 0 8px 24px var(--vscode-widget-shadow, rgba(0,0,0,.35));
}
.tex-dialog-title { font-weight: 600; margin-bottom: 2px; }
.tex-dialog-buttons { display: flex; gap: 6px; margin-top: 6px; align-items: center; }
.tex-chips { display: flex; flex-wrap: wrap; gap: 4px; }
.tex-radio-list { display: flex; flex-direction: column; gap: 4px; }
.tex-hue-range { background: linear-gradient(90deg, red, yellow, lime, cyan, blue, magenta, red); border-radius: 4px; height: 8px; appearance: none; -webkit-appearance: none; }
.tex-hue-range::-webkit-slider-thumb { -webkit-appearance: none; width: 12px; height: 16px; border-radius: 3px; background: #fff; border: 1px solid #555; }
`;
