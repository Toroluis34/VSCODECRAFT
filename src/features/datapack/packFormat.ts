// pack.mcmeta format knowledge. Pure module (no 'vscode' import) — unit tested in test/datapack.
//
// Format history (verified against misode/technical-changes 25w31a and the vanilla 26.3 pack.mcmeta):
//  - up to 1.20.1:   {"pack": {"pack_format": N, "description": ...}}
//  - 1.20.2–1.21.8:  optional "supported_formats": N | [min, max] | {"min_inclusive", "max_inclusive"}
//  - 1.21.9+:        required "min_format" / "max_format": N | [N] | [major, minor]; "pack_format" optional.
//                    If the pack ALSO supports an old-style format (data < 82, resource < 65):
//                      "pack_format" and "supported_formats" are still required (old games read them).
//                    Otherwise "supported_formats" is not allowed.
//  - Overlay entries: "formats" (old range) is required for every overlay as soon as one overlay range includes an
//    old-style format; otherwise not allowed. "min_format"/"max_format" are required (1.21.9+).
import type { McVersion } from '../../core/versions';
import { compareVersions } from '../../core/versions';

export type PackKind = 'data' | 'resource';
/** [major, minor] */
export type Fmt = [number, number];

/** Last format of the old pack.mcmeta style (1.21.8). First new-style formats: data 82, resource 65. */
export const LAST_OLD_FORMAT: Record<PackKind, number> = { data: 81, resource: 64 };

export interface FormatRange {
  min: Fmt;
  max: Fmt;
}

export function versionFormat(v: McVersion, kind: PackKind): Fmt {
  return kind === 'data' ? [v.dataPack, v.dataPackMinor ?? 0] : [v.resourcePack, v.resourcePackMinor ?? 0];
}

export function cmpFmt(a: Fmt, b: Fmt): number {
  return a[0] - b[0] || a[1] - b[1];
}

export function fmtToString(f: Fmt): string {
  return f[1] ? `${f[0]}.${f[1]}` : String(f[0]);
}

/** int | [int] | [int, int] -> Fmt. `isMax` only matters for documentation; a bare int means [N, 0]. */
export function parseFormatValue(v: unknown): Fmt | undefined {
  if (typeof v === 'number' && Number.isInteger(v)) return [v, 0];
  if (Array.isArray(v) && v.length >= 1 && v.length <= 2 && v.every((x) => typeof x === 'number' && Number.isInteger(x))) {
    return [v[0] as number, (v[1] as number | undefined) ?? 0];
  }
  return undefined;
}

/** Fmt -> JSON value: plain integer when the minor is 0, else [major, minor]. */
export function formatValue(f: Fmt): number | [number, number] {
  return f[1] ? [f[0], f[1]] : f[0];
}

/** Old "supported_formats" / overlay "formats": N | [a, b] | {min_inclusive, max_inclusive}. */
export function parseOldRange(v: unknown): [number, number] | undefined {
  if (typeof v === 'number') return [v, v];
  if (Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === 'number')) return [v[0], v[1]];
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    if (typeof o.min_inclusive === 'number' && typeof o.max_inclusive === 'number') return [o.min_inclusive, o.max_inclusive];
  }
  return undefined;
}

export function isFormatInRange(f: Fmt, r: FormatRange): boolean {
  return cmpFmt(f, r.min) >= 0 && cmpFmt(f, r.max) <= 0;
}

/** Sorted ascending by version. */
function ascending(table: McVersion[]): McVersion[] {
  return [...table].sort((a, b) => compareVersions(a.id, b.id));
}

/** Versions (releases, plus snapshots when `snapshots`) whose pack format lies inside a range. */
export function versionsInRange(r: FormatRange, kind: PackKind, table: McVersion[], snapshots = false): McVersion[] {
  return ascending(table).filter((v) => (snapshots || v.type === 'release') && isFormatInRange(versionFormat(v, kind), r));
}

/**
 * Human readable list of release ranges, e.g. "1.21 – 1.21.1, 1.21.4". Contiguous runs of releases
 * (in the release list) are collapsed. Falls back to snapshots when no release matches.
 */
export function describeVersions(r: FormatRange, kind: PackKind, table: McVersion[]): string {
  const releases = ascending(table).filter((v) => v.type === 'release');
  const runs: string[] = [];
  let start: string | undefined;
  let prev: string | undefined;
  for (const v of releases) {
    if (isFormatInRange(versionFormat(v, kind), r)) {
      start ??= v.id;
      prev = v.id;
    } else if (start) {
      runs.push(start === prev ? start : `${start} – ${prev}`);
      start = prev = undefined;
    }
  }
  if (start) runs.push(start === prev ? start : `${start} – ${prev}`);
  if (runs.length) return runs.join(', ');
  const snaps = versionsInRange(r, kind, table, true).map((v) => v.id);
  return snaps.length ? snaps.join(', ') : '';
}

/** Format range for "supports versions minVersion..maxVersion". */
export function rangeForVersions(minVersion: string, maxVersion: string, kind: PackKind, table: McVersion[]): FormatRange | undefined {
  const lo = compareVersions(minVersion, maxVersion) <= 0 ? minVersion : maxVersion;
  const hi = lo === minVersion ? maxVersion : minVersion;
  const a = table.find((v) => v.id === lo);
  const b = table.find((v) => v.id === hi);
  if (!a || !b) return undefined;
  const fa = versionFormat(a, kind);
  const fb = versionFormat(b, kind);
  return cmpFmt(fa, fb) <= 0 ? { min: fa, max: fb } : { min: fb, max: fa };
}

/** True when a range includes an old-style format (requires pack_format + supported_formats). */
export function needsLegacyFields(r: FormatRange, kind: PackKind): boolean {
  return r.min[0] <= LAST_OLD_FORMAT[kind];
}

/** True when a range includes a new-style format (requires min_format + max_format). */
export function needsNewFields(r: FormatRange, kind: PackKind): boolean {
  return r.max[0] > LAST_OLD_FORMAT[kind];
}

/**
 * Build the "pack" section fields for a format range, keeping `extra` (description...) first.
 * Old-only ranges: pack_format (+ supported_formats when min != max).
 * New-only ranges: pack_format (optional, written so older games show "made for a newer version"), min_format, max_format.
 * Mixed ranges: pack_format, supported_formats, min_format, max_format.
 */
export function buildPackSection(r: FormatRange, kind: PackKind, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const out: Record<string, unknown> = { ...extra };
  for (const k of ['pack_format', 'supported_formats', 'min_format', 'max_format']) delete out[k];
  const legacy = needsLegacyFields(r, kind);
  const modern = needsNewFields(r, kind);
  out.pack_format = r.min[0];
  if (legacy && (modern || r.min[0] !== r.max[0])) out.supported_formats = [r.min[0], r.max[0]];
  if (modern) {
    out.min_format = formatValue(r.min);
    out.max_format = formatValue(r.max);
  }
  return out;
}

export interface OverlaySpec {
  directory: string;
  range: FormatRange;
}

/** Overlay entries for pack.mcmeta following the old/new rules. */
export function buildOverlayEntries(overlays: OverlaySpec[], kind: PackKind, packRange?: FormatRange): Record<string, unknown>[] {
  const anyLegacy = overlays.some((o) => needsLegacyFields(o.range, kind));
  // min/max are only understood (and required) by 1.21.9+; skip them when the whole pack is old-only.
  const anyModern = packRange ? needsNewFields(packRange, kind) : overlays.some((o) => needsNewFields(o.range, kind));
  return overlays.map((o) => {
    const e: Record<string, unknown> = { directory: o.directory };
    if (anyLegacy) e.formats = [o.range.min[0], o.range.max[0]];
    if (anyModern) {
      e.min_format = formatValue(o.range.min);
      e.max_format = formatValue(o.range.max);
    }
    return e;
  });
}

/** Read the declared format range of a parsed pack.mcmeta "pack" section (any era). */
export function readPackRange(pack: Record<string, unknown> | undefined): FormatRange | undefined {
  if (!pack) return undefined;
  const min = parseFormatValue(pack.min_format);
  const max = parseFormatValue(pack.max_format);
  if (min && max) return { min, max };
  const pf = typeof pack.pack_format === 'number' ? pack.pack_format : undefined;
  const sf = parseOldRange(pack.supported_formats);
  if (sf) return { min: [sf[0], 0], max: [sf[1], 0] };
  if (pf !== undefined) return { min: [pf, 0], max: [pf, 0] };
  return undefined;
}

export type PackProblemCode =
  | 'missingPack'
  | 'missingDescription'
  | 'missingMinMax'
  | 'missingPackFormat'
  | 'missingSupportedFormats'
  | 'supportedFormatsNotAllowed'
  | 'supportedFormatsMismatch'
  | 'packFormatOutOfRange'
  | 'minGreaterThanMax'
  | 'targetNotSupported'
  | 'invalidFormatValue'
  | 'overlayFormatsRequired'
  | 'overlayFormatsNotAllowed'
  | 'overlayMissingMinMax';

export interface PackProblem {
  code: PackProblemCode;
  severity: 'error' | 'warning';
  /** JSON path of the offending node (for ranges in the editor). */
  path: (string | number)[];
  args: string[];
}

/**
 * Validate a parsed pack.mcmeta for a pack kind and a target version.
 * `targetFormat` is the format of the target version (undefined if unknown).
 */
export function validatePackMcmeta(json: unknown, kind: PackKind, targetVersion: string, targetFormat: Fmt | undefined): PackProblem[] {
  const out: PackProblem[] = [];
  const root = json && typeof json === 'object' && !Array.isArray(json) ? (json as Record<string, unknown>) : undefined;
  const pack = root?.pack && typeof root.pack === 'object' ? (root.pack as Record<string, unknown>) : undefined;
  if (!pack) {
    out.push({ code: 'missingPack', severity: 'error', path: [], args: [] });
    return out;
  }
  if (pack.description === undefined) out.push({ code: 'missingDescription', severity: 'warning', path: ['pack'], args: [] });
  for (const k of ['min_format', 'max_format'] as const) {
    if (pack[k] !== undefined && !parseFormatValue(pack[k])) out.push({ code: 'invalidFormatValue', severity: 'error', path: ['pack', k], args: [k] });
  }
  const range = readPackRange(pack);
  const hasMinMax = pack.min_format !== undefined && pack.max_format !== undefined;
  const targetIsNew = targetFormat ? targetFormat[0] > LAST_OLD_FORMAT[kind] : false;
  if (range && cmpFmt(range.min, range.max) > 0) {
    out.push({ code: 'minGreaterThanMax', severity: 'error', path: ['pack', hasMinMax ? 'min_format' : 'supported_formats'], args: [] });
  }
  if (targetIsNew && !hasMinMax) {
    out.push({ code: 'missingMinMax', severity: 'error', path: ['pack'], args: [targetVersion] });
  }
  if (range && hasMinMax) {
    const legacy = needsLegacyFields(range, kind);
    if (legacy) {
      if (pack.pack_format === undefined) out.push({ code: 'missingPackFormat', severity: 'error', path: ['pack'], args: [String(LAST_OLD_FORMAT[kind] + 1)] });
      if (pack.supported_formats === undefined) out.push({ code: 'missingSupportedFormats', severity: 'error', path: ['pack'], args: [String(LAST_OLD_FORMAT[kind] + 1)] });
      const sf = parseOldRange(pack.supported_formats);
      if (sf && (sf[0] !== range.min[0] || sf[1] !== range.max[0])) {
        out.push({ code: 'supportedFormatsMismatch', severity: 'warning', path: ['pack', 'supported_formats'], args: [String(range.min[0]), String(range.max[0])] });
      }
    } else if (pack.supported_formats !== undefined) {
      out.push({ code: 'supportedFormatsNotAllowed', severity: 'error', path: ['pack', 'supported_formats'], args: [String(LAST_OLD_FORMAT[kind] + 1)] });
    }
  }
  const pf = typeof pack.pack_format === 'number' ? pack.pack_format : undefined;
  const sf = parseOldRange(pack.supported_formats);
  if (pf !== undefined && sf && (pf < sf[0] || pf > sf[1])) {
    out.push({ code: 'packFormatOutOfRange', severity: 'warning', path: ['pack', 'pack_format'], args: [String(pf), `${sf[0]}–${sf[1]}`] });
  }
  if (range && targetFormat && !isFormatInRange(targetFormat, range)) {
    const p = hasMinMax ? ['pack', 'max_format'] : pack.supported_formats !== undefined ? ['pack', 'supported_formats'] : ['pack', 'pack_format'];
    out.push({ code: 'targetNotSupported', severity: 'warning', path: p, args: [targetVersion, fmtToString(targetFormat)] });
  }
  // Overlays
  const entries = (root?.overlays as { entries?: unknown } | undefined)?.entries;
  if (Array.isArray(entries)) {
    const ranges = entries.map((e) => {
      const o = (e ?? {}) as Record<string, unknown>;
      const mn = parseFormatValue(o.min_format);
      const mx = parseFormatValue(o.max_format);
      const old = parseOldRange(o.formats);
      return mn && mx ? { min: mn, max: mx } : old ? ({ min: [old[0], 0], max: [old[1], 0] } as FormatRange) : undefined;
    });
    const anyLegacy = ranges.some((r) => r && needsLegacyFields(r, kind));
    entries.forEach((e, i) => {
      const o = (e ?? {}) as Record<string, unknown>;
      if (anyLegacy && o.formats === undefined) out.push({ code: 'overlayFormatsRequired', severity: 'error', path: ['overlays', 'entries', i], args: [] });
      if (!anyLegacy && o.formats !== undefined) out.push({ code: 'overlayFormatsNotAllowed', severity: 'error', path: ['overlays', 'entries', i, 'formats'], args: [] });
      if (targetIsNew && (o.min_format === undefined || o.max_format === undefined)) {
        out.push({ code: 'overlayMissingMinMax', severity: 'error', path: ['overlays', 'entries', i], args: [] });
      }
    });
  }
  return out;
}

/** Guess the pack kind of a pack root from its folders. */
export function packKindOf(hasData: boolean, hasAssets: boolean): PackKind {
  return hasAssets && !hasData ? 'resource' : 'data';
}

/** Default overlay folder name for a version range, e.g. "overlay_1_21_4" or "overlay_26_1_to_26_3". */
export function overlayName(minVersion: string, maxVersion: string): string {
  const s = (v: string) => v.replace(/[^a-z0-9]+/gi, '_').toLowerCase();
  return minVersion === maxVersion ? `overlay_${s(minVersion)}` : `overlay_${s(minVersion)}_to_${s(maxVersion)}`;
}
