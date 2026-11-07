import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { unzipSync } from 'fflate';
import { isJunkFile, isKnownFolder, sanitizeSegment, validateResourcePath } from '../../src/features/datapack/pathValidation';
import { buildZip, includeInPack, overlayDirs, zipFileName } from '../../src/features/datapack/packZip';
import { candidateLocations, findInstances, listWorlds, packDestination } from '../../src/features/datapack/launchers';

test('validateResourcePath', () => {
  assert.deepEqual(validateResourcePath('data/mymod/recipe/ruby_block.json'), []);
  assert.deepEqual(validateResourcePath('pack.mcmeta'), []);
  const up = validateResourcePath('data/mymod/recipe/RubyBlock.json');
  assert.equal(up[0].code, 'uppercase');
  assert.equal(up[0].suggestion, 'data/mymod/recipe/rubyblock.json');
  const sp = validateResourcePath('assets/mymod/textures/item/ruby gem.png');
  assert.equal(sp[0].code, 'spaces');
  assert.equal(sp[0].suggestion, 'assets/mymod/textures/item/ruby_gem.png');
  assert.equal(validateResourcePath('data/MyMod/recipe/a.json')[0].code, 'invalidNamespace');
  assert.equal(validateResourcePath('data/m/recipe/espada_rubí.json')[0].code, 'invalidChars');
  assert.equal(sanitizeSegment('Espada Rubí'), 'espada_rubi');
});

test('known folders and junk', () => {
  assert.ok(isKnownFolder('data/m/recipe/a.json'));
  assert.ok(isKnownFolder('data/m/recipes/a.json'));
  assert.ok(isKnownFolder('data/m/tags/item/a.json'));
  assert.ok(!isKnownFolder('data/m/recipies/a.json'));
  assert.ok(isKnownFolder('assets/m/sounds.json'));
  assert.ok(isJunkFile('data/m/.DS_Store'));
  assert.ok(isJunkFile('assets/m/textures/a.psd'));
  assert.ok(!isJunkFile('assets/m/textures/a.png'));
});

test('zip selection and build', () => {
  assert.ok(includeInPack('pack.mcmeta', 'data'));
  assert.ok(includeInPack('data/m/recipe/a.json', 'data'));
  assert.ok(!includeInPack('assets/m/lang/en_us.json', 'data'));
  assert.ok(includeInPack('assets/m/lang/en_us.json', 'resource'));
  assert.ok(!includeInPack('fabric.mod.json', 'data'));
  assert.ok(!includeInPack('data/m/Thumbs.db', 'data'));
  const dirs = overlayDirs({ overlays: { entries: [{ directory: 'ov_1' }, { directory: '../evil' }] } });
  assert.deepEqual(dirs, ['ov_1']);
  assert.ok(includeInPack('ov_1/data/m/recipe/a.json', 'data', dirs));
  const zip = buildZip([
    { path: 'pack.mcmeta', data: new TextEncoder().encode('{}') },
    { path: 'data/m/recipe/a.json', data: new TextEncoder().encode('{"a":1}') },
  ]);
  const back = unzipSync(zip);
  assert.deepEqual(Object.keys(back).sort(), ['data/m/recipe/a.json', 'pack.mcmeta']);
  assert.equal(new TextDecoder().decode(back['pack.mcmeta']), '{}');
  assert.equal(zipFileName('My Pack!', '26.3', 'data'), 'My_Pack-26.3-datapack.zip');
});

test('launcher candidate paths per OS', () => {
  const win = candidateLocations({ platform: 'win32', home: 'C:\\Users\\Ana', env: { APPDATA: 'C:\\Users\\Ana\\AppData\\Roaming' } });
  assert.ok(win.some((l) => l.launcher === 'vanilla' && l.path === 'C:\\Users\\Ana\\AppData\\Roaming\\.minecraft'));
  assert.ok(win.some((l) => l.launcher === 'curseforge' && l.path === 'C:\\Users\\Ana\\curseforge\\minecraft\\Instances'));
  assert.ok(win.some((l) => l.launcher === 'modrinth' && l.path.endsWith('ModrinthApp\\profiles')));
  const mac = candidateLocations({ platform: 'darwin', home: '/Users/ana', env: {} });
  assert.ok(mac.some((l) => l.path === '/Users/ana/Library/Application Support/minecraft'));
  assert.ok(mac.some((l) => l.path === '/Users/ana/Library/Application Support/PrismLauncher/instances'));
  const linux = candidateLocations({ platform: 'linux', home: '/home/ana', env: { XDG_DATA_HOME: '/data' } });
  assert.ok(linux.some((l) => l.path === '/home/ana/.minecraft'));
  assert.ok(linux.some((l) => l.path === '/data/PrismLauncher/instances'));
  assert.ok(linux.some((l) => l.path.includes('org.prismlauncher.PrismLauncher')));
});

test('findInstances and listWorlds on a fake tree', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vscc-'));
  const mk = (p: string, content?: string) => {
    fs.mkdirSync(path.dirname(path.join(tmp, p)), { recursive: true });
    if (content !== undefined) fs.writeFileSync(path.join(tmp, p), content);
    else fs.mkdirSync(path.join(tmp, p), { recursive: true });
  };
  mk('.minecraft/saves/World A/level.dat', 'x');
  mk('.minecraft/saves/not-a-world/readme.txt', 'x');
  mk('prism/instances/inst1/instance.cfg', 'name=Fabulous 26.3\n');
  mk('prism/instances/inst1/minecraft/saves');
  mk('modrinth/profiles/My Profile/saves/W/level.dat', 'x');
  const found = findInstances([
    { launcher: 'vanilla', type: 'game', path: path.join(tmp, '.minecraft') },
    { launcher: 'prism', type: 'instances', path: path.join(tmp, 'prism/instances') },
    { launcher: 'modrinth', type: 'instances', path: path.join(tmp, 'modrinth/profiles') },
    { launcher: 'curseforge', type: 'instances', path: path.join(tmp, 'missing') },
  ]);
  assert.deepEqual(
    found.map((f) => [f.launcher, f.name, path.relative(tmp, f.gameDir)]),
    [
      ['vanilla', '.minecraft', '.minecraft'],
      ['prism', 'Fabulous 26.3', path.join('prism', 'instances', 'inst1', 'minecraft')],
      ['modrinth', 'My Profile', path.join('modrinth', 'profiles', 'My Profile')],
    ],
  );
  assert.deepEqual(listWorlds(path.join(tmp, '.minecraft')).map((w) => w.name), ['World A']);
  assert.equal(packDestination('data', '/g', '/g/saves/W'), path.join('/g/saves/W', 'datapacks'));
  assert.equal(packDestination('resource', '/g'), path.join('/g', 'resourcepacks'));
  fs.rmSync(tmp, { recursive: true, force: true });
});
