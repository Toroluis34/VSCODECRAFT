// "New Recipe…" wizard and workspace-wide "Migrate Recipes to Target Version".
import * as vscode from 'vscode';
import type { Core } from '../../core/core';
import { classifyPath, humanize, parseRL, toResourcePath } from '../../core/resourceLocation';
import { dataFolder } from '../../core/versions';
import { createFile, jsonIndent, readText, stringifyJson } from '../../core/fsUtils';
import { jsonc } from '../../core/jsonUtils';
import { jsonDiff, migrateRecipe, newRecipe, recipeFormatFor, recipeKind, VANILLA_TYPES } from './recipeModel';
import { EDITOR_VIEW_TYPE, parseText } from './session';

const TYPE_DESCRIPTIONS: Record<string, string> = {
  'minecraft:crafting_shaped': 'Items in a fixed pattern on the crafting table',
  'minecraft:crafting_shapeless': 'Items anywhere on the crafting table',
  'minecraft:crafting_transmute': 'Changes an item keeping its components (e.g. dyeing shulker boxes)',
  'minecraft:crafting_dye': 'Dyes an item with any dye',
  'minecraft:crafting_imbue': 'Surrounds a potion with 8 items (like tipped arrows)',
  'minecraft:smelting': 'Furnace',
  'minecraft:blasting': 'Blast furnace',
  'minecraft:smoking': 'Smoker',
  'minecraft:campfire_cooking': 'Campfire',
  'minecraft:stonecutting': 'Stonecutter',
  'minecraft:smithing_transform': 'Smithing table upgrade (e.g. netherite)',
  'minecraft:smithing_trim': 'Smithing table armor trim',
  'minecraft:brewing': 'Brewing stand',
  'minecraft:crafting_decorated_pot': 'Decorated pot from sherds',
};

/** New Recipe… wizard. `target` may be a folder (explorer context menu) or a file. */
export async function newRecipeCommand(core: Core, target?: vscode.Uri): Promise<void> {
  let root: vscode.Uri | undefined;
  let ns: string | undefined;
  let subFolder = '';
  let folderOverride: vscode.Uri | undefined;
  const info = target ? classifyPath(target.fsPath + (target.path.endsWith('.json') ? '' : '/x.json')) : undefined;
  if (target && info && info.kind === 'recipe' && info.side === 'data') {
    root = vscode.Uri.file(info.root);
    ns = info.namespace;
    const p = info.path.split('/');
    p.pop();
    subFolder = p.join('/');
    folderOverride = target.path.endsWith('.json') ? vscode.Uri.joinPath(target, '..') : target;
  } else {
    const project = target ? core.projects.projectFor(target) : await core.projects.pickProject(vscode.l10n.t('Project for the new recipe'));
    root = project?.mainResourceRoot ?? core.projects.resourceRoot(target);
  }
  if (!root) throw new Error(vscode.l10n.t('Open a mod project or data pack folder first.'));
  const version = core.version(root);
  const fmt = recipeFormatFor(version);
  ns ??= core.projects.defaultNamespace(root);

  // 1. type
  const typePick = await vscode.window.showQuickPick(
    VANILLA_TYPES.filter((t) => t.available(fmt)).map((t) => ({
      label: vscode.l10n.t(t.label),
      description: t.type.replace('minecraft:', ''),
      detail: TYPE_DESCRIPTIONS[t.type] ? vscode.l10n.t(TYPE_DESCRIPTIONS[t.type]) : undefined,
      type: t.type,
    })),
    { title: vscode.l10n.t('New Recipe (Minecraft {0})', version), placeHolder: vscode.l10n.t('Recipe type'), matchOnDescription: true },
  );
  if (!typePick) return;
  const kind = recipeKind(typePick.type);

  // 2. result item
  let resultId = '';
  if (kind !== 'smithing_trim' && kind !== 'decorated_pot') {
    const entries = await core.registries.entries('item', root);
    const ordered = [...entries.filter((e) => e.source === 'workspace'), ...entries.filter((e) => e.source !== 'workspace')];
    const pick = await vscode.window.showQuickPick(
      ordered
        .filter((e) => e.id !== 'minecraft:air')
        .map((e) => ({
          label: e.name ?? humanize(parseRL(e.id).path),
          description: e.id,
          detail: e.source === 'workspace' ? vscode.l10n.t('from this workspace') : undefined,
          id: e.id,
        })),
      {
        title: vscode.l10n.t('New Recipe: result item'),
        placeHolder: vscode.l10n.t('Search the result item by name or id'),
        matchOnDescription: true,
      },
    );
    if (!pick) return;
    resultId = pick.id;
  }

  // 3. file name
  const resultPath = resultId ? parseRL(resultId).path : typePick.type.split(':')[1];
  const suffix = kind === 'cooking' || kind === 'stonecutting' ? `_from_${typePick.type.split(':')[1]}` : kind === 'smithing_transform' ? '_smithing' : '';
  const defaultName = [subFolder, `${resultPath}${suffix}`].filter(Boolean).join('/');
  const name = await vscode.window.showInputBox({
    title: vscode.l10n.t('New Recipe: file name'),
    prompt: vscode.l10n.t('Recipe id (path inside data/{0}/{1}/, or "namespace:path")', ns, dataFolder('recipe', version)),
    value: defaultName,
    valueSelection: [defaultName.lastIndexOf('/') + 1, defaultName.length],
    validateInput: (v) => (/^([a-z0-9_.-]+:)?[a-z0-9_./-]+$/.test(v.trim()) ? undefined : vscode.l10n.t('Use lowercase letters, digits, _ - . and /')),
  });
  if (!name) return;
  let id = name.trim();
  if (id.includes(':')) {
    ns = id.split(':')[0];
    id = id.split(':')[1];
    folderOverride = undefined;
  }
  id = id.split('/').map(toResourcePath).join('/');
  const json = newRecipe(typePick.type, resultId || 'minecraft:stone', fmt);
  const uri =
    folderOverride && subFolder && id.startsWith(subFolder + '/')
      ? vscode.Uri.joinPath(folderOverride, `${id.slice(subFolder.length + 1)}.json`)
      : vscode.Uri.joinPath(root, 'data', ns, dataFolder('recipe', version), `${id}.json`);
  if (!(await createFile(uri, stringifyJson(json, jsonIndent()), 'ask'))) return;
  await vscode.commands.executeCommand('vscode.openWith', uri, EDITOR_VIEW_TYPE);
}

interface MigrationItem extends vscode.QuickPickItem {
  uri: vscode.Uri;
  text: string;
  newText: string;
  extra: { uri: vscode.Uri; text: string }[];
}

/** Workspace-wide migration of every recipe to the target version of its project. */
export async function migrateAllCommand(core: Core): Promise<void> {
  await core.index.ready;
  const files = core.index.all('recipe').filter((r) => r.ext === 'json' && r.side === 'data');
  if (!files.length) {
    void vscode.window.showInformationMessage(vscode.l10n.t('No recipe files found in the workspace.'));
    return;
  }
  const items: MigrationItem[] = [];
  let unsupported = 0;
  const versions = new Set<string>();
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: vscode.l10n.t('Analyzing {0} recipe files…', files.length) },
    async () => {
      for (const f of files) {
        const text = await readText(f.uri);
        if (text === undefined) continue;
        const { json, error } = parseText(text);
        if (error || !json || typeof json !== 'object' || Array.isArray(json)) continue;
        const version = core.version(f.uri);
        versions.add(version);
        const name = f.uri.path.split('/').pop()!.replace(/\.json$/i, '');
        const res = migrateRecipe(json as Record<string, any>, recipeFormatFor(version), name);
        if (res.unsupported) unsupported++;
        if (!res.changed) continue;
        let newText = text;
        for (const m of jsonDiff(json, res.json)) {
          newText = jsonc.applyEdits(
            newText,
            jsonc.modify(newText, m.path, m.value, {
              formattingOptions: { insertSpaces: typeof jsonIndent() === 'number', tabSize: typeof jsonIndent() === 'number' ? (jsonIndent() as number) : 4, eol: text.includes('\r\n') ? '\r\n' : '\n' },
            }),
          );
        }
        const notes = res.notes.map((n) => vscode.l10n.t(n.message, ...(n.args ?? []).map(String)));
        const desc = [`→ ${version}`];
        if (res.extra.length) desc.push(vscode.l10n.t('+{0} new files', res.extra.length));
        if (res.modded) desc.push(vscode.l10n.t('modded type: review'));
        items.push({
          label: vscode.workspace.asRelativePath(f.uri),
          description: desc.join(' · '),
          detail: notes.join(' ') || undefined,
          picked: true,
          uri: f.uri,
          text,
          newText,
          extra: res.extra.map((e) => ({ uri: vscode.Uri.joinPath(f.uri, '..', `${e.name}.json`), text: stringifyJson(e.json, jsonIndent()) })),
        });
      }
    },
  );
  if (!items.length) {
    void vscode.window.showInformationMessage(
      vscode.l10n.t('All {0} recipe files already match their target version ({1}).', files.length, [...versions].join(', ')) +
        (unsupported ? ' ' + vscode.l10n.t('{0} recipes cannot be expressed in the target version.', unsupported) : ''),
    );
    return;
  }
  const chosen = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    title: vscode.l10n.t('{0} of {1} recipe files need changes — choose which ones to migrate', items.length, files.length),
    placeHolder: vscode.l10n.t('Target version: {0}', [...versions].join(', ')),
    matchOnDescription: true,
    matchOnDetail: true,
  });
  if (!chosen?.length) return;
  const extraCount = chosen.reduce((n, c) => n + c.extra.length, 0);
  const ok = vscode.l10n.t('Migrate');
  const answer = await vscode.window.showWarningMessage(
    vscode.l10n.t('Migrate {0} recipe files to Minecraft {1}?', chosen.length, [...versions].join(', ')),
    {
      modal: true,
      detail:
        (extraCount ? vscode.l10n.t('{0} new recipe files will be created.', extraCount) + '\n' : '') +
        vscode.l10n.t('The changes can be undone with Undo in each file.'),
    },
    ok,
  );
  if (answer !== ok) return;
  const edit = new vscode.WorkspaceEdit();
  const wasDirty = new Set(vscode.workspace.textDocuments.filter((d) => d.isDirty).map((d) => d.uri.toString()));
  for (const c of chosen) {
    const doc = await vscode.workspace.openTextDocument(c.uri);
    edit.replace(c.uri, new vscode.Range(0, 0, doc.lineCount, 0), c.newText);
    for (const e of c.extra) edit.createFile(e.uri, { ignoreIfExists: true, contents: new TextEncoder().encode(e.text) });
  }
  if (!(await vscode.workspace.applyEdit(edit))) throw new Error(vscode.l10n.t('Could not apply the migration.'));
  for (const c of chosen) {
    if (wasDirty.has(c.uri.toString())) continue;
    const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === c.uri.toString());
    if (doc?.isDirty) await doc.save();
  }
  void vscode.window.showInformationMessage(vscode.l10n.t('Migrated {0} recipe files.', chosen.length));
}
