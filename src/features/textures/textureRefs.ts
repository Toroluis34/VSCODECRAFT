// Texture id helpers (pure: no 'vscode' import, unit tested).

/** "ns:block/x", "block/x", "minecraft:item/foo/bar" — must contain a folder segment. */
const TEXTURE_ID = /^(?:[a-z0-9_.-]+:)?[a-z0-9_.-]+\/[a-z0-9_./-]+$/;

/** Folders vanilla texture ids commonly start with (used to prefer texture hovers over other ids). */
export const TEXTURE_FOLDERS = [
  'block', 'item', 'entity', 'gui', 'particle', 'painting', 'mob_effect', 'environment', 'misc', 'map', 'models',
  'trims', 'colormap', 'effect', 'font', 'armor', 'equipment', 'decorated_pot', 'shield', 'banner', 'chest',
];

/** Could this string be a texture id? (cheap syntactic check, the caller resolves it). */
export function isTextureIdCandidate(value: string): boolean {
  if (value.length > 200 || value.startsWith('#')) return false;
  if (!TEXTURE_ID.test(value)) return false;
  if (/\.(json|png|mcmeta)$/.test(value)) return false;
  return true;
}

/** Normalised texture id ("block/x" → "minecraft:block/x"). */
export function normalizeTextureId(value: string): string {
  return value.includes(':') ? value : `minecraft:${value}`;
}

/** JSON paths (as arrays) whose string values are texture references in model files. */
export function isModelTexturePath(path: (string | number)[]): boolean {
  // { "textures": { "all": "ns:block/x" } } and 26.x { "textures": { "all": { "sprite": "..." } } }
  return (path.length === 2 && path[0] === 'textures') || (path.length === 3 && path[0] === 'textures' && path[2] === 'sprite');
}

/**
 * Rename a texture path for a material variant.
 * renameVariant("item/ruby_sword", "ruby", "sapphire") → "item/sapphire_sword"
 * Matches whole underscore-separated words in the file name; when the source word is absent, the
 * new prefix is prepended ("item/sword" → "item/sapphire_sword").
 */
export function renameVariant(path: string, from: string, to: string): string {
  const slash = path.lastIndexOf('/');
  const dir = slash >= 0 ? path.slice(0, slash + 1) : '';
  const name = path.slice(slash + 1);
  const f = from.trim().toLowerCase();
  const t = to.trim().toLowerCase();
  if (!t) return path;
  if (f) {
    const re = new RegExp(`(^|_)${escapeRe(f)}(?=_|$)`, 'g');
    if (re.test(name)) return dir + name.replace(new RegExp(`(^|_)${escapeRe(f)}(?=_|$)`, 'g'), `$1${t}`);
    if (name.includes(f)) return dir + name.split(f).join(t);
  }
  return `${dir}${t}_${name}`;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Guess the material word of a set of texture names: the most common underscore-separated token
 * ("ruby_sword", "ruby_pickaxe", "ruby_helmet" → "ruby").
 */
export function guessMaterial(paths: string[]): string {
  const counts = new Map<string, number>();
  const IGNORE = new Set(['block', 'item', 'top', 'side', 'bottom', 'front', 'back', 'on', 'off', 'layer', 'overlay', 'stage', 'inner', 'outer']);
  for (const p of paths) {
    const name = p.split('/').pop() ?? p;
    for (const w of new Set(name.split('_'))) {
      if (!w || IGNORE.has(w) || /^\d+$/.test(w)) continue;
      counts.set(w, (counts.get(w) ?? 0) + 1);
    }
  }
  let best = '';
  let n = 0;
  for (const [w, c] of counts) if (c > n || (c === n && w.length > best.length)) [best, n] = [w, c];
  return best;
}

/** Simple stable hash (FNV-1a, hex) for cache file names. */
export function hashString(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
