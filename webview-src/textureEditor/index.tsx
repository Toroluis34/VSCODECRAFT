// Pixel-art texture editor (custom editor webview). The host owns the document (undo/redo, save);
// every finished operation sends the full new image with `tex.edit`.
import { render } from 'preact';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { call, onEvent } from '../shared/vscode';
import { t } from '../shared/i18n';
import {
  adjustImage,
  blit,
  clearRect,
  cloneImage,
  type ColorAdjust,
  createImage,
  crop,
  extractPalette,
  flipHorizontal,
  flipVertical,
  floodFill,
  frameLayout,
  frameRect,
  fromWire,
  getPixel,
  isIdentityAdjust,
  isPowerOfTwo,
  joinFrames,
  linePoints,
  mapFrames,
  mirrorPoints,
  paintPoints,
  type Rect,
  rectFromPoints,
  rectPoints,
  resizeCanvas,
  type Rgba,
  rgbaToHex,
  type RgbaImage,
  rotate90,
  scaleNearest,
  splitFrames,
  toWire,
} from '../../src/features/textures/pixels';
import { animationTimeline, type AnimationSettings, framesAfterRemoval, parseAnimation, writeAnimation } from '../../src/features/textures/mcmeta';
import type { NamedPalette, TextureEditorPayload, TextureSetEvent } from '../../src/features/textures/protocol';
import { imageToCanvas, SHARED_CSS, useStyle } from '../textureShared/canvas';
import { ICON_CSS, ToolButton } from '../textureShared/icons';
import { AdjustDialog, type AdjustScope, AnimationPanel, BlockPreview, ColorPanel, playbackFrame, ResizeDialog, type ResizeMode, rgbaCss, TiledPreview } from './panels';
import { EDITOR_CSS } from './style';
import { ADJUST_CSS } from '../textureShared/adjust';

type Tool = 'pencil' | 'eraser' | 'fill' | 'picker' | 'line' | 'rect' | 'select';

interface Doc {
  img: RgbaImage;
  mcmeta: Record<string, unknown> | null;
}

interface Floating {
  img: RgbaImage;
  x: number;
  y: number;
  /** Document image with the lifted area cleared. */
  base: RgbaImage;
}

interface Interaction {
  kind: 'paint' | 'shape' | 'select' | 'move';
  color: Rgba;
  start: [number, number];
  last: [number, number];
  base: RgbaImage;
  offset?: [number, number];
}

const TOOLS: { id: Tool; icon: string; title: string; key: string }[] = [
  { id: 'pencil', icon: 'pencil', title: 'Pencil (B)', key: 'b' },
  { id: 'eraser', icon: 'eraser', title: 'Eraser (E)', key: 'e' },
  { id: 'fill', icon: 'fill', title: 'Fill bucket (G)', key: 'g' },
  { id: 'picker', icon: 'picker', title: 'Colour picker (I, or Alt+click)', key: 'i' },
  { id: 'line', icon: 'line', title: 'Line (L)', key: 'l' },
  { id: 'rect', icon: 'rect', title: 'Rectangle (U)', key: 'u' },
  { id: 'select', icon: 'select', title: 'Select & move (M)', key: 'm' },
];

const TRANSPARENT: Rgba = [0, 0, 0, 0];

function App() {
  useStyle('tex-shared-css', SHARED_CSS + ICON_CSS + ADJUST_CSS + EDITOR_CSS);
  const [doc, setDocState] = useState<Doc | null>(null);
  const [info, setInfo] = useState<Omit<TextureEditorPayload, 'image' | 'mcmeta'> | null>(null);
  const [error, setError] = useState('');
  const [tool, setTool] = useState<Tool>('pencil');
  const [primary, setPrimary] = useState<Rgba>([255, 255, 255, 255]);
  const [secondary, setSecondary] = useState<Rgba>([0, 0, 0, 0]);
  const [zoom, setZoom] = useState(16);
  const [grid, setGrid] = useState(true);
  const [mirrorX, setMirrorX] = useState(false);
  const [mirrorY, setMirrorY] = useState(false);
  const [contiguous, setContiguous] = useState(true);
  const [rectFilled, setRectFilled] = useState(false);
  const [frame, setFrame] = useState(0);
  const [onion, setOnion] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [tick, setTick] = useState(0);
  const [allFrames, setAllFrames] = useState(false);
  const [selection, setSelection] = useState<Rect | null>(null);
  const [floating, setFloatingState] = useState<Floating | null>(null);
  const floatingRef = useRef<Floating | null>(null);
  const setFloating = (f: Floating | null) => {
    floatingRef.current = f;
    setFloatingState(f);
  };
  const [hover, setHover] = useState<[number, number] | null>(null);
  const [dialog, setDialog] = useState<null | 'adjust' | 'recolor' | 'resize'>(null);
  const [adjust, setAdjust] = useState<ColorAdjust>({});
  const [adjustScope, setAdjustScope] = useState<AdjustScope>('all');
  const [palettes, setPalettes] = useState<NamedPalette[]>([]);
  const [previewMode, setPreviewMode] = useState<'block' | 'item'>('block');

  const docRef = useRef<Doc | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const interaction = useRef<Interaction | null>(null);
  const work = useRef<RgbaImage | null>(null);
  const clipboard = useRef<RgbaImage | null>(null);

  const setDoc = (d: Doc) => {
    docRef.current = d;
    setDocState(d);
  };

  // ---------- load & host sync ----------
  useEffect(() => {
    call<TextureEditorPayload>('tex.load')
      .then((p) => {
        const img = fromWire(p.image);
        setDoc({ img, mcmeta: p.mcmeta });
        setInfo({ id: p.id, folder: p.folder, fileName: p.fileName, version: p.version });
        if (p.folder === 'item' || p.folder?.startsWith('item/')) setPreviewMode('item');
        const lay = frameLayout(img.width, img.height);
        const availW = Math.max(200, window.innerWidth - 560);
        const availH = Math.max(200, window.innerHeight - 140);
        setZoom(Math.max(1, Math.min(48, Math.floor(Math.min(availW / lay.frameWidth, availH / lay.frameHeight)))));
        const pal = extractPalette(img, 2, false);
        if (pal[0]) setPrimary(pal[0]);
      })
      .catch((e) => setError(String(e?.message ?? e)));
    const off = onEvent<TextureSetEvent>('tex.set', (e) => {
      const img = fromWire(e.image);
      const prev = docRef.current;
      setDoc({ img, mcmeta: e.mcmeta });
      if (!prev || prev.img.width !== img.width || prev.img.height !== img.height) setSelection(null);
      setFloating(null);
      work.current = null;
    });
    window.setTimeout(() => {
      call<NamedPalette[]>('tex.palettes')
        .then((p) => setPalettes(p ?? []))
        .catch(() => undefined);
    }, 300);
    return off;
  }, []);

  const commit = useCallback((label: string, img?: RgbaImage, mcmeta?: Record<string, unknown> | null) => {
    const cur = docRef.current;
    if (!cur) return;
    const next: Doc = { img: img ?? cur.img, mcmeta: mcmeta === undefined ? cur.mcmeta : mcmeta };
    setDoc(next);
    void call('tex.edit', { label, image: img ? toWire(img) : undefined, mcmeta }).catch((e) => setError(String(e?.message ?? e)));
  }, []);

  // ---------- derived ----------
  const anim = useMemo(() => parseAnimation(doc?.mcmeta), [doc?.mcmeta]);
  const layout = useMemo(() => (doc ? frameLayout(doc.img.width, doc.img.height, anim?.width, anim?.height) : frameLayout(16, 16)), [doc?.img.width, doc?.img.height, anim?.width, anim?.height]);
  const frameIdx = Math.min(frame, layout.count - 1);
  const area = frameRect(layout, frameIdx);
  const textureColors = useMemo(() => (doc ? extractPalette(doc.img, 48) : []), [doc?.img]);
  const timeline = useMemo(() => animationTimeline(anim, layout.count), [anim, layout.count]);

  // Adjust dialog live preview
  const adjustRect = (): Rect | undefined => (adjustScope === 'selection' && selection ? selection : adjustScope === 'frame' ? area : undefined);
  const previewImg = useMemo(() => {
    if (!doc || (dialog !== 'adjust' && dialog !== 'recolor') || isIdentityAdjust(adjust)) return null;
    return adjustImage(doc.img, adjust, adjustRect());
  }, [doc?.img, dialog, adjust, adjustScope, selection, frameIdx]);

  /** What the canvas shows right now. */
  const displayImage = (): RgbaImage | null => {
    if (work.current) return work.current;
    if (floating) {
      const img = cloneImage(floating.base);
      blit(img, floating.img, floating.x, floating.y, 'skipTransparent', area);
      return img;
    }
    return previewImg ?? doc?.img ?? null;
  };

  // ---------- drawing ----------
  const draw = useCallback(() => {
    const c = canvasRef.current;
    const img = displayImage();
    if (!c || !img) return;
    const W = layout.frameWidth * zoom;
    const H = layout.frameHeight * zoom;
    if (c.width !== W) c.width = W;
    if (c.height !== H) c.height = H;
    const g = c.getContext('2d')!;
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, W, H);
    if (onion && layout.count > 1) {
      const prev = (frameIdx - 1 + layout.count) % layout.count;
      g.globalAlpha = 0.3;
      g.drawImage(imageToCanvas(crop(img, frameRect(layout, prev))), 0, 0, W, H);
      g.globalAlpha = 1;
    }
    g.drawImage(imageToCanvas(crop(img, area)), 0, 0, W, H);

    if (grid && zoom >= 6) {
      g.beginPath();
      for (let x = 1; x < layout.frameWidth; x++) {
        g.moveTo(x * zoom + 0.5, 0);
        g.lineTo(x * zoom + 0.5, H);
      }
      for (let y = 1; y < layout.frameHeight; y++) {
        g.moveTo(0, y * zoom + 0.5);
        g.lineTo(W, y * zoom + 0.5);
      }
      g.strokeStyle = 'rgba(128,128,128,0.28)';
      g.lineWidth = 1;
      g.stroke();
      const major = layout.frameWidth >= 32 ? 16 : layout.frameWidth >= 16 ? 8 : 0;
      if (major) {
        g.beginPath();
        for (let x = major; x < layout.frameWidth; x += major) {
          g.moveTo(x * zoom + 0.5, 0);
          g.lineTo(x * zoom + 0.5, H);
        }
        for (let y = major; y < layout.frameHeight; y += major) {
          g.moveTo(0, y * zoom + 0.5);
          g.lineTo(W, y * zoom + 0.5);
        }
        g.strokeStyle = 'rgba(128,128,128,0.55)';
        g.stroke();
      }
    }
    if (mirrorX || mirrorY) {
      g.save();
      g.setLineDash([4, 4]);
      g.strokeStyle = 'rgba(0,160,255,0.8)';
      g.beginPath();
      if (mirrorX) {
        g.moveTo(W / 2, 0);
        g.lineTo(W / 2, H);
      }
      if (mirrorY) {
        g.moveTo(0, H / 2);
        g.lineTo(W, H / 2);
      }
      g.stroke();
      g.restore();
    }
    const sel = floating ? { x: floating.x, y: floating.y, w: floating.img.width, h: floating.img.height } : interaction.current?.kind === 'select' ? currentSelectRect() : selection;
    if (sel) {
      const x = sel.x * zoom + 0.5;
      const y = (sel.y - area.y) * zoom + 0.5;
      g.save();
      g.lineWidth = 1;
      g.setLineDash([4, 3]);
      g.strokeStyle = '#000';
      g.strokeRect(x, y, sel.w * zoom - 1, sel.h * zoom - 1);
      g.lineDashOffset = 4;
      g.strokeStyle = '#fff';
      g.strokeRect(x, y, sel.w * zoom - 1, sel.h * zoom - 1);
      g.restore();
    }
    if (hover && !interaction.current && tool !== 'select') {
      const pts = tool === 'pencil' || tool === 'eraser' ? mirrorPoints(hover[0], hover[1], area, mirrorX, mirrorY) : [hover];
      g.save();
      for (const [hx, hy] of pts) {
        g.strokeStyle = 'rgba(255,255,255,0.9)';
        g.strokeRect(hx * zoom + 0.5, (hy - area.y) * zoom + 0.5, zoom - 1, zoom - 1);
        g.strokeStyle = 'rgba(0,0,0,0.6)';
        g.strokeRect(hx * zoom + 1.5, (hy - area.y) * zoom + 1.5, zoom - 3, zoom - 3);
      }
      g.restore();
    }
  }, [doc, zoom, grid, onion, frameIdx, layout, floating, selection, hover, tool, mirrorX, mirrorY, previewImg]);

  useEffect(draw, [draw]);

  function currentSelectRect(): Rect | null {
    const it = interaction.current;
    if (!it || it.kind !== 'select') return null;
    return rectFromPoints(it.start[0], it.start[1], it.last[0], it.last[1]);
  }

  // ---------- pointer interaction ----------
  const toPixel = (e: PointerEvent | MouseEvent): [number, number] => {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * layout.frameWidth);
    const y = Math.floor(((e.clientY - r.top) / r.height) * layout.frameHeight);
    return [Math.max(0, Math.min(layout.frameWidth - 1, x)), Math.max(0, Math.min(layout.frameHeight - 1, y)) + area.y];
  };

  const inside = (r: Rect | null, x: number, y: number) => !!r && x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;

  const commitFloating = () => {
    const fl = floatingRef.current;
    if (!fl) return;
    const img = cloneImage(fl.base);
    blit(img, fl.img, fl.x, fl.y, 'skipTransparent', area);
    setSelection({ x: fl.x, y: fl.y, w: fl.img.width, h: fl.img.height });
    setFloating(null);
    commit(t('Move selection'), img);
  };

  const paintAt = (img: RgbaImage, x: number, y: number, color: Rgba) => {
    paintPoints(img, mirrorPoints(x, y, area, mirrorX, mirrorY), color, area);
  };

  const shapePoints = (x0: number, y0: number, x1: number, y1: number): [number, number][] => {
    const base = tool === 'line' ? linePoints(x0, y0, x1, y1) : rectPoints(rectFromPoints(x0, y0, x1, y1), rectFilled);
    return base.flatMap(([x, y]) => mirrorPoints(x, y, area, mirrorX, mirrorY));
  };

  const onPointerDown = (e: PointerEvent) => {
    if (!doc || dialog) return;
    if (e.button !== 0 && e.button !== 2) return;
    e.preventDefault();
    canvasRef.current?.setPointerCapture(e.pointerId);
    const [x, y] = toPixel(e);
    const which = e.button === 2 ? 'secondary' : 'primary';
    if (tool === 'picker' || e.altKey) {
      const c = getPixel(displayImage()!, x, y);
      (which === 'primary' ? setPrimary : setSecondary)(c);
      return;
    }
    const color = tool === 'eraser' ? TRANSPARENT : which === 'primary' ? primary : secondary;

    if (tool === 'select') {
      const selRect = floating ? { x: floating.x, y: floating.y, w: floating.img.width, h: floating.img.height } : selection;
      if (inside(selRect, x, y)) {
        let fl = floating;
        if (!fl) {
          const base = cloneImage(doc.img);
          clearRect(base, selection!);
          fl = { img: crop(doc.img, selection!), x: selection!.x, y: selection!.y, base };
          setFloating(fl);
        }
        interaction.current = { kind: 'move', color, start: [x, y], last: [x, y], base: fl.base, offset: [x - fl.x, y - fl.y] };
        return;
      }
      if (floating) commitFloating();
      setSelection(null);
      interaction.current = { kind: 'select', color, start: [x, y], last: [x, y], base: doc.img };
      draw();
      return;
    }
    if (floating) commitFloating();

    if (tool === 'fill') {
      const img = cloneImage(doc.img);
      const clip = selection ?? area;
      for (const [px, py] of mirrorPoints(x, y, area, mirrorX, mirrorY)) floodFill(img, px, py, color, { contiguous, area: clip });
      commit(contiguous ? t('Fill') : t('Replace colour'), img);
      return;
    }
    const base = doc.img;
    const img = cloneImage(base);
    if (tool === 'pencil' || tool === 'eraser') paintAt(img, x, y, color);
    else paintPoints(img, shapePoints(x, y, x, y), color, area);
    work.current = img;
    interaction.current = { kind: tool === 'pencil' || tool === 'eraser' ? 'paint' : 'shape', color, start: [x, y], last: [x, y], base };
    draw();
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!doc) return;
    const [x, y] = toPixel(e);
    if (!hover || hover[0] !== x || hover[1] !== y) setHover([x, y]);
    const it = interaction.current;
    if (!it || (it.last[0] === x && it.last[1] === y)) return;
    if (it.kind === 'paint' && work.current) {
      for (const [px, py] of linePoints(it.last[0], it.last[1], x, y)) paintAt(work.current, px, py, it.color);
    } else if (it.kind === 'shape') {
      const img = cloneImage(it.base);
      paintPoints(img, shapePoints(it.start[0], it.start[1], x, y), it.color, area);
      work.current = img;
    } else if (it.kind === 'move' && floating) {
      const nx = x - it.offset![0];
      const ny = y - it.offset![1];
      setFloating({ ...floating, x: nx, y: ny });
    }
    it.last = [x, y];
    draw();
  };

  const onPointerUp = () => {
    const it = interaction.current;
    interaction.current = null;
    if (!it) return;
    if (it.kind === 'paint' || it.kind === 'shape') {
      const img = work.current;
      work.current = null;
      if (img) commit(it.kind === 'paint' ? (tool === 'eraser' ? t('Erase') : t('Draw')) : tool === 'line' ? t('Line') : t('Rectangle'), img);
    } else if (it.kind === 'select') {
      const r = rectFromPoints(it.start[0], it.start[1], it.last[0], it.last[1]);
      setSelection(r.w * r.h > 1 || it.start[0] !== it.last[0] ? r : null);
    }
    draw();
  };

  // ---------- operations ----------
  const currentFrameImage = (img: RgbaImage) => crop(img, area);

  /** Apply a frame-sized transform to the selection, the current frame, or every frame. */
  const transform = (label: string, fn: (img: RgbaImage) => RgbaImage, canChangeSize = false) => {
    if (!doc) return;
    if (floating) {
      setFloating({ ...floating, img: fn(floating.img) });
      return;
    }
    if (selection) {
      const part = fn(crop(doc.img, selection));
      if (part.width !== selection.w || part.height !== selection.h) return;
      const img = cloneImage(doc.img);
      blit(img, part, selection.x, selection.y);
      commit(label, img);
      return;
    }
    if (layout.count === 1) {
      const out = fn(doc.img);
      if (!canChangeSize && (out.width !== doc.img.width || out.height !== doc.img.height)) return;
      commit(label, out);
      return;
    }
    const out = mapFrames(doc.img, layout, (f, i) => (allFrames || i === frameIdx ? fn(f) : f));
    if (out.width !== doc.img.width || out.height !== doc.img.height) return;
    commit(label, out);
  };

  const setAnim = (a: AnimationSettings | undefined, label = t('Edit animation')) => {
    if (!doc) return;
    const next = writeAnimation(doc.mcmeta, a);
    commit(label, undefined, Object.keys(next).length ? next : null);
  };

  const addFrame = (duplicate: boolean) => {
    if (!doc) return;
    const frames = splitFrames(doc.img, layout);
    const copy = duplicate ? cloneImage(frames[frameIdx]) : createImage(layout.frameWidth, layout.frameHeight);
    frames.splice(frameIdx + 1, 0, copy);
    const img = joinFrames(frames);
    const a: AnimationSettings = anim ? { ...anim } : { frametime: 2, interpolate: false };
    if (a.frames) a.frames = a.frames.map((f) => (f.index > frameIdx ? { ...f, index: f.index + 1 } : f));
    const mcmeta = writeAnimation(doc.mcmeta, a);
    commit(t('Add frame'), img, mcmeta);
    setFrame(frameIdx + 1);
  };

  const removeFrame = () => {
    if (!doc || layout.count < 2) return;
    const frames = splitFrames(doc.img, layout);
    frames.splice(frameIdx, 1);
    const mcmeta = anim?.frames ? writeAnimation(doc.mcmeta, { ...anim, frames: framesAfterRemoval(anim.frames, frameIdx) }) : undefined;
    commit(t('Remove frame'), joinFrames(frames), mcmeta);
    setFrame(Math.max(0, frameIdx - 1));
  };

  const moveFrame = (dir: -1 | 1) => {
    if (!doc) return;
    const j = frameIdx + dir;
    if (j < 0 || j >= layout.count) return;
    const frames = splitFrames(doc.img, layout);
    [frames[frameIdx], frames[j]] = [frames[j], frames[frameIdx]];
    let mcmeta: Record<string, unknown> | undefined;
    if (anim?.frames) {
      const swap = (i: number) => (i === frameIdx ? j : i === j ? frameIdx : i);
      mcmeta = writeAnimation(doc.mcmeta, { ...anim, frames: anim.frames.map((f) => ({ ...f, index: swap(f.index) })) });
    }
    commit(t('Move frame'), joinFrames(frames), mcmeta);
    setFrame(j);
  };

  const applyResize = (w: number, h: number, mode: ResizeMode) => {
    if (!doc) return;
    setDialog(null);
    setSelection(null);
    setFloating(null);
    let img: RgbaImage;
    if (mode === 'new') img = createImage(w, h);
    else {
      const fn = (f: RgbaImage) => (mode === 'scale' ? scaleNearest(f, w, h) : resizeCanvas(f, w, h, 'center'));
      img = layout.count > 1 ? mapFrames(doc.img, layout, fn) : fn(doc.img);
    }
    let mcmeta: Record<string, unknown> | null | undefined;
    if (anim && (anim.width || anim.height)) mcmeta = writeAnimation(doc.mcmeta, { ...anim, width: undefined, height: undefined });
    if (mode === 'new' && anim) mcmeta = null;
    commit(t('Resize'), img, mcmeta);
    setFrame(0);
    const availW = Math.max(200, window.innerWidth - 560);
    const availH = Math.max(200, window.innerHeight - 140);
    setZoom(Math.max(1, Math.min(48, Math.floor(Math.min(availW / w, availH / h)))));
  };

  const applyAdjust = () => {
    if (doc && previewImg) commit(dialog === 'recolor' ? t('Recolor') : t('Adjust colours'), previewImg);
    setDialog(null);
    setAdjust({});
  };

  const openAdjust = (kind: 'adjust' | 'recolor') => {
    if (floating) commitFloating();
    setAdjust({});
    setAdjustScope(kind === 'recolor' ? 'all' : selection ? 'selection' : layout.count > 1 ? 'frame' : 'all');
    setDialog(kind);
  };

  const deleteSelection = () => {
    if (!doc) return;
    if (floating) {
      setFloating(null);
      commit(t('Delete'), floating.base);
      setSelection(null);
      return;
    }
    if (!selection) return;
    const img = cloneImage(doc.img);
    clearRect(img, selection);
    commit(t('Delete'), img);
  };

  // ---------- keyboard ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')) return;
      if (dialog) {
        if (e.key === 'Escape') {
          setDialog(null);
          setAdjust({});
        }
        return;
      }
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === 'c' && doc && (selection || floating)) {
        clipboard.current = floating ? cloneImage(floating.img) : crop(doc.img, selection!);
        e.preventDefault();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && k === 'v' && doc && clipboard.current) {
        if (floating) commitFloating();
        const x = selection?.x ?? 0;
        const y = selection?.y ?? area.y;
        setFloating({ img: cloneImage(clipboard.current), x, y, base: doc.img });
        setTool('select');
        e.preventDefault();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && k === 'a') {
        setSelection(area);
        setTool('select');
        e.preventDefault();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const tdef = TOOLS.find((x) => x.key === k);
      if (tdef) {
        if (floating && tdef.id !== 'select') commitFloating();
        setTool(tdef.id);
      } else if (k === 'x') {
        setPrimary(secondary);
        setSecondary(primary);
      } else if (k === '+' || k === '=') setZoom((z) => Math.min(64, z + (z >= 8 ? 2 : 1)));
      else if (k === '-') setZoom((z) => Math.max(1, z - (z > 8 ? 2 : 1)));
      else if (k === 'escape') {
        setFloating(null);
        setSelection(null);
      } else if (k === 'enter') commitFloating();
      else if (k === 'delete' || k === 'backspace') deleteSelection();
      else if (k === ',' || k === 'arrowleft') setFrame((f) => Math.max(0, Math.min(f, layout.count - 1) - 1));
      else if (k === '.' || k === 'arrowright') setFrame((f) => Math.min(layout.count - 1, f + 1));
      else if (k === 'h') transform(t('Flip horizontally'), flipHorizontal);
      else if (k === 'v') transform(t('Flip vertically'), flipVertical);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ---------- playback ----------
  useEffect(() => {
    if (!playing) return;
    const h = window.setInterval(() => setTick((x) => x + 1), 50);
    return () => window.clearInterval(h);
  }, [playing]);
  useEffect(() => {
    if (layout.count < 2) setPlaying(false);
  }, [layout.count]);

  const previewSource = displayImage();
  const play = playing && layout.count > 1 ? playbackFrame(timeline, tick, anim?.interpolate ?? false) : null;
  const previewFrame = useMemo(
    () => (previewSource ? crop(previewSource, frameRect(layout, play ? play.frame : frameIdx)) : null),
    [previewSource, play?.frame, frameIdx, layout],
  );
  const blendFrame = useMemo(() => (play?.next !== undefined && doc ? crop(doc.img, frameRect(layout, play.next)) : null), [play?.next, doc?.img, layout]);

  if (error && !doc) return <div class="mc-error tex-pad">{error}</div>;
  if (!doc || !info) return <div class="mc-muted tex-pad">{t('Loading texture…')}</div>;

  const animated = layout.count > 1;
  const hoverColor = hover ? getPixel(displayImage()!, hover[0], hover[1]) : null;
  const isStrip = doc.img.height > doc.img.width && doc.img.height % doc.img.width === 0;
  const warnings: { text: string; action?: [string, () => void] }[] = [];
  if (isStrip && !anim) {
    warnings.push({
      text: t('This texture is a strip of {0} frames but has no .mcmeta animation: Minecraft will show the whole strip squashed.', doc.img.height / doc.img.width),
      action: [t('Create .mcmeta'), () => setAnim({ frametime: 2, interpolate: false }, t('Create animation'))],
    });
  }
  if (!isPowerOfTwo(layout.frameWidth) || (!animated && !isPowerOfTwo(doc.img.height))) {
    warnings.push({ text: t('Size {0} × {1} is not a power of two; Minecraft may render it blurry or reject it for mipmaps.', layout.frameWidth, layout.frameHeight) });
  }

  return (
    <div class="tex-app" onContextMenu={(e) => e.preventDefault()}>
      <div class="tex-toolbar">
        {TOOLS.map((x) => (
          <ToolButton
            key={x.id}
            icon={x.icon}
            title={t(x.title)}
            active={tool === x.id}
            onClick={() => {
              if (floating && x.id !== 'select') commitFloating();
              setTool(x.id);
            }}
          />
        ))}
        <span class="tex-sep" />
        {tool === 'fill' ? (
          <button class={`tex-chip ${contiguous ? 'active' : ''}`} onClick={() => setContiguous(!contiguous)} title={t('Contiguous: fill the connected area. Global: replace the colour everywhere in the frame.')}>
            {contiguous ? t('Contiguous') : t('Global')}
          </button>
        ) : null}
        {tool === 'rect' ? (
          <button class={`tex-chip ${rectFilled ? 'active' : ''}`} onClick={() => setRectFilled(!rectFilled)}>
            {rectFilled ? t('Filled') : t('Outline')}
          </button>
        ) : null}
        <ToolButton icon="mirrorX" title={t('Mirror painting horizontally')} active={mirrorX} onClick={() => setMirrorX(!mirrorX)} />
        <ToolButton icon="mirrorY" title={t('Mirror painting vertically')} active={mirrorY} onClick={() => setMirrorY(!mirrorY)} />
        <ToolButton icon="grid" title={t('Pixel grid')} active={grid} onClick={() => setGrid(!grid)} />
        <span class="tex-sep" />
        <ToolButton icon="zoomOut" title={t('Zoom out (-)')} onClick={() => setZoom((z) => Math.max(1, z - (z > 8 ? 2 : 1)))} />
        <span class="tex-zoom">{zoom}×</span>
        <ToolButton icon="zoomIn" title={t('Zoom in (+)')} onClick={() => setZoom((z) => Math.min(64, z + (z >= 8 ? 2 : 1)))} />
        <span class="tex-sep" />
        <ToolButton icon="flipH" title={t('Flip horizontally (H)')} onClick={() => transform(t('Flip horizontally'), flipHorizontal)} />
        <ToolButton icon="flipV" title={t('Flip vertically (V)')} onClick={() => transform(t('Flip vertically'), flipVertical)} />
        <ToolButton icon="rotateCcw" title={t('Rotate 90° left')} onClick={() => transform(t('Rotate'), (i) => rotate90(i, false), true)} />
        <ToolButton icon="rotateCw" title={t('Rotate 90° right')} onClick={() => transform(t('Rotate'), (i) => rotate90(i, true), true)} />
        {animated ? (
          <label class="tex-check tex-small" title={t('Flip/rotate every frame instead of only the current one')}>
            <input type="checkbox" checked={allFrames} onChange={(e) => setAllFrames((e.target as HTMLInputElement).checked)} />
            {t('All frames')}
          </label>
        ) : null}
        <span class="tex-sep" />
        <ToolButton icon="adjust" title={t('Hue / saturation / brightness')} label={t('Adjust')} onClick={() => openAdjust('adjust')} />
        <ToolButton icon="palette" title={t('Recolor the whole texture (material variants: ruby → sapphire)')} label={t('Recolor')} onClick={() => openAdjust('recolor')} />
        <ToolButton icon="resize" title={t('Resize / new canvas')} label={t('Size')} onClick={() => setDialog('resize')} />
        <span class="mc-spacer" />
        <ToolButton icon="undo" title={t('Undo (Ctrl+Z)')} onClick={() => void call('tex.command', { command: 'undo' })} />
        <ToolButton icon="redo" title={t('Redo (Ctrl+Y)')} onClick={() => void call('tex.command', { command: 'redo' })} />
        <ToolButton icon="save" title={t('Save (Ctrl+S)')} onClick={() => void call('tex.command', { command: 'save' })} />
      </div>

      <div class="tex-body">
        <ColorPanel primary={primary} secondary={secondary} setPrimary={setPrimary} setSecondary={setSecondary} textureColors={textureColors} palettes={palettes} />

        <div class="tex-center">
          {warnings.map((w) => (
            <div class="tex-banner" key={w.text}>
              <span class="mc-grow">{w.text}</span>
              {w.action ? (
                <button class="mc-button secondary" onClick={w.action[1]}>
                  {w.action[0]}
                </button>
              ) : null}
            </div>
          ))}
          <div
            class="tex-stage"
            ref={stageRef}
            onWheel={(e) => {
              if (!e.ctrlKey && !e.metaKey) return;
              e.preventDefault();
              setZoom((z) => Math.max(1, Math.min(64, z + (e.deltaY < 0 ? 1 : -1) * (z >= 8 ? 2 : 1))));
            }}
          >
            <canvas
              ref={canvasRef}
              class={`tex-canvas tex-checker tool-${tool}`}
              style={{ width: `${layout.frameWidth * zoom}px`, height: `${layout.frameHeight * zoom}px` }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onPointerLeave={() => setHover(null)}
            />
          </div>
          <div class="tex-status">
            <span>{info.id ?? info.fileName}</span>
            <span>
              {doc.img.width} × {doc.img.height}
              {animated ? ` · ${t('frame {0}/{1}', frameIdx + 1, layout.count)}` : ''}
            </span>
            {hover ? (
              <span class="mono">
                {hover[0]}, {hover[1] - area.y}
                {hoverColor ? (
                  <>
                    {' '}
                    <span class="tex-dot tex-checker">
                      <span style={{ background: rgbaCss(hoverColor) }} />
                    </span>{' '}
                    {hoverColor[3] ? rgbaToHex(hoverColor) : t('transparent')}
                  </>
                ) : null}
              </span>
            ) : null}
            {selection ? <span>{t('selection {0} × {1}', selection.w, selection.h)}</span> : null}
            <span class="mc-spacer" />
            <span class="mc-muted">MC {info.version}</span>
          </div>
        </div>

        <div class="tex-side">
          <div class="tex-panel">
            <div class="tex-row-between">
              <div class="tex-section-title">{t('Preview')}</div>
              <div class="tex-row">
                <ToolButton icon="cube" title={t('Block preview')} active={previewMode === 'block'} onClick={() => setPreviewMode('block')} />
                <ToolButton icon="tiles" title={t('Item preview')} active={previewMode === 'item'} onClick={() => setPreviewMode('item')} />
              </div>
            </div>
            {previewFrame ? (
              <div class="tex-previews">
                <BlockPreview frame={previewFrame} mode={previewMode} />
                <TiledPreview frame={previewFrame} blend={blendFrame && play ? { next: blendFrame, amount: play.amount } : undefined} />
              </div>
            ) : null}
          </div>
          <AnimationPanel
            img={doc.img}
            layout={layout}
            frame={frameIdx}
            setFrame={(i) => {
              if (floating) commitFloating();
              setSelection(null);
              setFrame(i);
            }}
            anim={anim}
            hasMcmeta={!!anim}
            playing={playing}
            setPlaying={setPlaying}
            onion={onion}
            setOnion={setOnion}
            addFrame={addFrame}
            removeFrame={removeFrame}
            moveFrame={moveFrame}
            setAnim={(a) => setAnim(a)}
            playStep={play?.frame ?? -1}
          />
        </div>
      </div>

      {dialog === 'adjust' || dialog === 'recolor' ? (
        <div class="tex-dialog-layer">
          <AdjustDialog
            title={dialog === 'recolor' ? t('Recolor texture') : t('Adjust colours')}
            value={adjust}
            onChange={setAdjust}
            scope={adjustScope}
            setScope={setAdjustScope}
            hasSelection={!!selection}
            animated={animated}
            source={adjustScope === 'selection' && selection ? crop(doc.img, selection) : adjustScope === 'frame' ? currentFrameImage(doc.img) : doc.img}
            onApply={applyAdjust}
            onCancel={() => {
              setDialog(null);
              setAdjust({});
            }}
            onVariantFiles={info.id ? () => void call('tex.openVariant') : undefined}
          />
        </div>
      ) : null}
      {dialog === 'resize' ? (
        <div class="tex-dialog-layer">
          <ResizeDialog width={layout.frameWidth} height={layout.frameHeight} animated={animated} onApply={applyResize} onCancel={() => setDialog(null)} />
        </div>
      ) : null}
    </div>
  );
}

render(<App />, document.getElementById('app')!);
