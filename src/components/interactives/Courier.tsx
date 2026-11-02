// Push/pull courier: "Your laptop" and "GitHub" side by side (stacked on phones).
// A courier carries commits between them after Push / Fetch / Pull / a teammate's push.
// Both panels are drawn from the Git engine. Two modes:
//   - actions: the learner taps buttons (goal-checked, kind hints);
//   - commands: a demo that plays once when shown, replayable.
// Travel takes ~1.3 s and never loops. Calm mode / reduced motion: no travel, a
// before/after toggle instead. Rejected pushes bounce back with a red note + icon.
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState, type Ref } from 'react';
import { buildScenario, type Scenario, type SimState } from '~/engine/git-sim';
import type { Lang } from '~/i18n';
import {
  actionCommand,
  courierGoalMet,
  courierView,
  freshIds,
  runAction,
  type ActionResult,
  type ActionSpec,
  type CommitSpec,
  type CourierGoal,
  type CourierView,
  type StepLine,
  type TeammateSpec,
  type Trip,
  type ViewCommit,
} from '~/lib/courier';
import { DangerIcon } from './AreaIcons';
import { Feedback, cx, pickPraise, useCardEvents, useLearnerName, useMotionOK, useT, type T } from './shared';
import './areas.css';
import './courier.css';

export interface CourierProps {
  lang: Lang;
  scenario: Scenario;
  /** Buttons the learner may tap. Built-in: push, fetch, pull, commit, teammate; or { cmd, label? }. */
  actions?: ActionSpec[];
  /** Demo mode: steps played in order (`@commit`, `@teammate` or a Git command). */
  commands?: string[];
  /** Text alternative (required for a demo). */
  label?: string;
  goal?: CourierGoal;
  hints?: string[];
  success?: string;
  teammate?: TeammateSpec;
  /** Commits the "Make a commit" button makes, in order. */
  mine?: CommitSpec[];
  /** GitHub repo to show when the laptop has no origin yet. */
  url?: string;
}

const TRAVEL_MS = 1300;
const BOUNCE_MS = 1600;
const NO_HINTS: string[] = [];

interface Flight {
  key: number;
  trip: Trip;
  from: { x: number; y: number };
  to: { x: number; y: number };
}

interface Shown {
  explain: { text: string; err: boolean } | null;
  carried: string;
  dropped: string;
  lines: StepLine[];
}

const EMPTY: Shown = { explain: null, carried: '', dropped: '', lines: [] };

function shorts(list: { short: string }[], max = 3): string {
  const head = list.slice(0, max).map((c) => c.short);
  return list.length > max ? `${head.join(', ')} +${list.length - max}` : head.join(', ');
}

function LaptopIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="5" width="16" height="11" rx="1.5" />
      <path d="M2 19h20" />
    </svg>
  );
}

function CloudIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 18h10a4 4 0 0 0 .5-8 6 6 0 0 0-11.5 1A3.5 3.5 0 0 0 7 18z" />
    </svg>
  );
}

function ParcelIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 8l9-4 9 4-9 4z" />
      <path d="M3 8v8l9 4 9-4V8" />
      <path d="M12 12v8" />
    </svg>
  );
}

function CommitItem({ c, side, fresh, motionOK, t, branch }: { c: ViewCommit; side: 'laptop' | 'github'; fresh: boolean; motionOK: boolean; t: T; branch: string }) {
  const mark = c.status === 'local' ? '↑' : c.status === 'remote' ? '↓' : null;
  const status =
    c.status === 'local' ? t('courier.onlyLaptop') : c.status === 'remote' ? t('courier.onlyGithub') : c.status === 'fetched' ? t('courier.fetched', { branch }) : '';
  return (
    <motion.li
      layout={motionOK ? 'position' : false}
      initial={motionOK ? { opacity: 0, y: -6 } : false}
      animate={{ opacity: 1, y: 0 }}
      exit={motionOK ? { opacity: 0 } : { opacity: 0, transition: { duration: 0 } }}
      transition={{ duration: 0.3 }}
      className={cx('courier-commit', `is-${c.status}`, fresh && 'is-fresh')}
    >
      <span className="courier-hash">{c.short}</span>
      <span className="courier-msg">
        {c.message}
        {c.by && <span className="courier-by"> · {c.by}</span>}
      </span>
      {mark && (
        <span className="courier-mark" aria-hidden="true">
          {mark}
        </span>
      )}
      {status && <span className="visually-hidden"> ({status})</span>}
      {c.labels.length > 0 && (
        <span className="courier-refs">
          {c.labels.map((l) => (
            <span key={`${l.kind}:${l.name}`} className={cx('courier-ref', `courier-ref-${l.kind}`, side === 'github' && l.kind === 'branch' && 'on-github', l.head && 'is-head')}>
              {l.name}
              {l.head && <span className="visually-hidden"> ({t('courier.head')})</span>}
            </span>
          ))}
        </span>
      )}
    </motion.li>
  );
}

function Panel({
  side,
  view,
  t,
  fresh,
  motionOK,
  innerRef,
}: {
  side: 'laptop' | 'github';
  view: CourierView;
  t: T;
  fresh: Set<string>;
  motionOK: boolean;
  innerRef: Ref<HTMLElement>;
}) {
  const title = side === 'laptop' ? t('courier.laptop') : t('courier.github');
  const data = side === 'laptop' ? view.laptop : view.github;
  const branch = view.laptop?.branch ?? 'main';
  let foot = '';
  if (side === 'laptop' && view.laptop) {
    const l = view.laptop;
    foot = l.upstream ? t('courier.aheadBehind', { ahead: l.ahead, behind: l.behind, upstream: l.upstream }) : l.hasRemote ? t('courier.noUpstream') : t('courier.noRemote');
  }
  return (
    <section ref={innerRef} className={cx('courier-side', `courier-${side}`)} aria-label={title}>
      <header className="courier-head">
        {side === 'laptop' ? <LaptopIcon /> : <CloudIcon />}
        <span className="courier-title">{title}</span>
        {data && <span className="courier-where">{data.where}</span>}
      </header>
      {!data ? (
        <div className="courier-empty">{side === 'laptop' ? t('courier.noRepo') : t('courier.noServer')}</div>
      ) : data.commits.length === 0 ? (
        <div className="courier-empty">{t('courier.empty')}</div>
      ) : (
        <ol className="courier-commits">
          <AnimatePresence initial={false}>
            {data.commits.map((c) => (
              <CommitItem key={c.id} c={c} side={side} fresh={fresh.has(c.id)} motionOK={motionOK} t={t} branch={branch} />
            ))}
          </AnimatePresence>
        </ol>
      )}
      {data && data.more > 0 && <div className="courier-more">{t('courier.older', { n: data.more })}</div>}
      {foot && <div className="courier-foot">{foot}</div>}
    </section>
  );
}

export default function Courier({ lang, scenario, actions, commands, label, goal, hints = NO_HINTS, success, teammate, mine, url }: CourierProps) {
  const t = useT(lang);
  const name = useLearnerName();
  const motionOK = useMotionOK();
  const { ref, emit } = useCardEvents();
  const opts = useMemo(() => ({ mine, teammate }), [mine, teammate]);
  const start = useMemo(() => buildScenario(scenario), [scenario]);
  const isDemo = Boolean(commands?.length) && !actions?.length;

  // Demo: every step worked out up front.
  const demo = useMemo(() => {
    if (!isDemo) return null;
    const states: SimState[] = [start];
    const results: ActionResult[] = [];
    let c = { mineUsed: 0, teamUsed: 0 };
    for (const step of commands ?? []) {
      const r = runAction(states[states.length - 1]!, step, opts, c);
      c = { mineUsed: r.mineUsed, teamUsed: r.teamUsed };
      results.push(r);
      states.push(r.state);
    }
    return { states, results };
  }, [isDemo, start, commands, opts]);

  const [truth, setTruth] = useState<SimState>(start);
  const [shownState, setShownState] = useState<SimState>(demo && !motionOK ? demo.states[demo.states.length - 1]! : start);
  const [shown, setShown] = useState<Shown>(EMPTY);
  const [cmdText, setCmdText] = useState('');
  const [flight, setFlight] = useState<Flight | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [counters, setCounters] = useState({ mineUsed: 0, teamUsed: 0 });
  const [typed, setTyped] = useState<string[]>([]);
  const [fails, setFails] = useState(0);
  const [tries, setTries] = useState(0);
  const [done, setDone] = useState(false);
  const [last, setLast] = useState<{ before: SimState; after: SimState; result: ActionResult } | null>(null);
  const [comparing, setComparing] = useState(false);
  const [playing, setPlaying] = useState(false);

  const stage = useRef<HTMLDivElement>(null);
  const laptopRef = useRef<HTMLElement>(null);
  const githubRef = useRef<HTMLElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const timers = useRef<number[]>([]);
  const landing = useRef<{ key: number; after: SimState; before: SimState; then?: (() => void) | undefined } | null>(null);
  const flightKey = useRef(0);
  const played = useRef(false);
  const hinted = useRef(false);

  const later = (fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms));
  };
  const cancelAll = useCallback(() => {
    timers.current.forEach((id) => window.clearTimeout(id));
    timers.current = [];
    landing.current = null;
    flightKey.current++;
    setFlight(null);
  }, []);
  useEffect(() => cancelAll, [cancelAll]);

  const view = useMemo(() => courierView(shownState, url ? { url } : {}), [shownState, url]);

  const describe = (r: ActionResult): Shown => {
    const text = r.explain ? t(r.explain.key, (r.explain.params ?? {}) as Record<string, string>) : '';
    const trip = r.trip;
    let carried = '';
    // A bounce needs no extra line: the parcel's stamp and the red note say it.
    if (trip && !trip.bounced) {
      const list = trip.commits.length ? shorts(trip.commits) : trip.tags.join(', ');
      carried =
        trip.from === 'teammate'
          ? t('courier.carried.teammate', { name: teammate?.name ?? '', list })
          : trip.dir === 'up'
            ? t('courier.carried.up', { list })
            : t('courier.carried.down', { list });
    }
    // Dropped commits are gone from GitHub, so name them by message (hashes mean nothing now).
    const dropped = trip?.dropped.length ? t('courier.replaced', { list: trip.dropped.map((c) => `“${c.message}”`).join(', ') }) : '';
    return { explain: text ? { text, err: !r.ok && !r.stopped } : null, carried, dropped, lines: r.lines };
  };

  /** Show `after` (with a glow on what is new). */
  const land = (before: SimState, after: SimState) => {
    setShownState(after);
    if (motionOK) {
      setFresh(freshIds(courierView(before, url ? { url } : {}), courierView(after, url ? { url } : {})));
      later(() => setFresh(new Set()), 1200);
    }
  };

  /** Send the courier on a trip, then land on `after`. */
  const fly = (trip: Trip | null, before: SimState, after: SimState, then?: () => void) => {
    const st = stage.current?.getBoundingClientRect();
    const a = laptopRef.current?.getBoundingClientRect();
    const b = githubRef.current?.getBoundingClientRect();
    if (!motionOK || !trip || !st || !a || !b || !st.width) {
      land(before, after);
      then?.();
      return;
    }
    const centre = (r: DOMRect) => ({ x: r.left - st.left + r.width / 2, y: r.top - st.top + r.height / 2 });
    let from = centre(a);
    let to = centre(b);
    if (trip.dir === 'down') [from, to] = [to, from];
    if (trip.from === 'teammate') {
      // Aisyah's parcel drops into GitHub from its far corner.
      const stacked = Math.abs(centre(a).x - centre(b).x) < 4;
      from = stacked ? { x: to.x, y: b.bottom - st.top - 18 } : { x: b.right - st.left - 24, y: b.top - st.top + 18 };
    }
    const key = ++flightKey.current;
    setShownState(before);
    landing.current = { key, before, after, then };
    setFlight({ key, trip, from, to });
    later(() => finish(key), (trip.bounced ? BOUNCE_MS : TRAVEL_MS) + 400);
  };

  const finish = (key: number) => {
    const l = landing.current;
    if (!l || l.key !== key) return;
    landing.current = null;
    setFlight(null);
    land(l.before, l.after);
    l.then?.();
  };

  // ----- Demo mode -----
  const play = useCallback(() => {
    if (!demo) return;
    cancelAll();
    setPlaying(true);
    setShownState(demo.states[0]!);
    setShown(EMPTY);
    setCmdText('');
    const stepAt = (i: number) => {
      if (i >= demo.results.length) {
        setPlaying(false);
        return;
      }
      const r = demo.results[i]!;
      const where = r.lines[r.lines.length - 1]?.where ?? '';
      const step = commands![i]!;
      setCmdText(step === '@teammate' ? `${teammate?.name ?? ''}: ${r.lines.map((l) => l.cmd).join('  ·  ')}` : `${where} $ ${r.lines.map((l) => l.cmd).join('  ·  ') || step}`);
      setShown(describe(r));
      fly(r.trip, demo.states[i]!, demo.states[i + 1]!, () => later(() => stepAt(i + 1), 700));
    };
    later(() => stepAt(0), 450);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo, cancelAll, motionOK]);

  useEffect(() => {
    if (!demo) return;
    if (!motionOK) {
      cancelAll();
      setPlaying(false);
      const lastR = demo.results[demo.results.length - 1];
      setShownState(demo.states[demo.states.length - 1]!);
      setComparing(false);
      setCmdText((commands ?? []).join('  ·  '));
      if (lastR) setShown(describe(lastR));
      return;
    }
    const el = root.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && !played.current) {
        played.current = true;
        play();
      }
    });
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo, motionOK]);

  // ----- Action mode -----
  const act = (a: ActionSpec) => {
    if (flight || playing) return;
    cancelAll();
    const before = truth;
    const r = runAction(before, a, opts, counters);
    setCounters({ mineUsed: r.mineUsed, teamUsed: r.teamUsed });
    setTruth(r.state);
    setComparing(false);
    const where = r.lines[r.lines.length - 1]?.where ?? '';
    const isTeam = a === 'teammate';
    setCmdText(isTeam ? `${teammate?.name ?? ''}: ${r.lines.map((l) => l.cmd).join('  ·  ')}` : `${where} $ ${r.lines.map((l) => l.cmd).join('  ·  ')}`);
    setShown(describe(r));
    setLast({ before, after: r.state, result: r });
    const nextTyped = [...typed, ...r.typed];
    setTyped(nextTyped);
    setTries((n) => n + 1);
    const mistake = !r.ok && !r.stopped;
    if (mistake) {
      setFails((f) => f + 1);
      emit('fl:wrong');
    }
    fly(r.trip, before, r.state);
    if (goal && !done && courierGoalMet(r.state, goal, nextTyped, url)) {
      setDone(true);
      emit('fl:done');
    }
  };

  const replay = () => {
    if (!last || flight) return;
    cancelAll();
    fly(last.result.trip, last.before, last.after);
  };

  const reset = () => {
    cancelAll();
    setTruth(start);
    setShownState(start);
    setShown(EMPTY);
    setCmdText('');
    setCounters({ mineUsed: 0, teamUsed: 0 });
    setTyped([]);
    setFails(0);
    setTries(0);
    setDone(false);
    setLast(null);
    setComparing(false);
    hinted.current = false;
  };

  const toggleCompare = () => {
    if (demo) {
      const show = !comparing;
      setComparing(show);
      setShownState(show ? demo.states[0]! : demo.states[demo.states.length - 1]!);
      return;
    }
    if (!last) return;
    const show = !comparing;
    setComparing(show);
    setShownState(show ? last.before : last.after);
  };

  // Hints after 2 refusals, or after 4 actions that missed the goal (like the simulator).
  const stuck = Math.max(fails, tries >= 4 ? Math.floor(tries / 2) : 0);
  const hint = goal && !done && stuck >= 2 && hints.length ? hints[Math.min(hints.length - 1, Math.floor((stuck - 2) / 2))] : null;
  useEffect(() => {
    if (hint && !hinted.current) {
      hinted.current = true;
      emit('fl:hint');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hint]);

  const busy = Boolean(flight) || playing;
  const buttonFor = (a: ActionSpec, i: number) => {
    const cmd = actionCommand(a);
    let text: string;
    let code: string | null = cmd;
    let disabled = busy;
    if (typeof a === 'string') {
      if (a === 'teammate') {
        text = t('courier.action.teammate', { name: teammate?.name ?? '' });
        code = null;
        disabled ||= !teammate || (teammate.commits !== undefined && counters.teamUsed >= teammate.commits.length);
      } else if (a === 'commit') {
        text = t('courier.action.commit');
        code = 'git commit';
        disabled ||= mine !== undefined && counters.mineUsed >= mine.length;
      } else text = t(`courier.action.${a}`);
    } else {
      text = a.label ?? '';
    }
    return (
      <button key={i} type="button" className="btn btn-ghost courier-act" disabled={disabled} onClick={() => act(a)}>
        {text && <span className="courier-act-label">{text}</span>}
        {code && <code className="courier-act-cmd">{code}</code>}
      </button>
    );
  };

  const legend = [...(view.laptop?.commits ?? []), ...(view.github?.commits ?? [])];
  const hasUp = legend.some((c) => c.status === 'local');
  const hasDown = legend.some((c) => c.status === 'remote');
  const hasFetched = legend.some((c) => c.status === 'fetched');

  return (
    <div className={cx('courier', isDemo && 'is-demo')} ref={(el) => {
      (ref as { current: HTMLDivElement | null }).current = el;
      root.current = el;
    }}>
      {label && <p className="visually-hidden">{label}</p>}
      <div className="courier-stage" ref={stage}>
        <Panel side="laptop" view={view} t={t} fresh={fresh} motionOK={motionOK} innerRef={laptopRef} />
        <div className="courier-road" aria-hidden="true">
          <span className="courier-road-line" />
        </div>
        <Panel side="github" view={view} t={t} fresh={fresh} motionOK={motionOK} innerRef={githubRef} />
        <AnimatePresence>
          {flight && motionOK && <Parcel key={flight.key} flight={flight} t={t} name={teammate?.name ?? ''} onDone={() => finish(flight.key)} />}
        </AnimatePresence>
      </div>
      {(hasUp || hasDown || hasFetched) && (
        <div className="courier-legend" aria-hidden="true">
          {hasUp && <span className="courier-key is-local">↑ {t('courier.onlyLaptop')}</span>}
          {hasFetched && <span className="courier-key is-fetched">{t('courier.fetched', { branch: view.laptop?.branch ?? 'main' })}</span>}
          {hasDown && <span className="courier-key is-remote">↓ {t('courier.onlyGithub')}</span>}
        </div>
      )}
      {cmdText && (
        <div className="scene-command courier-cmd" aria-hidden={isDemo ? true : undefined}>
          <code>{cmdText}</code>
        </div>
      )}
      <div className="courier-say" aria-live="polite">
        {shown.carried && <div className={cx('courier-carried', flight && 'is-waiting')}>{shown.carried}</div>}
        {shown.dropped && (
          <div className="courier-explain is-err">
            <DangerIcon /> <span>{shown.dropped}</span>
          </div>
        )}
        {shown.explain && (
          <div className={cx('courier-explain', shown.explain.err && 'is-err')}>
            {shown.explain.err && <DangerIcon />} <span>{shown.explain.text}</span>
          </div>
        )}
      </div>
      {actions && actions.length > 0 && (
        <>
          <p className="interactive-help">{t('courier.actions')}</p>
          <div className="courier-actions" role="group" aria-label={t('courier.actions')}>
            {actions.map(buttonFor)}
          </div>
        </>
      )}
      <div className="scene-controls courier-controls">
        {motionOK ? (
          (isDemo || last?.result.trip) && (
            <button type="button" className="btn btn-ghost scene-btn" disabled={busy} onClick={isDemo ? play : replay}>
              ↺ {t('anim.replay')}
            </button>
          )
        ) : (
          (isDemo || last) && (
            <>
              <button type="button" className="btn btn-ghost scene-btn" aria-pressed={comparing} onClick={toggleCompare}>
                {comparing ? t('anim.showAfter') : t('anim.showBefore')}
              </button>
              <span className="scene-state">{comparing ? t('anim.before') : t('anim.after')}</span>
            </>
          )
        )}
        {!isDemo && last && (
          <button type="button" className="btn btn-quiet courier-reset" onClick={reset}>
            ↺ {t('term.reset')}
          </button>
        )}
      </div>
      {shown.lines.length > 0 && (
        <details className="courier-output">
          <summary>{t('courier.output')}</summary>
          <pre tabIndex={0} aria-label={t('courier.output')}>
            {shown.lines.map((l) => `${l.where} $ ${l.cmd}${l.output ? `\n${l.output}` : ''}`).join('\n')}
          </pre>
        </details>
      )}
      {hint && (
        <Feedback kind="almost">
          {t('feedback.almost')} {hint}
        </Feedback>
      )}
      {done && <Feedback kind="right">{success ?? pickPraise(t, name, typed.length)}</Feedback>}
    </div>
  );
}

function Parcel({ flight, t, name, onDone }: { flight: Flight; t: T; name: string; onDone: () => void }) {
  const { trip, from, to } = flight;
  const bounced = trip.bounced;
  const mid = { x: from.x + (to.x - from.x) * 0.6, y: from.y + (to.y - from.y) * 0.6 };
  const x = bounced ? [from.x, mid.x, from.x] : [from.x, to.x];
  const y = bounced ? [from.y, mid.y, from.y] : [from.y, to.y];
  const duration = (bounced ? BOUNCE_MS : TRAVEL_MS) / 1000;
  const items = trip.commits.length ? shorts(trip.commits, 2) : trip.tags.join(', ');
  return (
    <motion.div
      className={cx('courier-parcel', bounced && 'is-bounced', trip.from === 'teammate' && 'is-teammate')}
      initial={{ x: from.x, y: from.y, opacity: 0 }}
      animate={{ x, y, opacity: [0, 1, 1, 0] }}
      exit={{ opacity: 0 }}
      transition={{ duration, ease: 'easeInOut', opacity: { duration, times: [0, 0.12, 0.85, 1] } }}
      onAnimationComplete={onDone}
      aria-hidden="true"
    >
      <div className="courier-parcel-box">
        {trip.from === 'teammate' && <span className="courier-parcel-who">{name}</span>}
        <ParcelIcon />
        <span className="courier-parcel-items">{items || t('courier.parcel')}</span>
        {bounced && (
          <motion.span className="courier-stamp" initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: duration * 0.45, duration: 0.2 }}>
            <DangerIcon size={14} /> {t('courier.sentBack')}
          </motion.span>
        )}
      </div>
    </motion.div>
  );
}
