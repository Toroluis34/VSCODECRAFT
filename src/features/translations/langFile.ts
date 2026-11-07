// Lang file (assets/<ns>/lang/<locale>.json) parsing, ordering, serialization and analysis.
// Pure module (no 'vscode' import) so it can be unit tested and shared with webviews.
import * as jsonc from 'jsonc-parser';

export interface LangEntry {
  key: string;
  value: string;
}

export interface ParsedLang {
  /** Entries in file order (the LAST occurrence wins for duplicated keys, like Gson). */
  entries: LangEntry[];
  /** Keys that appear more than once in the file. */
  duplicates: string[];
  /** Keys whose value is not a string (ignored by Minecraft). */
  nonString: string[];
  /** Parse errors (count). */
  errors: number;
  /** Detected indentation: a number of spaces or "\t". */
  indent: number | string;
  eol: '\n' | '\r\n';
}

/** Detect the indentation used by a JSON text (first indented line). */
export function detectIndent(text: string, fallback: number | string = 2): number | string {
  const m = /\n([ \t]+)\S/.exec(text);
  if (!m) return fallback;
  if (m[1].startsWith('\t')) return '\t';
  return m[1].length || fallback;
}

export function detectEol(text: string): '\n' | '\r\n' {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

/** Parse a lang JSON text keeping key order and reporting duplicates. */
export function parseLang(text: string, fallbackIndent: number | string = 2): ParsedLang {
  const errors: jsonc.ParseError[] = [];
  const tree = jsonc.parseTree(text, errors, { allowTrailingComma: true, disallowComments: false });
  const map = new Map<string, string>();
  const order: string[] = [];
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  const nonString: string[] = [];
  if (tree?.type === 'object') {
    for (const prop of tree.children ?? []) {
      const k = prop.children?.[0]?.value;
      const v = prop.children?.[1];
      if (typeof k !== 'string' || !v) continue;
      if (seen.has(k)) duplicates.add(k);
      seen.add(k);
      if (v.type !== 'string') {
        nonString.push(k);
        continue;
      }
      if (!map.has(k)) order.push(k);
      map.set(k, v.value as string);
    }
  }
  return {
    entries: order.map((key) => ({ key, value: map.get(key)! })),
    duplicates: [...duplicates],
    nonString,
    errors: errors.length,
    indent: detectIndent(text, fallbackIndent),
    eol: detectEol(text),
  };
}

/** Plain-object view of entries. */
export function toRecord(entries: LangEntry[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of entries) out[e.key] = e.value;
  return out;
}

export function fromRecord(rec: Record<string, string>): LangEntry[] {
  return Object.entries(rec).map(([key, value]) => ({ key, value }));
}

/** Key comparator used for sorting (plain code-point order, like most datagen providers). */
export function compareKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function sortEntries(entries: LangEntry[]): LangEntry[] {
  return [...entries].sort((a, b) => compareKeys(a.key, b.key));
}

export interface SerializeOptions {
  indent?: number | string;
  eol?: string;
  sort?: boolean;
}

/** Serialize entries as a lang JSON document (trailing newline). Non-ASCII characters are kept as-is. */
export function serializeLang(entries: LangEntry[], opts: SerializeOptions = {}): string {
  const eol = opts.eol ?? '\n';
  const indent = typeof opts.indent === 'number' ? ' '.repeat(opts.indent) : (opts.indent ?? '  ');
  const list = opts.sort ? sortEntries(entries) : entries;
  if (!list.length) return `{}${eol}`;
  const lines = list.map((e, i) => `${indent}${JSON.stringify(e.key)}: ${JSON.stringify(e.value)}${i < list.length - 1 ? ',' : ''}`);
  return `{${eol}${lines.join(eol)}${eol}}${eol}`;
}

/**
 * Insert or update a key. New keys are placed:
 *  - in sorted position when `sort` is set,
 *  - otherwise right after the closest preceding key of `referenceOrder` (e.g. en_us order) that exists,
 *  - otherwise at the end.
 */
export function setEntry(
  entries: LangEntry[],
  key: string,
  value: string,
  opts: { sort?: boolean; referenceOrder?: string[] } = {},
): LangEntry[] {
  const i = entries.findIndex((e) => e.key === key);
  if (i >= 0) {
    const out = [...entries];
    out[i] = { key, value };
    return out;
  }
  const out = [...entries];
  if (opts.sort) {
    let at = out.findIndex((e) => compareKeys(e.key, key) > 0);
    if (at < 0) at = out.length;
    out.splice(at, 0, { key, value });
    return out;
  }
  const ref = opts.referenceOrder;
  if (ref) {
    const ri = ref.indexOf(key);
    if (ri >= 0) {
      const positions = new Map(out.map((e, idx) => [e.key, idx]));
      // after the closest preceding reference key that exists
      for (let j = ri - 1; j >= 0; j--) {
        const p = positions.get(ref[j]);
        if (p !== undefined) {
          out.splice(p + 1, 0, { key, value });
          return out;
        }
      }
      // before the closest following reference key that exists
      for (let j = ri + 1; j < ref.length; j++) {
        const p = positions.get(ref[j]);
        if (p !== undefined) {
          out.splice(p, 0, { key, value });
          return out;
        }
      }
    }
  }
  out.push({ key, value });
  return out;
}

/** Set several keys at once (same placement rules as setEntry). */
export function setEntries(
  entries: LangEntry[],
  values: Record<string, string>,
  opts: { sort?: boolean; referenceOrder?: string[] } = {},
): LangEntry[] {
  let out = entries;
  for (const [k, v] of Object.entries(values)) out = setEntry(out, k, v, opts);
  return out;
}

export function deleteEntry(entries: LangEntry[], key: string): LangEntry[] {
  return entries.filter((e) => e.key !== key);
}

/** Rename a key keeping its position (sorted position if `sort`). No-op when `from` is absent. */
export function renameEntry(entries: LangEntry[], from: string, to: string, sort = false): LangEntry[] {
  const i = entries.findIndex((e) => e.key === from);
  if (i < 0 || from === to) return entries;
  const value = entries[i].value;
  let out = entries.filter((e) => e.key !== to);
  out = out.map((e) => (e.key === from ? { key: to, value } : e));
  return sort ? sortEntries(out) : out;
}

// ---------------------------------------------------------------------------------------------
// Key analysis
// ---------------------------------------------------------------------------------------------

/** Well-known first segments of translation keys, with a readable group label. */
export const KEY_GROUPS: Record<string, string> = {
  item: 'Items',
  block: 'Blocks',
  entity: 'Entities',
  itemGroup: 'Creative tabs',
  advancements: 'Advancements',
  tooltip: 'Tooltips',
  death: 'Death messages',
  subtitles: 'Subtitles',
  enchantment: 'Enchantments',
  effect: 'Effects',
  biome: 'Biomes',
  container: 'Containers',
  gui: 'GUI',
  key: 'Key bindings',
  sound: 'Sounds',
  painting: 'Paintings',
  trim_material: 'Trim materials',
  trim_pattern: 'Trim patterns',
  jukebox_song: 'Jukebox songs',
  stat: 'Statistics',
  commands: 'Commands',
  config: 'Config',
  text: 'Text',
  message: 'Messages',
  modmenu: 'Mod Menu',
  tag: 'Tags',
  attribute: 'Attributes',
  potion: 'Potions',
  dimension: 'Dimensions',
  instrument: 'Instruments',
  upgrade: 'Smithing upgrades',
  emi: 'EMI',
  jei: 'JEI',
  rei: 'REI',
};

/** Group of a key = its first dot-separated segment ("item.mymod.ruby" -> "item"). */
export function keyGroup(key: string): string {
  const i = key.indexOf('.');
  return i > 0 ? key.slice(0, i) : key;
}

/**
 * Item/block id a key refers to, for icons: "item.mymod.ruby" -> "mymod:ruby",
 * "block.minecraft.oak_planks" -> "minecraft:oak_planks", "item.mymod.ruby.desc" -> "mymod:ruby".
 */
export function keyItemId(key: string): string | undefined {
  const parts = key.split('.');
  if (parts.length < 3 || (parts[0] !== 'item' && parts[0] !== 'block')) return undefined;
  if (!/^[a-z0-9_.-]+$/.test(parts[1]) || !/^[a-z0-9_/-]+$/.test(parts[2])) return undefined;
  return `${parts[1]}:${parts[2]}`;
}

/** printf-style arguments of a value: "%s", "%1$s", "%d" ... (sorted signature, "%%" ignored). */
export function formatArgs(value: string): string[] {
  const out: string[] = [];
  let auto = 0;
  for (const m of value.matchAll(/%(?:(\d+)\$)?([sdf%])/g)) {
    if (m[2] === '%') continue;
    out.push(m[1] ? `${m[1]}` : `${++auto}`);
  }
  return out.sort();
}

/** True when the format arguments of a translation differ from the base (English) value. */
export function formatArgsMismatch(base: string, value: string): boolean {
  if (!value) return false;
  const a = formatArgs(base);
  const b = formatArgs(value);
  return a.length !== b.length || a.some((x, i) => x !== b[i]);
}

export interface LocaleStats {
  locale: string;
  total: number;
  translated: number;
  missing: number;
  empty: number;
  /** Same text as the base locale (probably untranslated). */
  identical: number;
  /** Keys present only in this locale. */
  extra: number;
  /** 0..100 */
  percent: number;
}

/**
 * Completion statistics of every locale relative to a base locale (en_us).
 * `marker`: values starting with it count as untranslated.
 */
export function computeStats(
  locales: Record<string, Record<string, string>>,
  base = 'en_us',
  marker = '',
): LocaleStats[] {
  const baseVals = locales[base] ?? {};
  const baseKeys = Object.keys(baseVals);
  return Object.keys(locales).map((locale) => {
    const vals = locales[locale];
    let translated = 0;
    let missing = 0;
    let empty = 0;
    let identical = 0;
    for (const k of baseKeys) {
      const v = vals[k];
      if (v === undefined) missing++;
      else if (v === '') empty++;
      else if (locale !== base && (v === baseVals[k] || (marker && v.startsWith(marker)))) identical++;
      else translated++;
    }
    const extra = Object.keys(vals).filter((k) => !(k in baseVals)).length;
    const total = baseKeys.length;
    return {
      locale,
      total,
      translated,
      missing,
      empty,
      identical,
      extra,
      percent: total ? Math.round((translated / total) * 1000) / 10 : 100,
    };
  });
}

/** Keys of the base locale missing (or empty) in another locale. */
export function missingKeys(base: Record<string, string>, other: Record<string, string>, includeEmpty = true): string[] {
  return Object.keys(base).filter((k) => !(k in other) || (includeEmpty && other[k] === '' && base[k] !== ''));
}

/** Copy base values for keys missing in `target`, optionally prefixing a marker. Keeps base ordering. */
export function fillMissing(
  target: LangEntry[],
  base: LangEntry[],
  opts: { marker?: string; sort?: boolean } = {},
): { entries: LangEntry[]; added: string[] } {
  const rec = toRecord(target);
  const added: string[] = [];
  const values: Record<string, string> = {};
  for (const e of base) {
    if (e.key in rec && rec[e.key] !== '') continue;
    values[e.key] = (opts.marker ?? '') + e.value;
    added.push(e.key);
  }
  return { entries: setEntries(target, values, { sort: opts.sort, referenceOrder: base.map((e) => e.key) }), added };
}

/** Valid Minecraft locale file name. */
export function isLocaleCode(code: string): boolean {
  return /^[a-z]{2,3}(_[a-z0-9]{2,8})?$/.test(code);
}

/** Valid translation key (Minecraft accepts anything, but keep it sane). */
export function isValidKey(key: string): boolean {
  return /^[^\s"\\]+$/.test(key);
}
