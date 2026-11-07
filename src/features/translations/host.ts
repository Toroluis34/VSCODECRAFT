// Host-side helpers shared by the translations feature: lang folder discovery, translation lookup,
// text component detection in JSON documents and writing lang files through WorkspaceEdits.
import * as vscode from 'vscode';
import * as jsonc from 'jsonc-parser';
import type { Core } from '../../core/core';
import { jsonIndent } from '../../core/fsUtils';
import { parseLang, serializeLang, LangEntry } from './langFile';

export const LANG_GLOB = '**/assets/*/lang/*.json';

export function cfg<T>(name: string, def: T, uri?: vscode.Uri): T {
  return vscode.workspace.getConfiguration('vscodecraft.translations', uri).get<T>(name, def);
}

/** True for assets/<ns>/lang/<locale>.json */
export function isLangFile(uri: vscode.Uri | undefined): boolean {
  return !!uri && /\/assets\/[^/]+\/lang\/[^/]+\.json$/i.test(uri.path);
}

export function localeOf(uri: vscode.Uri): string {
  return (uri.path.split('/').pop() ?? '').replace(/\.json$/i, '');
}

export function namespaceOfLangFolder(folder: vscode.Uri): string {
  const segs = folder.path.split('/');
  return segs[segs.length - 2] ?? 'minecraft';
}

export function parentFolder(uri: vscode.Uri): vscode.Uri {
  return vscode.Uri.joinPath(uri, '..');
}

/** All lang folders (assets/<ns>/lang) known to the index. */
export async function langFolders(core: Core): Promise<vscode.Uri[]> {
  await core.index.ready;
  const map = new Map<string, vscode.Uri>();
  for (const r of core.index.all('lang')) {
    const f = parentFolder(r.uri);
    map.set(f.toString(), f);
  }
  return [...map.values()];
}

/** Lang files (locale -> uri) present in a folder. */
export async function langFilesIn(folder: vscode.Uri): Promise<Map<string, vscode.Uri>> {
  const out = new Map<string, vscode.Uri>();
  try {
    for (const [name, type] of await vscode.workspace.fs.readDirectory(folder)) {
      if (type === vscode.FileType.File && name.toLowerCase().endsWith('.json')) out.set(name.slice(0, -5), vscode.Uri.joinPath(folder, name));
    }
  } catch {
    /* folder missing */
  }
  return out;
}

/** Read lang entries of a file (open document content preferred). */
export async function readLang(uri: vscode.Uri): Promise<{ entries: LangEntry[]; text: string } | undefined> {
  try {
    const doc = await vscode.workspace.openTextDocument(uri);
    const text = doc.getText();
    return { entries: parseLang(text).entries, text };
  } catch {
    return undefined;
  }
}

/** Pick (or create) a lang folder: from a uri, the active editor, or a quick pick. */
export async function resolveLangFolder(core: Core, arg?: vscode.Uri, placeHolder?: string): Promise<vscode.Uri | undefined> {
  const uri = arg instanceof vscode.Uri ? arg : vscode.window.activeTextEditor?.document.uri;
  if (arg instanceof vscode.Uri && /\/assets\/[^/]+\/lang\/?$/.test(arg.path)) return arg;
  if (uri && isLangFile(uri)) return parentFolder(uri);
  const folders = await langFolders(core);
  // Prefer the folder of the current project's namespace when the active file is in one
  if (folders.length === 1) return folders[0];
  if (folders.length > 1) {
    const items = folders
      .map((f) => ({ label: `$(globe) ${namespaceOfLangFolder(f)}`, description: vscode.workspace.asRelativePath(f), folder: f }))
      .sort((a, b) => a.label.localeCompare(b.label));
    const pick = await vscode.window.showQuickPick(items, { placeHolder: placeHolder ?? vscode.l10n.t('Select a lang folder (namespace)') });
    return pick?.folder;
  }
  // None yet: offer to create en_us.json in the default namespace
  const root = core.projects.resourceRoot(uri);
  if (!root) {
    void vscode.window.showWarningMessage(vscode.l10n.t('No resource folder (assets/) found in the workspace.'));
    return undefined;
  }
  const ns = core.projects.defaultNamespace(uri);
  const create = vscode.l10n.t('Create');
  const ans = await vscode.window.showInformationMessage(
    vscode.l10n.t('No lang files found. Create assets/{0}/lang/en_us.json?', ns),
    create,
  );
  if (ans !== create) return undefined;
  const folder = vscode.Uri.joinPath(root, 'assets', ns, 'lang');
  const file = vscode.Uri.joinPath(folder, 'en_us.json');
  const edit = new vscode.WorkspaceEdit();
  edit.createFile(file, { ignoreIfExists: true, contents: new TextEncoder().encode('{}\n') });
  await vscode.workspace.applyEdit(edit);
  return folder;
}

/** Lang folder that should receive keys of a namespace (existing en_us preferred, else created under the resource root). */
export async function langFolderForNamespace(core: Core, ns: string, near?: vscode.Uri): Promise<vscode.Uri | undefined> {
  await core.index.ready;
  const existing = core.index.all('lang').filter((r) => r.namespace === ns);
  const main = core.projects.projectFor(near)?.mainResourceRoot;
  const pick =
    existing.find((r) => r.path === 'en_us' && main && r.uri.fsPath.startsWith(main.fsPath)) ??
    existing.find((r) => r.path === 'en_us' && !/[\\/](generated)[\\/]/.test(r.uri.fsPath)) ??
    existing.find((r) => r.path === 'en_us') ??
    existing[0];
  if (pick) return parentFolder(pick.uri);
  const root = core.projects.resourceRoot(near);
  return root ? vscode.Uri.joinPath(root, 'assets', ns, 'lang') : undefined;
}

// ---------------------------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------------------------

export interface FileChange {
  uri: vscode.Uri;
  /** New full text. */
  text: string;
  /** Previous text (undefined when the file is created). */
  before?: string;
}

/** Apply full-text changes (creating files when needed) as ONE workspace edit. */
export async function applyChanges(changes: FileChange[], opts: { save?: boolean; keepDirty?: vscode.Uri[] } = {}): Promise<boolean> {
  if (!changes.length) return true;
  const edit = new vscode.WorkspaceEdit();
  for (const c of changes) {
    if (c.before === undefined) {
      edit.createFile(c.uri, { ignoreIfExists: true, overwrite: false, contents: new TextEncoder().encode(c.text) });
    } else {
      const doc = await vscode.workspace.openTextDocument(c.uri);
      if (doc.getText() === c.text) continue;
      edit.replace(c.uri, new vscode.Range(0, 0, doc.lineCount, 0), c.text);
    }
  }
  const ok = await vscode.workspace.applyEdit(edit);
  if (ok && opts.save) {
    const keep = new Set((opts.keepDirty ?? []).map((u) => u.toString()));
    for (const c of changes) {
      if (keep.has(c.uri.toString()) || c.before === undefined) continue;
      const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === c.uri.toString());
      // Leave documents the user is editing in a text editor dirty (they save them themselves).
      const visible = vscode.window.visibleTextEditors.some((e) => e.document.uri.toString() === c.uri.toString());
      if (doc?.isDirty && !visible) await doc.save();
    }
  }
  return ok;
}

/** Serialize entries the way the user's file is formatted (detected indentation / EOL, optional sorting). */
export function serializeLike(previousText: string | undefined, entries: LangEntry[], sort: boolean): string {
  if (previousText === undefined) return serializeLang(entries, { indent: jsonIndent(), sort });
  const p = parseLang(previousText, jsonIndent());
  return serializeLang(entries, { indent: p.indent, eol: p.eol, sort });
}

/** Minimal edit of one existing key's value (keeps the rest of the file untouched). */
export function setValueText(text: string, key: string, value: string): string {
  const edits = jsonc.modify(text, [key], value, { formattingOptions: { insertSpaces: true, tabSize: 2, eol: text.includes('\r\n') ? '\r\n' : '\n' } });
  return jsonc.applyEdits(text, edits);
}

// ---------------------------------------------------------------------------------------------
// Translation lookup (vanilla en_us + workspace lang) for previews
// ---------------------------------------------------------------------------------------------

export class TranslationLookup implements vscode.Disposable {
  private cache = new Map<string, Promise<Map<string, string>>>();
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly core: Core) {
    const reset = () => this.cache.clear();
    this.disposables.push(
      core.index.onDidChange(reset),
      core.index.onDidChangeContent((u) => u.path.includes('/lang/') && reset()),
      core.projects.onDidChange(reset),
      core.vanilla.onDidDownload(reset),
    );
  }

  /** key -> text map for a locale (vanilla + workspace, workspace wins). */
  map(uri?: vscode.Uri, locale = 'en_us'): Promise<Map<string, string>> {
    const version = this.core.version(uri);
    const k = `${version}|${locale}`;
    let p = this.cache.get(k);
    if (!p) {
      p = (async () => {
        const out = new Map<string, string>();
        try {
          for (const [a, b] of Object.entries(await this.core.vanilla.lang(version, locale))) out.set(a, b);
        } catch {
          if (locale === 'en_us') for (const [a, b] of Object.entries(this.core.vanilla.bundledData(version).lang)) out.set(a, b);
        }
        for (const [a, b] of Object.entries(await this.core.index.lang(locale))) out.set(a, b);
        if (locale !== 'en_us' && !out.size) return this.map(uri, 'en_us');
        return out;
      })();
      this.cache.set(k, p);
    }
    return p;
  }

  async lookup(keys: string[], uri?: vscode.Uri, locale = 'en_us'): Promise<Record<string, string>> {
    const m = await this.map(uri, locale);
    const out: Record<string, string> = {};
    for (const k of keys) {
      const v = m.get(k);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
  }
}

export { componentAt } from './jsonComponents';
