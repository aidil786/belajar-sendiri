// Observability scenarios: series in promtool's input_series notation, optional rules, and
// `verify` lists that `npm run verify:promql` checks against the real promtool.
import { duration, formatDuration } from './format';
import { evaluateRules, type AlertRuleDef, type RuleGroupDef, type RulesResult } from './rules';
import { SeriesStore, type InputSeries } from './series';

export interface PromVerifyExpr {
  /** A PromQL expression (instant vector or scalar result). */
  expr: string;
  /** Eval times, like promtool's eval_time ('5m', '1h'). */
  at: string[];
  /** The expression is meant to fail: promtool's error text must match the engine's. */
  error?: boolean;
}

export interface PromVerifyAlert {
  alert: AlertRuleDef;
  at: string[];
}

export type PromVerify = PromVerifyExpr | PromVerifyAlert;

export interface ObsScenario {
  id: string;
  /** One line for authors: what this data shows. */
  about?: string;
  /** Scrape interval of the input series (promtool `interval`, default 1m). */
  interval?: string;
  /** Rule evaluation interval (promtool `evaluation_interval`, default 1m). */
  evaluationInterval?: string;
  series: InputSeries[];
  /** Recording / alerting rules that run with the data (their series are queryable). */
  rules?: RuleGroupDef[];
  /** Last time shown in graphs and on the slider (default: the last sample). */
  end?: string;
  /** Where the eval-time slider starts (default: end). */
  evalTime?: string;
  /** Metric names offered as chips (default: every name in the data). */
  metrics?: string[];
  verify: PromVerify[];
}

export interface BuiltScenario {
  scenario: ObsScenario;
  /** Input series plus everything the scenario's rules recorded (and ALERTS). */
  store: SeriesStore;
  /** Only the input series (rules added by a learner start from here). */
  input: SeriesStore;
  interval: number;
  evalInterval: number;
  end: number;
  evalTime: number;
  rules: RulesResult | null;
}

const cache = new Map<string, BuiltScenario>();

export function buildScenario(sc: ObsScenario): BuiltScenario {
  const hit = cache.get(sc.id);
  if (hit && hit.scenario === sc) return hit;
  const interval = duration(sc.interval ?? '1m');
  const evalInterval = duration(sc.evaluationInterval ?? '1m');
  const input = SeriesStore.fromInput(sc.series, interval, evalInterval);
  const end = sc.end ? duration(sc.end) : input.lastTime();
  let store = input;
  let rules: RulesResult | null = null;
  if (sc.rules?.length) {
    const r = evaluateRules(input, sc.rules, end, evalInterval);
    store = r.store;
    rules = r.result;
  }
  const built: BuiltScenario = { scenario: sc, store, input, interval, evalInterval, end, evalTime: sc.evalTime ? duration(sc.evalTime) : end, rules };
  cache.set(sc.id, built);
  return built;
}

/** Run extra alert rules (the learner's) on a scenario, after the scenario's own rules. */
export function runAlertRule(b: BuiltScenario, rule: AlertRuleDef, until = b.end) {
  const groups: RuleGroupDef[] = [...(b.scenario.rules ?? []), { name: 'practice', rules: [rule] }];
  const { result } = evaluateRules(b.input, groups, until, b.evalInterval);
  const timeline = result.alerts[result.alerts.length - 1]!;
  return { timeline, errors: result.errors.filter((e) => e.rule === rule.alert), evalTimes: result.evalTimes };
}

/** Slider stops: every scrape interval from 0 to end. */
export function timeStops(b: BuiltScenario): number[] {
  const out: number[] = [];
  for (let t = 0; t <= b.end; t += b.interval) out.push(t);
  return out;
}

export { formatDuration };
