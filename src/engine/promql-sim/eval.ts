// The PromQL evaluator: instant queries at time t, range queries (start, end, step).
// It follows Prometheus 3: left-open windows (t − 5m, t] for instant selectors and
// (t − range, t] for range selectors, stale markers end a series at once, metric names are
// dropped by arithmetic and most functions, and floats are added the Prometheus way (Kahan).
import { COMPARISON_OPS, SET_OPS, type Aggregate, type Binary, type BinaryOp, type Call, type Expr, type MatrixSelector, type VectorMatching, type VectorSelector } from './ast';
import { compareLabels, dropName, labelNames, labelsKey, labelsString, makeLabels, NAME } from './format';
import {
  absentLabels,
  clamp,
  dropNames,
  histogramQuantile,
  KEEPS_NAME,
  labelJoin,
  labelReplace,
  quantile,
  RANGE_FUNCS,
  rangeSeriesOut,
  round,
  SIMPLE,
} from './functions';
import { goMod, goPow, kahanSumInc } from './mathx';
import { parseExpr } from './parser';
import { pointsIn, type SeriesStore } from './series';
import { PromQLError, type InstantSample, type Labels, type RangeSeries, type Value } from './types';

export const DEFAULT_LOOKBACK = 5 * 60_000;

export interface EvalContext {
  store: SeriesStore;
  /** Range query start / end (for @ start() and @ end()); an instant query has start = end = t. */
  start: number;
  end: number;
  lookback: number;
}

function err(message: string, key: string, params: Record<string, string | number> = {}): never {
  throw new PromQLError(message, key, params);
}

function selectorTime(sel: VectorSelector, t: number, ctx: EvalContext): number {
  const base = sel.at === undefined ? t : sel.at === 'start' ? ctx.start : sel.at === 'end' ? ctx.end : sel.at;
  return base - sel.offset;
}

export function evalVectorSelector(sel: VectorSelector, t: number, ctx: EvalContext): InstantSample[] {
  const te = selectorTime(sel, t, ctx);
  const out: InstantSample[] = [];
  for (const s of ctx.store.select(sel.matchers)) {
    const pts = pointsIn(s.points, te - ctx.lookback, te);
    const last = pts[pts.length - 1];
    if (!last || last.stale) continue;
    out.push({ labels: s.labels, value: last.v, t: last.t });
  }
  return out;
}

export function evalMatrixSelector(m: MatrixSelector, t: number, ctx: EvalContext): RangeSeries[] {
  const te = selectorTime(m.vector, t, ctx);
  const out: RangeSeries[] = [];
  for (const s of ctx.store.select(m.vector.matchers)) {
    const pts = pointsIn(s.points, te - m.range, te).filter((p) => !p.stale);
    if (pts.length) out.push({ labels: s.labels, points: pts.map((p) => ({ t: p.t, v: p.v })) });
  }
  return out;
}

function unwrap(e: Expr): Expr {
  return e.type === 'paren' ? unwrap(e.expr) : e;
}

function noDuplicates(vec: InstantSample[]): InstantSample[] {
  const seen = new Set<string>();
  for (const s of vec) {
    const k = labelsKey(s.labels);
    if (seen.has(k)) err('vector cannot contain metrics with the same labelset', 'sameLabelset');
    seen.add(k);
  }
  return vec;
}

function scalarOf(v: Value): number {
  if (v.type !== 'scalar') err(`expected scalar, got ${v.type}`, 'generic');
  return v.value;
}

function vectorOf(v: Value): InstantSample[] {
  if (v.type !== 'vector') err(`expected instant vector, got ${v.type}`, 'generic');
  return v.samples;
}

// ---- Calls -----------------------------------------------------------------------------------

function evalCall(e: Call, t: number, ctx: EvalContext): Value {
  const f = e.func;
  if (f === 'time') return { type: 'scalar', value: t / 1000 };
  if (f === 'vector') return { type: 'vector', samples: [{ labels: {}, value: scalarOf(evalAt(e.args[0]!, t, ctx)) }] };
  if (f === 'scalar') {
    const v = vectorOf(evalAt(e.args[0]!, t, ctx));
    return { type: 'scalar', value: v.length === 1 ? v[0]!.value : NaN };
  }
  if (f === 'absent') {
    const v = vectorOf(evalAt(e.args[0]!, t, ctx));
    if (v.length) return { type: 'vector', samples: [] };
    const arg = unwrap(e.args[0]!);
    return { type: 'vector', samples: [{ labels: arg.type === 'vector' ? absentLabels(arg.matchers) : {}, value: 1 }] };
  }
  if (f === 'absent_over_time') {
    const arg = unwrap(e.args[0]!) as MatrixSelector;
    const m = evalMatrixSelector(arg, t, ctx);
    if (m.length) return { type: 'vector', samples: [] };
    return { type: 'vector', samples: [{ labels: absentLabels(arg.vector.matchers), value: 1 }] };
  }
  if (f in RANGE_FUNCS) {
    const mi = f === 'quantile_over_time' ? 1 : 0;
    const arg = unwrap(e.args[mi]!) as MatrixSelector;
    const scalarArg = f === 'quantile_over_time' ? e.args[0] : f === 'predict_linear' ? e.args[1] : undefined;
    const scalar = scalarArg ? scalarOf(evalAt(scalarArg, t, ctx)) : 0;
    const te = selectorTime(arg.vector, t, ctx);
    const series = evalMatrixSelector(arg, t, ctx);
    const out = rangeSeriesOut(series, f, RANGE_FUNCS[f]!, { rangeStart: te - arg.range, rangeEnd: te, rangeMs: arg.range, t, scalar });
    return { type: 'vector', samples: KEEPS_NAME.has(f) ? out : noDuplicates(out) };
  }
  if (f === 'timestamp') {
    const arg = unwrap(e.args[0]!);
    const v = vectorOf(evalAt(arg, t, ctx));
    const useOwn = arg.type === 'vector';
    return { type: 'vector', samples: noDuplicates(v.map((s) => ({ labels: dropName(s.labels), value: (useOwn && s.t !== undefined ? s.t : t) / 1000 }))) };
  }
  if (f in SIMPLE) {
    const fn = SIMPLE[f]!;
    const v = vectorOf(evalAt(e.args[0]!, t, ctx));
    return { type: 'vector', samples: noDuplicates(dropNames(v).map((s) => ({ ...s, value: fn(s.value) }))) };
  }
  if (f === 'round') {
    const v = vectorOf(evalAt(e.args[0]!, t, ctx));
    const to = e.args[1] ? scalarOf(evalAt(e.args[1], t, ctx)) : 1;
    return { type: 'vector', samples: noDuplicates(dropNames(v).map((s) => ({ ...s, value: round(s.value, to) }))) };
  }
  if (f === 'clamp' || f === 'clamp_min' || f === 'clamp_max') {
    const v = vectorOf(evalAt(e.args[0]!, t, ctx));
    const a = scalarOf(evalAt(e.args[1]!, t, ctx));
    const b = f === 'clamp' ? scalarOf(evalAt(e.args[2]!, t, ctx)) : 0;
    if (f === 'clamp' && b < a) return { type: 'vector', samples: [] };
    const fn = f === 'clamp' ? (x: number) => clamp(x, a, b) : f === 'clamp_min' ? (x: number) => (Number.isNaN(x) || Number.isNaN(a) ? NaN : Math.max(a, x)) : (x: number) => (Number.isNaN(x) || Number.isNaN(a) ? NaN : Math.min(a, x));
    return { type: 'vector', samples: noDuplicates(dropNames(v).map((s) => ({ ...s, value: fn(s.value) }))) };
  }
  if (f === 'histogram_quantile') {
    const q = scalarOf(evalAt(e.args[0]!, t, ctx));
    const v = vectorOf(evalAt(e.args[1]!, t, ctx));
    return { type: 'vector', samples: noDuplicates(histogramQuantile(q, v)) };
  }
  if (f === 'label_replace') {
    const v = vectorOf(evalAt(e.args[0]!, t, ctx));
    const s = e.args.slice(1).map((a) => (evalAt(a, t, ctx) as { value: string }).value);
    return { type: 'vector', samples: noDuplicates(labelReplace(v, s[0]!, s[1]!, s[2]!, s[3]!)) };
  }
  if (f === 'label_join') {
    const v = vectorOf(evalAt(e.args[0]!, t, ctx));
    const s = e.args.slice(1).map((a) => (evalAt(a, t, ctx) as { value: string }).value);
    return { type: 'vector', samples: noDuplicates(labelJoin(v, s[0]!, s[1]!, s.slice(2))) };
  }
  if (f === 'sort' || f === 'sort_desc') {
    const v = [...vectorOf(evalAt(e.args[0]!, t, ctx))];
    const dir = f === 'sort' ? 1 : -1;
    v.sort((a, b) => {
      if (Number.isNaN(a.value)) return Number.isNaN(b.value) ? 0 : 1;
      if (Number.isNaN(b.value)) return -1;
      return dir * (a.value - b.value);
    });
    return { type: 'vector', samples: v };
  }
  return err(`unknown function with name ${JSON.stringify(f)}`, 'unknownFunction', { name: f });
}

// ---- Aggregations ----------------------------------------------------------------------------

interface Group {
  labels: Labels;
  value: number;
  mean: number;
  kahanC: number;
  count: number;
  incremental: boolean;
  values: number[];
  heap: InstantSample[];
}

/** Go container/heap with a Less function (topk / bottomk keep exactly Prometheus's picks on ties). */
function heapUp(h: InstantSample[], j: number, less: (a: InstantSample, b: InstantSample) => boolean): void {
  for (;;) {
    const i = Math.trunc((j - 1) / 2);
    if (i === j || !less(h[j]!, h[i]!)) break;
    [h[i], h[j]] = [h[j]!, h[i]!];
    j = i;
  }
}

function heapDown(h: InstantSample[], i0: number, less: (a: InstantSample, b: InstantSample) => boolean): boolean {
  let i = i0;
  const n = h.length;
  for (;;) {
    const j1 = 2 * i + 1;
    if (j1 >= n) break;
    let j = j1;
    const j2 = j1 + 1;
    if (j2 < n && less(h[j2]!, h[j1]!)) j = j2;
    if (!less(h[j]!, h[i]!)) break;
    [h[i], h[j]] = [h[j]!, h[i]!];
    i = j;
  }
  return i > i0;
}

const lessTop = (a: InstantSample, b: InstantSample) => (Number.isNaN(a.value) ? true : a.value < b.value);
const lessBottom = (a: InstantSample, b: InstantSample) => (Number.isNaN(a.value) ? true : a.value > b.value);

function groupLabels(l: Labels, grouping: string[], without: boolean): Labels {
  if (without) {
    const out: Record<string, string> = {};
    for (const n of labelNames(l)) if (n !== NAME && !grouping.includes(n)) out[n] = l[n]!;
    return out;
  }
  const out: Record<string, string> = {};
  for (const n of labelNames(l)) if (grouping.includes(n)) out[n] = l[n]!;
  return out;
}

function evalAggregate(e: Aggregate, t: number, ctx: EvalContext): Value {
  const input = vectorOf(evalAt(e.expr, t, ctx));
  const param = e.param ? scalarOf(evalAt(e.param, t, ctx)) : 0;
  const groups = new Map<string, Group>();
  const order: Group[] = [];
  let k = 0;
  if (e.op === 'topk' || e.op === 'bottomk') {
    if (!Number.isFinite(param) || Math.abs(param) >= 2 ** 63) err(`Scalar value ${param} overflows int64`, 'generic');
    k = Math.min(Math.trunc(param), input.length);
    if (k < 1) return { type: 'vector', samples: [] };
  }
  for (const s of input) {
    const gl = groupLabels(s.labels, e.grouping, e.without);
    const key = labelsKey(gl);
    let g = groups.get(key);
    const f = s.value;
    if (!g) {
      g = { labels: gl, value: f, mean: f, kahanC: 0, count: 1, incremental: false, values: [f], heap: [s] };
      if (e.op === 'stddev' || e.op === 'stdvar') g.value = 0;
      if (e.op === 'group') g.value = 1;
      groups.set(key, g);
      order.push(g);
      continue;
    }
    switch (e.op) {
      case 'sum':
        [g.value, g.kahanC] = kahanSumInc(f, g.value, g.kahanC);
        break;
      case 'avg': {
        g.count++;
        if (!g.incremental) {
          const [nv, nc] = kahanSumInc(f, g.value, g.kahanC);
          if (Number.isFinite(nv) || Number.isNaN(nv)) {
            g.value = nv;
            g.kahanC = nc;
            break;
          }
          g.incremental = true;
          g.mean = g.value / (g.count - 1);
          g.kahanC /= g.count - 1;
        }
        const q = (g.count - 1) / g.count;
        [g.mean, g.kahanC] = kahanSumInc(f / g.count, q * g.mean, q * g.kahanC);
        break;
      }
      case 'max':
        if (g.value < f || Number.isNaN(g.value)) g.value = f;
        break;
      case 'min':
        if (g.value > f || Number.isNaN(g.value)) g.value = f;
        break;
      case 'count':
        g.count++;
        break;
      case 'group':
        break;
      case 'stddev':
      case 'stdvar': {
        g.count++;
        const delta = f - g.mean;
        g.mean += delta / g.count;
        g.value += delta * (f - g.mean);
        break;
      }
      case 'quantile':
        g.values.push(f);
        break;
      case 'topk':
        if (g.heap.length < k) {
          g.heap.push(s);
          heapUp(g.heap, g.heap.length - 1, lessTop);
        } else if (g.heap[0]!.value < f || (Number.isNaN(g.heap[0]!.value) && !Number.isNaN(f))) {
          g.heap[0] = s;
          if (k > 1 && !heapDown(g.heap, 0, lessTop)) heapUp(g.heap, 0, lessTop);
        }
        break;
      case 'bottomk':
        if (g.heap.length < k) {
          g.heap.push(s);
          heapUp(g.heap, g.heap.length - 1, lessBottom);
        } else if (g.heap[0]!.value > f || (Number.isNaN(g.heap[0]!.value) && !Number.isNaN(f))) {
          g.heap[0] = s;
          if (k > 1 && !heapDown(g.heap, 0, lessBottom)) heapUp(g.heap, 0, lessBottom);
        }
        break;
    }
  }
  const out: InstantSample[] = [];
  for (const g of order) {
    switch (e.op) {
      case 'topk':
      case 'bottomk': {
        const sorted = [...g.heap].sort((a, b) => (e.op === 'topk' ? (lessTop(b, a) ? -1 : lessTop(a, b) ? 1 : 0) : lessBottom(b, a) ? -1 : lessBottom(a, b) ? 1 : 0));
        out.push(...sorted.map((s) => ({ labels: s.labels, value: s.value })));
        continue;
      }
      case 'avg':
        out.push({ labels: g.labels, value: g.incremental ? g.mean + g.kahanC : g.value / g.count + g.kahanC / g.count });
        continue;
      case 'sum':
        out.push({ labels: g.labels, value: g.value + g.kahanC });
        continue;
      case 'count':
        out.push({ labels: g.labels, value: g.count });
        continue;
      case 'stdvar':
        out.push({ labels: g.labels, value: g.value / g.count });
        continue;
      case 'stddev':
        out.push({ labels: g.labels, value: Math.sqrt(g.value / g.count) });
        continue;
      case 'quantile':
        out.push({ labels: g.labels, value: quantile(param, g.values) });
        continue;
      default:
        out.push({ labels: g.labels, value: g.value });
    }
  }
  return { type: 'vector', samples: out };
}

// ---- Binary operators ------------------------------------------------------------------------

/** Value and keep flag of `l op r` (comparisons keep the left value when true). */
function binopValue(op: BinaryOp, l: number, r: number): [number, boolean] {
  switch (op) {
    case '+':
      return [l + r, true];
    case '-':
      return [l - r, true];
    case '*':
      return [l * r, true];
    case '/':
      return [l / r, true];
    case '%':
      return [goMod(l, r), true];
    case '^':
      return [goPow(l, r), true];
    case 'atan2':
      return [Math.atan2(l, r), true];
    case '==':
      return [l, l === r];
    case '!=':
      return [l, l !== r];
    case '>':
      return [l, l > r];
    case '<':
      return [l, l < r];
    case '>=':
      return [l, l >= r];
    case '<=':
      return [l, l <= r];
    default:
      return err(`operator ${JSON.stringify(op)} not allowed for scalar operations`, 'generic');
  }
}

const dropsName = (op: BinaryOp) => !COMPARISON_OPS.has(op) && !SET_OPS.has(op);

function signature(l: Labels, m: VectorMatching): string {
  if (m.on) {
    const names = [...m.labels].sort();
    return names.map((n) => `${n}\u0000${l[n] ?? ''}`).join('\u0001');
  }
  const skip = new Set([NAME, ...m.labels]);
  return labelNames(l)
    .filter((n) => !skip.has(n))
    .map((n) => `${n}\u0000${l[n]}`)
    .join('\u0001');
}

function matchedLabels(l: Labels, m: VectorMatching): Labels {
  const out: Record<string, string> = {};
  for (const n of labelNames(l)) {
    const inList = m.labels.includes(n);
    if (m.on ? inList : !inList && n !== NAME) out[n] = l[n]!;
  }
  return out;
}

function resultMetric(lhs: Labels, rhs: Labels, op: BinaryOp, m: VectorMatching): Labels {
  const out: Record<string, string> = { ...lhs };
  if (dropsName(op)) delete out[NAME];
  if (m.card === 'one-to-one') {
    if (m.on) {
      for (const n of Object.keys(out)) if (!m.labels.includes(n)) delete out[n];
    } else for (const n of m.labels) delete out[n];
  }
  for (const n of m.include) {
    if (rhs[n]) out[n] = rhs[n]!;
    else delete out[n];
  }
  return makeLabels(out);
}

function vectorBinop(e: Binary, lhs: InstantSample[], rhs: InstantSample[]): InstantSample[] {
  const m = e.matching ?? { card: 'one-to-one', on: false, labels: [], include: [] };
  const op = e.op;
  if (op === 'and' || op === 'or' || op === 'unless') {
    const rs = new Set(rhs.map((s) => signature(s.labels, m)));
    if (op === 'and') return lhs.length && rhs.length ? lhs.filter((s) => rs.has(signature(s.labels, m))) : [];
    if (op === 'unless') return lhs.filter((s) => !rs.has(signature(s.labels, m)));
    const ls = new Set(lhs.map((s) => signature(s.labels, m)));
    return [...lhs, ...rhs.filter((s) => !ls.has(signature(s.labels, m)))];
  }
  if (!lhs.length || !rhs.length) return [];
  let [L, R] = [lhs, rhs];
  if (m.card === 'one-to-many') [L, R] = [rhs, lhs];
  const right = new Map<string, InstantSample>();
  for (const rs of R) {
    const sig = signature(rs.labels, m);
    const dup = right.get(sig);
    if (dup) {
      const side = m.card === 'one-to-many' ? 'left' : 'right';
      err(
        `found duplicate series for the match group ${labelsString(matchedLabels(rs.labels, m))} on the ${side} hand-side of the operation: [${labelsString(rs.labels)}, ${labelsString(dup.labels)}];many-to-many matching not allowed: matching labels must be unique on one side`,
        'manyToMany',
        { side },
      );
    }
    right.set(sig, rs);
  }
  const matched = new Map<string, Set<string> | null>();
  const out: InstantSample[] = [];
  for (const ls of L) {
    const sig = signature(ls.labels, m);
    const rs = right.get(sig);
    if (!rs) continue;
    let [fl, fr] = [ls.value, rs.value];
    if (m.card === 'one-to-many') [fl, fr] = [fr, fl];
    const [raw, keep] = binopValue(op, fl, fr);
    let value = raw;
    if (e.bool) {
      value = keep ? 1 : 0;
    } else if (!keep) continue;
    let metric = resultMetric(ls.labels, rs.labels, op, m);
    if (e.bool) metric = dropName(metric);
    if (m.card === 'one-to-one') {
      if (matched.has(sig)) err('multiple matches for labels: many-to-one matching must be explicit (group_left/group_right)', 'manyToOne');
      matched.set(sig, null);
    } else {
      const ins = labelsKey(metric);
      let set = matched.get(sig);
      if (!set) {
        set = new Set();
        matched.set(sig, set);
      } else if (set.has(ins)) err('multiple matches for labels: grouping labels must ensure unique matches', 'groupingUnique');
      set.add(ins);
    }
    out.push({ labels: metric, value });
  }
  return out;
}

function evalBinary(e: Binary, t: number, ctx: EvalContext): Value {
  const lv = evalAt(e.lhs, t, ctx);
  const rv = evalAt(e.rhs, t, ctx);
  if (lv.type === 'scalar' && rv.type === 'scalar') {
    const [v, keep] = binopValue(e.op, lv.value, rv.value);
    return { type: 'scalar', value: COMPARISON_OPS.has(e.op) ? (keep ? 1 : 0) : v };
  }
  if (lv.type === 'vector' && rv.type === 'vector') return { type: 'vector', samples: noDuplicates(vectorBinop(e, lv.samples, rv.samples)) };
  // Vector and scalar.
  const swap = lv.type === 'scalar';
  const vec = vectorOf(swap ? rv : lv);
  const sc = scalarOf(swap ? lv : rv);
  const out: InstantSample[] = [];
  for (const s of vec) {
    let [l, r] = [s.value, sc];
    if (swap) [l, r] = [r, l];
    let [value, keep] = binopValue(e.op, l, r);
    // A comparison always keeps the vector's value, even when the scalar is on the left.
    if (COMPARISON_OPS.has(e.op) && swap) value = r;
    if (e.bool) {
      value = keep ? 1 : 0;
      keep = true;
    }
    if (!keep) continue;
    out.push({ labels: dropsName(e.op) || e.bool ? dropName(s.labels) : s.labels, value });
  }
  return { type: 'vector', samples: noDuplicates(out) };
}

// ---- Entry points ----------------------------------------------------------------------------

export function evalAt(e: Expr, t: number, ctx: EvalContext): Value {
  switch (e.type) {
    case 'number':
      return { type: 'scalar', value: e.value };
    case 'string':
      return { type: 'string', value: e.value };
    case 'paren':
      return evalAt(e.expr, t, ctx);
    case 'unary': {
      const v = evalAt(e.expr, t, ctx);
      if (e.op === '+') return v;
      if (v.type === 'scalar') return { type: 'scalar', value: -v.value };
      return { type: 'vector', samples: noDuplicates(vectorOf(v).map((s) => ({ labels: dropName(s.labels), value: -s.value }))) };
    }
    case 'vector':
      return { type: 'vector', samples: evalVectorSelector(e, t, ctx) };
    case 'matrix':
      return { type: 'matrix', series: evalMatrixSelector(e, t, ctx) };
    case 'call':
      return evalCall(e, t, ctx);
    case 'aggregate':
      return evalAggregate(e, t, ctx);
    case 'binary':
      return evalBinary(e, t, ctx);
  }
}

export interface QueryOptions {
  lookback?: number;
}

/** Instant query at time t (ms). Accepts text or a parsed expression. */
export function instantQuery(store: SeriesStore, q: string | Expr, t: number, opts: QueryOptions = {}): Value {
  const e = typeof q === 'string' ? parseExpr(q) : q;
  return evalAt(e, t, { store, start: t, end: t, lookback: opts.lookback ?? DEFAULT_LOOKBACK });
}

export interface RangeResult {
  series: RangeSeries[];
  steps: number[];
}

/** Range query: the expression at start, start+step, … ≤ end. Scalars become one series with no labels. */
export function rangeQuery(store: SeriesStore, q: string | Expr, start: number, end: number, step: number, opts: QueryOptions = {}): RangeResult {
  const e = typeof q === 'string' ? parseExpr(q) : q;
  const ctx: EvalContext = { store, start, end, lookback: opts.lookback ?? DEFAULT_LOOKBACK };
  const byKey = new Map<string, RangeSeries>();
  const steps: number[] = [];
  if (step <= 0) err('zero or negative query resolution step widths are not accepted. Try a positive integer', 'generic');
  for (let t = start; t <= end; t += step) {
    steps.push(t);
    const v = evalAt(e, t, ctx);
    if (v.type === 'matrix' || v.type === 'string') err(`invalid expression type "${v.type === 'matrix' ? 'range vector' : 'string'}" for range query, must be Scalar or instant Vector`, 'rangeQueryType');
    const samples = v.type === 'scalar' ? [{ labels: {}, value: v.value }] : v.samples;
    for (const s of samples) {
      const k = labelsKey(s.labels);
      let ser = byKey.get(k);
      if (!ser) {
        ser = { labels: s.labels, points: [] };
        byKey.set(k, ser);
      }
      ser.points.push({ t, v: s.value });
    }
  }
  const series = [...byKey.values()].sort((a, b) => compareLabels(a.labels, b.labels));
  return { series, steps };
}
