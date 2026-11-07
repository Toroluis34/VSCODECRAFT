import * as vscode from 'vscode';
import * as path from 'node:path';
import {
  Loader,
  mcVersionFromGradleProps,
  modIdFromGradleProps,
  parseFabricModJson,
  parseGradleProperties,
  parseModsToml,
  parsePackMcmeta,
} from './projectDetect';
import { readText, exists } from './fsUtils';
import { getVersions, latestRelease } from './versions';
import { EXCLUDE_GLOB, WorkspaceIndex } from './workspaceIndex';
import type { Logger } from './logger';

export interface McProject {
  /** Module root (folder with build.gradle) or pack root (folder with pack.mcmeta). */
  root: vscode.Uri;
  name: string;
  loader: Loader;
  /** Minecraft version detected from project files (undefined if unknown). */
  detectedVersion?: string;
  modIds: string[];
  /** Namespaces found under data/ and assets/ in this project's resource roots (excluding minecraft/c). */
  namespaces: string[];
  /** Folders containing data/ and/or assets/ (src/main/resources, src/generated/resources, pack root...). */
  resourceRoots: vscode.Uri[];
  /** Where new resource files should be created. */
  mainResourceRoot: vscode.Uri;
  /** src/main/java, src/main/kotlin, ... */
  sourceRoots: vscode.Uri[];
  /** Main class / entrypoint (fabric.mod.json "main" entrypoint) if known. */
  entrypoint?: string;
  /** Marker files that identified the project. */
  markers: vscode.Uri[];
}

const MARKER_GLOB = '**/{fabric.mod.json,quilt.mod.json,neoforge.mods.toml,mods.toml,pack.mcmeta,gradle.properties,build.gradle,build.gradle.kts,plugin.yml,paper-plugin.yml}';
const SHARED_NAMESPACES = new Set(['minecraft', 'c', 'neoforge', 'forge', 'fabric', 'fabric-api', 'realms']);

export class ProjectService implements vscode.Disposable {
  private list: McProject[] = [];
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;
  ready: Promise<void>;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly index: WorkspaceIndex,
    private readonly log: Logger,
  ) {
    this.ready = this.refresh();
    const watcher = vscode.workspace.createFileSystemWatcher(MARKER_GLOB);
    const re = () => (this.ready = this.refresh());
    this.disposables.push(
      watcher,
      watcher.onDidChange(re),
      watcher.onDidCreate(re),
      watcher.onDidDelete(re),
      index.onDidChange(re),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('vscodecraft')) this.emitter.fire();
      }),
    );
  }

  get projects(): readonly McProject[] {
    return this.list;
  }

  async refresh(): Promise<void> {
    await this.index.ready;
    const markers = await vscode.workspace.findFiles(MARKER_GLOB, EXCLUDE_GLOB, 2000);
    const modules = new Map<string, McProject>();
    const gradleProps = new Map<string, Record<string, string>>();
    const ensure = (root: string, loader: Loader): McProject => {
      let p = modules.get(root);
      if (!p) {
        const uri = vscode.Uri.file(root);
        p = {
          root: uri,
          name: path.basename(root),
          loader,
          modIds: [],
          namespaces: [],
          resourceRoots: [],
          mainResourceRoot: uri,
          sourceRoots: [],
          markers: [],
        };
        modules.set(root, p);
      } else if (p.loader === 'unknown' || (p.loader === 'datapack' && loader !== 'unknown')) {
        p.loader = loader;
      }
      return p;
    };

    for (const uri of markers) {
      const file = path.basename(uri.fsPath);
      const text = (await readText(uri)) ?? '';
      try {
        if (file === 'gradle.properties') {
          gradleProps.set(path.dirname(uri.fsPath), parseGradleProperties(text));
          continue;
        }
        if (file === 'build.gradle' || file === 'build.gradle.kts') {
          const root = path.dirname(uri.fsPath);
          const loader: Loader = /net\.neoforged|neoforge/i.test(text)
            ? 'neoforge'
            : /fabric-loom|net\.fabricmc/i.test(text)
              ? 'fabric'
              : /net\.minecraftforge|forgegradle/i.test(text)
                ? 'forge'
                : /quilt-loom|org\.quiltmc/i.test(text)
                  ? 'quilt'
                  : /paperweight|io\.papermc|paper-api/i.test(text)
                    ? 'paper'
                    : 'unknown';
          // Only consider gradle modules that contain sources/resources
          if ((await exists(vscode.Uri.file(path.join(root, 'src')))) || loader !== 'unknown') {
            const p = ensure(root, loader);
            p.markers.push(uri);
          }
          continue;
        }
        const moduleRoot = moduleRootOf(uri.fsPath);
        if (file === 'fabric.mod.json' || file === 'quilt.mod.json') {
          const meta = parseFabricModJson(text);
          const p = ensure(moduleRoot, meta.loader);
          p.loader = meta.loader;
          p.modIds.push(...meta.modIds);
          p.detectedVersion ??= meta.mcVersion;
          try {
            const j = JSON.parse(text);
            const main = j.entrypoints?.main?.[0];
            p.entrypoint = typeof main === 'string' ? main : main?.value;
          } catch {
            /* ignore */
          }
          p.markers.push(uri);
        } else if (file === 'neoforge.mods.toml' || file === 'mods.toml') {
          const loader = file === 'neoforge.mods.toml' ? 'neoforge' : 'forge';
          const meta = parseModsToml(text, loader);
          const p = ensure(moduleRoot, loader);
          if (p.loader !== 'neoforge') p.loader = loader;
          p.modIds.push(...meta.modIds);
          p.detectedVersion ??= meta.mcVersion;
          p.markers.push(uri);
        } else if (file === 'plugin.yml' || file === 'paper-plugin.yml') {
          ensure(moduleRoot, 'paper').markers.push(uri);
        } else if (file === 'pack.mcmeta') {
          const packDir = path.dirname(uri.fsPath);
          const inSrc = /[\\/]src[\\/][^\\/]+[\\/]resources$/.test(packDir);
          const root = inSrc ? moduleRoot : packDir;
          const hasData = await exists(vscode.Uri.file(path.join(packDir, 'data')));
          const hasAssets = await exists(vscode.Uri.file(path.join(packDir, 'assets')));
          const p = ensure(root, inSrc ? 'unknown' : hasData || !hasAssets ? 'datapack' : 'resourcepack');
          if (!inSrc && !p.detectedVersion) {
            const fmt = parsePackMcmeta(text);
            if (fmt.maxFormat) p.detectedVersion = versionForPackFormat(fmt.maxFormat, hasData || !hasAssets);
          }
          p.markers.push(uri);
        }
      } catch (e) {
        this.log.warn(`Failed to read ${uri.fsPath}: ${e}`);
      }
    }

    // Assign resource roots to the deepest module containing them; create pseudo-projects otherwise.
    const roots = this.index.roots();
    for (const r of roots) {
      const owner = [...modules.keys()]
        .filter((m) => r === m || r.startsWith(m + path.sep) || r.startsWith(m + '/'))
        .sort((a, b) => b.length - a.length)[0];
      const p = owner ? modules.get(owner)! : ensure(moduleRootOf(path.join(r, 'x')), 'unknown');
      p.resourceRoots.push(vscode.Uri.file(r));
    }

    // Drop gradle root projects without resources and without loader when sub-modules exist (multi-module builds)
    for (const [root, p] of [...modules]) {
      const hasChildren = [...modules.keys()].some((k) => k !== root && k.startsWith(root + path.sep));
      if (hasChildren && p.resourceRoots.length === 0 && p.modIds.length === 0) {
        // keep the loader hint for children
        for (const [k, child] of modules) {
          if (k !== root && k.startsWith(root + path.sep) && child.loader === 'unknown') child.loader = p.loader;
        }
        modules.delete(root);
      }
    }

    for (const p of modules.values()) {
      // Inherit gradle.properties from the module or any ancestor (multi-module builds)
      let dir = p.root.fsPath;
      for (let i = 0; i < 4; i++) {
        const props = gradleProps.get(dir);
        if (props) {
          const v = mcVersionFromGradleProps(props);
          if (v) p.detectedVersion = v; // gradle properties are the most reliable source
          const id = modIdFromGradleProps(props);
          if (id && !p.modIds.includes(id)) p.modIds.push(id);
          break;
        }
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }
      p.modIds = [...new Set(p.modIds)];
      // Namespaces actually used inside this project's roots
      const rootSet = new Set(p.resourceRoots.map((u) => u.fsPath.replace(/\\/g, '/')));
      const used = new Set<string>();
      for (const kind of this.index.kinds()) {
        for (const r of this.index.all(kind)) if (rootSet.has(r.root)) used.add(r.namespace);
      }
      p.namespaces = [...used].filter((n) => !SHARED_NAMESPACES.has(n)).sort();
      const main =
        p.resourceRoots.find((u) => /[\\/]src[\\/]main[\\/]resources$/.test(u.fsPath)) ??
        p.resourceRoots.find((u) => !/generated/.test(u.fsPath)) ??
        p.resourceRoots[0];
      p.mainResourceRoot =
        main ??
        ((await exists(vscode.Uri.joinPath(p.root, 'src', 'main', 'resources'))) || p.loader !== 'datapack'
          ? p.loader === 'datapack' || p.loader === 'resourcepack'
            ? p.root
            : vscode.Uri.joinPath(p.root, 'src', 'main', 'resources')
          : p.root);
      for (const s of ['java', 'kotlin']) {
        const u = vscode.Uri.joinPath(p.root, 'src', 'main', s);
        if (await exists(u)) p.sourceRoots.push(u);
      }
    }

    this.list = [...modules.values()]
      .filter((p) => p.resourceRoots.length || p.modIds.length || p.loader !== 'unknown')
      .sort((a, b) => a.root.fsPath.localeCompare(b.root.fsPath));
    this.log.info(
      `Projects: ${this.list.map((p) => `${p.name} [${p.loader}${p.detectedVersion ? ' ' + p.detectedVersion : ''}] ids=${p.modIds.join(',')}`).join('; ') || 'none'}`,
    );
    this.emitter.fire();
  }

  /** Project owning a file (deepest root), or the active editor's project, or the first project. */
  projectFor(uri?: vscode.Uri): McProject | undefined {
    const target = uri ?? vscode.window.activeTextEditor?.document.uri;
    if (target) {
      const f = target.fsPath;
      const match = this.list
        .filter((p) => f === p.root.fsPath || f.startsWith(p.root.fsPath + path.sep) || p.resourceRoots.some((r) => f.startsWith(r.fsPath + path.sep)))
        .sort((a, b) => b.root.fsPath.length - a.root.fsPath.length)[0];
      if (match) return match;
    }
    return this.list[0];
  }

  /**
   * Minecraft version tools should target for a file.
   * Order: setting "vscodecraft.minecraftVersion" (unless "auto") → detected from project → latest release.
   */
  targetVersion(uri?: vscode.Uri): string {
    const setting = vscode.workspace.getConfiguration('vscodecraft', uri).get<string>('minecraftVersion', 'auto');
    if (setting && setting !== 'auto') return setting;
    return this.projectFor(uri)?.detectedVersion ?? latestRelease();
  }

  /** Namespace for new resources: setting → mod id → first project namespace → "minecraft". */
  defaultNamespace(uri?: vscode.Uri): string {
    const setting = vscode.workspace.getConfiguration('vscodecraft', uri).get<string>('defaultNamespace', '');
    if (setting) return setting;
    const p = this.projectFor(uri);
    return p?.modIds[0] ?? p?.namespaces[0] ?? this.index.namespaces().find((n) => !SHARED_NAMESPACES.has(n)) ?? 'minecraft';
  }

  /** Resource root (folder containing data/ & assets/) to create new files in. */
  resourceRoot(uri?: vscode.Uri): vscode.Uri | undefined {
    const p = this.projectFor(uri);
    if (p) return p.mainResourceRoot;
    return vscode.workspace.workspaceFolders?.[0]?.uri;
  }

  /** Let the user choose a project when there are several. */
  async pickProject(placeHolder?: string): Promise<McProject | undefined> {
    if (this.list.length <= 1) return this.list[0];
    const pick = await vscode.window.showQuickPick(
      this.list.map((p) => ({
        label: p.name,
        description: `${p.loader}${p.detectedVersion ? ' · ' + p.detectedVersion : ''}`,
        detail: vscode.workspace.asRelativePath(p.root),
        p,
      })),
      { placeHolder: placeHolder ?? vscode.l10n.t('Select a project') },
    );
    return pick?.p;
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
    this.emitter.dispose();
  }
}

/** ".../mymod/src/main/resources/fabric.mod.json" -> ".../mymod"; otherwise the file's folder. */
function moduleRootOf(file: string): string {
  const norm = file.replace(/\\/g, '/');
  const i = norm.lastIndexOf('/src/');
  if (i >= 0) return file.slice(0, i);
  return path.dirname(file);
}

function versionForPackFormat(format: number, data: boolean): string | undefined {
  const releases = getVersions(false);
  const match = releases.find((v) => (data ? v.dataPack : v.resourcePack) === format);
  if (match) return match.id;
  // Closest lower format
  const lower = releases.find((v) => (data ? v.dataPack : v.resourcePack) <= format);
  return lower?.id;
}
