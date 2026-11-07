import * as vscode from 'vscode';
import * as fs from 'node:fs';
import type { HostEvent, RpcRequest, RpcResponse, WebviewBootData } from '../shared/protocol';
import { openFile } from './fsUtils';
import type { Core } from './core';

export type RpcHandler = (params: any, host: WebviewHost) => unknown | Promise<unknown>;
export type RpcHandlers = Record<string, RpcHandler>;

export interface WebviewOptions {
  /** Name of the webview bundle: webview-src/<bundle>/index.ts(x) -> dist/webview/<bundle>.js */
  bundle: string;
  /** Initial state available in the webview as boot().state */
  state?: unknown;
  /** Document that gives context (target version, namespace) to common RPCs. */
  documentUri?: vscode.Uri;
  /** Feature-specific RPC methods (in addition to the common ones). */
  handlers?: RpcHandlers;
  /** Page title (for the <title> tag). */
  title?: string;
}

export interface PanelOptions extends WebviewOptions {
  viewType: string;
  title: string;
  column?: vscode.ViewColumn | { viewColumn: vscode.ViewColumn; preserveFocus?: boolean };
  retainContextWhenHidden?: boolean;
  /** Codicon-less icon: path relative to the extension (e.g. "media/icons/recipe.svg"). */
  icon?: string;
}

/** Wraps a webview: RPC dispatch + host->webview events. */
export class WebviewHost implements vscode.Disposable {
  private handlers: RpcHandlers;
  private readonly disposables: vscode.Disposable[] = [];
  documentUri: vscode.Uri | undefined;

  constructor(
    readonly webview: vscode.Webview,
    common: RpcHandlers,
    options: WebviewOptions,
    private readonly core: Core,
  ) {
    this.handlers = { ...common, ...(options.handlers ?? {}) };
    this.documentUri = options.documentUri;
    this.disposables.push(webview.onDidReceiveMessage((m) => this.onMessage(m)));
  }

  /** Register / replace an RPC method. */
  handle(method: string, fn: RpcHandler): void {
    this.handlers[method] = fn;
  }

  /** Send an event to the webview (received with onEvent(name, cb) on the webview side). */
  post(event: string, data?: unknown): Thenable<boolean> {
    const msg: HostEvent = { kind: 'event', event, data };
    return this.webview.postMessage(msg);
  }

  private async onMessage(m: RpcRequest): Promise<void> {
    if (!m || m.kind !== 'rpc') return;
    const res: RpcResponse = { kind: 'rpc-result', id: m.id };
    const fn = this.handlers[m.method];
    try {
      if (!fn) throw new Error(`Unknown RPC method ${m.method}`);
      res.result = await fn(m.params, this);
    } catch (e) {
      res.error = e instanceof Error ? e.message : String(e);
      this.core.log.warn(`RPC ${m.method} failed: ${res.error}`);
    }
    void this.webview.postMessage(res);
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
  }
}

export class WebviewService {
  private l10nCache: Record<string, string> | undefined;

  constructor(private readonly core: Core) {}

  /** Folders a webview may load resources from. */
  localResourceRoots(): vscode.Uri[] {
    return [
      this.core.context.extensionUri,
      this.core.context.globalStorageUri,
      ...(vscode.workspace.workspaceFolders ?? []).map((f) => f.uri),
    ];
  }

  /** Standard webview options (scripts enabled, local roots). */
  webviewOptions(): vscode.WebviewOptions & vscode.WebviewPanelOptions {
    return { enableScripts: true, localResourceRoots: this.localResourceRoots() };
  }

  /** Create a webview panel running a webview bundle. */
  createPanel(opts: PanelOptions): { panel: vscode.WebviewPanel; host: WebviewHost } {
    const panel = vscode.window.createWebviewPanel(opts.viewType, opts.title, opts.column ?? vscode.ViewColumn.Active, {
      ...this.webviewOptions(),
      retainContextWhenHidden: opts.retainContextWhenHidden ?? true,
    });
    if (opts.icon) panel.iconPath = vscode.Uri.joinPath(this.core.context.extensionUri, opts.icon);
    const host = this.attach(panel.webview, opts);
    panel.onDidDispose(() => host.dispose());
    return { panel, host };
  }

  /**
   * Set up any webview (panel, WebviewView, custom editor) to run a bundle with RPC support.
   * Sets webview.options and webview.html.
   */
  attach(webview: vscode.Webview, opts: WebviewOptions): WebviewHost {
    webview.options = { enableScripts: true, localResourceRoots: this.localResourceRoots() };
    const host = new WebviewHost(webview, this.commonHandlers(), opts, this.core);
    webview.html = this.html(webview, opts);
    return host;
  }

  /** Full HTML document for a bundle. */
  html(webview: vscode.Webview, opts: WebviewOptions): string {
    const nonce = makeNonce();
    const ext = this.core.context.extensionUri;
    const script = webview.asWebviewUri(vscode.Uri.joinPath(ext, 'dist', 'webview', `${opts.bundle}.js`));
    const css = webview.asWebviewUri(vscode.Uri.joinPath(ext, 'media', 'webview.css'));
    const boot: WebviewBootData = {
      language: vscode.env.language,
      l10n: this.l10n(),
      state: opts.state ?? null,
    };
    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource} data: blob: https:`,
      `media-src ${webview.cspSource} data: blob:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `font-src ${webview.cspSource} data:`,
      `script-src 'nonce-${nonce}'`,
      `worker-src blob:`,
    ].join('; ');
    const bootJson = JSON.stringify(boot).replace(/</g, '\\u003c');
    return `<!DOCTYPE html>
<html lang="${vscode.env.language}">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${css}">
<title>${escapeHtml(opts.title ?? 'VSCodeCraft')}</title>
</head>
<body>
<div id="app"></div>
<script nonce="${nonce}">window.__VSCODECRAFT__ = ${bootJson};</script>
<script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
  }

  /** Localized strings for webviews (English keys -> current language). */
  l10n(): Record<string, string> {
    if (this.l10nCache) return this.l10nCache;
    const lang = vscode.env.language.toLowerCase();
    const candidates = [lang, lang.split('-')[0]];
    for (const c of candidates) {
      const f = vscode.Uri.joinPath(this.core.context.extensionUri, 'l10n', `bundle.l10n.${c}.json`).fsPath;
      if (fs.existsSync(f)) {
        try {
          return (this.l10nCache = JSON.parse(fs.readFileSync(f, 'utf8')));
        } catch {
          /* ignore */
        }
      }
    }
    return (this.l10nCache = {});
  }

  /** RPC methods available to every webview (see CommonRpc in src/shared/protocol.ts). */
  private commonHandlers(): RpcHandlers {
    const core = this.core;
    return {
      'icons.resolve': async (p: { ids: string[] }, host) => {
        const out: Record<string, unknown> = {};
        await Promise.all(
          [...new Set(p.ids)].map(async (id) => {
            out[id] = await core.icons.resolveItem(id, host.webview, host.documentUri);
          }),
        );
        return out;
      },
      'textures.resolve': async (p: { ids: string[] }, host) => {
        const out: Record<string, unknown> = {};
        for (const id of new Set(p.ids)) out[id] = await core.icons.resolveTexture(id, host.webview, host.documentUri);
        return out;
      },
      'items.search': (p: { query: string; limit?: number; registry?: string }, host) =>
        core.registries.search(p.query ?? '', { registry: p.registry, limit: p.limit }, host.documentUri),
      'tags.expand': (p: { tag: string; registry?: string }, host) =>
        core.registries.expandTag(p.tag, p.registry ?? 'item', host.documentUri),
      'names.get': async (p: { ids: string[] }, host) => {
        const out: Record<string, string> = {};
        for (const id of p.ids) out[id] = await core.registries.displayName(id.replace(/^#/, ''), host.documentUri);
        return out;
      },
      'file.open': async (p: { uri: string; line?: number }) => {
        const uri = vscode.Uri.parse(p.uri);
        const sel = p.line !== undefined ? new vscode.Range(p.line, 0, p.line, 0) : undefined;
        await openFile(uri, { selection: sel, viewColumn: vscode.ViewColumn.One });
      },
      'ui.notify': (p: { message: string; level?: string }) => {
        if (p.level === 'error') void vscode.window.showErrorMessage(p.message);
        else if (p.level === 'warning') void vscode.window.showWarningMessage(p.message);
        else void vscode.window.showInformationMessage(p.message);
      },
      'project.info': (_p, host) => {
        const project = core.projects.projectFor(host.documentUri);
        return {
          version: core.projects.targetVersion(host.documentUri),
          loader: project?.loader ?? 'unknown',
          namespaces: project?.namespaces ?? [],
          defaultNamespace: core.projects.defaultNamespace(host.documentUri),
        };
      },
    };
  }
}

function makeNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 32; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
