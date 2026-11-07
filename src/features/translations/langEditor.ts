// Lang Editor: spreadsheet of every key × locale of a namespace (webview bundle "lang").
// Opened as a panel (command / editor title button) or as a CustomTextEditor ("Open With…").
import * as vscode from 'vscode';
import type { Core } from '../../core/core';
import type { WebviewHost } from '../../core/webviews';
import {
  deleteEntry,
  fillMissing,
  isLocaleCode,
  isValidKey,
  LangEntry,
  parseLang,
  renameEntry,
  setEntry,
  sortEntries,
} from './langFile';
import { localeName } from './locales';
import {
  applyChanges,
  cfg,
  FileChange,
  langFilesIn,
  localeOf,
  namespaceOfLangFolder,
  parentFolder,
  resolveLangFolder,
  serializeLike,
  setValueText,
} from './host';

export const LANG_EDITOR_VIEW_TYPE = 'vscodecraft.translations.langEditor';
const BASE = 'en_us';

export interface LangLocaleModel {
  locale: string;
  name: string;
  uri: string;
  entries: [string, string][];
  duplicates: string[];
  nonString: string[];
  errors: number;
}

export interface LangModel {
  namespace: string;
  folder: string;
  base: string;
  primary?: string;
  locales: LangLocaleModel[];
  sortKeys: boolean;
  marker: string;
  canUndo: boolean;
  canRedo: boolean;
}

export type LangOp =
  | { op: 'set'; locale: string; key: string; value: string }
  | { op: 'add'; key: string; values: Record<string, string> }
  | { op: 'rename'; from: string; to: string }
  | { op: 'delete'; keys: string[] }
  | { op: 'addLocale'; locale: string; fill: 'empty' | 'english' }
  | { op: 'sort' }
  | { op: 'fillMissing'; locale: string };

interface UndoStep {
  label: string;
  files: { uri: vscode.Uri; before: string | undefined; after: string }[];
}

interface LoadedFile {
  locale: string;
  uri: vscode.Uri;
  text: string;
  entries: LangEntry[];
  errors: number;
}

/** One editor instance bound to a lang folder (assets/<ns>/lang). */
export class LangEditorController implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private undoStack: UndoStep[] = [];
  private redoStack: UndoStep[] = [];
  private timer: NodeJS.Timeout | undefined;
  readonly host: WebviewHost;

  constructor(
    private readonly core: Core,
    readonly folder: vscode.Uri,
    webview: vscode.Webview,
    /** Document opened through the custom editor (left dirty, saved by the user). */
    private readonly ownedDoc?: vscode.TextDocument,
  ) {
    const enUri = vscode.Uri.joinPath(folder, `${BASE}.json`);
    this.host = core.webviews.attach(webview, {
      bundle: 'lang',
      title: vscode.l10n.t('Lang Editor'),
      documentUri: ownedDoc?.uri ?? enUri,
      state: { namespace: namespaceOfLangFolder(folder), customEditor: !!ownedDoc },
      handlers: {
        'lang.load': () => this.model(),
        'lang.op': (p: LangOp) => this.apply(p),
        'lang.undo': () => this.undo(),
        'lang.redo': () => this.redo(),
        'lang.open': (p: { locale: string; key?: string }) => this.openAt(p.locale, p.key),
      },
    });
    const inFolder = (u: vscode.Uri) => parentFolder(u).toString() === folder.toString() && u.path.toLowerCase().endsWith('.json');
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, '*.json'));
    this.disposables.push(
      this.host,
      watcher,
      watcher.onDidCreate(() => this.schedule()),
      watcher.onDidDelete(() => this.schedule()),
      watcher.onDidChange(() => this.schedule()),
      vscode.workspace.onDidChangeTextDocument((e) => inFolder(e.document.uri) && e.contentChanges.length && this.schedule()),
      vscode.workspace.onDidChangeConfiguration((e) => e.affectsConfiguration('vscodecraft.translations') && this.schedule()),
    );
  }

  private schedule(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(async () => {
      try {
        void this.host.post('lang.model', await this.model());
      } catch (e) {
        this.core.log.warn(`lang editor refresh: ${e}`);
      }
    }, 120);
  }

  private async load(): Promise<Map<string, LoadedFile>> {
    const out = new Map<string, LoadedFile>();
    const files = await langFilesIn(this.folder);
    if (this.ownedDoc && !files.has(localeOf(this.ownedDoc.uri))) files.set(localeOf(this.ownedDoc.uri), this.ownedDoc.uri);
    for (const [locale, uri] of files) {
      try {
        const doc = await vscode.workspace.openTextDocument(uri);
        const text = doc.getText();
        const p = parseLang(text);
        out.set(locale, { locale, uri, text, entries: p.entries, errors: p.errors });
      } catch (e) {
        this.core.log.warn(`Cannot read ${uri.fsPath}: ${e}`);
      }
    }
    return out;
  }

  async model(): Promise<LangModel> {
    const files = await langFilesIn(this.folder);
    if (this.ownedDoc) files.set(localeOf(this.ownedDoc.uri), this.ownedDoc.uri);
    const locales: LangLocaleModel[] = [];
    for (const [locale, uri] of files) {
      let text = '';
      try {
        text = (await vscode.workspace.openTextDocument(uri)).getText();
      } catch {
        continue;
      }
      const p = parseLang(text);
      locales.push({
        locale,
        name: localeName(locale),
        uri: uri.toString(),
        entries: p.entries.map((e) => [e.key, e.value]),
        duplicates: p.duplicates,
        nonString: p.nonString,
        errors: p.errors,
      });
    }
    locales.sort((a, b) => (a.locale === BASE ? -1 : b.locale === BASE ? 1 : a.locale.localeCompare(b.locale)));
    return {
      namespace: namespaceOfLangFolder(this.folder),
      folder: vscode.workspace.asRelativePath(this.folder),
      base: BASE,
      primary: this.ownedDoc ? localeOf(this.ownedDoc.uri) : undefined,
      locales,
      sortKeys: cfg('sortKeys', false, this.folder),
      marker: cfg('untranslatedMarker', '', this.folder),
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
    };
  }

  /** Apply an editing operation to one or more locale files as one undoable step. */
  async apply(p: LangOp): Promise<LangModel> {
    const files = await this.load();
    const sort = cfg('sortKeys', false, this.folder);
    const baseOrder = files.get(BASE)?.entries.map((e) => e.key) ?? [];
    const changes: FileChange[] = [];
    const broken: string[] = [];
    const write = (f: LoadedFile, entries: LangEntry[]) => {
      if (f.errors) {
        broken.push(f.locale);
        return;
      }
      changes.push({ uri: f.uri, before: f.text, text: serializeLike(f.text, entries, sort) });
    };
    let label: string = p.op;
    switch (p.op) {
      case 'set': {
        const f = files.get(p.locale);
        if (!f) throw new Error(vscode.l10n.t('Locale {0} not found', p.locale));
        if (f.entries.some((e) => e.key === p.key)) {
          if (f.errors) broken.push(f.locale);
          else changes.push({ uri: f.uri, before: f.text, text: setValueText(f.text, p.key, p.value) });
        } else write(f, setEntry(f.entries, p.key, p.value, { sort, referenceOrder: baseOrder }));
        label = vscode.l10n.t('Edit {0}', p.key);
        break;
      }
      case 'add': {
        if (!isValidKey(p.key)) throw new Error(vscode.l10n.t('Invalid key: {0}', p.key));
        for (const [locale, value] of Object.entries(p.values)) {
          const f = files.get(locale);
          if (f) write(f, setEntry(f.entries, p.key, value, { sort, referenceOrder: baseOrder }));
        }
        label = vscode.l10n.t('Add {0}', p.key);
        break;
      }
      case 'rename': {
        if (!isValidKey(p.to)) throw new Error(vscode.l10n.t('Invalid key: {0}', p.to));
        for (const f of files.values()) {
          if (!f.entries.some((e) => e.key === p.from)) continue;
          write(f, renameEntry(f.entries, p.from, p.to, sort));
        }
        label = vscode.l10n.t('Rename {0}', p.from);
        break;
      }
      case 'delete': {
        const keys = new Set(p.keys);
        for (const f of files.values()) {
          if (!f.entries.some((e) => keys.has(e.key))) continue;
          let entries = f.entries;
          for (const k of keys) entries = deleteEntry(entries, k);
          write(f, entries);
        }
        label = vscode.l10n.t('Delete {0} key(s)', keys.size);
        break;
      }
      case 'sort': {
        for (const f of files.values()) write(f, sortEntries(f.entries));
        label = vscode.l10n.t('Sort keys');
        break;
      }
      case 'addLocale': {
        if (!isLocaleCode(p.locale)) throw new Error(vscode.l10n.t('Invalid locale code: {0}', p.locale));
        if (files.has(p.locale)) throw new Error(vscode.l10n.t('Locale {0} already exists', p.locale));
        const base = files.get(BASE)?.entries ?? [];
        const marker = cfg('untranslatedMarker', '', this.folder);
        const entries = p.fill === 'english' ? base.map((e) => ({ key: e.key, value: marker + e.value })) : [];
        changes.push({ uri: vscode.Uri.joinPath(this.folder, `${p.locale}.json`), before: undefined, text: serializeLike(files.get(BASE)?.text, entries, sort) });
        label = vscode.l10n.t('Add locale {0}', p.locale);
        break;
      }
      case 'fillMissing': {
        const f = files.get(p.locale);
        const base = files.get(BASE);
        if (!f || !base) break;
        const r = fillMissing(f.entries, base.entries, { marker: cfg('untranslatedMarker', '', this.folder), sort });
        if (r.added.length) write(f, r.entries);
        label = vscode.l10n.t('Copy missing keys to {0}', p.locale);
        break;
      }
    }
    if (broken.length) {
      void vscode.window.showWarningMessage(
        vscode.l10n.t('Skipped {0}: the file has JSON syntax errors. Fix them first.', broken.map((l) => `${l}.json`).join(', ')),
      );
    }
    await this.commit(label, changes);
    return this.model();
  }

  private async commit(label: string, changes: FileChange[]): Promise<void> {
    const real = changes.filter((c) => c.before !== c.text);
    if (!real.length) return;
    const ok = await applyChanges(real, { save: cfg('autoSave', true, this.folder), keepDirty: this.ownedDoc ? [this.ownedDoc.uri] : [] });
    if (!ok) throw new Error(vscode.l10n.t('Could not apply the edit'));
    this.undoStack.push({ label, files: real.map((c) => ({ uri: c.uri, before: c.before, after: c.text })) });
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
  }

  private async swap(from: UndoStep[], to: UndoStep[], undo: boolean): Promise<LangModel> {
    const step = from.pop();
    if (step) {
      const edit = new vscode.WorkspaceEdit();
      for (const f of step.files) {
        const target = undo ? f.before : f.after;
        let current: string | undefined;
        try {
          current = (await vscode.workspace.openTextDocument(f.uri)).getText();
        } catch {
          current = undefined;
        }
        const expected = undo ? f.after : f.before;
        if (current !== expected && !(current === undefined && expected === undefined)) {
          void vscode.window.showWarningMessage(vscode.l10n.t('{0} changed outside the Lang Editor; cannot undo/redo "{1}".', localeOf(f.uri), step.label));
          return this.model();
        }
        if (target === undefined) edit.deleteFile(f.uri, { ignoreIfNotExists: true });
        else if (current === undefined) edit.createFile(f.uri, { contents: new TextEncoder().encode(target), ignoreIfExists: true });
        else {
          const doc = await vscode.workspace.openTextDocument(f.uri);
          edit.replace(f.uri, new vscode.Range(0, 0, doc.lineCount, 0), target);
        }
      }
      await vscode.workspace.applyEdit(edit);
      if (cfg('autoSave', true, this.folder)) {
        for (const f of step.files) {
          if (this.ownedDoc && f.uri.toString() === this.ownedDoc.uri.toString()) continue;
          const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === f.uri.toString());
          if (doc?.isDirty && !vscode.window.visibleTextEditors.some((e) => e.document === doc)) await doc.save();
        }
      }
      to.push(step);
    }
    return this.model();
  }

  undo(): Promise<LangModel> {
    return this.swap(this.undoStack, this.redoStack, true);
  }

  redo(): Promise<LangModel> {
    return this.swap(this.redoStack, this.undoStack, false);
  }

  private async openAt(locale: string, key?: string): Promise<void> {
    const uri = vscode.Uri.joinPath(this.folder, `${locale}.json`);
    const doc = await vscode.workspace.openTextDocument(uri);
    let sel: vscode.Range | undefined;
    if (key) {
      const idx = doc.getText().indexOf(JSON.stringify(key));
      if (idx >= 0) {
        const pos = doc.positionAt(idx);
        sel = new vscode.Range(pos, pos.translate(0, JSON.stringify(key).length));
      }
    }
    // Open as text even when this file's default editor is the custom one.
    await vscode.window.showTextDocument(doc, { selection: sel, viewColumn: vscode.ViewColumn.Beside, preview: false });
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.disposables.forEach((d) => d.dispose());
  }
}

const panels = new Map<string, vscode.WebviewPanel>();

/** Open (or reveal) the Lang Editor panel for a lang folder. */
export async function openLangEditor(core: Core, arg?: vscode.Uri): Promise<void> {
  const folder = await resolveLangFolder(core, arg);
  if (!folder) return;
  const key = folder.toString();
  const existing = panels.get(key);
  if (existing) {
    existing.reveal();
    return;
  }
  const ns = namespaceOfLangFolder(folder);
  const panel = vscode.window.createWebviewPanel('vscodecraft.translations.langPanel', vscode.l10n.t('Lang: {0}', ns), vscode.ViewColumn.Active, {
    ...core.webviews.webviewOptions(),
    retainContextWhenHidden: true,
  });
  const ctrl = new LangEditorController(core, folder, panel.webview);
  panels.set(key, panel);
  panel.onDidDispose(() => {
    panels.delete(key);
    ctrl.dispose();
  });
}

/** "Open With… → Lang Editor" for a single lang file (shows the whole namespace). */
export class LangCustomEditorProvider implements vscode.CustomTextEditorProvider {
  constructor(private readonly core: Core) {}

  resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): void {
    const ctrl = new LangEditorController(this.core, parentFolder(document.uri), panel.webview, document);
    panel.onDidDispose(() => ctrl.dispose());
  }
}
