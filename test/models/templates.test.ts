import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  appendTag,
  blockLootTable,
  blockModel,
  deepEqual,
  ingredient,
  itemDefinition,
  itemModel,
  javaSnippet,
  mergeLang,
  migrateItemModel,
  orientableBlockstate,
  pillarBlockstate,
  planBlockSet,
  planForm,
  SET_VARIANTS,
  setBaseName,
  shapedRecipe,
  simpleBlockstate,
  stringifyMcJson,
  LOOT_FLOAT_KEYS,
  variantAssets,
  vanillaDerivedBlockstate,
  VANILLA_COUNTERPART,
  variantNameEn,
  variantNameEs,
  variantRecipe,
} from '../../src/features/models/templates';
import type { GeneratorForm } from '../../src/features/models/viewTypes';

const fixtures = path.join(__dirname, 'fixtures');
const vanillaBs = JSON.parse(fs.readFileSync(path.join(fixtures, 'vanilla-blockstates.json'), 'utf8'));
const vanillaModels = JSON.parse(fs.readFileSync(path.join(fixtures, 'vanilla-models-1.21.1.json'), 'utf8'));

test('item model / item definition / simple block model JSON', () => {
  assert.deepEqual(itemModel('generated', 'mymod:item/ruby'), { parent: 'minecraft:item/generated', textures: { layer0: 'mymod:item/ruby' } });
  assert.deepEqual(itemModel('handheld', 'mymod:item/ruby_sword'), { parent: 'minecraft:item/handheld', textures: { layer0: 'mymod:item/ruby_sword' } });
  assert.deepEqual(itemDefinition('mymod:item/ruby'), { model: { type: 'minecraft:model', model: 'mymod:item/ruby' } });
  assert.equal(
    JSON.stringify(blockModel('block/cube_column', { side: 's', end: 'e' })),
    '{"parent":"minecraft:block/cube_column","textures":{"end":"e","side":"s"}}',
  );
  assert.deepEqual(simpleBlockstate('mymod:block/ruby_block'), { variants: { '': { model: 'mymod:block/ruby_block' } } });
  // Same shapes as vanilla oak_log / furnace
  assert.ok(deepEqual(pillarBlockstate('minecraft:block/oak_log', 'minecraft:block/oak_log_horizontal'), vanillaBs.oak_log));
  const furnace = orientableBlockstate('minecraft:block/furnace') as any;
  for (const [k, val] of Object.entries<any>(furnace.variants)) assert.deepEqual(val, vanillaBs.furnace.variants[`${k},lit=false`]);
});

test('block set blockstates match vanilla exactly (all variants)', () => {
  for (const variant of SET_VARIANTS) {
    const c = VANILLA_COUNTERPART[variant];
    const id = `ruby_brick_${variant}`;
    const a = variantAssets('mymod', 'ruby_brick', variant, { texture: 'mymod:block/ruby_bricks' }, 'mymod:block/ruby_bricks');
    const expected = vanillaDerivedBlockstate(vanillaBs[c.block], variant, 'mymod', id, 'mymod:block/ruby_bricks');
    // exact JSON (including key order)
    assert.equal(JSON.stringify(a.blockstate), JSON.stringify(expected), variant);
  }
});

test('block set models follow vanilla parents exactly', () => {
  const oakTex = 'minecraft:block/oak_planks';
  const checks: [string, string, string][] = [
    ['stairs', 'oak', oakTex],
    ['slab', 'oak', oakTex],
    ['fence', 'oak', oakTex],
    ['fence_gate', 'oak', oakTex],
    ['button', 'oak', oakTex],
    ['pressure_plate', 'oak', oakTex],
  ];
  for (const [variant, base, tex] of checks) {
    const a = variantAssets('minecraft', base, variant as any, { texture: tex }, 'minecraft:block/oak_planks');
    for (const [id, json] of Object.entries(a.models)) {
      const key = id.replace('minecraft:', '');
      assert.ok(vanillaModels[key], `vanilla has ${key}`);
      assert.equal(JSON.stringify(json), JSON.stringify(vanillaModels[key]), key);
    }
  }
  const door = variantAssets('minecraft', 'oak', 'door', { texture: 'x', doorBottom: 'minecraft:block/oak_door_bottom', doorTop: 'minecraft:block/oak_door_top' }, '');
  for (const [id, json] of Object.entries(door.models)) assert.equal(JSON.stringify(json), JSON.stringify(vanillaModels[id.replace('minecraft:', '')]), id);
  const trap = variantAssets('minecraft', 'oak', 'trapdoor', { texture: 'minecraft:block/oak_trapdoor' }, '');
  for (const [id, json] of Object.entries(trap.models)) assert.equal(JSON.stringify(json), JSON.stringify(vanillaModels[id.replace('minecraft:', '')]), id);
  const wall = variantAssets('minecraft', 'cobblestone', 'wall', { texture: 'minecraft:block/cobblestone' }, '');
  for (const [id, json] of Object.entries(wall.models)) assert.equal(JSON.stringify(json), JSON.stringify(vanillaModels[id.replace('minecraft:', '')]), id);
  const pane = variantAssets('minecraft', 'glass', 'pane', { texture: 'minecraft:block/glass', paneEdge: 'minecraft:block/glass_pane_top' }, '');
  for (const [id, json] of Object.entries(pane.models)) assert.equal(JSON.stringify(json), JSON.stringify(vanillaModels[id.replace('minecraft:', '')]), id);
  assert.equal(door.itemModel, 'minecraft:item/oak_door');
  assert.equal(trap.itemModel, 'minecraft:block/oak_trapdoor_bottom');
});

test('set names', () => {
  assert.equal(setBaseName('ruby_bricks'), 'ruby_brick');
  assert.equal(setBaseName('maple_planks'), 'maple');
  assert.equal(setBaseName('ruby_block'), 'ruby');
  assert.equal(variantNameEn('Ruby Bricks', 'stairs'), 'Ruby Brick Stairs');
  assert.equal(variantNameEs('Ladrillos de rubí', 'slab'), 'Losa de ladrillos de rubí');
});

test('loot tables per version', () => {
  const v1211 = stringifyMcJson(blockLootTable('mymod:ruby_block', '1.21.1'), 2, LOOT_FLOAT_KEYS);
  assert.equal(
    JSON.stringify(JSON.parse(v1211)),
    '{"type":"minecraft:block","pools":[{"bonus_rolls":0,"conditions":[{"condition":"minecraft:survives_explosion"}],"entries":[{"type":"minecraft:item","name":"mymod:ruby_block"}],"rolls":1}],"random_sequence":"mymod:blocks/ruby_block"}',
  );
  assert.match(v1211, /"bonus_rolls": 0\.0,/);
  assert.match(v1211, /"rolls": 1\.0\n/);
  assert.equal(
    JSON.stringify(blockLootTable('mymod:ruby_block', '26.3')),
    '{"type":"minecraft:block","pools":[{"condition":{"type":"minecraft:survives_explosion"},"entries":[{"type":"minecraft:item","name":"mymod:ruby_block"}],"rolls":1}],"random_sequence":"mymod:blocks/ruby_block"}',
  );
  // slab / door in both styles (same shape as vanilla oak_slab / oak_door)
  assert.equal(
    JSON.stringify(blockLootTable('minecraft:oak_slab', '26.3', 'slab')),
    '{"type":"minecraft:block","pools":[{"entries":[{"type":"minecraft:item","modifier":[{"type":"minecraft:set_count","condition":{"type":"minecraft:match_block","blocks":"minecraft:oak_slab","state":{"type":"double"}},"count":2},{"type":"minecraft:explosion_decay"}],"name":"minecraft:oak_slab"}],"rolls":1}],"random_sequence":"minecraft:blocks/oak_slab"}',
  );
  assert.equal(
    JSON.stringify(blockLootTable('minecraft:oak_door', '26.3', 'door')),
    '{"type":"minecraft:block","pools":[{"condition":{"type":"minecraft:survives_explosion"},"entries":[{"type":"minecraft:item","condition":{"type":"minecraft:match_block","blocks":"minecraft:oak_door","state":{"half":"lower"}},"name":"minecraft:oak_door"}],"rolls":1}],"random_sequence":"minecraft:blocks/oak_door"}',
  );
  assert.equal(
    JSON.stringify(blockLootTable('minecraft:oak_slab', '1.21.1', 'slab')),
    '{"type":"minecraft:block","pools":[{"bonus_rolls":0,"entries":[{"type":"minecraft:item","functions":[{"add":false,"conditions":[{"block":"minecraft:oak_slab","condition":"minecraft:block_state_property","properties":{"type":"double"}}],"count":2,"function":"minecraft:set_count"},{"function":"minecraft:explosion_decay"}],"name":"minecraft:oak_slab"}],"rolls":1}],"random_sequence":"minecraft:blocks/oak_slab"}',
  );
  assert.equal(JSON.stringify(blockLootTable('a:b', '26.2')).includes('bonus_rolls'), false);
});

test('recipes per version', () => {
  assert.deepEqual(ingredient('minecraft:stick', '1.21.1'), { item: 'minecraft:stick' });
  assert.deepEqual(ingredient('#minecraft:planks', '1.21.1'), { tag: 'minecraft:planks' });
  assert.equal(ingredient('minecraft:stick', '26.3'), 'minecraft:stick');
  assert.equal(
    JSON.stringify(variantRecipe('stairs', 'minecraft:oak_planks', 'minecraft:oak_stairs', '1.21.1')),
    '{"type":"minecraft:crafting_shaped","category":"building","key":{"#":{"item":"minecraft:oak_planks"}},"pattern":["#  ","## ","###"],"result":{"count":4,"id":"minecraft:oak_stairs"}}',
  );
  assert.equal(
    JSON.stringify(variantRecipe('button', 'minecraft:oak_planks', 'minecraft:oak_button', '26.3')),
    '{"type":"minecraft:crafting_shapeless","category":"redstone","ingredients":["minecraft:oak_planks"],"result":{"id":"minecraft:oak_button"}}',
  );
  assert.equal(
    JSON.stringify(shapedRecipe('1.21.11', 'misc', ['W#W', 'W#W'], { W: 'a:b', '#': 'minecraft:stick' }, 'a:c', 3)),
    '{"type":"minecraft:crafting_shaped","category":"misc","key":{"#":"minecraft:stick","W":"a:b"},"pattern":["W#W","W#W"],"result":{"count":3,"id":"a:c"}}',
  );
});

test('lang merge: sorted insert, never clobbers', () => {
  const existing = '{\n  "block.mymod.a": "A",\n  "item.mymod.z": "Z"\n}\n';
  const r = mergeLang(existing, { 'item.mymod.ruby': 'Ruby', 'block.mymod.a': 'Other' });
  assert.deepEqual(r.added, ['item.mymod.ruby']);
  assert.deepEqual(r.skipped, ['block.mymod.a']);
  assert.deepEqual(Object.keys(JSON.parse(r.text)), ['block.mymod.a', 'item.mymod.ruby', 'item.mymod.z']);
  assert.equal(JSON.parse(r.text)['block.mymod.a'], 'A');
  const unsorted = mergeLang('{"z":"1","a":"2"}', { m: '3' });
  assert.deepEqual(Object.keys(JSON.parse(unsorted.text)), ['z', 'a', 'm']);
  assert.equal(mergeLang(undefined, { a: 'b' }).text, '{\n  "a": "b"\n}\n');
});

test('tag append', () => {
  assert.deepEqual(appendTag(undefined, ['a:b']).json, { values: ['a:b'] });
  const r = appendTag({ replace: false, values: ['a:b', { id: 'a:c', required: false }] }, ['a:b', 'a:c', 'a:d']);
  assert.deepEqual(r.added, ['a:d']);
  assert.deepEqual(r.json, { replace: false, values: ['a:b', { id: 'a:c', required: false }, 'a:d'] });
});

const baseForm: GeneratorForm = {
  mode: 'item',
  namespace: 'mymod',
  id: 'ruby',
  nameEn: 'Ruby',
  nameEs: 'Rubí',
  itemParent: 'generated',
  template: 'cube_all',
  textures: {},
  variants: [],
  blockstate: true,
  blockItem: true,
  itemDefinition: true,
  lang: true,
  loot: true,
  recipe: false,
  recipeIngredient: 'minecraft:diamond',
  tool: 'pickaxe',
  tier: 'iron',
};

test('plan: new item 1.21.1 vs 26.3', () => {
  const old = planForm(baseForm, { version: '1.21.1', loader: 'fabric' });
  assert.deepEqual(
    old.files.map((f) => f.path),
    ['assets/mymod/textures/item/ruby.png', 'assets/mymod/models/item/ruby.json', 'assets/mymod/lang/en_us.json', 'assets/mymod/lang/es_es.json'],
  );
  const neu = planForm(baseForm, { version: '26.3', loader: 'fabric' });
  assert.deepEqual(
    neu.files.map((f) => f.path),
    ['assets/mymod/textures/item/ruby.png', 'assets/mymod/models/item/ruby.json', 'assets/mymod/items/ruby.json', 'assets/mymod/lang/en_us.json', 'assets/mymod/lang/es_es.json'],
  );
  assert.deepEqual(neu.files[2].json, { model: { type: 'minecraft:model', model: 'mymod:item/ruby' } });
  assert.deepEqual(neu.files[3].entries, { 'item.mymod.ruby': 'Ruby' });
});

test('plan: new block (cube_all + stairs/slab) 1.21.1 vs 26.3', () => {
  const form: GeneratorForm = { ...baseForm, mode: 'block', id: 'ruby_bricks', nameEn: 'Ruby Bricks', nameEs: 'Ladrillos de rubí', variants: ['stairs', 'slab'], textures: { all: { source: 'existing', id: 'mymod:block/ruby' } } };
  const old = planForm(form, { version: '1.21.1', loader: 'neoforge' });
  const paths = old.files.map((f) => f.path);
  assert.ok(paths.includes('assets/mymod/models/block/ruby_bricks.json'));
  assert.ok(paths.includes('assets/mymod/models/item/ruby_bricks.json'));
  assert.ok(!paths.some((p) => p.includes('/items/')));
  assert.ok(paths.includes('data/mymod/loot_table/blocks/ruby_brick_slab.json'));
  assert.ok(paths.includes('data/minecraft/tags/block/mineable/pickaxe.json'));
  assert.ok(paths.includes('data/minecraft/tags/block/needs_iron_tool.json'));
  assert.ok(paths.includes('data/minecraft/tags/item/stairs.json'));
  assert.ok(!paths.some((p) => p.includes('textures/')), 'existing texture is not rewritten');
  assert.deepEqual(old.files.find((f) => f.path === 'assets/mymod/models/item/ruby_bricks.json')!.json, { parent: 'mymod:block/ruby_bricks' });
  assert.deepEqual(old.files.find((f) => f.path === 'assets/mymod/models/block/ruby_bricks.json')!.json, {
    parent: 'minecraft:block/cube_all',
    textures: { all: 'mymod:block/ruby' },
  });
  assert.deepEqual(old.files.find((f) => f.path === 'data/minecraft/tags/block/mineable/pickaxe.json')!.values, ['mymod:ruby_bricks', 'mymod:ruby_brick_stairs', 'mymod:ruby_brick_slab']);
  const lang = old.files.find((f) => f.path === 'assets/mymod/lang/es_es.json')!.entries!;
  assert.equal(lang['block.mymod.ruby_brick_stairs'], 'Escaleras de ladrillos de rubí');

  const neu = planForm(form, { version: '26.3', loader: 'fabric' });
  const np = neu.files.map((f) => f.path);
  assert.ok(np.includes('assets/mymod/items/ruby_bricks.json'));
  assert.ok(!np.includes('assets/mymod/models/item/ruby_bricks.json'));
  assert.deepEqual(neu.files.find((f) => f.path === 'assets/mymod/items/ruby_brick_stairs.json')!.json, {
    model: { type: 'minecraft:model', model: 'mymod:block/ruby_brick_stairs' },
  });
  assert.deepEqual(neu.files.find((f) => f.path === 'data/mymod/loot_table/blocks/ruby_bricks.json')!.json, blockLootTable('mymod:ruby_bricks', '26.3'));
});

test('plan: pillar / orientable / cross', () => {
  const pillar = planForm({ ...baseForm, mode: 'block', id: 'maple_log', template: 'cube_column' }, { version: '26.3', loader: 'fabric' });
  assert.deepEqual(pillar.textures, { side: 'mymod:block/maple_log', end: 'mymod:block/maple_log_top' });
  assert.deepEqual(pillar.models['mymod:block/maple_log_horizontal'], {
    parent: 'minecraft:block/cube_column_horizontal',
    textures: { end: 'mymod:block/maple_log_top', side: 'mymod:block/maple_log' },
  });
  const orient = planForm({ ...baseForm, mode: 'block', id: 'crusher', template: 'orientable' }, { version: '1.21.1', loader: 'fabric' });
  assert.deepEqual(orient.models['mymod:block/crusher'], {
    parent: 'minecraft:block/orientable',
    textures: { front: 'mymod:block/crusher_front', side: 'mymod:block/crusher_side', top: 'mymod:block/crusher_top' },
  });
  const cross = planForm({ ...baseForm, mode: 'block', id: 'ruby_flower', template: 'cross' }, { version: '26.3', loader: 'neoforge' });
  assert.deepEqual(cross.models['mymod:block/ruby_flower'], { parent: 'minecraft:block/cross', render_type: 'minecraft:cutout', textures: { cross: 'mymod:block/ruby_flower' } });
  assert.deepEqual(cross.models['mymod:item/ruby_flower'], { parent: 'minecraft:item/generated', textures: { layer0: 'mymod:block/ruby_flower' } });
  assert.equal(cross.previewModel, 'mymod:item/ruby_flower');
});

test('block set plan', () => {
  const r = planBlockSet(
    { namespace: 'mymod', base: 'ruby_brick', fullBlockModel: 'mymod:block/ruby_bricks', textures: { texture: 'mymod:block/ruby_bricks' }, variants: ['door', 'pane'], items: true, loot: true, tags: true, recipes: true, baseItem: 'mymod:ruby_bricks' },
    { version: '1.21.1', loader: 'fabric' },
  );
  const paths = r.files.map((f) => f.path);
  assert.ok(paths.includes('assets/mymod/models/item/ruby_brick_door.json'));
  assert.ok(paths.includes('assets/mymod/models/block/ruby_brick_door_top_right_open.json'));
  assert.ok(paths.includes('data/minecraft/tags/block/doors.json'));
  assert.ok(paths.includes('data/mymod/recipe/ruby_brick_pane.json'));
});

test('item model definition migration', () => {
  assert.deepEqual(migrateItemModel('mymod:item/ruby', { parent: 'item/generated' }).json, { model: { type: 'minecraft:model', model: 'mymod:item/ruby' } });
  const r = migrateItemModel('mymod:item/wand', {
    overrides: [
      { predicate: { custom_model_data: 2 }, model: 'mymod:item/wand_b' },
      { predicate: { custom_model_data: 1 }, model: 'mymod:item/wand_a' },
      { predicate: { pulling: 1 }, model: 'mymod:item/wand_c' },
    ],
  });
  assert.equal(r.warnings.length, 1);
  assert.deepEqual(r.json, {
    model: {
      type: 'minecraft:range_dispatch',
      property: 'minecraft:custom_model_data',
      entries: [
        { threshold: 1, model: { type: 'minecraft:model', model: 'mymod:item/wand_a' } },
        { threshold: 2, model: { type: 'minecraft:model', model: 'mymod:item/wand_b' } },
      ],
      fallback: { type: 'minecraft:model', model: 'mymod:item/wand' },
    },
  });
});

test('java snippets', () => {
  const regs = [{ id: 'mymod:ruby', kind: 'item' as const }, { id: 'mymod:ruby_block', kind: 'block' as const, variant: 'cube_all' as const }];
  const neo = javaSnippet('neoforge', '1.21.1', regs, 'mymod');
  assert.match(neo, /ITEMS\.registerSimpleItem\("ruby"\)/);
  assert.match(neo, /BLOCKS\.registerSimpleBlock\("ruby_block", BlockBehaviour\.Properties\.of\(\)/);
  assert.match(neo, /ITEMS\.registerSimpleBlockItem\(RUBY_BLOCK\)/);
  const f1211 = javaSnippet('fabric', '1.21.1', regs, 'mymod');
  assert.match(f1211, /Registry\.register\(Registries\.ITEM, Identifier\.of\(MOD_ID, "ruby"\), new Item\(new Item\.Settings\(\)\)\)/);
  assert.doesNotMatch(f1211, /registryKey/);
  const f1214 = javaSnippet('fabric', '1.21.4', regs, 'mymod');
  assert.match(f1214, /new Item\(new Item\.Settings\(\)\.registryKey\(RUBY_KEY\)\)/);
  assert.match(f1214, /AbstractBlock\.Settings\.create\(\)\.registryKey\(RUBY_BLOCK_KEY\)/);
  assert.match(f1214, /useBlockPrefixedTranslationKey/);
  const f26 = javaSnippet('fabric', '26.3', regs, 'mymod');
  assert.match(f26, /BuiltInRegistries\.ITEM, RUBY_KEY, new Item\(new Item\.Properties\(\)\.setId\(RUBY_KEY\)\)\)/);
  assert.match(javaSnippet('datapack', '26.3', regs, 'mymod'), /cannot register/);
});
