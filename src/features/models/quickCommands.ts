// Quick commands (no webview): Generate Block Model Set, Create Item Model Definitions from Item Models.
import * as vscode from 'vscode';
import type { Core } from '../../core/core';
import { humanize, parseRL } from '../../core/resourceLocation';
import { exists, readJson } from '../../core/fsUtils';
import {
  deepEqual,
  migrateItemModel,
  overrideTargets,
  PlannedFile,
  planBlockSet,
  blockModel,
  SET_VARIANTS,
  setBaseName,
  vanillaDerivedBlockstate,
  VANILLA_COUNTERPART,
} from './templates';
import { writePlan, FileStatus } from './writer';
import type { SetVariant } from './viewTypes';

const VARIANT_LABEL: Record<SetVariant, string> = {
  stairs: 'Stairs',
  slab: 'Slab',
  wall: 'Wall',
  fence: 'Fence',
  fence_gate: 'Fence Gate',
  button: 'Button',
  pressure_plate: 'Pressure Plate',
  door: 'Door',
  trapdoor: 'Trapdoor',
  pane: 'Pane',
};

export function registerQuickCommands(core: Core): void {
  core.registerCommand('vscodecraft.models.generateBlockSet', (uri?: vscode.Uri) => generateBlockSet(core, uri));
  core.registerCommand('vscodecraft.models.migrateItemDefinitions', (uri?: vscode.Uri) => migrateItemDefinitions(core, uri));
}

async function report(core: Core, files: FileStatus[], title: string): Promise<void> {
  const created = files.filter((f) => f.status === 'created').length;
  const updated = files.filter((f) => f.status === 'updated').length;
  const skipped = files.filter((f) => f.status === 'skipped').length;
  const failed = files.filter((f) => f.status === 'error');
  core.log.info(`${title}:\n${files.map((f) => `  [${f.status}] ${f.path}${f.detail ? ` (${f.detail})` : ''}`).join('\n')}`);
  const msg = vscode.l10n.t('{0}: {1} created, {2} updated, {3} skipped (already existed).', title, created, updated, skipped);
  const show = vscode.l10n.t('Show details');
  const pick = failed.length
    ? await vscode.window.showErrorMessage(`${msg} ${vscode.l10n.t('{0} failed.', failed.length)}`, show)
    : await vscode.window.showInformationMessage(msg, show);
  if (pick === show) {
    const items = files.map((f) => ({
      label: `${f.status === 'created' ? '$(new-file)' : f.status === 'updated' ? '$(edit)' : f.status === 'error' ? '$(error)' : '$(circle-slash)'} ${f.path}`,
      description: f.detail,
      uri: f.uri,
    }));
    const sel = await vscode.window.showQuickPick(items, { placeHolder: title });
    if (sel) await vscode.commands.executeCommand('vscode.open', vscode.Uri.parse(sel.uri));
  }
}

async function generateBlockSet(core: Core, arg?: vscode.Uri): Promise<void> {
  const ctxUri = arg instanceof vscode.Uri ? arg : vscode.window.activeTextEditor?.document.uri;
  const root = core.projects.resourceRoot(ctxUri);
  if (!root) throw new Error(vscode.l10n.t('No resource folder found: open a mod project or a pack folder.'));
  const version = core.version(ctxUri);
  const ns = core.projects.defaultNamespace(ctxUri);

  // 1. texture
  let textureId: string | undefined;
  const argInfo = arg ? core.index.info(arg) : undefined;
  if (argInfo?.kind === 'textures') textureId = argInfo.id;
  else if (argInfo?.kind === 'models') {
    const m = await readJson<any>(arg!);
    const t = m?.textures?.all ?? m?.textures?.side ?? m?.textures?.texture;
    if (typeof t === 'string' && !t.startsWith('#')) textureId = t.includes(':') ? t : `minecraft:${t}`;
  }
  if (!textureId) {
    const items = core.index
      .all('textures')
      .filter((r) => r.ext === 'png' && r.path.startsWith('block/'))
      .map((r) => ({ label: r.id, iconPath: r.uri, id: r.id }))
      .sort((a, b) => a.label.localeCompare(b.label));
    const manual = { label: vscode.l10n.t('$(edit) Enter a texture id…'), id: '' };
    const pick = await vscode.window.showQuickPick([...items, manual], { placeHolder: vscode.l10n.t('Texture for the block set (e.g. mymod:block/ruby_bricks)') });
    if (!pick) return;
    textureId = pick.id;
    if (!textureId) {
      textureId = await vscode.window.showInputBox({ prompt: vscode.l10n.t('Texture id'), value: `${ns}:block/` });
      if (!textureId) return;
      if (!textureId.includes(':')) textureId = `minecraft:${textureId}`;
    }
  }
  const texRl = parseRL(textureId);
  const fullName = texRl.path.split('/').pop()!;
  const namespace = texRl.namespace === 'minecraft' ? ns : texRl.namespace;

  // 2. base name
  const base = await vscode.window.showInputBox({
    prompt: vscode.l10n.t('Base name of the new blocks (e.g. "ruby_brick" → ruby_brick_stairs)'),
    value: setBaseName(fullName),
    validateInput: (v) => (/^[a-z0-9_./-]+$/.test(v) ? undefined : vscode.l10n.t('Use lowercase letters, digits and _')),
  });
  if (!base) return;

  // 3. variants
  const defaults: SetVariant[] = ['stairs', 'slab', 'wall', 'fence', 'fence_gate', 'button', 'pressure_plate'];
  const vpicks = await vscode.window.showQuickPick(
    SET_VARIANTS.map((v) => ({ label: vscode.l10n.t(VARIANT_LABEL[v]), description: `${namespace}:${base}_${v}`, picked: defaults.includes(v), v })),
    { canPickMany: true, placeHolder: vscode.l10n.t('Variants to generate') },
  );
  if (!vpicks?.length) return;

  // 4. extras
  const hasDefs = core.features(ctxUri).hasItemDefinitions;
  const extras = await vscode.window.showQuickPick(
    [
      { label: hasDefs ? vscode.l10n.t('Item model definitions (items/*.json)') : vscode.l10n.t('Item models (models/item/*.json)'), key: 'items', picked: true },
      { label: vscode.l10n.t('Loot tables (drop self)'), key: 'loot', picked: true },
      { label: vscode.l10n.t('Vanilla block/item tags (stairs, slabs, walls…)'), key: 'tags', picked: true },
      { label: vscode.l10n.t('Crafting recipes from the full block'), key: 'recipes', picked: false },
      { label: vscode.l10n.t('Lang entries (en_us / es_es)'), key: 'lang', picked: true },
    ],
    { canPickMany: true, placeHolder: vscode.l10n.t('Also generate…') },
  );
  if (!extras) return;
  const want = new Set(extras.map((e) => e.key));

  // Full block (double slab / recipes)
  const fullModelId = `${namespace}:block/${fullName}`;
  const extraFiles: PlannedFile[] = [];
  if (!core.index.find('models', fullModelId) && vpicks.some((p) => p.v === 'slab')) {
    extraFiles.push({ path: `assets/${namespace}/models/block/${fullName}.json`, type: 'json', json: blockModel('block/cube_all', { all: textureId }) });
  }
  const tex = (id: string) => (core.index.find('textures', id) ? id : undefined);
  const nameEn = humanize(fullName);
  const plan = planBlockSet(
    {
      namespace,
      base,
      fullBlockModel: fullModelId,
      textures: {
        texture: textureId,
        doorTop: tex(`${namespace}:block/${base}_door_top`),
        doorBottom: tex(`${namespace}:block/${base}_door_bottom`),
        doorItem: tex(`${namespace}:item/${base}_door`),
        trapdoor: tex(`${namespace}:block/${base}_trapdoor`),
        paneEdge: tex(`${namespace}:block/${base}_pane_top`),
      },
      variants: vpicks.map((p) => p.v),
      items: want.has('items'),
      loot: want.has('loot'),
      tags: want.has('tags'),
      recipes: want.has('recipes'),
      baseItem: `${namespace}:${fullName}`,
      lang: want.has('lang') ? { en: nameEn } : undefined,
    },
    { version, loader: core.projects.projectFor(ctxUri)?.loader ?? 'unknown' },
  );

  // Double-check against vanilla blockstates (when the vanilla data is available) and prefer vanilla's structure.
  try {
    const defs = await core.vanilla.blockDefinitions(version);
    for (const a of plan.assets) {
      const variant = a.id.slice(base.length + 1) as SetVariant;
      const vanilla = defs[VANILLA_COUNTERPART[variant]?.block];
      if (!vanilla) continue;
      const derived = vanillaDerivedBlockstate(vanilla, variant, namespace, a.id, fullModelId);
      if (!deepEqual(derived, a.blockstate)) {
        core.log.warn(`models: ${a.id} blockstate differs from vanilla ${VANILLA_COUNTERPART[variant].block} for ${version}; using vanilla's structure.`);
        const f = plan.files.find((x) => x.path === `assets/${namespace}/blockstates/${a.id}.json`);
        if (f) f.json = derived;
      }
    }
  } catch (e) {
    core.log.info(`models: vanilla blockstates unavailable (${e}); using built-in templates.`);
  }

  const results = await writePlan(root, [...extraFiles, ...plan.files], 'block');
  await report(core, results, vscode.l10n.t('Block set "{0}"', base));
}

async function migrateItemDefinitions(core: Core, arg?: vscode.Uri): Promise<void> {
  const ctxUri = arg instanceof vscode.Uri ? arg : vscode.window.activeTextEditor?.document.uri;
  const version = core.version(ctxUri);
  if (!core.features(ctxUri).hasItemDefinitions) {
    const go = vscode.l10n.t('Continue');
    const pick = await vscode.window.showWarningMessage(
      vscode.l10n.t('The target version {0} does not use item model definitions (1.21.4+). Create them anyway?', version),
      { modal: true },
      go,
    );
    if (pick !== go) return;
  }
  const itemModels = core.index.all('models').filter((r) => r.ext === 'json' && r.path.startsWith('item/'));
  const jsons: Record<string, any> = {};
  for (const r of itemModels) jsons[r.id] = await core.index.json(r.uri);
  const subModels = overrideTargets(jsons);
  const candidates: { label: string; description?: string; detail: string; picked: boolean; r: (typeof itemModels)[number]; itemId: string }[] = [];
  for (const r of itemModels) {
    const itemPath = r.path.slice('item/'.length);
    const itemId = `${r.namespace}:${itemPath}`;
    if (core.index.find('items', itemId)) continue;
    // Also skip if the file exists on disk next to the model (index not refreshed yet)
    const target = vscode.Uri.file(`${r.root}/assets/${r.namespace}/items/${itemPath}.json`);
    if (await exists(target)) continue;
    const isSub = subModels.has(r.id);
    candidates.push({
      label: itemId,
      description: isSub ? vscode.l10n.t('used by another model\'s overrides') : r.namespace === 'minecraft' ? vscode.l10n.t('overrides vanilla') : undefined,
      detail: vscode.workspace.asRelativePath(r.uri),
      picked: !isSub && r.namespace !== 'minecraft',
      r,
      itemId,
    });
  }
  if (!candidates.length) {
    void vscode.window.showInformationMessage(vscode.l10n.t('Every item model already has an item model definition.'));
    return;
  }
  candidates.sort((a, b) => a.label.localeCompare(b.label));
  const picks = await vscode.window.showQuickPick(candidates, { canPickMany: true, placeHolder: vscode.l10n.t('Item models to create items/*.json definitions for') });
  if (!picks?.length) return;
  const byRoot = new Map<string, PlannedFile[]>();
  for (const p of picks) {
    const { json, warnings } = migrateItemModel(p.r.id, jsons[p.r.id]);
    for (const w of warnings) core.log.warn(`models: ${p.r.id}: ${w}`);
    const list = byRoot.get(p.r.root) ?? [];
    list.push({ path: `assets/${p.r.namespace}/items/${p.r.path.slice('item/'.length)}.json`, type: 'json', json });
    byRoot.set(p.r.root, list);
  }
  const results: FileStatus[] = [];
  for (const [root, files] of byRoot) results.push(...(await writePlan(vscode.Uri.file(root), files, 'item')));
  await report(core, results, vscode.l10n.t('Item model definitions'));
}
