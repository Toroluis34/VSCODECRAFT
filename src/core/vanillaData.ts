import * as vscode from 'vscode';
import * as https from 'node:https';
import * as zlib from 'node:zlib';
import { closestBundledVersion, getVersions, latestRelease, McVersion, setVersionTable } from './versions';
import type { Logger } from './logger';

const DEFAULT_BASE = 'https://raw.githubusercontent.com/misode/mcmeta';

interface BundledData {
  version: string;
  registries: Record<string, string[]>;
  lang: Record<string, string>;
  tags: { item: Record<string, { values: string[] }>; block: Record<string, { values: string[] }> };
}

export interface Atlas {
  /** sprite id (e.g. "item/diamond", "block/stone") -> [x, y, w, h] */
  sprites: Record<string, [number, number, number, number]>;
  /** Local file URI of the atlas PNG (inside global storage). */
  image: vscode.Uri;
}

/**
 * Vanilla game data for any version, downloaded on demand from the community "mcmeta" mirror
 * (generated from the official game jars) and cached in the extension's global storage.
 * Registries, item/block tags and English names are bundled for 1.21.1, 1.21.11 and 26.3 so the
 * extension works offline.
 */
export class VanillaDataService implements vscode.Disposable {
  private memo = new Map<string, Promise<unknown>>();
  private bundled = new Map<string, BundledData>();
  private failed = new Set<string>();
  private readonly storage: vscode.Uri;
  private readonly emitter = new vscode.EventEmitter<string>();
  /** Fires with a version id when new data for it finished downloading. */
  readonly onDidDownload = this.emitter.event;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly log: Logger,
  ) {
    this.storage = vscode.Uri.joinPath(context.globalStorageUri, 'mcmeta');
  }

  /** Root folder of cached downloads (add to webview localResourceRoots). */
  get storageRoot(): vscode.Uri {
    return this.storage;
  }

  private get allowDownload(): boolean {
    return vscode.workspace.getConfiguration('vscodecraft').get<boolean>('data.allowDownload', true);
  }

  private get baseUrl(): string {
    return vscode.workspace.getConfiguration('vscodecraft').get<string>('data.baseUrl', DEFAULT_BASE) || DEFAULT_BASE;
  }

  private once<T>(key: string, fn: () => Promise<T>): Promise<T> {
    let p = this.memo.get(key) as Promise<T> | undefined;
    if (!p) {
      p = fn().catch((e) => {
        this.memo.delete(key);
        throw e;
      });
      this.memo.set(key, p);
    }
    return p;
  }

  /** Bundled offline data for the closest bundled version. */
  bundledData(version: string): BundledData {
    const v = closestBundledVersion(version);
    let d = this.bundled.get(v);
    if (!d) {
      const file = vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'data', `${v}.json.gz`).fsPath;
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const buf = require('node:fs').readFileSync(file);
      d = JSON.parse(zlib.gunzipSync(buf).toString('utf8')) as BundledData;
      this.bundled.set(v, d);
    }
    return d;
  }

  /**
   * Fetch a file from the mirror (`<ref>/<path>`), cache-first. `ref` is a branch/tag such as
   * "26.3-summary", "1.21.1-data", "26.3-assets-json" or "26.3-atlas".
   */
  async fetchFile(ref: string, filePath: string): Promise<Uint8Array | undefined> {
    const cacheUri = vscode.Uri.joinPath(this.storage, ref, ...filePath.split('/'));
    try {
      return await vscode.workspace.fs.readFile(cacheUri);
    } catch {
      /* not cached */
    }
    const key = `${ref}/${filePath}`;
    if (!this.allowDownload || this.failed.has(key)) return undefined;
    return this.once(`dl:${key}`, async () => {
      const url = `${this.baseUrl}/${ref}/${filePath}`;
      try {
        const data = await download(url);
        await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(cacheUri, '..'));
        await vscode.workspace.fs.writeFile(cacheUri, data);
        this.log.info(`Downloaded ${url} (${Math.round(data.length / 1024)} KB)`);
        return data;
      } catch (e) {
        this.failed.add(key);
        this.log.warn(`Download failed ${url}: ${e}`);
        return undefined;
      }
    });
  }

  async fetchJson<T>(ref: string, filePath: string): Promise<T | undefined> {
    return this.once(`json:${ref}/${filePath}`, async () => {
      const bytes = await this.fetchFile(ref, filePath);
      if (!bytes) return undefined;
      try {
        return JSON.parse(new TextDecoder().decode(bytes)) as T;
      } catch {
        return undefined;
      }
    });
  }

  /** `${version}-summary/<path>` */
  summary<T>(version: string, filePath: string): Promise<T | undefined> {
    return this.fetchJson<T>(`${version}-summary`, filePath);
  }

  /** Raw vanilla data file, e.g. dataFile('26.3', 'data/minecraft/loot_table/blocks/stone.json'). */
  dataFile<T = any>(version: string, filePath: string): Promise<T | undefined> {
    return this.fetchJson<T>(`${version}-data`, filePath);
  }

  /** Raw vanilla asset json, e.g. assetFile('26.3', 'assets/minecraft/models/block/stone.json'). */
  assetFile<T = any>(version: string, filePath: string): Promise<T | undefined> {
    return this.fetchJson<T>(`${version}-assets-json`, filePath);
  }

  /** Raw vanilla binary asset (png/ogg...), returns cached local URI. */
  async assetBinary(version: string, filePath: string): Promise<vscode.Uri | undefined> {
    const ref = `${version}-assets`;
    const bytes = await this.fetchFile(ref, filePath);
    return bytes ? vscode.Uri.joinPath(this.storage, ref, ...filePath.split('/')) : undefined;
  }

  /** All registries ("item", "block", "tag/item", "worldgen/biome", ...) -> ids WITHOUT namespace. */
  registries(version: string): Promise<Record<string, string[]>> {
    return this.once(`registries:${version}`, async () => {
      const dl = await this.summary<Record<string, string[]>>(version, 'registries/data.min.json');
      return dl ?? this.bundledData(version).registries;
    });
  }

  /** Fully-qualified ids ("minecraft:stone") of one registry. */
  async registry(version: string, name: string): Promise<string[]> {
    const r = await this.registries(version);
    return (r[name] ?? []).map((id) => (id.includes(':') ? id : `minecraft:${id}`));
  }

  /** Vanilla tags of a registry ("item", "block", "entity_type", "worldgen/biome"...). Keys are "minecraft:<tag>". */
  tags(version: string, registry: string): Promise<Record<string, string[]>> {
    return this.once(`tags:${version}:${registry}`, async () => {
      let raw = await this.summary<Record<string, { values: (string | { id: string })[] }>>(
        version,
        `data/tag/${registry}/data.min.json`,
      );
      if (!raw && (registry === 'item' || registry === 'block')) raw = this.bundledData(version).tags[registry];
      const out: Record<string, string[]> = {};
      for (const [k, v] of Object.entries(raw ?? {})) {
        out[k.includes(':') ? k : `minecraft:${k}`] = (v.values ?? []).map((x) => (typeof x === 'string' ? x : x.id));
      }
      return out;
    });
  }

  /** Vanilla language file (default en_us). Falls back to bundled English names. */
  lang(version: string, locale = 'en_us'): Promise<Record<string, string>> {
    return this.once(`lang:${version}:${locale}`, async () => {
      const dl = await this.assetFile<Record<string, string>>(version, `assets/minecraft/lang/${locale}.json`);
      if (dl) return dl;
      if (locale !== 'en_us') return this.lang(version, 'en_us');
      return this.bundledData(version).lang;
    });
  }

  /** All vanilla recipes: "minecraft:<id>" -> recipe json. */
  recipes(version: string): Promise<Record<string, any>> {
    return this.prefixed(version, 'data/recipe/data.min.json');
  }

  /** All vanilla loot tables: "minecraft:<id>" -> json. */
  lootTables(version: string): Promise<Record<string, any>> {
    return this.prefixed(version, 'data/loot_table/data.min.json');
  }

  /** All vanilla advancements: "minecraft:<id>" -> json. */
  advancements(version: string): Promise<Record<string, any>> {
    return this.prefixed(version, 'data/advancement/data.min.json');
  }

  /** Any summarized data folder, e.g. dataFolder(v, 'enchantment') or dataFolder(v, 'worldgen/biome'). */
  dataFolder(version: string, folder: string): Promise<Record<string, any>> {
    return this.prefixed(version, `data/${folder}/data.min.json`);
  }

  /** Vanilla block/item models: "block/stone" -> json (keys without namespace, like the game's model ids). */
  async models(version: string): Promise<Record<string, any>> {
    return (await this.summary<Record<string, any>>(version, 'assets/model/data.min.json')) ?? {};
  }

  /** Item model definitions (assets/minecraft/items, 1.21.4+): "diamond" -> json. */
  async itemDefinitions(version: string): Promise<Record<string, any>> {
    return (await this.summary<Record<string, any>>(version, 'assets/item_definition/data.min.json')) ?? {};
  }

  /** Blockstate definitions: "stone" -> json. */
  async blockDefinitions(version: string): Promise<Record<string, any>> {
    return (await this.summary<Record<string, any>>(version, 'assets/block_definition/data.min.json')) ?? {};
  }

  /** Block properties summary: "minecraft:stone" -> [properties, defaults]. */
  async blocks(version: string): Promise<Record<string, any>> {
    return this.prefixed(version, 'blocks/data.min.json');
  }

  /** Default item components: "minecraft:diamond_sword" -> components. */
  async itemComponents(version: string): Promise<Record<string, any>> {
    return this.prefixed(version, 'item_components/data.min.json');
  }

  /** Texture atlas with every vanilla texture (block/item/entity...) packed into one PNG. */
  atlas(version: string): Promise<Atlas | undefined> {
    return this.once(`atlas:${version}`, async () => {
      for (const ref of [`${version}-atlas`, 'atlas']) {
        const sprites = await this.fetchJson<Record<string, [number, number, number, number]>>(ref, 'all/data.min.json');
        if (!sprites) continue;
        const png = await this.fetchFile(ref, 'all/atlas.png');
        if (!png) continue;
        return { sprites, image: vscode.Uri.joinPath(this.storage, ref, 'all', 'atlas.png') };
      }
      return undefined;
    });
  }

  /** Refresh the list of versions (and their pack formats) from the mirror; cached for a day. */
  async refreshVersionList(): Promise<McVersion[]> {
    const cache = vscode.Uri.joinPath(this.storage, 'versions.json');
    try {
      const stat = await vscode.workspace.fs.stat(cache);
      if (Date.now() - stat.mtime > 24 * 3600 * 1000) await vscode.workspace.fs.delete(cache);
    } catch {
      /* none */
    }
    let raw: any[] | undefined;
    try {
      raw = JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(cache)));
    } catch {
      if (this.allowDownload) {
        try {
          const bytes = await download(`${this.baseUrl}/summary/versions/data.min.json`);
          await vscode.workspace.fs.createDirectory(this.storage);
          await vscode.workspace.fs.writeFile(cache, bytes);
          raw = JSON.parse(new TextDecoder().decode(bytes));
        } catch (e) {
          this.log.warn(`Could not refresh version list: ${e}`);
        }
      }
    }
    if (Array.isArray(raw)) {
      const list: McVersion[] = raw
        .filter((x) => x.type === 'release' || raw!.indexOf(x) < 10)
        .filter((x) => /^(1\.2\d|2\d\.)/.test(x.id))
        .map((x) => ({
          id: x.id,
          type: x.type,
          dataPack: x.data_pack_version,
          dataPackMinor: x.data_pack_version_minor ?? 0,
          resourcePack: x.resource_pack_version,
          resourcePackMinor: x.resource_pack_version_minor ?? 0,
          dataVersion: x.data_version,
          releaseTime: String(x.release_time ?? '').slice(0, 10),
        }));
      setVersionTable(list);
    }
    return getVersions(true);
  }

  /** Make sure the most useful data for a version is cached (used by the "Download data" command). */
  async prefetch(version: string, progress?: vscode.Progress<{ message?: string; increment?: number }>): Promise<boolean> {
    const steps: [string, () => Promise<unknown>][] = [
      ['registries', () => this.summary(version, 'registries/data.min.json')],
      ['item tags', () => this.tags(version, 'item')],
      ['block tags', () => this.tags(version, 'block')],
      ['names', () => this.lang(version)],
      ['recipes', () => this.recipes(version)],
      ['models', () => this.models(version)],
      ['item definitions', () => this.itemDefinitions(version)],
      ['textures', () => this.atlas(version)],
      ['loot tables', () => this.lootTables(version)],
      ['advancements', () => this.advancements(version)],
    ];
    let ok = true;
    for (const [label, fn] of steps) {
      progress?.report({ message: label, increment: 100 / steps.length });
      try {
        if ((await fn()) === undefined) ok = false;
      } catch {
        ok = false;
      }
    }
    this.emitter.fire(version);
    return ok;
  }

  /** Delete every cached download. */
  async clearCache(): Promise<void> {
    try {
      await vscode.workspace.fs.delete(this.storage, { recursive: true });
    } catch {
      /* nothing */
    }
    this.memo.clear();
    this.failed.clear();
  }

  private prefixed(version: string, file: string): Promise<Record<string, any>> {
    return this.once(`prefixed:${version}:${file}`, async () => {
      const raw = await this.summary<Record<string, any>>(version, file);
      const out: Record<string, any> = {};
      for (const [k, v] of Object.entries(raw ?? {})) out[k.includes(':') ? k : `minecraft:${k}`] = v;
      return out;
    });
  }

  /** Latest release known to the extension. */
  latest(): string {
    return latestRelease();
  }

  dispose(): void {
    this.emitter.dispose();
  }
}

function download(url: string, redirects = 5): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'vscodecraft-extension' }, timeout: 30000 }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume();
        download(new URL(res.headers.location, url).toString(), redirects - 1).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve(new Uint8Array(Buffer.concat(chunks))));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}
