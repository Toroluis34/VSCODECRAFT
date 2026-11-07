import * as vscode from 'vscode';
import type { Core } from '../../core/core';
import { addMissingTranslations, copyMissingToLocale, findUnusedKeys } from './commands';
import { StringColorProvider } from './colors';
import { registerDecorations } from './decorations';
import { TranslationLookup } from './host';
import { JSON_SELECTOR, TranslationHoverProvider } from './hover';
import { LANG_EDITOR_VIEW_TYPE, LangCustomEditorProvider, openLangEditor } from './langEditor';
import { registerTextEditor } from './textEditor';

/**
 * Feature "translations":
 *  - Lang Editor (keys × locales spreadsheet) as a panel and as a custom editor option for lang files
 *  - Add Missing Translations / Copy Missing Keys to Locale / Find Unused Translation Keys
 *  - Text Component Editor + MOTD preview
 *  - Hover previews of § strings and text components, string colour picker, § code decorations
 */
export function activate(core: Core): void {
  const lookup = new TranslationLookup(core);
  core.track(lookup);

  core.registerCommand('vscodecraft.translations.openLangEditor', (uri?: vscode.Uri) => openLangEditor(core, uri));
  core.registerCommand('vscodecraft.translations.addMissing', () => addMissingTranslations(core));
  core.registerCommand('vscodecraft.translations.copyMissingToLocale', (uri?: vscode.Uri) => copyMissingToLocale(core, uri));
  core.registerCommand('vscodecraft.translations.findUnused', (uri?: vscode.Uri) => findUnusedKeys(core, uri));
  registerTextEditor(core, lookup);

  core.track(
    vscode.window.registerCustomEditorProvider(LANG_EDITOR_VIEW_TYPE, new LangCustomEditorProvider(core), {
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: false,
    }),
    vscode.languages.registerHoverProvider(JSON_SELECTOR, new TranslationHoverProvider(core, lookup)),
    vscode.languages.registerColorProvider(JSON_SELECTOR, new StringColorProvider()),
  );
  registerDecorations(core);
}
