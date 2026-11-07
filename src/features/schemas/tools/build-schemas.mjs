#!/usr/bin/env node
// Generates schemas/minecraft/*.json (JSON Schema draft-07) from the definitions in this folder and the
// bundled vanilla registries (resources/data/*.json.gz). Run from the repo root:
//   node src/features/schemas/tools/build-schemas.mjs
import fs from 'node:fs';
import path from 'node:path';
import { writeSchema, ROOT } from './lib.mjs';
import { buildCommon } from './common.mjs';
import { buildComponents } from './components.mjs';
import { buildData } from './data.mjs';
import { buildAssets } from './assets.mjs';
import { buildMeta } from './meta.mjs';

const outDir = path.join(ROOT, 'schemas/minecraft');
fs.rmSync(outDir, { recursive: true, force: true });

const files = {
  'common.json': buildCommon(),
  'item-components.json': buildComponents(),
  ...buildData(),
  ...buildAssets(),
  ...buildMeta(),
};
for (const [name, schema] of Object.entries(files)) writeSchema(name, schema);
console.log(`wrote ${Object.keys(files).length} schemas to ${path.relative(ROOT, outDir)}`);
