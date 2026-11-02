// A small `kubectl apply` for YamlDoctor: what kubectl 1.37 prints for a manifest, without a cluster.
//
// Stages, in kubectl's order (each wording checked against kubectl + kube-apiserver v1.37.2):
//   1. YAML → JSON (go-yaml errors, see k8sYaml.ts)
//   2. apiVersion / kind set ("error validating data")
//   3. metadata decodes ("unable to decode")
//   4. the kind exists in that apiVersion ("resource mapping not found … ensure CRDs are installed first")
//   5. a name is set ("resource name may not be empty")
//   6. the API server decodes the object strictly (type errors, quantities, base64, unknown fields)
//   7. the API server validates it ("The Deployment "shop" is invalid: …")
// Kinds with a schema: core workloads, Service, ConfigMap, Secret, Job, CronJob, HPA, NetworkPolicy,
// RBAC, Gateway API (Gateway, GatewayClass, HTTPRoute, ReferenceGrant) and a few more. Single errors
// match kubectl exactly; several errors in one file are listed in a simpler way than kubectl does.
import { CRDS, ROOTS, SERVED, STRUCTS, type CrdNode } from './k8sSchemaData';
import { lineOfPath, parseYamlDoc, splitDocuments, type YamlErrorCode } from './k8sYaml';

import { parseQuantity } from './k8sQuantity';

export { selectorMismatchMessage } from './k8sMessages';
export { parseQuantity } from './k8sQuantity';

export type IssueCode =
  | `yaml.${YamlErrorCode}`
  | 'apiVersionMissing'
  | 'kindMissing'
  | 'noObjects'
  | 'noMatch'
  | 'nameEmpty'
  | 'nsMissing'
  | 'metadataType'
  | 'typeMismatch'
  | 'quantity'
  | 'base64'
  | 'unknownField'
  | 'kindCase'
  | 'required'
  | 'unsupported'
  | 'invalid'
  | 'duplicate'
  | 'forbidden'
  | 'selectorMismatch'
  | 'outOfRange'
  | 'nameFormat'
  | 'labelFormat'
  | 'cron';

export interface ApplyIssue {
  code: IssueCode;
  /** 1-based line in the file to point at. */
  line: number;
  /** Field path, e.g. spec.template.spec.containers[0].image (when there is one). */
  field?: string;
  /** Extra words for the plain-language line (the bad value, the field name…). */
  detail?: string;
  /** For noMatch: an apiVersion that does serve this kind (e.g. apps/v1). */
  suggest?: string;
}

export interface AppliedObject {
  apiVersion: string;
  kind: string;
  name: string;
  namespace?: string;
  value: Record<string, unknown>;
}

export interface ApplyResult {
  /** kubectl's exit code would be 0. */
  ok: boolean;
  /** Exactly what kubectl prints, line by line. */
  lines: { text: string; error: boolean }[];
  issues: ApplyIssue[];
  objects: AppliedObject[];
}

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
type Obj = { [k: string]: Json };
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

// --- Resource mapping ----------------------------------------------------------------------

interface Mapping {
  apiVersion: string;
  kind: string;
  namespaced: boolean;
  plural: string;
}
const served = new Map<string, Mapping>(
  SERVED.map(([apiVersion, kind, namespaced, plural]) => [
    `${apiVersion} ${kind}`,
    { apiVersion, kind, namespaced, plural },
  ]),
);

/** kubectl's REST mapper finds a kind in any letter case. */
function findMapping(apiVersion: string, kind: string): Mapping | undefined {
  const exact = served.get(`${apiVersion} ${kind}`);
  if (exact) return exact;
  for (const m of served.values())
    if (m.apiVersion === apiVersion && m.kind.toLowerCase() === kind.toLowerCase()) return m;
  return undefined;
}

/** The first (preferred) apiVersion that serves this kind, if any. */
export function servedVersion(kind: string): string | undefined {
  for (const m of served.values()) if (m.kind === kind) return m.apiVersion;
  return undefined;
}

const groupOf = (apiVersion: string) => (apiVersion.includes('/') ? apiVersion.split('/')[0]! : '');
const versionOf = (apiVersion: string) => apiVersion.split('/').pop()!;

/** "deployment.apps/shop", "pod/tray". */
export function resourceRef(apiVersion: string, kind: string, name: string): string {
  const g = groupOf(apiVersion);
  return `${kind.toLowerCase()}${g ? `.${g}` : ''}/${name}`;
}

// --- Go-style JSON decoding of built-in kinds ------------------------------------------------

type Struct = [string, Record<string, string>];
const structs = STRUCTS as Struct[];

function splitSpec(raw: string): { spec: string; go?: string } {
  const i = raw.indexOf('|');
  return i < 0 ? { spec: raw } : { spec: raw.slice(0, i), go: raw.slice(i + 1) };
}

function goName(spec: string): string {
  if (spec.startsWith('[')) return `[]${goName(spec.slice(1))}`;
  if (spec.startsWith('{')) return `map[string]${goName(spec.slice(1))}`;
  if (spec.startsWith('#')) return structs[Number(spec.slice(1))]![0];
  return (
    {
      s: 'string',
      i32: 'int32',
      i64: 'int64',
      b: 'bool',
      f: 'float64',
      q: 'resource.Quantity',
      ios: 'intstr.IntOrString',
      time: 'v1.Time',
      by: '[]uint8',
      any: 'interface {}',
    }[spec] ?? spec
  );
}

const jsonKind = (v: Json): string =>
  Array.isArray(v)
    ? 'array'
    : v === null
      ? 'null'
      : typeof v === 'object'
        ? 'object'
        : typeof v === 'boolean'
          ? 'bool'
          : typeof v === 'number'
            ? 'number'
            : 'string';

class HardError extends Error {}

interface DecodeState {
  typeError: string | null;
  typePath: (string | number)[] | null;
  unknown: { path: string; segs: (string | number)[] }[];
}

/** Go's base64.StdEncoding.DecodeString: the byte where decoding fails, or -1. */
export function base64ErrorAt(s: string): number {
  const ok = (c: string) => /[A-Za-z0-9+/]/.test(c);
  let si = 0;
  while (si < s.length) {
    let j = 0;
    for (; j < 4; j++) {
      if (si === s.length) {
        if (j === 0) return -1;
        return si - j;
      }
      const c = s[si++]!;
      if (c === '\n' || c === '\r') {
        j--;
        continue;
      }
      if (ok(c)) continue;
      if (c !== '=') return si - 1;
      // Padding.
      if (j < 2) return si - 1;
      if (j === 2) {
        while (si < s.length && (s[si] === '\n' || s[si] === '\r')) si++;
        if (si === s.length) return s.length;
        if (s[si] !== '=') return si - 1;
        si++;
      }
      while (si < s.length && (s[si] === '\n' || s[si] === '\r')) si++;
      return si < s.length ? si : -1;
    }
  }
  return -1;
}

function decodeValue(
  v: Json,
  rawSpec: string,
  owner: string,
  path: (string | number)[],
  st: DecodeState,
) {
  if (v === null) return;
  const { spec, go } = splitSpec(rawSpec);
  const goType = go ?? goName(spec);
  const named = path.filter((p) => typeof p === 'string').join('.');
  const typeErr = (kind: string, as = goType) => {
    if (st.typeError) return;
    st.typeError = `json: cannot unmarshal ${kind} into Go struct field ${owner}.${named} of type ${as}`;
    st.typePath = path;
  };
  switch (spec) {
    case 's':
    case 'time':
      if (typeof v !== 'string') typeErr(jsonKind(v));
      return;
    case 'i32':
    case 'i64': {
      if (typeof v !== 'number') return typeErr(jsonKind(v));
      const max = spec === 'i32' ? 2 ** 31 : 2 ** 63;
      if (!Number.isInteger(v) || v >= max || v < -max) typeErr(`number ${v}`);
      return;
    }
    case 'b':
      if (typeof v !== 'boolean') typeErr(jsonKind(v));
      return;
    case 'f':
      if (typeof v !== 'number') typeErr(jsonKind(v));
      return;
    case 'q': {
      const q = parseQuantity(
        typeof v === 'number' ? v : typeof v === 'string' ? v : JSON.stringify(v),
      );
      if ('error' in q) throw new HardError(q.error);
      return;
    }
    case 'ios':
      if (typeof v === 'string') return;
      if (typeof v !== 'number') return typeErr(jsonKind(v));
      if (!Number.isInteger(v)) typeErr(`number ${v}`);
      return;
    case 'by': {
      if (typeof v !== 'string') return typeErr(jsonKind(v));
      const at = base64ErrorAt(v);
      if (at >= 0) throw new HardError(`illegal base64 data at input byte ${at}`);
      return;
    }
    case 'any':
      return;
  }
  if (spec.startsWith('[')) {
    if (!Array.isArray(v)) return typeErr(jsonKind(v));
    const el = spec.slice(1);
    const elGo = goType.startsWith('[]') ? goType.slice(2) : goName(el);
    v.forEach((item, i) => decodeValue(item, `${el}|${elGo}`, owner, [...path, i], st));
    return;
  }
  if (spec.startsWith('{')) {
    if (!isObj(v)) return typeErr(jsonKind(v));
    const el = spec.slice(1);
    const elGo = goType.startsWith('map[string]') ? goType.slice('map[string]'.length) : goName(el);
    for (const k of Object.keys(v).sort()) decodeValue(v[k]!, `${el}|${elGo}`, owner, path, st);
    return;
  }
  if (spec.startsWith('#')) {
    if (!isObj(v)) return typeErr(jsonKind(v));
    decodeStruct(v, Number(spec.slice(1)), path, st);
  }
}

function decodeStruct(v: Obj, index: number, path: (string | number)[], st: DecodeState) {
  const [go, fields] = structs[index]!;
  const owner = go.split('.').pop()!;
  for (const k of Object.keys(v).sort()) {
    const f = fields[k];
    if (f === undefined) {
      st.unknown.push({ path: fieldPath([...path, k]), segs: [...path, k] });
      continue;
    }
    decodeValue(v[k]!, f, owner, [...path, k], st);
  }
}

/** "spec.containers[0].image" */
export function fieldPath(segs: (string | number)[]): string {
  return segs.map((s, i) => (typeof s === 'number' ? `[${s}]` : i === 0 ? s : `.${s}`)).join('');
}

// --- Validation helpers (messages as kube-apiserver 1.37 prints them) -------------------------

interface FieldErr {
  text: string;
  code: IssueCode;
  segs: (string | number)[];
  detail?: string;
}

/** How field.Invalid prints a value. */
function show(v: unknown): string {
  if (typeof v === 'string') return JSON.stringify(v);
  if (v === undefined) return 'null';
  if (isObj(v))
    return JSON.stringify(
      Object.fromEntries(
        Object.keys(v)
          .sort()
          .map((k) => [k, v[k]]),
      ),
    );
  return JSON.stringify(v);
}

const required = (segs: (string | number)[], detail = ''): FieldErr => ({
  text: `${fieldPath(segs)}: Required value${detail ? `: ${detail}` : ''}`,
  code: 'required',
  segs,
});
const invalid = (
  segs: (string | number)[],
  value: unknown,
  detail: string,
  code: IssueCode = 'invalid',
): FieldErr => ({
  text: `${fieldPath(segs)}: Invalid value: ${show(value)}: ${detail}`,
  code,
  segs,
  detail: typeof value === 'string' || typeof value === 'number' ? String(value) : undefined,
});
const unsupported = (segs: (string | number)[], value: unknown, allowed: string[]): FieldErr => ({
  text: `${fieldPath(segs)}: Unsupported value: ${show(value ?? '')}: supported values: ${allowed.map((a) => JSON.stringify(a)).join(', ')}`,
  code: 'unsupported',
  segs,
  detail: String(value ?? ''),
});

const SUBDOMAIN_RE = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/;
const LABEL_RE = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;
const SUBDOMAIN_MSG =
  "a lowercase RFC 1123 subdomain must consist of lower case alphanumeric characters, '-' or '.', and must start and end with an alphanumeric character (e.g. 'example.com', regex used for validation is '[a-z0-9]([-a-z0-9]*[a-z0-9])?(\\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*')";
const DNS_LABEL_MSG =
  "a lowercase RFC 1123 label must consist of lower case alphanumeric characters or '-', and must start and end with an alphanumeric character (e.g. 'my-name',  or '123-abc', regex used for validation is '[a-z0-9]([-a-z0-9]*[a-z0-9])?')";
const LABEL_VALUE_MSG =
  "a valid label must be an empty string or consist of alphanumeric characters, '-', '_' or '.', and must start and end with an alphanumeric character (e.g. 'MyValue',  or 'my_value',  or '12345', regex used for validation is '(([A-Za-z0-9][-A-Za-z0-9_.]*)?[A-Za-z0-9])?')";
const LABEL_NAME_MSG =
  "name part must consist of alphanumeric characters, '-', '_' or '.', and must start and end with an alphanumeric character (e.g. 'MyName',  or 'my.name',  or '123-abc', regex used for validation is '([A-Za-z0-9][-A-Za-z0-9_.]*)?[A-Za-z0-9]')";
const CONFIG_KEY_MSG =
  "a valid config key must consist of alphanumeric characters, '-', '_' or '.' (e.g. 'key.name',  or 'KEY_NAME',  or 'key-name', regex used for validation is '[-._a-zA-Z0-9]+')";
const PORT_RANGE = 'must be between 1 and 65535, inclusive';

function dnsSubdomain(
  v: string,
  segs: (string | number)[],
  code: IssueCode = 'nameFormat',
): FieldErr[] {
  if (v.length > 253) return [invalid(segs, v, 'must be no more than 253 characters', code)];
  return SUBDOMAIN_RE.test(v) ? [] : [invalid(segs, v, SUBDOMAIN_MSG, code)];
}
function dnsLabel(
  v: string,
  segs: (string | number)[],
  code: IssueCode = 'nameFormat',
): FieldErr[] {
  if (v.length > 63) return [invalid(segs, v, 'must be no more than 63 characters', code)];
  return LABEL_RE.test(v) ? [] : [invalid(segs, v, DNS_LABEL_MSG, code)];
}

/** metav1validation.ValidateLabels: keys, then values. */
function labelErrors(labels: Json | undefined, segs: (string | number)[]): FieldErr[] {
  if (!isObj(labels)) return [];
  const out: FieldErr[] = [];
  for (const k of Object.keys(labels).sort()) {
    const parts = k.split('/');
    const name = parts.length === 2 ? parts[1]! : k;
    if (parts.length > 2)
      out.push(
        invalid(
          segs,
          k,
          "a qualified name must consist of alphanumeric characters, '-', '_' or '.', and must start and end with an alphanumeric character (e.g. 'MyName',  or 'my.name',  or '123-abc', regex used for validation is '([A-Za-z0-9][-A-Za-z0-9_.]*)?[A-Za-z0-9]') with an optional DNS subdomain prefix and '/' (e.g. 'example.com/MyName')",
          'labelFormat',
        ),
      );
    else {
      if (parts.length === 2 && !SUBDOMAIN_RE.test(parts[0]!))
        out.push(invalid(segs, k, `prefix part ${SUBDOMAIN_MSG}`, 'labelFormat'));
      if (!name) out.push(invalid(segs, k, 'name part must be non-empty', 'labelFormat'));
      else if (name.length > 63)
        out.push(invalid(segs, k, 'name part must be no more than 63 characters', 'labelFormat'));
      else if (!/^([A-Za-z0-9][-A-Za-z0-9_.]*)?[A-Za-z0-9]$/.test(name))
        out.push(invalid(segs, k, LABEL_NAME_MSG, 'labelFormat'));
    }
  }
  for (const k of Object.keys(labels).sort()) {
    const v = labels[k];
    if (typeof v !== 'string') continue;
    if (v.length > 63)
      out.push(invalid(segs, v, 'must be no more than 63 characters', 'labelFormat'));
    else if (!/^(([A-Za-z0-9][-A-Za-z0-9_.]*)?[A-Za-z0-9])?$/.test(v))
      out.push(invalid(segs, v, LABEL_VALUE_MSG, 'labelFormat'));
  }
  return out;
}

const NAME_LABEL_KINDS = new Set(['Service', 'Namespace']);
const RBAC_KINDS = new Set(['Role', 'RoleBinding', 'ClusterRole', 'ClusterRoleBinding']);

function metaErrors(kind: string, meta: Obj): FieldErr[] {
  const out: FieldErr[] = [];
  const name = typeof meta.name === 'string' ? meta.name : '';
  if (name) {
    if (RBAC_KINDS.has(kind)) {
      if (name === '.' || name === '..')
        out.push(invalid(['metadata', 'name'], name, `may not be '${name}'`, 'nameFormat'));
      for (const bad of ['/', '%'])
        if (name.includes(bad))
          out.push(invalid(['metadata', 'name'], name, `may not contain '${bad}'`, 'nameFormat'));
    } else if (NAME_LABEL_KINDS.has(kind)) out.push(...dnsLabel(name, ['metadata', 'name']));
    else {
      out.push(...dnsSubdomain(name, ['metadata', 'name']));
      if (kind === 'CronJob' && name.length > 52 && !out.length)
        out.push(
          invalid(['metadata', 'name'], name, 'must be no more than 52 characters', 'nameFormat'),
        );
    }
  }
  if (typeof meta.namespace === 'string' && meta.namespace)
    out.push(...dnsLabel(meta.namespace, ['metadata', 'namespace']));
  out.push(...labelErrors(meta.labels, ['metadata', 'labels']));
  return out;
}

const arr = (v: Json | undefined): Json[] => (Array.isArray(v) ? v : []);
const str = (v: Json | undefined): string => (typeof v === 'string' ? v : '');
const num = (v: Json | undefined): number | undefined => (typeof v === 'number' ? v : undefined);

/** A Service port: a missing port counts as 0. */
function portRange(v: Json | undefined, segs: (string | number)[]): FieldErr[] {
  const n = v === undefined || v === null ? 0 : v;
  if (typeof n === 'number' && (n < 1 || n > 65535))
    return [invalid(segs, n, PORT_RANGE, 'outOfRange')];
  return [];
}

/** IANA service name rules for a named port. */
function portNameErrors(v: string): string[] {
  const out: string[] = [];
  if (v.length > 15) out.push('must be no more than 15 characters');
  if (!/^[-a-z0-9]+$/.test(v))
    out.push('must contain only alpha-numeric characters (a-z, 0-9), and hyphens (-)');
  if (!/[a-z]/.test(v)) out.push('must contain at least one letter (a-z)');
  if (v.includes('--')) out.push('must not contain consecutive hyphens');
  if (/^-|-$/.test(v)) out.push('must not begin or end with a hyphen');
  return out;
}

/** Canonical-ish quantity text, as the API server prints it in messages. */
function showQuantity(v: Json | undefined): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : `${Math.round(v * 1000)}m`;
  return '';
}

function containerErrors(list: Json | undefined, segs: (string | number)[]): FieldErr[] {
  const out: FieldErr[] = [];
  const names = new Set<string>();
  arr(list).forEach((c, i) => {
    if (!isObj(c)) return;
    const at = [...segs, i];
    const name = str(c.name);
    if (!name) out.push(required([...at, 'name']));
    else out.push(...dnsLabel(name, [...at, 'name']));
    if (name && names.has(name))
      out.push({
        text: `${fieldPath([...at, 'name'])}: Duplicate value: ${JSON.stringify(name)}`,
        code: 'duplicate',
        segs: [...at, 'name'],
        detail: name,
      });
    names.add(name);
    if (!str(c.image)) out.push(required([...at, 'image']));
    arr(c.ports).forEach((p, j) => {
      if (!isObj(p)) return;
      const ps = [...at, 'ports', j];
      const cp = p.containerPort;
      if (cp === undefined || cp === null || cp === 0) out.push(required([...ps, 'containerPort']));
      else if (typeof cp === 'number' && (cp < 1 || cp > 65535))
        out.push(invalid([...ps, 'containerPort'], cp, PORT_RANGE, 'outOfRange'));
      if (
        p.protocol !== undefined &&
        p.protocol !== null &&
        !['SCTP', 'TCP', 'UDP'].includes(str(p.protocol))
      )
        out.push(unsupported([...ps, 'protocol'], p.protocol, ['SCTP', 'TCP', 'UDP']));
    });
    arr(c.env).forEach((e, j) => {
      if (isObj(e) && !str(e.name)) out.push(required([...at, 'env', j, 'name']));
    });
    const res = isObj(c.resources) ? c.resources : {};
    const req = isObj(res.requests) ? res.requests : {};
    const lim = isObj(res.limits) ? res.limits : {};
    for (const r of Object.keys(req).sort()) {
      if (lim[r] === undefined) continue;
      const a = parseQuantity(req[r] as string | number);
      const b = parseQuantity(lim[r] as string | number);
      if ('value' in a && 'value' in b && a.value > b.value) {
        out.push(
          invalid(
            [...at, 'resources', 'requests'],
            showQuantity(req[r]),
            `must be less than or equal to ${r} limit of ${showQuantity(lim[r])}`,
          ),
        );
      }
    }
    if (
      c.imagePullPolicy !== undefined &&
      c.imagePullPolicy !== null &&
      !['Always', 'IfNotPresent', 'Never'].includes(str(c.imagePullPolicy))
    )
      out.push(
        unsupported([...at, 'imagePullPolicy'], c.imagePullPolicy, [
          'Always',
          'IfNotPresent',
          'Never',
        ]),
      );
  });
  return out;
}

function podSpecErrors(spec: Json | undefined, segs: (string | number)[]): FieldErr[] {
  if (!isObj(spec)) return [required([...segs, 'containers'])];
  const out: FieldErr[] = [];
  if (!arr(spec.containers).length) out.push(required([...segs, 'containers']));
  out.push(...containerErrors(spec.containers, [...segs, 'containers']));
  out.push(...containerErrors(spec.initContainers, [...segs, 'initContainers']));
  const rp = spec.restartPolicy;
  if (rp !== undefined && rp !== null && !['Always', 'OnFailure', 'Never'].includes(str(rp)))
    out.push(unsupported([...segs, 'restartPolicy'], rp, ['Always', 'OnFailure', 'Never']));
  return out;
}

/** Does a LabelSelector match these labels? (matchLabels and matchExpressions) */
export function selectorMatches(
  selector: Json | undefined,
  labels: Record<string, Json> | undefined,
): boolean {
  if (!isObj(selector)) return false;
  const l = labels ?? {};
  const ml = isObj(selector.matchLabels) ? selector.matchLabels : {};
  for (const [k, v] of Object.entries(ml)) if (l[k] !== v) return false;
  for (const e of arr(selector.matchExpressions)) {
    if (!isObj(e)) continue;
    const key = str(e.key);
    const values = arr(e.values).map(String);
    const has = key in l;
    switch (str(e.operator)) {
      case 'In':
        if (!has || !values.includes(String(l[key]))) return false;
        break;
      case 'NotIn':
        if (has && values.includes(String(l[key]))) return false;
        break;
      case 'Exists':
        if (!has) return false;
        break;
      case 'DoesNotExist':
        if (has) return false;
        break;
    }
  }
  return true;
}

const SELECTOR_MSG = '`selector` does not match template `labels`';

function templateErrors(
  spec: Obj,
  segs: (string | number)[],
  opts: { selector?: boolean; restart?: 'always' | 'job' },
): FieldErr[] {
  const out: FieldErr[] = [];
  const tmpl = isObj(spec.template) ? spec.template : {};
  const tmeta = isObj(tmpl.metadata) ? tmpl.metadata : {};
  const tlabels = isObj(tmeta.labels) ? tmeta.labels : {};
  if (opts.selector) {
    const sel = spec.selector;
    const empty =
      isObj(sel) &&
      !Object.keys(isObj(sel.matchLabels) ? sel.matchLabels : {}).length &&
      !arr(sel.matchExpressions).length;
    if (!empty && !selectorMatches(sel, tlabels))
      out.push({
        ...invalid([...segs, 'metadata', 'labels'], tlabels, SELECTOR_MSG, 'selectorMismatch'),
      });
  }
  out.push(...labelErrors(tmeta.labels, [...segs, 'labels']));
  out.push(...podSpecErrors(tmpl.spec, [...segs, 'spec']));
  const tspec = isObj(tmpl.spec) ? tmpl.spec : {};
  const rp = str(tspec.restartPolicy);
  if (opts.restart === 'always' && rp && rp !== 'Always' && ['OnFailure', 'Never'].includes(rp))
    out.push(unsupported([...segs, 'spec', 'restartPolicy'], rp, ['Always']));
  if (opts.restart === 'job' && rp !== 'OnFailure' && rp !== 'Never')
    out.push(required([...segs, 'spec', 'restartPolicy'], 'valid values: "OnFailure", "Never"'));
  return out;
}

const CRON_FIELDS: [string, number, number, Record<string, number>?][] = [
  ['minute', 0, 59],
  ['hour', 0, 23],
  ['day of month', 1, 31],
  [
    'month',
    1,
    12,
    {
      jan: 1,
      feb: 2,
      mar: 3,
      apr: 4,
      may: 5,
      jun: 6,
      jul: 7,
      aug: 8,
      sep: 9,
      oct: 10,
      nov: 11,
      dec: 12,
    },
  ],
  ['day of week', 0, 6, { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 }],
];

/** robfig/cron's standard parser (what CronJob uses): the error text, or null. */
export function cronError(schedule: string): string | null {
  const s = schedule.trim();
  if (s.startsWith('@')) {
    if (
      ['@yearly', '@annually', '@monthly', '@weekly', '@daily', '@midnight', '@hourly'].includes(s)
    )
      return null;
    if (s.startsWith('@every '))
      return /^@every (\d+(\.\d+)?(ns|us|µs|ms|s|m|h))+$/.test(s)
        ? null
        : `failed to parse duration ${s}: time: invalid duration "${s.slice(7)}"`;
    return `unrecognized descriptor: ${s}`;
  }
  const fields = s.split(/\s+/).filter(Boolean);
  if (fields.length !== 5)
    return `expected exactly 5 fields, found ${fields.length}: [${fields.join(' ')}]`;
  for (let f = 0; f < 5; f++) {
    const [, min, max, names] = CRON_FIELDS[f]!;
    for (const part of fields[f]!.split(',')) {
      const [range, step] = part.split('/');
      if (step !== undefined && !/^\d+$/.test(step))
        return `failed to parse int from ${step}: strconv.Atoi: parsing ${JSON.stringify(step)}: invalid syntax`;
      if (range === '*' || range === '?') continue;
      const ends = range!.split('-');
      if (ends.length > 2) return `too many hyphens: ${part}`;
      const vals: number[] = [];
      for (const e of ends) {
        const named = names?.[e.toLowerCase()];
        if (named !== undefined) vals.push(named);
        else if (/^\d+$/.test(e)) vals.push(Number(e));
        else
          return `failed to parse int from ${e}: strconv.Atoi: parsing ${JSON.stringify(e)}: invalid syntax`;
      }
      const start = vals[0]!;
      const end = vals[1] ?? start;
      if (start < min) return `beginning of range (${start}) below minimum (${min}): ${part}`;
      if (end > max) return `end of range (${end}) above maximum (${max}): ${part}`;
      if (start > end) return `beginning of range (${start}) beyond end of range (${end}): ${part}`;
      if (step === '0') return `step of range should be a positive number: ${part}`;
    }
  }
  return null;
}

function kindErrors(kind: string, o: Obj): FieldErr[] {
  const spec = isObj(o.spec) ? o.spec : {};
  const out: FieldErr[] = [];
  switch (kind) {
    case 'Pod':
      out.push(...podSpecErrors(o.spec, ['spec']));
      break;
    case 'Deployment':
    case 'ReplicaSet':
    case 'StatefulSet':
    case 'DaemonSet': {
      const r = num(spec.replicas);
      if (r !== undefined && r < 0)
        out.push(
          invalid(['spec', 'replicas'], r, 'must be greater than or equal to 0', 'outOfRange'),
        );
      const sel = spec.selector;
      if (sel === undefined || sel === null) out.push(required(['spec', 'selector']));
      // The API server prints the selector with empty parts left out.
      else if (
        isObj(sel) &&
        !Object.keys(isObj(sel.matchLabels) ? sel.matchLabels : {}).length &&
        !arr(sel.matchExpressions).length
      )
        out.push(
          invalid(['spec', 'selector'], {}, `empty selector is invalid for ${kind.toLowerCase()}`),
        );
      out.push(
        ...templateErrors(spec, ['spec', 'template'], { selector: true, restart: 'always' }),
      );
      if (
        kind === 'Deployment' &&
        isObj(spec.strategy) &&
        spec.strategy.type !== undefined &&
        !['Recreate', 'RollingUpdate'].includes(str(spec.strategy.type))
      ) {
        out.push({
          text: `spec.strategy: Unsupported value: {"Type":${JSON.stringify(str(spec.strategy.type))},"RollingUpdate":null}: supported values: "Recreate", "RollingUpdate"`,
          code: 'unsupported',
          segs: ['spec', 'strategy', 'type'],
          detail: str(spec.strategy.type),
        });
      }
      break;
    }
    case 'Job':
      out.push(...templateErrors(spec, ['spec', 'template'], { restart: 'job' }));
      break;
    case 'CronJob': {
      if (!str(spec.schedule)) out.push(required(['spec', 'schedule']));
      else {
        const e = cronError(str(spec.schedule));
        if (e) out.push(invalid(['spec', 'schedule'], spec.schedule, e, 'cron'));
      }
      const jt = isObj(spec.jobTemplate) ? spec.jobTemplate : {};
      const js = isObj(jt.spec) ? jt.spec : {};
      out.push(
        ...templateErrors(js, ['spec', 'jobTemplate', 'spec', 'template'], { restart: 'job' }),
      );
      break;
    }
    case 'Service': {
      const type = spec.type === undefined || spec.type === null ? 'ClusterIP' : str(spec.type);
      const ports = arr(spec.ports);
      const headless = spec.clusterIP === 'None';
      if (!ports.length && !headless && type !== 'ExternalName')
        out.push(required(['spec', 'ports']));
      ports.forEach((p, i) => {
        if (!isObj(p)) return;
        const at = ['spec', 'ports', i];
        if (ports.length > 1 && !str(p.name)) out.push(required([...at, 'name']));
        if (
          p.protocol !== undefined &&
          p.protocol !== null &&
          !['SCTP', 'TCP', 'UDP'].includes(str(p.protocol))
        )
          out.push(unsupported([...at, 'protocol'], p.protocol, ['SCTP', 'TCP', 'UDP']));
        out.push(...portRange(p.port, [...at, 'port']));
        const tp = p.targetPort;
        if (typeof tp === 'number' && tp !== 0 && (tp < 1 || tp > 65535))
          out.push(invalid([...at, 'targetPort'], tp, PORT_RANGE, 'outOfRange'));
        if (typeof tp === 'string') {
          const msgs = portNameErrors(tp);
          if (msgs.length) out.push(invalid([...at, 'targetPort'], tp, msgs.join(', ')));
        }
      });
      if (!['ClusterIP', 'ExternalName', 'LoadBalancer', 'NodePort'].includes(type))
        out.push(
          unsupported(['spec', 'type'], spec.type, [
            'ClusterIP',
            'ExternalName',
            'LoadBalancer',
            'NodePort',
          ]),
        );
      break;
    }
    case 'ConfigMap':
    case 'Secret':
      for (const field of ['data', ...(kind === 'ConfigMap' ? ['binaryData'] : ['stringData'])]) {
        const d = o[field];
        if (!isObj(d)) continue;
        for (const k of Object.keys(d).sort())
          if (!/^[-._a-zA-Z0-9]+$/.test(k))
            out.push({
              text: `${field}[${k}]: Invalid value: ${JSON.stringify(k)}: ${CONFIG_KEY_MSG}`,
              code: 'invalid',
              segs: [field, k],
              detail: k,
            });
      }
      break;
    case 'HorizontalPodAutoscaler': {
      const ref = isObj(spec.scaleTargetRef) ? spec.scaleTargetRef : {};
      if (!str(ref.kind)) out.push(required(['spec', 'scaleTargetRef', 'kind']));
      if (!str(ref.name)) out.push(required(['spec', 'scaleTargetRef', 'name']));
      const min = num(spec.minReplicas) ?? 1;
      const max = num(spec.maxReplicas) ?? 0;
      if (max < min)
        out.push(
          invalid(
            ['spec', 'maxReplicas'],
            max,
            'must be greater than or equal to `minReplicas`',
            'outOfRange',
          ),
        );
      if (!max) out.push(required(['spec', 'maxReplicas']));
      if (
        min === 0 &&
        !arr(spec.metrics).some((m) => isObj(m) && ['Object', 'External'].includes(str(m.type)))
      )
        out.push({
          text: 'spec.metrics: Forbidden: must specify at least one Object or External metric to support scaling to zero replicas',
          code: 'forbidden',
          segs: ['spec', 'minReplicas'],
        });
      break;
    }
    case 'NetworkPolicy':
      for (const dir of ['ingress', 'egress'] as const) {
        arr(spec[dir]).forEach((r, i) => {
          if (!isObj(r)) return;
          arr(r.ports).forEach((p, j) => {
            if (isObj(p) && typeof p.port === 'number' && (p.port < 1 || p.port > 65535))
              out.push(
                invalid(['spec', dir, i, 'ports', j, 'port'], p.port, PORT_RANGE, 'outOfRange'),
              );
          });
        });
      }
      arr(spec.policyTypes).forEach((t, i) => {
        if (!['Ingress', 'Egress'].includes(str(t)))
          out.push(unsupported(['spec', 'policyTypes', i], t, ['Ingress', 'Egress']));
      });
      break;
    case 'Role':
    case 'ClusterRole':
      arr(o.rules).forEach((r, i) => {
        if (!isObj(r)) return;
        if (!arr(r.verbs).length) out.push(required(['rules', i, 'verbs']));
        if (!arr(r.nonResourceURLs).length) {
          if (!arr(r.apiGroups).length)
            out.push(
              required(
                ['rules', i, 'apiGroups'],
                'resource rules must supply at least one api group',
              ),
            );
          if (!arr(r.resources).length)
            out.push(
              required(
                ['rules', i, 'resources'],
                'resource rules must supply at least one resource',
              ),
            );
        }
      });
      break;
    case 'RoleBinding':
    case 'ClusterRoleBinding': {
      const ref = isObj(o.roleRef) ? o.roleRef : {};
      const kinds = kind === 'RoleBinding' ? ['Role', 'ClusterRole'] : ['ClusterRole'];
      if (!kinds.includes(str(ref.kind)))
        out.push(unsupported(['roleRef', 'kind'], str(ref.kind), kinds));
      if (!str(ref.name)) out.push(required(['roleRef', 'name']));
      arr(o.subjects).forEach((s, i) => {
        if (!isObj(s)) return;
        if (!['ServiceAccount', 'User', 'Group'].includes(str(s.kind)))
          out.push(
            unsupported(['subjects', i, 'kind'], str(s.kind), ['ServiceAccount', 'User', 'Group']),
          );
        if (!str(s.name)) out.push(required(['subjects', i, 'name']));
        if (s.kind === 'ServiceAccount' && kind === 'ClusterRoleBinding' && !str(s.namespace))
          out.push(required(['subjects', i, 'namespace']));
      });
      break;
    }
  }
  return out;
}

// --- CRDs (Gateway API): OpenAPI v3 checks plus the CEL rules lessons meet -----------------------

function crdType(v: Json): string {
  if (Array.isArray(v)) return 'array';
  if (v === null) return 'null';
  if (typeof v === 'object') return 'object';
  if (typeof v === 'boolean') return 'boolean';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return 'string';
}

function crdUnknown(
  v: Json,
  n: CrdNode,
  segs: (string | number)[],
  out: { path: string; segs: (string | number)[] }[],
) {
  if (n.u) return;
  if (isObj(v) && n.p) {
    for (const k of Object.keys(v).sort()) {
      if (segs.length === 0 && (k === 'apiVersion' || k === 'kind' || k === 'metadata')) continue;
      const child = n.p[k];
      if (!child) {
        if (!n.a) out.push({ path: fieldPath([...segs, k]), segs: [...segs, k] });
        continue;
      }
      crdUnknown(v[k]!, child, [...segs, k], out);
    }
  } else if (Array.isArray(v) && n.i) v.forEach((x, i) => crdUnknown(x, n.i!, [...segs, i], out));
}

function crdSchemaErrors(v: Json, n: CrdNode, segs: (string | number)[], out: FieldErr[]) {
  if (v === null) return;
  const path = fieldPath(segs);
  const t = crdType(v);
  if (n.t && !(n.x && (t === 'integer' || t === 'string'))) {
    const fits = n.t === t || (n.t === 'number' && t === 'integer');
    if (!fits) {
      out.push({
        text: `${path}: Invalid value: ${JSON.stringify(t)}: ${path} in body must be of type ${n.t}: ${JSON.stringify(t)}`,
        code: 'typeMismatch',
        segs,
        detail: n.t,
      });
      return;
    }
  }
  if (n.e && !n.e.includes(v)) out.push(unsupported(segs, v, n.e.map(String)));
  if (isObj(v)) {
    for (const k of Object.keys(v).sort()) {
      if (segs.length === 0 && (k === 'apiVersion' || k === 'kind' || k === 'metadata')) continue;
      const child = n.p?.[k] ?? (typeof n.a === 'object' ? n.a : undefined);
      if (child) crdSchemaErrors(v[k]!, child, [...segs, k], out);
    }
    for (const r of n.r ?? [])
      if (v[r] === undefined || v[r] === null) out.push(required([...segs, r]));
  } else if (Array.isArray(v) && n.i)
    v.forEach((x, i) => crdSchemaErrors(x, n.i!, [...segs, i], out));
}

function crdCelErrors(kind: string, o: Obj): FieldErr[] {
  const out: FieldErr[] = [];
  if (kind !== 'HTTPRoute') return out;
  const spec = isObj(o.spec) ? o.spec : {};
  arr(spec.rules).forEach((r, i) => {
    if (!isObj(r)) return;
    arr(r.backendRefs).forEach((b, j) => {
      if (!isObj(b)) return;
      const isService =
        (b.group === undefined || b.group === '') && (b.kind === undefined || b.kind === 'Service');
      if (isService && (b.port === undefined || b.port === null))
        out.push({
          text: `spec.rules[${i}].backendRefs[${j}]: Invalid value: Must have port for Service reference`,
          code: 'required',
          segs: ['spec', 'rules', i, 'backendRefs', j],
          detail: 'port',
        });
    });
    arr(r.matches).forEach((m, j) => {
      if (!isObj(m) || !isObj(m.path)) return;
      const type = m.path.type ?? 'PathPrefix';
      const value = str(m.path.value);
      if (
        (type === 'Exact' || type === 'PathPrefix') &&
        m.path.value !== undefined &&
        !value.startsWith('/')
      ) {
        out.push({
          text: `spec.rules[${i}].matches[${j}].path: Invalid value: value must be an absolute path and start with '/' when type one of ['Exact', 'PathPrefix']`,
          code: 'invalid',
          segs: ['spec', 'rules', i, 'matches', j, 'path', 'value'],
          detail: value,
        });
      }
    });
  });
  return out;
}

// --- kubectl apply ------------------------------------------------------------------------

interface DocResult {
  created?: string;
  /** Error text and whether it is printed with the "error: " prefix when alone. */
  error?: { text: string; client: boolean; fatal: boolean };
  issue?: ApplyIssue;
  object?: AppliedObject;
}

const NOT_CHECKED =
  '<nil>: Invalid value: null: some validation rules were not checked because the object was invalid; correct the existing errors to complete validation';

function invalidText(kind: string, name: string, errs: string[]): string {
  return errs.length === 1
    ? `The ${kind} ${JSON.stringify(name)} is invalid: ${errs[0]}`
    : `The ${kind} ${JSON.stringify(name)} is invalid: \n${errs.map((e) => `* ${e}`).join('\n')}`;
}

function applyDoc(
  text: string,
  startLine: number,
  file: string,
  defaultNs: string,
  namespaces: Set<string>,
): DocResult {
  const parsed = parseYamlDoc(text);
  if (!parsed.ok) {
    const p = parsed.problem;
    return {
      error: {
        text: `error parsing ${file}: error converting YAML to JSON: yaml: line ${p.goLine}: ${p.message}`,
        client: true,
        fatal: true,
      },
      issue: { code: `yaml.${p.code}`, line: startLine + p.line - 1 },
    };
  }
  const { value, doc } = parsed.parsed;
  const at = (segs: (string | number)[]) => startLine + lineOfPath(doc, text, segs) - 1;
  if (!isObj(value)) {
    return {
      error: {
        text: `error validating "${file}": error validating data: [apiVersion not set, kind not set]; if you choose to ignore these errors, turn validation off with --validate=false`,
        client: true,
        fatal: true,
      },
      issue: { code: 'apiVersionMissing', line: startLine },
    };
  }
  const o = value as Obj;
  const apiVersion =
    o.apiVersion === undefined || o.apiVersion === null ? '' : String(o.apiVersion);
  const kind = o.kind === undefined || o.kind === null ? '' : String(o.kind);
  if (!apiVersion || !kind) {
    const missing = [!apiVersion && 'apiVersion not set', !kind && 'kind not set'].filter(
      Boolean,
    ) as string[];
    const what = missing.length > 1 ? `[${missing.join(', ')}]` : missing[0]!;
    return {
      error: {
        text: `error validating "${file}": error validating data: ${what}; if you choose to ignore these errors, turn validation off with --validate=false`,
        client: true,
        fatal: true,
      },
      issue: { code: !apiVersion ? 'apiVersionMissing' : 'kindMissing', line: startLine },
    };
  }
  // Client-side: metadata must decode.
  const metaState: DecodeState = { typeError: null, typePath: null, unknown: [] };
  const metaIndex =
    ROOTS['v1 Pod'] !== undefined
      ? Number(splitSpec(structs[ROOTS['v1 Pod']]![1].metadata!).spec.slice(1))
      : -1;
  if (o.metadata !== undefined && o.metadata !== null) {
    if (!isObj(o.metadata))
      metaState.typeError = `json: cannot unmarshal ${jsonKind(o.metadata)} into Go struct field metadataOnlyObject.metadata of type v1.ObjectMeta`;
    else if (metaIndex >= 0) {
      try {
        decodeStruct(o.metadata, metaIndex, ['metadata'], metaState);
      } catch {
        // Hard errors in metadata show up on the server instead.
      }
    }
  }
  if (metaState.typeError) {
    return {
      error: {
        text: `unable to decode "${file}": ${metaState.typeError}`,
        client: true,
        fatal: false,
      },
      issue: {
        code: 'metadataType',
        line: at(metaState.typePath ?? ['metadata']),
        field: 'metadata',
      },
    };
  }
  const meta = isObj(o.metadata) ? o.metadata : {};
  const name = str(meta.name);
  const ns = str(meta.namespace);
  const mapping = findMapping(apiVersion, kind);
  if (!mapping) {
    return {
      error: {
        text: `resource mapping not found for name: ${JSON.stringify(name)} namespace: ${JSON.stringify(ns)} from ${JSON.stringify(file)}: no matches for kind ${JSON.stringify(kind)} in version ${JSON.stringify(apiVersion)}\nensure CRDs are installed first`,
        client: true,
        fatal: false,
      },
      issue: {
        code: 'noMatch',
        line: at(['apiVersion']),
        field: 'apiVersion',
        detail: apiVersion,
        suggest: servedVersion(kind),
      },
    };
  }
  if (!name) {
    const gv = `${groupOf(apiVersion)}/${versionOf(apiVersion)}`;
    return {
      error: {
        text: `error when retrieving current configuration of:\nResource: "${gv}, Resource=${mapping.plural}", GroupVersionKind: "${gv}, Kind=${mapping.kind}"\nName: "", Namespace: ${JSON.stringify(mapping.namespaced ? ns || defaultNs : '')}\nfrom server for: ${JSON.stringify(file)}: resource name may not be empty`,
        client: true,
        fatal: false,
      },
      issue: { code: 'nameEmpty', line: at(['metadata']), field: 'metadata.name' },
    };
  }
  const object: AppliedObject = {
    apiVersion,
    kind: mapping.kind,
    name,
    namespace: mapping.namespaced ? ns || defaultNs : undefined,
    value: o,
  };
  const server = (msg: string, issue: ApplyIssue): DocResult => ({
    error: {
      text: `Error from server (BadRequest): error when creating ${JSON.stringify(file)}: ${msg}`,
      client: false,
      fatal: false,
    },
    issue,
  });
  const handled = `${kind} in version ${JSON.stringify(versionOf(apiVersion))} cannot be handled as a ${mapping.kind}`;
  if (mapping.kind !== kind) {
    return server(
      `${handled}: no kind ${JSON.stringify(kind)} is registered for version ${JSON.stringify(apiVersion)} in scheme "pkg/api/legacyscheme/scheme.go:30"`,
      { code: 'kindCase', line: at(['kind']), field: 'kind', detail: mapping.kind },
    );
  }
  // The namespace must exist (checked after decoding, before validation).
  const targetNs = mapping.namespaced ? ns || defaultNs : '';
  const missingNs: DocResult | null =
    targetNs && !namespaces.has(targetNs)
      ? {
          error: {
            text: `Error from server (NotFound): error when creating ${JSON.stringify(file)}: namespaces ${JSON.stringify(targetNs)} not found`,
            client: false,
            fatal: false,
          },
          issue: {
            code: 'nsMissing',
            line: at(['metadata', 'namespace']),
            field: 'metadata.namespace',
            detail: targetNs,
          },
        }
      : null;
  const key = `${apiVersion} ${kind}`;
  const rootIndex = ROOTS[key];
  const crd = CRDS[key];
  const fail = (errs: FieldErr[]): DocResult => ({
    error: {
      text: invalidText(
        kind,
        name,
        errs.map((e) => e.text),
      ),
      client: false,
      fatal: false,
    },
    issue: {
      code: errs[0]!.code,
      line: at(errs[0]!.segs),
      field: fieldPath(errs[0]!.segs),
      detail: errs[0]!.detail,
    },
  });
  if (rootIndex !== undefined) {
    const st: DecodeState = { typeError: null, typePath: null, unknown: [] };
    try {
      decodeStruct(o, rootIndex, [], st);
    } catch (e) {
      if (e instanceof HardError) {
        const code: IssueCode = e.message.startsWith('illegal base64') ? 'base64' : 'quantity';
        return server(`${handled}: ${e.message}`, { code, line: startLine });
      }
      throw e;
    }
    if (st.typeError)
      return server(`${handled}: ${st.typeError}`, {
        code: 'typeMismatch',
        line: at(st.typePath ?? []),
        field: fieldPath(st.typePath ?? []),
      });
    if (st.unknown.length) {
      return server(
        `${handled}: strict decoding error: ${st.unknown.map((u) => `unknown field ${JSON.stringify(u.path)}`).join(', ')}`,
        {
          code: 'unknownField',
          line: at(st.unknown[0]!.segs),
          field: st.unknown[0]!.path,
          detail: String(st.unknown[0]!.segs[st.unknown[0]!.segs.length - 1]),
        },
      );
    }
    if (missingNs) return missingNs;
    const errs = [...metaErrors(kind, meta), ...kindErrors(kind, o)];
    if (errs.length) return fail(errs);
  } else if (crd) {
    const unknown: { path: string; segs: (string | number)[] }[] = [];
    crdUnknown(o, crd.schema, [], unknown);
    if (unknown.length) {
      return server(
        `${handled}: strict decoding error: ${unknown.map((u) => `unknown field ${JSON.stringify(u.path)}`).join(', ')}`,
        {
          code: 'unknownField',
          line: at(unknown[0]!.segs),
          field: unknown[0]!.path,
          detail: String(unknown[0]!.segs[unknown[0]!.segs.length - 1]),
        },
      );
    }
    if (missingNs) return missingNs;
    const metaErrs = metaErrors(kind, meta);
    if (metaErrs.length) return fail(metaErrs);
    const schemaErrs: FieldErr[] = [];
    crdSchemaErrors(o, crd.schema, [], schemaErrs);
    schemaErrs.sort((a, b) =>
      fieldPath(a.segs) < fieldPath(b.segs) ? -1 : fieldPath(a.segs) > fieldPath(b.segs) ? 1 : 0,
    );
    if (schemaErrs.length) {
      const texts = schemaErrs.map((e) => e.text);
      if (crd.cel) texts.push(NOT_CHECKED);
      return {
        error: { text: invalidText(kind, name, texts), client: false, fatal: false },
        issue: {
          code: schemaErrs[0]!.code,
          line: at(schemaErrs[0]!.segs),
          field: fieldPath(schemaErrs[0]!.segs),
          detail: schemaErrs[0]!.detail,
        },
      };
    }
    const cel = crdCelErrors(kind, o);
    if (cel.length) return fail(cel);
  } else {
    if (missingNs) return missingNs;
    const errs = metaErrors(kind, meta);
    if (errs.length) return fail(errs);
  }
  if (kind === 'Namespace' && apiVersion === 'v1') namespaces.add(name);
  return { created: `${resourceRef(apiVersion, kind, name)} created`, object };
}

export interface ApplyOptions {
  /** The context's namespace (default "default"). */
  namespace?: string;
  /** Namespaces that exist in the cluster (default: default, kube-system, kube-public, kube-node-lease). */
  namespaces?: string[];
}

export const BUILTIN_NAMESPACES = ['default', 'kube-node-lease', 'kube-public', 'kube-system'];

/** What `kubectl apply -f <file>` prints for this text (Kubernetes 1.37). */
export function kubectlApply(
  text: string,
  file = 'manifest.yaml',
  opts: ApplyOptions = {},
): ApplyResult {
  const defaultNs = opts.namespace ?? 'default';
  const namespaces = new Set([...BUILTIN_NAMESPACES, ...(opts.namespaces ?? []), defaultNs]);
  const docs = splitDocuments(text);
  const lines: ApplyResult['lines'] = [];
  const issues: ApplyIssue[] = [];
  const objects: AppliedObject[] = [];
  const errors: { text: string; client: boolean }[] = [];
  if (!docs.length) {
    return {
      ok: false,
      lines: [{ text: 'error: no objects passed to apply', error: true }],
      issues: [{ code: 'noObjects', line: 1 }],
      objects,
    };
  }
  for (const d of docs) {
    const r = applyDoc(d.text, d.startLine, file, defaultNs, namespaces);
    if (r.created) lines.push({ text: r.created, error: false });
    if (r.object) objects.push(r.object);
    if (r.issue) issues.push(r.issue);
    if (r.error) {
      errors.push(r.error);
      if (r.error.fatal) break;
    }
  }
  // One error: "error: …" for kubectl's own errors. Several: kubectl's own errors first (in [ ] when
  // the server also complained about something), then the server's, one per line.
  const client = errors.filter((e) => e.client).map((e) => e.text);
  const fromServer = errors.filter((e) => !e.client).map((e) => e.text);
  const out: string[] =
    errors.length === 1
      ? [errors[0]!.client ? `error: ${errors[0]!.text}` : errors[0]!.text]
      : [
          ...(fromServer.length && client.length > 1 ? [`[${client.join(', ')}]`] : client),
          ...fromServer,
        ];
  for (const e of out) for (const l of e.split('\n')) lines.push({ text: l, error: true });
  return { ok: errors.length === 0, lines, issues, objects };
}
