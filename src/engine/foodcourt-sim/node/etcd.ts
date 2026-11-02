// K9: etcdctl and etcdutl 3.7 (the etcd kubeadm v1.37.0 runs). Outputs are the real ones recorded
// from etcd 3.7.0 (fixtures/cka.json: "kind-capture" through kubectl exec on kind, some "etcd-image");
// this file fills in paths, times, sizes.
//
// What 3.7 really does (checked against the binaries, 2026-11-01):
// - `etcdctl snapshot save` needs the etcd CA and a client certificate the etcd CA signed
//   (server, healthcheck-client, peer or apiserver-etcd-client). Without them, or with the wrong
//   ones, it prints one line and then waits forever. --endpoints may be left out (127.0.0.1:2379).
// - `etcdctl snapshot status` and `etcdctl snapshot restore` are gone: etcdctl just prints the
//   `snapshot` help. Use `etcdutl snapshot status` and `etcdutl --data-dir DIR snapshot restore FILE`.
// - The kubernetes.io page still shows the older (3.5) table; 3.7 draws its table with box lines.
import type { Cluster, EtcdSnapshot, KObject, KubeState, NodeOs } from '../types';
import { clone, fnv32a, iso } from '../util';
import { parseManifests } from '../yaml';
import { fill, fx, hexOf, humanBytes, zapTs } from './fixtures';
import { cpNode, ensureEtcd, ensureOs, ETCD_DB_MARK, nodeIp, SNAPSHOT_MARK, writeNodeFile } from './os';

/** A file system as etcdctl sees it: the node itself, or the inside of the etcd container. */
export interface Fs {
  read(path: string): string | undefined;
  write(path: string, content: string): void;
  isDir(path: string): boolean;
  mkdirp(path: string): void;
  hasChildren(path: string): boolean;
  /** The same path on the node (for data folders), or null when it only exists inside a container. */
  hostPath(path: string): string | null;
}

export function nodeFs(os: NodeOs): Fs {
  return {
    read: (p) => os.files[p],
    write: (p, content) => writeNodeFile(os, p, content),
    isDir: (p) => p === '/' || os.dirs.includes(p),
    mkdirp: (p) => {
      const parts = p.split('/').filter(Boolean);
      for (let i = 1; i <= parts.length; i++) {
        const d = `/${parts.slice(0, i).join('/')}`;
        if (!os.dirs.includes(d)) os.dirs.push(d);
      }
    },
    hasChildren: (p) => Object.keys(os.files).some((f) => f.startsWith(`${p}/`)) || os.dirs.some((d) => d.startsWith(`${p}/`)),
    hostPath: (p) => p,
  };
}

/** The etcd container: its host folders (from the manifest's hostPath mounts) and its own small file store. */
export function podFs(os: NodeOs, mounts: { mountPath: string; hostPath: string }[], own: Record<string, string>): Fs {
  const node = nodeFs(os);
  const map = (p: string): string | null => {
    for (const m of mounts) if (p === m.mountPath || p.startsWith(`${m.mountPath}/`)) return `${m.hostPath}${p.slice(m.mountPath.length)}`;
    return null;
  };
  const ownDirs = () => new Set(['/', '/tmp', '/var', '/var/lib', '/etc', '/etc/kubernetes', '/etc/kubernetes/pki', ...Object.keys(own).filter((k) => k.startsWith('dir:')).map((k) => k.slice(4))]);
  return {
    read: (p) => {
      const h = map(p);
      return h ? node.read(h) : own[p];
    },
    write: (p, content) => {
      const h = map(p);
      if (h) node.write(h, content);
      else own[p] = content;
    },
    isDir: (p) => {
      const h = map(p);
      if (h) return node.isDir(h) || mounts.some((m) => m.mountPath === p);
      return ownDirs().has(p);
    },
    mkdirp: (p) => {
      const h = map(p);
      if (h) node.mkdirp(h);
      else {
        const parts = p.split('/').filter(Boolean);
        for (let i = 1; i <= parts.length; i++) own[`dir:/${parts.slice(0, i).join('/')}`] = '';
      }
    },
    hasChildren: (p) => {
      const h = map(p);
      if (h) return node.hasChildren(h);
      return Object.keys(own).some((k) => k.replace(/^dir:/, '').startsWith(`${p}/`));
    },
    hostPath: map,
  };
}

export interface EtcdRun {
  lines: string[];
  /** Grey practice notes after the output (never shown as tool output). */
  notes: string[];
  code: number;
  key: string;
  params?: Record<string, string>;
  changed?: boolean;
}

const out = (lines: string[], code: number, key: string, params: Record<string, string> = {}, notes: string[] = []): EtcdRun => ({ lines, notes, code, key, params });

const VALUE_FLAGS = new Set(['endpoints', 'cacert', 'cert', 'key', 'write-out', 'w', 'dial-timeout', 'command-timeout', 'keepalive-time', 'keepalive-timeout', 'user', 'password', 'data-dir', 'name', 'initial-cluster', 'initial-cluster-token', 'initial-advertise-peer-urls', 'wal-dir', 'skip-hash-check', 'discovery-srv']);

interface Args {
  flags: Record<string, string>;
  words: string[];
}

function parseArgs(argv: string[]): Args {
  const flags: Record<string, string> = {};
  const words: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const m = /^--?([a-z-]+)(?:=(.*))?$/.exec(a);
    if (!m) {
      words.push(a);
      continue;
    }
    const name = m[1]!;
    if (m[2] !== undefined) flags[name] = m[2];
    else if (VALUE_FLAGS.has(name) && i + 1 < argv.length) flags[name] = argv[++i]!;
    else flags[name] = 'true';
  }
  return { flags, words };
}

function abs(cwd: string, p: string): string {
  if (p.startsWith('/')) return p.replace(/\/+$/, '') || '/';
  const parts = (cwd === '/' ? [] : cwd.split('/').filter(Boolean)).concat(p.split('/').filter((x) => x && x !== '.'));
  const st: string[] = [];
  for (const x of parts) {
    if (x === '..') st.pop();
    else st.push(x);
  }
  return `/${st.join('/')}`;
}

function parentDir(p: string): string {
  return p.slice(0, p.lastIndexOf('/')) || '/';
}

const ETCD_CA = '/etc/kubernetes/pki/etcd/ca.crt';
const CLIENT_CERTS: Record<string, string> = {
  '/etc/kubernetes/pki/etcd/server.crt': '/etc/kubernetes/pki/etcd/server.key',
  '/etc/kubernetes/pki/etcd/healthcheck-client.crt': '/etc/kubernetes/pki/etcd/healthcheck-client.key',
  '/etc/kubernetes/pki/etcd/peer.crt': '/etc/kubernetes/pki/etcd/peer.key',
  '/etc/kubernetes/pki/apiserver-etcd-client.crt': '/etc/kubernetes/pki/apiserver-etcd-client.key',
};

export interface EtcdCtx {
  state: KubeState;
  c: Cluster;
  fs: Fs;
  cwd: string;
  /**
   * Run through `kubectl exec` (stdout and stderr come back as two streams, so their lines mix;
   * kind-capture shows the JSON "saved" log last). Typed on the node itself, one terminal shows
   * the program's own order: every log line, then `Snapshot saved at …` and `Server version …`.
   */
  viaExec?: boolean;
}

/** Can this etcdctl reach etcd? 'ok', 'hang' (waits forever) or an `open …` error line. */
function connect(x: EtcdCtx, f: Record<string, string>): { ok: true; endpoint: string } | { ok: false; hang: true } | { ok: false; hang: false; line: string } {
  const files = [f.cert, f.key, f.cacert].filter((v): v is string => Boolean(v));
  for (const p of files) if (x.fs.read(abs(x.cwd, p)) === undefined) return { ok: false, hang: false, line: `Error: open ${p}: no such file or directory` };
  const endpoint = (f.endpoints ?? '127.0.0.1:2379').split(',')[0]!;
  const host = /^(?:(https?):\/\/)?([^:/]+)(?::(\d+))?/.exec(endpoint);
  const node = cpNode(x.c);
  const hostOk = Boolean(host && ['127.0.0.1', 'localhost', node ? nodeIp(x.c, node) : ''].includes(host[2]!) && (host[3] ?? '2379') === '2379' && host[1] !== 'http');
  const ca = f.cacert ? abs(x.cwd, f.cacert) : '';
  const cert = f.cert ? abs(x.cwd, f.cert) : '';
  const key = f.key ? abs(x.cwd, f.key) : '';
  const tlsOk = ca === ETCD_CA && CLIENT_CERTS[cert] === key;
  if (!hostOk || !tlsOk) return { ok: false, hang: true };
  return { ok: true, endpoint };
}

function hangRun(file: string, clock: number): EtcdRun {
  const first = fx('etcdctl-snapshot-save-hang').text.split('\n')[0]!;
  return out([first.replace(/"ts":"[^"]+"/, `"ts":"${zapTs(clock, 0)}"`).replace(/"path":"[^"]+"/, `"path":"${file}.part"`), '^C'], 130, 'k9.err.etcdHang', {}, ['# etcdctl is still waiting here: it never got in. You pressed Ctrl+C.']);
}

/** The objects etcd holds now, as a snapshot (the cluster's resourceVersion is etcd's revision). */
export function takeSnapshot(state: KubeState, c: Cluster): EtcdSnapshot {
  const e = ensureEtcd(c);
  const id = hexOf(`${c.name}:${state.clock}:${c.rv}:${Object.keys(e.snapshots).length}`, 16);
  const keys = Object.keys(c.objects).length + Object.keys(c.nodes).length * 2 + 37;
  const size = Math.ceil((1_900_000 + keys * 4096) / 4096) * 4096;
  const snap: EtcdSnapshot = { id, at: state.clock, objects: clone(c.objects), rv: c.rv, hash: hexOf(`hash:${id}`, 8), keys, size };
  e.snapshots[id] = snap;
  return snap;
}

function snapshotOf(x: EtcdCtx, path: string): EtcdSnapshot | null | undefined {
  const content = x.fs.read(path);
  if (content === undefined) return undefined;
  if (!content.startsWith(SNAPSHOT_MARK)) return null;
  return x.c.etcd?.snapshots[content.slice(SNAPSHOT_MARK.length)] ?? null;
}

function stampZap(lines: string[], clock: number): string[] {
  return lines.map((l, i) => l.replace(/"ts":"[^"]+"/, `"ts":"${zapTs(clock, i)}"`));
}

export function etcdctl(x: EtcdCtx, argv: string[]): EtcdRun {
  const { flags: f, words } = parseArgs(argv);
  const [cmd, sub, ...rest] = words;
  const usage = fx('etcdctl-snapshot-usage').text.split('\n');
  if (cmd === 'version') return out(fx('etcdctl-version').text.split('\n'), 0, 'k9.explain.etcdVersion');
  if (cmd === 'snapshot') {
    if (f['data-dir']) {
      return out(fx('etcdctl-unknown-data-dir').text.split('\n'), 1, 'k9.err.etcdctlRestore');
    }
    if (sub === 'save') {
      if (rest.length !== 1) return out(fx('etcdctl-save-no-arg').text.split('\n'), 128, 'k9.err.etcdSaveUsage');
      const file = rest[0]!;
      const conn = connect(x, f);
      if (!conn.ok) return conn.hang ? hangRun(file, x.state.clock) : out([conn.line], 128, 'k9.err.etcdOpen', { file: conn.line.replace(/^Error: open (\S+):.*$/, '$1') });
      const target = abs(x.cwd, file);
      if (!x.fs.isDir(parentDir(target))) {
        const f0 = fx('etcdctl-save-bad-dir');
        return out(f0.text.split(f0.vars?.file ?? '/nope/dir/f.db').join(file).split('\n'), 5, 'k9.err.etcdSaveDir', { file });
      }
      const snap = takeSnapshot(x.state, x.c);
      x.fs.write(target, `${SNAPSHOT_MARK}${snap.id}`);
      const took = `${5 + (fnv32a(snap.id) % 20)}.${String(fnv32a(`t${snap.id}`) % 1_000_000).padStart(6, '0')}ms`;
      const lines = fx('etcdctl-snapshot-save')
        .text.split('\n')
        .map((l) =>
          l
            .replace(/"path":"[^"]+\.part"/, `"path":"${file}.part"`)
            .replace(/("msg":"saved","path":)"[^"]+"/, `$1"${file}"`)
            .replace(/"endpoint":"[^"]+"/, `"endpoint":"${conn.endpoint}"`)
            .replace(/"size":"[^"]+"/, `"size":"${humanBytes(snap.size)}"`)
            .replace(/"took":"[^"]+"/, `"took":"${took}"`)
            .replace(/^Snapshot saved at .*$/, `Snapshot saved at ${file}`),
        );
      // On one terminal (checked with etcd 3.7.0 in a pty, 2026-11-01) the logs all come first.
      const ordered = x.viaExec ? lines : [...lines.filter((l) => l.startsWith('{')), ...lines.filter((l) => !l.startsWith('{'))];
      return { ...out(stampZap(ordered, x.state.clock), 0, 'k9.explain.etcdSaved', { file }), changed: true };
    }
    // 3.7: status and restore moved to etcdutl; etcdctl prints the `snapshot` help.
    return out(usage, 0, sub === 'status' || sub === 'restore' ? 'k9.explain.etcdctlNoStatus' : 'k9.explain.etcdctlSnapshotHelp');
  }
  if (cmd === 'endpoint' && sub === 'health') {
    const conn = connect(x, f);
    if (!conn.ok) return conn.hang ? out([], 1, 'k9.err.etcdHang', {}, ['# etcdctl could not get in (certificate flags). The lesson shows what it prints.']) : out([conn.line], 128, 'k9.err.etcdOpen');
    const took = `${5 + (x.state.clock % 9)}.${String(fnv32a(`h${x.state.clock}`) % 1_000_000).padStart(6, '0')}ms`;
    const h = fx('etcdctl-endpoint-health');
    return out([h.text.split(h.vars?.endpoint ?? 'https://127.0.0.1:2379').join(conn.endpoint).replace(/took = \S+/, `took = ${took}`)], 0, 'k9.explain.etcdHealthy');
  }
  if (cmd === 'member' && sub === 'list') {
    const conn = connect(x, f);
    if (!conn.ok) return conn.hang ? out([], 1, 'k9.err.etcdHang', {}, ['# etcdctl could not get in (certificate flags). The lesson shows what it prints.']) : out([conn.line], 128, 'k9.err.etcdOpen');
    const node = cpNode(x.c) ?? 'dev-control-plane';
    const ip = nodeIp(x.c, node);
    return out(fill('etcdctl-member-list', { node, ip }).split('\n'), 0, 'k9.explain.etcdMembers');
  }
  if (!cmd) return out([], 0, 'k9.explain.etcdctlHelp', {}, ['# etcdctl: try etcdctl snapshot save, etcdctl endpoint health, etcdctl member list']);
  return out([], 0, 'k9.explain.notInShell', { cmd: `etcdctl ${cmd}` }, [`# etcdctl ${cmd}: the lesson shows what it does`]);
}

export function etcdutl(x: EtcdCtx, argv: string[]): EtcdRun {
  const { flags: f, words } = parseArgs(argv);
  const [cmd, sub, ...rest] = words;
  if (cmd === 'version') return out(fx('etcdutl-version').text.split('\n'), 0, 'k9.explain.etcdVersion');
  if (cmd === 'snapshot' && sub === 'status') {
    const file = rest[0];
    if (!file) return out([], 1, 'k9.err.etcdStatusUsage', {}, ['# Give the snapshot file: etcdutl snapshot status FILE']);
    const snap = snapshotOf(x, abs(x.cwd, file));
    if (snap === undefined) return out([`Error: stat ${file}: no such file or directory`], 1, 'k9.err.etcdNoFile', { file });
    if (snap === null) return out([], 1, 'k9.err.etcdNotSnapshot', { file }, ['# That file is not an etcd snapshot.']);
    const fmt = f['write-out'] ?? f.w ?? 'simple';
    if (fmt === 'json') return out([JSON.stringify({ hash: parseInt(snap.hash, 16), revision: snap.rv, totalKey: snap.keys, totalSize: snap.size, version: '3.7.0' })], 0, 'k9.explain.etcdStatus', { file });
    if (fmt === 'table') {
      const t = fx('etcdutl-status-table').text.split('\n');
      const row = t[3]!;
      const cells = row.split('│').slice(1, -1);
      const vals = [snap.hash, String(snap.rv), String(snap.keys), humanBytes(snap.size), '3.7.0'];
      t[3] = `│${cells.map((cell, i) => ` ${vals[i]!.padStart(cell.length - 2)} `).join('│')}│`;
      return out(t, 0, 'k9.explain.etcdStatus', { file });
    }
    return out([`${snap.hash}, ${snap.rv}, ${snap.keys}, ${humanBytes(snap.size)}, 3.7.0`], 0, 'k9.explain.etcdStatus', { file });
  }
  if (cmd === 'snapshot' && sub === 'restore') {
    const file = rest[0];
    if (!file) return out([], 1, 'k9.err.etcdRestoreUsage', {}, ['# Give the snapshot file: etcdutl --data-dir DIR snapshot restore FILE']);
    const dirTyped = f['data-dir'] ?? 'default.etcd';
    const dir = abs(x.cwd, dirTyped);
    const fr = fx('etcdutl-restore');
    const rec = fr.text.split('\n');
    const fillLine = (l: string) => l.split(fr.vars?.dir ?? '/opt/etcd-restore').join(dirTyped).split(fr.vars?.file ?? '/opt/snapshot.db').join(file).replace(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ/, iso(x.state.clock));
    if (x.fs.isDir(dir) && x.fs.hasChildren(dir)) return out([`Error: data-dir "${dirTyped}" not empty or could not be read`], 1, 'k9.err.etcdDirNotEmpty', { dir: dirTyped });
    const snap = snapshotOf(x, abs(x.cwd, file));
    if (snap === undefined) return out([fillLine(rec[0]!), `Error: open ${file}: no such file or directory`], 1, 'k9.err.etcdNoFile', { file });
    if (snap === null) return out([fillLine(rec[0]!)], 1, 'k9.err.etcdNotSnapshot', { file }, ['# That file is not an etcd snapshot.']);
    x.fs.mkdirp(`${dir}/member/wal`);
    x.fs.mkdirp(`${dir}/member/snap`);
    const host = x.fs.hostPath(`${dir}`);
    x.fs.write(`${dir}/member/snap/db`, `${ETCD_DB_MARK}${host ?? `container:${dir}`}`);
    const e = ensureEtcd(x.c);
    e.stores[host ?? `container:${dir}`] = { objects: clone(snap.objects), rv: snap.rv, from: snap.id };
    return { ...out(rec.map(fillLine), 0, 'k9.explain.etcdRestored', { dir: dirTyped }), changed: true };
  }
  return out([], 0, 'k9.explain.notInShell', { cmd: `etcdutl ${cmd ?? ''}`.trim() }, [`# etcdutl ${cmd ?? ''}: the lesson shows what it does`.replace('  ', ' ')]);
}

/** `kubectl exec etcd-<node> -n kube-system -- etcdctl …`: etcdctl / etcdutl inside the etcd container. */
export function etcdInPod(state: KubeState, c: Cluster, pod: KObject, argv: string[]): EtcdRun | null {
  const tool = (argv[0] ?? '').replace(/^.*\//, '');
  if (tool !== 'etcdctl' && tool !== 'etcdutl') return null;
  if (pod.metadata.labels?.component !== 'etcd' || !pod.metadata.annotations?.['kubernetes.io/config.mirror']) return null;
  const node = pod.spec?.nodeName;
  if (!node || !c.nodes[node]) return null;
  const os = ensureOs(state, c, node);
  const sp = Object.values(os.statics).find((x) => x.component === 'etcd');
  const manifest = sp ? os.files[sp.file] : undefined;
  const mounts: { mountPath: string; hostPath: string }[] = [];
  const doc = manifest ? parseManifests(manifest).docs[0] : undefined;
  for (const m of doc?.spec?.containers?.[0]?.volumeMounts ?? []) {
    const vol = (doc?.spec?.volumes ?? []).find((v: any) => v.name === m.name);
    if (vol?.hostPath?.path) mounts.push({ mountPath: String(m.mountPath).replace(/\/$/, ''), hostPath: String(vol.hostPath.path).replace(/\/$/, '') });
  }
  const rt = c.pods[pod.metadata.uid]?.containers[pod.spec.containers[0].name];
  const own = (rt ? (rt.written ??= {}) : {}) as Record<string, string>;
  const x = { state, c, fs: podFs(os, mounts, own), cwd: '/', viaExec: true };
  return tool === 'etcdctl' ? etcdctl(x, argv.slice(1)) : etcdutl(x, argv.slice(1));
}
