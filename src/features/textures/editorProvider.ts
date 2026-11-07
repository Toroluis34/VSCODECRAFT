import * as vscode from 'vscode';
import type { Core } from '../../core/core';
import type { WebviewHost } from '../../core/webviews';
import { classifyPath } from '../../core/resourceLocation';
import { decodePng, encodePng } from './png';
import { createImage, extractPalette, fromWire, imagesEqual, rgbaToHex, RgbaImage, toWire, WireImage } from './pixels';
import type { NamedPalette, TextureEditParams, TextureEditorBoot, TextureEditorPayload, TextureSetEvent } from './protocol';
import type { TextureService } from './previews';

export const TEXTURE_EDITOR_VIEW_TYPE = 'vscodecraft.textureEditor';

interface DocState {
  image: RgbaImage;
  mcmeta: Record<string, unknown> | null;
}

const decoder = new TextDecoder();
const encoder = new TextEncoder();

function mcmetaUri(uri: vscode.Uri): vscode.Uri {
  return uri.with({ path: `${uri.path}.mcmeta` });
}

async function readState(uri: vscode.Uri): Promise<DocState> {
  let image: RgbaImage;
  try {
    image = decodePng(await vscode.workspace.fs.readFile(uri));
  } catch (e) {
    // New/empty files open as a blank 16x16 texture.
    const missing = e instanceof vscode.FileSystemError || (e as any)?.code === 'FileNotFound';
    let size = 0;
    try {
      size = (await vscode.workspace.fs.stat(uri)).size;
    } catch {
      /* missing */
    }
    if (!missing && size > 0) throw e;
    image = createImage(16, 16);
  }
  let mcmeta: Record<string, unknown> | null = null;
  try {
    const text = decoder.decode(await vscode.workspace.fs.readFile(mcmetaUri(uri)));
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object') mcmeta = parsed;
  } catch {
    /* no mcmeta */
  }
  return { image, mcmeta };
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** Document model of the texture editor: current image + mcmeta, with full-state undo/redo. */
export class TextureDocument implements vscode.CustomDocument {
  private state: DocState;
  private saved: DocState;
  private readonly changeEmitter = new vscode.EventEmitter<vscode.CustomDocumentEditEvent<TextureDocument>>();
  private readonly contentEmitter = new vscode.EventEmitter<TextureSetEvent>();
  private readonly disposeEmitter = new vscode.EventEmitter<void>();
  /** Fires for every user edit (VS Code tracks dirty state + undo stack from it). */
  readonly onDidChange = this.changeEmitter.event;
  /** Fires when the content changes for another reason than a webview edit (undo/redo/revert). */
  readonly onDidChangeContent = this.contentEmitter.event;
  readonly onDidDispose = this.disposeEmitter.event;
  private watcher: vscode.FileSystemWatcher | undefined;
  private dirty = false;

  constructor(readonly uri: vscode.Uri, initial: DocState, saved: DocState) {
    this.state = initial;
    this.saved = saved;
    if (uri.scheme === 'file') {
      const folder = vscode.Uri.joinPath(uri, '..');
      const name = uri.path.split('/').pop()!;
      this.watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, `${name}*`));
      const reload = () => {
        if (!this.dirty) void this.reloadFromDisk('external');
      };
      this.watcher.onDidChange(reload);
      this.watcher.onDidCreate(reload);
    }
  }

  get image(): RgbaImage {
    return this.state.image;
  }

  get mcmeta(): Record<string, unknown> | null {
    return this.state.mcmeta;
  }

  /** Apply an edit coming from the webview. */
  edit(p: TextureEditParams): void {
    const before = this.state;
    const after: DocState = {
      image: p.image ? fromWire(p.image) : before.image,
      mcmeta: p.mcmeta === undefined ? before.mcmeta : p.mcmeta,
    };
    if (imagesEqual(after.image, before.image) && sameJson(after.mcmeta, before.mcmeta)) return;
    this.state = after;
    this.updateDirty();
    this.changeEmitter.fire({
      document: this,
      label: p.label,
      undo: () => this.setState(before, 'undo'),
      redo: () => this.setState(after, 'redo'),
    });
  }

  private setState(s: DocState, reason: string): void {
    this.state = s;
    this.updateDirty();
    this.contentEmitter.fire({ image: toWire(s.image), mcmeta: s.mcmeta, reason });
  }

  private updateDirty(): void {
    this.dirty = !(imagesEqual(this.state.image, this.saved.image) && sameJson(this.state.mcmeta, this.saved.mcmeta));
  }

  private async reloadFromDisk(reason: string): Promise<void> {
    try {
      const s = await readState(this.uri);
      if (imagesEqual(s.image, this.state.image) && sameJson(s.mcmeta, this.state.mcmeta)) return;
      this.saved = s;
      this.setState(s, reason);
    } catch {
      /* ignore transient errors while the file is being written */
    }
  }

  async save(cancellation?: vscode.CancellationToken): Promise<void> {
    await this.saveAs(this.uri, cancellation);
    this.saved = this.state;
    this.dirty = false;
  }

  async saveAs(target: vscode.Uri, cancellation?: vscode.CancellationToken): Promise<void> {
    const png = encodePng(this.state.image);
    if (cancellation?.isCancellationRequested) return;
    await vscode.workspace.fs.writeFile(target, png);
    const meta = mcmetaUri(target);
    const isSelf = target.toString() === this.uri.toString();
    if (this.state.mcmeta) {
      if (!isSelf || !sameJson(this.state.mcmeta, this.saved.mcmeta)) {
        await vscode.workspace.fs.writeFile(meta, encoder.encode(JSON.stringify(this.state.mcmeta, null, 2) + '\n'));
      }
    } else if (isSelf && this.saved.mcmeta) {
      try {
        await vscode.workspace.fs.delete(meta, { useTrash: true });
      } catch {
        /* already gone */
      }
    }
  }

  async revert(): Promise<void> {
    const s = await readState(this.uri);
    this.saved = s;
    this.setState(s, 'revert');
  }

  async backup(destination: vscode.Uri): Promise<vscode.CustomDocumentBackup> {
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(destination, '..'));
    const json = JSON.stringify({ image: toWire(this.state.image), mcmeta: this.state.mcmeta });
    await vscode.workspace.fs.writeFile(destination, encoder.encode(json));
    return {
      id: destination.toString(),
      delete: async () => {
        try {
          await vscode.workspace.fs.delete(destination);
        } catch {
          /* fine */
        }
      },
    };
  }

  dispose(): void {
    this.watcher?.dispose();
    this.disposeEmitter.fire();
    this.changeEmitter.dispose();
    this.contentEmitter.dispose();
    this.disposeEmitter.dispose();
  }
}

/** Pixel-art editor for PNG textures (custom editor, opened with "Open With… → Texture Editor"). */
export class TextureEditorProvider implements vscode.CustomEditorProvider<TextureDocument> {
  private readonly changeEmitter = new vscode.EventEmitter<vscode.CustomDocumentEditEvent<TextureDocument>>();
  readonly onDidChangeCustomDocument = this.changeEmitter.event;
  private readonly hosts = new Map<TextureDocument, Set<WebviewHost>>();
  private paletteCache: Promise<NamedPalette[]> | undefined;

  constructor(
    private readonly core: Core,
    private readonly textures: TextureService,
  ) {}

  static register(core: Core, textures: TextureService): void {
    const provider = new TextureEditorProvider(core, textures);
    core.track(
      vscode.window.registerCustomEditorProvider(TEXTURE_EDITOR_VIEW_TYPE, provider, {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: true,
      }),
    );
  }

  async openCustomDocument(uri: vscode.Uri, ctx: vscode.CustomDocumentOpenContext): Promise<TextureDocument> {
    const saved = await readState(uri);
    let initial = saved;
    if (ctx.backupId) {
      try {
        const raw = JSON.parse(decoder.decode(await vscode.workspace.fs.readFile(vscode.Uri.parse(ctx.backupId))));
        initial = { image: fromWire(raw.image as WireImage), mcmeta: raw.mcmeta ?? null };
      } catch {
        /* corrupt backup: use the file */
      }
    }
    const doc = new TextureDocument(uri, initial, saved);
    doc.onDidChange((e) => this.changeEmitter.fire(e));
    doc.onDidChangeContent((e) => this.hosts.get(doc)?.forEach((h) => void h.post('tex.set', e)));
    return doc;
  }

  resolveCustomEditor(doc: TextureDocument, panel: vscode.WebviewPanel): void {
    const boot: TextureEditorBoot = { uri: doc.uri.toString() };
    const host = this.core.webviews.attach(panel.webview, {
      bundle: 'textureEditor',
      title: doc.uri.path.split('/').pop(),
      state: boot,
      documentUri: doc.uri,
      handlers: {
        'tex.load': (): TextureEditorPayload => {
          const info = classifyPath(doc.uri.fsPath);
          const isTexture = info?.side === 'assets' && info.kind === 'textures';
          return {
            image: toWire(doc.image),
            mcmeta: doc.mcmeta,
            id: isTexture ? info!.id : undefined,
            folder: isTexture ? info!.path.split('/').slice(0, -1).join('/') : undefined,
            fileName: doc.uri.path.split('/').pop() ?? '',
            version: this.core.version(doc.uri),
          };
        },
        'tex.edit': (p: TextureEditParams) => {
          doc.edit(p);
          // Keep other editors of the same document (split view) in sync.
          for (const h of this.hosts.get(doc) ?? []) {
            if (h !== host) void h.post('tex.set', { image: toWire(doc.image), mcmeta: doc.mcmeta, reason: 'sync' } satisfies TextureSetEvent);
          }
        },
        'tex.command': async (p: { command: 'undo' | 'redo' | 'save' }) => {
          panel.reveal(undefined, false);
          const cmd = p.command === 'save' ? 'workbench.action.files.save' : p.command;
          await vscode.commands.executeCommand(cmd);
        },
        'tex.palettes': () => this.vanillaPalettes(doc.uri),
        'tex.generateMcmeta': async () => vscode.commands.executeCommand('vscodecraft.textures.generateMcmeta', doc.uri),
        'tex.openVariant': async () => vscode.commands.executeCommand('vscodecraft.textures.createVariant', doc.uri),
      },
    });
    let set = this.hosts.get(doc);
    if (!set) this.hosts.set(doc, (set = new Set()));
    set.add(host);
    panel.onDidDispose(() => {
      set!.delete(host);
      host.dispose();
    });
  }

  /** Palettes extracted from a few iconic vanilla textures (empty when vanilla data is unavailable). */
  private vanillaPalettes(uri: vscode.Uri): Promise<NamedPalette[]> {
    if (!this.paletteCache) {
      const version = this.core.version(uri);
      const sources: [string, string][] = [
        [vscode.l10n.t('Stone'), 'block/stone'],
        [vscode.l10n.t('Oak planks'), 'block/oak_planks'],
        [vscode.l10n.t('Dirt & grass'), 'block/dirt'],
        [vscode.l10n.t('Iron'), 'item/iron_ingot'],
        [vscode.l10n.t('Gold'), 'item/gold_ingot'],
        [vscode.l10n.t('Diamond'), 'item/diamond'],
        [vscode.l10n.t('Emerald'), 'item/emerald'],
        [vscode.l10n.t('Redstone'), 'item/redstone'],
        [vscode.l10n.t('Copper'), 'item/copper_ingot'],
        [vscode.l10n.t('Amethyst'), 'item/amethyst_shard'],
        [vscode.l10n.t('Netherite'), 'item/netherite_ingot'],
        [vscode.l10n.t('Netherrack'), 'block/netherrack'],
      ];
      this.paletteCache = (async () => {
        const out: NamedPalette[] = [];
        for (const [name, path] of sources) {
          const img = await this.textures.vanillaSprite(path, version).catch(() => undefined);
          if (!img) continue;
          out.push({ name, colors: extractPalette(img, 24).map((c) => rgbaToHex(c)) });
        }
        if (!out.length) this.paletteCache = undefined;
        return out;
      })();
    }
    return this.paletteCache;
  }

  saveCustomDocument(doc: TextureDocument, cancellation: vscode.CancellationToken): Thenable<void> {
    return doc.save(cancellation);
  }

  saveCustomDocumentAs(doc: TextureDocument, destination: vscode.Uri, cancellation: vscode.CancellationToken): Thenable<void> {
    return doc.saveAs(destination, cancellation);
  }

  revertCustomDocument(doc: TextureDocument): Thenable<void> {
    return doc.revert();
  }

  backupCustomDocument(doc: TextureDocument, context: vscode.CustomDocumentBackupContext): Thenable<vscode.CustomDocumentBackup> {
    return doc.backup(context.destination);
  }
}
