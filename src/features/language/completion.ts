import * as vscode from 'vscode';
import * as jsonc from 'jsonc-parser';
import type { Core } from '../../core/core';
import { detectContext, type RefContext } from './context';
import type { DocumentAnalyzer } from './analysis';
import type { RefEntry, RefResolver } from './resolver';
import { registryLabel } from './labels';

const K = vscode.CompletionItemKind;

function kindFor(ctx: RefContext, isTag: boolean): vscode.CompletionItemKind {
  if (isTag) return K.Folder;
  if (ctx.key) return K.Property;
  switch (ctx.registry) {
    case 'item':
    case 'block':
    case 'fluid':
      return K.Value;
    case 'entity_type':
      return K.Class;
    case 'enchantment':
    case 'mob_effect':
    case 'potion':
    case 'attribute':
      return K.EnumMember;
    case 'sound_event':
    case 'sound_file':
      return K.Event;
    case 'model':
    case 'texture':
    case 'item_definition':
    case 'loot_table':
    case 'recipe':
    case 'advancement':
    case 'function':
    case 'predicate':
    case 'item_modifier':
      return K.File;
  }
  if (/_type$|serializer|property/.test(ctx.registry)) return K.Function;
  return K.Reference;
}

export function registerCompletion(core: Core, selector: vscode.DocumentSelector, analyzer: DocumentAnalyzer, resolver: RefResolver): void {
  const provider: vscode.CompletionItemProvider = {
    async provideCompletionItems(doc, pos, token) {
      const base = analyzer.get(doc);
      if (!base) return undefined;
      const text = doc.getText();
      const offset = doc.offsetAt(pos);
      const loc = jsonc.getLocation(text, offset);
      const node = loc.previousNode;
      const inString = !!node && node.type === 'string' && offset > node.offset && offset <= node.offset + node.length;
      if (!inString) {
        // Only complete values (after ':' or inside arrays), not keys outside quotes.
        if (loc.isAtPropertyKey) return undefined;
        const before = text.slice(Math.max(0, offset - 200), offset).replace(/\s+$/, '');
        if (!/[:[,]$/.test(before)) return undefined;
      }
      const ctx = detectContext(base.file, loc.path, base.root, inString && loc.isAtPropertyKey);
      if (!ctx) return undefined;

      // Range to replace and the text typed so far.
      let range: vscode.Range;
      let typed = '';
      if (inString && node) {
        const start = node.offset + 1;
        const closed = node.length >= 2 && text[node.offset + node.length - 1] === '"';
        const end = closed ? node.offset + node.length - 1 : offset;
        range = new vscode.Range(doc.positionAt(start), doc.positionAt(Math.max(end, offset)));
        typed = text.slice(start, offset);
      } else {
        range = new vscode.Range(pos, pos);
      }
      const negPrefix = ctx.negatable && typed.startsWith('!') ? '!' : '';
      const wantTagsOnly = !!ctx.tagOnly || (ctx.allowTag && typed.replace(/^!/, '').startsWith('#'));
      const qualified = typed.includes(':');

      const items: vscode.CompletionItem[] = [];
      const add = (entries: RefEntry[], isTag: boolean) => {
        const hash = isTag && !ctx.tagOnly ? '#' : '';
        for (const e of entries) {
          const label = `${negPrefix}${hash}${e.id}`;
          const item = new vscode.CompletionItem({ label, description: e.name }, kindFor(ctx, isTag));
          item.detail = `${registryLabel(ctx.registry)}${isTag ? ' · ' + vscode.l10n.t('tag') : ''} · ${e.source === 'workspace' ? vscode.l10n.t('workspace') : vscode.l10n.t('vanilla')}`;
          item.sortText = `${e.source === 'workspace' ? 0 : 2}${isTag ? 1 : 0}${e.id}`;
          item.filterText = qualified ? label : `${negPrefix}${hash}${e.id.slice(e.id.indexOf(':') + 1)} ${e.name ?? ''}`;
          item.range = range;
          if (inString) item.insertText = label;
          else item.insertText = ctx.key ? `"${label}": ` : `"${label}"`;
          items.push(item);
        }
      };
      if (!wantTagsOnly) add(await resolver.entries(ctx, false, doc.uri), false);
      if (token.isCancellationRequested) return undefined;
      if (ctx.allowTag || ctx.tagOnly) add(await resolver.entries(ctx, true, doc.uri), true);
      return new vscode.CompletionList(items, false);
    },
  };
  core.track(vscode.languages.registerCompletionItemProvider(selector, provider, '"', ':', '#', '/'));
}
