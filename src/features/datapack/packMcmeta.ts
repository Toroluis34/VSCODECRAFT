// pack.mcmeta tools: create/update for a version or a version range, overlays, CodeLens, hover, diagnostics.
import * as vscode from 'vscode';
import * as path from 'node:path';
import type { Core } from '../../core/core';
import { exists } from '../../core/fsUtils';
import { jsonc } from '../../core/jsonUtils';
import { compareVersions } from '../../core/versions';
import {
  buildOverlayEntries,
  buildPackSection,
  describeVersions,
  FormatRange,
  fmtToString,
  isFormatInRange,
  overlayName,
  PackKind,
  PackProblem,
  parseFormatValue,
  parseOldRange,
  rangeForVersions,
  readPackRange,
  validatePackMcmeta,
  versionFormat,
  versionsInRange,
} from './packFormat';
import { indentOf, kindLabel, packKinds, pickResourceRoot, pickVersion, readJsonc, t, versionTable, writeTextSmart } from './util';

const SELECTOR: vscode.DocumentSelector = [{ pattern: '**/pack.mcmeta' }];

function problemMessage(p: PackProblem): string {
  const a = p.args;
  switch (p.code) {
    case 'missingPack':
      return t('pack.mcmeta must contain a "pack" object.');
    case 'missingDescription':
      return t('Missing "description".');
    case 'missingMinMax':
      return t('Minecraft {0} requires "min_format" and "max_format" (since 1.21.9).', a[0]);
    case 'missingPackFormat':
      return t('"pack_format" is required while the pack supports formats below {0} (pre-1.21.9 versions).', a[0]);
    case 'missingSupportedFormats':
      return t('"supported_formats" is required while the pack supports formats below {0} (pre-1.21.9 versions).', a[0]);
    case 'supportedFormatsNotAllowed':
      return t('"supported_formats" is not allowed when every supported format is {0} or newer (1.21.9+). Remove it.', a[0]);
    case 'supportedFormatsMismatch':
      return t('"supported_formats" should match the major versions of min_format/max_format: [{0}, {1}].', a[0], a[1]);
    case 'packFormatOutOfRange':
      return t('"pack_format" {0} is outside "supported_formats" {1}.', a[0], a[1]);
    case 'minGreaterThanMax':
      return t('The minimum format is greater than the maximum format.');
    case 'targetNotSupported':
      return t('The target version {0} (format {1}) is not inside the supported formats of this pack.', a[0], a[1]);
    case 'invalidFormatValue':
      return t('"{0}" must be an integer or a [major, minor] array.', a[0]);
    case 'overlayFormatsRequired':
      return t('Overlay entries need "formats" while any overlay supports pre-1.21.9 formats.');
    case 'overlayFormatsNotAllowed':
      return t('Overlay "formats" is not allowed when no overlay supports pre-1.21.9 formats.');
    case 'overlayMissingMinMax':
      return t('Overlay entries require "min_format" and "max_format" (since 1.21.9).');
  }
}

async function kindsFor(uri: vscode.Uri): Promise<PackKind[]> {
  return packKinds(vscode.Uri.joinPath(uri, '..'));
}

function targetFormat(version: string, kind: PackKind) {
  const v = versionTable().find((x) => x.id === version) ?? versionTable().find((x) => x.type === 'release' && compareVersions(x.id, version) <= 0);
  return v ? versionFormat(v, kind) : undefined;
}

function rangeOfNode(doc: vscode.TextDocument, tree: jsonc.Node | undefined, p: (string | number)[]): vscode.Range {
  let node = tree ? jsonc.findNodeAtLocation(tree, p) : undefined;
  if (node?.parent?.type === 'property') node = node.parent;
  if (!node) return new vscode.Range(0, 0, 0, 1);
  return new vscode.Range(doc.positionAt(node.offset), doc.positionAt(node.offset + node.length));
}

/** Write a new "pack" section (keeping description & other keys), plus overlays if given. */
async function writePackMcmeta(uri: vscode.Uri, range: FormatRange, kind: PackKind, description?: string): Promise<void> {
  const existing = await readJsonc(uri);
  const root: Record<string, any> = existing?.value && typeof existing.value === 'object' && !Array.isArray(existing.value) ? existing.value : {};
  const pack = root.pack && typeof root.pack === 'object' ? root.pack : {};
  const extra: Record<string, unknown> = { description: pack.description ?? description ?? '' };
  for (const [k, v] of Object.entries(pack)) if (!(k in extra)) extra[k] = v;
  const out: Record<string, any> = { ...root, pack: buildPackSection(range, kind, extra) };
  // Re-normalize overlays for the new pack range
  const entries = root.overlays?.entries;
  if (Array.isArray(entries) && entries.length) {
    const specs = entries.map((e: any) => ({ directory: String(e?.directory ?? ''), range: overlayRange(e) ?? range }));
    out.overlays = { ...root.overlays, entries: buildOverlayEntries(specs, kind, range) };
  }
  const indent = existing ? indentOf(existing.text) : 2;
  await writeTextSmart(uri, JSON.stringify(out, null, indent) + '\n');
}

function overlayRange(e: any): FormatRange | undefined {
  const mn = parseFormatValue(e?.min_format);
  const mx = parseFormatValue(e?.max_format);
  if (mn && mx) return { min: mn, max: mx };
  const f = parseOldRange(e?.formats);
  return f ? { min: [f[0], 0], max: [f[1], 0] } : undefined;
}

async function chooseKind(root: vscode.Uri): Promise<PackKind | undefined> {
  const hasData = await exists(vscode.Uri.joinPath(root, 'data'));
  const hasAssets = await exists(vscode.Uri.joinPath(root, 'assets'));
  if (hasData !== hasAssets) return hasData ? 'data' : 'resource';
  const pick = await vscode.window.showQuickPick(
    [
      { label: kindLabel('data'), description: 'data/', pk: 'data' as PackKind },
      { label: kindLabel('resource'), description: 'assets/', pk: 'resource' as PackKind },
    ],
    { placeHolder: hasData ? t('This folder has data/ and assets/: which formats should pack.mcmeta use?') : t('What kind of pack is this?') },
  );
  return pick?.pk;
}

/** Ask for a version range; returns [min, max]. */
async function pickRange(core: Core, kind: PackKind, uri?: vscode.Uri): Promise<[string, string] | undefined> {
  const target = core.version(uri);
  const min = await pickVersion(t('Oldest supported Minecraft version'), { current: target, kind });
  if (!min) return undefined;
  const max = await pickVersion(t('Newest supported Minecraft version'), { current: target, min, kind });
  if (!max) return undefined;
  return [min, max];
}

export function registerPackMcmeta(core: Core): void {
  // ---------- commands
  const createOrUpdate = async (uri?: vscode.Uri, opts?: { mode?: 'target' | 'range' }) => {
    const root = await pickResourceRoot(core, uri, t('Folder for pack.mcmeta'));
    if (!root) return;
    const kind = await chooseKind(root);
    if (!kind) return;
    const file = vscode.Uri.joinPath(root, 'pack.mcmeta');
    const target = core.version(file);
    let mode = opts?.mode;
    if (!mode) {
      const pick = await vscode.window.showQuickPick(
        [
          { label: `$(target) ${t('Only Minecraft {0} (target version)', target)}`, mode: 'target' as const },
          { label: `$(versions) ${t('A range of Minecraft versions…')}`, mode: 'range' as const },
        ],
        { placeHolder: t('Which Minecraft versions should this pack support?') },
      );
      mode = pick?.mode;
    }
    if (!mode) return;
    const versions: [string, string] | undefined = mode === 'target' ? [target, target] : await pickRange(core, kind, file);
    if (!versions) return;
    const range = rangeForVersions(versions[0], versions[1], kind, versionTable());
    if (!range) {
      void vscode.window.showErrorMessage(t('Unknown Minecraft version {0}.', versions.join(' / ')));
      return;
    }
    let description: string | undefined;
    if (!(await exists(file))) {
      description = await vscode.window.showInputBox({
        prompt: t('Pack description'),
        value: path.basename(core.projects.projectFor(file)?.root.fsPath ?? root.fsPath),
      });
      if (description === undefined) return;
    }
    await writePackMcmeta(file, range, kind, description);
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(file));
    void vscode.window.showInformationMessage(
      t('pack.mcmeta now supports {0} (formats {1}–{2}).', describeVersions(range, kind, versionTable()) || versions.join('–'), fmtToString(range.min), fmtToString(range.max)),
    );
  };
  core.registerCommand('vscodecraft.datapack.createPackMcmeta', (uri?: vscode.Uri, opts?: { mode?: 'target' | 'range' }) => createOrUpdate(uri, opts));
  core.registerCommand('vscodecraft.datapack.setSupportedVersions', (uri?: vscode.Uri) => createOrUpdate(uri, { mode: 'range' }));

  core.registerCommand('vscodecraft.datapack.addOverlay', async (uri?: vscode.Uri) => {
    const root = await pickResourceRoot(core, uri, t('Pack folder'));
    if (!root) return;
    const file = vscode.Uri.joinPath(root, 'pack.mcmeta');
    const existing = await readJsonc(file);
    if (!existing) {
      void vscode.window.showWarningMessage(t('Create pack.mcmeta first.'));
      return;
    }
    const kind = await chooseKind(root);
    if (!kind) return;
    const versions = await pickRange(core, kind, file);
    if (!versions) return;
    const range = rangeForVersions(versions[0], versions[1], kind, versionTable());
    if (!range) return;
    const dir = await vscode.window.showInputBox({
      prompt: t('Overlay folder name (files inside replace the base pack for these versions)'),
      value: overlayName(versions[0], versions[1]),
      validateInput: (v) => (/^[a-z0-9_.-]+$/.test(v) ? undefined : t('Use only a-z, 0-9, "_", "-" and ".".')),
    });
    if (!dir) return;
    const root0: Record<string, any> = existing.value ?? {};
    const entries: any[] = Array.isArray(root0.overlays?.entries) ? root0.overlays.entries : [];
    const specs = entries.filter((e) => e?.directory !== dir).map((e) => ({ directory: String(e.directory), range: overlayRange(e) ?? range }));
    specs.push({ directory: dir, range });
    const packRange = readPackRange(root0.pack);
    const merged: FormatRange | undefined = packRange
      ? {
          min: [range.min, packRange.min].sort((a, b) => a[0] - b[0] || a[1] - b[1])[0],
          max: [range.max, packRange.max].sort((a, b) => b[0] - a[0] || b[1] - a[1])[0],
        }
      : range;
    const out = { ...root0, overlays: { ...(root0.overlays ?? {}), entries: buildOverlayEntries(specs, kind, merged) } };
    await writeTextSmart(file, JSON.stringify(out, null, indentOf(existing.text)) + '\n');
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(root, dir, kind === 'data' ? 'data' : 'assets'));
    void vscode.window.showInformationMessage(t('Overlay "{0}" added for {1}.', dir, describeVersions(range, kind, versionTable()) || versions.join('–')));
  });

  // ---------- diagnostics
  const diagnostics = vscode.languages.createDiagnosticCollection('vscodecraft-packmeta');
  core.track(diagnostics);
  const validate = async (doc: vscode.TextDocument) => {
    if (!doc.uri.path.endsWith('/pack.mcmeta')) return;
    const text = doc.getText();
    const errors: jsonc.ParseError[] = [];
    const value = jsonc.parse(text, errors, { allowTrailingComma: true });
    if (errors.length) {
      diagnostics.set(doc.uri, []);
      return;
    }
    const tree = jsonc.parseTree(text);
    const version = core.version(doc.uri);
    const kinds = await kindsFor(doc.uri);
    const perKind = kinds.map((k) => validatePackMcmeta(value, k, version, targetFormat(version, k)));
    // With data/ and assets/ (mod resources) only report what is wrong for every kind.
    const problems = perKind[0].filter((p) => perKind.every((list) => list.some((q) => q.code === p.code)));
    diagnostics.set(
      doc.uri,
      problems.map((p) => {
        const d = new vscode.Diagnostic(rangeOfNode(doc, tree, p.path), problemMessage(p), p.severity === 'error' ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning);
        d.source = 'VSCodeCraft';
        d.code = p.code;
        return d;
      }),
    );
  };
  core.track(
    vscode.workspace.onDidOpenTextDocument(validate),
    vscode.workspace.onDidChangeTextDocument((e) => validate(e.document)),
    vscode.workspace.onDidCloseTextDocument((d) => diagnostics.delete(d.uri)),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('vscodecraft.minecraftVersion')) vscode.workspace.textDocuments.forEach(validate);
    }),
  );
  vscode.workspace.textDocuments.forEach(validate);
  void core.projects.ready.then(() => vscode.workspace.textDocuments.forEach(validate));

  // ---------- quick fixes
  core.track(
    vscode.languages.registerCodeActionsProvider(SELECTOR, {
      provideCodeActions(doc, _range, ctx) {
        if (!ctx.diagnostics.some((d) => d.source === 'VSCodeCraft')) return [];
        const version = core.version(doc.uri);
        const a = new vscode.CodeAction(t('Update pack.mcmeta for Minecraft {0}', version), vscode.CodeActionKind.QuickFix);
        a.command = { command: 'vscodecraft.datapack.createPackMcmeta', title: a.title, arguments: [doc.uri, { mode: 'target' }] };
        a.diagnostics = ctx.diagnostics.filter((d) => d.source === 'VSCodeCraft');
        a.isPreferred = true;
        const b = new vscode.CodeAction(t('Set supported version range…'), vscode.CodeActionKind.QuickFix);
        b.command = { command: 'vscodecraft.datapack.setSupportedVersions', title: b.title, arguments: [doc.uri] };
        return [a, b];
      },
    }),
  );

  // ---------- CodeLens
  const lensEmitter = new vscode.EventEmitter<void>();
  core.track(lensEmitter, core.projects.onDidChange(() => lensEmitter.fire()));
  core.track(
    vscode.languages.registerCodeLensProvider(SELECTOR, {
      onDidChangeCodeLenses: lensEmitter.event,
      async provideCodeLenses(doc) {
        const text = doc.getText();
        const tree = jsonc.parseTree(text);
        const value = jsonc.parse(text, [], { allowTrailingComma: true });
        if (!tree || !value?.pack) return [];
        const kinds = await kindsFor(doc.uri);
        const version = core.version(doc.uri);
        const lenses: vscode.CodeLens[] = [];
        const packNode = jsonc.findNodeAtLocation(tree, ['pack'])?.parent ?? tree;
        const at = new vscode.Range(doc.positionAt(packNode.offset), doc.positionAt(packNode.offset));
        const range = readPackRange(value.pack);
        if (range) {
          for (const k of kinds) {
            const desc = describeVersions(range, k, versionTable()) || t('unknown versions');
            const tf = targetFormat(version, k);
            const ok = tf ? isFormatInRange(tf, range) : true;
            lenses.push(
              new vscode.CodeLens(at, {
                title: `$(${ok ? 'pass' : 'warning'}) ${kindLabel(k)}: ${desc}  ·  ${t('target {0}', version)}`,
                tooltip: t('Formats {0} – {1}. Click to change the supported versions.', fmtToString(range.min), fmtToString(range.max)),
                command: 'vscodecraft.datapack.setSupportedVersions',
                arguments: [doc.uri],
              }),
            );
          }
        } else {
          lenses.push(new vscode.CodeLens(at, { title: `$(add) ${t('Set pack format for Minecraft {0}', version)}`, command: 'vscodecraft.datapack.createPackMcmeta', arguments: [doc.uri, { mode: 'target' }] }));
        }
        lenses.push(new vscode.CodeLens(at, { title: `$(layers) ${t('Add overlay…')}`, command: 'vscodecraft.datapack.addOverlay', arguments: [doc.uri] }));
        const entries = value.overlays?.entries;
        if (Array.isArray(entries)) {
          entries.forEach((e: any, i: number) => {
            const r = overlayRange(e);
            const node = jsonc.findNodeAtLocation(tree, ['overlays', 'entries', i]);
            if (!r || !node) return;
            const pos = doc.positionAt(node.offset);
            lenses.push(
              new vscode.CodeLens(new vscode.Range(pos, pos), {
                title: `${String(e.directory)}: ${kinds.map((k) => describeVersions(r, k, versionTable()) || '?').join(' / ')}`,
                command: '',
              }),
            );
          });
        }
        return lenses;
      },
    }),
  );

  // ---------- hover on format values
  core.track(
    vscode.languages.registerHoverProvider(SELECTOR, {
      async provideHover(doc, pos) {
        const text = doc.getText();
        const loc = jsonc.getLocation(text, doc.offsetAt(pos));
        const p = loc.path;
        const key = p.find((x) => typeof x === 'string' && ['pack_format', 'min_format', 'max_format', 'supported_formats', 'formats'].includes(x)) as string | undefined;
        if (!key) return undefined;
        const tree = jsonc.parseTree(text);
        const keyIndex = p.indexOf(key);
        const node = tree ? jsonc.findNodeAtLocation(tree, p.slice(0, keyIndex + 1)) : undefined;
        if (!node) return undefined;
        const v = jsonc.getNodeValue(node);
        let r: FormatRange | undefined;
        if (key === 'supported_formats' || key === 'formats') {
          const o = parseOldRange(v);
          if (o) r = { min: [o[0], 0], max: [o[1], 0] };
        } else {
          const f = parseFormatValue(v);
          if (f) r = { min: f, max: f };
          // a major-only value matches every minor of that major for display
          if (f && typeof v === 'number') r = { min: [f[0], 0], max: [f[0], 999] };
        }
        if (!r) return undefined;
        const kinds = await kindsFor(doc.uri);
        const md = new vscode.MarkdownString();
        md.appendMarkdown(`**${key}**\n\n`);
        for (const k of kinds) {
          const desc = describeVersions(r, k, versionTable());
          const snaps = versionsInRange(r, k, versionTable(), true).filter((x) => x.type !== 'release').map((x) => x.id);
          md.appendMarkdown(`${kindLabel(k)}: ${desc || t('no known version')}${snaps.length && desc ? ` _(+ ${snaps.slice(0, 4).join(', ')}${snaps.length > 4 ? '…' : ''})_` : ''}\n\n`);
        }
        if (key === 'max_format' && typeof v === 'number') md.appendMarkdown(`_${t('A plain number means [{0}, 0]: write [{0}, minor] to include minor format versions.', String(v))}_\n\n`);
        return new vscode.Hover(md, new vscode.Range(doc.positionAt(node.offset), doc.positionAt(node.offset + node.length)));
      },
    }),
  );
}
