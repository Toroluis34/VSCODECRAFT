// Recipe JSON <-> normalized model, version-aware serialization, editing helpers and migration.
// Pure module (no 'vscode' import): used by the extension host, the recipe webviews and unit tests.
import { atLeast } from '../../core/versions';

// ---------------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------------

export type JsonPath = (string | number)[];

export type IngredientKind = 'item' | 'tag' | 'list' | 'custom' | 'empty' | 'invalid';

/** A recipe ingredient in any syntax, reduced to the ids a UI needs to display it. */
export interface Ingredient {
  kind: IngredientKind;
  /** Item ids and "#tags" (normalized with namespace) — what an icon should cycle through. */
  ids: string[];
  /** Custom ingredient type (neoforge:compound, fabric:all_of ...). */
  customType?: string;
  /** Extra human-readable information (components, fluid, NBT...). */
  label?: string;
  /** Sized ingredients (count / amount). */
  count?: number;
  /** Ids that are subtracted / excluded (difference, none_of). */
  excluded?: string[];
  /** Simple ingredient written in the 1.21.1 object syntax ({"item":..} / {"tag":..}). */
  objectSyntax?: boolean;
  raw: unknown;
}

export interface ResultStack {
  id?: string;
  count: number;
  components?: Record<string, unknown>;
  chance?: number;
  label?: string;
  /** Location of the stack in the recipe json. */
  path: JsonPath;
  /** Written with the legacy "item" key instead of "id". */
  legacyItemKey?: boolean;
  raw: unknown;
}

export interface SlotInfo {
  /** Edit reference understood by setSlot(): "grid:r:c", "ing:i", "path:[...]", "brew:input" ... */
  ref: string;
  /** English label (translated by the UI). */
  label: string;
  ingredient: Ingredient | null;
}

export type RecipeKind =
  | 'shaped'
  | 'shapeless'
  | 'transmute'
  | 'dye'
  | 'imbue'
  | 'decorated_pot'
  | 'special'
  | 'cooking'
  | 'stonecutting'
  | 'smithing_transform'
  | 'smithing_trim'
  | 'brewing'
  | 'generic';

export interface RecipeWarning {
  /** English message with {0} placeholders (translated by the caller). */
  message: string;
  args?: (string | number)[];
  severity: 'error' | 'warning' | 'info';
}

export interface ShapedGrid {
  width: number;
  height: number;
  /** rows × columns, null = empty */
  cells: (Ingredient | null)[][];
  pattern: string[];
  key: Record<string, Ingredient>;
}

export interface RecipeModel {
  type: string;
  kind: RecipeKind;
  group?: string;
  category?: string;
  showNotification?: boolean;
  grid?: ShapedGrid;
  /** Ingredient slots other than the shaped grid, in display order. */
  slots: SlotInfo[];
  results: ResultStack[];
  cooking?: { time?: number; xp?: number; defaultTime: number };
  brewing?: { inputPotion?: string; outputPotion?: string };
  trimPattern?: string;
  /** Scalar properties of unknown/modded recipes (key -> value). */
  properties: { key: string; value: unknown }[];
  warnings: RecipeWarning[];
}

/** Format differences between versions that matter for recipes. */
export interface RecipeFormat {
  version: string;
  /** 'object' {"item":..}/{"tag":..} (1.21–1.21.1) or 'string' "minecraft:x"/"#tag" (1.21.2+). */
  ingredient: 'object' | 'string';
  /** crafting_transmute exists (1.21.2+). */
  transmute: boolean;
  /** crafting_transmute result is an item stack object (1.21.5+) instead of a plain id. */
  transmuteResultStack: boolean;
  /** smithing_trim requires "pattern" (1.21.5+). */
  trimPattern: boolean;
  /** crafting_dye / crafting_imbue + data-driven special recipes with explicit fields (26.1+). */
  dyeImbue: boolean;
  /** minecraft:brewing (26.3+). */
  brewing: boolean;
}

export function recipeFormatFor(version: string): RecipeFormat {
  return {
    version,
    ingredient: atLeast(version, '1.21.2') ? 'string' : 'object',
    transmute: atLeast(version, '1.21.2'),
    transmuteResultStack: atLeast(version, '1.21.5'),
    trimPattern: atLeast(version, '1.21.5'),
    dyeImbue: atLeast(version, '26.1'),
    brewing: atLeast(version, '26.3'),
  };
}

// ---------------------------------------------------------------------------------------------
// Ids & helpers
// ---------------------------------------------------------------------------------------------

export function nsId(value: string): string {
  let v = value.trim();
  const tag = v.startsWith('#');
  if (tag) v = v.slice(1);
  if (!v.includes(':')) v = `minecraft:${v}`;
  return tag ? `#${v}` : v;
}

export function normalizeType(type: unknown): string {
  return typeof type === 'string' && type ? nsId(type) : '';
}

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

/** Stable stringify (sorted keys) for structural comparisons. */
export function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (isObj(v)) {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v) ?? 'undefined';
}

export const jsonEqual = (a: unknown, b: unknown): boolean => stableStringify(a) === stableStringify(b);

// ---------------------------------------------------------------------------------------------
// Recipe type knowledge
// ---------------------------------------------------------------------------------------------

export const COOKING_TYPES: Record<string, number> = {
  'minecraft:smelting': 200,
  'minecraft:blasting': 100,
  'minecraft:smoking': 100,
  'minecraft:campfire_cooking': 600,
};

/** Fixed ingredient fields of vanilla types (display order). */
const FIELD_SLOTS: Record<string, string[]> = {
  'minecraft:crafting_transmute': ['input', 'material'],
  'minecraft:crafting_dye': ['target', 'dye'],
  'minecraft:crafting_imbue': ['source', 'material'],
  'minecraft:crafting_decorated_pot': ['back', 'left', 'right', 'front'],
  'minecraft:stonecutting': ['ingredient'],
  'minecraft:smithing_transform': ['template', 'base', 'addition'],
  'minecraft:smithing_trim': ['template', 'base', 'addition'],
};

export function recipeKind(type: string): RecipeKind {
  const t = normalizeType(type);
  switch (t) {
    case 'minecraft:crafting_shaped':
      return 'shaped';
    case 'minecraft:crafting_shapeless':
      return 'shapeless';
    case 'minecraft:crafting_transmute':
      return 'transmute';
    case 'minecraft:crafting_dye':
      return 'dye';
    case 'minecraft:crafting_imbue':
      return 'imbue';
    case 'minecraft:crafting_decorated_pot':
      return 'decorated_pot';
    case 'minecraft:stonecutting':
      return 'stonecutting';
    case 'minecraft:smithing_transform':
      return 'smithing_transform';
    case 'minecraft:smithing_trim':
      return 'smithing_trim';
    case 'minecraft:brewing':
      return 'brewing';
  }
  if (t in COOKING_TYPES) return 'cooking';
  if (t.startsWith('minecraft:crafting_special_')) return 'special';
  return 'generic';
}

/** Vanilla recipe types the editor can create / switch to, with the version they need. */
export const VANILLA_TYPES: { type: string; label: string; available: (f: RecipeFormat) => boolean }[] = [
  { type: 'minecraft:crafting_shaped', label: 'Shaped crafting', available: () => true },
  { type: 'minecraft:crafting_shapeless', label: 'Shapeless crafting', available: () => true },
  { type: 'minecraft:crafting_transmute', label: 'Transmute crafting', available: (f) => f.transmute },
  { type: 'minecraft:crafting_dye', label: 'Dye crafting', available: (f) => f.dyeImbue },
  { type: 'minecraft:crafting_imbue', label: 'Imbue crafting', available: (f) => f.dyeImbue },
  { type: 'minecraft:smelting', label: 'Smelting', available: () => true },
  { type: 'minecraft:blasting', label: 'Blasting', available: () => true },
  { type: 'minecraft:smoking', label: 'Smoking', available: () => true },
  { type: 'minecraft:campfire_cooking', label: 'Campfire cooking', available: () => true },
  { type: 'minecraft:stonecutting', label: 'Stonecutting', available: () => true },
  { type: 'minecraft:smithing_transform', label: 'Smithing transform', available: () => true },
  { type: 'minecraft:smithing_trim', label: 'Smithing trim', available: () => true },
  { type: 'minecraft:brewing', label: 'Brewing', available: (f) => f.brewing },
  { type: 'minecraft:crafting_decorated_pot', label: 'Decorated pot', available: () => true },
];

export const SPECIAL_TYPES = [
  'armordye',
  'bannerduplicate',
  'bookcloning',
  'firework_rocket',
  'firework_star',
  'firework_star_fade',
  'mapcloning',
  'mapextending',
  'repairitem',
  'shielddecoration',
  'shulkerboxcoloring',
  'suspiciousstew',
  'tippedarrow',
].map((s) => `minecraft:crafting_special_${s}`);

/** Valid "category" values per kind. */
export function categoriesFor(kind: RecipeKind): string[] {
  if (kind === 'cooking') return ['food', 'blocks', 'misc'];
  if (['shaped', 'shapeless', 'transmute', 'dye', 'imbue', 'decorated_pot', 'special'].includes(kind)) {
    return ['building', 'redstone', 'equipment', 'misc'];
  }
  return [];
}

// ---------------------------------------------------------------------------------------------
// Ingredients
// ---------------------------------------------------------------------------------------------

const CUSTOM_TYPE_KEYS = ['neoforge:ingredient_type', 'fabric:type', 'forge:type'];

/** Parse any ingredient syntax (vanilla string/object/list, NeoForge, Fabric, Forge custom ingredients). */
export function parseIngredient(v: unknown): Ingredient {
  if (v === null || v === undefined || v === '') return { kind: 'empty', ids: [], raw: v };
  if (typeof v === 'string') {
    return v.startsWith('#') ? { kind: 'tag', ids: [nsId(v)], raw: v } : { kind: 'item', ids: [nsId(v)], raw: v };
  }
  if (Array.isArray(v)) {
    const parts = v.map(parseIngredient);
    const ing: Ingredient = { kind: 'list', ids: dedupe(parts.flatMap((p) => p.ids)), raw: v };
    if (parts.some((p) => p.objectSyntax)) ing.objectSyntax = true;
    if (parts.some((p) => p.kind === 'invalid')) ing.kind = 'invalid';
    return ing;
  }
  if (!isObj(v)) return { kind: 'invalid', ids: [], raw: v };
  const o = v;
  const customType = CUSTOM_TYPE_KEYS.map((k) => o[k]).find((x) => typeof x === 'string') ?? (typeof o.type === 'string' ? o.type : undefined);
  const count = typeof o.count === 'number' ? o.count : typeof o.amount === 'number' ? o.amount : undefined;
  if (customType) return parseCustomIngredient(o, nsId(customType), count);
  if (typeof o.item === 'string') return { kind: 'item', ids: [nsId(o.item)], raw: v, objectSyntax: true, count };
  if (typeof o.tag === 'string') return { kind: 'tag', ids: [nsId('#' + o.tag.replace(/^#/, ''))], raw: v, objectSyntax: true, count };
  if (o.ingredient !== undefined) {
    // NeoForge SizedIngredient {"ingredient":..., "count":n} and similar wrappers
    const inner = parseIngredient(o.ingredient);
    return { ...inner, raw: v, count: count ?? inner.count, objectSyntax: false };
  }
  if (o.items !== undefined) return { ...holderSet(o.items), raw: v, count };
  if (typeof o.id === 'string') return { kind: 'item', ids: [nsId(o.id)], raw: v, count, label: componentsLabel(o.components) };
  if (typeof o.fluid === 'string' || typeof o.fluid_tag === 'string') {
    const f = o.fluid ?? '#' + o.fluid_tag;
    const bucket = /^(minecraft:)?(water|lava)$/.test(f) ? [`minecraft:${f.replace('minecraft:', '')}_bucket`] : [];
    return { kind: 'custom', customType: 'fluid', ids: bucket, label: `${nsId(f)}${count ? ` ×${count}` : ''}`, raw: v, count };
  }
  return { kind: 'invalid', ids: [], raw: v };
}

function holderSet(v: unknown): Ingredient {
  if (typeof v === 'string') return parseIngredient(v);
  if (Array.isArray(v)) return { kind: 'list', ids: dedupe(v.filter((x) => typeof x === 'string').map(nsId)), raw: v };
  return { kind: 'invalid', ids: [], raw: v };
}

function componentsLabel(c: unknown): string | undefined {
  if (!isObj(c)) return undefined;
  const keys = Object.keys(c);
  return keys.length ? keys.map((k) => k.replace(/^minecraft:/, '')).join(', ') : undefined;
}

function parseCustomIngredient(o: Record<string, any>, type: string, count?: number): Ingredient {
  const short = type.split(':')[1] ?? type;
  const ids: string[] = [];
  let excluded: string[] | undefined;
  let label: string | undefined;
  const add = (x: unknown) => ids.push(...parseIngredient(x).ids);
  switch (short) {
    case 'compound':
    case 'any_of':
    case 'intersection':
    case 'all_of':
      for (const c of o.children ?? o.ingredients ?? o.values ?? []) add(c);
      if (short === 'intersection' || short === 'all_of') label = 'all of';
      break;
    case 'difference':
      add(o.base);
      excluded = parseIngredient(o.subtracted).ids;
      break;
    case 'none_of':
      excluded = (o.ingredients ?? []).flatMap((x: unknown) => parseIngredient(x).ids);
      break;
    case 'components':
    case 'data_components':
    case 'custom_data':
    case 'nbt':
    case 'partial_nbt':
    case 'strict_nbt':
      if (o.items !== undefined) ids.push(...holderSet(o.items).ids);
      if (o.base !== undefined) add(o.base);
      if (typeof o.item === 'string') ids.push(nsId(o.item));
      label = componentsLabel(o.components) ?? (o.nbt !== undefined ? 'NBT' : undefined);
      break;
    case 'block_tag':
      if (typeof o.tag === 'string') ids.push(nsId('#' + o.tag.replace(/^#/, '')));
      label = 'block tag';
      break;
    default:
      for (const k of ['children', 'ingredients', 'values', 'base', 'ingredient', 'items', 'item', 'tag']) {
        const x = o[k];
        if (x === undefined) continue;
        if (k === 'tag' && typeof x === 'string') ids.push(nsId('#' + x.replace(/^#/, '')));
        else if (k === 'items') ids.push(...holderSet(x).ids);
        else if (Array.isArray(x) && (k === 'children' || k === 'ingredients' || k === 'values')) x.forEach(add);
        else add(x);
      }
  }
  return { kind: 'custom', customType: type, ids: dedupe(ids), excluded, label, raw: o, count };
}

function dedupe(a: string[]): string[] {
  return [...new Set(a)];
}

/** True for vanilla item / tag / list-of-items ingredients that can be re-encoded freely. */
export function isSimpleIngredient(i: Ingredient): boolean {
  if (i.kind === 'item' || i.kind === 'tag') return i.count === undefined && (typeof i.raw === 'string' || (isObj(i.raw) && Object.keys(i.raw).length === 1));
  if (i.kind === 'list') {
    return Array.isArray(i.raw) && i.raw.every((x) => isSimpleIngredient(parseIngredient(x)) && !Array.isArray(x));
  }
  return false;
}

/**
 * Encode an ingredient spec for a version: "minecraft:x" / "#minecraft:tag" or a list of them.
 * 'string' format: "minecraft:x" / "#tag" / ["a","b"]; 'object' format: {"item":..} / {"tag":..} / [{..},{..}]
 */
export function encodeIngredient(spec: string | string[], format: 'object' | 'string'): unknown {
  if (Array.isArray(spec)) {
    const items = spec.map((s) => encodeIngredient(s, format));
    return items.length === 1 ? items[0] : items;
  }
  const id = nsId(spec);
  if (format === 'string') return id;
  return id.startsWith('#') ? { tag: id.slice(1) } : { item: id };
}

/** Re-encode a simple ingredient to another syntax. Custom / unknown ingredients are returned unchanged. */
export function reencodeIngredient(raw: unknown, format: 'object' | 'string'): unknown {
  const ing = parseIngredient(raw);
  if (!isSimpleIngredient(ing)) return raw;
  if (ing.kind === 'list') {
    const parts = (raw as unknown[]).map((x) => parseIngredient(x).ids[0]);
    // A string HolderSet list cannot contain tags: keep object form in that case.
    if (format === 'string' && parts.some((p) => p.startsWith('#'))) return raw;
    return parts.map((p) => encodeIngredient(p, format));
  }
  return encodeIngredient(ing.ids[0], format);
}

// ---------------------------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------------------------

export function parseResult(v: unknown, path: JsonPath): ResultStack | undefined {
  if (typeof v === 'string') return { id: nsId(v), count: 1, path, raw: v };
  if (!isObj(v)) return undefined;
  const id = typeof v.id === 'string' ? v.id : typeof v.item === 'string' ? v.item : undefined;
  const stack: ResultStack = {
    id: id ? nsId(id) : undefined,
    count: typeof v.count === 'number' ? v.count : typeof v.amount === 'number' ? v.amount : 1,
    path,
    raw: v,
  };
  if (typeof v.item === 'string' && v.id === undefined) stack.legacyItemKey = true;
  if (isObj(v.components)) stack.components = v.components;
  if (typeof v.chance === 'number') stack.chance = v.chance;
  if (!id && typeof v.fluid === 'string') stack.label = `${nsId(v.fluid)} ×${stack.count}`;
  return stack;
}

// ---------------------------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------------------------

const RESULT_KEY = /^(result|results|output|outputs|.+_result|.+_output)$/;
const META_KEYS = new Set(['type', 'group', 'category', 'show_notification', 'pattern', 'key']);

/** Parse a recipe json (any version / loader) into a normalized model. `fmt` enables version checks. */
export function parseRecipe(json: unknown, fmt?: RecipeFormat): RecipeModel {
  const j: Record<string, any> = isObj(json) ? json : {};
  const type = normalizeType(j.type);
  const kind = recipeKind(type);
  const model: RecipeModel = { type, kind, slots: [], results: [], properties: [], warnings: [] };
  const warn = (message: string, args?: (string | number)[], severity: RecipeWarning['severity'] = 'warning') =>
    model.warnings.push({ message, args, severity });
  if (!isObj(json)) {
    warn('The file is not a JSON object.', [], 'error');
    return model;
  }
  if (!type) warn('Missing recipe "type".', [], 'error');
  if (typeof j.group === 'string') model.group = j.group;
  if (typeof j.category === 'string') model.category = j.category;
  if (typeof j.show_notification === 'boolean') model.showNotification = j.show_notification;

  const fieldSlot = (name: string, label = name) =>
    model.slots.push({ ref: pathRef([name]), label, ingredient: j[name] === undefined ? null : parseIngredient(j[name]) });

  switch (kind) {
    case 'shaped':
      model.grid = parseShaped(j, warn);
      break;
    case 'shapeless': {
      const list = Array.isArray(j.ingredients) ? j.ingredients : [];
      list.forEach((x: unknown, i: number) => model.slots.push({ ref: `ing:${i}`, label: 'ingredient', ingredient: parseIngredient(x) }));
      if (!list.length) warn('The recipe has no ingredients.', [], 'error');
      if (list.length > 9) warn('Shapeless recipes accept at most 9 ingredients ({0} found).', [list.length], 'error');
      break;
    }
    case 'cooking':
      fieldSlot('ingredient');
      model.cooking = {
        time: typeof j.cookingtime === 'number' ? j.cookingtime : undefined,
        xp: typeof j.experience === 'number' ? j.experience : undefined,
        defaultTime: COOKING_TYPES[type],
      };
      break;
    case 'brewing':
      for (const name of ['input', 'reagent']) {
        const v = j[name];
        const item = isObj(v) ? v.item ?? v.items : v;
        model.slots.push({ ref: `brew:${name}`, label: name, ingredient: item === undefined ? null : parseIngredient(item) });
      }
      model.brewing = {
        inputPotion: potionOf(j.input?.potion_contents),
        outputPotion: potionOf(j.output?.components?.['minecraft:potion_contents'] ?? j.output?.components?.potion_contents),
      };
      if (fmt && !fmt.brewing) warn('Data-driven brewing recipes need Minecraft 26.3 or newer (target: {0}).', [fmt.version], 'error');
      break;
    case 'special':
    case 'generic':
      parseGenericFields(j, model);
      if (kind === 'generic' && Array.isArray(j.pattern) && isObj(j.key)) model.grid = parseShaped(j, warn);
      break;
    default:
      for (const f of FIELD_SLOTS[type] ?? []) fieldSlot(f);
      if (kind === 'decorated_pot' && fmt && !fmt.dyeImbue && !model.slots.some((s) => s.ingredient)) model.slots = [];
  }

  // results
  if (kind !== 'generic' && kind !== 'special') {
    const key = kind === 'brewing' ? 'output' : 'result';
    if (j[key] !== undefined) {
      const r = parseResult(j[key], [key]);
      if (r) model.results.push(r);
      else warn('Invalid result.', [], 'error');
    } else if (kind !== 'smithing_trim' && !(kind === 'decorated_pot' && !fmt?.dyeImbue)) {
      warn('Missing result.', [], 'error');
    }
  }
  if (kind === 'smithing_trim') {
    if (typeof j.pattern === 'string') model.trimPattern = nsId(j.pattern);
    else if (fmt?.trimPattern) warn('smithing_trim recipes need a "pattern" since 1.21.5.', [], 'error');
  }

  for (const r of model.results) {
    if (r.legacyItemKey) warn('The result uses "item"; since 1.20.5 it must be "id".', [], 'error');
    if (r.count > 99) warn('Result count {0} is larger than the maximum stack size (99).', [r.count]);
    if (r.count < 1) warn('Result count must be at least 1.', [], 'error');
  }
  if (kind === 'transmute' && fmt) {
    const raw = j.result;
    if (fmt.transmuteResultStack && typeof raw === 'string') warn('Since 1.21.5 the transmute result is an item stack object.', [], 'warning');
    if (!fmt.transmuteResultStack && isObj(raw)) warn('Before 1.21.5 the transmute result is a plain item id.', [], 'error');
  }

  if (fmt) versionWarnings(model, j, fmt, warn);
  return model;
}

function potionOf(v: unknown): string | undefined {
  if (typeof v === 'string') return nsId(v);
  if (!isObj(v)) return undefined;
  const p = v.potion ?? v.potions;
  if (typeof p === 'string') return nsId(p);
  if (Array.isArray(p) && typeof p[0] === 'string') return p.map((x: string) => nsId(x)).join(', ');
  return undefined;
}

function parseShaped(j: Record<string, any>, warn: (m: string, a?: (string | number)[], s?: RecipeWarning['severity']) => void): ShapedGrid {
  const pattern: string[] = Array.isArray(j.pattern) ? j.pattern.filter((r: unknown) => typeof r === 'string') : [];
  const rawKey: Record<string, unknown> = isObj(j.key) ? j.key : {};
  const key: Record<string, Ingredient> = {};
  for (const [k, v] of Object.entries(rawKey)) {
    key[k] = parseIngredient(v);
    if ([...k].length !== 1) warn('Key "{0}" must be a single character.', [k], 'error');
    if (k === ' ') warn('The space character is reserved for empty slots and cannot be a key.', [], 'error');
  }
  const width = Math.max(0, ...pattern.map((r) => [...r].length));
  const height = pattern.length;
  if (!height) warn('The pattern is empty.', [], 'error');
  if (pattern.some((r) => [...r].length !== width)) warn('Pattern rows have different widths ({0}).', [pattern.map((r) => [...r].length).join(', ')], 'error');
  if (width > 3 || height > 3) warn('The pattern is larger than 3×3 ({0}×{1}).', [width, height], 'warning');
  const used = new Set<string>();
  const missing = new Set<string>();
  const cells = pattern.map((row) => {
    const chars = [...row];
    const out: (Ingredient | null)[] = [];
    for (let c = 0; c < width; c++) {
      const ch = chars[c] ?? ' ';
      if (ch === ' ') out.push(null);
      else {
        used.add(ch);
        if (!key[ch]) missing.add(ch);
        out.push(key[ch] ?? { kind: 'invalid', ids: [], raw: ch, label: ch });
      }
    }
    return out;
  });
  for (const ch of missing) warn('The pattern uses key "{0}" which is not defined.', [ch], 'error');
  for (const k of Object.keys(key)) if (!used.has(k)) warn('Key "{0}" is not used in the pattern.', [k], 'error');
  return { width, height, cells, pattern, key };
}

function parseGenericFields(j: Record<string, any>, model: RecipeModel): void {
  for (const [k, v] of Object.entries(j)) {
    if (META_KEYS.has(k) || /conditions/.test(k)) continue;
    if (RESULT_KEY.test(k)) {
      if (Array.isArray(v)) v.forEach((x, i) => pushResult(model, x, [k, i]));
      else pushResult(model, v, [k]);
      continue;
    }
    if (typeof v === 'number' || typeof v === 'boolean') {
      model.properties.push({ key: k, value: v });
      continue;
    }
    if (Array.isArray(v)) {
      const parts = v.map(parseIngredient);
      if (v.length && parts.every((p) => p.kind !== 'invalid' && p.kind !== 'empty')) {
        parts.forEach((p, i) => model.slots.push({ ref: pathRef([k, i]), label: k, ingredient: p }));
        continue;
      }
    } else {
      const p = parseIngredient(v);
      if (p.kind !== 'invalid' && p.kind !== 'empty' && (typeof v !== 'string' || /^#?[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(v))) {
        model.slots.push({ ref: pathRef([k]), label: k, ingredient: p });
        continue;
      }
      if (isObj(v) && !p.customType) {
        // map of ingredients (e.g. firework star "shapes", modded "key" maps)
        const entries = Object.entries(v);
        const parsed = entries.map(([, x]) => parseIngredient(x));
        if (entries.length && parsed.every((x) => x.kind !== 'invalid' && x.kind !== 'empty')) {
          entries.forEach(([sub], i) => model.slots.push({ ref: pathRef([k, sub]), label: `${k}.${sub}`, ingredient: parsed[i] }));
          continue;
        }
      }
    }
    if (typeof v === 'string') model.properties.push({ key: k, value: v });
    else model.properties.push({ key: k, value: v });
  }
}

function pushResult(model: RecipeModel, v: unknown, path: JsonPath): void {
  const r = parseResult(v, path);
  if (r && (r.id || r.label)) model.results.push(r);
  else if (r && model.kind === 'special') {
    /* e.g. map_extending "result": {} */
  } else model.properties.push({ key: path.join('.'), value: v });
}

const REMOVED_TYPES: Record<string, { since: (f: RecipeFormat) => boolean; version: string }> = {
  'minecraft:crafting_special_armordye': { since: (f) => f.dyeImbue, version: '26.1' },
  'minecraft:crafting_special_tippedarrow': { since: (f) => f.dyeImbue, version: '26.1' },
  'minecraft:crafting_special_mapcloning': { since: (f) => f.dyeImbue, version: '26.1' },
  'minecraft:crafting_special_shulkerboxcoloring': { since: (f) => f.transmute, version: '1.21.2' },
  'minecraft:crafting_special_suspiciousstew': { since: (f) => f.transmute, version: '1.21.2' },
};

function versionWarnings(
  model: RecipeModel,
  j: Record<string, any>,
  fmt: RecipeFormat,
  warn: (m: string, a?: (string | number)[], s?: RecipeWarning['severity']) => void,
): void {
  const t = model.type;
  if (t === 'minecraft:crafting_transmute' && !fmt.transmute) warn('crafting_transmute needs Minecraft 1.21.2 or newer (target: {0}).', [fmt.version], 'error');
  if ((t === 'minecraft:crafting_dye' || t === 'minecraft:crafting_imbue') && !fmt.dyeImbue) warn('{0} needs Minecraft 26.1 or newer (target: {1}).', [t, fmt.version], 'error');
  const removed = REMOVED_TYPES[t];
  if (removed?.since(fmt)) warn('{0} was removed in Minecraft {1}. Run "Migrate Recipes to Target Version".', [t, removed.version], 'error');
  // ingredient syntax
  const all = [...model.slots.map((s) => s.ingredient), ...Object.values(model.grid?.key ?? {})].filter((x): x is Ingredient => !!x);
  if (fmt.ingredient === 'string' && all.some((i) => i.objectSyntax && isSimpleIngredient(i))) {
    warn('Ingredients use the 1.21.1 object syntax ({"item": …}); {0} expects plain strings ("minecraft:x" / "#tag").', [fmt.version], model.kind === 'generic' ? 'warning' : 'error');
  }
  if (fmt.ingredient === 'object' && all.some((i) => !i.objectSyntax && (i.kind === 'item' || i.kind === 'tag') && typeof i.raw === 'string')) {
    warn('Ingredients use the 1.21.2+ string syntax; {0} expects objects ({"item": …} / {"tag": …}).', [fmt.version], model.kind === 'generic' ? 'warning' : 'error');
  }
  if (model.kind === 'smithing_trim' && !fmt.trimPattern && j.pattern !== undefined) {
    warn('"pattern" in smithing_trim is only used since 1.21.5.', [], 'info');
  }
}

/** Every item id and "#tag" referenced by the recipe (for validation / search). */
export function referencedIds(model: RecipeModel): { items: string[]; tags: string[] } {
  const ids = new Set<string>();
  for (const s of model.slots) s.ingredient?.ids.forEach((i) => ids.add(i));
  for (const s of model.slots) s.ingredient?.excluded?.forEach((i) => ids.add(i));
  for (const k of Object.values(model.grid?.key ?? {})) k.ids.forEach((i) => ids.add(i));
  for (const r of model.results) if (r.id) ids.add(r.id);
  const all = [...ids];
  return {
    items: all.filter((i) => !i.startsWith('#')),
    tags: all.filter((i) => i.startsWith('#')).map((i) => i.slice(1)),
  };
}

/** Ingredient ids only (no results), used for "uses of X" searches. */
export function ingredientIds(model: RecipeModel): string[] {
  const ids = new Set<string>();
  for (const s of model.slots) s.ingredient?.ids.forEach((i) => ids.add(i));
  for (const k of Object.values(model.grid?.key ?? {})) k.ids.forEach((i) => ids.add(i));
  return [...ids];
}

// ---------------------------------------------------------------------------------------------
// Editing (all functions return a NEW json object; unknown fields are always preserved)
// ---------------------------------------------------------------------------------------------

export const pathRef = (path: JsonPath): string => `path:${JSON.stringify(path)}`;

/** Value to put in a slot: an id / "#tag" spec, the raw json of an existing ingredient, or null to clear. */
export type SlotValue = string | string[] | { raw: unknown } | null;

function slotValueJson(v: Exclude<SlotValue, null>, format: 'object' | 'string'): unknown {
  return isObj(v) && 'raw' in v ? clone(v.raw) : encodeIngredient(v as string | string[], format);
}

/** Raw json value of a slot (for moving ingredients between slots). */
export function slotRaw(json: Record<string, any>, ref: string): unknown {
  if (ref.startsWith('grid:')) {
    const [r, c] = ref.slice(5).split(':').map(Number);
    const ch = [...(json.pattern?.[r] ?? '')][c];
    return ch && ch !== ' ' ? json.key?.[ch] : undefined;
  }
  if (ref.startsWith('ing:')) return json.ingredients?.[Number(ref.slice(4))];
  if (ref.startsWith('brew:')) {
    const v = json[ref.slice(5)];
    return isObj(v) ? v.item : v;
  }
  if (ref.startsWith('path:')) return getPath(json, JSON.parse(ref.slice(5)));
  return undefined;
}

export function setSlot(json: Record<string, any>, ref: string, value: SlotValue, fmt: RecipeFormat, opts: { trim?: boolean } = {}): Record<string, any> {
  const out = clone(json);
  if (ref.startsWith('grid:')) {
    const [r, c] = ref.slice(5).split(':').map(Number);
    const cells = gridRaw(out);
    while (cells.length <= r) cells.push([]);
    for (const row of cells) while (row.length < Math.max(3, c + 1)) row.push(null);
    while (cells.length < 3) cells.push([null, null, null]);
    const w = Math.max(...cells.map((x) => x.length));
    for (const row of cells) while (row.length < w) row.push(null);
    cells[r][c] = value === null ? null : slotValueJson(value, fmt.ingredient);
    writeGrid(out, cells, opts.trim ?? true);
    return out;
  }
  if (ref.startsWith('ing:')) {
    const i = Number(ref.slice(4));
    const list: unknown[] = Array.isArray(out.ingredients) ? out.ingredients : [];
    if (value === null) {
      if (i < list.length) list.splice(i, 1);
    } else if (i < list.length) list[i] = slotValueJson(value, fmt.ingredient);
    else list.push(slotValueJson(value, fmt.ingredient));
    out.ingredients = list;
    return out;
  }
  if (ref.startsWith('brew:')) {
    const name = ref.slice(5);
    const cur = isObj(out[name]) ? out[name] : {};
    if (value === null) delete cur.item;
    else {
      const v = slotValueJson(value, 'string');
      cur.item = v;
    }
    out[name] = reorderFirst(cur, 'item');
    return out;
  }
  if (ref.startsWith('path:')) {
    const path: JsonPath = JSON.parse(ref.slice(5));
    if (value === null) {
      const parent = getPath(out, path.slice(0, -1));
      const last = path[path.length - 1];
      if (Array.isArray(parent) && typeof last === 'number') parent.splice(last, 1);
      else if (isObj(parent)) delete parent[last as string];
    } else {
      setPath(out, path, slotValueJson(value, fmt.ingredient));
    }
    return out;
  }
  return out;
}

function reorderFirst(o: Record<string, any>, key: string): Record<string, any> {
  if (!(key in o)) return o;
  return { [key]: o[key], ...Object.fromEntries(Object.entries(o).filter(([k]) => k !== key)) };
}

export function getPath(root: unknown, path: JsonPath): any {
  let cur: any = root;
  for (const p of path) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[p as any];
  }
  return cur;
}

export function setPath(root: Record<string, any>, path: JsonPath, value: unknown): void {
  let cur: any = root;
  for (let i = 0; i < path.length - 1; i++) {
    const p = path[i];
    if (cur[p as any] === undefined || cur[p as any] === null || typeof cur[p as any] !== 'object') cur[p as any] = typeof path[i + 1] === 'number' ? [] : {};
    cur = cur[p as any];
  }
  const last = path[path.length - 1];
  if (Array.isArray(cur) && typeof last === 'number' && last >= cur.length) cur.push(value);
  else cur[last as any] = value;
}

/** Raw json cells (rows × cols) of a shaped recipe. */
export function gridRaw(json: Record<string, any>): (unknown | null)[][] {
  const pattern: string[] = Array.isArray(json.pattern) ? json.pattern.filter((x: unknown) => typeof x === 'string') : [];
  const key = isObj(json.key) ? json.key : {};
  const w = Math.max(0, ...pattern.map((r) => [...r].length));
  return pattern.map((row) => {
    const chars = [...row];
    const out: unknown[] = [];
    for (let c = 0; c < w; c++) {
      const ch = chars[c] ?? ' ';
      out.push(ch === ' ' || key[ch] === undefined ? null : clone(key[ch]));
    }
    return out;
  });
}

const KEY_CANDIDATES = '#XIOSABCDEFGHJKLMNPQRTUVWYZ0123456789@$%&*+=abcdefghijklmnopqrstuvwxyz';

/** Write raw cells back to pattern + key: optional trim, key letters reused / assigned automatically. */
export function writeGrid(json: Record<string, any>, cells: (unknown | null)[][], trim = true): void {
  let rows = cells.map((r) => [...r]);
  if (trim) {
    const filled = (r: number, c: number) => rows[r]?.[c] !== null && rows[r]?.[c] !== undefined;
    let minR = Infinity, maxR = -1, minC = Infinity, maxC = -1;
    rows.forEach((row, r) =>
      row.forEach((_, c) => {
        if (filled(r, c)) {
          minR = Math.min(minR, r);
          maxR = Math.max(maxR, r);
          minC = Math.min(minC, c);
          maxC = Math.max(maxC, c);
        }
      }),
    );
    rows = maxR < 0 ? [] : rows.slice(minR, maxR + 1).map((row) => row.slice(minC, maxC + 1));
  }
  const oldKey: Record<string, unknown> = isObj(json.key) ? json.key : {};
  const byValue = new Map<string, string>();
  for (const [ch, v] of Object.entries(oldKey)) if (!byValue.has(stableStringify(v)) && [...ch].length === 1 && ch !== ' ') byValue.set(stableStringify(v), ch);
  const newKey: Record<string, unknown> = {};
  const taken = new Set<string>();
  // Reserve letters that will be reused so new ones don't collide
  for (const row of rows) for (const v of row) if (v !== null && v !== undefined) { const ch = byValue.get(stableStringify(v)); if (ch) taken.add(ch); }
  const pattern = rows.map((row) =>
    row
      .map((v) => {
        if (v === null || v === undefined) return ' ';
        const s = stableStringify(v);
        let ch = byValue.get(s);
        if (!ch) {
          ch = pickKeyChar(v, taken);
          byValue.set(s, ch);
          taken.add(ch);
        }
        if (!(ch in newKey)) newKey[ch] = v;
        return ch;
      })
      .join(''),
  );
  // keep the original key order for keys that survive
  const ordered: Record<string, unknown> = {};
  for (const ch of Object.keys(oldKey)) if (ch in newKey) ordered[ch] = newKey[ch];
  for (const ch of Object.keys(newKey)) if (!(ch in ordered)) ordered[ch] = newKey[ch];
  json.pattern = pattern;
  json.key = ordered;
}

function pickKeyChar(v: unknown, taken: Set<string>): string {
  const ids = parseIngredient(v).ids;
  const first = ids[0]?.replace(/^#/, '').split(':')[1]?.split('/').pop()?.[0]?.toUpperCase();
  if (first && /[A-Z]/.test(first) && !taken.has(first)) return first;
  for (const ch of KEY_CANDIDATES) if (!taken.has(ch)) return ch;
  return '?';
}

/** Set the (primary) result item id, keeping count / components. null removes the result. */
export function setResultId(json: Record<string, any>, id: string | null, fmt: RecipeFormat, path: JsonPath = defaultResultPath(json)): Record<string, any> {
  const out = clone(json);
  if (id === null) {
    removePath(out, path);
    return out;
  }
  const full = nsId(id.replace(/^#/, ''));
  const cur = getPath(out, path);
  const type = normalizeType(out.type);
  if (type === 'minecraft:crafting_transmute' && !fmt.transmuteResultStack) {
    setPath(out, path, full);
    return out;
  }
  if (isObj(cur)) {
    const { item: _old, id: _id, ...rest } = cur;
    setPath(out, path, { id: full, ...rest });
  } else setPath(out, path, { id: full });
  return out;
}

export function setResultCount(json: Record<string, any>, count: number, fmt: RecipeFormat, path: JsonPath = defaultResultPath(json)): Record<string, any> {
  const out = clone(json);
  let cur = getPath(out, path);
  if (typeof cur === 'string') {
    if (normalizeType(out.type) === 'minecraft:crafting_transmute' && !fmt.transmuteResultStack) return out;
    cur = { id: cur };
  }
  if (!isObj(cur)) return out;
  const n = Math.max(1, Math.round(count));
  if (n === 1) delete cur.count;
  else cur.count = n;
  setPath(out, path, cur);
  return out;
}

function defaultResultPath(json: Record<string, any>): JsonPath {
  return normalizeType(json.type) === 'minecraft:brewing' ? ['output'] : ['result'];
}

function removePath(root: Record<string, any>, path: JsonPath): void {
  const parent = getPath(root, path.slice(0, -1));
  const last = path[path.length - 1];
  if (Array.isArray(parent) && typeof last === 'number') parent.splice(last, 1);
  else if (isObj(parent)) delete parent[last as string];
}

/** Set / remove (undefined, '' or null) a top-level property. */
export function setProperty(json: Record<string, any>, key: string, value: unknown): Record<string, any> {
  const out = clone(json);
  if (value === undefined || value === null || value === '') delete out[key];
  else out[key] = value;
  return out;
}

/** Known fields of each type (removed when switching to another type). */
const TYPE_FIELDS: Record<RecipeKind, string[]> = {
  shaped: ['pattern', 'key', 'result', 'show_notification', 'category', 'group'],
  shapeless: ['ingredients', 'result', 'category', 'group'],
  transmute: ['input', 'material', 'result', 'category', 'group', 'material_count', 'add_material_count_to_result'],
  dye: ['target', 'dye', 'result', 'category', 'group'],
  imbue: ['source', 'material', 'result', 'category', 'group'],
  decorated_pot: ['back', 'left', 'right', 'front', 'result', 'category'],
  special: ['category'],
  cooking: ['ingredient', 'result', 'cookingtime', 'experience', 'category', 'group'],
  stonecutting: ['ingredient', 'result', 'group'],
  smithing_transform: ['template', 'base', 'addition', 'result'],
  smithing_trim: ['template', 'base', 'addition', 'pattern'],
  brewing: ['input', 'reagent', 'output'],
  generic: [],
};

/** Ingredient raw values of a recipe in reading order (grid row-major, lists, fields). */
export function collectIngredientsRaw(json: Record<string, any>): unknown[] {
  const model = parseRecipe(json);
  const out: unknown[] = [];
  if (model.grid) for (const row of gridRaw(json)) for (const v of row) if (v !== null) out.push(v);
  for (const s of model.slots) {
    const v = slotRaw(json, s.ref);
    if (v !== undefined && v !== null) out.push(v);
  }
  return out;
}

/** Convert a recipe to another type, reusing its ingredients and result. Unknown fields are kept. */
export function changeType(json: Record<string, any>, newType: string, fmt: RecipeFormat): Record<string, any> {
  const type = normalizeType(newType);
  const oldKind = recipeKind(json.type);
  const kind = recipeKind(type);
  if (normalizeType(json.type) === type) return clone(json);
  const ingredients = collectIngredientsRaw(json).map((v) => reencodeIngredient(v, fmt.ingredient));
  const oldModel = parseRecipe(json);
  const result = oldModel.results[0];
  const resultId = result?.id;
  const count = result?.count ?? 1;
  const components = result?.components;
  const out: Record<string, any> = {};
  // type first, keep unknown fields in their order
  out.type = shortType(json.type, type);
  const keepNames = new Set(TYPE_FIELDS[kind]);
  for (const [k, v] of Object.entries(json)) {
    if (k === 'type') continue;
    const known = TYPE_FIELDS[oldKind].includes(k);
    if (!known || (keepNames.has(k) && ['group', 'category'].includes(k))) out[k] = clone(v);
  }
  if (out.category && !categoriesFor(kind).includes(out.category)) delete out.category;
  if (!categoriesFor(kind).length) delete out.category;
  if (!['shaped', 'shapeless', 'transmute', 'dye', 'imbue', 'cooking', 'stonecutting'].includes(kind)) delete out.group;
  const ing = (i: number, fallback?: string) => ingredients[i] ?? (fallback ? encodeIngredient(fallback, fmt.ingredient) : undefined);
  const stack = (id?: string): Record<string, unknown> => {
    const s: Record<string, unknown> = { id: id ?? 'minecraft:stone' };
    if (count > 1) s.count = count;
    if (components) s.components = clone(components);
    return s;
  };
  switch (kind) {
    case 'shaped': {
      const cells: (unknown | null)[][] = [0, 1, 2].map((r) => [0, 1, 2].map((c) => ingredients[r * 3 + c] ?? null));
      writeGrid(out, cells, true);
      out.result = stack(resultId);
      break;
    }
    case 'shapeless':
      out.ingredients = ingredients.slice(0, 9);
      out.result = stack(resultId);
      break;
    case 'cooking':
      out.ingredient = ing(0, 'minecraft:stone');
      out.result = stack(resultId);
      out.cookingtime = typeof json.cookingtime === 'number' ? json.cookingtime : COOKING_TYPES[type];
      out.experience = typeof json.experience === 'number' ? json.experience : 0.1;
      break;
    case 'stonecutting':
      out.ingredient = ing(0, 'minecraft:stone');
      out.result = stack(resultId);
      break;
    case 'transmute':
      out.input = ing(0, 'minecraft:stone');
      out.material = ing(1, 'minecraft:stone');
      out.result = fmt.transmuteResultStack ? stack(resultId) : resultId ?? 'minecraft:stone';
      break;
    case 'dye':
      out.target = ing(0, 'minecraft:leather_chestplate');
      out.dye = ing(1, '#minecraft:dyes');
      out.result = stack(resultId ?? 'minecraft:leather_chestplate');
      break;
    case 'imbue':
      out.source = ing(0, 'minecraft:lingering_potion');
      out.material = ing(1, 'minecraft:arrow');
      out.result = stack(resultId ?? 'minecraft:tipped_arrow');
      break;
    case 'smithing_transform':
    case 'smithing_trim':
      out.template = ing(0, 'minecraft:netherite_upgrade_smithing_template');
      out.base = ing(1, 'minecraft:diamond_sword');
      out.addition = ing(2, 'minecraft:netherite_ingot');
      if (kind === 'smithing_transform') out.result = stack(resultId);
      else if (fmt.trimPattern) out.pattern = trimPatternFromTemplate(parseIngredient(out.template).ids[0]) ?? 'minecraft:sentry';
      break;
    case 'decorated_pot':
      for (const f of ['back', 'left', 'right', 'front']) out[f] = encodeIngredient('#minecraft:decorated_pot_ingredients', fmt.ingredient);
      out.result = { id: 'minecraft:decorated_pot' };
      break;
    case 'brewing':
      out.input = { item: firstId(ingredients[0]) ?? 'minecraft:potion', potion_contents: { potions: 'minecraft:awkward' } };
      out.reagent = { item: firstId(ingredients[1]) ?? firstId(ingredients[0]) ?? 'minecraft:nether_wart' };
      out.output = { id: resultId ?? 'minecraft:potion', components: { 'minecraft:potion_contents': { potion: 'minecraft:water' } } };
      break;
    default:
      break;
  }
  return out;
}

function firstId(raw: unknown): string | undefined {
  if (raw === undefined) return undefined;
  return parseIngredient(raw).ids[0];
}

/** Keep the user's style: "crafting_shaped" stays without namespace if the old type had none. */
function shortType(oldType: unknown, type: string): string {
  return typeof oldType === 'string' && !oldType.includes(':') && type.startsWith('minecraft:') ? type.slice(10) : type;
}

export function trimPatternFromTemplate(template: string | undefined): string | undefined {
  if (!template) return undefined;
  const m = /^(#?)([a-z0-9_.-]+):(.+)_armor_trim_smithing_template$/.exec(template);
  return m && !m[1] ? `${m[2]}:${m[3]}` : undefined;
}

// ---------------------------------------------------------------------------------------------
// New recipe templates
// ---------------------------------------------------------------------------------------------

export function newRecipe(type: string, resultId: string, fmt: RecipeFormat): Record<string, any> {
  const base: Record<string, any> = { type: normalizeType(type) };
  const out = changeType({ type: 'vscodecraft:empty' }, base.type, fmt);
  out.type = base.type;
  const kind = recipeKind(base.type);
  if (kind === 'shaped') {
    out.category = 'misc';
    writeGrid(out, [[encodeIngredient(resultId === 'minecraft:stone' ? 'minecraft:cobblestone' : 'minecraft:stick', fmt.ingredient)]], true);
  }
  if (kind === 'shapeless') {
    out.category = 'misc';
    out.ingredients = [encodeIngredient('minecraft:stick', fmt.ingredient)];
  }
  if (kind === 'cooking') out.category = 'misc';
  if (kind === 'brewing') return { ...out, output: { id: resultId, components: out.output.components } };
  if (resultId && 'result' in out) return setResultId(out, resultId, fmt);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Diff → minimal path modifications (so the host can edit documents preserving formatting)
// ---------------------------------------------------------------------------------------------

/** Minimal list of path → value modifications turning `a` into `b` (undefined value = remove). */
export function jsonDiff(a: unknown, b: unknown, path: JsonPath = []): { path: JsonPath; value: unknown }[] {
  if (jsonEqual(a, b)) return [];
  if (isObj(a) && isObj(b) && path.length < 6) {
    const out: { path: JsonPath; value: unknown }[] = [];
    for (const k of Object.keys(a)) if (!(k in b)) out.push({ path: [...path, k], value: undefined });
    for (const k of Object.keys(b)) {
      if (!(k in a)) out.push({ path: [...path, k], value: b[k] });
      else out.push(...jsonDiff(a[k], b[k], [...path, k]));
    }
    return out;
  }
  if (path.length === 0) return [{ path: [], value: b }];
  return [{ path, value: b }];
}

// ---------------------------------------------------------------------------------------------
// Migration between versions
// ---------------------------------------------------------------------------------------------

export interface MigrationResult {
  json: Record<string, any>;
  changed: boolean;
  /** English notes with {0} placeholders. */
  notes: { message: string; args?: (string | number)[] }[];
  /** Additional recipe files (same folder) created by splitting one legacy recipe into several. */
  extra: { name: string; json: Record<string, any> }[];
  /** The recipe cannot be expressed in the target version. */
  unsupported?: boolean;
  /** The recipe has a modded type (converted heuristically). */
  modded?: boolean;
}

const DYE_COLORS = [
  'white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray',
  'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black',
];
const DYEABLE = ['leather_helmet', 'leather_chestplate', 'leather_leggings', 'leather_boots', 'leather_horse_armor', 'wolf_armor'];

/** Explicit fields of data-driven "special" recipes in 26.1+ (vanilla defaults). */
const SPECIAL_FIELDS_26: Record<string, Record<string, unknown>> = {
  'minecraft:crafting_special_bookcloning': {
    material: '#minecraft:book_cloning_target',
    result: { id: 'minecraft:written_book' },
    source: 'minecraft:written_book',
  },
  'minecraft:crafting_special_firework_rocket': {
    fuel: 'minecraft:gunpowder',
    result: { count: 3, id: 'minecraft:firework_rocket' },
    shell: 'minecraft:paper',
    star: 'minecraft:firework_star',
  },
  'minecraft:crafting_special_firework_star': {
    dye: '#minecraft:dyes',
    fuel: 'minecraft:gunpowder',
    result: { id: 'minecraft:firework_star' },
    shapes: { burst: 'minecraft:feather', creeper: '#minecraft:skulls', large_ball: 'minecraft:fire_charge', star: 'minecraft:gold_nugget' },
    trail: 'minecraft:diamond',
    twinkle: 'minecraft:glowstone_dust',
  },
  'minecraft:crafting_special_firework_star_fade': {
    dye: '#minecraft:dyes',
    result: { id: 'minecraft:firework_star' },
    target: 'minecraft:firework_star',
  },
  'minecraft:crafting_special_mapextending': { map: '#minecraft:extendable_maps', material: 'minecraft:paper', result: {} },
  'minecraft:crafting_special_shielddecoration': { banner: '#minecraft:banners', result: { id: 'minecraft:shield' }, target: 'minecraft:shield' },
  'minecraft:crafting_decorated_pot': {
    back: '#minecraft:decorated_pot_ingredients',
    front: '#minecraft:decorated_pot_ingredients',
    left: '#minecraft:decorated_pot_ingredients',
    result: { id: 'minecraft:decorated_pot' },
    right: '#minecraft:decorated_pot_ingredients',
  },
};

/** Ingredient-valued fields of known types (for re-encoding). */
const INGREDIENT_FIELDS = [
  'ingredient', 'base', 'addition', 'template', 'input', 'material', 'dye', 'target', 'source',
  'front', 'back', 'left', 'right', 'banner', 'fuel', 'shell', 'star', 'trail', 'twinkle', 'map',
];

/**
 * Convert a recipe to the format of a target version:
 *  - ingredient syntax ({"item"} objects ↔ plain strings), recursively in vanilla positions
 *  - result "item" → "id", legacy string results / top-level "count"
 *  - transmute result id ↔ item stack (1.21.5), smithing_trim "pattern" (1.21.5)
 *  - crafting_special_armordye ↔ crafting_dye, tippedarrow ↔ crafting_imbue (26.1),
 *    shulkerboxcoloring → crafting_transmute (1.21.2), mapcloning ↔ transmute (26.1),
 *    explicit fields of special recipes (26.1)
 * `name` is the file name (without extension), used to name split files.
 */
export function migrateRecipe(input: Record<string, any>, fmt: RecipeFormat, name = 'recipe'): MigrationResult {
  const notes: MigrationResult['notes'] = [];
  const extra: MigrationResult['extra'] = [];
  let json = clone(input);
  if (!isObj(json)) return { json: input, changed: false, notes, extra };
  const type = normalizeType(json.type);
  const kind = recipeKind(type);
  const res: MigrationResult = { json, changed: false, notes, extra };
  const typeName = (t: string) => shortType(json.type, t);

  // ---- type replacements ----
  if (type === 'minecraft:crafting_special_armordye' && fmt.dyeImbue) {
    const make = (item: string) => ({
      type: typeName('minecraft:crafting_dye'),
      dye: '#minecraft:dyes',
      group: 'dyed_armor',
      result: { id: `minecraft:${item}` },
      target: `minecraft:${item}`,
    });
    json = make(DYEABLE[0]);
    DYEABLE.slice(1).forEach((it) => extra.push({ name: `${it}_dyed`, json: make(it) }));
    notes.push({ message: 'crafting_special_armordye was split into {0} crafting_dye recipes.', args: [DYEABLE.length] });
  } else if (type === 'minecraft:crafting_dye' && !fmt.dyeImbue) {
    json = { type: typeName('minecraft:crafting_special_armordye'), category: 'misc' };
    notes.push({ message: 'crafting_dye does not exist before 26.1: replaced by crafting_special_armordye (dyes every dyeable item).' });
  } else if (type === 'minecraft:crafting_special_tippedarrow' && fmt.dyeImbue) {
    json = {
      type: typeName('minecraft:crafting_imbue'),
      category: input.category ?? 'misc',
      material: 'minecraft:arrow',
      result: { count: 8, id: 'minecraft:tipped_arrow' },
      source: 'minecraft:lingering_potion',
    };
    notes.push({ message: 'crafting_special_tippedarrow was replaced by crafting_imbue.' });
  } else if (type === 'minecraft:crafting_imbue' && !fmt.dyeImbue) {
    json = { type: typeName('minecraft:crafting_special_tippedarrow'), category: 'misc' };
    notes.push({ message: 'crafting_imbue does not exist before 26.1: replaced by crafting_special_tippedarrow.' });
  } else if (type === 'minecraft:crafting_special_shulkerboxcoloring' && fmt.transmute) {
    const make = (c: string) => ({
      type: typeName('minecraft:crafting_transmute'),
      category: 'misc',
      group: 'shulker_box_dye',
      input: '#minecraft:shulker_boxes',
      material: `minecraft:${c}_dye`,
      result: fmt.transmuteResultStack ? { id: `minecraft:${c}_shulker_box` } : `minecraft:${c}_shulker_box`,
    });
    json = make(DYE_COLORS[0]);
    DYE_COLORS.slice(1).forEach((c) => extra.push({ name: `${c}_shulker_box`, json: make(c) }));
    notes.push({ message: 'crafting_special_shulkerboxcoloring was split into {0} crafting_transmute recipes.', args: [16] });
  } else if (type === 'minecraft:crafting_special_mapcloning' && fmt.dyeImbue) {
    json = {
      type: typeName('minecraft:crafting_transmute'),
      add_material_count_to_result: true,
      category: 'misc',
      group: 'map_cloning',
      input: 'minecraft:filled_map',
      material: 'minecraft:map',
      material_count: { max: 8, min: 1 },
      result: { id: 'minecraft:filled_map' },
    };
    notes.push({ message: 'crafting_special_mapcloning was replaced by a crafting_transmute recipe.' });
  } else if (type === 'minecraft:crafting_transmute' && !fmt.dyeImbue && json.group === 'map_cloning' && json.material_count !== undefined) {
    json = { type: typeName('minecraft:crafting_special_mapcloning'), category: 'misc' };
    notes.push({ message: 'Map cloning uses crafting_special_mapcloning before 26.1.' });
  } else if (type === 'minecraft:crafting_transmute' && !fmt.transmute) {
    const out: Record<string, any> = { type: typeName('minecraft:crafting_shapeless') };
    for (const [k, v] of Object.entries(json)) if (!['type', 'input', 'material', 'result', 'material_count', 'add_material_count_to_result'].includes(k)) out[k] = v;
    out.ingredients = [json.input, json.material].filter((x) => x !== undefined);
    const r = parseResult(json.result, ['result']);
    out.result = { id: r?.id ?? 'minecraft:stone', ...(r && r.count > 1 ? { count: r.count } : {}) };
    json = out;
    notes.push({ message: 'crafting_transmute does not exist before 1.21.2: converted to crafting_shapeless (components of the input are not copied).' });
  } else if (type === 'minecraft:crafting_special_bannerduplicate' && fmt.dyeImbue && json.banner === undefined) {
    const make = (c: string) => ({ type: typeName(type), banner: `minecraft:${c}_banner`, result: { id: `minecraft:${c}_banner` } });
    json = make(DYE_COLORS[0]);
    DYE_COLORS.slice(1).forEach((c) => extra.push({ name: `${c}_banner_duplicate`, json: make(c) }));
    notes.push({ message: 'crafting_special_bannerduplicate was split into {0} recipes (one per color).', args: [16] });
  } else if (type === 'minecraft:crafting_special_bannerduplicate' && !fmt.dyeImbue && json.banner !== undefined) {
    json = { type: json.type, category: 'misc' };
    notes.push({ message: 'Removed the 26.1+ fields of {0}.', args: [type] });
  } else if (SPECIAL_FIELDS_26[type]) {
    const fields = SPECIAL_FIELDS_26[type];
    const hasFields = Object.keys(fields).some((k) => k !== 'result' && json[k] !== undefined);
    if (fmt.dyeImbue && !hasFields) {
      const out: Record<string, any> = { type: json.type };
      for (const [k, v] of Object.entries(json)) if (k !== 'type' && k !== 'category') out[k] = v;
      Object.assign(out, clone(fields));
      json = out;
      notes.push({ message: 'Added the explicit fields required by {0} since 26.1.', args: [type] });
    } else if (!fmt.dyeImbue && hasFields) {
      const out: Record<string, any> = { type: json.type, category: json.category ?? 'misc' };
      for (const [k, v] of Object.entries(json)) if (!(k in fields) && k !== 'type' && k !== 'category') out[k] = v;
      json = out;
      notes.push({ message: 'Removed the 26.1+ fields of {0}.', args: [type] });
    }
  } else if (type === 'minecraft:crafting_special_suspiciousstew' && fmt.transmute) {
    notes.push({ message: 'crafting_special_suspiciousstew was removed in 1.21.2 (vanilla uses one shapeless recipe per flower). Delete or recreate this recipe.' });
    res.unsupported = true;
  } else if (type === 'minecraft:brewing' && !fmt.brewing) {
    notes.push({ message: 'Brewing recipes need 26.3+; on older versions register brewing mixes in code.' });
    res.unsupported = true;
  }

  // ---- results ----
  const newType = normalizeType(json.type);
  const newKind = recipeKind(newType);
  for (const key of ['result', 'output']) {
    const r = json[key];
    if (isObj(r) && typeof r.item === 'string' && r.id === undefined) {
      const { item, ...rest } = r;
      json[key] = { id: item, ...rest };
    }
  }
  if (typeof json.result === 'string' && newKind !== 'transmute' && newKind !== 'generic') {
    json.result = { id: json.result, ...(typeof json.count === 'number' && json.count > 1 ? { count: json.count } : {}) };
    delete json.count;
  }
  if (newKind === 'transmute') {
    if (fmt.transmuteResultStack && typeof json.result === 'string') json.result = { id: json.result };
    else if (!fmt.transmuteResultStack && isObj(json.result)) {
      const r = parseResult(json.result, ['result']);
      if (r && (r.count > 1 || r.components)) notes.push({ message: 'The transmute result count / components are not supported before 1.21.5 and were dropped.' });
      json.result = r?.id ?? 'minecraft:stone';
    }
  }
  if (newKind === 'smithing_trim') {
    if (fmt.trimPattern && json.pattern === undefined) {
      const p = trimPatternFromTemplate(parseIngredient(json.template).ids[0]);
      if (p) json.pattern = p;
      else notes.push({ message: 'Could not infer the trim "pattern" from the template; add it manually.' });
    } else if (!fmt.trimPattern && typeof json.pattern === 'string') delete json.pattern;
  }

  // ---- ingredient syntax ----
  if (newKind === 'generic') res.modded = true;
  // Modded types are only upgraded (object → string syntax): their string fields may not be ingredients.
  const enc = (v: unknown) => (newKind === 'generic' && (fmt.ingredient === 'object' || typeof v === 'string') ? v : reencodeIngredient(v, fmt.ingredient));
  if (isObj(json.key)) for (const k of Object.keys(json.key)) json.key[k] = enc(json.key[k]);
  if (Array.isArray(json.ingredients)) json.ingredients = json.ingredients.map(enc);
  for (const f of INGREDIENT_FIELDS) {
    if (json[f] === undefined) continue;
    if (newKind === 'brewing') continue;
    json[f] = enc(json[f]);
  }
  if (isObj(json.shapes)) for (const k of Object.keys(json.shapes)) json.shapes[k] = enc(json.shapes[k]);

  for (const e of extra) e.json = migrateRecipe(e.json, fmt, e.name).json;
  res.json = json;
  res.changed = !jsonEqual(input, json) || extra.length > 0;
  void kind;
  void name;
  return res;
}
