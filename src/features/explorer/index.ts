// Feature "explorer": activity bar views (Project / Resources / Vanilla), scaffolding, Java asset lenses & hovers.
import * as vscode from 'vscode';
import type { Core } from '../../core/core';
import { normalizeId } from '../../core/resourceLocation';
import { IconCache } from './iconCache';
import { ProjectTree, runIfAvailable } from './projectTree';
import { ResourcesTree } from './resourcesTree';
import { copyVanillaToMod, VanillaDocProvider, VanillaTree, VANILLA_SCHEME, VNode } from './vanillaTree';
import { copyResourceId, deleteResource, openResource, renameResource, revealResource } from './resourceCommands';
import { createPack } from './scaffold';
import { openWelcome } from './welcomePanel';
import { AssetChecker, AssetCodeLensProvider, AssetHoverProvider, assetActions, AssetKey, AssetTarget, createAsset } from './javaAssets';

export function activate(core: Core): void {
  const icons = new IconCache(core);

  // ---- Project view
  const projectTree = new ProjectTree(core);
  const projectView = vscode.window.createTreeView('vscodecraft.project', { treeDataProvider: projectTree, showCollapseAll: true });
  core.track(projectView);
  void core.projects.ready.then(() => projectTree.refresh());
  void vscode.commands.executeCommand('setContext', 'vscodecraft.hasProject', false);

  // ---- Resources view
  const resourcesTree = new ResourcesTree(core, icons);
  const resourcesView = vscode.window.createTreeView('vscodecraft.resources', { treeDataProvider: resourcesTree, showCollapseAll: true });
  core.track(resourcesView);
  const setResourceFilter = (filter: string) => {
    resourcesTree.filter = filter;
    resourcesView.message = filter ? vscode.l10n.t('Filter: "{0}"', filter) : undefined;
    void vscode.commands.executeCommand('setContext', 'vscodecraft.explorer.resourcesFiltered', !!filter);
    resourcesTree.refresh();
  };

  // ---- Vanilla view
  const vanillaTree = new VanillaTree(core, icons);
  const vanillaView = vscode.window.createTreeView('vscodecraft.vanilla', { treeDataProvider: vanillaTree, showCollapseAll: true });
  core.track(vanillaView, vscode.workspace.registerTextDocumentContentProvider(VANILLA_SCHEME, new VanillaDocProvider(core)));
  const updateVanillaTitle = () => {
    vanillaView.description = vanillaTree.version;
  };
  updateVanillaTitle();
  core.track(
    core.projects.onDidChange(updateVanillaTitle),
    vscode.workspace.onDidChangeConfiguration((e) => e.affectsConfiguration('vscodecraft.minecraftVersion') && updateVanillaTitle()),
  );
  const setVanillaFilter = (filter: string) => {
    vanillaTree.filter = filter;
    vanillaView.message = filter ? vscode.l10n.t('Filter: "{0}"', filter) : undefined;
    void vscode.commands.executeCommand('setContext', 'vscodecraft.explorer.vanillaFiltered', !!filter);
    vanillaTree.refresh();
  };

  // ---- Commands
  core.registerCommand('vscodecraft.explorer.refresh', async () => {
    await vscode.commands.executeCommand('vscodecraft.refreshProjects');
    projectTree.refresh();
    resourcesTree.refresh();
    vanillaTree.refresh();
  });
  core.registerCommand('vscodecraft.explorer.runAction', (command: string, ...args: unknown[]) => runIfAvailable(command, ...args));
  core.registerCommand('vscodecraft.explorer.welcome', () => openWelcome(core, 'start'));
  core.registerCommand('vscodecraft.explorer.createDatapack', () => createPack(core, 'data'));
  core.registerCommand('vscodecraft.explorer.createResourcePack', () => createPack(core, 'resource'));
  core.registerCommand('vscodecraft.explorer.createModProject', () => openWelcome(core, 'mod'));
  core.registerCommand('vscodecraft.explorer.copyText', async (node?: { value?: string; label?: string }) => {
    const text = node?.value || node?.label;
    if (text) await vscode.env.clipboard.writeText(text);
  });

  core.registerCommand('vscodecraft.explorer.openResource', (node) => openResource(core, node));
  core.registerCommand('vscodecraft.explorer.revealResource', (node) => revealResource(core, node));
  core.registerCommand('vscodecraft.explorer.copyResourceId', (node) => copyResourceId(core, node));
  core.registerCommand('vscodecraft.explorer.deleteResource', (node) => deleteResource(core, node));
  core.registerCommand('vscodecraft.explorer.renameResource', (node) => renameResource(core, node));
  core.registerCommand('vscodecraft.explorer.filterResources', async () => {
    const value = await vscode.window.showInputBox({
      title: vscode.l10n.t('Filter resources'),
      prompt: vscode.l10n.t('Text contained in the resource id or kind (e.g. "ruby", "recipe ore")'),
      value: resourcesTree.filter,
    });
    if (value !== undefined) setResourceFilter(value.trim());
  });
  core.registerCommand('vscodecraft.explorer.clearResourceFilter', () => setResourceFilter(''));

  core.registerCommand('vscodecraft.explorer.filterVanilla', async () => {
    const value = await vscode.window.showInputBox({
      title: vscode.l10n.t('Filter vanilla data'),
      prompt: vscode.l10n.t('Text contained in the id or name (e.g. "diamond", "oak log")'),
      value: vanillaTree.filter,
    });
    if (value !== undefined) setVanillaFilter(value.trim());
  });
  core.registerCommand('vscodecraft.explorer.clearVanillaFilter', () => setVanillaFilter(''));
  core.registerCommand('vscodecraft.explorer.vanillaRefresh', () => vanillaTree.refresh());
  core.registerCommand('vscodecraft.explorer.vanillaOpen', async (node?: VNode) => {
    if (!node || node.type !== 'entry') return;
    const uri = VanillaDocProvider.uri(vanillaTree.version, node.kind, node.id);
    const doc = await vscode.workspace.openTextDocument(uri);
    if (doc.languageId !== 'json') await vscode.languages.setTextDocumentLanguage(doc, 'json');
    await vscode.window.showTextDocument(doc, { preview: true });
  });
  core.registerCommand('vscodecraft.explorer.vanillaCopyId', async (node?: VNode) => {
    if (!node || node.type !== 'entry') return;
    const id = (node.kind.startsWith('tags/') ? '#' : '') + normalizeId(node.id);
    await vscode.env.clipboard.writeText(id);
    vscode.window.setStatusBarMessage(vscode.l10n.t('Copied {0}', id), 3000);
  });
  core.registerCommand('vscodecraft.explorer.vanillaCopyToMod', (node?: VNode) => {
    if (node?.type === 'entry') return copyVanillaToMod(core, node);
  });

  // ---- Java / Kotlin asset lenses & hovers
  const checker = new AssetChecker(core, icons);
  const selector: vscode.DocumentSelector = [
    { language: 'java', scheme: 'file' },
    { language: 'kotlin', scheme: 'file' },
  ];
  core.track(
    vscode.languages.registerCodeLensProvider(selector, new AssetCodeLensProvider(core, checker)),
    vscode.languages.registerHoverProvider(selector, new AssetHoverProvider(core, checker, icons)),
  );
  core.registerCommand('vscodecraft.explorer.assetActions', (target: AssetTarget) => target && assetActions(core, checker, target));
  core.registerCommand('vscodecraft.explorer.createAsset', (key: AssetKey, target: AssetTarget) => key && target && createAsset(core, key, target));
}
