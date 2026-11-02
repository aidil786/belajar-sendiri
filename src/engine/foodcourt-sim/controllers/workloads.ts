// Workload controllers: Deployment → ReplicaSet → Pods, DaemonSet, StatefulSet, Job, CronJob.
// Each one compares what is wanted with what exists, and fixes the difference
// ("Want 3, See 2, Make 1 more"). They follow the real controllers' rules (rolling update
// maxSurge / maxUnavailable, Recreate, revision annotations, ordered StatefulSet pods).
import { apiCreate, apiDelete, apiUpdate } from '../api';
import { createObj, controllerRef, getObj, isTerminating, listObjs, ownedBy, podActive, podReady, recordEvent, removeObj, restartCount, setStatus, updateObj } from '../store';
import type { Cluster, KObject, KubeEvent, KubeState } from '../types';
import { clone, fromIso, intOrPercent, iso, randomSuffix, selectorMatches, stableJson, templateHash } from '../util';

export interface Ctx {
  state: KubeState;
  c: Cluster;
  ev: KubeEvent[];
}

const HASH = 'pod-template-hash';

/** Make a pod from a template and send it through the API (admission can refuse it). */
export function createPodFromTemplate(ctx: Ctx, owner: KObject, template: any, name: string, extraLabels: Record<string, string> = {}, extraSpec: any = {}): KObject | null {
  const { state, c, ev } = ctx;
  const pod: KObject = {
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: {
      name,
      ...(name.endsWith('-') ? {} : {}),
      namespace: owner.metadata.namespace,
      labels: { ...(template.metadata?.labels ?? {}), ...extraLabels },
      ...(template.metadata?.annotations ? { annotations: clone(template.metadata.annotations) } : {}),
      ownerReferences: [controllerRef(owner)],
    } as any,
    spec: { ...clone(template.spec ?? {}), ...extraSpec },
  };
  if (owner.kind === 'ReplicaSet' || owner.kind === 'DaemonSet' || owner.kind === 'Job') pod.metadata.generateName = `${owner.metadata.name}-`;
  const res = apiCreate(state, c, pod, { events: ev });
  if (!res.ok) {
    recordEvent(state, c, owner, 'Warning', 'FailedCreate', `Error creating: ${res.error}`, controllerName(owner.kind));
    return null;
  }
  recordEvent(state, c, owner, 'Normal', 'SuccessfulCreate', `Created pod: ${res.obj!.metadata.name}`, controllerName(owner.kind));
  ev.push({ type: 'podCreated', pod: res.obj!.metadata.name, namespace: res.obj!.metadata.namespace!, owner: owner.metadata.name });
  const lost = c.lost[owner.metadata.uid];
  if (lost?.length) {
    const old = lost.shift()!;
    ev.push({ type: 'podReplaced', old, pod: res.obj!.metadata.name, namespace: res.obj!.metadata.namespace!, owner: owner.metadata.name });
  }
  return res.obj!;
}

export function controllerName(kind: string): string {
  return (
    {
      ReplicaSet: 'replicaset-controller',
      Deployment: 'deployment-controller',
      DaemonSet: 'daemonset-controller',
      StatefulSet: 'statefulset-controller',
      Job: 'job-controller',
      CronJob: 'cronjob-controller',
    } as Record<string, string>
  )[kind] ?? 'controller-manager';
}

/** Pods a controller owns (by ownerReference), plus orphans it adopts (labels match). */
function controlledPods(ctx: Ctx, owner: KObject): KObject[] {
  const { c } = ctx;
  const pods = listObjs(c, 'Pod', owner.metadata.namespace);
  const out: KObject[] = [];
  for (const p of pods) {
    const ref = p.metadata.ownerReferences?.find((r) => r.controller);
    if (ref?.uid === owner.metadata.uid) out.push(p);
    else if (!ref && owner.kind === 'ReplicaSet' && !isTerminating(p) && selectorMatches(owner.spec.selector, p.metadata.labels)) {
      // Adoption: a matching pod without an owner joins this ReplicaSet.
      p.metadata.ownerReferences = [controllerRef(owner)];
      updateObj(c, p);
      out.push(p);
    }
  }
  return out;
}

/** Ready for at least minReadySeconds. */
function available(pod: KObject, now: number, minReady = 0): boolean {
  if (!podReady(pod) || isTerminating(pod)) return false;
  const cond = pod.status?.conditions?.find((x: any) => x.type === 'Ready');
  return now - fromIso(cond?.lastTransitionTime) >= minReady;
}

// ---------------------------------------------------------------------------
// ReplicaSet

export function replicaSetController(ctx: Ctx): boolean {
  const { state, c, ev } = ctx;
  let changed = false;
  for (const rs of listObjs(c, 'ReplicaSet')) {
    if (isTerminating(rs)) continue;
    const pods = controlledPods(ctx, rs);
    const active = pods.filter(podActive);
    const want = rs.spec.replicas ?? 1;
    const diff = active.length - want;
    if (diff < 0) {
      ev.push({ type: 'reconcile', controller: 'ReplicaSet', name: rs.metadata.name, namespace: rs.metadata.namespace!, want, see: active.length, do: 'create', count: -diff });
      for (let i = 0; i < -diff; i++) {
        const name = `${rs.metadata.name}-${randomSuffix(state)}`;
        if (createPodFromTemplate(ctx, rs, rs.spec.template, name)) changed = true;
        else break;
      }
    } else if (diff > 0) {
      ev.push({ type: 'reconcile', controller: 'ReplicaSet', name: rs.metadata.name, namespace: rs.metadata.namespace!, want, see: active.length, do: 'delete', count: diff });
      // Delete the least useful pods first: unscheduled, pending, not ready, most restarts, newest.
      const rank = (p: KObject) => [
        p.spec.nodeName ? 1 : 0,
        p.status?.phase === 'Pending' ? 0 : 1,
        podReady(p) ? 1 : 0,
        -restartCount(p),
        -fromIso(p.metadata.creationTimestamp),
      ];
      const victims = [...active].sort((a, b) => {
        const x = rank(a);
        const y = rank(b);
        for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i]! - y[i]!;
        return b.metadata.name.localeCompare(a.metadata.name);
      });
      for (const p of victims.slice(0, diff)) {
        apiDelete(state, c, 'Pod', p.metadata.namespace, p.metadata.name, { by: 'controller', events: ev });
        // A planned scale-down is not a loss to replace.
        const lost = c.lost[rs.metadata.uid];
        if (lost) c.lost[rs.metadata.uid] = lost.filter((n) => n !== p.metadata.name);
        recordEvent(state, c, rs, 'Normal', 'SuccessfulDelete', `Deleted pod: ${p.metadata.name}`, 'replicaset-controller');
        changed = true;
      }
    } else if (want > 0) {
      ev.push({ type: 'reconcile', controller: 'ReplicaSet', name: rs.metadata.name, namespace: rs.metadata.namespace!, want, see: active.length, do: 'none', count: 0 });
    }
    const now = controlledPods(ctx, rs).filter(podActive);
    const minReady = rs.spec.minReadySeconds ?? 0;
    setStatus(c, rs, {
      ...(now.length ? { availableReplicas: now.filter((p) => available(p, state.clock, minReady)).length } : {}),
      fullyLabeledReplicas: now.length,
      observedGeneration: rs.metadata.generation,
      ...(now.filter(podReady).length ? { readyReplicas: now.filter(podReady).length } : {}),
      replicas: now.length,
      ...(pods.filter(isTerminating).length ? { terminatingReplicas: pods.filter(isTerminating).length } : {}),
    });
  }
  return changed;
}

// ---------------------------------------------------------------------------
// Deployment

function stripHash(t: any): any {
  const x = clone(t ?? {});
  if (x.metadata?.labels) delete x.metadata.labels[HASH];
  return x;
}

export function revisionOf(rs: KObject): number {
  return Number(rs.metadata.annotations?.['deployment.kubernetes.io/revision'] ?? 0);
}

function rsCounts(rs: KObject) {
  return { spec: rs.spec.replicas ?? 0, ready: rs.status?.readyReplicas ?? 0, avail: rs.status?.availableReplicas ?? 0, cur: rs.status?.replicas ?? 0 };
}

function scaleRS(ctx: Ctx, d: KObject, rs: KObject, to: number): boolean {
  const from = rs.spec.replicas ?? 0;
  if (from === to) return false;
  rs.spec.replicas = to;
  rs.metadata.annotations = {
    ...(rs.metadata.annotations ?? {}),
    'deployment.kubernetes.io/desired-replicas': String(d.spec.replicas),
    'deployment.kubernetes.io/max-replicas': String(d.spec.replicas + maxSurge(d)),
  };
  updateObj(ctx.c, rs, ctx.ev);
  recordEvent(ctx.state, ctx.c, d, 'Normal', 'ScalingReplicaSet', `Scaled ${to > from ? 'up' : 'down'} replica set ${rs.metadata.name} from ${from} to ${to}`, 'deployment-controller');
  return true;
}

function maxSurge(d: KObject): number {
  if (d.spec.strategy?.type !== 'RollingUpdate') return 0;
  return intOrPercent(d.spec.strategy.rollingUpdate?.maxSurge ?? '25%', d.spec.replicas, true);
}

function maxUnavailable(d: KObject): number {
  if (d.spec.strategy?.type !== 'RollingUpdate') return 0;
  const surge = maxSurge(d);
  let mu = intOrPercent(d.spec.strategy.rollingUpdate?.maxUnavailable ?? '25%', d.spec.replicas, false);
  if (surge === 0 && mu === 0) mu = 1;
  return Math.min(mu, d.spec.replicas);
}

export function deploymentController(ctx: Ctx): boolean {
  const { state, c, ev } = ctx;
  let changed = false;
  for (const d of listObjs(c, 'Deployment')) {
    if (isTerminating(d)) continue;
    const all = ownedBy(c, d, 'ReplicaSet');
    const tmpl = stableJson(stripHash(d.spec.template));
    let newRS = all.find((rs) => stableJson(stripHash(rs.spec.template)) === tmpl);
    const old = all.filter((rs) => rs !== newRS);
    const maxRev = Math.max(0, ...all.map(revisionOf));
    const replicas = d.spec.replicas ?? 1;
    if (!newRS && !d.spec.paused) {
      const hash = templateHash(stripHash(d.spec.template));
      const template = clone(d.spec.template);
      template.metadata = template.metadata ?? {};
      template.metadata.labels = { ...(template.metadata.labels ?? {}), [HASH]: hash };
      const annotations: Record<string, string> = {
        'deployment.kubernetes.io/desired-replicas': String(replicas),
        'deployment.kubernetes.io/max-replicas': String(replicas + maxSurge(d)),
        'deployment.kubernetes.io/revision': String(maxRev + 1),
      };
      const cause = d.metadata.annotations?.['kubernetes.io/change-cause'];
      if (cause) annotations['kubernetes.io/change-cause'] = cause;
      const rs: KObject = {
        apiVersion: 'apps/v1',
        kind: 'ReplicaSet',
        metadata: {
          name: `${d.metadata.name}-${hash}`,
          namespace: d.metadata.namespace,
          labels: { ...(d.spec.template.metadata?.labels ?? {}), [HASH]: hash },
          annotations,
          ownerReferences: [controllerRef(d)],
        } as any,
        spec: {
          replicas: 0,
          selector: { matchLabels: { ...(d.spec.selector?.matchLabels ?? {}), [HASH]: hash }, ...(d.spec.selector?.matchExpressions ? { matchExpressions: d.spec.selector.matchExpressions } : {}) },
          template,
          ...(d.spec.minReadySeconds ? { minReadySeconds: d.spec.minReadySeconds } : {}),
        },
      };
      const created = apiCreate(state, c, rs, { events: ev });
      if (!created.ok) continue;
      newRS = created.obj!;
      changed = true;
      setCondition(d, 'Progressing', 'True', 'NewReplicaSetCreated', `Created new replica set "${newRS.metadata.name}"`, state.clock);
      // First rollout (no old pods): go straight to the full size, like the real controller.
      const oldTotal = old.reduce((n, x) => n + (x.spec.replicas ?? 0), 0);
      const first = d.spec.strategy?.type === 'Recreate' ? (oldTotal === 0 ? replicas : 0) : Math.min(replicas, Math.max(0, replicas + maxSurge(d) - oldTotal));
      scaleRS(ctx, d, newRS, first);
    } else if (newRS && revisionOf(newRS) < maxRev && !d.spec.paused) {
      // Rolled back to an older template: that ReplicaSet becomes the newest revision.
      const prev = revisionOf(newRS);
      newRS.metadata.annotations = { ...(newRS.metadata.annotations ?? {}), 'deployment.kubernetes.io/revision': String(maxRev + 1) };
      const hist = newRS.metadata.annotations['deployment.kubernetes.io/revision-history'];
      newRS.metadata.annotations['deployment.kubernetes.io/revision-history'] = hist ? `${hist},${prev}` : String(prev);
      updateObj(c, newRS, ev);
      changed = true;
    }
    if (!newRS) continue;
    const surge = maxSurge(d);
    const justCreated = !all.includes(newRS);
    if (!d.spec.paused && !justCreated) {
      const rsList = [newRS, ...old];
      const sumSpec = () => rsList.reduce((n, rs) => n + (rs.spec.replicas ?? 0), 0);
      const oldSpec = () => old.reduce((n, rs) => n + (rs.spec.replicas ?? 0), 0);
      if (d.spec.strategy?.type === 'Recreate') {
        for (const rs of old) if (scaleRS(ctx, d, rs, 0)) changed = true;
        const oldPods = old.flatMap((rs) => ownedBy(c, rs, 'Pod'));
        if (oldPods.length === 0 && scaleRS(ctx, d, newRS, replicas)) changed = true;
      } else {
        // Like the real controller: one step per sync — scale the new ReplicaSet up as far
        // as maxSurge allows; only if nothing was scaled up, scale old ones down.
        let scaledUp = false;
        const nr = newRS.spec.replicas ?? 0;
        if (oldSpec() === 0) {
          if (nr !== replicas) scaledUp = scaleRS(ctx, d, newRS, replicas);
        } else if (nr < replicas) {
          const room = replicas + surge - sumSpec();
          if (room > 0) scaledUp = scaleRS(ctx, d, newRS, Math.min(replicas, nr + room));
        } else if (nr > replicas) scaledUp = scaleRS(ctx, d, newRS, replicas);
        if (scaledUp) changed = true;
        else if (oldSpec() > 0) {
          const minAvail = replicas - maxUnavailable(d);
          const newUnavailable = (newRS.spec.replicas ?? 0) - rsCounts(newRS).avail;
          let canDown = sumSpec() - minAvail - newUnavailable;
          const byAge = [...old].sort((a, b) => revisionOf(a) - revisionOf(b));
          // First the old pods that are not available anyway.
          for (const rs of byAge) {
            if (canDown <= 0) break;
            const k = rsCounts(rs);
            const by = Math.min(Math.max(0, k.spec - k.avail), canDown);
            if (by > 0 && scaleRS(ctx, d, rs, k.spec - by)) {
              changed = true;
              canDown -= by;
            }
          }
          // Then available ones, keeping at least minAvailable.
          const availAll = rsList.reduce((n, rs) => n + rsCounts(rs).avail, 0);
          let budget = Math.min(canDown, availAll - minAvail);
          for (const rs of byAge) {
            if (budget <= 0) break;
            const k = rs.spec.replicas ?? 0;
            const by = Math.min(k, budget);
            if (by > 0 && scaleRS(ctx, d, rs, k - by)) {
              changed = true;
              budget -= by;
            }
          }
        }
      }
    }
    // Revision annotation and history limit.
    const rev = String(revisionOf(newRS));
    if (d.metadata.annotations?.['deployment.kubernetes.io/revision'] !== rev) {
      d.metadata.annotations = { ...(d.metadata.annotations ?? {}), 'deployment.kubernetes.io/revision': rev };
      d.metadata.resourceVersion = String(++c.rv);
    }
    const limit = d.spec.revisionHistoryLimit ?? 10;
    const deadOld = old.filter((rs) => (rs.spec.replicas ?? 0) === 0 && (rs.status?.replicas ?? 0) === 0).sort((a, b) => revisionOf(a) - revisionOf(b));
    while (deadOld.length > limit) {
      const rs = deadOld.shift()!;
      removeObj(c, rs, ev);
    }
    // Status.
    const fresh = ownedBy(c, d, 'ReplicaSet');
    const nrs = getObj(c, 'ReplicaSet', d.metadata.namespace, newRS.metadata.name) ?? newRS;
    const sum = (f: (k: ReturnType<typeof rsCounts>) => number) => fresh.reduce((n, rs) => n + f(rsCounts(rs)), 0);
    const avail = sum((k) => k.avail);
    const ready = sum((k) => k.ready);
    const cur = sum((k) => k.cur);
    const updated = rsCounts(nrs).cur;
    const st: any = { ...(d.status ?? {}) };
    st.observedGeneration = d.metadata.generation;
    st.replicas = cur;
    st.updatedReplicas = updated;
    if (ready) st.readyReplicas = ready;
    else delete st.readyReplicas;
    if (avail) st.availableReplicas = avail;
    else delete st.availableReplicas;
    const unavailable = Math.max(0, replicas - avail);
    if (unavailable) st.unavailableReplicas = unavailable;
    else delete st.unavailableReplicas;
    const terminating = fresh.reduce((n, rs) => n + (rs.status?.terminatingReplicas ?? 0), 0);
    if (terminating) st.terminatingReplicas = terminating;
    else delete st.terminatingReplicas;
    d.status = st;
    const minAvail = replicas - maxUnavailable(d);
    setCondition(
      d,
      'Available',
      avail >= minAvail ? 'True' : 'False',
      avail >= minAvail ? 'MinimumReplicasAvailable' : 'MinimumReplicasUnavailable',
      avail >= minAvail ? 'Deployment has minimum availability.' : 'Deployment does not have minimum availability.',
      state.clock,
    );
    const complete = updated === replicas && cur === replicas && avail === replicas && fresh.every((rs) => rs === nrs || (rs.spec.replicas ?? 0) === 0);
    const prog = d.status.conditions?.find((x: any) => x.type === 'Progressing');
    if (complete) {
      if (prog?.reason !== 'NewReplicaSetAvailable') ev.push({ type: 'rolloutComplete', deployment: d.metadata.name, namespace: d.metadata.namespace!, revision: Number(rev) });
      setCondition(d, 'Progressing', 'True', 'NewReplicaSetAvailable', `ReplicaSet "${nrs.metadata.name}" has successfully progressed.`, state.clock);
    } else if (prog?.reason === 'ProgressDeadlineExceeded') {
      // stays
    } else {
      const since = prog?.reason === 'ReplicaSetUpdated' || prog?.reason === 'NewReplicaSetCreated' ? fromIso(prog.lastTransitionTime) : state.clock;
      if (state.clock - since > (d.spec.progressDeadlineSeconds ?? 600)) {
        setCondition(d, 'Progressing', 'False', 'ProgressDeadlineExceeded', `ReplicaSet "${nrs.metadata.name}" has timed out progressing.`, state.clock);
      } else if (prog?.reason !== 'NewReplicaSetCreated' || changed) {
        setCondition(d, 'Progressing', 'True', 'ReplicaSetUpdated', `ReplicaSet "${nrs.metadata.name}" is progressing.`, state.clock, true);
      }
      const oldPods = fresh.filter((rs) => rs !== nrs).reduce((n, rs) => n + rsCounts(rs).cur, 0);
      ev.push({ type: 'rolloutStep', deployment: d.metadata.name, namespace: d.metadata.namespace!, revision: Number(rev), newReady: rsCounts(nrs).ready, oldPods, want: replicas });
    }
  }
  return changed;
}

/** Set a status condition; transition time changes only when the status changes. */
export function setCondition(o: KObject, type: string, status: string, reason: string, message: string, now: number, keepTransition = false): void {
  o.status = o.status ?? {};
  const list: any[] = o.status.conditions ?? [];
  const old = list.find((x) => x.type === type);
  const t = iso(now);
  if (old) {
    if (old.status !== status) old.lastTransitionTime = t;
    else if (!keepTransition && old.reason !== reason) old.lastTransitionTime = old.lastTransitionTime ?? t;
    old.lastUpdateTime = old.reason === reason && old.message === message ? old.lastUpdateTime : t;
    old.reason = reason;
    old.message = message;
    old.status = status;
  } else {
    const cond: any = { lastTransitionTime: t, lastUpdateTime: t, message, reason, status, type };
    if (!['Available', 'Progressing', 'ReplicaFailure'].includes(type)) delete cond.lastUpdateTime;
    list.push(cond);
  }
  // Deployments list Available before Progressing.
  o.status.conditions = list.sort((a, b) => (a.type === 'Available' ? -1 : b.type === 'Available' ? 1 : 0));
}

// ---------------------------------------------------------------------------
// DaemonSet: one pod on every node that fits

function daemonTolerations(): any[] {
  return [
    { effect: 'NoExecute', key: 'node.kubernetes.io/not-ready', operator: 'Exists' },
    { effect: 'NoExecute', key: 'node.kubernetes.io/unreachable', operator: 'Exists' },
    { effect: 'NoSchedule', key: 'node.kubernetes.io/disk-pressure', operator: 'Exists' },
    { effect: 'NoSchedule', key: 'node.kubernetes.io/memory-pressure', operator: 'Exists' },
    { effect: 'NoSchedule', key: 'node.kubernetes.io/pid-pressure', operator: 'Exists' },
    { effect: 'NoSchedule', key: 'node.kubernetes.io/unschedulable', operator: 'Exists' },
  ];
}

export function tolerates(tolerations: any[], taint: any): boolean {
  return tolerations.some(
    (t) => (t.operator === 'Exists' ? !t.key || t.key === taint.key : t.key === taint.key && (t.value ?? '') === (taint.value ?? '')) && (!t.effect || t.effect === taint.effect),
  );
}

export function daemonSetController(ctx: Ctx): boolean {
  const { state, c } = ctx;
  let changed = false;
  for (const ds of listObjs(c, 'DaemonSet')) {
    if (isTerminating(ds)) continue;
    const tmplHash = templateHash(ds.spec.template).slice(0, 10);
    const tol = [...(ds.spec.template.spec.tolerations ?? []), ...daemonTolerations()];
    const nodes = listObjs(c, 'Node').filter(
      (n) =>
        Object.entries(ds.spec.template.spec.nodeSelector ?? {}).every(([k, v]) => n.metadata.labels?.[k] === v) &&
        (n.spec?.taints ?? []).filter((t: any) => t.effect !== 'PreferNoSchedule').every((t: any) => tolerates(tol, t)),
    );
    const pods = ownedBy(c, ds, 'Pod');
    const nodeOf = (p: KObject) => p.spec.affinity?.nodeAffinity?.requiredDuringSchedulingIgnoredDuringExecution?.nodeSelectorTerms?.[0]?.matchFields?.[0]?.values?.[0] ?? p.spec.nodeName;
    let unavailableBudget = ds.spec.updateStrategy?.rollingUpdate?.maxUnavailable ?? 1;
    for (const n of nodes) {
      const here = pods.filter((p) => nodeOf(p) === n.metadata.name && !isTerminating(p));
      if (here.length === 0) {
        const spec = {
          affinity: {
            nodeAffinity: {
              requiredDuringSchedulingIgnoredDuringExecution: {
                nodeSelectorTerms: [{ matchFields: [{ key: 'metadata.name', operator: 'In', values: [n.metadata.name] }] }],
              },
            },
          },
          tolerations: [...(ds.spec.template.spec.tolerations ?? []), ...daemonTolerations()],
        };
        if (createPodFromTemplate(ctx, ds, ds.spec.template, `${ds.metadata.name}-${randomSuffix(state)}`, { 'controller-revision-hash': tmplHash, 'pod-template-generation': String(ds.metadata.generation ?? 1) }, spec)) changed = true;
      } else if (here[0]!.metadata.labels?.['controller-revision-hash'] !== tmplHash && ds.spec.updateStrategy?.type !== 'OnDelete' && unavailableBudget > 0) {
        apiDelete(state, c, 'Pod', ds.metadata.namespace, here[0]!.metadata.name, { by: 'controller', events: ctx.ev });
        unavailableBudget--;
        changed = true;
      }
    }
    const now = ownedBy(c, ds, 'Pod').filter((p) => !isTerminating(p));
    setStatus(c, ds, {
      currentNumberScheduled: now.length,
      desiredNumberScheduled: nodes.length,
      numberAvailable: now.filter(podReady).length || undefined,
      numberMisscheduled: 0,
      numberReady: now.filter(podReady).length,
      ...(now.length - now.filter(podReady).length ? { numberUnavailable: nodes.length - now.filter(podReady).length } : {}),
      observedGeneration: ds.metadata.generation,
      updatedNumberScheduled: now.filter((p) => p.metadata.labels?.['controller-revision-hash'] === tmplHash).length,
    });
  }
  return changed;
}

// ---------------------------------------------------------------------------
// StatefulSet: pods with stable names (db-0, db-1 …), one at a time

export function statefulSetController(ctx: Ctx): boolean {
  const { state, c, ev } = ctx;
  let changed = false;
  for (const sts of listObjs(c, 'StatefulSet')) {
    if (isTerminating(sts)) continue;
    const want = sts.spec.replicas ?? 1;
    const rev = `${sts.metadata.name}-${templateHash(sts.spec.template).slice(0, 10)}`;
    const pods = ownedBy(c, sts, 'Pod');
    const byIndex = new Map(pods.map((p) => [Number(p.metadata.name.slice(sts.metadata.name.length + 1)), p]));
    const parallel = sts.spec.podManagementPolicy === 'Parallel';
    let blocked = false;
    for (let i = 0; i < want; i++) {
      const p = byIndex.get(i);
      if (!p) {
        if (blocked) break;
        const name = `${sts.metadata.name}-${i}`;
        // Claims first (they stay when the pod goes).
        const volumes: any[] = [];
        for (const t of sts.spec.volumeClaimTemplates ?? []) {
          const claim = `${t.metadata.name}-${name}`;
          if (!getObj(c, 'PersistentVolumeClaim', sts.metadata.namespace, claim)) {
            const pvc: KObject = {
              apiVersion: 'v1',
              kind: 'PersistentVolumeClaim',
              metadata: { name: claim, namespace: sts.metadata.namespace, labels: { ...(sts.spec.selector?.matchLabels ?? {}) } } as any,
              spec: clone(t.spec),
            };
            apiCreate(state, c, pvc, { events: ev });
            recordEvent(state, c, sts, 'Normal', 'SuccessfulCreate', `create Claim ${claim} Pod ${name} in StatefulSet ${sts.metadata.name} success`, 'statefulset-controller');
          }
          volumes.push({ name: t.metadata.name, persistentVolumeClaim: { claimName: claim } });
        }
        const tmpl = clone(sts.spec.template);
        tmpl.spec.volumes = [...(tmpl.spec.volumes ?? []), ...volumes];
        const created = createPodFromTemplate(
          ctx,
          sts,
          tmpl,
          name,
          { 'apps.kubernetes.io/pod-index': String(i), 'controller-revision-hash': rev, 'statefulset.kubernetes.io/pod-name': name },
          { hostname: name, ...(sts.spec.serviceName ? { subdomain: sts.spec.serviceName } : {}) },
        );
        if (created) {
          changed = true;
          // The event text for StatefulSets names the pod and set.
          const last = Object.values(c.objects).filter((e) => e.kind === 'Event' && e.reason === 'SuccessfulCreate' && e.message === `Created pod: ${name}`);
          for (const e of last) e.message = `create Pod ${name} in StatefulSet ${sts.metadata.name} successful`;
        }
        if (!parallel) blocked = true;
      } else if (!parallel && (!podReady(p) || isTerminating(p))) blocked = true;
    }
    // Scale down: highest index first, one at a time.
    const extra = pods.filter((p) => Number(p.metadata.name.slice(sts.metadata.name.length + 1)) >= want && !isTerminating(p)).sort((a, b) => b.metadata.name.localeCompare(a.metadata.name, undefined, { numeric: true }));
    if (extra.length && !pods.some((p) => isTerminating(p))) {
      const p = extra[0]!;
      apiDelete(state, c, 'Pod', p.metadata.namespace, p.metadata.name, { by: 'controller', events: ev });
      recordEvent(state, c, sts, 'Normal', 'SuccessfulDelete', `delete Pod ${p.metadata.name} in StatefulSet ${sts.metadata.name} successful`, 'statefulset-controller');
      changed = true;
    }
    // Rolling update: replace pods with an old revision, highest index first, once all are ready.
    if (!changed && sts.spec.updateStrategy?.type !== 'OnDelete') {
      const outdated = pods
        .filter((p) => p.metadata.labels?.['controller-revision-hash'] !== rev && !isTerminating(p))
        .sort((a, b) => b.metadata.name.localeCompare(a.metadata.name, undefined, { numeric: true }));
      if (outdated.length && pods.every((p) => podReady(p) || p === outdated[0])) {
        apiDelete(state, c, 'Pod', sts.metadata.namespace, outdated[0]!.metadata.name, { by: 'controller', events: ev });
        changed = true;
      }
    }
    const now = ownedBy(c, sts, 'Pod').filter((p) => !isTerminating(p));
    const ready = now.filter(podReady).length;
    setStatus(c, sts, {
      availableReplicas: ready,
      collisionCount: 0,
      currentReplicas: now.length,
      currentRevision: rev,
      observedGeneration: sts.metadata.generation,
      ...(ready ? { readyReplicas: ready } : {}),
      replicas: now.length,
      updateRevision: rev,
      updatedReplicas: now.filter((p) => p.metadata.labels?.['controller-revision-hash'] === rev).length,
    });
  }
  return changed;
}

// ---------------------------------------------------------------------------
// Job and CronJob

export function jobController(ctx: Ctx): boolean {
  const { state, c, ev } = ctx;
  let changed = false;
  for (const job of listObjs(c, 'Job')) {
    if (isTerminating(job)) continue;
    const done = job.status?.conditions?.some((x: any) => (x.type === 'Complete' || x.type === 'Failed') && x.status === 'True');
    const pods = ownedBy(c, job, 'Pod');
    const succeeded = pods.filter((p) => p.status?.phase === 'Succeeded').length;
    const failed = pods.filter((p) => p.status?.phase === 'Failed').length + (job.status?.uncountedFailed ?? 0);
    const active = pods.filter((p) => podActive(p));
    const completions = job.spec.completions ?? 1;
    const st: any = { ...(job.status ?? {}) };
    delete st.uncountedFailed;
    if (!st.startTime && !job.spec.suspend) st.startTime = iso(state.clock);
    if (!done && !job.spec.suspend) {
      const retries = failed + pods.reduce((n, p) => n + (job.spec.template.spec.restartPolicy === 'OnFailure' ? restartCount(p) : 0), 0);
      if (retries > (job.spec.backoffLimit ?? 6)) {
        for (const p of active) apiDelete(state, c, 'Pod', p.metadata.namespace, p.metadata.name, { by: 'controller', events: ev });
        setCondition(job, 'FailureTarget', 'True', 'BackoffLimitExceeded', 'Job has reached the specified backoff limit', state.clock);
        setCondition(job, 'Failed', 'True', 'BackoffLimitExceeded', 'Job has reached the specified backoff limit', state.clock);
        st.conditions = job.status.conditions;
        recordEvent(state, c, job, 'Warning', 'BackoffLimitExceeded', 'Job has reached the specified backoff limit', 'job-controller');
        changed = true;
      } else if (succeeded >= completions) {
        setCondition(job, 'SuccessCriteriaMet', 'True', 'CompletionsReached', 'Reached expected number of succeeded pods', state.clock);
        setCondition(job, 'Complete', 'True', 'CompletionsReached', 'Reached expected number of succeeded pods', state.clock);
        st.conditions = job.status.conditions;
        st.completionTime = iso(state.clock);
        recordEvent(state, c, job, 'Normal', 'Completed', 'Job completed', 'job-controller');
        changed = true;
      } else {
        // Failed pods come back after a back-off (10s, 20s, 40s …).
        const lastFail = Math.max(0, ...pods.filter((p) => p.status?.phase === 'Failed').map((p) => fromIso(p.status?.containerStatuses?.[0]?.state?.terminated?.finishedAt)));
        const wait = failed ? Math.min(360, 10 * 2 ** (failed - 1)) : 0;
        const room = Math.min(job.spec.parallelism ?? 1, completions - succeeded) - active.length;
        if (room > 0 && state.clock >= lastFail + wait) {
          for (let i = 0; i < room; i++) {
            if (createPodFromTemplate(ctx, job, job.spec.template, `${job.metadata.name}-${randomSuffix(state)}`)) changed = true;
          }
        }
      }
    }
    const now = ownedBy(c, job, 'Pod');
    const act = now.filter(podActive).length;
    st.active = act || undefined;
    st.ready = now.filter(podReady).length;
    st.succeeded = now.filter((p) => p.status?.phase === 'Succeeded').length || undefined;
    st.failed = now.filter((p) => p.status?.phase === 'Failed').length || undefined;
    st.terminating = now.filter(isTerminating).length;
    st.uncountedTerminatedPods = {};
    if (job.status?.conditions) st.conditions = job.status.conditions;
    for (const k of Object.keys(st)) if (st[k] === undefined) delete st[k];
    setStatus(c, job, st);
  }
  return changed;
}

/** Does a 5-field cron schedule fire at this minute (UTC)? */
export function cronMatches(schedule: string, clock: number): boolean {
  const macros: Record<string, string> = { '@yearly': '0 0 1 1 *', '@annually': '0 0 1 1 *', '@monthly': '0 0 1 * *', '@weekly': '0 0 * * 0', '@daily': '0 0 * * *', '@midnight': '0 0 * * *', '@hourly': '0 * * * *' };
  const fields = (macros[schedule.trim()] ?? schedule).trim().split(/\s+/);
  if (fields.length !== 5) return false;
  const d = new Date(clock * 1000);
  const vals = [d.getUTCMinutes(), d.getUTCHours(), d.getUTCDate(), d.getUTCMonth() + 1, d.getUTCDay()];
  const fieldOk = (f: string, v: number) =>
    f.split(',').some((part) => {
      const [range, stepText] = part.split('/');
      const step = stepText ? Number(stepText) : 1;
      if (range === '*' || range === '?') return v % step === 0;
      const [a, b] = range!.split('-').map(Number);
      const lo = a!;
      const hi = b ?? (stepText ? 59 : lo);
      return v >= lo && v <= hi && (v - lo) % step === 0;
    });
  return fields.every((f, i) => fieldOk(f, vals[i]!));
}

export function cronJobController(ctx: Ctx): boolean {
  const { state, c, ev } = ctx;
  let changed = false;
  for (const cj of listObjs(c, 'CronJob')) {
    if (isTerminating(cj) || cj.spec.suspend) continue;
    const minute = Math.floor(state.clock / 60) * 60;
    const last = fromIso(cj.status?.lastScheduleTime);
    const created = fromIso(cj.metadata.creationTimestamp);
    if (minute > last && minute > created && cronMatches(cj.spec.schedule, minute)) {
      const jobs = ownedBy(c, cj, 'Job');
      const running = jobs.filter((j) => !j.status?.conditions?.some((x: any) => (x.type === 'Complete' || x.type === 'Failed') && x.status === 'True'));
      if (cj.spec.concurrencyPolicy === 'Forbid' && running.length) continue;
      if (cj.spec.concurrencyPolicy === 'Replace') for (const j of running) apiDelete(state, c, 'Job', j.metadata.namespace, j.metadata.name, { by: 'controller', events: ev });
      const name = `${cj.metadata.name}-${Math.floor(minute / 60)}`;
      const job: KObject = {
        apiVersion: 'batch/v1',
        kind: 'Job',
        metadata: {
          name,
          namespace: cj.metadata.namespace,
          labels: { ...(cj.spec.jobTemplate.metadata?.labels ?? {}) },
          annotations: { 'batch.kubernetes.io/cronjob-scheduled-timestamp': iso(minute) },
          ownerReferences: [controllerRef(cj)],
        } as any,
        spec: clone(cj.spec.jobTemplate.spec),
      };
      const res = apiCreate(state, c, job, { events: ev });
      if (res.ok) {
        recordEvent(state, c, cj, 'Normal', 'SuccessfulCreate', `Created job ${name}`, 'cronjob-controller');
        changed = true;
      }
      cj.status = { ...(cj.status ?? {}), lastScheduleTime: iso(minute) };
    }
    // History limits and status.
    const jobs = ownedBy(c, cj, 'Job').sort((a, b) => a.metadata.name.localeCompare(b.metadata.name, undefined, { numeric: true }));
    const okJobs = jobs.filter((j) => j.status?.conditions?.some((x: any) => x.type === 'Complete' && x.status === 'True'));
    const badJobs = jobs.filter((j) => j.status?.conditions?.some((x: any) => x.type === 'Failed' && x.status === 'True'));
    for (const j of okJobs.slice(0, Math.max(0, okJobs.length - (cj.spec.successfulJobsHistoryLimit ?? 3)))) {
      apiDelete(state, c, 'Job', j.metadata.namespace, j.metadata.name, { by: 'controller', events: ev });
      recordEvent(state, c, cj, 'Normal', 'SuccessfulDelete', `Deleted job ${j.metadata.name}`, 'cronjob-controller');
    }
    for (const j of badJobs.slice(0, Math.max(0, badJobs.length - (cj.spec.failedJobsHistoryLimit ?? 1)))) {
      apiDelete(state, c, 'Job', j.metadata.namespace, j.metadata.name, { by: 'controller', events: ev });
    }
    // Jobs made by hand (`kubectl create job --from=cronjob/…`) are not in the CronJob's status, like the real controller.
    const scheduled = (j: KObject) => j.metadata.annotations?.['cronjob.kubernetes.io/instantiate'] !== 'manual';
    const active = jobs.filter((j) => scheduled(j) && !okJobs.includes(j) && !badJobs.includes(j));
    const lastOk = okJobs.filter(scheduled)[okJobs.filter(scheduled).length - 1];
    setStatus(c, cj, {
      ...(active.length ? { active: active.map((j) => ({ apiVersion: 'batch/v1', kind: 'Job', name: j.metadata.name, namespace: j.metadata.namespace, uid: j.metadata.uid })) } : {}),
      ...(cj.status?.lastScheduleTime ? { lastScheduleTime: cj.status.lastScheduleTime } : {}),
      ...(lastOk ? { lastSuccessfulTime: lastOk.status.completionTime } : cj.status?.lastSuccessfulTime ? { lastSuccessfulTime: cj.status.lastSuccessfulTime } : {}),
    });
  }
  return changed;
}

/** Let controllers' own updates through the API (used by scale on owners). */
export function updateViaApi(ctx: Ctx, o: KObject): boolean {
  return apiUpdate(ctx.state, ctx.c, o, { events: ctx.ev }).ok;
}

/** A Pod created by a controller has this owner (kind/name). */
export function ownerText(o: KObject): string | undefined {
  const r = o.metadata.ownerReferences?.find((x) => x.controller);
  return r ? `${r.kind}/${r.name}` : undefined;
}

export { createObj };
