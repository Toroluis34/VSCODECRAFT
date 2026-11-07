import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  analyzeLootTable,
  conditionChance,
  countDistribution,
  DEFAULT_CONTEXT,
  detectLootFormat,
  lootFormatForVersion,
  meanDist,
  npIntDist,
  npText,
  referencedIds,
  seededRandom,
  simulateLootTable,
  summarizeCondition,
  summarizeFunction,
  type LootContext,
} from '../../src/features/loot/lootModel';

const fixture = (name: string) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'));
const ctx = (o: Partial<LootContext> = {}): LootContext => ({ ...DEFAULT_CONTEXT, ...o });
const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b} (±${eps})`);

test('format detection and version mapping', () => {
  assert.equal(lootFormatForVersion('1.21.1'), 'legacy');
  assert.equal(lootFormatForVersion('26.2'), 'legacy');
  assert.equal(lootFormatForVersion('26.3'), 'modern');
  assert.equal(lootFormatForVersion('26.4-snapshot-7'), 'modern');
  assert.equal(detectLootFormat(fixture('diamond_ore_26.3.json'), '1.21.1'), 'modern');
  assert.equal(detectLootFormat(fixture('diamond_ore_1.21.1.json'), '26.3'), 'legacy');
  assert.equal(detectLootFormat({ pools: [] }, '26.3'), 'modern');
  assert.equal(detectLootFormat({ pools: [] }, '1.21.4'), 'legacy');
});

test('number providers', () => {
  assert.equal(npText(2), '2');
  assert.equal(npText({ type: 'minecraft:uniform', min: 1, max: 3 }), '1–3');
  assert.equal(npText({ type: 'minecraft:binomial', n: 3, p: 0.5 }), 'B(3, 0.5)');
  close(meanDist(npIntDist({ type: 'minecraft:uniform', min: 1, max: 3 })!), 2);
  close(meanDist(npIntDist({ min: 0, max: 2 })!), 1); // type omitted -> uniform
  close(meanDist(npIntDist({ type: 'minecraft:binomial', n: 3, p: 0.53333336 })!), 1.6);
  const d = npIntDist(2.0)!;
  assert.deepEqual([...d], [[2, 1]]);
  assert.equal(npIntDist({ type: 'minecraft:score', target: 'this', score: 'x' }), undefined);
});

test('diamond ore: silk touch, fortune (both formats)', () => {
  for (const f of ['diamond_ore_26.3.json', 'diamond_ore_1.21.1.json']) {
    const json = fixture(f);
    const plain = analyzeLootTable(json, { ctx: ctx() });
    const alt = plain.pools[0].entries[0];
    assert.equal(alt.type, 'alternatives');
    assert.equal(alt.children!.length, 2);
    assert.equal(alt.children![0].conditions[0].hint, 'silk');
    close(alt.children![0].chance!, 0);
    close(alt.children![1].chance!, 1);
    close(alt.children![1].expectedPerRoll!, 1);
    const silk = analyzeLootTable(json, { ctx: ctx({ silkTouch: true }) });
    close(silk.pools[0].entries[0].children![0].chance!, 1);
    close(silk.pools[0].entries[0].children![1].chance!, 0);
    // Fortune III ore formula: multipliers 1,1,2,3,4 -> mean 2.2
    const fortune = analyzeLootTable(json, { ctx: ctx({ fortune: 3 }) });
    close(fortune.pools[0].entries[0].children![1].expectedPerRoll!, 2.2);
    assert.deepEqual(fortune.pools[0].entries[0].children![1].countRange, [1, 4]);
    // function summaries
    const fns = plain.pools[0].entries[0].children![1].functions;
    assert.equal(fns[0].type, 'apply_bonus');
    assert.equal(fns[0].hint, 'fortune');
    assert.equal(fns[1].type, 'explosion_decay');
  }
});

test('zombie: looting, killed by player, rare drops (both formats)', () => {
  for (const f of ['zombie_26.3.json', 'zombie_1.21.1.json']) {
    const json = fixture(f);
    const v = analyzeLootTable(json, { ctx: ctx() });
    const flesh = v.pools[0].entries[0];
    assert.equal(flesh.name, 'minecraft:rotten_flesh');
    assert.equal(flesh.countText, '0–2');
    close(flesh.expectedPerRoll!, 1);
    const looting = analyzeLootTable(json, { ctx: ctx({ looting: 3 }) });
    close(looting.pools[0].entries[0].expectedPerRoll!, 2.5, 0.05);
    // rare drops pool: killed by player && 2.5% chance, three equally weighted entries
    const rare = v.pools.find((p) => p.entries.some((e) => e.name === 'minecraft:iron_ingot'))!;
    close(rare.poolChance, 0.025);
    close(rare.entries[0].chance!, 0.025 / 3);
    const notPlayer = analyzeLootTable(json, { ctx: ctx({ killedByPlayer: false }) });
    const rare2 = notPlayer.pools.find((p) => p.entries.some((e) => e.name === 'minecraft:iron_ingot'))!;
    close(rare2.poolChance, 0);
    // Looting III: 0.035 + 0.01*2
    const rare3 = looting.pools.find((p) => p.entries.some((e) => e.name === 'minecraft:iron_ingot'))!;
    close(rare3.poolChance, 0.055);
  }
});

test('weighted chest pool + uniform rolls', () => {
  const v = analyzeLootTable(fixture('simple_dungeon_26.3.json'), { ctx: ctx() });
  const p = v.pools[0];
  assert.equal(p.rollsText, '1–3');
  close(p.rollsMean, 2);
  assert.equal(p.totalWeight, 144);
  const tag = p.entries.find((e) => e.name === 'minecraft:name_tag')!;
  close(tag.chance!, 20 / 144);
  close(tag.expectedPerTable!, (20 / 144) * 2);
  const leather = p.entries.find((e) => e.name === 'minecraft:leather')!;
  close(leather.expectedPerRoll!, (20 / 144) * 3);
  assert.equal(p.entries.find((e) => e.name === 'minecraft:book')!.functions[0].type, 'enchant_randomly');
});

test('oak leaves: predicate references, inverted, table_bonus', () => {
  const json = fixture('oak_leaves_26.3.json');
  const v = analyzeLootTable(json, { ctx: ctx() });
  const sapling = v.pools[0].entries[0].children![1];
  close(sapling.chance!, 0.05);
  const v2 = analyzeLootTable(json, { ctx: ctx({ fortune: 3 }) });
  close(v2.pools[0].entries[0].children![1].chance!, 0.1);
  const shears = analyzeLootTable(json, { ctx: ctx({ shears: true }) });
  close(shears.pools[0].entries[0].children![0].chance!, 1);
  close(shears.pools[1].poolChance, 0); // sticks need NOT (shears or silk)
  const s = summarizeCondition(json.pools[1].condition);
  assert.equal(s.type, 'inverted');
  assert.equal(s.children![0].type, 'any_of');
  assert.deepEqual(s.children![0].children!.map((c) => c.hint), ['shears', 'silk']);
});

test('summaries', () => {
  assert.deepEqual(summarizeFunction({ function: 'minecraft:set_count', count: { min: 1, max: 3 } }), { type: 'set_count', text: 'Count: {0}', args: ['1–3'] });
  assert.equal(summarizeFunction({ type: 'minecraft:set_count', count: 1, add: true }).text, 'Add {0} to the count');
  assert.equal(summarizeFunction({ type: 'minecraft:set_name', name: { text: 'Bob' }, target: 'custom_name' }).args![0], 'Bob');
  assert.equal(summarizeFunction({ type: 'minecraft:set_components', components: { 'minecraft:trim': {} } }).args![0], 'trim');
  const conditional = summarizeFunction({ type: 'minecraft:furnace_smelt', condition: { type: 'minecraft:killed_by_player' } });
  assert.equal(conditional.children![0].children![0].hint, 'player');
  assert.equal(summarizeCondition({ condition: 'minecraft:random_chance', chance: 0.125 }).args![0], '12.5%');
  assert.equal(summarizeCondition('minecraft:tool/can_silk_touch').hint, 'silk');
  assert.equal(summarizeCondition({ type: 'minecraft:weird' }).text, 'Condition {0}');
});

test('condition chances', () => {
  close(conditionChance({ type: 'minecraft:any_of', terms: [{ type: 'minecraft:random_chance', chance: 0.5 }, { type: 'minecraft:random_chance', chance: 0.5 }] }, ctx()), 0.75);
  close(conditionChance({ type: 'minecraft:all_of', terms: [{ type: 'minecraft:random_chance', chance: 0.5 }, { type: 'minecraft:killed_by_player' }] }, ctx()), 0.5);
  close(conditionChance({ condition: 'minecraft:random_chance_with_looting', chance: 0.025, looting_multiplier: 0.01 }, ctx({ looting: 2 })), 0.045);
  close(conditionChance({ type: 'minecraft:entity_properties' }, ctx({ unknown: 'fail' })), 0);
  close(conditionChance({ type: 'minecraft:entity_properties' }, ctx({ unknown: 'pass' })), 1);
});

test('count distributions: bonus formulas and limits', () => {
  const uni = countDistribution([{ type: 'minecraft:apply_bonus', enchantment: 'minecraft:fortune', formula: 'minecraft:uniform_bonus_count', parameters: { bonusMultiplier: 1 } }], ctx({ fortune: 2 }));
  close(meanDist(uni), 2); // 1 + U{0..2}
  const bin = countDistribution([{ type: 'minecraft:apply_bonus', enchantment: 'minecraft:fortune', formula: 'minecraft:binomial_with_bonus_count', parameters: { extra: 3, probability: 0.5 } }], ctx({ fortune: 1 }));
  close(meanDist(bin), 3); // 1 + B(4, .5)
  const lim = countDistribution([{ type: 'minecraft:set_count', count: { min: 1, max: 5 } }, { type: 'minecraft:limit_count', limit: { max: 2 } }], ctx());
  close(meanDist(lim), (1 + 2 + 2 + 2 + 2) / 5);
  const half = countDistribution([{ type: 'minecraft:set_count', count: 3, condition: { type: 'minecraft:random_chance', chance: 0.5 } }], ctx());
  close(meanDist(half), 2);
});

test('expanded tags split the weight between members', () => {
  const table = { pools: [{ rolls: 1, entries: [{ type: 'minecraft:tag', name: 'minecraft:discs', expand: true }, { type: 'minecraft:item', name: 'minecraft:stick' }] }] };
  const v = analyzeLootTable(table, { tagMembers: { '#minecraft:discs': ['a:1', 'a:2', 'a:3'] } });
  close(v.pools[0].entries[0].chance!, 0.75);
  close(v.pools[0].entries[1].chance!, 0.25);
  const sim = simulateLootTable(table, ctx(), 4000, { rng: seededRandom(1), tagMembers: { '#minecraft:discs': ['a:1', 'a:2', 'a:3'] } });
  assert.equal(sim.drops.length, 4);
  const stick = sim.drops.find((d) => d.id === 'minecraft:stick')!;
  close(stick.total / 4000, 0.25, 0.03);
});

test('Monte Carlo matches the analytic expectation', () => {
  const json = fixture('diamond_ore_26.3.json');
  const r = simulateLootTable(json, ctx({ fortune: 3 }), 20000, { rng: seededRandom(42) });
  const d = r.drops.find((x) => x.id === 'minecraft:diamond')!;
  close(d.total / r.runs, 2.2, 0.05);
  assert.equal(d.min, 1);
  assert.equal(d.max, 4);
  const chest = simulateLootTable(fixture('simple_dungeon_26.3.json'), ctx(), 5000, { rng: seededRandom(7) });
  const tag = chest.drops.find((x) => x.id === 'minecraft:name_tag')!;
  close(tag.total / chest.runs, (20 / 144) * 2, 0.03);
  // nested loot tables are resolved through the callback
  const parent = { pools: [{ rolls: 2, entries: [{ type: 'minecraft:loot_table', value: 'x:child' }] }] };
  const child = { pools: [{ rolls: 1, entries: [{ type: 'minecraft:item', name: 'minecraft:apple' }] }] };
  const n = simulateLootTable(parent, ctx(), 10, { rng: seededRandom(3), resolveTable: (id) => (id === 'x:child' ? child : undefined) });
  assert.equal(n.drops[0].id, 'minecraft:apple');
  assert.equal(n.drops[0].total, 20);
  const unresolved = simulateLootTable(parent, ctx(), 1, { rng: seededRandom(3) });
  assert.equal(unresolved.drops[0].id, 'loot_table:x:child');
});

test('referenced ids', () => {
  const r = referencedIds(fixture('simple_dungeon_26.3.json'));
  assert.ok(r.items.has('minecraft:name_tag'));
  const z = referencedIds({ pools: [{ entries: [{ type: 'minecraft:tag', name: 'minecraft:x' }, { type: 'minecraft:loot_table', value: 'a:b' }] }] });
  assert.ok(z.tags.has('#minecraft:x'));
  assert.ok(z.tables.has('a:b'));
});
