// UI helpers shared by the loot, advancements and give webviews (not a bundle: no index.tsx).
import type { JSX } from 'preact';
import { t } from '../shared/i18n';
import { cssColor, type TextRun } from '../../src/features/loot/text';
import type { Summary } from '../../src/features/loot/lootModel';

/** Inject a <style> block once per id. */
export function injectStyle(id: string, css: string): void {
  if (document.getElementById(id)) return;
  const el = document.createElement('style');
  el.id = id;
  el.textContent = css;
  document.head.appendChild(el);
}

/** Render styled text runs with Minecraft colours. */
export function Runs({ runs, class: cls }: { runs: TextRun[]; class?: string }): JSX.Element {
  return (
    <span class={cls}>
      {runs.map((r, i) => (
        <span
          key={i}
          class={r.obfuscated ? 'mc-obf' : undefined}
          style={{
            color: cssColor(r.color),
            fontWeight: r.bold ? 'bold' : undefined,
            fontStyle: r.italic ? 'italic' : undefined,
            textDecoration: [r.underlined ? 'underline' : '', r.strikethrough ? 'line-through' : ''].filter(Boolean).join(' ') || undefined,
          }}
        >
          {r.text}
        </span>
      ))}
    </span>
  );
}

const HINT_ICONS: Record<string, string> = {
  silk: '✧',
  shears: '✂',
  player: '⚔',
  chance: '%',
  fortune: '⛏',
  looting: '☠',
  explosion: '✸',
  fire: '♨',
  tool: '⚒',
};

/** A translated plain-language summary (function / condition), with nested children. */
export function SummaryView({ s, kind }: { s: Summary; kind: 'fn' | 'cond' }): JSX.Element {
  const icon = s.hint ? HINT_ICONS[s.hint] : kind === 'cond' ? '?' : 'ƒ';
  return (
    <div class={`lt-sum lt-sum-${kind}`} title={s.type}>
      <span class="lt-sum-icon">{icon}</span>
      <span>{t(s.text, ...(s.args ?? []).map((a) => (typeof a === 'string' ? a.replace(/^minecraft:/, '') : a)))}</span>
      {s.children?.length ? (
        <div class="lt-sum-children">
          {s.children.map((c, i) => (
            <SummaryView key={i} s={c} kind={c.type === 'when' ? 'cond' : kind} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export const SHARED_CSS = `
.lt-sum { display: block; font-size: 12px; line-height: 1.45; }
.lt-sum-icon { display: inline-block; min-width: 14px; text-align: center; margin-right: 4px; opacity: .8; font-weight: bold; }
.lt-sum-fn .lt-sum-icon { color: var(--vscode-symbolIcon-functionForeground, #b180d7); }
.lt-sum-cond .lt-sum-icon { color: var(--vscode-symbolIcon-booleanForeground, #4fc1ff); }
.lt-sum-children { margin-left: 12px; padding-left: 6px; border-left: 1px solid var(--vscode-panel-border, rgba(128,128,128,.35)); }
.mc-tooltip-box { background: rgba(16,0,16,.94); border: 2px solid #25015b; outline: 1px solid rgba(16,0,16,.94); border-radius: 3px; padding: 5px 8px; color: #fff; font-family: 'Minecraft', 'Monocraft', var(--vscode-editor-font-family, monospace); font-size: 13px; line-height: 1.5; text-shadow: 1px 1px 0 rgba(0,0,0,.6); }
.mc-tooltip-box .line { min-height: 1.4em; white-space: pre-wrap; }
.mc-obf { filter: blur(2px); }
`;
