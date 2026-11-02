// What runs inside a container: the main process of each image, its logs, the ports it
// listens on and how it answers. Outputs were copied from the real images.
import { basename } from '../git-sim/paths';
import { VERSIONS } from './catalog';
import { imageOf, listC, mountFor, ownerOf, readC, uidOf, writeDeep } from './cfs';
import { accessTime, httpDate, nginxTime, pgTime, redisTime } from './format';
import { envMap } from './state';
import { HELLO, NGINX_403, NGINX_404, NGINX_ENTRY, NGINX_IPV6_OFF, NGINX_IPV6_ON, NODE_MISSING, NODE_MISSING_PACKAGE, PG_INIT_ERR, PG_INIT_OUT, PG_NO_PASSWORD, PG_OLD_PATH, PG_SHUTDOWN, PG_STARTUP } from './texts';
import { REDIS_LOG } from './texts-long';
import type { Container, KitchenState, Listener, LocalImage, Proc } from './types';

/** Where BusyBox applets and common tools live (for `which` and "exec /bin/cat: exec format error"). */
const USR_BIN = new Set(['env', 'head', 'id', 'nc', 'nslookup', 'printenv', 'tail', 'test', 'top', 'wc', 'wget', 'which', 'whoami', 'du', 'curl']);

export function binPath(img: LocalImage, name: string): string | null {
  if (name.includes('/')) {
    if (Object.hasOwn(img.files, name)) return name;
    const b = basename(name);
    if (name === `/docker-entrypoint.sh` && img.kind === 'nginx') return name;
    if (name === '/hello' && img.kind === 'hello') return name;
    if (img.bins.includes(b) && /^\/(usr\/)?(local\/)?s?bin\//.test(name)) return name;
    return null;
  }
  if (name === 'docker-entrypoint.sh' && ['node', 'postgres', 'redis'].includes(img.kind)) return '/usr/local/bin/docker-entrypoint.sh';
  if (!img.bins.includes(name)) return null;
  if (img.kind === 'busybox') return `/bin/${name}`;
  if (['node', 'npm', 'npx', 'yarn', 'python', 'python3', 'pip', 'pip3', 'redis-server', 'redis-cli', 'postgres', 'psql', 'pg_isready', 'initdb', 'pg_dump'].includes(name)) {
    return `/usr/local/bin/${name}`;
  }
  if (name === 'nginx') return '/usr/sbin/nginx';
  if (name === 'apk') return '/sbin/apk';
  if (name === 'bash') return '/usr/bin/bash';
  if (name === 'apt-get' || name === 'apt') return `/usr/bin/${name}`;
  if (img.kind === 'python' || img.kind === 'debian' || img.repoTags.some((t) => t.includes('nginx:latest'))) return `/usr/bin/${name}`;
  return USR_BIN.has(name) ? `/usr/bin/${name}` : `/bin/${name}`;
}

/** The command a container runs: entrypoint + cmd. */
export function argvOf(c: Container): string[] {
  return [...c.entrypoint, ...c.cmd];
}

export function addLogs(c: Container, t: number, s: 'o' | 'e', text: string | string[]): void {
  const list = Array.isArray(text) ? text : text.split('\n');
  for (const l of list) c.logs.push({ t, s, text: l });
}

function nginxVersion(img: LocalImage | null): string {
  const env = envMap(img?.config.Env ?? []);
  return env.NGINX_VERSION ?? VERSIONS.nginx['1.30-alpine']!;
}

export interface Launch {
  /** The container stops at once with this code (a command that just runs and ends). */
  exitNow?: number;
  /** Docker could not start the process at all (runc error); the container stays "Created". */
  startError?: string;
  startCode?: number;
}

const NOT_FOUND = (name: string) =>
  `failed to create task for container: failed to create shim task: OCI runtime create failed: runc create failed: unable to start container process: error during container init: exec: "${name}": executable file not found in $PATH`;

/**
 * Start the main process. Mutates the (cloned) container: logs, proc, files.
 * `runShell` runs a one-off shell command line inside the container (for `echo hi`, `sh -c ...`).
 */
export function launch(
  state: KitchenState,
  c: Container,
  runShell: (script: string, c: Container) => { out: string[]; err: string[]; code: number; daemon?: Proc },
): Launch {
  const img = imageOf(state, c);
  const t = state.clock;
  if (!img) return { startError: 'No such image', startCode: 125 };
  let argv = argvOf(c);
  if (!argv.length) return { startError: 'no command specified', startCode: 125 };
  const first = binPath(img, argv[0]!);
  // Wrong CPU type: the kernel refuses to run the program at all.
  const plat = c.platform || img.platform;
  if (plat.split('/')[1] !== state.host.platform.split('/')[1]) {
    const shown = first ?? (argv[0]!.startsWith('/') ? argv[0]! : `/bin/${argv[0]}`);
    addLogs(c, t, 'e', `exec ${shown}: exec format error`);
    c.proc = null;
    return { exitNow: 255 };
  }
  if (!first) return { startError: NOT_FOUND(argv[0]!), startCode: 127 };
  const env = envMap(c.env);
  const user = c.user || img.config.User || 'root';

  // Entrypoint scripts of the official images.
  let nginxEntry = false;
  if (img.kind === 'nginx' && argv[0] === '/docker-entrypoint.sh') {
    argv = argv.slice(1);
    if (argv[0] === 'nginx' || argv[0] === 'nginx-debug') nginxEntry = true;
    if (!argv.length) return { exitNow: 0 };
  } else if (basename(argv[0]!) === 'docker-entrypoint.sh') {
    argv = argv.slice(1);
    if (img.kind === 'postgres' && (!argv.length || argv[0]!.startsWith('-'))) argv = ['postgres', ...argv];
    else if (img.kind === 'redis' && (!argv.length || argv[0]!.startsWith('-') || argv[0]!.endsWith('.conf'))) argv = ['redis-server', ...argv];
    else if (img.kind === 'node' && (!argv.length || argv[0]!.startsWith('-') || !binPath(img, argv[0]!))) argv = ['node', ...argv];
    if (!argv.length) return { exitNow: 0 };
    if (!binPath(img, argv[0]!) && !(img.kind === 'node' && argv[0] === 'node')) return { startError: NOT_FOUND(argv[0]!), startCode: 127 };
  }
  const prog = basename(argv[0]!);
  const base: Proc = { kind: 'shell', argv, user, listeners: [], stopCode: 137, stopKills: true };

  if (prog === 'hello') {
    addLogs(c, t, 'o', HELLO.replace(/\n$/, ''));
    c.proc = { ...base, kind: 'hello' };
    return { exitNow: 0 };
  }

  if (prog === 'nginx') {
    const v = nginxVersion(img);
    if (nginxEntry) {
      for (const l of NGINX_ENTRY) {
        if (l === 'IPV6') addLogs(c, t, 'o', state.host.ipv6 ? NGINX_IPV6_ON : [NGINX_IPV6_OFF]);
        else addLogs(c, t, 'o', l);
      }
    }
    const nt = nginxTime(t);
    // Least privilege, as root (checked on Docker 29.9 with nginx:1.30-alpine): nginx must write
    // /var/cache/nginx and /run/nginx.pid, and chown its cache folder before anything else.
    if (user === 'root' || user === '0') {
      const writable = (p: string) => {
        const m = mountFor(c, p);
        return m ? !m.mount.readOnly : !c.readOnly;
      };
      const caps = (l: string[]) => l.map((x) => x.replace(/^CAP_/, ''));
      const dropped = caps(c.capDrop);
      const added = caps(c.capAdd);
      const noChown = (dropped.includes('ALL') || dropped.includes('CHOWN')) && !added.includes('CHOWN') && !added.includes('ALL');
      const why = !writable('/var/cache/nginx/client_temp')
        ? 'mkdir() "/var/cache/nginx/client_temp" failed (30: Read-only file system)'
        : noChown
          ? 'chown("/var/cache/nginx/client_temp", 101) failed (1: Operation not permitted)'
          : null;
      if (why) {
        addLogs(c, t, 'e', [`${nt} [emerg] 1#1: ${why}`, `nginx: [emerg] ${why}`]);
        return { exitNow: 1 };
      }
    }
    // The pid file is written after the first notices (up to getrlimit).
    const pidFail = (user === 'root' || user === '0') && (() => {
      const m = mountFor(c, '/run/nginx.pid');
      return m ? m.mount.readOnly : c.readOnly;
    })();
    const lines = [
      `${nt} [notice] 1#1: using the "epoll" event method`,
      `${nt} [notice] 1#1: nginx/${v}`,
      img.repoTags.some((r) => r.includes('nginx:latest')) || img.files['/etc/os-release']?.includes('debian')
        ? `${nt} [notice] 1#1: built by gcc 14.2.0 (Debian 14.2.0-19) `
        : `${nt} [notice] 1#1: built by gcc 15.2.0 (Alpine 15.2.0) `,
      `${nt} [notice] 1#1: OS: Linux ${state.host.kernel}`,
      `${nt} [notice] 1#1: getrlimit(RLIMIT_NOFILE): 1048576:1048576`,
    ];
    const workers = [`${nt} [notice] 1#1: start worker processes`];
    for (let i = 0; i < state.host.cpus; i++) workers.push(`${nt} [notice] 1#1: start worker process ${20 + i}`);
    // Run as a non-root user (USER nginx, -u 101): nginx needs to write /var/cache/nginx and
    // /run/nginx.pid, which root owns in the official image (checked on Docker 29.9). Port 80 is fine:
    // Docker lets non-root processes open low ports inside a container (ip_unprivileged_port_start=0).
    const nonRoot = user !== 'root' && user !== '0';
    const uid = nonRoot ? (uidOf(state, c, user) ?? -1) : 0;
    const emerg = (what: string) => {
      addLogs(c, t, 'e', [`${nt} [emerg] 1#1: ${what} failed (13: Permission denied)`, `nginx: [emerg] ${what} failed (13: Permission denied)`]);
      return { exitNow: 1 };
    };
    if (nonRoot) {
      const warn = 'the "user" directive makes sense only if the master process runs with super-user privileges, ignored in /etc/nginx/nginx.conf:2';
      addLogs(c, t, 'e', [`${nt} [warn] 1#1: ${warn}`, `nginx: [warn] ${warn}`]);
      if (ownerOf(state, c, '/var/cache/nginx') !== uid) return emerg('mkdir() "/var/cache/nginx/client_temp"');
    }
    addLogs(c, t, 'e', lines);
    if (pidFail) {
      const why = 'open() "/run/nginx.pid" failed (30: Read-only file system)';
      addLogs(c, t, 'e', [`${nt} [emerg] 1#1: ${why}`, `nginx: [emerg] ${why}`]);
      return { exitNow: 1 };
    }
    if (nonRoot && ownerOf(state, c, '/run/nginx.pid') !== uid) return emerg('open() "/run/nginx.pid"');
    addLogs(c, t, 'e', workers);
    const conf = readC(state, c, '/etc/nginx/conf.d/default.conf');
    const port = typeof conf === 'string' ? Number(/listen\s+(\d+)/.exec(conf)?.[1] ?? 80) : 80;
    c.proc = { ...base, kind: 'nginx', listeners: [{ port, host: '0.0.0.0', kind: 'nginx' }], stopCode: 0, stopKills: false };
    return {};
  }

  if (prog === 'postgres') return launchPostgres(state, c, base, env);

  if (prog === 'redis-server') {
    const rt = redisTime(t, 647);
    addLogs(c, t, 'o', REDIS_LOG.filter((l) => state.host.ipv6 === false || !l.includes('errno: 97')).map((l) => l.replaceAll('{t}', rt)));
    c.proc = { ...base, kind: 'redis', listeners: [{ port: 6379, host: '0.0.0.0', kind: 'redis' }], stopCode: 0, stopKills: false };
    return {};
  }

  if (prog === 'node') return launchNode(state, c, base, argv, env);
  if (prog === 'npm') return launchNpm(state, c, base, argv, env, runShell);
  if (prog === 'python' || prog === 'python3') return launchPython(state, c, base, argv, env);

  if (prog === 'sleep' || (prog === 'tail' && argv.includes('-f'))) {
    const n = prog === 'sleep' ? argv[1] : 'infinity';
    c.proc = { ...base, kind: 'sleep' };
    if (n !== 'infinity') {
      const secs = Number(n);
      if (!Number.isFinite(secs)) {
        addLogs(c, t, 'e', `sleep: invalid number '${n}'`);
        return { exitNow: 1 };
      }
      c.proc.exitAfter = secs;
      c.proc.exitCode = 0;
    }
    return {};
  }

  if ((prog === 'sh' || prog === 'ash' || prog === 'bash') && argv.length === 1) {
    // A shell with no script: it reads commands. Without -i it gets end-of-file and ends.
    if (c.interactive || c.tty) {
      c.proc = { ...base, kind: 'shell', interactive: true };
      return {};
    }
    return { exitNow: 0 };
  }

  // Anything else: run it once through the container's shell (echo, ls, sh -c "...", ...).
  const script =
    (prog === 'sh' || prog === 'ash' || prog === 'bash') && argv[1] === '-c' ? (argv[2] ?? '') : argv.map((a) => (/[\s"'$]/.test(a) ? `'${a.replace(/'/g, "'\\''")}'` : a)).join(' ');
  const r = runShell(script, c);
  addLogs(c, t, 'o', r.out);
  addLogs(c, t, 'e', r.err);
  if (r.daemon) {
    c.proc = r.daemon;
    return {};
  }
  c.proc = { ...base, kind: 'exited' };
  return { exitNow: r.code };
}

function launchPostgres(state: KitchenState, c: Container, base: Proc, env: Record<string, string>): Launch {
  const t = state.clock;
  const ms = (n: number) => pgTime(t, n);
  if (c.mounts.some((m) => m.target === '/var/lib/postgresql/data')) {
    addLogs(c, t, 'e', PG_OLD_PATH);
    return { exitNow: 1 };
  }
  const pgdata = env.PGDATA ?? '/var/lib/postgresql/18/docker';
  const initialized = readC(state, c, `${pgdata}/PG_VERSION`) !== null;
  if (!initialized) {
    if (!env.POSTGRES_PASSWORD && env.POSTGRES_HOST_AUTH_METHOD !== 'trust') {
      addLogs(c, t, 'e', PG_NO_PASSWORD);
      return { exitNow: 1 };
    }
    // initdb writes the cluster into PGDATA (a volume, if one is mounted there).
    const files: Record<string, string> = {
      PG_VERSION: '18\n',
      'pg_hba.conf': '',
      'pg_ident.conf': '',
      'postgresql.auto.conf': '',
      'postgresql.conf': '',
      'postmaster.opts': '',
      'postmaster.pid': '',
      'base/1/PG_VERSION': '18\n',
      'global/pg_control': '',
      'pg_wal/000000010000000000000001': '',
    };
    for (const d of ['pg_commit_ts', 'pg_dynshmem', 'pg_logical', 'pg_multixact', 'pg_notify', 'pg_replslot', 'pg_serial', 'pg_snapshots', 'pg_stat', 'pg_stat_tmp', 'pg_subtrans', 'pg_tblspc', 'pg_twophase', 'pg_xact']) {
      files[`${d}/.keep`] = '';
    }
    for (const [rel, content] of Object.entries(files)) writeDeep(state, c, `${pgdata}/${rel}`, content, 0);
    addLogs(c, t, 'o', PG_INIT_OUT.replace(/\n$/, '').split('\n'));
    addLogs(c, t, 'e', PG_INIT_ERR.map((l) => l.replace('{t}', ms(51))));
    addLogs(c, t, 'o', [
      '',
      `waiting for server to start....${ms(838)} UTC [46] LOG:  starting PostgreSQL 18.6 on x86_64-pc-linux-musl, compiled by gcc (Alpine 15.2.0) 15.2.0, 64-bit`,
      `${ms(841)} UTC [46] LOG:  listening on Unix socket "/var/run/postgresql/.s.PGSQL.5432"`,
      `${ms(845)} UTC [52] LOG:  database system was shut down at ${pgTime(t).slice(0, 19)} UTC`,
      `${ms(850)} UTC [46] LOG:  database system is ready to accept connections`,
      ' done',
      'server started',
      '',
      '/usr/local/bin/docker-entrypoint.sh: ignoring /docker-entrypoint-initdb.d/*',
      '',
      `waiting for server to shut down....${ms(906)} UTC [46] LOG:  received fast shutdown request`,
      `${ms(907)} UTC [46] LOG:  aborting any active transactions`,
      `${ms(914)} UTC [46] LOG:  background worker "logical replication launcher" (PID 55) exited with exit code 1`,
      `${ms(914)} UTC [50] LOG:  shutting down`,
      `${ms(915)} UTC [50] LOG:  checkpoint starting: shutdown immediate`,
      `${ms(917)} UTC [50] LOG:  checkpoint complete: wrote 0 buffers (0.0%), wrote 3 SLRU buffers; 0 WAL file(s) added, 0 removed, 0 recycled; write=0.001 s, sync=0.001 s, total=0.004 s; sync files=2, longest=0.001 s, average=0.001 s; distance=0 kB, estimate=0 kB; lsn=0/1765F90, redo lsn=0/1765F90`,
      `${ms(929)} UTC [46] LOG:  database system is shut down`,
      ' done',
      'server stopped',
      '',
      'PostgreSQL init process complete; ready for start up.',
      '',
    ]);
    const t1 = pgTime(t + 1, 197);
    addLogs(c, t + 1, 'e', [
      ...PG_STARTUP(t1, state.host.ipv6),
      `${pgTime(t + 1, 229)} UTC [66] LOG:  database system was shut down at ${pgTime(t).slice(0, 19)} UTC`,
      `${pgTime(t + 1, 237)} UTC [1] LOG:  database system is ready to accept connections`,
    ]);
  } else {
    addLogs(c, t, 'o', ['', 'PostgreSQL Database directory appears to contain a database; Skipping initialization', '']);
    const t1 = pgTime(t, 231);
    // postmaster.pid is still there when the last server was killed (docker kill / rm -f).
    const killed = readC(state, c, `${pgdata}/postmaster.pid`) !== null;
    addLogs(c, t, 'e', [
      ...PG_STARTUP(t1, state.host.ipv6),
      ...(killed
        ? [
            `${pgTime(t, 236)} UTC [32] LOG:  database system was interrupted; last known up at ${pgTime(t - 60).slice(0, 19)} UTC`,
            `${pgTime(t, 274)} UTC [32] LOG:  database system was not properly shut down; automatic recovery in progress`,
            `${pgTime(t, 275)} UTC [32] LOG:  invalid record length at 0/1766020: expected at least 24, got 0`,
            `${pgTime(t, 275)} UTC [32] LOG:  redo is not required`,
            `${pgTime(t, 276)} UTC [30] LOG:  checkpoint starting: end-of-recovery immediate wait`,
            `${pgTime(t, 278)} UTC [30] LOG:  checkpoint complete: wrote 0 buffers (0.0%), wrote 3 SLRU buffers; 0 WAL file(s) added, 0 removed, 0 recycled; write=0.001 s, sync=0.001 s, total=0.003 s; sync files=2, longest=0.001 s, average=0.001 s; distance=0 kB, estimate=0 kB; lsn=0/1766020, redo lsn=0/1766020`,
          ]
        : [`${pgTime(t, 236)} UTC [32] LOG:  database system was shut down at ${pgTime(t - 60).slice(0, 19)} UTC`]),
      `${pgTime(t, 281)} UTC [1] LOG:  database system is ready to accept connections`,
    ]);
  }
  writeDeep(state, c, `${pgdata}/postmaster.pid`, '1\n', 0);
  c.proc = { ...base, kind: 'postgres', user: 'postgres', listeners: [{ port: 5432, host: '0.0.0.0', kind: 'postgres' }], stopCode: 0, stopKills: false };
  return {};
}

/** Pull simple facts out of a tiny Node.js server file (enough for lesson apps). */
export function readNodeApp(src: string, env: Record<string, string>): { port: number | null; host: '0.0.0.0' | '127.0.0.1'; logs: string[]; reply: Proc['reply']; requires: string[]; exit: number | null } {
  const portVar = /const\s+(\w+)\s*=\s*(?:Number\()?process\.env\.(\w+)\)?\s*\|\|\s*(\d+)/.exec(src);
  const portFromVar = portVar ? Number(env[portVar[2]!] ?? portVar[3]) : null;
  const listen = /\.listen\(\s*([^,)\s]+)\s*(?:,\s*['"]([^'"]+)['"])?/.exec(src);
  let port: number | null = null;
  if (listen) {
    const arg = listen[1]!;
    if (/^\d+$/.test(arg)) port = Number(arg);
    else if (portVar && arg === portVar[1]) port = portFromVar;
    else {
      const m = new RegExp(`const\\s+${arg}\\s*=\\s*(\\d+)`).exec(src);
      port = m ? Number(m[1]) : 3000;
    }
  }
  const hostArg = listen?.[2];
  const host = hostArg === '127.0.0.1' || hostArg === 'localhost' ? '127.0.0.1' : '0.0.0.0';
  const logs: string[] = [];
  for (const m of src.matchAll(/console\.log\(\s*(`[^`]*`|'[^']*'|"[^"]*")\s*\)/g)) {
    const raw = m[1]!.slice(1, -1);
    logs.push(raw.replace(/\$\{\s*(\w+)\s*\}/g, (_, v: string) => (portVar && v === portVar[1] ? String(portFromVar) : v === 'port' || v === 'PORT' ? String(port) : '')));
  }
  let reply: Proc['reply'] = { status: 200, type: 'text/html', body: '' };
  const json = /(?:\b\w+\.end\(\s*JSON\.stringify\(|\b\w+\.json\(|\b\w+\.send\()\s*(\{[^)]*\})\s*\)/.exec(src);
  const text = /\b\w+\.(?:end|send)\(\s*(['"`])([\s\S]*?)\1\s*\)/.exec(src);
  if (json) {
    try {
      const body = json[1]!
        .replace(/'([^']*)'/g, '"$1"')
        .replace(/([{,]\s*)([A-Za-z_]\w*)\s*:/g, '$1"$2":');
      reply = { status: 200, type: 'application/json', body: JSON.stringify(JSON.parse(body)) };
    } catch {
      reply = { status: 200, type: 'application/json', body: '{}' };
    }
  } else if (text) {
    reply = { status: 200, type: 'text/html', body: text[2]!.replace(/\\n/g, '\n') };
  }
  const requires = [...src.matchAll(/require\(\s*['"]([^'"./][^'"]*)['"]\s*\)/g)].map((m) => m[1]!).filter((r) => !r.startsWith('node:') && !['http', 'fs', 'path', 'os', 'url'].includes(r));
  const exitM = /process\.exit\(\s*(\d+)\s*\)/.exec(src);
  return { port, host, logs, reply, requires, exit: exitM ? Number(exitM[1]) : null };
}

function launchNode(state: KitchenState, c: Container, base: Proc, argv: string[], env: Record<string, string>): Launch {
  const t = state.clock;
  const args = argv.slice(1);
  if (args[0] === '--version' || args[0] === '-v') {
    addLogs(c, t, 'o', VERSIONS.node);
    return { exitNow: 0 };
  }
  if (args[0] === '-e' || args[0] === '-p' || args[0] === '--eval') {
    const r = evalJs(args[1] ?? '');
    if (r.out !== null) addLogs(c, t, 'o', r.out);
    if (r.err) addLogs(c, t, 'e', r.err);
    return { exitNow: r.err ? 1 : 0 };
  }
  if (args[0] === '--test') return nodeTest(state, c);
  if (!args.length) {
    if (c.interactive || c.tty) {
      c.proc = { ...base, kind: 'node', interactive: true };
      return {};
    }
    return { exitNow: 0 };
  }
  const file = args.find((a) => !a.startsWith('-'))!;
  const abs = file.startsWith('/') ? file : `${c.workdir === '/' ? '' : c.workdir}/${file}`;
  const src = readC(state, c, abs);
  if (typeof src !== 'string') {
    addLogs(c, t, 'e', NODE_MISSING(abs.replace(/\/+/g, '/'), VERSIONS.node));
    return { exitNow: 1 };
  }
  const app = readNodeApp(src, env);
  for (const pkg of app.requires) {
    const dir = `${c.workdir === '/' ? '' : c.workdir}/node_modules/${pkg}`;
    if (readC(state, c, dir) !== 'dir') {
      addLogs(c, t, 'e', NODE_MISSING_PACKAGE(pkg, abs, VERSIONS.node));
      return { exitNow: 1 };
    }
  }
  addLogs(c, t, 'o', app.logs);
  if (app.exit !== null || app.port === null) return { exitNow: app.exit ?? 0 };
  c.proc = { ...base, kind: 'node', listeners: [{ port: app.port, host: app.host, kind: 'app' }], reply: app.reply, stopCode: 137, stopKills: true };
  return {};
}

function launchNpm(
  state: KitchenState,
  c: Container,
  base: Proc,
  argv: string[],
  env: Record<string, string>,
  runShell: (script: string, c: Container) => { out: string[]; err: string[]; code: number; daemon?: Proc },
): Launch {
  const t = state.clock;
  const sub = argv[1];
  if (sub === '--version' || sub === '-v') {
    addLogs(c, t, 'o', VERSIONS.npm);
    return { exitNow: 0 };
  }
  const pkgPath = `${c.workdir === '/' ? '' : c.workdir}/package.json`;
  const pkgSrc = readC(state, c, pkgPath);
  const isTest = sub === 'test' || sub === 't' || sub === 'tst';
  if (sub === 'start' || sub === 'run' || isTest) {
    const script = sub === 'start' ? 'start' : isTest ? 'test' : argv[2];
    let pkg: { name?: string; version?: string; scripts?: Record<string, string> };
    try {
      pkg = typeof pkgSrc === 'string' ? JSON.parse(pkgSrc) : {};
    } catch {
      pkg = {};
    }
    const cmd = pkg.scripts?.[script ?? ''] ?? (script === 'start' ? 'node server.js' : undefined);
    if (!cmd) {
      addLogs(c, t, 'e', [`npm error Missing script: "${script}"`, 'npm error', 'npm error To see a list of scripts, run:', 'npm error   npm run']);
      return { exitNow: 1 };
    }
    addLogs(c, t, 'o', ['', `> ${pkg.name ?? 'app'}@${pkg.version ?? '1.0.0'} ${script}`, `> ${cmd}`, '']);
    const words = cmd.split(/\s+/);
    if (words[0] === 'node') {
      const r = launchNode(state, c, base, words, env);
      if (c.proc?.kind === 'node') c.proc.argv = argv;
      return r;
    }
    const r = runShell(cmd, c);
    addLogs(c, t, 'o', r.out);
    addLogs(c, t, 'e', r.err);
    if (r.daemon) {
      c.proc = r.daemon;
      return {};
    }
    return { exitNow: r.code };
  }
  if (sub === 'ci' || sub === 'install' || sub === 'i') {
    const r = runShell(argv.join(' '), c);
    addLogs(c, t, 'o', r.out);
    addLogs(c, t, 'e', r.err);
    return { exitNow: r.code };
  }
  // Anything else: npm 11's own answer (checked on node:24-alpine). Never hand it back to the shell,
  // which would call npm again and loop forever.
  addLogs(c, t, 'o', [`Unknown command: "${sub ?? ''}"`, '', 'To see a list of supported npm commands, run:', '  npm help']);
  return { exitNow: 1 };
}

/** Files `node --test` picks up by default (Node 24): *.test.js, *-test.js, *_test.js, test-*.js, test.js, test/**. */
const NODE_TEST_FILE = /(^|\/)([^/]*[.\-_]test|test-[^/]*|test)\.[cm]?js$|\/test\/(.+\/)?[^/]+\.[cm]?js$/;

function nodeTestFiles(state: KitchenState, c: Container, dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string, depth: number) => {
    if (depth > 8) return;
    for (const e of listC(state, c, d) ?? []) {
      const p = d === '/' ? `/${e.name}` : `${d}/${e.name}`;
      if (e.isDir) {
        if (e.name !== 'node_modules' && !e.name.startsWith('.')) walk(p, depth + 1);
      } else if (NODE_TEST_FILE.test(p)) out.push(p);
    }
  };
  walk(dir, 0);
  return out;
}

/** `node --test`: with no test files, Node 24 prints an empty summary and exits 0 (checked on node:24-alpine). */
function nodeTest(state: KitchenState, c: Container): Launch {
  const t = state.clock;
  if (nodeTestFiles(state, c, c.workdir || '/').length) {
    addLogs(c, t, 'o', ["This practice kitchen can't run test files. Run them on your own machine."]);
    return { exitNow: 0 };
  }
  const info = '\u2139';
  addLogs(c, t, 'o', ['tests 0', 'suites 0', 'pass 0', 'fail 0', 'cancelled 0', 'skipped 0', 'todo 0', 'duration_ms 24.731562'].map((l) => `${info} ${l}`));
  return { exitNow: 0 };
}

function launchPython(state: KitchenState, c: Container, base: Proc, argv: string[], env: Record<string, string>): Launch {
  const t = state.clock;
  const args = argv.slice(1).filter((a) => a !== '-u');
  const unbuffered = argv.includes('-u') || Boolean(env.PYTHONUNBUFFERED) || c.tty;
  if (args[0] === '--version' || args[0] === '-V') {
    addLogs(c, t, 'o', `Python ${VERSIONS.python}`);
    return { exitNow: 0 };
  }
  if (args[0] === '-c') {
    const r = evalPy(args[1] ?? '');
    if (r.out !== null) addLogs(c, t, 'o', r.out);
    if (r.err) addLogs(c, t, 'e', r.err);
    return { exitNow: r.err ? 1 : 0 };
  }
  if (args[0] === '-m' && args[1] === 'http.server') {
    const port = Number(args.slice(2).find((a) => /^\d+$/.test(a)) ?? 8000);
    const bindIdx = args.indexOf('--bind');
    const host = bindIdx >= 0 && (args[bindIdx + 1] === '127.0.0.1' || args[bindIdx + 1] === 'localhost') ? '127.0.0.1' : '0.0.0.0';
    // stdout is block-buffered without a TTY: this line only shows up with -u or PYTHONUNBUFFERED=1.
    if (unbuffered) addLogs(c, t, 'o', `Serving HTTP on ${host} port ${port} (http://${host}:${port}/) ...`);
    c.proc = { ...base, kind: 'python', listeners: [{ port, host, kind: 'python-http' }], stopCode: 137, stopKills: true };
    return {};
  }
  if (!args.length) {
    if (c.interactive || c.tty) {
      c.proc = { ...base, kind: 'python', interactive: true };
      return {};
    }
    return { exitNow: 0 };
  }
  const file = args[0]!;
  const abs = file.startsWith('/') ? file : `${c.workdir}/${file}`;
  const src = readC(state, c, abs);
  if (typeof src !== 'string') {
    addLogs(c, t, 'e', `python: can't open file '${abs}': [Errno 2] No such file or directory`);
    return { exitNow: 2 };
  }
  const prints = [...src.matchAll(/print\(\s*(?:f?)(['"])([^'"]*)\1\s*\)/g)].map((m) => m[2]!);
  const server = /HTTPServer\(\s*\(\s*['"]([^'"]*)['"]\s*,\s*(\d+)\s*\)/.exec(src) ?? /TCPServer\(\s*\(\s*['"]([^'"]*)['"]\s*,\s*(\d+)\s*\)/.exec(src);
  if (server) {
    if (unbuffered) addLogs(c, t, 'o', prints);
    const host = server[1] === '127.0.0.1' || server[1] === 'localhost' ? '127.0.0.1' : '0.0.0.0';
    c.proc = { ...base, kind: 'python', listeners: [{ port: Number(server[2]), host, kind: 'python-http' }], stopCode: 137, stopKills: true };
    return {};
  }
  addLogs(c, t, 'o', prints);
  return { exitNow: 0 };
}

/** A very small JavaScript evaluator for `node -e`: console.log of numbers, strings and sums. */
export function evalJs(code: string): { out: string | null; err: string | null } {
  const m = /^\s*console\.log\(([\s\S]*)\)\s*;?\s*$/.exec(code);
  const expr = m ? m[1]! : code;
  const v = simpleValue(expr.trim(), 'js');
  if (v === undefined) return { out: m ? 'undefined' : null, err: null };
  return { out: m ? v : null, err: null };
}

export function evalPy(code: string): { out: string | null; err: string | null } {
  const m = /^\s*print\(([\s\S]*)\)\s*$/.exec(code);
  if (!m) return { out: null, err: null };
  const inner = m[1]!.trim();
  if (/\/\s*0\b/.test(inner)) {
    return { out: null, err: `Traceback (most recent call last):\n  File "<string>", line 1, in <module>\n    ${code.trim()}\n${' '.repeat(10)}~^~\nZeroDivisionError: division by zero` };
  }
  const v = simpleValue(inner, 'py');
  return { out: v ?? '', err: null };
}

/** Numbers, strings, + - * / and a few names (process.version, sys.version). */
function simpleValue(expr: string, lang: 'js' | 'py'): string | undefined {
  if (lang === 'js' && expr === 'process.version') return VERSIONS.node;
  if (lang === 'js' && expr === 'process.platform') return 'linux';
  if (lang === 'js' && expr === 'process.arch') return 'x64';
  const str = /^(['"`])([^'"`]*)\1$/.exec(expr);
  if (str) return str[2];
  if (/^[\d\s+\-*/().]+$/.test(expr)) {
    const n = arithmetic(expr);
    if (n === undefined) return undefined;
    if (lang === 'py' && /\//.test(expr) && Number.isFinite(n)) return Number.isInteger(n) ? `${n}.0` : String(n);
    return String(n);
  }
  const concat = expr.split('+').map((p) => p.trim());
  if (concat.length > 1 && concat.every((p) => /^(['"])[^'"]*\1$/.test(p) || /^\d+$/.test(p))) {
    return concat.map((p) => p.replace(/^['"]|['"]$/g, '')).join('');
  }
  return undefined;
}

/** + - * / and brackets on numbers (a tiny recursive-descent parser; no eval). */
export function arithmetic(src: string): number | undefined {
  const toks = src.match(/\d+(?:\.\d+)?|[+\-*/()]/g) ?? [];
  let i = 0;
  const peek = () => toks[i];
  const factor = (): number | undefined => {
    const tok = toks[i++];
    if (tok === '(') {
      const v = expr();
      if (toks[i++] !== ')') return undefined;
      return v;
    }
    if (tok === '-') {
      const v = factor();
      return v === undefined ? undefined : -v;
    }
    return tok !== undefined && /^\d/.test(tok) ? Number(tok) : undefined;
  };
  const term = (): number | undefined => {
    let v = factor();
    while (v !== undefined && (peek() === '*' || peek() === '/')) {
      const op = toks[i++];
      const r = factor();
      if (r === undefined) return undefined;
      v = op === '*' ? v * r : v / r;
    }
    return v;
  };
  const expr = (): number | undefined => {
    let v = term();
    while (v !== undefined && (peek() === '+' || peek() === '-')) {
      const op = toks[i++];
      const r = term();
      if (r === undefined) return undefined;
      v = op === '+' ? v + r : v - r;
    }
    return v;
  };
  const v = expr();
  return i === toks.length ? v : undefined;
}

// ---------------------------------------------------------------------------
// Answering requests

export interface HttpReq {
  method: 'GET' | 'HEAD';
  path: string;
  /** Who connects, as the container sees it (the bridge gateway for the laptop). */
  client: string;
  ua: string;
  host: string;
}

export interface HttpRes {
  proto?: 'HTTP/1.0' | 'HTTP/1.1';
  status: number;
  reason: string;
  headers: [string, string][];
  body: string;
}

const REASON: Record<number, string> = { 200: 'OK', 403: 'Forbidden', 404: 'Not Found', 500: 'Internal Server Error' };

/** An HTTP answer from a container's listener. `null` = the program isn't an HTTP server. */
export function serve(state: KitchenState, c: Container, l: Listener, req: HttpReq): HttpRes | null {
  const t = state.clock;
  const img = imageOf(state, c);
  if (l.kind === 'nginx') {
    const v = nginxVersion(img);
    const conf = readC(state, c, '/etc/nginx/conf.d/default.conf');
    const root = (typeof conf === 'string' && /root\s+([^;\s]+);/.exec(conf)?.[1]) || '/usr/share/nginx/html';
    let path = decodeURIComponent(req.path.split('?')[0] || '/');
    if (path.endsWith('/')) path += 'index.html';
    const file = `${root}${path}`;
    const body = readC(state, c, file);
    let res: HttpRes;
    if (typeof body === 'string') {
      const size = new TextEncoder().encode(body).length;
      const mtime = file.endsWith('/index.html') && body.includes('Welcome to nginx!') ? 0x6abfe677 : c.startedAt ?? t;
      res = {
        status: 200,
        reason: 'OK',
        headers: [
          ['Server', `nginx/${v}`],
          ['Date', httpDate(t)],
          ['Content-Type', mimeOf(file)],
          ['Content-Length', String(size)],
          ['Last-Modified', httpDate(mtime)],
          ['Connection', 'keep-alive'],
          ['ETag', `"${mtime.toString(16)}-${size.toString(16)}"`],
          ['Accept-Ranges', 'bytes'],
        ],
        body,
      };
    } else {
      const status = body === 'dir' ? 403 : 404;
      const page = status === 404 ? NGINX_404(v) : NGINX_403(v);
      res = {
        status,
        reason: REASON[status]!,
        headers: [
          ['Server', `nginx/${v}`],
          ['Date', httpDate(t)],
          ['Content-Type', 'text/html'],
          // nginx sends its error pages with CRLF line ends (153 bytes for a 1.30 404), the text here has LF.
          ['Content-Length', String(page.length + (page.match(/\n/g)?.length ?? 0))],
          ['Connection', 'keep-alive'],
        ],
        body: page,
      };
      const nt = nginxTime(t);
      const why = status === 404 ? `open() "${file}" failed (2: No such file or directory)` : `directory index of "${file.replace(/index\.html$/, '')}" is forbidden`;
      addLogs(c, t, 'e', `${nt} [error] 20#20: *${c.logs.length} ${why}, client: ${req.client}, server: localhost, request: "${req.method} ${req.path} HTTP/1.1", host: "${req.host}"`);
    }
    const sent = req.method === 'HEAD' ? 0 : res.status >= 400 ? Number(res.headers.find(([k]) => k === 'Content-Length')?.[1] ?? 0) : new TextEncoder().encode(res.body).length;
    addLogs(c, t, 'o', `${req.client} - - [${accessTime(t)}] "${req.method} ${req.path} HTTP/1.1" ${res.status} ${sent} "-" "${req.ua}" "-"`);
    return res;
  }
  if (l.kind === 'app') {
    const r = c.proc?.reply ?? { status: 200, type: 'text/html', body: '' };
    return {
      status: r.status,
      reason: REASON[r.status] ?? 'OK',
      headers: [
        ['Content-Type', r.type],
        ['Date', httpDate(t)],
        ['Connection', 'keep-alive'],
        ['Keep-Alive', 'timeout=5'],
        ['Content-Length', String(new TextEncoder().encode(r.body).length)],
      ],
      body: r.body,
    };
  }
  if (l.kind === 'python-http') {
    const dir = c.workdir || '/';
    const links = DEBIAN_LINKS.has(dir) ? ['bin', 'lib', 'lib64', 'sbin'] : [];
    const names = (listC(state, c, dir) ?? []).map((e) => {
      const shown = links.includes(e.name) ? `${e.name}@` : e.isDir ? `${e.name}/` : e.name;
      return `<li><a href="${e.isDir ? `${e.name}/` : e.name}">${shown}</a></li>`;
    });
    if (dir === '/') names.unshift('<li><a href=".dockerenv">.dockerenv</a></li>');
    const body = `<!DOCTYPE HTML>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>Directory listing for /</title>\n</head>\n<body>\n<h1>Directory listing for /</h1>\n<hr>\n<ul>\n${names.join('\n')}\n</ul>\n<hr>\n</body>\n</html>\n`;
    addLogs(c, t, 'e', `${req.client} - - [${accessTime(t).replace(':', ' ').replace(' +0000', '')}] "${req.method} ${req.path} HTTP/1.1" 200 -`);
    return {
      proto: 'HTTP/1.0',
      status: 200,
      reason: 'OK',
      headers: [
        ['Server', `SimpleHTTP/0.6 Python/${VERSIONS.python}`],
        ['Date', httpDate(t)],
        ['Content-type', 'text/html; charset=utf-8'],
        ['Content-Length', String(body.length)],
      ],
      body,
    };
  }
  return null;
}

/** Debian images keep bin, lib, lib64 and sbin as links into /usr. */
const DEBIAN_LINKS = new Set(['/']);

function mimeOf(file: string): string {
  if (file.endsWith('.html') || file.endsWith('.htm')) return 'text/html';
  if (file.endsWith('.css')) return 'text/css';
  if (file.endsWith('.js')) return 'application/javascript';
  if (file.endsWith('.json')) return 'application/json';
  if (file.endsWith('.png')) return 'image/png';
  if (file.endsWith('.txt')) return 'text/plain';
  return 'application/octet-stream';
}

// ---------------------------------------------------------------------------
// Stopping

/** Logs and exit code when the main process is asked to stop (SIGTERM / the image's stop signal). */
export function stopLogs(state: KitchenState, c: Container): void {
  const t = state.clock;
  if (c.proc?.kind === 'nginx') {
    const nt = nginxTime(t);
    const lines = [`${nt} [notice] 1#1: signal 3 (SIGQUIT) received, shutting down`];
    for (let i = 0; i < state.host.cpus; i++) lines.push(`${nt} [notice] ${20 + i}#${20 + i}: gracefully shutting down`, `${nt} [notice] ${20 + i}#${20 + i}: exiting`, `${nt} [notice] ${20 + i}#${20 + i}: exit`);
    for (let i = 0; i < state.host.cpus; i++) lines.push(`${nt} [notice] 1#1: signal 17 (SIGCHLD) received from ${20 + i}`, `${nt} [notice] 1#1: worker process ${20 + i} exited with code 0`);
    lines.push(`${nt} [notice] 1#1: exit`);
    addLogs(c, t, 'e', lines);
  } else if (c.proc?.kind === 'postgres') {
    addLogs(c, t, 'e', PG_SHUTDOWN(pgTime(t, 266)));
    // A clean shutdown removes postmaster.pid.
    for (const m of c.mounts) {
      const v = m.type === 'volume' ? state.volumes[m.source] : undefined;
      if (v) for (const f of Object.keys(v.files)) if (f.endsWith('postmaster.pid')) delete v.files[f];
    }
  } else if (c.proc?.kind === 'redis') {
    const rt = redisTime(t, 123);
    addLogs(c, t, 'o', [
      `1:signal-handler (${Math.floor(t)}) Received SIGTERM scheduling shutdown...`,
      `1:M ${rt} * User requested shutdown...`,
      `1:M ${rt} * Saving the final RDB snapshot before exiting.`,
      `1:M ${rt} * BGSAVE done, ${Object.keys(c.memory).length} keys saved, 0 keys skipped, ${Object.keys(c.memory).length ? 99 : 88} bytes written.`,
      `1:M ${rt} * DB saved on disk`,
      `1:M ${rt} # Redis is now ready to exit, bye bye...`,
    ]);
    const dataDir = '/data';
    writeDeep(state, c, `${dataDir}/dump.rdb`, JSON.stringify(c.memory), 0);
  }
}
