// Datapack / resource pack scaffolding (pure: no 'vscode' import).
import { compareVersions, dataFolder, getFeatures } from '../../core/versions';
import { encodePng, packIcon } from './png';

export type PackKind = 'data' | 'resource';

/** First format numbers that use min_format/max_format (snapshots of 1.21.9). */
export const MIN_MAX_THRESHOLD: Record<PackKind, number> = { data: 82, resource: 65 };

export interface PackMetaOptions {
  kind: PackKind;
  /** Oldest supported Minecraft version. */
  minVersion: string;
  /** Newest supported Minecraft version. */
  maxVersion: string;
  description: string;
}

function formatOf(kind: PackKind, version: string): { major: number; minor: number } {
  const f = getFeatures(version);
  return kind === 'data'
    ? { major: f.dataPackFormat, minor: f.dataPackFormatMinor }
    : { major: f.resourcePackFormat, minor: f.resourcePackFormatMinor };
}

/**
 * pack.mcmeta content for a version range.
 *  - Range entirely before 1.21.9: {pack_format, supported_formats?}
 *  - Range entirely 1.21.9+: {min_format, max_format}
 *  - Range crossing 1.21.9: both styles, so old and new game versions accept the pack.
 */
export function buildPackMcmeta(opts: PackMetaOptions): { pack: Record<string, unknown> } {
  let { minVersion, maxVersion } = opts;
  if (compareVersions(minVersion, maxVersion) > 0) [minVersion, maxVersion] = [maxVersion, minVersion];
  const min = formatOf(opts.kind, minVersion);
  const max = formatOf(opts.kind, maxVersion);
  const pack: Record<string, unknown> = { description: opts.description };
  const newStyle = getFeatures(maxVersion).packMetaStyle === 'min_max';
  const oldStyle = getFeatures(minVersion).packMetaStyle === 'pack_format' || min.major < MIN_MAX_THRESHOLD[opts.kind];
  if (oldStyle) {
    pack.pack_format = newStyle ? min.major : max.major;
    if (min.major !== max.major) pack.supported_formats = [min.major, max.major];
  }
  if (newStyle) {
    pack.min_format = min.minor ? [min.major, min.minor] : min.major;
    // A plain number as max_format accepts every minor revision of that major format.
    pack.max_format = max.major;
  }
  return { pack };
}

export interface PackScaffoldOptions extends PackMetaOptions {
  name: string;
  namespace: string;
}

/** Files (relative path -> content) for a new data pack or resource pack. */
export function packFiles(opts: PackScaffoldOptions): Record<string, string | Uint8Array> {
  const files: Record<string, string | Uint8Array> = {};
  const ns = opts.namespace;
  files['pack.mcmeta'] = JSON.stringify(buildPackMcmeta(opts), null, 2) + '\n';
  files['pack.png'] = encodePng(packIcon(opts.kind, opts.name, 64));
  const range = opts.minVersion === opts.maxVersion ? opts.minVersion : `${opts.minVersion} – ${opts.maxVersion}`;
  if (opts.kind === 'data') {
    const tagFolder = dataFolder('tags/function', opts.minVersion);
    const fnFolder = dataFolder('function', opts.minVersion);
    files[`data/minecraft/${tagFolder}/load.json`] = JSON.stringify({ values: [`${ns}:load`] }, null, 2) + '\n';
    files[`data/minecraft/${tagFolder}/tick.json`] = JSON.stringify({ values: [`${ns}:tick`] }, null, 2) + '\n';
    files[`data/${ns}/${fnFolder}/load.mcfunction`] =
      `# Runs once when the data pack is (re)loaded (/reload).\n` +
      `tellraw @a {"text":"${opts.name.replace(/["\\]/g, '')} loaded!","color":"green"}\n`;
    files[`data/${ns}/${fnFolder}/tick.mcfunction`] = `# Runs every game tick (20 times per second). Keep it light!\n`;
    files['README.md'] =
      `# ${opts.name}\n\n${opts.description}\n\n` +
      `Minecraft Java ${range} data pack. Namespace: \`${ns}\`.\n\n` +
      `## Install\n\nCopy this folder (or a zip of it) into \`<world>/datapacks/\` and run \`/reload\`.\n\n` +
      `## Layout\n\n` +
      `- \`data/${ns}/${fnFolder}/load.mcfunction\` – runs on load (tag \`#minecraft:load\`)\n` +
      `- \`data/${ns}/${fnFolder}/tick.mcfunction\` – runs every tick (tag \`#minecraft:tick\`)\n` +
      `- \`data/${ns}/recipe\`, \`loot_table\`, \`advancement\`, \`tags/item\` … – your content\n`;
  } else {
    files[`assets/${ns}/lang/en_us.json`] = JSON.stringify({}, null, 2) + '\n';
    files[`assets/${ns}/textures/item/.gitkeep`] = '';
    files[`assets/${ns}/models/item/.gitkeep`] = '';
    files['README.md'] =
      `# ${opts.name}\n\n${opts.description}\n\n` +
      `Minecraft Java ${range} resource pack. Namespace: \`${ns}\`.\n\n` +
      `## Install\n\nCopy this folder (or a zip of it) into \`.minecraft/resourcepacks/\` and enable it in Options → Resource Packs.\n\n` +
      `To override vanilla assets, put files under \`assets/minecraft/\` (e.g. \`assets/minecraft/textures/item/diamond.png\`).\n`;
  }
  return files;
}

/** Valid namespace: [a-z0-9_.-]+ */
export function isValidNamespace(ns: string): boolean {
  return /^[a-z0-9_.-]+$/.test(ns);
}
