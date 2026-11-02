// Kubernetes lesson scenarios: starting clusters + files + steps, and `verify` lists
// that `npm run verify:k8s` replays in the engine and (in CI) on a real kind cluster.
import { addCluster, emptyState, type ClusterSetup } from './cluster';
import { settle, tick } from './clock';
import { injectFault, type Fault } from './faults';
import { run } from './run';
import type { KubeState } from './types';
import { clone } from './util';

export type KubeStep =
  /** A command, e.g. 'kubectl apply -f shop.yaml'. Must succeed. */
  | string
  /** Let time pass (seconds). */
  | { tick: number }
  /** Let time pass until nothing changes (max seconds, default 180). */
  | { settle: true | number }
  /** Write a file (path relative to the scenario folder). */
  | { write: string; content: string }
  /** Something goes wrong (see Fault). */
  | { fault: Fault }
  /** A command that is allowed to fail (a scenario that shows an error). */
  | { try: string };

export interface KubeScenario {
  id: string;
  /** Clusters, the first is current. Default: one kind cluster `kind-dev` (dev-control-plane, dev-worker, dev-worker2). */
  clusters?: ClusterSetup[];
  /** Start in this context (default: the first cluster). */
  context?: string;
  /** Files in the learner's folder, path → content (relative to `dir`). */
  files?: Record<string, string>;
  /** The learner's folder (default /home/you/shop when there are files, else /home/you). */
  dir?: string;
  steps?: KubeStep[];
  /** Let the cluster settle after the steps (default true). */
  settle?: boolean;
  /**
   * Command lists this lesson teaches. `npm run verify:k8s` runs each list after the steps,
   * in the engine and, in CI, on a real kind cluster (Kubernetes 1.37), then compares.
   */
  verify?: string[][];
  /** Engine-only in the real-cluster check, with the reason (needs Gateway API, metrics-server, a second cluster …). */
  engineOnly?: string;
}

/** Run one step (changes nothing you pass in; returns the next state). Throws when a command step fails. */
export function scenarioStep(state: KubeState, step: KubeStep, id = 'scenario'): KubeState {
  if (typeof step === 'string' || 'try' in step) {
    const cmd = typeof step === 'string' ? step : step.try;
    const r = run(state, cmd);
    if (typeof step === 'string' && !r.ok && !r.stopped) {
      throw new Error(`Scenario ${id}: step failed: ${cmd}\n${r.output.map((l) => l.map((x) => x.t).join('')).join('\n')}`);
    }
    return r.state;
  }
  if ('tick' in step) return tick(state, step.tick).state;
  if ('settle' in step) return settle(state, step.settle === true ? 180 : step.settle).state;
  if ('fault' in step) {
    const r = injectFault(state, step.fault);
    if (!r.ok) throw new Error(`Scenario ${id}: fault failed: ${JSON.stringify(step.fault)}`);
    return r.state;
  }
  const s = clone(state);
  const path = step.write.startsWith('/') ? step.write : `${s.cwd}/${step.write}`;
  s.files[path] = step.content;
  addDirs(s, path);
  return s;
}

function addDirs(s: KubeState, file: string): void {
  const parts = file.split('/').slice(1, -1);
  for (let i = 1; i <= parts.length; i++) {
    const d = `/${parts.slice(0, i).join('/')}`;
    if (!s.dirs.includes(d)) s.dirs.push(d);
  }
}

/** The state before any step: clusters, contexts, files. */
export function scenarioStart(sc: KubeScenario): KubeState {
  const s = emptyState(sc.id);
  for (const cl of sc.clusters ?? [{ name: 'kind-dev' }]) addCluster(s, cl);
  if (sc.context) s.currentContext = sc.context;
  const dir = sc.dir ?? (sc.files ? '/home/you/shop' : '/home/you');
  if (!s.dirs.includes(dir)) s.dirs.push(dir);
  s.cwd = dir;
  for (const [p, content] of Object.entries(sc.files ?? {})) {
    const abs = p.startsWith('/') ? p : `${dir}/${p}`;
    s.files[abs] = content;
    addDirs(s, abs);
  }
  return s;
}

/** Build a scenario's starting state (steps run, then the cluster settles). */
export function buildScenario(sc: KubeScenario): KubeState {
  let s = scenarioStart(sc);
  for (const step of sc.steps ?? []) s = scenarioStep(s, step, sc.id);
  if (sc.settle !== false && (sc.steps ?? []).length) s = settle(s).state;
  return s;
}

const cache = new Map<string, KubeState>();

/** Same as buildScenario, cached (UIs build the same scenario many times). Returns a copy. */
export function buildScenarioCached(sc: KubeScenario): KubeState {
  const key = JSON.stringify(sc);
  let s = cache.get(key);
  if (!s) {
    s = buildScenario(sc);
    cache.set(key, s);
  }
  return clone(s);
}
