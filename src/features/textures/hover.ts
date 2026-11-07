import * as vscode from 'vscode';
import type { Core } from '../../core/core';
import { classifyPath } from '../../core/resourceLocation';
import { forEachString, jsonc, nodeAt, parseTree } from '../../core/jsonUtils';
import { isModelTexturePath, isTextureIdCandidate, normalizeTextureId } from './textureRefs';
import type { TextureService } from './previews';

const JSON_SELECTOR: vscode.DocumentSelector = [
  { language: 'json' },
  { language: 'jsonc' },
];

function cfg<T>(key: string, def: T, uri?: vscode.Uri): T {
  return vscode.workspace.getConfiguration('vscodecraft.textures', uri).get<T>(key, def);
}

/** Only files inside a pack/mod (data/ or assets/) or pack-like json get texture hovers. */
function isMinecraftJson(doc: vscode.TextDocument): boolean {
  return /[\\/](assets|data)[\\/]/.test(doc.uri.fsPath) || doc.uri.scheme === 'untitled';
}

/**
 * Hover with an image preview for texture ids in JSON. Limited to strings that resolve to a texture
 * (workspace PNG or vanilla atlas sprite) so it combines with the generic id hover of the language feature.
 */
class TextureHoverProvider implements vscode.HoverProvider {
  constructor(
    private readonly core: Core,
    private readonly textures: TextureService,
  ) {}

  async provideHover(doc: vscode.TextDocument, pos: vscode.Position, token: vscode.CancellationToken): Promise<vscode.Hover | undefined> {
    if (!cfg('hoverPreview', true, doc.uri) || !isMinecraftJson(doc)) return undefined;
    const node = nodeAt(doc, pos);
    if (!node || node.type !== 'string' || typeof node.value !== 'string') return undefined;
    const value = node.value as string;
    if (!isTextureIdCandidate(value)) return undefined;
    // Inside a model's "textures" object a plain name ("stone") also refers to block textures, but those
    // always contain a folder in practice; we only accept "folder/name" ids.
    const id = normalizeTextureId(value);
    if (!(await this.textures.exists(id, doc.uri)) || token.isCancellationRequested) return undefined;
    const preview = await this.textures.preview(id, doc.uri, 64);
    if (!preview || token.isCancellationRequested) return undefined;

    const md = new vscode.MarkdownString(undefined, true);
    md.supportHtml = true;
    md.isTrusted = { enabledCommands: ['vscodecraft.textures.openEditor', 'vscode.open'] };
    md.appendMarkdown(`![${id}](${preview.uri.toString()})\n\n`);
    const parts = [`**${id}**`, `${preview.width} × ${preview.height}`];
    if (preview.frames > 1) parts.push(vscode.l10n.t('{0} frames', preview.frames));
    parts.push(preview.source === 'vanilla' ? vscode.l10n.t('vanilla') : vscode.l10n.t('workspace'));
    md.appendMarkdown(parts.join(' · '));
    if (preview.fileUri) {
      const args = encodeURIComponent(JSON.stringify([preview.fileUri.toString()]));
      md.appendMarkdown(`\n\n[$(paintcan) ${vscode.l10n.t('Open in Texture Editor')}](command:vscodecraft.textures.openEditor?${args})`);
    }
    const start = doc.positionAt(node.offset);
    const end = doc.positionAt(node.offset + node.length);
    return new vscode.Hover(md, new vscode.Range(start, end));
  }
}

/** Small texture icons in the gutter next to texture references of model JSON files. */
class GutterIcons implements vscode.Disposable {
  private types = new Map<string, vscode.TextEditorDecorationType>();
  private applied = new Map<vscode.TextEditor, Set<string>>();
  private timer: NodeJS.Timeout | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly core: Core,
    private readonly textures: TextureService,
  ) {
    this.disposables.push(
      vscode.window.onDidChangeVisibleTextEditors(() => this.schedule()),
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (vscode.window.visibleTextEditors.some((ed) => ed.document === e.document)) this.schedule();
      }),
      vscode.workspace.onDidChangeConfiguration((e) => e.affectsConfiguration('vscodecraft.textures.gutterIcons') && this.schedule()),
      core.index.onDidChange(() => this.schedule()),
      core.index.onDidChangeContent((u) => u.path.endsWith('.png') && this.schedule()),
      core.vanilla.onDidDownload(() => this.schedule()),
    );
    this.schedule();
  }

  private schedule(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.updateAll(), 250);
  }

  private async updateAll(): Promise<void> {
    for (const ed of vscode.window.visibleTextEditors) await this.update(ed).catch((e) => this.core.log.warn(`texture gutter: ${e}`));
    for (const ed of [...this.applied.keys()]) if (!vscode.window.visibleTextEditors.includes(ed)) this.applied.delete(ed);
  }

  private async update(ed: vscode.TextEditor): Promise<void> {
    const doc = ed.document;
    const info = classifyPath(doc.uri.fsPath);
    const enabled = cfg('gutterIcons', true, doc.uri) && info?.side === 'assets' && (info.kind === 'models' || info.kind === 'atlases');
    const byType = new Map<string, vscode.Range[]>();
    if (enabled && doc.lineCount < 5000) {
      const tree = parseTree(doc);
      const refs: { id: string; node: jsonc.Node }[] = [];
      forEachString(tree, (value, node, path) => {
        if (info!.kind === 'models' ? isModelTexturePath(path) : path[path.length - 1] === 'resource' || path[path.length - 1] === 'source') {
          if (isTextureIdCandidate(value)) refs.push({ id: normalizeTextureId(value), node });
        }
      });
      const usedLines = new Set<number>();
      for (const r of refs) {
        const line = doc.positionAt(r.node.offset).line;
        if (usedLines.has(line)) continue;
        const preview = await this.textures.preview(r.id, doc.uri, 32);
        if (!preview) continue;
        usedLines.add(line);
        const key = preview.uri.toString();
        if (!this.types.has(key)) {
          this.types.set(key, vscode.window.createTextEditorDecorationType({ gutterIconPath: preview.uri, gutterIconSize: 'contain' }));
        }
        const list = byType.get(key) ?? [];
        list.push(new vscode.Range(line, 0, line, 0));
        byType.set(key, list);
      }
    }
    const prev = this.applied.get(ed) ?? new Set<string>();
    for (const key of prev) if (!byType.has(key)) ed.setDecorations(this.types.get(key)!, []);
    for (const [key, ranges] of byType) ed.setDecorations(this.types.get(key)!, ranges);
    this.applied.set(ed, new Set(byType.keys()));
    // Keep the number of decoration types bounded.
    if (this.types.size > 400) this.pruneUnused();
  }

  private pruneUnused(): void {
    const used = new Set([...this.applied.values()].flatMap((s) => [...s]));
    for (const [key, t] of this.types) {
      if (!used.has(key)) {
        t.dispose();
        this.types.delete(key);
      }
    }
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.types.forEach((t) => t.dispose());
    this.disposables.forEach((d) => d.dispose());
  }
}

export function registerTextureHovers(core: Core, textures: TextureService): void {
  core.track(vscode.languages.registerHoverProvider(JSON_SELECTOR, new TextureHoverProvider(core, textures)), new GutterIcons(core, textures));
}
