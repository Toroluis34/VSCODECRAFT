// "Texture Atlas Overview": every workspace texture in a grid with size warnings.
import { render } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { call, onEvent } from '../shared/vscode';
import { t } from '../shared/i18n';
import type { AtlasEntry } from '../../src/features/textures/protocol';
import { SHARED_CSS, useStyle } from '../textureShared/canvas';
import { ICON_CSS, Icon, ToolButton } from '../textureShared/icons';

const CSS = `
.atl-head { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 10px; }
.atl-head h1 { margin: 0 8px 0 0; font-size: 1.25em; }
.atl-head .mc-input[type=search] { width: 240px; }
.atl-group { margin: 14px 0 6px; display: flex; align-items: baseline; gap: 8px; }
.atl-group h2 { margin: 0; font-size: 1em; font-family: var(--vscode-editor-font-family, monospace); }
.atl-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(var(--atl-cell, 96px), 1fr)); gap: 8px; }
.atl-card {
  position: relative; display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 8px 6px 6px;
  border: 1px solid var(--vscode-widget-border, rgba(128,128,128,.3)); border-radius: 4px; cursor: pointer;
  background: var(--vscode-editorWidget-background, transparent); min-width: 0;
}
.atl-card:hover { border-color: var(--vscode-focusBorder); }
.atl-card.warn { border-color: var(--vscode-editorWarning-foreground, #cca700); }
.atl-thumb { width: var(--atl-img, 64px); height: var(--atl-img, 64px); display: flex; align-items: center; justify-content: center; background-size: 8px 8px; border-radius: 3px; overflow: hidden; }
.atl-thumb img { image-rendering: pixelated; max-width: 100%; max-height: 100%; width: 100%; height: 100%; object-fit: contain; object-position: top; }
.atl-thumb.anim img { object-fit: cover; }
.atl-name { font-size: 11px; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.atl-size { font-size: 10px; color: var(--vscode-descriptionForeground); font-variant-numeric: tabular-nums; }
.atl-badges { position: absolute; top: 3px; right: 3px; display: flex; gap: 2px; }
.atl-badge { font-size: 9px; padding: 0 4px; border-radius: 6px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
.atl-warn-icon { position: absolute; top: 3px; left: 4px; color: var(--vscode-editorWarning-foreground, #cca700); }
.atl-summary { display: flex; gap: 12px; font-size: 12px; color: var(--vscode-descriptionForeground); }
.atl-empty { margin: 40px auto; text-align: center; color: var(--vscode-descriptionForeground); }
`;

const WARNING_TEXT: Record<string, string> = {
  'not-power-of-two': 'Width is not a power of two',
  'not-square': 'Not square (block/item textures should be square or an animation strip)',
  'missing-mcmeta': 'Animation strip without .mcmeta',
  'bad-strip': 'Height is not a multiple of the frame size',
  'too-large': 'Very large texture',
  invalid: 'Not a valid PNG',
};

function App() {
  useStyle('tex-atlas-css', SHARED_CSS + ICON_CSS + CSS);
  const [entries, setEntries] = useState<AtlasEntry[] | null>(null);
  const [query, setQuery] = useState('');
  const [onlyWarnings, setOnlyWarnings] = useState(false);
  const [size, setSize] = useState(64);
  const [ns, setNs] = useState('');

  const load = () =>
    void call<AtlasEntry[]>('atlas.list')
      .then(setEntries)
      .catch(() => setEntries([]));
  useEffect(() => {
    load();
    return onEvent('atlas.refresh', load);
  }, []);

  const namespaces = useMemo(() => [...new Set((entries ?? []).map((e) => e.namespace))].sort(), [entries]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (entries ?? []).filter((e) => (!q || e.id.includes(q)) && (!onlyWarnings || e.warnings.length) && (!ns || e.namespace === ns));
  }, [entries, query, onlyWarnings, ns]);
  const groups = useMemo(() => {
    const m = new Map<string, AtlasEntry[]>();
    for (const e of filtered) {
      const key = `${e.namespace}:${e.folder || '.'}`;
      const list = m.get(key) ?? [];
      list.push(e);
      m.set(key, list);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  if (!entries) return <div class="mc-muted">{t('Scanning textures…')}</div>;
  const warnCount = entries.filter((e) => e.warnings.length).length;
  const animCount = entries.filter((e) => e.frames > 1).length;

  return (
    <div style={{ ['--atl-img' as any]: `${size}px`, ['--atl-cell' as any]: `${Math.max(96, size + 32)}px` }}>
      <div class="atl-head">
        <h1>{t('Texture Atlas')}</h1>
        <input class="mc-input" type="search" placeholder={t('Filter textures…')} value={query} onInput={(e) => setQuery((e.target as HTMLInputElement).value)} />
        {namespaces.length > 1 ? (
          <select class="mc-select" value={ns} onChange={(e) => setNs((e.target as HTMLSelectElement).value)}>
            <option value="">{t('All namespaces')}</option>
            {namespaces.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        ) : null}
        <button class={`tex-chip ${onlyWarnings ? 'active' : ''}`} onClick={() => setOnlyWarnings(!onlyWarnings)} disabled={!warnCount}>
          <Icon name="warning" size={12} />
          {t('Warnings ({0})', warnCount)}
        </button>
        <label class="tex-check" style={{ fontSize: '12px', display: 'inline-flex', gap: '6px', alignItems: 'center' }}>
          {t('Size')}
          <input type="range" min={32} max={128} step={16} value={size} onInput={(e) => setSize(Number((e.target as HTMLInputElement).value))} />
        </label>
        <span class="mc-spacer" />
        <ToolButton icon="refresh" title={t('Refresh')} onClick={load} />
        <ToolButton icon="plus" title={t('New Texture…')} label={t('New')} onClick={() => void call('atlas.newTexture')} />
      </div>
      <div class="atl-summary">
        <span>{t('{0} textures', entries.length)}</span>
        <span>{t('{0} animated', animCount)}</span>
        <span>{t('{0} with warnings', warnCount)}</span>
      </div>
      {!entries.length ? <div class="atl-empty">{t('No textures found in assets/<namespace>/textures of this workspace.')}</div> : null}
      {groups.map(([key, list]) => (
        <section key={key}>
          <div class="atl-group">
            <h2>{key.replace(/:\.$/, ':')}/</h2>
            <span class="mc-muted">{list.length}</span>
          </div>
          <div class="atl-grid">
            {list.map((e) => {
              const warn = e.warnings.map((w) => t(WARNING_TEXT[w] ?? w));
              return (
                <div
                  class={`atl-card ${warn.length ? 'warn' : ''}`}
                  key={e.uri}
                  title={[e.id, `${e.width} × ${e.height}`, ...warn].join('\n')}
                  onClick={() => void call('atlas.open', { uri: e.uri })}
                  onContextMenu={(ev) => {
                    ev.preventDefault();
                    void call('atlas.reveal', { uri: e.uri });
                  }}
                >
                  {warn.length ? (
                    <span class="atl-warn-icon">
                      <Icon name="warning" size={12} />
                    </span>
                  ) : null}
                  <div class="atl-badges">{e.frames > 1 ? <span class="atl-badge">{t('{0}f', e.frames)}</span> : null}</div>
                  <div class={`atl-thumb tex-checker ${e.frames > 1 || e.height > e.width ? 'anim' : ''}`}>
                    <img src={e.src} alt={e.path} loading="lazy" />
                  </div>
                  <span class="atl-name">{e.path.split('/').pop()}</span>
                  <span class="atl-size">
                    {e.width}×{e.height}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

render(<App />, document.getElementById('app')!);
