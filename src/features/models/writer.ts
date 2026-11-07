// Writes planned files (templates.ts Plan) into a resource root: never clobbers existing JSON,
// merges lang files and appends to tags.
import * as vscode from 'vscode';
import { exists, jsonIndent, readJson, readText, writeText } from '../../core/fsUtils';
import { appendTag, mergeLang, PlannedFile, stringifyMcJson } from './templates';
import { colorForId, placeholderPng } from './png';
import type { GeneratorResult, TextureChoice } from './viewTypes';

export type FileStatus = GeneratorResult['files'][number];

/** Bytes of a planned texture (placeholder PNG or a copied file). */
export async function textureBytes(t: NonNullable<PlannedFile['texture']>, placeholderKind: 'item' | 'block' | 'cross'): Promise<Uint8Array> {
  const c: TextureChoice = t.choice;
  if (c.source === 'file' && c.file) return vscode.workspace.fs.readFile(vscode.Uri.file(c.file));
  return placeholderPng(placeholderKind, c.color || defaultColor(t.id, t.slot), t.id);
}

export function defaultColor(textureId: string, slot: string): string {
  // Same hue for every slot of a block, slightly different for secondary slots
  const base = textureId.replace(/_(top|end|front|side)$/, '');
  return colorForId(slot === 'top' || slot === 'end' ? `${base}#2` : slot === 'front' ? `${base}#3` : base);
}

export async function writePlan(root: vscode.Uri, files: PlannedFile[], placeholderKind: 'item' | 'block' | 'cross'): Promise<FileStatus[]> {
  const out: FileStatus[] = [];
  const indent = jsonIndent();
  for (const f of files) {
    const uri = vscode.Uri.joinPath(root, ...f.path.split('/'));
    const status: FileStatus = { path: f.path, uri: uri.toString(), status: 'created' };
    try {
      const present = await exists(uri);
      if (f.type === 'texture' && f.texture) {
        if (present) Object.assign(status, { status: 'skipped', detail: 'exists' });
        else {
          await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, '..'));
          await vscode.workspace.fs.writeFile(uri, await textureBytes(f.texture, placeholderKind));
        }
      } else if (f.type === 'json') {
        if (present) Object.assign(status, { status: 'skipped', detail: 'exists' });
        else await writeText(uri, stringifyMcJson(f.json, indent, f.floatKeys));
      } else if (f.type === 'lang') {
        const text = present ? await readText(uri) : undefined;
        const r = mergeLang(text, f.entries ?? {}, detectIndent(text) ?? indent);
        if (!r.added.length) Object.assign(status, { status: 'skipped', detail: 'keys exist' });
        else {
          await writeText(uri, r.text);
          if (present) Object.assign(status, { status: 'updated', detail: `+${r.added.length}` });
        }
      } else if (f.type === 'tag') {
        const existing = present ? await readJson(uri) : undefined;
        const r = appendTag(existing, f.values ?? []);
        if (!r.added.length) Object.assign(status, { status: 'skipped', detail: 'already tagged' });
        else {
          await writeText(uri, stringifyMcJson(r.json, detectIndent(present ? await readText(uri) : undefined) ?? indent));
          if (present) Object.assign(status, { status: 'updated', detail: `+${r.added.length}` });
        }
      }
    } catch (e) {
      Object.assign(status, { status: 'error', detail: e instanceof Error ? e.message : String(e) });
    }
    out.push(status);
  }
  return out;
}

function detectIndent(text: string | undefined): string | number | undefined {
  const m = text ? /\n([ \t]+)"/.exec(text) : null;
  if (!m) return undefined;
  return m[1].startsWith('\t') ? '\t' : m[1].length;
}
