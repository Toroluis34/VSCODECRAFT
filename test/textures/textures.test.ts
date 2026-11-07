import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as zlib from 'node:zlib';
import * as fs from 'node:fs';
import { crc32, decodePng, encodePng, readPngSize } from '../../src/features/textures/png';
import {
  adjustColor,
  adjustImage,
  base64ToBytes,
  bytesToBase64,
  createImage,
  crop,
  dominantHue,
  extractPalette,
  flipHorizontal,
  floodFill,
  frameLayout,
  fromWire,
  getPixel,
  hexToRgba,
  hslToRgb,
  hsvToRgb,
  hueShift,
  imagesEqual,
  joinFrames,
  linePoints,
  mirrorPoints,
  rectPoints,
  resizeCanvas,
  rgbaToHex,
  rgbToHsl,
  rgbToHsv,
  rotate90,
  scaleNearest,
  setPixel,
  splitFrames,
  textureWarnings,
  toWire,
  type Rgba,
  type RgbaImage,
} from '../../src/features/textures/pixels';
import {
  animationLength,
  animationTimeline,
  formatFrameList,
  framesAfterRemoval,
  parseAnimation,
  parseFrameList,
  stepAt,
  writeAnimation,
} from '../../src/features/textures/mcmeta';
import { guessMaterial, isModelTexturePath, isTextureIdCandidate, normalizeTextureId, renameVariant } from '../../src/features/textures/textureRefs';

function sample(w = 4, h = 3): RgbaImage {
  const img = createImage(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) setPixel(img, x, y, [x * 40, y * 60, (x + y) * 20, x === 0 && y === 0 ? 0 : 200 + x]);
  return img;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), Buffer.from(data)]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function rawPng(w: number, h: number, bitDepth: number, colorType: number, rows: number[][], extra: Buffer[] = [], interlace = 0, rawData?: Buffer): Uint8Array {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = bitDepth;
  ihdr[9] = colorType;
  ihdr[12] = interlace;
  const raw = rawData ?? Buffer.concat(rows.map((r) => Buffer.from([0, ...r])));
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', ihdr),
      ...extra,
      chunk('IDAT', zlib.deflateSync(raw)),
      chunk('IEND', new Uint8Array(0)),
    ]),
  );
}

test('png: encode/decode round trip (RGBA and opaque RGB)', () => {
  const img = sample(7, 5);
  const png = encodePng(img);
  assert.deepEqual(readPngSize(png), { width: 7, height: 5 });
  const back = decodePng(png);
  assert.ok(imagesEqual(img, back));

  const opaque = createImage(16, 16, [10, 200, 30, 255]);
  setPixel(opaque, 3, 4, [255, 0, 0, 255]);
  const png2 = encodePng(opaque);
  assert.equal(png2[25], 2, 'colour type RGB when opaque');
  assert.ok(imagesEqual(opaque, decodePng(png2)));
});

test('png: palette, low bit depth, tRNS, grey+alpha, 16-bit', () => {
  // 2-bit palette, 3x1: indices 0,1,2 ; palette red, green, blue ; index 1 half transparent
  const plte = chunk('PLTE', new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255]));
  const trns = chunk('tRNS', new Uint8Array([255, 128]));
  const p = decodePng(rawPng(3, 1, 2, 3, [[0b00011000]], [plte, trns]));
  assert.deepEqual(getPixel(p, 0, 0), [255, 0, 0, 255]);
  assert.deepEqual(getPixel(p, 1, 0), [0, 255, 0, 128]);
  assert.deepEqual(getPixel(p, 2, 0), [0, 0, 255, 255]);

  // 1-bit grey: 10100000 -> white, black, white
  const g = decodePng(rawPng(3, 1, 1, 0, [[0b10100000]]));
  assert.deepEqual(getPixel(g, 0, 0), [255, 255, 255, 255]);
  assert.deepEqual(getPixel(g, 1, 0), [0, 0, 0, 255]);

  // grey + alpha 8-bit
  const ga = decodePng(rawPng(1, 1, 8, 4, [[100, 50]]));
  assert.deepEqual(getPixel(ga, 0, 0), [100, 100, 100, 50]);

  // 16-bit RGB with tRNS colour key
  const key = chunk('tRNS', new Uint8Array([0x12, 0x34, 0, 0, 0xff, 0xff]));
  const c16 = decodePng(rawPng(2, 1, 16, 2, [[0x12, 0x34, 0, 0, 0xff, 0xff, 0xab, 0xcd, 0x80, 0, 0, 0]], [key]));
  assert.deepEqual(getPixel(c16, 0, 0), [0x12, 0, 0xff, 0]);
  assert.deepEqual(getPixel(c16, 1, 0), [0xab, 0x80, 0, 255]);
});

test('png: filters (sub/up/avg/paeth) decode correctly', () => {
  // 2x2 RGB rows with different filter types built by hand
  const row0 = [1, 10, 20, 30, 5, 5, 5]; // Sub: second pixel = first + 5
  const row1 = [2, 1, 1, 1, 1, 1, 1]; // Up: + previous row
  const raw = Buffer.from([...row0, ...row1]);
  const img = decodePng(rawPng(2, 2, 8, 2, [], [], 0, raw));
  assert.deepEqual(getPixel(img, 1, 0), [15, 25, 35, 255]);
  assert.deepEqual(getPixel(img, 0, 1), [11, 21, 31, 255]);
  assert.deepEqual(getPixel(img, 1, 1), [16, 26, 36, 255]);
  // encoder output (which uses adaptive filters) must decode back exactly on a noisy image
  const noisy = createImage(33, 17);
  let seed = 7;
  for (let i = 0; i < noisy.data.length; i++) noisy.data[i] = (seed = (seed * 1103515245 + 12345) & 0x7fffffff) & 255;
  assert.ok(imagesEqual(noisy, decodePng(encodePng(noisy))));
});

test('png: Adam7 interlaced decoding', () => {
  const w = 10;
  const h = 9;
  const pix = (x: number, y: number) => [x * 20, y * 25, 99];
  const passes = [
    [0, 0, 8, 8],
    [4, 0, 8, 8],
    [0, 4, 4, 8],
    [2, 0, 4, 4],
    [0, 2, 2, 4],
    [1, 0, 2, 2],
    [0, 1, 1, 2],
  ];
  const parts: number[] = [];
  for (const [x0, y0, dx, dy] of passes) {
    if (x0 >= w || y0 >= h) continue;
    for (let y = y0; y < h; y += dy) {
      parts.push(0);
      for (let x = x0; x < w; x += dx) parts.push(...pix(x, y));
    }
  }
  const img = decodePng(rawPng(w, h, 8, 2, [], [], 1, Buffer.from(parts)));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) assert.deepEqual(getPixel(img, x, y), [...pix(x, y), 255]);
});

test('png: decodes the real vanilla atlas when cached', { skip: !fs.existsSync('.harness-cache/26.3/atlas.png') }, () => {
  const bytes = new Uint8Array(fs.readFileSync('.harness-cache/26.3/atlas.png'));
  const img = decodePng(bytes);
  assert.equal(img.width, readPngSize(bytes)!.width);
  const stone = crop(img, { x: 64, y: 1968, w: 16, h: 16 });
  const pal = extractPalette(stone);
  assert.ok(pal.length > 3 && pal.every((c) => c[3] === 255));
});

test('colour conversions', () => {
  assert.deepEqual(hexToRgba('#f00'), [255, 0, 0, 255]);
  assert.deepEqual(hexToRgba('11223380'), [0x11, 0x22, 0x33, 0x80]);
  assert.equal(hexToRgba('xyz'), undefined);
  assert.equal(rgbaToHex([255, 128, 0, 255]), '#ff8000');
  assert.equal(rgbaToHex([255, 128, 0, 16]), '#ff800010');
  for (const c of [[12, 200, 77], [255, 255, 255], [0, 0, 0], [90, 30, 200]] as [number, number, number][]) {
    assert.deepEqual(hsvToRgb(...rgbToHsv(...c)), c);
    assert.deepEqual(hslToRgb(...rgbToHsl(...c)), c);
  }
  assert.deepEqual(rgbToHsv(0, 0, 255).map((x) => Math.round(x * 100) / 100), [240, 1, 1]);
});

test('colour adjustments and hue shift', () => {
  const red: Rgba = [200, 20, 20, 255];
  const blue = adjustColor(red, { hue: 240 });
  assert.ok(blue[2] > blue[0] && blue[2] > blue[1], 'red + 240° is blue');
  const grey = adjustColor(red, { saturation: -100 });
  assert.equal(grey[0], grey[1]);
  assert.equal(grey[1], grey[2]);
  assert.deepEqual(adjustColor(red, { brightness: -100 }).slice(0, 3), [0, 0, 0]);
  assert.equal(adjustColor([1, 2, 3, 77], { hue: 30 })[3], 77, 'alpha kept');
  const greyPx = adjustColor([128, 128, 128, 255], { hue: 90 });
  assert.deepEqual(greyPx, [128, 128, 128, 255], 'greys unaffected by hue');
  const col = adjustColor([128, 128, 128, 255], { colorize: 120 });
  assert.ok(col[1] > col[0], 'colorize tints greys');

  const masked = { hue: 120, mask: { hue: 0, tolerance: 20 } };
  assert.notDeepEqual(adjustColor(red, masked), red, 'red is inside the mask');
  assert.deepEqual(adjustColor([120, 80, 40, 255], masked), [120, 80, 40, 255], 'brown handle (30°) outside ±20° is kept');
  assert.deepEqual(adjustColor([20, 200, 20, 255], masked), [20, 200, 20, 255], 'green outside the mask is kept');

  const ruby = createImage(2, 2, [220, 30, 60, 255]);
  setPixel(ruby, 1, 1, [0, 0, 0, 0]);
  const rubyHue = rgbToHsv(220, 30, 60)[0];
  assert.ok(Math.abs(dominantHue(ruby)! - rubyHue) < 1);
  const sapphire = hueShift(ruby, 225 - rubyHue);
  assert.ok(Math.abs(dominantHue(sapphire)! - 225) < 2);
  assert.deepEqual(getPixel(sapphire, 1, 1), [0, 0, 0, 0], 'transparent pixels untouched');
  const partial = adjustImage(ruby, { hue: 120 }, { x: 0, y: 0, w: 1, h: 1 });
  assert.deepEqual(getPixel(partial, 1, 0), getPixel(ruby, 1, 0));
  assert.notDeepEqual(getPixel(partial, 0, 0), getPixel(ruby, 0, 0));
});

test('palette extraction', () => {
  const img = createImage(4, 4, [255, 0, 0, 255]);
  setPixel(img, 0, 0, [0, 0, 255, 255]);
  setPixel(img, 1, 0, [0, 0, 0, 0]);
  setPixel(img, 2, 0, [128, 128, 128, 255]);
  const unsorted = extractPalette(img, 64, false);
  assert.deepEqual(unsorted[0], [255, 0, 0, 255], 'most frequent first');
  assert.equal(unsorted.length, 3, 'transparent excluded');
  const sorted = extractPalette(img);
  assert.deepEqual(sorted[0], [128, 128, 128, 255], 'greys first');
  assert.equal(extractPalette(img, 1).length, 1);
});

test('flood fill contiguous / global / tolerance / area', () => {
  // two separate white regions split by a black column
  const img = createImage(5, 3, [255, 255, 255, 255]);
  for (let y = 0; y < 3; y++) setPixel(img, 2, y, [0, 0, 0, 255]);
  const a = { ...img, data: new Uint8ClampedArray(img.data) };
  assert.equal(floodFill(a, 0, 0, [255, 0, 0, 255]), 6);
  assert.deepEqual(getPixel(a, 4, 0), [255, 255, 255, 255]);
  const b = { ...img, data: new Uint8ClampedArray(img.data) };
  assert.equal(floodFill(b, 0, 0, [255, 0, 0, 255], { contiguous: false }), 12);
  const c = { ...img, data: new Uint8ClampedArray(img.data) };
  setPixel(c, 1, 1, [250, 250, 250, 255]);
  assert.equal(floodFill(c, 0, 0, [1, 2, 3, 255]), 5, 'near-white excluded without tolerance');
  const d = { ...img, data: new Uint8ClampedArray(img.data) };
  setPixel(d, 1, 1, [250, 250, 250, 255]);
  assert.equal(floodFill(d, 0, 0, [1, 2, 3, 255], { tolerance: 10 }), 6);
  const e = { ...img, data: new Uint8ClampedArray(img.data) };
  assert.equal(floodFill(e, 0, 0, [1, 2, 3, 255], { area: { x: 0, y: 0, w: 5, h: 1 } }), 2, 'limited to area');
  assert.equal(floodFill(e, 0, 0, [1, 2, 3, 255]), 0, 'same colour: no-op');
});

test('geometry helpers', () => {
  assert.deepEqual(linePoints(0, 0, 3, 1), [[0, 0], [1, 0], [2, 1], [3, 1]]);
  assert.equal(rectPoints({ x: 0, y: 0, w: 3, h: 3 }, false).length, 8);
  assert.equal(rectPoints({ x: 0, y: 0, w: 3, h: 3 }, true).length, 9);
  assert.deepEqual(mirrorPoints(1, 2, { x: 0, y: 0, w: 16, h: 16 }, true, false), [[1, 2], [14, 2]]);
  assert.equal(mirrorPoints(1, 2, { x: 0, y: 16, w: 16, h: 16 }, true, true).length, 4);
  assert.equal(mirrorPoints(7, 7, { x: 0, y: 0, w: 15, h: 15 }, true, true).length, 1, 'centre deduplicated');

  const img = sample(4, 3);
  assert.ok(imagesEqual(flipHorizontal(flipHorizontal(img)), img));
  const r = rotate90(img);
  assert.equal(r.width, 3);
  assert.deepEqual(getPixel(r, 2, 0), getPixel(img, 0, 0));
  assert.ok(imagesEqual(rotate90(rotate90(rotate90(rotate90(img)))), img));
  assert.ok(imagesEqual(rotate90(rotate90(img, true), false), img));
  const big = scaleNearest(img, 8, 6);
  assert.deepEqual(getPixel(big, 7, 5), getPixel(img, 3, 2));
  assert.ok(imagesEqual(scaleNearest(big, 4, 3), img));
  const canvas = resizeCanvas(img, 6, 5);
  assert.deepEqual(getPixel(canvas, 1, 1), getPixel(img, 0, 0));
  assert.deepEqual(getPixel(canvas, 0, 0), [0, 0, 0, 0]);
  assert.ok(imagesEqual(crop(canvas, { x: 1, y: 1, w: 4, h: 3 }), img));
});

test('frames and warnings', () => {
  assert.deepEqual(frameLayout(16, 64), { frameWidth: 16, frameHeight: 16, count: 4 });
  assert.deepEqual(frameLayout(16, 16), { frameWidth: 16, frameHeight: 16, count: 1 });
  assert.deepEqual(frameLayout(16, 20), { frameWidth: 16, frameHeight: 20, count: 1 });
  assert.deepEqual(frameLayout(32, 64, 32, 16), { frameWidth: 32, frameHeight: 16, count: 4 });
  const strip = sample(2, 6);
  const frames = splitFrames(strip, frameLayout(2, 6));
  assert.equal(frames.length, 3);
  assert.ok(imagesEqual(joinFrames(frames), strip));

  assert.deepEqual(textureWarnings(16, 16, false, 'block'), []);
  assert.deepEqual(textureWarnings(16, 64, false, 'block'), ['missing-mcmeta']);
  assert.deepEqual(textureWarnings(16, 64, true, 'block'), []);
  assert.deepEqual(textureWarnings(15, 15, false, 'item'), ['not-power-of-two']);
  assert.deepEqual(textureWarnings(16, 20, false, 'item'), ['not-square']);
  assert.deepEqual(textureWarnings(256, 128, false, 'gui'), []);
});

test('base64 + wire images', () => {
  for (const n of [0, 1, 2, 3, 4, 5, 100]) {
    const bytes = new Uint8Array(n).map((_, i) => (i * 37) & 255);
    const b64 = bytesToBase64(bytes);
    assert.equal(b64, Buffer.from(bytes).toString('base64'));
    assert.deepEqual([...base64ToBytes(b64)], [...bytes]);
  }
  const img = sample();
  assert.ok(imagesEqual(fromWire(toWire(img)), img));
});

test('mcmeta animation', () => {
  const a = parseAnimation({ animation: { frametime: 300, interpolate: true, frames: [0, { index: 2, time: 5 }, 9] } })!;
  assert.equal(a.frametime, 300);
  assert.equal(a.interpolate, true);
  const tl = animationTimeline(a, 3);
  assert.deepEqual(tl, [{ frame: 0, ticks: 300 }, { frame: 2, ticks: 5 }], 'invalid frame index dropped');
  assert.equal(animationLength(a, 3), 305);
  assert.deepEqual(stepAt(tl, 302), { step: 1, progress: 0.4 });
  assert.deepEqual(stepAt(tl, 305), { step: 0, progress: 0 });
  assert.equal(parseAnimation({}), undefined);
  assert.deepEqual(animationTimeline(parseAnimation({ animation: {} }), 2), [{ frame: 0, ticks: 1 }, { frame: 1, ticks: 1 }]);

  const written = writeAnimation({ villager: { hat: 'full' }, animation: { foo: 1 } }, { frametime: 2, interpolate: false, frames: [{ index: 1 }, { index: 0, time: 4 }] });
  assert.deepEqual(written, { villager: { hat: 'full' }, animation: { foo: 1, frametime: 2, frames: [1, { index: 0, time: 4 }] } });
  assert.deepEqual(writeAnimation(undefined, { frametime: 1, interpolate: false }), { animation: {} });

  assert.deepEqual(parseFrameList('0, 1 2:10'), [{ index: 0 }, { index: 1 }, { index: 2, time: 10 }]);
  assert.equal(parseFrameList('  '), undefined);
  assert.throws(() => parseFrameList('a'));
  assert.equal(formatFrameList([{ index: 0 }, { index: 2, time: 10 }]), '0, 2:10');
  assert.deepEqual(framesAfterRemoval([{ index: 0 }, { index: 1 }, { index: 2 }], 1), [{ index: 0 }, { index: 1 }]);
});

test('texture ids and variants', () => {
  assert.ok(isTextureIdCandidate('block/stone'));
  assert.ok(isTextureIdCandidate('mymod:item/ruby'));
  assert.ok(!isTextureIdCandidate('stone'));
  assert.ok(!isTextureIdCandidate('#minecraft:logs'));
  assert.ok(!isTextureIdCandidate('Hello world/foo'));
  assert.ok(!isTextureIdCandidate('assets/x/models/a.json'));
  assert.equal(normalizeTextureId('block/x'), 'minecraft:block/x');
  assert.ok(isModelTexturePath(['textures', 'all']));
  assert.ok(isModelTexturePath(['textures', 'all', 'sprite']));
  assert.ok(!isModelTexturePath(['parent']));

  assert.equal(renameVariant('item/ruby_sword', 'ruby', 'sapphire'), 'item/sapphire_sword');
  assert.equal(renameVariant('block/deepslate_ruby_ore', 'ruby', 'sapphire'), 'block/deepslate_sapphire_ore');
  assert.equal(renameVariant('item/rubyish', 'ruby', 'sapphire'), 'item/sapphireish');
  assert.equal(renameVariant('item/sword', 'ruby', 'sapphire'), 'item/sapphire_sword');
  assert.equal(guessMaterial(['item/ruby_sword', 'item/ruby_pickaxe', 'item/ruby']), 'ruby');
});
