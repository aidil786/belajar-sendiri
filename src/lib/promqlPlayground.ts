// PromQLPlayground logic (pure, unit-tested): run a query on a scenario at an eval time, draw
// the graph data (a range query over the whole scenario), check goals, check MDX props.
import {
  buildScenario,
  duration,
  formatDuration,
  formatValue,
  functionsIn,
  instantQuery,
  labelNames,
  NAME,
  parseDuration,
  parseExpr,
  PromQLError,
  rangeQuery,
  seriesString,
  type BuiltScenario,
  type Expr,
  type Labels,
  type ObsScenario,
  type RangeSeries,
  type Value,
} from '~/engine/promql-sim';

export interface ExpectedSample {
  /** Labels the series must have (the metric name only counts when you write __name__). */
  labels: Record<string, string>;
  value?: number;
  /** Allowed difference, relative to the value (default 1e-6). */
  tolerance?: number;
}

export interface PromGoal {
  /** When the goal is checked (default: the scenario's eval time). */
  at?: string;
  /** Exactly this many series (a scalar counts as 1). */
  resultCount?: number;
  /** Exactly these series (labels, and values within tolerance), in any order. */
  resultEquals?: ExpectedSample[];
  /** At least these series. */
  resultIncludes?: ExpectedSample[];
  /** Every series has exactly these label names (the metric name aside). */
  labelNames?: string[];
  resultType?: 'vector' | 'scalar' | 'matrix';
  /** Functions or aggregations the query must use (rate, sum, histogram_quantile …). */
  usesFunction?: string[];
  /** A regex the typed query must match. */
  typed?: string;
}

export const GOAL_KEYS = ['at', 'resultCount', 'resultEquals', 'resultIncludes', 'labelNames', 'resultType', 'usesFunction', 'typed'] as const;

export interface QueryError {
  message: string;
  key: string;
  params: Record<string, string | number>;
  /** Real Prometheus would run it; the practice engine can't (yet). */
  engineLimit: boolean;
}

export interface GraphData {
  series: RangeSeries[];
  steps: number[];
}

export interface QueryRun {
  query: string;
  expr?: Expr;
  error?: QueryError;
  /** The instant result at `t`. */
  value?: Value;
  t: number;
  /** Range query over the whole scenario, or why there is no graph. */
  graph?: GraphData;
  graphNote?: 'matrix' | 'string' | 'error';
  functions: string[];
}

function toError(e: unknown): QueryError {
  if (e instanceof PromQLError) return { message: e.message, key: e.key, params: e.params, engineLimit: e.key === 'engineLimit' };
  return { message: (e as Error).message, key: 'generic', params: {}, engineLimit: false };
}

/** Parse and run a query at time t; also the graph data (unless `graph` is false). */
export function runQuery(b: BuiltScenario, query: string, t: number, graph = true): QueryRun {
  const run: QueryRun = { query, t, functions: [] };
  let expr: Expr;
  try {
    expr = parseExpr(query);
  } catch (e) {
    run.error = toError(e);
    return run;
  }
  run.expr = expr;
  run.functions = [...functionsIn(expr)].sort();
  try {
    run.value = instantQuery(b.store, expr, t);
  } catch (e) {
    run.error = toError(e);
    return run;
  }
  if (!graph) return run;
  if (run.value.type === 'matrix' || run.value.type === 'string') {
    run.graphNote = run.value.type;
    return run;
  }
  try {
    run.graph = rangeQuery(b.store, expr, 0, b.end, b.interval);
  } catch {
    run.graphNote = 'error';
  }
  return run;
}

/** One row of the result table. */
export interface ResultRow {
  key: string;
  series: string;
  labels: Labels;
  /** The value (or, for a range vector, "v @t" pairs). */
  value: string;
  values?: { t: string; v: string }[];
}

export function resultRows(v: Value): ResultRow[] {
  switch (v.type) {
    case 'scalar':
      return [{ key: 'scalar', series: 'scalar', labels: {}, value: formatValue(v.value) }];
    case 'string':
      return [{ key: 'string', series: 'string', labels: {}, value: v.value }];
    case 'vector':
      return v.samples.map((s, i) => ({ key: `${i}`, series: seriesString(s.labels), labels: s.labels, value: formatValue(s.value) }));
    case 'matrix':
      return v.series.map((s, i) => ({
        key: `${i}`,
        series: seriesString(s.labels),
        labels: s.labels,
        value: s.points.map((p) => `${formatValue(p.v)} @${formatDuration(p.t)}`).join(' · '),
        values: s.points.map((p) => ({ t: formatDuration(p.t), v: formatValue(p.v) })),
      }));
  }
}

export function resultCount(v: Value): number {
  return v.type === 'vector' ? v.samples.length : v.type === 'matrix' ? v.series.length : 1;
}

// ---- Goals -----------------------------------------------------------------------------------

export interface GoalMiss {
  /** i18n key under promql.miss.* */
  key: string;
  params?: Record<string, string | number>;
}

function sampleList(v: Value): { labels: Labels; value: number }[] {
  if (v.type === 'scalar') return [{ labels: {}, value: v.value }];
  if (v.type === 'vector') return v.samples;
  if (v.type === 'matrix') return v.series.map((s) => ({ labels: s.labels, value: s.points[s.points.length - 1]?.v ?? NaN }));
  return [];
}

function labelsMatch(have: Labels, want: Record<string, string>): boolean {
  const names = new Set([...labelNames(have).filter((n) => n !== NAME || NAME in want), ...Object.keys(want)]);
  for (const n of names) if ((have[n] ?? '') !== (want[n] ?? '')) return false;
  return true;
}

function valueClose(got: number, want: number, tol = 1e-6): boolean {
  if (Number.isNaN(want)) return Number.isNaN(got);
  if (!Number.isFinite(want)) return got === want;
  return Math.abs(got - want) <= tol * Math.max(1, Math.abs(want));
}

function findSample(list: { labels: Labels; value: number }[], e: ExpectedSample) {
  return list.find((s) => labelsMatch(s.labels, e.labels));
}

const showLabels = (l: Record<string, string>) => seriesString(l) || '{}';

/** Check a goal against a query run made at the goal's time. The first miss explains itself. */
export function checkPromGoal(run: QueryRun, goal: PromGoal): { ok: boolean; miss?: GoalMiss } {
  const miss = (key: string, params?: Record<string, string | number>) => ({ ok: false, miss: { key, params } });
  if (goal.typed && !new RegExp(goal.typed).test(run.query)) return miss('typed');
  if (run.error || !run.value) return miss('error');
  for (const f of goal.usesFunction ?? []) if (!run.functions.includes(f)) return miss('function', { name: f });
  if (goal.resultType && run.value.type !== goal.resultType) return miss('type', { want: goal.resultType, got: run.value.type });
  const list = sampleList(run.value);
  if (goal.resultCount !== undefined && list.length !== goal.resultCount) return miss(list.length === 0 ? 'empty' : 'count', { got: list.length, want: goal.resultCount });
  if (goal.labelNames) {
    const want = [...goal.labelNames].sort().join(', ');
    for (const s of list) {
      const got = labelNames(s.labels)
        .filter((n) => n !== NAME)
        .join(', ');
      if (got !== want) return miss('labelNames', { got: got || '—', want: want || '—' });
    }
  }
  const checkList = (items: ExpectedSample[]) => {
    for (const e of items) {
      const s = findSample(list, e);
      if (!s) return miss(list.length === 0 ? 'empty' : 'missingSeries', { series: showLabels(e.labels) });
      if (e.value !== undefined && !valueClose(s.value, e.value, e.tolerance)) return miss('value', { series: showLabels(e.labels), got: formatValue(s.value), want: formatValue(e.value) });
    }
    return null;
  };
  if (goal.resultIncludes) {
    const m = checkList(goal.resultIncludes);
    if (m) return m;
  }
  if (goal.resultEquals) {
    const m = checkList(goal.resultEquals);
    if (m) return m;
    if (list.length !== goal.resultEquals.length) {
      const extra = list.find((s) => !goal.resultEquals!.some((e) => labelsMatch(s.labels, e.labels)));
      return miss('extraSeries', { series: extra ? showLabels(extra.labels) : '', got: list.length, want: goal.resultEquals.length });
    }
  }
  if (list.length === 0 && goal.resultCount === undefined) return miss('empty');
  return { ok: true };
}

/** The time a goal is checked at. */
export function goalTime(b: BuiltScenario, goal?: PromGoal): number {
  return goal?.at ? duration(goal.at) : b.evalTime;
}

/** Is the goal met by this query (checked at the goal's own time)? */
export function queryMeetsGoal(b: BuiltScenario, query: string, goal: PromGoal) {
  return checkPromGoal(runQuery(b, query, goalTime(b, goal), false), goal);
}

/** Metric names for the chips: the scenario's list, or every name in the data. */
export function metricChips(b: BuiltScenario, given?: string[]): string[] {
  return given ?? b.scenario.metrics ?? b.store.metricNames().filter((n) => !n.startsWith('ALERTS'));
}

/** Insert a metric name at the caret (or replace a selected name). */
export function insertAt(text: string, start: number, end: number, word: string): { text: string; caret: number } {
  const before = text.slice(0, start);
  const after = text.slice(end);
  return { text: `${before}${word}${after}`, caret: before.length + word.length };
}

// ---- check:mdx -------------------------------------------------------------------------------

/** Problems with PromQLPlayground props (for npm run check:mdx). */
export function checkPlaygroundProps(a: Record<string, unknown>, scenario?: ObsScenario): string[] {
  const out: string[] = [];
  if (!scenario) return ['PromQLPlayground needs an observability scenario'];
  const b = buildScenario(scenario);
  const goal = a.goal as PromGoal | undefined;
  if (a.at !== undefined && parseDuration(String(a.at)) === null) out.push(`at "${String(a.at)}" is not a duration`);
  if (a.metrics !== undefined) {
    const names = new Set(b.store.metricNames());
    for (const m of a.metrics as string[]) if (!names.has(m)) out.push(`metric chip "${m}" is not in scenario ${scenario.id}`);
  }
  if (!goal) return out;
  for (const k of Object.keys(goal)) if (!(GOAL_KEYS as readonly string[]).includes(k)) out.push(`unknown goal key "${k}"`);
  if (goal.at !== undefined && parseDuration(goal.at) === null) out.push(`goal.at "${goal.at}" is not a duration`);
  if (goal.typed) {
    try {
      new RegExp(goal.typed);
    } catch {
      out.push(`goal.typed is not a valid regex: ${goal.typed}`);
    }
  }
  if (out.length) return out;
  if (queryMeetsGoal(b, String(a.initial ?? ''), goal).ok) out.push('the goal is already met by the starting query');
  if (typeof a.solution !== 'string') out.push('add a `solution` query (never shown) so the goal is checked');
  else {
    const r = queryMeetsGoal(b, a.solution, goal);
    if (!r.ok) out.push(`the solution "${a.solution}" does not meet the goal (${r.miss?.key ?? '?'} ${JSON.stringify(r.miss?.params ?? {})})`);
  }
  return out;
}
