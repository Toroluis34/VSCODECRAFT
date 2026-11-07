// "New Item…" / "New Block…" generator: form wizard with live icon preview, file plan and Java snippet.
import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ItemVisual, TextureRef } from '../../src/shared/protocol';
import type {
  BlockTemplate,
  GeneratorForm,
  GeneratorInit,
  GeneratorPreview,
  GeneratorResult,
  SetVariant,
  TextureChoice,
  TextureOption,
  ToolKind,
  ToolTier,
} from '../../src/features/models/viewTypes';
import { boot, call } from '../shared/vscode';
import { t } from '../shared/i18n';
import { loadImage, renderVisual, textureFrame } from '../shared/itemRenderer';
import { Button } from '../shared/components';

const CSS = `
.gen { display: grid; grid-template-columns: minmax(320px, 1fr) minmax(300px, 460px); gap: 16px; align-items: start; }
@media (max-width: 760px) { .gen { grid-template-columns: 1fr; } }
.gen h1 { margin-top: 0; display: flex; align-items: center; gap: 8px; }
.gen-form { display: flex; flex-direction: column; gap: 12px; }
.gen-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 12px; }
.gen-grid2 .mc-input, .gen-grid2 .mc-select { width: 100%; }
.gen-section { display: flex; flex-direction: column; gap: 8px; }
.gen-section > h3 { margin: 0; font-size: 1em; }
.gen-radio { display: flex; flex-wrap: wrap; gap: 6px; }
.gen-radio label { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border: 1px solid var(--vscode-widget-border, rgba(128,128,128,.35)); border-radius: 4px; cursor: pointer; }
.gen-radio label.on { border-color: var(--vscode-focusBorder); background: var(--vscode-list-hoverBackground); }
.gen-slot { display: grid; grid-template-columns: 40px 90px 1fr; gap: 8px; align-items: center; }
.gen-slot canvas { width: 40px; height: 40px; image-rendering: pixelated; background: repeating-conic-gradient(#8885 0 25%, transparent 0 50%) 0 0/10px 10px; border: 1px solid var(--vscode-widget-border, rgba(128,128,128,.35)); }
.gen-slot-body { display: flex; gap: 6px; align-items: center; min-width: 0; }
.gen-slot-body .mc-input { flex: 1; min-width: 0; }
.gen-checks { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 4px 12px; }
.gen-checks label { display: inline-flex; align-items: center; gap: 6px; }
.gen-preview { position: sticky; top: 0; display: flex; flex-direction: column; gap: 12px; }
.gen-icon { display: flex; gap: 16px; align-items: center; }
.gen-icon .mc-slot { width: 84px; height: 84px; }
.gen-big { width: 128px; height: 128px; image-rendering: pixelated; }
.gen-files { max-height: 260px; overflow: auto; font-size: 0.88em; }
.gen-files div { display: flex; gap: 6px; align-items: baseline; padding: 1px 0; }
.gen-files .act { flex: 0 0 64px; font-size: 0.85em; text-align: center; border-radius: 8px; padding: 0 4px; }
.act-create, .act-created { background: rgba(80, 180, 80, .25); }
.act-merge, .act-updated { background: rgba(80, 140, 220, .25); }
.act-skip, .act-skipped { background: rgba(128, 128, 128, .25); }
.act-error { background: rgba(220, 80, 80, .35); }
.gen-files a { cursor: pointer; }
pre.gen-snippet { margin: 0; padding: 8px; max-height: 300px; overflow: auto; background: var(--vscode-textCodeBlock-background, rgba(128,128,128,.12)); border-radius: 4px; font-family: var(--vscode-editor-font-family, monospace); font-size: 0.85em; white-space: pre-wrap; overflow-wrap: anywhere; }
.gen-errors { color: var(--vscode-errorForeground); }
.gen-ids { display: flex; flex-wrap: wrap; gap: 4px; }
`;

const TEMPLATE_SLOTS: Record<BlockTemplate, string[]> = {
  cube_all: ['all'],
  cube_column: ['side', 'end'],
  orientable: ['front', 'side', 'top'],
  cross: ['cross'],
};
const SLOT_LABELS: Record<string, string> = {
  layer0: 'Texture',
  all: 'All faces',
  side: 'Side',
  end: 'Top / bottom',
  front: 'Front',
  top: 'Top',
  cross: 'Plant',
};
const TEMPLATES: [BlockTemplate, string][] = [
  ['cube_all', 'Cube (same texture on every face)'],
  ['cube_column', 'Pillar / log (side + ends)'],
  ['orientable', 'Orientable (front, side, top)'],
  ['cross', 'Plant (cross)'],
];
const VARIANTS: [SetVariant, string][] = [
  ['stairs', 'Stairs'],
  ['slab', 'Slab'],
  ['wall', 'Wall'],
  ['fence', 'Fence'],
  ['fence_gate', 'Fence Gate'],
  ['button', 'Button'],
  ['pressure_plate', 'Pressure Plate'],
  ['door', 'Door'],
  ['trapdoor', 'Trapdoor'],
  ['pane', 'Pane'],
];

function toId(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function Thumb({ tex }: { tex: TextureRef | null | undefined }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, c.width, c.height);
    g.imageSmoothingEnabled = false;
    if (!tex) return;
    let alive = true;
    void loadImage(tex.src).then((img) => {
      if (!alive || !img) return;
      const [x, y, w, h] = textureFrame(tex, img);
      g.drawImage(img, x, y, w, h, 0, 0, c.width, c.height);
    });
    return () => {
      alive = false;
    };
  }, [tex?.src, tex?.rect?.join(',')]);
  return <canvas ref={ref} width={32} height={32} />;
}

function BigIcon({ visual }: { visual: ItemVisual | undefined }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current && visual) void renderVisual(ref.current, visual);
  }, [visual]);
  return <canvas ref={ref} class="gen-big" width={256} height={256} />;
}

function SmallIcon({ visual }: { visual: ItemVisual | undefined }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current && visual) void renderVisual(ref.current, visual);
  }, [visual]);
  return <canvas ref={ref} class="mc-icon" width={64} height={64} style={{ width: '64px', height: '64px' }} />;
}

function App() {
  const init = boot<GeneratorInit>().state;
  const [form, setForm] = useState<GeneratorForm>({
    mode: init.mode,
    namespace: init.namespace,
    id: '',
    nameEn: '',
    nameEs: '',
    itemParent: 'generated',
    template: 'cube_all',
    textures: {},
    variants: [],
    blockstate: true,
    blockItem: true,
    itemDefinition: true,
    lang: true,
    loot: true,
    recipe: false,
    recipeIngredient: init.mode === 'item' ? 'minecraft:diamond' : 'minecraft:stone',
    tool: init.mode === 'block' ? 'pickaxe' : 'none',
    tier: 'none',
  });
  const [idTouched, setIdTouched] = useState(false);
  const [preview, setPreview] = useState<GeneratorPreview | null>(null);
  const [result, setResult] = useState<GeneratorResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [textureList, setTextureList] = useState<TextureOption[]>([]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void call<TextureOption[]>('generator.textures').then(setTextureList).catch(() => setTextureList([]));
  }, []);

  useEffect(() => {
    let alive = true;
    const h = window.setTimeout(async () => {
      try {
        const p = await call<GeneratorPreview>('generator.preview', form);
        if (alive) setPreview(p);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    }, 180);
    return () => {
      alive = false;
      window.clearTimeout(h);
    };
  }, [form]);

  const set = (patch: Partial<GeneratorForm>) => {
    setResult(null);
    setForm((f) => ({ ...f, ...patch }));
  };
  const setChoice = (slot: string, patch: Partial<TextureChoice>) =>
    set({ textures: { ...form.textures, [slot]: { ...(form.textures[slot] ?? { source: 'placeholder' }), ...patch } } });

  const slots = form.mode === 'item' ? ['layer0'] : TEMPLATE_SLOTS[form.template];
  const browse = async (slot: string) => {
    const r = await call<{ file: string; src: string; existingId?: string } | undefined>('generator.browse');
    if (!r) return;
    if (r.existingId) setChoice(slot, { source: 'existing', id: r.existingId });
    else setChoice(slot, { source: 'file', file: r.file });
  };

  const create = async () => {
    setBusy(true);
    setError('');
    try {
      setResult(await call<GeneratorResult>('generator.create', form));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const copy = async (text: string) => {
    await call('generator.copy', { text });
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const valid = !!form.id && !preview?.errors.length;
  const isBlock = form.mode === 'block';
  const check = (key: keyof GeneratorForm, label: string, title?: string) => (
    <label title={title}>
      <input type="checkbox" checked={!!form[key]} onChange={(e) => set({ [key]: (e.target as HTMLInputElement).checked } as Partial<GeneratorForm>)} />
      {label}
    </label>
  );

  return (
    <div>
      <style>{CSS}</style>
      <div class="gen">
        <div class="gen-form">
          <h1>
            {isBlock ? t('New Block') : t('New Item')}
            <span class="mc-badge">Minecraft {init.version}</span>
            <span class="mc-badge">{init.loader}</span>
          </h1>
          {init.resourceRoot ? (
            <div class="mc-muted">{t('Files are created in {0}', init.resourceRoot)}</div>
          ) : (
            <div class="gen-errors">{t('No resource folder found: open a mod project or a pack folder.')}</div>
          )}

          <div class="gen-section mc-card">
            <h3>{t('Identity')}</h3>
            <div class="gen-grid2">
              <label class="mc-field">
                {t('Display name (English)')}
                <input
                  class="mc-input"
                  value={form.nameEn}
                  placeholder={isBlock ? 'Ruby Block' : 'Ruby'}
                  onInput={(e) => {
                    const v = (e.target as HTMLInputElement).value;
                    set(idTouched ? { nameEn: v } : { nameEn: v, id: toId(v) });
                  }}
                />
              </label>
              <label class="mc-field">
                {t('Display name (Spanish, optional)')}
                <input class="mc-input" value={form.nameEs} placeholder={isBlock ? 'Bloque de rubí' : 'Rubí'} onInput={(e) => set({ nameEs: (e.target as HTMLInputElement).value })} />
              </label>
              <label class="mc-field">
                {t('Namespace')}
                <input class="mc-input mono" list="gen-ns" value={form.namespace} onInput={(e) => set({ namespace: (e.target as HTMLInputElement).value.trim() })} />
                <datalist id="gen-ns">
                  {init.namespaces.map((n) => (
                    <option value={n} />
                  ))}
                </datalist>
              </label>
              <label class="mc-field">
                {t('ID')}
                <input
                  class="mc-input mono"
                  value={form.id}
                  placeholder={isBlock ? 'ruby_block' : 'ruby'}
                  onInput={(e) => {
                    setIdTouched(true);
                    set({ id: (e.target as HTMLInputElement).value.trim() });
                  }}
                />
              </label>
            </div>
          </div>

          <div class="gen-section mc-card">
            <h3>{isBlock ? t('Model template') : t('Item model')}</h3>
            {isBlock ? (
              <div class="gen-radio">
                {TEMPLATES.map(([v, label]) => (
                  <label class={form.template === v ? 'on' : ''}>
                    <input type="radio" name="tpl" checked={form.template === v} onChange={() => set({ template: v })} />
                    {t(label)}
                  </label>
                ))}
              </div>
            ) : (
              <div class="gen-radio">
                <label class={form.itemParent === 'generated' ? 'on' : ''}>
                  <input type="radio" name="parent" checked={form.itemParent === 'generated'} onChange={() => set({ itemParent: 'generated' })} />
                  {t('Generated (normal item)')}
                </label>
                <label class={form.itemParent === 'handheld' ? 'on' : ''}>
                  <input type="radio" name="parent" checked={form.itemParent === 'handheld'} onChange={() => set({ itemParent: 'handheld' })} />
                  {t('Handheld (tools, weapons)')}
                </label>
              </div>
            )}
            <h3>{t('Textures')}</h3>
            {slots.map((slot) => {
              const c = form.textures[slot] ?? { source: 'placeholder' };
              return (
                <div class="gen-slot">
                  <Thumb tex={preview?.textures[slot]} />
                  <span>{t(SLOT_LABELS[slot] ?? slot)}</span>
                  <div class="gen-slot-body">
                    <select class="mc-select" value={c.source} onChange={(e) => setChoice(slot, { source: (e.target as HTMLSelectElement).value as TextureChoice['source'] })}>
                      <option value="placeholder">{t('Placeholder')}</option>
                      <option value="existing">{t('Existing texture')}</option>
                      <option value="file">{t('PNG file…')}</option>
                    </select>
                    {c.source === 'placeholder' ? (
                      <input type="color" value={c.color || preview?.colors[slot] || '#888888'} onInput={(e) => setChoice(slot, { color: (e.target as HTMLInputElement).value })} title={t('Placeholder colour')} />
                    ) : null}
                    {c.source === 'existing' ? (
                      <>
                        <input
                          class="mc-input mono"
                          list="gen-textures"
                          value={c.id ?? ''}
                          placeholder={isBlock ? 'minecraft:block/stone' : 'minecraft:item/diamond'}
                          onInput={(e) => setChoice(slot, { id: (e.target as HTMLInputElement).value.trim() })}
                        />
                      </>
                    ) : null}
                    {c.source === 'file' ? (
                      <>
                        <span class="mc-muted mono mc-grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.file}>
                          {c.file ? c.file.split(/[\\/]/).pop() : t('No file selected')}
                        </span>
                        <Button secondary onClick={() => void browse(slot)}>
                          {t('Browse…')}
                        </Button>
                      </>
                    ) : null}
                  </div>
                </div>
              );
            })}
            <datalist id="gen-textures">
              {textureList.map((o) => (
                <option value={o.id} />
              ))}
            </datalist>
          </div>

          {isBlock && form.template !== 'cross' ? (
            <div class="gen-section mc-card">
              <h3>{t('Also create variants (same texture)')}</h3>
              <div class="gen-checks">
                {VARIANTS.map(([v, label]) => (
                  <label>
                    <input
                      type="checkbox"
                      checked={form.variants.includes(v)}
                      onChange={(e) => set({ variants: (e.target as HTMLInputElement).checked ? [...form.variants, v] : form.variants.filter((x) => x !== v) })}
                    />
                    {t(label)}
                  </label>
                ))}
              </div>
            </div>
          ) : null}

          <div class="gen-section mc-card">
            <h3>{t('Files to create')}</h3>
            <div class="gen-checks">
              {isBlock ? check('blockstate', t('Blockstate')) : null}
              {isBlock ? check('blockItem', init.hasItemDefinitions ? t('Block item (items/*.json)') : t('Block item model')) : null}
              {!isBlock && init.hasItemDefinitions ? check('itemDefinition', t('Item model definition (items/*.json)')) : null}
              {check('lang', t('Lang entries'), t('Merged into en_us.json (and es_es.json) without overwriting existing keys'))}
              {isBlock ? check('loot', t('Loot table (drops itself)')) : null}
              {check('recipe', t('Recipe stub'))}
            </div>
            {form.recipe ? (
              <label class="mc-field">
                {isBlock ? t('Recipe ingredient (3×3 → 1 block)') : t('Recipe ingredient (shapeless)')}
                <input class="mc-input mono" value={form.recipeIngredient} onInput={(e) => set({ recipeIngredient: (e.target as HTMLInputElement).value.trim() })} />
              </label>
            ) : null}
            {isBlock ? (
              <div class="gen-grid2">
                <label class="mc-field">
                  {t('Mineable with')}
                  <select class="mc-select" value={form.tool} onChange={(e) => set({ tool: (e.target as HTMLSelectElement).value as ToolKind })}>
                    <option value="none">{t('Any tool (no tag)')}</option>
                    <option value="pickaxe">{t('Pickaxe')}</option>
                    <option value="axe">{t('Axe')}</option>
                    <option value="shovel">{t('Shovel')}</option>
                    <option value="hoe">{t('Hoe')}</option>
                  </select>
                </label>
                <label class="mc-field">
                  {t('Required tool tier')}
                  <select class="mc-select" value={form.tier} onChange={(e) => set({ tier: (e.target as HTMLSelectElement).value as ToolTier })}>
                    <option value="none">{t('None')}</option>
                    <option value="stone">{t('Stone')}</option>
                    <option value="iron">{t('Iron')}</option>
                    <option value="diamond">{t('Diamond')}</option>
                  </select>
                </label>
              </div>
            ) : null}
          </div>

          <div class="mc-row">
            <button class="mc-button" disabled={!valid || busy || !init.resourceRoot} onClick={() => void create()}>
              {busy ? t('Creating…') : isBlock ? t('Create block') : t('Create item')}
            </button>
            {error ? <span class="gen-errors">{error}</span> : null}
          </div>
        </div>

        <div class="gen-preview">
          <div class="mc-card gen-icon">
            <BigIcon visual={preview?.visual} />
            <div class="mc-col">
              <div class="mc-slot mc-slot-large" style={{ width: '72px', height: '72px' }}>
                <SmallIcon visual={preview?.visual} />
              </div>
              <span class="mono mv-small">
                {form.namespace}:{form.id || '…'}
              </span>
            </div>
          </div>
          {preview?.errors.length ? (
            <div class="gen-errors">
              {preview.errors.map((e) => (
                <div>{e}</div>
              ))}
            </div>
          ) : null}
          {preview && preview.ids.length > 1 ? (
            <div class="gen-ids">
              {preview.ids.map((id) => (
                <span class="mc-badge mono">{id}</span>
              ))}
            </div>
          ) : null}
          <div class="mc-card">
            <h3 style={{ marginTop: 0 }}>{result ? t('Summary') : t('Files')}</h3>
            <div class="gen-files">
              {result
                ? result.files.map((f) => (
                    <div title={f.detail}>
                      <span class={`act act-${f.status}`}>{t(f.status)}</span>
                      <a class="mono" onClick={() => f.status !== 'error' && call('file.open', { uri: f.uri })}>
                        {f.path}
                      </a>
                    </div>
                  ))
                : (preview?.files ?? []).map((f) => (
                    <div>
                      <span class={`act act-${f.action}`}>{t(f.action)}</span>
                      <span class="mono">{f.path}</span>
                    </div>
                  ))}
            </div>
          </div>
          {preview ? (
            <div class="mc-card">
              <div class="mc-row" style={{ marginBottom: '6px' }}>
                <h3 style={{ margin: 0 }}>{t('Java registration')}</h3>
                <span class="mc-muted">{preview.snippetTitle}</span>
                <span class="mc-spacer" />
                <Button secondary onClick={() => void copy(result?.snippet ?? preview.snippet)}>
                  {copied ? t('Copied!') : t('Copy')}
                </Button>
              </div>
              <pre class="gen-snippet">{result?.snippet ?? preview.snippet}</pre>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

render(<App />, document.getElementById('app')!);
