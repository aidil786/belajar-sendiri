// PromQL functions, written after Prometheus 3's promql/functions.go so results match promtool.
import { dropName, makeLabels, NAME } from './format';
import { almostEqual, goMax, goMin, kahanSumInc, sgn } from './mathx';
import { goRegex } from './parser';
import { PromQLError, type InstantSample, type Labels, type RangeSeries } from './types';

type Pts = { t: number; v: number }[];

// ---- Range-vector functions ------------------------------------------------------------------

/**
 * rate / increase / delta: Prometheus's extrapolatedRate. `rangeStart`/`rangeEnd` are the
 * selector's window (eval time − offset − range … eval time − offset).
 */
export function extrapolatedRate(pts: Pts, rangeStart: number, rangeEnd: number, rangeMs: number, isCounter: boolean, isRate: boolean): number | null {
  if (pts.length < 2) return null;
  const n1 = pts.length - 1;
  const firstT = pts[0]!.t;
  const lastT = pts[n1]!.t;
  let result = pts[n1]!.v - pts[0]!.v;
  if (isCounter) {
    let prev = pts[0]!.v;
    for (const p of pts.slice(1)) {
      if (p.v < prev) result += prev;
      prev = p.v;
    }
  }
  let durationToStart = (firstT - rangeStart) / 1000;
  let durationToEnd = (rangeEnd - lastT) / 1000;
  const sampledInterval = (lastT - firstT) / 1000;
  const averageDurationBetweenSamples = sampledInterval / n1;
  const threshold = averageDurationBetweenSamples * 1.1;
  let extrapolateToInterval = sampledInterval;
  if (durationToStart >= threshold) durationToStart = averageDurationBetweenSamples / 2;
  if (isCounter && result > 0 && pts[0]!.v >= 0) {
    const durationToZero = sampledInterval * (pts[0]!.v / result);
    if (durationToZero < durationToStart) durationToStart = durationToZero;
  }
  extrapolateToInterval += durationToStart;
  if (durationToEnd >= threshold) durationToEnd = averageDurationBetweenSamples / 2;
  extrapolateToInterval += durationToEnd;
  let factor = extrapolateToInterval / sampledInterval;
  if (isRate) factor /= rangeMs / 1000;
  return result * factor;
}

/** irate / idelta: the last two samples. */
export function instantValue(pts: Pts, isRate: boolean): number | null {
  if (pts.length < 2) return null;
  const last = pts[pts.length - 1]!;
  const prev = pts[pts.length - 2]!;
  let v = isRate && last.v < prev.v ? last.v : last.v - prev.v;
  const interval = last.t - prev.t;
  if (interval === 0) return null;
  if (isRate) v /= interval / 1000;
  return v;
}

/** Least squares fit (Prometheus linearRegression, with Kahan sums). */
export function linearRegression(pts: Pts, interceptTime: number): [number, number] {
  let n = 0;
  let sumX = 0, cX = 0, sumY = 0, cY = 0, sumXY = 0, cXY = 0, sumX2 = 0, cX2 = 0;
  const initY = pts[0]!.v;
  let constY = true;
  pts.forEach((p, i) => {
    if (constY && i > 0 && p.v !== initY) constY = false;
    n += 1;
    const x = (p.t - interceptTime) / 1e3;
    [sumX, cX] = kahanSumInc(x, sumX, cX);
    [sumY, cY] = kahanSumInc(p.v, sumY, cY);
    [sumXY, cXY] = kahanSumInc(x * p.v, sumXY, cXY);
    [sumX2, cX2] = kahanSumInc(x * x, sumX2, cX2);
  });
  if (constY) {
    if (!Number.isFinite(initY) && !Number.isNaN(initY)) return [NaN, NaN];
    return [0, initY];
  }
  sumX += cX;
  sumY += cY;
  sumXY += cXY;
  sumX2 += cX2;
  const covXY = sumXY - (sumX * sumY) / n;
  const varX = sumX2 - (sumX * sumX) / n;
  const slope = covXY / varX;
  const intercept = sumY / n - (slope * sumX) / n;
  return [slope, intercept];
}

export function sumOverTime(pts: Pts): number {
  let sum = 0;
  let c = 0;
  for (const p of pts) [sum, c] = kahanSumInc(p.v, sum, c);
  if (!Number.isFinite(sum) && !Number.isNaN(sum)) return sum;
  return sum + c;
}

export function avgOverTime(pts: Pts): number {
  let sum = pts[0]!.v;
  let count = 1;
  let mean = 0;
  let kahanC = 0;
  let incremental = false;
  for (let i = 1; i < pts.length; i++) {
    const f = pts[i]!.v;
    count = i + 1;
    if (!incremental) {
      const [newSum, newC] = kahanSumInc(f, sum, kahanC);
      if (Number.isFinite(newSum) || Number.isNaN(newSum)) {
        sum = newSum;
        kahanC = newC;
        continue;
      }
      incremental = true;
      mean = sum / (count - 1);
      kahanC /= count - 1;
    }
    const q = (count - 1) / count;
    [mean, kahanC] = kahanSumInc(f / count, q * mean, q * kahanC);
  }
  if (incremental) return mean + kahanC;
  return sum / count + kahanC / count;
}

export function maxOverTime(pts: Pts): number {
  let m = pts[0]!.v;
  for (const p of pts) if (p.v > m || Number.isNaN(m)) m = p.v;
  return m;
}

export function minOverTime(pts: Pts): number {
  let m = pts[0]!.v;
  for (const p of pts) if (p.v < m || Number.isNaN(m)) m = p.v;
  return m;
}

export function changes(pts: Pts): number {
  let n = 0;
  let prev = pts[0]!.v;
  for (const p of pts.slice(1)) {
    if (p.v !== prev && !(Number.isNaN(p.v) && Number.isNaN(prev))) n++;
    prev = p.v;
  }
  return n;
}

export function resets(pts: Pts): number {
  let n = 0;
  let prev = pts[0]!.v;
  for (const p of pts.slice(1)) {
    if (p.v < prev) n++;
    prev = p.v;
  }
  return n;
}

/** Prometheus quantile() over plain values (NaN sorts first). */
export function quantile(q: number, values: number[]): number {
  if (values.length === 0 || Number.isNaN(q)) return NaN;
  if (q < 0) return -Infinity;
  if (q > 1) return Infinity;
  const sorted = [...values].sort((a, b) => (Number.isNaN(a) ? (Number.isNaN(b) ? 0 : -1) : Number.isNaN(b) ? 1 : a - b));
  const n = sorted.length;
  const rank = q * (n - 1);
  const lower = Math.max(0, Math.floor(rank));
  const upper = Math.min(n - 1, lower + 1);
  const weight = rank - Math.floor(rank);
  return sorted[lower]! * (1 - weight) + sorted[upper]! * weight;
}

// ---- histogram_quantile (classic buckets) ----------------------------------------------------

interface Bucket {
  upperBound: number;
  count: number;
}

const SMALL_DELTA_TOLERANCE = 1e-12;

/** Go strconv.ParseFloat for an `le` value (null when it isn't a number). */
export function parseLe(s: string): number | null {
  const t = s.trim();
  if (t !== s || s === '') return null;
  if (/^[-+]?(inf|infinity)$/i.test(s)) return s.startsWith('-') ? -Infinity : Infinity;
  if (/^[-+]?nan$/i.test(s)) return NaN;
  if (!/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s)) return null;
  return Number(s);
}

/** Prometheus BucketQuantile. */
export function bucketQuantile(q: number, input: Bucket[]): number {
  if (Number.isNaN(q)) return NaN;
  if (q < 0) return -Infinity;
  if (q > 1) return Infinity;
  let buckets = [...input].map((b) => ({ ...b })).sort((a, b) => (a.upperBound < b.upperBound ? -1 : a.upperBound > b.upperBound ? 1 : 0));
  if (buckets[buckets.length - 1]!.upperBound !== Infinity) return NaN;
  // coalesceBuckets: equal upper bounds add up.
  const merged: Bucket[] = [];
  for (const b of buckets) {
    const last = merged[merged.length - 1];
    if (last && last.upperBound === b.upperBound) last.count += b.count;
    else merged.push({ ...b });
  }
  buckets = merged;
  // ensureMonotonicAndIgnoreSmallDeltas
  let prev = buckets[0]!.count;
  for (let i = 1; i < buckets.length; i++) {
    const curr = buckets[i]!.count;
    if (curr === prev) continue;
    if (almostEqual(prev, curr, SMALL_DELTA_TOLERANCE)) {
      buckets[i]!.count = prev;
      continue;
    }
    if (curr < prev) {
      buckets[i]!.count = prev;
      continue;
    }
    prev = curr;
  }
  if (buckets.length < 2) return NaN;
  const observations = buckets[buckets.length - 1]!.count;
  if (observations === 0) return NaN;
  let rank = q * observations;
  // sort.Search over the first n-1 buckets: the first with count >= rank.
  let b = buckets.length - 1;
  for (let i = 0; i < buckets.length - 1; i++) {
    if (buckets[i]!.count >= rank) {
      b = i;
      break;
    }
  }
  if (b === buckets.length - 1) return buckets[buckets.length - 2]!.upperBound;
  if (b === 0 && buckets[0]!.upperBound <= 0) return buckets[0]!.upperBound;
  let bucketStart = 0;
  const bucketEnd = buckets[b]!.upperBound;
  let count = buckets[b]!.count;
  if (b > 0) {
    bucketStart = buckets[b - 1]!.upperBound;
    count -= buckets[b - 1]!.count;
    rank -= buckets[b - 1]!.count;
  }
  return bucketStart + (bucketEnd - bucketStart) * (rank / count);
}

export function histogramQuantile(q: number, vec: InstantSample[]): InstantSample[] {
  const groups = new Map<string, { labels: Labels; buckets: Bucket[] }>();
  for (const s of vec) {
    const le = parseLe(s.labels.le ?? '');
    if (le === null) continue;
    const rest: Record<string, string> = { ...s.labels };
    delete rest.le;
    const sig = JSON.stringify(Object.entries(rest).sort());
    let g = groups.get(sig);
    if (!g) {
      const out = { ...rest };
      delete out[NAME];
      g = { labels: makeLabels(out), buckets: [] };
      groups.set(sig, g);
    }
    g.buckets.push({ upperBound: le, count: s.value });
  }
  return [...groups.values()].map((g) => ({ labels: g.labels, value: bucketQuantile(q, g.buckets) }));
}

// ---- Instant-vector functions ---------------------------------------------------------------

export const SIMPLE: Record<string, (x: number) => number> = {
  abs: Math.abs,
  ceil: Math.ceil,
  floor: Math.floor,
  exp: Math.exp,
  sqrt: Math.sqrt,
  ln: Math.log,
  log2: Math.log2,
  log10: Math.log10,
  sgn,
};

export function round(x: number, toNearest: number): number {
  const inv = 1.0 / toNearest;
  return Math.floor(x * inv + 0.5) / inv;
}

export function clamp(x: number, min: number, max: number): number {
  return goMax(min, goMin(max, x));
}

/** Go regexp Expand: $1, ${1}, $name, ${name}, $$ (a name runs over letters, digits and _). */
export function goExpand(template: string, m: RegExpExecArray): string {
  let out = '';
  let rest = template;
  for (;;) {
    const i = rest.indexOf('$');
    if (i < 0) break;
    out += rest.slice(0, i);
    rest = rest.slice(i + 1);
    if (rest.startsWith('$')) {
      out += '$';
      rest = rest.slice(1);
      continue;
    }
    let s = rest;
    let brace = false;
    if (s.startsWith('{')) {
      brace = true;
      s = s.slice(1);
    }
    const nm = /^[\p{L}\p{N}_]+/u.exec(s);
    if (!nm || (brace && s[nm[0].length] !== '}')) {
      out += '$';
      continue;
    }
    const name = nm[0];
    rest = s.slice(name.length + (brace ? 1 : 0));
    let num = -1;
    if (/^\d+$/.test(name) && !(name.length > 1 && name[0] === '0') && name.length <= 8) num = Number(name);
    if (num >= 0) out += m[num] ?? '';
    else out += m.groups?.[name] ?? '';
  }
  return out + rest;
}

export function labelReplace(vec: InstantSample[], dst: string, repl: string, src: string, re: string): InstantSample[] {
  let regex: RegExp;
  try {
    regex = new RegExp(`^(?:${goRegex(re)})$`, 's');
  } catch {
    throw new PromQLError(`invalid regular expression in label_replace(): ${re}`, 'badRegex', { re });
  }
  // Prometheus 3 allows any UTF-8 label name; only an empty one is refused.
  if (dst === '') throw new PromQLError(`invalid destination label name in label_replace(): ${dst}`, 'badLabelName', { name: dst });
  return vec.map((s) => {
    const m = regex.exec(s.labels[src] ?? '');
    if (!m) return s;
    const v = goExpand(repl, m);
    return { ...s, labels: makeLabels({ ...s.labels, [dst]: v }) };
  });
}

export function labelJoin(vec: InstantSample[], dst: string, sep: string, srcs: string[]): InstantSample[] {
  if (dst === '') throw new PromQLError(`invalid destination label name in label_join(): ${dst}`, 'badLabelName', { name: dst });
  return vec.map((s) => ({ ...s, labels: makeLabels({ ...s.labels, [dst]: srcs.map((l) => s.labels[l] ?? '').join(sep) }) }));
}

/** absent(): the labels an `=` matcher pins down exactly (once each). */
export function absentLabels(matchers: { name: string; op: string; value: string }[]): Labels {
  const out: Record<string, string> = {};
  const has = new Set<string>();
  for (const m of matchers) {
    if (m.name === NAME) continue;
    if (m.op === '=' && !has.has(m.name)) {
      out[m.name] = m.value;
      has.add(m.name);
    } else delete out[m.name];
  }
  return makeLabels(out);
}

export function dropNames(vec: InstantSample[]): InstantSample[] {
  return vec.map((s) => ({ labels: dropName(s.labels), value: s.value }));
}

export type RangeFn = (pts: Pts, ctx: { rangeStart: number; rangeEnd: number; rangeMs: number; t: number; scalar: number }) => number | null;

/** Range-vector functions that map one series to one number (null = no output). */
export const RANGE_FUNCS: Record<string, RangeFn> = {
  rate: (p, c) => extrapolatedRate(p, c.rangeStart, c.rangeEnd, c.rangeMs, true, true),
  increase: (p, c) => extrapolatedRate(p, c.rangeStart, c.rangeEnd, c.rangeMs, true, false),
  delta: (p, c) => extrapolatedRate(p, c.rangeStart, c.rangeEnd, c.rangeMs, false, false),
  irate: (p) => instantValue(p, true),
  idelta: (p) => instantValue(p, false),
  deriv: (p) => (p.length < 2 ? null : linearRegression(p, p[0]!.t)[0]),
  predict_linear: (p, c) => {
    if (p.length < 2) return null;
    const [slope, intercept] = linearRegression(p, c.t);
    return slope * c.scalar + intercept;
  },
  avg_over_time: (p) => avgOverTime(p),
  sum_over_time: (p) => sumOverTime(p),
  max_over_time: (p) => maxOverTime(p),
  min_over_time: (p) => minOverTime(p),
  count_over_time: (p) => p.length,
  last_over_time: (p) => p[p.length - 1]!.v,
  present_over_time: () => 1,
  quantile_over_time: (p, c) => quantile(c.scalar, p.map((x) => x.v)),
  changes: (p) => changes(p),
  resets: (p) => resets(p),
};

/** Range functions that keep the metric name (Prometheus drops it for all the others). */
export const KEEPS_NAME = new Set(['last_over_time']);

export function rangeSeriesOut(series: RangeSeries[], name: string, fn: RangeFn, ctx: Omit<Parameters<RangeFn>[1], 'scalar'> & { scalar: number }): InstantSample[] {
  const out: InstantSample[] = [];
  for (const s of series) {
    const v = fn(s.points, ctx);
    if (v === null) continue;
    out.push({ labels: KEEPS_NAME.has(name) ? s.labels : dropName(s.labels), value: v });
  }
  return out;
}
