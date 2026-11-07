// Pure pixel / colour operations shared by the extension host and the texture webviews.
// No 'vscode', Node or DOM imports: this file is bundled into webviews and unit tested.

/** Non-premultiplied 8-bit RGBA image. */
export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}

/** [r, g, b, a] each 0..255 */
export type Rgba = [number, number, number, number];

export function createImage(width: number, height: number, fill?: Rgba): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  if (fill && fill[3] !== 0) for (let i = 0; i < data.length; i += 4) data.set(fill, i);
  return { width, height, data };
}

export function cloneImage(img: RgbaImage): RgbaImage {
  return { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) };
}

export function getPixel(img: RgbaImage, x: number, y: number): Rgba {
  const i = (y * img.width + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
}

export function setPixel(img: RgbaImage, x: number, y: number, c: Rgba): void {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  const i = (y * img.width + x) * 4;
  img.data[i] = c[0];
  img.data[i + 1] = c[1];
  img.data[i + 2] = c[2];
  img.data[i + 3] = c[3];
}

export function imagesEqual(a: RgbaImage, b: RgbaImage): boolean {
  if (a.width !== b.width || a.height !== b.height) return false;
  for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) return false;
  return true;
}

// ---------- colours ----------

export function rgbaToHex(c: Rgba, withAlpha = c[3] !== 255): string {
  const h = (n: number) => Math.round(n).toString(16).padStart(2, '0');
  return `#${h(c[0])}${h(c[1])}${h(c[2])}${withAlpha ? h(c[3]) : ''}`;
}

/** "#rgb", "#rgba", "#rrggbb", "#rrggbbaa" (with or without #). */
export function hexToRgba(hex: string): Rgba | undefined {
  let s = hex.trim().replace(/^#/, '');
  if (!/^[0-9a-f]+$/i.test(s)) return undefined;
  if (s.length === 3 || s.length === 4) s = s.split('').map((ch) => ch + ch).join('');
  if (s.length === 6) s += 'ff';
  if (s.length !== 8) return undefined;
  return [0, 2, 4, 6].map((i) => parseInt(s.slice(i, i + 2), 16)) as Rgba;
}

/** RGB 0..255 → HSV with h 0..360, s/v 0..1. */
export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max === 0 ? 0 : d / max, max];
}

export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  h = ((h % 360) + 360) % 360;
  s = clamp01(s);
  v = clamp01(v);
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

/** RGB 0..255 → HSL with h 0..360, s/l 0..1. */
export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return [h, s, l];
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360;
  s = clamp01(s);
  l = clamp01(l);
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export interface ColorAdjust {
  /** Hue rotation in degrees (-180..180). */
  hue?: number;
  /** Saturation change in percent (-100..100): -100 = grey, +100 = double. */
  saturation?: number;
  /** Brightness change in percent (-100..100): -100 = black, +100 = white-ish. */
  brightness?: number;
  /** Contrast change in percent (-100..100). */
  contrast?: number;
  /**
   * Colorize: replace every hue by this one (0..360) keeping lightness — great for material variants
   * where the source has several hues. `hue` is ignored when set.
   */
  colorize?: number;
  /**
   * Only change colours whose hue is within `tolerance` degrees of `hue` (greys excluded) — keeps wooden
   * handles, outlines and other materials intact when recolouring tools/armor.
   */
  mask?: { hue: number; tolerance: number };
}

function hueDistance(a: number, b: number): number {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return d > 180 ? 360 - d : d;
}

export function isIdentityAdjust(a: ColorAdjust): boolean {
  return !a.hue && !a.saturation && !a.brightness && !a.contrast && a.colorize === undefined;
}

/** Adjust one colour (alpha untouched). */
export function adjustColor(c: Rgba, a: ColorAdjust): Rgba {
  let [h, s, v] = rgbToHsv(c[0], c[1], c[2]);
  if (a.mask && (s < 0.12 || v < 0.06 || hueDistance(h, a.mask.hue) > a.mask.tolerance)) return [c[0], c[1], c[2], c[3]];
  if (a.colorize !== undefined) {
    h = a.colorize;
    if (s < 0.15) s = Math.max(s, 0.35 * (1 - Math.abs(v - 0.5)));
  } else if (a.hue) h += a.hue;
  // Multiplicative so greys stay grey; +100 doubles the saturation, -100 removes it.
  if (a.saturation) s = s * (1 + a.saturation / 100);
  if (a.brightness) v = a.brightness > 0 ? v + (1 - v) * (a.brightness / 100) : v * (1 + a.brightness / 100);
  let [r, g, b] = hsvToRgb(h, clamp01(s), clamp01(v));
  if (a.brightness && a.brightness > 0 && v >= 1) {
    // Push towards white once value is maxed so +100 really brightens.
    const t = (a.brightness / 100) * 0.5;
    r = Math.round(r + (255 - r) * t);
    g = Math.round(g + (255 - g) * t);
    b = Math.round(b + (255 - b) * t);
  }
  if (a.contrast) {
    const f = 1 + a.contrast / 100;
    const ct = (x: number) => Math.max(0, Math.min(255, Math.round((x - 128) * f + 128)));
    r = ct(r);
    g = ct(g);
    b = ct(b);
  }
  return [r, g, b, c[3]];
}

/** Apply a colour adjustment to every pixel (or only inside `rect`), returning a new image. */
export function adjustImage(img: RgbaImage, adj: ColorAdjust, rect?: Rect): RgbaImage {
  const out = cloneImage(img);
  if (isIdentityAdjust(adj)) return out;
  const cache = new Map<number, Rgba>();
  const r = rect ? clipRect(rect, img.width, img.height) : { x: 0, y: 0, w: img.width, h: img.height };
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      const i = (y * img.width + x) * 4;
      if (img.data[i + 3] === 0) continue;
      const key = (img.data[i] << 16) | (img.data[i + 1] << 8) | img.data[i + 2];
      let c = cache.get(key);
      if (!c) {
        c = adjustColor([img.data[i], img.data[i + 1], img.data[i + 2], 255], adj);
        cache.set(key, c);
      }
      out.data[i] = c[0];
      out.data[i + 1] = c[1];
      out.data[i + 2] = c[2];
    }
  }
  return out;
}

/** Hue-shift a whole image (material variants: ruby → sapphire). */
export function hueShift(img: RgbaImage, degrees: number): RgbaImage {
  return adjustImage(img, { hue: degrees });
}

/** Average hue (0..360) of the saturated, visible pixels — used to suggest hue shifts. Undefined when grey. */
export function dominantHue(img: RgbaImage): number | undefined {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let i = 0; i < img.data.length; i += 4) {
    if (img.data[i + 3] < 128) continue;
    const [h, s, v] = rgbToHsv(img.data[i], img.data[i + 1], img.data[i + 2]);
    if (s < 0.2 || v < 0.15) continue;
    const w = s * v;
    sx += Math.cos((h * Math.PI) / 180) * w;
    sy += Math.sin((h * Math.PI) / 180) * w;
    n += w;
  }
  if (n < 1e-6) return undefined;
  const h = (Math.atan2(sy, sx) * 180) / Math.PI;
  return (h + 360) % 360;
}

// ---------- palette ----------

/**
 * Distinct colours of an image ordered by frequency (most used first), ignoring fully transparent pixels.
 * When there are more than `max`, the least used are dropped. Result is sorted by hue then lightness when `sort`.
 */
export function extractPalette(img: RgbaImage, max = 64, sort = true): Rgba[] {
  const counts = new Map<number, number>();
  for (let i = 0; i < img.data.length; i += 4) {
    if (img.data[i + 3] === 0) continue;
    const key = ((img.data[i] << 24) | (img.data[i + 1] << 16) | (img.data[i + 2] << 8) | img.data[i + 3]) >>> 0;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let list = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, max).map(([k]) => keyToRgba(k));
  if (sort) list = sortColors(list);
  return list;
}

function keyToRgba(k: number): Rgba {
  return [(k >>> 24) & 255, (k >>> 16) & 255, (k >>> 8) & 255, k & 255];
}

/** Sort colours into hue bands (greys first), dark → light inside each band. */
export function sortColors(colors: Rgba[]): Rgba[] {
  const keyed = colors.map((c) => {
    const [h, s, l] = rgbToHsl(c[0], c[1], c[2]);
    const band = s < 0.12 ? -1 : Math.floor(((h + 15) % 360) / 30);
    return { c, band, l };
  });
  keyed.sort((a, b) => a.band - b.band || a.l - b.l);
  return keyed.map((k) => k.c);
}

// ---------- geometry ----------

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function clipRect(r: Rect, width: number, height: number): Rect {
  const x = Math.max(0, Math.min(width, r.x));
  const y = Math.max(0, Math.min(height, r.y));
  const x2 = Math.max(0, Math.min(width, r.x + r.w));
  const y2 = Math.max(0, Math.min(height, r.y + r.h));
  return { x, y, w: Math.max(0, x2 - x), h: Math.max(0, y2 - y) };
}

/** Normalised rectangle between two corner points (inclusive). */
export function rectFromPoints(x0: number, y0: number, x1: number, y1: number): Rect {
  return { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0) + 1, h: Math.abs(y1 - y0) + 1 };
}

/** Bresenham line points (inclusive). */
export function linePoints(x0: number, y0: number, x1: number, y1: number): [number, number][] {
  const pts: [number, number][] = [];
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  for (let guard = 0; guard < 100000; guard++) {
    pts.push([x, y]);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
  return pts;
}

/** Outline (or filled) rectangle points. */
export function rectPoints(r: Rect, filled: boolean): [number, number][] {
  const pts: [number, number][] = [];
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      if (filled || y === r.y || y === r.y + r.h - 1 || x === r.x || x === r.x + r.w - 1) pts.push([x, y]);
    }
  }
  return pts;
}

/**
 * Mirror a point inside an area (e.g. the current animation frame).
 * Returns the original point plus its mirrors (deduplicated).
 */
export function mirrorPoints(x: number, y: number, area: Rect, mirrorX: boolean, mirrorY: boolean): [number, number][] {
  const mx = area.x + area.w - 1 - (x - area.x);
  const my = area.y + area.h - 1 - (y - area.y);
  const out: [number, number][] = [[x, y]];
  if (mirrorX) out.push([mx, y]);
  if (mirrorY) out.push([x, my]);
  if (mirrorX && mirrorY) out.push([mx, my]);
  const seen = new Set<string>();
  return out.filter(([a, b]) => {
    const k = `${a},${b}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ---------- painting ----------

/** Paint pixels (replace, no blending), limited to an optional clip area. */
export function paintPoints(img: RgbaImage, pts: [number, number][], c: Rgba, clip?: Rect): void {
  for (const [x, y] of pts) {
    if (clip && (x < clip.x || y < clip.y || x >= clip.x + clip.w || y >= clip.y + clip.h)) continue;
    setPixel(img, x, y, c);
  }
}

function colorDistance(d: RgbaImage['data'], i: number, c: Rgba): number {
  return Math.max(Math.abs(d[i] - c[0]), Math.abs(d[i + 1] - c[1]), Math.abs(d[i + 2] - c[2]), Math.abs(d[i + 3] - c[3]));
}

/**
 * Flood fill (in place). `contiguous` = 4-connected region from (x, y); otherwise every pixel with the
 * same colour inside `area`. `tolerance` 0..255 (max channel difference). Returns number of changed pixels.
 */
export function floodFill(
  img: RgbaImage,
  x: number,
  y: number,
  color: Rgba,
  opts: { contiguous?: boolean; tolerance?: number; area?: Rect } = {},
): number {
  const area = opts.area ? clipRect(opts.area, img.width, img.height) : { x: 0, y: 0, w: img.width, h: img.height };
  if (x < area.x || y < area.y || x >= area.x + area.w || y >= area.y + area.h) return 0;
  const tol = opts.tolerance ?? 0;
  const target = getPixel(img, x, y);
  if (tol === 0 && target.every((v, i) => v === color[i])) return 0;
  const W = img.width;
  const d = img.data;
  let changed = 0;
  const matches = (i: number) => colorDistance(d, i, target) <= tol;
  if (opts.contiguous === false) {
    const hits: number[] = [];
    for (let yy = area.y; yy < area.y + area.h; yy++)
      for (let xx = area.x; xx < area.x + area.w; xx++) {
        const i = (yy * W + xx) * 4;
        if (matches(i)) hits.push(i);
      }
    for (const i of hits) {
      d.set(color, i);
      changed++;
    }
    return changed;
  }
  const visited = new Uint8Array(img.width * img.height);
  const stack: number[] = [x, y];
  while (stack.length) {
    const py = stack.pop()!;
    const px = stack.pop()!;
    if (px < area.x || py < area.y || px >= area.x + area.w || py >= area.y + area.h) continue;
    const p = py * W + px;
    if (visited[p]) continue;
    visited[p] = 1;
    if (!matches(p * 4)) continue;
    d.set(color, p * 4);
    changed++;
    stack.push(px + 1, py, px - 1, py, px, py + 1, px, py - 1);
  }
  return changed;
}

/** Draw `src` onto `dst` at (dx, dy). `blend` = alpha-composite, otherwise replace (transparent pixels skipped when skipTransparent). */
export function blit(dst: RgbaImage, src: RgbaImage, dx: number, dy: number, mode: 'replace' | 'over' | 'skipTransparent' = 'replace', clip?: Rect): void {
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const tx = dx + x;
      const ty = dy + y;
      if (tx < 0 || ty < 0 || tx >= dst.width || ty >= dst.height) continue;
      if (clip && (tx < clip.x || ty < clip.y || tx >= clip.x + clip.w || ty >= clip.y + clip.h)) continue;
      const si = (y * src.width + x) * 4;
      const di = (ty * dst.width + tx) * 4;
      const sa = src.data[si + 3];
      if (mode === 'replace') {
        for (let k = 0; k < 4; k++) dst.data[di + k] = src.data[si + k];
      } else if (mode === 'skipTransparent') {
        if (sa) for (let k = 0; k < 4; k++) dst.data[di + k] = src.data[si + k];
      } else if (sa) {
        const da = dst.data[di + 3];
        const oa = sa + (da * (255 - sa)) / 255;
        for (let k = 0; k < 3; k++) {
          dst.data[di + k] = Math.round((src.data[si + k] * sa + (dst.data[di + k] * da * (255 - sa)) / 255) / oa);
        }
        dst.data[di + 3] = Math.round(oa);
      }
    }
  }
}

export function crop(img: RgbaImage, r: Rect): RgbaImage {
  const c = clipRect(r, img.width, img.height);
  const out = createImage(r.w, r.h);
  for (let y = 0; y < c.h; y++) {
    const s = ((c.y + y) * img.width + c.x) * 4;
    out.data.set(img.data.subarray(s, s + c.w * 4), ((c.y - r.y + y) * r.w + (c.x - r.x)) * 4);
  }
  return out;
}

/** Clear (make transparent) a rectangle in place. */
export function clearRect(img: RgbaImage, r: Rect): void {
  const c = clipRect(r, img.width, img.height);
  for (let y = c.y; y < c.y + c.h; y++) img.data.fill(0, (y * img.width + c.x) * 4, (y * img.width + c.x + c.w) * 4);
}

export function flipHorizontal(img: RgbaImage): RgbaImage {
  const out = createImage(img.width, img.height);
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++) setPixel(out, img.width - 1 - x, y, getPixel(img, x, y));
  return out;
}

export function flipVertical(img: RgbaImage): RgbaImage {
  const out = createImage(img.width, img.height);
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++) setPixel(out, x, img.height - 1 - y, getPixel(img, x, y));
  return out;
}

/** Rotate 90° clockwise (or counter-clockwise). Width and height swap. */
export function rotate90(img: RgbaImage, clockwise = true): RgbaImage {
  const out = createImage(img.height, img.width);
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++) {
      const nx = clockwise ? img.height - 1 - y : y;
      const ny = clockwise ? x : img.width - 1 - x;
      setPixel(out, nx, ny, getPixel(img, x, y));
    }
  return out;
}

/** Nearest-neighbour scaling (pixel-art friendly). */
export function scaleNearest(img: RgbaImage, width: number, height: number): RgbaImage {
  const out = createImage(width, height);
  for (let y = 0; y < height; y++) {
    const sy = Math.min(img.height - 1, Math.floor((y * img.height) / height));
    for (let x = 0; x < width; x++) {
      const sx = Math.min(img.width - 1, Math.floor((x * img.width) / width));
      const si = (sy * img.width + sx) * 4;
      const di = (y * width + x) * 4;
      out.data[di] = img.data[si];
      out.data[di + 1] = img.data[si + 1];
      out.data[di + 2] = img.data[si + 2];
      out.data[di + 3] = img.data[si + 3];
    }
  }
  return out;
}

export type Anchor = 'top-left' | 'center';

/** Change the canvas size without scaling (content anchored top-left or centred). */
export function resizeCanvas(img: RgbaImage, width: number, height: number, anchor: Anchor = 'center'): RgbaImage {
  const out = createImage(width, height);
  const dx = anchor === 'center' ? Math.floor((width - img.width) / 2) : 0;
  const dy = anchor === 'center' ? Math.floor((height - img.height) / 2) : 0;
  blit(out, img, dx, dy);
  return out;
}

// ---------- animation frames ----------

export interface FrameLayout {
  frameWidth: number;
  frameHeight: number;
  count: number;
}

/**
 * Frame layout of a (possibly animated) texture: frames are stacked vertically.
 * Defaults to square frames of the image width when the height is a multiple of it.
 */
export function frameLayout(width: number, height: number, frameW?: number, frameH?: number): FrameLayout {
  let fw = frameW && frameW > 0 ? Math.min(frameW, width) : width;
  let fh = frameH && frameH > 0 ? frameH : frameW && frameW > 0 ? frameW : width;
  if (fh <= 0 || height % fh !== 0) {
    fh = height;
    fw = width;
  }
  return { frameWidth: fw, frameHeight: fh, count: Math.max(1, Math.floor(height / fh)) };
}

export function frameRect(layout: FrameLayout, index: number): Rect {
  return { x: 0, y: index * layout.frameHeight, w: layout.frameWidth, h: layout.frameHeight };
}

export function splitFrames(img: RgbaImage, layout: FrameLayout): RgbaImage[] {
  return Array.from({ length: layout.count }, (_, i) => crop(img, frameRect(layout, i)));
}

/** Stack frames vertically into a strip (all frames must share the size of the first). */
export function joinFrames(frames: RgbaImage[]): RgbaImage {
  const w = frames[0]?.width ?? 16;
  const h = frames[0]?.height ?? 16;
  const out = createImage(w, h * frames.length);
  frames.forEach((f, i) => blit(out, f, 0, i * h));
  return out;
}

/** Apply a per-frame transform to every frame of a strip. */
export function mapFrames(img: RgbaImage, layout: FrameLayout, fn: (frame: RgbaImage, index: number) => RgbaImage): RgbaImage {
  return joinFrames(splitFrames(img, layout).map(fn));
}

// ---------- checks ----------

export function isPowerOfTwo(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0;
}

export type TextureWarning = 'not-power-of-two' | 'not-square' | 'missing-mcmeta' | 'bad-strip' | 'too-large';

/** Problems Minecraft (or mipmapping) would have with a texture of this size. */
export function textureWarnings(width: number, height: number, hasMcmeta: boolean, folder = ''): TextureWarning[] {
  const out: TextureWarning[] = [];
  const blockOrItem = /^(block|item)(\/|$)/.test(folder);
  if (!isPowerOfTwo(width)) out.push('not-power-of-two');
  if (height !== width && blockOrItem) {
    if (height % width === 0) {
      if (!hasMcmeta) out.push('missing-mcmeta');
    } else out.push(hasMcmeta ? 'bad-strip' : 'not-square');
  } else if (hasMcmeta && height % width !== 0) out.push('bad-strip');
  if (blockOrItem && width > 512) out.push('too-large');
  return out;
}

// ---------- base64 (works in browsers and Node without Buffer) ----------

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function bytesToBase64(bytes: Uint8Array | Uint8ClampedArray): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i] << 16;
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + '==';
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + '=';
  }
  return out;
}

const B64_LOOKUP = (() => {
  const t = new Int16Array(256).fill(-1);
  for (let i = 0; i < B64.length; i++) t[B64.charCodeAt(i)] = i;
  t['-'.charCodeAt(0)] = 62;
  t['_'.charCodeAt(0)] = 63;
  return t;
})();

export function base64ToBytes(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/_-]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  let buf = 0;
  let bits = 0;
  for (let i = 0; i < clean.length; i++) {
    buf = (buf << 6) | B64_LOOKUP[clean.charCodeAt(i)];
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (buf >> bits) & 255;
    }
  }
  return out.subarray(0, o);
}

/** Serializable image (for RPC). */
export interface WireImage {
  width: number;
  height: number;
  /** base64 RGBA */
  rgba: string;
}

export function toWire(img: RgbaImage): WireImage {
  return { width: img.width, height: img.height, rgba: bytesToBase64(img.data) };
}

export function fromWire(w: WireImage): RgbaImage {
  const bytes = base64ToBytes(w.rgba);
  const data = new Uint8ClampedArray(w.width * w.height * 4);
  data.set(bytes.subarray(0, data.length));
  return { width: w.width, height: w.height, data };
}
