import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crop, decodePng, encodePng, fromPixelArt, packIcon, placeholderTexture, scale } from '../../src/features/explorer/png';
import { buildPackMcmeta, isValidNamespace, packFiles } from '../../src/features/explorer/packTemplates';
import { className, generateModProject, idClass, isValidModId, isValidPackage, lookupVersion, ModProjectOptions } from '../../src/features/explorer/modTemplate';
import {
  bucketByLetter,
  buildPathTree,
  categorize,
  isDataDrivenRegistry,
  isValidResourcePath,
  matchesFilter,
  parseVanillaDocPath,
  pickIconTexture,
  replaceFunctionReferences,
  replaceReferences,
  vanillaDocPath,
} from '../../src/features/explorer/resourceModel';
import { findRegistrations, langKeys, literalAt, registrationKind, registrationOnLine } from '../../src/features/explorer/javaRegistrations';

const dec = (v: string | Uint8Array) => (typeof v === 'string' ? v : new TextDecoder().decode(v));

test('png: encode/decode round trip, crop and scale', () => {
  const img = fromPixelArt(['r.g', 'bbb'], { r: '#ff0000', g: '#00ff0080', b: '#0000ff' });
  assert.equal(img.width, 3);
  const back = decodePng(encodePng(img));
  assert.equal(back.width, 3);
  assert.equal(back.height, 2);
  assert.deepEqual([...back.data], [...img.data]);
  assert.deepEqual([...back.data.slice(8, 12)], [0, 255, 0, 128]);
  const c = crop(back, 1, 0, 2, 2);
  assert.deepEqual([...c.data.slice(0, 4)], [0, 0, 0, 0]);
  assert.deepEqual([...c.data.slice(4, 8)], [0, 255, 0, 128]);
  const s = scale(img, 4);
  assert.equal(s.width, 12);
  assert.deepEqual([...s.data.slice(0, 4)], [255, 0, 0, 255]);
  const icon = packIcon('data', 'x', 64);
  assert.equal(icon.width, 64);
  assert.equal(placeholderTexture('mymod:item/ruby').width, 16);
});

test('pack.mcmeta: format style depends on the version range', () => {
  // Old versions only: pack_format (+ supported_formats when the range spans formats)
  assert.deepEqual(buildPackMcmeta({ kind: 'data', minVersion: '1.21.1', maxVersion: '1.21.1', description: 'd' }).pack, { description: 'd', pack_format: 48 });
  assert.deepEqual(buildPackMcmeta({ kind: 'data', minVersion: '1.21.1', maxVersion: '1.21.4', description: 'd' }).pack, {
    description: 'd',
    pack_format: 61,
    supported_formats: [48, 61],
  });
  // New versions only: min_format/max_format, minor kept in min_format
  assert.deepEqual(buildPackMcmeta({ kind: 'data', minVersion: '1.21.11', maxVersion: '26.3', description: 'd' }).pack, {
    description: 'd',
    min_format: [94, 1],
    max_format: 121,
  });
  assert.deepEqual(buildPackMcmeta({ kind: 'resource', minVersion: '26.3', maxVersion: '26.3', description: 'd' }).pack, {
    description: 'd',
    min_format: [97, 1],
    max_format: 97,
  });
  // Crossing 1.21.9: both styles
  const both = buildPackMcmeta({ kind: 'resource', minVersion: '1.21.4', maxVersion: '26.3', description: 'd' }).pack;
  assert.equal(both.pack_format, 46);
  assert.deepEqual(both.supported_formats, [46, 97]);
  assert.equal(both.min_format, 46);
  assert.equal(both.max_format, 97);
  // Reversed range is normalised
  assert.deepEqual(buildPackMcmeta({ kind: 'data', minVersion: '1.21.4', maxVersion: '1.21.1', description: '' }).pack.supported_formats, [48, 61]);
});

test('pack scaffolding files', () => {
  const dp = packFiles({ kind: 'data', name: 'My Pack', namespace: 'mypack', minVersion: '1.21.4', maxVersion: '26.3', description: 'Hi' });
  assert.deepEqual(JSON.parse(dec(dp['data/minecraft/tags/function/load.json'])), { values: ['mypack:load'] });
  assert.ok(dp['data/mypack/function/tick.mcfunction']);
  assert.match(dec(dp['data/mypack/function/load.mcfunction']), /tellraw @a/);
  assert.ok(dp['pack.png'] instanceof Uint8Array);
  assert.equal(decodePng(dp['pack.png'] as Uint8Array).width, 64);
  assert.ok(JSON.parse(dec(dp['pack.mcmeta'])).pack.min_format);
  const rp = packFiles({ kind: 'resource', name: 'RP', namespace: 'rp', minVersion: '26.3', maxVersion: '26.3', description: '' });
  assert.ok(rp['assets/rp/lang/en_us.json']);
  assert.equal(Object.keys(rp).some((k) => k.startsWith('data/')), false);
  assert.ok(isValidNamespace('my_pack.v2'));
  assert.ok(!isValidNamespace('My Pack'));
});

const base: ModProjectOptions = {
  loader: 'fabric',
  mcVersion: '26.3',
  modId: 'rubymod',
  modName: 'Ruby Mod',
  packageName: 'com.example.rubymod',
  author: 'Me',
  description: 'Rubies',
  license: 'MIT',
  exampleItem: true,
};

test('mod project: Fabric 26.x uses the non-remapping Loom plugin and Java 25', () => {
  const f = generateModProject(base);
  const build = dec(f['build.gradle']);
  assert.match(build, /id 'net\.fabricmc\.fabric-loom' version/);
  assert.doesNotMatch(build, /mappings/);
  assert.match(build, /implementation "net\.fabricmc:fabric-loader/);
  assert.match(build, /release = 25/);
  const props = dec(f['gradle.properties']);
  assert.match(props, /CHECK THESE VERSIONS/);
  assert.match(props, /fabric_api_version=0\.165\.0\+26\.3/);
  const fmj = JSON.parse(dec(f['src/main/resources/fabric.mod.json']));
  assert.equal(fmj.id, 'rubymod');
  assert.equal(fmj.entrypoints.main[0], 'com.example.rubymod.Rubymod');
  assert.equal(fmj.depends.java, '>=25');
  assert.equal(JSON.parse(dec(f['src/main/resources/rubymod.mixins.json'])).compatibilityLevel, 'JAVA_25');
  const items = dec(f['src/main/java/com/example/rubymod/ModItems.java']);
  assert.match(items, /setId\(key\)/);
  assert.match(items, /CreativeModeTabEvents/);
  assert.match(dec(f['src/main/java/com/example/rubymod/Rubymod.java']), /import net\.minecraft\.resources\.Identifier;/);
  assert.ok(f['src/main/resources/assets/rubymod/items/ruby.json']);
  assert.ok(f['src/main/resources/assets/rubymod/textures/item/ruby.png'] instanceof Uint8Array);
});

test('mod project: Fabric 1.21.1 remaps with Mojang mappings and has no setId', () => {
  const f = generateModProject({ ...base, mcVersion: '1.21.1' });
  const build = dec(f['build.gradle']);
  assert.match(build, /net\.fabricmc\.fabric-loom-remap/);
  assert.match(build, /mappings loom\.officialMojangMappings\(\)/);
  assert.match(build, /modImplementation/);
  assert.match(build, /release = 21/);
  const items = dec(f['src/main/java/com/example/rubymod/ModItems.java']);
  assert.doesNotMatch(items, /setId/);
  assert.match(items, /ItemGroupEvents/);
  assert.match(dec(f['src/main/java/com/example/rubymod/Rubymod.java']), /ResourceLocation/);
  assert.equal(f['src/main/resources/assets/rubymod/items/ruby.json'], undefined);
});

test('mod project: NeoForge', () => {
  const f = generateModProject({ ...base, loader: 'neoforge', mcVersion: '1.21.1' });
  const build = dec(f['build.gradle']);
  assert.match(build, /id 'net\.neoforged\.moddev' version/);
  assert.match(build, /parchment \{/);
  assert.match(build, /JavaLanguageVersion\.of\(21\)/);
  assert.match(dec(f['gradle.properties']), /neo_version=21\.1\.265/);
  const toml = dec(f['src/main/templates/META-INF/neoforge.mods.toml']);
  assert.match(toml, /modId="\$\{mod_id\}"/);
  assert.match(toml, /loaderVersion/);
  const main = dec(f['src/main/java/com/example/rubymod/Rubymod.java']);
  assert.match(main, /@Mod\(Rubymod\.MODID\)/);
  assert.match(main, /registerSimpleItem\("ruby"\)/);

  const n26 = generateModProject({ ...base, loader: 'neoforge', mcVersion: '26.3', exampleItem: false });
  assert.doesNotMatch(dec(n26['build.gradle']), /parchment/);
  assert.match(dec(n26['build.gradle']), /JavaLanguageVersion\.of\(25\)/);
  assert.doesNotMatch(dec(n26['src/main/templates/META-INF/neoforge.mods.toml']), /loaderVersion/);
  assert.doesNotMatch(dec(n26['src/main/java/com/example/rubymod/Rubymod.java']), /DeferredItem/);
});

test('mod project helpers', () => {
  assert.equal(className('my_cool_mod'), 'MyCoolMod');
  assert.equal(idClass('1.21.10'), 'ResourceLocation');
  assert.equal(idClass('1.21.11'), 'Identifier');
  assert.equal(idClass('26.1'), 'Identifier');
  assert.deepEqual(lookupVersion({ '1.21.1': 'a', '1.21.4': 'b' }, '1.21.4'), { value: 'b', exact: true });
  assert.deepEqual(lookupVersion({ '1.21.1': 'a', '1.21.4': 'b' }, '1.21.3'), { value: 'a', exact: false });
  assert.ok(isValidModId('ruby_mod'));
  assert.ok(!isValidModId('Ruby'));
  assert.ok(!isValidModId('r'));
  assert.ok(isValidPackage('com.example.mod_1'));
  assert.ok(!isValidPackage('com..example'));
});

test('resource tree model', () => {
  assert.equal(categorize('recipe').label, 'Recipes');
  assert.deepEqual([categorize('tags/item').key, categorize('tags/item').group], ['tags', 'item']);
  assert.deepEqual([categorize('worldgen/biome').key, categorize('worldgen/biome').group], ['worldgen', 'biome']);
  assert.deepEqual([categorize('damage_type').key, categorize('damage_type').group], ['other', 'damage_type']);
  const tree = buildPathTree(['item/ruby', 'block/ruby_block', 'item/tools/ruby_pick', 'top'], (s) => s);
  assert.deepEqual(
    tree.map((n) => `${n.type}:${n.name}`),
    ['folder:block', 'folder:item', 'leaf:top'],
  );
  const item = tree[1];
  assert.ok(item.type === 'folder');
  assert.deepEqual(item.children.map((n) => `${n.type}:${n.name}`), ['folder:tools', 'leaf:ruby']);
  assert.equal(item.type === 'folder' && (item.children[0] as any).path, 'item/tools');
  const buckets = bucketByLetter(['zombie', 'apple', '1up', 'acacia'], (s) => s);
  assert.deepEqual(buckets.map((b) => b.letter), ['#', 'A', 'Z']);
  assert.deepEqual(buckets[1].items, ['acacia', 'apple']);
  assert.ok(matchesFilter('ruby rec', 'mymod:ruby', 'recipe'));
  assert.ok(!matchesFilter('emerald', 'mymod:ruby'));
  assert.ok(isValidResourcePath('item/ruby_2'));
  assert.ok(!isValidResourcePath('item//ruby'));
  assert.ok(isDataDrivenRegistry('worldgen/biome'));
  assert.ok(isDataDrivenRegistry('enchantment'));
  assert.ok(!isDataDrivenRegistry('worldgen/feature_type'));
  assert.ok(!isDataDrivenRegistry('item'));
});

test('reference replacement on rename', () => {
  const json = '{"result":{"id":"mymod:ruby"},"key":{"#":"mymod:ruby_block"},"tag":"#mymod:ruby","x":"mymod:rubyx"}';
  const r = replaceReferences(json, 'mymod:ruby', 'mymod:red_gem');
  assert.equal(r.count, 2);
  assert.equal(r.text, '{"result":{"id":"mymod:red_gem"},"key":{"#":"mymod:ruby_block"},"tag":"#mymod:red_gem","x":"mymod:rubyx"}');
  const fn = replaceFunctionReferences('give @s mymod:ruby 1\nfunction #mymod:ruby\nsay mymod:ruby_block', 'mymod:ruby', 'mymod:gem');
  assert.equal(fn.count, 2);
  assert.equal(fn.text, 'give @s mymod:gem 1\nfunction #mymod:gem\nsay mymod:ruby_block');
});

test('vanilla browse URIs and icon texture choice', () => {
  const p = vanillaDocPath('26.3', 'tags/worldgen/biome', 'minecraft:is_ocean');
  assert.equal(p, '/26.3/tags~worldgen~biome/minecraft/is_ocean.json');
  assert.deepEqual(parseVanillaDocPath(p), { version: '26.3', kind: 'tags/worldgen/biome', id: 'minecraft:is_ocean' });
  assert.deepEqual(parseVanillaDocPath(vanillaDocPath('1.21.1', 'loot_table', 'blocks/stone')), { version: '1.21.1', kind: 'loot_table', id: 'minecraft:blocks/stone' });
  assert.equal(pickIconTexture({ layer0: 'mymod:item/ruby' }), 'mymod:item/ruby');
  assert.equal(pickIconTexture({ all: '#side', side: 'minecraft:block/stone', particle: '#all' }), 'minecraft:block/stone');
  assert.equal(pickIconTexture({ foo: '#missing' }), undefined);
});

test('java registrations', () => {
  const src = [
    'public class ModItems {',
    '    // ITEMS.register("commented", ...)',
    '    public static final Item RUBY = register("ruby", Item::new, new Item.Properties());',
    '    public static final DeferredItem<Item> GEM = ITEMS.registerSimpleItem("gem");',
    '    public static final DeferredBlock<Block> RUBY_BLOCK = BLOCKS.registerSimpleBlock("ruby_block", p -> p.strength(3f));',
    '    public static final DeferredItem<BlockItem> RUBY_BLOCK_ITEM = ITEMS.registerSimpleBlockItem("ruby_block", RUBY_BLOCK);',
    '    public static final Supplier<CreativeModeTab> TAB = CREATIVE_MODE_TABS.register("main", () -> CreativeModeTab.builder().build());',
    '    public static final Item X = Registry.register(BuiltInRegistries.ITEM, Identifier.fromNamespaceAndPath("othermod", "sapphire"), new Item(props));',
    '    public static final Item Y = Registry.register(BuiltInRegistries.ITEM, Identifier.fromNamespaceAndPath(MOD_ID, "topaz"), new Item(props));',
    '    /* registerItem("in_block_comment")',
    '       */',
    '}',
  ].join('\n');
  const regs = findRegistrations(src);
  assert.deepEqual(
    regs.map((r) => `${r.line}:${r.kind}:${r.namespace ?? ''}:${r.name}:${r.blockItem}`),
    ['2:item::ruby:false', '3:item::gem:false', '4:block::ruby_block:false', '5:item::ruby_block:true', '7:item:othermod:sapphire:false', '8:item::topaz:false'],
  );
  const line = src.split('\n')[2];
  const r = registrationOnLine(line)!;
  assert.equal(line.slice(r.start, r.end), 'ruby');
  const l7 = src.split('\n')[7];
  const r7 = registrationOnLine(l7)!;
  assert.equal(l7.slice(r7.start, r7.end), 'sapphire');
  assert.equal(literalAt(line, line.indexOf('ruby') + 1)?.value, 'ruby');
  assert.equal(literalAt(line, 3), undefined);
  assert.equal(registrationKind('ENTITY_TYPES.register("ruby_golem", () -> EntityType.Builder.of(...))').kind, 'other');
  assert.equal(registrationOnLine('public static final Item X = register("mymod:ns_ruby", Item::new);')?.namespace, 'mymod');
  assert.deepEqual(langKeys('item', 'mymod', 'ruby'), ['item.mymod.ruby', 'block.mymod.ruby']);
  assert.deepEqual(langKeys('block', 'mymod', 'ruby_block'), ['block.mymod.ruby_block']);
});
