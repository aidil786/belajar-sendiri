// The learner's laptop: a tiny Linux shell (files, permissions, env vars, exit codes,
// processes) and curl, which reaches containers only through published ports.
import { basename, dirname, prettyPath } from '../git-sim/paths';
import { hostProcesses } from './cshell';
import { curlError, curlText, httpFetch, parseUrl } from './net';
import { DOCKER_VERSION, ensureDir, fail, line, listDir, ok, out, resolve, writeFile } from './state';
import type { Ctx, KitchenEvent, KitchenResult, KitchenState, Line } from './types';

type Fn = (state: KitchenState, args: string[], ctx: Ctx) => KitchenResult;

const p2 = (n: number) => String(n).padStart(2, '0');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** The laptop's clock is Malaysia time (+08). */
function local(t: number): Date {
  return new Date((t + 8 * 3600) * 1000);
}

function modeOf(state: KitchenState, path: string, isDir: boolean): string {
  return state.fs.modes[path] ?? (isDir ? 'drwxr-xr-x' : '-rw-r--r--');
}

export const pwd: Fn = (state) => ok(state, [line(state.cwd)], [], { key: 'sim.docker.explain.pwd' });

export const cd: Fn = (state, args) => {
  const target = args[0] === '-' ? (state.lastDir ?? state.cwd) : resolve(state, args[0] ?? '~');
  if (!state.fs.dirs.includes(target)) {
    if (target in state.fs.files) return fail(state, out(`bash: cd: ${args[0]}: Not a directory`), 'notADir');
    return fail(state, out(`bash: cd: ${args[0]}: No such file or directory`), 'noSuchPath', { key: 'sim.docker.err.noSuchPath', params: { path: args[0] ?? '' } });
  }
  const s = structuredClone(state);
  s.lastDir = s.cwd;
  s.cwd = target;
  return ok(s, args[0] === '-' ? [line(target)] : [], [{ type: 'cwdChanged', cwd: target }], { key: 'sim.docker.explain.cd', params: { path: prettyPath(target, s.home) } });
};

export const ls: Fn = (state, args) => {
  const flags = args.filter((a) => a.startsWith('-')).join('');
  if (/[^-la1hA]/.test(flags)) return fail(state, out(`ls: this practice terminal knows ls, ls -a, ls -l and ls -la`), 'lsOption');
  const all = flags.includes('a') || flags.includes('A');
  const long = flags.includes('l');
  const targets = args.filter((a) => !a.startsWith('-'));
  const lines: Line[] = [];
  const t = targets[0] ?? '.';
  const abs = resolve(state, t);
  if (abs in state.fs.files) {
    const size = new TextEncoder().encode(state.fs.files[abs]!).length;
    return ok(state, [line(long ? `${modeOf(state, abs, false)} 1 you you ${size} ${lsDate(state)} ${t}` : t)]);
  }
  if (!state.fs.dirs.includes(abs)) return fail(state, out(`ls: cannot access '${t}': No such file or directory`), 'noSuchPath', { key: 'sim.docker.err.noSuchPath', params: { path: t } }, 2);
  let entries = listDir(state, abs);
  if (!all) entries = entries.filter((e) => !e.name.startsWith('.'));
  if (all && !flags.includes('A')) entries = [{ name: '.', isDir: true }, { name: '..', isDir: true }, ...entries];
  if (!long) {
    if (entries.length) lines.push(entries.map((e) => (e.isDir ? [{ t: e.name, c: 'blue' as const }] : [{ t: e.name }])).reduce<Line>((acc, segs, i) => [...acc, ...(i ? [{ t: '  ' }] : []), ...segs], []));
    return ok(state, lines, [], { key: 'sim.docker.explain.ls' });
  }
  const rows = entries.map((e) => {
    const p = e.name === '.' ? abs : e.name === '..' ? dirname(abs) : `${abs === '/' ? '' : abs}/${e.name}`;
    const size = e.isDir ? 4096 : new TextEncoder().encode(state.fs.files[p] ?? '').length;
    return { mode: modeOf(state, p, e.isDir), size, name: e.name, isDir: e.isDir, exec: modeOf(state, p, e.isDir).includes('x') && !e.isDir };
  });
  const w = Math.max(1, ...rows.map((r) => String(r.size).length));
  lines.push(line(`total ${rows.reduce((n, r) => n + (r.isDir ? 4 : Math.ceil(r.size / 4096) * 4), 0)}`));
  for (const r of rows) {
    lines.push([{ t: `${r.mode} ${r.isDir ? 2 : 1} you you ${String(r.size).padStart(w)} ${lsDate(state)} ` }, r.isDir ? { t: r.name, c: 'blue' } : r.exec ? { t: r.name, c: 'green' } : { t: r.name }]);
  }
  return ok(state, lines, [], { key: 'sim.docker.explain.lsLong' });
};

function lsDate(state: KitchenState): string {
  const d = local(state.clock);
  return `${MONTHS[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2, ' ')} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
}

export const cat: Fn = (state, args, ctx) => {
  const files = args.filter((a) => !a.startsWith('-'));
  if (!files.length) return ok(state, ctx.stdin ? out(ctx.stdin.replace(/\n$/, '')) : []);
  const lines: Line[] = [];
  for (const f of files) {
    const abs = resolve(state, f);
    if (abs === '/etc/hosts') {
      lines.push(...out('127.0.0.1\tlocalhost\n127.0.1.1\tlaptop\n\n# The following lines are desirable for IPv6 capable hosts\n::1     ip6-localhost ip6-loopback'));
      continue;
    }
    if (abs === '/etc/os-release') {
      lines.push(...out('PRETTY_NAME="Ubuntu 24.04.5 LTS"\nNAME="Ubuntu"\nVERSION_ID="24.04"\nVERSION="24.04.5 LTS (Noble Numbat)"\nID=ubuntu'));
      continue;
    }
    if (state.fs.dirs.includes(abs)) return fail(state, [...lines, line(`cat: ${f}: Is a directory`)], 'isDir');
    const text = state.fs.files[abs];
    if (text === undefined) return fail(state, [...lines, line(`cat: ${f}: No such file or directory`)], 'noSuchPath', { key: 'sim.docker.err.noSuchPath', params: { path: f } });
    if (text) lines.push(...out(text.replace(/\n$/, '')));
  }
  return ok(state, lines, [], { key: 'sim.docker.explain.cat' });
};

export const mkdir: Fn = (state, args) => {
  const parents = args.includes('-p');
  const s = structuredClone(state);
  for (const a of args.filter((x) => !x.startsWith('-'))) {
    const abs = resolve(s, a);
    if (s.fs.dirs.includes(abs)) {
      if (parents) continue;
      return fail(state, out(`mkdir: cannot create directory '${a}': File exists`), 'exists');
    }
    if (!parents && !s.fs.dirs.includes(dirname(abs))) return fail(state, out(`mkdir: cannot create directory '${a}': No such file or directory`), 'noSuchPath');
    ensureDir(s, abs);
  }
  return ok(s, [], [], { key: 'sim.docker.explain.mkdir' });
};

export const touch: Fn = (state, args) => {
  const s = structuredClone(state);
  for (const a of args.filter((x) => !x.startsWith('-'))) {
    const abs = resolve(s, a);
    if (!s.fs.dirs.includes(dirname(abs))) return fail(state, out(`touch: cannot touch '${a}': No such file or directory`), 'noSuchPath');
    if (!(abs in s.fs.files)) writeFile(s, abs, '');
  }
  return ok(s, [], [], { key: 'sim.docker.explain.touch' });
};

export const rm: Fn = (state, args) => {
  const recursive = args.some((a) => /^-\w*r/i.test(a));
  const force = args.some((a) => /^-\w*f/.test(a));
  const s = structuredClone(state);
  for (const a of args.filter((x) => !x.startsWith('-'))) {
    const abs = resolve(s, a);
    if (s.fs.dirs.includes(abs)) {
      if (!recursive) return fail(state, out(`rm: cannot remove '${a}': Is a directory`), 'isDir');
      s.fs.dirs = s.fs.dirs.filter((d) => d !== abs && !d.startsWith(`${abs}/`));
      for (const f of Object.keys(s.fs.files)) if (f.startsWith(`${abs}/`)) delete s.fs.files[f];
      continue;
    }
    if (!(abs in s.fs.files)) {
      if (force) continue;
      return fail(state, out(`rm: cannot remove '${a}': No such file or directory`), 'noSuchPath');
    }
    delete s.fs.files[abs];
  }
  return ok(s, [], [], { key: 'sim.docker.explain.rm' });
};

export const cp: Fn = (state, args) => {
  const [a, b] = args.filter((x) => !x.startsWith('-'));
  if (!a || !b) return fail(state, out(`cp: missing file operand`), 'usage');
  const src = resolve(state, a);
  if (!(src in state.fs.files)) return fail(state, out(`cp: cannot stat '${a}': No such file or directory`), 'noSuchPath');
  const s = structuredClone(state);
  let dst = resolve(s, b);
  if (s.fs.dirs.includes(dst)) dst = `${dst}/${basename(src)}`;
  writeFile(s, dst, s.fs.files[src]!);
  return ok(s);
};

export const echo = (state: KitchenState, args: string[], redirect: { target: string; append: boolean } | null): KitchenResult => {
  let a = args;
  let nl = true;
  if (a[0] === '-n') {
    nl = false;
    a = a.slice(1);
  }
  const text = a.join(' ');
  if (!redirect) return ok(state, nl || text ? out(text) : [], [], { key: 'sim.docker.explain.echo' });
  const s = structuredClone(state);
  const abs = resolve(s, redirect.target);
  if (!s.fs.dirs.includes(dirname(abs))) return fail(state, out(`bash: ${redirect.target}: No such file or directory`), 'noSuchPath');
  if (s.fs.dirs.includes(abs)) return fail(state, out(`bash: ${redirect.target}: Is a directory`), 'isDir');
  writeFile(s, abs, (redirect.append ? (s.fs.files[abs] ?? '') : '') + text + (nl ? '\n' : ''));
  return ok(s, [], [{ type: 'fileWritten', path: abs }], { key: redirect.append ? 'sim.docker.explain.echoAppend' : 'sim.docker.explain.echoWrite', params: { file: redirect.target } });
};

export const env: Fn = (state, args) => {
  if (args[0] && !args[0].includes('=')) {
    const v = state.env[args[0]];
    return v === undefined ? { ...fail(state, [], 'unset'), stopped: true } : ok(state, [line(v)]);
  }
  return ok(state, Object.entries(state.env).map(([k, v]) => line(`${k}=${v}`)), [], { key: 'sim.docker.explain.env' });
};

export const exportCmd: Fn = (state, args) => {
  const s = structuredClone(state);
  for (const a of args) {
    const i = a.indexOf('=');
    if (i > 0) s.env[a.slice(0, i)] = a.slice(i + 1);
  }
  return ok(s, [], [], { key: 'sim.docker.explain.export', params: { name: args[0]?.split('=')[0] ?? '' } });
};

export const unset: Fn = (state, args) => {
  const s = structuredClone(state);
  for (const a of args) delete s.env[a];
  return ok(s);
};

export const chmod: Fn = (state, args) => {
  const [mode, ...files] = args.filter((a) => !a.startsWith('-') || /^-[rwx]+$/.test(a));
  if (!mode || !files.length) return fail(state, out(`chmod: missing operand`), 'usage');
  const s = structuredClone(state);
  for (const f of files) {
    const abs = resolve(s, f);
    const isDir = s.fs.dirs.includes(abs);
    if (!isDir && !(abs in s.fs.files)) return fail(state, out(`chmod: cannot access '${f}': No such file or directory`), 'noSuchPath');
    let m = modeOf(s, abs, isDir).split('');
    if (/^[0-7]{3}$/.test(mode)) {
      const bits = mode.split('').map(Number);
      const tri = (n: number) => `${n & 4 ? 'r' : '-'}${n & 2 ? 'w' : '-'}${n & 1 ? 'x' : '-'}`;
      m = `${isDir ? 'd' : '-'}${tri(bits[0]!)}${tri(bits[1]!)}${tri(bits[2]!)}`.split('');
    } else {
      const mm = /^([ugoa]*)([+-=])([rwx]+)$/.exec(mode);
      if (!mm) return fail(state, out(`chmod: invalid mode: '${mode}'`), 'badMode');
      const who = mm[1] || 'a';
      const idx: number[] = [];
      if (who.includes('u') || who.includes('a')) idx.push(1);
      if (who.includes('g') || who.includes('a')) idx.push(4);
      if (who.includes('o') || who.includes('a')) idx.push(7);
      for (const base of idx) {
        for (const ch of mm[3]!) {
          const off = ch === 'r' ? 0 : ch === 'w' ? 1 : 2;
          if (mm[2] === '-') m[base + off] = '-';
          else m[base + off] = ch;
        }
      }
    }
    s.fs.modes[abs] = m.join('');
  }
  return ok(s, [], [], { key: 'sim.docker.explain.chmod', params: { mode, file: files.join(' ') } });
};

export const whoami: Fn = (state) => ok(state, [line(state.user)], [], { key: 'sim.docker.explain.whoami' });
export const id: Fn = (state) => ok(state, [line('uid=1000(you) gid=1000(you) groups=1000(you),27(sudo),984(docker)')], [], { key: 'sim.docker.explain.id' });
export const hostname: Fn = (state) => ok(state, [line(state.host.name)]);
export const uname: Fn = (state, args) =>
  ok(state, [line(args.includes('-a') ? `Linux ${state.host.name} ${state.host.kernel} #1 SMP PREEMPT_DYNAMIC x86_64 x86_64 x86_64 GNU/Linux` : args.includes('-r') ? state.host.kernel : args.includes('-m') ? 'x86_64' : 'Linux')]);

export const date: Fn = (state) => {
  const d = local(state.clock);
  return ok(state, [line(`${DAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${p2(d.getUTCDate())} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())} +08 ${d.getUTCFullYear()}`)]);
};

export const ps: Fn = (state, args) => {
  const t = local(state.clock);
  const hhmm = `${p2(t.getUTCHours())}:${p2(t.getUTCMinutes())}`;
  if (!args.length) {
    return ok(state, out(`    PID TTY          TIME CMD\n   2201 pts/0    00:00:00 bash\n   ${2300 + (state.counter % 600)} pts/0    00:00:00 ps`), [], { key: 'sim.docker.explain.shellPs' });
  }
  const rows: string[][] = [
    ['root', '1', '0.0', '0.1', '22576', '13204', '?', 'Ss', '09:00', '0:01', '/sbin/init'],
    ['root', '812', '0.1', '0.4', '2433024', '71236', '?', 'Ssl', '09:00', '0:03', '/usr/bin/containerd'],
    ['root', '1044', '0.1', '0.6', '3354372', '98472', '?', 'Ssl', '09:00', '0:04', '/usr/bin/dockerd -H fd:// --containerd=/run/containerd/containerd.sock'],
    ['you', '2201', '0.0', '0.0', '11292', '5376', 'pts/0', 'Ss', '09:00', '0:00', '-bash'],
  ];
  // Each running container: its shim, then its processes with the same PIDs `docker top` shows.
  const boxes: string[][] = [];
  for (const c of Object.values(state.containers)) {
    if (c.status !== 'running' && c.status !== 'paused') continue;
    const st = local(c.startedAt ?? state.clock);
    const since = `${p2(st.getUTCHours())}:${p2(st.getUTCMinutes())}`;
    const { shim, procs } = hostProcesses(state, c);
    boxes.push(['root', String(shim), '0.0', '0.0', '1238004', '13056', '?', 'Sl', since, '0:00', `/usr/bin/containerd-shim-runc-v2 -namespace moby -id ${c.id} -address /run/containerd/containerd.sock`]);
    procs.forEach((p, i) => boxes.push([p.uid, String(p.pid), '0.0', '0.0', '9876', '6012', '?', i === 0 ? 'Ss' : 'S', since, '0:00', p.cmd]));
  }
  boxes.sort((a, b) => Number(a[1]) - Number(b[1]));
  rows.push(...boxes);
  const pid = Math.max(4100, ...boxes.map((r) => Number(r[1]) + 1)) + (state.counter % 50);
  rows.push(['you', String(pid), '0.0', '0.0', '13840', '4608', 'pts/0', 'R+', hhmm, '0:00', 'ps aux']);
  const head = 'USER         PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND';
  const fmt = (r: string[]) =>
    `${r[0]!.padEnd(8)} ${r[1]!.padStart(7)} ${r[2]!.padStart(4)} ${r[3]!.padStart(4)} ${r[4]!.padStart(6)} ${r[5]!.padStart(5)} ${r[6]!.padEnd(8)} ${r[7]!.padEnd(4)} ${r[8]!.padEnd(5)} ${r[9]!.padStart(6)} ${r[10]}`;
  return ok(state, [line(head), ...rows.map((r) => line(fmt(r)))], [], { key: 'sim.docker.explain.psAux' });
};

export const sleep: Fn = (state, args) => {
  const n = Number(args[0] ?? 'x');
  if (!Number.isFinite(n)) return fail(state, out(`sleep: invalid time interval '${args[0] ?? ''}'\nTry 'sleep --help' for more information.`), 'usage');
  return ok(state, [], [], { key: 'sim.docker.explain.sleep', params: { n: String(n) } });
};

export const which: Fn = (state, args) => {
  const known: Record<string, string> = { docker: '/usr/bin/docker', curl: '/usr/bin/curl', bash: '/usr/bin/bash', ls: '/usr/bin/ls', cat: '/usr/bin/cat' };
  const found = args.map((a) => known[a]).filter((x): x is string => Boolean(x));
  return { ...ok(state, found.map((f) => line(f))), ok: found.length === args.length, exitCode: found.length === args.length ? 0 : 1 };
};

export const clear: Fn = (state) => ok(state, [], [{ type: 'cleared' }]);

export const help: Fn = (state) =>
  ok(state, out('This practice laptop knows: docker, curl, ls, cd, pwd, cat, mkdir, touch, rm, cp, echo, env, export,\nchmod, ps, whoami, id, hostname, uname, date, sleep, which, clear. Use ↑ for history.'), [], { key: 'sim.docker.explain.help' });

/** curl on the laptop. */
export const curl: Fn = (state, args) => {
  const silent = args.some((a) => /^-[a-zA-Z]*s/.test(a) && !a.startsWith('--'));
  const showErr = args.some((a) => /^-[a-zA-Z]*S/.test(a));
  const head = args.some((a) => /^-[a-zA-Z]*I/.test(a) || a === '--head');
  const inc = args.some((a) => /^-[a-zA-Z]*i/.test(a) && !a.startsWith('--')) || args.includes('--include');
  const failFlag = args.some((a) => /^-[a-zA-Z]*f/.test(a) || a === '--fail');
  const oIdx = args.findIndex((a) => a === '-o' || a === '--output');
  const outFile = oIdx >= 0 ? args[oIdx + 1] : undefined;
  const url = args.find((a, i) => !a.startsWith('-') && i !== oIdx + 1 || (oIdx < 0 && !a.startsWith('-')));
  if (!url) return fail(state, out("curl: try 'curl --help' or 'curl --manual' for more information"), 'usage', undefined, 2);
  const u = parseUrl(url);
  if (!u) return fail(state, out(`curl: (3) URL rejected: Malformed input to a URL function`), 'badUrl', undefined, 3);
  const s = structuredClone(state);
  const r = httpFetch(s, { kind: 'host' }, u, head ? 'HEAD' : 'GET', 'curl/8.5.0');
  if (!r.ok) {
    if (r.error === 'internet') {
      return { ...fail(state, [], 'noInternet', { key: 'sim.docker.explain.noInternet', params: { host: u.host } }, 6), stopped: true };
    }
    const e = curlError(r);
    const code = r.error === 'refused' ? 'connectionRefused' : r.error === 'reset' ? 'connectionReset' : r.error === 'resolve' ? 'cantResolve' : 'curlFailed';
    const res = fail(s, silent && !showErr ? [] : [line(e.text)], code, { key: `sim.docker.err.${code}`, params: { port: String(u.port), host: u.host } }, e.code);
    return res;
  }
  const events: KitchenEvent[] = [r.event];
  if (failFlag && r.res.status >= 400) {
    return fail(s, silent && !showErr ? [] : [line(`curl: (22) The requested URL returned error: ${r.res.status}`)], 'httpError', { key: 'sim.docker.err.httpError', params: { status: String(r.res.status) } }, 22);
  }
  const text = curlText(r.res, head || inc, !head);
  if (outFile) {
    writeFile(s, resolve(s, outFile), text);
    return ok(s, [], events, { key: 'sim.docker.explain.curlSaved', params: { file: outFile } });
  }
  const explain = { key: r.res.status >= 400 ? 'sim.docker.explain.curlStatus' : 'sim.docker.explain.curl', params: { status: String(r.res.status), name: r.target?.name ?? 'laptop', port: String(u.port) } };
  return ok(s, out(text.replace(/\n$/, '')), events, explain);
};

export const ping: Fn = (state, args) => {
  const host = args.filter((a) => !a.startsWith('-') && !/^\d+$/.test(a))[0] ?? '';
  const ci = args.indexOf('-c');
  const n = ci >= 0 ? Number(args[ci + 1] ?? 1) : 4;
  if (host !== 'localhost' && host !== '127.0.0.1' && host !== state.host.name) {
    if (!host.includes('.')) return fail(state, out(`ping: ${host}: Name or service not known`), 'cantResolve', { key: 'sim.docker.err.cantResolve', params: { host } }, 2);
    return { ...fail(state, [], 'noInternet', { key: 'sim.docker.explain.noInternet', params: { host } }, 2), stopped: true };
  }
  const lines = [`PING ${host} (127.0.0.1) 56(84) bytes of data.`];
  for (let i = 1; i <= n; i++) lines.push(`64 bytes from localhost (127.0.0.1): icmp_seq=${i} ttl=64 time=0.0${30 + i} ms`);
  lines.push('', `--- ${host} ping statistics ---`, `${n} packets transmitted, ${n} received, 0% packet loss, time ${(n - 1) * 1000}ms`, `rtt min/avg/max/mdev = 0.031/0.03${Math.min(9, n)}/0.0${30 + n}/0.004 ms`);
  return ok(state, lines.map((l) => line(l)), [], { key: 'sim.docker.explain.ping' });
};

export const HOST_COMMANDS: Record<string, Fn> = {
  pwd, cd, ls, cat, mkdir, touch, rm, cp, env, printenv: env, export: exportCmd, unset, chmod, whoami, id, hostname, uname, date, ps, sleep, which, clear, help, curl, ping,
};

export const KNOWN_HOST = [...Object.keys(HOST_COMMANDS), 'echo', 'docker', 'true', 'false', 'exit'];

export { DOCKER_VERSION };
