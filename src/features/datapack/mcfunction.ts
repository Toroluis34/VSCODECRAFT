// .mcfunction completion based on the vanilla brigadier command tree of the target version.
import * as vscode from 'vscode';
import type { Core } from '../../core/core';
import { CmdNode, registryForParser, suggest } from './commandTree';
import { t } from './util';

const SELECTORS: [string, string][] = [
  ['@s', 'this entity'],
  ['@p', 'nearest player'],
  ['@a', 'all players'],
  ['@e', 'all entities'],
  ['@r', 'random player'],
  ['@n', 'nearest entity'],
];

const ENTITY_PARSERS = new Set(['minecraft:entity', 'minecraft:score_holder', 'minecraft:game_profile']);
const TAG_PARSERS = new Set(['minecraft:item_predicate', 'minecraft:block_predicate', 'minecraft:resource_or_tag', 'minecraft:resource_or_tag_key', 'minecraft:resource_selector']);
const COORD_PARSERS: Record<string, string[]> = {
  'minecraft:vec3': ['~ ~ ~', '^ ^ ^'],
  'minecraft:block_pos': ['~ ~ ~'],
  'minecraft:vec2': ['~ ~'],
  'minecraft:rotation': ['~ ~'],
  'minecraft:column_pos': ['~ ~'],
};

export function registerMcfunction(core: Core): void {
  const trees = new Map<string, Promise<CmdNode | undefined>>();
  const treeFor = (version: string) => {
    let p = trees.get(version);
    if (!p) {
      p = core.vanilla.summary<CmdNode>(version, 'commands/data.min.json').catch(() => undefined);
      trees.set(version, p);
      void p.then((r) => r === undefined && trees.delete(version));
    }
    return p;
  };

  core.track(
    vscode.languages.registerCompletionItemProvider(
      { language: 'mcfunction' },
      {
        async provideCompletionItems(doc, pos) {
          const line = doc.lineAt(pos.line).text;
          const tree = await treeFor(core.version(doc.uri));
          if (!tree) return undefined;
          const s = suggest(tree, line, pos.character);
          if (!s) return undefined;
          const range = new vscode.Range(pos.line, s.replaceStart, pos.line, pos.character);
          const items: vscode.CompletionItem[] = [];
          for (const lit of s.literals) {
            const it = new vscode.CompletionItem(lit, vscode.CompletionItemKind.Keyword);
            it.range = range;
            it.sortText = `0${lit}`;
            items.push(it);
          }
          for (const arg of s.args) {
            if (ENTITY_PARSERS.has(arg.parser)) {
              for (const [sel, desc] of SELECTORS) {
                const it = new vscode.CompletionItem({ label: sel, description: t(desc) }, vscode.CompletionItemKind.Variable);
                it.range = range;
                it.sortText = `1${sel}`;
                items.push(it);
              }
            }
            for (const c of COORD_PARSERS[arg.parser] ?? []) {
              const it = new vscode.CompletionItem(c, vscode.CompletionItemKind.Value);
              it.range = range;
              it.detail = arg.name;
              items.push(it);
            }
            const reg = registryForParser(arg.parser, arg.properties);
            if (!reg) {
              if (!items.length) {
                // Show what is expected as a non-inserting hint
                const it = new vscode.CompletionItem({ label: `<${arg.name}>`, description: arg.parser.replace(/^\w+:/, '') }, vscode.CompletionItemKind.TypeParameter);
                it.insertText = '';
                it.range = range;
                items.push(it);
              }
              continue;
            }
            const entries = await core.registries.entries(reg, doc.uri).catch(() => []);
            for (const e of entries) {
              const it = new vscode.CompletionItem({ label: e.id, description: e.name }, e.source === 'workspace' ? vscode.CompletionItemKind.Reference : vscode.CompletionItemKind.Value);
              it.range = range;
              it.filterText = `${e.id} ${e.id.replace(/^minecraft:/, '')} ${e.name ?? ''}`;
              it.sortText = `${e.source === 'workspace' ? '2' : '3'}${e.id}`;
              items.push(it);
            }
            if (TAG_PARSERS.has(arg.parser) || arg.parser === 'minecraft:function') {
              const tagReg = arg.parser === 'minecraft:function' ? 'function' : reg;
              for (const id of await core.registries.ids(`tag/${tagReg}`, doc.uri).catch(() => new Set<string>())) {
                const it = new vscode.CompletionItem(`#${id}`, vscode.CompletionItemKind.Folder);
                it.range = range;
                it.sortText = `4${id}`;
                items.push(it);
              }
            }
          }
          return new vscode.CompletionList(items, true);
        },
      },
      ' ',
      ':',
      '@',
      '#',
    ),
  );
}
