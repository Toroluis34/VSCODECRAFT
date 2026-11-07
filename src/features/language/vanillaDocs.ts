import * as vscode from 'vscode';
import type { Core } from '../../core/core';

/** URI scheme of read-only vanilla files (e.g. vscodecraft-vanilla:/26.3/data/minecraft/recipe/iron_pickaxe.json). */
export const VANILLA_SCHEME = 'vscodecraft-vanilla';

/**
 * Read-only virtual document for a vanilla data/asset file of a version.
 * `filePath` is relative to the jar root: "data/minecraft/recipe/iron_pickaxe.json",
 * "assets/minecraft/models/block/stone.json". Open it with vscode.window.showTextDocument(vanillaUri(...)).
 */
export function vanillaUri(version: string, filePath: string): vscode.Uri {
  return vscode.Uri.from({ scheme: VANILLA_SCHEME, path: `/${version}/${filePath.replace(/^\/+/, '')}` });
}

/** Inverse of vanillaUri. */
export function parseVanillaUri(uri: vscode.Uri): { version: string; filePath: string } | undefined {
  if (uri.scheme !== VANILLA_SCHEME) return undefined;
  const m = /^\/([^/]+)\/(.+)$/.exec(uri.path);
  return m ? { version: m[1], filePath: m[2] } : undefined;
}

export function registerVanillaDocs(core: Core): void {
  const emitter = new vscode.EventEmitter<vscode.Uri>();
  const provider: vscode.TextDocumentContentProvider = {
    onDidChange: emitter.event,
    async provideTextDocumentContent(uri) {
      const parsed = parseVanillaUri(uri);
      if (!parsed) return '';
      const { version, filePath } = parsed;
      const ref = filePath.startsWith('data/') ? `${version}-data` : `${version}-assets-json`;
      const bytes = await core.vanilla.fetchFile(ref, filePath);
      if (!bytes) {
        return `// ${vscode.l10n.t('Vanilla file {0} ({1}) is not available. Check your connection or the "vscodecraft.data.allowDownload" setting.', filePath, version)}\n`;
      }
      return new TextDecoder().decode(bytes);
    },
  };
  core.track(emitter, vscode.workspace.registerTextDocumentContentProvider(VANILLA_SCHEME, provider));
}
