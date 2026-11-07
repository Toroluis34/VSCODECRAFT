// Types shared between the models feature host code and its webviews (model viewer, generator).
// Pure types only — bundled into webviews.
import type { ItemVisual, ModelDisplayTransform, ResolvedElement, TextureRef } from '../../shared/protocol';

export interface ViewerTexture {
  /** Model the variable belongs to. */
  model: string;
  /** Texture variable ("all", "layer0", ...). */
  name: string;
  /** Raw value in the model ("#side" or a texture id). */
  raw: string;
  /** Final texture id (after following #references). */
  id?: string;
  ref: TextureRef | null;
  missing: boolean;
  /** File URI (workspace texture) to open. */
  fileUri?: string;
  /** Number of faces using it. */
  uses: number;
}

export interface ViewerElement {
  index: number;
  model: string;
  name?: string;
  from: [number, number, number];
  to: [number, number, number];
  rotation?: string;
  faces: number;
  /** Line of the element in the open document (when defined there). */
  line?: number;
}

export interface GeneratedLayer {
  texture: TextureRef | null;
  tint?: string;
  tintindex: number;
}

export interface ViewerModel {
  kind: 'model' | 'blockstate' | 'item';
  uri: string;
  id: string;
  version: string;
  elements: ResolvedElement[];
  elementInfo: ViewerElement[];
  /** item/generated layers (extruded in the webview). */
  generated: GeneratedLayer[];
  display: Record<string, ModelDisplayTransform>;
  textures: ViewerTexture[];
  /** Parent chain of the main model. */
  chain: { id: string; found: boolean }[];
  tint?: string;
  notes: string[];
  errors: string[];
  /** Models drawn (blockstates/items), with the variant label. */
  models: { model: string; label: string; x: number; y: number; uvlock: boolean }[];
  // blockstates
  properties?: { name: string; values: string[] }[];
  state?: Record<string, string>;
  alternatives?: number;
  // item definitions
  branches?: { id: string; label: string }[];
  branch?: string;
}

export interface ViewerSelection {
  state?: Record<string, string>;
  alt?: number;
  branch?: string;
}

// ---------------- generator ----------------

export type ItemParent = 'generated' | 'handheld';
export type BlockTemplate = 'cube_all' | 'cube_column' | 'orientable' | 'cross';
export type SetVariant = 'stairs' | 'slab' | 'wall' | 'fence' | 'fence_gate' | 'button' | 'pressure_plate' | 'door' | 'trapdoor' | 'pane';
export type ToolKind = 'none' | 'pickaxe' | 'axe' | 'shovel' | 'hoe';
export type ToolTier = 'none' | 'stone' | 'iron' | 'diamond';

export interface TextureChoice {
  source: 'placeholder' | 'existing' | 'file';
  /** Existing texture id (source = existing). */
  id?: string;
  /** Absolute file path (source = file). */
  file?: string;
  /** Placeholder base colour (#rrggbb). */
  color?: string;
}

export interface GeneratorForm {
  mode: 'item' | 'block';
  namespace: string;
  id: string;
  nameEn: string;
  nameEs: string;
  itemParent: ItemParent;
  template: BlockTemplate;
  /** Texture slot -> choice (slots depend on mode/template, see TEMPLATE_SLOTS). */
  textures: Record<string, TextureChoice>;
  variants: SetVariant[];
  blockstate: boolean;
  blockItem: boolean;
  itemDefinition: boolean;
  lang: boolean;
  loot: boolean;
  recipe: boolean;
  recipeIngredient: string;
  tool: ToolKind;
  tier: ToolTier;
}

export interface GeneratorInit {
  mode: 'item' | 'block';
  namespace: string;
  namespaces: string[];
  version: string;
  loader: string;
  hasItemDefinitions: boolean;
  resourceRoot?: string;
}

export interface GeneratorPreview {
  visual: ItemVisual;
  files: { path: string; exists: boolean; action: string }[];
  snippet: string;
  snippetTitle: string;
  textures: Record<string, TextureRef | null>;
  ids: string[];
  errors: string[];
  /** Placeholder colour used for each texture slot. */
  colors: Record<string, string>;
}

export interface GeneratorResult {
  files: { path: string; uri: string; status: 'created' | 'updated' | 'skipped' | 'error'; detail?: string }[];
  snippet: string;
}

export interface TextureOption {
  id: string;
  src: string;
}
