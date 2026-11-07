// Hue / saturation / brightness controls with material presets (editor dialog + material variant panel).
import { useMemo } from 'preact/hooks';
import type { JSX } from 'preact';
import { t } from '../shared/i18n';
import { type ColorAdjust, dominantHue, type RgbaImage } from '../../src/features/textures/pixels';

export const MATERIALS: [string, number][] = [
  ['Ruby', 350],
  ['Copper', 22],
  ['Topaz', 45],
  ['Peridot', 85],
  ['Emerald', 140],
  ['Aquamarine', 180],
  ['Sapphire', 222],
  ['Amethyst', 275],
  ['Rose quartz', 320],
];

/** Hue shift (-180..180) that moves `from` to `to`. */
export function hueDelta(from: number, to: number): number {
  return Math.round(((((to - from + 180) % 360) + 360) % 360) - 180);
}

export function AdjustControls(p: { value: ColorAdjust; onChange: (a: ColorAdjust) => void; source: RgbaImage | undefined }): JSX.Element {
  const v = p.value;
  const baseHue = useMemo(() => (p.source ? dominantHue(p.source) : undefined), [p.source]);
  const slider = (key: 'hue' | 'saturation' | 'brightness' | 'contrast', label: string, min: number, max: number, unit: string) => (
    <label class="tex-slider">
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        value={v[key] ?? 0}
        disabled={key === 'hue' && v.colorize !== undefined}
        onInput={(e) => p.onChange({ ...v, [key]: Number((e.target as HTMLInputElement).value) })}
        onDblClick={() => p.onChange({ ...v, [key]: 0 })}
      />
      <output>
        {v[key] ?? 0}
        {unit}
      </output>
    </label>
  );
  return (
    <div class="tex-adjust">
      {slider('hue', t('Hue'), -180, 180, '°')}
      {slider('saturation', t('Saturation'), -100, 100, '%')}
      {slider('brightness', t('Brightness'), -100, 100, '%')}
      {slider('contrast', t('Contrast'), -100, 100, '%')}
      <label class="tex-check">
        <input type="checkbox" checked={v.colorize !== undefined} onChange={(e) => p.onChange({ ...v, colorize: (e.target as HTMLInputElement).checked ? Math.round(baseHue ?? 0) : undefined })} />
        {t('Colorize (single hue)')}
      </label>
      {v.colorize !== undefined ? (
        <label class="tex-slider">
          <span>{t('Target hue')}</span>
          <input type="range" min={0} max={359} value={v.colorize} class="tex-hue-range" onInput={(e) => p.onChange({ ...v, colorize: Number((e.target as HTMLInputElement).value) })} />
          <output>{v.colorize}°</output>
        </label>
      ) : null}
      <label class="tex-check" title={t('Keeps wooden handles, outlines and other materials unchanged')}>
        <input
          type="checkbox"
          checked={!!v.mask}
          disabled={baseHue === undefined && !v.mask}
          onChange={(e) => p.onChange({ ...v, mask: (e.target as HTMLInputElement).checked ? { hue: Math.round(baseHue ?? 0), tolerance: 35 } : undefined })}
        />
        {t('Only the main colour')}
        {v.mask ? <span class="tex-dot" style={{ background: `hsl(${v.mask.hue} 70% 50%)` }} /> : null}
      </label>
      {v.mask ? (
        <label class="tex-slider">
          <span>{t('Tolerance')}</span>
          <input type="range" min={5} max={180} value={v.mask.tolerance} onInput={(e) => p.onChange({ ...v, mask: { ...v.mask!, tolerance: Number((e.target as HTMLInputElement).value) } })} />
          <output>±{v.mask.tolerance}°</output>
        </label>
      ) : null}
      <div class="tex-section-title tex-gap">{t('Material presets')}</div>
      <div class="tex-chips">
        {MATERIALS.map(([name, hue]) => (
          <button
            class="tex-chip"
            key={name}
            title={baseHue === undefined ? t('Colorize to {0}°', hue) : t('Shift hue from {0}° to {1}°', Math.round(baseHue), hue)}
            onClick={() => {
              if (baseHue === undefined || v.colorize !== undefined) p.onChange({ ...v, colorize: hue, hue: 0 });
              else p.onChange({ ...v, hue: hueDelta(baseHue, hue), colorize: undefined });
            }}
          >
            <span class="tex-dot" style={{ background: `hsl(${hue} 70% 50%)` }} />
            {t(name)}
          </button>
        ))}
      </div>
    </div>
  );
}

export const ADJUST_CSS = `
.tex-adjust { display: flex; flex-direction: column; gap: 8px; }
.tex-chips { display: flex; flex-wrap: wrap; gap: 4px; }
.tex-check { display: inline-flex; gap: 6px; align-items: center; font-size: 12px; cursor: pointer; }
.tex-gap { margin-top: 12px; }
.tex-dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; overflow: hidden; vertical-align: middle; flex: 0 0 auto; }
.tex-hue-range { background: linear-gradient(90deg, red, yellow, lime, cyan, blue, magenta, red); border-radius: 4px; height: 8px; appearance: none; -webkit-appearance: none; }
.tex-hue-range::-webkit-slider-thumb { -webkit-appearance: none; width: 12px; height: 16px; border-radius: 3px; background: #fff; border: 1px solid #555; }
`;
