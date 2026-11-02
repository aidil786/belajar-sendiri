// Rebase card deck: interactive rebase (`git rebase -i`) as a deck of commit cards.
// Reorder by dragging the grip, or with the arrow buttons. Pick an action per card.
// "Run rebase" asks the engine (rebaseInteractive) and the graph shows before → after.
import { Reorder, useDragControls } from 'motion/react';
import { useId, useMemo, useState } from 'react';
import { buildScenario, checkGoal, rebaseInteractive, rebaseTodo, run, type Goal, type RebaseAction, type Scenario, type SimState } from '~/engine/git-sim';
import type { Lang } from '~/i18n';
import {
  ACTIONS,
  deckFromTodo,
  deckProblem,
  failedCommitChecks,
  feedbackFor,
  historySummary,
  moveCard,
  setAction,
  setMessage,
  toSteps,
  type CommitFileCheck,
  type DeckCard,
} from '~/lib/rebaseDeck';
import CommitGraph from './CommitGraph';
import { layoutGraph } from './graphLayout';
import Inline from './Inline';
import { Announce, Feedback, cx, pickPraise, useCardEvents, useLearnerName, useMotionOK, useT, type T } from './shared';
import './branch-lab.css';
import './areas.css';

export interface RebaseDeckProps {
  lang: Lang;
  scenario: Scenario;
  /** What `git rebase -i <upstream>` would use, e.g. 'main' or 'HEAD~3'. */
  upstream: string;
  /** Checked after the rebase (same goals as Sim), e.g. { messages: [...], commits: 5 }. */
  goal?: Goal;
  /** The commit whose message matches has this file content (to check where a fixup landed). */
  commitFiles?: CommitFileCheck[];
  /** Commands run (silently) after the scenario. */
  commands?: string[];
  prompt?: string;
  /** Extra hints, shown one by one after "almost" runs. */
  hints?: string[];
  success?: string;
}

const NONE: string[] = [];
const ICON: Record<RebaseAction, string> = { pick: '✓', reword: '✎', squash: '⤒', fixup: '⤒', drop: '✕' };

export default function RebaseDeck({ lang, scenario, upstream, goal, commitFiles, commands = NONE, prompt, hints = NONE, success }: RebaseDeckProps) {
  const t = useT(lang);
  const name = useLearnerName();
  const motionOK = useMotionOK();
  const { ref, emit } = useCardEvents();

  const start = useMemo(() => {
    let s = buildScenario(scenario);
    for (const c of commands) s = run(s, c).state;
    return s;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenario.id, commands.join('\n')]);
  const initial = useMemo(() => deckFromTodo(rebaseTodo(start, upstream)), [start, upstream]);

  const [cards, setCards] = useState<DeckCard[]>(initial);
  const [after, setAfter] = useState<SimState | null>(null);
  const [view, setView] = useState<'before' | 'after'>('before');
  const [msg, setMsg] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [misses, setMisses] = useState(0);
  const [announce, setAnnounce] = useState('');

  const edit = (next: DeckCard[]) => {
    if (done) return;
    setCards(next);
    setMsg(null);
    if (after) {
      setAfter(null);
      setView('before');
    }
  };

  const miss = (text: string) => {
    const hint = hints[Math.min(hints.length - 1, misses)];
    setMisses((m) => m + 1);
    setMsg(hint ? `${text} ${hint}` : text);
    emit('fl:wrong');
    if (hint) emit('fl:hint');
  };

  const runRebase = () => {
    if (done) return;
    const problem = deckProblem(cards, initial);
    if (problem) {
      if (problem.kind === 'squashFirst') miss(t('rebase.fb.squashFirst', { action: problem.action }));
      else if (problem.kind === 'allDropped') miss(t('rebase.fb.allDropped'));
      else miss(t('rebase.fb.unchanged'));
      return;
    }
    const r = rebaseInteractive(start, upstream, toSteps(cards));
    if (!r.ok) {
      miss(r.stopped ? t('rebase.fb.conflict') : r.explain ? t(r.explain.key, r.explain.params) : t('rebase.fb.other'));
      return;
    }
    setAfter(r.state);
    setView('after');
    const g = goal ? checkGoal(r.state, goal) : { ok: true, failed: [] as string[] };
    const fileFails = failedCommitChecks(r.state, commitFiles).map((i) => `commitFile:${i}`);
    const failed = [...g.failed, ...fileFails];
    if (failed.length) {
      const fb = feedbackFor(failed, { commits: goal?.commits, got: historySummary(r.state).messages.length });
      miss(t(fb.key, fb.params));
      return;
    }
    setMsg(null);
    setDone(true);
    emit('fl:done');
  };

  const reset = () => {
    setCards(initial);
    setAfter(null);
    setView('before');
    setMsg(null);
    setDone(false);
  };

  const byId = new Map(cards.map((c) => [c.commit, c]));
  const shownState = view === 'after' && after ? after : start;

  return (
    <div className="rd" ref={ref}>
      <p className="interactive-help">{prompt ? <Inline text={prompt} /> : t('rebase.help')}</p>
      <div className="scene-command rd-cmd" aria-hidden="true">
        <span className="scene-prompt">$</span> <code>git rebase -i {upstream}</code>
      </div>
      <p className="rd-note">{t('rebase.topOldest')}</p>

      <Reorder.Group
        axis="y"
        values={cards.map((c) => c.commit)}
        onReorder={(ids: string[]) => edit(ids.map((id) => byId.get(id)!))}
        className="rd-deck"
        aria-label={t('rebase.deck')}
      >
        {cards.map((c, i) => (
          <DeckRow
            key={c.commit}
            t={t}
            card={c}
            index={i}
            count={cards.length}
            done={done}
            canDrag={motionOK}
            onMove={(dir) => {
              const next = moveCard(cards, i, dir);
              edit(next);
              setAnnounce(t('rebase.moved', { message: c.message, n: i + dir + 1 }));
            }}
            onAction={(a) => edit(setAction(cards, i, a))}
            onMessage={(m) => edit(setMessage(cards, i, m))}
          />
        ))}
      </Reorder.Group>

      {!done && (
        <div className="rd-actions">
          <button type="button" className="btn" onClick={runRebase}>
            ▶ {t('rebase.run')}
          </button>
          <button type="button" className="btn btn-quiet" onClick={reset}>
            ↺ {t('feedback.reset')}
          </button>
        </div>
      )}

      <figure className="rd-graph">
        <figcaption className="rd-graph-head">
          {view === 'after' && after ? t('rebase.after') : t('rebase.before')}
          <span className="visually-hidden">
            {' '}
            {t('rebase.historySr', { list: historySummary(shownState).messages.join(', ') })}
          </span>
        </figcaption>
        <CommitGraph t={t} layout={layoutGraph(shownState)} motionOK={motionOK} />
        {after && (
          <div className="scene-controls">
            <button type="button" className="btn btn-ghost scene-btn" aria-pressed={view === 'before'} onClick={() => setView(view === 'after' ? 'before' : 'after')}>
              {view === 'after' ? t('anim.showBefore') : t('anim.showAfter')}
            </button>
          </div>
        )}
      </figure>

      {msg && (
        <Feedback kind="almost">
          {t('feedback.almost')} <Inline text={msg} />
        </Feedback>
      )}
      {done && <Feedback kind="right">{success ? <Inline text={success} /> : `${pickPraise(t, name, misses)} ${t('rebase.done')}`}</Feedback>}
      <Announce text={announce} />
    </div>
  );
}

interface DeckRowProps {
  t: T;
  card: DeckCard;
  index: number;
  count: number;
  done: boolean;
  canDrag: boolean;
  onMove: (dir: -1 | 1) => void;
  onAction: (a: RebaseAction) => void;
  onMessage: (m: string) => void;
}

function DeckRow({ t, card, index, count, done, canDrag, onMove, onAction, onMessage }: DeckRowProps) {
  const controls = useDragControls();
  const selectId = useId();
  const msgId = useId();
  const joins = card.action === 'squash' || card.action === 'fixup';
  return (
    <Reorder.Item value={card.commit} dragListener={false} dragControls={controls} className={cx('rd-card', `rd-${card.action}`, joins && 'is-joining', done && 'is-done')}>
      <div className="rd-top">
        {canDrag && !done ? (
          <span className="rd-grip" aria-hidden="true" onPointerDown={(e) => controls.start(e)}>
            ⋮⋮
          </span>
        ) : (
          <span className="rd-num" aria-hidden="true">
            {index + 1}
          </span>
        )}
        <span className="rd-text">
          <code className="rd-hash">{card.short}</code> <span className="rd-msg">{card.message}</span>
        </span>
      </div>
      {joins && (
        <p className="rd-joins">
          <span aria-hidden="true">⤒ </span>
          {t(index === 0 ? 'rebase.joinsNothing' : 'rebase.joinsAbove')}
        </p>
      )}
      <div className="rd-bottom">
        <label className="visually-hidden" htmlFor={selectId}>
          {t('rebase.actionFor', { message: card.message })}
        </label>
        <span className="rd-icon" aria-hidden="true">
          {ICON[card.action]}
        </span>
        <select id={selectId} className="rd-select" value={card.action} disabled={done} onChange={(e) => onAction(e.target.value as RebaseAction)}>
          {ACTIONS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <span className="rd-means">{t(`rebase.means.${card.action}`)}</span>
        {!done && (
          <span className="rd-btns">
            <button type="button" className="rd-btn" disabled={index === 0} aria-label={t('rebase.up', { message: card.message })} onClick={() => onMove(-1)}>
              ↑
            </button>
            <button type="button" className="rd-btn" disabled={index === count - 1} aria-label={t('rebase.down', { message: card.message })} onClick={() => onMove(1)}>
              ↓
            </button>
          </span>
        )}
      </div>
      {(card.action === 'reword' || card.action === 'squash') && (
        <div className="rd-message">
          <label htmlFor={msgId} className="rd-message-label">
            {t(card.action === 'reword' ? 'rebase.newMessage' : 'rebase.squashMessage')}
          </label>
          <input
            id={msgId}
            className="rd-input"
            value={card.newMessage}
            disabled={done}
            placeholder={card.action === 'squash' ? t('rebase.squashPlaceholder') : undefined}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => onMessage(e.target.value)}
          />
        </div>
      )}
    </Reorder.Item>
  );
}
