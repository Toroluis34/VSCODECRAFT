// Recipe ingredient format (1.21–1.21.1 objects vs 1.21.2+ strings). Pure module.
import * as jsonc from 'jsonc-parser';
import { CLASSIC_INGREDIENT_KEYS } from './context';

export type IngredientFormat = 'string' | 'object';

/** Format of an ingredient value; undefined for custom/unknown shapes (loader ingredient types, empty...). */
export function ingredientFormatOf(value: unknown): IngredientFormat | undefined {
  if (typeof value === 'string') return 'string';
  if (Array.isArray(value)) {
    if (!value.length) return undefined;
    const formats = new Set(value.map(ingredientFormatOf));
    return formats.size === 1 ? [...formats][0] : undefined;
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 1 && (typeof (value as any).item === 'string' || typeof (value as any).tag === 'string')) return 'object';
  }
  return undefined;
}

/** Convert an ingredient to a format. Returns undefined when it cannot be converted. */
export function convertIngredient(value: unknown, to: IngredientFormat): unknown {
  if (Array.isArray(value)) {
    const out = value.map((v) => convertIngredient(v, to));
    if (out.some((v) => v === undefined)) return undefined;
    // 1.21.2+: a single-element list is just the element; a list may not contain tags.
    if (to === 'string') {
      if (out.length === 1) return out[0];
      if ((out as string[]).some((s) => s.startsWith('#'))) return undefined;
    }
    return out;
  }
  if (to === 'string') {
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object') {
      const v = value as { item?: string; tag?: string };
      if (typeof v.item === 'string') return v.item;
      if (typeof v.tag === 'string') return `#${v.tag}`;
    }
    return undefined;
  }
  if (typeof value === 'string') return value.startsWith('#') ? { tag: value.slice(1) } : { item: value };
  if (value && typeof value === 'object') return value;
  return undefined;
}

export interface IngredientNode {
  node: jsonc.Node;
  format: IngredientFormat;
  value: unknown;
}

/** Every "classic" ingredient value node of a recipe (skips brewing and custom ingredient types). */
export function findIngredients(tree: jsonc.Node | undefined): IngredientNode[] {
  if (!tree || tree.type !== 'object') return [];
  const root = jsonc.getNodeValue(tree);
  const type = String(root?.type ?? '').replace(/^minecraft:/, '');
  if (!type || type === 'brewing' || (root?.type && String(root.type).includes(':') && !String(root.type).startsWith('minecraft:'))) return [];
  const out: IngredientNode[] = [];
  const push = (n: jsonc.Node | undefined) => {
    if (!n) return;
    const value = jsonc.getNodeValue(n);
    const format = ingredientFormatOf(value);
    if (format) out.push({ node: n, format, value });
  };
  for (const prop of tree.children ?? []) {
    const key = prop.children?.[0]?.value as string;
    const v = prop.children?.[1];
    if (!v || !CLASSIC_INGREDIENT_KEYS.has(key)) continue;
    if (key === 'key') {
      if (v.type === 'object') for (const p of v.children ?? []) push(p.children?.[1]);
    } else if (key === 'ingredients') {
      if (v.type === 'array') for (const c of v.children ?? []) push(c);
    } else push(v);
  }
  return out;
}

/** Compact one-line JSON ("{ "item": "minecraft:x" }"). Ids never contain quotes, so this is safe. */
export function inlineJson(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(inlineJson).join(', ')}]`;
  if (value && typeof value === 'object') {
    return `{ ${Object.entries(value).map(([k, v]) => `${JSON.stringify(k)}: ${inlineJson(v)}`).join(', ')} }`;
  }
  return JSON.stringify(value);
}
