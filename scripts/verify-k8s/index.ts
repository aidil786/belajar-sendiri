// Truth check for the food-court engine (Kubernetes 1.37).
// Replays every Kubernetes scenario's `verify` lists in the engine and — when a real kind
// cluster is reachable (CI: context kind-dev, Kubernetes 1.37) — on that cluster too, then
// compares normalised structure: objects (generated name suffixes masked), Deployment and
// ReplicaSet counts and revisions, pod statuses and restart buckets, Service endpoint counts,
// selected event reasons, and each command's output (ages, IPs and generated names masked).
// Without a cluster it runs engine-only (every list must run as the scenario expects) and says so.
//
// Safety: it only ever talks to a context whose name starts with "kind-" (default kind-dev),
// and it deletes what scenarios create in the `default` namespace between runs.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseLine } from '../../src/engine/git-sim/parse';
import {
  listObjs,
  plain,
  podStatusText,
  run,
  scenarioStart,
  scenarioStep,
  tick,
  type KObject,
  type KubeScenario,
  type KubeState,
} from '../../src/engine/foodcourt-sim/index';
import { allScenarios } from '../../src/content/courses/kubernetes/scenarios/index';

const CONTEXT = process.env.K8S_TRUTH_CONTEXT ?? 'kind-dev';
/** Images CI pre-loads into the kind nodes (`kind load docker-image`), so neither side pulls them. */
export const PRELOADED = ['docker.io/library/nginx:1.29-alpine', 'docker.io/library/nginx:1.30-alpine', 'docker.io/library/busybox:1.37'];
const SYSTEM_NS = new Set(['kube-system', 'kube-public', 'kube-node-lease', 'local-path-storage']);
const KINDS = ['Deployment', 'ReplicaSet', 'StatefulSet', 'DaemonSet', 'Job', 'CronJob', 'Pod', 'Service', 'ConfigMap', 'Secret', 'ServiceAccount', 'Role', 'RoleBinding', 'PersistentVolumeClaim', 'HorizontalPodAutoscaler', 'NetworkPolicy'];
const PLURAL: Record<string, string> = {
  Deployment: 'deployments.apps', ReplicaSet: 'replicasets.apps', StatefulSet: 'statefulsets.apps', DaemonSet: 'daemonsets.apps', Job: 'jobs.batch', CronJob: 'cronjobs.batch',
  Pod: 'pods', Service: 'services', ConfigMap: 'configmaps', Secret: 'secrets', ServiceAccount: 'serviceaccounts', Role: 'roles.rbac.authorization.k8s.io',
  RoleBinding: 'rolebindings.rbac.authorization.k8s.io', PersistentVolumeClaim: 'persistentvolumeclaims', HorizontalPodAutoscaler: 'horizontalpodautoscalers.autoscaling',
  NetworkPolicy: 'networkpolicies.networking.k8s.io', EndpointSlice: 'endpointslices.discovery.k8s.io', Event: 'events',
};
const EVENT_REASONS = new Set(['Scheduled', 'FailedScheduling', 'Pulling', 'Pulled', 'Failed', 'BackOff', 'Created', 'Started', 'Killing', 'SuccessfulCreate', 'SuccessfulDelete', 'ScalingReplicaSet']);

// ---------------------------------------------------------------------------
// Normalising

const SAFE = '[bcdfghjklmnpqrstvwxz2456789]';
export function maskNames(text: string): string {
  return text
    .replace(new RegExp(`\\b([a-z][a-z0-9-]*?)-[4-9bcdf]{8,10}-${SAFE}{5}\\b`, 'g'), '$1-<rs>-<pod>')
    .replace(/\b([a-z][a-z0-9-]*?)-[4-9bcdf]{8,10}\b/g, '$1-<rs>')
    .replace(new RegExp(`\\b([a-z][a-z0-9-]*?)-${SAFE}{5}\\b`, 'g'), '$1-<id>');
}

export function normalizeOutput(cmd: string, text: string): string {
  let lines = maskNames(text)
    .replace(/\r/g, '')
    .replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?\b/g, '<ip>')
    .replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ/g, '<time>')
    .replace(/\(\d+[smhd](\d+[sm])? ago\)/g, '(<age> ago)')
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''));
  // Rollout progress lines depend on timing; the last line is the answer.
  if (/rollout status/.test(cmd)) lines = lines.filter((l) => !/^Waiting for/.test(l));
  // Tables: mask the AGE column and squeeze the padding (column widths follow the masked text).
  lines = lines.map((l) => l.replace(/(\s)\d+[smhd](\d+[smh])?(?=\s|$)/g, '$1<age>').replace(/ {2,}/g, '  '));
  return lines.join('\n').trim();
}

/** Outputs that change with timing or randomness are not compared. */
function compareOutput(cmd: string): boolean {
  return !/^kubectl (describe|top|get events|events)\b|^sleep\b|\s-w\b|--watch|logs .*-f\b/.test(cmd) || /-o jsonpath/.test(cmd);
}

function normStatus(p: KObject): string {
  const s = podStatusText(p);
  if (/^(CrashLoopBackOff|Error|Completed|OOMKilled)$/.test(s) && (p.spec?.restartPolicy ?? 'Always') === 'Always') return 'CrashLoop';
  if (/^(ErrImagePull|ImagePullBackOff)$/.test(s)) return 'ImagePull';
  return s;
}

/**
 * Why the container last stopped. A container killed at its memory limit is OOMKilled, but on kind
 * the runtime sometimes misses the cgroup OOM event and reports Error (exit code 137 either way; the
 * lists check the exit code itself). Treat the two as one here so the race doesn't fail the check.
 */
function lastReason(p: KObject): string {
  const t = p.status?.containerStatuses?.[0]?.lastState?.terminated;
  if (!t) return '';
  return t.reason === 'OOMKilled' || (t.reason === 'Error' && t.exitCode === 137) ? 'OOMKilled|137' : (t.reason ?? '');
}

function restartBucket(p: KObject): string {
  const n = (p.status?.containerStatuses ?? []).reduce((a: number, c: any) => a + (c.restartCount ?? 0), 0);
  return n > 0 ? 'restarted' : 'fresh';
}

function ownerName(p: KObject): string {
  const ref = (p.metadata.ownerReferences ?? []).find((r) => r.controller);
  return ref ? maskNames(`${ref.kind}/${ref.name}`) : `Pod/${p.metadata.name}`;
}

interface Snapshot {
  objects: string[];
  deployments: string[];
  replicasets: string[];
  pods: string[];
  services: string[];
  events: string[];
  namespaces: string[];
}

/** One normalised snapshot from plain object JSON (works for engine objects and real ones). */
export function snapshotOf(byKind: Record<string, KObject[]>, namespaces: string[]): Snapshot {
  const inScope = (o: KObject) => !o.metadata.namespace || namespaces.includes(o.metadata.namespace);
  const live = (o: KObject) => !o.metadata.deletionTimestamp;
  const objects: string[] = [];
  for (const k of KINDS) {
    for (const o of (byKind[k] ?? []).filter(inScope).filter(live)) {
      if (k === 'ConfigMap' && o.metadata.name === 'kube-root-ca.crt') continue;
      if (k === 'ServiceAccount' && o.metadata.name === 'default') continue;
      if (k === 'Service' && o.metadata.name === 'kubernetes') continue;
      objects.push(`${o.metadata.namespace}/${k}/${maskNames(o.metadata.name)}`);
    }
  }
  const deployments = (byKind.Deployment ?? []).filter(inScope).map(
    (d) => `${d.metadata.name} ${d.status?.readyReplicas ?? 0}/${d.spec.replicas} updated=${d.status?.updatedReplicas ?? 0} available=${d.status?.availableReplicas ?? 0} rev=${d.metadata.annotations?.['deployment.kubernetes.io/revision'] ?? ''}`,
  );
  const replicasets = (byKind.ReplicaSet ?? []).filter(inScope).map((r) => `${maskNames(r.metadata.name)} ${r.spec.replicas}/${r.status?.readyReplicas ?? 0} rev=${r.metadata.annotations?.['deployment.kubernetes.io/revision'] ?? ''}`);
  const pods = (byKind.Pod ?? [])
    .filter(inScope)
    .filter(live)
    .map((p) => `${ownerName(p)}|${normStatus(p)}|${(p.status?.containerStatuses ?? []).filter((c: any) => c.ready).length}/${p.spec.containers.length}|${restartBucket(p)}|last=${lastReason(p)}`);
  const slices = (byKind.EndpointSlice ?? []).filter(inScope);
  const services = (byKind.Service ?? [])
    .filter(inScope)
    .filter((s) => s.metadata.name !== 'kubernetes')
    .map((s) => {
      const ready = slices.filter((x) => x.metadata.labels?.['kubernetes.io/service-name'] === s.metadata.name).flatMap((x) => (x.endpoints ?? []).filter((e: any) => e.conditions?.ready)).length;
      return `${s.metadata.name} ${s.spec.type} ${(s.spec.ports ?? []).map((p: any) => `${p.port}->${p.targetPort}`).join(',')} ready=${ready}`;
    });
  const events = [
    ...new Set(
      (byKind.Event ?? [])
        .filter(inScope)
        .filter((e) => EVENT_REASONS.has(e.reason) && e.involvedObject?.kind !== 'Node')
        .map((e) => `${e.involvedObject.kind}:${e.reason}`),
    ),
  ];
  return {
    objects: objects.sort(),
    deployments: deployments.sort(),
    replicasets: replicasets.sort(),
    pods: pods.sort(),
    services: services.sort(),
    events: events.sort(),
    namespaces: [...namespaces].sort(),
  };
}

/** Same as the snapshot but only what changes while things settle. */
function settleKey(byKind: Record<string, KObject[]>, namespaces: string[]): string {
  const s = snapshotOf(byKind, namespaces);
  const busy = (byKind.Pod ?? []).some((p) => (namespaces.includes(p.metadata.namespace!) && p.metadata.deletionTimestamp) || /ContainerCreating|PodInitializing/.test(podStatusText(p)));
  return JSON.stringify([s.objects, s.deployments, s.replicasets, s.pods, s.services, busy]);
}

// ---------------------------------------------------------------------------
// Engine side

function engineObjects(state: KubeState): Record<string, KObject[]> {
  const c = state.clusters[state.contexts[state.currentContext]!.cluster]!;
  const out: Record<string, KObject[]> = {};
  for (const k of [...KINDS, 'EndpointSlice', 'Event', 'Namespace']) out[k] = listObjs(c, k);
  return out;
}

function engineNamespaces(state: KubeState): string[] {
  return (engineObjects(state).Namespace ?? []).map((n) => n.metadata.name).filter((n) => !SYSTEM_NS.has(n));
}

function engineSettle(state: KubeState, max = 180): KubeState {
  let s = state;
  let last = '';
  let still = 0;
  for (let i = 0; i < max && still < 6; i++) {
    s = tick(s, 1).state;
    const key = settleKey(engineObjects(s), engineNamespaces(s));
    if (key === last) still++;
    else {
      still = 0;
      last = key;
    }
  }
  return s;
}

function resolveEngine(state: KubeState, cmd: string): string {
  return cmd.replace(/\{pod:([^}]+)\}/g, (_m, sel: string) => {
    const r = run(state, `kubectl get pods -l ${sel} -o name`);
    const names = plain(r.output).split('\n').filter((l) => l.startsWith('pod/')).map((l) => l.slice(4)).sort();
    const live = names.find((n) => !listObjs(state.clusters[state.contexts[state.currentContext]!.cluster]!, 'Pod').find((p) => p.metadata.name === n)?.metadata.deletionTimestamp);
    return live ?? names[0] ?? 'none';
  });
}

interface SideResult {
  ok: boolean[];
  outputs: string[];
  snap: Snapshot;
}

function engineSide(sc: KubeScenario, seq: string[]): SideResult {
  let s = scenarioStart(sc);
  for (const c of Object.values(s.clusters)) for (const n of Object.values(c.nodes)) for (const img of PRELOADED) if (!n.images.includes(img)) n.images.push(img);
  for (const step of sc.steps ?? []) s = scenarioStep(s, step, sc.id);
  s = engineSettle(s);
  const ok: boolean[] = [];
  const outputs: string[] = [];
  for (const raw of seq) {
    const cmd = resolveEngine(s, raw);
    const r = run(s, cmd);
    s = r.state;
    ok.push(r.exitCode !== undefined ? r.exitCode === 0 : r.ok);
    outputs.push(normalizeOutput(cmd, plain(r.output)));
    s = engineSettle(s);
  }
  return { ok, outputs, snap: snapshotOf(engineObjects(s), engineNamespaces(s)) };
}

// ---------------------------------------------------------------------------
// Real side (a kind cluster)

function kubectl(args: string[], cwd?: string, input?: string): { ok: boolean; out: string } {
  const r = spawnSync('kubectl', ['--context', CONTEXT, ...args], { cwd, encoding: 'utf8', input, timeout: 300_000 });
  return { ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ? (r.stdout ? '\n' : '') + r.stderr : ''}`.replace(/\n$/, '') };
}

function realAvailable(): boolean {
  if (process.env.K8S_TRUTH === 'engine') return false;
  if (!CONTEXT.startsWith('kind-')) {
    console.log(`Refusing to use context "${CONTEXT}": the truth check only talks to kind clusters.`);
    return false;
  }
  const v = spawnSync('kubectl', ['version', '--client'], { encoding: 'utf8' });
  if (v.status !== 0) return false;
  const r = spawnSync('kubectl', ['--context', CONTEXT, 'cluster-info'], { encoding: 'utf8', timeout: 20_000 });
  return r.status === 0;
}

function realObjects(namespaces: string[]): Record<string, KObject[]> {
  const out: Record<string, KObject[]> = {};
  const kinds = [...KINDS, 'EndpointSlice', 'Event'];
  const r = kubectl(['get', kinds.map((k) => PLURAL[k]).join(','), '-A', '-o', 'json']);
  const items: KObject[] = r.ok ? (JSON.parse(r.out).items ?? []) : [];
  for (const k of kinds) out[k] = items.filter((o) => o.kind === k && (!o.metadata.namespace || namespaces.includes(o.metadata.namespace)));
  return out;
}

function realNamespaces(): string[] {
  const r = kubectl(['get', 'namespaces', '-o', 'jsonpath={.items[*].metadata.name}']);
  return r.out.split(/\s+/).filter((n) => n && !SYSTEM_NS.has(n));
}

function sleep(seconds: number): void {
  spawnSync('sleep', [String(seconds)]);
}

function realSettle(max = 180): void {
  let last = '';
  let still = 0;
  const start = Date.now();
  while ((Date.now() - start) / 1000 < max && still < 3) {
    sleep(2);
    const ns = realNamespaces();
    const key = settleKey(realObjects(ns), ns);
    if (key === last) still++;
    else {
      still = 0;
      last = key;
    }
  }
}

function realReset(): void {
  for (const ns of realNamespaces().filter((n) => n !== 'default')) kubectl(['delete', 'namespace', ns, '--wait=true', '--timeout=120s']);
  kubectl(['delete', 'deployments,replicasets,statefulsets,daemonsets,jobs,cronjobs,horizontalpodautoscalers,poddisruptionbudgets,networkpolicies,roles,rolebindings,persistentvolumeclaims,secrets', '--all', '-n', 'default', '--wait=true', '--timeout=120s']);
  kubectl(['delete', 'pods', '--all', '-n', 'default', '--grace-period=1', '--wait=true', '--timeout=120s']);
  kubectl(['delete', 'services', '-n', 'default', '--field-selector', 'metadata.name!=kubernetes']);
  kubectl(['delete', 'configmaps', '-n', 'default', '--field-selector', 'metadata.name!=kube-root-ca.crt']);
  kubectl(['delete', 'serviceaccounts', '-n', 'default', '--field-selector', 'metadata.name!=default']);
  kubectl(['delete', 'events', '--all', '-n', 'default']);
  for (const n of ['dev-control-plane', 'dev-worker', 'dev-worker2']) kubectl(['uncordon', n]);
}

function resolveReal(cmd: string): string {
  return cmd.replace(/\{pod:([^}]+)\}/g, (_m, sel: string) => {
    const r = kubectl(['get', 'pods', '-l', sel, '-o', 'json']);
    const items: KObject[] = r.ok ? JSON.parse(r.out).items : [];
    const names = items.filter((p) => !p.metadata.deletionTimestamp).map((p) => p.metadata.name).sort();
    return names[0] ?? 'none';
  });
}

function realRun(cmd: string, dir: string): { ok: boolean; out: string } {
  const words = parseLine(cmd).words;
  if (words[0] === 'sleep') {
    sleep(Number(words[1] ?? 1));
    return { ok: true, out: '' };
  }
  if (words[0] !== 'kubectl') return { ok: false, out: `not run on the real cluster: ${cmd}` };
  return kubectl(words.slice(1), dir);
}

function realSide(sc: KubeScenario, seq: string[]): SideResult {
  realReset();
  const dir = mkdtempSync(join(tmpdir(), 'fahamlah-k8s-'));
  try {
    for (const [p, content] of Object.entries(sc.files ?? {})) {
      const abs = join(dir, p);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content);
    }
    for (const step of sc.steps ?? []) {
      if (typeof step === 'string' || 'try' in step) {
        const cmd = typeof step === 'string' ? step : step.try;
        const r = realRun(cmd, dir);
        if (!r.ok && typeof step === 'string') throw new Error(`real cluster: step failed: ${cmd}\n${r.out}`);
      } else if ('tick' in step) sleep(step.tick);
      else if ('settle' in step) realSettle();
      else if ('write' in step) writeFileSync(join(dir, step.write), step.content);
      else throw new Error(`real cluster: fault steps are engine-only (${sc.id})`);
    }
    realSettle();
    const ok: boolean[] = [];
    const outputs: string[] = [];
    for (const raw of seq) {
      const cmd = resolveReal(raw);
      const r = realRun(cmd, dir);
      ok.push(r.ok);
      outputs.push(normalizeOutput(cmd, r.out));
      realSettle();
    }
    const ns = realNamespaces();
    const objs = realObjects(ns);
    return { ok, outputs, snap: snapshotOf(objs, ns) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------

function compare(sc: KubeScenario, seq: string[], a: SideResult, b: SideResult): string[] {
  const problems: string[] = [];
  seq.forEach((cmd, i) => {
    if (a.ok[i] !== b.ok[i]) problems.push(`"${cmd}" ${a.ok[i] ? 'works' : 'fails'} in the engine but ${b.ok[i] ? 'works' : 'fails'} on the real cluster\n      engine:   ${a.outputs[i]}\n      real:     ${b.outputs[i]}`);
    else if (compareOutput(cmd) && a.outputs[i] !== b.outputs[i]) problems.push(`output of "${cmd}" differs\n      engine:\n${indent(a.outputs[i]!)}\n      real:\n${indent(b.outputs[i]!)}`);
  });
  for (const k of Object.keys(a.snap) as (keyof Snapshot)[]) {
    const x = JSON.stringify(a.snap[k]);
    const y = JSON.stringify(b.snap[k]);
    if (x !== y) problems.push(`${k} differ\n      engine: ${x}\n      real:   ${y}`);
  }
  void sc;
  return problems;
}

function indent(t: string): string {
  return t
    .split('\n')
    .map((l) => `        ${l}`)
    .join('\n');
}

/** Split the work across parallel CI jobs: TRUTH_SHARD=2/3 runs every third list, starting with the second. */
const SHARD = /^(\d+)\/(\d+)$/.exec(process.env.TRUTH_SHARD ?? '');
let listIndex = 0;
const mine = () => !SHARD || listIndex++ % Number(SHARD[2]) === Number(SHARD[1]) - 1;

const only = process.env.VERIFY_ONLY;
const scenarios = allScenarios.filter((s) => !only || s.id.startsWith(only));
const real = realAvailable();
console.log(
  real
    ? `Real cluster: context ${CONTEXT} (${kubectl(['version', '-o', 'json']).out.match(/"gitVersion":\s*"(v[^"]+)"/g)?.join(', ') ?? 'version unknown'})`
    : 'No kind cluster reachable: running ENGINE-ONLY (CI compares with a real kind cluster, Kubernetes 1.37).',
);
const failures: string[] = [];
let count = 0;
let skipped = 0;
for (const sc of scenarios) {
  for (const seq of sc.verify ?? []) {
    if (!mine()) continue;
    count++;
    let a: SideResult;
    try {
      a = engineSide(sc, seq);
    } catch (e) {
      failures.push(`✗ ${sc.id}: [${seq.join(' ; ')}]\n    - engine: ${(e as Error).message}`);
      continue;
    }
    if (process.env.VERIFY_SHOW) {
      console.log(`\n=== ${sc.id}`);
      seq.forEach((c, i) => console.log(`$ ${c}  [ok=${a.ok[i]}]\n${a.outputs[i]}`));
      console.log(JSON.stringify(a.snap, null, 1));
    }
    if (!real || sc.engineOnly) {
      if (real && sc.engineOnly) skipped++;
      continue;
    }
    try {
      const b = realSide(sc, seq);
      const problems = compare(sc, seq, a, b);
      if (problems.length) failures.push(`✗ ${sc.id}: [${seq.join(' ; ')}]\n    - ${problems.join('\n    - ')}`);
      else console.log(`✓ ${sc.id}: ${seq.join(' ; ')}`);
    } catch (e) {
      failures.push(`✗ ${sc.id}: [${seq.join(' ; ')}]\n    - ${(e as Error).message}`);
    }
  }
}
if (real) realReset();
if (failures.length) {
  console.error(`\n${failures.join('\n\n')}\n\n✗ ${failures.length} of ${count} Kubernetes command lists ${real ? 'differ from the real cluster' : 'failed in the engine'}.`);
  process.exit(1);
}
const engineOnly = scenarios.filter((s) => s.engineOnly);
console.log(
  real
    ? `✓ ${count - skipped} Kubernetes command lists match the real cluster (${skipped} engine-only: ${engineOnly.map((s) => `${s.id} — ${s.engineOnly}`).join('; ')}).`
    : `✓ ${count} Kubernetes command lists run in the engine (engine-only; no real cluster here).`,
);
