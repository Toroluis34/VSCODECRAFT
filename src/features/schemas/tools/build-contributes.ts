// Regenerates src/features/schemas/contributes.json from schemaMap.ts (run: npx tsx src/features/schemas/tools/build-contributes.ts).
import fs from 'node:fs';
import path from 'node:path';
import { jsonValidationContributions } from '../schemaMap';

const file = path.resolve(__dirname, '../contributes.json');
const contributes = {
  commands: [
    { command: 'vscodecraft.schemas.validateAll', title: '%schemas.validateAll%', category: 'VSCodeCraft', icon: '$(checklist)' },
  ],
  languages: [{ id: 'json', extensions: ['.mcmeta'] }],
  jsonValidation: jsonValidationContributions(),
  snippets: [{ language: 'json', path: './snippets/json-minecraft.json' }],
  configuration: {
    properties: {
      'vscodecraft.schemas.versionChecks': {
        type: 'boolean',
        default: true,
        markdownDescription: '%schemas.config.versionChecks%',
        scope: 'resource',
      },
    },
  },
};
fs.writeFileSync(file, JSON.stringify(contributes, null, 2) + '\n');
console.log('wrote', file);
