// Pure helpers for the Resources / Vanilla trees (no 'vscode' import).

export interface CategoryInfo {
  /** Stable key, e.g. "recipe", "tags", "worldgen", "other". */
  key: string;
  /** English label (localized by the caller). */
  label: string;
  /** Codicon id. */
  icon: string;
  order: number;
  /** For grouped categories (tags, worldgen, other): sub-group label for the kind. */
  group?: string;
}

const CATEGORIES: Record<string, Omit<CategoryInfo, 'group'>> = {
  recipe: { key: 'recipe', label: 'Recipes', icon: 'tools', order: 0 },
  loot_table: { key: 'loot_table', label: 'Loot Tables', icon: 'gift', order: 1 },
  advancement: { key: 'advancement', label: 'Advancements', icon: 'star-empty', order: 2 },
  tags: { key: 'tags', label: 'Tags', icon: 'tag', order: 3 },
  function: { key: 'function', label: 'Functions', icon: 'terminal', order: 4 },
  models: { key: 'models', label: 'Models', icon: 'symbol-structure', order: 5 },
  textures: { key: 'textures', label: 'Textures', icon: 'file-media', order: 6 },
  blockstates: { key: 'blockstates', label: 'Blockstates', icon: 'layers', order: 7 },
  items: { key: 'items', label: 'Item Definitions', icon: 'symbol-field', order: 8 },
  lang: { key: 'lang', label: 'Lang', icon: 'globe', order: 9 },
  sounds: { key: 'sounds', label: 'Sounds', icon: 'unmute', order: 10 },
  worldgen: { key: 'worldgen', label: 'Worldgen', icon: 'globe', order: 11 },
  enchantment: { key: 'enchantment', label: 'Enchantments', icon: 'sparkle', order: 12 },
  other: { key: 'other', label: 'Other', icon: 'folder', order: 20 },
};

/** Which tree category a resource kind belongs to. */
export function categorize(kind: string): CategoryInfo {
  if (kind.startsWith('tags/')) return { ...CATEGORIES.tags, group: kind.slice(5) };
  if (kind.startsWith('worldgen/')) return { ...CATEGORIES.worldgen, group: kind.slice(9) };
  if (kind === 'enchantment' || kind === 'enchantment_provider') return { ...CATEGORIES.enchantment, group: kind === 'enchantment' ? undefined : kind };
  const c = CATEGORIES[kind];
  if (c) return { ...c };
  return { ...CATEGORIES.other, group: kind };
}

export const CATEGORY_LABELS = Object.values(CATEGORIES).map((c) => c.label);

export interface TreeLeaf<T> {
  type: 'leaf';
  name: string;
  item: T;
}
export interface TreeFolder<T> {
  type: 'folder';
  name: string;
  /** Path of the folder from the tree root ("block/ores"). */
  path: string;
  children: TreeNode<T>[];
}
export type TreeNode<T> = TreeLeaf<T> | TreeFolder<T>;

/**
 * Nest items by "/"-separated paths into folders (folders first, alphabetical).
 * Single-child folder chains are NOT collapsed (keeps paths predictable).
 */
export function buildPathTree<T>(items: T[], pathOf: (t: T) => string, base = ''): TreeNode<T>[] {
  const root: TreeFolder<T> = { type: 'folder', name: '', path: base, children: [] };
  const folders = new Map<string, TreeFolder<T>>([['', root]]);
  const folderFor = (dir: string): TreeFolder<T> => {
    let f = folders.get(dir);
    if (f) return f;
    const i = dir.lastIndexOf('/');
    const parent = folderFor(i >= 0 ? dir.slice(0, i) : '');
    f = { type: 'folder', name: i >= 0 ? dir.slice(i + 1) : dir, path: base ? `${base}/${dir}` : dir, children: [] };
    parent.children.push(f);
    folders.set(dir, f);
    return f;
  };
  for (const it of items) {
    const p = pathOf(it);
    const i = p.lastIndexOf('/');
    folderFor(i >= 0 ? p.slice(0, i) : '').children.push({ type: 'leaf', name: i >= 0 ? p.slice(i + 1) : p, item: it });
  }
  const sort = (nodes: TreeNode<T>[]) => {
    nodes.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'folder' ? -1 : 1));
    for (const n of nodes) if (n.type === 'folder') sort(n.children);
  };
  sort(root.children);
  return root.children;
}

/** Split a long flat list into buckets by first letter ("A", "B", … "#" for digits/symbols). */
export function bucketByLetter<T>(items: T[], keyOf: (t: T) => string): { letter: string; items: T[] }[] {
  const map = new Map<string, T[]>();
  for (const it of items) {
    const ch = keyOf(it).charAt(0).toUpperCase();
    const letter = /[A-Z]/.test(ch) ? ch : '#';
    const list = map.get(letter) ?? [];
    list.push(it);
    map.set(letter, list);
  }
  return [...map.entries()]
    .sort(([a], [b]) => (a === '#' ? -1 : b === '#' ? 1 : a.localeCompare(b)))
    .map(([letter, list]) => ({ letter, items: list.sort((x, y) => keyOf(x).localeCompare(keyOf(y))) }));
}

/** Simple case-insensitive filter: every whitespace-separated term must appear in the haystack. */
export function matchesFilter(filter: string, ...haystack: (string | undefined)[]): boolean {
  const terms = filter.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const text = haystack.filter(Boolean).join(' ').toLowerCase();
  return terms.every((t) => text.includes(t));
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Replace JSON string references to a resource id: "ns:old" → "ns:new" and "#ns:old" → "#ns:new".
 * When the namespace is "minecraft", the short form "old" is NOT touched (too ambiguous).
 * Returns the new text and the number of replacements.
 */
export function replaceReferences(text: string, oldId: string, newId: string): { text: string; count: number } {
  let count = 0;
  const re = new RegExp(`"(#?)${escapeRegExp(oldId)}"`, 'g');
  const out = text.replace(re, (_m, hash: string) => {
    count++;
    return `"${hash}${newId}"`;
  });
  return { text: out, count };
}

/** Ids that change when a resource of a kind is renamed (textures/models are referenced by "ns:path"). */
export function referenceIds(namespace: string, path: string): string {
  return `${namespace}:${path}`;
}

/** Validate a new resource path ("item/ruby_gem"). */
export function isValidResourcePath(p: string): boolean {
  return /^[a-z0-9_.-]+(\/[a-z0-9_.-]+)*$/.test(p);
}

/** Display label for a vanilla registry name: "worldgen/biome" → "worldgen/biome", "item" → "item". */
export function registryLabel(name: string): string {
  return name.replace(/^minecraft:/, '');
}

/**
 * Data-driven registries whose entries are JSON files under data/<ns>/<folder>/ (folder == registry name).
 * Used to decide whether a vanilla registry entry can be opened / copied.
 */
export const DATA_DRIVEN_REGISTRIES = new Set([
  'recipe',
  'loot_table',
  'advancement',
  'predicate',
  'item_modifier',
  'enchantment',
  'enchantment_provider',
  'damage_type',
  'trim_material',
  'trim_pattern',
  'banner_pattern',
  'painting_variant',
  'jukebox_song',
  'instrument',
  'chat_type',
  'dimension_type',
  'wolf_variant',
  'wolf_sound_variant',
  'cat_variant',
  'pig_variant',
  'cow_variant',
  'chicken_variant',
  'frog_variant',
  'dialog',
  'test_instance',
  'test_environment',
  'trade_set',
  'villager_trade',
  'timeline',
  'world_clock',
]);

const WORLDGEN_DATA = new Set([
  'biome',
  'configured_carver',
  'configured_feature',
  'placed_feature',
  'structure',
  'structure_set',
  'template_pool',
  'processor_list',
  'noise',
  'noise_settings',
  'density_function',
  'world_preset',
  'flat_level_generator_preset',
  'multi_noise_biome_source_parameter_list',
]);

export function isDataDrivenRegistry(name: string): boolean {
  return DATA_DRIVEN_REGISTRIES.has(name) || (name.startsWith('worldgen/') && WORLDGEN_DATA.has(name.slice(9)));
}

/** Pick the most representative texture of a merged model's texture map (for small icons). */
export function pickIconTexture(textures: Record<string, string>): string | undefined {
  const resolve = (v: string | undefined): string | undefined => {
    for (let i = 0; v?.startsWith('#') && i < 10; i++) v = textures[v.slice(1)];
    return v && !v.startsWith('#') ? v : undefined;
  };
  for (const k of ['layer0', 'all', 'side', 'texture', 'top', 'end', 'cross', 'plant', 'particle']) {
    const v = resolve(textures[k]);
    if (v) return v;
  }
  for (const v of Object.values(textures)) {
    const r = resolve(v);
    if (r) return r;
  }
  return undefined;
}

/** URI path for the vanilla browse scheme: "/<version>/<kind>/<ns>/<path>.json". */
export function vanillaDocPath(version: string, kind: string, id: string): string {
  const i = id.indexOf(':');
  const ns = i >= 0 ? id.slice(0, i) : 'minecraft';
  const p = i >= 0 ? id.slice(i + 1) : id;
  return `/${version}/${kind.replace(/\//g, '~')}/${ns}/${p}.json`;
}

export function parseVanillaDocPath(path: string): { version: string; kind: string; id: string } | undefined {
  const m = /^\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)\.json$/.exec(path);
  if (!m) return undefined;
  return { version: m[1], kind: m[2].replace(/~/g, '/'), id: `${m[3]}:${m[4]}` };
}

/** mcfunction: replace whole-token ids (ns:old, #ns:old). */
export function replaceFunctionReferences(text: string, oldId: string, newId: string): { text: string; count: number } {
  let count = 0;
  const esc = oldId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const out = text.replace(new RegExp(`(^|[\\s"'#\\[{,=])${esc}(?![a-z0-9_./-])`, 'gm'), (_m, pre: string) => {
    count++;
    return pre + newId;
  });
  return { text: out, count };
}
