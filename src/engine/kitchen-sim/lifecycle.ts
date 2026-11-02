// Container life: create → start → (running | exited) → stop → remove, plus time passing
// (sleepers end, health checks run, restart policies kick in).
import { dirname, isInside } from '../git-sim/paths';
import { imageOf, readC } from './cfs';
import { makeCtx, runScript } from './cshell';
import { hexOf, macOf, nextId, randomName } from './ids';
import { addLogs, launch, stopLogs } from './programs';
import { allocIp, networkByName } from './state';
import type { Container, HealthConfig, KitchenEvent, KitchenState, LocalImage, Mount, PortBinding } from './types';

export interface CreateSpec {
  name?: string;
  image: string;
  img: LocalImage;
  cmd?: string[];
  entrypoint?: string[];
  env: string[];
  user?: string;
  workdir?: string;
  hostname?: string;
  ports: PortBinding[];
  publishAll: boolean;
  expose: string[];
  mounts: Mount[];
  network?: string;
  aliases?: string[];
  labels: Record<string, string>;
  restart: Container['restartPolicy'];
  autoRemove: boolean;
  readOnly: boolean;
  capDrop: string[];
  capAdd: string[];
  tty: boolean;
  interactive: boolean;
  init: boolean;
  platform?: string;
  healthcheck?: HealthConfig | null;
  limits?: Container['limits'];
}

/** Shell runner handed to `launch` (the main process of `sh -c "..."`). */
export function mainShell(state: KitchenState) {
  return (script: string, c: Container) => {
    const ctx = makeCtx(state, c, { main: true, tty: c.tty });
    const r = runScript(ctx, script);
    return { out: r.out, err: r.err, code: r.code, daemon: r.daemon };
  };
}

export function createContainer(state: KitchenState, spec: CreateSpec): Container {
  const id = nextId(state, 'container');
  const taken = new Set(Object.values(state.containers).map((c) => c.name));
  const name = spec.name ?? randomName(state, taken);
  const img = spec.img;
  const userEnv = spec.env;
  const userKeys = new Set(userEnv.map((e) => e.split('=')[0]));
  const env = [...userEnv, ...(img.config.Env ?? []).filter((e) => !userKeys.has(e.split('=')[0]))];
  const exposed = new Set<string>([...Object.keys(img.config.ExposedPorts ?? {}), ...spec.expose.map((p) => (p.includes('/') ? p : `${p}/tcp`))]);
  for (const p of spec.ports) exposed.add(`${p.containerPort}/${p.proto}`);
  const mounts = [...spec.mounts];
  // Image VOLUMEs that nothing is mounted on get an anonymous volume.
  for (const target of Object.keys(img.config.Volumes ?? {})) {
    if (mounts.some((m) => m.target === target)) continue;
    const vname = nextId(state, 'volume');
    state.volumes[vname] = { name: vname, created: state.clock, labels: {}, files: {}, dirs: [], owner: 0, anonymous: true, initialized: false };
    mounts.push({ type: 'volume', source: vname, target, readOnly: false, anonymous: true });
  }
  const c: Container = {
    id,
    name,
    image: spec.image,
    imageId: img.id,
    platform: spec.platform ?? img.platform,
    entrypoint: spec.entrypoint ?? img.config.Entrypoint ?? [],
    cmd: spec.cmd && spec.cmd.length ? spec.cmd : spec.entrypoint ? [] : (img.config.Cmd ?? []),
    env,
    user: spec.user ?? img.config.User ?? '',
    workdir: spec.workdir ?? (img.config.WorkingDir || '/'),
    hostname: spec.hostname ?? id.slice(0, 12),
    labels: { ...(img.config.Labels ?? {}), ...spec.labels },
    ports: spec.ports,
    exposed: [...exposed].sort(),
    publishAll: spec.publishAll,
    mounts,
    networks: {},
    networkMode: spec.network ?? 'bridge',
    status: 'created',
    exitCode: 0,
    created: state.clock,
    startedAt: null,
    finishedAt: null,
    restartPolicy: spec.restart,
    restartCount: 0,
    stoppedByUser: false,
    autoRemove: spec.autoRemove,
    readOnly: spec.readOnly,
    capDrop: spec.capDrop,
    capAdd: spec.capAdd,
    tty: spec.tty,
    interactive: spec.interactive,
    init: spec.init,
    logs: [],
    files: { '/.dockerenv': '' },
    deleted: [],
    dirs: [],
    owners: {},
    tmp: {},
    health: null,
    healthcheck: spec.healthcheck === undefined ? (img.config.Healthcheck ?? null) : spec.healthcheck,
    proc: null,
    memory: {},
    error: '',
    oomKilled: false,
    pidBase: 1,
    ...(spec.limits ? { limits: spec.limits } : {}),
  };
  if (spec.workdir && !readC(state, c, spec.workdir)) c.dirs.push(spec.workdir);
  if (c.networkMode !== 'host' && c.networkMode !== 'none') {
    const net = networkByName(state, c.networkMode);
    if (net) c.networks[net.name] = { ip: '', aliases: spec.aliases ?? [], mac: '', endpoint: '' };
  }
  state.containers[id] = c;
  return c;
}

/** First mount of an empty named volume copies the image's files there (and their owner). */
function initVolumes(state: KitchenState, c: Container, img: LocalImage | null): void {
  for (const m of c.mounts) {
    if (m.type !== 'volume') continue;
    const v = state.volumes[m.source];
    if (!v || v.initialized) continue;
    v.initialized = true;
    if (Object.keys(v.files).length || v.dirs.length) continue;
    const owner = img?.owners?.[m.target] ?? OWNED_DIRS[`${img?.kind}:${m.target}`];
    if (owner !== undefined) v.owner = owner;
    for (const [p, content] of Object.entries(img?.files ?? {})) {
      if (isInside(p, m.target) && p !== m.target) v.files[p.slice(m.target.length + 1)] = content;
    }
  }
}

/** Folders the official images give to their own user (the volume copies the owner). */
const OWNED_DIRS: Record<string, number> = {
  'postgres:/var/lib/postgresql': 70,
  'redis:/data': 999,
  'node:/home/node': 1000,
};

export interface StartResult {
  ok: boolean;
  /** Docker's error text (without the "docker: Error response from daemon: " prefix). */
  error?: string;
  code?: number;
  events: KitchenEvent[];
}

export function portConflict(state: KitchenState, c: Container): string | null {
  for (const p of c.ports) {
    for (const other of Object.values(state.containers)) {
      if (other.id === c.id || (other.status !== 'running' && other.status !== 'paused' && other.status !== 'restarting')) continue;
      if (other.ports.some((q) => q.hostPort === p.hostPort && q.proto === p.proto && (q.hostIp === p.hostIp || q.hostIp === '0.0.0.0' || p.hostIp === '0.0.0.0'))) {
        return `failed to set up container networking: driver failed programming external connectivity on endpoint ${c.name} (${hexOf(`${c.id}:endpoint`)}): Bind for ${p.hostIp}:${p.hostPort} failed: port is already allocated`;
      }
    }
    if (state.host.busyPorts.includes(p.hostPort)) {
      const ip = Object.values(c.networks)[0]?.ip || '172.17.0.2';
      return `failed to set up container networking: driver failed programming external connectivity on endpoint ${c.name} (${hexOf(`${c.id}:endpoint`)}): failed to bind host port for ${p.hostIp}:${p.hostPort}:${ip}:${p.containerPort}/${p.proto}: address already in use`;
    }
  }
  return null;
}

/** Start a created or exited container. Mutates the (cloned) state. */
export function startContainer(state: KitchenState, c: Container): StartResult {
  const events: KitchenEvent[] = [];
  if (c.status === 'running' || c.status === 'paused') return { ok: true, events };
  const img = imageOf(state, c);
  // Join networks (an address on each).
  for (const [netName, ep] of Object.entries(c.networks)) {
    const net = networkByName(state, netName);
    if (!net) continue;
    if (!ep.ip) {
      ep.ip = allocIp(net);
      ep.mac = macOf(`${c.id}:${netName}`);
      ep.endpoint = hexOf(`${c.id}:${netName}:endpoint`);
    }
  }
  const conflict = portConflict(state, c);
  if (conflict) return { ok: false, error: conflict, code: 125, events };
  initVolumes(state, c, img);
  c.status = 'running';
  c.startedAt = state.clock;
  c.finishedAt = null;
  c.exitCode = 0;
  c.error = '';
  c.stoppedByUser = false;
  const r = launch(state, c, mainShell(state));
  if (r.startError) {
    c.status = c.restartCount > 0 || c.finishedAt ? 'exited' : 'created';
    c.startedAt = null;
    c.exitCode = r.startCode ?? 127;
    c.error = r.startError;
    return { ok: false, error: r.startError, code: r.startCode ?? 127, events };
  }
  events.push({ type: 'containerStarted', id: c.id, name: c.name });
  for (const p of c.ports) events.push({ type: 'portMapped', container: c.name, hostPort: p.hostPort, containerPort: p.containerPort });
  if (r.exitNow !== undefined) {
    events.push(...exitContainer(state, c, r.exitNow));
    return { ok: true, events };
  }
  const hc = c.healthcheck;
  if (hc && hc.Test[0] !== 'NONE') c.health = { status: 'starting', failing: 0, next: state.clock + (hc.Interval ?? 30), log: [] };
  return { ok: true, events };
}

/** The main process ended by itself with `code`. Applies --rm and restart policies. */
export function exitContainer(state: KitchenState, c: Container, code: number): KitchenEvent[] {
  const events: KitchenEvent[] = [];
  c.status = 'exited';
  c.exitCode = code;
  c.finishedAt = state.clock;
  c.health = null;
  c.tmp = {};
  if (c.proc) c.proc = { ...c.proc, listeners: [] };
  events.push({ type: 'containerExited', id: c.id, name: c.name, code });
  const pol = c.restartPolicy;
  const again = !c.stoppedByUser && (pol.name === 'always' || pol.name === 'unless-stopped' || (pol.name === 'on-failure' && code !== 0 && (pol.max === 0 || c.restartCount < pol.max)));
  if (again) {
    c.status = 'restarting';
    c.restartDelay = Math.min(60, (c.restartDelay ?? 0.5) * 2);
    c.restartAt = state.clock + c.restartDelay;
  } else if (c.autoRemove) {
    events.push(...removeContainer(state, c, true));
  }
  return events;
}

export function stopContainer(state: KitchenState, c: Container, opts: { kill?: boolean; timeout?: number } = {}): KitchenEvent[] {
  if (c.status === 'restarting') {
    c.status = 'exited';
    c.stoppedByUser = true;
    return [];
  }
  if (c.status !== 'running' && c.status !== 'paused') return [];
  c.stoppedByUser = true;
  let code: number;
  if (opts.kill) code = 137;
  else {
    stopLogs(state, c);
    if (c.proc?.stopKills ?? true) {
      // PID 1 ignores SIGTERM, so Docker waits (10 s by default) and then kills it.
      state.clock += opts.timeout ?? 10;
      code = c.init ? 143 : 137;
    } else code = c.proc?.stopCode ?? 0;
  }
  c.status = 'exited';
  c.exitCode = code;
  c.finishedAt = state.clock;
  c.health = null;
  c.tmp = {};
  if (c.proc) c.proc = { ...c.proc, listeners: [] };
  const events: KitchenEvent[] = [{ type: 'containerExited', id: c.id, name: c.name, code }];
  if (c.autoRemove) events.push(...removeContainer(state, c, true));
  return events;
}

export function removeContainer(state: KitchenState, c: Container, removeAnonymous: boolean): KitchenEvent[] {
  delete state.containers[c.id];
  if (removeAnonymous) {
    for (const m of c.mounts) if (m.anonymous) delete state.volumes[m.source];
  }
  return [{ type: 'containerRemoved', id: c.id, name: c.name }];
}

/** Run the health check once. */
function healthCheck(state: KitchenState, c: Container, hc: HealthConfig): void {
  const h = c.health!;
  const test = hc.Test;
  const script = test[0] === 'CMD-SHELL' ? (test[1] ?? '') : test.slice(1).map((w) => (/\s/.test(w) ? `'${w}'` : w)).join(' ');
  const ctx = makeCtx(state, c, {});
  const r = runScript(ctx, script);
  const output = [...r.out, ...r.err].join('\n');
  h.log = [...h.log.slice(-4), { start: state.clock, end: state.clock, code: r.code, output: output ? `${output}\n` : '' }];
  if (r.code === 0) {
    h.status = 'healthy';
    h.failing = 0;
  } else {
    h.failing++;
    if (h.failing >= (hc.Retries ?? 3)) h.status = 'unhealthy';
  }
  h.next = state.clock + (hc.Interval ?? 30);
}

/** Let `secs` seconds pass on the fake clock. Mutates the (cloned) state. */
export function tick(state: KitchenState, secs: number): KitchenEvent[] {
  const events: KitchenEvent[] = [];
  const end = state.clock + secs;
  for (let guard = 0; guard < 500; guard++) {
    // The next thing that happens before `end`.
    let when = end;
    for (const c of Object.values(state.containers)) {
      if (c.status === 'running' && c.proc?.exitAfter !== undefined && c.startedAt !== null) when = Math.min(when, c.startedAt + c.proc.exitAfter);
      if (c.status === 'running' && c.health) when = Math.min(when, c.health.next);
      if (c.status === 'restarting' && c.restartAt !== undefined) when = Math.min(when, c.restartAt);
    }
    if (when > end || (when === end && guard > 0 && !hasDue(state, end))) break;
    state.clock = Math.max(state.clock, when);
    let acted = false;
    for (const c of Object.values(state.containers)) {
      if (!state.containers[c.id]) continue;
      if (c.status === 'running' && c.proc?.exitAfter !== undefined && c.startedAt !== null && c.startedAt + c.proc.exitAfter <= state.clock) {
        events.push(...exitContainer(state, c, c.proc.exitCode ?? 0));
        acted = true;
        continue;
      }
      if (c.status === 'running' && c.health && c.healthcheck && c.health.next <= state.clock) {
        healthCheck(state, c, c.healthcheck);
        acted = true;
      }
      if (c.status === 'restarting' && c.restartAt !== undefined && c.restartAt <= state.clock) {
        c.restartCount++;
        c.status = 'exited';
        const keep = c.restartDelay;
        const r = startContainer(state, c);
        c.restartDelay = keep;
        events.push(...r.events);
        acted = true;
      }
    }
    if (!acted && when >= end) break;
  }
  state.clock = Math.max(state.clock, end);
  return events;
}

function hasDue(state: KitchenState, t: number): boolean {
  return Object.values(state.containers).some(
    (c) =>
      (c.status === 'running' && c.proc?.exitAfter !== undefined && c.startedAt !== null && c.startedAt + c.proc.exitAfter <= t) ||
      (c.status === 'running' && c.health !== null && c.health.next <= t) ||
      (c.status === 'restarting' && (c.restartAt ?? Infinity) <= t),
  );
}

/** Interactive shell sessions end when the container stops. */
export function containerDir(path: string): string {
  return dirname(path);
}

export { addLogs };
