// Tiny PNG encoder + placeholder texture generator (Node zlib, no 'vscode' import — unit tested).
import { deflateSync } from 'node:zlib';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), Buffer.from(data)]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** Encode RGBA pixels (width*height*4 bytes) as a PNG file. */
export function encodePng(width: number, height: number, rgba: Uint8Array): Uint8Array {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  }
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return new Uint8Array(Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array(0))]));
}

/** Deterministic hash of a string (FNV-1a). */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Pleasant default colour for an id. */
export function colorForId(id: string): string {
  const h = hashString(id) % 360;
  return hslToHex(h, 0.55, 0.5);
}

export function hslToHex(h: number, s: number, l: number): string {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return `#${[f(0), f(8), f(4)].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('')}`;
}

function parseHex(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1], 16) : 0x9c6bd4;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * 16x16 placeholder texture (RGBA):
 *  - block: noisy fill with a bevelled border
 *  - item: a gem shape with outline and highlight on a transparent background
 *  - cross: a small plant
 */
export function placeholderPixels(kind: 'item' | 'block' | 'cross', color: string, seed = 'x'): Uint8Array {
  const size = 16;
  const px = new Uint8Array(size * size * 4);
  const [r, g, b] = parseHex(color);
  let rnd = hashString(seed) || 1;
  const random = () => {
    rnd ^= rnd << 13;
    rnd ^= rnd >>> 17;
    rnd ^= rnd << 5;
    return ((rnd >>> 0) % 1000) / 1000;
  };
  const set = (x: number, y: number, f: number, a = 255) => {
    const i = (y * size + x) * 4;
    px[i] = Math.max(0, Math.min(255, Math.round(r * f)));
    px[i + 1] = Math.max(0, Math.min(255, Math.round(g * f)));
    px[i + 2] = Math.max(0, Math.min(255, Math.round(b * f)));
    px[i + 3] = a;
  };
  if (kind === 'block') {
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        let f = 0.9 + random() * 0.2;
        if (x === 0 || y === 0) f = 1.25;
        else if (x === size - 1 || y === size - 1) f = 0.65;
        set(x, y, f);
      }
    return px;
  }
  if (kind === 'cross') {
    // stem + leaves
    for (let y = 6; y < 16; y++) set(7 + (y % 3 === 0 ? 1 : 0), y, 0.7);
    const leaves: [number, number][] = [[5, 4], [6, 3], [7, 2], [8, 3], [9, 4], [4, 7], [5, 6], [10, 6], [11, 7], [6, 9], [9, 9], [5, 10], [10, 10], [7, 5], [8, 5], [7, 1]];
    for (const [x, y] of leaves) set(x, y, 0.9 + random() * 0.3);
    return px;
  }
  // gem
  for (let y = 2; y < 14; y++)
    for (let x = 2; x < 14; x++) {
      const d = Math.abs(x - 7.5) + Math.abs(y - 7.5);
      if (d > 6.5) continue;
      let f = 1;
      if (d > 5.5) f = 0.45;
      else if (x + y < 13) f = 1.25;
      else if (x + y > 17) f = 0.8;
      set(x, y, f);
    }
  set(6, 5, 1.8);
  set(5, 6, 1.6);
  return px;
}

export function placeholderPng(kind: 'item' | 'block' | 'cross', color: string, seed?: string): Uint8Array {
  return encodePng(16, 16, placeholderPixels(kind, color, seed));
}

export function pngDataUri(bytes: Uint8Array): string {
  return `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`;
}
