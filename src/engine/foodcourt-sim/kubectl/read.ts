// kubectl commands that read: get (and -w), describe, logs, top, auth, config,
// explain, api-resources, version, cluster-info, events.
import { line } from '../../git-sim/output';
import { stamp } from '../controllers/kubelet';
import { podCpu, podMemoryMi } from '../controllers/misc';
import { tickOnce } from '../clock';
import { authorize, listRules } from '../rbac';
import { RESOURCES, byKind, qualified } from '../resources';
import { listObjs, ownedBy } from '../store';
import type { KObject } from '../types';
import { cpuMilli, fromIso, memBytes } from '../util';
import { toYaml } from '../yaml';
import { bool, flag, type Parsed } from './args';
import { can, err, notFound, OK, resource, say, targets, type Kx, type Ret } from './ctx';
import { describe } from './describe';
import { EXPLAIN } from './explain-data';
import { customColumns, headerFor, jsonPathEval, jsonPathTemplate, listJson, listYaml, nameOf, rowFor, table } from './print';

const NO_TYPE = `You must specify the type of resource to get. Use "kubectl api-resources" for a complete list of supported resources.

error: Required resource not specified.
Use "kubectl explain <resource>" for a detailed description of that resource (e.g. kubectl explain pods).
See 'kubectl get -h' for help and examples`;

function sortObjs(kx: Kx, objs: KObject[]): KObject[] {
  const by = flag(kx.p, 'sort-by');
  if (!by) return objs;
  return [...objs].sort((a, b) => {
    const x = jsonPathEval(a, by.replace(/^\{|\}$/g, ''))[0];
    const y = jsonPathEval(b, by.replace(/^\{|\}$/g, ''))[0];
    if (typeof x === 'number' && typeof y === 'number') return x - y;
    return String(x ?? '').localeCompare(String(y ?? ''));
  });
}

/** Print objects in the chosen output format. Returns false on a bad -o. */
export function printObjects(kx: Kx, groups: { kind: string; objs: KObject[] }[], opts: { prefix: boolean; single: boolean }): Ret {
  const o = flag(kx.p, 'output') ?? '';
  const all = groups.flatMap((g) => g.objs);
  if (o === 'yaml') {
    say(kx, listYaml(all).replace(/\n$/, ''));
    return OK({ key: 'kube.explain.getYaml' });
  }
  if (o === 'json') {
    say(kx, listJson(all, opts.single));
    return OK({ key: 'kube.explain.getYaml' });
  }
  if (o === 'name') {
    for (const x of all) say(kx, nameOf(x));
    return OK({ key: 'kube.explain.getName' });
  }
  if (o.startsWith('jsonpath=') || o.startsWith('jsonpath-as-json=') || o.startsWith("jsonpath='")) {
    const tpl = o.slice(o.indexOf('=') + 1).replace(/^'|'$/g, '');
    const root = opts.single && all.length === 1 ? JSON.parse(JSON.stringify(all[0])) : { apiVersion: 'v1', items: all.map((x) => JSON.parse(JSON.stringify(x))), kind: 'List', metadata: { resourceVersion: '' } };
    const r = jsonPathTemplate(root, tpl);
    if (!r.ok) return err(kx, r.error, 'kube.err.jsonpath');
    if (r.text) kx.out.push(...r.text.replace(/\n$/, '').split('\n').map((t) => line(t)));
    return OK({ key: 'kube.explain.jsonpath' });
  }
  if (o.startsWith('custom-columns=')) {
    say(kx, customColumns(all, o.slice('custom-columns='.length)).join('\n'));
    return OK({ key: 'kube.explain.getTable' });
  }
  if (o && o !== 'wide') return err(kx, `error: unable to match a printer suitable for the output format "${o}", allowed formats are: custom-columns,custom-columns-file,go-template,go-template-file,json,jsonpath,jsonpath-as-json,jsonpath-file,kyaml,name,template,templatefile,wide,yaml`, 'kube.err.badOutput', { format: o });
  const wide = o === 'wide';
  const labels = bool(kx.p, 'show-labels');
  const noHeaders = bool(kx.p, 'no-headers');
  let firstTable = true;
  for (const g of groups) {
    if (!g.objs.length) continue;
    if (!firstTable) kx.out.push(line(''));
    firstTable = false;
    const rows = g.objs.map((x) => rowFor(x, kx.state, kx.c, { wide, allNs: kx.allNs, labels, prefix: opts.prefix }));
    const t = table(headerFor(g.kind, { wide, allNs: kx.allNs, labels }), rows);
    say(kx, (noHeaders ? t.slice(1) : t).join('\n'));
  }
  return OK({ key: 'kube.explain.getTable' });
}

function noneFound(kx: Kx, r: { namespaced: boolean } | undefined): void {
  say(kx, kx.allNs || !r?.namespaced ? 'No resources found' : `No resources found in ${kx.ns} namespace.`);
}

export function get(kx: Kx, words: string[]): Ret {
  const t = targets(kx, words);
  if (t.error === 'noType') return err(kx, NO_TYPE, 'kube.err.noType');
  if (t.error) return err(kx, t.error, 'kube.err.unknownType', { type: words[0] ?? '' });
  for (const g of t.list) if (!can(kx, g.named ? 'get' : 'list', g.r, undefined, kx.allNs ? undefined : kx.ns)) return { ok: false, explain: { key: 'kube.err.forbidden', params: { user: kx.who.user } } };
  const missing = t.list.flatMap((g) => g.missing.map((n) => notFound(g.r, n)));
  const groups = t.list.map((g) => ({ kind: g.r.kind, objs: sortObjs(kx, g.objs) }));
  const total = groups.reduce((n, g) => n + g.objs.length, 0);
  const single = t.list.length === 1 && t.list[0]!.named && words.length <= 2 && !words[0]!.includes(',');
  let ret: Ret = OK({ key: 'kube.explain.getTable' });
  if (total) ret = printObjects(kx, groups, { prefix: t.multiKind || (words.length > 1 && words.every((w) => w.includes('/')) && t.list.length > 1), single });
  else if (!missing.length && !flag(kx.p, 'output')?.startsWith('json')) noneFound(kx, t.list[0]?.r);
  for (const m of missing) say(kx, m);
  if (missing.length) return { ok: false, explain: { key: 'kube.err.notFound', params: { what: words.join(' ') } } };
  if (!ret.ok) return ret;
  if (bool(kx.p, 'watch') || bool(kx.p, 'watch-only')) return watch(kx, t.list.map((g) => g.r.kind), words);
  const explain = total === 0 ? { key: 'kube.explain.getNone', params: { ns: kx.ns } } : (ret.explain ?? { key: 'kube.explain.getTable' });
  if (t.list.length === 1 && t.list[0]!.r.kind === 'Pod' && !flag(kx.p, 'output')) return OK({ key: 'kube.explain.getPods' });
  return OK(explain);
}

/** `-w`: a short scripted watch — time passes and each change prints a new row. */
function watch(kx: Kx, kinds: string[], words: string[]): Ret {
  const rowsNow = () => {
    const t = targets(kx, words);
    const out = new Map<string, string[]>();
    for (const g of t.list) for (const o of g.objs) out.set(`${o.kind}/${o.metadata.namespace}/${o.metadata.name}`, rowFor(o, kx.state, kx.c, { wide: flag(kx.p, 'output') === 'wide', allNs: kx.allNs }));
    return out;
  };
  const header = headerFor(kinds[0]!, { wide: flag(kx.p, 'output') === 'wide', allNs: kx.allNs });
  let last = rowsNow();
  const printed: string[][] = [];
  let quiet = 0;
  for (let s = 0; s < 90 && quiet < 15; s++) {
    tickOnce(kx.state, kx.ev);
    const now = rowsNow();
    let changed = false;
    for (const [k, row] of now) {
      const before = last.get(k);
      const strip = (r: string[] | undefined) => (r ? r.filter((_, i) => header[i] !== 'AGE').join('|') : '');
      if (strip(before) !== strip(row)) {
        printed.push(row);
        changed = true;
      }
    }
    for (const [k, row] of last) {
      if (!now.has(k)) {
        printed.push(row);
        changed = true;
      }
    }
    last = now;
    quiet = changed ? 0 : quiet + 1;
  }
  if (printed.length) {
    // Watch rows line up with the first table's columns.
    const all = table(header, printed);
    say(kx, all.slice(1).join('\n'));
  }
  say(kx, '^C', 'dim');
  return OK({ key: 'kube.explain.watch' }, true);
}

export function describeCmd(kx: Kx, words: string[]): Ret {
  const t = targets(kx, words);
  if (t.error === 'noType') return err(kx, 'error: You must specify the type of resource to describe. Use "kubectl api-resources" for a complete list of supported resources.', 'kube.err.noType');
  if (t.error) return err(kx, t.error, 'kube.err.unknownType', { type: words[0] ?? '' });
  const parts: string[][] = [];
  let missing = false;
  for (const g of t.list) {
    if (!can(kx, 'get', g.r)) return { ok: false, explain: { key: 'kube.err.forbidden', params: { user: kx.who.user } } };
    for (const o of g.objs) parts.push(describe(kx.state, kx.c, o));
    for (const m of g.missing) {
      say(kx, notFound(g.r, m));
      missing = true;
    }
  }
  if (!parts.length && !missing) {
    noneFound(kx, t.list[0]?.r);
    return OK({ key: 'kube.explain.getNone', params: { ns: kx.ns } });
  }
  parts.forEach((p, i) => {
    if (i) kx.out.push(line(''), line(''));
    say(kx, p.join('\n'));
  });
  if (missing) return { ok: false, explain: { key: 'kube.err.notFound', params: { what: words.join(' ') } } };
  return OK({ key: t.list[0]?.r.kind === 'Pod' ? 'kube.explain.describePod' : 'kube.explain.describe' });
}

// ---------------------------------------------------------------------------
// logs

function podsFor(kx: Kx, word: string): { pods: KObject[]; error?: string; what: string } {
  if (word.includes('/')) {
    const [t, name] = word.split('/') as [string, string];
    const r = resource(kx, t);
    if (!r) return { pods: [], error: `error: the server doesn't have a resource type "${t}"`, what: word };
    if (r.kind === 'Pod') {
      const p = listObjs(kx.c, 'Pod', kx.ns).find((x) => x.metadata.name === name);
      return p ? { pods: [p], what: word } : { pods: [], error: notFound(r, name), what: word };
    }
    const owner = listObjs(kx.c, r.kind, kx.ns).find((x) => x.metadata.name === name);
    if (!owner) return { pods: [], error: notFound(r, name), what: word };
    let pods = ownedBy(kx.c, owner, 'Pod');
    if (r.kind === 'Deployment') pods = ownedBy(kx.c, owner, 'ReplicaSet').flatMap((rs) => ownedBy(kx.c, rs, 'Pod'));
    if (r.kind === 'Service') pods = listObjs(kx.c, 'Pod', kx.ns).filter((p) => Object.entries(owner.spec.selector ?? {}).every(([k, v]) => p.metadata.labels?.[k] === v));
    return { pods: pods.sort((a, b) => a.metadata.name.localeCompare(b.metadata.name)), what: word };
  }
  const p = listObjs(kx.c, 'Pod', kx.ns).find((x) => x.metadata.name === word);
  return p ? { pods: [p], what: word } : { pods: [], error: notFound(byKind('Pod')!, word), what: word };
}

function containerFor(kx: Kx, pod: KObject): { name: string; note?: string } | { error: string } {
  const want = flag(kx.p, 'container');
  const all = [...(pod.spec.initContainers ?? []), ...(pod.spec.containers ?? [])];
  if (want) {
    if (!all.some((c: any) => c.name === want)) {
      return { error: `error: container ${want} is not valid for pod ${pod.metadata.name}` };
    }
    return { name: want };
  }
  const cs: any[] = pod.spec.containers ?? [];
  const dflt = pod.metadata.annotations?.['kubectl.kubernetes.io/default-container'] ?? cs[0]?.name;
  if (cs.length + (pod.spec.initContainers?.length ?? 0) > 1 && !pod.metadata.annotations?.['kubectl.kubernetes.io/default-container']) {
    const names = [...cs.map((c) => c.name), ...(pod.spec.initContainers ?? []).map((c: any) => `${c.name} (init)`)];
    return { name: dflt, note: `Defaulted container "${dflt}" out of: ${names.join(', ')}` };
  }
  return { name: dflt };
}

export function logs(kx: Kx, words: string[]): Ret {
  const sel = flag(kx.p, 'selector');
  let pods: KObject[];
  if (sel !== undefined && !words.length) {
    const t = targets(kx, ['pods']);
    pods = t.list[0]?.objs ?? [];
    if (!pods.length) {
      say(kx, `No resources found in ${kx.ns} namespace.`);
      return OK({ key: 'kube.explain.getNone', params: { ns: kx.ns } });
    }
  } else {
    if (!words.length) return err(kx, "error: expected 'logs [-f] [-p] (POD | TYPE/NAME) [-c CONTAINER]'.\nPOD or TYPE/NAME is a required argument for the logs command\nSee 'kubectl logs -h' for help and examples", 'kube.err.logsUsage');
    const f = podsFor(kx, words[0]!);
    if (f.error) return err(kx, f.error, 'kube.err.notFound', { what: words[0]! });
    if (!f.pods.length) return err(kx, `error: timed out waiting for the condition`, 'kube.err.noPods');
    pods = f.pods;
    if (words[0]!.includes('/') && !words[0]!.startsWith('pod/') && !words[0]!.startsWith('pods/') && !words[0]!.startsWith('po/') && pods.length > 1) {
      say(kx, `Found ${pods.length} pods, using pod/${pods[0]!.metadata.name}`);
      pods = [pods[0]!];
    }
    if (words[1]) kx.p.flags.container = [words[1]];
  }
  if (!can(kx, 'get', byKind('Pod')!, pods[0]!.metadata.name, undefined, 'log')) return { ok: false, explain: { key: 'kube.err.forbidden', params: { user: kx.who.user } } };
  const previous = bool(kx.p, 'previous');
  const tail = flag(kx.p, 'tail');
  const follow = bool(kx.p, 'follow');
  const printFrom = (pod: KObject, since = -Infinity): { ok: boolean; last: number } => {
    const ch = containerFor(kx, pod);
    if ('error' in ch) {
      say(kx, ch.error);
      return { ok: false, last: since };
    }
    if (ch.note && since === -Infinity) say(kx, ch.note);
    const rt = kx.c.pods[pod.metadata.uid]?.containers[ch.name];
    const status = [...(pod.status?.containerStatuses ?? []), ...(pod.status?.initContainerStatuses ?? [])].find((s: any) => s.name === ch.name);
    if (previous) {
      if (!rt?.previousLogs) {
        say(kx, `Error from server (BadRequest): previous terminated container "${ch.name}" in pod "${pod.metadata.name}" not found`);
        return { ok: false, last: since };
      }
      for (const l of rt.previousLogs) say(kx, stamp(l.text, l.t));
      return { ok: true, last: since };
    }
    if (!rt || (rt.startedAt === null && !rt.logs.length)) {
      const w = status?.state?.waiting?.reason ?? 'ContainerCreating';
      const why = w === 'ErrImagePull' || w === 'ImagePullBackOff' ? 'trying and failing to pull image' : w;
      say(kx, `Error from server (BadRequest): container "${ch.name}" in pod "${pod.metadata.name}" is waiting to start: ${why}`);
      return { ok: false, last: since };
    }
    let entries = rt.logs.filter((l) => l.t > since);
    if (tail !== undefined && since === -Infinity && Number(tail) >= 0) entries = entries.slice(-Number(tail));
    for (const l of entries) say(kx, stamp(l.text, l.t));
    return { ok: true, last: entries.length ? entries[entries.length - 1]!.t : since };
  };
  let ok = true;
  const lasts: number[] = [];
  for (const pod of pods.slice(0, 5)) {
    const r = printFrom(pod);
    ok = ok && r.ok;
    lasts.push(r.last);
  }
  if (!ok) return { ok: false, explain: { key: previous ? 'kube.err.noPrevious' : 'kube.err.logsWaiting' } };
  if (follow) {
    // A short scripted stream: 20 seconds pass, new lines appear, then Ctrl+C.
    for (let s = 0; s < 20; s++) {
      tickOnce(kx.state, kx.ev);
      pods.slice(0, 5).forEach((pod, i) => {
        const rt = kx.c.pods[pod.metadata.uid]?.containers[(containerFor(kx, pod) as { name: string }).name];
        if (!rt) return;
        for (const l of rt.logs.filter((x) => x.t > lasts[i]!)) {
          say(kx, stamp(l.text, l.t));
          lasts[i] = l.t;
        }
      });
    }
    say(kx, '^C', 'dim');
    return OK({ key: 'kube.explain.logsFollow' }, true);
  }
  return OK({ key: previous ? 'kube.explain.logsPrevious' : 'kube.explain.logs' });
}

// ---------------------------------------------------------------------------
// top

export function top(kx: Kx, words: string[]): Ret {
  const what = words[0] ?? '';
  if (!kx.c.addons.metricsServer) return err(kx, 'error: Metrics API not available', 'kube.err.noMetrics');
  const ctx = { state: kx.state, c: kx.c, ev: kx.ev };
  if (/^(node|nodes|no)$/.test(what)) {
    const rows = listObjs(kx.c, 'Node').map((n) => {
      const pods = listObjs(kx.c, 'Pod').filter((p) => p.spec.nodeName === n.metadata.name);
      const cpu = pods.reduce((s, p) => s + podCpu(ctx, p), 0) + 60;
      const mem = pods.reduce((s, p) => s + podMemoryMi(ctx, p), 0) + 420;
      const capC = cpuMilli(n.status.allocatable.cpu);
      const capM = memBytes(n.status.allocatable.memory) / 1024 ** 2;
      return [n.metadata.name, `${cpu}m`, `${Math.floor((cpu / capC) * 100)}%`, `${Math.round(mem)}Mi`, `${Math.floor((mem / capM) * 100)}%`];
    });
    say(kx, table(['NAME', 'CPU(cores)', 'CPU(%)', 'MEMORY(bytes)', 'MEMORY(%)'], rows).join('\n'));
    return OK({ key: 'kube.explain.topNodes' });
  }
  if (/^(pod|pods|po)$/.test(what)) {
    let pods = listObjs(kx.c, 'Pod', kx.allNs ? undefined : kx.ns).filter((p) => p.status?.phase === 'Running');
    if (words[1]) pods = pods.filter((p) => p.metadata.name === words[1]);
    const t = flag(kx.p, 'selector') !== undefined ? targets(kx, ['pods']).list[0]?.objs ?? [] : pods;
    pods = pods.filter((p) => t.includes(p));
    if (!pods.length) {
      say(kx, `No resources found in ${kx.ns} namespace.`);
      return OK({ key: 'kube.explain.getNone', params: { ns: kx.ns } });
    }
    const rows = pods.map((p) => [...(kx.allNs ? [p.metadata.namespace!] : []), p.metadata.name, `${Math.max(1, podCpu(ctx, p))}m`, `${Math.max(1, Math.round(podMemoryMi(ctx, p)))}Mi`]);
    say(kx, table([...(kx.allNs ? ['NAMESPACE'] : []), 'NAME', 'CPU(cores)', 'MEMORY(bytes)'], rows).join('\n'));
    return OK({ key: 'kube.explain.topPods' });
  }
  return err(kx, `error: unknown command "${what}" for "kubectl top"`, 'kube.err.topUsage');
}

// ---------------------------------------------------------------------------
// auth

export function auth(kx: Kx, words: string[]): Ret {
  const [sub, ...rest] = words;
  if (sub === 'whoami') {
    say(kx, table(['ATTRIBUTE', 'VALUE'], [['Username', kx.who.user], ['Groups', `[${kx.who.groups.join(' ')}]`]]).join('\n'));
    return OK({ key: 'kube.explain.whoami' });
  }
  if (sub !== 'can-i') return err(kx, `error: unknown command "${sub ?? ''}" for "kubectl auth"`, 'kube.err.authUsage');
  if (bool(kx.p, 'list')) {
    const rows = listRules(kx.c, kx.who, kx.ns).map((r) => [r.resource, '[]', `[${r.names.join(' ')}]`, `[${r.verbs.join(' ')}]`]);
    rows.push(['selfsubjectreviews.authentication.k8s.io', '[]', '[]', '[create]'], ['selfsubjectaccessreviews.authorization.k8s.io', '[]', '[]', '[create]']);
    say(kx, table(['Resources', 'Non-Resource URLs', 'Resource Names', 'Verbs'], rows).join('\n'));
    return OK({ key: 'kube.explain.canIList' });
  }
  const [verb, what] = rest;
  if (!verb || !what) return err(kx, 'error: you must specify two arguments: verb resource or verb resource/resourceName.\nSee \'kubectl auth can-i -h\' for help and examples', 'kube.err.canIUsage');
  const [resWord, name] = what.split('/') as [string, string | undefined];
  const [base, sub2] = resWord.includes('/') ? resWord.split('/') : [resWord, flag(kx.p, 'subresource')];
  if (base === '*') {
    // `kubectl auth can-i '*' '*'`: everything, everywhere.
    const yes = authorize(kx.c, kx.who, { verb, group: '*', resource: '*', ...(kx.allNs ? {} : { namespace: kx.ns }) });
    say(kx, yes ? 'yes' : 'no');
    return yes ? OK({ key: 'kube.explain.canIYes', params: { verb, what } }) : { ok: false, stopped: true, exitCode: 1, explain: { key: 'kube.explain.canINo', params: { verb, what } } };
  }
  const r = resource(kx, base!);
  if (!r) {
    say(kx, `Warning: the server doesn't have a resource type '${base}'`);
    say(kx, '');
    say(kx, 'no');
    return { ok: false, stopped: true, exitCode: 1, explain: { key: 'kube.explain.canINo', params: { verb, what } } };
  }
  if (!r.namespaced && (kx.nsGiven || true) && !kx.allNs) {
    if (kx.nsGiven || r.kind !== 'Namespace') {
      say(kx, `Warning: resource '${r.plural}' is not namespace scoped`);
      say(kx, '');
    }
  }
  const req = { verb, group: r.group, resource: r.plural, ...(sub2 ? { subresource: sub2 } : {}), ...(r.namespaced && !kx.allNs ? { namespace: kx.ns } : {}), ...(name ? { name } : {}) };
  const yes = authorize(kx.c, kx.who, req);
  say(kx, yes ? 'yes' : 'no');
  if (!yes) return { ok: false, stopped: true, exitCode: 1, explain: { key: 'kube.explain.canINo', params: { verb, what } } };
  return OK({ key: 'kube.explain.canIYes', params: { verb, what } });
}

// ---------------------------------------------------------------------------
// config

export function config(kx: Kx, words: string[]): Ret {
  const [sub, ...rest] = words;
  const st = kx.state;
  switch (sub) {
    case 'get-contexts': {
      const rows = Object.entries(st.contexts).map(([name, c]) => [name === st.currentContext ? '*' : '', name, c.cluster, c.user, c.namespace ?? '']);
      say(kx, table(['CURRENT', 'NAME', 'CLUSTER', 'AUTHINFO', 'NAMESPACE'], rows).join('\n'));
      return OK({ key: 'kube.explain.getContexts', params: { context: st.currentContext } });
    }
    case 'current-context':
      say(kx, st.currentContext);
      return OK({ key: 'kube.explain.currentContext', params: { context: st.currentContext } });
    case 'get-clusters':
      say(kx, ['NAME', ...Object.keys(st.clusters)].join('\n'));
      return OK({ key: 'kube.explain.getContexts', params: { context: st.currentContext } });
    case 'use-context': {
      const name = rest[0];
      if (!name) return err(kx, 'error: Unexpected args: []\nSee \'kubectl config use-context -h\' for help and examples', 'kube.err.useContextUsage');
      if (!st.contexts[name]) return err(kx, `error: no context exists with the name: "${name}"`, 'kube.err.noContext', { context: name });
      const from = st.currentContext;
      st.currentContext = name;
      say(kx, `Switched to context "${name}".`);
      kx.ev.push({ type: 'contextSwitched', from, to: name });
      return OK({ key: 'kube.explain.useContext', params: { context: name } }, true);
    }
    case 'set-context': {
      const current = bool(kx.p, 'current');
      const name = current ? st.currentContext : rest[0];
      if (!name) return err(kx, 'error: you must specify a non-empty context name or --current', 'kube.err.setContextUsage');
      const ns = flag(kx.p, 'namespace');
      const created = !st.contexts[name];
      if (created) st.contexts[name] = { cluster: flag(kx.p, 'cluster') ?? '', user: flag(kx.p, 'user') ?? '' };
      if (ns !== undefined) {
        st.contexts[name]!.namespace = ns;
        kx.ev.push({ type: 'namespaceSwitched', namespace: ns });
      }
      say(kx, `Context "${name}" ${created ? 'created' : 'modified'}.`);
      return OK({ key: 'kube.explain.setNamespace', params: { context: name, ns: ns ?? '' } }, true);
    }
    case 'view': {
      const minify = bool(kx.p, 'minify');
      const ctxs = minify ? [st.currentContext] : Object.keys(st.contexts);
      const cfg = {
        apiVersion: 'v1',
        clusters: ctxs.map((n) => ({ cluster: { 'certificate-authority-data': 'DATA+OMITTED', server: st.clusters[st.contexts[n]!.cluster]?.server ?? '' }, name: st.contexts[n]!.cluster })),
        contexts: ctxs.map((n) => ({ context: { cluster: st.contexts[n]!.cluster, ...(st.contexts[n]!.namespace ? { namespace: st.contexts[n]!.namespace } : {}), user: st.contexts[n]!.user }, name: n })),
        'current-context': st.currentContext,
        kind: 'Config',
        users: ctxs.map((n) => ({ name: st.contexts[n]!.user, user: { 'client-certificate-data': 'DATA+OMITTED', 'client-key-data': 'DATA+OMITTED' } })),
      };
      say(kx, toYaml(cfg).replace(/\n$/, '').replace(/^(\s*)(contexts|clusters|users):\n/gm, '$1$2:\n'));
      return OK({ key: 'kube.explain.configView' });
    }
    default:
      return err(kx, `error: unknown command "${sub ?? ''}" for "kubectl config"`, 'kube.err.configUsage');
  }
}

// ---------------------------------------------------------------------------
// explain, api-resources, version, cluster-info, events

export function explain(kx: Kx, words: string[]): Ret {
  const path = words[0] ?? '';
  const [t, ...fields] = path.split('.');
  const r = resource(kx, t ?? '');
  if (!r) return err(kx, `error: the server doesn't have a resource type "${t}"`, 'kube.err.unknownType', { type: t ?? '' });
  const key = [r.singular, ...fields].join('.');
  const text = EXPLAIN[key];
  if (!text) {
    say(kx, `# ${'kubectl explain'} ${path}`, 'dim');
    return { ok: false, stopped: true, explain: { key: 'kube.explain.explainLimited', params: { path, known: Object.keys(EXPLAIN).join(', ') } } };
  }
  say(kx, text.replace(/\n$/, ''));
  return OK({ key: 'kube.explain.explain', params: { path } });
}

export function apiResources(kx: Kx): Ret {
  const order = (g: string) => (g === '' ? '' : g);
  const rows = [...RESOURCES]
    .filter((r) => kx.c.addons.gateway || r.group !== 'gateway.networking.k8s.io')
    .sort((a, b) => order(a.group).localeCompare(order(b.group)) || a.plural.localeCompare(b.plural))
    .map((r) => [r.plural, r.short.join(','), r.group ? `${r.group}/${r.version}` : r.version, r.namespaced ? 'true' : 'false', r.kind]);
  say(kx, table(['NAME', 'SHORTNAMES', 'APIVERSION', 'NAMESPACED', 'KIND'], rows).join('\n'));
  return OK({ key: 'kube.explain.apiResources' });
}

export function version(kx: Kx): Ret {
  say(kx, `Client Version: ${kx.state.kubectlVersion}`);
  say(kx, `Kustomize Version: ${kx.state.kustomizeVersion}`);
  if (!bool(kx.p, 'client')) say(kx, `Server Version: ${kx.c.version}`);
  return OK({ key: 'kube.explain.version', params: { client: kx.state.kubectlVersion, server: kx.c.version } });
}

export function clusterInfo(kx: Kx): Ret {
  const s = kx.c.server;
  kx.out.push([{ t: 'Kubernetes control plane', c: 'green' }, { t: ' is running at ' }, { t: s, c: 'yellow' }]);
  kx.out.push([{ t: 'CoreDNS', c: 'green' }, { t: ' is running at ' }, { t: `${s}/api/v1/namespaces/kube-system/services/kube-dns:dns/proxy`, c: 'yellow' }]);
  kx.out.push(line(''));
  say(kx, "To further debug and diagnose cluster problems, use 'kubectl cluster-info dump'.");
  return OK({ key: 'kube.explain.clusterInfo', params: { context: kx.ctxName } });
}

export function events(kx: Kx, words: string[]): Ret {
  let evs = listObjs(kx.c, 'Event', kx.allNs ? undefined : kx.ns).sort((a, b) => fromIso(a.lastTimestamp) - fromIso(b.lastTimestamp));
  const forWhat = flag(kx.p, 'for');
  if (forWhat) {
    const [t, n] = forWhat.split('/');
    const r = resource(kx, t ?? '');
    evs = evs.filter((e) => e.involvedObject.name === n && (!r || e.involvedObject.kind === r.kind));
  }
  void words;
  if (!evs.length) {
    say(kx, `No events found in ${kx.ns} namespace.`);
    return OK({ key: 'kube.explain.getNone', params: { ns: kx.ns } });
  }
  const rows = evs.map((e) => [...(kx.allNs ? [e.metadata.namespace!] : []), rowFor(e, kx.state, kx.c, {})[0]!, e.type, e.reason, `${e.involvedObject.kind}/${e.involvedObject.name}`, e.message]);
  say(kx, table([...(kx.allNs ? ['NAMESPACE'] : []), 'LAST SEEN', 'TYPE', 'REASON', 'OBJECT', 'MESSAGE'], rows).join('\n'));
  return OK({ key: 'kube.explain.events' });
}

export function qualifiedName(o: KObject): string {
  return `${qualified(byKind(o.kind)!)}/${o.metadata.name}`;
}

export type { Parsed };
