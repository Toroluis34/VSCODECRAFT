#!/usr/bin/env node
// Generates snippets/json-minecraft.json. Bodies are written as JSON values; a string "^…" is emitted raw
// (unquoted) so numbers / booleans can hold tab stops, e.g. "^${1:200}".
//   node src/features/schemas/tools/build-snippets.mjs
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './lib.mjs';

const S = {};
const add = (prefix, description, body) => {
  S[prefix] = { prefix, description, body };
};

// ── Recipes (1.21.2+ / 26.x ingredient format) ────────────────────────────────────────────────────────────────
add('mc-recipe-shaped', 'Shaped crafting recipe (1.21.2+)', {
  type: 'minecraft:crafting_shaped', category: '${1|misc,building,redstone,equipment|}',
  pattern: ['${2:###}', '${3:# #}', '${4:###}'], key: { '#': '${5:minecraft:stick}' },
  result: { id: '${6:minecraft:diamond}', count: '^${7:1}' },
});
add('mc-recipe-shaped-legacy', 'Shaped crafting recipe (1.21–1.21.1 object ingredients)', {
  type: 'minecraft:crafting_shaped', category: '${1|misc,building,redstone,equipment|}',
  pattern: ['${2:###}', '${3:# #}', '${4:###}'], key: { '#': { item: '${5:minecraft:stick}' } },
  result: { id: '${6:minecraft:diamond}', count: '^${7:1}' },
});
add('mc-recipe-shapeless', 'Shapeless crafting recipe (1.21.2+)', {
  type: 'minecraft:crafting_shapeless', category: '${1|misc,building,redstone,equipment|}',
  ingredients: ['${2:minecraft:stick}', '${3:#minecraft:planks}'], result: { id: '${4:minecraft:diamond}', count: '^${5:1}' },
});
add('mc-recipe-shapeless-legacy', 'Shapeless crafting recipe (1.21–1.21.1 object ingredients)', {
  type: 'minecraft:crafting_shapeless', category: '${1|misc,building,redstone,equipment|}',
  ingredients: [{ item: '${2:minecraft:stick}' }, { tag: '${3:minecraft:planks}' }], result: { id: '${4:minecraft:diamond}', count: '^${5:1}' },
});
for (const [type, time, label] of [['smelting', 200, 'Furnace'], ['blasting', 100, 'Blast furnace'], ['smoking', 100, 'Smoker'], ['campfire_cooking', 600, 'Campfire']]) {
  add(`mc-recipe-${type.replace('_cooking', '')}`, `${label} recipe (${type})`, {
    type: `minecraft:${type}`, category: '${1|misc,blocks,food|}', ingredient: '${2:minecraft:raw_iron}',
    result: { id: '${3:minecraft:iron_ingot}' }, experience: '^${4:0.7}', cookingtime: `^\${5:${time}}`,
  });
}
add('mc-recipe-stonecutting', 'Stonecutter recipe', { type: 'minecraft:stonecutting', ingredient: '${1:minecraft:stone}', result: { id: '${2:minecraft:stone_slab}', count: '^${3:2}' } });
add('mc-recipe-smithing-transform', 'Smithing table upgrade recipe', {
  type: 'minecraft:smithing_transform', template: '${1:minecraft:netherite_upgrade_smithing_template}',
  base: '${2:minecraft:diamond_sword}', addition: '${3:#minecraft:netherite_tool_materials}', result: { id: '${4:minecraft:netherite_sword}' },
});
add('mc-recipe-smithing-trim', 'Smithing table armor trim recipe (pattern: 1.21.5+)', {
  type: 'minecraft:smithing_trim', template: '${1:mymod:my_armor_trim_smithing_template}', base: '${2:#minecraft:trimmable_armor}',
  addition: '${3:#minecraft:trim_materials}', pattern: '${4:mymod:my_trim}',
});
add('mc-recipe-transmute', 'Transmute recipe: changes the item keeping its components (1.21.2+)', {
  type: 'minecraft:crafting_transmute', category: '${1|misc,building,redstone,equipment|}', group: '${2:shulker_box_dye}',
  input: '${3:#minecraft:shulker_boxes}', material: '${4:minecraft:blue_dye}', result: { id: '${5:minecraft:blue_shulker_box}' },
});
add('mc-recipe-dye', 'Dye recipe (26.1+)', { type: 'minecraft:crafting_dye', group: '${1:dyed_armor}', target: '${2:minecraft:leather_chestplate}', dye: '${3:#minecraft:dyes}', result: { id: '${2}' } });
add('mc-recipe-imbue', 'Imbue recipe, e.g. tipped arrows (26.1+)', { type: 'minecraft:crafting_imbue', source: '${1:minecraft:lingering_potion}', material: '${2:minecraft:arrow}', result: { id: '${3:minecraft:tipped_arrow}', count: '^${4:8}' } });
add('mc-recipe-brewing', 'Brewing stand recipe (26.3+)', {
  type: 'minecraft:brewing',
  input: { item: '${1:minecraft:potion}', potion_contents: { potions: '${2:minecraft:awkward}' } },
  reagent: { item: '${3:minecraft:blaze_powder}' },
  output: { id: '${1}', components: { 'minecraft:potion_contents': { potion: '${4:minecraft:strength}' } } },
});

// ── Loot tables ─────────────────────────────────────────────────────────────────────────────────────────────
const survives = { condition: 'minecraft:survives_explosion' };
const silkTouch = { condition: 'minecraft:match_tool', predicate: { predicates: { 'minecraft:enchantments': [{ enchantments: 'minecraft:silk_touch', levels: { min: 1 } }] } } };
add('mc-loot-block', 'Block loot table: drops itself (1.21 – 26.2 format)', {
  type: 'minecraft:block',
  pools: [{ rolls: 1, bonus_rolls: 0, entries: [{ type: 'minecraft:item', name: '${1:mymod:my_block}' }], conditions: [survives] }],
  random_sequence: '${2:mymod:blocks/my_block}',
});
add('mc-loot-block-silk-touch', 'Block loot table: only drops with Silk Touch (1.21 – 26.2 format)', {
  type: 'minecraft:block',
  pools: [{ rolls: 1, bonus_rolls: 0, entries: [{ type: 'minecraft:item', name: '${1:mymod:my_block}' }], conditions: [silkTouch] }],
});
add('mc-loot-ore', 'Ore loot table: Silk Touch drops the ore, otherwise items with Fortune (1.21 – 26.2 format)', {
  type: 'minecraft:block',
  pools: [{
    rolls: 1, bonus_rolls: 0,
    entries: [{
      type: 'minecraft:alternatives',
      children: [
        { type: 'minecraft:item', name: '${1:mymod:ruby_ore}', conditions: [silkTouch] },
        {
          type: 'minecraft:item', name: '${2:mymod:ruby}',
          functions: [
            { function: 'minecraft:set_count', count: { type: 'minecraft:uniform', min: '^${3:1}', max: '^${4:2}' } },
            { function: 'minecraft:apply_bonus', enchantment: 'minecraft:fortune', formula: 'minecraft:ore_drops' },
            { function: 'minecraft:explosion_decay' },
          ],
        },
      ],
    }],
  }],
});
add('mc-loot-entity', 'Entity loot table with Looting bonus (1.21 – 26.2 format)', {
  type: 'minecraft:entity',
  pools: [{
    rolls: 1, bonus_rolls: 0,
    entries: [{
      type: 'minecraft:item', name: '${1:minecraft:bone}',
      functions: [
        { function: 'minecraft:set_count', count: { type: 'minecraft:uniform', min: '^${2:0}', max: '^${3:2}' } },
        { function: 'minecraft:enchanted_count_increase', enchantment: 'minecraft:looting', count: { type: 'minecraft:uniform', min: 0, max: 1 } },
      ],
    }],
  }],
});
add('mc-loot-entity-player-kill', 'Entity loot pool: rare drop only when killed by a player (1.21 – 26.2 format)', {
  type: 'minecraft:entity',
  pools: [{
    rolls: 1, bonus_rolls: 0,
    entries: [{ type: 'minecraft:item', name: '${1:minecraft:diamond}' }],
    conditions: [
      { condition: 'minecraft:killed_by_player' },
      { condition: 'minecraft:random_chance_with_enchanted_bonus', enchantment: 'minecraft:looting', unenchanted_chance: '^${2:0.025}', enchanted_chance: { type: 'minecraft:linear', base: 0.035, per_level_above_first: 0.01 } },
    ],
  }],
});
add('mc-loot-chest', 'Chest loot table (1.21 – 26.2 format)', {
  type: 'minecraft:chest',
  pools: [{
    rolls: { type: 'minecraft:uniform', min: '^${1:2}', max: '^${2:4}' },
    entries: [
      { type: 'minecraft:item', name: '${3:minecraft:iron_ingot}', weight: 10, functions: [{ function: 'minecraft:set_count', count: { type: 'minecraft:uniform', min: 1, max: 5 } }] },
      { type: 'minecraft:item', name: '${4:minecraft:diamond}', weight: 2 },
      { type: 'minecraft:empty', weight: 5 },
    ],
  }],
});
add('mc-loot-block-263', 'Block loot table: drops itself (26.3+ format: condition / modifier)', {
  type: 'minecraft:block',
  pools: [{ rolls: 1, entries: [{ type: 'minecraft:item', name: '${1:mymod:my_block}' }], condition: { type: 'minecraft:survives_explosion' } }],
  random_sequence: '${2:mymod:blocks/my_block}',
});
add('mc-loot-ore-263', 'Ore loot table with Silk Touch / Fortune (26.3+ format)', {
  type: 'minecraft:block',
  pools: [{
    rolls: 1,
    entries: [{
      type: 'minecraft:alternatives',
      children: [
        { type: 'minecraft:item', condition: 'minecraft:tool/can_silk_touch', name: '${1:mymod:ruby_ore}' },
        { type: 'minecraft:item', name: '${2:mymod:ruby}', modifier: [{ type: 'minecraft:apply_bonus', enchantment: 'minecraft:fortune', formula: 'minecraft:ore_drops' }, { type: 'minecraft:explosion_decay' }] },
      ],
    }],
  }],
});
add('mc-loot-entity-263', 'Entity loot table with Looting bonus (26.3+ format)', {
  type: 'minecraft:entity',
  pools: [{
    rolls: 1,
    entries: [{
      type: 'minecraft:item', name: '${1:minecraft:bone}',
      modifier: [
        { type: 'minecraft:set_count', count: { type: 'minecraft:uniform', min: '^${2:0}', max: '^${3:2}' } },
        { type: 'minecraft:enchanted_count_increase', enchantment: 'minecraft:looting', count: { type: 'minecraft:uniform', min: 0, max: 1 } },
      ],
    }],
  }],
});

// ── Advancements ────────────────────────────────────────────────────────────────────────────────────────────
add('mc-advancement', 'Advancement with display (obtain an item)', {
  parent: '${1:minecraft:story/root}',
  display: {
    icon: { id: '${2:minecraft:diamond}' }, title: { translate: 'advancements.${3:mymod}.${4:my_advancement}.title' },
    description: { translate: 'advancements.${3}.${4}.description' }, frame: '${5|task,goal,challenge|}', show_toast: true, announce_to_chat: true, hidden: false,
  },
  criteria: { has_item: { trigger: 'minecraft:inventory_changed', conditions: { items: [{ items: '${2}' }] } } },
  rewards: { experience: '^${6:10}' },
});
add('mc-advancement-root', 'Root advancement (new tab with background)', {
  display: {
    icon: { id: '${1:minecraft:grass_block}' }, title: { translate: 'advancements.${2:mymod}.root.title' }, description: { translate: 'advancements.${2}.root.description' },
    background: '${3:minecraft:gui/advancements/backgrounds/stone}', show_toast: false, announce_to_chat: false,
  },
  criteria: { tick: { trigger: 'minecraft:tick' } },
});
add('mc-advancement-hidden', 'Hidden advancement without display (granted by commands / functions)', {
  criteria: { requirement: { trigger: '${1:minecraft:impossible}' } },
  rewards: { function: '${2:mymod:reward}' },
});
add('mc-advancement-recipe', 'Recipe unlock advancement (like vanilla recipes/)', {
  parent: 'minecraft:recipes/root',
  criteria: {
    has_the_recipe: { trigger: 'minecraft:recipe_unlocked', conditions: { recipe: '${1:mymod:my_recipe}' } },
    has_item: { trigger: 'minecraft:inventory_changed', conditions: { items: [{ items: '${2:minecraft:stick}' }] } },
  },
  requirements: [['has_the_recipe', 'has_item']],
  rewards: { recipes: ['${1}'] },
});
add('mc-advancement-kill', 'Advancement: kill an entity (1.21 – 26.2 shorthand entity predicate)', {
  parent: '${1:minecraft:adventure/root}',
  display: { icon: { id: '${2:minecraft:iron_sword}' }, title: '${3:Monster Hunter}', description: '${4:Kill a zombie}', frame: 'task' },
  criteria: { killed: { trigger: 'minecraft:player_killed_entity', conditions: { entity: [{ condition: 'minecraft:entity_properties', entity: 'this', predicate: { type: '${5:minecraft:zombie}' } }] } } },
});

// ── Tags / predicates / modifiers ──────────────────────────────────────────────────────────────────────────
add('mc-tag', 'Tag file', { replace: false, values: ['${1:minecraft:stone}'] });
add('mc-tag-optional', 'Tag file with an optional entry (from another mod)', { replace: false, values: ['${1:mymod:my_item}', { id: '${2:othermod:item}', required: false }] });
add('mc-predicate-random-chance', 'Predicate: random chance (1.21 – 26.2)', { condition: 'minecraft:random_chance', chance: '^${1:0.5}' });
add('mc-item-modifier-set-count', 'Item modifier: set count (1.21 – 26.2)', { function: 'minecraft:set_count', count: '^${1:1}', add: false });

// ── Registries ──────────────────────────────────────────────────────────────────────────────────────────────
add('mc-enchantment', 'Enchantment (data-driven, 1.21+)', {
  description: { translate: 'enchantment.${1:mymod}.${2:my_enchantment}' },
  supported_items: '${3:#minecraft:enchantable/weapon}', primary_items: '${4:#minecraft:enchantable/sword}',
  weight: '^${5:5}', max_level: '^${6:3}',
  min_cost: { base: 1, per_level_above_first: 11 }, max_cost: { base: 21, per_level_above_first: 11 },
  anvil_cost: '^${7:2}', slots: ['${8|mainhand,offhand,hand,armor,head,chest,legs,feet,body,any|}'],
  effects: {
    'minecraft:damage': [{ effect: { type: 'minecraft:add', value: { type: 'minecraft:linear', base: '^${9:1.0}', per_level_above_first: '^${10:0.5}' } } }],
  },
});
add('mc-damage-type', 'Damage type', { message_id: '${1:mymod.my_damage}', exhaustion: '^${2:0.1}', scaling: '${3|when_caused_by_living_non_player,never,always|}' });
add('mc-painting-variant', 'Painting variant (title/author: 1.21.2+)', {
  asset_id: '${1:mymod}:${2:my_painting}', width: '^${3:2}', height: '^${4:2}',
  title: { translate: 'painting.${1}.${2}.title', color: 'yellow' }, author: { translate: 'painting.${1}.${2}.author', color: 'gray' },
});
add('mc-jukebox-song', 'Jukebox song', {
  sound_event: '${1:mymod:music_disc.my_song}', description: { translate: 'jukebox_song.${2:mymod}.${3:my_song}' }, length_in_seconds: '^${4:120.0}', comparator_output: '^${5:1}',
});
add('mc-trim-pattern', 'Armor trim pattern (1.21.5+)', { asset_id: '${1:mymod}:${2:my_trim}', description: { translate: 'trim_pattern.${1}.${2}' }, decal: false });
add('mc-trim-material', 'Armor trim material (1.21.5+)', { asset_name: '${1:ruby}', description: { translate: 'trim_material.${2:mymod}.${1}', color: '${3:#E0115F}' } });

// ── Assets ──────────────────────────────────────────────────────────────────────────────────────────────────
add('mc-item-definition', 'Item model definition (assets/<ns>/items, 1.21.4+)', { model: { type: 'minecraft:model', model: '${1:mymod}:item/${2:my_item}' } });
add('mc-item-definition-block', 'Item model definition for a block item (1.21.4+)', { model: { type: 'minecraft:model', model: '${1:mymod}:block/${2:my_block}' } });
add('mc-item-definition-tinted', 'Tinted item model definition (dye color, 1.21.4+)', {
  model: { type: 'minecraft:model', model: '${1:mymod}:item/${2:my_item}', tints: [{ type: 'minecraft:dye', default: '^${3:-6265536}' }] },
});
add('mc-item-definition-using', 'Item model definition that changes while using the item (1.21.4+)', {
  model: { type: 'minecraft:condition', property: 'minecraft:using_item', on_false: { type: 'minecraft:model', model: '${1:mymod}:item/${2:my_item}' }, on_true: { type: 'minecraft:model', model: '${1}:item/${2}_using' } },
});
add('mc-item-definition-cmd', 'Item model definition switching on custom_model_data strings (1.21.4+)', {
  model: {
    type: 'minecraft:select', property: 'minecraft:custom_model_data',
    cases: [{ when: '${1:variant}', model: { type: 'minecraft:model', model: '${2:mymod}:item/${3:my_item}_${1}' } }],
    fallback: { type: 'minecraft:model', model: '${2}:item/${3}' },
  },
});
add('mc-model-cube-all', 'Block model: same texture on all faces', { parent: 'minecraft:block/cube_all', textures: { all: '${1:mymod}:block/${2:my_block}' } });
add('mc-model-cube-column', 'Block model: column (side + end), e.g. logs', { parent: 'minecraft:block/cube_column', textures: { end: '${1:mymod}:block/${2:my_log}_top', side: '${1}:block/${2}' } });
add('mc-model-orientable', 'Block model: orientable (front, side, top), e.g. furnaces', {
  parent: 'minecraft:block/orientable', textures: { front: '${1:mymod}:block/${2:my_machine}_front', side: '${1}:block/${2}_side', top: '${1}:block/${2}_top' },
});
add('mc-model-cube-bottom-top', 'Block model: different top, bottom and sides', {
  parent: 'minecraft:block/cube_bottom_top', textures: { top: '${1:mymod}:block/${2:my_block}_top', bottom: '${1}:block/${2}_bottom', side: '${1}:block/${2}_side' },
});
add('mc-model-item-generated', 'Item model: flat item (item/generated)', { parent: 'minecraft:item/generated', textures: { layer0: '${1:mymod}:item/${2:my_item}' } });
add('mc-model-item-handheld', 'Item model: tool held like a sword (item/handheld)', { parent: 'minecraft:item/handheld', textures: { layer0: '${1:mymod}:item/${2:my_tool}' } });
add('mc-model-element', 'Block model with a custom element', {
  parent: 'minecraft:block/block', textures: { particle: '${1:mymod:block/my_block}', all: '${1}' },
  elements: [{
    from: [0, 0, 0], to: [16, '^${2:8}', 16],
    faces: { down: { texture: '#all', cullface: 'down' }, up: { texture: '#all' }, north: { texture: '#all', cullface: 'north' }, south: { texture: '#all', cullface: 'south' }, west: { texture: '#all', cullface: 'west' }, east: { texture: '#all', cullface: 'east' } },
  }],
});
add('mc-blockstate', 'Blockstate: single model', { variants: { '': { model: '${1:mymod}:block/${2:my_block}' } } });
add('mc-blockstate-facing', 'Blockstate: horizontal facing (north/east/south/west)', {
  variants: {
    'facing=north': { model: '${1:mymod}:block/${2:my_block}' }, 'facing=east': { model: '${1}:block/${2}', y: 90 },
    'facing=south': { model: '${1}:block/${2}', y: 180 }, 'facing=west': { model: '${1}:block/${2}', y: 270 },
  },
});
add('mc-blockstate-axis', 'Blockstate: pillar axis (logs)', {
  variants: { 'axis=y': { model: '${1:mymod}:block/${2:my_log}' }, 'axis=z': { model: '${1}:block/${2}', x: 90 }, 'axis=x': { model: '${1}:block/${2}', x: 90, y: 90 } },
});
add('mc-blockstate-multipart', 'Blockstate: multipart', {
  multipart: [{ apply: { model: '${1:mymod}:block/${2:my_block}_post' } }, { when: { north: 'true' }, apply: { model: '${1}:block/${2}_side', uvlock: true } }],
});
add('mc-equipment', 'Equipment asset (assets/<ns>/equipment, 1.21.4+)', { layers: { humanoid: [{ texture: '${1:mymod}:${2:ruby}' }], humanoid_legs: [{ texture: '${1}:${2}' }] } });
add('mc-sounds-json', 'sounds.json with one sound event', { '${1:my_sound}': { subtitle: 'subtitles.${2:mymod}.${1}', sounds: [{ name: '${2}:${3:my_sound}', volume: '^${4:1.0}' }] } });
add('mc-mcmeta-animation', 'Texture animation (.png.mcmeta)', { animation: { frametime: '^${1:2}', interpolate: '^${2:false}' } });
add('mc-atlas', 'Atlas with a directory source', { sources: [{ type: 'minecraft:directory', source: '${1:mymod_custom}', prefix: '${2:mymod_custom/}' }] });
add('mc-particle', 'Particle definition', { textures: ['${1:mymod}:${2:my_particle}'] });
add('mc-lang', 'Language file entries (item, block, tab)', { 'item.${1:mymod}.${2:my_item}': '${3:My Item}', 'block.${1}.${4:my_block}': '${5:My Block}', 'itemGroup.${1}': '${6:My Mod}' });

// ── Pack metadata / mod metadata ────────────────────────────────────────────────────────────────────────────
add('mc-pack-mcmeta', 'Data pack pack.mcmeta for Minecraft 26.3 (min/max format)', { pack: { description: '${1:My data pack}', min_format: '^${2:121}', max_format: '^${3:121}' } });
add('mc-pack-mcmeta-resource', 'Resource pack pack.mcmeta for Minecraft 26.3 (min/max format)', { pack: { description: '${1:My resource pack}', min_format: '^[${2:97}, ${3:1}]', max_format: '^[${2}, ${3}]' } });
add('mc-pack-mcmeta-range', 'pack.mcmeta supporting 1.21.1 → 26.x (pack_format + supported_formats + min/max)', {
  pack: { description: '${1:My data pack}', pack_format: '^${2:48}', supported_formats: [48, '^${3:121}'], min_format: '^${2}', max_format: '^${3}' },
});
add('mc-pack-mcmeta-1.21.1', 'Data pack pack.mcmeta for Minecraft 1.21 – 1.21.1', { pack: { description: '${1:My data pack}', pack_format: 48 } });
add('mc-pack-mcmeta-1.21.4', 'Data pack pack.mcmeta for Minecraft 1.21.4', { pack: { description: '${1:My data pack}', pack_format: 61 } });
add('mc-pack-mcmeta-overlay', 'pack.mcmeta with an overlay for newer versions', {
  pack: { description: '${1:My data pack}', pack_format: 48, supported_formats: [48, 121], min_format: 48, max_format: 121 },
  overlays: { entries: [{ directory: '${2:overlay_26}', min_format: '^${3:101}', max_format: 121 }] },
});
add('mc-fabric-mod-json', 'fabric.mod.json', {
  schemaVersion: 1, id: '${1:mymod}', version: '\\${version}', name: '${2:My Mod}', description: '${3:}', authors: ['${4:Me}'],
  license: '${5:MIT}', icon: 'assets/${1}/icon.png', environment: '*',
  entrypoints: { main: ['${6:com.example.mymod.MyMod}'], client: ['${7:com.example.mymod.MyModClient}'] },
  mixins: ['${1}.mixins.json'],
  depends: { fabricloader: '>=0.16.0', minecraft: '~${8:1.21.1}', java: '>=21', 'fabric-api': '*' },
});

// ---------------------------------------------------------------------------------------------------------------
function toBody(value) {
  const json = JSON.stringify(value, null, '\t').replace(/"\^((?:[^"\\]|\\.)*)"/g, (_, raw) => raw.replace(/\\"/g, '"'))
    .replace(/\\\\\$/g, '\\$');
  return json.split('\n');
}
const out = {};
for (const [name, s] of Object.entries(S)) out[name] = { prefix: s.prefix, description: s.description, body: toBody(s.body) };
const file = path.join(ROOT, 'snippets/json-minecraft.json');
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
console.log(`wrote ${Object.keys(out).length} snippets to ${path.relative(ROOT, file)}`);
