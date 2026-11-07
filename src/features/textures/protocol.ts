// RPC payloads shared by the texture host code and the texture webviews (pure types).
import type { WireImage } from './pixels';

/** Initial state of the texture editor webview. */
export interface TextureEditorBoot {
  uri: string;
}

/** Result of `tex.load`. */
export interface TextureEditorPayload {
  image: WireImage;
  /** Parsed .png.mcmeta (null when the file has none). */
  mcmeta: Record<string, unknown> | null;
  /** Resource id ("ns:block/x") when the file is inside assets/<ns>/textures. */
  id?: string;
  /** Folder below textures/ (block, item, entity/...). */
  folder?: string;
  fileName: string;
  version: string;
}

/** `tex.edit` params: a new full state of the document. */
export interface TextureEditParams {
  label: string;
  image?: WireImage;
  /** undefined = unchanged; null = remove the .mcmeta */
  mcmeta?: Record<string, unknown> | null;
}

/** Host → webview `tex.set` event. */
export interface TextureSetEvent {
  image: WireImage;
  mcmeta: Record<string, unknown> | null;
  /** Why the content changed: undo/redo/revert/external. */
  reason: string;
}

export interface NamedPalette {
  name: string;
  colors: string[];
}

/** Material variant panel. */
export interface VariantSource {
  /** Texture id (ns:path). */
  id: string;
  /** Path inside textures/ (block/ruby_ore). */
  path: string;
  namespace: string;
  uri: string;
  /** Decoded pixels (loaded lazily with `variant.images`). */
  image?: WireImage;
  hasMcmeta: boolean;
}

export interface VariantBoot {
  sources: VariantSource[];
  /** Ids preselected (e.g. when opened from "recolor" or explorer selection). */
  selected: string[];
  namespaces: string[];
  defaultNamespace: string;
}

export interface VariantOutput {
  sourceId: string;
  /** Target texture id (ns:path). */
  targetId: string;
  image: WireImage;
}

/** Atlas overview. */
export interface AtlasEntry {
  id: string;
  namespace: string;
  path: string;
  folder: string;
  uri: string;
  /** Webview URI to display the texture. */
  src: string;
  width: number;
  height: number;
  frames: number;
  hasMcmeta: boolean;
  warnings: string[];
  bytes: number;
}
