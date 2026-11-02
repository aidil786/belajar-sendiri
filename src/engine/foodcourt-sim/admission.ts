// Admission: the checks between "the API server accepted your YAML" and "it is stored".
// LimitRange defaults, ResourceQuota, Pod Security (privileged / baseline / restricted).
// Messages match a real kube-apiserver v1.37.2.
import type { Cluster, KObject } from './types';
import { getObj, listObjs } from './store';
import { cpuMilli, memBytes } from './util';

export type Level = 'privileged' | 'baseline' | 'restricted';

interface Check {
  id: string;
  /** Short name used in "existing pods" warnings. */
  short: string;
  /** Full text with details, or null when the pod passes. */
  test: (spec: any) => string | null;
  level: 'baseline' | 'restricted';
}

const BASELINE_CAPS = [
  'AUDIT_WRITE', 'CHOWN', 'DAC_OVERRIDE', 'FOWNER', 'FSETID', 'KILL', 'MKNOD', 'NET_BIND_SERVICE', 'SETFCAP', 'SETGID', 'SETPCAP', 'SETUID', 'SYS_CHROOT',
];
const RESTRICTED_VOLUMES = ['configMap', 'csi', 'downwardAPI', 'emptyDir', 'ephemeral', 'persistentVolumeClaim', 'projected', 'secret', 'image'];

function containers(spec: any): any[] {
  return [...(spec.initContainers ?? []), ...(spec.containers ?? []), ...(spec.ephemeralContainers ?? [])];
}

function names(list: any[], what: string): string {
  return `${what}${list.length > 1 ? 's' : ''} ${list.map((c) => `"${c.name}"`).join(', ')}`;
}

const CHECKS: Check[] = [
  {
    id: 'allowPrivilegeEscalation',
    short: 'allowPrivilegeEscalation != false',
    level: 'restricted',
    test: (spec) => {
      const bad = containers(spec).filter((c) => c.securityContext?.allowPrivilegeEscalation !== false);
      return bad.length ? `allowPrivilegeEscalation != false (${names(bad, 'container')} must set securityContext.allowPrivilegeEscalation=false)` : null;
    },
  },
  {
    id: 'capabilities_baseline',
    short: 'non-default capabilities',
    level: 'baseline',
    test: (spec) => {
      const bad = containers(spec).filter((c) => (c.securityContext?.capabilities?.add ?? []).some((x: string) => !BASELINE_CAPS.includes(x)));
      if (!bad.length) return null;
      const caps = [...new Set(bad.flatMap((c) => (c.securityContext.capabilities.add as string[]).filter((x) => !BASELINE_CAPS.includes(x))))];
      return `non-default capabilities (${names(bad, 'container')} must not include ${caps.map((x) => `"${x}"`).join(', ')} in securityContext.capabilities.add)`;
    },
  },
  {
    id: 'capabilities_restricted',
    short: 'unrestricted capabilities',
    level: 'restricted',
    test: (spec) => {
      const bad = containers(spec).filter((c) => !(c.securityContext?.capabilities?.drop ?? []).includes('ALL'));
      return bad.length ? `unrestricted capabilities (${names(bad, 'container')} must set securityContext.capabilities.drop=["ALL"])` : null;
    },
  },
  {
    id: 'hostNamespaces',
    short: 'host namespaces',
    level: 'baseline',
    test: (spec) => {
      const on = ['hostNetwork', 'hostPID', 'hostIPC'].filter((k) => spec[k]);
      return on.length ? `host namespaces (${on.map((k) => `${k}=true`).join(', ')})` : null;
    },
  },
  {
    id: 'hostPathVolumes',
    short: 'hostPath volumes',
    level: 'baseline',
    test: (spec) => {
      const bad = (spec.volumes ?? []).filter((v: any) => v.hostPath);
      return bad.length ? `hostPath volumes (${names(bad, 'volume')})` : null;
    },
  },
  {
    id: 'hostPorts',
    short: 'hostPort',
    level: 'baseline',
    test: (spec) => {
      const bad = containers(spec).filter((c) => (c.ports ?? []).some((p: any) => p.hostPort));
      if (!bad.length) return null;
      const ports = bad.flatMap((c) => (c.ports as any[]).filter((p) => p.hostPort).map((p) => p.hostPort));
      return `hostPort (${names(bad, 'container')} ${bad.length > 1 ? 'use' : 'uses'} hostPort${ports.length > 1 ? 's' : ''} ${ports.join(', ')})`;
    },
  },
  {
    id: 'privileged',
    short: 'privileged',
    level: 'baseline',
    test: (spec) => {
      const bad = containers(spec).filter((c) => c.securityContext?.privileged === true);
      return bad.length ? `privileged (${names(bad, 'container')} must not set securityContext.privileged=true)` : null;
    },
  },
  {
    id: 'restrictedVolumes',
    short: 'restricted volume types',
    level: 'restricted',
    test: (spec) => {
      const bad = (spec.volumes ?? []).filter((v: any) => !Object.keys(v).filter((k) => k !== 'name').every((k) => RESTRICTED_VOLUMES.includes(k)));
      if (!bad.length) return null;
      const types = [...new Set(bad.flatMap((v: any) => Object.keys(v).filter((k) => k !== 'name' && !RESTRICTED_VOLUMES.includes(k))))];
      return `restricted volume types (${names(bad, 'volume')} ${bad.length > 1 ? 'use' : 'uses'} restricted volume type${types.length > 1 ? 's' : ''} ${types.map((x) => `"${x}"`).join(', ')})`;
    },
  },
  {
    id: 'runAsNonRoot',
    short: 'runAsNonRoot != true',
    level: 'restricted',
    test: (spec) => {
      if (spec.securityContext?.runAsNonRoot === false) return 'runAsNonRoot != true (pod must not set securityContext.runAsNonRoot=false)';
      const podSet = spec.securityContext?.runAsNonRoot === true;
      const bad = containers(spec).filter((c) => c.securityContext?.runAsNonRoot === false || (!podSet && c.securityContext?.runAsNonRoot !== true));
      return bad.length ? `runAsNonRoot != true (pod or ${names(bad, 'container')} must set securityContext.runAsNonRoot=true)` : null;
    },
  },
  {
    id: 'runAsUser',
    short: 'runAsUser=0',
    level: 'restricted',
    test: (spec) => {
      if (spec.securityContext?.runAsUser === 0) return 'runAsUser=0 (pod must not set runAsUser=0)';
      const bad = containers(spec).filter((c) => c.securityContext?.runAsUser === 0);
      return bad.length ? `runAsUser=0 (${names(bad, 'container')} must not set runAsUser=0)` : null;
    },
  },
  {
    id: 'seccompProfile_restricted',
    short: 'seccompProfile',
    level: 'restricted',
    test: (spec) => {
      const ok = (p: any) => p?.type === 'RuntimeDefault' || p?.type === 'Localhost';
      if (ok(spec.securityContext?.seccompProfile)) return null;
      const bad = containers(spec).filter((c) => !ok(c.securityContext?.seccompProfile));
      return bad.length ? `seccompProfile (pod or ${names(bad, 'container')} must set securityContext.seccompProfile.type to "RuntimeDefault" or "Localhost")` : null;
    },
  },
];

/** Problems with a pod spec at a Pod Security level (empty = allowed). */
export function podSecurityProblems(spec: any, level: Level): { full: string[]; short: string[] } {
  if (level === 'privileged' || !spec) return { full: [], short: [] };
  const full: string[] = [];
  const short: string[] = [];
  for (const c of CHECKS) {
    if (c.level === 'restricted' && level !== 'restricted') continue;
    const r = c.test(spec);
    if (r) {
      full.push(r);
      short.push(c.short);
    }
  }
  return { full, short };
}

export function namespaceLevels(c: Cluster, ns: string): { enforce: Level; warn: Level } {
  const labels = getObj(c, 'Namespace', undefined, ns)?.metadata.labels ?? {};
  const lv = (k: string): Level => {
    const v = labels[`pod-security.kubernetes.io/${k}`];
    return v === 'baseline' || v === 'restricted' ? v : 'privileged';
  };
  return { enforce: lv('enforce'), warn: lv('warn') };
}

export const POD_TEMPLATE_KINDS = ['Deployment', 'ReplicaSet', 'DaemonSet', 'StatefulSet', 'Job', 'CronJob'];

export function podSpecOf(o: KObject): any {
  if (o.kind === 'Pod') return o.spec;
  if (o.kind === 'CronJob') return o.spec?.jobTemplate?.spec?.template?.spec;
  return o.spec?.template?.spec;
}

/**
 * Pod Security admission. Pods break the `enforce` level → forbidden. Pods and workloads
 * that break `enforce` or `warn` → a warning. Returns { error } or { warnings }.
 */
export function podSecurity(c: Cluster, o: KObject): { error?: string; warnings: string[] } {
  const ns = o.metadata.namespace ?? 'default';
  const { enforce, warn } = namespaceLevels(c, ns);
  const spec = podSpecOf(o);
  if (!spec || (o.kind !== 'Pod' && !POD_TEMPLATE_KINDS.includes(o.kind))) return { warnings: [] };
  const warnings: string[] = [];
  const e = podSecurityProblems(spec, enforce);
  if (o.kind === 'Pod' && e.full.length) {
    return { error: `pods "${o.metadata.name}" is forbidden: violates PodSecurity "${enforce}:latest": ${e.full.join(', ')}`, warnings };
  }
  // Workloads: the enforce level only warns (their pods will be refused later).
  const order: Level[] = ['privileged', 'baseline', 'restricted'];
  const level = o.kind === 'Pod' ? warn : order.indexOf(warn) > order.indexOf(enforce) ? warn : enforce;
  const w = podSecurityProblems(spec, level);
  if (w.full.length) warnings.push(`Warning: would violate PodSecurity "${level}:latest": ${w.full.join(', ')}`);
  return { warnings };
}

/** Warnings when a namespace gets a stricter `enforce` label (existing pods are not removed). */
export function existingPodWarnings(c: Cluster, ns: string, level: Level): string[] {
  if (level === 'privileged') return [];
  const out: string[] = [];
  for (const p of listObjs(c, 'Pod', ns)) {
    const pr = podSecurityProblems(p.spec, level);
    if (pr.short.length) out.push(`Warning: ${p.metadata.name}: ${pr.short.join(', ')}`);
  }
  if (out.length) out.unshift(`Warning: existing pods in namespace "${ns}" violate the new PodSecurity enforce level "${level}:latest"`);
  return out;
}

// ---------------------------------------------------------------------------
// LimitRange and ResourceQuota

/** Fill container requests/limits from LimitRange defaults (changes the pod spec). */
export function applyLimitRanges(c: Cluster, ns: string, spec: any): void {
  for (const lr of listObjs(c, 'LimitRange', ns)) {
    for (const lim of lr.spec?.limits ?? []) {
      if (lim.type !== 'Container') continue;
      for (const ct of [...(spec.containers ?? []), ...(spec.initContainers ?? [])]) {
        ct.resources = ct.resources ?? {};
        for (const [k, v] of Object.entries(lim.default ?? {})) {
          ct.resources.limits = ct.resources.limits ?? {};
          if (ct.resources.limits[k] === undefined) ct.resources.limits[k] = v;
        }
        for (const [k, v] of Object.entries(lim.defaultRequest ?? lim.default ?? {})) {
          ct.resources.requests = ct.resources.requests ?? {};
          if (ct.resources.requests[k] === undefined) ct.resources.requests[k] = ct.resources.limits?.[k] !== undefined && !lim.defaultRequest ? ct.resources.limits[k] : v;
        }
      }
    }
  }
}

function podUsage(spec: any): Record<string, number> {
  const sum = (path: 'requests' | 'limits', k: 'cpu' | 'memory') =>
    (spec.containers ?? []).reduce((n: number, ct: any) => n + (k === 'cpu' ? cpuMilli(ct.resources?.[path]?.[k]) : memBytes(ct.resources?.[path]?.[k])), 0);
  return {
    pods: 1,
    'requests.cpu': sum('requests', 'cpu'),
    cpu: sum('requests', 'cpu'),
    'requests.memory': sum('requests', 'memory'),
    memory: sum('requests', 'memory'),
    'limits.cpu': sum('limits', 'cpu'),
    'limits.memory': sum('limits', 'memory'),
  };
}

function fmt(k: string, v: number): string {
  if (k.endsWith('cpu') || k === 'cpu') return v % 1000 === 0 ? String(v / 1000) : `${v}m`;
  if (k.endsWith('memory') || k === 'memory') return v % 1024 ** 3 === 0 ? `${v / 1024 ** 3}Gi` : `${Math.round(v / 1024 ** 2)}Mi`;
  return String(v);
}

function parseHard(k: string, v: unknown): number {
  if (k.endsWith('cpu') || k === 'cpu') return cpuMilli(v);
  if (k.endsWith('memory') || k === 'memory') return memBytes(v);
  return Number(v);
}

/** Used amounts per quota key in a namespace (pods that are not finished). */
export function quotaUsed(c: Cluster, ns: string): Record<string, number> {
  const used: Record<string, number> = {};
  for (const p of listObjs(c, 'Pod', ns)) {
    if (p.status?.phase === 'Succeeded' || p.status?.phase === 'Failed') continue;
    for (const [k, v] of Object.entries(podUsage(p.spec))) used[k] = (used[k] ?? 0) + v;
  }
  return used;
}

/** ResourceQuota admission for a new pod: an error message, or null. */
export function quotaCheck(c: Cluster, ns: string, pod: KObject): string | null {
  const used = quotaUsed(c, ns);
  const want = podUsage(pod.spec);
  for (const q of listObjs(c, 'ResourceQuota', ns)) {
    const hard: Record<string, unknown> = q.spec?.hard ?? {};
    const keys = Object.keys(hard).filter((k) => k in want);
    const missing = keys.filter((k) => k !== 'pods' && (pod.spec.containers ?? []).some((ct: any) => {
      const [path, res] = k.includes('.') ? (k.split('.') as ['requests' | 'limits', string]) : ['requests', k];
      return ct.resources?.[path]?.[res] === undefined;
    }));
    if (missing.length) return `pods "${pod.metadata.name}" is forbidden: failed quota: ${q.metadata.name}: must specify ${missing.sort().join(',')}`;
    const over = keys.filter((k) => (used[k] ?? 0) + (want[k] ?? 0) > parseHard(k, hard[k]));
    if (over.length) {
      const s = over.sort();
      return `pods "${pod.metadata.name}" is forbidden: exceeded quota: ${q.metadata.name}, requested: ${s.map((k) => `${k}=${fmt(k, want[k]!)}`).join(',')}, used: ${s
        .map((k) => `${k}=${fmt(k, used[k] ?? 0)}`)
        .join(',')}, limited: ${s.map((k) => `${k}=${String(hard[k])}`).join(',')}`;
    }
  }
  return null;
}

/** status.used / status.hard for `kubectl get quota` and describe. */
export function quotaStatus(c: Cluster, q: KObject): { hard: Record<string, string>; used: Record<string, string> } {
  const used = quotaUsed(c, q.metadata.namespace ?? 'default');
  const hard: Record<string, string> = {};
  const u: Record<string, string> = {};
  for (const [k, v] of Object.entries(q.spec?.hard ?? {})) {
    hard[k] = String(v);
    u[k] = fmt(k, used[k] ?? 0);
  }
  return { hard, used: u };
}
