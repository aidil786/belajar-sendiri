// Geometry for the small PromQL line graph (pure, unit-tested): scales, nice ticks, paths that
// break where a series has no value, and which colour slot each series gets.
import { formatDuration, seriesString, type Labels, type RangeSeries } from '~/engine/promql-sim';

/** Categorical colour slots in tokens.css (--chart-1 … --chart-6), fixed order. */
export const CHART_SLOTS = 6;

/** "Nice" round tick values covering [min, max] (about `count` of them). */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0];
  if (min === max) {
    const pad = Math.abs(min) || 1;
    min -= pad / 2;
    max += pad / 2;
  }
  const raw = (max - min) / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  const start = Math.floor(min / step) * step;
  const out: number[] = [];
  for (let v = start; v <= max + step * 1e-9; v += step) out.push(Number(v.toPrecision(12)));
  if (out[out.length - 1]! < max) out.push(Number((out[out.length - 1]! + step).toPrecision(12)));
  return out;
}

/** Axis label: in full under 10 000, then compact (12K, 3.5M, 1.2G). */
export function formatTick(v: number): string {
  const a = Math.abs(v);
  if (a < 10_000) return String(Number(v.toPrecision(4)));
  for (const [div, unit] of [
    [1e12, 'T'],
    [1e9, 'G'],
    [1e6, 'M'],
    [1e3, 'K'],
  ] as const) {
    if (a >= div) return `${Number((v / div).toPrecision(3))}${unit}`;
  }
  return String(v);
}

export interface GraphLine {
  key: string;
  name: string;
  labels: Labels;
  /** SVG path; a new "M" wherever the series had no value. */
  d: string;
  /** Points actually drawn (for markers and the table). */
  points: { t: number; v: number; x: number; y: number }[];
  /** Colour slot 1–6, or 0 when there are too many series to colour (all neutral). */
  slot: number;
}

export interface GraphModel {
  width: number;
  height: number;
  pad: { l: number; r: number; t: number; b: number };
  lines: GraphLine[];
  yTicks: { v: number; y: number; label: string }[];
  xTicks: { t: number; x: number; label: string }[];
  x: (t: number) => number;
  y: (v: number) => number;
  /** Lowest and highest values on the y scale. */
  domain: [number, number];
}

export function graphModel(series: RangeSeries[], steps: number[], opts: { width?: number; height?: number; extra?: number[] } = {}): GraphModel {
  const width = opts.width ?? 340;
  const height = opts.height ?? 170;
  const pad = { l: 44, r: 12, t: 10, b: 24 };
  const values = series.flatMap((s) => s.points.map((p) => p.v)).filter(Number.isFinite);
  const all = [...values, ...(opts.extra ?? []).filter(Number.isFinite)];
  let lo = all.length ? Math.min(...all) : 0;
  let hi = all.length ? Math.max(...all) : 1;
  if (lo > 0 && lo < hi * 0.6) lo = 0; // start at zero unless the values sit far above it
  if (hi < 0 && hi > lo * 0.6) hi = 0;
  const yTickVals = niceTicks(lo, hi, 4);
  const y0 = yTickVals[0]!;
  const y1 = yTickVals[yTickVals.length - 1]!;
  const t0 = steps[0] ?? 0;
  const t1 = steps[steps.length - 1] ?? 1;
  const x = (t: number) => pad.l + ((t - t0) / Math.max(1, t1 - t0)) * (width - pad.l - pad.r);
  const y = (v: number) => height - pad.b - ((v - y0) / (y1 - y0 || 1)) * (height - pad.t - pad.b);
  const colour = series.length <= CHART_SLOTS;
  const lines: GraphLine[] = series.map((s, i) => {
    const byT = new Map(s.points.map((p) => [p.t, p.v]));
    let d = '';
    let pen = false;
    const points: GraphLine['points'] = [];
    for (const t of steps) {
      const v = byT.get(t);
      if (v === undefined || !Number.isFinite(v)) {
        pen = false;
        continue;
      }
      const px = x(t);
      const py = y(v);
      d += `${pen ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`;
      pen = true;
      points.push({ t, v, x: px, y: py });
    }
    return { key: `${i}`, name: seriesString(s.labels) || '{}', labels: s.labels, d, points, slot: colour ? i + 1 : 0 };
  });
  // About five time labels, on whole multiples of a round step.
  const span = t1 - t0;
  const stepChoices = [60_000, 2 * 60_000, 5 * 60_000, 10 * 60_000, 15 * 60_000, 30 * 60_000, 3600_000, 2 * 3600_000];
  const tStep = stepChoices.find((s) => span / s <= 5) ?? 6 * 3600_000;
  const xTicks: GraphModel['xTicks'] = [];
  for (let t = Math.ceil(t0 / tStep) * tStep; t <= t1; t += tStep) xTicks.push({ t, x: x(t), label: formatDuration(t) });
  return {
    width,
    height,
    pad,
    lines,
    yTicks: yTickVals.map((v) => ({ v, y: y(v), label: formatTick(v) })),
    xTicks,
    x,
    y,
    domain: [y0, y1],
  };
}

/** The step nearest to a time (for the crosshair). */
export function nearestStep(steps: number[], t: number): number {
  let best = steps[0] ?? 0;
  for (const s of steps) if (Math.abs(s - t) < Math.abs(best - t)) best = s;
  return best;
}
