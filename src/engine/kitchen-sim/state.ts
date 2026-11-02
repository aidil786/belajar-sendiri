// Kitchen state helpers. Commands clone the state, change the clone and return it.
import { basename, dirname, resolve as resolvePath } from '../git-sim/paths';
import { line as gitLine, lines as gitLines } from '../git-sim/output';
import { hexOf } from './ids';
import { familiar, fullName, parseRef } from './refs';
import type { Color, Container, Explain, KitchenEvent, KitchenResult, KitchenState, Line, LocalImage, Network } from './types';

/** 31 Oct 2026, 09:00 in Malaysia (01:00 UTC). */
export const START_CLOCK = Date.UTC(2026, 9, 31, 1, 0, 0) / 1000;
/** Seconds that pass for each command the learner types. */
export const TICK = 3;

export const DOCKER_VERSION = '29.9.2';
export const COMPOSE_VERSION = 'v5.6.1';

export interface CreateOptions {
  seed?: string;
  home?: string;
  cwd?: string;
  clock?: number;
  ipv6?: boolean;
}

export function createKitchenState(opts: CreateOptions = {}): KitchenState {
  const home = opts.home ?? '/home/you';
  const seed = opts.seed ?? 'kitchen';
  const state: KitchenState = {
    v: 1,
    fs: { files: {}, dirs: ['/', '/home', home, '/tmp'], modes: {} },
    cwd: opts.cwd ?? home,
    home,
    user: 'you',
    lastDir: null,
    env: { HOME: home, USER: 'you', PATH: '/usr/local/bin:/usr/bin:/bin', SHELL: '/bin/bash' },
    lastExit: 0,
    clock: opts.clock ?? START_CLOCK,
    seed,
    counter: 0,
    host: {
      name: 'laptop',
      platform: 'linux/amd64',
      variant: 'v3',
      cpus: 4,
      memBytes: 16868458496, // 15.71GiB, like the machine the outputs were measured on
      kernel: '6.18.44-fc-v185',
      os: 'Ubuntu 24.04.5 LTS',
      ipv6: opts.ipv6 ?? false,
      busyPorts: [],
      dockerUp: true,
    },
    images: {},
    tags: {},
    containers: {},
    volumes: {},
    networks: {},
    buildCache: [],
    layerStore: {},
    registry: { rateLimited: false, auth: {}, users: {}, repos: {} },
    session: null,
    compose: {},
  };
  for (const [name, driver, subnet] of [
    ['bridge', 'bridge', '172.17.0.0/16'],
    ['host', 'host', ''],
    ['none', 'null', ''],
  ] as const) {
    const id = hexOf(`${seed}:network:${name}`);
    state.networks[id] = {
      id,
      name,
      driver,
      created: state.clock - 3600,
      subnet,
      gateway: subnet ? subnet.replace(/0\/16$/, '1') : '',
      labels: {},
      internal: false,
      builtin: true,
      nextIp: 2,
    };
  }
  return state;
}

export function clone<T>(value: T): T {
  return structuredClone(value);
}

// ---------------------------------------------------------------------------
// Results

export function out(text: string, c?: Color): Line[] {
  return gitLines(text, c);
}

export const line = gitLine;

export function ok(state: KitchenState, output: Line[] = [], events: KitchenEvent[] = [], explain?: Explain): KitchenResult {
  const r: KitchenResult = { state, output, events, ok: true, exitCode: 0 };
  if (explain) r.explain = explain;
  return r;
}

/** A failed command. The state is returned as given (usually unchanged). */
export function fail(state: KitchenState, output: Line[], code: string, explain?: Explain, exitCode = 1): KitchenResult {
  const r: KitchenResult = { state, output, events: [{ type: 'error', code }], ok: false, exitCode };
  if (explain) r.explain = explain;
  return r;
}

// ---------------------------------------------------------------------------
// The laptop's files

export function resolve(state: KitchenState, input: string): string {
  return resolvePath(state.cwd, input, state.home);
}

export function dirExists(state: KitchenState, path: string): boolean {
  return state.fs.dirs.includes(path);
}

export function fileExists(state: KitchenState, path: string): boolean {
  return Object.hasOwn(state.fs.files, path);
}

export function ensureDir(state: KitchenState, path: string): void {
  let p = path;
  const add: string[] = [];
  while (p !== '/' && !dirExists(state, p)) {
    add.push(p);
    p = dirname(p);
  }
  if (add.length) {
    state.fs.dirs.push(...add);
    state.fs.dirs.sort();
  }
}

export function writeFile(state: KitchenState, path: string, content: string): void {
  ensureDir(state, dirname(path));
  state.fs.files[path] = content;
}

export function listDir(state: KitchenState, dir: string): { name: string; isDir: boolean }[] {
  const seen = new Map<string, boolean>();
  for (const d of state.fs.dirs) if (d !== dir && dirname(d) === dir) seen.set(basename(d), true);
  for (const f of Object.keys(state.fs.files)) if (dirname(f) === dir) seen.set(basename(f), false);
  return [...seen.entries()].map(([name, isDir]) => ({ name, isDir })).sort((a, b) => (a.name < b.name ? -1 : 1));
}

/** Every file under `dir` (absolute paths). */
export function filesUnder(state: KitchenState, dir: string): string[] {
  const prefix = dir === '/' ? '/' : `${dir}/`;
  return Object.keys(state.fs.files).filter((f) => f.startsWith(prefix)).sort();
}

// ---------------------------------------------------------------------------
// Lookups

export function containerList(state: KitchenState): Container[] {
  return Object.values(state.containers);
}

/** Find a container by name, full id or unique id prefix (like Docker). */
export function findContainer(state: KitchenState, ref: string): Container | null {
  const name = ref.startsWith('/') ? ref.slice(1) : ref;
  const all = containerList(state);
  const byName = all.find((c) => c.name === name);
  if (byName) return byName;
  const byId = all.find((c) => c.id === ref);
  if (byId) return byId;
  if (/^[0-9a-f]{1,64}$/.test(ref)) {
    const hits = all.filter((c) => c.id.startsWith(ref));
    if (hits.length === 1) return hits[0]!;
  }
  return null;
}

/** Find a local image by reference (nginx, nginx:1.30-alpine, docker.io/...), id or id prefix. */
export function findImage(state: KitchenState, ref: string): LocalImage | null {
  const bare = ref.startsWith('sha256:') ? ref.slice(7) : ref;
  if (/^[0-9a-f]{4,64}$/.test(bare)) {
    const hits = Object.values(state.images).filter((i) => i.id.startsWith(bare));
    if (hits.length === 1) return hits[0]!;
  }
  const p = parseRef(ref);
  if (!p.ok) return null;
  if (p.ref.digest) {
    const id = p.ref.digest.slice(7);
    return state.images[id] ?? null;
  }
  const id = state.tags[fullName(p.ref)];
  return id ? (state.images[id] ?? null) : null;
}

/** Short names this image is tagged with ("nginx:1.30-alpine"). */
export function imageNames(img: LocalImage): string[] {
  return img.repoTags.map((t) => {
    const p = parseRef(t);
    return p.ok ? familiar(p.ref) : t;
  });
}

export function networkByName(state: KitchenState, name: string): Network | null {
  const all = Object.values(state.networks);
  return all.find((n) => n.name === name) ?? all.find((n) => n.id === name) ?? (/^[0-9a-f]{3,}$/.test(name) ? all.find((n) => n.id.startsWith(name)) ?? null : null);
}

/** Next IP on a bridge network (172.17.0.2, .3, ...). Mutates the network. */
export function allocIp(net: Network): string {
  const base = net.subnet.replace(/\.0\/16$/, '');
  const ip = `${base}.${net.nextIp}`;
  net.nextIp++;
  return ip;
}

/** The next free user-network subnet: 172.18.0.0/16, 172.19.0.0/16, ... */
export function nextSubnet(state: KitchenState): string {
  const used = new Set(Object.values(state.networks).map((n) => n.subnet));
  for (let i = 18; i < 32; i++) {
    const s = `172.${i}.0.0/16`;
    if (!used.has(s)) return s;
  }
  for (let i = 0; i < 256; i++) {
    const s = `192.168.${i}.0/20`;
    if (!used.has(s)) return s;
  }
  return '10.99.0.0/16';
}

export function envMap(list: string[]): Record<string, string> {
  const m: Record<string, string> = {};
  for (const e of list) {
    const i = e.indexOf('=');
    if (i > 0) m[e.slice(0, i)] = e.slice(i + 1);
  }
  return m;
}

/** "nginx:1.30-alpine" as the learner sees an image's first name, or its short id. */
export function shownName(img: LocalImage): string {
  return imageNames(img)[0] ?? img.id.slice(0, 12);
}
