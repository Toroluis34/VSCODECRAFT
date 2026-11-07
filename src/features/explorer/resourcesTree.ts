// "Resources" view: namespace → category → (group) → folders → files of the workspace index.
import * as vscode from 'vscode';
import type { Core } from '../../core/core';
import type { IndexedResource } from '../../core/workspaceIndex';
import { buildPathTree, categorize, matchesFilter, TreeNode } from './resourceModel';
import type { IconCache } from './iconCache';

export type ResNode =
  | { type: 'ns'; ns: string }
  | { type: 'cat'; ns: string; cat: string; label: string; icon: string }
  | { type: 'group'; ns: string; cat: string; group: string }
  | { type: 'folder'; id: string; name: string; children: TreeNode<IndexedResource>[] }
  | { type: 'file'; res: IndexedResource };

const SHARED = new Set(['minecraft', 'c', 'neoforge', 'fabric', 'forge']);
const DEFAULT_EXT: Record<string, string> = { textures: 'png', function: 'mcfunction', sounds: 'ogg', structure: 'nbt' };

export class ResourcesTree implements vscode.TreeDataProvider<ResNode> {
  private readonly emitter = new vscode.EventEmitter<ResNode | undefined | void>();
  readonly onDidChangeTreeData = this.emitter.event;
  filter = '';
  private cache: Map<string, IndexedResource[]> | undefined;

  constructor(
    private readonly core: Core,
    private readonly icons: IconCache,
  ) {
    core.track(
      core.index.onDidChange(() => this.refresh()),
      core.projects.onDidChange(() => this.refresh()),
    );
  }

  refresh(): void {
    this.cache = undefined;
    this.emitter.fire();
  }

  /** Resources by namespace (filtered). */
  private byNamespace(): Map<string, IndexedResource[]> {
    if (this.cache) return this.cache;
    const map = new Map<string, IndexedResource[]>();
    for (const kind of this.core.index.kinds()) {
      for (const r of this.core.index.all(kind)) {
        if (this.filter && !matchesFilter(this.filter, r.id, r.kind, categorize(r.kind).label)) continue;
        const list = map.get(r.namespace) ?? [];
        list.push(r);
        map.set(r.namespace, list);
      }
    }
    this.cache = map;
    return map;
  }

  getChildren(node?: ResNode): ResNode[] {
    const byNs = this.byNamespace();
    if (!node) {
      return [...byNs.keys()]
        .sort((a, b) => Number(SHARED.has(a)) - Number(SHARED.has(b)) || a.localeCompare(b))
        .map((ns) => ({ type: 'ns', ns }));
    }
    if (node.type === 'ns') {
      const cats = new Map<string, ReturnType<typeof categorize>>();
      for (const r of byNs.get(node.ns) ?? []) {
        const c = categorize(r.kind);
        cats.set(c.key, c);
      }
      return [...cats.values()]
        .sort((a, b) => a.order - b.order)
        .map((c) => ({ type: 'cat', ns: node.ns, cat: c.key, label: c.label, icon: c.icon }));
    }
    if (node.type === 'cat') {
      const list = (byNs.get(node.ns) ?? []).filter((r) => categorize(r.kind).key === node.cat);
      const groups = new Set(list.map((r) => categorize(r.kind).group).filter((g): g is string => !!g));
      const ungrouped = list.filter((r) => !categorize(r.kind).group);
      const out: ResNode[] = [...groups].sort().map((group) => ({ type: 'group', ns: node.ns, cat: node.cat, group }));
      return [...out, ...this.toNodes(buildPathTree(ungrouped, (r) => r.path), `${node.ns}|${node.cat}`)];
    }
    if (node.type === 'group') {
      const list = (byNs.get(node.ns) ?? []).filter((r) => {
        const c = categorize(r.kind);
        return c.key === node.cat && c.group === node.group;
      });
      return this.toNodes(buildPathTree(list, (r) => r.path), `${node.ns}|${node.cat}|${node.group}`);
    }
    if (node.type === 'folder') return this.toNodes(node.children, node.id);
    return [];
  }

  private toNodes(nodes: TreeNode<IndexedResource>[], parentId: string): ResNode[] {
    return nodes.map((n) =>
      n.type === 'folder'
        ? { type: 'folder', id: `${parentId}/${n.name}`, name: n.name, children: n.children }
        : { type: 'file', res: n.item },
    );
  }

  private expanded(): vscode.TreeItemCollapsibleState {
    return this.filter ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed;
  }

  async getTreeItem(node: ResNode): Promise<vscode.TreeItem> {
    switch (node.type) {
      case 'ns': {
        const item = new vscode.TreeItem(node.ns, this.filter || !SHARED.has(node.ns) ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed);
        item.id = `ns:${node.ns}`;
        item.iconPath = new vscode.ThemeIcon(SHARED.has(node.ns) ? 'library' : 'symbol-namespace');
        const count = this.byNamespace().get(node.ns)?.length ?? 0;
        item.description = vscode.l10n.t('{0} files', count);
        item.contextValue = 'vscodecraft.namespace';
        return item;
      }
      case 'cat': {
        const item = new vscode.TreeItem(vscode.l10n.t(node.label), this.expanded());
        item.id = `cat:${node.ns}|${node.cat}`;
        item.iconPath = new vscode.ThemeIcon(node.icon);
        item.description = String((this.byNamespace().get(node.ns) ?? []).filter((r) => categorize(r.kind).key === node.cat).length);
        item.contextValue = 'vscodecraft.category';
        return item;
      }
      case 'group': {
        const item = new vscode.TreeItem(node.group, this.expanded());
        item.id = `group:${node.ns}|${node.cat}|${node.group}`;
        item.iconPath = new vscode.ThemeIcon(node.cat === 'tags' ? 'tag' : 'folder-library');
        item.contextValue = 'vscodecraft.group';
        return item;
      }
      case 'folder': {
        const item = new vscode.TreeItem(node.name, this.expanded());
        item.id = `folder:${node.id}`;
        item.iconPath = vscode.ThemeIcon.Folder;
        item.contextValue = 'vscodecraft.folder';
        return item;
      }
      case 'file':
        return this.fileItem(node.res);
    }
  }

  private async fileItem(res: IndexedResource): Promise<vscode.TreeItem> {
    const name = res.path.split('/').pop() ?? res.path;
    const item = new vscode.TreeItem(name, vscode.TreeItemCollapsibleState.None);
    item.id = `file:${res.uri.toString()}`;
    item.resourceUri = res.uri;
    const defaultExt = DEFAULT_EXT[res.kind] ?? 'json';
    const desc: string[] = [];
    if (res.ext !== defaultExt) desc.push(`.${res.ext}`);
    if (/generated/.test(res.root)) desc.push(vscode.l10n.t('generated'));
    if (res.legacyFolder) desc.push(vscode.l10n.t('legacy folder'));
    item.description = desc.join(' · ') || undefined;
    item.contextValue = res.kind === 'textures' && res.ext === 'png' ? 'vscodecraft.resource.texture' : 'vscodecraft.resource';
    item.command = { command: 'vscodecraft.explorer.openResource', title: vscode.l10n.t('Open'), arguments: [{ type: 'file', res }] };
    const md = new vscode.MarkdownString(undefined, true);
    md.appendMarkdown(`**${res.id}**\n\n${vscode.l10n.t('Kind')}: \`${res.kind}\`\n\n\`${vscode.workspace.asRelativePath(res.uri)}\``);
    const version = this.core.version(res.uri);
    let icon: vscode.Uri | undefined;
    try {
      if (res.kind === 'textures' && res.ext === 'png') icon = res.uri;
      else if (res.kind === 'models' && res.ext === 'json') icon = await this.icons.modelIcon(res.id, version);
      else if (res.kind === 'items' && res.ext === 'json') icon = await this.icons.itemIcon(res.id, version);
    } catch {
      icon = undefined;
    }
    if (icon) {
      item.iconPath = icon;
      md.appendMarkdown(`\n\n![](${icon.toString()}|width=48,height=48)`);
    }
    item.tooltip = md;
    return item;
  }

  getParent(): undefined {
    return undefined;
  }
}
