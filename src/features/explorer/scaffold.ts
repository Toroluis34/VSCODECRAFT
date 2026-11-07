// Scaffolding commands: Create Datapack…, Create Resource Pack…, mod project generation.
import * as vscode from 'vscode';
import type { Core } from '../../core/core';
import { toResourcePath } from '../../core/resourceLocation';
import { compareVersions, getFeatures, getVersions } from '../../core/versions';
import { isValidNamespace, PackKind, packFiles } from './packTemplates';
import { generateModProject, ModProjectOptions } from './modTemplate';

/** Releases the extension supports (1.21+), newest first. */
export function supportedReleases(): string[] {
  return getVersions(false)
    .map((v) => v.id)
    .filter((id) => compareVersions(id, '1.21') >= 0);
}

export async function writeFiles(root: vscode.Uri, files: Record<string, string | Uint8Array>): Promise<void> {
  const enc = new TextEncoder();
  for (const [rel, content] of Object.entries(files)) {
    const uri = vscode.Uri.joinPath(root, ...rel.split('/'));
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, '..'));
    await vscode.workspace.fs.writeFile(uri, typeof content === 'string' ? enc.encode(content) : content);
  }
}

async function isNonEmptyDir(uri: vscode.Uri): Promise<boolean> {
  try {
    return (await vscode.workspace.fs.readDirectory(uri)).length > 0;
  } catch {
    return false;
  }
}

/** After creating a project folder: open it, add it to the workspace or just reveal it. */
export async function offerOpen(folder: vscode.Uri, fileToShow?: vscode.Uri): Promise<void> {
  const inWorkspace = !!vscode.workspace.getWorkspaceFolder(folder);
  if (inWorkspace) {
    if (fileToShow) await vscode.window.showTextDocument(fileToShow, { preview: false });
    void vscode.commands.executeCommand('revealInExplorer', folder);
    void vscode.commands.executeCommand('vscodecraft.refreshProjects');
    return;
  }
  const open = vscode.l10n.t('Open Folder');
  const newWindow = vscode.l10n.t('Open in New Window');
  const add = vscode.l10n.t('Add to Workspace');
  const pick = await vscode.window.showInformationMessage(vscode.l10n.t('Created {0}', folder.fsPath), open, newWindow, add);
  if (pick === open) await vscode.commands.executeCommand('vscode.openFolder', folder, { forceNewWindow: false });
  else if (pick === newWindow) await vscode.commands.executeCommand('vscode.openFolder', folder, { forceNewWindow: true });
  else if (pick === add) vscode.workspace.updateWorkspaceFolders(vscode.workspace.workspaceFolders?.length ?? 0, 0, { uri: folder });
}

async function pickVersion(placeHolder: string, candidates: string[], preferred: string): Promise<string | undefined> {
  const items = candidates.map<vscode.QuickPickItem>((id) => {
    const f = getFeatures(id);
    return {
      label: id,
      description: `data ${f.dataPackFormat}${f.dataPackFormatMinor ? '.' + f.dataPackFormatMinor : ''} · resources ${f.resourcePackFormat}${f.resourcePackFormatMinor ? '.' + f.resourcePackFormatMinor : ''}`,
      picked: id === preferred,
    };
  });
  const i = items.findIndex((x) => x.label === preferred);
  if (i > 0) items.unshift(...items.splice(i, 1));
  return (await vscode.window.showQuickPick(items, { placeHolder, ignoreFocusOut: true }))?.label;
}

/** Interactive "Create Datapack…" / "Create Resource Pack…". */
export async function createPack(core: Core, kind: PackKind): Promise<void> {
  const kindLabel = kind === 'data' ? vscode.l10n.t('data pack') : vscode.l10n.t('resource pack');
  const parent = await vscode.window.showOpenDialog({
    canSelectFolders: true,
    canSelectFiles: false,
    canSelectMany: false,
    defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri,
    openLabel: vscode.l10n.t('Create here'),
    title: vscode.l10n.t('Folder where the new {0} will be created', kindLabel),
  });
  if (!parent?.[0]) return;
  const name = await vscode.window.showInputBox({
    title: vscode.l10n.t('New {0}', kindLabel),
    prompt: vscode.l10n.t('Name of the {0}', kindLabel),
    value: kind === 'data' ? 'My Datapack' : 'My Resource Pack',
    ignoreFocusOut: true,
    validateInput: (v) => (v.trim() ? undefined : vscode.l10n.t('Enter a name')),
  });
  if (!name) return;
  const namespace = await vscode.window.showInputBox({
    title: vscode.l10n.t('New {0}', kindLabel),
    prompt: vscode.l10n.t('Namespace (lowercase letters, digits, _ . -)'),
    value: toResourcePath(name).replace(/[./]/g, '_') || 'mypack',
    ignoreFocusOut: true,
    validateInput: (v) =>
      !isValidNamespace(v) ? vscode.l10n.t('Only a-z, 0-9, _ . - are allowed') : v === 'minecraft' ? vscode.l10n.t('Use your own namespace (files can still override minecraft:)') : undefined,
  });
  if (!namespace) return;
  const releases = supportedReleases();
  const target = core.version();
  const minVersion = await pickVersion(vscode.l10n.t('Oldest supported Minecraft version'), releases, releases.includes(target) ? target : releases[0]);
  if (!minVersion) return;
  const newer = releases.filter((v) => compareVersions(v, minVersion) >= 0);
  const maxVersion = await pickVersion(vscode.l10n.t('Newest supported Minecraft version'), newer, minVersion);
  if (!maxVersion) return;
  const description = await vscode.window.showInputBox({
    title: vscode.l10n.t('New {0}', kindLabel),
    prompt: vscode.l10n.t('Description shown in the pack list'),
    value: name,
    ignoreFocusOut: true,
  });
  if (description === undefined) return;

  const folder = vscode.Uri.joinPath(parent[0], toResourcePath(name).replace(/[./]/g, '_') || namespace);
  if (await isNonEmptyDir(folder)) {
    const yes = vscode.l10n.t('Continue');
    const ok = await vscode.window.showWarningMessage(vscode.l10n.t('{0} already exists and is not empty. Existing files with the same name will be overwritten.', folder.fsPath), { modal: true }, yes);
    if (ok !== yes) return;
  }
  await writeFiles(folder, packFiles({ kind, name, namespace, minVersion, maxVersion, description }));
  await offerOpen(folder, vscode.Uri.joinPath(folder, 'pack.mcmeta'));
}

/** Generate a mod project into <parent>/<modId>. Returns the project folder. */
export async function createModProjectAt(parent: vscode.Uri, opts: ModProjectOptions): Promise<vscode.Uri> {
  const folder = vscode.Uri.joinPath(parent, opts.modId);
  if (await isNonEmptyDir(folder)) {
    const yes = vscode.l10n.t('Continue');
    const ok = await vscode.window.showWarningMessage(vscode.l10n.t('{0} already exists and is not empty. Existing files with the same name will be overwritten.', folder.fsPath), { modal: true }, yes);
    if (ok !== yes) throw new Error(vscode.l10n.t('Cancelled'));
  }
  await writeFiles(folder, generateModProject(opts));
  return folder;
}
