// System programs: date env printenv which hostname uname nproc free uptime df top clear
// crontab ssh-keygen ssh scp rsync apt apt-get dpkg bash sh mktemp true false yes.
import { askTerminal, hasTerminal } from '../ask';
import { errText, parseOpts, q, setExplain, umaskOf, type Ctx, type IO } from '../ctx';
import { absPath, childNames, joinPath, lookup, lookupParent, userByName } from '../fs';
import { goLong, loadAvg, topSnapshot, uptimeText } from '../procs';
import { hexId } from '../services';
import { human, lq, readFile, type Program } from './files';
import type { AptPackage } from '../types';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const FULL_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const FULL_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function dateText(t: number, fmt?: string): string {
  const d = new Date(t * 1000);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  if (!fmt) return `${DAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2)} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} UTC ${d.getUTCFullYear()}`;
  return fmt.replace(/%([a-zA-Z%])/g, (_m, c: string) => {
    switch (c) {
      case 'Y':
        return String(d.getUTCFullYear());
      case 'm':
        return p(d.getUTCMonth() + 1);
      case 'd':
        return p(d.getUTCDate());
      case 'e':
        return String(d.getUTCDate()).padStart(2);
      case 'H':
        return p(d.getUTCHours());
      case 'M':
        return p(d.getUTCMinutes());
      case 'S':
        return p(d.getUTCSeconds());
      case 'F':
        return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
      case 'T':
        return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
      case 's':
        return String(t);
      case 'a':
        return DAYS[d.getUTCDay()]!;
      case 'A':
        return FULL_DAYS[d.getUTCDay()]!;
      case 'b':
        return MONTHS[d.getUTCMonth()]!;
      case 'B':
        return FULL_MONTHS[d.getUTCMonth()]!;
      case 'Z':
        return 'UTC';
      case 'z':
        return '+0000';
      case 'j':
        return p(Math.floor((t - Date.UTC(d.getUTCFullYear(), 0, 1) / 1000) / 86400) + 1, 3);
      case '%':
        return '%';
      default:
        return `%${c}`;
    }
  });
}

const UNIT_SECS: Record<string, number> = { sec: 1, second: 1, min: 60, minute: 60, hour: 3600, day: 86400, week: 604800, fortnight: 1209600 };

/**
 * The few `date -d` strings the lessons need (GNU date reads many more): now, today, tomorrow,
 * yesterday, @SECONDS, 2026-11-02 [10:30[:00]], and "N units [ago]" / "+N units". null: invalid.
 */
export function parseDateString(now: number, s: string): number | null {
  const t = s.trim().toLowerCase();
  if (t === '' || t === 'now' || t === 'today') return now;
  if (t === 'tomorrow') return now + 86400;
  if (t === 'yesterday') return now - 86400;
  let m = /^@(-?\d+)$/.exec(t);
  if (m) return Number(m[1]);
  m = /^(\d{4})-(\d{2})-(\d{2})(?:[ t](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(t);
  if (m) {
    const [y, mo, d, h, mi, se] = m.slice(1).map((x) => Number(x ?? 0)) as number[];
    if (mo! < 1 || mo! > 12 || d! < 1 || d! > 31 || h! > 23 || mi! > 59 || se! > 59) return null;
    return Date.UTC(y!, mo! - 1, d!, h!, mi!, se!) / 1000;
  }
  m = /^([+-]?\d+) *(sec|second|min|minute|hour|day|week|fortnight)s?( ago)?$/.exec(t);
  if (m) return now + Number(m[1]) * UNIT_SECS[m[2]!]! * (m[3] ? -1 : 1);
  return null;
}

export const date: Program = (ctx, argv, io) => {
  const args = argv.slice(1);
  const fmt = args.find((a) => a.startsWith('+'));
  let t = ctx.st.clock;
  const di = args.findIndex((a) => a === '-d' || a === '--date' || a.startsWith('--date=') || (a.startsWith('-d') && a.length > 2));
  if (di >= 0) {
    const a = args[di]!;
    const spec = a === '-d' || a === '--date' ? (args[di + 1] ?? '') : a.startsWith('--date=') ? a.slice(7) : a.slice(2);
    const parsed = parseDateString(ctx.st.clock, spec);
    if (parsed === null) {
      io.err(`date: invalid date ${lq(spec)}\n`);
      return 1;
    }
    t = parsed;
  }
  io.out(`${dateText(t, fmt?.slice(1))}\n`);
  setExplain(ctx, 'linux.explain.date');
  return 0;
};

export const env: Program = (ctx, argv, io) => {
  const args = argv.slice(1);
  const sets: [string, string][] = [];
  let i = 0;
  for (; i < args.length && /^[A-Za-z_]\w*=/.test(args[i]!); i++) {
    const [k, ...v] = args[i]!.split('=');
    sets.push([k!, v.join('=')]);
  }
  if (i < args.length) {
    const saved = ctx.sh;
    ctx.sh = { ...saved, vars: { ...saved.vars, ...Object.fromEntries(sets) }, exported: [...saved.exported, ...sets.map(([k]) => k)] };
    try {
      return ctx.exec(args.slice(i), io);
    } finally {
      ctx.sh = saved;
    }
  }
  for (const k of ctx.sh.exported) if (ctx.sh.vars[k] !== undefined) io.out(`${k}=${ctx.sh.vars[k]}\n`);
  for (const [k, v] of sets) io.out(`${k}=${v}\n`);
  setExplain(ctx, 'linux.explain.env');
  return 0;
};

export const printenv: Program = (ctx, argv, io) => {
  const names = argv.slice(1);
  if (!names.length) return env(ctx, ['env'], io);
  let code = 0;
  for (const n of names) {
    const v = ctx.sh.exported.includes(n) ? ctx.sh.vars[n] : undefined;
    if (v === undefined) code = 1;
    else io.out(`${v}\n`);
  }
  setExplain(ctx, code ? 'linux.explain.printenvNone' : 'linux.explain.printenv', { name: names[0]! });
  return code;
};

export const which: Program = (ctx, argv, io) => {
  let code = 0;
  for (const name of argv.slice(1).filter((a) => !a.startsWith('-'))) {
    let found: string | null = null;
    if (name.includes('/')) {
      const f = lookup(ctx.st, ctx.sh.user, absPath(ctx.sh.cwd, name));
      if (f.ok && f.node.type === 'file' && f.node.mode & 0o111) found = name;
    } else
      for (const dir of (ctx.sh.vars.PATH ?? '').split(':')) {
        const f = lookup(ctx.st, ctx.sh.user, `${dir}/${name}`);
        if (f.ok && f.node.type === 'file' && f.node.mode & 0o111) {
          found = `${dir}/${name}`;
          break;
        }
      }
    if (found) io.out(`${found}\n`);
    else code = 1;
  }
  setExplain(ctx, code ? 'linux.explain.whichNone' : 'linux.explain.which', { name: argv[1] ?? '' });
  return code;
};

export const hostname: Program = (ctx, argv, io) => {
  if (argv[1] === '-I') io.out(`${ctx.st.net.ifaces.filter((i) => !i.loopback).map((i) => i.ipv4).join(' ')} \n`);
  else if (argv[1] === '-i') io.out(`${ctx.st.net.ifaces.find((i) => !i.loopback)?.ipv4 ?? '127.0.1.1'}\n`);
  else io.out(`${ctx.st.hostname}\n`);
  setExplain(ctx, 'linux.explain.hostname', { name: ctx.st.hostname });
  return 0;
};

export const KERNEL = '6.12.113+deb13-amd64';

export const uname: Program = (ctx, argv, io) => {
  const a = argv.slice(1).join('');
  const parts: string[] = [];
  const all = a.includes('a');
  if (all || a.includes('s') || !a) parts.push('Linux');
  if (all || a.includes('n')) parts.push(ctx.st.hostname);
  if (all || a.includes('r')) parts.push(KERNEL);
  if (all || a.includes('v')) parts.push('#1 SMP PREEMPT_DYNAMIC Debian 6.12.113-1');
  if (all || a.includes('m')) parts.push('x86_64');
  if (all || a.includes('o')) parts.push('GNU/Linux');
  io.out(`${parts.join(' ')}\n`);
  setExplain(ctx, 'linux.explain.uname');
  return 0;
};

export const nproc: Program = (ctx, _argv, io) => {
  io.out('2\n');
  setExplain(ctx, 'linux.explain.nproc');
  return 0;
};

/** Memory of the practice server (KiB): a 2 GB VPS. */
export function memInfo(ctx: Ctx) {
  const procKb = Object.values(ctx.st.procs).reduce((s, p) => s + p.rss, 0);
  const total = 2014900;
  const used = 182000 + procKb;
  const cache = 412300;
  return { total, used, cache, free: total - used - cache, shared: 1020 };
}

export const free: Program = (ctx, argv, io) => {
  const h = argv.includes('-h');
  const m = memInfo(ctx);
  const fmt = (kb: number) => {
    if (!h) return String(kb);
    if (kb === 0) return '0B';
    if (kb >= 1024 * 1024) return `${(kb / 1024 / 1024).toFixed(1)}Gi`;
    if (kb >= 1024) return `${Math.round(kb / 1024)}Mi`;
    return `${kb}Ki`;
  };
  const w = h ? 11 : 11;
  io.out(`${' '.repeat(15)}total        used        free      shared  buff/cache   available\n`);
  io.out(`Mem:  ${[m.total, m.used, m.free, m.shared, m.cache, m.free + m.cache].map((x) => fmt(x).padStart(w)).join(' ')}\n`);
  io.out(`Swap: ${[0, 0, 0].map((x) => fmt(x).padStart(w)).join(' ')}\n`);
  setExplain(ctx, 'linux.explain.free');
  return 0;
};

export const uptime: Program = (ctx, argv, io) => {
  const d = new Date(ctx.st.clock * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  if (argv[1] === '-p') {
    io.out(`up ${uptimeText(ctx.st).replace(/(\d+) min/, (_m, n: string) => `${n} minute${n === '1' ? '' : 's'}`)}\n`);
    return 0;
  }
  io.out(` ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} up ${uptimeText(ctx.st)},  1 user,  load average: ${loadAvg(ctx.st)}\n`);
  setExplain(ctx, 'linux.explain.uptime');
  return 0;
};

/** Disk use of / in bytes: the system plus every file's size (big logs fill the disk). */
export function diskUsed(ctx: Ctx): number {
  let sum = 2_150_000_000;
  for (const n of Object.values(ctx.st.fs)) if (n.type === 'file' && n.size !== undefined && n.content === undefined && n.size > 50_000_000) sum += n.size;
  return sum;
}

export const DISK_SIZE = 20_957_446_144;

export const df: Program = (ctx, argv, io) => {
  const h = argv.includes('-h');
  const used = Math.min(DISK_SIZE, diskUsed(ctx));
  const kb = (b: number) => Math.round(b / 1024);
  const total = kb(DISK_SIZE);
  const usedK = kb(used);
  const availK = Math.max(0, total - usedK - kb(1_070_000_000));
  const pct = (u: number, a: number) => `${Math.ceil((u * 100) / Math.max(1, u + a))}%`;
  const rows: [string, number, number, number, string][] = [
    ['udev', 985600, 0, 985600, '/dev'],
    ['tmpfs', 201492, 528, 200964, '/run'],
    ['/dev/vda1', total, usedK, availK, '/'],
    ['tmpfs', 1007448, 0, 1007448, '/dev/shm'],
    ['tmpfs', 5120, 0, 5120, '/run/lock'],
    ['tmpfs', 1007448, 4, 1007444, '/tmp'],
    ['/dev/vda15', 126678, 12054, 114624, '/boot/efi'],
    ['tmpfs', 201488, 4, 201484, '/run/user/1000'],
  ];
  const args = argv.slice(1).filter((a) => !a.startsWith('-'));
  const only = args.length ? rows.filter((r) => args.some((a) => (absPath(ctx.sh.cwd, a) === '/' || !['/dev', '/run', '/dev/shm', '/run/lock', '/tmp', '/boot/efi', '/run/user/1000'].some((mnt) => absPath(ctx.sh.cwd, a).startsWith(mnt)) ? r[4] === '/' : absPath(ctx.sh.cwd, a).startsWith(r[4])))) : rows;
  const fmt = (k: number) => (h ? (k === 0 ? '0' : human(k * 1024)) : String(k));
  if (h) io.out('Filesystem      Size  Used Avail Use% Mounted on\n');
  else io.out('Filesystem     1K-blocks    Used Available Use% Mounted on\n');
  for (const r of only) {
    if (h) io.out(`${r[0].padEnd(15)} ${fmt(r[1]).padStart(4)}  ${fmt(r[2]).padStart(4)} ${fmt(r[3]).padStart(5)} ${pct(r[2], r[3]).padStart(4)} ${r[4]}\n`);
    else io.out(`${r[0].padEnd(14)} ${String(r[1]).padStart(9)} ${String(r[2]).padStart(7)} ${String(r[3]).padStart(9)} ${pct(r[2], r[3]).padStart(4)} ${r[4]}\n`);
  }
  setExplain(ctx, used / DISK_SIZE > 0.9 ? 'linux.explain.dfFull' : 'linux.explain.df', { pct: pct(usedK, availK) });
  return 0;
};

export const top: Program = (ctx, argv, io) => {
  const lines = topSnapshot(ctx, memInfo(ctx));
  io.out(`${lines.join('\n')}\n`);
  const batch = argv.includes('-b');
  if (!batch && goLong(ctx, { args: 'top', comm: 'top', kind: 'top' })) setExplain(ctx, 'linux.explain.topLive');
  else setExplain(ctx, 'linux.explain.top');
  return 0;
};

export const clear: Program = (ctx) => {
  ctx.events.push({ type: 'cleared' });
  return 0;
};

export const trueProg: Program = () => 0;
export const falseProg: Program = () => 1;

export const mktemp: Program = (ctx, argv, io) => {
  const dir = argv.includes('-d');
  const name = `/tmp/tmp.${hexId(ctx.st, 10).replace(/[0-9]/g, (c) => 'AbCdEfGhIj'[Number(c)]!)}`;
  const u = userByName(ctx.st, ctx.sh.user)!;
  ctx.st.fs[name] = dir ? { type: 'dir', mode: 0o700, uid: u.uid, gid: u.gid, mtime: ctx.st.clock } : { type: 'file', mode: 0o600, uid: u.uid, gid: u.gid, mtime: ctx.st.clock, content: '' };
  io.out(`${name}\n`);
  return 0;
};

export const yes: Program = (ctx, argv, io) => {
  const word = argv.slice(1).join(' ') || 'y';
  for (let i = 0; i < 5; i++) io.out(`${word}\n`);
  if (goLong(ctx, { args: argv.join(' '), comm: 'yes', kind: 'other', state: 'R' })) return 0;
  return 0;
};

// ---------------------------------------------------------------------------
// bash / sh

export const bash: Program = (ctx, argv, io) => {
  const args = argv.slice(1);
  if (args[0] === '-c') {
    const src = args[1] ?? '';
    if (!args[1]) {
      io.err(`${argv[0]}: -c: option requires an argument\n`);
      return 2;
    }
    return ctx.runSource(src, io, { arg0: args[2] ?? argv[0]!, args: args.slice(3) });
  }
  const opts = args.filter((a) => /^-[nxev]+$/.test(a));
  const rest = args.filter((a) => !/^-[nxev]+$/.test(a));
  const file = rest[0];
  if (!file) {
    if (ctx.interactive) {
      io.out('');
      setExplain(ctx, 'linux.explain.subshell');
    }
    return 0;
  }
  const text = readScript(ctx, io, argv[0]!, file);
  if (text === null) return 127;
  if (opts.some((o) => o.includes('n'))) {
    try {
      // Syntax check only.
      return ctx.runSource(`: ${''}`, io, { arg0: file, args: [] }) && 0;
    } catch {
      return 2;
    }
  }
  const pre = opts.some((o) => o.includes('x')) ? 'set -x\n' : '';
  const code = ctx.runSource(pre + text, io, { arg0: file, args: rest.slice(1), script: file });
  ctx.st.scriptExits[absPath(ctx.sh.cwd, file)] = code;
  if (ctx.forever) {
    ctx.forever = false;
    const pid = ctx.curPid;
    ctx.st.procs[pid] = { pid, ppid: ctx.pid, user: ctx.sh.user, args: argv.join(' '), comm: 'bash', state: 'R', tty: 'pts/0', start: ctx.st.clock, vsz: 7240, rss: 3480, kind: 'script' };
    if (!ctx.bg && ctx.interactive) ctx.st.fg = { pid, cmd: argv.join(' ') };
    setExplain(ctx, ctx.bg ? 'linux.explain.background' : 'linux.explain.foreground', { pid, n: 1 });
    return 0;
  }
  setExplain(ctx, code === 0 ? 'linux.explain.scriptOk' : 'linux.explain.scriptFail', { name: file, code });
  return code;
};

function readScript(ctx: Ctx, io: IO, prog: string, file: string): string | null {
  const f = lookup(ctx.st, ctx.sh.user, absPath(ctx.sh.cwd, file));
  if (!f.ok) {
    io.err(`${prog}: ${file}: ${errText(f.err)}\n`);
    setExplain(ctx, 'linux.err.noFile', { name: file });
    return null;
  }
  if (f.node.type === 'dir') {
    io.err(`${prog}: ${file}: Is a directory\n`);
    return null;
  }
  const t = readFile(ctx, io, prog, file);
  return t;
}

// ---------------------------------------------------------------------------
// crontab (files in /var/spool/cron/crontabs/<user>)

export const crontab: Program = (ctx, argv, io) => {
  const args = argv.slice(1);
  let user = ctx.sh.user;
  const uIdx = args.indexOf('-u');
  if (uIdx >= 0) {
    const want = args[uIdx + 1] ?? '';
    if (userByName(ctx.st, ctx.sh.user)?.uid !== 0 && want !== ctx.sh.user) {
      io.err('must be privileged to use -u\n');
      return 1;
    }
    user = want;
  }
  const rest = uIdx < 0 ? args : args.filter((_a, i) => i !== uIdx && i !== uIdx + 1);
  const path = `/var/spool/cron/crontabs/${user}`;
  const cur = ctx.st.fs[path];
  if (rest[0] === '-l') {
    if (!cur) {
      io.err(`no crontab for ${user}\n`);
      setExplain(ctx, 'linux.explain.crontabNone');
      return 1;
    }
    io.out(cur.content ?? '');
    setExplain(ctx, 'linux.explain.crontabList', { n: cronLines(cur.content ?? '').length });
    return 0;
  }
  if (rest[0] === '-r') {
    if (!cur) {
      io.err(`no crontab for ${user}\n`);
      return 1;
    }
    delete ctx.st.fs[path];
    ctx.danger = true;
    setExplain(ctx, 'linux.explain.crontabRemoved');
    return 0;
  }
  if (rest[0] === '-e') {
    if (!cur) io.err(`no crontab for ${user} - using an empty one\n`);
    io.err('/usr/bin/sensible-editor: 25: editor: not found\n');
    setExplain(ctx, 'linux.err.noEditor', { file: `crontab.txt` });
    return 1;
  }
  const file = rest[0];
  if (!file) {
    io.err('crontab: usage error: file name or - (for stdin) must be specified\n');
    return 1;
  }
  const text = file === '-' ? (io.stdin ?? '') : readFile(ctx, io, 'crontab', file);
  if (text === null) return 1;
  if (text && !text.endsWith('\n')) {
    io.err("new crontab file is missing newline before EOF, can't install.\n");
    setExplain(ctx, 'linux.err.cronBad');
    return 1;
  }
  const bad = cronCheck(text);
  if (bad) {
    // Vixie cron names the field, and counts the lines it had read: "-":0: bad hour on line 1.
    io.err(`"${file}":${bad.line}: ${bad.msg}\nerrors in crontab file, can't install.\n`);
    setExplain(ctx, 'linux.err.cronBad');
    return 1;
  }
  const u = userByName(ctx.st, user)!;
  const crontabGid = ctx.st.groups.find((g) => g.name === 'crontab')?.gid ?? 0;
  ctx.st.fs[path] = { type: 'file', mode: 0o600, uid: u.uid, gid: crontabGid, mtime: ctx.st.clock, content: text };
  setExplain(ctx, 'linux.explain.crontabInstalled', { n: cronLines(text).length });
  return 0;
};

export function cronLines(text: string): string[] {
  return text.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#') && !/^\s*[A-Za-z_][A-Za-z0-9_]*\s*=/.test(l));
}

const CRON_FIELDS: { name: string; lo: number; hi: number; names?: string[]; base?: number }[] = [
  { name: 'minute', lo: 0, hi: 59 },
  { name: 'hour', lo: 0, hi: 23 },
  { name: 'day-of-month', lo: 1, hi: 31 },
  { name: 'month', lo: 1, hi: 12, names: ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'], base: 1 },
  { name: 'day-of-week', lo: 0, hi: 7, names: ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'], base: 0 },
];

const CRON_SPECIALS = ['reboot', 'yearly', 'annually', 'monthly', 'weekly', 'daily', 'midnight', 'hourly'];

/** The values one crontab time field allows (Vixie cron's rules), or null when cron rejects it. */
function cronField(spec: string, f: (typeof CRON_FIELDS)[number]): Set<number> | null {
  const out = new Set<number>();
  const num = (x: string): number => {
    if (/^\d+$/.test(x)) return Number(x);
    const i = f.names?.indexOf(x.toLowerCase()) ?? -1;
    return i < 0 ? NaN : i + f.base!;
  };
  for (const part of spec.split(',')) {
    const m = /^(\*|[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*)(?:\/(\d+))?$/.exec(part);
    if (!m) return null;
    const step = m[2] !== undefined ? Number(m[2]) : 1;
    if (step < 1) return null;
    let lo = f.lo;
    let hi = f.hi;
    if (m[1] !== '*') {
      const ends = m[1]!.split('-').map(num);
      if (ends.some((n) => Number.isNaN(n) || n < f.lo || n > f.hi)) return null;
      lo = ends[0]!;
      // "N/step" runs from N to the end; cron ignores anything after a second "-".
      hi = ends.length > 1 ? ends[1]! : m[2] !== undefined ? f.hi : lo;
    }
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  if (f.name === 'day-of-week' && out.has(7)) out.add(0);
  return out;
}

/** Vixie cron's check: the first mistake as `"file":N: bad hour` would say it, or null. */
function cronCheck(text: string): { line: number; msg: string } | null {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i]!.trim();
    if (!t || t.startsWith('#') || /^[A-Za-z_][A-Za-z0-9_]*\s*=/.test(t)) continue;
    const tokens = t.split(/\s+/);
    // cron counts the lines it has read: a mistake found at the end of a line counts that line too.
    if (t.startsWith('@')) {
      if (!CRON_SPECIALS.includes(tokens[0]!.slice(1).toLowerCase())) return { line: i + (tokens.length === 1 ? 1 : 0), msg: 'bad time specifier' };
      continue;
    }
    for (let f = 0; f < 5; f++) {
      const tok = tokens[f];
      if (tok === undefined) return { line: i + 1, msg: `bad ${CRON_FIELDS[f]!.name}` };
      if (!cronField(tok, CRON_FIELDS[f]!)) return { line: i + (f === tokens.length - 1 ? 1 : 0), msg: `bad ${CRON_FIELDS[f]!.name}` };
    }
  }
  return null;
}

/** Does a crontab line run at minute `t` (seconds since the epoch, UTC)? */
export function cronDue(line: string, t: number): boolean {
  const d = new Date(t * 1000);
  const t2 = line.trim();
  const min = d.getUTCMinutes();
  const hour = d.getUTCHours();
  if (t2.startsWith('@')) {
    const kw = t2.split(/\s+/)[0]!.slice(1).toLowerCase();
    const midnight = min === 0 && hour === 0;
    if (kw === 'hourly') return min === 0;
    if (kw === 'daily' || kw === 'midnight') return midnight;
    if (kw === 'weekly') return midnight && d.getUTCDay() === 0;
    if (kw === 'monthly') return midnight && d.getUTCDate() === 1;
    if (kw === 'yearly' || kw === 'annually') return midnight && d.getUTCDate() === 1 && d.getUTCMonth() === 0;
    return false;
  }
  const f = t2.split(/\s+/);
  const sets = CRON_FIELDS.map((fd, i) => cronField(f[i] ?? '', fd));
  if (sets.some((x) => x === null)) return false;
  const [m, h, dom, mon, dow] = sets as Set<number>[];
  if (!m!.has(min) || !h!.has(hour) || !mon!.has(d.getUTCMonth() + 1)) return false;
  // Both day fields set: either may match (cron's rule); otherwise the set one decides.
  const domStar = f[2]!.startsWith('*');
  const dowStar = f[4]!.startsWith('*');
  const domOk = dom!.has(d.getUTCDate());
  const dowOk = dow!.has(d.getUTCDay());
  return !domStar && !dowStar ? domOk || dowOk : domOk && dowOk;
}

export function cronCommand(line: string): string {
  const t = line.trim();
  if (t.startsWith('@')) return t.split(/\s+/).slice(1).join(' ');
  return t.split(/\s+/).slice(5).join(' ');
}

// ---------------------------------------------------------------------------
// ssh-keygen (real file layout and messages; the key itself is made up for practice)

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function fakeBytes(ctx: Ctx, n: number): number[] {
  const hex = hexId(ctx.st, n * 2);
  return Array.from({ length: n }, (_v, i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16));
}

function b64(bytes: number[]): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const [a, b, c] = [bytes[i]!, bytes[i + 1], bytes[i + 2]];
    out += B64[a >> 2]! + B64[((a & 3) << 4) | ((b ?? 0) >> 4)]! + (b === undefined ? '=' : B64[((b & 15) << 2) | ((c ?? 0) >> 6)]!) + (c === undefined ? '=' : B64[c & 63]!);
  }
  return out;
}

/** OpenSSH's "drunken bishop" randomart for a fingerprint. */
export function randomart(fp: number[], title: string, hash = 'SHA256'): string[] {
  const W = 17;
  const H = 9;
  const field = Array.from({ length: W }, () => new Array<number>(H).fill(0));
  let x = Math.floor(W / 2);
  let y = Math.floor(H / 2);
  for (const byte of fp) {
    let input = byte;
    for (let b = 0; b < 4; b++) {
      x += input & 1 ? 1 : -1;
      y += input & 2 ? 1 : -1;
      x = Math.max(0, Math.min(x, W - 1));
      y = Math.max(0, Math.min(y, H - 1));
      if (field[x]![y]! < 14 - 2) field[x]![y]!++;
      input >>= 2;
    }
  }
  const aug = ' .o+=*BOX@%&#/^SE';
  field[Math.floor(W / 2)]![Math.floor(H / 2)] = aug.length - 2;
  field[x]![y] = aug.length - 1;
  const t = `[${title}]`;
  const pad = Math.floor((W - t.length) / 2);
  const top = `+${'-'.repeat(pad)}${t}${'-'.repeat(W - pad - t.length)}+`;
  const rows: string[] = [top];
  for (let yy = 0; yy < H; yy++) {
    let row = '|';
    for (let xx = 0; xx < W; xx++) row += aug[Math.min(field[xx]![yy]!, aug.length - 1)];
    rows.push(`${row}|`);
  }
  const h = `[${hash}]`;
  const hp = Math.floor((W - h.length) / 2);
  rows.push(`+${'-'.repeat(hp)}${h}${'-'.repeat(W - hp - h.length)}+`);
  return rows;
}

export const sshKeygen: Program = (ctx, argv, io0) => {
  const p = parseOpts(argv.slice(1), 'lqyv', [], ['t', 'C', 'f', 'N', 'b']);
  // -q: quiet, nothing on stdout (errors still show).
  const io: IO = p.flags.has('q') && !p.flags.has('l') ? { ...io0, out: () => undefined } : io0;
  const st = ctx.st;
  const home = ctx.sh.vars.HOME ?? '/';
  const type = (p.values.t ?? 'ed25519').toLowerCase();
  if (!['ed25519', 'rsa', 'ecdsa'].includes(type)) {
    io.err(`unknown key type ${type}\n`);
    return 1;
  }
  if (p.flags.has('l')) {
    const file = absPath(ctx.sh.cwd, (p.values.f ?? `${home}/.ssh/id_ed25519`).replace(/^~/, home));
    const pub = lookup(st, ctx.sh.user, file.endsWith('.pub') ? file : `${file}.pub`);
    if (!pub.ok) {
      io.err(`${p.values.f ?? `${home}/.ssh/id_ed25519`} is not a public key file.\n`);
      return 255;
    }
    const parts = (pub.node.content ?? '').trim().split(' ');
    io.out(`256 SHA256:${fingerprintOf(parts[1] ?? '')} ${parts.slice(2).join(' ') || 'no comment'} (ED25519)\n`);
    setExplain(ctx, 'linux.explain.sshFingerprint');
    return 0;
  }
  const file = absPath(ctx.sh.cwd, (p.values.f ?? `${home}/.ssh/id_${type}`).replace(/^~/, home));
  // Messages name the file as typed after -f (keys/k), or the full default path.
  const shownFile = p.values.f ?? file;
  const comment = p.values.C ?? `${ctx.sh.user}@${st.hostname}`;
  // The order and words of OpenSSH 10.0 on Debian 13 (checked 2026-11-01): the file question when
  // -f is missing, the new folder, then the passphrase questions when -N is missing.
  io.out(`Generating public/private ${type} key pair.\n`);
  if (p.values.f === undefined) io.out(`Enter file in which to save the key (${shownFile}): \n`);
  if (lookup(st, ctx.sh.user, file).ok) {
    io.out(`${shownFile} already exists.\nOverwrite (y/n)? \n`);
    setExplain(ctx, 'linux.err.keyExists');
    return 1;
  }
  const dir = file.slice(0, file.lastIndexOf('/'));
  const u = userByName(st, ctx.sh.user)!;
  if (!lookup(st, ctx.sh.user, dir).ok) {
    const par = lookupParent(st, ctx.sh.user, dir);
    // ssh-keygen makes only ~/.ssh itself; another missing folder is an error.
    if (!par.ok || dir !== `${home}/.ssh`) {
      io.err(`Saving key "${shownFile}" failed: No such file or directory\n`);
      return 1;
    }
    st.fs[dir] = { type: 'dir', mode: 0o700, uid: u.uid, gid: u.gid, mtime: st.clock };
    io.out(`Created directory '${dir}'.\n`);
  }
  if (p.values.N === undefined) {
    io.err(`Enter passphrase for "${shownFile}" (empty for no passphrase): \n`);
    io.err('Enter same passphrase again: \n');
  }
  const keyBytes = [0, 0, 0, 11, ...'ssh-ed25519'.split('').map((c) => c.charCodeAt(0)), 0, 0, 0, 32, ...fakeBytes(ctx, 32)];
  const pubB64 = b64(keyBytes);
  const pubLine = `ssh-${type === 'rsa' ? 'rsa' : 'ed25519'} ${pubB64} ${comment}\n`;
  // An unencrypted ed25519 key file is 98 bytes of header and public key plus a private part padded
  // to 8 bytes (131 + the comment), in base64 lines of 70: 399 bytes for "you@laptop", like ssh-keygen.
  const blobLen = 98 + Math.ceil((131 + new TextEncoder().encode(comment).length) / 8) * 8;
  const body = b64(fakeBytes(ctx, blobLen)).replace(/.{70}/g, '$&\n').replace(/\n$/, '');
  st.fs[file] = { type: 'file', mode: 0o600, uid: u.uid, gid: u.gid, mtime: st.clock, content: `-----BEGIN OPENSSH PRIVATE KEY-----\n${body}\n-----END OPENSSH PRIVATE KEY-----\n` };
  st.fs[`${file}.pub`] = { type: 'file', mode: 0o644, uid: u.uid, gid: u.gid, mtime: st.clock, content: pubLine };
  const fp = fingerprintBytes(pubB64);
  io.out(`Your identification has been saved in ${shownFile}\n`);
  io.out(`Your public key has been saved in ${shownFile}.pub\n`);
  io.out('The key fingerprint is:\n');
  io.out(`SHA256:${b64(fp).replace(/=+$/, '')} ${comment}\n`);
  io.out("The key's randomart image is:\n");
  for (const r of randomart(fp, `${type.toUpperCase()} ${type === 'rsa' ? 3072 : 256}`)) io.out(`${r}\n`);
  ctx.events.push({ type: 'fileWritten', path: file }, { type: 'fileWritten', path: `${file}.pub` });
  setExplain(ctx, 'linux.explain.sshKeygen', { file: shownFile });
  return 0;
};

function fingerprintBytes(pub: string): number[] {
  const out: number[] = [];
  let h = 2166136261;
  for (let i = 0; i < 32; i++) {
    for (const c of pub) h = Math.imul(h ^ c.charCodeAt(0) ^ i, 16777619) >>> 0;
    out.push(h & 255);
  }
  return out;
}

function fingerprintOf(pub: string): string {
  return b64(fingerprintBytes(pub)).replace(/=+$/, '');
}

/** ssh, scp, rsync to other machines are not part of the one-server simulator. */
export const sshLike: Program = (ctx, argv, io) => {
  const name = argv[0]!;
  const target = argv.slice(1).find((a) => /@|:/.test(a)) ?? argv.slice(1).find((a) => !a.startsWith('-'));
  if (!target) {
    io.err(name === 'ssh' ? 'usage: ssh [-46AaCfGgKkMNnqsTtVvXxYy] [-B bind_interface] [-b bind_address]\n' : `usage: ${name} [-346ABCOpqRrsTv] source ... target\n`);
    return 255;
  }
  const host = target.replace(/^.*@/, '').replace(/:.*$/, '');
  const ipAddr = /^\d+\.\d+\.\d+\.\d+$/.test(host) ? host : (ctx.st.net.dns[host]?.[0] ?? null);
  if (!ipAddr && host !== 'localhost' && host !== ctx.st.hostname) {
    io.err(`ssh: Could not resolve hostname ${host}: Name or service not known\n`);
    if (name !== 'ssh') io.err(`${name === 'rsync' ? 'rsync: connection unexpectedly closed (0 bytes received so far) [sender]\n' : 'scp: Connection closed\n'}`);
    return 255;
  }
  const local = host === 'localhost' || host === ctx.st.hostname || /^127\./.test(host) || ctx.st.net.ifaces.some((i) => i.ipv4 === host);
  if (local && ctx.st.services.ssh?.active === 'active') return sshSelf(ctx, io, target, host, name);
  setExplain(ctx, 'linux.explain.sshOther', { host });
  io.err(`ssh: connect to host ${host} port 22: Connection timed out\n`);
  return 255;
};

/**
 * ssh to this same server: OpenSSH 10 first asks to trust the server's key (with no terminal it
 * can't ask: "Host key verification failed."), then wants a key in ~/.ssh/authorized_keys or a
 * password. The learner has no password (cloud-style), so every password fails.
 */
function sshSelf(ctx: Ctx, io: IO, target: string, host: string, name: string): number {
  const st = ctx.st;
  const home = ctx.sh.vars.HOME ?? '/home/you';
  const user = target.includes('@') ? target.slice(0, target.indexOf('@')) : ctx.sh.user;
  const known = st.fs[`${home}/.ssh/known_hosts`]?.content ?? '';
  const ip = /^\d/.test(host) ? host : '127.0.0.1';
  const hashed = `|1|${b64(fingerprintBytes(`salt-${host}`)).slice(0, 28)}|${b64(fingerprintBytes(`hash-${host}`)).slice(0, 28)}`;
  if (!known.includes(hashed)) {
    if (!hasTerminal(ctx)) {
      io.err('Host key verification failed.\n');
      if (name !== 'ssh') io.err('scp: Connection closed\n');
      setExplain(ctx, 'linux.explain.sshHostKey');
      return 255;
    }
    const fp = b64(fingerprintBytes(`${st.hostname}-ssh-host-ed25519`)).replace(/=+$/, '');
    let a = askTerminal(ctx, io, `The authenticity of host '${host === ip ? host : `${host} (${ip})`}' can't be established.\nED25519 key fingerprint is SHA256:${fp}.\nThis key is not known by any other names.\nAre you sure you want to continue connecting (yes/no/[fingerprint])? `);
    while (a !== null && !/^(yes|no)$/i.test(a.trim()) && a.trim() !== `SHA256:${fp}`) a = askTerminal(ctx, io, "Please type 'yes', 'no' or the fingerprint: ");
    if (a === null || /^no$/i.test(a.trim())) {
      io.err('Host key verification failed.\n');
      setExplain(ctx, 'linux.explain.sshHostKey');
      return 255;
    }
    // ssh makes ~/.ssh and writes the key, hashed (Debian's HashKnownHosts yes).
    const u = userByName(st, ctx.sh.user)!;
    if (!st.fs[`${home}/.ssh`]) st.fs[`${home}/.ssh`] = { type: 'dir', mode: 0o700, uid: u.uid, gid: u.gid, mtime: st.clock };
    const line = `${hashed} ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI${b64(fingerprintBytes(`${st.hostname}-key`)).slice(0, 43)}\n`;
    const kh = st.fs[`${home}/.ssh/known_hosts`];
    if (kh) kh.content = `${kh.content ?? ''}${line}`;
    else st.fs[`${home}/.ssh/known_hosts`] = { type: 'file', mode: 0o666 & ~umaskOf(ctx), uid: u.uid, gid: u.gid, mtime: st.clock, content: line };
    io.err(`Warning: Permanently added '${host}' (ED25519) to the list of known hosts.\n`);
  }
  const target2 = userByName(st, user);
  const keys = target2 ? (st.fs[`${target2.home}/.ssh/authorized_keys`]?.content ?? '') : '';
  const mine = ['id_ed25519.pub', 'id_rsa.pub'].map((k) => st.fs[`${home}/.ssh/${k}`]?.content?.split(' ')[1]).filter(Boolean) as string[];
  if (mine.some((k) => keys.includes(k))) {
    // A second session on the same server: the practice terminal stays in this one.
    setExplain(ctx, 'linux.explain.sshSelf', { host });
    return 0;
  }
  for (let i = 0; i < 3; i++) {
    const pw = askTerminal(ctx, io, `${user}@${host}'s password: `, true);
    if (pw === null) break;
    if (i < 2) io.err('Permission denied, please try again.\n');
  }
  io.err(`${user}@${host}: Permission denied (publickey,password).\n`);
  setExplain(ctx, 'linux.explain.sshDenied', { host });
  return 255;
}

// ---------------------------------------------------------------------------
// apt (offline: a small catalog measured on Debian 13 in Nov 2026)

export const APT_CATALOG: AptPackage[] = [
  { name: 'tree', version: '2.2.1-1', summary: 'displays an indented directory tree, in color', download: 59400, installedKb: 132, bins: ['tree'] },
  { name: 'htop', version: '3.4.1-5', summary: 'interactive processes viewer', download: 171000, installedKb: 909, bins: ['htop'], depends: ['libgpm2', 'libncursesw6'] },
  { name: 'ncdu', version: '1.22-1', summary: 'ncurses disk usage viewer', download: 51500, installedKb: 122, bins: ['ncdu'] },
  { name: 'jq', version: '1.7.1-6+deb13u4', summary: 'lightweight and flexible command-line JSON processor', download: 78900, installedKb: 1271, bins: ['jq'], depends: ['libjq1', 'libonig5'] },
  { name: 'unzip', version: '6.0-29+deb13u1', summary: 'De-archiver for .zip files', download: 173000, installedKb: 396, bins: ['unzip'] },
];

const DEPS: Record<string, { version: string; size: number; suite?: string }> = {
  libgpm2: { version: '1.20.7-11+b2', size: 14400 },
  libncursesw6: { version: '6.5+20250216-2', size: 135000 },
  libjq1: { version: '1.7.1-6+deb13u4', size: 168000, suite: 'security' },
  libonig5: { version: '6.9.9-1+b1', size: 189000 },
};

function kb(bytes: number): string {
  return bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${(bytes / 1000).toFixed(bytes < 100_000 ? 1 : 0)} kB`;
}

export const apt: Program = (ctx, argv, io) => {
  const st = ctx.st;
  const isGet = argv[0] === 'apt-get';
  const args = argv.slice(1).filter((a) => a !== '-y' && a !== '--yes' && a !== '-q' && a !== '--no-install-recommends');
  const verb = args[0];
  const pkgs = args.slice(1);
  const root = userByName(st, ctx.sh.user)?.uid === 0;
  const lockErr = () => {
    io.err('Error: Could not open lock file /var/lib/dpkg/lock-frontend - open (13: Permission denied)\nError: Unable to acquire the dpkg frontend lock (/var/lib/dpkg/lock-frontend), are you root?\n');
    setExplain(ctx, 'linux.err.aptRoot', { cmd: `sudo ${argv.join(' ')}` });
    return 100;
  };
  const listsErr = () => {
    io.err('Error: Could not open lock file /var/lib/apt/lists/lock - open (13: Permission denied)\nError: Unable to lock directory /var/lib/apt/lists/\n');
    setExplain(ctx, 'linux.err.aptRoot', { cmd: `sudo ${argv.join(' ')}` });
    return 100;
  };
  switch (verb) {
    case 'update': {
      if (!root) return listsErr();
      io.out('Hit:1 http://deb.debian.org/debian trixie InRelease\nHit:2 http://deb.debian.org/debian trixie-updates InRelease\nHit:3 http://deb.debian.org/debian-security trixie-security InRelease\n');
      if (!isGet) io.out('All packages are up to date.\n');
      else io.out('Reading package lists... Done\n');
      st.apt.updated = true;
      setExplain(ctx, 'linux.explain.aptUpdate');
      return 0;
    }
    case 'install': {
      if (!pkgs.length) {
        io.err('Error: No packages found\n');
        return 100;
      }
      if (!root) return lockErr();
      io.out('Reading package lists... Done\nBuilding dependency tree... Done\nReading state information... Done\n');
      const want: AptPackage[] = [];
      for (const name of pkgs) {
        if (['nginx', 'curl', 'cron', 'openssh-server', 'openssh-client', 'sudo', 'procps', 'iproute2', 'less', 'dnsutils', 'bind9-dnsutils', 'iputils-ping'].includes(name)) {
          io.out(`${name} is already the newest version (${name === 'nginx' ? '1.26.3-3+deb13u1' : 'installed'}).\n`);
          continue;
        }
        const p = APT_CATALOG.find((x) => x.name === name);
        if (!p) {
          io.err(`Error: Unable to locate package ${name}\n`);
          setExplain(ctx, 'linux.err.aptUnknown', { name });
          return 100;
        }
        if (st.apt.installed[name]) {
          io.out(`${name} is already the newest version (${p.version}).\n`);
          continue;
        }
        want.push(p);
      }
      if (!want.length) {
        io.out('Summary:\n  Upgrading: 0, Installing: 0, Removing: 0, Not Upgrading: 0\n');
        setExplain(ctx, 'linux.explain.aptAlready', { name: pkgs[0]! });
        return 0;
      }
      const deps = [...new Set(want.flatMap((p) => p.depends ?? []))].filter((d) => !st.apt.installed[d]).sort();
      const total = want.reduce((s, p) => s + p.download, 0) + deps.reduce((s, d) => s + DEPS[d]!.size, 0);
      const space = want.reduce((s, p) => s + p.installedKb, 0);
      io.out(`Installing:\n  ${want.map((p) => p.name).join('  ')}\n\n`, 'green');
      if (deps.length) io.out(`Installing dependencies:\n  ${deps.join('  ')}\n\n`, 'green');
      io.out(`Summary:\n  Upgrading: 0, Installing: ${want.length + deps.length}, Removing: 0, Not Upgrading: 0\n  Download size: ${kb(total)}\n  Space needed: ${space} kB / ${(DISK_SIZE / 1e9 - 2.2).toFixed(1)} GB available\n\n`);
      let n = 0;
      for (const d of deps) io.out(`Get:${++n} http://deb.debian.org/${DEPS[d]!.suite ? 'debian-security trixie-security' : 'debian trixie'}/main amd64 ${d} amd64 ${DEPS[d]!.version} [${kb(DEPS[d]!.size)}]\n`);
      for (const p of want) io.out(`Get:${++n} http://deb.debian.org/${p.version.includes('deb13u') && p.name === 'jq' ? 'debian-security trixie-security' : 'debian trixie'}/main amd64 ${p.name} amd64 ${p.version} [${kb(p.download)}]\n`);
      io.out(`Fetched ${kb(total)} in 0s (${kb(total * 3)}/s)\n`);
      let files = 9843;
      for (const d of deps) {
        io.out(`Selecting previously unselected package ${d}:amd64.\n(Reading database ... ${files} files and directories currently installed.)\nPreparing to unpack .../${d}_${DEPS[d]!.version}_amd64.deb ...\nUnpacking ${d}:amd64 (${DEPS[d]!.version}) ...\n`);
        files += 8;
      }
      for (const p of want) {
        io.out(`Selecting previously unselected package ${p.name}.\n(Reading database ... ${files} files and directories currently installed.)\nPreparing to unpack .../${p.name}_${p.version}_amd64.deb ...\nUnpacking ${p.name} (${p.version}) ...\n`);
        files += 8;
      }
      for (const d of deps) {
        io.out(`Setting up ${d}:amd64 (${DEPS[d]!.version}) ...\n`);
        st.apt.installed[d] = DEPS[d]!.version;
      }
      for (const p of want) {
        io.out(`Setting up ${p.name} (${p.version}) ...\n`);
        st.apt.installed[p.name] = p.version;
        for (const b of p.bins) st.fs[`/usr/bin/${b}`] = { type: 'file', mode: 0o755, uid: 0, gid: 0, mtime: st.clock, size: 60000 + b.length * 1000 };
        ctx.events.push({ type: 'packageInstalled', name: p.name });
      }
      io.out('Processing triggers for man-db (2.13.1-1) ...\n');
      setExplain(ctx, 'linux.explain.aptInstall', { name: want.map((p) => p.name).join(', ') });
      return 0;
    }
    case 'remove':
    case 'purge': {
      if (!root) return lockErr();
      io.out('Reading package lists... Done\nBuilding dependency tree... Done\nReading state information... Done\n');
      const gone = pkgs.filter((n) => st.apt.installed[n] && APT_CATALOG.some((p) => p.name === n));
      for (const n of pkgs.filter((x) => !gone.includes(x))) io.out(`Package '${n}' is not installed, so not removed\n`);
      if (!gone.length) {
        io.out('Summary:\n  Upgrading: 0, Installing: 0, Removing: 0, Not Upgrading: 0\n');
        return 0;
      }
      const freed = gone.reduce((s, n) => s + (APT_CATALOG.find((p) => p.name === n)?.installedKb ?? 0), 0);
      io.out(`REMOVING:\n  ${gone.join('  ')}\n\n`, 'red');
      io.out(`Summary:\n  Upgrading: 0, Installing: 0, Removing: ${gone.length}, Not Upgrading: 0\n  Freed space: ${freed} kB\n\n`);
      io.out('(Reading database ... 9851 files and directories currently installed.)\n');
      for (const n of gone) {
        io.out(`Removing ${n} (${st.apt.installed[n]}) ...\n`);
        delete st.apt.installed[n];
        for (const b of APT_CATALOG.find((p) => p.name === n)?.bins ?? []) delete st.fs[`/usr/bin/${b}`];
        ctx.events.push({ type: 'packageRemoved', name: n });
      }
      io.out('Processing triggers for man-db (2.13.1-1) ...\n');
      ctx.danger = true;
      setExplain(ctx, 'linux.explain.aptRemove', { name: gone.join(', ') });
      return 0;
    }
    case 'search': {
      const term = (pkgs[0] ?? '').toLowerCase();
      io.out('Sorting... Done\nFull Text Search... Done\n');
      for (const p of APT_CATALOG.filter((x) => x.name.includes(term) || x.summary.toLowerCase().includes(term))) io.out(`${p.name}/stable ${p.version} amd64\n  ${p.summary}\n\n`);
      return 0;
    }
    case 'show': {
      const p = APT_CATALOG.find((x) => x.name === pkgs[0]);
      if (!p) {
        io.err(`Error: No packages found\n`);
        return 100;
      }
      io.out(`Package: ${p.name}\nVersion: ${p.version}\nInstalled-Size: ${p.installedKb} kB\nDownload-Size: ${kb(p.download)}\nAPT-Sources: http://deb.debian.org/debian trixie/main amd64 Packages\nDescription: ${p.summary}\n\n`);
      return 0;
    }
    case 'list': {
      io.out('Listing... Done\n');
      if (args.includes('--installed')) for (const [n, v] of Object.entries(st.apt.installed).sort()) io.out(`${n}/stable,now ${v} amd64 [installed]\n`);
      else if (args.includes('--upgradable')) void 0;
      else for (const p of APT_CATALOG) io.out(`${p.name}/stable ${p.version} amd64${st.apt.installed[p.name] ? ' [installed]' : ''}\n`);
      return 0;
    }
    case 'upgrade':
    case 'full-upgrade': {
      if (!root) return lockErr();
      io.out('Reading package lists... Done\nBuilding dependency tree... Done\nReading state information... Done\nCalculating upgrade... Done\nSummary:\n  Upgrading: 0, Installing: 0, Removing: 0, Not Upgrading: 0\n');
      setExplain(ctx, 'linux.explain.aptUpgrade');
      return 0;
    }
  }
  io.err(verb ? `E: Invalid operation ${verb}\n` : `apt 3.0.3 (amd64)\nUsage: apt [options] command\n`);
  return verb ? 100 : 1;
};

export const dpkg: Program = (ctx, argv, io) => {
  if (argv[1] === '-l') {
    io.out('Desired=Unknown/Install/Remove/Purge/Hold\n| Status=Not/Inst/Conf-files/Unpacked/halF-conf/Half-inst/trig-aWait/Trig-pend\n|/ Err?=(none)/Reinst-required (Status,Err: uppercase=bad)\n||/ Name           Version      Architecture Description\n+++-==============-============-============-=================================\n');
    for (const [n, v] of Object.entries(ctx.st.apt.installed).sort()) io.out(`ii  ${n.padEnd(14)} ${v.padEnd(12)} amd64        ${APT_CATALOG.find((p) => p.name === n)?.summary ?? ''}\n`);
    return 0;
  }
  io.err('dpkg: error: need an action option\n');
  return 2;
};

/** Programs a minimal server doesn't have (editors, man): the real "command not found". */
export const NOT_INSTALLED = ['nano', 'vim', 'vi', 'man', 'python3', 'python', 'pip', 'node', 'docker', 'git', 'wget', 'ufw', 'netstat', 'ifconfig', 'traceroute', 'openssl', 'htop', 'ncdu', 'jq', 'unzip', 'tree'];

export { childNames, joinPath, lq, q };
