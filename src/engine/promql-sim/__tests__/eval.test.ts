import { describe, expect, it } from 'vitest';
import { instantQuery, rangeQuery } from '../eval';
import { seriesString } from '../format';
import { SeriesStore, type InputSeries } from '../series';
import type { Value } from '../types';

const M = 60_000;

function store(input: InputSeries[]): SeriesStore {
  return SeriesStore.fromInput(input, M);
}

/** Result as "series value" lines (order kept). */
function rows(v: Value): string[] {
  if (v.type === 'scalar') return [`scalar ${v.value}`];
  if (v.type === 'vector') return v.samples.map((s) => `${seriesString(s.labels)} ${s.value}`);
  if (v.type === 'matrix') return v.series.map((s) => `${seriesString(s.labels)} ${s.points.map((p) => p.v).join(',')}`);
  return [`string ${v.value}`];
}

function one(s: SeriesStore, q: string, t: number): number {
  const v = instantQuery(s, q, t);
  if (v.type === 'scalar') return v.value;
  if (v.type !== 'vector' || v.samples.length !== 1) throw new Error(`expected one sample, got ${rows(v).join('; ')}`);
  return v.samples[0]!.value;
}

const counters = store([
  { series: 'c{a="1"}', values: '0+10x10' },
  { series: 'reset{a="1"}', values: '0+10x5 0+10x5' },
]);

describe('selectors', () => {
  const s = store([
    { series: 'g{id="gap"}', values: '1 _x6' },
    { series: 'g{id="stale"}', values: '1 stale' },
    { series: 'g{id="late"}', values: '_ _ 7' },
  ]);

  it('an instant selector looks back 5 minutes, left-open: (t − 5m, t]', () => {
    expect(rows(instantQuery(s, 'g{id="gap"}', 4 * M))).toEqual(['g{id="gap"} 1']);
    expect(rows(instantQuery(s, 'g{id="gap"}', 5 * M))).toEqual([]);
  });

  it('a stale marker ends a series at once', () => {
    expect(rows(instantQuery(s, 'g{id="stale"}', 0))).toEqual(['g{id="stale"} 1']);
    expect(rows(instantQuery(s, 'g{id="stale"}', M))).toEqual([]);
    expect(rows(instantQuery(s, 'g{id="stale"}[5m]', 2 * M))).toEqual(['g{id="stale"} 1']);
  });

  it('matchers: = != =~ !~ (regexes are anchored)', () => {
    expect(rows(instantQuery(s, 'g{id=~"ga"}', 0))).toEqual([]);
    expect(rows(instantQuery(s, 'g{id=~"ga.|st.*"}', 0)).length).toBe(2);
    expect(rows(instantQuery(s, 'g{id!~"gap|stale"}', 2 * M))).toEqual(['g{id="late"} 7']);
    expect(rows(instantQuery(s, 'g{id!="gap"}', 0))).toEqual(['g{id="stale"} 1']);
    expect(rows(instantQuery(s, '{__name__="g", id="late"}', 2 * M))).toEqual(['g{id="late"} 7']);
  });

  it('range selectors are (t − range, t] and skip stale markers', () => {
    expect(rows(instantQuery(counters, 'c[3m]', 5 * M))).toEqual(['c{a="1"} 30,40,50']);
  });

  it('offset and @ move the time the selector looks at', () => {
    expect(one(counters, 'c offset 2m', 5 * M)).toBe(30);
    expect(one(counters, 'c @ 120', 9 * M)).toBe(20);
    expect(one(counters, 'c @ start()', 9 * M)).toBe(90);
    expect(rows(rangeQuery(counters, 'c @ start()', 2 * M, 4 * M, M).series.map((x) => ({ type: 'matrix' as const, series: [x] }))[0]!)).toEqual(['c{a="1"} 20,20,20']);
  });
});

describe('rates of counters', () => {
  it('rate extrapolates to the window edges (Prometheus extrapolatedRate)', () => {
    // 5 samples in (0, 5m]: +40 over 4 minutes, stretched to 5 minutes: 50 / 300 s.
    expect(one(counters, 'rate(c[5m])', 5 * M)).toBeCloseTo(1 / 6, 14);
    expect(one(counters, 'increase(c[5m])', 5 * M)).toBeCloseTo(50, 10);
  });

  it('a counter reset counts as a fresh start, not a drop', () => {
    // 40 50 | 0 10 20: up 10, reset, up 10, up 10 = 30 → stretched to 37.5.
    expect(one(counters, 'increase(reset[5m])', 8 * M)).toBe(37.5);
    expect(one(counters, 'rate(reset[5m])', 8 * M)).toBe(0.125);
    expect(one(counters, 'resets(reset[10m])', 10 * M)).toBe(1);
  });

  it('irate uses the last two samples (and a reset uses the new value)', () => {
    expect(one(counters, 'irate(reset[5m])', 8 * M)).toBeCloseTo(1 / 6, 14);
    expect(one(counters, 'irate(reset[5m])', 6 * M)).toBe(0);
    expect(one(counters, 'idelta(reset[5m])', 6 * M)).toBe(-50);
  });

  it('needs two samples; one sample gives nothing', () => {
    expect(rows(instantQuery(counters, 'rate(c[1m])', 5 * M))).toEqual([]);
    expect(rows(instantQuery(counters, 'rate(c[90s])', 5 * M)).length).toBe(1);
  });

  it('rate drops the metric name; last_over_time keeps it', () => {
    expect(rows(instantQuery(counters, 'rate(c[5m])', 5 * M))[0]).toMatch(/^\{a="1"\} /);
    expect(rows(instantQuery(counters, 'last_over_time(c[5m])', 5 * M))).toEqual(['c{a="1"} 50']);
  });
});

describe('gauges over time', () => {
  const g = store([
    { series: 'line', values: '100-10x10' },
    { series: 'load', values: '1 3 2 5 4' },
  ]);

  it('*_over_time functions', () => {
    expect(one(g, 'avg_over_time(load[5m])', 4 * M)).toBe(3);
    expect(one(g, 'max_over_time(load[5m])', 4 * M)).toBe(5);
    expect(one(g, 'min_over_time(load[3m])', 4 * M)).toBe(2);
    expect(one(g, 'sum_over_time(load[5m])', 4 * M)).toBe(15);
    expect(one(g, 'count_over_time(load[5m])', 4 * M)).toBe(5);
    expect(one(g, 'quantile_over_time(0.5, load[5m])', 4 * M)).toBe(3);
    expect(one(g, 'changes(load[5m])', 4 * M)).toBe(4);
    expect(one(g, 'present_over_time(load[5m])', 4 * M)).toBe(1);
  });

  it('deriv and predict_linear fit a straight line', () => {
    expect(one(g, 'deriv(line[5m])', 5 * M)).toBeCloseTo(-10 / 60, 12);
    expect(one(g, 'predict_linear(line[5m], 600)', 5 * M)).toBeCloseTo(-50, 9);
    expect(one(g, 'delta(line[5m])', 5 * M)).toBeCloseTo(-50, 9);
  });

  it('math functions drop the name and keep labels', () => {
    expect(one(g, 'abs(-load)', 3 * M)).toBe(5);
    expect(one(g, 'round(load / 3)', 3 * M)).toBe(2);
    expect(one(g, 'round(load, 2)', 3 * M)).toBe(6);
    expect(one(g, 'clamp(load, 2, 4)', 3 * M)).toBe(4);
    expect(one(g, 'clamp_min(load, 6)', 3 * M)).toBe(6);
    expect(one(g, 'clamp_max(load, 2)', 3 * M)).toBe(2);
    expect(one(g, 'ceil(load / 2)', 3 * M)).toBe(3);
    expect(one(g, 'floor(load / 2)', 3 * M)).toBe(2);
    expect(one(g, 'sqrt(load * 5)', 3 * M)).toBe(5);
    expect(rows(instantQuery(g, 'clamp(load, 5, 1)', 3 * M))).toEqual([]);
  });
});

describe('histogram_quantile (classic buckets)', () => {
  const h = store([
    { series: 'd_bucket{le="0.1"}', values: '50' },
    { series: 'd_bucket{le="0.5"}', values: '90' },
    { series: 'd_bucket{le="+Inf"}', values: '100' },
  ]);

  it('interpolates inside the bucket that holds the rank', () => {
    expect(one(h, 'histogram_quantile(0.5, d_bucket)', 0)).toBeCloseTo(0.1, 14);
    expect(one(h, 'histogram_quantile(0.9, d_bucket)', 0)).toBeCloseTo(0.5, 14);
    expect(one(h, 'histogram_quantile(0.7, d_bucket)', 0)).toBeCloseTo(0.3, 14);
  });

  it('the +Inf bucket answers with the last finite bound; q outside 0..1 is ±Inf', () => {
    expect(one(h, 'histogram_quantile(0.99, d_bucket)', 0)).toBe(0.5);
    expect(one(h, 'histogram_quantile(2, d_bucket)', 0)).toBe(Infinity);
    expect(one(h, 'histogram_quantile(-1, d_bucket)', 0)).toBe(-Infinity);
  });

  it('drops the name and le; no +Inf bucket gives NaN', () => {
    const v = instantQuery(store([{ series: 'x_bucket{le="1",job="a"}', values: '5' }]), 'histogram_quantile(0.5, x_bucket)', 0);
    expect(rows(v)).toEqual(['{job="a"} NaN']);
  });
});

describe('labels', () => {
  const s = store([{ series: 'orders{stall="nasi-lemak",item="ayam"}', values: '3' }]);
  it('label_replace follows Go: $1x is the group named "1x" (empty), ${1}x works', () => {
    expect(rows(instantQuery(s, 'label_replace(orders, "food", "${1}x", "stall", "(.*)-.*")', 0))).toEqual(['orders{food="nasix", item="ayam", stall="nasi-lemak"} 3']);
    expect(rows(instantQuery(s, 'label_replace(orders, "food", "$1x", "stall", "(.*)-.*")', 0))).toEqual(['orders{item="ayam", stall="nasi-lemak"} 3']);
    expect(rows(instantQuery(s, 'label_replace(orders, "food", "$1", "stall", "roti.*")', 0))).toEqual(['orders{item="ayam", stall="nasi-lemak"} 3']);
  });
  it('label_join joins values with a separator', () => {
    expect(rows(instantQuery(s, 'label_join(orders, "dish", "/", "stall", "item")', 0))).toEqual(['orders{dish="nasi-lemak/ayam", item="ayam", stall="nasi-lemak"} 3']);
  });
  it('absent() gives 1 with the labels the = matchers pin down', () => {
    expect(rows(instantQuery(s, 'absent(orders{stall="roti", item=~"a.*"})', 0))).toEqual(['{stall="roti"} 1']);
    expect(rows(instantQuery(s, 'absent(orders)', 0))).toEqual([]);
    expect(rows(instantQuery(s, 'absent_over_time(nope{job="x"}[5m])', 0))).toEqual(['{job="x"} 1']);
  });
  it('vector, scalar, time, timestamp', () => {
    expect(rows(instantQuery(s, 'vector(2)', 0))).toEqual(['{} 2']);
    expect(one(s, 'scalar(orders)', 0)).toBe(3);
    expect(one(s, 'scalar(nope)', 0)).toBeNaN();
    expect(one(s, 'time()', 90_000)).toBe(90);
    expect(one(s, 'timestamp(orders)', 2 * M)).toBe(0);
  });
});

describe('aggregations', () => {
  const s = store([
    { series: 'r{job="shop",inst="1",code="200"}', values: '6' },
    { series: 'r{job="shop",inst="1",code="500"}', values: '1' },
    { series: 'r{job="shop",inst="2",code="200"}', values: '4' },
    { series: 'r{job="admin",inst="3",code="200"}', values: '4' },
  ]);

  it('sum / avg / min / max / count / group with by and without', () => {
    expect(rows(instantQuery(s, 'sum by (job) (r)', 0))).toEqual(['{job="shop"} 11', '{job="admin"} 4']);
    expect(rows(instantQuery(s, 'sum(r) by (job)', 0))).toEqual(['{job="shop"} 11', '{job="admin"} 4']);
    expect(rows(instantQuery(s, 'sum without (inst, code) (r)', 0))).toEqual(['{job="shop"} 11', '{job="admin"} 4']);
    expect(rows(instantQuery(s, 'avg by (code) (r)', 0))).toEqual(['{code="200"} 4.666666666666667', '{code="500"} 1']);
    expect(one(s, 'max(r)', 0)).toBe(6);
    expect(one(s, 'min(r)', 0)).toBe(1);
    expect(one(s, 'count(r)', 0)).toBe(4);
    expect(rows(instantQuery(s, 'group by (job) (r)', 0))).toEqual(['{job="shop"} 1', '{job="admin"} 1']);
    expect(one(s, 'quantile(0.5, r)', 0)).toBe(4);
    expect(one(s, 'stdvar(r)', 0)).toBeCloseTo(3.1875, 12);
  });

  it('by keeps only listed labels; a label nobody has gives one empty group', () => {
    expect(rows(instantQuery(s, 'sum by (zone) (r)', 0))).toEqual(['{} 15']);
    expect(rows(instantQuery(s, 'sum by (__name__) (r)', 0))).toEqual(['r 15']);
  });

  it('topk / bottomk keep whole series; on a tie the first series (creation order) wins', () => {
    expect(rows(instantQuery(s, 'topk(1, r)', 0))).toEqual(['r{code="200", inst="1", job="shop"} 6']);
    expect(rows(instantQuery(s, 'bottomk(1, r{code="200"})', 0))).toEqual(['r{code="200", inst="2", job="shop"} 4']);
    expect(rows(instantQuery(s, 'topk(2, r)', 0))).toEqual(['r{code="200", inst="1", job="shop"} 6', 'r{code="200", inst="2", job="shop"} 4']);
    expect(rows(instantQuery(s, 'topk by (job) (1, r)', 0)).length).toBe(2);
    expect(rows(instantQuery(s, 'topk(0, r)', 0))).toEqual([]);
  });
});

describe('binary operators and vector matching', () => {
  const s = store([
    { series: 'req{inst="1",code="200"}', values: '90' },
    { series: 'req{inst="1",code="500"}', values: '10' },
    { series: 'req{inst="2",code="200"}', values: '40' },
    { series: 'tot{inst="1"}', values: '100' },
    { series: 'tot{inst="2"}', values: '50' },
    { series: 'info{inst="1",team="kedai"}', values: '1' },
  ]);

  it('arithmetic drops the name; comparisons filter and keep it; bool gives 0/1', () => {
    expect(rows(instantQuery(s, 'tot * 2', 0))).toEqual(['{inst="1"} 200', '{inst="2"} 100']);
    expect(rows(instantQuery(s, 'tot > 60', 0))).toEqual(['tot{inst="1"} 100']);
    expect(rows(instantQuery(s, 'tot > bool 60', 0))).toEqual(['{inst="1"} 1', '{inst="2"} 0']);
    expect(rows(instantQuery(s, '60 < tot', 0))).toEqual(['tot{inst="1"} 100']);
    expect(rows(instantQuery(s, '-tot', 0))).toEqual(['{inst="1"} -100', '{inst="2"} -50']);
    expect(one(s, '2 * 3 ^ 2', 0)).toBe(18);
    expect(one(s, '-2 ^ 2', 0)).toBe(-4);
    expect(one(s, '7 % 3', 0)).toBe(1);
    expect(one(s, '1 < bool 2', 0)).toBe(1);
  });

  it('one-to-one with ignoring / on (on keeps only the on labels)', () => {
    expect(rows(instantQuery(s, 'req{code="500"} / ignoring(code) tot', 0))).toEqual(['{inst="1"} 0.1']);
    expect(rows(instantQuery(s, 'req{code="500"} / on(inst) tot', 0))).toEqual(['{inst="1"} 0.1']);
  });

  it('group_left: many to one, with extra labels from the one side', () => {
    expect(rows(instantQuery(s, 'req / ignoring(code) group_left tot', 0))).toEqual(['{code="200", inst="1"} 0.9', '{code="500", inst="1"} 0.1', '{code="200", inst="2"} 0.8']);
    expect(rows(instantQuery(s, 'tot * on(inst) group_left(team) info', 0))).toEqual(['{inst="1", team="kedai"} 100']);
    expect(rows(instantQuery(s, 'info * on(inst) group_right(team) tot', 0))).toEqual(['{inst="1", team="kedai"} 100']);
  });

  it('refuses ambiguous matches with Prometheus words', () => {
    expect(() => instantQuery(s, 'req / ignoring(code) tot', 0)).toThrow('multiple matches for labels: many-to-one matching must be explicit (group_left/group_right)');
    expect(() => instantQuery(s, 'tot / on(inst) req', 0)).toThrow(/^found duplicate series for the match group \{inst="1"\} on the right hand-side of the operation: \[\{__name__="req", code="500", inst="1"\}, \{__name__="req", code="200", inst="1"\}\];many-to-many/);
    expect(() => instantQuery(s, 'rate({__name__=~"tot|req"}[5m])', M)).not.toThrow();
    expect(() => instantQuery(s, 'abs({__name__=~"tot|info"})', 0)).not.toThrow();
    const dup = store([
      { series: 'a{x="1"}', values: '1' },
      { series: 'b{x="1"}', values: '2' },
    ]);
    expect(() => instantQuery(dup, 'abs({__name__=~"a|b"})', 0)).toThrow('vector cannot contain metrics with the same labelset');
  });

  it('and / or / unless match on labels without the name', () => {
    expect(rows(instantQuery(s, 'tot and on(inst) req{code="500"}', 0))).toEqual(['tot{inst="1"} 100']);
    expect(rows(instantQuery(s, 'tot unless on(inst) req{code="500"}', 0))).toEqual(['tot{inst="2"} 50']);
    expect(rows(instantQuery(s, 'tot{inst="1"} or tot', 0))).toEqual(['tot{inst="1"} 100', 'tot{inst="2"} 50']);
  });
});

describe('range queries (graphs)', () => {
  it('evaluates at each step; series come out sorted by labels', () => {
    const r = rangeQuery(counters, 'c', 0, 3 * M, M);
    expect(r.steps).toEqual([0, M, 2 * M, 3 * M]);
    expect(r.series).toEqual([{ labels: { __name__: 'c', a: '1' }, points: [0, 10, 20, 30].map((v, i) => ({ t: i * M, v })) }]);
  });

  it('a scalar becomes one series without labels; a range vector is refused', () => {
    expect(rangeQuery(counters, 'time()', 0, M, M).series[0]).toEqual({ labels: {}, points: [{ t: 0, v: 0 }, { t: M, v: 60 }] });
    expect(() => rangeQuery(counters, 'c[5m]', 0, M, M)).toThrow(/range query, must be Scalar or instant Vector/);
  });
});
