// Cluster housekeeping: namespaces, garbage collection, node health and eviction,
// EndpointSlices, LoadBalancer addresses, Gateway API status, volumes, HPA and PDB status.
import { apiCreate, apiDelete } from '../api';
import { quotaStatus } from '../admission';
import { objKey } from '../resources';
import { getObj, listObjs, podReady, recordEvent, removeObj, setStatus, updateObj } from '../store';
import type { KObject } from '../types';
import { cpuMilli, fromIso, hexId, iso, mapSelects, randomSuffix, selectorMatches } from '../util';
import { behaviorOf } from './kubelet';
import { setCondition, type Ctx } from './workloads';

/** Node heartbeats stop after a "kill node" fault; after the grace period the node goes NotReady. */
export const NODE_GRACE = 50;
/** Pods tolerate an unreachable node for 300 seconds, then they are evicted. */
export const EVICTION_DELAY = 300;

export function namespaceController(ctx: Ctx): boolean {
  const { state, c, ev } = ctx;
  let changed = false;
  for (const ns of listObjs(c, 'Namespace')) {
    if (!ns.metadata.deletionTimestamp) {
      // The service account and root-CA controllers fill every new namespace.
      const name = ns.metadata.name;
      if (!getObj(c, 'ServiceAccount', name, 'default')) {
        apiCreate(state, c, { apiVersion: 'v1', kind: 'ServiceAccount', metadata: { name: 'default', namespace: name } as any });
        changed = true;
      }
      if (!getObj(c, 'ConfigMap', name, 'kube-root-ca.crt')) {
        const ca = getObj(c, 'ConfigMap', 'default', 'kube-root-ca.crt');
        if (ca) apiCreate(state, c, { apiVersion: 'v1', kind: 'ConfigMap', metadata: { name: 'kube-root-ca.crt', namespace: name, annotations: { ...(ca.metadata.annotations ?? {}) } } as any, data: { ...(ca.data ?? {}) } });
      }
      continue;
    }
    const inside = Object.values(c.objects).filter((o) => o.metadata.namespace === ns.metadata.name && o.kind !== 'Event');
    for (const o of inside) {
      if (o.kind === 'Pod') {
        if (!o.metadata.deletionTimestamp) apiDelete(state, c, 'Pod', o.metadata.namespace, o.metadata.name, { by: 'gc', events: ev });
      } else removeObj(c, o, ev);
      changed = true;
    }
    if (!Object.values(c.objects).some((o) => o.metadata.namespace === ns.metadata.name && o.kind === 'Pod')) {
      for (const e of Object.values(c.objects).filter((o) => o.metadata.namespace === ns.metadata.name)) removeObj(c, e);
      removeObj(c, ns, ev);
      changed = true;
    }
  }
  return changed;
}

/** Background cascading delete: objects whose owner is gone are deleted too. */
export function garbageCollector(ctx: Ctx): boolean {
  const { state, c, ev } = ctx;
  const uids = new Set(Object.values(c.objects).map((o) => o.metadata.uid));
  let changed = false;
  for (const o of Object.values(c.objects)) {
    const refs = o.metadata.ownerReferences;
    if (!refs?.length || o.metadata.deletionTimestamp) continue;
    if (refs.every((r) => !uids.has(r.uid))) {
      if (o.kind === 'Pod') apiDelete(state, c, 'Pod', o.metadata.namespace, o.metadata.name, { by: 'gc', events: ev });
      else removeObj(c, o, ev);
      changed = true;
    }
  }
  return changed;
}

function nodeTaint(node: KObject, key: string, effect: string, on: boolean, now: number): boolean {
  const taints: any[] = node.spec.taints ?? [];
  const has = taints.some((t) => t.key === key && t.effect === effect);
  if (on && !has) {
    node.spec.taints = [...taints, { effect, key, ...(effect === 'NoExecute' ? { timeAdded: iso(now) } : {}) }];
    return true;
  }
  if (!on && has) {
    node.spec.taints = taints.filter((t) => !(t.key === key && t.effect === effect));
    if (!node.spec.taints.length) delete node.spec.taints;
    return true;
  }
  return false;
}

/** Kubelet heartbeats, NotReady after 50 s of silence, eviction after 300 s more. */
export function nodeLifecycle(ctx: Ctx): boolean {
  const { state, c, ev } = ctx;
  const now = state.clock;
  let changed = false;
  for (const node of listObjs(c, 'Node')) {
    const rt = c.nodes[node.metadata.name];
    if (!rt) continue;
    if (rt.up) rt.heartbeat = now;
    const silent = now - rt.heartbeat > NODE_GRACE;
    const ready = node.status.conditions.find((x: any) => x.type === 'Ready');
    if (silent && ready.status === 'True') {
      for (const cond of node.status.conditions) {
        cond.status = 'Unknown';
        cond.reason = 'NodeStatusUnknown';
        cond.message = 'Kubelet stopped posting node status.';
        cond.lastTransitionTime = iso(now);
      }
      nodeTaint(node, 'node.kubernetes.io/unreachable', 'NoSchedule', true, now);
      nodeTaint(node, 'node.kubernetes.io/unreachable', 'NoExecute', true, now);
      updateObj(c, node);
      rt.notReadySince = now;
      recordEvent(state, c, node, 'Normal', 'NodeNotReady', `Node ${node.metadata.name} status is now: NodeNotReady`, 'node-controller');
      ev.push({ type: 'nodeNotReady', node: node.metadata.name });
      // Pods there are marked not ready (their endpoints go away).
      for (const p of listObjs(c, 'Pod').filter((x) => x.spec.nodeName === node.metadata.name)) {
        for (const cond of p.status?.conditions ?? []) {
          if (cond.type === 'Ready' && cond.status === 'True') {
            cond.status = 'False';
            cond.lastTransitionTime = iso(now);
          }
        }
        recordEvent(state, c, p, 'Warning', 'NodeNotReady', 'Node is not ready', 'node-controller');
        p.metadata.resourceVersion = String(++c.rv);
      }
      changed = true;
    } else if (!silent && ready.status !== 'True') {
      for (const cond of node.status.conditions) {
        const isReady = cond.type === 'Ready';
        cond.status = isReady ? 'True' : 'False';
        cond.reason = isReady ? 'KubeletReady' : cond.type === 'MemoryPressure' ? 'KubeletHasSufficientMemory' : cond.type === 'DiskPressure' ? 'KubeletHasNoDiskPressure' : 'KubeletHasSufficientPID';
        cond.message = isReady ? 'kubelet is posting ready status' : cond.message;
        cond.lastTransitionTime = iso(now);
      }
      nodeTaint(node, 'node.kubernetes.io/unreachable', 'NoSchedule', false, now);
      nodeTaint(node, 'node.kubernetes.io/unreachable', 'NoExecute', false, now);
      updateObj(c, node);
      rt.notReadySince = null;
      recordEvent(state, c, node, 'Normal', 'NodeReady', `Node ${node.metadata.name} status is now: NodeReady`, 'kubelet', node.metadata.name);
      ev.push({ type: 'nodeUp', node: node.metadata.name });
      changed = true;
    }
    // Cordon shows as a taint too.
    if (nodeTaint(node, 'node.kubernetes.io/unschedulable', 'NoSchedule', Boolean(node.spec.unschedulable), now)) {
      updateObj(c, node);
      changed = true;
    }
    // Taint-based eviction.
    const noExec: any[] = (node.spec.taints ?? []).filter((t: any) => t.effect === 'NoExecute');
    if (noExec.length) {
      for (const p of listObjs(c, 'Pod').filter((x) => x.spec.nodeName === node.metadata.name && !x.metadata.deletionTimestamp)) {
        const tols: any[] = p.spec.tolerations ?? [];
        let evict = false;
        for (const taint of noExec) {
          const tol = tols.find((t) => (t.operator === 'Exists' ? !t.key || t.key === taint.key : t.key === taint.key && (t.value ?? '') === (taint.value ?? '')) && (!t.effect || t.effect === 'NoExecute'));
          if (!tol) evict = true;
          else if (tol.tolerationSeconds !== undefined && now - fromIso(taint.timeAdded ?? iso(now)) >= tol.tolerationSeconds) evict = true;
        }
        if (evict) {
          recordEvent(state, c, p, 'Normal', 'TaintManagerEviction', `Marking for deletion Pod ${p.metadata.namespace}/${p.metadata.name}`, 'taint-eviction-controller');
          apiDelete(state, c, 'Pod', p.metadata.namespace, p.metadata.name, { by: 'eviction', events: ev });
          ev.push({ type: 'podEvicted', pod: p.metadata.name, namespace: p.metadata.namespace!, node: node.metadata.name });
          changed = true;
        }
      }
    }
    // Heartbeat time shows in status.
    if (rt.up) for (const cond of node.status.conditions) cond.lastHeartbeatTime = iso(rt.heartbeat - (rt.heartbeat % 10));
  }
  return changed;
}

// ---------------------------------------------------------------------------
// Services → EndpointSlices

function targetPortOf(pod: KObject, tp: any): number | null {
  if (typeof tp === 'number') return tp;
  if (/^\d+$/.test(String(tp))) return Number(tp);
  for (const ctr of pod.spec.containers ?? []) for (const p of ctr.ports ?? []) if (p.name === tp) return p.containerPort;
  return null;
}

export function endpointSliceController(ctx: Ctx): boolean {
  const { state, c } = ctx;
  let changed = false;
  for (const svc of listObjs(c, 'Service')) {
    if (!svc.spec.selector || svc.spec.type === 'ExternalName') continue;
    const ns = svc.metadata.namespace!;
    const pods = listObjs(c, 'Pod', ns).filter((p) => mapSelects(svc.spec.selector, p.metadata.labels) && p.status?.podIP && p.status.phase !== 'Succeeded' && p.status.phase !== 'Failed');
    const first = pods[0];
    const ports = (svc.spec.ports ?? []).map((sp: any) => ({ name: sp.name ?? '', port: first ? (targetPortOf(first, sp.targetPort) ?? sp.port) : typeof sp.targetPort === 'number' ? sp.targetPort : sp.port, protocol: sp.protocol ?? 'TCP' }));
    const endpoints = pods.map((p) => {
      const terminating = Boolean(p.metadata.deletionTimestamp);
      const ready = podReady(p) && !terminating;
      return {
        addresses: [p.status.podIP],
        conditions: { ready, serving: terminating ? podReady(p) : ready, terminating },
        nodeName: p.spec.nodeName,
        targetRef: { kind: 'Pod', name: p.metadata.name, namespace: ns, uid: p.metadata.uid },
      };
    });
    let slice = listObjs(c, 'EndpointSlice', ns).find((s) => s.metadata.labels?.['kubernetes.io/service-name'] === svc.metadata.name);
    const want = { endpoints: endpoints.length ? endpoints : null, ports: first || !svc.spec.selector ? ports : null };
    if (!slice) {
      slice = {
        apiVersion: 'discovery.k8s.io/v1',
        kind: 'EndpointSlice',
        metadata: {
          name: `${svc.metadata.name}-${randomSuffix(state)}`,
          generateName: `${svc.metadata.name}-`,
          namespace: ns,
          labels: { 'endpointslice.kubernetes.io/managed-by': 'endpointslice-controller.k8s.io', 'kubernetes.io/service-name': svc.metadata.name },
          annotations: { 'endpoints.kubernetes.io/last-change-trigger-time': iso(state.clock) },
          ownerReferences: [{ apiVersion: 'v1', kind: 'Service', name: svc.metadata.name, uid: svc.metadata.uid, controller: true, blockOwnerDeletion: true }],
        } as any,
        addressType: 'IPv4',
        endpoints: want.endpoints,
        ports: want.ports,
      };
      apiCreate(state, c, slice);
      changed = true;
    } else if (JSON.stringify(slice.endpoints) !== JSON.stringify(want.endpoints) || JSON.stringify(slice.ports) !== JSON.stringify(want.ports)) {
      slice.endpoints = want.endpoints;
      slice.ports = want.ports;
      slice.metadata.annotations = { ...(slice.metadata.annotations ?? {}), 'endpoints.kubernetes.io/last-change-trigger-time': iso(state.clock) };
      updateObj(c, slice);
      changed = true;
    }
    if (!slice.endpoints) delete slice.endpoints;
    if (!slice.ports) delete slice.ports;
  }
  return changed;
}

/** LoadBalancer Services get an address on clusters that have a load-balancer add-on. */
export function serviceLoadBalancer(ctx: Ctx): void {
  const { state, c } = ctx;
  if (!c.addons.loadBalancer) return;
  for (const svc of listObjs(c, 'Service')) {
    if (svc.spec.type !== 'LoadBalancer' || svc.status?.loadBalancer?.ingress) continue;
    const ip = c.kind === 'kind' ? `172.18.0.${100 + (Math.floor(state.clock) % 50)}` : `203.0.113.${10 + Object.keys(c.objects).length % 200}`;
    setStatus(c, svc, { loadBalancer: { ingress: [{ ip, ipMode: 'VIP' }] } });
  }
}

// ---------------------------------------------------------------------------
// Gateway API (an Envoy Gateway–like controller, only when the add-on is installed)

export const GATEWAY_CONTROLLER = 'gateway.envoyproxy.io/gatewayclass-controller';

export function gatewayController(ctx: Ctx): void {
  const { state, c } = ctx;
  if (!c.addons.gateway) return;
  for (const gc of listObjs(c, 'GatewayClass')) {
    const ok = gc.spec?.controllerName === GATEWAY_CONTROLLER;
    if (!ok) continue;
    const want = { conditions: [{ lastTransitionTime: gc.status?.conditions?.[0]?.lastTransitionTime ?? iso(state.clock), message: 'Valid GatewayClass', observedGeneration: gc.metadata.generation, reason: 'Accepted', status: 'True', type: 'Accepted' }] };
    setStatus(c, gc, want);
  }
  const routes = listObjs(c, 'HTTPRoute');
  for (const gw of listObjs(c, 'Gateway')) {
    const gc = getObj(c, 'GatewayClass', undefined, gw.spec?.gatewayClassName ?? '');
    if (gc?.spec?.controllerName !== GATEWAY_CONTROLLER) continue;
    const ip = gw.status?.addresses?.[0]?.value ?? `172.18.0.${200 + listObjs(c, 'Gateway').indexOf(gw)}`;
    const attached = (listener: any) =>
      routes.filter((r) => (r.spec?.parentRefs ?? []).some((p: any) => p.name === gw.metadata.name && (p.namespace ?? r.metadata.namespace) === gw.metadata.namespace && (!p.sectionName || p.sectionName === listener.name))).length;
    const t = gw.status?.conditions?.[0]?.lastTransitionTime ?? iso(state.clock);
    setStatus(c, gw, {
      addresses: [{ type: 'IPAddress', value: ip }],
      conditions: [
        { lastTransitionTime: t, message: 'The Gateway has been scheduled by Envoy Gateway', observedGeneration: gw.metadata.generation, reason: 'Accepted', status: 'True', type: 'Accepted' },
        { lastTransitionTime: t, message: 'Address assigned to the Gateway, 1/1 envoy replicas available', observedGeneration: gw.metadata.generation, reason: 'Programmed', status: 'True', type: 'Programmed' },
      ],
      listeners: (gw.spec?.listeners ?? []).map((l: any) => ({
        attachedRoutes: attached(l),
        conditions: [
          { lastTransitionTime: t, message: 'Sending translated listener configuration to the data plane', observedGeneration: gw.metadata.generation, reason: 'Programmed', status: 'True', type: 'Programmed' },
          { lastTransitionTime: t, message: 'Listener has been successfully translated', observedGeneration: gw.metadata.generation, reason: 'Accepted', status: 'True', type: 'Accepted' },
          { lastTransitionTime: t, message: 'Listener references have been resolved', observedGeneration: gw.metadata.generation, reason: 'ResolvedRefs', status: 'True', type: 'ResolvedRefs' },
        ],
        name: l.name,
        supportedKinds: [{ group: 'gateway.networking.k8s.io', kind: 'HTTPRoute' }, { group: 'gateway.networking.k8s.io', kind: 'GRPCRoute' }],
      })),
    });
  }
  for (const r of routes) {
    const missing = (r.spec?.rules ?? []).flatMap((rule: any) => rule.backendRefs ?? []).find((b: any) => !getObj(c, 'Service', b.namespace ?? r.metadata.namespace, b.name));
    const t = r.status?.parents?.[0]?.conditions?.[0]?.lastTransitionTime ?? iso(state.clock);
    setStatus(c, r, {
      parents: (r.spec?.parentRefs ?? []).map((p: any) => ({
        conditions: [
          { lastTransitionTime: t, message: 'Route is accepted', observedGeneration: r.metadata.generation, reason: 'Accepted', status: 'True', type: 'Accepted' },
          missing
            ? { lastTransitionTime: t, message: `Failed to process route rule 0 backendRef 0: service ${r.metadata.namespace}/${missing.name} not found.`, observedGeneration: r.metadata.generation, reason: 'BackendNotFound', status: 'False', type: 'ResolvedRefs' }
            : { lastTransitionTime: t, message: 'Resolved all the Object references for the Route', observedGeneration: r.metadata.generation, reason: 'ResolvedRefs', status: 'True', type: 'ResolvedRefs' },
        ],
        controllerName: GATEWAY_CONTROLLER,
        parentRef: { group: 'gateway.networking.k8s.io', kind: 'Gateway', name: p.name, ...(p.namespace ? { namespace: p.namespace } : {}) },
      })),
    });
  }
}

// ---------------------------------------------------------------------------
// Volumes: claims bind to volumes; the local-path provisioner makes one per claim.

export function volumeController(ctx: Ctx): boolean {
  const { state, c } = ctx;
  let changed = false;
  for (const pvc of listObjs(c, 'PersistentVolumeClaim')) {
    if (pvc.status?.phase === 'Bound' || pvc.metadata.deletionTimestamp) continue;
    const sc = getObj(c, 'StorageClass', undefined, pvc.spec.storageClassName ?? '');
    const req = pvc.spec.resources?.requests?.storage ?? '1Gi';
    // A matching existing volume (static provisioning).
    const pv = listObjs(c, 'PersistentVolume').find(
      (v) => v.status?.phase === 'Available' && (v.spec.storageClassName ?? '') === (pvc.spec.storageClassName ?? '') && (pvc.spec.accessModes ?? []).every((m: string) => (v.spec.accessModes ?? []).includes(m)),
    );
    const user = listObjs(c, 'Pod', pvc.metadata.namespace).find((p) => (p.spec.volumes ?? []).some((v: any) => v.persistentVolumeClaim?.claimName === pvc.metadata.name));
    let target = pv;
    if (!target && sc) {
      if (sc.volumeBindingMode === 'WaitForFirstConsumer' && !user?.spec.nodeName) {
        if (!pvc.metadata.annotations?.['fahamlah/waiting']) {
          recordEvent(state, c, pvc, 'Normal', 'WaitForFirstConsumer', 'waiting for first consumer to be created before binding', 'persistentvolume-controller');
          pvc.metadata.annotations = { ...(pvc.metadata.annotations ?? {}), 'fahamlah/waiting': 'true' };
        }
        continue;
      }
      const name = `pvc-${pvc.metadata.uid}`;
      recordEvent(state, c, pvc, 'Normal', 'ExternalProvisioning', `Waiting for a volume to be created either by the external provisioner '${sc.provisioner}' or manually by the system administrator. If volume creation is delayed, please verify that the provisioner is running and correctly registered.`, 'persistentvolume-controller');
      recordEvent(state, c, pvc, 'Normal', 'Provisioning', `External provisioner is provisioning volume for claim "${pvc.metadata.namespace}/${pvc.metadata.name}"`, `${sc.provisioner}_local-path-provisioner`);
      const made = apiCreate(state, c, {
        apiVersion: 'v1',
        kind: 'PersistentVolume',
        metadata: { name, annotations: { 'local.path.provisioner/selected-node': user?.spec.nodeName ?? '', 'pv.kubernetes.io/provisioned-by': sc.provisioner } } as any,
        spec: {
          accessModes: pvc.spec.accessModes ?? ['ReadWriteOnce'],
          capacity: { storage: req },
          hostPath: { path: `/var/local-path-provisioner/${name}_${pvc.metadata.namespace}_${pvc.metadata.name}`, type: 'DirectoryOrCreate' },
          ...(user?.spec.nodeName
            ? { nodeAffinity: { required: { nodeSelectorTerms: [{ matchExpressions: [{ key: 'kubernetes.io/hostname', operator: 'In', values: [user.spec.nodeName] }] }] } } }
            : {}),
          persistentVolumeReclaimPolicy: sc.reclaimPolicy ?? 'Delete',
          storageClassName: sc.metadata.name,
        },
      });
      target = made.obj;
      recordEvent(state, c, pvc, 'Normal', 'ProvisioningSucceeded', `Successfully provisioned volume ${name}`, `${sc.provisioner}_local-path-provisioner`);
    }
    if (!target) continue;
    target.spec.claimRef = { apiVersion: 'v1', kind: 'PersistentVolumeClaim', name: pvc.metadata.name, namespace: pvc.metadata.namespace, uid: pvc.metadata.uid };
    target.status = { phase: 'Bound' };
    updateObj(c, target);
    pvc.spec.volumeName = target.metadata.name;
    if (pvc.metadata.annotations) delete pvc.metadata.annotations['fahamlah/waiting'];
    pvc.metadata.annotations = { ...(pvc.metadata.annotations ?? {}), 'pv.kubernetes.io/bind-completed': 'yes', 'pv.kubernetes.io/bound-by-controller': 'yes' };
    pvc.status = { accessModes: target.spec.accessModes, capacity: { storage: target.spec.capacity.storage }, phase: 'Bound' };
    updateObj(c, pvc);
    changed = true;
  }
  // Released volumes when their claim is gone.
  for (const pv of listObjs(c, 'PersistentVolume')) {
    const ref = pv.spec.claimRef;
    if (!ref || pv.status?.phase !== 'Bound') continue;
    if (!getObj(c, 'PersistentVolumeClaim', ref.namespace, ref.name)) {
      if (pv.spec.persistentVolumeReclaimPolicy === 'Delete') removeObj(c, pv);
      else setStatus(c, pv, { phase: 'Released' });
      changed = true;
    }
  }
  return changed;
}

// ---------------------------------------------------------------------------
// HPA (autoscaling/v2), every 15 seconds, from metrics-server numbers.

/** CPU (millicores) a pod uses right now: the program's base use plus its share of the Service traffic. */
export function podCpu(ctx: Ctx, pod: KObject): number {
  const { c } = ctx;
  if (!pod.status?.containerStatuses?.some((s: any) => s.state?.running)) return 0;
  let base = 0;
  for (const ctr of pod.spec.containers ?? []) base += behaviorOf(ctx, pod, ctr)?.cpu ?? 0;
  let load = 0;
  for (const svc of listObjs(c, 'Service', pod.metadata.namespace)) {
    const rps = c.load[`${svc.metadata.namespace}/${svc.metadata.name}`];
    if (!rps || !mapSelects(svc.spec.selector, pod.metadata.labels) || !podReady(pod)) continue;
    const ready = listObjs(c, 'Pod', pod.metadata.namespace).filter((p) => mapSelects(svc.spec.selector, p.metadata.labels) && podReady(p)).length;
    load += (rps * 4) / Math.max(1, ready);
  }
  return Math.round(base + load);
}

export function podMemoryMi(ctx: Ctx, pod: KObject): number {
  let total = 0;
  for (const ctr of pod.spec.containers ?? []) {
    const rt = ctx.c.pods[pod.metadata.uid]?.containers[ctr.name];
    if (!rt || rt.startedAt === null) continue;
    const b = behaviorOf(ctx, pod, ctr);
    const t = ctx.state.clock - rt.startedAt;
    total += (b?.memory(t) ?? 1) + rt.leak * t;
  }
  return total;
}

export function hpaController(ctx: Ctx): boolean {
  const { state, c, ev } = ctx;
  let changed = false;
  for (const hpa of listObjs(c, 'HorizontalPodAutoscaler')) {
    const last = c.hpaSync[hpa.metadata.uid] ?? 0;
    if (state.clock - last < 15) continue;
    c.hpaSync[hpa.metadata.uid] = state.clock;
    const ref = hpa.spec.scaleTargetRef ?? {};
    const target = getObj(c, ref.kind, hpa.metadata.namespace, ref.name);
    const metric = (hpa.spec.metrics ?? []).find((m: any) => m.type === 'Resource' && m.resource?.name === 'cpu');
    const util = metric?.resource?.target?.averageUtilization ?? 80;
    const st: any = { ...(hpa.status ?? {}) };
    if (!target) {
      setStatus(c, hpa, st);
      continue;
    }
    const cur = target.spec.replicas ?? 1;
    st.currentReplicas = cur;
    const pods = listObjs(c, 'Pod', hpa.metadata.namespace).filter((p) => selectorMatches(target.spec.selector, p.metadata.labels) && !p.metadata.deletionTimestamp);
    const conds = (able: string, active: [string, string, string], limited: [string, string, string]) => {
      const t = iso(state.clock);
      st.conditions = [
        { lastTransitionTime: t, message: able === 'True' ? 'recommended size matches current size' : '', reason: able === 'True' ? 'ReadyForNewScale' : 'FailedGetScale', status: able, type: 'AbleToScale' },
        { lastTransitionTime: t, message: active[2], reason: active[1], status: active[0], type: 'ScalingActive' },
        { lastTransitionTime: t, message: limited[2], reason: limited[1], status: limited[0], type: 'ScalingLimited' },
      ];
    };
    if (!c.addons.metricsServer) {
      const msg = 'failed to get cpu utilization: unable to get metrics for resource cpu: unable to fetch metrics from resource metrics API: the server could not find the requested resource (get pods.metrics.k8s.io)';
      recordEvent(state, c, hpa, 'Warning', 'FailedGetResourceMetric', msg, 'horizontal-pod-autoscaler');
      conds('True', ['False', 'FailedGetResourceMetric', `the HPA was unable to compute the replica count: ${msg}`], ['False', 'DesiredWithinRange', 'the desired count is within the acceptable range']);
      st.desiredReplicas = cur;
      st.currentMetrics = null;
      setStatus(c, hpa, st);
      continue;
    }
    const noRequest = pods.find((p) => (p.spec.containers ?? []).some((ct: any) => !ct.resources?.requests?.cpu));
    if (noRequest) {
      const ct = noRequest.spec.containers.find((x: any) => !x.resources?.requests?.cpu);
      const msg = `failed to get cpu utilization: missing request for cpu in container ${ct.name} of Pod ${noRequest.metadata.name}`;
      recordEvent(state, c, hpa, 'Warning', 'FailedGetResourceMetric', msg, 'horizontal-pod-autoscaler');
      conds('True', ['False', 'FailedGetResourceMetric', `the HPA was unable to compute the replica count: ${msg}`], ['False', 'DesiredWithinRange', 'the desired count is within the acceptable range']);
      setStatus(c, hpa, st);
      continue;
    }
    const ready = pods.filter(podReady);
    const used = ready.reduce((n, p) => n + podCpu(ctx, p), 0);
    const req = ready.reduce((n, p) => n + (p.spec.containers ?? []).reduce((m: number, ct: any) => m + cpuMilli(ct.resources?.requests?.cpu), 0), 0);
    const pct = req ? Math.round((used / req) * 100) : 0;
    st.currentMetrics = [{ resource: { current: { averageUtilization: pct, averageValue: `${Math.round(used / Math.max(1, ready.length))}m` }, name: 'cpu' }, type: 'Resource' }];
    const ratio = pct / util;
    let desired = Math.abs(ratio - 1) <= 0.1 ? cur : Math.ceil(ready.length * ratio);
    const min = hpa.spec.minReplicas ?? 1;
    const max = hpa.spec.maxReplicas;
    let limitedReason: [string, string, string] = ['False', 'DesiredWithinRange', 'the desired count is within the acceptable range'];
    if (desired > max) {
      desired = max;
      limitedReason = ['True', 'TooManyReplicas', 'the desired replica count is more than the maximum replica count'];
    }
    if (desired < min) {
      desired = min;
      limitedReason = ['True', 'TooFewReplicas', 'the desired replica count is less than the minimum replica count'];
    }
    // Scale-up limit: double, or +4 pods, per 15 s. Scale-down waits 5 minutes of lower advice.
    if (desired > cur) desired = Math.min(desired, Math.max(cur * 2, cur + 4));
    if (desired < cur) {
      const since = fromIso(hpa.metadata.annotations?.['fahamlah/low-since']) || state.clock;
      hpa.metadata.annotations = { ...(hpa.metadata.annotations ?? {}), 'fahamlah/low-since': iso(since) };
      if (state.clock - since < 300) desired = cur;
    } else if (hpa.metadata.annotations?.['fahamlah/low-since']) delete hpa.metadata.annotations['fahamlah/low-since'];
    conds('True', ['True', 'ValidMetricFound', 'the HPA was able to successfully calculate a replica count from cpu resource utilization (percentage of request)'], limitedReason);
    st.desiredReplicas = desired;
    if (desired !== cur) {
      const from = cur;
      target.spec.replicas = desired;
      updateObj(c, target, ev);
      st.lastScaleTime = iso(state.clock);
      st.currentReplicas = cur;
      recordEvent(state, c, hpa, 'Normal', 'SuccessfulRescale', `New size: ${desired}; reason: cpu resource utilization (percentage of request) ${desired > from ? 'above' : 'below'} target`, 'horizontal-pod-autoscaler');
      ev.push({ type: 'scaled', kind: target.kind, name: target.metadata.name, namespace: target.metadata.namespace!, from, to: desired });
      changed = true;
    }
    setStatus(c, hpa, st);
  }
  return changed;
}

export function pdbAndQuotaStatus(ctx: Ctx): void {
  const { c } = ctx;
  for (const pdb of listObjs(c, 'PodDisruptionBudget')) {
    const pods = listObjs(c, 'Pod', pdb.metadata.namespace).filter((p) => selectorMatches(pdb.spec.selector, p.metadata.labels) && !p.metadata.deletionTimestamp);
    const healthy = pods.filter(podReady).length;
    const expected = pods.length;
    let desired = 0;
    if (pdb.spec.minAvailable !== undefined) desired = String(pdb.spec.minAvailable).endsWith('%') ? Math.ceil((parseInt(pdb.spec.minAvailable, 10) * expected) / 100) : Number(pdb.spec.minAvailable);
    else if (pdb.spec.maxUnavailable !== undefined) desired = expected - (String(pdb.spec.maxUnavailable).endsWith('%') ? Math.floor((parseInt(pdb.spec.maxUnavailable, 10) * expected) / 100) : Number(pdb.spec.maxUnavailable));
    const allowed = Math.max(0, healthy - desired);
    const st = {
      conditions: [{ lastTransitionTime: pdb.status?.conditions?.[0]?.lastTransitionTime ?? iso(ctx.state.clock), message: '', observedGeneration: pdb.metadata.generation, reason: allowed > 0 ? 'SufficientPods' : 'InsufficientPods', status: allowed > 0 ? 'True' : 'False', type: 'DisruptionAllowed' }],
      currentHealthy: healthy,
      desiredHealthy: desired,
      disruptionsAllowed: allowed,
      expectedPods: expected,
      observedGeneration: pdb.metadata.generation,
    };
    setStatus(c, pdb, st);
  }
  for (const q of listObjs(c, 'ResourceQuota')) setStatus(c, q, quotaStatus(c, q));
}

/** The Lease and housekeeping objects the API server keeps for `kubernetes` Service endpoints. */
export function apiEndpoints(ctx: Ctx): void {
  const { state, c } = ctx;
  const svc = getObj(c, 'Service', 'default', 'kubernetes');
  if (!svc || getObj(c, 'EndpointSlice', 'default', 'kubernetes')) return;
  const ip = c.kind === 'kind' ? '172.18.0.2' : '10.0.0.2';
  const slice: KObject = {
    apiVersion: 'discovery.k8s.io/v1',
    kind: 'EndpointSlice',
    metadata: { name: 'kubernetes', namespace: 'default', labels: { 'kubernetes.io/service-name': 'kubernetes' }, uid: '', resourceVersion: '', creationTimestamp: '' },
    addressType: 'IPv4',
    endpoints: [{ addresses: [ip], conditions: { ready: true } }],
    ports: [{ name: 'https', port: 6443, protocol: 'TCP' }],
  };
  apiCreate(state, c, slice);
  void hexId;
  void objKey;
}

export { setCondition };
