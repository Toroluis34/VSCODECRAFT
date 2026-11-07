// Core commands & status bar: target version picker, data download, cache, logs.
import * as vscode from 'vscode';
import type { Core } from './core';
import { getVersions, BUNDLED_DATA_VERSIONS } from './versions';

export function activateCoreCommands(core: Core): void {
  const status = vscode.window.createStatusBarItem('vscodecraft.version', vscode.StatusBarAlignment.Right, 100);
  status.name = 'VSCodeCraft';
  status.command = 'vscodecraft.selectVersion';
  core.track(status);

  const update = () => {
    const uri = vscode.window.activeTextEditor?.document.uri;
    const project = core.projects.projectFor(uri);
    if (!project && !core.projects.projects.length) {
      status.hide();
      return;
    }
    const version = core.version(uri);
    const loader = project?.loader && project.loader !== 'unknown' ? project.loader : '';
    const icon = '$(package)';
    status.text = `${icon} ${loader ? loaderLabel(loader) + ' ' : ''}${version}`;
    const md = new vscode.MarkdownString(undefined, true);
    md.appendMarkdown(`**VSCodeCraft**\n\n`);
    if (project) {
      md.appendMarkdown(`${vscode.l10n.t('Project')}: \`${project.name}\`\n\n`);
      md.appendMarkdown(`${vscode.l10n.t('Loader')}: ${loaderLabel(project.loader)}\n\n`);
      if (project.modIds.length) md.appendMarkdown(`${vscode.l10n.t('Mod id')}: \`${project.modIds.join(', ')}\`\n\n`);
      md.appendMarkdown(`${vscode.l10n.t('Detected version')}: ${project.detectedVersion ?? '—'}\n\n`);
    }
    md.appendMarkdown(`${vscode.l10n.t('Target version')}: **${version}**\n\n`);
    md.appendMarkdown(`_${vscode.l10n.t('Click to change the target Minecraft version')}_`);
    status.tooltip = md;
    status.show();
  };
  core.track(
    vscode.window.onDidChangeActiveTextEditor(update),
    core.projects.onDidChange(update),
    vscode.workspace.onDidChangeConfiguration((e) => e.affectsConfiguration('vscodecraft.minecraftVersion') && update()),
  );
  void core.projects.ready.then(update);

  core.registerCommand('vscodecraft.selectVersion', async () => {
    void core.vanilla.refreshVersionList().catch(() => undefined);
    const current = vscode.workspace.getConfiguration('vscodecraft').get<string>('minecraftVersion', 'auto');
    const detected = core.projects.projectFor()?.detectedVersion;
    type Item = vscode.QuickPickItem & { value?: string };
    const items: Item[] = [
      {
        label: `$(sync) ${vscode.l10n.t('Auto-detect')}`,
        description: detected ? vscode.l10n.t('detected: {0}', detected) : vscode.l10n.t('latest release'),
        value: 'auto',
        picked: current === 'auto',
      },
      { label: vscode.l10n.t('Releases'), kind: vscode.QuickPickItemKind.Separator },
      ...getVersions(false).map<Item>((v) => ({
        label: v.id,
        description: `data ${v.dataPack}${v.dataPackMinor ? '.' + v.dataPackMinor : ''} · resources ${v.resourcePack}${v.resourcePackMinor ? '.' + v.resourcePackMinor : ''}`,
        detail: (BUNDLED_DATA_VERSIONS as readonly string[]).includes(v.id) ? vscode.l10n.t('Bundled offline data') : undefined,
        value: v.id,
      })),
      { label: vscode.l10n.t('Snapshots'), kind: vscode.QuickPickItemKind.Separator },
      ...getVersions(true)
        .filter((v) => v.type !== 'release')
        .map<Item>((v) => ({ label: v.id, description: `data ${v.dataPack} · resources ${v.resourcePack}`, value: v.id })),
    ];
    const pick = await vscode.window.showQuickPick(items, {
      placeHolder: vscode.l10n.t('Target Minecraft version (current: {0})', core.version()),
      matchOnDescription: true,
    });
    if (!pick?.value) return;
    const target = vscode.workspace.workspaceFolders ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
    await vscode.workspace.getConfiguration('vscodecraft').update('minecraftVersion', pick.value, target);
    update();
  });

  core.registerCommand('vscodecraft.downloadData', async (version?: string) => {
    const v = version ?? core.version();
    const ok = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: vscode.l10n.t('Downloading Minecraft {0} data', v) },
      (progress) => core.vanilla.prefetch(v, progress),
    );
    if (ok) void vscode.window.showInformationMessage(vscode.l10n.t('Minecraft {0} data is ready (textures, models, recipes, tags, names).', v));
    else
      void vscode.window.showWarningMessage(
        vscode.l10n.t('Some Minecraft {0} data could not be downloaded. Offline data will be used where possible.', v),
      );
  });

  core.registerCommand('vscodecraft.clearCache', async () => {
    await core.vanilla.clearCache();
    void vscode.window.showInformationMessage(vscode.l10n.t('VSCodeCraft cache cleared.'));
  });

  core.registerCommand('vscodecraft.showLog', () => core.log.show());

  core.registerCommand('vscodecraft.refreshProjects', async () => {
    await core.index.rebuild();
    await core.projects.refresh();
    update();
    const list = core.projects.projects;
    void vscode.window.showInformationMessage(
      list.length
        ? vscode.l10n.t('Detected {0} project(s): {1}', list.length, list.map((p) => `${p.name} (${loaderLabel(p.loader)})`).join(', '))
        : vscode.l10n.t('No Minecraft project detected in this workspace.'),
    );
  });

  // Prefetch vanilla data in the background for the detected version (first run only per version).
  void core.projects.ready.then(async () => {
    if (!core.projects.projects.length) return;
    if (!vscode.workspace.getConfiguration('vscodecraft').get<boolean>('data.autoDownload', true)) return;
    const v = core.version();
    const key = `prefetched:${v}`;
    if (core.context.globalState.get(key)) return;
    const ok = await core.vanilla.prefetch(v);
    if (ok) await core.context.globalState.update(key, true);
  });
}

export function loaderLabel(loader: string): string {
  return (
    {
      fabric: 'Fabric',
      quilt: 'Quilt',
      neoforge: 'NeoForge',
      forge: 'Forge',
      paper: 'Paper',
      datapack: 'Datapack',
      resourcepack: 'Resource Pack',
      unknown: 'Minecraft',
    } as Record<string, string>
  )[loader] ?? loader;
}
