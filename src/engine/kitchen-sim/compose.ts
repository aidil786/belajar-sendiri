// docker compose (v5): compose.yaml → a project of containers, a network and volumes.
// Output follows Compose v5.6.1 ("[+] up 6/6", " ✔ Container shop-db-1  Healthy").
import { parse as parseYaml, stringify } from 'yaml';
import { basename, isInside } from '../git-sim/paths';
import { build } from './build';
import { cmdline, ensureVolume, parsePublish, portsText, shellPrompt, statusText } from './containers';
import { parseFlags } from './flags';
import { ago, spread, table } from './format';
import { pullImage } from './images';
import { createContainer, removeContainer, startContainer, stopContainer, tick } from './lifecycle';
import { familiar, parseRef } from './refs';
import { allocIp, fail, findImage, line, nextSubnet, ok, out, resolve } from './state';
import { makeCtx, runScript } from './cshell';
import { hexOf, nextId } from './ids';
import type { Container, HealthConfig, KitchenEvent, KitchenResult, KitchenState, Line, Mount, PortBinding } from './types';

const WIDTH = 80;
const FILES = ['compose.yaml', 'compose.yml', 'docker-compose.yaml', 'docker-compose.yml'];

export interface Service {
  name: string;
  image?: string;
  build?: { context: string; dockerfile: string; target?: string; args: Record<string, string> };
  ports: string[];
  volumes: { type: 'volume' | 'bind'; source: string; target: string; readOnly: boolean }[];
  environment: Record<string, string>;
  envFiles: string[];
  dependsOn: Record<string, { condition: string; required: boolean }>;
  healthcheck?: HealthConfig;
  profiles: string[];
  command?: string[];
  entrypoint?: string[];
  user?: string;
  workingDir?: string;
  networks: Record<string, { aliases: string[] }>;
  restart?: string;
  containerName?: string;
  replicas: number;
  expose: string[];
  readOnly: boolean;
  capDrop: string[];
  raw: Record<string, unknown>;
}

export interface Project {
  name: string;
  dir: string;
  files: string[];
  services: Record<string, Service>;
  volumes: Record<string, { name: string; external: boolean }>;
  networks: Record<string, { name: string; external: boolean }>;
  warnings: string[];
}

type Loaded = { ok: true; p: Project } | { ok: false; error: string; code: string };

const SERVICE_KEYS = new Set([
  'image', 'build', 'ports', 'volumes', 'environment', 'env_file', 'depends_on', 'healthcheck', 'profiles', 'command', 'entrypoint', 'user',
  'working_dir', 'networks', 'restart', 'container_name', 'deploy', 'expose', 'read_only', 'cap_drop', 'cap_add', 'tmpfs', 'labels', 'develop', 'stop_grace_period', 'init', 'platform', 'hostname', 'pull_policy',
]);

/** ${VAR}, ${VAR:-default}, ${VAR-default}, ${VAR:?error}, $VAR, $$. */
function interpolate(text: string, vars: Record<string, string>, warn: Set<string>, errors: string[]): string {
  return text.replace(/\$\$|\$\{([A-Za-z_][A-Za-z0-9_]*)(?:(:?[-?])([^}]*))?\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (m, a: string, op: string, arg: string, b: string) => {
    if (m === '$$') return '$';
    const name = a ?? b;
    const v = vars[name];
    if (op === ':-') return v ? v : arg;
    if (op === '-') return v ?? arg;
    if (op === ':?' || op === '?') {
      if (op === ':?' ? !v : v === undefined) errors.push(`required variable ${name} is missing a value: ${arg}`);
      return v ?? '';
    }
    if (v === undefined) warn.add(name);
    return v ?? '';
  });
}

/** `path` is where the text sits, like Compose prints it: services.db.environment.X, services.web.ports.[] */
function walk(value: unknown, fn: (s: string, path: string) => string, path = ''): unknown {
  if (typeof value === 'string') return fn(value, path);
  if (Array.isArray(value)) return value.map((v) => walk(v, fn, `${path}.[]`));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v, fn, path ? `${path}.${k}` : k)]));
  return value;
}

function words(v: unknown): string[] | undefined {
  if (v === undefined || v === null) return undefined;
  if (Array.isArray(v)) return v.map(String);
  return String(v).match(/"[^"]*"|'[^']*'|\S+/g)?.map((w) => w.replace(/^["']|["']$/g, '')) ?? [];
}

function seconds(v: unknown): number | undefined {
  if (v === undefined) return undefined;
  const m = /^(\d+(?:\.\d+)?)(ms|s|m|h)?$/.exec(String(v));
  if (!m) return undefined;
  const n = Number(m[1]);
  return m[2] === 'ms' ? n / 1000 : m[2] === 'm' ? n * 60 : m[2] === 'h' ? n * 3600 : n;
}

function readEnv(text: string | undefined): Record<string, string> {
  const outVars: Record<string, string> = {};
  for (const raw of (text ?? '').split('\n')) {
    const l = raw.trim();
    if (!l || l.startsWith('#')) continue;
    const i = l.indexOf('=');
    if (i > 0) outVars[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
  return outVars;
}

/** Find and read the compose file(s) for the current folder. */
export function loadProject(state: KitchenState, files: string[], projectName?: string, envFile?: string): Loaded {
  let dir = state.cwd;
  let paths: string[] = [];
  if (files.length) {
    paths = files.map((f) => resolve(state, f));
    for (const p of paths) {
      if (!(p in state.fs.files)) return { ok: false, error: `open ${p}: no such file or directory`, code: 'noComposeFile' };
    }
    dir = paths[0]!.slice(0, paths[0]!.lastIndexOf('/')) || '/';
  } else {
    for (let d = state.cwd; ; d = d.slice(0, d.lastIndexOf('/')) || '/') {
      const hit = FILES.map((f) => `${d === '/' ? '' : d}/${f}`).find((f) => f in state.fs.files);
      if (hit) {
        paths = [hit];
        const override = hit.replace(/\.ya?ml$/, '.override$&');
        if (override in state.fs.files) paths.push(override);
        dir = d;
        break;
      }
      if (d === '/') break;
    }
    if (!paths.length) return { ok: false, error: 'no configuration file provided: not found', code: 'noComposeFile' };
  }
  const dotEnv = readEnv(state.fs.files[envFile ? resolve(state, envFile) : `${dir === '/' ? '' : dir}/.env`]);
  const vars = { ...dotEnv, ...state.env };
  const warnVars = new Set<string>();
  const errors: string[] = [];
  const warnings: string[] = [];
  let merged: Record<string, unknown> = {};
  for (const p of paths) {
    let doc: unknown;
    try {
      doc = parseYaml(state.fs.files[p]!);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const lineNo = /line (\d+)/.exec(msg)?.[1] ?? '1';
      return { ok: false, error: `yaml: line ${lineNo}: ${msg.split(' at line')[0]!.toLowerCase()}`, code: 'badYaml' };
    }
    if (!doc || typeof doc !== 'object') return { ok: false, error: `${p}: empty compose file`, code: 'badYaml' };
    const d = doc as Record<string, unknown>;
    if ('version' in d) warnings.push(`${p}: the attribute \`version\` is obsolete, it will be ignored, please remove it to avoid potential confusion`);
    for (const k of Object.keys(d)) {
      if (!['version', 'name', 'services', 'volumes', 'networks', 'secrets', 'configs', 'include'].includes(k) && !k.startsWith('x-')) {
        return { ok: false, error: `validating ${p}: additional properties '${k}' not allowed`, code: 'badCompose' };
      }
    }
    for (const [sname, sv] of Object.entries((d.services ?? {}) as Record<string, unknown>)) {
      for (const k of Object.keys((sv ?? {}) as object)) {
        if (!SERVICE_KEYS.has(k)) return { ok: false, error: `validating ${p}: services.${sname} additional properties '${k}' not allowed`, code: 'badCompose' };
      }
    }
    // Compose v5 names where a required variable was missing: "error while interpolating services.db.environment.X: …".
    const interp = walk(d, (s, at) => {
      const found: string[] = [];
      const v = interpolate(s, vars, warnVars, found);
      for (const e of found) errors.push(`error while interpolating ${at}: ${e}`);
      return v;
    }) as Record<string, unknown>;
    // Later files override earlier ones (service by service, key by key).
    const services = { ...((merged.services ?? {}) as Record<string, Record<string, unknown>>) };
    for (const [k, v] of Object.entries((interp.services ?? {}) as Record<string, Record<string, unknown>>)) services[k] = { ...(services[k] ?? {}), ...(v ?? {}) };
    merged = { ...merged, ...interp, services };
  }
  if (errors.length) return { ok: false, error: [...new Set(errors)].sort().join('\n'), code: 'missingVar' };
  for (const v of warnVars) warnings.unshift(`The "${v}" variable is not set. Defaulting to a blank string.`);
  const name = (projectName ?? (merged.name as string | undefined) ?? basename(dir)).toLowerCase().replace(/[^a-z0-9_-]/g, '');
  const p: Project = { name, dir, files: paths, services: {}, volumes: {}, networks: {}, warnings };
  for (const [k, v] of Object.entries((merged.volumes ?? {}) as Record<string, Record<string, unknown> | null>)) {
    p.volumes[k] = { name: (v?.name as string) ?? `${name}_${k}`, external: Boolean(v?.external) };
  }
  for (const [k, v] of Object.entries((merged.networks ?? {}) as Record<string, Record<string, unknown> | null>)) {
    p.networks[k] = { name: (v?.name as string) ?? `${name}_${k}`, external: Boolean(v?.external) };
  }
  for (const [sname, raw0] of Object.entries((merged.services ?? {}) as Record<string, Record<string, unknown>>)) {
    const raw = raw0 ?? {};
    const env: Record<string, string> = {};
    const envFiles = words(raw.env_file) ?? [];
    for (const f of envFiles) {
      const text = state.fs.files[resolve({ ...state, cwd: dir }, f)];
      if (text === undefined) return { ok: false, error: `env file ${resolve({ ...state, cwd: dir }, f)} not found: stat ${resolve({ ...state, cwd: dir }, f)}: no such file or directory`, code: 'envFile' };
      Object.assign(env, readEnv(text));
    }
    if (Array.isArray(raw.environment)) {
      for (const e of raw.environment as string[]) {
        const i = String(e).indexOf('=');
        env[i > 0 ? String(e).slice(0, i) : String(e)] = i > 0 ? String(e).slice(i + 1) : (vars[String(e)] ?? '');
      }
    } else for (const [k, v] of Object.entries((raw.environment ?? {}) as Record<string, unknown>)) env[k] = v === null ? (vars[k] ?? '') : String(v);
    const dependsOn: Service['dependsOn'] = {};
    if (Array.isArray(raw.depends_on)) for (const d of raw.depends_on as string[]) dependsOn[d] = { condition: 'service_started', required: true };
    else for (const [d, c] of Object.entries((raw.depends_on ?? {}) as Record<string, { condition?: string; required?: boolean }>)) dependsOn[d] = { condition: c?.condition ?? 'service_started', required: c?.required ?? true };
    const volumes: Service['volumes'] = [];
    for (const v of (raw.volumes ?? []) as unknown[]) {
      if (typeof v === 'string') {
        const parts = v.split(':');
        const ro = parts[2] === 'ro';
        const src = parts[0]!;
        const target = parts[1] ?? parts[0]!;
        if (parts.length === 1) volumes.push({ type: 'volume', source: '', target, readOnly: false });
        else if (src.startsWith('.') || src.startsWith('/') || src.startsWith('~')) volumes.push({ type: 'bind', source: resolve({ ...state, cwd: dir }, src), target, readOnly: ro });
        else volumes.push({ type: 'volume', source: src, target, readOnly: ro });
      } else if (v && typeof v === 'object') {
        const o = v as Record<string, unknown>;
        const type = (o.type as 'volume' | 'bind') ?? 'volume';
        volumes.push({ type, source: type === 'bind' ? resolve({ ...state, cwd: dir }, String(o.source)) : String(o.source ?? ''), target: String(o.target), readOnly: Boolean(o.read_only) });
      }
    }
    for (const v of volumes) {
      if (v.type === 'volume' && v.source && !p.volumes[v.source]) return { ok: false, error: `service "${sname}" refers to undefined volume ${v.source}: invalid compose project`, code: 'undefinedVolume' };
    }
    const networks: Service['networks'] = {};
    if (Array.isArray(raw.networks)) for (const n of raw.networks as string[]) networks[n] = { aliases: [] };
    else if (raw.networks) for (const [n, c] of Object.entries(raw.networks as Record<string, { aliases?: string[] } | null>)) networks[n] = { aliases: c?.aliases ?? [] };
    else networks.default = { aliases: [] };
    for (const n of Object.keys(networks)) {
      if (n !== 'default' && !p.networks[n]) return { ok: false, error: `service "${sname}" refers to undefined network ${n}: invalid compose project`, code: 'undefinedNetwork' };
    }
    if (networks.default && !p.networks.default) p.networks.default = { name: `${name}_default`, external: false };
    const b = raw.build;
    const hc = raw.healthcheck as Record<string, unknown> | undefined;
    const test = hc ? (Array.isArray(hc.test) ? (hc.test as string[]) : ['CMD-SHELL', String(hc.test)]) : undefined;
    const svc: Service = {
      name: sname,
      image: raw.image as string | undefined,
      build: b
        ? typeof b === 'string'
          ? { context: resolve({ ...state, cwd: dir }, b), dockerfile: 'Dockerfile', args: {} }
          : { context: resolve({ ...state, cwd: dir }, String((b as Record<string, unknown>).context ?? '.')), dockerfile: String((b as Record<string, unknown>).dockerfile ?? 'Dockerfile'), target: (b as Record<string, unknown>).target as string | undefined, args: ((b as Record<string, unknown>).args ?? {}) as Record<string, string> }
        : undefined,
      ports: ((raw.ports ?? []) as unknown[]).map((x) => (typeof x === 'object' && x ? `${(x as Record<string, unknown>).published ?? ''}:${(x as Record<string, unknown>).target}` : String(x))),
      volumes,
      environment: env,
      envFiles,
      dependsOn,
      healthcheck: test ? { Test: test[0] === 'CMD' || test[0] === 'CMD-SHELL' || test[0] === 'NONE' ? test : ['CMD', ...test], Interval: seconds(hc!.interval), Retries: hc!.retries as number | undefined, StartPeriod: seconds(hc!.start_period) } : undefined,
      profiles: (raw.profiles as string[] | undefined) ?? [],
      command: words(raw.command),
      entrypoint: words(raw.entrypoint),
      user: raw.user as string | undefined,
      workingDir: raw.working_dir as string | undefined,
      networks,
      restart: raw.restart as string | undefined,
      containerName: raw.container_name as string | undefined,
      replicas: Number(((raw.deploy ?? {}) as Record<string, unknown>).replicas ?? 1),
      expose: ((raw.expose ?? []) as unknown[]).map(String),
      readOnly: Boolean(raw.read_only),
      capDrop: (raw.cap_drop as string[] | undefined) ?? [],
      raw,
    };
    if (!svc.image && !svc.build) return { ok: false, error: `service "${sname}" has neither an image nor a build context specified: invalid compose project`, code: 'noImage' };
    p.services[sname] = svc;
  }
  return { ok: true, p };
}

/** Services in start order (dependencies first). */
function order(p: Project, names: string[]): string[] {
  const outNames: string[] = [];
  const seen = new Set<string>();
  const visit = (n: string) => {
    if (seen.has(n) || !p.services[n]) return;
    seen.add(n);
    for (const d of Object.keys(p.services[n]!.dependsOn)) visit(d);
    outNames.push(n);
  };
  for (const n of names) visit(n);
  return outNames;
}

function activeServices(p: Project, profiles: string[], asked: string[]): string[] {
  if (asked.length) return asked;
  return Object.keys(p.services).filter((n) => {
    const prof = p.services[n]!.profiles;
    return !prof.length || prof.some((x) => profiles.includes(x));
  });
}

function projectContainers(state: KitchenState, project: string): Container[] {
  return Object.values(state.containers)
    .filter((c) => c.labels['com.docker.compose.project'] === project && c.labels['com.docker.compose.oneoff'] !== 'True')
    .sort((a, b) => (a.name < b.name ? -1 : 1));
}

function serviceImage(p: Project, svc: Service): string {
  return svc.image ?? `${p.name}-${svc.name}`;
}

/** The progress block Compose v5 prints: "[+] up 3/3" then one line per resource. */
function progress(verb: string, rows: { icon: '✔' | '✘' | '!'; what: string; status: string; time: string }[], allDone = false): Line[] {
  const w = Math.max(...rows.map((r) => [...r.what].length), 0);
  const lines: Line[] = [[{ t: `[+] ${verb} ${allDone ? rows.length : rows.filter((r) => r.icon === '✔').length}/${rows.length}`, c: 'blue' }]];
  for (const r of rows) {
    const left = ` ${r.icon} ${r.what.padEnd(w)} ${r.status}`;
    lines.push([{ t: spread(left, r.time, WIDTH), c: r.icon === '✔' ? 'green' : r.icon === '✘' ? 'red' : 'yellow' }]);
  }
  return lines;
}

function warnLines(p: Project): Line[] {
  return p.warnings.map((w) => [{ t: `WARN[0000] ${w}`, c: 'yellow' }]);
}

function svcVolumesToMounts(state: KitchenState, p: Project, svc: Service, events: KitchenEvent[]): Mount[] {
  return svc.volumes.map((v) => {
    if (v.type === 'bind') {
      if (!state.fs.dirs.includes(v.source) && !(v.source in state.fs.files)) {
        state.fs.dirs.push(v.source);
        state.fs.dirs.sort();
      }
      return { type: 'bind', source: v.source, target: v.target, readOnly: v.readOnly } as Mount;
    }
    if (!v.source) {
      const id = nextId(state, 'volume');
      state.volumes[id] = { name: id, created: state.clock, labels: {}, files: {}, dirs: [], owner: 0, anonymous: true, initialized: false };
      return { type: 'volume', source: id, target: v.target, readOnly: false, anonymous: true } as Mount;
    }
    const name = p.volumes[v.source]!.name;
    events.push(...ensureVolume(state, name, { 'com.docker.compose.project': p.name, 'com.docker.compose.volume': v.source }));
    return { type: 'volume', source: name, target: v.target, readOnly: v.readOnly } as Mount;
  });
}

function configHash(svc: Service): string {
  return hexOf(JSON.stringify(svc.raw), 16);
}

interface UpOpts {
  detach: boolean;
  build: boolean;
  scale: Record<string, number>;
  profiles: string[];
  services: string[];
}

function up(state: KitchenState, p: Project, o: UpOpts): KitchenResult {
  const s = structuredClone(state);
  const events: KitchenEvent[] = [];
  const outLines: Line[] = [...warnLines(p)];
  const rows: Parameters<typeof progress>[1] = [];
  for (const n of o.services) if (!p.services[n]) return fail(state, [...outLines, line(`no such service: ${n}`)], 'noSuchService', { key: 'sim.docker.err.noSuchService', params: { name: n } });
  const names = order(p, activeServices(p, o.profiles, o.services));
  // Images: build or pull what is missing.
  for (const n of names) {
    const svc = p.services[n]!;
    const ref = serviceImage(p, svc);
    if (svc.build && (o.build || !findImage(s, ref))) {
      const prevCwd = s.cwd;
      s.cwd = svc.build.context;
      const args = ['-t', ref, '-f', svc.build.dockerfile.startsWith('/') ? svc.build.dockerfile : `${svc.build.context}/${svc.build.dockerfile}`];
      if (svc.build.target) args.push('--target', svc.build.target);
      for (const [k, v] of Object.entries(svc.build.args)) args.push('--build-arg', `${k}=${v}`);
      const r = build(s, [...args, '.']);
      s.cwd = prevCwd;
      if (!r.ok) return { ...r, state, output: [...outLines, ...r.output] };
      Object.assign(s, r.state, { cwd: prevCwd });
      const shown = r.output.filter((l) => !l.some((x) => x.t.includes('warning')));
      shown.splice(1, 0, line(spread(' => [internal] load local bake definitions', '0.0s', WIDTH)), line(spread(' => => reading from stdin 652B', '0.0s', WIDTH)));
      outLines.push(...shown, line(spread(' => resolving provenance for metadata file', '0.0s', WIDTH)));
      events.push(...r.events);
      rows.push({ icon: '✔', what: `Image ${ref}`, status: 'Built', time: '1.4s' });
    } else if (!svc.build && !findImage(s, ref)) {
      const r = pullImage(s, ref, { quiet: true });
      if (!r.ok) {
        rows.push({ icon: '✘', what: `Image ${ref}`, status: `Error ${r.error ?? 'not found'}`, time: '0.9s' });
        return fail(s, [...outLines, ...progress('up', rows), ...out(`Error response from daemon: ${r.error ?? `pull access denied for ${ref}`}`)], 'pullFailed', { key: 'sim.docker.err.composePull', params: { ref } });
      }
      events.push(...r.events);
      rows.push({ icon: '✔', what: `Image ${familiar((parseRef(ref) as { ok: true; ref: Parameters<typeof familiar>[0] }).ref)}`, status: 'Pulled', time: '3.4s' });
    }
  }
  // Networks and volumes.
  const usedNets = new Set(names.flatMap((n) => Object.keys(p.services[n]!.networks)));
  for (const key of usedNets) {
    const net = p.networks[key]!;
    if (Object.values(s.networks).some((x) => x.name === net.name)) continue;
    const id = nextId(s, 'network');
    const subnet = nextSubnet(s);
    s.networks[id] = { id, name: net.name, driver: 'bridge', created: s.clock, subnet, gateway: subnet.replace(/0\/16$/, '1'), labels: { 'com.docker.compose.network': key, 'com.docker.compose.project': p.name }, internal: false, builtin: false, nextIp: 2 };
    rows.push({ icon: '✔', what: `Network ${net.name}`, status: 'Created', time: '0.1s' });
    events.push({ type: 'networkCreated', name: net.name });
  }
  for (const n of names) {
    for (const v of p.services[n]!.volumes) {
      if (v.type !== 'volume' || !v.source) continue;
      const vname = p.volumes[v.source]!.name;
      if (!s.volumes[vname] && !rows.some((r) => r.what === `Volume ${vname}`)) {
        events.push(...ensureVolume(s, vname, { 'com.docker.compose.project': p.name, 'com.docker.compose.volume': v.source }));
        rows.push({ icon: '✔', what: `Volume ${vname}`, status: 'Created', time: '0.0s' });
      }
    }
  }
  // Make (not start) container number i of service n. Compose creates every container before it starts any.
  const create = (n: string, i: number): { c: Container; failed?: undefined } | { c?: undefined; failed: KitchenResult } => {
    const svc = p.services[n]!;
    const hash = configHash(svc);
    const img = findImage(s, serviceImage(p, svc))!;
    const name = svc.containerName ?? `${p.name}-${n}-${i}`;
    if (Object.values(s.containers).some((x) => x.name === name)) {
      return { failed: fail(s, [...outLines, ...progress('up', rows), line(`Error response from daemon: Conflict. The container name "/${name}" is already in use by container "${Object.values(s.containers).find((x) => x.name === name)!.id}". You have to remove (or rename) that container to be able to reuse that name.`)], 'nameInUse', { key: 'sim.docker.err.nameInUse', params: { name } }) };
    }
    const ports: PortBinding[] = [];
    for (const spec of svc.ports) {
      const r = parsePublish(s, spec, ports);
      if (typeof r === 'string') return { failed: fail(s, [...outLines, line(r)], 'badPort') };
      ports.push(r);
    }
    const nets = Object.keys(svc.networks);
    const mounts = svcVolumesToMounts(s, p, svc, events);
    const rp = /^(no|always|unless-stopped|on-failure)(:(\d+))?$/.exec(svc.restart ?? 'no');
    const c = createContainer(s, {
      name,
      image: serviceImage(p, svc),
      img,
      cmd: svc.command,
      entrypoint: svc.entrypoint,
      env: Object.entries(svc.environment).map(([k, v]) => `${k}=${v}`),
      user: svc.user,
      workdir: svc.workingDir,
      ports,
      publishAll: false,
      expose: svc.expose,
      mounts,
      network: p.networks[nets[0]!]!.name,
      aliases: [n, ...(svc.networks[nets[0]!]?.aliases ?? [])],
      labels: {
        'com.docker.compose.config-hash': hash,
        'com.docker.compose.container-number': String(i),
        'com.docker.compose.oneoff': 'False',
        'com.docker.compose.project': p.name,
        'com.docker.compose.project.config_files': p.files.join(','),
        'com.docker.compose.project.working_dir': p.dir,
        'com.docker.compose.service': n,
        'com.docker.compose.version': '5.6.1',
      },
      restart: { name: (rp?.[1] ?? 'no') as Container['restartPolicy']['name'], max: rp?.[3] ? Number(rp[3]) : 0 },
      autoRemove: false,
      readOnly: svc.readOnly,
      capDrop: svc.capDrop,
      capAdd: [],
      tty: false,
      interactive: false,
      init: false,
      healthcheck: svc.healthcheck,
    });
    for (const extra of nets.slice(1)) {
      const net = Object.values(s.networks).find((x) => x.name === p.networks[extra]!.name)!;
      c.networks[net.name] = { ip: '', aliases: [n, ...(svc.networks[extra]?.aliases ?? [])], mac: '', endpoint: '' };
      void allocIp;
    }
    events.push({ type: 'containerCreated', id: c.id, name: c.name, image: c.image });
    return { c };
  };
  // Containers, dependencies first.
  const started: string[] = [];
  for (const n of names) {
    const svc = p.services[n]!;
    const want = o.scale[n] ?? svc.replicas;
    const existing = projectContainers(s, p.name).filter((c) => c.labels['com.docker.compose.service'] === n);
    // Wait for dependencies that must be healthy / completed.
    for (const [dep, cond] of Object.entries(svc.dependsOn)) {
      const depCs = projectContainers(s, p.name).filter((c) => c.labels['com.docker.compose.service'] === dep);
      if (cond.condition === 'service_healthy') {
        for (let i = 0; i < 40 && depCs.some((c) => c.health?.status === 'starting'); i++) events.push(...tick(s, 1));
        const bad = depCs.find((c) => c.health?.status !== 'healthy');
        if (bad) {
          const why = bad.status === 'exited' ? `container ${bad.name} exited (${bad.exitCode})` : `container ${bad.name} is unhealthy`;
          const row = rows.find((r) => r.what === `Container ${bad.name}`);
          if (row) {
            row.icon = '✘';
            row.status = `Error dependency ${dep} failed to start`;
          }
          // The services still to come were already created (not started), like real Compose.
          for (const rest of names.slice(names.indexOf(n))) {
            const want2 = o.scale[rest] ?? p.services[rest]!.replicas;
            for (let i = 1; i <= want2; i++) {
              const has = projectContainers(s, p.name).some((c) => c.labels['com.docker.compose.service'] === rest && c.labels['com.docker.compose.container-number'] === String(i));
              if (has) continue;
              const made = create(rest, i);
              if (made.c) rows.push({ icon: '✔', what: `Container ${made.c.name}`, status: 'Created', time: '0.0s' });
            }
          }
          return fail(s, [...outLines, ...progress('up', rows, true), line(`dependency failed to start: ${why}`)], 'dependencyFailed', { key: 'sim.docker.err.dependency', params: { name: bad.name } });
        }
        const row = rows.find((r) => r.what.startsWith(`Container `) && depCs.some((c) => r.what === `Container ${c.name}`));
        if (row) row.status = 'Healthy';
      }
    }
    for (let i = 1; i <= Math.max(want, existing.length); i++) {
      let c = existing.find((x) => x.labels['com.docker.compose.container-number'] === String(i));
      if (i > want) {
        if (c) {
          events.push(...stopContainer(s, c, {}), ...removeContainer(s, c, true));
          rows.push({ icon: '✔', what: `Container ${c.name}`, status: 'Removed', time: '0.2s' });
        }
        continue;
      }
      const hash = configHash(svc);
      // A changed service, or a newer image (docker compose up --build): Compose recreates the container.
      const imgNow = findImage(s, serviceImage(p, svc));
      // The row ends as "Started" (Compose v5's last status); stopping a program that ignores SIGTERM takes ~10 s.
      let startTime = '0.3s';
      if (c && (c.labels['com.docker.compose.config-hash'] !== hash || (imgNow && c.imageId !== imgNow.id))) {
        startTime = c.status === 'running' && (c.proc?.stopKills ?? true) ? '10.6s' : '0.6s';
        events.push(...stopContainer(s, c, {}), ...removeContainer(s, c, true));
        c = undefined;
      }
      if (c && (c.status === 'running' || c.status === 'paused')) {
        rows.push({ icon: '✔', what: `Container ${c.name}`, status: 'Running', time: '0.0s' });
        continue;
      }
      if (!c) {
        const made = create(n, i);
        if (made.failed) return made.failed;
        c = made.c;
      }
      const r = startContainer(s, c);
      events.push(...r.events);
      if (!r.ok) {
        rows.push({ icon: '✘', what: `Container ${c.name}`, status: 'Error', time: '0.1s' });
        return fail(s, [...outLines, ...progress('up', rows), line(`Error response from daemon: ${r.error}`)], r.error?.includes('port') ? 'portTaken' : 'startFailed', { key: r.error?.includes('port') ? 'sim.docker.err.portTaken' : 'sim.docker.err.startFailed', params: { port: String(c.ports[0]?.hostPort ?? ''), name: c.name } });
      }
      rows.push({ icon: '✔', what: `Container ${c.name}`, status: 'Started', time: startTime });
      started.push(c.id);
    }
  }
  s.compose[p.name] = { dir: p.dir, files: p.files };
  events.push({ type: 'composeUp', project: p.name, services: names });
  outLines.push(...progress('up', rows));
  if (!o.detach) {
    const cs = projectContainers(s, p.name).filter((c) => names.includes(c.labels['com.docker.compose.service']!));
    outLines.push(line(`Attaching to ${cs.map((c) => shortName(c)).join(', ')}`));
    outLines.push(...logLines(cs, undefined));
    s.session = { kind: 'attached', containers: cs.map((c) => c.id), compose: p.name };
    return { ...ok(s, outLines, events, { key: 'sim.docker.explain.composeAttached', params: { project: p.name } }), prompt: '' };
  }
  return ok(s, outLines, events, { key: 'sim.docker.explain.composeUp', params: { project: p.name, n: String(names.length) } });
}

/** Containers in start order (dependencies first); stop and down walk it backwards. */
function byDependency(p: Project, cs: Container[]): Container[] {
  const rank = order(p, Object.keys(p.services));
  const idx = (c: Container) => {
    const i = rank.indexOf(c.labels['com.docker.compose.service'] ?? '');
    return i < 0 ? rank.length : i;
  };
  return [...cs].sort((a, b) => idx(a) - idx(b) || (a.name < b.name ? -1 : 1));
}

function shortName(c: Container): string {
  const svc = c.labels['com.docker.compose.service'] ?? c.name;
  return `${svc}-${c.labels['com.docker.compose.container-number'] ?? '1'}`;
}

const SVC_COLORS = ['cyan', 'yellow', 'green', 'magenta', 'blue'] as const;

function logLines(cs: Container[], tail: number | undefined): Line[] {
  const w = Math.max(...cs.map((c) => shortName(c).length), 0);
  const all: { t: number; i: number; c: Container; text: string; k: number }[] = [];
  cs.forEach((c, k) => {
    const list = tail === undefined ? c.logs : tail === 0 ? [] : c.logs.slice(-tail);
    list.forEach((l, i) => all.push({ t: l.t, i, c, text: l.text, k }));
  });
  all.sort((a, b) => a.t - b.t || a.k - b.k || a.i - b.i);
  return all.map((x) => [{ t: `${shortName(x.c).padEnd(w + 1)} | `, c: SVC_COLORS[x.k % SVC_COLORS.length] }, { t: x.text }]);
}

function down(state: KitchenState, p: Project, volumes: boolean, rmi: string | undefined): KitchenResult {
  const s = structuredClone(state);
  const events: KitchenEvent[] = [...[]];
  const rows: Parameters<typeof progress>[1] = [];
  const cs = byDependency(p, projectContainers(s, p.name));
  const active = new Set(activeServices(p, [], []));
  const mine = cs.filter((c) => active.has(c.labels['com.docker.compose.service']!) || !p.services[c.labels['com.docker.compose.service']!]);
  for (const c of [...mine].reverse()) {
    events.push(...stopContainer(s, c, {}));
    events.push(...removeContainer(s, c, true));
    rows.push({ icon: '✔', what: `Container ${c.name}`, status: 'Removed', time: c.proc?.stopKills ? '10.2s' : '0.2s' });
  }
  if (volumes) {
    for (const v of Object.values(p.volumes)) {
      if (v.external || !s.volumes[v.name]) continue;
      const inUse = Object.values(s.containers).some((c) => c.mounts.some((m) => m.source === v.name));
      if (inUse) {
        rows.push({ icon: '!', what: `Volume ${v.name}`, status: 'Resource is still in use', time: '0.0s' });
        continue;
      }
      delete s.volumes[v.name];
      rows.push({ icon: '✔', what: `Volume ${v.name}`, status: 'Removed', time: '0.1s' });
      events.push({ type: 'volumeRemoved', name: v.name });
    }
  }
  for (const net of Object.values(p.networks)) {
    if (net.external) continue;
    const n = Object.values(s.networks).find((x) => x.name === net.name);
    if (!n) continue;
    if (Object.values(s.containers).some((c) => net.name in c.networks)) {
      rows.push({ icon: '!', what: `Network ${net.name}`, status: 'Resource is still in use', time: '0.0s' });
      continue;
    }
    delete s.networks[n.id];
    rows.push({ icon: '✔', what: `Network ${net.name}`, status: 'Removed', time: '0.2s' });
    events.push({ type: 'networkRemoved', name: net.name });
  }
  if (rmi) {
    for (const svc of Object.values(p.services)) {
      if (rmi === 'local' && svc.image) continue;
      const img = findImage(s, serviceImage(p, svc));
      if (!img) continue;
      delete s.images[img.id];
      for (const t of img.repoTags) delete s.tags[t];
      rows.push({ icon: '✔', what: `Image ${serviceImage(p, svc)}`, status: 'Removed', time: '0.0s' });
    }
  }
  events.push({ type: 'composeDown', project: p.name });
  delete s.compose[p.name];
  if (!rows.length) return ok(s, warnLines(p), events, { key: 'sim.docker.explain.composeDownNothing', params: { project: p.name } });
  return ok(s, [...warnLines(p), ...progress('down', rows)], events, { key: volumes ? 'sim.docker.explain.composeDownV' : 'sim.docker.explain.composeDown', params: { project: p.name } });
}

function composePs(state: KitchenState, p: Project, all: boolean, quiet: boolean, servicesOnly: boolean): KitchenResult {
  let cs = projectContainers(state, p.name);
  if (!all) cs = cs.filter((c) => c.status === 'running' || c.status === 'paused' || c.status === 'restarting');
  if (servicesOnly) return ok(state, [...new Set(cs.map((c) => c.labels['com.docker.compose.service']!))].map((n) => line(n)));
  if (quiet) return ok(state, cs.map((c) => line(c.id)));
  const rows = cs.map((c) => [c.name, c.image, `"${cmdline(c).length > 20 ? `${[...cmdline(c)].slice(0, 19).join('')}…` : cmdline(c)}"`, c.labels['com.docker.compose.service']!, ago(state.clock, c.created), statusText(state, c), portsText(state, c)]);
  return ok(state, table([['NAME', 'IMAGE', 'COMMAND', 'SERVICE', 'CREATED', 'STATUS', 'PORTS'], ...rows]).map((l) => line(l)), [], { key: cs.length ? 'sim.docker.explain.composePs' : 'sim.docker.explain.composePsEmpty', params: { project: p.name, n: String(cs.length) } });
}

/** The canonical model `docker compose config` prints. */
function configText(p: Project): string {
  const services: Record<string, unknown> = {};
  for (const name of Object.keys(p.services).sort()) {
    const svc = p.services[name]!;
    const a: Record<string, unknown> = {};
    if (svc.command) a.command = svc.command;
    if (svc.containerName) a.container_name = svc.containerName;
    if (svc.entrypoint) a.entrypoint = svc.entrypoint;
    if (Object.keys(svc.environment).length) a.environment = Object.fromEntries(Object.entries(svc.environment).sort(([x], [y]) => (x < y ? -1 : 1)));
    if (svc.image) a.image = svc.image;
    a.networks = Object.fromEntries(Object.entries(svc.networks).map(([k, v]) => [k, v.aliases.length ? { aliases: v.aliases } : null]));
    if (svc.profiles.length) a.profiles = svc.profiles;
    if (svc.restart) a.restart = svc.restart;
    if (svc.user) a.user = svc.user;
    if (svc.volumes.length) {
      a.volumes = svc.volumes.map((v) =>
        v.type === 'bind'
          ? { type: 'bind', source: v.source, target: v.target, ...(v.readOnly ? { read_only: true } : {}), bind: {} }
          : { type: 'volume', source: v.source, target: v.target, ...(v.readOnly ? { read_only: true } : {}), volume: {} },
      );
    }
    if (svc.workingDir) a.working_dir = svc.workingDir;
    if (svc.build) a.build = { context: svc.build.context, dockerfile: svc.build.dockerfile, ...(svc.build.target ? { target: svc.build.target } : {}) };
    if (Object.keys(svc.dependsOn).length) a.depends_on = Object.fromEntries(Object.entries(svc.dependsOn).map(([k, v]) => [k, { condition: v.condition, required: v.required }]));
    if (svc.replicas !== 1) a.deploy = { replicas: svc.replicas };
    if (svc.healthcheck) {
      const h = svc.healthcheck;
      a.healthcheck = { test: h.Test, ...(h.Interval ? { interval: `${h.Interval}s` } : {}), ...(h.Retries ? { retries: h.Retries } : {}) };
    }
    if (svc.ports.length) {
      a.ports = svc.ports.map((spec) => {
        const parts = spec.split('/')[0]!.split(':');
        const target = Number(parts[parts.length - 1]);
        const published = parts.length >= 2 ? parts[parts.length - 2] : undefined;
        return { mode: 'ingress', ...(parts.length === 3 ? { host_ip: parts[0] } : {}), target, ...(published ? { published } : {}), protocol: spec.split('/')[1] ?? 'tcp' };
      });
    }
    services[name] = a;
  }
  const doc: Record<string, unknown> = { name: p.name, services };
  if (Object.keys(p.networks).length) doc.networks = Object.fromEntries(Object.entries(p.networks).map(([k, v]) => [k, { name: v.name, ...(v.external ? { external: true } : {}) }]));
  if (Object.keys(p.volumes).length) doc.volumes = Object.fromEntries(Object.entries(p.volumes).map(([k, v]) => [k, { name: v.name, ...(v.external ? { external: true } : {}) }]));
  return stringify(doc, { lineWidth: 0 });
}

const EXPLAIN_ONLY = ['watch', 'attach', 'events', 'cp', 'create', 'kill', 'pause', 'unpause', 'port', 'push', 'scale', 'stats', 'top', 'version', 'wait', 'images', 'bridge', 'publish', 'volumes', 'commit', 'export'];

export const compose = (state: KitchenState, args: string[]): KitchenResult => {
  // Global options come before the sub-command.
  const files: string[] = [];
  const profiles: string[] = [];
  let projectName: string | undefined;
  let envFile: string | undefined;
  let i = 0;
  for (; i < args.length; i++) {
    const a = args[i]!;
    if (a === '-f' || a === '--file') files.push(args[++i] ?? '');
    else if (a.startsWith('--file=')) files.push(a.slice(7));
    else if (a === '-p' || a === '--project-name') projectName = args[++i];
    else if (a === '--profile') profiles.push(args[++i] ?? '');
    else if (a.startsWith('--profile=')) profiles.push(a.slice(10));
    else if (a === '--env-file') envFile = args[++i];
    else if (a === '--progress' || a === '--ansi') i++;
    else break;
  }
  const sub = args[i];
  const rest = args.slice(i + 1);
  if (!sub) {
    return fail(state, out(`\nUsage:  docker compose [OPTIONS] COMMAND\n\nDefine and run multi-container applications with Docker\n\nRun 'docker compose COMMAND --help' for more information on a command.`), 'usage', { key: 'sim.docker.err.needsSub', params: { cmd: 'docker compose' } });
  }
  if (sub === 'version') return ok(state, [line('Docker Compose version v5.6.1')], [], { key: 'sim.docker.explain.composeVersion' });
  if (sub === 'ls') {
    const projects = new Map<string, Container[]>();
    for (const c of Object.values(state.containers)) {
      const pn = c.labels['com.docker.compose.project'];
      if (pn) projects.set(pn, [...(projects.get(pn) ?? []), c]);
    }
    const rows = [...projects.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([pn, cs]) => {
      const running = cs.filter((c) => c.status === 'running').length;
      const exited = cs.filter((c) => c.status === 'exited').length;
      const status = [running ? `running(${running})` : '', exited ? `exited(${exited})` : ''].filter(Boolean).join(', ');
      return [pn, status, state.compose[pn]?.files.join(',') ?? ''];
    });
    return ok(state, table([['NAME', 'STATUS', 'CONFIG FILES'], ...rows.filter((r) => rest.includes('-a') || rest.includes('--all') || r[1]!.includes('running'))], 20, 1).map((l) => line(l)), [], { key: 'sim.docker.explain.composeLs' });
  }
  if (EXPLAIN_ONLY.includes(sub)) {
    return { ...fail(state, [], 'explainOnly', { key: `sim.docker.explain.composeOnly`, params: { cmd: `docker compose ${sub}` } }), stopped: true };
  }
  const loaded = loadProject(state, files, projectName, envFile);
  if (!loaded.ok) {
    const shown = loaded.code === 'noComposeFile' && files.length ? `compose file "${resolve(state, files[0]!)}" is invalid: ${loaded.error}` : loaded.error;
    return fail(state, out(shown), loaded.code, { key: `sim.docker.err.compose.${loaded.code}`, params: { file: files[0] ?? 'compose.yaml' } });
  }
  const p = loaded.p;
  switch (sub) {
    case 'up': {
      const f = parseFlags(rest, { bools: [['-d', '--detach'], ['--build'], ['--no-build'], ['--wait'], ['--remove-orphans'], ['--force-recreate']], multi: [['--scale']] });
      if (f.unknown) return fail(state, out(`unknown flag: ${f.unknown}`), 'unknownFlag');
      const scale: Record<string, number> = {};
      for (const sc of f.multi.get('--scale') ?? []) scale[sc.split('=')[0]!] = Number(sc.split('=')[1] ?? 1);
      for (const n of [...f.positional, ...Object.keys(scale)]) if (!p.services[n]) return fail(state, out(`no such service: ${n}`), 'noSuchService', { key: 'sim.docker.err.noSuchService', params: { name: n } });
      return up(state, p, { detach: f.bools.has('--detach') || f.bools.has('--wait'), build: f.bools.has('--build'), scale, profiles, services: f.positional });
    }
    case 'down': {
      const f = parseFlags(rest, { bools: [['-v', '--volumes'], ['--remove-orphans']], values: [['--rmi'], ['-t', '--timeout']] });
      if (profiles.length) {
        const all = Object.keys(p.services).filter((n) => p.services[n]!.profiles.some((x) => profiles.includes(x)) || !p.services[n]!.profiles.length);
        for (const n of Object.keys(p.services)) if (!all.includes(n)) delete p.services[n];
        for (const n of all) p.services[n]!.profiles = [];
      }
      return down(state, p, f.bools.has('--volumes'), f.values.get('--rmi'));
    }
    case 'ps': {
      const f = parseFlags(rest, { bools: [['-a', '--all'], ['-q', '--quiet'], ['--services']], values: [['--format']] });
      const r = composePs(state, p, f.bools.has('--all'), f.bools.has('--quiet'), f.bools.has('--services'));
      return { ...r, output: [...warnLines(p), ...r.output] };
    }
    case 'logs': {
      const f = parseFlags(rest, { bools: [['-f', '--follow'], ['-t', '--timestamps'], ['--no-color']], values: [['-n', '--tail']] });
      for (const n of f.positional) if (!p.services[n]) return fail(state, out(`no such service: ${n}`), 'noSuchService', { key: 'sim.docker.err.noSuchService', params: { name: n } });
      const cs = projectContainers(state, p.name).filter((c) => !f.positional.length || f.positional.includes(c.labels['com.docker.compose.service']!));
      const tail = f.values.get('--tail');
      return ok(state, [...warnLines(p), ...logLines(cs, tail && tail !== 'all' ? Number(tail) : undefined)], [], { key: f.bools.has('--follow') ? 'sim.docker.explain.logsFollow' : 'sim.docker.explain.composeLogs', params: { name: f.positional.join(', ') || p.name } });
    }
    case 'exec': {
      const f = parseFlags(rest, { bools: [['-T', '--no-TTY'], ['-d', '--detach'], ['--privileged']], values: [['-u', '--user'], ['-w', '--workdir'], ['--index']], multi: [['-e', '--env']], stopAtPositional: true });
      const [svcName, ...cmd] = f.positional;
      if (!svcName || !cmd.length) return fail(state, out(`"docker compose exec" requires at least 2 arguments.\nSee 'docker compose exec --help'.\n\nUsage:  docker compose exec [OPTIONS] SERVICE COMMAND [ARGS...]\n\nExecute a command in a running container`), 'usage');
      if (!p.services[svcName]) return fail(state, out(`service "${svcName}" is not running`), 'notRunning', { key: 'sim.docker.err.composeNotRunning', params: { name: svcName } });
      const c = projectContainers(state, p.name).find((x) => x.labels['com.docker.compose.service'] === svcName && x.labels['com.docker.compose.container-number'] === (f.values.get('--index') ?? '1'));
      if (!c || c.status !== 'running') return fail(state, out(`service "${svcName}" is not running`), 'notRunning', { key: 'sim.docker.err.composeNotRunning', params: { name: svcName } });
      const s = structuredClone(state);
      const cc = s.containers[c.id]!;
      const tty = !f.bools.has('--no-TTY');
      if (tty && cmd.length === 1 && ['sh', 'ash', 'bash', '/bin/sh'].includes(cmd[0]!)) {
        s.session = { kind: 'shell', container: cc.id, cwd: f.values.get('--workdir') ?? cc.workdir, user: f.values.get('--user') ?? (cc.user || 'root'), main: false };
        return { ...ok(s, [], [], { key: 'sim.docker.explain.execShell', params: { name: cc.name } }), prompt: shellPrompt(s) };
      }
      const ctx = makeCtx(s, cc, { user: f.values.get('--user'), cwd: f.values.get('--workdir'), tty });
      const r = runScript(ctx, cmd.map((w) => (/^[\w./:=@%+,-]+$/.test(w) ? w : `'${w.replace(/'/g, "'\\''")}'`)).join(' '));
      return { state: s, output: [...r.out, ...r.err].map((l) => line(l)), events: ctx.events, ok: r.code === 0, exitCode: r.code, explain: { key: r.code === 0 ? 'sim.docker.explain.exec' : 'sim.docker.explain.execFailed', params: { name: cc.name, code: String(r.code) } } };
    }
    case 'config': {
      const f = parseFlags(rest, { bools: [['--services'], ['--volumes'], ['-q', '--quiet'], ['--networks'], ['--images']] });
      if (f.bools.has('--services')) return ok(state, [...warnLines(p), ...order(p, activeServices(p, profiles, [])).map((n) => line(n))], [], { key: 'sim.docker.explain.composeConfig' });
      if (f.bools.has('--volumes')) return ok(state, [...warnLines(p), ...Object.keys(p.volumes).map((n) => line(n))], [], { key: 'sim.docker.explain.composeConfig' });
      if (f.bools.has('--quiet')) return ok(state, warnLines(p), [], { key: 'sim.docker.explain.composeConfigOk' });
      return ok(state, [...warnLines(p), ...configText(p).replace(/\n$/, '').split('\n').map((l) => line(l))], [], { key: 'sim.docker.explain.composeConfig' });
    }
    case 'build': {
      const s = structuredClone(state);
      const outLines: Line[] = [...warnLines(p)];
      const rows: Parameters<typeof progress>[1] = [];
      const events: KitchenEvent[] = [];
      for (const n of rest.filter((a) => !a.startsWith('-')).length ? rest.filter((a) => !a.startsWith('-')) : Object.keys(p.services)) {
        const svc = p.services[n];
        if (!svc) return fail(state, out(`no such service: ${n}`), 'noSuchService');
        if (!svc.build) continue;
        const prevCwd = s.cwd;
        s.cwd = svc.build.context;
        const r = build(s, ['-t', serviceImage(p, svc), ...(rest.includes('--no-cache') ? ['--no-cache'] : []), '.']);
        s.cwd = prevCwd;
        if (!r.ok) return { ...r, state, output: [...outLines, ...r.output] };
        Object.assign(s, r.state, { cwd: prevCwd });
        const shown = [...r.output];
        shown.splice(1, 0, line(spread(' => [internal] load local bake definitions', '0.0s', WIDTH)), line(spread(' => => reading from stdin 652B', '0.0s', WIDTH)));
        outLines.push(...shown, line(spread(' => resolving provenance for metadata file', '0.0s', WIDTH)));
        events.push(...r.events);
        rows.push({ icon: '✔', what: `Image ${serviceImage(p, svc)}`, status: 'Built', time: '0.3s' });
      }
      return ok(s, rows.length ? [...outLines, ...progress('build', rows)] : outLines, events, { key: 'sim.docker.explain.composeBuild', params: { project: p.name } });
    }
    case 'pull': {
      const s = structuredClone(state);
      const rows: Parameters<typeof progress>[1] = [];
      const errors: string[] = [];
      const events: KitchenEvent[] = [];
      for (const n of activeServices(p, profiles, rest.filter((a) => !a.startsWith('-')))) {
        const svc = p.services[n]!;
        if (!svc.image) {
          rows.push({ icon: '✔', what: n, status: 'Skipped No image to be pulled', time: '0.0s' });
          continue;
        }
        const r = pullImage(s, svc.image, { quiet: true });
        if (!r.ok) {
          rows.push({ icon: '✘', what: `Image ${svc.image}`, status: `Error ${r.error}`, time: '0.9s' });
          errors.push(`Error response from daemon: ${r.error}`);
        } else {
          rows.push({ icon: '✔', what: `Image ${svc.image}`, status: 'Pulled', time: '1.1s' });
          events.push(...r.events);
        }
      }
      if (errors.length) return fail(s, [...progress('pull', rows), ...errors.map((e) => line(e))], 'pullFailed', { key: 'sim.docker.err.composePull', params: { ref: '' } });
      return ok(s, progress('pull', rows), events, { key: 'sim.docker.explain.composePull' });
    }
    case 'restart':
    case 'stop':
    case 'start': {
      const s = structuredClone(state);
      const names = rest.filter((a) => !a.startsWith('-'));
      for (const n of names) if (!p.services[n]) return fail(state, out(`no such service: ${n}`), 'noSuchService', { key: 'sim.docker.err.noSuchService', params: { name: n } });
      const cs = byDependency(p, projectContainers(s, p.name)).filter((c) => !names.length || names.includes(c.labels['com.docker.compose.service']!));
      const rows: Parameters<typeof progress>[1] = [];
      const events: KitchenEvent[] = [];
      for (const c of sub === 'stop' ? [...cs].reverse() : cs) {
        if (sub !== 'start') {
          const slow = c.status === 'running' && (c.proc?.stopKills ?? true);
          events.push(...stopContainer(s, c, {}));
          if (sub === 'stop') rows.push({ icon: '✔', what: `Container ${c.name}`, status: 'Stopped', time: slow ? '10.2s' : '0.3s' });
        }
        if (sub !== 'stop' && s.containers[c.id]) {
          c.stoppedByUser = false;
          events.push(...startContainer(s, c).events);
          rows.push({ icon: '✔', what: `Container ${c.name}`, status: 'Started', time: '0.4s' });
        }
      }
      return ok(s, progress(sub, rows), events, { key: `sim.docker.explain.compose${sub[0]!.toUpperCase()}${sub.slice(1)}`, params: { project: p.name } });
    }
    case 'rm': {
      const s = structuredClone(state);
      const cs = projectContainers(s, p.name).filter((c) => c.status === 'exited' || c.status === 'created');
      if (!cs.length) return ok(s, [line('No stopped containers')]);
      const rows = cs.map((c) => {
        removeContainer(s, c, true);
        return { icon: '✔' as const, what: `Container ${c.name}`, status: 'Removed', time: '0.0s' };
      });
      return ok(s, progress('rm', rows));
    }
    case 'run': {
      const f = parseFlags(rest, { bools: [['--rm'], ['-d', '--detach'], ['-T', '--no-TTY']], multi: [['-e', '--env']], stopAtPositional: true });
      const [svcName, ...cmd] = f.positional;
      const svc = svcName ? p.services[svcName] : undefined;
      if (!svc) return fail(state, out(`no such service: ${svcName ?? ''}`), 'noSuchService');
      const s = structuredClone(state);
      const img = findImage(s, serviceImage(p, svc));
      if (!img) return fail(state, out(`No such image: ${serviceImage(p, svc)}`), 'noSuchImage');
      const events: KitchenEvent[] = [];
      const c = createContainer(s, {
        name: `${p.name}-${svcName}-run-${hexOf(`${s.seed}${s.counter}`, 12)}`,
        image: serviceImage(p, svc),
        img,
        cmd: cmd.length ? cmd : svc.command,
        env: Object.entries(svc.environment).map(([k, v]) => `${k}=${v}`),
        ports: [],
        publishAll: false,
        expose: [],
        mounts: svcVolumesToMounts(s, p, svc, events),
        network: Object.values(s.networks).find((x) => x.name === p.networks.default?.name)?.name,
        aliases: [svcName!],
        labels: { 'com.docker.compose.project': p.name, 'com.docker.compose.service': svcName!, 'com.docker.compose.oneoff': 'True' },
        restart: { name: 'no', max: 0 },
        autoRemove: f.bools.has('--rm'),
        readOnly: false,
        capDrop: [],
        capAdd: [],
        tty: false,
        interactive: false,
        init: false,
      });
      const r = startContainer(s, c);
      events.push(...r.events);
      const lines = c.logs.map((l) => line(l.text));
      return { state: s, output: lines, events, ok: c.exitCode === 0, exitCode: c.exitCode, explain: { key: 'sim.docker.explain.composeRun', params: { name: svcName! } } };
    }
    default:
      return fail(state, out(`unknown docker command: "compose ${sub}"`), 'unknownCommand', { key: 'sim.docker.err.unknownCommand', params: { cmd: `docker compose ${sub}` } });
  }
};

/** For the state picture: which compose project a container belongs to. */
export function projectOf(c: Container): string | null {
  return c.labels['com.docker.compose.project'] ?? null;
}

export { isInside };
