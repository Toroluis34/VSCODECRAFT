// Item stack data components (1.20.5+ syntax): build version-aware component values and serialize them
// as SNBT (/give, /summon) or JSON (loot table set_components, recipe results).
// Pure module (no 'vscode' import): used by the extension host, the give webview and unit tests.
//
// Version differences handled here:
//  - 1.21.2: "consumable" split from "food" (eat_seconds/effects/using_converts_to moved), item_model added,
//            attribute ids lost their "generic." prefix.
//  - 1.21.4: custom_model_data became {floats, flags, strings, colors} (was an int).
//  - 1.21.5: text components are written as SNBT/JSON objects (were JSON strings), show_in_tooltip removed in
//            favour of tooltip_display {hide_tooltip, hidden_components}, enchantments/attribute_modifiers/
//            dyed_color/unbreakable/trim got simpler shapes, hide_tooltip & hide_additional_tooltip removed.
//  - 26.3:   loot tables use "modifier" + "type" instead of "functions" + "function".
import { compareVersions } from '../../core/versions';
import { lootFormatForVersion } from './lootModel';
import { cssColor, formatTranslation, fullId, humanizeId, MC_COLORS, roman, shortId, TextRun } from './text';

// ---------------------------------------------------------------------------------------------
// Item specification (what the builder UI edits)
// ---------------------------------------------------------------------------------------------

export interface TextSpec {
  text: string;
  /** Named colour (red, gold...) or #rrggbb. */
  color?: string;
  bold?: boolean;
  /** undefined = Minecraft default (custom names and lore are italic). */
  italic?: boolean;
  underlined?: boolean;
  strikethrough?: boolean;
  obfuscated?: boolean;
}

export interface EnchantmentSpec {
  id: string;
  level: number;
}

export type AttributeOperation = 'add_value' | 'add_multiplied_base' | 'add_multiplied_total';

export interface AttributeSpec {
  /** Attribute id, e.g. minecraft:attack_damage (1.21.2+) or minecraft:generic.attack_damage (1.21.1). */
  type: string;
  amount: number;
  operation: AttributeOperation;
  /** any, mainhand, offhand, hand, head, chest, legs, feet, armor, body, saddle */
  slot: string;
  /** Modifier id (resource location). Generated from the attribute and slot when empty. */
  id?: string;
}

export interface EffectSpec {
  id: string;
  /** Ticks. */
  duration: number;
  amplifier: number;
  /** 0..1, food effects only. */
  probability?: number;
}

export interface FoodSpec {
  nutrition: number;
  saturation: number;
  canAlwaysEat?: boolean;
  /** Seconds to eat (default 1.6). */
  eatSeconds?: number;
  /** eat | drink | block | bow | spear | crossbow | spyglass | toot_horn | brush | bundle (1.21.2+) */
  animation?: string;
  effects?: EffectSpec[];
  /** Item left after eating (e.g. minecraft:bowl). */
  convertsTo?: string;
}

export interface ToolRuleSpec {
  /** Block id, "#tag" or a comma separated list of block ids. */
  blocks: string;
  speed?: number;
  correctForDrops?: boolean;
}

export interface ToolSpec {
  defaultMiningSpeed?: number;
  damagePerBlock?: number;
  rules: ToolRuleSpec[];
}

export interface PotionSpec {
  potion?: string;
  customColor?: number;
  effects?: EffectSpec[];
}

export interface FireworkExplosionSpec {
  shape: 'small_ball' | 'large_ball' | 'star' | 'creeper' | 'burst';
  colors: number[];
  fadeColors?: number[];
  trail?: boolean;
  twinkle?: boolean;
}

export interface FireworksSpec {
  flightDuration: number;
  explosions: FireworkExplosionSpec[];
}

export interface CustomModelDataSpec {
  floats?: number[];
  flags?: boolean[];
  strings?: string[];
  colors?: number[];
}

export interface ItemSpec {
  id: string;
  count: number;
  customName?: TextSpec;
  lore?: TextSpec[];
  enchantments?: EnchantmentSpec[];
  /** enchantment_glint_override */
  glint?: boolean;
  unbreakable?: boolean;
  customModelData?: CustomModelDataSpec;
  itemModel?: string;
  rarity?: 'common' | 'uncommon' | 'rare' | 'epic';
  maxStackSize?: number;
  maxDamage?: number;
  damage?: number;
  dyedColor?: number;
  attributes?: AttributeSpec[];
  food?: FoodSpec;
  tool?: ToolSpec;
  potion?: PotionSpec;
  fireworks?: FireworksSpec;
  trim?: { material: string; pattern: string };
  /** SNBT compound, e.g. {my_key:1b}. */
  customData?: string;
  /** Hide the whole tooltip. */
  hideTooltip?: boolean;
  /** Component ids whose tooltip lines are hidden (e.g. minecraft:enchantments). */
  hiddenComponents?: string[];
  /** Namespace for generated ids (attribute modifier ids). */
  namespace?: string;
}

export interface Warning {
  /** English template, translated by the UI. */
  text: string;
  args?: (string | number)[];
}

// ---------------------------------------------------------------------------------------------
// Value model: plain JSON-like values + markers for SNBT-specific types
// ---------------------------------------------------------------------------------------------

/** A float (SNBT "1.5f"; JSON number). */
export class FloatVal {
  constructor(readonly v: number) {}
}

/** Raw SNBT text (custom_data): inserted verbatim in SNBT, written as a string in JSON. */
export class RawSnbt {
  constructor(readonly snbt: string) {}
}

export type Val = string | number | boolean | FloatVal | RawSnbt | Val[] | { [key: string]: Val };

export const f32 = (v: number): FloatVal => new FloatVal(v);

const SAFE_KEY = /^[A-Za-z0-9._+-]+$/;

/** Quote a string for SNBT (picks the quote that needs the least escaping). */
export function quoteSnbt(s: string): string {
  const useSingle = s.includes('"') && !s.includes("'");
  const q = useSingle ? "'" : '"';
  return q + s.replace(/\\/g, '\\\\').replace(new RegExp(q, 'g'), `\\${q}`).replace(/\n/g, '\\n') + q;
}

function snbtKey(k: string): string {
  return SAFE_KEY.test(k) ? k : quoteSnbt(k);
}

function snbtNumber(n: number): string {
  if (!Number.isFinite(n)) return '0';
  return String(n);
}

/** Serialize a value as SNBT. */
export function toSnbt(v: Val): string {
  if (v instanceof FloatVal) return `${snbtNumber(v.v)}f`;
  if (v instanceof RawSnbt) return v.snbt.trim() || '{}';
  if (typeof v === 'string') return quoteSnbt(v);
  if (typeof v === 'number') return snbtNumber(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return `[${v.map(toSnbt).join(',')}]`;
  return `{${Object.entries(v)
    .map(([k, x]) => `${snbtKey(k)}:${toSnbt(x)}`)
    .join(',')}}`;
}

/** Convert to a plain JSON value. */
export function toJsonValue(v: Val): unknown {
  if (v instanceof FloatVal) return v.v;
  if (v instanceof RawSnbt) return v.snbt.trim() || '{}';
  if (Array.isArray(v)) return v.map(toJsonValue);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toJsonValue(x)]));
  return v;
}

// ---------------------------------------------------------------------------------------------
// Version flags
// ---------------------------------------------------------------------------------------------

export interface ComponentFlags {
  /** 1.20.5+: item components exist at all. */
  components: boolean;
  /** 1.21.2+: consumable split from food, item_model, attribute ids without "generic.". */
  consumable: boolean;
  itemModel: boolean;
  /** 1.21.4+: custom_model_data object form. */
  cmdObject: boolean;
  /** 1.21.5+: text components as objects, tooltip_display, simplified shapes. */
  textObjects: boolean;
  tooltipDisplay: boolean;
}

const ge = (v: string, min: string) => compareVersions(v, min) >= 0;

export function componentFlags(version: string): ComponentFlags {
  return {
    components: ge(version, '1.20.5'),
    consumable: ge(version, '1.21.2'),
    itemModel: ge(version, '1.21.2'),
    cmdObject: ge(version, '1.21.4'),
    textObjects: ge(version, '1.21.5'),
    tooltipDisplay: ge(version, '1.21.5'),
  };
}

/** Components that had a show_in_tooltip field before 1.21.5. */
const SHOW_IN_TOOLTIP = new Set([
  'minecraft:enchantments',
  'minecraft:stored_enchantments',
  'minecraft:attribute_modifiers',
  'minecraft:unbreakable',
  'minecraft:dyed_color',
  'minecraft:trim',
  'minecraft:can_break',
  'minecraft:can_place_on',
  'minecraft:jukebox_playable',
]);

// ---------------------------------------------------------------------------------------------
// Building components
// ---------------------------------------------------------------------------------------------

/** Text component value for a version: object (1.21.5+) or JSON string (older). */
export function textValue(t: TextSpec, version: string): Val {
  const o: Record<string, Val> = { text: t.text };
  if (t.color) o.color = t.color;
  for (const k of ['bold', 'italic', 'underlined', 'strikethrough', 'obfuscated'] as const) {
    if (t[k] !== undefined) o[k] = t[k]!;
  }
  if (componentFlags(version).textObjects) return Object.keys(o).length === 1 ? t.text : o;
  return JSON.stringify(toJsonValue(o));
}

/** Normalize an attribute id for a version ("generic." prefix before 1.21.2 only). */
export function normalizeAttribute(id: string, version: string): string {
  const full = fullId(id);
  if (componentFlags(version).consumable) return full.replace(/^minecraft:(generic|player|zombie)\./, 'minecraft:');
  const m = /^minecraft:([a-z_]+)$/.exec(full);
  if (!m) return full;
  if (PLAYER_ATTRIBUTES.has(m[1])) return `minecraft:player.${m[1]}`;
  if (m[1] === 'spawn_reinforcements') return 'minecraft:zombie.spawn_reinforcements';
  return `minecraft:generic.${m[1]}`;
}

/** Attributes that used the "player." prefix before 1.21.2. */
const PLAYER_ATTRIBUTES = new Set([
  'block_break_speed',
  'block_interaction_range',
  'entity_interaction_range',
  'mining_efficiency',
  'sneaking_speed',
  'submerged_mining_speed',
  'sweeping_damage_ratio',
]);

function effectVal(e: EffectSpec): Record<string, Val> {
  const o: Record<string, Val> = { id: fullId(e.id) };
  if (e.amplifier) o.amplifier = Math.max(0, Math.round(e.amplifier));
  o.duration = Math.max(1, Math.round(e.duration));
  return o;
}

export interface BuildResult {
  /** Component id (with namespace) -> value, in a stable order. */
  components: Record<string, Val>;
  warnings: Warning[];
}

export function buildComponents(spec: ItemSpec, version: string): BuildResult {
  const fl = componentFlags(version);
  const c: Record<string, Val> = {};
  const warnings: Warning[] = [];
  const hidden = new Set((spec.hiddenComponents ?? []).map(fullId));
  const ns = spec.namespace || 'minecraft';
  if (!fl.components) warnings.push({ text: 'Item components require Minecraft 1.20.5 or newer (target: {0}).', args: [version] });
  const itemId = fullId(spec.id || 'minecraft:stone');
  /** Wrap a value for components that had show_in_tooltip before 1.21.5. */
  const tooltipWrapped = (key: string, value: Record<string, Val>): Record<string, Val> =>
    !fl.tooltipDisplay && hidden.has(key) && SHOW_IN_TOOLTIP.has(key) ? { ...value, show_in_tooltip: false } : value;

  if (spec.customName?.text) c['minecraft:custom_name'] = textValue(spec.customName, version);

  const lore = (spec.lore ?? []).filter((l) => l.text !== undefined);
  if (lore.length) c['minecraft:lore'] = lore.map((l) => textValue(l, version));

  const ench = (spec.enchantments ?? []).filter((e) => e.id);
  if (ench.length) {
    const key = itemId === 'minecraft:enchanted_book' ? 'minecraft:stored_enchantments' : 'minecraft:enchantments';
    const levels: Record<string, Val> = {};
    for (const e of ench) {
      const lvl = Math.round(e.level);
      if (lvl < 1 || lvl > 255) warnings.push({ text: 'Enchantment level must be between 1 and 255 ({0}).', args: [e.id] });
      levels[fullId(e.id)] = Math.min(255, Math.max(1, lvl));
    }
    c[key] = fl.textObjects ? levels : tooltipWrapped(key, { levels });
  }
  if (spec.glint !== undefined) c['minecraft:enchantment_glint_override'] = spec.glint;

  if (spec.unbreakable) c['minecraft:unbreakable'] = fl.tooltipDisplay ? {} : tooltipWrapped('minecraft:unbreakable', {});

  const cmd = spec.customModelData;
  if (cmd && (cmd.floats?.length || cmd.flags?.length || cmd.strings?.length || cmd.colors?.length)) {
    if (fl.cmdObject) {
      const o: Record<string, Val> = {};
      if (cmd.floats?.length) o.floats = cmd.floats.map((x) => f32(x));
      if (cmd.flags?.length) o.flags = cmd.flags;
      if (cmd.strings?.length) o.strings = cmd.strings;
      if (cmd.colors?.length) o.colors = cmd.colors.map((x) => Math.round(x));
      c['minecraft:custom_model_data'] = o;
    } else {
      const n = cmd.floats?.[0];
      if (n === undefined) warnings.push({ text: 'Before 1.21.4 custom_model_data is a single integer: set the first float.' });
      else c['minecraft:custom_model_data'] = Math.round(n);
      if (cmd.flags?.length || cmd.strings?.length || cmd.colors?.length || (cmd.floats?.length ?? 0) > 1)
        warnings.push({ text: 'Flags, strings, colours and extra floats need 1.21.4+; only the first float is used.' });
    }
  }

  if (spec.itemModel) {
    if (fl.itemModel) c['minecraft:item_model'] = fullId(spec.itemModel);
    else warnings.push({ text: 'item_model requires 1.21.2 or newer; use custom_model_data instead.' });
  }

  if (spec.rarity) c['minecraft:rarity'] = spec.rarity;
  if (spec.maxStackSize !== undefined) {
    const n = Math.round(spec.maxStackSize);
    if (n < 1 || n > 99) warnings.push({ text: 'max_stack_size must be between 1 and 99.' });
    c['minecraft:max_stack_size'] = Math.min(99, Math.max(1, n));
  }
  if (spec.maxDamage !== undefined) {
    c['minecraft:max_damage'] = Math.max(1, Math.round(spec.maxDamage));
    if (spec.maxStackSize !== undefined && spec.maxStackSize > 1)
      warnings.push({ text: 'An item cannot have both max_damage and max_stack_size above 1.' });
  }
  if (spec.damage !== undefined) c['minecraft:damage'] = Math.max(0, Math.round(spec.damage));

  if (spec.dyedColor !== undefined) {
    const rgb = Math.round(spec.dyedColor) & 0xffffff;
    c['minecraft:dyed_color'] = fl.textObjects ? rgb : tooltipWrapped('minecraft:dyed_color', { rgb });
  }

  const attrs = (spec.attributes ?? []).filter((a) => a.type);
  if (attrs.length) {
    const used = new Set<string>();
    const mods = attrs.map((a) => {
      const type = normalizeAttribute(a.type, version);
      let id = a.id ? fullId(a.id.includes(':') ? a.id : `${ns}:${a.id}`) : `${ns}:${shortId(type).replace(/^(generic|player|zombie)\./, '').replace(/[^a-z0-9_./-]/g, '_')}_${a.slot || 'any'}`;
      if (!a.id) {
        let i = 2;
        const base = id;
        while (used.has(id)) id = `${base}_${i++}`;
      }
      used.add(id);
      return { type, amount: a.amount, id, operation: a.operation, slot: a.slot || 'any' } as Record<string, Val>;
    });
    c['minecraft:attribute_modifiers'] = fl.textObjects ? mods : tooltipWrapped('minecraft:attribute_modifiers', { modifiers: mods });
  }

  if (spec.food) {
    const fd = spec.food;
    const food: Record<string, Val> = { nutrition: Math.max(0, Math.round(fd.nutrition)), saturation: f32(fd.saturation) };
    if (fd.canAlwaysEat) food.can_always_eat = true;
    const effects = (fd.effects ?? []).filter((e) => e.id);
    if (fl.consumable) {
      c['minecraft:food'] = food;
      const cons: Record<string, Val> = {};
      if (fd.eatSeconds !== undefined && fd.eatSeconds !== 1.6) cons.consume_seconds = f32(fd.eatSeconds);
      if (fd.animation && fd.animation !== 'eat') cons.animation = fd.animation;
      if (effects.length) {
        // one apply_effects per distinct probability
        const groups = new Map<number, EffectSpec[]>();
        for (const e of effects) {
          const p = e.probability ?? 1;
          groups.set(p, [...(groups.get(p) ?? []), e]);
        }
        cons.on_consume_effects = [...groups].map(([p, list]) => {
          const o: Record<string, Val> = { type: 'minecraft:apply_effects', effects: list.map(effectVal) };
          if (p < 1) o.probability = f32(p);
          return o;
        });
      }
      c['minecraft:consumable'] = cons;
      if (fd.convertsTo) c['minecraft:use_remainder'] = { id: fullId(fd.convertsTo) };
    } else {
      if (fd.eatSeconds !== undefined && fd.eatSeconds !== 1.6) food.eat_seconds = f32(fd.eatSeconds);
      if (fd.convertsTo) food.using_converts_to = { id: fullId(fd.convertsTo) };
      if (effects.length)
        food.effects = effects.map((e) => {
          const o: Record<string, Val> = { effect: effectVal(e) };
          if ((e.probability ?? 1) < 1) o.probability = f32(e.probability!);
          return o;
        });
      if (fd.animation && fd.animation !== 'eat') warnings.push({ text: 'Eating animations need 1.21.2+ (consumable component).' });
      c['minecraft:food'] = food;
    }
  }

  if (spec.tool && (spec.tool.rules.length || spec.tool.defaultMiningSpeed !== undefined || spec.tool.damagePerBlock !== undefined)) {
    const t = spec.tool;
    const tool: Record<string, Val> = {
      rules: t.rules
        .filter((r) => r.blocks.trim())
        .map((r) => {
          const parts = r.blocks.split(',').map((s) => s.trim()).filter(Boolean).map(fullId);
          const o: Record<string, Val> = { blocks: parts.length === 1 ? parts[0] : parts };
          if (r.speed !== undefined) o.speed = f32(r.speed);
          if (r.correctForDrops !== undefined) o.correct_for_drops = r.correctForDrops;
          return o;
        }),
    };
    if (t.defaultMiningSpeed !== undefined) tool.default_mining_speed = f32(t.defaultMiningSpeed);
    if (t.damagePerBlock !== undefined) tool.damage_per_block = Math.max(0, Math.round(t.damagePerBlock));
    c['minecraft:tool'] = tool;
  }

  if (spec.potion && (spec.potion.potion || spec.potion.customColor !== undefined || spec.potion.effects?.length)) {
    const p = spec.potion;
    const o: Record<string, Val> = {};
    if (p.potion) o.potion = fullId(p.potion);
    if (p.customColor !== undefined) o.custom_color = Math.round(p.customColor) & 0xffffff;
    const effects = (p.effects ?? []).filter((e) => e.id);
    if (effects.length) o.custom_effects = effects.map(effectVal);
    c['minecraft:potion_contents'] = o;
  }

  if (spec.fireworks) {
    const explosion = (e: FireworkExplosionSpec): Record<string, Val> => {
      const o: Record<string, Val> = { shape: e.shape };
      if (e.colors.length) o.colors = e.colors.map((x) => Math.round(x) & 0xffffff);
      if (e.fadeColors?.length) o.fade_colors = e.fadeColors.map((x) => Math.round(x) & 0xffffff);
      if (e.trail) o.has_trail = true;
      if (e.twinkle) o.has_twinkle = true;
      return o;
    };
    if (itemId === 'minecraft:firework_star') {
      if (spec.fireworks.explosions[0]) c['minecraft:firework_explosion'] = explosion(spec.fireworks.explosions[0]);
    } else {
      const o: Record<string, Val> = { flight_duration: Math.min(255, Math.max(0, Math.round(spec.fireworks.flightDuration))) };
      if (spec.fireworks.explosions.length) o.explosions = spec.fireworks.explosions.map(explosion);
      c['minecraft:fireworks'] = o;
    }
  }

  if (spec.trim?.material && spec.trim.pattern) {
    c['minecraft:trim'] = tooltipWrapped('minecraft:trim', { material: fullId(spec.trim.material), pattern: fullId(spec.trim.pattern) });
  }

  if (spec.customData?.trim()) {
    const s = spec.customData.trim();
    if (!s.startsWith('{') || !s.endsWith('}')) warnings.push({ text: 'custom_data must be an SNBT compound: {key:value,...}' });
    else if (!balanced(s)) warnings.push({ text: 'custom_data has unbalanced brackets or quotes.' });
    c['minecraft:custom_data'] = new RawSnbt(s);
  }

  // Tooltip visibility
  if (fl.tooltipDisplay) {
    const td: Record<string, Val> = {};
    if (spec.hideTooltip) td.hide_tooltip = true;
    if (hidden.size) td.hidden_components = [...hidden];
    if (Object.keys(td).length) c['minecraft:tooltip_display'] = td;
  } else {
    if (spec.hideTooltip) c['minecraft:hide_tooltip'] = {};
    const other = [...hidden].filter((k) => !SHOW_IN_TOOLTIP.has(k));
    if (other.length) c['minecraft:hide_additional_tooltip'] = {};
  }
  return { components: c, warnings };
}

/** Rough check that brackets and quotes of an SNBT string are balanced. */
export function balanced(s: string): boolean {
  const stack: string[] = [];
  let quote: string | undefined;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = undefined;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '{' || ch === '[') stack.push(ch);
    else if (ch === '}' || ch === ']') {
      const open = stack.pop();
      if ((ch === '}' && open !== '{') || (ch === ']' && open !== '[')) return false;
    }
  }
  return !quote && stack.length === 0;
}

// ---------------------------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------------------------

/** Component map in SNBT command syntax: "custom_name={...},lore=[...]" (minecraft: prefix dropped). */
export function componentsSnbt(components: Record<string, Val>): string {
  return Object.entries(components)
    .map(([k, v]) => `${shortId(k)}=${toSnbt(v)}`)
    .join(',');
}

/** /give command, e.g. `/give @p minecraft:diamond_sword[unbreakable={}] 1`. */
export function giveCommand(spec: ItemSpec, version: string, target = '@p'): string {
  const { components } = buildComponents(spec, version);
  const comps = componentsSnbt(components);
  const count = Math.max(1, Math.round(spec.count || 1));
  return `/give ${target} ${fullId(spec.id)}${comps ? `[${comps}]` : ''}${count !== 1 ? ` ${count}` : ''}`;
}

/** Item stack as SNBT ({id, count, components}). */
export function itemStackSnbt(spec: ItemSpec, version: string): string {
  const { components } = buildComponents(spec, version);
  const o: Record<string, Val> = { id: fullId(spec.id), count: Math.max(1, Math.round(spec.count || 1)) };
  if (Object.keys(components).length) o.components = components;
  return toSnbt(o);
}

/** /summon item command that drops the stack. */
export function summonCommand(spec: ItemSpec, version: string): string {
  return `/summon minecraft:item ~ ~1 ~ {Item:${itemStackSnbt(spec, version)}}`;
}

/** Components as plain JSON (data files). */
export function componentsJson(spec: ItemSpec, version: string): Record<string, unknown> {
  return toJsonValue(buildComponents(spec, version).components) as Record<string, unknown>;
}

/** A set_components loot function for the version's loot format. */
export function setComponentsFunction(spec: ItemSpec, version: string): Record<string, unknown> {
  const key = lootFormatForVersion(version) === 'modern' ? 'type' : 'function';
  return { [key]: 'minecraft:set_components', components: componentsJson(spec, version) };
}

/** A loot table item entry with set_components (and set_count when count > 1). */
export function lootEntryJson(spec: ItemSpec, version: string): Record<string, unknown> {
  const modern = lootFormatForVersion(version) === 'modern';
  const key = modern ? 'type' : 'function';
  const fns: Record<string, unknown>[] = [];
  const comps = componentsJson(spec, version);
  if (Object.keys(comps).length) fns.push({ [key]: 'minecraft:set_components', components: comps });
  const count = Math.max(1, Math.round(spec.count || 1));
  if (count !== 1) fns.push({ [key]: 'minecraft:set_count', count });
  const entry: Record<string, unknown> = { type: 'minecraft:item', name: fullId(spec.id) };
  if (fns.length) entry[modern ? 'modifier' : 'functions'] = fns;
  return entry;
}

/** Recipe "result" object (1.20.5+: id/count/components). */
export function recipeResultJson(spec: ItemSpec, version: string): Record<string, unknown> {
  const o: Record<string, unknown> = { id: fullId(spec.id) };
  const count = Math.max(1, Math.round(spec.count || 1));
  if (count !== 1) o.count = count;
  const comps = componentsJson(spec, version);
  if (Object.keys(comps).length) o.components = comps;
  return o;
}

// ---------------------------------------------------------------------------------------------
// Tooltip preview
// ---------------------------------------------------------------------------------------------

export const RARITY_COLORS: Record<string, string> = {
  common: 'white',
  uncommon: 'yellow',
  rare: 'aqua',
  epic: 'light_purple',
};

const SLOT_KEYS: Record<string, string> = {
  any: 'item.modifiers.any',
  mainhand: 'item.modifiers.mainhand',
  offhand: 'item.modifiers.offhand',
  hand: 'item.modifiers.hand',
  head: 'item.modifiers.head',
  chest: 'item.modifiers.chest',
  legs: 'item.modifiers.legs',
  feet: 'item.modifiers.feet',
  armor: 'item.modifiers.armor',
  body: 'item.modifiers.body',
  saddle: 'item.modifiers.saddle',
};

const SLOT_FALLBACK: Record<string, string> = {
  any: 'When equipped:',
  mainhand: 'When in Main Hand:',
  offhand: 'When in Off Hand:',
  hand: 'When in Hand:',
  head: 'When on Head:',
  chest: 'When on Body:',
  legs: 'When on Legs:',
  feet: 'When on Feet:',
  armor: 'When worn:',
  body: 'When worn:',
  saddle: 'When saddled:',
};

export interface TooltipOptions {
  /** Lang lookup (vanilla + workspace). */
  lang: Record<string, string>;
  /** Display name of the item (when there is no custom name). */
  itemName: string;
  /** Default components of the item (vanilla), used for rarity, durability and base attributes. */
  defaults?: Record<string, any>;
  /** Show "advanced tooltips" lines (F3+H): durability, id, component count. */
  advanced?: boolean;
}

function textRun(t: TextSpec, defaults: Omit<TextRun, 'text'>): TextRun {
  return {
    text: t.text,
    color: t.color ?? defaults.color,
    bold: t.bold ?? defaults.bold,
    italic: t.italic ?? defaults.italic,
    underlined: t.underlined,
    strikethrough: t.strikethrough,
    obfuscated: t.obfuscated,
  };
}

function fmtAmount(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/** Tooltip lines (each a list of styled runs) as Minecraft would render them. */
export function tooltipLines(spec: ItemSpec, version: string, opts: TooltipOptions): TextRun[][] {
  const L = (key: string, fallback: string) => opts.lang[key] ?? fallback;
  const lines: TextRun[][] = [];
  const d = opts.defaults ?? {};
  const hidden = new Set((spec.hiddenComponents ?? []).map(fullId));
  const rarity = spec.rarity ?? stripNs(d['minecraft:rarity']) ?? 'common';
  const enchanted = (spec.enchantments?.length ?? 0) > 0;
  // Enchanted items are shown one rarity higher for common/uncommon (pre-26.x style: common -> aqua).
  let nameColor = RARITY_COLORS[rarity] ?? 'white';
  if (enchanted && (rarity === 'common' || rarity === 'uncommon')) nameColor = 'aqua';
  if (spec.customName?.text) lines.push([textRun(spec.customName, { color: nameColor, italic: true })]);
  else lines.push([{ text: opts.itemName, color: nameColor }]);
  if (spec.hideTooltip) return lines;

  if (spec.potion && (spec.potion.potion || spec.potion.effects?.length) && !hidden.has('minecraft:potion_contents')) {
    const effects = spec.potion.effects ?? [];
    if (spec.potion.potion && !effects.length) {
      const p = shortId(fullId(spec.potion.potion)).replace(/^(long|strong)_/, '');
      lines.push([{ text: L(`effect.minecraft.${p}`, humanizeId(p)), color: 'blue' }]);
    }
    for (const e of effects) {
      const name = L(`effect.minecraft.${shortId(fullId(e.id))}`, humanizeId(e.id));
      const amp = e.amplifier > 0 ? ` ${L(`potion.potency.${e.amplifier}`, roman(e.amplifier + 1))}` : '';
      const secs = Math.floor(e.duration / 20);
      lines.push([{ text: `${name}${amp} (${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')})`, color: 'blue' }]);
    }
  }

  if (spec.trim?.material && spec.trim.pattern && !hidden.has('minecraft:trim')) {
    lines.push([{ text: L('item.minecraft.smithing_template.upgrade', 'Upgrade:'), color: 'gray' }]);
    lines.push([{ text: ` ${L(`trim_pattern.${fullId(spec.trim.pattern).replace(':', '.')}`, humanizeId(spec.trim.pattern) + ' Armor Trim')}`, color: 'gold' }]);
    lines.push([{ text: ` ${L(`trim_material.${fullId(spec.trim.material).replace(':', '.')}`, humanizeId(spec.trim.material) + ' Material')}`, color: 'gold' }]);
  }

  if (enchanted && !hidden.has('minecraft:enchantments') && !hidden.has('minecraft:stored_enchantments')) {
    for (const e of spec.enchantments!) {
      const id = fullId(e.id);
      const name = L(`enchantment.${id.replace(':', '.')}`, humanizeId(id));
      const curse = /curse/.test(id);
      lines.push([{ text: `${name} ${L(`enchantment.level.${e.level}`, roman(e.level))}`, color: curse ? 'red' : 'gray' }]);
    }
  }

  if (spec.dyedColor !== undefined && !hidden.has('minecraft:dyed_color') && opts.advanced) {
    lines.push([{ text: L('item.color', 'Color: %s').replace('%s', `#${(spec.dyedColor & 0xffffff).toString(16).padStart(6, '0').toUpperCase()}`), color: 'gray' }]);
  } else if (spec.dyedColor !== undefined && !hidden.has('minecraft:dyed_color')) {
    lines.push([{ text: L('item.dyed', 'Dyed'), color: 'gray', italic: true }]);
  }

  for (const l of spec.lore ?? []) if (l.text !== undefined) lines.push([textRun(l, { color: 'dark_purple', italic: true })]);

  // Attribute modifiers grouped by slot
  const attrs: AttributeSpec[] = spec.attributes?.length
    ? spec.attributes.filter((a) => a.type)
    : defaultAttributes(d);
  if (attrs.length && !hidden.has('minecraft:attribute_modifiers')) {
    const bySlot = new Map<string, AttributeSpec[]>();
    for (const a of attrs) bySlot.set(a.slot || 'any', [...(bySlot.get(a.slot || 'any') ?? []), a]);
    for (const [slot, list] of bySlot) {
      lines.push([{ text: '' }]);
      lines.push([{ text: L(SLOT_KEYS[slot] ?? '', SLOT_FALLBACK[slot] ?? slot), color: 'gray' }]);
      for (const a of list) {
        const attrKey = shortId(normalizeAttribute(a.type, version));
        const name = L(`attribute.name.${attrKey}`, L(`attribute.name.generic.${attrKey}`, humanizeId(attrKey)));
        const pct = a.operation !== 'add_value';
        let amount = pct ? a.amount * 100 : a.amount;
        const base = /base_attack_(damage|speed)/.test(a.id ?? '') && slot === 'mainhand';
        if (base) {
          // Base modifiers are shown as totals (player base 1 damage / 4 speed), dark green with a leading space
          amount += attrKey.endsWith('attack_damage') ? 1 : attrKey.endsWith('attack_speed') ? 4 : 0;
          lines.push([{ text: ` ${formatTranslation(L('attribute.modifier.equals.0', '%s %s'), [fmtAmount(amount), name])}`, color: 'dark_green' }]);
          continue;
        }
        const neg = amount < 0;
        const key = `attribute.modifier.${neg ? 'take' : 'plus'}.${pct ? 1 : 0}`;
        const fb = neg ? (pct ? '-%s%% %s' : '-%s %s') : pct ? '+%s%% %s' : '+%s %s';
        lines.push([{ text: formatTranslation(L(key, fb), [fmtAmount(Math.abs(amount)), name]), color: neg ? 'red' : 'blue' }]);
      }
    }
  }

  if (spec.unbreakable && !hidden.has('minecraft:unbreakable')) lines.push([{ text: L('item.unbreakable', 'Unbreakable'), color: 'blue' }]);

  if (opts.advanced) {
    const maxDamage = spec.maxDamage ?? (typeof d['minecraft:max_damage'] === 'number' ? d['minecraft:max_damage'] : undefined);
    if (maxDamage && !spec.unbreakable) {
      const left = maxDamage - (spec.damage ?? 0);
      lines.push([{ text: formatTranslation(L('item.durability', 'Durability: %s / %s'), [String(left), String(maxDamage)]), color: 'white' }]);
    }
    lines.push([{ text: fullId(spec.id), color: 'dark_gray' }]);
    const n = Object.keys(buildComponents(spec, version).components).length;
    if (n) lines.push([{ text: formatTranslation(L('item.components', '%s component(s)'), [String(n)]), color: 'dark_gray' }]);
  }
  return lines;
}

function stripNs(s: unknown): string | undefined {
  return typeof s === 'string' ? s.replace(/^minecraft:/, '') : undefined;
}

function defaultAttributes(d: Record<string, any>): AttributeSpec[] {
  const raw = d['minecraft:attribute_modifiers'];
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.modifiers) ? raw.modifiers : [];
  return list.map((m: any) => ({ type: m.type, amount: Number(m.amount ?? 0), operation: m.operation ?? 'add_value', slot: m.slot ?? 'any', id: m.id }));
}

/** Resolve a colour name or #rrggbb for CSS (re-exported for the UI). */
export { cssColor, MC_COLORS };

/** "#ff0000" / "ff0000" -> 16711680; invalid -> undefined. */
export function parseHexColor(s: string): number | undefined {
  const m = /^#?([0-9a-f]{6})$/i.exec(s.trim());
  return m ? parseInt(m[1], 16) : undefined;
}

export function hexColor(n: number): string {
  return `#${(Math.round(n) & 0xffffff).toString(16).padStart(6, '0')}`;
}
