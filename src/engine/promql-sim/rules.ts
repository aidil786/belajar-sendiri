// Recording and alerting rules, evaluated over time the way `promtool test rules` does it:
// every rule group runs at 0, interval, 2·interval, … in order; a recording rule writes its
// result back as a new series (and a stale marker when a series disappears); an alerting rule
// moves each alert inactive → pending → firing (after `for`), keeps firing for
// `keep_firing_for`, and writes ALERTS / ALERTS_FOR_STATE like Prometheus.
import { parseExpr } from './parser';
import { duration, labelsKey, makeLabels, NAME } from './format';
import { instantQuery } from './eval';
import { expandTemplate } from './template';
import type { SeriesStore } from './series';
import { PromQLError, type InstantSample, type Labels } from './types';
import type { Expr } from './ast';

export interface AlertRuleDef {
  alert: string;
  expr: string;
  for?: string;
  keep_firing_for?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
}

export interface RecordingRuleDef {
  record: string;
  expr: string;
  labels?: Record<string, string>;
}

export type RuleDef = AlertRuleDef | RecordingRuleDef;

export interface RuleGroupDef {
  name: string;
  rules: RuleDef[];
}

export type AlertState = 'inactive' | 'pending' | 'firing';

export interface AlertSnapshot {
  labels: Labels;
  annotations: Labels;
  state: Exclude<AlertState, 'inactive'>;
  activeAt: number;
  value: number;
}

export interface AlertTimeline {
  rule: AlertRuleDef;
  /** One entry per group evaluation. Only pending and firing alerts are listed. */
  evals: { t: number; alerts: AlertSnapshot[] }[];
}

export interface RuleError {
  rule: string;
  t: number;
  message: string;
}

export interface RulesResult {
  evalTimes: number[];
  alerts: AlertTimeline[];
  errors: RuleError[];
}

export const isAlertRule = (r: RuleDef): r is AlertRuleDef => 'alert' in r;

interface Alert {
  labels: Labels;
  annotations: Labels;
  state: AlertState;
  activeAt: number;
  firedAt?: number;
  resolvedAt?: number;
  keepFiringSince?: number;
  value: number;
}

interface CompiledRule {
  def: RuleDef;
  expr: Expr;
  holdMs: number;
  keepMs: number;
  active: Map<string, Alert>;
  previous: Map<string, Labels>;
  timeline?: AlertTimeline;
}

function toVector(store: SeriesStore, expr: Expr, t: number): InstantSample[] {
  const v = instantQuery(store, expr, t);
  if (v.type === 'vector') return v.samples;
  if (v.type === 'scalar') return [{ labels: {}, value: v.value }];
  throw new PromQLError('rule result is not a vector or scalar', 'ruleResultType');
}

/** Compile rules (parses every expression and template; throws on the first problem). */
function compile(groups: RuleGroupDef[]): CompiledRule[][] {
  return groups.map((g) =>
    g.rules.map((def) => {
      const expr = parseExpr(def.expr);
      const holdMs = isAlertRule(def) && def.for ? duration(def.for) : 0;
      const keepMs = isAlertRule(def) && def.keep_firing_for ? duration(def.keep_firing_for) : 0;
      const c: CompiledRule = { def, expr, holdMs, keepMs, active: new Map(), previous: new Map() };
      if (isAlertRule(def)) c.timeline = { rule: def, evals: [] };
      return c;
    }),
  );
}

function evalAlert(r: CompiledRule, store: SeriesStore, ts: number): InstantSample[] {
  const def = r.def as AlertRuleDef;
  const res = toVector(store, r.expr, ts);
  const fresh = new Map<string, Alert>();
  for (const s of res) {
    const data = { labels: s.labels, value: s.value };
    const lb: Record<string, string> = { ...s.labels };
    delete lb[NAME];
    for (const [k, v] of Object.entries(def.labels ?? {})) lb[k] = expandTemplate(v, data);
    lb.alertname = def.alert;
    const labels = makeLabels(lb);
    const ann: Record<string, string> = {};
    for (const [k, v] of Object.entries(def.annotations ?? {})) ann[k] = expandTemplate(v, data);
    const key = labelsKey(labels);
    if (fresh.has(key)) throw new PromQLError('vector contains metrics with the same labelset after applying alert labels', 'alertSameLabelset');
    fresh.set(key, { labels, annotations: makeLabels(ann), activeAt: ts, state: 'pending', value: s.value });
  }
  for (const [k, a] of fresh) {
    const old = r.active.get(k);
    if (old && old.state !== 'inactive') {
      old.value = a.value;
      old.annotations = a.annotations;
      continue;
    }
    r.active.set(k, a);
  }
  const out: InstantSample[] = [];
  for (const [k, a] of [...r.active]) {
    if (!fresh.has(k)) {
      let keepFiring = false;
      if (a.state === 'firing' && r.keepMs > 0) {
        if (a.keepFiringSince === undefined) a.keepFiringSince = ts;
        if (ts - a.keepFiringSince < r.keepMs) keepFiring = true;
      }
      if (a.state === 'pending' || (a.resolvedAt !== undefined && ts - a.resolvedAt > 15 * 60_000)) r.active.delete(k);
      if (a.state !== 'inactive' && !keepFiring) {
        a.state = 'inactive';
        a.resolvedAt = ts;
      }
      if (!keepFiring) continue;
    } else a.keepFiringSince = undefined;
    if (a.state === 'pending' && ts - a.activeAt >= r.holdMs) {
      a.state = 'firing';
      a.firedAt = ts;
    }
    out.push({ labels: makeLabels({ ...(def.labels ?? {}), ...a.labels, [NAME]: 'ALERTS', alertname: def.alert, alertstate: a.state }), value: 1 });
    out.push({ labels: makeLabels({ ...(def.labels ?? {}), ...a.labels, [NAME]: 'ALERTS_FOR_STATE', alertname: def.alert }), value: a.activeAt / 1000 });
  }
  r.timeline!.evals.push({
    t: ts,
    alerts: [...r.active.values()]
      .filter((a) => a.resolvedAt === undefined && a.state !== 'inactive')
      .map((a) => ({ labels: a.labels, annotations: a.annotations, state: a.state as 'pending' | 'firing', activeAt: a.activeAt, value: a.value })),
  });
  return out;
}

function evalRecording(r: CompiledRule, store: SeriesStore, ts: number): InstantSample[] {
  const def = r.def as RecordingRuleDef;
  const res = toVector(store, r.expr, ts).map((s) => ({ labels: makeLabels({ ...s.labels, [NAME]: def.record, ...(def.labels ?? {}) }), value: s.value }));
  const seen = new Set<string>();
  for (const s of res) {
    const k = labelsKey(s.labels);
    if (seen.has(k)) throw new PromQLError('vector contains metrics with the same labelset after applying rule labels', 'recordSameLabelset');
    seen.add(k);
  }
  return res;
}

/**
 * Run rule groups over time on a copy of the store, from 0 to `until` (inclusive) every
 * `interval` ms. Returns the store with recorded series and ALERTS, plus each alert's timeline.
 */
export function evaluateRules(base: SeriesStore, groups: RuleGroupDef[], until: number, interval: number): { store: SeriesStore; result: RulesResult } {
  const store = base.clone();
  const compiled = compile(groups);
  const result: RulesResult = { evalTimes: [], alerts: compiled.flat().flatMap((r) => (r.timeline ? [r.timeline] : [])), errors: [] };
  for (let ts = 0; ts <= until; ts += interval) {
    result.evalTimes.push(ts);
    for (const rules of compiled) {
      for (const r of rules) {
        let out: InstantSample[];
        try {
          out = isAlertRule(r.def) ? evalAlert(r, store, ts) : evalRecording(r, store, ts);
        } catch (e) {
          const name = isAlertRule(r.def) ? r.def.alert : r.def.record;
          result.errors.push({ rule: name, t: ts, message: (e as Error).message });
          if (r.timeline && r.timeline.evals[r.timeline.evals.length - 1]?.t !== ts) r.timeline.evals.push({ t: ts, alerts: [] });
          continue;
        }
        const now = new Map<string, Labels>();
        for (const s of out) {
          // New series are created after the input samples loaded at this step (promtool's order).
          store.add(s.labels, ts, s.value, false, [Math.ceil(ts / interval), 1, store.takeSeq()]);
          now.set(labelsKey(s.labels), s.labels);
        }
        for (const [k, l] of r.previous) if (!now.has(k)) store.add(l, ts, NaN, true);
        r.previous = now;
      }
    }
  }
  return { store, result };
}

/** The state of one alert rule at time t: the latest group evaluation at or before t. */
export function alertsAt(timeline: AlertTimeline, t: number): AlertSnapshot[] {
  let pick: AlertSnapshot[] = [];
  for (const e of timeline.evals) {
    if (e.t > t) break;
    pick = e.alerts;
  }
  return pick;
}
