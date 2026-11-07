// Minecraft version knowledge: pack formats and format/feature differences between versions.
// Pure module (no 'vscode' import) so it can be unit tested.
import bundledVersions from '../../resources/data/versions.json';

export interface McVersion {
  id: string;
  type: 'release' | 'snapshot' | string;
  dataPack: number;
  dataPackMinor: number;
  resourcePack: number;
  resourcePackMinor: number;
  dataVersion: number;
  releaseTime: string;
}

/** Bundled version table (newest first). Can be refreshed at runtime by VanillaDataService. */
let versionTable: McVersion[] = bundledVersions as McVersion[];

export function setVersionTable(list: McVersion[]): void {
  if (list.length) versionTable = list;
}

export function getVersions(includeSnapshots = false): McVersion[] {
  return versionTable.filter((v) => includeSnapshots || v.type === 'release');
}

export function getVersion(id: string): McVersion | undefined {
  return versionTable.find((v) => v.id === id);
}

export function latestRelease(): string {
  return versionTable.find((v) => v.type === 'release')?.id ?? '26.3';
}

/** Versions bundled inside the extension (offline registries / tags / names). */
export const BUNDLED_DATA_VERSIONS = ['26.3', '1.21.11', '1.21.1'] as const;

/**
 * Parse "1.21.4", "26.1", "26.1.2", "26.4-snapshot-7", "1.21.5-pre1", "25w14a" into a comparable tuple.
 * New-style versions (26.x) compare greater than every 1.x version.
 */
export function parseVersion(id: string): number[] {
  const m = /^(\d+)\.(\d+)(?:\.(\d+))?/.exec(id);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const c = Number(m[3] ?? 0);
    // 1.21.4 -> [1,21,4]; 26.1.2 -> [26,1,2]; snapshots/pre-releases of X sort just before X
    const pre = /-(snapshot|pre|rc)/.test(id) ? -1 : 0;
    return [a, b, c, pre];
  }
  const snap = /^(\d\d)w(\d\d)[a-z]$/.exec(id);
  if (snap) {
    // Old-style weekly snapshots: map by year/week onto the release timeline approximately.
    const year = Number(snap[1]);
    const week = Number(snap[2]);
    if (year >= 26) return [26, Math.floor(week / 13), 0, -1];
    if (year === 25) return [1, 21, week < 10 ? 5 : week < 20 ? 6 : week < 34 ? 9 : 11, -1];
    if (year === 24) return [1, 21, week < 30 ? 0 : week < 44 ? 2 : 4, -1];
    return [1, 20, 0, -1];
  }
  return [0, 0, 0, 0];
}

export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  for (let i = 0; i < 4; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

export const atLeast = (v: string, min: string): boolean => compareVersions(v, min) >= 0;

/** Pick the closest bundled data version for a target version. */
export function closestBundledVersion(v: string): string {
  if (atLeast(v, '26.1')) return '26.3';
  if (atLeast(v, '1.21.2')) return '1.21.11';
  return '1.21.1';
}

/**
 * Format / feature differences that tools must respect when reading or writing files.
 * Every generator should go through this instead of hard-coding a format.
 */
export interface VersionFeatures {
  version: string;
  /** "recipe", "loot_table", "advancement", "tags/item"... singular folders since 1.21. */
  singularFolders: boolean;
  /**
   * Recipe ingredient syntax.
   *  - 'object': {"item":"minecraft:x"} / {"tag":"minecraft:y"} / [..] (1.21 – 1.21.1)
   *  - 'string': "minecraft:x" / "#minecraft:y" / ["minecraft:a","minecraft:b"] (1.21.2+)
   */
  ingredientFormat: 'object' | 'string';
  /** Shaped recipe keys must be single characters; result object uses "id" (1.20.5+). */
  resultUsesId: boolean;
  /** crafting_transmute recipe type exists (1.21.2+). */
  hasTransmuteRecipe: boolean;
  /** crafting_dye / crafting_imbue replaced crafting_special_armordye / tippedarrow (26.1+). */
  hasDyeImbueRecipes: boolean;
  /** Data-driven brewing recipes (minecraft:brewing) (26.3+). */
  hasBrewingRecipes: boolean;
  /** Item model definitions in assets/<ns>/items/*.json (1.21.4+). */
  hasItemDefinitions: boolean;
  /** Equipment assets folder: 'models/equipment' (1.21.2–1.21.3), 'equipment' (1.21.4+), or none. */
  equipmentFolder: 'equipment' | 'models/equipment' | null;
  /**
   * pack.mcmeta style:
   *  - 'pack_format': {"pack":{"pack_format":N,"description":...}} (+ optional supported_formats)
   *  - 'min_max':     {"pack":{"min_format":N|[N,m],"max_format":N|[N,m],"description":...}} (1.21.9+)
   */
  packMetaStyle: 'pack_format' | 'min_max';
  /** Item components in /give & loot functions (1.20.5+) — always true for 1.21+. */
  itemComponents: boolean;
  /** Item.Properties requires a registry key/id at construction (1.21.2+). */
  itemPropertiesNeedId: boolean;
  /** Minimum Java version for the game. */
  javaVersion: number;
  /** Game ships unobfuscated / official names only (26.1+). */
  unobfuscated: boolean;
  /** Data pack / resource pack formats for pack.mcmeta. */
  dataPackFormat: number;
  dataPackFormatMinor: number;
  resourcePackFormat: number;
  resourcePackFormatMinor: number;
}

export function getFeatures(version: string): VersionFeatures {
  const v = getVersion(version) ?? nearestKnown(version);
  return {
    version,
    singularFolders: atLeast(version, '1.21'),
    ingredientFormat: atLeast(version, '1.21.2') ? 'string' : 'object',
    resultUsesId: atLeast(version, '1.20.5'),
    hasTransmuteRecipe: atLeast(version, '1.21.2'),
    hasDyeImbueRecipes: atLeast(version, '26.1'),
    hasBrewingRecipes: atLeast(version, '26.3'),
    hasItemDefinitions: atLeast(version, '1.21.4'),
    equipmentFolder: atLeast(version, '1.21.4') ? 'equipment' : atLeast(version, '1.21.2') ? 'models/equipment' : null,
    packMetaStyle: atLeast(version, '1.21.9') ? 'min_max' : 'pack_format',
    itemComponents: atLeast(version, '1.20.5'),
    itemPropertiesNeedId: atLeast(version, '1.21.2'),
    javaVersion: atLeast(version, '26.1') ? 25 : 21,
    unobfuscated: atLeast(version, '26.1'),
    dataPackFormat: v?.dataPack ?? 0,
    dataPackFormatMinor: v?.dataPackMinor ?? 0,
    resourcePackFormat: v?.resourcePack ?? 0,
    resourcePackFormatMinor: v?.resourcePackMinor ?? 0,
  };
}

function nearestKnown(version: string): McVersion | undefined {
  // Newest known release that is <= version, else the oldest known.
  const releases = getVersions(true);
  return releases.find((r) => compareVersions(r.id, version) <= 0) ?? releases[releases.length - 1];
}

/**
 * Folder name for a data/asset kind for a version. `kind` uses the modern (singular) name.
 * e.g. dataFolder('recipe', '1.20.4') -> 'recipes'; dataFolder('tags/item','1.21') -> 'tags/item'
 */
export function dataFolder(kind: string, version: string): string {
  if (atLeast(version, '1.21')) return kind;
  const legacy: Record<string, string> = {
    recipe: 'recipes',
    loot_table: 'loot_tables',
    advancement: 'advancements',
    predicate: 'predicates',
    item_modifier: 'item_modifiers',
    function: 'functions',
    structure: 'structures',
    'tags/item': 'tags/items',
    'tags/block': 'tags/blocks',
    'tags/entity_type': 'tags/entity_types',
    'tags/fluid': 'tags/fluids',
    'tags/game_event': 'tags/game_events',
    'tags/function': 'tags/functions',
  };
  return legacy[kind] ?? kind;
}

/** Legacy (pre-1.21) folder -> modern folder. */
export const LEGACY_FOLDER_RENAMES: Record<string, string> = {
  recipes: 'recipe',
  loot_tables: 'loot_table',
  advancements: 'advancement',
  predicates: 'predicate',
  item_modifiers: 'item_modifier',
  functions: 'function',
  structures: 'structure',
  'tags/items': 'tags/item',
  'tags/blocks': 'tags/block',
  'tags/entity_types': 'tags/entity_type',
  'tags/fluids': 'tags/fluid',
  'tags/game_events': 'tags/game_event',
  'tags/functions': 'tags/function',
};
