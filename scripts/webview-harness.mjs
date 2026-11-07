#!/usr/bin/env node
// Render a webview bundle outside VS Code (Playwright + Chromium) to check it visually.
//
//   npm run build   (or node esbuild.mjs)
//   node scripts/webview-harness.mjs <bundle> [--state state.json] [--fixtures fixtures.mjs]
//        [--out shot.png] [--width 1100] [--height 800] [--theme dark|light] [--wait 1500]
//        [--script actions.mjs] [--lang es]
//
// Common RPC methods (icons.resolve, items.search, tags.expand, names.get, ...) are answered with
// real vanilla 26.3 data downloaded once into .harness-cache/. A fixtures module can add or override
// handlers:   export default { 'recipe.load': (params) => ({...}) }   and may export `events` = [{event, data, delay}]
// An actions module can drive the page:  export default async (page) => { await page.click('...') }
// Console messages and page errors are printed so you can debug.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const args = process.argv.slice(2);
const bundle = args[0];
if (!bundle) {
  console.error('usage: node scripts/webview-harness.mjs <bundle> [--state file] [--fixtures file] [--out file]');
  process.exit(1);
}
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const root = process.cwd();
const out = opt('out', `harness-${bundle}.png`);
const width = Number(opt('width', 1100));
const height = Number(opt('height', 800));
const theme = opt('theme', 'dark');
const wait = Number(opt('wait', 1500));
const uiLang = opt('lang', 'en');
const state = opt('state') ? JSON.parse(fs.readFileSync(opt('state'), 'utf8')) : null;
const fixtures = opt('fixtures') ? (await import(pathToFileURL(path.resolve(opt('fixtures'))).href)) : {};
const actions = opt('script') ? (await import(pathToFileURL(path.resolve(opt('script'))).href)).default : null;
const VERSION = opt('version', '26.3');

// ---------- vanilla data cache ----------
const CACHE = path.join(root, '.harness-cache', VERSION);
fs.mkdirSync(CACHE, { recursive: true });
const BASE = 'https://raw.githubusercontent.com/misode/mcmeta';
function download(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'vscodecraft-harness' } }, (res) => {
        if (res.statusCode !== 200) return reject(new Error(`${res.statusCode} ${url}`));
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      })
      .on('error', reject);
  });
}
async function cached(name, url) {
  const f = path.join(CACHE, name);
  if (!fs.existsSync(f)) fs.writeFileSync(f, await download(url));
  return f;
}
const json = async (name, url) => JSON.parse(fs.readFileSync(await cached(name, url), 'utf8'));
const atlas = await json('atlas.json', `${BASE}/${VERSION}-atlas/all/data.min.json`);
await cached('atlas.png', `${BASE}/${VERSION}-atlas/all/atlas.png`);
const models = await json('models.json', `${BASE}/${VERSION}-summary/assets/model/data.min.json`);
const itemDefs = await json('item_definitions.json', `${BASE}/${VERSION}-summary/assets/item_definition/data.min.json`);
const registries = await json('registries.json', `${BASE}/${VERSION}-summary/registries/data.min.json`);
const itemTags = await json('tags_item.json', `${BASE}/${VERSION}-summary/data/tag/item/data.min.json`);
const enUs = await json('en_us.json', `${BASE}/${VERSION}-assets-json/assets/minecraft/lang/en_us.json`);

// ---------- static server ----------
const MIME = { '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.html': 'text/html', '.svg': 'image/svg+xml' };
let html = '';
const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
  if (url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(html);
  }
  const file = url.startsWith('/cache/') ? path.join(CACHE, url.slice(7)) : url.startsWith('/ws/') ? path.join(root, url.slice(4)) : path.join(root, url);
  if (!fs.existsSync(file)) {
    res.writeHead(404);
    return res.end();
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const PORT = server.address().port;
const ORIGIN = `http://localhost:${PORT}`;

// ---------- common RPC handlers ----------
const ns = (id) => (id.includes(':') ? id : `minecraft:${id}`);
const strip = (id) => id.replace(/^#/, '').replace(/^minecraft:/, '');
const tex = (id) => {
  const r = atlas[strip(id)];
  return r ? { src: `${ORIGIN}/cache/atlas.png`, rect: r } : null;
};
function pickModel(node, d = 0) {
  if (!node || d > 10) return undefined;
  const t = String(node.type ?? '').replace('minecraft:', '');
  if (t === 'model') return node.model;
  if (t === 'condition') return pickModel(node.on_false, d + 1) ?? pickModel(node.on_true, d + 1);
  if (t === 'select') return pickModel(node.fallback, d + 1) ?? pickModel(node.cases?.[0]?.model, d + 1);
  if (t === 'range_dispatch') return pickModel(node.fallback, d + 1) ?? pickModel(node.entries?.[0]?.model, d + 1);
  if (t === 'composite') return pickModel(node.models?.[0], d + 1);
  if (t === 'special') return node.base;
}
function resolveItem(id) {
  if (id.startsWith('#')) id = expandTag(id)[0] ?? id;
  const p = strip(id);
  const modelId = strip(pickModel(itemDefs[p]?.model) ?? `item/${p}`);
  const textures = {};
  let elements, gui, generated = false;
  for (let cur = modelId, i = 0; cur && i < 20; i++) {
    if (cur === 'builtin/generated') { generated = true; break; }
    const m = models[strip(cur)];
    if (!m) break;
    for (const [k, v] of Object.entries(m.textures ?? {})) { const tv = typeof v === 'string' ? v : v?.sprite; if (tv && !(k in textures)) textures[k] = tv; }
    elements ??= m.elements;
    gui ??= m.display?.gui;
    cur = m.parent ? strip(m.parent) : undefined;
  }
  if (!elements && Object.keys(textures).some((k) => k.startsWith('layer'))) generated = true;
  const res = (n) => { let v = textures[n.replace('#', '')]; for (let i = 0; v?.startsWith('#') && i < 10; i++) v = textures[v.slice(1)]; return v ? tex(v) : null; };
  if (generated) {
    const layers = [];
    for (let i = 0; i < 5; i++) if (textures[`layer${i}`]) { const t = res(`layer${i}`); if (t) layers.push({ texture: t }); }
    if (layers.length) return { type: 'flat', id, layers };
  }
  if (elements) {
    return {
      type: 'model', id, gui,
      tint: /leaves|grass|fern|vine/.test(p) ? '#48b518' : undefined,
      elements: elements.map((e) => ({ ...e, faces: Object.fromEntries(Object.entries(e.faces ?? {}).map(([k, f]) => [k, { ...f, texture: res(f.texture) }])) })),
    };
  }
  const t = tex(`item/${p}`) ?? tex(`block/${p}`);
  if (t) return { type: 'flat', id, layers: [{ texture: t }] };
  return { type: 'missing', id, label: p.replace(/_/g, ' ') };
}
function expandTag(tag, seen = new Set()) {
  const k = strip(tag);
  if (seen.has(k)) return [];
  seen.add(k);
  const out = [];
  for (const v of itemTags[k]?.values ?? []) {
    const s = typeof v === 'string' ? v : v.id;
    if (s.startsWith('#')) out.push(...expandTag(s, seen));
    else out.push(ns(s));
  }
  return out;
}
const nameOf = (id) => enUs[`item.minecraft.${strip(id)}`] ?? enUs[`block.minecraft.${strip(id)}`] ?? strip(id);
const common = {
  'icons.resolve': ({ ids }) => Object.fromEntries(ids.map((id) => { try { return [id, resolveItem(id)]; } catch (e) { console.error(id, e); return [id, { type: 'missing', id, label: id }]; } })),
  'textures.resolve': ({ ids }) => Object.fromEntries(ids.map((id) => [id, tex(id)])),
  'items.search': ({ query = '', limit = 60, registry = 'item' }) => {
    const q = query.toLowerCase();
    const list = (registries[registry] ?? []).map((x) => ({ id: ns(x), name: registry === 'item' ? nameOf(x) : undefined, source: 'vanilla' }));
    return list.filter((e) => !q || e.id.includes(q) || (e.name ?? '').toLowerCase().includes(q)).slice(0, limit);
  },
  'tags.expand': ({ tag }) => expandTag(tag),
  'names.get': ({ ids }) => Object.fromEntries(ids.map((id) => [id, nameOf(id)])),
  'file.open': (p) => console.log('[file.open]', p),
  'ui.notify': (p) => console.log('[notify]', p),
  'project.info': () => ({ version: VERSION, loader: 'fabric', namespaces: ['examplemod'], defaultNamespace: 'examplemod' }),
};
const handlers = { ...common, ...(fixtures.default ?? {}) };

// ---------- page ----------
const l10n = uiLang === 'en' ? {} : (() => { try { return JSON.parse(fs.readFileSync(path.join(root, `l10n/bundle.l10n.${uiLang}.json`), 'utf8')); } catch { return {}; } })();
const dark = theme === 'dark';
const vars = dark
  ? `--vscode-foreground:#cccccc;--vscode-editor-background:#1e1e1e;--vscode-descriptionForeground:#9d9d9d;--vscode-input-background:#3c3c3c;--vscode-input-foreground:#cccccc;--vscode-input-border:#3c3c3c;--vscode-button-background:#0e639c;--vscode-button-foreground:#fff;--vscode-button-hoverBackground:#1177bb;--vscode-button-secondaryBackground:#3a3d41;--vscode-button-secondaryForeground:#fff;--vscode-focusBorder:#007fd4;--vscode-panel-border:#444;--vscode-editorWidget-background:#252526;--vscode-widget-border:#454545;--vscode-badge-background:#4d4d4d;--vscode-badge-foreground:#fff;--vscode-list-hoverBackground:#2a2d2e;--vscode-dropdown-background:#3c3c3c;--vscode-dropdown-foreground:#f0f0f0;--vscode-textLink-foreground:#3794ff;--vscode-errorForeground:#f48771;--vscode-sideBar-background:#252526;--vscode-font-family:Segoe UI,Ubuntu,sans-serif;--vscode-font-size:13px;--vscode-editor-font-family:monospace;--vscode-list-activeSelectionBackground:#04395e;--vscode-list-activeSelectionForeground:#fff;`
  : `--vscode-foreground:#3b3b3b;--vscode-editor-background:#ffffff;--vscode-descriptionForeground:#717171;--vscode-input-background:#fff;--vscode-input-foreground:#3b3b3b;--vscode-input-border:#cecece;--vscode-button-background:#005fb8;--vscode-button-foreground:#fff;--vscode-button-hoverBackground:#0258a8;--vscode-button-secondaryBackground:#e5e5e5;--vscode-button-secondaryForeground:#3b3b3b;--vscode-focusBorder:#005fb8;--vscode-panel-border:#e5e5e5;--vscode-editorWidget-background:#f8f8f8;--vscode-widget-border:#e5e5e5;--vscode-badge-background:#cccccc;--vscode-badge-foreground:#3b3b3b;--vscode-list-hoverBackground:#f2f2f2;--vscode-dropdown-background:#fff;--vscode-dropdown-foreground:#3b3b3b;--vscode-textLink-foreground:#005fb8;--vscode-errorForeground:#e51400;--vscode-sideBar-background:#f8f8f8;--vscode-font-family:Segoe UI,Ubuntu,sans-serif;--vscode-font-size:13px;--vscode-editor-font-family:monospace;--vscode-list-activeSelectionBackground:#e8e8e8;--vscode-list-activeSelectionForeground:#000;`;
html = `<!DOCTYPE html><html lang="${uiLang}"><head><meta charset="UTF-8"><link rel="stylesheet" href="/media/webview.css">
<style>html{${vars}}</style></head><body class="vscode-${theme}"><div id="app"></div>
<script>
window.__VSCODECRAFT__ = ${JSON.stringify({ language: uiLang, l10n, state })};
window.acquireVsCodeApi = () => ({
  postMessage: async (m) => {
    if (!m || m.kind !== 'rpc') return console.log('[post]', JSON.stringify(m));
    let res;
    try { res = { kind: 'rpc-result', id: m.id, result: await window.__rpc(m.method, m.params ?? null) }; }
    catch (e) { res = { kind: 'rpc-result', id: m.id, error: String(e && e.message || e) }; }
    window.dispatchEvent(new MessageEvent('message', { data: res }));
  },
  getState: () => undefined, setState: () => {},
});
window.__hostEvent = (event, data) => window.dispatchEvent(new MessageEvent('message', { data: { kind: 'event', event, data } }));
</script>
<script src="/dist/webview/${bundle}.js"></script></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
page.on('console', (m) => console.log(`[console.${m.type()}]`, m.text()));
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.exposeFunction('__rpc', async (method, params) => {
  const fn = handlers[method];
  if (!fn) throw new Error(`No handler for ${method}`);
  const r = await fn(params ?? {});
  return r === undefined ? null : r;
});
await page.goto(ORIGIN);
for (const ev of fixtures.events ?? []) {
  await page.waitForTimeout(ev.delay ?? 100);
  await page.evaluate(([e, d]) => window.__hostEvent(e, d), [ev.event, ev.data]);
}
await page.waitForTimeout(wait);
if (actions) {
  await actions(page);
  await page.waitForTimeout(500);
}
await page.screenshot({ path: out, fullPage: true });
console.log(`Screenshot saved to ${out}`);
await browser.close();
server.close();
