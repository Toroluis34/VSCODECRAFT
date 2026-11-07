// Side panels of the texture editor: colours & palettes, previews, animation, dialogs.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { t } from '../shared/i18n';
import { drawPrepared, prepareVisual, type PreparedVisual } from '../shared/itemRenderer';
import type { ItemVisual } from '../../src/shared/protocol';
import {
  type ColorAdjust,
  crop,
  dominantHue,
  frameRect,
  type FrameLayout,
  hexToRgba,
  type Rgba,
  rgbaToHex,
  type RgbaImage,
} from '../../src/features/textures/pixels';
import { type AnimationSettings, formatFrameList, parseFrameList, stepAt, type TimelineStep } from '../../src/features/textures/mcmeta';
import type { NamedPalette } from '../../src/features/textures/protocol';
import { imageToCanvas, imageToDataUrl, PixelImage } from '../textureShared/canvas';
import { Icon, ToolButton } from '../textureShared/icons';
import { AdjustControls } from '../textureShared/adjust';

// ---------- colours ----------

/** Minecraft dye colours + a grey ramp, always available (offline). */
export const BUILTIN_PALETTES: NamedPalette[] = [
  {
    name: 'Minecraft dyes',
    colors: ['#f9fffe', '#9d9d97', '#474f52', '#1d1d21', '#835432', '#b02e26', '#f9801d', '#fed83d', '#80c71f', '#5e7c16', '#169c9c', '#3ab3da', '#3c44aa', '#8932b8', '#c74ebd', '#f38baa'],
  },
  {
    name: 'Greys',
    colors: ['#000000', '#1b1b1b', '#2f2f2f', '#434343', '#585858', '#6d6d6d', '#838383', '#999999', '#afafaf', '#c6c6c6', '#dcdcdc', '#f2f2f2', '#ffffff'],
  },
];

function Swatch(p: { color: Rgba; size?: number; active?: boolean; title?: string; onClick?: (e: MouseEvent) => void; onContextMenu?: (e: MouseEvent) => void }): JSX.Element {
  const s = p.size ?? 18;
  return (
    <button
      class={`tex-swatch tex-checker ${p.active ? 'active' : ''}`}
      style={{ width: `${s}px`, height: `${s}px` }}
      title={p.title ?? rgbaToHex(p.color)}
      onClick={p.onClick}
      onContextMenu={(e) => {
        e.preventDefault();
        p.onContextMenu?.(e);
      }}
    >
      <span style={{ background: `rgba(${p.color[0]},${p.color[1]},${p.color[2]},${p.color[3] / 255})` }} />
    </button>
  );
}

export interface ColorPanelProps {
  primary: Rgba;
  secondary: Rgba;
  setPrimary: (c: Rgba) => void;
  setSecondary: (c: Rgba) => void;
  textureColors: Rgba[];
  palettes: NamedPalette[];
}

export function ColorPanel(p: ColorPanelProps): JSX.Element {
  const [which, setWhich] = useState<'primary' | 'secondary'>('primary');
  const current = which === 'primary' ? p.primary : p.secondary;
  const set = which === 'primary' ? p.setPrimary : p.setSecondary;
  const [hexText, setHexText] = useState(rgbaToHex(current));
  useEffect(() => setHexText(rgbaToHex(current)), [current.join(',')]);
  const [paletteIndex, setPaletteIndex] = useState(0);
  const all = [...BUILTIN_PALETTES.map((x) => ({ ...x, name: t(x.name) })), ...p.palettes];
  const preset = all[Math.min(paletteIndex, all.length - 1)];

  return (
    <div class="tex-panel tex-colors">
      <div class="tex-section-title">{t('Colours')}</div>
      <div class="tex-color-pair">
        <button class={`tex-big-swatch tex-checker secondary ${which === 'secondary' ? 'active' : ''}`} title={t('Secondary colour (right click)')} onClick={() => setWhich('secondary')}>
          <span style={{ background: rgbaCss(p.secondary) }} />
        </button>
        <button class={`tex-big-swatch tex-checker primary ${which === 'primary' ? 'active' : ''}`} title={t('Primary colour (left click)')} onClick={() => setWhich('primary')}>
          <span style={{ background: rgbaCss(p.primary) }} />
        </button>
        <button
          class="tex-tool tex-swap"
          title={t('Swap colours (X)')}
          onClick={() => {
            const a = p.primary;
            p.setPrimary(p.secondary);
            p.setSecondary(a);
          }}
        >
          <Icon name="swap" />
        </button>
      </div>
      <div class="tex-color-edit">
        <input
          type="color"
          value={rgbaToHex([current[0], current[1], current[2], 255], false)}
          onInput={(e) => {
            const c = hexToRgba((e.target as HTMLInputElement).value);
            if (c) set([c[0], c[1], c[2], current[3] || 255]);
          }}
          title={t('Pick a colour')}
        />
        <input
          class="mc-input mono tex-hex"
          value={hexText}
          spellcheck={false}
          onInput={(e) => setHexText((e.target as HTMLInputElement).value)}
          onChange={(e) => {
            const c = hexToRgba((e.target as HTMLInputElement).value);
            if (c) set(c);
            else setHexText(rgbaToHex(current));
          }}
          title={t('Hex colour (#rrggbb or #rrggbbaa)')}
        />
      </div>
      <label class="tex-slider">
        <span>{t('Alpha')}</span>
        <input type="range" min={0} max={255} value={current[3]} onInput={(e) => set([current[0], current[1], current[2], Number((e.target as HTMLInputElement).value)])} />
        <output>{Math.round((current[3] / 255) * 100)}%</output>
      </label>

      <div class="tex-section-title tex-gap">{t('Texture colours')}</div>
      <div class="tex-swatches">
        {p.textureColors.length ? (
          p.textureColors.map((c) => <Swatch key={c.join(',')} color={c} onClick={() => p.setPrimary(c)} onContextMenu={() => p.setSecondary(c)} />)
        ) : (
          <span class="mc-muted">{t('Empty texture')}</span>
        )}
      </div>

      <div class="tex-section-title tex-gap">{t('Palette')}</div>
      <select class="mc-select tex-full" value={String(paletteIndex)} onChange={(e) => setPaletteIndex(Number((e.target as HTMLSelectElement).value))}>
        {all.map((x, i) => (
          <option value={String(i)} key={x.name}>
            {x.name}
          </option>
        ))}
      </select>
      <div class="tex-swatches">
        {preset?.colors.map((h) => {
          const c = hexToRgba(h)!;
          return <Swatch key={h} color={c} onClick={() => p.setPrimary(c)} onContextMenu={() => p.setSecondary(c)} />;
        })}
      </div>
      <div class="mc-muted tex-hint">{t('Left click: primary · Right click: secondary')}</div>
    </div>
  );
}

export function rgbaCss(c: Rgba): string {
  return `rgba(${c[0]},${c[1]},${c[2]},${c[3] / 255})`;
}

// ---------- previews ----------

export interface PreviewProps {
  /** Image of the frame to show (already the right frame). */
  frame: RgbaImage;
  /** Next frame + mix factor for interpolated playback. */
  blend?: { next: RgbaImage; amount: number };
}

export function TiledPreview({ frame, blend }: PreviewProps): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null);
  const size = 168;
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const g = c.getContext('2d')!;
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, c.width, c.height);
    const a = imageToCanvas(frame);
    const b = blend && blend.amount > 0 ? imageToCanvas(blend.next) : undefined;
    const cell = size / 3;
    for (let y = 0; y < 3; y++)
      for (let x = 0; x < 3; x++) {
        g.globalAlpha = 1;
        g.drawImage(a, x * cell, y * cell, cell, cell);
        if (b) {
          g.globalAlpha = blend!.amount;
          g.drawImage(b, x * cell, y * cell, cell, cell);
        }
      }
    g.globalAlpha = 1;
  }, [frame, blend?.next, blend?.amount]);
  return <canvas ref={ref} class="tex-checker tex-pixelated tex-preview-canvas" width={size} height={size} title={t('Tiled preview (3 × 3)')} />;
}

/** Live 3D preview using the shared item renderer with a hand-built visual (data: URL texture). */
export function BlockPreview({ frame, mode }: { frame: RgbaImage; mode: 'block' | 'item' }): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null);
  const prepared = useRef<PreparedVisual | null>(null);
  const [rot, setRot] = useState<[number, number]>([30, 225]);
  const drag = useRef<{ x: number; y: number; r: [number, number] } | null>(null);
  const size = 168;

  const draw = () => {
    const c = ref.current;
    if (!c || !prepared.current) return;
    drawPrepared(c, prepared.current, mode === 'block' ? { rotation: [rot[0], rot[1], 0], zoom: 1.0 } : { zoom: 0.8 });
  };

  useEffect(() => {
    let alive = true;
    const h = window.setTimeout(async () => {
      const src = imageToDataUrl(frame);
      const texture = { src };
      const face = { texture };
      const visual: ItemVisual =
        mode === 'block'
          ? { type: 'model', id: 'preview', elements: [{ from: [0, 0, 0], to: [16, 16, 16], faces: { up: face, down: face, north: face, south: face, east: face, west: face } }] }
          : { type: 'flat', id: 'preview', layers: [{ texture }] };
      const p = await prepareVisual(visual);
      if (!alive) return;
      prepared.current = p;
      draw();
    }, 60);
    return () => {
      alive = false;
      window.clearTimeout(h);
    };
  }, [frame, mode]);

  useEffect(draw, [rot]);

  return (
    <canvas
      ref={ref}
      class="tex-preview-canvas tex-preview-3d"
      width={size}
      height={size}
      title={mode === 'block' ? t('Drag to rotate') : t('Item preview')}
      onPointerDown={(e) => {
        if (mode !== 'block') return;
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, y: e.clientY, r: rot };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        setRot([Math.max(-89, Math.min(89, d.r[0] + (e.clientY - d.y) * 0.6)), d.r[1] - (e.clientX - d.x) * 0.8]);
      }}
      onPointerUp={() => (drag.current = null)}
      onDblClick={() => setRot([30, 225])}
    />
  );
}

// ---------- animation ----------

export interface AnimationPanelProps {
  img: RgbaImage;
  layout: FrameLayout;
  frame: number;
  setFrame: (i: number) => void;
  anim: AnimationSettings | undefined;
  hasMcmeta: boolean;
  playing: boolean;
  setPlaying: (v: boolean) => void;
  onion: boolean;
  setOnion: (v: boolean) => void;
  addFrame: (duplicate: boolean) => void;
  removeFrame: () => void;
  moveFrame: (dir: -1 | 1) => void;
  setAnim: (a: AnimationSettings) => void;
  playStep: number;
}

export function AnimationPanel(p: AnimationPanelProps): JSX.Element {
  const frames = useMemo(() => Array.from({ length: p.layout.count }, (_, i) => crop(p.img, frameRect(p.layout, i))), [p.img, p.layout.count, p.layout.frameHeight]);
  const [orderText, setOrderText] = useState(formatFrameList(p.anim?.frames));
  const [orderError, setOrderError] = useState('');
  useEffect(() => {
    setOrderText(formatFrameList(p.anim?.frames));
    setOrderError('');
  }, [JSON.stringify(p.anim?.frames ?? null)]);
  const anim: AnimationSettings = p.anim ?? { frametime: 1, interpolate: false };
  const animated = p.layout.count > 1;

  return (
    <div class="tex-panel tex-anim">
      <div class="tex-row-between">
        <div class="tex-section-title">{t('Animation')}</div>
        {animated ? <span class="mc-badge">{t('{0} frames', p.layout.count)}</span> : null}
      </div>
      <div class="tex-frames">
        {frames.map((f, i) => (
          <div class={`tex-frame ${i === p.frame ? 'active' : ''} ${p.playing && i === p.playStep ? 'playing' : ''}`} key={i} onClick={() => p.setFrame(i)} title={t('Frame {0}', i)}>
            <PixelImage img={f} size={40} />
            <span>{i}</span>
          </div>
        ))}
      </div>
      <div class="tex-row">
        <ToolButton icon="plus" title={t('Add frame (duplicate current)')} onClick={() => p.addFrame(true)} />
        <ToolButton icon="copy" title={t('Add blank frame')} onClick={() => p.addFrame(false)} />
        <ToolButton icon="trash" title={t('Remove frame')} disabled={!animated} onClick={p.removeFrame} />
        <ToolButton icon="left" title={t('Move frame left')} disabled={!animated || p.frame === 0} onClick={() => p.moveFrame(-1)} />
        <ToolButton icon="right" title={t('Move frame right')} disabled={!animated || p.frame >= p.layout.count - 1} onClick={() => p.moveFrame(1)} />
        <span class="tex-sep" />
        <ToolButton icon={p.playing ? 'pause' : 'play'} title={p.playing ? t('Pause') : t('Play animation')} disabled={!animated} active={p.playing} onClick={() => p.setPlaying(!p.playing)} />
        <ToolButton icon="onion" title={t('Onion skin (show previous frame)')} disabled={!animated} active={p.onion} onClick={() => p.setOnion(!p.onion)} />
      </div>
      {animated || p.hasMcmeta ? (
        <div class="tex-anim-settings">
          <label class="tex-field-row">
            <span>{t('Frame time')}</span>
            <input
              class="mc-input"
              type="number"
              min={1}
              value={anim.frametime}
              onChange={(e) => {
                const v = Math.max(1, Math.round(Number((e.target as HTMLInputElement).value) || 1));
                p.setAnim({ ...anim, frametime: v });
              }}
            />
            <span class="mc-muted">{t('ticks ({0} s)', (anim.frametime / 20).toFixed(2))}</span>
          </label>
          <label class="tex-check">
            <input type="checkbox" checked={anim.interpolate} onChange={(e) => p.setAnim({ ...anim, interpolate: (e.target as HTMLInputElement).checked })} />
            {t('Interpolate frames')}
          </label>
          <label class="tex-field-col">
            <span>{t('Frame order (optional, e.g. 0, 1, 2:10)')}</span>
            <input
              class={`mc-input mono ${orderError ? 'tex-invalid' : ''}`}
              value={orderText}
              placeholder={Array.from({ length: Math.min(p.layout.count, 6) }, (_, i) => i).join(', ')}
              onInput={(e) => setOrderText((e.target as HTMLInputElement).value)}
              onChange={() => {
                try {
                  const frames = parseFrameList(orderText);
                  const bad = frames?.find((f) => f.index >= p.layout.count);
                  if (bad) throw new Error(t('Frame {0} does not exist', bad.index));
                  setOrderError('');
                  p.setAnim({ ...anim, frames });
                } catch (err) {
                  setOrderError(err instanceof Error ? err.message : String(err));
                }
              }}
            />
            {orderError ? <span class="mc-error">{orderError}</span> : null}
          </label>
        </div>
      ) : (
        <div class="mc-muted tex-hint">{t('Add a frame to turn this texture into an animation.')}</div>
      )}
    </div>
  );
}

/** Frame (and interpolation blend) to show at a playback tick. */
export function playbackFrame(timeline: TimelineStep[], tick: number, interpolate: boolean): { frame: number; next?: number; amount: number; step: number } {
  if (!timeline.length) return { frame: 0, amount: 0, step: 0 };
  const { step, progress } = stepAt(timeline, tick);
  const cur = timeline[step];
  const nxt = timeline[(step + 1) % timeline.length];
  return interpolate && nxt.frame !== cur.frame ? { frame: cur.frame, next: nxt.frame, amount: progress, step } : { frame: cur.frame, amount: 0, step };
}

// ---------- dialogs ----------

export type AdjustScope = 'selection' | 'frame' | 'all';

export function AdjustDialog(p: {
  title: string;
  value: ColorAdjust;
  onChange: (a: ColorAdjust) => void;
  scope: AdjustScope;
  setScope: (s: AdjustScope) => void;
  hasSelection: boolean;
  animated: boolean;
  source: RgbaImage;
  onApply: () => void;
  onCancel: () => void;
  onVariantFiles?: () => void;
}): JSX.Element {
  return (
    <div class="tex-dialog" role="dialog" aria-label={p.title}>
      <div class="tex-dialog-title">{p.title}</div>
      <AdjustControls value={p.value} onChange={p.onChange} source={p.source} />
      <div class="tex-field-row tex-gap">
        <span>{t('Apply to')}</span>
        <select class="mc-select" value={p.scope} onChange={(e) => p.setScope((e.target as HTMLSelectElement).value as AdjustScope)}>
          {p.hasSelection ? <option value="selection">{t('Selection')}</option> : null}
          {p.animated ? <option value="frame">{t('Current frame')}</option> : null}
          <option value="all">{p.animated ? t('All frames') : t('Whole texture')}</option>
        </select>
      </div>
      <div class="tex-dialog-buttons">
        {p.onVariantFiles ? (
          <button class="mc-button secondary" onClick={p.onVariantFiles} title={t('Write recoloured copies of several textures (ruby_* → sapphire_*)')}>
            {t('Variant files…')}
          </button>
        ) : null}
        <span class="mc-spacer" />
        <button class="mc-button secondary" onClick={() => p.onChange({})}>
          {t('Reset')}
        </button>
        <button class="mc-button secondary" onClick={p.onCancel}>
          {t('Cancel')}
        </button>
        <button class="mc-button" onClick={p.onApply}>
          {t('Apply')}
        </button>
      </div>
    </div>
  );
}

export type ResizeMode = 'scale' | 'canvas' | 'new';

export function ResizeDialog(p: { width: number; height: number; animated: boolean; onApply: (w: number, h: number, mode: ResizeMode) => void; onCancel: () => void }): JSX.Element {
  const [w, setW] = useState(p.width);
  const [h, setH] = useState(p.height);
  const [mode, setMode] = useState<ResizeMode>('scale');
  const valid = w >= 1 && h >= 1 && w <= 1024 && h <= 1024;
  return (
    <div class="tex-dialog" role="dialog" aria-label={t('Resize')}>
      <div class="tex-dialog-title">{p.animated ? t('Resize frames') : t('Resize / new canvas')}</div>
      <div class="tex-chips">
        {[16, 32, 64, 128].map((s) => (
          <button
            key={s}
            class={`tex-chip ${w === s && h === s ? 'active' : ''}`}
            onClick={() => {
              setW(s);
              setH(s);
            }}
          >
            {s} × {s}
          </button>
        ))}
      </div>
      <div class="tex-field-row tex-gap">
        <span>{t('Width')}</span>
        <input class="mc-input" type="number" min={1} max={1024} value={w} onInput={(e) => setW(Number((e.target as HTMLInputElement).value))} />
        <span>{t('Height')}</span>
        <input class="mc-input" type="number" min={1} max={1024} value={h} onInput={(e) => setH(Number((e.target as HTMLInputElement).value))} />
      </div>
      <div class="tex-radio-list">
        <label class="tex-check">
          <input type="radio" name="mode" checked={mode === 'scale'} onChange={() => setMode('scale')} />
          {t('Scale pixels (nearest neighbour)')}
        </label>
        <label class="tex-check">
          <input type="radio" name="mode" checked={mode === 'canvas'} onChange={() => setMode('canvas')} />
          {t('Change canvas size (keep pixels, centred)')}
        </label>
        <label class="tex-check">
          <input type="radio" name="mode" checked={mode === 'new'} onChange={() => setMode('new')} />
          {t('New blank canvas (discard pixels)')}
        </label>
      </div>
      {(w & (w - 1)) !== 0 ? <div class="mc-warning tex-hint">{t('Widths that are not a power of two can break mipmaps in Minecraft.')}</div> : null}
      <div class="tex-dialog-buttons">
        <span class="mc-spacer" />
        <button class="mc-button secondary" onClick={p.onCancel}>
          {t('Cancel')}
        </button>
        <button class="mc-button" disabled={!valid} onClick={() => p.onApply(w, h, mode)}>
          {t('Apply')}
        </button>
      </div>
    </div>
  );
}
