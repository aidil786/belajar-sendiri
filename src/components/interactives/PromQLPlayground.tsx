// PromQLPlayground: type a PromQL query, press Run, see the answer as a table (at the eval
// time) and as a small graph (the same query at every step of the scenario). Metric chips add
// a name at the caret; the eval-time slider moves "now". Mistakes show Prometheus 3's real
// words first, then one plain line (rule 19). With a goal, Run checks it kindly.
// Engine: src/engine/promql-sim (checked against promtool). Logic: src/lib/promqlPlayground.ts.
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ObsScenario } from '~/engine/promql-sim';
import { buildScenario, duration, formatDuration, timeStops } from '~/engine/promql-sim';
import type { Lang } from '~/i18n';
import { checkPromGoal, goalTime, insertAt, metricChips, resultCount, resultRows, runQuery, type PromGoal, type QueryRun } from '~/lib/promqlPlayground';
import { DangerIcon } from './AreaIcons';
import PromGraph from './PromGraph';
import { Announce, Feedback, cx, pickPraise, useCardEvents, useLearnerName, useT, type T } from './shared';
import './promql.css';

export interface PromQLPlaygroundProps {
  lang: Lang;
  scenario: ObsScenario;
  /** Text already in the query box. */
  initial?: string;
  /** One short task line above the box (default: a general help line). */
  prompt?: string;
  /** Metric chips (default: the scenario's `metrics`, else every metric in the data). */
  metrics?: string[];
  /** Where the eval-time slider starts (default: the scenario's evalTime). */
  at?: string;
  goal?: PromGoal;
  /** Shown one at a time after two misses. */
  hints?: string[];
  success?: string;
  /** A query that meets the goal. Never shown; npm run check:mdx runs it. */
  solution?: string;
  /** false hides the graph (table only). */
  graph?: boolean;
}

function ErrorBox({ run, t }: { run: QueryRun; t: T }) {
  const e = run.error!;
  return (
    <div className="pq-error" role="status">
      <p className="pq-error-real">
        <DangerIcon size={16} /> <span className="pq-error-who">{t(e.engineLimit ? 'promql.error.limit' : 'promql.error.real')}</span> <code>{e.message}</code>
      </p>
      <p className="pq-error-plain">{t(`promql.err.${e.key}`, e.params)}</p>
    </div>
  );
}

function ResultTable({ run, t }: { run: QueryRun; t: T }) {
  const v = run.value!;
  const rows = resultRows(v);
  const at = formatDuration(run.t);
  const n = resultCount(v);
  const head =
    v.type === 'scalar' ? t('promql.result.scalar', { t: at }) : v.type === 'matrix' ? t('promql.result.matrix', { n, t: at }) : n === 0 ? t('promql.result.empty', { t: at }) : t('promql.result.vector', { n, t: at });
  return (
    <div className="pq-result">
      <p className="pq-head">{head}</p>
      {n === 0 && v.type === 'vector' ? (
        <p className="pq-note">{t('promql.result.emptyHint')}</p>
      ) : (
        <div className="pq-scroll" tabIndex={0} role="region" aria-label={head}>
          <table className="pq-table">
            <thead>
              <tr>
                <th scope="col">{t('promql.col.series')}</th>
                <th scope="col">{t(v.type === 'matrix' ? 'promql.col.samples' : 'promql.col.value')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <th scope="row">
                    <code>{r.series}</code>
                  </th>
                  <td className={v.type === 'matrix' ? 'pq-samples' : 'pq-num'}>{r.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function PromQLPlayground(props: PromQLPlaygroundProps) {
  const { lang, scenario, initial = '', prompt, goal, hints = [], success, graph = true } = props;
  const t = useT(lang);
  const learner = useLearnerName();
  const { ref, emit } = useCardEvents();
  const id = useId();
  const b = useMemo(() => buildScenario(scenario), [scenario]);
  const stops = useMemo(() => timeStops(b), [b]);
  const chips = useMemo(() => metricChips(b, props.metrics), [b, props.metrics]);
  const [query, setQuery] = useState(initial);
  const [at, setAt] = useState(() => (props.at ? duration(props.at) : goal?.at ? duration(goal.at) : b.evalTime));
  const [ran, setRan] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<{ ok: boolean; key?: string; params?: Record<string, string | number> } | null>(null);
  const [misses, setMisses] = useState(0);
  const [done, setDone] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [announce, setAnnounce] = useState('');
  const box = useRef<HTMLTextAreaElement>(null);
  const tries = useRef(0);

  // The table follows the slider; the graph stays (it covers the whole time range).
  const run = useMemo(() => (ran === null ? null : runQuery(b, ran, at, graph)), [b, ran, at, graph]);

  const go = () => {
    const q = query.trim();
    setRan(q);
    tries.current++;
    const r = runQuery(b, q, at, false);
    const summary = r.error ? r.error.message : r.value ? `${resultCount(r.value)}` : '';
    setAnnounce(t('promql.ran', { summary }));
    if (!goal || done) return;
    const g = checkPromGoal(goalTime(b, goal) === at ? r : runQuery(b, q, goalTime(b, goal), false), goal);
    if (g.ok) {
      setVerdict({ ok: true });
      setDone(true);
      setAnnounce(success ?? t('promql.done'));
      emit('fl:done', { tries: tries.current });
    } else {
      setVerdict({ ok: false, key: g.miss!.key, params: g.miss!.params });
      setMisses((n) => n + 1);
      emit('fl:wrong');
    }
  };

  useEffect(() => {
    if (misses >= 2 && hints.length) setShowHint(true);
  }, [misses, hints.length]);

  const addMetric = (name: string) => {
    const el = box.current;
    const start = el?.selectionStart ?? query.length;
    const end = el?.selectionEnd ?? query.length;
    const next = insertAt(query, start, end, name);
    setQuery(next.text);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(next.caret, next.caret);
    });
  };

  const hintText = hints.length ? hints[Math.min(hints.length - 1, Math.max(0, misses - 2))] : undefined;
  const goalAt = goal ? goalTime(b, goal) : null;

  return (
    <div className={cx('pq', done && 'is-done')} ref={ref}>
      <p className="interactive-help">{prompt ?? t('promql.help')}</p>
      <div className="pq-query">
        <label htmlFor={`${id}-q`} className="pq-label">
          {t('promql.queryLabel')}
        </label>
        <div className="pq-query-row">
          <textarea
            id={`${id}-q`}
            ref={box}
            className="pq-input"
            value={query}
            rows={Math.min(4, Math.max(1, query.split('\n').length))}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
            onChange={(e) => {
              setQuery(e.target.value);
              setVerdict(null);
            }}
            onKeyDown={(e) => {
              // Enter runs; Shift+Enter makes a new line.
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                go();
              }
            }}
          />
          <button type="button" className="btn pq-run" onClick={go}>
            <span aria-hidden="true">▶ </span>
            {t('promql.run')}
          </button>
        </div>
        {chips.length > 0 && (
          <div className="pq-chips">
            <span className="pq-chips-label">{t('promql.metrics')}</span>
            {chips.map((c) => (
              <button key={c} type="button" className="pq-chip" onClick={() => addMetric(c)}>
                <code>{c}</code>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="pq-slider">
        <label htmlFor={`${id}-t`}>{t('promql.evalTime', { t: formatDuration(at) })}</label>
        <input
          id={`${id}-t`}
          type="range"
          min={0}
          max={stops.length - 1}
          step={1}
          value={Math.max(0, stops.indexOf(at))}
          aria-valuetext={formatDuration(at)}
          onChange={(e) => setAt(stops[Number(e.target.value)] ?? 0)}
        />
        <p className="pq-note">{t('promql.evalHelp')}</p>
      </div>

      {run?.error && <ErrorBox run={run} t={t} />}
      {run?.value && <ResultTable run={run} t={t} />}
      {run?.value && graph && run.graph && <PromGraph data={run.graph} evalTime={at} t={t} title={t('promql.graph.title', { end: formatDuration(b.end) })} />}
      {run?.value && graph && run.graphNote === 'matrix' && <p className="pq-note pq-graph-note">{t('promql.graph.matrix')}</p>}

      {verdict && !verdict.ok && !done && (
        <Feedback kind="almost">
          {t('feedback.almost')} {t(`promql.miss.${verdict.key}`, verdict.key === 'type' ? { want: t(`promql.type.${verdict.params?.want}`), got: t(`promql.type.${verdict.params?.got}`) } : verdict.params)}
          {goalAt !== null && goalAt !== at && <> ({t('promql.graph.at', { t: formatDuration(goalAt) })})</>}
        </Feedback>
      )}
      {hintText && !done && (
        <div className="pq-hint-row">
          <button type="button" className="btn btn-ghost scene-btn" aria-expanded={showHint} onClick={() => {
            if (!showHint) emit('fl:hint');
            setShowHint(!showHint);
          }}>
            <span aria-hidden="true">💡 </span>
            {t(showHint ? 'promql.hintHide' : 'promql.hint')}
          </button>
          {showHint && <p className="pq-hint">{hintText}</p>}
        </div>
      )}
      {done && <Feedback kind="right">{success ?? `${pickPraise(t, learner, tries.current)} ${t('promql.done')}`}</Feedback>}
      {ran !== null && (
        <button
          type="button"
          className="btn btn-quiet pq-reset"
          onClick={() => {
            setQuery(initial);
            setRan(null);
            setVerdict(null);
          }}
        >
          <span aria-hidden="true">↺ </span>
          {t('promql.reset')}
        </button>
      )}
      <Announce text={announce} />
    </div>
  );
}
