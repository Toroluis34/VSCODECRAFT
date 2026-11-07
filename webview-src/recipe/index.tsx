// Recipe editor / live preview / vanilla recipe viewer.
import { render } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { boot, call, onEvent } from '../shared/vscode';
import { t } from '../shared/i18n';
import { ItemPicker, expandTag, useName, Slot } from '../shared/components';
import {
  categoriesFor,
  changeType,
  parseRecipe,
  referencedIds,
  setProperty,
  setResultCount,
  setResultId,
  setSlot,
  slotRaw,
  VANILLA_TYPES,
  type JsonPath,
  type RecipeModel,
  type SlotValue,
} from '../../src/features/recipes/recipeModel';
import type { CheckIdsResult, RecipeViewState } from '../../src/features/recipes/protocol';
import { Btn, CATEGORY_LABELS, RecipeView, resultRef, type ViewHandlers } from './RecipeView';
import { injectStyles } from './styles';

injectStyles();

const FORMAT_WARNING = /syntax|removed in|"item"|transmute result|need a "pattern"/;

interface Menu {
  ref: string;
  x: number;
  y: number;
  tags?: string[];
  typing?: boolean;
}

function findSlotIngredient(model: RecipeModel, ref: string) {
  if (ref.startsWith('grid:')) {
    const [r, c] = ref.slice(5).split(':').map(Number);
    return model.grid?.cells[r]?.[c] ?? null;
  }
  return model.slots.find((s) => s.ref === ref)?.ingredient ?? null;
}

function firstEmptyRef(model: RecipeModel): string | undefined {
  if (model.kind === 'shaped') {
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) if (!model.grid?.cells[r]?.[c]) return `grid:${r}:${c}`;
    return undefined;
  }
  if (model.kind === 'shapeless') return model.slots.length < 9 ? `ing:${model.slots.length}` : undefined;
  const empty = model.slots.find((s) => !s.ingredient);
  if (empty) return empty.ref;
  if (!model.results.length && ['cooking', 'stonecutting', 'smithing_transform'].includes(model.kind)) return 'result:["result"]';
  return undefined;
}

function App(): JSX.Element {
  const [st, setSt] = useState<RecipeViewState>(boot<RecipeViewState>().state);
  const [json, setJson] = useState<any>(st.json);
  const [selected, setSelected] = useState<string | undefined>();
  const [menu, setMenu] = useState<Menu | undefined>();
  const [check, setCheck] = useState<CheckIdsResult>({ unknownItems: [], unknownTags: [] });
  const [trim, setTrim] = useState(true);
  const [busy, setBusy] = useState(false);
  const pending = useRef(0);

  useEffect(
    () =>
      onEvent<RecipeViewState>('recipe.update', (s) => {
        setSt(s);
        // ignore echoes of our own edits while they are in flight
        if (pending.current === 0) setJson(s.json);
      }),
    [],
  );

  const fmt = st.fmt;
  const editable = !st.readOnly && !st.parseError && !!json && typeof json === 'object';
  const model = useMemo(() => parseRecipe(json, fmt), [json, fmt]);

  useEffect(() => {
    if (!json || typeof json !== 'object') return;
    const ids = referencedIds(model);
    let alive = true;
    const h = window.setTimeout(() => {
      call<CheckIdsResult>('recipe.checkIds', ids)
        .then((r) => alive && setCheck(r))
        .catch(() => undefined);
    }, 250);
    return () => {
      alive = false;
      window.clearTimeout(h);
    };
  }, [JSON.stringify(referencedIds(model))]);

  const unknown = useMemo(() => new Set([...check.unknownItems, ...check.unknownTags.map((x) => `#${x}`)]), [check]);

  const apply = (next: any) => {
    if (!editable) return;
    setJson(next);
    pending.current++;
    call('recipe.edit', { json: next })
      .catch((e) => call('ui.notify', { message: String(e?.message ?? e), level: 'error' }))
      .finally(() => {
        pending.current--;
      });
  };

  const setRef = async (ref: string, value: SlotValue) => {
    if (ref.startsWith('result:')) {
      const path = JSON.parse(ref.slice(7)) as JsonPath;
      if (value === null) return apply(setResultId(json, null, fmt, path));
      let id = typeof value === 'string' ? value : Array.isArray(value) ? value[0] : undefined;
      if (!id) return;
      if (id.startsWith('#')) id = (await expandTag(id))[0];
      if (id) apply(setResultId(json, id, fmt, path));
      return;
    }
    apply(setSlot(json, ref, value, fmt, { trim }));
  };

  const handlers: ViewHandlers = {
    editable,
    selected,
    unknown,
    onSelect: (ref) => {
      setMenu(undefined);
      setSelected(ref === selected ? undefined : ref);
    },
    onDrop: (ref, id) => {
      setSelected(ref);
      void setRef(ref, id);
    },
    onContext: (ref, e) => {
      setSelected(ref);
      if (!editable) return;
      setMenu({ ref, x: Math.min(e.clientX, window.innerWidth - 240), y: Math.min(e.clientY, window.innerHeight - 220) });
    },
  };

  const pick = (id: string) => {
    const ref = selected ?? firstEmptyRef(model);
    if (!ref) {
      void call('ui.notify', { message: t('Select a slot first, then pick an item.'), level: 'info' });
      return;
    }
    setSelected(ref);
    void setRef(ref, id);
  };

  // close the context menu on outside click / escape
  useEffect(() => {
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return;
      if (e.type === 'mousedown' && (e.target as HTMLElement)?.closest?.('.rc-menu')) return;
      setMenu(undefined);
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', close);
    };
  }, []);

  const warnings = [
    ...model.warnings,
    ...check.unknownItems.map((i) => ({ message: 'Unknown item {0}', args: [i], severity: 'warning' as const })),
    ...check.unknownTags.map((i) => ({ message: 'Unknown item tag #{0}', args: [i], severity: 'warning' as const })),
  ];
  const formatIssue = model.warnings.some((w) => FORMAT_WARNING.test(w.message));

  return (
    <div class={`rc-app ${editable ? 'rc-editable' : ''}`}>
      <Header st={st} model={model} formatIssue={formatIssue && editable} busy={busy} setBusy={setBusy} />
      {st.parseError ? (
        <div class="mc-card rc-error-box">
          <strong>{t('The file cannot be displayed')}</strong>
          <div class="mc-error">{st.parseError}</div>
        </div>
      ) : null}
      {json && typeof json === 'object' ? (
        <div class="rc-main">
          <div class="rc-stage">
            <RecipeView model={model} fmt={fmt} h={handlers} />
            <ResultInfo model={model} />
            <Warnings warnings={warnings} />
          </div>
          {editable ? (
            <div class="rc-side">
              <Properties json={json} model={model} st={st} apply={apply} trim={trim} setTrim={setTrim} />
              <SelectedSlot json={json} model={model} selected={selected} setRef={setRef} st={st} />
              <div class="mc-card">
                <div class="rc-section-title">{t('Items')}</div>
                <div class="rc-hint">{t('Click a slot, then click an item — or drag items onto slots. Right-click a slot for more options.')}</div>
                <ItemPicker includeTags onPick={pick} placeholder={t('Search items and #tags…')} limit={90} />
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
      {menu ? <ContextMenu menu={menu} setMenu={setMenu} model={model} setRef={setRef} /> : null}
    </div>
  );
}

function Header({ st, model, formatIssue, busy, setBusy }: { st: RecipeViewState; model: RecipeModel; formatIssue: boolean; busy: boolean; setBusy: (b: boolean) => void }): JSX.Element {
  const typeLabel = VANILLA_TYPES.find((x) => x.type === model.type)?.label;
  const run = (method: string) => {
    setBusy(true);
    call(method)
      .catch((e) => call('ui.notify', { message: String(e?.message ?? e), level: 'error' }))
      .finally(() => setBusy(false));
  };
  return (
    <div class="rc-header">
      <h1>{st.id}</h1>
      <span class="mc-badge" title={model.type}>
        {typeLabel ? t(typeLabel) : model.type || t('No type')}
      </span>
      <span class="mc-badge" title={t('Target Minecraft version')}>
        MC {st.version}
      </span>
      {st.mode === 'vanilla' ? <span class="mc-badge">{t('Vanilla (read-only)')}</span> : null}
      <span class="mc-spacer" />
      {formatIssue ? (
        <Btn onClick={() => run('recipe.migrate')} disabled={busy} title={t('Convert this recipe to the format of the target version')}>
          {t('Migrate to {0}', st.version)}
        </Btn>
      ) : null}
      {st.mode === 'vanilla' ? (
        <Btn onClick={() => run('recipe.copyToMod')} disabled={busy} title={t('Copy this recipe into data/{0}/recipe/', st.defaultNamespace)}>
          {t('Copy to my mod')}
        </Btn>
      ) : null}
      {st.mode === 'preview' ? (
        <Btn secondary onClick={() => run('recipe.openEditor')}>
          {t('Open visual editor')}
        </Btn>
      ) : null}
      {st.mode === 'editor' ? (
        <Btn secondary onClick={() => run('recipe.openText')}>
          {t('Show JSON')}
        </Btn>
      ) : null}
    </div>
  );
}

function ResultInfo({ model }: { model: RecipeModel }): JSX.Element | null {
  const r = model.results[0];
  const name = useName(r?.id);
  if (!r?.id) return null;
  return (
    <div class="mc-card" style={{ maxWidth: '520px' }}>
      <div class="rc-row">
        <strong>{r.count > 1 ? `${r.count} × ` : ''}{name}</strong>
        <code class="mc-muted">{r.id}</code>
        {model.group ? <span class="mc-badge" title={t('Recipe book group')}>{t('Group')}: {model.group}</span> : null}
        {model.category ? <span class="mc-badge" title={t('Recipe book category')}>{t('Category')}: {CATEGORY_LABELS[model.category] ? t(CATEGORY_LABELS[model.category]) : model.category}</span> : null}
      </div>
      {r.components ? (
        <>
          <div class="rc-hint" style={{ marginTop: '6px' }}>
            {t('Components')}: {Object.keys(r.components).map((k) => k.replace(/^minecraft:/, '')).join(', ')}
          </div>
          <pre class="rc-components">{JSON.stringify(r.components, null, 2)}</pre>
        </>
      ) : null}
    </div>
  );
}

function Warnings({ warnings }: { warnings: { message: string; args?: (string | number)[]; severity: string }[] }): JSX.Element | null {
  if (!warnings.length) return null;
  return (
    <div class="mc-card" style={{ maxWidth: '520px' }}>
      <div class="rc-section-title">{t('Problems')} <span class="mc-badge">{warnings.length}</span></div>
      <ul class="rc-warnings">
        {warnings.map((w) => (
          <li class={`rc-sev-${w.severity}`}>
            <span>{t(w.message, ...(w.args ?? []))}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function NumberInput({ value, placeholder, step, min, onCommit }: { value?: number; placeholder?: string; step?: number; min?: number; onCommit: (v: number | undefined) => void }): JSX.Element {
  return (
    <input
      class="mc-input"
      type="number"
      step={step ?? 1}
      min={min}
      value={value ?? ''}
      placeholder={placeholder}
      onChange={(e) => {
        const raw = (e.target as HTMLInputElement).value;
        onCommit(raw === '' ? undefined : Number(raw));
      }}
    />
  );
}

function Properties({ json, model, st, apply, trim, setTrim }: { json: any; model: RecipeModel; st: RecipeViewState; apply: (j: any) => void; trim: boolean; setTrim: (b: boolean) => void }): JSX.Element {
  const fmt = st.fmt;
  const types = VANILLA_TYPES.filter((x) => x.available(fmt) || x.type === model.type);
  const cats = categoriesFor(model.kind);
  const r = model.results[0];
  const hasResultCount = r && !(model.kind === 'transmute' && !fmt.transmuteResultStack);
  return (
    <div class="mc-card">
      <div class="rc-section-title">{t('Recipe')}</div>
      <div class="rc-props">
        <label>{t('Type')}</label>
        <select class="mc-select" value={model.type} onChange={(e) => apply(changeType(json, (e.target as HTMLSelectElement).value, fmt))}>
          {!types.some((x) => x.type === model.type) ? <option value={model.type}>{model.type}</option> : null}
          {types.map((x) => (
            <option value={x.type}>{t(x.label)}</option>
          ))}
        </select>
        {hasResultCount ? (
          <>
            <label>{t('Result count')}</label>
            <NumberInput value={r.count} min={1} onCommit={(v) => apply(setResultCount(json, v ?? 1, fmt, r.path))} />
          </>
        ) : null}
        {cats.length ? (
          <>
            <label>{t('Category')}</label>
            <select class="mc-select" value={model.category ?? ''} onChange={(e) => apply(setProperty(json, 'category', (e.target as HTMLSelectElement).value))}>
              <option value="">{t('(default)')}</option>
              {cats.map((c) => (
                <option value={c}>{CATEGORY_LABELS[c] ? t(CATEGORY_LABELS[c]) : c}</option>
              ))}
            </select>
          </>
        ) : null}
        {['shaped', 'shapeless', 'transmute', 'dye', 'imbue', 'cooking', 'stonecutting'].includes(model.kind) ? (
          <>
            <label>{t('Group')}</label>
            <input class="mc-input" value={model.group ?? ''} placeholder={t('(none)')} onChange={(e) => apply(setProperty(json, 'group', (e.target as HTMLInputElement).value.trim()))} />
          </>
        ) : null}
        {model.kind === 'cooking' ? (
          <>
            <label>{t('Cooking time')}</label>
            <span class="rc-row">
              <NumberInput value={model.cooking?.time} placeholder={String(model.cooking?.defaultTime)} min={1} onCommit={(v) => apply(setProperty(json, 'cookingtime', v))} />
              <span class="mc-muted">{t('ticks ({0} s)', +((model.cooking?.time ?? model.cooking?.defaultTime ?? 0) / 20).toFixed(2))}</span>
            </span>
            <label>{t('Experience')}</label>
            <NumberInput value={model.cooking?.xp} step={0.05} min={0} placeholder="0" onCommit={(v) => apply(setProperty(json, 'experience', v))} />
          </>
        ) : null}
        {model.kind === 'shaped' ? (
          <>
            <label>{t('Pattern')}</label>
            <span class="rc-row">
              <code>{model.grid ? `${model.grid.width}×${model.grid.height}` : '—'}</code>
              <label class="rc-row" title={t('Remove empty rows and columns around the pattern')}>
                <input type="checkbox" checked={trim} onChange={(e) => setTrim((e.target as HTMLInputElement).checked)} /> {t('Auto-trim')}
              </label>
            </span>
            <label>{t('Notification')}</label>
            <label class="rc-row" title={t('Show the "new recipe unlocked" toast')}>
              <input
                type="checkbox"
                checked={model.showNotification ?? true}
                onChange={(e) => apply(setProperty(json, 'show_notification', (e.target as HTMLInputElement).checked ? undefined : false))}
              />{' '}
              {t('show when unlocked')}
            </label>
          </>
        ) : null}
        {model.kind === 'smithing_trim' && fmt.trimPattern ? (
          <>
            <label>{t('Trim pattern')}</label>
            <input class="mc-input" value={json.pattern ?? ''} placeholder="minecraft:bolt" onChange={(e) => apply(setProperty(json, 'pattern', (e.target as HTMLInputElement).value.trim()))} />
          </>
        ) : null}
        {model.kind === 'brewing' ? (
          <>
            <label>{t('Input potion')}</label>
            <input
              class="mc-input"
              value={model.brewing?.inputPotion ?? ''}
              placeholder="minecraft:awkward"
              onChange={(e) => {
                const v = (e.target as HTMLInputElement).value.trim();
                const input = { ...(json.input ?? {}) };
                if (v) input.potion_contents = { ...(input.potion_contents ?? {}), potions: v };
                else delete input.potion_contents;
                apply({ ...json, input });
              }}
            />
            <label>{t('Output potion')}</label>
            <input
              class="mc-input"
              value={model.brewing?.outputPotion ?? ''}
              placeholder="minecraft:strength"
              onChange={(e) => {
                const v = (e.target as HTMLInputElement).value.trim();
                const output = { ...(json.output ?? {}) };
                const components = { ...(output.components ?? {}) };
                if (v) components['minecraft:potion_contents'] = { ...(components['minecraft:potion_contents'] ?? {}), potion: v };
                else delete components['minecraft:potion_contents'];
                output.components = components;
                apply({ ...json, output });
              }}
            />
          </>
        ) : null}
      </div>
    </div>
  );
}

function SelectedSlot({ json, model, selected, setRef, st }: { json: any; model: RecipeModel; selected?: string; setRef: (ref: string, v: SlotValue) => Promise<void>; st: RecipeViewState }): JSX.Element {
  const [tags, setTags] = useState<string[] | undefined>();
  const [text, setText] = useState('');
  const isResult = !!selected?.startsWith('result:');
  const ing = selected && !isResult ? findSlotIngredient(model, selected) : null;
  const result = isResult ? model.results.find((r) => resultRef(r) === selected) : undefined;
  const first = isResult ? result?.id : ing?.ids[0];
  const name = useName(first && !first.startsWith('#') ? first : undefined);
  useEffect(() => {
    setTags(undefined);
    setText(isResult ? result?.id ?? '' : ing && typeof ing.raw === 'string' ? ing.raw : first ?? '');
  }, [selected, first]);
  if (!selected) {
    return (
      <div class="mc-card">
        <div class="rc-section-title">{t('Slot')}</div>
        <div class="rc-hint">{t('Select a slot in the recipe to edit it.')}</div>
      </div>
    );
  }
  const loadTags = async () => {
    if (!first || first.startsWith('#')) return;
    setTags(await call<string[]>('recipe.tagsOf', { id: first }).catch(() => []));
  };
  const raw = !isResult ? slotRaw(json, selected) : undefined;
  return (
    <div class="mc-card">
      <div class="rc-section-title">{isResult ? t('Result') : t('Slot')}</div>
      <div class="rc-sel-info">
        <Slot id={isResult ? result?.id : ing?.ids} />
        <div class="mc-col" style={{ gap: '2px', minWidth: 0 }}>
          <strong>{first ? (first.startsWith('#') ? `${t('Tag')} ${first}` : name) : t('Empty')}</strong>
          {ing?.customType ? <span class="mc-muted">{t('Custom ingredient')}: {ing.customType}</span> : null}
          {ing && ing.ids.length > 1 ? <span class="mc-muted">{t('{0} alternatives', ing.ids.length)}</span> : null}
        </div>
      </div>
      <div class="rc-row" style={{ marginTop: '8px' }}>
        <input
          class="mc-input mc-grow"
          value={text}
          placeholder={isResult ? 'minecraft:diamond' : t('minecraft:item or #namespace:tag')}
          onInput={(e) => setText((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && text.trim()) void setRef(selected, text.trim());
          }}
        />
        <Btn secondary disabled={!text.trim()} onClick={() => void setRef(selected, text.trim())}>
          {t('Set')}
        </Btn>
        <Btn secondary onClick={() => void setRef(selected, null)} disabled={!first && raw === undefined}>
          {t('Clear')}
        </Btn>
      </div>
      {!isResult && first && !first.startsWith('#') ? (
        <div style={{ marginTop: '8px' }}>
          {tags === undefined ? (
            <button class="rc-chip" onClick={loadTags}>
              # {t('Use a tag containing this item…')}
            </button>
          ) : tags.length ? (
            <div class="rc-taglist">
              {tags.slice(0, 30).map((tg) => (
                <button class="rc-chip" title={t('Replace with tag {0}', tg)} onClick={() => void setRef(selected, tg)}>
                  {tg}
                </button>
              ))}
            </div>
          ) : (
            <span class="rc-hint">{t('No item tag contains {0}.', first)}</span>
          )}
        </div>
      ) : null}
      {!isResult && first?.startsWith('#') ? (
        <div style={{ marginTop: '8px' }}>
          <button class="rc-chip" onClick={async () => { const it = (await expandTag(first))[0]; if (it) void setRef(selected, it); }}>
            {t('Use a single item instead of the tag')}
          </button>
        </div>
      ) : null}
      {st.fmt.ingredient === 'object' ? <div class="rc-hint" style={{ marginTop: '6px' }}>{t('Ingredients are written as {"item": …} / {"tag": …} for Minecraft {0}.', st.version)}</div> : null}
    </div>
  );
}

function ContextMenu({ menu, setMenu, model, setRef }: { menu: Menu; setMenu: (m: Menu | undefined) => void; model: RecipeModel; setRef: (ref: string, v: SlotValue) => Promise<void> }): JSX.Element {
  const isResult = menu.ref.startsWith('result:');
  const ing = isResult ? null : findSlotIngredient(model, menu.ref);
  const first = isResult ? model.results.find((r) => resultRef(r) === menu.ref)?.id : ing?.ids[0];
  const [text, setText] = useState('');
  const done = (ref: string, v: SlotValue) => {
    setMenu(undefined);
    void setRef(ref, v);
  };
  return (
    <div class="rc-menu" style={{ left: `${menu.x}px`, top: `${menu.y}px` }}>
      <div class="rc-menu-title">{first ?? t('Empty slot')}</div>
      <button onClick={() => done(menu.ref, null)}>✕ {t('Clear slot')}</button>
      {!isResult && first && !first.startsWith('#') ? (
        <button
          onClick={async () => {
            const tags = await call<string[]>('recipe.tagsOf', { id: first }).catch(() => []);
            setMenu({ ...menu, tags });
          }}
        >
          # {t('Use a tag containing this item…')}
        </button>
      ) : null}
      {!isResult && first?.startsWith('#') ? (
        <button
          onClick={async () => {
            const it = (await expandTag(first))[0];
            if (it) done(menu.ref, it);
          }}
        >
          ◻ {t('Use a single item instead of the tag')}
        </button>
      ) : null}
      {menu.tags ? (
        <>
          <hr />
          {menu.tags.length ? (
            menu.tags.slice(0, 12).map((tg) => <button onClick={() => done(menu.ref, tg)}>{tg}</button>)
          ) : (
            <div class="rc-menu-title">{t('No item tag contains {0}.', first ?? '')}</div>
          )}
        </>
      ) : null}
      <hr />
      <input
        class="mc-input"
        placeholder={t('Type an id or #tag and press Enter')}
        value={text}
        autoFocus={false}
        onInput={(e) => setText((e.target as HTMLInputElement).value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && text.trim()) done(menu.ref, text.trim());
        }}
      />
    </div>
  );
}

render(<App />, document.getElementById('app')!);
