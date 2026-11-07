import type { Core } from '../../core/core';
import { ModelViewer } from './viewer';
import { registerGenerator } from './generator';
import { registerQuickCommands } from './quickCommands';

/**
 * Feature "models":
 *  - Model Viewer (panel + custom editor) for models/**, blockstates/* and items/* json files
 *  - "New Item…" / "New Block…" generator webview
 *  - Generate Block Model Set, Create Item Model Definitions from Item Models
 */
export function activate(core: Core): void {
  const viewer = new ModelViewer(core);
  viewer.register();
  registerGenerator(core, viewer.resolver);
  registerQuickCommands(core);
}
