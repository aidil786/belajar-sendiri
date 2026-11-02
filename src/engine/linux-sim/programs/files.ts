// File programs (GNU coreutils 9.7 wording): ls cat less head tail mkdir rmdir touch cp mv rm ln
// find tree stat du basename dirname realpath.
import { badOption, errText, parseOpts, q, setExplain, umaskOf, type Ctx, type IO } from '../ctx';
import {
  absPath,
  baseName,
  blocksOf,
  can,
  childNames,
  descendants,
  fileSize,
  gidName,
  joinPath,
  linkCount,
  lookup,
  lookupParent,
  modeString,
  parentOf,
  uidName,
  userByName,
  type Errno,
} from '../fs';
import { askLine, stdinIsTty, yes } from '../ask';
import { globToRegex } from '../expand';
import { goLong } from '../procs';
import type { FsNode } from '../types';

export type Program = (ctx: Ctx, argv: string[], io: IO) => number;

/** Locale quotes (‘x’) as GNU tools print some names under a UTF-8 locale. */
export function lq(s: string): string {
  return `‘${s}’`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function lsDate(now: number, t: number): string {
  const d = new Date(t * 1000);
  const mon = MONTHS[d.getUTCMonth()]!;
  const day = String(d.getUTCDate()).padStart(2);
  const recent = now - t < 182 * 86400 && t <= now + 3600;
  if (recent) return `${mon} ${day} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  return `${mon} ${day}  ${d.getUTCFullYear()}`;
}

/** GNU `-h` sizes: powers of 1024, rounded up, one decimal below 10. */
export function human(bytes: number): string {
  if (bytes < 1024) return String(bytes);
  const units = ['K', 'M', 'G', 'T'];
  let v = bytes;
  let i = -1;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  if (v < 10) {
    const r = Math.ceil(v * 10) / 10;
    if (r >= 10) return `10${units[i]}`;
    return `${r.toFixed(1)}${units[i]}`;
  }
  const r = Math.ceil(v);
  if (r >= 1024 && i < units.length - 1) return `1.0${units[i + 1]}`;
  return `${r}${units[i]}`;
}

function nodeColor(node: FsNode): 'blue' | 'cyan' | 'green' | undefined {
  if (node.type === 'dir') return 'blue';
  if (node.type === 'link') return 'cyan';
  if (node.mode & 0o111) return 'green';
  return undefined;
}

/** ls in a terminal quotes names with spaces or special characters. */
function shownName(name: string, tty: boolean): string {
  if (!tty || /^[\w.@%+,:=/-]+$/.test(name)) return name;
  return name.includes("'") ? `"${name}"` : `'${name}'`;
}

/** GNU ls columns (vertical order) for an 80-column terminal, as text rows. */
export function columns(names: string[], width = 80): string[] {
  return columnLayout(names, width).map((row) => row.map((c) => names[c.index] + ' '.repeat(c.pad)).join(''));
}

/** The same layout as cells: which name, and how many spaces follow it. */
export function columnLayout(names: string[], width = 80): { index: number; pad: number }[][] {
  return columnRows(names, width);
}

function columnRows(names: string[], width: number): { index: number; pad: number }[][] {
  if (!names.length) return [];
  const lens = names.map((n) => [...n].length);
  let best = 1;
  for (let cols = Math.min(names.length, Math.floor(width / 3)); cols >= 1; cols--) {
    const rows = Math.ceil(names.length / cols);
    const usedCols = Math.ceil(names.length / rows);
    let total = 0;
    for (let c = 0; c < usedCols; c++) {
      const w = Math.max(...lens.slice(c * rows, c * rows + rows));
      total += w + (c < usedCols - 1 ? 2 : 0);
    }
    if (total <= width) {
      best = cols;
      break;
    }
  }
  const rows = Math.ceil(names.length / best);
  const usedCols = Math.ceil(names.length / rows);
  const widths: number[] = [];
  for (let c = 0; c < usedCols; c++) widths.push(Math.max(...lens.slice(c * rows, c * rows + rows)));
  const out: { index: number; pad: number }[][] = [];
  for (let r = 0; r < rows; r++) {
    const line: { index: number; pad: number }[] = [];
    for (let c = 0; c < usedCols; c++) {
      const i = c * rows + r;
      if (i >= names.length) continue;
      const isLast = c === usedCols - 1 || (c + 1) * rows + r >= names.length;
      line.push({ index: i, pad: isLast ? 0 : widths[c]! + 2 - lens[i]! });
    }
    out.push(line);
  }
  return out;
}

interface Entry {
  name: string;
  path: string;
  node: FsNode;
}

function readDirOrErr(ctx: Ctx, io: IO, prog: string, shown: string, path: string): Entry[] | null {
  const f = lookup(ctx.st, ctx.sh.user, path);
  if (!f.ok) {
    io.err(`${prog}: cannot access ${q(shown)}: ${errText(f.err)}\n`);
    return null;
  }
  if (!can(ctx.st, ctx.sh.user, f.node, 'r')) {
    io.err(`${prog}: cannot open directory ${q(shown)}: Permission denied\n`);
    return null;
  }
  return childNames(ctx.st, f.path).map((name) => {
    const p = joinPath(f.path, name);
    return { name, path: p, node: ctx.st.fs[p]! };
  });
}

export const ls: Program = (ctx, argv, io) => {
  const p = parseOpts(argv.slice(1), 'laAhRd1tSrFiG', ['all', 'almost-all', 'human-readable', 'recursive', 'directory', 'color', 'color=auto', 'color=never', 'color=always'], []);
  if (p.bad || p.badLong) return badOption(io, 'ls', p, 2);
  const f = p.flags;
  const long = f.has('l');
  const all = f.has('a') || f.has('all');
  const almost = f.has('A') || f.has('almost-all');
  const hum = f.has('h') || f.has('human-readable');
  const rec = f.has('R') || f.has('recursive');
  const dirOnly = f.has('d') || f.has('directory');
  const one = f.has('1') || !io.tty;
  const st = ctx.st;
  let code = 0;
  const targets = p.args.length ? p.args : ['.'];
  const files: Entry[] = [];
  const dirs: { shown: string; path: string }[] = [];
  for (const t of targets) {
    const path = absPath(ctx.sh.cwd, t);
    const found = lookup(st, ctx.sh.user, path, !long || t.endsWith('/') || dirOnly === false ? true : false);
    const nofollow = long ? lookup(st, ctx.sh.user, path, false) : found;
    if (!found.ok && !(nofollow.ok && nofollow.node.type === 'link')) {
      io.err(`ls: cannot access ${q(t)}: ${errText(found.ok ? 'ENOENT' : found.err)}\n`);
      code = 2;
      continue;
    }
    const isDir = found.ok && found.node.type === 'dir' && !(long && nofollow.ok && nofollow.node.type === 'link' && !t.endsWith('/'));
    if (isDir && !dirOnly) dirs.push({ shown: t, path: found.ok ? found.path : path });
    else files.push({ name: t, path: nofollow.ok ? nofollow.path : path, node: (long && nofollow.ok ? nofollow.node : found.ok ? found.node : nofollow.ok ? nofollow.node : undefined)! });
  }
  const sortEntries = (es: Entry[]) => {
    let out = [...es].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    if (f.has('t')) out.sort((a, b) => b.node.mtime - a.node.mtime);
    if (f.has('S')) out.sort((a, b) => fileSize(b.node) - fileSize(a.node));
    if (f.has('r')) out = out.reverse();
    return out;
  };
  const longRows = (es: Entry[]) => {
    // A "+" marks an access list (ACL); then the other modes get a space so the columns line up.
    const anyAcl = es.some((e) => e.node.acl);
    const rows = es.map((e) => {
      const size = fileSize(e.node);
      return {
        mode: modeString(e.node) + (e.node.acl ? '+' : anyAcl ? ' ' : ''),
        links: String(linkCount(st, e.path, e.node)),
        owner: uidName(st, e.node.uid),
        group: gidName(st, e.node.gid),
        size: hum ? human(size) : String(size),
        date: lsDate(st.clock, e.node.mtime),
        e,
      };
    });
    const w = (k: 'links' | 'owner' | 'group' | 'size') => Math.max(0, ...rows.map((r) => r[k].length));
    const wl = w('links');
    const wo = w('owner');
    const wg = w('group');
    const ws = w('size');
    for (const r of rows) {
      const name = shownName(r.e.name, io.tty);
      const target = r.e.node.type === 'link' ? ` -> ${r.e.node.target}` : '';
      io.out(`${r.mode} ${r.links.padStart(wl)} ${r.owner.padEnd(wo)} ${r.group.padEnd(wg)} ${r.size.padStart(ws)} ${r.date} `);
      io.out(name, io.tty ? nodeColor(r.e.node) : undefined);
      io.out(`${target}\n`);
    }
  };
  const shortList = (es: Entry[]) => {
    if (one) {
      for (const e of es) {
        io.out(shownName(e.name, io.tty), io.tty ? nodeColor(e.node) : undefined);
        io.out('\n');
      }
      return;
    }
    const names = es.map((e) => shownName(e.name, true));
    // Each cell: the name in its colour, then the padding to the next column.
    for (const row of columnLayout(names)) {
      for (const cell of row) {
        io.out(names[cell.index]!, nodeColor(es[cell.index]!.node));
        if (cell.pad) io.out(' '.repeat(cell.pad));
      }
      io.out('\n');
    }
  };
  const showFiles = sortEntries(files);
  if (showFiles.length) {
    if (long) longRows(showFiles);
    else shortList(showFiles);
  }
  const queue = [...dirs].sort((a, b) => (a.shown < b.shown ? -1 : 1));
  let first = true;
  const multi = targets.length > 1 || rec;
  while (queue.length) {
    const d = queue.shift()!;
    const list = readDirOrErr(ctx, io, 'ls', d.shown, d.path);
    if (!list) {
      code = 2;
      continue;
    }
    if (multi) {
      if (!first || showFiles.length) io.out('\n');
      io.out(`${d.shown}:\n`);
    }
    first = false;
    let es = list.filter((e) => all || almost || !e.name.startsWith('.'));
    if (all) {
      const self = lookup(st, ctx.sh.user, d.path);
      const up = lookup(st, 'root', parentOf(d.path));
      es = [...(self.ok ? [{ name: '.', path: d.path, node: self.node }] : []), ...(up.ok ? [{ name: '..', path: parentOf(d.path), node: up.node }] : []), ...es];
    }
    es = sortEntries(es);
    if (long) {
      const total = es.reduce((s, e) => s + blocksOf(e.node), 0);
      io.out(`total ${hum ? human(total * 1024).replace(/^(\d+)$/, '$1') : total}\n`);
      longRows(es);
    } else shortList(es);
    if (rec) {
      const subs = es.filter((e) => e.node.type === 'dir' && e.name !== '.' && e.name !== '..').map((e) => ({ shown: d.shown === '/' ? `/${e.name}` : `${d.shown.replace(/\/$/, '')}/${e.name}`, path: e.path }));
      queue.unshift(...subs);
    }
  }
  setExplain(ctx, long ? 'linux.explain.lsLong' : all || almost ? 'linux.explain.lsAll' : rec ? 'linux.explain.lsR' : 'linux.explain.ls');
  if (code) setExplain(ctx, 'linux.err.lsMissing', { path: p.args[0] ?? '' });
  return code;
};

/** Read a file for cat/head/grep… Prints the tool's error and returns null on failure. */
export function readFile(ctx: Ctx, io: IO, prog: string, name: string, style: 'plain' | 'open' = 'plain'): string | null {
  if (name === '-') return io.stdin ?? '';
  const path = absPath(ctx.sh.cwd, name);
  const f = lookup(ctx.st, ctx.sh.user, path);
  const fail = (e: Errno) => {
    io.err(style === 'open' ? `${prog}: cannot open ${q(name)} for reading: ${errText(e)}\n` : `${prog}: ${name}: ${errText(e)}\n`);
    setExplain(ctx, e === 'EACCES' ? 'linux.err.readDenied' : e === 'EISDIR' ? 'linux.err.isDir' : 'linux.err.noFile', { name });
    return null;
  };
  if (!f.ok) return fail(f.err);
  if (f.node.type === 'dir') {
    if (style === 'open') {
      io.err(`${prog}: error reading ${q(name)}: Is a directory\n`);
      return null;
    }
    return fail('EISDIR');
  }
  if (!can(ctx.st, ctx.sh.user, f.node, 'r')) return fail('EACCES');
  if (f.node.content === undefined) return '\u0000ELF binary\n';
  return f.node.content;
}

export const cat: Program = (ctx, argv, io) => {
  const p = parseOpts(argv.slice(1), 'nAbEsTv', ['number'], []);
  if (p.bad || p.badLong) return badOption(io, 'cat', p);
  const files = p.args.length ? p.args : ['-'];
  let code = 0;
  let n = 0;
  for (const name of files) {
    const text = readFile(ctx, io, 'cat', name);
    if (text === null) {
      code = 1;
      continue;
    }
    if (p.flags.has('n') || p.flags.has('number')) {
      const lines = text.split('\n');
      const endsNl = text.endsWith('\n');
      if (endsNl) lines.pop();
      io.out(lines.map((l) => `${String(++n).padStart(6)}\t${l}`).join('\n') + (endsNl ? '\n' : ''));
    } else io.out(text);
  }
  if (!code) setExplain(ctx, 'linux.explain.cat', { name: files[0]! });
  return code;
};

export const less: Program = (ctx, argv, io) => {
  const files = argv.slice(1).filter((a) => !a.startsWith('-') || a === '-');
  if (!files.length && io.stdin === null) {
    io.err('Missing filename ("less --help" for help)\n');
    return 1;
  }
  let code = 0;
  for (const name of files.length ? files : ['-']) {
    const text = readFile(ctx, io, argv[0] === 'more' ? 'more' : 'less', name);
    if (text === null) code = 1;
    else io.out(text);
  }
  if (!code) setExplain(ctx, 'linux.explain.less', { name: files[0] ?? '' });
  return code;
};

function headTail(ctx: Ctx, argv: string[], io: IO, which: 'head' | 'tail'): number {
  const args: string[] = [];
  let n = 10;
  let fromStart = false;
  let follow = false;
  let bytes: number | null = null;
  let quiet = false;
  const raw = argv.slice(1);
  for (let i = 0; i < raw.length; i++) {
    const a = raw[i]!;
    if (a === '-n' || a === '--lines') {
      const v = raw[++i] ?? '';
      fromStart = v.startsWith('+');
      n = Math.abs(parseInt(v, 10));
      if (Number.isNaN(n)) {
        io.err(`${which}: invalid number of lines: ${lq(v)}\n`);
        return 1;
      }
    } else if (/^-n[+-]?\d+$/.test(a)) {
      fromStart = a[2] === '+';
      n = Math.abs(parseInt(a.slice(2), 10));
    } else if (/^--lines=/.test(a)) n = parseInt(a.slice(8), 10);
    else if (/^-\d+$/.test(a)) n = Number(a.slice(1));
    else if (a === '-c') bytes = Number(raw[++i]);
    else if (a === '-f' || a === '-F' || a === '--follow') follow = true;
    else if (a === '-q') quiet = true;
    else if (a.startsWith('-') && a !== '-') {
      io.err(`${which}: invalid option -- '${a[1]}'\nTry '${which} --help' for more information.\n`);
      return 1;
    } else args.push(a);
  }
  const files = args.length ? args : ['-'];
  let code = 0;
  files.forEach((name, idx) => {
    const text = readFile(ctx, io, which, name, 'open');
    if (text === null) {
      code = 1;
      return;
    }
    if (files.length > 1 && !quiet) io.out(`${idx > 0 ? '\n' : ''}==> ${name === '-' ? 'standard input' : name} <==\n`);
    if (bytes !== null) {
      io.out(which === 'head' ? text.slice(0, bytes) : text.slice(-bytes));
      return;
    }
    const lines = text.split('\n');
    const endsNl = text.endsWith('\n');
    if (endsNl) lines.pop();
    let pick: string[];
    if (which === 'head') pick = lines.slice(0, n);
    else if (fromStart) pick = lines.slice(Math.max(0, n - 1));
    else pick = n === 0 ? [] : lines.slice(-n);
    if (!pick.length) return;
    const lastIncluded = which === 'tail' || pick.length < lines.length || endsNl;
    io.out(pick.join('\n') + (lastIncluded ? '\n' : ''));
  });
  if (!code) setExplain(ctx, `linux.explain.${which}`, { n, name: files[0]! });
  if (which === 'tail' && follow && !code && goLong(ctx, { args: argv.join(' '), comm: 'tail', kind: 'tail' })) setExplain(ctx, 'linux.explain.tailF', { name: files[0]! });
  return code;
}

export const head: Program = (ctx, argv, io) => headTail(ctx, argv, io, 'head');
export const tail: Program = (ctx, argv, io) => headTail(ctx, argv, io, 'tail');

function me(ctx: Ctx) {
  return userByName(ctx.st, ctx.sh.user)!;
}

function umask(ctx: Ctx): number {
  return umaskOf(ctx);
}

/** Create a file or folder entry after checking the parent folder. */
function create(ctx: Ctx, path: string, node: Omit<FsNode, 'uid' | 'gid' | 'mtime'>): { ok: true; path: string } | { ok: false; err: Errno } {
  const par = lookupParent(ctx.st, ctx.sh.user, path);
  if (!par.ok) return par;
  if (!can(ctx.st, ctx.sh.user, par.node, 'w') || !can(ctx.st, ctx.sh.user, par.node, 'x')) return { ok: false, err: 'EACCES' };
  const real = joinPath(par.dir, par.name);
  const u = me(ctx);
  ctx.st.fs[real] = { ...node, uid: u.uid, gid: u.gid, mtime: ctx.st.clock };
  return { ok: true, path: real };
}

export const mkdir: Program = (ctx, argv, io) => {
  const p = parseOpts(argv.slice(1), 'pv', ['parents', 'verbose'], ['m']);
  if (p.bad || p.badLong) return badOption(io, 'mkdir', p);
  if (!p.args.length) {
    io.err("mkdir: missing operand\nTry 'mkdir --help' for more information.\n");
    return 1;
  }
  const parents = p.flags.has('p') || p.flags.has('parents');
  const verbose = p.flags.has('v') || p.flags.has('verbose');
  const mode = p.values.m ? parseInt(p.values.m, 8) : 0o777 & ~umask(ctx);
  let code = 0;
  // GNU mkdir names folders with locale quotes (‘x’) in errors, shell quotes ('x') with -v.
  const fail = (shown: string, err: Errno) => {
    io.err(`mkdir: cannot create directory ${lq(shown)}: ${errText(err)}\n`);
    setExplain(ctx, err === 'EEXIST' ? 'linux.err.exists' : err === 'EACCES' ? 'linux.err.writeDenied' : 'linux.err.mkdirParent', { name: shown });
    code = 1;
  };
  const make = (path: string, shown: string, m: number): boolean => {
    const r = create(ctx, path, { type: 'dir', mode: m });
    if (!r.ok) {
      fail(shown, r.err);
      return false;
    }
    ctx.events.push({ type: 'dirMade', path: r.path });
    if (verbose) io.out(`mkdir: created directory ${q(shown)}\n`);
    return true;
  };
  for (const name of p.args) {
    if (!parents) {
      const existing = lookup(ctx.st, ctx.sh.user, absPath(ctx.sh.cwd, name), false);
      if (existing.ok) fail(name, 'EEXIST');
      else make(absPath(ctx.sh.cwd, name), name, mode);
      continue;
    }
    // -p walks the name one folder at a time, as written: deep, deep/er, deep/er/est.
    const parts = name.split('/').filter(Boolean);
    let shown = name.startsWith('/') ? '/' : '';
    for (let i = 0; i < parts.length; i++) {
      shown = shown === '' ? parts[i]! : shown.endsWith('/') ? `${shown}${parts[i]}` : `${shown}/${parts[i]}`;
      const last = i === parts.length - 1;
      const path = absPath(ctx.sh.cwd, shown);
      const found = lookup(ctx.st, ctx.sh.user, path);
      if (found.ok) {
        if (found.node.type !== 'dir') {
          fail(last ? name : shown, last ? 'EEXIST' : 'ENOTDIR');
          break;
        }
        if (!last && !can(ctx.st, ctx.sh.user, found.node, 'x')) {
          fail(shown, 'EACCES');
          break;
        }
        continue;
      }
      if (found.err !== 'ENOENT') {
        fail(shown, found.err);
        break;
      }
      if (!make(path, shown, last ? mode : 0o777 & ~umask(ctx))) break;
    }
  }
  if (!code) setExplain(ctx, parents ? 'linux.explain.mkdirP' : 'linux.explain.mkdir', { name: p.args[0]! });
  return code;
};

export const rmdir: Program = (ctx, argv, io) => {
  const p = parseOpts(argv.slice(1), 'pv', ['parents', 'verbose', 'ignore-fail-on-non-empty'], []);
  if (p.bad || p.badLong) return badOption(io, 'rmdir', p);
  if (!p.args.length) {
    io.err("rmdir: missing operand\nTry 'rmdir --help' for more information.\n");
    return 1;
  }
  const verbose = p.flags.has('v') || p.flags.has('verbose');
  const quietNonEmpty = p.flags.has('ignore-fail-on-non-empty');
  let code = 0;
  /** Remove one folder; returns the reason it stays, or null. */
  const removeOne = (name: string): Errno | null => {
    const path = absPath(ctx.sh.cwd, name);
    const f = lookup(ctx.st, ctx.sh.user, path, false);
    if (!f.ok) return f.err;
    if (f.node.type !== 'dir') return 'ENOTDIR';
    if (childNames(ctx.st, f.path).length) return 'ENOTEMPTY';
    const par = lookup(ctx.st, ctx.sh.user, parentOf(f.path));
    if (!par.ok || !can(ctx.st, ctx.sh.user, par.node, 'w')) return 'EACCES';
    if (verbose) io.out(`rmdir: removing directory, ${q(name)}\n`);
    delete ctx.st.fs[f.path];
    ctx.events.push({ type: 'fileRemoved', path: f.path });
    return null;
  };
  for (const name of p.args) {
    const err = removeOne(name);
    if (err) {
      if (!(quietNonEmpty && err === 'ENOTEMPTY')) {
        io.err(`rmdir: failed to remove ${q(name)}: ${errText(err)}\n`);
        code = 1;
      }
      continue;
    }
    if (!p.flags.has('p') && !p.flags.has('parents')) continue;
    // -p: then each folder above it, as written (a/b/c → a/b → a).
    let cur = name.replace(/\/+$/, '');
    while (cur.includes('/')) {
      cur = cur.slice(0, cur.lastIndexOf('/')).replace(/\/+$/, '');
      if (!cur) break;
      const e = removeOne(cur);
      if (e) {
        if (!(quietNonEmpty && e === 'ENOTEMPTY')) {
          io.err(`rmdir: failed to remove directory ${q(cur)}: ${errText(e)}\n`);
          code = 1;
        }
        break;
      }
    }
  }
  if (!code) setExplain(ctx, 'linux.explain.rmdir', { name: p.args[0]! });
  return code;
};

export const touch: Program = (ctx, argv, io) => {
  const args = argv.slice(1).filter((a) => !a.startsWith('-'));
  if (!args.length) {
    io.err("touch: missing file operand\nTry 'touch --help' for more information.\n");
    return 1;
  }
  let code = 0;
  for (const name of args) {
    const path = absPath(ctx.sh.cwd, name);
    const f = lookup(ctx.st, ctx.sh.user, path);
    if (f.ok) {
      if (!can(ctx.st, ctx.sh.user, f.node, 'w') && f.node.uid !== me(ctx).uid && me(ctx).uid !== 0) {
        io.err(`touch: cannot touch ${q(name)}: Permission denied\n`);
        code = 1;
        continue;
      }
      f.node.mtime = ctx.st.clock;
      continue;
    }
    if (f.err !== 'ENOENT') {
      io.err(`touch: cannot touch ${q(name)}: ${errText(f.err)}\n`);
      code = 1;
      continue;
    }
    const r = create(ctx, path, { type: 'file', mode: 0o666 & ~umask(ctx), content: '' });
    if (!r.ok) {
      io.err(`touch: cannot touch ${q(name)}: ${errText(r.err)}\n`);
      setExplain(ctx, r.err === 'EACCES' ? 'linux.err.writeDenied' : 'linux.err.noFile', { name });
      code = 1;
      continue;
    }
    ctx.events.push({ type: 'fileWritten', path: r.path });
  }
  if (!code) setExplain(ctx, 'linux.explain.touch', { name: args[0]! });
  return code;
};

interface CopyOpts {
  recursive: boolean;
  /** Names as the learner wrote them (for -v and questions). */
  fromShown: string;
  toShown: string;
  /** cp -i: may this existing file be overwritten? (asks the learner) */
  overwrite?: (shown: string) => boolean;
  verbose?: (from: string, to: string) => void;
  /** Set when the learner said no to a question (cp then exits with 1, like coreutils 9.7). */
  declined: { any: boolean };
}

/** Copy one file system entry (deep for folders). */
function copyTree(ctx: Ctx, from: string, to: string, o: CopyOpts): Errno | null {
  const src = ctx.st.fs[from]!;
  const u = me(ctx);
  if (src.type === 'dir') {
    if (!o.recursive) return null;
    if (ctx.st.fs[to]?.type !== 'dir') {
      ctx.st.fs[to] = { type: 'dir', mode: src.mode & ~umask(ctx), uid: u.uid, gid: u.gid, mtime: ctx.st.clock };
      o.verbose?.(o.fromShown, o.toShown);
    }
    for (const name of childNames(ctx.st, from)) {
      const child = ctx.st.fs[joinPath(from, name)]!;
      if (!can(ctx.st, ctx.sh.user, child, 'r')) return 'EACCES';
      const e = copyTree(ctx, joinPath(from, name), joinPath(to, name), { ...o, fromShown: `${o.fromShown.replace(/\/$/, '')}/${name}`, toShown: `${o.toShown.replace(/\/$/, '')}/${name}` });
      if (e) return e;
    }
    return null;
  }
  const existing = ctx.st.fs[to];
  if (existing && o.overwrite && !o.overwrite(o.toShown)) {
    o.declined.any = true;
    return null;
  }
  if (existing) {
    if (!can(ctx.st, ctx.sh.user, existing, 'w')) return 'EACCES';
    existing.content = src.content ?? '';
    if (src.size !== undefined) existing.size = src.size;
    existing.mtime = ctx.st.clock;
    o.verbose?.(o.fromShown, o.toShown);
    return null;
  }
  ctx.st.fs[to] = { type: src.type === 'link' ? 'link' : 'file', mode: src.mode & ~umask(ctx) & 0o777, uid: u.uid, gid: u.gid, mtime: ctx.st.clock, ...(src.content !== undefined ? { content: src.content } : {}), ...(src.size !== undefined ? { size: src.size } : {}), ...(src.target ? { target: src.target } : {}) };
  o.verbose?.(o.fromShown, o.toShown);
  return null;
}

/** Which of these option letters came last on the command line (GNU: the last of -i/-f/-n wins). */
function lastFlag(argv: string[], letters: string, longs: Record<string, string> = {}): string | null {
  let last: string | null = null;
  for (const a of argv.slice(1)) {
    if (a === '--') break;
    if (a.startsWith('--')) {
      const l = longs[a.slice(2)];
      if (l) last = l;
      continue;
    }
    if (a.startsWith('-') && a.length > 1) for (const c of a.slice(1)) if (letters.includes(c)) last = c;
  }
  return last;
}

/** "0444 (r--r--r--)" as mv shows a mode it is about to override. */
function modeText(node: FsNode): string {
  return `${(node.mode & 0o7777).toString(8).padStart(4, '0')} (${modeString(node).slice(1)})`;
}

function copyOrMove(ctx: Ctx, argv: string[], io: IO, which: 'cp' | 'mv'): number {
  const p = parseOpts(argv.slice(1), which === 'cp' ? 'rRvifnpa' : 'vifn', ['recursive', 'verbose', 'force', 'interactive', 'no-clobber'], []);
  if (p.bad || p.badLong) return badOption(io, which, p);
  const recursive = which === 'mv' || p.flags.has('r') || p.flags.has('R') || p.flags.has('a') || p.flags.has('recursive');
  const verbose = p.flags.has('v') || p.flags.has('verbose');
  const mode = lastFlag(argv, 'ifn', { interactive: 'i', force: 'f', 'no-clobber': 'n' });
  if (!p.args.length) {
    io.err(`${which}: missing file operand\nTry '${which} --help' for more information.\n`);
    return 1;
  }
  if (p.args.length === 1) {
    io.err(`${which}: missing destination file operand after ${q(p.args[0]!)}\nTry '${which} --help' for more information.\n`);
    return 1;
  }
  const dest = p.args[p.args.length - 1]!;
  const sources = p.args.slice(0, -1);
  const destPath = absPath(ctx.sh.cwd, dest);
  const destFound = lookup(ctx.st, ctx.sh.user, destPath);
  const destIsDir = destFound.ok && destFound.node.type === 'dir';
  if (sources.length > 1 && !destIsDir) {
    io.err(`${which}: target ${q(dest)}: ${destFound.ok ? 'Not a directory' : 'No such file or directory'}\n`);
    return 1;
  }
  let code = 0;
  const root = me(ctx).uid === 0;
  for (const s of sources) {
    const sp = absPath(ctx.sh.cwd, s);
    const sf = lookup(ctx.st, ctx.sh.user, sp, which === 'cp');
    if (!sf.ok) {
      io.err(`${which}: cannot stat ${q(s)}: ${errText(sf.err)}\n`);
      setExplain(ctx, 'linux.err.noFile', { name: s });
      code = 1;
      continue;
    }
    if (sf.node.type === 'dir' && !recursive) {
      io.err(`cp: -r not specified; omitting directory ${q(s)}\n`);
      setExplain(ctx, 'linux.err.cpNeedsR', { name: s });
      code = 1;
      continue;
    }
    if (which === 'cp' && !can(ctx.st, ctx.sh.user, sf.node, 'r')) {
      io.err(`cp: cannot open ${q(s)} for reading: Permission denied\n`);
      code = 1;
      continue;
    }
    const targetShown = destIsDir ? `${dest.replace(/\/$/, '')}/${baseName(s)}` : dest;
    const target = destIsDir ? joinPath(destFound.ok ? destFound.path : destPath, baseName(sp)) : destPath;
    if (target === sf.path) {
      io.err(`${which}: ${q(s)} and ${q(targetShown)} are the same file\n`);
      code = 1;
      continue;
    }
    if (target.startsWith(`${sf.path}/`)) {
      if (which === 'mv') io.err(`mv: cannot move ${q(s)} to a subdirectory of itself, ${q(targetShown)}\n`);
      else {
        // cp makes the new folder first, then sees it is inside the folder it copies.
        const par = lookupParent(ctx.st, ctx.sh.user, target);
        if (par.ok && !ctx.st.fs[target] && can(ctx.st, ctx.sh.user, par.node, 'w')) {
          const u = me(ctx);
          ctx.st.fs[target] = { type: 'dir', mode: sf.node.mode & ~umask(ctx), uid: u.uid, gid: u.gid, mtime: ctx.st.clock };
          ctx.events.push({ type: 'dirMade', path: target });
        }
        io.err(`cp: cannot copy a directory, ${q(s)}, into itself, ${q(targetShown)}\n`);
      }
      code = 1;
      continue;
    }
    const par = lookupParent(ctx.st, ctx.sh.user, target);
    const existing = ctx.st.fs[target];
    if (!par.ok) {
      io.err(which === 'cp' ? `cp: cannot create ${sf.node.type === 'dir' ? 'directory' : 'regular file'} ${q(targetShown)}: ${errText(par.err)}\n` : `mv: cannot move ${q(s)} to ${q(targetShown)}: ${errText(par.err)}\n`);
      code = 1;
      continue;
    }
    if (existing?.type === 'dir' && sf.node.type !== 'dir') {
      io.err(`${which}: cannot overwrite directory ${q(targetShown)} with non-directory\n`);
      code = 1;
      continue;
    }
    if (mode === 'n' && existing) continue;
    const parentOk = can(ctx.st, ctx.sh.user, par.node, 'w') && can(ctx.st, ctx.sh.user, par.node, 'x');
    if (which === 'mv') {
      const srcPar = lookup(ctx.st, ctx.sh.user, parentOf(sf.path));
      if (existing && existing.type !== 'dir') {
        // -i asks; without -i or -f, a file you can't write is only replaced after a yes (at a terminal).
        const protectedFile = !root && existing.type !== 'link' && !can(ctx.st, ctx.sh.user, existing, 'w');
        let question: string | null = null;
        if (mode === 'i') question = `mv: overwrite ${q(targetShown)}? `;
        else if (mode !== 'f' && protectedFile && stdinIsTty(ctx, io)) question = `mv: replace ${q(targetShown)}, overriding mode ${modeText(existing)}? `;
        if (question !== null && !yes(askLine(ctx, io, question))) {
          code = 1;
          continue;
        }
      }
      if (!parentOk || !srcPar.ok || !can(ctx.st, ctx.sh.user, srcPar.node, 'w')) {
        io.err(`mv: cannot move ${q(s)} to ${q(targetShown)}: Permission denied\n`);
        setExplain(ctx, 'linux.err.writeDenied', { name: targetShown });
        code = 1;
        continue;
      }
      const moved = [sf.path, ...descendants(ctx.st, sf.path)];
      for (const old of moved) {
        const node = ctx.st.fs[old]!;
        delete ctx.st.fs[old];
        ctx.st.fs[target + old.slice(sf.path.length)] = node;
      }
      ctx.events.push({ type: 'fileRemoved', path: sf.path }, { type: 'fileWritten', path: target });
      if (verbose) io.out(`renamed ${q(s)} -> ${q(targetShown)}\n`);
      continue;
    }
    if (!existing && !parentOk) {
      io.err(`cp: cannot create ${sf.node.type === 'dir' ? 'directory' : 'regular file'} ${q(targetShown)}: Permission denied\n`);
      setExplain(ctx, 'linux.err.writeDenied', { name: targetShown });
      code = 1;
      continue;
    }
    const declined = { any: false };
    const e = copyTree(ctx, sf.path, target, {
      recursive,
      fromShown: s,
      toShown: targetShown,
      declined,
      ...(mode === 'i' ? { overwrite: (shown: string) => yes(askLine(ctx, io, `cp: overwrite ${q(shown)}? `)) } : {}),
      ...(verbose ? { verbose: (a: string, b: string) => io.out(`${q(a)} -> ${q(b)}\n`) } : {}),
    });
    if (declined.any) code = 1;
    if (e) {
      io.err(`cp: cannot create regular file ${q(targetShown)}: ${errText(e)}\n`);
      code = 1;
      continue;
    }
    ctx.events.push({ type: 'fileWritten', path: target });
  }
  if (!code) setExplain(ctx, which === 'cp' ? (recursive ? 'linux.explain.cpR' : 'linux.explain.cp') : 'linux.explain.mv', { from: sources[0]!, to: dest });
  return code;
}

export const cp: Program = (ctx, argv, io) => copyOrMove(ctx, argv, io, 'cp');
export const mv: Program = (ctx, argv, io) => copyOrMove(ctx, argv, io, 'mv');

/** What rm calls a thing in its questions. */
function rmKind(node: FsNode): string {
  if (node.type === 'dir') return 'directory';
  if (node.type === 'link') return 'symbolic link';
  return fileSize(node) ? 'regular file' : 'regular empty file';
}

export const rm: Program = (ctx, argv, io) => {
  const p = parseOpts(argv.slice(1), 'rRfiIvd', ['recursive', 'force', 'verbose', 'no-preserve-root', 'dir', 'interactive'], []);
  if (p.bad || p.badLong) return badOption(io, 'rm', p);
  const rec = p.flags.has('r') || p.flags.has('R') || p.flags.has('recursive');
  const verbose = p.flags.has('v') || p.flags.has('verbose');
  // GNU rm: the last of -f, -i, -I wins.
  const mode = lastFlag(argv, 'fiI', { force: 'f', interactive: 'i' });
  const force = mode === 'f';
  const always = mode === 'i';
  ctx.danger = true;
  if (!p.args.length) {
    if (force) return 0;
    io.err("rm: missing operand\nTry 'rm --help' for more information.\n");
    return 1;
  }
  // -I: one question before removing more than three files, or anything recursively.
  if (mode === 'I' && (p.args.length > 3 || rec)) {
    const n = p.args.length;
    if (!yes(askLine(ctx, io, `rm: remove ${n} argument${n === 1 ? '' : 's'}${rec ? ' recursively' : ''}? `))) return 0;
  }
  const root = me(ctx).uid === 0;
  const tty = stdinIsTty(ctx, io);
  /** rm asks about this entry: always with -i; at a terminal also when it is write-protected. */
  const question = (node: FsNode, verb: 'remove' | 'descend into', kind: string, shown: string): boolean => {
    const wp = !root && node.type !== 'link' && !can(ctx.st, ctx.sh.user, node, 'w');
    if (!always && !(wp && tty && !force)) return true;
    return yes(askLine(ctx, io, `rm: ${verb} ${wp ? 'write-protected ' : ''}${kind} ${q(shown)}? `));
  };
  let code = 0;
  const denied = (shown: string) => {
    io.err(`rm: cannot remove ${q(shown)}: Permission denied\n`);
    setExplain(ctx, 'linux.err.rmDenied', { name: shown });
    code = 1;
  };
  /**
   * Remove one entry (folders depth first, like GNU rm's fts walk). Returns false when it stays, so
   * the folders above it stay too, without a second message.
   */
  const remove = (path: string, shown: string): boolean | 'declined' => {
    const node = ctx.st.fs[path]!;
    const par = ctx.st.fs[parentOf(path)];
    const parentOk = !!par && can(ctx.st, ctx.sh.user, par, 'w') && can(ctx.st, ctx.sh.user, par, 'x');
    if (node.type === 'dir') {
      const kids = childNames(ctx.st, path);
      if (kids.length) {
        if (!question(node, 'descend into', 'directory', shown)) return false;
        if (!can(ctx.st, ctx.sh.user, node, 'r') || !can(ctx.st, ctx.sh.user, node, 'x')) {
          denied(shown);
          return false;
        }
        let kept = false;
        for (const k of kids) if (remove(joinPath(path, k), `${shown.replace(/\/$/, '')}/${k}`) === false) kept = true;
        if (kept) return false;
      }
      if (!question(node, 'remove', 'directory', shown)) return 'declined';
      if (childNames(ctx.st, path).length) {
        io.err(`rm: cannot remove ${q(shown)}: Directory not empty\n`);
        code = 1;
        return false;
      }
    } else if (!question(node, 'remove', rmKind(node), shown)) return 'declined';
    if (!parentOk) {
      denied(shown);
      return false;
    }
    delete ctx.st.fs[path];
    ctx.events.push({ type: 'fileRemoved', path });
    if (verbose) io.out(`removed ${node.type === 'dir' ? 'directory ' : ''}${q(shown)}\n`);
    return true;
  };
  for (const name of p.args) {
    const path = absPath(ctx.sh.cwd, name);
    if (path === '/' && rec && !p.flags.has('no-preserve-root')) {
      io.err("rm: it is dangerous to operate recursively on '/'\nrm: use --no-preserve-root to override this failsafe\n");
      code = 1;
      continue;
    }
    if (/(^|\/)\.\.?$/.test(name)) {
      io.err(`rm: refusing to remove '.' or '..' directory: skipping ${q(name)}\n`);
      code = 1;
      continue;
    }
    const f = lookup(ctx.st, ctx.sh.user, path, false);
    if (!f.ok) {
      if (force && f.err === 'ENOENT') continue;
      io.err(`rm: cannot remove ${q(name)}: ${errText(f.err)}\n`);
      setExplain(ctx, 'linux.err.noFile', { name });
      code = 1;
      continue;
    }
    if (f.node.type === 'dir' && !rec && !(p.flags.has('d') && !childNames(ctx.st, f.path).length)) {
      io.err(`rm: cannot remove ${q(name)}: Is a directory\n`);
      setExplain(ctx, 'linux.err.rmDir', { name });
      code = 1;
      continue;
    }
    remove(f.path, name);
  }
  if (!code) setExplain(ctx, rec ? 'linux.explain.rmR' : 'linux.explain.rm', { name: p.args[0]! });
  return code;
};

export const ln: Program = (ctx, argv, io) => {
  const p = parseOpts(argv.slice(1), 'sfvn', ['symbolic', 'force'], []);
  if (p.bad || p.badLong) return badOption(io, 'ln', p);
  if (!p.flags.has('s') && !p.flags.has('symbolic')) {
    io.err('ln: hard links are not part of the practice server; use ln -s\n');
    return 1;
  }
  const [target, name] = p.args;
  if (!target) {
    io.err("ln: missing file operand\nTry 'ln --help' for more information.\n");
    return 1;
  }
  let link = name ?? baseName(target);
  const lp = absPath(ctx.sh.cwd, link);
  const existing = lookup(ctx.st, ctx.sh.user, lp);
  if (existing.ok && existing.node.type === 'dir') link = joinPath(link, baseName(target));
  const path = absPath(ctx.sh.cwd, link);
  if (ctx.st.fs[path]) {
    if (!p.flags.has('f')) {
      io.err(`ln: failed to create symbolic link ${q(link)}: File exists\n`);
      return 1;
    }
    delete ctx.st.fs[path];
  }
  const r = create(ctx, path, { type: 'link', mode: 0o777, target });
  if (!r.ok) {
    io.err(`ln: failed to create symbolic link ${q(link)}: ${errText(r.err)}\n`);
    return 1;
  }
  setExplain(ctx, 'linux.explain.ln', { name: link, target });
  return 0;
};

// ---------------------------------------------------------------------------
// find

function sizeMatch(node: FsNode, spec: string): boolean {
  const m = /^([+-]?)(\d+)([ckMG]?)$/.exec(spec);
  if (!m) return false;
  const unit = { '': 512, c: 1, k: 1024, M: 1024 ** 2, G: 1024 ** 3 }[m[3] as '' | 'c' | 'k' | 'M' | 'G']!;
  const size = node.type === 'dir' ? 4096 : fileSize(node);
  const units = Math.ceil(size / unit);
  const n = Number(m[2]);
  if (m[1] === '+') return units > n;
  if (m[1] === '-') return units < n;
  return units === n;
}

export const find: Program = (ctx, argv, io) => {
  const args = argv.slice(1);
  const paths: string[] = [];
  let i = 0;
  while (i < args.length && !args[i]!.startsWith('-') && args[i] !== '!' && args[i] !== '(') paths.push(args[i++]!);
  if (!paths.length) paths.push('.');
  type Test = (path: string, node: FsNode, depth: number, shown: string) => boolean;
  const tests: Test[] = [];
  let maxdepth = Infinity;
  let mindepth = 0;
  let action: { kind: 'print' } | { kind: 'delete' } | { kind: 'exec'; cmd: string[] } = { kind: 'print' };
  let negate = false;
  const push = (t: Test) => {
    const neg = negate;
    tests.push(neg ? (a, b, c, d) => !t(a, b, c, d) : t);
    negate = false;
  };
  for (; i < args.length; i++) {
    const a = args[i]!;
    const v = args[i + 1];
    switch (a) {
      case '!':
      case '-not':
        negate = true;
        break;
      case '-name':
      case '-iname': {
        if (v === undefined) {
          io.err(`find: missing argument to \`${a}'\n`);
          return 1;
        }
        const re = globToRegex(a === '-iname' ? v.toLowerCase() : v);
        push((path) => re.test(a === '-iname' ? baseName(path).toLowerCase() : baseName(path)));
        i++;
        break;
      }
      case '-path': {
        const re = globToRegex(v ?? '');
        push((_p, _n, _d, shown) => re.test(shown));
        i++;
        break;
      }
      case '-type': {
        const t = v;
        if (!t || !['f', 'd', 'l'].includes(t)) {
          io.err(`find: Unknown argument to -type: ${t ?? ''}\n`);
          return 1;
        }
        push((_p, node) => (t === 'f' ? node.type === 'file' : t === 'd' ? node.type === 'dir' : node.type === 'link'));
        i++;
        break;
      }
      case '-size': {
        const spec = v ?? '';
        if (!/^[+-]?\d+[ckMG]?$/.test(spec)) {
          io.err(`find: invalid -size type ${lq(spec.replace(/^[+-]?\d+/, ''))}\n`);
          return 1;
        }
        push((_p, node) => node.type === 'file' && sizeMatch(node, spec));
        i++;
        break;
      }
      case '-empty':
        push((p, node) => (node.type === 'dir' ? childNames(ctx.st, p).length === 0 : fileSize(node) === 0));
        break;
      case '-user': {
        const u = userByName(ctx.st, v ?? '');
        if (!u) {
          io.err(`find: ${lq(v ?? '')} is not the name of a known user\n`);
          return 1;
        }
        push((_p, node) => node.uid === u.uid);
        i++;
        break;
      }
      case '-perm': {
        const mode = parseInt((v ?? '').replace(/^[-/]/, ''), 8);
        const kind = v?.[0];
        push((_p, node) => (kind === '-' ? (node.mode & mode) === mode : kind === '/' ? (node.mode & mode) !== 0 : (node.mode & 0o7777) === mode));
        i++;
        break;
      }
      case '-mtime':
      case '-mmin': {
        const spec = v ?? '0';
        const n = Math.abs(Number(spec));
        const unit = a === '-mtime' ? 86400 : 60;
        push((_p, node) => {
          const age = Math.floor((ctx.st.clock - node.mtime) / unit);
          return spec.startsWith('+') ? age > n : spec.startsWith('-') ? age < n : age === n;
        });
        i++;
        break;
      }
      case '-maxdepth':
        maxdepth = Number(v);
        i++;
        break;
      case '-mindepth':
        mindepth = Number(v);
        i++;
        break;
      case '-print':
        break;
      case '-delete':
        action = { kind: 'delete' };
        ctx.danger = true;
        break;
      case '-exec': {
        const cmd: string[] = [];
        i++;
        while (i < args.length && args[i] !== ';' && args[i] !== '+') cmd.push(args[i++]!);
        if (i >= args.length) {
          io.err('find: missing argument to `-exec\'\n');
          return 1;
        }
        action = { kind: 'exec', cmd };
        break;
      }
      default:
        if (a.startsWith('-')) {
          io.err(`find: unknown predicate \`${a}'\n`);
          return 1;
        }
        io.err(`find: paths must precede expression: \`${a}'\nfind: possible unquoted pattern after predicate \`${args[i - 1] ?? ''}'?\n`);
        return 1;
    }
  }
  let code = 0;
  const hits: { path: string; shown: string }[] = [];
  const walk = (path: string, shown: string, depth: number) => {
    const node = ctx.st.fs[path];
    if (!node) return;
    if (depth >= mindepth && depth <= maxdepth && tests.every((t) => t(path, node, depth, shown))) {
      hits.push({ path, shown });
      // find prints as it walks, so names and "Permission denied" lines mix like on a real server.
      if (action.kind === 'print') io.out(`${shown}\n`);
    }
    if (node.type !== 'dir' || depth >= maxdepth) return;
    if (!can(ctx.st, ctx.sh.user, node, 'r') || !can(ctx.st, ctx.sh.user, node, 'x')) {
      io.err(`find: ${lq(shown)}: Permission denied\n`);
      code = 1;
      return;
    }
    for (const name of childNames(ctx.st, path)) walk(joinPath(path, name), shown === '/' ? `/${name}` : `${shown}/${name}`, depth + 1);
  };
  for (const start of paths) {
    const f = lookup(ctx.st, ctx.sh.user, absPath(ctx.sh.cwd, start));
    if (!f.ok) {
      io.err(`find: ${lq(start)}: ${errText(f.err)}\n`);
      code = 1;
      continue;
    }
    walk(f.path, start.length > 1 ? start.replace(/\/$/, '') : start, 0);
  }
  if (action.kind === 'delete') {
    for (const h of [...hits].reverse()) {
      const node = ctx.st.fs[h.path];
      if (node?.type === 'dir' && childNames(ctx.st, h.path).length) {
        io.err(`find: cannot delete ${lq(h.shown)}: Directory not empty\n`);
        code = 1;
        continue;
      }
      delete ctx.st.fs[h.path];
      ctx.events.push({ type: 'fileRemoved', path: h.path });
    }
  } else if (action.kind === 'exec') {
    for (const h of hits) {
      const cmd = action.cmd.map((c) => c.replace(/\{\}/g, h.shown));
      if (ctx.exec(cmd, io) !== 0) code = 1;
    }
  }
  setExplain(ctx, hits.length ? 'linux.explain.find' : 'linux.explain.findNone', { n: hits.length });
  return code;
};

export const tree: Program = (ctx, argv, io) => {
  let all = false;
  let dirsOnly = false;
  let fullPath = false;
  let noReport = false;
  let level = Infinity;
  const starts: string[] = [];
  const args = argv.slice(1);
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '--noreport') noReport = true;
    else if (a === '-L' || a.startsWith('-L')) {
      // -L 1 / -L1: how many levels deep to go.
      const v = a === '-L' ? args[++i] : a.slice(2);
      if (v === undefined) {
        io.err('tree: Missing argument to -L option.\n');
        return 1;
      }
      const n = Number(v);
      if (!/^\d+$/.test(v) || n < 1) {
        io.err('tree: Invalid level, must be greater than 0.\n');
        return 1;
      }
      level = n;
    } else if (/^-[adfC]+$/.test(a)) {
      if (a.includes('a')) all = true;
      if (a.includes('d')) dirsOnly = true;
      if (a.includes('f')) fullPath = true;
    } else if (a.startsWith('-') && a !== '-') {
      io.err(`tree: Invalid argument -\`${a.slice(1, 2)}'.\nusage: tree [-acdfghilnpqrstuvxACDFJQNSUX] [-L level [-R]] [-H [-]baseHREF]\n\t[-T title] [-o filename] [-P pattern] [-I pattern] [--gitignore]\n\t[--gitfile[=]file] [--matchdirs] [--metafirst] [--ignore-case]\n\t[--nolinks] [--hintro[=]file] [--houtro[=]file] [--inodes] [--device]\n\t[--sort[=]<name>] [--dirsfirst] [--filesfirst] [--filelimit #] [--si]\n\t[--du] [--prune] [--charset X] [--timefmt[=]format] [--fromfile]\n\t[--fflinks] [--info] [--infofile[=]file] [--noreport] [--version] [--help]\n\t[--] [directory ...]\n`);
      return 1;
    } else starts.push(a);
  }
  if (!starts.length) starts.push('.');
  let dirs = 0;
  let files = 0;
  let code = 0;
  for (const start of starts) {
    const f = lookup(ctx.st, ctx.sh.user, absPath(ctx.sh.cwd, start));
    if (!f.ok || f.node.type !== 'dir') {
      io.out(`${start}  [error opening dir]\n`);
      code = 2;
      continue;
    }
    io.out(`${start}\n`, 'blue');
    const walk = (path: string, prefix: string, depth: number, shownPath: string) => {
      const names = childNames(ctx.st, path).filter((n) => all || !n.startsWith('.')).filter((n) => !dirsOnly || ctx.st.fs[joinPath(path, n)]?.type === 'dir');
      names.forEach((n, i) => {
        const p = joinPath(path, n);
        const node = ctx.st.fs[p]!;
        const last = i === names.length - 1;
        const shown = fullPath ? `${shownPath}/${n}` : n;
        io.out(`${prefix}${last ? '└── ' : '├── '}`);
        io.out(shown, nodeColor(node));
        io.out(node.type === 'link' ? ` -> ${node.target}\n` : '\n');
        if (node.type === 'dir') {
          dirs++;
          // tree's UTF-8 line is "│", two no-break spaces, then a space.
          if (depth < level && can(ctx.st, ctx.sh.user, node, 'r')) walk(p,`${prefix}${last ? '    ' : '│\u00a0\u00a0 '}`, depth + 1, shown);
        } else files++;
      });
    };
    walk(f.path, '', 1, start);
    // tree 2.2 counts the top folder too, when it has anything in it.
    if (childNames(ctx.st, f.path).some((n) => all || !n.startsWith('.'))) dirs++;
  }
  if (!noReport) io.out(`\n${dirs} director${dirs === 1 ? 'y' : 'ies'}${dirsOnly ? '' : `, ${files} file${files === 1 ? '' : 's'}`}\n`);
  setExplain(ctx, 'linux.explain.tree');
  return code;
};

export const stat: Program = (ctx, argv, io) => {
  const fmt = argv.find((a, i) => argv[i - 1] === '-c' || a.startsWith('--format='));
  const args = argv.slice(1).filter((a, i) => !a.startsWith('-') && argv[i] !== '-c');
  let code = 0;
  for (const name of args) {
    const f = lookup(ctx.st, ctx.sh.user, absPath(ctx.sh.cwd, name), false);
    if (!f.ok) {
      io.err(`stat: cannot statx ${q(name)}: ${errText(f.err)}\n`);
      code = 1;
      continue;
    }
    if (fmt) {
      const v = fmt.replace(/^--format=/, '');
      io.out(
        `${v
          .replace(/%a/g, (f.node.mode & 0o7777).toString(8))
          .replace(/%A/g, modeString(f.node))
          .replace(/%U/g, uidName(ctx.st, f.node.uid))
          .replace(/%G/g, gidName(ctx.st, f.node.gid))
          .replace(/%s/g, String(fileSize(f.node)))
          .replace(/%n/g, name)}\n`,
      );
      continue;
    }
    io.out(`  File: ${name}${f.node.type === 'link' ? ` -> ${f.node.target}` : ''}\n`);
    io.out(`  Size: ${String(fileSize(f.node)).padEnd(15)} Blocks: ${String(blocksOf(f.node) * 2).padEnd(10)} IO Block: 4096   ${f.node.type === 'dir' ? 'directory' : f.node.type === 'link' ? 'symbolic link' : fileSize(f.node) ? 'regular file' : 'regular empty file'}\n`);
    io.out(`Access: (${(f.node.mode & 0o7777).toString(8).padStart(4, '0')}/${modeString(f.node)})  Uid: (${String(f.node.uid).padStart(5)}/${uidName(ctx.st, f.node.uid).padStart(8)})   Gid: (${String(f.node.gid).padStart(5)}/${gidName(ctx.st, f.node.gid).padStart(8)})\n`);
  }
  setExplain(ctx, 'linux.explain.stat');
  return code;
};

export const du: Program = (ctx, argv, io) => {
  const p = parseOpts(argv.slice(1), 'shac', ['summarize', 'human-readable', 'max-depth'], ['d']);
  if (p.bad || p.badLong) return badOption(io, 'du', p);
  const hum = p.flags.has('h') || p.flags.has('human-readable');
  const sum = p.flags.has('s') || p.flags.has('summarize');
  const maxd = p.values.d !== undefined ? Number(p.values.d) : sum ? 0 : Infinity;
  const fmt = (kb: number) => (hum ? (kb === 0 ? '0' : human(kb * 1024)) : String(kb));
  let code = 0;
  let total = 0;
  for (const t of p.args.length ? p.args : ['.']) {
    const f = lookup(ctx.st, ctx.sh.user, absPath(ctx.sh.cwd, t));
    if (!f.ok) {
      io.err(`du: cannot access ${q(t)}: ${errText(f.err)}\n`);
      code = 1;
      continue;
    }
    const walk = (path: string, shown: string, depth: number): number => {
      const node = ctx.st.fs[path]!;
      if (node.type !== 'dir') {
        const kb = blocksOf(node) || (fileSize(node) ? 4 : 0);
        if (depth === 0 || p.flags.has('a')) io.out(`${fmt(kb)}\t${shown}\n`);
        return kb;
      }
      let kb = 4;
      if (!can(ctx.st, ctx.sh.user, node, 'r')) {
        io.err(`du: cannot read directory ${q(shown)}: Permission denied\n`);
        code = 1;
      } else for (const n of childNames(ctx.st, path)) kb += walk(joinPath(path, n), `${shown.replace(/\/$/, '')}/${n}`, depth + 1);
      if (depth <= maxd) io.out(`${fmt(kb)}\t${shown}\n`);
      return kb;
    };
    total += walk(f.path, t, 0);
  }
  if (p.flags.has('c')) io.out(`${fmt(total)}\ttotal\n`);
  setExplain(ctx, 'linux.explain.du');
  return code;
};

export const basename: Program = (_ctx, argv, io) => {
  const [p, suffix] = argv.slice(1);
  if (p === undefined) {
    io.err("basename: missing operand\nTry 'basename --help' for more information.\n");
    return 1;
  }
  let b = baseName(p);
  if (suffix && b.endsWith(suffix) && b !== suffix) b = b.slice(0, -suffix.length);
  io.out(`${b}\n`);
  return 0;
};

export const dirname: Program = (_ctx, argv, io) => {
  const p = argv[1];
  if (p === undefined) {
    io.err("dirname: missing operand\nTry 'dirname --help' for more information.\n");
    return 1;
  }
  const t = p.replace(/\/+$/, '');
  io.out(`${t.includes('/') ? t.slice(0, t.lastIndexOf('/')) || '/' : '.'}\n`);
  return 0;
};

export const realpath: Program = (ctx, argv, io) => {
  let code = 0;
  for (const a of argv.slice(1)) {
    const f = lookup(ctx.st, ctx.sh.user, absPath(ctx.sh.cwd, a));
    if (!f.ok) {
      io.err(`realpath: ${a}: ${errText(f.err)}\n`);
      code = 1;
      continue;
    }
    io.out(`${f.path}\n`);
  }
  return code;
};
