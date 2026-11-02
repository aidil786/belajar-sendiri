// Kek lapis builder: each Dockerfile line stacks one cake layer. Change a file, build again:
// layers up to the first change stay CACHED; that layer and every one on top bake again.
// The learner reorders lines (↑ ↓) or picks another version of a line, then presses Build.
// One animation (the second build, bottom layer first, under 2 s); calm mode shows Before/After.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Lang } from '~/i18n';
import { humanSize } from '~/lib/dockerUnits';
import { buildOutput, checkKek, editFile, layerKind, moveLine, normaliseLines, pickOption, rebuild, type KekBuild, type KekEdit, type KekGoal, type KekLine, type KekLineProp } from '~/lib/kekLapis';
import { KeptIcon, OvenIcon } from './kitchenIcons';
import { Announce, Feedback, cx, pickPraise, useCardEvents, useLearnerName, useMotionOK, useT, type T } from './shared';
import './docker-games.css';

export interface KekLapisBuilderProps {
  lang: Lang;
  /** Dockerfile lines, top first. FROM stays on line 1. */
  lines: KekLineProp[];
  /** What changes before the second build: a file name, `{ file }` or `{ line, text }`. */
  edit: KekEdit;
  /** Without a goal the card is done after the first build. */
  goal?: KekGoal;
  /** Your own task sentence (default: a general one). */
  prompt?: string;
  success?: string;
}

const MAX_MS = 1800;

export default function KekLapisBuilder({ lang, lines: lineProps, edit, goal, prompt, success }: KekLapisBuilderProps) {
  const t = useT(lang);
  const learner = useLearnerName();
  const motionOK = useMotionOK();
  const { ref, emit } = useCardEvents();
  const start = useMemo(() => normaliseLines(lineProps), [lineProps]);
  const [lines, setLines] = useState<KekLine[]>(start);
  const [build, setBuild] = useState<KekBuild | null>(null);
  // How many layers of the second build are shown (bottom first). -1: the first build (all baked).
  const [shown, setShown] = useState(-1);
  const [msg, setMsg] = useState<{ kind: 'right' | 'almost'; text: string } | null>(null);
  const [done, setDone] = useState(false);
  const [announce, setAnnounce] = useState('');
  const timer = useRef(0);
  const tries = useRef(0);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const file = editFile(edit);
  const editLabel = typeof edit === 'object' && edit.label ? edit.label : file ? t('kek.editFile', { file }) : t('kek.editLine', { n: lines.findIndex((l) => typeof edit === 'object' && 'line' in edit && l.id === edit.line) + 1 });
  const textOf = (id: string) => lines.find((l) => l.id === id)?.text ?? id;
  const animating = build !== null && shown >= 0 && shown < build.layers.length;

  const change = (next: KekLine[]) => {
    if (done) return;
    window.clearTimeout(timer.current);
    setLines(next);
    setBuild(null);
    setShown(-1);
    setMsg(null);
  };

  const move = (i: number, dir: -1 | 1) => {
    const next = moveLine(lines, i, dir);
    if (next === lines) return;
    change(next);
    const j = i + dir;
    setAnnounce(t('kek.moved', { line: next[j]!.text, n: j + 1 }));
  };

  const pick = (i: number, text: string) => change(pickOption(lines, i, text));

  const verdictText = (b: KekBuild): { ok: boolean; text: string } => {
    if (!goal) return { ok: true, text: '' };
    const v = checkKek(goal, lines, b);
    if (v.ok) return { ok: true, text: '' };
    if (v.reason === 'order') return { ok: false, text: t('kek.almost.order', { line: textOf(v.want), n: v.index + 1 }) };
    if (v.reason === 'cached') {
      if (v.why === 'below' && v.because) return { ok: false, text: t('kek.almost.below', { line: textOf(v.id), cause: textOf(v.because) }) };
      if (v.why === 'copiesFile') return { ok: false, text: t('kek.almost.copies', { line: textOf(v.id), file: file ?? '' }) };
      return { ok: false, text: t('kek.almost.edited', { line: textOf(v.id) }) };
    }
    return { ok: false, text: t('kek.almost.count', { got: v.got, need: v.need, cause: v.miss ? textOf(v.miss) : '' }) };
  };

  const finish = (b: KekBuild) => {
    setShown(b.layers.length);
    const summary = t('kek.summary', { cached: b.cachedSteps, steps: b.steps - 1, size: humanSize(b.rebakedBytes) });
    const v = verdictText(b);
    if (v.ok) {
      setDone(true);
      setMsg({ kind: 'right', text: success ?? pickPraise(t, learner, tries.current) });
      setAnnounce(summary);
      emit('fl:done', { tries: tries.current });
    } else {
      setMsg({ kind: 'almost', text: `${t('feedback.almost')} ${v.text}` });
      setAnnounce(`${summary} ${v.text}`);
      emit('fl:wrong');
    }
  };

  const play = (b: KekBuild) => {
    window.clearTimeout(timer.current);
    if (!motionOK) {
      finish(b);
      return;
    }
    const step = Math.min(320, Math.floor(MAX_MS / b.layers.length));
    let i = 0;
    setShown(0);
    const tick = () => {
      i++;
      if (i >= b.layers.length) finish(b);
      else {
        setShown(i);
        timer.current = window.setTimeout(tick, step);
      }
    };
    timer.current = window.setTimeout(tick, step);
  };

  const run = () => {
    tries.current++;
    setMsg(null);
    const b = rebuild(lines, edit);
    setBuild(b);
    play(b);
  };

  const replay = () => {
    if (!build) return;
    window.clearTimeout(timer.current);
    let i = 0;
    const step = Math.min(320, Math.floor(MAX_MS / build.layers.length));
    setShown(0);
    const tick = () => {
      i++;
      setShown(i);
      if (i < build.layers.length) timer.current = window.setTimeout(tick, step);
    };
    timer.current = window.setTimeout(tick, step);
  };

  // Calm mode: Before (first build) / After (second build).
  const showingBefore = build !== null && shown < 0;
  const toggleCompare = () => {
    if (!build) return;
    setShown(shown < 0 ? build.layers.length : -1);
  };

  return (
    <div className="kek" ref={ref}>
      <p className="interactive-help">{prompt ?? t('kek.help')}</p>
      <div className="kek-grid">
        <section className="kek-file" aria-label={t('kek.dockerfile')}>
          <p className="dg-head">{t('kek.dockerfile')}</p>
          <ol className="kek-lines">
            {lines.map((l, i) => {
              const base = layerKind(l.text) === 'base';
              return (
                <li key={l.id} className={cx('kek-line', base && 'is-base')}>
                  <span className="kek-num" aria-hidden="true">
                    {i + 1}
                  </span>
                  {l.options.length > 1 ? (
                    <select className="kek-select" value={l.text} disabled={done} aria-label={t('kek.pick', { n: i + 1 })} onChange={(e) => pick(i, e.target.value)}>
                      {l.options.map((o) => (
                        <option key={o.text} value={o.text}>
                          {o.text}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <code className="kek-code">{l.text}</code>
                  )}
                  {!base && !done && (
                    <span className="kek-btns">
                      <button type="button" className="dg-icon-btn" disabled={i <= 1} aria-label={t('kek.up', { line: l.text })} onClick={() => move(i, -1)}>
                        ↑
                      </button>
                      <button type="button" className="dg-icon-btn" disabled={i === lines.length - 1} aria-label={t('kek.down', { line: l.text })} onClick={() => move(i, 1)}>
                        ↓
                      </button>
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
          <p className="kek-edit">
            <span aria-hidden="true">✎ </span>
            {t('kek.then', { edit: editLabel })}
          </p>
        </section>

        <section className="kek-cake-wrap" aria-label={t('kek.cake')}>
          <p className="dg-head">{t('kek.cake')}</p>
          <Cake t={t} lines={lines} build={build} shown={shown} motionOK={motionOK} />
        </section>
      </div>

      <div className="scene-controls">
        {!done && (
          <button type="button" className="btn" disabled={animating} onClick={run}>
            <OvenIcon /> {file ? t('kek.build', { file }) : t('kek.buildLine')}
          </button>
        )}
        {build && motionOK && (
          <button type="button" className="btn btn-ghost scene-btn" disabled={animating} onClick={replay}>
            ↺ {t('anim.replay')}
          </button>
        )}
        {build && !motionOK && (
          <>
            <button type="button" className="btn btn-ghost scene-btn" aria-pressed={showingBefore} onClick={toggleCompare}>
              {showingBefore ? t('anim.showAfter') : t('anim.showBefore')}
            </button>
            <span className="scene-state">{showingBefore ? t('kek.before') : t('anim.after')}</span>
          </>
        )}
      </div>

      {build && !animating && !showingBefore && (
        <p className="kek-summary">{t('kek.summary', { cached: build.cachedSteps, steps: build.steps - 1, size: humanSize(build.rebakedBytes) })}</p>
      )}
      {build && !animating && (
        <details className="dg-output">
          <summary>{t('kek.output')}</summary>
          <pre tabIndex={0} aria-label={t('kek.output')}>
            {buildOutput(build).join('\n')}
          </pre>
        </details>
      )}
      {msg && !animating && <Feedback kind={msg.kind}>{msg.text}</Feedback>}
      <Announce text={announce} />
    </div>
  );
}

function Cake({ t, lines, build, shown, motionOK }: { t: T; lines: KekLine[]; build: KekBuild | null; shown: number; motionOK: boolean }) {
  // Top layer first on screen; the first Dockerfile line is the bottom of the cake.
  const rows = (build ? build.layers : lines.map((l) => ({ id: l.id, text: l.text, kind: layerKind(l.text), size: l.size, step: null, cached: true, reason: null }))).map((layer, i) => ({ layer, i }));
  return (
    <ol className="kek-cake" aria-label={t('kek.cakeList')}>
      {[...rows].reverse().map(({ layer, i }) => {
        const settled = build !== null && shown > i;
        const active = build !== null && shown === i && motionOK;
        const state = !build || shown < 0 ? 'baked' : settled ? (layer.kind === 'settings' ? 'settings' : layer.cached ? (layer.kind === 'base' ? 'baked' : 'cached') : 'rebaked') : active ? 'baking' : 'waiting';
        return (
          <li key={layer.id} className={cx('kek-layer', `kek-k-${layer.kind}`, `is-${state}`, i % 2 === 1 && 'is-alt')}>
            <code className="kek-layer-text">{layer.text}</code>
            <span className="kek-layer-meta">
              <span className="kek-size">{layer.size === null ? '' : humanSize(layer.size)}</span>
              {state === 'cached' && (
                <span className="dg-chip dg-chip-ok">
                  <KeptIcon size={14} /> CACHED
                </span>
              )}
              {state === 'rebaked' && (
                <span className="dg-chip dg-chip-wait">
                  <OvenIcon size={14} /> {t('kek.rebaked')}
                </span>
              )}
              {state === 'baking' && <span className="dg-chip dg-chip-wait">{t('kek.baking')}</span>}
              {state === 'settings' && <span className="kek-settings">{t('kek.settings')}</span>}
              {state === 'waiting' && <span className="visually-hidden">{t('kek.waiting')}</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
