// Find item/block registrations in Java / Kotlin source text (pure, no 'vscode' import).

export type RegistrationKind = 'item' | 'block' | 'other';

export interface Registration {
  line: number;
  /** Character range of the literal's content (without quotes). */
  start: number;
  end: number;
  /** Path part ("ruby") or full id when the literal contains ":". */
  name: string;
  /** Namespace if given explicitly (literal "ns:path" or of("ns", "path")). */
  namespace?: string;
  kind: RegistrationKind;
  /** Item registration of a block item (BlockItem / registerSimpleBlockItem / registerBlockItem). */
  blockItem: boolean;
}

const REGISTER_CALL = /\b(?:register[A-Za-z]*|Registry\.register)\s*\(/;
const OTHER_REGISTRY =
  /BlockEntity|BLOCK_ENTITY|CreativeModeTab|CREATIVE_MODE_TAB|ItemGroup|ITEM_GROUP|DataComponent|DATA_COMPONENT|ComponentType|EntityType|ENTITY_TYPE|SoundEvent|SOUND_EVENT|MenuType|MENU|ScreenHandler|RecipeSerializer|RECIPE_SERIALIZER|RecipeType|RECIPE_TYPE|ParticleType|PARTICLE_TYPE|Payload|Attachment|ATTACHMENT|Feature|FEATURE|Fluid|FLUID|Potion|POTION|MobEffect|MOB_EFFECT|StatusEffect|ArmorMaterial|Enchantment|Codec|CODEC|Command|Attribute|ATTRIBUTE|POI|PoiType|Villager|VILLAGER|GameRule|LootFunction|LootCondition|LOOT_/;
const BLOCK_ITEM = /BlockItem|registerSimpleBlockItem|registerBlockItem/;
const BLOCK = /\bBlock\b|\bBLOCKS?\b|registerBlock\b|registerSimpleBlock\b|registerBlock\s*\(|DeferredBlock|BuiltInRegistries\.BLOCK\b|Registries\.BLOCK\b|Block::new|new [A-Z][A-Za-z]*Block\s*\(|Block\.Properties|BlockBehaviour|AbstractBlock|ModBlocks|registerBlock/;
const ITEM = /\bItem\b|\bITEMS?\b|registerItem|registerSimpleItem|DeferredItem|BuiltInRegistries\.ITEM\b|Registries\.ITEM\b|Item::new|new [A-Z][A-Za-z]*Item\s*\(|Item\.Properties|Item\.Settings|ModItems/;

const ID_LITERAL = /^(?:[a-z0-9_.-]+:)?[a-z0-9_./-]+$/;

/** Classify a register line. */
export function registrationKind(line: string): { kind: RegistrationKind; blockItem: boolean } {
  if (BLOCK_ITEM.test(line)) return { kind: 'item', blockItem: true };
  const withoutLiterals = line.replace(/"(?:[^"\\]|\\.)*"/g, '""');
  if (OTHER_REGISTRY.test(withoutLiterals)) return { kind: 'other', blockItem: false };
  if (BLOCK.test(withoutLiterals)) return { kind: 'block', blockItem: false };
  if (ITEM.test(withoutLiterals)) return { kind: 'item', blockItem: false };
  return { kind: 'other', blockItem: false };
}

interface Literal {
  start: number;
  end: number;
  value: string;
}

/** String literals of a line (content ranges, without quotes). Stops at a // comment. */
export function stringLiterals(line: string): Literal[] {
  const out: Literal[] = [];
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '/' && line[i + 1] === '/') break;
    if (ch !== '"') continue;
    let j = i + 1;
    while (j < line.length && line[j] !== '"') j += line[j] === '\\' ? 2 : 1;
    out.push({ start: i + 1, end: j, value: line.slice(i + 1, j) });
    i = j;
  }
  return out;
}

/** The string literal containing a character offset (inclusive of quotes). */
export function literalAt(line: string, character: number): Literal | undefined {
  return stringLiterals(line).find((l) => character >= l.start - 1 && character <= l.end);
}

/** Registration declared on a single line, if any. */
export function registrationOnLine(text: string, lineNo = 0): Registration | undefined {
  const trimmed = text.trim();
  if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*') || trimmed.startsWith('import ')) return undefined;
  if (!REGISTER_CALL.test(text)) return undefined;
  const lits = stringLiterals(text).filter((l) => ID_LITERAL.test(l.value) && l.value.length > 0);
  if (!lits.length) return undefined;
  let lit = lits[0];
  let namespace: string | undefined;
  // of("ns", "path") / fromNamespaceAndPath("ns", "path") / new ResourceLocation("ns", "path")
  const two = /(?:\bof|fromNamespaceAndPath|ResourceLocation|Identifier)\s*\(\s*"([a-z0-9_.-]+)"\s*,\s*"([a-z0-9_./-]+)"/.exec(text);
  if (two) {
    namespace = two[1];
    const pathStart = text.indexOf(`"${two[2]}"`, two.index + two[0].indexOf(',')) + 1;
    lit = { start: pathStart, end: pathStart + two[2].length, value: two[2] };
  } else if (lit.value.includes(':')) {
    namespace = lit.value.slice(0, lit.value.indexOf(':'));
  }
  const { kind, blockItem } = registrationKind(text);
  const name = lit.value.includes(':') ? lit.value.slice(lit.value.indexOf(':') + 1) : lit.value;
  if (lit.value.includes(':')) lit = { ...lit, start: lit.start + lit.value.indexOf(':') + 1 };
  return { line: lineNo, start: lit.start, end: lit.end, name, namespace, kind, blockItem };
}

/** Every item / block registration in a source file (one per line). */
export function findRegistrations(source: string): Registration[] {
  const out: Registration[] = [];
  const lines = source.split(/\r?\n/);
  let inBlockComment = false;
  lines.forEach((line, i) => {
    if (inBlockComment) {
      if (line.includes('*/')) inBlockComment = false;
      return;
    }
    if (line.trim().startsWith('/*') && !line.includes('*/')) {
      inBlockComment = true;
      return;
    }
    const r = registrationOnLine(line, i);
    if (r && r.kind !== 'other') out.push(r);
  });
  return out;
}

/** Lang keys the game uses for an item / block. */
export function langKeys(kind: 'item' | 'block', namespace: string, name: string): string[] {
  const p = name.replace(/\//g, '.');
  return kind === 'block' ? [`block.${namespace}.${p}`] : [`item.${namespace}.${p}`, `block.${namespace}.${p}`];
}
