import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { buildScenario, formatDuration, type ObsScenario } from '~/engine/promql-sim';
import { scenarios } from '~/content/courses/observability/scenarios';
import en from '~/i18n/en.json';
import ms from '~/i18n/ms.json';
import {
  ALERT_GOAL_KEYS,
  alertsAtTime,
  buildRule,
  checkAlertGoal,
  checkBuilderProps,
  defaultChoice,
  firingStretches,
  graphFor,
  ruleYaml,
  runBuilder,
  segments,
  yamlScalar,
  type BuilderSpec,
} from './alertRuleBuilder';
import { formatTick, graphModel, nearestStep, niceTicks } from './promGraph';
import { checkPlaygroundProps, checkPromGoal, goalTime, insertAt, metricChips, queryMeetsGoal, resultRows, runQuery } from './promqlPlayground';

const M = 60_000;
const sc = (id: string) => scenarios[id] as ObsScenario;

describe('PromQLPlayground logic', () => {
  const b = buildScenario(sc('o2-shop-requests'));

  it('runs a query at a time, with graph data over the whole scenario', () => {
    const r = runQuery(b, 'sum by (code) (rate(http_requests_total[5m]))', 10 * M);
    expect(r.error).toBeUndefined();
    expect(r.functions).toEqual(['rate', 'sum']);
    expect(r.value?.type).toBe('vector');
    expect(r.graph?.steps).toHaveLength(31);
    expect(r.graph?.series.map((s) => s.labels.code)).toEqual(['200', '404', '500']);
  });

  it('shows Prometheus words and the plain key for mistakes', () => {
    const r = runQuery(b, 'rate(http_requests_total)', 10 * M);
    expect(r.error).toMatchObject({ key: 'wrongType', engineLimit: false });
    expect(r.error?.message).toMatch(/^1:6: parse error: expected type range vector/);
    expect(runQuery(b, 'max_over_time(rate(x[5m])[1h:1m])', 0).error?.engineLimit).toBe(true);
  });

  it('a range vector has a table but no graph', () => {
    const r = runQuery(b, 'http_requests_total{code="404"}[3m]', 10 * M);
    expect(r.graphNote).toBe('matrix');
    expect(resultRows(r.value!)[0]).toMatchObject({ series: 'http_requests_total{code="404", instance="shop-2", job="shop"}', value: '8 @8m · 9 @9m · 10 @10m' });
  });

  it('result rows print values like the Prometheus UI', () => {
    expect(resultRows(runQuery(b, 'rate(http_requests_total{code="404"}[5m])', 10 * M).value!)[0]!.value).toBe('0.016666666666666666');
    expect(resultRows(runQuery(b, '1 / 0', 0).value!)[0]).toMatchObject({ series: 'scalar', value: '+Inf' });
  });

  it('checks goals and explains the first miss', () => {
    const goal = { usesFunction: ['rate', 'sum'], labelNames: ['code'], resultCount: 3 };
    const at = (q: string) => checkPromGoal(runQuery(b, q, 10 * M, false), goal);
    expect(at('http_requests_total').miss).toEqual({ key: 'function', params: { name: 'rate' } });
    expect(at('rate(http_requests_total[5m])').miss).toEqual({ key: 'function', params: { name: 'sum' } });
    expect(at('sum(rate(http_requests_total[5m]))').miss).toEqual({ key: 'count', params: { got: 1, want: 3 } });
    expect(at('sum by (code, job) (rate(http_requests_total[5m]))').miss?.key).toBe('count');
    expect(at('sum by (instance) (rate(http_requests_total[5m]))').miss).toEqual({ key: 'labelNames', params: { got: 'instance', want: 'code' } });
    expect(at('sum by (code) (rate(http_requests_total[5m]))').ok).toBe(true);
    expect(at('rate(http_requests_total)').miss?.key).toBe('error');
  });

  it('resultEquals compares labels (the name only if you write it) and values within tolerance', () => {
    const goal = { resultEquals: [{ labels: { instance: 'shop-1' }, value: 63, tolerance: 0.001 }, { labels: { instance: 'shop-2' }, value: 127 }, { labels: { instance: 'admin-1' }, value: 10 }] };
    const at = (q: string) => checkPromGoal(runQuery(b, q, 10 * M, false), goal);
    expect(at('sum by (instance) (rate(http_requests_total[5m])) * 60').ok).toBe(true);
    expect(at('sum by (instance) (rate(http_requests_total[5m]))').miss?.key).toBe('value');
    expect(at('sum by (instance) (rate(http_requests_total{job="shop"}[5m])) * 60').miss).toEqual({ key: 'missingSeries', params: { series: '{instance="admin-1"}' } });
    expect(checkPromGoal(runQuery(b, 'sum by (instance, job) (rate(http_requests_total[5m])) * 60', 10 * M), { resultIncludes: [{ labels: { instance: 'shop-1', job: 'shop' }, value: 63 }] }).ok).toBe(true);
    expect(checkPromGoal(runQuery(b, 'nothing_here', 10 * M), { resultType: 'vector' }).miss?.key).toBe('empty');
  });

  it('a goal is checked at its own time', () => {
    const goal = { at: '20m', resultCount: 1 };
    expect(goalTime(b, goal)).toBe(20 * M);
    expect(goalTime(b)).toBe(b.evalTime);
    expect(queryMeetsGoal(b, 'http_requests_total{code="500", instance="shop-1"}', goal).ok).toBe(true);
  });

  it('metric chips and inserting a name at the caret', () => {
    expect(metricChips(b)).toEqual(['http_requests_total']);
    expect(metricChips(buildScenario(sc('o2-node')))).toContain('node_load1');
    expect(insertAt('rate([5m])', 5, 5, 'up')).toEqual({ text: 'rate(up[5m])', caret: 7 });
  });

  it('check:mdx props: goal keys, not met at the start, solution works', () => {
    const ok = { scenario: 'o2-shop-requests', initial: 'http_requests_total', goal: { usesFunction: ['rate', 'sum'], labelNames: ['code'], resultCount: 3 }, solution: 'sum by (code) (rate(http_requests_total[5m]))' };
    expect(checkPlaygroundProps(ok, sc('o2-shop-requests'))).toEqual([]);
    expect(checkPlaygroundProps({ ...ok, goal: { ...ok.goal, nope: 1 } }, sc('o2-shop-requests'))).toEqual(['unknown goal key "nope"']);
    expect(checkPlaygroundProps({ ...ok, initial: ok.solution }, sc('o2-shop-requests'))).toContain('the goal is already met by the starting query');
    expect(checkPlaygroundProps({ ...ok, solution: 'up' }, sc('o2-shop-requests'))[0]).toMatch(/does not meet the goal/);
    expect(checkPlaygroundProps({ ...ok, metrics: ['nope_total'] }, sc('o2-shop-requests'))).toEqual(['metric chip "nope_total" is not in scenario o2-shop-requests']);
    expect(checkPlaygroundProps(ok, undefined)).toEqual(['PromQLPlayground needs an observability scenario']);
  });

  it('the dev page latency demo is sound', () => {
    expect(
      checkPlaygroundProps(
        {
          initial: 'http_request_duration_seconds_bucket',
          goal: { at: '18m', usesFunction: ['histogram_quantile', 'rate'], resultCount: 1, labelNames: [] },
          solution: 'histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket[5m])))',
        },
        sc('o2-latency'),
      ),
    ).toEqual([]);
  });
});

describe('graph geometry', () => {
  it('nice ticks and compact labels', () => {
    expect(niceTicks(0, 10)).toEqual([0, 2.5, 5, 7.5, 10]);
    expect(niceTicks(0, 0.17)).toEqual([0, 0.05, 0.1, 0.15, 0.2]);
    expect(niceTicks(3, 3)).toEqual([1, 2, 3, 4, 5]);
    expect(formatTick(1500)).toBe('1500');
    expect(formatTick(25_000)).toBe('25K');
    expect(formatTick(4_500_000_000)).toBe('4.5G');
    expect(formatTick(0.1 + 0.2)).toBe('0.3');
  });

  it('breaks lines where a series has no value; colours up to six series', () => {
    const steps = [0, M, 2 * M, 3 * M];
    const m = graphModel([{ labels: { a: '1' }, points: [{ t: 0, v: 1 }, { t: M, v: 2 }, { t: 3 * M, v: 4 }] }], steps);
    expect(m.lines[0]!.d.match(/M/g)).toHaveLength(2);
    expect(m.lines[0]!.slot).toBe(1);
    const many = graphModel(Array.from({ length: 7 }, (_, i) => ({ labels: { i: String(i) }, points: [{ t: 0, v: i }] })), steps);
    expect(many.lines.every((l) => l.slot === 0)).toBe(true);
    expect(m.xTicks.map((x) => x.label)).toEqual(['0s', '1m', '2m', '3m']);
    expect(nearestStep(steps, 100_000)).toBe(2 * M);
  });
});

describe('AlertRuleBuilder logic', () => {
  const down = buildScenario(sc('o3-target-down'));
  const spec: BuilderSpec = {
    name: 'InstanceDown',
    exprs: [{ expr: 'up == 0' }, { expr: 'up == 1', why: 'true when fine' }],
    fors: ['0s', '1m', '5m'],
    labels: [{ labels: {} }, { labels: { severity: 'page' } }],
    annotations: [{ annotations: { summary: 'Something is down' } }, { annotations: { summary: '{{ $labels.instance }} is down' } }],
  };
  const goal = { firingAt: ['20m'], quietAt: ['7m'], noFlap: true, firingLabels: { instance: 'shop-1' }, labels: { severity: 'page' }, annotationUses: ['$labels.instance'] };

  it('builds the rule and its YAML (quoted only when needed)', () => {
    const rule = buildRule(spec, defaultChoice(spec, { for: 2, labels: 1, annotations: 1 }));
    expect(rule).toEqual({ alert: 'InstanceDown', expr: 'up == 0', for: '5m', labels: { severity: 'page' }, annotations: { summary: '{{ $labels.instance }} is down' } });
    const yaml = ruleYaml(rule);
    expect(yaml).toEqual([
      'groups:',
      '  - name: kedai',
      '    rules:',
      '      - alert: InstanceDown',
      '        expr: up == 0',
      '        for: 5m',
      '        labels:',
      '          severity: page',
      '        annotations:',
      '          summary: "{{ $labels.instance }} is down"',
    ]);
    // It is real YAML that says the same thing.
    expect(parseYaml(yaml.join('\n'))).toEqual({ groups: [{ name: 'kedai', rules: [rule] }] });
    expect(yamlScalar('up{job="shop"} == 0')).toBe('up{job="shop"} == 0');
    expect(yamlScalar('a: b')).toBe('"a: b"');
    expect(yamlScalar('yes')).toBe('"yes"');
    expect(yamlScalar('5')).toBe('"5"');
  });

  it('no wait: the 3-minute db-1 blip pages someone too', () => {
    const run = runBuilder(down, spec, defaultChoice(spec));
    expect(run.rows.map((r) => r.name)).toEqual(['{instance="db-1", job="db"}', '{instance="shop-1", job="shop"}']);
    expect(segments(run.rows[0]!, run.evalTimes).filter((s) => s.state !== 'inactive')).toEqual([{ state: 'firing', from: 6 * M, to: 8 * M }]);
    expect(checkAlertGoal(run, goal).miss).toEqual({ key: 'firingAt', params: { at: '7m' } });
  });

  it('for: 5m waits out the blip; the right blocks meet the goal', () => {
    const run = runBuilder(down, spec, defaultChoice(spec, { for: 2, labels: 1, annotations: 1 }));
    expect(run.rows).toHaveLength(2);
    expect(run.rows[0]!.cells.includes('firing')).toBe(false);
    expect(checkAlertGoal(run, goal).ok).toBe(true);
    const at16 = alertsAtTime(run, 16 * M);
    expect(at16).toMatchObject([{ state: 'firing', annotations: { summary: 'shop-1 is down' } }]);
  });

  it('explains other misses kindly', () => {
    const quiet = runBuilder(down, spec, defaultChoice(spec, { expr: 1, for: 0 }));
    expect(checkAlertGoal(quiet, { firingAt: ['20m'], quietAt: ['7m'] }).miss).toEqual({ key: 'firingAt', params: { at: '7m' } });
    const neverSpec = { ...spec, exprs: [{ expr: 'up > 5' }] };
    expect(checkAlertGoal(runBuilder(down, neverSpec, defaultChoice(neverSpec)), goal).miss).toEqual({ key: 'neverFires', params: { at: '20m' } });
    const ok = runBuilder(down, spec, defaultChoice(spec, { for: 2 }));
    expect(checkAlertGoal(ok, goal).miss).toEqual({ key: 'labels', params: { label: 'severity: page' } });
    expect(checkAlertGoal(runBuilder(down, spec, defaultChoice(spec, { for: 2, labels: 1 })), goal).miss).toEqual({ key: 'annotation', params: { text: '$labels.instance' } });
    expect(checkAlertGoal(ok, { firesBetween: ['20m', '25m'] }).miss).toEqual({ key: 'tooEarly', params: { at: '16m' } });
    expect(checkAlertGoal(ok, { firesBetween: ['1m', '10m'] }).miss).toEqual({ key: 'tooLate', params: { at: '16m' } });
  });

  it('counts flapping', () => {
    const flappy = buildScenario(sc('o3-flappy'));
    const s: BuilderSpec = { exprs: [{ expr: 'kedai_queue_length > 25' }], fors: ['0s', '3m'], keepFiringFor: ['0s', '5m'] };
    const noWait = runBuilder(flappy, s, defaultChoice(s));
    expect(firingStretches(noWait.rows[0]!)).toBe(5);
    expect(checkAlertGoal(noWait, { noFlap: true }).miss?.key).toBe('flaps');
    const wait = runBuilder(flappy, s, defaultChoice(s, { for: 1 }));
    expect(firingStretches(wait.rows[0]!)).toBe(1);
    expect(segments(wait.rows[0]!, wait.evalTimes).filter((x) => x.state === 'firing').map((x) => [formatDuration(x.from), formatDuration(x.to)])).toEqual([['12m', '15m']]);
    const keep = runBuilder(flappy, s, defaultChoice(s, { for: 1, keep: 1 }));
    expect(keep.rule.keep_firing_for).toBe('5m');
    // keep_firing_for holds it 5m after each clear; the 21m spike starts that wait again.
    expect(segments(keep.rows[0]!, keep.evalTimes).filter((x) => x.state === 'firing').map((x) => [formatDuration(x.from), formatDuration(x.to)])).toEqual([['12m', '26m']]);
  });

  it('graphs the value behind `x > number`', () => {
    expect(graphFor({ expr: 'kedai_queue_length > 25' })).toEqual({ expr: 'kedai_queue_length', threshold: 25 });
    expect(graphFor({ expr: '(avg_over_time(q[5m])) >= 0.5' })).toEqual({ expr: '(avg_over_time(q[5m]))', threshold: 0.5 });
    expect(graphFor({ expr: '0.5 < q' })).toEqual({ expr: 'q', threshold: 0.5 });
    expect(graphFor({ expr: 'up == 0 and up offset 1m == 0' })).toEqual({ expr: 'up == 0 and up offset 1m == 0' });
    expect(graphFor({ expr: 'x', graph: 'y', threshold: 1 })).toEqual({ expr: 'y', threshold: 1 });
  });

  it('check:mdx props for both dev page demos, and the problems it catches', () => {
    const props = { scenario: 'o3-target-down', alert: 'InstanceDown', exprs: spec.exprs, fors: spec.fors, labels: spec.labels, annotations: spec.annotations, goal, solution: { expr: 0, for: 2, labels: 1, annotations: 1 } };
    expect(checkBuilderProps(props, sc('o3-target-down'))).toEqual([]);
    expect(
      checkBuilderProps({ alert: 'QueueLong', exprs: [{ expr: 'kedai_queue_length > 25' }, { expr: 'avg_over_time(kedai_queue_length[5m]) > 25' }], fors: ['0s', '3m'], keepFiringFor: ['0s', '5m'], goal: { noFlap: true, firingAt: ['13m'], quietAt: ['4m'] }, solution: { expr: 0, for: 1 } }, sc('o3-flappy')),
    ).toEqual([]);
    expect(checkBuilderProps({ ...props, solution: { expr: 0 } }, sc('o3-target-down'))[0]).toMatch(/solution blocks do not meet the goal/);
    expect(checkBuilderProps({ ...props, start: props.solution }, sc('o3-target-down'))).toContain('the goal is already met by the starting blocks');
    expect(checkBuilderProps({ ...props, exprs: [{ expr: 'up ==' }] }, sc('o3-target-down'))[0]).toMatch(/exprs\[0\] does not parse/);
    expect(checkBuilderProps({ ...props, annotations: [{ annotations: { s: '{{ if 1 }}x{{ end }}' } }] }, sc('o3-target-down'))[0]).toMatch(/annotations\[0\]\.s/);
    expect(checkBuilderProps({ ...props, goal: { ...goal, ringsAt: '1m' } }, sc('o3-target-down'))).toContain('unknown goal key "ringsAt"');
    expect(ALERT_GOAL_KEYS).toContain('noFlap');
  });
});

describe('UI words', () => {
  const dict = en as Record<string, string>;
  it('every error and miss key the engine and libs can produce has words in EN and MS', () => {
    const keys = new Set<string>();
    const files = [...readdirSync('src/engine/promql-sim').filter((f) => f.endsWith('.ts')).map((f) => `src/engine/promql-sim/${f}`), 'src/lib/promqlPlayground.ts', 'src/lib/alertRuleBuilder.ts'];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/new PromQLError\([^;]*?, '([a-zA-Z]+)'/g)) keys.add(`promql.err.${m[1]}`);
      for (const m of src.matchAll(/(?:fail|err)\([^;]*?, '([a-zA-Z]+)'/g)) keys.add(`promql.err.${m[1]}`);
      if (f.endsWith('promqlPlayground.ts')) for (const m of src.matchAll(/miss\('([a-zA-Z]+)'/g)) keys.add(`promql.miss.${m[1]}`);
      if (f.endsWith('alertRuleBuilder.ts')) for (const m of src.matchAll(/miss\('([a-zA-Z]+)'/g)) keys.add(`promql.alertMiss.${m[1]}`);
    }
    expect(keys.size).toBeGreaterThan(40);
    expect([...keys].filter((k) => !(k in dict))).toEqual([]);
    expect([...keys].filter((k) => !(k in (ms as Record<string, string>)))).toEqual([]);
  });

  it('Malay words are Malaysian (no Indonesian forms)', () => {
    const text = Object.entries(ms as Record<string, string>)
      .filter(([k]) => k.startsWith('promql.'))
      .map(([, v]) => v)
      .join(' ');
    for (const word of [/\bberkas\b/i, /\bunduh\b/i, /\bkata sandi\b/i, /\bpengaturan\b/i, /\bhapus\b/i, /\bkamu\b/i]) expect(text).not.toMatch(word);
  });
});
