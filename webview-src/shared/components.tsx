// Reusable Preact components for Minecraft-flavoured webviews.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren, JSX } from 'preact';
import type { ItemVisual, RegistryEntryInfo } from '../../src/shared/protocol';
import { call } from './vscode';
import { renderVisual } from './itemRenderer';
import { t } from './i18n';

// ---------- batched icon / name loading ----------

const visualCache = new Map<string, Promise<ItemVisual>>();
let queue: { id: string; resolve: (v: ItemVisual) => void }[] = [];
let timer: number | undefined;

/** Resolve an item visual (batched + cached). */
export function getVisual(id: string): Promise<ItemVisual> {
  let p = visualCache.get(id);
  if (!p) {
    p = new Promise<ItemVisual>((resolve) => {
      queue.push({ id, resolve });
      if (timer === undefined) {
        timer = window.setTimeout(async () => {
          const batch = queue;
          queue = [];
          timer = undefined;
          try {
            const res = await call('icons.resolve', { ids: batch.map((b) => b.id) });
            batch.forEach((b) => b.resolve(res[b.id] ?? { type: 'missing', id: b.id, label: b.id }));
          } catch {
            batch.forEach((b) => b.resolve({ type: 'missing', id: b.id, label: b.id }));
          }
        }, 15);
      }
    });
    visualCache.set(id, p);
  }
  return p;
}

/** Forget cached visuals (e.g. after the host reports changed textures). */
export function clearVisualCache(): void {
  visualCache.clear();
  tagCache.clear();
  nameCache.clear();
}

const nameCache = new Map<string, Promise<string>>();
let nameQueue: { id: string; resolve: (v: string) => void }[] = [];
let nameTimer: number | undefined;

/** Display name of an item/block (batched + cached). */
export function getName(id: string): Promise<string> {
  let p = nameCache.get(id);
  if (!p) {
    p = new Promise<string>((resolve) => {
      nameQueue.push({ id, resolve });
      if (nameTimer === undefined) {
        nameTimer = window.setTimeout(async () => {
          const batch = nameQueue;
          nameQueue = [];
          nameTimer = undefined;
          try {
            const res = await call('names.get', { ids: batch.map((b) => b.id) });
            batch.forEach((b) => b.resolve(res[b.id] ?? b.id));
          } catch {
            batch.forEach((b) => b.resolve(b.id));
          }
        }, 15);
      }
    });
    nameCache.set(id, p);
  }
  return p;
}

export function useName(id: string | undefined): string {
  const [name, setName] = useState('');
  useEffect(() => {
    let alive = true;
    if (!id) return setName('');
    void getName(id).then((n) => alive && setName(n));
    return () => {
      alive = false;
    };
  }, [id]);
  return name;
}

const tagCache = new Map<string, Promise<string[]>>();
/** Items of a tag ("#minecraft:logs"), cached. */
export function expandTag(tag: string, registry = 'item'): Promise<string[]> {
  const key = `${registry}|${tag}`;
  let p = tagCache.get(key);
  if (!p) {
    p = call('tags.expand', { tag, registry }).catch(() => [] as string[]);
    tagCache.set(key, p);
  }
  return p;
}

// ---------- ItemIcon ----------

export interface ItemIconProps {
  /** Item id, "#tag", or a list of alternatives (cycled like JEI). */
  id: string | string[] | undefined;
  size?: number;
  /** Cycle through tag members / alternatives every N ms (0 disables). */
  cycleMs?: number;
  class?: string;
  title?: string;
}

/** Item icon drawn on a canvas. Tags and alternative lists cycle through their members. */
export function ItemIcon({ id, size = 32, cycleMs = 1000, class: cls, title }: ItemIconProps): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null);
  const [options, setOptions] = useState<string[]>([]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    const ids = Array.isArray(id) ? id : id ? [id] : [];
    (async () => {
      const out: string[] = [];
      for (const x of ids) {
        if (x.startsWith('#')) out.push(...(await expandTag(x)));
        else out.push(x);
      }
      if (alive) setOptions(out.length ? out : ids);
    })();
    return () => {
      alive = false;
    };
  }, [Array.isArray(id) ? id.join(',') : id]);

  useEffect(() => {
    if (options.length < 2 || !cycleMs) return;
    const h = window.setInterval(() => setTick((x) => x + 1), cycleMs);
    return () => window.clearInterval(h);
  }, [options.length, cycleMs]);

  const current = options.length ? options[tick % options.length] : undefined;
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!current) {
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    let alive = true;
    void getVisual(current).then((v) => {
      if (alive) void renderVisual(canvas, v);
    });
    return () => {
      alive = false;
    };
  }, [current, size]);

  const dpr = Math.min(2, window.devicePixelRatio || 1);
  return (
    <canvas
      ref={ref}
      class={`mc-icon ${cls ?? ''}`}
      width={Math.round(size * dpr)}
      height={Math.round(size * dpr)}
      style={{ width: `${size}px`, height: `${size}px` }}
      title={title ?? current}
      data-item={current}
    />
  );
}

// ---------- Slot ----------

export interface SlotProps {
  id?: string | string[];
  count?: number;
  size?: number;
  large?: boolean;
  selected?: boolean;
  title?: string;
  onClick?: (e: MouseEvent) => void;
  onContextMenu?: (e: MouseEvent) => void;
  /** Called with an item id dropped from an ItemPicker / another slot. */
  onDropItem?: (id: string) => void;
  /** Makes the slot draggable (drags its id). */
  draggable?: boolean;
  children?: ComponentChildren;
}

export const DRAG_MIME = 'application/x-vscodecraft-item';

/** Minecraft inventory slot with icon, count, tooltip and drag & drop. */
export function Slot(p: SlotProps): JSX.Element {
  const size = p.size ?? (p.large ? 48 : 36);
  const [over, setOver] = useState(false);
  const firstId = Array.isArray(p.id) ? p.id[0] : p.id;
  const name = useName(firstId && !firstId.startsWith('#') ? firstId : undefined);
  const tooltip = p.title ?? (firstId ? (firstId.startsWith('#') ? `${t('Tag')}: ${firstId}` : `${name}\n${firstId}`) : '');
  return (
    <div
      class={`mc-slot ${p.large ? 'mc-slot-large' : ''} ${p.selected ? 'selected' : ''} ${over ? 'drop-over' : ''}`}
      style={{ width: `${size}px`, height: `${size}px` }}
      title={tooltip}
      onClick={p.onClick}
      onContextMenu={p.onContextMenu}
      draggable={p.draggable && !!firstId}
      onDragStart={(e) => {
        if (firstId) e.dataTransfer?.setData(DRAG_MIME, firstId);
        if (firstId) e.dataTransfer?.setData('text/plain', firstId);
      }}
      onDragOver={(e) => {
        if (!p.onDropItem) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        if (!p.onDropItem) return;
        e.preventDefault();
        const id = e.dataTransfer?.getData(DRAG_MIME) || e.dataTransfer?.getData('text/plain');
        if (id) p.onDropItem(id.trim());
      }}
    >
      {p.id && (Array.isArray(p.id) ? p.id.length : true) ? <ItemIcon id={p.id} size={size - 8} /> : null}
      {p.count && p.count > 1 ? <span class="mc-count">{p.count}</span> : null}
      {firstId?.startsWith('#') ? <span class="mc-tag-badge">#</span> : null}
      {p.children}
    </div>
  );
}

// ---------- ItemPicker ----------

export interface ItemPickerProps {
  onPick?: (id: string) => void;
  registry?: string;
  placeholder?: string;
  /** Show tags too (prefixed with #) */
  includeTags?: boolean;
  limit?: number;
  autoFocus?: boolean;
}

/** Searchable item palette (vanilla + workspace). Items can be clicked or dragged into slots. */
export function ItemPicker({ onPick, registry = 'item', placeholder, includeTags, limit = 120, autoFocus }: ItemPickerProps): JSX.Element {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<RegistryEntryInfo[]>([]);
  const [tags, setTags] = useState<RegistryEntryInfo[]>([]);
  useEffect(() => {
    let alive = true;
    const h = window.setTimeout(async () => {
      const q = query.replace(/^#/, '');
      const r = query.startsWith('#') ? [] : await call('items.search', { query: q, limit, registry }).catch(() => []);
      const tg = includeTags || query.startsWith('#') ? await call('items.search', { query: q, limit: 40, registry: `tag/${registry}` }).catch(() => []) : [];
      if (alive) {
        setResults(r);
        setTags(tg);
      }
    }, 120);
    return () => {
      alive = false;
      window.clearTimeout(h);
    };
  }, [query, registry, includeTags]);
  return (
    <div class="mc-picker">
      <input
        class="mc-input"
        type="search"
        placeholder={placeholder ?? t('Search items…')}
        value={query}
        autoFocus={autoFocus}
        onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
      />
      <div class="mc-picker-grid">
        {tags.map((e) => (
          <Slot key={`#${e.id}`} id={`#${e.id}`} size={36} draggable title={`#${e.id}`} onClick={() => onPick?.(`#${e.id}`)} />
        ))}
        {results.map((e) => (
          <Slot key={e.id} id={e.id} size={36} draggable title={`${e.name ?? ''}\n${e.id}`} onClick={() => onPick?.(e.id)} />
        ))}
        {!results.length && !tags.length ? <div class="mc-muted">{t('No results')}</div> : null}
      </div>
    </div>
  );
}

// ---------- small UI helpers ----------

export function Button(p: JSX.HTMLAttributes<HTMLButtonElement> & { secondary?: boolean; icon?: string }): JSX.Element {
  const { secondary, icon, children, class: cls, ...rest } = p as any;
  return (
    <button class={`mc-button ${secondary ? 'secondary' : ''} ${cls ?? ''}`} {...rest}>
      {icon ? <span class="mc-button-icon">{icon}</span> : null}
      {children}
    </button>
  );
}

/** Render Minecraft "§" formatted text or a plain string with the Minecraft font colours. */
export function McText({ text }: { text: string }): JSX.Element {
  const COLORS: Record<string, string> = {
    '0': '#000000', '1': '#0000AA', '2': '#00AA00', '3': '#00AAAA', '4': '#AA0000', '5': '#AA00AA', '6': '#FFAA00', '7': '#AAAAAA',
    '8': '#555555', '9': '#5555FF', a: '#55FF55', b: '#55FFFF', c: '#FF5555', d: '#FF55FF', e: '#FFFF55', f: '#FFFFFF',
  };
  const parts: JSX.Element[] = [];
  let style: Record<string, string> = {};
  let buf = '';
  const flush = () => {
    if (buf) parts.push(<span style={{ ...style }}>{buf}</span>);
    buf = '';
  };
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '§' && i + 1 < text.length) {
      flush();
      const c = text[++i].toLowerCase();
      if (COLORS[c]) style = { color: COLORS[c] };
      else if (c === 'l') style = { ...style, fontWeight: 'bold' };
      else if (c === 'o') style = { ...style, fontStyle: 'italic' };
      else if (c === 'n') style = { ...style, textDecoration: 'underline' };
      else if (c === 'm') style = { ...style, textDecoration: 'line-through' };
      else if (c === 'r') style = {};
    } else buf += text[i];
  }
  flush();
  return <span class="mc-text">{parts}</span>;
}
