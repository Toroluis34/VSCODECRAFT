// "Create Material Variant…": recolour a set of textures (e.g. every ruby_* tool) and write them under a new name.
import { render } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { boot, call } from '../shared/vscode';
import { t } from '../shared/i18n';
import { adjustImage, type ColorAdjust, dominantHue, fromWire, isIdentityAdjust, type RgbaImage, toWire, type WireImage } from '../../src/features/textures/pixels';
import { guessMaterial, renameVariant } from '../../src/features/textures/textureRefs';
import type { VariantBoot, VariantOutput, VariantSource } from '../../src/features/textures/protocol';
import { PixelImage, SHARED_CSS, useStyle } from '../textureShared/canvas';
import { ICON_CSS, Icon } from '../textureShared/icons';
import { ADJUST_CSS, AdjustControls } from '../textureShared/adjust';

const CSS = `
body { padding: 0; }
.var-app { display: grid; grid-template-columns: 290px 1fr 330px; height: 100vh; }
.var-col { display: flex; flex-direction: column; min-height: 0; padding: 12px; gap: 8px; }
.var-col + .var-col { border-left: 1px solid var(--vscode-panel-border, rgba(128,128,128,.35)); }
.var-list { flex: 1; overflow-y: auto; border: 1px solid var(--vscode-input-border, rgba(128,128,128,.3)); border-radius: 3px; }
.var-item { display: flex; gap: 6px; align-items: center; padding: 3px 8px; font-size: 12px; cursor: pointer; white-space: nowrap; }
.var-item:hover { background: var(--vscode-list-hoverBackground); }
.var-item.checked { background: var(--vscode-list-inactiveSelectionBackground, rgba(128,128,128,.15)); }
.var-item .var-name { overflow: hidden; text-overflow: ellipsis; flex: 1; }
.var-src { font-size: 10px; padding: 0 5px; border-radius: 8px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
.var-grid { flex: 1; overflow-y: auto; display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; align-content: start; }
.var-card { display: flex; flex-direction: column; gap: 6px; padding: 8px; border-radius: 4px; border: 1px solid var(--vscode-widget-border, rgba(128,128,128,.35)); background: var(--vscode-editorWidget-background, transparent); }
.var-pair { display: flex; align-items: center; gap: 8px; justify-content: center; }
.var-pair canvas { border-radius: 3px; background-size: 8px 8px; }
.var-arrow { color: var(--vscode-descriptionForeground); }
.var-target { font-family: var(--vscode-editor-font-family, monospace); font-size: 11px; word-break: break-all; text-align: center; }
.var-from { font-size: 11px; text-align: center; color: var(--vscode-descriptionForeground); word-break: break-all; }
.var-exists { color: var(--vscode-editorWarning-foreground, #cca700); font-size: 11px; text-align: center; }
.var-field { display: flex; flex-direction: column; gap: 3px; font-size: 12px; color: var(--vscode-descriptionForeground); }
.var-field > * { color: var(--vscode-foreground); }
.var-row { display: flex; gap: 6px; align-items: center; }
.var-row > .mc-input { flex: 1; min-width: 0; }
.var-empty { margin: auto; text-align: center; color: var(--vscode-descriptionForeground); max-width: 320px; }
.var-footer { display: flex; flex-direction: column; gap: 8px; margin-top: auto; padding-top: 10px; border-top: 1px solid var(--vscode-panel-border, rgba(128,128,128,.35)); }
`;

type SourceInfo = Omit<VariantSource, 'image'>;

function App() {
  useStyle('tex-variant-css', SHARED_CSS + ICON_CSS + ADJUST_CSS + CSS);
  const b = boot<VariantBoot>().state;
  const sources = b.sources as SourceInfo[];
  const byId = useMemo(() => new Map(sources.map((s) => [s.id, s])), [sources]);
  const [query, setQuery] = useState(() => (b.selected[0] ? guessMaterial(b.selected.map((s) => s.split(':')[1] ?? s)) : ''));
  const [origin, setOrigin] = useState<'workspace' | 'vanilla'>(sources.some((s) => s.uri) ? 'workspace' : 'vanilla');
  const [selected, setSelected] = useState<string[]>(b.selected);
  const [images, setImages] = useState<Map<string, RgbaImage>>(new Map());
  const [adjust, setAdjust] = useState<ColorAdjust>({});
  const [fromWord, setFromWord] = useState('');
  const [fromTouched, setFromTouched] = useState(false);
  const [toWord, setToWord] = useState('');
  const [namespace, setNamespace] = useState(b.defaultNamespace);
  const [overwrite, setOverwrite] = useState(false);
  const [exists, setExists] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');
  const loading = useRef(new Set<string>());

  // Guess the material word from the selection (ruby_sword, ruby_axe → "ruby").
  useEffect(() => {
    if (!fromTouched) setFromWord(guessMaterial(selected.map((id) => byId.get(id)?.path ?? id)));
  }, [selected.join('|')]);

  // Load pixels of selected textures.
  useEffect(() => {
    const missing = selected.filter((id) => !images.has(id) && !loading.current.has(id));
    if (!missing.length) return;
    missing.forEach((id) => loading.current.add(id));
    void call<Record<string, WireImage>>('variant.images', { ids: missing }).then((res) => {
      setImages((prev) => {
        const next = new Map(prev);
        for (const [id, w] of Object.entries(res ?? {})) next.set(id, fromWire(w));
        return next;
      });
    });
  }, [selected.join('|')]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sources.filter((s) => (origin === 'workspace' ? !!s.uri : !s.uri) && (!q || s.id.includes(q))).slice(0, 400);
  }, [query, origin]);

  const targetId = (s: SourceInfo) => `${namespace}:${renameVariant(s.path, fromWord, toWord)}`;
  const outputs = selected.map((id) => byId.get(id)).filter((s): s is SourceInfo => !!s);
  const targets = outputs.map(targetId);

  useEffect(() => {
    if (!toWord.trim()) return setExists({});
    const h = window.setTimeout(() => {
      void call<Record<string, boolean>>('variant.exists', { ids: targets }).then((r) => setExists(r ?? {}));
    }, 200);
    return () => window.clearTimeout(h);
  }, [targets.join('|')]);

  const firstImage = selected.map((id) => images.get(id)).find(Boolean);
  const previews = useMemo(() => {
    const m = new Map<string, RgbaImage>();
    for (const id of selected) {
      const img = images.get(id);
      if (img) m.set(id, isIdentityAdjust(adjust) ? img : adjustImage(img, adjust));
    }
    return m;
  }, [images, adjust, selected.join('|')]);

  // Recolour only the material's main hue by default (keeps stick handles brown).
  const maskInit = useRef(false);
  useEffect(() => {
    if (maskInit.current || !firstImage) return;
    maskInit.current = true;
    const hue = dominantHue(firstImage);
    if (hue !== undefined) setAdjust((a) => (a.mask ? a : { ...a, mask: { hue: Math.round(hue), tolerance: 35 } }));
  }, [firstImage]);

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const sameNames = toWord.trim() && namespace === outputs[0]?.namespace && targets.some((tid, i) => tid === outputs[i].id);
  const ready = outputs.length > 0 && toWord.trim().length > 0 && outputs.every((s) => previews.has(s.id)) && !sameNames;

  const create = async () => {
    setBusy(true);
    setResult('');
    try {
      const list: VariantOutput[] = outputs.map((s, i) => ({ sourceId: s.id, targetId: targets[i], image: toWire(previews.get(s.id)!) }));
      const r = await call<{ written: string[]; skipped: string[] }>('variant.create', { outputs: list, overwrite, open: true });
      setResult(t('Created {0}, skipped {1}.', r.written.length, r.skipped.length));
      const ex = await call<Record<string, boolean>>('variant.exists', { ids: targets });
      setExists(ex ?? {});
    } catch (e) {
      setResult(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="var-app">
      <div class="var-col">
        <div class="tex-section-title">{t('Source textures')}</div>
        <div class="tex-chips">
          <button class={`tex-chip ${origin === 'workspace' ? 'active' : ''}`} onClick={() => setOrigin('workspace')}>
            {t('Workspace')}
          </button>
          <button class={`tex-chip ${origin === 'vanilla' ? 'active' : ''}`} onClick={() => setOrigin('vanilla')}>
            {t('Vanilla')}
          </button>
        </div>
        <input class="mc-input" type="search" placeholder={t('Filter, e.g. diamond_ or ruby')} value={query} onInput={(e) => setQuery((e.target as HTMLInputElement).value)} />
        <div class="var-row">
          <button class="mc-button secondary" disabled={!matches.length} onClick={() => setSelected((s) => [...new Set([...s, ...matches.slice(0, 64).map((m) => m.id)])])}>
            {t('Select all ({0})', Math.min(64, matches.length))}
          </button>
          <button class="mc-button secondary" disabled={!selected.length} onClick={() => setSelected([])}>
            {t('Clear')}
          </button>
        </div>
        <div class="var-list">
          {matches.map((s) => (
            <label class={`var-item ${selected.includes(s.id) ? 'checked' : ''}`} key={s.id} title={s.id}>
              <input type="checkbox" checked={selected.includes(s.id)} onChange={() => toggle(s.id)} />
              <span class="var-name">{s.namespace === 'minecraft' ? s.path : s.id}</span>
              {s.hasMcmeta ? <span class="var-src">{t('anim')}</span> : null}
            </label>
          ))}
          {!matches.length ? <div class="mc-muted tex-pad" style={{ padding: '8px' }}>{t('No textures match')}</div> : null}
        </div>
      </div>

      <div class="var-col">
        <div class="tex-section-title">{t('Preview ({0})', outputs.length)}</div>
        {outputs.length ? (
          <div class="var-grid">
            {outputs.map((s, i) => (
              <div class="var-card" key={s.id}>
                <div class="var-pair">
                  <PixelImage img={images.get(s.id)} size={64} />
                  <span class="var-arrow">
                    <Icon name="right" />
                  </span>
                  <PixelImage img={previews.get(s.id)} size={64} />
                </div>
                <div class="var-from">{s.id}</div>
                <div class="var-target">{toWord.trim() ? targets[i] : '—'}</div>
                {exists[targets[i]] ? <div class="var-exists">{overwrite ? t('will be overwritten') : t('already exists (skipped)')}</div> : null}
              </div>
            ))}
          </div>
        ) : (
          <div class="var-empty">
            <p>{t('Pick one or more source textures on the left — for example every diamond tool — then choose a colour transform and a new material name.')}</p>
          </div>
        )}
      </div>

      <div class="var-col">
        <div class="tex-section-title">{t('Colour transform')}</div>
        <AdjustControls value={adjust} onChange={setAdjust} source={firstImage} />
        <div class="var-footer">
          <div class="tex-section-title">{t('Output names')}</div>
          <label class="var-field">
            {t('Replace the word')}
            <input
              class="mc-input mono"
              value={fromWord}
              placeholder="ruby"
              onInput={(e) => {
                setFromTouched(true);
                setFromWord((e.target as HTMLInputElement).value);
              }}
            />
          </label>
          <label class="var-field">
            {t('with (new material)')}
            <input class="mc-input mono" value={toWord} placeholder="sapphire" onInput={(e) => setToWord((e.target as HTMLInputElement).value.toLowerCase().replace(/[^a-z0-9_.-]/g, '_'))} />
          </label>
          <label class="var-field">
            {t('Namespace')}
            <select class="mc-select" value={namespace} onChange={(e) => setNamespace((e.target as HTMLSelectElement).value)}>
              {b.namespaces.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label class="tex-check">
            <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite((e.target as HTMLInputElement).checked)} />
            {t('Overwrite existing files')}
          </label>
          {sameNames ? <div class="mc-warning" style={{ fontSize: '12px' }}>{t('The new names are the same as the sources. Change the material word.')}</div> : null}
          <button class="mc-button" disabled={!ready || busy} onClick={create}>
            {busy ? t('Creating…') : t('Create {0} texture(s)', outputs.length)}
          </button>
          {result ? <div class="mc-muted" style={{ fontSize: '12px' }}>{result}</div> : null}
          <div class="mc-muted" style={{ fontSize: '11px' }}>{t('Animated textures keep their .mcmeta.')}</div>
        </div>
      </div>
    </div>
  );
}

render(<App />, document.getElementById('app')!);
