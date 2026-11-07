// Tag tools: Tag Viewer/Editor (custom text editor + command), "Add to Tag…", "Create Tag…", "Find Tag Usages".
import * as vscode from 'vscode';
import type { Core } from '../../core/core';
import { exists } from '../../core/fsUtils';
import { jsonc, locationAt, nodeAt } from '../../core/jsonUtils';
import { normalizeId, parseRL, tagRegistry, isValidRL } from '../../core/resourceLocation';
import type { WebviewHost } from '../../core/webviews';
import {
  addEntry,
  COMMON_TAGS,
  entryId,
  entryRequired,
  moveEntry,
  parseTag,
  removeEntry,
  serializeTag,
  setRequired,
  TAG_REGISTRIES,
  tagFilePath,
  TagJson,
} from './tagUtils';
import { indentOf, t } from './util';

export const TAG_EDITOR_VIEW = 'vscodecraft.datapack.tagEditor';

/** Messages sent to the webview. */
export interface TagEditorData {
  uri: string;
  tagId: string;
  registry: string;
  version: string;
  replace: boolean;
  parseError: boolean;
  values: { id: string; required: boolean; isTag: boolean; known: boolean }[];
  vanilla: { exists: boolean; count: number; values: string[] };
  /** 'extends' (vanilla tag + replace false), 'overrides' (vanilla tag + replace true), 'new'. */
  relation: 'extends' | 'overrides' | 'new';
  resolvedCount: number;
  otherFiles: string[];
  usedBy: { tag: string; source: 'vanilla' | 'workspace'; uri?: string }[];
  referencedIn: { uri: string; label: string }[];
  iconRegistry: boolean;
}

function tagInfo(core: Core, uri: vscode.Uri): { registry: string; id: string } | undefined {
  const info = core.index.info(uri);
  const reg = info ? tagRegistry(info.kind) : undefined;
  return info && reg ? { registry: reg, id: info.id } : undefined;
}

/** Direct values of a tag: vanilla + every workspace file (honouring replace). */
async function directValues(core: Core, registry: string, id: string, uri?: vscode.Uri): Promise<string[]> {
  const version = core.version(uri);
  const vanilla = await core.vanilla.tags(version, registry).catch(() => ({}) as Record<string, string[]>);
  const ws = await core.index.tagValues(registry, id);
  const out = ws?.replace ? [] : [...(vanilla[id] ?? [])];
  if (ws) out.push(...ws.values);
  return [...new Set(out)];
}

/** Tags (vanilla + workspace) that reference "#id" directly. */
async function usedBy(core: Core, registry: string, id: string, uri?: vscode.Uri): Promise<TagEditorData['usedBy']> {
  const out: TagEditorData['usedBy'] = [];
  const ref = `#${id}`;
  const version = core.version(uri);
  const vanilla = await core.vanilla.tags(version, registry).catch(() => ({}) as Record<string, string[]>);
  for (const [tag, values] of Object.entries(vanilla)) if (values.some((v) => normalizeId(v) === ref)) out.push({ tag, source: 'vanilla' });
  for (const r of core.index.all(`tags/${registry}`)) {
    const j = parseTag(await core.index.json(r.uri));
    if (j.values.some((v) => normalizeId(entryId(v)) === ref) && !out.some((o) => o.tag === r.id && o.uri === r.uri.toString())) {
      out.push({ tag: r.id, source: 'workspace', uri: r.uri.toString() });
    }
  }
  return out;
}

/** Non-tag JSON files referencing "#id" (recipes, loot tables, advancements, enchantments...). */
async function referencedIn(core: Core, id: string, limit = 60): Promise<TagEditorData['referencedIn']> {
  const out: TagEditorData['referencedIn'] = [];
  const needles = [`"#${id}"`];
  if (id.startsWith('minecraft:')) needles.push(`"#${id.slice(10)}"`);
  for (const kind of core.index.kinds()) {
    if (kind.startsWith('tags/') || kind === 'textures' || kind === 'lang' || kind === 'sounds') continue;
    for (const r of core.index.all(kind)) {
      if (r.ext !== 'json') continue;
      const j = await core.index.json(r.uri);
      if (j === undefined) continue;
      const s = JSON.stringify(j);
      if (needles.some((n) => s.includes(n))) out.push({ uri: r.uri.toString(), label: `${kind} ${r.id}` });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

async function buildData(core: Core, doc: vscode.TextDocument): Promise<TagEditorData> {
  const info = tagInfo(core, doc.uri) ?? { registry: 'item', id: 'unknown:unknown' };
  const errors: jsonc.ParseError[] = [];
  const raw = jsonc.parse(doc.getText(), errors, { allowTrailingComma: true });
  const tag = parseTag(raw);
  const version = core.version(doc.uri);
  const vanillaTags = await core.vanilla.tags(version, info.registry).catch(() => ({}) as Record<string, string[]>);
  const vanillaValues = vanillaTags[info.id];
  const known = await core.registries.ids(info.registry, doc.uri).catch(() => new Set<string>());
  const knownTags = await core.registries.ids(`tag/${info.registry}`, doc.uri).catch(() => new Set<string>());
  const resolved = await core.registries.expandTag(info.id, info.registry, doc.uri).catch(() => [] as string[]);
  const others = core.index.get(`tags/${info.registry}`, info.id).filter((r) => r.uri.toString() !== doc.uri.toString());
  return {
    uri: doc.uri.toString(),
    tagId: info.id,
    registry: info.registry,
    version,
    replace: tag.replace === true,
    parseError: errors.length > 0,
    values: tag.values.map((v) => {
      const id = entryId(v);
      const isTag = id.startsWith('#');
      const nid = normalizeId(id.replace(/^#/, ''));
      return { id, required: entryRequired(v), isTag, known: isTag ? knownTags.has(nid) || nid.startsWith('c:') : known.has(nid) };
    }),
    vanilla: { exists: !!vanillaValues, count: vanillaValues?.length ?? 0, values: vanillaValues ?? [] },
    relation: vanillaValues ? (tag.replace ? 'overrides' : 'extends') : 'new',
    resolvedCount: resolved.length,
    otherFiles: others.map((o) => vscode.workspace.asRelativePath(o.uri)),
    usedBy: await usedBy(core, info.registry, info.id, doc.uri),
    referencedIn: await referencedIn(core, info.id),
    iconRegistry: info.registry === 'item' || info.registry === 'block',
  };
}

async function applyTag(doc: vscode.TextDocument, tag: TagJson): Promise<boolean> {
  const text = serializeTag(tag, indentOf(doc.getText()));
  if (text === doc.getText()) return true;
  const edit = new vscode.WorkspaceEdit();
  edit.replace(doc.uri, new vscode.Range(0, 0, doc.lineCount, 0), text);
  return vscode.workspace.applyEdit(edit);
}

function handlers(core: Core, doc: vscode.TextDocument) {
  return {
    'tag.load': () => buildData(core, doc),
    'tag.children': async (p: { tag: string }) => {
      const info = tagInfo(core, doc.uri);
      const reg = info?.registry ?? 'item';
      const id = normalizeId(p.tag.replace(/^#/, ''));
      const values = await directValues(core, reg, id, doc.uri);
      const ws = core.index.get(`tags/${reg}`, id)[0];
      return { values, uri: ws?.uri.toString() };
    },
    'tag.edit': async (p: { op: 'add' | 'remove' | 'required' | 'replace' | 'move'; id?: string; value?: boolean; delta?: number }) => {
      let tag = parseTag(jsonc.parse(doc.getText(), [], { allowTrailingComma: true }));
      const id = p.id ?? '';
      switch (p.op) {
        case 'add':
          tag = addEntry(tag, id.startsWith('#') ? `#${normalizeId(id.slice(1))}` : normalizeId(id), p.value !== false);
          break;
        case 'remove':
          tag = removeEntry(tag, id);
          break;
        case 'required':
          tag = setRequired(tag, id, p.value !== false);
          break;
        case 'replace':
          tag = { ...tag, replace: p.value === true };
          break;
        case 'move':
          tag = moveEntry(tag, id, p.delta ?? 0);
          break;
      }
      await applyTag(doc, tag);
      return buildData(core, doc);
    },
    'tag.openTag': async (p: { tag: string }) => {
      const info = tagInfo(core, doc.uri);
      const reg = info?.registry ?? 'item';
      const id = normalizeId(p.tag.replace(/^#/, ''));
      const ws = core.index.get(`tags/${reg}`, id)[0];
      if (ws) await vscode.commands.executeCommand('vscode.openWith', ws.uri, TAG_EDITOR_VIEW);
      else void vscode.window.showInformationMessage(t('#{0} is a vanilla tag (not in this workspace).', id));
    },
    'tag.openText': () => vscode.commands.executeCommand('vscode.openWith', doc.uri, 'default'),
    'tag.save': () => doc.save(),
  };
}

function attachEditor(core: Core, webview: vscode.Webview, doc: vscode.TextDocument): { host: WebviewHost; dispose: () => void } {
  const host = core.webviews.attach(webview, {
    bundle: 'tagEditor',
    title: 'Tag',
    documentUri: doc.uri,
    state: { uri: doc.uri.toString() },
    handlers: handlers(core, doc),
  });
  let timer: NodeJS.Timeout | undefined;
  const push = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => host.post('tag.data', await buildData(core, doc)), 150);
  };
  const subs = [
    vscode.workspace.onDidChangeTextDocument((e) => e.document.uri.toString() === doc.uri.toString() && push()),
    core.index.onDidChange(push),
  ];
  return {
    host,
    dispose: () => {
      clearTimeout(timer);
      subs.forEach((s) => s.dispose());
      host.dispose();
    },
  };
}

/** QuickPick of tags for a registry (vanilla + workspace + c: conventions), with "create" for typed ids. */
async function pickTag(core: Core, registries: string[], uri: vscode.Uri | undefined, title: string): Promise<{ registry: string; id: string } | undefined> {
  type Item = vscode.QuickPickItem & { registry?: string; id?: string };
  const items: Item[] = [];
  const ns = core.projects.defaultNamespace(uri);
  for (const reg of registries) {
    const ids = new Set<string>();
    const ws = await core.registries.workspaceIds(`tag/${reg}`);
    const all = await core.registries.ids(`tag/${reg}`, uri).catch(() => new Set<string>());
    const conv = COMMON_TAGS[reg] ?? [];
    if (registries.length > 1) items.push({ label: reg, kind: vscode.QuickPickItemKind.Separator });
    for (const id of [...ws].sort()) {
      ids.add(id);
      items.push({ label: `#${id}`, description: `${reg} · ${t('workspace')}`, registry: reg, id });
    }
    for (const id of conv) {
      if (ids.has(id)) continue;
      ids.add(id);
      items.push({ label: `#${id}`, description: `${reg} · ${t('convention (c:)')}`, registry: reg, id });
    }
    for (const id of [...all].sort()) {
      if (ids.has(id)) continue;
      ids.add(id);
      items.push({ label: `#${id}`, description: `${reg} · vanilla`, registry: reg, id });
    }
  }
  const qp = vscode.window.createQuickPick<Item>();
  qp.title = title;
  qp.placeholder = t('Search a tag, or type a new id (e.g. {0}:my_tag)', ns);
  qp.matchOnDescription = true;
  qp.items = items;
  qp.onDidChangeValue((v) => {
    const typed = v.trim().replace(/^#/, '');
    const extra: Item[] = [];
    if (typed && isValidRL(typed) && !items.some((i) => i.id === normalizeId(typed, ns))) {
      for (const reg of registries) extra.push({ label: `$(add) #${normalizeId(typed, ns)}`, description: t('new {0} tag', reg), registry: reg, id: normalizeId(typed, ns), alwaysShow: true });
    }
    qp.items = [...extra, ...items];
  });
  const res = await new Promise<Item | undefined>((resolve) => {
    qp.onDidAccept(() => resolve(qp.selectedItems[0]));
    qp.onDidHide(() => resolve(undefined));
    qp.show();
  });
  qp.dispose();
  return res?.id && res.registry ? { registry: res.registry, id: res.id } : undefined;
}

/** Workspace file for a tag inside the project of `uri` (or where to create it). */
async function tagFileFor(core: Core, registry: string, id: string, uri?: vscode.Uri): Promise<{ file: vscode.Uri; exists: boolean } | undefined> {
  const root = core.projects.resourceRoot(uri);
  const project = core.projects.projectFor(uri);
  const files = core.index.get(`tags/${registry}`, id);
  const inProject = files.find((f) => project?.resourceRoots.some((r) => f.root === r.fsPath.replace(/\\/g, '/'))) ?? (project ? undefined : files[0]);
  if (inProject) return { file: inProject.uri, exists: true };
  if (!root) return undefined;
  const file = vscode.Uri.joinPath(root, tagFilePath(registry, id, core.version(uri)));
  return { file, exists: await exists(file) };
}

/** Item / block id under the cursor in a JSON document. */
function idUnderCursor(editor: vscode.TextEditor | undefined): string | undefined {
  if (!editor || !['json', 'jsonc'].includes(editor.document.languageId)) return undefined;
  const node = nodeAt(editor.document, editor.selection.active);
  if (node?.type === 'string' && typeof node.value === 'string' && isValidRL(node.value)) return node.value;
  const loc = locationAt(editor.document, editor.selection.active);
  return typeof loc.previousNode?.value === 'string' && isValidRL(loc.previousNode.value) ? loc.previousNode.value : undefined;
}

export function registerTags(core: Core): void {
  // ---------- custom editor
  core.track(
    vscode.window.registerCustomEditorProvider(
      TAG_EDITOR_VIEW,
      {
        resolveCustomTextEditor: async (doc, panel) => {
          const { dispose } = attachEditor(core, panel.webview, doc);
          panel.onDidDispose(dispose);
        },
      },
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
  );

  core.registerCommand('vscodecraft.datapack.openTagEditor', async (uri?: vscode.Uri) => {
    const target = uri ?? vscode.window.activeTextEditor?.document.uri;
    if (target && tagInfo(core, target)) {
      await vscode.commands.executeCommand('vscode.openWith', target, TAG_EDITOR_VIEW);
      return;
    }
    const picked = await pickTag(core, [...TAG_REGISTRIES], target, t('Open tag'));
    if (!picked) return;
    const f = await tagFileFor(core, picked.registry, picked.id, target);
    if (!f) return;
    if (!f.exists) await vscode.workspace.fs.writeFile(f.file, new TextEncoder().encode(serializeTag({ values: [] })));
    await vscode.commands.executeCommand('vscode.openWith', f.file, TAG_EDITOR_VIEW);
  });

  core.registerCommand('vscodecraft.datapack.createTag', async (uri?: vscode.Uri) => {
    const regPick = await vscode.window.showQuickPick(
      TAG_REGISTRIES.map((r) => ({ label: r })),
      { placeHolder: t('Registry of the new tag') },
    );
    if (!regPick) return;
    const ns = core.projects.defaultNamespace(uri);
    const id = await vscode.window.showInputBox({
      prompt: t('Tag id (namespace:path). Use minecraft:... to add to a vanilla tag, c:... for convention tags.'),
      value: `${ns}:`,
      valueSelection: [ns.length + 1, ns.length + 1],
      validateInput: (v) => (isValidRL(v.replace(/^#/, '')) && parseRL(v).path ? undefined : t('Lowercase letters, digits, "_", "-", ".", "/" only.')),
    });
    if (!id) return;
    const f = await tagFileFor(core, regPick.label, normalizeId(id.replace(/^#/, ''), ns), uri);
    if (!f) return;
    if (!f.exists) await vscode.workspace.fs.writeFile(f.file, new TextEncoder().encode(serializeTag({ values: [] })));
    await vscode.commands.executeCommand('vscode.openWith', f.file, TAG_EDITOR_VIEW);
  });

  core.registerCommand('vscodecraft.datapack.addToTag', async (arg?: unknown) => {
    const editor = vscode.window.activeTextEditor;
    const ctxUri = arg instanceof vscode.Uri ? arg : editor?.document.uri;
    let id = typeof arg === 'string' ? arg : idUnderCursor(editor);
    // A file from the explorer: use the resource it defines (item model, blockstate, loot table...)
    if (!id && arg instanceof vscode.Uri) {
      const info = core.index.info(arg);
      if (info) id = info.kind === 'models' ? `${info.namespace}:${info.path.replace(/^(item|block)\//, '')}` : info.id;
    }
    if (!id) {
      const all = await core.registries.entries('item', ctxUri);
      const pick = await vscode.window.showQuickPick(
        [...all.filter((e) => e.source === 'workspace'), ...all.filter((e) => e.source === 'vanilla')].map((e) => ({ label: e.name ?? e.id, description: e.id, id: e.id })),
        { placeHolder: t('Item / block to add to a tag'), matchOnDescription: true },
      );
      if (!pick) return;
      id = pick.id;
    }
    const nid = id.startsWith('#') ? id : normalizeId(id);
    // Registries this id can belong to
    const candidates: string[] = [];
    for (const reg of ['item', 'block', 'entity_type', 'fluid', 'enchantment', 'worldgen/biome', 'damage_type', 'function']) {
      if (nid.startsWith('#')) {
        if ((await core.registries.ids(`tag/${reg}`, ctxUri).catch(() => new Set<string>())).has(nid.slice(1))) candidates.push(reg);
      } else if ((await core.registries.ids(reg, ctxUri).catch(() => new Set<string>())).has(nid)) candidates.push(reg);
    }
    const editorTag = editor ? tagInfo(core, editor.document.uri) : undefined;
    if (editorTag && !candidates.includes(editorTag.registry)) candidates.unshift(editorTag.registry);
    if (!candidates.length) candidates.push('item', 'block');
    const target = await pickTag(core, candidates, ctxUri, t('Add {0} to tag…', nid));
    if (!target) return;
    const f = await tagFileFor(core, target.registry, target.id, ctxUri);
    if (!f) {
      void vscode.window.showErrorMessage(t('No resource folder found to create the tag in.'));
      return;
    }
    const existing = f.exists ? parseTag(jsonc.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(f.file)), [], { allowTrailingComma: true })) : { values: [] };
    if (existing.values.some((v) => entryId(v) === nid)) {
      void vscode.window.showInformationMessage(t('{0} is already in #{1}.', nid, target.id));
      return;
    }
    // Entries from other mods are optional so the tag still loads when that mod is missing.
    const project = core.projects.projectFor(ctxUri);
    const ns = parseRL(nid.replace(/^#/, '')).namespace;
    const required = ns === 'minecraft' || !!project?.namespaces.includes(ns) || !!project?.modIds.includes(ns) || ns === core.projects.defaultNamespace(ctxUri);
    const updated = addEntry(existing, nid, required);
    const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === f.file.toString());
    if (doc) await applyTag(doc, updated).then(() => doc.save());
    else {
      await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(f.file, '..'));
      await vscode.workspace.fs.writeFile(f.file, new TextEncoder().encode(serializeTag(updated)));
    }
    const open = t('Open tag');
    const res = await vscode.window.showInformationMessage(
      f.exists ? t('Added {0} to #{1}.', nid, target.id) : t('Created {0} with {1}.', vscode.workspace.asRelativePath(f.file), nid),
      open,
    );
    if (res === open) await vscode.commands.executeCommand('vscode.openWith', f.file, TAG_EDITOR_VIEW);
  });

  core.registerCommand('vscodecraft.datapack.findTagUsages', async (uri?: vscode.Uri) => {
    const target = uri ?? vscode.window.activeTextEditor?.document.uri;
    let info = target ? tagInfo(core, target) : undefined;
    if (!info) {
      const picked = await pickTag(core, [...TAG_REGISTRIES], target, t('Find usages of tag'));
      if (!picked) return;
      info = { registry: picked.registry, id: picked.id };
    }
    const tags = await usedBy(core, info.registry, info.id, target);
    const files = await referencedIn(core, info.id, 200);
    type Item = vscode.QuickPickItem & { uri?: string };
    const items: Item[] = [
      { label: t('Tags that include #{0}', info.id), kind: vscode.QuickPickItemKind.Separator },
      ...tags.map((u) => ({ label: `$(tag) #${u.tag}`, description: u.source, uri: u.uri })),
      { label: t('Files that reference #{0}', info.id), kind: vscode.QuickPickItemKind.Separator },
      ...files.map((f) => ({ label: `$(json) ${f.label}`, description: vscode.workspace.asRelativePath(vscode.Uri.parse(f.uri)), uri: f.uri })),
    ];
    if (!tags.length && !files.length) {
      void vscode.window.showInformationMessage(t('#{0} is not used anywhere in the workspace or by vanilla tags.', info.id));
      return;
    }
    const pick = await vscode.window.showQuickPick(items, { placeHolder: t('Usages of #{0}', info.id), matchOnDescription: true });
    if (pick?.uri) await vscode.window.showTextDocument(vscode.Uri.parse(pick.uri));
  });
}
