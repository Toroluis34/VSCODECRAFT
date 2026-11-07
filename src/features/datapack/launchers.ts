// Detection of Minecraft installations / launcher instances. Pure module (node:fs only, no 'vscode') — unit tested.
import * as fs from 'node:fs';
import * as path from 'node:path';

export type LauncherKind = 'vanilla' | 'prism' | 'multimc' | 'curseforge' | 'modrinth' | 'atlauncher' | 'gdlauncher' | 'custom';

export interface LauncherLocation {
  launcher: LauncherKind;
  /** 'game': a game directory (contains saves/, resourcepacks/); 'instances': a folder of instances. */
  type: 'game' | 'instances';
  path: string;
}

export interface GameInstance {
  launcher: LauncherKind;
  /** Display name (instance name, or ".minecraft"). */
  name: string;
  /** Game directory: contains saves/ and resourcepacks/. */
  gameDir: string;
}

export interface PlatformEnv {
  platform: NodeJS.Platform;
  home: string;
  /** Environment variables (APPDATA, LOCALAPPDATA, XDG_DATA_HOME...). */
  env: Record<string, string | undefined>;
}

/** Every location where launchers usually keep games / instances, for a platform. Not checked for existence. */
export function candidateLocations(p: PlatformEnv): LauncherLocation[] {
  const j = (...s: string[]) => (p.platform === 'win32' ? path.win32.join(...s) : path.posix.join(...s));
  const out: LauncherLocation[] = [];
  const add = (launcher: LauncherKind, type: 'game' | 'instances', dir: string | undefined) => {
    if (dir) out.push({ launcher, type, path: dir });
  };
  if (p.platform === 'win32') {
    const appdata = p.env.APPDATA ?? j(p.home, 'AppData', 'Roaming');
    add('vanilla', 'game', j(appdata, '.minecraft'));
    add('prism', 'instances', j(appdata, 'PrismLauncher', 'instances'));
    add('multimc', 'instances', j(p.home, 'MultiMC', 'instances'));
    add('curseforge', 'instances', j(p.home, 'curseforge', 'minecraft', 'Instances'));
    add('modrinth', 'instances', j(appdata, 'ModrinthApp', 'profiles'));
    add('modrinth', 'instances', j(appdata, 'com.modrinth.theseus', 'profiles'));
    add('atlauncher', 'instances', j(appdata, 'ATLauncher', 'instances'));
    add('gdlauncher', 'instances', j(appdata, 'gdlauncher_carbon', 'data', 'instances'));
  } else if (p.platform === 'darwin') {
    const support = j(p.home, 'Library', 'Application Support');
    add('vanilla', 'game', j(support, 'minecraft'));
    add('prism', 'instances', j(support, 'PrismLauncher', 'instances'));
    add('multimc', 'instances', j(p.home, 'Applications', 'MultiMC.app', 'Data', 'instances'));
    add('curseforge', 'instances', j(p.home, 'Documents', 'curseforge', 'minecraft', 'Instances'));
    add('modrinth', 'instances', j(support, 'ModrinthApp', 'profiles'));
    add('modrinth', 'instances', j(support, 'com.modrinth.theseus', 'profiles'));
    add('atlauncher', 'instances', j(support, 'ATLauncher', 'instances'));
    add('gdlauncher', 'instances', j(support, 'gdlauncher_carbon', 'data', 'instances'));
  } else {
    const data = p.env.XDG_DATA_HOME || j(p.home, '.local', 'share');
    add('vanilla', 'game', j(p.home, '.minecraft'));
    add('vanilla', 'game', j(p.home, '.var', 'app', 'com.mojang.Minecraft', '.minecraft'));
    add('prism', 'instances', j(data, 'PrismLauncher', 'instances'));
    add('prism', 'instances', j(p.home, '.var', 'app', 'org.prismlauncher.PrismLauncher', 'data', 'PrismLauncher', 'instances'));
    add('multimc', 'instances', j(data, 'multimc', 'instances'));
    add('multimc', 'instances', j(p.home, '.local', 'share', 'MultiMC', 'instances'));
    add('modrinth', 'instances', j(data, 'ModrinthApp', 'profiles'));
    add('modrinth', 'instances', j(data, 'com.modrinth.theseus', 'profiles'));
    add('atlauncher', 'instances', j(data, 'ATLauncher', 'instances'));
    add('gdlauncher', 'instances', j(data, 'gdlauncher_carbon', 'data', 'instances'));
  }
  return out;
}

const isDir = (p: string): boolean => {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
};

/** Game directory of an instance folder: Prism/MultiMC use ".minecraft" or "minecraft" inside; others the folder itself. */
export function instanceGameDir(instanceDir: string, launcher: LauncherKind): string {
  if (launcher === 'prism' || launcher === 'multimc') {
    for (const sub of ['.minecraft', 'minecraft']) if (isDir(path.join(instanceDir, sub))) return path.join(instanceDir, sub);
    return path.join(instanceDir, '.minecraft');
  }
  if (launcher === 'gdlauncher' && isDir(path.join(instanceDir, 'instance'))) return path.join(instanceDir, 'instance');
  return instanceDir;
}

/** Display name of an instance: instance.cfg "name=" (Prism/MultiMC), else folder name. */
function instanceName(instanceDir: string, launcher: LauncherKind): string {
  if (launcher === 'prism' || launcher === 'multimc') {
    try {
      const cfg = fs.readFileSync(path.join(instanceDir, 'instance.cfg'), 'utf8');
      const m = /^name=(.+)$/m.exec(cfg);
      if (m) return m[1].trim();
    } catch {
      /* none */
    }
  }
  return path.basename(instanceDir);
}

/** Existing game directories for the candidate locations (plus custom folders). */
export function findInstances(locations: LauncherLocation[]): GameInstance[] {
  const out: GameInstance[] = [];
  const seen = new Set<string>();
  const push = (i: GameInstance) => {
    const key = path.resolve(i.gameDir);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(i);
  };
  for (const loc of locations) {
    if (!isDir(loc.path)) continue;
    if (loc.type === 'game') {
      push({ launcher: loc.launcher, name: path.basename(loc.path), gameDir: loc.path });
      continue;
    }
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(loc.path, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.') || e.name.startsWith('_')) continue;
      const dir = path.join(loc.path, e.name);
      push({ launcher: loc.launcher, name: instanceName(dir, loc.launcher), gameDir: instanceGameDir(dir, loc.launcher) });
    }
  }
  return out;
}

/** World folders (with level.dat) of a game directory, newest first. */
export function listWorlds(gameDir: string): { name: string; dir: string; mtime: number }[] {
  const saves = path.join(gameDir, 'saves');
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(saves, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: { name: string; dir: string; mtime: number }[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const dir = path.join(saves, e.name);
    try {
      const st = fs.statSync(path.join(dir, 'level.dat'));
      out.push({ name: e.name, dir, mtime: st.mtimeMs });
    } catch {
      /* not a world */
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

/** Destination folder for a pack: <world>/datapacks or <game>/resourcepacks. */
export function packDestination(kind: 'data' | 'resource', gameDir: string, worldDir?: string): string {
  return kind === 'data' ? path.join(worldDir ?? gameDir, 'datapacks') : path.join(gameDir, 'resourcepacks');
}
