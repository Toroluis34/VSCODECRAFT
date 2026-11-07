// Recipe Browser filtering (pure, shared by the webview and tests).
import type { BrowserData, BrowserEntry } from './protocol';

export type SearchMode = 'all' | 'craft' | 'uses';

export interface SearchOptions {
  query: string;
  mode: SearchMode;
  /** Recipe type filter ('' = any). */
  type?: string;
  source?: '' | 'workspace' | 'vanilla';
}

/**
 * Filter recipes:
 *  - craft: recipes whose result matches the query (id, path or display name)
 *  - uses:  recipes with an ingredient matching the query (directly or through a tag)
 *  - all:   recipe id, result or group match
 * A query containing ":" is treated as an exact id (e.g. "minecraft:iron_ingot").
 */
export function searchRecipes(data: BrowserData, opts: SearchOptions): BrowserEntry[] {
  const q = opts.query.trim().toLowerCase();
  const exact = q.includes(':') && !q.includes(' ');
  const qId = q;
  const itemMatch = (id: string): boolean => {
    if (!q) return true;
    if (exact) return id === qId;
    const name = data.names[id]?.toLowerCase() ?? '';
    return id.split(':')[1]?.includes(q) || name.includes(q);
  };
  const ingredientMatch = (ing: string): boolean => {
    if (ing.startsWith('#')) {
      if (exact && qId.startsWith('#')) return ing === qId;
      if (!exact && ing.includes(q)) return true;
      return (data.tags[ing] ?? []).some(itemMatch);
    }
    return itemMatch(ing);
  };
  const out = data.entries.filter((e) => {
    if (opts.type && e.type !== opts.type) return false;
    if (opts.source && e.source !== opts.source) return false;
    if (!q) return true;
    switch (opts.mode) {
      case 'craft':
        return !!e.result && itemMatch(e.result);
      case 'uses':
        return e.ingredients.some(ingredientMatch);
      default:
        return (
          (e.result ? itemMatch(e.result) : false) ||
          (exact ? e.id === qId : e.id.includes(q)) ||
          (!!e.group && !exact && e.group.includes(q))
        );
    }
  });
  const nameOf = (e: BrowserEntry) => (e.result ? data.names[e.result] ?? e.result : e.id);
  const rank = (e: BrowserEntry) => {
    if (!q || !e.result) return 2;
    const n = nameOf(e).toLowerCase();
    if (n === q || e.result === qId) return 0;
    if (n.startsWith(q)) return 1;
    return 2;
  };
  return out.sort(
    (a, b) =>
      (a.source === b.source ? 0 : a.source === 'workspace' ? -1 : 1) || rank(a) - rank(b) || nameOf(a).localeCompare(nameOf(b)) || a.id.localeCompare(b.id),
  );
}

/** Distinct recipe types present (most common first). */
export function recipeTypes(entries: BrowserEntry[]): { type: string; count: number }[] {
  const m = new Map<string, number>();
  for (const e of entries) m.set(e.type, (m.get(e.type) ?? 0) + 1);
  return [...m.entries()].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count);
}
