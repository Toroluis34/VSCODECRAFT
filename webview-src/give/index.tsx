// Give / Item Builder: data components editor with live tooltip preview and command / JSON outputs.
import { render } from 'preact';
import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { boot, call, onEvent } from '../shared/vscode';
import { t } from '../shared/i18n';
import { ItemPicker, Slot, useName } from '../shared/components';
import {
  buildComponents,
  componentFlags,
  giveCommand,
  hexColor,
  lootEntryJson,
  MC_COLORS,
  parseHexColor,
  recipeResultJson,
  setComponentsFunction,
  summonCommand,
  tooltipLines,
  type AttributeOperation,
  type EffectSpec,
  type FireworkExplosionSpec,
  type ItemSpec,
  type TextSpec,
} from '../../src/features/loot/components';
import type { GiveData, GiveViewState } from '../../src/features/loot/protocol';
import { injectStyle, Runs, SHARED_CSS } from '../lootShared/ui';

injectStyle('lt-shared', SHARED_CSS);
injectStyle(
  'give',
  `
body { padding: 10px 14px 30px; }
.gv { display: grid; grid-template-columns: minmax(380px, 1fr) minmax(340px, 460px); gap: 14px; align-items: start; }
.gv-right { position: sticky; top: 8px; display: flex; flex-direction: column; gap: 10px; }
.gv details { margin-bottom: 8px; }
.gv summary { cursor: pointer; font-weight: 600; padding: 2px 0; }
.gv summary .mc-badge { margin-left: 6px; font-weight: normal; }
.gv .sec { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
.gv .row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.gv .row > label { display: inline-flex; gap: 4px; align-items: center; font-size: 12px; }
.gv input.mc-input[type=number] { width: 70px; }
.gv .wide { flex: 1 1 160px; min-width: 120px; }
.gv .x { margin-left: auto; }
.gv-out textarea { width: 100%; min-height: 90px; font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; resize: vertical; }
.gv-preview { display: flex; gap: 14px; align-items: flex-start; }
.gv-warn { font-size: 12px; }
.gv-sw { width: 18px; height: 18px; border: 1px solid #000; border-radius: 2px; display: inline-block; }
.gv input[type=color] { width: 30px; height: 24px; padding: 0; border: none; background: none; }
@media (max-width: 860px) { .gv { grid-template-columns: 1fr; } .gv-right { position: static; } }
`,
);

const st = boot<GiveViewState>().state ?? { version: '26.3', versions: ['26.3'], namespace: 'mymod', item: 'minecraft:diamond_sword' };

const SLOTS = ['any', 'mainhand', 'offhand', 'hand', 'head', 'chest', 'legs', 'feet', 'armor', 'body', 'saddle'];
const OPS: AttributeOperation[] = ['add_value', 'add_multiplied_base', 'add_multiplied_total'];
const SHAPES: FireworkExplosionSpec['shape'][] = ['small_ball', 'large_ball', 'star', 'creeper', 'burst'];
const ANIMATIONS = ['eat', 'drink', 'block', 'bow', 'spear', 'crossbow', 'spyglass', 'toot_horn', 'brush', 'bundle', 'none'];
const HIDEABLE = [
  'minecraft:enchantments',
  'minecraft:stored_enchantments',
  'minecraft:attribute_modifiers',
  'minecraft:unbreakable',
  'minecraft:dyed_color',
  'minecraft:trim',
  'minecraft:potion_contents',
  'minecraft:fireworks',
  'minecraft:lore',
];

type Out = 'give' | 'summon' | 'loot' | 'set_components' | 'recipe';

const num = (e: Event) => {
  const v = (e.target as HTMLInputElement).value;
  return v === '' ? undefined : Number(v);
};
const str = (e: Event) => (e.target as HTMLInputElement).value;
const short = (id: string) => id.replace(/^minecraft:/, '');

function Sel({ value, options, onChange, empty, class: cls }: { value?: string; options: string[]; onChange: (v: string) => void; empty?: string; class?: string }): JSX.Element {
  return (
    <select class={`mc-select ${cls ?? ''}`} value={value ?? ''} onChange={(e) => onChange((e.target as HTMLSelectElement).value)}>
      {empty !== undefined ? <option value="">{empty}</option> : null}
      {options.map((o) => (
        <option value={o}>{short(o)}</option>
      ))}
    </select>
  );
}

function Section({ title, active, children, open }: { title: string; active?: boolean; children: ComponentChildren; open?: boolean }): JSX.Element {
  return (
    <details class="mc-card" open={open || active}>
      <summary>
        {title}
        {active ? <span class="mc-badge">{t('set')}</span> : null}
      </summary>
      <div class="sec">{children}</div>
    </details>
  );
}

function TextEditor({ value, onChange, placeholder }: { value?: TextSpec; onChange: (v: TextSpec | undefined) => void; placeholder?: string }): JSX.Element {
  const v = value ?? { text: '' };
  const set = (p: Partial<TextSpec>) => {
    const n = { ...v, ...p };
    onChange(n.text === '' && !value ? undefined : n);
  };
  const toggle = (k: 'bold' | 'italic' | 'underlined' | 'strikethrough' | 'obfuscated', label: string, title: string) => (
    <label title={title}>
      <input type="checkbox" checked={k === 'italic' ? v.italic !== false : !!v[k]} onChange={(e) => set({ [k]: (e.target as HTMLInputElement).checked })} />
      {label}
    </label>
  );
  const isHex = v.color?.startsWith('#');
  return (
    <div class="row">
      <input class="mc-input wide" value={v.text} placeholder={placeholder} onInput={(e) => set({ text: str(e) })} />
      <select class="mc-select" value={isHex ? '#' : (v.color ?? '')} onChange={(e) => {
        const c = (e.target as HTMLSelectElement).value;
        set({ color: c === '' ? undefined : c === '#' ? '#ff8800' : c });
      }}>
        <option value="">{t('default colour')}</option>
        {Object.keys(MC_COLORS).map((c) => (
          <option value={c} style={{ color: MC_COLORS[c] }}>
            {c}
          </option>
        ))}
        <option value="#">{t('custom…')}</option>
      </select>
      {isHex ? <input type="color" value={v.color} onInput={(e) => set({ color: str(e) })} /> : null}
      {toggle('bold', 'B', t('Bold'))}
      {toggle('italic', 'I', t('Italic'))}
      {toggle('underlined', 'U', t('Underlined'))}
      {toggle('strikethrough', 'S', t('Strikethrough'))}
      {toggle('obfuscated', '?', t('Obfuscated'))}
    </div>
  );
}

function EffectsEditor({ list, onChange, effects, withChance }: { list: EffectSpec[]; onChange: (l: EffectSpec[]) => void; effects: string[]; withChance?: boolean }): JSX.Element {
  const upd = (i: number, p: Partial<EffectSpec>) => onChange(list.map((e, j) => (j === i ? { ...e, ...p } : e)));
  return (
    <div class="sec">
      {list.map((e, i) => (
        <div class="row" key={i}>
          <Sel value={e.id} options={effects} onChange={(id) => upd(i, { id })} class="wide" />
          <label>
            {t('Level')}
            <input class="mc-input" type="number" min={1} max={256} value={e.amplifier + 1} onInput={(ev) => upd(i, { amplifier: Math.max(0, (num(ev) ?? 1) - 1) })} />
          </label>
          <label>
            {t('Seconds')}
            <input class="mc-input" type="number" min={0} value={Math.round(e.duration / 20)} onInput={(ev) => upd(i, { duration: (num(ev) ?? 0) * 20 })} />
          </label>
          {withChance ? (
            <label>
              %
              <input class="mc-input" type="number" min={0} max={100} value={Math.round((e.probability ?? 1) * 100)} onInput={(ev) => upd(i, { probability: (num(ev) ?? 100) / 100 })} />
            </label>
          ) : null}
          <button class="mc-icon-button x" onClick={() => onChange(list.filter((_, j) => j !== i))}>
            ✕
          </button>
        </div>
      ))}
      <div>
        <button class="mc-button secondary" onClick={() => onChange([...list, { id: effects[0] ?? 'minecraft:speed', amplifier: 0, duration: 600, probability: 1 }])}>
          + {t('Add effect')}
        </button>
      </div>
    </div>
  );
}

function ColorList({ colors, onChange }: { colors: number[]; onChange: (c: number[]) => void }): JSX.Element {
  return (
    <span class="row">
      {colors.map((c, i) => (
        <span key={i} class="row" style={{ gap: '2px' }}>
          <input type="color" value={hexColor(c)} onInput={(e) => onChange(colors.map((x, j) => (j === i ? (parseHexColor(str(e)) ?? x) : x)))} />
          <button class="mc-icon-button" onClick={() => onChange(colors.filter((_, j) => j !== i))}>
            ✕
          </button>
        </span>
      ))}
      <button class="mc-icon-button" title={t('Add colour')} onClick={() => onChange([...colors, 0xff0000])}>
        +
      </button>
    </span>
  );
}

function App(): JSX.Element {
  const [version, setVersion] = useState(st.version);
  const [spec, setSpec] = useState<ItemSpec>({ id: st.item, count: 1, namespace: st.namespace });
  const [data, setData] = useState<GiveData>({ registries: {}, lang: {} });
  const [defaults, setDefaults] = useState<Record<string, any>>({});
  const [picking, setPicking] = useState(false);
  const [out, setOut] = useState<Out>('give');
  const [target, setTarget] = useState('@p');
  const [advanced, setAdvanced] = useState(true);
  const name = useName(spec.id);
  const fl = componentFlags(version);

  useEffect(() => {
    void call<GiveData>('give.data', { version }).then(setData).catch(() => undefined);
  }, [version]);
  useEffect(() => {
    void call<Record<string, any>>('give.defaults', { id: spec.id, version }).then(setDefaults).catch(() => setDefaults({}));
  }, [spec.id, version]);
  useEffect(() => onEvent<string>('give.setItem', (id) => setSpec((s) => ({ ...s, id }))), []);

  const set = (p: Partial<ItemSpec>) => setSpec((s) => ({ ...s, ...p }));
  const reg = (r: string) => data.registries[r] ?? [];
  const { warnings } = useMemo(() => buildComponents(spec, version), [spec, version]);
  const output = useMemo(() => {
    if (out === 'give') return giveCommand(spec, version, target);
    if (out === 'summon') return summonCommand(spec, version);
    if (out === 'loot') return JSON.stringify(lootEntryJson(spec, version), null, 2);
    if (out === 'set_components') return JSON.stringify(setComponentsFunction(spec, version), null, 2);
    return JSON.stringify(recipeResultJson(spec, version), null, 2);
  }, [spec, version, out, target]);
  const lines = useMemo(
    () => tooltipLines(spec, version, { lang: data.lang, itemName: name || short(spec.id), defaults, advanced }),
    [spec, version, data.lang, name, defaults, advanced],
  );

  const ench = spec.enchantments ?? [];
  const attrs = spec.attributes ?? [];
  const lore = spec.lore ?? [];
  const cmd = spec.customModelData ?? {};
  const food = spec.food;
  const tool = spec.tool;
  const potion = spec.potion ?? {};
  const fw = spec.fireworks;
  const hidden = new Set(spec.hiddenComponents ?? []);
  const csv = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

  return (
    <div class="gv">
      <div>
        <Section title={t('Item')} open>
          <div class="row">
            <Slot id={spec.id} size={44} large count={spec.count} onClick={() => setPicking(!picking)} onDropItem={(id) => set({ id })} title={t('Click to choose an item')} />
            <div class="mc-col" style={{ gap: '2px' }}>
              <b>{name || short(spec.id)}</b>
              <code class="mc-muted">{spec.id}</code>
            </div>
            <label>
              {t('Count')}
              <input class="mc-input" type="number" min={1} max={99} value={spec.count} onInput={(e) => set({ count: num(e) ?? 1 })} />
            </label>
            <button class="mc-button secondary" onClick={() => setPicking(!picking)}>
              {t('Change item…')}
            </button>
          </div>
          {picking ? (
            <ItemPicker
              autoFocus
              onPick={(id) => {
                if (id.startsWith('#')) return;
                set({ id });
                setPicking(false);
              }}
            />
          ) : null}
        </Section>

        <Section title={t('Name & lore')} active={!!spec.customName || lore.length > 0}>
          <span class="mc-muted">{t('Custom name')}</span>
          <TextEditor value={spec.customName} placeholder={t('Custom name')} onChange={(v) => set({ customName: v })} />
          <span class="mc-muted">{t('Lore lines')}</span>
          {lore.map((l, i) => (
            <div class="row" key={i}>
              <div class="wide">
                <TextEditor value={l} onChange={(v) => set({ lore: lore.map((x, j) => (j === i ? (v ?? { text: '' }) : x)) })} />
              </div>
              <button class="mc-icon-button" onClick={() => set({ lore: lore.filter((_, j) => j !== i) })}>
                ✕
              </button>
            </div>
          ))}
          <div>
            <button class="mc-button secondary" onClick={() => set({ lore: [...lore, { text: '', color: 'gray', italic: false }] })}>
              + {t('Add lore line')}
            </button>
          </div>
        </Section>

        <Section title={t('Enchantments')} active={ench.length > 0 || spec.glint !== undefined}>
          {ench.map((e, i) => (
            <div class="row" key={i}>
              <Sel value={e.id} options={reg('enchantment')} onChange={(id) => set({ enchantments: ench.map((x, j) => (j === i ? { ...x, id } : x)) })} class="wide" />
              <label>
                {t('Level')}
                <input class="mc-input" type="number" min={1} max={255} value={e.level} onInput={(ev) => set({ enchantments: ench.map((x, j) => (j === i ? { ...x, level: num(ev) ?? 1 } : x)) })} />
              </label>
              <button class="mc-icon-button x" onClick={() => set({ enchantments: ench.filter((_, j) => j !== i) })}>
                ✕
              </button>
            </div>
          ))}
          <div class="row">
            <button class="mc-button secondary" onClick={() => set({ enchantments: [...ench, { id: reg('enchantment').find((x) => x.endsWith('sharpness')) ?? reg('enchantment')[0] ?? 'minecraft:sharpness', level: 1 }] })}>
              + {t('Add enchantment')}
            </button>
            <label title="enchantment_glint_override">
              {t('Glint')}
              <select class="mc-select" value={spec.glint === undefined ? '' : String(spec.glint)} onChange={(e) => {
                const v = (e.target as HTMLSelectElement).value;
                set({ glint: v === '' ? undefined : v === 'true' });
              }}>
                <option value="">{t('default')}</option>
                <option value="true">{t('always')}</option>
                <option value="false">{t('never')}</option>
              </select>
            </label>
          </div>
        </Section>

        <Section title={t('Durability & stacking')} active={spec.unbreakable || spec.maxDamage !== undefined || spec.damage !== undefined || spec.maxStackSize !== undefined || !!spec.rarity}>
          <div class="row">
            <label>
              <input type="checkbox" checked={!!spec.unbreakable} onChange={(e) => set({ unbreakable: (e.target as HTMLInputElement).checked || undefined })} /> {t('Unbreakable')}
            </label>
            <label>
              max_damage
              <input class="mc-input" type="number" min={1} value={spec.maxDamage ?? ''} placeholder={String(defaults['minecraft:max_damage'] ?? '')} onInput={(e) => set({ maxDamage: num(e) })} />
            </label>
            <label>
              damage
              <input class="mc-input" type="number" min={0} value={spec.damage ?? ''} onInput={(e) => set({ damage: num(e) })} />
            </label>
            <label>
              max_stack_size
              <input class="mc-input" type="number" min={1} max={99} value={spec.maxStackSize ?? ''} placeholder={String(defaults['minecraft:max_stack_size'] ?? '')} onInput={(e) => set({ maxStackSize: num(e) })} />
            </label>
            <label>
              {t('Rarity')}
              <Sel value={spec.rarity} options={['common', 'uncommon', 'rare', 'epic']} empty={t('default')} onChange={(v) => set({ rarity: (v || undefined) as ItemSpec['rarity'] })} />
            </label>
          </div>
        </Section>

        <Section title={t('Model & appearance')} active={!!spec.itemModel || !!cmd.floats?.length || !!cmd.flags?.length || !!cmd.strings?.length || !!cmd.colors?.length || spec.dyedColor !== undefined || !!spec.trim}>
          <div class="row">
            <label class="wide" title={fl.itemModel ? '' : t('Requires 1.21.2+')}>
              item_model
              <input class="mc-input wide" value={spec.itemModel ?? ''} disabled={!fl.itemModel} placeholder={`${st.namespace}:my_model`} onInput={(e) => set({ itemModel: str(e) || undefined })} />
            </label>
          </div>
          <div class="row">
            <span class="mc-muted">custom_model_data {fl.cmdObject ? t('(1.21.4+ object)') : t('(integer before 1.21.4)')}</span>
          </div>
          <div class="row">
            <label>
              {fl.cmdObject ? 'floats' : t('value')}
              <input class="mc-input" style={{ width: '120px' }} value={(cmd.floats ?? []).join(', ')} placeholder="1, 2.5" onChange={(e) => set({ customModelData: { ...cmd, floats: csv(str(e)).map(Number).filter((n) => !Number.isNaN(n)) } })} />
            </label>
            {fl.cmdObject ? (
              <>
                <label>
                  flags
                  <input class="mc-input" style={{ width: '110px' }} value={(cmd.flags ?? []).join(', ')} placeholder="true, false" onChange={(e) => set({ customModelData: { ...cmd, flags: csv(str(e)).map((x) => x === 'true') } })} />
                </label>
                <label>
                  strings
                  <input class="mc-input" style={{ width: '120px' }} value={(cmd.strings ?? []).join(', ')} placeholder="red, big" onChange={(e) => set({ customModelData: { ...cmd, strings: csv(str(e)) } })} />
                </label>
                <label>
                  colors <ColorList colors={cmd.colors ?? []} onChange={(colors) => set({ customModelData: { ...cmd, colors } })} />
                </label>
              </>
            ) : null}
          </div>
          <div class="row">
            <label>
              <input type="checkbox" checked={spec.dyedColor !== undefined} onChange={(e) => set({ dyedColor: (e.target as HTMLInputElement).checked ? 0xa06540 : undefined })} /> dyed_color
            </label>
            {spec.dyedColor !== undefined ? <input type="color" value={hexColor(spec.dyedColor)} onInput={(e) => set({ dyedColor: parseHexColor(str(e)) })} /> : null}
            <label>
              {t('Trim')}
              <Sel value={spec.trim?.pattern} options={reg('trim_pattern')} empty={t('none')} onChange={(pattern) => set({ trim: pattern ? { material: spec.trim?.material || reg('trim_material')[0] || 'minecraft:iron', pattern } : undefined })} />
              <Sel value={spec.trim?.material} options={reg('trim_material')} empty="—" onChange={(material) => set({ trim: spec.trim ? { ...spec.trim, material } : undefined })} />
            </label>
          </div>
        </Section>

        <Section title={t('Attribute modifiers')} active={attrs.length > 0}>
          {attrs.map((a, i) => {
            const upd = (p: Partial<typeof a>) => set({ attributes: attrs.map((x, j) => (j === i ? { ...x, ...p } : x)) });
            return (
              <div class="row" key={i}>
                <Sel value={a.type} options={reg('attribute')} onChange={(type) => upd({ type })} class="wide" />
                <input class="mc-input" type="number" step="0.1" value={a.amount} onInput={(e) => upd({ amount: num(e) ?? 0 })} />
                <Sel value={a.operation} options={OPS} onChange={(v) => upd({ operation: v as AttributeOperation })} />
                <Sel value={a.slot} options={SLOTS} onChange={(slot) => upd({ slot })} />
                <button class="mc-icon-button x" onClick={() => set({ attributes: attrs.filter((_, j) => j !== i) })}>
                  ✕
                </button>
              </div>
            );
          })}
          <div>
            <button class="mc-button secondary" onClick={() => set({ attributes: [...attrs, { type: reg('attribute').find((x) => /attack_damage$/.test(x)) ?? 'minecraft:attack_damage', amount: 1, operation: 'add_value', slot: 'mainhand' }] })}>
              + {t('Add modifier')}
            </button>
          </div>
        </Section>

        <Section title={fl.consumable ? t('Food & consumable') : t('Food')} active={!!food}>
          <label>
            <input type="checkbox" checked={!!food} onChange={(e) => set({ food: (e.target as HTMLInputElement).checked ? { nutrition: 4, saturation: 2.4 } : undefined })} /> {t('Edible')}
            {fl.consumable ? <span class="mc-muted"> — {t('writes food + consumable (1.21.2+ split)')}</span> : null}
          </label>
          {food ? (
            <>
              <div class="row">
                <label>
                  nutrition
                  <input class="mc-input" type="number" min={0} value={food.nutrition} onInput={(e) => set({ food: { ...food, nutrition: num(e) ?? 0 } })} />
                </label>
                <label>
                  saturation
                  <input class="mc-input" type="number" step="0.1" value={food.saturation} onInput={(e) => set({ food: { ...food, saturation: num(e) ?? 0 } })} />
                </label>
                <label>
                  {t('Seconds to eat')}
                  <input class="mc-input" type="number" step="0.1" value={food.eatSeconds ?? 1.6} onInput={(e) => set({ food: { ...food, eatSeconds: num(e) } })} />
                </label>
                <label>
                  <input type="checkbox" checked={!!food.canAlwaysEat} onChange={(e) => set({ food: { ...food, canAlwaysEat: (e.target as HTMLInputElement).checked } })} /> can_always_eat
                </label>
              </div>
              <div class="row">
                {fl.consumable ? (
                  <label>
                    {t('Animation')}
                    <Sel value={food.animation ?? 'eat'} options={ANIMATIONS} onChange={(animation) => set({ food: { ...food, animation } })} />
                  </label>
                ) : null}
                <label>
                  {t('Leaves')}
                  <input class="mc-input" style={{ width: '160px' }} value={food.convertsTo ?? ''} placeholder="minecraft:bowl" onInput={(e) => set({ food: { ...food, convertsTo: str(e) || undefined } })} />
                </label>
              </div>
              <EffectsEditor list={food.effects ?? []} effects={reg('mob_effect')} withChance onChange={(effects) => set({ food: { ...food, effects } })} />
            </>
          ) : null}
        </Section>

        <Section title={t('Tool')} active={!!tool}>
          <label>
            <input type="checkbox" checked={!!tool} onChange={(e) => set({ tool: (e.target as HTMLInputElement).checked ? { defaultMiningSpeed: 1, damagePerBlock: 1, rules: [{ blocks: '#minecraft:mineable/pickaxe', speed: 8, correctForDrops: true }] } : undefined })} /> {t('Mining tool rules')}
          </label>
          {tool ? (
            <>
              <div class="row">
                <label>
                  default_mining_speed
                  <input class="mc-input" type="number" step="0.5" value={tool.defaultMiningSpeed ?? ''} onInput={(e) => set({ tool: { ...tool, defaultMiningSpeed: num(e) } })} />
                </label>
                <label>
                  damage_per_block
                  <input class="mc-input" type="number" min={0} value={tool.damagePerBlock ?? ''} onInput={(e) => set({ tool: { ...tool, damagePerBlock: num(e) } })} />
                </label>
              </div>
              {tool.rules.map((r, i) => {
                const upd = (p: Partial<typeof r>) => set({ tool: { ...tool, rules: tool.rules.map((x, j) => (j === i ? { ...x, ...p } : x)) } });
                return (
                  <div class="row" key={i}>
                    <input class="mc-input wide" value={r.blocks} placeholder="#minecraft:mineable/pickaxe" onInput={(e) => upd({ blocks: str(e) })} />
                    <label>
                      {t('speed')}
                      <input class="mc-input" type="number" step="0.5" value={r.speed ?? ''} onInput={(e) => upd({ speed: num(e) })} />
                    </label>
                    <label>
                      <input type="checkbox" checked={!!r.correctForDrops} onChange={(e) => upd({ correctForDrops: (e.target as HTMLInputElement).checked || undefined })} /> {t('drops')}
                    </label>
                    <button class="mc-icon-button x" onClick={() => set({ tool: { ...tool, rules: tool.rules.filter((_, j) => j !== i) } })}>
                      ✕
                    </button>
                  </div>
                );
              })}
              <div>
                <button class="mc-button secondary" onClick={() => set({ tool: { ...tool, rules: [...tool.rules, { blocks: '' }] } })}>
                  + {t('Add rule')}
                </button>
              </div>
            </>
          ) : null}
        </Section>

        <Section title={t('Potion')} active={!!potion.potion || potion.customColor !== undefined || !!potion.effects?.length}>
          <div class="row">
            <Sel value={potion.potion} options={reg('potion')} empty={t('no base potion')} onChange={(p) => set({ potion: { ...potion, potion: p || undefined } })} />
            <label>
              <input type="checkbox" checked={potion.customColor !== undefined} onChange={(e) => set({ potion: { ...potion, customColor: (e.target as HTMLInputElement).checked ? 0x3366ff : undefined } })} /> custom_color
            </label>
            {potion.customColor !== undefined ? <input type="color" value={hexColor(potion.customColor)} onInput={(e) => set({ potion: { ...potion, customColor: parseHexColor(str(e)) } })} /> : null}
          </div>
          <EffectsEditor list={potion.effects ?? []} effects={reg('mob_effect')} onChange={(effects) => set({ potion: { ...potion, effects } })} />
        </Section>

        <Section title={t('Fireworks')} active={!!fw}>
          <label>
            <input type="checkbox" checked={!!fw} onChange={(e) => set({ fireworks: (e.target as HTMLInputElement).checked ? { flightDuration: 1, explosions: [{ shape: 'large_ball', colors: [0xff0000] }] } : undefined })} />{' '}
            {spec.id.endsWith('firework_star') ? 'firework_explosion' : 'fireworks'}
          </label>
          {fw ? (
            <>
              <label>
                {t('Flight duration')}
                <input class="mc-input" type="number" min={0} max={255} value={fw.flightDuration} onInput={(e) => set({ fireworks: { ...fw, flightDuration: num(e) ?? 1 } })} />
              </label>
              {fw.explosions.map((x, i) => {
                const upd = (p: Partial<FireworkExplosionSpec>) => set({ fireworks: { ...fw, explosions: fw.explosions.map((y, j) => (j === i ? { ...y, ...p } : y)) } });
                return (
                  <div class="row" key={i}>
                    <Sel value={x.shape} options={SHAPES} onChange={(s) => upd({ shape: s as FireworkExplosionSpec['shape'] })} />
                    <ColorList colors={x.colors} onChange={(colors) => upd({ colors })} />
                    <span class="mc-muted">{t('fade')}</span>
                    <ColorList colors={x.fadeColors ?? []} onChange={(fadeColors) => upd({ fadeColors })} />
                    <label>
                      <input type="checkbox" checked={!!x.trail} onChange={(e) => upd({ trail: (e.target as HTMLInputElement).checked })} /> {t('trail')}
                    </label>
                    <label>
                      <input type="checkbox" checked={!!x.twinkle} onChange={(e) => upd({ twinkle: (e.target as HTMLInputElement).checked })} /> {t('twinkle')}
                    </label>
                    <button class="mc-icon-button x" onClick={() => set({ fireworks: { ...fw, explosions: fw.explosions.filter((_, j) => j !== i) } })}>
                      ✕
                    </button>
                  </div>
                );
              })}
              <div>
                <button class="mc-button secondary" onClick={() => set({ fireworks: { ...fw, explosions: [...fw.explosions, { shape: 'small_ball', colors: [0xffff00] }] } })}>
                  + {t('Add explosion')}
                </button>
              </div>
            </>
          ) : null}
        </Section>

        <Section title={t('Custom data (SNBT)')} active={!!spec.customData}>
          <textarea class="mc-input" rows={3} style={{ fontFamily: 'var(--vscode-editor-font-family, monospace)' }} placeholder="{mymod:{level:3b}}" value={spec.customData ?? ''} onInput={(e) => set({ customData: (e.target as HTMLTextAreaElement).value || undefined })} />
        </Section>

        <Section title={t('Tooltip')} active={!!spec.hideTooltip || hidden.size > 0}>
          <label>
            <input type="checkbox" checked={!!spec.hideTooltip} onChange={(e) => set({ hideTooltip: (e.target as HTMLInputElement).checked || undefined })} /> {t('Hide the whole tooltip')}{' '}
            <span class="mc-muted">({fl.tooltipDisplay ? 'tooltip_display' : 'hide_tooltip'})</span>
          </label>
          <span class="mc-muted">{fl.tooltipDisplay ? t('Hidden components (tooltip_display.hidden_components):') : t('Hide lines (show_in_tooltip: false / hide_additional_tooltip):')}</span>
          <div class="row">
            {HIDEABLE.filter((h) => fl.tooltipDisplay || h !== 'minecraft:lore').map((h) => (
              <label key={h}>
                <input
                  type="checkbox"
                  checked={hidden.has(h)}
                  onChange={(e) => {
                    const s = new Set(hidden);
                    if ((e.target as HTMLInputElement).checked) s.add(h);
                    else s.delete(h);
                    set({ hiddenComponents: [...s] });
                  }}
                />{' '}
                {short(h)}
              </label>
            ))}
          </div>
        </Section>
      </div>

      <div class="gv-right">
        <div class="mc-card">
          <div class="row" style={{ marginBottom: '8px' }}>
            <b>{t('Preview')}</b>
            <span class="mc-spacer" />
            <label>
              <input type="checkbox" checked={advanced} onChange={(e) => setAdvanced((e.target as HTMLInputElement).checked)} /> {t('Advanced tooltips')}
            </label>
            <label>
              Minecraft
              <select class="mc-select" value={version} onChange={(e) => setVersion((e.target as HTMLSelectElement).value)}>
                {st.versions.map((v) => (
                  <option value={v}>{v}</option>
                ))}
              </select>
            </label>
          </div>
          <div class="gv-preview">
            <Slot id={spec.id} size={56} large count={spec.count} />
            <div class="mc-tooltip-box">
              {lines.map((l, i) => (
                <div class="line" key={i}>
                  <Runs runs={l} />
                </div>
              ))}
            </div>
          </div>
        </div>
        <div class="mc-card gv-out">
          <div class="mc-tabs">
            {(
              [
                ['give', '/give'],
                ['summon', '/summon'],
                ['loot', t('Loot entry')],
                ['set_components', 'set_components'],
                ['recipe', t('Recipe result')],
              ] as [Out, string][]
            ).map(([k, label]) => (
              <button key={k} class={`mc-tab ${out === k ? 'active' : ''}`} onClick={() => setOut(k)}>
                {label}
              </button>
            ))}
          </div>
          {out === 'give' ? (
            <div class="row" style={{ marginBottom: '6px' }}>
              <label>
                {t('Target')}
                <input class="mc-input" style={{ width: '120px' }} value={target} onInput={(e) => setTarget(str(e) || '@p')} />
              </label>
              {output.length > 256 ? <span class="mc-warning gv-warn">{t('{0} characters: too long for chat, use a command block or a function.', output.length)}</span> : <span class="mc-muted gv-warn">{t('{0} characters', output.length)}</span>}
            </div>
          ) : null}
          <textarea class="mc-input" readOnly value={output} rows={out === 'give' || out === 'summon' ? 5 : 12} />
          <div class="row" style={{ marginTop: '6px' }}>
            <button class="mc-button" onClick={() => call('give.copy', { text: output })}>
              ⧉ {t('Copy')}
            </button>
            <button class="mc-button secondary" onClick={() => call('give.insert', { text: output })}>
              ⤓ {t('Insert in editor')}
            </button>
          </div>
          {warnings.map((w, i) => (
            <div class="mc-warning gv-warn" key={i}>
              ⚠ {t(w.text, ...(w.args ?? []))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

render(<App />, document.getElementById('app')!);
