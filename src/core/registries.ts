import * as vscode from 'vscode';
import type { RegistryEntryInfo } from '../shared/protocol';
import { humanize, normalizeId, parseRL } from './resourceLocation';
import { readText } from './fsUtils';
import { EXCLUDE_GLOB, WorkspaceIndex } from './workspaceIndex';
import type { ProjectService } from './projects';
import type { VanillaDataService } from './vanillaData';
import type { Logger } from './logger';

/** Registries whose workspace entries come from data-driven files of the same kind. */
const DATA_DRIVEN: Record<string, string> = {
  enchantment: 'enchantment',
  damage_type: 'damage_type',
  trim_material: 'trim_material',
  trim_pattern: 'trim_pattern',
  banner_pattern: 'banner_pattern',
  painting_variant: 'painting_variant',
  jukebox_song: 'jukebox_song',
  instrument: 'instrument',
  chat_type: 'chat_type',
  dimension_type: 'dimension_type',
  dimension: 'dimension',
  wolf_variant: 'wolf_variant',
  cat_variant: 'cat_variant',
  pig_variant: 'pig_variant',
  cow_variant: 'cow_variant',
  chicken_variant: 'chicken_variant',
  frog_variant: 'frog_variant',
  dialog: 'dialog',
  loot_table: 'loot_table',
  recipe: 'recipe',
  advancement: 'advancement',
  predicate: 'predicate',
  item_modifier: 'item_modifier',
  function: 'function',
  structure: 'structure',
  model: 'models',
  texture: 'textures',
  item_definition: 'items',
  block_definition: 'blockstates',
  equipment: 'equipment',
  font: 'font',
  atlas: 'atlases',
};

const LANG_PREFIX: Record<string, string[]> = {
  item: ['item', 'block'],
  block: ['block'],
  entity_type: ['entity'],
  enchantment: ['enchantment'],
  mob_effect: ['effect'],
  'worldgen/biome': ['biome'],
};

/**
 * Merged view of vanilla registries (for the target version) and the workspace's own content.
 * Use this for completion, validation and pickers.
 */
export class RegistryService implements vscode.Disposable {
  private javaScan: Promise<Map<string, Set<string>>> | undefined;
  private namesCache = new Map<string, Promise<Map<string, string>>>();
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly vanilla: VanillaDataService,
    private readonly index: WorkspaceIndex,
    private readonly projects: ProjectService,
    private readonly log: Logger,
  ) {
    const reset = () => {
      this.namesCache.clear();
    };
    const java = vscode.workspace.createFileSystemWatcher('**/*.{java,kt}');
    const resetJava = () => (this.javaScan = undefined);
    this.disposables.push(
      index.onDidChange(reset),
      index.onDidChangeContent((u) => u.path.includes('/lang/') && reset()),
      projects.onDidChange(reset),
      java,
      java.onDidChange(resetJava),
      java.onDidCreate(resetJava),
      java.onDidDelete(resetJava),
    );
  }

  private version(uri?: vscode.Uri): string {
    return this.projects.targetVersion(uri);
  }

  /**
   * All ids of a registry, fully qualified. Tag registries use "tag/<registry>" and return ids WITHOUT "#".
   * Examples: ids('item'), ids('block'), ids('tag/item'), ids('enchantment'), ids('worldgen/biome'), ids('sound_event').
   */
  async ids(registry: string, uri?: vscode.Uri): Promise<Set<string>> {
    const out = new Set<string>();
    for (const e of await this.entries(registry, uri)) out.add(e.id);
    return out;
  }

  /** Entries (id + display name + source) of a registry, vanilla first then workspace. */
  async entries(registry: string, uri?: vscode.Uri): Promise<RegistryEntryInfo[]> {
    const version = this.version(uri);
    const names = await this.names(uri);
    const map = new Map<string, RegistryEntryInfo>();
    let vanillaIds: string[] = [];
    try {
      vanillaIds = await this.vanilla.registry(version, registry);
    } catch (e) {
      this.log.warn(`registry ${registry}: ${e}`);
    }
    for (const id of vanillaIds) map.set(id, { id, name: names.get(id), source: 'vanilla' });
    for (const id of await this.workspaceIds(registry)) {
      if (!map.has(id)) map.set(id, { id, name: names.get(id) ?? humanize(parseRL(id).path), source: 'workspace' });
    }
    return [...map.values()];
  }

  async has(registry: string, id: string, uri?: vscode.Uri): Promise<boolean> {
    return (await this.ids(registry, uri)).has(normalizeId(id));
  }

  /** Ids defined by the workspace (mods / packs) for a registry. */
  async workspaceIds(registry: string): Promise<Set<string>> {
    await this.index.ready;
    const out = new Set<string>();
    if (registry.startsWith('tag/')) {
      for (const id of this.index.ids(`tags/${registry.slice(4)}`)) out.add(id);
      return out;
    }
    const kind = DATA_DRIVEN[registry] ?? (registry.startsWith('worldgen/') ? registry : undefined);
    if (kind) {
      for (const id of this.index.ids(kind)) out.add(id);
      return out;
    }
    if (registry === 'sound_event') {
      for (const r of this.index.all('sounds')) {
        const j = await this.index.json<Record<string, unknown>>(r.uri);
        for (const k of Object.keys(j ?? {})) out.add(`${r.namespace}:${k}`);
      }
      return out;
    }
    // Lang-derived ids (item.<ns>.<path>, block.<ns>.<path>, entity.<ns>.<path> ...)
    const prefixes = LANG_PREFIX[registry];
    if (prefixes) {
      for (const r of this.index.all('lang')) {
        if (r.namespace === 'minecraft') continue;
        const j = await this.index.json<Record<string, string>>(r.uri);
        for (const key of Object.keys(j ?? {})) {
          const parts = key.split('.');
          if (parts.length === 3 && prefixes.includes(parts[0]) && parts[1] !== 'minecraft') out.add(`${parts[1]}:${parts[2]}`);
        }
      }
    }
    if (registry === 'item') {
      for (const id of this.index.ids('items')) if (!id.startsWith('minecraft:')) out.add(id);
      for (const id of this.index.ids('models')) {
        const rl = parseRL(id);
        if (rl.namespace !== 'minecraft' && rl.path.startsWith('item/')) out.add(`${rl.namespace}:${rl.path.slice(5)}`);
      }
      for (const id of this.index.ids('blockstates')) if (!id.startsWith('minecraft:')) out.add(id);
    }
    if (registry === 'block') {
      for (const id of this.index.ids('blockstates')) if (!id.startsWith('minecraft:')) out.add(id);
    }
    const java = await this.scanJava();
    for (const id of java.get(registry) ?? []) out.add(id);
    return out;
  }

  /** Display names (lang) for items, blocks, entities, enchantments, effects, biomes: id -> name. */
  names(uri?: vscode.Uri): Promise<Map<string, string>> {
    const version = this.version(uri);
    const locale = this.locale();
    const key = `${version}:${locale}`;
    let p = this.namesCache.get(key);
    if (!p) {
      p = (async () => {
        const out = new Map<string, string>();
        const add = (lang: Record<string, string>) => {
          for (const [k, v] of Object.entries(lang)) {
            const parts = k.split('.');
            if (parts.length !== 3) continue;
            const id = `${parts[1]}:${parts[2]}`;
            // Items take precedence over blocks with the same id (e.g. item names for block items)
            if (parts[0] === 'item' || !out.has(id)) out.set(id, v);
          }
        };
        try {
          add(await this.vanilla.lang(version, locale));
        } catch {
          add(this.vanilla.bundledData(version).lang);
        }
        const en = await this.index.lang('en_us');
        add(en);
        if (locale !== 'en_us') add(await this.index.lang(locale));
        return out;
      })();
      this.namesCache.set(key, p);
    }
    return p;
  }

  async displayName(id: string, uri?: vscode.Uri): Promise<string> {
    const nid = normalizeId(id);
    return (await this.names(uri)).get(nid) ?? humanize(parseRL(nid).path);
  }

  /** Locale used for display names: setting, else VS Code's language (es -> es_es), else en_us. */
  locale(): string {
    const s = vscode.workspace.getConfiguration('vscodecraft').get<string>('displayLanguage', 'auto');
    if (s && s !== 'auto') return s;
    const lang = vscode.env.language.toLowerCase();
    if (lang.startsWith('es')) return 'es_es';
    if (lang.startsWith('pt')) return 'pt_br';
    if (lang.startsWith('fr')) return 'fr_fr';
    if (lang.startsWith('de')) return 'de_de';
    if (lang.startsWith('it')) return 'it_it';
    return 'en_us';
  }

  /**
   * Recursively expand a tag to concrete ids (vanilla tags + workspace tag files, honouring "replace").
   * `tag` may include the leading "#". `registry` defaults to "item".
   */
  async expandTag(tag: string, registry = 'item', uri?: vscode.Uri, seen = new Set<string>()): Promise<string[]> {
    const id = normalizeId(tag.replace(/^#/, ''));
    if (seen.has(id)) return [];
    seen.add(id);
    const version = this.version(uri);
    const vanillaTags = await this.vanilla.tags(version, registry).catch(() => ({}) as Record<string, string[]>);
    let values: string[] = [];
    const ws = await this.index.tagValues(registry, id);
    if (!ws?.replace) values.push(...(vanillaTags[id] ?? []));
    if (ws) values.push(...ws.values);
    const out: string[] = [];
    for (const v of values) {
      if (v.startsWith('#')) out.push(...(await this.expandTag(v, registry, uri, seen)));
      else out.push(normalizeId(v));
    }
    return [...new Set(out)];
  }

  /** Search entries by id or display name (case-insensitive, prefix matches first). */
  async search(query: string, opts: { registry?: string; limit?: number } = {}, uri?: vscode.Uri): Promise<RegistryEntryInfo[]> {
    const registry = opts.registry ?? 'item';
    const limit = opts.limit ?? 60;
    const all = await this.entries(registry, uri);
    const q = query.trim().toLowerCase();
    if (!q) {
      // Workspace entries first, then vanilla
      return [...all.filter((e) => e.source === 'workspace'), ...all.filter((e) => e.source === 'vanilla')].slice(0, limit);
    }
    const scored: [number, RegistryEntryInfo][] = [];
    for (const e of all) {
      const id = e.id.toLowerCase();
      const path = id.split(':')[1] ?? id;
      const name = (e.name ?? '').toLowerCase();
      let s = -1;
      if (path === q || name === q) s = 0;
      else if (path.startsWith(q) || name.startsWith(q)) s = 1;
      else if (path.includes(q) || name.includes(q) || id.includes(q)) s = 2;
      if (s >= 0) scored.push([s * 10 + (e.source === 'workspace' ? 0 : 1), e]);
    }
    scored.sort((a, b) => a[0] - b[0] || a[1].id.length - b[1].id.length);
    return scored.slice(0, limit).map((x) => x[1]);
  }

  /** Heuristic scan of Java/Kotlin registration code: registry -> ids. */
  private scanJava(): Promise<Map<string, Set<string>>> {
    if (!this.javaScan) {
      this.javaScan = (async () => {
        const out = new Map<string, Set<string>>();
        const add = (reg: string, id: string) => {
          let s = out.get(reg);
          if (!s) out.set(reg, (s = new Set()));
          s.add(id);
        };
        try {
          const files = await vscode.workspace.findFiles('**/src/**/*.{java,kt}', EXCLUDE_GLOB, 3000);
          for (const f of files) {
            const name = f.path.split('/').pop() ?? '';
            const kinds: string[] = [];
            if (/Block/i.test(name)) kinds.push('block', 'item');
            if (/Item/i.test(name)) kinds.push('item');
            if (/Entit/i.test(name)) kinds.push('entity_type');
            if (/Sound/i.test(name)) kinds.push('sound_event');
            if (/Effect/i.test(name)) kinds.push('mob_effect');
            if (/Potion/i.test(name)) kinds.push('potion');
            if (/Particle/i.test(name)) kinds.push('particle_type');
            if (/(Creative|Tab)/i.test(name)) kinds.push('creative_mode_tab');
            if (/Component/i.test(name)) kinds.push('data_component_type');
            if (/Menu|ScreenHandler/i.test(name)) kinds.push('menu');
            if (/Recipe/i.test(name)) kinds.push('recipe_serializer', 'recipe_type');
            if (!kinds.length) continue;
            const text = await readText(f);
            if (!text) continue;
            const ns = this.projects.defaultNamespace(f);
            const ids = new Set<string>();
            for (const m of text.matchAll(/\bregister\w*\(\s*"([a-z0-9_/.-]+)"/g)) ids.add(m[1]);
            for (const m of text.matchAll(/(?:Identifier|ResourceLocation)\s*\.\s*(?:of|fromNamespaceAndPath|tryBuild|parse)\(\s*[A-Za-z_.]+\s*,\s*"([a-z0-9_/.-]+)"/g)) ids.add(m[1]);
            for (const m of text.matchAll(/new\s+(?:Identifier|ResourceLocation)\(\s*[A-Za-z_.]+\s*,\s*"([a-z0-9_/.-]+)"/g)) ids.add(m[1]);
            for (const id of ids) for (const k of kinds) add(k, `${ns}:${id}`);
          }
        } catch (e) {
          this.log.warn(`Java scan failed: ${e}`);
        }
        return out;
      })();
    }
    return this.javaScan;
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
  }
}
