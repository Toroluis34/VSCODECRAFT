import * as vscode from 'vscode';
import type { Core } from '../../core/core';
import { schemaForPath } from './schemaMap';
import { checkVersionCompat, type VersionIssue } from './versionCheck';

/**
 * Feature "schemas": JSON Schemas for Minecraft data / asset files are contributed statically through
 * `jsonValidation` (see contributes.json and schemas/minecraft/). At runtime this feature only adds:
 *  - version-compatibility diagnostics the schemas can't express (they accept every 1.21–26.x format),
 *  - a command that opens every Minecraft JSON file in the background so the JSON language service reports
 *    schema problems for the whole workspace.
 */
export function activate(core: Core): void {
  const diagnostics = vscode.languages.createDiagnosticCollection('vscodecraft-schemas');
  core.track(diagnostics);
  const timers = new Map<string, NodeJS.Timeout>();

  const enabled = (uri: vscode.Uri) => vscode.workspace.getConfiguration('vscodecraft.schemas', uri).get<boolean>('versionChecks', true);

  const check = (doc: vscode.TextDocument) => {
    if (doc.uri.scheme !== 'file' && doc.uri.scheme !== 'vscode-remote' && doc.uri.scheme !== 'untitled') return;
    const schema = schemaForPath(doc.uri.path);
    if (!schema || !enabled(doc.uri)) {
      diagnostics.delete(doc.uri);
      return;
    }
    let issues: VersionIssue[] = [];
    try {
      issues = checkVersionCompat(schema, doc.getText(), core.features(doc.uri));
    } catch (e) {
      core.log.error(e instanceof Error ? e : String(e));
    }
    diagnostics.set(
      doc.uri,
      issues.map((i) => {
        const range = new vscode.Range(doc.positionAt(i.offset), doc.positionAt(i.offset + i.length));
        const d = new vscode.Diagnostic(range, message(i), i.severity === 'error' ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning);
        d.source = 'VSCodeCraft';
        d.code = `version-${i.code}`;
        return d;
      }),
    );
  };
  const schedule = (doc: vscode.TextDocument) => {
    const key = doc.uri.toString();
    clearTimeout(timers.get(key));
    timers.set(key, setTimeout(() => (timers.delete(key), check(doc)), 300));
  };

  core.track(
    vscode.workspace.onDidOpenTextDocument(check),
    vscode.workspace.onDidChangeTextDocument((e) => schedule(e.document)),
    vscode.workspace.onDidCloseTextDocument((d) => diagnostics.delete(d.uri)),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('vscodecraft.schemas') || e.affectsConfiguration('vscodecraft.minecraftVersion')) {
        vscode.workspace.textDocuments.forEach(check);
      }
    }),
    { dispose: () => timers.forEach((t) => clearTimeout(t)) },
  );
  vscode.workspace.textDocuments.forEach(check);

  core.registerCommand('vscodecraft.schemas.validateAll', () => validateAll(core));
}

function message(i: VersionIssue): string {
  const [a, b, c] = i.args;
  switch (i.code) {
    case 'recipeTooNew':
      return vscode.l10n.t("Recipe type '{0}' requires Minecraft {1} or newer (target version: {2}).", a, b, c);
    case 'recipeRemoved':
      return vscode.l10n.t("Recipe type '{0}' was removed in Minecraft {1} (target version: {2}).", a, b, c);
    case 'itemDefinitionsTooNew':
      return vscode.l10n.t('Item model definitions (assets/<namespace>/items) require Minecraft 1.21.4 or newer (target version: {0}).', a);
    case 'packNeedsMinMax':
      return vscode.l10n.t('Minecraft {0} uses "min_format" and "max_format" in pack.mcmeta (keep "pack_format" only for older versions).', a);
    case 'packNeedsPackFormat':
      return vscode.l10n.t('Minecraft {0} requires "pack_format" in pack.mcmeta.', a);
    case 'customModelDataObject':
      return vscode.l10n.t('Since 1.21.4 "custom_model_data" is an object ({"floats": [...], "flags": [...], "strings": [...], "colors": [...]}), not a number (target version: {0}).', a);
    case 'customModelDataInt':
      return vscode.l10n.t('Before 1.21.4 "custom_model_data" is a number (target version: {0}).', a);
    case 'componentRemoved':
      return vscode.l10n.t("Component '{0}' was removed in Minecraft {1}; use '{2}' instead.", a, b, c);
  }
}

const EXCLUDE = '**/{node_modules,.git,.gradle,build,out,run,bin,.idea}/**';

async function validateAll(core: Core): Promise<void> {
  const patterns = ['**/{data,assets}/**/*.json', '**/*.mcmeta', '**/fabric.mod.json', '**/quilt.mod.json'];
  const found = new Map<string, vscode.Uri>();
  for (const p of patterns) {
    for (const uri of await vscode.workspace.findFiles(p, EXCLUDE, 20000)) {
      if (schemaForPath(uri.path)) found.set(uri.toString(), uri);
    }
  }
  const uris = [...found.values()];
  if (!uris.length) {
    void vscode.window.showInformationMessage(vscode.l10n.t('No Minecraft JSON files found in the workspace.'));
    return;
  }
  const cancelled = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: vscode.l10n.t('Validating Minecraft JSON files'), cancellable: true },
    async (progress, token) => {
      let done = 0;
      for (const uri of uris) {
        if (token.isCancellationRequested) return true;
        try {
          await vscode.workspace.openTextDocument(uri);
        } catch (e) {
          core.log.warn(`schemas: cannot open ${uri.fsPath}: ${String(e)}`);
        }
        done++;
        if (done % 25 === 0) progress.report({ message: `${done}/${uris.length}`, increment: (25 / uris.length) * 100 });
      }
      // Give the JSON language server a moment to publish diagnostics.
      await new Promise((r) => setTimeout(r, Math.min(5000, 1000 + uris.length * 2)));
      return false;
    },
  );
  if (cancelled) return;
  let errors = 0;
  let warnings = 0;
  let files = 0;
  for (const uri of uris) {
    const diags = vscode.languages.getDiagnostics(uri);
    if (diags.length) files++;
    for (const d of diags) {
      if (d.severity === vscode.DiagnosticSeverity.Error) errors++;
      else if (d.severity === vscode.DiagnosticSeverity.Warning) warnings++;
    }
  }
  const show = vscode.l10n.t('Show Problems');
  const msg = vscode.l10n.t('Validated {0} Minecraft JSON files: {1} errors and {2} warnings in {3} files.', uris.length, errors, warnings, files);
  const pick = await (errors || warnings ? vscode.window.showWarningMessage(msg, show) : vscode.window.showInformationMessage(msg));
  if (pick === show) await vscode.commands.executeCommand('workbench.actions.view.problems');
}
