// Shrink ray: make the meal pack (image) smaller. Swap the base, add a .dockerignore,
// add a build stage, drop dev tools: the size meter shrinks toward the target.
// Every size is measured on real Docker (src/lib/docker-sizes.json). Moves that would not
// build are refused with the reason. One animation: the meter shrinks (~0.6 s); calm: before → after text.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Lang } from '~/i18n';
import { humanSize, MB } from '~/lib/dockerUnits';
import { applyMove, dockerfile, dockerignore, imageOf, isOn, movesFor, sizeOf, startRecipe, type Move, type Recipe, type ShrinkApp } from '~/lib/shrinkRay';
import { RayIcon } from './kitchenIcons';
import { Announce, Feedback, cx, pickPraise, useCardEvents, useLearnerName, useMotionOK, useT } from './shared';
import './docker-games.css';

export interface ShrinkRayProps {
  lang: Lang;
  /** Which measured app: `node-api` (default) or `static-site` (nginx). */
  app?: ShrinkApp;
  /** Starting recipe: `{ base, stage, ignore, prodOnly }` (default: the biggest). */
  start?: Partial<Recipe>;
  /** Moves to offer (default: all for this app). */
  options?: Move[];
  /** Target size in MB (decimal, like Docker prints). Done at or under it. */
  target: number;
  prompt?: string;
  success?: string;
}

export default function ShrinkRay({ lang, app = 'node-api', start, options, target, prompt, success }: ShrinkRayProps) {
  const t = useT(lang);
  const learner = useLearnerName();
  const motionOK = useMotionOK();
  const { ref, emit } = useCardEvents();
  const first = useMemo(() => startRecipe(app, start), [app, start]);
  const moves = useMemo(() => movesFor(app, options), [app, options]);
  const [recipe, setRecipe] = useState<Recipe>(first);
  const [prev, setPrev] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ kind: 'almost' | 'note'; text: string } | null>(null);
  const [done, setDone] = useState(false);
  const [zap, setZap] = useState(0);
  // Replay: show the size before the last move for a moment, then let the meter shrink again.
  const [rewind, setRewind] = useState(false);
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const replay = () => {
    window.clearTimeout(timer.current);
    setRewind(true);
    timer.current = window.setTimeout(() => {
      setRewind(false);
      setZap((n) => n + 1);
    }, 60);
  };
  const [announce, setAnnounce] = useState('');
  const tries = useRef(0);

  const top = sizeOf(app, first) ?? 1;
  const size = sizeOf(app, recipe) ?? top;
  const goal = target * MB;
  const pct = (bytes: number) => `${Math.max(2, Math.min(100, (bytes / top) * 100))}%`;
  const baseMoves = moves.filter((m) => m.startsWith('base:'));
  const otherMoves = moves.filter((m) => !m.startsWith('base:'));

  const moveLabel = (m: Move) => (m.startsWith('base:') ? imageOf(m.slice(5) as Recipe['base']) : t(`shrink.move.${m}`));

  const tap = (m: Move) => {
    if (done) return;
    tries.current++;
    const r = applyMove(app, recipe, m);
    if (!r.ok) {
      const text = r.reason === 'needsStage' ? t(`shrink.needsStage.${m.startsWith('base:') ? 'base' : m}`, { image: moveLabel(m) }) : r.reason === 'stageNeeded' ? t('shrink.stageNeeded', { what: moveLabel(r.by) }) : t('shrink.unknown');
      setMsg({ kind: 'almost', text: `${t('feedback.almost')} ${text}` });
      setAnnounce(text);
      emit('fl:wrong');
      return;
    }
    if (r.recipe === recipe || JSON.stringify(r.recipe) === JSON.stringify(recipe)) return;
    const before = size;
    const after = sizeOf(app, r.recipe) ?? before;
    setPrev(before);
    setRecipe(r.recipe);
    setZap((n) => n + 1);
    const change = after === before ? t('shrink.same') : after < before ? t('shrink.saved', { size: humanSize(before - after) }) : t('shrink.grew', { size: humanSize(after - before) });
    setMsg(after === before && m === 'ignore' && r.recipe.stage ? { kind: 'note', text: t('shrink.ignoreStage') } : null);
    setAnnounce(`${t('shrink.now', { size: humanSize(after) })} ${change}`);
    if (after <= goal) {
      setDone(true);
      emit('fl:done', { tries: tries.current });
    }
  };

  const file = dockerfile(app, recipe);
  const ignore = dockerignore(app, recipe);
  const delta = prev === null ? null : size - prev;

  return (
    <div className="shrink" ref={ref}>
      <p className="interactive-help">{prompt ?? t('shrink.help', { target: humanSize(goal) })}</p>

      <div className="shrink-meter-wrap">
        <p className="shrink-now">
          <span className={cx('shrink-ray', motionOK && zap > 0 && 'is-zap')} key={zap} aria-hidden="true">
            <RayIcon size={22} />
          </span>
          <span>
            {t('shrink.size')} <strong>{humanSize(size)}</strong>
          </span>
          {delta !== null && delta !== 0 && <span className={cx('dg-chip', delta < 0 ? 'dg-chip-ok' : 'dg-chip-wait')}>{delta < 0 ? `−${humanSize(-delta)}` : `+${humanSize(delta)}`}</span>}
        </p>
        <div className="shrink-meter" role="meter" aria-valuemin={0} aria-valuemax={Math.round(top / MB)} aria-valuenow={Math.round(size / MB)} aria-valuetext={humanSize(size)} aria-label={t('shrink.size')}>
          <div className={cx('shrink-fill', size <= goal && 'is-under', rewind && 'is-rewind')} style={{ width: pct(rewind && prev !== null ? prev : size) }} />
          <div className="shrink-target" style={{ left: pct(goal) }} aria-hidden="true" />
        </div>
        <p className="shrink-scale">
          <span>
            {t('shrink.target')} {humanSize(goal)}
          </span>
          <span>
            {t('shrink.start')} {humanSize(top)}
          </span>
        </p>
        {motionOK && prev !== null && (
          <div className="scene-controls">
            <button type="button" className="btn btn-ghost scene-btn" onClick={replay}>
              ↺ {t('anim.replay')}
            </button>
          </div>
        )}
        {!motionOK && prev !== null && (
          <p className="shrink-compare">
            {t('anim.before')}: {humanSize(prev)} → {t('anim.after')}: {humanSize(size)}
          </p>
        )}
      </div>

      {baseMoves.length > 0 && (
        <>
          <p className="dg-head">
            {t('shrink.bases')}
          </p>
          <div className="shrink-moves" role="group" aria-label={t('shrink.bases')}>
            {baseMoves.map((m) => (
              <button key={m} type="button" className={cx('shrink-move', isOn(recipe, m) && 'is-on')} aria-pressed={isOn(recipe, m)} disabled={done} onClick={() => tap(m)}>
                <code>{moveLabel(m)}</code>
              </button>
            ))}
          </div>
        </>
      )}
      {otherMoves.length > 0 && (
        <>
          <p className="dg-head">{t('shrink.tricks')}</p>
          <div className="shrink-moves" role="group" aria-label={t('shrink.tricks')}>
            {otherMoves.map((m) => (
              <button key={m} type="button" className={cx('shrink-move', isOn(recipe, m) && 'is-on')} aria-pressed={isOn(recipe, m)} disabled={done} onClick={() => tap(m)}>
                <span className="shrink-move-name">{t(`shrink.move.${m}`)}</span>
                <span className="shrink-move-means">{t(`shrink.means.${m}`)}</span>
              </button>
            ))}
          </div>
        </>
      )}

      <div className="shrink-files">
        <section aria-label={t('shrink.dockerfile')}>
          <p className="dg-head dg-file">{t('shrink.dockerfile')}</p>
          <pre className="dg-code" tabIndex={0}>
            {file.join('\n')}
          </pre>
        </section>
        {ignore.length > 0 && (
          <section aria-label=".dockerignore">
            <p className="dg-head dg-file">.dockerignore</p>
            <pre className="dg-code" tabIndex={0}>
              {ignore.join('\n')}
            </pre>
          </section>
        )}
      </div>

      {msg?.kind === 'almost' && !done && <Feedback kind="almost">{msg.text}</Feedback>}
      {msg?.kind === 'note' && !done && <p className="dg-note">{msg.text}</p>}
      {done && <Feedback kind="right">{success ?? `${pickPraise(t, learner, tries.current)} ${t('shrink.done', { size: humanSize(size) })}`}</Feedback>}
      <Announce text={announce} />
    </div>
  );
}
