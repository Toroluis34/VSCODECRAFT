// Numeric Minecraft colours (RGB / ARGB ints) in JSON. Pure module.
// String colours in text components ("color": "#ff00ff") are handled by the translations feature.
import type { JsonPath } from './context';

/** Keys whose numeric value is an RGB(A) int. */
const COLOR_KEYS = new Set([
  'color', 'rgb', 'custom_color', 'color_when_undyed', 'default', 'value',
  'fog_color', 'sky_color', 'water_color', 'water_fog_color', 'foliage_color', 'grass_color', 'dry_foliage_color',
  'minecraft:dyed_color', 'dyed_color', 'minecraft:map_color', 'map_color',
]);
/** Keys whose array elements are colours (firework explosions). */
const COLOR_ARRAY_KEYS = new Set(['colors', 'fade_colors']);

/**
 * Whether a number at `path` is a colour. `owner` is the object holding the final key (used to
 * restrict ambiguous keys such as "value"/"default" to tint sources).
 */
export function isColorPath(path: JsonPath, owner?: Record<string, unknown>): boolean {
  if (!path.length) return false;
  const last = path[path.length - 1];
  if (typeof last === 'number') {
    const key = path[path.length - 2];
    return typeof key === 'string' && COLOR_ARRAY_KEYS.has(key);
  }
  if (!COLOR_KEYS.has(last)) return false;
  if (last === 'value' || last === 'default') {
    // tint sources: {"type": "minecraft:constant", "value": -1} / {"type": "minecraft:dye", "default": -6265536}
    return path.includes('tints') || /constant|dye|firework|potion|map_color|team|custom_model_data/.test(String(owner?.type ?? ''));
  }
  if (last === 'rgb') return path.some((p) => typeof p === 'string' && /dyed_color/.test(p));
  return true;
}

export interface Rgba {
  red: number;
  green: number;
  blue: number;
  alpha: number;
}

/** Decode an int colour. Values outside 0..0xFFFFFF are treated as ARGB (signed or unsigned). */
export function intToRgba(n: number): Rgba {
  const u = n >>> 0;
  const hasAlpha = n < 0 || n > 0xffffff;
  return {
    red: ((u >> 16) & 0xff) / 255,
    green: ((u >> 8) & 0xff) / 255,
    blue: (u & 0xff) / 255,
    alpha: hasAlpha ? ((u >>> 24) & 0xff) / 255 : 1,
  };
}

/** Encode a colour as an int. `argb` keeps an alpha channel (written as a signed 32-bit int like the game). */
export function rgbaToInt(c: Rgba, argb: boolean): number {
  const r = Math.round(c.red * 255);
  const g = Math.round(c.green * 255);
  const b = Math.round(c.blue * 255);
  const rgb = (r << 16) | (g << 8) | b;
  if (!argb) return rgb;
  const a = Math.round(c.alpha * 255);
  return ((a << 24) | rgb) | 0;
}

export function toHex(c: Rgba): string {
  const h = (x: number) => Math.round(x * 255).toString(16).padStart(2, '0');
  return `#${h(c.red)}${h(c.green)}${h(c.blue)}`;
}
