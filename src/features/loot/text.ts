// Text component helpers shared by the loot, advancement and give tools.
// Pure module (no 'vscode' import): also bundled into webviews.

/** One styled run of text, ready to render with Minecraft colours. */
export interface TextRun {
  text: string;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  underlined?: boolean;
  strikethrough?: boolean;
  obfuscated?: boolean;
}

/** Minecraft named colours -> hex. */
export const MC_COLORS: Record<string, string> = {
  black: '#000000',
  dark_blue: '#0000AA',
  dark_green: '#00AA00',
  dark_aqua: '#00AAAA',
  dark_red: '#AA0000',
  dark_purple: '#AA00AA',
  gold: '#FFAA00',
  gray: '#AAAAAA',
  dark_gray: '#555555',
  blue: '#5555FF',
  green: '#55FF55',
  aqua: '#55FFFF',
  red: '#FF5555',
  light_purple: '#FF55FF',
  yellow: '#FFFF55',
  white: '#FFFFFF',
};

/** Colour name or #rrggbb -> css colour. */
export function cssColor(c: string | undefined): string | undefined {
  if (!c) return undefined;
  if (c.startsWith('#')) return c;
  return MC_COLORS[c];
}

/** Replace %s / %1$s placeholders of a translation with args. */
export function formatTranslation(template: string, args: string[]): string {
  let i = 0;
  return template.replace(/%(?:(\d+)\$)?([sd%])/g, (m, pos, kind) => {
    if (kind === '%') return '%';
    const idx = pos ? Number(pos) - 1 : i++;
    return args[idx] ?? '';
  });
}

/**
 * Flatten a text component (string, object, array, or a JSON-encoded string as used before 1.21.5)
 * into styled runs. `lang` resolves "translate" keys.
 */
export function textRuns(tc: unknown, lang: Record<string, string> = {}, inherited: Omit<TextRun, 'text'> = {}, depth = 0): TextRun[] {
  if (tc === undefined || tc === null || depth > 20) return [];
  if (typeof tc === 'string') {
    const s = tc.trim();
    if (depth === 0 && (s.startsWith('{') || s.startsWith('[') || (s.startsWith('"') && s.endsWith('"')))) {
      try {
        return textRuns(JSON.parse(s), lang, inherited, depth + 1);
      } catch {
        /* plain string */
      }
    }
    return [{ ...inherited, text: tc }];
  }
  if (typeof tc === 'number' || typeof tc === 'boolean') return [{ ...inherited, text: String(tc) }];
  if (Array.isArray(tc)) {
    if (!tc.length) return [];
    // First element is the parent; following ones inherit its style.
    const first = textRuns(tc[0], lang, inherited, depth + 1);
    const style = styleOf(tc[0], inherited);
    return [...first, ...tc.slice(1).flatMap((x) => textRuns(x, lang, style, depth + 1))];
  }
  if (typeof tc === 'object') {
    const o = tc as Record<string, any>;
    const style = styleOf(o, inherited);
    const runs: TextRun[] = [];
    if (typeof o.text === 'string' || typeof o.text === 'number') runs.push({ ...style, text: String(o.text) });
    else if (typeof o.translate === 'string') {
      const tpl = lang[o.translate] ?? o.fallback ?? o.translate;
      const args = Array.isArray(o.with) ? o.with.map((w: unknown) => plainText(w, lang)) : [];
      runs.push({ ...style, text: formatTranslation(tpl, args) });
    } else if (typeof o.keybind === 'string') runs.push({ ...style, text: o.keybind.replace(/^key\./, '') });
    else if (o.score) runs.push({ ...style, text: `[${o.score.name}:${o.score.objective}]` });
    else if (typeof o.selector === 'string') runs.push({ ...style, text: o.selector });
    else if (typeof o.nbt === 'string') runs.push({ ...style, text: `[${o.nbt}]` });
    if (Array.isArray(o.extra)) for (const e of o.extra) runs.push(...textRuns(e, lang, style, depth + 1));
    return runs;
  }
  return [];
}

function styleOf(o: unknown, inherited: Omit<TextRun, 'text'>): Omit<TextRun, 'text'> {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return inherited;
  const x = o as Record<string, any>;
  const s: Omit<TextRun, 'text'> = { ...inherited };
  if (typeof x.color === 'string') s.color = x.color;
  for (const k of ['bold', 'italic', 'underlined', 'strikethrough', 'obfuscated'] as const) {
    if (typeof x[k] === 'boolean') s[k] = x[k];
  }
  return s;
}

/** Plain string of a text component. */
export function plainText(tc: unknown, lang: Record<string, string> = {}): string {
  return textRuns(tc, lang)
    .map((r) => r.text)
    .join('');
}

/** Translation keys referenced anywhere in a text component. */
export function translationKeys(tc: unknown, out = new Set<string>()): Set<string> {
  if (typeof tc === 'string') {
    const s = tc.trim();
    if (s.startsWith('{') || s.startsWith('[')) {
      try {
        translationKeys(JSON.parse(s), out);
      } catch {
        /* ignore */
      }
    }
  } else if (Array.isArray(tc)) tc.forEach((x) => translationKeys(x, out));
  else if (tc && typeof tc === 'object') {
    const o = tc as Record<string, any>;
    if (typeof o.translate === 'string') out.add(o.translate);
    if (Array.isArray(o.with)) o.with.forEach((x: unknown) => translationKeys(x, out));
    if (Array.isArray(o.extra)) o.extra.forEach((x: unknown) => translationKeys(x, out));
  }
  return out;
}

/** "minecraft:diamond_sword" -> "diamond_sword"; other namespaces are kept. */
export function shortId(id: string): string {
  return id.startsWith('minecraft:') ? id.slice(10) : id;
}

/** Add the minecraft namespace when missing (keeps a leading #). */
export function fullId(id: string): string {
  const tag = id.startsWith('#');
  const v = tag ? id.slice(1) : id;
  return (tag ? '#' : '') + (v.includes(':') ? v : `minecraft:${v}`);
}

/** "ruby_block" -> "Ruby Block" (last path segment). */
export function humanizeId(id: string): string {
  const last = id.replace(/^#/, '').split(/[:/]/).pop() ?? id;
  return last
    .split('_')
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}

/** Roman numerals for enchantment levels (1..10, else the number). */
export function roman(n: number): string {
  const r = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
  return n >= 1 && n <= 10 ? r[n] : String(n);
}
