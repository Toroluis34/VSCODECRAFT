import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeStats,
  deleteEntry,
  detectIndent,
  fillMissing,
  formatArgsMismatch,
  keyGroup,
  keyItemId,
  missingKeys,
  parseLang,
  renameEntry,
  serializeLang,
  setEntry,
  toRecord,
} from '../../src/features/translations/langFile';
import {
  ampersandToSection,
  colorToHex,
  componentToLegacy,
  componentToSnbt,
  convertComponent,
  cssToShadowColor,
  flatten,
  fromParts,
  giveCommand,
  isTextObject,
  itemNameComponent,
  LEGACY_FORMAT,
  legacyToComponent,
  MODERN_FORMAT,
  motdFromProperties,
  motdToProperties,
  nearestNamedColor,
  parseComponentInput,
  parseLegacySegments,
  parseSnbt,
  plainText,
  renderSvg,
  shadowColorToCss,
  stripLegacy,
  svgDataUri,
  tellrawCommand,
  toParts,
  toSnbt,
} from '../../src/features/translations/textComponent';
import { collectTranslateRefs, findMissing, findUnused, humanizeId, keyForId, stringLiterals, suggestText } from '../../src/features/translations/missingKeys';
import { textFormatFor } from '../../src/features/translations/textFormat';

// ---------------- lang files ----------------

const SAMPLE = `{
    "item.mymod.ruby": "Ruby",
    "block.mymod.ruby_block": "Block of Ruby",
    "item.mymod.ruby": "Ruby!",
    "tooltip.mymod.ruby": "Shiny §6gold",
    "bad": 3
}
`;

test('parseLang keeps order, detects duplicates, indentation and non-string values', () => {
  const p = parseLang(SAMPLE);
  assert.deepEqual(
    p.entries.map((e) => e.key),
    ['item.mymod.ruby', 'block.mymod.ruby_block', 'tooltip.mymod.ruby'],
  );
  assert.equal(toRecord(p.entries)['item.mymod.ruby'], 'Ruby!');
  assert.deepEqual(p.duplicates, ['item.mymod.ruby']);
  assert.deepEqual(p.nonString, ['bad']);
  assert.equal(p.indent, 4);
  assert.equal(p.eol, '\n');
  assert.equal(detectIndent('{\n\t"a": "b"\n}'), '\t');
  assert.equal(detectIndent('{}', 2), 2);
  assert.equal(parseLang('{"a":"b"}\r\n').eol, '\r\n');
});

test('serializeLang preserves order, indentation, unicode and sorts on request', () => {
  const entries = [
    { key: 'b.key', value: 'Bé "quoted"' },
    { key: 'a.key', value: 'Line\nbreak' },
  ];
  assert.equal(serializeLang(entries, { indent: 2 }), '{\n  "b.key": "Bé \\"quoted\\"",\n  "a.key": "Line\\nbreak"\n}\n');
  assert.equal(serializeLang(entries, { indent: '\t', sort: true, eol: '\r\n' }), '{\r\n\t"a.key": "Line\\nbreak",\r\n\t"b.key": "Bé \\"quoted\\""\r\n}\r\n');
  assert.equal(serializeLang([]), '{}\n');
  // round trip
  assert.deepEqual(parseLang(serializeLang(entries)).entries, entries);
});

test('setEntry / renameEntry / deleteEntry', () => {
  const base = [
    { key: 'a', value: '1' },
    { key: 'c', value: '3' },
  ];
  assert.deepEqual(setEntry(base, 'a', 'x')[0], { key: 'a', value: 'x' });
  assert.deepEqual(
    setEntry(base, 'b', '2', { sort: true }).map((e) => e.key),
    ['a', 'b', 'c'],
  );
  assert.deepEqual(
    setEntry(base, 'b', '2').map((e) => e.key),
    ['a', 'c', 'b'],
  );
  // reference order (en_us) puts it after "a"
  assert.deepEqual(
    setEntry(base, 'b', '2', { referenceOrder: ['a', 'b', 'c'] }).map((e) => e.key),
    ['a', 'b', 'c'],
  );
  assert.deepEqual(
    setEntry(base, 'z', '2', { referenceOrder: ['z', 'c'] }).map((e) => e.key),
    ['a', 'z', 'c'],
  );
  assert.deepEqual(renameEntry(base, 'a', 'z'), [
    { key: 'z', value: '1' },
    { key: 'c', value: '3' },
  ]);
  assert.deepEqual(
    renameEntry(base, 'a', 'z', true).map((e) => e.key),
    ['c', 'z'],
  );
  assert.equal(renameEntry(base, 'nope', 'z'), base);
  assert.deepEqual(deleteEntry(base, 'a'), [{ key: 'c', value: '3' }]);
});

test('key analysis', () => {
  assert.equal(keyGroup('itemGroup.mymod.main'), 'itemGroup');
  assert.equal(keyItemId('item.mymod.ruby'), 'mymod:ruby');
  assert.equal(keyItemId('block.minecraft.oak_planks'), 'minecraft:oak_planks');
  assert.equal(keyItemId('item.mymod.ruby.tooltip'), 'mymod:ruby');
  assert.equal(keyItemId('entity.mymod.ruby'), undefined);
  assert.equal(formatArgsMismatch('%s killed %s', '%s mató a %s'), false);
  assert.equal(formatArgsMismatch('%1$s killed %2$s', '%2$s fue matado por %1$s'), false);
  assert.equal(formatArgsMismatch('%s killed %s', '%s murió'), true);
  assert.equal(formatArgsMismatch('100%% sure %s', '%s seguro'), false);
});

test('stats, missing keys and fill', () => {
  const locales = {
    en_us: { a: 'Apple', b: 'Banana', c: 'Cherry', d: 'Date' },
    es_es: { a: 'Manzana', b: 'Banana', c: '', x: 'extra' },
  };
  const [en, es] = computeStats(locales);
  assert.equal(en.percent, 100);
  assert.equal(es.translated, 1);
  assert.equal(es.identical, 1);
  assert.equal(es.empty, 1);
  assert.equal(es.missing, 1);
  assert.equal(es.extra, 1);
  assert.equal(es.percent, 25);
  assert.deepEqual(missingKeys(locales.en_us, locales.es_es), ['c', 'd']);
  const base = Object.entries(locales.en_us).map(([key, value]) => ({ key, value }));
  const target = [
    { key: 'b', value: 'Plátano' },
    { key: 'd', value: 'Dátil' },
  ];
  const r = fillMissing(target, base, { marker: '[TODO] ' });
  assert.deepEqual(r.added, ['a', 'c']);
  assert.deepEqual(
    r.entries.map((e) => `${e.key}=${e.value}`),
    ['a=[TODO] Apple', 'b=Plátano', 'c=[TODO] Cherry', 'd=Dátil'],
  );
});

// ---------------- text components ----------------

test('legacy § parsing and conversion', () => {
  const segs = parseLegacySegments('§6§lGold §rplain §cred');
  assert.deepEqual(segs, [
    { color: 'gold', bold: true, text: 'Gold ' },
    { text: 'plain ' },
    { color: 'red', text: 'red' },
  ]);
  // colour codes reset formatting
  assert.deepEqual(parseLegacySegments('§l§aX'), [{ color: 'green', text: 'X' }]);
  assert.deepEqual(parseLegacySegments('§x§F§F§0§0§0§0hex'), [{ color: '#FF0000', text: 'hex' }]);
  assert.equal(stripLegacy('§aHi §lthere'), 'Hi there');
  assert.equal(ampersandToSection('&aHi &zno'), '§aHi &zno');
  assert.equal(legacyToComponent('plain'), 'plain');
  assert.deepEqual(legacyToComponent('§cRed'), { text: 'Red', color: 'red' });
  assert.deepEqual(legacyToComponent('A§cB'), { text: '', extra: ['A', { text: 'B', color: 'red' }] });
  assert.equal(componentToLegacy({ text: 'Hi', color: 'gold', bold: true, extra: [{ text: '!', color: 'red' }] }), '§6§lHi§c§l!');
  assert.equal(componentToLegacy(['', { text: 'A', italic: true }, 'B']), '§oA§rB');
  assert.equal(componentToLegacy({ text: 'x', color: '#FE5050' }), '§cx');
  assert.equal(nearestNamedColor('#010101').name, 'black');
});

test('flatten resolves translations, with-args, keybinds and inheritance', () => {
  const comp = {
    translate: 'chat.type.text',
    with: [{ text: 'Steve', color: 'yellow' }, 'hello'],
    color: 'gray',
  };
  const segs = flatten(comp, { translate: (k) => (k === 'chat.type.text' ? '<%s> %s' : undefined) });
  assert.equal(segs.map((s) => s.text).join(''), '<Steve> hello');
  assert.equal(segs.find((s) => s.text === 'Steve')?.color, 'yellow');
  assert.equal(segs.find((s) => s.text === 'hello')?.color, 'gray');
  assert.equal(plainText({ translate: 'x.y', with: ['a', 'b'] }, { translate: () => '%2$s-%1$s %%' }), 'b-a %');
  assert.equal(plainText({ translate: 'missing.key', fallback: 'Fallback' }), 'Fallback');
  assert.equal(plainText({ keybind: 'key.jump' }), 'Space');
  assert.equal(plainText(['A', { text: 'B' }]), 'AB');
  const inh = flatten({ text: 'P', bold: true, extra: [{ text: 'c' }] });
  assert.equal(inh[1].bold, true);
});

test('event formats follow the target version', () => {
  const legacy = {
    text: 'Click',
    clickEvent: { action: 'run_command', value: '/say hi' },
    hoverEvent: { action: 'show_text', contents: { text: 'Tip', color: 'red' } },
    shadow_color: -16777216,
  };
  const modern = convertComponent(legacy, MODERN_FORMAT) as any;
  assert.deepEqual(modern.click_event, { action: 'run_command', command: '/say hi' });
  assert.deepEqual(modern.hover_event, { action: 'show_text', value: { text: 'Tip', color: 'red' } });
  assert.equal(modern.clickEvent, undefined);
  assert.equal(modern.shadow_color, -16777216);
  const back = convertComponent(modern, LEGACY_FORMAT) as any;
  assert.deepEqual(back.clickEvent, { action: 'run_command', value: '/say hi' });
  assert.deepEqual(back.hoverEvent, { action: 'show_text', contents: { text: 'Tip', color: 'red' } });
  assert.equal(back.shadow_color, undefined);
  const url = convertComponent({ text: 'x', clickEvent: { action: 'open_url', value: 'https://a.b' } }, MODERN_FORMAT) as any;
  assert.deepEqual(url.click_event, { action: 'open_url', url: 'https://a.b' });
  const page = convertComponent({ text: 'x', clickEvent: { action: 'change_page', value: '3' } }, MODERN_FORMAT) as any;
  assert.deepEqual(page.click_event, { action: 'change_page', page: 3 });
  const item = convertComponent({ text: 'x', hover_event: { action: 'show_item', id: 'minecraft:diamond', count: 2 } }, LEGACY_FORMAT) as any;
  assert.deepEqual(item.hoverEvent, { action: 'show_item', contents: { id: 'minecraft:diamond', count: 2 } });
  const ent = convertComponent({ text: 'x', hoverEvent: { action: 'show_entity', contents: { type: 'minecraft:pig', id: 'abc', name: 'Bob' } } }, MODERN_FORMAT) as any;
  assert.deepEqual(ent.hover_event, { action: 'show_entity', id: 'minecraft:pig', uuid: 'abc', name: 'Bob' });
  // nested extra converted too
  const nested = convertComponent({ text: '', extra: [{ text: 'a', clickEvent: { action: 'suggest_command', value: '/x' } }] }, MODERN_FORMAT) as any;
  assert.deepEqual(nested.extra[0].click_event, { action: 'suggest_command', command: '/x' });
});

test('text format by version', () => {
  assert.deepEqual(textFormatFor('1.21.4'), { snakeCaseEvents: false, shadowColor: true, snbt: false });
  assert.deepEqual(textFormatFor('1.21.5'), { snakeCaseEvents: true, shadowColor: true, snbt: true });
  assert.deepEqual(textFormatFor('1.21.1'), { snakeCaseEvents: false, shadowColor: false, snbt: false });
  assert.equal(textFormatFor('26.3').snakeCaseEvents, true);
});

test('SNBT serialize and parse', () => {
  assert.equal(toSnbt({ text: 'Hi "there"', bold: true, extra: [{ text: 'x', color: 'red' }] }), `{text:'Hi "there"',bold:true,extra:[{text:"x",color:"red"}]}`);
  assert.equal(toSnbt({ 'weird key': 1, f: 0.5 }), '{"weird key":1,f:0.5d}');
  assert.equal(componentToSnbt({ text: 'A', clickEvent: { action: 'open_url', value: 'https://x' } }), '{text:"A",click_event:{action:"open_url",url:"https://x"}}');
  assert.deepEqual(parseSnbt(`{text:'Hi',bold:1b,list:[1,2.5f],nested:{"q k":"v\\"x"},arr:[I;1,2],t:true}`), {
    text: 'Hi',
    bold: 1,
    list: [1, 2.5],
    nested: { 'q k': 'v"x' },
    arr: [1, 2],
    t: true,
  });
  const comp = { text: 'Hello', color: 'gold', extra: [{ text: ' world', italic: true }] };
  assert.deepEqual(parseSnbt(toSnbt(comp)), comp);
  assert.throws(() => parseSnbt('{text:"a"'));
  assert.deepEqual(convertComponent(parseSnbt('{text:"a",bold:1b}') as any, MODERN_FORMAT), { text: 'a', bold: true });
});

test('commands & item components per version', () => {
  const c = { text: 'Ruby', color: 'red', italic: false };
  assert.equal(tellrawCommand(c, MODERN_FORMAT), '/tellraw @a {text:"Ruby",color:"red",italic:false}');
  assert.equal(tellrawCommand(c, LEGACY_FORMAT), '/tellraw @a {"text":"Ruby","color":"red","italic":false}');
  assert.equal(itemNameComponent(c, LEGACY_FORMAT), `custom_name='{"text":"Ruby","color":"red","italic":false}'`);
  assert.equal(giveCommand("It's", LEGACY_FORMAT), `/give @p minecraft:paper[custom_name='"It\\'s"']`);
  assert.equal(itemNameComponent(c, MODERN_FORMAT), 'custom_name={text:"Ruby",color:"red",italic:false}');
});

test('parse input & parts', () => {
  assert.deepEqual(parseComponentInput('{"text":"a"}'), { text: 'a' });
  assert.deepEqual(parseComponentInput('{text:"a",color:red}'), { text: 'a', color: 'red' });
  assert.deepEqual(parseComponentInput('&cRed'), { text: 'Red', color: 'red' });
  assert.equal(parseComponentInput('plain'), 'plain');
  assert.deepEqual(toParts(['', { text: 'a', color: 'red' }, 'b']), [{ text: 'a', color: 'red' }, { text: 'b' }]);
  assert.deepEqual(toParts({ text: '', color: 'gold', extra: ['a', { text: 'b', color: 'red' }] }), [
    { color: 'gold', text: 'a' },
    { color: 'red', text: 'b' },
  ]);
  assert.deepEqual(toParts({ text: 'P', bold: true, extra: ['c'] }), [{ text: 'P', bold: true }, { bold: true, text: 'c' }]);
  assert.deepEqual(fromParts([{ text: 'a', bold: false }]), 'a');
  assert.deepEqual(fromParts([{ text: 'a', color: 'red' }, { text: 'b' }]), ['', { text: 'a', color: 'red' }, 'b']);
  assert.equal(fromParts([]), '');
  assert.equal(isTextObject({ text: 'a', color: 'red' }), true);
  assert.equal(isTextObject({ text: 'a', foo: 1 }), false);
});

test('colours and shadows', () => {
  assert.equal(colorToHex('gold'), '#FFAA00');
  assert.equal(colorToHex('#a1b2c3'), '#A1B2C3');
  assert.equal(colorToHex('nope'), undefined);
  assert.deepEqual(shadowColorToCss(cssToShadowColor('#FF0000', 1)), { hex: '#FF0000', alpha: 1 });
  assert.deepEqual(shadowColorToCss([0, 0, 1, 0.5]), { hex: '#0000FF', alpha: 0.5 });
});

test('SVG rendering', () => {
  const svg = renderSvg(flatten({ text: 'A<b>', color: 'red', bold: true, extra: [{ text: '\nline2', underlined: true }] }));
  assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="\d+" height="\d+"/);
  assert.match(svg, /fill="#FF5555" font-weight="bold">A&lt;b&gt;<\/text>/);
  assert.match(svg, /fill="#3F1515"/); // default shadow = colour / 4
  assert.match(svg, /text-decoration="underline">line2</);
  const uri = svgDataUri(svg);
  assert.ok(uri.startsWith('data:image/svg+xml;base64,'));
  assert.equal(Buffer.from(uri.split(',')[1], 'base64').toString('utf8'), svg);
});

test('MOTD escaping', () => {
  const motd = '§aHello §lWörld\nline 2';
  const line = motdToProperties(motd);
  assert.equal(line, 'motd=\\u00A7aHello \\u00A7lW\\u00F6rld\\nline 2');
  assert.equal(motdFromProperties(line), motd);
});

// ---------------- missing / unused keys ----------------

test('suggestions', () => {
  assert.equal(humanizeId('ruby_block'), 'Ruby Block');
  assert.equal(humanizeId('heart_of_the_sea'), 'Heart of the Sea');
  assert.equal(keyForId('item', 'mymod:ruby'), 'item.mymod.ruby');
  assert.equal(keyForId('creative_tab', 'mymod:main'), 'itemGroup.mymod.main');
  assert.equal(suggestText('item.mymod.ruby_sword'), 'Ruby Sword');
  assert.equal(suggestText('advancements.mymod.story.get_ruby.title'), 'Get Ruby');
  assert.equal(suggestText('subtitles.mymod.block.ruby_block.break'), 'Ruby Block breaks');
  assert.equal(suggestText('death.attack.mymod.laser'), '%1$s was killed by laser');
  assert.equal(suggestText('death.attack.laser.player'), '%1$s was killed by laser while fighting %2$s');
});

test('collectTranslateRefs', () => {
  const adv = {
    display: {
      title: { translate: 'advancements.mymod.root.title', fallback: 'Ruby Age' },
      description: { translate: 'advancements.mymod.root.description' },
    },
  };
  const refs = collectTranslateRefs(adv, { source: 'adv.json' });
  assert.deepEqual(
    refs.map((r) => [r.key, r.kind, r.suggestion]),
    [
      ['advancements.mymod.root.title', 'advancement', 'Ruby Age'],
      ['advancements.mymod.root.description', 'advancement', 'Root'],
    ],
  );
  const sounds = { 'block.ruby.break': { sounds: ['mymod:ruby'], subtitle: 'subtitles.mymod.block.ruby.break' } };
  assert.equal(collectTranslateRefs(sounds)[0].key, 'subtitles.mymod.block.ruby.break');
  const dmg = collectTranslateRefs({ message_id: 'laser', exhaustion: 0.1 }, { kind: 'damage_type' });
  assert.deepEqual(
    dmg.map((r) => r.key),
    ['death.attack.laser', 'death.attack.laser.player'],
  );
});

test('findMissing', () => {
  const refs = [
    { key: 'item.mymod.ruby', kind: 'item' as const, suggestion: 'Ruby' },
    { key: 'item.mymod.ruby_block', kind: 'item' as const, suggestion: 'Ruby Block' },
    { key: 'item.mymod.sapphire', kind: 'item' as const, suggestion: 'Sapphire' },
    { key: 'item.mymod.sapphire', kind: 'item' as const, suggestion: 'dup' },
    { key: 'item.othermod.x', kind: 'item' as const, suggestion: 'X' },
    { key: 'gui.done', kind: 'translate' as const, suggestion: 'Done' },
  ];
  const missing = findMissing(refs, {
    existing: new Set(['item.mymod.ruby', 'block.mymod.ruby_block']),
    vanilla: new Set(['gui.done']),
    namespaces: new Set(['mymod']),
  });
  assert.deepEqual(
    missing.map((m) => m.key),
    ['item.mymod.sapphire'],
  );
});

test('findUnused', () => {
  const lits = stringLiterals('Component.translatable("tooltip.mymod.used"); String p = "message.mymod.dyn."; char c = \'x\';');
  assert.ok(lits.has('tooltip.mymod.used'));
  const r = findUnused(
    ['item.mymod.ruby', 'item.mymod.ruby.tooltip', 'tooltip.mymod.used', 'tooltip.mymod.old', 'message.mymod.dyn.hello', 'key.mymod.open'],
    new Set(['item.mymod.ruby']),
    lits,
  );
  assert.deepEqual(r.unused, ['tooltip.mymod.old']);
  assert.deepEqual(r.maybe, ['item.mymod.ruby.tooltip', 'message.mymod.dyn.hello', 'key.mymod.open']);
});

test('componentAt finds the outermost text component', async () => {
  const { componentAt } = await import('../../src/features/translations/jsonComponents');
  const jsonc = await import('jsonc-parser');
  const text = JSON.stringify({
    display: {
      title: { text: 'Root', color: 'gold', extra: [{ text: 'X', hover_event: { action: 'show_text', value: { text: 'tip' } } }] },
      description: 'plain',
    },
    lore: [{ text: 'line 1' }, { text: 'line 2' }],
  });
  const tree = jsonc.parseTree(text);
  const at = (s: string) => componentAt(tree, text.indexOf(s) + 1)?.value;
  assert.equal((at('"tip"') as any)?.text, 'Root');
  assert.equal((at('"X"') as any)?.text, 'Root');
  assert.equal(at('"plain"'), undefined);
  assert.deepEqual({ ...(at('"line 2"') as object) }, { text: 'line 2' });
});
