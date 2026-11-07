// Types shared between the loot feature's host code and its webviews. Pure (no 'vscode' import).
import type { LootFormat } from './lootModel';
import type { AdvancementInfo } from './advancementModel';

/** Initial / pushed state of the loot table webview. */
export interface LootViewState {
  mode: 'file' | 'vanilla';
  id: string;
  version: string;
  format: LootFormat;
  json: unknown;
  readOnly: boolean;
  uri?: string;
  parseError?: boolean;
}

/** Initial state of the advancements webview. */
export interface AdvancementViewState {
  mode: 'tree' | 'single';
  version: string;
  id?: string;
}

/** Result of "adv.load". */
export interface AdvancementTreeData {
  version: string;
  advancements: AdvancementInfo[];
  lang: Record<string, string>;
}

/** Result of "adv.single" / event "adv.update". */
export interface AdvancementSingleData {
  version: string;
  advancement: AdvancementInfo;
  chain: AdvancementInfo[];
  children: AdvancementInfo[];
  lang: Record<string, string>;
}

/** Initial state of the give / item builder webview. */
export interface GiveViewState {
  version: string;
  versions: string[];
  namespace: string;
  item: string;
}

/** Result of "give.data". */
export interface GiveData {
  registries: Record<string, string[]>;
  lang: Record<string, string>;
}
