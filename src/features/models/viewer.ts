// Model Viewer: webview panel + CustomTextEditor for models/**, blockstates/* and items/* json files.
import * as vscode from 'vscode';
import * as jsonc from 'jsonc-parser';
import type { Core } from '../../core/core';
import type { WebviewHost } from '../../core/webviews';
import { humanize, normalizeId, parseRL } from '../../core/resourceLocation';
import { blockstateProperties, defaultState, itemDefinitionBranches, selectModels } from './modelMath';
import { ModelResolver, ResolvedModel } from './resolver';
import type { ViewerElement, ViewerModel, ViewerSelection } from './viewTypes';

export const VIEWER_VIEW_TYPE = 'vscodecraft.models.viewer';
const VIEWER_KINDS = new Set(['models', 'blockstates', 'items']);

export function isViewerFile(core: Core, uri: vscode.Uri | undefined): boolean {
  if (!uri || !uri.path.endsWith('.json')) return false;
  const info = core.index.info(uri);
  return !!info && info.side === 'assets' && VIEWER_KINDS.has(info.kind);
}

export class ModelViewer implements vscode.CustomTextEditorProvider {
  private readonly panels = new Map<string, vscode.WebviewPanel>();
  readonly resolver: ModelResolver;

  constructor(private readonly core: Core) {
    this.resolver = new ModelResolver(core);
  }

  register(): void {
    const core = this.core;
    core.track(
      vscode.window.registerCustomEditorProvider(VIEWER_VIEW_TYPE, this, {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: true,
      }),
    );
    core.registerCommand('vscodecraft.models.openViewer', async (arg?: vscode.Uri) => {
      let uri = arg instanceof vscode.Uri ? arg : vscode.window.activeTextEditor?.document.uri;
      if (!isViewerFile(core, uri)) uri = await this.pickFile();
      if (uri) await this.openPanel(uri);
    });
  }

  private async pickFile(): Promise<vscode.Uri | undefined> {
    const items: (vscode.QuickPickItem & { uri: vscode.Uri })[] = [];
    for (const kind of ['models', 'blockstates', 'items'])
      for (const r of this.core.index.all(kind)) {
        if (r.ext !== 'json') continue;
        items.push({ label: r.id, description: kind, detail: vscode.workspace.asRelativePath(r.uri), uri: r.uri });
      }
    if (!items.length) {
      void vscode.window.showInformationMessage(vscode.l10n.t('No models, blockstates or item definitions found in the workspace.'));
      return undefined;
    }
    items.sort((a, b) => a.label.localeCompare(b.label));
    const pick = await vscode.window.showQuickPick(items, { placeHolder: vscode.l10n.t('Select a model, blockstate or item definition'), matchOnDetail: true });
    return pick?.uri;
  }

  async openPanel(uri: vscode.Uri): Promise<void> {
    const existing = this.panels.get(uri.toString());
    if (existing) {
      existing.reveal(undefined, true);
      return;
    }
    const document = await vscode.workspace.openTextDocument(uri);
    const info = this.core.index.info(uri);
    const title = vscode.l10n.t('Model: {0}', humanize(info?.path ?? uri.path.split('/').pop()!.replace(/\.json$/, '')));
    const { panel, host } = this.core.webviews.createPanel({
      viewType: 'vscodecraft.models.viewerPanel',
      title,
      bundle: 'modelViewer',
      state: { uri: uri.toString() },
      documentUri: uri,
      column: { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      icon: undefined,
    });
    this.panels.set(uri.toString(), panel);
    const sub = this.connect(document, host);
    panel.onDidDispose(() => {
      this.panels.delete(uri.toString());
      sub.dispose();
    });
  }

  resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): void {
    const host = this.core.webviews.attach(panel.webview, {
      bundle: 'modelViewer',
      state: { uri: document.uri.toString(), customEditor: true },
      documentUri: document.uri,
      title: 'Model Viewer',
    });
    const sub = this.connect(document, host);
    panel.onDidDispose(() => {
      sub.dispose();
      host.dispose();
    });
  }

  /** Wire RPC handlers + live updates for one document. */
  private connect(document: vscode.TextDocument, host: WebviewHost): vscode.Disposable {
    const core = this.core;
    host.handle('viewer.load', async (sel: ViewerSelection) => {
      const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === document.uri.toString()) ?? document;
      return this.build(doc, host.webview, sel ?? {});
    });
    host.handle('viewer.openText', async (p: { line?: number }) => {
      const doc = await vscode.workspace.openTextDocument(document.uri);
      const pos = new vscode.Position(p?.line ?? 0, 0);
      await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, selection: new vscode.Range(pos, pos) });
    });
    host.handle('viewer.openModel', async (p: { id: string }) => {
      const uri = core.index.find('models', normalizeId(p.id));
      if (uri) await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri), { viewColumn: vscode.ViewColumn.One });
      else void vscode.window.showInformationMessage(vscode.l10n.t('{0} is a vanilla model (not in the workspace).', p.id));
    });
    let timer: NodeJS.Timeout | undefined;
    const changed = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void host.post('viewer.changed'), 200);
    };
    const subs = [
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document.uri.toString() === document.uri.toString()) changed();
      }),
      core.index.onDidChangeContent(changed),
      core.index.onDidChange(changed),
      core.vanilla.onDidDownload(changed),
    ];
    return new vscode.Disposable(() => {
      clearTimeout(timer);
      subs.forEach((s) => s.dispose());
    });
  }

  /** Build everything the viewer webview shows for a document + selection. */
  async build(doc: vscode.TextDocument, webview: vscode.Webview, sel: ViewerSelection): Promise<ViewerModel> {
    const core = this.core;
    const uri = doc.uri;
    const version = core.version(uri);
    const info = core.index.info(uri);
    const kind: ViewerModel['kind'] = info?.kind === 'blockstates' ? 'blockstate' : info?.kind === 'items' ? 'item' : 'model';
    const id = info?.id ?? 'unknown:model';
    const text = doc.getText();
    const errs: jsonc.ParseError[] = [];
    const json = jsonc.parse(text, errs, { allowTrailingComma: true, disallowComments: false });
    const out: ViewerModel = {
      kind,
      uri: uri.toString(),
      id,
      version,
      elements: [],
      elementInfo: [],
      generated: [],
      display: {},
      textures: [],
      chain: [],
      notes: [],
      errors: [],
      models: [],
    };
    if (errs.length) out.errors.push(vscode.l10n.t('{0} JSON syntax error(s) — showing what could be parsed.', errs.length));
    if (!json || typeof json !== 'object') {
      out.errors.push(vscode.l10n.t('The file is not a JSON object.'));
      return out;
    }

    const add = (r: ResolvedModel, label: string, x = 0, y = 0, uvlock = false, lines?: (number | undefined)[]) => {
      const offset = out.elements.length;
      r.elements.forEach((el, i) => {
        const raw = r.rawElements[i] ?? {};
        const ei: ViewerElement = {
          index: offset + i,
          model: r.elementsFrom ?? r.id,
          name: typeof raw.name === 'string' ? raw.name : undefined,
          from: raw.from,
          to: raw.to,
          rotation: raw.rotation ? describeRotation(raw.rotation) : undefined,
          faces: Object.keys(el.faces).length,
          line: lines?.[i],
        };
        out.elementInfo.push(ei);
      });
      out.elements.push(...r.elements);
      out.generated.push(...r.generated);
      for (const t of r.textures) {
        const same = out.textures.find((o) => o.name === t.name && o.raw === t.raw && o.id === t.id);
        if (same) same.uses += t.uses;
        else out.textures.push({ ...t });
      }
      for (const n of r.notes) if (!out.notes.includes(n)) out.notes.push(n);
      if (!Object.keys(out.display).length) out.display = r.display;
      if (!out.chain.length) out.chain = r.chain;
      out.tint ??= r.tint;
      out.models.push({ model: r.id, label, x, y, uvlock });
    };

    try {
      if (kind === 'model') {
        const r = await this.resolver.resolve(id, version, webview, { root: json });
        const lines = r.elementsFrom === normalizeId(id) ? elementLines(doc, text) : undefined;
        add(r, id, 0, 0, false, lines);
      } else if (kind === 'blockstate') {
        const rl = parseRL(id);
        let known: [Record<string, string[]>, Record<string, string>] | undefined;
        if (rl.namespace === 'minecraft') {
          const blocks = await core.vanilla.blocks(version).catch(() => ({}) as Record<string, any>);
          known = blocks[rl.path] ?? blocks[id];
        }
        const props = blockstateProperties(json, known?.[0]);
        const state = { ...defaultState(json, props, known?.[1]) };
        for (const [k, val] of Object.entries(sel.state ?? {})) if (props.some((p) => p.name === k)) state[k] = val;
        out.properties = props;
        out.state = state;
        const applied = selectModels(json, state, sel.alt ?? 0);
        out.alternatives = Math.max(1, ...applied.map((a) => a.alternatives));
        if (!applied.length) out.notes.push(vscode.l10n.t('No variant / multipart case matches this state.'));
        for (const a of applied) {
          const r = await this.resolver.resolve(a.model, version, webview, { x: a.x, y: a.y, uvlock: a.uvlock });
          add(r, a.label, a.x, a.y, a.uvlock);
        }
      } else {
        const branches = itemDefinitionBranches(json);
        out.branches = branches.map((b) => ({ id: b.id, label: b.label }));
        const b = branches.find((x) => x.id === sel.branch) ?? branches[0];
        out.branch = b?.id;
        if (!b) out.notes.push(vscode.l10n.t('The item definition has no "model".'));
        if (b?.special) out.notes.push(vscode.l10n.t('Special model "{0}" is rendered by code; showing its base model.', b.special));
        if (b?.note === 'empty') out.notes.push(vscode.l10n.t('This branch renders nothing (minecraft:empty).'));
        for (const m of b?.models ?? []) {
          const r = await this.resolver.resolve(m.model, version, webview, { tints: m.tints });
          add(r, b.label);
        }
      }
    } catch (e) {
      out.errors.push(e instanceof Error ? e.message : String(e));
    }
    return out;
  }
}

/** Line of each element of a model document's "elements" array. */
function elementLines(doc: vscode.TextDocument, text: string): (number | undefined)[] {
  const tree = jsonc.parseTree(text);
  const arr = tree ? jsonc.findNodeAtLocation(tree, ['elements']) : undefined;
  return (arr?.children ?? []).map((n) => doc.positionAt(n.offset).line);
}

function describeRotation(r: any): string {
  if (typeof r?.axis === 'string') return `${r.axis} ${r.angle}°`;
  return ['x', 'y', 'z']
    .filter((a) => r?.[a])
    .map((a) => `${a} ${r[a]}°`)
    .join(' ');
}
