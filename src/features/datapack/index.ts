import type { Core } from '../../core/core';
import { registerPackMcmeta } from './packMcmeta';
import { registerMigration } from './migrate';
import { registerExport } from './export';
import { registerTags } from './tags';
import { registerMcfunction } from './mcfunction';
import { registerDoctor } from './doctor';

/**
 * Feature "datapack": pack.mcmeta tools, version migration, zip export / install, tag viewer & editor,
 * .mcfunction language support and the Pack Doctor.
 */
export function activate(core: Core): void {
  registerPackMcmeta(core);
  registerMigration(core);
  registerExport(core);
  registerTags(core);
  registerMcfunction(core);
  registerDoctor(core);
}
