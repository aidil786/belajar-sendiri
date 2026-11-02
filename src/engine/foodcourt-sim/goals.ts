// Goals for the food-court simulator (`FoodCourtSim` goal prop). All keys are optional;
// every key given must pass. Selectors are kubectl label selectors ("app=shop").
import { httpGet } from './network';
import { componentServing, cpNode, SNAPSHOT_MARK } from './node/os';
import { authorize, impersonate } from './rbac';
import { byKind, findResource } from './resources';
import { currentContext, currentNamespace, getObj, isTerminating, listObjs, ownedBy, podReady, podStatusText, restartCount } from './store';
import type { Cluster, KObject, KubeState } from './types';
import { clone, matches, parseSelector } from './util';
import { revisionOf } from './controllers/workloads';

export interface ObjRef {
  kind: string;
  name: string;
  namespace?: string;
}

export interface KubeGoal {
  /** At least `count` Ready pods match the selector (exactly `count` with `exact`). */
  podsReady?: { selector: string; count: number; exact?: boolean; namespace?: string };
  /** A Deployment's pod template uses this image (first container, or `container`). */
  deploymentImage?: { name: string; image: string; container?: string; namespace?: string };
  /** spec.replicas of a Deployment (or StatefulSet / ReplicaSet with `kind`). */
  replicas?: { name: string; count: number; kind?: string; namespace?: string };
  /** The Deployment's rollout is done (all new pods available, old ones gone), optionally at a revision. */
  rolloutComplete?: { name: string; revision?: number; minRevision?: number; namespace?: string };
  /** The Service has this many Ready endpoints (`count`) or at least `min`. */
  serviceEndpoints?: { name: string; count?: number; min?: number; namespace?: string };
  /** A request gets an answer: from the laptop (default) or from a pod (`from`: a selector or pod name). */
  reachable?: { url: string; from?: string; status?: number; contains?: string; host?: string; namespace?: string };
  /** A request does not get through (timeout, refused, DNS or an error status). */
  unreachable?: { url: string; from?: string; namespace?: string };
  /** The current context. */
  contextIs?: string;
  /** The current context's namespace. */
  namespaceIs?: string;
  /** Objects that must exist / be gone: "deployment/shop", "food/configmap/menu", or { kind, name, namespace }. */
  objectExists?: (string | ObjRef)[];
  objectMissing?: (string | ObjRef)[];
  /** `kubectl auth can-i` gives this answer. */
  canI?: { verb: string; resource: string; as?: string; namespace?: string; allowed: boolean }[];
  /** Total restarts of matching pods is at least `min`. */
  restarts?: { selector: string; min: number; namespace?: string };
  /** Some matching pod shows this STATUS (Running, CrashLoopBackOff, Pending, OOMKilled …). */
  podStatus?: { selector: string; status: string; namespace?: string };
  /** No matching pod shows this STATUS. */
  noPodStatus?: { selector: string; status: string; namespace?: string };
  /** The HPA's current replicas is at least `min`. */
  hpaReplicas?: { name: string; min: number; namespace?: string };
  /** A node is cordoned (true) or schedulable (false). */
  nodeCordoned?: { name: string; cordoned: boolean };
  /** A node's labels / an object's labels include these. */
  labels?: { kind: string; name: string; labels: Record<string, string>; namespace?: string };
  /** A namespace has this Pod Security enforce level. */
  podSecurity?: { namespace: string; level: string };
  /** An open port-forward on this local port. */
  portForward?: number;
  /** Regex any typed command matches / the last typed command matches. */
  typed?: string;
  lastTyped?: string;
  /** K9: a node's Ready condition is True (`ready`, default true) or not. */
  nodeReady?: { name: string; ready?: boolean };
  /** K9: a static pod (`kube-scheduler`, or its full mirror pod name) runs and is ready on its node (default: the control plane). */
  staticPodRunning?: { name: string; node?: string; running?: boolean };
  /** K9: an etcd snapshot file exists on the control-plane node (at `path`, or anywhere). */
  snapshotTaken?: { path?: string };
  /** K9: the Deployment came back from an etcd snapshot (same object as in the snapshot, after a restore) and its pods are ready. */
  deploymentRestored?: { name: string; namespace?: string };
}

export interface GoalResult {
  ok: boolean;
  /** Keys that did not pass (for hints and tests). */
  failed: string[];
}

function ns(state: KubeState, x?: string): string {
  return x ?? currentNamespace(state);
}

function pods(c: Cluster, namespace: string, selector: string): KObject[] {
  const reqs = parseSelector(selector);
  return listObjs(c, 'Pod', namespace).filter((p) => matches(p.metadata.labels, reqs));
}

/** "deployment/shop", "food/configmap/menu" → a reference. */
export function parseRef(ref: string | ObjRef, dfltNs: string): ObjRef | null {
  if (typeof ref !== 'string') return { ...ref, namespace: ref.namespace ?? dfltNs };
  const parts = ref.split('/');
  const [nsPart, kindPart, name] = parts.length === 3 ? parts : [dfltNs, parts[0], parts[1]];
  const r = findResource(kindPart ?? '');
  if (!r || !name) return null;
  return { kind: r.kind, name, namespace: nsPart };
}

function exists(c: Cluster, ref: ObjRef): boolean {
  const r = byKind(ref.kind);
  const o = getObj(c, ref.kind, r?.namespaced ? ref.namespace : undefined, ref.name);
  return Boolean(o && !isTerminating(o));
}

/** A control-plane mirror pod also has to run its current manifest (not a stale copy). */
function controlPlaneServing(c: Cluster, p: KObject): boolean {
  const comp = p.metadata.labels?.component;
  return comp && p.metadata.labels?.tier === 'control-plane' ? componentServing(c, comp) : true;
}

export function checkGoal(state: KubeState, goal: KubeGoal, typed: string[] = []): GoalResult {
  const failed: string[] = [];
  const ctx = currentContext(state);
  const c = ctx ? state.clusters[ctx.cluster] : undefined;
  const check = (key: string, ok: boolean) => {
    if (!ok) failed.push(key);
  };
  if (!c) return { ok: false, failed: ['cluster'] };
  if (goal.podsReady) {
    const g = goal.podsReady;
    const n = pods(c, ns(state, g.namespace), g.selector).filter((p) => podReady(p) && !isTerminating(p)).length;
    check('podsReady', g.exact ? n === g.count : n >= g.count);
  }
  if (goal.deploymentImage) {
    const g = goal.deploymentImage;
    const d = getObj(c, 'Deployment', ns(state, g.namespace), g.name);
    const ctr = d?.spec.template.spec.containers.find((x: any) => !g.container || x.name === g.container);
    check('deploymentImage', ctr?.image === g.image);
  }
  if (goal.replicas) {
    const g = goal.replicas;
    const o = getObj(c, g.kind ?? 'Deployment', ns(state, g.namespace), g.name);
    check('replicas', o?.spec?.replicas === g.count);
  }
  if (goal.rolloutComplete) {
    const g = goal.rolloutComplete;
    const d = getObj(c, 'Deployment', ns(state, g.namespace), g.name);
    const prog = d?.status?.conditions?.find((x: any) => x.type === 'Progressing');
    const rev = Number(d?.metadata.annotations?.['deployment.kubernetes.io/revision'] ?? 0);
    const done =
      Boolean(d) &&
      prog?.reason === 'NewReplicaSetAvailable' &&
      d!.status.updatedReplicas === d!.spec.replicas &&
      (d!.status.availableReplicas ?? 0) === d!.spec.replicas &&
      (d!.status.replicas ?? 0) === d!.spec.replicas &&
      (d!.metadata.generation ?? 0) <= (d!.status.observedGeneration ?? 0);
    check('rolloutComplete', done && (g.revision === undefined || rev === g.revision) && (g.minRevision === undefined || rev >= g.minRevision));
  }
  if (goal.serviceEndpoints) {
    const g = goal.serviceEndpoints;
    const slices = listObjs(c, 'EndpointSlice', ns(state, g.namespace)).filter((s) => s.metadata.labels?.['kubernetes.io/service-name'] === g.name);
    const n = slices.flatMap((s) => (s.endpoints ?? []).filter((e: any) => e.conditions?.ready)).length;
    check('serviceEndpoints', Boolean(getObj(c, 'Service', ns(state, g.namespace), g.name)) && (g.count !== undefined ? n === g.count : n >= (g.min ?? 1)));
  }
  const request = (url: string, from: string | undefined, namespace: string | undefined, host?: string) => {
    const s = clone(state);
    const cc = s.clusters[ctx!.cluster]!;
    const space = ns(s, namespace);
    let src: { kind: 'pod'; pod: KObject } | { kind: 'laptop'; context: string } = { kind: 'laptop', context: s.currentContext };
    if (from) {
      const p = listObjs(cc, 'Pod', space).find((x) => x.metadata.name === from && !isTerminating(x)) ?? pods(cc, space, from).find((x) => podReady(x) && !isTerminating(x));
      if (!p) return null;
      src = { kind: 'pod', pod: p };
    }
    return httpGet({ state: s, c: cc, ev: [] }, src, url, host ? { hostHeader: host } : {});
  };
  if (goal.reachable) {
    const g = goal.reachable;
    const r = request(g.url, g.from, g.namespace, g.host);
    check('reachable', Boolean(r && r.ok && r.status !== null && (g.status !== undefined ? r.status === g.status : r.status < 400) && (!g.contains || r.body.includes(g.contains))));
  }
  if (goal.unreachable) {
    const g = goal.unreachable;
    const r = request(g.url, g.from, g.namespace);
    check('unreachable', Boolean(r && (!r.ok || r.status === null || r.status >= 400)));
  }
  if (goal.contextIs !== undefined) check('contextIs', state.currentContext === goal.contextIs);
  if (goal.namespaceIs !== undefined) check('namespaceIs', currentNamespace(state) === goal.namespaceIs);
  for (const ref of goal.objectExists ?? []) {
    const r = parseRef(ref, currentNamespace(state));
    check('objectExists', Boolean(r && exists(c, r)));
  }
  for (const ref of goal.objectMissing ?? []) {
    const r = parseRef(ref, currentNamespace(state));
    check('objectMissing', Boolean(r && !exists(c, r)));
  }
  for (const q of goal.canI ?? []) {
    const r = findResource(q.resource.split('/')[0]!);
    const who = q.as ? impersonate(q.as) : (state.users[ctx!.user] ?? { user: 'kubernetes-admin', groups: ['kubeadm:cluster-admins', 'system:authenticated'] });
    const yes = Boolean(r) && authorize(c, who, { verb: q.verb, group: r!.group, resource: r!.plural, ...(q.resource.includes('/') ? { subresource: q.resource.split('/')[1] } : {}), ...(r!.namespaced ? { namespace: ns(state, q.namespace) } : {}) });
    check('canI', yes === q.allowed);
  }
  if (goal.restarts) {
    const g = goal.restarts;
    check('restarts', pods(c, ns(state, g.namespace), g.selector).reduce((n, p) => n + restartCount(p), 0) >= g.min);
  }
  if (goal.podStatus) {
    const g = goal.podStatus;
    check('podStatus', pods(c, ns(state, g.namespace), g.selector).some((p) => podStatusText(p) === g.status));
  }
  if (goal.noPodStatus) {
    const g = goal.noPodStatus;
    check('noPodStatus', !pods(c, ns(state, g.namespace), g.selector).some((p) => podStatusText(p) === g.status));
  }
  if (goal.hpaReplicas) {
    const g = goal.hpaReplicas;
    const h = getObj(c, 'HorizontalPodAutoscaler', ns(state, g.namespace), g.name);
    check('hpaReplicas', (h?.status?.currentReplicas ?? 0) >= g.min || (h ? (getObj(c, h.spec.scaleTargetRef.kind, h.metadata.namespace, h.spec.scaleTargetRef.name)?.spec?.replicas ?? 0) >= g.min : false));
  }
  if (goal.nodeCordoned) {
    const n = getObj(c, 'Node', undefined, goal.nodeCordoned.name);
    check('nodeCordoned', Boolean(n) && Boolean(n!.spec.unschedulable) === goal.nodeCordoned.cordoned);
  }
  if (goal.labels) {
    const g = goal.labels;
    const r = findResource(g.kind);
    const o = r ? getObj(c, r.kind, r.namespaced ? ns(state, g.namespace) : undefined, g.name) : undefined;
    check('labels', Boolean(o) && Object.entries(g.labels).every(([k, v]) => o!.metadata.labels?.[k] === v));
  }
  if (goal.podSecurity) {
    const n = getObj(c, 'Namespace', undefined, goal.podSecurity.namespace);
    check('podSecurity', n?.metadata.labels?.['pod-security.kubernetes.io/enforce'] === goal.podSecurity.level);
  }
  if (goal.portForward !== undefined) check('portForward', state.forwards.some((f) => f.local === goal.portForward && f.context === state.currentContext));
  if (goal.typed) {
    const re = new RegExp(goal.typed);
    check('typed', typed.some((t) => re.test(t)));
  }
  if (goal.lastTyped) check('lastTyped', new RegExp(goal.lastTyped).test(typed[typed.length - 1] ?? ''));
  if (goal.nodeReady) {
    const n = getObj(c, 'Node', undefined, goal.nodeReady.name);
    const ready = n?.status?.conditions?.find((x: any) => x.type === 'Ready')?.status === 'True';
    check('nodeReady', Boolean(n) && ready === (goal.nodeReady.ready ?? true));
  }
  if (goal.staticPodRunning) {
    const g = goal.staticPodRunning;
    const node = g.node ?? cpNode(c);
    const name = node && !g.name.endsWith(`-${node}`) ? `${g.name}-${node}` : g.name;
    const p = getObj(c, 'Pod', 'kube-system', name);
    const running = Boolean(p && !isTerminating(p) && podStatusText(p) === 'Running' && podReady(p) && controlPlaneServing(c, p));
    check('staticPodRunning', running === (g.running ?? true));
  }
  if (goal.snapshotTaken) {
    const node = cpNode(c);
    const files = node ? (c.nodes[node]?.os?.files ?? {}) : {};
    const own = Object.values(c.pods).flatMap((r) => Object.values(r.containers).flatMap((x) => Object.entries(x.written ?? {})));
    const all = [...Object.entries(files), ...own];
    check('snapshotTaken', all.some(([p, v]) => v.startsWith(SNAPSHOT_MARK) && (!goal.snapshotTaken!.path || p === goal.snapshotTaken!.path)));
  }
  if (goal.deploymentRestored) {
    const g = goal.deploymentRestored;
    const d = getObj(c, 'Deployment', ns(state, g.namespace), g.name);
    const fromSnap = Boolean(d && c.etcd?.restoredFrom.some((id) => Object.values(c.etcd!.snapshots[id]?.objects ?? {}).some((o) => o.metadata.uid === d.metadata.uid)));
    check('deploymentRestored', Boolean(d && !isTerminating(d) && fromSnap && (d.status?.readyReplicas ?? 0) >= (d.spec?.replicas ?? 1)));
  }
  return { ok: failed.length === 0, failed };
}

/** Every goal key (for `npm run check:mdx` and docs). */
export const GOAL_KEYS = [
  'podsReady', 'deploymentImage', 'replicas', 'rolloutComplete', 'serviceEndpoints', 'reachable', 'unreachable', 'contextIs', 'namespaceIs',
  'objectExists', 'objectMissing', 'canI', 'restarts', 'podStatus', 'noPodStatus', 'hpaReplicas', 'nodeCordoned', 'labels', 'podSecurity',
  'portForward', 'typed', 'lastTyped', 'nodeReady', 'staticPodRunning', 'snapshotTaken', 'deploymentRestored',
] as const;

export { revisionOf, ownedBy };
