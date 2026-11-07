// Advancement tree (tabs per root, pan/zoom, frames, hover details) and single-advancement preview (toast).
import { render } from 'preact';
import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { boot, call, onEvent } from '../shared/vscode';
import { t } from '../shared/i18n';
import { Button, ItemIcon } from '../shared/components';
import { renderVisual } from '../shared/itemRenderer';
import { backgroundTexture, buildTabs, type AdvancementInfo, type AdvancementTab, type Frame } from '../../src/features/loot/advancementModel';
import { plainText, textRuns } from '../../src/features/loot/text';
import type { AdvancementSingleData, AdvancementTreeData, AdvancementViewState } from '../../src/features/loot/protocol';
import { injectStyle, Runs, SHARED_CSS } from '../lootShared/ui';

injectStyle('lt-shared', SHARED_CSS);
injectStyle(
  'adv',
  `
body { padding: 10px 14px; }
.adv-tabs { display: flex; gap: 2px; flex-wrap: wrap; margin-bottom: 0; }
.adv-tab { display: flex; align-items: center; gap: 6px; padding: 4px 10px 4px 6px; border: 1px solid var(--vscode-panel-border, rgba(128,128,128,.35)); border-bottom: none; border-radius: 4px 4px 0 0; background: var(--vscode-editorWidget-background); color: var(--vscode-foreground); cursor: pointer; opacity: .7; font: inherit; }
.adv-tab.active { opacity: 1; background: #3b3b3b; color: #fff; }
.adv-view { position: relative; overflow: hidden; height: calc(100vh - 120px); min-height: 360px; border: 3px solid #1e1e1e; border-radius: 0 4px 4px 4px; box-shadow: inset 0 0 0 2px #555; background-color: #3a3a3a; cursor: grab; user-select: none; }
.adv-view.dragging { cursor: grabbing; }
.adv-bgshade { position: absolute; inset: 0; background: rgba(0,0,0,.35); pointer-events: none; }
.adv-layer { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
.adv-node { position: absolute; width: 26px; height: 26px; cursor: pointer; }
.adv-node svg { position: absolute; inset: 0; }
.adv-node .mc-icon { position: absolute; left: 5px; top: 5px; }
.adv-node:hover svg { filter: brightness(1.35); }
.adv-node.workspace .adv-dot { position: absolute; right: -3px; top: -3px; width: 7px; height: 7px; border-radius: 50%; background: #55ff55; border: 1px solid #000; }
.adv-label { position: absolute; top: 28px; left: 50%; transform: translateX(-50%); font-size: 7px; line-height: 1.1; color: #fff; text-shadow: 1px 1px 0 #000; white-space: nowrap; max-width: 58px; overflow: hidden; text-overflow: ellipsis; pointer-events: none; }
.adv-hover { position: fixed; z-index: 50; pointer-events: none; min-width: 220px; max-width: 380px; }
.adv-hover .head { display: flex; gap: 8px; align-items: center; padding: 4px 8px; border-radius: 3px 3px 0 0; color: #fff; font-weight: bold; }
.adv-hover .head.task, .adv-hover .head.goal { background: #0f5ea3; }
.adv-hover .head.challenge { background: #6a2a8f; }
.adv-hover .body { background: #212121; border: 2px solid #000; border-top: none; padding: 6px 8px; color: #ddd; font-size: 12px; border-radius: 0 0 3px 3px; }
.adv-hover .desc { color: #55ff55; margin-bottom: 6px; }
.adv-hover .desc.challenge { color: #ff55ff; }
.adv-hover .sec { color: #aaa; margin-top: 4px; }
.adv-hover code { color: #fff; }
.adv-toolbar { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-bottom: 8px; }
.adv-toolbar label { display: inline-flex; gap: 4px; align-items: center; }
.adv-zoom { position: absolute; right: 8px; bottom: 8px; display: flex; gap: 4px; }
.adv-zoom button { background: rgba(0,0,0,.6); color: #fff; border: 1px solid #777; border-radius: 3px; width: 26px; height: 26px; cursor: pointer; font: inherit; }
.adv-empty { padding: 30px; text-align: center; }
.toast { display: inline-flex; gap: 12px; align-items: center; width: 320px; height: 64px; padding: 0 14px 0 10px; background: #212121; border: 2px solid #000; box-shadow: inset 0 0 0 2px #555, inset 0 0 0 4px #000; border-radius: 4px; font-family: 'Minecraft', var(--vscode-editor-font-family, monospace); }
.toast .t1 { font-size: 13px; }
.toast .t2 { color: #fff; font-size: 13px; }
.single { display: flex; flex-direction: column; gap: 12px; max-width: 900px; }
.single .grid { display: grid; grid-template-columns: 140px 1fr; gap: 6px 12px; align-items: start; }
.single .grid > :nth-child(odd) { color: var(--vscode-descriptionForeground); }
.chain { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.chain .lnk { display: inline-flex; align-items: center; gap: 4px; cursor: pointer; padding: 2px 6px; border-radius: 3px; background: var(--vscode-input-background); }
.chain .lnk:hover { outline: 1px solid var(--vscode-focusBorder); }
.crit { margin-bottom: 6px; }
.crit pre { margin: 3px 0 0; padding: 6px; background: var(--vscode-textCodeBlock-background, rgba(128,128,128,.12)); border-radius: 3px; font-size: 11px; max-height: 160px; overflow: auto; }
.frame-badge { display: inline-flex; align-items: center; gap: 6px; }
`,
);

const st = boot<AdvancementViewState>().state ?? { mode: 'tree', version: '26.3' };
const COL = 62;
const ROW = 42;
const PAD = 24;

const FRAME_COLORS: Record<Frame, { fill: string; edge: string }> = {
  task: { fill: '#c6c6c6', edge: '#555' },
  goal: { fill: '#e9c95b', edge: '#7a5a00' },
  challenge: { fill: '#c58ee8', edge: '#5b1f80' },
};

/** Minecraft-like advancement frame (26×26): square task, rounded goal, spiky challenge. */
export function FrameShape({ frame, size = 26 }: { frame: Frame; size?: number }): JSX.Element {
  const c = FRAME_COLORS[frame] ?? FRAME_COLORS.task;
  const common = { fill: c.fill, stroke: '#000', 'stroke-width': 1.5 } as Record<string, unknown>;
  return (
    <svg width={size} height={size} viewBox="0 0 26 26" shape-rendering="crispEdges">
      {frame === 'challenge' ? (
        <polygon {...common} points="13,0 16,4 21,2 21,7 26,9 23,13 26,17 21,19 21,24 16,22 13,26 10,22 5,24 5,19 0,17 3,13 0,9 5,7 5,2 10,4" shape-rendering="geometricPrecision" />
      ) : frame === 'goal' ? (
        <rect {...common} x="1" y="1" width="24" height="24" rx="8" shape-rendering="geometricPrecision" />
      ) : (
        <rect {...common} x="1" y="1" width="24" height="24" />
      )}
      <rect x="4" y="4" width="18" height="18" fill="rgba(0,0,0,.18)" stroke={c.edge} stroke-width="1" rx={frame === 'goal' ? 5 : 0} />
    </svg>
  );
}

function headerText(frame: Frame): string {
  return frame === 'goal' ? t('Goal Reached!') : frame === 'challenge' ? t('Challenge Complete!') : t('Advancement Made!');
}

/** Tooltip / hover card content for an advancement. */
function Details({ a, lang }: { a: AdvancementInfo; lang: Record<string, string> }): JSX.Element {
  const d = a.display;
  const frame = d?.frame ?? 'task';
  return (
    <div>
      <div class={`head ${frame}`}>
        <Runs runs={textRuns(d?.title ?? a.id, lang)} />
      </div>
      <div class="body">
        {d?.description ? (
          <div class={`desc ${frame}`}>
            <Runs runs={textRuns(d.description, lang)} />
          </div>
        ) : null}
        <div class="sec">
          {t('Criteria')} ({a.criteria.length}):
        </div>
        {a.criteria.slice(0, 8).map((c) => (
          <div key={c.name}>
            • <code>{c.name}</code> — {c.trigger.replace(/^minecraft:/, '')}
          </div>
        ))}
        {a.criteria.length > 8 ? <div>… {t('{0} more', a.criteria.length - 8)}</div> : null}
        {a.requirements && a.requirements.length > 1 ? <div class="sec">{t('Requirements: all of {0} groups', a.requirements.length)}</div> : null}
        {a.rewards ? <div class="sec">{t('Rewards')}: {rewardText(a)}</div> : null}
        <div class="sec" style={{ fontSize: '11px' }}>
          {a.id}
          {a.source === 'vanilla' ? ` · ${t('vanilla')}` : ''}
        </div>
      </div>
    </div>
  );
}

function rewardText(a: AdvancementInfo): string {
  const r = a.rewards ?? {};
  const parts: string[] = [];
  if (r.experience) parts.push(t('{0} XP', r.experience));
  if (r.recipes?.length) parts.push(t('{0} recipe(s)', r.recipes.length));
  if (r.loot?.length) parts.push(t('loot: {0}', r.loot.join(', ')));
  if (r.function) parts.push(t('function {0}', r.function));
  return parts.join(' · ') || '—';
}

/** Tiled tab background drawn from a block texture. */
function useBackground(background: string | undefined): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    let alive = true;
    const id = backgroundTexture(background);
    void call('textures.resolve', { ids: [id] })
      .then(async (res) => {
        const ref = res[id];
        if (!ref || !alive) return;
        const canvas = document.createElement('canvas');
        canvas.width = 16;
        canvas.height = 16;
        await renderVisual(canvas, { type: 'flat', id, layers: [{ texture: ref }] });
        if (alive) setUrl(canvas.toDataURL());
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [background]);
  return url;
}

function TreeView({ tab, byId, lang }: { tab: AdvancementTab; byId: Map<string, AdvancementInfo>; lang: Record<string, string> }): JSX.Element {
  const [zoom, setZoom] = useState(1.6);
  const [pan, setPan] = useState({ x: 20, y: 20 });
  const [hover, setHover] = useState<{ a: AdvancementInfo; x: number; y: number } | null>(null);
  const [labels, setLabels] = useState(true);
  const drag = useRef<{ x: number; y: number; px: number; py: number; moved: boolean } | null>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const root = byId.get(tab.root);
  const bg = useBackground(root?.display?.background);
  useEffect(() => {
    setPan({ x: 20, y: 20 });
  }, [tab.root]);

  const pos = new Map(tab.nodes.map((n) => [n.id, { x: PAD + n.x * COL, y: PAD + n.y * ROW }]));
  const w = PAD * 2 + (tab.width - 1) * COL + 26;
  const h = PAD * 2 + (tab.height - 1) * ROW + 40;

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const rect = viewRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const nz = Math.min(4, Math.max(0.4, zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
    setPan({ x: mx - ((mx - pan.x) * nz) / zoom, y: my - ((my - pan.y) * nz) / zoom });
    setZoom(nz);
  };

  return (
    <div>
      <div
        ref={viewRef}
        class={`adv-view ${drag.current ? 'dragging' : ''}`}
        style={bg ? { backgroundImage: `url(${bg})`, backgroundSize: `${16 * zoom}px`, backgroundPosition: `${pan.x}px ${pan.y}px`, imageRendering: 'pixelated' } : undefined}
        onWheel={onWheel}
        onMouseDown={(e) => (drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y, moved: false })}
        onMouseMove={(e) => {
          const d = drag.current;
          if (!d) return;
          if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 3) d.moved = true;
          setPan({ x: d.px + e.clientX - d.x, y: d.py + e.clientY - d.y });
        }}
        onMouseUp={() => setTimeout(() => (drag.current = null))}
        onMouseLeave={() => (drag.current = null)}
      >
        <div class="adv-bgshade" />
        <div class="adv-layer" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, width: `${w}px`, height: `${h}px` }}>
          <svg width={w} height={h} style={{ position: 'absolute', left: 0, top: 0 }}>
            {[3, 1].map((sw) =>
              tab.edges.map(([p, c]) => {
                const a = pos.get(p)!;
                const b = pos.get(c)!;
                const x1 = a.x + 26;
                const y1 = a.y + 13;
                const x2 = b.x;
                const y2 = b.y + 13;
                const mx = x1 + (x2 - x1) / 2;
                return <path key={`${sw}${p}${c}`} d={`M${x1} ${y1} H${mx} V${y2} H${x2}`} fill="none" stroke={sw === 3 ? '#000' : '#fff'} stroke-width={sw} />;
              }),
            )}
          </svg>
          {tab.nodes.map((n) => {
            const a = byId.get(n.id);
            const p = pos.get(n.id)!;
            if (!a) return null;
            return (
              <div
                key={n.id}
                class={`adv-node ${a.source}`}
                style={{ left: `${p.x}px`, top: `${p.y}px` }}
                data-id={n.id}
                onMouseEnter={(e) => setHover({ a, x: e.clientX, y: e.clientY })}
                onMouseMove={(e) => setHover({ a, x: e.clientX, y: e.clientY })}
                onMouseLeave={() => setHover(null)}
                onClick={() => {
                  if (!drag.current?.moved) void call('adv.open', { id: a.id, uri: a.uri });
                }}
              >
                <FrameShape frame={a.display?.frame ?? 'task'} />
                <ItemIcon id={a.display?.icon ?? 'minecraft:barrier'} size={16} cycleMs={0} title="" />
                {a.source === 'workspace' ? <span class="adv-dot" /> : null}
                {labels ? <span class="adv-label">{plainText(a.display?.title ?? a.id, lang)}</span> : null}
              </div>
            );
          })}
        </div>
        <div class="adv-zoom" onMouseDown={(e) => e.stopPropagation()}>
          <button title={t('Toggle labels')} onClick={() => setLabels(!labels)}>
            T
          </button>
          <button title={t('Zoom in')} onClick={() => setZoom(Math.min(4, zoom * 1.25))}>
            +
          </button>
          <button title={t('Zoom out')} onClick={() => setZoom(Math.max(0.4, zoom / 1.25))}>
            −
          </button>
          <button
            title={t('Reset view')}
            onClick={() => {
              setZoom(1.6);
              setPan({ x: 20, y: 20 });
            }}
          >
            ⟲
          </button>
        </div>
      </div>
      {hover ? (
        <div class="adv-hover" style={{ left: `${Math.min(hover.x + 14, window.innerWidth - 390)}px`, top: `${Math.min(hover.y + 14, window.innerHeight - 200)}px` }}>
          <Details a={hover.a} lang={lang} />
        </div>
      ) : null}
    </div>
  );
}

function TreeApp(): JSX.Element {
  const [data, setData] = useState<AdvancementTreeData | null>(null);
  const [includeVanilla, setIncludeVanilla] = useState(false);
  const [includeHidden, setIncludeHidden] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const load = () => {
    setLoading(true);
    void call<AdvancementTreeData>('adv.load', { includeVanilla })
      .then(setData)
      .finally(() => setLoading(false));
  };
  useEffect(load, [includeVanilla]);
  useEffect(() => onEvent('adv.changed', load), [includeVanilla]);
  const byId = useMemo(() => new Map((data?.advancements ?? []).map((a) => [a.id, a])), [data]);
  const tabs = useMemo(() => buildTabs(data?.advancements ?? [], { includeHidden }), [data, includeHidden]);
  const tab = tabs.find((x) => x.root === active) ?? tabs[0];
  const lang = data?.lang ?? {};
  const wsCount = data?.advancements.filter((a) => a.source === 'workspace').length ?? 0;
  return (
    <div>
      <div class="adv-toolbar">
        <h1 style={{ margin: 0, fontSize: '1.2em' }}>{t('Advancements')}</h1>
        <span class="mc-muted">
          {t('{0} in the workspace', wsCount)} · Minecraft {data?.version ?? st.version}
        </span>
        <label>
          <input type="checkbox" checked={includeVanilla} onChange={(e) => setIncludeVanilla((e.target as HTMLInputElement).checked)} /> {t('Include vanilla')}
        </label>
        <label title={t('Advancements without a display (e.g. recipe unlocks)')}>
          <input type="checkbox" checked={includeHidden} onChange={(e) => setIncludeHidden((e.target as HTMLInputElement).checked)} /> {t('Show advancements without display')}
        </label>
        <span class="mc-spacer" />
        {loading ? <span class="mc-muted">{t('Loading…')}</span> : null}
        <Button icon="+" onClick={() => call('adv.new', {})}>
          {t('New Advancement…')}
        </Button>
      </div>
      {tabs.length ? (
        <>
          <div class="adv-tabs">
            {tabs.map((x) => {
              const a = byId.get(x.root);
              return (
                <button key={x.root} class={`adv-tab ${x === tab ? 'active' : ''}`} title={x.root} onClick={() => setActive(x.root)}>
                  <ItemIcon id={a?.display?.icon ?? 'minecraft:barrier'} size={18} cycleMs={0} title="" />
                  {plainText(a?.display?.title ?? x.root, lang) || x.root}
                </button>
              );
            })}
          </div>
          {tab ? <TreeView tab={tab} byId={byId} lang={lang} /> : null}
        </>
      ) : !loading ? (
        <div class="mc-card adv-empty mc-muted">
          {t('No advancements found in the workspace.')} {!includeVanilla ? t('Enable “Include vanilla” to browse the vanilla ones.') : ''}
        </div>
      ) : null}
    </div>
  );
}

function Toast({ a, lang }: { a: AdvancementInfo; lang: Record<string, string> }): JSX.Element {
  const frame = a.display?.frame ?? 'task';
  return (
    <div class="toast">
      <ItemIcon id={a.display?.icon ?? 'minecraft:barrier'} size={32} cycleMs={0} />
      <div>
        <div class="t1" style={{ color: frame === 'challenge' ? '#FF55FF' : '#FFFF55' }}>
          {headerText(frame)}
        </div>
        <div class="t2">
          <Runs runs={textRuns(a.display?.title ?? a.id, lang)} />
        </div>
      </div>
    </div>
  );
}

function ChainLink({ a, lang }: { a: AdvancementInfo; lang: Record<string, string> }): JSX.Element {
  return (
    <span class="lnk" title={a.id} onClick={() => call('adv.open', { id: a.id, uri: a.uri })}>
      <ItemIcon id={a.display?.icon ?? 'minecraft:barrier'} size={16} cycleMs={0} title="" />
      {plainText(a.display?.title ?? a.id, lang) || a.id}
    </span>
  );
}

function SingleApp(): JSX.Element {
  const [data, setData] = useState<AdvancementSingleData | null>(null);
  useEffect(() => {
    void call<AdvancementSingleData>('adv.single').then(setData);
    return onEvent<AdvancementSingleData>('adv.update', setData);
  }, []);
  if (!data) return <div class="mc-muted">{t('Loading…')}</div>;
  const a = data.advancement;
  const lang = data.lang;
  const d = a.display;
  const frame = d?.frame ?? 'task';
  return (
    <div class="single">
      <div class="mc-row">
        <h1 style={{ margin: 0, fontSize: '1.2em' }}>{a.id}</h1>
        <span class="mc-muted">Minecraft {data.version}</span>
        <span class="mc-spacer" />
        <Button secondary icon="+" onClick={() => call('adv.new', { parent: a.id })}>
          {t('New child advancement…')}
        </Button>
      </div>
      {d ? (
        <div class="mc-row" style={{ alignItems: 'flex-start', gap: '24px' }}>
          <div class="mc-col">
            <span class="mc-muted">{t('Toast')}</span>
            {d.showToast ? <Toast a={a} lang={lang} /> : <span class="mc-muted">{t('show_toast is false: no toast is shown.')}</span>}
          </div>
          <div class="mc-col">
            <span class="mc-muted">{t('Advancement screen')}</span>
            <div class="adv-hover" style={{ position: 'static' }}>
              <Details a={a} lang={lang} />
            </div>
          </div>
        </div>
      ) : (
        <div class="mc-card mc-warning">{t('This advancement has no display: it is invisible in the advancement screen (used for recipe unlocks or hidden logic).')}</div>
      )}
      <div class="mc-card grid">
        <span>{t('Frame')}</span>
        <span class="frame-badge">
          <FrameShape frame={frame} size={20} /> {frame}
        </span>
        <span>{t('Parent chain')}</span>
        <span class="chain">
          {data.chain.length > 1
            ? data.chain.map((c, i) => (
                <>
                  {i > 0 ? <span class="mc-muted">›</span> : null}
                  <ChainLink a={c} lang={lang} />
                </>
              ))
            : a.parent
              ? <span class="mc-warning">{t('Parent {0} was not found.', a.parent)}</span>
              : t('Root advancement (creates a tab)')}
        </span>
        {data.children.length ? (
          <>
            <span>{t('Children')}</span>
            <span class="chain">
              {data.children.map((c) => (
                <ChainLink a={c} lang={lang} />
              ))}
            </span>
          </>
        ) : null}
        {d?.background ? (
          <>
            <span>{t('Background')}</span>
            <code>{d.background}</code>
          </>
        ) : null}
        {d ? (
          <>
            <span>{t('Options')}</span>
            <span>
              {[d.showToast ? t('toast') : t('no toast'), d.announceToChat ? t('announced in chat') : t('not announced'), d.hidden ? t('hidden until completed') : '']
                .filter(Boolean)
                .join(' · ')}
            </span>
          </>
        ) : null}
        <span>{t('Criteria')}</span>
        <div>
          {a.criteria.map((c) => (
            <div class="crit" key={c.name}>
              <code>{c.name}</code> — <b>{c.trigger.replace(/^minecraft:/, '')}</b>
              {c.conditions && Object.keys(c.conditions as object).length ? <pre>{JSON.stringify(c.conditions, null, 2)}</pre> : null}
            </div>
          ))}
          {!a.criteria.length ? <span class="mc-error">{t('An advancement needs at least one criterion.')}</span> : null}
        </div>
        <span>{t('Requirements')}</span>
        <span>
          {a.requirements
            ? a.requirements.map((g) => g.join(` ${t('or')} `)).join(` ${t('and')} `)
            : t('all criteria ({0})', a.criteria.length)}
        </span>
        <span>{t('Rewards')}</span>
        <span>{rewardText(a)}</span>
      </div>
    </div>
  );
}

render(st.mode === 'single' ? <SingleApp /> : <TreeApp />, document.getElementById('app')!);
