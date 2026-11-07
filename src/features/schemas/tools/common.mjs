// common.json — definitions shared by every Minecraft schema: ids, text components, ranges, number providers,
// predicates, loot conditions & functions, ingredients, item stacks.
import {
  md, ref, compRef, typeField, mcEnum, dispatch, obj, str, int, num, bool, id, arr, reg, RL, RL_OR_TAG, TAG,
} from './lib.mjs';

const rtext = (t) => md(t, ref('textComponent'));
const rid = (t) => md(t, ref('resourceLocation'));
const rset = (t) => md(t, ref('holderSet'));
const rirange = (t) => md(t, ref('intRange'));
const rfrange = (t) => md(t, ref('floatRange'));
const rnum = (t) => md(t, ref('numberProvider'));

const COLORS = ['black', 'dark_blue', 'dark_green', 'dark_aqua', 'dark_red', 'dark_purple', 'gold', 'gray', 'dark_gray', 'blue', 'green', 'aqua', 'red', 'light_purple', 'yellow', 'white'];
export const DYE_COLORS = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];
export const SLOT_GROUPS = ['any', 'mainhand', 'offhand', 'hand', 'feet', 'legs', 'chest', 'head', 'armor', 'body', 'saddle'];
export const EQUIPMENT_SLOTS = ['mainhand', 'offhand', 'feet', 'legs', 'chest', 'head', 'body', 'saddle'];

// Number providers: legacy loot number providers + 26.x context float/int providers.
const NUMBER_PROVIDER_TYPES = [
  'constant', 'uniform', 'binomial', 'score', 'storage', 'enchantment_level', 'sum',
  // 26.x context_float_provider / context_int_provider types
  'abs', 'add', 'avg', 'ceil', 'conditional', 'cos', 'div', 'environment_attribute', 'floor', 'floor_div', 'floor_mod',
  'from_int', 'from_float', 'length', 'max', 'min', 'mod', 'mul', 'negate', 'number_dispatcher', 'pow', 'round', 'sin',
  'sqrt', 'sub', 'truncate', 'weighted_list',
];

export const LOOT_CONDITIONS = reg('loot_condition_type', ['match_block', 'float_value_check', 'int_value_check', 'environment_attribute_check']);
export const LOOT_FUNCTIONS = reg('loot_function_type', ['set_random_dyes', 'set_random_potion']);
export const LOOT_ENTRIES = reg('loot_pool_entry_type');
export const ENTITY_SUB_PREDICATES_26 = [
  'components', 'distance', 'effects', 'entity_tags', 'entity_type', 'equipment', 'flags', 'location', 'movement',
  'movement_affected_by', 'nbt', 'passenger', 'periodic_tick', 'predicates', 'slots', 'stepping_on', 'targeted_entity',
  'team', 'type_specific/cube_mob', 'type_specific/fishing_hook', 'type_specific/lightning', 'type_specific/player',
  'type_specific/raider', 'type_specific/sheep', 'vehicle',
];
const DATA_COMPONENT_PREDICATES = [
  'attribute_modifiers', 'bundle_contents', 'container', 'custom_data', 'damage', 'enchantments', 'firework_explosion',
  'fireworks', 'jukebox_playable', 'potion_contents', 'stored_enchantments', 'trim', 'villager/variant',
  'writable_book_content', 'written_book_content',
];
const LOOT_CONTEXT_ENTITIES = ['this', 'attacker', 'direct_attacker', 'attacking_player', 'target_entity', 'interacting_entity', 'killer', 'direct_killer', 'killer_player'];

// ---------------------------------------------------------------------------------------------------------------
const textComponent = md('A text component: a plain string, an array of components, or an object (`text`, `translate`, `color`, `bold`, …).', {
  type: ['string', 'number', 'boolean', 'array', 'object'],
  items: ref('textComponent'),
  properties: {
    type: md('Explicit content type (optional, inferred from the fields).', { enum: ['text', 'translatable', 'score', 'selector', 'keybind', 'nbt', 'object'] }),
    text: str('Literal text.'),
    translate: str('Translation key (from a lang file), e.g. `item.mymod.ruby`.'),
    fallback: str('Text used when the translation key is missing.'),
    with: arr(ref('textComponent'), 'Arguments substituted into `%s` placeholders of the translation.'),
    score: obj({ name: str('Score holder (selector or name).'), objective: str('Scoreboard objective.') }),
    selector: str('Entity selector, e.g. `@p`.'),
    separator: rtext('Separator between selected entities / nbt values.'),
    keybind: str('Keybind id, e.g. `key.jump`.'),
    nbt: str('NBT path to display.'),
    interpret: bool('Parse the NBT value as a text component.'),
    block: str('Block position for nbt source.'),
    entity: str('Entity selector for nbt source.'),
    storage: str('Command storage id for nbt source.'),
    source: md('NBT source.', { enum: ['block', 'entity', 'storage'] }),
    object: md('Object component kind (1.21.9+).', { enum: ['atlas', 'player'] }),
    atlas: str('Atlas id for an atlas object component.'),
    sprite: str('Sprite id for an atlas object component.'),
    player: md('Player profile for a player head object component.', { type: ['string', 'object'] }),
    hat: bool('Render the hat layer of a player object component.'),
    color: md('Text color: a named color or `#RRGGBB`.', { type: 'string', anyOf: [{ enum: COLORS }, { pattern: '^#[0-9a-fA-F]{6}$' }] }),
    shadow_color: md('Shadow color as packed ARGB int or `[r, g, b, a]` floats (1.21.4+).', { type: ['integer', 'array'] }),
    font: str('Font id, e.g. `minecraft:uniform`.'),
    bold: bool('Bold.'),
    italic: bool('Italic.'),
    underlined: bool('Underlined.'),
    strikethrough: bool('Strikethrough.'),
    obfuscated: bool('Obfuscated (random characters).'),
    insertion: str('Text inserted into chat when shift-clicked.'),
    click_event: md('Click event (1.21.5+ snake_case form).', obj({
      action: md('Action.', { enum: ['open_url', 'open_file', 'run_command', 'suggest_command', 'change_page', 'copy_to_clipboard', 'show_dialog', 'custom'] }),
      url: str('URL for `open_url`.'), command: str('Command for run/suggest.'), page: int('Page for `change_page`.'), value: md('Legacy value.', {}),
    })),
    hover_event: md('Hover event (1.21.5+ snake_case form).', obj({
      action: md('Action.', { enum: ['show_text', 'show_item', 'show_entity'] }), value: md('Text for show_text.', {}),
      id: str('Item / entity type id.'), count: int('Item count.'), components: md('Item components.', { type: 'object' }), uuid: md('Entity UUID.', {}), name: md('Entity name.', {}),
    })),
    clickEvent: md('Click event (pre-1.21.5 camelCase form).', { type: 'object' }),
    hoverEvent: md('Hover event (pre-1.21.5 camelCase form).', { type: 'object' }),
    extra: arr(ref('textComponent'), 'Child components appended after this one (they inherit its style).'),
  },
});

const numberProvider = md('A number provider: a constant number or an object such as `{"type": "minecraft:uniform", "min": 1, "max": 3}`.', {
  type: ['number', 'object'],
  properties: {
    type: typeField(NUMBER_PROVIDER_TYPES, 'Number provider type. Omitted = `uniform` (legacy) when `min`/`max` are given.'),
    value: md('Value (constant) / operand.', {}),
    min: rnum('Minimum (uniform: inclusive).'),
    max: rnum('Maximum (uniform: inclusive).'),
    n: rnum('Binomial: number of trials.'),
    p: rnum('Binomial: probability of success per trial.'),
    target: md('Score holder: `{"type": "fixed", "name": …}` or `{"type": "context", "target": "this"}`, or a context entity name.', {}),
    score: str('Scoreboard objective.'),
    scale: num('Multiplier applied to the score.'),
    storage: id('Command storage id.'),
    path: str('NBT path in the storage.'),
    amount: md('Level-based value (enchantment_level).', ref('levelBasedValue')),
    summands: arr(ref('numberProvider'), 'Values to add (sum).'),
  },
  defaultSnippets: [
    { label: 'uniform', body: { type: 'minecraft:uniform', min: '^${1:1}', max: '^${2:3}' } },
    { label: 'binomial', body: { type: 'minecraft:binomial', n: '^${1:3}', p: '^${2:0.5}' } },
    { label: 'constant', body: { type: 'minecraft:constant', value: '^${1:1}' } },
  ],
  allOf: dispatch(['type'], {
    uniform: { properties: { min: rnum('Minimum (inclusive).'), max: rnum('Maximum (inclusive).') } },
    binomial: { properties: { n: rnum('Number of trials.'), p: rnum('Probability of success.') }, required: ['n', 'p'] },
    score: { properties: { target: md('Score holder.', {}), score: str('Objective.') }, required: ['score'] },
    storage: { required: ['storage', 'path'] },
    enchantment_level: { required: ['amount'] },
  }),
});

const levelBasedValue = md('Level-based value: a number or `{"type": "minecraft:linear", "base": …, "per_level_above_first": …}`.', {
  type: ['number', 'object'],
  properties: {
    type: typeField(reg('enchantment_level_based_value_type', ['linear', 'clamped', 'fraction', 'levels_squared', 'lookup', 'exponent']), 'Level-based value type.'),
    base: md('Value at level 1 (linear) / base (exponent).', ref('levelBasedValue')),
    per_level_above_first: num('Added for each level above the first (linear).'),
    value: md('Value to clamp (clamped).', ref('levelBasedValue')),
    min: num('Minimum (clamped).'),
    max: num('Maximum (clamped).'),
    numerator: md('Numerator (fraction).', ref('levelBasedValue')),
    denominator: md('Denominator (fraction).', ref('levelBasedValue')),
    added: num('Added to level² (levels_squared).'),
    values: arr(ref('levelBasedValue'), 'Values per level (lookup).'),
    fallback: md('Value for levels past the list (lookup).', ref('levelBasedValue')),
    power: md('Exponent (exponent).', ref('levelBasedValue')),
  },
  defaultSnippets: [{ label: 'linear', body: { type: 'minecraft:linear', base: '^${1:1}', per_level_above_first: '^${2:1}' } }],
});

const intProvider = md('Int provider (worldgen): an int or `{"type": "minecraft:uniform", "min_inclusive": …, "max_inclusive": …}`.', {
  type: ['integer', 'object'],
  properties: {
    type: typeField(reg('int_provider_type', ['trapezoid', 'very_biased_to_bottom']), 'Int provider type.'),
    value: md('Constant value / inner provider.', {}),
    min_inclusive: md('Minimum (inclusive).', {}),
    max_inclusive: md('Maximum (inclusive).', {}),
    distribution: md('Weighted entries `{data, weight}`.', { type: 'array' }),
    source: md('Inner provider (clamped).', {}),
  },
});
const floatProvider = md('Float provider: a number or `{"type": "minecraft:uniform", "min_inclusive": …, "max_exclusive": …}`.', {
  type: ['number', 'object'],
  properties: {
    type: typeField(reg('float_provider_type'), 'Float provider type.'),
    value: md('Constant value.', {}), min_inclusive: num('Minimum (inclusive).'), max_exclusive: num('Maximum (exclusive).'),
    min: num('Minimum.'), max: num('Maximum.'), mean: num('Mean.'), deviation: num('Deviation.'), plateau: num('Plateau.'),
  },
});

// ---------------------------------------------------------------------------------------------------------------
// Predicates
const statePredicate = md('Block/fluid state properties: `{"facing": "north", "age": {"min": 2}}`.', {
  type: 'object',
  additionalProperties: { type: ['string', 'integer', 'boolean', 'object'], properties: { min: md('Minimum.', { type: ['string', 'integer'] }), max: md('Maximum.', { type: ['string', 'integer'] }) } },
});

const itemPredicate = md('Item predicate: `items`, `count`, `components` (exact match) and `predicates` (partial component predicates).', obj({
  items: rset('Item id, `#tag` or list of item ids.'),
  count: rirange('Stack size range.'),
  components: md('Components that must match exactly.', ref('componentsPatch')),
  predicates: md('Data component sub-predicates, keyed by component type.', obj(Object.fromEntries(DATA_COMPONENT_PREDICATES.map((k) => [`minecraft:${k}`, md(`\`${k}\` component predicate.`, {})])))),
}, { defaultSnippets: [{ label: 'items', body: { items: '${1:minecraft:diamond_pickaxe}' } }] }));

const blockPredicate = md('Block predicate: `blocks`, `state`, `nbt`, `components`.', obj({
  blocks: rset('Block id, `#tag` or list of block ids.'),
  state: md('Required block state properties.', ref('statePredicate')),
  nbt: str('SNBT the block entity must match.'),
  components: md('Block entity components that must match.', { type: 'object' }),
  predicates: md('Block entity component predicates.', { type: 'object' }),
}));

const fluidPredicate = md('Fluid predicate.', obj({ fluids: rset('Fluid id, `#tag` or list.'), state: md('Fluid state properties.', ref('statePredicate')) }));

const locationPredicate = md('Location predicate.', obj({
  position: obj({ x: rfrange('X range.'), y: rfrange('Y range.'), z: rfrange('Z range.') }),
  biomes: rset('Biome id, `#tag` or list.'),
  structures: rset('Structure id, `#tag` or list.'),
  dimension: rid('Dimension id, e.g. `minecraft:the_nether`.'),
  smokey: bool('Whether the block is above a campfire (smoke).'),
  light: obj({ light: rirange('Light level range.') }),
  block: md('Block at the location.', ref('blockPredicate')),
  fluid: md('Fluid at the location.', ref('fluidPredicate')),
  can_see_sky: bool('Whether the location can see the sky.'),
}));

const distancePredicate = md('Distance predicate (float ranges).', obj({
  x: rfrange('X distance.'), y: rfrange('Y distance.'), z: rfrange('Z distance.'), horizontal: rfrange('Horizontal distance.'), absolute: rfrange('3D distance.'),
}));

const effectsPredicate = md('Map of mob effect id → `{amplifier, duration, ambient, visible}`.', {
  type: 'object',
  additionalProperties: obj({ amplifier: rirange('Amplifier range.'), duration: rirange('Duration range (ticks).'), ambient: bool('Ambient (beacon).'), visible: bool('Particles visible.') }),
});

const flagsPredicate = md('Entity flags.', obj(Object.fromEntries(['is_on_fire', 'is_sneaking', 'is_sprinting', 'is_swimming', 'is_baby', 'is_on_ground', 'is_flying', 'is_fall_flying', 'is_in_water'].map((f) => [f, bool(`\`${f}\`.`)]))));

const equipmentPredicate = md('Equipment item predicates by slot.', obj(Object.fromEntries(['mainhand', 'offhand', 'head', 'chest', 'legs', 'feet', 'body', 'saddle'].map((s) => [s, md(`Item in ${s}.`, ref('itemPredicate'))]))));

const movementPredicate = md('Movement predicate.', obj(Object.fromEntries(['x', 'y', 'z', 'speed', 'horizontal_speed', 'vertical_speed', 'fall_distance'].map((k) => [k, rfrange(`${k} range.`)]))));

const typeSpecific = md('Type-specific entity sub-predicate (`{"type": "minecraft:player", …}`).', obj({
  type: typeField(reg('entity_sub_predicate_type'), 'Sub-predicate type.'),
  gamemode: md('Game modes (player).', { type: ['string', 'array'] }),
  level: rirange('Experience level (player).'),
  advancements: md('Advancement id → bool or criteria map (player).', { type: 'object' }),
  recipes: md('Recipe id → unlocked (player).', { type: 'object' }),
  stats: md('Statistics (player).', { type: 'array' }),
  looking_at: md('Entity the player looks at.', ref('entityPredicate')),
  food: md('Food predicate (player).', { type: 'object' }),
  input: md('Pressed inputs (player).', { type: 'object' }),
  blocks_set_on_fire: rirange('Blocks set on fire (lightning).'),
  entity_struck: md('Entity struck (lightning).', ref('entityPredicate')),
  in_open_water: bool('Hook in open water (fishing_hook).'),
  has_raid: bool('Has raid (raider).'),
  is_captain: bool('Is captain (raider).'),
  sheared: bool('Sheared (sheep).'),
  size: rirange('Size (slime / cube mob).'),
  variant: md('Variant id (legacy variant sub-predicates).', { type: ['string', 'array'] }),
}));

const ENTITY_SUB = {
  type: rset('Entity type id, `#tag` or list. (Legacy key; 26.x uses `minecraft:entity_type`.)'),
  type_specific: md('Type-specific sub-predicate.', ref('typeSpecificPredicate')),
  nbt: str('SNBT the entity data must match.'),
  team: str('Team name.'),
  flags: md('Entity flags.', ref('flagsPredicate')),
  equipment: md('Equipment.', ref('equipmentPredicate')),
  location: md('Location of the entity.', ref('locationPredicate')),
  stepping_on: md('Location the entity stands on.', ref('locationPredicate')),
  movement_affected_by: md('Block affecting movement (below the entity).', ref('locationPredicate')),
  distance: md('Distance to the origin.', ref('distancePredicate')),
  movement: md('Movement.', ref('movementPredicate')),
  effects: md('Active effects.', ref('effectsPredicate')),
  slots: md('Item predicates by slot range (`container.*`, `armor.head`, …).', { type: 'object', additionalProperties: ref('itemPredicate') }),
  vehicle: md('Vehicle.', ref('entityPredicate')),
  passenger: md('Passenger.', ref('entityPredicate')),
  targeted_entity: md('Attack target.', ref('entityPredicate')),
  periodic_tick: int('Only passes every N ticks.'),
  components: md('Entity components that must match exactly.', { type: 'object' }),
  predicates: md('Entity component predicates.', { type: 'object' }),
};
const ENTITY_SUB_NEW = {
  components: ENTITY_SUB.components, distance: ENTITY_SUB.distance, effects: ENTITY_SUB.effects,
  entity_tags: md('Entity type tags `[{id, expected}]`.', {}),
  entity_type: rset('Entity type id, `#tag` or list.'),
  equipment: ENTITY_SUB.equipment, flags: ENTITY_SUB.flags, location: ENTITY_SUB.location, movement: ENTITY_SUB.movement,
  movement_affected_by: ENTITY_SUB.movement_affected_by, nbt: ENTITY_SUB.nbt, passenger: ENTITY_SUB.passenger,
  periodic_tick: ENTITY_SUB.periodic_tick, predicates: ENTITY_SUB.predicates, slots: ENTITY_SUB.slots,
  stepping_on: ENTITY_SUB.stepping_on, targeted_entity: ENTITY_SUB.targeted_entity, team: ENTITY_SUB.team, vehicle: ENTITY_SUB.vehicle,
  'type_specific/cube_mob': md('Slime / magma cube.', obj({ size: rirange('Size.') })),
  'type_specific/fishing_hook': md('Fishing hook.', obj({ in_open_water: bool('In open water.') })),
  'type_specific/lightning': md('Lightning bolt.', obj({ blocks_set_on_fire: rirange('Blocks set on fire.'), entity_struck: md('Entity struck.', ref('entityPredicate')) })),
  'type_specific/player': md('Player.', obj({ gamemode: md('Game modes.', { type: ['string', 'array'] }), level: rirange('Level.'), food: md('Food.', { type: 'object' }), advancements: md('Advancements.', { type: 'object' }), recipes: md('Recipes.', { type: 'object' }), stats: md('Stats.', { type: 'array' }), looking_at: md('Looked-at entity.', ref('entityPredicate')), input: md('Inputs.', { type: 'object' }) })),
  'type_specific/raider': md('Raider.', obj({ has_raid: bool('Has raid.'), is_captain: bool('Is captain.') })),
  'type_specific/sheep': md('Sheep.', obj({ sheared: bool('Sheared.') })),
};
const entityPredicate = md('Entity predicate. 1.21–1.21.11 use plain keys (`type`, `flags`, `equipment`…); 26.x uses sub-predicate keys (`minecraft:entity_type`, `minecraft:flags`…).', {
  type: 'object',
  properties: {
    ...ENTITY_SUB,
    ...Object.fromEntries(Object.entries(ENTITY_SUB_NEW).map(([k, v]) => [`minecraft:${k}`, v])),
  },
  defaultSnippets: [{ label: 'entity type', body: { type: '${1:minecraft:zombie}' } }],
});

const damageSourcePredicate = md('Damage source predicate.', obj({
  tags: arr(obj({ id: md('Damage type tag id (`#minecraft:is_fire` in 26.x, without # before).', ref('idOrTag')), expected: bool('Whether the damage type must be in the tag.') }, { required: ['id'] }), 'Damage type tag checks.'),
  source_entity: md('Entity that caused the damage.', ref('entityPredicate')),
  direct_entity: md('Direct entity (e.g. the arrow).', ref('entityPredicate')),
  is_direct: bool('Whether source and direct entity are the same.'),
}));

const damagePredicate = md('Damage predicate.', obj({
  dealt: rfrange('Damage dealt before reduction.'), taken: rfrange('Damage taken after reduction.'), blocked: bool('Blocked by a shield.'),
  source_entity: md('Source entity.', ref('entityPredicate')), type: md('Damage source.', ref('damageSourcePredicate')),
}));

// ---------------------------------------------------------------------------------------------------------------
// Loot conditions
const CONDITION_DOCS = {
  all_of: 'Passes when all `terms` pass.', any_of: 'Passes when any of `terms` passes.', inverted: 'Inverts `term`.',
  block_state_property: 'Block being broken matches `block` and `properties` (≤1.21.11; 26.x: `match_block`).',
  match_block: 'Block being broken matches `blocks` and `state` (26.x).',
  damage_source_properties: 'Damage source matches `predicate`.', enchantment_active_check: 'Enchantment is active (`active`).',
  entity_properties: 'Entity (`entity`) matches `predicate`.', entity_scores: 'Entity scores are in range.',
  killed_by_player: 'Entity was killed by a player.', location_check: 'Location matches `predicate`.', match_tool: 'Tool matches `predicate`.',
  random_chance: 'Random chance (`chance`).', random_chance_with_enchanted_bonus: 'Chance boosted by an enchantment level.',
  reference: 'References a predicate file (`name`). 26.x: just use the predicate id string.', survives_explosion: '1/radius chance to survive an explosion.',
  table_bonus: 'Chance from `chances` indexed by enchantment level.', time_check: 'Day time check.', value_check: 'Number provider in range.',
  float_value_check: 'Float value in range (26.x).', int_value_check: 'Int value in range (26.x).', weather_check: 'Weather check.',
  environment_attribute_check: 'Environment attribute check (26.x).',
};
const entityTarget = md('Context entity.', { type: 'string', anyOf: [{ enum: LOOT_CONTEXT_ENTITIES }, { pattern: '^[a-z_]+$' }] });
const conditionParams = {
  all_of: { properties: { terms: arr(ref('lootConditionRef'), 'Conditions that must all pass.') }, required: ['terms'] },
  any_of: { properties: { terms: arr(ref('lootConditionRef'), 'Conditions of which one must pass.') }, required: ['terms'] },
  inverted: { properties: { term: md('Condition to invert.', ref('lootConditionRef')) }, required: ['term'] },
  block_state_property: { properties: { block: id('Block id.'), properties: md('Required state.', ref('statePredicate')) }, required: ['block'] },
  match_block: { properties: { blocks: rset('Block id, `#tag` or list.'), state: md('Required state.', ref('statePredicate')) } },
  damage_source_properties: { properties: { predicate: md('Damage source predicate.', ref('damageSourcePredicate')) } },
  enchantment_active_check: { properties: { active: bool('Whether the enchantment must be active.') }, required: ['active'] },
  entity_properties: { properties: { entity: entityTarget, predicate: md('Entity predicate.', ref('entityPredicate')) } },
  entity_scores: { properties: { entity: entityTarget, scores: md('Objective → int range / number-provider range.', { type: 'object' }) }, required: ['scores'] },
  killed_by_player: { properties: { inverse: bool('Legacy inverse flag.') } },
  location_check: { properties: { predicate: md('Location predicate.', ref('locationPredicate')), offsetX: int('X offset.'), offsetY: int('Y offset.'), offsetZ: int('Z offset.') } },
  match_tool: { properties: { predicate: md('Item predicate for the tool.', ref('itemPredicate')) } },
  random_chance: { properties: { chance: md('Probability 0–1 (number provider since 1.21.2).', ref('numberProvider')) }, required: ['chance'] },
  random_chance_with_enchanted_bonus: { properties: { enchantment: id('Enchantment id.'), unenchanted_chance: num('Chance without the enchantment.'), enchanted_chance: md('Level-based chance.', ref('levelBasedValue')) }, required: ['enchantment'] },
  reference: { properties: { name: id('Predicate id.') }, required: ['name'] },
  table_bonus: { properties: { enchantment: id('Enchantment id.'), chances: arr({ type: 'number' }, 'Chance per level (index 0 = no enchantment).') }, required: ['enchantment', 'chances'] },
  time_check: { properties: { value: md('Int range.', ref('intRange')), period: int('Day time modulo (e.g. 24000).'), clock: id('World clock (26.x).') } },
  value_check: { properties: { value: md('Value.', ref('numberProvider')), range: md('Range.', ref('intRange')) }, required: ['value', 'range'] },
  weather_check: { properties: { raining: bool('Raining.'), thundering: bool('Thundering.') } },
};
const lootCondition = md('Loot condition / predicate. 26.x uses `"type"`; 1.21–1.21.11 use `"condition"`.', {
  type: 'object',
  properties: {
    type: typeField(LOOT_CONDITIONS, 'Condition type (26.x key).', { enumDescriptions: CONDITION_DOCS }),
    condition: typeField(LOOT_CONDITIONS, 'Condition type (1.21–1.21.11 key; 26.x uses `type`).', { enumDescriptions: CONDITION_DOCS }),
  },
  allOf: dispatch(['type', 'condition'], conditionParams),
  defaultSnippets: [
    { label: 'random_chance', body: { condition: 'minecraft:random_chance', chance: '^${1:0.5}' } },
    { label: 'killed_by_player', body: { condition: 'minecraft:killed_by_player' } },
    { label: 'survives_explosion', body: { condition: 'minecraft:survives_explosion' } },
    { label: 'match_tool (silk touch)', body: { condition: 'minecraft:match_tool', predicate: { predicates: { 'minecraft:enchantments': [{ enchantments: 'minecraft:silk_touch', levels: { min: 1 } }] } } } },
  ],
});
const lootConditionRef = md('A loot condition object, a predicate id (26.x) or a list of conditions.', {
  anyOf: [{ type: 'string', pattern: RL }, ref('lootCondition'), { type: 'array', items: ref('lootConditionRef') }],
});
const contextAwarePredicate = md('Entity predicate (shorthand) or loot condition(s) evaluated on the entity.', {
  anyOf: [ref('entityPredicate'), ref('lootConditionRef')],
});

// ---------------------------------------------------------------------------------------------------------------
// Loot functions (item modifiers)
const FUNCTION_DOCS = {
  set_count: 'Sets / adds the stack count.', apply_bonus: 'Bonus count from an enchantment (fortune).', explosion_decay: 'Removes items when exploded.',
  set_components: 'Sets item components.', set_name: 'Sets the custom / item name.', set_lore: 'Sets lore lines.', enchant_randomly: 'Random enchantment.',
  enchant_with_levels: 'Enchant as an enchanting table.', set_enchantments: 'Sets enchantment levels.', furnace_smelt: 'Smelts the item.',
  copy_components: 'Copies components from a block entity.', copy_state: 'Copies block state properties.', limit_count: 'Clamps the count.',
  set_damage: 'Sets durability (0–1).', set_potion: 'Sets the potion.', enchanted_count_increase: 'Count bonus per enchantment level (looting).',
  set_item: 'Replaces the item type.', set_loot_table: 'Sets a container loot table.', toggle_tooltips: 'Toggles tooltips of components.',
  filtered: 'Applies a modifier only to items matching `item_filter`.', sequence: 'Applies modifiers in order.', reference: 'References an item modifier file.',
  discard: 'Discards the item.',
};
const nameOrComp = (t) => rtext(t);
const functionParams = {
  apply_bonus: { properties: { enchantment: id('Enchantment id.'), formula: mcEnum(['binomial_with_bonus_count', 'uniform_bonus_count', 'ore_drops'], 'Bonus formula.'), parameters: obj({ extra: int('Extra trials (binomial).'), probability: num('Probability (binomial).'), bonusMultiplier: num('Multiplier (uniform).') }) }, required: ['enchantment', 'formula'] },
  copy_components: { properties: { source: str('Source (`block_entity`, or a context entity in 26.x).'), include: arr(md('Component type.', ref('resourceLocation')), 'Components to copy.'), exclude: arr(md('Component type.', ref('resourceLocation')), 'Components not to copy.') }, required: ['source'] },
  copy_custom_data: { properties: { source: md('NBT provider: `block_entity`, a context entity or `{type, target/source}`.', { type: ['string', 'object'] }), ops: arr(obj({ source: str('Source NBT path.'), target: str('Target NBT path.'), op: md('Operation.', { enum: ['replace', 'append', 'merge'] }) }), 'Copy operations.') }, required: ['source', 'ops'] },
  copy_name: { properties: { source: str('`block_entity` or a context entity.') }, required: ['source'] },
  copy_state: { properties: { block: id('Block id.'), properties: arr({ type: 'string' }, 'State properties to copy.') }, required: ['block', 'properties'] },
  enchant_randomly: { properties: { options: rset('Enchantments to pick from (id, `#tag` or list).'), only_compatible: bool('Only enchantments compatible with the item.'), include_additional_cost_component: bool('Adds the additional trade cost component.') } },
  enchant_with_levels: { properties: { levels: md('Enchanting levels.', ref('numberProvider')), options: rset('Enchantments to pick from.'), include_additional_cost_component: bool('Adds the additional trade cost component.') }, required: ['levels'] },
  enchanted_count_increase: { properties: { enchantment: id('Enchantment id (e.g. looting).'), count: md('Count added per level.', ref('numberProvider')), limit: int('Maximum stack size after increase (0 = no limit).') }, required: ['enchantment', 'count'] },
  exploration_map: { properties: { destination: md('Structure tag (`#minecraft:on_treasure_maps`; legacy without #).', ref('idOrTag')), decoration: md('Map decoration type.', ref('resourceLocation')), zoom: int('Zoom level.'), search_radius: int('Search radius in chunks.'), skip_existing_chunks: bool('Skip already generated chunks.') } },
  fill_player_head: { properties: { entity: entityTarget }, required: ['entity'] },
  filtered: { properties: { item_filter: md('Item predicate.', ref('itemPredicate')), modifier: md('Modifier applied to matching items (1.21–1.21.4).', ref('lootFunctionRef')), on_pass: md('Modifier for matching items.', ref('lootFunctionRef')), on_fail: md('Modifier for non-matching items.', ref('lootFunctionRef')) }, required: ['item_filter'] },
  limit_count: { properties: { limit: md('Int range (bounds may be number providers).', { type: ['integer', 'object'] }) }, required: ['limit'] },
  modify_contents: { properties: { component: md('Container component (`container`, `bundle_contents`, `charged_projectiles`).', ref('resourceLocation')), modifier: md('Modifier for each contained item.', ref('lootFunctionRef')) }, required: ['component', 'modifier'] },
  reference: { properties: { name: id('Item modifier id.') }, required: ['name'] },
  sequence: { properties: { functions: arr(ref('lootFunction'), 'Modifiers (legacy key).'), modifiers: arr(ref('lootFunctionRef'), 'Modifiers.') } },
  set_attributes: { properties: { modifiers: arr(obj({ attribute: id('Attribute id.'), operation: mcEnum(['add_value', 'add_multiplied_base', 'add_multiplied_total'], 'Operation.'), amount: md('Amount.', ref('numberProvider')), id: id('Modifier id.'), slot: md('Slot(s).', { type: ['string', 'array'] }), name: str('Legacy name.') }), 'Attribute modifiers.'), replace: bool('Replace existing modifiers.') }, required: ['modifiers'] },
  set_banner_pattern: { properties: { patterns: arr(obj({ pattern: md('Banner pattern id.', {}), color: md('Dye color.', { enum: DYE_COLORS }) }), 'Patterns.'), append: bool('Append to existing.') }, required: ['patterns'] },
  set_book_cover: { properties: { title: md('Filterable title.', {}), author: str('Author.'), generation: int('Generation 0–3.') } },
  set_components: { properties: { components: md('Components to set (`!id` removes).', ref('componentsPatch')) }, required: ['components'] },
  set_contents: { properties: { component: md('Container component.', ref('resourceLocation')), entries: arr(ref('lootEntry'), 'Entries generating the contents.') }, required: ['entries'] },
  set_count: { properties: { count: md('Count (number provider).', ref('numberProvider')), add: bool('Add to the current count instead of replacing.') }, required: ['count'] },
  set_custom_data: { properties: { tag: md('SNBT string or object.', { type: ['string', 'object'] }) }, required: ['tag'] },
  set_custom_model_data: { properties: { value: md('Legacy single value.', ref('numberProvider')), floats: md('Float list operation.', {}), flags: md('Flag list operation.', {}), strings: md('String list operation.', {}), colors: md('Color list operation.', {}) } },
  set_damage: { properties: { damage: md('Durability fraction 0–1.', ref('numberProvider')), add: bool('Add to current damage.') }, required: ['damage'] },
  set_enchantments: { properties: { enchantments: md('Enchantment id → level (number provider).', { type: 'object', additionalProperties: ref('numberProvider') }), add: bool('Add to current levels.') } },
  set_firework_explosion: { properties: { shape: md('Shape.', { enum: ['small_ball', 'large_ball', 'star', 'creeper', 'burst'] }), colors: md('Colors.', {}), fade_colors: md('Fade colors.', {}), trail: bool('Trail.'), twinkle: bool('Twinkle.') } },
  set_fireworks: { properties: { explosions: md('Explosions list operation.', {}), flight_duration: int('Flight duration.') } },
  set_instrument: { properties: { options: rset('Instrument `#tag` or list.') }, required: ['options'] },
  set_item: { properties: { item: id('Item id.') }, required: ['item'] },
  set_loot_table: { properties: { name: id('Loot table id.'), seed: int('Seed.'), type: md('Block entity type.', ref('resourceLocation')) }, required: ['name'] },
  set_lore: { properties: { lore: arr(ref('textComponent'), 'Lore lines.'), mode: md('List operation.', { enum: ['replace_all', 'replace_section', 'insert', 'append'] }), offset: int('Offset.'), size: int('Size.'), entity: entityTarget }, required: ['lore'] },
  set_name: { properties: { name: nameOrComp('Name.'), entity: entityTarget, target: md('Component to set.', { enum: ['custom_name', 'item_name'] }) } },
  set_ominous_bottle_amplifier: { properties: { amplifier: md('Amplifier.', ref('numberProvider')) }, required: ['amplifier'] },
  set_potion: { properties: { id: id('Potion id.') }, required: ['id'] },
  set_stew_effect: { properties: { effects: arr(obj({ type: id('Mob effect id.'), duration: md('Duration.', ref('numberProvider')) }), 'Possible effects.') } },
  set_writable_book_pages: { properties: { pages: md('Pages.', { type: 'array' }), mode: md('List operation.', { enum: ['replace_all', 'replace_section', 'insert', 'append'] }), offset: int('Offset.'), size: int('Size.') }, required: ['pages'] },
  set_written_book_pages: { properties: { pages: md('Pages.', { type: 'array' }), mode: md('List operation.', { enum: ['replace_all', 'replace_section', 'insert', 'append'] }), offset: int('Offset.'), size: int('Size.') }, required: ['pages'] },
  toggle_tooltips: { properties: { toggles: md('Component → shown.', { type: 'object', additionalProperties: { type: 'boolean' } }) }, required: ['toggles'] },
};
const lootFunction = md('Loot function (item modifier). 26.x uses `"type"`; 1.21–1.21.11 use `"function"`.', {
  type: 'object',
  properties: {
    type: md('Function type (26.x key). In 1.21–1.21.11 files `type` is a parameter of some functions (e.g. set_loot_table).', { type: 'string' }),
    function: typeField(LOOT_FUNCTIONS, 'Function type (1.21–1.21.11 key; 26.x uses `type`).', { enumDescriptions: FUNCTION_DOCS }),
    conditions: arr(ref('lootConditionRef'), 'Conditions for applying this function (1.21–1.21.11).'),
    condition: md('Condition(s) for applying this function (26.x).', ref('lootConditionRef')),
  },
  allOf: [
    { if: { required: ['function'] }, else: { properties: { type: typeField(LOOT_FUNCTIONS, 'Function type (26.x key).', { enumDescriptions: FUNCTION_DOCS }) } } },
    ...dispatch(['function'], functionParams),
    { if: { not: { required: ['function'] } }, then: { allOf: dispatch(['type'], functionParams) } },
  ],
  defaultSnippets: [
    { label: 'set_count', body: { function: 'minecraft:set_count', count: { type: 'minecraft:uniform', min: '^${1:1}', max: '^${2:3}' } } },
    { label: 'explosion_decay', body: { function: 'minecraft:explosion_decay' } },
    { label: 'apply_bonus (fortune ore)', body: { function: 'minecraft:apply_bonus', enchantment: 'minecraft:fortune', formula: 'minecraft:ore_drops' } },
    { label: 'set_name', body: { function: 'minecraft:set_name', name: { text: '${1:Name}', italic: false } } },
  ],
});
const lootFunctionRef = md('A loot function, an item modifier id or a list of them.', {
  anyOf: [{ type: 'string', pattern: RL }, ref('lootFunction'), { type: 'array', items: ref('lootFunctionRef') }],
});

// ---------------------------------------------------------------------------------------------------------------
// Loot entries
const entryCommon = {
  weight: int('Relative weight in the pool.', { minimum: 0 }),
  quality: int('Weight bonus per luck level.'),
  conditions: arr(ref('lootConditionRef'), 'Conditions (1.21–1.21.11).'),
  condition: md('Condition(s) (26.x).', ref('lootConditionRef')),
  functions: arr(ref('lootFunction'), 'Functions (1.21–1.21.11).'),
  modifier: md('Modifier(s) (26.x).', ref('lootFunctionRef')),
};
const lootEntry = md('Loot pool entry.', {
  type: 'object',
  properties: {
    type: typeField(LOOT_ENTRIES, 'Entry type.', { enumDescriptions: { item: 'Drops an item (`name`).', tag: 'Items of an item tag.', loot_table: 'Another loot table (`value`).', alternatives: 'First child whose conditions pass.', group: 'All children.', sequence: 'Children until one fails.', empty: 'Nothing.', dynamic: 'Block-specific drops (`contents`, `sherds`).', slots: 'Items from entity / container slots.' } }),
    ...entryCommon,
  },
  required: ['type'],
  allOf: dispatch(['type'], {
    item: { properties: { name: id('Item id.') }, required: ['name'] },
    tag: { properties: { name: md('Item tag (without #) (1.21–1.21.11).', ref('resourceLocation')), items: md('Item tag (26.x).', {}), expand: bool('Drop one random item of the tag (true) or all items (false).') } },
    loot_table: { properties: { value: md('Loot table id or inline loot table.', { type: ['string', 'object'] }), name: id('Legacy loot table id.') } },
    dynamic: { properties: { name: md('Dynamic drop id (`contents`, `sherds`).', ref('resourceLocation')) }, required: ['name'] },
    alternatives: { properties: { children: arr(ref('lootEntry'), 'Child entries.') } },
    group: { properties: { children: arr(ref('lootEntry'), 'Child entries.') } },
    sequence: { properties: { children: arr(ref('lootEntry'), 'Child entries.') } },
    slots: { properties: { slot_source: md('Slot source.', {}) } },
  }),
  defaultSnippets: [
    { label: 'item', body: { type: 'minecraft:item', name: '${1:minecraft:diamond}' } },
    { label: 'tag', body: { type: 'minecraft:tag', name: '${1:minecraft:logs}', expand: true } },
    { label: 'loot_table', body: { type: 'minecraft:loot_table', value: '${1:minecraft:chests/simple_dungeon}' } },
    { label: 'empty', body: { type: 'minecraft:empty', weight: '^${1:1}' } },
  ],
});

// ---------------------------------------------------------------------------------------------------------------
// Ingredients & stacks
const ingredientObject = md('Legacy (1.21–1.21.1) ingredient object `{"item": …}` / `{"tag": …}`, or a loader custom ingredient (`type` / `fabric:type`).', {
  type: 'object',
  properties: {
    item: id('Item id.'),
    tag: md('Item tag id (without #).', { type: 'string', pattern: RL }),
    type: md('Custom ingredient type (NeoForge / mods).', ref('resourceLocation')),
    'fabric:type': md('Fabric custom ingredient type.', ref('resourceLocation')),
  },
  anyOf: [{ required: ['item'] }, { required: ['tag'] }, { required: ['type'] }, { required: ['fabric:type'] }],
});
const ingredient = md('Ingredient. 1.21.2+: `"minecraft:stick"`, `"#minecraft:planks"` or a list of item ids. 1.21–1.21.1: `{"item": …}` / `{"tag": …}` or a list of those.', {
  anyOf: [
    { type: 'string', pattern: RL_OR_TAG },
    { type: 'array', items: { anyOf: [{ type: 'string', pattern: RL_OR_TAG }, ref('ingredientObject')] } },
    ref('ingredientObject'),
  ],
  defaultSnippets: [{ label: 'item id', body: '${1:minecraft:stick}' }, { label: 'tag', body: '#${1:minecraft:planks}' }],
});

const itemStackTemplate = md('Result item stack; `{}` means the result is computed from the inputs (special recipes, 26.x).', obj({
  id: id('Item id.'), count: int('Stack size (default 1).', { minimum: 1 }), components: md('Data components.', ref('componentsPatch')),
}));
const itemStack = md('Item stack: `id`, `count` and optional `components`.', obj({
  id: id('Item id, e.g. `minecraft:diamond`.'),
  count: int('Stack size (default 1).', { minimum: 1 }),
  components: md('Data components (`!minecraft:x` removes a default component).', ref('componentsPatch')),
}, {
  required: ['id'],
  defaultSnippets: [{ label: 'item', body: { id: '${1:minecraft:diamond}' } }, { label: 'item × count', body: { id: '${1:minecraft:diamond}', count: '^${2:1}' } }],
}));

export function buildCommon() {
  return {
    title: 'Minecraft common definitions',
    definitions: {
      resourceLocation: md('Resource location `namespace:path` (namespace defaults to `minecraft`).', { type: 'string', pattern: RL }),
      tag: md('Tag reference `#namespace:path`.', { type: 'string', pattern: TAG }),
      idOrTag: md('Id `namespace:path` or tag `#namespace:path`.', { type: 'string', pattern: RL_OR_TAG }),
      holderSet: md('Id, `#tag` or list of ids.', { anyOf: [{ type: 'string', pattern: RL_OR_TAG }, { type: 'array', items: { type: 'string', pattern: RL } }] }),
      textComponent,
      intRange: md('Int range: exact int or `{"min": …, "max": …}`.', { type: ['integer', 'object'], properties: { min: md('Minimum (inclusive).', { type: ['integer', 'object'] }), max: md('Maximum (inclusive).', { type: ['integer', 'object'] }) } }),
      floatRange: md('Float range: exact number or `{"min": …, "max": …}`.', { type: ['number', 'object'], properties: { min: num('Minimum (inclusive).'), max: num('Maximum (inclusive).') } }),
      numberProvider, levelBasedValue, intProvider, floatProvider,
      statePredicate, itemPredicate, blockPredicate, fluidPredicate, locationPredicate, distancePredicate, effectsPredicate,
      flagsPredicate, equipmentPredicate, movementPredicate, typeSpecificPredicate: typeSpecific, entityPredicate,
      damageSourcePredicate, damagePredicate, contextAwarePredicate,
      lootCondition, lootConditionRef, lootFunction, lootFunctionRef, lootEntry,
      ingredientObject, ingredient, itemStack, itemStackTemplate,
      componentsPatch: md('Item data components (`minecraft:id` → value; `!minecraft:id` removes).', compRef('components')),
      color: md('Color: packed RGB int (e.g. `16711680`), `[r, g, b]` floats or `"#RRGGBB"`.', { type: ['integer', 'array', 'string'] }),
      dyeColor: md('Dye color.', { enum: DYE_COLORS }),
      slotGroup: md('Equipment slot group.', { enum: SLOT_GROUPS }),
      equipmentSlot: md('Equipment slot.', { enum: EQUIPMENT_SLOTS }),
      soundEvent: md('Sound event id or inline `{"sound_id": …, "range": …}`.', { anyOf: [{ type: 'string', pattern: RL }, obj({ sound_id: id('Sound id.'), range: num('Range in blocks.') }, { required: ['sound_id'] })] }),
      uuid: md('UUID as 4 ints or a hyphenated string.', { type: ['array', 'string'] }),
      blockState: md('Block state `{"Name": …, "Properties": {…}}`.', obj({ Name: id('Block id.'), Properties: { type: 'object', additionalProperties: { type: 'string' } } }, { required: ['Name'] })),
    },
  };
}
