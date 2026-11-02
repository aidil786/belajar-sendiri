// The object store (the API server's memory, like etcd) and small helpers around it.
// Functions here change the state they are given: callers clone first (see `mutate`).
import { byKind, objKey } from './resources';
import type { Cluster, KObject, KubeEvent, KubeState } from './types';
import { clone, iso, uid as makeUid } from './util';
import { forgetVolumes } from './volumes';

/** Run a change on a copy of the state. The state you pass in is never changed. */
export function mutate<T>(state: KubeState, fn: (s: KubeState) => T): { state: KubeState; value: T } {
  const s = clone(state);
  const value = fn(s);
  return { state: s, value };
}

export function currentContext(state: KubeState) {
  return state.contexts[state.currentContext];
}

/** The cluster the current context points at. */
export function currentCluster(state: KubeState): Cluster | undefined {
  const ctx = currentContext(state);
  return ctx ? state.clusters[ctx.cluster] : undefined;
}

export function currentNamespace(state: KubeState): string {
  return currentContext(state)?.namespace || 'default';
}

export function getObj(c: Cluster, kind: string, namespace: string | undefined, name: string): KObject | undefined {
  const r = byKind(kind);
  return c.objects[objKey(kind, r?.namespaced ? namespace : undefined, name)];
}

export function listObjs(c: Cluster, kind: string, namespace?: string): KObject[] {
  const out: KObject[] = [];
  for (const o of Object.values(c.objects)) {
    if (o.kind !== kind) continue;
    if (namespace !== undefined && o.metadata.namespace !== namespace) continue;
    out.push(o);
  }
  // etcd lists in key order: namespace, then name.
  return out.sort((a, b) => (a.metadata.namespace ?? '').localeCompare(b.metadata.namespace ?? '') || a.metadata.name.localeCompare(b.metadata.name));
}

function bump(c: Cluster): string {
  c.rv += 1;
  return String(c.rv);
}

/** Kinds whose `metadata.generation` counts spec changes. */
const GENERATION = new Set([
  'Deployment', 'ReplicaSet', 'DaemonSet', 'StatefulSet', 'Job', 'CronJob', 'Pod', 'HorizontalPodAutoscaler',
  'PodDisruptionBudget', 'NetworkPolicy', 'Ingress', 'Gateway', 'GatewayClass', 'HTTPRoute',
]);

/** Store a new object: uid, resourceVersion, creationTimestamp, generation. Returns the stored object. */
export function createObj(state: KubeState, c: Cluster, obj: KObject, events?: KubeEvent[]): KObject {
  const o = clone(obj);
  const r = byKind(o.kind);
  if (r && !r.namespaced) delete o.metadata.namespace;
  o.metadata.uid = makeUid(state);
  o.metadata.resourceVersion = bump(c);
  o.metadata.creationTimestamp = iso(state.clock);
  if (GENERATION.has(o.kind)) o.metadata.generation = 1;
  c.objects[objKey(o.kind, o.metadata.namespace, o.metadata.name)] = o;
  events?.push({ type: 'objectCreated', kind: o.kind, name: o.metadata.name, ...(o.metadata.namespace ? { namespace: o.metadata.namespace } : {}) });
  return o;
}

/** Store a changed object (new resourceVersion; generation goes up when the spec changed). */
export function updateObj(c: Cluster, obj: KObject, events?: KubeEvent[]): KObject {
  const key = objKey(obj.kind, obj.metadata.namespace, obj.metadata.name);
  const old = c.objects[key];
  if (old && GENERATION.has(obj.kind) && JSON.stringify(old.spec) !== JSON.stringify(obj.spec)) {
    obj.metadata.generation = (old.metadata.generation ?? 1) + 1;
  }
  obj.metadata.resourceVersion = bump(c);
  c.objects[key] = obj;
  events?.push({ type: 'objectUpdated', kind: obj.kind, name: obj.metadata.name, ...(obj.metadata.namespace ? { namespace: obj.metadata.namespace } : {}) });
  return obj;
}

/** Status changes don't touch generation. Skips the write when nothing changed. */
export function setStatus(c: Cluster, obj: KObject, status: any): void {
  if (JSON.stringify(obj.status) === JSON.stringify(status)) return;
  obj.status = status;
  obj.metadata.resourceVersion = bump(c);
}

export function removeObj(c: Cluster, obj: KObject, events?: KubeEvent[]): void {
  delete c.objects[objKey(obj.kind, obj.metadata.namespace, obj.metadata.name)];
  if (obj.kind === 'Pod') delete c.pods[obj.metadata.uid];
  forgetVolumes(c, obj);
  events?.push({ type: 'objectDeleted', kind: obj.kind, name: obj.metadata.name, ...(obj.metadata.namespace ? { namespace: obj.metadata.namespace } : {}) });
}

export function ownerOf(o: KObject): { kind: string; name: string; uid: string } | undefined {
  const ref = o.metadata.ownerReferences?.find((r) => r.controller);
  return ref ? { kind: ref.kind, name: ref.name, uid: ref.uid } : undefined;
}

export function ownedBy(c: Cluster, owner: KObject, kind: string): KObject[] {
  return listObjs(c, kind, owner.metadata.namespace).filter((o) => o.metadata.ownerReferences?.some((r) => r.uid === owner.metadata.uid));
}

export function controllerRef(owner: KObject) {
  return {
    apiVersion: owner.apiVersion,
    kind: owner.kind,
    name: owner.metadata.name,
    uid: owner.metadata.uid,
    controller: true,
    blockOwnerDeletion: true,
  };
}

// ---------------------------------------------------------------------------
// Events (the core/v1 Event objects `kubectl get events` and `describe` show)

export function recordEvent(
  state: KubeState,
  c: Cluster,
  about: KObject,
  type: 'Normal' | 'Warning',
  reason: string,
  message: string,
  component: string,
  host?: string,
): void {
  const ns = about.metadata.namespace ?? 'default';
  const same = Object.values(c.objects).find(
    (e) => e.kind === 'Event' && e.involvedObject?.uid === about.metadata.uid && e.reason === reason && e.message === message,
  );
  if (same) {
    same.count = (same.count ?? 1) + 1;
    same.lastTimestamp = iso(state.clock);
    same.metadata.resourceVersion = bump(c);
    return;
  }
  const ev: KObject = {
    apiVersion: 'v1',
    kind: 'Event',
    metadata: { name: `${about.metadata.name}.${(BigInt(state.clock) * 1000000000n + BigInt(++state.counter) * 1000n).toString(16)}`, namespace: ns, uid: '', resourceVersion: '', creationTimestamp: '' },
    involvedObject: {
      apiVersion: about.apiVersion,
      kind: about.kind,
      name: about.metadata.name,
      namespace: about.metadata.namespace,
      uid: about.metadata.uid,
      resourceVersion: about.metadata.resourceVersion,
    },
    reason,
    message,
    type,
    source: host ? { component, host } : { component },
    firstTimestamp: iso(state.clock),
    lastTimestamp: iso(state.clock),
    count: 1,
    reportingComponent: component,
    reportingInstance: host ?? '',
  };
  createObj(state, c, ev);
}

export function eventsFor(c: Cluster, o: KObject): KObject[] {
  return Object.values(c.objects)
    .filter((e) => e.kind === 'Event' && e.involvedObject?.uid === o.metadata.uid)
    .sort((a, b) => String(a.lastTimestamp).localeCompare(String(b.lastTimestamp)) || a.metadata.name.localeCompare(b.metadata.name));
}

// ---------------------------------------------------------------------------
// Pods

export function isTerminating(o: KObject): boolean {
  return Boolean(o.metadata.deletionTimestamp);
}

export function podReady(pod: KObject): boolean {
  return pod.status?.conditions?.some((c: any) => c.type === 'Ready' && c.status === 'True') ?? false;
}

/** Counts toward a ReplicaSet: not finished, not being deleted. */
export function podActive(pod: KObject): boolean {
  return !isTerminating(pod) && pod.status?.phase !== 'Succeeded' && pod.status?.phase !== 'Failed';
}

/** The STATUS column of `kubectl get pods`, worked out like kubectl's printPod. */
export function podStatusText(pod: KObject): string {
  const st = pod.status ?? {};
  let reason: string = st.reason || st.phase || 'Pending';
  const inits: any[] = st.initContainerStatuses ?? [];
  const initSpecs: any[] = pod.spec?.initContainers ?? [];
  let initializing = false;
  for (let i = 0; i < inits.length; i++) {
    const c = inits[i];
    const sidecar = initSpecs[i]?.restartPolicy === 'Always';
    if (c.state?.terminated && c.state.terminated.exitCode === 0) continue;
    if (sidecar && c.started) continue;
    if (c.state?.terminated) {
      reason = c.state.terminated.reason ? `Init:${c.state.terminated.reason}` : `Init:ExitCode:${c.state.terminated.exitCode}`;
    } else if (c.state?.waiting?.reason && c.state.waiting.reason !== 'PodInitializing') {
      reason = `Init:${c.state.waiting.reason}`;
    } else reason = `Init:${i}/${initSpecs.length}`;
    initializing = true;
    break;
  }
  if (!initializing) {
    let hasRunning = false;
    const cs: any[] = st.containerStatuses ?? [];
    for (let i = cs.length - 1; i >= 0; i--) {
      const c = cs[i];
      if (c.state?.waiting?.reason) reason = c.state.waiting.reason;
      else if (c.state?.terminated?.reason) reason = c.state.terminated.reason;
      else if (c.state?.terminated) reason = `ExitCode:${c.state.terminated.exitCode}`;
      else if (c.ready && c.state?.running) hasRunning = true;
    }
    if (reason === 'Completed' && hasRunning) reason = podReady(pod) ? 'Running' : 'NotReady';
  }
  if (pod.metadata.deletionTimestamp) reason = st.reason === 'NodeLost' ? 'Unknown' : 'Terminating';
  return reason;
}

/**
 * READY and RESTARTS of `kubectl get pods`, worked out like kubectl's printPod: native sidecars
 * (init containers with restartPolicy: Always) count in READY once started, and init-container
 * restarts count while the pod is still initializing.
 */
function podCounts(pod: KObject): { ready: number; total: number; restarts: number } {
  const st = pod.status ?? {};
  const initSpecs: any[] = pod.spec?.initContainers ?? [];
  const isSidecar = (name: string) => initSpecs.find((c) => c.name === name)?.restartPolicy === 'Always';
  let total = pod.spec?.containers?.length ?? 0;
  total += initSpecs.filter((c) => c.restartPolicy === 'Always').length;
  let ready = 0;
  let restarts = 0;
  let sidecarRestarts = 0;
  let initializing = false;
  for (const c of (st.initContainerStatuses ?? []) as any[]) {
    restarts += c.restartCount ?? 0;
    if (isSidecar(c.name)) sidecarRestarts += c.restartCount ?? 0;
    if (c.state?.terminated && c.state.terminated.exitCode === 0) continue;
    if (isSidecar(c.name) && c.started) {
      if (c.ready) ready++;
      continue;
    }
    initializing = true;
    break;
  }
  const initialized = ((st.conditions ?? []) as any[]).some((c) => c.type === 'Initialized' && c.status === 'True');
  if (!initializing || initialized) {
    restarts = sidecarRestarts;
    for (const c of (st.containerStatuses ?? []) as any[]) {
      restarts += c.restartCount ?? 0;
      if (c.ready && c.state?.running) ready++;
    }
  }
  return { ready, total, restarts };
}

export function readyText(pod: KObject): string {
  const { ready, total } = podCounts(pod);
  return `${ready}/${total}`;
}

export function restartCount(pod: KObject): number {
  return podCounts(pod).restarts;
}

export function nodeReady(node: KObject): boolean {
  return node.status?.conditions?.some((c: any) => c.type === 'Ready' && c.status === 'True') ?? false;
}
