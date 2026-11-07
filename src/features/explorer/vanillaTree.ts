// "Vanilla" view: browse vanilla data of the target version + read-only virtual documents.
import * as vscode from 'vscode';
import type { Core } from '../../core/core';
import { humanize, normalizeId, parseRL } from '../../core/resourceLocation';
import { atLeast, dataFolder } from '../../core/versions';
import { createFile } from '../../core/fsUtils';
import {
  bucketByLetter,
  buildPathTree,
  isDataDrivenRegistry,
  matchesFilter,
  parseVanillaDocPath,
  TreeNode,
  vanillaDocPath,
} from './resourceModel';
import type { IconCache } from './iconCache';

export const VANILLA_SCHEME = 'vscodecraft-vanilla-browse';

type RootKey = 'items' | 'blocks' | 'recipes' | 'loot' | 'advancements' | 'tags' | 'registries';

export type VNode =
  | { type: 'root'; key: RootKey }
  | { type: 'bucket'; key: string; kind: string; letter: string; ids: string[] }
  | { type: 'folder'; key: string; kind: string; name: string; children: TreeNode<string>[] }
  | { type: 'tagRegistry'; registry: string }
  | { type: 'registry'; name: string }
  | { type: 'entry'; kind: string; id: string }
  | { type: 'message'; text: string; command?: vscode.Command };

const ROOTS: { key: RootKey; label: string; icon: string }[] = [
  { key: 'items', label: 'Items', icon: 'package' },
  { key: 'blocks', label: 'Blocks', icon: 'symbol-structure' },
  { key: 'recipes', label: 'Recipes', icon: 'tools' },
  { key: 'loot', label: 'Loot Tables', icon: 'gift' },
  { key: 'advancements', label: 'Advancements', icon: 'star-empty' },
  { key: 'tags', label: 'Tags', icon: 'tag' },
  { key: 'registries', label: 'Registries', icon: 'list-tree' },
];

const BUCKET_THRESHOLD = 150;
const FILTER_LIMIT = 400;

/** Kinds whose entries are real data files that can be copied into the mod. */
export function isCopyableKind(kind: string): boolean {
  return kind === 'recipe' || kind === 'loot_table' || kind === 'advancement' || kind.startsWith('tags/') || isDataDrivenRegistry(kind);
}

export class VanillaTree implements vscode.TreeDataProvider<VNode> {
  private readonly emitter = new vscode.EventEmitter<VNode | undefined | void>();
  readonly onDidChangeTreeData = this.emitter.event;
  filter = '';
  private langCache = new Map<string, Promise<Record<string, string>>>();

  constructor(
    private readonly core: Core,
    private readonly icons: IconCache,
  ) {
    core.track(
      core.vanilla.onDidDownload(() => this.refresh()),
      core.projects.onDidChange(() => this.refresh()),
      vscode.workspace.onDidChangeConfiguration((e) => e.affectsConfiguration('vscodecraft.minecraftVersion') && this.refresh()),
    );
  }

  get version(): string {
    return this.core.version();
  }

  refresh(): void {
    this.langCache.clear();
    this.emitter.fire();
  }

  private lang(): Promise<Record<string, string>> {
    const v = this.version;
    let p = this.langCache.get(v);
    if (!p) {
      p = this.core.vanilla.lang(v).catch(() => ({}));
      this.langCache.set(v, p);
    }
    return p;
  }

  async displayName(kind: string, id: string): Promise<string | undefined> {
    if (kind !== 'item' && kind !== 'block') return undefined;
    const lang = await this.lang();
    const rl = parseRL(id);
    const p = rl.path.replace(/\//g, '.');
    return kind === 'block' ? lang[`block.${rl.namespace}.${p}`] : (lang[`item.${rl.namespace}.${p}`] ?? lang[`block.${rl.namespace}.${p}`]);
  }

  /** Ids for a root/kind. */
  private async ids(kind: string): Promise<string[]> {
    const v = this.version;
    try {
      if (kind === 'recipe' || kind === 'loot_table' || kind === 'advancement') {
        let ids = await this.core.vanilla.registry(v, kind);
        if (!ids.length) {
          const all = kind === 'recipe' ? await this.core.vanilla.recipes(v) : kind === 'loot_table' ? await this.core.vanilla.lootTables(v) : await this.core.vanilla.advancements(v);
          ids = Object.keys(all);
        }
        return ids;
      }
      if (kind.startsWith('tags/')) {
        const reg = kind.slice(5);
        const fromRegistry = await this.core.vanilla.registry(v, `tag/${reg}`);
        if (fromRegistry.length) return fromRegistry;
        return Object.keys(await this.core.vanilla.tags(v, reg));
      }
      return await this.core.vanilla.registry(v, kind);
    } catch {
      return [];
    }
  }

  private async listing(kind: string, key: string, folders: boolean): Promise<VNode[]> {
    let ids = await this.ids(kind);
    if (!ids.length) {
      return [
        {
          type: 'message',
          text: vscode.l10n.t('No data for {0} — download vanilla data', this.version),
          command: { command: 'vscodecraft.downloadData', title: vscode.l10n.t('Download vanilla data'), arguments: [this.version] },
        },
      ];
    }
    if (this.filter) {
      const names = kind === 'item' || kind === 'block' ? await this.lang() : {};
      ids = ids.filter((id) => {
        const p = parseRL(id).path;
        return matchesFilter(this.filter, id, names[`${kind}.minecraft.${p}`] ?? names[`block.minecraft.${p}`]);
      });
      const out: VNode[] = ids.slice(0, FILTER_LIMIT).map((id) => ({ type: 'entry', kind, id }));
      if (ids.length > FILTER_LIMIT) out.push({ type: 'message', text: vscode.l10n.t('{0} more results — refine the filter', ids.length - FILTER_LIMIT) });
      return out;
    }
    const paths = ids.map((id) => parseRL(id).path);
    if (folders && paths.some((p) => p.includes('/'))) {
      return this.fromPathTree(
        buildPathTree(ids, (id) => parseRL(id).path),
        kind,
        key,
      );
    }
    if (ids.length > BUCKET_THRESHOLD) {
      return bucketByLetter(ids, (id) => parseRL(id).path).map((b) => ({ type: 'bucket', key: `${key}:${b.letter}`, kind, letter: b.letter, ids: b.items }));
    }
    return ids.sort().map((id) => ({ type: 'entry', kind, id }));
  }

  private fromPathTree(nodes: TreeNode<string>[], kind: string, key: string): VNode[] {
    const out: VNode[] = [];
    const leaves: string[] = [];
    for (const n of nodes) {
      if (n.type === 'folder') out.push({ type: 'folder', key: `${key}/${n.name}`, kind, name: n.name, children: n.children });
      else leaves.push(n.item);
    }
    if (leaves.length > BUCKET_THRESHOLD) {
      out.push(...bucketByLetter(leaves, (id) => parseRL(id).path.split('/').pop() ?? id).map<VNode>((b) => ({ type: 'bucket', key: `${key}:${b.letter}`, kind, letter: b.letter, ids: b.items })));
    } else out.push(...leaves.map<VNode>((id) => ({ type: 'entry', kind, id })));
    return out;
  }

  async getChildren(node?: VNode): Promise<VNode[]> {
    if (!node) return ROOTS.map((r) => ({ type: 'root', key: r.key }));
    switch (node.type) {
      case 'root':
        switch (node.key) {
          case 'items':
            return this.listing('item', 'items', false);
          case 'blocks':
            return this.listing('block', 'blocks', false);
          case 'recipes':
            return this.listing('recipe', 'recipes', true);
          case 'loot':
            return this.listing('loot_table', 'loot', true);
          case 'advancements':
            return this.listing('advancement', 'advancements', true);
          case 'tags': {
            const regs = await this.registryNames();
            const tagRegs = regs.filter((r) => r.startsWith('tag/')).map((r) => r.slice(4));
            const list = tagRegs.length ? tagRegs : ['item', 'block', 'entity_type', 'fluid'];
            return list.sort().map((registry) => ({ type: 'tagRegistry', registry }));
          }
          case 'registries': {
            const regs = (await this.registryNames()).filter((r) => !r.startsWith('tag/') && !r.includes('/tag/'));
            const shown = this.filter ? regs.filter((r) => matchesFilter(this.filter, r)) : regs;
            return shown.sort().map((name) => ({ type: 'registry', name }));
          }
        }
        return [];
      case 'tagRegistry':
        return this.listing(`tags/${node.registry}`, `tags/${node.registry}`, true);
      case 'registry':
        return this.listing(node.name, `reg/${node.name}`, isDataDrivenRegistry(node.name));
      case 'bucket':
        return node.ids.map((id) => ({ type: 'entry', kind: node.kind, id }));
      case 'folder':
        return this.fromPathTree(node.children, node.kind, node.key);
      default:
        return [];
    }
  }

  private async registryNames(): Promise<string[]> {
    try {
      return Object.keys(await this.core.vanilla.registries(this.version));
    } catch {
      return [];
    }
  }

  async getTreeItem(node: VNode): Promise<vscode.TreeItem> {
    const C = vscode.TreeItemCollapsibleState;
    const expanded = this.filter ? C.Expanded : C.Collapsed;
    switch (node.type) {
      case 'root': {
        const r = ROOTS.find((x) => x.key === node.key)!;
        const item = new vscode.TreeItem(vscode.l10n.t(r.label), this.filter && node.key !== 'tags' && node.key !== 'registries' ? C.Expanded : C.Collapsed);
        item.id = `vroot:${this.version}:${node.key}`;
        item.iconPath = new vscode.ThemeIcon(r.icon);
        if (node.key === 'items') item.description = this.version;
        return item;
      }
      case 'bucket': {
        const item = new vscode.TreeItem(node.letter, C.Collapsed);
        item.id = `vbucket:${this.version}:${node.key}`;
        item.description = String(node.ids.length);
        item.iconPath = new vscode.ThemeIcon('symbol-folder');
        return item;
      }
      case 'folder': {
        const item = new vscode.TreeItem(node.name, expanded);
        item.id = `vfolder:${this.version}:${node.key}`;
        item.iconPath = vscode.ThemeIcon.Folder;
        return item;
      }
      case 'tagRegistry': {
        const item = new vscode.TreeItem(node.registry, expanded);
        item.id = `vtagreg:${this.version}:${node.registry}`;
        item.iconPath = new vscode.ThemeIcon('tag');
        return item;
      }
      case 'registry': {
        const item = new vscode.TreeItem(node.name, C.Collapsed);
        item.id = `vreg:${this.version}:${node.name}`;
        item.iconPath = new vscode.ThemeIcon(isDataDrivenRegistry(node.name) ? 'json' : 'symbol-enum');
        item.contextValue = 'vscodecraft.vanilla.registry';
        item.command = { command: 'vscodecraft.explorer.vanillaOpen', title: vscode.l10n.t('Open'), arguments: [{ type: 'entry', kind: 'registry', id: `minecraft:${node.name}` }] };
        return item;
      }
      case 'message': {
        const item = new vscode.TreeItem(node.text, C.None);
        item.iconPath = new vscode.ThemeIcon('info');
        item.command = node.command;
        return item;
      }
      case 'entry':
        return this.entryItem(node);
    }
  }

  private async entryItem(node: { kind: string; id: string }): Promise<vscode.TreeItem> {
    const isTag = node.kind.startsWith('tags/');
    const rl = parseRL(node.id);
    const label = this.filter ? rl.path : (rl.path.split('/').pop() ?? rl.path);
    const item = new vscode.TreeItem(isTag ? `#${label}` : label, vscode.TreeItemCollapsibleState.None);
    item.id = `ventry:${this.version}:${node.kind}:${node.id}`;
    const name = await this.displayName(node.kind, node.id);
    item.description = name;
    item.tooltip = `${isTag ? '#' : ''}${normalizeId(node.id)}${name ? `\n${name}` : ''}\n${vscode.l10n.t('Minecraft {0}', this.version)}`;
    item.contextValue = isCopyableKind(node.kind) ? 'vscodecraft.vanilla.file' : 'vscodecraft.vanilla.entry';
    item.command = { command: 'vscodecraft.explorer.vanillaOpen', title: vscode.l10n.t('Open'), arguments: [{ type: 'entry', kind: node.kind, id: node.id }] };
    let icon: vscode.Uri | undefined;
    if (node.kind === 'item') icon = await this.icons.itemIcon(node.id, this.version);
    else if (node.kind === 'block') icon = (await this.icons.itemIcon(node.id, this.version)) ?? (await this.icons.modelIcon(`minecraft:block/${rl.path}`, this.version));
    else if (node.kind === 'recipe') {
      // Use the result item's icon when the summary is available.
      const recipe = (await this.core.vanilla.recipes(this.version).catch(() => ({}) as Record<string, any>))[normalizeId(node.id)];
      const result = recipe?.result?.id ?? recipe?.result?.item ?? (typeof recipe?.result === 'string' ? recipe.result : undefined);
      if (typeof result === 'string') icon = await this.icons.itemIcon(result, this.version);
    }
    item.iconPath = icon ?? new vscode.ThemeIcon(isTag ? 'tag' : node.kind === 'item' ? 'package' : node.kind === 'block' ? 'symbol-structure' : 'json');
    return item;
  }

  getParent(): undefined {
    return undefined;
  }
}

/** Read-only virtual documents for vanilla data: vscodecraft-vanilla-browse:/<version>/<kind>/<ns>/<path>.json */
export class VanillaDocProvider implements vscode.TextDocumentContentProvider {
  constructor(private readonly core: Core) {}

  static uri(version: string, kind: string, id: string): vscode.Uri {
    return vscode.Uri.from({ scheme: VANILLA_SCHEME, path: vanillaDocPath(version, kind, normalizeId(id)) });
  }

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const parsed = parseVanillaDocPath(uri.path);
    if (!parsed) return '// ' + vscode.l10n.t('Invalid vanilla resource URI');
    const value = await vanillaJson(this.core, parsed.version, parsed.kind, parsed.id);
    if (value === undefined) {
      return JSON.stringify(
        { id: parsed.id, error: vscode.l10n.t('Not available: download vanilla data for {0} (VSCodeCraft: Download vanilla data) or check your connection.', parsed.version) },
        null,
        2,
      );
    }
    return JSON.stringify(value, null, 2) + '\n';
  }
}

/** Raw data file path of a data kind entry. */
export function vanillaDataPath(version: string, kind: string, id: string): string {
  const rl = parseRL(normalizeId(id));
  return `data/${rl.namespace}/${dataFolder(kind, version)}/${rl.path}.json`;
}

/** JSON content for a vanilla entry (raw data file when possible, summaries otherwise). */
export async function vanillaJson(core: Core, version: string, kind: string, id: string): Promise<unknown> {
  const v = core.vanilla;
  const rl = parseRL(normalizeId(id));
  const safe = async <T>(p: Promise<T>): Promise<T | undefined> => {
    try {
      return await p;
    } catch {
      return undefined;
    }
  };
  if (kind === 'registry') {
    const ids = await safe(v.registry(version, rl.path));
    return ids ? { registry: rl.path, version, count: ids.length, entries: ids } : undefined;
  }
  if (kind === 'item' || kind === 'block') {
    const lang = (await safe(v.lang(version))) ?? {};
    const p = rl.path.replace(/\//g, '.');
    const out: Record<string, unknown> = {
      id: normalizeId(id),
      name: kind === 'block' ? lang[`block.${rl.namespace}.${p}`] : (lang[`item.${rl.namespace}.${p}`] ?? lang[`block.${rl.namespace}.${p}`]),
    };
    if (kind === 'item') {
      out.components = (await safe(v.itemComponents(version)))?.[normalizeId(id)];
      if (atLeast(version, '1.21.4')) out.item_definition = (await safe(v.itemDefinitions(version)))?.[rl.path];
      const models = (await safe(v.models(version))) ?? {};
      out.model = models[`item/${rl.path}`] ?? models[`block/${rl.path}`];
      const recipes = (await safe(v.recipes(version))) ?? {};
      out.recipes = Object.entries(recipes)
        .filter(([, r]: [string, any]) => {
          const res = r?.result?.id ?? r?.result?.item ?? r?.result;
          return typeof res === 'string' && normalizeId(res) === normalizeId(id);
        })
        .map(([k]) => k);
    } else {
      out.properties = (await safe(v.blocks(version)))?.[normalizeId(id)];
      out.blockstate = (await safe(v.blockDefinitions(version)))?.[rl.path];
      out.loot_table = await safe(v.dataFile(version, `data/${rl.namespace}/${dataFolder('loot_table', version)}/blocks/${rl.path}.json`));
    }
    const registry = kind;
    const tags = (await safe(v.tags(version, registry))) ?? {};
    out.tags = Object.entries(tags)
      .filter(([, values]) => values.includes(normalizeId(id)) || values.includes(rl.path))
      .map(([k]) => `#${k}`);
    return out;
  }
  if (kind.startsWith('tags/')) {
    const reg = kind.slice(5);
    const file = await safe(v.dataFile(version, vanillaDataPath(version, kind, id)));
    if (file) return file;
    const tags = await safe(v.tags(version, reg));
    const values = tags?.[normalizeId(id)];
    return values ? { values } : undefined;
  }
  // recipe, loot_table, advancement and any data-driven registry
  const file = await safe(v.dataFile(version, vanillaDataPath(version, kind, id)));
  if (file !== undefined) return file;
  const summary =
    kind === 'recipe'
      ? await safe(v.recipes(version))
      : kind === 'loot_table'
        ? await safe(v.lootTables(version))
        : kind === 'advancement'
          ? await safe(v.advancements(version))
          : await safe(v.dataFolder(version, kind));
  const fromSummary = summary?.[normalizeId(id)];
  if (fromSummary !== undefined) return fromSummary;
  if (!isDataDrivenRegistry(kind)) return { id: normalizeId(id), registry: kind, name: humanize(rl.path) };
  return undefined;
}

/** "Copy to my mod": write the vanilla file into the default namespace, keeping its path. */
export async function copyVanillaToMod(core: Core, node: { kind: string; id: string }): Promise<void> {
  const version = core.version();
  const value = await vanillaJson(core, version, node.kind, node.id);
  if (value === undefined) {
    void vscode.window.showWarningMessage(vscode.l10n.t('Could not load {0} for Minecraft {1}.', node.id, version));
    return;
  }
  const root = core.projects.resourceRoot();
  if (!root) {
    void vscode.window.showWarningMessage(vscode.l10n.t('Open a folder or create a project first.'));
    return;
  }
  const ns = core.projects.defaultNamespace();
  const path = parseRL(normalizeId(node.id)).path;
  const rel = vanillaDataPath(version, node.kind, `${ns}:${path}`);
  const target = vscode.Uri.joinPath(root, ...rel.split('/'));
  if (await createFile(target, JSON.stringify(value, null, 2) + '\n', 'ask')) {
    await vscode.window.showTextDocument(target);
    void vscode.window.showInformationMessage(vscode.l10n.t('Copied {0} to {1}', normalizeId(node.id), `${ns}:${path}`));
  }
}
