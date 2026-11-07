// Resource locations ("namespace:path") and mapping between files and resource ids.
// Pure module (no 'vscode' import) so it can be unit tested. Paths use forward slashes.
import { LEGACY_FOLDER_RENAMES } from './versions';

export interface ResourceLocation {
  namespace: string;
  path: string;
}

export const RL_PATTERN = /^#?(?:[a-z0-9_.-]+:)?[a-z0-9_./-]+$/;

/** Parse "ns:path", "path" (default namespace) or "#ns:tag" (isTag). */
export function parseRL(value: string, defaultNamespace = 'minecraft'): ResourceLocation & { isTag: boolean } {
  let v = value.trim();
  const isTag = v.startsWith('#');
  if (isTag) v = v.slice(1);
  const i = v.indexOf(':');
  return i >= 0
    ? { namespace: v.slice(0, i) || defaultNamespace, path: v.slice(i + 1), isTag }
    : { namespace: defaultNamespace, path: v, isTag };
}

export function formatRL(rl: ResourceLocation, isTag = false): string {
  return `${isTag ? '#' : ''}${rl.namespace}:${rl.path}`;
}

/** "diamond" -> "minecraft:diamond"; "#logs" -> "#minecraft:logs"; already-qualified ids are unchanged. */
export function normalizeId(value: string, defaultNamespace = 'minecraft'): string {
  const rl = parseRL(value, defaultNamespace);
  return formatRL(rl, rl.isTag);
}

export function isValidRL(value: string): boolean {
  return RL_PATTERN.test(value);
}

/** "ruby_block" -> "Ruby Block" */
export function humanize(path: string): string {
  const last = path.split('/').pop() ?? path;
  return last
    .split('_')
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}

/** Converts arbitrary text to a valid resource-location path segment. */
export function toResourcePath(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_./-]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export type PackSide = 'data' | 'assets';

/**
 * Known resource kinds: folder under data/<ns>/ or assets/<ns>/ (modern names) and file extension.
 * Tag kinds are "tags/<registry>" (e.g. tags/item, tags/worldgen/biome).
 * Worldgen kinds are "worldgen/<x>".
 */
export const DATA_KINDS = [
  'recipe',
  'loot_table',
  'advancement',
  'predicate',
  'item_modifier',
  'function',
  'structure',
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
  'dimension',
  'dimension_type',
  'wolf_variant',
  'wolf_sound_variant',
  'cat_variant',
  'pig_variant',
  'cow_variant',
  'chicken_variant',
  'frog_variant',
  'dialog',
  'trade_set',
  'villager_trade',
  'timeline',
  'test_instance',
  'test_environment',
  'world_clock',
] as const;

export const ASSET_KINDS = [
  'models',
  'textures',
  'blockstates',
  'items',
  'lang',
  'sounds',
  'particles',
  'font',
  'atlases',
  'equipment',
  'shaders',
  'post_effect',
  'texts',
  'waypoint_style',
] as const;

export interface ResourceFileInfo {
  /** Absolute path of the folder that contains data/ or assets/ (pack root or src/main/resources). */
  root: string;
  side: PackSide;
  namespace: string;
  /** Kind folder (modern name), e.g. "recipe", "tags/item", "worldgen/biome", "models", "textures". */
  kind: string;
  /** Path inside the kind folder, without extension. e.g. "item/ruby" for models/item/ruby.json */
  path: string;
  /** "ns:path" */
  id: string;
  ext: string;
  /** True when the file lives in a pre-1.21 plural folder (recipes/, loot_tables/, tags/items/ ...). */
  legacyFolder: boolean;
  /** Folder name as found on disk (may be legacy). */
  folder: string;
}

const MULTI_SEGMENT_PREFIXES = ['tags', 'worldgen'];

/**
 * Classify an absolute file path. Returns undefined when the file is not inside data/<ns>/ or assets/<ns>/.
 * Special cases:
 *  - assets/<ns>/sounds.json -> kind "sounds", path "sounds"
 *  - assets/<ns>/lang/en_us.json -> kind "lang", path "en_us"
 *  - tags/<registry...>/<path> -> kind "tags/<registry>" where registry can itself be worldgen/biome
 */
export function classifyPath(fsPath: string): ResourceFileInfo | undefined {
  const p = fsPath.replace(/\\/g, '/');
  // Find the LAST /data/ or /assets/ segment followed by <ns>/<something>
  const re = /\/(data|assets)\/([a-z0-9_.-]+)\/(.+)$/g;
  let m: RegExpExecArray | null;
  let last: RegExpExecArray | null = null;
  while ((m = re.exec(p))) {
    last = m;
    re.lastIndex = m.index + 1;
  }
  if (!last) return undefined;
  const side = last[1] as PackSide;
  const namespace = last[2];
  const rest = last[3];
  const root = p.slice(0, last.index);
  const dot = rest.lastIndexOf('.');
  const slash = rest.lastIndexOf('/');
  const ext = dot > slash ? rest.slice(dot + 1) : '';
  const noExt = dot > slash ? rest.slice(0, dot) : rest;
  const segs = noExt.split('/');

  if (side === 'assets' && segs.length === 1 && segs[0] === 'sounds') {
    return mk(root, side, namespace, 'sounds', 'sounds', 'sounds', ext, false);
  }
  if (segs.length < 2) return undefined;

  let folderSegs = 1;
  if (MULTI_SEGMENT_PREFIXES.includes(segs[0])) {
    folderSegs = 2;
    if (segs[0] === 'tags' && segs[1] === 'worldgen' && segs.length > 3) folderSegs = 3;
  }
  if (segs.length <= folderSegs) return undefined;
  const folder = segs.slice(0, folderSegs).join('/');
  const kind = LEGACY_FOLDER_RENAMES[folder] ?? folder;
  return mk(root, side, namespace, kind, folder, segs.slice(folderSegs).join('/'), ext, kind !== folder);
}

function mk(
  root: string,
  side: PackSide,
  namespace: string,
  kind: string,
  folder: string,
  path: string,
  ext: string,
  legacyFolder: boolean,
): ResourceFileInfo {
  return { root, side, namespace, kind, path, id: `${namespace}:${path}`, ext, legacyFolder, folder };
}

export function defaultExtension(kind: string): string {
  if (kind === 'textures') return 'png';
  if (kind === 'function') return 'mcfunction';
  if (kind === 'structure') return 'nbt';
  if (kind === 'shaders') return 'json';
  return 'json';
}

/** Relative path (from resource root) for a resource id of a kind. */
export function resourceRelativePath(side: PackSide, kind: string, id: string, ext = defaultExtension(kind)): string {
  const rl = parseRL(id);
  if (kind === 'sounds') return `${side}/${rl.namespace}/sounds.json`;
  return `${side}/${rl.namespace}/${kind}/${rl.path}.${ext}`;
}

export function sideOfKind(kind: string): PackSide {
  return (ASSET_KINDS as readonly string[]).includes(kind) ? 'assets' : 'data';
}

/** Registry name for a tag kind: "tags/item" -> "item", "tags/worldgen/biome" -> "worldgen/biome". */
export function tagRegistry(kind: string): string | undefined {
  return kind.startsWith('tags/') ? kind.slice(5) : undefined;
}
