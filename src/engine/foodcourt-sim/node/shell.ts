// K9: a shell inside a node. `ssh dev-worker` (exam style) or `docker exec -it dev-worker bash`
// (how kind users get in) opens it; `exit` leaves. Outputs come from fixtures/cka.json (captured
// on a real kind cluster, a few from the kind node image v1.37.0 and etcd 3.7.0) with this
// cluster's names, times and PIDs.
//
// Kind nodes have no ssh server, no sudo, no editor and no etcdctl: those print bash's real
// "command not found". A cluster made with `etcdTools: true` is exam-style: etcdctl and etcdutl
// are on the control-plane node and `sudo` works.
import { closest, line, lines } from '../../git-sim/output';
import { parseLine } from '../../git-sim/parse';
import { kubectl } from '../kubectl';
import { findCommand } from '../kubectl/args';
import { normalizeImage, lookupImage } from '../images';
import { getObj, listObjs } from '../store';
import type { Cluster, KObject, KubeEvent, KubeResult, KubeState, Line, NodeOs } from '../types';
import { clone, fromIso, iso } from '../util';
import { etcdctl, etcdutl, nodeFs, type EtcdRun } from './etcd';
import { fill, fx, hexOf, humanSize3, journalTime, klogHead, klogStamp, kubeadmTime, shortHuman, systemdAgo, systemdSpan, systemdTime, tabwrite, unitsAgo } from './fixtures';
import { controlPlane, cpNode, ensureOs, ETCD_DB_MARK, isControlPlane, MANIFESTS, nodeIp, SNAPSHOT_MARK, startKubelet, stopKubelet, unreachableText, writeNodeFile } from './os';

/** Commands the node shell knows (for Tab and "did you mean"). */
export const NODE_COMMANDS = ['systemctl', 'journalctl', 'crictl', 'kubeadm', 'kubectl', 'ls', 'cat', 'cd', 'pwd', 'head', 'tail', 'grep', 'sed', 'mv', 'cp', 'rm', 'mkdir', 'echo', 'export', 'hostname', 'clear', 'help', 'exit', 'logout'];
/** Not on a kind node (bash says "command not found"). */
const NOT_ON_KIND = ['sudo', 'ssh', 'vi', 'vim', 'nano', 'less', 'etcdctl', 'etcdutl', 'docker', 'wget'];

const DAY = 86400;

interface Out {
  lines: Line[];
  ok: boolean;
  key: string;
  params?: Record<string, string>;
  exit?: number;
  stopped?: boolean;
  changed?: boolean;
}

interface Sh {
  state: KubeState;
  c: Cluster;
  node: string;
  os: NodeOs;
  ev: KubeEvent[];
}

const ok = (text: string | string[], key: string, params: Record<string, string> = {}): Out => ({ lines: toLines(text), ok: true, key, params });
const bad = (text: string | string[], key: string, params: Record<string, string> = {}, exit = 1): Out => ({ lines: toLines(text), ok: false, key, params, exit });
const note = (text: string, key: string, params: Record<string, string> = {}): Out => ({ lines: [line(text, 'dim')], ok: false, stopped: true, key, params });

function toLines(text: string | string[]): Line[] {
  const arr = Array.isArray(text) ? text : text === '' ? [] : text.split('\n');
  return arr.map((t) => line(t));
}

function shortName(c: Cluster): string {
  return c.name.replace(/^kind-/, '');
}

/** root@dev-worker:/# — the prompt bash shows on a kind node (PS1 '\u@\h:\w\$ '). */
export function nodePrompt(state: KubeState): string | null {
  const sh = state.shell;
  if (!sh) return null;
  const dir = sh.cwd === '/root' ? '~' : sh.cwd.startsWith('/root/') ? `~${sh.cwd.slice(5)}` : sh.cwd;
  return `root@${sh.node}:${dir}# `;
}

function absPath(cwd: string, p: string): string {
  if (p === '~') return '/root';
  if (p.startsWith('~/')) p = `/root/${p.slice(2)}`;
  const parts = (p.startsWith('/') ? [] : cwd.split('/').filter(Boolean)).concat(p.split('/').filter((x) => x && x !== '.'));
  const st: string[] = [];
  for (const x of parts) {
    if (x === '..') st.pop();
    else st.push(x);
  }
  return `/${st.join('/')}`;
}

const isDir = (os: NodeOs, p: string) => p === '/' || os.dirs.includes(p);

function children(os: NodeOs, dir: string): string[] {
  const names = new Set<string>();
  const pre = dir === '/' ? '/' : `${dir}/`;
  for (const f of Object.keys(os.files)) if (f.startsWith(pre)) names.add(f.slice(pre.length).split('/')[0]!);
  for (const d of os.dirs) if (d.startsWith(pre) && d !== dir) names.add(d.slice(pre.length).split('/')[0]!);
  return [...names].filter(Boolean).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function binary(content: string): string | null {
  if (content.startsWith(SNAPSHOT_MARK)) return 'an etcd snapshot';
  if (content.startsWith(ETCD_DB_MARK)) return "etcd's database";
  return null;
}

// ---------------------------------------------------------------------------
// systemctl

function unitName(u: string | undefined): string {
  return (u ?? '').replace(/\.service$/, '');
}

function journalText(sh: Sh, l: NodeOs['journal'][number], i: number): string {
  const who = l.unit === 'systemd' ? 'systemd[1]' : `kubelet[${l.pid}]`;
  const msg = l.unit === 'kubelet' ? `${klogHead(l.level ?? 'I', l.t, l.pid ?? 0, i)}${l.text}` : l.text;
  return `${journalTime(l.t)} ${sh.node} ${who}: ${msg}`;
}

function kubeletJournal(sh: Sh): string[] {
  let last = -1;
  let n = 0;
  return sh.os.journal.map((l) => {
    n = l.t === last ? n + 1 : 0;
    last = l.t;
    return journalText(sh, l, n);
  });
}

function statusKubelet(sh: Sh): Out {
  const { os, state } = sh;
  const up = Boolean(sh.c.nodes[sh.node]?.up);
  const f = fx(up ? 'systemctl-status-active' : 'systemctl-status-stopped');
  const head = fill(up ? 'systemctl-status-active' : 'systemctl-status-stopped', { node: sh.node, ip: nodeIp(sh.c, sh.node) }).split('\n\n')[0]!;
  const recMain = Number(/Main PID: (\d+)/.exec(f.text)?.[1] ?? 0);
  const shift = (n: string) => String(Number(n) - recMain + os.kubelet.pid);
  const since = up ? os.kubelet.since : (os.kubelet.stoppedAt ?? state.clock);
  const dur = systemdSpan(os.kubelet.duration).replace(/(\d+)s$/, (_m, s: string) => `${s}.${String((os.kubelet.pid * 7) % 1000).padStart(3, '0')}s`);
  const text = head
    .replace(/since \w{3} \d{4}-\d\d-\d\d \d\d:\d\d:\d\d UTC; .*? ago/, `since ${systemdTime(since)}; ${systemdAgo(state.clock - since)}`)
    .replace(/Duration: .*/, `Duration: ${dur}`)
    .replace(/Invocation: [0-9a-f]{32}/, `Invocation: ${os.kubelet.invocation}`)
    .replace(/(Process|Main PID): (\d+)/g, (_m, k: string, n: string) => `${k}: ${shift(n)}`)
    .replace(/└─(\d+) /, (_m, n: string) => `└─${shift(n)} `)
    .replace(/kind:\/\/docker\/[^/\s]+\//, `kind://docker/${shortName(sh.c)}/`);
  const tail = kubeletJournal(sh).slice(-10);
  return { lines: toLines([...text.split('\n'), ...(tail.length ? ['', ...tail] : [])]), ok: up, stopped: !up, exit: up ? 0 : 3, key: up ? 'k9.explain.kubeletActive' : 'k9.explain.kubeletInactive', params: { node: sh.node } };
}

function systemctl(sh: Sh, args: string[]): Out {
  const words = args.filter((a) => !a.startsWith('-'));
  const [verb, ...units] = words;
  const unit = unitName(units[0]);
  if (!verb) return note('# systemctl with no command lists every unit; try systemctl status kubelet', 'k9.explain.systemctlHelp');
  if (verb === 'daemon-reload') return ok('', 'k9.explain.daemonReload');
  const known = unit === 'kubelet' || unit === 'containerd';
  if (!unit) return bad(`Too few arguments.`, 'k9.err.systemctlUnit');
  if (!known) {
    if (verb === 'status') return bad(`Unit ${unit}.service could not be found.`, 'k9.err.noUnit', { unit }, 4);
    if (verb === 'is-active') return { ...bad('inactive', 'k9.err.noUnit', { unit }, 3) };
    const v = verb === 'stop' ? 'stop' : verb;
    return bad(`Failed to ${v} ${unit}.service: Unit ${unit}.service ${verb === 'stop' ? 'not loaded' : 'not found'}.`, 'k9.err.noUnit', { unit }, 5);
  }
  if (unit === 'containerd') {
    if (verb === 'is-active') return ok('active', 'k9.explain.containerdActive');
    return note(`# systemctl ${verb} containerd: the lesson shows it (only the kubelet is practised here)`, 'k9.explain.notInShell', { cmd: `systemctl ${verb} containerd` });
  }
  const up = Boolean(sh.c.nodes[sh.node]?.up);
  switch (verb) {
    case 'status':
      return statusKubelet(sh);
    case 'is-active':
      return up ? ok('active', 'k9.explain.kubeletActive', { node: sh.node }) : { ...bad('inactive', 'k9.explain.kubeletInactive', { node: sh.node }, 3), stopped: true };
    case 'is-enabled':
      return ok('enabled', 'k9.explain.kubeletEnabled');
    case 'enable':
      return ok('', 'k9.explain.kubeletEnabled');
    case 'stop':
      if (stopKubelet(sh.state, sh.c, sh.node, sh.ev)) return { ...ok('', 'k9.explain.kubeletStop', { node: sh.node }), changed: true };
      return ok('', 'k9.explain.kubeletStop', { node: sh.node });
    case 'start':
      if (up) return ok('', 'k9.explain.kubeletStart', { node: sh.node });
      startKubelet(sh.state, sh.c, sh.node, sh.ev);
      return { ...ok('', 'k9.explain.kubeletStart', { node: sh.node }), changed: true };
    case 'restart':
      startKubelet(sh.state, sh.c, sh.node, sh.ev);
      return { ...ok('', 'k9.explain.kubeletRestart', { node: sh.node }), changed: true };
    default:
      return note(`# systemctl ${verb}: the lesson shows what it does`, 'k9.explain.notInShell', { cmd: `systemctl ${verb}` });
  }
}

// ---------------------------------------------------------------------------
// journalctl

function journalctl(sh: Sh, args: string[]): Out {
  let unit: string | undefined;
  let n: number | undefined;
  let follow = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '-u' || a === '--unit') unit = args[++i];
    else if (a.startsWith('--unit=')) unit = a.slice(7);
    else if (a.startsWith('-u') && a.length > 2) unit = a.slice(2);
    else if (a === '-n' || a === '--lines') n = Number(args[++i]);
    else if (a.startsWith('--lines=')) n = Number(a.slice(8));
    else if (/^-n\d+$/.test(a)) n = Number(a.slice(2));
    else if (a === '-f' || a === '--follow') follow = true;
    else if (a === '-e' || a === '--pager-end') n = n ?? 1000;
  }
  if (unit !== undefined && unitName(unit) !== 'kubelet') return ok(fx('journal-no-entries').text, 'k9.explain.journalEmpty', { unit: unitName(unit) });
  let all = kubeletJournal(sh);
  if (follow) n = n ?? 10;
  if (n !== undefined && Number.isFinite(n)) all = all.slice(-Math.max(0, n));
  const out = ok(all, follow ? 'k9.explain.journalFollow' : 'k9.explain.journal', { node: sh.node });
  if (follow) out.lines.push(line('# journalctl -f keeps watching for new lines; this practice shell stops here (Ctrl+C).', 'dim'));
  return out;
}

// ---------------------------------------------------------------------------
// crictl

interface Ctr {
  id: string;
  image: string;
  created: number;
  state: 'Running' | 'Exited';
  name: string;
  attempt: number;
  podId: string;
  pod: string;
  namespace: string;
  logs: { t: number; text: string }[];
}

/** Image IDs of the images the kind node image ships (real, from crictl images). */
function imageIds(): Record<string, string> {
  const ids: Record<string, string> = {};
  for (const l of fx('crictl-images').text.split('\n').slice(1)) {
    const [repo, tag, id] = l.split(/\s+/);
    if (repo && tag && id) ids[`${repo}:${tag}`] = id;
  }
  return ids;
}

function imageId(image: string): string {
  const ref = normalizeImage(image).ref;
  return imageIds()[ref] ?? hexOf(`image:${ref}`, 13);
}

function podsOnNode(sh: Sh): KObject[] {
  return listObjs(sh.c, 'Pod').filter((p) => p.spec?.nodeName === sh.node && sh.c.pods[p.metadata.uid]);
}

function containersOnNode(sh: Sh, all: boolean): Ctr[] {
  const out: Ctr[] = [];
  for (const p of podsOnNode(sh)) {
    const rt = sh.c.pods[p.metadata.uid]!;
    const podId = hexOf(`pod:${p.metadata.uid}`, 64);
    const specs = [...(p.spec.initContainers ?? []), ...(p.spec.containers ?? [])];
    for (const spec of specs) {
      const r = rt.containers[spec.name];
      if (!r) continue;
      const st = [...(p.status?.initContainerStatuses ?? []), ...(p.status?.containerStatuses ?? [])].find((x: any) => x.name === spec.name);
      const restarts = st?.restartCount ?? 0;
      const base = { image: imageId(spec.image), name: spec.name, podId, pod: p.metadata.name, namespace: p.metadata.namespace ?? 'default' };
      const term = st?.state?.terminated ?? st?.lastState?.terminated;
      if (r.startedAt !== null) {
        out.push({ ...base, id: hexOf(`ctr:${p.metadata.uid}:${spec.name}:${restarts}`, 64), created: r.startedAt, state: 'Running', attempt: restarts, logs: r.logs });
        if (all && restarts > 0 && st?.lastState?.terminated) {
          out.push({ ...base, id: hexOf(`ctr:${p.metadata.uid}:${spec.name}:${restarts - 1}`, 64), created: fromIso(st.lastState.terminated.startedAt ?? st.lastState.terminated.finishedAt), state: 'Exited', attempt: restarts - 1, logs: r.previousLogs ?? [] });
        }
      } else if (all && term) {
        out.push({ ...base, id: hexOf(`ctr:${p.metadata.uid}:${spec.name}:${restarts}`, 64), created: fromIso(term.startedAt ?? term.finishedAt), state: 'Exited', attempt: restarts, logs: r.logs.length ? r.logs : (r.previousLogs ?? []) });
      }
    }
  }
  return out.sort((a, b) => b.created - a.created || a.pod.localeCompare(b.pod));
}

function crictl(sh: Sh, args: string[]): Out {
  const [cmd, ...rest] = args;
  const flag = (names: string[]): string | undefined => {
    for (let i = 0; i < rest.length; i++) {
      const a = rest[i]!;
      for (const n of names) {
        if (a === n) return rest[i + 1];
        if (a.startsWith(`${n}=`)) return a.slice(n.length + 1);
      }
    }
    return undefined;
  };
  const has = (...names: string[]) => rest.some((a) => names.includes(a));
  const now = sh.state.clock;
  if (cmd === 'ps') {
    const all = has('-a', '--all');
    const name = flag(['--name']);
    let rows = containersOnNode(sh, all);
    if (name) rows = rows.filter((r) => new RegExp(name).test(r.name));
    if (has('-q', '--quiet')) return ok(rows.map((r) => r.id), 'k9.explain.crictlPs', { node: sh.node });
    const header = fx('crictl-ps').text.split('\n')[0]!.trim().split(/ {2,}/);
    const cells = rows.map((r) => {
      const v: Record<string, string> = { CONTAINER: r.id.slice(0, 13), 'CONTAINER ID': r.id.slice(0, 13), IMAGE: r.image, CREATED: unitsAgo(now - r.created), STATE: r.state, NAME: r.name, ATTEMPT: String(r.attempt), 'POD ID': r.podId.slice(0, 13), POD: r.pod, NAMESPACE: r.namespace };
      return header.map((h) => v[h] ?? '');
    });
    return ok(tabwrite([header, ...cells]), 'k9.explain.crictlPs', { node: sh.node });
  }
  if (cmd === 'pods') {
    const name = flag(['--name']);
    let pods = podsOnNode(sh);
    if (name) pods = pods.filter((p) => new RegExp(name).test(p.metadata.name));
    const rows = pods
      .map((p) => ({ p, at: fromIso(p.status?.startTime ?? p.metadata.creationTimestamp), id: hexOf(`pod:${p.metadata.uid}`, 64) }))
      .sort((a, b) => b.at - a.at || a.p.metadata.name.localeCompare(b.p.metadata.name));
    if (has('-q', '--quiet')) return ok(rows.map((r) => r.id), 'k9.explain.crictlPods', { node: sh.node });
    const header = fx('crictl-pods').text.split('\n')[0]!.trim().split(/ {2,}/);
    const cells = rows.map(({ p, at, id }) => {
      const v: Record<string, string> = { 'POD ID': id.slice(0, 13), CREATED: unitsAgo(now - at), STATE: p.metadata.deletionTimestamp && !Object.values(sh.c.pods[p.metadata.uid]!.containers).some((x) => x.startedAt !== null) ? 'NotReady' : 'Ready', NAME: p.metadata.name, NAMESPACE: p.metadata.namespace ?? 'default', ATTEMPT: '0', RUNTIME: '(default)' };
      return header.map((h) => v[h] ?? '');
    });
    return ok(tabwrite([header, ...cells]), 'k9.explain.crictlPods', { node: sh.node });
  }
  if (cmd === 'logs') {
    const words = rest.filter((a, i) => !a.startsWith('-') && !(rest[i - 1] === '--tail'));
    const id = words[0];
    if (!id) return bad('', 'k9.err.crictlLogsUsage');
    const tail = Number(flag(['--tail']) ?? NaN);
    const hit = containersOnNode(sh, true).filter((r) => r.id.startsWith(id));
    if (hit.length !== 1) {
      const nf = fx('crictl-logs-notfound');
      const t = nf.text
        .split(nf.vars?.id ?? 'abc123')
        .join(id)
        .replace(/^E\d{4} \d\d:\d\d:\d\d\.\d{6}\s+\d+ /m, klogHead('E', now, 4000 + (now % 900), id))
        .replace(/time="[^"]+"/, `time="${iso(now)}"`);
      return bad(t, 'k9.err.crictlNotFound', { id });
    }
    let logs = hit[0]!.logs.map((l) => l.text);
    if (Number.isFinite(tail)) logs = logs.slice(-tail);
    return ok(logs, 'k9.explain.crictlLogs', { name: hit[0]!.name, pod: hit[0]!.pod });
  }
  if (cmd === 'images') {
    const rec = fx('crictl-images').text.split('\n');
    const known = new Set(Object.keys(imageIds()));
    const extra: string[][] = [];
    for (const img of sh.c.nodes[sh.node]?.images ?? []) {
      const n = normalizeImage(img);
      if (known.has(n.ref) || !n.tag || n.tag.startsWith('sha256:')) continue;
      if (n.repo.includes('metrics-server') && !sh.c.addons.metricsServer) continue;
      known.add(n.ref);
      const found = lookupImage(img);
      extra.push([n.repo, n.tag, imageId(img), humanSize3('info' in found ? found.info.size : 10_000_000)]);
    }
    if (!extra.length) return ok(rec, 'k9.explain.crictlImages', { node: sh.node });
    const header = rec[0]!.trim().split(/ {2,}/);
    const old = rec.slice(1).map((l) => l.trim().split(/\s+/));
    const all = [...old, ...extra].sort((a, b) => (a[0]! + a[1]!).localeCompare(b[0]! + b[1]!));
    return ok(tabwrite([header, ...all]), 'k9.explain.crictlImages', { node: sh.node });
  }
  return note(`# crictl ${cmd ?? ''}: the lesson shows what it does`.replace('  ', ' '), 'k9.explain.notInShell', { cmd: `crictl ${cmd ?? ''}`.trim() });
}

// ---------------------------------------------------------------------------
// kubeadm

const CERTS = ['admin.conf', 'apiserver', 'apiserver-etcd-client', 'apiserver-kubelet-client', 'controller-manager.conf', 'etcd-healthcheck-client', 'etcd-peer', 'etcd-server', 'front-proxy-client', 'scheduler.conf', 'super-admin.conf'];

function clusterBorn(sh: Sh): number {
  const cp = cpNode(sh.c);
  const n = cp ? getObj(sh.c, 'Node', undefined, cp) : undefined;
  return n ? fromIso(n.metadata.creationTimestamp) - 60 : sh.state.clock - 360;
}

function dropReadError(text: string): string {
  return text.replace(/^\[(check-expiration|renew)\] Error reading configuration from the Cluster\. Falling back to default configuration\n/m, '');
}

/** `kubeadm upgrade plan` was recorded on the 3-node kind cluster dev: show it there, on the control plane, with the API up. */
function planRecorded(sh: Sh): boolean {
  const rec = fx('kubeadm-upgrade-plan');
  const names = Object.keys(sh.c.nodes).sort().join(' ');
  return sh.node === rec.node && names === 'dev-control-plane dev-worker dev-worker2' && controlPlane(sh.c).api;
}

function kubeadm(sh: Sh, args: string[]): Out {
  const words = args.filter((a) => !a.startsWith('-'));
  const [cmd, sub, target] = words;
  if (cmd === 'version') {
    if (args.includes('short') || args.includes('-o=short') || args.includes('--output=short')) return ok(fx('kubeadm-version').text, 'k9.explain.kubeadmVersion');
    return note('# kubeadm version prints a long version line; try kubeadm version -o short', 'k9.explain.kubeadmVersion');
  }
  if (cmd === 'certs' && (sub === 'check-expiration' || sub === 'renew')) {
    if (!isControlPlane(sh.c, sh.node)) return { ...note(`# kubeadm certs works on the control-plane node (${cpNode(sh.c) ?? 'the control plane'}), where /etc/kubernetes/pki is.`, 'k9.err.kubeadmWorker', { node: cpNode(sh.c) ?? '' }), stopped: false, exit: 1 };
    const born = clusterBorn(sh);
    if (sub === 'renew') {
      const which = target === 'all' ? CERTS : CERTS.filter((n) => n === target);
      if (!which.length) return note(`# kubeadm certs renew: name one of ${CERTS.join(', ')}, or all`, 'k9.err.kubeadmRenewName');
      for (const n of which) sh.os.certs[n] = sh.state.clock;
      const rec = dropReadError(fx('kubeadm-certs-renew-all').text).split('\n');
      const head = rec.slice(0, rec.indexOf('') + 1);
      const body = rec.slice(rec.indexOf('') + 1).filter((l) => /renewed$/.test(l));
      const done = rec.filter((l) => l.startsWith('Done renewing'));
      const out = target === 'all' ? [...head, ...body, '', ...done] : [...head, body[CERTS.indexOf(target!)]!];
      return { ...ok(out, 'k9.explain.certsRenewed', { which: target! }), changed: true };
    }
    const now = sh.state.clock;
    let caSection = false;
    const out = dropReadError(fx('kubeadm-certs-check-expiration').text)
      .split('\n')
      .map((l) => {
        if (l.startsWith('CERTIFICATE AUTHORITY')) caSection = true;
        const m = /^(\S+)(\s+)(\w{3} \d\d, \d{4} \d\d:\d\d UTC)(\s+)(\S+)(\s+)(.*)$/.exec(l);
        if (!m) return l;
        const name = m[1]!;
        const exp = caSection ? born + 3650 * DAY : (sh.os.certs[name] ?? born) + 365 * DAY;
        // Signing takes a moment: right after a renew, kubeadm already shows 364d, not 1y.
        const res = shortHuman(exp - now - 1);
        return `${name}${m[2]}${kubeadmTime(exp)}${m[4]}${res.padEnd(m[5]!.length + m[6]!.length)}${m[7]}`;
      });
    return ok(out, 'k9.explain.certsCheck');
  }
  if (cmd === 'upgrade' && sub === 'plan' && planRecorded(sh)) {
    // kind-capture (2026-11-01): what kubeadm v1.37.0 printed on dev-control-plane. The versions on
    // offer were that day's; the node list is the recorded kind cluster's, so only that cluster gets it.
    return ok(fx('kubeadm-upgrade-plan').text, 'k9.explain.kubeadmUpgradePlan');
  }
  if (cmd === 'upgrade') return note(`# kubeadm upgrade ${sub ?? ''}: the lesson shows it (its output depends on a live cluster and the versions on offer)`, 'k9.explain.kubeadmUpgrade');
  return note(`# kubeadm ${cmd ?? ''}: the lesson shows what it does`.replace('  ', ' '), 'k9.explain.notInShell', { cmd: `kubeadm ${cmd ?? ''}`.trim() });
}

// ---------------------------------------------------------------------------
// Files

function lsLong(sh: Sh, dir: string, names: string[]): string[] {
  const born = clusterBorn(sh) + 60;
  const date = (t: number) => {
    const d = new Date(t * 1000);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${months[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2)} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  };
  const rows = names.map((n) => {
    const p = dir === '/' ? `/${n}` : `${dir}/${n}`;
    const content = sh.os.files[p];
    const t = sh.os.mtime[p] ?? born;
    if (content === undefined) return { perm: 'drwxr-xr-x', links: '2', size: '4096', t, n };
    const secret = p.startsWith(MANIFESTS) || /\.(key|conf)$/.test(p) || p.includes('/pki/');
    return { perm: secret ? '-rw-------' : '-rw-r--r--', links: '1', size: String(binary(content) ? 24576 : content.length), t, n };
  });
  const w = Math.max(...rows.map((r) => r.size.length), 1);
  const blocks = rows.reduce((s, r) => s + Math.max(4, Math.ceil(Number(r.size) / 4096) * 4), 0);
  return [`total ${blocks}`, ...rows.map((r) => `${r.perm} ${r.links} root root ${r.size.padStart(w)} ${date(r.t)} ${r.n}`)];
}

function touchFile(sh: Sh, path: string, content: string): void {
  const before = sh.os.files[path];
  writeNodeFile(sh.os, path, content);
  sh.os.mtime[path] = sh.state.clock;
  if (path.startsWith(`${MANIFESTS}/`) && before !== content) {
    sh.os.dirty = sh.state.clock;
    sh.ev.push({ type: 'manifestChanged', node: sh.node, file: path });
  }
}

function removeFile(sh: Sh, path: string): void {
  delete sh.os.files[path];
  delete sh.os.mtime[path];
  if (path.startsWith(`${MANIFESTS}/`)) {
    sh.os.dirty = sh.state.clock;
    sh.ev.push({ type: 'manifestChanged', node: sh.node, file: path });
  }
}

/** GNU sed basic regular expressions → JavaScript (enough for s/old/new/ edits). */
function breToJs(re: string, extended: boolean): string {
  if (extended) return re;
  let out = '';
  for (let i = 0; i < re.length; i++) {
    const ch = re[i]!;
    if (ch === '\\' && i + 1 < re.length) {
      const nx = re[++i]!;
      out += '(){}+?|'.includes(nx) ? nx : `\\${nx}`;
    } else out += '(){}+?|'.includes(ch) ? `\\${ch}` : ch;
  }
  return out;
}

interface SedScript {
  kind: 's' | 'd';
  re: RegExp;
  repl?: string;
}

function parseSed(expr: string, extended: boolean): SedScript | null {
  const d = /^\/(.+)\/d$/.exec(expr);
  if (d) return { kind: 'd', re: new RegExp(breToJs(d[1]!, extended)) };
  if (expr[0] !== 's' || expr.length < 4) return null;
  const sep = expr[1]!;
  const parts: string[] = [];
  let cur = '';
  for (let i = 2; i < expr.length; i++) {
    const ch = expr[i]!;
    if (ch === '\\' && expr[i + 1] === sep) {
      cur += sep;
      i++;
    } else if (ch === sep) {
      parts.push(cur);
      cur = '';
    } else cur += ch;
  }
  parts.push(cur);
  if (parts.length !== 3) return null;
  const [pat, repl, flags] = parts as [string, string, string];
  try {
    const re = new RegExp(breToJs(pat, extended), `${flags.includes('g') ? 'g' : ''}${/[iI]/.test(flags) ? 'i' : ''}`);
    return { kind: 's', re, repl: repl.replace(/\$/g, '$$$$').replace(/\\(\d)/g, '$$$1').replace(/(^|[^\\])&/g, '$1$$&').replace(/\\&/g, '&').replace(/\\n/g, '\n') };
  } catch {
    return null;
  }
}

function sed(sh: Sh, args: string[], cwd: string): Out {
  let inPlace = false;
  let extended = false;
  const exprs: string[] = [];
  const files: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '-i' || a.startsWith('-i')) inPlace = true;
    else if (a === '-E' || a === '-r') extended = true;
    else if (a === '-e') exprs.push(args[++i] ?? '');
    else if (a.startsWith('-') && a.length > 1) continue;
    else if (!exprs.length) exprs.push(a);
    else files.push(a);
  }
  if (!exprs.length) return bad('Usage: sed [OPTION]... {script-only-if-no-other-script} [input-file]...', 'k9.err.sedUsage', {}, 1);
  const scripts = exprs.map((e) => parseSed(e, extended));
  if (scripts.some((s) => !s)) return bad(`sed: -e expression #1, char ${exprs[0]!.length}: unknown command: \`${exprs[0]![0] ?? ''}'`, 'k9.err.sedScript');
  if (!files.length) return note('# sed needs a file here (no pipes into sed in this practice shell)', 'k9.err.sedUsage');
  const outLines: string[] = [];
  for (const f of files) {
    const p = absPath(cwd, f);
    const content = sh.os.files[p];
    if (content === undefined) return bad(`sed: can't read ${f}: No such file or directory`, 'k9.err.noFile', { file: f }, 2);
    let next = content
      .split('\n')
      .filter((l) => !scripts.some((s) => s!.kind === 'd' && s!.re.test(l)))
      .map((l) => scripts.reduce((acc, s) => (s!.kind === 's' ? acc.replace(s!.re, s!.repl!) : acc), l))
      .join('\n');
    if (!content.endsWith('\n') && next.endsWith('\n')) next = next.slice(0, -1);
    if (inPlace) {
      if (next !== content) touchFile(sh, p, next);
    } else outLines.push(...next.replace(/\n$/, '').split('\n'));
  }
  if (inPlace) return { ...ok('', 'k9.explain.sedInPlace', { file: files[0]! }), changed: true };
  return ok(outLines, 'k9.explain.sedPrint', { file: files[0]! });
}

// ---------------------------------------------------------------------------
// Pipes: `cmd | grep x | tail -n 5`

function filterPipe(text: string[], stage: string[]): string[] | null {
  const [cmd, ...a] = stage;
  if (cmd === 'grep') {
    const flags = a.filter((x) => x.startsWith('-')).join('');
    const pat = a.find((x) => !x.startsWith('-'));
    if (pat === undefined) return null;
    let re: RegExp;
    try {
      re = new RegExp(flags.includes('E') ? pat : breToJs(pat, false), flags.includes('i') ? 'i' : '');
    } catch {
      return null;
    }
    return text.filter((l) => re.test(l) !== flags.includes('v'));
  }
  if (cmd === 'head' || cmd === 'tail') {
    const nArg = a.find((x) => /^-?\d+$/.test(x) || /^-n\d+$/.test(x)) ?? (a.includes('-n') ? a[a.indexOf('-n') + 1] : undefined);
    const n = Math.abs(Number(String(nArg ?? '10').replace(/^-n/, '').replace(/^-/, '')));
    return cmd === 'head' ? text.slice(0, n) : text.slice(-n);
  }
  if (cmd === 'wc' && a.includes('-l')) return [String(text.length)];
  return null;
}

// ---------------------------------------------------------------------------
// One command

function etcdOnNode(sh: Sh, tool: 'etcdctl' | 'etcdutl', args: string[], cwd: string): Out {
  const r: EtcdRun = (tool === 'etcdctl' ? etcdctl : etcdutl)({ state: sh.state, c: sh.c, fs: nodeFs(sh.os), cwd }, args);
  return runToOut(r);
}

function runToOut(r: EtcdRun): Out {
  return { lines: [...r.lines.map((t) => line(t)), ...r.notes.map((t) => line(t, 'dim'))], ok: r.code === 0, exit: r.code, key: r.key, ...(r.params ? { params: r.params } : {}), ...(r.changed ? { changed: true } : {}), ...(r.code === 130 ? { stopped: true } : {}) };
}

/** The admin kubeconfigs kubeadm writes on the control-plane node. */
const ADMIN_CONFS = ['/etc/kubernetes/admin.conf', '/etc/kubernetes/super-admin.conf'];
/** kind starts control-plane node containers with this (and workers without it), so `docker exec` shells have it. */
export const NODE_KUBECONFIG = '/etc/kubernetes/admin.conf';

/** A kubectl recording with this moment's klog times and this node's kubectl PID. */
function kubectlText(sh: Sh, key: string, swap: Record<string, string> = {}): string {
  const f = fx(key);
  let text = f.text;
  for (const [k, v] of Object.entries(swap)) if (f.vars?.[k]) text = text.split(f.vars[k]!).join(v);
  if (f.ip && swap.ip) text = text.split(f.ip).join(swap.ip);
  const pid = String(sh.os.pidNext + (sh.state.clock % 97));
  return klogStamp(text.replace(/^E\d{4} \d\d:\d\d:\d\d\.\d{6}\s+\d+ /gm, () => `E@KLOG ${pid.padStart(7)} `), sh.state.clock);
}

/**
 * kubectl inside a node, by client-go's rules: a --kubeconfig file must exist; KUBECONFIG files
 * that are not there are skipped; with nothing left kubectl tries http://localhost:8080. kind
 * sets KUBECONFIG=/etc/kubernetes/admin.conf on control-plane nodes only, so there kubectl is the
 * cluster admin (it talks to <control-plane>:6443 directly), and on a worker it finds no server.
 * The node's kubectl is the kind node image's own (the cluster's version), not the laptop's.
 */
function kubectlInNode(sh: Sh, args: string[], env: Record<string, string>, raw: string): KubeResult | Out {
  const cwd = sh.state.shell!.cwd;
  let given: string | undefined;
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '--kubeconfig') given = args[++i] ?? '';
    else if (a.startsWith('--kubeconfig=')) given = a.slice(13);
    else rest.push(a);
  }
  const exists = (p: string) => sh.os.files[absPath(cwd, p)] !== undefined;
  const { cmd } = findCommand(rest);
  const client = { kubectl: sh.c.version, kustomize: sh.state.kustomizeVersion };
  const cp = cpNode(sh.c) ?? sh.node;
  if (cmd === 'version' && rest.some((a) => a === '--client' || a === '--client=true')) return ok([`Client Version: ${client.kubectl}`, `Kustomize Version: ${client.kustomize}`], 'kube.explain.version', { client: client.kubectl, server: '' });
  if (given && !exists(given)) return bad(kubectlText(sh, 'kubectl-in-worker-kubeconfig', { file: given }), 'k9.err.noFile', { file: given });
  const kc = given || (env.KUBECONFIG ?? '').split(':').find((p) => p && exists(p));
  if (!kc) {
    const text = unreachableText(cmd, kubectlText(sh, 'kubectl-in-worker'), client);
    if (text !== null) return bad(text, 'k9.err.kubectlInNode', { node: cp });
    return note(`# kubectl on ${sh.node} finds no kubeconfig, so it tries localhost:8080. Its error words for kubectl ${cmd ?? ''} are not recorded here.`.replace('  ', ' '), 'k9.err.kubectlInNode', { node: cp });
  }
  if (!ADMIN_CONFS.includes(absPath(cwd, kc))) return note(`# kubectl --kubeconfig ${kc}: this practice shell runs kubectl on a node only as the admin (${NODE_KUBECONFIG}).`, 'k9.explain.notInShell', { cmd: `kubectl --kubeconfig ${kc}` });
  if (!controlPlane(sh.c).api) {
    const server = `${cp}:6443`;
    const text = unreachableText(cmd, kubectlText(sh, 'kubectl-in-control-plane-api-down', { server, ip: nodeIp(sh.c, cp) }), client);
    if (text !== null) return bad(text, 'k9.err.apiDown', { server });
    return note(`# kubectl ${cmd ?? ''} cannot reach the API server at ${server} either. Its own error words are not recorded here.`.replace('  ', ' '), 'k9.err.apiDown', { server });
  }
  const ctx = Object.entries(sh.state.contexts).find(([, x]) => x.cluster === sh.c.name)?.[0];
  const r = kubectl({ ...sh.state, kubectlVersion: client.kubectl }, [...rest, ...(ctx ? [`--context=${ctx}`] : [])], raw);
  return { ...r, state: { ...r.state, kubectlVersion: sh.state.kubectlVersion } };
}

function runOne(sh: Sh, words: string[], raw: string): Out | KubeResult {
  const shell = sh.state.shell!;
  const env: Record<string, string> = { ...shell.env };
  while (words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0]!)) {
    const [k, ...v] = words.shift()!.split('=');
    env[k!] = v.join('=');
  }
  let [cmd, ...args] = words;
  if (!cmd) return ok('', '');
  const exam = Boolean(sh.c.etcdTools);
  if (cmd === 'sudo' && exam) [cmd, ...args] = args;
  if (!cmd) return ok('', '');
  const cwd = shell.cwd;
  const tools = exam && isControlPlane(sh.c, sh.node) ? ['etcdctl', 'etcdutl'] : [];
  if (NOT_ON_KIND.includes(cmd) && !tools.includes(cmd)) {
    if (exam && ['vi', 'vim', 'nano'].includes(cmd)) return note(`# ${cmd}: this practice shell has no full-screen editor. Change a file with sed -i 's/old/new/' FILE`, 'k9.explain.noEditor');
    return bad(`bash: ${cmd}: command not found`, ['vi', 'vim', 'nano'].includes(cmd) ? 'k9.err.noEditorKind' : cmd === 'etcdctl' || cmd === 'etcdutl' ? 'k9.err.noEtcdctlKind' : 'k9.err.notOnKind', { cmd }, 127);
  }
  switch (cmd) {
    case 'systemctl':
      return systemctl(sh, args);
    case 'journalctl':
      return journalctl(sh, args);
    case 'crictl':
      return crictl(sh, args);
    case 'kubeadm':
      return kubeadm(sh, args);
    case 'etcdctl':
    case 'etcdutl':
      return etcdOnNode(sh, cmd, args, cwd);
    case 'kubectl':
      return kubectlInNode(sh, args, env, raw);
    case 'hostname':
      return ok(sh.node, 'k9.explain.hostname', { node: sh.node });
    case 'pwd':
      return ok(cwd, 'k9.explain.pwd');
    case 'echo':
      return ok(args.map((a) => a.replace(/\$\{?([A-Za-z_]\w*)\}?/g, (_m, k: string) => env[k] ?? '')).join(' '), 'k9.explain.echo');
    case 'export': {
      for (const a of args) {
        const [k, ...v] = a.split('=');
        if (k && v.length) shell.env[k] = v.join('=');
      }
      return ok('', 'k9.explain.export');
    }
    case 'cd': {
      const target = absPath(cwd, args[0] ?? '~');
      if (!isDir(sh.os, target)) return bad(`bash: cd: ${args[0]}: ${sh.os.files[target] !== undefined ? 'Not a directory' : 'No such file or directory'}`, 'k9.err.noDir', { dir: args[0] ?? '' });
      shell.cwd = target;
      return ok('', 'k9.explain.cd', { dir: target });
    }
    case 'ls': {
      const long = args.some((a) => /^-\w*l/.test(a));
      const targets = args.filter((a) => !a.startsWith('-'));
      const out: string[] = [];
      for (const t of targets.length ? targets : ['.']) {
        const p = absPath(cwd, t);
        if (sh.os.files[p] !== undefined) out.push(long ? lsLong(sh, p.slice(0, p.lastIndexOf('/')) || '/', [p.slice(p.lastIndexOf('/') + 1)]).slice(1)[0]! : t);
        else if (isDir(sh.os, p)) out.push(...(long ? lsLong(sh, p, children(sh.os, p)) : children(sh.os, p).length ? [children(sh.os, p).join('  ')] : []));
        else return bad(`ls: cannot access '${t}': No such file or directory`, 'k9.err.noFile', { file: t }, 2);
      }
      return ok(out, 'k9.explain.ls', { dir: targets[0] ?? cwd });
    }
    case 'cat':
    case 'head':
    case 'tail':
    case 'grep': {
      let n = 10;
      const files: string[] = [];
      let pattern: string | undefined;
      let flags = '';
      for (let i = 0; i < args.length; i++) {
        const a = args[i]!;
        if ((cmd === 'head' || cmd === 'tail') && a === '-n') n = Number(args[++i]);
        else if ((cmd === 'head' || cmd === 'tail') && /^-n?\d+$/.test(a)) n = Number(a.replace(/^-n?/, ''));
        else if (a.startsWith('-') && a.length > 1) flags += a.slice(1);
        else if (cmd === 'grep' && pattern === undefined) pattern = a;
        else files.push(a);
      }
      if (!files.length) return bad(cmd === 'cat' ? '' : '', 'k9.err.catUsage');
      const out: string[] = [];
      for (const f of files) {
        const p = absPath(cwd, f);
        const content = sh.os.files[p];
        if (content === undefined) {
          if (isDir(sh.os, p)) return bad(`${cmd}: ${f}: Is a directory`, 'k9.err.catDir', { file: f });
          return bad(cmd === 'head' || cmd === 'tail' ? `${cmd}: cannot open '${f}' for reading: No such file or directory` : `${cmd}: ${f}: No such file or directory`, 'k9.err.noFile', { file: f }, cmd === 'grep' ? 2 : 1);
        }
        const kind = binary(content);
        if (kind) return note(`# ${f} is a binary file (${kind}); the terminal would show unreadable bytes.`, 'k9.explain.binaryFile', { file: f });
        const ls = content.replace(/\n$/, '').split('\n');
        if (cmd === 'cat') out.push(...ls);
        else if (cmd === 'head') out.push(...ls.slice(0, n));
        else if (cmd === 'tail') out.push(...ls.slice(-n));
        else {
          const got = filterPipe(ls, ['grep', ...(flags ? [`-${flags}`] : []), pattern ?? '']) ?? [];
          out.push(...(files.length > 1 ? got.map((l) => `${f}:${l}`) : got));
        }
      }
      if (cmd === 'grep' && !out.length) return { lines: [], ok: false, stopped: true, exit: 1, key: 'k9.explain.grepNone' };
      return ok(out, cmd === 'cat' ? 'k9.explain.cat' : 'k9.explain.read', { file: files[0]! });
    }
    case 'sed':
      return sed(sh, args, cwd);
    case 'mkdir': {
      for (const a of args.filter((x) => !x.startsWith('-'))) {
        const p = absPath(cwd, a);
        if (isDir(sh.os, p) && !args.includes('-p')) return bad(`mkdir: cannot create directory '${a}': File exists`, 'k9.err.exists', { file: a });
        nodeFs(sh.os).mkdirp(p);
      }
      return ok('', 'k9.explain.mkdir');
    }
    case 'mv':
    case 'cp': {
      const ws = args.filter((a) => !a.startsWith('-'));
      if (ws.length < 2) return bad(`${cmd}: missing destination file operand after '${ws[0] ?? ''}'`, 'k9.err.mvUsage');
      const [src, dst] = [absPath(cwd, ws[0]!), absPath(cwd, ws[1]!)];
      const content = sh.os.files[src];
      if (content === undefined && !isDir(sh.os, src)) return bad(`${cmd}: cannot stat '${ws[0]}': No such file or directory`, 'k9.err.noFile', { file: ws[0]! });
      const target = isDir(sh.os, dst) ? `${dst === '/' ? '' : dst}/${src.slice(src.lastIndexOf('/') + 1)}` : dst;
      if (!isDir(sh.os, target.slice(0, target.lastIndexOf('/')) || '/')) return bad(`${cmd}: cannot ${cmd === 'mv' ? 'move' : 'create regular file'} '${ws[1]}': No such file or directory`, 'k9.err.noDir', { dir: ws[1]! });
      if (content !== undefined) {
        touchFile(sh, target, content);
        if (cmd === 'mv') removeFile(sh, src);
      } else {
        if (cmd === 'cp' && !args.some((a) => /^-\w*r/i.test(a))) return bad(`cp: -r not specified; omitting directory '${ws[0]}'`, 'k9.err.cpDir');
        for (const [f, v] of Object.entries(sh.os.files)) if (f.startsWith(`${src}/`)) touchFile(sh, `${target}${f.slice(src.length)}`, v);
        for (const d of [...sh.os.dirs]) if (d === src || d.startsWith(`${src}/`)) nodeFs(sh.os).mkdirp(`${target}${d.slice(src.length)}`);
        if (cmd === 'mv') {
          for (const f of Object.keys(sh.os.files)) if (f.startsWith(`${src}/`)) removeFile(sh, f);
          sh.os.dirs = sh.os.dirs.filter((d) => d !== src && !d.startsWith(`${src}/`));
        }
      }
      return { ...ok('', cmd === 'mv' ? 'k9.explain.mv' : 'k9.explain.cp', { from: ws[0]!, to: ws[1]! }), changed: true };
    }
    case 'rm': {
      const rec = args.some((a) => /^-\w*r/i.test(a));
      const force = args.some((a) => /^-\w*f/.test(a));
      for (const a of args.filter((x) => !x.startsWith('-'))) {
        const p = absPath(cwd, a);
        if (sh.os.files[p] !== undefined) removeFile(sh, p);
        else if (isDir(sh.os, p)) {
          if (!rec) return bad(`rm: cannot remove '${a}': Is a directory`, 'k9.err.rmDir', { file: a });
          for (const f of Object.keys(sh.os.files)) if (f.startsWith(`${p}/`)) removeFile(sh, f);
          sh.os.dirs = sh.os.dirs.filter((d) => d !== p && !d.startsWith(`${p}/`));
        } else if (!force) return bad(`rm: cannot remove '${a}': No such file or directory`, 'k9.err.noFile', { file: a });
      }
      return { ...ok('', 'k9.explain.rm'), changed: true };
    }
    case 'help':
      return ok(
        [
          'On a node: systemctl status kubelet · journalctl -u kubelet -n 20 --no-pager · crictl ps · crictl pods · crictl logs <id>',
          `Files: ls ${MANIFESTS} · cat <file> · sed -i 's/old/new/' <file> · mv <file> <folder>`,
          `Control plane: kubeadm certs check-expiration${exam ? ' · etcdctl snapshot save · etcdutl snapshot status' : ''} · exit`,
        ],
        'k9.explain.help',
      );
    default: {
      const near = closest(cmd, NODE_COMMANDS);
      return bad(`bash: ${cmd}: command not found`, near ? 'k9.err.unknownDidYouMean' : 'k9.err.unknownCmd', { cmd, suggestion: near ?? '' }, 127);
    }
  }
}

function toResult(sh: Sh, state: KubeState, r: Out | KubeResult): KubeResult {
  if ('state' in r) return r;
  return {
    state,
    output: r.lines,
    events: sh.ev,
    ok: r.ok,
    ...(r.key ? { explain: { key: r.key, params: r.params ?? {} } } : {}),
    ...(r.stopped ? { stopped: true } : {}),
    ...(r.exit !== undefined && r.exit !== 0 && r.exit !== 1 ? { exitCode: r.exit } : {}),
    ...(r.changed ? { changed: true } : {}),
  };
}

/** Run a line typed in an open node shell. */
export function nodeShell(state: KubeState, input: string): KubeResult {
  const raw = input.trim();
  if (!raw) return { state, output: [], events: [], ok: true };
  const sh0 = state.shell!;
  const s = clone(state);
  const c = s.clusters[sh0.cluster];
  if (!c || !c.nodes[sh0.node]) {
    delete s.shell;
    return { state: s, output: [line('exit')], events: [{ type: 'shellClosed', node: sh0.node }], ok: true };
  }
  const sh: Sh = { state: s, c, node: sh0.node, os: ensureOs(s, c, sh0.node), ev: [] };
  const parsed = parseLine(raw);
  if (parsed.error === 'unclosedQuote') return { state, output: lines('Your quote is not closed. Add the missing quote at the end.'), events: [], ok: false, explain: { key: 'kube.err.unclosedQuote' } };
  if (parsed.redirect) return { state, output: lines('In this practice terminal, > is not available. Run the command on its own.'), events: [], ok: false, explain: { key: 'kube.err.redirect' } };
  const stages: string[][] = [[]];
  for (const w of parsed.words) {
    if (w === '|') stages.push([]);
    else stages[stages.length - 1]!.push(w);
  }
  const [first, ...pipes] = stages as [string[], ...string[][]];
  if (first[0] === 'exit' || first[0] === 'logout') {
    delete s.shell;
    const out = sh0.via === 'ssh' ? ['logout', `Connection to ${sh0.node} closed.`] : ['exit'];
    return { state: s, output: out.map((t) => line(t)), events: [{ type: 'shellClosed', node: sh0.node }], ok: true, explain: { key: 'k9.explain.exit', params: { node: sh0.node } } };
  }
  if (first[0] === 'clear') return { state, output: [], events: [{ type: 'cleared' }], ok: true };
  const r = runOne(sh, [...first], raw);
  if (pipes.length) {
    if ('state' in r) return { ...r, output: [...r.output] };
    let text = r.lines.map((l) => l.map((x) => x.t).join(''));
    for (const p of pipes) {
      const next = filterPipe(text, p);
      if (!next) return { state, output: lines(`Only | grep, | head and | tail work after a command here.`), events: [], ok: false, explain: { key: 'k9.err.pipe' } };
      text = next;
    }
    const empty = !text.length && pipes.some((p) => p[0] === 'grep');
    return toResult(sh, s, { ...r, lines: text.map((t) => line(t)), ...(empty ? { ok: false, stopped: true, exit: 1 } : {}) });
  }
  return toResult(sh, s, r);
}

/** `ssh dev-worker`, `docker exec -it dev-worker bash`: open a node shell (or say why not). */
export function openNodeShell(state: KubeState, target: string, via: 'ssh' | 'docker'): KubeResult {
  const ctx = state.contexts[state.currentContext];
  const c = ctx ? state.clusters[ctx.cluster] : undefined;
  const host = target.replace(/^[^@]+@/, '');
  const fail = (text: string, key: string, code: number): KubeResult => ({ state, output: lines(text), events: [{ type: 'error', code: key }], ok: false, exitCode: code, explain: { key, params: { node: host } } });
  if (!c || c.kind !== 'kind' || !c.nodes[host]) {
    return via === 'ssh'
      ? fail(`ssh: Could not resolve hostname ${host}: Name or service not known`, 'k9.err.sshNoHost', 255)
      : fail(`Error response from daemon: No such container: ${host}`, 'k9.err.dockerNoContainer', 1);
  }
  const s = clone(state);
  const cc = s.clusters[c.name]!;
  ensureOs(s, cc, host);
  // kind runs control-plane node containers with KUBECONFIG set (workers get none); a shell there inherits it.
  s.shell = { cluster: c.name, node: host, cwd: via === 'ssh' ? '/root' : '/', via, env: isControlPlane(cc, host) ? { KUBECONFIG: NODE_KUBECONFIG } : {} };
  const out: Line[] = via === 'ssh' && !cc.etcdTools ? [line(`# kind nodes have no SSH server: on kind you type docker exec -it ${host} bash. Here ssh opens the same node shell, like on the exam.`, 'dim')] : [];
  return { state: s, output: out, events: [{ type: 'shellOpened', node: host }], ok: true, explain: { key: via === 'ssh' ? 'k9.explain.ssh' : 'k9.explain.dockerExec', params: { node: host } } };
}

/** `docker exec dev-worker crictl ps` (one command, no shell), as capture-cka.sh does it. */
export function nodeOnce(state: KubeState, target: string, argv: string[], raw: string): KubeResult {
  const opened = openNodeShell(state, target, 'docker');
  if (!opened.ok) return opened;
  const r = nodeShell(opened.state, argv.map((a) => (/[\s'"|]/.test(a) ? `'${a}'` : a)).join(' ') || 'true');
  const s = clone(r.state);
  delete s.shell;
  void raw;
  return { ...r, state: s, events: r.events.filter((e) => e.type !== 'shellOpened' && e.type !== 'shellClosed') };
}
