// Core types for the Belajar Sendiri food-court simulator (Kubernetes 1.37).
// Pure TypeScript: no DOM, no React, no UI strings (explanations are i18n keys).
//
// Story words: a cluster is the food court, a node is a stall, a pod is a tray,
// a Deployment is the manager's standing order, a Service is an order number.
import type { Line } from '../git-sim/types';

export type { Line, Seg, Color } from '../git-sim/types';

/** Kubernetes objects are plain JSON. Specs stay loose; the code reads the fields it models. */
export interface ObjectMeta {
  name: string;
  generateName?: string;
  namespace?: string;
  uid: string;
  resourceVersion: string;
  generation?: number;
  creationTimestamp: string;
  deletionTimestamp?: string;
  deletionGracePeriodSeconds?: number;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  ownerReferences?: OwnerReference[];
  finalizers?: string[];
}

export interface OwnerReference {
  apiVersion: string;
  kind: string;
  name: string;
  uid: string;
  controller?: boolean;
  blockOwnerDeletion?: boolean;
}

export interface KObject {
  apiVersion: string;
  kind: string;
  metadata: ObjectMeta;
  spec?: any;
  status?: any;
  [field: string]: any;
}

/** A container's state, like `status.containerStatuses[].state`. */
export type ContainerState =
  | { waiting: { reason: string; message?: string } }
  | { running: { startedAt: string } }
  | { terminated: { exitCode: number; reason: string; startedAt?: string; finishedAt: string; message?: string; signal?: number } };

/** What a container's program does (from the image catalog and its command). */
export interface Behavior {
  /** Seconds after start before it listens / is healthy. */
  warmup: number;
  /** HTTP server ports. */
  ports: number[];
  /** Answer an HTTP request (path → status + body). */
  http?: (path: string) => { status: number; body: string };
  /** Exit after this many seconds (undefined = runs until stopped). */
  exitAfter?: number;
  exitCode?: number;
  /** Lines printed at start (seconds after start → text). */
  logs: { at: number; text: string }[];
  /** A line printed every `every` seconds while running. */
  repeat?: { every: number; text: string };
  /** Memory (MiB) used after t seconds. */
  memory: (t: number) => number;
  /** CPU (millicores) used at rest. */
  cpu: number;
  /** PID 1 ignores SIGTERM (e.g. `sleep`), so deletion waits the whole grace period. */
  ignoresTerm: boolean;
  /** Files that exist in the container (for `cat`, exec probes). path → content. */
  files: Record<string, string>;
  /** Timed file changes from the command (`touch x; sleep 30; rm x`). */
  fileOps: { at: number; op: 'touch' | 'rm'; path: string }[];
  /** Which tools the image has for `kubectl exec` (curl, wget, sh...). */
  tools: string[];
  /** Shown for `kubectl exec` / docs: the main process. */
  process: string;
}

/** Hidden runtime of one container instance (what the kubelet and runtime know). */
export interface ContainerRuntime {
  name: string;
  /** When the current instance started (sim seconds), or null when not running. */
  startedAt: number | null;
  /** When the next start may happen (pull done, or back-off over). */
  nextStartAt: number | null;
  /** Back-off seconds for the next restart (10, 20, 40 … 300). */
  backoff: number;
  /** The back-off being waited out now (shown in CrashLoopBackOff messages). */
  wait: number;
  pullAttempts: number;
  pulled: boolean;
  /** A pull is in progress (it finishes at nextStartAt). */
  pulling: boolean;
  /** Log lines of the current and previous instance. */
  logs: { t: number; text: string }[];
  previousLogs: { t: number; text: string }[] | null;
  /** Probe counters. */
  readyOk: number;
  readyFail: number;
  liveFail: number;
  startupOk: boolean;
  /** Last request count, for access logs. */
  requests: number;
  /** Extra memory leak (MiB per second) injected by a fault. */
  leak: number;
  /** Readiness forced to fail by a fault. */
  sick: boolean;
  /** Killed by the user/liveness: the time it must stop. */
  killAt: number | null;
  killReason: string | null;
  /** Environment variables the current instance started with (env + envFrom, read at start). */
  env?: Record<string, string>;
  /** Files written by `kubectl exec` outside any volume (gone when the container restarts). */
  written?: Record<string, string>;
}

export interface PodRuntime {
  uid: string;
  containers: Record<string, ContainerRuntime>;
  initDone: number;
  /** Deletion: when the pod object really goes away (after the grace period). */
  goneAt: number | null;
}

export interface NodeRuntime {
  /** False after a "kill node" fault: the kubelet stops posting status. */
  up: boolean;
  /** Last heartbeat (sim seconds). */
  heartbeat: number;
  /** Images already on this node (no pull needed). */
  images: string[];
  /** When it went NotReady (sim seconds), for eviction timing. */
  notReadySince: number | null;
  /** K9: the node's own machine (files, the kubelet service, its journal). Made the first time it is needed. */
  os?: NodeOs;
}

/** One line in a node's journal (journalctl). */
export interface JournalLine {
  t: number;
  unit: 'systemd' | 'kubelet';
  /** kubelet PID (kubelet lines). */
  pid?: number;
  /** klog level (kubelet lines). */
  level?: 'I' | 'W' | 'E';
  /** The text after the klog header (kubelet) or after "systemd[1]: ". */
  text: string;
}

/** A static pod the kubelet runs from a manifest file (what it last read). */
export interface StaticPod {
  file: string;
  /** Mirror pod name (<manifest name>-<node>) and namespace. */
  name: string;
  namespace: string;
  /** The manifest's metadata.name (kube-scheduler …) and component label. */
  base: string;
  component: string;
  /** kubernetes.io/config.hash of the manifest. */
  hash: string;
  container: string;
  image: string;
  command: string[];
  labels: Record<string, string>;
  annotations: Record<string, string>;
  /** Log lines when the program exits at once (a misspelt flag, a file that is not there), else null. */
  crash: string[] | null;
  /** etcd only: the folder on the node that holds its data. */
  dataDir?: string;
  /** The manifest's hostPath volumes and mounts, and its priority (copied to the mirror pod). */
  volumes?: any[];
  volumeMounts?: any[];
  priority?: number;
}

/** K9: a kind node container (Debian 13, systemd, containerd, the kubelet). */
export interface NodeOs {
  /** Files on the node: absolute path → content. */
  files: Record<string, string>;
  dirs: string[];
  /** The kubelet service: when it last started / stopped, its PID and systemd invocation id. */
  kubelet: { since: number; pid: number; invocation: string; stoppedAt: number | null; duration: number };
  journal: JournalLine[];
  /** What the kubelet runs from /etc/kubernetes/manifests, by file. */
  statics: Record<string, StaticPod>;
  /** A manifest changed at this time (the kubelet notices a few seconds later), or null. */
  dirty: number | null;
  /** Last time the kubelet read the manifest folder. */
  checkedAt: number;
  pidNext: number;
  /** When files last changed (for `ls -l`); files not listed date from the node's start. */
  mtime: Record<string, number>;
  /** When each kubeadm certificate was last (re)made (`kubeadm certs renew`), by name; unset = at cluster start. */
  certs: Record<string, number>;
}

/** K9: etcd's data on the control-plane node, snapshots and restores. */
export interface EtcdState {
  /** The folder (on the node) etcd reads now. */
  dataDir: string;
  /** Other data folders: what they hold (objects as etcd stored them). */
  stores: Record<string, { objects: Record<string, KObject>; rv: number; from?: string }>;
  /** Snapshot files by id (the node file holds `etcd-snapshot:<id>`). */
  snapshots: Record<string, EtcdSnapshot>;
  /** Times a restored data folder was put to use, and the snapshot ids. */
  restoredFrom: string[];
}

export interface EtcdSnapshot {
  id: string;
  at: number;
  objects: Record<string, KObject>;
  rv: number;
  hash: string;
  keys: number;
  size: number;
}

/** One cluster (food court). */
export interface Cluster {
  name: string;
  /** Server version, e.g. v1.37.0 */
  version: string;
  /** API server URL shown by `kubectl cluster-info`. */
  server: string;
  /** Next resourceVersion. */
  rv: number;
  objects: Record<string, KObject>;
  pods: Record<string, PodRuntime>;
  nodes: Record<string, NodeRuntime>;
  /** Next pod IP per node (last octet). */
  ipNext: Record<string, number>;
  /** Next ClusterIP / NodePort to hand out. */
  svcNext: number;
  portNext: number;
  /** Optional add-ons. */
  addons: { metricsServer: boolean; gateway: boolean; networkPolicy: boolean; loadBalancer: boolean };
  /** Round-robin counter per Service (which endpoint answers next). */
  rr: Record<string, number>;
  /** kind = a local kind cluster; cloud = a managed cluster (no control-plane node shown). */
  kind: 'kind' | 'cloud';
  /** Pods a controller lost (deleted or evicted), by controller uid: for "podReplaced" events. */
  lost: Record<string, string[]>;
  /** Simulated traffic: requests per second per Service ("namespace/name"). Drives CPU and the HPA. */
  load: Record<string, number>;
  /** Last HPA sync time per HPA uid. */
  hpaSync: Record<string, number>;
  /** Times a scheduling failure was last reported, by pod uid (so events aggregate). */
  unschedulable: Record<string, string>;
  /** Files written into emptyDir (`emptyDir/<pod uid>/<volume>`) and PVC (`pvc/<ns>/<claim>`) volumes. */
  volumeData?: Record<string, Record<string, string>>;
  /** K9: etcd backups and restores (made the first time a node shell touches etcd). */
  etcd?: EtcdState;
  /** K9: control-plane nodes have etcdctl / etcdutl installed (exam-style nodes; kind nodes have neither). */
  etcdTools?: boolean;
}

export interface Context {
  cluster: string;
  user: string;
  namespace?: string;
}

/** An open `kubectl port-forward` (it keeps running in a real terminal). */
export interface PortForward {
  context: string;
  local: number;
  namespace: string;
  /** The pod it really talks to (a Service forward picks one pod at the start). */
  pod: string;
  podPort: number;
  target: string;
}

export interface KubeState {
  clusters: Record<string, Cluster>;
  contexts: Record<string, Context>;
  currentContext: string;
  /** Learner's virtual files (manifests), absolute path → content. */
  files: Record<string, string>;
  dirs: string[];
  cwd: string;
  home: string;
  /** Sim time, unix seconds. All clusters share it. */
  clock: number;
  seed: string;
  counter: number;
  forwards: PortForward[];
  /** kubeconfig users → who the API server thinks they are. */
  users: Record<string, { user: string; groups: string[] }>;
  /** Real seconds per tick is the UI's business; the engine only counts. */
  kubectlVersion: string;
  kustomizeVersion: string;
  /** K9: a shell open inside a node (`ssh dev-worker`, `docker exec -it dev-worker bash`). */
  shell?: NodeShell;
}

/** An open node shell: commands run on that node until `exit`. */
export interface NodeShell {
  cluster: string;
  node: string;
  cwd: string;
  via: 'ssh' | 'docker';
  /** Variables set with `export` (KUBECONFIG, ETCDCTL_API …). */
  env: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Events: animations and the Manager's board listen to these.

export type KubeEvent =
  | { type: 'objectCreated'; kind: string; name: string; namespace?: string }
  | { type: 'objectUpdated'; kind: string; name: string; namespace?: string }
  | { type: 'objectDeleted'; kind: string; name: string; namespace?: string }
  | { type: 'podCreated'; pod: string; namespace: string; owner?: string }
  | { type: 'podScheduled'; pod: string; namespace: string; node: string }
  | { type: 'podFailedScheduling'; pod: string; namespace: string; message: string }
  | { type: 'podStarted'; pod: string; namespace: string; container: string }
  | { type: 'podReady'; pod: string; namespace: string; ready: boolean }
  | { type: 'podCrashed'; pod: string; namespace: string; container: string; reason: string; exitCode: number }
  | { type: 'podRestarted'; pod: string; namespace: string; container: string; restarts: number }
  | { type: 'imagePullFailed'; pod: string; namespace: string; image: string }
  | { type: 'podDeleted'; pod: string; namespace: string; by: 'user' | 'controller' | 'eviction' | 'gc' }
  | { type: 'podGone'; pod: string; namespace: string }
  | { type: 'podReplaced'; old: string; pod: string; namespace: string; owner: string }
  | { type: 'reconcile'; controller: string; name: string; namespace: string; want: number; see: number; do: 'create' | 'delete' | 'none'; count: number }
  | { type: 'scaled'; kind: string; name: string; namespace: string; from: number; to: number }
  | { type: 'rolloutStep'; deployment: string; namespace: string; revision: number; newReady: number; oldPods: number; want: number }
  | { type: 'rolloutComplete'; deployment: string; namespace: string; revision: number }
  | { type: 'nodeDown'; node: string }
  | { type: 'nodeNotReady'; node: string }
  | { type: 'nodeUp'; node: string }
  | { type: 'podEvicted'; pod: string; namespace: string; node: string }
  | { type: 'requestRouted'; from: string; hops: string[]; pod: string | null; status: number | null; error?: string }
  | { type: 'forbidden'; user: string; verb: string; resource: string; namespace?: string }
  | { type: 'admissionDenied'; reason: 'podSecurity' | 'quota' | 'invalid'; name: string }
  | { type: 'contextSwitched'; from: string; to: string }
  | { type: 'namespaceSwitched'; namespace: string }
  | { type: 'portForward'; local: number; target: string }
  | { type: 'shellOpened'; node: string }
  | { type: 'shellClosed'; node: string }
  | { type: 'kubeletStopped'; node: string }
  | { type: 'kubeletStarted'; node: string }
  | { type: 'manifestChanged'; node: string; file: string }
  | { type: 'staticPodStopped'; node: string; pod: string }
  | { type: 'staticPodStarted'; node: string; pod: string }
  | { type: 'etcdRestored'; dataDir: string }
  | { type: 'tick'; clock: number }
  | { type: 'cleared' }
  | { type: 'error'; code: string };

/** A friendly, translatable explanation shown under the output (`kube.explain.*` / `kube.err.*`). */
export interface Explain {
  key: string;
  params?: Record<string, string>;
}

export interface KubeResult {
  state: KubeState;
  output: Line[];
  events: KubeEvent[];
  ok: boolean;
  explain?: Explain;
  /** Not a mistake although `ok` is false (`auth can-i` saying no, `diff` finding changes, an explain-only command). */
  stopped?: boolean;
  /** Exit status when it is not simply 0 / 1. */
  exitCode?: number;
  /** The command changed something in a cluster (for "danger" flashes and the board). */
  changed?: boolean;
}

/** One request answered (or not) by the cluster network. */
export interface HttpResult {
  ok: boolean;
  status: number | null;
  body: string;
  /** Pod that answered. */
  pod: string | null;
  hops: string[];
  /** Why it failed: dns, refused, timeout, noRoute, noEndpoints. */
  error?: 'dns' | 'refused' | 'timeout' | 'noRoute' | 'noEndpoints' | 'badGateway';
  host?: string;
  ip?: string;
}
