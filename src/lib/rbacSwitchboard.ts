// Pure logic for RbacSwitchboard: who can do what, decided the way Kubernetes RBAC decides it.
//
// RBAC only adds rights (there is no "deny"). A request is allowed when any binding gives it:
//   - a ClusterRoleBinding gives its ClusterRole's rules everywhere (every namespace, and
//     cluster-wide things like nodes);
//   - a RoleBinding gives its Role's (or ClusterRole's) rules only inside the RoleBinding's namespace.
// A rule matches when the verb, the API group and the resource each match (or are "*").
// `kubectl auth can-i` answers "yes" or "no" (exit 0 / 1), with a warning first for a cluster-wide
// resource asked about in a namespace, an unknown resource, or an unknown verb. All of this was
// checked against a real kube-apiserver v1.37.2 with RBAC on.
import { toYaml } from './k8sMessages';

export interface RbacSubject {
  kind: 'User' | 'Group' | 'ServiceAccount';
  name: string;
  /** ServiceAccounts only. */
  namespace?: string;
}

export interface RbacRule {
  apiGroups: string[];
  resources: string[];
  verbs: string[];
  resourceNames?: string[];
}

export interface RbacRole {
  kind: 'Role' | 'ClusterRole';
  name: string;
  /** Roles only. */
  namespace?: string;
  rules: RbacRule[];
}

export interface RbacBinding {
  kind: 'RoleBinding' | 'ClusterRoleBinding';
  name: string;
  /** RoleBindings only. */
  namespace?: string;
  roleRef: { kind: 'Role' | 'ClusterRole'; name: string };
  subjects: RbacSubject[];
}

export interface CanIQuestion {
  /** Subject id: "ServiceAccount:ci:ci-bot", "User:mei", or an object. */
  as: string;
  verb: string;
  /** Plural resource ("deployments", "pods/log", "deployments.apps"). */
  resource: string;
  /** Omit for the context's namespace ("default"); "*" for all namespaces (-A). */
  namespace?: string;
  /** The answer the task wants. */
  expect?: boolean;
}

export interface CanIAnswer {
  allowed: boolean;
  warnings: string[];
  /** The binding and role that allowed it. */
  by?: { binding: RbacBinding; role: RbacRole };
  command: string;
}

/** What the API server knows about common resources: API group and whether it lives in a namespace. */
export const RESOURCES: Record<string, { group: string; namespaced: boolean }> = {
  pods: { group: '', namespaced: true },
  services: { group: '', namespaced: true },
  configmaps: { group: '', namespaced: true },
  secrets: { group: '', namespaced: true },
  serviceaccounts: { group: '', namespaced: true },
  persistentvolumeclaims: { group: '', namespaced: true },
  events: { group: '', namespaced: true },
  endpoints: { group: '', namespaced: true },
  nodes: { group: '', namespaced: false },
  namespaces: { group: '', namespaced: false },
  persistentvolumes: { group: '', namespaced: false },
  deployments: { group: 'apps', namespaced: true },
  replicasets: { group: 'apps', namespaced: true },
  statefulsets: { group: 'apps', namespaced: true },
  daemonsets: { group: 'apps', namespaced: true },
  jobs: { group: 'batch', namespaced: true },
  cronjobs: { group: 'batch', namespaced: true },
  horizontalpodautoscalers: { group: 'autoscaling', namespaced: true },
  networkpolicies: { group: 'networking.k8s.io', namespaced: true },
  ingresses: { group: 'networking.k8s.io', namespaced: true },
  roles: { group: 'rbac.authorization.k8s.io', namespaced: true },
  rolebindings: { group: 'rbac.authorization.k8s.io', namespaced: true },
  clusterroles: { group: 'rbac.authorization.k8s.io', namespaced: false },
  clusterrolebindings: { group: 'rbac.authorization.k8s.io', namespaced: false },
  gateways: { group: 'gateway.networking.k8s.io', namespaced: true },
  httproutes: { group: 'gateway.networking.k8s.io', namespaced: true },
  storageclasses: { group: 'storage.k8s.io', namespaced: false },
};

export const VERBS = [
  'get',
  'list',
  'watch',
  'create',
  'update',
  'patch',
  'delete',
  'deletecollection',
  'use',
  'bind',
  'escalate',
  'impersonate',
  'approve',
  'sign',
];

export function subjectId(s: RbacSubject): string {
  return s.kind === 'ServiceAccount'
    ? `ServiceAccount:${s.namespace ?? 'default'}:${s.name}`
    : `${s.kind}:${s.name}`;
}

export function parseSubject(id: string): RbacSubject {
  const [kind, a, b] = id.split(':');
  if (kind === 'ServiceAccount') return { kind, namespace: b ? a : 'default', name: b ?? a! };
  return { kind: kind as 'User' | 'Group', name: a! };
}

/** The user name and groups a subject has when it talks to the API server. */
export function userInfo(s: RbacSubject): { user: string; groups: string[] } {
  if (s.kind === 'ServiceAccount') {
    const ns = s.namespace ?? 'default';
    return {
      user: `system:serviceaccount:${ns}:${s.name}`,
      groups: ['system:serviceaccounts', `system:serviceaccounts:${ns}`, 'system:authenticated'],
    };
  }
  if (s.kind === 'Group') return { user: '', groups: [s.name, 'system:authenticated'] };
  return { user: s.name, groups: ['system:authenticated'] };
}

/** Does a binding's subject cover this user? ServiceAccount subjects default to the binding's namespace. */
export function subjectMatches(
  subject: RbacSubject,
  who: { user: string; groups: string[] },
  bindingNamespace?: string,
): boolean {
  if (subject.kind === 'User') return subject.name === who.user;
  if (subject.kind === 'Group') return who.groups.includes(subject.name);
  return (
    `system:serviceaccount:${subject.namespace ?? bindingNamespace ?? ''}:${subject.name}` ===
    who.user
  );
}

/** RBAC's rule match (verbs, API groups, resources with subresources, resourceNames). */
export function ruleAllows(
  rule: RbacRule,
  verb: string,
  group: string,
  resource: string,
  subresource = '',
  name = '',
): boolean {
  if (!rule.verbs.includes('*') && !rule.verbs.includes(verb)) return false;
  if (!rule.apiGroups.includes('*') && !rule.apiGroups.includes(group)) return false;
  const combined = subresource ? `${resource}/${subresource}` : resource;
  const resOk = rule.resources.some(
    (r) => r === '*' || r === combined || (subresource !== '' && r === `*/${subresource}`),
  );
  if (!resOk) return false;
  if (rule.resourceNames?.length) return name !== '' && rule.resourceNames.includes(name);
  return true;
}

function splitResource(resource: string): {
  resource: string;
  subresource: string;
  group?: string;
} {
  const [res, sub = ''] = resource.split('/');
  const dot = res!.indexOf('.');
  if (dot > 0)
    return { resource: res!.slice(0, dot), subresource: sub, group: res!.slice(dot + 1) };
  return { resource: res!, subresource: sub };
}

export interface RbacModel {
  roles: RbacRole[];
  bindings: RbacBinding[];
}

/** `kubectl auth can-i <verb> <resource> [-n ns | -A] --as=<subject>` */
export function canI(model: RbacModel, q: CanIQuestion): CanIAnswer {
  const subject = parseSubject(q.as);
  const who = userInfo(subject);
  const { resource, subresource, group: explicitGroup } = splitResource(q.resource);
  const known = RESOURCES[resource];
  const warnings: string[] = [];
  const all = q.namespace === '*';
  const ns = all ? '' : (q.namespace ?? 'default');
  if (!VERBS.includes(q.verb) && q.verb !== '*')
    warnings.push(`Warning: verb '${q.verb}' is not a known verb`);
  if (!known) warnings.push(`Warning: the server doesn't have a resource type '${resource}'`);
  else if (!known.namespaced && ns)
    warnings.push(`Warning: resource '${resource}' is not namespace scoped`);
  const group = explicitGroup ?? known?.group ?? '';
  const asFlag =
    subject.kind === 'Group' ? `--as=nobody --as-group=${subject.name}` : `--as=${who.user}`;
  const nsFlag = all ? ' -A' : q.namespace ? ` -n ${q.namespace}` : '';
  const sub = subresource ? ` --subresource=${subresource}` : '';
  const command = `kubectl auth can-i ${q.verb} ${resource}${sub}${nsFlag} ${asFlag}`;
  for (const b of model.bindings) {
    if (b.kind === 'RoleBinding' && (!ns || b.namespace !== ns)) continue;
    if (!b.subjects.some((s) => subjectMatches(s, who, b.namespace))) continue;
    const role = model.roles.find(
      (r) =>
        r.kind === b.roleRef.kind &&
        r.name === b.roleRef.name &&
        (r.kind === 'ClusterRole' || r.namespace === b.namespace),
    );
    if (!role) continue;
    if (role.rules.some((r) => ruleAllows(r, q.verb, group, resource, subresource)))
      return { allowed: true, warnings, by: { binding: b, role }, command };
  }
  return { allowed: false, warnings, command };
}

/** kubectl's printed answer (warnings first, then a blank line, like a terminal shows them). */
export function canIOutput(a: CanIAnswer): string[] {
  return a.warnings.length
    ? [...a.warnings, '', a.allowed ? 'yes' : 'no']
    : [a.allowed ? 'yes' : 'no'];
}

export type RbacTask =
  /** Change the wires until every question gets its expected answer. */
  | { type: 'wire' }
  /** Predict each answer before seeing it. */
  | { type: 'predict' };

export function allAnswered(model: RbacModel, questions: CanIQuestion[]): boolean {
  return questions.every((q) => q.expect === undefined || canI(model, q).allowed === q.expect);
}

/** A short summary of a rule: "get, list · deployments" */
export function ruleSummary(r: RbacRule): string {
  return `${r.verbs.join(', ')} · ${r.resources.join(', ')}`;
}

/** Can this role be bound in this scope? A Role only by a RoleBinding in its own namespace. */
export function canBind(role: RbacRole, scope: string): boolean {
  if (role.kind === 'Role') return scope === role.namespace;
  return true;
}

/** Make a binding for subject → role in a scope ("*" = cluster-wide ClusterRoleBinding). */
export function makeBinding(subject: RbacSubject, role: RbacRole, scope: string): RbacBinding {
  const short = subject.name.replace(/[^a-z0-9-]/g, '-');
  if (scope === '*')
    return {
      kind: 'ClusterRoleBinding',
      name: `${short}-${role.name}`,
      roleRef: { kind: 'ClusterRole', name: role.name },
      subjects: [subject],
    };
  return {
    kind: 'RoleBinding',
    name: `${short}-${role.name}`,
    namespace: scope,
    roleRef: { kind: role.kind, name: role.name },
    subjects: [subject],
  };
}

export function bindingYaml(b: RbacBinding): string {
  const subject = (s: RbacSubject) =>
    s.kind === 'ServiceAccount'
      ? { kind: s.kind, name: s.name, namespace: s.namespace ?? b.namespace }
      : { kind: s.kind, name: s.name, apiGroup: 'rbac.authorization.k8s.io' };
  return toYaml({
    apiVersion: 'rbac.authorization.k8s.io/v1',
    kind: b.kind,
    metadata: b.namespace ? { name: b.name, namespace: b.namespace } : { name: b.name },
    subjects: b.subjects.map(subject),
    roleRef: { apiGroup: 'rbac.authorization.k8s.io', kind: b.roleRef.kind, name: b.roleRef.name },
  });
}

export function roleYaml(r: RbacRole): string {
  return toYaml({
    apiVersion: 'rbac.authorization.k8s.io/v1',
    kind: r.kind,
    metadata: r.namespace ? { name: r.name, namespace: r.namespace } : { name: r.name },
    rules: r.rules.map((x) => ({
      apiGroups: x.apiGroups,
      resources: x.resources,
      verbs: x.verbs,
      ...(x.resourceNames ? { resourceNames: x.resourceNames } : {}),
    })),
  });
}
