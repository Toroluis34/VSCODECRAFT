// Brigadier command tree walking for .mcfunction completion. Pure module (unit tested).
// Tree format: misode/mcmeta <version>-summary/commands/data.min.json.

export interface CmdNode {
  type: 'root' | 'literal' | 'argument';
  children?: Record<string, CmdNode>;
  executable?: boolean;
  parser?: string;
  properties?: Record<string, unknown>;
  redirect?: string[];
}

export interface Token {
  text: string;
  start: number;
  end: number;
}

/** Split a command into tokens; brackets {} [] () and quotes keep spaces inside one token. */
export function tokenize(line: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < line.length) {
    while (i < line.length && line[i] === ' ') i++;
    if (i >= line.length) break;
    const start = i;
    let depth = 0;
    let quote: string | undefined;
    while (i < line.length) {
      const c = line[i];
      if (quote) {
        if (c === '\\') i++;
        else if (c === quote) quote = undefined;
      } else if (c === '"' || c === "'") quote = c;
      else if (c === '{' || c === '[' || c === '(') depth++;
      else if (c === '}' || c === ']' || c === ')') depth = Math.max(0, depth - 1);
      else if (c === ' ' && depth === 0) break;
      i++;
    }
    out.push({ text: line.slice(start, i), start, end: i });
  }
  return out;
}

/** Number of whitespace-separated tokens an argument parser consumes. Infinity = rest of the line. */
export function argumentWidth(node: CmdNode): number {
  switch (node.parser) {
    case 'minecraft:vec3':
    case 'minecraft:block_pos':
      return 3;
    case 'minecraft:vec2':
    case 'minecraft:rotation':
    case 'minecraft:column_pos':
      return 2;
    case 'minecraft:message':
      return Infinity;
    case 'brigadier:string':
      return node.properties?.type === 'greedy' ? Infinity : 1;
    default:
      return 1;
  }
}

/** Follow a redirect / implicit root redirect ("execute run"). */
function follow(root: CmdNode, node: CmdNode): CmdNode {
  if (node.redirect) {
    let n: CmdNode | undefined = root;
    for (const seg of node.redirect) n = n?.children?.[seg];
    return n ?? root;
  }
  if (node.type === 'literal' && !node.children && !node.executable) return root;
  return node;
}

export interface Suggestions {
  /** Literal keywords valid at the cursor. */
  literals: string[];
  /** Arguments expected at the cursor (name + parser). */
  args: { name: string; parser: string; properties?: Record<string, unknown> }[];
  /** Offset in the line where the token being completed starts. */
  replaceStart: number;
  /** Text typed so far for the current token. */
  prefix: string;
}

/**
 * Suggestions for a command line at `cursor`. A leading "/" or "$" (macro line) is ignored.
 * Returns undefined when the line is a comment or the walk fails.
 */
export function suggest(root: CmdNode, line: string, cursor = line.length): Suggestions | undefined {
  const head = line.slice(0, cursor);
  const lead = /^\s*[$/]?/.exec(head)![0];
  if (/^\s*#/.test(head)) return undefined;
  const body = head.slice(lead.length);
  const tokens = tokenize(body);
  const endsWithSpace = body.length === 0 || body.endsWith(' ');
  const complete = endsWithSpace ? tokens : tokens.slice(0, -1);
  const partial = endsWithSpace ? '' : tokens[tokens.length - 1].text;
  let node: CmdNode = root;
  let i = 0;
  while (i < complete.length) {
    const t = complete[i].text;
    const kids = node.children ?? {};
    const lit = kids[t];
    if (lit && lit.type === 'literal') {
      node = follow(root, lit);
      i++;
      continue;
    }
    const arg = Object.entries(kids).find(([, n]) => n.type === 'argument');
    if (!arg) return undefined;
    const w = argumentWidth(arg[1]);
    if (w === Infinity) return { literals: [], args: [], replaceStart: lead.length + (tokens[i]?.start ?? 0), prefix: partial };
    if (i + w > complete.length) {
      // still typing a multi-token argument (e.g. coordinates)
      return { literals: [], args: [{ name: arg[0], parser: arg[1].parser ?? '' }], replaceStart: lead.length + body.length - partial.length, prefix: partial };
    }
    node = follow(root, arg[1]);
    i += w;
  }
  const kids = node.children ?? {};
  const literals = Object.entries(kids)
    .filter(([name, n]) => n.type === 'literal' && name.startsWith(partial))
    .map(([name]) => name);
  const args = Object.entries(kids)
    .filter(([, n]) => n.type === 'argument')
    .map(([name, n]) => ({ name, parser: n.parser ?? '', properties: n.properties }));
  return { literals, args, replaceStart: lead.length + body.length - partial.length, prefix: partial };
}

/** Registry to complete ids from for an argument parser (undefined = no id completion). */
export function registryForParser(parser: string, properties?: Record<string, unknown>): string | undefined {
  switch (parser) {
    case 'minecraft:item_stack':
    case 'minecraft:item_predicate':
      return 'item';
    case 'minecraft:block_state':
    case 'minecraft:block_predicate':
      return 'block';
    case 'minecraft:function':
      return 'function';
    case 'minecraft:loot_table':
      return 'loot_table';
    case 'minecraft:loot_predicate':
      return 'predicate';
    case 'minecraft:loot_modifier':
      return 'item_modifier';
    case 'minecraft:dimension':
      return 'dimension';
    case 'minecraft:particle':
      return 'particle_type';
    case 'minecraft:resource':
    case 'minecraft:resource_key':
    case 'minecraft:resource_or_tag':
    case 'minecraft:resource_or_tag_key':
    case 'minecraft:resource_selector': {
      const reg = typeof properties?.registry === 'string' ? (properties.registry as string).replace(/^minecraft:/, '') : undefined;
      return reg;
    }
    default:
      return undefined;
  }
}
