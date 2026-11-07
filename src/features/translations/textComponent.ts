// Minecraft text components: legacy "§" strings <-> JSON components <-> SNBT, version-specific
// event formats (click_event/hover_event since 1.21.5 vs clickEvent/hoverEvent before),
// flattening to styled segments and an SVG renderer for previews.
// Pure module (no 'vscode' / Node imports) — shared with webviews and unit tested.

export type TextComponent = string | number | boolean | TextComponent[] | TextObject;

export interface TextObject {
  type?: string;
  text?: string;
  translate?: string;
  fallback?: string;
  with?: TextComponent[];
  keybind?: string;
  score?: { name: string; objective: string; value?: string };
  selector?: string;
  separator?: TextComponent;
  nbt?: string;
  source?: string;
  block?: string;
  entity?: string;
  storage?: string;
  interpret?: boolean;
  object?: string;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  underlined?: boolean;
  strikethrough?: boolean;
  obfuscated?: boolean;
  font?: string;
  /** ARGB int or [r, g, b, a] floats 0..1 (1.21.4+). */
  shadow_color?: number | number[];
  insertion?: string;
  click_event?: ClickEventModern;
  hover_event?: HoverEventModern;
  clickEvent?: { action: string; value?: string };
  hoverEvent?: { action: string; contents?: any; value?: any };
  extra?: TextComponent[];
  [k: string]: unknown;
}

export interface ClickEventModern {
  action: string;
  url?: string;
  command?: string;
  page?: number;
  value?: string;
  path?: string;
  dialog?: unknown;
  id?: string;
  payload?: unknown;
}

export interface HoverEventModern {
  action: string;
  value?: TextComponent;
  id?: string;
  count?: number;
  components?: Record<string, unknown>;
  uuid?: string | number[];
  name?: TextComponent;
}

/** Format differences of text components between versions. */
export interface TextFormat {
  /** click_event / hover_event with typed fields (1.21.5+) instead of clickEvent / hoverEvent. */
  snakeCaseEvents: boolean;
  /** shadow_color field exists (1.21.4+). */
  shadowColor: boolean;
  /** Commands and item components take SNBT text components (1.21.5+) instead of JSON strings. */
  snbt: boolean;
}

export const MODERN_FORMAT: TextFormat = { snakeCaseEvents: true, shadowColor: true, snbt: true };
export const LEGACY_FORMAT: TextFormat = { snakeCaseEvents: false, shadowColor: false, snbt: false };

// ---------------------------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------------------------

/** Named text colours with their § code and RGB. */
export const NAMED_COLORS: { name: string; code: string; hex: string }[] = [
  { name: 'black', code: '0', hex: '#000000' },
  { name: 'dark_blue', code: '1', hex: '#0000AA' },
  { name: 'dark_green', code: '2', hex: '#00AA00' },
  { name: 'dark_aqua', code: '3', hex: '#00AAAA' },
  { name: 'dark_red', code: '4', hex: '#AA0000' },
  { name: 'dark_purple', code: '5', hex: '#AA00AA' },
  { name: 'gold', code: '6', hex: '#FFAA00' },
  { name: 'gray', code: '7', hex: '#AAAAAA' },
  { name: 'dark_gray', code: '8', hex: '#555555' },
  { name: 'blue', code: '9', hex: '#5555FF' },
  { name: 'green', code: 'a', hex: '#55FF55' },
  { name: 'aqua', code: 'b', hex: '#55FFFF' },
  { name: 'red', code: 'c', hex: '#FF5555' },
  { name: 'light_purple', code: 'd', hex: '#FF55FF' },
  { name: 'yellow', code: 'e', hex: '#FFFF55' },
  { name: 'white', code: 'f', hex: '#FFFFFF' },
];

export const FORMAT_CODES: Record<string, keyof Style> = {
  k: 'obfuscated',
  l: 'bold',
  m: 'strikethrough',
  n: 'underlined',
  o: 'italic',
};

const COLOR_BY_NAME = new Map(NAMED_COLORS.map((c) => [c.name, c]));
const COLOR_BY_CODE = new Map(NAMED_COLORS.map((c) => [c.code, c]));

/** "#RRGGBB" for a named colour or hex string; undefined when invalid. */
export function colorToHex(color: string | undefined): string | undefined {
  if (!color) return undefined;
  const named = COLOR_BY_NAME.get(color.toLowerCase());
  if (named) return named.hex;
  const m = /^#([0-9a-f]{6})$/i.exec(color);
  return m ? `#${m[1].toUpperCase()}` : undefined;
}

export function isNamedColor(name: string): boolean {
  return COLOR_BY_NAME.has(name);
}

/** Named colour with an exact RGB match, if any. */
export function exactNamedColor(hex: string): string | undefined {
  const h = hex.toUpperCase();
  return NAMED_COLORS.find((c) => c.hex === h)?.name;
}

/** Closest named colour (for legacy § output). */
export function nearestNamedColor(hex: string): { name: string; code: string; hex: string } {
  const [r, g, b] = hexToRgb(hex);
  let best = NAMED_COLORS[15];
  let bestD = Infinity;
  for (const c of NAMED_COLORS) {
    const [cr, cg, cb] = hexToRgb(c.hex);
    const d = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2;
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', '').slice(0, 6), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Minecraft's default text shadow: RGB / 4. */
export function defaultShadow(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  const f = (x: number) => Math.floor(x / 4).toString(16).padStart(2, '0');
  return `#${f(r)}${f(g)}${f(b)}`.toUpperCase();
}

/** shadow_color (ARGB int or [r,g,b,a] floats) -> "#RRGGBB" + alpha 0..1. */
export function shadowColorToCss(v: number | number[] | undefined): { hex: string; alpha: number } | undefined {
  if (v === undefined) return undefined;
  if (Array.isArray(v)) {
    const c = (x: number | undefined) => Math.round(Math.max(0, Math.min(1, x ?? 1)) * 255).toString(16).padStart(2, '0');
    return { hex: `#${c(v[0])}${c(v[1])}${c(v[2])}`.toUpperCase(), alpha: Math.max(0, Math.min(1, v[3] ?? 1)) };
  }
  const n = v >>> 0;
  return { hex: `#${(n & 0xffffff).toString(16).padStart(6, '0')}`.toUpperCase(), alpha: ((n >>> 24) & 255) / 255 };
}

/** "#RRGGBB" + alpha 0..1 -> ARGB int (signed, as Minecraft stores it). */
export function cssToShadowColor(hex: string, alpha = 1): number {
  const rgb = parseInt(hex.replace('#', ''), 16) & 0xffffff;
  return ((Math.round(alpha * 255) << 24) | rgb) | 0;
}

// ---------------------------------------------------------------------------------------------
// Styles & segments
// ---------------------------------------------------------------------------------------------

export interface Style {
  color?: string;
  bold?: boolean;
  italic?: boolean;
  underlined?: boolean;
  strikethrough?: boolean;
  obfuscated?: boolean;
  font?: string;
  shadow_color?: number | number[];
}

export interface Segment extends Style {
  text: string;
}

const STYLE_KEYS: (keyof Style)[] = ['color', 'bold', 'italic', 'underlined', 'strikethrough', 'obfuscated', 'font', 'shadow_color'];
const BOOL_KEYS = ['bold', 'italic', 'underlined', 'strikethrough', 'obfuscated', 'interpret'];

// ---------------------------------------------------------------------------------------------
// Legacy § strings
// ---------------------------------------------------------------------------------------------

/** Replace "&x" colour codes with "§x" (only valid codes). */
export function ampersandToSection(s: string): string {
  return s.replace(/&([0-9a-fk-or])/gi, '§$1');
}

/** Parse a legacy "§" string into styled segments (colour codes reset formatting, like vanilla). */
export function parseLegacySegments(s: string, base: Style = {}): Segment[] {
  const out: Segment[] = [];
  let style: Style = { ...base };
  let buf = '';
  const flush = () => {
    if (buf) out.push({ ...style, text: buf });
    buf = '';
  };
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '§' && i + 1 < s.length) {
      const c = s[i + 1].toLowerCase();
      // Bukkit hex: §x§R§R§G§G§B§B
      if (c === 'x' && /^(§[0-9a-f]){6}$/i.test(s.slice(i + 2, i + 14))) {
        flush();
        const hex = s.slice(i + 2, i + 14).replace(/§/g, '').toUpperCase();
        style = { color: `#${hex}` };
        i += 13;
        continue;
      }
      const col = COLOR_BY_CODE.get(c);
      if (col) {
        flush();
        style = { color: col.name };
        i++;
        continue;
      }
      if (FORMAT_CODES[c]) {
        flush();
        style = { ...style, [FORMAT_CODES[c]]: true };
        i++;
        continue;
      }
      if (c === 'r') {
        flush();
        style = { ...base };
        i++;
        continue;
      }
    }
    buf += ch;
  }
  flush();
  return out;
}

export function hasLegacyCodes(s: string): boolean {
  return /§[0-9a-fk-orx]/i.test(s);
}

/** Strip § codes. */
export function stripLegacy(s: string): string {
  return s.replace(/§x(§[0-9a-f]){6}/gi, '').replace(/§[0-9a-fk-or]/gi, '');
}

/** Legacy § string -> JSON text component (string when unstyled, object or {"text":"",extra} otherwise). */
export function legacyToComponent(s: string): TextComponent {
  const segs = parseLegacySegments(s);
  const parts = segs.map(segmentToObject);
  if (!parts.length) return '';
  if (parts.length === 1) {
    const p = parts[0];
    return Object.keys(p).length === 1 ? p.text! : p;
  }
  return { text: '', extra: parts.map((p) => (Object.keys(p).length === 1 ? p.text! : p)) };
}

function segmentToObject(seg: Segment): TextObject {
  const o: TextObject = { text: seg.text };
  for (const k of STYLE_KEYS) if (seg[k] !== undefined && seg[k] !== false) (o as any)[k] = seg[k];
  return o;
}

/** Styled segments -> legacy § string (hex colours become the nearest named colour). */
export function segmentsToLegacy(segs: Segment[]): string {
  let out = '';
  let cur: Style = {};
  const same = (a: Style, b: Style) =>
    legacyCode(a.color) === legacyCode(b.color) && FORMAT_KEYS.every((k) => !!a[k] === !!b[k]);
  for (const s of segs) {
    if (!s.text) continue;
    if (!same(cur, s)) {
      const lostFormat = FORMAT_KEYS.some((k) => cur[k] && !s[k]);
      const colorChanged = legacyCode(cur.color) !== legacyCode(s.color);
      if (colorChanged || lostFormat) {
        if (s.color) out += `§${legacyCode(s.color)}`;
        else if (Object.keys(cur).length) out += '§r';
        for (const [code, k] of Object.entries(FORMAT_CODES)) if (s[k]) out += `§${code}`;
      } else {
        for (const [code, k] of Object.entries(FORMAT_CODES)) if (s[k] && !cur[k]) out += `§${code}`;
      }
      cur = { ...s };
    }
    out += s.text;
  }
  return out;
}

const FORMAT_KEYS = Object.values(FORMAT_CODES);

function legacyCode(color: string | undefined): string | undefined {
  if (!color) return undefined;
  const named = COLOR_BY_NAME.get(color);
  if (named) return named.code;
  const hex = colorToHex(color);
  return hex ? nearestNamedColor(hex).code : undefined;
}

// ---------------------------------------------------------------------------------------------
// Flattening components
// ---------------------------------------------------------------------------------------------

export interface FlattenContext {
  /** Resolve a translation key (en_us or current locale). */
  translate?: (key: string) => string | undefined;
  /** Display text for a keybind ("key.jump" -> "Space"). */
  keybind?: (key: string) => string | undefined;
  /** Interpret § codes inside plain text / translations (Minecraft does). Default true. */
  legacyInText?: boolean;
}

const KEYBINDS: Record<string, string> = {
  'key.jump': 'Space',
  'key.sneak': 'Left Shift',
  'key.sprint': 'Left Control',
  'key.forward': 'W',
  'key.back': 'S',
  'key.left': 'A',
  'key.right': 'D',
  'key.inventory': 'E',
  'key.drop': 'Q',
  'key.chat': 'T',
  'key.command': '/',
  'key.attack': 'Left Button',
  'key.use': 'Right Button',
  'key.pickItem': 'Middle Button',
  'key.swapOffhand': 'F',
  'key.playerlist': 'Tab',
  'key.screenshot': 'F2',
  'key.togglePerspective': 'F5',
  'key.advancements': 'L',
  'key.fullscreen': 'F11',
};

/** Flatten a component into styled text segments (children inherit their parent's style). */
export function flatten(component: TextComponent, ctx: FlattenContext = {}, inherited: Style = {}, depth = 0): Segment[] {
  if (depth > 32) return [];
  const legacy = ctx.legacyInText !== false;
  const textSegs = (s: string, style: Style): Segment[] =>
    legacy && s.includes('§') ? parseLegacySegments(s, style) : s ? [{ ...style, text: s }] : [];
  if (typeof component === 'string') return textSegs(component, inherited);
  if (typeof component === 'number' || typeof component === 'boolean') return [{ ...inherited, text: String(component) }];
  if (Array.isArray(component)) {
    if (!component.length) return [];
    // First element is the parent of the others.
    const [first, ...rest] = component;
    const firstObj: TextObject = typeof first === 'object' && !Array.isArray(first) ? first : { text: String(first) };
    return flatten({ ...firstObj, extra: [...(firstObj.extra ?? []), ...rest] }, ctx, inherited, depth + 1);
  }
  if (!component || typeof component !== 'object') return [];
  const c = component;
  const style: Style = { ...inherited };
  for (const k of STYLE_KEYS) {
    const v = (c as any)[k];
    if (v !== undefined) (style as any)[k] = BOOL_KEYS.includes(k) ? toBool(v) : v;
  }
  const out: Segment[] = [];
  if (c.text !== undefined) out.push(...textSegs(String(c.text), style));
  else if (c.translate !== undefined) {
    const template = ctx.translate?.(c.translate) ?? c.fallback ?? c.translate;
    const args = c.with ?? [];
    out.push(...formatTranslation(template, args, style, ctx, depth));
  } else if (c.keybind !== undefined) {
    const k = c.keybind;
    out.push({ ...style, text: ctx.keybind?.(k) ?? KEYBINDS[k] ?? humanizeKey(k) });
  } else if (c.score) {
    out.push({ ...style, text: c.score.value ?? `${c.score.name}:${c.score.objective}` });
  } else if (c.selector !== undefined) {
    out.push({ ...style, text: c.selector });
  } else if (c.nbt !== undefined) {
    out.push({ ...style, text: `[${c.nbt}]` });
  } else if (c.object !== undefined || c.type === 'object') {
    out.push({ ...style, text: '■' });
  }
  for (const e of c.extra ?? []) out.push(...flatten(e, ctx, style, depth + 1));
  return out;
}

function toBool(v: unknown): boolean {
  return v === true || v === 1 || v === 'true' || v === '1b';
}

function humanizeKey(k: string): string {
  const last = k.split('.').pop() ?? k;
  return last.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').replace(/^\w/, (x) => x.toUpperCase());
}

/** Substitute %s / %1$s / %% in a translation template. */
function formatTranslation(template: string, args: TextComponent[], style: Style, ctx: FlattenContext, depth: number): Segment[] {
  const out: Segment[] = [];
  let auto = 0;
  let last = 0;
  const literal = (s: string) => {
    if (!s) return;
    out.push(...(ctx.legacyInText !== false && s.includes('§') ? parseLegacySegments(s, style) : [{ ...style, text: s }]));
  };
  for (const m of template.matchAll(/%(?:(\d+)\$)?([sd%])/g)) {
    literal(template.slice(last, m.index));
    last = m.index! + m[0].length;
    if (m[2] === '%') {
      literal('%');
      continue;
    }
    const idx = m[1] ? Number(m[1]) - 1 : auto++;
    const arg = args[idx];
    if (arg === undefined) continue;
    out.push(...flatten(arg, ctx, style, depth + 1));
  }
  literal(template.slice(last));
  return out;
}

/** Plain text of a component. */
export function plainText(component: TextComponent, ctx: FlattenContext = {}): string {
  return flatten(component, ctx)
    .map((s) => s.text)
    .join('');
}

/** Component -> legacy § string. */
export function componentToLegacy(component: TextComponent, ctx: FlattenContext = {}): string {
  return segmentsToLegacy(flatten(component, ctx));
}

// ---------------------------------------------------------------------------------------------
// Version-specific events
// ---------------------------------------------------------------------------------------------

function mapChildren(c: TextObject, fn: (x: TextComponent) => TextComponent): TextObject {
  const o: TextObject = { ...c };
  if (o.extra) o.extra = o.extra.map(fn);
  if (o.with) o.with = o.with.map(fn);
  if (o.separator !== undefined) o.separator = fn(o.separator);
  return o;
}

/**
 * Convert a component to the format of a target version:
 *  - 1.21.5+: click_event {action, url|command|page|value|path}, hover_event {action, value|id,count,components|id,uuid,name}
 *  - ≤1.21.4: clickEvent {action, value}, hoverEvent {action, contents}
 *  - shadow_color removed before 1.21.4. Boolean-ish numbers become booleans.
 */
export function convertComponent(component: TextComponent, format: TextFormat): TextComponent {
  if (Array.isArray(component)) return component.map((x) => convertComponent(x, format));
  if (!component || typeof component !== 'object') return component;
  let o = mapChildren(component, (x) => convertComponent(x, format));
  for (const k of BOOL_KEYS) if (k in o && typeof o[k] !== 'boolean') (o as any)[k] = toBool(o[k]);
  if (!format.shadowColor) delete o.shadow_color;
  o = format.snakeCaseEvents ? modernEvents(o, format) : legacyEvents(o, format);
  return o;
}

function modernEvents(o: TextObject, format: TextFormat): TextObject {
  const out: TextObject = {};
  for (const [k, v] of Object.entries(o)) {
    if (k === 'clickEvent' && v && typeof v === 'object') out.click_event = clickToModern(v as any);
    else if (k === 'hoverEvent' && v && typeof v === 'object') out.hover_event = hoverToModern(v as any, format);
    else if (k === 'hover_event' && v && typeof v === 'object') out.hover_event = hoverToModern(v as any, format);
    else (out as any)[k] = v;
  }
  return out;
}

function legacyEvents(o: TextObject, format: TextFormat): TextObject {
  const out: TextObject = {};
  for (const [k, v] of Object.entries(o)) {
    if (k === 'click_event' && v && typeof v === 'object') out.clickEvent = clickToLegacy(v as any);
    else if (k === 'hover_event' && v && typeof v === 'object') out.hoverEvent = hoverToLegacy(v as any, format);
    else if (k === 'hoverEvent' && v && typeof v === 'object') out.hoverEvent = hoverToLegacy(v as any, format);
    else (out as any)[k] = v;
  }
  return out;
}

export function clickToModern(e: { action: string; value?: unknown; [k: string]: unknown }): ClickEventModern {
  if (!('value' in e) || e.action === 'copy_to_clipboard') return e as ClickEventModern;
  const v = e.value === undefined ? undefined : String(e.value);
  switch (e.action) {
    case 'open_url':
      return { action: e.action, url: v };
    case 'run_command':
    case 'suggest_command':
      return { action: e.action, command: v };
    case 'change_page':
      return { action: e.action, page: Number(v) || 1 };
    case 'open_file':
      return { action: e.action, path: v };
    default:
      return { action: e.action, value: v };
  }
}

export function clickToLegacy(e: ClickEventModern): { action: string; value: string } {
  const v = e.url ?? e.command ?? (e.page !== undefined ? String(e.page) : undefined) ?? e.path ?? e.value ?? '';
  return { action: e.action, value: String(v) };
}

function hoverToModern(e: any, format: TextFormat): HoverEventModern {
  if (e.action === 'show_text') {
    const v = e.value ?? e.contents;
    return { action: 'show_text', value: v === undefined ? '' : convertComponent(v, format) };
  }
  if (e.action === 'show_item') {
    const c = e.contents ?? (typeof e.value === 'string' ? { id: e.value } : undefined);
    if (c) return { action: 'show_item', ...(typeof c === 'string' ? { id: c } : c) };
    return { action: 'show_item', id: e.id, count: e.count, components: e.components };
  }
  if (e.action === 'show_entity') {
    const c = e.contents;
    if (c) {
      const out: HoverEventModern = { action: 'show_entity', id: c.type, uuid: c.id };
      if (c.name !== undefined) out.name = convertComponent(c.name, format);
      return out;
    }
    return { ...e, name: e.name === undefined ? undefined : convertComponent(e.name, format) };
  }
  return e;
}

function hoverToLegacy(e: any, format: TextFormat): { action: string; contents?: unknown } {
  if (e.action === 'show_text') {
    const v = e.contents ?? e.value;
    return { action: 'show_text', contents: v === undefined ? '' : convertComponent(v, format) };
  }
  if (e.action === 'show_item') {
    if (e.contents) return e;
    const c: Record<string, unknown> = { id: e.id };
    if (e.count !== undefined) c.count = e.count;
    if (e.components !== undefined) c.components = e.components;
    return { action: 'show_item', contents: c };
  }
  if (e.action === 'show_entity') {
    if (e.contents) return e;
    const c: Record<string, unknown> = { type: e.id, id: e.uuid };
    if (e.name !== undefined) c.name = convertComponent(e.name, format);
    return { action: 'show_entity', contents: c };
  }
  return e;
}

// ---------------------------------------------------------------------------------------------
// SNBT
// ---------------------------------------------------------------------------------------------

const UNQUOTED = /^[A-Za-z0-9._+-]+$/;

export function snbtString(s: string): string {
  if (s.includes('"') && !s.includes("'")) return `'${s.replace(/\\/g, '\\\\')}'`;
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}

/** Serialize a JSON-like value as SNBT (booleans as true/false, floats as plain doubles). */
export function toSnbt(value: unknown): string {
  if (value === null || value === undefined) return '""';
  if (typeof value === 'string') return snbtString(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : `${value}d`;
  if (Array.isArray(value)) return `[${value.map(toSnbt).join(',')}]`;
  const parts: string[] = [];
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v === undefined) continue;
    parts.push(`${UNQUOTED.test(k) ? k : snbtString(k)}:${toSnbt(v)}`);
  }
  return `{${parts.join(',')}}`;
}

/** Parse SNBT into a JSON-like value. Numbers lose their type suffix; typed arrays become arrays. */
export function parseSnbt(src: string): unknown {
  let i = 0;
  const ws = () => {
    while (i < src.length && /\s/.test(src[i])) i++;
  };
  const err = (m: string) => new Error(`SNBT: ${m} at ${i}`);
  const value = (): unknown => {
    ws();
    const ch = src[i];
    if (ch === '{') return compound();
    if (ch === '[') return list();
    if (ch === '"' || ch === "'") return quoted();
    return scalar(unquoted());
  };
  const quoted = (): string => {
    const q = src[i++];
    let s = '';
    while (i < src.length && src[i] !== q) {
      if (src[i] === '\\') {
        const n = src[++i];
        s += n === 'n' ? '\n' : n === 't' ? '\t' : n;
        i++;
      } else s += src[i++];
    }
    if (src[i] !== q) throw err('unterminated string');
    i++;
    return s;
  };
  const unquoted = (): string => {
    const start = i;
    while (i < src.length && /[A-Za-z0-9._+-]/.test(src[i])) i++;
    if (start === i) throw err(`unexpected "${src[i] ?? 'end'}"`);
    return src.slice(start, i);
  };
  const scalar = (s: string): unknown => {
    if (s === 'true') return true;
    if (s === 'false') return false;
    const m = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)([bslfd]?)$/i.exec(s);
    if (m) return Number(m[1]);
    return s;
  };
  const compound = (): Record<string, unknown> => {
    i++;
    const out: Record<string, unknown> = {};
    ws();
    if (src[i] === '}') {
      i++;
      return out;
    }
    for (;;) {
      ws();
      const key = src[i] === '"' || src[i] === "'" ? quoted() : unquoted();
      ws();
      if (src[i] !== ':') throw err('expected ":"');
      i++;
      out[key] = value();
      ws();
      if (src[i] === ',') {
        i++;
        continue;
      }
      if (src[i] === '}') {
        i++;
        return out;
      }
      throw err('expected "," or "}"');
    }
  };
  const list = (): unknown[] => {
    i++;
    ws();
    if (/^[BIL];/.test(src.slice(i, i + 2))) i += 2;
    const out: unknown[] = [];
    ws();
    if (src[i] === ']') {
      i++;
      return out;
    }
    for (;;) {
      out.push(value());
      ws();
      if (src[i] === ',') {
        i++;
        continue;
      }
      if (src[i] === ']') {
        i++;
        return out;
      }
      throw err('expected "," or "]"');
    }
  };
  const v = value();
  ws();
  if (i < src.length) throw err('trailing characters');
  return v;
}

/** Component as SNBT for 1.21.5+ commands / item components. */
export function componentToSnbt(component: TextComponent, format: TextFormat = MODERN_FORMAT): string {
  return toSnbt(convertComponent(component, format));
}

export function componentToJson(component: TextComponent, format: TextFormat = MODERN_FORMAT, indent?: number | string): string {
  return JSON.stringify(convertComponent(component, format), null, indent);
}

/** Argument for /tellraw, /title, item components ... in the target version's syntax. */
export function componentArgument(component: TextComponent, format: TextFormat): string {
  return format.snbt ? componentToSnbt(component, format) : componentToJson(component, format);
}

/** `/tellraw @a <component>` */
export function tellrawCommand(component: TextComponent, format: TextFormat, target = '@a'): string {
  return `/tellraw ${target} ${componentArgument(component, format)}`;
}

/** Item component `custom_name=...` (JSON string in single quotes before 1.21.5, SNBT after). */
export function itemNameComponent(component: TextComponent, format: TextFormat, field = 'custom_name'): string {
  if (format.snbt) return `${field}=${componentToSnbt(component, format)}`;
  const json = componentToJson(component, format);
  return `${field}='${json.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/** `/give @p minecraft:paper[custom_name=...]` */
export function giveCommand(component: TextComponent, format: TextFormat, item = 'minecraft:paper'): string {
  return `/give @p ${item}[${itemNameComponent(component, format)}]`;
}

/**
 * Parse user input as a component: JSON, SNBT, or a plain/legacy string ("&" codes accepted).
 * Throws only when the input looks structured ({ or [) but is invalid.
 */
export function parseComponentInput(input: string): TextComponent {
  const s = input.trim();
  if (!s) return '';
  if (s.startsWith('{') || s.startsWith('[') || s.startsWith('"')) {
    try {
      return JSON.parse(s) as TextComponent;
    } catch {
      return parseSnbt(s) as TextComponent;
    }
  }
  return legacyToComponent(ampersandToSection(input));
}

/** True when an object looks like a text component. */
export function isTextObject(v: unknown): v is TextObject {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  return ['text', 'translate', 'keybind', 'score', 'selector', 'nbt'].some((k) => k in o) && Object.keys(o).every((k) => TEXT_KEYS.has(k));
}

const TEXT_KEYS = new Set([
  'type', 'text', 'translate', 'fallback', 'with', 'keybind', 'score', 'selector', 'separator', 'nbt', 'source', 'block', 'entity',
  'storage', 'interpret', 'plain', 'object', 'atlas', 'sprite', 'player', 'hat', 'color', 'bold', 'italic', 'underlined', 'strikethrough', 'obfuscated',
  'font', 'shadow_color', 'insertion', 'click_event', 'hover_event', 'clickEvent', 'hoverEvent', 'extra',
]);

// ---------------------------------------------------------------------------------------------
// Editor helpers: component <-> list of parts
// ---------------------------------------------------------------------------------------------

/** Split a component into top-level parts (styles of a root parent are copied into its children). */
export function toParts(component: TextComponent): TextObject[] {
  if (component === '' || component === undefined || component === null) return [];
  if (typeof component !== 'object') return [{ text: String(component) }];
  if (Array.isArray(component)) {
    const [first, ...rest] = component;
    if (first === '' || (isTextObject(first) && first.text === '' && Object.keys(first).length === 1)) return rest.flatMap(toParts);
    if (first === undefined) return [];
    const parent = typeof first === 'object' && !Array.isArray(first) ? first : { text: String(first) };
    return toParts({ ...parent, extra: [...(parent.extra ?? []), ...rest] });
  }
  const { extra, ...self } = component;
  if (!extra?.length) return [self];
  const inherited: Partial<TextObject> = {};
  for (const k of STYLE_KEYS) if (self[k] !== undefined) (inherited as any)[k] = self[k];
  const children = extra.flatMap(toParts).map((p) => ({ ...inherited, ...p }));
  const selfIsEmpty = self.text === '' && !self.translate && !self.keybind && !self.score && !self.selector && !self.nbt;
  return selfIsEmpty ? children : [self, ...children];
}

/** Join parts into one component: "" / single object / ["", ...parts]. Unstyled text parts become strings. */
export function fromParts(parts: TextObject[]): TextComponent {
  const clean = parts.map(cleanPart).filter((p) => p !== undefined) as TextComponent[];
  if (!clean.length) return '';
  if (clean.length === 1) return clean[0];
  return ['', ...clean];
}

function cleanPart(p: TextObject): TextComponent | undefined {
  const o: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(p)) {
    if (v === undefined || v === '' || v === false || v === null) {
      if (k === 'text' && v === '') o[k] = v;
      continue;
    }
    if (Array.isArray(v) && !v.length) continue;
    o[k] = v;
  }
  if (Object.keys(o).length === 1 && typeof o.text === 'string') return o.text as string;
  return o as TextObject;
}

// ---------------------------------------------------------------------------------------------
// SVG rendering (used for hovers: markdown cannot colour text, an image can)
// ---------------------------------------------------------------------------------------------

export interface SvgOptions {
  fontSize?: number;
  padding?: number;
  /** Background colour (default: chat-like translucent black over dark grey). */
  background?: string;
  /** Maximum characters per line before wrapping. */
  wrap?: number;
  /** Default text colour. */
  color?: string;
}

function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
}

function charWidth(ch: string): number {
  const cp = ch.codePointAt(0) ?? 0;
  return cp >= 0x2e80 && cp <= 0xffdc ? 2 : 1;
}

/** Render styled segments as an SVG image (monospace, Minecraft colours and text shadows). */
export function renderSvg(segments: Segment[], opts: SvgOptions = {}): string {
  const fs = opts.fontSize ?? 14;
  const pad = opts.padding ?? 6;
  const cw = fs * 0.6;
  const lh = Math.round(fs * 1.35);
  const wrap = opts.wrap ?? 80;
  const defColor = opts.color ?? '#FFFFFF';
  // Split into lines of {seg, text, col}
  type Run = { seg: Segment; text: string; col: number };
  const lines: Run[][] = [[]];
  let col = 0;
  for (const seg of segments) {
    let buf = '';
    let start = col;
    const push = () => {
      if (buf) lines[lines.length - 1].push({ seg, text: buf, col: start });
      buf = '';
    };
    for (const ch of Array.from(seg.text)) {
      if (ch === '\n' || col >= wrap) {
        push();
        lines.push([]);
        col = 0;
        start = 0;
        if (ch === '\n') continue;
      }
      buf += seg.obfuscated && ch !== ' ' ? '▒' : ch;
      col += charWidth(ch);
    }
    push();
  }
  const widthChars = Math.max(1, ...lines.map((l) => l.reduce((m, r) => Math.max(m, r.col + Array.from(r.text).reduce((a, c) => a + charWidth(c), 0)), 0)));
  const w = Math.ceil(widthChars * cw + pad * 2);
  const h = lines.length * lh + pad * 2 - Math.round(lh - fs * 1.15);
  const sh = Math.max(1, Math.round(fs / 12));
  const shadowLayer: string[] = [];
  const mainLayer: string[] = [];
  lines.forEach((runs, li) => {
    const y = pad + li * lh + Math.round(fs * 0.95);
    for (const r of runs) {
      const color = colorToHex(r.seg.color) ?? defColor;
      const x = (pad + r.col * cw).toFixed(1);
      const deco = [r.seg.underlined ? 'underline' : '', r.seg.strikethrough ? 'line-through' : ''].filter(Boolean).join(' ');
      const attrs = `${r.seg.bold ? ' font-weight="bold"' : ''}${r.seg.italic ? ' font-style="italic"' : ''}${deco ? ` text-decoration="${deco}"` : ''}`;
      const txt = escapeXml(r.text);
      const custom = shadowColorToCss(r.seg.shadow_color);
      if (!custom || custom.alpha > 0) {
        const sc = custom?.hex ?? defaultShadow(color);
        const op = custom && custom.alpha < 1 ? ` fill-opacity="${custom.alpha.toFixed(2)}"` : '';
        shadowLayer.push(`<text xml:space="preserve" x="${(Number(x) + sh).toFixed(1)}" y="${y + sh}" fill="${sc}"${op}${attrs}>${txt}</text>`);
      }
      mainLayer.push(`<text xml:space="preserve" x="${x}" y="${y}" fill="${color}"${attrs}>${txt}</text>`);
    }
  });
  const bg = opts.background ?? '#2B2B2B';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<rect width="100%" height="100%" rx="3" fill="${bg}"/>` +
    `<g font-family="'Minecraft','Monocraft','Consolas','DejaVu Sans Mono','Courier New',monospace" font-size="${fs}" xml:space="preserve" style="white-space:pre">` +
    shadowLayer.join('') +
    mainLayer.join('') +
    `</g></svg>`
  );
}

/** Base64 data URI of an SVG (works in Node and browsers). */
export function svgDataUri(svg: string): string {
  const B = (globalThis as any).Buffer;
  const b64 = B ? B.from(svg, 'utf8').toString('base64') : btoa(unescape(encodeURIComponent(svg)));
  return `data:image/svg+xml;base64,${b64}`;
}

// ---------------------------------------------------------------------------------------------
// MOTD (server.properties)
// ---------------------------------------------------------------------------------------------

/** Escape a MOTD for server.properties (§ and non-ASCII as \uXXXX, newline as \n). */
export function motdToProperties(motd: string): string {
  let out = '';
  for (const ch of motd) {
    const cp = ch.codePointAt(0)!;
    if (ch === '\n') out += '\\n';
    else if (ch === '\\') out += '\\\\';
    else if (cp > 0x7e) {
      // UTF-16 code units
      for (let i = 0; i < ch.length; i++) out += `\\u${ch.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0')}`;
    } else out += ch;
  }
  return `motd=${out}`;
}

/** Unescape a server.properties motd value. */
export function motdFromProperties(line: string): string {
  const v = line.replace(/^\s*motd\s*=\s*/, '');
  return v.replace(/\\u([0-9a-fA-F]{4})|\\n|\\\\/g, (m, hex) => (hex ? String.fromCharCode(parseInt(hex, 16)) : m === '\\n' ? '\n' : '\\'));
}
