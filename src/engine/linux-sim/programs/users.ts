// Users, groups and permissions: id whoami groups sudo su chmod chown chgrp useradd usermod
// groupadd userdel passwd.
import { badOption, errText, parseOpts, q, setExplain, umaskOf, type Ctx, type IO } from '../ctx';
import { absPath, can, childNames, descendants, gidsOf, groupByGid, groupByName, joinPath, lookup, modeString, octal, userByName, userByUid } from '../fs';
import { journal } from '../services';
import { spawn } from '../procs';
import { lq, type Program } from './files';
import type { FsNode, Shell } from '../types';

const SECURE_PATH = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';

export const whoami: Program = (ctx, _argv, io) => {
  io.out(`${ctx.sh.user}\n`);
  setExplain(ctx, 'linux.explain.whoami', { user: ctx.sh.user });
  return 0;
};

export const id: Program = (ctx, argv, io) => {
  const p = parseOpts(argv.slice(1), 'ugGnr', ['user', 'group', 'groups', 'name'], []);
  if (p.bad || p.badLong) return badOption(io, 'id', p);
  const name = p.args[0] ?? ctx.sh.user;
  const u = userByName(ctx.st, name) ?? (/^\d+$/.test(name) ? userByUid(ctx.st, Number(name)) : undefined);
  if (!u) {
    io.err(`id: ${lq(name)}: no such user\n`);
    return 1;
  }
  const gids = gidsOf(ctx.st, u.name);
  const gname = (g: number) => groupByGid(ctx.st, g)?.name ?? String(g);
  const n = p.flags.has('n') || p.flags.has('name');
  if (p.flags.has('u') || p.flags.has('user')) io.out(`${n ? u.name : u.uid}\n`);
  else if (p.flags.has('g') || p.flags.has('group')) io.out(`${n ? gname(u.gid) : u.gid}\n`);
  else if (p.flags.has('G') || p.flags.has('groups')) io.out(`${gids.map((g) => (n ? gname(g) : g)).join(' ')}\n`);
  else io.out(`uid=${u.uid}(${u.name}) gid=${u.gid}(${gname(u.gid)}) groups=${gids.map((g) => `${g}(${gname(g)})`).join(',')}\n`);
  setExplain(ctx, 'linux.explain.id', { user: u.name });
  return 0;
};

export const groups: Program = (ctx, argv, io) => {
  const names = argv.slice(1);
  if (!names.length) {
    io.out(`${gidsOf(ctx.st, ctx.sh.user).map((g) => groupByGid(ctx.st, g)?.name ?? g).join(' ')}\n`);
    setExplain(ctx, 'linux.explain.groups', { user: ctx.sh.user });
    return 0;
  }
  let code = 0;
  for (const n of names) {
    if (!userByName(ctx.st, n)) {
      io.err(`groups: ${lq(n)}: no such user\n`);
      code = 1;
      continue;
    }
    io.out(`${n} : ${gidsOf(ctx.st, n).map((g) => groupByGid(ctx.st, g)?.name ?? g).join(' ')}\n`);
  }
  setExplain(ctx, 'linux.explain.groups', { user: names[0]! });
  return code;
};

function inSudo(ctx: Ctx, user: string): boolean {
  if (userByName(ctx.st, user)?.uid === 0) return true;
  const g = groupByName(ctx.st, 'sudo');
  if (g && gidsOf(ctx.st, user).includes(g.gid)) return true;
  return /^\s*you\s+ALL=/m.test(ctx.st.fs['/etc/sudoers.d/90-you']?.content ?? '') && user === 'you';
}

/** A new interactive shell on top (sudo -i, su -): the learner's prompt changes. */
export function pushShell(ctx: Ctx, user: string, login: boolean, via: string, keepCwd = false) {
  const u = userByName(ctx.st, user)!;
  const vars: Record<string, string> = {
    HOME: u.home,
    USER: user,
    LOGNAME: user,
    SHELL: u.shell,
    PATH: u.uid === 0 ? SECURE_PATH : '/usr/local/bin:/usr/bin:/bin:/usr/local/games:/usr/games',
    LANG: 'C.UTF-8',
    TERM: 'xterm-256color',
    PWD: keepCwd ? ctx.sh.cwd : u.home,
  };
  if (!login) Object.assign(vars, { ...Object.fromEntries(ctx.sh.exported.map((k) => [k, ctx.sh.vars[k] ?? ''])), HOME: u.home, USER: user, LOGNAME: user, PATH: vars.PATH });
  const sh: Shell = { user, cwd: keepCwd ? ctx.sh.cwd : u.home, vars, exported: Object.keys(vars), login, via };
  ctx.st.shells.push(sh);
  spawn(ctx, { args: via, comm: via.split(' ')[0]!, kind: 'other', user: 'root', state: 'S' });
  spawn(ctx, { args: login ? '-bash' : 'bash', comm: 'bash', kind: 'shell', user, state: 'S' });
  ctx.events.push({ type: 'userSwitched', user });
}

export const sudo: Program = (ctx, argv, io) => {
  const st = ctx.st;
  const args = argv.slice(1);
  let asUser = 'root';
  let i = 0;
  let loginShell = false;
  let shell = false;
  for (; i < args.length; i++) {
    const a = args[i]!;
    if (a === '-u') asUser = args[++i] ?? '';
    else if (a.startsWith('-u') && a.length > 2) asUser = a.slice(2);
    else if (a === '-i' || a === '--login') loginShell = true;
    else if (a === '-s' || a === '--shell') shell = true;
    else if (a === '-k' || a === '-K') return 0;
    else if (a === '-l') {
      io.out(`Matching Defaults entries for ${ctx.sh.user} on ${st.hostname}:\n    env_reset, mail_badpass, secure_path=${SECURE_PATH}, use_pty\n\nUser ${ctx.sh.user} may run the following commands on ${st.hostname}:\n    (ALL : ALL) ALL\n    (ALL) NOPASSWD: ALL\n`);
      return 0;
    } else if (a === '-v') return 0;
    else if (a === '--') {
      i++;
      break;
    } else if (a.startsWith('-')) {
      io.err(`sudo: invalid option -- '${a.slice(1, 2)}'\nusage: sudo -h | -K | -k | -V\n`);
      return 1;
    } else break;
  }
  const cmd = args.slice(i);
  if (!inSudo(ctx, ctx.sh.user)) {
    io.err(`${ctx.sh.user} is not in the sudoers file.\n`);
    setExplain(ctx, 'linux.err.notSudoer', { user: ctx.sh.user });
    return 1;
  }
  const target = userByName(st, asUser);
  if (!target) {
    io.err(`sudo: unknown user ${asUser}\nsudo: error initializing audit plugin sudoers_audit\n`);
    return 1;
  }
  ctx.danger = true;
  const logCmd = loginShell || shell ? '/bin/bash' : cmd.join(' ');
  const pid = ctx.curPid || st.nextPid++;
  const fromUid = userByName(st, ctx.sh.user)?.uid ?? 0;
  journal(st, '', 'sudo', pid, `${ctx.sh.user.padStart(8)} : PWD=${ctx.sh.cwd} ; USER=${asUser} ; COMMAND=${resolveForLog(ctx, cmd[0]) ?? logCmd}${cmd.length > 1 ? ` ${cmd.slice(1).join(' ')}` : ''}`, fromUid);
  journal(st, '', 'sudo', pid, `pam_unix(sudo:session): session opened for user ${asUser}(uid=${target.uid}) by ${ctx.sh.user}(uid=${userByName(st, ctx.sh.user)?.uid ?? 0})`, fromUid);
  if ((loginShell || shell) && !cmd.length) {
    if (!ctx.interactive) return 0;
    pushShell(ctx, asUser, loginShell, loginShell ? 'sudo -i' : 'sudo -s', !loginShell);
    setExplain(ctx, 'linux.explain.sudoShell', { user: asUser });
    return 0;
  }
  if (!cmd.length) {
    io.err('usage: sudo -h | -K | -k | -V\nusage: sudo -v [-ABkNnS] [-g group] [-h host] [-p prompt] [-u user]\n');
    return 1;
  }
  // sudo su / sudo su - / sudo bash: a root shell.
  if (ctx.interactive && ((cmd[0] === 'su' && cmd.length <= 2 && (cmd[1] === undefined || cmd[1] === '-' || cmd[1] === 'root' || cmd[1] === '-l')) || (cmd[0] === 'bash' && cmd.length === 1))) {
    pushShell(ctx, 'root', cmd[1] === '-' || cmd[1] === '-l', `sudo ${cmd.join(' ')}`, !(cmd[1] === '-' || cmd[1] === '-l'));
    setExplain(ctx, 'linux.explain.sudoShell', { user: 'root' });
    return 0;
  }
  const saved = ctx.sh;
  const vars: Record<string, string> = { ...Object.fromEntries(['TERM', 'LANG', 'DISPLAY'].filter((k) => saved.vars[k]).map((k) => [k, saved.vars[k]!])), HOME: target.home, USER: asUser, LOGNAME: asUser, SHELL: target.shell, PATH: SECURE_PATH, SUDO_USER: saved.user, SUDO_UID: String(userByName(st, saved.user)?.uid ?? 0), SUDO_GID: String(userByName(st, saved.user)?.gid ?? 0), SUDO_COMMAND: cmd.join(' '), MAIL: `/var/mail/${asUser}` };
  const sh: Shell = { user: asUser, cwd: saved.cwd, vars: { ...vars, PWD: saved.cwd }, exported: [...Object.keys(vars), 'PWD'], login: false };
  ctx.sh = sh;
  const savedInteractive = ctx.interactive;
  try {
    // Builtins are not programs: sudo cd fails like the real one.
    const found = findForSudo(ctx, cmd[0]!);
    if (!found) {
      io.err(`sudo: ${cmd[0]}: command not found\n`);
      setExplain(ctx, 'linux.err.sudoNotFound', { name: cmd[0]! });
      return 1;
    }
    delete ctx.explain;
    const code = ctx.exec(cmd, io, undefined, true);
    const after = (ctx as { explain?: { key: string } }).explain;
    if (!after || /explain\.(echo|cat|ls)$/.test(after.key)) ctx.explain = { key: 'linux.explain.sudo', params: { cmd: cmd[0]!, user: asUser } };
    return code;
  } finally {
    ctx.sh = saved;
    ctx.interactive = savedInteractive;
    journal(st, '', 'sudo', pid, `pam_unix(sudo:session): session closed for user ${asUser}`, fromUid);
  }
};

function resolveForLog(ctx: Ctx, name: string | undefined): string | null {
  if (!name) return null;
  if (name.includes('/')) return name;
  for (const dir of SECURE_PATH.split(':')) if (lookup(ctx.st, 'root', `${dir}/${name}`).ok) return `${dir.replace(/^\/bin$/, '/usr/bin')}/${name}`;
  return null;
}

function findForSudo(ctx: Ctx, name: string): boolean {
  if (name.includes('/')) {
    const f = lookup(ctx.st, 'root', absPath(ctx.sh.cwd, name));
    return f.ok && f.node.type === 'file';
  }
  for (const dir of SECURE_PATH.split(':')) {
    const f = lookup(ctx.st, 'root', `${dir}/${name}`);
    if (f.ok && f.node.type === 'file') return true;
  }
  return false;
}

export const su: Program = (ctx, argv, io) => {
  const args = argv.slice(1);
  const login = args.includes('-') || args.includes('-l') || args.includes('--login');
  const cIdx = args.indexOf('-c');
  const command = cIdx >= 0 ? args[cIdx + 1] : undefined;
  const target = args.filter((a, i) => !a.startsWith('-') && (cIdx < 0 || i !== cIdx + 1))[0] ?? 'root';
  const u = userByName(ctx.st, target);
  if (!u) {
    io.err(`su: user ${target} does not exist or the user entry does not contain all the required fields\n`);
    return 1;
  }
  const amRoot = userByName(ctx.st, ctx.sh.user)?.uid === 0;
  if (!amRoot) {
    io.err('Password: \nsu: Authentication failure\n');
    setExplain(ctx, 'linux.err.suPassword');
    return 1;
  }
  if (u.shell.endsWith('nologin')) {
    io.out('This account is currently not available.\n');
    return 1;
  }
  if (command !== undefined) return ctx.runSource(command, io, { arg0: 'bash', args: [], user: target });
  if (!ctx.interactive) return 0;
  pushShell(ctx, target, login, login ? `su - ${target}` : `su ${target}`, !login);
  setExplain(ctx, 'linux.explain.su', { user: target });
  return 0;
};

/** passwd needs typed (hidden) passwords: explain-only here, with no made-up output. */
export const passwd: Program = (ctx) => {
  setExplain(ctx, 'linux.err.passwdNoTyping');
  return 1;
};

// ---------------------------------------------------------------------------
// chmod

/** Apply a chmod mode ("755", "u+x", "go-w,a+r") to a mode. Null when the text is not a mode. */
export function applyMode(mode: number, spec: string, isDir: boolean, umask = 0o022): number | null {
  if (/^[0-7]{1,4}$/.test(spec)) {
    const n = parseInt(spec, 8);
    // Like GNU chmod: 3 digits keep a folder's setuid/setgid bits.
    return spec.length <= 3 && isDir ? (mode & 0o6000) | n : n;
  }
  let m = mode;
  for (const clause of spec.split(',')) {
    const c = /^([ugoa]*)([-+=])([rwxXst]*|[ugo])$/.exec(clause);
    if (!c) {
      const multi = /^([ugoa]*)((?:[-+=][rwxXst]*)+)$/.exec(clause);
      if (!multi) return null;
      let mm: number | null = m;
      for (const part of multi[2]!.match(/[-+=][rwxXst]*/g) ?? []) {
        mm = applyMode(mm!, `${multi[1]}${part}`, isDir, umask);
        if (mm === null) return null;
      }
      m = mm!;
      continue;
    }
    const who = c[1] || '';
    const op = c[2]!;
    const perms = c[3]!;
    const users = who.includes('a') || who === '' ? 'ugo' : who;
    let bits = 0;
    if (/^[ugo]$/.test(perms)) {
      const src = perms === 'u' ? (m >> 6) & 7 : perms === 'g' ? (m >> 3) & 7 : m & 7;
      for (const u of users) bits |= src << (u === 'u' ? 6 : u === 'g' ? 3 : 0);
    } else
      for (const u of users) {
        const shift = u === 'u' ? 6 : u === 'g' ? 3 : 0;
        for (const p of perms) {
          if (p === 'r') bits |= 4 << shift;
          if (p === 'w') bits |= 2 << shift;
          if (p === 'x') bits |= 1 << shift;
          if (p === 'X' && (isDir || m & 0o111)) bits |= 1 << shift;
          if (p === 's' && u === 'u') bits |= 0o4000;
          if (p === 's' && u === 'g') bits |= 0o2000;
          if (p === 't') bits |= 0o1000;
        }
      }
    if (who === '') bits &= ~umask;
    if (op === '+') m |= bits;
    else if (op === '-') m &= ~bits;
    else {
      for (const u of users) m &= ~(7 << (u === 'u' ? 6 : u === 'g' ? 3 : 0));
      m |= bits;
    }
  }
  return m;
}

function rwx(mode: number): string {
  return modeString({ type: 'file', mode, uid: 0, gid: 0, mtime: 0 }).slice(1);
}

export const chmod: Program = (ctx, argv, io) => {
  const raw = argv.slice(1);
  const flags = new Set<string>();
  const rest: string[] = [];
  for (const a of raw) {
    if (/^-[Rvcf]+$/.test(a)) for (const c of a.slice(1)) flags.add(c);
    else if (a === '--recursive') flags.add('R');
    else if (a === '--verbose') flags.add('v');
    else rest.push(a);
  }
  const [spec, ...files] = rest;
  if (spec === undefined) {
    io.err("chmod: missing operand\nTry 'chmod --help' for more information.\n");
    return 1;
  }
  if (applyMode(0o644, spec, false) === null) {
    io.err(`chmod: invalid mode: ${lq(spec)}\nTry 'chmod --help' for more information.\n`);
    setExplain(ctx, 'linux.err.badMode', { mode: spec });
    return 1;
  }
  if (!files.length) {
    io.err(`chmod: missing operand after ${lq(spec)}\nTry 'chmod --help' for more information.\n`);
    return 1;
  }
  const meU = userByName(ctx.st, ctx.sh.user)!;
  let code = 0;
  const change = (path: string, shown: string, node: FsNode) => {
    if (node.type === 'link') return;
    if (meU.uid !== 0 && node.uid !== meU.uid) {
      io.err(`chmod: changing permissions of ${q(shown)}: Operation not permitted\n`);
      setExplain(ctx, 'linux.err.notOwner', { name: shown });
      code = 1;
      return;
    }
    const before = node.mode;
    node.mode = applyMode(node.mode, spec, node.type === 'dir', umaskOf(ctx))!;
    ctx.events.push({ type: 'modeChanged', path, mode: node.mode });
    if (flags.has('v') || (flags.has('c') && before !== node.mode)) {
      io.out(before === node.mode ? `mode of ${q(shown)} retained as ${octal(before)} (${rwx(before)})\n` : `mode of ${q(shown)} changed from ${octal(before)} (${rwx(before)}) to ${octal(node.mode)} (${rwx(node.mode)})\n`);
    }
  };
  for (const name of files) {
    const f = lookup(ctx.st, ctx.sh.user, absPath(ctx.sh.cwd, name));
    if (!f.ok) {
      io.err(`chmod: cannot access ${q(name)}: ${errText(f.err)}\n`);
      code = 1;
      continue;
    }
    change(f.path, name, f.node);
    if (flags.has('R') && f.node.type === 'dir') for (const d of descendants(ctx.st, f.path).sort()) change(d, `${name.replace(/\/$/, '')}${d.slice(f.path.length)}`, ctx.st.fs[d]!);
  }
  if (!code) {
    const f = lookup(ctx.st, ctx.sh.user, absPath(ctx.sh.cwd, files[0]!));
    setExplain(ctx, /^[0-7]+$/.test(spec) ? 'linux.explain.chmodOctal' : 'linux.explain.chmod', { name: files[0]!, mode: f.ok ? modeString(f.node) : spec });
    if (/777/.test(spec)) ctx.danger = true;
  }
  return code;
};

function chownLike(ctx: Ctx, argv: string[], io: IO, which: 'chown' | 'chgrp'): number {
  const raw = argv.slice(1);
  const rec = raw.some((a) => a === '-R' || a === '--recursive');
  const verbose = raw.some((a) => a === '--verbose' || /^-[a-zA-Z]*v/.test(a));
  const changes = raw.some((a) => a === '--changes' || /^-[a-zA-Z]*c/.test(a));
  const rest = raw.filter((a) => !a.startsWith('-'));
  const [spec, ...files] = rest;
  if (spec === undefined) {
    io.err(`${which}: missing operand\nTry '${which} --help' for more information.\n`);
    return 1;
  }
  if (!files.length) {
    io.err(`${which}: missing operand after ${lq(spec)}\nTry '${which} --help' for more information.\n`);
    return 1;
  }
  let uid: number | undefined;
  let gid: number | undefined;
  if (which === 'chgrp') {
    const g = groupByName(ctx.st, spec) ?? (/^\d+$/.test(spec) ? groupByGid(ctx.st, Number(spec)) : undefined);
    if (!g) {
      io.err(`chgrp: invalid group: ${lq(spec)}\n`);
      return 1;
    }
    gid = g.gid;
  } else {
    const [un, gn] = spec.split(/[:.]/) as [string, string | undefined];
    if (un) {
      const u = userByName(ctx.st, un) ?? (/^\d+$/.test(un) ? userByUid(ctx.st, Number(un)) : undefined);
      if (!u) {
        io.err(`chown: invalid user: ${lq(spec)}\n`);
        setExplain(ctx, 'linux.err.noUser', { name: un });
        return 1;
      }
      uid = u.uid;
      if (gn === '' && spec.includes(':')) gid = u.gid;
    }
    if (gn) {
      const g = groupByName(ctx.st, gn);
      if (!g) {
        io.err(`chown: invalid group: ${lq(spec)}\n`);
        return 1;
      }
      gid = g.gid;
    }
  }
  // The names -v prints: chown's user part ('' for ":group") and group part, chgrp's group.
  let userStr: string | null = null;
  let groupStr: string | null = null;
  if (which === 'chgrp') groupStr = spec;
  else {
    const [un, gn] = spec.split(/[:.]/) as [string, string | undefined];
    userStr = un;
    if (gn) groupStr = gn;
    else if (gn === '' && un) groupStr = groupByGid(ctx.st, userByName(ctx.st, un)?.gid ?? -1)?.name ?? null;
  }
  const meU = userByName(ctx.st, ctx.sh.user)!;
  let code = 0;
  const change = (path: string, shown: string, node: FsNode) => {
    const okUser = uid === undefined || uid === node.uid || meU.uid === 0;
    const okGroup = gid === undefined || meU.uid === 0 || (node.uid === meU.uid && gidsOf(ctx.st, meU.name).includes(gid));
    if (!okUser || !okGroup || (meU.uid !== 0 && node.uid !== meU.uid)) {
      io.err(`${which}: changing ${which === 'chgrp' || uid === undefined ? 'group' : 'ownership'} of ${q(shown)}: Operation not permitted\n`);
      setExplain(ctx, 'linux.err.chownRoot');
      code = 1;
      return;
    }
    const before = { uid: node.uid, gid: node.gid };
    if (uid !== undefined) node.uid = uid;
    if (gid !== undefined) node.gid = gid;
    const changed = before.uid !== node.uid || before.gid !== node.gid;
    if (verbose || (changes && changed)) {
      // coreutils describe_change(): "user", "user:group" or the group alone, old and new.
      const str = (u: string | null, g: string | null) => (u !== null ? (g !== null ? `${u}:${g}` : u) : g);
      const oldSpec = str(userStr !== null ? (userByUid(ctx.st, before.uid)?.name ?? String(before.uid)) : null, groupStr !== null ? (groupByGid(ctx.st, before.gid)?.name ?? String(before.gid)) : null);
      const newSpec = str(userStr, groupStr);
      const what = userStr !== null ? 'ownership' : 'group';
      io.out(changed ? `changed ${what} of ${q(shown)} from ${oldSpec} to ${newSpec}\n` : `${what} of ${q(shown)} retained as ${newSpec}\n`);
    }
    ctx.events.push({ type: 'ownerChanged', path, owner: userByUid(ctx.st, node.uid)?.name ?? '', group: groupByGid(ctx.st, node.gid)?.name ?? '' });
  };
  for (const name of files) {
    const f = lookup(ctx.st, ctx.sh.user, absPath(ctx.sh.cwd, name));
    if (!f.ok) {
      io.err(`${which}: cannot access ${q(name)}: ${errText(f.err)}\n`);
      code = 1;
      continue;
    }
    change(f.path, name, f.node);
    if (rec && f.node.type === 'dir') for (const d of descendants(ctx.st, f.path).sort()) change(d, `${name}${d.slice(f.path.length)}`, ctx.st.fs[d]!);
  }
  if (!code) setExplain(ctx, which === 'chown' ? 'linux.explain.chown' : 'linux.explain.chgrp', { name: files[0]!, owner: spec });
  return code;
}

export const chown: Program = (ctx, argv, io) => chownLike(ctx, argv, io, 'chown');
export const chgrp: Program = (ctx, argv, io) => chownLike(ctx, argv, io, 'chgrp');

// ---------------------------------------------------------------------------
// useradd, usermod, groupadd, userdel

function needRoot(ctx: Ctx, io: IO, prog: string): boolean {
  if (userByName(ctx.st, ctx.sh.user)?.uid === 0) return true;
  io.err(`${prog}: Permission denied.\n${prog}: cannot lock /etc/passwd; try again later.\n`);
  return false;
}

function syncPasswd(ctx: Ctx) {
  const st = ctx.st;
  const passwd = st.users.map((u) => `${u.name}:x:${u.uid}:${u.gid}:${u.gecos}:${u.home}:${u.shell}`).join('\n');
  const group = st.groups.map((g) => `${g.name}:x:${g.gid}:${g.members.join(',')}`).join('\n');
  if (st.fs['/etc/passwd']) st.fs['/etc/passwd'].content = `${passwd}\n`;
  if (st.fs['/etc/group']) st.fs['/etc/group'].content = `${group}\n`;
  // shadow and gshadow keep each line's fields; a new account is locked ("!") from today.
  const day = Math.floor(st.clock / 86400);
  const keep = (path: string) => new Map((st.fs[path]?.content ?? '').split('\n').filter(Boolean).map((l) => [l.split(':')[0]!, l]));
  const shadow = keep('/etc/shadow');
  const gshadow = keep('/etc/gshadow');
  if (st.fs['/etc/shadow']) st.fs['/etc/shadow'].content = `${st.users.map((u) => shadow.get(u.name) ?? `${u.name}:!:${day}:0:99999:7:::`).join('\n')}\n`;
  if (st.fs['/etc/gshadow']) {
    st.fs['/etc/gshadow'].content = `${st.groups.map((g) => `${(gshadow.get(g.name) ?? `${g.name}:!::`).split(':').slice(0, 3).join(':')}:${g.members.join(',')}`).join('\n')}\n`;
  }
}

export const useradd: Program = (ctx, argv, io) => {
  const p = parseOpts(argv.slice(1), 'mMr', ['create-home', 'system'], ['s', 'G', 'g', 'd', 'c', 'u']);
  if (!needRoot(ctx, io, 'useradd')) return 1;
  const name = p.args[0];
  if (!name) {
    io.err('Usage: useradd [options] LOGIN\n');
    return 2;
  }
  if (userByName(ctx.st, name)) {
    io.err(`useradd: user '${name}' already exists\n`);
    return 9;
  }
  for (const g of (p.values.G ?? '').split(',').filter(Boolean)) {
    if (!groupByName(ctx.st, g)) {
      io.err(`useradd: group '${g}' does not exist\n`);
      return 6;
    }
  }
  const uid = p.values.u ? Number(p.values.u) : Math.max(999, ...ctx.st.users.filter((u) => u.uid >= 1000 && u.uid < 60000).map((u) => u.uid)) + 1;
  let gid = uid;
  if (p.values.g) gid = groupByName(ctx.st, p.values.g)?.gid ?? uid;
  else {
    if (ctx.st.groups.some((g) => g.gid === gid)) gid = Math.max(...ctx.st.groups.filter((g) => g.gid < 60000).map((g) => g.gid)) + 1;
    ctx.st.groups.push({ name, gid, members: [] });
  }
  const homeDir = p.values.d ?? `/home/${name}`;
  ctx.st.users.push({ name, uid, gid, gecos: p.values.c ?? '', home: homeDir, shell: p.values.s ?? '/bin/sh' });
  for (const g of (p.values.G ?? '').split(',').filter(Boolean)) groupByName(ctx.st, g)!.members.push(name);
  if (p.flags.has('m') || p.flags.has('create-home')) {
    ctx.st.fs[homeDir] = { type: 'dir', mode: 0o700, uid, gid, mtime: ctx.st.clock };
    for (const n of childNames(ctx.st, '/etc/skel')) {
      const src = ctx.st.fs[joinPath('/etc/skel', n)]!;
      ctx.st.fs[joinPath(homeDir, n)] = { ...src, uid, gid };
    }
  }
  syncPasswd(ctx);
  setExplain(ctx, 'linux.explain.useradd', { name });
  return 0;
};

export const usermod: Program = (ctx, argv, io) => {
  const p = parseOpts(argv.slice(1), 'aL', ['append'], ['G', 's', 'g']);
  if (!needRoot(ctx, io, 'usermod')) return 1;
  const name = p.args[0] ?? '';
  const u = name ? userByName(ctx.st, name) : undefined;
  if (!u) {
    io.err(name ? `usermod: user '${name}' does not exist\n` : 'Usage: usermod [options] LOGIN\n');
    return name ? 6 : 2;
  }
  if (p.values.G !== undefined) {
    const list = p.values.G.split(',').filter(Boolean);
    for (const g of list) {
      if (!groupByName(ctx.st, g)) {
        io.err(`usermod: group '${g}' does not exist\n`);
        return 6;
      }
    }
    if (!p.flags.has('a')) for (const g of ctx.st.groups) g.members = g.members.filter((m) => m !== name);
    for (const g of list) {
      const grp = groupByName(ctx.st, g)!;
      if (!grp.members.includes(name)) grp.members.push(name);
    }
  }
  if (p.values.s) u.shell = p.values.s;
  syncPasswd(ctx);
  setExplain(ctx, 'linux.explain.usermod', { name, group: p.values.G ?? '' });
  return 0;
};

export const groupadd: Program = (ctx, argv, io) => {
  if (!needRoot(ctx, io, 'groupadd')) return 1;
  const name = argv.slice(1).find((a) => !a.startsWith('-'));
  if (!name) {
    io.err('Usage: groupadd [options] GROUP\n');
    return 2;
  }
  if (groupByName(ctx.st, name)) {
    io.err(`groupadd: group '${name}' already exists\n`);
    return 9;
  }
  const gid = Math.max(999, ...ctx.st.groups.filter((g) => g.gid >= 1000 && g.gid < 60000).map((g) => g.gid)) + 1;
  ctx.st.groups.push({ name, gid, members: [] });
  syncPasswd(ctx);
  setExplain(ctx, 'linux.explain.groupadd', { name });
  return 0;
};

export const userdel: Program = (ctx, argv, io) => {
  if (!needRoot(ctx, io, 'userdel')) return 1;
  const rmHome = argv.includes('-r');
  const name = argv.slice(1).find((a) => !a.startsWith('-'));
  const u = name ? userByName(ctx.st, name) : undefined;
  if (!u) {
    io.err(`userdel: user '${name ?? ''}' does not exist\n`);
    return 6;
  }
  ctx.st.users = ctx.st.users.filter((x) => x !== u);
  ctx.st.groups = ctx.st.groups.filter((g) => !(g.name === name && g.gid === u.gid));
  for (const g of ctx.st.groups) g.members = g.members.filter((m) => m !== name);
  if (rmHome) for (const k of [...descendants(ctx.st, u.home), u.home]) delete ctx.st.fs[k];
  syncPasswd(ctx);
  ctx.danger = true;
  return 0;
};

export { can };
