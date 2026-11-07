// Model Viewer webview: interactive orthographic 3D view of a block/item model, blockstate or item definition.
import { render } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ModelDisplayTransform, ResolvedElement, TextureRef } from '../../src/shared/protocol';
import type { GeneratedLayer, ViewerModel, ViewerSelection, ViewerTexture } from '../../src/features/models/viewTypes';
import { boot, call, onEvent, state as vsState } from '../shared/vscode';
import { t } from '../shared/i18n';
import { drawPrepared, loadImage, prepareVisual, textureFrame, type PreparedVisual } from '../shared/itemRenderer';
import { Button } from '../shared/components';

type Vec3 = [number, number, number];
interface Transform {
  rotation: Vec3;
  translation: Vec3;
  scale: Vec3;
}
type Background = 'checker' | 'dark' | 'light';
interface ViewOptions {
  outline: boolean;
  grid: boolean;
  axes: boolean;
  background: Background;
}
interface Persisted {
  options?: ViewOptions;
  selection?: ViewerSelection;
}

const CSS = `
body { padding: 0; overflow: hidden; }
.mv-root { display: flex; flex-direction: column; height: 100vh; }
.mv-top { padding: 8px 12px 0; }
.mv-title { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 6px; }
.mv-title h2 { margin: 0; font-size: 1.1em; }
.mv-main { flex: 1; display: flex; min-height: 0; }
.mv-stage { flex: 1; min-width: 0; position: relative; display: flex; align-items: center; justify-content: center; overflow: hidden; }
.mv-stage canvas { cursor: grab; touch-action: none; }
.mv-stage canvas.dragging { cursor: grabbing; }
.mv-bg-checker { background-color: #2b2b2b; background-image: linear-gradient(45deg, #353535 25%, transparent 25%), linear-gradient(-45deg, #353535 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #353535 75%), linear-gradient(-45deg, transparent 75%, #353535 75%); background-size: 24px 24px; background-position: 0 0, 0 12px, 12px -12px, -12px 0; }
body.vscode-light .mv-bg-checker { background-color: #e9e9e9; background-image: linear-gradient(45deg, #d6d6d6 25%, transparent 25%), linear-gradient(-45deg, #d6d6d6 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #d6d6d6 75%), linear-gradient(-45deg, transparent 75%, #d6d6d6 75%); }
.mv-bg-dark { background: #141414; }
.mv-bg-light { background: #f3f3f3; }
.mv-side { width: 320px; flex: 0 0 320px; overflow-y: auto; border-left: 1px solid var(--vscode-panel-border, rgba(128,128,128,.35)); padding: 8px 10px; display: flex; flex-direction: column; gap: 10px; }
.mv-section h3 { margin: 0 0 6px; font-size: 0.95em; display: flex; align-items: center; gap: 6px; }
.mv-list { display: flex; flex-direction: column; gap: 1px; }
.mv-item { display: flex; align-items: center; gap: 8px; padding: 3px 6px; border-radius: 3px; cursor: pointer; min-width: 0; }
.mv-item:hover, .mv-item.hl { background: var(--vscode-list-hoverBackground); }
.mv-item .mono { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; line-height: 1.45; }
.mv-item.missing { outline: 1px solid var(--vscode-errorForeground); }
.mv-small { font-size: 0.85em; }
.mv-thumb { width: 32px; height: 32px; image-rendering: pixelated; flex: 0 0 32px; background: repeating-conic-gradient(#8885 0 25%, transparent 0 50%) 0 0/8px 8px; }
.mv-props { display: grid; grid-template-columns: auto 1fr; gap: 4px 8px; align-items: center; }
.mv-presets { display: flex; flex-wrap: wrap; gap: 4px; }
.mv-presets .mc-button { padding: 2px 8px; }
.mv-presets .mc-button.active { outline: 1px solid var(--vscode-focusBorder); }
.mv-toggles { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
.mv-toggles label { display: inline-flex; gap: 4px; align-items: center; }
.mv-hint { position: absolute; left: 10px; bottom: 8px; font-size: 0.8em; opacity: 0.7; pointer-events: none; color: #fff; text-shadow: 0 1px 2px #000; }
.mv-bg-light .mv-hint, body.vscode-light .mv-bg-checker .mv-hint { color: #222; text-shadow: none; }
.mv-notes { display: flex; flex-direction: column; gap: 4px; }
.mv-err { color: var(--vscode-errorForeground); }
.mv-chain { display: flex; flex-wrap: wrap; gap: 2px 4px; align-items: center; }
.mv-chain a { cursor: pointer; }
`;

const DEFAULT_OPTIONS: ViewOptions = { outline: false, grid: true, axes: false, background: 'checker' };
const ISO: Transform = { rotation: [30, 225, 0], translation: [0, 0, 0], scale: [0.625, 0.625, 0.625] };
const VIEWS: Record<string, Vec3> = {
  iso: [30, 225, 0],
  front: [0, 180, 0],
  back: [0, 0, 0],
  side: [0, 270, 0],
  top: [90, 0, 0],
};
const VIEW_LABELS: Record<string, string> = {
  iso: 'Isometric',
  front: 'Front (north)',
  back: 'Back (south)',
  side: 'Side (east)',
  top: 'Top',
};
const DISPLAY_ORDER = ['gui', 'ground', 'fixed', 'head', 'thirdperson_righthand', 'thirdperson_lefthand', 'firstperson_righthand', 'firstperson_lefthand', 'on_shelf'];
const DISPLAY_LABELS: Record<string, string> = {
  gui: 'GUI',
  ground: 'Ground',
  fixed: 'Item frame',
  head: 'Head',
  thirdperson_righthand: '3rd person R',
  thirdperson_lefthand: '3rd person L',
  firstperson_righthand: '1st person R',
  firstperson_lefthand: '1st person L',
  on_shelf: 'Shelf',
};

// ---------- projection (mirrors itemRenderer drawModel) ----------
type Mat3 = number[];
const DEG = Math.PI / 180;
const rx = (a: number): Mat3 => [1, 0, 0, 0, Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a)];
const ry = (a: number): Mat3 => [Math.cos(a), 0, Math.sin(a), 0, 1, 0, -Math.sin(a), 0, Math.cos(a)];
const rz = (a: number): Mat3 => [Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a), 0, 0, 0, 1];
function mul(a: Mat3, b: Mat3): Mat3 {
  const r = new Array(9).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j];
  return r;
}
function projector(tf: Transform, size: number, zoom: number) {
  const R = mul(mul(rx(tf.rotation[0] * DEG), ry(tf.rotation[1] * DEG)), rz(tf.rotation[2] * DEG));
  const k = (size / 16) * zoom;
  return (p: Vec3): [number, number] => {
    const c = [(p[0] - 8) * tf.scale[0], (p[1] - 8) * tf.scale[1], (p[2] - 8) * tf.scale[2]];
    const q = [R[0] * c[0] + R[1] * c[1] + R[2] * c[2], R[3] * c[0] + R[4] * c[1] + R[5] * c[2]];
    return [size / 2 + (q[0] + tf.translation[0]) * k, size / 2 - (q[1] + tf.translation[1]) * k];
  };
}

// ---------- item/generated extrusion ----------
async function extrude(layers: GeneratedLayer[]): Promise<{ elements: ResolvedElement[]; tint?: string }> {
  const out: ResolvedElement[] = [];
  let tint: string | undefined;
  for (const [li, layer] of layers.entries()) {
    const ref = layer.texture;
    if (!ref) continue;
    if (layer.tint && !tint) tint = layer.tint;
    const z0 = 7.5 - li * 0.02;
    const z1 = 8.5 + li * 0.02;
    const ti = layer.tint ? 0 : undefined;
    out.push({
      from: [0, 0, z0],
      to: [16, 16, z1],
      faces: { south: { texture: ref, uv: [0, 0, 16, 16], tintindex: ti }, north: { texture: ref, uv: [16, 0, 0, 16], tintindex: ti } },
    });
    const img = await loadImage(ref.src);
    if (!img) continue;
    const [fx, fy, fw, fh] = textureFrame(ref, img);
    let alpha: Uint8ClampedArray | null = null;
    try {
      const c = document.createElement('canvas');
      c.width = fw;
      c.height = fh;
      const g = c.getContext('2d')!;
      g.drawImage(img, fx, fy, fw, fh, 0, 0, fw, fh);
      alpha = g.getImageData(0, 0, fw, fh).data;
    } catch {
      alpha = null;
    }
    if (!alpha || fw * fh > 128 * 128) continue;
    const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < fw && y < fh && alpha![(y * fw + x) * 4 + 3] > 8;
    const pw = 16 / fw;
    const ph = 16 / fh;
    for (let y = 0; y < fh; y++)
      for (let x = 0; x < fw; x++) {
        if (!solid(x, y)) continue;
        const uv: [number, number, number, number] = [x * pw, y * ph, (x + 1) * pw, (y + 1) * ph];
        const face = { texture: ref, uv, tintindex: ti };
        const x0 = x * pw, x1 = (x + 1) * pw, yTop = 16 - y * ph, yBot = 16 - (y + 1) * ph;
        if (!solid(x - 1, y)) out.push({ from: [x0, yBot, z0], to: [x0, yTop, z1], faces: { west: face } });
        if (!solid(x + 1, y)) out.push({ from: [x1, yBot, z0], to: [x1, yTop, z1], faces: { east: face } });
        if (!solid(x, y - 1)) out.push({ from: [x0, yTop, z0], to: [x1, yTop, z1], faces: { up: face } });
        if (!solid(x, y + 1)) out.push({ from: [x0, yBot, z0], to: [x1, yBot, z1], faces: { down: face } });
      }
  }
  return { elements: out, tint };
}

// ---------- components ----------
function TextureThumb({ tex }: { tex: TextureRef | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, 32, 32);
    g.imageSmoothingEnabled = false;
    if (!tex) {
      g.fillStyle = '#f800f8';
      g.fillRect(0, 0, 16, 16);
      g.fillRect(16, 16, 16, 16);
      g.fillStyle = '#000';
      g.fillRect(16, 0, 16, 16);
      g.fillRect(0, 16, 16, 16);
      return;
    }
    let alive = true;
    void loadImage(tex.src).then((img) => {
      if (!alive || !img) return;
      const [x, y, w, h] = textureFrame(tex, img);
      g.drawImage(img, x, y, w, h, 0, 0, 32, 32);
    });
    return () => {
      alive = false;
    };
  }, [tex?.src, tex?.rect?.join(',')]);
  return <canvas ref={ref} class="mv-thumb" width={32} height={32} />;
}

function App() {
  const init = boot<{ uri: string; customEditor?: boolean }>().state;
  const persisted = (vsState.get<Persisted>() ?? {}) as Persisted;
  const [model, setModel] = useState<ViewerModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selection, setSelection] = useState<ViewerSelection>(persisted.selection ?? {});
  const [options, setOptions] = useState<ViewOptions>({ ...DEFAULT_OPTIONS, ...(persisted.options ?? {}) });
  const [transform, setTransform] = useState<Transform>(ISO);
  const [preset, setPreset] = useState('gui');
  const [zoom, setZoom] = useState(1);
  const [hover, setHover] = useState<number | undefined>(undefined);
  const [prepared, setPrepared] = useState<PreparedVisual | null>(null);
  const [size, setSize] = useState(480);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const selRef = useRef(selection);
  selRef.current = selection;
  const firstLoad = useRef(true);

  const load = async (sel: ViewerSelection) => {
    try {
      const m = await call<ViewerModel>('viewer.load', sel);
      setModel(m);
      setError('');
      if (firstLoad.current) {
        firstLoad.current = false;
        applyPreset(m.kind === 'blockstate' ? 'iso' : 'gui', m);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(selection);
    return onEvent('viewer.changed', () => void load(selRef.current));
  }, []);

  useEffect(() => {
    vsState.set<Persisted>({ options, selection });
  }, [options, selection]);

  const select = (patch: ViewerSelection) => {
    const next = { ...selection, ...patch };
    setSelection(next);
    void load(next);
  };

  // Build the drawable visual (model elements + extruded generated layers) and preload images
  useEffect(() => {
    if (!model) return;
    let alive = true;
    (async () => {
      const ex = model.generated.length ? await extrude(model.generated) : { elements: [], tint: undefined };
      const p = await prepareVisual({ type: 'model', id: model.id, elements: [...model.elements, ...ex.elements], tint: model.tint ?? ex.tint });
      if (alive) setPrepared(p);
    })();
    return () => {
      alive = false;
    };
  }, [model]);

  // Stage size
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize(Math.max(160, Math.floor(Math.min(r.width, r.height) - 16)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Draw
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const px = Math.round(size * dpr);
    const g = c.getContext('2d')!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, c.width, c.height);
    const project = projector(transform, px, zoom * 0.8);
    if (options.grid) drawGrid(g, project, options.background === 'light', dpr);
    if (prepared) {
      drawPrepared(
        c,
        { ...prepared, visual: { ...(prepared.visual as any), gui: transform } },
        { size: px, zoom: zoom * 0.8, clear: false, outline: options.outline, highlightElement: hover },
      );
    }
    if (options.axes) drawAxes(g, project, dpr);
  }, [prepared, transform, zoom, options, hover, size]);

  function applyPreset(name: string, m: ViewerModel | null = model) {
    setPreset(name);
    if (VIEWS[name]) {
      setTransform({ rotation: [...VIEWS[name]] as Vec3, translation: [0, 0, 0], scale: m?.generated.length && !m.elements.length ? [1, 1, 1] : [0.625, 0.625, 0.625] });
      return;
    }
    const d: ModelDisplayTransform = m?.display[name] ?? (name === 'gui' && !(m?.generated.length && !m.elements.length) ? ISO : {});
    setTransform({
      rotation: (d.rotation ?? [0, 0, 0]).map(Number) as Vec3,
      translation: (d.translation ?? [0, 0, 0]).map(Number) as Vec3,
      scale: (d.scale ?? [1, 1, 1]).map(Number) as Vec3,
    });
  }

  // Drag to rotate, wheel to zoom
  const drag = useRef<{ x: number; y: number; rot: Vec3 } | null>(null);
  const onPointerDown = (e: PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, rot: [...transform.rotation] as Vec3 };
    canvasRef.current?.classList.add('dragging');
  };
  const onPointerMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    setPreset('');
    setTransform((tf) => ({ ...tf, rotation: [Math.max(-90, Math.min(90, d.rot[0] + dy * 0.5)), d.rot[1] - dx * 0.5, d.rot[2]] }));
  };
  const onPointerUp = () => {
    drag.current = null;
    canvasRef.current?.classList.remove('dragging');
  };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    setZoom((z) => Math.max(0.2, Math.min(8, z * Math.exp(-e.deltaY * 0.0015))));
  };

  const displayKeys = useMemo(() => {
    if (!model) return [];
    const keys = DISPLAY_ORDER.filter((k) => model.display[k] || (k === 'gui' && model.kind !== 'blockstate'));
    return keys.concat(Object.keys(model.display).filter((k) => !DISPLAY_ORDER.includes(k)));
  }, [model]);
  const missing = model?.textures.filter((x) => x.missing).length ?? 0;
  const setOpt = (patch: Partial<ViewOptions>) => setOptions({ ...options, ...patch });

  return (
    <div class="mv-root">
      <style>{CSS}</style>
      <div class="mv-top">
        <div class="mv-title">
          <h2 class="mono">{model?.id ?? '…'}</h2>
          {model ? <span class="mc-badge">{model.kind === 'blockstate' ? t('Blockstate') : model.kind === 'item' ? t('Item definition') : t('Model')}</span> : null}
          {model ? <span class="mc-muted mv-small">Minecraft {model.version}</span> : null}
          <span class="mc-spacer" />
          <Button secondary onClick={() => void call('viewer.openText', {})} title={t('Open the JSON in a text editor')}>
            {t('Open JSON')}
          </Button>
        </div>
        <div class="mc-toolbar">
          <div class="mv-presets">
            {displayKeys.map((k) => (
              <Button key={k} secondary class={preset === k ? 'active' : ''} onClick={() => applyPreset(k)} title={k}>
                {t(DISPLAY_LABELS[k] ?? k)}
              </Button>
            ))}
            {Object.keys(VIEWS).map((k) => (
              <Button key={k} secondary class={preset === k ? 'active' : ''} onClick={() => applyPreset(k)}>
                {t(VIEW_LABELS[k])}
              </Button>
            ))}
          </div>
          <span class="mc-spacer" />
          <div class="mv-toggles">
            <label>
              <input type="checkbox" checked={options.outline} onChange={(e) => setOpt({ outline: (e.target as HTMLInputElement).checked })} />
              {t('Outlines')}
            </label>
            <label>
              <input type="checkbox" checked={options.grid} onChange={(e) => setOpt({ grid: (e.target as HTMLInputElement).checked })} />
              {t('Grid')}
            </label>
            <label>
              <input type="checkbox" checked={options.axes} onChange={(e) => setOpt({ axes: (e.target as HTMLInputElement).checked })} />
              {t('Axes')}
            </label>
            <select class="mc-select" value={options.background} onChange={(e) => setOpt({ background: (e.target as HTMLSelectElement).value as Background })} title={t('Background')}>
              <option value="checker">{t('Checker')}</option>
              <option value="dark">{t('Dark')}</option>
              <option value="light">{t('Light')}</option>
            </select>
            <span class="mc-muted mv-small">{Math.round(zoom * 100)}%</span>
            <Button secondary onClick={() => { setZoom(1); applyPreset(preset || 'iso'); }}>{t('Reset')}</Button>
          </div>
        </div>
      </div>
      <div class="mv-main">
        <div ref={stageRef} class={`mv-stage mv-bg-${options.background}`}>
          <canvas
            ref={canvasRef}
            width={Math.round(size * dpr)}
            height={Math.round(size * dpr)}
            style={{ width: `${size}px`, height: `${size}px` }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onWheel={onWheel}
          />
          <div class="mv-hint">{loading ? t('Loading…') : t('Drag to rotate · wheel to zoom')}</div>
        </div>
        <div class="mv-side">
          {error ? <div class="mv-err">{error}</div> : null}
          {model?.errors.length || model?.notes.length ? (
            <div class="mv-notes">
              {model.errors.map((e) => (
                <div class="mv-err">⚠ {e}</div>
              ))}
              {model.notes.map((n) => (
                <div class="mc-warning mv-small">ℹ {t(n)}</div>
              ))}
            </div>
          ) : null}

          {model?.kind === 'blockstate' && model.properties ? (
            <div class="mv-section">
              <h3>{t('Block state')}</h3>
              {model.properties.length ? (
                <div class="mv-props">
                  {model.properties.map((p) => (
                    <>
                      <label class="mono mv-small">{p.name}</label>
                      <select class="mc-select" value={model.state?.[p.name]} onChange={(e) => select({ state: { ...(model.state ?? {}), [p.name]: (e.target as HTMLSelectElement).value } })}>
                        {p.values.map((v) => (
                          <option value={v}>{v}</option>
                        ))}
                      </select>
                    </>
                  ))}
                  {model.alternatives && model.alternatives > 1 ? (
                    <>
                      <label class="mv-small">{t('Random variant')}</label>
                      <select class="mc-select" value={String(selection.alt ?? 0)} onChange={(e) => select({ alt: Number((e.target as HTMLSelectElement).value) })}>
                        {Array.from({ length: model.alternatives }, (_, i) => (
                          <option value={String(i)}>{t('Variant {0} of {1}', i + 1, model.alternatives!)}</option>
                        ))}
                      </select>
                    </>
                  ) : null}
                </div>
              ) : (
                <div class="mc-muted mv-small">{t('This block has no properties.')}</div>
              )}
            </div>
          ) : null}

          {model?.kind === 'item' && model.branches ? (
            <div class="mv-section">
              <h3>{t('Model branch')}</h3>
              <select class="mc-select" style={{ width: '100%' }} value={model.branch} onChange={(e) => select({ branch: (e.target as HTMLSelectElement).value })}>
                {model.branches.map((b) => (
                  <option value={b.id}>{b.label}</option>
                ))}
              </select>
            </div>
          ) : null}

          {model && model.models.length ? (
            <div class="mv-section">
              <h3>
                {model.kind === 'model' ? t('Parent chain') : t('Rendered models')} <span class="mc-badge">{model.kind === 'model' ? model.chain.length : model.models.length}</span>
              </h3>
              {model.kind === 'model' ? (
                <div class="mv-chain mv-small">
                  {model.chain.map((c, i) => (
                    <>
                      {i ? <span class="mc-muted">→</span> : null}
                      <a class={`mono ${c.found ? '' : 'mc-error'}`} title={c.found ? t('Open model') : t('Not found')} onClick={() => i && call('viewer.openModel', { id: c.id })}>
                        {c.id.replace(/^minecraft:/, '')}
                      </a>
                    </>
                  ))}
                </div>
              ) : (
                <div class="mv-list">
                  {model.models.map((m) => (
                    <div class="mv-item mv-small" onClick={() => call('viewer.openModel', { id: m.model })} title={m.label}>
                      <span class="mono mc-grow">{m.model.replace(/^minecraft:/, '')}</span>
                      <span class="mc-muted">
                        {m.x ? `x${m.x} ` : ''}
                        {m.y ? `y${m.y} ` : ''}
                        {m.uvlock ? 'uvlock' : ''}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}

          {model ? (
            <div class="mv-section">
              <h3>
                {t('Textures')} <span class="mc-badge">{model.textures.length}</span>
                {missing ? <span class="mc-error mv-small">{t('{0} missing', missing)}</span> : null}
              </h3>
              <div class="mv-list">
                {model.textures.map((tx: ViewerTexture) => (
                  <div
                    class={`mv-item ${tx.missing ? 'missing' : ''}`}
                    title={`${tx.model}\n#${tx.name} = ${tx.raw}${tx.id && tx.id !== tx.raw ? `\n→ ${tx.id}` : ''}${tx.missing ? `\n${t('Missing texture')}` : ''}`}
                    onClick={() => tx.fileUri && call('file.open', { uri: tx.fileUri })}
                  >
                    <TextureThumb tex={tx.ref} />
                    <div class="mc-col mc-grow" style={{ gap: '0' }}>
                      <span class="mono mv-small">#{tx.name}</span>
                      <span class={`mono mv-small ${tx.missing ? 'mc-error' : 'mc-muted'}`}>{tx.missing ? `${tx.raw} — ${t('missing')}` : (tx.id ?? tx.raw).replace(/^minecraft:/, '')}</span>
                    </div>
                    {tx.uses ? <span class="mc-muted mv-small">×{tx.uses}</span> : null}
                  </div>
                ))}
                {!model.textures.length ? <div class="mc-muted mv-small">{t('No textures')}</div> : null}
              </div>
            </div>
          ) : null}

          {model && model.elementInfo.length ? (
            <div class="mv-section">
              <h3>
                {t('Elements')} <span class="mc-badge">{model.elementInfo.length}</span>
              </h3>
              <div class="mv-list" onMouseLeave={() => setHover(undefined)}>
                {model.elementInfo.map((el) => (
                  <div
                    class={`mv-item mv-small ${hover === el.index ? 'hl' : ''}`}
                    onMouseEnter={() => setHover(el.index)}
                    onClick={() => el.line !== undefined && call('viewer.openText', { line: el.line })}
                    title={`${el.model}${el.line !== undefined ? `\n${t('Click to reveal in the JSON')}` : ''}`}
                  >
                    <span class="mc-muted">#{el.index}</span>
                    <span class="mono mc-grow">
                      {el.name ? `${el.name} ` : ''}[{el.from?.join(', ')}] → [{el.to?.join(', ')}]
                    </span>
                    {el.rotation ? <span class="mc-muted">⟳ {el.rotation}</span> : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          {model && !model.elementInfo.length && model.generated.length ? (
            <div class="mc-muted mv-small">{t('Generated item: {0} layer(s) extruded like in game.', model.generated.length)}</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function drawGrid(g: CanvasRenderingContext2D, project: (p: Vec3) => [number, number], light: boolean, dpr: number) {
  g.save();
  g.lineWidth = dpr;
  for (let i = 0; i <= 16; i++) {
    const strong = i === 0 || i === 16 || i === 8;
    g.strokeStyle = light ? (strong ? 'rgba(0,0,0,0.35)' : 'rgba(0,0,0,0.12)') : strong ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.12)';
    for (const [a, b] of [
      [[i, 0, 0], [i, 0, 16]],
      [[0, 0, i], [16, 0, i]],
    ] as [Vec3, Vec3][]) {
      const p = project(a), q = project(b);
      g.beginPath();
      g.moveTo(p[0], p[1]);
      g.lineTo(q[0], q[1]);
      g.stroke();
    }
  }
  // North marker
  const n = project([8, 0, -1.5]);
  g.fillStyle = light ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.6)';
  g.font = `${11 * dpr}px sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('N', n[0], n[1]);
  g.restore();
}

function drawAxes(g: CanvasRenderingContext2D, project: (p: Vec3) => [number, number], dpr: number) {
  const o = project([0, 0, 0]);
  g.save();
  g.lineWidth = 2 * dpr;
  g.font = `bold ${11 * dpr}px sans-serif`;
  for (const [end, color, label] of [
    [[20, 0, 0], '#ff5555', 'X'],
    [[0, 20, 0], '#55dd55', 'Y'],
    [[0, 0, 20], '#5599ff', 'Z'],
  ] as [Vec3, string, string][]) {
    const p = project(end);
    g.strokeStyle = color;
    g.beginPath();
    g.moveTo(o[0], o[1]);
    g.lineTo(p[0], p[1]);
    g.stroke();
    g.fillStyle = color;
    g.fillText(label, p[0] + 4 * dpr, p[1]);
  }
  g.restore();
}

render(<App />, document.getElementById('app')!);
