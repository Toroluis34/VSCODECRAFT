// Host helpers shared by the datapack feature.
import * as vscode from 'vscode';
import type { Core } from '../../core/core';
import { exists, readText } from '../../core/fsUtils';
import { jsonc } from '../../core/jsonUtils';
import { compareVersions, getVersions, McVersion } from '../../core/versions';
import { PackKind, versionFormat, fmtToString } from './packFormat';

export const t = vscode.l10n.t;

/** Every known version (releases and snapshots), newest first. */
export function versionTable(): McVersion[] {
  return getVersions(true);
}

export async function readJsonc(uri: vscode.Uri): Promise<{ text: string; value: any; ok: boolean } | undefined> {
  const text = await readText(uri);
  if (text === undefined) return undefined;
  const errors: jsonc.ParseError[] = [];
  const value = jsonc.parse(text, errors, { allowTrailingComma: true });
  return { text, value, ok: errors.length === 0 };
}

/** Pack kinds of a pack root, from its folders (both for mod resources). */
export async function packKinds(root: vscode.Uri): Promise<PackKind[]> {
  const data = await exists(vscode.Uri.joinPath(root, 'data'));
  const assets = await exists(vscode.Uri.joinPath(root, 'assets'));
  if (data && assets) return ['data', 'resource'];
  if (assets) return ['resource'];
  return ['data'];
}

export const kindLabel = (k: PackKind): string => (k === 'data' ? t('Data pack') : t('Resource pack'));

/**
 * Resolve the resource root to work on: explicit uri (folder or a file inside a pack), the active editor's
 * root, the only project, or ask the user.
 */
export async function pickResourceRoot(core: Core, uri?: vscode.Uri, placeHolder?: string): Promise<vscode.Uri | undefined> {
  if (uri) {
    let stat: vscode.FileStat | undefined;
    try {
      stat = await vscode.workspace.fs.stat(uri);
    } catch {
      stat = undefined;
    }
    if (stat?.type === vscode.FileType.Directory) {
      if (/\/(data|assets)\/?$/.test(uri.path)) return vscode.Uri.joinPath(uri, '..');
      if ((await exists(vscode.Uri.joinPath(uri, 'data'))) || (await exists(vscode.Uri.joinPath(uri, 'assets'))) || (await exists(vscode.Uri.joinPath(uri, 'pack.mcmeta')))) return uri;
    }
    const info = core.index.info(uri);
    if (info) return vscode.Uri.file(info.root);
    if (uri.path.endsWith('/pack.mcmeta')) return vscode.Uri.joinPath(uri, '..');
    if (stat?.type === vscode.FileType.Directory) return uri;
  }
  const active = vscode.window.activeTextEditor?.document.uri;
  if (!uri && active) {
    const info = core.index.info(active);
    if (info) return vscode.Uri.file(info.root);
    if (active.path.endsWith('/pack.mcmeta')) return vscode.Uri.joinPath(active, '..');
  }
  await core.projects.ready;
  const roots = new Map<string, { uri: vscode.Uri; project: string }>();
  for (const p of core.projects.projects) for (const r of p.resourceRoots) roots.set(r.fsPath, { uri: r, project: p.name });
  for (const r of core.index.roots()) if (!roots.has(vscode.Uri.file(r).fsPath)) roots.set(vscode.Uri.file(r).fsPath, { uri: vscode.Uri.file(r), project: '' });
  const list = [...roots.values()];
  if (list.length === 1) return list[0].uri;
  if (list.length === 0) {
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!folder) return undefined;
    const pick = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, defaultUri: folder, openLabel: t('Select pack folder') });
    return pick?.[0];
  }
  const pick = await vscode.window.showQuickPick(
    list.map((r) => ({ label: vscode.workspace.asRelativePath(r.uri), description: r.project, uri: r.uri })),
    { placeHolder: placeHolder ?? t('Select the pack / resources folder') },
  );
  return pick?.uri;
}

/** Version QuickPick (releases first, then recent snapshots). */
export async function pickVersion(title: string, opts: { current?: string; min?: string; kind?: PackKind } = {}): Promise<string | undefined> {
  type Item = vscode.QuickPickItem & { id?: string };
  const fmt = (v: McVersion) =>
    opts.kind ? `${kindLabel(opts.kind)} ${fmtToString(versionFormat(v, opts.kind))}` : `data ${fmtToString(versionFormat(v, 'data'))} · resources ${fmtToString(versionFormat(v, 'resource'))}`;
  const ok = (v: McVersion) => !opts.min || compareVersions(v.id, opts.min) >= 0;
  const items: Item[] = [
    ...versionTable()
      .filter((v) => v.type === 'release' && ok(v))
      .map((v) => ({ label: v.id, description: fmt(v), id: v.id, picked: v.id === opts.current })),
    { label: t('Snapshots'), kind: vscode.QuickPickItemKind.Separator },
    ...versionTable()
      .filter((v) => v.type !== 'release' && ok(v))
      .map((v) => ({ label: v.id, description: fmt(v), id: v.id })),
  ];
  const cur = items.find((i) => i.id === opts.current);
  if (cur) cur.description = `${cur.description} · ${t('current')}`;
  const pick = await vscode.window.showQuickPick(items, { title, placeHolder: title, matchOnDescription: true });
  return pick?.id;
}

/** Write text to a file: through the open document when there is one (undoable), else on disk. */
export async function writeTextSmart(uri: vscode.Uri, text: string): Promise<void> {
  const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
  if (doc) {
    const edit = new vscode.WorkspaceEdit();
    edit.replace(uri, new vscode.Range(0, 0, doc.lineCount, 0), text);
    await vscode.workspace.applyEdit(edit);
    await doc.save();
    return;
  }
  await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, '..'));
  await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(text));
}

/** Relative path (forward slashes) of a file inside a root. */
export function relPath(root: vscode.Uri, file: vscode.Uri): string {
  const r = root.path.endsWith('/') ? root.path : root.path + '/';
  return file.path.startsWith(r) ? file.path.slice(r.length) : file.path;
}

/** Recursively list files under a folder (skips junk folders). */
export async function listFiles(dir: vscode.Uri, max = 50000): Promise<vscode.Uri[]> {
  const out: vscode.Uri[] = [];
  const walk = async (d: vscode.Uri): Promise<void> => {
    let entries: [string, vscode.FileType][] = [];
    try {
      entries = await vscode.workspace.fs.readDirectory(d);
    } catch {
      return;
    }
    for (const [name, type] of entries) {
      if (out.length >= max) return;
      const u = vscode.Uri.joinPath(d, name);
      if (type & vscode.FileType.Directory) {
        if (['.git', 'node_modules', '.gradle', 'build', '.idea', '__MACOSX'].includes(name)) continue;
        await walk(u);
      } else out.push(u);
    }
  };
  await walk(dir);
  return out;
}

export function indentOf(text: string): number | string {
  const m = /\n([ \t]+)\S/.exec(text);
  if (!m) return 2;
  return m[1].includes('\t') ? '\t' : m[1].length;
}
