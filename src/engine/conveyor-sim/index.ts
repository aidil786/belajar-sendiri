// FahamLah conveyor simulator (CI/CD pipelines): public API.
//
//   const { workflow, issues } = parseWorkflow(yaml);       // kind validation, with lines
//   const r = simulate(yaml, { trigger: presetTrigger('pr'), world });
//   r.status → 'success' | 'failure' | 'cancelled' | 'waiting' | 'notTriggered' | 'invalid'
//   r.jobs   → jobs and matrix legs, with steps, logs and fake-clock times
//   r.events → runQueued, matrixSplit, jobStarted, stepStarted/Passed/Failed/Skipped,
//              cacheHit/Miss, artifactUploaded, approvalWaiting, runFinished…
//   auditWorkflow(yaml) → security holes with line numbers (Spot the hole)
//   beltLayout(workflow), viewAt(result, n), stationView(...) → what the belt draws
export * from './types';
export { parseWorkflow, canRun, EVENTS, PERMISSION_SCOPES } from './parse';
export { simulate, expandMatrix, legKey, jobOrder, tokenPermissions, DEFAULT_SHA, type RunOptions } from './simulate';
export { presetTrigger, matchTrigger, refOf, PRESETS, type PresetOptions, type TriggerMatch } from './events';
export { evaluate, evalIf, interpolate, exprError, expressionsIn, truthy, toStr, type Value, type ExprContext } from './expr';
export { globMatch, globToRegExp, matchList } from './glob';
export { KNOWN_ACTIONS, RUNNER_LABELS, GITHUB_OWNERS, parseUses, isFullSha, kindOf, stepKind, type KnownAction, type StationKind } from './actions';
export { auditWorkflow, type Hole, type HoleKind, type AuditOptions } from './audit';
export { beltLayout, viewAt, stationView, firstFailedStation, stations, type BeltLayout, type Station, type StationView, type RunView, type JobView, type Lane, type Live } from './belt';
export { runScenario, scenarioTrigger, replaceLines, linesOf, DEFAULT_EVENTS, type ConveyorScenario, type ScenarioRunOptions, type TrafficSpec } from './scenario';
export { scriptCommands, fakeHex } from './steps';
