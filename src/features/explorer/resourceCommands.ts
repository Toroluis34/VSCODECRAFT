// Context-menu actions of the Resources view: open, reveal, copy id, delete, rename (+ update references).
import * as vscode from 'vscode';
import type { Core } from '../../core/core';
import type { IndexedResource } from '../../core/workspaceIndex';
import { parseRL, resourceRelativePath } from '../../core/resourceLocation';
import { EXCLUDE_GLOB } from '../../core/workspaceIndex';
import { openFile } from '../../core/fsUtils';
import { isValidResourcePath, replaceFunctionReferences, replaceReferences } from './resourceModel';
import type { ResNode } from './resourcesTree';

function resOf(node: ResNode | vscode.Uri | undefined, core: Core): IndexedResource | undefined {
  if (!node) {
    const uri = vscode.window.activeTextEditor?.document.uri;
    return uri ? core.index.info(uri) : undefined;
  }
  if (node instanceof vscode.Uri) return core.index.info(node);
  return node.type === 'file' ? node.res : undefined;
}

export function resourceIdText(res: IndexedResource): string {
  return res.kind.startsWith('tags/') ? `#${res.id}` : res.id;
}

export async function openResource(core: Core, node?: ResNode): Promise<void> {
  const res = resOf(node, core);
  if (res) await openFile(res.uri, { preview: true });
}

export async function revealResource(core: Core, node?: ResNode): Promise<void> {
  const res = resOf(node, core);
  if (res) await vscode.commands.executeCommand('revealInExplorer', res.uri);
}

export async function copyResourceId(core: Core, node?: ResNode): Promise<void> {
  const res = resOf(node, core);
  if (!res) return;
  await vscode.env.clipboard.writeText(resourceIdText(res));
  vscode.window.setStatusBarMessage(vscode.l10n.t('Copied {0}', resourceIdText(res)), 3000);
}

export async function deleteResource(core: Core, node?: ResNode): Promise<void> {
  const res = resOf(node, core);
  if (!res) return;
  const yes = vscode.l10n.t('Delete');
  const pick = await vscode.window.showWarningMessage(
    vscode.l10n.t('Delete {0}?', vscode.workspace.asRelativePath(res.uri)),
    { modal: true, detail: vscode.l10n.t('The file will be moved to the trash when possible.') },
    yes,
  );
  if (pick !== yes) return;
  const targets = [res.uri];
  if (res.kind === 'textures' && res.ext === 'png') targets.push(res.uri.with({ path: res.uri.path + '.mcmeta' }));
  for (const t of targets) {
    try {
      await vscode.workspace.fs.delete(t, { useTrash: true });
    } catch (e) {
      if (t === res.uri) {
        try {
          await vscode.workspace.fs.delete(t, { useTrash: false });
        } catch {
          throw e;
        }
      }
    }
  }
}

/** Rename a resource file (path and/or namespace) and offer to update "ns:old" references in workspace JSON. */
export async function renameResource(core: Core, node?: ResNode): Promise<void> {
  const res = resOf(node, core);
  if (!res) return;
  if (res.kind === 'sounds' && res.path === 'sounds') {
    void vscode.window.showInformationMessage(vscode.l10n.t('sounds.json cannot be renamed.'));
    return;
  }
  const input = await vscode.window.showInputBox({
    title: vscode.l10n.t('Rename resource'),
    prompt: vscode.l10n.t('New id (namespace:path) for {0}', res.id),
    value: res.id,
    valueSelection: [res.namespace.length + 1 + (res.path.lastIndexOf('/') + 1), res.id.length],
    validateInput: (v) => {
      const rl = parseRL(v.trim(), res.namespace);
      if (!/^[a-z0-9_.-]+$/.test(rl.namespace) || !isValidResourcePath(rl.path)) return vscode.l10n.t('Use lowercase letters, digits, _ - . and / only');
      return undefined;
    },
  });
  if (!input) return;
  const rl = parseRL(input.trim(), res.namespace);
  const newId = `${rl.namespace}:${rl.path}`;
  if (newId === res.id) return;
  const rel = resourceRelativePath(res.side, res.folder, newId, res.ext);
  const target = vscode.Uri.joinPath(vscode.Uri.file(res.root), ...rel.split('/'));
  const edit = new vscode.WorkspaceEdit();
  edit.renameFile(res.uri, target, { overwrite: false });
  if (res.kind === 'textures' && res.ext === 'png') {
    const meta = res.uri.with({ path: res.uri.path + '.mcmeta' });
    try {
      await vscode.workspace.fs.stat(meta);
      edit.renameFile(meta, target.with({ path: target.path + '.mcmeta' }), { overwrite: false });
    } catch {
      /* no animation metadata */
    }
  }
  if (!(await vscode.workspace.applyEdit(edit))) {
    void vscode.window.showErrorMessage(vscode.l10n.t('Could not rename {0} (does the target already exist?)', vscode.workspace.asRelativePath(res.uri)));
    return;
  }
  if (res.kind === 'lang' || res.kind === 'sounds') return; // never referenced by id
  await updateReferences(res.id, newId);
}

async function updateReferences(oldId: string, newId: string): Promise<void> {
  const files = await vscode.workspace.findFiles('**/*.{json,mcfunction}', EXCLUDE_GLOB, 20000);
  const changes: { uri: vscode.Uri; text: string; count: number; lines: number }[] = [];
  const decoder = new TextDecoder();
  for (const uri of files) {
    const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
    let text: string;
    try {
      text = open ? open.getText() : decoder.decode(await vscode.workspace.fs.readFile(uri));
    } catch {
      continue;
    }
    if (!text.includes(oldId)) continue;
    const r = uri.path.endsWith('.mcfunction') ? replaceFunctionReferences(text, oldId, newId) : replaceReferences(text, oldId, newId);
    if (r.count) changes.push({ uri, text: r.text, count: r.count, lines: text.split('\n').length });
  }
  if (!changes.length) return;
  const total = changes.reduce((a, c) => a + c.count, 0);
  const yes = vscode.l10n.t('Update references');
  const pick = await vscode.window.showInformationMessage(
    vscode.l10n.t('Found {0} reference(s) to {1} in {2} file(s). Replace them with {3}?', total, oldId, changes.length, newId),
    yes,
    vscode.l10n.t('Skip'),
  );
  if (pick !== yes) return;
  const edit = new vscode.WorkspaceEdit();
  for (const c of changes) edit.replace(c.uri, new vscode.Range(0, 0, c.lines + 1, 0), c.text);
  await vscode.workspace.applyEdit(edit);
  for (const c of changes) {
    const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === c.uri.toString());
    if (doc?.isDirty) await doc.save();
  }
  void vscode.window.showInformationMessage(vscode.l10n.t('Updated {0} reference(s) in {1} file(s).', total, changes.length));
}

