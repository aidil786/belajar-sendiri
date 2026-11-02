// K9: the machine under each stall. A kind node is a Docker container running Debian 13, systemd,
// containerd and the kubelet. The kubelet runs the control plane as static pods from
// /etc/kubernetes/manifests (and shows them through mirror pods). This file keeps that machine:
// its files, the kubelet service and journal, the static pods it runs, and whether the control
// plane (etcd, kube-apiserver, kube-scheduler, kube-controller-manager) is up.
//
// Made lazily: a node gets its machine the first time a node shell or a K9 fault needs it, so
// every older scenario runs exactly as before.
import { apiCreate, apiDelete } from '../api';
import { getObj, isTerminating, listObjs } from '../store';
import type { Behavior, Cluster, EtcdState, JournalLine, KObject, KubeEvent, KubeState, NodeOs, StaticPod } from '../types';
import { clone, fnv32a, iso } from '../util';
import { parseManifests } from '../yaml';
import { CKA, fx, hexOf } from './fixtures';

export const MANIFESTS = '/etc/kubernetes/manifests';
/** The kubelet notices a changed manifest within seconds (inotify); the docs say to allow fileCheckFrequency (20 s). */
export const NOTICE = 3;
export const FILE_CHECK = 20;
export const CONTROL_PLANE = ['etcd', 'kube-apiserver', 'kube-controller-manager', 'kube-scheduler'] as const;
export const SNAPSHOT_MARK = 'etcd-snapshot:';
export const ETCD_DB_MARK = 'etcd-db:';

export function nodeObj(c: Cluster, node: string): KObject | undefined {
  return getObj(c, 'Node', undefined, node);
}

export function nodeIp(c: Cluster, node: string): string {
  return nodeObj(c, node)?.status?.addresses?.find((a: any) => a.type === 'InternalIP')?.address ?? '';
}

export function isControlPlane(c: Cluster, node: string): boolean {
  return nodeObj(c, node)?.metadata.labels?.['node-role.kubernetes.io/control-plane'] !== undefined;
}

/** The kind control-plane node (none on a managed cloud cluster). */
export function cpNode(c: Cluster): string | undefined {
  if (c.kind !== 'kind') return undefined;
  return listObjs(c, 'Node').find((n) => n.metadata.labels?.['node-role.kubernetes.io/control-plane'] !== undefined)?.metadata.name;
}

/** kind's provider id: kind://docker/<cluster>/<node>. */
function shortName(c: Cluster): string {
  return c.name.replace(/^kind-/, '');
}

/** A control-plane manifest as kubeadm wrote it on this node. */
export function kindManifest(c: Cluster, file: string, node: string): string {
  const f = CKA.files[`${MANIFESTS}/${file}`];
  if (!f) throw new Error(`cka.json has no manifest ${file}`);
  return f.text.split('dev-control-plane').join(node).replace(/\b172\.18\.0\.2\b/g, nodeIp(c, node)).replace(/--cluster-name=dev\b/, `--cluster-name=${shortName(c)}`);
}

/** kubernetes.io/config.hash: 32 hex characters that change when the manifest text changes. */
export function manifestHash(text: string): string {
  return hexOf(`manifest:${text}`, 32);
}

const MANIFEST_FILES = ['etcd.yaml', 'kube-apiserver.yaml', 'kube-controller-manager.yaml', 'kube-scheduler.yaml'];

// ---------------------------------------------------------------------------
// Static pods: what the kubelet makes of a manifest file

/** Flags each component really has (from the kubeadm manifests), plus a few common ones people add. */
const EXTRA_FLAGS = ['v', 'vmodule', 'profiling', 'logging-format', 'feature-gates', 'tls-cipher-suites', 'tls-min-version', 'secure-port', 'leader-elect-lease-duration', 'leader-elect-renew-deadline', 'config', 'master'];

function baselineFlags(component: string): Set<string> {
  const file = `${MANIFESTS}/${component}.yaml`;
  const text = CKA.files[file]?.text ?? '';
  const flags = new Set(EXTRA_FLAGS);
  for (const m of text.matchAll(/^\s+- --([a-z0-9-]+)/gm)) flags.add(m[1]!);
  return flags;
}

/** Paths the container can see: its volume mounts (file or folder). */
function visible(pod: any, container: any, path: string): boolean {
  for (const m of container.volumeMounts ?? []) {
    const mp = String(m.mountPath ?? '').replace(/\/$/, '');
    if (!mp) continue;
    const vol = (pod.spec?.volumes ?? []).find((v: any) => v.name === m.name);
    if (!vol?.hostPath) continue;
    if (path === mp || path.startsWith(`${mp}/`)) return true;
  }
  return false;
}

/** Why a control-plane program stops at once (real kube-scheduler v1.37.0 output), or null. */
function crashFor(component: string, pod: any, container: any, argv: string[]): string[] | null {
  if (!['kube-apiserver', 'kube-controller-manager', 'kube-scheduler'].includes(component)) return null;
  const known = baselineFlags(component);
  for (const a of argv.slice(1)) {
    const m = /^--([a-z0-9-]+)(?:=(.*))?$/.exec(a);
    if (!m) continue;
    if (!known.has(m[1]!)) {
      const f = fx('component-crash-unknown-flag');
      const text = f.text.split(f.vars?.flag ?? '--bind-adress').join(`--${m[1]}`);
      // The flag help is kube-scheduler's own; other components print their own help, so show only the last line.
      return component === 'kube-scheduler' ? text.split('\n') : [`Error: unknown flag: --${m[1]}`];
    }
  }
  for (const a of argv.slice(1)) {
    const m = /^--((?:authentication-|authorization-)?kubeconfig)=(.+)$/.exec(a);
    if (m && component !== 'kube-apiserver' && !visible(pod, container, m[2]!)) {
      const f = fx('component-crash-missing-file');
      return f.text
        .split(f.vars?.file ?? '/etc/kubernetes/schedulr.conf')
        .join(m[2]!)
        .split('\n')
        .map((l) => l.replace(/^([IEW])\d{4} \d\d:\d\d:\d\d\.\d{6}/, '$1@KLOG'));
    }
  }
  return null;
}

/** Where etcd keeps its data on the node: the hostPath behind --data-dir. */
function etcdDataDir(pod: any, container: any, argv: string[]): string {
  const dir = argv.map((a) => /^--data-dir=(.+)$/.exec(a)?.[1]).find(Boolean) ?? '/var/lib/etcd';
  for (const m of container.volumeMounts ?? []) {
    const mp = String(m.mountPath ?? '').replace(/\/$/, '');
    const vol = (pod.spec?.volumes ?? []).find((v: any) => v.name === m.name);
    if (!mp || !vol?.hostPath?.path) continue;
    if (dir === mp || dir.startsWith(`${mp}/`)) return `${String(vol.hostPath.path).replace(/\/$/, '')}${dir.slice(mp.length)}`;
  }
  // Not on a host folder: the data lives inside the container and is gone when it restarts.
  return `container:${dir}`;
}

/** Read one manifest file. A file that is not a valid Pod gives null (the kubelet skips it). */
export function staticFromManifest(file: string, text: string, node: string): StaticPod | null {
  const parsed = parseManifests(text);
  if (parsed.error || parsed.docs.length !== 1) return null;
  const pod = parsed.docs[0]!;
  if (pod.apiVersion !== 'v1' || pod.kind !== 'Pod' || !pod.metadata?.name) return null;
  const container = pod.spec?.containers?.[0];
  if (!container?.name || !container.image) return null;
  const argv: string[] = [...(container.command ?? []), ...(container.args ?? [])].map(String);
  const labels: Record<string, string> = { ...(pod.metadata.labels ?? {}) };
  const component = labels.component ?? pod.metadata.name;
  const sp: StaticPod = {
    file,
    volumes: clone(pod.spec?.volumes ?? []),
    volumeMounts: clone(container.volumeMounts ?? []),
    ...(typeof pod.spec?.priority === 'number' ? { priority: pod.spec.priority } : {}),
    name: `${pod.metadata.name}-${node}`,
    namespace: pod.metadata.namespace ?? 'default',
    base: pod.metadata.name,
    component,
    hash: manifestHash(text),
    container: container.name,
    image: String(container.image),
    command: argv,
    labels,
    annotations: { ...(pod.metadata.annotations ?? {}) },
    crash: crashFor(component, pod, container, argv),
  };
  if (component === 'etcd') sp.dataDir = etcdDataDir(pod, container, argv);
  return sp;
}

/** The mirror pod the kubelet posts for a static pod (owned by the Node, like the real ones). */
export function mirrorPod(c: Cluster, node: string, sp: StaticPod, clock: number): KObject {
  const n = nodeObj(c, node);
  return {
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: {
      name: sp.name,
      namespace: sp.namespace,
      labels: { ...sp.labels },
      annotations: {
        ...sp.annotations,
        'kubernetes.io/config.hash': sp.hash,
        'kubernetes.io/config.mirror': sp.hash,
        'kubernetes.io/config.seen': iso(clock).replace('Z', `.${String(fnv32a(sp.hash) % 1_000_000_000).padStart(9, '0')}Z`),
        'kubernetes.io/config.source': 'file',
      },
      ...(n ? { ownerReferences: [{ apiVersion: 'v1', kind: 'Node', name: node, uid: n.metadata.uid, controller: true }] } : {}),
    } as any,
    spec: {
      containers: [{ name: sp.container, image: sp.image, command: sp.command, ...(sp.volumeMounts?.length ? { volumeMounts: clone(sp.volumeMounts) } : {}) }],
      ...(sp.volumes?.length ? { volumes: clone(sp.volumes) } : {}),
      ...(sp.priority !== undefined ? { priority: sp.priority } : {}),
      hostNetwork: true,
      nodeName: node,
      priorityClassName: 'system-node-critical',
      tolerations: [{ effect: 'NoExecute', operator: 'Exists' }],
    },
  };
}

/** The four control-plane mirror pods a new kind cluster starts with (cluster.ts). */
export function initialStaticPods(c: Cluster, node: string): StaticPod[] {
  return MANIFEST_FILES.map((f) => staticFromManifest(`${MANIFESTS}/${f}`, kindManifest(c, f, node), node)!);
}

// ---------------------------------------------------------------------------
// The machine

function practiceFile(what: string): string {
  return `# ${what}\n# (practice copy: the keys and certificates are left out)\n`;
}

function kubeconfig(c: Cluster, user: string): string {
  return `apiVersion: v1\nclusters:\n- cluster:\n    certificate-authority-data: (practice copy: left out)\n    server: https://${shortName(c)}-control-plane:6443\n  name: ${shortName(c)}\ncontexts:\n- context:\n    cluster: ${shortName(c)}\n    user: ${user}\n  name: ${user}@${shortName(c)}\ncurrent-context: ${user}@${shortName(c)}\nkind: Config\nusers:\n- name: ${user}\n  user:\n    client-certificate-data: (practice copy: left out)\n    client-key-data: (practice copy: left out)\n`;
}

function addDir(os: NodeOs, path: string): void {
  const parts = path.split('/').filter(Boolean);
  for (let i = 1; i <= parts.length; i++) {
    const d = `/${parts.slice(0, i).join('/')}`;
    if (!os.dirs.includes(d)) os.dirs.push(d);
  }
}

export function writeNodeFile(os: NodeOs, path: string, content: string): void {
  os.files[path] = content;
  addDir(os, path.slice(0, path.lastIndexOf('/')) || '/');
}

/** Journal lines a kubelet start writes (recorded from the kind node image). */
function startLines(os: NodeOs, clock: number): JournalLine[] {
  const out: JournalLine[] = [];
  for (const raw of fx('journal-kubelet-start').text.split('\n')) {
    const m = /^\w{3} \d\d \d\d:\d\d:\d\d \S+ (systemd\[1\]|kubelet\[\d+\]): (.*)$/.exec(raw);
    if (!m) continue;
    if (m[1] === 'systemd[1]') out.push({ t: clock, unit: 'systemd', text: m[2]! });
    else {
      const k = /^([IWE])\d{4} \d\d:\d\d:\d\d\.\d{6}\s+\d+ (.*)$/.exec(m[2]!);
      if (k) out.push({ t: clock, unit: 'kubelet', pid: os.kubelet.pid, level: k[1] as 'I', text: k[2]! });
    }
  }
  return out;
}

/**
 * Journal lines a kubelet stop writes, in the recorded order (kind: the kubelet's shutdown lines,
 * then systemd's Stopping…, Deactivated successfully., Stopped…). Only lines from the second of
 * the stop are kept: older lines in the recording (pods coming and going) are not part of it.
 */
function stopLines(os: NodeOs, clock: number, pid: number): JournalLine[] {
  const rec = fx('journal-kubelet-stop')
    .text.split('\n')
    .map((raw) => /^(\w{3} \d\d \d\d:\d\d:\d\d) \S+ (systemd\[1\]|kubelet\[\d+\]): (.*)$/.exec(raw))
    .filter((m): m is RegExpExecArray => m !== null);
  const at = rec.find((m) => m[2] === 'systemd[1]')?.[1];
  const out: JournalLine[] = [];
  for (const m of rec) {
    if (at && m[1] !== at) continue;
    if (m[2] === 'systemd[1]') out.push({ t: clock, unit: 'systemd', text: m[3]! });
    else {
      const k = /^([IWE])\d{4} \d\d:\d\d:\d\d\.\d{6}\s+\d+ (.*)$/.exec(m[3]!);
      // Lines about the recording sandbox's unregistered node are left out; the shutdown lines stay.
      if (k && !/not found|mirror pod|registered/.test(k[2]!)) out.push({ t: clock, unit: 'kubelet', pid, level: k[1] as 'I', text: k[2]! });
    }
  }
  void os;
  return out;
}

/** The node's machine, made on first use (changes the cluster). */
export function ensureOs(state: KubeState, c: Cluster, node: string): NodeOs {
  const rt = c.nodes[node];
  if (!rt) throw new Error(`no node ${node}`);
  if (rt.os) return rt.os;
  const n = nodeObj(c, node);
  const born = n ? Math.floor(Date.parse(n.metadata.creationTimestamp) / 1000) : state.clock - 300;
  const ip = nodeIp(c, node);
  const pid = 200 + (fnv32a(`${c.name}/${node}`) % 500);
  const os: NodeOs = {
    files: {},
    dirs: ['/', '/root', '/tmp', '/opt', '/var', '/var/lib', '/etc'],
    kubelet: { since: born + 3, pid, invocation: hexOf(`${node}:inv:0`, 32), stoppedAt: null, duration: 0 },
    journal: [],
    statics: {},
    dirty: null,
    checkedAt: state.clock,
    pidNext: pid + 400,
    mtime: {},
    certs: {},
  };
  const cp = isControlPlane(c, node);
  for (const [path, f] of Object.entries(CKA.files)) {
    if (path.startsWith(`${MANIFESTS}/`)) continue;
    let text = f.text;
    if (path.endsWith('kubeadm-flags.env')) text = text.replace(/--node-ip=[\d.]+/, `--node-ip=${ip}`).replace(/kind:\/\/docker\/\S+?\/dev-control-plane/, `kind://docker/${shortName(c)}/${node}`);
    writeNodeFile(os, path, text);
  }
  addDir(os, MANIFESTS);
  addDir(os, '/var/lib/kubelet/pki');
  writeNodeFile(os, '/etc/kubernetes/kubelet.conf', kubeconfig(c, `system:node:${node}`).replace(/^(\s+)client-certificate-data: .*\n(\s+)client-key-data: .*$/m, '$1client-certificate: /var/lib/kubelet/pki/kubelet-client-current.pem\n$2client-key: /var/lib/kubelet/pki/kubelet-client-current.pem'));
  writeNodeFile(os, '/etc/kubernetes/pki/ca.crt', practiceFile('the cluster CA certificate'));
  writeNodeFile(os, '/var/lib/kubelet/pki/kubelet-client-current.pem', practiceFile("the kubelet's client certificate and key"));
  if (cp) {
    for (const f of MANIFEST_FILES) writeNodeFile(os, `${MANIFESTS}/${f}`, kindManifest(c, f, node));
    for (const [file, user] of [['admin.conf', 'kubernetes-admin'], ['super-admin.conf', 'kubernetes-super-admin'], ['controller-manager.conf', 'system:kube-controller-manager'], ['scheduler.conf', 'system:kube-scheduler']] as const) {
      writeNodeFile(os, `/etc/kubernetes/${file}`, kubeconfig(c, user));
    }
    for (const f of ['apiserver-etcd-client.crt', 'apiserver-etcd-client.key', 'apiserver-kubelet-client.crt', 'apiserver-kubelet-client.key', 'apiserver.crt', 'apiserver.key', 'ca.key', 'front-proxy-ca.crt', 'front-proxy-ca.key', 'front-proxy-client.crt', 'front-proxy-client.key', 'sa.key', 'sa.pub']) {
      writeNodeFile(os, `/etc/kubernetes/pki/${f}`, practiceFile(f));
    }
    for (const f of ['ca.crt', 'ca.key', 'healthcheck-client.crt', 'healthcheck-client.key', 'peer.crt', 'peer.key', 'server.crt', 'server.key']) {
      writeNodeFile(os, `/etc/kubernetes/pki/etcd/${f}`, practiceFile(`etcd/${f}`));
    }
    writeNodeFile(os, '/var/lib/etcd/member/snap/db', `${ETCD_DB_MARK}/var/lib/etcd`);
    addDir(os, '/var/lib/etcd/member/wal');
    for (const f of MANIFEST_FILES) {
      const sp = staticFromManifest(`${MANIFESTS}/${f}`, os.files[`${MANIFESTS}/${f}`]!, node);
      if (sp) os.statics[sp.file] = sp;
    }
  }
  os.journal.push(...startLines(os, os.kubelet.since));
  if (!rt.up) {
    const at = Math.max(os.kubelet.since + 1, rt.heartbeat);
    os.kubelet.stoppedAt = at;
    os.kubelet.duration = at - os.kubelet.since;
    os.journal.push(...stopLines(os, at, os.kubelet.pid));
  }
  rt.os = os;
  return os;
}

// ---------------------------------------------------------------------------
// The kubelet service

export function stopKubelet(state: KubeState, c: Cluster, node: string, ev: KubeEvent[]): boolean {
  const rt = c.nodes[node];
  if (!rt?.up) return false;
  const os = ensureOs(state, c, node);
  rt.up = false;
  os.kubelet.stoppedAt = state.clock;
  os.kubelet.duration = state.clock - os.kubelet.since;
  os.journal.push(...stopLines(os, state.clock, os.kubelet.pid));
  ev.push({ type: 'kubeletStopped', node });
  return true;
}

export function startKubelet(state: KubeState, c: Cluster, node: string, ev: KubeEvent[]): boolean {
  const rt = c.nodes[node];
  if (!rt) return false;
  const os = ensureOs(state, c, node);
  const was = rt.up;
  if (was) os.journal.push(...stopLines(os, state.clock, os.kubelet.pid));
  rt.up = true;
  rt.heartbeat = state.clock;
  os.kubelet.pid = os.pidNext;
  os.pidNext += 37 + (fnv32a(`${node}:${state.clock}`) % 300);
  os.kubelet.since = state.clock;
  os.kubelet.stoppedAt = null;
  os.kubelet.invocation = hexOf(`${node}:inv:${state.clock}:${os.kubelet.pid}`, 32);
  os.journal.push(...startLines(os, state.clock));
  // A fresh kubelet reads the manifest folder at once.
  os.checkedAt = state.clock - FILE_CHECK;
  if (!was) ev.push({ type: 'kubeletStarted', node });
  return true;
}

/** Keep journal lines from earlier kubelet runs consistent when a fault stops/starts it (faults.ts). */
export function noteKubelet(state: KubeState, c: Cluster, node: string, up: boolean): void {
  const rt = c.nodes[node];
  if (!rt?.os) return;
  const os = rt.os;
  if (!up) {
    os.kubelet.stoppedAt = state.clock;
    os.kubelet.duration = state.clock - os.kubelet.since;
    os.journal.push(...stopLines(os, state.clock, os.kubelet.pid));
  } else {
    os.kubelet.pid = os.pidNext;
    os.pidNext += 41;
    os.kubelet.since = state.clock;
    os.kubelet.stoppedAt = null;
    os.kubelet.invocation = hexOf(`${node}:inv:${state.clock}:${os.kubelet.pid}`, 32);
    os.journal.push(...startLines(os, state.clock));
    os.checkedAt = state.clock - FILE_CHECK;
  }
}

// ---------------------------------------------------------------------------
// The kubelet's static pod loop (one call = one simulated second)

/**
 * The kubelet's journal line for a manifest that no longer parses. Recorded (kind-capture) for one
 * slip only: `  containers:` lost its colon, and the YAML error names the line after it. Any other
 * broken file: null (the journal says nothing rather than guess the parser's words).
 */
export function manifestErrorLine(text: string, path: string): { level: 'E'; text: string } | null {
  const rec = CKA.outputs['kubelet-manifest-error'];
  const at = text.split('\n').indexOf('  containers');
  if (!rec || at < 0) return null;
  const k = /kubelet\[\d+\]: E\d{4} \d\d:\d\d:\d\d\.\d{6}\s+\d+ (.*)$/.exec(rec.text.split('\n').find((l) => /manifest/.test(l)) ?? '');
  if (!k || !/yaml: line \d+:/.test(k[1]!)) return null;
  return { level: 'E', text: k[1]!.replace(/\/etc\/kubernetes\/manifests\/[\w.-]+/g, path).replace(/yaml: line \d+:/, `yaml: line ${at + 2}:`) };
}

function readManifests(c: Cluster, node: string, os: NodeOs, now: number): void {
  os.checkedAt = now;
  os.dirty = null;
  const next: Record<string, StaticPod> = {};
  for (const [path, text] of Object.entries(os.files)) {
    if (!path.startsWith(`${MANIFESTS}/`)) continue;
    const name = path.slice(MANIFESTS.length + 1);
    if (name.includes('/') || name.startsWith('.')) continue;
    const sp = staticFromManifest(path, text, node);
    if (sp) next[path] = sp;
    else {
      const k = manifestErrorLine(text, path);
      if (k) os.journal.push({ t: now, unit: 'kubelet', pid: os.kubelet.pid, level: k.level, text: k.text });
    }
  }
  os.statics = next;
  void c;
}

/** Make mirror pods follow what the kubelet runs: stop the ones whose manifest went or changed, start new ones. */
function syncMirrors(state: KubeState, c: Cluster, node: string, os: NodeOs, ev: KubeEvent[]): void {
  const want = Object.values(os.statics);
  for (const m of listObjs(c, 'Pod').filter((p) => p.spec?.nodeName === node && p.metadata.annotations?.['kubernetes.io/config.mirror'])) {
    if (isTerminating(m)) continue;
    const sp = want.find((s) => s.name === m.metadata.name && s.namespace === m.metadata.namespace);
    if (!sp || m.metadata.annotations?.['kubernetes.io/config.hash'] !== sp.hash) {
      apiDelete(state, c, 'Pod', m.metadata.namespace, m.metadata.name, { by: 'controller', events: ev });
      ev.push({ type: 'staticPodStopped', node, pod: m.metadata.name });
    }
  }
  for (const sp of want) {
    if (getObj(c, 'Pod', sp.namespace, sp.name)) continue;
    if (sp.component === 'etcd' && sp.dataDir && switchEtcdData(state, c, sp.dataDir, ev)) return;
    const r = apiCreate(state, c, mirrorPod(c, node, sp, state.clock), { events: ev });
    if (r.ok) ev.push({ type: 'staticPodStarted', node, pod: sp.name });
  }
}

export function staticPodController(state: KubeState, c: Cluster, ev: KubeEvent[]): void {
  const now = state.clock;
  // Someone deleted a mirror pod (kubectl delete pod kube-scheduler-…): the kubelet posts it again.
  const cp = c.kind === 'kind' ? cpNode(c) : undefined;
  if (cp && !c.nodes[cp]?.os && c.nodes[cp]?.up && CONTROL_PLANE.some((comp) => !getObj(c, 'Pod', 'kube-system', `${comp}-${cp}`))) ensureOs(state, c, cp);
  for (const [node, rt] of Object.entries(c.nodes)) {
    const os = rt.os;
    if (!os || !rt.up) continue;
    if ((os.dirty !== null && now - os.dirty >= NOTICE) || now - os.checkedAt >= FILE_CHECK) readManifests(c, node, os, now);
    syncMirrors(state, c, node, os, ev);
  }
}

/** A program that stops at once with these log lines (a broken static pod command). */
export function crashBehavior(component: string, lines: string[]): Behavior {
  return {
    warmup: 0,
    ports: [],
    logs: lines.map((text) => ({ at: 0, text })),
    memory: () => 1,
    cpu: 0,
    ignoresTerm: false,
    files: {},
    fileOps: [],
    tools: [],
    process: component,
    exitAfter: 0,
    exitCode: 1,
  };
}

/** The crash lines for a mirror pod, if its static pod is broken (kubelet.ts asks). */
export function mirrorCrash(c: Cluster, pod: KObject): string[] | null {
  if (!pod.metadata.annotations?.['kubernetes.io/config.mirror']) return null;
  const os = c.nodes[pod.spec?.nodeName ?? '']?.os;
  if (!os) return null;
  const sp = Object.values(os.statics).find((s) => s.name === pod.metadata.name && s.hash === pod.metadata.annotations?.['kubernetes.io/config.hash']);
  return sp?.crash ?? null;
}

// ---------------------------------------------------------------------------
// Is the control plane up?

/** A control-plane program is serving: its static pod runs the current manifest and the container is up. */
export function componentServing(c: Cluster, component: string): boolean {
  const node = cpNode(c);
  const os = node ? c.nodes[node]?.os : undefined;
  if (!node || !os) return true;
  const sp = Object.values(os.statics).find((s) => s.component === component);
  if (!sp || sp.crash) return false;
  const pod = getObj(c, 'Pod', sp.namespace, sp.name);
  if (!pod || isTerminating(pod) || pod.metadata.annotations?.['kubernetes.io/config.hash'] !== sp.hash) return false;
  const rt = c.pods[pod.metadata.uid]?.containers[sp.container];
  return Boolean(rt && rt.startedAt !== null);
}

export interface ControlPlane {
  api: boolean;
  scheduler: boolean;
  controllers: boolean;
}

const ALL_UP: ControlPlane = { api: true, scheduler: true, controllers: true };

export function controlPlane(c: Cluster): ControlPlane {
  if (c.kind !== 'kind' || !Object.values(c.nodes).some((n) => n.os)) return ALL_UP;
  const node = cpNode(c);
  if (!node || !c.nodes[node]?.os) return ALL_UP;
  const api = componentServing(c, 'etcd') && componentServing(c, 'kube-apiserver');
  return { api, scheduler: api && componentServing(c, 'kube-scheduler'), controllers: api && componentServing(c, 'kube-controller-manager') };
}

/**
 * What kubectl on the laptop prints when the API server (or etcd) is down on kind: kind publishes
 * the API port through Docker, Docker takes the connection and closes it, and kubectl 1.37.2 says
 * `Unable to connect to the server: EOF` (kind-capture). The recorded address is swapped for this
 * cluster's, should a recording ever show it; klog times get `@KLOG` for klogStamp.
 */
export function apiDownText(c: Cluster): string {
  const f = fx('kubectl-api-down');
  const rec = f.vars?.server;
  const text = rec ? f.text.split(rec).join(c.server.replace(/^https?:\/\//, '')) : f.text;
  return text.replace(/^([IWE])\d{4} \d\d:\d\d:\d\d\.\d{6}/gm, '$1@KLOG');
}

/**
 * `kubectl version` on the laptop when the API server is down on kind (kind-capture): the two
 * client lines, then kubectl's own error for the /version call. The recorded address is swapped
 * for this cluster's; the local port in the error is the one from the recording.
 */
export function apiDownVersionText(c: Cluster, client: { kubectl: string; kustomize: string }): string {
  const f = fx('kubectl-version-api-down');
  const rec = f.vars?.server;
  const err = f.text.split('\n').at(-1)!;
  const server = c.server.replace(/^https?:\/\//, '');
  return [`Client Version: ${client.kubectl}`, `Kustomize Version: ${client.kustomize}`, rec ? err.split(rec).join(server) : err].join('\n');
}

/** kubectl commands that ask the API for its resource list first: with no server they all print the recorded `get` lines (checked with kubectl 1.37). */
export const ASKS_API_FIRST = ['get', 'describe', 'delete', 'scale'];

/**
 * What kubectl prints when it reaches no API server, from the recording of `kubectl get` (`text`):
 * the same lines for the commands in ASKS_API_FIRST; for `version`, the two client lines and only
 * the last line (checked with kubectl 1.37); for other commands null (they print other words, e.g.
 * apply cannot download the openapi schema), so the caller says less.
 */
export function unreachableText(cmd: string | undefined, text: string, client: { kubectl: string; kustomize: string }): string | null {
  if (cmd && ASKS_API_FIRST.includes(cmd)) return text;
  if (cmd === 'version') return [`Client Version: ${client.kubectl}`, `Kustomize Version: ${client.kustomize}`, text.split('\n').at(-1)!].join('\n');
  return null;
}

// ---------------------------------------------------------------------------
// etcd data folders

export function ensureEtcd(c: Cluster): EtcdState {
  if (!c.etcd) c.etcd = { dataDir: '/var/lib/etcd', stores: {}, snapshots: {}, restoredFrom: [] };
  return c.etcd;
}

/** What a brand-new, empty etcd gives back after the API server starts on it. */
function bootstrapOnly(objects: Record<string, KObject>): Record<string, KObject> {
  const keep: Record<string, KObject> = {};
  for (const [k, o] of Object.entries(objects)) {
    const sys = ['default', 'kube-system', 'kube-public', 'kube-node-lease'];
    if (
      o.kind === 'Node' ||
      (o.kind === 'Namespace' && sys.includes(o.metadata.name)) ||
      (o.kind === 'Service' && o.metadata.namespace === 'default' && o.metadata.name === 'kubernetes') ||
      ((o.kind === 'ClusterRole' || o.kind === 'ClusterRoleBinding') && o.metadata.labels?.['kubernetes.io/bootstrapping'] === 'rbac-defaults')
    ) {
      keep[k] = clone(o);
    }
  }
  return keep;
}

/**
 * etcd starts on another data folder (its manifest changed): the API server now serves what that
 * folder holds. Returns true when the objects changed (the caller lets the next tick go on).
 */
export function switchEtcdData(state: KubeState, c: Cluster, dir: string, ev: KubeEvent[]): boolean {
  const e = ensureEtcd(c);
  if (dir === e.dataDir) return false;
  e.stores[e.dataDir] = { objects: c.objects, rv: c.rv };
  const next = e.stores[dir];
  delete e.stores[dir];
  c.objects = next ? clone(next.objects) : bootstrapOnly(c.objects);
  c.rv = Math.max(c.rv, next?.rv ?? 0) + 1;
  if (next?.from) e.restoredFrom.push(next.from);
  e.dataDir = dir;
  // Pods that come back from the snapshot but have no running containers start again from scratch.
  for (const p of Object.values(c.objects).filter((o) => o.kind === 'Pod')) {
    const rt = c.pods[p.metadata.uid];
    const running = rt && Object.values(rt.containers).some((x) => x.startedAt !== null);
    if (running) continue;
    delete c.pods[p.metadata.uid];
    if (p.spec?.nodeName) {
      const t = iso(state.clock);
      p.status = { phase: 'Pending', qosClass: p.status?.qosClass ?? 'BestEffort', conditions: [{ lastProbeTime: null, lastTransitionTime: t, status: 'True', type: 'PodScheduled' }] };
    }
  }
  ev.push({ type: 'etcdRestored', dataDir: dir });
  return true;
}
