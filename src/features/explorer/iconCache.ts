// Small PNG icons for tree items / hovers: workspace textures directly, vanilla textures cropped from the atlas.
import * as vscode from 'vscode';
import type { Core } from '../../core/core';
import { normalizeId, parseRL } from '../../core/resourceLocation';
import { crop, decodePng, encodePng, Image } from './png';
import { pickIconTexture } from './resourceModel';

export class IconCache {
  private atlasImages = new Map<string, Promise<Image | undefined>>();
  private icons = new Map<string, Promise<vscode.Uri | undefined>>();
  private releaseTimer: NodeJS.Timeout | undefined;
  private readonly dir: vscode.Uri;

  constructor(private readonly core: Core) {
    this.dir = vscode.Uri.joinPath(core.context.globalStorageUri, 'explorer-icons');
    core.track(
      core.index.onDidChange(() => this.icons.clear()),
      core.vanilla.onDidDownload(() => {
        this.icons.clear();
        this.atlasImages.clear();
      }),
    );
  }

  /** File URI of a 16x16-ish PNG for a texture id ("mymod:item/ruby", "minecraft:block/stone"). */
  textureIcon(textureId: string, version: string): Promise<vscode.Uri | undefined> {
    const id = normalizeId(textureId);
    const ws = this.core.index.find('textures', id);
    if (ws) return Promise.resolve(ws);
    if (parseRL(id).namespace !== 'minecraft') return Promise.resolve(undefined);
    const key = `${version}|${id}`;
    let p = this.icons.get(key);
    if (!p) {
      p = this.vanillaIcon(id, version).catch(() => undefined);
      this.icons.set(key, p);
    }
    return p;
  }

  /** Icon for an item id (workspace or vanilla) using its item model. */
  async itemIcon(itemId: string, version: string): Promise<vscode.Uri | undefined> {
    try {
      const { model } = await this.core.icons.itemModel(normalizeId(itemId), version);
      let tex = await this.modelTexture(model, version);
      if (!tex) {
        const rl = parseRL(normalizeId(itemId));
        tex = (await this.modelTexture(`${rl.namespace}:block/${rl.path}`, version)) ?? `${rl.namespace}:item/${rl.path}`;
      }
      return tex ? await this.textureIcon(tex, version) : undefined;
    } catch {
      return undefined;
    }
  }

  /** Representative texture id of a model (walks the parent chain). */
  async modelTexture(modelId: string, version: string): Promise<string | undefined> {
    try {
      const merged = await this.core.icons.mergeModel(normalizeId(modelId), version);
      return pickIconTexture(merged.textures);
    } catch {
      return undefined;
    }
  }

  async modelIcon(modelId: string, version: string): Promise<vscode.Uri | undefined> {
    const tex = await this.modelTexture(modelId, version);
    return tex ? this.textureIcon(tex, version) : undefined;
  }

  private async vanillaIcon(id: string, version: string): Promise<vscode.Uri | undefined> {
    const path = parseRL(id).path;
    const target = vscode.Uri.joinPath(this.dir, version, ...`${path}.png`.split('/'));
    try {
      await vscode.workspace.fs.stat(target);
      return target;
    } catch {
      /* not cached yet */
    }
    const atlas = await this.core.vanilla.atlas(version);
    const rect = atlas?.sprites[path];
    if (!atlas || !rect) return undefined;
    const img = await this.atlasImage(version, atlas.image);
    if (!img) return undefined;
    const [x, y, w, h] = rect;
    const size = Math.min(w, h); // animated textures: first frame
    const icon = crop(img, x, y, size, size);
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(target, '..'));
    await vscode.workspace.fs.writeFile(target, encodePng(icon));
    return target;
  }

  private atlasImage(version: string, uri: vscode.Uri): Promise<Image | undefined> {
    let p = this.atlasImages.get(version);
    if (!p) {
      p = (async () => {
        try {
          return decodePng(await vscode.workspace.fs.readFile(uri));
        } catch (e) {
          this.core.log.warn(`explorer: cannot decode atlas ${uri.fsPath}: ${e}`);
          return undefined;
        }
      })();
      this.atlasImages.set(version, p);
    }
    // Release the decoded atlas (~17 MB) after a minute of inactivity.
    clearTimeout(this.releaseTimer);
    this.releaseTimer = setTimeout(() => this.atlasImages.clear(), 60_000);
    return p;
  }
}
