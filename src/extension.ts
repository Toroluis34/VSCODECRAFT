import * as vscode from 'vscode';
import { Core } from './core/core';
import { activateCoreCommands } from './core/commands';
import { FEATURES } from './features';

let core: Core | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<Core> {
  core = new Core(context);
  activateCoreCommands(core);
  for (const [name, feature] of Object.entries(FEATURES)) {
    try {
      await feature.activate(core);
    } catch (e) {
      core.log.error(`Feature "${name}" failed to activate: ${e instanceof Error ? (e.stack ?? e.message) : e}`);
    }
  }
  core.log.info(`VSCodeCraft activated (${Object.keys(FEATURES).length} features)`);
  return core;
}

export function deactivate(): void {
  core = undefined;
}
