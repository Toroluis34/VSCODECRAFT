// Loot table viewer / editor webview.
import { render } from 'preact';
import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { boot, call, onEvent } from '../shared/vscode';
import { t } from '../shared/i18n';
import { Button, expandTag, ItemIcon, ItemPicker, Slot, useName } from '../shared/components';
import {
  analyzeLootTable,
  DEFAULT_CONTEXT,
  fmtNum,
  fmtPercent,
  referencedIds,
  simulateLootTable,
  type EntryView,
  type LootContext,
  type PoolView,
  type SimResult,
} from '../../src/features/loot/lootModel';
import type { LootEditOp } from '../../src/features/loot/lootEdit';
import type { LootViewState } from '../../src/features/loot/protocol';
import { injectStyle, SHARED_CSS, SummaryView } from '../lootShared/ui';

injectStyle('lt-shared', SHARED_CSS);
injectStyle(
  'lt-loot',
  `
body { padding: 10px 14px 40px; }
.lt-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 8px; }
.lt-head h1 { margin: 0; font-size: 1.25em; }
.lt-ctx { display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: center; padding: 6px 10px; margin-bottom: 10px; }
.lt-ctx label { display: inline-flex; gap: 5px; align-items: center; font-size: 12px; }
.lt-ctx select, .lt-ctx input[type=number] { width: 52px; }
.lt-pool { margin-bottom: 12px; }
.lt-pool-head { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-bottom: 6px; }
.lt-pool-head h2 { margin: 0; font-size: 1.05em; }
.lt-pool-meta { display: flex; flex-direction: column; gap: 2px; margin: 0 0 6px; }
.lt-entries { display: flex; flex-direction: column; gap: 4px; }
.lt-entry { display: grid; grid-template-columns: 40px minmax(150px, 1.4fr) 70px 70px minmax(120px, 1fr) minmax(160px, 1.6fr) 22px; gap: 8px; align-items: center; padding: 4px 6px; border-radius: 3px; border: 1px solid transparent; }
.lt-entry:hover { background: var(--vscode-list-hoverBackground); border-color: var(--vscode-panel-border, rgba(128,128,128,.3)); }
.lt-entry .lt-name { min-width: 0; overflow: hidden; }
.lt-entry .lt-name b { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lt-entry .lt-id { font-size: 11px; color: var(--vscode-descriptionForeground); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lt-entry .lt-id a { cursor: pointer; }
.lt-entry input.mc-input { width: 62px; }
.lt-colhead { display: grid; grid-template-columns: 40px minmax(150px, 1.4fr) 70px 70px minmax(120px, 1fr) minmax(160px, 1.6fr) 22px; gap: 8px; font-size: 11px; color: var(--vscode-descriptionForeground); padding: 0 6px; text-transform: uppercase; letter-spacing: .03em; }
.lt-chance { display: flex; flex-direction: column; gap: 2px; font-size: 12px; }
.lt-bar { height: 6px; border-radius: 3px; background: var(--vscode-input-background); overflow: hidden; border: 1px solid var(--vscode-panel-border, rgba(128,128,128,.25)); }
.lt-bar > div { height: 100%; background: var(--vscode-progressBar-background, #0e70c0); }
.lt-group { grid-column: 1 / -1; display: flex; flex-direction: column; gap: 4px; margin-left: 18px; padding-left: 8px; border-left: 2px dashed var(--vscode-panel-border, rgba(128,128,128,.4)); }
.lt-group-label { font-size: 12px; color: var(--vscode-descriptionForeground); display: flex; gap: 8px; align-items: center; }
.lt-type { font-size: 10px; text-transform: uppercase; letter-spacing: .04em; padding: 0 5px; border-radius: 8px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); margin-left: 4px; vertical-align: 1px; }
.lt-symbol { width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; font-size: 18px; color: var(--vscode-descriptionForeground); }
.lt-add { margin-top: 8px; }
.lt-picker { margin-top: 8px; max-width: 640px; }
.lt-sim { margin-top: 14px; }
.lt-hist { display: flex; flex-direction: column; gap: 3px; margin-top: 8px; }
.lt-hrow { display: grid; grid-template-columns: 40px minmax(140px, 1fr) minmax(160px, 2fr) 80px 70px 70px; gap: 8px; align-items: center; font-size: 12px; }
.lt-hrow .lt-hbar { height: 16px; background: var(--vscode-input-background); border-radius: 2px; overflow: hidden; }
.lt-hrow .lt-hbar > div { height: 100%; background: linear-gradient(90deg, #4caf50, #8bc34a); }
.lt-hhead { font-size: 11px; color: var(--vscode-descriptionForeground); text-transform: uppercase; }
.lt-empty { padding: 20px; text-align: center; }
.lt-warn { margin-bottom: 8px; }
@media (max-width: 760px) {
  .lt-entry, .lt-colhead { grid-template-columns: 40px 1fr 60px 60px 1fr 22px; }
  .lt-entry .lt-sums, .lt-colhead .lt-sums { display: none; }
}
`,
);

const initial = boot<LootViewState>().state ?? ({ mode: 'vanilla', id: '?', version: '26.3', format: 'modern', json: { pools: [] }, readOnly: true } as LootViewState);

function parseRange(s: string): number | { min: number; max: number } | undefined {
  const m = /^\s*(-?\d+)\s*(?:[-–…]|\.\.)\s*(-?\d+)\s*$/.exec(s);
  if (m) return { min: Number(m[1]), max: Number(m[2]) };
  const n = /^\s*(-?\d+)\s*$/.exec(s);
  return n ? Number(n[1]) : undefined;
}

function EditableText(p: { value: string; disabled?: boolean; title?: string; onCommit: (v: string) => void; width?: number }): JSX.Element {
  const [v, setV] = useState(p.value);
  useEffect(() => setV(p.value), [p.value]);
  if (p.disabled) return <span title={p.title}>{p.value}</span>;
  return (
    <input
      class="mc-input"
      value={v}
      title={p.title}
      style={p.width ? { width: `${p.width}px` } : undefined}
      onInput={(e) => setV((e.target as HTMLInputElement).value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') setV(p.value);
      }}
      onBlur={() => v !== p.value && p.onCommit(v)}
    />
  );
}

function App(): JSX.Element {
  const [state, setState] = useState<LootViewState>(initial);
  const [ctx, setCtx] = useState<LootContext>({ ...DEFAULT_CONTEXT });
  const [tagMembers, setTagMembers] = useState<Record<string, string[]>>({});
  const [pickerPool, setPickerPool] = useState<number | null>(null);
  const [sim, setSim] = useState<SimResult | null>(null);
  const [runs, setRuns] = useState(1000);
  const [busy, setBusy] = useState(false);

  useEffect(() => onEvent<LootViewState>('loot.update', (s) => setState(s)), []);

  // Expand tags used by "expand": true entries so their members split the weight.
  useEffect(() => {
    const tags = [...referencedIds(state.json).tags].filter((x) => !(x in tagMembers));
    if (!tags.length) return;
    void Promise.all(tags.map(async (tg) => [tg, await expandTag(tg)] as const)).then((pairs) =>
      setTagMembers((m) => ({ ...m, ...Object.fromEntries(pairs) })),
    );
  }, [state.json]);

  const view = useMemo(() => analyzeLootTable(state.json, { ctx, tagMembers, version: state.version }), [state.json, ctx, tagMembers]);
  const editable = !state.readOnly;
  const edit = (...ops: LootEditOp[]) => {
    if (!editable) return;
    void call('loot.edit', { ops }).catch((e) => call('ui.notify', { message: String(e?.message ?? e), level: 'error' }));
  };

  const simulate = async () => {
    setBusy(true);
    try {
      // Fetch referenced loot tables (a few levels deep) so nested tables are simulated too.
      const resolved: Record<string, unknown> = {};
      let pending = [...referencedIds(state.json).tables];
      for (let depth = 0; depth < 4 && pending.length; depth++) {
        const res = await call<Record<string, unknown>>('loot.tables', { ids: pending }).catch(() => ({}));
        Object.assign(resolved, res);
        pending = Object.values(res).flatMap((j) => [...referencedIds(j).tables]).filter((id) => !(id in resolved));
      }
      const allTags = new Set<string>();
      for (const j of [state.json, ...Object.values(resolved)]) referencedIds(j).tags.forEach((x) => allTags.add(x));
      const members = { ...tagMembers };
      for (const tg of allTags) if (!(tg in members)) members[tg] = await expandTag(tg);
      setTagMembers(members);
      const n = Math.max(1, Math.min(200000, runs));
      setSim(simulateLootTable(state.json, ctx, n, { tagMembers: members, resolveTable: (id) => resolved[id] ?? resolved[`minecraft:${id}`] }));
    } finally {
      setBusy(false);
    }
  };

  const setC = <K extends keyof LootContext>(k: K, v: LootContext[K]) => {
    setCtx((c) => ({ ...c, [k]: v }));
    setSim(null);
  };

  const levelSelect = (k: 'looting' | 'fortune') => (
    <select class="mc-select" value={ctx[k]} onChange={(e) => setC(k, Number((e.target as HTMLSelectElement).value))}>
      {[0, 1, 2, 3, 4, 5].map((n) => (
        <option value={n}>{n}</option>
      ))}
    </select>
  );

  return (
    <div>
      <div class="lt-head">
        <ItemIcon id={iconForTable(view.type)} size={28} />
        <h1>{state.id}</h1>
        {view.type ? <span class="mc-badge">{view.type.replace(/^minecraft:/, '')}</span> : null}
        <span class="mc-badge" title={t('Loot table format')}>
          {view.format === 'modern' ? t('26.3+ format') : t('classic format')}
        </span>
        <span class="mc-muted">Minecraft {state.version}</span>
        {state.readOnly ? <span class="mc-badge">{t('read-only')}</span> : null}
        <span class="mc-spacer" />
        <Button secondary icon="{ }" onClick={() => call('loot.openText')}>
          {t('Open JSON')}
        </Button>
        {state.mode === 'vanilla' ? (
          <Button icon="⇩" onClick={() => call('loot.copyToMod')}>
            {t('Copy to my mod')}
          </Button>
        ) : null}
        {editable ? (
          <Button icon="+" onClick={() => edit({ op: 'addPool' })}>
            {t('Add pool')}
          </Button>
        ) : null}
      </div>
      {state.parseError ? <div class="mc-error lt-warn">{t('The JSON has syntax errors; showing what could be read.')}</div> : null}

      <div class="mc-card lt-ctx">
        <b>{t('Context')}</b>
        <label title={t('Looting level of the weapon')}>
          {t('Looting')} {levelSelect('looting')}
        </label>
        <label title={t('Fortune level of the tool')}>
          {t('Fortune')} {levelSelect('fortune')}
        </label>
        <label>
          <input type="checkbox" checked={ctx.silkTouch} onChange={(e) => setC('silkTouch', (e.target as HTMLInputElement).checked)} /> {t('Silk Touch')}
        </label>
        <label>
          <input type="checkbox" checked={ctx.shears} onChange={(e) => setC('shears', (e.target as HTMLInputElement).checked)} /> {t('Shears')}
        </label>
        <label>
          <input type="checkbox" checked={ctx.killedByPlayer} onChange={(e) => setC('killedByPlayer', (e.target as HTMLInputElement).checked)} /> {t('Killed by player')}
        </label>
        <label title={t('Player luck (affects bonus rolls and entry quality)')}>
          {t('Luck')}
          <input class="mc-input" type="number" value={ctx.luck} step={1} onInput={(e) => setC('luck', Number((e.target as HTMLInputElement).value) || 0)} />
        </label>
        <label title={t('Entity properties, location, weather, block state… cannot be evaluated here')}>
          {t('Other conditions')}
          <select class="mc-select" style={{ width: 'auto' }} value={ctx.unknown} onChange={(e) => setC('unknown', (e.target as HTMLSelectElement).value as 'pass' | 'fail')}>
            <option value="pass">{t('pass')}</option>
            <option value="fail">{t('fail')}</option>
          </select>
        </label>
      </div>

      {view.functions.length ? (
        <div class="mc-card lt-pool">
          <div class="lt-pool-head">
            <h2>{t('Functions for every pool')}</h2>
          </div>
          {view.functions.map((s, i) => (
            <SummaryView key={i} s={s} kind="fn" />
          ))}
        </div>
      ) : null}

      {!view.pools.length ? <div class="mc-card lt-empty mc-muted">{t('This loot table has no pools.')}</div> : null}

      {view.pools.map((pool) => (
        <PoolCard
          key={pool.index}
          pool={pool}
          editable={editable}
          edit={edit}
          pickerOpen={pickerPool === pool.index}
          onTogglePicker={() => setPickerPool(pickerPool === pool.index ? null : pool.index)}
          onPicked={(id) => {
            edit({ op: 'addEntry', pool: pool.index, item: id });
            setPickerPool(null);
          }}
        />
      ))}

      <div class="mc-card lt-sim">
        <div class="mc-row">
          <h2 style={{ margin: 0 }}>{t('Simulation')}</h2>
          <label class="mc-row" style={{ gap: '5px' }}>
            {t('Rolls of the table')}
            <input class="mc-input" type="number" min={1} max={200000} value={runs} onInput={(e) => setRuns(Number((e.target as HTMLInputElement).value) || 1)} />
          </label>
          <button class="mc-button lt-simulate" disabled={busy} onClick={() => void simulate()}>
            <span class="mc-button-icon">▶</span>
            {busy ? t('Simulating…') : t('Simulate')}
          </button>
          <span class="mc-muted">{t('Uses the context above (Monte Carlo).')}</span>
        </div>
        {sim ? <SimView sim={sim} /> : null}
      </div>
    </div>
  );
}

function iconForTable(type?: string): string {
  const k = (type ?? '').replace(/^minecraft:/, '');
  return (
    {
      block: 'minecraft:grass_block',
      entity: 'minecraft:rotten_flesh',
      chest: 'minecraft:chest',
      fishing: 'minecraft:fishing_rod',
      archaeology: 'minecraft:brush',
      gift: 'minecraft:cake',
      barter: 'minecraft:gold_ingot',
      equipment: 'minecraft:iron_chestplate',
      shearing: 'minecraft:shears',
      vault: 'minecraft:vault',
    } as Record<string, string>
  )[k] ?? 'minecraft:book';
}

function PoolCard(p: {
  pool: PoolView;
  editable: boolean;
  edit: (...ops: LootEditOp[]) => void;
  pickerOpen: boolean;
  onTogglePicker: () => void;
  onPicked: (id: string) => void;
}): JSX.Element {
  const { pool, editable, edit } = p;
  return (
    <div class="mc-card lt-pool" data-pool={pool.index}>
      <div class="lt-pool-head">
        <h2>{t('Pool {0}', pool.index + 1)}</h2>
        <span class="mc-row" style={{ gap: '4px' }}>
          {t('Rolls')}:
          <EditableText
            value={pool.rollsText}
            disabled={!editable}
            width={64}
            title={t('A number or a range like 1-3')}
            onCommit={(v) => {
              const r = parseRange(v);
              if (r !== undefined) edit({ op: 'setRolls', pool: pool.index, rolls: r });
            }}
          />
        </span>
        {pool.bonusRollsText ? (
          <span class="mc-muted">
            {t('Bonus rolls')}: {pool.bonusRollsText} × {t('luck')}
          </span>
        ) : null}
        <span class="mc-muted">
          {t('Total weight')}: {pool.totalWeight}
        </span>
        {pool.poolChance < 1 ? <span class="mc-badge">{t('runs {0} of the time', fmtPercent(pool.poolChance))}</span> : null}
        <span class="mc-spacer" />
        {editable ? (
          <button class="mc-icon-button" title={t('Delete pool')} onClick={() => edit({ op: 'deletePool', pool: pool.index })}>
            🗑
          </button>
        ) : null}
      </div>
      {pool.conditions.length || pool.functions.length ? (
        <div class="lt-pool-meta">
          {pool.conditions.map((s, i) => (
            <SummaryView key={`c${i}`} s={s} kind="cond" />
          ))}
          {pool.functions.map((s, i) => (
            <SummaryView key={`f${i}`} s={s} kind="fn" />
          ))}
        </div>
      ) : null}
      <div class="lt-colhead">
        <span />
        <span>{t('Entry')}</span>
        <span>{t('Weight')}</span>
        <span>{t('Count')}</span>
        <span>{t('Chance per roll')}</span>
        <span class="lt-sums">{t('Conditions & functions')}</span>
        <span />
      </div>
      <div class="lt-entries">
        {pool.entries.map((e) => (
          <EntryRow key={e.path.join('.')} e={e} editable={editable} edit={edit} rollsMean={pool.rollsMean} />
        ))}
        {!pool.entries.length ? <div class="mc-muted">{t('No entries yet.')}</div> : null}
      </div>
      {editable ? (
        <div class="lt-add">
          <Button secondary icon="+" onClick={p.onTogglePicker}>
            {t('Add entry')}
          </Button>
          {p.pickerOpen ? (
            <div class="lt-picker">
              <ItemPicker includeTags autoFocus onPick={p.onPicked} placeholder={t('Search items or #tags…')} />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const GROUP_LABELS: Record<string, string> = {
  alternatives: 'Alternatives — the first child that applies',
  group: 'Group — all children are added',
  sequence: 'Sequence — children until one fails',
};

function EntryRow({ e, editable, edit, rollsMean }: { e: EntryView; editable: boolean; edit: (...ops: LootEditOp[]) => void; rollsMean: number }): JSX.Element {
  const isGroup = !!e.children;
  const name = useName(e.type === 'item' ? e.name : undefined);
  const del = editable ? (
    <button class="mc-icon-button" title={t('Delete entry')} onClick={() => edit({ op: 'deleteEntry', path: e.path })}>
      ✕
    </button>
  ) : (
    <span />
  );
  const sums = (
    <div class="lt-sums">
      {e.conditions.map((s, i) => (
        <SummaryView key={`c${i}`} s={s} kind="cond" />
      ))}
      {e.functions.map((s, i) => (
        <SummaryView key={`f${i}`} s={s} kind="fn" />
      ))}
    </div>
  );
  if (isGroup) {
    return (
      <div class="lt-group">
        <div class="lt-group-label">
          <b>{t(GROUP_LABELS[e.type] ?? e.type)}</b>
          {sums}
          <span class="mc-spacer" />
          {del}
        </div>
        {e.children!.map((c) => (
          <EntryRow key={c.path.join('.')} e={c} editable={editable} edit={edit} rollsMean={rollsMean} />
        ))}
      </div>
    );
  }
  const chance = e.chance ?? 0;
  const icon = entryIcon(e);
  const label =
    e.type === 'item'
      ? name || e.name
      : e.type === 'tag'
        ? `${t('Tag')} ${e.name}`
        : e.type === 'loot_table'
          ? e.inline
            ? t('Inline loot table')
            : t('Loot table')
          : e.type === 'empty'
            ? t('Nothing')
            : e.type === 'dynamic'
              ? t('Block contents ({0})', (e.name ?? '').replace(/^minecraft:/, ''))
              : e.type;
  const tip = [
    t('Chance per roll: {0}', fmtPercent(chance)),
    t('Expected per roll: {0}', fmtNum(e.expectedPerRoll ?? 0)),
    t('Expected per table roll: {0}', fmtNum(e.expectedPerTable ?? 0)),
    e.countRange ? t('Count when dropped: {0}–{1}', e.countRange[0], e.countRange[1]) : '',
    e.members ? t('{0} items in the tag, each with this weight', e.members.length) : '',
  ]
    .filter(Boolean)
    .join('\n');
  return (
    <div class="lt-entry" data-path={e.path.join('.')}>
      {icon ? <Slot id={icon} size={36} /> : <div class="lt-symbol">{e.type === 'empty' ? '∅' : '?'}</div>}
      <div class="lt-name">
        <b>
          {label}
          <span class="lt-type">{e.type}</span>
        </b>
        <div class="lt-id">
          {e.type === 'loot_table' && e.name ? (
            <a onClick={() => call('loot.openTable', { id: e.name })} title={t('Open this loot table')}>
              {e.name}
            </a>
          ) : (
            (e.name ?? '')
          )}
          {e.quality ? ` · ${t('quality')} ${e.quality}` : ''}
        </div>
      </div>
      <div>
        <EditableText
          value={String(e.weight)}
          disabled={!editable}
          onCommit={(v) => {
            const n = Number(v);
            if (Number.isFinite(n) && n >= 0) edit({ op: 'setWeight', path: e.path, weight: n });
          }}
        />
      </div>
      <div>
        {e.type === 'item' || e.type === 'tag' ? (
          <EditableText
            value={e.countText ?? '1'}
            disabled={!editable}
            title={t('A number or a range like 1-3')}
            onCommit={(v) => {
              const r = parseRange(v);
              if (r !== undefined) edit({ op: 'setCount', path: e.path, count: r });
            }}
          />
        ) : (
          <span class="mc-muted">—</span>
        )}
      </div>
      <div class="lt-chance" title={tip}>
        <span>
          <b>{fmtPercent(chance)}</b>
          {e.type !== 'empty' ? <span class="mc-muted"> · ×{fmtNum(e.expectedPerRoll ?? 0)}</span> : null}
        </span>
        <div class="lt-bar">
          <div style={{ width: `${Math.min(100, chance * 100)}%` }} />
        </div>
        {rollsMean !== 1 && e.type !== 'empty' ? (
          <span class="mc-muted">{t('≈{0} per table roll', fmtNum(e.expectedPerTable ?? 0))}</span>
        ) : null}
      </div>
      {sums}
      {del}
    </div>
  );
}

function entryIcon(e: EntryView): string | undefined {
  if (e.type === 'item') return e.name;
  if (e.type === 'tag') return e.name;
  if (e.type === 'loot_table') return 'minecraft:chest';
  if (e.type === 'dynamic') return /sherd/.test(e.name ?? '') ? 'minecraft:brick' : 'minecraft:barrel';
  if (e.type === 'slots') return 'minecraft:bundle';
  return undefined;
}

function SimView({ sim }: { sim: SimResult }): JSX.Element {
  const maxAvg = Math.max(...sim.drops.map((d) => d.total / sim.runs), 0.0001);
  return (
    <div class="lt-hist">
      <div class="mc-muted">
        {t('{0} table rolls · {1} items per roll on average · nothing dropped in {2}', sim.runs, fmtNum(sim.meanItems), fmtPercent(sim.emptyRuns / sim.runs))}
      </div>
      <div class="lt-hrow lt-hhead">
        <span />
        <span>{t('Item')}</span>
        <span>{t('Average per roll')}</span>
        <span>{t('Avg')}</span>
        <span>{t('% of rolls')}</span>
        <span>{t('Min–max')}</span>
      </div>
      {sim.drops.map((d) => (
        <SimRow key={d.id} d={d} runs={sim.runs} maxAvg={maxAvg} />
      ))}
      {!sim.drops.length ? <div class="mc-muted">{t('Nothing dropped with this context.')}</div> : null}
    </div>
  );
}

function SimRow({ d, runs, maxAvg }: { d: SimResult['drops'][number]; runs: number; maxAvg: number }): JSX.Element {
  const isItem = !d.id.includes(':') || /^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(d.id) || d.id.startsWith('#');
  const special = d.id.startsWith('loot_table:') || d.id.startsWith('dynamic:');
  const name = useName(isItem && !special && !d.id.startsWith('#') ? d.id : undefined);
  const avg = d.total / runs;
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div class="lt-hrow" ref={ref}>
      <Slot id={special ? 'minecraft:chest' : d.id} size={32} />
      <span title={d.id}>
        {special ? d.id : name || d.id}
        <div class="mc-muted" style={{ fontSize: '11px' }}>
          {special ? '' : d.id}
        </div>
      </span>
      <div class="lt-hbar">
        <div style={{ width: `${(avg / maxAvg) * 100}%` }} />
      </div>
      <span>{fmtNum(avg)}</span>
      <span>{fmtPercent(d.runsWithDrop / runs)}</span>
      <span>
        {d.min}–{d.max}
      </span>
    </div>
  );
}

render(<App />, document.getElementById('app')!);
