import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addEntry, moveEntry, nestedTags, parseTag, removeEntry, serializeTag, setRequired, tagFilePath } from '../../src/features/datapack/tagUtils';
import { CmdNode, registryForParser, suggest, tokenize } from '../../src/features/datapack/commandTree';

test('tag file paths', () => {
  assert.equal(tagFilePath('block', 'minecraft:mineable/pickaxe', '26.3'), 'data/minecraft/tags/block/mineable/pickaxe.json');
  assert.equal(tagFilePath('item', '#c:ingots/ruby', '1.20.4'), 'data/c/tags/items/ingots/ruby.json');
  assert.equal(tagFilePath('worldgen/biome', 'mymod:hot', '1.21'), 'data/mymod/tags/worldgen/biome/hot.json');
});

test('tag edit operations', () => {
  let t = parseTag({ values: ['minecraft:stone', { id: 'mymod:x', required: false }, 42] });
  assert.equal(t.values.length, 2);
  t = addEntry(t, 'minecraft:dirt');
  t = addEntry(t, 'minecraft:dirt');
  t = addEntry(t, '#c:ores', false);
  assert.deepEqual(t.values, ['minecraft:stone', { id: 'mymod:x', required: false }, 'minecraft:dirt', { id: '#c:ores', required: false }]);
  t = setRequired(t, 'mymod:x', true);
  t = removeEntry(t, 'minecraft:stone');
  t = moveEntry(t, '#c:ores', -1);
  assert.deepEqual(t.values, ['mymod:x', { id: '#c:ores', required: false }, 'minecraft:dirt']);
  assert.deepEqual(nestedTags(t), ['c:ores']);
  assert.equal(serializeTag({ ...t, replace: true }), JSON.stringify({ replace: true, values: t.values }, null, 2) + '\n');
  assert.ok(!serializeTag({ ...t, replace: false }).includes('replace'));
});

const tree: CmdNode = {
  type: 'root',
  children: {
    give: {
      type: 'literal',
      children: {
        targets: { type: 'argument', parser: 'minecraft:entity', children: { item: { type: 'argument', parser: 'minecraft:item_stack', executable: true } } },
      },
    },
    execute: {
      type: 'literal',
      children: {
        as: { type: 'literal', children: { targets: { type: 'argument', parser: 'minecraft:entity', redirect: ['execute'] } } },
        positioned: { type: 'literal', children: { pos: { type: 'argument', parser: 'minecraft:vec3', redirect: ['execute'] } } },
        run: { type: 'literal' },
      },
    },
    say: { type: 'literal', children: { message: { type: 'argument', parser: 'minecraft:message', executable: true } } },
    tp: { type: 'literal', redirect: ['give'] },
  },
};

test('tokenize keeps brackets together', () => {
  assert.deepEqual(tokenize('give @a[tag=a, limit=1] stone{a:"b c"} 2').map((t) => t.text), ['give', '@a[tag=a, limit=1]', 'stone{a:"b c"}', '2']);
});

test('command suggestions walk the tree', () => {
  assert.deepEqual(suggest(tree, 'ex')!.literals, ['execute']);
  assert.deepEqual(suggest(tree, '')!.literals.sort(), ['execute', 'give', 'say', 'tp']);
  assert.deepEqual(suggest(tree, 'execute ')!.literals.sort(), ['as', 'positioned', 'run']);
  assert.deepEqual(suggest(tree, 'execute as @s positioned ~ ~1 ~ r')!.literals, ['run']);
  assert.deepEqual(suggest(tree, 'execute as @s run g')!.literals, ['give']);
  assert.deepEqual(suggest(tree, '$execute run give @s ')!.args.map((a) => a.parser), ['minecraft:item_stack']);
  assert.deepEqual(suggest(tree, 'tp @s ')!.args.map((a) => a.name), ['item']);
  assert.deepEqual(suggest(tree, 'say hello wor')!.literals, []);
  assert.equal(suggest(tree, '# comment'), undefined);
  const s = suggest(tree, '  execute ru')!;
  assert.equal(s.replaceStart, 10);
  assert.equal(registryForParser('minecraft:resource', { registry: 'minecraft:entity_type' }), 'entity_type');
});
