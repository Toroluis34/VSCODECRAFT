import * as vscode from 'vscode';
import * as jsonc from 'jsonc-parser';
import type { Core } from '../../core/core';
import { classifyPath, type ResourceFileInfo } from '../../core/resourceLocation';
import { collectRefs, type FileContext, type RefOccurrence } from './context';
import { VANILLA_SCHEME } from './vanillaDocs';

export interface Analysis {
  file: FileContext;
  info?: ResourceFileInfo;
  tree: jsonc.Node | undefined;
  root: unknown;
  refs: RefOccurrence[];
}

/** Resource classification of a document (workspace file, vanilla virtual file or pack.mcmeta). */
export function fileContextOf(core: Core, uri: vscode.Uri): { file: FileContext; info?: ResourceFileInfo } | undefined {
  if (/\/pack\.mcmeta$/.test(uri.path)) return { file: { kind: 'pack.mcmeta' } };
  const info = uri.scheme === VANILLA_SCHEME ? classifyPath(uri.path) : (core.index.info(uri) ?? classifyPath(uri.fsPath));
  if (!info || (info.ext !== 'json' && info.ext !== 'mcmeta')) return undefined;
  if (info.kind === 'lang') return undefined;
  return { file: { kind: info.kind, path: info.path }, info };
}

export function analyzeText(text: string, file: FileContext, info?: ResourceFileInfo): Analysis {
  const tree = jsonc.parseTree(text, [], { allowTrailingComma: true, disallowComments: false });
  const root = tree ? jsonc.getNodeValue(tree) : undefined;
  return { file, info, tree, root, refs: collectRefs(tree, file) };
}

/** Caches one analysis per open document version. */
export class DocumentAnalyzer {
  private cache = new Map<string, { version: number; analysis: Analysis | undefined }>();

  constructor(private readonly core: Core) {
    core.track(vscode.workspace.onDidCloseTextDocument((d) => this.cache.delete(d.uri.toString())));
  }

  get(doc: vscode.TextDocument): Analysis | undefined {
    const key = doc.uri.toString();
    const hit = this.cache.get(key);
    if (hit && hit.version === doc.version) return hit.analysis;
    const fc = fileContextOf(this.core, doc.uri);
    const analysis = fc ? analyzeText(doc.getText(), fc.file, fc.info) : undefined;
    this.cache.set(key, { version: doc.version, analysis });
    return analysis;
  }

  /** The reference (string value or key) under an offset. */
  refAt(doc: vscode.TextDocument, pos: vscode.Position): { analysis: Analysis; ref: RefOccurrence } | undefined {
    const analysis = this.get(doc);
    if (!analysis) return undefined;
    const offset = doc.offsetAt(pos);
    const ref = analysis.refs.find((r) => offset > r.node.offset && offset < r.node.offset + r.node.length);
    return ref ? { analysis, ref } : undefined;
  }
}

/** Range of a string node's content (without quotes). */
export function contentRange(toPos: (offset: number) => vscode.Position, node: jsonc.Node): vscode.Range {
  return new vscode.Range(toPos(node.offset + 1), toPos(node.offset + Math.max(1, node.length - 1)));
}

/** Offset → Position converter for a text that is not open as a document. */
export function lineIndex(text: string): (offset: number) => vscode.Position {
  const starts = [0];
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) starts.push(i + 1);
  return (offset: number) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return new vscode.Position(lo, offset - starts[lo]);
  };
}
