// Types shared between the recipes host code and its webviews (no 'vscode' import).
import type { RecipeFormat } from './recipeModel';

export interface RecipeViewState {
  /** editor = CustomTextEditor, preview = side preview following the active editor, vanilla = read-only vanilla recipe. */
  mode: 'editor' | 'preview' | 'vanilla';
  /** Recipe id, e.g. "mymod:ruby_block". */
  id: string;
  uri?: string;
  /** Short file label. */
  fileName?: string;
  version: string;
  fmt: RecipeFormat;
  json: unknown;
  parseError?: string;
  readOnly: boolean;
  defaultNamespace: string;
}

export interface BrowserEntry {
  /** Unique key: "<source>|<id>" */
  key: string;
  id: string;
  source: 'workspace' | 'vanilla';
  uri?: string;
  type: string;
  result?: string;
  count: number;
  /** Ingredient ids and "#tags". */
  ingredients: string[];
  group?: string;
}

export interface BrowserData {
  version: string;
  entries: BrowserEntry[];
  /** Expanded members of every tag used by an ingredient ("#ns:tag" -> item ids). */
  tags: Record<string, string[]>;
  /** Display names of every id involved. */
  names: Record<string, string>;
  vanillaAvailable: boolean;
  defaultNamespace: string;
}

export interface CheckIdsResult {
  unknownItems: string[];
  unknownTags: string[];
}
