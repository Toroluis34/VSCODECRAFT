// Locating text components inside JSON documents (pure: jsonc-parser only).
import * as jsonc from 'jsonc-parser';
import { isTextObject, TextComponent } from './textComponent';


const COMPONENT_CONTAINERS = new Set(['extra', 'with', 'separator', 'contents', 'value', 'name']);

/**
 * Outermost text component around an offset in a JSON document:
 * a text-component object (or an array of components inside one), climbing through extra/with/hover contents.
 */
export function componentAt(tree: jsonc.Node | undefined, offset: number): { node: jsonc.Node; value: TextComponent } | undefined {
  if (!tree) return undefined;
  let n: jsonc.Node | undefined = jsonc.findNodeAtOffset(tree, offset, true);
  let best: jsonc.Node | undefined;
  while (n) {
    if (n.type === 'object') {
      const v = jsonc.getNodeValue(n);
      if (isTextObject(v)) best = n;
      else if (best && !isEventObject(v)) break;
    } else if (n.type === 'array' && best) {
      const prop = n.parent?.type === 'property' ? n.parent.children?.[0]?.value : undefined;
      // Lists like "lore" hold separate lines: stop at the line itself.
      if (prop !== undefined && !COMPONENT_CONTAINERS.has(prop)) break;
      if (isComponentArray(jsonc.getNodeValue(n))) best = n;
    }
    n = n.parent;
  }
  return best ? { node: best, value: jsonc.getNodeValue(best) } : undefined;
}

function isEventObject(v: unknown): boolean {
  return !!v && typeof v === 'object' && typeof (v as any).action === 'string';
}

function isComponentArray(v: unknown): boolean {
  return Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'string' || isTextObject(x));
}
