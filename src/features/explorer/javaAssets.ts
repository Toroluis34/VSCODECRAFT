// Java / Kotlin: CodeLens "assets: model ✓ texture ✓ lang ✓ recipe ✗" above register lines + hovers on ids.
import * as vscode from 'vscode';
import type { Core } from '../../core/core';
import { humanize, normalizeId, parseRL, resourceRelativePath } from '../../core/resourceLocation';
import { createFile, readText } from '../../core/fsUtils';
import { jsonc } from '../../core/jsonUtils';
import { encodePng, placeholderTexture } from './png';
import { findRegistrations, langKeys, literalAt, Registration, registrationOnLine } from './javaRegistrations';
import type { IconCache } from './iconCache';

export type AssetKey = 'definition' | 'model' | 'texture' | 'lang' | 'recipe' | 'blockstate' | 'loot';

export interface AssetCheck {
  key: AssetKey;
  ok: boolean;
  uris: vscode.Uri[];
  /** Texture id / lang text… shown in hovers. */
  detail?: string;
}

export interface AssetTarget {
  kind: 'item' | 'block';
  id: string;
  blockItem: boolean;
  /** Source file, for project / version context. */
  source: string;
}

const LABELS: Record<AssetKey, string> = {
  definition: 'item definition',
  model: 'model',
  texture: 'texture',
  lang: 'lang',
  recipe: 'recipe',
  blockstate: 'blockstate',
  loot: 'loot table',
};

export function assetLabel(key: AssetKey): string {
  return vscode.l10n.t(LABELS[key]);
}

export class AssetChecker {
  private recipeResults: Promise<Map<string, vscode.Uri[]>> | undefined;

  constructor(
    private readonly core: Core,
    private readonly icons: IconCache,
  ) {
    const reset = () => (this.recipeResults = undefined);
    core.track(core.index.onDidChange(reset), core.index.onDidChangeContent(reset));
  }

  /** result item id -> recipe files producing it */
  private results(): Promise<Map<string, vscode.Uri[]>> {
    if (!this.recipeResults) {
      this.recipeResults = (async () => {
        const map = new Map<string, vscode.Uri[]>();
        for (const r of this.core.index.all('recipe')) {
          if (r.ext !== 'json') continue;
          const j = await this.core.index.json<any>(r.uri);
          const res = j?.result;
          const id = typeof res === 'string' ? res : (res?.id ?? res?.item);
          if (typeof id !== 'string') continue;
          const key = normalizeId(id);
          map.set(key, [...(map.get(key) ?? []), r.uri]);
        }
        return map;
      })();
    }
    return this.recipeResults;
  }

  async check(t: AssetTarget): Promise<AssetCheck[]> {
    const uri = vscode.Uri.parse(t.source);
    const version = this.core.version(uri);
    const f = this.core.features(uri);
    const { namespace: ns, path } = parseRL(t.id);
    const idx = this.core.index;
    const files = (kind: string, id: string) => idx.get(kind, id).map((r) => r.uri);
    const out: AssetCheck[] = [];

    let modelId: string;
    if (t.kind === 'block') {
      const bs = files('blockstates', t.id);
      out.push({ key: 'blockstate', ok: bs.length > 0, uris: bs });
      modelId = `${ns}:block/${path}`;
    } else {
      if (f.hasItemDefinitions) {
        const def = files('items', t.id);
        out.push({ key: 'definition', ok: def.length > 0, uris: def });
      }
      modelId = (await this.core.icons.itemModel(t.id, version).catch(() => ({ model: `${ns}:item/${path}` }))).model;
      if (!idx.get('models', normalizeId(modelId)).length && t.blockItem) modelId = `${ns}:block/${path}`;
    }
    const models = files('models', normalizeId(modelId));
    out.push({ key: 'model', ok: models.length > 0 || parseRL(normalizeId(modelId)).namespace === 'minecraft', uris: models, detail: normalizeId(modelId) });

    const tex = (await this.icons.modelTexture(modelId, version)) ?? `${ns}:${t.kind === 'block' ? 'block' : 'item'}/${path}`;
    const texFiles = files('textures', normalizeId(tex));
    out.push({ key: 'texture', ok: texFiles.length > 0 || parseRL(normalizeId(tex)).namespace === 'minecraft', uris: texFiles, detail: normalizeId(tex) });

    const lang = await idx.lang('en_us');
    const keys = langKeys(t.kind === 'block' || t.blockItem ? 'block' : 'item', ns, path);
    if (t.kind === 'item' && !t.blockItem) keys.splice(1);
    const langKey = keys.find((k) => k in lang);
    const langFiles = idx
      .all('lang')
      .filter((r) => r.namespace === ns && r.path === 'en_us')
      .map((r) => r.uri);
    out.push({ key: 'lang', ok: !!langKey, uris: langFiles, detail: langKey ? `${langKey} = "${lang[langKey]}"` : keys[0] });

    const recipes = [...((await this.results()).get(normalizeId(t.id)) ?? [])];
    for (const r of idx.all('recipe')) if (r.namespace === ns && (r.path === path || r.path.endsWith('/' + path)) && !recipes.some((u) => u.toString() === r.uri.toString())) recipes.push(r.uri);
    out.push({ key: 'recipe', ok: recipes.length > 0, uris: recipes });

    if (t.kind === 'block') {
      const loot = files('loot_table', `${ns}:blocks/${path}`);
      out.push({ key: 'loot', ok: loot.length > 0, uris: loot });
    }
    return out;
  }
}

/** Resolve the namespace of a registration (explicit, or the project's mod id). */
function targetOf(core: Core, doc: vscode.TextDocument, r: Registration): AssetTarget {
  const ns = r.namespace ?? core.projects.defaultNamespace(doc.uri);
  return { kind: r.kind === 'block' ? 'block' : 'item', id: `${ns}:${r.name}`, blockItem: r.blockItem, source: doc.uri.toString() };
}

export class AssetCodeLensProvider implements vscode.CodeLensProvider {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.emitter.event;

  constructor(
    private readonly core: Core,
    private readonly checker: AssetChecker,
  ) {
    core.track(
      core.index.onDidChange(() => this.emitter.fire()),
      core.index.onDidChangeContent(() => this.emitter.fire()),
      core.projects.onDidChange(() => this.emitter.fire()),
      vscode.workspace.onDidChangeConfiguration((e) => e.affectsConfiguration('vscodecraft.explorer.codeLens') && this.emitter.fire()),
    );
  }

  provideCodeLenses(doc: vscode.TextDocument): vscode.CodeLens[] {
    if (!vscode.workspace.getConfiguration('vscodecraft.explorer', doc.uri).get<boolean>('codeLens', true)) return [];
    if (!this.core.projects.projects.length) return [];
    return findRegistrations(doc.getText()).map((r) => {
      const lens = new vscode.CodeLens(new vscode.Range(r.line, r.start, r.line, r.end));
      (lens as any).target = targetOf(this.core, doc, r);
      return lens;
    });
  }

  async resolveCodeLens(lens: vscode.CodeLens): Promise<vscode.CodeLens> {
    const target = (lens as any).target as AssetTarget;
    const checks = await this.checker.check(target);
    const summary = checks.map((c) => `${assetLabel(c.key)} ${c.ok ? '✓' : '✗'}`).join('  ');
    lens.command = {
      title: `${vscode.l10n.t('assets')}: ${summary}`,
      tooltip: vscode.l10n.t('{0} — click to open or create its files', target.id),
      command: 'vscodecraft.explorer.assetActions',
      arguments: [target],
    };
    return lens;
  }
}

export class AssetHoverProvider implements vscode.HoverProvider {
  constructor(
    private readonly core: Core,
    private readonly checker: AssetChecker,
    private readonly icons: IconCache,
  ) {}

  async provideHover(doc: vscode.TextDocument, pos: vscode.Position): Promise<vscode.Hover | undefined> {
    const line = doc.lineAt(pos.line).text;
    const lit = literalAt(line, pos.character);
    if (!lit) return undefined;
    const r = registrationOnLine(line, pos.line);
    if (!r || r.kind === 'other' || pos.character < r.start - 1 || pos.character > r.end + 1) return undefined;
    const target = targetOf(this.core, doc, r);
    const version = this.core.version(doc.uri);
    const checks = await this.checker.check(target);
    const md = new vscode.MarkdownString(undefined, true);
    md.isTrusted = { enabledCommands: ['vscode.open', 'vscodecraft.explorer.createAsset', 'vscodecraft.explorer.assetActions'] };
    md.supportHtml = false;
    const icon = await this.icons.itemIcon(target.id, version).catch(() => undefined);
    const lang = checks.find((c) => c.key === 'lang');
    const name = lang?.ok ? lang.detail?.replace(/^.*? = "(.*)"$/, '$1') : humanize(parseRL(target.id).path);
    if (icon) md.appendMarkdown(`![](${icon.toString()}|width=32,height=32) `);
    md.appendMarkdown(`**${escapeMd(name ?? '')}** \`${target.id}\` — ${target.kind === 'block' ? vscode.l10n.t('block') : target.blockItem ? vscode.l10n.t('block item') : vscode.l10n.t('item')}\n\n`);
    for (const c of checks) {
      md.appendMarkdown(`${c.ok ? '✓' : '✗'} **${assetLabel(c.key)}**`);
      if (c.uris.length) {
        md.appendMarkdown(
          ': ' +
            c.uris
              .slice(0, 3)
              .map((u) => `[${escapeMd(vscode.workspace.asRelativePath(u))}](command:vscode.open?${encodeURIComponent(JSON.stringify([u]))})`)
              .join(', '),
        );
      }
      if (c.detail && (c.key === 'texture' || c.key === 'lang' || c.key === 'model')) md.appendMarkdown(` \`${escapeMd(c.detail)}\``);
      if (!c.ok) {
        md.appendMarkdown(` — [${vscode.l10n.t('create')}](command:vscodecraft.explorer.createAsset?${encodeURIComponent(JSON.stringify([c.key, target]))})`);
      }
      md.appendMarkdown('\n\n');
    }
    return new vscode.Hover(md, new vscode.Range(pos.line, lit.start, pos.line, lit.end));
  }
}

function escapeMd(s: string): string {
  return s.replace(/[\\`*_[\]<>]/g, '\\$&');
}

/** Quick pick with every asset of a target: open existing files, create missing ones. */
export async function assetActions(core: Core, checker: AssetChecker, target: AssetTarget): Promise<void> {
  const checks = await checker.check(target);
  type Item = vscode.QuickPickItem & { run: () => Promise<unknown> };
  const items: Item[] = [];
  for (const c of checks) {
    if (c.uris.length) {
      for (const u of c.uris) {
        items.push({ label: `$(go-to-file) ${assetLabel(c.key)}`, description: vscode.workspace.asRelativePath(u), detail: c.ok ? undefined : c.detail, run: () => openAny(u) });
      }
    }
    if (!c.ok) items.push({ label: `$(add) ${vscode.l10n.t('Create {0}', assetLabel(c.key))}`, description: c.detail, run: () => createAsset(core, c.key, target) });
  }
  const pick = await vscode.window.showQuickPick(items, { placeHolder: target.id, matchOnDescription: true });
  await pick?.run();
}

async function openAny(uri: vscode.Uri): Promise<void> {
  await vscode.commands.executeCommand('vscode.open', uri);
}

async function writeAndOpen(uri: vscode.Uri, text: string): Promise<void> {
  if (await createFile(uri, text, 'ask')) await vscode.window.showTextDocument(uri, { preview: false });
}

/** Create a missing asset: delegates to the feature commands when present, otherwise writes a sensible default. */
export async function createAsset(core: Core, key: AssetKey, target: AssetTarget): Promise<void> {
  const source = vscode.Uri.parse(target.source);
  const root = core.projects.resourceRoot(source);
  if (!root) throw new Error(vscode.l10n.t('No resource folder found for this project.'));
  const f = core.features(source);
  const { namespace: ns, path } = parseRL(target.id);
  const at = (side: 'data' | 'assets', kind: string, id: string, ext?: string) => vscode.Uri.joinPath(root, ...resourceRelativePath(side, kind, id, ext).split('/'));
  const all = await vscode.commands.getCommands(true);
  const json = (v: unknown) => JSON.stringify(v, null, 2) + '\n';
  const isBlock = target.kind === 'block';

  switch (key) {
    case 'model':
    case 'definition':
    case 'blockstate': {
      const cmd = isBlock ? 'vscodecraft.models.newBlock' : 'vscodecraft.models.newItem';
      if (all.includes(cmd)) {
        await vscode.commands.executeCommand(cmd, { id: target.id, uri: source });
        return;
      }
      if (isBlock) {
        if (key === 'blockstate') return writeAndOpen(at('assets', 'blockstates', target.id), json({ variants: { '': { model: `${ns}:block/${path}` } } }));
        return writeAndOpen(at('assets', 'models', `${ns}:block/${path}`), json({ parent: 'minecraft:block/cube_all', textures: { all: `${ns}:block/${path}` } }));
      }
      const model = target.blockItem ? `${ns}:block/${path}` : `${ns}:item/${path}`;
      if (key === 'definition') return writeAndOpen(at('assets', 'items', target.id), json({ model: { type: 'minecraft:model', model } }));
      if (f.hasItemDefinitions && !core.index.get('items', target.id).length) {
        await createFile(at('assets', 'items', target.id), json({ model: { type: 'minecraft:model', model } }), false);
      }
      if (target.blockItem) return writeAndOpen(at('assets', 'models', model), json({ parent: 'minecraft:block/cube_all', textures: { all: `${ns}:block/${path}` } }));
      return writeAndOpen(at('assets', 'models', model), json({ parent: 'minecraft:item/generated', textures: { layer0: `${ns}:item/${path}` } }));
    }
    case 'texture': {
      const texId = `${ns}:${isBlock || target.blockItem ? 'block' : 'item'}/${path}`;
      if (all.includes('vscodecraft.textures.newTexture')) {
        await vscode.commands.executeCommand('vscodecraft.textures.newTexture', { id: texId, uri: source });
        return;
      }
      const uri = at('assets', 'textures', texId, 'png');
      const enc = encodePng(placeholderTexture(texId, isBlock || target.blockItem));
      try {
        await vscode.workspace.fs.stat(uri);
        void vscode.window.showInformationMessage(vscode.l10n.t('{0} already exists.', vscode.workspace.asRelativePath(uri)));
      } catch {
        await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, '..'));
        await vscode.workspace.fs.writeFile(uri, enc);
      }
      await vscode.commands.executeCommand('vscode.open', uri);
      return;
    }
    case 'lang': {
      const langKey = langKeys(isBlock || target.blockItem ? 'block' : 'item', ns, path)[0];
      const uri = core.index.get('lang', `${ns}:en_us`)[0]?.uri ?? at('assets', 'lang', `${ns}:en_us`);
      const text = (await readText(uri)) ?? '{}\n';
      const edits = jsonc.modify(text, [langKey], humanize(path), { formattingOptions: { insertSpaces: true, tabSize: 2 } });
      const updated = jsonc.applyEdits(text, edits);
      const doc = await vscode.workspace.openTextDocument(uri).then(
        (d) => d,
        async () => {
          await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, '..'));
          await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(updated));
          return vscode.workspace.openTextDocument(uri);
        },
      );
      if (doc.getText() !== updated) {
        const we = new vscode.WorkspaceEdit();
        we.replace(uri, new vscode.Range(0, 0, doc.lineCount, 0), updated);
        await vscode.workspace.applyEdit(we);
        await doc.save();
      }
      const editor = await vscode.window.showTextDocument(doc, { preview: false });
      const idx = doc.getText().indexOf(`"${langKey}"`);
      if (idx >= 0) {
        const p = doc.positionAt(idx);
        editor.selection = new vscode.Selection(p, p);
        editor.revealRange(new vscode.Range(p, p));
      }
      return;
    }
    case 'recipe': {
      if (all.includes('vscodecraft.recipes.new')) {
        await vscode.commands.executeCommand('vscodecraft.recipes.new', { id: target.id, result: target.id, uri: source });
        return;
      }
      const ingredient = f.ingredientFormat === 'string' ? 'minecraft:stone' : { item: 'minecraft:stone' };
      return writeAndOpen(
        at('data', 'recipe', target.id),
        json({ type: 'minecraft:crafting_shaped', category: 'misc', pattern: ['##', '##'], key: { '#': ingredient }, result: { id: target.id, count: 1 } }),
      );
    }
    case 'loot':
      return writeAndOpen(
        at('data', 'loot_table', `${ns}:blocks/${path}`),
        json({
          type: 'minecraft:block',
          pools: [{ rolls: 1, entries: [{ type: 'minecraft:item', name: target.id }], conditions: [{ condition: 'minecraft:survives_explosion' }] }],
          random_sequence: `${ns}:blocks/${path}`,
        }),
      );
  }
}

