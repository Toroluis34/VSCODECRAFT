import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recipeTypes, searchRecipes } from '../../src/features/recipes/browserSearch';
import type { BrowserData, BrowserEntry } from '../../src/features/recipes/protocol';

const e = (id: string, type: string, result: string, ingredients: string[], source: BrowserEntry['source'] = 'vanilla'): BrowserEntry => ({
  key: `${source}|${id}`,
  id,
  source,
  type,
  result,
  count: 1,
  ingredients,
});

const data: BrowserData = {
  version: '26.3',
  entries: [
    e('minecraft:iron_pickaxe', 'minecraft:crafting_shaped', 'minecraft:iron_pickaxe', ['minecraft:stick', '#minecraft:iron_tool_materials']),
    e('minecraft:iron_ingot_from_smelting_raw_iron', 'minecraft:smelting', 'minecraft:iron_ingot', ['minecraft:raw_iron']),
    e('minecraft:stick', 'minecraft:crafting_shaped', 'minecraft:stick', ['#minecraft:planks']),
    e('mymod:ruby_block', 'minecraft:crafting_shaped', 'mymod:ruby_block', ['mymod:ruby'], 'workspace'),
  ],
  tags: { '#minecraft:iron_tool_materials': ['minecraft:iron_ingot'], '#minecraft:planks': ['minecraft:oak_planks'] },
  names: {
    'minecraft:iron_pickaxe': 'Iron Pickaxe',
    'minecraft:iron_ingot': 'Iron Ingot',
    'minecraft:stick': 'Stick',
    'minecraft:raw_iron': 'Raw Iron',
    'minecraft:oak_planks': 'Oak Planks',
    'mymod:ruby_block': 'Block of Ruby',
    'mymod:ruby': 'Ruby',
  },
  vanillaAvailable: true,
  defaultNamespace: 'mymod',
};

test('how to craft by name and id', () => {
  assert.deepEqual(searchRecipes(data, { query: 'iron ingot', mode: 'craft' }).map((x) => x.id), ['minecraft:iron_ingot_from_smelting_raw_iron']);
  assert.deepEqual(searchRecipes(data, { query: 'minecraft:stick', mode: 'craft' }).map((x) => x.id), ['minecraft:stick']);
});

test('uses of an item resolves tags', () => {
  const uses = searchRecipes(data, { query: 'iron ingot', mode: 'uses' }).map((x) => x.id);
  assert.deepEqual(uses, ['minecraft:iron_pickaxe']);
  assert.deepEqual(searchRecipes(data, { query: 'oak planks', mode: 'uses' }).map((x) => x.id), ['minecraft:stick']);
  assert.deepEqual(searchRecipes(data, { query: '#minecraft:planks', mode: 'uses' }).map((x) => x.id), ['minecraft:stick']);
});

test('filters and ordering', () => {
  const all = searchRecipes(data, { query: '', mode: 'all' });
  assert.equal(all[0].source, 'workspace');
  assert.equal(searchRecipes(data, { query: '', mode: 'all', type: 'minecraft:smelting' }).length, 1);
  assert.equal(searchRecipes(data, { query: '', mode: 'all', source: 'workspace' }).length, 1);
  assert.deepEqual(searchRecipes(data, { query: 'ruby', mode: 'all' }).map((x) => x.id), ['mymod:ruby_block']);
  assert.deepEqual(recipeTypes(data.entries)[0], { type: 'minecraft:crafting_shaped', count: 3 });
});
