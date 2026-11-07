import * as vscode from 'vscode';
import type { Core } from '../../core/core';
import { classifyPath, normalizeId, parseRL, resourceRelativePath } from '../../core/resourceLocation';
import { exists } from '../../core/fsUtils';
import { encodePng, readPngSize } from './png';
import { createImage, frameLayout, fromWire, RgbaImage, textureWarnings, toWire } from './pixels';
import { writeAnimation } from './mcmeta';
import type { AtlasEntry, VariantBoot, VariantOutput, VariantSource } from './protocol';
import { TEXTURE_EDITOR_VIEW_TYPE } from './editorProvider';
import type { TextureService } from './previews';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Resolve a command argument (Uri, uri string, explorer selection) or fall back to the active tab. */
export function targetUri(arg?: unknown): vscode.Uri | undefined {
  if (arg instanceof vscode.Uri) return arg;
  if (typeof arg === 'string') return arg.includes('://') || arg.startsWith('file:') ? vscode.Uri.parse(arg) : vscode.Uri.file(arg);
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input as { uri?: vscode.Uri } | undefined;
  if (input?.uri instanceof vscode.Uri) return input.uri;
  return vscode.window.activeTextEditor?.document.uri;
}

export async function openInTextureEditor(uri: vscode.Uri, column?: vscode.ViewColumn): Promise<void> {
  await vscode.commands.executeCommand('vscode.openWith', uri, TEXTURE_EDITOR_VIEW_TYPE, column);
}

/** Workspace texture files (PNG only — the index also contains .png.mcmeta files under "textures"). */
export function workspaceTextures(core: Core) {
  return core.index.all('textures').filter((r) => r.ext === 'png');
}

function hasMcmeta(core: Core, id: string): boolean {
  return core.index.get('textures', `${id}.png`).some((r) => r.ext === 'mcmeta');
}

async function writeTexture(uri: vscode.Uri, img: RgbaImage, mcmeta?: unknown): Promise<void> {
  await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, '..'));
  await vscode.workspace.fs.writeFile(uri, encodePng(img));
  if (mcmeta) await vscode.workspace.fs.writeFile(uri.with({ path: uri.path + '.mcmeta' }), encoder.encode(JSON.stringify(mcmeta, null, 2) + '\n'));
}

async function confirmOverwrite(uri: vscode.Uri): Promise<boolean> {
  if (!(await exists(uri))) return true;
  const yes = vscode.l10n.t('Overwrite');
  const pick = await vscode.window.showWarningMessage(
    vscode.l10n.t('{0} already exists. Overwrite it?', vscode.workspace.asRelativePath(uri)),
    { modal: true },
    yes,
  );
  return pick === yes;
}

/** Ask for a texture id ("block/ruby_ore", "mymod:item/ruby"); folder prefix taken from the explorer context. */
async function askTextureId(core: Core, ctx: vscode.Uri | undefined, suggestion: string): Promise<string | undefined> {
  const ns = core.projects.defaultNamespace(ctx);
  const value = await vscode.window.showInputBox({
    title: vscode.l10n.t('Texture id'),
    prompt: vscode.l10n.t('Path inside assets/<namespace>/textures, e.g. block/ruby_ore or item/ruby (namespace optional)'),
    value: suggestion.includes(':') ? suggestion : `${ns}:${suggestion}`,
    valueSelection: [suggestion.includes(':') ? suggestion.indexOf(':') + 1 : ns.length + 1, (suggestion.includes(':') ? suggestion.length : ns.length + 1 + suggestion.length)],
    validateInput: (v) => {
      const rl = parseRL(v.trim(), ns);
      if (!rl.path || !/^[a-z0-9_./-]+$/.test(rl.path) || !/^[a-z0-9_.-]+$/.test(rl.namespace)) {
        return vscode.l10n.t('Use lowercase letters, digits, _ - . and / only');
      }
      return undefined;
    },
  });
  if (!value) return undefined;
  const rl = parseRL(value.trim(), ns);
  return `${rl.namespace}:${rl.path.replace(/\.png$/, '')}`;
}

function textureFileUri(core: Core, ctx: vscode.Uri | undefined, id: string): vscode.Uri | undefined {
  // When the context is inside a resource root use it, otherwise the project's main resource root.
  const info = ctx ? classifyPath(ctx.fsPath) : undefined;
  const root = info ? vscode.Uri.file(info.root) : core.projects.resourceRoot(ctx);
  return root ? vscode.Uri.joinPath(root, resourceRelativePath('assets', 'textures', id)) : undefined;
}

/** Folder suggestion from an explorer folder/file inside textures/ ("block/"). */
function folderHint(ctx: vscode.Uri | undefined): string {
  if (!ctx) return 'item/';
  const info = classifyPath(ctx.fsPath + (ctx.path.endsWith('.png') ? '' : '/x'));
  if (info?.kind !== 'textures') return 'item/';
  const dir = info.path.split('/').slice(0, -1).join('/');
  return dir ? `${info.namespace}:${dir}/` : `${info.namespace}:`;
}

export function registerTextureCommands(core: Core, textures: TextureService): void {
  core.registerCommand('vscodecraft.textures.openEditor', async (arg?: unknown) => {
    const uri = targetUri(arg);
    if (!uri || !uri.path.toLowerCase().endsWith('.png')) {
      const picked = await pickWorkspaceTexture(core, vscode.l10n.t('Texture to open'));
      if (picked) await openInTextureEditor(picked);
      return;
    }
    await openInTextureEditor(uri);
  });

  core.registerCommand('vscodecraft.textures.newTexture', (arg?: unknown) => newTexture(core, textures, arg instanceof vscode.Uri ? arg : undefined));
  core.registerCommand('vscodecraft.textures.createVariant', (arg?: unknown, all?: unknown) => {
    const list = Array.isArray(all) ? all.filter((u): u is vscode.Uri => u instanceof vscode.Uri) : [];
    const one = targetUri(arg);
    const uris = list.length ? list : one && one.path.endsWith('.png') ? [one] : [];
    return openVariantPanel(core, textures, uris);
  });
  core.registerCommand('vscodecraft.textures.generateMcmeta', (arg?: unknown) => generateMcmeta(core, arg));
  core.registerCommand('vscodecraft.textures.atlasOverview', () => openAtlasOverview(core));
}

async function pickWorkspaceTexture(core: Core, placeHolder: string): Promise<vscode.Uri | undefined> {
  const items = workspaceTextures(core)
    .map((r) => ({ label: r.id, description: vscode.workspace.asRelativePath(r.uri), uri: r.uri }))
    .sort((a, b) => a.label.localeCompare(b.label));
  if (!items.length) {
    void vscode.window.showInformationMessage(vscode.l10n.t('No textures found in the workspace.'));
    return undefined;
  }
  return (await vscode.window.showQuickPick(items, { placeHolder, matchOnDescription: true }))?.uri;
}

// ---------- New Texture… ----------

async function newTexture(core: Core, textures: TextureService, ctx?: vscode.Uri): Promise<void> {
  type Mode = 'blank' | 'vanilla' | 'recolor';
  const mode = await vscode.window.showQuickPick<{ label: string; detail: string; mode: Mode }>(
    [
      { label: `$(file-media) ${vscode.l10n.t('Blank texture')}`, detail: vscode.l10n.t('Transparent canvas of 16, 32 or 64 pixels'), mode: 'blank' },
      { label: `$(copy) ${vscode.l10n.t('Copy of a vanilla texture')}`, detail: vscode.l10n.t('Start from any Minecraft block/item texture (animation included)'), mode: 'vanilla' },
      { label: `$(symbol-color) ${vscode.l10n.t('Recolor of an existing texture')}`, detail: vscode.l10n.t('Hue/saturation/brightness variant of a workspace or vanilla texture'), mode: 'recolor' },
    ],
    { title: vscode.l10n.t('New Texture'), placeHolder: vscode.l10n.t('How do you want to start?') },
  );
  if (!mode) return;
  const ctxUri = ctx ?? targetUri();

  if (mode.mode === 'recolor') {
    const picked = ctx?.path.endsWith('.png') ? ctx : undefined;
    await openVariantPanel(core, textures, picked ? [picked] : []);
    return;
  }

  let image: RgbaImage | undefined;
  let mcmeta: unknown;
  let suggestion = folderHint(ctx);

  if (mode.mode === 'blank') {
    const size = await vscode.window.showQuickPick(
      ['16', '32', '64', '128'].map((s) => ({ label: `${s} × ${s}`, size: Number(s) })),
      { title: vscode.l10n.t('Texture size'), placeHolder: vscode.l10n.t('Vanilla textures are 16 × 16') },
    );
    if (!size) return;
    image = createImage(size.size, size.size);
  } else {
    const version = core.version(ctxUri);
    const sprites = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: vscode.l10n.t('Loading vanilla textures…') },
      () => textures.vanillaSprites(version),
    );
    if (!sprites.length) {
      void vscode.window.showWarningMessage(vscode.l10n.t('Vanilla textures are not available (download the data with "VSCodeCraft: Download Data").'));
      return;
    }
    const pick = await vscode.window.showQuickPick(
      sprites.map((s) => ({ label: s, description: s.split('/')[0] })),
      { title: vscode.l10n.t('Vanilla texture to copy ({0})', version), placeHolder: 'block/diamond_ore', matchOnDescription: true },
    );
    if (!pick) return;
    image = await textures.vanillaSprite(pick.label, version);
    mcmeta = await textures.vanillaMcmeta(pick.label, version);
    if (!image) throw new Error(vscode.l10n.t('Could not read {0}', pick.label));
    suggestion = pick.label;
  }

  const id = await askTextureId(core, ctxUri, suggestion.endsWith('/') || suggestion.endsWith(':') ? `${suggestion}new_texture` : suggestion);
  if (!id) return;
  const uri = textureFileUri(core, ctx ?? ctxUri, id);
  if (!uri) throw new Error(vscode.l10n.t('Open a mod project or resource pack first'));
  if (!(await confirmOverwrite(uri))) return;
  await writeTexture(uri, image, mcmeta);
  await openInTextureEditor(uri);
}

// ---------- Generate Animation .mcmeta ----------

async function generateMcmeta(core: Core, arg?: unknown): Promise<void> {
  let uri = targetUri(arg);
  if (!uri || !uri.path.toLowerCase().endsWith('.png')) uri = await pickWorkspaceTexture(core, vscode.l10n.t('Animated texture (vertical strip of frames)'));
  if (!uri) return;
  const size = readPngSize(await vscode.workspace.fs.readFile(uri));
  if (!size) throw new Error(vscode.l10n.t('{0} is not a valid PNG file', vscode.workspace.asRelativePath(uri)));
  const layout = frameLayout(size.width, size.height);
  if (layout.count < 2) {
    const go = vscode.l10n.t('Create anyway');
    const answer = await vscode.window.showWarningMessage(
      vscode.l10n.t('This texture has a single frame ({0} × {1}). Animated textures are vertical strips whose height is a multiple of the width.', size.width, size.height),
      go,
    );
    if (answer !== go) return;
  }
  const frametime = await vscode.window.showInputBox({
    title: vscode.l10n.t('Animation: {0} frames', layout.count),
    prompt: vscode.l10n.t('Ticks per frame (20 ticks = 1 second)'),
    value: '2',
    validateInput: (v) => (/^\d+$/.test(v.trim()) && Number(v) > 0 ? undefined : vscode.l10n.t('Enter a positive whole number')),
  });
  if (!frametime) return;
  const interp = await vscode.window.showQuickPick(
    [
      { label: vscode.l10n.t('No interpolation'), value: false },
      { label: vscode.l10n.t('Interpolate between frames (smooth fade)'), value: true },
    ],
    { title: vscode.l10n.t('Interpolation') },
  );
  if (!interp) return;
  const target = uri.with({ path: uri.path + '.mcmeta' });
  let existing: unknown;
  try {
    existing = JSON.parse(decoder.decode(await vscode.workspace.fs.readFile(target)));
    const yes = vscode.l10n.t('Overwrite');
    if ((await vscode.window.showWarningMessage(vscode.l10n.t('{0} already exists. Overwrite it?', vscode.workspace.asRelativePath(target)), { modal: true }, yes)) !== yes) return;
  } catch {
    /* new file */
  }
  const json = writeAnimation(existing, { frametime: Number(frametime), interpolate: interp.value });
  await vscode.workspace.fs.writeFile(target, encoder.encode(JSON.stringify(json, null, 2) + '\n'));
  await vscode.window.showTextDocument(target, { preview: true });
}

// ---------- Create Material Variant… ----------

async function openVariantPanel(core: Core, textures: TextureService, preselect: vscode.Uri[]): Promise<void> {
  const ctx = preselect[0] ?? targetUri();
  const version = core.version(ctx);
  const ws = workspaceTextures(core);
  const sources: Omit<VariantSource, 'image'>[] = ws.map((r) => ({
    id: r.id,
    path: r.path,
    namespace: r.namespace,
    uri: r.uri.toString(),
    hasMcmeta: hasMcmeta(core, r.id),
  }));
  const known = new Set(sources.map((s) => s.id));
  for (const s of await textures.vanillaSprites(version)) {
    if (!/^(block|item)\//.test(s) || known.has(`minecraft:${s}`)) continue;
    sources.push({ id: `minecraft:${s}`, path: s, namespace: 'minecraft', uri: '', hasMcmeta: false });
  }
  const selected = preselect.map((u) => classifyPath(u.fsPath)).filter((i) => i?.kind === 'textures').map((i) => i!.id);
  const project = core.projects.projectFor(ctx);
  const boot: Omit<VariantBoot, 'sources'> & { sources: Omit<VariantSource, 'image'>[] } = {
    sources,
    selected,
    namespaces: [...new Set([core.projects.defaultNamespace(ctx), ...(project?.namespaces ?? [])])],
    defaultNamespace: core.projects.defaultNamespace(ctx),
  };
  const { panel } = core.webviews.createPanel({
    viewType: 'vscodecraft.textureVariant',
    title: vscode.l10n.t('Material Variant'),
    bundle: 'textureVariant',
    state: boot,
    documentUri: ctx,
    handlers: {
      'variant.images': async (p: { ids: string[] }) => {
        const out: Record<string, unknown> = {};
        for (const id of p.ids.slice(0, 200)) {
          const t = await textures.load(id, ctx, version);
          if (t) out[id] = toWire(t.image);
        }
        return out;
      },
      'variant.exists': (p: { ids: string[] }) => {
        const out: Record<string, boolean> = {};
        for (const id of p.ids) out[id] = !!core.index.find('textures', normalizeId(id));
        return out;
      },
      'variant.create': async (p: { outputs: VariantOutput[]; overwrite: boolean; open: boolean }) => {
        const written: vscode.Uri[] = [];
        const skipped: string[] = [];
        for (const o of p.outputs) {
          const id = normalizeId(o.targetId);
          const uri = core.index.find('textures', id) ?? textureFileUri(core, ctx, id);
          if (!uri) throw new Error(vscode.l10n.t('Open a mod project or resource pack first'));
          if (!p.overwrite && (await exists(uri))) {
            skipped.push(id);
            continue;
          }
          // Copy the animation settings of the source.
          let mcmeta: unknown;
          const src = normalizeId(o.sourceId);
          const srcUri = core.index.find('textures', src);
          if (srcUri) {
            try {
              mcmeta = JSON.parse(decoder.decode(await vscode.workspace.fs.readFile(srcUri.with({ path: srcUri.path + '.mcmeta' }))));
            } catch {
              /* none */
            }
          } else if (src.startsWith('minecraft:')) {
            mcmeta = await textures.vanillaMcmeta(parseRL(src).path, version);
          }
          await writeTexture(uri, fromWire(o.image), mcmeta);
          written.push(uri);
        }
        if (written.length) {
          const open = vscode.l10n.t('Open');
          void vscode.window
            .showInformationMessage(vscode.l10n.t('Created {0} texture(s).', written.length) + (skipped.length ? ' ' + vscode.l10n.t('Skipped {0} existing.', skipped.length) : ''), open)
            .then((a) => a === open && written.slice(0, 8).forEach((u) => void openInTextureEditor(u, vscode.ViewColumn.Active)));
        } else if (skipped.length) {
          void vscode.window.showWarningMessage(vscode.l10n.t('All {0} target textures already exist. Enable "Overwrite existing" to replace them.', skipped.length));
        }
        return { written: written.map((u) => u.toString()), skipped };
      },
    },
  });
}

// ---------- Texture Atlas Overview ----------

async function atlasEntries(core: Core, webview: vscode.Webview): Promise<AtlasEntry[]> {
  const out: AtlasEntry[] = [];
  await Promise.all(
    workspaceTextures(core).map(async (r) => {
      let bytes: Uint8Array;
      try {
        bytes = await vscode.workspace.fs.readFile(r.uri);
      } catch {
        return;
      }
      const size = readPngSize(bytes) ?? { width: 0, height: 0 };
      const mc = hasMcmeta(core, r.id);
      let frameW: number | undefined;
      let frameH: number | undefined;
      if (mc) {
        try {
          const meta = JSON.parse(decoder.decode(await vscode.workspace.fs.readFile(r.uri.with({ path: r.uri.path + '.mcmeta' }))));
          frameW = meta?.animation?.width;
          frameH = meta?.animation?.height;
        } catch {
          /* ignore */
        }
      }
      const folder = r.path.split('/').slice(0, -1).join('/');
      const warnings: string[] = size.width ? textureWarnings(size.width, size.height, mc, folder) : ['invalid'];
      out.push({
        id: r.id,
        namespace: r.namespace,
        path: r.path,
        folder,
        uri: r.uri.toString(),
        src: webview.asWebviewUri(r.uri).toString(),
        width: size.width,
        height: size.height,
        frames: mc ? frameLayout(size.width, size.height, frameW, frameH).count : 1,
        hasMcmeta: mc,
        warnings,
        bytes: bytes.length,
      });
    }),
  );
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

let atlasPanel: vscode.WebviewPanel | undefined;

async function openAtlasOverview(core: Core): Promise<void> {
  if (atlasPanel) {
    atlasPanel.reveal();
    return;
  }
  const { panel, host } = core.webviews.createPanel({
    viewType: 'vscodecraft.textureAtlas',
    title: vscode.l10n.t('Texture Atlas'),
    bundle: 'textureAtlas',
    state: {},
    handlers: {
      'atlas.list': (_p, h) => atlasEntries(core, h.webview),
      'atlas.open': async (p: { uri: string }) => openInTextureEditor(vscode.Uri.parse(p.uri), vscode.ViewColumn.Beside),
      'atlas.reveal': async (p: { uri: string }) => vscode.commands.executeCommand('revealInExplorer', vscode.Uri.parse(p.uri)),
      'atlas.newTexture': async () => vscode.commands.executeCommand('vscodecraft.textures.newTexture'),
      'atlas.generateMcmeta': async (p: { uri: string }) => vscode.commands.executeCommand('vscodecraft.textures.generateMcmeta', vscode.Uri.parse(p.uri)),
    },
  });
  atlasPanel = panel;
  let timer: NodeJS.Timeout | undefined;
  const refresh = () => {
    clearTimeout(timer);
    timer = setTimeout(() => void host.post('atlas.refresh'), 400);
  };
  const subs = [
    core.index.onDidChange(refresh),
    core.index.onDidChangeContent((u) => {
      if (/\.png(\.mcmeta)?$/.test(u.path)) refresh();
    }),
  ];
  panel.onDidDispose(() => {
    atlasPanel = undefined;
    clearTimeout(timer);
    subs.forEach((s) => s.dispose());
  });
}
