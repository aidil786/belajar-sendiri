// The API server's write path: validate → default → admit → store.
// Used by kubectl (with strict checks and RBAC done before) and by the controllers.
import { applyLimitRanges, existingPodWarnings, namespaceLevels, podSecurity, quotaCheck, type Level } from './admission';
import { applyDefaults, unknownFields, validate } from './defaults';
import { apiVersionOf, byKind, GATEWAY_KINDS, objKey } from './resources';
import { createObj, getObj, isTerminating, removeObj, updateObj } from './store';
import type { Cluster, KObject, KubeEvent, KubeState } from './types';
import { clone, iso, randomSuffix } from './util';

export type ApiStatus = 'NotFound' | 'Forbidden' | 'Invalid' | 'BadRequest' | 'AlreadyExists' | 'Conflict' | 'NoKind';

export interface ApiResult {
  ok: boolean;
  obj?: KObject;
  /** The server's message (without "Error from server (…): "). */
  error?: string;
  status?: ApiStatus;
  warnings: string[];
}

const fail = (status: ApiStatus, error: string, warnings: string[] = []): ApiResult => ({ ok: false, status, error, warnings });

export interface WriteOptions {
  dryRun?: boolean;
  /** Typed by a learner (kubectl): strict field checks. Controllers skip them. */
  strict?: boolean;
  events?: KubeEvent[];
}

/** Check apiVersion/kind exist on this cluster. */
export function kindKnown(c: Cluster, o: KObject): boolean {
  const r = byKind(o.kind);
  if (!r) return false;
  if (GATEWAY_KINDS.includes(o.kind) && !c.addons.gateway) return false;
  return apiVersionOf(r) === o.apiVersion;
}

function admitPod(c: Cluster, o: KObject): ApiResult | null {
  const ns = o.metadata.namespace ?? 'default';
  const sa = o.spec?.serviceAccountName ?? o.spec?.serviceAccount ?? 'default';
  if (!getObj(c, 'ServiceAccount', ns, sa)) {
    return fail('Forbidden', `pods "${o.metadata.name}" is forbidden: error looking up service account ${ns}/${sa}: serviceaccount "${sa}" not found`);
  }
  applyLimitRanges(c, ns, o.spec);
  const errs = validate(o);
  if (errs.length) return fail('Invalid', invalidText(o, errs));
  return null;
}

function invalidText(o: KObject, errs: string[]): string {
  return `${o.kind} "${o.metadata.name}" is invalid: ${errs.length > 1 ? `[${errs.join(', ')}]` : errs[0]}`;
}

/** Create an object. `generateName` gets a random suffix. */
export function apiCreate(state: KubeState, c: Cluster, input: KObject, opts: WriteOptions = {}): ApiResult {
  const o = clone(input);
  o.metadata = o.metadata ?? ({} as any);
  const r = byKind(o.kind);
  if (!r || !kindKnown(c, o)) return fail('NoKind', `no matches for kind "${o.kind}" in version "${o.apiVersion}"`);
  if (!o.metadata.name && o.metadata.generateName) o.metadata.name = `${o.metadata.generateName}${randomSuffix(state)}`;
  if (r.namespaced) {
    o.metadata.namespace = o.metadata.namespace || 'default';
    const ns = getObj(c, 'Namespace', undefined, o.metadata.namespace);
    if (!ns) return fail('NotFound', `namespaces "${o.metadata.namespace}" not found`);
    if (isTerminating(ns) && o.kind !== 'Event') {
      return fail('Forbidden', `${r.plural} "${o.metadata.name}" is forbidden: unable to create new content in namespace ${o.metadata.namespace} because it is being terminated`);
    }
  } else delete o.metadata.namespace;
  if (opts.strict) {
    const unknown = unknownFields(o);
    if (unknown.length) {
      return fail('BadRequest', `${o.kind} in version "${r.version}" cannot be handled as a ${o.kind}: strict decoding error: ${unknown.map((u) => `unknown field "${u}"`).join(', ')}`);
    }
  }
  if (getObj(c, o.kind, o.metadata.namespace, o.metadata.name ?? '')) {
    return fail('AlreadyExists', `${r.plural}${r.group ? `.${r.group}` : ''} "${o.metadata.name}" already exists`);
  }
  if (o.kind !== 'Pod') {
    const errs = validate(o);
    if (errs.length) return fail('Invalid', invalidText(o, errs));
  }
  applyDefaults(state, c, o);
  const warnings: string[] = [];
  if (o.kind === 'Pod') {
    const bad = admitPod(c, o);
    if (bad) return bad;
  }
  const ps = podSecurity(c, o);
  if (ps.error) return fail('Forbidden', ps.error, ps.warnings);
  warnings.push(...ps.warnings);
  if (o.kind === 'Pod') {
    const q = quotaCheck(c, o.metadata.namespace ?? 'default', o);
    if (q) return fail('Forbidden', q, warnings);
  }
  if (opts.dryRun) return { ok: true, obj: o, warnings };
  const stored = createObj(state, c, o, opts.events);
  // Jobs label their pods with their own uid.
  if (stored.kind === 'Job') {
    const id = stored.metadata.uid;
    const fix = (m: Record<string, string> | undefined) => {
      if (!m) return;
      for (const k of ['batch.kubernetes.io/controller-uid', 'controller-uid']) if (m[k] === 'pending') m[k] = id;
    };
    fix(stored.spec.selector?.matchLabels);
    fix(stored.spec.template?.metadata?.labels);
  }
  return { ok: true, obj: stored, warnings };
}

/** Replace an object (apply, edit, scale, set image …). Keeps uid/creationTimestamp/status. */
export function apiUpdate(state: KubeState, c: Cluster, input: KObject, opts: WriteOptions = {}): ApiResult {
  const r = byKind(input.kind);
  if (!r || !kindKnown(c, input)) return fail('NoKind', `no matches for kind "${input.kind}" in version "${input.apiVersion}"`);
  const ns = r.namespaced ? input.metadata.namespace || 'default' : undefined;
  const old = getObj(c, input.kind, ns, input.metadata.name);
  if (!old) return fail('NotFound', `${r.plural}${r.group ? `.${r.group}` : ''} "${input.metadata.name}" not found`);
  const o = clone(input);
  o.metadata = { ...o.metadata, namespace: ns, uid: old.metadata.uid, creationTimestamp: old.metadata.creationTimestamp, resourceVersion: old.metadata.resourceVersion };
  if (!ns) delete o.metadata.namespace;
  if (old.metadata.generation !== undefined) o.metadata.generation = old.metadata.generation;
  if (old.metadata.ownerReferences && !input.metadata.ownerReferences) o.metadata.ownerReferences = old.metadata.ownerReferences;
  if (old.metadata.deletionTimestamp) o.metadata.deletionTimestamp = old.metadata.deletionTimestamp;
  if (opts.strict) {
    const unknown = unknownFields(o);
    if (unknown.length) {
      return fail('BadRequest', `${o.kind} in version "${r.version}" cannot be handled as a ${o.kind}: strict decoding error: ${unknown.map((u) => `unknown field "${u}"`).join(', ')}`);
    }
  }
  const errs = validate(o);
  if (errs.length) return fail('Invalid', invalidText(o, errs));
  // Immutable bits.
  if (o.kind === 'Deployment' && JSON.stringify(old.spec.selector) !== JSON.stringify(o.spec.selector)) {
    return fail('Invalid', `Deployment.apps "${o.metadata.name}" is invalid: spec.selector: Invalid value: ${JSON.stringify(o.spec.selector)}: field is immutable`);
  }
  if (o.kind === 'Pod') {
    const strip = (s: any) => JSON.stringify({ ...s, containers: (s.containers ?? []).map((x: any) => ({ ...x, image: undefined })) });
    // Only images (and a few fields) of a running pod may change.
    const next = clone(o.spec ?? {});
    o.spec = { ...old.spec, ...next };
    o.spec.containers = old.spec.containers.map((oc: any, i: number) => ({ ...oc, image: next.containers?.[i]?.image ?? oc.image }));
    if (strip(o.spec) !== strip(old.spec)) {
      return fail('Invalid', `Pod "${o.metadata.name}" is invalid: spec: Forbidden: pod updates may not change fields other than \`spec.containers[*].image\`,\`spec.initContainers[*].image\`,\`spec.activeDeadlineSeconds\`,\`spec.tolerations\` (only additions to existing tolerations),\`spec.terminationGracePeriodSeconds\` (allow it to be set to 1 if it was previously negative)`);
    }
  } else {
    applyDefaults(state, c, o);
  }
  if (o.status === undefined || o.kind !== 'Namespace') o.status = old.status;
  const warnings: string[] = [];
  const ps = podSecurity(c, o);
  if (o.kind !== 'Pod') warnings.push(...ps.warnings);
  if (o.kind === 'Namespace') {
    const before = namespaceLevels(c, o.metadata.name).enforce;
    const level = o.metadata.labels?.['pod-security.kubernetes.io/enforce'] as Level | undefined;
    if (level && level !== before) warnings.push(...existingPodWarnings(c, o.metadata.name, level));
  }
  if (opts.dryRun) return { ok: true, obj: o, warnings };
  return { ok: true, obj: updateObj(c, o, opts.events), warnings };
}

export interface DeleteOptions {
  grace?: number;
  force?: boolean;
  dryRun?: boolean;
  by?: 'user' | 'controller' | 'eviction' | 'gc';
  events?: KubeEvent[];
}

/** Delete an object. Pods wait for their grace period (the kubelet finishes them). */
export function apiDelete(state: KubeState, c: Cluster, kind: string, namespace: string | undefined, name: string, opts: DeleteOptions = {}): ApiResult {
  const r = byKind(kind)!;
  const ns = r.namespaced ? namespace || 'default' : undefined;
  const o = getObj(c, kind, ns, name);
  if (!o) return fail('NotFound', `${r.plural}${r.group ? `.${r.group}` : ''} "${name}" not found`);
  if (opts.dryRun) return { ok: true, obj: o, warnings: [] };
  const by = opts.by ?? 'user';
  if (kind === 'Pod') {
    const ownerUid = o.metadata.ownerReferences?.find((x) => x.controller)?.uid;
    if (ownerUid && !isTerminating(o)) (c.lost[ownerUid] ??= []).push(o.metadata.name);
    const grace = opts.force && opts.grace === 0 ? 0 : (opts.grace ?? o.spec?.terminationGracePeriodSeconds ?? 30);
    if (!o.spec?.nodeName || grace === 0) {
      removeObj(c, o, opts.events);
      opts.events?.push({ type: 'podDeleted', pod: name, namespace: ns!, by }, { type: 'podGone', pod: name, namespace: ns! });
      return { ok: true, obj: o, warnings: [] };
    }
    if (!isTerminating(o)) {
      o.metadata.deletionTimestamp = iso(state.clock + grace);
      o.metadata.deletionGracePeriodSeconds = grace;
      updateObjQuiet(c, o);
      opts.events?.push({ type: 'podDeleted', pod: name, namespace: ns!, by });
    } else if (grace < (o.metadata.deletionGracePeriodSeconds ?? 30)) {
      o.metadata.deletionTimestamp = iso(state.clock + grace);
      o.metadata.deletionGracePeriodSeconds = grace;
    }
    return { ok: true, obj: o, warnings: [] };
  }
  if (kind === 'Namespace') {
    if (['default', 'kube-system', 'kube-public', 'kube-node-lease'].includes(name)) {
      return fail('Forbidden', `namespaces "${name}" is forbidden: this namespace may not be deleted`);
    }
    if (!isTerminating(o)) {
      o.metadata.deletionTimestamp = iso(state.clock);
      o.status = { phase: 'Terminating' };
      updateObjQuiet(c, o);
    }
    return { ok: true, obj: o, warnings: [] };
  }
  removeObj(c, o, opts.events);
  return { ok: true, obj: o, warnings: [] };
}

function updateObjQuiet(c: Cluster, o: KObject): void {
  c.rv += 1;
  o.metadata.resourceVersion = String(c.rv);
  c.objects[objKey(o.kind, o.metadata.namespace, o.metadata.name)] = o;
}

/** Error text kubectl shows for an API failure. */
export function serverError(res: ApiResult, verb?: { action: 'creating' | 'patching' | 'replacing'; file: string; name?: string; namespace?: string }): string {
  if (res.status === 'NoKind') {
    return verb
      ? `error: resource mapping not found for name: "${verb.name ?? ''}" namespace: "${verb.namespace ?? ''}" from "${verb.file}": ${res.error}\nensure CRDs are installed first`
      : `error: ${res.error}`;
  }
  return `Error from server (${res.status}): ${verb ? `error when ${verb.action} "${verb.file}": ` : ''}${res.error}`;
}
