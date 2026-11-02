// Shared pieces for kubectl commands: the command context, RBAC checks,
// finding objects from `TYPE NAME`, `TYPE/NAME`, `-l`, and reading manifest files.
import { line, lines } from '../../git-sim/output';
import { authorize, forbiddenText, impersonate, type Identity } from '../rbac';
import { byKind, findResource, GATEWAY_KINDS, qualified, RESOURCES, type ResourceType } from '../resources';
import { listObjs } from '../store';
import type { Cluster, Explain, KObject, KubeEvent, KubeState, Line } from '../types';
import { matches, parseSelector } from '../util';
import { parseManifests } from '../yaml';
import { bool, flag, flagAll, type Parsed } from './args';

export interface Kx {
  state: KubeState;
  c: Cluster;
  ctxName: string;
  ns: string;
  /** -n was typed. */
  nsGiven: boolean;
  allNs: boolean;
  who: Identity;
  ev: KubeEvent[];
  out: Line[];
  p: Parsed;
  raw: string;
  dry: 'none' | 'client' | 'server';
}

export interface Ret {
  ok: boolean;
  explain?: Explain;
  stopped?: boolean;
  exitCode?: number;
  changed?: boolean;
}

export const OK = (explain?: Explain, changed = false): Ret => ({ ok: true, ...(explain ? { explain } : {}), changed });

export function say(kx: Kx, text: string, color?: Parameters<typeof line>[1]): void {
  kx.out.push(...lines(text, color));
}

/** A failed command: print the message, explain it kindly. */
export function err(kx: Kx, text: string, key: string, params: Record<string, string> = {}, code = key): Ret {
  say(kx, text);
  kx.ev.push({ type: 'error', code });
  return { ok: false, explain: { key, params } };
}

export function identityFor(state: KubeState, ctxName: string, p: Parsed): Identity {
  const as = flag(p, 'as');
  if (as) return impersonate(as, flagAll(p, 'as-group'));
  const user = state.contexts[ctxName]?.user ?? '';
  return state.users[user] ?? { user: 'kubernetes-admin', groups: ['kubeadm:cluster-admins', 'system:authenticated'] };
}

/** RBAC check before an API call. Prints the API server's forbidden message when denied. */
export function can(kx: Kx, verb: string, r: ResourceType, name?: string, ns?: string, sub?: string): boolean {
  const req = { verb, group: r.group, resource: r.plural, ...(sub ? { subresource: sub } : {}), ...(r.namespaced ? { namespace: ns ?? kx.ns } : {}), ...(name ? { name } : {}) };
  if (authorize(kx.c, kx.who, req)) return true;
  say(kx, `Error from server (Forbidden): ${forbiddenText(kx.who, req, r.plural)}`);
  kx.ev.push({ type: 'forbidden', user: kx.who.user, verb, resource: sub ? `${r.plural}/${sub}` : r.plural, ...(r.namespaced ? { namespace: ns ?? kx.ns } : {}) });
  return false;
}

export function resource(kx: Kx, word: string): ResourceType | undefined {
  return findResource(word, kx.c.addons.gateway);
}

const ALL_KINDS = ['Pod', 'Service', 'DaemonSet', 'Deployment', 'ReplicaSet', 'StatefulSet', 'HorizontalPodAutoscaler', 'CronJob', 'Job'];

export interface Target {
  r: ResourceType;
  objs: KObject[];
  /** Names that were asked for but don't exist. */
  missing: string[];
  named: boolean;
}

/**
 * Turn `pods`, `pod shop-1 shop-2`, `deploy/shop svc/shop`, `deploy,svc`, `all` (+ -l, -A) into objects.
 * Returns an error message when a type is unknown.
 */
export function targets(kx: Kx, words: string[], opts: { needName?: boolean } = {}): { list: Target[]; error?: string; multiKind: boolean } {
  const list: Target[] = [];
  if (!words.length) return { list, multiKind: false, error: 'noType' };
  const selText = flag(kx.p, 'selector');
  const reqs = selText !== undefined ? parseSelector(selText) : null;
  if (selText !== undefined && !reqs) return { list, multiKind: false, error: `error: unable to parse requirement: invalid label selector: "${selText}"` };
  const fieldSel = flag(kx.p, 'field-selector');
  const pick = (r: ResourceType): KObject[] => {
    let objs = listObjs(kx.c, r.kind, r.namespaced && !kx.allNs ? kx.ns : undefined);
    if (reqs) objs = objs.filter((o) => matches(o.metadata.labels, reqs));
    if (fieldSel) {
      for (const part of fieldSel.split(',')) {
        const m = /^([\w.]+)(!=|==|=)(.*)$/.exec(part);
        if (!m) continue;
        const get = (o: KObject) => m[1]!.split('.').reduce<any>((v, k) => v?.[k], o);
        objs = objs.filter((o) => (m[2] === '!=' ? String(get(o) ?? '') !== m[3] : String(get(o) ?? '') === m[3]));
      }
    }
    return objs;
  };
  const slash = words.every((w) => w.includes('/'));
  if (slash) {
    for (const w of words) {
      const [t, name] = w.split('/') as [string, string];
      const r = resource(kx, t);
      if (!r) return { list, multiKind: false, error: `error: the server doesn't have a resource type "${t}"` };
      let tg = list.find((x) => x.r === r);
      if (!tg) list.push((tg = { r, objs: [], missing: [], named: true }));
      const o = listObjs(kx.c, r.kind, r.namespaced ? kx.ns : undefined).find((x) => x.metadata.name === name);
      if (o) tg.objs.push(o);
      else tg.missing.push(name);
    }
    return { list, multiKind: list.length > 1 };
  }
  const [typeWord, ...names] = words;
  const types = typeWord!.split(',');
  const rs: ResourceType[] = [];
  for (const t of types) {
    if (t === 'all') {
      for (const k of ALL_KINDS) rs.push(byKind(k)!);
      continue;
    }
    const r = resource(kx, t);
    if (!r) return { list, multiKind: false, error: `error: the server doesn't have a resource type "${t}"` };
    rs.push(r);
  }
  for (const r of rs) {
    if (names.length) {
      const objs: KObject[] = [];
      const missing: string[] = [];
      for (const n of names) {
        const o = listObjs(kx.c, r.kind, r.namespaced ? kx.ns : undefined).find((x) => x.metadata.name === n);
        if (o) objs.push(o);
        else missing.push(n);
      }
      list.push({ r, objs, missing, named: true });
    } else {
      if (opts.needName && !reqs && !bool(kx.p, 'all')) return { list, multiKind: false, error: 'needName' };
      list.push({ r, objs: pick(r), missing: [], named: false });
    }
  }
  return { list, multiKind: rs.length > 1 || types.includes('all') };
}

/** "pods "x" not found" style. */
export function notFound(r: ResourceType, name: string): string {
  return `Error from server (NotFound): ${r.plural}${r.group ? `.${r.group}` : ''} "${name}" not found`;
}

export function kindName(o: KObject): string {
  return `${qualified(byKind(o.kind)!)}/${o.metadata.name}`;
}

// ---------------------------------------------------------------------------
// Files (the learner's folder)

export function absPath(state: KubeState, p: string): string {
  if (p.startsWith('/')) return normalize(p);
  if (p === '~' || p.startsWith('~/')) return normalize(state.home + p.slice(1));
  return normalize(`${state.cwd}/${p}`);
}

function normalize(p: string): string {
  const parts: string[] = [];
  for (const x of p.split('/')) {
    if (!x || x === '.') continue;
    if (x === '..') parts.pop();
    else parts.push(x);
  }
  return `/${parts.join('/')}`;
}

export function isDir(state: KubeState, abs: string): boolean {
  return state.dirs.includes(abs) || Object.keys(state.files).some((f) => f.startsWith(`${abs}/`));
}

export interface FileDoc {
  file: string;
  obj: KObject;
}

/** Read manifests from a file or folder (`-f`). */
export function readManifests(kx: Kx, path: string): { docs: FileDoc[]; error?: string } {
  if (/^https?:\/\//.test(path)) return { docs: [], error: 'url' };
  const abs = absPath(kx.state, path);
  let files: string[];
  if (kx.state.files[abs] !== undefined) files = [abs];
  else if (isDir(kx.state, abs)) {
    files = Object.keys(kx.state.files)
      .filter((f) => f.startsWith(`${abs}/`) && /\.(ya?ml|json)$/.test(f) && (bool(kx.p, 'recursive') || !f.slice(abs.length + 1).includes('/')))
      .sort();
  } else return { docs: [], error: `error: the path "${path}" does not exist` };
  const docs: FileDoc[] = [];
  for (const f of files) {
    const shown = f === abs ? path : `${path.replace(/\/$/, '')}/${f.slice(abs.length + 1)}`;
    const text = kx.state.files[f]!;
    let parsed;
    if (f.endsWith('.json')) {
      try {
        const v = JSON.parse(text);
        parsed = { docs: v.kind === 'List' ? v.items : [v] };
      } catch (e) {
        return { docs, error: `error: error parsing ${shown}: ${(e as Error).message}` };
      }
    } else parsed = parseManifests(text);
    if (parsed.error) return { docs, error: `error: error parsing ${shown}: error converting YAML to JSON: ${parsed.error}` };
    for (const d of parsed.docs as KObject[]) {
      if (d.kind === 'List' && Array.isArray(d.items)) for (const it of d.items) docs.push({ file: shown, obj: it });
      else docs.push({ file: shown, obj: d });
    }
  }
  return { docs };
}

/** Check the basics kubectl checks before sending (apiVersion, kind, namespace match). */
export function preflight(kx: Kx, d: FileDoc): string | null {
  const o = d.obj;
  const missing = [!o.apiVersion ? 'apiVersion not set' : '', !o.kind ? 'kind not set' : ''].filter(Boolean);
  if (missing.length) return `error: error validating "${d.file}": error validating data: [${missing.join(', ')}]; if you choose to ignore these errors, turn validation off with --validate=false`;
  const r = byKind(o.kind);
  const known = r && (r.group ? `${r.group}/${r.version}` : r.version) === o.apiVersion && (!GATEWAY_KINDS.includes(o.kind) || kx.c.addons.gateway);
  if (!known) {
    return `error: resource mapping not found for name: "${o.metadata?.name ?? ''}" namespace: "${o.metadata?.namespace ?? ''}" from "${d.file}": no matches for kind "${o.kind}" in version "${o.apiVersion}"\nensure CRDs are installed first`;
  }
  o.metadata = o.metadata ?? ({} as any);
  if (r!.namespaced) {
    if (o.metadata.namespace && kx.nsGiven && o.metadata.namespace !== kx.ns) {
      return `error: the namespace from the provided object "${o.metadata.namespace}" does not match the namespace "${kx.ns}". You must pass '--namespace=${o.metadata.namespace}' to perform this operation.`;
    }
    o.metadata.namespace = o.metadata.namespace || kx.ns;
  }
  return null;
}

export { RESOURCES, line, lines };
