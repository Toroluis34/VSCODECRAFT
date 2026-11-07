// Version-compatibility checks that JSON schemas can't express (the schemas accept every 1.21–26.x format).
// Pure module (no 'vscode' import).
import * as jsonc from 'jsonc-parser';
import { atLeast, type VersionFeatures } from '../../core/versions';

export type VersionIssueCode =
  | 'recipeTooNew'
  | 'recipeRemoved'
  | 'itemDefinitionsTooNew'
  | 'packNeedsMinMax'
  | 'packNeedsPackFormat'
  | 'customModelDataObject'
  | 'customModelDataInt'
  | 'componentRemoved';

export interface VersionIssue {
  code: VersionIssueCode;
  /** Arguments for the localized message. */
  args: string[];
  offset: number;
  length: number;
  severity: 'warning' | 'error';
}

/** Minimum version per recipe serializer (types that don't exist in 1.21). */
const RECIPE_MIN: Record<string, string> = {
  crafting_transmute: '1.21.2',
  crafting_dye: '26.1',
  crafting_imbue: '26.1',
  brewing: '26.3',
};
/** Recipe serializers removed in a version. */
const RECIPE_REMOVED: Record<string, string> = {
  crafting_special_armordye: '26.1',
  crafting_special_tippedarrow: '26.1',
  crafting_special_mapcloning: '26.1',
  crafting_special_shulkerboxcoloring: '1.21.2',
  crafting_special_suspiciousstew: '1.21.2',
};
/** Item components removed in a version → replacement. */
const COMPONENT_REMOVED: Record<string, [string, string]> = {
  'minecraft:hide_tooltip': ['1.21.5', 'minecraft:tooltip_display'],
  'minecraft:hide_additional_tooltip': ['1.21.5', 'minecraft:tooltip_display'],
  'minecraft:fire_resistant': ['1.21.2', 'minecraft:damage_resistant'],
};

const strip = (id: string) => id.replace(/^minecraft:/, '');

/**
 * @param schema the schema file name from schemaForPath() (e.g. "recipe.json")
 */
export function checkVersionCompat(schema: string, text: string, f: VersionFeatures): VersionIssue[] {
  const root = jsonc.parseTree(text);
  if (!root) return [];
  const issues: VersionIssue[] = [];
  const v = f.version;
  const at = (n: jsonc.Node, code: VersionIssueCode, args: string[], severity: VersionIssue['severity'] = 'warning') =>
    issues.push({ code, args, offset: n.offset, length: n.length, severity });

  if (schema === 'recipe.json') {
    const typeNode = jsonc.findNodeAtLocation(root, ['type']);
    if (typeNode?.type === 'string') {
      const t = strip(String(typeNode.value));
      if (RECIPE_MIN[t] && !atLeast(v, RECIPE_MIN[t])) at(typeNode, 'recipeTooNew', [t, RECIPE_MIN[t], v], 'error');
      if (RECIPE_REMOVED[t] && atLeast(v, RECIPE_REMOVED[t])) at(typeNode, 'recipeRemoved', [t, RECIPE_REMOVED[t], v], 'error');
    }
  }
  if (schema === 'item_definition.json' && !f.hasItemDefinitions) {
    const n = jsonc.findNodeAtLocation(root, ['model']) ?? root;
    at(n, 'itemDefinitionsTooNew', [v]);
  }
  if (schema === 'pack_mcmeta.json') {
    const pack = jsonc.findNodeAtLocation(root, ['pack']);
    if (pack?.type === 'object') {
      const has = (k: string) => !!jsonc.findNodeAtLocation(pack, [k]);
      const key = pack.parent?.children?.[0] ?? pack;
      if (f.packMetaStyle === 'min_max' && !(has('min_format') && has('max_format'))) at(key, 'packNeedsMinMax', [v]);
      if (f.packMetaStyle === 'pack_format' && !has('pack_format')) at(key, 'packNeedsPackFormat', [v], 'error');
    }
  }
  // Item components anywhere in the file ("components" objects).
  const visit = (n: jsonc.Node | undefined) => {
    if (!n) return;
    if (n.type === 'property' && n.children?.length === 2) {
      const [k, val] = n.children;
      if (k.value === 'components' && val.type === 'object') checkComponents(val);
    }
    n.children?.forEach(visit);
  };
  const checkComponents = (obj: jsonc.Node) => {
    for (const p of obj.children ?? []) {
      const [k, val] = p.children ?? [];
      if (!k || !val) continue;
      const name = String(k.value).replace(/^!/, '');
      const full = name.includes(':') ? name : `minecraft:${name}`;
      if (full === 'minecraft:custom_model_data') {
        const modern = atLeast(v, '1.21.4');
        if (modern && val.type === 'number') at(val, 'customModelDataObject', [v]);
        if (!modern && val.type === 'object') at(val, 'customModelDataInt', [v]);
      }
      const removed = COMPONENT_REMOVED[full];
      if (removed && atLeast(v, removed[0])) at(k, 'componentRemoved', [full, removed[0], removed[1]]);
    }
  };
  visit(root);
  return issues;
}
