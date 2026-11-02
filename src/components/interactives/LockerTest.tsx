// Locker test: predict, then reveal. A container keeps data in four places: its own layer
// (inside the lunchbox), a volume (a locker), a bind mount (your shelf at home) and tmpfs
// (a note in memory). Pick "Stays" or "Gone" for each, run the real commands, see the truth.
// One animation per reveal (the lunchbox is thrown away / restarted, ~1 s); calm: Before/After.
import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import type { Lang } from '~/i18n';
import { actionCommands, filePath, normaliseAsk, runLine, score, stores, survives, type LockerAction, type LockerMount, type Store, type StoreKind } from '~/lib/lockerTest';
import { DangerIcon } from './AreaIcons';
import { KeptIcon, LockerIcon, LunchboxIcon, NoteIcon, ShelfIcon } from './kitchenIcons';
import { Announce, Feedback, cx, pickPraise, useCardEvents, useLearnerName, useMotionOK, useT, type T } from './shared';
import './docker-games.css';

export interface LockerTestProps {
  lang: Lang;
  /** Where data lives. Kinds, or `{ kind, name?, target?, file? }`. Default: all four. */
  mounts?: (LockerMount | StoreKind)[];
  /** What to do, one question each: `restart`, `recreate` (rm + run), `volumeRm`. Default `['recreate']`. */
  ask?: LockerAction | LockerAction[];
  container?: string;
  image?: string;
  prompt?: string;
  success?: string;
}

const ICONS: Record<StoreKind, ComponentType<{ size?: number }>> ={ writable: LunchboxIcon, volume: LockerIcon, bind: ShelfIcon, tmpfs: NoteIcon };
const REVEAL_MS = 1000;

export default function LockerTest({ lang, mounts, ask, container = 'kedai', image = 'nginx:1.29-alpine', prompt, success }: LockerTestProps) {
  const t = useT(lang);
  const learner = useLearnerName();
  const motionOK = useMotionOK();
  const { ref, emit } = useCardEvents();
  const list = useMemo(() => stores(mounts), [mounts]);
  const questions = useMemo(() => normaliseAsk(ask), [ask]);
  const [q, setQ] = useState(0);
  const [guess, setGuess] = useState<(boolean | null)[]>(() => list.map(() => null));
  // idle → running (animation) → shown; calm mode skips running.
  const [phase, setPhase] = useState<'idle' | 'running' | 'shown'>('idle');
  const [before, setBefore] = useState(false);
  const [done, setDone] = useState(false);
  const [announce, setAnnounce] = useState('');
  const timer = useRef(0);
  const tries = useRef(0);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const action = questions[q] ?? 'recreate';
  const result = phase === 'shown' ? score(list, action, guess) : null;
  const allGuessed = guess.every((g) => g !== null);
  const kindName = (s: Store) => t(`locker.kind.${s.kind}`, { name: s.name });

  const reveal = () => {
    if (!allGuessed) return;
    tries.current++;
    const finish = () => {
      setPhase('shown');
      const r = score(list, action, guess);
      const parts = list.map((s) => `${s.file}: ${survives(s.kind, action) ? t('locker.stays') : t('locker.gone')}`).join('. ');
      setAnnounce(`${t('locker.right', { right: r.right, total: r.total })} ${parts}.`);
      if (r.wrong.length) emit('fl:wrong');
      else if (q === questions.length - 1) {
        setDone(true);
        emit('fl:done', { tries: tries.current });
      }
    };
    setBefore(false);
    if (!motionOK) finish();
    else {
      setPhase('running');
      timer.current = window.setTimeout(finish, REVEAL_MS);
    }
  };

  /** Play the reveal again (no new score). */
  const replay = () => {
    window.clearTimeout(timer.current);
    setPhase('running');
    timer.current = window.setTimeout(() => setPhase('shown'), REVEAL_MS);
  };

  const retry = () => {
    setGuess(list.map(() => null));
    setPhase('idle');
    setBefore(false);
  };

  const next = () => {
    setQ(q + 1);
    retry();
  };

  const showTruth = phase === 'shown' && !before;

  return (
    <div className="locker" ref={ref}>
      <p className="interactive-help">{prompt ?? t('locker.help')}</p>
      <div className="dg-term" role="group" aria-label={t('locker.started')}>
        <code className="dg-term-line">$ {runLine(list, container, image)}</code>
      </div>
      {questions.length > 1 && <p className="locker-progress">{t('locker.progress', { n: q + 1, total: questions.length })}</p>}

      <div className={cx('locker-board', phase === 'running' && `is-running is-${action}`)}>
        <div className="locker-box">
          <p className="dg-head">
            <LunchboxIcon size={16} /> {t('locker.box', { name: container })}
          </p>
          <ul className="locker-items">
            {list.map((s, i) => (s.kind === 'writable' || s.kind === 'tmpfs' ? <Item key={i} t={t} s={s} i={i} {...{ guess, setGuess, phase, action, showTruth, kindName }} /> : null))}
          </ul>
        </div>
        <div className="locker-outside">
          <p className="dg-head">{t('locker.outside')}</p>
          <ul className="locker-items">
            {list.map((s, i) => (s.kind === 'volume' || s.kind === 'bind' ? <Item key={i} t={t} s={s} i={i} {...{ guess, setGuess, phase, action, showTruth, kindName }} /> : null))}
          </ul>
        </div>
      </div>

      <div className="locker-action">
        <p className="dg-head">{t('locker.then')}</p>
        <p className="locker-action-name">{t(`locker.action.${action}`)}</p>
        <div className="dg-term" role="group" aria-label={t('locker.commands')}>
          {actionCommands(action, list, container, image).map((c) => (
            <code key={c} className="dg-term-line">
              $ {c}
            </code>
          ))}
        </div>
      </div>

      <div className="scene-controls">
        {phase !== 'shown' && (
          <button type="button" className="btn" disabled={!allGuessed || phase === 'running'} onClick={reveal}>
            {t('locker.run')}
          </button>
        )}
        {phase === 'shown' && motionOK && (
          <button type="button" className="btn btn-ghost scene-btn" onClick={replay}>
            ↺ {t('anim.replay')}
          </button>
        )}
        {phase === 'shown' && !motionOK && (
          <>
            <button type="button" className="btn btn-ghost scene-btn" aria-pressed={before} onClick={() => setBefore(!before)}>
              {before ? t('anim.showAfter') : t('anim.showBefore')}
            </button>
            <span className="scene-state">{before ? t('anim.before') : t('anim.after')}</span>
          </>
        )}
        {result && result.wrong.length > 0 && (
          <button type="button" className="btn btn-ghost scene-btn" onClick={retry}>
            ↺ {t('feedback.tryAgain')}
          </button>
        )}
        {result && result.wrong.length === 0 && q < questions.length - 1 && (
          <button type="button" className="btn scene-btn" onClick={next}>
            {t('locker.next')} →
          </button>
        )}
      </div>
      {!allGuessed && phase === 'idle' && <p className="locker-hint">{t('locker.guessAll')}</p>}

      {result && result.wrong.length > 0 && (
        <Feedback kind="almost">
          {t('feedback.almost')} {result.wrong.map((i) => t(`locker.why.${list[i]!.kind}.${survives(list[i]!.kind, action) ? 'kept' : 'lost'}`, { name: list[i]!.name })).join(' ')}
        </Feedback>
      )}
      {result && result.wrong.length === 0 && (
        <Feedback kind="right">
          {done ? (success ?? pickPraise(t, learner, tries.current)) : `${pickPraise(t, learner, tries.current)} ${t('locker.right', { right: result.right, total: result.total })}`}
        </Feedback>
      )}
      <Announce text={announce} />
    </div>
  );
}

function Item({
  t,
  s,
  i,
  guess,
  setGuess,
  phase,
  action,
  showTruth,
  kindName,
}: {
  t: T;
  s: Store;
  i: number;
  guess: (boolean | null)[];
  setGuess: (g: (boolean | null)[]) => void;
  phase: 'idle' | 'running' | 'shown';
  action: LockerAction;
  showTruth: boolean;
  kindName: (s: Store) => string;
}) {
  const Icon = ICONS[s.kind];
  const kept = survives(s.kind, action);
  const g = guess[i];
  const set = (v: boolean) => setGuess(guess.map((x, j) => (j === i ? v : x)));
  const locked = phase !== 'idle';
  return (
    <li className={cx('locker-item', `locker-k-${s.kind}`, showTruth && (kept ? 'is-kept' : 'is-gone'))}>
      <div className="locker-item-head">
        <span className="locker-icon">
          <Icon size={20} />
        </span>
        <span>
          <span className="locker-kind">{kindName(s)}</span>
          <code className="locker-file">{filePath(s)}</code>
        </span>
      </div>
      {showTruth ? (
        <p className={cx('locker-truth', kept ? 'is-kept' : 'is-gone')}>
          {kept ? <KeptIcon /> : <DangerIcon />} {kept ? t('locker.stays') : t('locker.gone')}
          <span className="locker-yours">{g === kept ? t('locker.youRight') : t('locker.youAlmost')}</span>
        </p>
      ) : (
        <div className="locker-guess" role="group" aria-label={t('locker.question', { file: s.file })}>
          <button type="button" className={cx('locker-pick', g === true && 'is-on')} aria-pressed={g === true} disabled={locked} onClick={() => set(true)}>
            {t('locker.stays')}
          </button>
          <button type="button" className={cx('locker-pick', g === false && 'is-on')} aria-pressed={g === false} disabled={locked} onClick={() => set(false)}>
            {t('locker.gone')}
          </button>
        </div>
      )}
    </li>
  );
}
