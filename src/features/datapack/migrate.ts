// "Migrate Pack/Mod Resources to Version…" command.
import * as vscode from 'vscode';
import type { Core } from '../../core/core';
import { compareVersions, latestRelease } from '../../core/versions';
import { applicableRules, migrateContent, migratePath, MigrationFile, MigrationRule, Msg, planMigration, PlannedAction } from './migration';
import { readPackRange, versionsInRange } from './packFormat';
import { listFiles, packKinds, pickResourceRoot, pickVersion, readJsonc, relPath, t, versionTable } from './util';

const TEXT_EXT = /\.(json|mcfunction|mcmeta)$/;

function ruleTitle(r: MigrationRule): string {
  return `${t(r.title, r.since)} (${r.since})`;
}

const msg = (m: Msg) => t(m.msg, ...m.args);

async function guessFromVersion(core: Core, root: vscode.Uri): Promise<string> {
  const mcmeta = await readJsonc(vscode.Uri.joinPath(root, 'pack.mcmeta'));
  const range = readPackRange(mcmeta?.value?.pack);
  if (range) {
    const kind = (await packKinds(root))[0];
    const v = versionsInRange({ min: range.min, max: range.min }, kind, versionTable())[0];
    if (v) return v.id;
  }
  return core.projects.projectFor(root)?.detectedVersion ?? '1.21.1';
}

async function collectFiles(root: vscode.Uri): Promise<MigrationFile[]> {
  const out: MigrationFile[] = [];
  const decoder = new TextDecoder();
  for (const side of ['data', 'assets']) {
    for (const uri of await listFiles(vscode.Uri.joinPath(root, side))) {
      const rel = relPath(root, uri);
      let text: string | undefined;
      if (TEXT_EXT.test(rel)) {
        const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
        if (open) text = open.getText();
        else {
          try {
            const bytes = await vscode.workspace.fs.readFile(uri);
            if (bytes.length < 4 * 1024 * 1024) text = decoder.decode(bytes);
          } catch {
            /* unreadable */
          }
        }
      }
      out.push({ path: rel, text });
    }
  }
  return out;
}

type Item = vscode.QuickPickItem & { actions?: PlannedAction[] };

export function registerMigration(core: Core): void {
  core.registerCommand('vscodecraft.datapack.migrate', async (uri?: vscode.Uri) => {
    const root = await pickResourceRoot(core, uri, t('Resources to migrate'));
    if (!root) return;
    const guess = await guessFromVersion(core, root);
    const from = await pickVersion(t('Minecraft version the files are written for (migrate FROM)'), { current: guess });
    if (!from) return;
    const target = core.version(root);
    const to = await pickVersion(t('Minecraft version to migrate TO'), {
      current: compareVersions(target, from) > 0 ? target : latestRelease(),
      min: from,
    });
    if (!to) return;
    if (compareVersions(to, from) <= 0) {
      void vscode.window.showInformationMessage(t('Nothing to migrate: {0} is not newer than {1}.', to, from));
      return;
    }
    const rules = applicableRules(from, to);
    const { files, plan } = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: t('Scanning {0}…', vscode.workspace.asRelativePath(root)) },
      async () => {
        const files = await collectFiles(root);
        return { files, plan: planMigration(files, from, to) };
      },
    );
    const actionable = plan.filter((a) => a.type !== 'note');
    const notes = plan.filter((a): a is Extract<PlannedAction, { type: 'note' }> => a.type === 'note');
    if (!actionable.length && !notes.length) {
      void vscode.window.showInformationMessage(t('No changes needed to migrate from {0} to {1}.', from, to));
      await offerRecipes(from, to, root);
      return;
    }

    // ---------- preview (multi-select)
    const items: Item[] = [];
    const perFile = actionable.length <= 400;
    for (const r of rules) {
      const acts = actionable.filter((a) => a.rule === r.id);
      if (!acts.length) continue;
      items.push({ label: ruleTitle(r), kind: vscode.QuickPickItemKind.Separator });
      if (!perFile) {
        items.push({ label: `$(checklist) ${ruleTitle(r)}`, description: t('{0} changes', acts.length), picked: true, actions: acts });
        continue;
      }
      for (const a of acts) {
        const label =
          a.type === 'rename'
            ? `$(arrow-right) ${a.path}`
            : a.type === 'create'
              ? `$(new-file) ${a.path}`
              : `$(edit) ${a.path}`;
        const description = a.type === 'rename' ? `→ ${a.newPath}` : a.type === 'create' ? t('from {0}', a.source) : undefined;
        items.push({ label, description, picked: true, actions: [a] });
      }
    }
    let selected: Item[] = [];
    if (actionable.length) {
      const picked = await vscode.window.showQuickPick(items, {
        canPickMany: true,
        title: t('Migrate {0} → {1}: {2} changes', from, to, actionable.length),
        placeHolder: t('Uncheck the changes you do not want, then press Enter'),
        matchOnDescription: true,
      });
      if (!picked) return;
      selected = picked;
    }
    const chosen = selected.flatMap((i) => i.actions ?? []);

    // ---------- build one WorkspaceEdit
    const enabledByFile = new Map<string, Set<string>>();
    for (const a of chosen) {
      if (a.type === 'create') continue;
      let s = enabledByFile.get(a.path);
      if (!s) enabledByFile.set(a.path, (s = new Set()));
      s.add(a.rule);
    }
    const edit = new vscode.WorkspaceEdit();
    const byPath = new Map(files.map((f) => [f.path, f]));
    const finalUris: vscode.Uri[] = [];
    const renamedFolders = new Set<string>();
    const applied: string[] = [];
    // Content edits first, then renames (edits target the original files).
    for (const [p, enabled] of enabledByFile) {
      const f = byPath.get(p);
      if (!f) continue;
      const res = migrateContent(f, rules, enabled);
      const uri = vscode.Uri.joinPath(root, p);
      if (res.text !== undefined && res.text !== f.text) {
        edit.replace(uri, new vscode.Range(0, 0, (f.text ?? '').split('\n').length + 1, 0), res.text, { label: t('Migrate content'), needsConfirmation: false });
        applied.push(`- ✏️ \`${p}\` (${res.changedBy.join(', ')})`);
      }
    }
    for (const [p, enabled] of enabledByFile) {
      const np = migratePath(p, rules, enabled).path;
      if (np === p) continue;
      const target = vscode.Uri.joinPath(root, np);
      edit.renameFile(vscode.Uri.joinPath(root, p), target, { overwrite: false, ignoreIfExists: true });
      renamedFolders.add(p.split('/').slice(0, -1).join('/'));
      finalUris.push(target);
      applied.push(`- 📁 \`${p}\` → \`${np}\``);
    }
    for (const a of chosen) {
      if (a.type !== 'create') continue;
      const target = vscode.Uri.joinPath(root, a.path);
      edit.createFile(target, { ignoreIfExists: true, contents: new TextEncoder().encode(a.text) });
      applied.push(`- ➕ \`${a.path}\``);
    }
    for (const p of enabledByFile.keys()) if (!finalUris.some((u) => relPath(root, u) === p)) finalUris.push(vscode.Uri.joinPath(root, p));
    if (edit.size) {
      const ok = await vscode.workspace.applyEdit(edit, { isRefactoring: true });
      if (!ok) {
        void vscode.window.showErrorMessage(t('The migration could not be applied.'));
        return;
      }
      // Save the touched documents so the index & the game see the new files.
      for (const doc of vscode.workspace.textDocuments) {
        if (doc.isDirty && finalUris.some((u) => u.toString() === doc.uri.toString())) await doc.save();
      }
      await removeEmptyFolders(root, renamedFolders);
    }

    // ---------- report
    const lines: string[] = [`# ${t('Migration {0} → {1}', from, to)}`, '', `${t('Folder')}: \`${vscode.workspace.asRelativePath(root)}\``, ''];
    lines.push(`## ${t('Applied changes')} (${applied.length})`, '', ...(applied.length ? applied : [`_${t('None')}_`]), '');
    if (notes.length) {
      lines.push(`## ${t('Needs manual review')} (${notes.length})`, '');
      for (const n of notes) lines.push(`- \`${n.path}\`: ${msg(n.note)}`);
      lines.push('');
    }
    lines.push(`## ${t('Rules checked')}`, '', ...rules.map((r) => `- ${ruleTitle(r)}`), '');
    const doc = await vscode.workspace.openTextDocument({ language: 'markdown', content: lines.join('\n') });
    await vscode.commands.executeCommand('markdown.showPreview', doc.uri).then(undefined, () => vscode.window.showTextDocument(doc));
    void vscode.window.showInformationMessage(t('Migration applied: {0} changes, {1} notes to review.', applied.length, notes.length));
    await offerRecipes(from, to, root);
  });
}

/** Offer the recipes feature's migration when it exists (ingredients are handled there). */
async function offerRecipes(from: string, to: string, root: vscode.Uri): Promise<void> {
  const cmds = await vscode.commands.getCommands(true);
  if (!cmds.includes('vscodecraft.recipes.migrate')) return;
  const yes = t('Migrate recipes');
  const pick = await vscode.window.showInformationMessage(t('Recipes have their own migration (ingredients, results…). Run it too?'), yes);
  if (pick === yes) await vscode.commands.executeCommand('vscodecraft.recipes.migrate', root, { from, to });
}

async function removeEmptyFolders(root: vscode.Uri, folders: Set<string>): Promise<void> {
  const isEmpty = async (u: vscode.Uri): Promise<boolean> => {
    let entries: [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(u);
    } catch {
      return false;
    }
    for (const [name, type] of entries) {
      if (type & vscode.FileType.Directory) {
        if (!(await isEmpty(vscode.Uri.joinPath(u, name)))) return false;
      } else return false;
    }
    return true;
  };
  // Remove the top-most legacy folder that became empty (e.g. data/ns/recipes)
  const tops = new Set<string>();
  for (const f of folders) {
    const parts = f.split('/');
    for (let i = 3; i <= parts.length; i++) tops.add(parts.slice(0, i).join('/'));
  }
  for (const f of [...tops].sort((a, b) => a.length - b.length)) {
    const u = vscode.Uri.joinPath(root, f);
    if (await isEmpty(u)) {
      try {
        await vscode.workspace.fs.delete(u, { recursive: true, useTrash: false });
      } catch {
        /* ignore */
      }
    }
  }
}
