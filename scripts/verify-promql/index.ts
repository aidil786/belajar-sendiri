// Truth check for the PromQL engine (src/engine/promql-sim) against the real promtool.
// For every observability scenario's `verify` list, the ENGINE computes the answers; this script
// writes them as a promtool unit test (exp_samples / exp_alerts) and runs `promtool test rules`
// from the official Prometheus image (pinned below). Any difference fails, with promtool's diff.
// Entries with `error: true` must fail in both, with the same error text (errors.yml).
// Needs Docker. Usage: npm run verify:promql   (VERIFY_ONLY=o2 runs scenarios whose id starts so)
// On a shared Docker daemon, set DOCKER_LOCK=/path/to/lockfile to run promtool under flock.
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { stringify } from 'yaml';
import {
  alertsAt,
  buildScenario,
  duration,
  evaluateRules,
  formatDuration,
  instantQuery,
  labelsKey,
  roundTrip,
  SeriesStore,
  seriesString,
  type ObsScenario,
  type PromVerify,
  type PromVerifyAlert,
  type RuleGroupDef,
} from '../../src/engine/promql-sim/index';
import { allObsScenarios } from '../../src/content/courses/observability/scenarios/index';

/** Prometheus 3.13 LTS (https://prometheus.io/docs/introduction/release-cycle/). */
export const PROMETHEUS_IMAGE = 'quay.io/prometheus/prometheus:v3.13.5';
const OUT = resolve('node_modules/.cache/fahamlah-promql');

const only = process.env.VERIFY_ONLY;
const scenarios = allObsScenarios.filter((s) => !only || s.id.startsWith(only));
const errors: string[] = [];
const isAlert = (v: PromVerify): v is PromVerifyAlert => 'alert' in v;

interface ErrorCase {
  expr: string;
  at: string;
  message: string;
}
interface Planned {
  scenario: string;
  tests: string;
  errors: ErrorCase[];
}
const planned: Planned[] = [];
let checks = 0;

/**
 * promtool loads input series in a random order (a Go map), and Prometheus works through series
 * in the order they were created. So a float sum, an avg, a topk tie or the pair named in a
 * "duplicate series" error can change between promtool runs. The engine runs every check under
 * several shuffled orders: an answer that changes is order-sensitive, and the scenario must use
 * friendlier numbers (or drop that check), so this check never flakes.
 */
const SHUFFLES = 40;

function shuffled<T>(items: T[], seed: number): T[] {
  let h = seed * 2654435761;
  const rand = () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** The "duplicate series" error names a random pair: compare it without the pair. */
function normaliseError(msg: string): string {
  return msg.replace(/for the match group \{.*?\} on the (left|right) hand-side of the operation: \[.*\];/, 'for the match group {…} on the $1 hand-side of the operation: […];');
}

/** Everything a check expects, as text (for comparing orders). */
function answers(sc: ObsScenario, groups: RuleGroupDef[], maxT: number, evalInterval: number, interval: number): Map<string, string> {
  const input = SeriesStore.fromInput(sc.series, interval, evalInterval);
  const { store, result } = groups.length ? evaluateRules(input, groups, maxT, evalInterval) : { store: input, result: null };
  const out = new Map<string, string>();
  for (const v of sc.verify) {
    for (const at of v.at) {
      const t = duration(at);
      const key = `${isAlert(v) ? `alert ${v.alert.alert}` : v.expr} @ ${at}`;
      if (isAlert(v)) {
        const tl = result!.alerts.find((a) => a.rule === v.alert)!;
        out.set(key, JSON.stringify(alertsAt(tl, t).filter((a) => a.state === 'firing').map((a) => [labelsKey(a.labels), a.annotations]).sort()));
        continue;
      }
      try {
        const val = instantQuery(store, v.expr, t);
        const samples = val.type === 'scalar' ? [{ labels: {}, value: val.value }] : val.type === 'vector' ? val.samples : [];
        out.set(key, JSON.stringify(samples.map((s) => `${labelsKey(s.labels)} ${roundTrip(s.value)}`).sort()));
      } catch (e) {
        out.set(key, `error: ${normaliseError((e as Error).message)}`);
      }
    }
  }
  return out;
}

/** Write <id>/rules.yml, <id>/tests.yml and (if needed) <id>/errors.yml for one scenario. */
function plan(sc: ObsScenario): void {
  const b = buildScenario(sc);
  const verifyAlerts = sc.verify.filter(isAlert).map((v) => v.alert);
  const names = [...(sc.rules ?? []).flatMap((g) => g.rules.flatMap((r) => ('alert' in r ? [r.alert] : []))), ...verifyAlerts.map((a) => a.alert)];
  const dup = names.find((n, i) => names.indexOf(n) !== i);
  if (dup) errors.push(`${sc.id}: alert name "${dup}" is used twice (promtool groups alerts by name)`);
  const groups: RuleGroupDef[] = [...(sc.rules ?? []), ...(verifyAlerts.length ? [{ name: `verify-${sc.id}`, rules: verifyAlerts }] : [])];
  const times = sc.verify.flatMap((v) => v.at.map(duration));
  const maxT = Math.max(0, ...times);
  const { store, result } = groups.length ? evaluateRules(b.input, groups, maxT, b.evalInterval) : { store: b.input, result: null };
  for (const e of result?.errors ?? []) errors.push(`${sc.id}: rule ${e.rule} fails at ${formatDuration(e.t)}: ${e.message}`);

  const base = answers(sc, groups, maxT, b.evalInterval, b.interval);
  const sensitive = new Set<string>();
  const orders = [[...sc.series].reverse(), [...sc.series].sort((x, y) => (x.series < y.series ? -1 : 1)), ...Array.from({ length: SHUFFLES }, (_, i) => shuffled(sc.series, i + 1))];
  for (const series of orders) {
    const other = answers({ ...sc, series }, groups, maxT, b.evalInterval, b.interval);
    for (const [k, v] of base) if (other.get(k) !== v) sensitive.add(k);
  }
  for (const k of sensitive) errors.push(`${sc.id}: "${k}" depends on the order of the series (promtool's order is random): use rounder numbers or drop it`);

  const promql: object[] = [];
  const alerts: object[] = [];
  const errorCases: ErrorCase[] = [];
  for (const v of sc.verify) {
    for (const at of v.at) {
      const t = duration(at);
      if (t % b.evalInterval) errors.push(`${sc.id}: eval time ${at} is not a multiple of the evaluation interval`);
      checks++;
      if (isAlert(v)) {
        const tl = result!.alerts.find((a) => a.rule === v.alert)!;
        const firing = alertsAt(tl, t).filter((a) => a.state === 'firing');
        alerts.push({
          eval_time: formatDuration(t),
          alertname: v.alert.alert,
          exp_alerts: firing.map((a) => {
            const labels: Record<string, string> = { ...a.labels };
            delete labels.alertname;
            return { exp_labels: labels, exp_annotations: { ...a.annotations } };
          }),
        });
        continue;
      }
      let value;
      try {
        value = instantQuery(store, v.expr, t);
      } catch (e) {
        if (v.error) errorCases.push({ expr: v.expr, at: formatDuration(t), message: (e as Error).message });
        else errors.push(`${sc.id}: the engine fails on "${v.expr}" at ${at}: ${(e as Error).message}`);
        continue;
      }
      if (v.error) {
        errors.push(`${sc.id}: "${v.expr}" is marked error: true, but the engine runs it`);
        continue;
      }
      if (value.type === 'matrix' || value.type === 'string') {
        errors.push(`${sc.id}: "${v.expr}" gives a ${value.type}; promtool only checks instant vectors and scalars`);
        continue;
      }
      const samples = value.type === 'scalar' ? [{ labels: {}, value: value.value }] : value.samples;
      if (samples.some((s) => Number.isNaN(s.value))) {
        errors.push(`${sc.id}: "${v.expr}" at ${at} gives NaN; promtool can't compare NaN (pick another time)`);
        continue;
      }
      promql.push({ expr: v.expr, eval_time: formatDuration(t), exp_samples: samples.map((s) => ({ labels: seriesString(s.labels), value: s.value })) });
    }
  }

  const dir = join(OUT, sc.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'rules.yml'), stringify({ groups }));
  // Without group_eval_order promtool runs groups in a random order (a Go map); the engine runs
  // them in file order, like a rules file listed top to bottom.
  const head = { rule_files: ['rules.yml'], evaluation_interval: formatDuration(b.evalInterval), ...(groups.length > 1 ? { group_eval_order: groups.map((g) => g.name) } : {}) };
  const input = { interval: formatDuration(b.interval), input_series: sc.series.map((s) => ({ series: s.series, values: s.values })) };
  writeFileSync(join(dir, 'tests.yml'), stringify({ ...head, tests: [{ ...input, ...(alerts.length ? { alert_rule_test: alerts } : {}), ...(promql.length ? { promql_expr_test: promql } : {}) }] }));
  if (errorCases.length) writeFileSync(join(dir, 'errors.yml'), stringify({ ...head, tests: [{ ...input, promql_expr_test: errorCases.map((c) => ({ expr: c.expr, eval_time: c.at })) }] }));
  planned.push({ scenario: sc.id, tests: `${sc.id}/tests.yml`, errors: errorCases });
}

/** Run promtool on each file, one after another in one container. Output per file. */
function promtoolEach(paths: string[]): Map<string, { exit: number; output: string }> {
  const script = 'for f in "$@"; do echo "@@@ file $f"; promtool test rules "$f" 2>&1; echo "@@@ exit $?"; done';
  const args = ['run', '--rm', '--entrypoint', 'sh', '-v', `${OUT}:/w:ro`, '-w', '/w', PROMETHEUS_IMAGE, '-c', script, 'sh', ...paths];
  const lock = process.env.DOCKER_LOCK;
  const r = lock ? spawnSync('flock', [lock, 'docker', ...args], { encoding: 'utf8' }) : spawnSync('docker', args, { encoding: 'utf8' });
  if (r.error || r.status !== 0) {
    console.error(`✗ Could not run promtool with Docker (${PROMETHEUS_IMAGE}).`);
    console.error(r.error?.message ?? r.stderr);
    console.error('  Docker must be running. On GitHub Actions, ubuntu-latest has it.');
    process.exit(1);
  }
  const out = new Map<string, { exit: number; output: string }>();
  const re = /@@@ file (\S+)\n([\s\S]*?)@@@ exit (\d+)/g;
  for (let m = re.exec(r.stdout); m; m = re.exec(r.stdout)) out.set(m[1]!, { exit: Number(m[3]), output: m[2]!.replace(/\n{3,}/g, '\n\n').trim() });
  return out;
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
for (const sc of scenarios) {
  try {
    plan(sc);
  } catch (e) {
    errors.push(`${sc.id}: ${(e as Error).message}`);
  }
}

const paths = planned.flatMap((p) => [p.tests, ...(p.errors.length ? [`${p.scenario}/errors.yml`] : [])]);
const results = paths.length ? promtoolEach(paths) : new Map();
let errorTexts = 0;
for (const p of planned) {
  const r = results.get(p.tests);
  if (!r) errors.push(`${p.scenario}: promtool printed nothing for ${p.tests}`);
  else if (r.exit !== 0) errors.push(`${p.scenario}: promtool disagrees with the engine (exp = engine, got = promtool):\n${r.output}`);
  if (!p.errors.length) continue;
  const e = results.get(`${p.scenario}/errors.yml`);
  for (const c of p.errors) {
    errorTexts++;
    const line = `expr: ${JSON.stringify(c.expr)}, time: ${c.at}, err: `;
    const at = e?.output.indexOf(line) ?? -1;
    if (!e || at < 0) {
      errors.push(`${p.scenario}: promtool does not fail on "${c.expr}" (the engine says: ${c.message})`);
      continue;
    }
    const got = e.output.slice(at + line.length).split('\n')[0]!.trim();
    if (normaliseError(got) !== normaliseError(c.message)) errors.push(`${p.scenario}: the error text differs for "${c.expr}"\n    engine:   ${c.message}\n    promtool: ${got}`);
  }
}

if (errors.length) {
  console.error(`✗ PromQL truth check failed (${errors.length}):\n${errors.map((e) => `- ${e}`).join('\n')}`);
  process.exit(1);
}
console.log(`✓ PromQL OK: ${checks} checks in ${scenarios.length} scenarios match promtool (${PROMETHEUS_IMAGE}), ${errorTexts} error texts word for word.`);
