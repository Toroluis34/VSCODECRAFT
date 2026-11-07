// Pure helpers to detect mod metadata from file contents. No 'vscode' import (unit-testable).
import { parse as parseToml } from 'smol-toml';

export type Loader = 'fabric' | 'quilt' | 'neoforge' | 'forge' | 'paper' | 'datapack' | 'resourcepack' | 'unknown';

export interface ModMetadata {
  loader: Loader;
  modIds: string[];
  mcVersion?: string;
  modName?: string;
  version?: string;
}

/** fabric.mod.json / quilt.mod.json */
export function parseFabricModJson(text: string): ModMetadata {
  try {
    const j = JSON.parse(text);
    if (j.quilt_loader) {
      const q = j.quilt_loader;
      const deps: unknown[] = Array.isArray(q.depends) ? q.depends : [];
      const mc = deps.find((d: any) => d && (d.id === 'minecraft' || d === 'minecraft')) as any;
      return {
        loader: 'quilt',
        modIds: q.id ? [String(q.id)] : [],
        mcVersion: extractMcVersion(typeof mc?.versions === 'string' ? mc.versions : JSON.stringify(mc?.versions ?? '')),
        modName: q.metadata?.name,
        version: q.version,
      };
    }
    const mcDep = j.depends?.minecraft;
    return {
      loader: 'fabric',
      modIds: j.id ? [String(j.id)] : [],
      mcVersion: extractMcVersion(Array.isArray(mcDep) ? mcDep.join(' ') : String(mcDep ?? '')),
      modName: j.name,
      version: j.version,
    };
  } catch {
    return { loader: 'fabric', modIds: [] };
  }
}

/** neoforge.mods.toml / mods.toml */
export function parseModsToml(text: string, loader: 'neoforge' | 'forge'): ModMetadata {
  let modIds: string[] = [];
  let mcVersion: string | undefined;
  let modName: string | undefined;
  let version: string | undefined;
  try {
    const t: any = parseToml(text);
    const mods: any[] = Array.isArray(t.mods) ? t.mods : [];
    modIds = mods.map((m) => String(m.modId)).filter((id) => id && !id.includes('${'));
    modName = mods[0]?.displayName;
    version = mods[0]?.version;
    const deps = t.dependencies ?? {};
    for (const list of Object.values(deps) as any[]) {
      if (!Array.isArray(list)) continue;
      const mc = list.find((d) => d?.modId === 'minecraft');
      if (mc?.versionRange) mcVersion = extractMcVersion(String(mc.versionRange));
    }
  } catch {
    // Templates often contain ${placeholders} that break TOML — fall back to regex.
    modIds = [...text.matchAll(/modId\s*=\s*"([a-z0-9_.-]+)"/g)].map((m) => m[1]).filter((m) => m !== 'minecraft' && m !== 'neoforge' && m !== 'forge');
  }
  // Remove dependency entries that the regex fallback may catch
  modIds = modIds.filter((m) => !['minecraft', 'neoforge', 'forge', 'java'].includes(m));
  return { loader, modIds, mcVersion, modName, version };
}

/** gradle.properties: minecraft_version, mod_id, archives_base_name, mod_name ... */
export function parseGradleProperties(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z0-9_.-]+)\s*[=:]\s*(.*?)\s*$/.exec(line);
    if (m && !line.trim().startsWith('#')) out[m[1]] = m[2];
  }
  return out;
}

export function mcVersionFromGradleProps(props: Record<string, string>): string | undefined {
  for (const key of ['minecraft_version', 'mc_version', 'minecraftVersion', 'mcVersion', 'minecraft']) {
    const v = props[key];
    if (v && /^\d/.test(v)) return v;
  }
  return undefined;
}

export function modIdFromGradleProps(props: Record<string, string>): string | undefined {
  for (const key of ['mod_id', 'modid', 'modId', 'archives_base_name']) {
    const v = props[key];
    if (v && /^[a-z][a-z0-9_]{1,63}$/.test(v)) return v;
  }
  return undefined;
}

/**
 * Pull a concrete version out of a dependency range:
 *  "~1.21.4" -> 1.21.4, ">=1.21.2 <1.21.4" -> 1.21.2, "[1.21.1,1.22)" -> 1.21.1, "1.21.x" -> 1.21, "26.1" -> 26.1
 */
export function extractMcVersion(range: string): string | undefined {
  const m = /(\d+\.\d+(?:\.\d+)?)/.exec(range.replace(/\.x\b/, ''));
  return m ? m[1] : undefined;
}

/** pack.mcmeta -> pack formats (supports pack_format, supported_formats and min_format/max_format). */
export function parsePackMcmeta(text: string): { description?: unknown; minFormat?: number; maxFormat?: number } {
  try {
    const j = JSON.parse(text);
    const p = j.pack ?? {};
    const num = (v: unknown): number | undefined =>
      typeof v === 'number' ? v : Array.isArray(v) && typeof v[0] === 'number' ? v[0] : undefined;
    let min = num(p.min_format) ?? num(p.pack_format);
    let max = num(p.max_format) ?? num(p.pack_format);
    const sf = p.supported_formats;
    if (Array.isArray(sf)) {
      min = Math.min(min ?? sf[0], sf[0]);
      max = Math.max(max ?? sf[1], sf[1]);
    } else if (sf && typeof sf === 'object') {
      min = Math.min(min ?? sf.min_inclusive, sf.min_inclusive);
      max = Math.max(max ?? sf.max_inclusive, sf.max_inclusive);
    }
    return { description: p.description, minFormat: min, maxFormat: max };
  } catch {
    return {};
  }
}
