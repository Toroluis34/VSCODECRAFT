import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  balanced,
  buildComponents,
  componentsJson,
  f32,
  giveCommand,
  lootEntryJson,
  normalizeAttribute,
  parseHexColor,
  quoteSnbt,
  RawSnbt,
  recipeResultJson,
  setComponentsFunction,
  summonCommand,
  textValue,
  toJsonValue,
  toSnbt,
  tooltipLines,
  type ItemSpec,
} from '../../src/features/loot/components';

const sword = (o: Partial<ItemSpec> = {}): ItemSpec => ({ id: 'minecraft:diamond_sword', count: 1, ...o });

test('SNBT serialization', () => {
  assert.equal(quoteSnbt('abc'), '"abc"');
  assert.equal(quoteSnbt('say "hi"'), `'say "hi"'`);
  assert.equal(quoteSnbt(`it's "x"`), `"it's \\"x\\""`);
  assert.equal(quoteSnbt('a\\b'), '"a\\\\b"');
  assert.equal(toSnbt({ a: 1, 'minecraft:x': true, s: 'v', f: f32(1.5), l: [1, 2] }), '{a:1,"minecraft:x":true,s:"v",f:1.5f,l:[1,2]}');
  assert.equal(toSnbt(new RawSnbt(' {a:1b} ')), '{a:1b}');
  assert.deepEqual(toJsonValue({ f: f32(2), r: new RawSnbt('{a:1b}') }), { f: 2, r: '{a:1b}' });
  assert.equal(toSnbt([]), '[]');
  assert.equal(toSnbt({}), '{}');
});

test('text components: objects since 1.21.5, JSON strings before', () => {
  const t = { text: 'Excalibur', color: 'gold', italic: false };
  assert.deepEqual(textValue(t, '1.21.5'), { text: 'Excalibur', color: 'gold', italic: false });
  assert.equal(textValue({ text: 'plain' }, '26.3'), 'plain');
  assert.equal(textValue(t, '1.21.4'), '{"text":"Excalibur","color":"gold","italic":false}');
  assert.equal(
    giveCommand(sword({ customName: t }), '26.3'),
    '/give @p minecraft:diamond_sword[custom_name={text:"Excalibur",color:"gold",italic:false}]',
  );
  assert.equal(
    giveCommand(sword({ customName: t }), '1.21.1'),
    `/give @p minecraft:diamond_sword[custom_name='{"text":"Excalibur","color":"gold","italic":false}']`,
  );
  assert.equal(
    giveCommand(sword({ lore: [{ text: 'line 1' }, { text: 'two', color: 'red' }] }), '26.1'),
    '/give @p minecraft:diamond_sword[lore=["line 1",{text:"two",color:"red"}]]',
  );
  // JSON outputs: object vs string
  assert.deepEqual(componentsJson(sword({ customName: { text: 'A', bold: true } }), '1.21.1'), { 'minecraft:custom_name': '{"text":"A","bold":true}' });
  assert.deepEqual(componentsJson(sword({ customName: { text: 'A', bold: true } }), '1.21.11'), { 'minecraft:custom_name': { text: 'A', bold: true } });
});

test('enchantments and tooltip visibility per version', () => {
  const e = { enchantments: [{ id: 'sharpness', level: 5 }] };
  assert.equal(giveCommand(sword(e), '1.21.4'), '/give @p minecraft:diamond_sword[enchantments={levels:{"minecraft:sharpness":5}}]');
  assert.equal(giveCommand(sword(e), '1.21.5'), '/give @p minecraft:diamond_sword[enchantments={"minecraft:sharpness":5}]');
  const hidden = { ...e, hiddenComponents: ['minecraft:enchantments'] };
  assert.equal(giveCommand(sword(hidden), '1.21.1'), '/give @p minecraft:diamond_sword[enchantments={levels:{"minecraft:sharpness":5},show_in_tooltip:false}]');
  assert.equal(
    giveCommand(sword(hidden), '26.3'),
    '/give @p minecraft:diamond_sword[enchantments={"minecraft:sharpness":5},tooltip_display={hidden_components:["minecraft:enchantments"]}]',
  );
  // enchanted books store enchantments
  assert.ok(giveCommand({ id: 'enchanted_book', count: 1, ...e }, '26.3').includes('stored_enchantments={"minecraft:sharpness":5}'));
  // hide the whole tooltip
  assert.equal(giveCommand(sword({ hideTooltip: true }), '1.21.4'), '/give @p minecraft:diamond_sword[hide_tooltip={}]');
  assert.equal(giveCommand(sword({ hideTooltip: true }), '1.21.5'), '/give @p minecraft:diamond_sword[tooltip_display={hide_tooltip:true}]');
  // other components hidden before 1.21.5 -> hide_additional_tooltip
  const potion = { id: 'minecraft:potion', count: 1, potion: { potion: 'minecraft:swiftness' }, hiddenComponents: ['minecraft:potion_contents'] };
  assert.ok(giveCommand(potion, '1.21.1').endsWith('hide_additional_tooltip={}]'));
  // levels are clamped with a warning
  const bad = buildComponents(sword({ enchantments: [{ id: 'sharpness', level: 300 }] }), '26.3');
  assert.equal(bad.warnings.length, 1);
  assert.deepEqual(toJsonValue(bad.components['minecraft:enchantments']), { 'minecraft:sharpness': 255 });
});

test('custom_model_data: int before 1.21.4, object after', () => {
  const cmd = { customModelData: { floats: [12] } };
  assert.equal(giveCommand(sword(cmd), '1.21.3'), '/give @p minecraft:diamond_sword[custom_model_data=12]');
  assert.equal(giveCommand(sword(cmd), '1.21.4'), '/give @p minecraft:diamond_sword[custom_model_data={floats:[12f]}]');
  const full = { customModelData: { floats: [1.5], flags: [true], strings: ['red'], colors: [0xff0000] } };
  assert.equal(giveCommand(sword(full), '26.3'), '/give @p minecraft:diamond_sword[custom_model_data={floats:[1.5f],flags:[true],strings:["red"],colors:[16711680]}]');
  assert.equal(buildComponents(sword(full), '1.21.1').warnings.length, 1);
});

test('unbreakable, dyed colour, trim, attributes per version', () => {
  assert.equal(giveCommand(sword({ unbreakable: true }), '1.21.1'), '/give @p minecraft:diamond_sword[unbreakable={}]');
  assert.equal(giveCommand(sword({ unbreakable: true, hiddenComponents: ['minecraft:unbreakable'] }), '1.21.1'), '/give @p minecraft:diamond_sword[unbreakable={show_in_tooltip:false}]');
  const boots = { id: 'minecraft:leather_boots', count: 1, dyedColor: 0xff0000 };
  assert.equal(giveCommand(boots, '1.21.4'), '/give @p minecraft:leather_boots[dyed_color={rgb:16711680}]');
  assert.equal(giveCommand(boots, '1.21.5'), '/give @p minecraft:leather_boots[dyed_color=16711680]');
  const trim = { id: 'minecraft:iron_chestplate', count: 1, trim: { material: 'gold', pattern: 'minecraft:bolt' } };
  assert.equal(giveCommand(trim, '26.3'), '/give @p minecraft:iron_chestplate[trim={material:"minecraft:gold",pattern:"minecraft:bolt"}]');
  const attrs: Partial<ItemSpec> = { attributes: [{ type: 'minecraft:attack_damage', amount: 10, operation: 'add_value', slot: 'mainhand' }], namespace: 'mymod' };
  assert.equal(
    giveCommand(sword(attrs), '26.3'),
    '/give @p minecraft:diamond_sword[attribute_modifiers=[{type:"minecraft:attack_damage",amount:10,id:"mymod:attack_damage_mainhand",operation:"add_value",slot:"mainhand"}]]',
  );
  assert.equal(
    giveCommand(sword({ ...attrs, attributes: [{ type: 'minecraft:generic.attack_damage', amount: 10, operation: 'add_value', slot: 'mainhand' }] }), '1.21.1'),
    '/give @p minecraft:diamond_sword[attribute_modifiers={modifiers:[{type:"minecraft:generic.attack_damage",amount:10,id:"mymod:attack_damage_mainhand",operation:"add_value",slot:"mainhand"}]}]',
  );
  assert.equal(normalizeAttribute('minecraft:generic.max_health', '1.21.2'), 'minecraft:max_health');
  assert.equal(normalizeAttribute('generic.max_health', '1.21.1'), 'minecraft:generic.max_health');
  assert.equal(normalizeAttribute('minecraft:attack_damage', '1.21.1'), 'minecraft:generic.attack_damage');
  assert.equal(normalizeAttribute('minecraft:block_interaction_range', '1.21.1'), 'minecraft:player.block_interaction_range');
  assert.equal(normalizeAttribute('mymod:mana', '1.21.1'), 'mymod:mana');
  // duplicate generated ids get a suffix
  const two = buildComponents(sword({ attributes: [{ type: 'armor', amount: 1, operation: 'add_value', slot: 'head' }, { type: 'armor', amount: 2, operation: 'add_value', slot: 'head' }] }), '26.3');
  const ids = (toJsonValue(two.components['minecraft:attribute_modifiers']) as any[]).map((m) => m.id);
  assert.deepEqual(ids, ['minecraft:armor_head', 'minecraft:armor_head_2']);
});

test('food / consumable split in 1.21.2', () => {
  const food: Partial<ItemSpec> = {
    id: 'minecraft:apple',
    food: { nutrition: 4, saturation: 2.4, canAlwaysEat: true, eatSeconds: 3, effects: [{ id: 'speed', duration: 200, amplifier: 1, probability: 0.5 }], convertsTo: 'bowl' },
  };
  const old = componentsJson(sword(food), '1.21.1');
  assert.deepEqual(old, {
    'minecraft:food': {
      nutrition: 4,
      saturation: 2.4,
      can_always_eat: true,
      eat_seconds: 3,
      using_converts_to: { id: 'minecraft:bowl' },
      effects: [{ effect: { id: 'minecraft:speed', amplifier: 1, duration: 200 }, probability: 0.5 }],
    },
  });
  const neu = componentsJson(sword(food), '1.21.2');
  assert.deepEqual(neu, {
    'minecraft:food': { nutrition: 4, saturation: 2.4, can_always_eat: true },
    'minecraft:consumable': {
      consume_seconds: 3,
      on_consume_effects: [{ type: 'minecraft:apply_effects', effects: [{ id: 'minecraft:speed', amplifier: 1, duration: 200 }], probability: 0.5 }],
    },
    'minecraft:use_remainder': { id: 'minecraft:bowl' },
  });
  assert.equal(
    giveCommand({ id: 'minecraft:apple', count: 1, food: { nutrition: 1, saturation: 0.5 } }, '26.3'),
    '/give @p minecraft:apple[food={nutrition:1,saturation:0.5f},consumable={}]',
  );
});

test('item model, rarity, stack size, damage, tool, potion, fireworks, custom data', () => {
  assert.equal(giveCommand(sword({ itemModel: 'mymod:ruby_sword' }), '1.21.4'), '/give @p minecraft:diamond_sword[item_model="mymod:ruby_sword"]');
  const w = buildComponents(sword({ itemModel: 'mymod:ruby_sword' }), '1.21.1');
  assert.equal(Object.keys(w.components).length, 0);
  assert.equal(w.warnings.length, 1);
  assert.equal(
    giveCommand(sword({ rarity: 'epic', maxDamage: 100, damage: 10, maxStackSize: 1 }), '26.3'),
    '/give @p minecraft:diamond_sword[rarity="epic",max_stack_size=1,max_damage=100,damage=10]',
  );
  assert.equal(buildComponents(sword({ maxDamage: 10, maxStackSize: 16 }), '26.3').warnings.length, 1);
  const tool = giveCommand(sword({ tool: { defaultMiningSpeed: 1, damagePerBlock: 2, rules: [{ blocks: '#minecraft:mineable/pickaxe', speed: 8, correctForDrops: true }, { blocks: 'stone, dirt' }] } }), '26.3');
  assert.equal(tool, '/give @p minecraft:diamond_sword[tool={rules:[{blocks:"#minecraft:mineable/pickaxe",speed:8f,correct_for_drops:true},{blocks:["minecraft:stone","minecraft:dirt"]}],default_mining_speed:1f,damage_per_block:2}]');
  assert.equal(
    giveCommand({ id: 'minecraft:potion', count: 1, potion: { potion: 'swiftness', customColor: 0x00ff00, effects: [{ id: 'minecraft:luck', duration: 600, amplifier: 0 }] } }, '26.3'),
    '/give @p minecraft:potion[potion_contents={potion:"minecraft:swiftness",custom_color:65280,custom_effects:[{id:"minecraft:luck",duration:600}]}]',
  );
  const fw = { flightDuration: 2, explosions: [{ shape: 'star' as const, colors: [0xff0000], fadeColors: [0x0000ff], trail: true }] };
  assert.equal(
    giveCommand({ id: 'minecraft:firework_rocket', count: 3, fireworks: fw }, '26.3'),
    '/give @p minecraft:firework_rocket[fireworks={flight_duration:2,explosions:[{shape:"star",colors:[16711680],fade_colors:[255],has_trail:true}]}] 3',
  );
  assert.equal(giveCommand({ id: 'minecraft:firework_star', count: 1, fireworks: fw }, '26.3'), '/give @p minecraft:firework_star[firework_explosion={shape:"star",colors:[16711680],fade_colors:[255],has_trail:true}]');
  assert.equal(giveCommand(sword({ customData: '{mymod:{level:3b,tags:["a"]}}' }), '26.3'), '/give @p minecraft:diamond_sword[custom_data={mymod:{level:3b,tags:["a"]}}]');
  assert.deepEqual(componentsJson(sword({ customData: '{a:1b}' }), '26.3'), { 'minecraft:custom_data': '{a:1b}' });
  assert.equal(buildComponents(sword({ customData: 'a:1' }), '26.3').warnings.length, 1);
  assert.equal(balanced('{a:"}"}'), true);
  assert.equal(balanced('{a:[1}'), false);
});

test('other outputs: summon, loot entry, set_components, recipe result', () => {
  const spec = sword({ count: 2, unbreakable: true });
  assert.equal(summonCommand(spec, '26.3'), '/summon minecraft:item ~ ~1 ~ {Item:{id:"minecraft:diamond_sword",count:2,components:{"minecraft:unbreakable":{}}}}');
  assert.deepEqual(lootEntryJson(spec, '26.3'), {
    type: 'minecraft:item',
    name: 'minecraft:diamond_sword',
    modifier: [
      { type: 'minecraft:set_components', components: { 'minecraft:unbreakable': {} } },
      { type: 'minecraft:set_count', count: 2 },
    ],
  });
  assert.deepEqual(lootEntryJson(spec, '1.21.1'), {
    type: 'minecraft:item',
    name: 'minecraft:diamond_sword',
    functions: [
      { function: 'minecraft:set_components', components: { 'minecraft:unbreakable': {} } },
      { function: 'minecraft:set_count', count: 2 },
    ],
  });
  assert.deepEqual(lootEntryJson({ id: 'stone', count: 1 }, '26.3'), { type: 'minecraft:item', name: 'minecraft:stone' });
  assert.deepEqual(setComponentsFunction(spec, '1.21.11'), { function: 'minecraft:set_components', components: { 'minecraft:unbreakable': {} } });
  assert.deepEqual(recipeResultJson(spec, '26.3'), { id: 'minecraft:diamond_sword', count: 2, components: { 'minecraft:unbreakable': {} } });
  assert.deepEqual(recipeResultJson({ id: 'stone', count: 1 }, '26.3'), { id: 'minecraft:stone' });
  assert.equal(giveCommand({ id: 'stone', count: 64 }, '26.3', '@a'), '/give @a minecraft:stone 64');
  assert.equal(parseHexColor('#FF8800'), 0xff8800);
  assert.equal(parseHexColor('zz'), undefined);
});

test('tooltip lines', () => {
  const lang = {
    'enchantment.minecraft.sharpness': 'Sharpness',
    'enchantment.level.5': 'V',
    'item.modifiers.mainhand': 'When in Main Hand:',
    'attribute.name.attack_damage': 'Attack Damage',
    'attribute.modifier.plus.0': '+%s %s',
    'attribute.modifier.equals.0': '%s %s',
    'item.unbreakable': 'Unbreakable',
    'item.durability': 'Durability: %s / %s',
    'item.components': '%s component(s)',
  };
  const spec = sword({
    customName: { text: 'Blade', color: 'red', italic: false },
    enchantments: [{ id: 'sharpness', level: 5 }],
    lore: [{ text: 'Old' }],
    attributes: [{ type: 'minecraft:attack_damage', amount: 3, operation: 'add_value', slot: 'mainhand' }],
    unbreakable: true,
  });
  const lines = tooltipLines(spec, '26.3', { lang, itemName: 'Diamond Sword', advanced: true });
  const text = lines.map((l) => l.map((r) => r.text).join(''));
  assert.deepEqual(text, ['Blade', 'Sharpness V', 'Old', '', 'When in Main Hand:', '+3 Attack Damage', 'Unbreakable', 'minecraft:diamond_sword', '5 component(s)']);
  assert.equal(lines[0][0].color, 'red');
  assert.equal(lines[0][0].italic, false);
  assert.equal(lines[2][0].color, 'dark_purple');
  assert.equal(lines[2][0].italic, true);
  // defaults: base attributes and durability, enchanted name turns aqua
  const defaults = {
    'minecraft:rarity': 'common',
    'minecraft:max_damage': 1561,
    'minecraft:attribute_modifiers': [{ type: 'minecraft:attack_damage', amount: 6, id: 'minecraft:base_attack_damage', operation: 'add_value', slot: 'mainhand' }],
  };
  const l2 = tooltipLines(sword({ enchantments: [{ id: 'sharpness', level: 5 }], damage: 61 }), '26.3', { lang, itemName: 'Diamond Sword', defaults, advanced: true });
  assert.equal(l2[0][0].color, 'aqua');
  assert.ok(l2.some((l) => l[0].text === ' 7 Attack Damage'));
  assert.ok(l2.some((l) => l[0].text === 'Durability: 1500 / 1561'));
  assert.equal(tooltipLines(sword({ hideTooltip: true }), '26.3', { lang, itemName: 'X' }).length, 1);
});
