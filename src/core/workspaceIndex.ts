import * as vscode from 'vscode';
import { classifyPath, ResourceFileInfo } from './resourceLocation';
import { readJson } from './fsUtils';
import type { Logger } from './logger';

export interface IndexedResource extends ResourceFileInfo {
  uri: vscode.Uri;
}

export const EXCLUDE_GLOB = '**/{node_modules,build,.gradle,run,runs,out,bin,.git,.idea,.vscode-test}/**';
const INCLUDE_GLOB = '**/{data,assets}/**/*.{json,png,mcfunction,nbt,mcmeta,ogg,fsh,vsh,glsl,txt}';

/**
 * Index of every data/asset file in the workspace, keyed by kind and resource id.
 * Covers src/main/resources, datagen output (src/generated, src/main/generated), multi-loader modules and plain packs.
 */
export class WorkspaceIndex implements vscode.Disposable {
  private byKind = new Map<string, Map<string, IndexedResource[]>>();
  private byUri = new Map<string, IndexedResource>();
  private jsonCache = new Map<string, unknown>();
  private readonly emitter = new vscode.EventEmitter<void>();
  private readonly contentEmitter = new vscode.EventEmitter<vscode.Uri>();
  private readonly disposables: vscode.Disposable[] = [];
  private debounce: NodeJS.Timeout | undefined;
  /** Fires (debounced) when files are added/removed. */
  readonly onDidChange = this.emitter.event;
  /** Fires when the content of an indexed file changes (on save or on disk). */
  readonly onDidChangeContent = this.contentEmitter.event;
  ready: Promise<void>;

  constructor(private readonly log: Logger) {
    this.ready = this.rebuild();
    const watcher = vscode.workspace.createFileSystemWatcher('**/{data,assets}/**');
    this.disposables.push(
      watcher,
      watcher.onDidCreate((uri) => this.add(uri) && this.fire()),
      watcher.onDidDelete((uri) => this.removeTree(uri) && this.fire()),
      watcher.onDidChange((uri) => this.invalidate(uri)),
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (this.byUri.has(e.document.uri.toString())) this.invalidate(e.document.uri);
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        this.ready = this.rebuild().then(() => this.fire());
      }),
    );
  }

  async rebuild(): Promise<void> {
    const start = Date.now();
    const uris = await vscode.workspace.findFiles(INCLUDE_GLOB, EXCLUDE_GLOB, 100000);
    this.byKind.clear();
    this.byUri.clear();
    this.jsonCache.clear();
    for (const uri of uris) this.add(uri);
    this.log.info(`Indexed ${this.byUri.size} resource files in ${Date.now() - start} ms`);
  }

  private add(uri: vscode.Uri): boolean {
    if (/[\\/](node_modules|build|\.gradle|run|runs|out|bin|\.git)[\\/]/.test(uri.fsPath)) return false;
    const info = classifyPath(uri.fsPath);
    if (!info) return false;
    const res: IndexedResource = { ...info, uri };
    const key = uri.toString();
    if (this.byUri.has(key)) return false;
    this.byUri.set(key, res);
    let m = this.byKind.get(res.kind);
    if (!m) this.byKind.set(res.kind, (m = new Map()));
    const list = m.get(res.id) ?? [];
    list.push(res);
    m.set(res.id, list);
    return true;
  }

  private removeTree(uri: vscode.Uri): boolean {
    const prefix = uri.toString();
    let changed = false;
    for (const [key, res] of [...this.byUri]) {
      if (key === prefix || key.startsWith(prefix + '/')) {
        this.byUri.delete(key);
        this.jsonCache.delete(key);
        const m = this.byKind.get(res.kind);
        const list = m?.get(res.id)?.filter((r) => r.uri.toString() !== key);
        if (m) list?.length ? m.set(res.id, list) : m.delete(res.id);
        changed = true;
      }
    }
    return changed;
  }

  private invalidate(uri: vscode.Uri): void {
    this.jsonCache.delete(uri.toString());
    this.contentEmitter.fire(uri);
  }

  private fire(): void {
    clearTimeout(this.debounce);
    this.debounce = setTimeout(() => this.emitter.fire(), 300);
  }

  /** Info about an indexed file, or classification of any path inside data/ or assets/. */
  info(uri: vscode.Uri): IndexedResource | undefined {
    const known = this.byUri.get(uri.toString());
    if (known) return known;
    const info = classifyPath(uri.fsPath);
    return info ? { ...info, uri } : undefined;
  }

  /** All kinds present in the workspace (e.g. "recipe", "tags/item", "models"). */
  kinds(): string[] {
    return [...this.byKind.keys()].sort();
  }

  /** All resources of a kind. */
  all(kind: string): IndexedResource[] {
    const m = this.byKind.get(kind);
    return m ? [...m.values()].flat() : [];
  }

  /** All ids of a kind. */
  ids(kind: string): string[] {
    return [...(this.byKind.get(kind)?.keys() ?? [])];
  }

  /** Files for a resource id of a kind (several when the same id exists in multiple roots). */
  get(kind: string, id: string): IndexedResource[] {
    return this.byKind.get(kind)?.get(id) ?? [];
  }

  find(kind: string, id: string): vscode.Uri | undefined {
    return this.get(kind, id)[0]?.uri;
  }

  /** All namespaces present under data/ or assets/. */
  namespaces(): string[] {
    const s = new Set<string>();
    for (const r of this.byUri.values()) s.add(r.namespace);
    return [...s].sort();
  }

  /** Distinct resource roots (folders containing data/ or assets/). */
  roots(): string[] {
    const s = new Set<string>();
    for (const r of this.byUri.values()) s.add(r.root);
    return [...s].sort();
  }

  /** Cached JSON read of an indexed file. */
  async json<T = any>(uri: vscode.Uri): Promise<T | undefined> {
    const key = uri.toString();
    if (this.jsonCache.has(key)) return this.jsonCache.get(key) as T;
    const v = await readJson<T>(uri);
    this.jsonCache.set(key, v);
    return v;
  }

  /** Merged lang entries of the workspace for a locale (default en_us). */
  async lang(locale = 'en_us'): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const r of this.all('lang')) {
      if (r.path !== locale) continue;
      const j = await this.json<Record<string, string>>(r.uri);
      if (j && typeof j === 'object') Object.assign(out, j);
    }
    return out;
  }

  /**
   * Values declared in workspace tag files for a tag id (not recursively expanded, "#..." entries kept).
   * `registry` is e.g. "item", "block", "worldgen/biome".
   */
  async tagValues(registry: string, id: string): Promise<{ values: string[]; replace: boolean } | undefined> {
    const files = this.get(`tags/${registry}`, id);
    if (!files.length) return undefined;
    const values: string[] = [];
    let replace = false;
    for (const f of files) {
      const j = await this.json<{ replace?: boolean; values?: (string | { id: string; required?: boolean })[] }>(f.uri);
      if (!j) continue;
      if (j.replace) {
        replace = true;
        values.length = 0;
      }
      for (const v of j.values ?? []) values.push(typeof v === 'string' ? v : v.id);
    }
    return { values, replace };
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
    this.emitter.dispose();
    this.contentEmitter.dispose();
  }
}
