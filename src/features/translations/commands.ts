// Commands: Add Missing Translations, Copy Missing Keys to Locale, Find Unused Translation Keys.
import * as vscode from 'vscode';
import type { Core } from '../../core/core';
import { parseRL } from '../../core/resourceLocation';
import { readText } from '../../core/fsUtils';
import { EXCLUDE_GLOB } from '../../core/workspaceIndex';
import { deleteEntry, fillMissing, LangEntry, parseLang, setEntries } from './langFile';
import { localeName, MC_LOCALES } from './locales';
import { collectTranslateRefs, findMissing, findUnused, humanizeId, keyForId, keyNamespace, KeyRef, stringLiterals } from './missingKeys';
import {
  applyChanges,
  cfg,
  FileChange,
  isLangFile,
  langFilesIn,
  langFolderForNamespace,
  localeOf,
  namespaceOfLangFolder,
  resolveLangFolder,
  serializeLike,
} from './host';

const SHARED = new Set(['minecraft', 'c', 'neoforge', 'forge', 'fabric', 'realms']);
const SKIP_KINDS = new Set(['lang', 'models', 'blockstates', 'textures', 'atlases', 'shaders', 'post_effect', 'particles', 'font', 'items', 'equipment', 'texts', 'waypoint_style', 'structure', 'function']);

/** Namespaces owned by the workspace (mods / packs), excluding shared ones. */
function workspaceNamespaces(core: Core): Set<string> {
  const out = new Set<string>();
  for (const p of core.projects.projects) {
    p.namespaces.forEach((n) => out.add(n));
    p.modIds.forEach((n) => out.add(n));
  }
  for (const n of core.index.namespaces()) out.add(n);
  for (const s of SHARED) out.delete(s);
  return out;
}

/** Every translation key the workspace references: registered content + JSON "translate" keys + subtitles + death messages. */
export async function collectWorkspaceRefs(core: Core, progress?: vscode.Progress<{ message?: string }>): Promise<KeyRef[]> {
  await core.index.ready;
  const refs: KeyRef[] = [];
  const own = workspaceNamespaces(core);
  const ownId = (id: string) => own.has(parseRL(id).namespace);
  progress?.report({ message: vscode.l10n.t('Scanning registries…') });
  const blocks = await core.registries.workspaceIds('block');
  const items = await core.registries.workspaceIds('item');
  for (const id of blocks) if (ownId(id)) refs.push({ key: keyForId('block', id), kind: 'block', suggestion: humanizeId(parseRL(id).path), source: vscode.l10n.t('Block {0}', id) });
  for (const id of items) {
    if (!ownId(id) || blocks.has(id)) continue;
    refs.push({ key: keyForId('item', id), kind: 'item', suggestion: humanizeId(parseRL(id).path), source: vscode.l10n.t('Item {0}', id) });
  }
  const simple: [string, 'entity' | 'effect' | 'biome' | 'creative_tab', string][] = [
    ['entity_type', 'entity', 'Entity {0}'],
    ['mob_effect', 'effect', 'Effect {0}'],
    ['worldgen/biome', 'biome', 'Biome {0}'],
    ['creative_mode_tab', 'creative_tab', 'Creative tab {0}'],
  ];
  for (const [registry, kind, label] of simple) {
    for (const id of await core.registries.workspaceIds(registry)) {
      if (ownId(id)) refs.push({ key: keyForId(kind, id), kind, suggestion: humanizeId(parseRL(id).path), source: vscode.l10n.t(label, id) });
    }
  }
  progress?.report({ message: vscode.l10n.t('Scanning JSON files…') });
  let scanned = 0;
  for (const kind of core.index.kinds()) {
    if (SKIP_KINDS.has(kind) || kind.startsWith('tags/') || (kind.startsWith('worldgen/') && kind !== 'worldgen/biome')) continue;
    for (const r of core.index.all(kind)) {
      if (r.ext !== 'json' || scanned++ > 8000) continue;
      const json = await core.index.json(r.uri);
      if (json === undefined) continue;
      refs.push(...collectTranslateRefs(json, { kind, source: vscode.workspace.asRelativePath(r.uri) }));
    }
  }
  return refs;
}

async function vanillaKeys(core: Core, uri?: vscode.Uri): Promise<Set<string>> {
  const version = core.version(uri);
  try {
    return new Set(Object.keys(await core.vanilla.lang(version, 'en_us')));
  } catch {
    return new Set(Object.keys(core.vanilla.bundledData(version).lang));
  }
}

// ---------------------------------------------------------------------------------------------

export async function addMissingTranslations(core: Core): Promise<void> {
  const uri = vscode.window.activeTextEditor?.document.uri;
  const refs = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: vscode.l10n.t('Looking for missing translations…') },
    (progress) => collectWorkspaceRefs(core, progress),
  );
  const own = workspaceNamespaces(core);
  const existing = new Set(Object.keys(await core.index.lang('en_us')));
  const missing = findMissing(refs, { existing, vanilla: await vanillaKeys(core, uri), namespaces: own });
  if (!missing.length) {
    void vscode.window.showInformationMessage(vscode.l10n.t('No missing en_us translations found.'));
    return;
  }
  missing.sort((a, b) => a.key.localeCompare(b.key));
  const picks = await vscode.window.showQuickPick(
    missing.map((m) => ({ label: m.key, description: m.suggestion, detail: m.source, picked: true, ref: m })),
    {
      canPickMany: true,
      matchOnDescription: true,
      matchOnDetail: true,
      title: vscode.l10n.t('{0} missing en_us translations — select the ones to add', missing.length),
      placeHolder: vscode.l10n.t('Generated English names can be edited afterwards in the Lang Editor'),
    },
  );
  if (!picks?.length) return;
  const fallbackNs = core.projects.defaultNamespace(uri);
  const byNs = new Map<string, Record<string, string>>();
  for (const p of picks) {
    const ns = keyNamespace(p.ref.key, own, fallbackNs);
    const rec = byNs.get(ns) ?? {};
    rec[p.ref.key] = p.ref.suggestion;
    byNs.set(ns, rec);
  }
  const changes: FileChange[] = [];
  const touched: vscode.Uri[] = [];
  for (const [ns, values] of byNs) {
    const folder = await langFolderForNamespace(core, ns, uri);
    if (!folder) continue;
    const file = vscode.Uri.joinPath(folder, 'en_us.json');
    const before = await readText(file);
    const parsed = before !== undefined ? parseLang(before) : undefined;
    if (parsed?.errors) {
      void vscode.window.showWarningMessage(vscode.l10n.t('Skipped {0}: the file has JSON syntax errors. Fix them first.', vscode.workspace.asRelativePath(file)));
      continue;
    }
    const sort = cfg('sortKeys', false, file);
    const entries = setEntries(parsed?.entries ?? [], values, { sort });
    changes.push({ uri: file, before, text: serializeLike(before, entries, sort) });
    touched.push(file);
  }
  await applyChanges(changes, { save: cfg('autoSave', true) });
  const open = vscode.l10n.t('Open Lang Editor');
  const ans = await vscode.window.showInformationMessage(vscode.l10n.t('Added {0} translations to en_us.', picks.length), open);
  if (ans === open && touched[0]) await vscode.commands.executeCommand('vscodecraft.translations.openLangEditor', touched[0]);
}

// ---------------------------------------------------------------------------------------------

export async function copyMissingToLocale(core: Core, arg?: vscode.Uri): Promise<void> {
  const folder = await resolveLangFolder(core, arg);
  if (!folder) return;
  const files = await langFilesIn(folder);
  const enUri = files.get('en_us');
  if (!enUri) {
    void vscode.window.showWarningMessage(vscode.l10n.t('{0} has no en_us.json.', vscode.workspace.asRelativePath(folder)));
    return;
  }
  const enText = (await readText(enUri)) ?? '{}';
  const base = parseLang(enText).entries;
  let locale: string | undefined = arg && isLangFile(arg) && localeOf(arg) !== 'en_us' ? localeOf(arg) : undefined;
  const loaded = new Map<string, { text: string; entries: LangEntry[]; errors: number }>();
  for (const [l, u] of files) {
    if (l === 'en_us') continue;
    const text = (await readText(u)) ?? '{}';
    const p = parseLang(text);
    loaded.set(l, { text, entries: p.entries, errors: p.errors });
  }
  if (!locale) {
    type Item = vscode.QuickPickItem & { locale?: string };
    const items: Item[] = [];
    for (const [l, f] of loaded) {
      const missing = fillMissing(f.entries, base).added.length;
      items.push({ label: l, description: localeName(l), detail: vscode.l10n.t('{0} missing keys', missing), locale: l });
    }
    items.push({ label: vscode.l10n.t('New locale'), kind: vscode.QuickPickItemKind.Separator });
    for (const [code, name] of MC_LOCALES) if (code !== 'en_us' && !loaded.has(code)) items.push({ label: code, description: name, locale: code });
    const pick = await vscode.window.showQuickPick(items, {
      placeHolder: vscode.l10n.t('Copy missing keys from en_us to which locale?'),
      matchOnDescription: true,
    });
    locale = pick?.locale;
  }
  if (!locale) return;
  const target = loaded.get(locale);
  if (target?.errors) {
    void vscode.window.showWarningMessage(vscode.l10n.t('Skipped {0}: the file has JSON syntax errors. Fix them first.', `${locale}.json`));
    return;
  }
  const marker = cfg('untranslatedMarker', '', folder);
  const sort = cfg('sortKeys', false, folder);
  const r = fillMissing(target?.entries ?? [], base, { marker, sort });
  if (!r.added.length) {
    void vscode.window.showInformationMessage(vscode.l10n.t('{0} already has every en_us key.', locale));
    return;
  }
  const file = vscode.Uri.joinPath(folder, `${locale}.json`);
  await applyChanges([{ uri: file, before: target?.text, text: serializeLike(target?.text ?? enText, r.entries, sort) }], { save: cfg('autoSave', true) });
  void vscode.window.showInformationMessage(
    marker
      ? vscode.l10n.t('Copied {0} keys to {1}, marked with "{2}".', r.added.length, locale, marker)
      : vscode.l10n.t('Copied {0} keys to {1} (English text, highlighted as untranslated in the Lang Editor).', r.added.length, locale),
  );
}

// ---------------------------------------------------------------------------------------------

export async function findUnusedKeys(core: Core, arg?: vscode.Uri): Promise<void> {
  const folder = await resolveLangFolder(core, arg);
  if (!folder) return;
  const files = await langFilesIn(folder);
  const enUri = files.get('en_us') ?? [...files.values()][0];
  if (!enUri) return;
  const keys = parseLang((await readText(enUri)) ?? '{}').entries.map((e) => e.key);
  const result = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: vscode.l10n.t('Looking for unused translation keys…'), cancellable: true },
    async (progress, token) => {
      const refs = await collectWorkspaceRefs(core, progress);
      const referenced = new Set(refs.map((r) => r.key));
      progress.report({ message: vscode.l10n.t('Scanning source files…') });
      const literals = new Set<string>();
      const sources = await vscode.workspace.findFiles('**/*.{java,kt,kts,scala,groovy,js,ts,json,json5,mcfunction,toml,snbt}', EXCLUDE_GLOB, 20000);
      for (const f of sources) {
        if (token.isCancellationRequested) return undefined;
        if (isLangFile(f)) continue;
        const text = await readText(f);
        if (text && text.length < 2_000_000) for (const s of stringLiterals(text)) literals.add(s);
      }
      return findUnused(keys, referenced, literals);
    },
  );
  if (!result) return;
  const ns = namespaceOfLangFolder(folder);
  if (!result.unused.length && !result.maybe.length) {
    void vscode.window.showInformationMessage(vscode.l10n.t('Every translation key of {0} is referenced.', ns));
    return;
  }
  core.log.info(`Unused translation keys in ${vscode.workspace.asRelativePath(folder)}:\n  ${result.unused.join('\n  ')}\nPossibly used dynamically:\n  ${result.maybe.join('\n  ')}`);
  type Item = vscode.QuickPickItem & { key?: string };
  const en = new Map(parseLang((await readText(enUri)) ?? '{}').entries.map((e) => [e.key, e.value]));
  const items: Item[] = [
    ...(result.unused.length ? [{ label: vscode.l10n.t('Unused'), kind: vscode.QuickPickItemKind.Separator } as Item] : []),
    ...result.unused.map((k) => ({ label: k, description: en.get(k), picked: true, key: k })),
    ...(result.maybe.length ? [{ label: vscode.l10n.t('Possibly built dynamically in code'), kind: vscode.QuickPickItemKind.Separator } as Item] : []),
    ...result.maybe.map((k) => ({ label: k, description: en.get(k), detail: vscode.l10n.t('Possibly built dynamically in code'), key: k })),
  ];
  const picks = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    matchOnDescription: true,
    title: vscode.l10n.t('{0} unused and {1} possibly unused keys in {2} — select keys to delete from every locale', result.unused.length, result.maybe.length, ns),
  });
  const del = picks?.map((p) => p.key).filter((k): k is string => !!k) ?? [];
  if (!del.length) return;
  const yes = vscode.l10n.t('Delete');
  const ok = await vscode.window.showWarningMessage(
    vscode.l10n.t('Delete {0} keys from every locale of {1}?', del.length, ns),
    { modal: true },
    yes,
  );
  if (ok !== yes) return;
  const changes: FileChange[] = [];
  const sort = cfg('sortKeys', false, folder);
  for (const [, u] of files) {
    const text = await readText(u);
    if (text === undefined) continue;
    const p = parseLang(text);
    if (p.errors) continue;
    let entries = p.entries;
    for (const k of del) entries = deleteEntry(entries, k);
    if (entries.length !== p.entries.length) changes.push({ uri: u, before: text, text: serializeLike(text, entries, sort) });
  }
  await applyChanges(changes, { save: cfg('autoSave', true) });
  void vscode.window.showInformationMessage(vscode.l10n.t('Deleted {0} keys from {1} files.', del.length, changes.length));
}
