// AlertRuleBuilder: build a Prometheus alerting rule from blocks (expr, for, keep_firing_for,
// labels, annotations). The rule's YAML writes itself (≤ 15 lines, indent guides), the value it
// watches is graphed, and a timeline shows each alert quiet → pending (amber, ⏳) → firing
// (red, 🔔) over the scenario's data, as promtool would evaluate it. "Test the rule" checks the
// goal (fires at the right time, doesn't flap) with kind feedback. Nothing moves on its own.
// Engine: src/engine/promql-sim. Logic: src/lib/alertRuleBuilder.ts.
import { useId, useMemo, useState, type ReactNode } from 'react';
import { buildScenario, duration, formatDuration, timeStops, type ObsScenario } from '~/engine/promql-sim';
import type { Lang } from '~/i18n';
import {
  alertsAtTime,
  checkAlertGoal,
  DEFAULT_FORS,
  defaultChoice,
  graphFor,
  ruleYaml,
  runBuilder,
  segments,
  type AlertGoal,
  type AnnotationsBlock,
  type BuilderChoice,
  type CellState,
  type ExprBlock,
  type LabelsBlock,
} from '~/lib/alertRuleBuilder';
import { runQuery } from '~/lib/promqlPlayground';
import { DangerIcon } from './AreaIcons';
import PromGraph from './PromGraph';
import { Announce, Feedback, cx, pickPraise, useCardEvents, useLearnerName, useT, type T } from './shared';
import './promql.css';

export interface AlertRuleBuilderProps {
  lang: Lang;
  scenario: ObsScenario;
  /** The alert's name (default KedaiAlert). */
  alert?: string;
  exprs: ExprBlock[];
  fors?: string[];
  keepFiringFor?: string[];
  labels?: LabelsBlock[];
  annotations?: AnnotationsBlock[];
  /** Blocks picked at the start (indexes). */
  start?: Partial<BuilderChoice>;
  /** Blocks that meet the goal. Never shown; npm run check:mdx runs them. */
  solution?: Partial<BuilderChoice>;
  goal?: AlertGoal;
  prompt?: string;
  hints?: string[];
  success?: string;
  /** Where the "look at time" slider starts (default: the scenario's eval time). */
  at?: string;
}

const STATE_ICON: Record<CellState, string> = { inactive: '', pending: '⏳', firing: '🔔' };

function Blocks<B>({ legend, name, items, value, onPick, render }: { legend: string; name: string; items: B[]; value: number; onPick: (i: number) => void; render: (b: B, i: number) => ReactNode }) {
  return (
    <fieldset className="pq-blocks">
      <legend>{legend}</legend>
      <div className="pq-block-row">
        {items.map((b, i) => (
          <label key={i} className={cx('pq-block', value === i && 'is-on')}>
            <input type="radio" name={name} checked={value === i} onChange={() => onPick(i)} />
            <span className="pq-block-body">{render(b, i)}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function YamlView({ lines, t }: { lines: string[]; t: T }) {
  return (
    <figure className="pq-yaml">
      <figcaption className="pq-head">
        <span aria-hidden="true">📄 </span>
        {t('promql.alert.yaml')}
      </figcaption>
      <pre>
        {lines.map((l, i) => {
          const ind = l.length - l.trimStart().length;
          return (
            <span key={i} className="pq-yline">
              <span className="pq-ynum" aria-hidden="true">
                {i + 1}
              </span>
              <span className="pq-yguides" aria-hidden="true" style={{ width: `${ind}ch` }} />
              <span className="pq-ytext">{l.trimStart()}</span>
              {'\n'}
            </span>
          );
        })}
      </pre>
    </figure>
  );
}

export default function AlertRuleBuilder(props: AlertRuleBuilderProps) {
  const { lang, scenario, goal, hints = [], success } = props;
  const t = useT(lang);
  const learner = useLearnerName();
  const { ref, emit } = useCardEvents();
  const id = useId();
  const spec = useMemo(
    () => ({ name: props.alert, exprs: props.exprs, fors: props.fors, keepFiringFor: props.keepFiringFor, labels: props.labels, annotations: props.annotations }),
    [props.alert, props.exprs, props.fors, props.keepFiringFor, props.labels, props.annotations],
  );
  const fors = props.fors ?? DEFAULT_FORS;
  const b = useMemo(() => buildScenario(scenario), [scenario]);
  const stops = useMemo(() => timeStops(b), [b]);
  const [choice, setChoice] = useState<BuilderChoice>(() => defaultChoice(spec, props.start));
  const [look, setLook] = useState(() => (props.at ? duration(props.at) : b.evalTime));
  const [verdict, setVerdict] = useState<{ key: string; params?: Record<string, string | number>; why?: string } | null>(null);
  const [misses, setMisses] = useState(0);
  const [done, setDone] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [announce, setAnnounce] = useState('');
  const [tries, setTries] = useState(0);

  const run = useMemo(() => runBuilder(b, spec, choice), [b, spec, choice]);
  const yaml = useMemo(() => ruleYaml(run.rule), [run.rule]);
  const block = spec.exprs[choice.expr] ?? spec.exprs[0]!;
  const watch = useMemo(() => graphFor(block), [block]);
  const watched = useMemo(() => (watch ? runQuery(b, watch.expr, b.end) : null), [b, watch]);
  const n = run.evalTimes.length;
  const lookIndex = Math.max(0, run.evalTimes.findLastIndex((x) => x <= look));
  const now = alertsAtTime(run, look);

  const pick = (k: keyof BuilderChoice) => (i: number) => {
    setChoice((c) => ({ ...c, [k]: i }));
    setVerdict(null);
    setAnnounce(t('promql.alert.changed'));
  };

  const test = () => {
    const nextTries = tries + 1;
    setTries(nextTries);
    if (!goal || done) return;
    const r = checkAlertGoal(run, goal);
    if (r.ok) {
      setDone(true);
      setVerdict(null);
      setAnnounce(success ?? t('promql.alert.done'));
      emit('fl:done', { tries: nextTries });
      return;
    }
    const whyBlock = [spec.exprs[choice.expr]?.why, spec.labels?.[choice.labels]?.why, spec.annotations?.[choice.annotations]?.why].find(Boolean);
    setVerdict({ key: r.miss!.key, params: r.miss!.params, why: whyBlock });
    const m = misses + 1;
    setMisses(m);
    if (m >= 2 && hints.length) setShowHint(true);
    setAnnounce(`${t('feedback.almost')} ${t(`promql.alertMiss.${r.miss!.key}`, r.miss!.params)}`);
    emit('fl:wrong');
  };

  const hintText = hints.length ? hints[Math.min(hints.length - 1, Math.max(0, misses - 2))] : undefined;
  const stateWord = (s: CellState) => t(`promql.alert.state.${s}`);

  return (
    <div className={cx('pq ar', done && 'is-done')} ref={ref}>
      <p className="interactive-help">{props.prompt ?? t('promql.alert.help')}</p>

      <div className="pq-build" role="group" aria-label={t('promql.alert.blocks')}>
        <Blocks legend={t('promql.alert.expr')} name={`${id}-expr`} items={spec.exprs} value={choice.expr} onPick={pick('expr')} render={(x) => <code>{x.label ?? x.expr}</code>} />
        <Blocks legend={t('promql.alert.for')} name={`${id}-for`} items={fors} value={choice.for} onPick={pick('for')} render={(f) => (duration(f) === 0 ? t('promql.alert.forNone') : <code>{f}</code>)} />
        {props.keepFiringFor && (
          <Blocks legend={t('promql.alert.keep')} name={`${id}-keep`} items={props.keepFiringFor} value={choice.keep} onPick={pick('keep')} render={(f) => (duration(f) === 0 ? t('promql.alert.keepNone') : <code>{f}</code>)} />
        )}
        {props.labels && (
          <Blocks
            legend={t('promql.alert.labels')}
            name={`${id}-labels`}
            items={props.labels}
            value={choice.labels}
            onPick={pick('labels')}
            render={(l) => l.label ?? (Object.keys(l.labels).length ? <code>{Object.entries(l.labels).map(([k, v]) => `${k}: ${v}`).join(', ')}</code> : t('promql.alert.noLabels'))}
          />
        )}
        {props.annotations && (
          <Blocks
            legend={t('promql.alert.annotations')}
            name={`${id}-ann`}
            items={props.annotations}
            value={choice.annotations}
            onPick={pick('annotations')}
            render={(a) => a.label ?? <code>{Object.values(a.annotations)[0] ?? ''}</code>}
          />
        )}
      </div>

      <YamlView lines={yaml} t={t} />

      {watch && watched?.graph && <PromGraph data={watched.graph} evalTime={look} t={t} title={t('promql.alert.graph')} threshold={watch.threshold} />}

      <section className="ar-timeline" aria-labelledby={`${id}-tl`}>
        <h3 id={`${id}-tl`} className="pq-head">
          {t('promql.alert.timeline')}
        </h3>
        {run.error && (
          <div className="pq-error" role="status">
            <p className="pq-error-real">
              <DangerIcon size={16} /> <span className="pq-error-who">{t('promql.alert.ruleError')}</span> <code>{run.error}</code>
            </p>
          </div>
        )}
        <p className="pq-note">{t('promql.alert.legend')}</p>
        {run.rows.length === 0 && !run.error ? (
          <p className="ar-never">{t('promql.alert.never')}</p>
        ) : (
          <ul className="ar-rows">
            {run.rows.map((row) => {
              const segs = segments(row, run.evalTimes);
              return (
                <li key={row.key} className="ar-row">
                  <code className="ar-name">{row.name}</code>
                  <div className="ar-strip" aria-hidden="true">
                    {segs.map((s, i) => {
                      const cells = row.cells.filter((_, k) => run.evalTimes[k]! >= s.from && run.evalTimes[k]! <= s.to).length;
                      return (
                        <span key={i} className={cx('ar-seg', `is-${s.state}`)} style={{ flexGrow: cells }}>
                          {s.state !== 'inactive' && cells / n > 0.12 && (
                            <>
                              {STATE_ICON[s.state]} {stateWord(s.state)}
                            </>
                          )}
                        </span>
                      );
                    })}
                    <span className="ar-now" style={{ left: `${((lookIndex + 0.5) / n) * 100}%` }} />
                  </div>
                  <p className="ar-summary">
                    {segs
                      .filter((s) => s.state !== 'inactive')
                      .map((s) => {
                        const state = `${STATE_ICON[s.state]} ${stateWord(s.state)}`;
                        return s.from === s.to ? t('promql.alert.segmentAt', { state, t: formatDuration(s.from) }) : t('promql.alert.segment', { state, from: formatDuration(s.from), to: formatDuration(s.to) });
                      })
                      .join(' · ')}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
        <div className="ar-axis" aria-hidden="true">
          <span>0s</span>
          <span>{formatDuration(run.evalTimes[Math.floor((n - 1) / 2)] ?? 0)}</span>
          <span>{formatDuration(run.evalTimes[n - 1] ?? 0)}</span>
        </div>
      </section>

      <div className="pq-slider">
        <label htmlFor={`${id}-look`}>{t('promql.alert.look', { t: formatDuration(look) })}</label>
        <input
          id={`${id}-look`}
          type="range"
          min={0}
          max={stops.length - 1}
          step={1}
          value={Math.max(0, stops.indexOf(look))}
          aria-valuetext={formatDuration(look)}
          onChange={(e) => setLook(stops[Number(e.target.value)] ?? 0)}
        />
      </div>
      <div className="ar-notices">
        <p className="pq-head">{t('promql.alert.atTime', { t: formatDuration(look) })}</p>
        {now.length === 0 ? (
          <p className="pq-note">{t('promql.alert.nothing')}</p>
        ) : (
          <ul>
            {now.map((a) => (
              <li key={JSON.stringify(a.labels)} className={cx('ar-notice', `is-${a.state}`)}>
                <span className="ar-badge">
                  {a.state === 'firing' ? <DangerIcon size={14} /> : <span aria-hidden="true">⏳</span>} {t(`promql.alert.notice.${a.state}`)}
                </span>{' '}
                <code>{a.labels.alertname}</code> <code>{Object.entries(a.labels).filter(([k]) => k !== 'alertname').map(([k, v]) => `${k}="${v}"`).join(', ')}</code>
                {Object.values(a.annotations).length > 0 && <span className="ar-ann">{Object.values(a.annotations).join(' · ')}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>

      {goal && (
        <button type="button" className="btn ar-test" onClick={test} disabled={done}>
          <span aria-hidden="true">🧪 </span>
          {t('promql.alert.test')}
        </button>
      )}
      {verdict && !done && (
        <Feedback kind="almost">
          {t('feedback.almost')} {t(`promql.alertMiss.${verdict.key}`, verdict.params)}
          {verdict.why && <> {verdict.why}</>}
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
      {done && <Feedback kind="right">{success ?? `${pickPraise(t, learner, tries)} ${t('promql.alert.done')}`}</Feedback>}

      <details className="pq-details">
        <summary>{t('promql.alert.table')}</summary>
        <div className="pq-scroll" tabIndex={0} role="region" aria-label={t('promql.alert.table')}>
          <table className="pq-table">
            <thead>
              <tr>
                <th scope="col">{t('promql.col.time')}</th>
                {run.rows.length === 0 ? <th scope="col">{t('promql.alert.state.inactive')}</th> : run.rows.map((r) => (
                  <th key={r.key} scope="col">
                    <code>{r.name}</code>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {run.evalTimes.map((ts, i) => (
                <tr key={ts} className={i === lookIndex ? 'is-eval' : undefined}>
                  <th scope="row">{formatDuration(ts)}</th>
                  {run.rows.length === 0 ? <td>{stateWord('inactive')}</td> : run.rows.map((r) => <td key={r.key} className={`is-${r.cells[i]}`}>{`${STATE_ICON[r.cells[i]!]} ${stateWord(r.cells[i]!)}`.trim()}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <Announce text={announce} />
    </div>
  );
}
