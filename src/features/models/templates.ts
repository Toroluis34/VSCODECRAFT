// Pure generation logic for item / block assets and data (no 'vscode' import — unit tested).
// Every JSON shape here mirrors what vanilla's data generators write for the target version.
import { atLeast, dataFolder, getFeatures } from '../../core/versions';
import { humanize, parseRL } from '../../core/resourceLocation';
import type { BlockTemplate, GeneratorForm, ItemParent, SetVariant, TextureChoice, ToolKind, ToolTier } from './viewTypes';

export interface GenContext {
  version: string;
  loader: string;
}

// ---------------------------------------------------------------------------
// Small JSON builders
// ---------------------------------------------------------------------------

const mc = (path: string) => `minecraft:${path}`;
const sortObj = <T>(o: Record<string, T>): Record<string, T> => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

/** models/item/<id>.json for a flat item. */
export function itemModel(parent: ItemParent, texture: string, extraLayers: string[] = []): object {
  const textures: Record<string, string> = { layer0: texture };
  extraLayers.forEach((t, i) => (textures[`layer${i + 1}`] = t));
  return { parent: mc(`item/${parent}`), textures };
}

/** models/item/<id>.json that just points at a block model (pre-1.21.4 block items). */
export function blockItemModel(blockModel: string): object {
  return { parent: blockModel };
}

/** items/<id>.json (1.21.4+ item model definition). */
export function itemDefinition(model: string): object {
  return { model: { type: 'minecraft:model', model } };
}

/** Block model for a simple template. `textures` keys are the template's texture variables. */
export function blockModel(parent: string, textures: Record<string, string>, extra: Record<string, unknown> = {}): object {
  return { parent: parent.includes(':') ? parent : mc(parent), ...extra, textures: sortObj(textures) };
}

export const TEMPLATE_SLOTS: Record<BlockTemplate, string[]> = {
  cube_all: ['all'],
  cube_column: ['side', 'end'],
  orientable: ['front', 'side', 'top'],
  cross: ['cross'],
};

/** Default texture id for a texture slot of a new item / block. */
export function slotTextureId(namespace: string, mode: 'item' | 'block', id: string, template: BlockTemplate, slot: string): string {
  if (mode === 'item') return `${namespace}:item/${id}${slot === 'layer0' ? '' : `_${slot}`}`;
  const main = TEMPLATE_SLOTS[template][0];
  if (template === 'cube_column') return `${namespace}:block/${id}${slot === 'end' ? '_top' : ''}`;
  if (template === 'orientable') return `${namespace}:block/${id}_${slot}`;
  return `${namespace}:block/${id}${slot === main ? '' : `_${slot}`}`;
}

// ---------------------------------------------------------------------------
// Blockstates
// ---------------------------------------------------------------------------

type Variant = { model: string; uvlock?: boolean; x?: number; y?: number };
const v = (model: string, x = 0, y = 0, uvlock = false): Variant => {
  const out: Variant = { model };
  if (uvlock) out.uvlock = true;
  x = ((x % 360) + 360) % 360;
  y = ((y % 360) + 360) % 360;
  if (x) out.x = x;
  if (y) out.y = y;
  return out;
};
function variants(entries: [string, Variant][]): object {
  return { variants: Object.fromEntries([...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) };
}

export function simpleBlockstate(model: string): object {
  return { variants: { '': { model } } };
}

/** Logs / pillars: axis=x|y|z (like oak_log). */
export function pillarBlockstate(model: string, horizontal: string): object {
  return variants([
    ['axis=x', v(horizontal, 90, 90)],
    ['axis=y', v(model)],
    ['axis=z', v(horizontal, 90)],
  ]);
}

/** Horizontal facing (like furnace / carved pumpkin): model faces north. */
export function orientableBlockstate(model: string): object {
  const Y: Record<string, number> = { east: 90, north: 0, south: 180, west: 270 };
  return variants(Object.entries(Y).map(([f, y]) => [`facing=${f}`, v(model, 0, y)]));
}

const H_FACINGS = ['east', 'north', 'south', 'west'] as const;
/** y rotation when the model's default orientation faces east (stairs, doors). */
const Y_EAST: Record<string, number> = { east: 0, south: 90, west: 180, north: 270 };
/** y rotation when the model's default orientation faces north (buttons, trapdoors). */
const Y_NORTH: Record<string, number> = { north: 0, east: 90, south: 180, west: 270 };
/** y rotation when the model's default orientation faces south (fence gates, button on ceiling). */
const Y_SOUTH: Record<string, number> = { south: 0, west: 90, north: 180, east: 270 };

export function stairsBlockstate(m: string, inner: string, outer: string): object {
  const out: [string, Variant][] = [];
  for (const facing of H_FACINGS)
    for (const half of ['bottom', 'top'])
      for (const shape of ['inner_left', 'inner_right', 'outer_left', 'outer_right', 'straight']) {
        const model = shape.startsWith('inner') ? inner : shape.startsWith('outer') ? outer : m;
        const base = Y_EAST[facing];
        const left = shape.endsWith('left');
        const right = shape.endsWith('right');
        let x = 0;
        let y = base;
        if (half === 'bottom') {
          if (left) y = base - 90;
        } else {
          x = 180;
          if (right) y = base + 90;
        }
        y = ((y % 360) + 360) % 360;
        out.push([`facing=${facing},half=${half},shape=${shape}`, v(model, x, y, x !== 0 || y !== 0)]);
      }
  return variants(out);
}

export function slabBlockstate(bottom: string, top: string, double: string): object {
  return variants([
    ['type=bottom', v(bottom)],
    ['type=double', v(double)],
    ['type=top', v(top)],
  ]);
}

export function wallBlockstate(post: string, side: string, tall: string): object {
  const dirs: [string, number][] = [['north', 0], ['east', 90], ['south', 180], ['west', 270]];
  return {
    multipart: [
      { apply: { model: post }, when: { up: 'true' } },
      ...dirs.map(([d, y]) => ({ apply: v(side, 0, y, true), when: { [d]: 'low' } })),
      ...dirs.map(([d, y]) => ({ apply: v(tall, 0, y, true), when: { [d]: 'tall' } })),
    ],
  };
}

export function fenceBlockstate(post: string, side: string): object {
  const dirs: [string, number][] = [['north', 0], ['east', 90], ['south', 180], ['west', 270]];
  return {
    multipart: [{ apply: { model: post } }, ...dirs.map(([d, y]) => ({ apply: v(side, 0, y, true), when: { [d]: 'true' } }))],
  };
}

export function fenceGateBlockstate(gate: string, open: string, wall: string, wallOpen: string): object {
  const out: [string, Variant][] = [];
  for (const facing of H_FACINGS)
    for (const inWall of ['false', 'true'])
      for (const o of ['false', 'true']) {
        const model = inWall === 'true' ? (o === 'true' ? wallOpen : wall) : o === 'true' ? open : gate;
        out.push([`facing=${facing},in_wall=${inWall},open=${o}`, v(model, 0, Y_SOUTH[facing], true)]);
      }
  return variants(out);
}

export function buttonBlockstate(button: string, pressed: string): object {
  const out: [string, Variant][] = [];
  for (const face of ['ceiling', 'floor', 'wall'])
    for (const facing of H_FACINGS)
      for (const powered of ['false', 'true']) {
        const model = powered === 'true' ? pressed : button;
        let entry: Variant;
        if (face === 'floor') entry = v(model, 0, Y_NORTH[facing]);
        else if (face === 'wall') entry = v(model, 90, Y_NORTH[facing], true);
        else entry = v(model, 180, Y_SOUTH[facing]);
        out.push([`face=${face},facing=${facing},powered=${powered}`, entry]);
      }
  return variants(out);
}

export function pressurePlateBlockstate(up: string, down: string): object {
  return variants([
    ['powered=false', v(up)],
    ['powered=true', v(down)],
  ]);
}

/** models: [bottom_left, bottom_left_open, bottom_right, bottom_right_open, top_left, top_left_open, top_right, top_right_open] */
export function doorBlockstate(prefix: string): object {
  const out: [string, Variant][] = [];
  for (const facing of H_FACINGS)
    for (const half of ['lower', 'upper'])
      for (const hinge of ['left', 'right'])
        for (const open of ['false', 'true']) {
          const model = `${prefix}_${half === 'lower' ? 'bottom' : 'top'}_${hinge}${open === 'true' ? '_open' : ''}`;
          const base = Y_EAST[facing];
          const y = open === 'true' ? base + (hinge === 'left' ? 90 : 270) : base;
          out.push([`facing=${facing},half=${half},hinge=${hinge},open=${open}`, v(model, 0, y)]);
        }
  return variants(out);
}

export function trapdoorBlockstate(bottom: string, top: string, open: string): object {
  const out: [string, Variant][] = [];
  for (const facing of H_FACINGS)
    for (const half of ['bottom', 'top'])
      for (const o of ['false', 'true']) {
        const model = o === 'true' ? open : half === 'top' ? top : bottom;
        out.push([`facing=${facing},half=${half},open=${o}`, o === 'true' ? v(model, 0, Y_NORTH[facing]) : v(model)]);
      }
  return variants(out);
}

export function paneBlockstate(prefix: string): object {
  return {
    multipart: [
      { apply: { model: `${prefix}_post` } },
      { apply: { model: `${prefix}_side` }, when: { north: 'true' } },
      { apply: { model: `${prefix}_side`, y: 90 }, when: { east: 'true' } },
      { apply: { model: `${prefix}_side_alt` }, when: { south: 'true' } },
      { apply: { model: `${prefix}_side_alt`, y: 90 }, when: { west: 'true' } },
      { apply: { model: `${prefix}_noside` }, when: { north: 'false' } },
      { apply: { model: `${prefix}_noside_alt` }, when: { east: 'false' } },
      { apply: { model: `${prefix}_noside_alt`, y: 90 }, when: { south: 'false' } },
      { apply: { model: `${prefix}_noside`, y: 270 }, when: { west: 'false' } },
    ],
  };
}

// ---------------------------------------------------------------------------
// Block sets (stairs / slab / wall / ...)
// ---------------------------------------------------------------------------

export const SET_VARIANTS: SetVariant[] = ['stairs', 'slab', 'wall', 'fence', 'fence_gate', 'button', 'pressure_plate', 'door', 'trapdoor', 'pane'];

/** "ruby_bricks" -> "ruby_brick", "oak_planks" -> "oak", "ruby_tiles" -> "ruby_tile". */
export function setBaseName(blockId: string): string {
  const p = blockId.split('/').pop() ?? blockId;
  if (p.endsWith('_planks')) return p.slice(0, -7);
  if (p.endsWith('_block') && p.length > 6) return p.slice(0, -6);
  if (p.endsWith('bricks')) return p.slice(0, -1);
  if (p.endsWith('tiles')) return p.slice(0, -1);
  return p;
}

export function variantId(base: string, variant: SetVariant): string {
  return `${base}_${variant}`;
}

const VARIANT_EN: Record<SetVariant, string> = {
  stairs: 'Stairs',
  slab: 'Slab',
  wall: 'Wall',
  fence: 'Fence',
  fence_gate: 'Fence Gate',
  button: 'Button',
  pressure_plate: 'Pressure Plate',
  door: 'Door',
  trapdoor: 'Trapdoor',
  pane: 'Pane',
};
const VARIANT_ES: Record<SetVariant, string> = {
  stairs: 'Escaleras de',
  slab: 'Losa de',
  wall: 'Muro de',
  fence: 'Valla de',
  fence_gate: 'Puerta de valla de',
  button: 'Botón de',
  pressure_plate: 'Placa de presión de',
  door: 'Puerta de',
  trapdoor: 'Trampilla de',
  pane: 'Panel de',
};

/** "Ruby Bricks" -> "Ruby Brick Stairs" */
export function variantNameEn(baseName: string, variant: SetVariant): string {
  const b = baseName.replace(/ Planks$/, '').replace(/ Block$/, '').replace(/Bricks$/, 'Brick').replace(/Tiles$/, 'Tile');
  return `${b} ${VARIANT_EN[variant]}`;
}

/** "Ladrillos de rubí" -> "Escaleras de ladrillos de rubí" */
export function variantNameEs(baseName: string, variant: SetVariant): string {
  const b = baseName.replace(/^Bloque de /, '').replace(/^Tablones de /, '');
  return `${VARIANT_ES[variant]} ${b.charAt(0).toLowerCase()}${b.slice(1)}`;
}

/** Vanilla block family tags (block and item tag with the same name — pressure_plates is block-only). */
export const VARIANT_TAG: Record<SetVariant, { block?: string; item?: string }> = {
  stairs: { block: 'stairs', item: 'stairs' },
  slab: { block: 'slabs', item: 'slabs' },
  wall: { block: 'walls', item: 'walls' },
  fence: { block: 'fences', item: 'fences' },
  fence_gate: { block: 'fence_gates', item: 'fence_gates' },
  button: { block: 'buttons', item: 'buttons' },
  pressure_plate: { block: 'pressure_plates' },
  door: { block: 'doors', item: 'doors' },
  trapdoor: { block: 'trapdoors', item: 'trapdoors' },
  pane: {},
};

export interface SetTextures {
  /** Main texture (all faces). */
  texture: string;
  doorTop?: string;
  doorBottom?: string;
  doorItem?: string;
  trapdoor?: string;
  paneEdge?: string;
}

export interface VariantAssets {
  id: string;
  /** model path (ns:block/...) -> json */
  models: Record<string, object>;
  blockstate: object;
  /** Model the item uses (block model, or ns:item/<id> for generated items). */
  itemModel: string;
  /** Flat item model (models/item/<id>.json) when the item is not a block model. */
  flatItemModel?: object;
}

/** Models + blockstate of one block-set variant, following vanilla model parents exactly. */
export function variantAssets(namespace: string, base: string, variant: SetVariant, tex: SetTextures, fullBlockModel: string): VariantAssets {
  const id = variantId(base, variant);
  const b = (suffix = '') => `${namespace}:block/${id}${suffix}`;
  const t = tex.texture;
  const models: Record<string, object> = {};
  const add = (suffix: string, parent: string, textures: Record<string, string>) => (models[b(suffix)] = blockModel(parent, textures));
  switch (variant) {
    case 'stairs': {
      const tx = { bottom: t, side: t, top: t };
      add('', 'block/stairs', tx);
      add('_inner', 'block/inner_stairs', tx);
      add('_outer', 'block/outer_stairs', tx);
      return { id, models, blockstate: stairsBlockstate(b(), b('_inner'), b('_outer')), itemModel: b() };
    }
    case 'slab': {
      const tx = { bottom: t, side: t, top: t };
      add('', 'block/slab', tx);
      add('_top', 'block/slab_top', tx);
      return { id, models, blockstate: slabBlockstate(b(), b('_top'), fullBlockModel), itemModel: b() };
    }
    case 'wall':
      add('_inventory', 'block/wall_inventory', { wall: t });
      add('_post', 'block/template_wall_post', { wall: t });
      add('_side', 'block/template_wall_side', { wall: t });
      add('_side_tall', 'block/template_wall_side_tall', { wall: t });
      return { id, models, blockstate: wallBlockstate(b('_post'), b('_side'), b('_side_tall')), itemModel: b('_inventory') };
    case 'fence':
      add('_inventory', 'block/fence_inventory', { texture: t });
      add('_post', 'block/fence_post', { texture: t });
      add('_side', 'block/fence_side', { texture: t });
      return { id, models, blockstate: fenceBlockstate(b('_post'), b('_side')), itemModel: b('_inventory') };
    case 'fence_gate':
      add('', 'block/template_fence_gate', { texture: t });
      add('_open', 'block/template_fence_gate_open', { texture: t });
      add('_wall', 'block/template_fence_gate_wall', { texture: t });
      add('_wall_open', 'block/template_fence_gate_wall_open', { texture: t });
      return { id, models, blockstate: fenceGateBlockstate(b(), b('_open'), b('_wall'), b('_wall_open')), itemModel: b() };
    case 'button':
      add('', 'block/button', { texture: t });
      add('_inventory', 'block/button_inventory', { texture: t });
      add('_pressed', 'block/button_pressed', { texture: t });
      return { id, models, blockstate: buttonBlockstate(b(), b('_pressed')), itemModel: b('_inventory') };
    case 'pressure_plate':
      add('', 'block/pressure_plate_up', { texture: t });
      add('_down', 'block/pressure_plate_down', { texture: t });
      return { id, models, blockstate: pressurePlateBlockstate(b(), b('_down')), itemModel: b() };
    case 'door': {
      const tx = { bottom: tex.doorBottom ?? t, top: tex.doorTop ?? t };
      for (const half of ['bottom', 'top'])
        for (const hinge of ['left', 'right'])
          for (const open of ['', '_open']) add(`_${half}_${hinge}${open}`, `block/door_${half}_${hinge}${open}`, tx);
      const itemModelId = `${namespace}:item/${id}`;
      return { id, models, blockstate: doorBlockstate(b()), itemModel: itemModelId, flatItemModel: itemModel('generated', tex.doorItem ?? tex.doorBottom ?? t) };
    }
    case 'trapdoor': {
      const tt = tex.trapdoor ?? t;
      add('_bottom', 'block/template_trapdoor_bottom', { texture: tt });
      add('_open', 'block/template_trapdoor_open', { texture: tt });
      add('_top', 'block/template_trapdoor_top', { texture: tt });
      return { id, models, blockstate: trapdoorBlockstate(b('_bottom'), b('_top'), b('_open')), itemModel: b('_bottom') };
    }
    case 'pane': {
      const tx = { edge: tex.paneEdge ?? t, pane: t };
      add('_noside', 'block/template_glass_pane_noside', { pane: t });
      add('_noside_alt', 'block/template_glass_pane_noside_alt', { pane: t });
      add('_post', 'block/template_glass_pane_post', tx);
      add('_side', 'block/template_glass_pane_side', tx);
      add('_side_alt', 'block/template_glass_pane_side_alt', tx);
      return { id, models, blockstate: paneBlockstate(b()), itemModel: `${namespace}:item/${id}`, flatItemModel: itemModel('generated', t) };
    }
  }
}

/** Vanilla block whose blockstate each variant mirrors (used to double-check generated blockstates). */
export const VANILLA_COUNTERPART: Record<SetVariant, { block: string; prefix: string; full?: string }> = {
  stairs: { block: 'oak_stairs', prefix: 'minecraft:block/oak_stairs' },
  slab: { block: 'oak_slab', prefix: 'minecraft:block/oak_slab', full: 'minecraft:block/oak_planks' },
  wall: { block: 'cobblestone_wall', prefix: 'minecraft:block/cobblestone_wall' },
  fence: { block: 'oak_fence', prefix: 'minecraft:block/oak_fence' },
  fence_gate: { block: 'oak_fence_gate', prefix: 'minecraft:block/oak_fence_gate' },
  button: { block: 'oak_button', prefix: 'minecraft:block/oak_button' },
  pressure_plate: { block: 'oak_pressure_plate', prefix: 'minecraft:block/oak_pressure_plate' },
  door: { block: 'oak_door', prefix: 'minecraft:block/oak_door' },
  trapdoor: { block: 'oak_trapdoor', prefix: 'minecraft:block/oak_trapdoor' },
  pane: { block: 'glass_pane', prefix: 'minecraft:block/glass_pane' },
};

/** Rename "model" references of a vanilla blockstate (prefix match on whole name segments). */
export function renameBlockstateModels(json: unknown, renames: [string, string][]): unknown {
  const fix = (m: string) => {
    for (const [from, to] of renames) if (m === from || m.startsWith(`${from}_`)) return to + m.slice(from.length);
    return m;
  };
  const walk = (x: any): any => {
    if (Array.isArray(x)) return x.map(walk);
    if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).map(([k, val]) => [k, k === 'model' && typeof val === 'string' ? fix(val) : walk(val)]));
    return x;
  };
  return walk(json);
}

/** The vanilla blockstate of a variant's counterpart, renamed to our models. */
export function vanillaDerivedBlockstate(vanillaJson: unknown, variant: SetVariant, namespace: string, id: string, fullBlockModel: string): unknown {
  const c = VANILLA_COUNTERPART[variant];
  const renames: [string, string][] = [[c.prefix, `${namespace}:block/${id}`]];
  if (c.full) renames.push([c.full, fullBlockModel]);
  return renameBlockstateModels(vanillaJson, renames);
}

export function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(canon(a)) === JSON.stringify(canon(b));
}
function canon(x: any): any {
  if (Array.isArray(x)) return x.map(canon);
  if (x && typeof x === 'object') return Object.fromEntries(Object.keys(x).sort().map((k) => [k, canon(x[k])]));
  return x;
}

// ---------------------------------------------------------------------------
// Data: loot tables, tags, recipes, lang
// ---------------------------------------------------------------------------

/**
 * Loot table formats:
 *  - 'legacy' (≤ 26.1): "conditions"/"functions" arrays, rolls 1.0, bonus_rolls 0.0
 *  - 'legacy-nobonus' (26.2): same without the default bonus_rolls
 *  - 'modern' (26.3+): "condition"/"modifier" objects with "type", match_block, integer rolls
 */
export function lootStyle(version: string): 'legacy' | 'legacy-nobonus' | 'modern' {
  if (atLeast(version, '26.3')) return 'modern';
  if (atLeast(version, '26.2')) return 'legacy-nobonus';
  return 'legacy';
}

export type DropKind = 'self' | 'slab' | 'door';

export function blockLootTable(blockId: string, version: string, kind: DropKind = 'self'): object {
  const style = lootStyle(version);
  const rs = parseRL(blockId);
  const random_sequence = `${rs.namespace}:blocks/${rs.path}`;
  if (style === 'modern') {
    const entry: any = { type: 'minecraft:item' };
    if (kind === 'door') entry.condition = { type: 'minecraft:match_block', blocks: blockId, state: { half: 'lower' } };
    if (kind === 'slab')
      entry.modifier = [
        { type: 'minecraft:set_count', condition: { type: 'minecraft:match_block', blocks: blockId, state: { type: 'double' } }, count: 2 },
        { type: 'minecraft:explosion_decay' },
      ];
    entry.name = blockId;
    const pool: any = {};
    if (kind !== 'slab') pool.condition = { type: 'minecraft:survives_explosion' };
    pool.entries = [entry];
    pool.rolls = 1;
    return { type: 'minecraft:block', pools: [pool], random_sequence };
  }
  const entry: any = { type: 'minecraft:item' };
  if (kind === 'door') entry.conditions = [{ block: blockId, condition: 'minecraft:block_state_property', properties: { half: 'lower' } }];
  if (kind === 'slab') {
    const setCount: any = style === 'legacy' ? { add: false } : {};
    Object.assign(setCount, {
      conditions: [{ block: blockId, condition: 'minecraft:block_state_property', properties: { type: 'double' } }],
      count: 2.0,
      function: 'minecraft:set_count',
    });
    entry.functions = [setCount, { function: 'minecraft:explosion_decay' }];
  }
  entry.name = blockId;
  const pool: any = {};
  if (style === 'legacy') pool.bonus_rolls = 0.0;
  if (kind !== 'slab') pool.conditions = [{ condition: 'minecraft:survives_explosion' }];
  pool.entries = [entry];
  pool.rolls = 1.0;
  return { type: 'minecraft:block', pools: [pool], random_sequence };
}

/** Serialize JSON keeping Minecraft-style floats ("rolls": 1.0) for legacy loot tables. */
export function stringifyMcJson(value: unknown, indent: number | string = 2, floatKeys: string[] = []): string {
  let s = JSON.stringify(value, null, indent);
  if (floatKeys.length) {
    const re = new RegExp(`("(?:${floatKeys.join('|')})": )(-?\\d+)(,?\\n)`, 'g');
    s = s.replace(re, '$1$2.0$3');
  }
  return s + '\n';
}

export const LOOT_FLOAT_KEYS = ['rolls', 'bonus_rolls', 'count'];

/** Tag file path parts for a tool / tier choice. */
export function toolTags(tool: ToolKind, tier: ToolTier): string[] {
  const out: string[] = [];
  if (tool !== 'none') out.push(`minecraft:mineable/${tool}`);
  if (tier !== 'none') out.push(`minecraft:needs_${tier}_tool`);
  return out;
}

/** Append values to a tag json (keeps existing values / "replace"). */
export function appendTag(existing: unknown, values: string[]): { json: any; added: string[] } {
  const json: any = existing && typeof existing === 'object' && !Array.isArray(existing) ? { ...(existing as any) } : {};
  const list: any[] = Array.isArray(json.values) ? [...json.values] : [];
  const present = new Set(list.map((x) => (typeof x === 'string' ? x : x?.id)));
  const added: string[] = [];
  for (const val of values) {
    if (present.has(val)) continue;
    list.push(val);
    present.add(val);
    added.push(val);
  }
  if (!('replace' in json) && existing === undefined) return { json: { values: list }, added };
  json.values = list;
  return { json, added };
}

/**
 * Merge lang entries into a lang file text. Existing keys are never overwritten; new keys are inserted
 * before the first existing key that sorts after them (keeps sorted files sorted, otherwise appends).
 */
export function mergeLang(existingText: string | undefined, entries: Record<string, string>, indent: number | string = 2): { text: string; added: string[]; skipped: string[] } {
  let obj: Record<string, string> = {};
  if (existingText && existingText.trim()) {
    try {
      obj = JSON.parse(existingText);
    } catch {
      obj = {};
    }
  }
  const keys = Object.keys(obj);
  const added: string[] = [];
  const skipped: string[] = [];
  const sorted = keys.every((k, i) => i === 0 || keys[i - 1] <= k);
  for (const [k, val] of Object.entries(entries).sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (k in obj) {
      skipped.push(k);
      continue;
    }
    added.push(k);
    const pos = sorted ? keys.findIndex((e) => e > k) : -1;
    if (pos < 0) keys.push(k);
    else keys.splice(pos, 0, k);
    obj[k] = val;
  }
  const out: Record<string, string> = {};
  for (const k of keys) out[k] = obj[k];
  return { text: JSON.stringify(out, null, indent) + '\n', added, skipped };
}

/** Ingredient in the version's format: {"item": id} (1.21–1.21.1) or "id" (1.21.2+). Tags start with '#'. */
export function ingredient(id: string, version: string): unknown {
  if (getFeatures(version).ingredientFormat === 'string') return id;
  return id.startsWith('#') ? { tag: id.slice(1) } : { item: id };
}

function recipeResult(id: string, count: number, version: string): object {
  // 26.1+ data generators omit "count": 1
  return count === 1 && atLeast(version, '26.1') ? { id } : { count, id };
}

export function shapedRecipe(version: string, category: string, pattern: string[], key: Record<string, string>, result: string, count = 1, group?: string): object {
  const out: any = { type: 'minecraft:crafting_shaped', category };
  if (group) out.group = group;
  out.key = Object.fromEntries(Object.entries(key).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, id]) => [k, ingredient(id, version)]));
  out.pattern = pattern;
  out.result = recipeResult(result, count, version);
  return out;
}

export function shapelessRecipe(version: string, category: string, ingredients: string[], result: string, count = 1, group?: string): object {
  const out: any = { type: 'minecraft:crafting_shapeless', category };
  if (group) out.group = group;
  out.ingredients = ingredients.map((i) => ingredient(i, version));
  out.result = recipeResult(result, count, version);
  return out;
}

/** Vanilla-style recipe for a block set variant made from its base block. */
export function variantRecipe(variant: SetVariant, baseItem: string, result: string, version: string): object {
  switch (variant) {
    case 'stairs':
      return shapedRecipe(version, 'building', ['#  ', '## ', '###'], { '#': baseItem }, result, 4);
    case 'slab':
      return shapedRecipe(version, 'building', ['###'], { '#': baseItem }, result, 6);
    case 'wall':
      return shapedRecipe(version, 'misc', ['###', '###'], { '#': baseItem }, result, 6);
    case 'fence':
      return shapedRecipe(version, 'misc', ['W#W', 'W#W'], { '#': 'minecraft:stick', W: baseItem }, result, 3);
    case 'fence_gate':
      return shapedRecipe(version, 'redstone', ['#W#', '#W#'], { '#': 'minecraft:stick', W: baseItem }, result, 1);
    case 'button':
      return shapelessRecipe(version, 'redstone', [baseItem], result, 1);
    case 'pressure_plate':
      return shapedRecipe(version, 'redstone', ['##'], { '#': baseItem }, result, 1);
    case 'door':
      return shapedRecipe(version, 'redstone', ['##', '##', '##'], { '#': baseItem }, result, 3);
    case 'trapdoor':
      return shapedRecipe(version, 'redstone', ['###', '###'], { '#': baseItem }, result, 2);
    case 'pane':
      return shapedRecipe(version, 'decorations', ['###', '###'], { '#': baseItem }, result, 16);
  }
}

// ---------------------------------------------------------------------------
// Planning: list of files to write for a generator form
// ---------------------------------------------------------------------------

export interface PlannedFile {
  /** Path relative to the resource root (forward slashes). */
  path: string;
  type: 'json' | 'texture' | 'lang' | 'tag';
  /** JSON content (type json) — written only when the file does not exist. */
  json?: unknown;
  /** Float keys for legacy loot tables. */
  floatKeys?: string[];
  /** Lang entries (type lang) — merged. */
  entries?: Record<string, string>;
  /** Tag values (type tag) — appended. */
  values?: string[];
  /** Texture to write (type texture). */
  texture?: { slot: string; id: string; choice: TextureChoice; kind: 'item' | 'block' };
}

export interface Plan {
  files: PlannedFile[];
  /** Ids of every item/block created. */
  ids: string[];
  /** Slot -> texture id. */
  textures: Record<string, string>;
  /** The main item's model (for previews). */
  previewModel: string;
  /** In-memory models (id -> json) for previews. */
  models: Record<string, object>;
  /** Registration entries for the Java snippet. */
  registrations: Registration[];
}

export interface Registration {
  id: string;
  kind: 'item' | 'block';
  variant?: SetVariant | BlockTemplate;
}

const modelPath = (modelId: string) => {
  const rl = parseRL(modelId);
  return `assets/${rl.namespace}/models/${rl.path}.json`;
};
const texturePath = (texId: string) => {
  const rl = parseRL(texId);
  return `assets/${rl.namespace}/textures/${rl.path}.png`;
};

export function validateForm(form: GeneratorForm): string[] {
  const errors: string[] = [];
  if (!/^[a-z0-9_.-]+$/.test(form.namespace)) errors.push('Invalid namespace');
  if (!form.id) errors.push('The id is required');
  else if (!/^[a-z0-9_./-]+$/.test(form.id)) errors.push('Invalid id: use lowercase letters, digits and _');
  return errors;
}

export function planForm(form: GeneratorForm, ctx: GenContext): Plan {
  const f = getFeatures(ctx.version);
  const ns = form.namespace;
  const id = form.id;
  const full = `${ns}:${id}`;
  const files: PlannedFile[] = [];
  const models: Record<string, object> = {};
  const textures: Record<string, string> = {};
  const lang: Record<string, string> = {};
  const langEs: Record<string, string> = {};
  const tagValues = new Map<string, string[]>();
  const addTag = (side: 'block' | 'item', tag: string, value: string) => {
    const rl = parseRL(tag);
    const path = `data/${rl.namespace}/${dataFolder(`tags/${side}`, ctx.version)}/${rl.path}.json`;
    const list = tagValues.get(path) ?? [];
    list.push(value);
    tagValues.set(path, list);
  };
  const addModel = (mid: string, json: object) => {
    models[mid] = json;
    files.push({ path: modelPath(mid), type: 'json', json });
  };
  const registrations: Registration[] = [];
  const ids: string[] = [];

  // Textures
  const slots = form.mode === 'item' ? ['layer0'] : TEMPLATE_SLOTS[form.template];
  for (const slot of slots) {
    const choice = form.textures[slot] ?? { source: 'placeholder' };
    if (choice.source === 'existing' && choice.id) {
      textures[slot] = choice.id.includes(':') ? choice.id : `minecraft:${choice.id}`;
    } else {
      textures[slot] = slotTextureId(ns, form.mode, id, form.template, slot);
      files.push({ path: texturePath(textures[slot]), type: 'texture', texture: { slot, id: textures[slot], choice, kind: form.mode } });
    }
  }

  let previewModel: string;
  if (form.mode === 'item') {
    const mid = `${ns}:item/${id}`;
    addModel(mid, itemModel(form.itemParent, textures.layer0));
    if (form.itemDefinition && f.hasItemDefinitions) files.push({ path: `assets/${ns}/items/${id}.json`, type: 'json', json: itemDefinition(mid) });
    previewModel = mid;
    lang[`item.${ns}.${id}`] = form.nameEn || humanize(id);
    if (form.nameEs) langEs[`item.${ns}.${id}`] = form.nameEs;
    if (form.recipe && form.recipeIngredient) {
      files.push({ path: `data/${ns}/${dataFolder('recipe', ctx.version)}/${id}.json`, type: 'json', json: shapelessRecipe(ctx.version, 'misc', [form.recipeIngredient], full, 1) });
    }
    ids.push(full);
    registrations.push({ id: full, kind: 'item' });
  } else {
    // Base block
    const bm = `${ns}:block/${id}`;
    let blockstate: object;
    switch (form.template) {
      case 'cube_all':
        addModel(bm, blockModel('block/cube_all', { all: textures.all }));
        blockstate = simpleBlockstate(bm);
        break;
      case 'cube_column':
        addModel(bm, blockModel('block/cube_column', { end: textures.end, side: textures.side }));
        addModel(`${bm}_horizontal`, blockModel('block/cube_column_horizontal', { end: textures.end, side: textures.side }));
        blockstate = pillarBlockstate(bm, `${bm}_horizontal`);
        break;
      case 'orientable':
        addModel(bm, blockModel('block/orientable', { front: textures.front, side: textures.side, top: textures.top }));
        blockstate = orientableBlockstate(bm);
        break;
      case 'cross': {
        const extra: Record<string, unknown> = ctx.loader === 'neoforge' || ctx.loader === 'forge' ? { render_type: 'minecraft:cutout' } : {};
        addModel(bm, blockModel('block/cross', { cross: textures.cross }, extra));
        blockstate = simpleBlockstate(bm);
        break;
      }
    }
    if (form.blockstate) files.push({ path: `assets/${ns}/blockstates/${id}.json`, type: 'json', json: blockstate });
    previewModel = bm;
    if (form.blockItem) {
      if (form.template === 'cross') {
        const im = `${ns}:item/${id}`;
        addModel(im, itemModel('generated', textures.cross));
        if (f.hasItemDefinitions) files.push({ path: `assets/${ns}/items/${id}.json`, type: 'json', json: itemDefinition(im) });
        previewModel = im;
      } else if (f.hasItemDefinitions) {
        files.push({ path: `assets/${ns}/items/${id}.json`, type: 'json', json: itemDefinition(bm) });
      } else {
        addModel(`${ns}:item/${id}`, blockItemModel(bm));
      }
    }
    lang[`block.${ns}.${id}`] = form.nameEn || humanize(id);
    if (form.nameEs) langEs[`block.${ns}.${id}`] = form.nameEs;
    if (form.loot) pushLoot(files, full, ctx.version, 'self');
    for (const tag of toolTags(form.tool, form.tier)) addTag('block', tag, full);
    if (form.recipe && form.recipeIngredient) {
      files.push({
        path: `data/${ns}/${dataFolder('recipe', ctx.version)}/${id}.json`,
        type: 'json',
        json: shapedRecipe(ctx.version, 'building', ['###', '###', '###'], { '#': form.recipeIngredient }, full, 1),
      });
    }
    ids.push(full);
    registrations.push({ id: full, kind: 'block', variant: form.template });

    // Variants (stairs, slab...) share the main texture
    const base = setBaseName(id);
    const mainTex = textures[TEMPLATE_SLOTS[form.template][0]];
    for (const variant of form.mode === 'block' && form.template !== 'cross' ? form.variants : []) {
      const a = variantAssets(ns, base, variant, { texture: mainTex }, bm);
      const vid = `${ns}:${a.id}`;
      for (const [mid, json] of Object.entries(a.models)) addModel(mid, json);
      if (form.blockstate) files.push({ path: `assets/${ns}/blockstates/${a.id}.json`, type: 'json', json: a.blockstate });
      if (form.blockItem) pushVariantItem(files, addModel, ns, a, f.hasItemDefinitions);
      lang[`block.${ns}.${a.id}`] = variantNameEn(form.nameEn || humanize(id), variant);
      if (form.nameEs) langEs[`block.${ns}.${a.id}`] = variantNameEs(form.nameEs, variant);
      if (form.loot) pushLoot(files, vid, ctx.version, variant === 'slab' ? 'slab' : variant === 'door' ? 'door' : 'self');
      for (const tag of toolTags(form.tool, form.tier)) addTag('block', tag, vid);
      const vt = VARIANT_TAG[variant];
      if (vt.block) addTag('block', `minecraft:${vt.block}`, vid);
      if (vt.item) addTag('item', `minecraft:${vt.item}`, vid);
      if (form.recipe) files.push({ path: `data/${ns}/${dataFolder('recipe', ctx.version)}/${a.id}.json`, type: 'json', json: variantRecipe(variant, full, vid, ctx.version) });
      ids.push(vid);
      registrations.push({ id: vid, kind: 'block', variant });
    }
  }

  for (const [path, values] of tagValues) files.push({ path, type: 'tag', values });
  if (form.lang) {
    files.push({ path: `assets/${ns}/lang/en_us.json`, type: 'lang', entries: lang });
    if (Object.keys(langEs).length) files.push({ path: `assets/${ns}/lang/es_es.json`, type: 'lang', entries: langEs });
  }
  return { files, ids, textures, previewModel, models, registrations };
}

function pushLoot(files: PlannedFile[], blockId: string, version: string, kind: DropKind): void {
  const rl = parseRL(blockId);
  const legacy = lootStyle(version) !== 'modern';
  files.push({
    path: `data/${rl.namespace}/${dataFolder('loot_table', version)}/blocks/${rl.path}.json`,
    type: 'json',
    json: blockLootTable(blockId, version, kind),
    floatKeys: legacy ? LOOT_FLOAT_KEYS : undefined,
  });
}

function pushVariantItem(files: PlannedFile[], addModel: (id: string, json: object) => void, ns: string, a: VariantAssets, defs: boolean): void {
  if (a.flatItemModel) addModel(`${ns}:item/${a.id}`, a.flatItemModel);
  if (defs) files.push({ path: `assets/${ns}/items/${a.id}.json`, type: 'json', json: itemDefinition(a.itemModel) });
  else if (!a.flatItemModel) addModel(`${ns}:item/${a.id}`, blockItemModel(a.itemModel));
}

export interface BlockSetOptions {
  namespace: string;
  base: string;
  /** Model used for the double slab (usually the full block's model). */
  fullBlockModel: string;
  textures: SetTextures;
  variants: SetVariant[];
  items: boolean;
  loot: boolean;
  tags: boolean;
  recipes: boolean;
  /** Item the recipes are crafted from (the full block). */
  baseItem?: string;
  lang?: { en: string; es?: string };
}

/** Files for the "Generate Block Model Set" command. */
export function planBlockSet(o: BlockSetOptions, ctx: GenContext): { files: PlannedFile[]; assets: VariantAssets[] } {
  const f = getFeatures(ctx.version);
  const files: PlannedFile[] = [];
  const assets: VariantAssets[] = [];
  const tagValues = new Map<string, string[]>();
  const lang: Record<string, string> = {};
  const langEs: Record<string, string> = {};
  const addModel = (mid: string, json: object) => files.push({ path: modelPath(mid), type: 'json', json });
  for (const variant of o.variants) {
    const a = variantAssets(o.namespace, o.base, variant, o.textures, o.fullBlockModel);
    assets.push(a);
    const vid = `${o.namespace}:${a.id}`;
    for (const [mid, json] of Object.entries(a.models)) addModel(mid, json);
    files.push({ path: `assets/${o.namespace}/blockstates/${a.id}.json`, type: 'json', json: a.blockstate });
    if (o.items) pushVariantItem(files, addModel, o.namespace, a, f.hasItemDefinitions);
    if (o.loot) pushLoot(files, vid, ctx.version, variant === 'slab' ? 'slab' : variant === 'door' ? 'door' : 'self');
    if (o.tags) {
      const vt = VARIANT_TAG[variant];
      for (const [side, tag] of [['block', vt.block], ['item', vt.item]] as const) {
        if (!tag) continue;
        const path = `data/minecraft/${dataFolder(`tags/${side}`, ctx.version)}/${tag}.json`;
        tagValues.set(path, [...(tagValues.get(path) ?? []), vid]);
      }
    }
    if (o.recipes && o.baseItem) files.push({ path: `data/${o.namespace}/${dataFolder('recipe', ctx.version)}/${a.id}.json`, type: 'json', json: variantRecipe(variant, o.baseItem, vid, ctx.version) });
    if (o.lang) {
      lang[`block.${o.namespace}.${a.id}`] = variantNameEn(o.lang.en, variant);
      if (o.lang.es) langEs[`block.${o.namespace}.${a.id}`] = variantNameEs(o.lang.es, variant);
    }
  }
  for (const [path, values] of tagValues) files.push({ path, type: 'tag', values });
  if (Object.keys(lang).length) files.push({ path: `assets/${o.namespace}/lang/en_us.json`, type: 'lang', entries: lang });
  if (Object.keys(langEs).length) files.push({ path: `assets/${o.namespace}/lang/es_es.json`, type: 'lang', entries: langEs });
  return { files, assets };
}

// ---------------------------------------------------------------------------
// Item model definition migration (1.21.4+)
// ---------------------------------------------------------------------------

/**
 * Convert a legacy item model (with optional "overrides") into an items/*.json definition.
 * custom_model_data overrides become a range_dispatch; other predicates are reported as unsupported.
 */
export function migrateItemModel(modelId: string, model: any): { json: object; warnings: string[] } {
  const base = { type: 'minecraft:model', model: modelId };
  const overrides: any[] = Array.isArray(model?.overrides) ? model.overrides : [];
  if (!overrides.length) return { json: { model: base }, warnings: [] };
  const warnings: string[] = [];
  const cmd = overrides.filter((o) => o?.predicate && Object.keys(o.predicate).length === 1 && 'custom_model_data' in o.predicate);
  const others = overrides.length - cmd.length;
  if (others) warnings.push(`${others} override(s) with predicates other than custom_model_data were not converted`);
  if (!cmd.length) return { json: { model: base }, warnings };
  return {
    json: {
      model: {
        type: 'minecraft:range_dispatch',
        property: 'minecraft:custom_model_data',
        entries: cmd
          .map((o) => ({ threshold: Number(o.predicate.custom_model_data), model: { type: 'minecraft:model', model: String(o.model).includes(':') ? String(o.model) : `minecraft:${o.model}` } }))
          .sort((a, b) => a.threshold - b.threshold),
        fallback: base,
      },
    },
    warnings,
  };
}

/** Models referenced by "overrides" (sub-models like bow_pulling_0) — not items themselves. */
export function overrideTargets(models: Record<string, any>): Set<string> {
  const out = new Set<string>();
  for (const m of Object.values(models))
    for (const o of Array.isArray(m?.overrides) ? m.overrides : []) if (typeof o?.model === 'string') out.add(o.model.includes(':') ? o.model : `minecraft:${o.model}`);
  return out;
}

// ---------------------------------------------------------------------------
// Java registration snippets
// ---------------------------------------------------------------------------

export function constName(id: string): string {
  return parseRL(id).path.replace(/[^a-z0-9]+/gi, '_').toUpperCase();
}

const BLOCK_CLASS: Partial<Record<string, string>> = {
  stairs: 'StairBlock',
  slab: 'SlabBlock',
  wall: 'WallBlock',
  fence: 'FenceBlock',
  fence_gate: 'FenceGateBlock',
  button: 'ButtonBlock',
  pressure_plate: 'PressurePlateBlock',
  door: 'DoorBlock',
  trapdoor: 'TrapDoorBlock',
  pane: 'IronBarsBlock',
  cube_column: 'RotatedPillarBlock',
  cross: 'Block',
};
const YARN_BLOCK_CLASS: Partial<Record<string, string>> = {
  stairs: 'StairsBlock',
  slab: 'SlabBlock',
  wall: 'WallBlock',
  fence: 'FenceBlock',
  fence_gate: 'FenceGateBlock',
  button: 'ButtonBlock',
  pressure_plate: 'PressurePlateBlock',
  door: 'DoorBlock',
  trapdoor: 'TrapdoorBlock',
  pane: 'PaneBlock',
  cube_column: 'PillarBlock',
  cross: 'Block',
};

/** Title shown above the snippet ("Fabric · 1.21.2+ (Yarn)" ...). */
export function snippetTitle(loader: string, version: string): string {
  const l = loader === 'quilt' ? 'Quilt (Fabric API)' : loader === 'neoforge' ? 'NeoForge' : loader === 'forge' ? 'Forge' : loader === 'fabric' ? 'Fabric' : loader;
  const era = atLeast(version, '26.1') ? '26.x' : atLeast(version, '1.21.2') ? '1.21.2+' : '1.21–1.21.1';
  return `${l} · ${era}`;
}

/**
 * Java registration code for the created items/blocks. Uses the most common APIs:
 *  - NeoForge: DeferredRegister.Blocks / DeferredRegister.Items (registerSimpleBlock / registerSimpleItem / registerSimpleBlockItem)
 *  - Fabric ≤1.21.11 (Yarn): Registry.register(Registries.ITEM, ...) with Item.Settings().registryKey(key) on 1.21.2+
 *  - Fabric 26.x (official Mojang names): Registry.register(BuiltInRegistries.ITEM, key, new Item(new Item.Properties().setId(key)))
 */
export function javaSnippet(loader: string, version: string, regs: Registration[], namespace: string): string {
  const needsId = atLeast(version, '1.21.2');
  const lines: string[] = [];
  const special = regs.filter((r) => r.kind === 'block' && r.variant && BLOCK_CLASS[r.variant] && r.variant !== 'cross');
  if (loader === 'neoforge' || loader === 'forge') {
    if (loader === 'forge') {
      lines.push('// Forge: equivalent DeferredRegister code; NeoForge-style helpers shown below are NeoForge-only.');
    }
    lines.push(`public static final DeferredRegister.Blocks BLOCKS = DeferredRegister.createBlocks(MOD_ID);`);
    lines.push(`public static final DeferredRegister.Items ITEMS = DeferredRegister.createItems(MOD_ID);`);
    lines.push('');
    for (const r of regs) {
      const name = parseRL(r.id).path;
      const C = constName(r.id);
      if (r.kind === 'item') {
        lines.push(`public static final DeferredItem<Item> ${C} = ITEMS.registerSimpleItem("${name}");`);
        continue;
      }
      const cls = r.variant ? BLOCK_CLASS[r.variant] : undefined;
      const props = `BlockBehaviour.Properties.of()${r.variant === 'cross' ? '.instabreak().noOcclusion()' : '.strength(1.5f, 6.0f).requiresCorrectToolForDrops()'}`;
      if (!cls || cls === 'Block') {
        lines.push(`public static final DeferredBlock<Block> ${C} = BLOCKS.registerSimpleBlock("${name}", ${props});`);
      } else {
        lines.push(`public static final DeferredBlock<${cls}> ${C} = BLOCKS.registerBlock("${name}", ${blockCtor(cls, r.variant!, 'props', true)}, ${props});`);
      }
      lines.push(`public static final DeferredItem<BlockItem> ${C}_ITEM = ITEMS.registerSimpleBlockItem(${C});`);
    }
    lines.push('');
    lines.push('// In your mod constructor:  BLOCKS.register(modEventBus);  ITEMS.register(modEventBus);');
    if (needsId) lines.push('// (1.21.2+: DeferredRegister sets the registry id on the Properties for you.)');
  } else if (loader === 'fabric' || loader === 'quilt') {
    const mojang = atLeast(version, '26.1');
    if (mojang) {
      lines.push('// 26.x: official (Mojang) names — Yarn is no longer published.');
      for (const r of regs) {
        const name = parseRL(r.id).path;
        const C = constName(r.id);
        const key = `ResourceKey.create(Registries.${r.kind === 'item' ? 'ITEM' : 'BLOCK'}, Identifier.fromNamespaceAndPath(MOD_ID, "${name}"))`;
        if (r.kind === 'item') {
          lines.push(`public static final ResourceKey<Item> ${C}_KEY = ${key};`);
          lines.push(`public static final Item ${C} = Registry.register(BuiltInRegistries.ITEM, ${C}_KEY, new Item(new Item.Properties().setId(${C}_KEY)));`);
        } else {
          const cls = (r.variant && BLOCK_CLASS[r.variant]) || 'Block';
          const props = `BlockBehaviour.Properties.of().setId(${C}_KEY)${r.variant === 'cross' ? '.instabreak().noOcclusion()' : '.strength(1.5f, 6.0f).requiresCorrectToolForDrops()'}`;
          lines.push(`public static final ResourceKey<Block> ${C}_KEY = ${key};`);
          lines.push(`public static final ${cls} ${C} = Registry.register(BuiltInRegistries.BLOCK, ${C}_KEY, ${cls === 'Block' ? `new Block(${props})` : blockCtor(cls, r.variant!, props, false)});`);
          lines.push(`public static final ResourceKey<Item> ${C}_ITEM_KEY = ResourceKey.create(Registries.ITEM, Identifier.fromNamespaceAndPath(MOD_ID, "${name}"));`);
          lines.push(`public static final Item ${C}_ITEM = Registry.register(BuiltInRegistries.ITEM, ${C}_ITEM_KEY, new BlockItem(${C}, new Item.Properties().setId(${C}_ITEM_KEY).useBlockDescriptionPrefix()));`);
        }
        lines.push('');
      }
    } else {
      for (const r of regs) {
        const name = parseRL(r.id).path;
        const C = constName(r.id);
        const ident = `Identifier.of(MOD_ID, "${name}")`;
        if (r.kind === 'item') {
          if (needsId) {
            lines.push(`public static final RegistryKey<Item> ${C}_KEY = RegistryKey.of(RegistryKeys.ITEM, ${ident});`);
            lines.push(`public static final Item ${C} = Registry.register(Registries.ITEM, ${C}_KEY, new Item(new Item.Settings().registryKey(${C}_KEY)));`);
          } else {
            lines.push(`public static final Item ${C} = Registry.register(Registries.ITEM, ${ident}, new Item(new Item.Settings()));`);
          }
        } else {
          const cls = (r.variant && YARN_BLOCK_CLASS[r.variant]) || 'Block';
          const settingsBase = `AbstractBlock.Settings.create()${needsId ? `.registryKey(${C}_KEY)` : ''}`;
          const settings = `${settingsBase}${r.variant === 'cross' ? '.noCollision().breakInstantly()' : '.strength(1.5f, 6.0f).requiresTool()'}`;
          const ctor = cls === 'Block' ? `new Block(${settings})` : yarnBlockCtor(cls, r.variant!, settings);
          if (needsId) {
            lines.push(`public static final RegistryKey<Block> ${C}_KEY = RegistryKey.of(RegistryKeys.BLOCK, ${ident});`);
            lines.push(`public static final ${cls} ${C} = Registry.register(Registries.BLOCK, ${C}_KEY, ${ctor});`);
            lines.push(`public static final RegistryKey<Item> ${C}_ITEM_KEY = RegistryKey.of(RegistryKeys.ITEM, ${ident});`);
            lines.push(
              `public static final Item ${C}_ITEM = Registry.register(Registries.ITEM, ${C}_ITEM_KEY, new BlockItem(${C}, new Item.Settings().registryKey(${C}_ITEM_KEY).useBlockPrefixedTranslationKey()));`,
            );
          } else {
            lines.push(`public static final ${cls} ${C} = Registry.register(Registries.BLOCK, ${ident}, ${ctor});`);
            lines.push(`public static final Item ${C}_ITEM = Registry.register(Registries.ITEM, ${ident}, new BlockItem(${C}, new Item.Settings()));`);
          }
        }
        lines.push('');
      }
    }
    lines.push('// Call any static method of this class from your ModInitializer#onInitialize() to load it.');
    if (regs.some((r) => r.variant === 'cross' || r.variant === 'door' || r.variant === 'trapdoor' || r.variant === 'pane'))
      lines.push('// Plants, doors, trapdoors and panes need a cutout render layer on the client.');
  } else {
    return `// ${namespace}: data packs / resource packs cannot register new items or blocks.\n// The assets were created; register "${regs.map((r) => r.id).join('", "')}" from a mod (Fabric / NeoForge).`;
  }
  if (special.length) lines.push('// Adjust BlockSetType / WoodType / BlockState arguments to your material.');
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

function blockCtor(cls: string, variant: string, props: string, lambda: boolean): string {
  const p = lambda ? 'props' : props;
  let body: string;
  switch (variant) {
    case 'stairs':
      body = `new StairBlock(Blocks.STONE.defaultBlockState(), ${p})`;
      break;
    case 'button':
      body = `new ButtonBlock(BlockSetType.STONE, 20, ${p})`;
      break;
    case 'pressure_plate':
      body = `new PressurePlateBlock(BlockSetType.STONE, ${p})`;
      break;
    case 'door':
    case 'trapdoor':
      body = `new ${cls}(BlockSetType.OAK, ${p})`;
      break;
    case 'fence_gate':
      body = `new FenceGateBlock(WoodType.OAK, ${p})`;
      break;
    default:
      body = `new ${cls}(${p})`;
  }
  return lambda ? `props -> ${body}` : body;
}

function yarnBlockCtor(cls: string, variant: string, settings: string): string {
  switch (variant) {
    case 'stairs':
      return `new StairsBlock(Blocks.STONE.getDefaultState(), ${settings})`;
    case 'button':
      return `new ButtonBlock(BlockSetType.STONE, 20, ${settings})`;
    case 'pressure_plate':
      return `new PressurePlateBlock(BlockSetType.STONE, ${settings})`;
    case 'door':
    case 'trapdoor':
      return `new ${cls}(BlockSetType.OAK, ${settings})`;
    case 'fence_gate':
      return `new FenceGateBlock(WoodType.OAK, ${settings})`;
    default:
      return `new ${cls}(${settings})`;
  }
}
