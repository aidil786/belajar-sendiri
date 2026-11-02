// View models for the UI: the food-court picture (stalls, trays, order numbers,
// entrance) and the Manager's board (Want / See / Do). Pure functions of the state.
import { currentCluster, currentContext, currentNamespace, getObj, isTerminating, listObjs, ownedBy, podReady, podStatusText, readyText, restartCount } from './store';
import type { KObject, KubeEvent, KubeState } from './types';
import { mapSelects, selectorMatches } from './util';

export type TrayState = 'ready' | 'starting' | 'pending' | 'failed' | 'terminating' | 'done';

export interface Tray {
  name: string;
  namespace: string;
  /** What it belongs to: "Deployment/shop", "StatefulSet/db", "Pod" (alone). */
  owner: string;
  /** The `app` (or `k8s-app`) label: groups trays by dish. */
  app: string;
  state: TrayState;
  /** kubectl's STATUS column (Running, Pending, CrashLoopBackOff …). */
  status: string;
  ready: string;
  restarts: number;
  ip: string | null;
  system: boolean;
}

export interface Stall {
  name: string;
  role: 'control-plane' | 'worker';
  ready: 'ready' | 'notReady' | 'unknown';
  cordoned: boolean;
  /** Taints other than the usual control-plane one. */
  taints: string[];
  trays: Tray[];
  cpuUsed: number;
  cpuTotal: number;
}

export interface OrderNumber {
  name: string;
  namespace: string;
  type: string;
  clusterIP: string;
  ports: string;
  /** Trays the order number reaches (Ready endpoints) and all trays it selects. */
  ready: number;
  total: number;
  /** Tray names behind it. */
  trays: string[];
}

export interface Entrance {
  name: string;
  address: string;
  programmed: boolean;
  routes: { path: string; service: string }[];
}

export interface Picture {
  cluster: string;
  context: string;
  namespace: string;
  clock: number;
  stalls: Stall[];
  /** Trays no stall took yet (unscheduled). */
  waiting: Tray[];
  services: OrderNumber[];
  gateways: Entrance[];
}

const SYSTEM_NS = ['kube-system', 'kube-public', 'kube-node-lease', 'local-path-storage', 'envoy-gateway-system'];

export function trayState(p: KObject): TrayState {
  const s = podStatusText(p);
  if (isTerminating(p)) return 'terminating';
  if (p.status?.phase === 'Succeeded' || s === 'Completed') return 'done';
  if (/BackOff|Err|Error|OOMKilled|Failed|Invalid|CreateContainerConfigError|Unknown|ExitCode/.test(s)) return 'failed';
  if (!p.spec.nodeName) return 'pending';
  if (podReady(p)) return 'ready';
  return 'starting';
}

function ownerOf(c: ReturnType<typeof currentCluster>, p: KObject): string {
  const ref = p.metadata.ownerReferences?.find((r) => r.controller);
  if (!ref) return 'Pod';
  if (ref.kind === 'ReplicaSet' && c) {
    const rs = getObj(c, 'ReplicaSet', p.metadata.namespace, ref.name);
    const dep = rs?.metadata.ownerReferences?.find((r) => r.controller);
    if (dep) return `${dep.kind}/${dep.name}`;
  }
  return `${ref.kind}/${ref.name}`;
}

export function toTray(state: KubeState, p: KObject): Tray {
  const c = currentCluster(state);
  return {
    name: p.metadata.name,
    namespace: p.metadata.namespace!,
    owner: ownerOf(c, p),
    app: p.metadata.labels?.app ?? p.metadata.labels?.['app.kubernetes.io/name'] ?? p.metadata.labels?.['k8s-app'] ?? p.metadata.labels?.component ?? p.metadata.name,
    state: trayState(p),
    status: podStatusText(p),
    ready: readyText(p),
    restarts: restartCount(p),
    ip: p.status?.podIP ?? null,
    system: SYSTEM_NS.includes(p.metadata.namespace!),
  };
}

/** The picture for the current context. `namespace: 'all'` shows every namespace. */
export function picture(state: KubeState, opts: { namespace?: string; showSystem?: boolean } = {}): Picture | null {
  const c = currentCluster(state);
  if (!c) return null;
  const ns = opts.namespace ?? currentNamespace(state);
  const inScope = (p: KObject) => (ns === 'all' ? opts.showSystem || !SYSTEM_NS.includes(p.metadata.namespace!) : p.metadata.namespace === ns || (opts.showSystem && SYSTEM_NS.includes(p.metadata.namespace!)));
  const pods = listObjs(c, 'Pod').filter(inScope);
  const stalls: Stall[] = listObjs(c, 'Node').map((n) => {
    const ready = n.status?.conditions?.find((x: any) => x.type === 'Ready')?.status;
    const req = listObjs(c, 'Pod')
      .filter((p) => p.spec.nodeName === n.metadata.name && p.status?.phase !== 'Succeeded' && p.status?.phase !== 'Failed')
      .reduce((s, p) => s + (p.spec.containers ?? []).reduce((m: number, ct: any) => m + (String(ct.resources?.requests?.cpu ?? '0').endsWith('m') ? Number(String(ct.resources.requests.cpu).slice(0, -1)) : Number(ct.resources?.requests?.cpu ?? 0) * 1000), 0), 0);
    const total = String(n.status?.allocatable?.cpu ?? '0');
    return {
      name: n.metadata.name,
      role: n.metadata.labels?.['node-role.kubernetes.io/control-plane'] !== undefined ? 'control-plane' : 'worker',
      ready: ready === 'True' ? 'ready' : ready === 'False' ? 'notReady' : 'unknown',
      cordoned: Boolean(n.spec.unschedulable),
      taints: (n.spec.taints ?? []).filter((t: any) => t.key !== 'node-role.kubernetes.io/control-plane' && t.key !== 'node.kubernetes.io/unschedulable').map((t: any) => `${t.key}${t.value ? `=${t.value}` : ''}:${t.effect}`),
      trays: pods.filter((p) => p.spec.nodeName === n.metadata.name).map((p) => toTray(state, p)),
      cpuUsed: req,
      cpuTotal: total.endsWith('m') ? Number(total.slice(0, -1)) : Number(total) * 1000,
    };
  });
  const services: OrderNumber[] = listObjs(c, 'Service', ns === 'all' ? undefined : ns)
    .filter((s) => s.spec.selector && (opts.showSystem || !SYSTEM_NS.includes(s.metadata.namespace!)))
    .map((s) => {
      const behind = listObjs(c, 'Pod', s.metadata.namespace).filter((p) => mapSelects(s.spec.selector, p.metadata.labels) && !isTerminating(p));
      return {
        name: s.metadata.name,
        namespace: s.metadata.namespace!,
        type: s.spec.type ?? 'ClusterIP',
        clusterIP: s.spec.clusterIP ?? '',
        ports: (s.spec.ports ?? []).map((p: any) => `${p.port}/${p.protocol ?? 'TCP'}`).join(','),
        ready: behind.filter(podReady).length,
        total: behind.length,
        trays: behind.map((p) => p.metadata.name),
      };
    });
  const gateways: Entrance[] = listObjs(c, 'Gateway', ns === 'all' ? undefined : ns).map((g) => ({
    name: g.metadata.name,
    address: g.status?.addresses?.[0]?.value ?? '',
    programmed: g.status?.conditions?.some((x: any) => x.type === 'Programmed' && x.status === 'True') ?? false,
    routes: listObjs(c, 'HTTPRoute')
      .filter((r) => (r.spec.parentRefs ?? []).some((p: any) => p.name === g.metadata.name))
      .flatMap((r) => (r.spec.rules ?? []).map((rule: any) => ({ path: rule.matches?.[0]?.path?.value ?? '/', service: rule.backendRefs?.[0]?.name ?? '' }))),
  }));
  return {
    cluster: c.name,
    context: state.currentContext,
    namespace: ns,
    clock: state.clock,
    stalls,
    waiting: pods.filter((p) => !p.spec.nodeName).map((p) => toTray(state, p)),
    services,
    gateways,
  };
}

// ---------------------------------------------------------------------------
// The Manager's board

export interface Board {
  kind: string;
  name: string;
  namespace: string;
  /** spec.replicas: what is written on the order board. */
  want: number;
  /** Pods that count (not finished, not being deleted). */
  see: number;
  /** Of those, Ready. */
  ready: number;
  /** What the controller does about the gap. */
  doing: 'none' | 'create' | 'delete';
  count: number;
  exists: boolean;
}

/** The board for one Deployment (default: the first in the namespace) or StatefulSet. */
export function board(state: KubeState, target?: { name?: string; kind?: string; namespace?: string }): Board | null {
  const c = currentCluster(state);
  if (!c) return null;
  const ns = target?.namespace ?? currentNamespace(state);
  const kind = target?.kind ?? 'Deployment';
  const o = target?.name ? getObj(c, kind, ns, target.name) : listObjs(c, kind, ns)[0];
  if (!o) return target?.name ? { kind, name: target.name, namespace: ns, want: 0, see: 0, ready: 0, doing: 'none', count: 0, exists: false } : null;
  const podsOf = kind === 'Deployment' ? ownedBy(c, o, 'ReplicaSet').flatMap((rs) => ownedBy(c, rs, 'Pod')) : ownedBy(c, o, 'Pod');
  const active = podsOf.filter((p) => !isTerminating(p) && p.status?.phase !== 'Succeeded' && p.status?.phase !== 'Failed');
  const want = o.spec.replicas ?? 1;
  const see = active.length;
  return {
    kind,
    name: o.metadata.name,
    namespace: ns,
    want,
    see,
    ready: active.filter(podReady).length,
    doing: see < want ? 'create' : see > want ? 'delete' : 'none',
    count: Math.abs(want - see),
    exists: true,
  };
}

/** The reconcile events that matter for a board (from a command's or a tick's events). */
export function boardEvents(events: KubeEvent[], name?: string): Extract<KubeEvent, { type: 'reconcile' }>[] {
  return events.filter((e): e is Extract<KubeEvent, { type: 'reconcile' }> => e.type === 'reconcile' && e.do !== 'none' && (!name || e.name.startsWith(`${name}-`) || e.name === name));
}

/** The pink "you are here" bar: cluster, namespace and whether it looks like production. */
export function whereAmI(state: KubeState): { context: string; cluster: string; namespace: string; user: string; prodLike: boolean } {
  const ctx = currentContext(state);
  const c = currentCluster(state);
  return {
    context: state.currentContext,
    cluster: ctx?.cluster ?? '',
    namespace: currentNamespace(state),
    user: ctx?.user ?? '',
    prodLike: c?.kind === 'cloud' || /prod/.test(state.currentContext),
  };
}

export { selectorMatches };
