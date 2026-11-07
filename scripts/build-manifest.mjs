// Merges every feature's contribution fragment into package.json and builds localization bundles.
//
//   src/core/contributes.json                    base contributions (owned by core)
//   src/features/<name>/contributes.json         a feature's "contributes" fragment
//   src/features/<name>/package.nls.json         English strings for %placeholders% used in its contributes.json
//   src/features/<name>/package.nls.es.json      Spanish strings for the same placeholders
//   src/features/<name>/l10n.es.json             { "English runtime string": "Spanish translation" }
//                                                (used by vscode.l10n.t() and by webviews' t())
//
// Arrays are concatenated, objects merged recursively. Duplicate command ids / setting keys fail the build.
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const exists = (p) => fs.existsSync(p);

function merge(a, b, where) {
  if (Array.isArray(a) && Array.isArray(b)) return [...a, ...b];
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const out = { ...a };
    for (const [k, v] of Object.entries(b)) {
      if (k in out) {
        if (where.endsWith('properties') && typeof v === 'object') throw new Error(`Duplicate setting "${k}"`);
        out[k] = merge(out[k], v, `${where}.${k}`);
      } else out[k] = v;
    }
    return out;
  }
  return b === undefined ? a : b;
}

const sources = [path.join(root, 'src/core')];
const featuresDir = path.join(root, 'src/features');
for (const d of fs.readdirSync(featuresDir, { withFileTypes: true })) {
  if (d.isDirectory()) sources.push(path.join(featuresDir, d.name));
}

let contributes = {};
let nls = {};
let nlsEs = {};
let l10nEs = {};
for (const dir of sources) {
  const c = path.join(dir, 'contributes.json');
  if (exists(c)) contributes = merge(contributes, read(c), 'contributes');
  const n = path.join(dir, 'package.nls.json');
  if (exists(n)) Object.assign(nls, read(n));
  const ne = path.join(dir, 'package.nls.es.json');
  if (exists(ne)) Object.assign(nlsEs, read(ne));
  const le = path.join(dir, 'l10n.es.json');
  if (exists(le)) Object.assign(l10nEs, read(le));
}

// Sanity checks
const ids = new Set();
for (const cmd of contributes.commands ?? []) {
  if (ids.has(cmd.command)) throw new Error(`Duplicate command id ${cmd.command}`);
  ids.add(cmd.command);
}
const placeholders = JSON.stringify(contributes).match(/%[A-Za-z0-9_.-]+%/g) ?? [];
const missing = [...new Set(placeholders.map((p) => p.slice(1, -1)))].filter((k) => !(k in nls));
if (missing.length) console.warn(`[manifest] Missing English nls keys: ${missing.join(', ')}`);

const pkgPath = path.join(root, 'package.json');
const pkg = read(pkgPath);
pkg.contributes = contributes;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
fs.writeFileSync(path.join(root, 'package.nls.json'), JSON.stringify(nls, null, 2) + '\n');
fs.writeFileSync(path.join(root, 'package.nls.es.json'), JSON.stringify(nlsEs, null, 2) + '\n');
fs.mkdirSync(path.join(root, 'l10n'), { recursive: true });
fs.writeFileSync(path.join(root, 'l10n/bundle.l10n.es.json'), JSON.stringify(l10nEs, null, 2) + '\n');
console.log(`[manifest] ${ids.size} commands, ${Object.keys(nls).length} nls keys, ${Object.keys(l10nEs).length} es runtime strings`);
