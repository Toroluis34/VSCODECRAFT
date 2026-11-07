import * as vscode from 'vscode';
import * as jsonc from 'jsonc-parser';
import type { Core } from '../../core/core';
import { humanize, parseRL } from '../../core/resourceLocation';
import { getVersions } from '../../core/versions';
import { parseRef, type ParsedRef, type RefContext } from './context';
import type { DocumentAnalyzer } from './analysis';
import type { RefResolver } from './resolver';
import { registryLabel } from './labels';

const MAX_TAG_MEMBERS = 20;

function img(uri: vscode.Uri, size = 48): string {
  // VS Code's markdown renderer understands "|width=,height=" after the image URL.
  return `![](${uri.toString()}|width=${size},height=${size})`;
}

export function registerHover(core: Core, selector: vscode.DocumentSelector, analyzer: DocumentAnalyzer, resolver: RefResolver): void {
  const textureFile = (id: string) => core.index.get('textures', id).find((r) => r.ext === 'png')?.uri;

  async function itemIcon(id: string, uri: vscode.Uri): Promise<vscode.Uri | undefined> {
    const version = core.version(uri);
    try {
      const { model } = await core.icons.itemModel(id, version);
      const merged = await core.icons.mergeModel(model, version);
      const t = merged.textures;
      let tex = t.layer0 ?? t.all ?? t.particle ?? t.side ?? t.top ?? Object.values(t)[0];
      for (let i = 0; tex?.startsWith('#') && i < 5; i++) tex = t[tex.slice(1)];
      if (!tex || tex.startsWith('#')) return undefined;
      return textureFile(tex.includes(':') ? tex : `minecraft:${tex}`);
    } catch {
      return undefined;
    }
  }

  async function describe(ctx: RefContext, ref: ParsedRef, uri: vscode.Uri): Promise<vscode.MarkdownString> {
    const md = new vscode.MarkdownString(undefined, true);
    const version = core.version(uri);
    const display = `${ref.isTag ? '#' : ''}${ref.id}`;
    const name = ref.isTag ? undefined : (await core.registries.names(uri).catch(() => new Map<string, string>())).get(ref.id);
    const rl = parseRL(ref.id);
    const label = `${registryLabel(ctx.registry)}${ref.isTag ? ' ' + vscode.l10n.t('tag') : ''}`;

    let icon: vscode.Uri | undefined;
    if (!ref.isTag && (ctx.registry === 'item' || ctx.registry === 'block')) icon = await itemIcon(ref.id, uri);
    if (!ref.isTag && ctx.registry === 'texture') icon = textureFile(`${rl.namespace}:${ctx.prefix ?? ''}${rl.path}`);
    if (icon) md.appendMarkdown(`${img(icon, ctx.registry === 'texture' ? 64 : 48)}\n\n`);

    md.appendMarkdown(`**${escapeMd(name ?? humanize(rl.path))}** \`${display}\`\n\n`);
    const status = await resolver.check({ ...ctx, optional: false }, ref, uri);
    const locs = await resolver.locate(ctx, ref, uri, false);
    const wsLocs = locs.filter((l) => l.uri.scheme === 'file' || l.uri.scheme === 'vscode-remote');
    let source: string;
    if (wsLocs.length) {
      source = `${vscode.l10n.t('workspace')} · ` + wsLocs.slice(0, 3).map((l) => `[${escapeMd(vscode.workspace.asRelativePath(l.uri))}](${l.uri.with({ fragment: `L${l.range.start.line + 1}` }).toString()})`).join(' · ');
    } else if (rl.namespace === 'minecraft' && status === 'ok') {
      source = vscode.l10n.t('vanilla {0}', version);
    } else if (status === 'unknown') {
      source = `$(warning) ${vscode.l10n.t('not found')}`;
    } else {
      source = status === 'ok' ? vscode.l10n.t('workspace') : vscode.l10n.t('external (another mod or pack)');
    }
    md.appendMarkdown(`${label} · ${source}\n\n`);

    if (ref.isTag) {
      const registry = ctx.registry;
      const members = await core.registries.expandTag(ref.id, registry, uri).catch(() => [] as string[]);
      if (members.length) {
        const names = await core.registries.names(uri).catch(() => new Map<string, string>());
        md.appendMarkdown(`${vscode.l10n.t('{0} entries', members.length)}:\n\n`);
        for (const m of members.slice(0, MAX_TAG_MEMBERS)) {
          const n = names.get(m);
          md.appendMarkdown(`- \`${m}\`${n ? ` — ${escapeMd(n)}` : ''}\n`);
        }
        if (members.length > MAX_TAG_MEMBERS) md.appendMarkdown(`- … ${vscode.l10n.t('and {0} more', members.length - MAX_TAG_MEMBERS)}\n`);
      }
    } else if (ctx.registry === 'model') {
      const merged = await core.icons.mergeModel(ref.id, version).catch(() => undefined);
      if (merged && merged.chain.length > 1) {
        md.appendMarkdown(`${vscode.l10n.t('Parents')}: ${merged.chain.map((c) => `\`${c}\``).join(' → ')}\n\n`);
      }
      const entries = Object.entries(merged?.textures ?? {});
      if (entries.length) {
        md.appendMarkdown(`${vscode.l10n.t('Textures')}:\n\n`);
        for (const [k, v] of entries.slice(0, 12)) {
          const file = v.startsWith('#') ? undefined : textureFile(v.includes(':') ? v : `minecraft:${v}`);
          md.appendMarkdown(`- ${file ? img(file, 16) + ' ' : ''}\`${k}\`: \`${v}\`\n`);
        }
      }
    } else if (ctx.registry === 'data_component_type') {
      md.appendMarkdown(`[${vscode.l10n.t('Minecraft Wiki')}](https://minecraft.wiki/w/Data_component_format#${encodeURIComponent(rl.path)})\n`);
    }
    return md;
  }

  const provider: vscode.HoverProvider = {
    async provideHover(doc, pos) {
      const hit = analyzer.refAt(doc, pos);
      if (hit) {
        const ref = parseRef(hit.ref.value, hit.ref.ctx);
        if (!ref) return undefined;
        const md = await describe(hit.ref.ctx, ref, doc.uri);
        const node = hit.ref.node;
        return new vscode.Hover(md, new vscode.Range(doc.positionAt(node.offset), doc.positionAt(node.offset + node.length)));
      }
      return packFormatHover(doc, pos, analyzer);
    },
  };
  core.track(vscode.languages.registerHoverProvider(selector, provider));
}

/** pack.mcmeta: which Minecraft versions a pack format number corresponds to. */
function packFormatHover(doc: vscode.TextDocument, pos: vscode.Position, analyzer: DocumentAnalyzer): vscode.Hover | undefined {
  const a = analyzer.get(doc);
  if (a?.file.kind !== 'pack.mcmeta' || !a.tree) return undefined;
  const node = jsonc.findNodeAtOffset(a.tree, doc.offsetAt(pos));
  if (!node || node.type !== 'number') return undefined;
  const path = jsonc.getNodePath(node);
  if (!path.some((p) => p === 'pack_format' || p === 'min_format' || p === 'max_format' || p === 'supported_formats' || p === 'formats')) return undefined;
  if (typeof path[path.length - 1] === 'number' && path[path.length - 1] !== 0 && !path.includes('supported_formats')) return undefined;
  const n = node.value as number;
  const releases = getVersions(false);
  const fmt = (list: string[]) => (list.length ? list.join(', ') : '—');
  const data = releases.filter((v) => v.dataPack === n).map((v) => v.id).reverse();
  const res = releases.filter((v) => v.resourcePack === n).map((v) => v.id).reverse();
  const md = new vscode.MarkdownString();
  md.appendMarkdown(`**${vscode.l10n.t('Data pack format {0}', n)}**: ${fmt(data)}\n\n`);
  md.appendMarkdown(`**${vscode.l10n.t('Resource pack format {0}', n)}**: ${fmt(res)}`);
  return new vscode.Hover(md, new vscode.Range(doc.positionAt(node.offset), doc.positionAt(node.offset + node.length)));
}

function escapeMd(s: string): string {
  return s.replace(/[\\`*_{}[\]<>|]/g, (c) => `\\${c}`);
}
