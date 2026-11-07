import type { Core } from '../../core/core';
import { TextureEditorProvider } from './editorProvider';
import { TextureService } from './previews';
import { registerTextureCommands } from './commands';
import { registerTextureHovers } from './hover';

/**
 * Feature "textures":
 *  - Pixel-art Texture Editor (custom editor for PNGs under assets/<ns>/textures, with animation support)
 *  - New Texture…, Create Material Variant…, Generate Animation .mcmeta, Texture Atlas Overview
 *  - Texture image hovers + gutter icons in JSON
 */
export function activate(core: Core): void {
  const textures = new TextureService(core);
  core.track(textures);
  TextureEditorProvider.register(core, textures);
  registerTextureCommands(core, textures);
  registerTextureHovers(core, textures);
}
