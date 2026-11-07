// Feature "recipes": visual recipe editor (CustomTextEditor), live side preview, recipe browser,
// "New Recipe…" wizard, workspace migration between versions and CodeLens on recipe files.
import * as vscode from 'vscode';
import type { Core } from '../../core/core';
import type { WebviewHost } from '../../core/webviews';
import { RecipeBrowser } from './browser';
import { migrateAllCommand, newRecipeCommand } from './commands';
import {
  documentState,
  EDITOR_VIEW_TYPE,
  isRecipeUri,
  migrateDocument,
  pushOnChange,
  recipeIdOf,
  registerDocumentHandlers,
} from './session';

export function activate(core: Core): void {
  core.track(
    vscode.window.registerCustomEditorProvider(EDITOR_VIEW_TYPE, new RecipeEditorProvider(core), {
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: true,
    }),
  );

  const preview = new RecipePreview(core);
  const browser = new RecipeBrowser(core);
  core.track(preview, browser);

  const targetUri = (uri?: unknown): vscode.Uri | undefined => {
    if (uri instanceof vscode.Uri) return uri;
    const active = vscode.window.activeTextEditor?.document.uri;
    if (active) return active;
    const tab = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    if (tab instanceof vscode.TabInputCustom || tab instanceof vscode.TabInputText) return tab.uri;
    return undefined;
  };

  core.registerCommand('vscodecraft.recipes.openPreview', async (uri?: vscode.Uri) => {
    const target = targetUri(uri);
    if (!target || !isRecipeUri(target)) {
      void vscode.window.showWarningMessage(vscode.l10n.t('Open a recipe JSON file (data/<namespace>/recipe/…) first.'));
      return;
    }
    await preview.show(target);
  });
  core.registerCommand('vscodecraft.recipes.openEditor', async (uri?: vscode.Uri) => {
    const target = targetUri(uri);
    if (!target) return;
    await vscode.commands.executeCommand('vscode.openWith', target, EDITOR_VIEW_TYPE);
  });
  core.registerCommand('vscodecraft.recipes.openSource', async (uri?: vscode.Uri) => {
    const target = targetUri(uri);
    if (!target) return;
    await vscode.commands.executeCommand('vscode.openWith', target, 'default');
  });
  core.registerCommand('vscodecraft.recipes.new', (uri?: vscode.Uri) => newRecipeCommand(core, uri instanceof vscode.Uri ? uri : undefined));
  core.registerCommand('vscodecraft.recipes.migrate', () => migrateAllCommand(core));
  core.registerCommand('vscodecraft.recipes.migrateFile', async (uri?: vscode.Uri) => {
    const target = targetUri(uri);
    if (!target) return;
    await migrateDocument(core, await vscode.workspace.openTextDocument(target));
  });
  core.registerCommand('vscodecraft.recipes.browser', (query?: unknown) => browser.open(typeof query === 'string' ? query : undefined));

  core.track(
    vscode.languages.registerCodeLensProvider(
      [
        { language: 'json', scheme: 'file' },
        { language: 'jsonc', scheme: 'file' },
      ],
      new RecipeCodeLens(),
    ),
  );
}

class RecipeEditorProvider implements vscode.CustomTextEditorProvider {
  constructor(private readonly core: Core) {}

  resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): void {
    const core = this.core;
    const host = core.webviews.attach(panel.webview, {
      bundle: 'recipe',
      documentUri: document.uri,
      state: documentState(core, document, 'editor'),
      title: recipeIdOf(document.uri),
    });
    registerDocumentHandlers(core, host, () => document);
    const sub = pushOnChange(core, host, () => document, 'editor');
    panel.onDidDispose(() => {
      sub.dispose();
      host.dispose();
    });
  }
}

/** Side preview that follows the active recipe editor and updates while typing. */
class RecipePreview implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private host: WebviewHost | undefined;
  private doc: vscode.TextDocument | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private changeSub: vscode.Disposable | undefined;

  constructor(private readonly core: Core) {
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((e) => {
        if (this.panel && e && isRecipeUri(e.document.uri) && e.document !== this.doc) this.bind(e.document);
      }),
      vscode.workspace.onDidCloseTextDocument((d) => {
        if (d === this.doc) this.doc = undefined;
      }),
    );
  }

  async show(uri: vscode.Uri): Promise<void> {
    const doc = await vscode.workspace.openTextDocument(uri);
    if (!this.panel) {
      const { panel, host } = this.core.webviews.createPanel({
        viewType: 'vscodecraft.recipePreview',
        title: this.title(doc),
        bundle: 'recipe',
        documentUri: doc.uri,
        state: documentState(this.core, doc, 'preview'),
        column: { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      });
      this.panel = panel;
      this.host = host;
      registerDocumentHandlers(this.core, host, () => this.doc);
      panel.onDidDispose(() => {
        this.changeSub?.dispose();
        this.panel = undefined;
        this.host = undefined;
        this.doc = undefined;
      });
      this.doc = doc;
      this.changeSub = pushOnChange(this.core, host, () => this.doc, 'preview');
    } else {
      this.panel.reveal(vscode.ViewColumn.Beside, true);
      this.bind(doc);
    }
  }

  private title(doc: vscode.TextDocument): string {
    return vscode.l10n.t('Preview {0}', doc.uri.path.split('/').pop() ?? '');
  }

  private bind(doc: vscode.TextDocument): void {
    if (!this.panel || !this.host) return;
    this.doc = doc;
    this.host.documentUri = doc.uri;
    this.panel.title = this.title(doc);
    void this.host.post('recipe.update', documentState(this.core, doc, 'preview'));
  }

  dispose(): void {
    this.changeSub?.dispose();
    this.panel?.dispose();
    this.disposables.forEach((d) => d.dispose());
  }
}

class RecipeCodeLens implements vscode.CodeLensProvider {
  provideCodeLenses(doc: vscode.TextDocument): vscode.CodeLens[] {
    if (!isRecipeUri(doc.uri)) return [];
    const text = doc.getText();
    const i = text.indexOf('{');
    if (i < 0) return [];
    const pos = doc.positionAt(i);
    const range = new vscode.Range(pos, pos);
    return [
      new vscode.CodeLens(range, { title: `$(eye) ${vscode.l10n.t('Preview recipe')}`, command: 'vscodecraft.recipes.openPreview', arguments: [doc.uri] }),
      new vscode.CodeLens(range, { title: `$(edit) ${vscode.l10n.t('Open visual editor')}`, command: 'vscodecraft.recipes.openEditor', arguments: [doc.uri] }),
    ];
  }
}
