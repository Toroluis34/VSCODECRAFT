// Text edits for loot table files. Pure module (jsonc-parser only): every operation takes the document text
// and returns the new text, touching only the affected JSON paths so unknown fields and formatting are kept.
import * as jsonc from 'jsonc-parser';
import { formatKeys, functionsOf, LootFormat, stripNs, type JsonPath } from './lootModel';

export interface FormatOptions {
  insertSpaces: boolean;
  tabSize: number;
  eol: string;
}

export const DEFAULT_FORMAT: FormatOptions = { insertSpaces: true, tabSize: 2, eol: '\n' };

export type LootEditOp =
  | { op: 'addPool' }
  | { op: 'deletePool'; pool: number }
  | { op: 'setRolls'; pool: number; rolls: number | { min: number; max: number } }
  | { op: 'addEntry'; pool: number; item: string; weight?: number; kind?: 'item' | 'tag' | 'loot_table' | 'empty' }
  | { op: 'deleteEntry'; path: JsonPath }
  | { op: 'setWeight'; path: JsonPath; weight: number }
  | { op: 'setCount'; path: JsonPath; count: number | { min: number; max: number } }
  | { op: 'setName'; path: JsonPath; name: string };

function parse(text: string): any {
  return jsonc.parse(text, [], { allowTrailingComma: true, disallowComments: false });
}

function modify(text: string, path: JsonPath, value: unknown, fmt: FormatOptions, insertIndex?: (props: string[]) => number): string {
  const edits = jsonc.modify(text, path, value, {
    formattingOptions: { insertSpaces: fmt.insertSpaces, tabSize: fmt.tabSize, eol: fmt.eol },
    getInsertionIndex: insertIndex,
  });
  return jsonc.applyEdits(text, edits);
}

function getAt(root: any, path: JsonPath): any {
  let cur = root;
  for (const k of path) {
    if (cur === undefined || cur === null) return undefined;
    cur = cur[k as any];
  }
  return cur;
}

/** Number provider JSON for a count / rolls value in a format. */
export function numberJson(v: number | { min: number; max: number }, format: LootFormat): number | Record<string, unknown> {
  if (typeof v === 'number') return v;
  if (v.min === v.max) return v.min;
  return format === 'modern'
    ? { type: 'minecraft:uniform', max: v.max, min: v.min }
    : { type: 'minecraft:uniform', min: v.min, max: v.max };
}

/** A new item / tag / loot_table entry in the right shape. */
export function newEntry(kind: 'item' | 'tag' | 'loot_table' | 'empty', id: string, weight: number | undefined): Record<string, unknown> {
  const e: Record<string, unknown> = { type: `minecraft:${kind}` };
  if (kind === 'item') e.name = id;
  if (kind === 'tag') {
    e.name = id.replace(/^#/, '');
    e.expand = true;
  }
  if (kind === 'loot_table') e.value = id;
  if (weight !== undefined && weight !== 1) e.weight = weight;
  return e;
}

/** Apply one edit; returns the new text (unchanged when the op does not apply). */
export function applyLootEdit(text: string, op: LootEditOp, format: LootFormat, fmt: FormatOptions = DEFAULT_FORMAT): string {
  const json = parse(text) ?? {};
  const keys = formatKeys(format);
  switch (op.op) {
    case 'addPool': {
      const pools = Array.isArray(json.pools) ? json.pools : undefined;
      const pool: Record<string, unknown> = format === 'modern' ? { entries: [], rolls: 1 } : { bonus_rolls: 0.0, entries: [], rolls: 1 };
      if (!pools) return modify(text, ['pools'], [pool], fmt);
      return modify(text, ['pools', pools.length], pool, fmt);
    }
    case 'deletePool':
      if (!Array.isArray(json.pools) || op.pool >= json.pools.length) return text;
      return modify(text, ['pools', op.pool], undefined, fmt);
    case 'setRolls':
      if (!json.pools?.[op.pool]) return text;
      return modify(text, ['pools', op.pool, 'rolls'], numberJson(op.rolls, format), fmt);
    case 'addEntry': {
      if (!json.pools?.[op.pool]) return text;
      const kind = op.kind ?? (op.item.startsWith('#') ? 'tag' : 'item');
      const entry = newEntry(kind, op.item, op.weight);
      const entries = json.pools[op.pool].entries;
      if (!Array.isArray(entries)) return modify(text, ['pools', op.pool, 'entries'], [entry], fmt);
      return modify(text, ['pools', op.pool, 'entries', entries.length], entry, fmt);
    }
    case 'deleteEntry':
      if (getAt(json, op.path) === undefined) return text;
      return modify(text, op.path, undefined, fmt);
    case 'setWeight': {
      const e = getAt(json, op.path);
      if (!e || typeof e !== 'object') return text;
      const w = Math.max(0, Math.round(op.weight));
      if (w === 1 && e.weight === undefined) return text;
      return modify(text, [...op.path, 'weight'], w, fmt);
    }
    case 'setName': {
      const e = getAt(json, op.path);
      if (!e || typeof e !== 'object') return text;
      const t = stripNs(e.type) || 'item';
      if (t === 'loot_table') return modify(text, [...op.path, 'value'], op.name, fmt);
      return modify(text, [...op.path, 'name'], t === 'tag' ? op.name.replace(/^#/, '') : op.name, fmt);
    }
    case 'setCount': {
      const e = getAt(json, op.path);
      if (!e || typeof e !== 'object') return text;
      const count = numberJson(op.count, format);
      const fnKey = 'modifier' in e ? 'modifier' : 'functions' in e ? 'functions' : keys.functions;
      const fns = functionsOf(e);
      const idx = fns.findIndex((f) => stripNs(f?.type ?? f?.function) === 'set_count' && !f.add);
      const raw = e[fnKey];
      if (idx >= 0) {
        const p = Array.isArray(raw) ? [...op.path, fnKey, idx, 'count'] : [...op.path, fnKey, 'count'];
        // Removing a "set_count 1" keeps the file tidy only when it is the sole function.
        return modify(text, p, count, fmt);
      }
      if (typeof op.count === 'number' && op.count === 1) return text; // default count, nothing to add
      const fn: Record<string, unknown> = { [fnKey === 'modifier' ? 'type' : 'function']: 'minecraft:set_count', count };
      if (raw === undefined) {
        // modern single function may be written as an object, but a list is always valid
        return modify(text, [...op.path, fnKey], [fn], fmt, (props) => Math.max(0, props.indexOf('name')));
      }
      if (Array.isArray(raw)) return insertAt(text, [...op.path, fnKey], 0, fn, fmt);
      // single object -> list [set_count, existing]
      return modify(text, [...op.path, fnKey], [fn, raw], fmt);
    }
  }
}

/** Insert a value at an index of an array (jsonc.modify with isArrayInsertion). */
function insertAt(text: string, arrayPath: JsonPath, index: number, value: unknown, fmt: FormatOptions): string {
  const edits = jsonc.modify(text, [...arrayPath, index], value, {
    formattingOptions: { insertSpaces: fmt.insertSpaces, tabSize: fmt.tabSize, eol: fmt.eol },
    isArrayInsertion: true,
  });
  return jsonc.applyEdits(text, edits);
}

/** Skeleton of a new, empty loot table for a format. */
export function newLootTable(type: string, format: LootFormat): Record<string, unknown> {
  return format === 'modern'
    ? { type, pools: [{ entries: [], rolls: 1 }] }
    : { type, pools: [{ bonus_rolls: 0.0, entries: [], rolls: 1 }] };
}
