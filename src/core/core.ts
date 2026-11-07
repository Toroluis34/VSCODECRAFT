import * as vscode from 'vscode';
import { Logger } from './logger';
import { WorkspaceIndex } from './workspaceIndex';
import { ProjectService } from './projects';
import { VanillaDataService } from './vanillaData';
import { RegistryService } from './registries';
import { IconService } from './icons';
import { WebviewService } from './webviews';
import { getFeatures, VersionFeatures } from './versions';

/**
 * Shared services handed to every feature's activate(core).
 *
 *  core.index       – every data/asset file in the workspace by kind & id
 *  core.projects    – detected mod projects / packs, target MC version, default namespace
 *  core.vanilla     – vanilla data (registries, tags, recipes, models, atlas, lang) per version
 *  core.registries  – merged vanilla + workspace ids, display names, tag expansion, search
 *  core.icons       – resolve item icons / textures for webviews
 *  core.webviews    – create webview panels with RPC + common handlers
 */
export class Core implements vscode.Disposable {
  readonly log: Logger;
  readonly index: WorkspaceIndex;
  readonly projects: ProjectService;
  readonly vanilla: VanillaDataService;
  readonly registries: RegistryService;
  readonly icons: IconService;
  readonly webviews: WebviewService;

  constructor(readonly context: vscode.ExtensionContext) {
    this.log = new Logger();
    this.index = new WorkspaceIndex(this.log);
    this.projects = new ProjectService(this.index, this.log);
    this.vanilla = new VanillaDataService(context, this.log);
    this.registries = new RegistryService(this.vanilla, this.index, this.projects, this.log);
    this.icons = new IconService(this.index, this.vanilla, this.projects, this.registries, this.log);
    this.webviews = new WebviewService(this);
    context.subscriptions.push(this.log, this.index, this.projects, this.vanilla, this.registries, this.icons);
  }

  /** Target Minecraft version for a file (or the active editor). */
  version(uri?: vscode.Uri): string {
    return this.projects.targetVersion(uri);
  }

  /** Format/feature flags for the target version of a file. */
  features(uri?: vscode.Uri): VersionFeatures {
    return getFeatures(this.version(uri));
  }

  /** Register a command and dispose it with the extension. Errors are logged and shown. */
  registerCommand(id: string, fn: (...args: any[]) => unknown): void {
    this.context.subscriptions.push(
      vscode.commands.registerCommand(id, async (...args: any[]) => {
        try {
          return await fn(...args);
        } catch (e) {
          this.log.error(e instanceof Error ? e : String(e));
          void vscode.window.showErrorMessage(`VSCodeCraft: ${e instanceof Error ? e.message : String(e)}`);
        }
      }),
    );
  }

  /** Add disposables to the extension lifetime. */
  track(...d: vscode.Disposable[]): void {
    this.context.subscriptions.push(...d);
  }

  dispose(): void {
    /* services are disposed through context.subscriptions */
  }
}
