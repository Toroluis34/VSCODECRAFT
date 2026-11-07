import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  changeType,
  encodeIngredient,
  gridRaw,
  jsonDiff,
  migrateRecipe,
  newRecipe,
  parseIngredient,
  parseRecipe,
  recipeFormatFor,
  recipeKind,
  reencodeIngredient,
  referencedIds,
  setProperty,
  setResultCount,
  setResultId,
  setSlot,
  slotRaw,
  trimPatternFromTemplate,
  writeGrid,
} from '../../src/features/recipes/recipeModel';

const F1211 = recipeFormatFor('1.21.1');
const F1214 = recipeFormatFor('1.21.4');
const F12111 = recipeFormatFor('1.21.11');
const F263 = recipeFormatFor('26.3');

test('recipeFormatFor', () => {
  assert.equal(F1211.ingredient, 'object');
  assert.equal(F1214.ingredient, 'string');
  assert.equal(F1214.transmute, true);
  assert.equal(F1214.transmuteResultStack, false);
  assert.equal(F12111.transmuteResultStack, true);
  assert.equal(F12111.dyeImbue, false);
  assert.equal(recipeFormatFor('26.1').dyeImbue, true);
  assert.equal(recipeFormatFor('26.1').brewing, false);
  assert.equal(F263.brewing, true);
});

test('parseIngredient: vanilla syntaxes', () => {
  assert.deepEqual(parseIngredient('minecraft:stick').ids, ['minecraft:stick']);
  assert.equal(parseIngredient('stick').ids[0], 'minecraft:stick');
  const tag = parseIngredient('#minecraft:planks');
  assert.equal(tag.kind, 'tag');
  assert.deepEqual(tag.ids, ['#minecraft:planks']);
  const obj = parseIngredient({ item: 'minecraft:diamond' });
  assert.equal(obj.kind, 'item');
  assert.equal(obj.objectSyntax, true);
  const otag = parseIngredient({ tag: 'c:ingots/iron' });
  assert.deepEqual(otag.ids, ['#c:ingots/iron']);
  const list = parseIngredient([{ item: 'minecraft:coal' }, { item: 'minecraft:charcoal' }]);
  assert.equal(list.kind, 'list');
  assert.deepEqual(list.ids, ['minecraft:coal', 'minecraft:charcoal']);
  assert.equal(parseIngredient(['minecraft:a', 'minecraft:b']).kind, 'list');
  assert.equal(parseIngredient(null).kind, 'empty');
  assert.equal(parseIngredient(42).kind, 'invalid');
});

test('parseIngredient: NeoForge / Fabric custom ingredients', () => {
  const compound = parseIngredient({ type: 'neoforge:compound', children: [{ item: 'minecraft:a' }, { tag: 'minecraft:logs' }] });
  assert.equal(compound.kind, 'custom');
  assert.equal(compound.customType, 'neoforge:compound');
  assert.deepEqual(compound.ids, ['minecraft:a', '#minecraft:logs']);
  const nf2 = parseIngredient({ 'neoforge:ingredient_type': 'neoforge:difference', base: '#minecraft:planks', subtracted: 'minecraft:oak_planks' });
  assert.deepEqual(nf2.ids, ['#minecraft:planks']);
  assert.deepEqual(nf2.excluded, ['minecraft:oak_planks']);
  const comps = parseIngredient({ 'neoforge:ingredient_type': 'neoforge:components', items: 'minecraft:potion', components: { 'minecraft:potion_contents': { potion: 'minecraft:water' } } });
  assert.deepEqual(comps.ids, ['minecraft:potion']);
  assert.equal(comps.label, 'potion_contents');
  const fabric = parseIngredient({ 'fabric:type': 'fabric:any_of', ingredients: ['minecraft:a', '#minecraft:b'] });
  assert.equal(fabric.customType, 'fabric:any_of');
  assert.deepEqual(fabric.ids, ['minecraft:a', '#minecraft:b']);
  const fabricComp = parseIngredient({ 'fabric:type': 'fabric:components', base: { item: 'minecraft:diamond_sword' }, components: { 'minecraft:damage': 0 } });
  assert.deepEqual(fabricComp.ids, ['minecraft:diamond_sword']);
  const sized = parseIngredient({ ingredient: '#c:ingots', count: 3 });
  assert.equal(sized.count, 3);
  assert.deepEqual(sized.ids, ['#c:ingots']);
  const fluid = parseIngredient({ fluid: 'minecraft:water', amount: 1000 });
  assert.equal(fluid.kind, 'custom');
  assert.match(fluid.label!, /water/);
});

test('encode / reencode ingredients per version', () => {
  assert.equal(encodeIngredient('stick', 'string'), 'minecraft:stick');
  assert.deepEqual(encodeIngredient('#logs', 'object'), { tag: 'minecraft:logs' });
  assert.deepEqual(encodeIngredient(['a:b', 'c:d'], 'string'), ['a:b', 'c:d']);
  assert.equal(reencodeIngredient({ item: 'minecraft:x' }, 'string'), 'minecraft:x');
  assert.equal(reencodeIngredient({ tag: 'minecraft:y' }, 'string'), '#minecraft:y');
  assert.deepEqual(reencodeIngredient('#minecraft:y', 'object'), { tag: 'minecraft:y' });
  assert.deepEqual(reencodeIngredient([{ item: 'a:a' }, { item: 'b:b' }], 'string'), ['a:a', 'b:b']);
  // tags inside a list cannot be strings: keep as-is
  const mixed = [{ item: 'a:a' }, { tag: 'b:b' }];
  assert.deepEqual(reencodeIngredient(mixed, 'string'), mixed);
  // custom ingredients untouched
  const custom = { type: 'neoforge:compound', children: [] };
  assert.equal(reencodeIngredient(custom, 'string'), custom);
});

test('parse shaped recipe (26.3 format)', () => {
  const m = parseRecipe(
    { type: 'minecraft:crafting_shaped', category: 'equipment', key: { '#': 'minecraft:stick', X: 'minecraft:iron_ingot' }, pattern: ['XXX', ' # ', ' # '], result: { id: 'minecraft:iron_pickaxe' } },
    F263,
  );
  assert.equal(m.kind, 'shaped');
  assert.equal(m.grid!.width, 3);
  assert.equal(m.grid!.height, 3);
  assert.equal(m.grid!.cells[0][0]!.ids[0], 'minecraft:iron_ingot');
  assert.equal(m.grid!.cells[1][0], null);
  assert.equal(m.results[0].id, 'minecraft:iron_pickaxe');
  assert.equal(m.results[0].count, 1);
  assert.equal(m.category, 'equipment');
  assert.deepEqual(m.warnings, []);
  assert.deepEqual(referencedIds(m).items.sort(), ['minecraft:iron_ingot', 'minecraft:iron_pickaxe', 'minecraft:stick']);
});

test('shaped warnings: widths, unused/undefined keys, object syntax on 1.21.2+', () => {
  const m = parseRecipe(
    { type: 'crafting_shaped', key: { A: { item: 'minecraft:stone' }, B: { item: 'minecraft:dirt' } }, pattern: ['AA', 'AC '], result: { item: 'minecraft:x', count: 2 } },
    F263,
  );
  const msgs = m.warnings.map((w) => w.message);
  assert.ok(msgs.some((x) => x.includes('different widths')));
  assert.ok(msgs.some((x) => x.includes('not defined')));
  assert.ok(msgs.some((x) => x.includes('not used')));
  assert.ok(msgs.some((x) => x.includes('object syntax')));
  assert.ok(msgs.some((x) => x.includes('"item"')));
  assert.equal(m.results[0].id, 'minecraft:x');
  assert.equal(m.results[0].count, 2);
});

test('parse every vanilla kind', () => {
  assert.equal(recipeKind('minecraft:blasting'), 'cooking');
  assert.equal(recipeKind('crafting_special_repairitem'), 'special');
  assert.equal(recipeKind('create:mixing'), 'generic');

  const smelt = parseRecipe({ type: 'minecraft:smelting', category: 'food', cookingtime: 200, experience: 0.35, ingredient: 'minecraft:potato', result: { id: 'minecraft:baked_potato' } }, F263);
  assert.equal(smelt.cooking!.time, 200);
  assert.equal(smelt.cooking!.xp, 0.35);
  assert.equal(smelt.slots[0].ingredient!.ids[0], 'minecraft:potato');

  const trim = parseRecipe({ type: 'minecraft:smithing_trim', addition: '#minecraft:trim_materials', base: '#minecraft:trimmable_armor', pattern: 'minecraft:bolt', template: 'minecraft:bolt_armor_trim_smithing_template' }, F263);
  assert.equal(trim.slots.length, 3);
  assert.equal(trim.trimPattern, 'minecraft:bolt');
  assert.deepEqual(trim.warnings, []);
  const trimNoPattern = parseRecipe({ type: 'minecraft:smithing_trim', addition: '#minecraft:trim_materials', base: '#minecraft:trimmable_armor', template: 'minecraft:bolt_armor_trim_smithing_template' }, F263);
  assert.ok(trimNoPattern.warnings.some((w) => w.message.includes('pattern')));

  const brew = parseRecipe(
    {
      type: 'minecraft:brewing',
      input: { item: 'minecraft:lingering_potion', potion_contents: { potions: 'minecraft:awkward' } },
      output: { components: { 'minecraft:potion_contents': { potion: 'minecraft:strength' } }, id: 'minecraft:lingering_potion' },
      reagent: { item: 'minecraft:blaze_powder' },
    },
    F263,
  );
  assert.equal(brew.kind, 'brewing');
  assert.equal(brew.slots[0].ingredient!.ids[0], 'minecraft:lingering_potion');
  assert.equal(brew.slots[1].ingredient!.ids[0], 'minecraft:blaze_powder');
  assert.equal(brew.brewing!.inputPotion, 'minecraft:awkward');
  assert.equal(brew.brewing!.outputPotion, 'minecraft:strength');
  assert.equal(brew.results[0].id, 'minecraft:lingering_potion');
  assert.deepEqual(brew.warnings, []);
  assert.ok(parseRecipe(brew as any && { type: 'minecraft:brewing', input: {}, reagent: {}, output: { id: 'minecraft:potion' } }, F12111).warnings.some((w) => w.message.includes('26.3')));

  const firework = parseRecipe({ type: 'minecraft:crafting_special_firework_star', dye: '#minecraft:dyes', fuel: 'minecraft:gunpowder', result: { id: 'minecraft:firework_star' }, shapes: { burst: 'minecraft:feather' }, trail: 'minecraft:diamond' }, F263);
  assert.equal(firework.kind, 'special');
  assert.ok(firework.slots.some((s) => s.label === 'shapes.burst'));
  assert.equal(firework.results[0].id, 'minecraft:firework_star');

  const repair = parseRecipe({ type: 'minecraft:crafting_special_repairitem' }, F263);
  assert.deepEqual(repair.slots, []);
  assert.deepEqual(repair.warnings, []);

  const armordye = parseRecipe({ type: 'minecraft:crafting_special_armordye', category: 'misc' }, F263);
  assert.ok(armordye.warnings.some((w) => w.message.includes('removed')));

  const transmute = parseRecipe({ type: 'minecraft:crafting_transmute', input: '#minecraft:shulker_boxes', material: 'minecraft:black_dye', result: 'minecraft:black_shulker_box' }, F1214);
  assert.equal(transmute.results[0].id, 'minecraft:black_shulker_box');
  assert.deepEqual(transmute.warnings, []);
  assert.ok(parseRecipe({ type: 'minecraft:crafting_transmute', input: 'a:b', material: 'c:d', result: 'e:f' }, F1211).warnings.some((w) => w.message.includes('1.21.2')));
});

test('generic / modded recipes expose ingredient-like and result-like fields', () => {
  const m = parseRecipe({
    type: 'create:mixing',
    heat_requirement: 'heated',
    ingredients: [{ item: 'minecraft:iron_ingot' }, { tag: 'c:dusts/redstone' }, { fluid: 'minecraft:lava', amount: 250 }],
    results: [{ id: 'minecraft:gold_ingot', count: 2, chance: 0.5 }],
    processing_time: 100,
    'neoforge:conditions': [{ type: 'neoforge:mod_loaded', modid: 'create' }],
  });
  assert.equal(m.kind, 'generic');
  assert.equal(m.slots.length, 3);
  assert.equal(m.slots[1].ingredient!.ids[0], '#c:dusts/redstone');
  assert.equal(m.results[0].id, 'minecraft:gold_ingot');
  assert.equal(m.results[0].chance, 0.5);
  assert.ok(m.properties.some((p) => p.key === 'processing_time'));
  assert.ok(m.properties.some((p) => p.key === 'heat_requirement'));
});

test('writeGrid trims and assigns key letters', () => {
  const j: any = { type: 'minecraft:crafting_shaped', key: {}, pattern: [] };
  writeGrid(
    j,
    [
      [null, null, null],
      [null, 'minecraft:diamond', 'minecraft:diamond'],
      [null, 'minecraft:stick', null],
    ],
    true,
  );
  assert.deepEqual(j.pattern, ['DD', 'S ']);
  assert.deepEqual(j.key, { D: 'minecraft:diamond', S: 'minecraft:stick' });
  // existing key letters are reused
  const k: any = { key: { '#': 'minecraft:diamond' }, pattern: ['#'] };
  writeGrid(k, [['minecraft:diamond', 'minecraft:dirt']], true);
  assert.deepEqual(k.pattern, ['#D']);
  // collision: two items starting with the same letter
  const c: any = {};
  writeGrid(c, [['minecraft:stone', 'minecraft:stick']], true);
  assert.equal(c.pattern[0].length, 2);
  assert.notEqual(c.pattern[0][0], c.pattern[0][1]);
});

test('setSlot on shaped grid writes version-correct syntax', () => {
  const base = { type: 'minecraft:crafting_shaped', key: { X: { item: 'minecraft:iron_ingot' } }, pattern: ['X'], result: { id: 'minecraft:x' }, 'fabric:load_conditions': [{ condition: 'x' }] };
  const a = setSlot(base, 'grid:1:1', 'minecraft:stick', F1211);
  assert.deepEqual(a.pattern, ['X ', ' S']);
  assert.deepEqual(a.key.S, { item: 'minecraft:stick' });
  assert.deepEqual(a['fabric:load_conditions'], [{ condition: 'x' }]);
  const b = setSlot({ ...base, key: { X: 'minecraft:iron_ingot' } }, 'grid:0:2', '#minecraft:planks', F263);
  assert.deepEqual(b.pattern, ['X P']);
  assert.equal(b.key.P, '#minecraft:planks');
  // clearing a cell trims and removes the unused key
  const c = setSlot(b, 'grid:0:0', null, F263);
  assert.deepEqual(c.pattern, ['P']);
  assert.deepEqual(Object.keys(c.key), ['P']);
  // no trim
  const d = setSlot(b, 'grid:0:0', null, F263, { trim: false });
  assert.deepEqual(d.pattern, ['  P', '   ', '   ']);
  // the original is never mutated
  assert.deepEqual(base.pattern, ['X']);
  assert.equal(slotRaw(b, 'grid:0:2'), '#minecraft:planks');
  assert.deepEqual(gridRaw(b)[0], ['minecraft:iron_ingot', null, '#minecraft:planks']);
});

test('setSlot on shapeless / fields / brewing', () => {
  const s = { type: 'minecraft:crafting_shapeless', ingredients: ['minecraft:a'], result: { id: 'minecraft:x' } };
  assert.deepEqual(setSlot(s, 'ing:5', 'minecraft:b', F263).ingredients, ['minecraft:a', 'minecraft:b']);
  assert.deepEqual(setSlot(s, 'ing:0', null, F263).ingredients, []);
  assert.deepEqual(setSlot(s, 'ing:0', { raw: { type: 'neoforge:compound', children: [] } }, F263).ingredients, [{ type: 'neoforge:compound', children: [] }]);
  const c = { type: 'minecraft:smelting', ingredient: { item: 'minecraft:potato' } };
  assert.deepEqual(setSlot(c, 'path:["ingredient"]', '#minecraft:logs', F1211).ingredient, { tag: 'minecraft:logs' });
  const b = { type: 'minecraft:brewing', input: { item: 'minecraft:potion', potion_contents: { potions: 'minecraft:awkward' } }, reagent: { item: 'minecraft:sugar' }, output: { id: 'minecraft:potion' } };
  const b2 = setSlot(b, 'brew:input', 'minecraft:splash_potion', F263);
  assert.deepEqual(b2.input, { item: 'minecraft:splash_potion', potion_contents: { potions: 'minecraft:awkward' } });
});

test('result editing keeps components and follows transmute rules', () => {
  const j = { type: 'minecraft:crafting_shapeless', ingredients: [], result: { id: 'minecraft:a', components: { 'minecraft:custom_name': 'x' } } };
  const a = setResultId(j, 'minecraft:b', F263);
  assert.deepEqual(a.result, { id: 'minecraft:b', components: { 'minecraft:custom_name': 'x' } });
  assert.equal(setResultCount(a, 4, F263).result.count, 4);
  assert.equal(setResultCount(setResultCount(a, 4, F263), 1, F263).result.count, undefined);
  const legacy = setResultId({ type: 'minecraft:smelting', result: { item: 'minecraft:a', count: 2 } }, 'minecraft:c', F263);
  assert.deepEqual(legacy.result, { id: 'minecraft:c', count: 2 });
  const t = { type: 'minecraft:crafting_transmute', input: 'a:a', material: 'b:b', result: 'minecraft:x' };
  assert.equal(setResultId(t, 'minecraft:y', F1214).result, 'minecraft:y');
  assert.deepEqual(setResultId(t, 'minecraft:y', F263).result, { id: 'minecraft:y' });
  assert.equal(setProperty(j, 'group', '').group, undefined);
  assert.equal(setProperty(j, 'group', 'g').group, 'g');
});

test('changeType keeps ingredients, result and unknown fields', () => {
  const shaped = { type: 'minecraft:crafting_shaped', category: 'misc', key: { A: 'minecraft:a', B: 'minecraft:b' }, pattern: ['AB'], result: { id: 'minecraft:x', count: 2 }, 'neoforge:conditions': [] };
  const sl = changeType(shaped, 'minecraft:crafting_shapeless', F263);
  assert.deepEqual(sl.ingredients, ['minecraft:a', 'minecraft:b']);
  assert.deepEqual(sl.result, { id: 'minecraft:x', count: 2 });
  assert.equal(sl.pattern, undefined);
  assert.deepEqual(sl['neoforge:conditions'], []);
  assert.equal(sl.category, 'misc');
  const sm = changeType(sl, 'minecraft:blasting', F263);
  assert.equal(sm.ingredient, 'minecraft:a');
  assert.equal(sm.cookingtime, 100);
  assert.equal(sm.category, 'misc');
  const back = changeType(sl, 'minecraft:crafting_shaped', F263);
  assert.deepEqual(back.pattern, ['AB']);
  const sc = changeType(sm, 'minecraft:stonecutting', F263);
  assert.equal(sc.category, undefined);
  assert.equal(sc.cookingtime, undefined);
  const trim = changeType({ type: 'minecraft:smithing_transform', template: 'minecraft:coast_armor_trim_smithing_template', base: 'a:b', addition: 'c:d', result: { id: 'x:y' } }, 'minecraft:smithing_trim', F263);
  assert.equal(trim.pattern, 'minecraft:coast');
  assert.equal(trim.result, undefined);
  const obj = changeType(shaped, 'minecraft:crafting_shapeless', F1211);
  assert.deepEqual(obj.ingredients, [{ item: 'minecraft:a' }, { item: 'minecraft:b' }]);
});

test('newRecipe templates are valid for the target version', () => {
  for (const f of [F1211, F12111, F263]) {
    for (const type of ['minecraft:crafting_shaped', 'minecraft:crafting_shapeless', 'minecraft:smelting', 'minecraft:stonecutting', 'minecraft:smithing_transform']) {
      const j = newRecipe(type, 'mymod:ruby', f);
      const m = parseRecipe(j, f);
      assert.deepEqual(
        m.warnings.filter((w) => w.severity === 'error'),
        [],
        `${type} @ ${f.version}: ${JSON.stringify(j)}`,
      );
      if (m.results.length) assert.equal(m.results[0].id, 'mymod:ruby');
    }
  }
  const brew = newRecipe('minecraft:brewing', 'minecraft:potion', F263);
  assert.deepEqual(parseRecipe(brew, F263).warnings, []);
});

test('jsonDiff produces minimal modifications', () => {
  const a = { type: 't', key: { A: 'x' }, pattern: ['A'], result: { id: 'r', count: 2 }, extra: 1 };
  const b = { type: 't', key: { A: 'x', B: 'y' }, pattern: ['AB'], result: { id: 'r' }, extra: 1 };
  const d = jsonDiff(a, b);
  assert.deepEqual(d, [
    { path: ['key', 'B'], value: 'y' },
    { path: ['pattern'], value: ['AB'] },
    { path: ['result', 'count'], value: undefined },
  ]);
  assert.deepEqual(jsonDiff(a, a), []);
});

test('trimPatternFromTemplate', () => {
  assert.equal(trimPatternFromTemplate('minecraft:bolt_armor_trim_smithing_template'), 'minecraft:bolt');
  assert.equal(trimPatternFromTemplate('mymod:fancy_armor_trim_smithing_template'), 'mymod:fancy');
  assert.equal(trimPatternFromTemplate('minecraft:netherite_upgrade_smithing_template'), undefined);
});

test('migrate 1.21.1 → 26.3', () => {
  const shaped = { type: 'minecraft:crafting_shaped', category: 'misc', key: { '#': { item: 'minecraft:acacia_planks' }, T: { tag: 'minecraft:logs' } }, pattern: ['# #', '#T#'], result: { count: 1, id: 'minecraft:acacia_boat' } };
  const r = migrateRecipe(shaped, F263);
  assert.ok(r.changed);
  assert.deepEqual(r.json.key, { '#': 'minecraft:acacia_planks', T: '#minecraft:logs' });
  assert.deepEqual(r.json.pattern, ['# #', '#T#']);
  // idempotent
  assert.equal(migrateRecipe(r.json, F263).changed, false);

  const smithingTrim = { type: 'minecraft:smithing_trim', addition: { tag: 'minecraft:trim_materials' }, base: { tag: 'minecraft:trimmable_armor' }, template: { item: 'minecraft:bolt_armor_trim_smithing_template' } };
  const t = migrateRecipe(smithingTrim, F263);
  assert.deepEqual(t.json, { type: 'minecraft:smithing_trim', addition: '#minecraft:trim_materials', base: '#minecraft:trimmable_armor', template: 'minecraft:bolt_armor_trim_smithing_template', pattern: 'minecraft:bolt' });

  const old = { type: 'minecraft:smelting', ingredient: [{ item: 'minecraft:coal' }, { item: 'minecraft:charcoal' }], result: { item: 'minecraft:x' }, cookingtime: 100 };
  const o = migrateRecipe(old, F263);
  assert.deepEqual(o.json.ingredient, ['minecraft:coal', 'minecraft:charcoal']);
  assert.deepEqual(o.json.result, { id: 'minecraft:x' });

  const legacyStonecut = { type: 'minecraft:stonecutting', ingredient: { item: 'minecraft:stone' }, result: 'minecraft:stone_slab', count: 2 };
  assert.deepEqual(migrateRecipe(legacyStonecut, F263).json, { type: 'minecraft:stonecutting', ingredient: 'minecraft:stone', result: { id: 'minecraft:stone_slab', count: 2 } });

  const dye = migrateRecipe({ type: 'minecraft:crafting_special_armordye', category: 'misc' }, F263, 'armor_dye');
  assert.equal(dye.json.type, 'minecraft:crafting_dye');
  assert.equal(dye.extra.length, 5);
  assert.equal(dye.extra[0].json.target, 'minecraft:leather_chestplate');

  const arrow = migrateRecipe({ type: 'minecraft:crafting_special_tippedarrow', category: 'misc' }, F263);
  assert.equal(arrow.json.type, 'minecraft:crafting_imbue');
  assert.equal(arrow.json.result.count, 8);

  const shulker = migrateRecipe({ type: 'minecraft:crafting_special_shulkerboxcoloring', category: 'misc' }, F263);
  assert.equal(shulker.json.type, 'minecraft:crafting_transmute');
  assert.deepEqual(shulker.json.result, { id: 'minecraft:white_shulker_box' });
  assert.equal(shulker.extra.length, 15);

  const book = migrateRecipe({ type: 'minecraft:crafting_special_bookcloning', category: 'misc' }, F263);
  assert.equal(book.json.source, 'minecraft:written_book');

  // custom ingredients survive untouched, unknown fields kept
  const custom = { type: 'minecraft:crafting_shapeless', ingredients: [{ type: 'neoforge:compound', children: [{ item: 'minecraft:a' }] }, { item: 'minecraft:b' }], result: { id: 'x:y' }, 'neoforge:conditions': [{ type: 'neoforge:true' }] };
  const c = migrateRecipe(custom, F263);
  assert.deepEqual(c.json.ingredients, [{ type: 'neoforge:compound', children: [{ item: 'minecraft:a' }] }, 'minecraft:b']);
  assert.deepEqual(c.json['neoforge:conditions'], [{ type: 'neoforge:true' }]);

  // modded types: object → string only
  const modded = migrateRecipe({ type: 'create:mixing', ingredients: [{ item: 'minecraft:a' }, { fluid: 'minecraft:water', amount: 10 }], results: [{ item: 'minecraft:b' }] }, F263);
  assert.ok(modded.modded);
  assert.deepEqual(modded.json.ingredients, ['minecraft:a', { fluid: 'minecraft:water', amount: 10 }]);
  assert.deepEqual(migrateRecipe({ type: 'create:mixing', ingredients: ['minecraft:a'] }, F1211).json.ingredients, ['minecraft:a']);
});

test('migrate 26.3 → 1.21.1 and 1.21.4', () => {
  const shaped = { type: 'minecraft:crafting_shaped', key: { '#': 'minecraft:stick', L: '#minecraft:logs' }, pattern: ['#L'], result: { id: 'minecraft:x' } };
  assert.deepEqual(migrateRecipe(shaped, F1211).json.key, { '#': { item: 'minecraft:stick' }, L: { tag: 'minecraft:logs' } });
  const transmute = { type: 'minecraft:crafting_transmute', input: '#minecraft:bundles', material: 'minecraft:black_dye', result: { id: 'minecraft:black_bundle' } };
  assert.equal(migrateRecipe(transmute, F1214).json.result, 'minecraft:black_bundle');
  const shapeless = migrateRecipe(transmute, F1211);
  assert.equal(shapeless.json.type, 'minecraft:crafting_shapeless');
  assert.deepEqual(shapeless.json.ingredients, [{ tag: 'minecraft:bundles' }, { item: 'minecraft:black_dye' }]);
  assert.ok(shapeless.notes.length);
  const dye = migrateRecipe({ type: 'minecraft:crafting_dye', dye: '#minecraft:dyes', target: 'minecraft:leather_boots', result: { id: 'minecraft:leather_boots' } }, F12111);
  assert.deepEqual(dye.json, { type: 'minecraft:crafting_special_armordye', category: 'misc' });
  const trim = migrateRecipe({ type: 'minecraft:smithing_trim', addition: 'a:a', base: 'b:b', pattern: 'minecraft:bolt', template: 'c:c' }, F1214);
  assert.equal(trim.json.pattern, undefined);
  const special = migrateRecipe({ type: 'minecraft:crafting_special_firework_rocket', fuel: 'minecraft:gunpowder', result: { count: 3, id: 'minecraft:firework_rocket' }, shell: 'minecraft:paper', star: 'minecraft:firework_star' }, F12111);
  assert.deepEqual(special.json, { type: 'minecraft:crafting_special_firework_rocket', category: 'misc' });
  const brew = migrateRecipe({ type: 'minecraft:brewing', input: {}, reagent: {}, output: { id: 'minecraft:potion' } }, F12111);
  assert.ok(brew.unsupported);
  assert.equal(brew.changed, false);
});
