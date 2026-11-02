// What every program gets: the machine (mutable working copy), the current shell, IO streams.
import type { Color } from '../git-sim/types';
import { ERRNO_TEXT, absPath, type Errno } from './fs';
import type { Explain, LinuxEvent, LinuxState, Shell } from './types';

export type Write = (text: string, color?: Color) => void;

export interface IO {
  /** null: reading the terminal (nothing typed: the simulator treats it as empty input). */
  stdin: string | null;
  out: Write;
  err: Write;
  /** stdout goes to the terminal (programs colour and size their output for it). */
  tty: boolean;
}

export interface ShellOpts {
  errexit: boolean;
  nounset: boolean;
  pipefail: boolean;
  xtrace: boolean;
}

export interface Ctx {
  st: LinuxState;
  sh: Shell;
  positional: string[];
  arg0: string;
  opts: ShellOpts;
  /** Script path while running a script (error prefixes say "path: line N:"). */
  script: string | null;
  line: number;
  /** Top-level command typed by the learner (job control and aliases work). */
  interactive: boolean;
  events: LinuxEvent[];
  explain?: Explain;
  danger: boolean;
  /** Loop and sleep budget so a script can't run forever. */
  budget: { steps: number };
  /** Set by `exit`, `return`, `break`, `continue`. */
  flow: { exit?: number; ret?: number; brk?: number; cont?: number };
  /** The script hit the step budget inside an endless loop: it keeps running. */
  forever?: boolean;
  traps: Record<string, string>;
  lastBg?: number;
  /** PID of the running shell (for $$). */
  pid: number;
  /** PID given to the program running now (ps shows it; long programs keep it). */
  curPid: number;
  /** Running something started with `&`. */
  bg: boolean;
  /** Run argv as a command (programs that run other programs: sudo, bash, find -exec). */
  /** `programOnly`: skip functions and builtins, like sudo and env do (they run /usr/bin/kill, not bash's kill). */
  exec(argv: string[], io: IO, asUser?: string, programOnly?: boolean): number;
  /** Run shell source in a new shell (bash script.sh, bash -c). */
  runSource(src: string, io: IO, opts: { arg0: string; args: string[]; user?: string; script?: string | null }): number;
}

/** "-bash: " or "script.sh: line 3: " — how bash starts its own error lines. */
export function shellPrefix(ctx: Ctx): string {
  if (ctx.script) return `${ctx.script}: line ${ctx.line}: `;
  // bash -c '…' says "bash: line 1: "; the learner's own shell says "-bash: ".
  return ctx.arg0 !== '-bash' && !ctx.interactive ? `${ctx.arg0}: line ${ctx.line}: ` : '-bash: ';
}

export function errText(e: Errno): string {
  return ERRNO_TEXT[e];
}

/**
 * The umask a login gives on Debian 13: pam_umask with USERGROUPS_ENAB yes turns 022 into 002 for a
 * user whose main group has the user's own name (you, www-data, new users); root keeps 022.
 */
export function loginUmask(st: LinuxState, user: string): number {
  const u = st.users.find((x) => x.name === user);
  if (!u || u.uid === 0) return 0o022;
  return st.groups.find((g) => g.gid === u.gid)?.name === user ? 0o002 : 0o022;
}

/** The shell's umask: what `umask` set, else the login's. */
export function umaskOf(ctx: Ctx): number {
  return ctx.sh.vars.__UMASK !== undefined ? parseInt(ctx.sh.vars.__UMASK, 8) : loginUmask(ctx.st, ctx.sh.user);
}

export function home(ctx: Ctx): string {
  return ctx.sh.vars.HOME ?? '/';
}

export function abs(ctx: Ctx, p: string): string {
  return absPath(ctx.sh.cwd, p);
}

export function setExplain(ctx: Ctx, key: string, params?: Record<string, string | number>) {
  ctx.explain = params ? { key, params } : { key };
}

/** Split short flags: ["-la", "x"] → flags {l, a}; long flags kept; "--" ends options. */
export interface Parsed {
  flags: Set<string>;
  values: Record<string, string>;
  args: string[];
  bad?: string;
  badLong?: string;
}

/**
 * Parse GNU-style options. `withValue` lists short/long options that take a value (e.g. ['n', 'name']).
 * Unknown short options set `bad` (the letter); unknown long ones set `badLong`.
 */
export function parseOpts(argv: string[], known: string, longs: string[] = [], withValue: string[] = []): Parsed {
  const flags = new Set<string>();
  const values: Record<string, string> = {};
  const args: string[] = [];
  let bad: string | undefined;
  let badLong: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--') {
      args.push(...argv.slice(i + 1));
      break;
    }
    if (a.startsWith('--') && a.length > 2) {
      const [name, val] = a.slice(2).split(/=(.*)/s) as [string, string | undefined];
      if (!longs.includes(name)) {
        badLong ??= a;
        continue;
      }
      if (withValue.includes(name)) values[name] = val ?? argv[++i] ?? '';
      else flags.add(name);
      continue;
    }
    if (a.startsWith('-') && a.length > 1 && !/^-\d+$/.test(a)) {
      for (let j = 1; j < a.length; j++) {
        const c = a[j]!;
        if (withValue.includes(c)) {
          values[c] = a.slice(j + 1) || argv[++i] || '';
          break;
        }
        if (!known.includes(c)) {
          bad ??= c;
          continue;
        }
        flags.add(c);
      }
      continue;
    }
    args.push(a);
  }
  const res: Parsed = { flags, values, args };
  if (bad) res.bad = bad;
  if (badLong) res.badLong = badLong;
  return res;
}

/** GNU tools' "invalid option" pair of lines. Returns exit code 2 (ls) or 1 (most others). */
export function badOption(io: IO, prog: string, p: Parsed, code = 1): number {
  if (p.bad) io.err(`${prog}: invalid option -- '${p.bad}'\n`);
  else if (p.badLong) io.err(`${prog}: unrecognized option '${p.badLong}'\n`);
  io.err(`Try '${prog} --help' for more information.\n`);
  return code;
}

/** `'name'` quoting as GNU coreutils prints file names in messages (shell-escape style). */
export function q(name: string): string {
  if (/^[\w./@%+,:=-]+$/.test(name) && name !== '') return `'${name}'`;
  if (!name.includes("'")) return `'${name}'`;
  return `"${name}"`;
}
