// pack.mcmeta, fabric.mod.json, quilt.mod.json
import { md, cref, obj, str, int, bool, arr, RL } from './lib.mjs';

const formatValue = (t) => md(t, { anyOf: [{ type: 'integer', minimum: 1 }, { type: 'array', items: { type: 'integer', minimum: 0 }, minItems: 1, maxItems: 2 }] });
const formatRange = (t) => md(t, { anyOf: [{ type: 'integer' }, { type: 'array', items: { type: 'integer' }, minItems: 2, maxItems: 2 }, obj({ min_inclusive: int('Minimum.'), max_inclusive: int('Maximum.') }, { required: ['min_inclusive', 'max_inclusive'] })] });

const packMcmeta = {
  title: 'Minecraft pack.mcmeta',
  type: 'object',
  properties: {
    pack: md('Pack metadata.', obj({
      description: md('Description shown in the pack list (text component).', cref('textComponent')),
      pack_format: int('Pack format. Required before 1.21.9; in 1.21.9+ use `min_format`/`max_format` (keep `pack_format` too for older clients). Data packs: 48 = 1.21.1, 61 = 1.21.4, 71 = 1.21.5, 81 = 1.21.7, 88 = 1.21.9, 94.1 = 1.21.11, 101.1 = 26.1, 107.1 = 26.2, 121 = 26.3. Resource packs: 34 = 1.21.1, 46 = 1.21.4, 55 = 1.21.5, 64 = 1.21.7, 69 = 1.21.9, 75 = 1.21.11, 84 = 26.1, 88 = 26.2, 97.1 = 26.3.', { minimum: 1 }),
      supported_formats: formatRange('Range of supported formats (1.20.2 – 1.21.8): int, `[min, max]` or `{"min_inclusive", "max_inclusive"}`.'),
      min_format: formatValue('Minimum supported format (1.21.9+): `N` or `[major, minor]`.'),
      max_format: formatValue('Maximum supported format (1.21.9+): `N` or `[major, minor]`.'),
    }, {
      required: ['description'],
      anyOf: [{ required: ['pack_format'] }, { required: ['min_format', 'max_format'] }],
    })),
    overlays: md('Overlay directories applied for some formats.', obj({
      entries: arr(obj({ directory: md('Overlay directory (a-z0-9_-).', { type: 'string', pattern: '^[a-z0-9_-]+$' }), formats: formatRange('Formats (≤1.21.8).'), min_format: formatValue('Minimum format (1.21.9+).'), max_format: formatValue('Maximum format (1.21.9+).') }, { required: ['directory'] }), 'Overlays.'),
    }, { required: ['entries'] })),
    filter: md('Hide files from lower packs.', obj({ block: arr(obj({ namespace: str('Namespace regex.'), path: str('Path regex.') }), 'Patterns to hide.') }, { required: ['block'] })),
    features: md('Experimental features (data packs).', obj({ enabled: arr({ type: 'string', pattern: RL }, 'Feature flags, e.g. `minecraft:trade_rebalance`.') })),
    language: md('Languages added by a resource pack.', { type: 'object', additionalProperties: obj({ name: str('Language name.'), region: str('Region.'), bidirectional: bool('Right-to-left.') }, { required: ['name', 'region'] }) }),
  },
  required: ['pack'],
  defaultSnippets: [
    { label: 'data pack 26.3', body: { pack: { description: '${1:My data pack}', min_format: 121, max_format: 121 } } },
    { label: 'data pack 1.21.1', body: { pack: { description: '${1:My data pack}', pack_format: 48 } } },
  ],
};

// ---------------------------------------------------------------------------------------------------------------
const MOD_ID = '^[a-z][a-z0-9_-]{1,63}$';
const person = { anyOf: [{ type: 'string' }, obj({ name: str('Name.'), contact: md('Contact info.', { type: 'object' }) }, { required: ['name'] })] };
const depMap = (t) => md(t, { type: 'object', additionalProperties: { anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] } });
const entrypoint = arr({ anyOf: [{ type: 'string' }, obj({ adapter: str('Language adapter.'), value: str('Class / field / method reference.') }, { required: ['value'] })] }, 'Entrypoint classes.');
const fabricModJson = {
  title: 'fabric.mod.json',
  type: 'object',
  properties: {
    schemaVersion: md('Schema version (always 1).', { const: 1 }),
    id: str('Mod id: lowercase, 2–64 chars, starts with a letter.', { pattern: MOD_ID }),
    version: str('Mod version (semver recommended; `${version}` is expanded by Gradle).'),
    name: str('Display name.'),
    description: str('Description.'),
    authors: arr(person, 'Authors.'),
    contributors: arr(person, 'Contributors.'),
    contact: md('Contact links.', obj({ email: str('Email.'), irc: str('IRC.'), homepage: str('Homepage URL.'), issues: str('Issue tracker URL.'), sources: str('Source code URL.') })),
    license: md('License (SPDX id) or list.', { type: ['string', 'array'] }),
    icon: md('Icon path in the jar, or size → path map.', { type: ['string', 'object'] }),
    environment: md('Where the mod loads.', { enum: ['*', 'client', 'server'] }),
    entrypoints: md('Entrypoints.', { type: 'object', properties: { main: entrypoint, client: entrypoint, server: entrypoint, 'fabric-datagen': entrypoint, preLaunch: entrypoint }, additionalProperties: entrypoint }),
    mixins: arr({ anyOf: [{ type: 'string' }, obj({ config: str('Mixin config file.'), environment: md('Environment.', { enum: ['*', 'client', 'server'] }) }, { required: ['config'] })] }, 'Mixin configs.'),
    accessWidener: str('Access widener file.'),
    depends: depMap('Required dependencies: mod id → version range (`>=0.100.0`, `~1.21`, `*`).'),
    recommends: depMap('Recommended (warning if missing).'),
    suggests: depMap('Suggested.'),
    breaks: depMap('Incompatible (crash).'),
    conflicts: depMap('Conflicting (warning).'),
    jars: arr(obj({ file: str('Nested jar path.') }, { required: ['file'] }), 'Nested jars.'),
    languageAdapters: md('Language adapters.', { type: 'object', additionalProperties: { type: 'string' } }),
    provides: arr({ type: 'string' }, 'Alias mod ids.'),
    custom: md('Custom data (e.g. `modmenu`).', { type: 'object' }),
  },
  required: ['schemaVersion', 'id', 'version'],
};

const quiltDep = { anyOf: [{ type: 'string' }, obj({ id: str('Mod id (`group:id` or id).'), versions: md('Version ranges.', { type: ['string', 'array', 'object'] }), reason: str('Reason.'), optional: bool('Optional.'), unless: md('Unless.', { type: ['string', 'object', 'array'] }) }, { required: ['id'] }), { type: 'array' }] };
const quiltModJson = {
  title: 'quilt.mod.json',
  type: 'object',
  properties: {
    schema_version: md('Schema version (1).', { const: 1 }),
    quilt_loader: md('Loader metadata.', obj({
      group: str('Maven group.'), id: str('Mod id.', { pattern: MOD_ID }), version: str('Version.'),
      provides: md('Provided ids.', { type: 'array' }),
      entrypoints: md('Entrypoints (`init`, `client_init`, `server_init`, …).', { type: 'object' }),
      plugins: md('Loader plugins.', { type: 'array' }),
      jars: arr({ type: 'string' }, 'Nested jars.'),
      language_adapters: md('Language adapters.', { type: 'object' }),
      depends: arr(quiltDep, 'Dependencies.'), breaks: arr(quiltDep, 'Breaks.'),
      load_type: md('Load type.', { enum: ['always', 'if_possible', 'if_required'] }),
      repositories: arr({ type: 'string' }, 'Maven repositories.'),
      intermediate_mappings: str('Intermediate mappings.'),
      metadata: obj({ name: str('Name.'), description: str('Description.'), contributors: md('Name → role.', { type: 'object' }), contact: md('Contact.', { type: 'object' }), license: md('License.', { type: ['string', 'array', 'object'] }), icon: md('Icon.', { type: ['string', 'object'] }) }),
    }, { required: ['group', 'id', 'version'] })),
    mixin: md('Mixin config(s).', { type: ['string', 'array'] }),
    access_widener: md('Access widener(s).', { type: ['string', 'array'] }),
    minecraft: obj({ environment: md('Environment.', { enum: ['*', 'client', 'dedicated_server'] }) }),
  },
  required: ['schema_version', 'quilt_loader'],
};

export function buildMeta() {
  return { 'pack_mcmeta.json': packMcmeta, 'fabric_mod.json': fabricModJson, 'quilt_mod.json': quiltModJson };
}
