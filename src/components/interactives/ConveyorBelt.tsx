// The conveyor belt: a workflow file on the left, its stations on the right
// (stacked on phones). Pick an event, press Run, and the conveyor engine plays the
// run: stations light up, a matrix splits into lanes, a cache hit is a shortcut, a
// red station (with an icon) stops the line. Pause and Step walk through it.
// Calm mode / reduced motion: Run shows the end at once; "Step through" walks it.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  beltLayout,
  DEFAULT_EVENTS,
  firstFailedStation,
  parseWorkflow,
  runScenario,
  scenarioTrigger,
  stationView,
  stations as allStations,
  viewAt,
  type ConveyorScenario,
  type Decisions,
  type EventPreset,
  type Issue,
  type JobRun,
  type Live,
  type Note,
  type RunResult,
  type Station,
  type StationKind,
  type World,
} from '~/engine/conveyor-sim';
import type { Lang } from '~/i18n';
import { applyFix, fixRange, judgeRun, realError, runNote, type ConveyorTask, type FixOption } from '~/lib/conveyorBelt';
import { highlightYaml } from '~/lib/yamlBuilder';
import { DangerIcon } from './AreaIcons';
import { Announce, Feedback, cx, pickPraise, useCardEvents, useLearnerName, useMotionOK, useT, type T } from './shared';
import './conveyor.css';

export interface ConveyorBeltProps {
  lang: Lang;
  scenario: ConveyorScenario;
  /** The event picked at the start (default: the first of `events`). */
  event?: EventPreset;
  /** Event buttons (default: the scenario's, else push to main, PR, fork PR, tag). */
  events?: EventPreset[];
  task?: ConveyorTask;
  /** Fix task: the learner types in the scenario's `fix` lines. */
  editable?: boolean;
  /** Fix task: choices for the `fix` lines. */
  fixes?: FixOption[];
  success?: string;
  /** Optional caption (a text alternative is built in: every station is listed in words). */
  label?: string;
}

const VISIBLE_LINES = 15;

/** Fake seconds → playback ms (finite: the whole run plays in a few seconds). */
function delayFor(dt: number, duration: number): number {
  const k = Math.min(40, 4500 / Math.max(1, duration));
  return Math.round(Math.min(650, Math.max(90, dt * k)));
}

export function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
}

export function StationIcon({ kind, size = 20 }: { kind: StationKind; size?: number }) {
  const p = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
  switch (kind) {
    case 'prep':
      return (
        <svg {...p}>
          <path d="M14.5 5.5a4 4 0 0 0-5 5L4 16l4 4 5.5-5.5a4 4 0 0 0 5-5l-2.5 2.5-2.5-.5-.5-2.5z" />
        </svg>
      );
    case 'lint':
      return (
        <svg {...p}>
          <circle cx="10" cy="10" r="6" />
          <path d="M14.5 14.5L20 20" />
          <path d="M7.5 10h5" />
        </svg>
      );
    case 'test':
      return (
        <svg {...p}>
          <path d="M9 3h6" />
          <path d="M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3" />
          <path d="M7.5 15h9" />
        </svg>
      );
    case 'build':
      return (
        <svg {...p}>
          <path d="M3 8l9-5 9 5-9 5z" />
          <path d="M3 8v8l9 5 9-5V8" />
        </svg>
      );
    case 'scan':
      return (
        <svg {...p}>
          <path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z" />
          <path d="M9 12l2 2 4-4" />
        </svg>
      );
    case 'publish':
      return (
        <svg {...p}>
          <path d="M12 16V4" />
          <path d="M7 9l5-5 5 5" />
          <path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
        </svg>
      );
    case 'deploy':
      return (
        <svg {...p}>
          <path d="M3 7h11v9H3z" />
          <path d="M14 10h4l3 3v3h-7" />
          <circle cx="7" cy="18" r="2" />
          <circle cx="17" cy="18" r="2" />
        </svg>
      );
    default:
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="7" />
        </svg>
      );
  }
}

const MARK: Record<Live, string> = { idle: '○', running: '◌', success: '✓', failure: '✕', skipped: '–', cancelled: '⊘', waiting: '⏸' };

function StateBadge({ state, t }: { state: Live; t: T }) {
  return (
    <span className={cx('cv-badge', `is-${state}`)}>
      {state === 'failure' ? <DangerIcon size={14} /> : <span aria-hidden="true">{MARK[state]}</span>} {t(`conveyor.state.${state}`)}
    </span>
  );
}

function YamlLines({ text, marks, scrollTo, label }: { text: string; marks: Record<number, string>; scrollTo: number | null; label: string }) {
  const box = useRef<HTMLPreElement>(null);
  useEffect(() => {
    // Scroll inside the box only (never the page).
    const el = box.current;
    if (!el || scrollTo === null) return;
    const row = el.querySelector<HTMLElement>(`[data-line="${scrollTo}"]`);
    if (!row) return;
    const top = row.offsetTop - el.clientHeight / 3;
    el.scrollTop = Math.max(0, top);
  }, [scrollTo, text]);
  const lines = text.replace(/\n$/, '').split('\n');
  return (
    <pre className="cv-yaml" ref={box} tabIndex={0} aria-label={label} style={{ maxHeight: `calc(${VISIBLE_LINES} * 1.6em + 1rem)` }}>
      {lines.map((line, i) => {
        const n = i + 1;
        const indent = /^ */.exec(line)![0].length;
        const guides = Math.floor(indent / 2);
        return (
          <span key={i} data-line={n} className={cx('cv-line', marks[n] && `is-${marks[n]}`)}>
            <span className="cv-ln" aria-hidden="true">
              {n}
            </span>
            <span className="cv-code">
              {Array.from({ length: guides }, (_, g) => (
                <span key={g} className="cv-guide" aria-hidden="true">
                  {'  '}
                </span>
              ))}
              {highlightYaml(line.slice(guides * 2)).map((tok, j) => (
                <span key={j} className={tok.c ? `ybt-${tok.c}` : undefined}>
                  {tok.t}
                </span>
              ))}
            </span>
            {'\n'}
          </span>
        );
      })}
    </pre>
  );
}

function stationDuration(st: Station, mode: 'jobs' | 'steps', jobs: JobRun[]): number {
  if (mode === 'jobs') return Math.max(0, ...jobs.map((j) => j.end - j.start));
  return Math.max(0, ...jobs.map((j) => st.steps!.reduce((sum, i) => sum + Math.max(0, (j.steps[i]?.end ?? 0) - (j.steps[i]?.start ?? 0)), 0)));
}

export default function ConveyorBelt({ lang, scenario: s, event, events: eventsProp, task = { type: 'watch' }, editable = false, fixes, success, label }: ConveyorBeltProps) {
  const t = useT(lang);
  const learner = useLearnerName();
  const motionOK = useMotionOK();
  const { ref, emit } = useCardEvents();
  const events = eventsProp ?? s.events ?? DEFAULT_EVENTS;
  const [preset, setPreset] = useState<EventPreset>(event && events.includes(event) ? event : events[0]!);
  const fixText = useMemo(() => (s.fix ? s.workflow.replace(/\n$/, '').split('\n').slice(s.fix.from - 1, s.fix.to).join('\n') : ''), [s]);
  const [draft, setDraft] = useState(fixText);
  const [choice, setChoice] = useState<number | null>(null);
  const [world, setWorld] = useState<Partial<World>>({});
  const [decisions, setDecisions] = useState<Decisions>({});
  const [result, setResult] = useState<RunResult | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [pick, setPick] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<{ kind: 'almost' | 'info'; note?: Note; extra?: string } | null>(null);
  const [done, setDone] = useState(false);
  const [announce, setAnnounce] = useState('');
  const tries = useRef(0);
  const judged = useRef<RunResult | null>(null);

  const option = choice !== null ? (fixes?.[choice] ?? null) : null;
  const yaml = useMemo(() => {
    if (!s.fix) return s.workflow;
    if (fixes) return option ? applyFix(s, option.text) : s.workflow;
    if (editable) return applyFix(s, draft);
    return s.workflow;
  }, [s, fixes, option, editable, draft]);
  const parsed = useMemo(() => parseWorkflow(yaml), [yaml]);
  const layout = useMemo(() => (parsed.workflow ? beltLayout(parsed.workflow) : null), [parsed]);
  const view = useMemo(() => (result ? viewAt(result, playhead) : null), [result, playhead]);
  const finished = Boolean(result && playhead >= result.events.length);
  const trigger = scenarioTrigger(s, preset);
  const refText = trigger.event === 'pull_request' ? `${trigger.fork ? 'stranger:' : ''}${trigger.branch ?? ''} → ${trigger.base ?? ''}` : (trigger.tag ?? trigger.branch ?? '');

  const reset = () => {
    setResult(null);
    setPlayhead(0);
    setPlaying(false);
    setVerdict(null);
    judged.current = null;
  };

  // Playback: one event at a time, on a timer. Never loops: it stops at the last event.
  useEffect(() => {
    if (!playing || !result) return;
    if (playhead >= result.events.length) {
      setPlaying(false);
      return;
    }
    const prev = result.events[playhead - 1]?.t ?? 0;
    const id = window.setTimeout(() => setPlayhead((p) => p + 1), delayFor(result.events[playhead]!.t - prev, result.duration));
    return () => window.clearTimeout(id);
  }, [playing, playhead, result]);

  const finish = useCallback(
    (r: RunResult) => {
      if (judged.current === r) return;
      judged.current = r;
      if (r.status === 'waiting') {
        setAnnounce(t('conveyor.approval', { env: r.waitingFor ?? '', who: '' }));
        return;
      }
      // Caches saved by this run are there for the next one, like on GitHub.
      if (r.cachesSaved?.length || r.layersSaved) {
        setWorld((w) => ({ ...w, cache: { ...w.cache, ...(r.cachesSaved?.length ? { warm: true, lockfileChanged: false } : {}), ...(r.layersSaved ? { layers: true } : {}) } }));
      }
      const failedSt = layout ? firstFailedStation(layout, r) : null;
      if (failedSt) setSelected(failedSt.id);
      setAnnounce(r.status === 'success' ? t('conveyor.status.success') : r.status === 'notTriggered' ? t('conveyor.notTriggered') : t(`conveyor.status.${r.status}`));
      if (done) return;
      const v = judgeRun({ task, result: r, yaml, pick, firstFailed: failedSt, option });
      if (v.done) {
        setDone(true);
        setVerdict(null);
        emit('fl:done', { tries: tries.current });
        return;
      }
      if (v.wrong) emit('fl:wrong');
      if (task.type === 'predict') setPick(null);
      setVerdict(v.note || v.extra ? { kind: v.wrong ? 'almost' : 'info', ...(v.note ? { note: v.note } : {}), ...(v.extra ? { extra: v.extra } : {}) } : null);
    },
    [done, emit, layout, option, pick, t, task, yaml],
  );

  useEffect(() => {
    if (result && playhead >= result.events.length) finish(result);
  }, [result, playhead, finish]);

  const run = () => {
    if (task.type === 'predict' && !pick && !done) {
      setVerdict({ kind: 'info', note: { key: 'conveyor.task.pickFirst' } });
      return;
    }
    tries.current++;
    const r = runScenario(s, preset, { yaml, decisions: {}, world });
    setDecisions({});
    setResult(r);
    setVerdict(null);
    judged.current = null;
    if (r.status === 'invalid' || r.status === 'notTriggered' || !motionOK) {
      setPlayhead(r.events.length);
      setPlaying(false);
    } else {
      setPlayhead(0);
      setPlaying(true);
    }
    setSelected(null);
  };

  const decide = (d: 'approve' | 'reject') => {
    if (!result?.waitingFor) return;
    const next = { ...decisions, [result.waitingFor]: d };
    setDecisions(next);
    const r = runScenario(s, preset, { yaml, decisions: next, world });
    judged.current = null;
    setResult(r);
    if (motionOK) setPlaying(true);
    else setPlayhead(r.events.length);
  };

  const stepThrough = () => {
    if (!result) return;
    setPlaying(false);
    setPlayhead(0);
  };

  const stationList = layout ? allStations(layout) : [];
  // Predict: pick before the run (again after a miss).
  const picking = task.type === 'predict' && !done && !playing && (!result || finished);
  const legsOf = (st: Station) => (result ? result.jobs.filter((j) => j.id === (layout!.mode === 'jobs' ? st.job : layout!.job)) : []);
  // A merged "Get ready" station lists its steps: checkout · setup-node · npm ci.
  const stationName = (st: Station) => {
    if (st.label || !parsed.workflow || !layout) return st.label;
    const job = parsed.workflow.jobs.find((j) => j.id === layout.job);
    const names = (st.steps ?? []).map((i) => job?.steps[i]).map((x) => (x?.uses ? x.uses.replace(/^[^/]+\//, '').replace(/@.*$/, '') : (x?.run ?? '').trim().split('\n')[0]!));
    return names.join(' · ') || t('conveyor.kind.prep');
  };

  // YAML marks: fix lines (amber), problems (red), the running step (pink: you are here).
  const marks: Record<number, string> = {};
  const range: [number, number] | null = s.fix ? (fixes ? (option ? fixRange(s, option.text) : [s.fix.from, s.fix.to]) : editable ? fixRange(s, draft) : null) : null;
  if (range) for (let n = range[0]; n <= range[1]; n++) marks[n] = 'fix';
  for (const i of parsed.issues) if (i.level === 'error' && i.line) marks[i.line] = 'issue';
  let runningLine: number | null = null;
  if (result && view && parsed.workflow) {
    for (const j of result.jobs) {
      const jv = view.jobs[j.key];
      const idx = jv?.steps.indexOf('running') ?? -1;
      if (idx >= 0) runningLine = j.steps[idx]!.line;
    }
    if (runningLine !== null) marks[runningLine] = 'here';
  }

  const sel = stationList.find((x) => x.id === selected) ?? null;
  const errors = parsed.issues.filter((i) => i.level === 'error');
  const issueText = (i: Issue) => t(i.key, i.params);
  const instructions = t(`conveyor.task.${task.type}`);
  const canStep = Boolean(result && !playing && playhead < (result?.events.length ?? 0));
  const triggerLabel = (p: EventPreset) => t(`conveyor.event.${p}`, { branch: s.branch ?? 'feature', tag: s.tag ?? 'v1.2.0', main: s.repo?.defaultBranch ?? 'main' });

  return (
    <div className="cv" ref={ref}>
      <p className="interactive-help">{instructions}</p>
      {label && <p className="cv-caption">{label}</p>}

      <fieldset className="cv-events" disabled={playing}>
        <legend className="cv-head">{t('conveyor.eventLabel')}</legend>
        <div className="cv-event-list">
          {events.map((p) => (
            <label key={p} className={cx('cv-event', preset === p && 'is-on')}>
              <input
                type="radio"
                name={`cv-event-${s.id}`}
                value={p}
                checked={preset === p}
                onChange={() => {
                  setPreset(p);
                  reset();
                }}
              />
              <span>{triggerLabel(p)}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="cv-grid">
        <section className="cv-panel" aria-label={t('conveyor.file')}>
          <p className="cv-head">
            {t('conveyor.file')} <code className="cv-path">{s.file ?? '.github/workflows/ci.yml'}</code>
          </p>
          <YamlLines text={yaml} marks={marks} scrollTo={runningLine ?? range?.[0] ?? null} label={t('conveyor.file')} />
          {range && <p className="cv-legend is-fix">{t('conveyor.fixLines', { from: range[0], to: range[1] })}</p>}
          {runningLine !== null && <p className="cv-legend is-here">{t('conveyor.youAreHere', { line: runningLine })}</p>}
          {s.fix && editable && !fixes && (
            <label className="cv-edit">
              <span className="cv-head">{t('conveyor.fixEdit', { from: s.fix.from })}</span>
              <textarea
                value={draft}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                rows={Math.max(2, draft.split('\n').length + 1)}
                disabled={done}
                onChange={(e) => {
                  setDraft(e.target.value);
                  reset();
                }}
              />
            </label>
          )}
          {s.fix && fixes && (
            <fieldset className="cv-fixes" disabled={done || playing}>
              <legend className="cv-head">{t('conveyor.fixPick')}</legend>
              {fixes.map((f, i) => (
                <label key={i} className={cx('cv-fix', choice === i && 'is-on')}>
                  <input
                    type="radio"
                    name={`cv-fix-${s.id}`}
                    checked={choice === i}
                    onChange={() => {
                      setChoice(i);
                      reset();
                    }}
                  />
                  <span>{f.label}</span>
                </label>
              ))}
            </fieldset>
          )}
          {errors.length > 0 && (
            <ul className="cv-issues">
              {errors.map((i, k) => (
                <li key={k}>
                  <DangerIcon size={14} /> {i.line ? <strong>{t('conveyor.line', { n: i.line })}</strong> : null} {issueText(i)}
                  {i.real && <code className="cv-real">{i.real}</code>}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="cv-panel" aria-label={t('conveyor.belt')}>
          <p className="cv-head">
            {t('conveyor.belt')}
            {result && result.triggered && view && <span className="cv-clock"> · {fmtTime(view.t)}</span>}
          </p>
          <p className="cv-trigger">
            <span aria-hidden="true">⚡ </span>
            {t('conveyor.trigger', { event: triggerLabel(preset), ref: refText })}
          </p>
          {view?.olderCancelled && <p className="cv-chip">{t('conveyor.olderCancelled')}</p>}
          {view?.pending && <p className="cv-chip is-waiting">{t('conveyor.pending')}</p>}
          {result?.status === 'notTriggered' && (
            <p className="cv-banner">
              {t('conveyor.notTriggered')} {result.why ? t(result.why.key, result.why.params) : ''}
            </p>
          )}
          {result?.status === 'invalid' && <p className="cv-banner is-bad">{t('conveyor.invalid')}</p>}
          {layout && (
            <ol className={cx('cv-belt', playing && motionOK && 'is-moving')}>
              {layout.columns.map((col, ci) => (
                <li key={ci} className="cv-col">
                  <ul className="cv-row">
                    {col.map((st) => {
                      const sv = stationView(st, layout, result && result.triggered ? result : null, result && result.triggered ? view : null);
                      const legs = legsOf(st);
                      const finishedHere = sv.state === 'success' || sv.state === 'failure' || sv.state === 'cancelled';
                      const dur = finishedHere ? stationDuration(st, layout.mode, legs) : 0;
                      const ups = view ? view.artifacts.filter((a) => legs.some((j) => j.key === a.from)) : [];
                      const downs = view ? view.artifacts.filter((a) => a.to.some((k) => legs.some((j) => j.key === k))) : [];

                      const isPicked = pick === st.id;
                      return (
                        <li key={st.id} className={cx('cv-station', `is-${sv.state}`, `k-${st.kind}`, selected === st.id && 'is-selected', isPicked && 'is-picked')}>
                          <button
                            type="button"
                            className="cv-station-btn"
                            aria-pressed={picking ? isPicked : selected === st.id}
                            disabled={!picking && !result?.triggered}
                            onClick={() => (picking ? setPick(st.id) : setSelected(selected === st.id ? null : st.id))}
                          >
                            <span className="cv-kind">
                              <StationIcon kind={st.kind} />
                              <span>{t(`conveyor.kind.${st.kind}`)}</span>
                            </span>
                            <span className="cv-name">{stationName(st)}</span>
                            <StateBadge state={sv.state} t={t} />
                            {dur > 0 && <span className="cv-dur">{fmtTime(dur)}</span>}
                          </button>
                          {sv.lanes.length > 0 && (
                            <ul className="cv-lanes" aria-label={t('conveyor.lanes')}>
                              {sv.lanes.map((l) => (
                                <li key={l.key} className={cx('cv-lane', `is-${l.state}`)}>
                                  {l.state === 'failure' ? <DangerIcon size={12} /> : <span aria-hidden="true">{MARK[l.state]}</span>} {l.label}
                                  <span className="visually-hidden"> {t(`conveyor.state.${l.state}`)}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                          {sv.cache && (
                            <p className={cx('cv-cache', `is-${sv.cache}`)}>
                              <span aria-hidden="true">{sv.cache === 'miss' ? '○ ' : '⤼ '}</span>
                              {t(`conveyor.cache.${sv.cache}`)}
                            </p>
                          )}
                          {sv.continued && <p className="cv-note">{t('conveyor.continued')}</p>}
                          {ups.map((a) => (
                            <p key={`u${a.name}`} className="cv-art">
                              <span aria-hidden="true">↑ </span>
                              {t('conveyor.artifactUp', { name: a.name })}
                            </p>
                          ))}
                          {downs.map((a) => (
                            <p key={`d${a.name}`} className="cv-art">
                              <span aria-hidden="true">↓ </span>
                              {t('conveyor.artifactDown', { name: a.name })}
                            </p>
                          ))}
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
            </ol>
          )}
          {picking && (
            <button type="button" className={cx('cv-none', pick === 'none' && 'is-picked')} aria-pressed={pick === 'none'} onClick={() => setPick('none')}>
              {t('conveyor.pickNone')}
            </button>
          )}
        </section>
      </div>

      <div className="cv-controls">
        {!playing && (
          <button type="button" className="btn" onClick={run} disabled={parsed.issues.some((i) => i.level === 'error') && !editable}>
            ▶ {result ? t('conveyor.runAgain') : t('conveyor.run')}
          </button>
        )}
        {playing && (
          <button type="button" className="btn btn-ghost" onClick={() => setPlaying(false)}>
            ⏸ {t('conveyor.pause')}
          </button>
        )}
        {!playing && result && playhead < result.events.length && motionOK && (
          <button type="button" className="btn btn-ghost" onClick={() => setPlaying(true)}>
            ▶ {t('conveyor.resume')}
          </button>
        )}
        {result?.triggered && (
          <button type="button" className="btn btn-ghost" disabled={!canStep} onClick={() => setPlayhead((p) => p + 1)}>
            ⏭ {t('conveyor.step')}
          </button>
        )}
        {result?.triggered && finished && !playing && (
          <button type="button" className="btn btn-quiet" onClick={stepThrough}>
            ↺ {t('conveyor.stepThrough')}
          </button>
        )}
      </div>

      {finished && result?.status === 'waiting' && view?.approval && (
        <div className="cv-approval" role="group" aria-label={t('conveyor.approvalTitle')}>
          <p>
            <span aria-hidden="true">⏸ </span>
            {t('conveyor.approval', { env: view.approval.environment, who: view.approval.reviewers.join(', ') })}
          </p>
          <div className="cv-controls">
            <button type="button" className="btn" onClick={() => decide('approve')}>
              ✓ {t('conveyor.approve')}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => decide('reject')}>
              {t('conveyor.reject')}
            </button>
          </div>
        </div>
      )}

      {finished && result && result.triggered && result.status !== 'waiting' && <RunSummary result={result} t={t} />}

      {sel && result?.triggered && layout && <StationLog station={sel} name={stationName(sel)} jobs={legsOf(sel)} mode={layout.mode} t={t} />}

      {verdict?.kind === 'almost' && (
        <Feedback kind="almost">
          {t('feedback.almost')} {verdict.note ? t(verdict.note.key, verdict.note.params) : ''} {verdict.extra ?? ''}
        </Feedback>
      )}
      {verdict?.kind === 'info' && (
        <p className="cv-hint" role="status">
          <span aria-hidden="true">→ </span>
          {verdict.note ? t(verdict.note.key, verdict.note.params) : ''} {verdict.extra ?? ''}
        </p>
      )}
      {done && <Feedback kind="right">{success ?? `${pickPraise(t, learner, tries.current)} ${t(`conveyor.done.${task.type}`)}`}</Feedback>}
      <Announce text={announce} />
    </div>
  );
}

function RunSummary({ result, t }: { result: RunResult; t: T }) {
  const note = runNote(result);
  const real = realError(result);
  const ok = result.status === 'success';
  return (
    <div className={cx('cv-summary', ok ? 'is-ok' : 'is-bad')} role="status">
      <p className="cv-summary-title">
        {ok ? <span aria-hidden="true">✓ </span> : <DangerIcon size={16} />} {t(`conveyor.status.${result.status}`)} · {t('conveyor.duration', { time: fmtTime(result.duration) })}
      </p>
      {!ok && real && (
        <p className="cv-real-line">
          <span className="cv-head">{t('conveyor.realError')}</span>
          <code className="cv-real">{real}</code>
        </p>
      )}
      {!ok && note && (
        <p className="cv-plain">
          <span className="cv-head">{t('conveyor.plain')}</span> {t(note.key, note.params)}
        </p>
      )}
    </div>
  );
}

function StationLog({ station, name, jobs, mode, t }: { station: Station; name: string; jobs: JobRun[]; mode: 'jobs' | 'steps'; t: T }) {
  const [leg, setLeg] = useState(0);
  const job = jobs[Math.min(leg, jobs.length - 1)];
  if (!job) return null;
  const steps = mode === 'jobs' ? job.steps : job.steps.filter((s) => station.steps!.includes(s.index));
  return (
    <details className="cv-log" open>
      <summary>{t('conveyor.log', { station: name })}</summary>
      {jobs.length > 1 && (
        <div className="cv-legs" role="group" aria-label={t('conveyor.lanes')}>
          {jobs.map((j, i) => (
            <button key={j.key} type="button" className={cx('cv-leg', i === leg && 'is-on')} aria-pressed={i === leg} onClick={() => setLeg(i)}>
              {j.key}
            </button>
          ))}
        </div>
      )}
      <div className="cv-term">
        {job.log
          .filter((l) => l.kind === 'err' || l.kind === 'warn')
          .map((l, i) => (
            <div key={`j${i}`} className={cx('cv-tl', l.kind && `is-${l.kind}`)}>
              {l.text}
            </div>
          ))}
        {steps.map((s) => (
          <div key={s.index} className="cv-tstep">
            <div className={cx('cv-tname', `is-${s.result}`)}>
              <span aria-hidden="true">{s.result === 'success' ? '✓' : s.result === 'failure' ? '✕' : s.result === 'cancelled' ? '⊘' : '–'} </span>
              {s.name}
              <span className="visually-hidden"> ({t(`conveyor.state.${s.result}`)})</span>
            </div>
            {s.log.slice(1).map((l, i) => (
              <div key={i} className={cx('cv-tl', l.kind && `is-${l.kind}`)}>
                {l.text}
              </div>
            ))}
            {s.why && <div className="cv-tplain">{t(s.why.key, s.why.params)}</div>}
          </div>
        ))}
      </div>
    </details>
  );
}
