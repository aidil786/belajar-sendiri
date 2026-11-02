// RBAC authorizer: who may do what (Roles, ClusterRoles and their bindings).
// Messages match a real kube-apiserver v1.37.2.
import type { Cluster, KObject } from './types';
import { listObjs } from './store';

export interface Identity {
  user: string;
  groups: string[];
}

export interface Request {
  verb: string;
  group: string;
  resource: string;
  subresource?: string;
  namespace?: string;
  name?: string;
}

/** `--as=bob` or `--as=system:serviceaccount:default:ci-bot`. */
export function impersonate(as: string, groups: string[] = []): Identity {
  const sa = /^system:serviceaccount:([^:]+):([^:]+)$/.exec(as);
  if (sa) return { user: as, groups: ['system:serviceaccounts', `system:serviceaccounts:${sa[1]}`, 'system:authenticated', ...groups] };
  return { user: as, groups: [...groups, 'system:authenticated'] };
}

function ruleAllows(rule: any, req: Request): boolean {
  const res = req.subresource ? `${req.resource}/${req.subresource}` : req.resource;
  const groups: string[] = rule.apiGroups ?? [];
  const resources: string[] = rule.resources ?? [];
  const verbs: string[] = rule.verbs ?? [];
  if (!verbs.includes('*') && !verbs.includes(req.verb)) return false;
  if (!groups.includes('*') && !groups.includes(req.group)) return false;
  if (!resources.includes('*') && !resources.includes(res) && !(req.subresource && resources.includes(`${req.resource}/*`))) return false;
  const names: string[] = rule.resourceNames ?? [];
  if (names.length && (!req.name || !names.includes(req.name))) return false;
  return true;
}

function subjectMatches(sub: any, who: Identity, bindingNs?: string): boolean {
  if (sub.kind === 'User') return sub.name === who.user;
  if (sub.kind === 'Group') return who.groups.includes(sub.name);
  if (sub.kind === 'ServiceAccount') return who.user === `system:serviceaccount:${sub.namespace ?? bindingNs}:${sub.name}`;
  return false;
}

function rulesOf(c: Cluster, ref: any, ns?: string): any[] {
  const kind = ref?.kind === 'ClusterRole' ? 'ClusterRole' : 'Role';
  const role = listObjs(c, kind, kind === 'Role' ? ns : undefined).find((r) => r.metadata.name === ref?.name);
  return role?.rules ?? [];
}

/** Does this identity have permission? */
export function authorize(c: Cluster, who: Identity, req: Request): boolean {
  if (who.groups.includes('system:masters')) return true;
  for (const b of listObjs(c, 'ClusterRoleBinding')) {
    if (!(b.subjects ?? []).some((s: any) => subjectMatches(s, who))) continue;
    if (rulesOf(c, b.roleRef).some((r) => ruleAllows(r, req))) return true;
  }
  if (req.namespace) {
    for (const b of listObjs(c, 'RoleBinding', req.namespace)) {
      if (!(b.subjects ?? []).some((s: any) => subjectMatches(s, who, req.namespace))) continue;
      if (rulesOf(c, b.roleRef, req.namespace).some((r) => ruleAllows(r, req))) return true;
    }
  }
  return false;
}

/** The forbidden message, like the API server's. */
export function forbiddenText(who: Identity, req: Request, plural: string): string {
  const what = req.name ? `${plural} "${req.name}"` : plural;
  const res = req.subresource ? `${req.resource}/${req.subresource}` : req.resource;
  const where = req.namespace ? `in the namespace "${req.namespace}"` : 'at the cluster scope';
  return `${what} is forbidden: User "${who.user}" cannot ${req.verb} resource "${res}" in API group "${req.group}" ${where}`;
}

/** Rows for `kubectl auth can-i --list`: resource → verbs. */
export function listRules(c: Cluster, who: Identity, ns: string): { resource: string; names: string[]; verbs: string[] }[] {
  const out: { resource: string; names: string[]; verbs: string[] }[] = [];
  const add = (rules: any[]) => {
    for (const r of rules) {
      for (const res of r.resources ?? []) {
        for (const g of r.apiGroups ?? ['']) {
          const resource = g === '' || g === '*' ? (g === '*' ? `${res}.*` : res) : `${res}.${g}`;
          out.push({ resource, names: r.resourceNames ?? [], verbs: r.verbs ?? [] });
        }
      }
    }
  };
  if (who.groups.includes('system:masters')) add([{ apiGroups: ['*'], resources: ['*'], verbs: ['*'] }]);
  for (const b of listObjs(c, 'ClusterRoleBinding')) if ((b.subjects ?? []).some((s: any) => subjectMatches(s, who))) add(rulesOf(c, b.roleRef));
  for (const b of listObjs(c, 'RoleBinding', ns)) if ((b.subjects ?? []).some((s: any) => subjectMatches(s, who, ns))) add(rulesOf(c, b.roleRef, ns));
  return out;
}

/** Built-in ClusterRoles (simplified to their main rules) and the admin binding. */
export function builtinRbac(): { kind: string; obj: Omit<KObject, 'metadata'> & { metadata: { name: string; labels?: Record<string, string> } } }[] {
  const role = (name: string, rules: any[]) => ({
    kind: 'ClusterRole',
    obj: { apiVersion: 'rbac.authorization.k8s.io/v1', kind: 'ClusterRole', metadata: { name, labels: { 'kubernetes.io/bootstrapping': 'rbac-defaults' } }, rules },
  });
  const read = ['get', 'list', 'watch'];
  const write = ['create', 'delete', 'deletecollection', 'patch', 'update'];
  const coreRead = ['pods', 'pods/log', 'pods/status', 'services', 'endpoints', 'configmaps', 'persistentvolumeclaims', 'serviceaccounts', 'events', 'limitranges', 'resourcequotas', 'replicationcontrollers', 'namespaces'];
  const appsRes = ['deployments', 'deployments/scale', 'replicasets', 'replicasets/scale', 'daemonsets', 'statefulsets', 'statefulsets/scale'];
  const viewRules = [
    { apiGroups: [''], resources: coreRead, verbs: read },
    { apiGroups: ['apps'], resources: appsRes, verbs: read },
    { apiGroups: ['batch'], resources: ['jobs', 'cronjobs'], verbs: read },
    { apiGroups: ['autoscaling'], resources: ['horizontalpodautoscalers'], verbs: read },
    { apiGroups: ['policy'], resources: ['poddisruptionbudgets'], verbs: read },
    { apiGroups: ['networking.k8s.io'], resources: ['ingresses', 'networkpolicies'], verbs: read },
    { apiGroups: ['discovery.k8s.io'], resources: ['endpointslices'], verbs: read },
  ];
  const editRules = [
    { apiGroups: [''], resources: ['pods', 'pods/exec', 'pods/portforward', 'pods/attach', 'pods/eviction', 'services', 'configmaps', 'secrets', 'persistentvolumeclaims', 'serviceaccounts'], verbs: write },
    { apiGroups: [''], resources: ['secrets'], verbs: read },
    { apiGroups: ['apps'], resources: appsRes, verbs: write },
    { apiGroups: ['batch'], resources: ['jobs', 'cronjobs'], verbs: write },
    { apiGroups: ['autoscaling'], resources: ['horizontalpodautoscalers'], verbs: write },
    { apiGroups: ['policy'], resources: ['poddisruptionbudgets'], verbs: write },
    { apiGroups: ['networking.k8s.io'], resources: ['ingresses', 'networkpolicies'], verbs: write },
    ...viewRules,
  ];
  return [
    role('cluster-admin', [{ apiGroups: ['*'], resources: ['*'], verbs: ['*'] }, { nonResourceURLs: ['*'], verbs: ['*'] }]),
    role('admin', [{ apiGroups: ['rbac.authorization.k8s.io'], resources: ['roles', 'rolebindings'], verbs: [...read, ...write] }, ...editRules]),
    role('edit', editRules),
    role('view', viewRules),
    {
      kind: 'ClusterRoleBinding',
      obj: {
        apiVersion: 'rbac.authorization.k8s.io/v1',
        kind: 'ClusterRoleBinding',
        metadata: { name: 'kubeadm:cluster-admins' },
        roleRef: { apiGroup: 'rbac.authorization.k8s.io', kind: 'ClusterRole', name: 'cluster-admin' },
        subjects: [{ apiGroup: 'rbac.authorization.k8s.io', kind: 'Group', name: 'kubeadm:cluster-admins' }],
      },
    },
    {
      kind: 'ClusterRoleBinding',
      obj: {
        apiVersion: 'rbac.authorization.k8s.io/v1',
        kind: 'ClusterRoleBinding',
        metadata: { name: 'cluster-admin', labels: { 'kubernetes.io/bootstrapping': 'rbac-defaults' } },
        roleRef: { apiGroup: 'rbac.authorization.k8s.io', kind: 'ClusterRole', name: 'cluster-admin' },
        subjects: [{ apiGroup: 'rbac.authorization.k8s.io', kind: 'Group', name: 'system:masters' }],
      },
    },
  ];
}
