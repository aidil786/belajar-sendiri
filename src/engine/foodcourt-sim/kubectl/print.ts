// How kubectl prints: tables (`get`), wide, name, yaml, json, jsonpath, custom-columns.
// Columns and widths follow kubectl 1.37 talking to a 1.37 API server (checked against
// a real kube-apiserver v1.37.2): tabwriter with minwidth 6 and padding 3.
import { quotaStatus } from '../admission';
import { byKind, qualified, type ResourceType } from '../resources';
import { getObj, listObjs, nodeReady, podStatusText, readyText, restartCount } from '../store';
import type { Cluster, KObject, KubeState } from '../types';
import { age, fromIso, humanDuration, labelText, selectorText } from '../util';
import { toJson, toYaml } from '../yaml';

/** Go's text/tabwriter: cells end with a tab; the last cell of a line is not aligned. */
export function tabwrite(lines: string[], minwidth: number, padding: number): string[] {
  const rows = lines.map((l) => l.split('\t'));
  const widths: number[][] = rows.map((r) => new Array(Math.max(0, r.length - 1)).fill(0));
  const maxCols = Math.max(0, ...rows.map((r) => r.length - 1));
  for (let k = 0; k < maxCols; k++) {
    let i = 0;
    while (i < rows.length) {
      if (rows[i]!.length - 1 <= k) {
        i++;
        continue;
      }
      let j = i;
      let w = minwidth;
      while (j < rows.length && rows[j]!.length - 1 > k) {
        w = Math.max(w, [...rows[j]![k]!].length + padding);
        j++;
      }
      for (let x = i; x < j; x++) widths[x]![k] = w;
      i = j;
    }
  }
  return rows.map((r, i) => r.map((cell, k) => (k < r.length - 1 ? cell.padEnd(widths[i]![k]!, ' ') : cell)).join('').replace(/\s+$/, ''));
}

export function table(header: string[], rows: string[][]): string[] {
  return tabwrite([header, ...rows].map((r) => r.join('\t')), 6, 3);
}

// ---------------------------------------------------------------------------
// Columns per kind

export interface Columns {
  header: string[];
  wide?: string[];
  row: (o: KObject, state: KubeState, c: Cluster) => string[];
  wideRow?: (o: KObject, state: KubeState, c: Cluster) => string[];
}

const images = (spec: any) => [(spec?.containers ?? []).map((x: any) => x.name).join(','), (spec?.containers ?? []).map((x: any) => x.image).join(',')];

function svcPorts(o: KObject): string {
  const ps: any[] = o.spec.ports ?? [];
  if (!ps.length) return '<none>';
  return ps.map((p) => `${p.port}${p.nodePort ? `:${p.nodePort}` : ''}/${p.protocol ?? 'TCP'}`).join(',');
}

function externalIp(o: KObject): string {
  if (o.spec.type === 'LoadBalancer') {
    const ing: any[] = o.status?.loadBalancer?.ingress ?? [];
    return ing.length ? ing.map((i) => i.ip ?? i.hostname).join(',') : '<pending>';
  }
  if (o.spec.type === 'ExternalName') return o.spec.externalName;
  return o.spec.externalIPs?.length ? o.spec.externalIPs.join(',') : '<none>';
}

function restartsText(state: KubeState, pod: KObject): string {
  const n = restartCount(pod);
  if (!n) return '0';
  const statuses = [...(pod.status?.initContainerStatuses ?? []), ...(pod.status?.containerStatuses ?? [])];
  const last = Math.max(...statuses.map((s: any) => fromIso(s.lastState?.terminated?.finishedAt)));
  return last ? `${n} (${humanDuration(state.clock - last)} ago)` : String(n);
}

function nodeRoles(n: KObject): string {
  const roles = Object.keys(n.metadata.labels ?? {})
    .filter((k) => k.startsWith('node-role.kubernetes.io/'))
    .map((k) => k.slice('node-role.kubernetes.io/'.length))
    .sort();
  return roles.length ? roles.join(',') : '<none>';
}

export function nodeStatusText(n: KObject): string {
  const ready = n.status?.conditions?.find((x: any) => x.type === 'Ready');
  let s = !ready ? 'Unknown' : ready.status === 'True' ? 'Ready' : ready.status === 'False' ? 'NotReady' : 'NotReady';
  if (n.spec?.unschedulable) s += ',SchedulingDisabled';
  return s;
}

function jobDuration(state: KubeState, j: KObject): string {
  const start = fromIso(j.status?.startTime);
  if (!start) return '';
  const end = j.status?.completionTime ? fromIso(j.status.completionTime) : state.clock;
  return humanDuration(end - start);
}

function jobStatus(j: KObject): string {
  const conds: any[] = j.status?.conditions ?? [];
  const has = (t: string) => conds.some((x) => x.type === t && x.status === 'True');
  if (has('Failed')) return 'Failed';
  if (has('Complete')) return 'Complete';
  if (has('FailureTarget')) return 'FailureTarget';
  if (has('SuccessCriteriaMet')) return 'SuccessCriteriaMet';
  if (j.spec?.suspend) return 'Suspended';
  return 'Running';
}

function accessModes(list: string[] | undefined): string {
  const short: Record<string, string> = { ReadWriteOnce: 'RWO', ReadOnlyMany: 'ROX', ReadWriteMany: 'RWX', ReadWriteOncePod: 'RWOP' };
  return (list ?? []).map((m) => short[m] ?? m).join(',');
}

function hpaTargets(h: KObject): string {
  const metrics: any[] = h.spec.metrics ?? [];
  if (!metrics.length) return '<none>';
  return metrics
    .map((m) => {
      if (m.type !== 'Resource') return `${m.type.toLowerCase()}`;
      const cur = (h.status?.currentMetrics ?? []).find((x: any) => x.resource?.name === m.resource.name);
      const t = m.resource.target;
      const want = t.type === 'Utilization' ? `${t.averageUtilization}%` : (t.averageValue ?? t.value);
      const have = cur ? (t.type === 'Utilization' ? `${cur.resource.current.averageUtilization}%` : cur.resource.current.averageValue) : '<unknown>';
      return `${m.resource.name}: ${have}/${want}`;
    })
    .join(', ');
}

function slicePorts(o: KObject): string {
  const ps: any[] = o.ports ?? [];
  return ps.length ? ps.map((p) => String(p.port)).join(',') : '<unset>';
}

function sliceEndpoints(o: KObject): string {
  const addrs: string[] = (o.endpoints ?? []).flatMap((e: any) => e.addresses);
  // kubectl's printer (listWithMoreString) prints <unset> for an empty list, like PORTS.
  if (!addrs.length) return '<unset>';
  return addrs.length > 3 ? `${addrs.slice(0, 3).join(',')} + ${addrs.length - 3} more...` : addrs.join(',');
}

function quotaCols(c: Cluster, q: KObject): [string, string] {
  const st = quotaStatus(c, q);
  const req: string[] = [];
  const lim: string[] = [];
  for (const k of Object.keys(st.hard).sort()) {
    const text = `${k}: ${st.used[k]}/${st.hard[k]}`;
    if (k.startsWith('limits.')) lim.push(text);
    else req.push(text);
  }
  return [req.join(', '), lim.join(', ')];
}

function created(o: KObject): string {
  return o.metadata.creationTimestamp;
}

function subjects(o: KObject, kind: string): string {
  return (o.subjects ?? [])
    .filter((s: any) => s.kind === kind)
    .map((s: any) => (kind === 'ServiceAccount' ? `${s.namespace ?? o.metadata.namespace}/${s.name}` : s.name))
    .join(', ');
}

function condStatus(o: KObject, type: string): string {
  return o.status?.conditions?.find((x: any) => x.type === type)?.status ?? 'Unknown';
}

export const COLUMNS: Record<string, Columns> = {
  Pod: {
    header: ['NAME', 'READY', 'STATUS', 'RESTARTS', 'AGE'],
    wide: ['IP', 'NODE', 'NOMINATED NODE', 'READINESS GATES'],
    row: (o, s) => [o.metadata.name, readyText(o), podStatusText(o), restartsText(s, o), age(s, o)],
    wideRow: (o) => [o.status?.podIP ?? '<none>', o.spec?.nodeName ?? '<none>', '<none>', '<none>'],
  },
  Deployment: {
    header: ['NAME', 'READY', 'UP-TO-DATE', 'AVAILABLE', 'AGE'],
    wide: ['CONTAINERS', 'IMAGES', 'SELECTOR'],
    row: (o, s) => [o.metadata.name, `${o.status?.readyReplicas ?? 0}/${o.spec.replicas ?? 1}`, String(o.status?.updatedReplicas ?? 0), String(o.status?.availableReplicas ?? 0), age(s, o)],
    wideRow: (o) => [...images(o.spec.template.spec), selectorText(o.spec.selector)],
  },
  ReplicaSet: {
    header: ['NAME', 'DESIRED', 'CURRENT', 'READY', 'AGE'],
    wide: ['CONTAINERS', 'IMAGES', 'SELECTOR'],
    row: (o, s) => [o.metadata.name, String(o.spec.replicas ?? 0), String(o.status?.replicas ?? 0), String(o.status?.readyReplicas ?? 0), age(s, o)],
    wideRow: (o) => [...images(o.spec.template.spec), selectorText(o.spec.selector)],
  },
  DaemonSet: {
    header: ['NAME', 'DESIRED', 'CURRENT', 'READY', 'UP-TO-DATE', 'AVAILABLE', 'NODE SELECTOR', 'AGE'],
    wide: ['CONTAINERS', 'IMAGES', 'SELECTOR'],
    row: (o, s) => [
      o.metadata.name,
      String(o.status?.desiredNumberScheduled ?? 0),
      String(o.status?.currentNumberScheduled ?? 0),
      String(o.status?.numberReady ?? 0),
      String(o.status?.updatedNumberScheduled ?? 0),
      String(o.status?.numberAvailable ?? 0),
      o.spec.template.spec.nodeSelector ? labelText(o.spec.template.spec.nodeSelector) : '<none>',
      age(s, o),
    ],
    wideRow: (o) => [...images(o.spec.template.spec), selectorText(o.spec.selector)],
  },
  StatefulSet: {
    header: ['NAME', 'READY', 'AGE'],
    wide: ['CONTAINERS', 'IMAGES'],
    row: (o, s) => [o.metadata.name, `${o.status?.readyReplicas ?? 0}/${o.spec.replicas ?? 1}`, age(s, o)],
    wideRow: (o) => images(o.spec.template.spec),
  },
  Job: {
    header: ['NAME', 'STATUS', 'COMPLETIONS', 'DURATION', 'AGE'],
    wide: ['CONTAINERS', 'IMAGES', 'SELECTOR'],
    row: (o, s) => [o.metadata.name, jobStatus(o), `${o.status?.succeeded ?? 0}/${o.spec.completions ?? 1}`, jobDuration(s, o), age(s, o)],
    wideRow: (o) => [...images(o.spec.template.spec), selectorText(o.spec.selector)],
  },
  CronJob: {
    header: ['NAME', 'SCHEDULE', 'TIMEZONE', 'SUSPEND', 'ACTIVE', 'LAST SCHEDULE', 'AGE'],
    wide: ['CONTAINERS', 'IMAGES', 'SELECTOR'],
    row: (o, s) => [
      o.metadata.name,
      o.spec.schedule,
      o.spec.timeZone ?? '<none>',
      o.spec.suspend ? 'True' : 'False',
      String(o.status?.active?.length ?? 0),
      o.status?.lastScheduleTime ? humanDuration(s.clock - fromIso(o.status.lastScheduleTime)) : '<none>',
      age(s, o),
    ],
    wideRow: (o) => [...images(o.spec.jobTemplate.spec.template.spec), '<none>'],
  },
  Service: {
    header: ['NAME', 'TYPE', 'CLUSTER-IP', 'EXTERNAL-IP', 'PORT(S)', 'AGE'],
    wide: ['SELECTOR'],
    row: (o, s) => [o.metadata.name, o.spec.type ?? 'ClusterIP', o.spec.clusterIP ?? '<none>', externalIp(o), svcPorts(o), age(s, o)],
    wideRow: (o) => [o.spec.selector ? labelText(o.spec.selector) : '<none>'],
  },
  EndpointSlice: {
    header: ['NAME', 'ADDRESSTYPE', 'PORTS', 'ENDPOINTS', 'AGE'],
    row: (o, s) => [o.metadata.name, o.addressType, slicePorts(o), sliceEndpoints(o), age(s, o)],
  },
  Node: {
    header: ['NAME', 'STATUS', 'ROLES', 'AGE', 'VERSION'],
    wide: ['INTERNAL-IP', 'EXTERNAL-IP', 'OS-IMAGE', 'KERNEL-VERSION', 'CONTAINER-RUNTIME'],
    row: (o, s) => [o.metadata.name, nodeStatusText(o), nodeRoles(o), age(s, o), o.status?.nodeInfo?.kubeletVersion ?? ''],
    wideRow: (o) => [
      o.status?.addresses?.find((a: any) => a.type === 'InternalIP')?.address ?? '<none>',
      o.status?.addresses?.find((a: any) => a.type === 'ExternalIP')?.address ?? '<none>',
      o.status?.nodeInfo?.osImage ?? '',
      o.status?.nodeInfo?.kernelVersion ?? '',
      o.status?.nodeInfo?.containerRuntimeVersion ?? '',
    ],
  },
  Namespace: { header: ['NAME', 'STATUS', 'AGE'], row: (o, s) => [o.metadata.name, o.status?.phase ?? 'Active', age(s, o)] },
  ConfigMap: { header: ['NAME', 'DATA', 'AGE'], row: (o, s) => [o.metadata.name, String(Object.keys(o.data ?? {}).length + Object.keys(o.binaryData ?? {}).length), age(s, o)] },
  Secret: { header: ['NAME', 'TYPE', 'DATA', 'AGE'], row: (o, s) => [o.metadata.name, o.type ?? 'Opaque', String(Object.keys(o.data ?? {}).length), age(s, o)] },
  ServiceAccount: { header: ['NAME', 'AGE'], row: (o, s) => [o.metadata.name, age(s, o)] },
  PersistentVolumeClaim: {
    header: ['NAME', 'STATUS', 'VOLUME', 'CAPACITY', 'ACCESS MODES', 'STORAGECLASS', 'VOLUMEATTRIBUTESCLASS', 'AGE'],
    wide: ['VOLUMEMODE'],
    row: (o, s) => [o.metadata.name, o.status?.phase ?? 'Pending', o.spec.volumeName ?? '', o.status?.capacity?.storage ?? '', accessModes(o.status?.accessModes), o.spec.storageClassName ?? '', '<unset>', age(s, o)],
    wideRow: (o) => [o.spec.volumeMode ?? 'Filesystem'],
  },
  PersistentVolume: {
    header: ['NAME', 'CAPACITY', 'ACCESS MODES', 'RECLAIM POLICY', 'STATUS', 'CLAIM', 'STORAGECLASS', 'VOLUMEATTRIBUTESCLASS', 'REASON', 'AGE'],
    wide: ['VOLUMEMODE'],
    row: (o, s) => [
      o.metadata.name,
      o.spec.capacity?.storage ?? '',
      accessModes(o.spec.accessModes),
      o.spec.persistentVolumeReclaimPolicy ?? 'Retain',
      o.status?.phase ?? 'Pending',
      o.spec.claimRef ? `${o.spec.claimRef.namespace}/${o.spec.claimRef.name}` : '',
      o.spec.storageClassName ?? '',
      '<unset>',
      o.status?.reason ?? '',
      age(s, o),
    ],
    wideRow: (o) => [o.spec.volumeMode ?? 'Filesystem'],
  },
  StorageClass: {
    header: ['NAME', 'PROVISIONER', 'RECLAIMPOLICY', 'VOLUMEBINDINGMODE', 'ALLOWVOLUMEEXPANSION', 'AGE'],
    row: (o, s) => [
      o.metadata.annotations?.['storageclass.kubernetes.io/is-default-class'] === 'true' ? `${o.metadata.name} (default)` : o.metadata.name,
      o.provisioner,
      o.reclaimPolicy ?? 'Delete',
      o.volumeBindingMode ?? 'Immediate',
      o.allowVolumeExpansion ? 'true' : 'false',
      age(s, o),
    ],
  },
  HorizontalPodAutoscaler: {
    header: ['NAME', 'REFERENCE', 'TARGETS', 'MINPODS', 'MAXPODS', 'REPLICAS', 'AGE'],
    row: (o, s) => [o.metadata.name, `${o.spec.scaleTargetRef.kind}/${o.spec.scaleTargetRef.name}`, hpaTargets(o), String(o.spec.minReplicas ?? 1), String(o.spec.maxReplicas), String(o.status?.currentReplicas ?? 0), age(s, o)],
  },
  PodDisruptionBudget: {
    header: ['NAME', 'MIN AVAILABLE', 'MAX UNAVAILABLE', 'ALLOWED DISRUPTIONS', 'AGE'],
    row: (o, s) => [o.metadata.name, o.spec.minAvailable !== undefined ? String(o.spec.minAvailable) : 'N/A', o.spec.maxUnavailable !== undefined ? String(o.spec.maxUnavailable) : 'N/A', String(o.status?.disruptionsAllowed ?? 0), age(s, o)],
  },
  ResourceQuota: { header: ['NAME', 'REQUEST', 'LIMIT', 'AGE'], row: (o, s, c) => [o.metadata.name, ...quotaCols(c, o), age(s, o)] },
  LimitRange: { header: ['NAME', 'CREATED AT'], row: (o) => [o.metadata.name, created(o)] },
  NetworkPolicy: { header: ['NAME', 'POD-SELECTOR', 'AGE'], row: (o, s) => [o.metadata.name, selectorText(o.spec.podSelector).replace('<none>', '<none>'), age(s, o)] },
  Role: { header: ['NAME', 'CREATED AT'], row: (o) => [o.metadata.name, created(o)] },
  ClusterRole: { header: ['NAME', 'CREATED AT'], row: (o) => [o.metadata.name, created(o)] },
  RoleBinding: {
    header: ['NAME', 'ROLE', 'AGE'],
    wide: ['USERS', 'GROUPS', 'SERVICEACCOUNTS'],
    row: (o, s) => [o.metadata.name, `${o.roleRef.kind}/${o.roleRef.name}`, age(s, o)],
    wideRow: (o) => [subjects(o, 'User'), subjects(o, 'Group'), subjects(o, 'ServiceAccount')],
  },
  ClusterRoleBinding: {
    header: ['NAME', 'ROLE', 'AGE'],
    wide: ['USERS', 'GROUPS', 'SERVICEACCOUNTS'],
    row: (o, s) => [o.metadata.name, `${o.roleRef.kind}/${o.roleRef.name}`, age(s, o)],
    wideRow: (o) => [subjects(o, 'User'), subjects(o, 'Group'), subjects(o, 'ServiceAccount')],
  },
  Ingress: {
    header: ['NAME', 'CLASS', 'HOSTS', 'ADDRESS', 'PORTS', 'AGE'],
    row: (o, s) => [
      o.metadata.name,
      o.spec.ingressClassName ?? '<none>',
      (o.spec.rules ?? []).map((r: any) => r.host ?? '*').join(',') || '*',
      (o.status?.loadBalancer?.ingress ?? []).map((i: any) => i.ip).join(','),
      o.spec.tls?.length ? '80, 443' : '80',
      age(s, o),
    ],
  },
  IngressClass: { header: ['NAME', 'CONTROLLER', 'PARAMETERS', 'AGE'], row: (o, s) => [o.metadata.name, o.spec.controller, '<none>', age(s, o)] },
  GatewayClass: { header: ['NAME', 'CONTROLLER', 'ACCEPTED', 'AGE'], row: (o, s) => [o.metadata.name, o.spec.controllerName, condStatus(o, 'Accepted'), age(s, o)] },
  Gateway: {
    header: ['NAME', 'CLASS', 'ADDRESS', 'PROGRAMMED', 'AGE'],
    row: (o, s) => [o.metadata.name, o.spec.gatewayClassName, o.status?.addresses?.[0]?.value ?? '', condStatus(o, 'Programmed'), age(s, o)],
  },
  HTTPRoute: { header: ['NAME', 'HOSTNAMES', 'AGE'], row: (o, s) => [o.metadata.name, o.spec.hostnames?.length ? `["${o.spec.hostnames.join('","')}"]` : '', age(s, o)] },
  Event: {
    header: ['LAST SEEN', 'TYPE', 'REASON', 'OBJECT', 'MESSAGE'],
    row: (o, s) => [humanDuration(s.clock - fromIso(o.lastTimestamp)), o.type, o.reason, `${o.involvedObject.kind.toLowerCase()}/${o.involvedObject.name}`, o.message],
  },
};

/** Row cells for one object (with -o wide / -A / --show-labels / a kind prefix). */
export function rowFor(o: KObject, state: KubeState, c: Cluster, opts: { wide?: boolean; allNs?: boolean; labels?: boolean; prefix?: boolean }): string[] {
  const cols = COLUMNS[o.kind];
  const r = byKind(o.kind)!;
  const cells = cols ? cols.row(o, state, c) : [o.metadata.name, age(state, o)];
  if (opts.prefix) cells[0] = `${qualified(r)}/${cells[0]}`;
  if (opts.wide && cols?.wideRow) cells.push(...cols.wideRow(o, state, c));
  if (opts.labels) cells.push(labelText(o.metadata.labels));
  if (opts.allNs && r.namespaced) cells.unshift(o.metadata.namespace ?? '');
  if (o.kind === 'Event' && opts.allNs) return cells;
  return cells;
}

export function headerFor(kind: string, opts: { wide?: boolean; allNs?: boolean; labels?: boolean }): string[] {
  const cols = COLUMNS[kind];
  const r = byKind(kind)!;
  const h = cols ? [...cols.header] : ['NAME', 'AGE'];
  if (opts.wide && cols?.wide) h.push(...cols.wide);
  if (opts.labels) h.push('LABELS');
  if (opts.allNs && r.namespaced) h.unshift('NAMESPACE');
  return h;
}

// ---------------------------------------------------------------------------
// -o yaml / json / name / jsonpath / custom-columns

/** What `get -o yaml` shows (no managedFields; Secrets keep data base64). */
export function forOutput(o: KObject): KObject {
  const out: KObject = JSON.parse(JSON.stringify(o));
  if (out.metadata.annotations) {
    delete out.metadata.annotations['fahamlah/waiting'];
    delete out.metadata.annotations['fahamlah/low-since'];
    if (!Object.keys(out.metadata.annotations).length) delete out.metadata.annotations;
  }
  if (out.kind === 'Pod' && out.status?.containerStatuses) {
    for (const s of out.status.containerStatuses) delete s._pulling;
  }
  return out;
}

export function listYaml(items: KObject[]): string {
  if (items.length === 1) return toYaml(forOutput(items[0]!));
  return toYaml({ apiVersion: 'v1', items: items.map(forOutput), kind: 'List', metadata: { resourceVersion: '' } });
}

export function listJson(items: KObject[], single: boolean): string {
  if (single && items.length === 1) return toJson(forOutput(items[0]!));
  return toJson({ apiVersion: 'v1', items: items.map(forOutput), kind: 'List', metadata: { resourceVersion: '' } });
}

export function nameOf(o: KObject): string {
  return `${qualified(byKind(o.kind)!)}/${o.metadata.name}`;
}

/** Evaluate a simple JSONPath (`.a.b[0].c`, `[*]`, `['x.y']`) on a value. Returns every match. */
export function jsonPathEval(root: unknown, path: string): unknown[] {
  let cur: unknown[] = [root];
  const p = path.trim().replace(/^\$/, '');
  const re = /\.\.?([A-Za-z0-9_\-/]+(?:\\\.[A-Za-z0-9_\-/]+)*)|\[\s*'([^']*)'\s*\]|\[\s*"([^"]*)"\s*\]|\[\s*(\*|-?\d+)\s*\]|\.\*|\[\?\(@\.([\w.]+)\s*==\s*["']([^"']*)["']\)\]/g;
  let m: RegExpExecArray | null;
  let consumed = 0;
  while ((m = re.exec(p))) {
    if (m.index !== consumed) return [];
    consumed = re.lastIndex;
    const next: unknown[] = [];
    for (const v of cur) {
      if (v === null || v === undefined) continue;
      if (m[1] !== undefined || m[2] !== undefined || m[3] !== undefined) {
        const key = (m[1] ?? m[2] ?? m[3])!.replace(/\\\./g, '.');
        const x = (v as Record<string, unknown>)[key];
        if (x !== undefined) next.push(x);
      } else if (m[4] !== undefined) {
        if (!Array.isArray(v)) continue;
        if (m[4] === '*') next.push(...v);
        else {
          const i = Number(m[4]);
          const x = v[i < 0 ? v.length + i : i];
          if (x !== undefined) next.push(x);
        }
      } else if (m[0] === '.*') next.push(...(Array.isArray(v) ? v : Object.values(v as object)));
      else if (m[5] !== undefined) {
        if (!Array.isArray(v)) continue;
        for (const item of v) {
          const got = jsonPathEval(item, `.${m[5]}`)[0];
          if (String(got) === m[6]) next.push(item);
        }
      }
    }
    cur = next;
  }
  if (consumed !== p.length) return [];
  return cur;
}

function jsonPathText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** Render a kubectl JSONPath template: `{.items[*].metadata.name}`, `{range .items[*]}{.metadata.name}{"\n"}{end}`. */
export function jsonPathTemplate(root: unknown, template: string): { ok: true; text: string } | { ok: false; error: string } {
  const tokens: { kind: 'text' | 'expr'; v: string }[] = [];
  let i = 0;
  const t = template;
  while (i < t.length) {
    const open = t.indexOf('{', i);
    if (open < 0) {
      tokens.push({ kind: 'text', v: t.slice(i) });
      break;
    }
    if (open > i) tokens.push({ kind: 'text', v: t.slice(i, open) });
    const close = t.indexOf('}', open);
    if (close < 0) return { ok: false, error: `error: error parsing jsonpath ${template}, unclosed action` };
    tokens.push({ kind: 'expr', v: t.slice(open + 1, close).trim() });
    i = close + 1;
  }
  const render = (toks: typeof tokens, ctx: unknown): string => {
    let out = '';
    for (let k = 0; k < toks.length; k++) {
      const tok = toks[k]!;
      if (tok.kind === 'text') {
        out += tok.v;
        continue;
      }
      const e = tok.v;
      const str = /^"((?:[^"\\]|\\.)*)"$/.exec(e) ?? /^'([^']*)'$/.exec(e);
      if (str) {
        out += str[1]!.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
        continue;
      }
      if (e.startsWith('range ')) {
        let depth = 1;
        let j = k + 1;
        for (; j < toks.length; j++) {
          if (toks[j]!.kind === 'expr' && toks[j]!.v.startsWith('range ')) depth++;
          if (toks[j]!.kind === 'expr' && toks[j]!.v === 'end' && --depth === 0) break;
        }
        const items = jsonPathEval(ctx, e.slice(6).trim());
        for (const item of items) render(toks.slice(k + 1, j), item).split('').forEach((ch) => (out += ch));
        k = j;
        continue;
      }
      if (e === 'end') continue;
      out += jsonPathEval(ctx, e).map(jsonPathText).join(' ');
    }
    return out;
  };
  return { ok: true, text: render(tokens, root) };
}

/** `-o custom-columns=NAME:.metadata.name,IMAGE:.spec.containers[0].image` */
export function customColumns(items: KObject[], spec: string): string[] {
  const cols = spec.split(',').map((x) => {
    const [h, ...rest] = x.split(':');
    return { h: h!, path: rest.join(':') };
  });
  const rows = items.map((o) => cols.map((col) => jsonPathEval(forOutput(o), col.path).map(jsonPathText).join(',') || '<none>'));
  return table(cols.map((col) => col.h), rows);
}

export { getObj, listObjs, nodeReady };
export type { ResourceType };
