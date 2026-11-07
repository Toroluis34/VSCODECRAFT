// Text component format of a Minecraft version (pure; host side only because it reads the version table).
import { atLeast } from '../../core/versions';
import type { TextFormat } from './textComponent';

export function textFormatFor(version: string): TextFormat {
  return {
    snakeCaseEvents: atLeast(version, '1.21.5'),
    shadowColor: atLeast(version, '1.21.4'),
    snbt: atLeast(version, '1.21.5'),
  };
}
