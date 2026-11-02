// What the API server fills in and checks when an object is created or changed
// (checked against a real kube-apiserver v1.37.2: `kubectl apply` then `get -o yaml`).
import type { Cluster, KObject, KubeState } from './types';
import { listObjs } from './store';
import { rand, randomSuffix } from './util';

const PROBE_DEFAULTS = { failureThreshold: 3, periodSeconds: 10, successThreshold: 1, timeoutSeconds: 1 };

function defaultProbe(p: any): void {
  if (!p) return;
  for (const [k, v] of Object.entries(PROBE_DEFAULTS)) if (p[k] === undefined) p[k] = v;
  if (p.httpGet && !p.httpGet.scheme) p.httpGet.scheme = 'HTTP';
}

function defaultContainer(c: any): void {
  if (!c.imagePullPolicy) {
    const tag = /:([^/:@]+)$/.exec(String(c.image ?? ''))?.[1];
    c.imagePullPolicy = !tag || tag === 'latest' ? 'Always' : 'IfNotPresent';
  }
  if (!c.resources) c.resources = {};
  if (!c.terminationMessagePath) c.terminationMessagePath = '/dev/termination-log';
  if (!c.terminationMessagePolicy) c.terminationMessagePolicy = 'File';
  for (const p of c.ports ?? []) if (!p.protocol) p.protocol = 'TCP';
  defaultProbe(c.readinessProbe);
  defaultProbe(c.livenessProbe);
  defaultProbe(c.startupProbe);
  for (const e of c.env ?? []) if (e.valueFrom?.fieldRef && !e.valueFrom.fieldRef.apiVersion) e.valueFrom.fieldRef.apiVersion = 'v1';
}

/** Pod spec defaults shared by pods and pod templates. */
export function defaultPodSpec(spec: any): void {
  if (!spec) return;
  for (const c of spec.containers ?? []) defaultContainer(c);
  for (const c of spec.initContainers ?? []) defaultContainer(c);
  if (!spec.dnsPolicy) spec.dnsPolicy = 'ClusterFirst';
  if (!spec.restartPolicy) spec.restartPolicy = 'Always';
  if (!spec.schedulerName) spec.schedulerName = 'default-scheduler';
  if (!spec.securityContext) spec.securityContext = {};
  if (spec.terminationGracePeriodSeconds === undefined) spec.terminationGracePeriodSeconds = 30;
  for (const v of spec.volumes ?? []) {
    if (v.configMap && v.configMap.defaultMode === undefined) v.configMap.defaultMode = 420;
    if (v.secret && v.secret.defaultMode === undefined) v.secret.defaultMode = 420;
    if (v.hostPath && v.hostPath.type === undefined) v.hostPath.type = '';
  }
}

function defaultTemplate(t: any): void {
  if (!t) return;
  if (!t.metadata) t.metadata = {};
  defaultPodSpec(t.spec);
}

/** Extra fields a real Pod gets (service account token volume, default tolerations, priority). */
export function defaultPod(state: KubeState, pod: KObject): void {
  const spec = pod.spec;
  defaultPodSpec(spec);
  if (spec.enableServiceLinks === undefined) spec.enableServiceLinks = true;
  if (!spec.preemptionPolicy) spec.preemptionPolicy = 'PreemptLowerPriority';
  if (spec.priority === undefined) spec.priority = 0;
  const sa = spec.serviceAccountName ?? spec.serviceAccount ?? 'default';
  spec.serviceAccountName = sa;
  spec.serviceAccount = sa;
  const tol: any[] = spec.tolerations ?? [];
  for (const key of ['node.kubernetes.io/not-ready', 'node.kubernetes.io/unreachable']) {
    if (!tol.some((t) => t.key === key && t.effect === 'NoExecute')) tol.push({ effect: 'NoExecute', key, operator: 'Exists', tolerationSeconds: 300 });
  }
  spec.tolerations = tol;
  if (spec.automountServiceAccountToken !== false && !(spec.volumes ?? []).some((v: any) => String(v.name).startsWith('kube-api-access-'))) {
    const name = `kube-api-access-${randomSuffix(state)}`;
    spec.volumes = [
      ...(spec.volumes ?? []),
      {
        name,
        projected: {
          defaultMode: 420,
          sources: [
            { serviceAccountToken: { expirationSeconds: 3607, path: 'token' } },
            { configMap: { items: [{ key: 'ca.crt', path: 'ca.crt' }], name: 'kube-root-ca.crt' } },
            { downwardAPI: { items: [{ fieldRef: { apiVersion: 'v1', fieldPath: 'metadata.namespace' }, path: 'namespace' }] } },
          ],
        },
      },
    ];
    for (const c of [...(spec.containers ?? []), ...(spec.initContainers ?? [])]) {
      c.volumeMounts = [...(c.volumeMounts ?? []), { mountPath: '/var/run/secrets/kubernetes.io/serviceaccount', name, readOnly: true }];
    }
  }
  pod.status = { phase: 'Pending', qosClass: qosClass(spec) };
}

/** Guaranteed (requests = limits for cpu and memory everywhere), Burstable, or BestEffort. */
export function qosClass(spec: any): string {
  const cs: any[] = [...(spec.containers ?? []), ...(spec.initContainers ?? [])];
  const any = cs.some((c) => Object.keys(c.resources?.requests ?? {}).length || Object.keys(c.resources?.limits ?? {}).length);
  if (!any) return 'BestEffort';
  const guaranteed = cs.every((c) => {
    const l = c.resources?.limits ?? {};
    const r = c.resources?.requests ?? l;
    return ['cpu', 'memory'].every((k) => l[k] !== undefined && String(r[k] ?? l[k]) === String(l[k]));
  });
  return guaranteed ? 'Guaranteed' : 'Burstable';
}

/** Fill in what the API server adds for each kind. Changes `o`. */
export function applyDefaults(state: KubeState, c: Cluster, o: KObject): void {
  const spec = o.spec;
  switch (o.kind) {
    case 'Namespace':
      o.spec = { finalizers: ['kubernetes'], ...(spec ?? {}) };
      o.metadata.labels = { ...(o.metadata.labels ?? {}), 'kubernetes.io/metadata.name': o.metadata.name };
      o.status = { phase: 'Active' };
      break;
    case 'Pod':
      defaultPod(state, o);
      break;
    case 'Deployment':
      if (spec.replicas === undefined) spec.replicas = 1;
      if (spec.progressDeadlineSeconds === undefined) spec.progressDeadlineSeconds = 600;
      if (spec.revisionHistoryLimit === undefined) spec.revisionHistoryLimit = 10;
      if (!spec.strategy?.type) spec.strategy = { ...(spec.strategy ?? {}), type: 'RollingUpdate' };
      if (spec.strategy.type === 'RollingUpdate') spec.strategy.rollingUpdate = { maxSurge: '25%', maxUnavailable: '25%', ...(spec.strategy.rollingUpdate ?? {}) };
      defaultTemplate(spec.template);
      o.status = o.status ?? {};
      break;
    case 'ReplicaSet':
      if (spec.replicas === undefined) spec.replicas = 1;
      defaultTemplate(spec.template);
      break;
    case 'DaemonSet':
      if (spec.revisionHistoryLimit === undefined) spec.revisionHistoryLimit = 10;
      if (!spec.updateStrategy) spec.updateStrategy = { rollingUpdate: { maxSurge: 0, maxUnavailable: 1 }, type: 'RollingUpdate' };
      defaultTemplate(spec.template);
      break;
    case 'StatefulSet':
      if (spec.replicas === undefined) spec.replicas = 1;
      if (!spec.podManagementPolicy) spec.podManagementPolicy = 'OrderedReady';
      if (spec.revisionHistoryLimit === undefined) spec.revisionHistoryLimit = 10;
      if (!spec.updateStrategy) spec.updateStrategy = { rollingUpdate: { partition: 0 }, type: 'RollingUpdate' };
      if (!spec.persistentVolumeClaimRetentionPolicy) spec.persistentVolumeClaimRetentionPolicy = { whenDeleted: 'Retain', whenScaled: 'Retain' };
      for (const t of spec.volumeClaimTemplates ?? []) {
        t.apiVersion = 'v1';
        t.kind = 'PersistentVolumeClaim';
        t.spec = { volumeMode: 'Filesystem', ...(t.spec ?? {}) };
        t.status = { phase: 'Pending' };
      }
      defaultTemplate(spec.template);
      break;
    case 'Job': {
      if (spec.backoffLimit === undefined) spec.backoffLimit = 6;
      if (!spec.completionMode) spec.completionMode = 'NonIndexed';
      if (spec.completions === undefined) spec.completions = 1;
      if (spec.parallelism === undefined) spec.parallelism = 1;
      if (spec.suspend === undefined) spec.suspend = false;
      if (spec.manualSelector === undefined) spec.manualSelector = false;
      if (!spec.podReplacementPolicy) spec.podReplacementPolicy = 'TerminatingOrFailed';
      const uidLabel = { 'batch.kubernetes.io/controller-uid': o.metadata.uid || 'pending' };
      if (!spec.selector) spec.selector = { matchLabels: uidLabel };
      spec.template = spec.template ?? {};
      spec.template.metadata = spec.template.metadata ?? {};
      spec.template.metadata.labels = {
        ...(spec.template.metadata.labels ?? {}),
        ...uidLabel,
        'batch.kubernetes.io/job-name': o.metadata.name,
        'controller-uid': uidLabel['batch.kubernetes.io/controller-uid'],
        'job-name': o.metadata.name,
      };
      defaultTemplate(spec.template);
      break;
    }
    case 'CronJob':
      if (!spec.concurrencyPolicy) spec.concurrencyPolicy = 'Allow';
      if (spec.failedJobsHistoryLimit === undefined) spec.failedJobsHistoryLimit = 1;
      if (spec.successfulJobsHistoryLimit === undefined) spec.successfulJobsHistoryLimit = 3;
      if (spec.suspend === undefined) spec.suspend = false;
      defaultTemplate(spec.jobTemplate?.spec?.template);
      break;
    case 'Service': {
      const type = spec.type ?? 'ClusterIP';
      spec.type = type;
      for (const p of spec.ports ?? []) {
        if (!p.protocol) p.protocol = 'TCP';
        if (p.targetPort === undefined) p.targetPort = p.port;
        if ((type === 'NodePort' || type === 'LoadBalancer') && !p.nodePort) p.nodePort = c.portNext++;
      }
      if (spec.clusterIP !== 'None' && type !== 'ExternalName') {
        if (!spec.clusterIP) {
          c.svcNext++;
          spec.clusterIP = `10.96.${Math.floor(rand(state) * 254) + 1}.${Math.floor(rand(state) * 253) + 2}`;
        }
        spec.clusterIPs = [spec.clusterIP];
      } else if (spec.clusterIP === 'None') spec.clusterIPs = ['None'];
      if (type !== 'ExternalName') {
        spec.internalTrafficPolicy = spec.internalTrafficPolicy ?? 'Cluster';
        spec.ipFamilies = spec.ipFamilies ?? ['IPv4'];
        spec.ipFamilyPolicy = spec.ipFamilyPolicy ?? 'SingleStack';
      }
      spec.sessionAffinity = spec.sessionAffinity ?? 'None';
      if (type === 'NodePort' || type === 'LoadBalancer') spec.externalTrafficPolicy = spec.externalTrafficPolicy ?? 'Cluster';
      if (type === 'LoadBalancer' && spec.allocateLoadBalancerNodePorts === undefined) spec.allocateLoadBalancerNodePorts = true;
      o.status = o.status ?? { loadBalancer: {} };
      break;
    }
    case 'PersistentVolumeClaim':
      spec.volumeMode = spec.volumeMode ?? 'Filesystem';
      if (spec.storageClassName === undefined) {
        const def = listObjs(c, 'StorageClass').find((s) => s.metadata.annotations?.['storageclass.kubernetes.io/is-default-class'] === 'true');
        if (def) spec.storageClassName = def.metadata.name;
      }
      o.status = { phase: 'Pending' };
      break;
    case 'PersistentVolume':
      spec.persistentVolumeReclaimPolicy = spec.persistentVolumeReclaimPolicy ?? 'Retain';
      spec.volumeMode = spec.volumeMode ?? 'Filesystem';
      o.status = o.status ?? { phase: 'Available' };
      break;
    case 'Secret':
      if (o.stringData) {
        o.data = { ...(o.data ?? {}) };
        for (const [k, v] of Object.entries(o.stringData as Record<string, string>)) o.data[k] = b64(String(v));
        delete o.stringData;
      }
      o.type = o.type ?? 'Opaque';
      break;
    case 'NetworkPolicy':
      if (!spec.policyTypes) spec.policyTypes = spec.egress ? ['Ingress', 'Egress'] : ['Ingress'];
      break;
    case 'StorageClass':
      o.reclaimPolicy = o.reclaimPolicy ?? 'Delete';
      o.volumeBindingMode = o.volumeBindingMode ?? 'Immediate';
      break;
    case 'PodDisruptionBudget':
      o.status = { currentHealthy: 0, desiredHealthy: 0, disruptionsAllowed: 0, expectedPods: 0 };
      break;
    default:
      break;
  }
}

/** Base64 like Go's StdEncoding (works with UTF-8). */
export function b64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function unb64(text: string): string {
  try {
    const bin = atob(text);
    return new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0)));
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Validation

const DNS1123 = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/;
const DNS1123_MSG =
  "a lowercase RFC 1123 subdomain must consist of lower case alphanumeric characters, '-' or '.', and must start and end with an alphanumeric character (e.g. 'example.com', regex used for validation is '[a-z0-9]([-a-z0-9]*[a-z0-9])?(\\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*')";
const LABEL1123 = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;
const LABEL1123_MSG =
  "a lowercase RFC 1123 label must consist of lower case alphanumeric characters or '-', and must start and end with an alphanumeric character (e.g. 'my-name',  or '123-abc', regex used for validation is '[a-z0-9]([-a-z0-9]*[a-z0-9])?')";

/** Field problems, like the API server's "is invalid" list. Empty = fine. */
export function validate(o: KObject): string[] {
  const errs: string[] = [];
  const name = o.metadata?.name;
  if (!name) errs.push('metadata.name: Required value: name or generateName is required');
  else if (['Role', 'ClusterRole', 'RoleBinding', 'ClusterRoleBinding'].includes(o.kind)) {
    // RBAC names are path segments: "kubeadm:cluster-admins" is fine.
    if (/[/%]/.test(name) || name === '.' || name === '..') errs.push(`metadata.name: Invalid value: "${name}": may not contain '/'`);
  } else if (o.kind === 'Namespace' || o.kind === 'Service') {
    if (!LABEL1123.test(name) || name.length > 63) errs.push(`metadata.name: Invalid value: "${name}": ${LABEL1123_MSG}`);
  } else if (!DNS1123.test(name) || name.length > 253) errs.push(`metadata.name: Invalid value: "${name}": ${DNS1123_MSG}`);
  const podSpec = (spec: any, path: string) => {
    if (!spec?.containers?.length) {
      errs.push(`${path}.containers: Required value`);
      return;
    }
    spec.containers.forEach((c: any, i: number) => {
      if (!c.name) errs.push(`${path}.containers[${i}].name: Required value`);
      if (!c.image) errs.push(`${path}.containers[${i}].image: Required value`);
      for (const k of ['cpu', 'memory']) {
        const req = c.resources?.requests?.[k];
        const lim = c.resources?.limits?.[k];
        if (req !== undefined && lim !== undefined && compareQty(k, req, lim) > 0) {
          errs.push(`${path}.containers[${i}].resources.requests: Invalid value: "${req}": must be less than or equal to ${k} limit of ${lim}`);
        }
      }
    });
  };
  const spec = o.spec;
  switch (o.kind) {
    case 'Pod':
      podSpec(spec, 'spec');
      break;
    case 'Deployment':
    case 'ReplicaSet':
    case 'DaemonSet':
    case 'StatefulSet': {
      if (!spec?.selector) errs.push('spec.selector: Required value');
      const labels = spec?.template?.metadata?.labels ?? {};
      const ml = spec?.selector?.matchLabels ?? {};
      if (spec?.selector && Object.entries(ml).some(([k, v]) => labels[k] !== v)) {
        const shown = `map[string]string{${Object.entries(labels).map(([k, v]) => `"${k}":"${v}"`).join(', ')}}`;
        errs.push(`spec.template.metadata.labels: Invalid value: ${shown}: \`selector\` does not match template \`labels\``);
      }
      podSpec(spec?.template?.spec, 'spec.template.spec');
      if (o.kind !== 'DaemonSet' && spec?.replicas !== undefined && spec.replicas < 0) errs.push(`spec.replicas: Invalid value: ${spec.replicas}: must be greater than or equal to 0`);
      break;
    }
    case 'Job':
      podSpec(spec?.template?.spec, 'spec.template.spec');
      if (spec?.template?.spec && !['Never', 'OnFailure'].includes(spec.template.spec.restartPolicy)) {
        errs.push(`spec.template.spec.restartPolicy: Required value: valid values: "OnFailure", "Never"`);
      }
      break;
    case 'Service':
      for (const [i, p] of (spec?.ports ?? []).entries()) {
        if (!p.port) errs.push(`spec.ports[${i}].port: Required value`);
      }
      break;
    default:
      break;
  }
  return errs;
}

function compareQty(kind: string, a: unknown, b: unknown): number {
  const num = (q: unknown) => {
    const s = String(q);
    if (kind === 'cpu') return s.endsWith('m') ? Number(s.slice(0, -1)) : Number(s) * 1000;
    const m = /^([0-9.]+)([A-Za-z]*)$/.exec(s);
    const units: Record<string, number> = { Ki: 1024, Mi: 1024 ** 2, Gi: 1024 ** 3, k: 1e3, M: 1e6, G: 1e9, '': 1 };
    return m ? Number(m[1]) * (units[m[2]!] ?? 1) : 0;
  };
  return num(a) - num(b);
}

// ---------------------------------------------------------------------------
// Strict field checks (kubectl uses --validate=strict): a typo is an "unknown field".

const META = ['name', 'generateName', 'namespace', 'labels', 'annotations', 'uid', 'resourceVersion', 'generation', 'creationTimestamp', 'deletionTimestamp', 'deletionGracePeriodSeconds', 'ownerReferences', 'finalizers', 'managedFields', 'selfLink'];
const CONTAINER = [
  'name', 'image', 'command', 'args', 'workingDir', 'ports', 'envFrom', 'env', 'resources', 'resizePolicy', 'restartPolicy', 'restartPolicyRules',
  'volumeMounts', 'volumeDevices', 'livenessProbe', 'readinessProbe', 'startupProbe', 'lifecycle', 'terminationMessagePath',
  'terminationMessagePolicy', 'imagePullPolicy', 'securityContext', 'stdin', 'stdinOnce', 'tty',
];
const POD_SPEC = [
  'volumes', 'initContainers', 'containers', 'ephemeralContainers', 'restartPolicy', 'terminationGracePeriodSeconds', 'activeDeadlineSeconds',
  'dnsPolicy', 'nodeSelector', 'serviceAccountName', 'serviceAccount', 'automountServiceAccountToken', 'nodeName', 'hostNetwork', 'hostPID',
  'hostIPC', 'shareProcessNamespace', 'securityContext', 'imagePullSecrets', 'hostname', 'subdomain', 'affinity', 'schedulerName',
  'tolerations', 'hostAliases', 'priorityClassName', 'priority', 'dnsConfig', 'readinessGates', 'runtimeClassName', 'enableServiceLinks',
  'preemptionPolicy', 'overhead', 'topologySpreadConstraints', 'setHostnameAsFQDN', 'os', 'hostUsers', 'schedulingGates', 'resourceClaims', 'resources',
];
const DEPLOY_SPEC = ['replicas', 'selector', 'template', 'strategy', 'minReadySeconds', 'revisionHistoryLimit', 'paused', 'progressDeadlineSeconds'];
const SERVICE_SPEC = [
  'ports', 'selector', 'clusterIP', 'clusterIPs', 'type', 'externalIPs', 'sessionAffinity', 'loadBalancerIP', 'loadBalancerSourceRanges',
  'externalName', 'externalTrafficPolicy', 'healthCheckNodePort', 'publishNotReadyAddresses', 'sessionAffinityConfig', 'ipFamilies',
  'ipFamilyPolicy', 'allocateLoadBalancerNodePorts', 'loadBalancerClass', 'internalTrafficPolicy', 'trafficDistribution',
];
const TOP: Record<string, string[]> = {
  ConfigMap: ['data', 'binaryData', 'immutable'],
  Secret: ['data', 'stringData', 'type', 'immutable'],
  Role: ['rules'],
  ClusterRole: ['rules', 'aggregationRule'],
  RoleBinding: ['subjects', 'roleRef'],
  ClusterRoleBinding: ['subjects', 'roleRef'],
  ServiceAccount: ['secrets', 'imagePullSecrets', 'automountServiceAccountToken'],
  StorageClass: ['provisioner', 'parameters', 'reclaimPolicy', 'mountOptions', 'allowVolumeExpansion', 'volumeBindingMode', 'allowedTopologies'],
  Event: ['involvedObject', 'reason', 'message', 'source', 'firstTimestamp', 'lastTimestamp', 'count', 'type', 'eventTime', 'series', 'action', 'related', 'reportingComponent', 'reportingInstance'],
};

/** Unknown fields, as `strict decoding error: unknown field "spec.containers[0].comand"`. */
export function unknownFields(o: KObject): string[] {
  const out: string[] = [];
  const check = (v: any, allowed: string[], path: string) => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return;
    for (const k of Object.keys(v)) if (!allowed.includes(k)) out.push(`${path}${path ? '.' : ''}${k}`);
  };
  const top = ['apiVersion', 'kind', 'metadata', 'spec', 'status', ...(TOP[o.kind] ?? [])];
  check(o, top, '');
  check(o.metadata, META, 'metadata');
  const podSpec = (spec: any, path: string) => {
    check(spec, POD_SPEC, path);
    (spec?.containers ?? []).forEach((c: any, i: number) => check(c, CONTAINER, `${path}.containers[${i}]`));
    (spec?.initContainers ?? []).forEach((c: any, i: number) => check(c, CONTAINER, `${path}.initContainers[${i}]`));
  };
  if (o.kind === 'Pod') podSpec(o.spec, 'spec');
  if (o.kind === 'Deployment') {
    check(o.spec, DEPLOY_SPEC, 'spec');
    check(o.spec?.template, ['metadata', 'spec'], 'spec.template');
    podSpec(o.spec?.template?.spec, 'spec.template.spec');
  }
  if (['ReplicaSet', 'DaemonSet', 'StatefulSet', 'Job'].includes(o.kind)) podSpec(o.spec?.template?.spec, 'spec.template.spec');
  if (o.kind === 'Service') check(o.spec, SERVICE_SPEC, 'spec');
  return out;
}
