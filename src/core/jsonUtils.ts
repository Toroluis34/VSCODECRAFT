import * as vscode from 'vscode';
import * as jsonc from 'jsonc-parser';
import { jsonIndent } from './fsUtils';

export type JsonPath = jsonc.JSONPath;

/** Parse a document's JSON (tolerant). */
export function parseDocument(doc: vscode.TextDocument | string): any {
  const text = typeof doc === 'string' ? doc : doc.getText();
  return jsonc.parse(text, [], { allowTrailingComma: true, disallowComments: false });
}

export function parseTree(doc: vscode.TextDocument | string): jsonc.Node | undefined {
  const text = typeof doc === 'string' ? doc : doc.getText();
  return jsonc.parseTree(text, [], { allowTrailingComma: true, disallowComments: false });
}

/**
 * JSON location at a position: path, whether it's a property key, the string node under the cursor, etc.
 * Use `location.path` like ["key", "#"] or ["pools", 0, "entries", 1, "name"].
 */
export function locationAt(doc: vscode.TextDocument, pos: vscode.Position): jsonc.Location {
  return jsonc.getLocation(doc.getText(), doc.offsetAt(pos));
}

/** The node (if any) exactly at an offset. */
export function nodeAt(doc: vscode.TextDocument, pos: vscode.Position): jsonc.Node | undefined {
  const tree = parseTree(doc);
  return tree ? jsonc.findNodeAtOffset(tree, doc.offsetAt(pos), true) : undefined;
}

/** Range of a node in a document. */
export function nodeRange(doc: vscode.TextDocument, node: jsonc.Node): vscode.Range {
  return new vscode.Range(doc.positionAt(node.offset), doc.positionAt(node.offset + node.length));
}

/** Range of a string node's content (without quotes). */
export function stringContentRange(doc: vscode.TextDocument, node: jsonc.Node): vscode.Range {
  return new vscode.Range(doc.positionAt(node.offset + 1), doc.positionAt(node.offset + node.length - 1));
}

/** Visit every string value with its path. */
export function forEachString(
  tree: jsonc.Node | undefined,
  cb: (value: string, node: jsonc.Node, path: JsonPath) => void,
): void {
  if (!tree) return;
  const walk = (n: jsonc.Node) => {
    if (n.type === 'string' && !(n.parent?.type === 'property' && n.parent.children?.[0] === n)) {
      cb(n.value as string, n, jsonc.getNodePath(n));
    }
    n.children?.forEach(walk);
  };
  walk(tree);
}

/** Compute edits that set a value at a path (creates intermediate objects). value undefined removes it. */
export function modifyEdits(doc: vscode.TextDocument | string, path: JsonPath, value: unknown): jsonc.Edit[] {
  const text = typeof doc === 'string' ? doc : doc.getText();
  const indent = jsonIndent();
  return jsonc.modify(text, path, value, {
    formattingOptions: {
      insertSpaces: typeof indent === 'number',
      tabSize: typeof indent === 'number' ? indent : 4,
      eol: text.includes('\r\n') ? '\r\n' : '\n',
    },
  });
}

/** Apply a set of path -> value modifications to an open document as one undoable edit. */
export async function applyJsonModifications(doc: vscode.TextDocument, mods: { path: JsonPath; value: unknown }[]): Promise<boolean> {
  let text = doc.getText();
  for (const m of mods) {
    const edits = modifyEdits(text, m.path, m.value);
    text = jsonc.applyEdits(text, edits);
  }
  return replaceDocument(doc, text);
}

/** Replace the whole document text (one undo step). No-op if unchanged. */
export async function replaceDocument(doc: vscode.TextDocument, text: string): Promise<boolean> {
  if (doc.getText() === text) return true;
  const edit = new vscode.WorkspaceEdit();
  edit.replace(doc.uri, new vscode.Range(0, 0, doc.lineCount, 0), text);
  return vscode.workspace.applyEdit(edit);
}

/** Pretty-print a value with the user's JSON indentation and the document's EOL. */
export function formatJson(value: unknown, eol = '\n'): string {
  return JSON.stringify(value, null, jsonIndent()).replace(/\n/g, eol) + eol;
}

export { jsonc };
