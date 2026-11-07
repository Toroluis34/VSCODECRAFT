import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as jsonc from 'jsonc-parser';
import { collectRefs, detectContext, fileKindOf, parseRef, type JsonPath } from '../../src/features/language/context';

const ctx = (kind: string, json: unknown, path: JsonPath, isKey = false, filePath?: string) =>
  detectContext({ kind, path: filePath }, path, json, isKey);

test('recipes: type, ingredients, result', () => {
  const r = {
    type: 'minecraft:crafting_shaped',
    key: { '#': 'minecraft:stick', X: { tag: 'minecraft:logs' }, Y: [{ item: 'a' }, 'b'] },
    ingredients: ['minecraft:a', ['#minecraft:b']],
    result: { id: 'minecraft:iron_pickaxe', components: { 'minecraft:item_model': 'x:y', '!minecraft:food': {} } },
  };
  assert.equal(ctx('recipe', r, ['type'])?.registry, 'recipe_serializer');
  assert.deepEqual(ctx('recipe', r, ['key', '#']), { registry: 'item', allowTag: true });
  assert.deepEqual(ctx('recipe', r, ['key', 'X', 'tag']), { registry: 'item', tagOnly: true });
  assert.deepEqual(ctx('recipe', r, ['key', 'Y', 0, 'item']), { registry: 'item' });
  assert.equal(ctx('recipe', r, ['ingredients', 1, 0])?.allowTag, true);
  assert.equal(ctx('recipe', r, ['result', 'id'])?.registry, 'item');
  assert.equal(ctx('recipe', r, ['result', 'components', 'minecraft:item_model'])?.registry, 'item_definition');
  const k = ctx('recipe', r, ['result', 'components', '!minecraft:food'], true);
  assert.equal(k?.registry, 'data_component_type');
  assert.equal(k?.negatable, true);
  assert.equal(k?.key, true);
  assert.equal(ctx('recipe', { type: 'minecraft:smithing_trim', pattern: 'minecraft:bolt' }, ['pattern'])?.registry, 'trim_pattern');
});

test('brewing recipe objects', () => {
  const r = { type: 'minecraft:brewing', input: { item: 'minecraft:potion', potion_contents: { potions: 'minecraft:awkward' } } };
  assert.equal(ctx('recipe', r, ['input', 'item'])?.registry, 'item');
  assert.equal(ctx('recipe', r, ['input', 'potion_contents', 'potions'])?.registry, 'potion');
});

test('loot tables', () => {
  const lt = {
    pools: [
      {
        entries: [
          { type: 'minecraft:item', name: 'minecraft:diamond', functions: [{ function: 'minecraft:set_count' }, { function: 'minecraft:enchant_randomly', options: '#minecraft:on_random_loot' }] },
          { type: 'minecraft:tag', name: 'minecraft:logs' },
          { type: 'minecraft:loot_table', value: 'minecraft:chests/x' },
        ],
        conditions: [{ condition: 'minecraft:match_tool', predicate: { items: '#minecraft:pickaxes' } }],
      },
    ],
  };
  assert.equal(ctx('loot_table', lt, ['pools', 0, 'entries', 0, 'type'])?.registry, 'loot_pool_entry_type');
  assert.equal(ctx('loot_table', lt, ['pools', 0, 'entries', 0, 'name'])?.registry, 'item');
  assert.deepEqual(ctx('loot_table', lt, ['pools', 0, 'entries', 1, 'name']), { registry: 'item', tagOnly: true });
  assert.equal(ctx('loot_table', lt, ['pools', 0, 'entries', 2, 'value'])?.registry, 'loot_table');
  assert.equal(ctx('loot_table', lt, ['pools', 0, 'entries', 0, 'functions', 0, 'function'])?.registry, 'loot_function_type');
  assert.equal(ctx('loot_table', lt, ['pools', 0, 'entries', 0, 'functions', 1, 'options'])?.registry, 'enchantment');
  assert.equal(ctx('loot_table', lt, ['pools', 0, 'conditions', 0, 'condition'])?.registry, 'loot_condition_type');
  assert.deepEqual(ctx('loot_table', lt, ['pools', 0, 'conditions', 0, 'predicate', 'items']), { registry: 'item', allowTag: true });
});

test('advancements', () => {
  const a = {
    parent: 'minecraft:story/root',
    display: { icon: { id: 'minecraft:stone' }, background: 'minecraft:gui/advancements/backgrounds/stone' },
    criteria: { c: { trigger: 'minecraft:inventory_changed', conditions: { player: [{ condition: 'x' }], items: [{ items: 'minecraft:a' }] } } },
    rewards: { function: 'mymod:fn', recipes: ['mymod:r'], loot: ['mymod:l'] },
  };
  assert.equal(ctx('advancement', a, ['parent'])?.registry, 'advancement');
  assert.equal(ctx('advancement', a, ['display', 'icon', 'id'])?.registry, 'item');
  assert.equal(ctx('advancement', a, ['display', 'background'])?.registry, 'texture');
  assert.equal(ctx('advancement', a, ['criteria', 'c', 'trigger'])?.registry, 'trigger_type');
  assert.equal(ctx('advancement', a, ['criteria', 'c', 'conditions', 'items', 0, 'items'])?.registry, 'item');
  assert.equal(ctx('advancement', a, ['rewards', 'function'])?.registry, 'function');
  assert.equal(ctx('advancement', a, ['rewards', 'recipes', 0])?.registry, 'recipe');
  assert.equal(ctx('advancement', a, ['rewards', 'loot', 0])?.registry, 'loot_table');
});

test('tags use the folder registry and honour required:false', () => {
  const t = { values: ['minecraft:stone', '#minecraft:logs', { id: 'create:thing', required: false }] };
  assert.deepEqual(ctx('tags/block', t, ['values', 0]), { registry: 'block', allowTag: true });
  assert.deepEqual(ctx('tags/worldgen/biome', t, ['values', 1]), { registry: 'worldgen/biome', allowTag: true });
  assert.equal(ctx('tags/item', t, ['values', 2, 'id'])?.optional, true);
  assert.equal(ctx('tags/item', t, ['replace']), undefined);
});

test('assets: models, blockstates, item definitions, sounds, equipment', () => {
  const m = { parent: 'minecraft:block/cube_all', textures: { all: 'mymod:block/ruby', side: '#all' } };
  assert.equal(ctx('models', m, ['parent'])?.registry, 'model');
  assert.equal(ctx('models', m, ['textures', 'all'])?.registry, 'texture');
  assert.equal(ctx('models', m, ['textures', 'side'])?.textureVar, true);
  const bs = { variants: { '': [{ model: 'mymod:block/ruby' }] }, multipart: [{ apply: { model: 'a' } }] };
  assert.equal(ctx('blockstates', bs, ['variants', '', 0, 'model'])?.registry, 'model');
  assert.equal(ctx('blockstates', bs, ['multipart', 0, 'apply', 'model'])?.registry, 'model');
  const it = { model: { type: 'minecraft:condition', property: 'minecraft:broken', on_true: { type: 'minecraft:model', model: 'x:item/a', tints: [{ type: 'minecraft:dye' }] } } };
  assert.equal(ctx('items', it, ['model', 'type'])?.registry, 'item_model_type');
  assert.equal(ctx('items', it, ['model', 'property'])?.registry, 'item_condition_property');
  assert.equal(ctx('items', it, ['model', 'on_true', 'model'])?.registry, 'model');
  assert.equal(ctx('items', it, ['model', 'on_true', 'tints', 0, 'type'])?.registry, 'tint_source_type');
  const s = { 'block.ruby.break': { sounds: ['mymod:block/ruby1', { name: 'mymod:ev', type: 'event' }, { name: 'mymod:x' }] } };
  assert.equal(ctx('sounds', s, ['block.ruby.break', 'sounds', 0])?.registry, 'sound_file');
  assert.equal(ctx('sounds', s, ['block.ruby.break', 'sounds', 1, 'name'])?.registry, 'sound_event');
  assert.equal(ctx('sounds', s, ['block.ruby.break', 'sounds', 2, 'name'])?.registry, 'sound_file');
  const eq = { layers: { humanoid: [{ texture: 'mymod:ruby' }] } };
  assert.deepEqual(ctx('equipment', eq, ['layers', 'humanoid', 0, 'texture']), { registry: 'texture', prefix: 'entity/equipment/humanoid/' });
});

test('enchantments, components, entity predicates, data maps', () => {
  const e = { supported_items: '#minecraft:enchantable/sword', exclusive_set: '#minecraft:exclusive_set/damage', effects: { 'minecraft:damage': [] } };
  assert.equal(ctx('enchantment', e, ['supported_items'])?.registry, 'item');
  assert.equal(ctx('enchantment', e, ['exclusive_set'])?.registry, 'enchantment');
  assert.equal(ctx('enchantment', e, ['effects', 'minecraft:damage'], true)?.registry, 'enchantment_effect_component_type');
  const c = { components: { 'minecraft:enchantments': { 'minecraft:sharpness': 1 }, 'minecraft:equippable': { slot: 'head', asset_id: 'mymod:ruby' }, 'minecraft:wolf/variant': 'minecraft:pale' } };
  assert.equal(ctx('loot_table', c, ['components', 'minecraft:enchantments', 'minecraft:sharpness'], true)?.registry, 'enchantment');
  assert.equal(ctx('loot_table', c, ['components', 'minecraft:equippable', 'asset_id'])?.registry, 'equipment');
  assert.equal(ctx('loot_table', c, ['components', 'minecraft:wolf/variant'])?.registry, 'wolf_variant');
  assert.equal(ctx('loot_table', c, ['components', 'minecraft:equippable', 'slot']), undefined);
  const p = { condition: 'minecraft:entity_properties', entity: 'this', predicate: { type: 'minecraft:zombie' } };
  assert.equal(ctx('predicate', p, ['predicate', 'type'])?.registry, 'entity_type');
  assert.equal(ctx('predicate', p, ['entity']), undefined);
  assert.equal(ctx('data_maps', { values: { 'minecraft:stone': {} } }, ['values', 'minecraft:stone'], true, 'item/compostables')?.registry, 'item');
});

test('collectRefs and parseRef', () => {
  const text = '{"type":"minecraft:crafting_shapeless","ingredients":["minecraft:a","#c:gems"],"result":{"id":"mymod:b","count":2}}';
  const refs = collectRefs(jsonc.parseTree(text), { kind: 'recipe' });
  assert.deepEqual(refs.map((r) => r.value), ['minecraft:crafting_shapeless', 'minecraft:a', '#c:gems', 'mymod:b']);
  assert.deepEqual(parseRef('#c:gems', { registry: 'item', allowTag: true }), { id: 'c:gems', isTag: true, negated: false, implicitNamespace: false });
  assert.equal(parseRef('stone', { registry: 'item' })?.id, 'minecraft:stone');
  assert.equal(parseRef('#all', { registry: 'texture', textureVar: true }), undefined);
  assert.equal(parseRef('!minecraft:food', { registry: 'data_component_type', negatable: true })?.negated, true);
  assert.equal(parseRef('Not Valid', { registry: 'item' }), undefined);
  assert.deepEqual(fileKindOf('model', false), { kind: 'models', ext: 'json', side: 'assets' });
  assert.equal(fileKindOf('item', true)?.kind, 'tags/item');
  assert.equal(fileKindOf('item', false), undefined);
});

test('key contexts avoid false positives', () => {
  const comp = { components: { 'minecraft:enchantments': { levels: { 'minecraft:sharpness': 2 }, show_in_tooltip: false } } };
  assert.equal(ctx('loot_table', comp, ['components', 'minecraft:enchantments', 'levels'], true), undefined);
  assert.equal(ctx('loot_table', comp, ['components', 'minecraft:enchantments', 'levels', 'minecraft:sharpness'], true)?.registry, 'enchantment');
  const fn = { function: 'minecraft:enchant_with_levels', levels: { type: 'minecraft:uniform', min: 1 } };
  assert.equal(ctx('loot_table', fn, ['levels', 'type'], true), undefined);
  assert.equal(ctx('worldgen/biome', { effects: { sky_color: 1 } }, ['effects', 'sky_color'], true), undefined);
  assert.equal(ctx('advancement', {}, ['criteria', 'a', 'conditions', 'effects', 'minecraft:speed'], true)?.registry, 'mob_effect');
});

test('26.3 loot syntax and pre-1.21.5 advancement backgrounds', () => {
  const lt = {
    pools: [{
      entries: [{ type: 'minecraft:item', name: 'minecraft:stick', condition: 'minecraft:tool/can_shear', modifier: [{ type: 'minecraft:set_count', count: 1 }, { type: 'minecraft:set_potion', id: 'minecraft:healing' }] }],
      condition: { type: 'minecraft:any_of', terms: ['minecraft:tool/can_shear', { type: 'minecraft:survives_explosion' }] },
    }],
  };
  assert.equal(ctx('loot_table', lt, ['pools', 0, 'entries', 0, 'condition'])?.registry, 'predicate');
  assert.equal(ctx('loot_table', lt, ['pools', 0, 'entries', 0, 'modifier', 0, 'type'])?.registry, 'loot_function_type');
  assert.equal(ctx('loot_table', lt, ['pools', 0, 'entries', 0, 'modifier', 1, 'id'])?.registry, 'potion');
  assert.equal(ctx('loot_table', lt, ['pools', 0, 'condition', 'type'])?.registry, 'loot_condition_type');
  assert.equal(ctx('loot_table', lt, ['pools', 0, 'condition', 'terms', 0])?.registry, 'predicate');
  assert.equal(ctx('loot_table', lt, ['pools', 0, 'condition', 'terms', 1, 'type'])?.registry, 'loot_condition_type');
  const adv = { criteria: { a: { trigger: 'minecraft:location', conditions: { player: { type: 'minecraft:entity_properties', entity: 'this', predicate: { 'minecraft:entity_type': '#minecraft:skeletons' } } } } } };
  assert.equal(ctx('advancement', adv, ['criteria', 'a', 'conditions', 'player', 'type'])?.registry, 'loot_condition_type');
  assert.equal(ctx('advancement', adv, ['criteria', 'a', 'conditions', 'player', 'predicate', 'minecraft:entity_type'])?.registry, 'entity_type');
  const bg = ctx('advancement', {}, ['display', 'background'])!;
  assert.equal(parseRef('minecraft:textures/gui/advancements/backgrounds/stone.png', bg)?.id, 'minecraft:gui/advancements/backgrounds/stone');
});
