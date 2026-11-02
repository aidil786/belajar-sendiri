// Processes, signals and jobs: ps, top, kill, killall, pkill, pgrep, sleep.
import { badOption, parseOpts, setExplain, shellPrefix, type Ctx, type IO } from './ctx';
import { userByName } from './fs';
import { serviceProcGone } from './services';
import type { Job, LinuxState, Proc, ProcKind } from './types';

export const SIGNALS = [
  'HUP', 'INT', 'QUIT', 'ILL', 'TRAP', 'ABRT', 'BUS', 'FPE', 'KILL', 'USR1', 'SEGV', 'USR2', 'PIPE', 'ALRM', 'TERM', 'STKFLT',
  'CHLD', 'CONT', 'STOP', 'TSTP', 'TTIN', 'TTOU', 'URG', 'XCPU', 'XFSZ', 'VTALRM', 'PROF', 'WINCH', 'POLL', 'PWR', 'SYS',
];

/** "9", "KILL", "SIGKILL", "kill" → 9. */
export function signalNumber(s: string): number | null {
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    return n >= 1 && n <= SIGNALS.length ? n : n === 0 ? 0 : null;
  }
  const name = s.toUpperCase().replace(/^SIG/, '');
  const i = SIGNALS.indexOf(name);
  return i < 0 ? null : i + 1;
}

export interface SpawnSpec {
  pid?: number;
  args: string;
  comm: string;
  kind: ProcKind;
  user?: string;
  ppid?: number;
  tty?: string;
  state?: Proc['state'];
  ends?: number;
  prints?: string[];
  stubborn?: boolean;
  service?: string;
  vsz?: number;
  rss?: number;
}

/** Start a process. Returns its PID. */
export function spawn(ctx: Ctx, spec: SpawnSpec): number {
  const st = ctx.st;
  const pid = spec.pid || st.nextPid++;
  if (pid >= st.nextPid) st.nextPid = pid + 1;
  const p: Proc = {
    pid,
    ppid: spec.ppid ?? ctx.pid,
    user: spec.user ?? ctx.sh.user,
    args: spec.args,
    comm: spec.comm,
    state: spec.state ?? 'S',
    tty: spec.tty ?? 'pts/0',
    start: st.clock,
    vsz: spec.vsz ?? 5800 + ((pid * 37) % 900),
    rss: spec.rss ?? 1900 + ((pid * 53) % 700),
    kind: spec.kind,
  };
  if (spec.ends !== undefined) p.ends = spec.ends;
  if (spec.prints) p.prints = spec.prints;
  if (spec.stubborn) p.stubborn = true;
  if (spec.service) p.service = spec.service;
  st.procs[pid] = p;
  ctx.events.push({ type: 'procStarted', pid, cmd: spec.args });
  return pid;
}

/**
 * A program that keeps running (sleep 300, tail -f, ping, top, an endless script).
 * In a typed command it becomes the foreground program (or a background job with &): returns true.
 * Inside a script it just runs (the caller moves the clock): returns false.
 */
export function goLong(ctx: Ctx, spec: SpawnSpec): boolean {
  if (!ctx.interactive && !ctx.bg) return false;
  const pid = spawn(ctx, { ...spec, pid: ctx.curPid || undefined });
  if (!ctx.bg) ctx.st.fg = { pid, cmd: spec.args };
  return true;
}

export function procOf(st: LinuxState, pid: number): Proc | undefined {
  return st.procs[pid];
}

/** Stop a foreground process (Ctrl+Z): it becomes a stopped job. */
export function stopProc(st: LinuxState, pid: number): Job | null {
  const p = st.procs[pid];
  if (!p) return null;
  p.state = 'T';
  const id = st.jobs.length ? Math.max(...st.jobs.map((j) => j.id)) + 1 : 1;
  const job: Job = { id, pid, cmd: st.fg?.cmd ?? p.args, state: 'Stopped' };
  p.job = id;
  st.jobs.push(job);
  st.fg = null;
  return job;
}

/** End a process (and its children). Updates jobs and the owning service. */
export function endProc(ctx: Ctx, pid: number, sig: string) {
  const st = ctx.st;
  const p = st.procs[pid];
  if (!p) return;
  for (const child of Object.values(st.procs)) if (child.ppid === pid && child.kind !== 'shell') endProc(ctx, child.pid, sig);
  delete st.procs[pid];
  ctx.events.push({ type: 'procEnded', pid, signal: sig });
  if (st.fg?.pid === pid) st.fg = null;
  const job = st.jobs.find((j) => j.pid === pid);
  if (job) {
    job.state = sig === 'KILL' ? 'Killed' : sig === 'TERM' ? 'Terminated' : sig === 'INT' ? 'Interrupt' as never : 'Terminated';
    job.notify = true;
  }
  if (p.service) serviceProcGone(ctx, p, sig);
}

/** Send a signal like kill(2). */
export function signalProc(ctx: Ctx, pid: number, sig: string): 'ok' | 'ESRCH' | 'EPERM' {
  const st = ctx.st;
  const p = st.procs[pid];
  if (!p) return 'ESRCH';
  const me = userByName(st, ctx.sh.user);
  if (me?.uid !== 0 && p.user !== ctx.sh.user) return 'EPERM';
  if (pid === 1) return me?.uid === 0 ? 'ok' : 'EPERM';
  if (sig === '0' as string) return 'ok';
  if (p.kind === 'shell') {
    // An interactive bash ignores TERM and INT; the simulator keeps the learner's shell.
    return 'ok';
  }
  switch (sig) {
    case 'STOP':
    case 'TSTP':
      p.state = 'T';
      ctx.events.push({ type: 'procStopped', pid });
      {
        const job = st.jobs.find((j) => j.pid === pid);
        if (job) {
          job.state = 'Stopped';
          job.notify = true;
        }
      }
      return 'ok';
    case 'CONT':
      if (p.state === 'T') p.state = p.kind === 'script' ? 'R' : 'S';
      {
        const job = st.jobs.find((j) => j.pid === pid);
        if (job && job.state === 'Stopped') job.state = 'Running';
      }
      return 'ok';
    case 'CHLD':
    case 'WINCH':
    case 'URG':
      return 'ok';
    case 'HUP':
      if (p.service === 'nginx' && p.kind === 'daemon') return 'ok'; // nginx reloads its config
      break;
  }
  if (p.stubborn && sig !== 'KILL') return 'ok';
  if (p.state === 'T' && sig !== 'KILL') {
    // A stopped process gets the signal when it continues; bash's kill sends CONT for jobs.
    const job = st.jobs.find((j) => j.pid === pid);
    if (!job) return 'ok';
  }
  endProc(ctx, pid, sig);
  return 'ok';
}

const pad = (s: string | number, w: number) => String(s).padStart(w);

/** "[1]+  Running                 sleep 300 &" */
export function jobLine(st: LinuxState, j: Job, long = false): string {
  const live = st.jobs.filter((x) => x.state === 'Running' || x.state === 'Stopped' || x.notify);
  const idx = live.indexOf(j);
  const mark = idx === live.length - 1 ? '+' : idx === live.length - 2 ? '-' : ' ';
  const status = j.state === 'Done' && j.exit ? `Exit ${j.exit}` : j.state;
  const cmd = j.state === 'Running' ? (j.cmd.endsWith('&') ? j.cmd : `${j.cmd} &`) : j.cmd.replace(/\s*&$/, '');
  return `[${j.id}]${mark}${long ? ` ${j.pid}` : ' '} ${status.padEnd(24)}${cmd}`;
}

/** Messages bash prints before the next prompt: finished or stopped background jobs. */
export function jobNotices(st: LinuxState): string[] {
  const out: string[] = [];
  for (const j of st.jobs) if (j.notify && j.state !== 'Running') out.push(jobLine(st, j));
  for (const j of st.jobs) j.notify = false;
  st.jobs = st.jobs.filter((j) => j.state === 'Running' || j.state === 'Stopped');
  return out;
}

// ---------------------------------------------------------------------------
// ps

function hhmm(t: number): string {
  const d = new Date(t * 1000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

function cpuTime(p: Proc, now: number): number {
  return p.kind === 'script' && p.state === 'R' ? Math.floor((now - p.start) * 0.95) : 0;
}

function pcpu(p: Proc, now: number): string {
  if (p.kind === 'script' && p.state === 'R') return '99.0';
  const age = Math.max(1, now - p.start);
  return (Math.min(99, (cpuTime(p, now) * 100) / age) || (p.pid === 1 ? 0.1 : 0)).toFixed(1);
}

function pmem(p: Proc): string {
  return ((p.rss / 2_000_000) * 100).toFixed(1);
}

export function statOf(st: LinuxState, p: Proc): string {
  let s = p.state;
  if (p.sessionLeader) s += 's';
  if (st.fg?.pid === p.pid || (p.tty === 'pts/0' && p.kind !== 'shell' && p.job === undefined && p.state !== 'T' && st.fg === null && p.kind === 'other')) s += '+';
  return s;
}

function userCol(name: string): string {
  return name.length > 8 ? `${name.slice(0, 7)}+` : name;
}

function sortedProcs(st: LinuxState): Proc[] {
  return Object.values(st.procs).sort((a, b) => a.pid - b.pid);
}

function psSelf(ctx: Ctx, args: string): Proc {
  return { pid: ctx.curPid, ppid: ctx.pid, user: ctx.sh.user, args, comm: 'ps', state: 'R', tty: 'pts/0', start: ctx.st.clock, vsz: 6400, rss: 3756, kind: 'other' };
}

export function psProgram(ctx: Ctx, argv: string[], io: IO): number {
  const st = ctx.st;
  const raw = argv.slice(1);
  const joined = raw.join(' ');
  const bsd = raw.length > 0 && !raw[0]!.startsWith('-');
  const self = psSelf(ctx, ['ps', ...raw].join(' '));
  const all = [...sortedProcs(st), self];
  const now = st.clock;
  if (bsd && /^a?u?x?$/.test(raw[0]!.replace(/[^aux]/g, '')) && /[aux]/.test(raw[0]!)) {
    const flags = raw[0]!;
    const list = flags.includes('x') || flags.includes('a') ? all.filter((p) => flags.includes('x') || p.tty !== '?') : all;
    io.out('USER         PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND\n');
    for (const p of list) {
      const mins = Math.floor(cpuTime(p, now) / 60);
      const secs = cpuTime(p, now) % 60;
      io.out(`${userCol(p.user).padEnd(8)} ${pad(p.pid, 7)} ${pad(pcpu(p, now), 4)} ${pad(pmem(p), 4)} ${pad(p.vsz, 6)} ${pad(p.rss, 5)} ${p.tty.padEnd(8)} ${(p === self ? 'R+' : statOf(st, p)).padEnd(4)} ${hhmm(p.start)} ${pad(`${mins}:${String(secs).padStart(2, '0')}`, 6)} ${p.args}\n`);
    }
    setExplain(ctx, 'linux.explain.psAux', { n: list.length });
    return 0;
  }
  const p = parseOpts(raw, 'efAaux', ['forest'], ['u', 'p', 'C', 'o']);
  if (p.bad) return badOption(io, 'ps', p);
  const full = p.flags.has('f');
  let list: Proc[];
  if (p.flags.has('e') || p.flags.has('A')) list = all;
  else if (p.values.u) list = all.filter((x) => x.user === p.values.u);
  else if (p.values.C) list = all.filter((x) => x.comm === p.values.C);
  else if (p.values.p) list = all.filter((x) => p.values.p!.split(',').map(Number).includes(x.pid));
  else list = all.filter((x) => x.tty === 'pts/0' && x.user === ctx.sh.user);
  const tt = (x: Proc) => {
    const t = cpuTime(x, now);
    return `${String(Math.floor(t / 3600)).padStart(2, '0')}:${String(Math.floor(t / 60) % 60).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
  };
  if (full) {
    io.out('UID          PID    PPID  C STIME TTY          TIME CMD\n');
    for (const x of list) io.out(`${userCol(x.user).padEnd(8)} ${pad(x.pid, 7)} ${pad(x.ppid, 7)} ${pad(x.kind === 'script' && x.state === 'R' ? 99 : 0, 2)} ${hhmm(x.start)} ${x.tty.padEnd(8)} ${tt(x)} ${x.args}\n`);
  } else {
    io.out('    PID TTY          TIME CMD\n');
    for (const x of list) io.out(`${pad(x.pid, 7)} ${x.tty.padEnd(8)} ${tt(x)} ${x.comm.slice(0, 15)}\n`);
  }
  if (!list.length) return 1;
  setExplain(ctx, joined.includes('e') ? 'linux.explain.psAux' : 'linux.explain.ps', { n: list.length });
  return 0;
}

// ---------------------------------------------------------------------------
// top (one snapshot, like `top -b -n 1`)

export function topSnapshot(ctx: Ctx, mem: { total: number; free: number; used: number; cache: number }): string[] {
  const st = ctx.st;
  const now = st.clock;
  const procs = sortedProcs(st);
  const running = procs.filter((p) => p.state === 'R').length + 1;
  const stopped = procs.filter((p) => p.state === 'T').length;
  const busy = procs.some((p) => p.kind === 'script' && p.state === 'R');
  const t = new Date(now * 1000);
  const clock = `${String(t.getUTCHours()).padStart(2, '0')}:${String(t.getUTCMinutes()).padStart(2, '0')}:${String(t.getUTCSeconds()).padStart(2, '0')}`;
  const up = uptimeText(st);
  const load = loadAvg(st);
  const mib = (kb: number) => (kb / 1024).toFixed(1).padStart(8);
  const lines = [
    `top - ${clock} up ${up},  1 user,  load average: ${load}`,
    `Tasks: ${String(procs.length + 1).padStart(3)} total, ${String(running).padStart(3)} running, ${String(procs.length + 1 - running - stopped).padStart(3)} sleeping, ${String(stopped).padStart(3)} stopped,   0 zombie`,
    `%Cpu(s):${busy ? ' 50.0 us,  0.0 sy,  0.0 ni, 50.0 id' : '  0.0 us,  0.0 sy,  0.0 ni,100.0 id'},  0.0 wa,  0.0 hi,  0.0 si,  0.0 st `,
    `MiB Mem : ${mib(mem.total)} total, ${mib(mem.free)} free, ${mib(mem.used)} used, ${mib(mem.cache)} buff/cache     `,
    `MiB Swap:      0.0 total,      0.0 free,      0.0 used. ${mib(mem.free + mem.cache)} avail Mem `,
    '',
    '    PID USER      PR  NI    VIRT    RES    SHR S  %CPU  %MEM     TIME+ COMMAND',
  ];
  const sorted = [...procs].sort((a, b) => Number(pcpu(b, now)) - Number(pcpu(a, now)) || a.pid - b.pid);
  for (const p of sorted) {
    const cpu = p.kind === 'script' && p.state === 'R' ? '100.0' : '0.0';
    const tm = cpuTime(p, now);
    const timePlus = `${Math.floor(tm / 60)}:${String(tm % 60).padStart(2, '0')}.${p.kind === 'script' ? '41' : '00'}`;
    const comm = p.comm.length > 7 ? `${p.comm.slice(0, 7)}+` : p.comm;
    lines.push(`${pad(p.pid, 7)} ${userCol(p.user).padEnd(8)}  20   0 ${pad(p.vsz, 7)} ${pad(p.rss, 6)} ${pad(Math.floor(p.rss * 0.8), 6)} ${p.state} ${pad(cpu, 5)} ${pad(pmem(p), 5)} ${pad(timePlus, 9)} ${comm}`);
  }
  return lines;
}

export function uptimeText(st: LinuxState): string {
  const boot = Number(st.fs['/proc/uptime']?.content?.split(' ')[0] ?? 0);
  const mins = Math.floor((st.clock - boot) / 60);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h < 24) return `${String(h).padStart(2)}:${String(m).padStart(2, '0')}`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? '' : 's'}, ${String(h % 24).padStart(2)}:${String(m).padStart(2, '0')}`;
}

export function loadAvg(st: LinuxState): string {
  const busy = Object.values(st.procs).filter((p) => p.kind === 'script' && p.state === 'R').length;
  return busy ? `${(busy * 0.98).toFixed(2)}, ${(busy * 0.71).toFixed(2)}, ${(busy * 0.33).toFixed(2)}` : '0.00, 0.01, 0.00';
}

// ---------------------------------------------------------------------------
// kill (the program), killall, pkill, pgrep

function matchProcs(ctx: Ctx, pattern: string, exact: boolean, full: boolean, user?: string): Proc[] {
  let re: RegExp;
  try {
    re = new RegExp(pattern);
  } catch {
    re = /$^/;
  }
  return sortedProcs(ctx.st).filter((p) => {
    if (p.kind === 'shell' && p.tty === 'pts/0') return false;
    if (user && p.user !== user) return false;
    const subject = full ? p.args : p.comm;
    return exact ? subject === pattern : re.test(subject);
  });
}

export function pgrepProgram(ctx: Ctx, argv: string[], io: IO, kill?: string): number {
  const name = kill !== undefined ? 'pkill' : 'pgrep';
  let raw = argv.slice(1);
  let sig = 'TERM';
  if (kill !== undefined && raw[0] && /^-[A-Z0-9]+$/i.test(raw[0]) && !/^-[flxau]$/.test(raw[0])) {
    const n = signalNumber(raw[0].slice(1));
    if (n === null) {
      io.err(`${name}: Unknown signal "${raw[0].slice(1)}".\n`);
      return 2;
    }
    sig = SIGNALS[n - 1]!;
    raw = raw.slice(1);
  }
  const p = parseOpts(raw, kill === undefined ? 'flxac' : 'flxa', ['full', 'exact', 'count'], ['u', 's']);
  if (p.bad || p.badLong) return badOption(io, name, p, 2);
  if (p.values.s) {
    const n = signalNumber(p.values.s);
    if (n) sig = SIGNALS[n - 1]!;
  }
  const pat = p.args[0];
  if (pat === undefined) {
    io.err(`${name}: no matching criteria specified\nTry \`${name} --help' for more information.\n`);
    return 2;
  }
  const hits = matchProcs(ctx, pat, p.flags.has('x') || p.flags.has('exact'), p.flags.has('f') || p.flags.has('full'), p.values.u);
  if (kill === undefined && (p.flags.has('c') || p.flags.has('count'))) {
    // -c: how many match (0 still prints, with exit 1).
    io.out(`${hits.length}\n`);
    setExplain(ctx, hits.length ? 'linux.explain.pgrep' : 'linux.explain.noMatch', { n: hits.length, name: pat });
    return hits.length ? 0 : 1;
  }
  if (!hits.length) {
    setExplain(ctx, 'linux.explain.noMatch', { name: pat });
    return 1;
  }
  if (kill === undefined) {
    for (const h of hits) io.out(p.flags.has('l') ? `${h.pid} ${h.comm}\n` : p.flags.has('a') ? `${h.pid} ${h.args}\n` : `${h.pid}\n`);
    setExplain(ctx, 'linux.explain.pgrep', { n: hits.length });
    return 0;
  }
  let any = false;
  for (const h of hits) {
    const r = signalProc(ctx, h.pid, sig);
    if (r === 'EPERM') io.err(`pkill: killing pid ${h.pid} failed: Operation not permitted\n`);
    else any = true;
  }
  setExplain(ctx, any ? 'linux.explain.pkill' : 'linux.err.killDenied', { name: pat, pid: hits[0]!.pid });
  ctx.danger = true;
  return any ? 0 : 1;
}

export function killallProgram(ctx: Ctx, argv: string[], io: IO): number {
  let raw = argv.slice(1);
  let sig = 'TERM';
  if (raw[0] && /^-[A-Z0-9]+$/i.test(raw[0]) && raw[0] !== '-v' && raw[0] !== '-i') {
    const n = signalNumber(raw[0].slice(1));
    if (n === null) {
      io.err(`${raw[0].slice(1)}: unknown signal; killall -l lists signals.\n`);
      return 1;
    }
    sig = SIGNALS[n - 1]!;
    raw = raw.slice(1);
  }
  if (raw[0] === '-s') {
    const n = signalNumber(raw[1] ?? '');
    if (n) sig = SIGNALS[n - 1]!;
    raw = raw.slice(2);
  }
  if (!raw.length) {
    io.err('Usage: killall [OPTION]... [--] NAME...\n');
    return 1;
  }
  let code = 0;
  for (const name of raw) {
    const hits = sortedProcs(ctx.st).filter((p) => p.comm === name && !(p.kind === 'shell' && p.tty === 'pts/0'));
    if (!hits.length) {
      io.err(`${name}: no process found\n`);
      setExplain(ctx, 'linux.explain.noMatch', { name });
      code = 1;
      continue;
    }
    let ok = 0;
    for (const h of hits) {
      if (signalProc(ctx, h.pid, sig) === 'EPERM') io.err(`${name}(${h.pid}): Operation not permitted\n`);
      else ok++;
    }
    if (!ok) code = 1;
    else setExplain(ctx, 'linux.explain.killall', { name, n: ok });
  }
  ctx.danger = true;
  return code;
}

/** procps kill's usage text (on stderr, exit 1). */
const KILL_USAGE = `
Usage:
 kill [options] <pid> [...]

Options:
 <pid> [...]            send signal to every <pid> listed
 -<signal>, -s, --signal <signal>
                        specify the <signal> to be sent
 -q, --queue <value>    integer value to be sent with the signal
 -l, --list=[<signal>]  list all signal names, or convert one to a name
 -L, --table            list all signal names in a nice table

 -h, --help     display this help and exit
 -V, --version  output version information and exit

For more details see kill(1).
`;

/** /usr/bin/kill (procps-ng 4.0), used by `sudo kill`, `env kill` and `/usr/bin/kill`. */
export function killProgram(ctx: Ctx, argv: string[], io: IO): number {
  const prog = argv[0] ?? 'kill';
  const args = argv.slice(1);
  let sig = 'TERM';
  let rest = args;
  let unknown: string | null = null;
  if (args[0] === '-l' || args[0] === '--list') {
    const a = args[1];
    if (a === undefined) {
      // Names wrap after STKFLT, like procps prints them.
      io.out(`${SIGNALS.slice(0, 16).join(' ')}\n${SIGNALS.slice(16).join(' ')}\n`);
      return 0;
    }
    const n = /^\d+$/.test(a) ? Number(a) : null;
    if (n !== null && n >= 1 && n <= SIGNALS.length) io.out(`${SIGNALS[n - 1]}\n`);
    else if (n === null && signalNumber(a) !== null) io.out(`${signalNumber(a)}\n`);
    else io.err(`${prog}: unknown signal name ${a}\n`);
    return 0;
  }
  if (args[0] === '-L' || args[0] === '--table') {
    let out = '';
    // Seven a row; every name but a row's last is padded to 11 columns.
    SIGNALS.forEach((s, i) => {
      const cell = `${String(i + 1).padStart(2)} ${s}`;
      out += (i + 1) % 7 ? cell.padEnd(11) : `${cell}\n`;
    });
    io.out(SIGNALS.length % 7 ? `${out}\n` : out);
    return 0;
  }
  if (args[0] === '-s' || args[0] === '--signal') {
    const s = args[1] ?? '';
    rest = args.slice(2);
    const n = signalNumber(s);
    // An unknown name becomes signal -1: the kernel answers "Invalid argument".
    if (n === null) unknown = s;
    else sig = SIGNALS[n - 1]!;
  } else if (args[0]?.startsWith('-') && !/^-\d+$/.test(args[0]) && args[0] !== '-') {
    const n = signalNumber(args[0].slice(1));
    if (n === null) {
      io.err(`${prog}: invalid argument ${args[0].slice(1, 2)}\n${KILL_USAGE}`);
      return 1;
    }
    sig = SIGNALS[n - 1]!;
    rest = args.slice(1);
  } else if (args[0] && /^-\d+$/.test(args[0])) {
    const n = signalNumber(args[0].slice(1));
    if (n === null) {
      io.err(`${prog}: invalid argument ${args[0].slice(1, 2)}\n${KILL_USAGE}`);
      return 1;
    }
    sig = SIGNALS[n - 1]!;
    rest = args.slice(1);
  }
  if (!rest.length) {
    io.err(KILL_USAGE);
    return 1;
  }
  let code = 0;
  for (const t of rest) {
    if (!/^-?\d+$/.test(t)) {
      io.err(`${prog}: failed to parse argument: '${t}'\n`);
      code = 1;
      continue;
    }
    if (unknown !== null) {
      io.err(`${prog}: (${t}): Invalid argument\n`);
      code = 1;
      continue;
    }
    const r = signalProc(ctx, Number(t), sig);
    if (r !== 'ok') {
      io.err(`${prog}: (${t}): ${r === 'ESRCH' ? 'No such process' : 'Operation not permitted'}\n`);
      code = 1;
    } else setExplain(ctx, sig === 'KILL' ? 'linux.explain.kill9' : 'linux.explain.kill', { pid: t, sig });
  }
  return code;
}

/** bash's signal names: 1–31 (29 is IO), then the real-time ones (34–64). */
export function bashSignalName(n: number): string | null {
  if (n === 0) return 'EXIT';
  if (n >= 1 && n <= 31) return n === 29 ? 'IO' : SIGNALS[n - 1]!;
  if (n === 34) return 'RTMIN';
  if (n >= 35 && n <= 49) return `RTMIN+${n - 34}`;
  if (n >= 50 && n <= 63) return `RTMAX-${64 - n}`;
  if (n === 64) return 'RTMAX';
  return null;
}

/** `kill -l` in bash: every signal, five to a line; or each argument as a name or a number. */
export function bashKillList(prefix: string, args: string[], io: IO): number {
  if (!args.length) {
    let out = '';
    let col = 0;
    for (let n = 1; n <= 64; n++) {
      const name = bashSignalName(n);
      if (!name || n === 32 || n === 33) continue;
      out += `${String(n).padStart(2)}) SIG${name}`;
      if (++col < 5) out += '\t';
      else {
        out += '\n';
        col = 0;
      }
    }
    if (col) out += '\n';
    io.out(out);
    return 0;
  }
  let code = 0;
  for (const a of args) {
    if (/^\d+$/.test(a)) {
      let n = Number(a);
      if (n > 128) n -= 128;
      const name = n === 32 || n === 33 ? null : bashSignalName(n);
      if (name === null) {
        io.err(`${prefix}kill: ${a}: invalid signal specification\n`);
        code = 1;
      } else io.out(`${name}\n`);
      continue;
    }
    const up = a.toUpperCase().replace(/^SIG/, '');
    let n: number | null = null;
    for (let i = 1; i <= 64 && n === null; i++) if (bashSignalName(i) === up) n = i;
    if (n === null && up === 'POLL') n = 29;
    if (n === null) {
      io.err(`${prefix}kill: ${a}: invalid signal specification\n`);
      code = 1;
    } else io.out(`${n}\n`);
  }
  return code;
}

/** sleep N: in a typed command a long sleep keeps the terminal busy; in a script time just moves. */
export function sleepProgram(ctx: Ctx, argv: string[], io: IO): number {
  const arg = argv[1];
  if (arg === undefined) {
    io.err("sleep: missing operand\nTry 'sleep --help' for more information.\n");
    return 1;
  }
  const m = /^(\d+(?:\.\d+)?)([smhd]?)$/.exec(arg);
  if (!m) {
    io.err(`sleep: invalid time interval ‘${arg}’\nTry 'sleep --help' for more information.\n`);
    return 1;
  }
  const secs = Number(m[1]) * ({ '': 1, s: 1, m: 60, h: 3600, d: 86400 } as Record<string, number>)[m[2]!]!;
  if ((ctx.bg || (ctx.interactive && secs > 15)) && goLong(ctx, { args: argv.join(' '), comm: 'sleep', kind: 'sleep', ends: ctx.st.clock + Math.ceil(secs) })) {
    setExplain(ctx, ctx.bg ? 'linux.explain.background' : 'linux.explain.sleepLong', { n: 1, pid: ctx.curPid, secs });
    return 0;
  }
  ctx.st.clock += Math.ceil(secs);
  setExplain(ctx, 'linux.explain.sleep', { secs });
  return 0;
}

/** Background sleeps that finished by now; called after every command. */
export function reapFinished(ctx: Ctx) {
  for (const p of Object.values(ctx.st.procs)) {
    if (p.ends !== undefined && p.ends > 0 && p.ends <= ctx.st.clock && ctx.st.fg?.pid !== p.pid) {
      const job = ctx.st.jobs.find((j) => j.pid === p.pid);
      delete ctx.st.procs[p.pid];
      if (job) {
        job.state = 'Done';
        job.notify = true;
      }
    }
  }
}

export { pad, shellPrefix };
