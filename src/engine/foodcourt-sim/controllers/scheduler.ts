// The scheduler: pick a stall (node) for each new tray (pod).
// Filters like kube-scheduler (cordon, taints, node selector / affinity, CPU and memory
// requests vs allocatable, pod count, topology spread, anti-affinity), then scores.
// The "FailedScheduling" message format was checked against a real kube-scheduler v1.37.2.
import { getObj, listObjs, recordEvent, updateObj } from '../store';
import type { KObject } from '../types';
import { cpuMilli, iso, matches, memBytes, requirements, selectorMatches } from '../util';
import { tolerates, type Ctx } from './workloads';

export function podRequests(pod: KObject): { cpu: number; mem: number } {
  let cpu = 0;
  let mem = 0;
  for (const c of pod.spec?.containers ?? []) {
    cpu += cpuMilli(c.resources?.requests?.cpu);
    mem += memBytes(c.resources?.requests?.memory);
  }
  for (const c of pod.spec?.initContainers ?? []) {
    cpu = Math.max(cpu, cpuMilli(c.resources?.requests?.cpu));
    mem = Math.max(mem, memBytes(c.resources?.requests?.memory));
  }
  return { cpu, mem };
}

export function nodeAllocated(ctx: Ctx, node: string): { cpu: number; mem: number; pods: number } {
  let cpu = 0;
  let mem = 0;
  let pods = 0;
  for (const p of listObjs(ctx.c, 'Pod')) {
    if (p.spec?.nodeName !== node || p.status?.phase === 'Succeeded' || p.status?.phase === 'Failed') continue;
    const r = podRequests(p);
    cpu += r.cpu;
    mem += r.mem;
    pods++;
  }
  return { cpu, mem, pods };
}

function termMatches(term: any, node: KObject): boolean {
  const exprOk = (term.matchExpressions ?? []).every((e: any) => {
    const v = node.metadata.labels?.[e.key];
    switch (e.operator) {
      case 'In':
        return v !== undefined && e.values.includes(v);
      case 'NotIn':
        return v === undefined || !e.values.includes(v);
      case 'Exists':
        return v !== undefined;
      case 'DoesNotExist':
        return v === undefined;
      case 'Gt':
        return v !== undefined && Number(v) > Number(e.values[0]);
      case 'Lt':
        return v !== undefined && Number(v) < Number(e.values[0]);
    }
    return false;
  });
  const fieldOk = (term.matchFields ?? []).every((f: any) => f.key === 'metadata.name' && (f.operator === 'In' ? f.values.includes(node.metadata.name) : !f.values.includes(node.metadata.name)));
  return exprOk && fieldOk;
}

function affinityOk(pod: KObject, node: KObject): boolean {
  if (!Object.entries(pod.spec.nodeSelector ?? {}).every(([k, v]) => node.metadata.labels?.[k] === v)) return false;
  const req = pod.spec.affinity?.nodeAffinity?.requiredDuringSchedulingIgnoredDuringExecution;
  if (req && !(req.nodeSelectorTerms ?? []).some((t: any) => termMatches(t, node))) return false;
  return true;
}

function podsOnNode(ctx: Ctx, node: string, ns: string, sel: any): number {
  return listObjs(ctx.c, 'Pod', ns).filter((p) => p.spec?.nodeName === node && !p.metadata.deletionTimestamp && selectorMatches(sel, p.metadata.labels)).length;
}

/** Why each node can't take this pod (null = it fits). */
function filterNode(ctx: Ctx, pod: KObject, node: KObject, nodes: KObject[]): string[] | null {
  if (node.spec?.unschedulable) return ['node(s) were unschedulable'];
  const taints = (node.spec?.taints ?? []).filter((t: any) => t.effect === 'NoSchedule' || t.effect === 'NoExecute');
  if (taints.some((t: any) => !tolerates(pod.spec.tolerations ?? [], t))) return ['node(s) had untolerated taint(s)'];
  if (!affinityOk(pod, node)) return ["node(s) didn't match Pod's node affinity/selector"];
  const alloc = node.status?.allocatable ?? {};
  const used = nodeAllocated(ctx, node.metadata.name);
  const want = podRequests(pod);
  const reasons: string[] = [];
  if (used.pods + 1 > Number(alloc.pods ?? 110)) reasons.push('Too many pods');
  if (want.cpu && used.cpu + want.cpu > cpuMilli(alloc.cpu)) reasons.push('Insufficient cpu');
  if (want.mem && used.mem + want.mem > memBytes(alloc.memory)) reasons.push('Insufficient memory');
  if (reasons.length) return reasons;
  // Pod anti-affinity (hostname only): no matching pod already on this node.
  for (const term of pod.spec.affinity?.podAntiAffinity?.requiredDuringSchedulingIgnoredDuringExecution ?? []) {
    if (term.topologyKey === 'kubernetes.io/hostname' && podsOnNode(ctx, node.metadata.name, pod.metadata.namespace!, term.labelSelector) > 0) {
      return ["node(s) didn't match pod anti-affinity rules"];
    }
  }
  // Topology spread over hostnames: skew must stay within maxSkew.
  for (const tsc of pod.spec.topologySpreadConstraints ?? []) {
    if (tsc.whenUnsatisfiable !== 'DoNotSchedule' || tsc.topologyKey !== 'kubernetes.io/hostname') continue;
    const counts = nodes.map((n) => podsOnNode(ctx, n.metadata.name, pod.metadata.namespace!, tsc.labelSelector));
    const min = Math.min(...counts);
    const here = podsOnNode(ctx, node.metadata.name, pod.metadata.namespace!, tsc.labelSelector) + 1;
    if (here - min > (tsc.maxSkew ?? 1)) return ["node(s) didn't match pod topology spread constraints"];
  }
  return null;
}

/** The text kube-scheduler puts in the FailedScheduling event. */
export function failedSchedulingMessage(total: number, reasons: Record<string, number>): string {
  const parts = Object.entries(reasons)
    .map(([r, n]) => `${n} ${r}`)
    .sort();
  return `0/${total} nodes are available: ${parts.join(', ')}. preemption: 0/${total} nodes are available: ${total} Preemption is not helpful for scheduling.`;
}

function setScheduledCondition(pod: KObject, status: 'True' | 'False', now: number, message?: string): void {
  pod.status = pod.status ?? { phase: 'Pending' };
  const conds: any[] = (pod.status.conditions ?? []).filter((x: any) => x.type !== 'PodScheduled');
  const cond: any = { lastProbeTime: null, lastTransitionTime: iso(now), status, type: 'PodScheduled' };
  if (status === 'False') {
    cond.message = message;
    cond.reason = 'Unschedulable';
  }
  pod.status.conditions = [...conds, cond];
}

export function scheduler(ctx: Ctx): boolean {
  const { state, c, ev } = ctx;
  let changed = false;
  const nodes = listObjs(c, 'Node');
  for (const pod of listObjs(c, 'Pod')) {
    if (pod.spec?.nodeName || pod.metadata.deletionTimestamp || pod.spec?.schedulerName !== 'default-scheduler') continue;
    if (pod.spec.schedulingGates?.length) continue;
    // Claims that aren't there yet block scheduling.
    const missing = (pod.spec.volumes ?? []).find((v: any) => v.persistentVolumeClaim && !getObj(c, 'PersistentVolumeClaim', pod.metadata.namespace, v.persistentVolumeClaim.claimName));
    if (missing) {
      const msg = `0/${nodes.length} nodes are available: persistentvolumeclaim "${missing.persistentVolumeClaim.claimName}" not found. preemption: 0/${nodes.length} nodes are available: ${nodes.length} Preemption is not helpful for scheduling.`;
      reportUnschedulable(ctx, pod, msg);
      continue;
    }
    const reasons: Record<string, number> = {};
    const fit: KObject[] = [];
    for (const n of nodes) {
      const why = filterNode(ctx, pod, n, nodes);
      if (why) for (const r of why) reasons[r] = (reasons[r] ?? 0) + 1;
      else fit.push(n);
    }
    if (!fit.length) {
      reportUnschedulable(ctx, pod, failedSchedulingMessage(nodes.length, reasons));
      continue;
    }
    // Score: least requested CPU share, then fewest pods of the same owner (spread), then fewest pods.
    const owner = pod.metadata.ownerReferences?.[0]?.uid;
    const score = (n: KObject) => {
      const used = nodeAllocated(ctx, n.metadata.name);
      const cpuShare = used.cpu / Math.max(1, cpuMilli(n.status?.allocatable?.cpu));
      const same = listObjs(c, 'Pod').filter((p) => p.spec?.nodeName === n.metadata.name && owner && p.metadata.ownerReferences?.[0]?.uid === owner && !p.metadata.deletionTimestamp).length;
      const spreadSoft = (pod.spec.topologySpreadConstraints ?? []).filter((t: any) => t.whenUnsatisfiable === 'ScheduleAnyway').reduce((s: number, t: any) => s + podsOnNode(ctx, n.metadata.name, pod.metadata.namespace!, t.labelSelector), 0);
      return same * 10 + spreadSoft * 10 + cpuShare * 5 + used.pods * 0.01;
    };
    const best = [...fit].sort((a, b) => score(a) - score(b) || a.metadata.name.localeCompare(b.metadata.name))[0]!;
    pod.spec.nodeName = best.metadata.name;
    setScheduledCondition(pod, 'True', state.clock);
    delete c.unschedulable[pod.metadata.uid];
    updateObj(c, pod);
    recordEvent(state, c, pod, 'Normal', 'Scheduled', `Successfully assigned ${pod.metadata.namespace}/${pod.metadata.name} to ${best.metadata.name}`, 'default-scheduler');
    ev.push({ type: 'podScheduled', pod: pod.metadata.name, namespace: pod.metadata.namespace!, node: best.metadata.name });
    changed = true;
  }
  return changed;
}

function reportUnschedulable(ctx: Ctx, pod: KObject, msg: string): void {
  const { state, c, ev } = ctx;
  if (c.unschedulable[pod.metadata.uid] === msg) return;
  c.unschedulable[pod.metadata.uid] = msg;
  setScheduledCondition(pod, 'False', state.clock, msg);
  c.rv += 1;
  pod.metadata.resourceVersion = String(c.rv);
  recordEvent(state, c, pod, 'Warning', 'FailedScheduling', msg, 'default-scheduler');
  ev.push({ type: 'podFailedScheduling', pod: pod.metadata.name, namespace: pod.metadata.namespace!, message: msg });
}

export { matches, requirements };
