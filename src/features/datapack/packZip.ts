// Selecting and zipping pack files. Pure module (fflate only) — unit tested.
import { zipSync, Zippable } from 'fflate';
import { isJunkFile } from './pathValidation';

export type ZipKind = 'data' | 'resource';

/**
 * Should a file (path relative to the pack root, forward slashes) go into the zip?
 * Datapacks get data/, resource packs get assets/; both get pack.mcmeta, pack.png and declared overlay folders.
 */
export function includeInPack(rel: string, kind: ZipKind, overlayDirs: string[] = []): boolean {
  const p = rel.replace(/\\/g, '/').replace(/^\.\//, '');
  if (isJunkFile(p)) return false;
  if (p === 'pack.mcmeta' || p === 'pack.png') return true;
  const side = kind === 'data' ? 'data/' : 'assets/';
  if (p.startsWith(side)) return true;
  for (const o of overlayDirs) if (p.startsWith(`${o}/${side}`)) return true;
  return false;
}

/** Overlay directories declared in a parsed pack.mcmeta. */
export function overlayDirs(mcmeta: unknown): string[] {
  const entries = (mcmeta as { overlays?: { entries?: { directory?: unknown }[] } } | undefined)?.overlays?.entries;
  return Array.isArray(entries) ? entries.map((e) => e?.directory).filter((d): d is string => typeof d === 'string' && /^[a-z0-9_.-]+$/.test(d)) : [];
}

/** Build a zip (deflate level 9, stored for already-compressed PNG/OGG). Entries are sorted for reproducible output. */
export function buildZip(files: { path: string; data: Uint8Array }[]): Uint8Array {
  const tree: Zippable = {};
  for (const f of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    const stored = /\.(png|ogg|nbt|zip|jar)$/i.test(f.path);
    tree[f.path] = [f.data, { level: stored ? 0 : 9, mtime: new Date('2020-01-01T00:00:00Z') }];
  }
  return zipSync(tree);
}

/** Default zip file name: "<name>-<version>-datapack.zip" with a safe name. */
export function zipFileName(name: string, version: string, kind: ZipKind): string {
  const safe = name.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'pack';
  return `${safe}-${version}-${kind === 'data' ? 'datapack' : 'resourcepack'}.zip`;
}
