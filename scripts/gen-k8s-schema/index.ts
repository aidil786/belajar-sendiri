// Generates src/lib/k8sSchemaData.ts: a compact schema for the Kubernetes kinds YamlDoctor checks.
//
// Inputs (download them first; they are big, so they are not in the repo):
//   --defs     _definitions.json for Kubernetes 1.37.2
//              https://raw.githubusercontent.com/yannh/kubernetes-json-schema/master/v1.37.2/_definitions.json
//   --gateway  Gateway API v1.6.1 standard CRDs
//              https://github.com/kubernetes-sigs/gateway-api/releases/download/v1.6.1/standard-install.yaml
// Committed inputs next to this file:
//   served-kinds.json  every [apiVersion, kind, namespaced, plural] a v1.37.2 API server (+ Gateway API v1.6.1) serves
//   go-types.json      Go type names kube-apiserver prints in decode errors, where they differ from the
//                      plain OpenAPI type (e.g. ServicePort.protocol is v1.Protocol). Captured from a real
//                      kube-apiserver v1.37.2 with server dry-run requests (one wrong-typed field each).
//
// Run: npx tsx scripts/gen-k8s-schema/index.ts --defs <file> --gateway <file>
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAllDocuments } from 'yaml';

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0 || !process.argv[i + 1]) throw new Error(`Missing --${name} <file>`);
  return process.argv[i + 1]!;
};

type Prop = {
  $ref?: string;
  type?: string;
  format?: string;
  items?: Prop;
  additionalProperties?: Prop | boolean;
  properties?: Record<string, Prop>;
};
const defs = (
  JSON.parse(readFileSync(arg('defs'), 'utf8')) as { definitions: Record<string, Prop> }
).definitions;
const goTypes = JSON.parse(readFileSync(join(here, 'go-types.json'), 'utf8')) as Record<
  string,
  string
>;
const served = JSON.parse(readFileSync(join(here, 'served-kinds.json'), 'utf8')) as [
  string,
  string,
  boolean,
  string,
][];

// Built-in kinds with a full schema. Other served kinds are known (no "resource mapping not found")
// but only get the generic checks.
const ROOTS: Record<string, string> = {
  'v1 Pod': 'io.k8s.api.core.v1.Pod',
  'v1 Service': 'io.k8s.api.core.v1.Service',
  'v1 ConfigMap': 'io.k8s.api.core.v1.ConfigMap',
  'v1 Secret': 'io.k8s.api.core.v1.Secret',
  'v1 Namespace': 'io.k8s.api.core.v1.Namespace',
  'v1 ServiceAccount': 'io.k8s.api.core.v1.ServiceAccount',
  'v1 PersistentVolumeClaim': 'io.k8s.api.core.v1.PersistentVolumeClaim',
  'v1 PersistentVolume': 'io.k8s.api.core.v1.PersistentVolume',
  'v1 ResourceQuota': 'io.k8s.api.core.v1.ResourceQuota',
  'v1 LimitRange': 'io.k8s.api.core.v1.LimitRange',
  'apps/v1 Deployment': 'io.k8s.api.apps.v1.Deployment',
  'apps/v1 ReplicaSet': 'io.k8s.api.apps.v1.ReplicaSet',
  'apps/v1 StatefulSet': 'io.k8s.api.apps.v1.StatefulSet',
  'apps/v1 DaemonSet': 'io.k8s.api.apps.v1.DaemonSet',
  'batch/v1 Job': 'io.k8s.api.batch.v1.Job',
  'batch/v1 CronJob': 'io.k8s.api.batch.v1.CronJob',
  'autoscaling/v2 HorizontalPodAutoscaler': 'io.k8s.api.autoscaling.v2.HorizontalPodAutoscaler',
  'networking.k8s.io/v1 NetworkPolicy': 'io.k8s.api.networking.v1.NetworkPolicy',
  'networking.k8s.io/v1 Ingress': 'io.k8s.api.networking.v1.Ingress',
  'networking.k8s.io/v1 IngressClass': 'io.k8s.api.networking.v1.IngressClass',
  'policy/v1 PodDisruptionBudget': 'io.k8s.api.policy.v1.PodDisruptionBudget',
  'storage.k8s.io/v1 StorageClass': 'io.k8s.api.storage.v1.StorageClass',
  'rbac.authorization.k8s.io/v1 Role': 'io.k8s.api.rbac.v1.Role',
  'rbac.authorization.k8s.io/v1 RoleBinding': 'io.k8s.api.rbac.v1.RoleBinding',
  'rbac.authorization.k8s.io/v1 ClusterRole': 'io.k8s.api.rbac.v1.ClusterRole',
  'rbac.authorization.k8s.io/v1 ClusterRoleBinding': 'io.k8s.api.rbac.v1.ClusterRoleBinding',
};
// Gateway API CRDs (apiVersion kind) with a full schema.
const CRD_KINDS = ['Gateway', 'GatewayClass', 'HTTPRoute', 'ReferenceGrant'];

const index = new Map<string, number>();
const structs: [string, Record<string, string>][] = [];
const short = (id: string) => id.split('.').pop()!;
const pkg = (id: string) => id.split('.').slice(-2, -1)[0]!;

function spec(p: Prop): string {
  if (p.$ref) {
    const id = p.$ref.split('/').pop()!;
    if (id.endsWith('intstr.IntOrString')) return 'ios';
    if (id.endsWith('resource.Quantity')) return 'q';
    if (id.endsWith('meta.v1.Time') || id.endsWith('meta.v1.MicroTime')) return 'time';
    const d = defs[id]!;
    if (!d.properties) return d.type === 'string' ? 's' : 'any';
    return `#${struct(id)}`;
  }
  switch (p.type) {
    case 'string':
      return p.format === 'byte' ? 'by' : 's';
    case 'integer':
      return p.format === 'int32' ? 'i32' : 'i64';
    case 'boolean':
      return 'b';
    case 'number':
      return 'f';
    case 'array':
      return `[${spec(p.items!)}`;
    case 'object':
      return typeof p.additionalProperties === 'object'
        ? `{${spec(p.additionalProperties)}`
        : 'any';
    default:
      return 'any';
  }
}

function struct(id: string): number {
  const have = index.get(id);
  if (have !== undefined) return have;
  const i = structs.length;
  index.set(id, i);
  const entry: [string, Record<string, string>] = [`${pkg(id)}.${short(id)}`, {}];
  structs.push(entry);
  for (const [name, p] of Object.entries(defs[id]!.properties ?? {})) {
    const over = goTypes[`${short(id)}.${name}`];
    entry[1][name] = spec(p) + (over ? `|${over}` : '');
  }
  return i;
}

const roots: Record<string, number> = {};
for (const [key, id] of Object.entries(ROOTS)) roots[key] = struct(id);

// Go prints the package name only; make sure two structs never share a printed name by accident.
const names = new Map<string, string>();
for (const [id, i] of index) {
  const n = structs[i]![0];
  if (names.has(n) && names.get(n) !== id)
    throw new Error(`Struct name clash: ${n} (${names.get(n)} and ${id})`);
  names.set(n, id);
}

// --- Gateway API CRDs: OpenAPI v3 schema without descriptions ---
type V3 = {
  type?: string;
  properties?: Record<string, V3>;
  required?: string[];
  enum?: unknown[];
  items?: V3;
  additionalProperties?: V3 | boolean;
  'x-kubernetes-int-or-string'?: boolean;
  'x-kubernetes-preserve-unknown-fields'?: boolean;
  'x-kubernetes-validations'?: unknown[];
};
type Node = {
  t?: string;
  p?: Record<string, Node>;
  r?: string[];
  e?: unknown[];
  i?: Node;
  a?: Node | 1;
  x?: 1;
  u?: 1;
};
const found = { cel: false };
function node(s: V3): Node {
  const n: Node = {};
  if (s['x-kubernetes-validations']?.length) found.cel = true;
  if (s.type) n.t = s.type;
  if (s.properties)
    n.p = Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, node(v)]));
  if (s.required?.length) n.r = s.required;
  if (s.enum?.length) n.e = s.enum;
  if (s.items) n.i = node(s.items);
  if (s.additionalProperties === true) n.a = 1;
  else if (s.additionalProperties) n.a = node(s.additionalProperties);
  if (s['x-kubernetes-int-or-string']) n.x = 1;
  if (s['x-kubernetes-preserve-unknown-fields']) n.u = 1;
  return n;
}
const crds: Record<string, { cel: boolean; schema: Node }> = {};
for (const doc of parseAllDocuments(readFileSync(arg('gateway'), 'utf8'))) {
  const crd = doc.toJS() as {
    kind?: string;
    spec?: {
      group: string;
      names: { kind: string };
      versions: { name: string; served: boolean; schema: { openAPIV3Schema: V3 } }[];
    };
  };
  if (
    crd?.kind !== 'CustomResourceDefinition' ||
    !crd.spec ||
    !CRD_KINDS.includes(crd.spec.names.kind)
  )
    continue;
  for (const v of crd.spec.versions) {
    if (!v.served) continue;
    found.cel = false;
    const schema = node(v.schema.openAPIV3Schema);
    crds[`${crd.spec.group}/${v.name} ${crd.spec.names.kind}`] = { cel: found.cel, schema };
  }
}

const out = `// GENERATED by scripts/gen-k8s-schema — do not edit by hand.
// Kubernetes 1.37.2 (kubernetes-json-schema v1.37.2 + Go type names from a real kube-apiserver v1.37.2)
// and Gateway API v1.6.1 (standard channel CRDs).
//
// STRUCTS: [Go type name, { jsonField: spec }]. A spec is
//   s string · i32 / i64 integer · b bool · f number · q Quantity · ios IntOrString · time · by base64 bytes · any
//   [X list of X · {X map of X · #N struct N. "|T" at the end is the Go type the API server prints, when it differs.
// CRDS: OpenAPI v3 schemas without descriptions. t type · p properties · r required · e enum · i items
//   a additionalProperties · x int-or-string · u preserve unknown fields. cel: the schema has CEL rules.

export type CrdNode = { t?: string; p?: Record<string, CrdNode>; r?: string[]; e?: unknown[]; i?: CrdNode; a?: CrdNode | 1; x?: 1; u?: 1 };

export const K8S_VERSION = '1.37.2';
export const GATEWAY_API_VERSION = '1.6.1';

/** Every [apiVersion, kind, namespaced, plural] the API server serves. */
export const SERVED: [string, string, boolean, string][] = ${JSON.stringify(served)};

export const STRUCTS: [string, Record<string, string>][] = ${JSON.stringify(structs)};

/** "apiVersion Kind" → index in STRUCTS. */
export const ROOTS: Record<string, number> = ${JSON.stringify(roots)};

/** "apiVersion Kind" → CRD schema. */
export const CRDS: Record<string, { cel: boolean; schema: CrdNode }> = ${JSON.stringify(crds)};
`;
const target = join(here, '../../src/lib/k8sSchemaData.ts');
writeFileSync(target, out);
console.log(
  `✓ Wrote ${target}: ${structs.length} structs, ${Object.keys(crds).length} CRD versions, ${(out.length / 1024).toFixed(0)} KB`,
);
