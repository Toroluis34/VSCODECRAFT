// "Pack Doctor" report + diagnostics for invalid resource file paths.
import * as vscode from 'vscode';
import type { Core } from '../../core/core';
import { exists } from '../../core/fsUtils';
import { jsonc } from '../../core/jsonUtils';
import { atLeast } from '../../core/versions';
import { isJunkFile, isKnownFolder, PathProblem, validateResourcePath } from './pathValidation';
import { validatePackMcmeta, versionFormat } from './packFormat';
import { listFiles, packKinds, relPath, t, versionTable } from './util';

function pathProblemMessage(p: PathProblem): string {
  switch (p.code) {
    case 'invalidNamespace':
      return t('Invalid namespace "{0}": only lowercase a-z, 0-9, "_", "-" and "." are allowed. The game will ignore this file.', p.segment);
    case 'uppercase':
      return t('"{0}" contains uppercase letters: resource paths must be lowercase or the game will not load the file.', p.segment);
    case 'spaces':
      return t('"{0}" contains spaces: resource paths cannot contain spaces.', p.segment);
    case 'invalidChars':
      return t('"{0}" contains characters that are not allowed in resource paths (only a-z, 0-9, "_", "-", "." and "/").', p.segment);
    case 'emptySegment':
      return t('Empty folder name in the path.');
  }
}

/** All resource roots known to the extension (projects + index + pack.mcmeta folders). */
async function allRoots(core: Core): Promise<vscode.Uri[]> {
  await core.projects.ready;
  const set = new Map<string, vscode.Uri>();
  for (const p of core.projects.projects) for (const r of p.resourceRoots) set.set(r.fsPath, r);
  for (const r of core.index.roots()) set.set(vscode.Uri.file(r).fsPath, vscode.Uri.file(r));
  for (const m of await vscode.workspace.findFiles('**/pack.mcmeta', '**/{node_modules,build,.gradle,run,runs,out,bin,.git}/**', 200)) {
    const dir = vscode.Uri.joinPath(m, '..');
    set.set(dir.fsPath, dir);
  }
  return [...set.values()].sort((a, b) => a.fsPath.localeCompare(b.fsPath));
}

interface Finding {
  severity: 'error' | 'warning' | 'info';
  uri?: vscode.Uri;
  message: string;
}

async function checkRoot(core: Core, root: vscode.Uri): Promise<{ findings: Finding[]; files: number }> {
  const findings: Finding[] = [];
  const version = core.version(root);
  const mcmetaUri = vscode.Uri.joinPath(root, 'pack.mcmeta');
  const project = core.projects.projectFor(root);
  const isPack = project?.loader === 'datapack' || project?.loader === 'resourcepack' || (await exists(mcmetaUri));
  if (!(await exists(mcmetaUri))) {
    if (isPack || !project || project.loader === 'unknown') findings.push({ severity: 'error', message: t('pack.mcmeta is missing: the game will not recognize this folder as a pack.') });
    else findings.push({ severity: 'info', message: t('No pack.mcmeta (fine for {0} mods; required for standalone packs).', project.loader) });
  } else {
    const bytes = await vscode.workspace.fs.readFile(mcmetaUri);
    const errors: jsonc.ParseError[] = [];
    const value = jsonc.parse(new TextDecoder().decode(bytes), errors, { allowTrailingComma: true });
    if (errors.length) findings.push({ severity: 'error', uri: mcmetaUri, message: t('pack.mcmeta is not valid JSON.') });
    else {
      const kinds = await packKinds(root);
      for (const k of kinds) {
        const v = versionTable().find((x) => x.id === version);
        for (const p of validatePackMcmeta(value, k, version, v ? versionFormat(v, k) : undefined)) {
          findings.push({ severity: p.severity, uri: mcmetaUri, message: `pack.mcmeta (${k === 'data' ? 'data' : 'resources'}): ${p.code} ${p.args.join(' ')}`.trim() });
        }
      }
    }
  }
  const files = [...(await listFiles(vscode.Uri.joinPath(root, 'data'))), ...(await listFiles(vscode.Uri.joinPath(root, 'assets')))];
  const legacy = new Set<string>();
  for (const uri of files) {
    const rel = relPath(root, uri);
    if (isJunkFile(rel)) {
      findings.push({ severity: 'info', uri, message: t('Junk file (excluded from exports): {0}', rel) });
      continue;
    }
    for (const p of validateResourcePath(rel)) findings.push({ severity: 'error', uri, message: `${rel}: ${pathProblemMessage(p)}` });
    if (!isKnownFolder(rel)) findings.push({ severity: 'info', uri, message: t('{0} is outside the folders Minecraft reads (typo, or a folder used by a mod?).', rel) });
    const info = core.index.info(uri);
    if (info?.legacyFolder && atLeast(version, '1.21')) legacy.add(rel.split('/').slice(0, 3).join('/'));
    if (/\.(json|mcmeta)$/.test(rel) || rel.endsWith('.mcfunction')) {
      let text = '';
      try {
        text = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
      } catch {
        continue;
      }
      if (!text.trim()) {
        findings.push({ severity: 'warning', uri, message: t('Empty file: {0}', rel) });
        continue;
      }
      if (!rel.endsWith('.mcfunction')) {
        const errors: jsonc.ParseError[] = [];
        jsonc.parse(text, errors, { allowTrailingComma: false, disallowComments: true });
        if (errors.length) {
          const e = errors[0];
          const line = text.slice(0, e.offset).split('\n').length;
          findings.push({ severity: 'error', uri, message: t('JSON error in {0} (line {1}): {2}', rel, line, jsonc.printParseErrorCode(e.error)) });
        }
      }
    }
  }
  for (const l of legacy) findings.push({ severity: 'warning', message: t('{0} uses a pre-1.21 plural folder name; Minecraft {1} ignores it. Run "Migrate Pack/Mod Resources to Version…".', l, version) });
  return { findings, files: files.length };
}

function duplicates(core: Core): Finding[] {
  const out: Finding[] = [];
  for (const kind of core.index.kinds()) {
    for (const id of core.index.ids(kind)) {
      const files = core.index.get(kind, id);
      const roots = new Set(files.map((f) => f.root));
      if (files.length > 1 && roots.size > 1 && !kind.startsWith('tags/') && kind !== 'lang' && kind !== 'sounds') {
        out.push({ severity: 'warning', uri: files[0].uri, message: t('{0} "{1}" is defined in {2} resource roots: {3}', kind, id, roots.size, files.map((f) => vscode.workspace.asRelativePath(f.uri)).join(', ')) });
      }
    }
  }
  return out;
}

const ICON: Record<Finding['severity'], string> = { error: '❌', warning: '⚠️', info: 'ℹ️' };

export function registerDoctor(core: Core): void {
  core.registerCommand('vscodecraft.datapack.packDoctor', async () => {
    const report = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: t('Pack Doctor: checking the workspace…') }, async () => {
      await core.index.ready;
      const roots = await allRoots(core);
      const lines: string[] = [`# ${t('Pack Doctor')}`, ''];
      let errors = 0;
      let warnings = 0;
      if (!roots.length) lines.push(t('No data/ or assets/ folders found in the workspace.'));
      for (const root of roots) {
        const { findings, files } = await checkRoot(core, root);
        const project = core.projects.projectFor(root);
        lines.push(`## ${vscode.workspace.asRelativePath(root)}`, '');
        lines.push(`${t('Target version')}: **${core.version(root)}** · ${t('Loader')}: ${project?.loader ?? '—'} · ${t('Files')}: ${files}`, '');
        if (!findings.length) lines.push(`✅ ${t('No problems found.')}`, '');
        const sorted = findings.sort((a, b) => ['error', 'warning', 'info'].indexOf(a.severity) - ['error', 'warning', 'info'].indexOf(b.severity));
        for (const f of sorted.slice(0, 500)) {
          if (f.severity === 'error') errors++;
          if (f.severity === 'warning') warnings++;
          lines.push(`- ${ICON[f.severity]} ${f.message}${f.uri ? ` — [${t('open')}](${f.uri.toString()})` : ''}`);
        }
        if (sorted.length > 500) lines.push(`- … ${t('{0} more', sorted.length - 500)}`);
        lines.push('');
      }
      const dups = duplicates(core);
      if (dups.length) {
        lines.push(`## ${t('Duplicate ids across resource roots')}`, '');
        for (const d of dups.slice(0, 300)) {
          warnings++;
          lines.push(`- ${ICON[d.severity]} ${d.message}`);
        }
        lines.push('');
      }
      lines.splice(1, 0, `${t('{0} errors, {1} warnings', errors, warnings)}`, '');
      return lines.join('\n');
    });
    const doc = await vscode.workspace.openTextDocument({ language: 'markdown', content: report });
    await vscode.commands.executeCommand('markdown.showPreview', doc.uri).then(undefined, () => vscode.window.showTextDocument(doc));
  });

  // ---------- path diagnostics
  const diagnostics = vscode.languages.createDiagnosticCollection('vscodecraft-paths');
  core.track(diagnostics);
  const enabled = () => vscode.workspace.getConfiguration('vscodecraft.datapack').get<boolean>('pathDiagnostics', true);
  const checkUri = (uri: vscode.Uri) => {
    const info = core.index.info(uri);
    if (!info || !enabled()) {
      diagnostics.delete(uri);
      return;
    }
    const rel = relPath(vscode.Uri.file(info.root), uri);
    const problems = validateResourcePath(rel);
    diagnostics.set(
      uri,
      problems.map((p) => {
        const d = new vscode.Diagnostic(new vscode.Range(0, 0, 0, 0), pathProblemMessage(p), vscode.DiagnosticSeverity.Error);
        d.source = 'VSCodeCraft';
        d.code = 'invalid-resource-path';
        return d;
      }),
    );
  };
  const scanAll = async () => {
    await core.index.ready;
    diagnostics.clear();
    if (!enabled()) return;
    for (const kind of core.index.kinds()) for (const r of core.index.all(kind)) if (/[^a-z0-9_./-]/.test(r.path)) checkUri(r.uri);
    // Namespaces with uppercase letters are not indexed: check open documents too.
    vscode.workspace.textDocuments.forEach((d) => checkUri(d.uri));
  };
  void scanAll();
  core.track(
    core.index.onDidChange(() => void scanAll()),
    vscode.workspace.onDidOpenTextDocument((d) => checkUri(d.uri)),
    vscode.workspace.onDidChangeConfiguration((e) => e.affectsConfiguration('vscodecraft.datapack.pathDiagnostics') && void scanAll()),
    vscode.languages.registerCodeActionsProvider({ scheme: 'file' }, {
      provideCodeActions(doc, _range, ctx) {
        const d = ctx.diagnostics.find((x) => x.code === 'invalid-resource-path');
        if (!d) return [];
        const info = core.index.info(doc.uri);
        if (!info) return [];
        const root = vscode.Uri.file(info.root);
        const rel = relPath(root, doc.uri);
        const suggestion = validateResourcePath(rel)[0]?.suggestion;
        if (!suggestion || suggestion === rel) return [];
        const a = new vscode.CodeAction(t('Rename to {0}', suggestion.split('/').slice(1).join('/')), vscode.CodeActionKind.QuickFix);
        a.edit = new vscode.WorkspaceEdit();
        a.edit.renameFile(doc.uri, vscode.Uri.joinPath(root, suggestion), { overwrite: false });
        a.diagnostics = [d];
        a.isPreferred = true;
        return [a];
      },
    }),
  );
}
