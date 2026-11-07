# VSCodeCraft — contributor / agent guide

VS Code extension: all-in-one Minecraft Java modding toolkit (Fabric, Quilt, NeoForge, Forge, datapacks,
resource packs) targeting **Minecraft 1.21 – 1.21.11 and 26.1+** (new version scheme: 26.1, 26.2, 26.3, 26.4 snapshots).

## Layout

```
src/extension.ts            activate(): builds Core, activates every feature in src/features/index.ts
src/core/                   shared services (DO NOT edit unless you are the core owner)
  core.ts                   Core: index, projects, vanilla, registries, icons, webviews, log, registerCommand()
  versions.ts               version table + getFeatures(version) → format differences (USE THIS, never hard-code)
  resourceLocation.ts       parseRL/normalizeId/classifyPath/resourceRelativePath/humanize/toResourcePath
  workspaceIndex.ts         every data/ + assets/ file by kind & id (kind = "recipe", "tags/item", "models", "textures", "lang", ...)
  projects.ts               detected projects: loader, modIds, namespaces, resourceRoots, mainResourceRoot, targetVersion()
  vanillaData.ts            vanilla data per version (registries, tags, recipes, loot tables, models, atlas, lang)
  registries.ts             merged vanilla+workspace ids, names, expandTag, search
  icons.ts                  resolve item visuals for webviews
  webviews.ts               createPanel()/attach() with RPC + common handlers
  jsonUtils.ts              jsonc helpers: locationAt, nodeAt, forEachString, modifyEdits, replaceDocument
  fsUtils.ts                readJson/writeJson/createFile/openFile/exists
src/shared/protocol.ts      types shared with webviews (ItemVisual, CommonRpc ...)
src/features/<name>/        ONE folder per feature (you own yours entirely)
  index.ts                  export function activate(core: Core): void | Promise<void>
  contributes.json          the feature's package.json "contributes" fragment (merged by scripts/build-manifest.mjs)
  package.nls.json          English strings for %placeholders% used in contributes.json
  package.nls.es.json       Spanish strings for the same keys
  l10n.es.json              { "English runtime string": "Spanish" } for vscode.l10n.t() AND webview t()
webview-src/shared/         vscode.ts (call/onEvent/boot), i18n.ts (t), itemRenderer.ts, components.tsx (ItemIcon, Slot, ItemPicker, Button, McText)
webview-src/<bundle>/index.tsx  a webview bundle (auto-discovered by esbuild) → dist/webview/<bundle>.js
media/webview.css           shared styles: mc-slot, mc-gui, mc-button, mc-input, mc-card, mc-table, mc-tabs ...
schemas/, snippets/, syntaxes/  put your files in a subfolder or with a prefix named after your feature
resources/data/             bundled vanilla data (gz) + versions.json
test/<feature>/*.test.ts    node:test unit tests for PURE modules (no 'vscode' import) — run `npm test`
```

## Rules

- **Only edit files you own** (your feature folder, your webview bundle folders, your schemas/snippets/syntaxes files,
  your tests). Do not edit package.json, src/core, webview-src/shared, media/webview.css, src/features/index.ts.
  If you need something from core, implement it locally in your feature and mention it in your final report.
- Command ids: `vscodecraft.<feature>.<action>`; settings: `vscodecraft.<feature>.<name>`; view ids: `vscodecraft.<x>`.
  Every command title in contributes.json uses `%key%` placeholders with English + Spanish nls entries,
  `"category": "VSCodeCraft"` and a codicon `icon` when shown in menus.
- All user-visible runtime strings: `vscode.l10n.t('English text {0}', arg)` on the host and `t('English')` in webviews,
  with Spanish translations in your `l10n.es.json`. The user is Spanish-speaking — make the Spanish good.
- Version awareness: always get the target version with `core.version(uri)` / `core.features(uri)` and write files in
  the correct format for it (ingredient string vs object, item definitions only 1.21.4+, pack.mcmeta min/max format
  1.21.9+, brewing recipes 26.3+, crafting_dye/imbue 26.1+, Java 25 for 26.1+ ...). Read src/core/versions.ts.
- Where to create files: `core.projects.resourceRoot(uri)` (folder containing data/ & assets/) +
  `resourceRelativePath(side, kind, id)`; namespace `core.projects.defaultNamespace(uri)`.
- Vanilla data: `core.vanilla.*` (downloads lazily, cached; bundled fallback for registries/tags/names).
  Real data format reference: https://raw.githubusercontent.com/misode/mcmeta/<version>-summary/... and
  `<version>-data/data/minecraft/...` (e.g. 26.3-data/data/minecraft/recipe/iron_pickaxe.json). You can curl these.
- No new npm dependencies. Available: jsonc-parser, fflate (zip), smol-toml, preact 10 (webviews, JSX via
  `jsxImportSource: preact`, hooks from 'preact/hooks').
- Webviews: create with `core.webviews.createPanel({ viewType, title, bundle, state, documentUri, handlers })`
  (or `core.webviews.attach(webview, ...)` for WebviewView / CustomTextEditor). Webview side: `call(method, params)`
  for RPC (common methods typed in src/shared/protocol.ts CommonRpc), `onEvent(name, cb)` for host → webview pushes
  (`host.post(name, data)`), `boot().state` for the initial state. Use the shared components & CSS classes.
- Keep logic that can be pure in separate modules without `vscode` imports and unit test it in `test/<feature>/`.
- Don't commit or push — the coordinator does that.

## Verify before reporting

```
node scripts/build-manifest.mjs     # merges contributions; must not throw
npx tsc --noEmit -p .               # host code (filter output to your files if others are mid-edit)
npx tsc --noEmit -p webview-src     # webview code
node esbuild.mjs                    # bundles
npm test                            # unit tests
node scripts/webview-harness.mjs <bundle> --state s.json --fixtures f.mjs --out shot.png   # screenshot a webview
```
The harness answers common RPCs with real vanilla 26.3 data; your feature RPCs come from a fixtures module
(`export default { 'my.method': (params) => result }`, optional `export const events = [{event, data, delay}]`)
and `--script actions.mjs` (`export default async (page) => {...}`) can click around. Look at the screenshot
(Read tool on the png) and iterate until it looks good in dark AND light themes (`--theme light`).
Put screenshots and scratch files in your scratchpad, not in the repo.
