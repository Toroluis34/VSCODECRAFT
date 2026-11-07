// Inline decorations for § formatting codes in lang files: a coloured square before colour codes,
// and bold/italic/underline/strikethrough styling of the formatting codes themselves.
import * as vscode from 'vscode';
import type { Core } from '../../core/core';
import { isLangFile } from './host';
import { NAMED_COLORS } from './textComponent';

const CODE_RE = /(?:§|\\u00[aA]7)([0-9a-fk-orA-FK-OR])/g;

export function registerDecorations(core: Core): void {
  const colorTypes = new Map<string, vscode.TextEditorDecorationType>();
  for (const c of NAMED_COLORS) {
    colorTypes.set(
      c.code,
      vscode.window.createTextEditorDecorationType({
        before: { contentText: '■', color: c.hex, margin: '0 1px 0 0', border: '1px solid rgba(128,128,128,0.4)' },
        color: c.hex,
      }),
    );
  }
  const fmt: Record<string, vscode.DecorationRenderOptions> = {
    l: { fontWeight: 'bold' },
    o: { fontStyle: 'italic' },
    n: { textDecoration: 'underline' },
    m: { textDecoration: 'line-through' },
    k: { opacity: '0.6', textDecoration: 'underline wavy' },
    r: { opacity: '0.6' },
  };
  const fmtTypes = new Map(Object.entries(fmt).map(([k, o]) => [k, vscode.window.createTextEditorDecorationType(o)]));
  core.track(...colorTypes.values(), ...fmtTypes.values());

  const enabled = (uri: vscode.Uri) => vscode.workspace.getConfiguration('vscodecraft.translations', uri).get('decorations', true);

  const update = (editor: vscode.TextEditor) => {
    const doc = editor.document;
    const ranges = new Map<string, vscode.Range[]>();
    if (isLangFile(doc.uri) && enabled(doc.uri) && doc.lineCount < 50000) {
      const text = doc.getText();
      for (const m of text.matchAll(CODE_RE)) {
        const code = m[1].toLowerCase();
        const r = new vscode.Range(doc.positionAt(m.index!), doc.positionAt(m.index! + m[0].length));
        const list = ranges.get(code) ?? [];
        list.push(r);
        ranges.set(code, list);
      }
    }
    for (const [code, t] of [...colorTypes, ...fmtTypes]) editor.setDecorations(t, ranges.get(code) ?? []);
  };

  let timer: NodeJS.Timeout | undefined;
  const updateVisible = () => {
    clearTimeout(timer);
    timer = setTimeout(() => vscode.window.visibleTextEditors.forEach(update), 150);
  };
  core.track(
    vscode.window.onDidChangeVisibleTextEditors(updateVisible),
    vscode.workspace.onDidChangeTextDocument((e) => isLangFile(e.document.uri) && updateVisible()),
    vscode.workspace.onDidChangeConfiguration((e) => e.affectsConfiguration('vscodecraft.translations.decorations') && updateVisible()),
  );
  updateVisible();
}
