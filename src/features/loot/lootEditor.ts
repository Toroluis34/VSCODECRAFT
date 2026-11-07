// Loot table viewer/editor: CustomTextEditor, side preview, vanilla browser and "copy to my mod".
import * as vscode from 'vscode';
import type { Core } from '../../core/core';
import type { WebviewHost } from '../../core/webviews';
import { parseDocument, replaceDocument } from '../../core/jsonUtils';
import { createFile, jsonIndent, stringifyJson } from '../../core/fsUtils';
import { dataFolder } from '../../core/versions';
import { parseRL } from '../../core/resourceLocation';
import { detectLootFormat } from './lootModel';
import type { LootViewState } from './protocol';
import { applyLootEdit, FormatOptions, LootEditOp } from './lootEdit';

export const LOOT_EDITOR_VIEW_TYPE = 'vscodecraft.loot.editor';

export function isLootTableUri(uri: vscode.Uri): boolean {
  return /[\\/]data[\\/][^\\/]+[\\/]loot_tables?[\\/].+\.json$/i.test(uri.fsPath);
}

function lootIdOf(core: Core, uri: vscode.Uri): string {
  return core.index.info(uri)?.id ?? uri.path.split('/').pop()?.replace(/\.json$/, '') ?? '?';
}

function documentState(core: Core, doc: vscode.TextDocument): LootViewState {
  const version = core.version(doc.uri);
  let json: unknown;
  let parseError = false;
  try {
    json = parseDocument(doc) ?? {};
  } catch {
    json = {};
    parseError = true;
  }
  return {
    mode: 'file',
    id: lootIdOf(core, doc.uri),
    version,
    format: detectLootFormat(json, version),
    json,
    readOnly: false,
    uri: doc.uri.toString(),
    parseError,
  };
}

function formatOptions(doc: vscode.TextDocument): FormatOptions {
  const indent = jsonIndent();
  return {
    insertSpaces: typeof indent === 'number',
    tabSize: typeof indent === 'number' ? indent : 4,
    eol: doc.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n',
  };
}

/** Find a loot table JSON by id: workspace first, then vanilla. */
async function resolveTable(core: Core, id: string, uri?: vscode.Uri): Promise<unknown> {
  const full = id.includes(':') ? id : `minecraft:${id}`;
  const ws = core.index.find('loot_table', full);
  if (ws) return core.index.json(ws);
  const tables = await core.vanilla.lootTables(core.version(uri)).catch(() => ({}) as Record<string, unknown>);
  return tables[full] ?? null;
}

/** RPC handlers shared by every loot webview. */
function registerHandlers(core: Core, host: WebviewHost, getDoc: () => vscode.TextDocument | undefined, getState: () => LootViewState): void {
  host.handle('loot.edit', async (p: { ops: LootEditOp[] }) => {
    const doc = getDoc();
    if (!doc) throw new Error(vscode.l10n.t('This loot table is read-only.'));
    const state = documentState(core, doc);
    let text = doc.getText();
    for (const op of p.ops) text = applyLootEdit(text, op, state.format, formatOptions(doc));
    return replaceDocument(doc, text);
  });
  host.handle('loot.tables', async (p: { ids: string[] }) => {
    const out: Record<string, unknown> = {};
    for (const id of p.ids ?? []) out[id] = await resolveTable(core, id, host.documentUri);
    return out;
  });
  host.handle('loot.openTable', async (p: { id: string }) => {
    const full = p.id.includes(':') ? p.id : `minecraft:${p.id}`;
    const ws = core.index.find('loot_table', full);
    if (ws) return vscode.commands.executeCommand('vscode.openWith', ws, LOOT_EDITOR_VIEW_TYPE, vscode.ViewColumn.Beside);
    const version = core.version(host.documentUri);
    const json = (await core.vanilla.lootTables(version))[full];
    if (!json) {
      void vscode.window.showWarningMessage(vscode.l10n.t('Loot table {0} was not found.', full));
      return;
    }
    openVanillaPanel(core, full, json, version);
  });
  host.handle('loot.openText', async () => {
    const doc = getDoc();
    if (doc) await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside });
    else {
      const s = getState();
      const d = await vscode.workspace.openTextDocument({ language: 'json', content: stringifyJson(s.json, jsonIndent()) });
      await vscode.window.showTextDocument(d, { viewColumn: vscode.ViewColumn.Beside });
    }
  });
  host.handle('loot.copyToMod', async () => {
    const s = getState();
    await copyToMod(core, s.id, s.json, s.version);
  });
}

function pushOnChange(core: Core, host: WebviewHost, getDoc: () => vscode.TextDocument | undefined): vscode.Disposable {
  let timer: NodeJS.Timeout | undefined;
  return vscode.workspace.onDidChangeTextDocument((e) => {
    if (e.document !== getDoc() || !e.contentChanges.length) return;
    clearTimeout(timer);
    timer = setTimeout(() => void host.post('loot.update', documentState(core, e.document)), 150);
  });
}

export class LootTableEditorProvider implements vscode.CustomTextEditorProvider {
  constructor(private readonly core: Core) {}

  resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): void {
    const core = this.core;
    const host = core.webviews.attach(panel.webview, {
      bundle: 'loot',
      documentUri: document.uri,
      state: documentState(core, document),
      title: lootIdOf(core, document.uri),
    });
    registerHandlers(core, host, () => document, () => documentState(core, document));
    const sub = pushOnChange(core, host, () => document);
    panel.onDidDispose(() => {
      sub.dispose();
      host.dispose();
    });
  }
}

const previews = new Map<string, vscode.WebviewPanel>();

/** Side preview (webview panel) for a loot table text document. */
export async function showLootPreview(core: Core, uri: vscode.Uri): Promise<void> {
  const existing = previews.get(uri.toString());
  if (existing) {
    existing.reveal(vscode.ViewColumn.Beside, true);
    return;
  }
  const doc = await vscode.workspace.openTextDocument(uri);
  const id = lootIdOf(core, uri);
  const { panel, host } = core.webviews.createPanel({
    viewType: 'vscodecraft.loot.preview',
    title: vscode.l10n.t('Loot: {0}', id.split(':').pop() ?? id),
    bundle: 'loot',
    documentUri: uri,
    state: documentState(core, doc),
    column: { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
  });
  previews.set(uri.toString(), panel);
  registerHandlers(core, host, () => doc, () => documentState(core, doc));
  const sub = pushOnChange(core, host, () => doc);
  panel.onDidDispose(() => {
    previews.delete(uri.toString());
    sub.dispose();
  });
}

/** Read-only panel for a vanilla loot table. */
export function openVanillaPanel(core: Core, id: string, json: unknown, version: string): void {
  const state: LootViewState = {
    mode: 'vanilla',
    id,
    version,
    format: detectLootFormat(json, version),
    json,
    readOnly: true,
  };
  const { host } = core.webviews.createPanel({
    viewType: 'vscodecraft.loot.vanilla',
    title: vscode.l10n.t('Loot: {0} ({1})', id.replace(/^minecraft:/, ''), version),
    bundle: 'loot',
    state,
  });
  registerHandlers(core, host, () => undefined, () => state);
}

/** "Open vanilla loot table…" */
export async function openVanillaCommand(core: Core): Promise<void> {
  const version = core.version();
  const tables = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: vscode.l10n.t('Loading Minecraft {0} loot tables…', version) },
    () => core.vanilla.lootTables(version),
  );
  const keys = Object.keys(tables).sort();
  if (!keys.length) {
    void vscode.window.showWarningMessage(vscode.l10n.t('Vanilla loot tables for {0} could not be downloaded.', version));
    return;
  }
  const pick = await vscode.window.showQuickPick(
    keys.map((k) => {
      const path = k.replace(/^minecraft:/, '');
      const slash = path.lastIndexOf('/');
      return { label: path.slice(slash + 1), description: slash > 0 ? path.slice(0, slash) : '', id: k };
    }),
    { placeHolder: vscode.l10n.t('Vanilla loot table ({0})', version), matchOnDescription: true },
  );
  if (!pick) return;
  openVanillaPanel(core, pick.id, tables[pick.id], version);
}

/** Copy a (vanilla) loot table into the project: override it or copy it under the mod namespace. */
export async function copyToMod(core: Core, id: string, json: unknown, version: string): Promise<void> {
  const root = core.projects.resourceRoot();
  if (!root) {
    void vscode.window.showWarningMessage(vscode.l10n.t('No Minecraft project found in this workspace.'));
    return;
  }
  const rl = parseRL(id);
  const ns = core.projects.defaultNamespace(root);
  const choice = await vscode.window.showQuickPick(
    [
      {
        label: vscode.l10n.t('Override the vanilla table'),
        description: `${rl.namespace}:${rl.path}`,
        detail: vscode.l10n.t('Replaces the vanilla drops when your mod/datapack is loaded.'),
        target: `${rl.namespace}:${rl.path}`,
      },
      {
        label: vscode.l10n.t('Copy into my namespace'),
        description: `${ns}:${rl.path}`,
        detail: vscode.l10n.t('A new table you can reference from your own code or data.'),
        target: `${ns}:${rl.path}`,
      },
    ],
    { placeHolder: vscode.l10n.t('Where should the loot table be copied?') },
  );
  if (!choice) return;
  const t = parseRL(choice.target);
  const target = vscode.Uri.joinPath(root, 'data', t.namespace, dataFolder('loot_table', core.version(root)), `${t.path}.json`);
  const data = { ...(json as Record<string, unknown>) };
  if (t.namespace !== rl.namespace && typeof data.random_sequence === 'string') data.random_sequence = choice.target;
  if (await createFile(target, stringifyJson(data, jsonIndent()))) {
    if (version !== core.version(root))
      void vscode.window.showInformationMessage(
        vscode.l10n.t('Copied from Minecraft {0}; your project targets {1}. Check the format.', version, core.version(root)),
      );
    await vscode.commands.executeCommand('vscode.openWith', target, LOOT_EDITOR_VIEW_TYPE);
  }
}
