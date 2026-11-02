// The tiny shell inside containers (BusyBox ash on Alpine, dash on Debian images).
// Enough for lessons: files, env, users, processes, wget/curl to other containers,
// psql and redis-cli, node -e and python -c.
import { basename, dirname, normalize } from '../git-sim/paths';
import { VERSIONS } from './catalog';
import { imageOf, isDirC, listC, mkdirC, mountFor, readC, rmC, uidOf, writeC } from './cfs';
import { lsTime, unixDate } from './format';
import { hostPid } from './ids';
import { curlError, curlText, dnsLookup, dotted, httpFetch, parseUrl, wgetError } from './net';
import { parseShell, type SimpleCommand } from './parse';
import { argvOf, binPath, evalJs, evalPy, launch } from './programs';
import { tarIn } from './tar';
import { NPM_CI_NO_LOCK } from './texts-long';
import type { Container, KitchenEvent, KitchenState, LocalImage, Proc } from './types';

export interface ShellCtx {
  state: KitchenState;
  c: Container;
  user: string;
  uid: number;
  cwd: string;
  env: [string, string][];
  tty: boolean;
  /** Running as the container's main process (so `node server.js` keeps the container up). */
  main: boolean;
  lastCode: number;
  events: KitchenEvent[];
}

export interface ShellOut {
  out: string[];
  err: string[];
  code: number;
  daemon?: Proc;
  /** `exit` was typed. */
  exit?: boolean;
}

/** The environment a process in this container sees (like Docker + runc build it). */
export function processEnv(state: KitchenState, c: Container, user: string): [string, string][] {
  const out: [string, string][] = [];
  const img = imageOf(state, c);
  const path = c.env.find((e) => e.startsWith('PATH='))?.slice(5) ?? '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';
  out.push(['PATH', path], ['HOSTNAME', c.hostname]);
  if (c.tty) out.push(['TERM', 'xterm']);
  for (const e of c.env) {
    const i = e.indexOf('=');
    if (i <= 0) continue;
    const k = e.slice(0, i);
    if (k === 'PATH' || k === 'HOSTNAME') continue;
    out.push([k, e.slice(i + 1)]);
  }
  if (!out.some(([k]) => k === 'HOME')) {
    const home = user === 'root' || user === '0' || !user ? '/root' : img?.users[user] ? (user === 'nobody' ? '/' : `/home/${user}`) : '/';
    out.push(['HOME', home]);
  }
  return out;
}

function isDash(img: LocalImage | null): boolean {
  return img?.kind === 'python' || img?.kind === 'debian' || Boolean(img?.files['/etc/os-release']?.includes('ID=debian'));
}

export function makeCtx(state: KitchenState, c: Container, opts: { user?: string; cwd?: string; tty?: boolean; main?: boolean } = {}): ShellCtx {
  const img = imageOf(state, c);
  const user = opts.user || c.user || img?.config.User || 'root';
  const uid = uidOf(state, c, user) ?? Number(user.split(':')[0]);
  return {
    state,
    c,
    user: user.split(':')[0]!,
    uid: Number.isFinite(uid) ? uid : 0,
    cwd: opts.cwd ?? c.workdir ?? '/',
    env: processEnv(state, c, user),
    tty: opts.tty ?? false,
    main: opts.main ?? false,
    lastCode: 0,
    events: [],
  };
}

function getVar(ctx: ShellCtx, name: string): string | undefined {
  if (name === '?') return String(ctx.lastCode);
  if (name === '$') return '1';
  const hit = [...ctx.env].reverse().find(([k]) => k === name);
  return hit?.[1];
}

function setVar(ctx: ShellCtx, name: string, value: string): void {
  const i = ctx.env.findIndex(([k]) => k === name);
  if (i >= 0) ctx.env[i] = [name, value];
  else ctx.env.push([name, value]);
}

/** Run a script (`sh -c "..."` or one typed line in `docker exec -it ... sh`). */
export function runScript(ctx: ShellCtx, script: string): ShellOut {
  const expanded = script.replace(/\$\(\(([^)]*)\)\)/g, (_, e: string) => {
    const v = e.replace(/\$?([A-Za-z_]\w*)/g, (_m, n: string) => getVar(ctx, n) ?? '0');
    const n = Number.isFinite(Number(v)) ? Number(v) : simpleMath(v);
    return String(n);
  });
  const p = parseShell(expanded, { vars: (n) => getVar(ctx, n) });
  const shell = isDash(imageOf(ctx.state, ctx.c)) ? 'sh: 1' : 'sh';
  if (!p.ok) {
    return { out: [], err: [p.error === 'unclosedQuote' ? `${shell}: syntax error: unterminated quoted string` : `${shell}: syntax error: unexpected "${p.near ?? 'newline'}"`], code: 2 };
  }
  const res: ShellOut = { out: [], err: [], code: 0 };
  let skip: '&&' | '||' | null = null;
  for (const pl of p.pipelines) {
    if (skip === '&&' && ctx.lastCode !== 0) {
      skip = pl.next === '||' ? null : pl.next === ';' || pl.next === null ? null : skip;
      if (pl.next !== '&&') skip = null;
      continue;
    }
    if (skip === '||' && ctx.lastCode === 0) {
      if (pl.next !== '||') skip = null;
      continue;
    }
    let stdin: string | null = null;
    let last: ShellOut = { out: [], err: [], code: 0 };
    for (let i = 0; i < pl.commands.length; i++) {
      const cmd = pl.commands[i]!;
      const piped = i < pl.commands.length - 1;
      last = runCommand(ctx, cmd, stdin);
      if (piped) {
        stdin = last.out.join('\n') + (last.out.length ? '\n' : '');
        res.err.push(...last.err);
      } else {
        res.out.push(...last.out);
        res.err.push(...last.err);
      }
      if (last.daemon || last.exit) break;
    }
    ctx.lastCode = last.code;
    res.code = last.code;
    if (last.daemon) {
      res.daemon = last.daemon;
      return res;
    }
    if (last.exit) {
      res.exit = true;
      return res;
    }
    skip = pl.next === '&&' || pl.next === '||' ? pl.next : null;
  }
  return res;
}

function simpleMath(expr: string): number {
  const m = /^\s*(-?\d+)\s*([+\-*/%])\s*(-?\d+)\s*$/.exec(expr);
  if (!m) return 0;
  const a = Number(m[1]);
  const b = Number(m[3]);
  switch (m[2]) {
    case '+':
      return a + b;
    case '-':
      return a - b;
    case '*':
      return a * b;
    case '/':
      return b ? Math.trunc(a / b) : 0;
    default:
      return b ? a % b : 0;
  }
}

const SHELLS = new Set(['sh', 'ash', 'bash', '/bin/sh', '/bin/ash', '/usr/bin/bash', '/bin/bash']);

function abs(ctx: ShellCtx, p: string): string {
  if (p.startsWith('/')) return normalize(p) || '/';
  if (p === '~') return getVar(ctx, 'HOME') ?? '/';
  if (p.startsWith('~/')) return normalize(`${getVar(ctx, 'HOME') ?? ''}/${p.slice(2)}`);
  return normalize(`${ctx.cwd}/${p}`) || '/';
}

function runCommand(ctx: ShellCtx, cmd: SimpleCommand, stdin: string | null): ShellOut {
  const { state, c } = ctx;
  const img = imageOf(state, c);
  const dash = isDash(img);
  const sh = dash ? 'sh: 1' : 'sh';
  for (const [k, v] of cmd.assigns) if (!cmd.words.length) setVar(ctx, k, v);
  if (!cmd.words.length) return { out: [], err: [], code: 0 };
  let input = stdin;
  if (cmd.input) {
    const f = readC(state, c, abs(ctx, cmd.input));
    if (typeof f !== 'string') return { out: [], err: [`${sh}: can't open ${cmd.input}: no such file`], code: 1 };
    input = f;
  }
  let r = builtin(ctx, cmd.words, input, dash);
  // Redirections.
  for (const rd of cmd.redirects) {
    if (rd.fd === 2 && rd.target === '&1') {
      r = { ...r, out: [...r.out, ...r.err], err: [] };
      continue;
    }
    if (rd.fd === 1 && rd.target === '&2') {
      r = { ...r, err: [...r.err, ...r.out], out: [] };
      continue;
    }
    const text = rd.fd === 1 ? r.out : r.err;
    const path = abs(ctx, rd.target);
    if (rd.target === '/dev/null') {
      r = rd.fd === 1 ? { ...r, out: [] } : { ...r, err: [] };
      continue;
    }
    const before = rd.append ? readC(state, c, path) : null;
    const content = (typeof before === 'string' ? before : '') + (text.length ? `${text.join('\n')}\n` : '');
    const err = writeC(state, c, path, content, ctx.uid);
    if (err) {
      const why = err === 'Permission denied' ? 'Permission denied' : err === 'Read-only file system' ? 'Read-only file system' : 'nonexistent directory';
      return { out: [], err: [dash ? `${sh}: cannot create ${rd.target}: ${why === 'nonexistent directory' ? 'Directory nonexistent' : why}` : `${sh}: can't create ${rd.target}: ${why}`], code: dash ? 2 : 1 };
    }
    r = rd.fd === 1 ? { ...r, out: [] } : { ...r, err: [] };
  }
  return r;
}

function notFound(name: string, dash: boolean): ShellOut {
  return { out: [], err: [dash ? `sh: 1: ${name}: not found` : `sh: ${name}: not found`], code: 127 };
}

function has(img: LocalImage | null, name: string): boolean {
  if (!img) return false;
  if (['cd', 'export', 'exit', 'echo', 'true', 'false', 'test', '[', 'pwd', 'kill', 'unset', 'set', 'exec', 'type', 'command'].includes(name)) return true;
  return Boolean(binPath(img, name));
}

function lsLine(mode: string, owner: string, size: number, t: number, name: string): string {
  return `${mode}    1 ${owner.padEnd(8)} ${owner.padEnd(8)} ${String(size).padStart(9)} ${lsTime(t)} ${name}`;
}

function userName(img: LocalImage | null, uid: number): string {
  const hit = Object.entries(img?.users ?? {}).find(([, v]) => v[0] === uid);
  return hit ? hit[0] : String(uid);
}

function builtin(ctx: ShellCtx, words: string[], stdin: string | null, dash: boolean): ShellOut {
  const { state, c } = ctx;
  const img = imageOf(state, c);
  const [name0, ...args] = words;
  const name = name0!;
  const base = basename(name);
  const ok = (out: string[] = [], err: string[] = []): ShellOut => ({ out, err, code: 0 });
  const bad = (err: string, code = 1): ShellOut => ({ out: [], err: [err], code });
  if (!has(img, base) && !SHELLS.has(name)) return notFound(name, dash);

  switch (base) {
    case 'exec':
      return builtin(ctx, args, stdin, dash);
    case 'echo': {
      let a = args;
      let newline = true;
      if (a[0] === '-n') {
        newline = false;
        a = a.slice(1);
      }
      if (a[0] === '-e') a = a.slice(1);
      const text = a.join(' ');
      return ok(newline || text ? text.split('\n') : []);
    }
    case 'true':
      return ok();
    case 'false':
      return { out: [], err: [], code: 1 };
    case 'pwd':
      return ok([ctx.cwd]);
    case 'cd': {
      const target = abs(ctx, args[0] ?? getVar(ctx, 'HOME') ?? '/');
      if (!isDirC(state, c, target)) return bad(dash ? `sh: 1: cd: can't cd to ${args[0]}` : `sh: cd: can't cd to ${args[0]}: No such file or directory`, 2);
      ctx.cwd = target;
      return ok();
    }
    case 'export': {
      for (const a of args) {
        const i = a.indexOf('=');
        if (i > 0) setVar(ctx, a.slice(0, i), a.slice(i + 1));
      }
      return ok();
    }
    case 'exit': {
      const code = args[0] !== undefined ? Number(args[0]) & 255 : ctx.lastCode;
      return { out: [], err: [], code, exit: true };
    }
    case 'env':
    case 'printenv': {
      if (base === 'printenv' && args[0]) {
        const v = getVar(ctx, args[0]);
        return v === undefined ? { out: [], err: [], code: 1 } : ok([v]);
      }
      return ok(ctx.env.map(([k, v]) => `${k}=${v}`));
    }
    case 'id': {
      const who = args[0];
      if (who) {
        const u = img?.users[who];
        if (!u) return bad(`id: unknown user ${who}`);
        return ok([dash ? `uid=${u[0]}(${who}) gid=${u[1]}(${who}) groups=${u[1]}(${who})` : `uid=${u[0]}(${who}) gid=${u[1]}(${who}) groups=${u[1]}(${who}),${u[1]}(${who})`]);
      }
      if (ctx.uid === 0) {
        if (img?.kind === 'busybox') return ok(['uid=0(root) gid=0(root) groups=0(root),10(wheel)']);
        if (dash) return ok(['uid=0(root) gid=0(root) groups=0(root)']);
        return ok(['uid=0(root) gid=0(root) groups=0(root),0(root),1(bin),2(daemon),3(sys),4(adm),6(disk),10(wheel),11(floppy),20(dialout),26(tape),27(video)']);
      }
      const named = Object.entries(img?.users ?? {}).find(([, v]) => v[0] === ctx.uid);
      if (named) return ok([`uid=${ctx.uid}(${named[0]}) gid=${named[1][1]}(${named[0]}) groups=${named[1][1]}(${named[0]})`]);
      return ok([`uid=${ctx.uid} gid=0(root) groups=0(root)`]);
    }
    case 'whoami': {
      const n = userName(img, ctx.uid);
      if (/^\d+$/.test(n)) return bad(dash ? `whoami: cannot find name for user ID ${n}` : `whoami: unknown uid ${n}`);
      return ok([n]);
    }
    case 'hostname':
      return ok([c.hostname]);
    case 'date':
      return ok([unixDate(state.clock)]);
    case 'uname':
      return ok([args.includes('-a') ? `Linux ${c.hostname} ${state.host.kernel} #1 SMP PREEMPT_DYNAMIC @0 x86_64 Linux` : args.includes('-r') ? state.host.kernel : args.includes('-m') ? 'x86_64' : 'Linux']);
    case 'sleep': {
      if (ctx.main) {
        const n = args[0] === 'infinity' ? undefined : Number(args[0] ?? 0);
        const proc: Proc = { kind: 'sleep', argv: ['sleep', ...args], user: ctx.user, listeners: [], stopCode: 137, stopKills: true };
        if (n !== undefined) {
          proc.exitAfter = n;
          proc.exitCode = 0;
        }
        return { out: [], err: [], code: 0, daemon: proc };
      }
      return ok();
    }
    case 'ls':
      return ls(ctx, args, dash);
    case 'cat': {
      if (!args.length) return ok(stdin ? stdin.replace(/\n$/, '').split('\n') : []);
      const out: string[] = [];
      const err: string[] = [];
      for (const a of args) {
        const v = readC(state, c, abs(ctx, a));
        if (v === 'dir') err.push(dash ? `cat: ${a}: Is a directory` : `cat: read error: Is a directory`);
        else if (v === null) err.push(dash ? `cat: ${a}: No such file or directory` : `cat: can't open '${a}': No such file or directory`);
        else out.push(...v.replace(/\n$/, '').split('\n'));
      }
      return { out, err, code: err.length ? 1 : 0 };
    }
    case 'head':
    case 'tail': {
      const nIdx = args.findIndex((a) => a === '-n');
      const n = nIdx >= 0 ? Number(args[nIdx + 1]) : Number(args.find((a) => /^-\d+$/.test(a))?.slice(1) ?? 10);
      const files = args.filter((a, i) => !a.startsWith('-') && !(nIdx >= 0 && i === nIdx + 1));
      const text = files.length ? readC(state, c, abs(ctx, files[0]!)) : stdin;
      if (typeof text !== 'string') return bad(`${base}: ${files[0]}: No such file or directory`);
      const lines = text.replace(/\n$/, '').split('\n');
      return ok(base === 'head' ? lines.slice(0, n) : lines.slice(-n));
    }
    case 'grep': {
      const flags = args.filter((a) => a.startsWith('-'));
      const rest = args.filter((a) => !a.startsWith('-'));
      const pat = rest[0] ?? '';
      const text = rest[1] ? readC(state, c, abs(ctx, rest[1])) : stdin;
      if (typeof text !== 'string') return bad(`grep: ${rest[1]}: No such file or directory`, 2);
      const re = new RegExp(pat.replace(/[.*+?^${}()|[\]\\]/g, (m) => (m === '.' || m === '*' ? m : `\\${m}`)), flags.includes('-i') ? 'i' : '');
      const hits = text.replace(/\n$/, '').split('\n').filter((l) => re.test(l) !== flags.includes('-v'));
      return { out: flags.includes('-c') ? [String(hits.length)] : flags.includes('-q') ? [] : hits, err: [], code: hits.length ? 0 : 1 };
    }
    case 'wc': {
      const text = args.find((a) => !a.startsWith('-')) ? readC(state, c, abs(ctx, args.find((a) => !a.startsWith('-'))!)) : stdin;
      if (typeof text !== 'string') return bad('wc: No such file or directory');
      const lines = text.split('\n').length - 1;
      return ok([args.includes('-l') ? String(lines) : `${String(lines).padStart(8)}`]);
    }
    case 'mkdir': {
      const parents = args.includes('-p');
      for (const a of args.filter((x) => !x.startsWith('-'))) {
        const err = mkdirC(state, c, abs(ctx, a), ctx.uid, parents);
        if (err) return bad(dash ? `mkdir: cannot create directory '${a}': ${err}` : `mkdir: can't create directory '${a}': ${err}`);
      }
      return ok();
    }
    case 'touch': {
      for (const a of args.filter((x) => !x.startsWith('-'))) {
        const p = abs(ctx, a);
        const cur = readC(state, c, p);
        if (cur === 'dir') continue;
        const err = writeC(state, c, p, typeof cur === 'string' ? cur : '', ctx.uid);
        if (err) return bad(dash ? `touch: cannot touch '${a}': ${err}` : `touch: ${a}: ${err}`);
      }
      return ok();
    }
    case 'rm': {
      for (const a of args.filter((x) => !x.startsWith('-'))) {
        const p = abs(ctx, a);
        if (readC(state, c, p) === 'dir' && !/-\w*r/.test(args.join(' '))) return bad(dash ? `rm: cannot remove '${a}': Is a directory` : `rm: '${a}' is a directory`);
        const err = rmC(state, c, p, ctx.uid);
        if (err && !/-\w*f/.test(args.join(' '))) return bad(dash ? `rm: cannot remove '${a}': ${err}` : `rm: can't remove '${a}': ${err}`);
      }
      return ok();
    }
    case 'cp': {
      const files = args.filter((a) => !a.startsWith('-'));
      const src = readC(state, c, abs(ctx, files[0] ?? ''));
      if (typeof src !== 'string') return bad(`cp: can't stat '${files[0]}': No such file or directory`);
      let dest = abs(ctx, files[1] ?? '.');
      if (isDirC(state, c, dest)) dest = `${dest === '/' ? '' : dest}/${basename(files[0]!)}`;
      const err = writeC(state, c, dest, src, ctx.uid);
      return err ? bad(`cp: can't create '${files[1]}': ${err}`) : ok();
    }
    case 'chmod':
      return ok();
    case 'chown': {
      if (c.capDrop.includes('ALL') || c.capDrop.includes('CHOWN')) return bad(`chown: ${args[args.length - 1]}: Operation not permitted`);
      if (ctx.uid !== 0) return bad(`chown: ${args[args.length - 1]}: Operation not permitted`);
      const owner = args.filter((a) => !a.startsWith('-'))[0] ?? '0';
      const uid = /^\d+/.test(owner) ? Number(owner.split(':')[0]) : (img?.users[owner.split(':')[0]!]?.[0] ?? 0);
      for (const a of args.filter((x) => !x.startsWith('-')).slice(1)) {
        const p = abs(ctx, a);
        // chown on a volume's mount point changes the volume itself (it outlives this container).
        const m = mountFor(c, p);
        const v = m && m.mount.type === 'volume' && m.rel === '' ? state.volumes[m.mount.source] : undefined;
        if (v) v.owner = uid;
        else c.owners[p] = uid;
      }
      return ok();
    }
    case 'tar':
      return tarIn(ctx, args);
    case 'which': {
      const out = args.map((a) => (img ? binPath(img, a) : null)).filter((x): x is string => Boolean(x));
      return { out, err: [], code: out.length === args.length ? 0 : 1 };
    }
    case 'test':
    case '[': {
      const a = base === '[' ? args.slice(0, -1) : args;
      const neg = a[0] === '!';
      const b = neg ? a.slice(1) : a;
      let r: boolean;
      if (b[0] === '-f') r = typeof readC(state, c, abs(ctx, b[1] ?? '')) === 'string' && readC(state, c, abs(ctx, b[1] ?? '')) !== 'dir';
      else if (b[0] === '-d') r = isDirC(state, c, abs(ctx, b[1] ?? ''));
      else if (b[0] === '-e') r = readC(state, c, abs(ctx, b[1] ?? '')) !== null;
      else if (b[0] === '-z') r = !b[1];
      else if (b[0] === '-n') r = Boolean(b[1]);
      else if (b[1] === '=' || b[1] === '==') r = b[0] === b[2];
      else if (b[1] === '!=') r = b[0] !== b[2];
      else r = Boolean(b[0]);
      return { out: [], err: [], code: r !== neg ? 0 : 1 };
    }
    case 'ps':
      return ok(psRows(state, c, ctx.user));
    case 'kill':
      return ok();
    case 'df':
      return ok(['Filesystem                Size      Used Available Use% Mounted on', 'overlay                  58.4G     12.1G     43.3G  22% /']);
    case 'ping':
      return ping(ctx, args);
    case 'wget':
      return wget(ctx, args);
    case 'curl':
      return curlIn(ctx, args);
    case 'apk':
    case 'apt-get':
    case 'apt':
    case 'pip':
    case 'pip3':
      if (args[0] === '--version' || args[0] === '-V') return ok([`${base} (practice kitchen)`]);
      return bad(`${base}: the practice kitchen has no internet. Put this in your Dockerfile as a RUN line instead.`, 1);
    case 'node':
      return nodeIn(ctx, args);
    case 'npm':
      return npmIn(ctx, args);
    case 'python':
    case 'python3':
      return pythonIn(ctx, args);
    case 'nginx':
      if (args[0] === '-v') return { out: [], err: [`nginx version: nginx/${(img?.config.Env ?? []).find((e) => e.startsWith('NGINX_VERSION='))?.slice(14) ?? '1.30.6'}`], code: 0 };
      if (args[0] === '-t') return { out: [], err: ['nginx: the configuration file /etc/nginx/nginx.conf syntax is ok', 'nginx: configuration file /etc/nginx/nginx.conf test is successful'], code: 0 };
      return daemonOrNote(ctx, words);
    case 'psql':
      return psql(ctx, args);
    case 'pg_isready':
      return c.proc?.kind === 'postgres' && c.status === 'running'
        ? ok(['/var/run/postgresql:5432 - accepting connections'])
        : { out: ['/var/run/postgresql:5432 - no response'], err: [], code: 2 };
    case 'redis-cli':
      return redisCli(ctx, args);
    case 'redis-server':
    case 'postgres':
      return daemonOrNote(ctx, words);
    case 'sh':
    case 'ash':
    case 'bash': {
      if (args[0] === '-c') {
        const inner = runScript({ ...ctx, env: [...ctx.env] }, args[1] ?? '');
        return { ...inner, exit: false };
      }
      if (args[0]) {
        const src = readC(state, c, abs(ctx, args[0]));
        if (typeof src !== 'string') return bad(dash ? `sh: 0: cannot open ${args[0]}: No such file` : `sh: can't open '${args[0]}': No such file or directory`, dash ? 2 : 2);
        return { ...runScript({ ...ctx, env: [...ctx.env] }, src.split('\n').join('; ').replace(/;\s*;/g, ';')), exit: false };
      }
      return ok();
    }
    default:
      if (name.startsWith('./') || name.startsWith('/')) {
        const src = readC(state, c, abs(ctx, name));
        if (typeof src !== 'string') return notFound(name, dash);
        return { ...runScript({ ...ctx, env: [...ctx.env] }, src.split('\n').filter((l) => !l.startsWith('#!')).join('; ')), exit: false };
      }
      return ok();
  }
}

/** Long-running programs started from a shell: in the main process they keep the container up. */
function daemonOrNote(ctx: ShellCtx, words: string[]): ShellOut {
  if (!ctx.main) return { out: [], err: [], code: 0 };
  const c = ctx.c;
  const saved = { entrypoint: c.entrypoint, cmd: c.cmd };
  c.entrypoint = [];
  c.cmd = words;
  const r = launch(ctx.state, c, (script, cc) => runScript(makeCtx(ctx.state, cc, { main: true }), script));
  c.entrypoint = saved.entrypoint;
  c.cmd = saved.cmd;
  if (r.startError) return { out: [], err: [r.startError], code: r.startCode ?? 127 };
  if (r.exitNow !== undefined) return { out: [], err: [], code: r.exitNow };
  return { out: [], err: [], code: 0, daemon: c.proc ?? undefined };
}

function ls(ctx: ShellCtx, args: string[], dash: boolean): ShellOut {
  const { state, c } = ctx;
  const flags = args.filter((a) => a.startsWith('-')).join('');
  const long = flags.includes('l');
  const all = flags.includes('a');
  const targets = args.filter((a) => !a.startsWith('-'));
  const out: string[] = [];
  const err: string[] = [];
  const img = imageOf(state, c);
  const list = targets.length ? targets : ['.'];
  for (const tgt of list) {
    const p = abs(ctx, tgt);
    const v = readC(state, c, p);
    if (v === null) {
      err.push(dash ? `ls: cannot access '${tgt}': No such file or directory` : `ls: ${tgt}: No such file or directory`);
      continue;
    }
    if (v !== 'dir') {
      out.push(long ? lsLine('-rw-r--r--', userName(img, c.owners[p] ?? 0), new TextEncoder().encode(v).length, state.clock, tgt) : tgt);
      continue;
    }
    const entries = listC(state, c, p) ?? [];
    const shown = all ? [{ name: '.', isDir: true }, { name: '..', isDir: true }, ...entries] : entries.filter((e) => !e.name.startsWith('.'));
    if (long) {
      out.push(`total ${Math.max(0, shown.filter((e) => !e.isDir).length * 4)}`);
      for (const e of shown) {
        const child = e.name === '.' ? p : e.name === '..' ? dirname(p) : `${p === '/' ? '' : p}/${e.name}`;
        const content = e.isDir ? null : readC(state, c, child);
        const owner = userName(img, c.owners[child] ?? imageOf(state, c)?.owners?.[child] ?? 0);
        out.push(lsLine(e.isDir ? 'drwxr-xr-x' : '-rw-r--r--', owner, e.isDir ? 4096 : new TextEncoder().encode(typeof content === 'string' ? content : '').length, c.created, e.name));
      }
    } else out.push(...shown.map((e) => e.name));
  }
  return { out, err, code: err.length ? (dash ? 2 : 1) : 0 };
}

/** Process table inside a container (BusyBox `ps` format). */
export function psRows(state: KitchenState, c: Container, execUser: string): string[] {
  const rows: [number, string, string][] = [];
  const p = c.proc;
  const main = p ? (p.kind === 'nginx' ? 'nginx: master process nginx -g daemon off;' : p.kind === 'redis' ? 'redis-server *:6379' : p.kind === 'postgres' ? 'postgres' : p.argv.join(' ')) : argvOf(c).join(' ');
  rows.push([1, p?.user && p.user !== '0' ? p.user : 'root', main]);
  if (p?.kind === 'nginx') for (let i = 0; i < state.host.cpus; i++) rows.push([20 + i, 'nginx', 'nginx: worker process']);
  if (p?.kind === 'postgres') {
    for (const [pid, name] of [[30, 'postgres: io worker 0'], [31, 'postgres: checkpointer '], [32, 'postgres: background writer '], [34, 'postgres: walwriter '], [35, 'postgres: logical replication launcher ']] as const) rows.push([pid, 'postgres', name]);
  }
  rows.push([40 + (c.logs.length % 50), execUser || 'root', 'ps']);
  return ['PID   USER     TIME  COMMAND', ...rows.map(([pid, u, cmd]) => `${String(pid).padStart(5)} ${u.padEnd(8)}  0:00 ${cmd}`)];
}

/**
 * A running container's processes as the laptop sees them: the same processes as `ps` inside,
 * with laptop PIDs, and users as numbers when the laptop has no such name (nginx = 101).
 * `docker top`, `ps aux` on the laptop and `docker inspect` State.Pid all use this, so they agree.
 * The main process's parent is containerd-shim-runc-v2 (PID `shim`).
 */
export function hostProcesses(state: KitchenState, c: Container): { shim: number; procs: { uid: string; pid: number; ppid: number; cmd: string }[] } {
  const base = hostPid(c.id);
  const rows = psRows(state, c, '').slice(1, -1).map((r) => r.trim().split(/\s+/));
  const users = imageOf(state, c)?.users ?? {};
  const procs = rows.map((p, i) => {
    const name = p[1]!;
    const uid = name === 'root' ? 'root' : String(users[name]?.[0] ?? name);
    return { uid, pid: i === 0 ? base : base + 46 + i, ppid: i === 0 ? base - 33 : base, cmd: p.slice(3).join(' ') };
  });
  return { shim: base - 33, procs };
}

function ping(ctx: ShellCtx, args: string[]): ShellOut {
  const host = args.filter((a) => !a.startsWith('-') && !/^\d+$/.test(a))[0] ?? '';
  const ci = args.indexOf('-c');
  const n = ci >= 0 ? Number(args[ci + 1] ?? 1) : 4;
  let ip = host;
  if (host === 'localhost') ip = '127.0.0.1';
  else if (!/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const hit = dnsLookup(ctx.state, ctx.c, host);
    if (!hit) return { out: [], err: [`ping: bad address '${host}'`], code: 1 };
    ip = hit.ip;
  }
  // --network none: only the loopback line exists (checked on Docker 29).
  if (ctx.c.networkMode === 'none' && !ip.startsWith('127.')) return { out: [`PING ${host} (${ip}): 56 data bytes`], err: ['ping: sendto: Network unreachable'], code: 1 };
  const out = [`PING ${host} (${ip}): 56 data bytes`];
  for (let i = 0; i < n; i++) out.push(`64 bytes from ${ip}: seq=${i} ttl=64 time=0.08${i} ms`);
  out.push('', `--- ${host} ping statistics ---`, `${n} packets transmitted, ${n} packets received, 0% packet loss`, `round-trip min/avg/max = 0.080/0.08${Math.min(9, n - 1)}/0.08${Math.min(9, n - 1)} ms`);
  return { out, err: [], code: 0 };
}

function wget(ctx: ShellCtx, args: string[]): ShellOut {
  let quiet = false;
  let outFile: string | null = null;
  let url = '';
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '-q') quiet = true;
    else if (a === '-qO-' || a === '-qO' || a === '-O-' || a === '-O') {
      if (a.startsWith('-q')) quiet = true;
      outFile = a.endsWith('-') ? '-' : (args[++i] ?? '-');
    } else if (a === '--spider') outFile = '/dev/null';
    else if (!a.startsWith('-')) url = a;
  }
  const u = parseUrl(url);
  if (!u) return { out: [], err: ['BusyBox v1.37.0 (2025-01-17 18:12:01 UTC) multi-call binary.', '', 'Usage: wget [-cqS] [--spider] [-O FILE] [-o LOGFILE] [--header STR]'], code: 1 };
  const r = httpFetch(ctx.state, { kind: 'container', id: ctx.c.id }, u, 'GET', 'Wget');
  if (!r.ok) {
    const err = [wgetError(r)];
    // BusyBox names a bad address as typed: 'db', or 'db:5432' when a port is given (Docker 29, alpine:3.22).
    if (err[0]!.startsWith('wget: bad address') && /^(?:https?:\/\/)?[^/:?#\s]+:\d+/.test(url)) err[0] = `wget: bad address '${u.host}:${u.port}'`;
    if (!quiet && r.error === 'refused') err.unshift(`Connecting to ${u.host}${u.port === 80 ? '' : `:${u.port}`} (${dotted(r.ip, u.port)})`);
    return { out: [], err, code: 1 };
  }
  ctx.events.push(r.event);
  if (r.res.status >= 400) {
    return { out: [], err: [...(quiet ? [] : [`Connecting to ${u.host} (${dotted(r.ip, u.port)})`]), `wget: server returned error: HTTP/1.1 ${r.res.status} ${r.res.reason}`], code: 1 };
  }
  const body = r.res.body;
  if (outFile === '-') {
    const err = quiet ? [] : [`Connecting to ${u.host} (${dotted(r.ip, u.port)})`, 'writing to stdout'];
    return { out: body.replace(/\n$/, '').split('\n'), err: quiet ? err : [...err, `-                    100% |********************************|   ${body.length}  0:00:00 ETA`, 'written to stdout'], code: 0 };
  }
  if (outFile === '/dev/null') return { out: [], err: quiet ? [] : [`Connecting to ${u.host} (${dotted(r.ip, u.port)})`, 'remote file exists'], code: 0 };
  const file = outFile ?? (u.path.split('/').pop() || 'index.html');
  const werr = writeC(ctx.state, ctx.c, abs(ctx, file), body, ctx.uid);
  if (werr) return { out: [], err: [`wget: can't open '${file}': ${werr}`], code: 1 };
  return { out: [], err: quiet ? [] : [`Connecting to ${u.host} (${dotted(r.ip, u.port)})`, `saving to '${file}'`, `${file.padEnd(20)} 100% |********************************|   ${body.length}  0:00:00 ETA`, `'${file}' saved`], code: 0 };
}

function curlIn(ctx: ShellCtx, args: string[]): ShellOut {
  const silent = args.some((a) => /^-\w*s/.test(a) && !a.startsWith('--'));
  const showErr = args.some((a) => /^-\w*S/.test(a));
  const head = args.some((a) => /^-\w*I/.test(a));
  const inc = args.some((a) => /^-\w*i/.test(a));
  const url = args.find((a) => !a.startsWith('-')) ?? '';
  const u = parseUrl(url);
  if (!u) return { out: [], err: ['curl: (3) URL rejected: Malformed input to a URL function'], code: 3 };
  const r = httpFetch(ctx.state, { kind: 'container', id: ctx.c.id }, u, head ? 'HEAD' : 'GET', 'curl/8.17.0');
  if (!r.ok) {
    const e = curlError(r);
    return { out: [], err: silent && !showErr ? [] : [e.text], code: e.code };
  }
  ctx.events.push(r.event);
  // -f / --fail: an error page (4xx, 5xx) is a failure, exit code 22 (health checks rely on it).
  if (r.res.status >= 400 && args.some((a) => a === '--fail' || /^-\w*f/.test(a))) {
    return { out: [], err: silent && !showErr ? [] : [`curl: (22) The requested URL returned error: ${r.res.status}`], code: 22 };
  }
  const text = curlText(r.res, head || inc, !head);
  return { out: text.replace(/\n$/, '').split('\n'), err: [], code: 0 };
}

function nodeIn(ctx: ShellCtx, args: string[]): ShellOut {
  if (args[0] === '--version' || args[0] === '-v') return { out: [VERSIONS.node], err: [], code: 0 };
  if (args[0] === '-e' || args[0] === '-p') {
    const r = evalJs(args[1] ?? '');
    return { out: r.out !== null ? [r.out] : [], err: r.err ? [r.err] : [], code: r.err ? 1 : 0 };
  }
  return daemonOrNote(ctx, ['node', ...args]);
}

function npmIn(ctx: ShellCtx, args: string[]): ShellOut {
  if (args[0] === '--version' || args[0] === '-v') return { out: [VERSIONS.npm], err: [], code: 0 };
  if (args[0] === 'ci' || args[0] === 'install' || args[0] === 'i') {
    return npmInstall(ctx, args[0] === 'ci');
  }
  return daemonOrNote(ctx, ['npm', ...args]);
}

/** `npm ci` / `npm install`: dependencies from package.json land in node_modules. */
export function npmInstall(ctx: ShellCtx, ci: boolean): ShellOut {
  const { state, c } = ctx;
  const dir = ctx.cwd === '/' ? '' : ctx.cwd;
  const pkgText = readC(state, c, `${dir}/package.json`);
  if (typeof pkgText !== 'string') {
    return {
      out: [],
      err: [
        'npm error code ENOENT',
        'npm error syscall open',
        `npm error path ${dir}/package.json`,
        `npm error errno -2`,
        `npm error enoent Could not read package.json: Error: ENOENT: no such file or directory, open '${dir}/package.json'`,
        'npm error enoent This is related to npm not being able to find a file.',
        'npm error enoent',
      ],
      code: 254,
    };
  }
  if (ci && typeof readC(state, c, `${dir}/package-lock.json`) !== 'string') {
    return { out: [], err: NPM_CI_NO_LOCK.split('\n'), code: 1 };
  }
  let deps: string[];
  try {
    const pkg = JSON.parse(pkgText) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    deps = Object.keys(pkg.dependencies ?? {});
  } catch {
    return { out: [], err: ['npm error code EJSONPARSE'], code: 1 };
  }
  mkdirC(state, c, `${dir}/node_modules`, ctx.uid, true);
  for (const d of deps) {
    mkdirC(state, c, `${dir}/node_modules/${d}`, ctx.uid, true);
    writeC(state, c, `${dir}/node_modules/${d}/package.json`, `{"name":"${d}"}\n`, ctx.uid);
  }
  const n = deps.length ? deps.length * 23 + 1 : 0;
  return {
    out: n ? ['', `added ${n} packages, and audited ${n + 1} packages in 2s`, '', `${Math.max(1, Math.floor(n / 4))} packages are looking for funding`, '  run `npm fund` for details', '', 'found 0 vulnerabilities'] : ['', 'up to date, audited 1 package in 120ms', '', 'found 0 vulnerabilities'],
    err: [],
    code: 0,
  };
}

function pythonIn(ctx: ShellCtx, args: string[]): ShellOut {
  if (args[0] === '--version' || args[0] === '-V') return { out: [`Python ${VERSIONS.python}`], err: [], code: 0 };
  if (args[0] === '-c') {
    const r = evalPy(args[1] ?? '');
    return { out: r.out !== null ? [r.out] : [], err: r.err ? r.err.split('\n') : [], code: r.err ? 1 : 0 };
  }
  return daemonOrNote(ctx, ['python', ...args]);
}

// ---------------------------------------------------------------------------
// psql: a tiny SQL subset, stored with the database files (so a volume keeps it).

function pgStore(state: KitchenState, c: Container): Record<string, string[][]> | null {
  const m = c.mounts.find((x) => x.type === 'volume' && ('/var/lib/postgresql/18/docker'.startsWith(x.target)));
  if (!m) return null;
  const v = state.volumes[m.source];
  if (!v) return null;
  v.pg ??= {};
  return v.pg;
}

function psqlTable(headers: string[], rows: string[][]): string[] {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)));
  const isNum = headers.map((_, i) => rows.length > 0 && rows.every((r) => /^-?\d+(\.\d+)?$/.test(r[i] ?? '')));
  const center = (s: string, w: number) => {
    const left = Math.floor((w - s.length) / 2);
    return ' '.repeat(left) + s + ' '.repeat(w - s.length - left);
  };
  const out = [` ${headers.map((h, i) => center(h, widths[i]!)).join(' | ')} `, widths.map((w) => '-'.repeat(w + 2)).join('+')];
  for (const r of rows) {
    out.push(` ${r.map((v, i) => (isNum[i] ? v.padStart(widths[i]!) : v.padEnd(widths[i]!))).join(' | ')}`.trimEnd());
  }
  out.push(`(${rows.length} ${rows.length === 1 ? 'row' : 'rows'})`, '');
  return out;
}

function psql(ctx: ShellCtx, args: string[]): ShellOut {
  const { state, c } = ctx;
  if (c.proc?.kind !== 'postgres' || c.status !== 'running') {
    return { out: [], err: ['psql: error: connection to server on socket "/var/run/postgresql/.s.PGSQL.5432" failed: No such file or directory', '\tIs the server running locally and accepting connections on that socket?'], code: 2 };
  }
  const ci = args.indexOf('-c');
  if (ci < 0) return { out: [], err: ['psql: this practice kitchen only runs psql -c "SQL"'], code: 1 };
  const sql = (args[ci + 1] ?? '').trim().replace(/;\s*$/, '');
  const store = pgStore(state, c) ?? {};
  let m: RegExpExecArray | null;
  if (/^select\s+1$/i.test(sql)) return { out: psqlTable(['?column?'], [['1']]), err: [], code: 0 };
  if ((m = /^create\s+table\s+(\w+)\s*\(([^)]*)\)$/i.exec(sql))) {
    const name = m[1]!.toLowerCase();
    if (store[name]) return { out: [], err: [`ERROR:  relation "${name}" already exists`], code: 1 };
    const cols = m[2]!.split(',').map((x) => x.trim().split(/\s+/)[0]!.toLowerCase());
    store[name] = [cols];
    return { out: ['CREATE TABLE'], err: [], code: 0 };
  }
  if ((m = /^insert\s+into\s+(\w+)\s+values\s*\((.*)\)$/i.exec(sql))) {
    const name = m[1]!.toLowerCase();
    const t = store[name];
    if (!t) return { out: [], err: [`ERROR:  relation "${name}" does not exist`, `LINE 1: ${sql}`, `${' '.repeat(20)}^`], code: 1 };
    const vals = m[2]!.split(',').map((x) => x.trim().replace(/^'(.*)'$/, '$1'));
    t.push(vals);
    return { out: ['INSERT 0 1'], err: [], code: 0 };
  }
  if ((m = /^select\s+\*\s+from\s+(\w+)$/i.exec(sql))) {
    const name = m[1]!.toLowerCase();
    const t = store[name];
    if (!t) return { out: [], err: [`ERROR:  relation "${name}" does not exist`, `LINE 1: select * from ${m[1]}`, `${' '.repeat(22)}^`], code: 1 };
    return { out: psqlTable(t[0]!, t.slice(1)), err: [], code: 0 };
  }
  if ((m = /^drop\s+table\s+(\w+)$/i.exec(sql))) {
    delete store[m[1]!.toLowerCase()];
    return { out: ['DROP TABLE'], err: [], code: 0 };
  }
  return { out: [], err: [`ERROR:  syntax error at or near "${sql.split(/\s+/)[0]}"`], code: 1 };
}

function redisCli(ctx: ShellCtx, args: string[]): ShellOut {
  const { state } = ctx;
  let target = ctx.c;
  const hi = args.indexOf('-h');
  let rest = args;
  // redis-cli names the host as given: 127.0.0.1 by default, else what -h said.
  let shown = '127.0.0.1';
  if (hi >= 0) {
    const host = args[hi + 1] ?? '';
    rest = args.filter((_, i) => i !== hi && i !== hi + 1);
    shown = host;
    if (host !== 'localhost' && host !== '127.0.0.1') {
      const hit = dnsLookup(state, ctx.c, host);
      if (!hit) return { out: [], err: [`Could not connect to Redis at ${host}:6379: Name does not resolve`], code: 1 };
      target = hit.c;
    }
  }
  if (target.proc?.kind !== 'redis' || target.status !== 'running') {
    return { out: [], err: [`Could not connect to Redis at ${shown}:6379: Connection refused`], code: 1 };
  }
  const [cmd = '', ...a] = rest;
  const mem = target.memory;
  const tty = ctx.tty;
  const q = (s: string) => (tty ? `"${s}"` : s);
  switch (cmd.toLowerCase()) {
    case 'ping':
      return { out: ['PONG'], err: [], code: 0 };
    case 'set':
      mem[a[0] ?? ''] = a[1] ?? '';
      return { out: ['OK'], err: [], code: 0 };
    case 'get':
      return { out: [a[0] && Object.hasOwn(mem, a[0]) ? q(mem[a[0]]!) : tty ? '(nil)' : ''], err: [], code: 0 };
    case 'incr': {
      const n = Number(mem[a[0] ?? ''] ?? 0) + 1;
      mem[a[0] ?? ''] = String(n);
      return { out: [tty ? `(integer) ${n}` : String(n)], err: [], code: 0 };
    }
    case 'del': {
      const had = a.filter((k) => Object.hasOwn(mem, k));
      for (const k of had) delete mem[k];
      return { out: [tty ? `(integer) ${had.length}` : String(had.length)], err: [], code: 0 };
    }
    case 'keys':
      return { out: Object.keys(mem).sort().map((k, i) => (tty ? `${i + 1}) "${k}"` : k)), err: [], code: 0 };
    case 'dbsize':
      return { out: [tty ? `(integer) ${Object.keys(mem).length}` : String(Object.keys(mem).length)], err: [], code: 0 };
    default:
      return { out: [`ERR unknown command '${cmd}', with args beginning with: ${a.map((x) => `'${x}' `).join('')}`], err: [], code: 0 };
  }
}

export { uidOf };
