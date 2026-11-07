// Text Component Editor + MOTD preview webview.
import { render } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { boot, call, onEvent } from '../shared/vscode';
import { t } from '../shared/i18n';
import { Button } from '../shared/components';
import {
  ampersandToSection,
  colorToHex,
  componentToJson,
  componentToLegacy,
  componentToSnbt,
  convertComponent,
  cssToShadowColor,
  defaultShadow,
  flatten,
  fromParts,
  giveCommand,
  hasLegacyCodes,
  HoverEventModern,
  legacyToComponent,
  MODERN_FORMAT,
  motdFromProperties,
  motdToProperties,
  NAMED_COLORS,
  parseComponentInput,
  Segment,
  shadowColorToCss,
  tellrawCommand,
  TextComponent,
  TextFormat,
  TextObject,
  toParts,
} from '../../src/features/translations/textComponent';
import { STYLE } from './style';

interface State {
  mode: 'component' | 'motd';
  version: string;
  formats: { id: string; label: string; format: TextFormat }[];
  formatId: string;
  initial: TextComponent | null;
  target?: string;
  targetIsJson: boolean;
}

type PartType = 'text' | 'translate' | 'keybind' | 'score' | 'selector' | 'nbt';
const PART_TYPES: PartType[] = ['text', 'translate', 'keybind', 'score', 'selector', 'nbt'];
const PART_LABELS: Record<PartType, string> = {
  text: 'Plain text',
  translate: 'Translation',
  keybind: 'Key binding',
  score: 'Score',
  selector: 'Entity selector',
  nbt: 'NBT value',
};
const KEYBINDS = ['key.jump', 'key.sneak', 'key.sprint', 'key.forward', 'key.back', 'key.left', 'key.right', 'key.attack', 'key.use', 'key.inventory', 'key.drop', 'key.chat', 'key.swapOffhand', 'key.pickItem', 'key.playerlist', 'key.advancements'];
const FONTS = ['minecraft:default', 'minecraft:uniform', 'minecraft:alt', 'minecraft:illageralt'];
const CLICK_ACTIONS = ['open_url', 'run_command', 'suggest_command', 'copy_to_clipboard', 'change_page'];
const HOVER_ACTIONS = ['show_text', 'show_item', 'show_entity'];

function partType(p: TextObject): PartType {
  if (p.translate !== undefined) return 'translate';
  if (p.keybind !== undefined) return 'keybind';
  if (p.score !== undefined) return 'score';
  if (p.selector !== undefined) return 'selector';
  if (p.nbt !== undefined) return 'nbt';
  return 'text';
}

function withType(p: TextObject, type: PartType): TextObject {
  const { text, translate, with: w, fallback, keybind, score, selector, separator, nbt, block, entity, storage, interpret, source, ...style } = p;
  void [text, translate, w, fallback, keybind, score, selector, separator, nbt, block, entity, storage, interpret, source];
  switch (type) {
    case 'text':
      return { text: '', ...style };
    case 'translate':
      return { translate: '', ...style };
    case 'keybind':
      return { keybind: 'key.jump', ...style };
    case 'score':
      return { score: { name: '@s', objective: '' }, ...style };
    case 'selector':
      return { selector: '@p', ...style };
    case 'nbt':
      return { nbt: '', entity: '@s', ...style };
  }
}

function initialParts(c: TextComponent | null): TextObject[] {
  if (c === null || c === undefined) return [{ text: t('Hello '), color: 'gold', bold: true }, { text: t('world'), color: 'aqua' }, { text: '!' }];
  return toParts(convertComponent(c, MODERN_FORMAT));
}

const bootState = boot<State>().state;

function App(): JSX.Element {
  const [state, setState] = useState<State>(bootState);
  const [mode, setMode] = useState<'component' | 'motd'>(bootState.mode);
  useEffect(
    () =>
      onEvent<State>('text.state', (s) => {
        setState(s);
        setMode(s.mode);
      }),
    [],
  );
  return (
    <div class="tc-root">
      <style>{STYLE}</style>
      <div class="mc-tabs">
        <button class={`mc-tab ${mode === 'component' ? 'active' : ''}`} onClick={() => setMode('component')}>
          {t('Text component')}
        </button>
        <button class={`mc-tab ${mode === 'motd' ? 'active' : ''}`} onClick={() => setMode('motd')}>
          {t('MOTD / § codes')}
        </button>
      </div>
      {mode === 'component' ? <ComponentEditor state={state} /> : <MotdEditor state={state} />}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Component editor
// ---------------------------------------------------------------------------------------------

function ComponentEditor({ state }: { state: State }): JSX.Element {
  const [parts, setParts] = useState<TextObject[]>(() => initialParts(state.initial));
  const [formatId, setFormatId] = useState(state.formatId);
  const [importText, setImportText] = useState<string | null>(null);
  const [importError, setImportError] = useState('');
  const [selected, setSelected] = useState(0);
  const [translations, setTranslations] = useState<Record<string, string>>({});
  useEffect(() => {
    setParts(initialParts(state.initial));
    setFormatId(state.formatId);
  }, [state]);
  const format = state.formats.find((f) => f.id === formatId)?.format ?? MODERN_FORMAT;
  const component = useMemo(() => fromParts(parts), [parts]);

  // Resolve translation keys used anywhere in the component for the preview.
  const keys = useMemo(() => {
    const out = new Set<string>();
    const walk = (c: unknown) => {
      if (Array.isArray(c)) c.forEach(walk);
      else if (c && typeof c === 'object') {
        const o = c as Record<string, unknown>;
        if (typeof o.translate === 'string' && o.translate) out.add(o.translate);
        Object.values(o).forEach(walk);
      }
    };
    walk(component);
    return [...out].filter((k) => !(k in translations));
  }, [component]);
  useEffect(() => {
    if (!keys.length) return;
    void call<Record<string, string>>('text.translate', { keys })
      .then((r) => setTranslations((old) => ({ ...old, ...r, ...Object.fromEntries(keys.filter((k) => !(k in r)).map((k) => [k, undefined as unknown as string])) })))
      .catch(() => undefined);
  }, [keys.join('|')]);
  const translate = (k: string) => translations[k] ?? undefined;

  const update = (i: number, p: TextObject) => setParts(parts.map((x, j) => (j === i ? p : x)));
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= parts.length) return;
    const next = [...parts];
    [next[i], next[j]] = [next[j], next[i]];
    setParts(next);
    setSelected(j);
  };

  const doImport = () => {
    try {
      const c = parseComponentInput(importText ?? '');
      setParts(toParts(convertComponent(c, MODERN_FORMAT)));
      setImportText(null);
      setImportError('');
    } catch (e) {
      setImportError(String((e as Error).message ?? e));
    }
  };

  return (
    <div class="tc-layout">
      <div class="tc-left">
        <div class="mc-toolbar">
          <label class="tc-inline">
            {t('Format')}
            <select class="mc-select" value={formatId} onChange={(e) => setFormatId((e.target as HTMLSelectElement).value)}>
              {state.formats.map((f) => (
                <option value={f.id}>{f.label}</option>
              ))}
            </select>
          </label>
          <span class="mc-muted" title={t('Target version of the project')}>
            {t('Project: {0}', state.version)}
          </span>
          <span class="mc-spacer" />
          <Button secondary onClick={() => setImportText(importText === null ? '' : null)}>
            {t('Import…')}
          </Button>
          <Button secondary onClick={() => setParts([])}>
            {t('Clear')}
          </Button>
        </div>
        {importText !== null ? (
          <div class="mc-card mc-col">
            <textarea
              class="mc-input tc-mono"
              rows={4}
              autoFocus
              placeholder={t('Paste JSON, SNBT or a § / & formatted string')}
              value={importText}
              onInput={(e) => setImportText((e.target as HTMLTextAreaElement).value)}
            />
            {importError ? <span class="mc-error">{importError}</span> : null}
            <div class="mc-row">
              <Button onClick={doImport}>{t('Import')}</Button>
              <Button secondary onClick={() => setImportText(null)}>
                {t('Cancel')}
              </Button>
            </div>
          </div>
        ) : null}
        {state.target ? <div class="tc-target mc-muted">{t('Editing component from {0}', state.target)}</div> : null}
        <div class="tc-parts">
          {parts.map((p, i) => (
            <PartEditor
              part={p}
              index={i}
              count={parts.length}
              format={format}
              selected={selected === i}
              onSelect={() => setSelected(i)}
              onChange={(np) => update(i, np)}
              onMove={(d) => move(i, d)}
              onRemove={() => setParts(parts.filter((_, j) => j !== i))}
              onDuplicate={() => setParts([...parts.slice(0, i + 1), { ...p }, ...parts.slice(i + 1)])}
            />
          ))}
          <Button
            onClick={() => {
              const last = parts[parts.length - 1];
              setParts([...parts, { text: '', ...(last?.color ? { color: last.color } : {}) }]);
              setSelected(parts.length);
            }}
            icon="+"
          >
            {t('Add part')}
          </Button>
        </div>
      </div>
      <div class="tc-right">
        <h3>{t('Chat preview')}</h3>
        <Preview component={component} translate={translate} kind="chat" />
        <h3>{t('Item name preview')}</h3>
        <Preview component={component} translate={translate} kind="item" />
        <Outputs component={component} format={format} targetIsJson={state.targetIsJson} />
      </div>
    </div>
  );
}

function Toggle({ on, label, title, onClick, style }: { on: boolean; label: string; title: string; onClick: () => void; style?: Record<string, string> }): JSX.Element {
  return (
    <button class={`tc-toggle ${on ? 'on' : ''}`} title={title} onClick={onClick} style={style}>
      {label}
    </button>
  );
}

function PartEditor(p: {
  part: TextObject;
  index: number;
  count: number;
  format: TextFormat;
  selected: boolean;
  onSelect: () => void;
  onChange: (p: TextObject) => void;
  onMove: (d: number) => void;
  onRemove: () => void;
  onDuplicate: () => void;
}): JSX.Element {
  const part = p.part;
  const type = partType(part);
  const set = (patch: Partial<TextObject>) => {
    const next: TextObject = { ...part, ...patch };
    for (const [k, v] of Object.entries(patch)) if (v === undefined) delete (next as any)[k];
    p.onChange(next);
  };
  const hex = colorToHex(part.color);
  const shadow = shadowColorToCss(part.shadow_color);
  const [open, setOpen] = useState(false);
  const inp = (e: Event) => (e.target as HTMLInputElement).value;
  const segs = flatten({ ...part, extra: undefined, click_event: undefined, hover_event: undefined });
  return (
    <div class={`mc-card tc-part ${p.selected ? 'selected' : ''}`} onFocusIn={p.onSelect} onClick={p.onSelect}>
      <div class="mc-row tc-part-head">
        <span class="mc-badge">{p.index + 1}</span>
        <select class="mc-select" value={type} onChange={(e) => p.onChange(withType(part, (e.target as HTMLSelectElement).value as PartType))}>
          {PART_TYPES.map((x) => (
            <option value={x}>{t(PART_LABELS[x])}</option>
          ))}
        </select>
        <span class="tc-mini-preview">
          <McSegments segments={segs} />
        </span>
        <span class="mc-spacer" />
        <button class="mc-icon-button" title={t('Move up')} disabled={p.index === 0} onClick={() => p.onMove(-1)}>
          ↑
        </button>
        <button class="mc-icon-button" title={t('Move down')} disabled={p.index === p.count - 1} onClick={() => p.onMove(1)}>
          ↓
        </button>
        <button class="mc-icon-button" title={t('Duplicate')} onClick={p.onDuplicate}>
          ⧉
        </button>
        <button class="mc-icon-button" title={t('Remove')} onClick={p.onRemove}>
          ✕
        </button>
      </div>

      {type === 'text' ? (
        <textarea
          class="mc-input tc-text"
          rows={1}
          placeholder={t('Text (§ codes allowed)')}
          value={part.text ?? ''}
          onInput={(e) => set({ text: (e.target as HTMLTextAreaElement).value })}
        />
      ) : null}
      {type === 'translate' ? (
        <div class="tc-grid2">
          <label class="mc-field">
            {t('Translation key')}
            <input class="mc-input tc-mono" value={part.translate ?? ''} onInput={(e) => set({ translate: inp(e) })} placeholder="item.mymod.ruby" />
          </label>
          <label class="mc-field">
            {t('Fallback')}
            <input class="mc-input" value={part.fallback ?? ''} onInput={(e) => set({ fallback: inp(e) || undefined })} />
          </label>
          <label class="mc-field tc-span2">
            {t('Arguments (%s), one per line — plain text, § codes, JSON or SNBT')}
            <textarea
              class="mc-input tc-mono"
              rows={2}
              value={(part.with ?? []).map((w) => (typeof w === 'string' ? w : JSON.stringify(w))).join('\n')}
              onInput={(e) => {
                const lines = (e.target as HTMLTextAreaElement).value.split('\n');
                const args = lines.filter((l, i) => l || i < lines.length - 1).map((l) => {
                  try {
                    return /^[{["]/.test(l.trim()) ? parseComponentInput(l) : hasLegacyCodes(l) ? legacyToComponent(l) : l;
                  } catch {
                    return l;
                  }
                });
                set({ with: args.length ? args : undefined });
              }}
            />
          </label>
        </div>
      ) : null}
      {type === 'keybind' ? (
        <label class="mc-field">
          {t('Key binding')}
          <input class="mc-input tc-mono" list="tc-keybinds" value={part.keybind ?? ''} onInput={(e) => set({ keybind: inp(e) })} />
          <datalist id="tc-keybinds">
            {KEYBINDS.map((k) => (
              <option value={k} />
            ))}
          </datalist>
        </label>
      ) : null}
      {type === 'score' ? (
        <div class="tc-grid2">
          <label class="mc-field">
            {t('Score holder')}
            <input class="mc-input tc-mono" value={part.score?.name ?? ''} onInput={(e) => set({ score: { name: inp(e), objective: part.score?.objective ?? '' } })} />
          </label>
          <label class="mc-field">
            {t('Objective')}
            <input class="mc-input tc-mono" value={part.score?.objective ?? ''} onInput={(e) => set({ score: { name: part.score?.name ?? '', objective: inp(e) } })} />
          </label>
        </div>
      ) : null}
      {type === 'selector' ? (
        <div class="tc-grid2">
          <label class="mc-field">
            {t('Selector')}
            <input class="mc-input tc-mono" value={part.selector ?? ''} onInput={(e) => set({ selector: inp(e) })} />
          </label>
          <label class="mc-field">
            {t('Separator')}
            <input class="mc-input" value={typeof part.separator === 'string' ? part.separator : ''} placeholder=", " onInput={(e) => set({ separator: inp(e) || undefined })} />
          </label>
        </div>
      ) : null}
      {type === 'nbt' ? (
        <div class="tc-grid2">
          <label class="mc-field">
            {t('NBT path')}
            <input class="mc-input tc-mono" value={part.nbt ?? ''} onInput={(e) => set({ nbt: inp(e) })} placeholder="Inventory[0].id" />
          </label>
          <label class="mc-field">
            {t('Source')}
            <div class="mc-row" style={{ flexWrap: 'nowrap' }}>
              <select
                class="mc-select"
                value={part.block !== undefined ? 'block' : part.storage !== undefined ? 'storage' : 'entity'}
                onChange={(e) => {
                  const src = (e.target as HTMLSelectElement).value;
                  const val = part.block ?? part.entity ?? part.storage ?? '';
                  set({ block: src === 'block' ? val || '~ ~ ~' : undefined, entity: src === 'entity' ? val || '@s' : undefined, storage: src === 'storage' ? val || 'minecraft:x' : undefined });
                }}
              >
                <option value="entity">entity</option>
                <option value="block">block</option>
                <option value="storage">storage</option>
              </select>
              <input
                class="mc-input tc-mono mc-grow"
                value={part.block ?? part.entity ?? part.storage ?? ''}
                onInput={(e) => set(part.block !== undefined ? { block: inp(e) } : part.storage !== undefined ? { storage: inp(e) } : { entity: inp(e) })}
              />
            </div>
          </label>
          <label class="tc-inline">
            <input type="checkbox" checked={!!part.interpret} onChange={(e) => set({ interpret: (e.target as HTMLInputElement).checked || undefined })} />
            {t('Interpret as text component')}
          </label>
        </div>
      ) : null}

      <div class="mc-row tc-style">
        <div class="tc-swatches">
          <button class={`tc-swatch none ${!part.color ? 'on' : ''}`} title={t('No colour (inherit)')} onClick={() => set({ color: undefined })}>
            ∅
          </button>
          {NAMED_COLORS.map((c) => (
            <button
              class={`tc-swatch ${part.color === c.name ? 'on' : ''}`}
              style={{ background: c.hex }}
              title={`${c.name} (§${c.code})`}
              onClick={() => set({ color: c.name })}
            />
          ))}
        </div>
        <input type="color" class="tc-color" value={(hex ?? '#FFFFFF').toLowerCase()} title={t('Custom hex colour')} onInput={(e) => set({ color: inp(e).toUpperCase() })} />
        <input
          class="mc-input tc-mono tc-hex"
          value={part.color ?? ''}
          placeholder="#RRGGBB"
          onChange={(e) => {
            const v = inp(e).trim();
            set({ color: v ? (colorToHex(v) && !v.startsWith('#') ? v : colorToHex(v) ?? v) : undefined });
          }}
        />
        <Toggle on={!!part.bold} label="B" title={t('Bold')} style={{ fontWeight: 'bold' }} onClick={() => set({ bold: part.bold ? undefined : true })} />
        <Toggle on={!!part.italic} label="I" title={t('Italic')} style={{ fontStyle: 'italic' }} onClick={() => set({ italic: part.italic ? undefined : true })} />
        <Toggle on={!!part.underlined} label="U" title={t('Underlined')} style={{ textDecoration: 'underline' }} onClick={() => set({ underlined: part.underlined ? undefined : true })} />
        <Toggle on={!!part.strikethrough} label="S" title={t('Strikethrough')} style={{ textDecoration: 'line-through' }} onClick={() => set({ strikethrough: part.strikethrough ? undefined : true })} />
        <Toggle on={!!part.obfuscated} label="?" title={t('Obfuscated')} onClick={() => set({ obfuscated: part.obfuscated ? undefined : true })} />
        <Toggle
          on={part.italic === false}
          label="¬I"
          title={t('Force not italic (item names are italic by default)')}
          onClick={() => set({ italic: part.italic === false ? undefined : false })}
        />
        <button class="mc-icon-button" onClick={() => setOpen(!open)} title={t('More options')}>
          {open ? '▾' : '▸'} {t('More')}
          {part.click_event || part.hover_event || part.font || part.insertion || part.shadow_color !== undefined ? ' •' : ''}
        </button>
      </div>

      {open ? (
        <div class="tc-grid2 tc-more">
          <label class="mc-field">
            {t('Font')}
            <input class="mc-input tc-mono" list="tc-fonts" value={part.font ?? ''} placeholder="minecraft:default" onInput={(e) => set({ font: inp(e) || undefined })} />
            <datalist id="tc-fonts">
              {FONTS.map((f) => (
                <option value={f} />
              ))}
            </datalist>
          </label>
          <label class="mc-field">
            {t('Insertion (shift-click inserts into chat)')}
            <input class="mc-input" value={part.insertion ?? ''} onInput={(e) => set({ insertion: inp(e) || undefined })} />
          </label>
          <div class="mc-field tc-span2">
            <span>{t('Shadow colour')}</span>
            {p.format.shadowColor ? (
              <div class="mc-row">
                <label class="tc-inline">
                  <input
                    type="checkbox"
                    checked={part.shadow_color !== undefined}
                    onChange={(e) => set({ shadow_color: (e.target as HTMLInputElement).checked ? cssToShadowColor(defaultShadow(hex ?? '#FFFFFF'), 1) : undefined })}
                  />
                  {t('Custom')}
                </label>
                {shadow ? (
                  <>
                    <input type="color" class="tc-color" value={shadow.hex.toLowerCase()} onInput={(e) => set({ shadow_color: cssToShadowColor(inp(e), shadow.alpha) })} />
                    <label class="tc-inline">
                      {t('Opacity')}
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={shadow.alpha}
                        onInput={(e) => set({ shadow_color: cssToShadowColor(shadow.hex, Number(inp(e))) })}
                      />
                    </label>
                    <code class="mc-muted">{part.shadow_color as number}</code>
                  </>
                ) : null}
              </div>
            ) : (
              <span class="mc-muted">{t('Requires Minecraft 1.21.4 or newer')}</span>
            )}
          </div>
          <div class="mc-field">
            <span>{t('Click event')}</span>
            <div class="mc-row" style={{ flexWrap: 'nowrap' }}>
              <select
                class="mc-select"
                value={part.click_event?.action ?? ''}
                onChange={(e) => {
                  const a = (e.target as HTMLSelectElement).value;
                  const old = part.click_event;
                  const v = old ? old.url ?? old.command ?? old.value ?? (old.page !== undefined ? String(old.page) : '') : '';
                  set({ click_event: a ? clickEvent(a, v) : undefined });
                }}
              >
                <option value="">{t('(none)')}</option>
                {CLICK_ACTIONS.map((a) => (
                  <option value={a}>{a}</option>
                ))}
              </select>
              {part.click_event ? (
                <input
                  class="mc-input tc-mono mc-grow"
                  value={part.click_event.url ?? part.click_event.command ?? part.click_event.value ?? (part.click_event.page !== undefined ? String(part.click_event.page) : '')}
                  placeholder={part.click_event.action === 'open_url' ? 'https://…' : part.click_event.action === 'change_page' ? '1' : '/say hi'}
                  onInput={(e) => set({ click_event: clickEvent(part.click_event!.action, inp(e)) })}
                />
              ) : null}
            </div>
          </div>
          <div class="mc-field">
            <span>{t('Hover event')}</span>
            <div class="mc-row" style={{ flexWrap: 'nowrap' }}>
              <select
                class="mc-select"
                value={part.hover_event?.action ?? ''}
                onChange={(e) => {
                  const a = (e.target as HTMLSelectElement).value;
                  set({ hover_event: a ? hoverDefault(a) : undefined });
                }}
              >
                <option value="">{t('(none)')}</option>
                {HOVER_ACTIONS.map((a) => (
                  <option value={a}>{a}</option>
                ))}
              </select>
              {part.hover_event?.action === 'show_text' ? (
                <input
                  class="mc-input mc-grow"
                  value={hoverTextValue(part.hover_event.value)}
                  placeholder={t('Tooltip text (§/& codes, JSON or SNBT)')}
                  onInput={(e) => {
                    let v: TextComponent = inp(e);
                    try {
                      v = parseComponentInput(inp(e));
                    } catch {
                      /* keep plain */
                    }
                    set({ hover_event: { action: 'show_text', value: v } });
                  }}
                />
              ) : null}
              {part.hover_event?.action === 'show_item' ? (
                <>
                  <input class="mc-input tc-mono mc-grow" value={part.hover_event.id ?? ''} placeholder="minecraft:diamond" onInput={(e) => set({ hover_event: { ...part.hover_event!, id: inp(e) } })} />
                  <input
                    class="mc-input"
                    type="number"
                    min="1"
                    value={part.hover_event.count ?? 1}
                    onInput={(e) => set({ hover_event: { ...part.hover_event!, count: Number(inp(e)) > 1 ? Number(inp(e)) : undefined } })}
                  />
                </>
              ) : null}
              {part.hover_event?.action === 'show_entity' ? (
                <>
                  <input class="mc-input tc-mono mc-grow" value={part.hover_event.id ?? ''} placeholder="minecraft:pig" onInput={(e) => set({ hover_event: { ...part.hover_event!, id: inp(e) } })} />
                  <input
                    class="mc-input tc-mono"
                    value={typeof part.hover_event.uuid === 'string' ? part.hover_event.uuid : ''}
                    placeholder="UUID"
                    onInput={(e) => set({ hover_event: { ...part.hover_event!, uuid: inp(e) } })}
                  />
                </>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function clickEvent(action: string, v: string): TextObject['click_event'] {
  switch (action) {
    case 'open_url':
      return { action, url: v };
    case 'run_command':
    case 'suggest_command':
      return { action, command: v };
    case 'change_page':
      return { action, page: Number(v) || 1 };
    default:
      return { action, value: v };
  }
}

function hoverDefault(action: string): HoverEventModern {
  if (action === 'show_item') return { action, id: 'minecraft:diamond' };
  if (action === 'show_entity') return { action, id: 'minecraft:pig', uuid: '00000000-0000-0000-0000-000000000000' };
  return { action, value: '' };
}

function hoverTextValue(v: TextComponent | undefined): string {
  if (v === undefined) return '';
  if (typeof v === 'string') return v;
  try {
    const legacy = componentToLegacy(v);
    return legacy;
  } catch {
    return JSON.stringify(v);
  }
}

// ---------------------------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------------------------

const OBF_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789#$%&@';

function useTick(active: boolean): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!active) return;
    const h = window.setInterval(() => setN((x) => x + 1), 70);
    return () => window.clearInterval(h);
  }, [active]);
  return n;
}

export function McSegments({ segments, tooltips }: { segments: (Segment & { hover?: Segment[]; click?: string })[]; tooltips?: boolean }): JSX.Element {
  const obf = segments.some((s) => s.obfuscated);
  useTick(obf);
  const [tip, setTip] = useState<{ x: number; y: number; segs: Segment[] } | null>(null);
  return (
    <span class="mc-text tc-mc">
      {segments.map((s) => {
        const color = colorToHex(s.color) ?? '#FFFFFF';
        const custom = shadowColorToCss(s.shadow_color);
        const shadow = custom ? (custom.alpha > 0 ? `${custom.hex}${Math.round(custom.alpha * 255).toString(16).padStart(2, '0')}` : 'transparent') : defaultShadow(color);
        const deco = [s.underlined ? 'underline' : '', s.strikethrough ? 'line-through' : ''].filter(Boolean).join(' ');
        const text = s.obfuscated ? Array.from(s.text, (c) => (c === ' ' ? c : OBF_CHARS[Math.floor(Math.random() * OBF_CHARS.length)])).join('') : s.text;
        return (
          <span
            style={{
              color,
              textShadow: `0.125em 0.125em 0 ${shadow}`,
              fontWeight: s.bold ? 'bold' : undefined,
              fontStyle: s.italic ? 'italic' : undefined,
              textDecoration: deco || undefined,
              cursor: s.click ? 'pointer' : undefined,
            }}
            title={s.click}
            onMouseMove={tooltips && s.hover ? (e) => setTip({ x: e.clientX + 12, y: e.clientY + 12, segs: s.hover! }) : undefined}
            onMouseLeave={tooltips && s.hover ? () => setTip(null) : undefined}
          >
            {text}
          </span>
        );
      })}
      {tip ? (
        <div class="mc-tooltip" style={{ left: `${tip.x}px`, top: `${tip.y}px` }}>
          <McSegments segments={tip.segs} />
        </div>
      ) : null}
    </span>
  );
}

/** Flatten keeping hover/click info per top-level part. */
function previewSegments(component: TextComponent, translate: (k: string) => string | undefined, italicDefault: boolean) {
  const parts = toParts(component);
  const base = italicDefault ? { italic: true } : {};
  return parts.flatMap((p) => {
    const segs = flatten({ ...p }, { translate }, base);
    const hover = p.hover_event?.action === 'show_text' && p.hover_event.value !== undefined ? flatten(p.hover_event.value, { translate }) : p.hover_event ? [{ text: `${p.hover_event.id ?? ''}${p.hover_event.count ? ` ×${p.hover_event.count}` : ''}` }] : undefined;
    const ce = p.click_event;
    const click = ce ? `${ce.action}: ${ce.url ?? ce.command ?? ce.value ?? ce.page ?? ''}` : undefined;
    return segs.map((s) => ({ ...s, hover, click }));
  });
}

function Preview({ component, translate, kind }: { component: TextComponent; translate: (k: string) => string | undefined; kind: 'chat' | 'item' }): JSX.Element {
  const segs = previewSegments(component, translate, kind === 'item');
  if (kind === 'item') {
    return (
      <div class="tc-item-bg">
        <div class="tc-item-tooltip">
          <McSegments segments={segs} tooltips />
        </div>
      </div>
    );
  }
  return (
    <div class="tc-chat-bg">
      <div class="tc-chat-line">
        <McSegments segments={segs} tooltips />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------------------------

type OutTab = 'json' | 'snbt' | 'tellraw' | 'give' | 'legacy';

function Outputs({ component, format, targetIsJson }: { component: TextComponent; format: TextFormat; targetIsJson: boolean }): JSX.Element {
  const [tab, setTab] = useState<OutTab>('json');
  const [pretty, setPretty] = useState(false);
  const json = convertComponent(component, format);
  const outputs: Record<OutTab, string> = {
    json: componentToJson(component, format, pretty ? 2 : undefined),
    snbt: componentToSnbt(component, format),
    tellraw: tellrawCommand(component, format),
    give: giveCommand(component, format),
    legacy: componentToLegacy(component),
  };
  const labels: Record<OutTab, string> = {
    json: 'JSON',
    snbt: 'SNBT',
    tellraw: '/tellraw',
    give: '/give',
    legacy: t('§ legacy'),
  };
  const notes: Partial<Record<OutTab, string>> = {
    json: t('For data files (advancements, item names in recipes and loot tables, pack.mcmeta…).'),
    snbt: format.snbt ? t('For commands and item components (1.21.5+).') : t('Commands of this version take JSON, not SNBT.'),
    tellraw: format.snbt ? t('1.21.5+ commands use SNBT text components.') : t('Up to 1.21.4, commands use JSON text components.'),
    give: format.snbt ? t('custom_name as an SNBT component (1.21.5+).') : t('custom_name as a JSON string (1.20.5 – 1.21.4).'),
    legacy: t('Hex colours become the nearest named colour; events are lost.'),
  };
  const text = outputs[tab];
  return (
    <div class="tc-outputs">
      <div class="mc-tabs">
        {(Object.keys(labels) as OutTab[]).map((k) => (
          <button class={`mc-tab ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>
            {labels[k]}
          </button>
        ))}
      </div>
      <pre class="tc-output tc-mono">{text}</pre>
      <div class="mc-row">
        <Button onClick={() => call('text.copy', { text })} icon="⧉">
          {t('Copy')}
        </Button>
        <Button secondary onClick={() => call('text.insert', tab === 'json' && targetIsJson ? { text, json } : { text })}>
          {tab === 'json' && targetIsJson ? t('Replace in file') : t('Insert at cursor')}
        </Button>
        {tab === 'json' ? (
          <label class="tc-inline">
            <input type="checkbox" checked={pretty} onChange={(e) => setPretty((e.target as HTMLInputElement).checked)} />
            {t('Pretty')}
          </label>
        ) : null}
        <span class="mc-muted tc-note">{notes[tab]}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// MOTD
// ---------------------------------------------------------------------------------------------

function MotdEditor({ state }: { state: State }): JSX.Element {
  const initial = typeof state.initial === 'string' && /^\s*motd\s*=/.test(state.initial) ? motdFromProperties(state.initial) : '§aA Minecraft Server\n§7Powered by §6VSCodeCraft';
  const [text, setText] = useState(initial);
  const [amp, setAmp] = useState(true);
  const ref = useRef<HTMLTextAreaElement>(null);
  const value = amp ? ampersandToSection(text) : text;
  const lines = value.split('\n');
  const insertCode = (code: string) => {
    const el = ref.current;
    if (!el) return;
    const s = el.selectionStart;
    const e = el.selectionEnd;
    const next = text.slice(0, s) + code + text.slice(e);
    setText(next);
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = s + code.length;
    });
  };
  const outputs = [
    { label: 'server.properties', text: motdToProperties(value) },
    { label: 'JSON', text: componentToJson(legacyToComponent(value)) },
    { label: t('§ legacy'), text: value },
  ];
  return (
    <div class="mc-col">
      <div class="mc-row tc-codes">
        {NAMED_COLORS.map((c) => (
          <button class="tc-swatch" style={{ background: c.hex }} title={`§${c.code} ${c.name}`} onClick={() => insertCode(`§${c.code}`)} />
        ))}
        {[
          ['l', 'B', t('Bold')],
          ['o', 'I', t('Italic')],
          ['n', 'U', t('Underlined')],
          ['m', 'S', t('Strikethrough')],
          ['k', '?', t('Obfuscated')],
          ['r', '⟲', t('Reset')],
        ].map(([code, label, title]) => (
          <button class="tc-toggle" title={`§${code} ${title}`} onClick={() => insertCode(`§${code}`)}>
            {label}
          </button>
        ))}
        <label class="tc-inline">
          <input type="checkbox" checked={amp} onChange={(e) => setAmp((e.target as HTMLInputElement).checked)} />
          {t('Accept & codes')}
        </label>
      </div>
      <textarea ref={ref} class="mc-input tc-mono" rows={3} value={text} onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} />
      {lines.length > 2 ? <span class="mc-warning">{t('The server list only shows the first 2 lines.')}</span> : null}
      <h3>{t('Server list preview')}</h3>
      <div class="tc-server">
        <div class="tc-server-icon">
          <span>▦</span>
        </div>
        <div class="tc-server-text">
          <div class="tc-server-top">
            <McSegments segments={[{ text: 'Minecraft Server', color: 'white' }]} />
            <span class="tc-server-ping">
              <McSegments segments={[{ text: '3/20', color: 'gray' }]} /> <span class="tc-bars">▂▄▆█</span>
            </span>
          </div>
          {lines.slice(0, 2).map((l) => (
            <div class="tc-server-line">
              <McSegments segments={flatten(l, {}, { color: 'gray' })} />
            </div>
          ))}
        </div>
      </div>
      <h3>{t('Chat preview')}</h3>
      <div class="tc-chat-bg">
        {lines.map((l) => (
          <div class="tc-chat-line">
            <McSegments segments={flatten(l)} />
          </div>
        ))}
      </div>
      {outputs.map((o) => (
        <div class="mc-col" style={{ gap: '4px' }}>
          <div class="mc-row">
            <strong>{o.label}</strong>
            <span class="mc-spacer" />
            <Button secondary onClick={() => call('text.copy', { text: o.text })} icon="⧉">
              {t('Copy')}
            </Button>
            <Button secondary onClick={() => call('text.insert', { text: o.text })}>
              {t('Insert at cursor')}
            </Button>
          </div>
          <pre class="tc-output tc-mono">{o.text}</pre>
        </div>
      ))}
    </div>
  );
}

render(<App />, document.getElementById('app')!);
