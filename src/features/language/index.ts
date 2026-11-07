import * as vscode from 'vscode';
import type { Core } from '../../core/core';
import { DocumentAnalyzer } from './analysis';
import { RefResolver } from './resolver';
import { registerVanillaDocs, VANILLA_SCHEME } from './vanillaDocs';
import { registerCompletion } from './completion';
import { registerHover } from './hover';
import { registerNavigation } from './navigation';
import { LanguageDiagnostics } from './diagnostics';
import { registerCodeActions } from './codeActions';
import { registerColors } from './colors';

export { vanillaUri, parseVanillaUri, VANILLA_SCHEME } from './vanillaDocs';

/** JSON files inside data/ and assets/, pack.mcmeta and read-only vanilla documents. */
export const LANGUAGE_SELECTOR: vscode.DocumentSelector = [
  { pattern: '**/{data,assets}/**/*.json' },
  { pattern: '**/pack.mcmeta' },
  { scheme: VANILLA_SCHEME },
];

/**
 * Feature "language": registry-aware IntelliSense for data/asset JSON (completion, hover, go to definition,
 * document links, diagnostics with quick fixes, numeric colour swatches) and the vscodecraft-vanilla:
 * read-only document scheme.
 */
export function activate(core: Core): void {
  registerVanillaDocs(core);
  const analyzer = new DocumentAnalyzer(core);
  const resolver = new RefResolver(core);
  const diagnostics = new LanguageDiagnostics(core, analyzer, resolver);
  core.track(resolver, diagnostics);

  registerCompletion(core, LANGUAGE_SELECTOR, analyzer, resolver);
  registerHover(core, LANGUAGE_SELECTOR, analyzer, resolver);
  registerNavigation(core, LANGUAGE_SELECTOR, analyzer, resolver);
  registerCodeActions(core, LANGUAGE_SELECTOR, analyzer, resolver);
  registerColors(core, LANGUAGE_SELECTOR, analyzer);

  core.registerCommand('vscodecraft.language.validateWorkspace', async () => {
    const n = await diagnostics.validateWorkspace();
    void vscode.window.showInformationMessage(vscode.l10n.t('Validated {0} resource files.', n));
  });
}
