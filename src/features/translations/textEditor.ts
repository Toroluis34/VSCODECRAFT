// Text Component Editor & MOTD preview (webview bundle "text").
import * as vscode from 'vscode';
import type { Core } from '../../core/core';
import type { WebviewHost } from '../../core/webviews';
import { jsonIndent } from '../../core/fsUtils';
import { parseTree } from '../../core/jsonUtils';
import { componentAt, TranslationLookup } from './host';
import { TextComponent, TextFormat } from './textComponent';
import { textFormatFor } from './textFormat';

export interface TextEditorState {
  mode: 'component' | 'motd';
  version: string;
  formats: { id: string; label: string; format: TextFormat }[];
  formatId: string;
  initial: TextComponent | null;
  /** Description of the insertion target (file + range) when opened from a component in a JSON file. */
  target?: string;
  targetIsJson: boolean;
}

const FORMATS: { id: string; label: string; version: string }[] = [
  { id: 'modern', label: '1.21.5+ / 26.x', version: '1.21.5' },
  { id: '1.21.4', label: '1.21.4', version: '1.21.4' },
  { id: 'legacy', label: '1.21 – 1.21.3', version: '1.21' },
];

function formatIdFor(version: string): string {
  const f = textFormatFor(version);
  return f.snakeCaseEvents ? 'modern' : f.shadowColor ? '1.21.4' : 'legacy';
}

let panel: vscode.WebviewPanel | undefined;
let panelHost: WebviewHost | undefined;

export function registerTextEditor(core: Core, lookup: TranslationLookup): void {
  /** Last text editor the user worked in (the webview steals focus). */
  let lastEditor: vscode.TextEditor | undefined = vscode.window.activeTextEditor;
  /** Range of the component the editor was opened from. */
  let target: { uri: vscode.Uri; range: vscode.Range } | undefined;
  core.track(
    vscode.window.onDidChangeActiveTextEditor((e) => {
      if (e) lastEditor = e;
    }),
  );

  const open = async (mode: 'component' | 'motd') => {
    const editor = vscode.window.activeTextEditor ?? lastEditor;
    const uri = editor?.document.uri;
    const version = core.version(uri);
    let initial: TextComponent | null = null;
    target = undefined;
    if (mode === 'component' && editor && /json/.test(editor.document.languageId)) {
      const doc = editor.document;
      const found = componentAt(parseTree(doc), doc.offsetAt(editor.selection.active));
      if (found) {
        initial = found.value;
        target = { uri: doc.uri, range: new vscode.Range(doc.positionAt(found.node.offset), doc.positionAt(found.node.offset + found.node.length)) };
      }
    }
    if (mode === 'motd' && editor) {
      const line = editor.document.lineAt(editor.selection.active.line).text;
      if (/^\s*motd\s*=/.test(line)) initial = line;
    }
    const state: TextEditorState = {
      mode,
      version,
      formats: FORMATS.map((f) => ({ id: f.id, label: f.label, format: textFormatFor(f.version) })),
      formatId: formatIdFor(version),
      initial,
      target: target ? `${vscode.workspace.asRelativePath(target.uri)}:${target.range.start.line + 1}` : undefined,
      targetIsJson: !!target,
    };
    if (panel) {
      panel.reveal(vscode.ViewColumn.Beside);
      if (panelHost && uri) panelHost.documentUri = uri;
      void panelHost?.post('text.state', state);
      return;
    }
    const created = core.webviews.createPanel({
      viewType: 'vscodecraft.translations.textEditor',
      title: mode === 'motd' ? vscode.l10n.t('MOTD Preview') : vscode.l10n.t('Text Component Editor'),
      bundle: 'text',
      state,
      documentUri: uri,
      column: { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
      handlers: {
        'text.copy': async (p: { text: string }) => {
          await vscode.env.clipboard.writeText(p.text);
          void vscode.window.setStatusBarMessage(vscode.l10n.t('Copied to clipboard'), 2000);
        },
        'text.insert': async (p: { text: string; json?: unknown }) => insert(p),
        'text.translate': (p: { keys: string[] }) => lookup.lookup(p.keys, lastEditor?.document.uri),
      },
    });
    panel = created.panel;
    panelHost = created.host;
    panel.onDidDispose(() => (panel = undefined));
  };

  const insert = async (p: { text: string; json?: unknown }) => {
    // Replace the component the editor was opened from (JSON value), else insert at the cursor.
    if (target && p.json !== undefined) {
      const doc = await vscode.workspace.openTextDocument(target.uri);
      const indentUnit = jsonIndent();
      const lineIndent = /^\s*/.exec(doc.lineAt(target.range.start.line).text)?.[0] ?? '';
      const multiline = target.range.start.line !== target.range.end.line;
      const text = multiline ? JSON.stringify(p.json, null, indentUnit).replace(/\n/g, `\n${lineIndent}`) : JSON.stringify(p.json);
      const edit = new vscode.WorkspaceEdit();
      edit.replace(target.uri, target.range, text);
      await vscode.workspace.applyEdit(edit);
      const end = doc.positionAt(doc.offsetAt(target.range.start) + text.length);
      target = { uri: target.uri, range: new vscode.Range(target.range.start, end) };
      await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preserveFocus: true });
      return;
    }
    const editor = lastEditor;
    if (!editor || editor.document.isClosed) {
      void vscode.window.showWarningMessage(vscode.l10n.t('Open a text editor to insert into.'));
      return;
    }
    await editor.edit((b) => editor.selections.forEach((s) => b.replace(s, p.text)));
    await vscode.window.showTextDocument(editor.document, { viewColumn: editor.viewColumn, preserveFocus: true });
  };

  core.registerCommand('vscodecraft.translations.openTextEditor', () => open('component'));
  core.registerCommand('vscodecraft.translations.motdPreview', () => open('motd'));
}
