// Host side of the recipe webviews: state for a document, RPC handlers, editing a document from a webview.
import * as vscode from 'vscode';
import type { Core } from '../../core/core';
import type { WebviewHost } from '../../core/webviews';
import { classifyPath, parseRL } from '../../core/resourceLocation';
import { dataFolder } from '../../core/versions';
import { applyJsonModifications, formatJson, jsonc, replaceDocument } from '../../core/jsonUtils';
import { createFile, jsonIndent, stringifyJson } from '../../core/fsUtils';
import { jsonDiff, migrateRecipe, recipeFormatFor } from './recipeModel';
import type { CheckIdsResult, RecipeViewState } from './protocol';

export const EDITOR_VIEW_TYPE = 'vscodecraft.recipeEditor';

/** True for data/<ns>/recipe(s)/**.json files. */
export function isRecipeUri(uri: vscode.Uri | undefined): boolean {
  if (!uri || !uri.path.toLowerCase().endsWith('.json')) return false;
  const info = classifyPath(uri.fsPath);
  return !!info && info.side === 'data' && info.kind === 'recipe';
}

export function recipeIdOf(uri: vscode.Uri): string {
  return classifyPath(uri.fsPath)?.id ?? uri.path.split('/').pop()!.replace(/\.json$/i, '');
}

export function parseText(text: string): { json: unknown; error?: string } {
  const errors: jsonc.ParseError[] = [];
  const json = jsonc.parse(text, errors, { allowTrailingComma: true, disallowComments: false });
  if (!errors.length) return { json };
  const e = errors[0];
  const line = text.slice(0, e.offset).split('\n').length;
  return { json, error: vscode.l10n.t('JSON syntax error ({0}) at line {1}', jsonc.printParseErrorCode(e.error), line) };
}

export function documentState(core: Core, doc: vscode.TextDocument, mode: RecipeViewState['mode']): RecipeViewState {
  const version = core.version(doc.uri);
  const { json, error } = parseText(doc.getText());
  return {
    mode,
    id: recipeIdOf(doc.uri),
    uri: doc.uri.toString(),
    fileName: vscode.workspace.asRelativePath(doc.uri),
    version,
    fmt: recipeFormatFor(version),
    json: json ?? null,
    parseError: error,
    readOnly: false,
    defaultNamespace: core.projects.defaultNamespace(doc.uri),
  };
}

/** Apply a new recipe json to a document with minimal edits (keeps formatting, comments and unknown fields). */
export async function writeRecipe(doc: vscode.TextDocument, json: unknown): Promise<boolean> {
  const current = parseText(doc.getText());
  if (current.error) throw new Error(current.error);
  const mods = jsonDiff(current.json, json);
  if (!mods.length) return true;
  if (mods.some((m) => m.path.length === 0) || typeof current.json !== 'object' || current.json === null) {
    return replaceDocument(doc, formatJson(json, doc.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n'));
  }
  return applyJsonModifications(doc, mods);
}

const SHARED_NAMESPACES = new Set(['c', 'forge', 'neoforge', 'fabric', 'quilt', 'common']);

/** Item ids / tags that do not exist (only checked for minecraft and workspace namespaces). */
export async function checkIds(core: Core, uri: vscode.Uri | undefined, items: string[], tags: string[]): Promise<CheckIdsResult> {
  const known = new Set(core.index.namespaces());
  known.add('minecraft');
  for (const n of core.projects.projectFor(uri)?.namespaces ?? []) known.add(n);
  const checkable = (id: string) => {
    const ns = parseRL(id).namespace;
    return known.has(ns) && !SHARED_NAMESPACES.has(ns);
  };
  const out: CheckIdsResult = { unknownItems: [], unknownTags: [] };
  if (items.some(checkable)) {
    const ids = await core.registries.ids('item', uri);
    out.unknownItems = items.filter((i) => checkable(i) && !ids.has(i));
  }
  if (tags.some(checkable)) {
    const ids = await core.registries.ids('tag/item', uri);
    out.unknownTags = tags.filter((t) => checkable(t) && !ids.has(t));
  }
  return out;
}

const tagIndexCache = new Map<string, { at: number; map: Promise<Map<string, string[]>> }>();

/** item id -> tags containing it (cached for a minute per version). */
async function tagIndex(core: Core, uri: vscode.Uri | undefined): Promise<Map<string, string[]>> {
  const version = core.version(uri);
  const hit = tagIndexCache.get(version);
  if (hit && Date.now() - hit.at < 60_000) return hit.map;
  const map = (async () => {
    const out = new Map<string, string[]>();
    for (const tag of await core.registries.ids('tag/item', uri)) {
      for (const item of await core.registries.expandTag(tag, 'item', uri)) {
        let l = out.get(item);
        if (!l) out.set(item, (l = []));
        l.push(`#${tag}`);
      }
    }
    return out;
  })();
  tagIndexCache.set(version, { at: Date.now(), map });
  return map;
}

export async function tagsOf(core: Core, uri: vscode.Uri | undefined, id: string): Promise<string[]> {
  const list = (await tagIndex(core, uri)).get(id) ?? [];
  return [...list].sort((a, b) => a.length - b.length || a.localeCompare(b));
}

/** Migrate one open recipe document to its target version (with split files written next to it). */
export async function migrateDocument(core: Core, doc: vscode.TextDocument): Promise<void> {
  const { json, error } = parseText(doc.getText());
  if (error || !json || typeof json !== 'object') throw new Error(error ?? vscode.l10n.t('The file is not a JSON object.'));
  const version = core.version(doc.uri);
  const name = doc.uri.path.split('/').pop()!.replace(/\.json$/i, '');
  const res = migrateRecipe(json as Record<string, any>, recipeFormatFor(version), name);
  const notes = res.notes.map((n) => vscode.l10n.t(n.message, ...(n.args ?? []).map(String)));
  if (!res.changed) {
    void vscode.window.showInformationMessage(
      notes.length ? notes.join(' ') : vscode.l10n.t('The recipe already uses the format of Minecraft {0}.', version),
    );
    return;
  }
  await writeRecipe(doc, res.json);
  for (const e of res.extra) {
    const target = vscode.Uri.joinPath(doc.uri, '..', `${e.name}.json`);
    await createFile(target, stringifyJson(e.json, jsonIndent()), 'ask');
  }
  void vscode.window.showInformationMessage(
    [vscode.l10n.t('Recipe migrated to Minecraft {0}.', version), ...notes].join(' '),
  );
}

/** Copy a vanilla recipe into the default namespace of the project and open it. */
export async function copyToMod(core: Core, id: string, json: unknown, context?: vscode.Uri): Promise<void> {
  const root = core.projects.resourceRoot(context);
  if (!root) throw new Error(vscode.l10n.t('Open a mod project or data pack folder first.'));
  const version = core.version(root);
  const ns = core.projects.defaultNamespace(context ?? root);
  const path = parseRL(id).path;
  const target = vscode.Uri.joinPath(root, 'data', ns, dataFolder('recipe', version), `${path}.json`);
  const migrated = migrateRecipe(json as Record<string, any>, recipeFormatFor(version), path.split('/').pop());
  if (await createFile(target, stringifyJson(migrated.json, jsonIndent()), 'ask')) {
    await vscode.commands.executeCommand('vscode.openWith', target, EDITOR_VIEW_TYPE);
  }
}

/** RPC handlers shared by the custom editor and the side preview. `getDoc` returns the bound document. */
export function registerDocumentHandlers(core: Core, host: WebviewHost, getDoc: () => vscode.TextDocument | undefined): void {
  const need = () => {
    const d = getDoc();
    if (!d) throw new Error(vscode.l10n.t('No recipe file is open.'));
    return d;
  };
  host.handle('recipe.edit', async (p: { json: unknown }) => writeRecipe(need(), p.json));
  host.handle('recipe.checkIds', (p: { items: string[]; tags: string[] }) => checkIds(core, getDoc()?.uri, p.items ?? [], p.tags ?? []));
  host.handle('recipe.tagsOf', (p: { id: string }) => tagsOf(core, getDoc()?.uri, p.id));
  host.handle('recipe.migrate', () => migrateDocument(core, need()));
  host.handle('recipe.openText', async () => {
    const d = need();
    await vscode.window.showTextDocument(d, { viewColumn: vscode.ViewColumn.Beside, preview: false });
  });
  host.handle('recipe.openEditor', async () => {
    await vscode.commands.executeCommand('vscode.openWith', need().uri, EDITOR_VIEW_TYPE);
  });
}

/** Debounced "recipe.update" pushes for document changes. */
export function pushOnChange(core: Core, host: WebviewHost, getDoc: () => vscode.TextDocument | undefined, mode: RecipeViewState['mode']): vscode.Disposable {
  let timer: NodeJS.Timeout | undefined;
  const post = () => {
    const d = getDoc();
    if (d) void host.post('recipe.update', documentState(core, d, mode));
  };
  const sub = vscode.workspace.onDidChangeTextDocument((e) => {
    if (e.document !== getDoc() || !e.contentChanges.length) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(post, 120);
  });
  const sub2 = core.projects.onDidChange(() => post());
  return new vscode.Disposable(() => {
    if (timer) clearTimeout(timer);
    sub.dispose();
    sub2.dispose();
  });
}
