import * as vscode from 'vscode';
import type { Core } from '../../core/core';
import { parseRL } from '../../core/resourceLocation';
import { readText } from '../../core/fsUtils';
import { atLeast } from '../../core/versions';
import { fileKindOf, isStaticRegistry, lookupRegistry, STATIC_VALUES, type ParsedRef, type RefContext } from './context';
import { closestMatches } from './fuzzy';
import { vanillaUri } from './vanillaDocs';

export interface RefEntry {
  /** Fully-qualified id (tags without "#"). */
  id: string;
  name?: string;
  source: 'vanilla' | 'workspace';
}

export interface IdSets {
  vanilla: Set<string>;
  workspace: Set<string>;
}

/** Namespaces that are shared by loaders / conventions: other projects define their content. */
const SHARED_NAMESPACES = new Set(['minecraft', 'c', 'neoforge', 'forge', 'fabric', 'fabric-api', 'quilt', 'realms']);

/** Registries whose workspace ids we can know reliably enough to warn about unknown ids in mod namespaces. */
const WS_VALIDATED = new Set(['item', 'block', 'sound_event', 'entity_type']);

const ALIASES: Record<string, string[]> = {
  'worldgen/configured_feature': ['worldgen/configured_feature', 'worldgen/feature'],
  'worldgen/configured_carver': ['worldgen/configured_carver', 'worldgen/carver'],
  // 26.x item sub-predicates also accept plain component types
  data_component_predicate_type: ['data_component_predicate_type', 'data_component_type'],
};

export type CheckResult = 'ok' | 'unknown' | 'skip';

/**
 * Registry-aware lookups for the language feature with per-version caches
 * (vanilla sets are immutable per version; workspace sets are dropped when the index changes).
 */
export class RefResolver implements vscode.Disposable {
  private vanillaSets = new Map<string, Promise<Set<string>>>();
  private wsSets = new Map<string, Promise<Set<string>>>();
  private ownedNs: Set<string> | undefined;
  private readonly emitter = new vscode.EventEmitter<boolean>();
  /**
   * Fires (debounced) when cached registry data was invalidated. The payload is true for structural changes
   * (files added/removed, version or vanilla data changed) and false for content edits (lang, sounds.json).
   */
  readonly onDidChange = this.emitter.event;
  private readonly disposables: vscode.Disposable[] = [];
  private timer: NodeJS.Timeout | undefined;
  private pendingFull = false;

  constructor(private readonly core: Core) {
    const clearWs = (full = true) => {
      this.wsSets.clear();
      this.ownedNs = undefined;
      this.fire(full);
    };
    this.disposables.push(
      core.index.onDidChange(() => clearWs(true)),
      core.index.onDidChangeContent((u) => {
        if (/\/lang\/[^/]+\.json$|\/sounds\.json$/.test(u.path)) clearWs(false);
      }),
      core.projects.onDidChange(() => {
        this.ownedNs = undefined;
        this.fire(true);
      }),
      core.vanilla.onDidDownload(() => {
        this.vanillaSets.clear();
        this.fire(true);
      }),
      vscode.workspace.onDidSaveTextDocument((d) => {
        // core re-scans Java from its own file watcher; give it a moment first
        if (/\.(java|kt)$/.test(d.uri.path)) setTimeout(() => clearWs(true), 1000);
      }),
    );
  }

  private fire(full: boolean): void {
    this.pendingFull ||= full;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      const f = this.pendingFull;
      this.pendingFull = false;
      this.emitter.fire(f);
    }, 500);
  }

  version(uri?: vscode.Uri): string {
    return this.core.version(uri);
  }

  /** Vanilla ids (fully-qualified) of a registry for a version. Tag registries are "tag/<registry>". */
  vanillaIds(version: string, registry: string): Promise<Set<string>> {
    const key = `${version}|${registry}`;
    let p = this.vanillaSets.get(key);
    if (!p) {
      p = (async () => {
        if (isStaticRegistry(registry)) return new Set(STATIC_VALUES[registry].map((v) => `minecraft:${v}`));
        const names = registry === 'sound_file' ? ['sound'] : (ALIASES[registry] ?? [registry]);
        const out = new Set<string>();
        for (const n of names) {
          try {
            for (const id of await this.core.vanilla.registry(version, n)) out.add(id);
          } catch {
            /* registry not available */
          }
        }
        return out;
      })();
      this.vanillaSets.set(key, p);
    }
    return p;
  }

  /** Workspace ids of a registry (files, lang-derived ids, sounds.json events, Java scan). */
  workspaceIds(registry: string): Promise<Set<string>> {
    let p = this.wsSets.get(registry);
    if (!p) {
      p = (async () => {
        await this.core.index.ready;
        if (isStaticRegistry(registry)) return new Set<string>();
        if (registry === 'sound_file') {
          return new Set(this.core.index.all('sounds').filter((r) => r.ext === 'ogg').map((r) => r.id));
        }
        if (registry === 'texture') {
          return new Set(this.core.index.all('textures').filter((r) => r.ext === 'png').map((r) => r.id));
        }
        const names = ALIASES[registry] ?? [registry];
        const out = new Set<string>();
        for (const n of names) {
          try {
            for (const id of await this.core.registries.workspaceIds(n)) out.add(id);
          } catch {
            /* ignore */
          }
        }
        if (registry.startsWith('tag/')) {
          for (const n of ALIASES[registry.slice(4)] ?? []) for (const id of this.core.index.ids(`tags/${n}`)) out.add(id);
        }
        return out;
      })();
      this.wsSets.set(registry, p);
    }
    return p;
  }

  /** Id sets for a context (prefix applied: ids are returned relative to the prefix). */
  async idSets(ctx: RefContext, isTag: boolean, uri?: vscode.Uri): Promise<IdSets> {
    const reg = lookupRegistry(ctx, isTag);
    const [vanilla, workspace] = await Promise.all([this.vanillaIds(this.version(uri), reg), this.workspaceIds(reg)]);
    if (!ctx.prefix || isTag) return { vanilla, workspace };
    return { vanilla: stripPrefix(vanilla, ctx.prefix), workspace: stripPrefix(workspace, ctx.prefix) };
  }

  /** Completion entries (vanilla + workspace) with display names. */
  async entries(ctx: RefContext, isTag: boolean, uri?: vscode.Uri): Promise<RefEntry[]> {
    const { vanilla, workspace } = await this.idSets(ctx, isTag, uri);
    const names = isTag ? new Map<string, string>() : await this.core.registries.names(uri).catch(() => new Map<string, string>());
    const named = NAMED_REGISTRIES.has(ctx.registry);
    const out: RefEntry[] = [];
    for (const id of workspace) out.push({ id, name: named ? names.get(id) : undefined, source: 'workspace' });
    for (const id of vanilla) if (!workspace.has(id)) out.push({ id, name: named ? names.get(id) : undefined, source: 'vanilla' });
    return out;
  }

  /** Namespaces owned by the workspace's projects (mod ids + their namespaces, minus shared ones). */
  ownedNamespaces(): Set<string> {
    if (!this.ownedNs) {
      const s = new Set<string>();
      for (const p of this.core.projects.projects) {
        for (const id of p.modIds) s.add(id);
        for (const n of p.namespaces) s.add(n);
      }
      for (const n of SHARED_NAMESPACES) s.delete(n);
      this.ownedNs = s;
    }
    return this.ownedNs;
  }

  private strict(uri?: vscode.Uri): boolean {
    return vscode.workspace.getConfiguration('vscodecraft.language', uri).get<boolean>('strictUnknownNamespaces', false);
  }

  /**
   * Whether an id exists. 'skip' when we cannot know (no vanilla data, foreign namespace, ids that may be
   * registered in code we cannot see).
   */
  async check(ctx: RefContext, ref: ParsedRef, uri?: vscode.Uri): Promise<CheckResult> {
    if (isStaticRegistry(ctx.registry) || ctx.optional) return 'skip';
    const { namespace } = parseRL(ref.id);
    const sets = await this.idSets(ctx, ref.isTag, uri);
    if (sets.workspace.has(ref.id) || sets.vanilla.has(ref.id)) return 'ok';
    if (ctx.registry === 'model' && /^minecraft:builtin\//.test(ref.id)) return 'ok';
    if (ctx.registry === 'texture' && !ref.isTag) {
      if (ref.id === 'minecraft:missingno') return 'ok';
      const full = ctx.prefix ? `${namespace}:${ctx.prefix}${parseRL(ref.id).path}` : ref.id;
      if ((await this.atlasSprites(this.version(uri))).has(full)) return 'ok';
      // Offline fallback: vanilla trim sprites are generated by the armor_trims atlas.
      if (/^minecraft:trims\/(items|entity)\//.test(full)) return 'ok';
    }
    if (namespace === 'minecraft') return sets.vanilla.size ? 'unknown' : 'skip';
    if (this.strict(uri)) return 'unknown';
    const fileBacked = !!fileKindOf(ctx.registry, ref.isTag);
    if (!fileBacked && !WS_VALIDATED.has(ctx.registry)) return 'skip';
    // Only warn for namespaces the workspace owns, or that already define ids of this registry here.
    if (this.ownedNamespaces().has(namespace)) return 'unknown';
    for (const id of sets.workspace) if (id.startsWith(`${namespace}:`)) return 'unknown';
    return 'skip';
  }

  /**
   * Sprites generated by "paletted_permutations" atlas sources (armor trims ...), from vanilla and workspace
   * atlases. They have no PNG file of their own.
   */
  atlasSprites(version: string): Promise<Set<string>> {
    const key = `${version}|@atlas-sprites`;
    let p = this.wsSets.get(key);
    if (!p) {
      p = (async () => {
        const out = new Set<string>();
        const add = (atlas: any) => {
          for (const src of Array.isArray(atlas?.sources) ? atlas.sources : []) {
            if (!/paletted_permutations$/.test(String(src?.type ?? ''))) continue;
            const sep = typeof src.separator === 'string' ? src.separator : '_';
            for (const tex of Array.isArray(src.textures) ? src.textures : []) {
              for (const perm of Object.keys(src.permutations ?? {})) {
                const t = String(tex);
                out.add(`${t.includes(':') ? t : `minecraft:${t}`}${sep}${perm}`);
              }
            }
          }
        };
        for (const r of this.core.index.all('atlases')) add(await this.core.index.json(r.uri));
        for (const id of await this.vanillaIds(version, 'atlas')) {
          add(await this.core.vanilla.assetFile(version, `assets/minecraft/atlases/${parseRL(id).path}.json`).catch(() => undefined));
        }
        return out;
      })();
      this.wsSets.set(key, p);
    }
    return p;
  }

  /** Up to `limit` close matches for an unknown id. */
  async suggestions(ctx: RefContext, ref: ParsedRef, uri?: vscode.Uri, limit = 3): Promise<string[]> {
    const sets = await this.idSets(ctx, ref.isTag, uri);
    return closestMatches(ref.id, concat(sets.workspace, sets.vanilla), limit);
  }

  /**
   * Files that define an id: workspace files first, then a read-only vanilla document (or the cached vanilla
   * PNG/OGG for textures and sounds when `download` is true).
   */
  async locate(ctx: RefContext, ref: ParsedRef, uri?: vscode.Uri, download = true): Promise<vscode.Location[]> {
    const version = this.version(uri);
    const rl = parseRL(ref.id);
    const out: vscode.Location[] = [];
    const at = (u: vscode.Uri, line = 0, ch = 0) => out.push(new vscode.Location(u, new vscode.Position(line, ch)));
    const fk = fileKindOf(ctx.registry, ref.isTag);
    if (fk) {
      const path = (ref.isTag ? '' : (ctx.prefix ?? '')) + rl.path;
      const id = `${rl.namespace}:${path}`;
      for (const r of this.core.index.get(fk.kind, id)) if (r.ext === fk.ext) at(r.uri);
      if (out.length || rl.namespace !== 'minecraft') return out;
      const vanillaSet = await this.vanillaIds(version, lookupRegistry(ctx, ref.isTag));
      if (!vanillaSet.has(`minecraft:${path}`)) return out;
      const file = `${fk.side}/minecraft/${fk.kind}/${path}.${fk.ext}`;
      if (fk.ext === 'png' || fk.ext === 'ogg') {
        if (!download) return out;
        const local = await this.core.vanilla.assetBinary(version, file);
        if (local) at(local);
        return out;
      }
      if (fk.ext === 'json') at(vanillaUri(version, file));
      return out;
    }
    switch (ctx.registry) {
      case 'item':
      case 'block': {
        const kinds = ctx.registry === 'item' ? ['items', 'blockstates'] : ['blockstates', 'items'];
        for (const k of kinds) for (const r of this.core.index.get(k, ref.id)) at(r.uri);
        for (const r of this.core.index.get('models', `${rl.namespace}:${ctx.registry}/${rl.path}`)) at(r.uri);
        const lang = await this.langLocation(ref.id, ctx.registry === 'item' ? ['item', 'block'] : ['block']);
        if (lang) out.push(lang);
        if (!out.length && rl.namespace === 'minecraft') {
          if (ctx.registry === 'block') at(vanillaUri(version, `assets/minecraft/blockstates/${rl.path}.json`));
          else if (atLeast(version, '1.21.4')) at(vanillaUri(version, `assets/minecraft/items/${rl.path}.json`));
          else at(vanillaUri(version, `assets/minecraft/models/item/${rl.path}.json`));
        }
        return out;
      }
      case 'sound_event': {
        for (const r of this.core.index.get('sounds', `${rl.namespace}:sounds`)) {
          const loc = await this.keyLocation(r.uri, rl.path);
          if (loc) out.push(loc);
        }
        if (!out.length && rl.namespace === 'minecraft') at(vanillaUri(version, 'assets/minecraft/sounds.json'));
        return out;
      }
      case 'entity_type':
      case 'mob_effect': {
        const lang = await this.langLocation(ref.id, [ctx.registry === 'entity_type' ? 'entity' : 'effect']);
        if (lang) out.push(lang);
        return out;
      }
    }
    return out;
  }

  /** Location of "<prefix>.<ns>.<path>" in the workspace en_us lang file of the namespace. */
  async langLocation(id: string, prefixes: string[]): Promise<vscode.Location | undefined> {
    const rl = parseRL(id);
    for (const r of this.core.index.get('lang', `${rl.namespace}:en_us`)) {
      for (const p of prefixes) {
        const loc = await this.keyLocation(r.uri, `${p}.${rl.namespace}.${rl.path}`);
        if (loc) return loc;
      }
    }
    return undefined;
  }

  /** Location of a top-level JSON key in a file (text search). */
  async keyLocation(uri: vscode.Uri, key: string): Promise<vscode.Location | undefined> {
    const text = await readText(uri);
    if (text === undefined) return undefined;
    const i = text.indexOf(JSON.stringify(key));
    if (i < 0) return undefined;
    const start = positionAt(text, i + 1);
    return new vscode.Location(uri, new vscode.Range(start, start.translate(0, key.length)));
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.disposables.forEach((d) => d.dispose());
    this.emitter.dispose();
  }
}

/** Registries whose ids have lang display names. */
const NAMED_REGISTRIES = new Set(['item', 'block', 'entity_type', 'enchantment', 'mob_effect', 'worldgen/biome']);

function stripPrefix(set: Set<string>, prefix: string): Set<string> {
  const out = new Set<string>();
  for (const id of set) {
    const i = id.indexOf(':');
    const path = id.slice(i + 1);
    if (path.startsWith(prefix)) out.add(`${id.slice(0, i)}:${path.slice(prefix.length)}`);
  }
  return out;
}

function* concat<T>(...sets: Iterable<T>[]): Iterable<T> {
  for (const s of sets) yield* s;
}

/** Position of an offset in a text (for files that are not open). */
export function positionAt(text: string, offset: number): vscode.Position {
  let line = 0;
  let lineStart = 0;
  for (let i = text.indexOf('\n'); i >= 0 && i < offset; i = text.indexOf('\n', i + 1)) {
    line++;
    lineStart = i + 1;
  }
  return new vscode.Position(line, offset - lineStart);
}
