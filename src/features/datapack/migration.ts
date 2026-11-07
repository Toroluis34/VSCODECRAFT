// Version migration planner for data packs / resource packs / mod resources. Pure module (unit tested).
//
// Every rule was checked against real data: vanilla files of misode/mcmeta (<version>-data / -summary branches,
// e.g. loot_table/blocks/wheat.json 1.21.11 vs 26.3), the registries diff 1.21.1 → 26.3, the SpyglassMC
// vanilla-mcdoc definitions and misode/technical-changes. Changes that cannot be converted mechanically
// are reported as notes ("manual review") instead of being guessed.
import * as jsonc from 'jsonc-parser';
import { compareVersions, LEGACY_FOLDER_RENAMES } from '../../core/versions';

export interface MigrationFile {
  /** Path relative to the resource root (folder containing data/ and assets/), forward slashes. */
  path: string;
  /** Text content for .json / .mcfunction files (undefined for binaries or unreadable files). */
  text?: string;
}

/** A translatable message: English template with {0} placeholders + args. */
export interface Msg {
  msg: string;
  args: string[];
}

export interface MigrationRule {
  id: string;
  /** First version where the new format applies. Rule applies when from < since <= to. */
  since: string;
  /** English title (translated by the host). */
  title: string;
  rename?: (path: string) => string | undefined;
  json?: (value: any, ctx: RuleContext) => any;
  text?: (text: string, ctx: RuleContext) => string;
  create?: (files: Map<string, MigrationFile>, ctx: { notes: { path: string; note: Msg }[] }) => { path: string; text: string; source: string }[];
}

export interface RuleContext {
  path: string;
  /** Normalized kind of the file ("loot_table", "tags/block", "worldgen/configured_feature", "models"...). */
  kind: string;
  side: 'data' | 'assets' | '';
  namespace?: string;
  notes: Msg[];
  changed?: boolean;
}

export type PlannedAction =
  | { type: 'rename'; rule: string; path: string; newPath: string }
  | { type: 'edit'; rule: string; path: string }
  | { type: 'create'; rule: string; path: string; text: string; source: string }
  | { type: 'note'; rule: string; path: string; note: Msg };

// ------------------------------------------------------------------ helpers

const bare = (id: unknown): string => (typeof id === 'string' ? id.replace(/^minecraft:/, '') : '');
const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const note = (msg: string, ...args: string[]): Msg => ({ msg, args });

/** Bottom-up transform of a JSON value. `fn` receives each node after its children were transformed. */
export function walk(value: any, fn: (node: any, key: string | number | undefined, parent: any) => any, key?: string | number, parent?: any): any {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) value[i] = walk(value[i], fn, i, value);
  } else if (isObj(value)) {
    for (const k of Object.keys(value)) value[k] = walk(value[k], fn, k, value);
  }
  return fn(value, key, parent);
}

/** Rebuild an object renaming keys while keeping their position. */
export function renameKeys(obj: Record<string, any>, map: Record<string, string>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) out[map[k] ?? k] = v;
  return out;
}

/** Object with `type` first (Minecraft's usual order). */
function typeFirst(type: string, rest: Record<string, any>): Record<string, any> {
  return { type, ...rest };
}

/** Split a resource path into side / namespace / normalized kind. */
export function describePath(path: string): { side: 'data' | 'assets' | ''; namespace: string; kind: string; rest: string } {
  const parts = path.split('/');
  if (parts.length < 4 || (parts[0] !== 'data' && parts[0] !== 'assets')) return { side: '', namespace: '', kind: '', rest: '' };
  const side = parts[0] as 'data' | 'assets';
  let n = 1;
  if ((parts[2] === 'tags' || parts[2] === 'worldgen') && parts.length > 4) n = 2;
  if (parts[2] === 'tags' && parts[3] === 'worldgen' && parts.length > 5) n = 3;
  const folder = parts.slice(2, 2 + n).join('/');
  return { side, namespace: parts[1], kind: LEGACY_FOLDER_RENAMES[folder] ?? folder, rest: parts.slice(2 + n).join('/') };
}

/** Visit every component map ("components" objects) in a JSON tree. */
function forEachComponents(root: any, fn: (components: Record<string, any>) => void): void {
  walk(root, (node) => {
    if (isObj(node) && isObj(node.components)) fn(node.components);
    return node;
  });
}

/** Get/set a component by id with or without the "minecraft:" prefix. */
function compKey(components: Record<string, any>, id: string): string | undefined {
  if (`minecraft:${id}` in components) return `minecraft:${id}`;
  if (id in components) return id;
  return undefined;
}

function setChanged(ctx: RuleContext): void {
  ctx.changed = true;
}

const isData = (ctx: RuleContext) => ctx.side === 'data';
const isTagFile = (ctx: RuleContext) => ctx.kind.startsWith('tags/');

// ------------------------------------------------------------------ data tables (verified)

/** 1.21.2: attribute ids lost their generic./player./zombie. prefix (registries 1.21.1 vs 26.3). */
const OLD_ATTRIBUTES = [
  'generic.armor', 'generic.armor_toughness', 'generic.attack_damage', 'generic.attack_knockback', 'generic.attack_speed',
  'generic.burning_time', 'generic.explosion_knockback_resistance', 'generic.fall_damage_multiplier', 'generic.flying_speed',
  'generic.follow_range', 'generic.gravity', 'generic.jump_strength', 'generic.knockback_resistance', 'generic.luck',
  'generic.max_absorption', 'generic.max_health', 'generic.movement_efficiency', 'generic.movement_speed', 'generic.oxygen_bonus',
  'generic.safe_fall_distance', 'generic.scale', 'generic.step_height', 'generic.water_movement_efficiency',
  'player.block_break_speed', 'player.block_interaction_range', 'player.entity_interaction_range', 'player.mining_efficiency',
  'player.sneaking_speed', 'player.submerged_mining_speed', 'player.sweeping_damage_ratio', 'zombie.spawn_reinforcements',
];
const ATTRIBUTE_RE = new RegExp(`(?<![\\w.])(minecraft:)?(${OLD_ATTRIBUTES.map((a) => a.replace('.', '\\.')).join('|')})(?![\\w.])`, 'g');

/** Tag renames: verified by diffing vanilla tag registries (1.21.1 / 1.21.11 / 26.3). */
export const TAG_RENAMES: { since: string; registry: string; from: string; to: string }[] = [
  { since: '1.21.5', registry: 'block', from: 'dead_bush_may_place_on', to: 'dry_vegetation_may_place_on' },
  { since: '1.21.6', registry: 'block', from: 'plays_ambient_desert_block_sounds', to: 'triggers_ambient_desert_sand_block_sounds' },
  { since: '1.21.11', registry: 'item', from: 'enchantable/sword', to: 'enchantable/sweeping' },
  { since: '26.1', registry: 'block', from: 'dry_vegetation_may_place_on', to: 'supports_dry_vegetation' },
  { since: '26.1', registry: 'block', from: 'bamboo_plantable_on', to: 'supports_bamboo' },
  { since: '26.1', registry: 'block', from: 'small_dripleaf_placeable', to: 'supports_small_dripleaf' },
  { since: '26.1', registry: 'block', from: 'big_dripleaf_placeable', to: 'supports_big_dripleaf' },
  { since: '26.1', registry: 'block', from: 'mushroom_grow_block', to: 'overrides_mushroom_light_requirement' },
  { since: '26.1', registry: 'block', from: 'snow_layer_can_survive_on', to: 'support_override_snow_layer' },
  { since: '26.1', registry: 'block', from: 'snow_layer_cannot_survive_on', to: 'cannot_support_snow_layer' },
  { since: '26.2', registry: 'block', from: 'concrete_powder', to: 'concrete_powders' },
  { since: '26.3', registry: 'worldgen/structure', from: 'on_woodland_explorer_maps', to: 'on_woodland_mansion_maps' },
  { since: '26.3', registry: 'worldgen/structure', from: 'on_ocean_explorer_maps', to: 'on_ocean_monument_maps' },
  { since: '26.3', registry: 'worldgen/structure', from: 'on_jungle_explorer_maps', to: 'on_jungle_pyramid_maps' },
  { since: '26.3', registry: 'worldgen/structure', from: 'on_swamp_explorer_maps', to: 'on_swamp_hut_maps' },
  { since: '26.3', registry: 'worldgen/structure', from: 'on_trial_chambers_maps', to: 'on_buried_trial_chambers_maps' },
];

/** Vanilla tags removed without replacement (reported). */
export const REMOVED_TAGS: { since: string; registry: string; id: string }[] = [
  { since: '1.21.4', registry: 'item', id: 'flowers' },
  { since: '1.21.4', registry: 'item', id: 'tall_flowers' },
  { since: '1.21.4', registry: 'block', id: 'tall_flowers' },
  { since: '1.21.4', registry: 'item', id: 'trim_templates' },
  { since: '26.1', registry: 'item', id: 'dyeable' },
  { since: '26.3', registry: 'item', id: 'brewing_fuel' },
  { since: '26.3', registry: 'block', id: 'overworld_carver_replaceables' },
  { since: '26.3', registry: 'block', id: 'nether_carver_replaceables' },
];

/** 1.21.11: game rules became snake_case resource locations. Explicit renames from the changelog. */
export const GAMERULE_RENAMES: Record<string, string> = {
  announceAdvancements: 'show_advancement_messages',
  commandBlocksEnabled: 'command_blocks_work',
  commandModificationBlockLimit: 'max_block_modifications',
  disableElytraMovementCheck: 'elytra_movement_check',
  disablePlayerMovementCheck: 'player_movement_check',
  disableRaids: 'raids',
  doDaylightCycle: 'advance_time',
  doEntityDrops: 'entity_drops',
  doImmediateRespawn: 'immediate_respawn',
  doInsomnia: 'spawn_phantoms',
  doLimitedCrafting: 'limited_crafting',
  doMobLoot: 'mob_drops',
  doMobSpawning: 'spawn_mobs',
  doPatrolSpawning: 'spawn_patrols',
  doTileDrops: 'block_drops',
  doTraderSpawning: 'spawn_wandering_traders',
  doVinesSpread: 'spread_vines',
  doWardenSpawning: 'spawn_wardens',
  doWeatherCycle: 'advance_weather',
  maxCommandChainLength: 'max_command_sequence_length',
  maxCommandForkCount: 'max_command_forks',
  naturalRegeneration: 'natural_health_regeneration',
  snowAccumulationHeight: 'max_snow_accumulation_height',
  spawnRadius: 'respawn_radius',
  spawnerBlocksEnabled: 'spawner_blocks_work',
  minecartMaxSpeed: 'max_minecart_speed',
};
const GAMERULE_INVERTED = new Set(['disableElytraMovementCheck', 'disablePlayerMovementCheck', 'disableRaids']);
const GAMERULE_REMOVED = new Set(['doFireTick', 'allowFireTicksAwayFromPlayer', 'spawnChunkRadius']);

export function migrateGameruleName(name: string): string {
  return GAMERULE_RENAMES[name] ?? name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

const LOOT_CONDITIONS = new Set([
  'all_of', 'any_of', 'alternative', 'block_state_property', 'damage_source_properties', 'enchantment_active_check', 'entity_properties',
  'entity_scores', 'inverted', 'killed_by_player', 'location_check', 'match_tool', 'random_chance', 'random_chance_with_enchanted_bonus',
  'reference', 'survives_explosion', 'table_bonus', 'time_check', 'value_check', 'weather_check',
]);
const LOOT_FUNCTIONS = new Set([
  'apply_bonus', 'copy_components', 'copy_custom_data', 'copy_name', 'copy_state', 'discard', 'enchant_randomly', 'enchant_with_levels',
  'enchanted_count_increase', 'exploration_map', 'explosion_decay', 'fill_player_head', 'filtered', 'furnace_smelt', 'limit_count',
  'modify_contents', 'reference', 'sequence', 'set_attributes', 'set_banner_pattern', 'set_book_cover', 'set_components', 'set_contents',
  'set_count', 'set_custom_data', 'set_custom_model_data', 'set_damage', 'set_enchantments', 'set_firework_explosion', 'set_fireworks',
  'set_instrument', 'set_item', 'set_loot_table', 'set_lore', 'set_name', 'set_ominous_bottle_amplifier', 'set_potion', 'set_stew_effect',
  'set_writable_book_pages', 'set_written_book_pages', 'toggle_tooltips',
]);

const OLD_ENTITY_PREDICATE_KEYS = new Set([
  'type', 'nbt', 'flags', 'equipment', 'location', 'stepping_on', 'movement_affected_by', 'effects', 'distance', 'movement',
  'periodic_tick', 'vehicle', 'passenger', 'targeted_entity', 'team', 'slots', 'components', 'predicates', 'type_specific',
]);
/** type_specific sub-predicates that still exist in 26.2+ (slime was renamed cube_mob). */
const TYPE_SPECIFIC_MAP: Record<string, string> = {
  player: 'player', fishing_hook: 'fishing_hook', lightning: 'lightning', raider: 'raider', sheep: 'sheep', slime: 'cube_mob',
};
/** Advancement trigger fields that take a "context aware predicate" (entity predicate or list of loot conditions). */
const CONTEXT_PREDICATE_FIELDS = new Set([
  'player', 'entity', 'victim', 'parent', 'partner', 'child', 'villager', 'zombie', 'projectile', 'shooter', 'lightning', 'bystander', 'cause',
]);

// ------------------------------------------------------------------ rule implementations

function legacyFolderRename(path: string): string | undefined {
  const parts = path.split('/');
  if (parts[0] !== 'data' || parts.length < 4) return undefined;
  const two = `${parts[2]}/${parts[3]}`;
  if (parts[2] === 'tags' && LEGACY_FOLDER_RENAMES[two]) {
    const [a, b] = LEGACY_FOLDER_RENAMES[two].split('/');
    return [parts[0], parts[1], a, b, ...parts.slice(4)].join('/');
  }
  if (LEGACY_FOLDER_RENAMES[parts[2]]) return [parts[0], parts[1], LEGACY_FOLDER_RENAMES[parts[2]], ...parts.slice(3)].join('/');
  return undefined;
}

/** Rename "#old" references to a tag (with or without namespace) inside a JSON tree. */
function renameTagRefs(value: any, renames: { from: string; to: string }[], ctx: RuleContext): any {
  const map = new Map<string, string>();
  for (const r of renames) {
    map.set(`#minecraft:${r.from}`, `#minecraft:${r.to}`);
    map.set(`#${r.from}`, `#${r.to}`);
  }
  return walk(value, (node) => {
    if (typeof node === 'string' && map.has(node)) {
      setChanged(ctx);
      return map.get(node);
    }
    return node;
  });
}

function tagRule(since: string): MigrationRule {
  const renames = TAG_RENAMES.filter((r) => r.since === since);
  const removed = REMOVED_TAGS.filter((r) => r.since === since);
  return {
    id: `tags-${since}`,
    since,
    title: 'Renamed vanilla tags ({0})',
    rename: (path) => {
      const d = describePath(path);
      if (d.side !== 'data' || d.namespace !== 'minecraft') return undefined;
      for (const r of renames) {
        if (d.kind === `tags/${r.registry}` && d.rest === `${r.from}.json`) return path.slice(0, path.length - d.rest.length) + `${r.to}.json`;
      }
      return undefined;
    },
    json: (value, ctx) => {
      if (!isData(ctx)) return value;
      for (const r of removed) {
        if (ctx.namespace === 'minecraft' && ctx.kind === `tags/${r.registry}` && describePath(ctx.path).rest === `${r.id}.json`) {
          ctx.notes.push(note('Vanilla tag #{0} no longer exists in this version; this file has no effect.', `minecraft:${r.id}`));
        }
      }
      const text = JSON.stringify(value);
      for (const r of removed) {
        if (text.includes(`"#minecraft:${r.id}"`) || text.includes(`"#${r.id}"`)) {
          ctx.notes.push(note('References removed vanilla tag #{0}.', `minecraft:${r.id}`));
        }
      }
      return renames.length ? renameTagRefs(value, renames, ctx) : value;
    },
    text: (text, ctx) => {
      let out = text;
      for (const r of renames) {
        const re = new RegExp(`#(minecraft:)?${r.from.replace(/[/.]/g, (c) => '\\' + c)}(?![\\w/.-])`, 'g');
        out = out.replace(re, (_m, ns) => `#${ns ?? ''}${r.to}`);
      }
      if (out !== text) setChanged(ctx);
      return out;
    },
  };
}

/** 1.21.5 text components: hoverEvent/clickEvent → hover_event/click_event with inlined fields. */
export function migrateTextEvents(node: Record<string, any>): Record<string, any> {
  let out = node;
  if (isObj(node.hoverEvent)) {
    const h = node.hoverEvent;
    const action = bare(h.action);
    const ev: Record<string, any> = { action: h.action };
    const contents = h.contents ?? h.value;
    if (action === 'show_text') ev.value = contents;
    else if (action === 'show_item') {
      if (typeof contents === 'string') ev.id = contents;
      else if (isObj(contents)) Object.assign(ev, contents);
    } else if (action === 'show_entity' && isObj(contents)) {
      if (contents.type !== undefined) ev.id = contents.type;
      if (contents.id !== undefined) ev.uuid = contents.id;
      if (contents.name !== undefined) ev.name = contents.name;
    } else Object.assign(ev, h);
    out = renameKeys(out, { hoverEvent: 'hover_event' });
    out.hover_event = ev;
  }
  if (isObj(node.clickEvent)) {
    const c = node.clickEvent;
    const action = bare(c.action);
    const ev: Record<string, any> = { action: c.action };
    const field =
      action === 'open_url' ? 'url' : action === 'run_command' || action === 'suggest_command' ? 'command' : action === 'change_page' ? 'page' : action === 'open_file' ? 'path' : 'value';
    if (c.value !== undefined) ev[field] = field === 'page' ? Number(c.value) || 1 : c.value;
    out = renameKeys(out, { clickEvent: 'click_event' });
    out.click_event = ev;
  }
  return out;
}

/** 1.21.5 component format simplifications + tooltip_display. Mutates the component map. Returns notes. */
export function migrateComponents1215(components: Record<string, any>): { changed: boolean; notes: Msg[] } {
  let changed = false;
  const notes: Msg[] = [];
  const hidden: string[] = [];
  let hideTooltip = false;
  const withShow = ['attribute_modifiers', 'dyed_color', 'can_place_on', 'can_break', 'enchantments', 'stored_enchantments', 'jukebox_playable', 'trim', 'unbreakable'];
  for (const id of withShow) {
    const k = compKey(components, id);
    if (!k || !isObj(components[k])) continue;
    const v = components[k];
    if ('show_in_tooltip' in v) {
      if (v.show_in_tooltip === false) hidden.push(`minecraft:${id}`);
      delete v.show_in_tooltip;
      changed = true;
    }
    // Inlined formats (vanilla 1.21.1 vs 26.3 item_components summary / vanilla-mcdoc)
    if ((id === 'enchantments' || id === 'stored_enchantments') && isObj(v.levels) && Object.keys(v).length === 1) {
      components[k] = v.levels;
      changed = true;
    } else if (id === 'attribute_modifiers' && Array.isArray(v.modifiers) && Object.keys(v).length === 1) {
      components[k] = v.modifiers;
      changed = true;
    } else if (id === 'dyed_color' && typeof v.rgb === 'number' && Object.keys(v).length === 1) {
      components[k] = v.rgb;
      changed = true;
    } else if ((id === 'can_place_on' || id === 'can_break') && Array.isArray(v.predicates) && Object.keys(v).length === 1) {
      components[k] = v.predicates;
      changed = true;
    } else if (id === 'jukebox_playable' && typeof v.song === 'string' && Object.keys(v).length === 1) {
      components[k] = v.song;
      changed = true;
    }
  }
  const ht = compKey(components, 'hide_tooltip');
  if (ht) {
    delete components[ht];
    hideTooltip = true;
    changed = true;
  }
  const hat = compKey(components, 'hide_additional_tooltip');
  if (hat) {
    delete components[hat];
    changed = true;
    notes.push(note('Removed component hide_additional_tooltip: list the components to hide in minecraft:tooltip_display "hidden_components".'));
  }
  // item_name / custom_name / lore were JSON text in strings; since 1.21.5 they are text components.
  for (const id of ['item_name', 'custom_name']) {
    const k = compKey(components, id);
    if (k && typeof components[k] === 'string') {
      const parsed = tryParseText(components[k]);
      if (parsed !== undefined) {
        components[k] = parsed;
        changed = true;
      }
    }
  }
  const lk = compKey(components, 'lore');
  if (lk && Array.isArray(components[lk])) {
    components[lk] = components[lk].map((l: unknown) => {
      const p = typeof l === 'string' ? tryParseText(l) : undefined;
      if (p !== undefined) changed = true;
      return p ?? l;
    });
  }
  if (hidden.length || hideTooltip) {
    const tk = compKey(components, 'tooltip_display') ?? 'minecraft:tooltip_display';
    const td = isObj(components[tk]) ? components[tk] : {};
    if (hideTooltip) td.hide_tooltip = true;
    if (hidden.length) td.hidden_components = [...new Set([...(td.hidden_components ?? []), ...hidden])];
    components[tk] = td;
  }
  return { changed, notes };
}

function tryParseText(s: string): unknown {
  const t = s.trim();
  if (!/^[[{"]/.test(t)) return undefined;
  try {
    return JSON.parse(t);
  } catch {
    return undefined;
  }
}

function isOldEntityPredicate(v: unknown): v is Record<string, any> {
  if (!isObj(v)) return false;
  const keys = Object.keys(v);
  return keys.length > 0 && !('condition' in v) && keys.every((k) => OLD_ENTITY_PREDICATE_KEYS.has(k));
}

/** 26.2: entity predicates became a map of namespaced sub-predicates ("minecraft:equipment", "minecraft:entity_type"...). */
export function migrateEntityPredicate(p: Record<string, any>, notes: Msg[]): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v0] of Object.entries(p)) {
    let v = v0;
    if (['vehicle', 'passenger', 'targeted_entity'].includes(k) && isOldEntityPredicate(v)) v = migrateEntityPredicate(v, notes);
    if (k === 'type') out['minecraft:entity_type'] = v;
    else if (k === 'type_specific' && isObj(v)) {
      const t = bare(v.type);
      const mapped = TYPE_SPECIFIC_MAP[t];
      const { type: _t, ...rest } = v;
      for (const sub of ['entity_struck', 'looking_at']) if (isOldEntityPredicate(rest[sub])) rest[sub] = migrateEntityPredicate(rest[sub], notes);
      if (mapped) out[`minecraft:type_specific/${mapped}`] = rest;
      else {
        out['minecraft:type_specific/' + t] = rest;
        notes.push(note('Entity sub-predicate "{0}" no longer exists; use the entity "components" predicate instead.', t));
      }
    } else out[`minecraft:${k}`] = v;
  }
  return out;
}

/** 26.2: context-aware predicate (advancement trigger field): entity predicate shorthand / list → single condition. */
function migrateContextPredicate(v: any, notes: Msg[]): any {
  if (Array.isArray(v)) {
    if (v.length === 0) return undefined;
    if (v.length === 1) return v[0];
    return { condition: 'minecraft:all_of', terms: v };
  }
  if (isObj(v) && !('condition' in v) && !('type' in v && LOOT_CONDITIONS.has(bare(v.type)))) {
    const pred = isOldEntityPredicate(v) ? migrateEntityPredicate(v, notes) : v;
    return { condition: 'minecraft:entity_properties', entity: 'this', predicate: pred };
  }
  return v;
}

// Only vanilla loot conditions / functions: Forge/NeoForge recipe "conditions" ({type: "forge:mod_loaded"}) must stay untouched.
const isCondition = (v: unknown) =>
  typeof v === 'string' || (isObj(v) && (LOOT_CONDITIONS.has(bare(v.type ?? v.condition)) || bare(v.type) === 'match_block'));
const isFunction = (v: unknown) => typeof v === 'string' || (isObj(v) && LOOT_FUNCTIONS.has(bare(v.type ?? v.function)));

function ensureNumberProviderType(v: any): any {
  if (isObj(v) && v.type === undefined && v.min !== undefined && v.max !== undefined) return typeFirst('minecraft:uniform', v);
  if (isObj(v) && v.type === undefined && v.n !== undefined && v.p !== undefined) return typeFirst('minecraft:binomial', v);
  return v;
}

/** 26.3 loot format: condition/function → type, conditions/functions → condition/modifier, reference → id string ... */
export function migrateLoot263(value: any, ctx: RuleContext): any {
  const lootish = ctx.kind === 'loot_table' || ctx.kind === 'item_modifier';
  let v = walk(value, (node) => {
    if (!isObj(node)) return node;
    let n = node;
    // Loot condition objects
    if (typeof n.condition === 'string' && n.type === undefined && LOOT_CONDITIONS.has(bare(n.condition))) {
      const t = bare(n.condition);
      setChanged(ctx);
      if (t === 'reference' && typeof n.name === 'string') return n.name;
      if (t === 'block_state_property') {
        const { condition: _c, block, properties, ...rest } = n;
        const out: Record<string, any> = { type: 'minecraft:match_block', blocks: block };
        if (properties !== undefined) out.state = properties;
        return { ...out, ...rest };
      }
      if (t === 'value_check') ctx.notes.push(note('Loot condition value_check was replaced by int_value_check / float_value_check: choose the right one.'));
      const { condition, ...rest } = n;
      n = typeFirst(condition, rest);
    }
    // Loot function objects
    if (typeof n.function === 'string' && n.type === undefined && LOOT_FUNCTIONS.has(bare(n.function))) {
      setChanged(ctx);
      if (bare(n.function) === 'reference' && typeof n.name === 'string') return n.name;
      const { function: fn, ...rest } = n;
      n = typeFirst(fn, rest);
    }
    // conditions: [...] → condition
    if (Array.isArray(n.conditions) && n.condition === undefined && n.conditions.every(isCondition)) {
      const list = n.conditions;
      const single = list.length === 1 ? list[0] : { type: 'minecraft:all_of', terms: list };
      n = renameKeys(n, { conditions: 'condition' });
      if (list.length === 0) delete n.condition;
      else n.condition = single;
      setChanged(ctx);
    }
    // functions: [...] → modifier (single function or sequence short form)
    if (Array.isArray(n.functions) && n.modifier === undefined && n.functions.every(isFunction)) {
      const list = n.functions;
      n = renameKeys(n, { functions: 'modifier' });
      if (list.length === 0) delete n.modifier;
      else n.modifier = list.length === 1 ? list[0] : list;
      setChanged(ctx);
    }
    if (lootish) {
      // tag entries: name → items
      if (bare(n.type) === 'tag' && typeof n.name === 'string' && 'expand' in n) {
        n = renameKeys(n, { name: 'items' });
        setChanged(ctx);
      }
      for (const k of ['rolls', 'bonus_rolls']) {
        const nv = ensureNumberProviderType(n[k]);
        if (nv !== n[k]) {
          n[k] = nv;
          setChanged(ctx);
        }
      }
      if (['set_count', 'set_damage', 'enchant_with_levels'].includes(bare(n.type))) {
        for (const k of ['count', 'damage', 'levels']) {
          const nv = ensureNumberProviderType(n[k]);
          if (nv !== n[k]) {
            n[k] = nv;
            setChanged(ctx);
          }
        }
      }
    }
    return n;
  });
  // Predicate files: list short form → all_of
  if (ctx.kind === 'predicate' && Array.isArray(v)) {
    v = v.length === 1 ? v[0] : { type: 'minecraft:all_of', terms: v };
    setChanged(ctx);
  }
  return v;
}

// --- worldgen 26.x

const BLOCK_STATE_PROVIDER_RENAMES: Record<string, string> = {
  copy_properties_provider: 'copy_properties',
  dual_noise_provider: 'dual_noise',
  noise_provider: 'noise',
  noise_threshold_provider: 'noise_threshold',
  randomized_int_state_provider: 'randomized_int',
  rule_based_state_provider: 'rule_based',
  simple_state_provider: 'simple',
  weighted_state_provider: 'weighted',
  random_block_provider: 'random_block',
  rotated_block_provider: 'rotated',
};
const DF_INPUT = ['abs', 'square', 'cube', 'half_negative', 'quarter_negative', 'squeeze', 'interpolated', 'flat_cache', 'cache_2d', 'cache_once', 'cache_all_in_cell', 'blend_density'];
const DF_REMOVED_CACHES = new Set(['flat_cache', 'cache_2d', 'cache_all_in_cell']);

/** Keep the "minecraft:" prefix style of the original id. */
const sameStyle = (orig: string, newBare: string) => (orig.startsWith('minecraft:') ? `minecraft:${newBare}` : newBare);

export function migrateDensityFunction(n: Record<string, any>, notes: Msg[]): Record<string, any> {
  const t = bare(n.type);
  let out = n;
  if (t === 'constant' && 'argument' in n) out = renameKeys(out, { argument: 'value' });
  if (['add', 'mul', 'min', 'max'].includes(t) && ('argument1' in n || 'argument2' in n)) out = renameKeys(out, { argument1: 'left', argument2: 'right' });
  if (DF_INPUT.includes(t) && 'argument' in n) out = renameKeys(out, { argument: 'input' });
  if (['shift_a', 'shift_b', 'shift'].includes(t) && 'argument' in n) out = renameKeys(out, { argument: 'noise' });
  if (t === 'invert') out = { ...out, type: sameStyle(n.type, 'reciprocal') };
  if (t === 'cache_once') out = { ...out, type: sameStyle(n.type, 'cache') };
  if (DF_REMOVED_CACHES.has(t)) {
    out = { ...out, type: sameStyle(n.type, 'cache') };
    notes.push(note('Density function {0} was removed; replaced with "cache" (same values, different caching).', t));
  }
  if (t === 'end_islands') {
    out = { ...out, type: sameStyle(n.type, 'end_outer_islands') };
    notes.push(note('Density function end_islands is now end_outer_islands and no longer includes the main island.'));
  }
  if (t === 'shifted_noise') out = { ...out, type: sameStyle(n.type, 'noise') };
  if (t === 'y_clamped_gradient') {
    const { type, from_y, to_y, from_value, to_value, ...rest } = out;
    out = { type: sameStyle(type, 'gradient'), axis: 'y', from_coordinate: from_y, from_value, to_coordinate: to_y, to_value, ...rest };
  }
  if (t === 'weird_scaled_sampler') notes.push(note('Density function weird_scaled_sampler was removed; use interval_select instead.'));
  return out;
}

function migrateWorldgen263(value: any, ctx: RuleContext): any {
  if (!isData(ctx) || !ctx.kind.startsWith('worldgen/')) return value;
  const before = JSON.stringify(value);
  const isFeature = ctx.kind === 'worldgen/configured_feature' || ctx.kind === 'worldgen/placed_feature' || ctx.kind === 'worldgen/configured_carver';
  let v = walk(value, (node) => {
    if (!isObj(node)) return node;
    let n = node;
    // Inline configured feature / carver config: {type, config: {...}} → {type, ...}
    if (isFeature && typeof n.type === 'string' && isObj(n.config) && Object.keys(n).every((k) => k === 'type' || k === 'config')) {
      n = { type: n.type, ...n.config };
    }
    if (typeof n.type === 'string') {
      const t = bare(n.type);
      if (BLOCK_STATE_PROVIDER_RENAMES[t]) n = { ...n, type: sameStyle(n.type, BLOCK_STATE_PROVIDER_RENAMES[t]) };
      if (ctx.kind === 'worldgen/density_function' || ctx.kind === 'worldgen/noise_settings') n = migrateDensityFunction(n, ctx.notes);
      if (isFeature && ['basalt_columns', 'basalt_pillar', 'glowstone_blob', 'random_offset', 'coral_mushroom', 'kelp', 'seagrass', 'sea_pickle', 'nether_forest_vegetation', 'twisting_vines', 'weeping_vines', 'desert_well'].includes(t)) {
        ctx.notes.push(note('Feature type {0} was renamed or removed in 26.3 with new fields; update it manually.', t));
      }
    }
    return n;
  });
  if (ctx.kind === 'worldgen/noise_settings' && isObj(v) && 'surface_rule' in v) v = renameKeys(v, { surface_rule: 'material_rule' });
  if (ctx.kind === 'worldgen/noise_settings' && isObj(v) && ('aquifers_enabled' in v || 'ore_veins_enabled' in v)) {
    ctx.notes.push(note('Noise settings: aquifers_enabled / ore_veins_enabled were replaced by "aquifers" / "ore_vein" objects.'));
  }
  if (ctx.kind === 'worldgen/biome' && isObj(v) && ('spawners' in v || 'spawn_costs' in v)) {
    ctx.notes.push(note('Biome spawners / spawn_costs moved to the gameplay/natural_mob_spawns environment attribute.'));
  }
  if (JSON.stringify(v) !== before) setChanged(ctx);
  return v;
}

function featureTypeRule(since: string, renames: Record<string, string>): MigrationRule {
  return {
    id: `feature-types-${since}`,
    since,
    title: 'Renamed worldgen feature types ({0})',
    json: (value, ctx) => {
      if (ctx.kind !== 'worldgen/configured_feature' && ctx.kind !== 'worldgen/placed_feature') return value;
      return walk(value, (n) => {
        if (isObj(n) && typeof n.type === 'string' && renames[bare(n.type)]) {
          setChanged(ctx);
          return { ...n, type: sameStyle(n.type, renames[bare(n.type)]) };
        }
        return n;
      });
    },
  };
}

// --- item model definitions (1.21.4)

export function itemDefinitionFor(namespace: string, path: string, model: any): { definition: any; note?: Msg } {
  const base = { type: 'minecraft:model', model: `${namespace}:item/${path}` };
  const overrides: any[] = Array.isArray(model?.overrides) ? model.overrides : [];
  if (!overrides.length) return { definition: { model: base } };
  const cmdOnly = overrides.every((o) => isObj(o?.predicate) && Object.keys(o.predicate).length === 1 && typeof o.predicate.custom_model_data === 'number');
  if (cmdOnly) {
    const entries = overrides
      .map((o) => ({ threshold: o.predicate.custom_model_data, model: { type: 'minecraft:model', model: String(o.model) } }))
      .sort((a, b) => a.threshold - b.threshold);
    return {
      definition: {
        model: { type: 'minecraft:range_dispatch', property: 'minecraft:custom_model_data', fallback: base, entries },
      },
    };
  }
  return {
    definition: { model: base },
    note: note('Item model overrides ({0}) must be converted by hand to the items/ definition (select / condition / range_dispatch).', overrides.map((o) => Object.keys(o?.predicate ?? {}).join('+')).filter(Boolean).join(', ')),
  };
}

// ------------------------------------------------------------------ rules

export const RULES: MigrationRule[] = [
  {
    id: 'folders-singular',
    since: '1.21',
    title: 'Rename plural data folders to singular (recipes → recipe, tags/items → tags/item...)',
    rename: legacyFolderRename,
  },
  {
    id: 'attribute-ids',
    since: '1.21.2',
    title: 'Remove generic./player./zombie. prefixes from attribute ids',
    json: (value, ctx) =>
      isData(ctx)
        ? walk(value, (n) => {
            if (typeof n !== 'string' || !/(generic|player|zombie)\./.test(n)) return n;
            const r = n.replace(ATTRIBUTE_RE, (_m, ns, id) => `${ns ?? ''}${id.split('.')[1]}`);
            if (r !== n) setChanged(ctx);
            return r;
          })
        : value,
    text: (text, ctx) => {
      const r = text.replace(ATTRIBUTE_RE, (_m, ns, id) => `${ns ?? ''}${id.split('.')[1]}`);
      if (r !== text) setChanged(ctx);
      return r;
    },
  },
  {
    id: 'components-1.21.2',
    since: '1.21.2',
    title: 'Item components: fire_resistant → damage_resistant',
    json: (value, ctx) => {
      if (!isData(ctx)) return value;
      forEachComponents(value, (c) => {
        const k = compKey(c, 'fire_resistant');
        if (k) {
          const out: Record<string, any> = {};
          for (const [key, v] of Object.entries(c)) {
            if (key === k) out['minecraft:damage_resistant'] = { types: '#minecraft:is_fire' };
            else out[key] = v;
          }
          for (const key of Object.keys(c)) delete c[key];
          Object.assign(c, out);
          setChanged(ctx);
        }
        const food = compKey(c, 'food');
        if (food && isObj(c[food]) && ('eat_seconds' in c[food] || 'effects' in c[food] || 'using_converts_to' in c[food])) {
          ctx.notes.push(note('The food component no longer holds eat_seconds / effects / using_converts_to: move them to "consumable" and "use_remainder".'));
        }
      });
      return value;
    },
  },
  {
    id: 'enchantment-effects-1.21.2',
    since: '1.21.2',
    title: 'Enchantment effect damage_item → change_item_damage',
    json: (value, ctx) =>
      ctx.kind === 'enchantment'
        ? walk(value, (n) => {
            if (isObj(n) && bare(n.type) === 'damage_item') {
              setChanged(ctx);
              return { ...n, type: sameStyle(n.type, 'change_item_damage') };
            }
            return n;
          })
        : value,
  },
  {
    id: 'equipment-folder',
    since: '1.21.4',
    title: 'Move assets/<ns>/models/equipment to assets/<ns>/equipment',
    rename: (path) => {
      const m = /^assets\/([^/]+)\/models\/equipment\/(.+)$/.exec(path);
      return m ? `assets/${m[1]}/equipment/${m[2]}` : undefined;
    },
  },
  {
    id: 'components-1.21.4',
    since: '1.21.4',
    title: 'Item components: equippable model → asset_id, custom_model_data → {floats}',
    json: (value, ctx) => {
      if (!isData(ctx)) return value;
      forEachComponents(value, (c) => {
        const k = compKey(c, 'equippable');
        if (k && isObj(c[k]) && 'model' in c[k]) {
          c[k] = renameKeys(c[k], { model: 'asset_id' });
          setChanged(ctx);
        }
        const cmd = compKey(c, 'custom_model_data');
        if (cmd && typeof c[cmd] === 'number') {
          c[cmd] = { floats: [c[cmd]] };
          setChanged(ctx);
        }
      });
      return value;
    },
  },
  {
    id: 'item-definitions',
    since: '1.21.4',
    title: 'Create item model definitions (assets/<ns>/items) for item models',
    create: (files, ctx) => {
      const out: { path: string; text: string; source: string }[] = [];
      for (const f of files.values()) {
        const m = /^assets\/([^/]+)\/models\/item\/(.+)\.json$/.exec(f.path);
        if (!m) continue;
        const [, ns, p] = m;
        const target = `assets/${ns}/items/${p}.json`;
        if (files.has(target)) continue;
        let model: any;
        try {
          model = f.text ? jsonc.parse(f.text) : undefined;
        } catch {
          model = undefined;
        }
        // Vanilla already has definitions for its items: only override them when the model adds overrides.
        if (ns === 'minecraft' && !(Array.isArray(model?.overrides) && model.overrides.length)) continue;
        const { definition, note: n } = itemDefinitionFor(ns, p, model);
        if (n) ctx.notes.push({ path: f.path, note: n });
        out.push({ path: target, text: JSON.stringify(definition, null, 2) + '\n', source: f.path });
      }
      return out;
    },
  },
  tagRule('1.21.4'),
  {
    id: 'text-components-1.21.5',
    since: '1.21.5',
    title: 'Text components: hoverEvent/clickEvent → hover_event/click_event',
    json: (value, ctx) =>
      isData(ctx)
        ? walk(value, (n) => {
            if (isObj(n) && (isObj(n.hoverEvent) || isObj(n.clickEvent))) {
              setChanged(ctx);
              return migrateTextEvents(n);
            }
            return n;
          })
        : value,
  },
  {
    id: 'components-1.21.5',
    since: '1.21.5',
    title: 'Item components: inline formats, show_in_tooltip/hide_tooltip → tooltip_display, text as JSON',
    json: (value, ctx) => {
      if (!isData(ctx)) return value;
      forEachComponents(value, (c) => {
        const r = migrateComponents1215(c);
        if (r.changed) setChanged(ctx);
        ctx.notes.push(...r.notes);
      });
      return value;
    },
  },
  tagRule('1.21.5'),
  tagRule('1.21.6'),
  {
    id: 'components-1.21.11',
    since: '1.21.11',
    title: 'Item components: consumable animation "spear" → "trident"',
    json: (value, ctx) => {
      if (!isData(ctx)) return value;
      forEachComponents(value, (c) => {
        const k = compKey(c, 'consumable');
        if (k && isObj(c[k]) && c[k].animation === 'spear') {
          c[k].animation = 'trident';
          setChanged(ctx);
        }
      });
      return value;
    },
  },
  {
    id: 'gamerules-1.21.11',
    since: '1.21.11',
    title: 'Game rules in functions: camelCase → snake_case ids',
    text: (text, ctx) => {
      const out = text.replace(/\bgamerule(\s+)([a-z][A-Za-z0-9]*)(\s+(true|false)\b)?/g, (m, sp, name: string, valPart: string | undefined, val: string | undefined) => {
        if (GAMERULE_REMOVED.has(name)) {
          ctx.notes.push(note('Game rule {0} was removed.', name));
          return m;
        }
        if (!/[A-Z]/.test(name) && !GAMERULE_RENAMES[name]) return m;
        const nn = migrateGameruleName(name);
        let v = valPart ?? '';
        if (GAMERULE_INVERTED.has(name)) {
          if (val) v = valPart!.replace(val, val === 'true' ? 'false' : 'true');
          else ctx.notes.push(note('Game rule {0} is now {1} with the inverted meaning.', name, nn));
        }
        return `gamerule${sp}${nn}${v}`;
      });
      if (out !== text) setChanged(ctx);
      return out;
    },
  },
  tagRule('1.21.11'),
  featureTypeRule('26.1', { forest_rock: 'block_blob', ice_spike: 'spike' }),
  tagRule('26.1'),
  {
    id: 'entity-predicates-26.2',
    since: '26.2',
    title: 'Entity predicates: namespaced sub-predicates; advancement conditions without shorthand lists',
    json: (value, ctx) => {
      if (!isData(ctx) || isTagFile(ctx)) return value;
      const before = JSON.stringify(value);
      let v = walk(value, (n) => {
        if (!isObj(n)) return n;
        let out = n;
        // entity_properties.predicate (loot condition; any era of the "condition"/"type" key)
        if ((bare(n.condition) === 'entity_properties' || bare(n.type) === 'entity_properties') && isOldEntityPredicate(n.predicate)) {
          out = { ...out, predicate: migrateEntityPredicate(n.predicate, ctx.notes) };
        }
        // damage source predicates
        for (const k of ['source_entity', 'direct_entity']) {
          if (isOldEntityPredicate(out[k])) out = { ...out, [k]: migrateEntityPredicate(out[k], ctx.notes) };
        }
        return out;
      });
      if (ctx.kind === 'advancement' && isObj(v) && isObj(v.criteria)) {
        for (const crit of Object.values(v.criteria) as any[]) {
          if (!isObj(crit) || !isObj(crit.conditions)) continue;
          for (const [k, val] of Object.entries(crit.conditions)) {
            if (CONTEXT_PREDICATE_FIELDS.has(k)) {
              const nv = migrateContextPredicate(val, ctx.notes);
              if (nv === undefined) delete crit.conditions[k];
              else crit.conditions[k] = nv;
            } else if (k === 'victims' && Array.isArray(val)) {
              crit.conditions[k] = val.map((x) => migrateContextPredicate(x, ctx.notes));
            }
          }
        }
      }
      if (JSON.stringify(v) !== before) setChanged(ctx);
      return v;
    },
  },
  featureTypeRule('26.2', { pointed_dripstone: 'speleothem', dripstone_cluster: 'speleothem_cluster' }),
  tagRule('26.2'),
  {
    id: 'loot-format-26.3',
    since: '26.3',
    title: 'Loot tables, predicates & item modifiers: condition/function → type, conditions → condition, functions → modifier',
    json: (value, ctx) => (isData(ctx) && !isTagFile(ctx) ? migrateLoot263(value, ctx) : value),
  },
  {
    id: 'components-26.3',
    since: '26.3',
    title: 'Item components removed in 26.3 (map_color, swing_animation)',
    json: (value, ctx) => {
      if (!isData(ctx)) return value;
      forEachComponents(value, (c) => {
        const mc = compKey(c, 'map_color');
        if (mc) {
          delete c[mc];
          setChanged(ctx);
          ctx.notes.push(note('Removed component map_color (maps are no longer tinted).'));
        }
        if (compKey(c, 'swing_animation')) ctx.notes.push(note('Component swing_animation was replaced by attack_animation and interact_animation.'));
      });
      return value;
    },
  },
  {
    id: 'worldgen-26.3',
    since: '26.3',
    title: 'Worldgen: configured_feature/carver → feature/carver (inline config), density functions, block state providers',
    rename: (path) => {
      const m = /^data\/([^/]+)\/worldgen\/(configured_feature|configured_carver)\/(.+)$/.exec(path);
      return m ? `data/${m[1]}/worldgen/${m[2] === 'configured_feature' ? 'feature' : 'carver'}/${m[3]}` : undefined;
    },
    json: migrateWorldgen263,
  },
  tagRule('26.3'),
];

// Sort rules by version (stable), keeping declaration order inside a version.
RULES.sort((a, b) => compareVersions(a.since, b.since));

/** Rules that apply when migrating from `from` to `to`. */
export function applicableRules(from: string, to: string): MigrationRule[] {
  return RULES.filter((r) => compareVersions(from, r.since) < 0 && compareVersions(to, r.since) >= 0);
}

function contextFor(path: string): RuleContext {
  const d = describePath(path);
  return { path, kind: d.kind, side: d.side, namespace: d.namespace, notes: [] };
}

function detectIndent(text: string): string | number {
  const m = /\n([ \t]+)\S/.exec(text);
  if (!m) return 2;
  return m[1].includes('\t') ? '\t' : m[1].length;
}

/**
 * Run the content rules on one file. Returns the new text (undefined when unchanged), and the rules that changed it.
 * `enabled` restricts which rules run (all applicable rules when omitted).
 */
export function migrateContent(
  file: MigrationFile,
  rules: MigrationRule[],
  enabled?: Set<string>,
): { text?: string; changedBy: string[]; notes: { rule: string; note: Msg }[] } {
  const changedBy: string[] = [];
  const notes: { rule: string; note: Msg }[] = [];
  if (file.text === undefined) return { changedBy, notes };
  const isJson = file.path.endsWith('.json') || file.path.endsWith('.mcmeta');
  const isFn = file.path.endsWith('.mcfunction');
  if (!isJson && !isFn) return { changedBy, notes };
  let value: any;
  let text = file.text;
  if (isJson) {
    const errors: jsonc.ParseError[] = [];
    value = jsonc.parse(file.text, errors, { allowTrailingComma: true });
    if (errors.length || value === undefined) return { changedBy, notes };
  }
  for (const r of rules) {
    if (enabled && !enabled.has(r.id)) continue;
    const ctx = contextFor(file.path);
    if (isJson && r.json) value = r.json(value, ctx);
    if (isFn && r.text) text = r.text(text, ctx);
    if (ctx.changed) changedBy.push(r.id);
    for (const n of ctx.notes) if (!notes.some((x) => x.rule === r.id && JSON.stringify(x.note) === JSON.stringify(n))) notes.push({ rule: r.id, note: n });
  }
  if (!changedBy.length) return { changedBy, notes };
  if (isJson) {
    const eol = file.text.includes('\r\n') ? '\r\n' : '\n';
    text = JSON.stringify(value, null, detectIndent(file.text)).replace(/\n/g, eol) + eol;
  }
  return { text, changedBy, notes };
}

/** Final path of a file after the enabled rename rules. */
export function migratePath(path: string, rules: MigrationRule[], enabled?: Set<string>): { path: string; renamedBy: string[] } {
  let p = path;
  const renamedBy: string[] = [];
  for (const r of rules) {
    if (!r.rename || (enabled && !enabled.has(r.id))) continue;
    const np = r.rename(p);
    if (np && np !== p) {
      p = np;
      renamedBy.push(r.id);
    }
  }
  return { path: p, renamedBy };
}

/** Plan every change for a set of files (one action per rule & file). */
export function planMigration(files: MigrationFile[], from: string, to: string): PlannedAction[] {
  const rules = applicableRules(from, to);
  const out: PlannedAction[] = [];
  const byPath = new Map(files.map((f) => [f.path, f]));
  for (const f of files) {
    // Renames: show each rule step individually
    let p = f.path;
    for (const r of rules) {
      if (!r.rename) continue;
      const np = r.rename(p);
      if (np && np !== p) {
        out.push({ type: 'rename', rule: r.id, path: f.path, newPath: np });
        p = np;
      }
    }
    const res = migrateContent(f, rules);
    for (const id of res.changedBy) out.push({ type: 'edit', rule: id, path: f.path });
    for (const n of res.notes) out.push({ type: 'note', rule: n.rule, path: f.path, note: n.note });
  }
  for (const r of rules) {
    if (!r.create) continue;
    const ctx = { notes: [] as { path: string; note: Msg }[] };
    for (const c of r.create(byPath, ctx)) out.push({ type: 'create', rule: r.id, path: c.path, text: c.text, source: c.source });
    for (const n of ctx.notes) out.push({ type: 'note', rule: r.id, path: n.path, note: n.note });
  }
  return out;
}
