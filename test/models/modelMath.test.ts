import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  blockstateProperties,
  defaultState,
  defaultUV,
  faceCorners,
  itemDefinitionBranches,
  matchWhen,
  mergeChain,
  resolveTextureVar,
  rotateElements,
  selectModels,
  type Vec3,
} from '../../src/features/models/modelMath';
import { blockstateMatrix } from '../../src/features/models/modelMath';
import type { FaceName, ResolvedElement } from '../../src/shared/protocol';
import { placeholderPng, encodePng, crc32 } from '../../src/features/models/png';
import { inflateSync } from 'node:zlib';

test('mergeChain + texture variables', async () => {
  const models: Record<string, any> = {
    'minecraft:block/cube_all': { parent: 'block/cube', textures: { particle: '#all', up: '#all' } },
    'minecraft:block/cube': { parent: 'block/block', elements: [{ from: [0, 0, 0], to: [16, 16, 16], faces: {} }] },
    'minecraft:block/block': { display: { gui: { rotation: [30, 225, 0] } } },
  };
  const m = await mergeChain('mymod:block/ruby', { parent: 'minecraft:block/cube_all', textures: { all: { sprite: 'mymod:block/ruby' } } }, (id) => models[id]);
  assert.deepEqual(m.chain.map((c) => c.id), ['mymod:block/ruby', 'minecraft:block/cube_all', 'minecraft:block/cube', 'minecraft:block/block']);
  assert.equal(m.elementsFrom, 'minecraft:block/cube');
  assert.deepEqual(m.display.gui, { rotation: [30, 225, 0] });
  assert.equal(resolveTextureVar('#up', m.textures).id, 'mymod:block/ruby');
  assert.equal(resolveTextureVar('#missing', m.textures).id, undefined);
  const gen = await mergeChain('a:item/x', { parent: 'item/generated', textures: { layer0: 'a:item/x' } }, (id) =>
    id === 'minecraft:item/generated' ? { parent: 'builtin/generated' } : undefined,
  );
  assert.equal(gen.generated, true);
  const loop = await mergeChain('a:b', { parent: 'a:b' }, () => ({ parent: 'a:b' }));
  assert.equal(loop.chain.length, 1);
});

/** Physical position (3D) of each UV corner of each face, to compare texture placement before/after rotation. */
function uvPlacement(el: ResolvedElement, face: FaceName): Map<string, string> {
  const f = el.faces[face]!;
  const corners = faceCorners(face, el.from as Vec3, el.to as Vec3);
  const [u1, v1, u2, v2] = f.uv ?? defaultUV(face, el.from as Vec3, el.to as Vec3);
  const uvCorners = [[u1, v1], [u2, v1], [u2, v2], [u1, v2]];
  const steps = ((f.rotation ?? 0) / 90) & 3;
  const out = new Map<string, string>();
  for (let i = 0; i < 4; i++) out.set(uvCorners[(i + steps) % 4].join(','), corners[i].map((x) => Math.round(x * 1000) / 1000).join(','));
  return out;
}

test('rotateElements keeps textures attached to faces (all x/y combos)', () => {
  const tex = (n: string) => ({ texture: { src: n } });
  const el: ResolvedElement = {
    from: [2, 0, 4],
    to: [10, 8, 16],
    faces: { down: tex('d'), up: { ...tex('u'), rotation: 90 }, north: tex('n'), south: { ...tex('s'), uv: [0, 0, 8, 8] }, west: tex('w'), east: tex('e') },
  };
  for (const x of [0, 90, 180, 270])
    for (const y of [0, 90, 180, 270]) {
      const [r] = rotateElements([el], x, y, false);
      const B = blockstateMatrix(x, y);
      const tf = (s: string) => {
        const p = s.split(',').map(Number);
        const q = [0, 1, 2].map((i) => B[i * 3] * (p[0] - 8) + B[i * 3 + 1] * (p[1] - 8) + B[i * 3 + 2] * (p[2] - 8) + 8);
        return q.map((v) => Math.round(v * 1000) / 1000).map((v) => (Object.is(v, -0) ? 0 : v)).join(',');
      };
      assert.equal(Object.keys(r.faces).length, 6);
      for (const face of Object.keys(el.faces) as FaceName[]) {
        const before = uvPlacement(el, face);
        const src = el.faces[face]!.texture!.src;
        const newFace = (Object.keys(r.faces) as FaceName[]).find((k) => r.faces[k]!.texture!.src === src)!;
        const after = uvPlacement(r, newFace);
        for (const [uv, pos] of before) assert.equal(after.get(uv), tf(pos), `x=${x} y=${y} face=${face} uv=${uv}`);
      }
    }
});

test('rotateElements: y=90 turns north into east (furnace facing=east), x=90 turns up into north', () => {
  const el: ResolvedElement = { from: [0, 0, 0], to: [16, 16, 16], faces: { north: { texture: { src: 'front' } }, up: { texture: { src: 'top' } } } };
  const [r] = rotateElements([el], 0, 90);
  assert.equal(r.faces.east?.texture?.src, 'front');
  const [r2] = rotateElements([el], 90, 0);
  assert.equal(r2.faces.north?.texture?.src, 'top');
  const half: ResolvedElement = { from: [0, 0, 0], to: [16, 8, 16], faces: {} };
  assert.deepEqual(rotateElements([half], 180, 0)[0].from, [0, 8, 0]);
  const rotated: ResolvedElement = { from: [0, 0, 8], to: [16, 16, 8], rotation: { origin: [8, 8, 8], axis: 'x', angle: 22.5 }, faces: {} };
  const rr = rotateElements([rotated], 0, 90)[0];
  assert.equal(rr.rotation?.axis, 'z');
  assert.equal(Math.abs(rr.rotation!.angle), 22.5);
});

test('blockstate properties / selection', () => {
  const stairs = {
    variants: {
      'facing=east,half=bottom,shape=straight': { model: 'a:block/s' },
      'facing=north,half=top,shape=straight': { model: 'a:block/s', x: 180, y: 270, uvlock: true },
    },
  };
  const props = blockstateProperties(stairs);
  assert.deepEqual(props, [
    { name: 'facing', values: ['east', 'north'] },
    { name: 'half', values: ['bottom', 'top'] },
    { name: 'shape', values: ['straight'] },
  ]);
  const st = defaultState(stairs, props);
  assert.deepEqual(st, { facing: 'east', half: 'bottom', shape: 'straight' });
  assert.deepEqual(selectModels(stairs, { facing: 'north', half: 'top', shape: 'straight' }), [
    { model: 'a:block/s', x: 180, y: 270, uvlock: true, label: 'facing=north,half=top,shape=straight', alternatives: 1 },
  ]);
  const fence = {
    multipart: [{ apply: { model: 'a:post' } }, { apply: { model: 'a:side', y: 90 }, when: { east: 'true' } }, { apply: { model: 'a:x' }, when: { OR: [{ north: 'low|tall' }, { up: '!true' }] } }],
  };
  const fp = blockstateProperties(fence);
  assert.deepEqual(fp.find((p) => p.name === 'east')!.values, ['false', 'true']);
  assert.deepEqual(fp.find((p) => p.name === 'north')!.values, ['low', 'tall', 'none']);
  assert.deepEqual(selectModels(fence, { east: 'true', north: 'none', up: 'true' }).map((m) => m.model), ['a:post', 'a:side']);
  assert.equal(matchWhen({ up: '!true' }, { up: 'false' }), true);
  assert.equal(selectModels({ variants: { '': [{ model: 'a' }, { model: 'b' }] } }, {}, 1)[0].model, 'minecraft:b');
});

test('item definition branches', () => {
  const bow = {
    model: {
      type: 'minecraft:condition',
      property: 'minecraft:using_item',
      on_false: { type: 'minecraft:model', model: 'minecraft:item/bow' },
      on_true: {
        type: 'minecraft:range_dispatch',
        property: 'minecraft:use_duration',
        scale: 0.05,
        entries: [{ threshold: 0.65, model: { type: 'minecraft:model', model: 'minecraft:item/bow_pulling_1' } }],
        fallback: { type: 'minecraft:model', model: 'minecraft:item/bow_pulling_0' },
      },
    },
  };
  const b = itemDefinitionBranches(bow);
  assert.deepEqual(b.map((x) => x.models[0].model), ['minecraft:item/bow', 'minecraft:item/bow_pulling_0', 'minecraft:item/bow_pulling_1']);
  assert.equal(b[2].label, 'using_item = true › use_duration ≥ 0.65');
  const chest = itemDefinitionBranches({ model: { type: 'minecraft:special', base: 'minecraft:item/chest', model: { type: 'minecraft:chest', texture: 'minecraft:normal' } } });
  assert.equal(chest[0].special, 'chest');
  const tinted = itemDefinitionBranches({ model: { type: 'model', model: 'item/leather_helmet', tints: [{ type: 'minecraft:dye', default: -6265536 }] } });
  assert.equal(tinted[0].models[0].tints[0], '#a06540');
});

test('png encoder', () => {
  const png = placeholderPng('block', '#cc3344', 'ruby');
  assert.deepEqual([...png.slice(1, 4)].map((c) => String.fromCharCode(c)).join(''), 'PNG');
  // IDAT inflates to 16 rows * (1 + 64) bytes
  const buf = Buffer.from(png);
  const idat = buf.indexOf('IDAT');
  const len = buf.readUInt32BE(idat - 4);
  assert.equal(inflateSync(buf.subarray(idat + 4, idat + 4 + len)).length, 16 * 65);
  assert.equal(crc32(new TextEncoder().encode('IEND')), 0xae426082);
  assert.equal(encodePng(1, 1, new Uint8Array([255, 0, 0, 255])).length > 50, true);
});
