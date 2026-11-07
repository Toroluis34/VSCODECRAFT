import { boot } from './vscode';

/**
 * Translate an English UI string. Placeholders {0}, {1}... are replaced by args.
 * Add translations to src/features/<feature>/l10n.es.json ("English": "Español").
 */
export function t(english: string, ...args: (string | number)[]): string {
  const s = boot().l10n?.[english] ?? english;
  return args.length ? s.replace(/\{(\d+)\}/g, (_, i) => String(args[Number(i)] ?? '')) : s;
}
