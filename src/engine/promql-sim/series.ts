// The series store, fed with promtool's `input_series` notation:
//   series: 'http_requests_total{job="shop",code="200"}'
//   values: '0+10x30'        → 0 10 20 … 300 (31 values; repeated addition, like promtool)
//   values: '1 2 _ _x3 stale 5'  → _ is a missing sample, stale is a staleness marker
// Sample i sits at time i × interval (time 0 is the start).
import type { Matcher } from './ast';
import { goRegex } from './parser';
import { compareLabels, labelsKey, makeLabels, NAME } from './format';
import type { Labels, Point, StoredSeries } from './types';

/** One value slot: a number, a stale marker, or nothing. */
export type Slot = number | 'stale' | null;

const NUM = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$|^[-+]?(?:Inf|inf|NaN|nan)$/;

function num(text: string): number {
  if (/^[-+]?inf$/i.test(text)) return text.startsWith('-') ? -Infinity : Infinity;
  if (/^[-+]?nan$/i.test(text)) return NaN;
  return Number(text);
}

/** Expand a promtool values string into slots (one per interval). */
export function expandValues(text: string): Slot[] {
  const out: Slot[] = [];
  for (const item of text.trim().split(/\s+/)) {
    if (!item) continue;
    if (item === '_') {
      out.push(null);
      continue;
    }
    let m = /^_x(\d+)$/.exec(item);
    if (m) {
      for (let i = 0; i < Number(m[1]); i++) out.push(null);
      continue;
    }
    if (item === 'stale') {
      out.push('stale');
      continue;
    }
    // a+bxn / a-bxn: n+1 values, adding b each time.
    m = /^([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)([-+](?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)x(\d+)$/.exec(item);
    if (m) {
      let v = Number(m[1]);
      const step = Number(m[2]);
      for (let i = 0; i <= Number(m[3]); i++) {
        out.push(v);
        v += step;
      }
      continue;
    }
    // axn: n+1 copies.
    m = /^([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?|[-+]?(?:Inf|inf|NaN|nan))x(\d+)$/.exec(item);
    if (m) {
      for (let i = 0; i <= Number(m[2]); i++) out.push(num(m[1]!));
      continue;
    }
    if (NUM.test(item)) {
      out.push(num(item));
      continue;
    }
    throw new Error(`cannot read the value "${item}" (use numbers, a+bxN, axN, _, _xN or stale)`);
  }
  return out;
}

/** Parse a series descriptor like `up{job="shop"}` or `{__name__="up", job="shop"}`. */
export function parseSeriesLabels(text: string): Labels {
  const m = /^\s*([a-zA-Z_:][a-zA-Z0-9_:]*)?\s*(?:\{(.*)\})?\s*$/s.exec(text);
  if (!m) throw new Error(`cannot read the series "${text}"`);
  const out: Record<string, string> = {};
  if (m[1]) out[NAME] = m[1];
  const body = m[2] ?? '';
  const re = /\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*"((?:[^"\\]|\\.)*)"\s*(,|$)/gy;
  let pos = 0;
  while (pos < body.length) {
    re.lastIndex = pos;
    const lm = re.exec(body);
    if (!lm) {
      if (/^\s*$/.test(body.slice(pos))) break;
      throw new Error(`cannot read the labels of "${text}"`);
    }
    out[lm[1]!] = JSON.parse(`"${lm[2]!}"`) as string;
    pos = re.lastIndex;
  }
  return makeLabels(out);
}

export interface InputSeries {
  series: string;
  values: string;
}

/** A matcher as a test function (regexes are anchored and `.` matches newlines, like Prometheus 3). */
export function matcherFn(m: Matcher): (v: string) => boolean {
  switch (m.op) {
    case '=':
      return (v) => v === m.value;
    case '!=':
      return (v) => v !== m.value;
    case '=~': {
      const re = new RegExp(`^(?:${goRegex(m.value)})$`, 's');
      return (v) => re.test(v);
    }
    case '!~': {
      const re = new RegExp(`^(?:${goRegex(m.value)})$`, 's');
      return (v) => !re.test(v);
    }
  }
}

function compareSeq(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/** Time series in memory: add samples, select by matchers. */
export class SeriesStore {
  private byKey = new Map<string, StoredSeries>();
  private ordered: StoredSeries[] | null = null;
  private nextSeq = 0;

  /**
   * Load promtool-style input series at `interval` ms per value. promtool loads samples step by
   * step (every `loadStep` ms, its evaluation interval), so a series is created at the first step
   * that reaches its first sample; series created at the same step keep the input order.
   */
  static fromInput(input: InputSeries[], interval: number, loadStep = 60_000): SeriesStore {
    const s = new SeriesStore();
    input.forEach((item, idx) => {
      const labels = parseSeriesLabels(item.series);
      const slots = expandValues(item.values);
      const first = slots.findIndex((x) => x !== null);
      const seq = [first < 0 ? 0 : Math.ceil((first * interval) / loadStep), 0, idx];
      slots.forEach((slot, i) => {
        if (slot === null) return;
        s.add(labels, i * interval, slot === 'stale' ? NaN : slot, slot === 'stale', seq);
      });
    });
    return s;
  }

  clone(): SeriesStore {
    const s = new SeriesStore();
    for (const [k, v] of this.byKey) s.byKey.set(k, { labels: v.labels, key: k, seq: v.seq, points: [...v.points] });
    s.nextSeq = this.nextSeq;
    return s;
  }

  /** Add (or replace) one sample. A new series gets `seq` (default: after every other series). */
  add(labels: Labels, t: number, v: number, stale = false, seq?: number[]): void {
    const key = labelsKey(labels);
    let ser = this.byKey.get(key);
    if (!ser) {
      ser = { labels, key, seq: seq ?? [Number.MAX_SAFE_INTEGER, 0, this.nextSeq], points: [] };
      this.nextSeq++;
      this.byKey.set(key, ser);
      this.ordered = null;
    }
    const p: Point = stale ? { t, v: NaN, stale: true } : { t, v };
    const pts = ser.points;
    if (!pts.length || pts[pts.length - 1]!.t < t) pts.push(p);
    else {
      const i = pts.findIndex((x) => x.t >= t);
      if (pts[i]!.t === t) pts[i] = p;
      else pts.splice(i, 0, p);
    }
  }

  /** All series in creation order (the order Prometheus's head block returns them in). */
  all(): StoredSeries[] {
    if (!this.ordered) this.ordered = [...this.byKey.values()].sort((a, b) => compareSeq(a.seq, b.seq) || compareLabels(a.labels, b.labels));
    return this.ordered;
  }

  /** The next free creation number (rule evaluation uses it for new series). */
  takeSeq(): number {
    return this.nextSeq++;
  }

  select(matchers: Matcher[]): StoredSeries[] {
    const fns = matchers.map((m) => [m.name, matcherFn(m)] as const);
    return this.all().filter((s) => fns.every(([n, f]) => f(s.labels[n] ?? '')));
  }

  /** Metric names in the store. */
  metricNames(): string[] {
    return [...new Set(this.all().map((s) => s.labels[NAME] ?? '').filter(Boolean))].sort();
  }

  /** Time of the last sample in the store. */
  lastTime(): number {
    let t = 0;
    for (const s of this.byKey.values()) {
      const p = s.points[s.points.length - 1];
      if (p && p.t > t) t = p.t;
    }
    return t;
  }
}

/** Points with mint < t <= maxt (Prometheus 3: left-open, right-closed). */
export function pointsIn(points: Point[], mint: number, maxt: number): Point[] {
  // Binary search for the first point after mint.
  let lo = 0;
  let hi = points.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid]!.t <= mint) lo = mid + 1;
    else hi = mid;
  }
  const out: Point[] = [];
  for (let i = lo; i < points.length && points[i]!.t <= maxt; i++) out.push(points[i]!);
  return out;
}
