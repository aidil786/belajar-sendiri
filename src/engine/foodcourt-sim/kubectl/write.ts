// kubectl commands that change things: apply, create, delete, scale, set, rollout,
// label, annotate, expose, run, cordon/drain/taint, diff, kustomize, autoscale, wait,
// patch, and the ones that talk to containers: exec, port-forward, debug.
import { etcdInPod } from '../node/etcd';
import { diffLines, makeHunks, renderHunks } from '../../git-sim/diff';
import { line } from '../../git-sim/output';
import { apiCreate, apiDelete, apiUpdate, serverError, type ApiResult } from '../api';
import { reconcileAll, tickOnce } from '../clock';
import { behaviorOf, filesAt } from '../controllers/kubelet';
import { revisionOf } from '../controllers/workloads';
import { b64 } from '../defaults';
import { kustomizeBuild, kustomizeText } from '../kustomize';
import { httpGet } from '../network';
import { byKind, qualified, type ResourceType } from '../resources';
import { getObj, isTerminating, listObjs, ownedBy, podReady, podStatusText, updateObj } from '../store';
import type { KObject } from '../types';
import { clone, deepMerge, fromIso, iso, labelText, parseSelector, matches, randomSuffix, selectorMatches, stableJson } from '../util';
import { listDir, readFile, writeFile } from '../volumes';
import { toYaml } from '../yaml';
import { bool, flag, flagAll } from './args';
import { absPath, can, err, kindName, notFound, OK, preflight, readManifests, resource, say, targets, type FileDoc, type Kx, type Ret } from './ctx';
import { curlOutput, parseCurl, wgetOutput } from './http';
import { forOutput } from './print';
import { printObjects } from './read';
import { tabwrite } from './print';

const forbiddenRet = (kx: Kx): Ret => ({ ok: false, explain: { key: 'kube.err.forbidden', params: { user: kx.who.user } } });

function dryNote(kx: Kx): string {
  return kx.dry === 'client' ? ' (dry run)' : kx.dry === 'server' ? ' (server dry run)' : '';
}

function after(kx: Kx): void {
  if (kx.dry === 'none') reconcileAll(kx.state, kx.ev);
}

/** Print an object for `--dry-run -o yaml` (or any -o), else nothing. */
function printIfOutput(kx: Kx, objs: KObject[]): boolean {
  if (!flag(kx.p, 'output')) return false;
  printObjects(kx, [{ kind: objs[0]?.kind ?? 'Pod', objs }], { prefix: false, single: objs.length === 1 });
  return true;
}

// ---------------------------------------------------------------------------
// apply / create -f / replace

function lastApplied(o: KObject): string {
  const x = clone(o);
  x.metadata = { ...x.metadata, annotations: { ...(x.metadata.annotations ?? {}) } };
  delete x.metadata.annotations!['kubectl.kubernetes.io/last-applied-configuration'];
  return `${stableJson(x)}\n`;
}

function keyOf(item: any): string | null {
  if (!item || typeof item !== 'object') return null;
  if ('name' in item && typeof item.name === 'string') return `name:${item.name}`;
  if ('containerPort' in item) return `cp:${item.containerPort}`;
  if ('mountPath' in item) return `mp:${item.mountPath}`;
  if ('port' in item && typeof item.port === 'number') return `p:${item.port}`;
  return null;
}

/** kubectl apply's three-way merge: what you remove from your file is removed live. */
export function threeWay(live: any, last: any, next: any): any {
  if (Array.isArray(next)) {
    if (next.every((x) => keyOf(x)) && Array.isArray(live)) {
      return next.map((item) => {
        const k = keyOf(item);
        const l = live.find((x: any) => keyOf(x) === k);
        const p = Array.isArray(last) ? last.find((x: any) => keyOf(x) === k) : undefined;
        return l ? threeWay(l, p, item) : clone(item);
      });
    }
    return clone(next);
  }
  if (next && typeof next === 'object') {
    const out: Record<string, unknown> = live && typeof live === 'object' && !Array.isArray(live) ? { ...live } : {};
    for (const [k, v] of Object.entries(next)) out[k] = threeWay(out[k], last?.[k], v);
    if (last && typeof last === 'object') for (const k of Object.keys(last)) if (!(k in next)) delete out[k];
    return out;
  }
  return next;
}

function comparable(o: KObject): string {
  const x = clone(o);
  delete x.status;
  x.metadata = { ...x.metadata, annotations: { ...(x.metadata.annotations ?? {}) } };
  delete x.metadata.annotations!['kubectl.kubernetes.io/last-applied-configuration'];
  delete x.metadata.annotations!['deployment.kubernetes.io/revision'];
  for (const k of ['resourceVersion', 'generation', 'uid', 'creationTimestamp'] as const) delete (x.metadata as any)[k];
  return stableJson(x);
}

function applyOne(kx: Kx, d: FileDoc, mode: 'apply' | 'create' | 'replace'): { ok: boolean; text?: string; obj?: KObject; res?: ApiResult } {
  const bad = preflight(kx, d);
  if (bad) {
    say(kx, bad);
    return { ok: false };
  }
  const o = d.obj;
  const r = byKind(o.kind)!;
  const live = getObj(kx.c, o.kind, o.metadata.namespace, o.metadata.name ?? '');
  const name = `${qualified(r)}/${o.metadata.name}`;
  if (!live || mode === 'create') {
    if (!can(kx, 'create', r, undefined, o.metadata.namespace)) return { ok: false };
    const input = clone(o);
    if (mode === 'apply') {
      input.metadata.annotations = { ...(input.metadata.annotations ?? {}), 'kubectl.kubernetes.io/last-applied-configuration': lastApplied(o) };
    }
    if (kx.dry === 'client') return { ok: true, text: `${name} created${dryNote(kx)}`, obj: input };
    const res = apiCreate(kx.state, kx.c, input, { strict: true, dryRun: kx.dry === 'server', events: kx.ev });
    for (const w of res.warnings) say(kx, w);
    if (!res.ok) {
      say(kx, serverError(res, { action: 'creating', file: d.file, name: o.metadata.name, namespace: o.metadata.namespace }));
      if (res.status === 'Forbidden' && /PodSecurity/.test(res.error ?? '')) kx.ev.push({ type: 'admissionDenied', reason: 'podSecurity', name: o.metadata.name });
      if (res.status === 'Forbidden' && /quota/.test(res.error ?? '')) kx.ev.push({ type: 'admissionDenied', reason: 'quota', name: o.metadata.name });
      return { ok: false, res };
    }
    return { ok: true, text: `${name} created${dryNote(kx)}`, obj: res.obj };
  }
  if (!can(kx, 'patch', r, o.metadata.name, o.metadata.namespace)) return { ok: false };
  let next: KObject;
  if (mode === 'replace') next = { ...clone(o), status: live.status };
  else {
    const last = live.metadata.annotations?.['kubectl.kubernetes.io/last-applied-configuration'];
    const lastObj = last ? JSON.parse(last) : {};
    next = threeWay(clone(live), lastObj, clone(o));
    next.metadata.annotations = { ...(next.metadata.annotations ?? {}), 'kubectl.kubernetes.io/last-applied-configuration': lastApplied(o) };
    if (!last) say(kx, `Warning: resource ${r.plural} "${o.metadata.name}" is missing the kubectl.kubernetes.io/last-applied-configuration annotation which is required by kubectl apply. kubectl apply should only be used on resources created declaratively by either kubectl create --save-config or kubectl apply. The missing annotation will be patched automatically.`.replace(` ${r.plural} `, ` ${qualified(r).replace(/\..*/, '')}${r.group ? `s.${r.group}` : 's'} `));
  }
  const res = apiUpdate(kx.state, kx.c, next, { strict: true, dryRun: true });
  if (!res.ok) {
    say(kx, serverError(res, { action: mode === 'replace' ? 'replacing' : 'patching', file: d.file }));
    return { ok: false, res };
  }
  const same = comparable(res.obj!) === comparable(live);
  if (same && mode === 'apply') return { ok: true, text: `${name} unchanged${dryNote(kx)}`, obj: live };
  if (kx.dry !== 'none') return { ok: true, text: `${name} ${mode === 'replace' ? 'replaced' : 'configured'}${dryNote(kx)}`, obj: res.obj };
  const done = apiUpdate(kx.state, kx.c, next, { strict: true, events: kx.ev });
  for (const w of done.warnings) say(kx, w);
  return { ok: true, text: `${name} ${mode === 'replace' ? 'replaced' : 'configured'}`, obj: done.obj };
}

function docsFromFlags(kx: Kx): { docs: FileDoc[]; error?: Ret } {
  const k = flag(kx.p, 'kustomize');
  if (k) {
    const built = kustomizeBuild(kx.state, absPath(kx.state, k));
    if (built.error) return { docs: [], error: err(kx, built.error, 'kube.err.kustomize', { dir: k }) };
    return { docs: built.objs.map((obj) => ({ file: k, obj })) };
  }
  const files = flagAll(kx.p, 'filename');
  if (!files.length) return { docs: [], error: err(kx, 'error: must specify one of -f and -k', 'kube.err.needFile') };
  const docs: FileDoc[] = [];
  for (const f of files) {
    const r = readManifests(kx, f);
    if (r.error === 'url') return { docs, error: err(kx, `error: unable to read URL "${f}", server reported 403 Forbidden, status code=403`, 'kube.err.noUrl') };
    if (r.error) return { docs, error: err(kx, r.error, r.error.includes('does not exist') ? 'kube.err.noFile' : 'kube.err.yaml', { file: f }) };
    docs.push(...r.docs);
  }
  if (!docs.length) return { docs, error: err(kx, 'error: no objects passed to apply', 'kube.err.noObjects') };
  return { docs };
}

export function apply(kx: Kx, mode: 'apply' | 'create' | 'replace' = 'apply'): Ret {
  const { docs, error } = docsFromFlags(kx);
  if (error) return error;
  let ok = true;
  const shown: KObject[] = [];
  let changed = false;
  for (const d of docs) {
    const r = applyOne(kx, d, mode);
    if (!r.ok) {
      ok = false;
      continue;
    }
    if (r.obj) shown.push(r.obj);
    if (r.text && !flag(kx.p, 'output')) say(kx, mode === 'apply' && bool(kx.p, 'server-side') ? r.text.replace(/ (created|configured|unchanged)/, ' serverside-applied') : r.text);
    if (r.text && !/unchanged/.test(r.text)) changed = true;
  }
  if (flag(kx.p, 'output') && shown.length) printIfOutput(kx, shown.map(forOutput));
  after(kx);
  if (!ok) return { ok: false, explain: { key: 'kube.err.applyFailed' }, changed };
  if (kx.dry !== 'none') return OK({ key: 'kube.explain.dryRun' });
  return OK({ key: mode === 'apply' ? (changed ? 'kube.explain.apply' : 'kube.explain.applyUnchanged') : 'kube.explain.create' }, changed);
}

// ---------------------------------------------------------------------------
// create <thing> (imperative)

function containerName(image: string): string {
  const base = image.split('@')[0]!.split('/').pop()!.split(':')[0]!;
  return base.toLowerCase().replace(/[^a-z0-9-]/g, '-');
}

/** Objects `kubectl create …` builds client-side (shapes checked with kubectl v1.37.2 --dry-run=client -o yaml). */
function buildCreate(kx: Kx, what: string, name: string | undefined, rest: string[]): KObject | { error: string } {
  const after = kx.p.after ?? [];
  const ns = kx.ns;
  const meta = (extra: any = {}) => ({ ...extra, name, ...(kx.nsGiven ? { namespace: ns } : {}) });
  if (!name && !['secret', 'service', 'svc'].includes(what)) return { error: `error: exactly one NAME is required, got 0\nSee 'kubectl create ${what} -h' for help and examples` };
  switch (what) {
    case 'namespace':
    case 'ns':
      return { apiVersion: 'v1', kind: 'Namespace', metadata: { name } as any, spec: {}, status: {} };
    case 'deployment':
    case 'deploy': {
      const imgs = flagAll(kx.p, 'image');
      if (!imgs.length) return { error: 'error: required flag(s) "image" not set' };
      const port = flag(kx.p, 'port');
      const containers = imgs.map((image) => ({
        ...(after.length ? { command: after } : {}),
        image,
        name: containerName(image),
        ...(port ? { ports: [{ containerPort: Number(port) }] } : {}),
        resources: {},
      }));
      return {
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        metadata: meta({ labels: { app: name } }),
        spec: { replicas: Number(flag(kx.p, 'replicas') ?? 1), selector: { matchLabels: { app: name } }, strategy: {}, template: { metadata: { labels: { app: name } }, spec: { containers } } },
        status: {},
      };
    }
    case 'configmap':
    case 'cm': {
      const data: Record<string, string> = {};
      for (const lit of flagAll(kx.p, 'from-literal')) {
        const i = lit.indexOf('=');
        if (i < 0) return { error: `error: invalid literal source ${lit}, expected key=value` };
        data[lit.slice(0, i)] = lit.slice(i + 1);
      }
      for (const f of flagAll(kx.p, 'from-file')) {
        const [k, p] = f.includes('=') ? f.split('=') : [f.split('/').pop()!, f];
        const content = kx.state.files[absPath(kx.state, p!)];
        if (content === undefined) return { error: `error: error reading ${p}: no such file or directory` };
        data[k!] = content;
      }
      return { apiVersion: 'v1', ...(Object.keys(data).length ? { data } : {}), kind: 'ConfigMap', metadata: meta() } as KObject;
    }
    case 'secret': {
      const [type, sname] = [name, rest[0]];
      if (type !== 'generic') return { error: `error: this practice terminal makes "generic" secrets only (try: kubectl create secret generic NAME --from-literal=key=value)` };
      if (!sname) return { error: "error: exactly one NAME is required, got 0\nSee 'kubectl create secret generic -h' for help and examples" };
      const data: Record<string, string> = {};
      for (const lit of flagAll(kx.p, 'from-literal')) {
        const i = lit.indexOf('=');
        data[lit.slice(0, i)] = b64(lit.slice(i + 1));
      }
      return { apiVersion: 'v1', ...(Object.keys(data).length ? { data } : {}), kind: 'Secret', metadata: { name: sname, ...(kx.nsGiven ? { namespace: ns } : {}) } as any } as KObject;
    }
    case 'job': {
      const from = flag(kx.p, 'from');
      if (from) {
        // kubectl create job NAME --from=cronjob/NAME: the CronJob's job template, run now (like kubectl's createJobFromCronJob).
        const [type, cjName] = from.split('/');
        if (!cjName || !/^(cronjob|cronjobs|cj)(\.batch)?$/.test(type ?? '')) return { error: `error: from must be an existing cronjob: ${from}` };
        const cj = getObj(kx.c, 'CronJob', ns, cjName);
        if (!cj) return { error: `Error from server (NotFound): cronjobs.batch "${cjName}" not found` };
        const tpl = clone(cj.spec.jobTemplate ?? {});
        return {
          apiVersion: 'batch/v1',
          kind: 'Job',
          metadata: meta({
            annotations: { 'cronjob.kubernetes.io/instantiate': 'manual', ...(tpl.metadata?.annotations ?? {}) },
            ...(tpl.metadata?.labels ? { labels: tpl.metadata.labels } : {}),
            ownerReferences: [{ apiVersion: 'batch/v1', kind: 'CronJob', name: cj.metadata.name, uid: cj.metadata.uid, controller: true }],
          }),
          spec: tpl.spec ?? {},
          status: {},
        };
      }
      const image = flag(kx.p, 'image');
      if (!image) return { error: 'error: required flag(s) "image" not set' };
      return {
        apiVersion: 'batch/v1',
        kind: 'Job',
        metadata: meta(),
        spec: { template: { metadata: {}, spec: { containers: [{ ...(after.length ? { command: after } : {}), image, name, resources: {} }], restartPolicy: 'Never' } } },
        status: {},
      };
    }
    case 'cronjob':
    case 'cj': {
      const image = flag(kx.p, 'image');
      const schedule = flag(kx.p, 'schedule');
      if (!image) return { error: 'error: required flag(s) "image" not set' };
      if (!schedule) return { error: 'error: required flag(s) "schedule" not set' };
      return {
        apiVersion: 'batch/v1',
        kind: 'CronJob',
        metadata: meta(),
        spec: {
          jobTemplate: { metadata: { name }, spec: { template: { metadata: {}, spec: { containers: [{ ...(after.length ? { command: after } : {}), image, name, resources: {} }], restartPolicy: 'OnFailure' } } } },
          schedule,
        },
        status: {},
      };
    }
    case 'service':
    case 'svc': {
      const [type, sname] = [name, rest[0]];
      const map: Record<string, string> = { clusterip: 'ClusterIP', nodeport: 'NodePort', loadbalancer: 'LoadBalancer' };
      if (!type || !map[type]) return { error: `error: unknown service type "${type ?? ''}" (use clusterip, nodeport or loadbalancer)` };
      if (!sname) return { error: `error: exactly one NAME is required, got 0` };
      const tcp = flagAll(kx.p, 'tcp');
      if (!tcp.length && type !== 'clusterip') return { error: 'error: at least one tcp port specifier must be provided' };
      const ports = tcp.map((t) => {
        const [p, tp] = t.split(':');
        return { name: `${p}-${tp ?? p}`, port: Number(p), protocol: 'TCP', targetPort: Number(tp ?? p) };
      });
      const spec: any = { ports, selector: { app: sname }, type: map[type] };
      if (flag(kx.p, 'clusterip') === 'None') spec.clusterIP = 'None';
      return { apiVersion: 'v1', kind: 'Service', metadata: { labels: { app: sname }, name: sname, ...(kx.nsGiven ? { namespace: ns } : {}) } as any, spec, status: { loadBalancer: {} } };
    }
    case 'serviceaccount':
    case 'sa':
      return { apiVersion: 'v1', kind: 'ServiceAccount', metadata: meta() };
    case 'role':
    case 'clusterrole': {
      const verbs = flagAll(kx.p, 'verb').flatMap((v) => v.split(','));
      const res = flagAll(kx.p, 'resource').flatMap((v) => v.split(','));
      if (!verbs.length) return { error: 'error: at least one verb must be specified' };
      if (!res.length) return { error: 'error: at least one resource must be specified' };
      const rules: any[] = [];
      for (const rw of res) {
        const [base, sub] = rw.split('/');
        const r = resource(kx, base!);
        if (!r) return { error: `error: the server doesn't have a resource type "${base}"` };
        const resName = sub ? `${r.plural}/${sub}` : r.plural;
        const existing = rules.find((x) => x.apiGroups[0] === r.group);
        if (existing) existing.resources.push(resName);
        else rules.push({ apiGroups: [r.group], resources: [resName], verbs });
      }
      return { apiVersion: 'rbac.authorization.k8s.io/v1', kind: what === 'role' ? 'Role' : 'ClusterRole', metadata: what === 'role' ? meta() : ({ name } as any), rules };
    }
    case 'rolebinding':
    case 'clusterrolebinding': {
      const role = flag(kx.p, 'role');
      const crole = flag(kx.p, 'clusterrole');
      if (!role && !crole) return { error: 'error: exactly one of clusterrole or role must be specified' };
      const subjects = [
        ...flagAll(kx.p, 'user').map((u) => ({ apiGroup: 'rbac.authorization.k8s.io', kind: 'User', name: u })),
        ...flagAll(kx.p, 'group').map((g) => ({ apiGroup: 'rbac.authorization.k8s.io', kind: 'Group', name: g })),
        ...flagAll(kx.p, 'serviceaccount').map((s) => {
          const [sns, sn] = s.split(':');
          return { kind: 'ServiceAccount', name: sn, namespace: sns };
        }),
      ];
      return {
        apiVersion: 'rbac.authorization.k8s.io/v1',
        kind: what === 'rolebinding' ? 'RoleBinding' : 'ClusterRoleBinding',
        metadata: what === 'rolebinding' ? meta() : ({ name } as any),
        roleRef: { apiGroup: 'rbac.authorization.k8s.io', kind: role ? 'Role' : 'ClusterRole', name: role ?? crole },
        subjects,
      };
    }
    case 'quota':
    case 'resourcequota': {
      const hard: Record<string, string> = {};
      for (const kv of (flag(kx.p, 'hard') ?? '').split(',').filter(Boolean)) {
        const [k, v] = kv.split('=');
        hard[k!] = v!;
      }
      return { apiVersion: 'v1', kind: 'ResourceQuota', metadata: meta(), spec: { hard }, status: {} };
    }
    case 'poddisruptionbudget':
    case 'pdb': {
      const sel = flag(kx.p, 'selector') ?? '';
      const matchLabels = Object.fromEntries(sel.split(',').filter(Boolean).map((x) => x.split('=') as [string, string]));
      const min = flag(kx.p, 'min-available');
      const max = flag(kx.p, 'max-unavailable');
      const num = (v: string) => (/^\d+$/.test(v) ? Number(v) : v);
      return {
        apiVersion: 'policy/v1',
        kind: 'PodDisruptionBudget',
        metadata: meta(),
        spec: { ...(min ? { minAvailable: num(min) } : {}), ...(max ? { maxUnavailable: num(max) } : {}), selector: { matchLabels } },
        status: { currentHealthy: 0, desiredHealthy: 0, disruptionsAllowed: 0, expectedPods: 0 },
      };
    }
    default:
      return { error: `error: unknown command "${what}" for "kubectl create"` };
  }
}

export function create(kx: Kx, words: string[]): Ret {
  if (flagAll(kx.p, 'filename').length || flag(kx.p, 'kustomize')) return apply(kx, 'create');
  const [what, name, ...rest] = words;
  if (!what) return err(kx, 'error: must specify one of -f and -k', 'kube.err.needFile');
  const built = buildCreate(kx, what, name, rest);
  if ('error' in built) return err(kx, built.error, 'kube.err.createUsage', { what });
  const r = byKind(built.kind)!;
  if (kx.dry === 'client') {
    if (!printIfOutput(kx, [built])) say(kx, `${qualified(r)}/${built.metadata.name} created (dry run)`);
    return OK({ key: 'kube.explain.dryRun' });
  }
  if (!can(kx, 'create', r, undefined, built.metadata.namespace ?? kx.ns)) return forbiddenRet(kx);
  const input = clone(built);
  if (r.namespaced) input.metadata.namespace = input.metadata.namespace ?? kx.ns;
  const res = apiCreate(kx.state, kx.c, input, { dryRun: kx.dry === 'server', events: kx.ev });
  for (const w of res.warnings) say(kx, w);
  if (!res.ok) return err(kx, serverError(res), res.status === 'AlreadyExists' ? 'kube.err.alreadyExists' : 'kube.err.server', { name: built.metadata.name });
  if (!printIfOutput(kx, [res.obj!])) say(kx, `${qualified(r)}/${built.metadata.name} created${dryNote(kx)}`);
  after(kx);
  return OK({ key: `kube.explain.create`, params: { what: built.kind, name: built.metadata.name } }, kx.dry === 'none');
}

// ---------------------------------------------------------------------------
// delete

function waitGone(kx: Kx, objs: KObject[], max = 120): void {
  for (let s = 0; s < max; s++) {
    if (objs.every((o) => !getObj(kx.c, o.kind, o.metadata.namespace, o.metadata.name) || getObj(kx.c, o.kind, o.metadata.namespace, o.metadata.name)!.metadata.uid !== o.metadata.uid)) return;
    tickOnce(kx.state, kx.ev);
  }
}

export function del(kx: Kx, words: string[]): Ret {
  const objs: KObject[] = [];
  const missing: string[] = [];
  if (flagAll(kx.p, 'filename').length || flag(kx.p, 'kustomize')) {
    const { docs, error } = docsFromFlags(kx);
    if (error) return error;
    for (const d of docs) {
      const bad = preflight(kx, d);
      if (bad) return err(kx, bad, 'kube.err.yaml', { file: d.file });
      const live = getObj(kx.c, d.obj.kind, d.obj.metadata.namespace, d.obj.metadata.name);
      if (live) objs.push(live);
      else missing.push(notFound(byKind(d.obj.kind)!, d.obj.metadata.name));
    }
  } else {
    const t = targets(kx, words, { needName: true });
    if (t.error === 'noType') return err(kx, 'error: You must provide one or more resources by argument or filename.\nExample resource specifications include:\n   \'-f rsrc.yaml\'\n   \'--filename=rsrc.json\'\n   \'<resource> <name>\'\n   \'<resource>\'', 'kube.err.deleteUsage');
    if (t.error === 'needName') return err(kx, 'error: resource(s) were provided, but no name was specified', 'kube.err.needName');
    if (t.error) return err(kx, t.error, 'kube.err.unknownType', { type: words[0] ?? '' });
    for (const g of t.list) {
      objs.push(...g.objs);
      for (const m of g.missing) missing.push(notFound(g.r, m));
    }
  }
  if (bool(kx.p, 'ignore-not-found')) missing.length = 0;
  const grace = flag(kx.p, 'grace-period');
  const force = bool(kx.p, 'force');
  const now = bool(kx.p, 'now');
  if (force && (grace === '0' || grace === undefined)) say(kx, 'Warning: Immediate deletion does not wait for confirmation that the running resource has been terminated. The resource may continue to run on the cluster indefinitely.');
  const deleted: KObject[] = [];
  let ok = true;
  for (const o of objs) {
    const r = byKind(o.kind)!;
    if (!can(kx, 'delete', r, o.metadata.name, o.metadata.namespace)) {
      ok = false;
      continue;
    }
    const res = apiDelete(kx.state, kx.c, o.kind, o.metadata.namespace, o.metadata.name, {
      ...(grace !== undefined ? { grace: Number(grace) } : now ? { grace: 1 } : {}),
      force: force && (grace === undefined || grace === '0'),
      ...(force && grace === undefined ? { grace: 0 } : {}),
      dryRun: kx.dry !== 'none',
      by: 'user',
      events: kx.ev,
    });
    if (!res.ok) {
      say(kx, serverError(res));
      ok = false;
      continue;
    }
    say(kx, `${qualified(r)} "${o.metadata.name}" deleted${r.namespaced && kx.dry === 'none' ? ` from ${o.metadata.namespace} namespace` : ''}${dryNote(kx)}`);
    deleted.push(o);
  }
  for (const m of missing) say(kx, m);
  if (kx.dry === 'none') {
    reconcileAll(kx.state, kx.ev);
    if (bool(kx.p, 'wait', true)) waitGone(kx, deleted);
  }
  if (!objs.length && !missing.length) {
    say(kx, `No resources found`);
    return OK({ key: 'kube.explain.getNone', params: { ns: kx.ns } });
  }
  if (missing.length || !ok) return { ok: false, explain: { key: missing.length ? 'kube.err.notFound' : 'kube.err.forbidden', params: { what: words.join(' '), user: kx.who.user } }, changed: deleted.length > 0 };
  const kinds = new Set(deleted.map((o) => o.kind));
  const owned = deleted.some((o) => o.kind === 'Pod' && o.metadata.ownerReferences?.some((r) => r.controller));
  return OK({ key: kinds.has('Namespace') ? 'kube.explain.deleteNamespace' : owned ? 'kube.explain.deleteOwnedPod' : 'kube.explain.delete', params: { name: deleted[0]?.metadata.name ?? '' } }, deleted.length > 0);
}

// ---------------------------------------------------------------------------
// scale, set image / env, patch

function single(kx: Kx, words: string[], verb: string): { o?: KObject; r?: ResourceType; ret?: Ret } {
  if (flagAll(kx.p, 'filename').length) {
    const { docs, error } = docsFromFlags(kx);
    if (error) return { ret: error };
    const d = docs[0]!;
    preflight(kx, d);
    const o = getObj(kx.c, d.obj.kind, d.obj.metadata.namespace, d.obj.metadata.name);
    if (!o) return { ret: err(kx, notFound(byKind(d.obj.kind)!, d.obj.metadata.name), 'kube.err.notFound', { what: d.obj.metadata.name }) };
    return { o, r: byKind(o.kind)! };
  }
  const t = targets(kx, words);
  if (t.error) return { ret: err(kx, t.error === 'noType' ? `error: you must specify the type of resource to ${verb}` : t.error, 'kube.err.unknownType', { type: words[0] ?? '' }) };
  const g = t.list[0]!;
  if (g.missing.length) return { ret: err(kx, notFound(g.r, g.missing[0]!), 'kube.err.notFound', { what: words.join(' ') }) };
  if (!g.objs.length) return { ret: err(kx, `error: resource(s) were provided, but no name was specified`, 'kube.err.needName') };
  return { o: g.objs[0]!, r: g.r };
}

export function scale(kx: Kx, words: string[]): Ret {
  const n = flag(kx.p, 'replicas');
  if (n === undefined) return err(kx, 'error: required flag(s) "replicas" not set', 'kube.err.needReplicas');
  const { o, r, ret } = single(kx, words, 'scale');
  if (ret) return ret;
  if (!['Deployment', 'ReplicaSet', 'StatefulSet'].includes(o!.kind)) return err(kx, `error: ${qualified(r!)}/${o!.metadata.name} is not scalable`, 'kube.err.notScalable');
  if (!can(kx, 'patch', r!, o!.metadata.name, o!.metadata.namespace, 'scale')) return forbiddenRet(kx);
  const next = clone(o!);
  const from = next.spec.replicas;
  next.spec.replicas = Number(n);
  if (kx.dry === 'none') {
    const res = apiUpdate(kx.state, kx.c, next, { events: kx.ev });
    if (!res.ok) return err(kx, serverError(res), 'kube.err.server');
    kx.ev.push({ type: 'scaled', kind: o!.kind, name: o!.metadata.name, namespace: o!.metadata.namespace!, from, to: Number(n) });
  }
  say(kx, `${kindName(o!)} scaled${dryNote(kx)}`);
  after(kx);
  return OK({ key: 'kube.explain.scale', params: { name: o!.metadata.name, n } }, true);
}

function podSpecOf(o: KObject): any {
  return o.kind === 'Pod' ? o.spec : o.kind === 'CronJob' ? o.spec.jobTemplate.spec.template.spec : o.spec.template.spec;
}

export function set(kx: Kx, words: string[]): Ret {
  const [what, target, ...pairs] = words;
  if (what !== 'image' && what !== 'env' && what !== 'resources') return err(kx, `error: unknown command "${what ?? ''}" for "kubectl set"`, 'kube.err.setUsage');
  const tw = target?.includes('/') ? [target] : [target ?? '', pairs.shift() ?? ''];
  const { o, r, ret } = single(kx, tw.filter(Boolean), 'set');
  if (ret) return ret;
  if (!can(kx, 'patch', r!, o!.metadata.name, o!.metadata.namespace)) return forbiddenRet(kx);
  const next = clone(o!);
  const spec = podSpecOf(next);
  if (what === 'image') {
    if (!pairs.length) return err(kx, 'error: at least one image update is required', 'kube.err.setUsage');
    for (const pair of pairs) {
      const [cname, image] = pair.split('=');
      const list = [...(spec.containers ?? []), ...(spec.initContainers ?? [])].filter((x: any) => cname === '*' || x.name === cname);
      if (!list.length) return err(kx, `error: unable to find container named "${cname}"`, 'kube.err.noContainer', { container: cname ?? '' });
      for (const x of list) x.image = image;
    }
  } else if (what === 'env') {
    for (const pair of pairs) {
      for (const ctr of spec.containers ?? []) {
        ctr.env = ctr.env ?? [];
        if (pair.endsWith('-')) ctr.env = ctr.env.filter((e: any) => e.name !== pair.slice(0, -1));
        else {
          const [k, ...v] = pair.split('=');
          const cur = ctr.env.find((e: any) => e.name === k);
          if (cur) cur.value = v.join('=');
          else ctr.env.push({ name: k, value: v.join('=') });
        }
      }
    }
  } else {
    const lim = flag(kx.p, 'limits');
    const req = flag(kx.p, 'requests');
    for (const ctr of spec.containers ?? []) {
      ctr.resources = ctr.resources ?? {};
      for (const [k, v] of [['limits', lim], ['requests', req]] as const) {
        if (!v) continue;
        ctr.resources[k] = { ...(ctr.resources[k] ?? {}), ...Object.fromEntries(v.split(',').map((x) => x.split('='))) };
      }
    }
  }
  if (comparableSpec(next) === comparableSpec(o!)) {
    say(kx, `${kindName(o!)} ${what === 'image' ? 'image' : what} updated`.replace(/ updated$/, ' updated'));
    return OK({ key: 'kube.explain.setImage', params: { name: o!.metadata.name } });
  }
  if (kx.dry === 'none') {
    const res = apiUpdate(kx.state, kx.c, next, { events: kx.ev });
    if (!res.ok) return err(kx, serverError(res), 'kube.err.server');
  }
  say(kx, `${kindName(o!)} ${what === 'image' ? 'image' : what === 'env' ? 'env' : 'resource requirements'} updated${dryNote(kx)}`);
  after(kx);
  return OK({ key: what === 'image' ? 'kube.explain.setImage' : 'kube.explain.setEnv', params: { name: o!.metadata.name } }, true);
}

function comparableSpec(o: KObject): string {
  return stableJson(o.spec);
}

export function patch(kx: Kx, words: string[]): Ret {
  const body = flag(kx.p, 'patch') ?? (kx.p.flags.p ? undefined : undefined);
  const raw = body ?? kx.p.words.find((w) => w.startsWith('{'));
  const { o, r, ret } = single(kx, words.filter((w) => !w.startsWith('{')), 'patch');
  if (ret) return ret;
  if (!raw) return err(kx, 'error: must specify --patch or --patch-file containing the contents of the patch', 'kube.err.patchUsage');
  let p: any;
  try {
    p = JSON.parse(raw);
  } catch {
    return err(kx, `error: unable to parse "${raw}": yaml: did not find expected node content`, 'kube.err.patchUsage');
  }
  if (!can(kx, 'patch', r!, o!.metadata.name, o!.metadata.namespace)) return forbiddenRet(kx);
  const next = deepMerge(clone(o!), p);
  if (stableJson(next) === stableJson(o!)) {
    say(kx, `${kindName(o!)} patched (no change)`);
    return OK({ key: 'kube.explain.patch', params: { name: o!.metadata.name } });
  }
  const res = apiUpdate(kx.state, kx.c, next, { strict: true, events: kx.ev, dryRun: kx.dry !== 'none' });
  if (!res.ok) return err(kx, serverError(res), 'kube.err.server');
  say(kx, `${kindName(o!)} patched${dryNote(kx)}`);
  after(kx);
  return OK({ key: 'kube.explain.patch', params: { name: o!.metadata.name } }, true);
}

// ---------------------------------------------------------------------------
// rollout

function rolloutMessage(d: KObject): { done: boolean; msg: string; error?: string } {
  const st = d.status ?? {};
  const name = d.metadata.name;
  if ((d.metadata.generation ?? 1) > (st.observedGeneration ?? 0)) return { done: false, msg: 'Waiting for deployment spec update to be observed...' };
  const prog = (st.conditions ?? []).find((x: any) => x.type === 'Progressing');
  if (prog?.reason === 'ProgressDeadlineExceeded') return { done: false, msg: '', error: `error: deployment "${name}" exceeded its progress deadline` };
  const want = d.spec.replicas ?? 1;
  const updated = st.updatedReplicas ?? 0;
  if (updated < want) return { done: false, msg: `Waiting for deployment "${name}" rollout to finish: ${updated} out of ${want} new replicas have been updated...` };
  if ((st.replicas ?? 0) > updated) return { done: false, msg: `Waiting for deployment "${name}" rollout to finish: ${(st.replicas ?? 0) - updated} old replicas are pending termination...` };
  if ((st.availableReplicas ?? 0) < updated) return { done: false, msg: `Waiting for deployment "${name}" rollout to finish: ${st.availableReplicas ?? 0} of ${updated} updated replicas are available...` };
  return { done: true, msg: `deployment "${name}" successfully rolled out` };
}

function workloadMessage(o: KObject): { done: boolean; msg: string } {
  if (o.kind === 'StatefulSet') {
    const want = o.spec.replicas ?? 1;
    const ready = o.status?.readyReplicas ?? 0;
    if (ready < want) return { done: false, msg: `Waiting for ${want - ready} pods to be ready...` };
    if ((o.status?.updatedReplicas ?? 0) < want) return { done: false, msg: `Waiting for partitioned roll out to finish: ${o.status?.updatedReplicas ?? 0} out of ${want} new pods have been updated...` };
    return { done: true, msg: `partitioned roll out complete: ${want} new pods have been updated...` };
  }
  const want = o.status?.desiredNumberScheduled ?? 0;
  const updated = o.status?.updatedNumberScheduled ?? 0;
  const avail = o.status?.numberAvailable ?? 0;
  if (updated < want) return { done: false, msg: `Waiting for daemon set "${o.metadata.name}" rollout to finish: ${updated} out of ${want} new pods have been updated...` };
  if (avail < want) return { done: false, msg: `Waiting for daemon set "${o.metadata.name}" rollout to finish: ${avail} of ${want} updated pods are available...` };
  return { done: true, msg: `daemon set "${o.metadata.name}" successfully rolled out` };
}

function parseTimeout(t: string | undefined, dflt: number): number {
  if (!t) return dflt;
  const m = /^(\d+)(s|m|h)?$/.exec(t);
  if (!m) return dflt;
  return Number(m[1]) * (m[2] === 'm' ? 60 : m[2] === 'h' ? 3600 : 1);
}

export function rollout(kx: Kx, words: string[]): Ret {
  const [sub, ...rest] = words;
  const { o, r, ret } = single(kx, rest, 'rollout');
  if (ret) return ret;
  if (!['Deployment', 'StatefulSet', 'DaemonSet'].includes(o!.kind)) return err(kx, `error: no rollout ${sub === 'history' ? 'history' : 'status'} found for ${kindName(o!)}`, 'kube.err.notRollout');
  const name = o!.metadata.name;
  switch (sub) {
    case 'status': {
      if (!can(kx, 'get', r!, name, o!.metadata.namespace)) return forbiddenRet(kx);
      const timeout = parseTimeout(flag(kx.p, 'timeout'), 900);
      let lastMsg = '';
      let started = false;
      for (let s = 0; s <= timeout; s++) {
        const cur = getObj(kx.c, o!.kind, o!.metadata.namespace, name);
        if (!cur) return err(kx, notFound(r!, name), 'kube.err.notFound', { what: name });
        const m = cur.kind === 'Deployment' ? rolloutMessage(cur) : workloadMessage(cur);
        if ('error' in m && m.error) return err(kx, String(m.error), 'kube.err.progressDeadline', { name });
        if (m.msg !== lastMsg) {
          say(kx, m.msg);
          lastMsg = m.msg;
        }
        if (m.done) return OK({ key: started ? 'kube.explain.rolloutStatusWaited' : 'kube.explain.rolloutStatus', params: { name } }, started);
        if (bool(kx.p, 'watch', true) === false) return { ok: false, stopped: true, explain: { key: 'kube.explain.rolloutStatusWaited', params: { name } } };
        tickOnce(kx.state, kx.ev);
        started = true;
      }
      return err(kx, 'error: timed out waiting for the condition', 'kube.err.timeout');
    }
    case 'history': {
      if (o!.kind !== 'Deployment') return err(kx, `error: this practice terminal shows rollout history for Deployments only`, 'kube.err.notRollout');
      const rss = ownedBy(kx.c, o!, 'ReplicaSet').sort((a, b) => revisionOf(a) - revisionOf(b));
      const rev = flag(kx.p, 'revision');
      if (rev) {
        const rs = rss.find((x) => revisionOf(x) === Number(rev));
        if (!rs) return err(kx, `error: unable to find the specified revision`, 'kube.err.noRevision', { rev });
        say(kx, `deployment.apps/${name} with revision #${rev}`);
        const t = rs.spec.template;
        const lines = ['Pod Template:'];
        lines.push(`  Labels:\t${Object.entries(t.metadata.labels ?? {}).map(([k, v]) => `${k}=${v}`).join('\n\t')}`);
        const cause = rs.metadata.annotations?.['kubernetes.io/change-cause'];
        if (cause) lines.push(`  Annotations:\tkubernetes.io/change-cause: ${cause}`);
        lines.push('  Containers:');
        for (const ctr of t.spec.containers ?? []) {
          lines.push(`   ${ctr.name}:`, `    Image:\t${ctr.image}`, `    Port:\t${ctr.ports?.[0] ? `${ctr.ports[0].containerPort}/${ctr.ports[0].protocol ?? 'TCP'}` : '<none>'}`, `    Host Port:\t${ctr.ports?.[0] ? `0/${ctr.ports[0].protocol ?? 'TCP'}` : '<none>'}`, '    Environment:\t<none>', '    Mounts:\t<none>');
        }
        lines.push('  Volumes:\t<none>', '  Node-Selectors:\t<none>', '  Tolerations:\t<none>', '');
        say(kx, lines.join('\n'));
        return OK({ key: 'kube.explain.rolloutHistory', params: { name } });
      }
      say(kx, `deployment.apps/${name} `);
      const rows = rss.map((x) => `${revisionOf(x)}\t${x.metadata.annotations?.['kubernetes.io/change-cause'] ?? '<none>'}`);
      say(kx, tabwrite(['REVISION\tCHANGE-CAUSE', ...rows], 0, 2).join('\n'));
      kx.out.push(line(''));
      return OK({ key: 'kube.explain.rolloutHistory', params: { name } });
    }
    case 'undo': {
      if (o!.kind !== 'Deployment') return err(kx, `error: this practice terminal undoes Deployments only`, 'kube.err.notRollout');
      if (!can(kx, 'patch', r!, name, o!.metadata.namespace)) return forbiddenRet(kx);
      const rss = ownedBy(kx.c, o!, 'ReplicaSet').sort((a, b) => revisionOf(b) - revisionOf(a));
      const to = flag(kx.p, 'to-revision');
      let target: KObject | undefined;
      if (to && to !== '0') {
        target = rss.find((x) => revisionOf(x) === Number(to));
        if (!target) return err(kx, `error: unable to find specified revision ${to} in history`, 'kube.err.noRevision', { rev: to });
      } else {
        target = rss[1];
        if (!target) return err(kx, `error: no rollout history found for deployment "${name}"`, 'kube.err.noHistory', { name });
      }
      const tmpl = clone(target.spec.template);
      delete tmpl.metadata.labels['pod-template-hash'];
      if (stableJson(tmpl) === stableJson(o!.spec.template)) {
        say(kx, `${kindName(o!)} skipped rollback (current template already matches revision ${revisionOf(target)})`);
        return OK({ key: 'kube.explain.rollbackSkipped', params: { name } });
      }
      const next = clone(o!);
      next.spec.template = tmpl;
      const cause = target.metadata.annotations?.['kubernetes.io/change-cause'];
      if (cause) next.metadata.annotations = { ...(next.metadata.annotations ?? {}), 'kubernetes.io/change-cause': cause };
      else if (next.metadata.annotations) delete next.metadata.annotations['kubernetes.io/change-cause'];
      if (kx.dry === 'none') apiUpdate(kx.state, kx.c, next, { events: kx.ev });
      say(kx, `${kindName(o!)} rolled back${dryNote(kx)}`);
      // Real kubectl warns when the object was last changed with `kubectl apply`.
      if (o!.metadata.annotations?.['kubectl.kubernetes.io/last-applied-configuration'] && kx.dry === 'none') {
        say(kx, '');
        say(
          kx,
          `Warning: resource ${r!.plural}/${name} was previously managed with 'kubectl apply'. Rolling back will not update the kubectl.kubernetes.io/last-applied-configuration annotation, which may cause unexpected behavior on future 'kubectl apply' operations. Consider using 'kubectl apply' with your previous configuration file instead.`,
          'yellow',
        );
      }
      after(kx);
      return OK({ key: 'kube.explain.rollback', params: { name, rev: String(revisionOf(target)) } }, true);
    }
    case 'restart': {
      if (!can(kx, 'patch', r!, name, o!.metadata.namespace)) return forbiddenRet(kx);
      const next = clone(o!);
      const t = next.spec.template;
      t.metadata = t.metadata ?? {};
      t.metadata.annotations = { ...(t.metadata.annotations ?? {}), 'kubectl.kubernetes.io/restartedAt': iso(kx.state.clock) };
      if (kx.dry === 'none') apiUpdate(kx.state, kx.c, next, { events: kx.ev });
      say(kx, `${kindName(o!)} restarted${dryNote(kx)}`);
      after(kx);
      return OK({ key: 'kube.explain.restart', params: { name } }, true);
    }
    case 'pause':
    case 'resume': {
      if (o!.kind !== 'Deployment') return err(kx, `error: ${kindName(o!)} is not supported for ${sub}`, 'kube.err.notRollout');
      const paused = Boolean(o!.spec.paused);
      if (sub === 'pause' && paused) return err(kx, `error: deployments.apps "${name}" is already paused`, 'kube.err.alreadyPaused');
      if (sub === 'resume' && !paused) return err(kx, `error: deployments.apps "${name}" is not paused`, 'kube.err.notPaused');
      const next = clone(o!);
      if (sub === 'pause') next.spec.paused = true;
      else delete next.spec.paused;
      apiUpdate(kx.state, kx.c, next, { events: kx.ev });
      say(kx, `${kindName(o!)} ${sub === 'pause' ? 'paused' : 'resumed'}`);
      after(kx);
      return OK({ key: sub === 'pause' ? 'kube.explain.pause' : 'kube.explain.resume', params: { name } }, true);
    }
    default:
      return err(kx, `error: unknown command "${sub ?? ''}" for "kubectl rollout"`, 'kube.err.rolloutUsage');
  }
}

// ---------------------------------------------------------------------------
// label / annotate

export function labelCmd(kx: Kx, words: string[], kind: 'label' | 'annotate'): Ret {
  const pairs = words.filter((w) => /=|-$/.test(w) && !w.includes('/') || /^[\w.-]+\/[\w.-]+(=.*|-)$/.test(w) && words.indexOf(w) > 0 && /=|-$/.test(w));
  const tw = words.filter((w) => !pairs.includes(w));
  const t = targets(kx, tw, { needName: true });
  if (t.error) return err(kx, t.error === 'needName' ? 'error: resource(s) were provided, but no name was specified' : t.error === 'noType' ? 'error: one or more resources must be specified as <resource> <name> or <resource>/<name>' : t.error, 'kube.err.labelUsage');
  if (!pairs.length) return err(kx, `error: at least one ${kind === 'label' ? 'label' : 'annotation'} update is required`, 'kube.err.labelUsage');
  const overwrite = bool(kx.p, 'overwrite');
  let ok = true;
  let changed = false;
  for (const g of t.list) {
    for (const m of g.missing) {
      say(kx, notFound(g.r, m));
      ok = false;
    }
    for (const o of g.objs) {
      if (!can(kx, 'patch', g.r, o.metadata.name, o.metadata.namespace)) {
        ok = false;
        continue;
      }
      const next = clone(o);
      const field = kind === 'label' ? 'labels' : 'annotations';
      const map: Record<string, string> = { ...(next.metadata[field] ?? {}) };
      let removedOnly = true;
      for (const p of pairs) {
        if (p.endsWith('-') && !p.includes('=')) {
          delete map[p.slice(0, -1)];
          continue;
        }
        removedOnly = false;
        const i = p.indexOf('=');
        const k = p.slice(0, i);
        const v = p.slice(i + 1);
        if (map[k] !== undefined && map[k] !== v && !overwrite) {
          return err(kx, `error: '${k}' already has a value (${map[k]}), and --overwrite is false`, 'kube.err.overwrite', { key: k });
        }
        map[k] = v;
      }
      next.metadata[field] = Object.keys(map).length ? map : undefined;
      if (!next.metadata[field]) delete next.metadata[field];
      const same = stableJson(next.metadata[field] ?? {}) === stableJson(o.metadata[field] ?? {});
      const res = same ? null : apiUpdate(kx.state, kx.c, next, { events: kx.ev, dryRun: kx.dry !== 'none' });
      if (res && !res.ok) {
        say(kx, serverError(res));
        ok = false;
        continue;
      }
      for (const w of res?.warnings ?? []) say(kx, w);
      const verb = kind === 'label' ? (same ? 'not labeled' : removedOnly ? 'unlabeled' : 'labeled') : same ? 'not annotated' : 'annotated';
      say(kx, `${kindName(o)} ${verb}${dryNote(kx)}`);
      if (!same) changed = true;
    }
  }
  after(kx);
  if (!ok) return { ok: false, explain: { key: 'kube.err.labelUsage' }, changed };
  return OK({ key: kind === 'label' ? 'kube.explain.label' : 'kube.explain.annotate' }, changed);
}

// ---------------------------------------------------------------------------
// expose, run, autoscale

export function expose(kx: Kx, words: string[]): Ret {
  const { o, ret } = single(kx, words, 'expose');
  if (ret) return ret;
  let selector: Record<string, string> | undefined;
  let ports: number[];
  if (o!.kind === 'Pod') {
    selector = o!.metadata.labels;
    ports = (o!.spec.containers ?? []).flatMap((c: any) => (c.ports ?? []).map((p: any) => p.containerPort));
  } else if (['Deployment', 'ReplicaSet', 'StatefulSet'].includes(o!.kind)) {
    if (o!.spec.selector?.matchExpressions) return err(kx, `error: couldn't convert expressions - "${JSON.stringify(o!.spec.selector.matchExpressions)}" to map-based selector format`, 'kube.err.exposeUsage');
    selector = o!.spec.selector?.matchLabels;
    ports = (o!.spec.template.spec.containers ?? []).flatMap((c: any) => (c.ports ?? []).map((p: any) => p.containerPort));
  } else if (o!.kind === 'Service') {
    selector = o!.spec.selector;
    ports = (o!.spec.ports ?? []).map((p: any) => p.port);
  } else return err(kx, `error: cannot expose a ${o!.kind}`, 'kube.err.exposeUsage');
  if (!selector || !Object.keys(selector).length) return err(kx, `error: couldn't retrieve selectors via --selector flag or introspection: the ${o!.kind} has no labels`, 'kube.err.exposeUsage');
  const portFlag = flag(kx.p, 'port');
  const port = portFlag ? Number(portFlag) : ports[0];
  if (!port) return err(kx, "error: couldn't find port via --port flag or introspection\nSee 'kubectl expose -h' for help and examples", 'kube.err.exposePort');
  const tp = flag(kx.p, 'target-port');
  const name = flag(kx.p, 'name') ?? o!.metadata.name;
  const type = flag(kx.p, 'type');
  const svc: KObject = {
    apiVersion: 'v1',
    kind: 'Service',
    metadata: { name, namespace: kx.ns, ...(o!.metadata.labels ? { labels: { ...o!.metadata.labels } } : {}) } as any,
    spec: { ports: [{ port, protocol: 'TCP', targetPort: tp ? (/^\d+$/.test(tp) ? Number(tp) : tp) : port }], selector: { ...selector }, ...(type ? { type } : {}) },
  };
  if (kx.dry === 'client') {
    if (!printIfOutput(kx, [svc])) say(kx, `service/${name} exposed (dry run)`);
    return OK({ key: 'kube.explain.dryRun' });
  }
  if (!can(kx, 'create', byKind('Service')!)) return forbiddenRet(kx);
  const res = apiCreate(kx.state, kx.c, svc, { events: kx.ev, dryRun: kx.dry === 'server' });
  if (!res.ok) return err(kx, serverError(res), res.status === 'AlreadyExists' ? 'kube.err.alreadyExists' : 'kube.err.server', { name });
  if (!printIfOutput(kx, [res.obj!])) say(kx, `service/${name} exposed${dryNote(kx)}`);
  after(kx);
  return OK({ key: 'kube.explain.expose', params: { name, port: String(port) } }, true);
}

export function runCmd(kx: Kx, words: string[]): Ret {
  const name = words[0];
  const image = flag(kx.p, 'image');
  if (!name) return err(kx, "error: NAME is required for run\nSee 'kubectl run -h' for help and examples", 'kube.err.runUsage');
  if (!image) return err(kx, 'error: required flag(s) "image" not set', 'kube.err.runUsage');
  const args = kx.p.after ?? [];
  const port = flag(kx.p, 'port');
  const env = flagAll(kx.p, 'env');
  const labels = flag(kx.p, 'labels');
  const restart = flag(kx.p, 'restart') ?? 'Always';
  const pod: KObject = {
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: { labels: labels ? Object.fromEntries(labels.split(',').map((x) => x.split('=') as [string, string])) : { run: name }, name, ...(kx.nsGiven ? { namespace: kx.ns } : {}) } as any,
    spec: {
      containers: [
        {
          ...(args.length ? (bool(kx.p, 'command') ? { command: args } : { args }) : {}),
          ...(env.length ? { env: env.map((e) => ({ name: e.split('=')[0], value: e.split('=').slice(1).join('=') })) } : {}),
          image,
          name,
          ...(port ? { ports: [{ containerPort: Number(port) }] } : {}),
          resources: {},
        },
      ],
      dnsPolicy: 'ClusterFirst',
      restartPolicy: restart,
    },
    status: {},
  };
  if (kx.dry === 'client') {
    if (!printIfOutput(kx, [pod])) say(kx, `pod/${name} created (dry run)`);
    return OK({ key: 'kube.explain.dryRun' });
  }
  if (!can(kx, 'create', byKind('Pod')!)) return forbiddenRet(kx);
  const input = clone(pod);
  delete input.status;
  input.metadata.namespace = kx.ns;
  const res = apiCreate(kx.state, kx.c, input, { events: kx.ev, dryRun: kx.dry === 'server' });
  for (const w of res.warnings) say(kx, w);
  if (!res.ok) return err(kx, serverError(res), res.status === 'AlreadyExists' ? 'kube.err.alreadyExists' : res.status === 'Forbidden' ? 'kube.err.admission' : 'kube.err.server', { name });
  if (!printIfOutput(kx, [res.obj!])) say(kx, `pod/${name} created${dryNote(kx)}`);
  after(kx);
  if (bool(kx.p, 'stdin') || bool(kx.p, 'tty')) {
    return { ok: true, stopped: true, changed: true, explain: { key: 'kube.explain.interactive', params: { cmd: 'kubectl run -it' } } };
  }
  return OK({ key: 'kube.explain.run', params: { name } }, true);
}

export function autoscale(kx: Kx, words: string[]): Ret {
  const { o, ret } = single(kx, words, 'autoscale');
  if (ret) return ret;
  const max = flag(kx.p, 'max');
  if (!max) return err(kx, '--max=MAXPODS is required and must be at least 1, max: -1', 'kube.err.autoscaleUsage');
  const cpu = flag(kx.p, 'cpu') ?? flag(kx.p, 'cpu-percent');
  const pct = cpu ? Number(String(cpu).replace('%', '')) : undefined;
  const hpa: KObject = {
    apiVersion: 'autoscaling/v2',
    kind: 'HorizontalPodAutoscaler',
    metadata: { name: flag(kx.p, 'name') ?? o!.metadata.name, namespace: kx.ns } as any,
    spec: {
      maxReplicas: Number(max),
      ...(pct !== undefined ? { metrics: [{ resource: { name: 'cpu', target: { averageUtilization: pct, type: 'Utilization' } }, type: 'Resource' }] } : {}),
      minReplicas: Number(flag(kx.p, 'min') ?? 1),
      scaleTargetRef: { apiVersion: o!.apiVersion, kind: o!.kind, name: o!.metadata.name },
    },
  };
  if (!can(kx, 'create', byKind('HorizontalPodAutoscaler')!)) return forbiddenRet(kx);
  const res = apiCreate(kx.state, kx.c, hpa, { events: kx.ev, dryRun: kx.dry !== 'none' });
  if (!res.ok) return err(kx, serverError(res), 'kube.err.server');
  say(kx, `horizontalpodautoscaler.autoscaling/${hpa.metadata.name} autoscaled${dryNote(kx)}`);
  after(kx);
  return OK({ key: 'kube.explain.autoscale', params: { name: o!.metadata.name } }, true);
}

// ---------------------------------------------------------------------------
// Nodes: cordon, uncordon, drain, taint

function nodeArg(kx: Kx, words: string[]): KObject | Ret {
  const name = (words[0] ?? '').replace(/^(node|nodes|no)\//, '');
  if (!name) return err(kx, 'error: USAGE: cordon NODE [flags]', 'kube.err.nodeUsage');
  const n = getObj(kx.c, 'Node', undefined, name);
  if (!n) return err(kx, `Error from server (NotFound): nodes "${name}" not found`, 'kube.err.notFound', { what: name });
  return n;
}

export function cordon(kx: Kx, words: string[], on: boolean): Ret {
  const n = nodeArg(kx, words);
  if ('ok' in n) return n as Ret;
  if (!can(kx, 'patch', byKind('Node')!, n.metadata.name)) return forbiddenRet(kx);
  if (Boolean(n.spec.unschedulable) === on) {
    say(kx, `node/${n.metadata.name} already ${on ? 'cordoned' : 'uncordoned'}`);
    return OK({ key: on ? 'kube.explain.cordon' : 'kube.explain.uncordon', params: { node: n.metadata.name } });
  }
  if (kx.dry === 'none') {
    if (on) n.spec.unschedulable = true;
    else delete n.spec.unschedulable;
    updateObj(kx.c, n, kx.ev);
  }
  say(kx, `node/${n.metadata.name} ${on ? 'cordoned' : 'uncordoned'}${dryNote(kx)}`);
  after(kx);
  return OK({ key: on ? 'kube.explain.cordon' : 'kube.explain.uncordon', params: { node: n.metadata.name } }, true);
}

export function drain(kx: Kx, words: string[]): Ret {
  const n = nodeArg(kx, words);
  if ('ok' in n) return n as Ret;
  const node = n.metadata.name;
  if (!can(kx, 'patch', byKind('Node')!, node)) return forbiddenRet(kx);
  if (!n.spec.unschedulable) {
    n.spec.unschedulable = true;
    updateObj(kx.c, n, kx.ev);
    say(kx, `node/${node} cordoned`);
  } else say(kx, `node/${node} already cordoned`);
  const pods = listObjs(kx.c, 'Pod').filter((p) => p.spec.nodeName === node && !isTerminating(p) && p.status?.phase !== 'Succeeded' && p.status?.phase !== 'Failed');
  const isDs = (p: KObject) => p.metadata.ownerReferences?.some((r) => r.kind === 'DaemonSet');
  const isMirror = (p: KObject) => Boolean(p.metadata.annotations?.['kubernetes.io/config.mirror']) || (!p.metadata.ownerReferences?.length && p.metadata.namespace === 'kube-system' && p.metadata.labels?.tier === 'control-plane');
  const ds = pods.filter(isDs);
  const naked = pods.filter((p) => !p.metadata.ownerReferences?.length && !isMirror(p));
  const emptyDir = pods.filter((p) => !isDs(p) && (p.spec.volumes ?? []).some((v: any) => v.emptyDir));
  const problems: string[] = [];
  if (ds.length && !bool(kx.p, 'ignore-daemonsets')) problems.push(`cannot delete DaemonSet-managed Pods (use --ignore-daemonsets to ignore): ${ds.map((p) => `${p.metadata.namespace}/${p.metadata.name}`).join(', ')}`);
  if (naked.length && !bool(kx.p, 'force')) problems.push(`cannot delete Pods that declare no controller (use --force to override): ${naked.map((p) => `${p.metadata.namespace}/${p.metadata.name}`).join(', ')}`);
  if (emptyDir.length && !bool(kx.p, 'delete-emptydir-data')) problems.push(`cannot delete Pods with local storage (use --delete-emptydir-data to override): ${emptyDir.map((p) => `${p.metadata.namespace}/${p.metadata.name}`).join(', ')}`);
  if (problems.length) {
    say(kx, `error: unable to drain node "${node}" due to error: ${problems.join(', ')}, continuing command...`);
    say(kx, 'There are pending nodes to be drained:');
    say(kx, ` ${node}`);
    for (const p of problems) say(kx, p);
    after(kx);
    return { ok: false, changed: true, explain: { key: ds.length && !bool(kx.p, 'ignore-daemonsets') ? 'kube.err.drainDaemonSets' : 'kube.err.drainBlocked', params: { node } } };
  }
  if (ds.length) say(kx, `Warning: ignoring DaemonSet-managed Pods: ${ds.map((p) => `${p.metadata.namespace}/${p.metadata.name}`).join(', ')}`);
  if (naked.length) say(kx, `Warning: deleting Pods that declare no controller: ${naked.map((p) => `${p.metadata.namespace}/${p.metadata.name}`).join(', ')}`);
  const toEvict = pods.filter((p) => !isDs(p) && !isMirror(p));
  for (const p of toEvict) say(kx, `evicting pod ${p.metadata.namespace}/${p.metadata.name}`);
  // Evictions respect PodDisruptionBudgets: retry every 5 seconds.
  const pending = new Set(toEvict.map((p) => p.metadata.uid));
  for (let tries = 0; tries < 24 && pending.size; tries++) {
    for (const p of toEvict) {
      if (!pending.has(p.metadata.uid)) continue;
      const pdb = listObjs(kx.c, 'PodDisruptionBudget', p.metadata.namespace).find((b) => selectorMatches(b.spec.selector, p.metadata.labels));
      if (pdb && (pdb.status?.disruptionsAllowed ?? 0) < 1 && podReady(p)) {
        if (tries === 0 || tries % 4 === 0) say(kx, `error when evicting pods/"${p.metadata.name}" -n "${p.metadata.namespace}" (will retry after 5s): Cannot evict pod as it would violate the pod's disruption budget.`);
        continue;
      }
      apiDelete(kx.state, kx.c, 'Pod', p.metadata.namespace, p.metadata.name, { by: 'eviction', events: kx.ev });
      if (pdb) pdb.status.disruptionsAllowed = Math.max(0, (pdb.status.disruptionsAllowed ?? 0) - 1);
      pending.delete(p.metadata.uid);
    }
    reconcileAll(kx.state, kx.ev);
    if (pending.size) for (let s = 0; s < 5; s++) tickOnce(kx.state, kx.ev);
  }
  waitGone(kx, toEvict.filter((p) => !pending.has(p.metadata.uid)), 60);
  for (const p of toEvict) if (!pending.has(p.metadata.uid)) say(kx, `pod/${p.metadata.name} evicted`);
  if (pending.size) {
    say(kx, `error: unable to drain node "${node}" due to error: [error when evicting pods/"${toEvict.find((p) => pending.has(p.metadata.uid))!.metadata.name}" -n "${toEvict[0]!.metadata.namespace}": global timeout reached: 2m0s], continuing command...`);
    return { ok: false, changed: true, explain: { key: 'kube.err.drainPdb', params: { node } } };
  }
  say(kx, `node/${node} drained`);
  return OK({ key: 'kube.explain.drain', params: { node } }, true);
}

export function taint(kx: Kx, words: string[]): Ret {
  const [kindWord, nodeName, ...specs] = words;
  if (!kindWord || !/^(node|nodes|no)$/.test(kindWord.split('/')[0]!)) return err(kx, 'error: at least one taint update is required', 'kube.err.taintUsage');
  const nodeWords = kindWord.includes('/') ? [kindWord] : [nodeName ?? ''];
  const rest = kindWord.includes('/') ? [nodeName ?? '', ...specs].filter(Boolean) : specs;
  const n = nodeArg(kx, nodeWords);
  if ('ok' in n) return n as Ret;
  if (!rest.length) return err(kx, 'error: at least one taint update is required', 'kube.err.taintUsage');
  if (!can(kx, 'patch', byKind('Node')!, n.metadata.name)) return forbiddenRet(kx);
  let taints: any[] = [...(n.spec.taints ?? [])];
  let removed = false;
  for (const s of rest) {
    const m = /^([\w./-]+)(?:=([\w.-]*))?(?::(NoSchedule|PreferNoSchedule|NoExecute))?(-)?$/.exec(s);
    if (!m) return err(kx, `error: invalid taint spec: ${s}, unknown taint format`, 'kube.err.taintUsage');
    const [, key, value, effect, minus] = m;
    if (minus) {
      const before = taints.length;
      taints = taints.filter((t) => !(t.key === key && (!effect || t.effect === effect)));
      if (taints.length === before) return err(kx, `error: taint "${key}${effect ? `:${effect}` : ''}" not found`, 'kube.err.taintUsage');
      removed = true;
    } else {
      if (!effect) return err(kx, `error: invalid taint spec: ${s}, unknown taint effect`, 'kube.err.taintUsage');
      const same = taints.find((t) => t.key === key && t.effect === effect);
      if (same && !bool(kx.p, 'overwrite')) return err(kx, `error: node ${n.metadata.name} already has ${key} taint(s) with same effect(s) and --overwrite is false`, 'kube.err.taintUsage');
      taints = taints.filter((t) => !(t.key === key && t.effect === effect));
      taints.push({ effect, key, ...(value ? { value } : {}), ...(effect === 'NoExecute' ? { timeAdded: iso(kx.state.clock) } : {}) });
    }
  }
  n.spec.taints = taints.length ? taints : undefined;
  if (!taints.length) delete n.spec.taints;
  updateObj(kx.c, n, kx.ev);
  say(kx, `node/${n.metadata.name} ${removed ? 'untainted' : 'tainted'}`);
  after(kx);
  return OK({ key: removed ? 'kube.explain.untaint' : 'kube.explain.taint', params: { node: n.metadata.name } }, true);
}

// ---------------------------------------------------------------------------
// diff, kustomize

export function diff(kx: Kx): Ret {
  const { docs, error } = docsFromFlags(kx);
  if (error) return error;
  let any = false;
  const tsText = '2026-10-31 09:00:00.000000000 +0800';
  const liveDir = `/tmp/LIVE-${Math.floor(1e9 + (kx.state.counter * 7919) % 9e8)}`;
  const mergedDir = `/tmp/MERGED-${Math.floor(1e9 + (kx.state.counter * 104729) % 9e8)}`;
  for (const d of docs) {
    const bad = preflight(kx, d);
    if (bad) return err(kx, bad, 'kube.err.yaml', { file: d.file });
    const o = d.obj;
    const r = byKind(o.kind)!;
    const live = getObj(kx.c, o.kind, o.metadata.namespace, o.metadata.name);
    const fname = `${r.group ? `${r.group}.` : ''}${r.version}.${o.kind}.${o.metadata.namespace ? `${o.metadata.namespace}.` : ''}${o.metadata.name}`;
    let merged: KObject | undefined;
    if (live) {
      const last = live.metadata.annotations?.['kubectl.kubernetes.io/last-applied-configuration'];
      const next = threeWay(clone(live), last ? JSON.parse(last) : {}, clone(o));
      next.metadata.annotations = { ...(next.metadata.annotations ?? {}), 'kubectl.kubernetes.io/last-applied-configuration': lastApplied(o) };
      const res = apiUpdate(kx.state, kx.c, next, { dryRun: true, strict: true });
      if (!res.ok) return err(kx, serverError(res), 'kube.err.server');
      merged = res.obj!;
    } else {
      const input = clone(o);
      input.metadata.annotations = { ...(input.metadata.annotations ?? {}), 'kubectl.kubernetes.io/last-applied-configuration': lastApplied(o) };
      const res = apiCreate(kx.state, kx.c, input, { dryRun: true, strict: true });
      if (!res.ok) return err(kx, serverError(res), 'kube.err.server');
      merged = res.obj!;
    }
    const strip = (x: KObject | undefined) => {
      if (!x) return '';
      const y = forOutput(x);
      return toYaml(y);
    };
    const a = strip(live);
    const b = strip(merged);
    if (a === b) continue;
    any = true;
    say(kx, `diff -u -N ${liveDir}/${fname} ${mergedDir}/${fname}`);
    say(kx, `--- ${liveDir}/${fname}\t${tsText}`);
    say(kx, `+++ ${mergedDir}/${fname}\t${tsText}`);
    const ops = diffLines(a, b);
    kx.out.push(...renderHunks(ops, makeHunks(ops, 3)));
  }
  if (!any) return OK({ key: 'kube.explain.diffNone' });
  return { ok: false, stopped: true, exitCode: 1, explain: { key: 'kube.explain.diff' } };
}

export function kustomize(kx: Kx, words: string[]): Ret {
  const dir = absPath(kx.state, words[0] ?? '.');
  const built = kustomizeBuild(kx.state, dir);
  if (built.error) return err(kx, built.error, 'kube.err.kustomize', { dir: words[0] ?? '.' });
  say(kx, kustomizeText(built.objs).replace(/\n$/, ''));
  return OK({ key: 'kube.explain.kustomize', params: { count: String(built.objs.length) } });
}

// ---------------------------------------------------------------------------
// wait

export function wait(kx: Kx, words: string[]): Ret {
  const forWhat = flag(kx.p, 'for');
  if (!forWhat) return err(kx, 'error: --for must be specified', 'kube.err.waitUsage');
  const timeout = parseTimeout(flag(kx.p, 'timeout'), 30);
  const t = targets(kx, words);
  if (t.error) return err(kx, t.error === 'noType' ? 'error: resource(s) were provided, but no name was specified' : t.error, 'kube.err.waitUsage');
  const objs = t.list.flatMap((g) => g.objs);
  if (!objs.length) return err(kx, 'error: no matching resources found', 'kube.err.waitNone');
  const cond = /^condition=([\w]+)(?:=(\w+))?$/i.exec(forWhat);
  const jp = /^jsonpath=\{?([^}=]+)\}?=(.*)$/.exec(forWhat);
  const met = (o: KObject): boolean => {
    const cur = getObj(kx.c, o.kind, o.metadata.namespace, o.metadata.name);
    if (forWhat === 'delete') return !cur || cur.metadata.uid !== o.metadata.uid;
    if (!cur) return false;
    if (cond) return (cur.status?.conditions ?? []).some((x: any) => x.type.toLowerCase() === cond[1]!.toLowerCase() && x.status === (cond[2] ?? 'True'));
    if (jp) {
      // `.status.containerStatuses[0].restartCount`: dots, plus [n] for a list item.
      const v = jp[1]!
        .replace(/^\./, '')
        .split('.')
        .flatMap((k) => k.split(/\[(\d+)\]/).filter(Boolean))
        .reduce<any>((acc, k) => acc?.[k], cur);
      return String(v) === jp[2]!.replace(/^'|'$/g, '');
    }
    return false;
  };
  const done = new Set<string>();
  for (let s = 0; s <= timeout; s++) {
    for (const o of objs) {
      if (!done.has(o.metadata.uid) && met(o)) {
        done.add(o.metadata.uid);
        say(kx, `${kindName(o)} condition met`);
      }
    }
    if (done.size === objs.length) return OK({ key: 'kube.explain.wait' }, s > 0);
    tickOnce(kx.state, kx.ev);
  }
  const first = objs.find((o) => !done.has(o.metadata.uid))!;
  return err(kx, `error: timed out waiting for the condition on ${byKind(first.kind)!.plural}/${first.metadata.name}`, 'kube.err.timeout');
}

// ---------------------------------------------------------------------------
// exec, port-forward, debug

function findPod(kx: Kx, word: string): KObject | Ret {
  const [t, n] = word.includes('/') ? word.split('/') : ['pod', word];
  const r = resource(kx, t!);
  if (!r) return err(kx, `error: the server doesn't have a resource type "${t}"`, 'kube.err.unknownType', { type: t! });
  if (r.kind === 'Pod') {
    const p = getObj(kx.c, 'Pod', kx.ns, n!);
    return p ?? err(kx, notFound(r, n!), 'kube.err.notFound', { what: word });
  }
  const owner = getObj(kx.c, r.kind, kx.ns, n!);
  if (!owner) return err(kx, notFound(r, n!), 'kube.err.notFound', { what: word });
  const sel = r.kind === 'Service' ? (p: KObject) => Object.entries(owner.spec.selector ?? {}).every(([k, v]) => p.metadata.labels?.[k] === v) : (p: KObject) => selectorMatches(owner.spec.selector, p.metadata.labels);
  const pods = listObjs(kx.c, 'Pod', kx.ns).filter((p) => sel(p) && !isTerminating(p)).sort((a, b) => Number(podReady(b)) - Number(podReady(a)) || a.metadata.name.localeCompare(b.metadata.name));
  if (!pods.length) return err(kx, 'error: timed out waiting for the condition', 'kube.err.noPods');
  return pods[0]!;
}

/** Run one command inside a container (what the practice cluster's containers can do). */
function inContainer(kx: Kx, pod: KObject, ctrName: string, argv: string[]): { lines: string[]; code: number } {
  const ctr = (pod.spec.containers ?? []).find((c: any) => c.name === ctrName);
  const b = behaviorOf({ state: kx.state, c: kx.c, ev: kx.ev }, pod, ctr);
  const rt = kx.c.pods[pod.metadata.uid]?.containers[ctrName];
  let [cmd, ...args] = argv;
  if ((cmd === 'sh' || cmd === '/bin/sh' || cmd === 'bash') && args[0] === '-c') {
    const parts = (args[1] ?? '').trim().split(/\s+/);
    [cmd, ...args] = parts;
  }
  const notFoundCmd = (c: string) => ({
    lines: [`error: Internal error occurred: Internal error occurred: error executing command in container: failed to exec in container: failed to start exec "${'0'.repeat(0)}${rt ? 'c0ffee' : ''}": OCI runtime exec failed: exec failed: unable to start container process: exec: "${c}": executable file not found in $PATH: unknown`],
    code: 126,
  });
  if (!cmd) return { lines: [], code: 0 };
  const tools = b?.tools ?? [];
  const base = cmd.split('/').pop()!;
  if (!tools.includes(base) && !['sh', 'echo', 'true', 'false'].includes(base) && !(base === 'touch' && tools.includes('sh'))) return notFoundCmd(cmd);
  // `echo text > file` / `>> file` (inside sh -c) and `touch file`: written where Kubernetes keeps it.
  const redirect = args.findIndex((a) => /^>>?/.test(a));
  if (base === 'echo' && redirect >= 0) {
    const op = args[redirect]!;
    const target = op.replace(/^>>?/, '') || args[redirect + 1] || '';
    const text = `${args.slice(0, redirect).join(' ').replace(/^(['"])(.*)\1$/, '$2')}\n`;
    const e = writeFile(kx.c, pod, ctr, rt, target, text, op.startsWith('>>') ? 'append' : 'write', 'sh');
    return e ? { lines: [e], code: e.startsWith('touch') ? 1 : 2 } : { lines: [], code: 0 };
  }
  if (base === 'touch') {
    for (const target of args.filter((a) => !a.startsWith('-'))) {
      const e = writeFile(kx.c, pod, ctr, rt, target, '', 'touch', 'touch');
      if (e) return { lines: [e], code: 1 };
    }
    return { lines: [], code: 0 };
  }
  const env = (pod.spec.containers ?? []).find((c: any) => c.name === ctrName)?.env ?? [];
  const t = kx.state.clock - (rt?.startedAt ?? kx.state.clock);
  const files = b ? filesAt(b, t) : new Set<string>();
  switch (base) {
    case 'curl': {
      const o = parseCurl(args);
      if ('error' in o) return { lines: [o.error], code: 2 };
      const r = httpGet({ state: kx.state, c: kx.c, ev: kx.ev }, { kind: 'pod', pod }, o.url, { ...(o.host ? { hostHeader: o.host } : {}), events: kx.ev });
      const out = curlOutput(o, r, kx.state.clock, true);
      return { lines: out.lines, code: out.code };
    }
    case 'wget': {
      const url = args.filter((a) => !a.startsWith('-') && a !== '-').pop() ?? '';
      const r = httpGet({ state: kx.state, c: kx.c, ev: kx.ev }, { kind: 'pod', pod }, url, { events: kx.ev });
      return wgetOutput(url, r, args.some((a) => /^-q/.test(a)));
    }
    case 'cat': {
      const path = args[0] ?? '';
      const written = readFile(kx.c, pod, ctr, rt, path);
      if (written !== undefined) return { lines: written === '' ? [] : written.replace(/\n$/, '').split('\n'), code: 0 };
      if (b?.files[path] !== undefined) return { lines: b.files[path]!.replace(/\n$/, '').split('\n'), code: 0 };
      if (files.has(path)) return { lines: [], code: 0 };
      if (path === '/etc/hostname') return { lines: [pod.metadata.name], code: 0 };
      if (path === '/var/run/secrets/kubernetes.io/serviceaccount/namespace') return { lines: [pod.metadata.namespace!], code: 0 };
      if (path === '/etc/resolv.conf') return { lines: [`search ${pod.metadata.namespace}.svc.cluster.local svc.cluster.local cluster.local`, 'nameserver 10.96.0.10', 'options ndots:5'], code: 0 };
      return { lines: [`cat: can't open '${path}': No such file or directory`], code: 1 };
    }
    case 'ls': {
      const dir = (args.find((a) => !a.startsWith('-')) ?? '/').replace(/\/$/, '');
      const names = new Set<string>();
      for (const f of [...Object.keys(b?.files ?? {}), ...files]) if (f.startsWith(`${dir}/`)) names.add(f.slice(dir.length + 1).split('/')[0]!);
      const vol = listDir(kx.c, pod, ctr, rt, dir);
      vol.names.forEach((x) => names.add(x));
      if (dir === '' || dir === '/') ['bin', 'dev', 'etc', 'home', 'proc', 'root', 'sys', 'tmp', 'usr', 'var'].forEach((x) => names.add(x));
      if (!names.size && vol.mounted) return { lines: [], code: 0 };
      if (!names.size) return { lines: [`ls: ${dir}: No such file or directory`], code: 1 };
      // Not a terminal (kubectl exec without -t), so ls prints one name per line.
      return { lines: [...names].sort(), code: 0 };
    }
    case 'env':
    case 'printenv': {
      const vars: Record<string, string> = { PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', HOSTNAME: pod.metadata.name };
      // The variables this instance started with: a changed ConfigMap only shows after a restart.
      if (rt?.env) Object.assign(vars, rt.env);
      else for (const e of env) if (e.value !== undefined) vars[e.name] = e.value;
      const { env: resolved } = { env: vars };
      // Service links: every Service in the namespace gives *_SERVICE_HOST/PORT.
      if (pod.spec.enableServiceLinks !== false) {
        for (const s of listObjs(kx.c, 'Service', pod.metadata.namespace)) {
          if (!s.spec.clusterIP || s.spec.clusterIP === 'None') continue;
          const n = s.metadata.name.toUpperCase().replace(/-/g, '_');
          resolved[`${n}_SERVICE_HOST`] = s.spec.clusterIP;
          resolved[`${n}_SERVICE_PORT`] = String(s.spec.ports?.[0]?.port ?? '');
        }
      }
      if (base === 'printenv' && args[0]) return resolved[args[0]] !== undefined ? { lines: [resolved[args[0]]!], code: 0 } : { lines: [], code: 1 };
      return { lines: Object.entries(resolved).map(([k, v]) => `${k}=${v}`), code: 0 };
    }
    case 'hostname':
      return { lines: [pod.metadata.name], code: 0 };
    case 'echo':
      return { lines: [args.join(' ')], code: 0 };
    case 'true':
      return { lines: [], code: 0 };
    case 'false':
      return { lines: [], code: 1 };
    case 'date':
      return { lines: [new Date(kx.state.clock * 1000).toUTCString().replace(/^(\w+), (\d+) (\w+) (\d+) ([\d:]+) GMT$/, '$1 $3 $2 $5 UTC $4')], code: 0 };
    case 'nslookup': {
      const name = args[0] ?? '';
      const svc = listObjs(kx.c, 'Service').find((s) => [s.metadata.name, `${s.metadata.name}.${s.metadata.namespace}`, `${s.metadata.name}.${s.metadata.namespace}.svc`, `${s.metadata.name}.${s.metadata.namespace}.svc.cluster.local`].includes(name) && (name.includes('.') || s.metadata.namespace === pod.metadata.namespace));
      const head = ['Server:\t\t10.96.0.10', 'Address:\t10.96.0.10:53', ''];
      if (!svc) return { lines: [...head, `** server can't find ${name}.${pod.metadata.namespace}.svc.cluster.local: NXDOMAIN`, ''], code: 1 };
      return { lines: [...head, `Name:\t${svc.metadata.name}.${svc.metadata.namespace}.svc.cluster.local`, `Address: ${svc.spec.clusterIP}`, ''], code: 0 };
    }
    case 'ps':
      return { lines: ['PID   USER     TIME  COMMAND', `    1 root      0:00 ${b?.process ?? '?'}`], code: 0 };
    case 'sh':
    case 'bash':
      return { lines: [], code: 0 };
    default:
      return notFoundCmd(cmd);
  }
}

export function exec(kx: Kx, words: string[]): Ret {
  const target = words[0];
  if (!target) return err(kx, "error: pod, type/name or --filename must be specified\nSee 'kubectl exec -h' for help and examples", 'kube.err.execUsage');
  const argv = kx.p.after;
  if (!argv) {
    if (words.length > 1) return err(kx, `error: exec [POD] [COMMAND] is not supported anymore. Use exec [POD] -- [COMMAND] instead\nSee 'kubectl exec -h' for help and examples`, 'kube.err.execDashDash');
    return err(kx, "error: you must specify at least one command for the container\nSee 'kubectl exec -h' for help and examples", 'kube.err.execUsage');
  }
  const pod = findPod(kx, target);
  if ('ok' in pod) return pod as Ret;
  if (!can(kx, 'create', byKind('Pod')!, pod.metadata.name, pod.metadata.namespace, 'exec')) return forbiddenRet(kx);
  const want = flag(kx.p, 'container');
  const cs: any[] = pod.spec.containers ?? [];
  const ctr = want ?? pod.metadata.annotations?.['kubectl.kubernetes.io/default-container'] ?? cs[0]?.name;
  if (!want && cs.length > 1) say(kx, `Defaulted container "${ctr}" out of: ${cs.map((c) => c.name).join(', ')}`);
  if (!cs.some((c) => c.name === ctr)) return err(kx, `error: unable to upgrade connection: container ${ctr} not found in pod ${pod.metadata.name}_${pod.metadata.namespace}`, 'kube.err.execNoContainer');
  if (pod.status?.phase === 'Succeeded' || pod.status?.phase === 'Failed') return err(kx, `error: cannot exec into a container in a completed pod; current phase is ${pod.status.phase}`, 'kube.err.execNotRunning');
  const rt = kx.c.pods[pod.metadata.uid]?.containers[ctr];
  if (!rt || rt.startedAt === null) return err(kx, `error: unable to upgrade connection: container not found ("${ctr}")`, 'kube.err.execNotRunning');
  const interactive = (bool(kx.p, 'stdin') || bool(kx.p, 'tty')) && /^(\/bin\/)?(sh|bash|ash)$/.test(argv[0] ?? '') && argv.length === 1;
  if (interactive) return { ok: true, stopped: true, explain: { key: 'kube.explain.interactive', params: { cmd: `kubectl exec -it ${pod.metadata.name} -- ${argv[0]}` } } };
  const etcd = etcdInPod(kx.state, kx.c, pod, argv);
  if (etcd) {
    for (const l of etcd.lines) say(kx, l);
    for (const l of etcd.notes) say(kx, l, 'dim');
    if (etcd.code === 130) return { ok: false, stopped: true, exitCode: 130, explain: { key: etcd.key, params: etcd.params ?? {} } };
    if (etcd.code !== 0) {
      say(kx, `command terminated with exit code ${etcd.code}`);
      return { ok: false, exitCode: etcd.code, explain: { key: etcd.key, params: etcd.params ?? {} } };
    }
    return { ok: true, changed: Boolean(etcd.changed), explain: { key: etcd.key, params: etcd.params ?? {} } };
  }
  const r = inContainer(kx, pod, ctr, argv);
  for (const l of r.lines) say(kx, l);
  if (r.code !== 0) {
    if (r.code !== 126) say(kx, `command terminated with exit code ${r.code}`);
    else say(kx, `command terminated with exit code 126`);
    const reason = argv.includes('curl') || argv.includes('wget') ? 'kube.explain.execHttpFail' : 'kube.explain.execFail';
    return { ok: false, stopped: reason === 'kube.explain.execHttpFail', exitCode: r.code, explain: { key: reason, params: { code: String(r.code) } } };
  }
  return OK({ key: argv.includes('curl') || argv.includes('wget') ? 'kube.explain.execHttp' : 'kube.explain.exec', params: { pod: pod.metadata.name } });
}

export function portForward(kx: Kx, words: string[]): Ret {
  const [target, ...ports] = words;
  if (!target || !ports.length) return err(kx, "error: TYPE/NAME and list of ports are required for port-forward\nSee 'kubectl port-forward -h' for help and examples", 'kube.err.portForwardUsage');
  const pod = findPod(kx, target);
  if ('ok' in pod) return pod as Ret;
  if (pod.status?.phase !== 'Running') return err(kx, `error: unable to forward port because pod is not running. Current status=${pod.status?.phase ?? 'Pending'}`, 'kube.err.portForwardNotRunning');
  if (!can(kx, 'create', byKind('Pod')!, pod.metadata.name, pod.metadata.namespace, 'portforward')) return forbiddenRet(kx);
  const svc = target.startsWith('svc/') || target.startsWith('service/') || target.startsWith('services/') ? getObj(kx.c, 'Service', kx.ns, target.split('/')[1]!) : undefined;
  for (const spec of ports) {
    const [l, rr] = spec.includes(':') ? spec.split(':') : [spec, spec];
    const local = l ? Number(l) : 30000 + Math.floor((kx.state.counter * 31) % 30000);
    let remote = Number(rr);
    if (svc) {
      const sp = (svc.spec.ports ?? []).find((p: any) => p.port === remote) ?? svc.spec.ports?.[0];
      if (sp) remote = typeof sp.targetPort === 'number' ? sp.targetPort : remote;
    }
    kx.state.forwards = kx.state.forwards.filter((f) => !(f.local === local && f.context === kx.ctxName));
    kx.state.forwards.push({ context: kx.ctxName, local, namespace: pod.metadata.namespace!, pod: pod.metadata.name, podPort: remote, target });
    say(kx, `Forwarding from 127.0.0.1:${local} -> ${remote}`);
    say(kx, `Forwarding from [::1]:${local} -> ${remote}`);
    kx.ev.push({ type: 'portForward', local, target });
  }
  return OK({ key: 'kube.explain.portForward', params: { target, pod: pod.metadata.name } }, true);
}

export function debug(kx: Kx, words: string[]): Ret {
  const target = words[0] ?? '';
  const image = flag(kx.p, 'image') ?? 'busybox:1.37';
  if (target.startsWith('node/')) {
    const node = target.slice(5);
    if (!getObj(kx.c, 'Node', undefined, node)) return err(kx, `Error from server (NotFound): nodes "${node}" not found`, 'kube.err.notFound', { what: target });
    const name = `node-debugger-${node}-${randomSuffix(kx.state)}`;
    apiCreate(kx.state, kx.c, { apiVersion: 'v1', kind: 'Pod', metadata: { name, namespace: kx.ns } as any, spec: { containers: [{ name: 'debugger', image, stdin: true, tty: true }], hostIPC: true, hostNetwork: true, hostPID: true, nodeName: node, restartPolicy: 'Never', volumes: [{ name: 'host-root', hostPath: { path: '/' } }] } }, { events: kx.ev });
    say(kx, `Creating debugging pod ${name} with container debugger on node ${node}.`);
    after(kx);
    return { ok: true, stopped: true, changed: true, explain: { key: 'kube.explain.debugNode', params: { node } } };
  }
  const pod = findPod(kx, target);
  if ('ok' in pod) return pod as Ret;
  const tgt = flag(kx.p, 'target');
  const name = `debugger-${randomSuffix(kx.state)}`;
  const next = clone(pod);
  next.spec.ephemeralContainers = [...(next.spec.ephemeralContainers ?? []), { image, imagePullPolicy: 'IfNotPresent', name, resources: {}, stdin: true, ...(tgt ? { targetContainerName: tgt } : {}), terminationMessagePath: '/dev/termination-log', terminationMessagePolicy: 'File', tty: true }];
  kx.c.objects[`Pod/${pod.metadata.namespace}/${pod.metadata.name}`] = next;
  if (tgt) say(kx, `Targeting container "${tgt}". If you don't see processes from this container it may be because the container runtime doesn't support this feature.`);
  say(kx, `Defaulting debug container name to ${name}.`);
  if (bool(kx.p, 'stdin') || bool(kx.p, 'tty')) say(kx, "If you don't see a command prompt, try pressing enter.");
  return { ok: true, stopped: true, changed: true, explain: { key: 'kube.explain.debug', params: { pod: pod.metadata.name } } };
}

/** Pods for a Service that would answer (used by pictures and goals). */
export function serviceBackends(kx: Kx, svc: KObject): KObject[] {
  return listObjs(kx.c, 'Pod', svc.metadata.namespace).filter((p) => Object.entries(svc.spec.selector ?? {}).every(([k, v]) => p.metadata.labels?.[k] === v) && podReady(p));
}

export { podStatusText, labelText, parseSelector, matches, fromIso };
