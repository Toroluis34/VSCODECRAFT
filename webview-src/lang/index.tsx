// Lang Editor webview: keys × locales spreadsheet for one namespace.
import { render } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { boot, call, onEvent } from '../shared/vscode';
import { t } from '../shared/i18n';
import { Button, ItemIcon, McText } from '../shared/components';
import { computeStats, formatArgsMismatch, KEY_GROUPS, keyGroup, keyItemId, LocaleStats } from '../../src/features/translations/langFile';
import { MC_LOCALES } from '../../src/features/translations/locales';
import { STYLE } from './style';

interface LocaleModel {
  locale: string;
  name: string;
  uri: string;
  entries: [string, string][];
  duplicates: string[];
  nonString: string[];
  errors: number;
}
interface Model {
  namespace: string;
  folder: string;
  base: string;
  primary?: string;
  locales: LocaleModel[];
  sortKeys: boolean;
  marker: string;
  canUndo: boolean;
  canRedo: boolean;
}

type Filter = 'all' | 'missing' | 'untranslated' | 'issues';
type Row = { type: 'group'; group: string; count: number } | { type: 'key'; key: string };

const ROW_H = 30;
const bootState = boot<{ namespace: string; customEditor: boolean }>().state ?? { namespace: '', customEditor: false };

function groupLabel(g: string): string {
  return KEY_GROUPS[g] ? t(KEY_GROUPS[g]) : g;
}

async function op(p: unknown): Promise<Model | undefined> {
  try {
    return await call<Model>('lang.op', p);
  } catch (e) {
    void call('ui.notify', { message: String((e as Error).message ?? e), level: 'error' });
    return undefined;
  }
}

function App(): JSX.Element {
  const [model, setModel] = useState<Model | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [group, setGroup] = useState('');
  const [grouped, setGrouped] = useState(true);
  const [sortView, setSortView] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | undefined>();
  const [panel, setPanel] = useState<'' | 'addKey' | 'addLocale' | 'columns'>('');

  useEffect(() => {
    void call<Model>('lang.load').then(setModel);
    return onEvent<Model>('lang.model', setModel);
  }, []);

  const apply = async (p: unknown) => {
    const m = await op(p);
    if (m) setModel(m);
  };

  // Keyboard undo / redo (panel mode; the custom editor uses VS Code's own undo).
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || bootState.customEditor) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        void call<Model>(e.shiftKey ? 'lang.redo' : 'lang.undo').then(setModel);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        void call<Model>('lang.redo').then(setModel);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const data = useMemo(() => {
    if (!model) return undefined;
    const values = new Map<string, Map<string, string>>();
    const keys: string[] = [];
    const seen = new Set<string>();
    const ordered = [...model.locales].sort((a, b) => (a.locale === model.base ? -1 : b.locale === model.base ? 1 : 0));
    for (const l of ordered) {
      const m = new Map<string, string>();
      for (const [k, v] of l.entries) {
        m.set(k, v);
        if (!seen.has(k)) {
          seen.add(k);
          keys.push(k);
        }
      }
      values.set(l.locale, m);
    }
    const rec: Record<string, Record<string, string>> = {};
    for (const [l, m] of values) rec[l] = Object.fromEntries(m);
    const stats = new Map<string, LocaleStats>(computeStats(rec, model.base, model.marker).map((s) => [s.locale, s]));
    const dups = new Set(model.locales.flatMap((l) => l.duplicates));
    return { values, keys, stats, dups };
  }, [model]);

  if (!model || !data) return <div class="mc-muted">{t('Loading…')}</div>;

  const locales = model.locales.filter((l) => !hidden.has(l.locale));
  const base = data.values.get(model.base) ?? new Map<string, string>();
  const nonBase = locales.filter((l) => l.locale !== model.base);

  const isUntranslated = (locale: string, key: string): boolean => {
    if (locale === model.base) return false;
    const v = data.values.get(locale)?.get(key);
    const b = base.get(key);
    return v !== undefined && v !== '' && b !== undefined && (v === b || (!!model.marker && v.startsWith(model.marker)));
  };
  const keyIssues = (key: string): string[] => {
    const out: string[] = [];
    const b = base.get(key);
    if (b === undefined) out.push(t('Missing in {0}', model.base));
    if (data.dups.has(key)) out.push(t('Duplicate key'));
    for (const l of locales) {
      const v = data.values.get(l.locale)?.get(key);
      if (v === '') out.push(t('Empty in {0}', l.locale));
      if (b !== undefined && v !== undefined && l.locale !== model.base && formatArgsMismatch(b, v)) out.push(t('Format arguments differ in {0}', l.locale));
    }
    return out;
  };

  const q = query.trim().toLowerCase();
  let keys = data.keys.filter((k) => {
    if (group && keyGroup(k) !== group) return false;
    if (q && !k.toLowerCase().includes(q) && !locales.some((l) => data.values.get(l.locale)?.get(k)?.toLowerCase().includes(q))) return false;
    if (filter === 'missing') return locales.some((l) => !data.values.get(l.locale)?.has(k) || data.values.get(l.locale)?.get(k) === '');
    if (filter === 'untranslated') return nonBase.some((l) => isUntranslated(l.locale, k) || !data.values.get(l.locale)?.has(k));
    if (filter === 'issues') return keyIssues(k).length > 0;
    return true;
  });
  if (sortView) keys = [...keys].sort();

  const groupCounts = new Map<string, number>();
  for (const k of data.keys) groupCounts.set(keyGroup(k), (groupCounts.get(keyGroup(k)) ?? 0) + 1);

  const rows: Row[] = [];
  if (grouped) {
    const byGroup = new Map<string, string[]>();
    for (const k of keys) {
      const g = keyGroup(k);
      const list = byGroup.get(g) ?? [];
      list.push(k);
      byGroup.set(g, list);
    }
    const order = [...byGroup.keys()].sort((a, b) => {
      const ia = Object.keys(KEY_GROUPS).indexOf(a);
      const ib = Object.keys(KEY_GROUPS).indexOf(b);
      return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || a.localeCompare(b);
    });
    for (const g of order) {
      const list = byGroup.get(g)!;
      rows.push({ type: 'group', group: g, count: list.length });
      if (!collapsed.has(g)) for (const k of list) rows.push({ type: 'key', key: k });
    }
  } else for (const k of keys) rows.push({ type: 'key', key: k });

  const cols = `minmax(240px, 1.3fr) ${locales.map(() => 'minmax(200px, 1fr)').join(' ')} 64px`;
  const minWidth = 240 + locales.length * 200 + 64;
  const broken = model.locales.filter((l) => l.errors || l.duplicates.length || l.nonString.length);

  return (
    <div class="lang-root">
      <style>{STYLE}</style>
      <div class="mc-toolbar lang-toolbar">
        <strong class="lang-title">
          {t('Lang')} · <code>{model.namespace}</code>
        </strong>
        <input
          class="mc-input lang-search"
          type="search"
          placeholder={t('Search keys and values…')}
          value={query}
          onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
        />
        <select class="mc-select" value={filter} onChange={(e) => setFilter((e.target as HTMLSelectElement).value as Filter)} title={t('Filter')}>
          <option value="all">{t('All keys')}</option>
          <option value="missing">{t('Missing only')}</option>
          <option value="untranslated">{t('Untranslated')}</option>
          <option value="issues">{t('With issues')}</option>
        </select>
        <select class="mc-select" value={group} onChange={(e) => setGroup((e.target as HTMLSelectElement).value)} title={t('Group')}>
          <option value="">{t('All groups')}</option>
          {[...groupCounts.entries()]
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([g, n]) => (
              <option value={g}>
                {groupLabel(g)} ({n})
              </option>
            ))}
        </select>
        <label class="lang-check">
          <input type="checkbox" checked={grouped} onChange={(e) => setGrouped((e.target as HTMLInputElement).checked)} />
          {t('Group by prefix')}
        </label>
        <label class="lang-check">
          <input type="checkbox" checked={sortView} onChange={(e) => setSortView((e.target as HTMLInputElement).checked)} />
          {t('A → Z')}
        </label>
        <span class="mc-spacer" />
        <Button onClick={() => setPanel(panel === 'addKey' ? '' : 'addKey')} icon="+">
          {t('Add key')}
        </Button>
        <Button secondary onClick={() => setPanel(panel === 'addLocale' ? '' : 'addLocale')} icon="🌐">
          {t('Add locale')}
        </Button>
        <Button secondary onClick={() => setPanel(panel === 'columns' ? '' : 'columns')} title={t('Show or hide locale columns')}>
          {t('Columns')}
        </Button>
        <Button secondary onClick={() => apply({ op: 'sort' })} title={t('Sort the keys of every locale file alphabetically')}>
          {t('Sort files')}
        </Button>
        <button class="mc-icon-button" disabled={!model.canUndo} title={t('Undo')} onClick={() => call<Model>('lang.undo').then(setModel)}>
          ↶
        </button>
        <button class="mc-icon-button" disabled={!model.canRedo} title={t('Redo')} onClick={() => call<Model>('lang.redo').then(setModel)}>
          ↷
        </button>
      </div>

      {panel === 'addKey' ? (
        <AddKeyForm
          model={model}
          existing={new Set(data.keys)}
          prefix={group ? `${group}.${model.namespace}.` : `item.${model.namespace}.`}
          onAdd={async (key, values) => {
            await apply({ op: 'add', key, values });
            setSelected(key);
            setQuery('');
            setPanel('');
          }}
          onCancel={() => setPanel('')}
        />
      ) : null}
      {panel === 'addLocale' ? (
        <AddLocaleForm
          existing={new Set(model.locales.map((l) => l.locale))}
          onAdd={async (locale, fill) => {
            await apply({ op: 'addLocale', locale, fill });
            setPanel('');
          }}
          onCancel={() => setPanel('')}
        />
      ) : null}
      {panel === 'columns' ? (
        <div class="mc-card lang-form">
          {model.locales.map((l) => (
            <label class="lang-check">
              <input
                type="checkbox"
                checked={!hidden.has(l.locale)}
                disabled={l.locale === model.base}
                onChange={(e) => {
                  const s = new Set(hidden);
                  if ((e.target as HTMLInputElement).checked) s.delete(l.locale);
                  else s.add(l.locale);
                  setHidden(s);
                }}
              />
              <code>{l.locale}</code> <span class="mc-muted">{l.name}</span>
            </label>
          ))}
        </div>
      ) : null}

      {broken.map((l) => (
        <div class={l.errors ? 'lang-banner error' : 'lang-banner'}>
          <code>{l.locale}.json</code>{' '}
          {l.errors ? t('has JSON syntax errors — fix them in the text editor before editing here.') : null}
          {l.duplicates.length ? ` ${t('Duplicate keys (only the last value is used): {0}', l.duplicates.join(', '))}` : null}
          {l.nonString.length ? ` ${t('Non-string values (ignored by Minecraft): {0}', l.nonString.join(', '))}` : null}{' '}
          <a href="#" onClick={(e) => (e.preventDefault(), call('lang.open', { locale: l.locale, key: l.duplicates[0] ?? l.nonString[0] }))}>
            {t('Open file')}
          </a>
        </div>
      ))}

      <Grid
        model={model}
        locales={locales}
        rows={rows}
        cols={cols}
        minWidth={minWidth}
        stats={data.stats}
        values={data.values}
        selected={selected}
        collapsed={collapsed}
        onToggleGroup={(g) => {
          const s = new Set(collapsed);
          s.has(g) ? s.delete(g) : s.add(g);
          setCollapsed(s);
        }}
        onSelect={setSelected}
        isUntranslated={isUntranslated}
        keyIssues={keyIssues}
        apply={apply}
      />
      <div class="lang-status mc-muted">
        {t('{0} of {1} keys', keys.length, data.keys.length)} · {model.folder}
        {model.sortKeys ? ` · ${t('keys are kept sorted')}` : ''}
      </div>
      {selected && data.keys.includes(selected) ? (
        <Detail model={model} keyName={selected} values={data.values} issues={keyIssues(selected)} isUntranslated={isUntranslated} onClose={() => setSelected(undefined)} />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------

interface GridProps {
  model: Model;
  locales: LocaleModel[];
  rows: Row[];
  cols: string;
  minWidth: number;
  stats: Map<string, LocaleStats>;
  values: Map<string, Map<string, string>>;
  selected?: string;
  collapsed: Set<string>;
  onToggleGroup: (g: string) => void;
  onSelect: (k: string) => void;
  isUntranslated: (locale: string, key: string) => boolean;
  keyIssues: (key: string) => string[];
  apply: (p: unknown) => Promise<void>;
}

function Grid(p: GridProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState(0);
  const [height, setHeight] = useState(600);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const first = Math.max(0, Math.floor(scroll / ROW_H) - 10);
  const last = Math.min(p.rows.length, Math.ceil((scroll + height) / ROW_H) + 10);
  const slice = p.rows.slice(first, last);
  return (
    <div class="lang-grid" ref={ref} onScroll={(e) => setScroll((e.target as HTMLDivElement).scrollTop)}>
      <div class="lang-row lang-head" style={{ gridTemplateColumns: p.cols, minWidth: `${p.minWidth}px` }}>
        <div class="lang-cell lang-keycell">{t('Key')}</div>
        {p.locales.map((l) => {
          const s = p.stats.get(l.locale);
          const missing = s ? s.missing + s.empty : 0;
          return (
            <div class="lang-cell lang-lhead" title={`${l.name}\n${s ? t('{0} translated, {1} missing, {2} empty, {3} untranslated', s.translated, s.missing, s.empty, s.identical) : ''}`}>
              <div class="mc-row" style={{ gap: '6px', flexWrap: 'nowrap' }}>
                <code>{l.locale}</code>
                <span class="mc-muted lang-ellipsis">{l.name}</span>
                <span class="mc-spacer" />
                {l.locale !== p.model.base && missing ? (
                  <button class="mc-icon-button" title={t('Copy {0} missing keys from {1} (English text)', missing, p.model.base)} onClick={() => p.apply({ op: 'fillMissing', locale: l.locale })}>
                    ⇣
                  </button>
                ) : null}
                <button class="mc-icon-button" title={t('Open {0}.json', l.locale)} onClick={() => call('lang.open', { locale: l.locale })}>
                  ↗
                </button>
              </div>
              {s ? (
                <div class="lang-progress" title={`${s.percent}%`}>
                  <div style={{ width: `${s.percent}%` }} class={s.percent >= 100 ? 'done' : ''} />
                  <span>{l.locale === p.model.base ? t('{0} keys', s.total) : `${s.percent}%`}</span>
                </div>
              ) : null}
            </div>
          );
        })}
        <div class="lang-cell" />
      </div>
      <div style={{ height: `${first * ROW_H}px` }} />
      {slice.map((r) =>
        r.type === 'group' ? (
          <div class="lang-row lang-grouprow" style={{ minWidth: `${p.minWidth}px` }} onClick={() => p.onToggleGroup(r.group)}>
            <span class="lang-twisty">{p.collapsed.has(r.group) ? '▸' : '▾'}</span>
            <strong>{groupLabel(r.group)}</strong>
            <code class="mc-muted">{r.group}.*</code>
            <span class="mc-badge">{r.count}</span>
          </div>
        ) : (
          <KeyRow key={r.key} keyName={r.key} {...p} />
        ),
      )}
      <div style={{ height: `${Math.max(0, (p.rows.length - last) * ROW_H)}px` }} />
      {!p.rows.length ? <div class="mc-muted lang-empty">{t('No keys match the current filters.')}</div> : null}
    </div>
  );
}

function KeyRow(p: GridProps & { keyName: string }): JSX.Element {
  const key = p.keyName;
  const [renaming, setRenaming] = useState(false);
  const itemId = keyItemId(key);
  const issues = p.keyIssues(key);
  return (
    <div
      class={`lang-row ${p.selected === key ? 'selected' : ''}`}
      style={{ gridTemplateColumns: p.cols, minWidth: `${p.minWidth}px` }}
      onClick={() => p.onSelect(key)}
    >
      <div class="lang-cell lang-keycell" title={issues.length ? `${key}\n⚠ ${issues.join('\n⚠ ')}` : key}>
        {itemId ? <ItemIcon id={itemId} size={20} cycleMs={0} /> : <span class="lang-noicon" />}
        {renaming ? (
          <input
            class="mc-input lang-edit"
            autoFocus
            value={key}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setRenaming(false);
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            }}
            onBlur={async (e) => {
              const to = (e.target as HTMLInputElement).value.trim();
              setRenaming(false);
              if (to && to !== key) {
                await p.apply({ op: 'rename', from: key, to });
                p.onSelect(to);
              }
            }}
          />
        ) : (
          <span class="lang-key" onDblClick={() => setRenaming(true)}>
            {key}
          </span>
        )}
        {issues.length ? <span class="lang-warn">⚠</span> : null}
      </div>
      {p.locales.map((l) => (
        <ValueCell
          locale={l.locale}
          keyName={key}
          value={p.values.get(l.locale)?.get(key)}
          base={p.values.get(p.model.base)?.get(key)}
          isBase={l.locale === p.model.base}
          readonly={l.errors > 0}
          untranslated={p.isUntranslated(l.locale, key)}
          apply={p.apply}
        />
      ))}
      <div class="lang-cell lang-actions">
        <button class="mc-icon-button" title={t('Rename key in every locale')} onClick={(e) => (e.stopPropagation(), setRenaming(true))}>
          ✎
        </button>
        <button
          class="mc-icon-button"
          title={t('Delete key from every locale')}
          onClick={(e) => {
            e.stopPropagation();
            void p.apply({ op: 'delete', keys: [key] });
          }}
        >
          🗑
        </button>
      </div>
    </div>
  );
}

function ValueCell(p: {
  locale: string;
  keyName: string;
  value: string | undefined;
  base: string | undefined;
  isBase: boolean;
  readonly: boolean;
  untranslated: boolean;
  apply: (p: unknown) => Promise<void>;
}): JSX.Element {
  const [editing, setEditing] = useState(false);
  const missing = p.value === undefined;
  const mismatch = !p.isBase && p.base !== undefined && p.value !== undefined && formatArgsMismatch(p.base, p.value);
  const cls = ['lang-cell', 'lang-value', missing ? 'missing' : '', p.value === '' ? 'empty' : '', p.untranslated ? 'untranslated' : '', mismatch ? 'mismatch' : '', p.readonly ? 'readonly' : '']
    .filter(Boolean)
    .join(' ');
  const title = missing
    ? t('Missing — click to add')
    : `${p.value}${p.untranslated ? `\n${t('Same as {0} (untranslated?)', 'en_us')}` : ''}${mismatch ? `\n${t('Format arguments (%s) differ from en_us')}` : ''}`;
  if (editing && !p.readonly) {
    return (
      <div class={cls}>
        <input
          class="mc-input lang-edit"
          autoFocus
          value={p.value ?? (p.isBase ? '' : '')}
          placeholder={p.base}
          onKeyDown={(e) => {
            const el = e.target as HTMLInputElement;
            if (e.key === 'Escape') {
              el.value = p.value ?? '';
              setEditing(false);
            }
            if (e.key === 'Enter') el.blur();
            if (e.key === 'Tab' && !el.value && p.base && !p.isBase && missing) {
              // Tab on an empty missing cell copies the English text as a starting point
              e.preventDefault();
              el.value = p.base;
            }
          }}
          onBlur={(e) => {
            const v = (e.target as HTMLInputElement).value;
            setEditing(false);
            if (v !== (p.value ?? '') || (missing && v !== '')) void p.apply({ op: 'set', locale: p.locale, key: p.keyName, value: v });
          }}
        />
      </div>
    );
  }
  return (
    <div class={cls} title={title} onClick={() => setEditing(true)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setEditing(true)}>
      {missing ? (
        <span class="lang-placeholder">{p.base ?? '—'}</span>
      ) : p.value!.includes('§') ? (
        <span class="lang-mc">
          <McText text={p.value!} />
        </span>
      ) : (
        <span class="lang-ellipsis">{p.value}</span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------

function Detail(p: {
  model: Model;
  keyName: string;
  values: Map<string, Map<string, string>>;
  issues: string[];
  isUntranslated: (l: string, k: string) => boolean;
  onClose: () => void;
}): JSX.Element {
  const itemId = keyItemId(p.keyName);
  return (
    <div class="lang-detail mc-card">
      <div class="mc-row">
        {itemId ? (
          <div class="mc-slot" style={{ width: '40px', height: '40px' }}>
            <ItemIcon id={itemId} size={32} cycleMs={0} />
          </div>
        ) : null}
        <div class="mc-col" style={{ gap: '2px' }}>
          <code class="lang-detail-key">{p.keyName}</code>
          <span class="mc-muted">
            {groupLabel(keyGroup(p.keyName))}
            {itemId ? ` · ${itemId}` : ''}
          </span>
        </div>
        <span class="mc-spacer" />
        <Button secondary onClick={() => call('lang.open', { locale: p.model.base, key: p.keyName })}>
          {t('Show in file')}
        </Button>
        <button class="mc-icon-button" title={t('Close')} onClick={p.onClose}>
          ✕
        </button>
      </div>
      {p.issues.length ? <div class="mc-warning">⚠ {p.issues.join(' · ')}</div> : null}
      <div class="lang-previews">
        {p.model.locales.map((l) => {
          const v = p.values.get(l.locale)?.get(p.keyName);
          return (
            <div class="lang-preview">
              <code class="mc-muted">{l.locale}</code>
              <div class="lang-chat">{v === undefined ? <span class="lang-chat-missing">{t('missing')}</span> : <McText text={v || ' '} />}</div>
              {p.isUntranslated(l.locale, p.keyName) ? <span class="mc-warning">{t('untranslated')}</span> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AddKeyForm(p: {
  model: Model;
  existing: Set<string>;
  prefix: string;
  onAdd: (key: string, values: Record<string, string>) => void;
  onCancel: () => void;
}): JSX.Element {
  const [key, setKey] = useState(p.prefix);
  const [values, setValues] = useState<Record<string, string>>({});
  const exists = p.existing.has(key.trim());
  const valid = /^[^\s"\\]+$/.test(key.trim()) && !exists && !key.trim().endsWith('.');
  const submit = () => valid && p.onAdd(key.trim(), Object.fromEntries(p.model.locales.map((l) => [l.locale, values[l.locale] ?? ''])));
  return (
    <div class="mc-card lang-form">
      <label class="mc-field">
        {t('Key')}
        <input
          class="mc-input"
          autoFocus
          value={key}
          onInput={(e) => setKey((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          style={{ minWidth: '320px' }}
        />
      </label>
      {p.model.locales.slice(0, 4).map((l) => (
        <label class="mc-field">
          {l.locale}
          <input
            class="mc-input"
            value={values[l.locale] ?? ''}
            onInput={(e) => setValues({ ...values, [l.locale]: (e.target as HTMLInputElement).value })}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        </label>
      ))}
      <div class="mc-row" style={{ alignSelf: 'flex-end' }}>
        <button class="mc-button" disabled={!valid} onClick={submit}>
          {t('Add')}
        </button>
        <Button secondary onClick={p.onCancel}>
          {t('Cancel')}
        </Button>
      </div>
      {exists ? <span class="mc-error">{t('This key already exists')}</span> : null}
    </div>
  );
}

function AddLocaleForm(p: { existing: Set<string>; onAdd: (locale: string, fill: 'empty' | 'english') => void; onCancel: () => void }): JSX.Element {
  const options = MC_LOCALES.filter(([c]) => !p.existing.has(c));
  const [locale, setLocale] = useState(options.find(([c]) => c === 'es_es')?.[0] ?? options[0]?.[0] ?? '');
  const [fill, setFill] = useState<'empty' | 'english'>('empty');
  return (
    <div class="mc-card lang-form">
      <label class="mc-field">
        {t('Locale')}
        <select class="mc-select" value={locale} onChange={(e) => setLocale((e.target as HTMLSelectElement).value)}>
          {options.map(([c, n]) => (
            <option value={c}>
              {c} — {n}
            </option>
          ))}
        </select>
      </label>
      <label class="mc-field">
        {t('Initial content')}
        <select class="mc-select" value={fill} onChange={(e) => setFill((e.target as HTMLSelectElement).value as 'empty' | 'english')}>
          <option value="empty">{t('Empty file')}</option>
          <option value="english">{t('Copy English text (to translate)')}</option>
        </select>
      </label>
      <div class="mc-row" style={{ alignSelf: 'flex-end' }}>
        <button class="mc-button" disabled={!locale} onClick={() => p.onAdd(locale, fill)}>
          {t('Create {0}.json', locale)}
        </button>
        <Button secondary onClick={p.onCancel}>
          {t('Cancel')}
        </Button>
      </div>
    </div>
  );
}

render(<App />, document.getElementById('app')!);
