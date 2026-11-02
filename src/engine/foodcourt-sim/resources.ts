// The resource types this cluster knows (like `kubectl api-resources`).
export interface ResourceType {
  kind: string;
  plural: string;
  singular: string;
  short: string[];
  group: string; // '' = core
  version: string;
  namespaced: boolean;
  verbs: string[];
}

const ALL = ['create', 'delete', 'deletecollection', 'get', 'list', 'patch', 'update', 'watch'];

const R = (kind: string, plural: string, short: string[], group: string, version: string, namespaced = true, verbs = ALL): ResourceType => ({
  kind,
  plural,
  singular: kind.toLowerCase(),
  short,
  group,
  version,
  namespaced,
  verbs,
});

export const RESOURCES: ResourceType[] = [
  R('Pod', 'pods', ['po'], '', 'v1'),
  R('Node', 'nodes', ['no'], '', 'v1', false),
  R('Namespace', 'namespaces', ['ns'], '', 'v1', false, ['create', 'delete', 'get', 'list', 'patch', 'update', 'watch']),
  R('Service', 'services', ['svc'], '', 'v1', true, ['create', 'delete', 'deletecollection', 'get', 'list', 'patch', 'update', 'watch']),
  R('ConfigMap', 'configmaps', ['cm'], '', 'v1'),
  R('Secret', 'secrets', [], '', 'v1'),
  R('ServiceAccount', 'serviceaccounts', ['sa'], '', 'v1'),
  R('PersistentVolume', 'persistentvolumes', ['pv'], '', 'v1', false),
  R('PersistentVolumeClaim', 'persistentvolumeclaims', ['pvc'], '', 'v1'),
  R('Event', 'events', ['ev'], '', 'v1'),
  R('ResourceQuota', 'resourcequotas', ['quota'], '', 'v1'),
  R('LimitRange', 'limitranges', ['limits'], '', 'v1'),
  R('Deployment', 'deployments', ['deploy'], 'apps', 'v1'),
  R('ReplicaSet', 'replicasets', ['rs'], 'apps', 'v1'),
  R('DaemonSet', 'daemonsets', ['ds'], 'apps', 'v1'),
  R('StatefulSet', 'statefulsets', ['sts'], 'apps', 'v1'),
  R('Job', 'jobs', [], 'batch', 'v1'),
  R('CronJob', 'cronjobs', ['cj'], 'batch', 'v1'),
  R('HorizontalPodAutoscaler', 'horizontalpodautoscalers', ['hpa'], 'autoscaling', 'v2'),
  R('PodDisruptionBudget', 'poddisruptionbudgets', ['pdb'], 'policy', 'v1'),
  R('EndpointSlice', 'endpointslices', [], 'discovery.k8s.io', 'v1'),
  R('Ingress', 'ingresses', ['ing'], 'networking.k8s.io', 'v1'),
  R('IngressClass', 'ingressclasses', [], 'networking.k8s.io', 'v1', false),
  R('NetworkPolicy', 'networkpolicies', ['netpol'], 'networking.k8s.io', 'v1'),
  R('StorageClass', 'storageclasses', ['sc'], 'storage.k8s.io', 'v1', false),
  R('Role', 'roles', [], 'rbac.authorization.k8s.io', 'v1'),
  R('ClusterRole', 'clusterroles', [], 'rbac.authorization.k8s.io', 'v1', false),
  R('RoleBinding', 'rolebindings', [], 'rbac.authorization.k8s.io', 'v1'),
  R('ClusterRoleBinding', 'clusterrolebindings', [], 'rbac.authorization.k8s.io', 'v1', false),
  R('GatewayClass', 'gatewayclasses', ['gc'], 'gateway.networking.k8s.io', 'v1', false),
  R('Gateway', 'gateways', ['gtw'], 'gateway.networking.k8s.io', 'v1'),
  R('HTTPRoute', 'httproutes', [], 'gateway.networking.k8s.io', 'v1'),
];

/** Gateway API kinds exist only when the cluster has the Gateway API CRDs installed. */
export const GATEWAY_KINDS = ['GatewayClass', 'Gateway', 'HTTPRoute'];

export function byKind(kind: string): ResourceType | undefined {
  return RESOURCES.find((r) => r.kind === kind);
}

export function apiVersionOf(r: ResourceType): string {
  return r.group ? `${r.group}/${r.version}` : r.version;
}

/** `deployment.apps`, `service`, `pod` … the name kubectl uses in "x/y created". */
export function qualified(r: ResourceType): string {
  return r.group ? `${r.singular}.${r.group}` : r.singular;
}

/** Find a type from what the learner typed: pods, po, pod, deploy, deployments.apps, Deployment … */
export function findResource(word: string, gateway = true): ResourceType | undefined {
  const w = word.toLowerCase();
  const [name, ...groupParts] = w.split('.');
  const group = groupParts.join('.');
  return RESOURCES.filter((r) => gateway || !GATEWAY_KINDS.includes(r.kind)).find(
    (r) =>
      (r.plural === name || r.singular === name || r.short.includes(name!) || r.kind.toLowerCase() === name) &&
      (!group || r.group === group || r.group.startsWith(`${group}.`) || (group === 'v1' && r.group === '')),
  );
}

/** Store key: kind/namespace/name (namespace empty for cluster-scoped). */
export function objKey(kind: string, namespace: string | undefined, name: string): string {
  return `${kind}/${namespace ?? ''}/${name}`;
}
