// Loot table model: reads both loot table formats, summarizes functions/conditions in plain language,
// computes per-roll probabilities and expected counts, and runs Monte Carlo simulations.
// Pure module (no 'vscode' import): used by the extension host, the loot webview and unit tests.
//
// Formats:
//  - legacy (1.21 – 26.2):  "functions": [{"function": "minecraft:set_count", ...}], "conditions": [{"condition": ...}]
//  - modern (26.3+):        "modifier": {...} | [...] with "type", "condition": {...} | "predicate/reference" with "type",
//                           all_of / any_of combinators, predicate references as plain strings.
import { compareVersions } from '../../core/versions';
import { plainText, shortId } from './text';

export type LootFormat = 'legacy' | 'modern';
export type JsonPath = (string | number)[];

/** Version from which loot tables use "modifier" / "condition" (single) with "type" keys. */
export const MODERN_LOOT_VERSION = '26.3';

export function lootFormatForVersion(version: string): LootFormat {
  return compareVersions(version, MODERN_LOOT_VERSION) >= 0 ? 'modern' : 'legacy';
}

/** Detect the format a loot table file already uses (falls back to the target version). */
export function detectLootFormat(json: unknown, version: string): LootFormat {
  let modern = 0;
  let legacy = 0;
  const walk = (o: unknown, depth: number) => {
    if (depth > 12 || !o || typeof o !== 'object') return;
    if (Array.isArray(o)) return o.forEach((x) => walk(x, depth + 1));
    const r = o as Record<string, unknown>;
    if ('modifier' in r) modern++;
    if ('condition' in r && ('type' in r || typeof r.condition !== 'string')) modern++;
    if ('functions' in r || 'conditions' in r) legacy++;
    if (typeof r.function === 'string') legacy++;
    if (typeof r.condition === 'string' && !('type' in r)) legacy++;
    for (const v of Object.values(r)) walk(v, depth + 1);
  };
  walk(json, 0);
  if (modern > legacy) return 'modern';
  if (legacy > modern) return 'legacy';
  return lootFormatForVersion(version);
}

/** Key names for a format. */
export function formatKeys(format: LootFormat) {
  return format === 'modern'
    ? { functions: 'modifier', conditions: 'condition', fnType: 'type', condType: 'type' }
    : { functions: 'functions', conditions: 'conditions', fnType: 'function', condType: 'condition' };
}

export const stripNs = (s: unknown): string => (typeof s === 'string' ? s.replace(/^minecraft:/, '') : '');

/** Functions of an object (table/pool/entry) as an array, regardless of format. */
export function functionsOf(o: any): any[] {
  const v = o?.modifier ?? o?.functions;
  return v === undefined ? [] : Array.isArray(v) ? v : [v];
}

/** Conditions of an object as an array (all must pass). */
export function conditionsOf(o: any): any[] {
  // Only called on condition holders (table/pool/entry/function), never on legacy condition objects,
  // so "condition" here is always the modern key (an object, a list or a predicate reference string).
  const v = o?.condition !== undefined ? o.condition : o?.conditions;
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

/** Which key holds the functions of an object and the JSON path of function i. */
export function functionKey(o: any): 'modifier' | 'functions' | undefined {
  if (o && 'modifier' in o) return 'modifier';
  if (o && 'functions' in o) return 'functions';
  return undefined;
}

const fnType = (f: any): string => stripNs(f?.type ?? f?.function);
const condType = (c: any): string => (typeof c === 'string' ? 'reference' : stripNs(c?.type ?? c?.condition));

// ---------------------------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------------------------

export interface LootContext {
  /** Looting level of the killer's weapon. */
  looting: number;
  /** Fortune level of the tool. */
  fortune: number;
  /** The tool has Silk Touch. */
  silkTouch: boolean;
  /** The tool is shears. */
  shears: boolean;
  /** The entity was killed by a player. */
  killedByPlayer: boolean;
  /** Player luck (affects bonus_rolls and entry quality). */
  luck: number;
  /** How to treat conditions that cannot be evaluated (entity properties, location, weather...). */
  unknown: 'pass' | 'fail';
}

export const DEFAULT_CONTEXT: LootContext = {
  looting: 0,
  fortune: 0,
  silkTouch: false,
  shears: false,
  killedByPlayer: true,
  luck: 0,
  unknown: 'pass',
};

export function enchantmentLevel(ctx: LootContext, enchantment: unknown): number {
  const e = stripNs(enchantment);
  if (e === 'fortune') return ctx.fortune;
  if (e === 'looting') return ctx.looting;
  if (e === 'silk_touch') return ctx.silkTouch ? 1 : 0;
  return 0;
}

// ---------------------------------------------------------------------------------------------
// Discrete distributions over integer counts
// ---------------------------------------------------------------------------------------------

export type Dist = Map<number, number>;

export const point = (k: number): Dist => new Map([[k, 1]]);

export function uniformInt(a: number, b: number): Dist {
  if (b < a) return point(a);
  const d: Dist = new Map();
  const p = 1 / (b - a + 1);
  for (let k = a; k <= b; k++) d.set(k, p);
  return d;
}

export function binomialDist(n: number, p: number): Dist {
  const d: Dist = new Map();
  n = Math.max(0, Math.floor(n));
  p = Math.min(1, Math.max(0, p));
  let c = 1;
  for (let k = 0; k <= n; k++) {
    if (k > 0) c = (c * (n - k + 1)) / k;
    d.set(k, c * Math.pow(p, k) * Math.pow(1 - p, n - k));
  }
  return d;
}

export function addDist(a: Dist, b: Dist): Dist {
  const d: Dist = new Map();
  for (const [x, px] of a) for (const [y, py] of b) d.set(x + y, (d.get(x + y) ?? 0) + px * py);
  return d;
}

export function mapDist(a: Dist, f: (k: number) => Dist): Dist {
  const d: Dist = new Map();
  for (const [x, px] of a) for (const [y, py] of f(x)) d.set(y, (d.get(y) ?? 0) + px * py);
  return prune(d);
}

export function mixDist(a: Dist, b: Dist, pa: number): Dist {
  const d: Dist = new Map();
  for (const [x, p] of a) d.set(x, (d.get(x) ?? 0) + p * pa);
  for (const [x, p] of b) d.set(x, (d.get(x) ?? 0) + p * (1 - pa));
  return prune(d);
}

function prune(d: Dist): Dist {
  for (const [k, p] of d) if (p < 1e-12) d.delete(k);
  return d;
}

export function meanDist(d: Dist): number {
  let m = 0;
  for (const [k, p] of d) m += k * p;
  return m;
}

export function sampleDist(d: Dist, rng: () => number): number {
  let r = rng();
  let last = 0;
  for (const [k, p] of d) {
    last = k;
    r -= p;
    if (r <= 0) return k;
  }
  return last;
}

export function distRange(d: Dist): [number, number] {
  const ks = [...d.keys()];
  return ks.length ? [Math.min(...ks), Math.max(...ks)] : [0, 0];
}

// ---------------------------------------------------------------------------------------------
// Number providers & level-based values
// ---------------------------------------------------------------------------------------------

export type NumberProvider = number | Record<string, any> | undefined;

export function npKind(np: NumberProvider): string {
  if (typeof np === 'number') return 'constant';
  if (!np || typeof np !== 'object') return 'unknown';
  const t = stripNs(np.type);
  if (t) return t;
  if ('min' in np || 'max' in np) return 'uniform';
  if ('n' in np && 'p' in np) return 'binomial';
  if ('value' in np) return 'constant';
  return 'unknown';
}

/** Distribution of NumberProvider.getInt(). Undefined when not computable (score, storage...). */
export function npIntDist(np: NumberProvider, ctx: LootContext = DEFAULT_CONTEXT): Dist | undefined {
  const k = npKind(np);
  if (k === 'constant') return point(Math.round(typeof np === 'number' ? np : Number((np as any).value ?? 0)));
  const o = np as Record<string, any>;
  if (k === 'uniform') {
    const a = npIntMean(o.min, ctx);
    const b = npIntMean(o.max, ctx);
    if (a === undefined || b === undefined) return undefined;
    return uniformInt(Math.round(a), Math.round(b));
  }
  if (k === 'binomial') {
    const n = npIntMean(o.n, ctx);
    const p = npFloatMean(o.p, ctx);
    if (n === undefined || p === undefined) return undefined;
    return binomialDist(n, p);
  }
  if (k === 'enchantment_level') {
    const v = levelBased(o.amount, 1);
    return v === undefined ? undefined : point(Math.round(v));
  }
  return undefined;
}

export function npIntMean(np: NumberProvider, ctx: LootContext = DEFAULT_CONTEXT): number | undefined {
  const d = npIntDist(np, ctx);
  return d ? meanDist(d) : undefined;
}

export function npFloatMean(np: NumberProvider, ctx: LootContext = DEFAULT_CONTEXT): number | undefined {
  const k = npKind(np);
  if (k === 'constant') return typeof np === 'number' ? np : Number((np as any).value ?? 0);
  const o = np as Record<string, any>;
  if (k === 'uniform') {
    const a = npFloatMean(o.min, ctx);
    const b = npFloatMean(o.max, ctx);
    return a === undefined || b === undefined ? undefined : (a + b) / 2;
  }
  if (k === 'binomial') {
    const n = npIntMean(o.n, ctx);
    const p = npFloatMean(o.p, ctx);
    return n === undefined || p === undefined ? undefined : n * p;
  }
  return npIntMean(np, ctx);
}

/** Sample points (value, probability) of NumberProvider.getFloat() — continuous uniforms are discretized. */
export function npFloatSamples(np: NumberProvider, ctx: LootContext = DEFAULT_CONTEXT, steps = 21): [number, number][] | undefined {
  const k = npKind(np);
  if (k === 'uniform') {
    const o = np as Record<string, any>;
    const a = npFloatMean(o.min, ctx);
    const b = npFloatMean(o.max, ctx);
    if (a === undefined || b === undefined) return undefined;
    if (a === b) return [[a, 1]];
    const out: [number, number][] = [];
    for (let i = 0; i < steps; i++) out.push([a + ((b - a) * (i + 0.5)) / steps, 1 / steps]);
    return out;
  }
  if (k === 'binomial') {
    const d = npIntDist(np, ctx);
    return d ? [...d] : undefined;
  }
  const m = npFloatMean(np, ctx);
  return m === undefined ? undefined : [[m, 1]];
}

/** Human readable number provider: "2", "1–3", "B(3, 0.53)", "score", ... */
export function npText(np: NumberProvider): string {
  const k = npKind(np);
  const f = (n: unknown) => (typeof n === 'number' ? fmtNum(n) : npText(n as NumberProvider));
  if (k === 'constant') return fmtNum(typeof np === 'number' ? np : Number((np as any).value ?? 0));
  const o = np as Record<string, any>;
  if (k === 'uniform') return `${f(o.min)}–${f(o.max)}`;
  if (k === 'binomial') return `B(${f(o.n)}, ${f(o.p)})`;
  if (k === 'enchantment_level') return `lvl(${levelBasedText(o.amount)})`;
  if (k === 'score') return `score ${o.score ?? ''}`.trim();
  if (k === 'storage') return `storage ${o.storage ?? ''}`.trim();
  return k;
}

export function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  return String(Math.round(n * 1000) / 1000);
}

export function fmtPercent(p: number): string {
  const v = p * 100;
  if (v === 0) return '0%';
  if (v < 0.1) return `${v.toFixed(3)}%`;
  if (v < 1) return `${v.toFixed(2)}%`;
  if (v < 10) return `${v.toFixed(1)}%`;
  return `${Math.round(v * 10) / 10}%`;
}

/** Evaluate a LevelBasedValue (enchantments) at a level. */
export function levelBased(v: unknown, level: number): number | undefined {
  if (typeof v === 'number') return v;
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, any>;
  const t = stripNs(o.type) || 'linear';
  if (t === 'linear') return Number(o.base ?? 0) + Number(o.per_level_above_first ?? 0) * (level - 1);
  if (t === 'clamped') {
    const x = levelBased(o.value, level);
    return x === undefined ? undefined : Math.min(Number(o.max ?? x), Math.max(Number(o.min ?? x), x));
  }
  if (t === 'fraction') {
    const a = levelBased(o.numerator, level);
    const b = levelBased(o.denominator, level);
    return a === undefined || !b ? undefined : a / b;
  }
  if (t === 'levels_squared') return level * level + Number(o.added ?? 0);
  if (t === 'lookup') {
    const vals = Array.isArray(o.values) ? o.values : [];
    return level >= 1 && level <= vals.length ? Number(vals[level - 1]) : levelBased(o.fallback, level);
  }
  if (t === 'constant') return Number(o.value ?? 0);
  return undefined;
}

function levelBasedText(v: unknown): string {
  if (typeof v === 'number') return fmtNum(v);
  if (v && typeof v === 'object' && stripNs((v as any).type) === 'linear')
    return `${fmtNum((v as any).base)}+${fmtNum((v as any).per_level_above_first)}/lvl`;
  return '…';
}

// ---------------------------------------------------------------------------------------------
// Plain-language summaries (English templates translated by the webview with t(text, ...args))
// ---------------------------------------------------------------------------------------------

export interface Summary {
  /** English template with {0}, {1}... placeholders. */
  text: string;
  args?: (string | number)[];
  /** Nested summaries (combinators, conditional functions). */
  children?: Summary[];
  /** Short type id (e.g. "set_count", "random_chance"). */
  type: string;
  /** Category hint for icons: "silk", "shears", "player", "chance", "fortune", "looting", "explosion"... */
  hint?: string;
}

const pct = (x: unknown) => (typeof x === 'number' ? fmtPercent(x) : npText(x as NumberProvider));

/** Names of well-known predicate files referenced from loot tables (26.3+). */
function referenceSummary(name: string): Summary {
  const n = stripNs(name);
  if (/silk_touch/.test(n)) return { type: 'reference', text: 'Tool has Silk Touch', hint: 'silk', args: [] };
  if (/shear/.test(n)) return { type: 'reference', text: 'Tool is shears', hint: 'shears', args: [] };
  return { type: 'reference', text: 'Predicate {0}', args: [name] };
}

/** Does a match_tool predicate (or anything below it) require Silk Touch / shears? */
function toolPredicateKind(pred: unknown): 'silk' | 'shears' | undefined {
  const s = JSON.stringify(pred ?? {});
  if (s.includes('silk_touch')) return 'silk';
  if (/shears|can_shear/.test(s)) return 'shears';
  return undefined;
}

export function summarizeCondition(c: any): Summary {
  const t = condType(c);
  if (typeof c === 'string') return referenceSummary(c);
  switch (t) {
    case 'reference':
      return referenceSummary(String(c.name ?? ''));
    case 'random_chance':
      return { type: t, text: '{0} chance', args: [pct(c.chance)], hint: 'chance' };
    case 'random_chance_with_looting':
      return {
        type: t,
        text: '{0} chance, +{1} per Looting level',
        args: [pct(c.chance), pct(c.looting_multiplier ?? 0)],
        hint: 'looting',
      };
    case 'random_chance_with_enchanted_bonus': {
      const lvl1 = levelBased(c.enchanted_chance, 1);
      const lvl2 = levelBased(c.enchanted_chance, 2);
      return {
        type: t,
        text: '{0} chance; with {1}: {2} at level I (+{3}/level)',
        args: [
          pct(c.unenchanted_chance ?? 0),
          String(c.enchantment ?? ''),
          lvl1 === undefined ? '?' : fmtPercent(lvl1),
          lvl1 === undefined || lvl2 === undefined ? '?' : fmtPercent(lvl2 - lvl1),
        ],
        hint: stripNs(c.enchantment) === 'looting' ? 'looting' : 'chance',
      };
    }
    case 'survives_explosion':
      return { type: t, text: 'Survives the explosion', hint: 'explosion' };
    case 'killed_by_player':
      return { type: t, text: 'Killed by a player', hint: 'player' };
    case 'match_tool': {
      const k = toolPredicateKind(c.predicate);
      if (k === 'silk') return { type: t, text: 'Tool has Silk Touch', hint: 'silk' };
      if (k === 'shears') return { type: t, text: 'Tool is shears', hint: 'shears' };
      const items = c.predicate?.items;
      return items
        ? { type: t, text: 'Tool is {0}', args: [Array.isArray(items) ? items.join(', ') : String(items)], hint: 'tool' }
        : { type: t, text: 'Tool matches a predicate', hint: 'tool' };
    }
    case 'table_bonus':
      return {
        type: t,
        text: 'Chance by {0} level: {1}',
        args: [String(c.enchantment ?? ''), (Array.isArray(c.chances) ? c.chances : []).map((x: number) => fmtPercent(x)).join(' / ')],
        hint: stripNs(c.enchantment) === 'fortune' ? 'fortune' : 'chance',
      };
    case 'inverted':
      return { type: t, text: 'Not:', children: [summarizeCondition(c.term)] };
    case 'all_of':
      return { type: t, text: 'All of:', children: (c.terms ?? []).map(summarizeCondition) };
    case 'any_of':
    case 'alternative':
      return { type: t, text: 'Any of:', children: (c.terms ?? []).map(summarizeCondition) };
    case 'entity_properties': {
      const keys = Object.keys(c.predicate ?? {}).map(shortId);
      const type = c.predicate?.['minecraft:entity_type'] ?? c.predicate?.type;
      if (typeof type === 'string' && keys.length === 1) return { type: t, text: '{0} is a {1}', args: [String(c.entity ?? 'this'), type] };
      const flags = c.predicate?.['minecraft:flags'] ?? c.predicate?.flags;
      if (flags?.is_on_fire) return { type: t, text: '{0} is on fire', args: [String(c.entity ?? 'this')] };
      return { type: t, text: 'Entity ({0}) matches: {1}', args: [String(c.entity ?? 'this'), keys.join(', ') || '{}'] };
    }
    case 'block_state_property':
    case 'match_block': {
      const state = c.properties ?? c.state;
      const st = state && typeof state === 'object' ? Object.entries(state).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`).join(', ') : '';
      return st
        ? { type: t, text: 'Block {0} with {1}', args: [String(c.block ?? c.blocks ?? '?'), st] }
        : { type: t, text: 'Block is {0}', args: [String(c.block ?? c.blocks ?? '?')] };
    }
    case 'location_check':
      return { type: t, text: 'Location matches a predicate' };
    case 'weather_check': {
      const w: string[] = [];
      if (c.raining !== undefined) w.push(`raining=${c.raining}`);
      if (c.thundering !== undefined) w.push(`thundering=${c.thundering}`);
      return { type: t, text: 'Weather: {0}', args: [w.join(', ')] };
    }
    case 'time_check':
      return { type: t, text: 'Time of day: {0}', args: [npText(c.value)] };
    case 'damage_source_properties':
      return { type: t, text: 'Damage source matches a predicate' };
    case 'entity_scores':
      return { type: t, text: 'Scores of {0}: {1}', args: [String(c.entity ?? 'this'), Object.keys(c.scores ?? {}).join(', ')] };
    case 'value_check':
    case 'int_value_check':
    case 'float_value_check':
      return { type: t, text: 'Value {0} in range {1}', args: [npText(c.value), JSON.stringify(c.range ?? {})] };
    case 'enchantment_active_check':
      return { type: t, text: 'Enchantment is active: {0}', args: [String(c.active ?? true)] };
    case 'environment_attribute_check':
      return { type: t, text: 'Environment attribute {0}', args: [String(c.attribute ?? '')] };
    default:
      return { type: t || '?', text: 'Condition {0}', args: [t || '?'] };
  }
}

function enchList(o: unknown): string {
  if (typeof o === 'string') return o;
  if (Array.isArray(o)) return o.join(', ');
  if (o && typeof o === 'object')
    return Object.entries(o as Record<string, unknown>)
      .map(([k, v]) => `${shortId(k)} ${npText(v as NumberProvider)}`)
      .join(', ');
  return '';
}

export function summarizeFunction(f: any): Summary {
  const t = fnType(f);
  const conds = conditionsOf(f);
  const s = summarizeFunctionCore(f, t);
  if (conds.length) s.children = [...(s.children ?? []), { type: 'when', text: 'Only if:', children: conds.map(summarizeCondition) }];
  return s;
}

function summarizeFunctionCore(f: any, t: string): Summary {
  switch (t) {
    case 'set_count':
      return f.add ? { type: t, text: 'Add {0} to the count', args: [npText(f.count)] } : { type: t, text: 'Count: {0}', args: [npText(f.count)] };
    case 'enchant_randomly': {
      const opts = f.options ?? f.enchantments;
      return opts
        ? { type: t, text: 'Enchant randomly with {0}', args: [Array.isArray(opts) ? opts.join(', ') : String(opts)] }
        : { type: t, text: 'Enchant randomly (any enchantment)' };
    }
    case 'enchant_with_levels':
      return { type: t, text: 'Enchant as with {0} levels ({1})', args: [npText(f.levels), String(f.options ?? (f.treasure ? 'treasure' : 'any'))] };
    case 'set_enchantments':
      return { type: t, text: f.add ? 'Add enchantments: {0}' : 'Set enchantments: {0}', args: [enchList(f.enchantments)] };
    case 'set_components':
      return { type: t, text: 'Set components: {0}', args: [Object.keys(f.components ?? {}).map(shortId).join(', ')] };
    case 'apply_bonus': {
      const ench = String(f.enchantment ?? '');
      const formula = stripNs(f.formula);
      const hint = stripNs(ench) === 'fortune' ? 'fortune' : undefined;
      if (formula === 'ore_drops') return { type: t, text: '{0} multiplies the drops (ore formula)', args: [ench], hint };
      if (formula === 'uniform_bonus_count')
        return { type: t, text: '{0}: +0 to {1}×level extra items', args: [ench, fmtNum(f.parameters?.bonusMultiplier ?? 1)], hint };
      if (formula === 'binomial_with_bonus_count')
        return {
          type: t,
          text: '{0}: +{1} tries at {2} each (plus one per level)',
          args: [ench, fmtNum(f.parameters?.extra ?? 0), fmtPercent(f.parameters?.probability ?? 0)],
          hint,
        };
      return { type: t, text: '{0} bonus ({1})', args: [ench, formula], hint };
    }
    case 'enchanted_count_increase':
    case 'looting_enchant':
      return {
        type: t,
        text: '+{0} per {1} level',
        args: [npText(f.count), String(f.enchantment ?? 'minecraft:looting')],
        hint: 'looting',
      };
    case 'set_name':
      return {
        type: t,
        text: f.target === 'item_name' ? 'Item name: “{0}”' : 'Custom name: “{0}”',
        args: [plainText(f.name)],
      };
    case 'set_lore':
      return { type: t, text: 'Lore: {0} line(s)', args: [Array.isArray(f.lore) ? f.lore.length : 0] };
    case 'explosion_decay':
      return { type: t, text: 'Some items are lost in explosions', hint: 'explosion' };
    case 'furnace_smelt':
      return { type: t, text: 'Smelted (as in a furnace)', hint: 'fire' };
    case 'limit_count': {
      const l = f.limit;
      const lo = typeof l === 'number' ? l : l?.min;
      const hi = typeof l === 'number' ? l : l?.max;
      return { type: t, text: 'Limit count to {0}', args: [`${lo !== undefined ? npText(lo) : '…'}–${hi !== undefined ? npText(hi) : '…'}`] };
    }
    case 'set_damage':
      return { type: t, text: f.add ? 'Change durability by {0}' : 'Durability: {0}', args: [percentNp(f.damage)] };
    case 'set_potion':
      return { type: t, text: 'Potion: {0}', args: [String(f.id ?? '')] };
    case 'set_random_potion':
      return { type: t, text: 'Random potion' };
    case 'set_stew_effect':
      return { type: t, text: 'Random stew effect: {0}', args: [(f.effects ?? []).map((e: any) => shortId(String(e.type ?? e.id ?? ''))).join(', ')] };
    case 'exploration_map':
      return { type: t, text: 'Explorer map to {0}', args: [String(f.destination ?? '#minecraft:on_treasure_maps')] };
    case 'copy_components':
      return { type: t, text: 'Copy components from {0}', args: [String(f.source ?? '')] };
    case 'copy_name':
      return { type: t, text: 'Copy the name from {0}', args: [String(f.source ?? '')] };
    case 'copy_state':
      return { type: t, text: 'Copy block state {0}', args: [(f.properties ?? []).join(', ')] };
    case 'copy_custom_data':
    case 'copy_nbt':
      return { type: t, text: 'Copy custom data from {0}', args: [typeof f.source === 'string' ? f.source : String(f.source?.type ?? '')] };
    case 'set_custom_data':
    case 'set_nbt':
      return { type: t, text: 'Set custom data {0}', args: [typeof f.tag === 'string' ? f.tag : JSON.stringify(f.tag ?? {})] };
    case 'set_instrument':
      return { type: t, text: 'Instrument from {0}', args: [String(f.options ?? '')] };
    case 'set_ominous_bottle_amplifier':
      return { type: t, text: 'Ominous bottle amplifier {0}', args: [npText(f.amplifier)] };
    case 'set_item':
      return { type: t, text: 'Change the item to {0}', args: [String(f.item ?? '')] };
    case 'set_attributes':
      return { type: t, text: 'Set {0} attribute modifier(s)', args: [Array.isArray(f.modifiers) ? f.modifiers.length : 0] };
    case 'set_loot_table':
      return { type: t, text: 'Container loot table: {0}', args: [String(f.name ?? '')] };
    case 'set_contents':
      return { type: t, text: 'Set container contents ({0} entries)', args: [Array.isArray(f.entries) ? f.entries.length : 0] };
    case 'fill_player_head':
      return { type: t, text: 'Player head of {0}', args: [String(f.entity ?? 'this')] };
    case 'toggle_tooltips':
      return { type: t, text: 'Toggle tooltips' };
    case 'set_custom_model_data':
      return { type: t, text: 'Set custom model data' };
    case 'reference':
      return { type: t, text: 'Apply item modifier {0}', args: [String(f.name ?? '')] };
    case 'sequence':
      return { type: t, text: 'Sequence:', children: (f.functions ?? []).map(summarizeFunction) };
    case 'filtered':
      return { type: t, text: 'If the item matches a filter: {0}', args: [fnType(f.on_pass ?? f.modifier) || '…'] };
    case 'discard':
      return { type: t, text: 'Discard the item' };
    case 'set_random_dyes':
      return { type: t, text: 'Random dye colours' };
    default:
      return { type: t || '?', text: 'Function {0}', args: [t || '?'] };
  }
}

function percentNp(np: NumberProvider): string {
  const k = npKind(np);
  if (k === 'constant') return fmtPercent(npFloatMean(np) ?? 0);
  if (k === 'uniform') return `${fmtPercent(npFloatMean((np as any).min) ?? 0)}–${fmtPercent(npFloatMean((np as any).max) ?? 0)}`;
  return npText(np);
}

// ---------------------------------------------------------------------------------------------
// Condition probability & count distributions
// ---------------------------------------------------------------------------------------------

/** Probability that a condition passes in a context (independence assumed for combinators). */
export function conditionChance(c: any, ctx: LootContext): number {
  const unknown = ctx.unknown === 'pass' ? 1 : 0;
  if (typeof c === 'string') return referenceChance(c, ctx, unknown);
  const t = condType(c);
  switch (t) {
    case 'reference':
      return referenceChance(String(c.name ?? ''), ctx, unknown);
    case 'random_chance': {
      const v = npFloatMean(c.chance, ctx);
      return clamp01(v ?? 0.5);
    }
    case 'random_chance_with_looting':
      return clamp01(Number(c.chance ?? 0) + ctx.looting * Number(c.looting_multiplier ?? 0));
    case 'random_chance_with_enchanted_bonus': {
      const lvl = enchantmentLevel(ctx, c.enchantment);
      if (lvl > 0) return clamp01(levelBased(c.enchanted_chance, lvl) ?? 0);
      return clamp01(Number(c.unenchanted_chance ?? 0));
    }
    case 'survives_explosion':
      return 1;
    case 'killed_by_player':
      return ctx.killedByPlayer ? 1 : 0;
    case 'match_tool': {
      const k = toolPredicateKind(c.predicate);
      if (k === 'silk') return ctx.silkTouch ? 1 : 0;
      if (k === 'shears') return ctx.shears ? 1 : 0;
      return unknown;
    }
    case 'table_bonus': {
      const ch: number[] = Array.isArray(c.chances) ? c.chances : [];
      if (!ch.length) return 0;
      return clamp01(ch[Math.min(enchantmentLevel(ctx, c.enchantment), ch.length - 1)]);
    }
    case 'inverted':
      return 1 - conditionChance(c.term, ctx);
    case 'all_of':
      return (c.terms ?? []).reduce((p: number, x: unknown) => p * conditionChance(x, ctx), 1);
    case 'any_of':
    case 'alternative':
      return 1 - (c.terms ?? []).reduce((p: number, x: unknown) => p * (1 - conditionChance(x, ctx)), 1);
    default:
      return unknown;
  }
}

function referenceChance(name: string, ctx: LootContext, unknown: number): number {
  const n = stripNs(name);
  if (/silk_touch/.test(n)) return ctx.silkTouch ? 1 : 0;
  if (/shear/.test(n)) return ctx.shears ? 1 : 0;
  return unknown;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, Number.isFinite(x) ? x : 0));

/** All conditions of an object pass. */
export function conditionsChance(o: any, ctx: LootContext): number {
  return conditionsOf(o).reduce((p, c) => p * conditionChance(c, ctx), 1);
}

const MAX_SUPPORT = 4096;

/** Apply one loot function to a count distribution. Unknown functions leave the count unchanged. */
export function applyFunction(d: Dist, f: any, ctx: LootContext): Dist {
  const pass = conditionsChance(f, ctx);
  if (pass <= 0) return d;
  const applied = applyFunctionCore(d, f, ctx);
  return pass >= 1 ? applied : mixDist(applied, d, pass);
}

function applyFunctionCore(d: Dist, f: any, ctx: LootContext): Dist {
  const t = fnType(f);
  switch (t) {
    case 'set_count': {
      const c = npIntDist(f.count, ctx);
      if (!c) return d;
      return f.add ? prune(addDist(d, c)) : c;
    }
    case 'apply_bonus': {
      const lvl = enchantmentLevel(ctx, f.enchantment);
      if (lvl <= 0) return d;
      const formula = stripNs(f.formula);
      if (formula === 'ore_drops') {
        // count * (max(0, rand(level + 2) - 1) + 1)
        const mult: Dist = new Map();
        const n = lvl + 2;
        for (let i = 0; i < n; i++) {
          const m = Math.max(0, i - 1) + 1;
          mult.set(m, (mult.get(m) ?? 0) + 1 / n);
        }
        return mapDist(d, (k) => {
          const out: Dist = new Map();
          for (const [m, p] of mult) out.set(k * m, (out.get(k * m) ?? 0) + p);
          return out;
        });
      }
      if (formula === 'uniform_bonus_count') {
        const mult = Number(f.parameters?.bonusMultiplier ?? 1);
        return prune(addDist(d, uniformInt(0, Math.max(0, Math.floor(mult * lvl)))));
      }
      if (formula === 'binomial_with_bonus_count') {
        return prune(addDist(d, binomialDist(lvl + Number(f.parameters?.extra ?? 0), Number(f.parameters?.probability ?? 0))));
      }
      return d;
    }
    case 'enchanted_count_increase':
    case 'looting_enchant': {
      const lvl = t === 'looting_enchant' ? ctx.looting : enchantmentLevel(ctx, f.enchantment ?? 'minecraft:looting');
      if (lvl <= 0) return d;
      const inc = roundedScaledDist(f.count, lvl, ctx);
      if (!inc) return d;
      let out = prune(addDist(d, inc));
      const limit = Number(f.limit ?? 0);
      if (limit > 0) out = mapDist(out, (k) => point(Math.min(k, limit)));
      return out;
    }
    case 'limit_count': {
      const l = f.limit;
      const lo = typeof l === 'number' ? l : l?.min !== undefined ? npIntMean(l.min, ctx) : undefined;
      const hi = typeof l === 'number' ? l : l?.max !== undefined ? npIntMean(l.max, ctx) : undefined;
      return mapDist(d, (k) => point(Math.min(hi ?? Infinity, Math.max(lo ?? -Infinity, k))));
    }
    case 'sequence':
      return (f.functions ?? []).reduce((acc: Dist, g: unknown) => applyFunction(acc, g, ctx), d);
    case 'discard':
      return point(0);
    default:
      return d;
  }
}

/** Distribution of round(scale * provider.getFloat()) — exact for uniform providers. */
function roundedScaledDist(np: NumberProvider, scale: number, ctx: LootContext): Dist | undefined {
  if (npKind(np) === 'uniform') {
    const a = npFloatMean((np as any).min, ctx);
    const b = npFloatMean((np as any).max, ctx);
    if (a === undefined || b === undefined) return undefined;
    if (b <= a) return point(Math.round(scale * a));
    const lo = scale * a;
    const hi = scale * b;
    const d: Dist = new Map();
    for (let k = Math.round(lo); k <= Math.round(hi); k++) {
      const len = Math.min(hi, k + 0.5) - Math.max(lo, k - 0.5);
      if (len > 0) d.set(k, len / (hi - lo));
    }
    return d;
  }
  const samples = npFloatSamples(np, ctx);
  if (!samples) return undefined;
  const d: Dist = new Map();
  for (const [x, p] of samples) {
    const k = Math.round(scale * x);
    d.set(k, (d.get(k) ?? 0) + p);
  }
  return d;
}

/** Count distribution after applying a list of functions to a single item. */
export function countDistribution(functions: any[], ctx: LootContext, start: Dist = point(1)): Dist {
  let d = start;
  for (const f of functions) {
    d = applyFunction(d, f, ctx);
    if (d.size > MAX_SUPPORT) break;
  }
  return d;
}

// ---------------------------------------------------------------------------------------------
// Analysis (view model)
// ---------------------------------------------------------------------------------------------

export interface EntryView {
  path: JsonPath;
  /** Short type: item, tag, loot_table, alternatives, group, sequence, dynamic, empty, slots... */
  type: string;
  /** Item id, "#tag", loot table id, dynamic name. */
  name?: string;
  /** loot_table entry with an inline table. */
  inline?: boolean;
  expand?: boolean;
  weight: number;
  /** "weight" key present in the JSON. */
  hasWeight: boolean;
  quality: number;
  conditions: Summary[];
  functions: Summary[];
  /** Count text from set_count ("1–3"), if any. */
  countText?: string;
  children?: EntryView[];
  /** Leaf only: probability to be picked in one roll of the pool (pool conditions included). */
  chance?: number;
  /** Leaf only: expected number of items per roll. */
  expectedPerRoll?: number;
  /** Leaf only: expected number of items each time the whole table is rolled. */
  expectedPerTable?: number;
  /** Leaf only: min/max item count when picked. */
  countRange?: [number, number];
  /** Tag members used for expand=true. */
  members?: string[];
}

export interface PoolView {
  index: number;
  path: JsonPath;
  rollsText: string;
  bonusRollsText?: string;
  rollsMean: number;
  /** Probability that the pool conditions pass. */
  poolChance: number;
  conditions: Summary[];
  functions: Summary[];
  entries: EntryView[];
  totalWeight: number;
}

export interface TableView {
  type?: string;
  randomSequence?: string;
  format: LootFormat;
  functions: Summary[];
  pools: PoolView[];
}

export interface AnalyzeOptions {
  ctx?: LootContext;
  /** Members of tags used by tag entries with expand=true ("#minecraft:x" -> ids). */
  tagMembers?: Record<string, string[]>;
  version?: string;
}

interface Leaf {
  view: EntryView;
  weight: number;
  q: number;
  dist: Dist;
}

export function analyzeLootTable(json: any, opts: AnalyzeOptions = {}): TableView {
  const ctx = opts.ctx ?? DEFAULT_CONTEXT;
  const format = detectLootFormat(json, opts.version ?? '26.3');
  const tableFns = functionsOf(json);
  const pools: PoolView[] = (Array.isArray(json?.pools) ? json.pools : []).map((pool: any, i: number) => {
    const path: JsonPath = ['pools', i];
    const poolChance = conditionsChance(pool, ctx);
    const rollsDist = npIntDist(pool.rolls ?? 1, ctx);
    const bonus = npFloatMean(pool.bonus_rolls ?? 0, ctx) ?? 0;
    const rollsMean = (rollsDist ? meanDist(rollsDist) : 1) + Math.floor(bonus * ctx.luck);
    const leaves: Leaf[] = [];
    const extraFns = [...functionsOf(pool), ...tableFns];
    const entries: EntryView[] = (Array.isArray(pool.entries) ? pool.entries : []).map((e: any, j: number) => {
      const r = buildEntry(e, [...path, 'entries', j], ctx, opts, extraFns);
      leaves.push(...r.leaves);
      return r.view;
    });
    // Approximate pick probability: q_i * w_i / (w_i + sum_{j!=i} q_j w_j)
    const expWeight = leaves.reduce((s, l) => s + l.q * l.weight, 0);
    for (const l of leaves) {
      const others = expWeight - l.q * l.weight;
      const pick = l.weight > 0 ? (l.q * l.weight) / (l.weight + others) : 0;
      const chance = pick * poolChance;
      const mean = meanDist(l.dist);
      l.view.chance = (l.view.chance ?? 0) + chance;
      l.view.expectedPerRoll = (l.view.expectedPerRoll ?? 0) + chance * mean;
      l.view.expectedPerTable = (l.view.expectedPerTable ?? 0) + chance * mean * rollsMean;
      l.view.countRange = distRange(l.dist);
    }
    return {
      index: i,
      path,
      rollsText: npText(pool.rolls ?? 1),
      bonusRollsText: pool.bonus_rolls !== undefined && npFloatMean(pool.bonus_rolls) !== 0 ? npText(pool.bonus_rolls) : undefined,
      rollsMean,
      poolChance,
      conditions: conditionsOf(pool).map(summarizeCondition),
      functions: functionsOf(pool).map(summarizeFunction),
      entries,
      totalWeight: leaves.reduce((s, l) => s + l.weight, 0),
    };
  });
  return {
    type: typeof json?.type === 'string' ? json.type : undefined,
    randomSequence: typeof json?.random_sequence === 'string' ? json.random_sequence : undefined,
    format,
    functions: tableFns.map(summarizeFunction),
    pools,
  };
}

function entryWeight(e: any, ctx: LootContext): number {
  return Math.max(0, Math.floor(Number(e?.weight ?? 1) + Number(e?.quality ?? 0) * ctx.luck));
}

function entryName(e: any, t: string): { name?: string; inline?: boolean } {
  if (t === 'item') return { name: typeof e.name === 'string' ? e.name : undefined };
  if (t === 'tag') {
    const n = e.name ?? e.items ?? e.tag;
    return { name: typeof n === 'string' ? (n.startsWith('#') ? n : `#${n}`) : undefined };
  }
  if (t === 'loot_table') {
    const v = e.value ?? e.name;
    return typeof v === 'string' ? { name: v } : { name: undefined, inline: true };
  }
  if (t === 'dynamic') return { name: typeof e.name === 'string' ? e.name : undefined };
  return {};
}

function findSetCount(fns: any[]): any | undefined {
  return fns.find((f) => fnType(f) === 'set_count' && !f.add);
}

function buildEntry(
  e: any,
  path: JsonPath,
  ctx: LootContext,
  opts: AnalyzeOptions,
  extraFns: any[],
): { view: EntryView; leaves: Leaf[]; success: number } {
  const t = stripNs(e?.type) || 'item';
  const p = conditionsChance(e, ctx);
  const fns = functionsOf(e);
  const sc = findSetCount(fns);
  const view: EntryView = {
    path,
    type: t,
    ...entryName(e, t),
    weight: Number(e?.weight ?? 1),
    hasWeight: e?.weight !== undefined,
    quality: Number(e?.quality ?? 0),
    expand: t === 'tag' ? !!e.expand : undefined,
    conditions: conditionsOf(e).map(summarizeCondition),
    functions: fns.map(summarizeFunction),
    countText: sc ? npText(sc.count) : undefined,
  };
  if (t === 'alternatives' || t === 'group' || t === 'sequence') {
    const leaves: Leaf[] = [];
    view.children = [];
    let rem = 1; // alternatives: probability that every previous child failed
    let acc = 1; // sequence: probability that every previous child succeeded
    (Array.isArray(e.children) ? e.children : []).forEach((c: any, i: number) => {
      const r = buildEntry(c, [...path, 'children', i], ctx, opts, extraFns);
      view.children!.push(r.view);
      const scale = t === 'alternatives' ? p * rem : t === 'sequence' ? p * acc : p;
      for (const l of r.leaves) leaves.push({ ...l, q: l.q * scale });
      if (t === 'alternatives') rem *= 1 - r.success;
      if (t === 'sequence') acc *= r.success;
    });
    const success = t === 'alternatives' ? p * (1 - rem) : t === 'sequence' ? p * acc : p;
    return { view, leaves, success };
  }
  const dist = t === 'empty' ? point(0) : countDistribution([...fns, ...extraFns], ctx);
  const weight = entryWeight(e, ctx);
  if (t === 'tag' && view.expand && view.name) {
    const members = opts.tagMembers?.[view.name];
    if (members?.length) {
      view.members = members;
      // Every member is its own entry with the same weight; report the combined chance on the tag entry.
      const leaves = members.map(() => ({ view, weight, q: p, dist }));
      return { view, leaves, success: p };
    }
  }
  return { view, leaves: [{ view, weight, q: p, dist }], success: p };
}

// ---------------------------------------------------------------------------------------------
// Monte Carlo simulation
// ---------------------------------------------------------------------------------------------

export interface SimDrop {
  /** Item id, or "loot_table:<id>", "dynamic:<name>", "#tag" when it can't be resolved. */
  id: string;
  total: number;
  /** Number of runs in which at least one was dropped. */
  runsWithDrop: number;
  min: number;
  max: number;
}

export interface SimResult {
  runs: number;
  drops: SimDrop[];
  emptyRuns: number;
  /** Mean number of stacks (items of any kind) per run. */
  meanItems: number;
}

export interface SimOptions {
  rng?: () => number;
  tagMembers?: Record<string, string[]>;
  /** Resolve referenced loot tables (loot_table entries). */
  resolveTable?: (id: string) => any;
}

/** Deterministic PRNG (mulberry32) for reproducible simulations and tests. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function simulateLootTable(json: any, ctx: LootContext, runs: number, opts: SimOptions = {}): SimResult {
  const rng = opts.rng ?? Math.random;
  const distCache = new Map<unknown, Map<string, Dist>>();
  const stats = new Map<string, SimDrop>();
  let emptyRuns = 0;
  let items = 0;
  for (let r = 0; r < runs; r++) {
    const out = new Map<string, number>();
    rollTable(json, ctx, rng, out, opts, distCache, 0, []);
    let any = false;
    for (const [id, n] of out) {
      if (n <= 0) continue;
      any = true;
      items += n;
      let s = stats.get(id);
      if (!s) stats.set(id, (s = { id, total: 0, runsWithDrop: 0, min: Infinity, max: 0 }));
      s.total += n;
      s.runsWithDrop++;
      s.min = Math.min(s.min, n);
      s.max = Math.max(s.max, n);
    }
    if (!any) emptyRuns++;
  }
  const drops = [...stats.values()].sort((a, b) => b.total - a.total || a.id.localeCompare(b.id));
  // min over all runs (runs without the item count as 0)
  for (const d of drops) if (d.runsWithDrop < runs) d.min = 0;
  return { runs, drops, emptyRuns, meanItems: runs ? items / runs : 0 };
}

const bern = (p: number, rng: () => number) => p >= 1 || (p > 0 && rng() < p);

function rollTable(
  json: any,
  ctx: LootContext,
  rng: () => number,
  out: Map<string, number>,
  opts: SimOptions,
  cache: Map<unknown, Map<string, Dist>>,
  depth: number,
  parentFns: any[],
): void {
  if (!json || depth > 6) return;
  const tableFns = [...functionsOf(json), ...parentFns];
  for (const pool of Array.isArray(json.pools) ? json.pools : []) {
    if (!bern(conditionsChance(pool, ctx), rng)) continue;
    const rollsDist = npIntDist(pool.rolls ?? 1, ctx) ?? point(1);
    const rolls = sampleDist(rollsDist, rng) + Math.floor((npFloatMean(pool.bonus_rolls ?? 0, ctx) ?? 0) * ctx.luck);
    const fns = [...functionsOf(pool), ...tableFns];
    for (let i = 0; i < rolls; i++) {
      const cands: { e: any; w: number; member?: string }[] = [];
      for (const e of Array.isArray(pool.entries) ? pool.entries : []) expandEntry(e, ctx, rng, cands, opts);
      const total = cands.reduce((s, c) => s + c.w, 0);
      if (total <= 0) continue;
      let pick = rng() * total;
      let chosen = cands[cands.length - 1];
      for (const c of cands) {
        pick -= c.w;
        if (pick < 0) {
          chosen = c;
          break;
        }
      }
      emit(chosen, fns, ctx, rng, out, opts, cache, depth);
    }
  }
}

/** Returns true when the entry "succeeded" (used by alternatives / sequence). */
function expandEntry(e: any, ctx: LootContext, rng: () => number, cands: { e: any; w: number; member?: string }[], opts: SimOptions): boolean {
  if (!bern(conditionsChance(e, ctx), rng)) return false;
  const t = stripNs(e?.type) || 'item';
  if (t === 'alternatives') {
    for (const c of e.children ?? []) if (expandEntry(c, ctx, rng, cands, opts)) return true;
    return false;
  }
  if (t === 'group') {
    for (const c of e.children ?? []) expandEntry(c, ctx, rng, cands, opts);
    return true;
  }
  if (t === 'sequence') {
    for (const c of e.children ?? []) if (!expandEntry(c, ctx, rng, cands, opts)) return false;
    return true;
  }
  const w = entryWeight(e, ctx);
  if (t === 'tag' && e.expand) {
    const name = entryName(e, t).name ?? '';
    const members = opts.tagMembers?.[name];
    if (members?.length) {
      for (const m of members) cands.push({ e, w, member: m });
      return true;
    }
  }
  cands.push({ e, w });
  return true;
}

function emit(
  c: { e: any; member?: string },
  extraFns: any[],
  ctx: LootContext,
  rng: () => number,
  out: Map<string, number>,
  opts: SimOptions,
  cache: Map<unknown, Map<string, Dist>>,
  depth: number,
): void {
  const e = c.e;
  const t = stripNs(e?.type) || 'item';
  if (t === 'empty') return;
  const fns = [...functionsOf(e), ...extraFns];
  if (t === 'loot_table') {
    const v = e.value ?? e.name;
    const nested = typeof v === 'string' ? opts.resolveTable?.(v) : v;
    if (nested) rollTable(nested, ctx, rng, out, opts, cache, depth + 1, fns);
    else if (typeof v === 'string') out.set(`loot_table:${v}`, (out.get(`loot_table:${v}`) ?? 0) + 1);
    return;
  }
  let byKey = cache.get(e);
  if (!byKey) cache.set(e, (byKey = new Map()));
  const key = String(extraFns.length);
  let dist = byKey.get(key);
  if (!dist) byKey.set(key, (dist = countDistribution(fns, ctx)));
  const add = (id: string) => {
    const n = sampleDist(dist!, rng);
    if (n > 0) out.set(id, (out.get(id) ?? 0) + n);
  };
  if (t === 'item') add(typeof e.name === 'string' ? e.name : '?');
  else if (t === 'tag') {
    const name = entryName(e, t).name ?? '#?';
    if (c.member) add(c.member);
    else {
      const members = opts.tagMembers?.[name];
      if (members?.length) members.forEach(add);
      else add(name);
    }
  } else if (t === 'dynamic') add(`dynamic:${e.name ?? '?'}`);
  else add(`${t}:${e.name ?? ''}`);
}

/** Item / tag / loot table ids referenced by a table (for icon prefetching and tag expansion). */
export function referencedIds(json: unknown): { items: Set<string>; tags: Set<string>; tables: Set<string> } {
  const items = new Set<string>();
  const tags = new Set<string>();
  const tables = new Set<string>();
  const walkEntry = (e: any) => {
    if (!e || typeof e !== 'object') return;
    const t = stripNs(e.type) || 'item';
    if (t === 'item' && typeof e.name === 'string') items.add(e.name);
    if (t === 'tag') {
      const n = entryName(e, t).name;
      if (n) tags.add(n);
    }
    if (t === 'loot_table') {
      const v = e.value ?? e.name;
      if (typeof v === 'string') tables.add(v);
      else if (v && typeof v === 'object') walkTable(v);
    }
    (e.children ?? []).forEach(walkEntry);
  };
  const walkTable = (j: any) => (j?.pools ?? []).forEach((p: any) => (p?.entries ?? []).forEach(walkEntry));
  walkTable(json);
  return { items, tags, tables };
}
