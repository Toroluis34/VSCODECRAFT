// Data pack file schemas (data/<ns>/...).
import { md, cref, ref, typeField, mcEnum, dispatch, obj, str, int, num, bool, id, arr, reg, RL, RL_OR_TAG } from './lib.mjs';
import { LOOT_CONDITIONS, SLOT_GROUPS } from './common.mjs';

const text = (t) => md(t, cref('textComponent'));
const set = (t) => md(t, cref('holderSet'));
const ing = (t) => md(t, cref('ingredient'));
const stack = (t) => md(t, cref('itemStack'));
const pred = (t) => md(t, cref('contextAwarePredicate'));
const item = (t) => md(t, cref('itemPredicate'));
const conds = (t) => md(t, cref('lootConditionRef'));
const irange = (t) => md(t, cref('intRange'));
const frange = (t) => md(t, cref('floatRange'));
const loc = (t) => md(t, cref('locationPredicate'));
const anyObj = (t) => md(t, { type: 'object' });

// ---------------------------------------------------------------------------------------------------------------
// Recipes
const RECIPE_TYPES = reg('recipe_serializer', [
  'crafting_dye', 'crafting_imbue', 'brewing', 'crafting_special_armordye', 'crafting_special_tippedarrow', 'crafting_special_mapcloning',
  'crafting_special_shulkerboxcoloring', 'crafting_special_suspiciousstew',
]);
const RECIPE_DOCS = {
  crafting_shaped: 'Shaped crafting (pattern + key).', crafting_shapeless: 'Shapeless crafting (ingredient list).',
  crafting_transmute: 'Changes the item type keeping components (1.21.2+), e.g. dyeing shulker boxes.',
  crafting_dye: 'Dyeing items (26.1+, replaces crafting_special_armordye).', crafting_imbue: 'Imbuing items, e.g. tipped arrows (26.1+).',
  smelting: 'Furnace.', blasting: 'Blast furnace.', smoking: 'Smoker.', campfire_cooking: 'Campfire.', stonecutting: 'Stonecutter.',
  smithing_transform: 'Smithing table upgrade.', smithing_trim: 'Smithing table armor trim.', brewing: 'Brewing stand (26.3+).',
};
const craftingCategory = md('Recipe book category.', { enum: ['building', 'redstone', 'equipment', 'misc'] });
const cookingCategory = md('Recipe book category.', { enum: ['food', 'blocks', 'misc'] });
const group = str('Recipe book group: recipes with the same group are shown together.');
const resultStack = stack('Result item stack (`id`, `count`, `components`).');
const cooking = (time) => ({
  properties: {
    category: cookingCategory, group,
    ingredient: ing('Input ingredient.'),
    result: md('Result item stack (`{"id": …}`).', cref('itemStack')),
    experience: num('Experience granted.', { minimum: 0 }),
    cookingtime: int(`Cooking time in ticks (default ${time}).`, { minimum: 1 }),
  },
  required: ['ingredient', 'result'],
});
const recipeCases = {
  crafting_shaped: {
    properties: {
      category: craftingCategory, group,
      pattern: arr({ type: 'string', maxLength: 3 }, 'Up to 3 rows of up to 3 characters; each character is a `key`, space = empty.', { minItems: 1, maxItems: 3 }),
      key: md('Character → ingredient.', { type: 'object', propertyNames: { minLength: 1, maxLength: 1, not: { const: ' ' } }, additionalProperties: cref('ingredient') }),
      result: resultStack,
      show_notification: bool('Show the "recipe unlocked" toast (default true).'),
    },
    required: ['pattern', 'key', 'result'],
  },
  crafting_shapeless: {
    properties: { category: craftingCategory, group, ingredients: arr(cref('ingredient'), 'Ingredients (1–9).', { minItems: 1, maxItems: 9 }), result: resultStack },
    required: ['ingredients', 'result'],
  },
  crafting_transmute: {
    properties: {
      category: craftingCategory, group,
      input: ing('Item whose components are kept.'),
      material: ing('Item that transforms the input.'),
      material_count: irange('Number of material items (26.x).'),
      add_material_count_to_result: bool('Add the material count to the result count (26.x).'),
      result: md('Result item (id string in 1.21.2–1.21.4, item stack in 1.21.5+; `{}` = same as input).', { anyOf: [{ type: 'string', pattern: RL }, cref('itemStackTemplate')] }),
    },
    required: ['input', 'material', 'result'],
  },
  crafting_dye: { properties: { category: craftingCategory, group, target: ing('Item to dye.'), dye: ing('Dye ingredient.'), result: md('Result item stack.', cref('itemStackTemplate')) } },
  crafting_imbue: { properties: { category: craftingCategory, group, source: ing('Item supplying the contents (e.g. a lingering potion).'), material: ing('Item to imbue (e.g. arrows).'), result: md('Result item stack.', cref('itemStackTemplate')) } },
  smelting: cooking(200), blasting: cooking(100), smoking: cooking(100), campfire_cooking: cooking(600),
  stonecutting: { properties: { group, ingredient: ing('Input ingredient.'), result: resultStack }, required: ['ingredient', 'result'] },
  smithing_transform: {
    properties: { template: ing('Smithing template.'), base: ing('Item to upgrade.'), addition: ing('Upgrade material.'), result: resultStack },
    required: ['base', 'result'],
  },
  smithing_trim: {
    properties: { template: ing('Trim template.'), base: ing('Armor to trim.'), addition: ing('Trim material.'), pattern: id('Trim pattern (1.21.5+).') },
    required: ['base'],
  },
  brewing: {
    properties: {
      input: md('Input bottle: `{"item": …, "potion_contents": {"potions": …}}`.', obj({ item: md('Item id / tag.', cref('holderSet')), potion_contents: anyObj('Potion contents predicate.') })),
      reagent: md('Ingredient added on top: `{"item": …}`.', obj({ item: md('Item id / tag.', cref('holderSet')) })),
      output: stack('Resulting item stack.'),
    },
    required: ['input', 'reagent', 'output'],
  },
  crafting_decorated_pot: { properties: { category: craftingCategory, back: ing('Back sherd.'), left: ing('Left sherd.'), right: ing('Right sherd.'), front: ing('Front sherd.'), result: md('Result item stack.', cref('itemStackTemplate')) } },
};
for (const t of RECIPE_TYPES) if (t.startsWith('crafting_special_') && !recipeCases[t]) recipeCases[t] = { properties: { category: craftingCategory, result: md('Result (26.x; `{}` = computed).', cref('itemStackTemplate')) } };

const recipe = {
  title: 'Minecraft recipe',
  type: 'object',
  properties: {
    type: typeField(RECIPE_TYPES, 'Recipe serializer type.', { enumDescriptions: RECIPE_DOCS }),
    'neoforge:conditions': md('NeoForge load conditions.', { type: 'array' }),
    'fabric:load_conditions': md('Fabric load conditions.', { type: 'array' }),
  },
  required: ['type'],
  allOf: dispatch(['type'], recipeCases),
  defaultSnippets: [
    { label: 'crafting_shaped', body: { type: 'minecraft:crafting_shaped', category: '${1:misc}', pattern: ['${2:###}', '${3:# #}', '${4:###}'], key: { '#': '${5:minecraft:stick}' }, result: { id: '${6:minecraft:diamond}', count: 1 } } },
    { label: 'crafting_shapeless', body: { type: 'minecraft:crafting_shapeless', category: '${1:misc}', ingredients: ['${2:minecraft:stick}'], result: { id: '${3:minecraft:diamond}', count: 1 } } },
    { label: 'smelting', body: { type: 'minecraft:smelting', category: '${1:misc}', ingredient: '${2:minecraft:raw_iron}', result: { id: '${3:minecraft:iron_ingot}' }, experience: 0.7, cookingtime: 200 } },
    { label: 'stonecutting', body: { type: 'minecraft:stonecutting', ingredient: '${1:minecraft:stone}', result: { id: '${2:minecraft:stone_slab}', count: 2 } } },
    { label: 'smithing_transform', body: { type: 'minecraft:smithing_transform', template: '${1:minecraft:netherite_upgrade_smithing_template}', base: '${2:minecraft:diamond_sword}', addition: '${3:#minecraft:netherite_tool_materials}', result: { id: '${4:minecraft:netherite_sword}' } } },
  ],
};

// ---------------------------------------------------------------------------------------------------------------
// Loot tables
const LOOT_TABLE_TYPES = ['empty', 'chest', 'command', 'selector', 'fishing', 'entity', 'equipment', 'archaeology', 'gift', 'barter', 'vault', 'advancement_reward', 'advancement_entity', 'advancement_location', 'block_use', 'generic', 'block', 'shearing', 'entity_interact', 'block_interact'];
const lootPool = md('Loot pool: rolls `entries`.', obj({
  rolls: md('Number of rolls (number provider).', cref('numberProvider')),
  bonus_rolls: md('Extra rolls per luck level.', cref('numberProvider')),
  entries: arr(cref('lootEntry'), 'Entries to choose from (weighted).'),
  conditions: arr(cref('lootConditionRef'), 'Conditions for the pool (1.21–1.21.11).'),
  condition: conds('Condition(s) for the pool (26.x).'),
  functions: arr(cref('lootFunction'), 'Functions applied to every item of the pool (1.21–1.21.11).'),
  modifier: md('Modifier(s) applied to every item of the pool (26.x).', cref('lootFunctionRef')),
}, { required: ['rolls', 'entries'], defaultSnippets: [{ label: 'pool', body: { rolls: 1, entries: [{ type: 'minecraft:item', name: '${1:minecraft:diamond}' }] } }] }));
const lootTable = {
  title: 'Minecraft loot table',
  type: 'object',
  properties: {
    type: typeField(LOOT_TABLE_TYPES, 'Loot context type (which parameters are available).'),
    pools: arr(ref('lootPool'), 'Pools.'),
    functions: arr(cref('lootFunction'), 'Functions applied to every item (1.21–1.21.11).'),
    modifier: md('Modifier(s) applied to every item (26.x).', cref('lootFunctionRef')),
    random_sequence: id('Random sequence id (deterministic drops).'),
  },
  definitions: { lootPool },
  defaultSnippets: [
    { label: 'block drops itself', body: { type: 'minecraft:block', pools: [{ rolls: 1, bonus_rolls: 0, entries: [{ type: 'minecraft:item', name: '${1:mymod:block}' }], conditions: [{ condition: 'minecraft:survives_explosion' }] }] } },
    { label: 'entity drops', body: { type: 'minecraft:entity', pools: [{ rolls: 1, entries: [{ type: 'minecraft:item', name: '${1:minecraft:bone}', functions: [{ function: 'minecraft:set_count', count: { type: 'minecraft:uniform', min: 0, max: 2 } }] }] }] } },
  ],
};

// ---------------------------------------------------------------------------------------------------------------
// Advancements
const TRIGGERS = reg('trigger_type');
const TRIGGER_DOCS = {
  impossible: 'Never triggers (grant with /advancement).', inventory_changed: 'Inventory changes.', recipe_unlocked: 'A recipe is unlocked.',
  tick: 'Every tick.', location: 'Every second, checks the location.', consume_item: 'Item consumed.', player_killed_entity: 'Player kills an entity.',
  entity_killed_player: 'Entity kills the player.', placed_block: 'Block placed.', item_used_on_block: 'Item used on a block.', recipe_crafted: 'Recipe crafted.',
  enchanted_item: 'Item enchanted.', changed_dimension: 'Dimension changed.', bred_animals: 'Animals bred.', tame_animal: 'Animal tamed.',
  summoned_entity: 'Entity summoned.', using_item: 'Using an item.', villager_trade: 'Trade with a villager.',
};
const P = (t = 'Player predicate.') => pred(t);
const triggerConds = {
  allay_drop_item_on_block: { location: pred('Location (conditions).'), item: item('Item.') },
  any_block_use: { location: pred('Location (conditions).') },
  default_block_use: { location: pred('Location (conditions).') },
  avoid_vibration: {},
  bee_nest_destroyed: { block: id('Block id.'), item: item('Tool.'), num_bees_inside: irange('Number of bees.') },
  bred_animals: { parent: pred('Parent.'), partner: pred('Partner.'), child: pred('Child.') },
  brewed_potion: { potion: id('Potion id.') },
  changed_dimension: { from: id('Origin dimension.'), to: id('Destination dimension.') },
  channeled_lightning: { victims: arr(cref('contextAwarePredicate'), 'Struck entities.') },
  construct_beacon: { level: irange('Beacon level.') },
  consume_item: { item: item('Consumed item.') },
  crafter_recipe_crafted: { recipe_id: id('Recipe id.'), ingredients: arr(cref('itemPredicate'), 'Ingredients.') },
  recipe_crafted: { recipe_id: id('Recipe id.'), ingredients: arr(cref('itemPredicate'), 'Ingredients.') },
  cured_zombie_villager: { villager: pred('Villager.'), zombie: pred('Zombie.') },
  effects_changed: { effects: md('Effects.', cref('effectsPredicate')), source: pred('Source entity.') },
  enchanted_item: { item: item('Item.'), levels: irange('Levels spent.') },
  enter_block: { block: id('Block id.'), state: md('State.', cref('statePredicate')) },
  entity_hurt_player: { damage: md('Damage.', cref('damagePredicate')) },
  entity_killed_player: { entity: pred('Killer.'), killing_blow: md('Damage source.', cref('damageSourcePredicate')) },
  player_killed_entity: { entity: pred('Killed entity.'), killing_blow: md('Damage source.', cref('damageSourcePredicate')) },
  kill_mob_near_sculk_catalyst: { entity: pred('Killed entity.'), killing_blow: md('Damage source.', cref('damageSourcePredicate')) },
  fall_after_explosion: { start_position: loc('Start.'), distance: md('Distance.', cref('distancePredicate')), cause: pred('Explosion cause.') },
  fall_from_height: { start_position: loc('Start.'), distance: md('Distance.', cref('distancePredicate')) },
  ride_entity_in_lava: { start_position: loc('Start.'), distance: md('Distance.', cref('distancePredicate')) },
  nether_travel: { start_position: loc('Start.'), distance: md('Distance.', cref('distancePredicate')) },
  filled_bucket: { item: item('Filled bucket.') },
  fishing_rod_hooked: { rod: item('Rod.'), entity: pred('Hooked entity.'), item: item('Fished item.') },
  hero_of_the_village: { location: pred('Location.') },
  voluntary_exile: { location: pred('Location.') },
  location: { location: pred('Location.') },
  slept_in_bed: { location: pred('Location.') },
  impossible: {},
  inventory_changed: { slots: obj({ occupied: irange('Occupied slots.'), full: irange('Full slots.'), empty: irange('Empty slots.') }), items: arr(cref('itemPredicate'), 'All must be present.') },
  item_durability_changed: { item: item('Item.'), durability: irange('Remaining durability.'), delta: irange('Change.') },
  item_used_on_block: { location: pred('Location / block / tool conditions.') },
  placed_block: { location: pred('Location / block conditions.') },
  killed_by_arrow: { victims: arr(cref('contextAwarePredicate'), 'Victims.'), unique_entity_types: irange('Unique entity types.'), fired_from_weapon: item('Weapon.') },
  killed_by_crossbow: { victims: arr(cref('contextAwarePredicate'), 'Victims.'), unique_entity_types: irange('Unique entity types.') },
  levitation: { distance: md('Distance.', cref('distancePredicate')), duration: irange('Duration (ticks).') },
  lightning_strike: { lightning: pred('Lightning bolt.'), bystander: pred('Bystander.') },
  player_generates_container_loot: { loot_table: id('Loot table id.') },
  player_hurt_entity: { damage: md('Damage.', cref('damagePredicate')), entity: pred('Hurt entity.') },
  player_interacted_with_entity: { item: item('Item.'), entity: pred('Entity.') },
  player_sheared_equipment: { item: item('Item.'), entity: pred('Entity.') },
  recipe_unlocked: { recipe: id('Recipe id.') },
  shot_crossbow: { item: item('Crossbow.') },
  slide_down_block: { block: id('Block id.'), state: md('State.', cref('statePredicate')) },
  spear_mobs: { count: irange('Mobs hit.') },
  started_riding: {},
  summoned_entity: { entity: pred('Summoned entity.') },
  tame_animal: { entity: pred('Tamed animal.') },
  target_hit: { signal_strength: irange('Signal strength.'), projectile: pred('Projectile.') },
  thrown_item_picked_up_by_entity: { item: item('Item.'), entity: pred('Entity.') },
  thrown_item_picked_up_by_player: { item: item('Item.'), entity: pred('Entity.') },
  tick: {},
  used_ender_eye: { distance: frange('Distance to stronghold.') },
  used_totem: { item: item('Totem.') },
  using_item: { item: item('Item.') },
  villager_trade: { villager: pred('Villager.'), item: item('Bought item.') },
};
const criterion = md('Advancement criterion: `trigger` + `conditions`.', {
  type: 'object',
  properties: {
    trigger: typeField([...new Set([...TRIGGERS, ...Object.keys(triggerConds)])], 'Trigger type.', { enumDescriptions: TRIGGER_DOCS }),
    conditions: md('Trigger conditions (all optional). `player` is available for every trigger.', obj({ player: P() })),
  },
  required: ['trigger'],
  allOf: dispatch(['trigger'], Object.fromEntries(Object.entries(triggerConds).map(([t, props]) => [t, { properties: { conditions: obj({ player: P(), ...props }) } }]))),
  defaultSnippets: [
    { label: 'inventory_changed', body: { trigger: 'minecraft:inventory_changed', conditions: { items: [{ items: '${1:minecraft:diamond}' }] } } },
    { label: 'recipe_unlocked', body: { trigger: 'minecraft:recipe_unlocked', conditions: { recipe: '${1:mymod:my_recipe}' } } },
    { label: 'impossible', body: { trigger: 'minecraft:impossible' } },
    { label: 'tick', body: { trigger: 'minecraft:tick' } },
  ],
});
const advancement = {
  title: 'Minecraft advancement',
  type: 'object',
  properties: {
    parent: id('Parent advancement id (omit for a root advancement / new tab).'),
    display: md('How the advancement is shown (omit to hide it; e.g. recipe unlock advancements).', obj({
      icon: md('Icon item stack.', cref('itemStack')),
      title: text('Title.'),
      description: text('Description.'),
      frame: md('Frame shape.', { enum: ['task', 'goal', 'challenge'] }),
      background: md('Background texture of the tab (root only), e.g. `minecraft:gui/advancements/backgrounds/stone`.', { type: 'string' }),
      show_toast: bool('Show a toast when completed (default true).'),
      announce_to_chat: bool('Announce in chat (default true).'),
      hidden: bool('Hidden until completed (default false).'),
    }, { required: ['icon', 'title', 'description'] })),
    criteria: md('Named criteria.', { type: 'object', additionalProperties: ref('criterion'), minProperties: 1 }),
    requirements: md('List of OR-groups of criterion names, all of which must be met (default: all criteria).', { type: 'array', items: { type: 'array', items: { type: 'string' } } }),
    rewards: md('Rewards.', obj({
      experience: int('Experience points.'),
      recipes: arr({ type: 'string', pattern: RL }, 'Recipes to unlock.'),
      loot: arr({ type: 'string', pattern: RL }, 'Loot tables to give.'),
      function: id('Function to run.'),
    })),
    sends_telemetry_event: bool('Vanilla telemetry (default false).'),
  },
  required: ['criteria'],
  definitions: { criterion },
  defaultSnippets: [
    { label: 'advancement', body: { parent: '${1:minecraft:story/root}', display: { icon: { id: '${2:minecraft:diamond}' }, title: { translate: '${3:advancements.mymod.title}' }, description: { translate: '${4:advancements.mymod.description}' }, frame: 'task' }, criteria: { has_item: { trigger: 'minecraft:inventory_changed', conditions: { items: [{ items: '${2:minecraft:diamond}' }] } } } } },
  ],
};

// ---------------------------------------------------------------------------------------------------------------
const tagFile = {
  title: 'Minecraft tag',
  type: 'object',
  properties: {
    replace: bool('Replace values from lower-priority packs instead of appending (default false).'),
    values: md('Entries: ids, `#tags` or `{"id": …, "required": false}` for optional entries.', {
      type: 'array',
      items: { anyOf: [{ type: 'string', pattern: RL_OR_TAG }, obj({ id: md('Id or #tag.', cref('idOrTag')), required: bool('Fail loading if missing (default true).') }, { required: ['id'] })] },
    }),
    remove: md('NeoForge: entries to remove.', { type: 'array' }),
  },
  required: ['values'],
  defaultSnippets: [{ body: { replace: false, values: ['${1:minecraft:stone}'] } }],
};

// ---------------------------------------------------------------------------------------------------------------
// Enchantments
const EFFECT_COMPONENTS = reg('enchantment_effect_component_type');
const conditionalEffect = (effectSchema) => ({ type: 'object', properties: { effect: effectSchema, requirements: conds('Conditions for the effect.') } });
const valueEffect = md('Value effect (`add`, `multiply`, `set`, `remove_binomial`, `all_of`, `exponential`).', {
  type: 'object',
  properties: { type: typeField(reg('enchantment_value_effect_type', ['add', 'all_of', 'exponential', 'multiply', 'remove_binomial', 'set']), 'Value effect type.'), value: md('Level-based value.', cref('levelBasedValue')), factor: md('Factor.', cref('levelBasedValue')), chance: md('Chance.', cref('levelBasedValue')), effects: md('Effects (all_of).', { type: 'array' }), base: md('Base.', cref('levelBasedValue')), exponent: md('Exponent.', cref('levelBasedValue')) },
});
const entityEffect = md('Entity effect.', { type: 'object', properties: { type: typeField(reg('enchantment_entity_effect_type', ['all_of', 'apply_exhaustion', 'apply_impulse', 'apply_mob_effect', 'attribute', 'change_item_damage', 'damage_entity', 'explode', 'ignite', 'play_sound', 'replace_block', 'replace_disk', 'run_function', 'set_block_properties', 'spawn_particles', 'summon_entity']), 'Entity effect type.') } });
const effectDoc = {
  damage: 'Modifies damage dealt.', damage_protection: 'Reduces damage taken.', damage_immunity: 'Immunity to damage.', post_attack: 'Effects after attacking.',
  tick: 'Every tick.', attributes: 'Attribute modifiers while equipped.', location_changed: 'When the wielder moves.', item_damage: 'Item durability loss.',
  knockback: 'Knockback.', armor_effectiveness: 'Armor effectiveness.', ammo_use: 'Ammo use.', projectile_count: 'Projectile count.', block_experience: 'Block XP.', mob_experience: 'Mob XP.',
};
const effectsProps = {};
for (const c of EFFECT_COMPONENTS) {
  const docs = effectDoc[c] ?? `\`${c}\` effect component.`;
  if (['damage', 'damage_protection', 'item_damage', 'knockback', 'armor_effectiveness', 'ammo_use', 'projectile_count', 'projectile_spread', 'projectile_piercing', 'block_experience', 'mob_experience', 'repair_with_xp', 'equipment_drops', 'fishing_luck_bonus', 'fishing_time_reduction', 'smash_damage_per_fallen_block', 'trident_return_acceleration'].includes(c)) {
    effectsProps[`minecraft:${c}`] = arr(conditionalEffect(valueEffect), docs);
  } else if (['post_attack', 'post_piercing_attack'].includes(c)) {
    effectsProps[`minecraft:${c}`] = arr(obj({ enchanted: md('Who has the enchantment.', { enum: ['attacker', 'damaging_entity', 'victim'] }), affected: md('Who is affected.', { enum: ['attacker', 'damaging_entity', 'victim'] }), effect: entityEffect, requirements: conds('Conditions.') }), docs);
  } else if (c === 'attributes') {
    effectsProps[`minecraft:${c}`] = arr(obj({ attribute: id('Attribute.'), id: id('Modifier id.'), amount: md('Amount.', cref('levelBasedValue')), operation: md('Operation.', { enum: ['add_value', 'add_multiplied_base', 'add_multiplied_total'] }) }), docs);
  } else {
    effectsProps[`minecraft:${c}`] = md(docs, {});
  }
}
const costs = (t) => md(t, obj({ base: int('Cost at level 1.'), per_level_above_first: int('Added per level above 1.') }, { required: ['base', 'per_level_above_first'] }));
const enchantment = {
  title: 'Minecraft enchantment',
  type: 'object',
  properties: {
    description: text('Name (usually `{"translate": "enchantment.<ns>.<id>"}`).'),
    exclusive_set: set('Incompatible enchantments (id, `#tag` or list).'),
    supported_items: set('Items that can have it (anvil, /enchant).'),
    primary_items: set('Items that get it in an enchanting table.'),
    weight: int('Rarity weight (1–1024).', { minimum: 1, maximum: 1024 }),
    max_level: int('Maximum level (1–255).', { minimum: 1, maximum: 255 }),
    min_cost: costs('Minimum enchanting cost.'),
    max_cost: costs('Maximum enchanting cost.'),
    anvil_cost: int('Base anvil cost.', { minimum: 0 }),
    slots: arr({ enum: SLOT_GROUPS }, 'Slots where it is active.'),
    effects: md('Effect components.', obj(effectsProps)),
  },
  required: ['description', 'supported_items', 'weight', 'max_level', 'min_cost', 'max_cost', 'anvil_cost', 'slots'],
  defaultSnippets: [{ body: { description: { translate: 'enchantment.${1:mymod}.${2:my_enchantment}' }, supported_items: '${3:#minecraft:enchantable/weapon}', weight: 5, max_level: 3, min_cost: { base: 1, per_level_above_first: 10 }, max_cost: { base: 51, per_level_above_first: 10 }, anvil_cost: 2, slots: ['mainhand'], effects: {} } }],
};

// ---------------------------------------------------------------------------------------------------------------
const damageType = {
  title: 'Minecraft damage type',
  type: 'object',
  properties: {
    message_id: str('Death message key part: `death.attack.<message_id>`.'),
    exhaustion: num('Hunger exhaustion caused.'),
    scaling: md('Difficulty scaling.', { enum: ['never', 'when_caused_by_living_non_player', 'always'] }),
    effects: md('Hurt sound / effect.', { enum: ['hurt', 'thorns', 'drowning', 'burning', 'poking', 'freezing'] }),
    death_message_type: md('Death message variant.', { enum: ['default', 'fall_variants', 'intentional_game_design'] }),
  },
  required: ['message_id', 'exhaustion', 'scaling'],
  defaultSnippets: [{ body: { message_id: '${1:generic}', exhaustion: 0.1, scaling: 'when_caused_by_living_non_player' } }],
};
const trimMaterial = {
  title: 'Minecraft trim material',
  type: 'object',
  properties: {
    asset_name: str('Texture suffix / palette name (≤1.21.11).'),
    palette_id: str('Palette id (26.x).'),
    description: text('Name shown in the tooltip (with color).'),
    ingredient: id('Legacy (≤1.21.4) material item.'),
    item_model_index: num('Legacy (≤1.21.3) model predicate index.'),
    override_armor_materials: md('Legacy armor material → asset name override.', { type: 'object' }),
    override_armor_assets: md('Equipment asset → asset name override (1.21.4+).', { type: 'object' }),
  },
  required: ['description'],
};
const trimPattern = {
  title: 'Minecraft trim pattern',
  type: 'object',
  properties: { asset_id: id('Texture id.'), description: text('Name.'), template_item: id('Legacy (≤1.21.4) template item.'), decal: bool('Render as decal.') },
  required: ['asset_id', 'description'],
};
const paintingVariant = {
  title: 'Minecraft painting variant',
  type: 'object',
  properties: { asset_id: id('Texture id (textures/painting/<id>.png).'), width: int('Width in blocks (1–16).', { minimum: 1, maximum: 16 }), height: int('Height in blocks (1–16).', { minimum: 1, maximum: 16 }), title: text('Title (1.21.2+).'), author: text('Author (1.21.2+).') },
  required: ['asset_id', 'width', 'height'],
  defaultSnippets: [{ body: { asset_id: '${1:mymod:my_painting}', width: 2, height: 2, title: { translate: 'painting.${1}.title' }, author: { translate: 'painting.${1}.author' } } }],
};
const jukeboxSong = {
  title: 'Minecraft jukebox song',
  type: 'object',
  properties: { sound_event: md('Sound event.', cref('soundEvent')), description: text('Song name.'), length_in_seconds: num('Length (seconds).', { exclusiveMinimum: 0 }), comparator_output: int('Comparator output 0–15.', { minimum: 0, maximum: 15 }) },
  required: ['sound_event', 'description', 'length_in_seconds', 'comparator_output'],
};
const bannerPattern = { title: 'Minecraft banner pattern', type: 'object', properties: { asset_id: id('Texture id.'), translation_key: str('Translation key prefix.') }, required: ['asset_id', 'translation_key'] };
const instrument = { title: 'Minecraft instrument', type: 'object', properties: { sound_event: md('Sound.', cref('soundEvent')), use_duration: num('Use duration (seconds).'), range: num('Range (blocks).'), description: text('Description.') }, required: ['sound_event', 'use_duration', 'range'] };

const spawnConditions = arr(obj({
  priority: int('Higher priority conditions are checked first.'),
  condition: md('Spawn condition.', obj({ type: typeField(['biome', 'structure', 'moon_brightness'], 'Condition type.'), biomes: set('Biomes.'), structures: set('Structures.'), range: frange('Moon brightness range.') })),
}, { required: ['priority'] }), 'Spawn conditions (1.21.5+).');
const mobVariant = {
  title: 'Minecraft mob variant',
  type: 'object',
  properties: {
    asset_id: id('Texture id.'), baby_asset_id: id('Baby texture id (26.x).'), model: str('Model kind (`normal`, `cold`, `warm`…).'),
    spawn_conditions: spawnConditions,
    // wolf
    assets: obj({ wild: id('Wild texture.'), tame: id('Tame texture.'), angry: id('Angry texture.') }),
    baby_assets: obj({ wild: id('Wild texture.'), tame: id('Tame texture.'), angry: id('Angry texture.') }),
    wild_texture: id('Legacy wolf wild texture.'), tame_texture: id('Legacy wolf tame texture.'), angry_texture: id('Legacy wolf angry texture.'), biomes: set('Legacy biomes.'),
  },
};

const dimensionType = {
  title: 'Minecraft dimension type',
  type: 'object',
  properties: {
    ultrawarm: bool('Water evaporates, lava flows faster (≤1.21.11).'), natural: bool('Compasses work, portals spawn piglins (≤1.21.11).'),
    coordinate_scale: num('Coordinate scale vs. the overworld.'), has_skylight: bool('Has sky light.'), has_ceiling: bool('Has bedrock ceiling.'),
    ambient_light: num('Ambient light 0–1.'), fixed_time: int('Fixed time of day (≤1.21.11).'), piglin_safe: bool('Piglins don’t zombify (≤1.21.11).'),
    bed_works: bool('Beds work (≤1.21.11).'), respawn_anchor_works: bool('Respawn anchors work (≤1.21.11).'), has_raids: bool('Raids (≤1.21.11).'),
    logical_height: int('Max height for portals / chorus.'), min_y: int('Minimum Y (multiple of 16).'), height: int('Height (multiple of 16).'),
    infiniburn: md('Block tag that burns forever.', cref('tag')), effects: id('Sky effects (≤1.21.11).'),
    monster_spawn_light_level: md('Light level for spawning (int provider).', cref('intProvider')), monster_spawn_block_light_limit: int('Max block light for spawning.'),
    attributes: md('Environment attributes (1.21.11+).', { type: 'object' }), timelines: set('Timelines (26.x).'),
    has_fixed_time: bool('Fixed time (26.x).'), has_ender_dragon_fight: bool('Ender dragon fight (26.x).'), skybox: str('Skybox (26.x).'), cardinal_light: str('Cardinal lighting (26.x).'), default_clock: id('World clock (26.x).'),
  },
  required: ['min_y', 'height', 'logical_height'],
};
const biome = {
  title: 'Minecraft biome',
  type: 'object',
  properties: {
    has_precipitation: bool('Rain / snow.'), temperature: num('Temperature.'), downfall: num('Downfall.'),
    temperature_modifier: md('Temperature modifier.', { enum: ['none', 'frozen'] }),
    effects: md('Visual effects (colors as int or "#RRGGBB").', obj(Object.fromEntries(['fog_color', 'sky_color', 'water_color', 'water_fog_color', 'foliage_color', 'dry_foliage_color', 'grass_color'].map((k) => [k, md(`${k}.`, { type: ['integer', 'string'] })])))),
    attributes: md('Environment attributes (1.21.11+).', { type: 'object' }),
    carvers: md('Configured carvers.', { type: ['string', 'array', 'object'] }),
    features: md('Placed features per generation step (11 lists).', { type: 'array' }),
    spawners: md('Mob spawners per category.', { type: 'object' }),
    spawn_costs: md('Spawn costs.', { type: 'object' }),
    creature_spawn_probability: num('Creature spawn probability.'),
  },
};

export function buildData() {
  return {
    'recipe.json': recipe,
    'loot_table.json': lootTable,
    'predicate.json': { title: 'Minecraft predicate', ...cref('lootConditionRef') },
    'item_modifier.json': { title: 'Minecraft item modifier', ...cref('lootFunctionRef') },
    'advancement.json': advancement,
    'tag.json': tagFile,
    'enchantment.json': enchantment,
    'damage_type.json': damageType,
    'trim_material.json': trimMaterial,
    'trim_pattern.json': trimPattern,
    'painting_variant.json': paintingVariant,
    'jukebox_song.json': jukeboxSong,
    'banner_pattern.json': bannerPattern,
    'instrument.json': instrument,
    'mob_variant.json': mobVariant,
    'dimension_type.json': dimensionType,
    'biome.json': biome,
  };
}
export { LOOT_CONDITIONS };
