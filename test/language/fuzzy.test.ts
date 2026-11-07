import { test } from 'node:test';
import assert from 'node:assert/strict';
import { closestMatches, levenshtein } from '../../src/features/language/fuzzy';
import { convertIngredient, findIngredients, ingredientFormatOf, inlineJson } from '../../src/features/language/ingredients';
import { intToRgba, isColorPath, rgbaToInt, toHex } from '../../src/features/language/colorUtils';
import * as jsonc from 'jsonc-parser';

test('levenshtein', () => {
  assert.equal(levenshtein('kitten', 'sitting'), 3);
  assert.equal(levenshtein('abc', 'abc'), 0);
  assert.equal(levenshtein('abcdef', 'x', 2), 3);
});

test('closestMatches', () => {
  const ids = ['minecraft:diamond', 'minecraft:diamond_block', 'minecraft:dirt', 'mymod:ruby', 'mymod:ruby_block', 'minecraft:stone'];
  assert.equal(closestMatches('minecraft:diamon', ids)[0], 'minecraft:diamond');
  assert.equal(closestMatches('minecraft:ruby', ids)[0], 'mymod:ruby');
  assert.equal(closestMatches('mymod:block_ruby', ids)[0], 'mymod:ruby_block');
  assert.deepEqual(closestMatches('minecraft:completely_different', ids), []);
});

test('ingredient formats', () => {
  assert.equal(ingredientFormatOf('minecraft:a'), 'string');
  assert.equal(ingredientFormatOf({ item: 'minecraft:a' }), 'object');
  assert.equal(ingredientFormatOf([{ tag: 'x:y' }, { item: 'a' }]), 'object');
  assert.equal(ingredientFormatOf({ type: 'neoforge:components' }), undefined);
  assert.equal(convertIngredient({ tag: 'minecraft:logs' }, 'string'), '#minecraft:logs');
  assert.deepEqual(convertIngredient([{ item: 'a' }, { item: 'b' }], 'string'), ['a', 'b']);
  assert.equal(convertIngredient([{ item: 'a' }], 'string'), 'a');
  assert.equal(convertIngredient([{ item: 'a' }, { tag: 'b' }], 'string'), undefined);
  assert.deepEqual(convertIngredient('#minecraft:logs', 'object'), { tag: 'minecraft:logs' });
  assert.deepEqual(convertIngredient(['a', 'b'], 'object'), [{ item: 'a' }, { item: 'b' }]);
  assert.equal(inlineJson({ item: 'a' }), '{ "item": "a" }');
  const tree = jsonc.parseTree('{"type":"minecraft:crafting_shaped","key":{"#":{"item":"a"},"X":"b"},"result":{"id":"c"}}');
  assert.deepEqual(findIngredients(tree).map((i) => i.format), ['object', 'string']);
  assert.equal(findIngredients(jsonc.parseTree('{"type":"minecraft:brewing","input":{"item":"a"}}')).length, 0);
});

test('colours', () => {
  assert.equal(isColorPath(['components', 'minecraft:dyed_color']), true);
  assert.equal(isColorPath(['explosions', 0, 'colors', 1]), true);
  assert.equal(isColorPath(['model', 'tints', 0, 'value'], { type: 'minecraft:constant' }), true);
  assert.equal(isColorPath(['functions', 0, 'value'], { function: 'x' }), false);
  assert.equal(isColorPath(['count']), false);
  assert.equal(toHex(intToRgba(16711680)), '#ff0000');
  const argb = intToRgba(-12012264);
  assert.equal(rgbaToInt(argb, true), -12012264);
  assert.equal(rgbaToInt(intToRgba(0x00ff00), false), 0x00ff00);
});

test('placeholder png', async () => {
  const { placeholderPng } = await import('../../src/features/language/png');
  const png = placeholderPng();
  assert.deepEqual([...png.slice(1, 4)], [0x50, 0x4e, 0x47]);
  assert.ok(png.length > 50);
});
