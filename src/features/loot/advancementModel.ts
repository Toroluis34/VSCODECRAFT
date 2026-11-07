// Advancements: tree building by parent links, in-game-like layout, and JSON for new advancements.
// Pure module (no 'vscode' import): used by the extension host, the advancements webview and unit tests.
import { compareVersions } from '../../core/versions';
import { fullId } from './text';

export type Frame = 'task' | 'goal' | 'challenge';

export interface AdvancementInfo {
  id: string;
  parent?: string;
  display?: {
    icon?: string;
    /** Item components of the icon (enchanted icons glint). */
    iconComponents?: Record<string, unknown>;
    title?: unknown;
    description?: unknown;
    frame: Frame;
    background?: string;
    hidden?: boolean;
    showToast: boolean;
    announceToChat: boolean;
  };
  criteria: { name: string; trigger: string; conditions?: unknown }[];
  requirements?: string[][];
  rewards?: { experience?: number; recipes?: string[]; loot?: string[]; function?: string };
  source: 'workspace' | 'vanilla';
  /** File URI (workspace advancements). */
  uri?: string;
}

/** Icon item id of a display (1.20.5+ "id", older "item"). */
export function iconOf(display: any): string | undefined {
  const icon = display?.icon;
  if (typeof icon === 'string') return fullId(icon);
  const id = icon?.id ?? icon?.item;
  return typeof id === 'string' ? fullId(id) : undefined;
}

/** Normalize an advancement JSON into AdvancementInfo. */
export function readAdvancement(id: string, json: any, source: 'workspace' | 'vanilla', uri?: string): AdvancementInfo {
  const d = json?.display;
  const criteria = Object.entries(json?.criteria ?? {}).map(([name, c]: [string, any]) => ({
    name,
    trigger: String(c?.trigger ?? ''),
    conditions: c?.conditions,
  }));
  const r = json?.rewards;
  return {
    id,
    parent: typeof json?.parent === 'string' ? fullId(json.parent) : undefined,
    display: d
      ? {
          icon: iconOf(d),
          iconComponents: d.icon?.components,
          title: d.title,
          description: d.description,
          frame: (['task', 'goal', 'challenge'].includes(d.frame) ? d.frame : 'task') as Frame,
          background: typeof d.background === 'string' ? d.background : undefined,
          hidden: !!d.hidden,
          showToast: d.show_toast !== false,
          announceToChat: d.announce_to_chat !== false,
        }
      : undefined,
    criteria,
    requirements: Array.isArray(json?.requirements) ? json.requirements : undefined,
    rewards: r
      ? {
          experience: typeof r.experience === 'number' ? r.experience : undefined,
          recipes: Array.isArray(r.recipes) ? r.recipes : undefined,
          loot: Array.isArray(r.loot) ? r.loot : undefined,
          function: typeof r.function === 'string' ? r.function : undefined,
        }
      : undefined,
    source,
    uri,
  };
}

// ---------------------------------------------------------------------------------------------
// Tree + layout
// ---------------------------------------------------------------------------------------------

export interface LayoutNode {
  id: string;
  /** Column (depth from the root). */
  x: number;
  /** Row (can be fractional for centred parents). */
  y: number;
  parent?: string;
}

export interface AdvancementTab {
  root: string;
  nodes: LayoutNode[];
  /** [parent, child] pairs. */
  edges: [string, string][];
  width: number;
  height: number;
}

export interface TreeOptions {
  /** Also show advancements without a display (recipe unlocks etc.). */
  includeHidden?: boolean;
}

/**
 * Build one tab per root. Advancements without a display are skipped (like in game) unless includeHidden;
 * their displayed descendants attach to the nearest displayed ancestor.
 */
export function buildTabs(list: AdvancementInfo[], opts: TreeOptions = {}): AdvancementTab[] {
  const byId = new Map(list.map((a) => [a.id, a]));
  const visible = (a: AdvancementInfo) => opts.includeHidden || !!a.display;
  const effectiveParent = (a: AdvancementInfo): string | undefined => {
    let p = a.parent;
    const seen = new Set<string>([a.id]);
    while (p && !seen.has(p)) {
      seen.add(p);
      const pa = byId.get(p);
      if (!pa) return undefined; // parent missing -> treat as a root
      if (visible(pa)) return p;
      p = pa.parent;
    }
    return undefined;
  };
  const children = new Map<string, string[]>();
  const roots: string[] = [];
  for (const a of list) {
    if (!visible(a)) continue;
    const p = effectiveParent(a);
    if (p) children.set(p, [...(children.get(p) ?? []), a.id]);
    else roots.push(a.id);
  }
  for (const c of children.values()) c.sort();
  roots.sort(rootOrder);
  return roots.map((r) => layoutTree(r, children));
}

const VANILLA_TAB_ORDER = ['minecraft:story/root', 'minecraft:nether/root', 'minecraft:end/root', 'minecraft:adventure/root', 'minecraft:husbandry/root'];

function rootOrder(a: string, b: string): number {
  const ia = VANILLA_TAB_ORDER.indexOf(a);
  const ib = VANILLA_TAB_ORDER.indexOf(b);
  if (ia >= 0 || ib >= 0) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  return a.localeCompare(b);
}

/**
 * Tidy tree layout (left to right like the in-game advancement screen): every subtree is packed
 * against its previous siblings using per-depth contours, and parents are centred on their children.
 */
export function layoutTree(root: string, children: Map<string, string[]>): AdvancementTab {
  const pos = new Map<string, { y: number; depth: number; parent?: string }>();
  const edges: [string, string][] = [];
  const guard = new Set<string>();

  // Returns contour [min, max] per relative depth, with positions relative to the subtree.
  const place = (id: string, depth: number, parent?: string): { contour: [number, number][]; nodes: string[] } => {
    guard.add(id);
    const kids = (children.get(id) ?? []).filter((k) => !guard.has(k));
    if (!kids.length) {
      pos.set(id, { y: 0, depth, parent });
      return { contour: [[0, 0]], nodes: [id] };
    }
    let contour: [number, number][] = [];
    const nodes: string[] = [];
    const childYs: number[] = [];
    for (const k of kids) {
      edges.push([id, k]);
      const sub = place(k, depth + 1, id);
      // shift so that sub does not overlap the accumulated contour at any shared depth
      let shift = 0;
      if (contour.length) {
        shift = -Infinity;
        for (let i = 0; i < Math.min(contour.length, sub.contour.length); i++) shift = Math.max(shift, contour[i][1] + 1 - sub.contour[i][0]);
        if (shift === -Infinity) shift = 0;
      }
      for (const n of sub.nodes) pos.get(n)!.y += shift;
      nodes.push(...sub.nodes);
      childYs.push(pos.get(k)!.y);
      for (let i = 0; i < sub.contour.length; i++) {
        const [lo, hi] = sub.contour[i];
        if (i < contour.length) contour[i] = [Math.min(contour[i][0], lo + shift), Math.max(contour[i][1], hi + shift)];
        else contour.push([lo + shift, hi + shift]);
      }
    }
    const y = (childYs[0] + childYs[childYs.length - 1]) / 2;
    pos.set(id, { y, depth, parent });
    return { contour: [[y, y], ...contour], nodes: [id, ...nodes] };
  };
  place(root, 0);
  let minY = Infinity;
  let maxY = -Infinity;
  let maxX = 0;
  for (const p of pos.values()) {
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
    maxX = Math.max(maxX, p.depth);
  }
  const nodes: LayoutNode[] = [...pos].map(([id, p]) => ({ id, x: p.depth, y: p.y - minY, parent: p.parent }));
  return { root, nodes, edges, width: maxX + 1, height: maxY - minY + 1 };
}

/** Chain of ancestors from the root down to the advancement. */
export function ancestry(id: string, list: AdvancementInfo[]): string[] {
  const byId = new Map(list.map((a) => [a.id, a]));
  const out: string[] = [];
  const seen = new Set<string>();
  let cur: string | undefined = id;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    out.unshift(cur);
    cur = byId.get(cur)?.parent;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// New advancement
// ---------------------------------------------------------------------------------------------

/** Minimal valid "conditions" for a trigger (undefined = no conditions needed). */
export function criterionConditions(trigger: string, icon: string, namespace: string): Record<string, unknown> | undefined {
  const t = trigger.replace(/^minecraft:/, '');
  switch (t) {
    case 'inventory_changed':
      return { items: [{ items: icon }] };
    case 'consume_item':
    case 'using_item':
    case 'item_durability_changed':
    case 'enchanted_item':
    case 'filled_bucket':
    case 'thrown_item_picked_up_by_player':
    case 'used_totem':
      return { item: { items: icon } };
    case 'recipe_unlocked':
      return { recipe: `${namespace}:${icon.split(':')[1] ?? 'example'}` };
    case 'recipe_crafted':
    case 'crafter_recipe_crafted':
      return { recipe_id: `${namespace}:${icon.split(':')[1] ?? 'example'}` };
    case 'changed_dimension':
      return { to: 'minecraft:the_nether' };
    case 'enter_block':
      return { block: 'minecraft:water' };
    case 'construct_beacon':
      return { level: { min: 1 } };
    case 'impossible':
      return undefined;
    default:
      return {};
  }
}

export interface NewAdvancementOptions {
  id: string;
  parent?: string;
  icon: string;
  title: string;
  description: string;
  /** Lang keys to use instead of literal text. */
  titleKey?: string;
  descriptionKey?: string;
  frame: Frame;
  trigger: string;
  criterionName?: string;
  showToast?: boolean;
  announceToChat?: boolean;
  hidden?: boolean;
  background?: string;
  rewards?: { experience?: number; recipes?: string[]; loot?: string[]; function?: string };
  version: string;
}

/** Default tab background for a version (texture id since 1.21.5, texture path before). */
export function defaultBackground(version: string, name = 'stone'): string {
  return compareVersions(version, '1.21.5') >= 0
    ? `minecraft:gui/advancements/backgrounds/${name}`
    : `minecraft:textures/gui/advancements/backgrounds/${name}.png`;
}

export function newAdvancementJson(o: NewAdvancementOptions): Record<string, unknown> {
  const ns = o.id.includes(':') ? o.id.split(':')[0] : 'minecraft';
  const icon = fullId(o.icon || 'minecraft:stone');
  const display: Record<string, unknown> = {
    icon: compareVersions(o.version, '1.20.5') >= 0 ? { id: icon } : { item: icon },
    title: o.titleKey ? { translate: o.titleKey } : { text: o.title },
    description: o.descriptionKey ? { translate: o.descriptionKey } : { text: o.description },
  };
  if (o.frame !== 'task') display.frame = o.frame;
  if (!o.parent) display.background = o.background ?? defaultBackground(o.version);
  if (o.showToast === false) display.show_toast = false;
  if (o.announceToChat === false) display.announce_to_chat = false;
  if (o.hidden) display.hidden = true;
  const name = o.criterionName || (o.trigger.replace(/^minecraft:/, '') === 'impossible' ? 'impossible' : 'requirement');
  const conditions = criterionConditions(o.trigger, icon, ns);
  const criterion: Record<string, unknown> = { trigger: fullId(o.trigger) };
  if (conditions !== undefined) criterion.conditions = conditions;
  const out: Record<string, unknown> = {};
  if (o.parent) out.parent = fullId(o.parent);
  out.display = display;
  out.criteria = { [name]: criterion };
  const r = o.rewards;
  if (r && (r.experience || r.recipes?.length || r.loot?.length || r.function)) {
    const rw: Record<string, unknown> = {};
    if (r.experience) rw.experience = r.experience;
    if (r.recipes?.length) rw.recipes = r.recipes.map(fullId);
    if (r.loot?.length) rw.loot = r.loot.map(fullId);
    if (r.function) rw.function = fullId(r.function);
    out.rewards = rw;
  }
  return out;
}

/** Lang keys for a new advancement id: advancements.<ns>.<path>.title/description */
export function advancementLangKeys(id: string): { title: string; description: string } {
  const [ns, path] = id.includes(':') ? id.split(':') : ['minecraft', id];
  const base = `advancements.${ns}.${path.replace(/\//g, '.')}`;
  return { title: `${base}.title`, description: `${base}.description` };
}

/** Fallback background block texture per vanilla tab background name (the GUI textures are not in the atlas). */
export function backgroundTexture(background: string | undefined): string {
  const name = (background ?? '').replace(/\.png$/, '').split('/').pop() ?? 'stone';
  const map: Record<string, string> = {
    stone: 'minecraft:block/stone',
    nether: 'minecraft:block/netherrack',
    end: 'minecraft:block/end_stone',
    adventure: 'minecraft:block/red_sandstone',
    husbandry: 'minecraft:block/hay_block_side',
  };
  return map[name] ?? (background?.includes(':') && /block\//.test(background) ? background.replace(/^(.*?):(textures\/)?/, '$1:').replace(/\.png$/, '') : 'minecraft:block/stone');
}
