// Give / Item Builder panel host: registries, lang, default components, copy & insert.
import * as vscode from 'vscode';
import type { Core } from '../../core/core';
import type { WebviewHost } from '../../core/webviews';
import { compareVersions, getVersions } from '../../core/versions';

const LANG_PREFIXES = [
  'enchantment.',
  'attribute.',
  'effect.',
  'item.modifiers.',
  'item.unbreakable',
  'item.durability',
  'item.dyed',
  'item.color',
  'item.components',
  'potion.',
  'trim_material.',
  'trim_pattern.',
  'item.minecraft.smithing_template.upgrade',
];

export const GIVE_REGISTRIES = ['enchantment', 'attribute', 'mob_effect', 'potion', 'trim_material', 'trim_pattern'] as const;

let lastEditor: vscode.TextEditor | undefined;
let panelRef: { panel: vscode.WebviewPanel; host: WebviewHost } | undefined;

export function trackEditors(core: Core): void {
  lastEditor = vscode.window.activeTextEditor;
  core.track(
    vscode.window.onDidChangeActiveTextEditor((e) => {
      if (e && e.document.uri.scheme !== 'output') lastEditor = e;
    }),
  );
}

/** Open (or reveal) the item builder, optionally starting from an item id. */
export function showGiveBuilder(core: Core, item?: string): void {
  if (panelRef) {
    panelRef.panel.reveal();
    if (item) void panelRef.host.post('give.setItem', item);
    return;
  }
  const uri = lastEditor?.document.uri;
  const version = core.version(uri);
  const versions = getVersions(false)
    .map((v) => v.id)
    .filter((v) => compareVersions(v, '1.20.5') >= 0);
  if (!versions.includes(version)) versions.unshift(version);
  const created = core.webviews.createPanel({
    viewType: 'vscodecraft.loot.give',
    title: vscode.l10n.t('Item Builder'),
    bundle: 'give',
    documentUri: uri,
    state: { version, versions, namespace: core.projects.defaultNamespace(uri), item: item ?? 'minecraft:diamond_sword' },
  });
  panelRef = created;
  const { panel, host } = created;
  host.handle('give.data', async (p: { version: string }) => {
    const v = p?.version || version;
    const registries: Record<string, string[]> = {};
    for (const r of GIVE_REGISTRIES) {
      const ids = new Set(await core.vanilla.registry(v, r).catch(() => [] as string[]));
      for (const id of await core.registries.workspaceIds(r).catch(() => new Set<string>())) ids.add(id);
      registries[r] = [...ids].sort();
    }
    const locale = core.registries.locale();
    const vanilla = await core.vanilla.lang(v, locale).catch(() => ({}) as Record<string, string>);
    const ws = { ...(await core.index.lang('en_us')), ...(locale !== 'en_us' ? await core.index.lang(locale) : {}) };
    const lang: Record<string, string> = {};
    for (const src of [vanilla, ws])
      for (const [k, val] of Object.entries(src)) if (LANG_PREFIXES.some((pre) => k.startsWith(pre))) lang[k] = val;
    return { registries, lang };
  });
  host.handle('give.defaults', async (p: { id: string; version: string }) => {
    const all = await core.vanilla.itemComponents(p.version || version).catch(() => ({}) as Record<string, unknown>);
    return all[p.id] ?? {};
  });
  host.handle('give.copy', async (p: { text: string }) => {
    await vscode.env.clipboard.writeText(p.text);
    void vscode.window.setStatusBarMessage(vscode.l10n.t('Copied to the clipboard'), 2500);
  });
  host.handle('give.insert', async (p: { text: string }) => {
    const ed = lastEditor && vscode.window.visibleTextEditors.includes(lastEditor) ? lastEditor : undefined;
    if (!ed) {
      const doc = await vscode.workspace.openTextDocument({ content: p.text, language: p.text.startsWith('/') ? 'mcfunction' : 'json' });
      await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
      return;
    }
    // In .mcfunction files commands are written without the leading slash.
    const text = ed.document.uri.path.endsWith('.mcfunction') ? p.text.replace(/^\//, '') : p.text;
    await ed.edit((b) => ed.selections.forEach((s) => b.replace(s, text)));
    await vscode.window.showTextDocument(ed.document, ed.viewColumn);
  });
  panel.onDidDispose(() => (panelRef = undefined));
}
