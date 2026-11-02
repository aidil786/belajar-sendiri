// Traffic dial: send a share of users from the old version (blue, v1) to the new one
// (green, v2) — canary steps, or a blue/green switch. A line graph shows each version's
// error rate, minute by minute; a spike above the alarm line turns red (with an icon).
// Roll back before too many users are hurt, or finish a safe rollout.
// Minutes play once after each move (~0.6 s each) and stop: nothing loops.
// Calm mode / reduced motion: no timer; "Next minute" steps the numbers by hand.
import { useEffect, useMemo, useState } from 'react';
import type { ConveyorScenario } from '~/engine/conveyor-sim';
import type { Lang } from '~/i18n';
import {
  dialConfig,
  dialVerdict,
  keepOld,
  nextStep,
  playMinute,
  rate,
  rollback,
  setWeight,
  smokeTest,
  spikeAt,
  startDial,
  type DialMode,
  type DialState,
  type DialTask,
  type Minute,
} from '~/lib/trafficDial';
import { DangerIcon } from './AreaIcons';
import { Announce, Feedback, cx, pickPraise, useCardEvents, useLearnerName, useMotionOK, useT, type T } from './shared';
import './conveyor.css';

export interface TrafficDialProps {
  lang: Lang;
  mode?: DialMode;
  /** Share of requests the new version fails (0.08 = 8%). 0 or tiny = a healthy release. */
  newErrorRate?: number;
  oldErrorRate?: number;
  /** Canary steps in percent (default 5, 25, 50, 100). */
  steps?: number[];
  /** Alarm line (default 0.02 = 2%). */
  threshold?: number;
  usersPerMinute?: number;
  task?: DialTask;
  success?: string;
  /** A cicd scenario with `traffic` defaults (course="cicd"). */
  scenario?: ConveyorScenario;
}

const MINUTE_MS = 600;
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

export default function TrafficDial(props: TrafficDialProps) {
  const { lang, scenario, success } = props;
  const t = useT(lang);
  const learner = useLearnerName();
  const motionOK = useMotionOK();
  const { ref, emit } = useCardEvents();
  const task: DialTask = props.task ?? { type: 'rollback' };
  const cfg = useMemo(
    () =>
      dialConfig({
        ...scenario?.traffic,
        ...(props.mode ? { mode: props.mode } : {}),
        ...(props.newErrorRate !== undefined ? { newErrorRate: props.newErrorRate } : {}),
        ...(props.oldErrorRate !== undefined ? { oldErrorRate: props.oldErrorRate } : {}),
        ...(props.steps ? { steps: props.steps } : {}),
        ...(props.threshold !== undefined ? { threshold: props.threshold } : {}),
        ...(props.usersPerMinute !== undefined ? { usersPerMinute: props.usersPerMinute } : {}),
        task,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scenario, props.mode, props.newErrorRate, props.oldErrorRate, props.steps, props.threshold, props.usersPerMinute, task.type],
  );
  const [s, setS] = useState<DialState>(startDial);
  const [done, setDone] = useState(false);
  const [announce, setAnnounce] = useState('');
  const [tries, setTries] = useState(1);

  const verdict = dialVerdict(s, cfg, task);
  const spike = spikeAt(s, cfg);
  const over = verdict === 'tooLate';

  // Play the queued minutes, one at a time. Stops when the queue is empty (or too late).
  useEffect(() => {
    if (!motionOK || s.queued <= 0 || over) return;
    const id = window.setTimeout(() => setS((x) => playMinute(x, cfg)), MINUTE_MS);
    return () => window.clearTimeout(id);
  }, [motionOK, s, cfg, over]);

  useEffect(() => {
    if (done) return;
    if (verdict === 'win') {
      setDone(true);
      emit('fl:done', { tries });
    } else if (verdict === 'tooLate') emit('fl:wrong');
    // emit is stable enough for a one-off event per verdict change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verdict]);
  useEffect(() => {
    if (spike !== null) setAnnounce(t('traffic.spike', { minute: spike }));
  }, [spike, t]);

  const busy = s.queued > 0 && motionOK;
  const locked = done || over;
  const move = (w: number) => {
    setS((x) => setWeight(x, cfg, w));
    setAnnounce(t('traffic.moved', { pct: w }));
  };
  const back = () => {
    setS((x) => rollback(x, cfg));
    setAnnounce(t('traffic.rolledBack'));
  };
  const restart = () => {
    setS(startDial());
    setTries((n) => n + 1);
  };
  const last = s.minutes[s.minutes.length - 1];
  const next = nextStep(s, cfg);

  return (
    <div className="td" ref={ref}>
      <p className="interactive-help">{t(`traffic.task.${task.type}.${cfg.mode}`)}</p>

      <div className="td-split" aria-hidden="true">
        <span className="td-old" style={{ flexGrow: 100 - s.weight }}>
          {100 - s.weight > 8 ? `v1 ${100 - s.weight}%` : ''}
        </span>
        <span className="td-new" style={{ flexGrow: s.weight }}>
          {s.weight > 8 ? `v2 ${s.weight}%` : ''}
        </span>
      </div>
      <p className="td-split-text">{t('traffic.split', { old: 100 - s.weight, new: s.weight })}</p>

      <div className="td-controls">
        {cfg.mode === 'canary' ? (
          <div className="td-steps" role="group" aria-label={t('traffic.stepsLabel')}>
            {cfg.steps.map((w) => (
              <button
                key={w}
                type="button"
                className={cx('td-step', s.weight === w && 'is-on')}
                aria-pressed={s.weight === w}
                disabled={locked || busy || w <= s.weight || w !== next}
                onClick={() => move(w)}
              >
                {t('traffic.sendTo', { pct: w })}
              </button>
            ))}
          </div>
        ) : (
          <div className="td-steps">
            <button type="button" className="btn btn-ghost" disabled={locked || busy || s.weight > 0 || Boolean(s.smoke)} onClick={() => setS((x) => smokeTest(x, cfg))}>
              {t('traffic.smoke')}
            </button>
            <button type="button" className="btn btn-ghost" disabled={locked || busy || s.weight === 100} onClick={() => move(100)}>
              {t('traffic.switch')}
            </button>
            {s.smoke && s.smoke.errors > 0 && s.weight === 0 && !s.keptOld && (
              <button type="button" className="btn" disabled={locked} onClick={() => setS((x) => keepOld(x))}>
                {t('traffic.keepOld')}
              </button>
            )}
          </div>
        )}
        <button type="button" className="btn td-rollback" disabled={locked || s.weight === 0} onClick={back}>
          <span aria-hidden="true">↩ </span>
          {cfg.mode === 'bluegreen' ? t('traffic.switchBack') : t('traffic.rollback')}
        </button>
        {!motionOK && s.queued > 0 && !over && (
          <button type="button" className="btn btn-ghost" onClick={() => setS((x) => playMinute(x, cfg))}>
            ⏭ {t('traffic.nextMinute')}
          </button>
        )}
      </div>

      {s.smoke && (
        <p className={cx('td-smoke', s.smoke.errors > 0 ? 'is-bad' : 'is-ok')}>
          {s.smoke.errors > 0 ? <DangerIcon size={14} /> : <span aria-hidden="true">✓ </span>} {t('traffic.smokeResult', { n: s.smoke.requests, errors: s.smoke.errors })}
        </p>
      )}

      <Graph minutes={s.minutes} threshold={cfg.threshold} spike={spike} t={t} />

      <div className="td-stats">
        <p>
          {t('traffic.minute', { n: s.minutes.length })}
          {last && (
            <>
              {' · '}
              <span className="td-k-old">v1</span> {pct(rate(last.oldErr, last.oldReq))} · <span className="td-k-new">v2</span> {last.newReq ? pct(rate(last.newErr, last.newReq)) : '–'}
            </>
          )}
        </p>
        {task.type !== 'explore' && (
          <p className={cx('td-hurt', s.hurt > cfg.maxHurt && 'is-bad')}>
            {s.hurt > cfg.maxHurt && <DangerIcon size={14} />} {t('traffic.hurt', { n: s.hurt, max: cfg.maxHurt })}
            <span className="td-meter" aria-hidden="true">
              <span style={{ width: `${Math.min(100, (s.hurt / cfg.maxHurt) * 100)}%` }} />
            </span>
          </p>
        )}
      </div>
      {spike !== null && (
        <p className="td-alert">
          <DangerIcon size={16} /> {t('traffic.spike', { minute: spike })}
        </p>
      )}

      <details className="td-numbers" open={!motionOK}>
        <summary>{t('traffic.numbers')}</summary>
        {s.minutes.length === 0 ? (
          <p>{t('traffic.noMinutes')}</p>
        ) : (
          <div className="td-table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">{t('traffic.col.minute')}</th>
                  <th scope="col">{t('traffic.col.share')}</th>
                  <th scope="col">{t('traffic.col.old')}</th>
                  <th scope="col">{t('traffic.col.new')}</th>
                </tr>
              </thead>
              <tbody>
                {s.minutes.map((m) => (
                  <tr key={m.n}>
                    <th scope="row">{m.n}</th>
                    <td>{m.weight}%</td>
                    <td>{t('traffic.cell', { errors: m.oldErr, req: m.oldReq })}</td>
                    <td className={rate(m.newErr, m.newReq) > cfg.threshold ? 'is-bad' : undefined}>{m.newReq ? t('traffic.cell', { errors: m.newErr, req: m.newReq }) : '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </details>

      {over && (
        <Feedback kind="almost">
          {t('feedback.almost')} {t('traffic.tooLate', { n: s.hurt })}{' '}
          <button type="button" className="btn btn-quiet" onClick={restart}>
            {t('feedback.reset')}
          </button>
        </Feedback>
      )}
      {verdict === 'healthyRollback' && !done && <Feedback kind="almost">{t('traffic.healthyBack')}</Feedback>}
      {done && <Feedback kind="right">{success ?? `${pickPraise(t, learner, tries)} ${t(`traffic.done.${task.type}`)}`}</Feedback>}
      <Announce text={announce} />
    </div>
  );
}

/** Error rate per minute: one axis (percent), two lines, an alarm line. */
function Graph({ minutes, threshold, spike, t }: { minutes: Minute[]; threshold: number; spike: number | null; t: T }) {
  const W = 320;
  const H = 150;
  const pad = { l: 36, r: 34, t: 10, b: 22 };
  const span = Math.max(12, minutes.length);
  const top = Math.max(0.1, threshold * 2, ...minutes.map((m) => rate(m.newErr, m.newReq)), ...minutes.map((m) => rate(m.oldErr, m.oldReq))) * 1.1;
  const x = (n: number) => pad.l + ((n - 1) / Math.max(1, span - 1)) * (W - pad.l - pad.r);
  const y = (r: number) => H - pad.b - (r / top) * (H - pad.t - pad.b);
  const oldPts = minutes.map((m) => [x(m.n), y(rate(m.oldErr, m.oldReq))] as const);
  const newMins = minutes.filter((m) => m.newReq > 0);
  const path = (pts: readonly (readonly [number, number])[]) => pts.map(([a, b], i) => `${i ? 'L' : 'M'}${a.toFixed(1)},${b.toFixed(1)}`).join(' ');
  // The new line breaks where it had no traffic.
  const newSegs: (readonly [number, number])[][] = [];
  let seg: (readonly [number, number])[] = [];
  for (const m of minutes) {
    if (m.newReq > 0) seg.push([x(m.n), y(rate(m.newErr, m.newReq))] as const);
    else if (seg.length) {
      newSegs.push(seg);
      seg = [];
    }
  }
  if (seg.length) newSegs.push(seg);
  const ticks = [0, top / 2, top];
  const lastOld = oldPts[oldPts.length - 1];
  const lastNew = newMins[newMins.length - 1];
  return (
    <figure className="td-graph">
      <figcaption className="cv-head">{t('traffic.graph')}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('traffic.graphLabel', { threshold: pct(threshold) })}>
        {ticks.map((v, i) => (
          <g key={i}>
            <line className="td-grid" x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} />
            <text className="td-axis" x={pad.l - 4} y={y(v) + 4} textAnchor="end">
              {`${Math.round(v * 100)}%`}
            </text>
          </g>
        ))}
        <line className="td-alarm" x1={pad.l} x2={W - pad.r} y1={y(threshold)} y2={y(threshold)} />
        <text className="td-axis" x={W - pad.r + 3} y={y(threshold) + 4}>
          {t('traffic.alarm')}
        </text>
        {oldPts.length > 1 && <path className="td-line td-line-old" d={path(oldPts)} />}
        {oldPts.map(([a, b], i) => (
          <circle key={`o${i}`} className="td-dot-old" cx={a} cy={b} r={3.5} />
        ))}
        {newSegs.map((pts, i) => pts.length > 1 && <path key={`n${i}`} className="td-line td-line-new" d={path(pts)} />)}
        {newMins.map((m) => {
          const cx = x(m.n);
          const cy = y(rate(m.newErr, m.newReq));
          const bad = rate(m.newErr, m.newReq) > threshold;
          return <rect key={`n${m.n}`} className={cx2(bad)} x={cx - 4} y={cy - 4} width={8} height={8} rx={1.5} />;
        })}
        {spike !== null && (
          <g className="td-spike" transform={`translate(${x(spike)}, ${Math.max(pad.t + 8, y(rate(minutes[spike - 1]!.newErr, minutes[spike - 1]!.newReq)) - 14)})`}>
            <path d="M0,-7 L7,6 L-7,6 Z" />
            <path className="td-spike-mark" d="M0,-2 L0,2 M0,4 L0,4.5" />
          </g>
        )}
        {lastOld && (
          <text className="td-label" x={lastOld[0] + 6} y={lastOld[1] + (lastNew ? 12 : 4)}>
            v1
          </text>
        )}
        {lastNew && (
          <text className="td-label" x={x(lastNew.n) + 6} y={y(rate(lastNew.newErr, lastNew.newReq)) - 4}>
            v2
          </text>
        )}
        <text className="td-axis" x={pad.l} y={H - 4}>
          {t('traffic.axisTime')}
        </text>
      </svg>
      <p className="td-legend">
        <span className="td-key td-key-old" aria-hidden="true" /> {t('traffic.legendOld')} <span className="td-key td-key-new" aria-hidden="true" /> {t('traffic.legendNew')}
      </p>
    </figure>
  );
}

function cx2(bad: boolean): string {
  return bad ? 'td-dot-new is-bad' : 'td-dot-new';
}
