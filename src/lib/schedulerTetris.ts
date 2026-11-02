// Pure logic for SchedulerTetris: do pods (trays) fit on nodes (stalls)?
//
// Follows kube-scheduler 1.37's filter plugins, in its order: NodeUnschedulable, TaintToleration,
// NodeAffinity (nodeSelector + required node affinity), NodeResourcesFit (requests vs allocatable).
// The first plugin that says no decides the node's reason (NodeResourcesFit can name cpu and memory).
// A pod that fits nowhere gets the FailedScheduling message, word for word as kube-scheduler v1.37.2
// prints it (checked against a real scheduler), e.g.
//   0/3 nodes are available: 1 node(s) had untolerated taint(s), 2 Insufficient memory. preemption:
//   0/3 nodes are available: 1 No preemption victims found for incoming pod, 2 Preemption is not
//   helpful for scheduling.
// All pods have the same priority here, so preemption never finds victims.
import { parseQuantity } from './k8sQuantity';

export type TaintEffect = 'NoSchedule' | 'PreferNoSchedule' | 'NoExecute';

export interface Taint {
  key: string;
  value?: string;
  effect: TaintEffect;
}

export interface Toleration {
  key?: string;
  operator?: 'Equal' | 'Exists';
  value?: string;
  effect?: TaintEffect;
}

export interface AffinityTerm {
  key: string;
  operator: 'In' | 'NotIn' | 'Exists' | 'DoesNotExist';
  values?: string[];
}

export interface TetrisNode {
  name: string;
  /** Allocatable CPU, e.g. "2" or "1500m". */
  cpu: string | number;
  /** Allocatable memory, e.g. "4Gi". */
  memory: string;
  labels?: Record<string, string>;
  taints?: Taint[];
  /** Cordoned (kubectl cordon). */
  unschedulable?: boolean;
}

export interface TetrisPod {
  name: string;
  /** CPU request, e.g. "500m". */
  cpu: string | number;
  /** Memory request, e.g. "256Mi". */
  memory: string;
  tolerations?: Toleration[];
  nodeSelector?: Record<string, string>;
  /** requiredDuringSchedulingIgnoredDuringExecution, one term (all expressions must match). */
  affinity?: AffinityTerm[];
  /** Start already on this node. */
  node?: string;
}

export type Reason = 'unschedulable' | 'taint' | 'affinity' | 'cpu' | 'memory';

export interface Fit {
  fits: boolean;
  reasons: Reason[];
  /** Preemption could never help on this node. */
  unresolvable: boolean;
}

/** Where every pod is: a node name, 'pending', or null (still in the rack). */
export type Placement = Record<string, string | null>;

const REASON_TEXT: Record<Reason, string> = {
  unschedulable: 'node(s) were unschedulable',
  taint: 'node(s) had untolerated taint(s)',
  affinity: "node(s) didn't match Pod's node affinity/selector",
  cpu: 'Insufficient cpu',
  memory: 'Insufficient memory',
};

export const cpuOf = (v: string | number) => {
  const q = parseQuantity(v);
  return 'value' in q ? q.value : NaN;
};
export const memOf = cpuOf;

/** Does this toleration tolerate this taint? (Kubernetes' ToleratesTaint) */
export function tolerates(t: Toleration, taint: Taint): boolean {
  if (t.effect && t.effect !== taint.effect) return false;
  if (t.key && t.key !== taint.key) return false;
  if (!t.key && t.operator !== 'Exists') return false;
  if (t.operator === 'Exists') return true;
  return (t.value ?? '') === (taint.value ?? '');
}

/** Taints that block scheduling and that no toleration covers. */
export function untoleratedTaints(node: TetrisNode, tolerations: Toleration[] = []): Taint[] {
  return (node.taints ?? []).filter(
    (taint) => taint.effect !== 'PreferNoSchedule' && !tolerations.some((t) => tolerates(t, taint)),
  );
}

export function matchesNode(pod: TetrisPod, node: TetrisNode): boolean {
  const labels = node.labels ?? {};
  for (const [k, v] of Object.entries(pod.nodeSelector ?? {})) if (labels[k] !== v) return false;
  for (const term of pod.affinity ?? []) {
    const has = term.key in labels;
    const vals = term.values ?? [];
    if (term.operator === 'In' && !(has && vals.includes(labels[term.key]!))) return false;
    if (term.operator === 'NotIn' && has && vals.includes(labels[term.key]!)) return false;
    if (term.operator === 'Exists' && !has) return false;
    if (term.operator === 'DoesNotExist' && has) return false;
  }
  return true;
}

export interface Usage {
  cpu: number;
  memory: number;
}

export function usage(
  node: TetrisNode,
  pods: TetrisPod[],
  placement: Placement,
  except?: string,
): Usage {
  let cpu = 0;
  let memory = 0;
  for (const p of pods) {
    if (p.name === except || placement[p.name] !== node.name) continue;
    cpu += cpuOf(p.cpu);
    memory += memOf(p.memory);
  }
  return { cpu, memory };
}

/** Would `pod` fit on `node`, given where the other pods are? */
export function fit(
  pod: TetrisPod,
  node: TetrisNode,
  pods: TetrisPod[],
  placement: Placement,
  tolerations: Toleration[] = pod.tolerations ?? [],
): Fit {
  if (
    node.unschedulable &&
    !tolerations.some((t) =>
      tolerates(t, { key: 'node.kubernetes.io/unschedulable', effect: 'NoSchedule' }),
    )
  ) {
    return { fits: false, reasons: ['unschedulable'], unresolvable: true };
  }
  if (untoleratedTaints(node, tolerations).length)
    return { fits: false, reasons: ['taint'], unresolvable: true };
  if (!matchesNode(pod, node)) return { fits: false, reasons: ['affinity'], unresolvable: true };
  const used = usage(node, pods, placement, pod.name);
  const reasons: Reason[] = [];
  let unresolvable = false;
  const cpu = cpuOf(pod.cpu);
  const mem = memOf(pod.memory);
  if (used.cpu + cpu > cpuOf(node.cpu) + 1e-9) {
    reasons.push('cpu');
    if (cpu > cpuOf(node.cpu) + 1e-9) unresolvable = true;
  }
  if (used.memory + mem > memOf(node.memory)) {
    reasons.push('memory');
    if (mem > memOf(node.memory)) unresolvable = true;
  }
  return { fits: reasons.length === 0, reasons, unresolvable };
}

/** Nodes the pod fits on right now. */
export function fitsOn(
  pod: TetrisPod,
  nodes: TetrisNode[],
  pods: TetrisPod[],
  placement: Placement,
  tolerations?: Toleration[],
): string[] {
  return nodes.filter((n) => fit(pod, n, pods, placement, tolerations).fits).map((n) => n.name);
}

const counted = (counts: Map<string, number>) =>
  [...counts]
    .map(([text, n]) => `${n} ${text}`)
    .sort()
    .join(', ');

/** kube-scheduler's FailedScheduling message for a pod that fits nowhere (null if it fits somewhere). */
export function schedulerMessage(
  pod: TetrisPod,
  nodes: TetrisNode[],
  pods: TetrisPod[],
  placement: Placement,
  tolerations?: Toleration[],
): string | null {
  const fail = new Map<string, number>();
  const pre = new Map<string, number>();
  for (const n of nodes) {
    const f = fit(pod, n, pods, placement, tolerations);
    if (f.fits) return null;
    for (const r of f.reasons) fail.set(REASON_TEXT[r], (fail.get(REASON_TEXT[r]) ?? 0) + 1);
    const p = f.unresolvable
      ? 'Preemption is not helpful for scheduling'
      : 'No preemption victims found for incoming pod';
    pre.set(p, (pre.get(p) ?? 0) + 1);
  }
  const total = nodes.length;
  return `0/${total} nodes are available: ${counted(fail)}. preemption: 0/${total} nodes are available: ${counted(pre)}.`;
}

/** The main reason a pod can't go on one node (for kind feedback). */
export function mainReason(f: Fit): Reason | null {
  return f.fits ? null : f.reasons[0]!;
}

export interface TetrisTask {
  type: 'placeAll';
  /** Pods that must end in the Pending bin (they fit nowhere). */
  pending?: string[];
}

/** Is the board finished? Every pod is on a node it fits, or Pending because it fits nowhere. */
export function checkBoard(
  task: TetrisTask,
  nodes: TetrisNode[],
  pods: TetrisPod[],
  placement: Placement,
  keys: Record<string, Toleration[]> = {},
): { done: boolean; waiting: string[]; wrongPending: string[]; missingPending: string[] } {
  const tol = (p: TetrisPod) => [...(p.tolerations ?? []), ...(keys[p.name] ?? [])];
  const waiting = pods.filter((p) => !placement[p.name]).map((p) => p.name);
  const wrongPending = pods
    .filter(
      (p) =>
        placement[p.name] === 'pending' && fitsOn(p, nodes, pods, placement, tol(p)).length > 0,
    )
    .map((p) => p.name);
  const want = new Set(task.pending ?? []);
  const missingPending = task.pending
    ? pods.filter((p) => want.has(p.name) !== (placement[p.name] === 'pending')).map((p) => p.name)
    : [];
  return {
    done: !waiting.length && !wrongPending.length && !missingPending.length,
    waiting,
    wrongPending,
    missingPending,
  };
}

/** Find a finished board (for author checks): every non-pending pod placed, pending ones fit nowhere. */
export function solve(
  task: TetrisTask,
  nodes: TetrisNode[],
  pods: TetrisPod[],
  keys: Record<string, Toleration[]> = {},
): Placement | null {
  const pending = new Set(task.pending ?? []);
  const tol = (p: TetrisPod) => [...(p.tolerations ?? []), ...(keys[p.name] ?? [])];
  const placement: Placement = Object.fromEntries(pods.map((p) => [p.name, p.node ?? null]));
  const order = pods.filter((p) => !p.node && !pending.has(p.name));
  const go = (i: number): boolean => {
    if (i === order.length) {
      for (const p of pods) if (pending.has(p.name)) placement[p.name] = 'pending';
      return checkBoard(task, nodes, pods, placement, keys).done;
    }
    const p = order[i]!;
    for (const n of fitsOn(p, nodes, pods, placement, tol(p))) {
      placement[p.name] = n;
      if (go(i + 1)) return true;
      placement[p.name] = null;
    }
    return false;
  };
  return go(0) ? placement : null;
}

/** The pod as YAML lines (for the "show the state" panel). */
export function podYaml(pod: TetrisPod, extra: Toleration[] = []): string {
  const lines = ['apiVersion: v1', 'kind: Pod', 'metadata:', `  name: ${pod.name}`, 'spec:'];
  if (pod.nodeSelector && Object.keys(pod.nodeSelector).length) {
    lines.push('  nodeSelector:');
    for (const [k, v] of Object.entries(pod.nodeSelector))
      lines.push(`    ${k}: ${JSON.stringify(v)}`);
  }
  const tols = [...(pod.tolerations ?? []), ...extra];
  if (tols.length) {
    lines.push('  tolerations:');
    for (const t of tols) {
      const parts = [
        t.key !== undefined && `key: ${JSON.stringify(t.key)}`,
        `operator: ${t.operator ?? 'Equal'}`,
        t.value !== undefined && `value: ${JSON.stringify(t.value)}`,
        t.effect && `effect: ${t.effect}`,
      ].filter(Boolean) as string[];
      lines.push(`    - ${parts[0]}`, ...parts.slice(1).map((p) => `      ${p}`));
    }
  }
  lines.push(
    '  containers:',
    '    - name: app',
    '      image: nginx:1.29-alpine',
    '      resources:',
    '        requests:',
    `          cpu: ${JSON.stringify(String(pod.cpu))}`,
    `          memory: ${JSON.stringify(pod.memory)}`,
  );
  return lines.join('\n') + '\n';
}

/** A taint as kubectl writes it: key=value:Effect */
export function taintText(t: Taint): string {
  return `${t.key}${t.value ? `=${t.value}` : ''}:${t.effect}`;
}

/** A toleration in short form, e.g. dedicated=gpu:NoSchedule or dedicated (Exists). */
export function tolerationText(t: Toleration): string {
  if (t.operator === 'Exists') return `${t.key ?? '*'}${t.effect ? `:${t.effect}` : ''}`;
  return `${t.key ?? ''}${t.value ? `=${t.value}` : ''}${t.effect ? `:${t.effect}` : ''}`;
}
