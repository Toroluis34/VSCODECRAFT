// item-components.json — item data components (1.20.5+ / 1.21+ / 26.x), shared by recipes, loot, advancements…
import { md, cref, ref, typeField, obj, str, int, num, bool, id, arr, reg, RL } from './lib.mjs';
import { DYE_COLORS, SLOT_GROUPS, EQUIPMENT_SLOTS } from './common.mjs';

const text = (t) => md(t, cref('textComponent'));
const set = (t) => md(t, cref('holderSet'));
const anyVal = (t) => md(t, {});
const empty = (t) => md(t, { type: 'object' });

const consumeEffect = md('Consume effect.', {
  type: 'object',
  properties: {
    type: typeField(reg('consume_effect_type'), 'Effect type.'),
    effects: md('Effects to apply (`[{id, amplifier, duration…}]`) or remove (id / #tag / list).', { type: ['array', 'string'] }),
    probability: num('Probability 0–1 (apply_effects).', { minimum: 0, maximum: 1 }),
    diameter: num('Teleport diameter (teleport_randomly).'),
    sound: md('Sound (play_sound).', cref('soundEvent')),
  },
  required: ['type'],
  defaultSnippets: [{ label: 'apply_effects', body: { type: 'minecraft:apply_effects', effects: [{ id: '${1:minecraft:regeneration}', duration: '^${2:100}', amplifier: '^${3:0}' }] } }],
});

const mobEffectInstance = obj({
  id: id('Mob effect id.'), amplifier: int('Amplifier (0 = level I).'), duration: int('Duration in ticks (-1 = infinite).'),
  ambient: bool('Ambient (beacon-like).'), show_particles: bool('Show particles.'), show_icon: bool('Show icon.'),
});

const attributeModifier = obj({
  type: id('Attribute id, e.g. `minecraft:attack_damage`.'),
  attribute: id('Legacy attribute key.'),
  id: id('Unique modifier id, e.g. `mymod:ruby_sword_damage`.'),
  amount: num('Amount.'),
  operation: md('Operation.', { enum: ['add_value', 'add_multiplied_base', 'add_multiplied_total'] }),
  slot: md('Slot group (default any).', { enum: SLOT_GROUPS }),
  display: md('Tooltip display (1.21.6+): `{"type": "default" | "hidden" | "override", "value": text}`.', { type: 'object' }),
}, { defaultSnippets: [{ label: 'attack damage', body: { type: 'minecraft:attack_damage', id: '${1:mymod:bonus_damage}', amount: '^${2:4}', operation: 'add_value', slot: 'mainhand' } }] });

const C = {
  custom_name: text('Custom name (like renaming in an anvil; italic by default).'),
  item_name: text('Default item name (not italic; can’t be changed in an anvil).'),
  lore: arr(cref('textComponent'), 'Tooltip lore lines.', { maxItems: 256 }),
  rarity: md('Rarity (name color).', { enum: ['common', 'uncommon', 'rare', 'epic'] }),
  max_stack_size: int('Maximum stack size (1–99). Can’t be combined with max_damage.', { minimum: 1, maximum: 99 }),
  max_damage: int('Maximum durability.', { minimum: 1 }),
  damage: int('Current damage.', { minimum: 0 }),
  unbreakable: md('Item never loses durability. `{}` (1.21.5+) or `{"show_in_tooltip": false}` (≤1.21.4).', { type: 'object' }),
  enchantments: md('Enchantments: `{"minecraft:sharpness": 3}` (1.21.5+) or `{"levels": {…}, "show_in_tooltip": …}` (≤1.21.4).', {
    type: 'object',
    properties: { levels: md('Enchantment id → level.', { type: 'object', additionalProperties: { type: 'integer' } }), show_in_tooltip: bool('Show in tooltip.') },
    additionalProperties: { type: ['integer', 'object', 'boolean'] },
  }),
  stored_enchantments: md('Stored enchantments (enchanted books). Same format as `enchantments`.', { type: 'object' }),
  enchantment_glint_override: bool('Force (true) or hide (false) the enchantment glint.'),
  enchantable: md('Enchantability in an enchanting table.', obj({ value: int('Enchantability.', { minimum: 1 }) }, { required: ['value'] })),
  repairable: md('Items that repair this one in an anvil.', obj({ items: set('Item id, `#tag` or list.') }, { required: ['items'] })),
  attribute_modifiers: md('Attribute modifiers: a list (1.21.5+) or `{"modifiers": […], "show_in_tooltip": …}` (≤1.21.4).', {
    type: ['array', 'object'],
    items: attributeModifier,
    properties: { modifiers: arr(attributeModifier, 'Modifiers.'), show_in_tooltip: bool('Show in tooltip.') },
  }),
  food: md('Makes the item edible (combine with `consumable` in 1.21.2+).', obj({
    nutrition: int('Hunger points restored.', { minimum: 0 }),
    saturation: num('Saturation restored.'),
    can_always_eat: bool('Edible even when not hungry.'),
    eat_seconds: num('Legacy (≤1.21.1) eating time.'),
    effects: md('Legacy (≤1.21.1) effects.', { type: 'array' }),
    using_converts_to: md('Legacy (1.21.0–1.21.1) item left after eating.', cref('itemStack')),
  }, { required: ['nutrition', 'saturation'], defaultSnippets: [{ body: { nutrition: '^${1:4}', saturation: '^${2:2.4}' } }] })),
  consumable: md('Makes the item consumable (1.21.2+).', obj({
    consume_seconds: num('Seconds to consume (default 1.6).'),
    animation: md('Use animation.', { enum: ['none', 'eat', 'drink', 'block', 'bow', 'spear', 'crossbow', 'spyglass', 'toot_horn', 'brush', 'bundle', 'trident'] }),
    sound: md('Sound while consuming.', cref('soundEvent')),
    has_consume_particles: bool('Show item particles.'),
    on_consume_effects: arr(ref('consumeEffect'), 'Effects applied when consumed.'),
  }, { defaultSnippets: [{ body: { consume_seconds: '^${1:1.6}', animation: '${2:eat}' } }] })),
  use_remainder: md('Item left after use (1.21.2+).', cref('itemStack')),
  use_cooldown: md('Cooldown after use (1.21.2+).', obj({ seconds: num('Cooldown seconds.'), cooldown_group: id('Shared cooldown group.') }, { required: ['seconds'] })),
  tool: md('Makes the item a mining tool.', obj({
    rules: arr(obj({ blocks: set('Blocks (id, `#tag` or list).'), speed: num('Mining speed.'), correct_for_drops: bool('Whether blocks drop items.') }, { required: ['blocks'] }), 'Mining rules (first match wins).'),
    default_mining_speed: num('Speed for blocks not matched by any rule.'),
    damage_per_block: int('Durability lost per mined block.'),
    can_destroy_blocks_in_creative: bool('Can break blocks in creative (1.21.5+).'),
  }, { required: ['rules'] })),
  weapon: md('Makes the item a weapon (1.21.5+).', obj({ item_damage_per_attack: int('Durability lost per attack.'), disable_blocking_for_seconds: num('Seconds a hit disables shields.') })),
  equippable: md('Makes the item equippable (1.21.2+).', obj({
    slot: md('Equipment slot.', { enum: EQUIPMENT_SLOTS }),
    equip_sound: md('Sound when equipped.', cref('soundEvent')),
    asset_id: id('Equipment asset id (assets/<ns>/equipment/<id>.json) (1.21.4+).'),
    model: id('Equipment model id (1.21.2–1.21.3).'),
    camera_overlay: id('Overlay texture when worn on the head.'),
    allowed_entities: set('Entity types that can wear it.'),
    dispensable: bool('Dispensers can equip it.'),
    swappable: bool('Right-click swaps with worn item.'),
    damage_on_hurt: bool('Loses durability when the wearer is hurt.'),
    equip_on_interact: bool('Equip on entity interaction (1.21.5+).'),
    can_be_sheared: bool('Can be sheared off (1.21.6+).'),
    shearing_sound: md('Shearing sound.', cref('soundEvent')),
  }, { required: ['slot'], defaultSnippets: [{ body: { slot: '${1:head}', asset_id: '${2:mymod:ruby}' } }] })),
  glider: empty('Allows gliding like an elytra when equipped (1.21.2+).'),
  death_protection: md('Protects from death like a totem (1.21.2+).', obj({ death_effects: arr(ref('consumeEffect'), 'Effects applied on activation.') })),
  damage_resistant: md('Immune to damage types (e.g. fire) (1.21.2+).', obj({ types: md('Damage type tag, e.g. `#minecraft:is_fire`.', cref('tag')) }, { required: ['types'] })),
  fire_resistant: empty('Legacy (≤1.21.1) fire immunity (use damage_resistant).'),
  blocks_attacks: md('Can block attacks like a shield (1.21.5+).', obj({
    block_delay_seconds: num('Delay before blocking.'),
    disable_cooldown_scale: num('Multiplier for disable cooldown.'),
    damage_reductions: arr(obj({ type: set('Damage types.'), base: num('Base reduction.'), factor: num('Factor.'), horizontal_blocking_angle: num('Angle in degrees.') }), 'Damage reductions.'),
    item_damage: obj({ threshold: num('Threshold.'), base: num('Base.'), factor: num('Factor.') }),
    bypassed_by: md('Damage type tag that bypasses blocking.', cref('tag')),
    block_sound: md('Block sound.', cref('soundEvent')),
    disable_sound: md('Disabled sound.', cref('soundEvent')),
  })),
  dyed_color: md('Dye color: RGB int (1.21.5+) or `{"rgb": …, "show_in_tooltip": …}` (≤1.21.4).', { type: ['integer', 'object', 'string', 'array'] }),
  custom_model_data: md('Custom model data: `{"floats": [], "flags": [], "strings": [], "colors": []}` (1.21.4+) or an int (≤1.21.3).', {
    type: ['integer', 'object'],
    properties: { floats: arr({ type: 'number' }, 'Floats (range_dispatch).'), flags: arr({ type: 'boolean' }, 'Flags (condition).'), strings: arr({ type: 'string' }, 'Strings (select).'), colors: md('Colors (tint).', { type: 'array' }) },
  }),
  item_model: id('Item model definition id (assets/<ns>/items/<id>.json) (1.21.2+).'),
  tooltip_display: md('Hides the tooltip or some components (1.21.5+).', obj({ hide_tooltip: bool('Hide the whole tooltip.'), hidden_components: arr(md('Component type.', cref('resourceLocation')), 'Components hidden from the tooltip.') })),
  hide_tooltip: empty('Legacy (≤1.21.4) hide tooltip.'),
  hide_additional_tooltip: empty('Legacy (≤1.21.4) hide additional tooltip.'),
  tooltip_style: id('Tooltip sprite style (1.21.2+).'),
  potion_contents: md('Potion: id string or `{"potion", "custom_color", "custom_effects", "custom_name"}`.', {
    type: ['string', 'object'],
    properties: { potion: id('Potion id.'), custom_color: md('ARGB/RGB color.', cref('color')), custom_effects: arr(mobEffectInstance, 'Extra effects.'), custom_name: str('Name suffix for translation.') },
  }),
  potion_duration_scale: num('Potion duration multiplier.'),
  suspicious_stew_effects: arr(obj({ id: id('Effect id.'), duration: int('Duration (ticks).') }), 'Suspicious stew effects.'),
  custom_data: md('Custom NBT: SNBT string or object.', { type: ['string', 'object'] }),
  trim: md('Armor trim.', obj({ material: id('Trim material.'), pattern: id('Trim pattern.'), show_in_tooltip: bool('Legacy.') }, { required: ['material', 'pattern'] })),
  jukebox_playable: md('Plays in a jukebox: song id (1.21.5+) or `{"song", "show_in_tooltip"}`.', { type: ['string', 'object'] }),
  instrument: md('Goat horn instrument id or inline instrument.', { type: ['string', 'object'] }),
  provides_trim_material: id('Trim material provided in a smithing table (1.21.5+).'),
  provides_banner_patterns: md('Banner pattern tag provided in a loom.', cref('tag')),
  banner_patterns: arr(obj({ pattern: md('Pattern id or inline.', { type: ['string', 'object'] }), color: md('Color.', { enum: DYE_COLORS }) }), 'Banner pattern layers.'),
  base_color: md('Base dye color (shields).', { enum: DYE_COLORS }),
  can_break: md('Adventure mode: blocks it can break (block predicate or list).', { type: ['object', 'array'] }),
  can_place_on: md('Adventure mode: blocks it can be placed on.', { type: ['object', 'array'] }),
  container: arr(obj({ slot: int('Slot index.'), item: cref('itemStack') }), 'Container contents.'),
  bundle_contents: arr(cref('itemStack'), 'Bundle contents.'),
  charged_projectiles: arr(cref('itemStack'), 'Loaded crossbow projectiles.'),
  container_loot: obj({ loot_table: id('Loot table id.'), seed: int('Seed.') }),
  block_state: md('Block state properties applied when placed.', { type: 'object', additionalProperties: { type: 'string' } }),
  block_entity_data: md('Block entity NBT (requires `id` in 1.21.5+).', { type: ['object', 'string'] }),
  entity_data: md('Entity NBT (requires `id` in 1.21.5+).', { type: ['object', 'string'] }),
  bucket_entity_data: md('Bucket entity NBT.', { type: ['object', 'string'] }),
  profile: md('Player head profile: name string or `{name, id, properties}` / skin texture.', { type: ['string', 'object'] }),
  note_block_sound: id('Sound played by a note block with this head.'),
  break_sound: md('Sound when the item breaks (1.21.5+).', cref('soundEvent')),
  firework_explosion: obj({ shape: md('Shape.', { enum: ['small_ball', 'large_ball', 'star', 'creeper', 'burst'] }), colors: md('Colors.', {}), fade_colors: md('Fade colors.', {}), has_trail: bool('Trail.'), has_twinkle: bool('Twinkle.') }),
  fireworks: obj({ flight_duration: int('Flight duration.'), explosions: md('Explosions.', { type: 'array' }) }),
  writable_book_content: obj({ pages: md('Pages.', { type: 'array' }) }),
  written_book_content: obj({ title: md('Title.', {}), author: str('Author.'), generation: int('Generation.'), pages: md('Pages.', { type: 'array' }), resolved: bool('Resolved.') }),
  map_color: int('Map item color.'),
  map_id: int('Map id.'),
  map_decorations: md('Map decorations.', { type: 'object' }),
  lodestone_tracker: md('Lodestone tracker.', { type: 'object' }),
  recipes: arr({ type: 'string' }, 'Knowledge book recipes.'),
  repair_cost: int('Anvil repair cost.'),
  intangible_projectile: empty('Projectile can’t be picked up.'),
  ominous_bottle_amplifier: int('Bad omen amplifier.'),
  pot_decorations: md('Decorated pot sherds: list of item ids, or `{front, left, right, back}` (26.x).', { type: ['array', 'object'] }),
  debug_stick_state: md('Debug stick state.', { type: 'object' }),
  lock: md('Container lock (item predicate in 1.21.2+).', { type: ['object', 'string'] }),
  damage_type: md('Damage type for mace-like attacks (1.21.5+).', { type: ['string', 'object'] }),
  minimum_attack_charge: num('Minimum attack charge to attack (26.x).'),
  kinetic_weapon: anyVal('Kinetic (spear) weapon (26.x).'),
  piercing_weapon: anyVal('Piercing weapon (26.x).'),
  attack_range: anyVal('Attack range (26.x).'),
  use_effects: anyVal('Use effects (26.x).'),
  swing_animation: anyVal('Swing animation.'),
  creative_slot_lock: empty('Creative slot lock.'),
  map_post_processing: anyVal('Map post processing.'),
};
for (const t of reg('data_component_type')) if (!(t in C)) C[t] = anyVal(`\`${t}\` component.`);

export function buildComponents() {
  const properties = {};
  for (const [k, v] of Object.entries(C).sort(([a], [b]) => a.localeCompare(b))) properties[`minecraft:${k}`] = v;
  return {
    title: 'Minecraft item data components',
    definitions: {
      consumeEffect,
      mobEffectInstance,
      attributeModifier,
      components: md('Item data components: `"minecraft:<component>": value`. Prefix with `!` to remove a default component (`"!minecraft:food": {}`).', {
        type: 'object',
        properties,
        patternProperties: { '^!': md('Removes this default component. Value must be `{}`.', { type: 'object' }) },
        propertyNames: { pattern: `^!?${RL.slice(1, -1)}$` },
      }),
    },
  };
}
