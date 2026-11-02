// The pausable clock. `reconcile` runs every controller until nothing changes (instant,
// like a real cluster reacting in milliseconds); `tick` moves time on by whole seconds
// (kubelets pull, start, probe and restart; nodes go NotReady; the HPA syncs).
import { cronJobController, daemonSetController, deploymentController, jobController, replicaSetController, statefulSetController, type Ctx } from './controllers/workloads';
import { scheduler } from './controllers/scheduler';
import { kubelet } from './controllers/kubelet';
import { apiEndpoints, endpointSliceController, gatewayController, garbageCollector, hpaController, namespaceController, nodeLifecycle, pdbAndQuotaStatus, serviceLoadBalancer, volumeController } from './controllers/misc';
import { controlPlane, staticPodController } from './node/os';
import { listObjs, podStatusText, readyText, restartCount } from './store';
import type { Cluster, KubeEvent, KubeState } from './types';
import { clone } from './util';

/**
 * Run the controllers on one cluster until they settle (changes the state).
 * K9: when a control-plane static pod is down (node shell), its loops pause: no kube-scheduler →
 * new pods stay Pending with no events; no kube-controller-manager → no Deployments, ReplicaSets,
 * node checks or endpoints; no API server or etcd → nothing but the kubelets.
 */
export function reconcileCluster(state: KubeState, c: Cluster, ev: KubeEvent[], withTime = false): void {
  const ctx: Ctx = { state, c, ev };
  const cp = controlPlane(c);
  const managers = cp.controllers;
  if (withTime) {
    if (managers) nodeLifecycle(ctx);
    else for (const rt of Object.values(c.nodes)) if (rt.up) rt.heartbeat = state.clock;
    kubelet(ctx);
    staticPodController(state, c, ev);
    if (managers) {
      hpaController(ctx);
      cronJobController(ctx);
    }
  }
  if (!cp.api) return;
  for (let i = 0; i < 8; i++) {
    let changed = false;
    if (managers) {
      changed = namespaceController(ctx) || changed;
      changed = garbageCollector(ctx) || changed;
      changed = deploymentController(ctx) || changed;
      changed = replicaSetController(ctx) || changed;
      changed = daemonSetController(ctx) || changed;
      changed = statefulSetController(ctx) || changed;
      changed = jobController(ctx) || changed;
    }
    if (cp.scheduler) changed = scheduler(ctx) || changed;
    if (managers) {
      changed = volumeController(ctx) || changed;
      changed = endpointSliceController(ctx) || changed;
    }
    if (!changed) break;
  }
  if (managers) serviceLoadBalancer(ctx);
  gatewayController(ctx);
  if (managers) pdbAndQuotaStatus(ctx);
  apiEndpoints(ctx);
  // Keep only the "reconcile" events that say something new for the board.
  dedupeReconcile(ev);
}

function dedupeReconcile(ev: KubeEvent[]): void {
  const seen = new Set<string>();
  for (let i = ev.length - 1; i >= 0; i--) {
    const e = ev[i]!;
    if (e.type !== 'reconcile' || e.do !== 'none') continue;
    const k = `${e.controller}/${e.namespace}/${e.name}`;
    if (seen.has(k)) ev.splice(i, 1);
    else seen.add(k);
  }
}

/** Run controllers on every cluster (changes the state). */
export function reconcileAll(state: KubeState, ev: KubeEvent[]): void {
  for (const c of Object.values(state.clusters)) reconcileCluster(state, c, ev);
}

/** Move time on by one second on every cluster (changes the state). */
export function tickOnce(state: KubeState, ev: KubeEvent[]): void {
  state.clock += 1;
  for (const c of Object.values(state.clusters)) reconcileCluster(state, c, ev, true);
  ev.push({ type: 'tick', clock: state.clock });
}

/** Move time on. The state you pass in is never changed. */
export function tick(state: KubeState, seconds = 1): { state: KubeState; events: KubeEvent[] } {
  const s = clone(state);
  const events: KubeEvent[] = [];
  for (let i = 0; i < seconds; i++) tickOnce(s, events);
  return { state: s, events: compactTicks(events) };
}

function compactTicks(events: KubeEvent[]): KubeEvent[] {
  const lastTick = [...events].reverse().find((e) => e.type === 'tick');
  return [...events.filter((e) => e.type !== 'tick'), ...(lastTick ? [lastTick] : [])];
}

/** What a learner would see change: pods, workloads, nodes, endpoints. */
export function signature(state: KubeState): string {
  const parts: string[] = [];
  for (const c of Object.values(state.clusters)) {
    for (const p of listObjs(c, 'Pod')) parts.push(`${p.metadata.namespace}/${p.metadata.name}|${podStatusText(p)}|${readyText(p)}|${restartCount(p)}|${p.spec.nodeName ?? ''}`);
    for (const k of ['Deployment', 'ReplicaSet', 'StatefulSet', 'DaemonSet', 'Job', 'HorizontalPodAutoscaler', 'PersistentVolumeClaim', 'EndpointSlice']) {
      for (const o of listObjs(c, k)) parts.push(`${k}/${o.metadata.namespace}/${o.metadata.name}|${JSON.stringify(o.status ?? {}).replace(/"(lastTransitionTime|lastUpdateTime|lastProbeTime|startTime|completionTime|lastScaleTime)":"[^"]*"/g, '')}|${k === 'EndpointSlice' ? JSON.stringify(o.endpoints ?? []) : ''}`);
    }
    for (const n of listObjs(c, 'Node')) parts.push(`${n.metadata.name}|${n.status.conditions.find((x: any) => x.type === 'Ready')?.status}|${JSON.stringify(n.spec.taints ?? [])}`);
  }
  return parts.join('\n');
}

/**
 * Let time pass until nothing visible changes for `quiet` seconds (default 12: longer than
 * a probe period), or `max` seconds pass. Used by scenarios, demos and the truth check.
 */
export function settle(state: KubeState, max = 180, quiet = 12): { state: KubeState; events: KubeEvent[]; seconds: number } {
  const s = clone(state);
  const events: KubeEvent[] = [];
  reconcileAll(s, events);
  let last = signature(s);
  let still = 0;
  let n = 0;
  for (; n < max && still < quiet; n++) {
    tickOnce(s, events);
    const sig = signature(s);
    if (sig === last) still++;
    else {
      still = 0;
      last = sig;
    }
  }
  return { state: s, events: compactTicks(events), seconds: n };
}
