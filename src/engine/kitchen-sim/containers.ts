// docker run / create / start / stop / restart / kill / pause / unpause / rm / ps / logs /
// exec / port / top / stats / cp — with Docker Engine 29's own words.
import { basename, dirname, isInside } from '../git-sim/paths';
import { imageOf, readC, walkC, writeC } from './cfs';
import { hostProcesses, makeCtx, runScript } from './cshell';
import { parseFlags, type FlagSpec } from './flags';
import { ago, bytesSize, ellipsis, humanDuration, humanSize, iso, table } from './format';
import { containersUsing, pullImage } from './images';
import { containerJson } from './inspect';
import { createContainer, exitContainer, removeContainer, startContainer, stopContainer, type CreateSpec } from './lifecycle';
import { parseRef } from './refs';
import { envMap, fail, filesUnder, findContainer, findImage, line, networkByName, ok, out, resolve, writeFile as hostWrite } from './state';
import { headerFor, render, TemplateError } from './template';
import { nextId } from './ids';
import type { Container, Ctx, Explain, KitchenEvent, KitchenResult, KitchenState, Line, Mount, PortBinding } from './types';

// ---------------------------------------------------------------------------
// Shared error shapes

export const USAGE: Record<string, string> = {
  run: 'docker run [OPTIONS] IMAGE [COMMAND] [ARG...]',
  create: 'docker create [OPTIONS] IMAGE [COMMAND] [ARG...]',
  start: 'docker start [OPTIONS] CONTAINER [CONTAINER...]',
  stop: 'docker stop [OPTIONS] CONTAINER [CONTAINER...]',
  restart: 'docker restart [OPTIONS] CONTAINER [CONTAINER...]',
  kill: 'docker kill [OPTIONS] CONTAINER [CONTAINER...]',
  pause: 'docker pause CONTAINER [CONTAINER...]',
  unpause: 'docker unpause CONTAINER [CONTAINER...]',
  rm: 'docker rm [OPTIONS] CONTAINER [CONTAINER...]',
  ps: 'docker ps [OPTIONS]',
  logs: 'docker logs [OPTIONS] CONTAINER',
  exec: 'docker exec [OPTIONS] CONTAINER COMMAND [ARG...]',
  port: 'docker port CONTAINER [PRIVATE_PORT[/PROTO]]',
  top: 'docker top CONTAINER [ps OPTIONS]',
  stats: 'docker stats [OPTIONS] [CONTAINER...]',
  cp: 'docker cp [OPTIONS] CONTAINER:SRC_PATH DEST_PATH|-\n\tdocker cp [OPTIONS] SRC_PATH|- CONTAINER:DEST_PATH',
  inspect: 'docker inspect [OPTIONS] NAME|ID [NAME|ID...]',
  images: 'docker images [OPTIONS] [REPOSITORY[:TAG]]',
  pull: 'docker pull [OPTIONS] NAME[:TAG|@DIGEST]',
  push: 'docker push [OPTIONS] NAME[:TAG]',
  tag: 'docker tag SOURCE_IMAGE[:TAG] TARGET_IMAGE[:TAG]',
  rmi: 'docker rmi [OPTIONS] IMAGE [IMAGE...]',
  history: 'docker history [OPTIONS] IMAGE',
  build: 'docker buildx build [OPTIONS] PATH | URL | -',
  login: 'docker login [OPTIONS] [SERVER]',
};

/** `docker: 'docker stop' requires at least 1 argument` + usage. */
export function needArgs(state: KitchenState, cmd: string, what = 'at least 1 argument'): KitchenResult {
  return fail(
    state,
    out(`docker: 'docker ${cmd}' requires ${what}\n\nUsage:  ${USAGE[cmd] ?? `docker ${cmd}`}\n\nSee 'docker ${cmd} --help' for more information`),
    'usage',
    { key: 'sim.docker.err.needsArgs', params: { cmd: `docker ${cmd}` } },
  );
}

export function unknownFlag(state: KitchenState, cmd: string, flag: string, code = 125): KitchenResult {
  const text = flag.startsWith('--') ? `unknown flag: ${flag}` : `unknown shorthand flag: '${flag.slice(1, 2)}' in ${flag}`;
  return fail(state, out(`${text}\n\nUsage:  ${USAGE[cmd] ?? `docker ${cmd}`}\n\nRun 'docker ${cmd} --help' for more information`), 'unknownFlag', { key: 'sim.docker.err.unknownFlag', params: { flag, cmd: `docker ${cmd}` } }, code);
}

export function daemonError(state: KitchenState, message: string, code: string, explain?: KitchenResult['explain'], exit = 1): KitchenResult {
  return fail(state, out(`Error response from daemon: ${message}`), code, explain, exit);
}

/** Errors from `docker run` look like `docker: Error response from daemon: ...` + a help line. */
export function runError(state: KitchenState, before: string[], message: string, code: string, explain?: KitchenResult['explain'], exit = 125): KitchenResult {
  return fail(state, [...before.map((l) => line(l)), ...out(`docker: ${message}\n\nRun 'docker run --help' for more information`)], code, explain, exit);
}

function noSuch(state: KitchenState, ref: string): KitchenResult {
  return daemonError(state, `No such container: ${ref}`, 'noSuchContainer', { key: 'sim.docker.err.noSuchContainer', params: { name: ref } });
}

// ---------------------------------------------------------------------------
// Table text

/**
 * The COMMAND the API reports: the program, then its arguments. Like Docker 29, an argument with a
 * space is wrapped in single quotes (nothing is escaped; tabs and newlines don't count):
 * `echo 'Lunch is ready'`, `sh -c 'echo hi; sleep 1'`.
 */
export function cmdline(c: Container): string {
  const [path = '', ...args] = [...c.entrypoint, ...c.cmd];
  return [path, ...args.map((a) => (a.includes(' ') ? `'${a}'` : a))].join(' ');
}

export function statusText(state: KitchenState, c: Container): string {
  const now = state.clock;
  switch (c.status) {
    case 'created':
      return 'Created';
    case 'running': {
      const h = c.health ? (c.health.status === 'starting' ? ' (health: starting)' : ` (${c.health.status})`) : '';
      return `Up ${humanDuration(now - (c.startedAt ?? now))}${h}`;
    }
    case 'paused':
      return `Up ${humanDuration(now - (c.startedAt ?? now))} (Paused)`;
    case 'restarting':
      return `Restarting (${c.exitCode}) ${humanDuration(now - (c.finishedAt ?? now))} ago`;
    case 'exited':
      return `Exited (${c.exitCode}) ${humanDuration(now - (c.finishedAt ?? now))} ago`;
    default:
      return 'Dead';
  }
}

/**
 * The PORTS column, built like the Docker CLI's DisplayablePorts: every port sorted (container port,
 * then IP, then host port, then protocol); unpublished ports and ports published on the same number
 * are grouped in that order (runs become ranges like `80-81/tcp`); mappings to another host number
 * go last. So nginx with `-p 8080:8080` shows `80/tcp, 0.0.0.0:8080->8080/tcp` (checked on Docker 29).
 */
export function portsText(state: KitchenState, c: Container): string {
  if (c.status !== 'running' && c.status !== 'paused' && c.status !== 'restarting') return '';
  if (c.networkMode === 'host') return '';
  type P = { priv: number; pub: number; ip: string; proto: string };
  const all: P[] = [];
  for (const p of c.ports) {
    all.push({ priv: p.containerPort, pub: p.hostPort, ip: p.hostIp, proto: p.proto });
    if (state.host.ipv6 && p.hostIp === '0.0.0.0') all.push({ priv: p.containerPort, pub: p.hostPort, ip: '::', proto: p.proto });
  }
  for (const e of c.exposed) {
    const [port, proto = 'tcp'] = e.split('/');
    if (!c.ports.some((p) => String(p.containerPort) === port && p.proto === proto)) all.push({ priv: Number(port), pub: 0, ip: '', proto });
  }
  all.sort((a, b) => a.priv - b.priv || (a.ip < b.ip ? -1 : a.ip > b.ip ? 1 : 0) || a.pub - b.pub || (a.proto < b.proto ? -1 : a.proto > b.proto ? 1 : 0));
  const form = (key: string, first: number, last: number) => {
    const cut = key.lastIndexOf('/');
    const ip = cut >= 0 ? key.slice(0, cut) : '';
    const proto = cut >= 0 ? key.slice(cut + 1) : key;
    const range = first === last ? String(first) : `${first}-${last}`;
    // An IPv6 address gets brackets: `[::]:8080->8080/tcp` (Docker 29.9 on a host with IPv6).
    return `${ip ? `${ip.includes(':') ? `[${ip}]` : ip}:${range}->${range}` : range}/${proto}`;
  };
  const groups = new Map<string, { first: number; last: number }>();
  const result: string[] = [];
  const mappings: string[] = [];
  for (const p of all) {
    let key = p.proto;
    if (p.ip) {
      if (p.pub !== p.priv) {
        mappings.push(`${p.ip.includes(':') ? `[${p.ip}]` : p.ip}:${p.pub}->${p.priv}/${p.proto}`);
        continue;
      }
      key = `${p.ip}/${p.proto}`;
    }
    const g = groups.get(key);
    if (!g) groups.set(key, { first: p.priv, last: p.priv });
    else if (p.priv === g.last + 1) g.last = p.priv;
    else {
      result.push(form(key, g.first, g.last));
      groups.set(key, { first: p.priv, last: p.priv });
    }
  }
  for (const [key, g] of groups) result.push(form(key, g.first, g.last));
  return [...result, ...mappings].join(', ');
}

const PS_HEADERS: Record<string, string> = {
  ID: 'CONTAINER ID',
  Image: 'IMAGE',
  Command: 'COMMAND',
  CreatedAt: 'CREATED AT',
  RunningFor: 'CREATED',
  Ports: 'PORTS',
  State: 'STATE',
  Status: 'STATUS',
  Size: 'SIZE',
  Names: 'NAMES',
  Labels: 'LABELS',
  Mounts: 'MOUNTS',
  Networks: 'NETWORKS',
  Service: 'SERVICE',
  Name: 'NAME',
};

export function psRow(state: KitchenState, c: Container, noTrunc = false): Record<string, string> {
  const cmd = cmdline(c);
  return {
    ID: noTrunc ? c.id : c.id.slice(0, 12),
    Image: c.image,
    // The CLI prints it with Go's strconv.Quote: inner double quotes become \".
    Command: JSON.stringify(noTrunc ? cmd : ellipsis(cmd, 20)),
    CreatedAt: iso(c.created).replace('T', ' ').replace('Z', ' +0000 UTC'),
    RunningFor: ago(state.clock, c.created),
    Ports: portsText(state, c),
    State: c.status,
    Status: statusText(state, c),
    Size: '0B',
    Names: c.name,
    Labels: Object.entries(c.labels).map(([k, v]) => `${k}=${v}`).join(','),
    Mounts: c.mounts.filter((m) => m.type === 'volume').map((m) => (m.anonymous ? m.source.slice(0, 16) + '…' : m.source)).join(','),
    Networks: Object.keys(c.networks).join(','),
  };
}

/** Render rows with a user template (`--format`), with or without a table header. */
export function formatRows(rows: Record<string, unknown>[], fmt: string, headers: Record<string, string>): string[] {
  if (fmt === 'json' || fmt === '{{json .}}') return rows.map((r) => JSON.stringify(r));
  if (fmt.startsWith('table')) {
    const body = fmt.replace(/^table\s*/, '');
    const head = headerFor(body, headers).split('\t');
    const cells = rows.map((r) => render(body, r).split('\t'));
    return table([head, ...cells]);
  }
  return rows.map((r) => render(fmt, r));
}

// ---------------------------------------------------------------------------
// docker run / create

const RUN_SPEC: FlagSpec = {
  bools: [
    ['-d', '--detach'],
    ['--rm'],
    ['-i', '--interactive'],
    ['-t', '--tty'],
    ['-P', '--publish-all'],
    ['--read-only'],
    ['--init'],
    ['--privileged'],
    ['-q', '--quiet'],
  ],
  values: [
    ['--name'],
    ['--net', '--network'],
    ['--entrypoint'],
    ['-u', '--user'],
    ['-w', '--workdir'],
    ['--restart'],
    ['--platform'],
    ['-h', '--hostname'],
    ['--pull'],
    ['--health-cmd'],
    ['--health-interval'],
    ['--health-retries'],
    ['-m', '--memory'],
    ['--cpus'],
    ['--pids-limit'],
    ['--stop-timeout'],
  ],
  multi: [
    ['-e', '--env'],
    ['--env-file'],
    ['-p', '--publish'],
    ['-v', '--volume'],
    ['--mount'],
    ['--tmpfs'],
    ['--cap-drop'],
    ['--cap-add'],
    ['-l', '--label'],
    ['--expose'],
    ['--network-alias'],
    ['--add-host'],
  ],
  stopAtPositional: true,
};

/** `--memory 256m` (binary units, like Docker's RAMInBytes), `--cpus 1.5`, `--pids-limit 100`, with Docker 29's errors. */
function parseLimits(state: KitchenState, f: ReturnType<typeof parseFlags>): { limits: Container['limits'] | null; flagError?: string; daemonError?: string } {
  const mem = f.values.get('--memory');
  const cpus = f.values.get('--cpus');
  const pids = f.values.get('--pids-limit');
  if (mem === undefined && cpus === undefined && pids === undefined) return { limits: null };
  let memory = 0;
  if (mem !== undefined) {
    const m = /^(\d+(?:\.\d+)?) ?([kmgtp])?i?b?$/i.exec(mem);
    if (!m) return { limits: null, flagError: `invalid argument "${mem}" for "-m, --memory" flag: invalid size: '${mem}'` };
    const pow = m[2] ? 'kmgtp'.indexOf(m[2].toLowerCase()) + 1 : 0;
    memory = Math.floor(Number(m[1]) * 1024 ** pow);
  }
  let nanoCpus = 0;
  if (cpus !== undefined) {
    if (!/^\d+(\.\d+)?$/.test(cpus)) return { limits: null, flagError: `invalid argument "${cpus}" for "--cpus" flag: failed to parse ${cpus} as a rational number` };
    nanoCpus = Math.round(Number(cpus) * 1e9);
  }
  let pidsLimit: number | null = null;
  if (pids !== undefined) {
    if (!/^-?\d+$/.test(pids)) return { limits: null, flagError: `invalid argument "${pids}" for "--pids-limit" flag: strconv.ParseInt: parsing "${pids}": invalid syntax` };
    pidsLimit = Number(pids);
  }
  if (memory !== 0 && memory < 6 * 1024 * 1024) return { limits: null, daemonError: 'Minimum memory limit allowed is 6MB' };
  const n = state.host.cpus;
  if (nanoCpus !== 0 && (nanoCpus < 1e7 || nanoCpus > n * 1e9)) return { limits: null, daemonError: `range of CPUs is from 0.01 to ${n.toFixed(2)}, as there are only ${n} CPUs available` };
  return { limits: { memory, nanoCpus, pids: pidsLimit } };
}

function parseSeconds(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const m = /^(\d+(?:\.\d+)?)(ms|s|m|h)?$/.exec(text);
  if (!m) return undefined;
  const n = Number(m[1]);
  return m[2] === 'ms' ? n / 1000 : m[2] === 'm' ? n * 60 : m[2] === 'h' ? n * 3600 : n;
}

/** Free host port for -P (Docker starts at 32768). */
function ephemeralPort(state: KitchenState, extra: PortBinding[]): number {
  const used = new Set([...Object.values(state.containers).flatMap((c) => c.ports.map((p) => p.hostPort)), ...extra.map((p) => p.hostPort), ...state.host.busyPorts]);
  let p = 32768;
  while (used.has(p)) p++;
  return p;
}

export function parsePublish(state: KitchenState, spec: string, taken: PortBinding[]): PortBinding | string {
  const [main, protoRaw] = spec.split('/');
  const proto = (protoRaw ?? 'tcp') as 'tcp' | 'udp';
  const parts = main!.split(':');
  let hostIp = '0.0.0.0';
  let host: string | undefined;
  let ctr: string;
  if (parts.length === 3) [hostIp, host, ctr] = parts as [string, string, string];
  else if (parts.length === 2) [host, ctr] = parts as [string, string];
  else ctr = parts[0]!;
  if (!/^\d+$/.test(ctr) || Number(ctr) < 1 || Number(ctr) > 65535) return `invalid containerPort: ${ctr}`;
  if (host !== undefined && host !== '' && (!/^\d+$/.test(host) || Number(host) > 65535)) return `invalid hostPort: ${host}`;
  return { hostIp, hostPort: host ? Number(host) : ephemeralPort(state, taken), containerPort: Number(ctr), proto };
}

const VOLUME_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.-]+$/;

export function ensureVolume(state: KitchenState, name: string, labels: Record<string, string> = {}): KitchenEvent[] {
  if (state.volumes[name]) return [];
  state.volumes[name] = { name, created: state.clock, labels, files: {}, dirs: [], owner: 0, anonymous: false, initialized: false };
  return [{ type: 'volumeCreated', name }];
}

/** -v name:/path[:ro], -v ./dir:/path, -v /path (anonymous). Mutates state (creates volumes / host folders). */
export function parseVolume(state: KitchenState, spec: string, events: KitchenEvent[]): Mount | string {
  const parts = spec.split(':');
  let ro = false;
  if (parts.length === 3) ro = parts.pop() === 'ro';
  if (parts.length === 1) {
    const target = parts[0]!;
    if (!target.startsWith('/')) return `invalid volume specification: '${spec}'`;
    return { type: 'volume', source: '', target, readOnly: ro, anonymous: true };
  }
  const [src, target] = parts as [string, string];
  if (!target.startsWith('/')) return `invalid volume specification: '${spec}': invalid mount config for type "volume": invalid mount path: '${target}' mount path must be absolute`;
  if (src.startsWith('/') || src.startsWith('.') || src.startsWith('~')) {
    const abs = resolve(state, src);
    // -v creates a missing host folder (--mount does not).
    if (!state.fs.dirs.includes(abs) && !(abs in state.fs.files)) {
      state.fs.dirs.push(abs);
      state.fs.dirs.sort();
    }
    return { type: 'bind', source: abs, target, readOnly: ro };
  }
  if (!VOLUME_NAME.test(src)) return `create ${src}: "${src}" includes invalid characters for a local volume name, only "[a-zA-Z0-9][a-zA-Z0-9_.-]" are allowed. If you intended to pass a host directory, use absolute path`;
  events.push(...ensureVolume(state, src));
  return { type: 'volume', source: src, target, readOnly: ro };
}

export function parseMount(state: KitchenState, spec: string, events: KitchenEvent[]): Mount | string {
  const kv: Record<string, string> = {};
  for (const part of spec.split(',')) {
    const [k, v] = part.split('=');
    kv[k!.trim()] = v === undefined ? 'true' : v.trim();
  }
  const type = (kv.type ?? 'volume') as Mount['type'];
  const target = kv.target ?? kv.destination ?? kv.dst;
  const source = kv.source ?? kv.src ?? '';
  const ro = kv.readonly === 'true' || kv.ro === 'true' || kv.readonly === '1';
  if (!target) return 'invalid argument "' + spec + '" for "--mount" flag: target is required';
  if (type === 'tmpfs') return { type: 'tmpfs', source: '', target, readOnly: false };
  if (type === 'bind') {
    const abs = resolve(state, source);
    if (!state.fs.dirs.includes(abs) && !(abs in state.fs.files)) return `invalid mount config for type "bind": bind source path does not exist: ${abs}`;
    return { type: 'bind', source: abs, target, readOnly: ro };
  }
  if (!source) return { type: 'volume', source: '', target, readOnly: ro, anonymous: true };
  events.push(...ensureVolume(state, source));
  return { type: 'volume', source, target, readOnly: ro };
}

function readEnvFile(state: KitchenState, file: string): string[] | string | { space: string } {
  const abs = resolve(state, file);
  const text = state.fs.files[abs];
  if (text === undefined) return `--env-file: open ${file}: no such file or directory`;
  // Like the docker CLI (checked on Docker 29): quotes stay part of the value; a name with a space
  // is refused; a bare NAME takes the laptop's value, or is left out when the laptop has none.
  const outLines: string[] = [];
  for (const raw of text.split('\n')) {
    const l = raw.replace(/^\s+/, '').replace(/\r$/, '');
    if (!l || l.startsWith('#')) continue;
    const i = l.indexOf('=');
    const name = i >= 0 ? l.slice(0, i) : l;
    if (/\s/.test(name)) return { space: `--env-file: invalid env file (${file}): variable '${name}' contains whitespaces` };
    if (i >= 0) outLines.push(l);
    else if (state.env[name] !== undefined) outLines.push(`${name}=${state.env[name]}`);
  }
  return outLines;
}

/** Shared by run and create: everything up to "the container exists". */
function prepare(state: KitchenState, args: string[], cmd: 'run' | 'create'): { ok: true; c: Container; pre: string[]; events: KitchenEvent[]; flags: ReturnType<typeof parseFlags> } | { ok: false; res: KitchenResult } {
  const f = parseFlags(args, RUN_SPEC);
  if (f.unknown) return { ok: false, res: unknownFlag(state, cmd, f.unknown) };
  if (f.missing) return { ok: false, res: fail(state, out(`flag needs an argument: ${f.missing}\n\nUsage:  ${USAGE[cmd]}\n\nRun 'docker ${cmd} --help' for more information`), 'flagValue', undefined, 125) };
  const lim = parseLimits(state, f);
  if (lim.flagError) return { ok: false, res: fail(state, out(`${lim.flagError}\n\nUsage:  ${USAGE[cmd]}\n\nRun 'docker ${cmd} --help' for more information`), 'flagValue', { key: 'sim.docker.err.badLimit' }, 125) };
  const [imageText, ...command] = f.positional;
  if (!imageText) return { ok: false, res: needArgs(state, cmd) };
  const events: KitchenEvent[] = [];
  const pre: string[] = [];
  const pr = parseRef(imageText);
  if (!pr.ok) return { ok: false, res: runError(state, [], pr.error.endsWith('lowercase') ? `${pr.error}.` : `invalid reference format`, 'badRef', { key: 'sim.docker.err.badRef', params: { ref: imageText } }) };
  const platform = f.values.get('--platform');
  if (platform && !/^linux\/(amd64|arm64)(\/v\d)?$/.test(platform)) return { ok: false, res: runError(state, [], `"${platform}": unknown operating system or architecture: invalid argument`, 'badPlatform') };
  let img = findImage(state, imageText);
  const wantPlat = platform ?? null;
  if (!img || (wantPlat && img.source !== 'build' && img.platform.split('/')[1] !== wantPlat.split('/')[1])) {
    if (!img) pre.push(`Unable to find image '${imageText.includes(':') || imageText.includes('@') ? imageText : `${imageText}:latest`}' locally`);
    const pulled = pullImage(state, imageText, { forRun: true, platform: wantPlat ?? undefined });
    if (pulled.notStocked) {
      return { ok: false, res: { ...fail(state, pre.map((l) => line(l)), 'notStocked', { key: 'sim.docker.explain.notStocked', params: { repo: pulled.notStocked.repo, list: pulled.notStocked.tags.join(', ') } }), stopped: true } };
    }
    if (!pulled.ok) {
      const code = state.registry.rateLimited ? 'rateLimited' : pulled.error?.includes('pull access denied') ? 'pullDenied' : 'manifestUnknown';
      return { ok: false, res: runError(state, pre, `Error response from daemon: ${pulled.error}`, code, { key: `sim.docker.err.${code}`, params: { ref: imageText } }) };
    }
    pre.push(...pulled.lines);
    events.push(...pulled.events);
    img = pulled.img!;
    if (wantPlat) img.platform = wantPlat;
  } else if (!wantPlat && img.platform.split('/')[1] !== state.host.platform.split('/')[1]) {
    pre.push(`WARNING: The requested image's platform (${img.platform}) does not match the detected host platform (${state.host.platform}/${state.host.variant}) and no specific platform was requested`);
  }
  const name = f.values.get('--name');
  if (name !== undefined) {
    if (!/^\/?[a-zA-Z0-9][a-zA-Z0-9_.-]+$/.test(name)) return { ok: false, res: runError(state, pre, `Error response from daemon: Invalid container name (${name}), only [a-zA-Z0-9][a-zA-Z0-9_.-] are allowed`, 'badName') };
    const clash = Object.values(state.containers).find((c) => c.name === name);
    if (clash) {
      return { ok: false, res: runError(state, pre, `Error response from daemon: Conflict. The container name "/${name}" is already in use by container "${clash.id}". You have to remove (or rename) that container to be able to reuse that name.`, 'nameInUse', { key: 'sim.docker.err.nameInUse', params: { name } }) };
    }
  }
  const network = f.values.get('--network');
  if (network && !networkByName(state, network)) return { ok: false, res: runError(state, pre, `Error response from daemon: network ${network} not found`, 'noSuchNetwork', { key: 'sim.docker.err.noSuchNetwork', params: { name: network } }) };
  const env: string[] = [];
  for (const file of f.multi.get('--env-file') ?? []) {
    const r = readEnvFile(state, file);
    if (typeof r === 'string') return { ok: false, res: runError(state, pre, r, 'envFile', { key: 'sim.docker.err.envFile', params: { file } }) };
    if (!Array.isArray(r)) return { ok: false, res: runError(state, pre, r.space, 'envFile', { key: 'sim.docker.err.envFileSpace', params: { file } }) };
    env.push(...r);
  }
  for (const e of f.multi.get('--env') ?? []) env.push(e.includes('=') ? e : `${e}=${state.env[e] ?? ''}`);
  const ports: PortBinding[] = [];
  for (const p of f.multi.get('--publish') ?? []) {
    const r = parsePublish(state, p, ports);
    if (typeof r === 'string') return { ok: false, res: runError(state, pre, r, 'badPort', { key: 'sim.docker.err.badPort', params: { spec: p } }) };
    ports.push(r);
  }
  if (f.bools.has('--publish-all')) {
    for (const e of Object.keys(img.config.ExposedPorts ?? {})) {
      const [port, proto] = e.split('/');
      if (!ports.some((p) => p.containerPort === Number(port))) ports.push({ hostIp: '0.0.0.0', hostPort: ephemeralPort(state, ports), containerPort: Number(port), proto: (proto ?? 'tcp') as 'tcp' });
    }
  }
  if (network === 'host' && ports.length) pre.push('WARNING: Published ports are discarded when using host network mode');
  const mounts: Mount[] = [];
  for (const v of f.multi.get('--volume') ?? []) {
    const m = parseVolume(state, v, events);
    if (typeof m === 'string') return { ok: false, res: runError(state, pre, `Error response from daemon: ${m}`, 'badVolume', { key: 'sim.docker.err.badVolume', params: { spec: v } }) };
    mounts.push(m);
  }
  for (const v of f.multi.get('--mount') ?? []) {
    const m = parseMount(state, v, events);
    if (typeof m === 'string') return { ok: false, res: runError(state, pre, `Error response from daemon: ${m}`, 'badMount', { key: 'sim.docker.err.badMount', params: { spec: v } }) };
    mounts.push(m);
  }
  for (const t of f.multi.get('--tmpfs') ?? []) mounts.push({ type: 'tmpfs', source: '', target: t.split(':')[0]!, readOnly: false });
  for (const m of mounts) {
    if (m.anonymous && !m.source) {
      m.source = nextId(state, 'volume');
      state.volumes[m.source] = { name: m.source, created: state.clock, labels: {}, files: {}, dirs: [], owner: 0, anonymous: true, initialized: false };
    }
  }
  const restartText = f.values.get('--restart') ?? 'no';
  const rm = /^(no|always|unless-stopped|on-failure)(:(\d+))?$/.exec(restartText);
  if (!rm) return { ok: false, res: runError(state, pre, `invalid restart policy: ${restartText}`, 'badRestart') };
  const labels: Record<string, string> = {};
  for (const l of f.multi.get('--label') ?? []) {
    const i = l.indexOf('=');
    labels[i > 0 ? l.slice(0, i) : l] = i > 0 ? l.slice(i + 1) : '';
  }
  if (lim.daemonError) return { ok: false, res: runError(state, pre, `Error response from daemon: ${lim.daemonError}`, 'badLimit', { key: 'sim.docker.err.badLimit' }) };
  const ep = f.values.get('--entrypoint');
  const hcCmd = f.values.get('--health-cmd');
  const spec: CreateSpec = {
    limits: lim.limits ?? undefined,
    name,
    image: imageText,
    img,
    cmd: command,
    entrypoint: ep !== undefined ? (ep ? [ep] : []) : undefined,
    env,
    user: f.values.get('--user'),
    workdir: f.values.get('--workdir'),
    hostname: f.values.get('--hostname'),
    ports: network === 'host' ? [] : ports,
    publishAll: f.bools.has('--publish-all'),
    expose: f.multi.get('--expose') ?? [],
    mounts,
    network,
    aliases: f.multi.get('--network-alias') ?? [],
    labels,
    restart: { name: rm[1] as Container['restartPolicy']['name'], max: rm[3] ? Number(rm[3]) : 0 },
    autoRemove: f.bools.has('--rm'),
    readOnly: f.bools.has('--read-only'),
    capDrop: (f.multi.get('--cap-drop') ?? []).map((x) => x.toUpperCase()),
    capAdd: (f.multi.get('--cap-add') ?? []).map((x) => x.toUpperCase()),
    tty: f.bools.has('--tty'),
    interactive: f.bools.has('--interactive'),
    init: f.bools.has('--init'),
    platform: wantPlat ?? undefined,
    healthcheck: hcCmd ? { Test: ['CMD-SHELL', hcCmd], Interval: parseSeconds(f.values.get('--health-interval')) ?? 30, Retries: Number(f.values.get('--health-retries') ?? 3) } : undefined,
  };
  const c = createContainer(state, spec);
  events.push({ type: 'containerCreated', id: c.id, name: c.name, image: imageText });
  return { ok: true, c, pre, events, flags: f };
}

export const create = (state: KitchenState, args: string[]): KitchenResult => {
  const s = structuredClone(state);
  const p = prepare(s, args, 'create');
  if (!p.ok) return p.res;
  return ok(s, [...p.pre.map((l) => line(l)), line(p.c.id)], p.events, { key: 'sim.docker.explain.create', params: { name: p.c.name } });
};

/** Lines a foreground `docker run` shows: the container's output, in order. */
function shownLogs(c: Container, from = 0): Line[] {
  return c.logs.slice(from).map((l) => line(l.text));
}

export const run = (state: KitchenState, args: string[]): KitchenResult => {
  const s = structuredClone(state);
  const p = prepare(s, args, 'run');
  if (!p.ok) return p.res;
  const { c, pre, flags } = p;
  const events = [...p.events];
  const detach = flags.bools.has('--detach');
  const outLines: Line[] = pre.map((l) => line(l));
  if (detach) outLines.push(line(c.id));
  const r = startContainer(s, c);
  events.push(...r.events);
  if (!r.ok) {
    const explain: Explain | undefined = r.error!.includes('port is already allocated') || r.error!.includes('address already in use')
      ? { key: 'sim.docker.err.portTaken', params: { port: String(c.ports[0]?.hostPort ?? '') } }
      : r.error!.includes('executable file not found')
        ? { key: 'sim.docker.err.execNotFound', params: { cmd: cmdline(c).split(' ')[0] ?? '' } }
        : undefined;
    const exit = r.code ?? 125;
    if (c.autoRemove) removeContainer(s, c, true);
    const res = fail(s, [...outLines, ...out(`docker: Error response from daemon: ${r.error}\n\nRun 'docker run --help' for more information`)], r.error!.includes('port') ? 'portTaken' : 'startFailed', explain, exit);
    res.events = [...events, ...res.events];
    return res;
  }
  const alive = s.containers[c.id];
  if (detach) {
    return { ...ok(s, outLines, events, { key: 'sim.docker.explain.runDetached', params: { name: c.name } }), exitCode: 0 };
  }
  // Foreground: show what the container printed.
  outLines.push(...shownLogs(c));
  if (!alive || alive.status === 'exited' || alive.status === 'restarting') {
    const code = c.exitCode;
    s.lastExit = code;
    const explain: Explain = c.platform.split('/')[1] !== s.host.platform.split('/')[1]
      ? { key: 'sim.docker.err.execFormat', params: { platform: c.platform } }
      : code === 0
        ? { key: c.autoRemove ? 'sim.docker.explain.runRemoved' : 'sim.docker.explain.runExited', params: { name: c.name, code: String(code) } }
        : { key: 'sim.docker.explain.runExitedCode', params: { name: c.name, code: String(code) } };
    const res: KitchenResult = { state: s, output: outLines, events, ok: code === 0, explain, exitCode: code };
    if (code !== 0) {
      res.events.push({ type: 'error', code: c.platform.split('/')[1] !== s.host.platform.split('/')[1] ? 'execFormat' : 'exitedNonZero' });
    }
    return res;
  }
  // Still running in the foreground: an interactive shell, a REPL, or an attached server.
  const proc = alive.proc;
  if (proc?.interactive && proc.kind === 'shell') {
    s.session = { kind: 'shell', container: alive.id, cwd: alive.workdir, user: alive.user || 'root', main: true };
    return { ...ok(s, outLines, events, { key: 'sim.docker.explain.runShell', params: { name: c.name } }), prompt: shellPrompt(s) };
  }
  if (proc?.interactive && (proc.kind === 'node' || proc.kind === 'python')) {
    s.session = { kind: 'repl', container: alive.id, lang: proc.kind, main: true };
    if (proc.kind === 'node') outLines.push(line(`Welcome to Node.js ${'v24.22.2'}.`), line('Type ".help" for more information.'));
    else outLines.push(line('Python 3.13.18 (main, Oct 28 2026, 02:04:41) [GCC 14.2.0] on linux'), line('Type "help", "copyright", "credits" or "license" for more information.'));
    return { ...ok(s, outLines, events, { key: 'sim.docker.explain.runRepl', params: { name: c.name } }), prompt: proc.kind === 'node' ? '> ' : '>>> ' };
  }
  s.session = { kind: 'attached', containers: [alive.id] };
  return { ...ok(s, outLines, events, { key: 'sim.docker.explain.attached', params: { name: c.name } }), prompt: '' };
};

/** The prompt of a shell inside a container: "/ # " (root) or "/app $ ". */
export function shellPrompt(state: KitchenState): string {
  const ses = state.session;
  if (!ses || ses.kind !== 'shell') return '';
  const c = state.containers[ses.container];
  const img = c ? imageOf(state, c) : null;
  const root = !ses.user || ses.user === 'root' || ses.user === '0';
  if (img?.kind === 'python' || img?.files['/etc/os-release']?.includes('ID=debian')) return root ? '# ' : '$ ';
  const home = root ? '/root' : `/home/${ses.user}`;
  const shown = ses.cwd === home ? '~' : ses.cwd;
  return `${shown} ${root ? '#' : '$'} `;
}

// ---------------------------------------------------------------------------
// start / stop / restart / kill / pause / unpause / rm

type Each = (s: KitchenState, c: Container, ref: string) => { line?: string; error?: string; events?: KitchenEvent[]; code?: string };

function eachContainer(state: KitchenState, refs: string[], fn: Each, explainKey: string): KitchenResult {
  const s = structuredClone(state);
  const lines: Line[] = [];
  const events: KitchenEvent[] = [];
  let failed: string | null = null;
  let failCode = 'noSuchContainer';
  for (const ref of refs) {
    const c = findContainer(s, ref);
    if (!c) {
      lines.push(line(`Error response from daemon: No such container: ${ref}`));
      failed ??= ref;
      continue;
    }
    const r = fn(s, c, ref);
    if (r.error) {
      lines.push(...out(`Error response from daemon: ${r.error}`));
      failed ??= ref;
      failCode = r.code ?? 'failed';
      continue;
    }
    if (r.line !== undefined) lines.push(line(r.line));
    events.push(...(r.events ?? []));
  }
  if (failed) {
    const res = fail(s, lines, failCode, failCode === 'noSuchContainer' ? { key: 'sim.docker.err.noSuchContainer', params: { name: failed } } : { key: `sim.docker.err.${failCode}`, params: { name: failed } });
    res.events = [...events, ...res.events];
    return res;
  }
  return ok(s, lines, events, { key: explainKey, params: { name: refs.join(', ') } });
}

const refsOf = (args: string[]) => args.filter((a) => !a.startsWith('-'));

export const start = (state: KitchenState, args: string[]): KitchenResult => {
  const f = parseFlags(args, { bools: [['-a', '--attach'], ['-i', '--interactive']] });
  if (f.unknown) return unknownFlag(state, 'start', f.unknown, 1);
  if (!f.positional.length) return needArgs(state, 'start');
  return eachContainer(state, f.positional, (s, c, ref) => {
    if (c.status === 'running' || c.status === 'paused') return { line: ref };
    const r = startContainer(s, c);
    if (!r.ok) return { error: r.error, code: r.error?.includes('port') ? 'portTaken' : 'startFailed' };
    return { line: ref, events: r.events };
  }, 'sim.docker.explain.start');
};

export const stop = (state: KitchenState, args: string[]): KitchenResult => {
  const f = parseFlags(args, { values: [['-t', '--timeout', '--time'], ['-s', '--signal']] });
  if (f.unknown) return unknownFlag(state, 'stop', f.unknown, 1);
  if (!f.positional.length) return needArgs(state, 'stop');
  const timeout = f.values.has('--time') ? Number(f.values.get('--time')) : undefined;
  const slow = f.positional.some((ref) => {
    const c = findContainer(state, ref);
    return Boolean(c && (c.status === 'running' || c.status === 'paused') && (c.proc?.stopKills ?? true));
  });
  const r = eachContainer(state, f.positional, (s, c, ref) => ({ line: ref, events: stopContainer(s, c, { timeout }) }), 'sim.docker.explain.stop');
  if (r.ok && slow) r.explain = { key: 'sim.docker.explain.stopSlow', params: { name: f.positional.join(', '), secs: String(timeout ?? 10) } };
  return r;
};

export const restart = (state: KitchenState, args: string[]): KitchenResult => {
  const f = parseFlags(args, { values: [['-t', '--timeout', '--time']] });
  if (f.unknown) return unknownFlag(state, 'restart', f.unknown, 1);
  if (!f.positional.length) return needArgs(state, 'restart');
  return eachContainer(state, f.positional, (s, c, ref) => {
    const ev = stopContainer(s, c, {});
    if (!s.containers[c.id]) return { line: ref, events: ev };
    c.stoppedByUser = false;
    const r = startContainer(s, c);
    if (!r.ok) return { error: r.error, code: 'startFailed' };
    return { line: ref, events: [...ev, ...r.events] };
  }, 'sim.docker.explain.restart');
};

export const kill = (state: KitchenState, args: string[]): KitchenResult => {
  const f = parseFlags(args, { values: [['-s', '--signal']] });
  if (f.unknown) return unknownFlag(state, 'kill', f.unknown, 1);
  if (!f.positional.length) return needArgs(state, 'kill');
  return eachContainer(state, f.positional, (s, c, ref) => {
    if (c.status !== 'running' && c.status !== 'paused') return { error: `cannot kill container: ${ref}: container ${c.id} is not running`, code: 'notRunning' };
    return { line: ref, events: stopContainer(s, c, { kill: true }) };
  }, 'sim.docker.explain.kill');
};

export const pause = (state: KitchenState, args: string[]): KitchenResult => {
  if (!refsOf(args).length) return needArgs(state, 'pause');
  return eachContainer(state, refsOf(args), (_s, c, ref) => {
    if (c.status === 'paused') return { error: `container ${c.id} is already paused`, code: 'alreadyPaused' };
    if (c.status !== 'running') return { error: `container ${c.id} is not running`, code: 'notRunning' };
    c.status = 'paused';
    return { line: ref, events: [{ type: 'containerPaused', id: c.id, name: c.name }] };
  }, 'sim.docker.explain.pause');
};

export const unpause = (state: KitchenState, args: string[]): KitchenResult => {
  if (!refsOf(args).length) return needArgs(state, 'unpause');
  return eachContainer(state, refsOf(args), (_s, c, ref) => {
    if (c.status !== 'paused') return { error: `container ${c.id} is not paused`, code: 'notPaused' };
    c.status = 'running';
    return { line: ref, events: [{ type: 'containerUnpaused', id: c.id, name: c.name }] };
  }, 'sim.docker.explain.unpause');
};

export const rm = (state: KitchenState, args: string[]): KitchenResult => {
  const f = parseFlags(args, { bools: [['-f', '--force'], ['-v', '--volumes'], ['-l', '--link']] });
  if (f.unknown) return unknownFlag(state, 'rm', f.unknown, 1);
  if (!f.positional.length) return needArgs(state, 'rm');
  const force = f.bools.has('--force');
  const r = eachContainer(state, f.positional, (s, c, ref) => {
    if ((c.status === 'running' || c.status === 'paused' || c.status === 'restarting') && !force) {
      return { error: `cannot remove container "${ref}": container is running: stop the container before removing or force remove`, code: 'rmRunning' };
    }
    const ev: KitchenEvent[] = [];
    if (c.status === 'running' || c.status === 'paused') {
      c.autoRemove = false;
      ev.push(...stopContainer(s, c, { kill: true }));
    }
    ev.push(...removeContainer(s, c, f.bools.has('--volumes')));
    return { line: ref, events: ev };
  }, force ? 'sim.docker.explain.rmForce' : 'sim.docker.explain.rm');
  return r;
};

// ---------------------------------------------------------------------------
// ps

function psFilter(state: KitchenState, c: Container, filters: string[]): boolean | string {
  for (const f of filters) {
    const i = f.indexOf('=');
    if (i < 0) return `bad format of filter (expected name=value)`;
    const k = f.slice(0, i);
    const v = f.slice(i + 1);
    switch (k) {
      case 'status':
        if (!['created', 'restarting', 'running', 'removing', 'paused', 'exited', 'dead'].includes(v)) return `invalid filter 'status=${v}'`;
        if (c.status !== v) return false;
        break;
      case 'name':
        if (!new RegExp(v).test(c.name)) return false;
        break;
      case 'id':
        if (!c.id.startsWith(v)) return false;
        break;
      case 'ancestor': {
        const img = findImage(state, v);
        if (!img || c.imageId !== img.id) return false;
        break;
      }
      case 'label': {
        const j = v.indexOf('=');
        if (j < 0 ? !(v in c.labels) : c.labels[v.slice(0, j)] !== v.slice(j + 1)) return false;
        break;
      }
      case 'exited':
        if (c.status !== 'exited' || c.exitCode !== Number(v)) return false;
        break;
      case 'network':
        if (!(v in c.networks)) return false;
        break;
      case 'volume':
        if (!c.mounts.some((m) => m.source === v || m.target === v)) return false;
        break;
      case 'publish':
        if (!c.ports.some((p) => String(p.hostPort) === v.split('/')[0])) return false;
        break;
      case 'health':
        if ((c.health?.status ?? 'none') !== v) return false;
        break;
      default:
        return `invalid filter '${k}'`;
    }
  }
  return true;
}

export const ps = (state: KitchenState, args: string[]): KitchenResult => {
  const f = parseFlags(args, {
    bools: [['-a', '--all'], ['-q', '--quiet'], ['--no-trunc'], ['-l', '--latest'], ['-s', '--size']],
    values: [['--format'], ['-n', '--last']],
    multi: [['-f', '--filter']],
  });
  if (f.unknown) return unknownFlag(state, 'ps', f.unknown);
  if (f.positional.length) return fail(state, out(`"docker ps" accepts no arguments.\nSee 'docker ps --help'.\n\nUsage:  docker ps [OPTIONS]\n\nList containers`), 'usage');
  const filters = f.multi.get('--filter') ?? [];
  let list = Object.values(state.containers).sort((a, b) => b.created - a.created || (a.id < b.id ? 1 : -1));
  const showAll = f.bools.has('--all') || f.bools.has('--latest') || f.values.has('--last') || filters.some((x) => x.startsWith('status=') || x.startsWith('exited='));
  if (!showAll) list = list.filter((c) => c.status === 'running' || c.status === 'paused' || c.status === 'restarting');
  const kept: Container[] = [];
  for (const c of list) {
    const r = psFilter(state, c, filters);
    if (typeof r === 'string') return fail(state, out(`Error response from daemon: ${r}`), 'badFilter');
    if (r) kept.push(c);
  }
  list = kept;
  if (f.bools.has('--latest')) list = list.slice(0, 1);
  if (f.values.has('--last')) list = list.slice(0, Number(f.values.get('--last')));
  const noTrunc = f.bools.has('--no-trunc');
  if (f.bools.has('--quiet')) return ok(state, list.map((c) => line(noTrunc ? c.id : c.id.slice(0, 12))), [], { key: 'sim.docker.explain.psQuiet' });
  const rows = list.map((c) => psRow(state, c, noTrunc));
  const fmt = f.values.get('--format');
  if (fmt) {
    try {
      return ok(state, formatRows(rows, fmt, PS_HEADERS).map((l) => line(l)), [], { key: 'sim.docker.explain.psFormat' });
    } catch (e) {
      return fail(state, out(e instanceof TemplateError ? e.message : String(e)), 'badTemplate');
    }
  }
  const lines = table([
    ['CONTAINER ID', 'IMAGE', 'COMMAND', 'CREATED', 'STATUS', 'PORTS', 'NAMES'],
    ...rows.map((r) => [r.ID!, r.Image!, r.Command!, r.RunningFor!, r.Status!, r.Ports!, r.Names!]),
  ]);
  const running = list.filter((c) => c.status === 'running').length;
  return ok(state, lines.map((l) => line(l)), [], {
    key: f.bools.has('--all') ? 'sim.docker.explain.psAll' : list.length ? 'sim.docker.explain.ps' : 'sim.docker.explain.psEmpty',
    params: { n: String(list.length), running: String(running) },
  });
};

// ---------------------------------------------------------------------------
// logs

export const logs = (state: KitchenState, args: string[]): KitchenResult => {
  const f = parseFlags(args, { bools: [['-f', '--follow'], ['-t', '--timestamps'], ['--details']], values: [['-n', '--tail'], ['--since'], ['--until']] });
  if (f.unknown) return unknownFlag(state, 'logs', f.unknown, 1);
  if (f.positional.length !== 1) return needArgs(state, 'logs', 'exactly 1 argument');
  const c = findContainer(state, f.positional[0]!);
  if (!c) return noSuch(state, f.positional[0]!);
  let list = c.logs;
  const tail = f.values.get('--tail');
  if (tail !== undefined && tail !== 'all') list = Number(tail) === 0 ? [] : list.slice(-Number(tail));
  const lines = list.map((l) => line(f.bools.has('--timestamps') ? `${iso(l.t, '000000000')} ${l.text}` : l.text));
  return ok(state, lines, [], { key: f.bools.has('--follow') ? 'sim.docker.explain.logsFollow' : list.length ? 'sim.docker.explain.logs' : 'sim.docker.explain.logsEmpty', params: { name: c.name } });
};

// ---------------------------------------------------------------------------
// exec

function quote(words: string[]): string {
  return words.map((w) => (/^[\w./:=@%+,-]+$/.test(w) ? w : `'${w.replace(/'/g, "'\\''")}'`)).join(' ');
}

export const exec = (state: KitchenState, args: string[]): KitchenResult => {
  const f = parseFlags(args, { bools: [['-i', '--interactive'], ['-t', '--tty'], ['-d', '--detach'], ['--privileged']], values: [['-u', '--user'], ['-w', '--workdir']], multi: [['-e', '--env']], stopAtPositional: true });
  if (f.unknown) return unknownFlag(state, 'exec', f.unknown, 125);
  const [ref, ...cmd] = f.positional;
  if (!ref || !cmd.length) return needArgs(state, 'exec', 'at least 2 arguments');
  const c0 = findContainer(state, ref);
  if (!c0) return noSuch(state, ref);
  if (c0.status === 'paused') return daemonError(state, `container ${c0.id} is paused, unpause the container before exec`, 'paused', { key: 'sim.docker.err.paused', params: { name: c0.name } });
  if (c0.status !== 'running') return daemonError(state, `container ${c0.id} is not running`, 'notRunning', { key: 'sim.docker.err.notRunning', params: { name: c0.name } });
  const s = structuredClone(state);
  const c = s.containers[c0.id]!;
  const img = imageOf(s, c);
  const prog = cmd[0]!;
  const interactive = f.bools.has('--interactive') && f.bools.has('--tty');
  const user = f.values.get('--user') ?? '';
  const known = ['sh', 'ash', 'bash', '/bin/sh', '/bin/bash'].includes(prog) ? Boolean(img && (prog.endsWith('sh') && prog !== 'bash' && !prog.endsWith('/bash') ? true : img.bins.includes('bash'))) : null;
  if (known === false || (known === null && img && !['cd', 'echo', 'export'].includes(prog) && !img.bins.includes(basename(prog)) && !prog.startsWith('/'))) {
    return fail(s, out(`OCI runtime exec failed: exec failed: unable to start container process: exec: "${prog}": executable file not found in $PATH`), 'execNotFound', { key: 'sim.docker.err.execNotFound', params: { cmd: prog } }, 127);
  }
  if (interactive && cmd.length === 1 && ['sh', 'ash', 'bash', '/bin/sh', '/bin/bash'].includes(prog)) {
    s.session = { kind: 'shell', container: c.id, cwd: f.values.get('--workdir') ?? c.workdir, user: user || c.user || img?.config.User || 'root', main: false };
    return { ...ok(s, [], [], { key: 'sim.docker.explain.execShell', params: { name: c.name } }), prompt: shellPrompt(s) };
  }
  if (interactive && cmd.length === 1 && (prog === 'node' || prog === 'python' || prog === 'python3')) {
    s.session = { kind: 'repl', container: c.id, lang: prog === 'node' ? 'node' : 'python', main: false };
    const banner = prog === 'node' ? [`Welcome to Node.js v24.22.2.`, 'Type ".help" for more information.'] : ['Python 3.13.18 (main, Oct 28 2026, 02:04:41) [GCC 14.2.0] on linux', 'Type "help", "copyright", "credits" or "license" for more information.'];
    return { ...ok(s, banner.map((l) => line(l)), [], { key: 'sim.docker.explain.runRepl', params: { name: c.name } }), prompt: prog === 'node' ? '> ' : '>>> ' };
  }
  const ctx = makeCtx(s, c, { user: user || undefined, cwd: f.values.get('--workdir'), tty: interactive });
  for (const e of f.multi.get('--env') ?? []) {
    const i = e.indexOf('=');
    if (i > 0) ctx.env.push([e.slice(0, i), e.slice(i + 1)]);
  }
  const r = runScript(ctx, quote(cmd));
  const lines = [...r.out, ...r.err].map((l) => line(l));
  const res: KitchenResult = {
    state: s,
    output: lines,
    events: ctx.events,
    ok: r.code === 0,
    exitCode: r.code,
    explain: { key: r.code === 0 ? 'sim.docker.explain.exec' : 'sim.docker.explain.execFailed', params: { name: c.name, code: String(r.code) } },
  };
  if (r.code !== 0) res.events.push({ type: 'error', code: 'execNonZero' });
  return res;
};

// ---------------------------------------------------------------------------
// port, top, stats

export const port = (state: KitchenState, args: string[]): KitchenResult => {
  const [ref, which] = args;
  if (!ref) return needArgs(state, 'port');
  const c = findContainer(state, ref);
  if (!c) return noSuch(state, ref);
  if (c.status !== 'running' && c.status !== 'paused') return ok(state, [], [], { key: 'sim.docker.explain.portNone', params: { name: c.name } });
  const lines: string[] = [];
  for (const p of [...c.ports].sort((a, b) => a.containerPort - b.containerPort)) {
    const key = `${p.containerPort}/${p.proto}`;
    if (which && which !== key && which !== String(p.containerPort)) continue;
    const addrs = [`${p.hostIp}:${p.hostPort}`, ...(state.host.ipv6 && p.hostIp === '0.0.0.0' ? [`[::]:${p.hostPort}`] : [])];
    for (const a of addrs) lines.push(which ? a : `${key} -> ${a}`);
  }
  if (which && !lines.length) return fail(state, out(`Error: No public port '${which.includes('/') ? which : `${which}/tcp`}' published for ${ref}`), 'noPort', { key: 'sim.docker.err.noPort', params: { port: which } });
  return ok(state, lines.map((l) => line(l)), [], { key: lines.length ? 'sim.docker.explain.port' : 'sim.docker.explain.portNone', params: { name: c.name } });
};

export const top = (state: KitchenState, args: string[]): KitchenResult => {
  const ref = args[0];
  if (!ref) return needArgs(state, 'top');
  const c = findContainer(state, ref);
  if (!c) return noSuch(state, ref);
  if (c.status !== 'running' && c.status !== 'paused') return daemonError(state, `container ${c.id} is not running`, 'notRunning', { key: 'sim.docker.err.notRunning', params: { name: c.name } });
  // ps runs on the laptop, so STIME is laptop time (+08), like `ps aux` there.
  const d = new Date(((c.startedAt ?? state.clock) + 8 * 3600) * 1000);
  const stime = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  const rows: string[][] = [['UID', 'PID', 'PPID', 'C', 'STIME', 'TTY', 'TIME', 'CMD']];
  for (const p of hostProcesses(state, c).procs) rows.push([p.uid, String(p.pid), String(p.ppid), '0', stime, '?', '00:00:00', p.cmd]);
  return ok(state, table(rows, 20, 3).map((l) => line(l)), [], { key: 'sim.docker.explain.top', params: { name: c.name } });
};

const MEM: Record<string, [number, number]> = {
  nginx: [5189427, 5],
  postgres: [42102784, 7],
  redis: [10223616, 6],
  node: [11534336, 7],
  python: [14680064, 1],
  sleep: [409600, 1],
  shell: [458752, 1],
  hello: [0, 0],
  exited: [0, 0],
};

export const stats = (state: KitchenState, args: string[]): KitchenResult => {
  const f = parseFlags(args, { bools: [['--no-stream'], ['-a', '--all'], ['--no-trunc']], values: [['--format']] });
  if (f.unknown) return unknownFlag(state, 'stats', f.unknown);
  let list = Object.values(state.containers).filter((c) => c.status === 'running' || c.status === 'paused');
  if (f.positional.length) {
    list = [];
    for (const ref of f.positional) {
      const c = findContainer(state, ref);
      if (!c) return fail(state, out(`Error response from daemon: No such container: ${ref}`), 'noSuchContainer', { key: 'sim.docker.err.noSuchContainer', params: { name: ref } });
      list.push(c);
    }
  }
  const host = state.host.memBytes;
  const rows = list.map((c) => {
    const limit = c.limits?.memory || host;
    const [mem, pids] = c.status === 'running' || c.status === 'paused' ? (MEM[c.proc?.kind ?? 'shell'] ?? [458752, 1]) : [0, 0];
    return [c.id.slice(0, 12), c.name, '0.00%', `${bytesSize(mem)} / ${bytesSize(limit)}`, `${((mem / limit) * 100).toFixed(2)}%`, mem ? '1.07kB / 2.15kB' : '0B / 0B', '0B / 0B', String(pids)];
  });
  const lines = table([['CONTAINER ID', 'NAME', 'CPU %', 'MEM USAGE / LIMIT', 'MEM %', 'NET I/O', 'BLOCK I/O', 'PIDS'], ...rows]);
  return ok(state, lines.map((l) => line(l)), [], { key: f.bools.has('--no-stream') ? 'sim.docker.explain.stats' : 'sim.docker.explain.statsStream' });
};

// ---------------------------------------------------------------------------
// cp

function tarSize(files: Record<string, string>, dirs: number): number {
  let n = 1024 + dirs * 512;
  for (const content of Object.values(files)) n += 512 + Math.ceil(new TextEncoder().encode(content).length / 512) * 512;
  return n;
}

export const cp = (state: KitchenState, args: string[]): KitchenResult => {
  const pos = args.filter((a) => !a.startsWith('-'));
  if (pos.length !== 2) return needArgs(state, 'cp', 'exactly 2 arguments');
  const [src, dst] = pos as [string, string];
  const split = (x: string) => {
    const m = /^([a-zA-Z0-9][a-zA-Z0-9_.-]*):(.*)$/.exec(x);
    return m && !x.startsWith('/') && !x.startsWith('.') ? { ref: m[1]!, path: m[2]! } : null;
  };
  const from = split(src);
  const to = split(dst);
  if ((from && to) || (!from && !to)) {
    return fail(state, out('must specify at least one container source'), 'cpBoth', { key: 'sim.docker.err.cpSides' });
  }
  const s = structuredClone(state);
  if (from) {
    const c = findContainer(s, from.ref);
    if (!c) return noSuch(state, from.ref);
    const files = walkC(s, c, from.path);
    if (!Object.keys(files).length && readC(s, c, from.path) !== 'dir') {
      return daemonError(state, `Could not find the file ${from.path} in container ${from.ref}`, 'cpMissing', { key: 'sim.docker.err.cpMissing', params: { path: from.path } });
    }
    const destAbs = resolve(s, dst);
    const intoDir = s.fs.dirs.includes(destAbs);
    const srcIsDir = readC(s, c, from.path) === 'dir';
    let bytes = 0;
    for (const [p, content] of Object.entries(files)) {
      const rel = srcIsDir ? p.slice(from.path.replace(/\/$/, '').length + 1) : basename(p);
      const target = srcIsDir ? `${intoDir ? `${destAbs}/${basename(from.path)}` : destAbs}/${rel}` : intoDir ? `${destAbs}/${rel}` : destAbs;
      hostWrite(s, target, content);
      bytes += new TextEncoder().encode(content).length;
    }
    const shown = dst === '.' ? `${s.cwd}/.` : destAbs;
    return ok(s, [line(`Successfully copied ${humanSize(bytes)} (transferred ${humanSize(tarSize(files, srcIsDir ? 1 : 0))}) to ${shown}`)], [{ type: 'fileWritten', path: destAbs }], { key: 'sim.docker.explain.cpOut', params: { name: c.name } });
  }
  const c = findContainer(s, to!.ref);
  if (!c) return noSuch(state, to!.ref);
  const srcAbs = resolve(s, src);
  let files: Record<string, string> = {};
  let isDir = false;
  if (srcAbs in s.fs.files) files = { [srcAbs]: s.fs.files[srcAbs]! };
  else if (s.fs.dirs.includes(srcAbs)) {
    isDir = true;
    for (const p of filesUnder(s, srcAbs)) files[p] = s.fs.files[p]!;
  } else return fail(state, out(`lstat ${srcAbs}: no such file or directory`), 'cpMissing', { key: 'sim.docker.err.cpMissingHost', params: { path: src } });
  const dest = to!.path;
  const destIsDir = readC(s, c, dest) === 'dir' || dest.endsWith('/');
  let bytes = 0;
  for (const [p, content] of Object.entries(files)) {
    const rel = isDir ? `${basename(srcAbs)}/${p.slice(srcAbs.length + 1)}` : basename(p);
    const target = destIsDir || isDir ? `${dest.replace(/\/$/, '')}/${rel}` : dest;
    if (isDir) {
      let d = dirname(target);
      const make: string[] = [];
      while (d !== '/' && readC(s, c, d) !== 'dir') {
        make.push(d);
        d = dirname(d);
      }
      for (const m of make.reverse()) c.dirs.push(m);
    }
    const err = writeC(s, c, target, content, 0);
    if (err) return fail(state, out(`Error response from daemon: ${err}`), 'cpFailed');
    bytes += new TextEncoder().encode(content).length;
  }
  return ok(s, [line(`Successfully copied ${humanSize(bytes)} (transferred ${humanSize(tarSize(files, isDir ? 1 : 0))}) to ${to!.ref}:${dest}`)], [], { key: 'sim.docker.explain.cpIn', params: { name: c.name } });
};

// ---------------------------------------------------------------------------
// Helpers used by other modules

export function inspectContainer(state: KitchenState, c: Container) {
  return containerJson(state, c);
}

export { containersUsing, envMap, exitContainer, isInside };

export const wait = (state: KitchenState, args: string[]): KitchenResult => {
  const c = findContainer(state, args[0] ?? '');
  if (!c) return noSuch(state, args[0] ?? '');
  return ok(state, [line(String(c.exitCode))]);
};

/** `docker rename OLD NEW`. */
export const rename = (state: KitchenState, args: string[]): KitchenResult => {
  const [a, b] = args;
  if (!a || !b) return needArgs(state, 'rename', 'exactly 2 arguments');
  const c = findContainer(state, a);
  if (!c) return noSuch(state, a);
  if (Object.values(state.containers).some((x) => x.name === b)) {
    return daemonError(state, `Error when allocating new name: Conflict. The container name "/${b}" is already in use by container "${Object.values(state.containers).find((x) => x.name === b)!.id}". You have to remove (or rename) that container to be able to reuse that name.`, 'nameInUse');
  }
  const s = structuredClone(state);
  s.containers[c.id]!.name = b;
  return ok(s, [], [], { key: 'sim.docker.explain.rename', params: { from: a, to: b } });
};

export type { Ctx };
