// Lesson goals for the kitchen: "is the learner's kitchen in the state we asked for?"
// Pure and data-driven, so lesson files describe goals as plain objects.
import { parseSize } from './format';
import { httpFetch, parseUrl } from './net';
import { findContainer, findImage } from './state';
import type { Container, KitchenState } from './types';

export interface KitchenGoal {
  /** These containers (names or ids) are running. */
  running?: string[];
  /** These containers exited: a list, or { name: exitCode }. */
  exited?: string[] | Record<string, number>;
  /** These containers exist but were never started. */
  created?: string[];
  paused?: string[];
  /** Health check says healthy. */
  healthy?: string[];
  /** These containers do not exist (removed, or never made). */
  notExists?: string[];
  /** Port mappings: { web: '8080:80' } (host:container). */
  portMapped?: Record<string, string>;
  /** curl from the laptop gets an answer (2xx/3xx): 'localhost:8080' or a list. */
  reachable?: string | string[];
  /** The answer contains this text: { 'localhost:8080': 'Kedai Kancil' }. */
  reachableContains?: Record<string, string>;
  /** curl from the laptop fails (refused / reset). */
  unreachable?: string[];
  /** Images present locally ("diary:1.0", "nginx:1.30-alpine"). */
  imageExists?: string | string[];
  imageMissing?: string[];
  /** Image DISK USAGE at most this: { 'diary:1.0': '100MB' }. */
  imageMaxSize?: Record<string, string>;
  /** Image runs as this user, or 'nonroot' for any user but root: { 'diary:1.0': 'nonroot' }. */
  imageUser?: Record<string, string>;
  /** Number of filesystem layers in an image: { 'diary:1.0': 10 }. */
  layers?: Record<string, number>;
  /** The last build used at least this many cached steps. */
  cacheHits?: number;
  /** The last build built at most this many steps again. */
  maxRebuilt?: number;
  volumeExists?: string[];
  volumeMissing?: string[];
  /** Files in a volume (paths inside the volume): { 'pgdata': '18/docker/PG_VERSION' }. */
  fileInVolume?: Record<string, string | string[]>;
  /** A table exists in the tiny postgres kept in this volume: { pgdata: 'notes' }. */
  tableInVolume?: Record<string, string>;
  networkExists?: string[];
  /** Containers attached to a network: { shopnet: ['web', 'api'] }. */
  networkHas?: Record<string, string[]>;
  /** All (or these) services of a compose project are running: 'shop' or { project, services }. */
  composeUp?: string | { project: string; services?: string[] };
  /** No containers left for this compose project. */
  composeDown?: string;
  /** Container environment has these keys (or KEY=value): { db: ['POSTGRES_PASSWORD'] }. */
  containerEnv?: Record<string, string[]>;
  /** Container runs as this user, or 'nonroot'. */
  containerUser?: Record<string, string>;
  readOnly?: string[];
  /** Restart policy: { web: 'unless-stopped' }. */
  restartPolicy?: Record<string, string>;
  /** Container logs contain text: { web: 'ready for start up' }. */
  logsContain?: Record<string, string>;
  /** Logged in to Docker Hub as this user. */
  loggedIn?: string;
  /** These refs are in the fake registry ("you/diary:1.0"). */
  pushed?: string[];
  /** Laptop files exist (paths relative to home, or absolute). */
  filesExist?: string[];
  fileContains?: Record<string, string>;
  /** Laptop file modes: { 'hello.sh': 'x' } (contains). */
  fileMode?: Record<string, string>;
  /** Laptop folder the learner must be in (absolute). */
  cwd?: string;
  /** Laptop env vars (exported). */
  envVar?: Record<string, string>;
  /** Exit status of the last command ($?). */
  lastExit?: number;
  /** Counts. */
  count?: { running?: number; containers?: number; images?: number; volumes?: number };
  /** Regex any typed command matches / the last typed command matches. */
  typed?: string;
  lastTyped?: string;
}

export interface GoalResult {
  ok: boolean;
  failed: string[];
}

function asList<T>(v: T | T[]): T[] {
  return Array.isArray(v) ? v : [v];
}

function userOk(user: string, want: string): boolean {
  const u = user.split(':')[0] ?? '';
  if (want === 'nonroot') return u !== '' && u !== 'root' && u !== '0';
  return u === want;
}

function container(state: KitchenState, name: string): Container | null {
  return findContainer(state, name);
}

export function checkKitchenGoal(state: KitchenState, goal: KitchenGoal, typed: string[] = []): GoalResult {
  const failed: string[] = [];
  const check = (name: string, pass: boolean) => {
    if (!pass) failed.push(name);
  };
  const status = (n: string) => container(state, n)?.status;
  for (const n of goal.running ?? []) check(`running:${n}`, status(n) === 'running');
  if (goal.exited) {
    if (Array.isArray(goal.exited)) for (const n of goal.exited) check(`exited:${n}`, status(n) === 'exited');
    else for (const [n, code] of Object.entries(goal.exited)) check(`exited:${n}`, status(n) === 'exited' && container(state, n)!.exitCode === code);
  }
  for (const n of goal.created ?? []) check(`created:${n}`, status(n) === 'created');
  for (const n of goal.paused ?? []) check(`paused:${n}`, status(n) === 'paused');
  for (const n of goal.healthy ?? []) check(`healthy:${n}`, container(state, n)?.health?.status === 'healthy');
  for (const n of goal.notExists ?? []) check(`notExists:${n}`, !container(state, n));
  for (const [n, spec] of Object.entries(goal.portMapped ?? {})) {
    const [h, c] = spec.split(':').map(Number);
    const ct = container(state, n);
    check(`portMapped:${n}`, Boolean(ct && (ct.status === 'running' || ct.status === 'paused') && ct.ports.some((p) => p.hostPort === h && p.containerPort === c)));
  }
  const fetch = (url: string) => {
    const u = parseUrl(url);
    if (!u) return null;
    return httpFetch(structuredClone(state), { kind: 'host' }, u, 'GET', 'curl/8.5.0');
  };
  if (goal.reachable) {
    for (const url of asList(goal.reachable)) {
      const r = fetch(url);
      check(`reachable:${url}`, Boolean(r?.ok && r.res.status < 400));
    }
  }
  for (const [url, text] of Object.entries(goal.reachableContains ?? {})) {
    const r = fetch(url);
    check(`reachableContains:${url}`, Boolean(r?.ok && r.res.body.includes(text)));
  }
  for (const url of goal.unreachable ?? []) check(`unreachable:${url}`, !fetch(url)?.ok);
  if (goal.imageExists) for (const ref of asList(goal.imageExists)) check(`imageExists:${ref}`, Boolean(findImage(state, ref)));
  for (const ref of goal.imageMissing ?? []) check(`imageMissing:${ref}`, !findImage(state, ref));
  for (const [ref, max] of Object.entries(goal.imageMaxSize ?? {})) {
    const img = findImage(state, ref);
    check(`imageMaxSize:${ref}`, Boolean(img && img.diskSize <= parseSize(max)));
  }
  for (const [ref, want] of Object.entries(goal.imageUser ?? {})) {
    const img = findImage(state, ref);
    check(`imageUser:${ref}`, Boolean(img && userOk(img.config.User ?? '', want)));
  }
  for (const [ref, n] of Object.entries(goal.layers ?? {})) {
    const img = findImage(state, ref);
    check(`layers:${ref}`, Boolean(img && img.layers.length === n));
  }
  if (goal.cacheHits !== undefined) check('cacheHits', (state.lastBuild?.cached ?? 0) >= goal.cacheHits);
  if (goal.maxRebuilt !== undefined) check('maxRebuilt', Boolean(state.lastBuild) && state.lastBuild!.built <= goal.maxRebuilt);
  for (const v of goal.volumeExists ?? []) check(`volumeExists:${v}`, Boolean(state.volumes[v]));
  for (const v of goal.volumeMissing ?? []) check(`volumeMissing:${v}`, !state.volumes[v]);
  for (const [v, files] of Object.entries(goal.fileInVolume ?? {})) {
    const vol = state.volumes[v];
    check(`fileInVolume:${v}`, Boolean(vol && asList(files).every((f) => f.replace(/^\//, '') in vol.files)));
  }
  for (const [v, table] of Object.entries(goal.tableInVolume ?? {})) check(`tableInVolume:${v}`, Boolean(state.volumes[v]?.pg?.[table]));
  for (const n of goal.networkExists ?? []) check(`networkExists:${n}`, Object.values(state.networks).some((x) => x.name === n));
  for (const [net, names] of Object.entries(goal.networkHas ?? {})) {
    check(`networkHas:${net}`, names.every((n) => Boolean(container(state, n)?.networks[net])));
  }
  if (goal.composeUp) {
    const g = typeof goal.composeUp === 'string' ? { project: goal.composeUp } : goal.composeUp;
    const cs = Object.values(state.containers).filter((c) => c.labels['com.docker.compose.project'] === g.project);
    const services = g.services ?? [...new Set(cs.map((c) => c.labels['com.docker.compose.service']!))];
    check('composeUp', services.length > 0 && services.every((svc) => cs.some((c) => c.labels['com.docker.compose.service'] === svc && c.status === 'running')));
  }
  if (goal.composeDown) check('composeDown', !Object.values(state.containers).some((c) => c.labels['com.docker.compose.project'] === goal.composeDown));
  for (const [n, keys] of Object.entries(goal.containerEnv ?? {})) {
    const c = container(state, n);
    check(`containerEnv:${n}`, Boolean(c && keys.every((k) => (k.includes('=') ? c.env.includes(k) : c.env.some((e) => e.startsWith(`${k}=`) && e.length > k.length + 1)))));
  }
  for (const [n, want] of Object.entries(goal.containerUser ?? {})) {
    const c = container(state, n);
    check(`containerUser:${n}`, Boolean(c && userOk(c.user || state.images[c.imageId]?.config.User || 'root', want)));
  }
  for (const n of goal.readOnly ?? []) check(`readOnly:${n}`, Boolean(container(state, n)?.readOnly));
  for (const [n, pol] of Object.entries(goal.restartPolicy ?? {})) check(`restartPolicy:${n}`, container(state, n)?.restartPolicy.name === pol);
  for (const [n, text] of Object.entries(goal.logsContain ?? {})) check(`logsContain:${n}`, Boolean(container(state, n)?.logs.some((l) => l.text.includes(text))));
  if (goal.loggedIn !== undefined) check('loggedIn', state.registry.auth['docker.io'] === goal.loggedIn);
  for (const ref of goal.pushed ?? []) {
    const [path, tag = 'latest'] = ref.split(':');
    const full = path!.includes('.') && path!.split('/')[0]!.includes('.') ? path! : `docker.io/${path!.includes('/') ? path : `library/${path}`}`;
    check(`pushed:${ref}`, Boolean(state.registry.repos[full]?.tags[tag]));
  }
  const abs = (p: string) => (p.startsWith('/') ? p : `${state.home}/${p}`);
  for (const f of goal.filesExist ?? []) check(`filesExist:${f}`, abs(f) in state.fs.files);
  for (const [f, text] of Object.entries(goal.fileContains ?? {})) check(`fileContains:${f}`, (state.fs.files[abs(f)] ?? '').includes(text));
  for (const [f, m] of Object.entries(goal.fileMode ?? {})) check(`fileMode:${f}`, (state.fs.modes[abs(f)] ?? '-rw-r--r--').slice(1, 4).includes(m));
  if (goal.cwd !== undefined) check('cwd', state.cwd === goal.cwd);
  for (const [k, v] of Object.entries(goal.envVar ?? {})) check(`envVar:${k}`, state.env[k] === v);
  if (goal.lastExit !== undefined) check('lastExit', state.lastExit === goal.lastExit);
  if (goal.count) {
    const cs = Object.values(state.containers);
    if (goal.count.running !== undefined) check('count.running', cs.filter((c) => c.status === 'running').length === goal.count.running);
    if (goal.count.containers !== undefined) check('count.containers', cs.length === goal.count.containers);
    if (goal.count.images !== undefined) check('count.images', Object.keys(state.images).length === goal.count.images);
    if (goal.count.volumes !== undefined) check('count.volumes', Object.keys(state.volumes).length === goal.count.volumes);
  }
  if (goal.typed) check('typed', typed.some((t) => new RegExp(goal.typed!).test(t)));
  if (goal.lastTyped) check('lastTyped', new RegExp(goal.lastTyped).test(typed[typed.length - 1] ?? ''));
  return { ok: failed.length === 0, failed };
}
