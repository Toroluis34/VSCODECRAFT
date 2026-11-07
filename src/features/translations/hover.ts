// Hover previews of § formatted strings and JSON text components (rendered as an SVG image,
// since markdown cannot colour text), plus the other locales of a key in lang files.
import * as vscode from 'vscode';
import * as jsonc from 'jsonc-parser';
import type { Core } from '../../core/core';
import { parseTree } from '../../core/jsonUtils';
import { componentAt, isLangFile, localeOf, parentFolder, TranslationLookup } from './host';
import { formatArgsMismatch, parseLang } from './langFile';
import { flatten, hasLegacyCodes, renderSvg, svgDataUri, TextComponent } from './textComponent';

export const JSON_SELECTOR: vscode.DocumentSelector = [
  { language: 'json', scheme: 'file' },
  { language: 'jsonc', scheme: 'file' },
  { language: 'json', scheme: 'untitled' },
];

/** JSON files where text components / colours are expected: data/, assets/, pack.mcmeta. */
export function isResourceJson(uri: vscode.Uri): boolean {
  return /\/(data|assets)\/[^/]+\//.test(uri.path) || /\/pack\.mcmeta$/i.test(uri.path) || uri.scheme === 'untitled';
}

export function previewMarkdown(component: TextComponent, translate?: (k: string) => string | undefined): string | undefined {
  const segs = flatten(component, { translate });
  if (!segs.some((s) => s.text.trim())) return undefined;
  const svg = renderSvg(segs, { wrap: 60 });
  return `![preview](${svgDataUri(svg)})`;
}

export class TranslationHoverProvider implements vscode.HoverProvider {
  constructor(
    private readonly core: Core,
    private readonly lookup: TranslationLookup,
  ) {}

  async provideHover(doc: vscode.TextDocument, pos: vscode.Position): Promise<vscode.Hover | undefined> {
    if (!isResourceJson(doc.uri) || !vscode.workspace.getConfiguration('vscodecraft.translations', doc.uri).get('hover', true)) return undefined;
    const tree = parseTree(doc);
    if (!tree) return undefined;
    const offset = doc.offsetAt(pos);
    const node = jsonc.findNodeAtOffset(tree, offset, false);
    if (!node || node.type !== 'string') return undefined;
    const range = new vscode.Range(doc.positionAt(node.offset), doc.positionAt(node.offset + node.length));
    if (isLangFile(doc.uri)) return this.langHover(doc, node, range);

    const map = await this.lookup.map(doc.uri);
    const translate = (k: string) => map.get(k);
    const md = new vscode.MarkdownString();
    const prop = node.parent?.type === 'property' ? node.parent : undefined;
    const isKey = prop?.children?.[0] === node;
    if (!isKey && prop?.children?.[0]?.value === 'translate') {
      const v = map.get(node.value as string);
      md.appendMarkdown(v !== undefined ? `**en_us:** ${escapeMd(v)}\n\n` : `$(warning) ${escapeMd(vscode.l10n.t('No en_us translation for this key'))}\n\n`);
      md.supportThemeIcons = true;
    }
    const comp = componentAt(tree, offset);
    let preview: string | undefined;
    if (comp) preview = previewMarkdown(comp.value, translate);
    else if (!isKey && hasLegacyCodes(node.value as string)) preview = previewMarkdown(node.value as string, translate);
    if (preview) md.appendMarkdown(preview);
    return md.value ? new vscode.Hover(md, range) : undefined;
  }

  private async langHover(doc: vscode.TextDocument, node: jsonc.Node, range: vscode.Range): Promise<vscode.Hover | undefined> {
    const prop = node.parent?.type === 'property' ? node.parent : undefined;
    const key = prop?.children?.[0]?.value as string | undefined;
    if (!key) return undefined;
    const value = prop?.children?.[1]?.type === 'string' ? (prop.children[1].value as string) : undefined;
    const md = new vscode.MarkdownString();
    md.supportThemeIcons = true;
    if (value !== undefined && (hasLegacyCodes(value) || /%(\d+\$)?s/.test(value))) {
      const map = await this.lookup.map(doc.uri);
      const p = previewMarkdown(value, (k) => map.get(k));
      if (p) md.appendMarkdown(`${p}\n\n`);
    }
    // Other locales of the same key
    const me = localeOf(doc.uri);
    const folder = parentFolder(doc.uri);
    const rows: string[] = [];
    let en: string | undefined;
    for (const r of this.core.index.all('lang')) {
      if (parentFolder(r.uri).toString() !== folder.toString() || r.path === me) continue;
      const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === r.uri.toString());
      const entries = open ? Object.fromEntries(parseLang(open.getText()).entries.map((e) => [e.key, e.value])) : await this.core.index.json<Record<string, string>>(r.uri);
      const v = entries?.[key];
      if (r.path === 'en_us') en = typeof v === 'string' ? v : undefined;
      rows.push(`| \`${r.path}\` | ${typeof v === 'string' ? escapeMd(v) || '*' + escapeMd(vscode.l10n.t('(empty)')) + '*' : '$(error) *' + escapeMd(vscode.l10n.t('missing')) + '*'} |`);
    }
    if (me !== 'en_us' && en !== undefined && value !== undefined && formatArgsMismatch(en, value)) {
      md.appendMarkdown(`$(warning) ${escapeMd(vscode.l10n.t('Format arguments (%s) differ from en_us'))}\n\n`);
    }
    if (rows.length) {
      rows.sort();
      md.appendMarkdown(`| ${escapeMd(vscode.l10n.t('Locale'))} | ${escapeMd(vscode.l10n.t('Value'))} |\n|---|---|\n${rows.slice(0, 40).join('\n')}\n`);
      if (rows.length > 40) md.appendMarkdown(`\n${escapeMd(vscode.l10n.t('…and {0} more', rows.length - 40))}\n`);
    }
    if (!md.value) return undefined;
    const args = encodeURIComponent(JSON.stringify([doc.uri]));
    md.appendMarkdown(`\n[$(globe) ${escapeMd(vscode.l10n.t('Open Lang Editor'))}](command:vscodecraft.translations.openLangEditor?${args})`);
    md.isTrusted = { enabledCommands: ['vscodecraft.translations.openLangEditor'] };
    return new vscode.Hover(md, range);
  }
}

function escapeMd(s: string): string {
  return s.replace(/[\\`*_{}[\]()#+\-.!|<>]/g, '\\$&').replace(/\n/g, ' ↵ ');
}
