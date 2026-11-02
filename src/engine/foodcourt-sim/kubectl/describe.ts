// `kubectl describe`: the human-readable report, trimmed to what lessons need.
// Layout follows kubectl 1.37 (tab-aligned blocks, Events table at the end).
import { podSecurityProblems } from '../admission';
import { revisionOf } from '../controllers/workloads';
import { unb64 } from '../defaults';
import { normalizeImage } from '../images';
import { quotaStatus } from '../admission';
import { eventsFor, getObj, listObjs, ownedBy, podReady, podStatusText } from '../store';
import type { Cluster, KObject, KubeState } from '../types';
import { cpuMilli, fromIso, humanDuration, labelText, memBytes, rfc1123, selectorText } from '../util';
import { nodeStatusText, tabwrite } from './print';

type L = string[];

function kv(out: L, indent: string, key: string, value: string | number | undefined): void {
  out.push(`${indent}${key}:\t${value === undefined || value === '' ? '' : value}`);
}

function multi(out: L, indent: string, key: string, items: string[]): void {
  if (!items.length) {
    kv(out, indent, key, '<none>');
    return;
  }
  out.push(`${indent}${key}:\t${items[0]}`);
  for (const x of items.slice(1)) out.push(`${indent}\t${x}`);
}

function labels(o: KObject): string[] {
  return Object.entries(o.metadata.labels ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`);
}

function annotations(o: KObject): string[] {
  return Object.entries(o.metadata.annotations ?? {})
    .filter(([k]) => k !== 'kubectl.kubernetes.io/last-applied-configuration' && !k.startsWith('fahamlah/'))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}: ${v}`);
}

export function eventsBlock(out: L, state: KubeState, c: Cluster, o: KObject): void {
  const evs = eventsFor(c, o);
  if (!evs.length) {
    kv(out, '', 'Events', '<none>');
    return;
  }
  out.push('Events:');
  out.push('  Type\tReason\tAge\tFrom\tMessage');
  out.push('  ----\t------\t----\t----\t-------');
  for (const e of evs) {
    const last = humanDuration(state.clock - fromIso(e.lastTimestamp));
    const ageText = e.count > 1 ? `${last} (x${e.count} over ${humanDuration(state.clock - fromIso(e.firstTimestamp))})` : last;
    out.push(`  ${e.type}\t${e.reason}\t${ageText}\t${e.source?.component ?? ''}\t${e.message}`);
  }
}

function portText(c: any): string {
  const p = (c.ports ?? [])[0];
  return p ? `${p.containerPort}/${p.protocol ?? 'TCP'}${p.name ? ` (${p.name})` : ''}` : '<none>';
}

function probeText(p: any): string {
  let what = '';
  if (p.httpGet) what = `http-get ${(p.httpGet.scheme ?? 'HTTP').toLowerCase()}://${p.httpGet.host ?? ''}:${p.httpGet.port}${p.httpGet.path ?? ''}`;
  else if (p.tcpSocket) what = `tcp-socket :${p.tcpSocket.port}`;
  else if (p.exec) what = `exec [${(p.exec.command ?? []).join(' ')}]`;
  else if (p.grpc) what = `grpc <pod>:${p.grpc.port} ${p.grpc.service ?? ''}`.trim();
  return `${what} delay=${p.initialDelaySeconds ?? 0}s timeout=${p.timeoutSeconds ?? 1}s period=${p.periodSeconds ?? 10}s #success=${p.successThreshold ?? 1} #failure=${p.failureThreshold ?? 3}`;
}

function templateProbe(p: any): string {
  return probeText(p).replace('#success=', 'successThreshold=').replace('#failure=', 'failureThreshold=');
}

function envLines(out: L, indent: string, c: any): void {
  const env: any[] = c.env ?? [];
  const from: any[] = c.envFrom ?? [];
  if (!env.length && !from.length) {
    kv(out, indent, 'Environment', '<none>');
    return;
  }
  if (from.length) {
    out.push(`${indent}Environment Variables from:`);
    for (const f of from) {
      const ref = f.configMapRef ?? f.secretRef;
      out.push(`${indent}  ${ref.name}\t${f.configMapRef ? 'ConfigMap' : 'Secret'}  Optional: ${ref.optional ? 'true' : 'false'}`);
    }
  }
  if (env.length) {
    out.push(`${indent}Environment:`);
    for (const e of env) {
      let v = e.value ?? '';
      if (e.valueFrom?.configMapKeyRef) v = `<set to the key '${e.valueFrom.configMapKeyRef.key}' of config map '${e.valueFrom.configMapKeyRef.name}'>`;
      if (e.valueFrom?.secretKeyRef) v = `<set to the key '${e.valueFrom.secretKeyRef.key}' in secret '${e.valueFrom.secretKeyRef.name}'>`;
      if (e.valueFrom?.fieldRef) v = ` (${e.valueFrom.fieldRef.apiVersion ?? 'v1'}:${e.valueFrom.fieldRef.fieldPath})`;
      out.push(`${indent}  ${e.name}:\t${v}${e.valueFrom?.configMapKeyRef || e.valueFrom?.secretKeyRef ? `  Optional: false` : ''}`);
    }
  } else if (from.length) kv(out, indent, 'Environment', '<none>');
}

function resources(out: L, indent: string, c: any): void {
  for (const k of ['limits', 'requests'] as const) {
    const r = c.resources?.[k];
    if (!r || !Object.keys(r).length) continue;
    out.push(`${indent}${k === 'limits' ? 'Limits' : 'Requests'}:`);
    for (const [n, v] of Object.entries(r).sort(([a], [b]) => a.localeCompare(b))) out.push(`${indent}  ${n}:\t${v}`);
  }
}

function mounts(out: L, indent: string, c: any): void {
  const ms: any[] = c.volumeMounts ?? [];
  if (!ms.length) {
    kv(out, indent, 'Mounts', '<none>');
    return;
  }
  out.push(`${indent}Mounts:`);
  for (const m of ms) out.push(`${indent}  ${m.mountPath} from ${m.name} (${m.readOnly ? 'ro' : 'rw'}${m.subPath ? `,path="${m.subPath}"` : ''})`);
}

function volumes(out: L, indent: string, spec: any, templ: boolean): void {
  const vs: any[] = spec.volumes ?? [];
  if (!vs.length) {
    kv(out, indent, 'Volumes', '<none>');
    return;
  }
  out.push(`${indent}Volumes:`);
  for (const v of vs) {
    out.push(`${indent}  ${v.name}:`);
    const i2 = `${indent}    `;
    if (v.projected) {
      kv(out, i2, 'Type', 'Projected (a volume that contains injected data from multiple sources)');
      kv(out, i2, 'TokenExpirationSeconds', 3607);
      kv(out, i2, 'ConfigMapName', 'kube-root-ca.crt');
      kv(out, i2, 'Optional', 'false');
      kv(out, i2, 'DownwardAPI', 'true');
    } else if (v.configMap) {
      kv(out, i2, 'Type', 'ConfigMap (a volume populated by a ConfigMap)');
      kv(out, i2, 'Name', v.configMap.name);
      kv(out, i2, 'Optional', v.configMap.optional ? 'true' : 'false');
    } else if (v.secret) {
      kv(out, i2, 'Type', 'Secret (a volume populated by a Secret)');
      kv(out, i2, 'SecretName', v.secret.secretName);
      kv(out, i2, 'Optional', v.secret.optional ? 'true' : 'false');
    } else if (v.persistentVolumeClaim) {
      kv(out, i2, 'Type', 'PersistentVolumeClaim (a reference to a PersistentVolumeClaim in the same namespace)');
      kv(out, i2, 'ClaimName', v.persistentVolumeClaim.claimName);
      kv(out, i2, 'ReadOnly', v.persistentVolumeClaim.readOnly ? 'true' : 'false');
    } else if (v.emptyDir) {
      kv(out, i2, 'Type', 'EmptyDir (a temporary directory that shares a pod\'s lifetime)');
      kv(out, i2, 'Medium', v.emptyDir.medium ?? '');
      kv(out, i2, 'SizeLimit', v.emptyDir.sizeLimit ?? '<unset>');
    } else if (v.hostPath) {
      kv(out, i2, 'Type', 'HostPath (bare host directory volume)');
      kv(out, i2, 'Path', v.hostPath.path);
      kv(out, i2, 'HostPathType', v.hostPath.type ?? '');
    }
  }
  void templ;
}

function tolerations(spec: any): string[] {
  const ts: any[] = spec.tolerations ?? [];
  return ts.map((t) => {
    let s = t.key ?? '';
    if (t.value) s += `=${t.value}`;
    if (t.effect) s += `:${t.effect}`;
    if (t.operator === 'Exists' && !t.key) s = t.effect ? `:${t.effect}` : '';
    if (t.operator === 'Exists') s += ' op=Exists';
    if (t.tolerationSeconds !== undefined) s += ` for ${t.tolerationSeconds}s`;
    return s.trim() || 'op=Exists';
  });
}

function stateLines(out: L, indent: string, label: string, st: any): void {
  if (!st || !Object.keys(st).length) {
    if (label === 'Last State') kv(out, indent, label, '');
    return;
  }
  if (st.running) {
    kv(out, indent, label, 'Running');
    kv(out, `${indent}  `, 'Started', rfc1123(fromIso(st.running.startedAt)));
  } else if (st.waiting) {
    kv(out, indent, label, 'Waiting');
    kv(out, `${indent}  `, 'Reason', st.waiting.reason);
    if (st.waiting.message && label === 'State' && st.waiting.reason !== 'ContainerCreating') kv(out, `${indent}  `, 'Message', st.waiting.message);
  } else if (st.terminated) {
    kv(out, indent, label, 'Terminated');
    kv(out, `${indent}  `, 'Reason', st.terminated.reason);
    if (st.terminated.message) kv(out, `${indent}  `, 'Message', st.terminated.message);
    kv(out, `${indent}  `, 'Exit Code', st.terminated.exitCode);
    if (st.terminated.startedAt) kv(out, `${indent}  `, 'Started', rfc1123(fromIso(st.terminated.startedAt)));
    kv(out, `${indent}  `, 'Finished', rfc1123(fromIso(st.terminated.finishedAt)));
  }
}

function describePod(state: KubeState, c: Cluster, o: KObject): L {
  const out: L = [];
  const st = o.status ?? {};
  kv(out, '', 'Name', o.metadata.name);
  kv(out, '', 'Namespace', o.metadata.namespace);
  kv(out, '', 'Priority', o.spec.priority ?? 0);
  if (o.spec.priorityClassName) kv(out, '', 'Priority Class Name', o.spec.priorityClassName);
  kv(out, '', 'Service Account', o.spec.serviceAccountName ?? 'default');
  const node = o.spec.nodeName ? getObj(c, 'Node', undefined, o.spec.nodeName) : undefined;
  kv(out, '', 'Node', o.spec.nodeName ? `${o.spec.nodeName}/${node?.status?.addresses?.[0]?.address ?? ''}` : '<none>');
  if (st.startTime) kv(out, '', 'Start Time', rfc1123(fromIso(st.startTime)));
  multi(out, '', 'Labels', labels(o));
  multi(out, '', 'Annotations', annotations(o));
  if (o.metadata.deletionTimestamp) {
    kv(out, '', 'Status', `Terminating (lasts ${humanDuration(Math.max(0, state.clock - fromIso(o.metadata.deletionTimestamp) + (o.metadata.deletionGracePeriodSeconds ?? 30)))})`);
    kv(out, '', 'Termination Grace Period', `${o.metadata.deletionGracePeriodSeconds ?? 30}s`);
  } else kv(out, '', 'Status', st.phase ?? 'Pending');
  if (st.reason) kv(out, '', 'Reason', st.reason);
  kv(out, '', 'IP', st.podIP ?? '');
  if (st.podIP) {
    out.push('IPs:');
    out.push(`  IP:\t${st.podIP}`);
  } else kv(out, '', 'IPs', '<none>');
  const owner = o.metadata.ownerReferences?.find((r) => r.controller);
  if (owner) kv(out, '', 'Controlled By', `${owner.kind}/${owner.name}`);
  const section = (title: string, list: any[], statuses: any[]) => {
    if (!list.length) return;
    out.push(`${title}:`);
    for (const ctr of list) {
      const s = statuses.find((x) => x.name === ctr.name) ?? {};
      // Like kubectl: a pod no scheduler has placed has no container status, so no ID, State or Ready lines.
      const known = Boolean(o.spec.nodeName) || statuses.some((x) => x.name === ctr.name);
      out.push(`  ${ctr.name}:`);
      const i = '    ';
      if (known) kv(out, i, 'Container ID', s.containerID ?? '');
      kv(out, i, 'Image', ctr.image);
      if (known) kv(out, i, 'Image ID', s.imageID ?? '');
      kv(out, i, 'Port', portText(ctr));
      kv(out, i, 'Host Port', ctr.ports?.length ? `${ctr.ports[0].hostPort ?? 0}/${ctr.ports[0].protocol ?? 'TCP'}` : '<none>');
      if (ctr.command) {
        out.push(`${i}Command:`);
        for (const x of ctr.command) out.push(`${i}  ${x}`);
      }
      if (ctr.args) {
        out.push(`${i}Args:`);
        for (const x of ctr.args) out.push(`${i}  ${x}`);
      }
      if (known) {
        stateLines(out, i, 'State', s.state ?? { waiting: { reason: 'ContainerCreating' } });
        if (s.lastState?.terminated) stateLines(out, i, 'Last State', s.lastState);
        kv(out, i, 'Ready', s.ready ? 'True' : 'False');
        kv(out, i, 'Restart Count', s.restartCount ?? 0);
      }
      resources(out, i, ctr);
      if (ctr.livenessProbe) kv(out, i, 'Liveness', probeText(ctr.livenessProbe));
      if (ctr.readinessProbe) kv(out, i, 'Readiness', probeText(ctr.readinessProbe));
      if (ctr.startupProbe) kv(out, i, 'Startup', probeText(ctr.startupProbe));
      envLines(out, i, ctr);
      mounts(out, i, ctr);
    }
  };
  section('Init Containers', o.spec.initContainers ?? [], st.initContainerStatuses ?? []);
  section('Containers', o.spec.containers ?? [], st.containerStatuses ?? []);
  if (st.conditions?.length) {
    out.push('Conditions:');
    out.push('  Type\tStatus');
    for (const x of st.conditions) out.push(`  ${x.type} \t${x.status} `);
  }
  volumes(out, '', o.spec, false);
  kv(out, '', 'QoS Class', st.qosClass ?? 'BestEffort');
  multi(out, '', 'Node-Selectors', Object.entries(o.spec.nodeSelector ?? {}).map(([k, v]) => `${k}=${v}`));
  multi(out, '', 'Tolerations', tolerations(o.spec));
  eventsBlock(out, state, c, o);
  return out;
}

function podTemplate(out: L, t: any, nameIndent = '   '): void {
  out.push('Pod Template:');
  multi(out, '  ', 'Labels', Object.entries(t.metadata?.labels ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`));
  const ann = Object.entries(t.metadata?.annotations ?? {}).map(([k, v]) => `${k}: ${v}`);
  if (ann.length) multi(out, '  ', 'Annotations', ann);
  if (t.spec.serviceAccountName) kv(out, '  ', 'Service Account', t.spec.serviceAccountName);
  const section = (title: string, list: any[]) => {
    if (!list.length) return;
    out.push(`  ${title}:`);
    for (const ctr of list) {
      out.push(`${nameIndent}${ctr.name}:`);
      const i = '    ';
      kv(out, i, 'Image', ctr.image);
      kv(out, i, 'Port', portText(ctr));
      kv(out, i, 'Host Port', ctr.ports?.length ? `${ctr.ports[0].hostPort ?? 0}/${ctr.ports[0].protocol ?? 'TCP'}` : '<none>');
      if (ctr.command) {
        out.push(`${i}Command:`);
        for (const x of ctr.command) out.push(`${i}  ${x}`);
      }
      if (ctr.args) {
        out.push(`${i}Args:`);
        for (const x of ctr.args) out.push(`${i}  ${x}`);
      }
      resources(out, i, ctr);
      if (ctr.livenessProbe) kv(out, i, 'Liveness', templateProbe(ctr.livenessProbe));
      if (ctr.readinessProbe) kv(out, i, 'Readiness', templateProbe(ctr.readinessProbe));
      if (ctr.startupProbe) kv(out, i, 'Startup', templateProbe(ctr.startupProbe));
      envLines(out, i, ctr);
      mounts(out, i, ctr);
    }
  };
  section('Init Containers', t.spec.initContainers ?? []);
  section('Containers', t.spec.containers ?? []);
  volumes(out, '  ', t.spec, true);
  multi(out, '  ', 'Node-Selectors', Object.entries(t.spec.nodeSelector ?? {}).map(([k, v]) => `${k}=${v}`));
  multi(out, '  ', 'Tolerations', tolerations(t.spec));
}

function conditionsTable(out: L, conds: any[]): void {
  out.push('Conditions:');
  out.push('  Type\tStatus\tReason');
  out.push('  ----\t------\t------');
  for (const x of conds) out.push(`  ${x.type} \t${x.status}\t${x.reason ?? ''}`);
}

function describeDeployment(state: KubeState, c: Cluster, o: KObject): L {
  const out: L = [];
  const st = o.status ?? {};
  kv(out, '', 'Name', o.metadata.name);
  kv(out, '', 'Namespace', o.metadata.namespace);
  kv(out, '', 'CreationTimestamp', rfc1123(fromIso(o.metadata.creationTimestamp)));
  multi(out, '', 'Labels', labels(o));
  multi(out, '', 'Annotations', annotations(o));
  kv(out, '', 'Selector', selectorText(o.spec.selector));
  kv(out, '', 'Replicas', `${o.spec.replicas} desired | ${st.updatedReplicas ?? 0} updated | ${st.replicas ?? 0} total | ${st.availableReplicas ?? 0} available | ${st.unavailableReplicas ?? 0} unavailable`);
  kv(out, '', 'StrategyType', o.spec.strategy?.type ?? 'RollingUpdate');
  kv(out, '', 'MinReadySeconds', o.spec.minReadySeconds ?? 0);
  if (o.spec.strategy?.type === 'RollingUpdate') {
    const ru = o.spec.strategy.rollingUpdate ?? {};
    kv(out, '', 'RollingUpdateStrategy', `${ru.maxUnavailable ?? '25%'} max unavailable, ${ru.maxSurge ?? '25%'} max surge`);
  }
  podTemplate(out, o.spec.template);
  if (st.conditions?.length) conditionsTable(out, st.conditions);
  const rss = ownedBy(c, o, 'ReplicaSet');
  const tmpl = JSON.stringify({ ...o.spec.template, metadata: { ...o.spec.template.metadata, labels: { ...(o.spec.template.metadata?.labels ?? {}) } } });
  void tmpl;
  const newest = rss.sort((a, b) => revisionOf(b) - revisionOf(a))[0];
  const old = rss.filter((r) => r !== newest && ((r.spec.replicas ?? 0) > 0 || (r.status?.replicas ?? 0) > 0));
  kv(out, '', 'OldReplicaSets', old.length ? old.map((r) => `${r.metadata.name} (${r.status?.replicas ?? 0}/${r.spec.replicas ?? 0} replicas created)`).join(', ') : '<none>');
  kv(out, '', 'NewReplicaSet', newest ? `${newest.metadata.name} (${newest.status?.replicas ?? 0}/${newest.spec.replicas ?? 0} replicas created)` : '<none>');
  eventsBlock(out, state, c, o);
  return out;
}

function describeReplicaSet(state: KubeState, c: Cluster, o: KObject): L {
  const out: L = [];
  const pods = ownedBy(c, o, 'Pod');
  kv(out, '', 'Name', o.metadata.name);
  kv(out, '', 'Namespace', o.metadata.namespace);
  kv(out, '', 'Selector', selectorText(o.spec.selector));
  multi(out, '', 'Labels', labels(o));
  multi(out, '', 'Annotations', annotations(o));
  const owner = o.metadata.ownerReferences?.find((r) => r.controller);
  if (owner) kv(out, '', 'Controlled By', `${owner.kind}/${owner.name}`);
  kv(out, '', 'Replicas', `${o.status?.replicas ?? 0} current / ${o.spec.replicas ?? 0} desired`);
  const count = (f: (p: KObject) => boolean) => pods.filter(f).length;
  kv(out, '', 'Pods Status', `${count((p) => p.status?.phase === 'Running')} Running / ${count((p) => p.status?.phase === 'Pending')} Waiting / ${count((p) => p.status?.phase === 'Succeeded')} Succeeded / ${count((p) => p.status?.phase === 'Failed')} Failed`);
  podTemplate(out, o.spec.template);
  eventsBlock(out, state, c, o);
  return out;
}

function describeService(state: KubeState, c: Cluster, o: KObject): L {
  const out: L = [];
  kv(out, '', 'Name', o.metadata.name);
  kv(out, '', 'Namespace', o.metadata.namespace);
  multi(out, '', 'Labels', labels(o));
  multi(out, '', 'Annotations', annotations(o));
  kv(out, '', 'Selector', o.spec.selector ? labelText(o.spec.selector) : '<none>');
  kv(out, '', 'Type', o.spec.type);
  kv(out, '', 'IP Family Policy', o.spec.ipFamilyPolicy ?? 'SingleStack');
  kv(out, '', 'IP Families', (o.spec.ipFamilies ?? ['IPv4']).join(','));
  kv(out, '', 'IP', o.spec.clusterIP);
  kv(out, '', 'IPs', (o.spec.clusterIPs ?? [o.spec.clusterIP]).join(','));
  if (o.spec.type === 'LoadBalancer') kv(out, '', 'LoadBalancer Ingress', (o.status?.loadBalancer?.ingress ?? []).map((i: any) => `${i.ip} (${i.ipMode ?? 'VIP'})`).join(', ') || '');
  const slices = listObjs(c, 'EndpointSlice', o.metadata.namespace).filter((s) => s.metadata.labels?.['kubernetes.io/service-name'] === o.metadata.name);
  for (const p of o.spec.ports ?? []) {
    kv(out, '', 'Port', `${p.name ?? '<unset>'}  ${p.port}/${p.protocol ?? 'TCP'}`);
    kv(out, '', 'TargetPort', `${p.targetPort}/${p.protocol ?? 'TCP'}`);
    if (p.nodePort) kv(out, '', 'NodePort', `${p.name ?? '<unset>'}  ${p.nodePort}/${p.protocol ?? 'TCP'}`);
    const eps = slices.flatMap((s) => (s.endpoints ?? []).filter((e: any) => e.conditions?.ready).map((e: any) => `${e.addresses[0]}:${(s.ports ?? [])[0]?.port ?? p.targetPort}`));
    kv(out, '', 'Endpoints', eps.length ? (eps.length > 3 ? `${eps.slice(0, 3).join(',')} + ${eps.length - 3} more...` : eps.join(',')) : '');
  }
  kv(out, '', 'Session Affinity', o.spec.sessionAffinity ?? 'None');
  if (o.spec.externalTrafficPolicy) kv(out, '', 'External Traffic Policy', o.spec.externalTrafficPolicy);
  kv(out, '', 'Internal Traffic Policy', o.spec.internalTrafficPolicy ?? 'Cluster');
  eventsBlock(out, state, c, o);
  return out;
}

function describeNode(state: KubeState, c: Cluster, o: KObject): L {
  const out: L = [];
  const roles = Object.keys(o.metadata.labels ?? {}).filter((k) => k.startsWith('node-role.kubernetes.io/')).map((k) => k.slice(24));
  kv(out, '', 'Name', o.metadata.name);
  kv(out, '', 'Roles', roles.length ? roles.join(',') : '<none>');
  multi(out, '', 'Labels', labels(o));
  multi(out, '', 'Annotations', annotations(o));
  kv(out, '', 'CreationTimestamp', rfc1123(fromIso(o.metadata.creationTimestamp)));
  multi(out, '', 'Taints', (o.spec.taints ?? []).map((t: any) => `${t.key}${t.value ? `=${t.value}` : ''}:${t.effect}`));
  kv(out, '', 'Unschedulable', o.spec.unschedulable ? 'true' : 'false');
  out.push('Conditions:');
  out.push('  Type\tStatus\tLastHeartbeatTime\tLastTransitionTime\tReason\tMessage');
  out.push('  ----\t------\t-----------------\t------------------\t------\t-------');
  for (const x of o.status.conditions) out.push(`  ${x.type}\t${x.status}\t${rfc1123(fromIso(x.lastHeartbeatTime))}\t${rfc1123(fromIso(x.lastTransitionTime))}\t${x.reason}\t${x.message}`);
  out.push('Addresses:');
  for (const a of o.status.addresses ?? []) out.push(`  ${a.type}:\t${a.address}`);
  out.push('Capacity:');
  for (const [k, v] of Object.entries(o.status.capacity ?? {})) out.push(`  ${k}:\t${v}`);
  out.push('Allocatable:');
  for (const [k, v] of Object.entries(o.status.allocatable ?? {})) out.push(`  ${k}:\t${v}`);
  out.push('System Info:');
  const ni = o.status.nodeInfo ?? {};
  for (const [k, v] of [
    ['Kernel Version', ni.kernelVersion],
    ['OS Image', ni.osImage],
    ['Operating System', ni.operatingSystem],
    ['Architecture', ni.architecture],
    ['Container Runtime Version', ni.containerRuntimeVersion],
    ['Kubelet Version', ni.kubeletVersion],
  ]) out.push(`  ${k}:\t${v ?? ''}`);
  kv(out, '', 'PodCIDR', o.spec.podCIDR);
  kv(out, '', 'PodCIDRs', (o.spec.podCIDRs ?? []).join(','));
  const pods = listObjs(c, 'Pod').filter((p) => p.spec.nodeName === o.metadata.name && p.status?.phase !== 'Succeeded' && p.status?.phase !== 'Failed');
  const cap = { cpu: cpuMilli(o.status.allocatable?.cpu), mem: memBytes(o.status.allocatable?.memory) };
  out.push(`Non-terminated Pods:\t(${pods.length} in total)`);
  out.push('  Namespace\tName\tCPU Requests\tCPU Limits\tMemory Requests\tMemory Limits\tAge');
  out.push('  ---------\t----\t------------\t----------\t---------------\t-------------\t---');
  let rc = 0;
  let lc = 0;
  let rm = 0;
  let lm = 0;
  const pct = (x: number, total: number) => `(${total ? Math.floor((x / total) * 100) : 0}%)`;
  const cpuT = (m: number) => (m ? (m % 1000 === 0 ? String(m / 1000) : `${m}m`) : '0');
  const memT = (b: number) => (b ? (b % 1024 ** 3 === 0 ? `${b / 1024 ** 3}Gi` : `${Math.round(b / 1024 ** 2)}Mi`) : '0');
  for (const p of pods) {
    let a = 0;
    let b = 0;
    let x = 0;
    let y = 0;
    for (const ctr of p.spec.containers ?? []) {
      a += cpuMilli(ctr.resources?.requests?.cpu);
      b += cpuMilli(ctr.resources?.limits?.cpu);
      x += memBytes(ctr.resources?.requests?.memory);
      y += memBytes(ctr.resources?.limits?.memory);
    }
    rc += a;
    lc += b;
    rm += x;
    lm += y;
    out.push(`  ${p.metadata.namespace}\t${p.metadata.name}\t${cpuT(a)} ${pct(a, cap.cpu)}\t${cpuT(b)} ${pct(b, cap.cpu)}\t${memT(x)} ${pct(x, cap.mem)}\t${memT(y)} ${pct(y, cap.mem)}\t${humanDuration(state.clock - fromIso(p.metadata.creationTimestamp))}`);
  }
  out.push('Allocated resources:');
  out.push('  (Total limits may be over 100 percent, i.e., overcommitted.)');
  out.push('  Resource\tRequests\tLimits');
  out.push('  --------\t--------\t------');
  out.push(`  cpu\t${cpuT(rc)} ${pct(rc, cap.cpu)}\t${cpuT(lc)} ${pct(lc, cap.cpu)}`);
  out.push(`  memory\t${memT(rm)} ${pct(rm, cap.mem)}\t${memT(lm)} ${pct(lm, cap.mem)}`);
  out.push('  ephemeral-storage\t0 (0%)\t0 (0%)');
  eventsBlock(out, state, c, o);
  return out;
}

function describeSimple(state: KubeState, c: Cluster, o: KObject, extra: (out: L) => void): L {
  const out: L = [];
  kv(out, '', 'Name', o.metadata.name);
  if (o.metadata.namespace) kv(out, '', 'Namespace', o.metadata.namespace);
  multi(out, '', 'Labels', labels(o));
  multi(out, '', 'Annotations', annotations(o));
  extra(out);
  if (!['ConfigMap', 'Secret', 'Role', 'ClusterRole', 'RoleBinding', 'ClusterRoleBinding'].includes(o.kind)) eventsBlock(out, state, c, o);
  else if (o.kind === 'ConfigMap') kv(out, '', 'Events', '<none>');
  return out;
}

/** Generic describer (used for Gateway API kinds): keys in Title Case, nested. */
function describeGeneric(state: KubeState, c: Cluster, o: KObject): L {
  const out: L = [];
  kv(out, '', 'Name', o.metadata.name);
  kv(out, '', 'Namespace', o.metadata.namespace ?? '');
  multi(out, '', 'Labels', labels(o));
  multi(out, '', 'Annotations', annotations(o));
  kv(out, '', 'API Version', o.apiVersion);
  kv(out, '', 'Kind', o.kind);
  const title = (k: string) => k.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (x) => x.toUpperCase());
  const walk = (v: any, indent: string) => {
    for (const [k, x] of Object.entries(v ?? {})) {
      if (x === undefined) continue;
      if (Array.isArray(x)) {
        out.push(`${indent}${title(k)}:`);
        for (const item of x) {
          if (item && typeof item === 'object') {
            const entries = Object.entries(item);
            entries.forEach(([ik, iv], idx) => {
              const pre = idx === 0 ? `${indent}  ` : `${indent}  `;
              if (iv && typeof iv === 'object') {
                out.push(`${pre}${title(ik)}:`);
                walk(iv, `${indent}    `);
              } else out.push(`${pre}${title(ik)}:\t${iv}`);
            });
          } else out.push(`${indent}  ${item}`);
        }
      } else if (x && typeof x === 'object') {
        out.push(`${indent}${title(k)}:`);
        walk(x, `${indent}  `);
      } else out.push(`${indent}${title(k)}:\t${x}`);
    }
  };
  if (o.spec) {
    out.push('Spec:');
    walk(o.spec, '  ');
  }
  if (o.status) {
    out.push('Status:');
    walk(o.status, '  ');
  }
  eventsBlock(out, state, c, o);
  return out;
}

export function describe(state: KubeState, c: Cluster, o: KObject): string[] {
  let out: L;
  switch (o.kind) {
    case 'Pod':
      out = describePod(state, c, o);
      break;
    case 'Deployment':
      out = describeDeployment(state, c, o);
      break;
    case 'ReplicaSet':
      out = describeReplicaSet(state, c, o);
      break;
    case 'Service':
      out = describeService(state, c, o);
      break;
    case 'Node':
      out = describeNode(state, c, o);
      break;
    case 'Namespace':
      out = describeSimple(state, c, o, (x) => {
        kv(x, '', 'Status', o.status?.phase ?? 'Active');
        const qs = listObjs(c, 'ResourceQuota', o.metadata.name);
        if (!qs.length) x.push('No resource quota.');
        for (const q of qs) {
          const st = quotaStatus(c, q);
          x.push(`Resource Quotas`);
          x.push(`  Name:\t${q.metadata.name}`);
          x.push('  Resource\tUsed\tHard');
          x.push('  --------\t---\t---');
          for (const k of Object.keys(st.hard).sort()) x.push(`  ${k}\t${st.used[k]}\t${st.hard[k]}`);
        }
        const lrs = listObjs(c, 'LimitRange', o.metadata.name);
        if (!lrs.length) x.push('No LimitRange resource.');
      });
      out = out.filter((l) => !l.startsWith('Events:'));
      break;
    case 'ConfigMap':
      out = describeSimple(state, c, o, (x) => {
        x.push('Data');
        x.push('====');
        for (const [k, v] of Object.entries(o.data ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
          x.push(`${k}:`);
          x.push('----');
          x.push(...String(v).replace(/\n$/, '').split('\n'));
          x.push('');
        }
        x.push('');
        x.push('BinaryData');
        x.push('====');
        x.push('');
      });
      break;
    case 'Secret':
      out = describeSimple(state, c, o, (x) => {
        x.push('');
        kv(x, '', 'Type', o.type ?? 'Opaque');
        x.push('');
        x.push('Data');
        x.push('====');
        for (const [k, v] of Object.entries(o.data ?? {}).sort(([a], [b]) => a.localeCompare(b))) x.push(`${k}:\t${unb64(String(v)).length} bytes`);
      });
      break;
    case 'Role':
    case 'ClusterRole':
      out = describeSimple(state, c, o, (x) => {
        x.push('PolicyRule:');
        x.push('  Resources\tNon-Resource URLs\tResource Names\tVerbs');
        x.push('  ---------\t-----------------\t--------------\t-----');
        for (const r of o.rules ?? []) {
          for (const res of r.resources ?? []) {
            const g = (r.apiGroups ?? [''])[0];
            x.push(`  ${g ? `${res}.${g}` : res}\t[]\t[${(r.resourceNames ?? []).join(' ')}]\t[${(r.verbs ?? []).join(' ')}]`);
          }
        }
      });
      break;
    case 'RoleBinding':
    case 'ClusterRoleBinding':
      out = describeSimple(state, c, o, (x) => {
        x.push('Role:');
        x.push(`  Kind:\t${o.roleRef.kind}`);
        x.push(`  Name:\t${o.roleRef.name}`);
        x.push('Subjects:');
        x.push('  Kind\tName\tNamespace');
        x.push('  ----\t----\t---------');
        for (const s of o.subjects ?? []) x.push(`  ${s.kind}\t${s.name}\t${s.namespace ?? ''}`);
      });
      break;
    case 'HorizontalPodAutoscaler':
      out = describeSimple(state, c, o, (x) => {
        kv(x, '', 'CreationTimestamp', rfc1123(fromIso(o.metadata.creationTimestamp)));
        kv(x, '', 'Reference', `${o.spec.scaleTargetRef.kind}/${o.spec.scaleTargetRef.name}`);
        x.push('Metrics:\t( current / target )');
        for (const m of o.spec.metrics ?? []) {
          const cur = (o.status?.currentMetrics ?? []).find((y: any) => y.resource?.name === m.resource?.name);
          x.push(`  resource ${m.resource?.name} on pods  (as a percentage of request):\t${cur ? `${cur.resource.current.averageUtilization}% (${cur.resource.current.averageValue})` : '<unknown>'} / ${m.resource?.target?.averageUtilization}%`);
        }
        kv(x, '', 'Min replicas', o.spec.minReplicas ?? 1);
        kv(x, '', 'Max replicas', o.spec.maxReplicas);
        kv(x, '', `${o.spec.scaleTargetRef.kind} pods`, `${o.status?.currentReplicas ?? 0} current / ${o.status?.desiredReplicas ?? 0} desired`);
        if (o.status?.conditions?.length) {
          x.push('Conditions:');
          x.push('  Type\tStatus\tReason\tMessage');
          x.push('  ----\t------\t------\t-------');
          for (const y of o.status.conditions) x.push(`  ${y.type}\t${y.status}\t${y.reason}\t${y.message}`);
        }
      });
      break;
    case 'PersistentVolumeClaim':
      out = describeSimple(state, c, o, (x) => {
        kv(x, '', 'StorageClass', o.spec.storageClassName ?? '');
        kv(x, '', 'Status', o.status?.phase ?? 'Pending');
        kv(x, '', 'Volume', o.spec.volumeName ?? '');
        kv(x, '', 'Capacity', o.status?.capacity?.storage ?? '');
        kv(x, '', 'Access Modes', (o.status?.accessModes ?? []).map((m: string) => ({ ReadWriteOnce: 'RWO', ReadOnlyMany: 'ROX', ReadWriteMany: 'RWX' })[m] ?? m).join(','));
        kv(x, '', 'VolumeMode', o.spec.volumeMode ?? 'Filesystem');
        const users = listObjs(c, 'Pod', o.metadata.namespace).filter((p) => (p.spec.volumes ?? []).some((v: any) => v.persistentVolumeClaim?.claimName === o.metadata.name));
        kv(x, '', 'Used By', users.length ? users.map((p) => p.metadata.name).join(', ') : '<none>');
      });
      break;
    case 'Job':
      out = describeSimple(state, c, o, (x) => {
        kv(x, '', 'Selector', selectorText(o.spec.selector));
        kv(x, '', 'Parallelism', o.spec.parallelism ?? 1);
        kv(x, '', 'Completions', o.spec.completions ?? 1);
        kv(x, '', 'Completion Mode', o.spec.completionMode ?? 'NonIndexed');
        kv(x, '', 'Suspend', o.spec.suspend ? 'true' : 'false');
        kv(x, '', 'Backoff Limit', o.spec.backoffLimit ?? 6);
        if (o.status?.startTime) kv(x, '', 'Start Time', rfc1123(fromIso(o.status.startTime)));
        if (o.status?.completionTime) kv(x, '', 'Completed At', rfc1123(fromIso(o.status.completionTime)));
        kv(x, '', 'Pods Statuses', `${o.status?.active ?? 0} Active (${o.status?.ready ?? 0} Ready) / ${o.status?.succeeded ?? 0} Succeeded / ${o.status?.failed ?? 0} Failed`);
        podTemplate(x, o.spec.template, '   ');
      });
      break;
    case 'NetworkPolicy':
      out = describeSimple(state, c, o, (x) => {
        x.push('Spec:');
        x.push(`  PodSelector:\t${selectorText(o.spec.podSelector).replace('<none>', '<none> (Allowing the specific traffic to all pods in this namespace)')}`);
        const types: string[] = o.spec.policyTypes ?? [];
        if (types.includes('Ingress')) {
          x.push('  Allowing ingress traffic:');
          const rules: any[] = o.spec.ingress ?? [];
          if (!rules.length) x.push('    <none> (Selected pods are isolated for ingress connectivity)');
          for (const r of rules) {
            x.push(`    To Port: ${(r.ports ?? []).map((p: any) => `${p.port}/${p.protocol ?? 'TCP'}`).join(', ') || '<any> (traffic allowed to all ports)'}`);
            x.push('    From:');
            for (const f of r.from ?? []) x.push(`      PodSelector: ${selectorText(f.podSelector)}`);
            if (!r.from?.length) x.push('      <any> (traffic not restricted by source)');
          }
        }
        if (types.includes('Egress')) {
          x.push('  Allowing egress traffic:');
          if (!(o.spec.egress ?? []).length) x.push('    <none> (Selected pods are isolated for egress connectivity)');
        }
        x.push(`  Policy Types: ${types.join(', ')}`);
      });
      break;
    case 'StatefulSet':
    case 'DaemonSet':
      out = describeSimple(state, c, o, (x) => {
        kv(x, '', 'CreationTimestamp', rfc1123(fromIso(o.metadata.creationTimestamp)));
        kv(x, '', 'Selector', selectorText(o.spec.selector));
        if (o.kind === 'StatefulSet') kv(x, '', 'Replicas', `${o.spec.replicas} desired | ${o.status?.replicas ?? 0} total`);
        else kv(x, '', 'Desired Number of Nodes Scheduled', o.status?.desiredNumberScheduled ?? 0);
        const pods = ownedBy(c, o, 'Pod');
        kv(x, '', 'Pods Status', `${pods.filter((p) => p.status?.phase === 'Running').length} Running / ${pods.filter((p) => p.status?.phase === 'Pending').length} Waiting / 0 Succeeded / 0 Failed`);
        podTemplate(x, o.spec.template);
      });
      break;
    default:
      out = describeGeneric(state, c, o);
  }
  return tabwrite(out, 0, 2);
}

/** Pod Security problems (for lessons that print them). */
export { podSecurityProblems, normalizeImage, podReady, podStatusText, nodeStatusText };
