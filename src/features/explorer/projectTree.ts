// "Project" view: detected projects with their metadata + quick actions.
import * as vscode from 'vscode';
import * as path from 'node:path';
import type { Core } from '../../core/core';
import type { McProject } from '../../core/projects';
import { getFeatures } from '../../core/versions';

export interface QuickAction {
  label: string;
  icon: string;
  command: string;
  args?: unknown[];
}

/** Quick actions; commands contributed by other features may be missing (checked when run). */
export const QUICK_ACTIONS: QuickAction[] = [
  { label: 'New Item', icon: 'package', command: 'vscodecraft.models.newItem' },
  { label: 'New Block', icon: 'symbol-structure', command: 'vscodecraft.models.newBlock' },
  { label: 'New Recipe', icon: 'tools', command: 'vscodecraft.recipes.new' },
  { label: 'New Texture', icon: 'paintcan', command: 'vscodecraft.textures.newTexture' },
  { label: 'Recipe Browser', icon: 'book', command: 'vscodecraft.recipes.browser' },
  { label: 'Advancement Tree', icon: 'type-hierarchy', command: 'vscodecraft.loot.advancementTree' },
  { label: 'Item Builder', icon: 'wand', command: 'vscodecraft.loot.itemBuilder' },
  { label: 'Lang Editor', icon: 'globe', command: 'vscodecraft.translations.openEditor' },
  { label: 'Export Pack', icon: 'archive', command: 'vscodecraft.datapack.exportZip' },
  { label: 'Download vanilla data', icon: 'cloud-download', command: 'vscodecraft.downloadData' },
  { label: 'Welcome & project generators', icon: 'rocket', command: 'vscodecraft.explorer.welcome' },
];

export type PNode =
  | { type: 'project'; project: McProject }
  | { type: 'prop'; key: string; project: McProject; label: string; value: string; icon: string; command?: vscode.Command; tooltip?: string; children?: PNode[]; contextValue?: string }
  | { type: 'actions' }
  | { type: 'action'; action: QuickAction };

const LOADER_LABEL: Record<string, string> = {
  fabric: 'Fabric',
  quilt: 'Quilt',
  neoforge: 'NeoForge',
  forge: 'Forge',
  paper: 'Paper',
  datapack: 'Data Pack',
  resourcepack: 'Resource Pack',
  unknown: 'Minecraft',
};

export function loaderIconFile(loader: string): string {
  return ['fabric', 'quilt', 'neoforge', 'forge', 'paper', 'datapack', 'resourcepack'].includes(loader) ? loader : 'vscodecraft';
}

export class ProjectTree implements vscode.TreeDataProvider<PNode> {
  private readonly emitter = new vscode.EventEmitter<PNode | undefined | void>();
  readonly onDidChangeTreeData = this.emitter.event;

  constructor(private readonly core: Core) {
    core.track(
      core.projects.onDidChange(() => this.refresh()),
      vscode.workspace.onDidChangeConfiguration((e) => e.affectsConfiguration('vscodecraft') && this.refresh()),
    );
  }

  refresh(): void {
    void vscode.commands.executeCommand('setContext', 'vscodecraft.hasProject', this.core.projects.projects.length > 0);
    this.emitter.fire();
  }

  getChildren(node?: PNode): PNode[] {
    const projects = this.core.projects.projects;
    if (!node) {
      if (!projects.length) return [];
      return [...projects.map<PNode>((project) => ({ type: 'project', project })), { type: 'actions' }];
    }
    if (node.type === 'project') return this.props(node.project);
    if (node.type === 'prop') return node.children ?? [];
    if (node.type === 'actions') return QUICK_ACTIONS.map((action) => ({ type: 'action', action }));
    return [];
  }

  private props(p: McProject): PNode[] {
    const anyFile = p.mainResourceRoot;
    const version = this.core.version(anyFile);
    const setting = vscode.workspace.getConfiguration('vscodecraft', anyFile).get<string>('minecraftVersion', 'auto');
    const f = getFeatures(version);
    const isPack = p.loader === 'datapack' || p.loader === 'resourcepack';
    const out: PNode[] = [];
    const prop = (key: string, label: string, value: string, icon: string, extra: Partial<Extract<PNode, { type: 'prop' }>> = {}): PNode => ({
      type: 'prop',
      key,
      project: p,
      label,
      value,
      icon,
      ...extra,
    });
    out.push(prop('loader', vscode.l10n.t('Loader'), LOADER_LABEL[p.loader] ?? p.loader, 'extensions'));
    out.push(
      prop(
        'version',
        vscode.l10n.t('Minecraft'),
        setting !== 'auto' ? `${version} (${vscode.l10n.t('setting')})` : p.detectedVersion ? version : `${version} (${vscode.l10n.t('latest')})`,
        'versions',
        {
          command: { command: 'vscodecraft.selectVersion', title: vscode.l10n.t('Select Minecraft version') },
          tooltip: vscode.l10n.t('Detected: {0} — click to change the target version', p.detectedVersion ?? '—'),
          contextValue: 'vscodecraft.project.version',
        },
      ),
    );
    out.push(
      prop('java', vscode.l10n.t('Java'), `${f.javaVersion}+`, 'coffee', {
        tooltip: vscode.l10n.t('Minecraft {0} requires Java {1} or newer', version, f.javaVersion),
      }),
    );
    const fmt = (major: number, minor: number) => (minor ? `${major}.${minor}` : String(major));
    out.push(
      prop('formats', vscode.l10n.t('Pack formats'), `data ${fmt(f.dataPackFormat, f.dataPackFormatMinor)} · resources ${fmt(f.resourcePackFormat, f.resourcePackFormatMinor)}`, 'file-zip', {
        tooltip: f.packMetaStyle === 'min_max' ? vscode.l10n.t('pack.mcmeta uses min_format / max_format (1.21.9+)') : vscode.l10n.t('pack.mcmeta uses pack_format'),
      }),
    );
    if (!isPack || p.modIds.length) {
      out.push(
        prop('modIds', vscode.l10n.t('Mod ids'), p.modIds.join(', ') || '—', 'symbol-key', {
          children: p.modIds.length > 1 ? p.modIds.map((id) => prop(`modId:${id}`, id, '', 'symbol-key', { contextValue: 'vscodecraft.project.copyable' })) : undefined,
          contextValue: p.modIds.length === 1 ? 'vscodecraft.project.copyable' : undefined,
        }),
      );
    }
    out.push(
      prop('namespaces', vscode.l10n.t('Namespaces'), p.namespaces.join(', ') || '—', 'symbol-namespace', {
        children: p.namespaces.length > 1 ? p.namespaces.map((ns) => prop(`ns:${ns}`, ns, '', 'symbol-namespace', { contextValue: 'vscodecraft.project.copyable' })) : undefined,
        contextValue: p.namespaces.length === 1 ? 'vscodecraft.project.copyable' : undefined,
      }),
    );
    const rel = (u: vscode.Uri) => path.relative(p.root.fsPath, u.fsPath).replace(/\\/g, '/') || '.';
    out.push(
      prop('roots', vscode.l10n.t('Resource roots'), String(p.resourceRoots.length), 'root-folder', {
        children: p.resourceRoots.map((u) =>
          prop(`root:${u.fsPath}`, rel(u), u.fsPath === p.mainResourceRoot.fsPath ? vscode.l10n.t('main') : '', 'folder', {
            command: { command: 'revealInExplorer', title: vscode.l10n.t('Reveal in Explorer'), arguments: [u] },
            tooltip: u.fsPath,
          }),
        ),
      }),
    );
    if (p.sourceRoots.length) {
      out.push(
        prop('sources', vscode.l10n.t('Source roots'), String(p.sourceRoots.length), 'file-code', {
          children: p.sourceRoots.map((u) =>
            prop(`src:${u.fsPath}`, rel(u), '', 'folder', { command: { command: 'revealInExplorer', title: vscode.l10n.t('Reveal in Explorer'), arguments: [u] }, tooltip: u.fsPath }),
          ),
        }),
      );
    }
    if (p.entrypoint) out.push(prop('entry', vscode.l10n.t('Entrypoint'), p.entrypoint, 'symbol-class'));
    for (const m of p.markers.slice(0, 6)) {
      out.push(
        prop(`marker:${m.fsPath}`, path.basename(m.fsPath), rel(m), 'file', {
          command: { command: 'vscode.open', title: vscode.l10n.t('Open'), arguments: [m] },
          tooltip: m.fsPath,
        }),
      );
    }
    return out;
  }

  getTreeItem(node: PNode): vscode.TreeItem {
    const C = vscode.TreeItemCollapsibleState;
    switch (node.type) {
      case 'project': {
        const p = node.project;
        const item = new vscode.TreeItem(p.name, this.core.projects.projects.length <= 2 ? C.Expanded : C.Collapsed);
        item.id = `project:${p.root.fsPath}`;
        item.description = `${LOADER_LABEL[p.loader] ?? p.loader} · ${this.core.version(p.mainResourceRoot)}`;
        item.tooltip = new vscode.MarkdownString(
          `**${p.name}**\n\n${LOADER_LABEL[p.loader] ?? p.loader}\n\n\`${p.root.fsPath}\``,
        );
        const iconFile = loaderIconFile(p.loader);
        item.iconPath = iconFile === 'vscodecraft' ? new vscode.ThemeIcon('package') : vscode.Uri.joinPath(this.core.context.extensionUri, 'media', 'icons', `${iconFile}.svg`);
        item.contextValue = 'vscodecraft.project';
        return item;
      }
      case 'prop': {
        const item = new vscode.TreeItem(node.label, node.children?.length ? C.Collapsed : C.None);
        item.id = `prop:${node.project.root.fsPath}:${node.key}`;
        item.description = node.value;
        item.iconPath = new vscode.ThemeIcon(node.icon);
        item.command = node.command;
        item.tooltip = node.tooltip ?? (node.value ? `${node.label}: ${node.value}` : node.label);
        item.contextValue = node.contextValue;
        return item;
      }
      case 'actions': {
        const item = new vscode.TreeItem(vscode.l10n.t('Quick actions'), C.Expanded);
        item.id = 'quick-actions';
        item.iconPath = new vscode.ThemeIcon('zap');
        return item;
      }
      case 'action': {
        const item = new vscode.TreeItem(vscode.l10n.t(node.action.label), C.None);
        item.id = `action:${node.action.command}`;
        item.iconPath = new vscode.ThemeIcon(node.action.icon);
        item.command = { command: 'vscodecraft.explorer.runAction', title: vscode.l10n.t(node.action.label), arguments: [node.action.command, ...(node.action.args ?? [])] };
        return item;
      }
    }
  }
}

/** Run a command contributed by another feature if it exists. */
export async function runIfAvailable(command: string, ...args: unknown[]): Promise<boolean> {
  const all = await vscode.commands.getCommands(true);
  if (!all.includes(command)) {
    void vscode.window.showInformationMessage(vscode.l10n.t('This action is not available in this build ({0}).', command));
    return false;
  }
  await vscode.commands.executeCommand(command, ...args);
  return true;
}
