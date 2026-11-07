import * as vscode from 'vscode';
import * as jsonc from 'jsonc-parser';
import type { Core } from '../../core/core';
import { getAt, type JsonPath } from './context';
import type { DocumentAnalyzer } from './analysis';
import { intToRgba, isColorPath, rgbaToInt } from './colorUtils';

/**
 * Colour swatches for numeric RGB/ARGB ints (dyed_color, firework colours, potion custom_color, map_color,
 * tint "value", biome colours ...). String colours of text components belong to the translations feature.
 */
export function registerColors(core: Core, selector: vscode.DocumentSelector, analyzer: DocumentAnalyzer): void {
  const provider: vscode.DocumentColorProvider = {
    provideDocumentColors(doc) {
      const a = analyzer.get(doc);
      if (!a?.tree) return [];
      const out: vscode.ColorInformation[] = [];
      const walk = (n: jsonc.Node, path: JsonPath) => {
        if (n.type === 'object') {
          for (const p of n.children ?? []) {
            const k = p.children?.[0];
            const v = p.children?.[1];
            if (k && v) walk(v, [...path, k.value as string]);
          }
        } else if (n.type === 'array') {
          (n.children ?? []).forEach((c, i) => walk(c, [...path, i]));
        } else if (n.type === 'number' && Number.isInteger(n.value)) {
          const owner = getAt(a.root, path.slice(0, -1));
          if (isColorPath(path, owner && typeof owner === 'object' ? owner : undefined)) {
            const c = intToRgba(n.value as number);
            out.push(
              new vscode.ColorInformation(
                new vscode.Range(doc.positionAt(n.offset), doc.positionAt(n.offset + n.length)),
                new vscode.Color(c.red, c.green, c.blue, c.alpha),
              ),
            );
          }
        }
      };
      walk(a.tree, []);
      return out;
    },
    provideColorPresentations(color, { document, range }) {
      const original = Number(document.getText(range));
      const argb = original < 0 || original > 0xffffff || color.alpha < 1;
      const value = rgbaToInt(color, argb);
      const p = new vscode.ColorPresentation(String(value));
      p.textEdit = new vscode.TextEdit(range, String(value));
      return [p];
    },
  };
  core.track(vscode.languages.registerColorProvider(selector, provider));
}
