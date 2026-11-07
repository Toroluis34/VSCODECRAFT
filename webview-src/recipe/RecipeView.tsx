// Minecraft-GUI style rendering of any recipe model. Used by the recipe editor/preview and the recipe browser.
import type { ComponentChildren, JSX } from 'preact';
import { ItemIcon, Slot, useName } from '../shared/components';
import { t } from '../shared/i18n';
import type { Ingredient, RecipeFormat, RecipeModel, ResultStack, SlotInfo } from '../../src/features/recipes/recipeModel';
import { pathRef } from '../../src/features/recipes/recipeModel';

export interface ViewHandlers {
  editable: boolean;
  selected?: string;
  unknown?: Set<string>;
  onSelect?(ref: string): void;
  onDrop?(ref: string, id: string): void;
  onContext?(ref: string, e: MouseEvent): void;
}

export const resultRef = (r: ResultStack): string => `result:${JSON.stringify(r.path)}`;

/** Descriptions of the hard-coded "special" crafting recipes. */
export const SPECIAL_INFO: Record<string, { text: string; icon: string }> = {
  'minecraft:crafting_special_armordye': { text: 'Dyes leather armor (and other dyeable items) with one or more dyes.', icon: 'minecraft:leather_chestplate' },
  'minecraft:crafting_special_bannerduplicate': { text: 'Copies the patterns of a banner onto a blank banner of the same color.', icon: 'minecraft:white_banner' },
  'minecraft:crafting_special_bookcloning': { text: 'Copies a written book using a book and quill.', icon: 'minecraft:written_book' },
  'minecraft:crafting_special_firework_rocket': { text: 'Paper + gunpowder (1–3) + optional firework stars make firework rockets.', icon: 'minecraft:firework_rocket' },
  'minecraft:crafting_special_firework_star': { text: 'Gunpowder + dyes + optional shape and effect ingredients make a firework star.', icon: 'minecraft:firework_star' },
  'minecraft:crafting_special_firework_star_fade': { text: 'Adds fade colors to a firework star.', icon: 'minecraft:firework_star' },
  'minecraft:crafting_special_mapcloning': { text: 'Copies a filled map using empty maps.', icon: 'minecraft:filled_map' },
  'minecraft:crafting_special_mapextending': { text: 'Zooms out a map by surrounding it with paper.', icon: 'minecraft:map' },
  'minecraft:crafting_special_repairitem': { text: 'Combines two damaged items of the same kind into one repaired item.', icon: 'minecraft:iron_pickaxe' },
  'minecraft:crafting_special_shielddecoration': { text: 'Applies a banner pattern to a shield.', icon: 'minecraft:shield' },
  'minecraft:crafting_special_shulkerboxcoloring': { text: 'Dyes a shulker box keeping its contents.', icon: 'minecraft:purple_shulker_box' },
  'minecraft:crafting_special_suspiciousstew': { text: 'Mushrooms + bowl + a flower make suspicious stew with an effect.', icon: 'minecraft:suspicious_stew' },
  'minecraft:crafting_special_tippedarrow': { text: '8 arrows around a lingering potion make tipped arrows.', icon: 'minecraft:tipped_arrow' },
};

export const GUI_TITLES: Record<string, string> = {
  shaped: 'Crafting',
  shapeless: 'Crafting',
  transmute: 'Crafting',
  dye: 'Crafting',
  imbue: 'Crafting',
  decorated_pot: 'Crafting',
  special: 'Crafting',
  stonecutting: 'Stonecutter',
  smithing_transform: 'Smithing Table',
  smithing_trim: 'Smithing Table',
  brewing: 'Brewing Stand',
  generic: 'Recipe',
};

const FIELD_LABELS: Record<string, string> = {
  ingredient: 'Ingredient', ingredients: 'Ingredient', input: 'Input', material: 'Material', template: 'Template', base: 'Base',
  addition: 'Addition', dye: 'Dye', target: 'Target', source: 'Source', reagent: 'Reagent', output: 'Output', result: 'Result',
  banner: 'Banner', fuel: 'Fuel', shell: 'Shell', star: 'Star', trail: 'Trail', twinkle: 'Twinkle', map: 'Map',
  front: 'Front', back: 'Back', left: 'Left', right: 'Right',
};

/** Translated label for a json field name ("shapes.burst" -> "Shape: burst"). */
export function fieldLabel(name: string): string {
  if (name.startsWith('shapes.')) return `${t('Shape')}: ${name.slice(7)}`;
  return FIELD_LABELS[name] ? t(FIELD_LABELS[name]) : name;
}

export const CATEGORY_LABELS: Record<string, string> = {
  building: 'Building blocks', redstone: 'Redstone', equipment: 'Equipment', misc: 'Miscellaneous', food: 'Food', blocks: 'Blocks',
};

const COOKING_TITLES: Record<string, string> = {
  'minecraft:smelting': 'Furnace',
  'minecraft:blasting': 'Blast Furnace',
  'minecraft:smoking': 'Smoker',
  'minecraft:campfire_cooking': 'Campfire',
};

function ingredientTooltip(ing: Ingredient | null | undefined, label?: string): string {
  const lines: string[] = [];
  if (label) lines.push(fieldLabel(label));
  if (!ing || ing.kind === 'empty') {
    lines.push(t('Empty'));
    return lines.join('\n');
  }
  if (ing.customType) lines.push(`${t('Custom ingredient')}: ${ing.customType}`);
  for (const id of ing.ids.slice(0, 12)) lines.push(id.startsWith('#') ? `${t('Tag')}: ${id}` : id);
  if (ing.ids.length > 12) lines.push(t('…and {0} more', ing.ids.length - 12));
  if (ing.excluded?.length) lines.push(`${t('Except')}: ${ing.excluded.join(', ')}`);
  if (ing.label) lines.push(ing.label);
  if (ing.count) lines.push(`${t('Count')}: ${ing.count}`);
  return lines.join('\n');
}

export function ISlot(p: { refId: string; ing: Ingredient | null | undefined; h: ViewHandlers; label?: string; off?: boolean; size?: number }): JSX.Element {
  const { h, ing, refId } = p;
  const ids = ing && ing.ids.length ? ing.ids : undefined;
  const bad = !!ids?.some((i) => h.unknown?.has(i));
  const interactive = !p.off && !!refId;
  return (
    <div class={`rc-slot-wrap ${p.off ? 'rc-slot-off' : ''}`}>
      <Slot
        id={ids}
        size={p.size}
        count={ing?.count && ing.count > 1 ? ing.count : undefined}
        selected={interactive && h.selected === refId}
        title={ingredientTooltip(ing, p.label)}
        draggable={h.editable && interactive}
        onClick={interactive ? () => h.onSelect?.(refId) : undefined}
        onContextMenu={
          interactive
            ? (e) => {
                e.preventDefault();
                h.onContext?.(refId, e);
              }
            : undefined
        }
        onDropItem={h.editable && interactive ? (id) => h.onDrop?.(refId, id) : undefined}
      >
        {ing?.kind === 'custom' ? <span class="rc-custom-badge">⚙</span> : null}
        {ing?.kind === 'invalid' ? <span class="rc-custom-badge">?</span> : null}
        {bad ? <span class="rc-bad" /> : null}
      </Slot>
      {p.label ? <div class="rc-slot-label" title={fieldLabel(p.label)}>{fieldLabel(p.label)}</div> : null}
    </div>
  );
}

export function ResultSlot({ r, h, label, idsOverride }: { r: ResultStack | undefined; h: ViewHandlers; label?: string; idsOverride?: string[] }): JSX.Element {
  const ref = r ? resultRef(r) : 'result:["result"]';
  const name = useName(r?.id);
  const tip = r
    ? [name, r.id, r.count > 1 ? `×${r.count}` : '', r.components ? `${t('Components')}: ${Object.keys(r.components).join(', ')}` : '', r.chance !== undefined ? `${t('Chance')}: ${Math.round(r.chance * 100)}%` : '', r.label ?? '']
        .filter(Boolean)
        .join('\n')
    : t('No result');
  return (
    <div class="rc-slot-wrap">
      <Slot
        large
        id={idsOverride ?? r?.id}
        count={r?.count}
        selected={h.selected === ref}
        title={tip}
        onClick={() => h.onSelect?.(ref)}
        onContextMenu={(e) => {
          e.preventDefault();
          h.onContext?.(ref, e);
        }}
        onDropItem={h.editable ? (id) => h.onDrop?.(ref, id) : undefined}
      >
        {r?.components ? <span class="rc-comp-badge">✦</span> : null}
        {r?.id && h.unknown?.has(r.id) ? <span class="rc-bad" /> : null}
      </Slot>
      {r?.chance !== undefined ? <div class="rc-chance">{Math.round(r.chance * 100)}%</div> : null}
      {label ? <div class="rc-slot-label">{fieldLabel(label)}</div> : null}
    </div>
  );
}

function Arrow({ text, sub }: { text?: string; sub?: JSX.Element | string }): JSX.Element {
  return (
    <div class="rc-arrow-wrap">
      {text ? <span>{text}</span> : <span>&nbsp;</span>}
      <div class="mc-arrow" />
      {sub ? <span>{sub}</span> : <span>&nbsp;</span>}
    </div>
  );
}

function Gui({ title, children, note, badge }: { title: string; children: JSX.Element | JSX.Element[]; note?: string; badge?: JSX.Element }): JSX.Element {
  return (
    <div class="mc-gui rc-gui">
      <div class="mc-gui-title">
        {t(title)}
        {badge}
      </div>
      {children}
      {note ? <div class="rc-note">{note}</div> : null}
    </div>
  );
}

type Cell = { ref: string; ing: Ingredient | null | undefined; off?: boolean; label?: string };

function Grid({ cells, cols, h }: { cells: Cell[]; cols: number; h: ViewHandlers }): JSX.Element {
  return (
    <div class="rc-grid" style={{ gridTemplateColumns: `repeat(${cols}, 36px)` }}>
      {cells.map((c, i) => (
        <ISlot key={i} refId={c.ref} ing={c.ing} h={h} off={c.off} />
      ))}
    </div>
  );
}

const field = (m: RecipeModel, name: string): SlotInfo | undefined => m.slots.find((s) => s.ref === pathRef([name]));

/** Main entry: draws the right GUI for the model's kind. */
export function RecipeView({ model, h }: { model: RecipeModel; fmt?: RecipeFormat; h: ViewHandlers }): JSX.Element {
  const r = model.results[0];
  switch (model.kind) {
    case 'shaped': {
      const g = model.grid!;
      const W = Math.max(3, g.width);
      const H = Math.max(3, g.height);
      const cells: Cell[] = [];
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) cells.push({ ref: `grid:${y}:${x}`, ing: g.cells[y]?.[x] ?? null });
      return (
        <Gui title="Crafting" note={g.width && g.height ? t('Pattern {0}×{1}', g.width, g.height) : undefined}>
          <div class="rc-row">
            <Grid cells={cells} cols={W} h={h} />
            <Arrow />
            <ResultSlot r={r} h={h} />
          </div>
        </Gui>
      );
    }
    case 'shapeless': {
      const n = Math.max(9, Math.ceil((model.slots.length + (h.editable ? 1 : 0)) / 3) * 3);
      const cells: Cell[] = [];
      for (let i = 0; i < n; i++) {
        const s = model.slots[i];
        cells.push({ ref: i <= model.slots.length ? `ing:${i}` : '', ing: s?.ingredient ?? null, off: i > model.slots.length });
      }
      return (
        <Gui title="Crafting" badge={<span class="rc-shapeless" title={t('Shapeless: ingredients can go anywhere')}>⇄ {t('Shapeless')}</span>}>
          <div class="rc-row">
            <Grid cells={cells.map((c) => ({ ...c, off: false, ref: c.ref || `ing:${model.slots.length}` }))} cols={3} h={h} />
            <Arrow />
            <ResultSlot r={r} h={h} />
          </div>
        </Gui>
      );
    }
    case 'transmute':
    case 'dye': {
      const [a, b] = model.kind === 'transmute' ? ['input', 'material'] : ['target', 'dye'];
      const fa = field(model, a);
      const fb = field(model, b);
      const cells: Cell[] = [
        { ref: pathRef([a]), ing: fa?.ingredient, label: a },
        { ref: pathRef([b]), ing: fb?.ingredient, label: b },
      ];
      return (
        <Gui
          title="Crafting"
          badge={<span class="rc-shapeless">⇄ {model.kind === 'transmute' ? t('Transmute') : t('Dye')}</span>}
          note={model.kind === 'transmute' ? t('The result keeps the components (contents, enchantments…) of the input item.') : t('Any number of dyes can be combined with the target item.')}
        >
          <div class="rc-row">
            {cells.map((c) => (
              <ISlot refId={c.ref} ing={c.ing} h={h} label={c.label} />
            ))}
            <Arrow />
            <ResultSlot r={r} h={h} />
          </div>
        </Gui>
      );
    }
    case 'imbue': {
      const src = field(model, 'source');
      const mat = field(model, 'material');
      const cells: Cell[] = [];
      for (let i = 0; i < 9; i++) cells.push(i === 4 ? { ref: pathRef(['source']), ing: src?.ingredient } : { ref: pathRef(['material']), ing: mat?.ingredient });
      return (
        <Gui title="Crafting" badge={<span class="rc-shapeless">⇄ {t('Imbue')}</span>} note={t('The source item’s potion contents are applied to the result.')}>
          <div class="rc-row">
            <Grid cells={cells} cols={3} h={h} />
            <Arrow />
            <ResultSlot r={r} h={h} />
          </div>
        </Gui>
      );
    }
    case 'decorated_pot': {
      const pos: Record<number, string> = { 1: 'back', 3: 'left', 5: 'right', 7: 'front' };
      const implicit: Ingredient = { kind: 'tag', ids: ['#minecraft:decorated_pot_ingredients'], raw: null };
      const cells: Cell[] = [];
      for (let i = 0; i < 9; i++) {
        const name = pos[i];
        if (!name) cells.push({ ref: '', ing: null, off: true });
        else {
          const f = field(model, name);
          cells.push(f ? { ref: f.ref, ing: f.ingredient } : { ref: '', ing: implicit });
        }
      }
      return (
        <Gui title="Crafting" note={t('Back, left, right and front faces of the pot.')}>
          <div class="rc-row">
            <Grid cells={cells} cols={3} h={h} />
            <Arrow />
            <ResultSlot r={r ?? { id: 'minecraft:decorated_pot', count: 1, path: ['result'], raw: null }} h={h} />
          </div>
        </Gui>
      );
    }
    case 'cooking': {
      const s = model.slots[0];
      const time = model.cooking?.time ?? model.cooking?.defaultTime ?? 200;
      const campfire = model.type === 'minecraft:campfire_cooking';
      return (
        <Gui title={COOKING_TITLES[model.type] ?? 'Furnace'}>
          <div class="rc-row">
            <div class="rc-col">
              <ISlot refId={s?.ref ?? pathRef(['ingredient'])} ing={s?.ingredient} h={h} />
              <div class="mc-flame" title={campfire ? t('Campfire') : t('Fuel')} />
              {campfire ? <ItemIcon id="minecraft:campfire" size={28} /> : <Slot id="#minecraft:coals" title={t('Fuel')} />}
            </div>
            <Arrow text={t('{0} s', +(time / 20).toFixed(2))} sub={<span class="rc-xp">{t('{0} XP', model.cooking?.xp ?? 0)}</span>} />
            <ResultSlot r={r} h={h} />
          </div>
        </Gui>
      );
    }
    case 'stonecutting': {
      const s = model.slots[0];
      return (
        <Gui title="Stonecutter">
          <div class="rc-row">
            <ISlot refId={s.ref} ing={s.ingredient} h={h} />
            <ItemIcon id="minecraft:stonecutter" size={28} />
            <Arrow />
            <ResultSlot r={r} h={h} />
          </div>
        </Gui>
      );
    }
    case 'smithing_transform':
    case 'smithing_trim': {
      const trim = model.kind === 'smithing_trim';
      const base = field(model, 'base');
      return (
        <Gui title="Smithing Table" note={trim ? (model.trimPattern ? t('Trim pattern: {0}', model.trimPattern) : t('Applies an armor trim to the base item.')) : t('Copies the components of the base item to the result.')}>
          <div class="rc-row">
            {['template', 'base', 'addition'].map((n) => {
              const f = field(model, n);
              return <ISlot refId={pathRef([n])} ing={f?.ingredient} h={h} label={n} />;
            })}
            <Arrow />
            {trim ? (
              <div class="rc-slot-wrap">
                <Slot large id={base?.ingredient?.ids} title={t('Trimmed base item')} />
                <div class="rc-trim-label">{t('trimmed')}</div>
              </div>
            ) : (
              <ResultSlot r={r} h={h} />
            )}
          </div>
        </Gui>
      );
    }
    case 'brewing': {
      const input = model.slots.find((s) => s.ref === 'brew:input');
      const reagent = model.slots.find((s) => s.ref === 'brew:reagent');
      return (
        <Gui title="Brewing Stand">
          <div class="rc-row">
            <div class="rc-col">
              <ISlot refId="brew:reagent" ing={reagent?.ingredient} h={h} label="reagent" />
              <div class="mc-arrow rc-arrow-down" />
              <ISlot refId="brew:input" ing={input?.ingredient} h={h} label="input" />
              {model.brewing?.inputPotion ? <div class="rc-potion">{model.brewing.inputPotion.replace('minecraft:', '')}</div> : null}
            </div>
            <Arrow />
            <div class="rc-col">
              <ResultSlot r={r} h={h} label="output" />
              {model.brewing?.outputPotion ? <div class="rc-potion">{model.brewing.outputPotion.replace('minecraft:', '')}</div> : null}
            </div>
          </div>
        </Gui>
      );
    }
    case 'special':
    case 'generic':
    default:
      return <GenericView model={model} h={h} />;
  }
}

function GenericView({ model, h }: { model: RecipeModel; h: ViewHandlers }): JSX.Element {
  const info = SPECIAL_INFO[model.type];
  const hasGrid = !!model.grid;
  const parts: JSX.Element[] = [];
  if (info) {
    parts.push(
      <div class="mc-card rc-special">
        <ItemIcon id={info.icon} size={40} />
        <div>
          <strong>{t('Special recipe')}</strong> <code>{model.type}</code>
          <p>{t(info.text)}</p>
          {!model.slots.length ? <p class="mc-muted">{t('Its logic is hard-coded in the game: only the type (and category) can be configured.')}</p> : null}
        </div>
      </div>,
    );
  } else if (model.kind === 'special') {
    parts.push(
      <div class="mc-card rc-special">
        <div>
          <strong>{t('Special recipe')}</strong> <code>{model.type}</code>
          <p class="mc-muted">{t('Its logic is hard-coded in the game.')}</p>
        </div>
      </div>,
    );
  }
  if (model.slots.length || model.results.length || hasGrid) {
    let gridEl: JSX.Element | null = null;
    if (hasGrid) {
      const g = model.grid!;
      const cells: Cell[] = [];
      for (let y = 0; y < g.height; y++) for (let x = 0; x < g.width; x++) cells.push({ ref: '', ing: g.cells[y]?.[x] ?? null });
      gridEl = <Grid cells={cells} cols={Math.max(1, g.width)} h={{ ...h, editable: false }} />;
    }
    parts.push(
      <Gui title={model.kind === 'special' ? 'Crafting' : GUI_TITLES.generic} badge={model.kind === 'generic' ? <code class="mc-muted">{model.type}</code> : undefined}>
        <div class="rc-row">
          {gridEl}
          {model.slots.length ? (
            <div class="rc-generic-ings">
              {model.slots.map((s) => (
                <ISlot refId={s.ref} ing={s.ingredient} h={h} label={s.label} />
              ))}
            </div>
          ) : null}
          {model.results.length ? (
            <>
              <Arrow />
              <div class="rc-results">
                {model.results.map((r) => (
                  <ResultSlot r={r} h={h} />
                ))}
              </div>
            </>
          ) : null}
        </div>
      </Gui>,
    );
  }
  if (model.kind === 'generic' && model.properties.length) {
    parts.push(
      <div class="mc-card">
        <div class="rc-section-title">{t('Other properties')}</div>
        <table class="mc-table">
          <tbody>
            {model.properties.map((p) => (
              <tr>
                <td class="mono">{p.key}</td>
                <td class="mono">{typeof p.value === 'object' ? JSON.stringify(p.value) : String(p.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>,
    );
  }
  if (!parts.length) parts.push(<div class="mc-muted">{t('Nothing to display for this recipe type.')}</div>);
  return <div class="mc-col">{parts}</div>;
}

export function Btn(p: { onClick?: () => void; disabled?: boolean; title?: string; secondary?: boolean; children: ComponentChildren }): JSX.Element {
  return (
    <button class={`mc-button ${p.secondary ? 'secondary' : ''}`} onClick={p.onClick} disabled={p.disabled} title={p.title}>
      {p.children}
    </button>
  );
}

