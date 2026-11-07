import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  advancementLangKeys,
  ancestry,
  backgroundTexture,
  buildTabs,
  criterionConditions,
  defaultBackground,
  iconOf,
  newAdvancementJson,
  readAdvancement,
  type AdvancementInfo,
} from '../../src/features/loot/advancementModel';
import { plainText, textRuns, translationKeys } from '../../src/features/loot/text';

const adv = (id: string, parent?: string, display = true): AdvancementInfo =>
  readAdvancement(id, { parent, display: display ? { icon: { id: 'minecraft:stone' }, title: id, description: '' } : undefined, criteria: { a: { trigger: 'minecraft:impossible' } } }, 'workspace');

test('readAdvancement handles 1.21.1 and 26.3 shapes', () => {
  const old = readAdvancement(
    'minecraft:story/root',
    {
      criteria: { crafting_table: { conditions: { items: [{ items: 'minecraft:crafting_table' }] }, trigger: 'minecraft:inventory_changed' } },
      display: { announce_to_chat: false, background: 'minecraft:textures/gui/advancements/backgrounds/stone.png', icon: { count: 1, id: 'minecraft:grass_block' }, show_toast: false, title: { translate: 'advancements.story.root.title' }, description: { translate: 'x' } },
      requirements: [['crafting_table']],
    },
    'vanilla',
  );
  assert.equal(old.display!.icon, 'minecraft:grass_block');
  assert.equal(old.display!.frame, 'task');
  assert.equal(old.display!.showToast, false);
  assert.equal(old.criteria[0].trigger, 'minecraft:inventory_changed');
  assert.equal(iconOf({ icon: { item: 'diamond' } }), 'minecraft:diamond');
  const ch = readAdvancement('x:y', { parent: 'x:root', display: { icon: { id: 'a:b' }, frame: 'challenge', title: 't', description: 'd' }, rewards: { experience: 50, recipes: ['a:r'] } }, 'workspace');
  assert.equal(ch.display!.frame, 'challenge');
  assert.equal(ch.rewards!.experience, 50);
  assert.equal(ch.parent, 'x:root');
});

test('tabs per root, hidden ancestors, no overlapping nodes', () => {
  const list = [
    adv('m:root'),
    adv('m:a', 'm:root'),
    adv('m:b', 'm:root'),
    adv('m:a1', 'm:a'),
    adv('m:a2', 'm:a'),
    adv('m:a3', 'm:a'),
    adv('m:b1', 'm:b'),
    adv('m:hidden', 'm:b', false),
    adv('m:under_hidden', 'm:hidden'),
    adv('o:root'),
    adv('o:orphan', 'o:missing_parent'),
  ];
  const tabs = buildTabs(list);
  assert.deepEqual(tabs.map((t) => t.root), ['m:root', 'o:orphan', 'o:root']);
  const m = tabs[0];
  assert.equal(m.nodes.length, 8);
  assert.ok(!m.nodes.some((n) => n.id === 'm:hidden'));
  assert.equal(m.nodes.find((n) => n.id === 'm:under_hidden')!.parent, 'm:b');
  // columns = depth
  assert.equal(m.nodes.find((n) => n.id === 'm:a1')!.x, 2);
  // no two nodes at the same position
  const keys = m.nodes.map((n) => `${n.x}:${n.y}`);
  assert.equal(new Set(keys).size, keys.length);
  // parents centred on their children
  const y = (id: string) => m.nodes.find((n) => n.id === id)!.y;
  assert.equal(y('m:a'), (y('m:a1') + y('m:a3')) / 2);
  assert.equal(m.width, 3);
  assert.ok(m.height >= 5);
  // with hidden ones
  const all = buildTabs(list, { includeHidden: true });
  assert.ok(all[0].nodes.some((n) => n.id === 'm:hidden'));
  assert.deepEqual(ancestry('m:a2', list), ['m:root', 'm:a', 'm:a2']);
});

test('contour packing keeps narrow subtrees close', () => {
  // root -> [deep chain, leaf]: the leaf can sit right below the chain head
  const list = [adv('n:r'), adv('n:c1', 'n:r'), adv('n:c2', 'n:c1'), adv('n:c3', 'n:c2'), adv('n:leaf', 'n:r')];
  const t = buildTabs(list)[0];
  assert.equal(t.height, 2);
});

test('new advancement JSON is version-aware', () => {
  const j = newAdvancementJson({
    id: 'mymod:story/ruby',
    parent: 'minecraft:story/root',
    icon: 'mymod:ruby',
    title: 'Ruby!',
    description: 'Find a ruby',
    titleKey: 'advancements.mymod.story.ruby.title',
    descriptionKey: 'advancements.mymod.story.ruby.description',
    frame: 'goal',
    trigger: 'minecraft:inventory_changed',
    rewards: { experience: 10, recipes: ['mymod:ruby_block'] },
    version: '26.3',
  });
  assert.deepEqual(j, {
    parent: 'minecraft:story/root',
    display: {
      icon: { id: 'mymod:ruby' },
      title: { translate: 'advancements.mymod.story.ruby.title' },
      description: { translate: 'advancements.mymod.story.ruby.description' },
      frame: 'goal',
    },
    criteria: { requirement: { trigger: 'minecraft:inventory_changed', conditions: { items: [{ items: 'mymod:ruby' }] } } },
    rewards: { experience: 10, recipes: ['mymod:ruby_block'] },
  });
  const root = newAdvancementJson({ id: 'm:root', icon: 'stone', title: 'T', description: 'D', frame: 'task', trigger: 'minecraft:tick', version: '1.21.1' }) as any;
  assert.equal(root.display.background, 'minecraft:textures/gui/advancements/backgrounds/stone.png');
  assert.deepEqual(root.display.title, { text: 'T' });
  assert.deepEqual(root.criteria.requirement, { trigger: 'minecraft:tick', conditions: {} });
  assert.equal(defaultBackground('1.21.5'), 'minecraft:gui/advancements/backgrounds/stone');
  const imp = newAdvancementJson({ id: 'm:x', parent: 'm:root', icon: 'stone', title: 'T', description: 'D', frame: 'challenge', trigger: 'impossible', version: '26.3' }) as any;
  assert.deepEqual(imp.criteria, { impossible: { trigger: 'minecraft:impossible' } });
  assert.deepEqual(criterionConditions('minecraft:recipe_crafted', 'mymod:ruby', 'mymod'), { recipe_id: 'mymod:ruby' });
  assert.deepEqual(advancementLangKeys('mymod:story/ruby'), { title: 'advancements.mymod.story.ruby.title', description: 'advancements.mymod.story.ruby.description' });
  assert.equal(backgroundTexture('minecraft:gui/advancements/backgrounds/nether'), 'minecraft:block/netherrack');
  assert.equal(backgroundTexture('minecraft:textures/block/dirt.png'), 'minecraft:block/dirt');
});

test('text components', () => {
  const lang = { 'advancements.story.root.title': 'Minecraft', 'chat.square_brackets': '[%s]' };
  assert.equal(plainText({ translate: 'advancements.story.root.title' }, lang), 'Minecraft');
  assert.equal(plainText({ translate: 'chat.square_brackets', with: [{ text: 'x' }] }, lang), '[x]');
  assert.equal(plainText('{"text":"a","extra":[{"text":"b"}]}'), 'ab');
  assert.equal(plainText(['a', { text: 'b', color: 'red' }]), 'ab');
  assert.deepEqual(textRuns({ text: 'a', color: 'red', extra: [{ text: 'b', bold: true }] }), [
    { text: 'a', color: 'red' },
    { text: 'b', color: 'red', bold: true },
  ]);
  assert.equal(plainText({ translate: 'missing.key', fallback: 'Fallback' }), 'Fallback');
  assert.deepEqual([...translationKeys({ translate: 'a', with: [{ translate: 'b' }] })], ['a', 'b']);
});
