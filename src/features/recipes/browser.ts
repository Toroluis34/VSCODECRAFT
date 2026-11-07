// Recipe Browser: searchable list of every workspace + vanilla recipe.
import * as vscode from 'vscode';
import type { Core } from '../../core/core';
import type { WebviewHost } from '../../core/webviews';
import { humanize, parseRL } from '../../core/resourceLocation';
import { readJson } from '../../core/fsUtils';
import { ingredientIds, parseRecipe, recipeFormatFor } from './recipeModel';
import { copyToMod, EDITOR_VIEW_TYPE } from './session';
import type { BrowserData, BrowserEntry, RecipeViewState } from './protocol';

export class RecipeBrowser implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private host: WebviewHost | undefined;
  private jsonByKey = new Map<string, unknown>();
  private context: vscode.Uri | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private refreshTimer: NodeJS.Timeout | undefined;

  constructor(private readonly core: Core) {
    this.disposables.push(
      core.index.onDidChange(() => this.scheduleRefresh()),
      core.index.onDidChangeContent((uri) => {
        if (uri.path.includes('/recipe')) this.scheduleRefresh();
      }),
    );
  }

  private scheduleRefresh(): void {
    if (!this.host) return;
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => void this.host?.post('browser.refresh'), 800);
  }

  open(query?: string): void {
    this.context = vscode.window.activeTextEditor?.document.uri ?? this.core.projects.resourceRoot();
    if (this.panel) {
      this.panel.reveal();
      if (query) void this.host?.post('browser.query', query);
      return;
    }
    const { panel, host } = this.core.webviews.createPanel({
      viewType: 'vscodecraft.recipeBrowser',
      title: vscode.l10n.t('Recipe Browser'),
      bundle: 'recipeBrowser',
      documentUri: this.context,
      state: { query: query ?? '' },
      handlers: {
        'browser.data': () => this.data(),
        'browser.get': (p: { key: string }) => this.jsonByKey.get(p.key) ?? null,
        'browser.open': (p: { key: string; entry: BrowserEntry }) => this.openEntry(p.entry),
        'browser.openText': async (p: { entry: BrowserEntry }) => {
          if (p.entry.uri) await vscode.window.showTextDocument(vscode.Uri.parse(p.entry.uri), { viewColumn: vscode.ViewColumn.Active });
        },
        'browser.copy': (p: { entry: BrowserEntry }) => copyToMod(this.core, p.entry.id, this.jsonByKey.get(p.entry.key), this.context),
      },
    });
    this.panel = panel;
    this.host = host;
    panel.onDidDispose(() => {
      this.panel = undefined;
      this.host = undefined;
    });
  }

  private async openEntry(e: BrowserEntry): Promise<void> {
    if (e.source === 'workspace' && e.uri) {
      await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.parse(e.uri), EDITOR_VIEW_TYPE, vscode.ViewColumn.Active);
    } else {
      showVanillaRecipe(this.core, e.id, this.jsonByKey.get(e.key), this.context);
    }
  }

  async data(): Promise<BrowserData> {
    const core = this.core;
    const uri = this.context;
    const version = core.version(uri);
    await core.index.ready;
    const entries: BrowserEntry[] = [];
    this.jsonByKey.clear();
    const add = (id: string, source: BrowserEntry['source'], json: unknown, fileUri?: vscode.Uri) => {
      if (!json || typeof json !== 'object') return;
      const m = parseRecipe(json);
      const key = `${source}|${id}`;
      this.jsonByKey.set(key, json);
      entries.push({
        key,
        id,
        source,
        uri: fileUri?.toString(),
        type: m.type,
        result: m.results[0]?.id,
        count: m.results[0]?.count ?? 1,
        ingredients: ingredientIds(m),
        group: m.group,
      });
    };
    const files = core.index.all('recipe').filter((r) => r.ext === 'json' && r.side === 'data');
    const jsons = await Promise.all(files.map((f) => readJson(f.uri).catch(() => undefined)));
    files.forEach((f, i) => add(f.id, 'workspace', jsons[i], f.uri));
    let vanilla: Record<string, any> = {};
    try {
      vanilla = (await core.vanilla.recipes(version)) ?? {};
    } catch (e) {
      core.log.warn(`vanilla recipes ${version}: ${e}`);
    }
    for (const [id, json] of Object.entries(vanilla)) add(id.includes(':') ? id : `minecraft:${id}`, 'vanilla', json);

    const tags: Record<string, string[]> = {};
    const allIds = new Set<string>();
    for (const e of entries) {
      if (e.result) allIds.add(e.result);
      for (const i of e.ingredients) {
        if (i.startsWith('#')) tags[i] ??= [];
        else allIds.add(i);
      }
    }
    await Promise.all(
      Object.keys(tags).map(async (t) => {
        tags[t] = await core.registries.expandTag(t, 'item', uri).catch(() => []);
        tags[t].forEach((x) => allIds.add(x));
      }),
    );
    const nameMap = await core.registries.names(uri);
    const names: Record<string, string> = {};
    for (const id of allIds) names[id] = nameMap.get(id) ?? humanize(parseRL(id).path);
    return {
      version,
      entries,
      tags,
      names,
      vanillaAvailable: Object.keys(vanilla).length > 0,
      defaultNamespace: core.projects.defaultNamespace(uri),
    };
  }

  dispose(): void {
    this.panel?.dispose();
    this.disposables.forEach((d) => d.dispose());
  }
}

/** Read-only preview panel for a vanilla recipe, with "Copy to my mod". */
export function showVanillaRecipe(core: Core, id: string, json: unknown, context?: vscode.Uri): void {
  const version = core.version(context);
  const state: RecipeViewState = {
    mode: 'vanilla',
    id,
    version,
    fmt: recipeFormatFor(version),
    json,
    readOnly: true,
    defaultNamespace: core.projects.defaultNamespace(context),
  };
  core.webviews.createPanel({
    viewType: 'vscodecraft.recipeVanilla',
    title: vscode.l10n.t('Recipe: {0}', id),
    bundle: 'recipe',
    documentUri: context,
    state,
    column: vscode.ViewColumn.Beside,
    handlers: {
      'recipe.copyToMod': () => copyToMod(core, id, json, context),
      'recipe.checkIds': () => ({ unknownItems: [], unknownTags: [] }),
      'recipe.tagsOf': () => [],
    },
  });
}
