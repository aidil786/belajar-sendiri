// Truth check for the kitchen engine: replay every Docker scenario's `verify` command lists in the
// engine AND on a real Docker daemon (in a temp project folder), then compare structure:
// containers (name, state, exit code), port bindings, our images, volumes, networks, files in
// volumes, and selected outputs (ps/images rows, logs, curl, exec, errors) with ids, times, sizes
// and IPs masked.
//
// The real daemon may be shared (other people's containers), so everything this script makes is
// renamed with the prefix "fl-vd-", host ports move up by 20000 (8080 → 28080), every `docker run`
// gets a label, and all of it is removed before and after each list. Nothing outside the prefix is
// touched. Prune commands are not run on the real daemon (they would touch other people's things).
//
// Images come from Docker Hub's Google mirror first (mirror.gcr.io, same digests, no pull limit),
// then Docker Hub. VERIFY_ONLY=d3 checks only scenarios whose id starts with that text.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { kitchenStart, kitchenStep, plain, run, type KitchenScenario, type KitchenState } from '../../src/engine/kitchen-sim/index';
import { allScenarios } from '../../src/content/courses/docker/scenarios/index';
import { CATALOG } from '../../src/engine/kitchen-sim/catalog';
import { readCatalogFiles } from './volumes';

// Several runs can share one daemon: give each its own VERIFY_DOCKER_PREFIX (names and label)
// and VERIFY_DOCKER_PORT_OFFSET, so one run's clean-up never removes another run's containers.
const PREFIX = process.env.VERIFY_DOCKER_PREFIX ?? 'fl-vd-';
const PORT_OFFSET = Number(process.env.VERIFY_DOCKER_PORT_OFFSET ?? 20000);
const LABEL = `fahamlah.verify=${process.env.VERIFY_DOCKER_PREFIX ? PREFIX : '1'}`;
const SIM_HOME = '/home/you';
const MIRROR = process.env.VERIFY_DOCKER_MIRROR ?? 'mirror.gcr.io/library/';

function sh(args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv; input?: string } = {}): { code: number; out: string; err: string } {
  const r = spawnSync(args[0]!, args.slice(1), { cwd: opts.cwd, env: { ...process.env, ...opts.env }, input: opts.input, encoding: 'utf8' });
  return { code: r.status ?? 1, out: r.stdout ?? '', err: r.stderr ?? '' };
}

function docker(args: string[]): { code: number; out: string; err: string } {
  return sh(['docker', ...args]);
}

function sleep(secs: number) {
  if (secs > 0) spawnSync('sleep', [String(secs)]);
}

// ---------------------------------------------------------------------------
// Images

function ensureImage(ref: string): void {
  if (docker(['image', 'inspect', ref]).code === 0) {
    dropMirrorName(ref);
    return;
  }
  for (const src of [`${MIRROR}${ref}`, ref]) {
    const r = docker(['pull', '-q', src]);
    if (r.code === 0) {
      if (src !== ref) docker(['tag', src, ref]);
      dropMirrorName(ref);
      return;
    }
  }
  throw new Error(`Could not pull ${ref} (mirror or Docker Hub)`);
}

/**
 * A learner pulls `hello-world` from Docker Hub and the image has one name. A mirror pull plus a tag
 * gives it two, and then `docker rmi hello-world` only untags instead of refusing (a container still
 * uses it). So drop the mirror name again: the image keeps its Hub name, and nothing is deleted.
 */
function dropMirrorName(ref: string): void {
  const mirrored = `${MIRROR}${ref}`;
  if (mirrored !== ref && docker(['image', 'inspect', mirrored]).code === 0) docker(['rmi', mirrored]);
}

// ---------------------------------------------------------------------------
// Names and ports: what the engine made, so the real side can rename it.

interface Names {
  containers: string[];
  volumes: string[];
  networks: string[];
  images: string[];
  ports: number[];
  projects: string[];
}

function namesOf(state: KitchenState, commands: string[], sc: KitchenScenario): Names {
  const n: Names = { containers: [], volumes: [], networks: [], images: [], ports: [], projects: [] };
  const all = commands.join('\n');
  for (const m of all.matchAll(/--name[ =]([\w.-]+)/g)) n.containers.push(m[1]!);
  for (const m of all.matchAll(/(?:^|\s)-v\s+([a-zA-Z0-9][\w.-]+):\//g)) n.volumes.push(m[1]!);
  for (const m of all.matchAll(/volume create\s+([\w.-]+)/g)) n.volumes.push(m[1]!);
  for (const m of all.matchAll(/network create\s+([\w.-]+)/g)) n.networks.push(m[1]!);
  for (const m of all.matchAll(/(?:-t|tag\s+\S+)\s+([a-z0-9][\w.-]*)(?::[\w.-]+)?/g)) n.images.push(m[1]!);
  for (const m of all.matchAll(/(?:-p\s+(?:[\d.]+:)?|localhost:|127\.0\.0\.1:)(\d{2,5})/g)) n.ports.push(Number(m[1]));
  for (const step of sc.steps) {
    if (typeof step === 'object' && 'write' in step) for (const m of step.content.matchAll(/(?:^|["'\s-])(\d{4,5})(?=:\d)|_PORT=(\d{4,5})/gm)) n.ports.push(Number(m[1] ?? m[2]));
  }
  for (const c of Object.values(state.containers)) for (const p of c.ports) n.ports.push(p.hostPort);
  if (sc.cwd && Object.keys(state.fs.files).some((f) => /\/(compose|docker-compose)\.ya?ml$/.test(f))) n.projects.push(sc.cwd.split('/').pop()!);
  const repos = new Set(Object.keys(CATALOG).map((r) => r.split(':')[0]));
  for (const list of [n.containers, n.volumes, n.networks, n.images]) {
    for (const x of list) if (repos.has(x)) throw new Error(`Scenario ${sc.id}: the name "${x}" is also an official image; pick another name`);
  }
  const uniq = (xs: string[]) => [...new Set(xs)].sort((a, b) => b.length - a.length);
  return { containers: uniq(n.containers), volumes: uniq(n.volumes), networks: uniq(n.networks), images: uniq(n.images), ports: [...new Set(n.ports)].filter((p) => p > 0 && p < 45000), projects: n.projects };
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function rewrite(text: string, n: Names): string {
  let out = text;
  for (const name of [...n.containers, ...n.volumes, ...n.networks, ...n.images]) {
    out = out.replace(new RegExp(`(https?://)${esc(name)}(?=[:/\\s'"]|$)`, 'g'), `$1${PREFIX}${name}`);
    out = out.replace(new RegExp(`(?<![\\w./:-])${esc(name)}(?=$|[\\s:'"@,]|=)`, 'g'), `${PREFIX}${name}`);
  }
  for (const p of n.ports) {
    out = out.replace(new RegExp(`(?<![\\d.])${p}(?=:\\d)`, 'g'), String(p + PORT_OFFSET));
    out = out.replace(new RegExp(`(localhost|127\\.0\\.0\\.1|0\\.0\\.0\\.0):${p}\\b`, 'g'), `$1:${p + PORT_OFFSET}`);
    out = out.replace(new RegExp(`(_PORT=)${p}\\b`, 'g'), `$1${p + PORT_OFFSET}`);
  }
  return out;
}

function unmap(text: string, n: Names): string {
  let out = text.replaceAll(PREFIX, '');
  for (const p of n.ports) out = out.replace(new RegExp(`\\b${p + PORT_OFFSET}\\b`, 'g'), String(p));
  return out;
}

// ---------------------------------------------------------------------------
// Output normalising (both sides)

const PULL_LINE = /^(Unable to find image|Using default tag|[\w.-]+: Pulling from|[0-9a-f]{12}: (Pull complete|Already exists|Download complete|Pulling fs layer|Waiting|Verifying Checksum)|Digest: sha256|Status: (Downloaded newer image|Image is up to date))/;

function norm(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l) => l && !PULL_LINE.test(l))
    // curl's progress meter (only shown when output is not a terminal).
    .filter((l) => !/% Total|Dload\s+Upload|--:--:--/.test(l))
    // Machine-specific lines.
    .filter((l) => !/\[notice\] \d+#\d+: (OS: |getrlimit|start worker process \d+|using the)/.test(l))
    .filter((l) => !/10-listen-on-ipv6-by-default\.sh: info:|could not create IPv6 socket|listening on IPv6 address|errno: 97|WARNING Memory overcommit|^\s*i Info →/.test(l))
    .map((l) =>
      l
        .replace(/\b[0-9a-f]{64}\b/g, '<id>')
        .replace(/\b[0-9a-f]{12}\b/g, '<id12>')
        .replace(/\d{4}\/\d\d\/\d\d \d\d:\d\d:\d\d/g, '<time>')
        .replace(/\d\d\/\w{3}\/\d{4}[: ]\d\d:\d\d:\d\d( \+0000)?/g, '<time>')
        .replace(/\d{4}-\d\d-\d\d \d\d:\d\d:\d\d(\.\d+)?( UTC)?/g, '<time>')
        .replace(/\d\d \w{3} \d{4} \d\d:\d\d:\d\d\.\d{3}/g, '<time>')
        .replace(/\w{3}, \d\d \w{3} \d{4} \d\d:\d\d:\d\d GMT/g, '<date>')
        .replace(/\b172\.\d+\.\d+\.\d+\b/g, '<ip>')
        .replace(/\b\d+#\d+\b/g, '<pid>')
        .replace(/curl\/[\d.]+/g, 'curl/<v>')
        .replace(/ after \d+ ms/g, ' after <n> ms')
        .replace(/\[\d+\]/g, '[<pid>]')
        .replace(/\(PID \d+\)/g, '(PID <pid>)')
        .replace(/\b(Up|Exited \(\d+\)|Restarting \(\d+\)) (Less than a second|About a minute|About an hour|\d+ \w+)( ago)?/g, '$1 <t>$3')
        .replace(/\b(Less than a second|About a minute|\d+ (seconds?|minutes?|hours?)) ago\b/g, '<t> ago'),
    );
}

/** Table rows → cells (2+ spaces split), so different column widths still compare. */
function cells(lines: string[]): string[] {
  return lines.map((l) => l.trim().split(/\s{2,}/).join(' | '));
}

type Mode = 'exact' | 'sorted' | 'table' | 'none';

function modeOf(cmd: string): Mode {
  if (/^curl\b/.test(cmd)) return 'exact';
  if (/^docker (ps|compose ps|images|volume ls|network ls)\b/.test(cmd)) return 'table';
  if (/^docker (logs|exec|compose logs|compose exec)\b/.test(cmd)) return 'sorted';
  if (/^docker run\b/.test(cmd) && !/\s-d\b|--detach/.test(cmd)) return 'sorted';
  if (/^docker (pull|port|history|stop|start|rm|rmi|kill|volume (create|rm)|network rm|compose config --services|inspect -f|inspect --format)\b/.test(cmd)) return 'sorted';
  return 'none';
}

function shaped(cmd: string, text: string, known: Set<string>, filterRows?: (row: string) => boolean): string[] {
  const m = modeOf(cmd);
  if (m === 'none') return [];
  let lines = norm(text);
  if (m === 'table') {
    if (filterRows) lines = [lines[0] ?? '', ...lines.slice(1).filter(filterRows)];
    // Random names (docker run without --name) differ: mask them.
    if (/^docker ps\b/.test(cmd)) {
      lines = lines.map((l, i) => {
        if (i === 0) return l;
        const parts = l.trim().split(/\s{2,}/);
        const last = parts[parts.length - 1] ?? '';
        if (!known.has(last) && !/^[\w.]+-[\w.]+-\d+$/.test(last)) parts[parts.length - 1] = '<random>';
        return parts.join('   ');
      });
    }
    // Built image sizes are estimates in the engine: compare the names only.
    // The classic image store prints REPOSITORY and TAG columns: join them the same way.
    if (/^docker images/.test(cmd)) {
      const classic = lines[0]?.startsWith('REPOSITORY');
      return lines.slice(1).map((l) => {
        const c = l.trim().split(/\s{2,}/);
        return classic ? `${c[0]}:${c[1]}` : (c[0] ?? '');
      }).sort();
    }
    return cells(lines);
  }
  if (m === 'sorted') return [...lines].sort();
  return lines;
}

// ---------------------------------------------------------------------------
// Snapshots

interface Snapshot {
  ok: boolean[];
  containers: string[];
  ports: string[];
  images: string[];
  volumes: string[];
  networks: string[];
  volumeFiles: string[];
  builds: string[];
  outputs: Record<string, string[]>;
}

function engineSnapshot(state: KitchenState, ok: boolean[], outputs: Record<string, string[]>, builds: string[], n: Names): Snapshot {
  const cs = Object.values(state.containers);
  const known = new Set(n.containers);
  const shownName = (name: string, project: string | undefined) => (known.has(name) || project ? name : '<random>');
  const vols = Object.values(state.volumes).filter((v) => !v.anonymous);
  return {
    ok,
    containers: cs.map((c) => `${shownName(c.name, c.labels['com.docker.compose.project'])} ${c.status === 'restarting' ? 'restarting' : c.status}${c.status === 'exited' ? ` ${c.exitCode}` : ''}`).sort(),
    ports: cs.filter((c) => c.status === 'running').flatMap((c) => c.ports.map((p) => `${shownName(c.name, c.labels['com.docker.compose.project'])} ${p.hostPort}->${p.containerPort}`)).sort(),
    images: Object.values(state.images)
      .filter((i) => i.source === 'build' || i.repoTags.some((t) => !CATALOG[t.replace(/^docker\.io\/library\//, '')]))
      .flatMap((i) => i.repoTags.map((t) => t.replace(/^docker\.io\/library\//, '')))
      .filter((t) => !CATALOG[t])
      .sort(),
    volumes: vols.map((v) => v.name).sort(),
    networks: Object.values(state.networks).filter((x) => !x.builtin).map((x) => `${x.name}: ${cs.filter((c) => (c.status === 'running' || c.status === 'paused') && x.name in c.networks).map((c) => c.name).sort().join(',')}`).sort(),
    volumeFiles: vols.flatMap((v) => (v.pg ? (('18/docker/PG_VERSION' in v.files) ? [`${v.name}:pg`] : []) : Object.keys(v.files).map((f) => `${v.name}:${f}`))).sort(),
    builds,
    outputs,
  };
}

class Real {
  root: string;
  home: string;
  cwd: string;
  constructor(private n: Names, private project?: string) {
    this.root = mkdtempSync(join(tmpdir(), 'fahamlah-docker-'));
    this.home = join(this.root, 'home', 'you');
    mkdirSync(this.home, { recursive: true });
    this.cwd = this.home;
  }

  map(p: string): string {
    if (p === '~') return this.home;
    if (p.startsWith('~/')) return join(this.home, p.slice(2));
    if (p.startsWith(SIM_HOME)) return join(this.home, p.slice(SIM_HOME.length));
    if (p.startsWith('/')) return join(this.root, p);
    return join(this.cwd, p);
  }

  write(path: string, content: string) {
    const p = this.map(path);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, rewrite(content, this.n));
  }

  exec(line: string): { ok: boolean; out: string } {
    if (line.startsWith('cd ')) {
      this.cwd = this.map(line.slice(3).trim());
      return { ok: true, out: '' };
    }
    let cmd = rewrite(line, this.n);
    cmd = cmd.replace(/^docker (run|create)\b/, `docker $1 --label ${LABEL}`);
    // Only our containers (the daemon may be shared).
    cmd = cmd.replace(/^docker (ps|container ls)\b/, `docker $1 --filter label=${LABEL}`);
    if (/^docker (system|container|image|volume|network|builder) prune/.test(cmd)) return { ok: true, out: '' };
    const env: NodeJS.ProcessEnv = { DOCKER_CLI_HINTS: 'false', LANG: 'C', COMPOSE_PROGRESS: 'plain' };
    if (this.project) env.COMPOSE_PROJECT_NAME = `${PREFIX}${this.project}`;
    const r = sh(['sh', '-c', cmd.replaceAll(SIM_HOME, this.home)], { cwd: this.cwd, env });
    return { ok: r.code === 0, out: unmap(`${r.out}${r.err}`.replaceAll(this.root, ''), this.n) };
  }

  snapshot(ok: boolean[], outputs: Record<string, string[]>, builds: string[]): Snapshot {
    const ids = new Set([
      ...docker(['ps', '-aq', '--filter', `label=${LABEL}`]).out.split('\n'),
      ...docker(['ps', '-aq', '--filter', `name=${PREFIX}`]).out.split('\n'),
    ].filter(Boolean));
    const containers: string[] = [];
    const ports: string[] = [];
    const known = new Set(this.n.containers.map((c) => `${PREFIX}${c}`));
    for (const id of ids) {
      const r = docker(['inspect', '-f', '{{.Name}}|{{.State.Status}}|{{.State.ExitCode}}|{{index .Config.Labels "com.docker.compose.project"}}|{{json .NetworkSettings.Ports}}', id]).out.trim();
      const [name0, status, code, project, portsJson] = r.split('|');
      const name = name0!.replace(/^\//, '');
      const shown = known.has(name) || project ? unmap(name, this.n) : '<random>';
      containers.push(`${shown} ${status}${status === 'exited' ? ` ${code}` : ''}`);
      if (status === 'running') {
        const pj = JSON.parse(portsJson || '{}') as Record<string, { HostIp: string; HostPort: string }[] | null>;
        for (const [k, v] of Object.entries(pj)) {
          const seen = new Set<string>();
          for (const b of v ?? []) {
            const hp = Number(b.HostPort) - PORT_OFFSET > 0 ? Number(b.HostPort) - PORT_OFFSET : Number(b.HostPort);
            const key = `${shown} ${hp}->${k.split('/')[0]}`;
            if (!seen.has(key)) ports.push(key);
            seen.add(key);
          }
        }
      }
    }
    const lines = (args: string[]) => docker(args).out.split('\n').filter(Boolean);
    const images = lines(['images', '--format', '{{.Repository}}:{{.Tag}}']).filter((t) => t.startsWith(PREFIX)).map((t) => unmap(t, this.n)).sort();
    const vols = lines(['volume', 'ls', '-q', '--filter', `name=${PREFIX}`]).filter((v) => v.startsWith(PREFIX));
    const networks = lines(['network', 'ls', '--format', '{{.Name}}', '--filter', `name=${PREFIX}`])
      .filter((x) => x.startsWith(PREFIX))
      .map((x) => {
        const members = docker(['network', 'inspect', '-f', '{{range .Containers}}{{.Name}} {{end}}', x]).out.trim().split(/\s+/).filter(Boolean).map((c) => unmap(c, this.n)).sort();
        return `${unmap(x, this.n)}: ${members.join(',')}`;
      })
      .sort();
    const volumeFiles = vols.flatMap((v) => readCatalogFiles(v).map((f) => `${unmap(v, this.n)}:${f}`)).sort();
    return { ok, containers: containers.sort(), ports: ports.sort(), images, volumes: vols.map((v) => unmap(v, this.n)).sort(), networks, volumeFiles, builds, outputs };
  }

  cleanup() {
    rmSync(this.root, { recursive: true, force: true });
  }
}

/** Remove everything this script may have made (prefix, label). */
function cleanDaemon() {
  const ids = [...docker(['ps', '-aq', '--filter', `label=${LABEL}`]).out.split('\n'), ...docker(['ps', '-aq', '--filter', `name=${PREFIX}`]).out.split('\n')].filter(Boolean);
  if (ids.length) docker(['rm', '-fv', ...new Set(ids)]);
  const vols = docker(['volume', 'ls', '-q', '--filter', `name=${PREFIX}`]).out.split('\n').filter((v) => v.startsWith(PREFIX));
  if (vols.length) docker(['volume', 'rm', '-f', ...vols]);
  const nets = docker(['network', 'ls', '--format', '{{.Name}}', '--filter', `name=${PREFIX}`]).out.split('\n').filter((v) => v.startsWith(PREFIX));
  if (nets.length) docker(['network', 'rm', ...nets]);
  const imgs = docker(['images', '--format', '{{.Repository}}:{{.Tag}}']).out.split('\n').filter((v) => v.startsWith(PREFIX));
  if (imgs.length) docker(['rmi', '-f', ...imgs]);
  // Each list starts with an empty build cache, like the engine (else an earlier list's layers show as CACHED).
  docker(['builder', 'prune', '-af']);
}

/**
 * Does the real daemon also publish ports on IPv6 ([::]:8080)? Hosts differ (GitHub's runners do;
 * this sandbox doesn't). The engine models both; the check runs it in the same mode as the real host.
 */
function realHasIpv6(): boolean {
  const name = `${PREFIX}v6probe`;
  docker(['rm', '-f', name]);
  const started = docker(['run', '-d', '--name', name, '-p', '18999:80', 'alpine:3.22', 'sleep', '30']);
  const port = started.code === 0 ? docker(['port', name]).out : '';
  docker(['rm', '-f', name]);
  return port.includes('[::]');
}
let REAL_IPV6: boolean | undefined;

/** Which build steps came from the cache, from BuildKit's plain output or the engine's events. */
function realBuildSteps(text: string): string {
  const names = new Map<string, { n: string; at: string }>();
  const cached = new Set<string>();
  for (const l of text.split('\n')) {
    const m = /^#(\d+) \[((?:[\w-]+ )?)(\d+)\/\d+\] (.*)$/.exec(l);
    if (m && !/^FROM /.test(m[4]!)) names.set(m[1]!, { n: m[4]!, at: `${m[2]}${m[3]!.padStart(3, '0')}` });
    const c = /^#(\d+) CACHED$/.exec(l);
    if (c) cached.add(c[1]!);
  }
  return [...names.entries()]
    .sort(([, x], [, y]) => (x.at < y.at ? -1 : 1))
    .map(([id, x]) => `${cached.has(id) ? 'CACHED ' : ''}${x.n}`)
    .join(' ; ');
}

/**
 * Build cache hits. On a fresh daemon (CI) they must match exactly. On a daemon that built the same
 * files before, BuildKit may also find a step the engine builds fresh: then only the engine's
 * cache hits must be hits on the real daemon too.
 */
function sameBuilds(engine: string[], real: string[]): boolean {
  if (engine.length !== real.length) return false;
  return engine.every((e, i) => {
    const es = e.split(' ; ');
    const rs = (real[i] ?? '').split(' ; ');
    if (es.length !== rs.length) return false;
    return es.every((step, j) => {
      const r = rs[j]!;
      if (step === r) return true;
      return !process.env.CI && !step.startsWith('CACHED ') && r === `CACHED ${step}`;
    });
  });
}

function knownNames(sc: KitchenScenario, seq: string[]): Set<string> {
  const all = [...seq, ...sc.steps.filter((x): x is string => typeof x === 'string')].join('\n');
  return new Set([...all.matchAll(/--name[ =]([\w.-]+)/g)].map((m) => m[1]!));
}

/** `docker images` on a shared daemon lists everyone's images: keep the rows the engine has. */
function imageRowFilter(cmd: string, engineRows: string[] | undefined): ((row: string) => boolean) | undefined {
  if (!/^docker images\b/.test(cmd) || !engineRows) return undefined;
  const names = new Set(engineRows.map((r) => r.split(' ')[0]));
  return (row) => names.has(row.trim().split(/\s+/)[0] ?? '');
}

/** Docker Hub's pull limit (429) on the real side: nothing to compare, but not a mistake in the engine. */
const RATE_LIMITED = '429 Too Many Requests';

function verifySequence(sc: KitchenScenario, seq: string[]): string[] | 'rateLimited' {
  const problems: string[] = [];
  let rateLimited = false;
  // Engine
  let state = kitchenStart(sc);
  REAL_IPV6 ??= realHasIpv6();
  if (REAL_IPV6) state = { ...state, host: { ...state.host, ipv6: true } };
  for (const step of sc.steps) state = kitchenStep(state, step, sc.id);
  const eOk: boolean[] = [];
  const eOut: Record<string, string[]> = {};
  const eBuilds: string[] = [];
  for (const [i, cmd] of seq.entries()) {
    const r = run(state, cmd);
    state = { ...r.state, session: null };
    eOk.push(r.ok);
    const text = plain(r.output);
    eOut[`${i}: ${cmd}`] = shaped(cmd, text, knownNames(sc, seq));
    if (/^docker (build|buildx build)\b/.test(cmd) && r.ok) eBuilds.push((state.lastBuild?.steps ?? []).map((s) => `${s.cached ? 'CACHED ' : ''}${s.instruction}`).join(' ; '));
  }
  const n = namesOf(state, [...seq, ...sc.steps.filter((x): x is string => typeof x === 'string')], sc);
  const a = engineSnapshot(state, eOk, eOut, eBuilds, n);
  // Real Docker
  cleanDaemon();
  const real = new Real(n, n.projects[0]);
  try {
    if (sc.cwd) {
      mkdirSync(real.map(sc.cwd), { recursive: true });
      real.cwd = real.map(sc.cwd);
    }
    for (const step of sc.steps) {
      if (typeof step === 'string') {
        const r = real.exec(step);
        if (!r.ok) problems.push(`real docker: setup step failed: ${step}\n${r.out}`);
      } else if ('write' in step) real.write(step.write, step.content);
      else if ('delete' in step) rmSync(real.map(step.delete), { force: true });
      else if ('wait' in step) sleep(Math.min(step.wait, 3));
    }
    const rOk: boolean[] = [];
    const rOut: Record<string, string[]> = {};
    const rBuilds: string[] = [];
    for (const [i, cmd] of seq.entries()) {
      const isBuild = /^docker (build|buildx build)\b/.test(cmd);
      const r = real.exec(isBuild ? cmd.replace(/^docker (buildx )?build/, 'docker build --progress=plain') : cmd);
      if (r.out.includes(RATE_LIMITED)) rateLimited = true; // scenarios with flag 'rateLimited' never run here
      if (!/^sleep\b/.test(cmd)) sleep(sc.settle ?? 1);
      rOk.push(r.ok);
      const filter = /^docker (volume|network) ls/.test(cmd) ? (row: string) => !/\b(bridge|host|none)\s+(bridge|host|null)\b/.test(row) && !/^local\s+[0-9a-f<]/.test(row) : undefined;
      rOut[`${i}: ${cmd}`] = shaped(cmd, r.out, knownNames(sc, seq), filter ?? imageRowFilter(cmd, a.outputs[`${i}: ${cmd}`]));
      if (isBuild && r.ok) rBuilds.push(realBuildSteps(r.out));
    }
    const b = real.snapshot(rOk, rOut, rBuilds);

    // The engine's volume ls: keep named volumes only (anonymous ones are compared by count elsewhere).
    for (const [k, v] of Object.entries(a.outputs)) if (/^\d+: docker volume ls/.test(k)) a.outputs[k] = [v[0] ?? '', ...v.slice(1).filter((row) => !/<id>$|<id>\b/.test(row))];
    for (const [k, v] of Object.entries(b.outputs)) if (/^\d+: docker volume ls/.test(k)) b.outputs[k] = [v[0] ?? '', ...v.slice(1).filter((row) => !/<id>$|<id>\b/.test(row))];
    for (const key of Object.keys(a) as (keyof Snapshot)[]) {
      if (key === 'builds') {
        if (!sameBuilds(a.builds, b.builds)) problems.push(`builds differ\n      engine: ${JSON.stringify(a.builds)}\n      docker: ${JSON.stringify(b.builds)}`);
        continue;
      }
      if (key === 'outputs') {
        for (const k of Object.keys(a.outputs)) {
          const x = JSON.stringify(a.outputs[k]);
          const y = JSON.stringify(b.outputs[k]);
          if (x !== y) problems.push(`output of "${k}" differs\n      engine: ${x}\n      docker: ${y}`);
        }
        continue;
      }
      const x = JSON.stringify(a[key]);
      const y = JSON.stringify(b[key]);
      if (x !== y) problems.push(`${key} differs\n      engine: ${x}\n      docker: ${y}`);
    }
  } finally {
    real.cleanup();
    cleanDaemon();
  }
  return rateLimited ? 'rateLimited' : problems;
}

const v = docker(['version', '--format', '{{.Server.Version}}']);
if (v.code !== 0) {
  console.error(`✗ No Docker daemon: ${v.err.trim()}`);
  process.exit(1);
}
console.log(`Real Docker Engine used: ${v.out.trim()} (course target: Docker Engine 29.x, Compose v5)`);
/** Split the work across parallel CI jobs: TRUTH_SHARD=2/3 runs every third list, starting with the second. */
const SHARD = /^(\d+)\/(\d+)$/.exec(process.env.TRUTH_SHARD ?? '');
let listIndex = 0;
const mine = () => !SHARD || listIndex++ % Number(SHARD[2]) === Number(SHARD[1]) - 1;

const only = process.env.VERIFY_ONLY;
const chosen = allScenarios.filter((s) => !only || s.id.startsWith(only));
const unsupported = (s: KitchenScenario) => s.steps.some((x) => typeof x === 'object' && ('busyPort' in x || 'account' in x || 'remoteImage' in x || 'flag' in x));
// Pre-pull what the scenarios use (once).
const need = new Set<string>(['alpine:3.22']);
for (const s of chosen) {
  for (const i of s.images ?? []) need.add(i);
  for (const seq of s.verify ?? []) for (const c of seq) for (const ref of Object.keys(CATALOG)) if (c.includes(ref)) need.add(ref);
  for (const st of s.steps) if (typeof st === 'object' && 'write' in st) for (const ref of Object.keys(CATALOG)) if (st.content.includes(ref)) need.add(ref);
  if ((s.verify ?? []).some((seq) => seq.some((c) => /hello-world/.test(c)))) need.add('hello-world:latest');
}
for (const ref of need) ensureImage(ref);

const failures: string[] = [];
const skipped: string[] = [];
let count = 0;
for (const s of chosen) {
  if (unsupported(s)) {
    console.log(`- ${s.id}: uses engine-only steps (busyPort, account, remoteImage, flag); checked in the engine tests only`);
    continue;
  }
  for (const seq of s.verify ?? []) {
    if (!mine()) continue;
    count++;
    const problems = verifySequence(s, seq);
    if (problems === 'rateLimited') {
      skipped.push(s.id);
      console.log(`! ${s.id}: ${seq.length} commands not compared: Docker Hub said 429 Too Many Requests (pull limit). Run again later.`);
    } else if (problems.length) failures.push(`✗ ${s.id}: [${seq.join(' ; ')}]\n    - ${problems.join('\n    - ')}`);
    else console.log(`✓ ${s.id}: ${seq.length} commands`);
  }
}
if (failures.length) {
  console.error(`\n${failures.join('\n\n')}\n\n✗ ${failures.length} of ${count} command lists differ from real Docker.`);
  process.exit(1);
}
console.log(`✓ ${count - skipped.length} command lists match real Docker.${skipped.length ? ` ${skipped.length} not compared (Docker Hub pull limit).` : ''}`);
