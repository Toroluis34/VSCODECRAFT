// Feature "loot": loot table viewer/editor with probabilities & simulation, advancement tree & preview,
// "New Advancement…" wizard and the Give / Item Builder.
import * as vscode from 'vscode';
import type { Core } from '../../core/core';
import { copyToMod, isLootTableUri, LOOT_EDITOR_VIEW_TYPE, LootTableEditorProvider, openVanillaCommand, showLootPreview } from './lootEditor';
import { isAdvancementUri, newAdvancementCommand, showAdvancementPreview, showAdvancementTree } from './advancements';
import { showGiveBuilder, trackEditors } from './give';

function targetUri(uri?: unknown): vscode.Uri | undefined {
  if (uri instanceof vscode.Uri) return uri;
  const active = vscode.window.activeTextEditor?.document.uri;
  if (active) return active;
  const tab = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  if (tab instanceof vscode.TabInputCustom || tab instanceof vscode.TabInputText) return tab.uri;
  return undefined;
}

export function activate(core: Core): void {
  core.track(
    vscode.window.registerCustomEditorProvider(LOOT_EDITOR_VIEW_TYPE, new LootTableEditorProvider(core), {
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: true,
    }),
  );
  trackEditors(core);

  core.registerCommand('vscodecraft.loot.preview', async (uri?: vscode.Uri) => {
    const target = targetUri(uri);
    if (!target || !isLootTableUri(target)) {
      void vscode.window.showWarningMessage(vscode.l10n.t('Open a loot table JSON file (data/<namespace>/loot_table/…) first.'));
      return;
    }
    await showLootPreview(core, target);
  });
  core.registerCommand('vscodecraft.loot.openEditor', async (uri?: vscode.Uri) => {
    const target = targetUri(uri);
    if (target) await vscode.commands.executeCommand('vscode.openWith', target, LOOT_EDITOR_VIEW_TYPE);
  });
  core.registerCommand('vscodecraft.loot.openSource', async (uri?: vscode.Uri) => {
    const target = targetUri(uri);
    if (target) await vscode.commands.executeCommand('vscode.openWith', target, 'default');
  });
  core.registerCommand('vscodecraft.loot.openVanilla', () => openVanillaCommand(core));
  core.registerCommand('vscodecraft.loot.copyToMod', async (id?: string) => {
    const version = core.version();
    const tables = await core.vanilla.lootTables(version);
    const key = typeof id === 'string' ? id : undefined;
    if (key && tables[key]) await copyToMod(core, key, tables[key], version);
    else await openVanillaCommand(core);
  });

  core.registerCommand('vscodecraft.loot.advancementTree', () => showAdvancementTree(core));
  core.registerCommand('vscodecraft.loot.previewAdvancement', async (uri?: vscode.Uri) => {
    const target = targetUri(uri);
    if (!target || !isAdvancementUri(target)) {
      void vscode.window.showWarningMessage(vscode.l10n.t('Open an advancement JSON file (data/<namespace>/advancement/…) first.'));
      return;
    }
    await showAdvancementPreview(core, target);
  });
  core.registerCommand('vscodecraft.loot.newAdvancement', (parent?: unknown) => newAdvancementCommand(core, typeof parent === 'string' ? parent : undefined));

  core.registerCommand('vscodecraft.loot.give', (item?: unknown) => showGiveBuilder(core, typeof item === 'string' ? item : undefined));
}
