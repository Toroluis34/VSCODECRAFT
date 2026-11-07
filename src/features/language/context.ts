// Context detection: which kind of resource location a JSON string (or property key) expects.
// Pure module (no 'vscode' import) — unit tested in test/language/context.test.ts.
import * as jsonc from 'jsonc-parser';

export type JsonPath = (string | number)[];

export interface RefContext {
  /**
   * Registry / resource type. Uses the same names as core.registries / core.vanilla
   * ("item", "block", "entity_type", "worldgen/biome", "loot_table", "model", "texture", ...)
   * plus "sound_file" (assets/<ns>/sounds/*.ogg) and the static lists in STATIC_VALUES.
   */
  registry: string;
  /** "#ns:tag" references are accepted besides plain ids. */
  allowTag?: boolean;
  /** The value IS a tag id written without "#" (e.g. {"tag": "minecraft:logs"}). */
  tagOnly?: boolean;
  /** Path prefix applied when mapping the id to a file (e.g. "entity/equipment/humanoid/" for equipment layers). */
  prefix?: string;
  /** "#name" values are texture variables (block models), not tags. */
  textureVar?: boolean;
  /** "!" prefix allowed (component removal). */
  negatable?: boolean;
  /** The reference is a property key (e.g. data component names inside "components"). */
  key?: boolean;
  /** {"id": ..., "required": false} — missing targets are fine. */
  optional?: boolean;
  /** Older formats write a full file path ("minecraft:textures/gui/x.png"); accept and normalize it. */
  fullPath?: boolean;
}

export interface FileContext {
  /** Kind from classifyPath ("recipe", "tags/item", "models", ...) or "pack.mcmeta". */
  kind: string;
  /** Resource path inside the kind folder (e.g. "item/compostables" for data maps). */
  path?: string;
}

/** Hard-coded values for registries that have no data-driven list. Completion only (never validated). */
export const STATIC_VALUES: Record<string, string[]> = {
  item_model_type: ['model', 'composite', 'condition', 'select', 'range_dispatch', 'empty', 'bundle/selected_item', 'special'],
  tint_source_type: ['constant', 'dye', 'grass', 'firework', 'potion', 'map_color', 'team', 'custom_model_data'],
  item_condition_property: [
    'broken', 'bundle/has_selected_item', 'carried', 'component', 'damaged', 'extended_view', 'fishing_rod/cast',
    'has_component', 'keybind_down', 'selected', 'using_item', 'view_entity', 'custom_model_data',
  ],
  item_select_property: [
    'block_state', 'charge_type', 'component', 'context_dimension', 'context_entity_type', 'custom_model_data',
    'display_context', 'local_time', 'main_hand', 'trim_material',
  ],
  item_numeric_property: [
    'bundle/fullness', 'compass', 'cooldown', 'count', 'crossbow/pull', 'custom_model_data', 'damage', 'time',
    'use_cycle', 'use_duration',
  ],
  special_model_type: [
    'banner', 'bed', 'chest', 'conduit', 'copper_golem_statue', 'decorated_pot', 'head', 'player_head', 'shield',
    'shulker_box', 'standing_sign', 'hanging_sign', 'trident',
  ],
};

export function isStaticRegistry(registry: string): boolean {
  return registry in STATIC_VALUES;
}

const ITEM_TAG: RefContext = { registry: 'item', allowTag: true };

/** Generic property-name rules that apply in every data file. */
const KEY_RULES: Record<string, RefContext> = {
  items: ITEM_TAG,
  item: { registry: 'item' },
  blocks: { registry: 'block', allowTag: true },
  block: { registry: 'block' },
  fluids: { registry: 'fluid', allowTag: true },
  fluid: { registry: 'fluid' },
  entity_type: { registry: 'entity_type', allowTag: true },
  entity_types: { registry: 'entity_type', allowTag: true },
  enchantment: { registry: 'enchantment' },
  enchantments: { registry: 'enchantment', allowTag: true },
  attribute: { registry: 'attribute' },
  biome: { registry: 'worldgen/biome' },
  biomes: { registry: 'worldgen/biome', allowTag: true },
  structure: { registry: 'worldgen/structure' },
  structures: { registry: 'worldgen/structure', allowTag: true },
  dimension: { registry: 'dimension' },
  potion: { registry: 'potion' },
  potions: { registry: 'potion', allowTag: true },
  trigger: { registry: 'trigger_type' },
  condition: { registry: 'loot_condition_type' },
  loot_table: { registry: 'loot_table' },
  recipe: { registry: 'recipe' },
  recipe_id: { registry: 'recipe' },
  recipes: { registry: 'recipe' },
  sound_event: { registry: 'sound_event' },
  sound_id: { registry: 'sound_event' },
  sound: { registry: 'sound_event' },
  damage_type: { registry: 'damage_type' },
  instrument: { registry: 'instrument' },
  jukebox_song: { registry: 'jukebox_song' },
  song: { registry: 'jukebox_song' },
  effect_id: { registry: 'mob_effect' },
  to_apply: { registry: 'mob_effect', allowTag: true },
  trim_material: { registry: 'trim_material' },
  trim_pattern: { registry: 'trim_pattern' },
  painting_variant: { registry: 'painting_variant' },
  banner_pattern: { registry: 'banner_pattern' },
  Name: { registry: 'block' },
};

const INGREDIENT_KEYS = new Set([
  'key', 'ingredients', 'ingredient', 'base', 'addition', 'template', 'input', 'material', 'dye', 'target', 'source',
  'banner', 'map', 'fuel', 'shell', 'star', 'trail', 'twinkle', 'shapes', 'front', 'back', 'left', 'right', 'reagent',
]);

/** Ingredient keys of "classic" recipe types whose format changed in 1.21.2 (string vs {"item"/"tag"} objects). */
export const CLASSIC_INGREDIENT_KEYS = new Set(['key', 'ingredients', 'ingredient', 'base', 'addition', 'template', 'input', 'material']);

const ENTITY_KEYS = new Set([
  'entity', 'player', 'projectile', 'direct_entity', 'source_entity', 'killer', 'killed', 'victim', 'vehicle', 'passenger',
  'targeted_entity', 'parent', 'partner', 'child', 'zombie', 'villager', 'lightning', 'bystander', 'shooter', 'target',
  'looking_at', 'mount', 'killing_blow',
]);

const ITEMSTACK_OWNERS = new Set(['result', 'icon', 'item', 'output', 'use_remainder', 'stack', 'contents', 'items']);

const strip = (v: unknown): string => (typeof v === 'string' ? v.replace(/^minecraft:/, '') : '');

export function getAt(root: unknown, path: JsonPath): any {
  let cur: any = root;
  for (const seg of path) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = cur[seg as any];
  }
  return cur;
}

/** Index of the nearest string segment at or before `from`. */
function keyIndex(path: JsonPath, from: number): number {
  let i = from;
  while (i >= 0 && typeof path[i] !== 'string') i--;
  return i;
}

const ASSET_KINDS = new Set(['models', 'blockstates', 'items', 'equipment', 'atlases', 'particles', 'font', 'sounds', 'textures']);

/**
 * Decide which resource location a string at `path` (or the property key at the end of `path` when `isKey`)
 * expects. `root` is the parsed JSON value of the whole document.
 */
export function detectContext(file: FileContext, path: JsonPath, root: unknown, isKey = false): RefContext | undefined {
  if (!path.length || file.kind === 'pack.mcmeta' || file.kind === 'lang') return undefined;
  const res = isKey ? keyContext(file, path, root) : valueContext(file, path, root);
  if (!res) return undefined;
  if (!isKey) {
    const container = getAt(root, path.slice(0, -1));
    if (container && typeof container === 'object' && !Array.isArray(container) && container.required === false) {
      return { ...res, optional: true };
    }
  }
  return isKey ? { ...res, key: true } : res;
}

function keyContext(file: FileContext, path: JsonPath, root: unknown): RefContext | undefined {
  const parentIdx = keyIndex(path, path.length - 2);
  const parentKey = parentIdx >= 0 ? (path[parentIdx] as string) : undefined;
  const kind = file.kind;
  if (kind === 'data_maps' && path.length === 2 && path[0] === 'values') {
    const reg = registryOfDataMap(file.path);
    return reg ? { registry: reg, allowTag: true } : undefined;
  }
  if (!parentKey || parentIdx !== path.length - 2) return undefined;
  if (parentKey === 'components') {
    // components inside item predicates ("predicates") are sub-predicate types
    return { registry: 'data_component_type', negatable: true };
  }
  if (parentKey === 'predicates' && kind !== 'models') return { registry: 'data_component_predicate_type' };
  const comp = strip(parentKey);
  const own = path[path.length - 1];
  if (comp === 'enchantments' || comp === 'stored_enchantments') {
    // pre-1.21.5 component form: {"levels": {...}, "show_in_tooltip": false}
    if (own === 'levels' || own === 'show_in_tooltip') return undefined;
    return { registry: 'enchantment' };
  }
  if (parentKey === 'levels') {
    const grand = path[path.length - 3];
    return typeof grand === 'string' && /enchantments$/.test(grand) ? { registry: 'enchantment' } : undefined;
  }
  if (parentKey === 'effects') {
    if (kind === 'enchantment' && path.length === 2) return { registry: 'enchantment_effect_component_type' };
    if (kind.startsWith('worldgen/') || kind === 'dimension_type' || kind === 'enchantment') return undefined;
    return { registry: 'mob_effect' };
  }
  if (parentKey === 'spawn_costs') return { registry: 'entity_type' };
  return undefined;
}

function registryOfDataMap(p?: string): string | undefined {
  if (!p) return undefined;
  const segs = p.split('/');
  if (segs.length < 2) return undefined;
  // data_maps/<registry...>/<name>; registry may be "worldgen/biome"
  return segs.slice(0, -1).join('/');
}

function valueContext(file: FileContext, path: JsonPath, root: unknown): RefContext | undefined {
  const kind = file.kind;
  const last = path.length - 1;
  const keyIdx = keyIndex(path, last);
  const key = keyIdx >= 0 ? (path[keyIdx] as string) : undefined;
  const owner = keyIdx >= 0 ? getAt(root, path.slice(0, keyIdx)) : undefined;
  const ownerKeyIdx = keyIndex(path, keyIdx - 1);
  const ownerKey = ownerKeyIdx >= 0 ? (path[ownerKeyIdx] as string) : undefined;
  const ownerParent = ownerKeyIdx >= 0 ? getAt(root, path.slice(0, ownerKeyIdx)) : undefined;
  const allNumbersAfter = (i: number) => path.slice(i).every((s) => typeof s === 'number');

  // ---------- kind specific ----------
  if (kind.startsWith('tags/')) {
    if (path[0] === 'values' && typeof path[1] === 'number' && (path.length === 2 || (path.length === 3 && path[2] === 'id'))) {
      return { registry: kind.slice(5), allowTag: true };
    }
    return undefined;
  }
  if (kind === 'pack.mcmeta' || kind === 'lang') return undefined;

  if (kind === 'models') {
    if (path.length === 1 && key === 'parent') return { registry: 'model' };
    if (path[0] === 'textures' && (path.length === 2 || (path.length === 3 && path[2] === 'sprite'))) {
      return { registry: 'texture', textureVar: true };
    }
    // face "texture" values are always texture variables ("#side", and vanilla also writes bare "all")
    return undefined;
  }
  if (kind === 'blockstates') {
    if (key === 'model') return { registry: 'model' };
    return undefined;
  }
  if (kind === 'items') {
    if (key === 'model' || key === 'base') return { registry: 'model' };
    if (key === 'type') {
      if (ownerKey === 'tints') return { registry: 'tint_source_type' };
      if (ownerKey === 'model' && ownerParent && /special$/.test(String(ownerParent.type ?? ''))) {
        return { registry: 'special_model_type' };
      }
      return { registry: 'item_model_type' };
    }
    if (key === 'property' && owner && typeof owner === 'object') {
      const t = strip(owner.type);
      if (t === 'condition') return { registry: 'item_condition_property' };
      if (t === 'select') return { registry: 'item_select_property' };
      if (t === 'range_dispatch') return { registry: 'item_numeric_property' };
    }
    if (key === 'component' && owner && typeof owner === 'object') return { registry: 'data_component_type' };
    return undefined;
  }
  if (kind === 'sounds') {
    if (path.length === 3 && path[1] === 'sounds') return { registry: 'sound_file' };
    if (path.length === 4 && path[1] === 'sounds' && path[3] === 'name') {
      return strip(owner?.type) === 'event' ? { registry: 'sound_event' } : { registry: 'sound_file' };
    }
    return undefined;
  }
  if (kind === 'equipment') {
    if (path[0] === 'layers' && typeof path[1] === 'string' && key === 'texture') {
      return { registry: 'texture', prefix: `entity/equipment/${path[1]}/` };
    }
    return undefined;
  }
  if (kind === 'atlases') {
    if (key === 'resource' || key === 'palette_key' || key === 'sprite') return { registry: 'texture' };
    if (key === 'textures' && path.length > keyIdx + 1) return { registry: 'texture' };
    return undefined;
  }
  if (kind === 'particles') {
    if (key === 'textures') return { registry: 'texture', prefix: 'particle/' };
    return undefined;
  }
  if (ASSET_KINDS.has(kind)) return undefined;

  if (kind === 'data_maps') return undefined;

  if (kind === 'recipe') {
    if (path.length === 1 && key === 'type') return { registry: 'recipe_serializer' };
    const rootType = strip((root as any)?.type);
    if (path.length === 1 && key === 'pattern' && rootType === 'smithing_trim') return { registry: 'trim_pattern' };
    const first = path[0];
    if (typeof first === 'string' && INGREDIENT_KEYS.has(first)) {
      let rest = path.slice(1);
      if (first === 'key' || first === 'shapes') {
        if (typeof rest[0] !== 'string') return undefined;
        rest = rest.slice(1);
      }
      if (rest.every((s) => typeof s === 'number')) return ITEM_TAG;
      const tail = rest[rest.length - 1];
      if (rest.slice(0, -1).every((s) => typeof s === 'number')) {
        if (tail === 'item') return { registry: 'item' };
        if (tail === 'tag') return { registry: 'item', tagOnly: true };
        if (tail === 'items') return ITEM_TAG;
      }
      if (key === 'potions' || key === 'potion') return { registry: 'potion', allowTag: true };
      // fall through: other keys inside custom ingredients
    }
    if ((first === 'result' || first === 'output') && (path.length === 1 || (path.length === 2 && (key === 'id' || key === 'item')))) {
      return { registry: 'item' };
    }
  }

  if (kind === 'advancement') {
    if (path.length === 1 && key === 'parent') return { registry: 'advancement' };
    if (path[0] === 'display') {
      if (path[1] === 'icon' && path.length === 3 && (key === 'id' || key === 'item')) return { registry: 'item' };
      if (path[1] === 'background' && path.length === 2) return { registry: 'texture', fullPath: true };
      return undefined;
    }
    if (path[0] === 'rewards') {
      if (key === 'function' && path.length === 2) return { registry: 'function' };
      if (key === 'recipes') return { registry: 'recipe' };
      if (key === 'loot') return { registry: 'loot_table' };
      return undefined;
    }
    if (path[0] === 'criteria' && path.length === 3 && key === 'trigger') return { registry: 'trigger_type' };
    if (path[0] === 'criteria' && (key === 'from' || key === 'to') && strip(getAt(root, path.slice(0, 2))?.trigger) === 'changed_dimension') {
      return { registry: 'dimension' };
    }
  }

  if (kind === 'enchantment') {
    if ((key === 'supported_items' || key === 'primary_items') && keyIdx === 0) return ITEM_TAG;
    if (key === 'exclusive_set' && keyIdx === 0) return { registry: 'enchantment', allowTag: true };
  }

  if (kind === 'trim_material' && path.length === 1 && key === 'ingredient') return { registry: 'item' };

  if (/_variant$/.test(kind)) {
    if (key === 'asset_id' && keyIdx === 0) return kind === 'painting_variant' ? { registry: 'texture', prefix: 'painting/' } : { registry: 'texture' };
    if (path[0] === 'assets' && path.length === 2) return { registry: 'texture' };
  }

  if (kind === 'dimension') {
    if (path.length === 1 && key === 'type') return { registry: 'dimension_type' };
    if (key === 'settings' && path.length === 2 && path[0] === 'generator') return { registry: 'worldgen/noise_settings' };
  }

  if (kind.startsWith('worldgen/')) {
    if (kind === 'worldgen/biome') {
      if (path[0] === 'features' && allNumbersAfter(1)) return { registry: 'worldgen/placed_feature', allowTag: true };
      if (path[0] === 'carvers') return { registry: 'worldgen/configured_carver', allowTag: true };
      if (path[0] === 'spawners' && key === 'type') return { registry: 'entity_type' };
    }
    if (kind === 'worldgen/placed_feature' && path.length === 1 && key === 'feature') {
      return { registry: 'worldgen/configured_feature' };
    }
    if (kind === 'worldgen/structure' && path.length === 1 && key === 'start_pool') return { registry: 'worldgen/template_pool' };
    if (kind === 'worldgen/template_pool') {
      if (path.length === 1 && key === 'fallback') return { registry: 'worldgen/template_pool' };
      if (key === 'location' && ownerKey === 'element') return { registry: 'structure' };
      if (key === 'processors' && typeof getAt(root, path) !== 'object') return { registry: 'worldgen/processor_list' };
      return undefined;
    }
  }

  // ---------- data components ----------
  const ci = path.lastIndexOf('components');
  if (ci >= 0 && typeof path[ci + 1] === 'string') {
    const comp = strip(String(path[ci + 1]).replace(/^!/, ''));
    const sub = path.slice(ci + 2);
    if (sub.every((s) => typeof s === 'number')) {
      const direct = COMPONENT_VALUES[comp];
      if (direct) return direct;
      const variant = /^([a-z_]+)\/variant$/.exec(comp);
      if (variant) return { registry: variant[1] === 'villager' ? 'villager_type' : `${variant[1]}_variant` };
      return undefined;
    }
    if (comp === 'equippable') {
      if (key === 'asset_id' && sub.length === 1) return { registry: 'equipment' };
      if (key === 'allowed_entities') return { registry: 'entity_type', allowTag: true };
    }
    if (comp === 'trim' && sub.length === 1) {
      if (key === 'material') return { registry: 'trim_material' };
      if (key === 'pattern') return { registry: 'trim_pattern' };
    }
    if (comp === 'attribute_modifiers' && key === 'type') return { registry: 'attribute' };
    if ((comp === 'consumable' || comp === 'death_protection') && key === 'type' && ownerKey !== 'effects') {
      return { registry: 'consume_effect_type' };
    }
    if (comp === 'jukebox_playable' && key === 'song') return { registry: 'jukebox_song' };
  }

  // ---------- loot tables / predicates / item modifiers (appear in many files) ----------
  // Two syntaxes exist: up to 26.2 {"function": "set_count"} / {"condition": "match_tool"} in "functions"/"conditions"
  // arrays; 26.3+ {"type": ...} objects under "modifier"/"condition" (which may also be a string reference).
  if (!key) return undefined;
  const ownerObj = owner && typeof owner === 'object' && !Array.isArray(owner) ? owner : undefined;
  const parentObj = ownerParent && typeof ownerParent === 'object' && !Array.isArray(ownerParent) ? ownerParent : undefined;
  const fnOf = (o: any, k: string | undefined): string =>
    !o ? '' : o.function !== undefined ? strip(o.function) : k && MODIFIER_KEYS.has(k) ? strip(o.type) : '';
  const condOf = (o: any, k: string | undefined): string =>
    !o ? '' : typeof o.condition === 'string' && !isNewStyleHolder(o) ? strip(o.condition) : k && isConditionOwner(o, k) ? strip(o.type) : '';
  if ((ownerKey === 'entries' || ownerKey === 'children') && ownerObj) {
    const t = strip(ownerObj.type);
    if (key === 'type') return { registry: 'loot_pool_entry_type' };
    if (key === 'name' || key === 'value') {
      if (t === 'item') return { registry: 'item' };
      if (t === 'tag') return { registry: 'item', tagOnly: true };
      if (t === 'loot_table') return { registry: 'loot_table' };
    }
  }
  const fn = fnOf(ownerObj, ownerKey);
  if (fn && key !== 'function') {
    if (key === 'type' && ownerObj?.function === undefined) return { registry: 'loot_function_type' };
    if (key === 'name' && fn === 'reference') return { registry: 'item_modifier' };
    if (key === 'name' && fn === 'set_loot_table') return { registry: 'loot_table' };
    if (key === 'options' && fn === 'enchant_randomly') return { registry: 'enchantment', allowTag: true };
    if (key === 'options' && fn === 'set_instrument') return { registry: 'instrument', allowTag: true };
    if (key === 'id' && fn === 'set_potion') return { registry: 'potion' };
    if (key === 'destination' && fn === 'exploration_map') return { registry: 'worldgen/structure', tagOnly: true };
    if (key === 'decoration' && fn === 'exploration_map') return { registry: 'map_decoration_type' };
    if ((key === 'include' || key === 'exclude' || key === 'components') && fn === 'copy_components') {
      return { registry: 'data_component_type' };
    }
    if (key === 'entity' || key === 'source') return undefined;
  }
  if (key === 'type' && ownerKey === 'condition' && path.includes('spawn_conditions')) return { registry: 'spawn_condition_type' };
  const cond = condOf(ownerObj, ownerKey);
  if (cond) {
    if (key === 'type' && ownerObj?.condition === undefined) return { registry: 'loot_condition_type' };
    if (key === 'name' && cond === 'reference') return { registry: 'predicate' };
  }
  if (key === 'condition') {
    // 26.3+: "condition": "minecraft:tool/can_shear" on entries/pools/modifiers references a predicate file
    if (ownerObj && isNewStyleHolder(ownerObj)) return { registry: 'predicate' };
    return { registry: 'loot_condition_type' };
  }
  if ((key === 'terms' || key === 'term' || key === 'conditions') ) return { registry: 'predicate' };
  if ((key === 'modifier' || key === 'modifiers') && LOOT_KINDS.has(kind)) return { registry: 'item_modifier' };
  if (key === 'type' && ownerKey === 'effects' && fnOf(parentObj, path[keyIndex(path, ownerKeyIdx - 1)] as string) === 'set_stew_effect') {
    return { registry: 'mob_effect' };
  }
  if (key === 'function') {
    if (ownerObj && /run_function$/.test(String(ownerObj.type ?? ''))) return { registry: 'function' };
    if (kind === 'advancement') return undefined;
    return { registry: 'loot_function_type' };
  }
  if (key === 'pattern' && (ownerKey === 'patterns' || ownerKey === 'minecraft:banner_patterns' || ownerKey === 'banner_patterns')) {
    return { registry: 'banner_pattern' };
  }
  if (key === 'id' && (ownerKey === 'effects' || ownerKey === 'custom_effects') && ownerObj && ownerObj.type === undefined) {
    return { registry: 'mob_effect' };
  }
  if (key === 'id' && ownerKey === 'tags' && ownerKeyIdx > 0 && path[ownerKeyIdx - 1] === 'type') {
    return { registry: 'damage_type', tagOnly: true };
  }
  if (key === 'type' && ownerKey && ENTITY_KEYS.has(ownerKey) && ownerObj && ownerObj.condition === undefined && ownerObj.function === undefined) {
    return looksLikeCondition(ownerObj) ? { registry: 'loot_condition_type' } : { registry: 'entity_type', allowTag: true };
  }
  if (key === 'type' && ownerKey === 'predicate' && parentObj && /entity_properties$/.test(String(parentObj.condition ?? parentObj.type ?? ''))) {
    return { registry: 'entity_type', allowTag: true };
  }
  if (key === 'id' && ownerObj && (('count' in ownerObj && typeof ownerObj.count === 'number') || (ownerKey && ITEMSTACK_OWNERS.has(ownerKey)))) {
    if (ownerObj.type === undefined && ownerObj.function === undefined && ownerObj.condition === undefined) return { registry: 'item' };
  }
  if ((key === 'model' || key === 'texture') && !ASSET_KINDS.has(kind)) return undefined;
  // 26.3+ sub-predicates are keyed by namespaced type ("minecraft:entity_type": "#minecraft:skeletons")
  const rule = KEY_RULES[key] ?? (key.startsWith('minecraft:') ? KEY_RULES[key.slice(10)] : undefined);
  if (rule) return rule;
  if (/_sound$/.test(key)) return { registry: 'sound_event' };
  return undefined;
}

const LOOT_KINDS = new Set(['loot_table', 'item_modifier', 'predicate', 'advancement', 'enchantment']);
const MODIFIER_KEYS = new Set(['modifier', 'modifiers', 'functions']);
const CONDITION_KEYS = new Set(['condition', 'conditions', 'terms', 'term', 'requirements']);

/** Entries, pools and modifiers (26.3+) hold a "condition" that is a condition object or predicate reference. */
function isNewStyleHolder(o: any): boolean {
  return o.type !== undefined || o.entries !== undefined || o.rolls !== undefined || o.function !== undefined || o.modifier !== undefined;
}

function looksLikeCondition(o: any): boolean {
  return typeof o.entity === 'string' || o.predicate !== undefined || o.term !== undefined || o.terms !== undefined;
}

function isConditionOwner(o: any, k: string): boolean {
  return CONDITION_KEYS.has(k) || (ENTITY_KEYS.has(k) && looksLikeCondition(o));
}

const COMPONENT_VALUES: Record<string, RefContext> = {
  item_model: { registry: 'item_definition' },
  potion_contents: { registry: 'potion' },
  jukebox_playable: { registry: 'jukebox_song' },
  instrument: { registry: 'instrument' },
  note_block_sound: { registry: 'sound_event' },
  break_sound: { registry: 'sound_event' },
  provides_trim_material: { registry: 'trim_material' },
  provides_banner_patterns: { registry: 'banner_pattern', allowTag: true },
  damage_type: { registry: 'damage_type' },
  recipes: { registry: 'recipe' },
  repairable: ITEM_TAG,
  damage_resistant: { registry: 'damage_type', allowTag: true },
};

/** A resource reference found in a document. */
export interface RefOccurrence {
  node: jsonc.Node;
  /** Raw string value (for keys: the property name). */
  value: string;
  ctx: RefContext;
  path: JsonPath;
}

/** Find every string (and property key) that references a resource in a parsed tree. */
export function collectRefs(tree: jsonc.Node | undefined, file: FileContext): RefOccurrence[] {
  if (!tree) return [];
  const root = jsonc.getNodeValue(tree);
  const out: RefOccurrence[] = [];
  const walk = (n: jsonc.Node, path: JsonPath) => {
    if (n.type === 'object') {
      for (const prop of n.children ?? []) {
        const k = prop.children?.[0];
        const v = prop.children?.[1];
        if (!k) continue;
        const p = [...path, k.value as string];
        const kctx = detectContext(file, p, root, true);
        if (kctx) out.push({ node: k, value: k.value as string, ctx: kctx, path: p });
        if (v) walk(v, p);
      }
    } else if (n.type === 'array') {
      (n.children ?? []).forEach((c, i) => walk(c, [...path, i]));
    } else if (n.type === 'string') {
      const ctx = detectContext(file, path, root, false);
      if (ctx) out.push({ node: n, value: n.value as string, ctx, path });
    }
  };
  walk(tree, []);
  return out;
}

export interface ParsedRef {
  /** Fully qualified id without "#" / "!" (e.g. "minecraft:logs"). */
  id: string;
  isTag: boolean;
  negated: boolean;
  /** True when the id had no explicit namespace. */
  implicitNamespace: boolean;
}

/** Parse a reference value under a context. Returns undefined for texture variables or invalid syntax. */
export function parseRef(value: string, ctx: RefContext): ParsedRef | undefined {
  let v = value.trim();
  if (!v) return undefined;
  let negated = false;
  if (ctx.negatable && v.startsWith('!')) {
    negated = true;
    v = v.slice(1);
  }
  let isTag = !!ctx.tagOnly;
  if (v.startsWith('#')) {
    if (ctx.textureVar) return undefined;
    isTag = true;
    v = v.slice(1);
  }
  if (!/^(?:[a-z0-9_.-]+:)?[a-z0-9_./-]+$/.test(v)) return undefined;
  const implicitNamespace = !v.includes(':');
  let id = implicitNamespace ? `minecraft:${v}` : v;
  if (ctx.fullPath) id = id.replace(/:textures\/(.+)\.png$/, ':$1');
  return { id, isTag, negated, implicitNamespace };
}

/** Registry to look ids up in: "tag/<registry>" for tags. */
export function lookupRegistry(ctx: RefContext, isTag: boolean): string {
  return isTag ? `tag/${ctx.registry}` : ctx.registry;
}

/**
 * Index kind and file extension of the file that defines an id of a (non-tag) registry, when ids map
 * 1:1 to files. Tags map to "tags/<registry>".
 */
export function fileKindOf(registry: string, isTag: boolean): { kind: string; ext: string; side: 'data' | 'assets' } | undefined {
  if (isTag) return { kind: `tags/${registry}`, ext: 'json', side: 'data' };
  switch (registry) {
    case 'model':
      return { kind: 'models', ext: 'json', side: 'assets' };
    case 'texture':
      return { kind: 'textures', ext: 'png', side: 'assets' };
    case 'sound_file':
      return { kind: 'sounds', ext: 'ogg', side: 'assets' };
    case 'item_definition':
      return { kind: 'items', ext: 'json', side: 'assets' };
    case 'block_definition':
      return { kind: 'blockstates', ext: 'json', side: 'assets' };
    case 'equipment':
      return { kind: 'equipment', ext: 'json', side: 'assets' };
    case 'atlas':
      return { kind: 'atlases', ext: 'json', side: 'assets' };
    case 'font':
      return { kind: 'font', ext: 'json', side: 'assets' };
    case 'function':
      return { kind: 'function', ext: 'mcfunction', side: 'data' };
    case 'structure':
      return { kind: 'structure', ext: 'nbt', side: 'data' };
  }
  if (DATA_FILE_REGISTRIES.has(registry) || registry.startsWith('worldgen/')) return { kind: registry, ext: 'json', side: 'data' };
  return undefined;
}

const DATA_FILE_REGISTRIES = new Set([
  'recipe', 'loot_table', 'advancement', 'predicate', 'item_modifier', 'enchantment', 'enchantment_provider', 'damage_type',
  'trim_material', 'trim_pattern', 'banner_pattern', 'painting_variant', 'jukebox_song', 'instrument', 'chat_type',
  'dimension', 'dimension_type', 'wolf_variant', 'wolf_sound_variant', 'cat_variant', 'pig_variant', 'cow_variant',
  'chicken_variant', 'frog_variant', 'dialog', 'trade_set', 'villager_trade', 'timeline', 'test_instance',
  'test_environment', 'world_clock',
]);
