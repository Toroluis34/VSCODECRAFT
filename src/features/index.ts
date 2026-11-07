// Every feature exports activate(core). Order matters only for UI contributions that depend on each other.
import type { Core } from '../core/core';
import * as recipes from './recipes';
import * as schemas from './schemas';
import * as language from './language';
import * as models from './models';
import * as translations from './translations';
import * as datapack from './datapack';
import * as loot from './loot';
import * as explorer from './explorer';
import * as textures from './textures';

export interface Feature {
  activate(core: Core): void | Promise<void>;
}

export const FEATURES: Record<string, Feature> = {
  schemas,
  language,
  explorer,
  recipes,
  models,
  textures,
  translations,
  datapack,
  loot,
};
