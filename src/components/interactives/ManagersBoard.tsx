// The Manager's board: Want / See / Do (desired state and the reconcile loop).
// "Want 3. See 2. Make 1 more." Each loop of the controller is drawn from the engine's
// `reconcile` events. Used on its own (with a small food-court picture and action buttons)
// or inside FoodCourtSim. Reduced motion / calm mode: no movement, before → after text.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  board as boardOf,
  boardEvents,
  buildScenarioCached,
  injectFault,
  picture as pictureOf,
  run,
  tick,
  type Board,
  type KubeEvent,
  type KubeScenario,
  type KubeState,
} from '~/engine/foodcourt-sim';
import type { Lang } from '~/i18n';
import FoodCourt from './FoodCourt';
import { Feedback, cx, useCardEvents, useMotionOK, useT, type T } from './shared';
import { useSimClock } from './useSimClock';
import { WarnIcon } from './YouAreHere';
import './kube.css';

export interface Loop {
  want: number;
  see: number;
  do: 'create' | 'delete' | 'none';
  count: number;
}

export function BoardView({ t, board, loop, healed, motionOK, compact }: { t: T; board: Board; loop: Loop | null; healed: number; motionOK: boolean; compact?: boolean }) {
  // While a loop is fresh, show the numbers the controller saw; then the live numbers.
  const want = loop?.want ?? board.want;
  const see = loop?.see ?? board.see;
  const doing = loop?.do ?? board.doing;
  const count = loop?.count ?? board.count;
  const waitReady = !loop && doing === 'none' && board.ready < board.want;
  const doText =
    doing === 'create' ? t('board.do.create', { n: String(count) }) : doing === 'delete' ? t('board.do.delete', { n: String(count) }) : waitReady ? t('board.do.wait') : t('board.do.none');
  const live = t('board.live', { want: String(want), see: String(see), do: doText });
  return (
    <div className={cx('kube-board', compact && 'is-compact', doing !== 'none' && 'is-acting')} role="group" aria-label={t('board.label', { name: board.name })}>
      <p className="visually-hidden" aria-live="polite">
        {live}
      </p>
      <div className="kube-board-cell kube-board-want">
        <span className="kube-board-key">{t('board.want')}</span>
        <span className="kube-board-num" key={`w${want}`} data-anim={motionOK ? 'pop' : undefined}>
          {want}
        </span>
        <span className="kube-board-note">{t('board.wantNote', { name: board.name })}</span>
      </div>
      <div className="kube-board-cell kube-board-see">
        <span className="kube-board-key">{t('board.see')}</span>
        <span className="kube-board-num" key={`s${see}`} data-anim={motionOK ? 'pop' : undefined}>
          {see}
        </span>
        <span className="kube-board-dots" aria-hidden="true">
          {Array.from({ length: Math.max(want, see) }, (_, i) => (
            <span key={i} className={cx('kube-board-dot', i < board.ready && !loop ? 'is-ready' : i < see ? 'is-there' : 'is-missing')} />
          ))}
        </span>
        <span className="kube-board-note">{t('board.seeNote', { ready: String(board.ready) })}</span>
      </div>
      <div className={cx('kube-board-cell kube-board-do', doing !== 'none' && 'is-acting')}>
        <span className="kube-board-key">{t('board.do')}</span>
        <span className="kube-board-action" key={`d${doing}${count}`} data-anim={motionOK ? 'pop' : undefined}>
          {doing !== 'none' && <WarnIcon />} {doText}
        </span>
        <span className="kube-board-note">{t('board.healed', { n: String(healed) })}</span>
      </div>
    </div>
  );
}

export type BoardAction = 'deletePod' | 'killNode' | { cmd: string; label: string };

export interface ManagersBoardProps {
  lang: Lang;
  scenario: KubeScenario;
  /** The Deployment on the board (default: the first one). */
  target?: string;
  /** The kind of `target` when it is not a Deployment (e.g. 'ReplicaSet'). */
  kind?: string;
  actions?: BoardAction[];
  /** Done when the controller fixed this many gaps, and/or the board wants this many. */
  goal?: { healed?: number; want?: number };
  success?: string;
  /** Text alternative (what the board shows, in words). */
  label?: string;
}

const NO_ACTIONS: BoardAction[] = ['deletePod'];

export default function ManagersBoard({ lang, scenario, target, kind = 'Deployment', actions = NO_ACTIONS, goal, success, label }: ManagersBoardProps) {
  const t = useT(lang);
  const motionOK = useMotionOK();
  const { ref, emit } = useCardEvents();
  const initial = useMemo(() => buildScenarioCached(scenario), [scenario]);
  const [state, setState] = useState<KubeState>(initial);
  const [loop, setLoop] = useState<Loop | null>(null);
  const [healed, setHealed] = useState(0);
  const [glow, setGlow] = useState<string[]>([]);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(0);
  const loopTimer = useRef<number | undefined>(undefined);
  const stateRef = useRef(state);
  stateRef.current = state;

  const b = boardOf(state, target ? { name: target, kind } : { kind });
  const selector = (() => {
    const c = state.clusters[state.contexts[state.currentContext]!.cluster]!;
    const d = Object.values(c.objects).find((o) => o.kind === kind && o.metadata.name === b?.name);
    return Object.entries(d?.spec?.selector?.matchLabels ?? {})
      .map(([k, v]) => `${k}=${v}`)
      .join(',');
  })();

  const absorb = (events: KubeEvent[]) => {
    const loops = boardEvents(events);
    const replaced = events.filter((e) => e.type === 'podReplaced').length;
    const created = events.filter((e): e is Extract<KubeEvent, { type: 'podCreated' }> => e.type === 'podCreated').map((e) => e.pod);
    if (created.length) setGlow(created);
    if (replaced) setHealed((h) => h + replaced);
    const l = loops[loops.length - 1];
    if (l) {
      setLoop({ want: l.want, see: l.see, do: l.do, count: l.count });
      window.clearTimeout(loopTimer.current);
      loopTimer.current = window.setTimeout(() => setLoop(null), motionOK ? 2200 : 1200);
    }
  };

  // Time passes slowly while something is happening (busy > 0 seconds left).
  useSimClock(ref, busy > 0, motionOK ? 650 : 250, () => {
    const r = tick(stateRef.current, 1);
    setState(r.state);
    absorb(r.events);
    setBusy((n) => n - 1);
  });

  useEffect(() => () => window.clearTimeout(loopTimer.current), []);

  useEffect(() => {
    if (done || !b || !goal) return;
    if ((goal.healed === undefined || healed >= goal.healed) && (goal.want === undefined || b.want === goal.want) && b.ready === b.want) {
      setDone(true);
      emit('fl:done');
    }
  }, [b, healed, goal, done, emit]);

  const act = (a: BoardAction) => {
    let r;
    if (a === 'deletePod') r = injectFault(state, { type: 'deletePod', selector });
    else if (a === 'killNode') r = injectFault(state, { type: 'killNode' });
    else r = run(state, a.cmd);
    setState(r.state);
    absorb(r.events);
    setBusy(a === 'killNode' ? 420 : 15);
  };

  const pic = pictureOf(state);
  if (!b || !pic) return null;
  return (
    <div className="kube-board-wrap" ref={ref}>
      {label && <p className="visually-hidden">{label}</p>}
      <BoardView t={t} board={b} loop={loop} healed={healed} motionOK={motionOK} />
      <FoodCourt t={t} picture={pic} motionOK={motionOK} glow={glow} compact />
      <div className="kube-actions" role="group" aria-label={t('kube.actions')}>
        {actions.map((a) => {
          const text = a === 'deletePod' ? t('board.action.deletePod') : a === 'killNode' ? t('board.action.killNode') : a.label;
          const danger = a === 'deletePod' || a === 'killNode';
          return (
            <button key={typeof a === 'string' ? a : a.cmd} type="button" className={cx('btn', danger ? 'kube-danger-btn' : 'btn-quiet')} onClick={() => act(a)}>
              {danger && <WarnIcon />} {text}
              {typeof a !== 'string' && <code className="kube-action-cmd">{a.cmd}</code>}
            </button>
          );
        })}
      </div>
      {done && <Feedback kind="right">{success ?? t('board.success')}</Feedback>}
    </div>
  );
}
