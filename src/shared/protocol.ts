// Types shared between the extension host and the webviews.
// IMPORTANT: this file must not import 'vscode' or any Node module — it is bundled into webviews too.

/** A texture reference a webview can draw. `src` is already a webview-safe URI (or data: URI). */
export interface TextureRef {
  src: string;
  /** Sub-rectangle inside `src` (x, y, w, h) — used for vanilla atlas sprites. */
  rect?: [number, number, number, number];
}

/** Face of a block-model element, with its texture already resolved. */
export interface ResolvedFace {
  texture: TextureRef | null;
  /** UV in model pixel space 0..16 (x1, y1, x2, y2). Defaults computed from element bounds when absent. */
  uv?: [number, number, number, number];
  rotation?: 0 | 90 | 180 | 270;
  tintindex?: number;
}

export type FaceName = 'down' | 'up' | 'north' | 'south' | 'west' | 'east';

export interface ResolvedElement {
  from: [number, number, number];
  to: [number, number, number];
  rotation?: { origin: [number, number, number]; axis: 'x' | 'y' | 'z'; angle: number; rescale?: boolean };
  shade?: boolean;
  faces: Partial<Record<FaceName, ResolvedFace>>;
}

export interface ModelDisplayTransform {
  rotation?: [number, number, number];
  translation?: [number, number, number];
  scale?: [number, number, number];
}

/**
 * Everything a webview needs to draw an item / block icon.
 * - flat: item/generated style sprites (layered, optionally tinted)
 * - model: 3D elements (block models, custom item models)
 * - missing: nothing could be resolved — draw a placeholder with `label`
 */
export type ItemVisual =
  | { type: 'flat'; id: string; layers: { texture: TextureRef; tint?: string }[] }
  | {
      type: 'model';
      id: string;
      elements: ResolvedElement[];
      /** "gui" display transform from the model chain (if any). */
      gui?: ModelDisplayTransform;
      /** Default tint colour for faces with tintindex (grass/foliage etc.). */
      tint?: string;
    }
  | { type: 'missing'; id: string; label: string };

/** An entry for item/block pickers and search results. */
export interface RegistryEntryInfo {
  id: string; // fully qualified, e.g. minecraft:diamond
  name?: string; // display name from lang files
  source: 'vanilla' | 'workspace';
}

/** Messages webview -> host: request/response RPC. */
export interface RpcRequest {
  kind: 'rpc';
  id: number;
  method: string;
  params?: unknown;
}

export interface RpcResponse {
  kind: 'rpc-result';
  id: number;
  result?: unknown;
  error?: string;
}

/** Fire-and-forget host -> webview event. */
export interface HostEvent {
  kind: 'event';
  event: string;
  data?: unknown;
}

/** Data injected into every webview page as window.__VSCODECRAFT__. */
export interface WebviewBootData {
  /** VS Code display language, e.g. "en" or "es". */
  language: string;
  /** English -> localized strings for the current language (empty for English). */
  l10n: Record<string, string>;
  /** Arbitrary initial state passed by the feature that created the panel. */
  state: unknown;
}

/**
 * Common RPC methods available to every webview created with WebviewService.createPanel()
 * (feature-specific methods are added by each feature).
 */
export interface CommonRpc {
  /** Resolve icons for a list of item ids (or "#tag" ids → first item of the tag). */
  'icons.resolve': { params: { ids: string[] }; result: Record<string, ItemVisual> };
  /** Resolve a texture id (e.g. "mymod:item/ruby" or "minecraft:block/stone") to a TextureRef. */
  'textures.resolve': { params: { ids: string[] }; result: Record<string, TextureRef | null> };
  /** Search items (vanilla + workspace) by id or display name. */
  'items.search': { params: { query: string; limit?: number; registry?: string }; result: RegistryEntryInfo[] };
  /** Expand a tag (recursively) to its item ids. */
  'tags.expand': { params: { tag: string; registry?: string }; result: string[] };
  /** Display names for ids. */
  'names.get': { params: { ids: string[] }; result: Record<string, string> };
  /** Open a file (optionally at a JSON path or line) in an editor. */
  'file.open': { params: { uri: string; line?: number }; result: void };
  /** Show a VS Code notification. */
  'ui.notify': { params: { message: string; level?: 'info' | 'warning' | 'error' }; result: void };
  /** Info about the active project / target version. */
  'project.info': {
    params: Record<string, never> | undefined;
    result: { version: string; loader: string; namespaces: string[]; defaultNamespace: string };
  };
}
