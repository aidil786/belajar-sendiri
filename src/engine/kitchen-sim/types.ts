// Core types for the FahamLah kitchen simulator (Docker Engine 29.x + Compose v5).
// Pure TypeScript: no DOM, no React, no i18n strings. The state is plain data, so
// structuredClone copies it and lessons can save it.
import type { Line } from '../git-sim/types';

export type { Color, Line, Seg } from '../git-sim/types';

/** Path → file content (absolute paths). */
export type FileMap = Record<string, string>;

// ---------------------------------------------------------------------------
// Images

export interface ImageConfig {
  User?: string;
  ExposedPorts?: Record<string, Record<string, never>>;
  Env?: string[];
  Entrypoint?: string[] | null;
  Cmd?: string[] | null;
  Volumes?: Record<string, Record<string, never>> | null;
  WorkingDir?: string;
  Labels?: Record<string, string> | null;
  StopSignal?: string;
  Healthcheck?: HealthConfig;
}

export interface HealthConfig {
  /** ["CMD-SHELL", "wget -qO- ..."] or ["CMD", "pg_isready", ...] or ["NONE"]. */
  Test: string[];
  /** Seconds (Docker stores nanoseconds; the sim keeps seconds). */
  Interval?: number;
  Timeout?: number;
  StartPeriod?: number;
  Retries?: number;
}

/** One measured image from the built-in registry catalog (see catalog-data.ts). */
export interface CatalogEntry {
  ref: string;
  /** Index digest (64 hex), which is the image ID with the containerd image store. */
  id: string;
  manifest: string;
  created: string;
  /** `docker images` DISK USAGE / CONTENT SIZE, as printed. */
  disk: string;
  content: string;
  platformDisk: string;
  platformContent: string;
  /** `docker image inspect` Size (bytes). */
  size: number;
  /** Compressed layer digests (64 hex) and sizes, in manifest order. */
  layers: [string, number][];
  diffIds: string[];
  platforms: string[];
  config: ImageConfig;
  /** [CreatedBy, SIZE, COMMENT, CreatedAt] newest first, like `docker history`. */
  history: [string, string, string, string][];
}

/** What a program inside an image is, so the simulator knows how it behaves. */
export type ImageKind = 'hello' | 'alpine' | 'busybox' | 'nginx' | 'node' | 'python' | 'postgres' | 'redis' | 'debian';

export interface HistoryRow {
  createdBy: string;
  /** Bytes (0 for metadata-only steps). */
  size: number;
  /** Printed size, when measured (catalog images). */
  sizeText?: string;
  comment: string;
  created: number;
}

export interface LocalImage {
  /** 64 hex. With the containerd store this is the index digest. */
  id: string;
  /** Full refs this image is known by, e.g. "docker.io/library/nginx:1.30-alpine". */
  repoTags: string[];
  /** "nginx@sha256:..." */
  repoDigests: string[];
  created: number;
  config: ImageConfig;
  history: HistoryRow[];
  /** Layer diff ids (64 hex), oldest first. */
  layers: string[];
  /** Compressed layer digests (64 hex), for pull lines like "5b8cb54cfa40: Pull complete". */
  blobs: string[];
  /** Bytes on disk (unpacked) and compressed, for DISK USAGE / CONTENT SIZE and inspect Size. */
  diskSize: number;
  contentSize: number;
  /** Printed sizes for catalog images (exactly as measured). */
  diskText?: string;
  contentText?: string;
  size: number;
  platform: string;
  /** Behaviour family (base image kind for built images). */
  kind: ImageKind;
  /** Files baked into the image (built images: copied and created files). */
  files: FileMap;
  /** Folders known to exist in the image. */
  dirs: string[];
  /** Users in /etc/passwd: name → [uid, gid]. */
  users: Record<string, [number, number]>;
  /** Programs on PATH (e.g. curl, wget, bash). */
  bins: string[];
  /** Owner uid of paths that are not root's (COPY --chown, RUN chown, a user's home). */
  owners?: Record<string, number>;
  source: 'catalog' | 'build' | 'pull';
  /** The catalog ref this came from (or the base image's, for builds). */
  catalogRef?: string;
  /** For built images: the Dockerfile stage and labels. */
  labels?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Containers

export type ContainerStatus = 'created' | 'running' | 'paused' | 'restarting' | 'exited' | 'dead';

export interface PortBinding {
  hostIp: string; // '0.0.0.0' or '127.0.0.1'
  hostPort: number;
  containerPort: number;
  proto: 'tcp' | 'udp';
}

export interface Mount {
  type: 'volume' | 'bind' | 'tmpfs';
  /** Volume name, or absolute host path for binds; '' for tmpfs. */
  source: string;
  target: string;
  readOnly: boolean;
  /** Volume created only for this container (image VOLUME, no name given). */
  anonymous?: boolean;
}

export interface LogLine {
  t: number;
  s: 'o' | 'e';
  text: string;
}

/** A listener inside a container: what answers on that port. */
export interface Listener {
  port: number;
  /** Address the program listens on inside the container. */
  host: '0.0.0.0' | '127.0.0.1';
  kind: 'nginx' | 'app' | 'python-http' | 'redis' | 'postgres';
}

/** What the main process is doing, as plain data. */
export interface Proc {
  kind: 'hello' | 'nginx' | 'postgres' | 'redis' | 'node' | 'python' | 'shell' | 'sleep' | 'exited';
  argv: string[];
  user: string;
  listeners: Listener[];
  /** Seconds after start when it ends on its own (sleep N), with that exit code. */
  exitAfter?: number;
  exitCode?: number;
  /** Exit code after `docker stop`, and whether Docker had to wait 10 s and kill it. */
  stopCode: number;
  stopKills: boolean;
  /** For node/python apps: the JSON or text the app answers with. */
  reply?: { status: number; type: string; body: string };
  /** Line the app prints when it starts listening. */
  /** Interactive programs (sh/node/python with -it) wait for input. */
  interactive?: boolean;
}

export interface Health {
  status: 'starting' | 'healthy' | 'unhealthy';
  failing: number;
  /** Next check time (fake clock). */
  next: number;
  log: { start: number; end: number; code: number; output: string }[];
}

export interface Container {
  id: string;
  name: string;
  /** Image as typed (e.g. "nginx:1.30-alpine"). */
  image: string;
  imageId: string;
  platform: string;
  entrypoint: string[];
  cmd: string[];
  env: string[];
  user: string;
  workdir: string;
  hostname: string;
  labels: Record<string, string>;
  ports: PortBinding[];
  /** Ports the image exposes (and --expose). */
  exposed: string[];
  publishAll: boolean;
  mounts: Mount[];
  /** Network name → IP and DNS aliases. */
  networks: Record<string, { ip: string; aliases: string[]; mac: string; endpoint: string }>;
  networkMode: string;
  status: ContainerStatus;
  exitCode: number;
  created: number;
  startedAt: number | null;
  finishedAt: number | null;
  restartPolicy: { name: 'no' | 'always' | 'unless-stopped' | 'on-failure'; max: number };
  restartCount: number;
  /** While "Restarting": when Docker tries again, and the back-off delay (seconds). */
  restartAt?: number;
  restartDelay?: number;
  /** The learner stopped it (unless-stopped / always don't restart after that). */
  stoppedByUser: boolean;
  autoRemove: boolean;
  readOnly: boolean;
  capDrop: string[];
  capAdd: string[];
  tty: boolean;
  interactive: boolean;
  init: boolean;
  logs: LogLine[];
  /** Files written in the container's own writable layer. */
  files: FileMap;
  /** Files deleted from the image in the writable layer. */
  deleted: string[];
  dirs: string[];
  /** Owner uid of paths made inside the container by a non-root user. */
  owners: Record<string, number>;
  /** tmpfs contents (cleared on stop). */
  tmp: FileMap;
  health: Health | null;
  healthcheck: HealthConfig | null;
  proc: Proc | null;
  /** Things like redis keys. */
  memory: Record<string, string>;
  /** Error text from the last failed start (shown by inspect). */
  error: string;
  /** Compose service, when made by `docker compose`. */
  stopSignal?: string;
  oomKilled: boolean;
  pidBase: number;
  /** cgroup limits from `--memory` (bytes), `--cpus` (nano CPUs) and `--pids-limit`. Missing = no limit. */
  limits?: { memory: number; nanoCpus: number; pids: number | null };
}

// ---------------------------------------------------------------------------
// Volumes, networks, registry

export interface Volume {
  name: string;
  created: number;
  labels: Record<string, string>;
  /** Files, relative to the volume root (no leading slash). */
  files: FileMap;
  dirs: string[];
  /** uid that owns the volume root (copied from the image on first mount). */
  owner: number;
  anonymous: boolean;
  /** First mount copied the image's files in already. */
  initialized: boolean;
  /** Tables of the tiny postgres (kept with the data, so they survive `docker rm`). */
  pg?: Record<string, string[][]>;
}

export interface Network {
  id: string;
  name: string;
  driver: 'bridge' | 'host' | 'null';
  created: number;
  subnet: string;
  gateway: string;
  labels: Record<string, string>;
  internal: boolean;
  builtin: boolean;
  /** Next free host part for container IPs. */
  nextIp: number;
}

export interface RegistryRepo {
  /** tag → image snapshot (pushed or seeded). */
  tags: Record<string, LocalImage>;
  /** Only this user may push; pulls are public unless `private`. */
  owner: string;
  private?: boolean;
}

export interface Registry {
  /** Docker Hub answers 429 Too Many Requests to anonymous pulls. */
  rateLimited: boolean;
  /** Logged-in user per registry host ("docker.io", "ghcr.io"). */
  auth: Record<string, string>;
  /** Accounts that exist: username → access token (and optional password). */
  users: Record<string, { token: string; password?: string }>;
  /** Pushed or seeded repos, keyed by full path: "docker.io/you/diary". */
  repos: Record<string, RegistryRepo>;
}

export interface CacheRecord {
  key: string;
  created: number;
  lastUsed: number;
  size: number;
  description: string;
  /** Layer result (files added/removed) so a cache hit can reuse it. */
  diffId: string;
  inUse: boolean;
}

// ---------------------------------------------------------------------------
// Host (the learner's laptop)

export interface HostInfo {
  name: string;
  platform: string; // 'linux/amd64'
  variant: string; // 'v3'
  cpus: number;
  memBytes: number;
  kernel: string;
  os: string;
  ipv6: boolean;
  /** Ports used by other programs on the laptop (e.g. a dev server on 3000). */
  busyPorts: number[];
  dockerUp: boolean;
}

/** A program waiting for the learner's input (a shell inside a container, a password prompt, an attached run). */
export type Session =
  | { kind: 'shell'; container: string; cwd: string; user: string; main: boolean }
  | { kind: 'repl'; container: string; lang: 'node' | 'python'; main: boolean }
  | { kind: 'attached'; containers: string[]; compose?: string }
  | { kind: 'password'; user: string; registry: string }
  /** A prune asked "Are you sure you want to continue? [y/N]": `y` runs `command` (with -f). */
  | { kind: 'confirm'; command: string };

export interface KitchenState {
  v: 1;
  fs: { files: FileMap; dirs: string[]; modes: Record<string, string> };
  cwd: string;
  home: string;
  user: string;
  lastDir: string | null;
  env: Record<string, string>;
  lastExit: number;
  clock: number;
  seed: string;
  counter: number;
  host: HostInfo;
  images: Record<string, LocalImage>;
  /** Full ref "docker.io/library/nginx:1.30-alpine" → image id. */
  tags: Record<string, string>;
  containers: Record<string, Container>;
  volumes: Record<string, Volume>;
  networks: Record<string, Network>;
  buildCache: CacheRecord[];
  /** Layer contents made by builds, so cache hits can reuse them: diffId → files. */
  layerStore: Record<string, { files: FileMap; dirs: string[]; deleted: string[]; size: number; users?: Record<string, [number, number]>; bins?: string[] }>;
  registry: Registry;
  session: Session | null;
  /** Names of compose projects made here: project → working folder and files. */
  compose: Record<string, { dir: string; files: string[] }>;
  /** The last `docker build`: steps from cache and steps built (for goals and the kek lapis picture). */
  lastBuild?: { ref: string | null; id: string; cached: number; built: number; steps: { step: string; instruction: string; cached: boolean; size: number }[] };
}

// ---------------------------------------------------------------------------
// Events: animations and the state picture listen to these.

export type KitchenEvent =
  | { type: 'imagePulled'; ref: string; id: string; layers: number; cached: number }
  | { type: 'imageBuilt'; ref: string | null; id: string }
  | { type: 'imageTagged'; ref: string; id: string }
  | { type: 'imageRemoved'; ref: string; id: string; deleted: boolean }
  | { type: 'imagePushed'; ref: string }
  | { type: 'layerBuilt'; step: string; instruction: string; size: number }
  | { type: 'layerCached'; step: string; instruction: string }
  | { type: 'containerCreated'; id: string; name: string; image: string }
  | { type: 'containerStarted'; id: string; name: string }
  | { type: 'containerExited'; id: string; name: string; code: number }
  | { type: 'containerPaused'; id: string; name: string }
  | { type: 'containerUnpaused'; id: string; name: string }
  | { type: 'containerRemoved'; id: string; name: string }
  | { type: 'portMapped'; container: string; hostPort: number; containerPort: number }
  | { type: 'volumeCreated'; name: string }
  | { type: 'volumeRemoved'; name: string }
  | { type: 'networkCreated'; name: string }
  | { type: 'networkRemoved'; name: string }
  | { type: 'networkConnected'; network: string; container: string }
  | { type: 'networkDisconnected'; network: string; container: string }
  | { type: 'composeUp'; project: string; services: string[] }
  | { type: 'composeDown'; project: string }
  | { type: 'requestServed'; from: string; to: string; port: number; status: number }
  | { type: 'loggedIn'; registry: string; user: string }
  | { type: 'loggedOut'; registry: string }
  | { type: 'fileWritten'; path: string }
  | { type: 'cwdChanged'; cwd: string }
  | { type: 'cleared' }
  | { type: 'error'; code: string };

export interface Explain {
  key: string;
  params?: Record<string, string>;
}

export interface KitchenResult {
  state: KitchenState;
  output: Line[];
  events: KitchenEvent[];
  ok: boolean;
  explain?: Explain;
  /** Non-zero, but not a mistake (e.g. an explain-only command, curl to a stopped app on purpose). */
  stopped?: boolean;
  exitCode?: number;
  /** Prompt to show instead of the laptop prompt (a shell inside a container, a password). */
  prompt?: string;
}

export interface Ctx {
  raw: string;
  /** Text piped into this command (`echo $TOKEN | docker login ... --password-stdin`). */
  stdin?: string;
}

export type KitchenFn = (state: KitchenState, args: string[], ctx: Ctx) => KitchenResult;
