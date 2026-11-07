// Tag Viewer / Editor webview (custom text editor for data/<ns>/tags/**.json).
import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { boot, call, onEvent } from '../shared/vscode';
import { t } from '../shared/i18n';
import { Button, ItemIcon, ItemPicker, useName } from '../shared/components';

interface Entry {
  id: string;
  required: boolean;
  isTag: boolean;
  known: boolean;
}

interface TagData {
  uri: string;
  tagId: string;
  registry: string;
  version: string;
  replace: boolean;
  parseError: boolean;
  values: Entry[];
  vanilla: { exists: boolean; count: number; values: string[] };
  relation: 'extends' | 'overrides' | 'new';
  resolvedCount: number;
  otherFiles: string[];
  usedBy: { tag: string; source: 'vanilla' | 'workspace'; uri?: string }[];
  referencedIn: { uri: string; label: string }[];
  iconRegistry: boolean;
}

const STYLE = `
.tag-root { padding: 12px 16px; display: flex; flex-direction: column; gap: 12px; max-width: 1200px; }
.tag-header h1 { font-size: 1.35em; margin: 0; font-weight: 600; word-break: break-all; }
.tag-layout { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 12px; align-items: start; }
@media (max-width: 760px) { .tag-layout { grid-template-columns: 1fr; } }
.tag-entry { display: flex; align-items: center; gap: 8px; padding: 3px 6px; border-radius: 3px; }
.tag-entry:hover { background: var(--vscode-list-hoverBackground); }
.tag-entry .tag-actions { visibility: hidden; display: flex; gap: 2px; }
.tag-entry:hover .tag-actions { visibility: visible; }
.tag-entry .tag-id { font-family: var(--vscode-editor-font-family); font-size: .9em; color: var(--vscode-descriptionForeground); }
.tag-entry.unknown .tag-name { text-decoration: wavy underline var(--vscode-editorWarning-foreground, #cca700); }
.tag-children { margin-left: 22px; border-left: 1px dashed var(--vscode-panel-border, rgba(128,128,128,.4)); padding-left: 6px; }
.tag-twisty { width: 18px; text-align: center; cursor: pointer; user-select: none; opacity: .8; }
.tag-generic { width: 24px; height: 24px; display: inline-flex; align-items: center; justify-content: center; border-radius: 4px;
  background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); font-size: 11px; font-weight: 700; flex: none; }
.tag-stat { font-size: 1.6em; font-weight: 600; }
.tag-chips { display: flex; flex-wrap: wrap; gap: 4px; max-height: 160px; overflow: auto; }
.tag-chip { font-family: var(--vscode-editor-font-family); font-size: .85em; padding: 1px 6px; border-radius: 3px; background: var(--vscode-textBlockQuote-background, rgba(128,128,128,.15)); }
.tag-link { color: var(--vscode-textLink-foreground); cursor: pointer; }
.tag-link:hover { text-decoration: underline; }
.tag-section-title { font-weight: 600; margin-bottom: 6px; display: flex; align-items: center; gap: 6px; }
.tag-empty { padding: 16px; text-align: center; }
.tag-optional { font-size: .85em; display: inline-flex; gap: 3px; align-items: center; color: var(--vscode-descriptionForeground); }
`;

function EntryIcon({ id, iconRegistry, size = 24 }: { id: string; iconRegistry: boolean; size?: number }) {
  if (iconRegistry) return <ItemIcon id={id} size={size} cycleMs={1200} />;
  const isTag = id.startsWith('#');
  const label = (id.replace(/^#/, '').split(':').pop() ?? '?').replace(/[^a-z]/g, '').slice(0, 2).toUpperCase();
  return <span class="tag-generic" style={{ width: `${size}px`, height: `${size}px` }}>{isTag ? '#' : label || '?'}</span>;
}

function EntryRow(p: { entry: Entry; data: TagData; depth: number; onChange?: (op: string, extra?: Record<string, unknown>) => void; index?: number; count?: number }) {
  const { entry, data } = p;
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState<string[] | undefined>();
  const name = useName(!entry.isTag && data.iconRegistry ? entry.id : undefined);
  const toggle = async () => {
    if (!entry.isTag) return;
    if (!open && !children) {
      const res = await call<{ values: string[] }>('tag.children', { tag: entry.id }).catch(() => ({ values: [] }));
      setChildren(res.values);
    }
    setOpen(!open);
  };
  const editable = p.depth === 0 && !!p.onChange;
  return (
    <div>
      <div class={`tag-entry ${entry.known ? '' : 'unknown'}`} data-id={entry.id}>
        <span class="tag-twisty" onClick={toggle}>
          {entry.isTag ? (open ? '▾' : '▸') : ''}
        </span>
        <EntryIcon id={entry.id} iconRegistry={data.iconRegistry} />
        <div class="mc-col mc-grow" style={{ gap: '0' }}>
          <span class="tag-name" title={entry.known ? '' : t('Unknown id for this version (typo or missing mod?)')}>
            {entry.isTag ? (
              <span class="tag-link" onClick={() => call('tag.openTag', { tag: entry.id })}>
                {entry.id}
              </span>
            ) : (
              name || entry.id
            )}
          </span>
          {!entry.isTag && name ? <span class="tag-id">{entry.id}</span> : null}
        </div>
        {editable ? (
          <>
            <label class="tag-optional" title={t('Optional entries are skipped when the id does not exist (e.g. another mod is not installed).')}>
              <input type="checkbox" checked={!entry.required} onChange={(e) => p.onChange!('required', { value: !(e.target as HTMLInputElement).checked })} />
              {t('optional')}
            </label>
            <span class="tag-actions">
              <button class="mc-icon-button" title={t('Move up')} disabled={p.index === 0} onClick={() => p.onChange!('move', { delta: -1 })}>
                ↑
              </button>
              <button class="mc-icon-button" title={t('Move down')} disabled={p.index === (p.count ?? 0) - 1} onClick={() => p.onChange!('move', { delta: 1 })}>
                ↓
              </button>
              <button class="mc-icon-button" title={t('Remove')} onClick={() => p.onChange!('remove')}>
                ✕
              </button>
            </span>
          </>
        ) : null}
      </div>
      {open && children ? (
        <div class="tag-children">
          {children.length === 0 ? <div class="mc-muted" style={{ padding: '2px 6px' }}>{t('(empty)')}</div> : null}
          {p.depth < 6
            ? children.map((c) => (
                <EntryRow key={c} entry={{ id: c, required: true, isTag: c.startsWith('#'), known: true }} data={data} depth={p.depth + 1} />
              ))
            : null}
        </div>
      ) : null}
    </div>
  );
}

function App() {
  const [data, setData] = useState<TagData | undefined>();
  const [error, setError] = useState('');
  const [manual, setManual] = useState('');
  const [showVanilla, setShowVanilla] = useState(false);

  useEffect(() => {
    call<TagData>('tag.load')
      .then(setData)
      .catch((e) => setError(String(e?.message ?? e)));
    return onEvent<TagData>('tag.data', setData);
  }, []);

  if (error) return <div class="tag-root mc-error">{error}</div>;
  if (!data) return <div class="tag-root mc-muted">{t('Loading…')}</div>;

  const edit = async (op: string, extra: Record<string, unknown> = {}) => {
    try {
      setData(await call<TagData>('tag.edit', { op, ...extra }));
    } catch (e: any) {
      setError(String(e?.message ?? e));
    }
  };
  const add = (id: string) => {
    const v = id.trim();
    if (!v) return;
    void edit('add', { id: v });
  };

  const relation =
    data.relation === 'extends'
      ? t('Adds to the vanilla tag #{0} ({1} vanilla entries are kept).', data.tagId, data.vanilla.count)
      : data.relation === 'overrides'
        ? t('Replaces the vanilla tag #{0}: its {1} vanilla entries are removed.', data.tagId, data.vanilla.count)
        : t('New tag (not a vanilla tag).');

  return (
    <div class="tag-root">
      <style>{STYLE}</style>
      <div class="tag-header mc-row">
        <EntryIcon id={`#${data.tagId}`} iconRegistry={data.iconRegistry} size={32} />
        <div class="mc-col mc-grow" style={{ gap: '2px' }}>
          <h1>#{data.tagId}</h1>
          <div class="mc-row" style={{ gap: '6px' }}>
            <span class="mc-badge">{data.registry}</span>
            <span class="mc-muted">Minecraft {data.version}</span>
          </div>
        </div>
        <Button secondary onClick={() => call('tag.openText')}>
          {t('Open as text')}
        </Button>
      </div>

      {data.parseError ? <div class="mc-card mc-error">{t('This file has JSON errors: fix them in the text editor before editing here.')}</div> : null}
      {data.otherFiles.length ? (
        <div class="mc-card mc-warning">
          {t('This tag is also defined in:')} {data.otherFiles.join(', ')}
        </div>
      ) : null}

      <div class="tag-layout">
        <div class="mc-col">
          <div class="mc-card mc-row">
            <div class="mc-col" style={{ gap: '0' }}>
              <span class="tag-stat">{data.resolvedCount}</span>
              <span class="mc-muted">{t('resolved entries')}</span>
            </div>
            <div class="mc-col mc-grow" style={{ gap: '4px' }}>
              <span>{relation}</span>
              <label class="mc-row" style={{ gap: '6px' }} title={t('"replace": true discards entries from lower-priority packs and vanilla.')}>
                <input type="checkbox" checked={data.replace} onChange={(e) => edit('replace', { value: (e.target as HTMLInputElement).checked })} />
                <span>
                  {t('Replace')} <code>"replace": true</code>
                </span>
              </label>
            </div>
            {data.vanilla.exists ? (
              <Button secondary onClick={() => setShowVanilla(!showVanilla)}>
                {showVanilla ? t('Hide vanilla entries') : t('Show vanilla entries')}
              </Button>
            ) : null}
          </div>
          {showVanilla ? (
            <div class="mc-card">
              <div class="tag-section-title">{t('Vanilla entries')}</div>
              <div class="tag-chips">
                {data.vanilla.values.map((v) => (
                  <span class="tag-chip">{v}</span>
                ))}
              </div>
            </div>
          ) : null}

          <div class="mc-card">
            <div class="tag-section-title">
              {t('Entries')} <span class="mc-badge">{data.values.length}</span>
            </div>
            {data.values.length === 0 ? <div class="tag-empty mc-muted">{t('No entries yet: pick items on the right or type an id below.')}</div> : null}
            {data.values.map((e, i) => (
              <EntryRow key={e.id} entry={e} data={data} depth={0} index={i} count={data.values.length} onChange={(op, extra) => edit(op, { id: e.id, ...extra })} />
            ))}
            <div class="mc-row" style={{ marginTop: '8px' }}>
              <input
                class="mc-input mc-grow"
                placeholder={t('Add id or #tag (e.g. {0})', data.registry === 'item' ? 'minecraft:diamond' : '#minecraft:...')}
                value={manual}
                onInput={(e) => setManual((e.target as HTMLInputElement).value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    add(manual);
                    setManual('');
                  }
                }}
              />
              <Button
                onClick={() => {
                  add(manual);
                  setManual('');
                }}
              >
                {t('Add')}
              </Button>
            </div>
          </div>

          <div class="mc-card">
            <div class="tag-section-title">{t('Where is this used')}</div>
            {!data.usedBy.length && !data.referencedIn.length ? <div class="mc-muted">{t('Not referenced by other tags or files.')}</div> : null}
            {data.usedBy.map((u) => (
              <div class="mc-row" style={{ gap: '6px' }}>
                <span class="mc-badge">{u.source === 'vanilla' ? 'vanilla' : t('workspace')}</span>
                <span class={u.uri ? 'tag-link' : ''} onClick={() => u.uri && call('file.open', { uri: u.uri })}>
                  #{u.tag}
                </span>
              </div>
            ))}
            {data.referencedIn.map((r) => (
              <div class="mc-row" style={{ gap: '6px' }}>
                <span class="mc-badge">json</span>
                <span class="tag-link" onClick={() => call('file.open', { uri: r.uri })}>
                  {r.label}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div class="mc-card mc-col">
          <div class="tag-section-title">{t('Add entries')}</div>
          <ItemPicker registry={data.registry} includeTags onPick={add} placeholder={t('Search {0}…', data.registry)} />
          <span class="mc-muted" style={{ fontSize: '.85em' }}>
            {t('Click an entry to add it to the tag.')}
          </span>
        </div>
      </div>
    </div>
  );
}

void boot();
render(<App />, document.getElementById('app')!);
