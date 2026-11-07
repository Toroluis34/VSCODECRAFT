// Minimal PNG encoder/decoder + tiny pixel-art helpers. Pure (node:zlib only, no 'vscode').
import * as zlib from 'node:zlib';

export interface Image {
  width: number;
  height: number;
  /** RGBA, row-major, 4 bytes per pixel. */
  data: Uint8Array;
}

const SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

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

function chunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc32(out, 4, 8 + data.length), 8 + data.length);
  return out;
}

/** Encode an RGBA image as PNG (8-bit RGBA, filter 0). */
export function encodePng(img: Image): Uint8Array {
  const { width, height, data } = img;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    Buffer.from(data.buffer, data.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return new Uint8Array(Buffer.concat([Buffer.from(SIGNATURE), chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0))]));
}

/** Decode a non-interlaced 8-bit PNG (gray, RGB, palette, gray+alpha, RGBA) into RGBA. */
export function decodePng(bytes: Uint8Array): Image {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < 8; i++) if (buf[i] !== SIGNATURE[i]) throw new Error('Not a PNG file');
  let pos = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let colorType = 0;
  let interlace = 0;
  let palette: Buffer | undefined;
  let trns: Buffer | undefined;
  const idat: Buffer[] = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const body = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      depth = body[8];
      colorType = body[9];
      interlace = body[12];
    } else if (type === 'PLTE') palette = body;
    else if (type === 'tRNS') trns = body;
    else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (interlace) throw new Error('Interlaced PNG not supported');
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[colorType];
  if (!channels) throw new Error(`Unsupported PNG color type ${colorType}`);
  if (depth !== 8 && !(colorType === 3 && depth <= 8) && !(colorType === 0 && depth <= 8)) throw new Error(`Unsupported PNG bit depth ${depth}`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bitsPerPixel = channels * depth;
  const bpp = Math.max(1, bitsPerPixel >> 3);
  const stride = Math.ceil((width * bitsPerPixel) / 8);
  const lines = Buffer.alloc(stride * height);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = lines.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = v & 0xff;
    }
    prev = cur;
  }
  const out = new Uint8Array(width * height * 4);
  const sample = (row: Buffer, i: number): number => {
    if (depth === 8) return row[i];
    const bitPos = i * depth;
    const byte = row[bitPos >> 3];
    const shift = 8 - depth - (bitPos & 7);
    return (byte >> shift) & ((1 << depth) - 1);
  };
  for (let y = 0; y < height; y++) {
    const row = lines.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (colorType === 6) {
        out.set(row.subarray(x * 4, x * 4 + 4), o);
      } else if (colorType === 2) {
        out[o] = row[x * 3];
        out[o + 1] = row[x * 3 + 1];
        out[o + 2] = row[x * 3 + 2];
        out[o + 3] = 255;
      } else if (colorType === 4) {
        out[o] = out[o + 1] = out[o + 2] = row[x * 2];
        out[o + 3] = row[x * 2 + 1];
      } else if (colorType === 0) {
        const g = depth === 8 ? row[x] : Math.round((sample(row, x) * 255) / ((1 << depth) - 1));
        out[o] = out[o + 1] = out[o + 2] = g;
        out[o + 3] = 255;
      } else {
        const idx = sample(row, x);
        out[o] = palette?.[idx * 3] ?? 0;
        out[o + 1] = palette?.[idx * 3 + 1] ?? 0;
        out[o + 2] = palette?.[idx * 3 + 2] ?? 0;
        out[o + 3] = trns && idx < trns.length ? trns[idx] : 255;
      }
    }
  }
  return { width, height, data: out };
}

/** Copy a sub-rectangle (clamped) of an image. */
export function crop(img: Image, x: number, y: number, w: number, h: number): Image {
  const out = new Uint8Array(w * h * 4);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const sx = x + i;
      const sy = y + j;
      if (sx < 0 || sy < 0 || sx >= img.width || sy >= img.height) continue;
      const s = (sy * img.width + sx) * 4;
      out.set(img.data.subarray(s, s + 4), (j * w + i) * 4);
    }
  }
  return { width: w, height: h, data: out };
}

/** Nearest-neighbour upscale by an integer factor. */
export function scale(img: Image, factor: number): Image {
  const w = img.width * factor;
  const h = img.height * factor;
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = (Math.floor(y / factor) * img.width + Math.floor(x / factor)) * 4;
      out.set(img.data.subarray(s, s + 4), (y * w + x) * 4);
    }
  }
  return { width: w, height: h, data: out };
}

/** "#rrggbb" or "#rrggbbaa" -> [r,g,b,a] */
export function hexColor(hex: string): [number, number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), h.length >= 8 ? parseInt(h.slice(6, 8), 16) : 255];
}

/**
 * Build an image from ASCII art rows: each character maps to a colour in `palette` ('.' / ' ' = transparent).
 */
export function fromPixelArt(rows: string[], palette: Record<string, string>): Image {
  const height = rows.length;
  const width = Math.max(...rows.map((r) => r.length));
  const data = new Uint8Array(width * height * 4);
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = palette[row[x]];
      if (!c) continue;
      data.set(hexColor(c), (y * width + x) * 4);
    }
  });
  return { width, height, data };
}

/** Deterministic pseudo random generator (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function shade([r, g, b]: number[], f: number): [number, number, number, number] {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
  return [c(r), c(g), c(b), 255];
}

/**
 * 16x16 "grass block side" style pack icon, tinted by a seed (pack name) so packs look distinct.
 * kind 'data' → grass/dirt; 'resource' → painted/colourful stone.
 */
export function packIcon(kind: 'data' | 'resource', seed = 'pack', size = 64): Image {
  const rand = rng(hashString(seed + kind));
  const img: Image = { width: 16, height: 16, data: new Uint8Array(16 * 16 * 4) };
  const set = (x: number, y: number, c: number[]) => img.data.set(c, (y * 16 + x) * 4);
  if (kind === 'data') {
    const grass = [93, 160, 58];
    const dirt = [134, 96, 67];
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const edge = 3 + Math.floor(rand() * 2.2);
        const base = y < edge ? grass : dirt;
        set(x, y, shade(base, 0.82 + rand() * 0.3));
      }
    }
  } else {
    const hue = hashString(seed) % 360;
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const h = (hue + (x + y) * 6) % 360;
        const [r, g, b] = hslToRgb(h / 360, 0.55, 0.45 + rand() * 0.15);
        set(x, y, [r, g, b, 255]);
      }
    }
  }
  // dark frame
  for (let i = 0; i < 16; i++) {
    for (const [x, y] of [
      [i, 0],
      [i, 15],
      [0, i],
      [15, i],
    ]) {
      const o = (y * 16 + x) * 4;
      set(x, y, shade([img.data[o], img.data[o + 1], img.data[o + 2]], 0.7));
    }
  }
  return scale(img, Math.max(1, Math.floor(size / 16)));
}

/** A 16x16 placeholder texture (checker pattern in a colour derived from the id). */
export function placeholderTexture(id: string, block = false): Image {
  const hue = hashString(id) % 360;
  const rand = rng(hashString(id));
  const img: Image = { width: 16, height: 16, data: new Uint8Array(16 * 16 * 4) };
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const inGem = block || (Math.abs(x - 7.5) + Math.abs(y - 7.5) < 7);
      if (!inGem) continue;
      const l = 0.35 + ((x + y) % 4 === 0 ? 0.15 : 0) + rand() * 0.1 + (block && (x === 0 || y === 0 || x === 15 || y === 15) ? -0.12 : 0);
      const [r, g, b] = hslToRgb(hue / 360, 0.6, l);
      img.data.set([r, g, b, 255], (y * 16 + x) * 4);
    }
  }
  return img;
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h * 12) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}
