// Resource pack file schemas (assets/<ns>/...).
import { md, cref, ref, typeField, dispatch, obj, str, int, num, bool, id, arr, RL } from './lib.mjs';

const vec3 = (t) => arr({ type: 'number' }, t, { minItems: 3, maxItems: 3 });
const DIRS = ['down', 'up', 'north', 'south', 'east', 'west'];
const DISPLAY = ['thirdperson_righthand', 'thirdperson_lefthand', 'firstperson_righthand', 'firstperson_lefthand', 'gui', 'head', 'ground', 'fixed', 'on_shelf'];
const textureRef = (t) => md(t, { type: 'string' });
const textureValue = (t) => md(t, { anyOf: [{ type: 'string' }, obj({ sprite: str('Texture id.'), force_translucent: bool('Force translucent rendering.') }, { required: ['sprite'] })] });

// ---------------------------------------------------------------------------------------------------------------
const face = obj({
  uv: arr({ type: 'number' }, 'Texture area `[x1, y1, x2, y2]` (0–16).', { minItems: 4, maxItems: 4 }),
  texture: textureRef('Texture variable (`#side`) or texture id.'),
  cullface: md('Skip this face when that side is covered by a full block.', { enum: [...DIRS, 'bottom'] }),
  rotation: md('UV rotation.', { enum: [0, 90, 180, 270] }),
  tintindex: int('Tint index (block / item color handlers).'),
}, { required: ['texture'] });
const element = obj({
  from: vec3('Start corner `[x, y, z]` (−16…32).'),
  to: vec3('End corner `[x, y, z]` (−16…32).'),
  rotation: md('Element rotation: `{origin, axis, angle, rescale}` or per-axis `x`/`y`/`z` (26.x).', obj({
    origin: vec3('Rotation pivot.'), axis: md('Axis.', { enum: ['x', 'y', 'z'] }), angle: num('Angle (−45…45; multiples of 22.5 before 1.21.6).'),
    rescale: bool('Rescale faces across the whole block.'), x: num('X rotation.'), y: num('Y rotation.'), z: num('Z rotation.'),
  })),
  shade: bool('Apply directional shading (default true).'),
  light_emission: int('Minimum light level 0–15.', { minimum: 0, maximum: 15 }),
  faces: md('Faces.', obj(Object.fromEntries(DIRS.map((d) => [d, face])))),
  name: str('Name (Blockbench).'),
  __comment: str('Comment.'),
}, { required: ['from', 'to', 'faces'] });
const transform = obj({ rotation: vec3('Rotation `[x, y, z]` degrees.'), translation: vec3('Translation `[x, y, z]` (−80…80).'), scale: vec3('Scale `[x, y, z]` (≤4).') });
const blockModel = {
  title: 'Minecraft block / item model',
  type: 'object',
  properties: {
    parent: md('Parent model id, e.g. `minecraft:block/cube_all`, `minecraft:item/generated`, `builtin/entity`.', { type: 'string' }),
    ambientocclusion: bool('Ambient occlusion (default true).'),
    gui_light: md('GUI lighting.', { enum: ['front', 'side'] }),
    textures: md('Texture variables → texture id (`minecraft:block/stone`) or `#variable`.', {
      type: 'object',
      additionalProperties: textureValue('Texture id, `#variable` or `{"sprite": …, "force_translucent": …}` (26.x).'),
      properties: { particle: textureValue('Particle texture.'), all: textureValue('All faces (cube_all).'), layer0: textureValue('Item layer 0 (item/generated).'), layer1: textureValue('Item layer 1.'), side: textureValue('Side.'), end: textureValue('Top & bottom.'), top: textureValue('Top.'), bottom: textureValue('Bottom.'), front: textureValue('Front.') },
    }),
    elements: arr(element, 'Cuboid elements (replace the parent’s).'),
    display: md('Display transforms.', obj(Object.fromEntries(DISPLAY.map((d) => [d, transform])))),
    texture_size: arr({ type: 'number' }, 'Texture size (Blockbench).'),
    groups: md('Element groups (Blockbench).', { type: 'array' }),
    overrides: arr(obj({ predicate: md('Item property → value.', { type: 'object' }), model: id('Model id.') }), 'Legacy (≤1.21.3) item model overrides.'),
    render_type: str('NeoForge render type (`minecraft:cutout`…).'),
    loader: str('NeoForge / Forge custom model loader.'),
  },
  defaultSnippets: [
    { label: 'cube_all', body: { parent: 'minecraft:block/cube_all', textures: { all: '${1:mymod:block/name}' } } },
    { label: 'item/generated', body: { parent: 'minecraft:item/generated', textures: { layer0: '${1:mymod:item/name}' } } },
  ],
};

// ---------------------------------------------------------------------------------------------------------------
// Item model definitions (1.21.4+)
const ITEM_MODEL_TYPES = ['empty', 'model', 'composite', 'condition', 'select', 'range_dispatch', 'special', 'bundle/selected_item'];
const CONDITION_PROPS = ['broken', 'bundle/has_selected_item', 'carried', 'component', 'custom_model_data', 'damaged', 'extended_view', 'fishing_rod/cast', 'has_component', 'keybind_down', 'selected', 'using_item', 'view_entity'];
const SELECT_PROPS = ['block_state', 'charge_type', 'component', 'context_dimension', 'context_entity_type', 'custom_model_data', 'display_context', 'local_time', 'main_hand', 'trim_material'];
const RANGE_PROPS = ['bundle/fullness', 'compass', 'cooldown', 'count', 'crossbow/pull', 'custom_model_data', 'damage', 'time', 'use_cycle', 'use_duration'];
const SPECIAL_TYPES = ['banner', 'bed', 'chest', 'conduit', 'copper_golem_statue', 'decorated_pot', 'end_cube', 'hanging_sign', 'head', 'player_head', 'shield', 'shulker_box', 'standing_sign', 'trident'];
const TINT_TYPES = ['constant', 'custom_model_data', 'dye', 'firework', 'grass', 'map_color', 'potion', 'team'];
const color = (t) => md(t, { type: ['integer', 'array'] });
const tint = md('Tint source (for `tintindex` faces).', {
  type: 'object',
  properties: {
    type: typeField(TINT_TYPES, 'Tint source type.'),
    value: color('Constant color (RGB int or `[r, g, b]`).'), default: color('Default color.'),
    temperature: num('Grass temperature.'), downfall: num('Grass downfall.'), index: int('Custom model data color index.'),
  },
  required: ['type'],
  allOf: dispatch(['type'], { constant: { required: ['value'] }, grass: { required: ['temperature', 'downfall'] } }),
  defaultSnippets: [{ label: 'dye', body: { type: 'minecraft:dye', default: '^${1:-6265536}' } }, { label: 'constant', body: { type: 'minecraft:constant', value: '^${1:-1}' } }],
});
const itemModel = md('Item model: `model`, `composite`, `condition`, `select`, `range_dispatch`, `special`, `bundle/selected_item` or `empty`.', {
  type: 'object',
  properties: {
    type: typeField(ITEM_MODEL_TYPES, 'Item model type.', { enumDescriptions: { model: 'Renders a model file.', composite: 'Renders several models.', condition: 'Boolean property → on_true / on_false.', select: 'Switch on a property value.', range_dispatch: 'Numeric property thresholds.', special: 'Hard-coded special renderer.', empty: 'Renders nothing.', 'bundle/selected_item': 'Selected bundle item.' } }),
    transformation: md('Extra transformation (26.x).', { type: ['object', 'array'] }),
  },
  required: ['type'],
  allOf: dispatch(['type'], {
    model: { properties: { model: id('Model id, e.g. `mymod:item/ruby`.'), tints: arr(ref('tintSource'), 'Tint sources indexed by `tintindex`.') }, required: ['model'] },
    composite: { properties: { models: arr(ref('itemModel'), 'Models rendered together.') }, required: ['models'] },
    condition: {
      properties: {
        property: typeField(CONDITION_PROPS, 'Boolean property.'), on_true: ref('itemModel'), on_false: ref('itemModel'),
        index: int('custom_model_data flag index.'), component: id('Component type (has_component / component).'), ignore_default: bool('has_component: ignore default components.'),
        keybind: str('Keybind (keybind_down).'), predicate: str('Component predicate type (component).'), value: md('Predicate value (component).', {}),
      },
      required: ['property', 'on_true', 'on_false'],
    },
    select: {
      properties: {
        property: typeField(SELECT_PROPS, 'Property to switch on.'),
        cases: arr(obj({ when: md('Value or list of values.', { type: ['string', 'array', 'object', 'number', 'boolean'] }), model: ref('itemModel') }, { required: ['when', 'model'] }), 'Cases.'),
        fallback: ref('itemModel'),
        block_state_property: str('Block state property (block_state).'), component: id('Component (component).'), index: int('custom_model_data string index.'),
        pattern: str('Date format (local_time).'), locale: str('Locale (local_time).'), time_zone: str('Time zone (local_time).'),
      },
      required: ['property', 'cases'],
    },
    range_dispatch: {
      properties: {
        property: typeField(RANGE_PROPS, 'Numeric property.'),
        entries: arr(obj({ threshold: num('Threshold.'), model: ref('itemModel') }, { required: ['threshold', 'model'] }), 'Entries (highest threshold ≤ value wins).'),
        fallback: ref('itemModel'), scale: num('Value multiplier.'),
        target: str('Compass target (`spawn`, `lodestone`, `recovery`, `none`).'), wobble: bool('Wobble.'), source: str('Time source (`daytime`, `moon_phase`, `random`).'),
        period: num('Use cycle period.'), index: int('custom_model_data float index.'), normalize: bool('Normalize count / damage.'), remaining: bool('Use duration remaining.'),
      },
      required: ['property', 'entries'],
    },
    special: {
      properties: {
        base: id('Model providing particle texture & transforms.'),
        model: md('Special model.', obj({
          type: typeField(SPECIAL_TYPES, 'Special model type.'),
          texture: str('Texture.'), kind: str('Head kind / sign wood.'), color: str('Banner / bed color.'), openness: num('Chest openness.'), wood_type: str('Sign wood type.'), pose: str('Pose.'), animation: num('Head animation.'),
        }, { required: ['type'] })),
      },
      required: ['model', 'base'],
    },
  }),
  defaultSnippets: [
    { label: 'model', body: { type: 'minecraft:model', model: '${1:mymod:item/name}' } },
    { label: 'condition', body: { type: 'minecraft:condition', property: 'minecraft:${1:using_item}', on_true: { type: 'minecraft:model', model: '$2' }, on_false: { type: 'minecraft:model', model: '$3' } } },
  ],
});
const itemDefinition = {
  title: 'Minecraft item model definition (assets/<ns>/items)',
  type: 'object',
  properties: {
    model: itemModel,
    hand_animation_on_swap: bool('Play the swap animation when the item changes (default true).'),
    swap_animation_scale: num('Swap animation speed (1.21.11+).'),
    oversized_in_gui: bool('Allow the model to render outside its GUI slot (1.21.6+).'),
  },
  required: ['model'],
  definitions: { itemModel, tintSource: tint },
  defaultSnippets: [{ body: { model: { type: 'minecraft:model', model: '${1:mymod:item/name}' } } }],
};

// ---------------------------------------------------------------------------------------------------------------
const variant = obj({
  model: id('Model id, e.g. `mymod:block/ruby_block`.'),
  x: md('X rotation.', { enum: [0, 90, 180, 270] }),
  y: md('Y rotation.', { enum: [0, 90, 180, 270] }),
  z: md('Z rotation (26.x).', { enum: [0, 90, 180, 270] }),
  uvlock: bool('Lock texture rotation.'),
  weight: int('Weight when picking a random model.', { minimum: 1 }),
}, { required: ['model'] });
const variantOrList = { anyOf: [variant, { type: 'array', items: variant, minItems: 1 }] };
const whenCond = md('Condition: `{"facing": "north|south"}` or `{"OR": […]}` / `{"AND": […]}`.', {
  type: 'object',
  properties: { OR: arr(ref('when'), 'Any must match.'), AND: arr(ref('when'), 'All must match.') },
  additionalProperties: { type: ['string', 'boolean', 'number'] },
});
const blockstate = {
  title: 'Minecraft blockstate definition',
  type: 'object',
  properties: {
    variants: md('State → model. Key format `prop=value,prop2=value` (`""` = all states).', { type: 'object', additionalProperties: variantOrList }),
    multipart: arr(obj({ when: ref('when'), apply: variantOrList }, { required: ['apply'] }), 'Multipart cases.'),
  },
  oneOf: [{ required: ['variants'] }, { required: ['multipart'] }],
  definitions: { when: whenCond },
  defaultSnippets: [
    { label: 'variants (single)', body: { variants: { '': { model: '${1:mymod:block/name}' } } } },
    { label: 'multipart', body: { multipart: [{ apply: { model: '${1:mymod:block/name}' } }] } },
  ],
};

// ---------------------------------------------------------------------------------------------------------------
const sound = obj({
  name: str('Sound file (`namespace:path` under sounds/, no .ogg) or event id.'),
  volume: num('Volume 0–1.'), pitch: num('Pitch.'), weight: int('Weight.'), stream: bool('Stream (long sounds / music).'),
  attenuation_distance: int('Attenuation distance.'), preload: bool('Preload.'), type: md('`sound` (file) or `event` (another event).', { enum: ['sound', 'event'] }),
}, { required: ['name'] });
const sounds = {
  title: 'Minecraft sounds.json',
  type: 'object',
  additionalProperties: md('Sound event definition.', obj({
    replace: bool('Replace sounds from lower packs.'),
    subtitle: str('Subtitle translation key.'),
    sounds: arr({ anyOf: [{ type: 'string' }, sound] }, 'Sounds (random pick).'),
  }, { defaultSnippets: [{ body: { subtitle: 'subtitles.${1:mymod.event}', sounds: ['${2:mymod:sound}'] } }] })),
};
const lang = { title: 'Minecraft language file', type: 'object', additionalProperties: md('Translation (supports %s / %1$s).', { type: 'string' }) };

const atlasSource = md('Atlas source.', {
  type: 'object',
  properties: { type: typeField(['directory', 'single', 'filter', 'unstitch', 'paletted_permutations'], 'Source type.') },
  required: ['type'],
  allOf: dispatch(['type'], {
    directory: { properties: { source: str('Directory under textures/.'), prefix: str('Sprite prefix.') }, required: ['source', 'prefix'] },
    single: { properties: { resource: id('Texture.'), sprite: id('Sprite id.') }, required: ['resource'] },
    filter: { properties: { pattern: obj({ namespace: str('Namespace regex.'), path: str('Path regex.') }) }, required: ['pattern'] },
    unstitch: { properties: { resource: id('Texture.'), divisor_x: num('X divisor.'), divisor_y: num('Y divisor.'), regions: md('Regions.', { type: 'array' }) }, required: ['resource'] },
    paletted_permutations: { properties: { textures: arr({ type: 'string' }, 'Base textures.'), palette_key: id('Palette key texture.'), permutations: md('Suffix → palette texture.', { type: 'object' }), separator: str('Separator (default `_`).') }, required: ['textures', 'palette_key', 'permutations'] },
  }),
});
const atlas = { title: 'Minecraft atlas', type: 'object', properties: { sources: arr(atlasSource, 'Sources.') }, required: ['sources'] };

const fontProvider = md('Font provider.', {
  type: 'object',
  properties: { type: typeField(['bitmap', 'space', 'ttf', 'unihex', 'reference', 'legacy_unicode'], 'Provider type.'), filter: obj({ uniform: bool('Uniform.'), jp: bool('Japanese variants.') }) },
  required: ['type'],
  allOf: dispatch(['type'], {
    bitmap: { properties: { file: str('Texture (`ns:font/x.png`).'), height: int('Glyph height.'), ascent: int('Ascent.'), chars: arr({ type: 'string' }, 'Rows of characters.') }, required: ['file', 'ascent', 'chars'] },
    space: { properties: { advances: md('Character → advance width.', { type: 'object', additionalProperties: { type: 'number' } }) }, required: ['advances'] },
    ttf: { properties: { file: str('Font file.'), size: num('Size.'), oversample: num('Oversample.'), shift: arr({ type: 'number' }, 'Shift.'), skip: md('Skipped chars.', { type: ['string', 'array'] }) }, required: ['file'] },
    unihex: { properties: { hex_file: str('Zip with .hex files.'), size_overrides: md('Size overrides.', { type: 'array' }) }, required: ['hex_file'] },
    reference: { properties: { id: id('Font id.') }, required: ['id'] },
  }),
});
const font = { title: 'Minecraft font', type: 'object', properties: { providers: arr(fontProvider, 'Providers.') }, required: ['providers'] };

const layer = obj({ texture: id('Texture id (textures/entity/equipment/<layer>/<id>.png).'), dyeable: obj({ color_when_undyed: int('Color when undyed.') }), use_player_texture: bool('Use the player skin / cape.') }, { required: ['texture'] });
const LAYERS = ['humanoid', 'humanoid_legs', 'humanoid_baby', 'wings', 'wolf_body', 'horse_body', 'llama_body', 'happy_ghast_body', 'nautilus_body', 'pig_saddle', 'strider_saddle', 'camel_saddle', 'horse_saddle', 'donkey_saddle', 'mule_saddle', 'skeleton_horse_saddle', 'zombie_horse_saddle', 'nautilus_saddle'];
const equipment = {
  title: 'Minecraft equipment asset',
  type: 'object',
  properties: {
    layers: md('Layer type → layers.', { type: 'object', properties: Object.fromEntries(LAYERS.map((l) => [l, arr(layer, `${l} layers.`)])), additionalProperties: { type: 'array', items: layer } }),
    trim_overrides: md('Trim palette overrides (26.x).', { type: 'array' }),
  },
  required: ['layers'],
  defaultSnippets: [{ body: { layers: { humanoid: [{ texture: '${1:mymod:ruby}' }], humanoid_legs: [{ texture: '${1}' }] } } }],
};
const particle = { title: 'Minecraft particle definition', type: 'object', properties: { textures: arr({ type: 'string', pattern: RL }, 'Sprite ids (textures/particle/).') }, required: ['textures'] };

const textureMeta = {
  title: 'Minecraft texture metadata (.png.mcmeta)',
  type: 'object',
  properties: {
    animation: md('Animated texture (frames stacked vertically).', obj({
      interpolate: bool('Interpolate between frames.'), width: int('Frame width.'), height: int('Frame height.'),
      frametime: int('Ticks per frame (default 1).', { minimum: 1 }),
      frames: arr({ anyOf: [{ type: 'integer', minimum: 0 }, obj({ index: int('Frame index.'), time: int('Ticks.') }, { required: ['index'] })] }, 'Frame order.'),
    }, { defaultSnippets: [{ body: { frametime: '^${1:2}' } }] })),
    villager: obj({ hat: md('Hat type.', { enum: ['none', 'partial', 'full'] }) }),
    gui: obj({ scaling: obj({ type: md('Scaling.', { enum: ['stretch', 'tile', 'nine_slice'] }), width: int('Width.'), height: int('Height.'), border: md('Border: int or `{left, top, right, bottom}`.', { type: ['integer', 'object'] }), stretch_inner: bool('Stretch inner.') }, { required: ['type'] }) }),
    texture: obj({ blur: bool('Blur.'), clamp: bool('Clamp.'), mipmap_strategy: str('Mipmap strategy (1.21.9+).'), alpha_cutoff_bias: num('Alpha cutoff bias.') }),
  },
};

export function buildAssets() {
  return {
    'model.json': blockModel,
    'item_definition.json': itemDefinition,
    'blockstate.json': blockstate,
    'sounds.json': sounds,
    'lang.json': lang,
    'atlas.json': atlas,
    'font.json': font,
    'equipment.json': equipment,
    'particle.json': particle,
    'texture_mcmeta.json': textureMeta,
  };
}
