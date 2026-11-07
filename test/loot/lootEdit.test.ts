import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { applyLootEdit, newLootTable } from '../../src/features/loot/lootEdit';

const text = (name: string) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');

test('add pool keeps existing content and format', () => {
  const legacy = applyLootEdit(text('diamond_ore_1.21.1.json'), { op: 'addPool' }, 'legacy');
  const j = JSON.parse(legacy);
  assert.equal(j.pools.length, 2);
  assert.deepEqual(j.pools[1], { bonus_rolls: 0, entries: [], rolls: 1 });
  assert.equal(j.random_sequence, 'minecraft:blocks/diamond_ore'); // unknown fields preserved
  const modern = JSON.parse(applyLootEdit('{"type":"minecraft:block"}', { op: 'addPool' }, 'modern'));
  assert.deepEqual(modern.pools, [{ entries: [], rolls: 1 }]);
});

test('add entry, set weight, set name, delete', () => {
  let t = text('simple_dungeon_26.3.json');
  t = applyLootEdit(t, { op: 'addEntry', pool: 0, item: 'minecraft:diamond', weight: 3 }, 'modern');
  let j = JSON.parse(t);
  const last = j.pools[0].entries.length - 1;
  assert.deepEqual(j.pools[0].entries[last], { type: 'minecraft:item', name: 'minecraft:diamond', weight: 3 });
  t = applyLootEdit(t, { op: 'setWeight', path: ['pools', 0, 'entries', last], weight: 7 }, 'modern');
  t = applyLootEdit(t, { op: 'setName', path: ['pools', 0, 'entries', last], name: 'minecraft:emerald' }, 'modern');
  j = JSON.parse(t);
  assert.equal(j.pools[0].entries[last].weight, 7);
  assert.equal(j.pools[0].entries[last].name, 'minecraft:emerald');
  t = applyLootEdit(t, { op: 'addEntry', pool: 0, item: '#minecraft:logs' }, 'modern');
  j = JSON.parse(t);
  assert.deepEqual(j.pools[0].entries.at(-1), { type: 'minecraft:tag', name: 'minecraft:logs', expand: true });
  t = applyLootEdit(t, { op: 'deleteEntry', path: ['pools', 0, 'entries', 0] }, 'modern');
  j = JSON.parse(t);
  assert.equal(j.pools[0].entries[0].name, 'minecraft:golden_apple');
  t = applyLootEdit(t, { op: 'deletePool', pool: 1 }, 'modern');
  assert.equal(JSON.parse(t).pools.length, 2);
});

test('set count edits an existing set_count (single modifier object or list)', () => {
  let t = text('simple_dungeon_26.3.json');
  t = applyLootEdit(t, { op: 'setCount', path: ['pools', 0, 'entries', 0], count: { min: 2, max: 6 } }, 'modern');
  const j = JSON.parse(t);
  assert.deepEqual(j.pools[0].entries[0].modifier.count, { type: 'minecraft:uniform', max: 6, min: 2 });
  // legacy list
  let z = text('zombie_1.21.1.json');
  z = applyLootEdit(z, { op: 'setCount', path: ['pools', 0, 'entries', 0], count: 4 }, 'legacy');
  const zj = JSON.parse(z);
  assert.equal(zj.pools[0].entries[0].functions[0].count, 4);
  assert.equal(zj.pools[0].entries[0].functions[1].function, 'minecraft:enchanted_count_increase');
});

test('set count adds a set_count function in the right format', () => {
  // no functions yet (modern)
  let t = applyLootEdit(text('simple_dungeon_26.3.json'), { op: 'setCount', path: ['pools', 0, 'entries', 1], count: 3 }, 'modern');
  let e = JSON.parse(t).pools[0].entries[1];
  assert.deepEqual(e.modifier, [{ type: 'minecraft:set_count', count: 3 }]);
  // single non-count modifier object -> becomes a list with set_count first
  t = applyLootEdit(text('simple_dungeon_26.3.json'), { op: 'setCount', path: ['pools', 0, 'entries', 11], count: { min: 1, max: 2 } }, 'modern');
  e = JSON.parse(t).pools[0].entries[11];
  assert.equal(e.modifier.length, 2);
  assert.equal(e.modifier[0].type, 'minecraft:set_count');
  assert.equal(e.modifier[1].type, 'minecraft:enchant_randomly');
  // legacy list without set_count
  t = applyLootEdit(text('diamond_ore_1.21.1.json'), { op: 'setCount', path: ['pools', 0, 'entries', 0, 'children', 1], count: 2 }, 'legacy');
  e = JSON.parse(t).pools[0].entries[0].children[1];
  assert.deepEqual(e.functions[0], { function: 'minecraft:set_count', count: 2 });
  assert.equal(e.functions.length, 3);
  // count 1 without a set_count is a no-op
  const same = text('simple_dungeon_26.3.json');
  assert.equal(applyLootEdit(same, { op: 'setCount', path: ['pools', 0, 'entries', 1], count: 1 }, 'modern'), same);
});

test('setRolls and new table skeleton', () => {
  const t = applyLootEdit(text('diamond_ore_26.3.json'), { op: 'setRolls', pool: 0, rolls: { min: 1, max: 3 } }, 'modern');
  assert.deepEqual(JSON.parse(t).pools[0].rolls, { type: 'minecraft:uniform', max: 3, min: 1 });
  assert.deepEqual(newLootTable('minecraft:chest', 'legacy'), { type: 'minecraft:chest', pools: [{ bonus_rolls: 0, entries: [], rolls: 1 }] });
});
