// Welcome page / project generators webview (bundle: webview-src/welcome).
import * as vscode from 'vscode';
import type { Core } from '../../core/core';
import { getFeatures } from '../../core/versions';
import { createModProjectAt, offerOpen, supportedReleases } from './scaffold';
import { FABRIC_API_VERSIONS, isValidModId, isValidPackage, ModProjectOptions, NEOFORGE_VERSIONS, OFFICIAL_GENERATORS } from './modTemplate';
import { runIfAvailable } from './projectTree';

export interface WelcomeState {
  tab: 'start' | 'mod';
  versions: { id: string; java: number; fabric: boolean; neoforge: boolean }[];
  defaultVersion: string;
  defaultFolder: string;
  generators: typeof OFFICIAL_GENERATORS;
  projects: { name: string; loader: string; version: string }[];
  available: string[];
}

let current: vscode.WebviewPanel | undefined;

export async function openWelcome(core: Core, tab: 'start' | 'mod' = 'start'): Promise<void> {
  if (current) {
    current.reveal();
    void current.webview.postMessage({ kind: 'event', event: 'welcome.tab', data: tab });
    return;
  }
  const all = new Set(await vscode.commands.getCommands(true));
  const releases = supportedReleases();
  const target = core.version();
  const state: WelcomeState = {
    tab,
    versions: releases.map((id) => ({ id, java: getFeatures(id).javaVersion, fabric: id in FABRIC_API_VERSIONS, neoforge: id in NEOFORGE_VERSIONS })),
    defaultVersion: releases.includes(target) ? target : releases[0],
    defaultFolder: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '',
    generators: OFFICIAL_GENERATORS,
    projects: core.projects.projects.map((p) => ({ name: p.name, loader: p.loader, version: core.version(p.mainResourceRoot) })),
    available: [
      'vscodecraft.models.newItem',
      'vscodecraft.models.newBlock',
      'vscodecraft.recipes.new',
      'vscodecraft.recipes.browser',
      'vscodecraft.translations.openEditor',
      'vscodecraft.datapack.exportZip',
      'vscodecraft.loot.advancementTree',
      'vscodecraft.loot.itemBuilder',
      'vscodecraft.textures.newTexture',
      'vscodecraft.downloadData',
      'vscodecraft.selectVersion',
    ].filter((c) => all.has(c)),
  };
  const { panel } = core.webviews.createPanel({
    viewType: 'vscodecraft.welcome',
    title: vscode.l10n.t('VSCodeCraft — Welcome'),
    bundle: 'welcome',
    state,
    icon: 'media/icons/vscodecraft.svg',
    handlers: {
      'welcome.run': async (p: { command: string; args?: unknown[] }) => {
        if (!p.command.startsWith('vscodecraft.')) throw new Error('Not allowed');
        return runIfAvailable(p.command, ...(p.args ?? []));
      },
      'welcome.openUrl': async (p: { url: string }) => {
        if (!Object.values(OFFICIAL_GENERATORS).includes(p.url as never) && !/^https:\/\/(fabricmc\.net|neoforged\.net|docs\.neoforged\.net|docs\.fabricmc\.net|minecraft\.wiki)\//.test(p.url)) {
          throw new Error('URL not allowed');
        }
        return vscode.env.openExternal(vscode.Uri.parse(p.url));
      },
      'welcome.pickFolder': async (p: { current?: string }) => {
        const res = await vscode.window.showOpenDialog({
          canSelectFolders: true,
          canSelectFiles: false,
          canSelectMany: false,
          defaultUri: p.current ? vscode.Uri.file(p.current) : vscode.workspace.workspaceFolders?.[0]?.uri,
          openLabel: vscode.l10n.t('Select'),
        });
        return res?.[0]?.fsPath ?? null;
      },
      'welcome.generateMod': async (p: { options: ModProjectOptions; folder: string }) => {
        const o = p.options;
        if (!isValidModId(o.modId)) throw new Error(vscode.l10n.t('Invalid mod id'));
        if (!isValidPackage(o.packageName)) throw new Error(vscode.l10n.t('Invalid Java package'));
        if (!p.folder) throw new Error(vscode.l10n.t('Choose a destination folder'));
        const folder = await createModProjectAt(vscode.Uri.file(p.folder), o);
        void offerOpen(folder, vscode.Uri.joinPath(folder, 'gradle.properties'));
        return { folder: folder.fsPath };
      },
    },
  });
  current = panel;
  panel.onDidDispose(() => (current = undefined));
}
