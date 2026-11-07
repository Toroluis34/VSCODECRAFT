import * as vscode from 'vscode';
import type { Core } from '../../core/core';
import { normalizeId, parseRL } from '../../core/resourceLocation';
import { decodePng, encodePng } from './png';
import { crop, frameLayout, RgbaImage, scaleNearest } from './pixels';
import { hashString } from './textureRefs';

export interface LoadedTexture {
  image: RgbaImage;
  source: 'workspace' | 'vanilla';
  /** Workspace file (for workspace textures). */
  fileUri?: vscode.Uri;
  id: string;
}

export interface TexturePreview {
  /** Cached, upscaled first frame (PNG in global storage). */
  uri: vscode.Uri;
  width: number;
  height: number;
  frames: number;
  source: 'workspace' | 'vanilla';
  fileUri?: vscode.Uri;
}

/**
 * Loads textures (workspace PNGs or sprites cropped out of the vanilla atlas) on the extension host
 * with the pure-TS PNG codec and writes small upscaled preview PNGs for hovers / gutter icons.
 */
export class TextureService implements vscode.Disposable {
  private atlasMemo = new Map<string, Promise<{ img: RgbaImage; sprites: Record<string, [number, number, number, number]> } | undefined>>();
  private atlasTimer: NodeJS.Timeout | undefined;
  private previewMemo = new Map<string, Promise<TexturePreview | undefined>>();
  private readonly dir: vscode.Uri;

  constructor(private readonly core: Core) {
    this.dir = vscode.Uri.joinPath(core.context.globalStorageUri, 'texture-previews');
    core.track(
      core.index.onDidChangeContent((u) => {
        if (u.path.endsWith('.png')) this.previewMemo.clear();
      }),
      core.index.onDidChange(() => this.previewMemo.clear()),
      core.vanilla.onDidDownload(() => {
        this.atlasMemo.clear();
        this.previewMemo.clear();
      }),
    );
  }

  /** Decode a PNG file (undefined when missing or invalid). */
  async decodeFile(uri: vscode.Uri): Promise<RgbaImage | undefined> {
    try {
      return decodePng(await vscode.workspace.fs.readFile(uri));
    } catch {
      return undefined;
    }
  }

  /** The decoded vanilla atlas of a version (kept in memory for two minutes after last use). */
  atlas(version: string): Promise<{ img: RgbaImage; sprites: Record<string, [number, number, number, number]> } | undefined> {
    clearTimeout(this.atlasTimer);
    this.atlasTimer = setTimeout(() => this.atlasMemo.clear(), 120_000);
    let p = this.atlasMemo.get(version);
    if (!p) {
      p = (async () => {
        const atlas = await this.core.vanilla.atlas(version);
        if (!atlas) return undefined;
        const img = await this.decodeFile(atlas.image);
        return img ? { img, sprites: atlas.sprites } : undefined;
      })();
      this.atlasMemo.set(version, p);
      p.then((v) => v ?? this.atlasMemo.delete(version), () => this.atlasMemo.delete(version));
    }
    return p;
  }

  /** Vanilla sprite names available in the atlas ("block/stone", "item/diamond" ...). */
  async vanillaSprites(version: string): Promise<string[]> {
    const atlas = await this.core.vanilla.atlas(version);
    return atlas ? Object.keys(atlas.sprites).sort() : [];
  }

  /** Crop a vanilla sprite (full animation strip) out of the atlas. Falls back to downloading the PNG. */
  async vanillaSprite(path: string, version: string): Promise<RgbaImage | undefined> {
    const atlas = await this.atlas(version);
    const rect = atlas?.sprites[path];
    if (atlas && rect) return crop(atlas.img, { x: rect[0], y: rect[1], w: rect[2], h: rect[3] });
    const file = await this.core.vanilla.assetBinary(version, `assets/minecraft/textures/${path}.png`);
    return file ? this.decodeFile(file) : undefined;
  }

  /** Vanilla .png.mcmeta (animation settings) of a sprite, if it has one. */
  async vanillaMcmeta(path: string, version: string): Promise<unknown> {
    return this.core.vanilla.fetchJson(`${version}-assets`, `assets/minecraft/textures/${path}.png.mcmeta`);
  }

  /** Load a texture by id: workspace first, then vanilla. */
  async load(textureId: string, contextUri?: vscode.Uri, version = this.core.version(contextUri)): Promise<LoadedTexture | undefined> {
    const id = normalizeId(textureId);
    const ws = this.core.index.find('textures', id);
    if (ws) {
      const image = await this.decodeFile(ws);
      return image ? { image, source: 'workspace', fileUri: ws, id } : undefined;
    }
    const rl = parseRL(id);
    if (rl.namespace !== 'minecraft') return undefined;
    const image = await this.vanillaSprite(rl.path, version);
    return image ? { image, source: 'vanilla', id } : undefined;
  }

  /** Does a texture id resolve (workspace file or vanilla atlas sprite)? Cheap: no decoding. */
  async exists(textureId: string, contextUri?: vscode.Uri): Promise<boolean> {
    const id = normalizeId(textureId);
    if (this.core.index.find('textures', id)) return true;
    const rl = parseRL(id);
    if (rl.namespace !== 'minecraft') return false;
    const atlas = await this.core.vanilla.atlas(this.core.version(contextUri));
    return !!atlas?.sprites[rl.path];
  }

  /**
   * Upscaled (nearest neighbour) first frame of a texture written to a cache PNG, for markdown hovers
   * and gutter icons. `size` is the target edge length in pixels.
   */
  preview(textureId: string, contextUri?: vscode.Uri, size = 64): Promise<TexturePreview | undefined> {
    const id = normalizeId(textureId);
    const ws = this.core.index.find('textures', id);
    const version = this.core.version(contextUri);
    const key = `${ws?.toString() ?? `${version}|${id}`}|${size}`;
    let p = this.previewMemo.get(key);
    if (!p) {
      p = this.makePreview(id, ws, version, size, key).catch((e) => {
        this.core.log.warn(`texture preview ${id}: ${e}`);
        return undefined;
      });
      this.previewMemo.set(key, p);
    }
    return p;
  }

  private async makePreview(id: string, ws: vscode.Uri | undefined, version: string, size: number, key: string): Promise<TexturePreview | undefined> {
    let stamp = '';
    if (ws) {
      try {
        const st = await vscode.workspace.fs.stat(ws);
        stamp = `${st.mtime}:${st.size}`;
      } catch {
        return undefined;
      }
    }
    const loaded = await this.load(id, undefined, version);
    if (!loaded) return undefined;
    const { image } = loaded;
    const layout = frameLayout(image.width, image.height);
    const frame = layout.count > 1 ? crop(image, { x: 0, y: 0, w: layout.frameWidth, h: layout.frameHeight }) : image;
    const longest = Math.max(frame.width, frame.height);
    const factor = longest <= size ? Math.max(1, Math.floor(size / longest)) : size / longest;
    const scaled = scaleNearest(frame, Math.max(1, Math.round(frame.width * factor)), Math.max(1, Math.round(frame.height * factor)));
    const file = vscode.Uri.joinPath(this.dir, `${hashString(key + stamp)}-${hashString(id)}.png`);
    try {
      await vscode.workspace.fs.stat(file);
    } catch {
      await vscode.workspace.fs.createDirectory(this.dir);
      await vscode.workspace.fs.writeFile(file, encodePng(scaled, { level: 6 }));
    }
    return { uri: file, width: image.width, height: image.height, frames: layout.count, source: loaded.source, fileUri: loaded.fileUri };
  }

  dispose(): void {
    clearTimeout(this.atlasTimer);
    this.atlasMemo.clear();
  }
}
