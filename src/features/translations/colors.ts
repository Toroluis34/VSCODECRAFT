// Colour picker for STRING colours in JSON: "color": "#RRGGBB" / named text colours in text components,
// "#RRGGBB" under colour-ish keys anywhere in resource JSON and lang files. (Integer colours are handled elsewhere.)
import * as vscode from 'vscode';
import * as jsonc from 'jsonc-parser';
import { parseTree } from '../../core/jsonUtils';
import { isResourceJson } from './hover';
import { isLangFile } from './host';
import { colorToHex, exactNamedColor, hexToRgb, isNamedColor, isTextObject } from './textComponent';

const COLORISH = /(^|_)(colou?r|tint)$|Colou?r$/;
const HEX = /^#([0-9a-fA-F]{6})$/;

/** Pure-ish scan: string nodes that hold colours. */
export function findColorNodes(tree: jsonc.Node | undefined, lang: boolean): { node: jsonc.Node; hex: string; named: boolean }[] {
  const out: { node: jsonc.Node; hex: string; named: boolean }[] = [];
  const walk = (n: jsonc.Node) => {
    if (n.type === 'property' && n.children?.length === 2) {
      const key = String(n.children[0].value);
      const v = n.children[1];
      if (v.type === 'string') {
        const s = v.value as string;
        if (HEX.test(s) && (COLORISH.test(key) || (lang && /colou?r/i.test(key)))) out.push({ node: v, hex: colorToHex(s)!, named: false });
        else if (key === 'color' && isNamedColor(s) && n.parent && isTextObject(jsonc.getNodeValue(n.parent))) out.push({ node: v, hex: colorToHex(s)!, named: true });
      }
    }
    n.children?.forEach(walk);
  };
  if (tree) walk(tree);
  return out;
}

export class StringColorProvider implements vscode.DocumentColorProvider {
  provideDocumentColors(doc: vscode.TextDocument): vscode.ColorInformation[] {
    if (!isResourceJson(doc.uri) || !vscode.workspace.getConfiguration('vscodecraft.translations', doc.uri).get('colorPicker', true)) return [];
    return findColorNodes(parseTree(doc), isLangFile(doc.uri)).map(({ node, hex }) => {
      const [r, g, b] = hexToRgb(hex);
      const range = new vscode.Range(doc.positionAt(node.offset + 1), doc.positionAt(node.offset + node.length - 1));
      return new vscode.ColorInformation(range, new vscode.Color(r / 255, g / 255, b / 255, 1));
    });
  }

  provideColorPresentations(color: vscode.Color, ctx: { document: vscode.TextDocument; range: vscode.Range }): vscode.ColorPresentation[] {
    const original = ctx.document.getText(ctx.range);
    const to2 = (x: number) => Math.round(x * 255).toString(16).padStart(2, '0');
    let hex = `#${to2(color.red)}${to2(color.green)}${to2(color.blue)}`;
    if (!/[a-f]/.test(original) && /[A-F]/.test(original)) hex = hex.toUpperCase();
    else if (!HEX.test(original)) hex = hex.toUpperCase();
    const out: vscode.ColorPresentation[] = [];
    const named = exactNamedColor(hex);
    // Named colours are only valid where the original was a named text colour or a text component colour.
    if (named && isNamedColor(original)) out.push(presentation(named, ctx.range));
    out.push(presentation(hex, ctx.range));
    if (named && !isNamedColor(original) && /"color"\s*:\s*$/.test(ctx.document.getText(new vscode.Range(ctx.range.start.line, 0, ctx.range.start.line, ctx.range.start.character - 1)))) {
      out.push(presentation(named, ctx.range));
    }
    return out;
  }
}

function presentation(text: string, range: vscode.Range): vscode.ColorPresentation {
  const p = new vscode.ColorPresentation(text);
  p.textEdit = new vscode.TextEdit(range, text);
  return p;
}
