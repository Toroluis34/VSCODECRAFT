// Which JSON schema applies to which Minecraft file. Pure module (no 'vscode' import): used by the unit tests,
// by the "validate" command and to (re)generate the jsonValidation entries of contributes.json
// (`node src/features/schemas/tools/build-contributes.mjs` reads the compiled data through tsx — see tools/).

export interface SchemaMapping {
  /** File name under schemas/minecraft/. */
  schema: string;
  side?: 'data' | 'assets';
  /** Folders under data/<ns>/ or assets/<ns>/ (modern name first, legacy plural names after). */
  folders?: string[];
  /** Explicit glob patterns (for files outside data/ and assets/ folders). */
  globs?: string[];
  /** Glob patterns excluded from this mapping. */
  exclude?: string[];
}

export const SCHEMA_MAPPINGS: SchemaMapping[] = [
  { schema: 'recipe.json', side: 'data', folders: ['recipe', 'recipes'] },
  { schema: 'loot_table.json', side: 'data', folders: ['loot_table', 'loot_tables'] },
  { schema: 'predicate.json', side: 'data', folders: ['predicate', 'predicates'] },
  { schema: 'item_modifier.json', side: 'data', folders: ['item_modifier', 'item_modifiers'] },
  { schema: 'advancement.json', side: 'data', folders: ['advancement', 'advancements'] },
  { schema: 'tag.json', side: 'data', folders: ['tags'] },
  { schema: 'enchantment.json', side: 'data', folders: ['enchantment'] },
  { schema: 'damage_type.json', side: 'data', folders: ['damage_type'] },
  { schema: 'trim_material.json', side: 'data', folders: ['trim_material'] },
  { schema: 'trim_pattern.json', side: 'data', folders: ['trim_pattern'] },
  { schema: 'painting_variant.json', side: 'data', folders: ['painting_variant'] },
  { schema: 'jukebox_song.json', side: 'data', folders: ['jukebox_song'] },
  { schema: 'banner_pattern.json', side: 'data', folders: ['banner_pattern'] },
  { schema: 'instrument.json', side: 'data', folders: ['instrument'] },
  {
    schema: 'mob_variant.json',
    side: 'data',
    folders: ['wolf_variant', 'cat_variant', 'pig_variant', 'cow_variant', 'chicken_variant', 'frog_variant', 'zombie_nautilus_variant'],
  },
  { schema: 'dimension_type.json', side: 'data', folders: ['dimension_type'] },
  { schema: 'biome.json', side: 'data', folders: ['worldgen/biome'] },
  { schema: 'model.json', side: 'assets', folders: ['models'], exclude: ['**/assets/*/models/equipment/**'] },
  { schema: 'item_definition.json', side: 'assets', folders: ['items'] },
  { schema: 'blockstate.json', side: 'assets', folders: ['blockstates'] },
  { schema: 'lang.json', side: 'assets', folders: ['lang'], exclude: ['**/assets/*/lang/deprecated.json'] },
  { schema: 'atlas.json', side: 'assets', folders: ['atlases'] },
  { schema: 'font.json', side: 'assets', folders: ['font'] },
  { schema: 'equipment.json', side: 'assets', folders: ['equipment', 'models/equipment'] },
  { schema: 'particle.json', side: 'assets', folders: ['particles'] },
  { schema: 'sounds.json', globs: ['**/assets/*/sounds.json'] },
  { schema: 'pack_mcmeta.json', globs: ['**/pack.mcmeta'] },
  { schema: 'texture_mcmeta.json', globs: ['**/*.png.mcmeta'] },
  { schema: 'fabric_mod.json', globs: ['**/fabric.mod.json'] },
  { schema: 'quilt_mod.json', globs: ['**/quilt.mod.json'] },
];

/** VS Code `jsonValidation` fileMatch patterns for a mapping. */
export function fileMatches(m: SchemaMapping): string[] {
  const out: string[] = [];
  for (const f of m.folders ?? []) {
    // lang files are flat; everything else may be nested in sub-folders.
    out.push(m.schema === 'lang.json' ? `**/${m.side}/*/${f}/*.json` : `**/${m.side}/*/${f}/**/*.json`);
  }
  out.push(...(m.globs ?? []));
  out.push(...(m.exclude ?? []).map((e) => `!${e}`));
  return out;
}

/** The jsonValidation contribution array (url relative to the extension root). */
export function jsonValidationContributions(): { fileMatch: string[]; url: string }[] {
  return SCHEMA_MAPPINGS.map((m) => ({ fileMatch: fileMatches(m), url: `./schemas/minecraft/${m.schema}` }));
}

/**
 * Returns the schema file name for a file path (forward or back slashes), or undefined.
 * Mirrors the fileMatch patterns: the nearest `data/<ns>/<folder>/` or `assets/<ns>/<folder>/` segment wins.
 */
export function schemaForPath(filePath: string): string | undefined {
  const p = filePath.replace(/\\/g, '/');
  const base = p.slice(p.lastIndexOf('/') + 1);
  if (base === 'pack.mcmeta') return 'pack_mcmeta.json';
  if (base.endsWith('.png.mcmeta')) return 'texture_mcmeta.json';
  if (base === 'fabric.mod.json') return 'fabric_mod.json';
  if (base === 'quilt.mod.json') return 'quilt_mod.json';
  if (!base.endsWith('.json')) return undefined;
  const m = /^(?:.*\/)?(data|assets)\/([^/]+)\/(.+)$/.exec(p);
  if (!m) return undefined;
  const side = m[1] as 'data' | 'assets';
  const rest = m[3];
  if (side === 'assets' && rest === 'sounds.json') return 'sounds.json';
  let best: { schema: string; len: number } | undefined;
  for (const mp of SCHEMA_MAPPINGS) {
    if (mp.side !== side) continue;
    for (const f of mp.folders ?? []) {
      if (!rest.startsWith(`${f}/`)) continue;
      const sub = rest.slice(f.length + 1);
      if (mp.schema === 'lang.json' && (sub.includes('/') || sub === 'deprecated.json')) continue;
      if (!best || f.length > best.len) best = { schema: mp.schema, len: f.length };
    }
  }
  return best?.schema;
}
