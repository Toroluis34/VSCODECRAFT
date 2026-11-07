// Export datapack / resource pack as .zip and install it into a Minecraft instance.
import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Core } from '../../core/core';
import { exists } from '../../core/fsUtils';
import { buildPackSection, rangeForVersions } from './packFormat';
import { buildZip, includeInPack, overlayDirs, ZipKind, zipFileName } from './packZip';
import { candidateLocations, findInstances, GameInstance, LauncherKind, listWorlds, packDestination } from './launchers';
import { listFiles, pickResourceRoot, readJsonc, relPath, t, versionTable } from './util';

const LAST_FOLDER_KEY = 'vscodecraft.datapack.lastExportFolder';
const LAST_INSTANCE_KEY = 'vscodecraft.datapack.lastInstance';

const LAUNCHER_LABEL: Record<LauncherKind, string> = {
  vanilla: 'Minecraft Launcher',
  prism: 'Prism Launcher',
  multimc: 'MultiMC',
  curseforge: 'CurseForge',
  modrinth: 'Modrinth App',
  atlauncher: 'ATLauncher',
  gdlauncher: 'GDLauncher',
  custom: 'Custom',
};

interface BuiltZip {
  name: string;
  data: Uint8Array;
  fileCount: number;
}

async function buildPackZip(core: Core, root: vscode.Uri, kind: ZipKind): Promise<BuiltZip | undefined> {
  const mcmetaUri = vscode.Uri.joinPath(root, 'pack.mcmeta');
  const mcmeta = await readJsonc(mcmetaUri);
  const overlays = overlayDirs(mcmeta?.value);
  const version = core.version(mcmetaUri);
  const files: { path: string; data: Uint8Array }[] = [];
  const all = await listFiles(root);
  for (const uri of all) {
    const rel = relPath(root, uri);
    if (!includeInPack(rel, kind, overlays)) continue;
    const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
    const data = open ? new TextEncoder().encode(open.getText()) : await vscode.workspace.fs.readFile(uri);
    files.push({ path: rel, data });
  }
  const content = files.filter((f) => f.path.startsWith(kind === 'data' ? 'data/' : 'assets/') || overlays.some((o) => f.path.startsWith(o + '/')));
  if (!content.length) {
    void vscode.window.showWarningMessage(t('No {0} files found in {1}.', kind === 'data' ? 'data/' : 'assets/', vscode.workspace.asRelativePath(root)));
    return undefined;
  }
  if (!mcmeta) {
    // Mods often have no pack.mcmeta in their resources: generate one for the target version.
    const range = rangeForVersions(version, version, kind, versionTable());
    const project = core.projects.projectFor(root);
    const pack = range ? buildPackSection(range, kind, { description: project?.name ?? path.basename(root.fsPath) }) : { description: '', pack_format: 0 };
    files.push({ path: 'pack.mcmeta', data: new TextEncoder().encode(JSON.stringify({ pack }, null, 2) + '\n') });
  }
  const project = core.projects.projectFor(root);
  const baseName = project && project.root.fsPath !== root.fsPath && /resources$/.test(root.fsPath) ? project.name : path.basename(root.fsPath);
  return { name: zipFileName(baseName, version, kind), data: buildZip(files), fileCount: files.length };
}

function gameEnv() {
  return { platform: process.platform, home: os.homedir(), env: process.env as Record<string, string | undefined> };
}

/** Pick a game directory: detected launchers' instances + configured folders + browse. */
async function pickInstance(core: Core): Promise<GameInstance | undefined> {
  const extra = vscode.workspace.getConfiguration('vscodecraft.datapack').get<string[]>('instanceFolders', []) ?? [];
  const locations = [
    ...candidateLocations(gameEnv()),
    ...extra.map((p) => ({ launcher: 'custom' as const, type: (fsLooksLikeGame(p) ? 'game' : 'instances') as 'game' | 'instances', path: p })),
  ];
  const instances = findInstances(locations);
  const last = core.context.globalState.get<string>(LAST_INSTANCE_KEY);
  type Item = vscode.QuickPickItem & { inst?: GameInstance; browse?: boolean };
  const items: Item[] = instances
    .map((inst) => ({ label: `$(${inst.launcher === 'vanilla' ? 'home' : 'package'}) ${inst.name}`, description: LAUNCHER_LABEL[inst.launcher], detail: inst.gameDir, inst }))
    .sort((a, b) => (b.inst.gameDir === last ? 1 : 0) - (a.inst.gameDir === last ? 1 : 0));
  items.push({ label: `$(folder-opened) ${t('Browse for a game folder…')}`, browse: true });
  const pick = await vscode.window.showQuickPick(items, {
    placeHolder: instances.length ? t('Minecraft installation / instance') : t('No Minecraft installation found: browse for the game folder (the one containing "saves")'),
    matchOnDetail: true,
  });
  if (!pick) return undefined;
  let inst = pick.inst;
  if (pick.browse) {
    const sel = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, openLabel: t('Use this game folder') });
    if (!sel?.[0]) return undefined;
    inst = { launcher: 'custom', name: path.basename(sel[0].fsPath), gameDir: sel[0].fsPath };
  }
  if (inst) await core.context.globalState.update(LAST_INSTANCE_KEY, inst.gameDir);
  return inst;
}

function fsLooksLikeGame(p: string): boolean {
  try {
    return fs.existsSync(path.join(p, 'saves')) || fs.existsSync(path.join(p, 'options.txt'));
  } catch {
    return false;
  }
}

/** Ask for the destination folder of a pack inside an instance (world for datapacks). */
async function pickInstallFolder(core: Core, kind: ZipKind): Promise<vscode.Uri | undefined> {
  const inst = await pickInstance(core);
  if (!inst) return undefined;
  if (kind === 'resource') return vscode.Uri.file(packDestination('resource', inst.gameDir));
  const worlds = listWorlds(inst.gameDir);
  if (!worlds.length) {
    void vscode.window.showWarningMessage(t('No worlds found in {0}. Create a world first, or export the zip to a folder.', path.join(inst.gameDir, 'saves')));
    return undefined;
  }
  const pick = await vscode.window.showQuickPick(
    worlds.map((w) => ({ label: `$(globe) ${w.name}`, description: new Date(w.mtime).toLocaleString(), w })),
    { placeHolder: t('World to install the datapack into') },
  );
  return pick ? vscode.Uri.file(packDestination('data', inst.gameDir, pick.w.dir)) : undefined;
}

async function writeZip(folder: vscode.Uri, zip: BuiltZip): Promise<vscode.Uri> {
  await vscode.workspace.fs.createDirectory(folder);
  const target = vscode.Uri.joinPath(folder, zip.name);
  await vscode.workspace.fs.writeFile(target, zip.data);
  return target;
}

export function registerExport(core: Core): void {
  const exportPack = async (kind: ZipKind, uri?: vscode.Uri, mode?: 'install') => {
    const root = await pickResourceRoot(core, uri, kind === 'data' ? t('Datapack to export') : t('Resource pack to export'));
    if (!root) return;
    let dest: vscode.Uri | undefined;
    let install = mode === 'install';
    if (!install) {
      const cfgFolder = vscode.workspace.getConfiguration('vscodecraft.datapack').get<string>('exportFolder', '');
      const last = core.context.globalState.get<string>(LAST_FOLDER_KEY) ?? cfgFolder;
      type Item = vscode.QuickPickItem & { action: 'last' | 'choose' | 'install' };
      const items: Item[] = [];
      if (last) items.push({ label: `$(history) ${t('Save to {0}', last)}`, action: 'last' });
      items.push({ label: `$(folder-opened) ${t('Choose folder…')}`, action: 'choose' });
      items.push({
        label: `$(rocket) ${kind === 'data' ? t('Install into a world of a Minecraft instance…') : t('Install into the resourcepacks folder of a Minecraft instance…')}`,
        action: 'install',
      });
      const pick = await vscode.window.showQuickPick(items, { placeHolder: t('Where should the .zip go?') });
      if (!pick) return;
      if (pick.action === 'last') dest = vscode.Uri.file(last!);
      else if (pick.action === 'choose') {
        const sel = await vscode.window.showOpenDialog({
          canSelectFolders: true,
          canSelectFiles: false,
          defaultUri: last ? vscode.Uri.file(last) : vscode.workspace.workspaceFolders?.[0]?.uri,
          openLabel: t('Export here'),
        });
        if (!sel?.[0]) return;
        dest = sel[0];
        await core.context.globalState.update(LAST_FOLDER_KEY, dest.fsPath);
      } else install = true;
    }
    if (install) dest = await pickInstallFolder(core, kind);
    if (!dest) return;
    const zip = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: t('Building {0}…', kind === 'data' ? 'datapack' : 'resource pack') }, () =>
      buildPackZip(core, root, kind),
    );
    if (!zip) return;
    if (await exists(vscode.Uri.joinPath(dest, zip.name))) {
      const yes = t('Overwrite');
      if ((await vscode.window.showWarningMessage(t('{0} already exists. Overwrite it?', zip.name), { modal: true }, yes)) !== yes) return;
    }
    const target = await writeZip(dest, zip);
    const reveal = t('Reveal in File Explorer');
    const res = await vscode.window.showInformationMessage(
      install
        ? kind === 'data'
          ? t('Installed {0} ({1} files). Run /reload in the world to load it.', zip.name, zip.fileCount)
          : t('Installed {0} ({1} files). Enable it in Options → Resource Packs.', zip.name, zip.fileCount)
        : t('Exported {0} ({1} files, {2} KB).', zip.name, zip.fileCount, Math.ceil(zip.data.length / 1024)),
      reveal,
    );
    if (res === reveal) await vscode.commands.executeCommand('revealFileInOS', target);
  };
  core.registerCommand('vscodecraft.datapack.exportDatapack', (uri?: vscode.Uri) => exportPack('data', uri));
  core.registerCommand('vscodecraft.datapack.exportResourcePack', (uri?: vscode.Uri) => exportPack('resource', uri));
  core.registerCommand('vscodecraft.datapack.installToInstance', async (uri?: vscode.Uri) => {
    const pick = await vscode.window.showQuickPick(
      [
        { label: t('Datapack'), description: 'saves/<world>/datapacks', kind2: 'data' as ZipKind },
        { label: t('Resource pack'), description: 'resourcepacks', kind2: 'resource' as ZipKind },
      ],
      { placeHolder: t('What do you want to install?') },
    );
    if (pick) await exportPack(pick.kind2, uri, 'install');
  });
}
