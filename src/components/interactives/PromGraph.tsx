// A small line graph for PromQL range queries (used by PromQLPlayground and AlertRuleBuilder).
// Thin 2px lines in the chart colour tokens (fixed order; more than 6 series turn neutral), a
// recessive hairline grid, the eval time as the pink "you are here" line, an optional dashed
// threshold. Hover or focus a series in the legend to light it up (tap to pin). A crosshair
// readout follows the pointer; every value is also in the folded table (the text alternative).
// Nothing moves on its own, so calm mode needs no special case.
import { useId, useMemo, useState, type PointerEvent } from 'react';
import { formatDuration, formatValue } from '~/engine/promql-sim';
import { graphModel, nearestStep } from '~/lib/promGraph';
import type { GraphData } from '~/lib/promqlPlayground';
import { cx, type T } from './shared';

export interface PromGraphProps {
  data: GraphData;
  /** The pink "you are here" line. */
  evalTime: number;
  t: T;
  title: string;
  threshold?: number;
}

export default function PromGraph({ data, evalTime, t, title, threshold }: PromGraphProps) {
  const id = useId();
  const [pinned, setPinned] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [cross, setCross] = useState<number | null>(null);
  const m = useMemo(() => graphModel(data.series, data.steps, { extra: threshold !== undefined ? [threshold] : [] }), [data, threshold]);
  const hi = hover ?? pinned;
  const end = data.steps[data.steps.length - 1] ?? 0;
  const neutral = m.lines.some((l) => l.slot === 0);
  const ordered = hi ? [...m.lines.filter((l) => l.key !== hi), ...m.lines.filter((l) => l.key === hi)] : m.lines;
  const [t0, t1] = [data.steps[0] ?? 0, end];

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const svg = e.currentTarget.querySelector('svg');
    if (!svg || data.steps.length === 0) return;
    const r = svg.getBoundingClientRect();
    const sx = ((e.clientX - r.left) / r.width) * m.width;
    const frac = (sx - m.pad.l) / (m.width - m.pad.l - m.pad.r);
    if (frac < -0.05 || frac > 1.05) return setCross(null);
    setCross(nearestStep(data.steps, t0 + frac * (t1 - t0)));
  };

  const rows =
    cross === null
      ? []
      : m.lines
          .map((l) => ({ l, p: l.points.find((p) => p.t === cross) }))
          .filter((x) => x.p)
          .slice(0, 6);
  const isolated = (pts: { t: number }[], i: number) => {
    const k = data.steps.indexOf(pts[i]!.t);
    const prev = pts[i - 1]?.t === data.steps[k - 1];
    const next = pts[i + 1]?.t === data.steps[k + 1];
    return !(i > 0 && prev) && !(i < pts.length - 1 && next);
  };

  return (
    <figure className="pq-graph">
      <figcaption className="pq-head">{title}</figcaption>
      {m.lines.length === 0 ? (
        <p className="pq-note">{t('promql.graph.none')}</p>
      ) : (
        <div className="pq-plot" onPointerMove={onMove} onPointerLeave={() => setCross(null)}>
          <svg viewBox={`0 0 ${m.width} ${m.height}`} role="img" aria-label={t('promql.graph.label', { n: m.lines.length, end: formatDuration(end), t: formatDuration(evalTime) })}>
            {m.yTicks.map((tk) => (
              <g key={`y${tk.v}`}>
                <line className="pq-grid" x1={m.pad.l} x2={m.width - m.pad.r} y1={tk.y} y2={tk.y} />
                <text className="pq-axis" x={m.pad.l - 5} y={tk.y + 3.5} textAnchor="end">
                  {tk.label}
                </text>
              </g>
            ))}
            {m.xTicks.map((tk) => (
              <text key={`x${tk.t}`} className="pq-axis" x={tk.x} y={m.height - 6} textAnchor="middle">
                {tk.label}
              </text>
            ))}
            {threshold !== undefined && Number.isFinite(threshold) && (
              <g className="pq-threshold">
                <line x1={m.pad.l} x2={m.width - m.pad.r} y1={m.y(threshold)} y2={m.y(threshold)} />
                <text className="pq-axis" x={m.width - m.pad.r} y={m.y(threshold) - 4} textAnchor="end">
                  {t('promql.graph.threshold', { v: formatValue(threshold) })}
                </text>
              </g>
            )}
            {ordered.map((l) => (
              <g key={l.key} className={cx('pq-series', `s${l.slot}`, hi && (hi === l.key ? 'is-hi' : 'is-dim'))}>
                <path className="pq-line" d={l.d} />
                {l.points.map((p, i) => (isolated(l.points, i) ? <circle key={p.t} className="pq-dot" cx={p.x} cy={p.y} r={3.5} /> : null))}
              </g>
            ))}
            <g className="pq-eval">
              <line x1={m.x(evalTime)} x2={m.x(evalTime)} y1={m.pad.t} y2={m.height - m.pad.b} />
            </g>
            {cross !== null && <line className="pq-cross" x1={m.x(cross)} x2={m.x(cross)} y1={m.pad.t} y2={m.height - m.pad.b} />}
          </svg>
          {cross !== null && (
            <div className={cx('pq-tip', m.x(cross) > m.width / 2 && 'is-left')} style={{ left: `${(m.x(cross) / m.width) * 100}%` }} aria-hidden="true">
              <p className="pq-tip-head">{t('promql.graph.at', { t: formatDuration(cross) })}</p>
              {rows.length === 0 && <p>{t('promql.graph.noValue')}</p>}
              {rows.map(({ l, p }) => (
                <p key={l.key} className="pq-tip-row">
                  <span className={cx('pq-key', `s${l.slot}`)} />
                  <strong>{formatValue(p!.v)}</strong> <span className="pq-tip-name">{l.name}</span>
                </p>
              ))}
            </div>
          )}
        </div>
      )}
      {neutral && <p className="pq-note">{t('promql.graph.many')}</p>}
      {m.lines.length > 0 && (
        <ul className="pq-legend" aria-label={t('promql.graph.legend')}>
          {m.lines.map((l) => (
            <li key={l.key}>
              <button
                type="button"
                className={cx('pq-legend-btn', pinned === l.key && 'is-on')}
                aria-pressed={pinned === l.key}
                aria-label={t('promql.graph.pick', { name: l.name })}
                onClick={() => setPinned(pinned === l.key ? null : l.key)}
                onPointerEnter={() => setHover(l.key)}
                onPointerLeave={() => setHover(null)}
                onFocus={() => setHover(l.key)}
                onBlur={() => setHover(null)}
              >
                <span className={cx('pq-key', `s${l.slot}`, hi === l.key && 'is-hi')} aria-hidden="true" />
                <code>{l.name}</code>
              </button>
            </li>
          ))}
        </ul>
      )}
      {m.lines.length > 0 && (
        <details className="pq-details">
          <summary>{t('promql.graph.table')}</summary>
          <div className="pq-scroll" tabIndex={0} role="region" aria-labelledby={`${id}-cap`}>
            <table className="pq-table">
              <caption id={`${id}-cap`} className="visually-hidden">
                {t('promql.graph.table')}
              </caption>
              <thead>
                <tr>
                  <th scope="col">{t('promql.col.time')}</th>
                  {m.lines.map((l) => (
                    <th key={l.key} scope="col">
                      <code>{l.name}</code>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.steps.map((s) => (
                  <tr key={s} className={s === evalTime ? 'is-eval' : undefined}>
                    <th scope="row">{formatDuration(s)}</th>
                    {m.lines.map((l) => {
                      const p = l.points.find((x) => x.t === s);
                      return <td key={l.key}>{p ? formatValue(p.v) : '–'}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </figure>
  );
}
