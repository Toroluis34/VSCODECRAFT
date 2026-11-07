// Minimal, dependency-free PNG decoder / encoder (zlib from node). No 'vscode' import: unit tested.
//
// Decoder: every colour type (grey, RGB, palette, grey+alpha, RGBA), bit depths 1/2/4/8/16, tRNS
// transparency and Adam7 interlacing. Output is always 8-bit RGBA (non-premultiplied).
// Encoder: 8-bit RGBA (or RGB when fully opaque) with per-row adaptive filtering.
import * as zlib from 'node:zlib';
import type { RgbaImage } from './pixels';

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

// ---------- CRC32 ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array, start = 0, end = bytes.length): number {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function isPng(bytes: Uint8Array): boolean {
  return bytes.length >= 8 && SIGNATURE.every((b, i) => bytes[i] === b);
}

/** Width/height from the IHDR chunk without decoding the image. */
export function readPngSize(bytes: Uint8Array): { width: number; height: number } | undefined {
  if (!isPng(bytes) || bytes.length < 24) return undefined;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: dv.getUint32(16), height: dv.getUint32(20) };
}

interface Header {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  interlace: number;
}

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/** Decode a PNG into 8-bit RGBA. Throws on malformed data. */
export function decodePng(bytes: Uint8Array): RgbaImage {
  if (!isPng(bytes)) throw new Error('Not a PNG file');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 8;
  let header: Header | undefined;
  let palette: Uint8Array | undefined;
  let trns: Uint8Array | undefined;
  const idat: Uint8Array[] = [];
  while (pos + 8 <= bytes.length) {
    const len = dv.getUint32(pos);
    const type = String.fromCharCode(bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7]);
    const data = bytes.subarray(pos + 8, pos + 8 + len);
    pos += 12 + len;
    if (type === 'IHDR') {
      header = {
        width: dv.getUint32(data.byteOffset - bytes.byteOffset),
        height: dv.getUint32(data.byteOffset - bytes.byteOffset + 4),
        bitDepth: data[8],
        colorType: data[9],
        interlace: data[12],
      };
    } else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
  }
  if (!header) throw new Error('PNG without IHDR');
  const { width, height, bitDepth, colorType } = header;
  const channels = CHANNELS[colorType];
  if (!channels) throw new Error(`Unsupported PNG colour type ${colorType}`);
  if (![1, 2, 4, 8, 16].includes(bitDepth)) throw new Error(`Unsupported PNG bit depth ${bitDepth}`);
  if (colorType === 3 && !palette) throw new Error('Palette PNG without PLTE');
  const raw = new Uint8Array(zlib.inflateSync(concat(idat)));
  const out = new Uint8ClampedArray(width * height * 4);
  const bpp = Math.max(1, (channels * bitDepth) >> 3); // bytes per complete pixel (for filtering)

  const decodePass = (offset: number, pw: number, ph: number, put: (x: number, y: number, r: number, g: number, b: number, a: number) => void): number => {
    if (!pw || !ph) return offset;
    const stride = Math.ceil((pw * channels * bitDepth) / 8);
    let prev = new Uint8Array(stride);
    let cur = new Uint8Array(stride);
    for (let y = 0; y < ph; y++) {
      const filter = raw[offset++];
      cur.set(raw.subarray(offset, offset + stride));
      offset += stride;
      unfilter(filter, cur, prev, bpp);
      for (let x = 0; x < pw; x++) {
        const px = readPixel(cur, x, channels, bitDepth, colorType, palette, trns);
        put(x, y, px[0], px[1], px[2], px[3]);
      }
      const t = prev;
      prev = cur;
      cur = t;
    }
    return offset;
  };

  const set = (x: number, y: number, r: number, g: number, b: number, a: number) => {
    const i = (y * width + x) * 4;
    out[i] = r;
    out[i + 1] = g;
    out[i + 2] = b;
    out[i + 3] = a;
  };

  if (header.interlace === 1) {
    const passes = [
      [0, 0, 8, 8],
      [4, 0, 8, 8],
      [0, 4, 4, 8],
      [2, 0, 4, 4],
      [0, 2, 2, 4],
      [1, 0, 2, 2],
      [0, 1, 1, 2],
    ];
    let off = 0;
    for (const [x0, y0, dx, dy] of passes) {
      const pw = Math.ceil((width - x0) / dx);
      const ph = Math.ceil((height - y0) / dy);
      off = decodePass(off, width > x0 ? pw : 0, height > y0 ? ph : 0, (x, y, r, g, b, a) => set(x0 + x * dx, y0 + y * dy, r, g, b, a));
    }
  } else {
    decodePass(0, width, height, set);
  }
  return { width, height, data: out };
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function unfilter(filter: number, cur: Uint8Array, prev: Uint8Array, bpp: number): void {
  const n = cur.length;
  switch (filter) {
    case 0:
      return;
    case 1:
      for (let i = bpp; i < n; i++) cur[i] = (cur[i] + cur[i - bpp]) & 0xff;
      return;
    case 2:
      for (let i = 0; i < n; i++) cur[i] = (cur[i] + prev[i]) & 0xff;
      return;
    case 3:
      for (let i = 0; i < n; i++) cur[i] = (cur[i] + (((i >= bpp ? cur[i - bpp] : 0) + prev[i]) >> 1)) & 0xff;
      return;
    case 4:
      for (let i = 0; i < n; i++) cur[i] = (cur[i] + paeth(i >= bpp ? cur[i - bpp] : 0, prev[i], i >= bpp ? prev[i - bpp] : 0)) & 0xff;
      return;
    default:
      throw new Error(`Bad PNG filter ${filter}`);
  }
}

function sample(row: Uint8Array, index: number, bitDepth: number): number {
  if (bitDepth === 8) return row[index];
  if (bitDepth === 16) return (row[index * 2] << 8) | row[index * 2 + 1];
  const perByte = 8 / bitDepth;
  const byte = row[Math.floor(index / perByte)];
  const shift = 8 - bitDepth * ((index % perByte) + 1);
  return (byte >> shift) & ((1 << bitDepth) - 1);
}

function readPixel(
  row: Uint8Array,
  x: number,
  channels: number,
  bitDepth: number,
  colorType: number,
  palette?: Uint8Array,
  trns?: Uint8Array,
): [number, number, number, number] {
  const max = (1 << bitDepth) - 1;
  const to8 = (v: number) => (bitDepth === 8 ? v : bitDepth === 16 ? v >> 8 : Math.round((v * 255) / max));
  const s = (c: number) => sample(row, x * channels + c, bitDepth);
  switch (colorType) {
    case 0: {
      const v = s(0);
      const transparent = trns && trns.length >= 2 && ((trns[0] << 8) | trns[1]) === v;
      const g = to8(v);
      return [g, g, g, transparent ? 0 : 255];
    }
    case 2: {
      const r = s(0), g = s(1), b = s(2);
      let a = 255;
      if (trns && trns.length >= 6) {
        const tr = (trns[0] << 8) | trns[1], tg = (trns[2] << 8) | trns[3], tb = (trns[4] << 8) | trns[5];
        if (r === tr && g === tg && b === tb) a = 0;
      }
      return [to8(r), to8(g), to8(b), a];
    }
    case 3: {
      const i = s(0);
      return [palette![i * 3] ?? 0, palette![i * 3 + 1] ?? 0, palette![i * 3 + 2] ?? 0, trns && i < trns.length ? trns[i] : 255];
    }
    case 4: {
      const g = to8(s(0));
      return [g, g, g, to8(s(1))];
    }
    default:
      return [to8(s(0)), to8(s(1)), to8(s(2)), to8(s(3))];
  }
}

// ---------- encoder ----------

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out, 4, 8 + data.length));
  return out;
}

/** Encode RGBA pixels as a PNG (8-bit RGBA, or RGB when every pixel is opaque). */
export function encodePng(img: RgbaImage, opts: { level?: number } = {}): Uint8Array {
  const { width, height, data } = img;
  if (data.length < width * height * 4) throw new Error('Pixel buffer too small');
  let opaque = true;
  for (let i = 3; i < width * height * 4; i += 4) {
    if (data[i] !== 255) {
      opaque = false;
      break;
    }
  }
  const channels = opaque ? 3 : 4;
  const stride = width * channels;
  const raw = new Uint8Array((stride + 1) * height);
  let prev = new Uint8Array(stride);
  let cur = new Uint8Array(stride);
  const candidates = [0, 1, 2, 3, 4].map(() => new Uint8Array(stride));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const s = (y * width + x) * 4;
      const d = x * channels;
      cur[d] = data[s];
      cur[d + 1] = data[s + 1];
      cur[d + 2] = data[s + 2];
      if (channels === 4) cur[d + 3] = data[s + 3];
    }
    // Adaptive filtering: pick the filter with the smallest sum of absolute values.
    let best = 0;
    let bestScore = Infinity;
    for (let f = 0; f < 5; f++) {
      const c = candidates[f];
      let score = 0;
      for (let i = 0; i < stride; i++) {
        const a = i >= channels ? cur[i - channels] : 0;
        const b = prev[i];
        const cc = i >= channels ? prev[i - channels] : 0;
        const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : paeth(a, b, cc);
        const v = (cur[i] - pred) & 0xff;
        c[i] = v;
        score += v < 128 ? v : 256 - v;
      }
      if (score < bestScore) {
        bestScore = score;
        best = f;
      }
    }
    const o = y * (stride + 1);
    raw[o] = best;
    raw.set(candidates[best], o + 1);
    const t = prev;
    prev = cur;
    cur = t;
  }
  const ihdr = new Uint8Array(13);
  const hv = new DataView(ihdr.buffer);
  hv.setUint32(0, width);
  hv.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = opaque ? 2 : 6;
  const idat = new Uint8Array(zlib.deflateSync(raw, { level: opts.level ?? 9 }));
  return concat([new Uint8Array(SIGNATURE), chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0))]);
}
