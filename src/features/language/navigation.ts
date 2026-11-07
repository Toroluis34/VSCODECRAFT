import * as vscode from 'vscode';
import type { Core } from '../../core/core';
import { parseRL } from '../../core/resourceLocation';
import { fileKindOf, lookupRegistry, parseRef, type ParsedRef, type RefContext } from './context';
import { contentRange, type DocumentAnalyzer } from './analysis';
import type { RefResolver } from './resolver';
import { vanillaUri } from './vanillaDocs';

class RefLink extends vscode.DocumentLink {
  constructor(
    range: vscode.Range,
    target: vscode.Uri | undefined,
    readonly ctx: RefContext,
    readonly ref: ParsedRef,
    readonly docUri: vscode.Uri,
  ) {
    super(range, target);
  }
}

export function registerNavigation(core: Core, selector: vscode.DocumentSelector, analyzer: DocumentAnalyzer, resolver: RefResolver): void {
  const definition: vscode.DefinitionProvider = {
    async provideDefinition(doc, pos) {
      const hit = analyzer.refAt(doc, pos);
      if (!hit) return undefined;
      const ref = parseRef(hit.ref.value, hit.ref.ctx);
      if (!ref) return undefined;
      const locs = await resolver.locate(hit.ref.ctx, ref, doc.uri, true);
      if (!locs.length) return undefined;
      const origin = contentRange((o) => doc.positionAt(o), hit.ref.node);
      return locs.map((l) => ({ originSelectionRange: origin, targetUri: l.uri, targetRange: l.range }) as vscode.LocationLink);
    },
  };

  const links: vscode.DocumentLinkProvider<RefLink> = {
    async provideDocumentLinks(doc, token) {
      const a = analyzer.get(doc);
      if (!a) return [];
      const version = core.version(doc.uri);
      const out: RefLink[] = [];
      for (const r of a.refs) {
        if (token.isCancellationRequested) return [];
        const ref = parseRef(r.value, r.ctx);
        if (!ref) continue;
        const fk = fileKindOf(r.ctx.registry, ref.isTag);
        if (!fk) continue;
        const rl = parseRL(ref.id);
        const path = (ref.isTag ? '' : (r.ctx.prefix ?? '')) + rl.path;
        const range = contentRange((o) => doc.positionAt(o), r.node);
        const ws = core.index.get(fk.kind, `${rl.namespace}:${path}`).find((x) => x.ext === fk.ext);
        let link: RefLink | undefined;
        if (ws) link = new RefLink(range, ws.uri, r.ctx, ref, doc.uri);
        else if (rl.namespace === 'minecraft') {
          const vanilla = await resolver.vanillaIds(version, lookupRegistry(r.ctx, ref.isTag));
          const known = vanilla.has(`minecraft:${path}`) || vanilla.has(ref.id);
          if (!known) continue;
          if (fk.ext === 'json') link = new RefLink(range, vanillaUri(version, `${fk.side}/minecraft/${fk.kind}/${path}.json`), r.ctx, ref, doc.uri);
          else if (fk.ext === 'png' || fk.ext === 'ogg') link = new RefLink(range, undefined, r.ctx, ref, doc.uri);
        }
        if (link) {
          link.tooltip = vscode.l10n.t('Open {0}', `${ref.isTag ? '#' : ''}${ref.id}`);
          out.push(link);
        }
      }
      return out;
    },
    async resolveDocumentLink(link) {
      if (!link.target) {
        const locs = await resolver.locate(link.ctx, link.ref, link.docUri, true);
        link.target = locs[0]?.uri;
      }
      return link;
    },
  };

  core.track(vscode.languages.registerDefinitionProvider(selector, definition), vscode.languages.registerDocumentLinkProvider(selector, links));
}
