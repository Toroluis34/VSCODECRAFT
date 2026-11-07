import * as vscode from 'vscode';
import type { FaceName, ItemVisual, ModelDisplayTransform, ResolvedElement, TextureRef } from '../shared/protocol';
import { humanize, normalizeId, parseRL } from './resourceLocation';
import { atLeast } from './versions';
import type { WorkspaceIndex } from './workspaceIndex';
import type { VanillaDataService } from './vanillaData';
import type { ProjectService } from './projects';
import type { RegistryService } from './registries';
import type { Logger } from './logger';

interface RawModel {
  parent?: string;
  textures?: Record<string, string | { sprite: string; force_translucent?: boolean }>;
  elements?: any[];
  display?: Record<string, ModelDisplayTransform>;
}

interface MergedModel {
  textures: Record<string, string>;
  elements?: any[];
  gui?: ModelDisplayTransform;
  generated: boolean;
  builtinEntity: boolean;
  chain: string[];
}

const FOLIAGE = '#48b518';
const GRASS = '#7cbd6b';

/**
 * Resolves what an item/block looks like (model chain + textures) using workspace assets first and
 * vanilla data (downloaded atlas/models) second. Results are converted to webview URIs on demand.
 */
export class IconService implements vscode.Disposable {
  private cache = new Map<string, Promise<ItemVisual>>();
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly index: WorkspaceIndex,
    private readonly vanilla: VanillaDataService,
    private readonly projects: ProjectService,
    private readonly registries: RegistryService,
    private readonly log: Logger,
  ) {
    const clear = () => this.cache.clear();
    this.disposables.push(index.onDidChange(clear), index.onDidChangeContent(clear), projects.onDidChange(clear), vanilla.onDidDownload(clear));
  }

  /** Resolve an item (or "#tag" → its first item) for display in a webview. */
  async resolveItem(id: string, webview: vscode.Webview, uri?: vscode.Uri): Promise<ItemVisual> {
    const version = this.projects.targetVersion(uri);
    let itemId = normalizeId(id);
    if (itemId.startsWith('#')) {
      const first = (await this.registries.expandTag(itemId, 'item', uri))[0];
      if (!first) return { type: 'missing', id, label: itemId };
      itemId = first;
    }
    const key = `${version}|${itemId}`;
    let p = this.cache.get(key);
    if (!p) {
      p = this.resolveItemRaw(itemId, version).catch((e) => {
        this.log.warn(`icon ${itemId}: ${e}`);
        return { type: 'missing', id: itemId, label: humanize(parseRL(itemId).path) } as ItemVisual;
      });
      this.cache.set(key, p);
    }
    return toWebview(await p, webview, id);
  }

  /** Resolve a texture id ("mymod:item/ruby", "block/stone") to a webview-ready reference. */
  async resolveTexture(textureId: string, webview: vscode.Webview, uri?: vscode.Uri): Promise<TextureRef | null> {
    const version = this.projects.targetVersion(uri);
    const ref = await this.textureRef(normalizeId(textureId), version);
    return ref ? { ...ref, src: webview.asWebviewUri(vscode.Uri.parse(ref.src)).toString() } : null;
  }

  /** File URI (workspace) or atlas location (vanilla) of a texture id. src is a file URI string. */
  async textureRef(textureId: string, version: string): Promise<TextureRef | null> {
    const id = normalizeId(textureId);
    const ws = this.index.find('textures', id);
    if (ws) return { src: ws.toString() };
    const rl = parseRL(id);
    if (rl.namespace !== 'minecraft') return null;
    const atlas = await this.vanilla.atlas(version);
    const rect = atlas?.sprites[rl.path];
    if (atlas && rect) return { src: atlas.image.toString(), rect };
    return null;
  }

  /** Load a model json by id from the workspace or vanilla data. */
  async loadModel(modelId: string, version: string): Promise<RawModel | undefined> {
    const id = normalizeId(modelId);
    const ws = this.index.find('models', id);
    if (ws) return this.index.json<RawModel>(ws);
    const rl = parseRL(id);
    if (rl.namespace !== 'minecraft') return undefined;
    const models = await this.vanilla.models(version);
    return models[rl.path];
  }

  /** Walk the parent chain and merge textures/elements/display. */
  async mergeModel(modelId: string, version: string): Promise<MergedModel> {
    const merged: MergedModel = { textures: {}, generated: false, builtinEntity: false, chain: [] };
    let current: string | undefined = normalizeId(modelId);
    for (let depth = 0; current && depth < 20; depth++) {
      const path = parseRL(current).path;
      merged.chain.push(current);
      if (path === 'builtin/generated') {
        merged.generated = true;
        break;
      }
      if (path === 'builtin/entity') {
        merged.builtinEntity = true;
        break;
      }
      const m = await this.loadModel(current, version);
      if (!m) break;
      for (const [k, v] of Object.entries<any>(m.textures ?? {})) {
        // 26.x allows {"sprite": "...", "force_translucent": true} texture references
        const tex = typeof v === 'string' ? v : typeof v?.sprite === 'string' ? v.sprite : undefined;
        if (tex && !(k in merged.textures)) merged.textures[k] = tex;
      }
      if (!merged.elements && Array.isArray(m.elements)) merged.elements = m.elements;
      if (!merged.gui && m.display?.gui) merged.gui = m.display.gui;
      current = m.parent ? normalizeId(m.parent) : undefined;
    }
    if (!merged.elements && Object.keys(merged.textures).some((k) => /^layer\d+$/.test(k))) merged.generated = true;
    return merged;
  }

  /** Item model id (and tint colours) for an item, honouring item definitions (1.21.4+). */
  async itemModel(itemId: string, version: string): Promise<{ model: string; tints: (string | undefined)[] }> {
    const rl = parseRL(itemId);
    let def: any;
    const ws = this.index.find('items', itemId);
    if (ws) def = await this.index.json(ws);
    else if (rl.namespace === 'minecraft' && atLeast(version, '1.21.4')) def = (await this.vanilla.itemDefinitions(version))[rl.path];
    if (def?.model) {
      const picked = pickModel(def.model);
      if (picked) return picked;
    }
    // Pre-1.21.4 (or no definition): item model lives at <ns>:item/<path>
    return { model: `${rl.namespace}:item/${rl.path}`, tints: [] };
  }

  private async resolveItemRaw(itemId: string, version: string): Promise<ItemVisual> {
    const rl = parseRL(itemId);
    const { model, tints } = await this.itemModel(itemId, version);
    let merged = await this.mergeModel(model, version);
    if (merged.chain.length <= 1 && !Object.keys(merged.textures).length && !merged.elements) {
      // Model missing: try block model with the same name (block items without item model)
      const blockModel = await this.mergeModel(`${rl.namespace}:block/${rl.path}`, version);
      if (blockModel.elements || Object.keys(blockModel.textures).length) merged = blockModel;
    }

    const resolveTex = async (name: string): Promise<TextureRef | null> => {
      let v: string | undefined = merged.textures[name.replace(/^#/, '')];
      for (let i = 0; v?.startsWith('#') && i < 10; i++) v = merged.textures[v.slice(1)];
      if (!v || v.startsWith('#')) return null;
      return this.textureRef(v, version);
    };

    if (merged.generated) {
      const layers: { texture: TextureRef; tint?: string }[] = [];
      for (let i = 0; i < 8; i++) {
        if (!(`layer${i}` in merged.textures)) continue;
        const t = await resolveTex(`layer${i}`);
        if (t) layers.push({ texture: t, tint: tints[i] ?? legacyTint(itemId, i) });
      }
      if (layers.length) return { type: 'flat', id: itemId, layers };
    }

    if (merged.elements?.length) {
      const elements: ResolvedElement[] = [];
      const texCache = new Map<string, TextureRef | null>();
      for (const el of merged.elements) {
        const faces: ResolvedElement['faces'] = {};
        for (const [face, f] of Object.entries<any>(el.faces ?? {})) {
          const texName = String(f.texture ?? '');
          if (!texCache.has(texName)) texCache.set(texName, await resolveTex(texName));
          faces[face as FaceName] = { texture: texCache.get(texName) ?? null, uv: f.uv, rotation: f.rotation, tintindex: f.tintindex };
        }
        elements.push({ from: el.from, to: el.to, rotation: el.rotation, shade: el.shade, faces });
      }
      return { type: 'model', id: itemId, elements, gui: merged.gui, tint: blockTint(itemId, tints) };
    }

    // Last resorts: particle texture, item texture or block texture with the item's name.
    for (const candidate of [
      merged.textures.particle,
      `${rl.namespace}:item/${rl.path}`,
      `${rl.namespace}:block/${rl.path}`,
    ]) {
      if (!candidate || candidate.startsWith('#')) continue;
      const t = await this.textureRef(candidate, version);
      if (t) {
        if (candidate.includes(':block/') || candidate.startsWith('block/')) {
          return { type: 'model', id: itemId, elements: [cubeElement(t)], gui: { rotation: [30, 225, 0], scale: [0.625, 0.625, 0.625] } };
        }
        return { type: 'flat', id: itemId, layers: [{ texture: t }] };
      }
    }
    return { type: 'missing', id: itemId, label: humanize(rl.path) };
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
  }
}

/** Choose a representative model from an item definition's model tree (1.21.4+ format). */
export function pickModel(node: any, depth = 0): { model: string; tints: (string | undefined)[] } | undefined {
  if (!node || typeof node !== 'object' || depth > 10) return undefined;
  const type = String(node.type ?? '').replace(/^minecraft:/, '');
  switch (type) {
    case 'model':
      return { model: String(node.model), tints: (node.tints ?? []).map(tintColor) };
    case 'condition':
      return pickModel(node.on_false, depth + 1) ?? pickModel(node.on_true, depth + 1);
    case 'select':
      return pickModel(node.fallback, depth + 1) ?? pickModel(node.cases?.[0]?.model, depth + 1);
    case 'range_dispatch':
      return pickModel(node.fallback, depth + 1) ?? pickModel(node.entries?.[0]?.model, depth + 1);
    case 'composite':
      return pickModel(node.models?.[0], depth + 1);
    case 'special':
      return node.base ? { model: String(node.base), tints: [] } : undefined;
    default:
      return undefined;
  }
}

function tintColor(t: any): string | undefined {
  if (!t || typeof t !== 'object') return undefined;
  const type = String(t.type ?? '').replace(/^minecraft:/, '');
  const value = t.value ?? t.default;
  if (type === 'grass') return GRASS;
  if (type === 'foliage' || type === 'dry_foliage') return FOLIAGE;
  if (typeof value === 'number') return intToHex(value);
  if (Array.isArray(value)) return `#${value.map((c: number) => Math.round(c * 255).toString(16).padStart(2, '0')).join('')}`;
  return undefined;
}

export function intToHex(n: number): string {
  return `#${((n >>> 0) & 0xffffff).toString(16).padStart(6, '0')}`;
}

function legacyTint(itemId: string, layer: number): string | undefined {
  const p = parseRL(itemId).path;
  if (layer === 0 && p.startsWith('leather_')) return '#a06540';
  if (layer === 0 && /potion|tipped_arrow/.test(p)) return '#385dc6';
  if (/spawn_egg/.test(p)) return layer === 0 ? '#9c9c9c' : '#5c5c5c';
  return undefined;
}

function blockTint(itemId: string, tints: (string | undefined)[]): string | undefined {
  if (tints[0]) return tints[0];
  const p = parseRL(itemId).path;
  if (/birch_leaves/.test(p)) return '#80a755';
  if (/spruce_leaves/.test(p)) return '#619961';
  if (/leaves|vine|lily_pad/.test(p)) return FOLIAGE;
  if (/grass|fern/.test(p)) return GRASS;
  return undefined;
}

function cubeElement(t: TextureRef): ResolvedElement {
  const face = { texture: t };
  return {
    from: [0, 0, 0],
    to: [16, 16, 16],
    faces: { up: face, down: face, north: face, south: face, east: face, west: face },
  };
}

function toWebview(visual: ItemVisual, webview: vscode.Webview, requestedId: string): ItemVisual {
  const conv = (t: TextureRef | null): TextureRef | null =>
    t ? { ...t, src: t.src.startsWith('data:') ? t.src : webview.asWebviewUri(vscode.Uri.parse(t.src)).toString() } : null;
  if (visual.type === 'flat') {
    return { ...visual, id: requestedId, layers: visual.layers.map((l) => ({ ...l, texture: conv(l.texture)! })) };
  }
  if (visual.type === 'model') {
    return {
      ...visual,
      id: requestedId,
      elements: visual.elements.map((e) => ({
        ...e,
        faces: Object.fromEntries(Object.entries(e.faces).map(([k, f]) => [k, f && { ...f, texture: conv(f.texture) }])),
      })),
    };
  }
  return { ...visual, id: requestedId };
}
