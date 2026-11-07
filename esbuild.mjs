// Bundles the extension host code and every webview entry point.
// Webview entries are discovered automatically: webview-src/<name>/index.ts(x) -> dist/webview/<name>.js
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

const webviewEntries = {};
for (const dir of fs.readdirSync('webview-src', { withFileTypes: true })) {
  if (!dir.isDirectory() || dir.name === 'shared') continue;
  for (const f of ['index.tsx', 'index.ts']) {
    const p = path.join('webview-src', dir.name, f);
    if (fs.existsSync(p)) { webviewEntries[dir.name] = p; break; }
  }
}

/** @type {import('esbuild').BuildOptions} */
const extensionOptions = {
  entryPoints: { extension: 'src/extension.ts' },
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  outdir: 'dist',
  external: ['vscode'],
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
  loader: { '.html': 'text' },
};

/** @type {import('esbuild').BuildOptions} */
const webviewOptions = {
  entryPoints: webviewEntries,
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  outdir: 'dist/webview',
  sourcemap: production ? false : 'inline',
  minify: production,
  jsx: 'automatic',
  jsxImportSource: 'preact',
  loader: { '.css': 'text', '.svg': 'text', '.png': 'dataurl' },
  logLevel: 'info',
};

if (watch) {
  const a = await esbuild.context(extensionOptions);
  const b = await esbuild.context(webviewOptions);
  await Promise.all([a.watch(), b.watch()]);
} else {
  await Promise.all([esbuild.build(extensionOptions), esbuild.build(webviewOptions)]);
}
