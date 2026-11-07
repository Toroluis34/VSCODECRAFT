// Recipe Browser: search every workspace + vanilla recipe ("how to craft X", "uses of X").
import { render } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { boot, call, onEvent } from '../shared/vscode';
import { t } from '../shared/i18n';
import { ItemIcon } from '../shared/components';
import { parseRecipe, VANILLA_TYPES } from '../../src/features/recipes/recipeModel';
import { recipeTypes, searchRecipes, type SearchMode } from '../../src/features/recipes/browserSearch';
import type { BrowserData, BrowserEntry } from '../../src/features/recipes/protocol';
import { Btn, RecipeView, type ViewHandlers } from '../recipe/RecipeView';
import { injectStyles } from '../recipe/styles';

injectStyles();

const PAGE = 150;

const CSS = `
.rb-app { display: flex; flex-direction: column; gap: 8px; height: calc(100vh - 24px); }
.rb-toolbar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.rb-toolbar .mc-input[type=search] { flex: 1 1 260px; min-width: 180px; }
.rb-body { display: flex; gap: 12px; flex: 1; min-height: 0; flex-wrap: wrap; }
.rb-list { flex: 1 1 320px; min-width: 260px; overflow-y: auto; border: 1px solid var(--vscode-panel-border, rgba(128,128,128,.35)); border-radius: 3px; max-height: 100%; }
.rb-row { display: flex; gap: 8px; align-items: center; padding: 4px 8px; cursor: pointer; border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,.15)); }
.rb-row:hover { background: var(--vscode-list-hoverBackground); }
.rb-row.active { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
.rb-row .rb-text { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.rb-row .rb-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rb-row .rb-id { font-size: .85em; opacity: .75; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-family: var(--vscode-editor-font-family, monospace); }
.rb-preview { flex: 1 1 380px; min-width: 300px; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; }
.rb-src-ws { background: var(--vscode-gitDecoration-addedResourceForeground, #388a34); color: #fff; }
.rb-more { padding: 8px; text-align: center; }
.rb-empty { padding: 16px; }
`;
const style = document.createElement('style');
style.textContent = CSS;
document.head.appendChild(style);

function typeLabel(type: string): string {
  const v = VANILLA_TYPES.find((x) => x.type === type);
  return v ? t(v.label) : type.replace(/^minecraft:/, '');
}

function App(): JSX.Element {
  const init = boot<{ query?: string }>().state ?? {};
  const [data, setData] = useState<BrowserData | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [query, setQuery] = useState(init.query ?? '');
  const [mode, setMode] = useState<SearchMode>('all');
  const [type, setType] = useState('');
  const [source, setSource] = useState<'' | 'workspace' | 'vanilla'>('');
  const [limit, setLimit] = useState(PAGE);
  const [sel, setSel] = useState<BrowserEntry | undefined>();
  const [json, setJson] = useState<unknown>();

  const load = () =>
    call<BrowserData>('browser.data')
      .then((d) => {
        setData(d);
        setError(undefined);
      })
      .catch((e) => setError(String(e?.message ?? e)));
  useEffect(() => {
    void load();
    const a = onEvent('browser.refresh', () => void load());
    const b = onEvent<string>('browser.query', (q) => {
      setQuery(q);
      setMode('craft');
    });
    return () => {
      a();
      b();
    };
  }, []);

  const results = useMemo(() => (data ? searchRecipes(data, { query, mode, type, source }) : []), [data, query, mode, type, source]);
  const types = useMemo(() => (data ? recipeTypes(data.entries) : []), [data]);
  useEffect(() => setLimit(PAGE), [query, mode, type, source]);

  useEffect(() => {
    if (!sel) return setJson(undefined);
    let alive = true;
    void call('browser.get', { key: sel.key }).then((j) => alive && setJson(j));
    return () => {
      alive = false;
    };
  }, [sel?.key]);

  const model = useMemo(() => (json ? parseRecipe(json) : undefined), [json]);
  const navigate = (id: string | undefined, m: SearchMode) => {
    if (!id) return;
    setQuery(id);
    setMode(m);
  };
  const h: ViewHandlers = {
    editable: false,
    onSelect: (ref) => {
      if (!model) return;
      if (ref.startsWith('result:')) return navigate(model.results[0]?.id, 'uses');
      const ing = ref.startsWith('grid:')
        ? model.grid?.cells[Number(ref.split(':')[1])]?.[Number(ref.split(':')[2])]
        : model.slots.find((s) => s.ref === ref)?.ingredient;
      navigate(ing?.ids[0], 'craft');
    },
    onContext: (ref) => {
      if (!model) return;
      const ing = ref.startsWith('grid:')
        ? model.grid?.cells[Number(ref.split(':')[1])]?.[Number(ref.split(':')[2])]
        : model.slots.find((s) => s.ref === ref)?.ingredient;
      navigate(ref.startsWith('result:') ? model.results[0]?.id : ing?.ids[0], 'uses');
    },
  };

  const act = (method: string, entry: BrowserEntry) =>
    call(method, { key: entry.key, entry }).catch((e) => call('ui.notify', { message: String(e?.message ?? e), level: 'error' }));

  return (
    <div class="rb-app">
      <div class="rb-toolbar">
        <input
          class="mc-input"
          type="search"
          autoFocus
          value={query}
          placeholder={t('Search by item name or id (e.g. iron ingot, minecraft:stick, #minecraft:planks)…')}
          onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
        />
        <div class="mc-tabs" style={{ marginBottom: 0 }}>
          {(
            [
              ['all', t('All')],
              ['craft', t('How to craft')],
              ['uses', t('Uses')],
            ] as [SearchMode, string][]
          ).map(([m, label]) => (
            <button class={`mc-tab ${mode === m ? 'active' : ''}`} onClick={() => setMode(m)}>
              {label}
            </button>
          ))}
        </div>
        <select class="mc-select" value={type} onChange={(e) => setType((e.target as HTMLSelectElement).value)}>
          <option value="">{t('All types')}</option>
          {types.map((x) => (
            <option value={x.type}>
              {typeLabel(x.type)} ({x.count})
            </option>
          ))}
        </select>
        <select class="mc-select" value={source} onChange={(e) => setSource((e.target as HTMLSelectElement).value as any)}>
          <option value="">{t('Workspace + vanilla')}</option>
          <option value="workspace">{t('Workspace only')}</option>
          <option value="vanilla">{t('Vanilla only')}</option>
        </select>
        <span class="mc-muted">{data ? t('{0} recipes', results.length) : t('Loading recipes…')}</span>
      </div>
      {error ? <div class="mc-error">{error}</div> : null}
      {data && !data.vanillaAvailable ? <div class="mc-warning">{t('Vanilla recipes for {0} are not available (offline?). Only workspace recipes are listed.', data.version)}</div> : null}
      <div class="rb-body">
        <div class="rb-list">
          {results.slice(0, limit).map((e) => (
            <Row e={e} data={data!} active={sel?.key === e.key} onClick={() => setSel(e)} onOpen={() => void act('browser.open', e)} />
          ))}
          {results.length > limit ? (
            <div class="rb-more">
              <Btn secondary onClick={() => setLimit(limit + PAGE)}>
                {t('Show more ({0} left)', results.length - limit)}
              </Btn>
            </div>
          ) : null}
          {data && !results.length ? <div class="rb-empty mc-muted">{t('No recipes found.')}</div> : null}
        </div>
        <div class="rb-preview">
          {sel && model ? (
            <>
              <div class="rc-header">
                <h1 style={{ fontSize: '1.05em' }}>{sel.id}</h1>
                <span class={`mc-badge ${sel.source === 'workspace' ? 'rb-src-ws' : ''}`}>{sel.source === 'workspace' ? t('Workspace') : t('Vanilla')}</span>
                <span class="mc-spacer" />
                <Btn onClick={() => void act('browser.open', sel)}>{sel.source === 'workspace' ? t('Open in editor') : t('Open preview')}</Btn>
                {sel.source === 'workspace' ? (
                  <Btn secondary onClick={() => void act('browser.openText', sel)}>
                    {t('Show JSON')}
                  </Btn>
                ) : (
                  <Btn secondary onClick={() => void act('browser.copy', sel)} title={t('Copy this recipe into data/{0}/recipe/', data?.defaultNamespace ?? '')}>
                    {t('Copy to my mod')}
                  </Btn>
                )}
              </div>
              <RecipeView model={model} h={h} />
              <div class="rc-hint">{t('Click an ingredient to see how to craft it; right-click to see its uses.')}</div>
            </>
          ) : (
            <div class="mc-muted rb-empty">{t('Select a recipe to preview it. Double-click to open it.')}</div>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ e, data, active, onClick, onOpen }: { e: BrowserEntry; data: BrowserData; active: boolean; onClick: () => void; onOpen: () => void }): JSX.Element {
  const name = e.result ? data.names[e.result] ?? e.result : e.id;
  return (
    <div class={`rb-row ${active ? 'active' : ''}`} onClick={onClick} onDblClick={onOpen} title={e.id}>
      {e.result ? <ItemIcon id={e.result} size={24} /> : <div style={{ width: '24px', height: '24px' }} />}
      <div class="rb-text">
        <span class="rb-name">
          {e.count > 1 ? `${e.count} × ` : ''}
          {name}
        </span>
        <span class="rb-id">{e.id}</span>
      </div>
      <span class="mc-badge" title={e.type}>
        {typeLabel(e.type)}
      </span>
      {e.source === 'workspace' ? <span class="mc-badge rb-src-ws">{t('Workspace')}</span> : null}
    </div>
  );
}

render(<App />, document.getElementById('app')!);
