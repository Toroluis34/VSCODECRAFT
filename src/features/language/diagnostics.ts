import * as vscode from 'vscode';
import * as jsonc from 'jsonc-parser';
import type { Core } from '../../core/core';
import { readText } from '../../core/fsUtils';
import { getFeatures, LEGACY_FOLDER_RENAMES } from '../../core/versions';
import { fileKindOf, parseRef } from './context';
import { analyzeText, contentRange, lineIndex, type Analysis, type DocumentAnalyzer } from './analysis';
import type { RefResolver } from './resolver';
import { findIngredients } from './ingredients';
import { registryLabel } from './labels';

export const DIAG_SOURCE = 'VSCodeCraft';
export const DiagCode = {
  unknown: 'unknown-ref',
  missingFile: 'missing-file',
  invalid: 'invalid-id',
  legacyFolder: 'legacy-folder',
  ingredient: 'ingredient-format',
  resultItem: 'result-item',
} as const;

/** Asset kinds whose model/texture references must exist (missing ones are errors, the game shows purple-black). */
const ASSET_REF_KINDS = new Set(['models', 'blockstates', 'items', 'equipment', 'atlases', 'particles']);
/** Kinds never validated (not JSON resources we understand). */
const SKIP_KINDS = new Set(['lang', 'textures', 'shaders', 'texts', 'font', 'structure', 'function']);

const VALIDATED_SCHEMES = new Set(['file', 'vscode-remote']);

export class LanguageDiagnostics implements vscode.Disposable {
  readonly collection = vscode.languages.createDiagnosticCollection('vscodecraft');
  private timers = new Map<string, NodeJS.Timeout>();
  private generation = 0;
  private workspaceTimer: NodeJS.Timeout | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly core: Core,
    private readonly analyzer: DocumentAnalyzer,
    private readonly resolver: RefResolver,
  ) {
    this.disposables.push(
      this.collection,
      vscode.workspace.onDidOpenTextDocument((d) => this.schedule(d, 0)),
      vscode.workspace.onDidChangeTextDocument((e) => this.schedule(e.document, 500)),
      vscode.workspace.onDidSaveTextDocument((d) => this.schedule(d, 0)),
      vscode.workspace.onDidCloseTextDocument((d) => {
        if (!this.validateWorkspaceEnabled()) this.collection.delete(d.uri);
      }),
      resolver.onDidChange((full) => this.refreshAll(full)),
      core.index.onDidChange(() => this.pruneDeleted()),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('vscodecraft.language') || e.affectsConfiguration('vscodecraft.minecraftVersion')) this.refreshAll();
      }),
    );
    for (const d of vscode.workspace.textDocuments) this.schedule(d, 0);
    void core.index.ready.then(() => this.scheduleWorkspace(1500));
  }

  private enabled(uri?: vscode.Uri): boolean {
    return vscode.workspace.getConfiguration('vscodecraft.language', uri).get<boolean>('diagnostics', true);
  }

  private validateWorkspaceEnabled(): boolean {
    return this.enabled() && vscode.workspace.getConfiguration('vscodecraft.language').get<boolean>('validateWorkspace', true);
  }

  /** Re-validate open documents now and the whole workspace soon. */
  refreshAll(includeWorkspace = true): void {
    if (!this.enabled()) {
      this.collection.clear();
      return;
    }
    for (const d of vscode.workspace.textDocuments) this.schedule(d, 0);
    if (includeWorkspace) this.scheduleWorkspace(3000);
  }

  private schedule(doc: vscode.TextDocument, delay: number): void {
    if (!VALIDATED_SCHEMES.has(doc.uri.scheme)) return;
    const key = doc.uri.toString();
    clearTimeout(this.timers.get(key));
    this.timers.set(
      key,
      setTimeout(() => {
        this.timers.delete(key);
        void this.validateDocument(doc);
      }, delay),
    );
  }

  async validateDocument(doc: vscode.TextDocument): Promise<void> {
    if (doc.isClosed && !this.validateWorkspaceEnabled()) return;
    if (!this.enabled(doc.uri)) {
      this.collection.delete(doc.uri);
      return;
    }
    const a = this.analyzer.get(doc);
    if (!a || (a.info && SKIP_KINDS.has(a.info.kind))) return;
    const version = doc.version;
    const diags = await this.compute(a, doc.uri, (o) => doc.positionAt(o));
    if (doc.version !== version) return; // stale
    this.collection.set(doc.uri, diags);
  }

  private scheduleWorkspace(delay: number): void {
    clearTimeout(this.workspaceTimer);
    if (!this.validateWorkspaceEnabled()) return;
    this.workspaceTimer = setTimeout(() => void this.validateWorkspace(), delay);
  }

  /** Validate every JSON resource in the workspace (open documents are validated from their live text). */
  async validateWorkspace(): Promise<number> {
    const gen = ++this.generation;
    await this.core.index.ready;
    const open = new Set(vscode.workspace.textDocuments.map((d) => d.uri.toString()));
    const files = this.core.index
      .kinds()
      .filter((k) => !SKIP_KINDS.has(k))
      .flatMap((k) => this.core.index.all(k))
      .filter((r) => r.ext === 'json' && VALIDATED_SCHEMES.has(r.uri.scheme));
    let count = 0;
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: vscode.l10n.t('Validating Minecraft resources') },
      async (progress) => {
        for (const res of files) {
          if (gen !== this.generation) return;
          if (++count % 25 === 0) {
            progress.report({ message: `${count}/${files.length}` });
            await new Promise((r) => setImmediate(r));
          }
          if (open.has(res.uri.toString())) continue;
          try {
            const text = await readText(res.uri);
            if (text === undefined) continue;
            const a = analyzeText(text, { kind: res.kind, path: res.path }, res);
            const diags = await this.compute(a, res.uri, lineIndex(text));
            if (gen !== this.generation) return;
            this.collection.set(res.uri, diags);
          } catch (e) {
            this.core.log.warn(`validate ${res.uri.fsPath}: ${e}`);
          }
        }
      },
    );
    return count;
  }

  private pruneDeleted(): void {
    const gone: vscode.Uri[] = [];
    this.collection.forEach((uri) => {
      const info = this.core.index.info(uri);
      if (!info || !this.core.index.get(info.kind, info.id).some((r) => r.uri.toString() === uri.toString())) {
        if (!vscode.workspace.textDocuments.some((d) => d.uri.toString() === uri.toString())) gone.push(uri);
      }
    });
    for (const u of gone) this.collection.delete(u);
  }

  /** All diagnostics of an analysed file. */
  async compute(a: Analysis, uri: vscode.Uri, toPos: (offset: number) => vscode.Position): Promise<vscode.Diagnostic[]> {
    const out: vscode.Diagnostic[] = [];
    const features = getFeatures(this.core.version(uri));
    const mk = (range: vscode.Range, message: string, severity: vscode.DiagnosticSeverity, code: string) => {
      const d = new vscode.Diagnostic(range, message, severity);
      d.source = DIAG_SOURCE;
      d.code = code;
      out.push(d);
      return d;
    };

    // Legacy (pre-1.21) folder names
    if (a.info?.legacyFolder && features.singularFolders) {
      const modern = LEGACY_FOLDER_RENAMES[a.info.folder] ?? a.info.kind;
      const end = a.tree ? toPos(Math.min(a.tree.offset + 1, a.tree.offset + a.tree.length)) : toPos(0);
      mk(
        new vscode.Range(toPos(a.tree?.offset ?? 0), end),
        vscode.l10n.t("Folder '{0}' uses the pre-1.21 name; Minecraft {1} only loads '{2}'.", a.info.folder, features.version, modern),
        vscode.DiagnosticSeverity.Warning,
        DiagCode.legacyFolder,
      );
    }

    // Resource references
    for (const r of a.refs) {
      const range = contentRange(toPos, r.node);
      const ref = parseRef(r.value, r.ctx);
      if (!ref) {
        const v = r.value.trim();
        if (v && !(r.ctx.textureVar && v.startsWith('#')) && !r.ctx.key) {
          mk(range, vscode.l10n.t("'{0}' is not a valid resource location.", r.value), vscode.DiagnosticSeverity.Warning, DiagCode.invalid);
        }
        continue;
      }
      const status = await this.resolver.check(r.ctx, ref, uri);
      if (status !== 'unknown') continue;
      const label = registryLabel(r.ctx.registry);
      const fk = fileKindOf(r.ctx.registry, ref.isTag);
      const assetRef = (r.ctx.registry === 'model' || r.ctx.registry === 'texture') && !!a.info && ASSET_REF_KINDS.has(a.info.kind);
      let message: string;
      if (ref.isTag) message = vscode.l10n.t("Unknown {0} tag '#{1}'.", label, ref.id);
      else if (fk) message = vscode.l10n.t("Missing {0} '{1}' (no such file).", label, ref.id);
      else message = vscode.l10n.t("Unknown {0} '{1}'.", label, ref.id);
      const best = (await this.resolver.suggestions(r.ctx, ref, uri, 1))[0];
      if (best) message += ' ' + vscode.l10n.t("Did you mean '{0}'?", `${ref.isTag && !r.ctx.tagOnly ? '#' : ''}${best}`);
      mk(
        range,
        message,
        assetRef ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning,
        fk && !ref.isTag ? DiagCode.missingFile : DiagCode.unknown,
      );
    }

    // Recipe format for the target version
    if (a.info?.kind === 'recipe' && a.tree) {
      for (const ing of findIngredients(a.tree)) {
        if (ing.format === features.ingredientFormat) continue;
        const range = new vscode.Range(toPos(ing.node.offset), toPos(ing.node.offset + ing.node.length));
        const msg =
          features.ingredientFormat === 'string'
            ? vscode.l10n.t('Ingredient uses the old object format; Minecraft {0} expects plain ids ("minecraft:stick", "#minecraft:planks" or a list of ids).', features.version)
            : vscode.l10n.t('Ingredient uses the 1.21.2+ string format; Minecraft {0} expects objects ({"item": "..."} or {"tag": "..."}).', features.version);
        mk(range, msg, vscode.DiagnosticSeverity.Information, DiagCode.ingredient);
      }
      const itemNode = jsonc.findNodeAtLocation(a.tree, ['result', 'item']);
      const result = (a.root as any)?.result;
      if (itemNode && features.resultUsesId && result && typeof result === 'object' && result.id === undefined) {
        const keyNode = itemNode.parent?.children?.[0];
        if (keyNode) {
          mk(
            new vscode.Range(toPos(keyNode.offset), toPos(keyNode.offset + keyNode.length)),
            vscode.l10n.t('Recipe results use "id" instead of "item" since 1.20.5.'),
            vscode.DiagnosticSeverity.Information,
            DiagCode.resultItem,
          );
        }
      }
    }
    return out;
  }

  dispose(): void {
    this.generation++;
    clearTimeout(this.workspaceTimer);
    for (const t of this.timers.values()) clearTimeout(t);
    this.disposables.forEach((d) => d.dispose());
  }
}
