import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as jsonc from 'jsonc-parser';
import { SchemaStore, validate, findBrokenRefs, type ValidationError } from './miniValidator';
import { SCHEMA_MAPPINGS, schemaForPath, jsonValidationContributions } from '../../src/features/schemas/schemaMap';
import { checkVersionCompat } from '../../src/features/schemas/versionCheck';
import { getFeatures } from '../../src/core/versions';

const ROOT = path.resolve(__dirname, '../..');
const SCHEMA_DIR = path.join(ROOT, 'schemas/minecraft');
const FIXTURES = path.join(__dirname, 'fixtures');
const store = new SchemaStore(SCHEMA_DIR);

function check(schema: string, value: unknown): ValidationError[] {
  return validate(store, store.load(schema), value, path.join(SCHEMA_DIR, schema));
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== '.git' && e.name !== 'node_modules') walk(p, out);
    } else out.push(p);
  }
  return out;
}

/**
 * Parses JSON (trailing commas allowed) the way VS Code's JSON service sees numbers: a number written with a
 * fraction or exponent (`1.0`) is NOT an integer there, so nudge those values off the integer grid.
 */
export function parseLikeVsCode(text: string): unknown {
  const conv = (n: jsonc.Node): unknown => {
    switch (n.type) {
      case 'object':
        return Object.fromEntries((n.children ?? []).map((p) => [p.children![0].value, p.children![1] ? conv(p.children![1]) : null]));
      case 'array':
        return (n.children ?? []).map(conv);
      case 'number': {
        const raw = text.slice(n.offset, n.offset + n.length);
        return /[.eE]/.test(raw) && Number.isInteger(n.value) ? (n.value === 0 ? 1e-12 : n.value * (1 + 1e-12)) : n.value;
      }
      default:
        return n.value;
    }
  };
  const root = jsonc.parseTree(text, [], { allowTrailingComma: true });
  return root ? conv(root) : undefined;
}

/** Validates every mapped file under `dir`; returns "file: errors" strings. */
function validateTree(dir: string): { count: number; failures: string[] } {
  let count = 0;
  const failures: string[] = [];
  for (const file of walk(dir)) {
    const schema = schemaForPath(file);
    if (!schema) continue;
    // The vanilla client jar's own pack.mcmeta only declares languages (it isn't a user pack).
    if (path.basename(file) === 'pack.mcmeta' && !fs.readFileSync(file, 'utf8').includes('"pack"')) continue;
    count++;
    // Minecraft's JSON reader is lenient (vanilla has a few trailing commas).
    const errors = check(schema, parseLikeVsCode(fs.readFileSync(file, 'utf8')));
    if (errors.length) failures.push(`${path.relative(dir, file)} [${schema}]: ${errors.slice(0, 3).map((e) => `${e.path} ${e.message}`).join(' | ')}`);
  }
  return { count, failures };
}

test('every schema parses and every $ref resolves', () => {
  const files = fs.readdirSync(SCHEMA_DIR).filter((f) => f.endsWith('.json'));
  assert.ok(files.length >= 30, `expected >= 30 schemas, got ${files.length}`);
  for (const f of files) {
    const s = store.load(f);
    assert.equal(s.$schema, 'http://json-schema.org/draft-07/schema#', f);
    assert.deepEqual(findBrokenRefs(store, f), [], f);
  }
  for (const m of SCHEMA_MAPPINGS) assert.ok(fs.existsSync(path.join(SCHEMA_DIR, m.schema)), m.schema);
});

test('contributes.json jsonValidation is in sync with schemaMap.ts', () => {
  const c = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/features/schemas/contributes.json'), 'utf8'));
  assert.deepEqual(c.jsonValidation, jsonValidationContributions());
  for (const v of c.jsonValidation) assert.ok(fs.existsSync(path.join(ROOT, v.url)), v.url);
  assert.ok(c.languages.some((l: any) => l.id === 'json' && l.extensions.includes('.mcmeta')));
});

test('schemaForPath', () => {
  assert.equal(schemaForPath('/w/src/main/resources/data/mymod/recipe/ruby.json'), 'recipe.json');
  assert.equal(schemaForPath('C:\\mods\\x\\src\\generated\\resources\\data\\x\\recipes\\a\\b.json'), 'recipe.json');
  assert.equal(schemaForPath('/p/data/x/loot_tables/blocks/a.json'), 'loot_table.json');
  assert.equal(schemaForPath('/p/data/x/tags/item/logs.json'), 'tag.json');
  assert.equal(schemaForPath('/p/data/x/tags/worldgen/biome/a.json'), 'tag.json');
  assert.equal(schemaForPath('/p/data/x/worldgen/biome/plains.json'), 'biome.json');
  assert.equal(schemaForPath('/p/data/x/wolf_variant/pale.json'), 'mob_variant.json');
  assert.equal(schemaForPath('/p/assets/x/models/block/a.json'), 'model.json');
  assert.equal(schemaForPath('/p/assets/x/models/equipment/ruby.json'), 'equipment.json');
  assert.equal(schemaForPath('/p/assets/x/items/ruby.json'), 'item_definition.json');
  assert.equal(schemaForPath('/p/assets/x/lang/es_es.json'), 'lang.json');
  assert.equal(schemaForPath('/p/assets/x/lang/deprecated.json'), undefined);
  assert.equal(schemaForPath('/p/assets/x/sounds.json'), 'sounds.json');
  assert.equal(schemaForPath('/p/assets/x/textures/block/a.png.mcmeta'), 'texture_mcmeta.json');
  assert.equal(schemaForPath('/p/pack.mcmeta'), 'pack_mcmeta.json');
  assert.equal(schemaForPath('/p/src/main/resources/fabric.mod.json'), 'fabric_mod.json');
  assert.equal(schemaForPath('/p/data/x/datapacks/a/data/x/recipe/r.json'), 'recipe.json');
  assert.equal(schemaForPath('/p/data/x/function/a.mcfunction'), undefined);
  assert.equal(schemaForPath('/p/src/main/java/A.json'), undefined);
});

test('bundled vanilla samples (1.21.1, 1.21.4, 26.3) validate with zero errors', () => {
  const { count, failures } = validateTree(FIXTURES);
  assert.ok(count >= 300, `expected >= 300 fixture files, got ${count}`);
  assert.deepEqual(failures, []);
});

// Full vanilla check: VSCODECRAFT_MC_DATA=/path/a:/path/b npm test (clones of misode/mcmeta *-data / *-assets-json branches).
test('full vanilla data (VSCODECRAFT_MC_DATA)', { skip: !process.env.VSCODECRAFT_MC_DATA }, () => {
  for (const dir of (process.env.VSCODECRAFT_MC_DATA ?? '').split(path.delimiter).filter(Boolean)) {
    const { count, failures } = validateTree(dir);
    assert.ok(count > 0, dir);
    assert.deepEqual(failures.slice(0, 20), [], `${failures.length} invalid files in ${dir}`);
  }
});

test('invalid documents are reported', () => {
  const bad: [string, unknown][] = [
    ['recipe.json', { type: 'minecraft:crafting_shapd', pattern: ['#'], key: {}, result: { id: 'minecraft:stone' } }],
    ['recipe.json', { type: 'minecraft:crafting_shaped', pattern: ['#'], result: { id: 'minecraft:stone' } }],
    ['recipe.json', { type: 'minecraft:crafting_shaped', pattern: ['####'], key: { '#': 'minecraft:stick' }, result: { id: 'minecraft:stone' } }],
    ['recipe.json', { type: 'minecraft:crafting_shaped', pattern: ['#'], key: { '##': 'minecraft:stick' }, result: { id: 'minecraft:stone' } }],
    ['recipe.json', { type: 'minecraft:smelting', ingredient: 'minecraft:raw_iron', result: { id: 'minecraft:iron_ingot' }, cookingtime: 'fast' }],
    ['recipe.json', { type: 'minecraft:smelting', ingredient: 'Minecraft:Raw Iron', result: { id: 'minecraft:iron_ingot' } }],
    ['recipe.json', { type: 'minecraft:stonecutting', ingredient: { itme: 'minecraft:stone' }, result: { id: 'minecraft:stone_slab' } }],
    ['recipe.json', { type: 'minecraft:crafting_shapeless', ingredients: ['minecraft:stick'], result: { id: 'minecraft:stick', components: { 'minecraft:rarity': 'legendary' } } }],
    ['recipe.json', { type: 'minecraft:crafting_shapeless', ingredients: ['minecraft:stick'], result: { id: 'minecraft:stick', components: { 'minecraft:max_stack_size': 100 } } }],
    ['loot_table.json', { type: 'minecraft:block', pools: [{ rolls: 1, entries: [{ type: 'minecraft:itme', name: 'minecraft:stone' }] }] }],
    ['loot_table.json', { pools: [{ rolls: 1, entries: [{ type: 'minecraft:item' }] }] }],
    ['loot_table.json', { pools: [{ rolls: 1, entries: [{ type: 'minecraft:item', name: 'minecraft:stone', functions: [{ function: 'minecraft:set_cuont' }] }] }] }],
    ['loot_table.json', { pools: [{ rolls: 1, entries: [{ type: 'minecraft:item', name: 'minecraft:stone', conditions: [{ condition: 'minecraft:random_chance' }] }] }] }],
    ['loot_table.json', { pools: [{ rolls: 1, entries: [{ type: 'minecraft:item', name: 'minecraft:stone', modifier: { type: 'minecraft:set_count' } }] }] }],
    ['advancement.json', { criteria: { a: { trigger: 'minecraft:inventory_chnged' } } }],
    ['advancement.json', { criteria: {} }],
    ['advancement.json', { display: { icon: { id: 'minecraft:stone' }, title: 'x', description: 'y', frame: 'big' }, criteria: { a: { trigger: 'minecraft:tick' } } }],
    ['tag.json', { values: ['minecraft:Stone'] }],
    ['tag.json', { replace: false }],
    ['model.json', { parent: 'block/cube', elements: [{ from: [0, 0, 0], to: [16, 16, 16], faces: { north: { texture: '#a', rotation: 45 } } }] }],
    ['blockstate.json', { variants: { '': { model: 'x:block/a', y: 45 } } }],
    ['blockstate.json', { variants: { '': { y: 90 } } }],
    ['item_definition.json', { model: { type: 'minecraft:model' } }],
    ['item_definition.json', { model: { type: 'minecraft:condition', property: 'minecraft:using_item', on_true: { type: 'minecraft:empty' } } }],
    ['pack_mcmeta.json', { pack: { description: 'x' } }],
    ['pack_mcmeta.json', { pack: { pack_format: 'x', description: 'y' } }],
    ['texture_mcmeta.json', { animation: { frametime: 0 } }],
    ['fabric_mod.json', { schemaVersion: 1, id: 'My Mod', version: '1.0' }],
    ['enchantment.json', { description: 'x', supported_items: '#a', weight: 5000, max_level: 1, min_cost: { base: 1, per_level_above_first: 1 }, max_cost: { base: 1, per_level_above_first: 1 }, anvil_cost: 1, slots: ['hands'] }],
    ['damage_type.json', { message_id: 'x', exhaustion: 0, scaling: 'sometimes' }],
    ['sounds.json', { a: { sounds: [{ volume: 1 }] } }],
    ['lang.json', { 'item.x.y': 3 }],
  ];
  for (const [schema, doc] of bad) {
    assert.notDeepEqual(check(schema, doc), [], `${schema} should reject ${JSON.stringify(doc)}`);
  }
});

test('valid hand-written documents (both formats, mod types)', () => {
  const good: [string, unknown][] = [
    ['recipe.json', { type: 'mymod:custom_recipe', anything: 1 }],
    ['recipe.json', { type: 'crafting_shapeless', ingredients: [{ item: 'minecraft:stick' }, [{ tag: 'c:ingots' }]], result: { id: 'stone', count: 2 } }],
    ['recipe.json', { type: 'minecraft:crafting_shaped', pattern: ['# #'], key: { '#': { type: 'neoforge:components', items: 'minecraft:stick' } }, result: { id: 'minecraft:stone' } }],
    ['recipe.json', { type: 'minecraft:crafting_transmute', input: '#minecraft:shulker_boxes', material: 'minecraft:red_dye', result: 'minecraft:red_shulker_box' }],
    ['loot_table.json', { type: 'mymod:custom', pools: [{ rolls: 1, entries: [{ type: 'mymod:entry' }], functions: [{ function: 'mymod:fn' }] }] }],
    ['loot_table.json', { pools: [{ rolls: { min: 1, max: 2 }, entries: [{ type: 'minecraft:item', name: 'minecraft:stone', functions: [{ function: 'minecraft:set_loot_table', type: 'minecraft:chest', name: 'minecraft:chests/x' }] }] }] }],
    ['item_modifier.json', [{ function: 'minecraft:set_count', count: 2 }, { function: 'minecraft:set_components', components: { 'minecraft:custom_model_data': { floats: [1] }, '!minecraft:food': {} } }]],
    ['predicate.json', [{ condition: 'minecraft:weather_check', raining: true }, 'mymod:other']],
    ['advancement.json', { criteria: { a: { trigger: 'mymod:custom', conditions: { foo: 1 } } } }],
    ['pack_mcmeta.json', { pack: { description: { text: 'x', color: 'gold' }, min_format: [94, 1], max_format: 121 } }],
    ['fabric_mod.json', { schemaVersion: 1, id: 'mymod', version: '${version}', depends: { minecraft: ['~1.21', '>=26.1'] } }],
  ];
  for (const [schema, doc] of good) assert.deepEqual(check(schema, doc), [], `${schema}: ${JSON.stringify(doc)}`);
});

const SNIPPET_SCHEMAS: [RegExp, string][] = [
  [/^mc-recipe-/, 'recipe.json'], [/^mc-loot-/, 'loot_table.json'], [/^mc-advancement/, 'advancement.json'], [/^mc-tag/, 'tag.json'],
  [/^mc-predicate-/, 'predicate.json'], [/^mc-item-modifier-/, 'item_modifier.json'], [/^mc-enchantment/, 'enchantment.json'],
  [/^mc-damage-type/, 'damage_type.json'], [/^mc-painting-variant/, 'painting_variant.json'], [/^mc-jukebox-song/, 'jukebox_song.json'],
  [/^mc-trim-pattern/, 'trim_pattern.json'], [/^mc-trim-material/, 'trim_material.json'], [/^mc-item-definition/, 'item_definition.json'],
  [/^mc-model-/, 'model.json'], [/^mc-blockstate/, 'blockstate.json'], [/^mc-equipment/, 'equipment.json'], [/^mc-sounds-json/, 'sounds.json'],
  [/^mc-mcmeta-animation/, 'texture_mcmeta.json'], [/^mc-atlas/, 'atlas.json'], [/^mc-particle/, 'particle.json'], [/^mc-lang/, 'lang.json'],
  [/^mc-pack-mcmeta/, 'pack_mcmeta.json'], [/^mc-fabric-mod-json/, 'fabric_mod.json'],
];

/** Expands a snippet body with its default values. */
function expandSnippet(body: string): string {
  const defaults = new Map<string, string>();
  let s = body.replace(/\$\{(\d+)\|([^,|}]*)[^}]*\}/g, (_, n, first) => (defaults.set(n, first), first));
  // innermost placeholders first
  for (let i = 0; i < 5; i++) s = s.replace(/\$\{(\d+):([^${}]*)\}/g, (_, n, d) => (defaults.set(n, d), d));
  s = s.replace(/\$\{(\d+)\}/g, (_, n) => defaults.get(n) ?? 'x').replace(/\$(\d+)/g, '').replace(/\\\$/g, '$');
  return s;
}

test('snippets: valid JSON after expansion and accepted by their schema', () => {
  const snippets = JSON.parse(fs.readFileSync(path.join(ROOT, 'snippets/json-minecraft.json'), 'utf8'));
  const prefixes = new Set<string>();
  for (const [name, sn] of Object.entries<any>(snippets)) {
    assert.ok(sn.prefix.startsWith('mc-'), name);
    assert.ok(!prefixes.has(sn.prefix), `duplicate prefix ${sn.prefix}`);
    prefixes.add(sn.prefix);
    const text = expandSnippet(sn.body.join('\n'));
    let doc: unknown;
    assert.doesNotThrow(() => (doc = JSON.parse(text)), `${name} expands to invalid JSON:\n${text}`);
    const schema = SNIPPET_SCHEMAS.find(([re]) => re.test(sn.prefix))?.[1];
    assert.ok(schema, `no schema mapped for snippet ${sn.prefix}`);
    assert.deepEqual(check(schema!, doc), [], `${sn.prefix}`);
  }
  assert.ok(prefixes.size >= 50);
});

test('version compatibility checks', () => {
  const v1211 = getFeatures('1.21.1');
  const v263 = getFeatures('26.3');
  const codes = (schema: string, doc: unknown, f = v1211) => checkVersionCompat(schema, JSON.stringify(doc, null, 2), f).map((i) => i.code);
  assert.deepEqual(codes('recipe.json', { type: 'minecraft:crafting_transmute' }), ['recipeTooNew']);
  assert.deepEqual(codes('recipe.json', { type: 'minecraft:crafting_transmute' }, v263), []);
  assert.deepEqual(codes('recipe.json', { type: 'brewing' }, getFeatures('26.2')), ['recipeTooNew']);
  assert.deepEqual(codes('recipe.json', { type: 'minecraft:crafting_special_armordye' }, v263), ['recipeRemoved']);
  assert.deepEqual(codes('item_definition.json', { model: {} }), ['itemDefinitionsTooNew']);
  assert.deepEqual(codes('item_definition.json', { model: {} }, v263), []);
  assert.deepEqual(codes('pack_mcmeta.json', { pack: { pack_format: 48, description: '' } }, v263), ['packNeedsMinMax']);
  assert.deepEqual(codes('pack_mcmeta.json', { pack: { min_format: 1, max_format: 2, description: '' } }), ['packNeedsPackFormat']);
  assert.deepEqual(codes('pack_mcmeta.json', { pack: { pack_format: 48, description: '' } }), []);
  const doc = { type: 'minecraft:crafting_shapeless', result: { id: 'a', components: { 'minecraft:custom_model_data': 3, 'minecraft:hide_tooltip': {} } } };
  assert.deepEqual(codes('recipe.json', doc, v263), ['customModelDataObject', 'componentRemoved']);
  assert.deepEqual(codes('recipe.json', doc), []);
  assert.deepEqual(codes('loot_table.json', { pools: [{ functions: [{ function: 'set_components', components: { custom_model_data: { floats: [1] } } }] }] }), ['customModelDataInt']);
  // offsets point at the offending node
  const text = '{"type": "minecraft:brewing"}';
  const [issue] = checkVersionCompat('recipe.json', text, v1211);
  assert.equal(text.slice(issue.offset, issue.offset + issue.length), '"minecraft:brewing"');
});
