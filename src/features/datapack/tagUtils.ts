// Tag file helpers. Pure module (unit tested).
import { dataFolder } from '../../core/versions';
import { parseRL } from '../../core/resourceLocation';

export type TagEntry = string | { id: string; required?: boolean };

export interface TagJson {
  replace?: boolean;
  values: TagEntry[];
  [k: string]: unknown;
}

/** Registries offered by the tag tools (most common first). */
export const TAG_REGISTRIES = [
  'item',
  'block',
  'entity_type',
  'fluid',
  'function',
  'enchantment',
  'damage_type',
  'game_event',
  'worldgen/biome',
  'worldgen/structure',
  'banner_pattern',
  'painting_variant',
  'instrument',
  'point_of_interest_type',
  'potion',
  'mob_effect',
  'dialog',
] as const;

/**
 * Well-known convention tags shared by Fabric and NeoForge since 1.21 ("c" namespace).
 * Offered in pickers even when the loader's data is not available locally.
 */
export const COMMON_TAGS: Record<string, string[]> = {
  item: [
    'c:ingots', 'c:ingots/iron', 'c:ingots/gold', 'c:ingots/copper', 'c:ingots/netherite',
    'c:nuggets', 'c:nuggets/iron', 'c:nuggets/gold',
    'c:gems', 'c:gems/diamond', 'c:gems/emerald', 'c:gems/amethyst', 'c:gems/lapis', 'c:gems/quartz',
    'c:dusts', 'c:dusts/redstone', 'c:dusts/glowstone',
    'c:raw_materials', 'c:raw_materials/iron', 'c:raw_materials/gold', 'c:raw_materials/copper',
    'c:ores', 'c:ores/iron', 'c:ores/gold', 'c:ores/copper', 'c:ores/diamond', 'c:ores/coal', 'c:ores/emerald', 'c:ores/lapis', 'c:ores/redstone',
    'c:storage_blocks', 'c:storage_blocks/iron', 'c:storage_blocks/gold', 'c:storage_blocks/diamond',
    'c:rods', 'c:rods/wooden', 'c:rods/blaze', 'c:rods/breeze',
    'c:tools', 'c:tools/pickaxe', 'c:tools/axe', 'c:tools/shovel', 'c:tools/hoe', 'c:tools/sword', 'c:tools/shield', 'c:tools/bow', 'c:tools/crossbow', 'c:tools/fishing_rod', 'c:tools/shear', 'c:tools/spear', 'c:tools/mace', 'c:tools/brush',
    'c:melee_weapon_tools', 'c:ranged_weapon_tools', 'c:mining_tool_tools',
    'c:armors', 'c:enchantables',
    'c:foods', 'c:foods/fruit', 'c:foods/vegetable', 'c:foods/berry', 'c:foods/bread', 'c:foods/cooked_meat', 'c:foods/raw_meat', 'c:foods/cooked_fish', 'c:foods/raw_fish', 'c:foods/soup', 'c:foods/candy', 'c:foods/golden', 'c:foods/edible_when_placed', 'c:foods/food_poisoning',
    'c:crops', 'c:crops/wheat', 'c:seeds', 'c:seeds/wheat',
    'c:dyes', 'c:dyes/red', 'c:dyes/blue', 'c:dyes/green', 'c:dyes/yellow', 'c:dyes/white', 'c:dyes/black',
    'c:chests', 'c:chests/wooden', 'c:barrels', 'c:barrels/wooden', 'c:fence_gates', 'c:fences', 'c:fences/wooden', 'c:glass_blocks', 'c:glass_panes', 'c:stones', 'c:cobblestones', 'c:sands', 'c:sandstone/blocks', 'c:obsidians',
    'c:strings', 'c:leathers', 'c:feathers', 'c:slime_balls', 'c:ender_pearls', 'c:gunpowders', 'c:bones', 'c:eggs', 'c:mushrooms', 'c:flowers', 'c:buckets', 'c:buckets/water', 'c:buckets/lava', 'c:buckets/empty', 'c:potions', 'c:music_discs',
    'c:hidden_from_recipe_viewers', 'c:villager_job_sites',
  ],
  block: [
    'c:ores', 'c:ores/iron', 'c:ores/gold', 'c:ores/copper', 'c:ores/diamond', 'c:ores_in_ground/stone', 'c:ores_in_ground/deepslate', 'c:ores_in_ground/netherrack',
    'c:storage_blocks', 'c:storage_blocks/iron', 'c:storage_blocks/gold', 'c:storage_blocks/diamond',
    'c:chests', 'c:chests/wooden', 'c:barrels', 'c:barrels/wooden', 'c:fence_gates', 'c:fences', 'c:fences/wooden', 'c:glass_blocks', 'c:glass_panes', 'c:stones', 'c:cobblestones', 'c:sands', 'c:obsidians', 'c:flowers',
    'c:relocation_not_supported', 'c:hidden_from_recipe_viewers', 'c:villager_job_sites',
  ],
  entity_type: ['c:bosses', 'c:minecarts', 'c:boats', 'c:capturing_not_supported', 'c:teleporting_not_supported'],
  fluid: ['c:water', 'c:lava', 'c:milk', 'c:honey', 'c:hidden_from_recipe_viewers'],
  'worldgen/biome': ['c:is_hot', 'c:is_cold', 'c:is_wet', 'c:is_dry', 'c:is_forest', 'c:is_plains', 'c:is_mountain', 'c:is_ocean', 'c:is_desert', 'c:is_overworld', 'c:is_nether', 'c:is_end', 'c:is_snowy', 'c:is_jungle', 'c:is_swamp', 'c:is_cave'],
  enchantment: ['c:increase_block_drops', 'c:increase_entity_drops', 'c:weapon_damage_enhancements', 'c:entity_speed_enhancements', 'c:entity_auxiliary_movement_enhancements', 'c:entity_defense_enhancements'],
};

/** Path (relative to resource root) of a tag file, honouring pre-1.21 plural folders. */
export function tagFilePath(registry: string, id: string, version: string): string {
  const rl = parseRL(id.replace(/^#/, ''));
  return `data/${rl.namespace}/${dataFolder(`tags/${registry}`, version)}/${rl.path}.json`;
}

export const entryId = (e: TagEntry): string => (typeof e === 'string' ? e : e.id);
export const entryRequired = (e: TagEntry): boolean => (typeof e === 'string' ? true : e.required !== false);

export function parseTag(value: unknown): TagJson {
  const o = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const values = Array.isArray(o.values) ? (o.values as unknown[]).filter((v): v is TagEntry => typeof v === 'string' || (!!v && typeof (v as any).id === 'string')) : [];
  return { ...o, values } as TagJson;
}

export function hasEntry(tag: TagJson, id: string): boolean {
  return tag.values.some((v) => entryId(v) === id);
}

export function addEntry(tag: TagJson, id: string, required = true): TagJson {
  if (hasEntry(tag, id)) return tag;
  return { ...tag, values: [...tag.values, required ? id : { id, required: false }] };
}

export function removeEntry(tag: TagJson, id: string): TagJson {
  return { ...tag, values: tag.values.filter((v) => entryId(v) !== id) };
}

export function setRequired(tag: TagJson, id: string, required: boolean): TagJson {
  return { ...tag, values: tag.values.map((v) => (entryId(v) === id ? (required ? id : { id, required: false }) : v)) };
}

export function moveEntry(tag: TagJson, id: string, delta: number): TagJson {
  const i = tag.values.findIndex((v) => entryId(v) === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= tag.values.length) return tag;
  const values = [...tag.values];
  [values[i], values[j]] = [values[j], values[i]];
  return { ...tag, values };
}

/** Serialize a tag with "replace" first (only when true) then "values". */
export function serializeTag(tag: TagJson, indent: number | string = 2): string {
  const { replace, values, ...rest } = tag;
  const out: Record<string, unknown> = {};
  if (replace) out.replace = true;
  Object.assign(out, rest);
  out.values = values;
  return JSON.stringify(out, null, indent) + '\n';
}

/** Tag ids (without "#") referenced directly by a tag's values. */
export function nestedTags(tag: TagJson): string[] {
  return tag.values.map(entryId).filter((v) => v.startsWith('#')).map((v) => v.slice(1));
}
