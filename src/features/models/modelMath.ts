// Pure model helpers for the model viewer & generators (no 'vscode' import — unit tested).
//  - mergeChain: walk a model's parent chain (textures / elements / display)
//  - resolveTextureVar: follow "#var" references
//  - rotateElements: apply blockstate x/y rotations (+ uvlock) to resolved elements
//  - blockstate helpers: properties, default state, variant / multipart selection
//  - item definition (1.21.4+) helpers: enumerate the model branches of an items/*.json tree
import type { FaceName, ModelDisplayTransform, ResolvedElement, ResolvedFace } from '../../shared/protocol';
import { normalizeId, parseRL } from '../../core/resourceLocation';

export interface RawModel {
  parent?: string;
  textures?: Record<string, unknown>;
  elements?: any[];
  display?: Record<string, ModelDisplayTransform>;
  gui_light?: string;
  ambientocclusion?: boolean;
  [k: string]: unknown;
}

export interface ChainEntry {
  id: string;
  found: boolean;
}

export interface MergedChain {
  /** texture variable -> raw value ("#other" or a texture id) — the nearest definition wins. */
  textures: Record<string, string>;
  /** texture variable -> model id that defined it. */
  textureOwner: Record<string, string>;
  elements?: any[];
  /** Model id the elements come from. */
  elementsFrom?: string;
  /** Display transforms merged per context (child overrides parent per context). */
  display: Record<string, ModelDisplayTransform>;
  chain: ChainEntry[];
  generated: boolean;
  builtinEntity: boolean;
  guiLight?: string;
}

export type ModelLoader = (id: string) => Promise<RawModel | undefined> | RawModel | undefined;

/** Texture value: plain string or the 26.x {"sprite": "...", "force_translucent": true} object. */
export function textureValue(v: unknown): string | undefined {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object' && typeof (v as any).sprite === 'string') return (v as any).sprite;
  return undefined;
}

/** Walk the parent chain of a model. `root` (if given) is used for `rootId` instead of the loader (unsaved documents). */
export async function mergeChain(rootId: string, root: RawModel | undefined, load: ModelLoader): Promise<MergedChain> {
  const merged: MergedChain = { textures: {}, textureOwner: {}, display: {}, chain: [], generated: false, builtinEntity: false };
  let current: string | undefined = normalizeId(rootId);
  let model: RawModel | undefined = root;
  const seen = new Set<string>();
  for (let depth = 0; current && depth < 24; depth++) {
    if (seen.has(current)) break;
    seen.add(current);
    const path = parseRL(current).path;
    if (path === 'builtin/generated') {
      merged.chain.push({ id: current, found: true });
      merged.generated = true;
      break;
    }
    if (path === 'builtin/entity') {
      merged.chain.push({ id: current, found: true });
      merged.builtinEntity = true;
      break;
    }
    const m: RawModel | undefined = depth === 0 && model ? model : await load(current);
    merged.chain.push({ id: current, found: !!m });
    if (!m || typeof m !== 'object') break;
    for (const [k, v] of Object.entries(m.textures ?? {})) {
      const tex = textureValue(v);
      if (tex && !(k in merged.textures)) {
        merged.textures[k] = tex;
        merged.textureOwner[k] = current;
      }
    }
    if (!merged.elements && Array.isArray(m.elements)) {
      merged.elements = m.elements;
      merged.elementsFrom = current;
    }
    for (const [ctx, t] of Object.entries(m.display ?? {})) if (!(ctx in merged.display) && t && typeof t === 'object') merged.display[ctx] = t;
    if (!merged.guiLight && typeof m.gui_light === 'string') merged.guiLight = m.gui_light;
    current = typeof m.parent === 'string' && m.parent ? normalizeId(m.parent) : undefined;
  }
  if (!merged.elements && Object.keys(merged.textures).some((k) => /^layer\d+$/.test(k))) merged.generated = true;
  return merged;
}

/** Follow "#var" references. Returns the final texture id (undefined when unresolved) and the visited variables. */
export function resolveTextureVar(ref: string, textures: Record<string, string>): { id?: string; via: string[] } {
  const via: string[] = [];
  let v: string | undefined = ref;
  for (let i = 0; i < 16 && v !== undefined; i++) {
    if (!v.startsWith('#')) return { id: v, via };
    const name = v.slice(1);
    if (via.includes(name)) break;
    via.push(name);
    v = textures[name];
  }
  if (v !== undefined && !v.startsWith('#')) return { id: v, via };
  return { via };
}

/** "layer0", "layer1"... texture variables of a generated model, in order. */
export function generatedLayers(textures: Record<string, string>): string[] {
  return Object.keys(textures)
    .filter((k) => /^layer\d+$/.test(k))
    .sort((a, b) => Number(a.slice(5)) - Number(b.slice(5)));
}

// ---------------------------------------------------------------------------
// Geometry (mirrors webview-src/shared/itemRenderer.ts conventions)
// ---------------------------------------------------------------------------

export type Vec3 = [number, number, number];
export type Mat3 = [number, number, number, number, number, number, number, number, number];

export const FACE_NAMES: FaceName[] = ['down', 'up', 'north', 'south', 'west', 'east'];

export const NORMALS: Record<FaceName, Vec3> = {
  north: [0, 0, -1],
  south: [0, 0, 1],
  west: [-1, 0, 0],
  east: [1, 0, 0],
  up: [0, 1, 0],
  down: [0, -1, 0],
};

/** Corners of a face in texture order: top-left, top-right, bottom-right, bottom-left. */
export function faceCorners(face: FaceName, f: Vec3, t: Vec3): [Vec3, Vec3, Vec3, Vec3] {
  switch (face) {
    case 'north':
      return [[t[0], t[1], f[2]], [f[0], t[1], f[2]], [f[0], f[1], f[2]], [t[0], f[1], f[2]]];
    case 'south':
      return [[f[0], t[1], t[2]], [t[0], t[1], t[2]], [t[0], f[1], t[2]], [f[0], f[1], t[2]]];
    case 'west':
      return [[f[0], t[1], f[2]], [f[0], t[1], t[2]], [f[0], f[1], t[2]], [f[0], f[1], f[2]]];
    case 'east':
      return [[t[0], t[1], t[2]], [t[0], t[1], f[2]], [t[0], f[1], f[2]], [t[0], f[1], t[2]]];
    case 'up':
      return [[f[0], t[1], f[2]], [t[0], t[1], f[2]], [t[0], t[1], t[2]], [f[0], t[1], t[2]]];
    case 'down':
      return [[f[0], f[1], t[2]], [t[0], f[1], t[2]], [t[0], f[1], f[2]], [f[0], f[1], f[2]]];
  }
}

/** UV Minecraft computes when a face has no "uv". */
export function defaultUV(face: FaceName, f: Vec3, t: Vec3): [number, number, number, number] {
  switch (face) {
    case 'north':
      return [16 - t[0], 16 - t[1], 16 - f[0], 16 - f[1]];
    case 'south':
      return [f[0], 16 - t[1], t[0], 16 - f[1]];
    case 'west':
      return [f[2], 16 - t[1], t[2], 16 - f[1]];
    case 'east':
      return [16 - t[2], 16 - t[1], 16 - f[2], 16 - f[1]];
    case 'up':
      return [f[0], f[2], t[0], t[2]];
    case 'down':
      return [f[0], 16 - t[2], t[0], 16 - f[2]];
  }
}

const DEG = Math.PI / 180;
function rot(axis: 'x' | 'y' | 'z', deg: number): Mat3 {
  // Exact for multiples of 90°
  const c = Math.round(Math.cos(deg * DEG) * 1e9) / 1e9;
  const s = Math.round(Math.sin(deg * DEG) * 1e9) / 1e9;
  if (axis === 'x') return [1, 0, 0, 0, c, -s, 0, s, c];
  if (axis === 'y') return [c, 0, s, 0, 1, 0, -s, 0, c];
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}
function mul(a: Mat3, b: Mat3): Mat3 {
  const r = new Array(9).fill(0) as Mat3;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j];
  return r;
}
function apply(m: Mat3, v: Vec3): Vec3 {
  const r: Vec3 = [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
  return r.map((x) => (Math.abs(x) < 1e-9 ? 0 : x)) as Vec3;
}
const near = (a: Vec3, b: Vec3) => Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6 && Math.abs(a[2] - b[2]) < 1e-6;

/** Blockstate rotation matrix: Minecraft applies X first, then Y (both clockwise-negative): Ry(-y)·Rx(-x). */
export function blockstateMatrix(x: number, y: number): Mat3 {
  return mul(rot('y', -y), rot('x', -x));
}

function faceForNormal(n: Vec3): FaceName {
  for (const f of FACE_NAMES) if (near(NORMALS[f], n)) return f;
  return 'north';
}

/**
 * Rotate resolved elements like a blockstate variant {x, y, uvlock} does.
 * Faces get explicit uv/rotation so the texture stays attached to the face (or world-aligned with uvlock).
 */
export function rotateElements<E extends ResolvedElement>(elements: E[], x = 0, y = 0, uvlock = false): E[] {
  x = ((x % 360) + 360) % 360;
  y = ((y % 360) + 360) % 360;
  if (!x && !y) return elements;
  return transformElements(elements, blockstateMatrix(x, y), [8, 8, 8], uvlock);
}

/** Apply an axis-aligned rotation matrix (multiples of 90°) around `origin` to elements. */
export function transformElements<E extends ResolvedElement>(elements: E[], B: Mat3, origin: Vec3 = [8, 8, 8], uvlock = false): E[] {
  const tp = (p: Vec3): Vec3 => {
    const q = apply(B, [p[0] - origin[0], p[1] - origin[1], p[2] - origin[2]]);
    return [q[0] + origin[0], q[1] + origin[1], q[2] + origin[2]].map((n) => Math.round(n * 1e6) / 1e6) as Vec3;
  };
  return elements.map((el) => {
    const corners: Vec3[] = [];
    for (const cx of [el.from[0], el.to[0]]) for (const cy of [el.from[1], el.to[1]]) for (const cz of [el.from[2], el.to[2]]) corners.push(tp([cx, cy, cz]));
    const from: Vec3 = [0, 1, 2].map((i) => Math.min(...corners.map((c) => c[i]))) as Vec3;
    const to: Vec3 = [0, 1, 2].map((i) => Math.max(...corners.map((c) => c[i]))) as Vec3;
    const out: E = { ...el, from, to, faces: {} };
    if (el.rotation && el.rotation.angle) {
      const axisVec: Vec3 = el.rotation.axis === 'x' ? [1, 0, 0] : el.rotation.axis === 'y' ? [0, 1, 0] : [0, 0, 1];
      const a = apply(B, axisVec);
      const idx = a.findIndex((c) => Math.abs(c) > 0.5);
      const sign = a[idx] < 0 ? -1 : 1;
      out.rotation = {
        ...el.rotation,
        origin: tp(el.rotation.origin),
        axis: (['x', 'y', 'z'] as const)[idx],
        angle: el.rotation.angle * sign,
      };
    }
    for (const [name, face] of Object.entries(el.faces) as [FaceName, ResolvedFace][]) {
      if (!face) continue;
      const newName = faceForNormal(apply(B, NORMALS[name]));
      if (uvlock) {
        const { rotation: _r, ...rest } = face;
        out.faces[newName] = { ...rest, uv: defaultUV(newName, from, to) };
        continue;
      }
      const oldTL = tp(faceCorners(name, el.from, el.to)[0]);
      const j = Math.max(0, faceCorners(newName, from, to).findIndex((c) => near(c, oldTL)));
      const r0 = ((face.rotation ?? 0) / 90) & 3;
      const steps = (((r0 - j) % 4) + 4) % 4;
      out.faces[newName] = { ...face, uv: face.uv ?? defaultUV(name, el.from, el.to), rotation: (steps * 90) as 0 | 90 | 180 | 270 };
    }
    return out;
  });
}

/**
 * Apply a model element "rotation": classic {origin, axis, angle, rescale} or the 26.x multi-axis form
 * {origin, x, y, z}. Multiples of 90° are baked into the box; one remaining free angle becomes a single-axis rotation
 * (the renderer supports one axis). Returns a note when the rotation had to be approximated.
 */
export function applyElementRotation(el: ResolvedElement, rot: any): { el: ResolvedElement; approximate?: boolean } {
  if (!rot || typeof rot !== 'object') return { el };
  const origin: Vec3 = Array.isArray(rot.origin) ? (rot.origin.map(Number) as Vec3) : [8, 8, 8];
  if (typeof rot.axis === 'string') {
    const angle = Number(rot.angle ?? 0);
    return { el: angle ? { ...el, rotation: { origin, axis: rot.axis, angle, rescale: !!rot.rescale } } : el };
  }
  const axes = ['x', 'y', 'z'] as const;
  const angles = axes.map((a) => Number(rot[a] ?? 0));
  const free = axes.map((_, i) => angles[i] % 90 !== 0);
  const resIdx = free.indexOf(true);
  const approximate = free.filter(Boolean).length > 1;
  // Matrix order: Rx · Ry · Rz (z applied first)
  const R = (i: number, deg: number) => rot2(axes[i], deg);
  const snap = (i: number) => Math.round(angles[i] / 90) * 90;
  let A: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  let C: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  for (let i = 0; i < 3; i++) {
    if (i === resIdx) continue;
    if (resIdx < 0 || i < resIdx) A = mul(A, R(i, snap(i)));
    else C = mul(C, R(i, snap(i)));
  }
  let out: ResolvedElement = transformElements<ResolvedElement>([{ ...el, rotation: undefined }], mul(A, C), origin)[0];
  if (resIdx >= 0) {
    const unit: Vec3 = [0, 0, 0];
    unit[resIdx] = 1;
    const a = apply(A, unit);
    const idx = a.findIndex((c) => Math.abs(c) > 0.5);
    out = { ...out, rotation: { origin, axis: axes[idx], angle: angles[resIdx] * (a[idx] < 0 ? -1 : 1), rescale: !!rot.rescale } };
  }
  return { el: out, approximate };
}

function rot2(axis: 'x' | 'y' | 'z', deg: number): Mat3 {
  return rot(axis, deg);
}

// ---------------------------------------------------------------------------
// Blockstates
// ---------------------------------------------------------------------------

export interface BlockProperty {
  name: string;
  values: string[];
}

export interface AppliedModel {
  model: string;
  x: number;
  y: number;
  uvlock: boolean;
  /** Human label of the variant key / multipart case that selected it. */
  label: string;
  /** Number of weighted alternatives (variants with arrays). */
  alternatives: number;
}

export function parseVariantKey(key: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of key.split(',')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

function conditionValues(when: any, add: (k: string, v: string) => void): void {
  if (!when || typeof when !== 'object') return;
  for (const key of ['OR', 'AND']) if (Array.isArray(when[key])) when[key].forEach((w: any) => conditionValues(w, add));
  for (const [k, v] of Object.entries(when)) {
    if (k === 'OR' || k === 'AND') continue;
    for (const s of String(v).replace(/^!/, '').split('|')) add(k, s);
  }
}

/** Every property mentioned by a blockstate (merged with known properties, e.g. from vanilla block data). */
export function blockstateProperties(json: any, known?: Record<string, string[]>): BlockProperty[] {
  const map = new Map<string, string[]>();
  const add = (k: string, v: string) => {
    let list = map.get(k);
    if (!list) map.set(k, (list = []));
    if (v !== '' && !list.includes(v)) list.push(v);
  };
  for (const [k, vals] of Object.entries(known ?? {})) for (const v of vals) add(k, String(v));
  if (json?.variants && typeof json.variants === 'object') {
    for (const key of Object.keys(json.variants)) for (const [k, v] of Object.entries(parseVariantKey(key))) add(k, v);
  }
  if (Array.isArray(json?.multipart)) for (const part of json.multipart) conditionValues(part?.when, add);
  const out: BlockProperty[] = [];
  for (const [name, values] of map) {
    let vals = values;
    if (vals.every((v) => v === 'true' || v === 'false')) vals = ['false', 'true'];
    else if (vals.every((v) => /^\d+$/.test(v))) vals = [...vals].sort((a, b) => Number(a) - Number(b));
    out.push({ name, values: vals });
  }
  if (Array.isArray(json?.multipart) && !known) {
    // Multipart properties may have values never mentioned (e.g. wall side "none"): offer an empty choice.
    for (const p of out) if (!p.values.includes('false') && !p.values.includes('none')) p.values.push('none');
  }
  return out;
}

/** A sensible initial state: known defaults, else the first variant key, else the first value of every property. */
export function defaultState(json: any, props: BlockProperty[], knownDefaults?: Record<string, string>): Record<string, string> {
  const state: Record<string, string> = {};
  for (const p of props) state[p.name] = p.values[0] ?? '';
  if (json?.variants && typeof json.variants === 'object') {
    const first = Object.keys(json.variants)[0];
    if (first !== undefined) Object.assign(state, parseVariantKey(first));
  } else if (Array.isArray(json?.multipart) && !knownDefaults) {
    // Show something representative: booleans true (fences / panes connected), others first value
    for (const p of props) if (p.values.includes('true')) state[p.name] = 'true';
  }
  for (const [k, v] of Object.entries(knownDefaults ?? {})) if (k in state) state[k] = String(v);
  return state;
}

export function matchWhen(when: any, state: Record<string, string>): boolean {
  if (!when || typeof when !== 'object') return true;
  if (Array.isArray(when.OR)) return when.OR.some((w: any) => matchWhen(w, state));
  if (Array.isArray(when.AND)) return when.AND.every((w: any) => matchWhen(w, state));
  return Object.entries(when).every(([k, v]) => {
    let s = String(v);
    const negate = s.startsWith('!');
    if (negate) s = s.slice(1);
    const ok = s.split('|').includes(state[k] ?? '');
    return negate ? !ok : ok;
  });
}

function toApplied(v: any, label: string, alt: number): AppliedModel | undefined {
  const list = Array.isArray(v) ? v : [v];
  const pick = list[Math.min(Math.max(0, alt), list.length - 1)];
  if (!pick || typeof pick.model !== 'string') return undefined;
  return { model: normalizeId(pick.model), x: Number(pick.x ?? 0), y: Number(pick.y ?? 0), uvlock: !!pick.uvlock, label, alternatives: list.length };
}

/** Models a blockstate renders for a state (variants: the first matching key; multipart: every matching case). */
export function selectModels(json: any, state: Record<string, string>, alt = 0): AppliedModel[] {
  const out: AppliedModel[] = [];
  if (json?.variants && typeof json.variants === 'object') {
    for (const [key, v] of Object.entries<any>(json.variants)) {
      const cond = parseVariantKey(key);
      if (Object.entries(cond).every(([k, val]) => state[k] === val)) {
        const a = toApplied(v, key || '""', alt);
        if (a) out.push(a);
        break;
      }
    }
  }
  if (Array.isArray(json?.multipart)) {
    json.multipart.forEach((part: any, i: number) => {
      if (!matchWhen(part?.when, state)) return;
      const a = toApplied(part?.apply, part?.when ? `#${i} ${JSON.stringify(part.when)}` : `#${i}`, alt);
      if (a) out.push(a);
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Item model definitions (assets/<ns>/items/*.json, 1.21.4+)
// ---------------------------------------------------------------------------

export interface BranchModel {
  model: string;
  tints: (string | undefined)[];
}

export interface ItemBranch {
  id: string;
  label: string;
  models: BranchModel[];
  /** "special" model type (chest, shulker_box, ...) rendered by code. */
  special?: string;
  /** Other notes (empty / bundle selected item ...). */
  note?: string;
}

const FOLIAGE = '#48b518';
const GRASS = '#7cbd6b';

export function tintColor(t: any): string | undefined {
  if (!t || typeof t !== 'object') return undefined;
  const type = String(t.type ?? '').replace(/^minecraft:/, '');
  const value = t.value ?? t.default;
  if (type === 'grass') return GRASS;
  if (type === 'foliage' || type === 'dry_foliage') return FOLIAGE;
  if (typeof value === 'number') return `#${((value >>> 0) & 0xffffff).toString(16).padStart(6, '0')}`;
  if (Array.isArray(value)) return `#${value.map((c: number) => Math.round(c * 255).toString(16).padStart(2, '0')).join('')}`;
  return undefined;
}

const strip = (s: unknown) => String(s ?? '').replace(/^minecraft:/, '');

/** Enumerate the leaf models of an item definition. The first branch is the "default" one (fallbacks / false first). */
export function itemDefinitionBranches(def: any, limit = 300): ItemBranch[] {
  const out: ItemBranch[] = [];
  const walk = (node: any, path: string[], depth: number): void => {
    if (out.length >= limit || depth > 16) return;
    const label = path.length ? path.join(' › ') : 'model';
    const push = (b: Omit<ItemBranch, 'id' | 'label'>) => out.push({ id: String(out.length), label, ...b });
    if (!node || typeof node !== 'object') return;
    const type = strip(node.type);
    switch (type) {
      case 'model':
        push({ models: [{ model: normalizeId(String(node.model ?? '')), tints: (node.tints ?? []).map(tintColor) }] });
        return;
      case 'condition': {
        const prop = describeProperty(node);
        walk(node.on_false, [...path, `${prop} = false`], depth + 1);
        walk(node.on_true, [...path, `${prop} = true`], depth + 1);
        return;
      }
      case 'select': {
        const prop = describeProperty(node);
        if (node.fallback) walk(node.fallback, [...path, `${prop}: fallback`], depth + 1);
        for (const c of node.cases ?? []) {
          const when = Array.isArray(c?.when) ? c.when.map(fmtWhen).join(' | ') : fmtWhen(c?.when);
          walk(c?.model, [...path, `${prop} = ${when}`], depth + 1);
        }
        return;
      }
      case 'range_dispatch': {
        const prop = describeProperty(node);
        if (node.fallback) walk(node.fallback, [...path, `${prop}: fallback`], depth + 1);
        for (const e of node.entries ?? []) walk(e?.model, [...path, `${prop} ≥ ${e?.threshold}`], depth + 1);
        return;
      }
      case 'composite': {
        const models: BranchModel[] = [];
        for (const child of node.models ?? []) {
          const sub = itemDefinitionBranches({ model: child }, 1)[0];
          if (sub) models.push(...sub.models);
        }
        push({ models, note: 'composite' });
        return;
      }
      case 'special': {
        const special = strip(node.model?.type);
        push({ models: node.base ? [{ model: normalizeId(String(node.base)), tints: [] }] : [], special: special || 'special' });
        return;
      }
      case 'empty':
        push({ models: [], note: 'empty' });
        return;
      case 'bundle/selected_item':
        push({ models: [], note: 'bundle/selected_item' });
        return;
      default:
        push({ models: [], note: `unknown type ${type || '?'}` });
    }
  };
  walk(def?.model, [], 0);
  return out;
}

function describeProperty(node: any): string {
  const p = strip(node.property);
  if (p === 'component' && node.component) return `component ${strip(node.component)}`;
  if (p === 'has_component' && node.component) return `has_component ${strip(node.component)}`;
  if (p === 'custom_model_data' && node.index !== undefined) return `custom_model_data[${node.index}]`;
  if (p === 'keybind_down' && node.keybind) return `keybind_down ${node.keybind}`;
  return p || '?';
}

function fmtWhen(w: unknown): string {
  if (typeof w === 'string' || typeof w === 'number' || typeof w === 'boolean') return String(w);
  return JSON.stringify(w);
}
