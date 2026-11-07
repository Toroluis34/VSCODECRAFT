// "New Item…" / "New Block…" generator webview (host side).
import * as vscode from 'vscode';
import type { Core } from '../../core/core';
import type { ItemVisual, TextureRef } from '../../shared/protocol';
import { exists } from '../../core/fsUtils';
import { javaSnippet, planForm, snippetTitle, validateForm } from './templates';
import { placeholderPng, pngDataUri } from './png';
import { defaultColor, writePlan } from './writer';
import type { ModelResolver } from './resolver';
import type { GeneratorForm, GeneratorInit, GeneratorPreview, GeneratorResult, TextureOption } from './viewTypes';

/** Command argument: a vscode.Uri (explorer context menu), {id: 'ns:name', uri} (Java CodeLens) or nothing. */
type GeneratorArg = vscode.Uri | { id?: string; uri?: vscode.Uri } | undefined;

export function registerGenerator(core: Core, resolver: ModelResolver): void {
  core.registerCommand('vscodecraft.models.newItem', (arg?: GeneratorArg) => openGenerator(core, resolver, 'item', arg));
  core.registerCommand('vscodecraft.models.newBlock', (arg?: GeneratorArg) => openGenerator(core, resolver, 'block', arg));
}

function placeholderKind(form: GeneratorForm): 'item' | 'block' | 'cross' {
  return form.mode === 'item' ? 'item' : form.template === 'cross' ? 'cross' : 'block';
}

async function openGenerator(core: Core, resolver: ModelResolver, mode: 'item' | 'block', arg?: GeneratorArg): Promise<void> {
  const argUri = arg instanceof vscode.Uri ? arg : arg && typeof arg === 'object' && arg.uri instanceof vscode.Uri ? arg.uri : undefined;
  const argId = arg && !(arg instanceof vscode.Uri) && typeof arg === 'object' && typeof arg.id === 'string' ? arg.id : undefined;
  const ctxUri = argUri ?? vscode.window.activeTextEditor?.document.uri;
  const root = core.projects.resourceRoot(ctxUri);
  const project = core.projects.projectFor(ctxUri);
  const version = core.version(ctxUri);
  const prefill = argId ? (argId.includes(':') ? argId.split(':') : [undefined, argId]) : undefined;
  const namespace = prefill?.[0] || core.projects.defaultNamespace(ctxUri);
  const init: GeneratorInit = {
    mode,
    namespace,
    namespaces: [...new Set([namespace, ...(project?.namespaces ?? []), ...(project?.modIds ?? [])])].filter((n) => n !== 'minecraft' || namespace === 'minecraft'),
    version,
    loader: project?.loader ?? 'unknown',
    hasItemDefinitions: core.features(ctxUri).hasItemDefinitions,
    resourceRoot: root ? vscode.workspace.asRelativePath(root) : undefined,
    id: prefill?.[1],
  };
  const { host } = core.webviews.createPanel({
    viewType: 'vscodecraft.models.generator',
    title: mode === 'item' ? vscode.l10n.t('New Item') : vscode.l10n.t('New Block'),
    bundle: 'generator',
    state: init,
    documentUri: ctxUri ?? root,
  });
  const ctx = { version, loader: init.loader };
  const fileCache = new Map<string, string>();

  const textureRef = async (id: string): Promise<TextureRef | null> => resolver.toWebview(await core.icons.textureRef(id, version), host.webview);

  host.handle('generator.textures', async (): Promise<TextureOption[]> => {
    const out: TextureOption[] = [];
    for (const r of core.index.all('textures')) {
      if (r.ext !== 'png') continue;
      out.push({ id: r.id, src: host.webview.asWebviewUri(r.uri).toString() });
    }
    out.sort((a, b) => a.id.localeCompare(b.id));
    return out.slice(0, 2000);
  });

  host.handle('generator.browse', async () => {
    const picked = await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: { PNG: ['png'] },
      defaultUri: root,
      openLabel: vscode.l10n.t('Use texture'),
    });
    if (!picked?.[0]) return undefined;
    const bytes = await vscode.workspace.fs.readFile(picked[0]);
    const src = pngDataUri(bytes);
    fileCache.set(picked[0].fsPath, src);
    // A png already inside textures/ of this workspace can simply be referenced
    const info = core.index.info(picked[0]);
    return { file: picked[0].fsPath, src, existingId: info?.kind === 'textures' ? info.id : undefined };
  });

  host.handle('generator.preview', async (form: GeneratorForm): Promise<GeneratorPreview> => {
    const errors = validateForm(form).map((e) => vscode.l10n.t(e));
    const safeForm = errors.length ? { ...form, id: form.id && /^[a-z0-9_./-]+$/.test(form.id) ? form.id : 'preview' } : form;
    const plan = planForm(safeForm, ctx);
    const override: Record<string, TextureRef> = {};
    const textures: Record<string, TextureRef | null> = {};
    const colors: Record<string, string> = {};
    for (const [slot, id] of Object.entries(plan.textures)) {
      const choice = form.textures[slot] ?? { source: 'placeholder' };
      colors[slot] = choice.color || defaultColor(id, slot);
      if (choice.source === 'existing') {
        textures[slot] = await textureRef(id);
        continue;
      }
      let src: string | undefined;
      if (choice.source === 'file' && choice.file) {
        src = fileCache.get(choice.file);
        if (!src) {
          try {
            src = pngDataUri(await vscode.workspace.fs.readFile(vscode.Uri.file(choice.file)));
            fileCache.set(choice.file, src);
          } catch {
            src = undefined;
          }
        }
      }
      src ??= pngDataUri(placeholderPng(placeholderKind(safeForm), colors[slot], id));
      override[id] = { src };
      textures[slot] = override[id];
    }
    let visual: ItemVisual;
    try {
      const r = await resolver.resolve(plan.previewModel, version, host.webview, { overlay: plan.models, textureOverride: override });
      if (r.generated.length) visual = { type: 'flat', id: plan.previewModel, layers: r.generated.filter((l) => l.texture).map((l) => ({ texture: l.texture!, tint: l.tint })) };
      else if (r.elements.length) visual = { type: 'model', id: plan.previewModel, elements: r.elements, gui: r.display.gui };
      else visual = { type: 'missing', id: plan.previewModel, label: form.id };
    } catch {
      visual = { type: 'missing', id: plan.previewModel, label: form.id };
    }
    const files: GeneratorPreview['files'] = [];
    for (const f of plan.files) {
      const present = root ? await exists(vscode.Uri.joinPath(root, ...f.path.split('/'))) : false;
      const action = f.type === 'lang' || f.type === 'tag' ? (present ? 'merge' : 'create') : present ? 'skip' : 'create';
      files.push({ path: f.path, exists: present, action });
    }
    if (!root) errors.push(vscode.l10n.t('No resource folder found: open a mod project or a pack folder.'));
    return {
      visual,
      files,
      snippet: javaSnippet(ctx.loader, version, plan.registrations, form.namespace),
      snippetTitle: snippetTitle(ctx.loader, version),
      textures,
      ids: plan.ids,
      errors,
      colors,
    };
  });

  host.handle('generator.create', async (form: GeneratorForm): Promise<GeneratorResult> => {
    const errors = validateForm(form);
    if (errors.length) throw new Error(errors.map((e) => vscode.l10n.t(e)).join('; '));
    if (!root) throw new Error(vscode.l10n.t('No resource folder found: open a mod project or a pack folder.'));
    const plan = planForm(form, ctx);
    const files = await writePlan(root, plan.files, placeholderKind(form));
    const created = files.filter((f) => f.status === 'created' || f.status === 'updated').length;
    core.log.info(`models: generated ${created} file(s) for ${plan.ids.join(', ')}`);
    return { files, snippet: javaSnippet(ctx.loader, version, plan.registrations, form.namespace) };
  });

  host.handle('generator.copy', async (p: { text: string }) => {
    await vscode.env.clipboard.writeText(p.text);
    void vscode.window.setStatusBarMessage(vscode.l10n.t('Copied to clipboard'), 2000);
  });

}
