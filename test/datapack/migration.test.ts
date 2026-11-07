import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applicableRules,
  itemDefinitionFor,
  migrateContent,
  migrateDensityFunction,
  migrateEntityPredicate,
  migrateGameruleName,
  migratePath,
  migrateTextEvents,
  planMigration,
  RULES,
} from '../../src/features/datapack/migration';

const run = (path: string, value: unknown, from: string, to: string) => {
  const r = migrateContent({ path, text: JSON.stringify(value) }, applicableRules(from, to));
  return { value: r.text ? JSON.parse(r.text) : value, changedBy: r.changedBy, notes: r.notes };
};

test('rules are sorted and filtered by version', () => {
  assert.ok(applicableRules('1.20.4', '1.21').some((r) => r.id === 'folders-singular'));
  assert.ok(!applicableRules('1.21', '1.21.1').some((r) => r.id === 'folders-singular'));
  assert.ok(!applicableRules('26.2', '26.3').some((r) => r.id === 'entity-predicates-26.2'));
  const ids = RULES.map((r) => r.id);
  assert.ok(ids.indexOf('entity-predicates-26.2') < ids.indexOf('loot-format-26.3'));
});

test('legacy folders and tag renames compose', () => {
  const rules = applicableRules('1.20.4', '26.3');
  assert.equal(migratePath('data/ns/recipes/a.json', rules).path, 'data/ns/recipe/a.json');
  assert.equal(migratePath('data/ns/tags/items/x.json', rules).path, 'data/ns/tags/item/x.json');
  // dead_bush_may_place_on → dry_vegetation_may_place_on (1.21.5) → supports_dry_vegetation (26.1)
  assert.equal(migratePath('data/minecraft/tags/blocks/dead_bush_may_place_on.json', rules).path, 'data/minecraft/tags/block/supports_dry_vegetation.json');
  assert.equal(migratePath('data/ns/worldgen/configured_feature/ore.json', rules).path, 'data/ns/worldgen/feature/ore.json');
  assert.equal(migratePath('assets/ns/models/equipment/ruby.json', rules).path, 'assets/ns/equipment/ruby.json');
});

test('loot table 1.21.11 → 26.3 matches vanilla wheat.json', () => {
  const old = {
    type: 'minecraft:block',
    functions: [{ function: 'minecraft:explosion_decay' }],
    pools: [
      {
        bonus_rolls: 0.0,
        conditions: [{ block: 'minecraft:wheat', condition: 'minecraft:block_state_property', properties: { age: '7' } }],
        entries: [
          {
            type: 'minecraft:item',
            functions: [{ enchantment: 'minecraft:fortune', formula: 'minecraft:binomial_with_bonus_count', function: 'minecraft:apply_bonus', parameters: { extra: 3, probability: 0.5714286 } }],
            name: 'minecraft:wheat_seeds',
          },
          {
            type: 'minecraft:item',
            conditions: [{ condition: 'minecraft:survives_explosion' }, { condition: 'minecraft:reference', name: 'ns:my_pred' }],
            functions: [{ function: 'minecraft:set_count', count: { min: 1, max: 2 } }],
            name: 'minecraft:wheat',
          },
          { type: 'minecraft:tag', name: 'minecraft:logs', expand: true },
        ],
        rolls: { min: 1, max: 3 },
      },
    ],
  };
  const { value, changedBy } = run('data/ns/loot_table/blocks/wheat.json', old, '1.21.11', '26.3');
  assert.deepEqual(changedBy, ['loot-format-26.3']);
  assert.deepEqual(value.modifier, { type: 'minecraft:explosion_decay' });
  const pool = value.pools[0];
  assert.deepEqual(pool.condition, { type: 'minecraft:match_block', blocks: 'minecraft:wheat', state: { age: '7' } });
  assert.equal(pool.conditions, undefined);
  assert.deepEqual(pool.entries[0].modifier, {
    type: 'minecraft:apply_bonus',
    enchantment: 'minecraft:fortune',
    formula: 'minecraft:binomial_with_bonus_count',
    parameters: { extra: 3, probability: 0.5714286 },
  });
  assert.deepEqual(pool.entries[1].condition, { type: 'minecraft:all_of', terms: [{ type: 'minecraft:survives_explosion' }, 'ns:my_pred'] });
  assert.deepEqual(pool.entries[1].modifier.count, { type: 'minecraft:uniform', min: 1, max: 2 });
  assert.deepEqual(pool.entries[2], { type: 'minecraft:tag', items: 'minecraft:logs', expand: true });
  assert.deepEqual(pool.rolls, { type: 'minecraft:uniform', min: 1, max: 3 });
});

test('predicate files: list → all_of', () => {
  const { value } = run('data/ns/predicate/p.json', [{ condition: 'minecraft:random_chance', chance: 0.5 }, { condition: 'minecraft:weather_check', raining: true }], '1.21.11', '26.3');
  assert.deepEqual(value, { type: 'minecraft:all_of', terms: [{ type: 'minecraft:random_chance', chance: 0.5 }, { type: 'minecraft:weather_check', raining: true }] });
});

test('advancement 1.21.11 → 26.3 matches vanilla walk_on_powder_snow_with_leather_boots', () => {
  const old = {
    criteria: {
      c: {
        conditions: {
          player: [
            {
              condition: 'minecraft:entity_properties',
              entity: 'this',
              predicate: { equipment: { feet: { items: 'minecraft:leather_boots' } }, stepping_on: { block: { blocks: 'minecraft:powder_snow' } } },
            },
          ],
        },
        trigger: 'minecraft:location',
      },
      d: { conditions: { entity: { type: 'minecraft:zombie', type_specific: { type: 'slime', size: 2 } } }, trigger: 'minecraft:player_killed_entity' },
    },
  };
  const { value } = run('data/ns/advancement/a.json', old, '1.21.11', '26.3');
  assert.deepEqual(value.criteria.c.conditions.player, {
    type: 'minecraft:entity_properties',
    entity: 'this',
    predicate: { 'minecraft:equipment': { feet: { items: 'minecraft:leather_boots' } }, 'minecraft:stepping_on': { block: { blocks: 'minecraft:powder_snow' } } },
  });
  assert.deepEqual(value.criteria.d.conditions.entity, {
    type: 'minecraft:entity_properties',
    entity: 'this',
    predicate: { 'minecraft:entity_type': 'minecraft:zombie', 'minecraft:type_specific/cube_mob': { size: 2 } },
  });
});

test('entity predicate nested vehicle', () => {
  const notes: any[] = [];
  assert.deepEqual(migrateEntityPredicate({ vehicle: { type: 'minecraft:pig' }, type_specific: { type: 'minecraft:cat', variant: 'x' } }, notes), {
    'minecraft:vehicle': { 'minecraft:entity_type': 'minecraft:pig' },
    'minecraft:type_specific/cat': { variant: 'x' },
  });
  assert.equal(notes.length, 1);
});

test('components 1.21.1 → 1.21.5 (verified against item_components summaries)', () => {
  const old = {
    function: 'minecraft:set_components',
    components: {
      'minecraft:enchantments': { levels: { 'minecraft:sharpness': 2 }, show_in_tooltip: false },
      'minecraft:attribute_modifiers': { modifiers: [{ type: 'minecraft:generic.attack_damage', amount: 2, id: 'ns:x', operation: 'add_value' }] },
      'minecraft:dyed_color': { rgb: 255 },
      'minecraft:unbreakable': {},
      'minecraft:hide_tooltip': {},
      'minecraft:fire_resistant': {},
      'minecraft:custom_model_data': 7,
      'minecraft:item_name': '{"text":"Ruby"}',
      'minecraft:jukebox_playable': { song: 'minecraft:cat' },
    },
  };
  const { value } = run('data/ns/item_modifier/m.json', old, '1.21.1', '1.21.5');
  assert.deepEqual(value.components, {
    'minecraft:enchantments': { 'minecraft:sharpness': 2 },
    'minecraft:attribute_modifiers': [{ type: 'minecraft:attack_damage', amount: 2, id: 'ns:x', operation: 'add_value' }],
    'minecraft:dyed_color': 255,
    'minecraft:unbreakable': {},
    'minecraft:damage_resistant': { types: '#minecraft:is_fire' },
    'minecraft:custom_model_data': { floats: [7] },
    'minecraft:item_name': { text: 'Ruby' },
    'minecraft:jukebox_playable': 'minecraft:cat',
    'minecraft:tooltip_display': { hide_tooltip: true, hidden_components: ['minecraft:enchantments'] },
  });
});

test('text events 1.21.5', () => {
  assert.deepEqual(migrateTextEvents({ text: 'a', clickEvent: { action: 'run_command', value: '/say hi' }, hoverEvent: { action: 'show_text', contents: 'tip' } }), {
    text: 'a',
    click_event: { action: 'run_command', command: '/say hi' },
    hover_event: { action: 'show_text', value: 'tip' },
  });
  assert.deepEqual(migrateTextEvents({ hoverEvent: { action: 'show_entity', contents: { type: 'minecraft:pig', id: 'u-u-i-d' } } }), {
    hover_event: { action: 'show_entity', id: 'minecraft:pig', uuid: 'u-u-i-d' },
  });
  assert.deepEqual(migrateTextEvents({ clickEvent: { action: 'change_page', value: '3' } }), { click_event: { action: 'change_page', page: 3 } });
});

test('density functions 26.3 (verified with overworld/depth.json)', () => {
  const notes: any[] = [];
  const old = { type: 'minecraft:add', argument1: { type: 'minecraft:y_clamped_gradient', from_value: 1.5, from_y: -64, to_value: -1.5, to_y: 320 }, argument2: 'minecraft:overworld/offset' };
  const { value } = run('data/ns/worldgen/density_function/overworld/depth.json', old, '1.21.11', '26.3');
  assert.deepEqual(value, {
    type: 'minecraft:add',
    left: { type: 'minecraft:gradient', axis: 'y', from_coordinate: -64, from_value: 1.5, to_coordinate: 320, to_value: -1.5 },
    right: 'minecraft:overworld/offset',
  });
  assert.deepEqual(migrateDensityFunction({ type: 'minecraft:flat_cache', argument: 1 }, notes), { type: 'minecraft:cache', input: 1 });
  assert.equal(notes.length, 1);
});

test('configured feature inline config 26.3', () => {
  const old = { type: 'minecraft:ore', config: { size: 9, targets: [], state_provider: { type: 'minecraft:simple_state_provider', state: { Name: 'minecraft:stone' } } } };
  const { value } = run('data/ns/worldgen/configured_feature/ore.json', old, '26.1', '26.3');
  assert.deepEqual(value, { type: 'minecraft:ore', size: 9, targets: [], state_provider: { type: 'minecraft:simple', state: { Name: 'minecraft:stone' } } });
});

test('gamerules in functions 1.21.11', () => {
  const rules = applicableRules('1.21.10', '1.21.11');
  const r = migrateContent({ path: 'data/ns/function/load.mcfunction', text: 'gamerule keepInventory true\nexecute run gamerule disableRaids true\ngamerule doDaylightCycle\n' }, rules);
  assert.equal(r.text, 'gamerule keep_inventory true\nexecute run gamerule raids false\ngamerule advance_time\n');
  assert.equal(migrateGameruleName('playersSleepingPercentage'), 'players_sleeping_percentage');
  assert.equal(migrateGameruleName('doMobLoot'), 'mob_drops');
});

test('tag references are renamed in json and functions', () => {
  const { value } = run('data/ns/tags/block/x.json', { values: ['#minecraft:mushroom_grow_block', 'minecraft:stone'] }, '1.21.11', '26.1');
  assert.deepEqual(value.values, ['#minecraft:overrides_mushroom_light_requirement', 'minecraft:stone']);
  const r = migrateContent({ path: 'data/ns/function/f.mcfunction', text: 'execute if block ~ ~ ~ #minecraft:concrete_powder run say x' }, applicableRules('26.1', '26.2'));
  assert.equal(r.text, 'execute if block ~ ~ ~ #minecraft:concrete_powders run say x');
});

test('item definitions from item models (1.21.4)', () => {
  assert.deepEqual(itemDefinitionFor('ns', 'ruby', { parent: 'item/generated' }).definition, { model: { type: 'minecraft:model', model: 'ns:item/ruby' } });
  const cmd = itemDefinitionFor('minecraft', 'stick', {
    overrides: [
      { predicate: { custom_model_data: 2 }, model: 'ns:item/b' },
      { predicate: { custom_model_data: 1 }, model: 'ns:item/a' },
    ],
  }).definition;
  assert.equal(cmd.model.type, 'minecraft:range_dispatch');
  assert.deepEqual(cmd.model.entries.map((e: any) => e.threshold), [1, 2]);
  const plan = planMigration(
    [
      { path: 'assets/ns/models/item/ruby.json', text: '{"parent":"item/generated"}' },
      { path: 'assets/ns/models/item/sapphire.json', text: '{}' },
      { path: 'assets/ns/items/sapphire.json', text: '{}' },
      { path: 'assets/minecraft/models/item/stick.json', text: '{"parent":"item/handheld"}' },
    ],
    '1.21.1',
    '1.21.4',
  );
  const creates = plan.filter((a) => a.type === 'create');
  assert.deepEqual(creates.map((c) => c.path), ['assets/ns/items/ruby.json']);
});

test('planMigration produces renames, edits and keeps formatting indent', () => {
  const plan = planMigration([{ path: 'data/ns/loot_tables/a.json', text: '{\n    "pools": [{"rolls": 1, "entries": [], "functions": [{"function": "minecraft:furnace_smelt"}]}]\n}' }], '1.20.6', '26.3');
  assert.ok(plan.some((a) => a.type === 'rename' && a.newPath === 'data/ns/loot_table/a.json'));
  assert.ok(plan.some((a) => a.type === 'edit' && a.rule === 'loot-format-26.3'));
  const r = migrateContent({ path: 'data/ns/loot_tables/a.json', text: '{\n    "pools": []\n, "functions": [{"function": "minecraft:furnace_smelt"}]}' }, applicableRules('1.20.6', '26.3'));
  assert.ok(r.text!.startsWith('{\n    "pools"'));
});
