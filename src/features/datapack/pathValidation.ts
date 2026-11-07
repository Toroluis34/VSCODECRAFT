// Validation of resource file paths inside data/ and assets/. Pure module (unit tested).
import { ASSET_KINDS, DATA_KINDS } from '../../core/resourceLocation';
import { LEGACY_FOLDER_RENAMES } from '../../core/versions';

export const NAMESPACE_RE = /^[a-z0-9_.-]+$/;
export const PATH_SEGMENT_RE = /^[a-z0-9_.-]+$/;

export type PathProblemCode = 'invalidNamespace' | 'invalidChars' | 'uppercase' | 'spaces' | 'emptySegment';

export interface PathProblem {
  code: PathProblemCode;
  /** Offending segment (namespace or path segment). */
  segment: string;
  /** Lowercased / sanitized suggestion for the whole relative path. */
  suggestion: string;
}

/** Suggest a valid name for an invalid segment: lowercase, spaces → "_", other chars dropped. */
export function sanitizeSegment(seg: string): string {
  return seg
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_.-]/g, '');
}

/**
 * Validate a path relative to a resource root, e.g. "data/MyPack/recipe/Ruby Block.json".
 * Returns no problems for paths outside data/ & assets/ (pack.mcmeta, pack.png...).
 */
export function validateResourcePath(rel: string): PathProblem[] {
  const parts = rel.replace(/\\/g, '/').split('/').filter((p, i) => p !== '' || i > 0);
  if (parts.length < 3 || (parts[0] !== 'data' && parts[0] !== 'assets')) return [];
  const out: PathProblem[] = [];
  const suggestion = [parts[0], ...parts.slice(1).map(sanitizeSegment)].join('/');
  const ns = parts[1];
  if (!NAMESPACE_RE.test(ns)) out.push({ code: 'invalidNamespace', segment: ns, suggestion });
  for (const seg of parts.slice(2)) {
    if (seg === '') {
      out.push({ code: 'emptySegment', segment: seg, suggestion });
      continue;
    }
    if (PATH_SEGMENT_RE.test(seg)) continue;
    if (/\s/.test(seg)) out.push({ code: 'spaces', segment: seg, suggestion });
    else if (/[A-Z]/.test(seg) && PATH_SEGMENT_RE.test(seg.toLowerCase())) out.push({ code: 'uppercase', segment: seg, suggestion });
    else out.push({ code: 'invalidChars', segment: seg, suggestion });
  }
  return out;
}

const KNOWN_DATA = new Set<string>([...DATA_KINDS, ...Object.keys(LEGACY_FOLDER_RENAMES), 'tags', 'worldgen']);
const KNOWN_ASSETS = new Set<string>([...ASSET_KINDS, 'sounds.json', 'gpu_warnlist.json', 'regional_compliancies.json', 'icons', 'resourcepacks']);

/**
 * True when the first folder below data/<ns>/ or assets/<ns>/ is a folder the game reads.
 * Mods can add their own registries, so callers should treat `false` as a hint, not an error.
 */
export function isKnownFolder(rel: string): boolean {
  const parts = rel.replace(/\\/g, '/').split('/');
  if (parts.length < 3) return true;
  if (parts[0] === 'data') return KNOWN_DATA.has(parts[2]);
  if (parts[0] === 'assets') return KNOWN_ASSETS.has(parts[2]);
  return true;
}

/** Junk files that should never end up in a pack zip or count as resources. */
export function isJunkFile(rel: string): boolean {
  const name = rel.replace(/\\/g, '/').split('/').pop() ?? '';
  return (
    name === '.DS_Store' ||
    name === 'Thumbs.db' ||
    name === 'desktop.ini' ||
    name.startsWith('._') ||
    /\.(bak|tmp|swp|psd|xcf|kra|aseprite|ase|blend|blend1|bbmodel|pdn|log)$/i.test(name) ||
    name.endsWith('~') ||
    /(^|\/)(\.git|\.idea|\.vscode|node_modules|__MACOSX)(\/|$)/.test(rel.replace(/\\/g, '/'))
  );
}
