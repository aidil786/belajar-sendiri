// Belajar Sendiri PromQL engine (Prometheus 3 subset): public API. Pure TypeScript, no DOM.
//
//   const b = buildScenario(scenario);                 // series from promtool notation (+ rules)
//   instantQuery(b.store, 'sum by (code) (rate(http_requests_total[5m]))', b.evalTime)
//   rangeQuery(b.store, 'up', 0, b.end, b.interval)     // for graphs
//   runAlertRule(b, { alert, expr, for, labels, annotations }) → inactive/pending/firing timeline
//
// Results match `promtool test rules` (Prometheus 3.13 LTS): npm run verify:promql.
export * from './types';
export * from './ast';
export { parseExpr, goRegex } from './parser';
export {
  NAME,
  labelNames,
  labelsKey,
  compareLabels,
  makeLabels,
  dropName,
  labelsString,
  seriesString,
  formatValue,
  goFloatV,
  goFloatG,
  goFloatF,
  roundTrip,
  parseDuration,
  duration,
  formatDuration,
} from './format';
export { SeriesStore, expandValues, parseSeriesLabels, pointsIn, matcherFn, type InputSeries, type Slot } from './series';
export { instantQuery, rangeQuery, evalAt, DEFAULT_LOOKBACK, type EvalContext, type RangeResult, type QueryOptions } from './eval';
export { evaluateRules, alertsAt, isAlertRule, type AlertRuleDef, type RecordingRuleDef, type RuleDef, type RuleGroupDef, type AlertState, type AlertSnapshot, type AlertTimeline, type RulesResult, type RuleError } from './rules';
export { expandTemplate, checkTemplate, goSprintf } from './template';
export { buildScenario, runAlertRule, timeStops, type ObsScenario, type BuiltScenario, type PromVerify, type PromVerifyExpr, type PromVerifyAlert } from './scenario';
export { kahanSumInc } from './mathx';
export { bucketQuantile, extrapolatedRate } from './functions';
