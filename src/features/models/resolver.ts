// Host-side model resolution for the viewer and generator previews: model id / document -> ResolvedElement[]
// with webview-ready texture refs, texture list, display transforms and notes.
import * as vscode from 'vscode';
import type { Core } from '../../core/core';
import type { FaceName, ModelDisplayTransform, ResolvedElement, ResolvedFace, TextureRef } from '../../shared/protocol';
import { normalizeId, parseRL } from '../../core/resourceLocation';
import { applyElementRotation, generatedLayers, mergeChain, RawModel, resolveTextureVar, rotateElements } from './modelMath';
import type { GeneratedLayer, ViewerTexture } from './viewTypes';

export interface ResolveOptions {
  /** Raw json of the root model (unsaved document) instead of loading it. */
  root?: RawModel;
  x?: number;
  y?: number;
  uvlock?: boolean;
  /** Tint colours by tintindex (item definitions). */
  tints?: (string | undefined)[];
  /** In-memory models (generator preview) looked up before workspace / vanilla. */
  overlay?: Record<string, object>;
  /** Texture refs that override lookups (generator placeholders as data: URIs). */
  textureOverride?: Record<string, TextureRef>;
}

export interface ResolvedModel {
  id: string;
  elements: ResolvedElement[];
  /** Raw element index of each resolved element (for highlighting / names). */
  rawElements: any[];
  elementsFrom?: string;
  generated: GeneratedLayer[];
  textures: ViewerTexture[];
  display: Record<string, ModelDisplayTransform>;
  chain: { id: string; found: boolean }[];
  notes: string[];
  tint?: string;
}

const FOLIAGE = '#48b518';
const GRASS = '#7cbd6b';

export class ModelResolver {
  constructor(private readonly core: Core) {}

  /** Convert a file/atlas TextureRef (src = file URI string) to a webview-safe one. */
  toWebview(ref: TextureRef | null, webview: vscode.Webview): TextureRef | null {
    if (!ref) return null;
    if (ref.src.startsWith('data:')) return ref;
    return { ...ref, src: webview.asWebviewUri(vscode.Uri.parse(ref.src)).toString() };
  }

  async resolve(modelId: string, version: string, webview: vscode.Webview, opts: ResolveOptions = {}): Promise<ResolvedModel> {
    const id = normalizeId(modelId);
    const notes: string[] = [];
    const merged = await mergeChain(id, opts.root, async (mid) => {
      if (opts.overlay?.[mid]) return opts.overlay[mid] as RawModel;
      return (await this.core.icons.loadModel(mid, version)) as RawModel | undefined;
    });
    const missingParent = merged.chain.find((c) => !c.found);
    if (missingParent) notes.push(`Model not found: ${missingParent.id}`);
    if (merged.builtinEntity) notes.push('builtin/entity: this model is rendered by code (block entity renderer).');

    const refCache = new Map<string, Promise<{ ref: TextureRef | null; fileUri?: string }>>();
    const lookup = (texId: string) => {
      let p = refCache.get(texId);
      if (!p) {
        p = (async () => {
          const norm = normalizeId(texId);
          const override = opts.textureOverride?.[norm];
          if (override) return { ref: override };
          const ref = await this.core.icons.textureRef(norm, version);
          const file = this.core.index.find('textures', norm);
          return { ref: this.toWebview(ref, webview), fileUri: file?.toString() };
        })();
        refCache.set(texId, p);
      }
      return p;
    };

    // Texture list
    const uses = new Map<string, number>();
    const unresolvedRefs = new Set<string>();
    for (const el of merged.elements ?? [])
      for (const f of Object.values<any>(el?.faces ?? {})) {
        const t = String(f?.texture ?? '');
        const name = t.replace(/^#/, '');
        uses.set(name, (uses.get(name) ?? 0) + 1);
        if (t.startsWith('#') && !(name in merged.textures)) unresolvedRefs.add(name);
      }
    const textures: ViewerTexture[] = [];
    for (const [name, raw] of Object.entries(merged.textures)) {
      const res = resolveTextureVar(raw, merged.textures);
      const r = res.id ? await lookup(res.id) : { ref: null };
      textures.push({ model: merged.textureOwner[name] ?? id, name, raw, id: res.id ? normalizeId(res.id) : undefined, ref: r.ref, missing: !r.ref, fileUri: r.fileUri, uses: uses.get(name) ?? 0 });
    }
    for (const name of unresolvedRefs) textures.push({ model: id, name, raw: `#${name}`, ref: null, missing: true, uses: uses.get(name) ?? 0 });

    const tint = opts.tints?.find((t) => !!t) ?? defaultTint(id, merged.textures);
    const result: ResolvedModel = {
      id,
      elements: [],
      rawElements: [],
      elementsFrom: merged.elementsFrom,
      generated: [],
      textures,
      display: merged.display,
      chain: merged.chain,
      notes,
      tint,
    };

    if (merged.generated && !merged.elements) {
      for (const layer of generatedLayers(merged.textures)) {
        const i = Number(layer.slice(5));
        const res = resolveTextureVar(`#${layer}`, merged.textures);
        const r = res.id ? await lookup(res.id) : { ref: null };
        result.generated.push({ texture: r.ref, tint: opts.tints?.[i], tintindex: i });
      }
      return result;
    }

    let approx = false;
    for (const raw of merged.elements ?? []) {
      if (!raw || !Array.isArray(raw.from) || !Array.isArray(raw.to)) continue;
      const faces: ResolvedElement['faces'] = {};
      for (const [face, f] of Object.entries<any>(raw.faces ?? {})) {
        if (!f) continue;
        const res = resolveTextureVar(String(f.texture ?? ''), merged.textures);
        const r = res.id ? await lookup(res.id) : { ref: null };
        const rf: ResolvedFace = { texture: r.ref };
        if (Array.isArray(f.uv) && f.uv.length === 4) rf.uv = f.uv.map(Number) as [number, number, number, number];
        if (f.rotation) rf.rotation = (((Number(f.rotation) % 360) + 360) % 360) as 0 | 90 | 180 | 270;
        if (f.tintindex !== undefined) rf.tintindex = Number(f.tintindex);
        faces[face as FaceName] = rf;
      }
      const base: ResolvedElement = { from: raw.from.map(Number), to: raw.to.map(Number), shade: raw.shade, faces } as ResolvedElement;
      const r = applyElementRotation(base, raw.rotation);
      if (r.approximate) approx = true;
      result.elements.push(r.el);
      result.rawElements.push(raw);
    }
    if (approx) notes.push('Some element rotations use several free axes and are shown approximately.');
    if (opts.x || opts.y) result.elements = rotateElements(result.elements, opts.x ?? 0, opts.y ?? 0, !!opts.uvlock);
    if (!merged.elements && !merged.generated && !merged.builtinEntity && !missingParent) notes.push('This model has no elements (nothing to draw).');
    return result;
  }
}

function defaultTint(modelId: string, textures: Record<string, string>): string | undefined {
  const p = `${parseRL(modelId).path} ${Object.values(textures).join(' ')}`;
  if (/birch_leaves/.test(p)) return '#80a755';
  if (/spruce_leaves/.test(p)) return '#619961';
  if (/leaves|vine|lily_pad/.test(p)) return FOLIAGE;
  if (/grass|fern|sugar_cane/.test(p)) return GRASS;
  return undefined;
}
