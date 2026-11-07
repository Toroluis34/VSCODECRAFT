// Renders ItemVisual (flat sprites or block-model elements) onto a <canvas>.
// Block models are drawn with an orthographic projection: every face is a parallelogram on screen,
// so a canvas 2D affine transform maps the texture exactly (no WebGL needed).
import type { FaceName, ItemVisual, ResolvedElement, ResolvedFace, TextureRef } from '../../src/shared/protocol';

type Vec3 = [number, number, number];
type Mat3 = [number, number, number, number, number, number, number, number, number];

const imageCache = new Map<string, Promise<HTMLImageElement | null>>();

/** Load (and cache) an image. Resolves null on error. */
export function loadImage(src: string): Promise<HTMLImageElement | null> {
  let p = imageCache.get(src);
  if (!p) {
    p = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
    imageCache.set(src, p);
  }
  return p;
}

/** Source rectangle (first animation frame) of a texture inside its image. */
export function textureFrame(ref: TextureRef, img: HTMLImageElement): [number, number, number, number] {
  const [x, y, w, h] = ref.rect ?? [0, 0, img.naturalWidth, img.naturalHeight];
  // Animated textures are vertical strips of square frames: use the first one.
  return [x, y, w, h > w ? w : h];
}

export interface RenderOptions {
  /** Canvas pixel size (square). Defaults to canvas.width. */
  size?: number;
  /** Override the model rotation [x, y, z] in degrees (default: the model's gui transform or [30, 225, 0]). */
  rotation?: Vec3;
  /** Extra zoom factor (1 = Minecraft GUI size). */
  zoom?: number;
  /** Clear the canvas before drawing (default true). */
  clear?: boolean;
  /** Apply GUI-like face shading (default true). */
  shading?: boolean;
  /** Draw element outlines / highlight (model viewer). */
  outline?: boolean;
  /** Index of an element to highlight. */
  highlightElement?: number;
}

export interface PreparedVisual {
  visual: ItemVisual;
  images: Map<string, HTMLImageElement | null>;
}

/** Load every image a visual needs. Call once, then draw synchronously many times (e.g. while rotating). */
export async function prepareVisual(visual: ItemVisual): Promise<PreparedVisual> {
  const srcs = new Set<string>();
  if (visual.type === 'flat') visual.layers.forEach((l) => srcs.add(l.texture.src));
  if (visual.type === 'model')
    visual.elements.forEach((e) => Object.values(e.faces).forEach((f) => f?.texture && srcs.add(f.texture.src)));
  const images = new Map<string, HTMLImageElement | null>();
  await Promise.all([...srcs].map(async (s) => images.set(s, await loadImage(s))));
  return { visual, images };
}

/** Convenience: prepare + draw. */
export async function renderVisual(canvas: HTMLCanvasElement, visual: ItemVisual, opts: RenderOptions = {}): Promise<void> {
  const prepared = await prepareVisual(visual);
  drawPrepared(canvas, prepared, opts);
}

export function drawPrepared(canvas: HTMLCanvasElement, prepared: PreparedVisual, opts: RenderOptions = {}): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const size = opts.size ?? canvas.width;
  if (opts.clear !== false) ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = false;
  const v = prepared.visual;
  if (v.type === 'flat') drawFlat(ctx, prepared, size, opts.zoom ?? 1);
  else if (v.type === 'model') drawModel(ctx, prepared, size, opts);
  else drawMissing(ctx, v.label, size);
}

function drawFlat(ctx: CanvasRenderingContext2D, p: PreparedVisual, size: number, zoom: number): void {
  if (p.visual.type !== 'flat') return;
  const s = size * zoom;
  const off = (size - s) / 2;
  for (const layer of p.visual.layers) {
    const img = p.images.get(layer.texture.src);
    if (!img) continue;
    const [sx, sy, sw, sh] = textureFrame(layer.texture, img);
    if (layer.tint) {
      const tinted = tintedCanvas(img, [sx, sy, sw, sh], layer.tint, 1);
      ctx.drawImage(tinted, 0, 0, sw, sh, off, off, s, s);
    } else {
      ctx.drawImage(img, sx, sy, sw, sh, off, off, s, s);
    }
  }
}

function drawMissing(ctx: CanvasRenderingContext2D, label: string, size: number): void {
  // Magenta/black "missing texture" checkerboard with initials
  const h = size / 2;
  ctx.fillStyle = '#f800f8';
  ctx.fillRect(0, 0, h, h);
  ctx.fillRect(h, h, h, h);
  ctx.fillStyle = '#000';
  ctx.fillRect(h, 0, h, h);
  ctx.fillRect(0, h, h, h);
  if (size >= 24) {
    const initials = label
      .split(/[\s_]+/)
      .map((w) => w[0] ?? '')
      .join('')
      .slice(0, 2)
      .toUpperCase();
    ctx.font = `bold ${Math.round(size * 0.38)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = Math.max(2, size / 16);
    ctx.strokeStyle = '#000';
    ctx.strokeText(initials, h, h);
    ctx.fillStyle = '#fff';
    ctx.fillText(initials, h, h);
  }
}

// ---------- 3D (orthographic) ----------

const DEG = Math.PI / 180;

function rotX(a: number): Mat3 {
  const c = Math.cos(a), s = Math.sin(a);
  return [1, 0, 0, 0, c, -s, 0, s, c];
}
function rotY(a: number): Mat3 {
  const c = Math.cos(a), s = Math.sin(a);
  return [c, 0, s, 0, 1, 0, -s, 0, c];
}
function rotZ(a: number): Mat3 {
  const c = Math.cos(a), s = Math.sin(a);
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}
function mul(a: Mat3, b: Mat3): Mat3 {
  const r = new Array(9).fill(0) as Mat3;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j];
  return r;
}
function apply(m: Mat3, v: Vec3): Vec3 {
  return [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
}

/** Corners of a face in texture order: top-left, top-right, bottom-right, bottom-left. */
function faceCorners(face: FaceName, f: Vec3, t: Vec3): [Vec3, Vec3, Vec3, Vec3] {
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

function defaultUV(face: FaceName, f: Vec3, t: Vec3): [number, number, number, number] {
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

const NORMALS: Record<FaceName, Vec3> = {
  north: [0, 0, -1],
  south: [0, 0, 1],
  west: [-1, 0, 0],
  east: [1, 0, 0],
  up: [0, 1, 0],
  down: [0, -1, 0],
};

interface ScreenFace {
  pts: [number, number][];
  depth: number;
  face: ResolvedFace;
  uv: [number, number, number, number];
  light: number;
  element: number;
}

/** Element rotation (around origin) as a function on points. */
function elementTransform(el: ResolvedElement): (p: Vec3) => Vec3 {
  const r = el.rotation;
  if (!r || !r.angle) return (p) => p;
  const a = r.angle * DEG;
  const m = r.axis === 'x' ? rotX(a) : r.axis === 'y' ? rotY(a) : rotZ(a);
  let scale: Vec3 = [1, 1, 1];
  if (r.rescale) {
    const s = 1 / Math.cos(Math.abs(a));
    scale = r.axis === 'x' ? [1, s, s] : r.axis === 'y' ? [s, 1, s] : [s, s, 1];
  }
  const o = r.origin;
  return (p) => {
    const q = apply(m, [p[0] - o[0], p[1] - o[1], p[2] - o[2]]);
    return [q[0] * scale[0] + o[0], q[1] * scale[1] + o[1], q[2] * scale[2] + o[2]];
  };
}

/** Light direction in view space (from the upper-left, towards the viewer). */
const LIGHT: Vec3 = (() => {
  const v: Vec3 = [-0.45, 0.85, 0.55];
  const l = Math.hypot(...v);
  return [v[0] / l, v[1] / l, v[2] / l];
})();

function drawModel(ctx: CanvasRenderingContext2D, p: PreparedVisual, size: number, opts: RenderOptions): void {
  if (p.visual.type !== 'model') return;
  const v = p.visual;
  const gui = v.gui ?? {};
  const rot = opts.rotation ?? gui.rotation ?? [30, 225, 0];
  const scaleArr = opts.rotation ? [0.625, 0.625, 0.625] : (gui.scale ?? [1, 1, 1]);
  const trans = opts.rotation ? [0, 0, 0] : (gui.translation ?? [0, 0, 0]);
  // Minecraft: rotationXYZ => R = Rx * Ry * Rz
  const R = mul(mul(rotX(rot[0] * DEG), rotY(rot[1] * DEG)), rotZ(rot[2] * DEG));
  const zoom = opts.zoom ?? 1;
  const k = (size / 16) * zoom; // screen pixels per model unit
  const toScreen = (pt: Vec3): [number, number, number] => {
    const c: Vec3 = [(pt[0] - 8) * scaleArr[0], (pt[1] - 8) * scaleArr[1], (pt[2] - 8) * scaleArr[2]];
    const q = apply(R, c);
    return [size / 2 + (q[0] + trans[0]) * k, size / 2 - (q[1] + trans[1]) * k, q[2]];
  };

  const faces: ScreenFace[] = [];
  v.elements.forEach((el, ei) => {
    const tf = elementTransform(el);
    const elRot = el.rotation && el.rotation.angle ? el.rotation : undefined;
    const elR = elRot
      ? elRot.axis === 'x'
        ? rotX(elRot.angle * DEG)
        : elRot.axis === 'y'
          ? rotY(elRot.angle * DEG)
          : rotZ(elRot.angle * DEG)
      : undefined;
    for (const [name, face] of Object.entries(el.faces) as [FaceName, ResolvedFace][]) {
      if (!face) continue;
      let n = NORMALS[name];
      if (elR) n = apply(elR, n);
      const vn = apply(R, n);
      if (vn[2] <= 1e-4) continue; // back-face
      const corners = faceCorners(name, el.from, el.to).map((c) => toScreen(tf(c)));
      const depth = corners.reduce((s, c) => s + c[2], 0) / 4;
      const light = opts.shading === false || el.shade === false ? 1 : 0.5 + 0.5 * Math.max(0, vn[0] * LIGHT[0] + vn[1] * LIGHT[1] + vn[2] * LIGHT[2]);
      faces.push({
        pts: corners.map((c) => [c[0], c[1]] as [number, number]),
        depth,
        face,
        uv: face.uv ?? defaultUV(name, el.from, el.to),
        light: Math.min(1, light * 1.08),
        element: ei,
      });
    }
  });
  faces.sort((a, b) => a.depth - b.depth);
  for (const f of faces) drawFace(ctx, p, f, v.tint, opts);
}

function drawFace(ctx: CanvasRenderingContext2D, p: PreparedVisual, f: ScreenFace, tint: string | undefined, opts: RenderOptions): void {
  const ref = f.face.texture;
  const img = ref ? p.images.get(ref.src) : null;
  // Rotate UV corners according to face rotation
  const [u1, v1, u2, v2] = f.uv;
  const uvCorners: [number, number][] = [
    [u1, v1],
    [u2, v1],
    [u2, v2],
    [u1, v2],
  ];
  const steps = ((f.face.rotation ?? 0) / 90) & 3;
  const uvAt = (i: number) => uvCorners[(i + steps) % 4];
  // Slightly enlarge the face to hide anti-aliasing seams between adjacent faces
  const cx = f.pts.reduce((s, q) => s + q[0], 0) / 4;
  const cy = f.pts.reduce((s, q) => s + q[1], 0) / 4;
  const pts = f.pts.map(([x, y]) => {
    const dx = x - cx, dy = y - cy;
    const len = Math.hypot(dx, dy) || 1;
    return [x + (dx / len) * 0.35, y + (dy / len) * 0.35] as [number, number];
  });

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < 4; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  if (!img || !ref) {
    ctx.fillStyle = `rgba(248,0,248,${0.6 * f.light})`;
    ctx.fill();
    ctx.restore();
    return;
  }
  ctx.clip();
  const [fx, fy, fw, fh] = textureFrame(ref, img);
  const tinted = f.face.tintindex !== undefined && f.face.tintindex >= 0 && tint ? tint : undefined;
  const src = tintedCanvas(img, [fx, fy, fw, fh], tinted, f.light);
  // Texture-space points (pixels inside src) for TL, TR, BL
  const tp = (uv: [number, number]): [number, number] => [(uv[0] / 16) * fw, (uv[1] / 16) * fh];
  const a = tp(uvAt(0)), b = tp(uvAt(1)), c = tp(uvAt(3));
  const A = pts[0], B = pts[1], C = pts[3];
  const m = affineFrom3(a, b, c, A, B, C);
  if (m) {
    ctx.setTransform(...m);
    ctx.drawImage(src, 0, 0);
  }
  ctx.restore();
  if (opts.outline || opts.highlightElement === f.element) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(f.pts[0][0], f.pts[0][1]);
    for (let i = 1; i < 4; i++) ctx.lineTo(f.pts[i][0], f.pts[i][1]);
    ctx.closePath();
    ctx.strokeStyle = opts.highlightElement === f.element ? '#ffcc00' : 'rgba(255,255,255,0.35)';
    ctx.lineWidth = opts.highlightElement === f.element ? 2 : 1;
    ctx.stroke();
    ctx.restore();
  }
}

/** Solve the affine transform mapping texture points a,b,c to screen points A,B,C. */
function affineFrom3(
  a: [number, number],
  b: [number, number],
  c: [number, number],
  A: [number, number],
  B: [number, number],
  C: [number, number],
): [number, number, number, number, number, number] | null {
  const det = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
  if (Math.abs(det) < 1e-9) return null;
  // Solve for M where [X; Y] = [m0 m2; m1 m3] [x; y] + [m4; m5]
  const solve = (P: number, Q: number, R: number) => {
    const p = ((Q - P) * (c[1] - a[1]) - (R - P) * (b[1] - a[1])) / det;
    const q = ((R - P) * (b[0] - a[0]) - (Q - P) * (c[0] - a[0])) / det;
    const r = P - p * a[0] - q * a[1];
    return [p, q, r];
  };
  const [ma, mc, me] = solve(A[0], B[0], C[0]);
  const [mb, md, mf] = solve(A[1], B[1], C[1]);
  return [ma, mb, mc, md, me, mf];
}

const tintCache = new Map<string, HTMLCanvasElement>();

/** Crop + tint (multiply) + darken a texture into a cached offscreen canvas. */
function tintedCanvas(
  img: HTMLImageElement,
  rect: [number, number, number, number],
  tint: string | undefined,
  light: number,
): HTMLCanvasElement {
  const lightKey = Math.round(light * 100);
  const key = `${img.src}|${rect.join(',')}|${tint ?? ''}|${lightKey}`;
  let c = tintCache.get(key);
  if (c) return c;
  const [x, y, w, h] = rect;
  c = document.createElement('canvas');
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  g.drawImage(img, x, y, w, h, 0, 0, w, h);
  if (tint) {
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = tint;
    g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = 'destination-in';
    g.drawImage(img, x, y, w, h, 0, 0, w, h);
  }
  if (lightKey < 100) {
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = `rgba(0,0,0,${1 - light})`;
    g.fillRect(0, 0, w, h);
  }
  g.globalCompositeOperation = 'source-over';
  if (tintCache.size > 2000) tintCache.clear();
  tintCache.set(key, c);
  return c;
}
