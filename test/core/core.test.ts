import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyPath, normalizeId, parseRL, humanize, toResourcePath } from '../../src/core/resourceLocation';
import { compareVersions, getFeatures, dataFolder, closestBundledVersion } from '../../src/core/versions';
import { extractMcVersion, parseFabricModJson, parseModsToml, parsePackMcmeta, parseGradleProperties } from '../../src/core/projectDetect';

test('resource locations', () => {
  assert.deepEqual(parseRL('diamond'), { namespace: 'minecraft', path: 'diamond', isTag: false });
  assert.deepEqual(parseRL('#c:ingots/iron'), { namespace: 'c', path: 'ingots/iron', isTag: true });
  assert.equal(normalizeId('#logs'), '#minecraft:logs');
  assert.equal(humanize('ruby_block'), 'Ruby Block');
  assert.equal(toResourcePath('Espada de Rubí'), 'espada_de_rubi');
});

test('classifyPath', () => {
  const r = classifyPath('/w/mod/src/main/resources/data/mymod/recipe/ruby_block.json')!;
  assert.equal(r.kind, 'recipe');
  assert.equal(r.id, 'mymod:ruby_block');
  assert.equal(r.root, '/w/mod/src/main/resources');
  const t = classifyPath('/p/data/minecraft/tags/item/logs.json')!;
  assert.equal(t.kind, 'tags/item');
  const b = classifyPath('/p/data/minecraft/tags/worldgen/biome/is_forest.json')!;
  assert.equal(b.kind, 'tags/worldgen/biome');
  assert.equal(b.id, 'minecraft:is_forest');
  const legacy = classifyPath('/p/data/x/recipes/a.json')!;
  assert.equal(legacy.kind, 'recipe');
  assert.equal(legacy.legacyFolder, true);
  const m = classifyPath('C:\\mods\\x\\src\\main\\resources\\assets\\x\\models\\item\\ruby.json')!;
  assert.equal(m.kind, 'models');
  assert.equal(m.id, 'x:item/ruby');
  const s = classifyPath('/p/assets/x/sounds.json')!;
  assert.equal(s.kind, 'sounds');
  const wg = classifyPath('/p/data/x/worldgen/biome/ruby_fields.json')!;
  assert.equal(wg.kind, 'worldgen/biome');
  assert.equal(classifyPath('/p/src/main/java/A.java'), undefined);
});

test('versions', () => {
  assert.ok(compareVersions('26.1', '1.21.11') > 0);
  assert.ok(compareVersions('1.21.10', '1.21.9') > 0);
  assert.ok(compareVersions('26.4-snapshot-7', '26.4') < 0);
  assert.ok(compareVersions('26.4-snapshot-7', '26.3') > 0);
  assert.equal(getFeatures('1.21.1').ingredientFormat, 'object');
  assert.equal(getFeatures('1.21.4').ingredientFormat, 'string');
  assert.equal(getFeatures('1.21.4').hasItemDefinitions, true);
  assert.equal(getFeatures('1.21.9').packMetaStyle, 'min_max');
  assert.equal(getFeatures('26.1').javaVersion, 25);
  assert.equal(getFeatures('26.3').hasBrewingRecipes, true);
  assert.equal(getFeatures('1.21.1').dataPackFormat, 48);
  assert.equal(getFeatures('26.1').dataPackFormat, 101);
  assert.equal(dataFolder('recipe', '1.20.4'), 'recipes');
  assert.equal(dataFolder('tags/item', '1.21'), 'tags/item');
  assert.equal(closestBundledVersion('26.2'), '26.3');
  assert.equal(closestBundledVersion('1.21.4'), '1.21.11');
});

test('project detection helpers', () => {
  assert.equal(extractMcVersion('~1.21.4'), '1.21.4');
  assert.equal(extractMcVersion('[1.21.1,1.22)'), '1.21.1');
  assert.equal(extractMcVersion('>=26.1'), '26.1');
  const f = parseFabricModJson('{"id":"ruby","depends":{"minecraft":"~1.21.4"},"entrypoints":{"main":["a.B"]}}');
  assert.deepEqual([f.loader, f.modIds[0], f.mcVersion], ['fabric', 'ruby', '1.21.4']);
  const n = parseModsToml('modLoader="javafml"\n[[mods]]\nmodId="ruby"\n[[dependencies.ruby]]\nmodId="minecraft"\nversionRange="[1.21.1,1.22)"\n', 'neoforge');
  assert.deepEqual([n.modIds[0], n.mcVersion], ['ruby', '1.21.1']);
  assert.deepEqual(parsePackMcmeta('{"pack":{"min_format":[88,0],"max_format":94,"description":"x"}}').maxFormat, 94);
  assert.equal(parseGradleProperties('minecraft_version=1.21.1\n# c\nmod_id = ruby').mod_id, 'ruby');
});
