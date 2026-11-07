// Detection of translation keys referenced by the workspace (registered content, "translate" keys
// in JSON, sound subtitles, damage type messages ...), missing keys and unused keys.
// Pure module (no 'vscode' import) so it can be unit tested.

export type RefKind =
  | 'item'
  | 'block'
  | 'entity'
  | 'enchantment'
  | 'effect'
  | 'biome'
  | 'creative_tab'
  | 'advancement'
  | 'subtitle'
  | 'death'
  | 'translate';

export interface KeyRef {
  key: string;
  kind: RefKind;
  /** Proposed English text. */
  suggestion: string;
  /** Where it was found (file path, registry, ...). */
  source?: string;
}

/** "ruby_block" -> "Ruby Block"; "tools/ruby_sword" -> "Ruby Sword". Keeps small words lowercase. */
export function humanizeId(path: string): string {
  const last = path.split(/[/:]/).pop() ?? path;
  const small = new Set(['of', 'the', 'and', 'on', 'in', 'a', 'an', 'to', 'with', 'for', 'at', 'by']);
  return last
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w, i) => (i > 0 && small.has(w) ? w : w[0].toUpperCase() + w.slice(1)))
    .join(' ');
}

const SUBTITLE_VERBS: Record<string, string> = {
  break: 'breaks',
  broken: 'breaks',
  place: 'placed',
  placed: 'placed',
  step: 'footsteps',
  hit: 'hit',
  fall: 'falls',
  hurt: 'hurts',
  death: 'dies',
  die: 'dies',
  ambient: 'idles',
  idle: 'idles',
  use: 'used',
  open: 'opens',
  close: 'closes',
  shoot: 'shoots',
  throw: 'thrown',
  attack: 'attacks',
  eat: 'eats',
  drink: 'drinks',
  equip: 'equipped',
  activate: 'activates',
  deactivate: 'deactivates',
  click: 'clicks',
  explode: 'explodes',
  spawn: 'spawns',
  fire: 'fires',
  charge: 'charges',
  craft: 'crafted',
  craft_item: 'crafted',
  ignite: 'ignites',
  extinguish: 'extinguished',
  growl: 'growls',
  roar: 'roars',
  splash: 'splashes',
  swim: 'swims',
  fly: 'flies',
  hiss: 'hisses',
  scream: 'screams',
};

const SUBTITLE_SKIP = new Set(['block', 'item', 'entity', 'ambient', 'music', 'ui', 'weather', 'enchant']);

/** Suggest an English text for a translation key. */
export function suggestText(key: string): string {
  const parts = key.split('.');
  const head = parts[0];
  // item.ns.path / block.ns.path / entity.ns.path / enchantment.ns.path / effect.ns.path / biome.ns.path / itemGroup.ns.path
  if (['item', 'block', 'entity', 'enchantment', 'effect', 'biome', 'itemGroup', 'painting', 'jukebox_song', 'trim_material', 'trim_pattern'].includes(head) && parts.length >= 3) {
    const rest = parts.slice(2);
    if (rest[rest.length - 1] === 'desc' || rest[rest.length - 1] === 'description' || rest[rest.length - 1] === 'tooltip') {
      return `${humanizeId(rest.slice(0, -1).join('_') || parts[1])} description`;
    }
    if (head === 'painting' && rest[rest.length - 1] === 'author') return 'Unknown';
    if (head === 'painting' && rest[rest.length - 1] === 'title') return humanizeId(rest.slice(0, -1).join('_'));
    return humanizeId(rest.join('_'));
  }
  if (head === 'advancements' || head === 'advancement') {
    const last = parts[parts.length - 1];
    if (['title', 'description', 'desc'].includes(last) && parts.length >= 3) return humanizeId(parts[parts.length - 2]);
    return humanizeId(last);
  }
  if (head === 'subtitles' && parts.length >= 3) {
    const words = parts.slice(2).filter((p) => !SUBTITLE_SKIP.has(p) || parts.length <= 3);
    const verb = words.length > 1 ? SUBTITLE_VERBS[words[words.length - 1]] : undefined;
    const subject = humanizeId((verb ? words.slice(0, -1) : words).join('_'));
    return verb ? `${subject} ${verb}` : subject;
  }
  if (head === 'death' && parts[1] === 'attack' && parts.length >= 3) {
    const tail = parts[parts.length - 1];
    const variant = tail === 'player' || tail === 'item' ? tail : undefined;
    const what = humanizeId(parts[parts.length - (variant ? 2 : 1)]).toLowerCase();
    if (variant === 'player') return `%1$s was killed by ${what} while fighting %2$s`;
    if (variant === 'item') return `%1$s was killed by %2$s using %3$s`;
    return `%1$s was killed by ${what}`;
  }
  if (head === 'tooltip' || head === 'message' || head === 'gui' || head === 'container') {
    return humanizeId(parts.slice(parts.length > 2 ? 2 : 1).join('_'));
  }
  return humanizeId(parts[parts.length - 1] ?? key);
}

/** Keys for a registered id of a registry. */
export function keyForId(kind: 'item' | 'block' | 'entity' | 'enchantment' | 'effect' | 'biome' | 'creative_tab', id: string): string {
  const i = id.indexOf(':');
  const ns = i >= 0 ? id.slice(0, i) : 'minecraft';
  const path = (i >= 0 ? id.slice(i + 1) : id).replace(/\//g, '.');
  const prefix = kind === 'creative_tab' ? 'itemGroup' : kind;
  return `${prefix}.${ns}.${path}`;
}

/**
 * Walk any JSON value and collect translation keys:
 *  - {"translate": "key", "fallback": "..."} text components (fallback becomes the suggestion)
 *  - sounds.json "subtitle"
 *  - damage_type "message_id" -> death.attack.<id> (+ .player)
 *  - "translation_key" / "description_id" string fields (mod data formats)
 */
export function collectTranslateRefs(value: unknown, opts: { kind?: string; source?: string } = {}): KeyRef[] {
  const out: KeyRef[] = [];
  const src = opts.source;
  const walk = (v: unknown, parentKey?: string) => {
    if (Array.isArray(v)) return v.forEach((x) => walk(x, parentKey));
    if (!v || typeof v !== 'object') return;
    const o = v as Record<string, unknown>;
    if (typeof o.translate === 'string') {
      const key = o.translate;
      const kind: RefKind = key.startsWith('advancements.') ? 'advancement' : 'translate';
      out.push({ key, kind, suggestion: typeof o.fallback === 'string' ? o.fallback : suggestText(key), source: src });
    }
    for (const [k, x] of Object.entries(o)) {
      if ((k === 'subtitle' || k === 'translation_key' || k === 'description_id') && typeof x === 'string' && /^[a-z0-9_.-]+$/i.test(x) && x.includes('.')) {
        out.push({ key: x, kind: k === 'subtitle' ? 'subtitle' : 'translate', suggestion: suggestText(x), source: src });
      }
      walk(x, k);
    }
  };
  if (opts.kind === 'damage_type' && value && typeof value === 'object') {
    const msg = (value as Record<string, unknown>).message_id;
    if (typeof msg === 'string') {
      out.push({ key: `death.attack.${msg}`, kind: 'death', suggestion: suggestText(`death.attack.${msg}`), source: src });
      out.push({ key: `death.attack.${msg}.player`, kind: 'death', suggestion: suggestText(`death.attack.${msg}.player`), source: src });
    }
  }
  walk(value);
  return out;
}

export interface MissingOptions {
  /** Keys that already exist (en_us of all relevant namespaces). */
  existing: Set<string>;
  /** Keys provided by vanilla (never reported). */
  vanilla?: Set<string>;
  /** Only report keys whose namespace segment is one of these (when the key has one). */
  namespaces?: Set<string>;
}

/**
 * Filter references to the missing ones (deduplicated, first suggestion wins).
 * Items whose block key exists (block items) are not reported.
 */
export function findMissing(refs: KeyRef[], opts: MissingOptions): KeyRef[] {
  const out = new Map<string, KeyRef>();
  for (const r of refs) {
    if (out.has(r.key) || opts.existing.has(r.key) || opts.vanilla?.has(r.key)) continue;
    const parts = r.key.split('.');
    if (r.kind === 'item' && opts.existing.has(`block.${parts.slice(1).join('.')}`)) continue;
    if (r.kind === 'block' && opts.existing.has(`item.${parts.slice(1).join('.')}`)) continue;
    if (opts.namespaces && ['item', 'block', 'entity', 'effect', 'biome', 'itemGroup', 'enchantment', 'subtitles', 'advancements'].includes(parts[0])) {
      if (parts[1] && !opts.namespaces.has(parts[1])) continue;
    }
    if (parts[1] === 'minecraft') continue;
    out.set(r.key, r);
  }
  return [...out.values()];
}

/** Namespace a key belongs to (second segment when it's a known namespace, else fallback). */
export function keyNamespace(key: string, known: Set<string>, fallback: string): string {
  const seg = key.split('.')[1];
  return seg && known.has(seg) ? seg : fallback;
}

/** All string literals of source code (Java, Kotlin, JSON, mcfunction ...). */
export function stringLiterals(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)) out.add(m[1]);
  for (const m of text.matchAll(/'((?:[^'\\\n]|\\.){2,})'/g)) out.add(m[1]);
  return out;
}

export interface UnusedResult {
  /** Keys never referenced anywhere. */
  unused: string[];
  /** Keys not referenced literally but whose prefix appears in a string (probably built dynamically). */
  maybe: string[];
}

/**
 * Keys of a lang file that the workspace never references.
 * `referenced`: exact keys known to be used (registries, translate refs);
 * `literals`: every string literal from source files (exact matches count as used, prefixes ending in "." as "maybe").
 */
export function findUnused(keys: string[], referenced: Set<string>, literals: Set<string>): UnusedResult {
  const prefixes = [...literals].filter((s) => s.length > 2 && s.length < 120 && /^[A-Za-z0-9_.-]+\.$/.test(s));
  const unused: string[] = [];
  const maybe: string[] = [];
  for (const k of keys) {
    if (referenced.has(k) || literals.has(k)) continue;
    // Keys derived from a used key (e.g. "item.mymod.ruby.tooltip", "death.attack.x.player") are "maybe".
    const parts = k.split('.');
    let derived = false;
    for (let n = parts.length - 1; n >= 2 && !derived; n--) {
      const base = parts.slice(0, n).join('.');
      if (referenced.has(base) || literals.has(base)) derived = true;
    }
    if (derived || prefixes.some((p) => k.startsWith(p)) || /^(key|category|modmenu|config|text\.autoconfig|gui)\./.test(k)) maybe.push(k);
    else unused.push(k);
  }
  return { unused, maybe };
}
