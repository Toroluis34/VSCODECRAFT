import * as vscode from 'vscode';
import * as jsonc from 'jsonc-parser';

const decoder = new TextDecoder();
const encoder = new TextEncoder();

export async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

/** Reads a text file, preferring the content of an open (possibly unsaved) document. */
export async function readText(uri: vscode.Uri): Promise<string | undefined> {
  const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
  if (open) return open.getText();
  try {
    return decoder.decode(await vscode.workspace.fs.readFile(uri));
  } catch {
    return undefined;
  }
}

/** Reads and parses JSON (comments and trailing commas tolerated). Returns undefined on failure. */
export async function readJson<T = unknown>(uri: vscode.Uri): Promise<T | undefined> {
  const text = await readText(uri);
  if (text === undefined) return undefined;
  const errors: jsonc.ParseError[] = [];
  const value = jsonc.parse(text, errors, { allowTrailingComma: true, disallowComments: false });
  return value as T;
}

export async function writeText(uri: vscode.Uri, text: string): Promise<void> {
  await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, '..'));
  await vscode.workspace.fs.writeFile(uri, encoder.encode(text));
}

/** Serialize JSON the way Minecraft data files are usually written (2-space indent, trailing newline). */
export function stringifyJson(value: unknown, indent: number | string = 2): string {
  return JSON.stringify(value, null, indent) + '\n';
}

export async function writeJson(uri: vscode.Uri, value: unknown): Promise<void> {
  await writeText(uri, stringifyJson(value, jsonIndent()));
}

/** Indentation configured for JSON files (editor.tabSize / insertSpaces for [json]). */
export function jsonIndent(): number | string {
  const cfg = vscode.workspace.getConfiguration('editor', { languageId: 'json' });
  const insertSpaces = cfg.get<boolean>('insertSpaces', true);
  const tabSize = cfg.get<number>('tabSize', 2);
  return insertSpaces ? tabSize : '\t';
}

/**
 * Create a file only if it does not exist. Returns true if written.
 * When `overwrite` is 'ask', prompts the user.
 */
export async function createFile(
  uri: vscode.Uri,
  content: string,
  overwrite: boolean | 'ask' = 'ask',
): Promise<boolean> {
  if (await exists(uri)) {
    if (overwrite === false) return false;
    if (overwrite === 'ask') {
      const yes = vscode.l10n.t('Overwrite');
      const pick = await vscode.window.showWarningMessage(
        vscode.l10n.t('{0} already exists. Overwrite it?', vscode.workspace.asRelativePath(uri)),
        { modal: true },
        yes,
      );
      if (pick !== yes) return false;
    }
  }
  await writeText(uri, content);
  return true;
}

export async function readDirSafe(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
  try {
    return await vscode.workspace.fs.readDirectory(uri);
  } catch {
    return [];
  }
}

export async function openFile(uri: vscode.Uri, options?: vscode.TextDocumentShowOptions): Promise<void> {
  const ext = uri.path.split('.').pop()?.toLowerCase();
  if (ext === 'png' || ext === 'nbt') {
    await vscode.commands.executeCommand('vscode.open', uri);
    return;
  }
  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(doc, options);
}
