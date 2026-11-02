// AlertRuleBuilder logic (pure, unit-tested): build an alerting rule from blocks, run it on a
// scenario (inactive → pending → firing over time), describe the timeline, check goals and props.
import {
  buildScenario,
  checkTemplate,
  duration,
  formatDuration,
  labelsKey,
  parseDuration,
  parseExpr,
  runAlertRule,
  seriesString,
  type AlertRuleDef,
  type AlertSnapshot,
  type AlertTimeline,
  type BuiltScenario,
  type Expr,
  type Labels,
  type ObsScenario,
} from '~/engine/promql-sim';

export interface ExprBlock {
  /** Button text (default: the expression). */
  label?: string;
  expr: string;
  /** Shown after a miss while this block is picked. */
  why?: string;
  /** What to graph above the timeline (default: the left side of `… > number`). */
  graph?: string;
  threshold?: number;
}

export interface LabelsBlock {
  label?: string;
  labels: Record<string, string>;
  why?: string;
}

export interface AnnotationsBlock {
  label?: string;
  annotations: Record<string, string>;
  why?: string;
}

export interface BuilderChoice {
  expr: number;
  for: number;
  keep: number;
  labels: number;
  annotations: number;
}

export interface AlertGoal {
  /** The first firing happens between these times (inclusive). */
  firesBetween?: [string, string];
  /** Nothing fires before this time. */
  quietBefore?: string;
  /** Something is firing at each of these times. */
  firingAt?: string[];
  /** Nothing is firing at these times. */
  quietAt?: string[];
  /** Each alert fires in one stretch, not on-off-on. */
  noFlap?: boolean;
  /** Every alert that fires carries these labels (the right target). */
  firingLabels?: Record<string, string>;
  /** The rule's labels include these. */
  labels?: Record<string, string>;
  /** Text that must appear in an annotation template (e.g. "$labels.instance"). */
  annotationUses?: string[];
}

export const ALERT_GOAL_KEYS = ['firesBetween', 'quietBefore', 'firingAt', 'quietAt', 'noFlap', 'firingLabels', 'labels', 'annotationUses'] as const;

export interface BuilderSpec {
  name?: string;
  exprs: ExprBlock[];
  fors?: string[];
  keepFiringFor?: string[];
  labels?: LabelsBlock[];
  annotations?: AnnotationsBlock[];
}

export const DEFAULT_FORS = ['0s', '1m', '5m'];

/** The blocks picked at the start (indexes kept inside each list). */
export function defaultChoice(spec: BuilderSpec, start?: Partial<BuilderChoice>): BuilderChoice {
  const c = { expr: 0, for: 0, keep: 0, labels: 0, annotations: 0, ...start };
  const fit = (i: number, n: number) => Math.max(0, Math.min(i, Math.max(0, n - 1)));
  return {
    expr: fit(c.expr, spec.exprs.length),
    for: fit(c.for, (spec.fors ?? DEFAULT_FORS).length),
    keep: fit(c.keep, spec.keepFiringFor?.length ?? 0),
    labels: fit(c.labels, spec.labels?.length ?? 0),
    annotations: fit(c.annotations, spec.annotations?.length ?? 0),
  };
}

/** The rule the blocks make. */
export function buildRule(spec: BuilderSpec, c: BuilderChoice): AlertRuleDef {
  const fors = spec.fors ?? DEFAULT_FORS;
  const rule: AlertRuleDef = { alert: spec.name ?? 'KedaiAlert', expr: spec.exprs[c.expr]?.expr ?? spec.exprs[0]!.expr };
  const f = fors[c.for] ?? fors[0]!;
  if (duration(f) > 0) rule.for = f;
  const keep = spec.keepFiringFor?.[c.keep];
  if (keep && duration(keep) > 0) rule.keep_firing_for = keep;
  const labels = spec.labels?.[c.labels]?.labels;
  if (labels && Object.keys(labels).length) rule.labels = { ...labels };
  const ann = spec.annotations?.[c.annotations]?.annotations;
  if (ann && Object.keys(ann).length) rule.annotations = { ...ann };
  return rule;
}

/** A YAML scalar, quoted only when YAML needs it. */
export function yamlScalar(s: string): string {
  const plain = /^[A-Za-z0-9_(][^\n]*$/.test(s) && !/: |\s#|^(true|false|yes|no|null|on|off|~)$/i.test(s) && !/[\s:]$/.test(s) && Number.isNaN(Number(s));
  return plain ? s : JSON.stringify(s);
}

/** The rule as it would sit in a Prometheus rules file (one group). */
export function ruleYaml(rule: AlertRuleDef, group = 'kedai'): string[] {
  const out = ['groups:', `  - name: ${group}`, '    rules:', `      - alert: ${rule.alert}`, `        expr: ${yamlScalar(rule.expr)}`];
  if (rule.for) out.push(`        for: ${rule.for}`);
  if (rule.keep_firing_for) out.push(`        keep_firing_for: ${rule.keep_firing_for}`);
  for (const key of ['labels', 'annotations'] as const) {
    const m = rule[key];
    if (!m || !Object.keys(m).length) continue;
    out.push(`        ${key}:`);
    for (const [k, v] of Object.entries(m)) out.push(`          ${k}: ${yamlScalar(v)}`);
  }
  return out;
}

export type CellState = 'inactive' | 'pending' | 'firing';

export interface TimelineRow {
  key: string;
  labels: Labels;
  /** The alert's labels without alertname, as text. */
  name: string;
  cells: CellState[];
}

export interface BuilderRun {
  rule: AlertRuleDef;
  evalTimes: number[];
  timeline: AlertTimeline;
  rows: TimelineRow[];
  error?: string;
}

function rowName(l: Labels): string {
  const rest: Record<string, string> = { ...l };
  delete rest.alertname;
  return seriesString(rest) || '{}';
}

export function timelineRows(tl: AlertTimeline, evalTimes: number[]): TimelineRow[] {
  const rows = new Map<string, TimelineRow>();
  tl.evals.forEach((e, i) => {
    for (const a of e.alerts) {
      const k = labelsKey(a.labels);
      let r = rows.get(k);
      if (!r) {
        r = { key: k, labels: a.labels, name: rowName(a.labels), cells: evalTimes.map(() => 'inactive') };
        rows.set(k, r);
      }
      r.cells[i] = a.state;
    }
  });
  return [...rows.values()];
}

export function runBuilder(b: BuiltScenario, spec: BuilderSpec, c: BuilderChoice): BuilderRun {
  const rule = buildRule(spec, c);
  const r = runAlertRule(b, rule);
  return { rule, evalTimes: r.evalTimes, timeline: r.timeline, rows: timelineRows(r.timeline, r.evalTimes), error: r.errors[0]?.message };
}

/** Stretches of one state in a row: [{ state, from, to }] (to = last time in the stretch). */
export function segments(row: TimelineRow, evalTimes: number[]): { state: CellState; from: number; to: number }[] {
  const out: { state: CellState; from: number; to: number }[] = [];
  row.cells.forEach((s, i) => {
    const last = out[out.length - 1];
    if (last && last.state === s) last.to = evalTimes[i]!;
    else out.push({ state: s, from: evalTimes[i]!, to: evalTimes[i]! });
  });
  return out;
}

/** How many separate firing stretches a row has. */
export function firingStretches(row: TimelineRow): number {
  let n = 0;
  row.cells.forEach((s, i) => {
    if (s === 'firing' && row.cells[i - 1] !== 'firing') n++;
  });
  return n;
}

export function firstTime(run: BuilderRun, state: CellState): number | null {
  for (let i = 0; i < run.evalTimes.length; i++) if (run.rows.some((r) => r.cells[i] === state)) return run.evalTimes[i]!;
  return null;
}

/** Alerts (pending or firing) at time t: the latest evaluation at or before t. */
export function alertsAtTime(run: BuilderRun, t: number): AlertSnapshot[] {
  let pick: AlertSnapshot[] = [];
  for (const e of run.timeline.evals) {
    if (e.t > t) break;
    pick = e.alerts;
  }
  return pick;
}

function firingAt(run: BuilderRun, t: number): boolean {
  return alertsAtTime(run, t).some((a) => a.state === 'firing');
}

export interface AlertMiss {
  /** i18n key under promql.alertMiss.* */
  key: string;
  params?: Record<string, string | number>;
}

export function checkAlertGoal(run: BuilderRun, goal: AlertGoal): { ok: boolean; miss?: AlertMiss } {
  const miss = (key: string, params?: Record<string, string | number>) => ({ ok: false, miss: { key, params } });
  if (run.error) return miss('error');
  const first = firstTime(run, 'firing');
  if (goal.firesBetween) {
    const [a, b] = goal.firesBetween.map(duration) as [number, number];
    if (first === null) return miss('neverFires');
    if (first < a) return miss('tooEarly', { at: formatDuration(first) });
    if (first > b) return miss('tooLate', { at: formatDuration(first) });
  }
  if (goal.quietBefore) {
    const q = duration(goal.quietBefore);
    if (first !== null && first < q) return miss('tooEarly', { at: formatDuration(first) });
  }
  // Flapping first: it is the main lesson whenever it happens.
  if (goal.noFlap) {
    const flappy = run.rows.find((r) => firingStretches(r) > 1);
    if (flappy) return miss('flaps', { n: firingStretches(flappy), series: flappy.name });
  }
  for (const t of goal.firingAt ?? []) if (!firingAt(run, duration(t))) return miss(first === null ? 'neverFires' : 'notFiringAt', { at: t });
  for (const t of goal.quietAt ?? []) if (firingAt(run, duration(t))) return miss('firingAt', { at: t });
  if (goal.firingLabels) {
    for (const r of run.rows) {
      if (!r.cells.includes('firing')) continue;
      for (const [k, v] of Object.entries(goal.firingLabels)) if (r.labels[k] !== v) return miss('wrongTarget', { series: r.name });
    }
  }
  if (goal.labels) for (const [k, v] of Object.entries(goal.labels)) if (run.rule.labels?.[k] !== v) return miss('labels', { label: `${k}: ${v}` });
  if (goal.annotationUses) {
    const text = Object.values(run.rule.annotations ?? {}).join('\n');
    for (const u of goal.annotationUses) if (!text.includes(u)) return miss('annotation', { text: u });
  }
  return { ok: true };
}

/** What to graph above the timeline: the block's own graph, or the left side of `x > 0.5`. */
export function graphFor(block: ExprBlock): { expr: string; threshold?: number } | null {
  if (block.graph) return { expr: block.graph, threshold: block.threshold };
  let e: Expr;
  try {
    e = parseExpr(block.expr);
  } catch {
    return null;
  }
  while (e.type === 'paren') e = e.expr;
  if (e.type === 'binary' && ['>', '<', '>=', '<=', '==', '!='].includes(e.op) && !e.bool) {
    const num = (x: Expr): number | null => (x.type === 'number' ? x.value : x.type === 'paren' ? num(x.expr) : null);
    const rv = num(e.rhs);
    if (rv !== null) return { expr: block.expr.slice(e.lhs.pos, e.lhs.end).trim(), threshold: rv };
    const lv = num(e.lhs);
    if (lv !== null) return { expr: block.expr.slice(e.rhs.pos, e.rhs.end).trim(), threshold: lv };
  }
  return { expr: block.expr };
}

// ---- check:mdx -------------------------------------------------------------------------------

export function checkBuilderProps(a: Record<string, unknown>, scenario?: ObsScenario): string[] {
  const out: string[] = [];
  if (!scenario) return ['AlertRuleBuilder needs an observability scenario'];
  const spec = { ...(a as unknown as BuilderSpec), name: a.alert as string | undefined } as BuilderSpec & { goal?: AlertGoal; start?: Partial<BuilderChoice>; solution?: Partial<BuilderChoice> };
  if (!Array.isArray(spec.exprs) || spec.exprs.length === 0) return ['exprs needs at least one block'];
  for (const [i, x] of spec.exprs.entries()) {
    try {
      parseExpr(x.expr);
    } catch (e) {
      out.push(`exprs[${i}] does not parse: ${(e as Error).message}`);
    }
    if (x.graph) {
      try {
        parseExpr(x.graph);
      } catch (e) {
        out.push(`exprs[${i}].graph does not parse: ${(e as Error).message}`);
      }
    }
  }
  for (const f of [...(spec.fors ?? []), ...(spec.keepFiringFor ?? [])]) if (parseDuration(f) === null) out.push(`"${f}" is not a duration`);
  for (const [i, blk] of (spec.annotations ?? []).entries()) {
    for (const [k, v] of Object.entries(blk.annotations)) {
      try {
        checkTemplate(v);
      } catch (e) {
        out.push(`annotations[${i}].${k}: ${(e as Error).message}`);
      }
    }
  }
  for (const [i, blk] of (spec.labels ?? []).entries()) {
    for (const [k, v] of Object.entries(blk.labels)) {
      try {
        checkTemplate(v);
      } catch (e) {
        out.push(`labels[${i}].${k}: ${(e as Error).message}`);
      }
    }
  }
  if (spec.name !== undefined && !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(spec.name)) out.push(`alert "${spec.name}" is not a good alert name (letters, digits, _)`);
  const goal = spec.goal;
  if (goal) for (const k of Object.keys(goal)) if (!(ALERT_GOAL_KEYS as readonly string[]).includes(k)) out.push(`unknown goal key "${k}"`);
  if (out.length || !goal) return out;
  const b = buildScenario(scenario);
  if (checkAlertGoal(runBuilder(b, spec, defaultChoice(spec, spec.start)), goal).ok) out.push('the goal is already met by the starting blocks');
  if (!spec.solution) out.push('add a `solution` (block numbers, never shown) so the goal is checked');
  else {
    const r = checkAlertGoal(runBuilder(b, spec, defaultChoice(spec, spec.solution)), goal);
    if (!r.ok) out.push(`the solution blocks do not meet the goal (${r.miss?.key ?? '?'} ${JSON.stringify(r.miss?.params ?? {})})`);
  }
  if (ruleYaml(buildRule(spec, defaultChoice(spec, spec.solution))).length > 15) out.push('the rule is longer than 15 lines of YAML (Ship It rule 18)');
  return out;
}
