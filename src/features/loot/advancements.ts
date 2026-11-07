// Advancement tree panel, single-advancement preview (toast) and the "New Advancement…" wizard.
import * as vscode from 'vscode';
import type { Core } from '../../core/core';
import type { WebviewHost } from '../../core/webviews';
import { applyJsonModifications, parseDocument } from '../../core/jsonUtils';
import { createFile, exists, jsonIndent, stringifyJson } from '../../core/fsUtils';
import { dataFolder } from '../../core/versions';
import { parseRL } from '../../core/resourceLocation';
import { AdvancementInfo, advancementLangKeys, ancestry, Frame, newAdvancementJson, readAdvancement } from './advancementModel';
import { translationKeys } from './text';

export function isAdvancementUri(uri: vscode.Uri): boolean {
  return /[\\/]data[\\/][^\\/]+[\\/]advancements?[\\/].+\.json$/i.test(uri.fsPath);
}

async function workspaceAdvancements(core: Core): Promise<AdvancementInfo[]> {
  await core.index.ready;
  const out: AdvancementInfo[] = [];
  for (const r of core.index.all('advancement')) {
    const json = await core.index.json(r.uri);
    if (json && typeof json === 'object') out.push(readAdvancement(r.id, json, 'workspace', r.uri.toString()));
  }
  return out;
}

async function vanillaAdvancements(core: Core, version: string): Promise<AdvancementInfo[]> {
  const all = await core.vanilla.advancements(version).catch(() => ({}) as Record<string, unknown>);
  return Object.entries(all).map(([id, j]) => readAdvancement(id, j, 'vanilla'));
}

/** Lang entries (vanilla + workspace) for the translation keys used by these advancements. */
async function langFor(core: Core, list: AdvancementInfo[], version: string): Promise<Record<string, string>> {
  const keys = new Set<string>();
  for (const a of list) {
    translationKeys(a.display?.title, keys);
    translationKeys(a.display?.description, keys);
  }
  const locale = core.registries.locale();
  const vanilla = await core.vanilla.lang(version, locale).catch(() => ({}) as Record<string, string>);
  const ws = { ...(await core.index.lang('en_us')), ...(locale !== 'en_us' ? await core.index.lang(locale) : {}) };
  const out: Record<string, string> = {};
  for (const k of keys) {
    const v = ws[k] ?? vanilla[k];
    if (v !== undefined) out[k] = v;
  }
  return out;
}

async function openAdvancement(core: Core, a: { id: string; uri?: string }, version: string): Promise<void> {
  if (a.uri) {
    await vscode.window.showTextDocument(vscode.Uri.parse(a.uri), { viewColumn: vscode.ViewColumn.Beside });
    return;
  }
  const json = (await core.vanilla.advancements(version))[a.id];
  if (!json) return;
  const doc = await vscode.workspace.openTextDocument({ language: 'json', content: stringifyJson(json, jsonIndent()) });
  await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preview: true });
}

let treePanel: { panel: vscode.WebviewPanel; host: WebviewHost } | undefined;

/** Advancement tree of the workspace (+ vanilla optionally). */
export function showAdvancementTree(core: Core): void {
  if (treePanel) {
    treePanel.panel.reveal();
    return;
  }
  const version = core.version();
  const created = core.webviews.createPanel({
    viewType: 'vscodecraft.loot.advancements',
    title: vscode.l10n.t('Advancements'),
    bundle: 'advancements',
    state: { mode: 'tree', version },
  });
  treePanel = created;
  const { panel, host } = created;
  host.handle('adv.load', async (p: { includeVanilla?: boolean }) => {
    const v = core.version();
    const list = await workspaceAdvancements(core);
    if (p?.includeVanilla) {
      const ids = new Set(list.map((a) => a.id));
      for (const a of await vanillaAdvancements(core, v)) if (!ids.has(a.id)) list.push(a);
    }
    return { version: v, advancements: list, lang: await langFor(core, list, v) };
  });
  host.handle('adv.open', (p: { id: string; uri?: string }) => openAdvancement(core, p, core.version()));
  host.handle('adv.new', (p: { parent?: string }) => newAdvancementCommand(core, p?.parent));
  let timer: NodeJS.Timeout | undefined;
  const refresh = () => {
    clearTimeout(timer);
    timer = setTimeout(() => void host.post('adv.changed'), 400);
  };
  const subs = [
    core.index.onDidChange(refresh),
    core.index.onDidChangeContent((u) => {
      if (isAdvancementUri(u) || u.path.includes('/lang/')) refresh();
    }),
  ];
  panel.onDidDispose(() => {
    subs.forEach((s) => s.dispose());
    treePanel = undefined;
  });
}

const previews = new Map<string, vscode.WebviewPanel>();

/** Preview of one advancement file: toast, frame, criteria, rewards and its parent chain. */
export async function showAdvancementPreview(core: Core, uri: vscode.Uri): Promise<void> {
  const existing = previews.get(uri.toString());
  if (existing) {
    existing.reveal(vscode.ViewColumn.Beside, true);
    return;
  }
  const doc = await vscode.workspace.openTextDocument(uri);
  const id = core.index.info(uri)?.id ?? 'unknown:advancement';
  const { panel, host } = core.webviews.createPanel({
    viewType: 'vscodecraft.loot.advancementPreview',
    title: vscode.l10n.t('Advancement: {0}', id.split(/[:/]/).pop() ?? id),
    bundle: 'advancements',
    documentUri: uri,
    state: { mode: 'single', version: core.version(uri), id },
    column: { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
  });
  previews.set(uri.toString(), panel);
  const load = async () => {
    const v = core.version(uri);
    let json: unknown = {};
    try {
      json = parseDocument(doc) ?? {};
    } catch {
      /* keep empty */
    }
    const self = readAdvancement(id, json, 'workspace', uri.toString());
    const all = [...(await workspaceAdvancements(core)).filter((a) => a.id !== id), self];
    // parents may be vanilla advancements
    const known = new Set(all.map((a) => a.id));
    let parent = self.parent;
    let vanilla: Record<string, unknown> | undefined;
    while (parent && !known.has(parent)) {
      vanilla ??= await core.vanilla.advancements(v).catch(() => ({}));
      const pj = vanilla[parent];
      if (!pj) break;
      const pa = readAdvancement(parent, pj, 'vanilla');
      all.push(pa);
      known.add(parent);
      parent = pa.parent;
    }
    const chainIds = ancestry(id, all);
    const chain = chainIds.map((c) => all.find((a) => a.id === c)!).filter(Boolean);
    const children = all.filter((a) => a.parent === id);
    return { version: v, advancement: self, chain, children, lang: await langFor(core, [...chain, ...children], v) };
  };
  host.handle('adv.single', load);
  host.handle('adv.open', (p: { id: string; uri?: string }) => openAdvancement(core, p, core.version(uri)));
  host.handle('adv.new', (p: { parent?: string }) => newAdvancementCommand(core, p?.parent));
  let timer: NodeJS.Timeout | undefined;
  const sub = vscode.workspace.onDidChangeTextDocument((e) => {
    if (e.document !== doc) return;
    clearTimeout(timer);
    timer = setTimeout(() => void load().then((d) => host.post('adv.update', d)), 200);
  });
  panel.onDidDispose(() => {
    previews.delete(uri.toString());
    sub.dispose();
  });
}

// ---------------------------------------------------------------------------------------------
// Wizard
// ---------------------------------------------------------------------------------------------

type QPick<T> = vscode.QuickPickItem & { value: T };

/** "New Advancement…" wizard. */
export async function newAdvancementCommand(core: Core, presetParent?: string): Promise<void> {
  const root = core.projects.resourceRoot();
  if (!root) {
    void vscode.window.showWarningMessage(vscode.l10n.t('No Minecraft project found in this workspace.'));
    return;
  }
  const version = core.version(root);
  const ns = core.projects.defaultNamespace(root);
  const steps = 7;
  const title = (n: number) => `${vscode.l10n.t('New Advancement')} (${n}/${steps})`;

  // 1. parent
  let parent = presetParent;
  if (parent === undefined) {
    const ws = await workspaceAdvancements(core);
    const vanilla = (await vanillaAdvancements(core, version)).filter((a) => a.display && !a.id.includes('recipes/'));
    const items: QPick<string | null>[] = [
      { label: `$(add) ${vscode.l10n.t('None — create a new tab (root advancement)')}`, value: null },
      { label: vscode.l10n.t('Workspace'), kind: vscode.QuickPickItemKind.Separator, value: null },
      ...ws.map((a) => ({ label: a.id, description: a.display ? '' : vscode.l10n.t('(no display)'), value: a.id })),
      { label: 'Minecraft', kind: vscode.QuickPickItemKind.Separator, value: null },
      ...vanilla.map((a) => ({ label: a.id, value: a.id })),
    ];
    const pick = await vscode.window.showQuickPick(items, { title: title(1), placeHolder: vscode.l10n.t('Parent advancement'), matchOnDescription: true });
    if (!pick) return;
    parent = pick.value ?? '';
  }

  // 2. id
  const parentPath = parent ? parseRL(parent).path : '';
  const folder = parentPath.includes('/') ? parentPath.slice(0, parentPath.lastIndexOf('/') + 1) : parent ? '' : 'root';
  const idInput = await vscode.window.showInputBox({
    title: title(2),
    prompt: vscode.l10n.t('Advancement id (namespace:path)'),
    value: parent ? `${ns}:${folder}new_advancement` : `${ns}:root`,
    validateInput: (v) => (/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(v.trim()) ? undefined : vscode.l10n.t('Use namespace:path with lowercase letters, digits, _ - . /')),
  });
  if (!idInput) return;
  const id = idInput.trim();

  // 3. icon
  const entries = await core.registries.entries('item', root);
  const iconPick = await vscode.window.showQuickPick(
    entries.map((e) => ({ label: e.name ?? e.id, description: e.id, value: e.id })),
    { title: title(3), placeHolder: vscode.l10n.t('Icon item'), matchOnDescription: true },
  );
  if (!iconPick) return;

  // 4. title & description
  const titleText = await vscode.window.showInputBox({ title: title(4), prompt: vscode.l10n.t('Title'), value: humanTitle(id) });
  if (titleText === undefined) return;
  const description = await vscode.window.showInputBox({ title: title(4), prompt: vscode.l10n.t('Description') });
  if (description === undefined) return;
  const langChoice = await vscode.window.showQuickPick(
    [
      { label: vscode.l10n.t('Use translation keys (adds them to en_us.json)'), value: true },
      { label: vscode.l10n.t('Use literal text'), value: false },
    ],
    { title: title(4), placeHolder: vscode.l10n.t('How should the title and description be stored?') },
  );
  if (!langChoice) return;

  // 5. frame
  const frame = await vscode.window.showQuickPick<QPick<Frame>>(
    [
      { label: `$(primitive-square) ${vscode.l10n.t('Task')}`, description: vscode.l10n.t('Normal advancement'), value: 'task' },
      { label: `$(circle-large-outline) ${vscode.l10n.t('Goal')}`, description: vscode.l10n.t('Rounded frame, "Goal reached!"'), value: 'goal' },
      { label: `$(star-empty) ${vscode.l10n.t('Challenge')}`, description: vscode.l10n.t('Spiky purple frame, "Challenge complete!"'), value: 'challenge' },
    ],
    { title: title(5), placeHolder: vscode.l10n.t('Frame') },
  );
  if (!frame) return;

  // 6. trigger
  const triggers = await core.vanilla.registry(version, 'trigger_type').catch(() => [] as string[]);
  const common = ['minecraft:inventory_changed', 'minecraft:impossible', 'minecraft:tick', 'minecraft:player_killed_entity', 'minecraft:consume_item', 'minecraft:placed_block', 'minecraft:recipe_crafted', 'minecraft:location'];
  const triggerList = [...new Set([...common.filter((t) => !triggers.length || triggers.includes(t)), ...triggers])];
  const trigger = await vscode.window.showQuickPick(
    triggerList.map((t) => ({ label: t.replace(/^minecraft:/, ''), description: common.includes(t) ? vscode.l10n.t('common') : '', value: t })),
    { title: title(6), placeHolder: vscode.l10n.t('Criterion trigger') },
  );
  if (!trigger) return;

  // 7. rewards
  const rewardKinds = await vscode.window.showQuickPick(
    [
      { label: vscode.l10n.t('Experience'), value: 'xp' },
      { label: vscode.l10n.t('Recipes'), value: 'recipes' },
      { label: vscode.l10n.t('Loot tables'), value: 'loot' },
      { label: vscode.l10n.t('Function'), value: 'function' },
    ],
    { title: title(7), placeHolder: vscode.l10n.t('Rewards (optional, press Enter to skip)'), canPickMany: true },
  );
  if (!rewardKinds) return;
  const rewards: { experience?: number; recipes?: string[]; loot?: string[]; function?: string } = {};
  for (const k of rewardKinds.map((r) => r.value)) {
    if (k === 'xp') {
      const v = await vscode.window.showInputBox({ title: title(7), prompt: vscode.l10n.t('Experience points'), value: '10', validateInput: (s) => (/^\d+$/.test(s) ? undefined : vscode.l10n.t('Enter a whole number')) });
      if (v) rewards.experience = Number(v);
    } else if (k === 'recipes') {
      const ids = await pickIds(core, 'recipe', version, vscode.l10n.t('Recipes to unlock'));
      if (ids.length) rewards.recipes = ids;
    } else if (k === 'loot') {
      const ids = await pickIds(core, 'loot_table', version, vscode.l10n.t('Loot tables to give'));
      if (ids.length) rewards.loot = ids;
    } else if (k === 'function') {
      const fns = core.index.ids('function');
      const f = await vscode.window.showQuickPick(fns.length ? fns : [`${ns}:reward`], { title: title(7), placeHolder: vscode.l10n.t('Function to run') });
      if (f) rewards.function = f;
    }
  }

  const keys = advancementLangKeys(id);
  const json = newAdvancementJson({
    id,
    parent: parent || undefined,
    icon: iconPick.value,
    title: titleText,
    description,
    titleKey: langChoice.value ? keys.title : undefined,
    descriptionKey: langChoice.value ? keys.description : undefined,
    frame: frame.value,
    trigger: trigger.value,
    rewards,
    version,
  });
  const rl = parseRL(id);
  const target = vscode.Uri.joinPath(root, 'data', rl.namespace, dataFolder('advancement', version), `${rl.path}.json`);
  if (!(await createFile(target, stringifyJson(json, jsonIndent())))) return;
  if (langChoice.value) await addLangEntries(core, root, rl.namespace, { [keys.title]: titleText, [keys.description]: description });
  await vscode.window.showTextDocument(target);
  await showAdvancementPreview(core, target);
}

function humanTitle(id: string): string {
  const last = id.split(/[:/]/).pop() ?? id;
  return last
    .split('_')
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}

async function pickIds(core: Core, kind: 'recipe' | 'loot_table', version: string, placeHolder: string): Promise<string[]> {
  const ws = core.index.ids(kind);
  const vanilla = Object.keys(
    await (kind === 'recipe' ? core.vanilla.recipes(version) : core.vanilla.lootTables(version)).catch(() => ({}) as Record<string, unknown>),
  );
  const items = [...ws.map((id) => ({ label: id, picked: false })), ...vanilla.filter((v) => !ws.includes(v)).map((id) => ({ label: id }))];
  const picks = await vscode.window.showQuickPick(items, { placeHolder, canPickMany: true });
  return picks?.map((p) => p.label) ?? [];
}

/** Add keys to assets/<ns>/lang/en_us.json (created when missing). */
export async function addLangEntries(core: Core, root: vscode.Uri, namespace: string, entries: Record<string, string>): Promise<void> {
  const existing = core.index.get('lang', `${namespace}:en_us`).find((r) => r.root === root.fsPath.replace(/\\/g, '/')) ?? core.index.get('lang', `${namespace}:en_us`)[0];
  const uri = existing?.uri ?? vscode.Uri.joinPath(root, 'assets', namespace, 'lang', 'en_us.json');
  if (!(await exists(uri))) {
    await createFile(uri, stringifyJson(entries, jsonIndent()), false);
    return;
  }
  const doc = await vscode.workspace.openTextDocument(uri);
  await applyJsonModifications(
    doc,
    Object.entries(entries).map(([k, v]) => ({ path: [k], value: v })),
  );
  await doc.save();
}

