// The kubelet: on each stall (node), it pulls images, starts containers, runs probes,
// restarts crashed containers with a back-off (CrashLoopBackOff), kills containers over
// their memory limit (OOMKilled), and finishes deleted pods after their grace period.
// One call = one simulated second. Event texts follow the real kubelet.
import { lookupImage, normalizeImage, programFor, pullError } from '../images';
import { getObj, listObjs, podReady, recordEvent, removeObj } from '../store';
import type { Behavior, ContainerRuntime, KObject, PodRuntime } from '../types';
import { fromIso, hexId, iso, memBytes, mib } from '../util';
import { unb64 } from '../defaults';
import { klogStamp } from '../node/fixtures';
import { crashBehavior, mirrorCrash } from '../node/os';
import type { Ctx } from './workloads';

const MAX_BACKOFF = 300;

export function newContainerRuntime(name: string): ContainerRuntime {
  return {
    name,
    startedAt: null,
    nextStartAt: null,
    backoff: 0,
    pullAttempts: 0,
    pulled: false,
    pulling: false,
    logs: [],
    previousLogs: null,
    readyOk: 0,
    readyFail: 0,
    liveFail: 0,
    startupOk: false,
    requests: 0,
    leak: 0,
    sick: false,
    killAt: null,
    killReason: null,
    wait: 0,
  };
}

/** Files a pod's containers can see: mounted ConfigMaps and Secrets (path → content). */
export function podFiles(ctx: Ctx, pod: KObject, container: any): { files: Record<string, string>; missing: string | null } {
  const files: Record<string, string> = {};
  let missing: string | null = null;
  for (const m of container.volumeMounts ?? []) {
    const vol = (pod.spec.volumes ?? []).find((v: any) => v.name === m.name);
    if (!vol) continue;
    const src = vol.configMap ? { kind: 'ConfigMap', name: vol.configMap.name, items: vol.configMap.items, optional: vol.configMap.optional } : vol.secret ? { kind: 'Secret', name: vol.secret.secretName, items: vol.secret.items, optional: vol.secret.optional } : null;
    if (!src) continue;
    const obj = getObj(ctx.c, src.kind, pod.metadata.namespace, src.name);
    if (!obj) {
      if (!src.optional) missing = `MountVolume.SetUp failed for volume "${m.name}" : ${src.kind.toLowerCase()} "${src.name}" not found`;
      continue;
    }
    const data: Record<string, string> = src.kind === 'Secret' ? Object.fromEntries(Object.entries(obj.data ?? {}).map(([k, v]) => [k, unb64(String(v))])) : (obj.data ?? {});
    const entries: [string, string][] = src.items ? src.items.map((it: any) => [it.path, data[it.key] ?? '']) : Object.entries(data);
    const base = m.subPath ? m.mountPath : m.mountPath.replace(/\/$/, '');
    for (const [k, v] of entries) {
      if (m.subPath) {
        if (k === m.subPath) files[base] = v;
      } else files[`${base}/${k}`] = v;
    }
  }
  return { files, missing };
}

/** Environment variables of a container (env + envFrom), or the reason it can't start. */
export function containerEnv(ctx: Ctx, pod: KObject, container: any): { env: Record<string, string>; error: string | null } {
  const env: Record<string, string> = {};
  for (const ef of container.envFrom ?? []) {
    const ref = ef.configMapRef ? { kind: 'ConfigMap', name: ef.configMapRef.name, optional: ef.configMapRef.optional } : { kind: 'Secret', name: ef.secretRef?.name, optional: ef.secretRef?.optional };
    const obj = getObj(ctx.c, ref.kind, pod.metadata.namespace, ref.name);
    if (!obj) {
      if (!ref.optional) return { env, error: `${ref.kind.toLowerCase()} "${ref.name}" not found` };
      continue;
    }
    for (const [k, v] of Object.entries(obj.data ?? {})) env[`${ef.prefix ?? ''}${k}`] = ref.kind === 'Secret' ? unb64(String(v)) : String(v);
  }
  for (const e of container.env ?? []) {
    if (e.value !== undefined) env[e.name] = String(e.value).replace(/\$\((\w+)\)/g, (_m, v: string) => env[v] ?? `$(${v})`);
    else if (e.valueFrom?.configMapKeyRef || e.valueFrom?.secretKeyRef) {
      const r = e.valueFrom.configMapKeyRef ?? e.valueFrom.secretKeyRef;
      const kind = e.valueFrom.configMapKeyRef ? 'ConfigMap' : 'Secret';
      const obj = getObj(ctx.c, kind, pod.metadata.namespace, r.name);
      if (!obj) {
        if (r.optional) continue;
        return { env, error: `${kind.toLowerCase()} "${r.name}" not found` };
      }
      const v = obj.data?.[r.key];
      if (v === undefined) {
        if (r.optional) continue;
        return { env, error: `couldn't find key ${r.key} in ${kind} ${pod.metadata.namespace}/${r.name}` };
      }
      env[e.name] = kind === 'Secret' ? unb64(String(v)) : String(v);
    } else if (e.valueFrom?.fieldRef) {
      const f = e.valueFrom.fieldRef.fieldPath;
      env[e.name] = f === 'metadata.name' ? pod.metadata.name : f === 'metadata.namespace' ? pod.metadata.namespace! : f === 'spec.nodeName' ? pod.spec.nodeName : f === 'status.podIP' ? (pod.status?.podIP ?? '') : '';
    }
  }
  return { env, error: null };
}

/** The program a container runs (null = unknown image). */
export function behaviorOf(ctx: Ctx, pod: KObject, container: any): Behavior | null {
  // K9: a static pod whose manifest command is broken stops at once (real kube-scheduler output).
  const crash = mirrorCrash(ctx.c, pod);
  if (crash) return crashBehavior(pod.metadata.labels?.component ?? container.name, crash);
  const { env } = containerEnv(ctx, pod, container);
  const { files } = podFiles(ctx, pod, container);
  return programFor(container, env, files, pod.metadata.name);
}

/** Files present at time t of a container instance (static files + timed touch/rm). */
export function filesAt(b: Behavior, t: number): Set<string> {
  const set = new Set(Object.keys(b.files));
  for (const op of b.fileOps) {
    if (op.at > t) break;
    if (op.op === 'touch') set.add(op.path);
    else set.delete(op.path);
  }
  return set;
}

function fmtTime(token: string, clock: number): string {
  const d = new Date(clock * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const Y = d.getUTCFullYear();
  const hms = `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
  if (token === '@DATE') return `${days[d.getUTCDay()]} ${months[d.getUTCMonth()]} ${p(d.getUTCDate())} ${hms} UTC ${Y}`;
  if (token === '@PGTIME') return `${Y}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${hms}.000 UTC`;
  if (token === '@REDISTIME') return `${p(d.getUTCDate())} ${months[d.getUTCMonth()]} ${Y} ${hms}.000`;
  if (token === '@KLOG') return klogStamp('@KLOG', clock);
  if (token === '@CLF') return `${p(d.getUTCDate())}/${months[d.getUTCMonth()]}/${Y}:${hms} +0000`;
  return `${Y}/${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())} ${hms}`;
}

export function stamp(text: string, clock: number): string {
  return text.replace(/@(DATE|PGTIME|REDISTIME|CLF|KLOG|TIME)/g, (m) => fmtTime(m, clock));
}

/** Probe one container. Returns null when it passes, else the failure text. */
function probe(_ctx: Ctx, pod: KObject, rt: ContainerRuntime, b: Behavior, p: any, now: number, container: any): string | null {
  const ip = pod.status?.podIP ?? '';
  const t = now - (rt.startedAt ?? now);
  const portOf = (port: any) => (typeof port === 'number' ? port : Number((container.ports ?? []).find((x: any) => x.name === port)?.containerPort ?? port));
  if (p.httpGet) {
    const port = portOf(p.httpGet.port);
    const url = `${(p.httpGet.scheme ?? 'HTTP').toLowerCase()}://${ip}:${port}${p.httpGet.path ?? '/'}`;
    if (!b.ports.includes(port) || t < b.warmup) return `Get "${url}": dial tcp ${ip}:${port}: connect: connection refused`;
    let status = b.http ? b.http(p.httpGet.path ?? '/').status : 404;
    if (rt.sick) status = 503;
    if (b.http && b.ports.includes(port)) {
      rt.logs.push({ t: now, text: `${ip.replace(/\.\d+$/, '.1')} - - [@CLF] "GET ${p.httpGet.path ?? '/'} HTTP/1.1" ${status} ${status === 200 ? 896 : 153} "-" "kube-probe/1.37" "-"` });
    }
    return status >= 200 && status < 400 ? null : `HTTP probe failed with statuscode: ${status}`;
  }
  if (p.tcpSocket) {
    const port = portOf(p.tcpSocket.port);
    if (!b.ports.includes(port) || t < b.warmup || rt.sick) return `dial tcp ${ip}:${port}: connect: connection refused`;
    return null;
  }
  if (p.exec) {
    const cmd: string[] = p.exec.command ?? [];
    const line = cmd.join(' ');
    if (rt.sick) return '';
    const cat = /(?:^|\s)cat\s+(\S+)/.exec(line);
    if (cat) return filesAt(b, t).has(cat[1]!) ? null : `cat: can't open '${cat[1]}': No such file or directory`;
    if (/(^|\s)false$/.test(line)) return '';
    return null;
  }
  if (p.grpc) return b.ports.includes(p.grpc.port) && t >= b.warmup ? null : `timeout: failed to connect service ":${p.grpc.port}" within 1s: context deadline exceeded`;
  return null;
}

function due(p: any, t: number): boolean {
  const delay = p.initialDelaySeconds ?? 0;
  const period = p.periodSeconds ?? 10;
  return t >= delay && (t - delay) % period === 0;
}

/**
 * Liveness: the kubelet's probe worker runs on its own ticker, so the first check lands somewhere
 * between 0 and periodSeconds after the container starts. Take the full period (no instant kill):
 * with 5 s and 3 tries, a sleepy container is restarted about 15 s after it starts.
 */
function dueLive(p: any, t: number): boolean {
  const delay = p.initialDelaySeconds ?? 0;
  return t > delay && due(p, t);
}

function containerStatus(_c: Ctx, _pod: KObject, spec: any, _rt: ContainerRuntime, prev: any): any {
  const img = normalizeImage(String(spec.image ?? ''));
  return {
    ...(prev?.containerID ? { containerID: prev.containerID } : {}),
    image: img.ref,
    imageID: prev?.imageID ?? '',
    lastState: prev?.lastState ?? {},
    name: spec.name,
    ready: prev?.ready ?? false,
    restartCount: prev?.restartCount ?? 0,
    started: prev?.started ?? false,
    state: prev?.state ?? { waiting: { reason: 'ContainerCreating' } },
    ...(spec.volumeMounts?.length
      ? { volumeMounts: spec.volumeMounts.map((m: any) => ({ mountPath: m.mountPath, name: m.name, ...(m.readOnly ? { readOnly: true, recursiveReadOnly: 'Disabled' } : {}) })) }
      : {}),
  };
}

function setPodCondition(conds: any[], type: string, status: string, now: number, reason?: string, message?: string): any[] {
  const old = conds.find((x) => x.type === type);
  const t = old && old.status === status ? old.lastTransitionTime : iso(now);
  const cond: any = { lastProbeTime: null, lastTransitionTime: t, status, type };
  if (reason) cond.reason = reason;
  if (message) cond.message = message;
  if (type === 'PodReadyToStartContainers') delete cond.lastProbeTime;
  return [...conds.filter((x) => x.type !== type), cond];
}

const COND_ORDER = ['PodReadyToStartContainers', 'Initialized', 'Ready', 'ContainersReady', 'PodScheduled'];

/** Run every kubelet for one second. */
export function kubelet(ctx: Ctx): void {
  const { state, c } = ctx;
  const now = state.clock;
  for (const pod of listObjs(c, 'Pod')) {
    const nodeName = pod.spec?.nodeName;
    if (!nodeName) continue;
    const nrt = c.nodes[nodeName];
    if (!nrt || !nrt.up) continue;
    const node = getObj(c, 'Node', undefined, nodeName);
    let rt = c.pods[pod.metadata.uid];
    if (!rt) {
      rt = { uid: pod.metadata.uid, containers: {}, initDone: 0, goneAt: null };
      c.pods[pod.metadata.uid] = rt;
    }
    syncPod(ctx, pod, rt, node, nodeName, now);
  }
}

function assignIp(ctx: Ctx, pod: KObject, nodeName: string): void {
  const { c } = ctx;
  if (pod.status?.podIP) return;
  const node = getObj(c, 'Node', undefined, nodeName);
  if (pod.spec.hostNetwork) {
    pod.status.podIP = node?.status?.addresses?.[0]?.address;
  } else {
    const cidr = String(node?.spec?.podCIDR ?? '10.244.9.0/24').replace(/\.0\/24$/, '');
    const n = (c.ipNext[nodeName] = (c.ipNext[nodeName] ?? 1) + 1);
    pod.status.podIP = `${cidr}.${n}`;
  }
  pod.status.podIPs = [{ ip: pod.status.podIP }];
  pod.status.hostIP = node?.status?.addresses?.[0]?.address;
  pod.status.hostIPs = [{ ip: pod.status.hostIP }];
}

function syncPod(ctx: Ctx, pod: KObject, rt: PodRuntime, node: KObject | undefined, nodeName: string, now: number): void {
  const { state, c, ev } = ctx;
  const ns = pod.metadata.namespace!;
  const name = pod.metadata.name;
  const before = JSON.stringify(pod.status);
  const st = (pod.status = pod.status ?? { phase: 'Pending' });
  const policy = pod.spec.restartPolicy ?? 'Always';
  const specs: any[] = pod.spec.containers ?? [];
  const inits: any[] = pod.spec.initContainers ?? [];
  const nrt = c.nodes[nodeName]!;

  // --- Deletion: stop containers, then the pod object goes away.
  if (pod.metadata.deletionTimestamp) {
    const deadline = fromIso(pod.metadata.deletionTimestamp);
    let allStopped = true;
    for (const cs of [...inits, ...specs]) {
      const r = rt.containers[cs.name];
      if (!r || r.startedAt === null) continue;
      if (r.killAt === null) {
        const b = behaviorOf(ctx, pod, cs);
        r.killAt = Math.min(deadline, now + (b?.ignoresTerm ? Math.max(0, deadline - now) : 1));
        r.killReason = 'delete';
        recordEvent(state, c, pod, 'Normal', 'Killing', `Stopping container ${cs.name}`, 'kubelet', nodeName);
      }
      if (now >= r.killAt) {
        r.startedAt = null;
        const s = (st.containerStatuses ?? []).find((x: any) => x.name === cs.name);
        if (s) {
          s.state = { terminated: { containerID: s.containerID, exitCode: r.killAt >= deadline ? 137 : 0, finishedAt: iso(now), reason: r.killAt >= deadline ? 'Error' : 'Completed', startedAt: s.state?.running?.startedAt ?? iso(now) } };
          s.ready = false;
          s.started = false;
        }
      } else allStopped = false;
    }
    st.conditions = setPodCondition(st.conditions ?? [], 'Ready', 'False', now, 'PodCompleted');
    st.conditions = setPodCondition(st.conditions, 'ContainersReady', 'False', now, 'PodCompleted');
    if (allStopped || now >= deadline) {
      removeObj(c, pod, ev);
      ev.push({ type: 'podGone', pod: name, namespace: ns });
    }
    return;
  }

  // --- Sandbox: an IP and the first conditions.
  if (!st.startTime) {
    st.startTime = iso(now);
    st.hostIP = node?.status?.addresses?.[0]?.address;
    st.hostIPs = [{ ip: st.hostIP }];
  }
  let conds: any[] = st.conditions ?? [];
  // Volumes: claims must be bound, ConfigMaps / Secrets must exist.
  for (const v of pod.spec.volumes ?? []) {
    if (v.persistentVolumeClaim) {
      const pvc = getObj(c, 'PersistentVolumeClaim', ns, v.persistentVolumeClaim.claimName);
      if (pvc?.status?.phase !== 'Bound') {
        finish(ctx, pod, conds, before);
        return;
      }
    }
  }
  const mountProblem = [...inits, ...specs].map((cs) => podFiles(ctx, pod, cs).missing).find(Boolean);
  if (mountProblem) {
    if (!c.unschedulable[`mount:${pod.metadata.uid}`] || now - Number(c.unschedulable[`mount:${pod.metadata.uid}`]) >= 60) {
      recordEvent(state, c, pod, 'Warning', 'FailedMount', mountProblem, 'kubelet', nodeName);
      c.unschedulable[`mount:${pod.metadata.uid}`] = String(now);
    }
    st.containerStatuses = specs.map((cs) => containerStatus(ctx, pod, cs, rt.containers[cs.name]!, (st.containerStatuses ?? []).find((x: any) => x.name === cs.name)));
    conds = setPodCondition(conds, 'PodReadyToStartContainers', 'False', now);
    conds = setPodCondition(conds, 'Initialized', 'True', now);
    conds = setPodCondition(conds, 'Ready', 'False', now, 'ContainersNotReady', `containers with unready status: [${specs.map((x) => x.name).join(' ')}]`);
    conds = setPodCondition(conds, 'ContainersReady', 'False', now, 'ContainersNotReady', `containers with unready status: [${specs.map((x) => x.name).join(' ')}]`);
    finish(ctx, pod, conds, before);
    return;
  }
  delete c.unschedulable[`mount:${pod.metadata.uid}`];
  if (!st.podIP) {
    assignIp(ctx, pod, nodeName);
    conds = setPodCondition(conds, 'PodReadyToStartContainers', 'True', now);
  }

  // --- Init containers, one after another (native sidecars keep running).
  const initStatuses: any[] = st.initContainerStatuses ?? [];
  let initsDone = true;
  for (let i = 0; i < inits.length; i++) {
    const cs = inits[i];
    const sidecar = cs.restartPolicy === 'Always';
    const prev = initStatuses.find((x) => x.name === cs.name);
    const r = (rt.containers[cs.name] ??= newContainerRuntime(cs.name));
    const status = containerStatus(ctx, pod, cs, r, prev);
    runContainer(ctx, pod, cs, r, status, nodeName, now, sidecar ? 'Always' : policy === 'Never' ? 'Never' : 'OnFailure');
    initStatuses[i] = status;
    const finished = status.state?.terminated?.exitCode === 0;
    if (sidecar ? !status.started : !finished) {
      initsDone = false;
      break;
    }
  }
  if (inits.length) st.initContainerStatuses = initStatuses.slice(0, inits.length).filter(Boolean).concat(inits.slice(initStatuses.filter(Boolean).length).map((cs) => containerStatus(ctx, pod, cs, rt.containers[cs.name] ?? newContainerRuntime(cs.name), { state: { waiting: { reason: 'PodInitializing' } } })));
  conds = setPodCondition(conds, 'Initialized', initsDone ? 'True' : 'False', now, initsDone ? undefined : 'ContainersNotInitialized', initsDone ? undefined : `containers with incomplete status: [${inits.map((x) => x.name).join(' ')}]`);

  // --- App containers.
  const statuses: any[] = [];
  for (const cs of specs) {
    const prev = (st.containerStatuses ?? []).find((x: any) => x.name === cs.name);
    const r = (rt.containers[cs.name] ??= newContainerRuntime(cs.name));
    const status = containerStatus(ctx, pod, cs, r, initsDone ? prev : { ...(prev ?? {}), state: { waiting: { reason: 'PodInitializing' } } });
    if (initsDone) runContainer(ctx, pod, cs, r, status, nodeName, now, policy);
    statuses.push(status);
  }
  st.containerStatuses = statuses;

  // --- Phase and readiness.
  const allReady = statuses.every((s) => s.ready);
  const running = statuses.some((s) => s.state?.running);
  const terminated = statuses.every((s) => s.state?.terminated);
  if (terminated && statuses.length) {
    const failedOne = statuses.some((s) => s.state.terminated.exitCode !== 0);
    if (policy === 'Never' || (policy === 'OnFailure' && !failedOne)) st.phase = failedOne ? 'Failed' : 'Succeeded';
  } else if (running || statuses.some((s) => s.restartCount > 0)) st.phase = 'Running';
  const unready = statuses.filter((s) => !s.ready).map((s) => s.name);
  const finished = st.phase === 'Succeeded' || st.phase === 'Failed';
  if (finished) {
    conds = setPodCondition(conds, 'PodReadyToStartContainers', 'False', now);
    conds = setPodCondition(conds, 'Ready', 'False', now, 'PodCompleted');
    conds = setPodCondition(conds, 'ContainersReady', 'False', now, 'PodCompleted');
  } else {
    const wasReady = podReady(pod);
    const nodeOk = node?.status?.conditions?.some((x: any) => x.type === 'Ready' && x.status === 'True');
    const ready = allReady && nodeOk !== false;
    conds = setPodCondition(conds, 'Ready', ready ? 'True' : 'False', now, ready ? undefined : 'ContainersNotReady', ready ? undefined : `containers with unready status: [${unready.join(' ')}]`);
    conds = setPodCondition(conds, 'ContainersReady', allReady ? 'True' : 'False', now, allReady ? undefined : 'ContainersNotReady', allReady ? undefined : `containers with unready status: [${unready.join(' ')}]`);
    if (ready !== wasReady) ev.push({ type: 'podReady', pod: name, namespace: ns, ready });
  }
  void nrt;
  finish(ctx, pod, conds, before);
}

function finish(ctx: Ctx, pod: KObject, conds: any[], before: string): void {
  pod.status.conditions = COND_ORDER.map((t) => conds.find((x) => x.type === t)).filter(Boolean);
  if (JSON.stringify(pod.status) !== before) {
    ctx.c.rv += 1;
    pod.metadata.resourceVersion = String(ctx.c.rv);
  }
}

/** One container for one second: pull, start, run, probe, crash, restart. */
function runContainer(ctx: Ctx, pod: KObject, cs: any, r: ContainerRuntime, status: any, nodeName: string, now: number, policy: string): void {
  const { state, c, ev } = ctx;
  const ns = pod.metadata.namespace!;
  const name = pod.metadata.name;
  const nrt = c.nodes[nodeName]!;
  const img = normalizeImage(String(cs.image ?? ''));
  const ev2 = (type: 'Normal' | 'Warning', reason: string, msg: string) => recordEvent(state, c, pod, type, reason, msg, 'kubelet', nodeName);

  // Pull: Pulling → Pulled, or ErrImagePull → ImagePullBackOff (10s, 20s, 40s … 5m) → Pulling again.
  if (!r.pulled) {
    const waiting = status.state?.waiting?.reason;
    if (r.nextStartAt !== null && now < r.nextStartAt) {
      if (waiting === 'ErrImagePull' && !r.pulling) {
        ev2('Normal', 'BackOff', `Back-off pulling image "${cs.image}"`);
        ev2('Warning', 'Failed', 'Error: ImagePullBackOff');
        status.state = { waiting: { message: `Back-off pulling image "${cs.image}": ErrImagePull: ${pullError(String(cs.image ?? ''))}`, reason: 'ImagePullBackOff' } };
      }
      return;
    }
    const found = lookupImage(String(cs.image ?? ''));
    const present = !r.pulling && nrt.images.includes(img.ref) && cs.imagePullPolicy !== 'Always';
    if (present) {
      ev2('Normal', 'Pulled', `Container image "${cs.image}" already present on machine`);
      r.pulled = true;
    } else if (!r.pulling) {
      ev2('Normal', 'Pulling', `Pulling image "${cs.image}"`);
      r.pulling = true;
      r.pullAttempts++;
      r.nextStartAt = now + ('info' in found ? found.info.pull : 2);
      if (!waiting) status.state = { waiting: { reason: 'ContainerCreating' } };
      return;
    } else {
      r.pulling = false;
      if ('info' in found) {
        const secs = (found.info.pull + 0.4 + (found.info.size % 997) / 1000).toFixed(3);
        ev2('Normal', 'Pulled', `Successfully pulled image "${cs.image}" in ${secs}s (${secs}s including waiting). Image size: ${found.info.size} bytes.`);
        nrt.images.push(img.ref);
        r.pulled = true;
        r.backoff = 0;
        r.nextStartAt = null;
      } else {
        const msg = pullError(String(cs.image ?? ''));
        ev2('Warning', 'Failed', `Failed to pull image "${cs.image}": ${msg}`);
        ev2('Warning', 'Failed', 'Error: ErrImagePull');
        status.state = { waiting: { message: msg, reason: 'ErrImagePull' } };
        ev.push({ type: 'imagePullFailed', pod: name, namespace: ns, image: String(cs.image) });
        r.backoff = Math.min(MAX_BACKOFF, r.backoff ? r.backoff * 2 : 10);
        r.nextStartAt = now + r.backoff;
        return;
      }
    }
  }

  const b = behaviorOf(ctx, pod, cs);
  if (!b) return;

  // Start (or restart after a back-off).
  if (r.startedAt === null) {
    if (status.state?.terminated && policy !== 'Always' && (policy === 'Never' || status.state.terminated.exitCode === 0)) return;
    if (r.nextStartAt !== null && now < r.nextStartAt && status.state?.terminated) {
      // Waiting out the back-off: CrashLoopBackOff.
      if (!status.state.waiting) {
        status.lastState = { terminated: status.state.terminated };
        status.state = {
          waiting: { message: `back-off ${r.wait}s restarting failed container=${cs.name} pod=${name}_${ns}(${pod.metadata.uid})`, reason: 'CrashLoopBackOff' },
        };
        ev2('Warning', 'BackOff', `Back-off restarting failed container ${cs.name} in pod ${name}_${ns}(${pod.metadata.uid})`);
      }
      return;
    }
    if (r.nextStartAt !== null && now < r.nextStartAt && status.state?.waiting?.reason === 'CrashLoopBackOff') return;
    const { env: startEnv, error } = containerEnv(ctx, pod, cs);
    if (error) {
      if (status.state?.waiting?.reason !== 'CreateContainerConfigError') ev2('Warning', 'Failed', `Error: ${error}`);
      status.state = { waiting: { message: error, reason: 'CreateContainerConfigError' } };
      return;
    }
    const restarting = status.state?.terminated || status.state?.waiting?.reason === 'CrashLoopBackOff';
    if (restarting) {
      status.lastState = { terminated: status.state.terminated ?? status.lastState?.terminated };
      status.restartCount = (status.restartCount ?? 0) + 1;
      r.previousLogs = r.logs;
      ev.push({ type: 'podRestarted', pod: name, namespace: ns, container: cs.name, restarts: status.restartCount });
    }
    r.logs = [];
    r.startedAt = now;
    r.env = startEnv;
    r.written = {};
    r.readyOk = 0;
    r.readyFail = 0;
    r.liveFail = 0;
    r.startupOk = !cs.startupProbe;
    r.killAt = null;
    r.killReason = null;
    status.containerID = `containerd://${hexId(state)}`;
    status.imageID = `${img.repo}@sha256:${hexId(state)}`;
    status.state = { running: { startedAt: iso(now) } };
    status.started = !cs.startupProbe;
    status.ready = false;
    ev2('Normal', 'Created', `Created container: ${cs.name}`);
    ev2('Normal', 'Started', `Started container ${cs.name}`);
    ev.push({ type: 'podStarted', pod: name, namespace: ns, container: cs.name });
  }

  // Running.
  const t = now - r.startedAt!;
  for (const l of b.logs) if (l.at === t || (t === 0 && l.at <= 0)) r.logs.push({ t: now, text: stamp(l.text, now) });
  if (b.repeat && t > 0 && t % b.repeat.every === 0) r.logs.push({ t: now, text: stamp(b.repeat.text, now) });
  if (t === 0) {
    // Lines scheduled exactly at start are logged once.
  }

  const exit = (code: number, reason: string, msg?: string) => {
    status.state = { terminated: { containerID: status.containerID, exitCode: code, finishedAt: iso(now), reason, startedAt: iso(r.startedAt!), ...(msg ? { message: msg } : {}) } };
    status.ready = false;
    status.started = false;
    r.startedAt = null;
    ev.push({ type: 'podCrashed', pod: name, namespace: ns, container: cs.name, reason, exitCode: code });
    const restart = policy === 'Always' || (policy === 'OnFailure' && code !== 0);
    if (restart) {
      // First crash: restart at once. Then wait 10s, 20s, 40s … up to 5 minutes.
      if (t >= 600) r.backoff = 0;
      r.wait = r.backoff;
      r.nextStartAt = now + r.wait;
      r.backoff = r.wait === 0 ? 10 : Math.min(MAX_BACKOFF, r.wait * 2);
    }
  };

  // Killed by liveness / startup failure (restart in place).
  if (r.killAt !== null && now >= r.killAt) {
    if (r.killReason === 'crash') exit(1, 'Error');
    else if (b.ignoresTerm) exit(137, 'Error');
    else exit(0, 'Completed');
    return;
  }
  // Exited by itself.
  if (b.exitAfter !== undefined && t >= b.exitAfter) {
    exit(b.exitCode ?? 0, (b.exitCode ?? 0) === 0 ? 'Completed' : 'Error');
    return;
  }
  // Memory limit.
  const limit = memBytes(cs.resources?.limits?.memory);
  const used = (b.memory(t) + r.leak * t) * 1024 * 1024;
  if (limit && used > limit) {
    exit(137, 'OOMKilled');
    return;
  }
  void mib;

  // Probes.
  const container = cs;
  if (cs.startupProbe && !r.startupOk) {
    if (due(cs.startupProbe, t)) {
      const fail = probe(ctx, pod, r, b, cs.startupProbe, now, container);
      if (fail === null) {
        r.startupOk = true;
        status.started = true;
      } else {
        r.liveFail++;
        ev2('Warning', 'Unhealthy', `Startup probe failed: ${fail}`);
        if (r.liveFail >= (cs.startupProbe.failureThreshold ?? 3)) {
          ev2('Normal', 'Killing', `Container ${cs.name} failed startup probe, will be restarted`);
          r.killAt = now + 1;
          r.killReason = 'probe';
        }
      }
    }
    return;
  }
  status.started = true;
  if (cs.livenessProbe && dueLive(cs.livenessProbe, t) && r.killAt === null) {
    const fail = probe(ctx, pod, r, b, cs.livenessProbe, now, container);
    if (fail === null) r.liveFail = 0;
    else {
      r.liveFail++;
      ev2('Warning', 'Unhealthy', `Liveness probe failed: ${fail}`);
      if (r.liveFail >= (cs.livenessProbe.failureThreshold ?? 3)) {
        ev2('Normal', 'Killing', `Container ${cs.name} failed liveness probe, will be restarted`);
        r.killAt = now + Math.min(2, pod.spec.terminationGracePeriodSeconds ?? 30);
        r.killReason = 'probe';
      }
    }
  }
  if (cs.readinessProbe) {
    if (due(cs.readinessProbe, t)) {
      const fail = probe(ctx, pod, r, b, cs.readinessProbe, now, container);
      if (fail === null) {
        r.readyFail = 0;
        r.readyOk++;
        if (r.readyOk >= (cs.readinessProbe.successThreshold ?? 1)) status.ready = true;
      } else {
        r.readyOk = 0;
        r.readyFail++;
        ev2('Warning', 'Unhealthy', `Readiness probe failed: ${fail}`);
        if (r.readyFail >= (cs.readinessProbe.failureThreshold ?? 3)) status.ready = false;
      }
    }
  } else status.ready = !r.sick;
}
