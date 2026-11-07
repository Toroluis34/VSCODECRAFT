import * as vscode from 'vscode';
import * as jsonc from 'jsonc-parser';
import type { Core } from '../../core/core';
import { formatJson, modifyEdits } from '../../core/jsonUtils';
import { createFile, readText } from '../../core/fsUtils';
import { classifyPath, humanize, parseRL, resourceRelativePath, type PackSide } from '../../core/resourceLocation';
import { getFeatures, LEGACY_FOLDER_RENAMES } from '../../core/versions';
import { fileKindOf, parseRef } from './context';
import type { DocumentAnalyzer } from './analysis';
import type { RefResolver } from './resolver';
import { DIAG_SOURCE, DiagCode } from './diagnostics';
import { convertIngredient, findIngredients, inlineJson } from './ingredients';
import { placeholderPng } from './png';

export const CMD_RENAME_LEGACY = 'vscodecraft.language.renameLegacyFolder';
export const CMD_CREATE_RESOURCE = 'vscodecraft.language.createResource';

export interface CreateResourceArgs {
  /** Resource root (folder containing data/ and assets/) as a URI string. */
  root: string;
  side: PackSide;
  kind: string;
  /** Full id including any prefix ("mymod:block/ruby"). */
  id: string;
  ext: string;
}

const CREATABLE = new Set(['models', 'textures', 'items', 'blockstates']);

class LangAction extends vscode.CodeAction {
  constructor(
    title: string,
    readonly langUri: vscode.Uri,
    readonly key: string,
    readonly value: string,
  ) {
    super(title, vscode.CodeActionKind.QuickFix);
  }
}

export function registerCodeActions(core: Core, selector: vscode.DocumentSelector, analyzer: DocumentAnalyzer, resolver: RefResolver): void {
  const provider: vscode.CodeActionProvider = {
    async provideCodeActions(doc, range, context) {
      const out: vscode.CodeAction[] = [];
      const a = analyzer.get(doc);
      if (!a) return out;
      const features = getFeatures(core.version(doc.uri));
      const ingredientDiags: vscode.Diagnostic[] = [];

      for (const d of context.diagnostics) {
        if (d.source !== DIAG_SOURCE) continue;
        const code = typeof d.code === 'object' ? d.code.value : d.code;
        if (code === DiagCode.unknown || code === DiagCode.missingFile) {
          const hit = analyzer.refAt(doc, d.range.start);
          const ref = hit && parseRef(hit.ref.value, hit.ref.ctx);
          if (!hit || !ref) continue;
          const prefix = `${ref.negated ? '!' : ''}${ref.isTag && !hit.ref.ctx.tagOnly ? '#' : ''}`;
          const suggestions = await resolver.suggestions(hit.ref.ctx, ref, doc.uri, 3);
          suggestions.forEach((s, i) => {
            const action = new vscode.CodeAction(vscode.l10n.t("Change to '{0}'", prefix + s), vscode.CodeActionKind.QuickFix);
            action.diagnostics = [d];
            action.isPreferred = i === 0;
            action.edit = new vscode.WorkspaceEdit();
            action.edit.replace(doc.uri, d.range, prefix + s);
            out.push(action);
          });
          const fk = fileKindOf(hit.ref.ctx.registry, ref.isTag);
          const rl = parseRL(ref.id);
          if (code === DiagCode.missingFile && fk && CREATABLE.has(fk.kind) && rl.namespace !== 'minecraft') {
            const root = a.info ? doc.uri.with({ path: a.info.root.startsWith('/') ? a.info.root : `/${a.info.root}` }) : core.projects.resourceRoot(doc.uri);
            if (root) {
              const id = `${rl.namespace}:${hit.ref.ctx.prefix ?? ''}${rl.path}`;
              const args: CreateResourceArgs = { root: root.toString(), side: fk.side, kind: fk.kind, id, ext: fk.ext };
              const title =
                fk.kind === 'textures'
                  ? vscode.l10n.t("Create placeholder texture '{0}'", id)
                  : fk.kind === 'models'
                    ? vscode.l10n.t("Create model '{0}'", id)
                    : vscode.l10n.t("Create file for '{0}'", id);
              const action = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
              action.diagnostics = [d];
              action.command = { command: CMD_CREATE_RESOURCE, title, arguments: [args] };
              out.push(action);
            }
          }
        } else if (code === DiagCode.legacyFolder && a.info) {
          const modern = LEGACY_FOLDER_RENAMES[a.info.folder];
          if (!modern) continue;
          const title = vscode.l10n.t("Rename folder '{0}' to '{1}'", a.info.folder, modern);
          const action = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
          action.diagnostics = [d];
          action.isPreferred = true;
          action.command = { command: CMD_RENAME_LEGACY, title, arguments: [doc.uri] };
          out.push(action);
        } else if (code === DiagCode.ingredient) {
          ingredientDiags.push(d);
          const edit = ingredientEdit(doc, a.tree, [d], features.ingredientFormat);
          if (!edit) continue;
          const action = new vscode.CodeAction(
            features.ingredientFormat === 'string' ? vscode.l10n.t('Convert ingredient to the string format') : vscode.l10n.t('Convert ingredient to the object format'),
            vscode.CodeActionKind.QuickFix,
          );
          action.diagnostics = [d];
          action.isPreferred = true;
          action.edit = edit;
          out.push(action);
        } else if (code === DiagCode.resultItem) {
          const action = new vscode.CodeAction(vscode.l10n.t('Rename "item" to "id"'), vscode.CodeActionKind.QuickFix);
          action.diagnostics = [d];
          action.isPreferred = true;
          action.edit = new vscode.WorkspaceEdit();
          action.edit.replace(doc.uri, d.range, '"id"');
          out.push(action);
        }
      }

      // Fix-all for ingredients of this file
      const allIngredientDiags = vscode.languages
        .getDiagnostics(doc.uri)
        .filter((d) => d.source === DIAG_SOURCE && (typeof d.code === 'object' ? d.code.value : d.code) === DiagCode.ingredient);
      if (ingredientDiags.length && allIngredientDiags.length > 1) {
        const edit = ingredientEdit(doc, a.tree, allIngredientDiags, features.ingredientFormat);
        if (edit) {
          const action = new vscode.CodeAction(vscode.l10n.t('Convert all ingredients in this file for Minecraft {0}', features.version), vscode.CodeActionKind.QuickFix);
          action.diagnostics = allIngredientDiags;
          action.edit = edit;
          out.push(action);
        }
      }

      // Add a missing translation for a workspace item/block
      const hit = analyzer.refAt(doc, range.start);
      if (hit && (hit.ref.ctx.registry === 'item' || hit.ref.ctx.registry === 'block') && !hit.ref.ctx.key) {
        const ref = parseRef(hit.ref.value, hit.ref.ctx);
        if (ref && !ref.isTag) {
          const rl = parseRL(ref.id);
          const lang = rl.namespace !== 'minecraft' ? core.index.get('lang', `${rl.namespace}:en_us`)[0] : undefined;
          if (lang) {
            const json = (await core.index.json<Record<string, string>>(lang.uri)) ?? {};
            const isBlock = hit.ref.ctx.registry === 'block' || core.index.get('blockstates', ref.id).length > 0;
            const key = `${isBlock ? 'block' : 'item'}.${rl.namespace}.${rl.path.replace(/\//g, '.')}`;
            const alt = `${isBlock ? 'item' : 'block'}.${rl.namespace}.${rl.path.replace(/\//g, '.')}`;
            if (!(key in json) && !(alt in json)) {
              out.push(new LangAction(vscode.l10n.t("Add translation '{0}' to {1}", key, vscode.workspace.asRelativePath(lang.uri)), lang.uri, key, humanize(rl.path)));
            }
          }
        }
      }
      return out;
    },

    async resolveCodeAction(action) {
      if (action instanceof LangAction) {
        const text = (await readText(action.langUri)) ?? '{}\n';
        const edits = modifyEdits(text, [action.key], action.value);
        const langDoc = await vscode.workspace.openTextDocument(action.langUri);
        const edit = new vscode.WorkspaceEdit();
        for (const e of edits) {
          edit.replace(action.langUri, new vscode.Range(langDoc.positionAt(e.offset), langDoc.positionAt(e.offset + e.length)), e.content);
        }
        action.edit = edit;
      }
      return action;
    },
  };

  core.track(
    vscode.languages.registerCodeActionsProvider(selector, provider, {
      providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
    }),
  );

  core.registerCommand(CMD_RENAME_LEGACY, (uri?: vscode.Uri) => renameLegacyFolder(uri ?? vscode.window.activeTextEditor?.document.uri));
  core.registerCommand(CMD_CREATE_RESOURCE, (args: CreateResourceArgs) => createResource(core, args));
}

function ingredientEdit(doc: vscode.TextDocument, tree: jsonc.Node | undefined, diags: vscode.Diagnostic[], to: 'string' | 'object'): vscode.WorkspaceEdit | undefined {
  const ingredients = findIngredients(tree);
  const edit = new vscode.WorkspaceEdit();
  let n = 0;
  for (const d of diags) {
    const offset = doc.offsetAt(d.range.start);
    const ing = ingredients.find((i) => i.node.offset === offset);
    if (!ing) continue;
    const converted = convertIngredient(ing.value, to);
    if (converted === undefined) continue;
    edit.replace(doc.uri, new vscode.Range(doc.positionAt(ing.node.offset), doc.positionAt(ing.node.offset + ing.node.length)), inlineJson(converted));
    n++;
  }
  return n ? edit : undefined;
}

/** Move every file of a legacy folder (recipes/, loot_tables/, tags/items/ ...) to its 1.21+ name. */
async function renameLegacyFolder(uri: vscode.Uri | undefined): Promise<void> {
  if (!uri) return;
  const info = classifyPath(uri.path);
  if (!info?.legacyFolder) {
    void vscode.window.showInformationMessage(vscode.l10n.t('This file is not inside a pre-1.21 folder (recipes/, loot_tables/, tags/items/ ...).'));
    return;
  }
  const modern = LEGACY_FOLDER_RENAMES[info.folder];
  const marker = `/${info.side}/${info.namespace}/${info.folder}/`;
  const idx = uri.path.lastIndexOf(marker);
  if (!modern || idx < 0) return;
  const base = uri.path.slice(0, idx) + `/${info.side}/${info.namespace}/`;
  const oldDir = uri.with({ path: base + info.folder });
  const newDir = uri.with({ path: base + modern });
  const files = await listFiles(oldDir);
  const edit = new vscode.WorkspaceEdit();
  for (const f of files) {
    const rel = f.path.slice(oldDir.path.length + 1);
    edit.renameFile(f, vscode.Uri.joinPath(newDir, ...rel.split('/')), { overwrite: false, ignoreIfExists: true });
  }
  if (!(await vscode.workspace.applyEdit(edit))) return;
  try {
    if (!(await listFiles(oldDir)).length) await vscode.workspace.fs.delete(oldDir, { recursive: true, useTrash: false });
  } catch {
    /* keep the folder */
  }
  void vscode.window.showInformationMessage(vscode.l10n.t("Moved {0} files from '{1}' to '{2}'.", files.length, info.folder, modern));
}

async function listFiles(dir: vscode.Uri): Promise<vscode.Uri[]> {
  const out: vscode.Uri[] = [];
  let entries: [string, vscode.FileType][] = [];
  try {
    entries = await vscode.workspace.fs.readDirectory(dir);
  } catch {
    return out;
  }
  for (const [name, type] of entries) {
    const child = vscode.Uri.joinPath(dir, name);
    if (type & vscode.FileType.Directory) out.push(...(await listFiles(child)));
    else out.push(child);
  }
  return out;
}

async function createResource(core: Core, args: CreateResourceArgs): Promise<void> {
  const root = vscode.Uri.parse(args.root);
  const target = vscode.Uri.joinPath(root, ...resourceRelativePath(args.side, args.kind, args.id, args.ext).split('/'));
  const rl = parseRL(args.id);
  const last = rl.path.split('/').pop() ?? rl.path;
  if (args.kind === 'textures') {
    try {
      await vscode.workspace.fs.stat(target);
      return void vscode.commands.executeCommand('vscode.open', target);
    } catch {
      /* create */
    }
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(target, '..'));
    await vscode.workspace.fs.writeFile(target, placeholderPng());
    await vscode.commands.executeCommand('vscode.open', target);
    return;
  }
  let value: unknown;
  if (args.kind === 'models') {
    value = rl.path.startsWith('item/')
      ? { parent: 'minecraft:item/generated', textures: { layer0: `${rl.namespace}:${rl.path}` } }
      : { parent: 'minecraft:block/cube_all', textures: { all: `${rl.namespace}:block/${last}` } };
  } else if (args.kind === 'items') {
    const isBlock = core.index.get('blockstates', args.id).length > 0;
    value = { model: { type: 'minecraft:model', model: `${rl.namespace}:${isBlock ? 'block' : 'item'}/${rl.path}` } };
  } else if (args.kind === 'blockstates') {
    value = { variants: { '': { model: `${rl.namespace}:block/${rl.path}` } } };
  } else return;
  if (await createFile(target, formatJson(value))) {
    await vscode.window.showTextDocument(target);
  }
}
