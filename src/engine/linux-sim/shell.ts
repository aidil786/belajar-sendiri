// The bash interpreter: runs parsed lists with redirections, pipes, && || ;, background jobs,
// variables, functions and the shell builtins. Programs live in programs/*.ts.
import type { Color } from '../git-sim/types';
import { errText, parseOpts, setExplain, shellPrefix, umaskOf, type Ctx, type IO, type ShellOpts } from './ctx';
import { ExpandError, expandString, expandWord, globToRegex, type ExpandEnv } from './expand';
import { absPath, baseName, can, lookup, lookupParent, parentOf, userByName, type Errno } from './fs';
import { parseScript, ParseError, type AndOr, type Cmd, type List, type Pipeline, type Redir } from './parse';
import { PROGRAMS } from './programs';
import { bashKillList, jobLine, procOf, signalProc, spawn, stopProc, SIGNALS, signalNumber } from './procs';
import type { LinuxState, Shell } from './types';

/** Max loop iterations + commands a single command line may run (endless loops become a process). */
export const STEP_BUDGET = 2000;

export function shellOf(st: LinuxState): Shell {
  return st.shells[st.shells.length - 1]!;
}

export function newCtx(st: LinuxState, sh: Shell, interactive: boolean): Ctx {
  const ctx: Ctx = {
    st,
    sh,
    positional: [],
    arg0: '-bash',
    opts: sh.vars.__SETOPTS ? (JSON.parse(sh.vars.__SETOPTS) as ShellOpts) : { errexit: false, nounset: false, pipefail: false, xtrace: false },
    script: null,
    line: 1,
    interactive,
    events: [],
    danger: false,
    budget: { steps: STEP_BUDGET },
    flow: {},
    traps: {},
    pid: shellPid(st),
    curPid: 0,
    bg: false,
    exec: (argv, io, asUser, programOnly) => runArgv(ctx, argv, io, asUser, programOnly),
    runSource: (src, io, o) => runSource(ctx, src, io, o),
  };
  return ctx;
}

/** PID of the learner's current shell process. */
export function shellPid(st: LinuxState): number {
  const shells = Object.values(st.procs).filter((p) => p.kind === 'shell');
  return shells.length ? shells[shells.length - 1]!.pid : 1;
}

// ---------------------------------------------------------------------------
// Expansion environment

export function expandEnv(ctx: Ctx, onErr?: (m: string) => void): ExpandEnv {
  return {
    st: ctx.st,
    user: ctx.sh.user,
    cwd: ctx.sh.cwd,
    get: (n) => {
      if (n === 'RANDOM') return String((ctx.st.clock * 7919) % 32768);
      if (n === 'UID') return String(userByName(ctx.st, ctx.sh.user)?.uid ?? 0);
      if (n === 'LINENO') return String(ctx.line);
      return ctx.sh.vars[n];
    },
    set: (n, v) => {
      ctx.sh.vars[n] = v;
    },
    positional: ctx.positional,
    arg0: ctx.arg0,
    lastExit: ctx.st.lastExit,
    pid: ctx.pid,
    ...(ctx.lastBg !== undefined ? { lastBg: ctx.lastBg } : {}),
    nounset: ctx.opts.nounset,
    subst: (src) => {
      let buf = '';
      const child = subshell(ctx);
      const io: IO = { stdin: null, out: (t) => (buf += t), err: termErr(ctx), tty: false };
      runIn(child, src, io);
      ctx.st.lastExit = child.st.lastExit;
      return buf;
    },
    onError: onErr ?? ((m) => termErr(ctx)(`${shellPrefix(ctx)}${m}\n`)),
  };
}

/** Where stderr goes when nothing redirects it: the terminal sink of this run. */
let currentTerm: { out: (t: string, c?: Color) => void } | null = null;
export function setTerminal(out: ((t: string, c?: Color) => void) | null) {
  currentTerm = out ? { out } : null;
}
function termErr(_ctx: Ctx) {
  return (t: string) => currentTerm?.out(t);
}

/** A copy of the shell for $( … ) and ( … ): variables are copied, the machine is shared. */
export function subshell(ctx: Ctx): Ctx {
  const sh: Shell = { ...ctx.sh, vars: { ...ctx.sh.vars }, exported: [...ctx.sh.exported] };
  const child = newCtx(ctx.st, sh, false);
  child.positional = ctx.positional;
  child.arg0 = ctx.arg0;
  child.opts = { ...ctx.opts };
  child.script = ctx.script;
  child.line = ctx.line;
  child.budget = ctx.budget;
  child.events = ctx.events;
  child.pid = ctx.pid;
  child.traps = { ...ctx.traps };
  child.bg = ctx.bg;
  return child;
}

// ---------------------------------------------------------------------------
// Running source

export function runIn(ctx: Ctx, src: string, io: IO): number {
  let list: List;
  try {
    list = parseScript(src);
  } catch (e) {
    if (e instanceof ParseError) {
      io.err(`${shellPrefix(ctx)}${e.message}\n`);
      ctx.st.lastExit = 2;
      return 2;
    }
    throw e;
  }
  const code = execList(ctx, list, io);
  ctx.st.lastExit = code;
  return code;
}

/** bash script.sh / bash -c: a new (non-interactive) shell. */
export function runSource(parent: Ctx, src: string, io: IO, o: { arg0: string; args: string[]; user?: string; script?: string | null }): number {
  const user = o.user ?? parent.sh.user;
  const sh: Shell = {
    user,
    cwd: parent.sh.cwd,
    vars: Object.fromEntries(parent.sh.exported.filter((k) => parent.sh.vars[k] !== undefined).map((k) => [k, parent.sh.vars[k]!])),
    exported: [...parent.sh.exported],
    login: false,
  };
  sh.vars.PWD = sh.cwd;
  // A child shell keeps its parent's umask (another user's login gets their own).
  if (user === parent.sh.user && parent.sh.vars.__UMASK !== undefined) sh.vars.__UMASK = parent.sh.vars.__UMASK;
  const ctx = newCtx(parent.st, sh, false);
  ctx.positional = o.args;
  ctx.arg0 = o.arg0;
  ctx.script = o.script ?? null;
  ctx.budget = parent.budget;
  ctx.events = parent.events;
  ctx.bg = parent.bg;
  ctx.pid = parent.curPid || parent.st.nextPid++;
  ctx.curPid = ctx.pid;
  let list: List;
  try {
    list = parseScript(src);
  } catch (e) {
    if (e instanceof ParseError) {
      const lines = src.split('\n').length;
      io.err(`${o.script ? `${o.script}: line ${e.eof ? lines + 1 : lines}: ` : `${o.arg0}: -c: line 1: `}${e.message}\n`);
      return 2;
    }
    throw e;
  }
  let code = execList(ctx, list, io);
  if (ctx.flow.exit !== undefined) code = ctx.flow.exit;
  if (ctx.traps.EXIT) {
    const t = { ...ctx.flow };
    ctx.flow = {};
    runIn(ctx, ctx.traps.EXIT, io);
    ctx.flow = t;
  }
  parent.forever = parent.forever || ctx.forever;
  if (ctx.forever) parent.explain = ctx.explain;
  else if (ctx.explain) parent.explain = ctx.explain;
  return code;
}

function execList(ctx: Ctx, list: List, io: IO): number {
  let code = ctx.st.lastExit;
  for (const item of list.items) {
    if (ctx.flow.exit !== undefined || ctx.flow.ret !== undefined || ctx.flow.brk || ctx.flow.cont || ctx.forever) break;
    if (item.bg) code = execBackground(ctx, item, io);
    else code = execAndOr(ctx, item, io);
    ctx.st.lastExit = code;
    if (ctx.opts.errexit && code !== 0 && !ctx.interactive && ctx.flow.exit === undefined && !ctx.forever) {
      ctx.flow.exit = code;
      break;
    }
  }
  return code;
}

function execAndOr(ctx: Ctx, ao: AndOr, io: IO): number {
  let code = execPipeline(ctx, ao.first, io, ao.rest.length > 0);
  for (const r of ao.rest) {
    if (ctx.flow.exit !== undefined || ctx.forever) break;
    ctx.st.lastExit = code;
    if ((r.op === '&&' && code === 0) || (r.op === '||' && code !== 0)) code = execPipeline(ctx, r.p, io, true);
  }
  return code;
}

/** `cmd &`: long programs become a job; short ones run now and report Done at the next prompt. */
function execBackground(ctx: Ctx, ao: AndOr, io: IO): number {
  const jobId = nextJobId(ctx.st);
  const pid = ctx.st.nextPid;
  // bash announces the job before it runs.
  if (ctx.interactive) io.err(`[${jobId}] ${pid}\n`);
  const saved = ctx.bg;
  ctx.bg = true;
  let code: number;
  try {
    code = execAndOr(ctx, ao, io);
  } finally {
    ctx.bg = saved;
  }
  const long = ctx.st.procs[pid];
  if (long && long.kind !== 'shell') {
    long.job = jobId;
    ctx.st.jobs.push({ id: jobId, pid, cmd: ao.text.endsWith('&') ? ao.text : `${ao.text} &`, state: 'Running' });
  } else if (ctx.interactive) {
    ctx.st.jobs.push({ id: jobId, pid, cmd: ao.text, state: 'Done', notify: true, ...(code !== 0 ? { exit: code } : {}) });
  }
  ctx.lastBg = pid;
  if (ctx.interactive) setExplain(ctx, long ? 'linux.explain.background' : 'linux.explain.backgroundDone', { n: jobId, pid });
  return 0;
}

function nextJobId(st: LinuxState): number {
  const used = st.jobs.map((j) => j.id);
  return used.length ? Math.max(...used) + 1 : 1;
}

function execPipeline(ctx: Ctx, p: Pipeline, io: IO, _inList: boolean): number {
  let code: number;
  if (p.cmds.length === 1) code = execCmd(ctx, p.cmds[0]!, io);
  else {
    let input: string | null = io.stdin;
    const codes: number[] = [];
    p.cmds.forEach((c, i) => {
      const last = i === p.cmds.length - 1;
      let buf = '';
      const stageIo: IO = last ? { ...io, stdin: input } : { stdin: input, out: (t) => (buf += t), err: io.err, tty: false };
      // Each stage runs in its own subshell (variables set there don't stay).
      const child = subshell(ctx);
      child.interactive = false;
      codes.push(execCmd(child, c, stageIo));
      if (child.explain) ctx.explain = child.explain;
      if (child.flow.exit !== undefined && last) codes[codes.length - 1] = child.flow.exit;
      input = buf;
    });
    code = codes[codes.length - 1]!;
    if (ctx.opts.pipefail) for (let i = codes.length - 1; i >= 0; i--) if (codes[i] !== 0) {
      code = codes[i]!;
      break;
    }
    if (ctx.interactive) setExplain(ctx, 'linux.explain.pipe', { n: p.cmds.length });
  }
  if (p.bang) code = code === 0 ? 1 : 0;
  return code;
}

function step(ctx: Ctx): boolean {
  ctx.budget.steps--;
  if (ctx.budget.steps <= 0) {
    ctx.forever = true;
    return false;
  }
  return true;
}

function execCmd(ctx: Ctx, cmd: Cmd, io: IO): number {
  if (!step(ctx)) return 0;
  ctx.line = cmd.line;
  if (cmd.k === 'simple') return execSimple(ctx, cmd, io);
  if (cmd.k === 'func') {
    ctx.st.functions[cmd.name] = cmd.source;
    return 0;
  }
  const rio = applyRedirs(ctx, cmd.redirs, io);
  if (!rio) return 1;
  try {
    switch (cmd.k) {
      case 'group': {
        if (cmd.subshell) {
          const child = subshell(ctx);
          const code = execList(child, cmd.body, rio.io);
          return child.flow.exit ?? code;
        }
        return execList(ctx, cmd.body, rio.io);
      }
      case 'if': {
        for (const c of cmd.clauses) {
          const saveE = ctx.opts.errexit;
          ctx.opts.errexit = false;
          const cond = execList(ctx, c.cond, rio.io);
          ctx.opts.errexit = saveE;
          if (stopFlow(ctx)) return cond;
          if (cond === 0) return execList(ctx, c.body, rio.io);
        }
        if (cmd.orElse) return execList(ctx, cmd.orElse, rio.io);
        return 0;
      }
      case 'for': {
        const env = expandEnv(ctx);
        let items: string[];
        try {
          items = cmd.words === null ? [...ctx.positional] : cmd.words.flatMap((w) => expandWord(w, env));
        } catch (e) {
          if (e instanceof ExpandError) return 1;
          throw e;
        }
        let code = 0;
        for (const it of items) {
          if (!step(ctx)) break;
          ctx.sh.vars[cmd.name] = it;
          code = execList(ctx, cmd.body, rio.io);
          if (ctx.flow.brk) {
            ctx.flow.brk--;
            break;
          }
          if (ctx.flow.cont) {
            ctx.flow.cont--;
            if (ctx.flow.cont) break;
          }
          if (stopFlow(ctx)) break;
        }
        return code;
      }
      case 'while': {
        let code = 0;
        for (;;) {
          if (!step(ctx)) break;
          const saveE = ctx.opts.errexit;
          ctx.opts.errexit = false;
          const c = execList(ctx, cmd.cond, rio.io);
          ctx.opts.errexit = saveE;
          if (stopFlow(ctx)) break;
          if ((c === 0) === cmd.until) break;
          code = execList(ctx, cmd.body, rio.io);
          if (ctx.flow.brk) {
            ctx.flow.brk--;
            break;
          }
          if (ctx.flow.cont) {
            ctx.flow.cont--;
            if (ctx.flow.cont) break;
            continue;
          }
          if (stopFlow(ctx)) break;
        }
        return code;
      }
      case 'case': {
        const env = expandEnv(ctx);
        const w = expandString(cmd.word, env);
        for (const it of cmd.items) {
          const hit = it.patterns.some((p) => globToRegex(patternOf(p, env)).test(w));
          if (hit) return execList(ctx, it.body, rio.io);
        }
        return 0;
      }
    }
  } finally {
    rio.done();
  }
}

/** A case pattern: quoted parts are literal. */
function patternOf(raw: string, env: ExpandEnv): string {
  if (/^['"].*['"]$/.test(raw)) return expandString(raw, env).replace(/[*?[\\]/g, '\\$&');
  return raw.replace(/\$\{?\w+\}?/g, (m) => expandString(m, env));
}

function stopFlow(ctx: Ctx): boolean {
  return ctx.flow.exit !== undefined || ctx.flow.ret !== undefined || !!ctx.flow.brk || !!ctx.flow.cont || !!ctx.forever;
}

// ---------------------------------------------------------------------------
// Redirections

interface Redirected {
  io: IO;
  done: () => void;
}

function writeTarget(ctx: Ctx, target: string, append: boolean): { ok: true; write: (t: string) => void } | { ok: false; err: Errno } {
  if (target === '/dev/null') return { ok: true, write: () => undefined };
  if (target === '/dev/stdout' || target === '/dev/stderr') return { ok: true, write: (t) => currentTerm?.out(t) };
  const path = absPath(ctx.sh.cwd, target);
  const found = lookup(ctx.st, ctx.sh.user, path);
  let real: string;
  if (found.ok) {
    if (found.node.type === 'dir') return { ok: false, err: 'EISDIR' };
    if (!can(ctx.st, ctx.sh.user, found.node, 'w')) return { ok: false, err: 'EACCES' };
    real = found.path;
    if (!append) {
      found.node.content = '';
      found.node.mtime = ctx.st.clock;
    }
  } else {
    if (found.err !== 'ENOENT') return { ok: false, err: found.err };
    const par = lookupParent(ctx.st, ctx.sh.user, path);
    if (!par.ok) return { ok: false, err: par.err };
    if (!can(ctx.st, ctx.sh.user, par.node, 'w')) return { ok: false, err: 'EACCES' };
    const u = userByName(ctx.st, ctx.sh.user)!;
    real = par.dir === '/' ? `/${par.name}` : `${par.dir}/${par.name}`;
    // bash opens a new file with 0666, minus the umask.
    ctx.st.fs[real] = { type: 'file', mode: 0o666 & ~umaskOf(ctx), uid: u.uid, gid: u.gid, mtime: ctx.st.clock, content: '' };
  }
  ctx.events.push({ type: 'fileWritten', path: real });
  return {
    ok: true,
    write: (t) => {
      const n = ctx.st.fs[real];
      if (n && n.type === 'file') {
        n.content = (n.content ?? '') + t;
        n.mtime = ctx.st.clock;
      }
    },
  };
}

export { umaskOf };

function applyRedirs(ctx: Ctx, redirs: Redir[], io: IO): Redirected | null {
  if (!redirs.length) return { io, done: () => undefined };
  const env = expandEnv(ctx);
  const res: IO = { ...io };
  for (const r of redirs) {
    if (r.op === '<<' || r.op === '<<<') {
      res.stdin = r.op === '<<<' ? `${expandString(r.target, env)}\n` : r.quoted ? (r.heredoc ?? '') : expandString(`"${(r.heredoc ?? '').replace(/(["\\])/g, '\\$1')}"`, env);
      continue;
    }
    if (r.op === '>&') {
      if (r.target === '1' && r.fd === 2) res.err = res.out;
      else if (r.target === '2' && r.fd === 1) res.out = res.err;
      continue;
    }
    let target: string;
    try {
      const words = expandWord(r.target, env);
      if (words.length !== 1) {
        io.err(`${shellPrefix(ctx)}${r.target}: ambiguous redirect\n`);
        return null;
      }
      target = words[0]!;
    } catch (e) {
      if (e instanceof ExpandError) return null;
      throw e;
    }
    if (r.op === '<' && target === '/dev/null') {
      // Reading /dev/null: nothing, then end of input.
      res.stdin = '';
      continue;
    }
    if (r.op === '<') {
      const f = lookup(ctx.st, ctx.sh.user, absPath(ctx.sh.cwd, target));
      if (!f.ok) {
        io.err(`${shellPrefix(ctx)}${target}: ${errText(f.err)}\n`);
        return null;
      }
      if (f.node.type === 'dir') {
        io.err(`${shellPrefix(ctx)}${target}: Is a directory\n`);
        return null;
      }
      if (!can(ctx.st, ctx.sh.user, f.node, 'r')) {
        io.err(`${shellPrefix(ctx)}${target}: Permission denied\n`);
        return null;
      }
      res.stdin = f.node.content ?? '';
      continue;
    }
    const w = writeTarget(ctx, target, r.op === '>>' || r.op === '&>>');
    if (!w.ok) {
      io.err(`${shellPrefix(ctx)}${target}: ${errText(w.err)}\n`);
      return null;
    }
    if (r.op === '&>' || r.op === '&>>') {
      res.out = w.write;
      res.err = w.write;
      res.tty = false;
    } else if (r.fd === 2) res.err = w.write;
    else {
      res.out = w.write;
      res.tty = false;
    }
  }
  return { io: res, done: () => undefined };
}

// ---------------------------------------------------------------------------
// Simple commands

function execSimple(ctx: Ctx, cmd: Cmd & { k: 'simple' }, io: IO): number {
  const env = expandEnv(ctx);
  let argv: string[];
  const assigns: [string, string][] = [];
  try {
    let words = cmd.words;
    // Aliases (typed commands only).
    if (ctx.interactive && words.length && ctx.st.aliases[words[0]!]) words = [...splitAlias(ctx.st.aliases[words[0]!]!), ...words.slice(1)];
    argv = words.flatMap((w) => expandWord(w, env));
    for (const [n, v] of cmd.assigns) assigns.push([n, expandString(v, env)]);
  } catch (e) {
    if (e instanceof ExpandError) {
      // set -u: a non-interactive bash leaves at once with status 127.
      if (!ctx.interactive && ctx.opts.nounset) {
        ctx.flow.exit = 127;
        return 127;
      }
      // At the prompt, an expansion error drops the rest of the line.
      if (ctx.interactive) ctx.flow.exit = 1;
      return 1;
    }
    throw e;
  }
  if (ctx.opts.xtrace && argv.length) io.err(`+ ${argv.join(' ')}\n`);
  if (!argv.length) {
    for (const [n, v] of assigns) ctx.sh.vars[n] = v;
    const rio = applyRedirs(ctx, cmd.redirs, io);
    if (!rio) return 1;
    if (ctx.interactive && assigns.length) setExplain(ctx, 'linux.explain.assign', { name: assigns[0]![0] });
    return ctx.st.lastExit && cmd.words.length ? ctx.st.lastExit : 0;
  }
  const rio = applyRedirs(ctx, cmd.redirs, io);
  if (!rio) return 1;
  // VAR=value cmd: only for that command.
  const saved: [string, string | undefined, boolean][] = assigns.map(([n]) => [n, ctx.sh.vars[n], ctx.sh.exported.includes(n)]);
  for (const [n, v] of assigns) {
    ctx.sh.vars[n] = v;
    if (!ctx.sh.exported.includes(n)) ctx.sh.exported.push(n);
  }
  try {
    return runArgv(ctx, argv, rio.io);
  } finally {
    for (const [n, v, ex] of saved) {
      if (v === undefined) delete ctx.sh.vars[n];
      else ctx.sh.vars[n] = v;
      if (!ex) ctx.sh.exported = ctx.sh.exported.filter((x) => x !== n);
    }
    rio.done();
  }
}

function splitAlias(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

/** Find a command on PATH (or a path with a slash). */
export function findCommand(ctx: Ctx, name: string): { path: string } | { err: Errno | 'notFound' } {
  if (name.includes('/')) {
    const f = lookup(ctx.st, ctx.sh.user, absPath(ctx.sh.cwd, name));
    if (!f.ok) return { err: f.err };
    if (f.node.type === 'dir') return { err: 'EISDIR' };
    if (!can(ctx.st, ctx.sh.user, f.node, 'x')) return { err: 'EACCES' };
    return { path: f.path };
  }
  for (const dir of (ctx.sh.vars.PATH ?? '').split(':')) {
    if (!dir) continue;
    const f = lookup(ctx.st, ctx.sh.user, `${dir}/${name}`);
    if (f.ok && f.node.type === 'file' && can(ctx.st, ctx.sh.user, f.node, 'x')) return { path: `${dir}/${name}` };
  }
  return { err: 'notFound' };
}

/** Which program a file is: a built-in binary (by its real name) or a script. */
export function programOf(ctx: Ctx, path: string): string | null {
  const f = lookup(ctx.st, ctx.sh.user, path);
  if (!f.ok) return null;
  if (f.node.content === undefined && f.node.size !== undefined) return baseName(f.path);
  return null;
}

/** Run argv: functions, builtins, then programs on PATH. */
export function runArgv(ctx: Ctx, argv: string[], io: IO, asUser?: string, programOnly = false): number {
  if (asUser && asUser !== ctx.sh.user) return runAs(ctx, asUser, () => runArgv(ctx, argv, io, undefined, programOnly));
  const name = argv[0]!;
  if (!programOnly && ctx.st.functions[name] !== undefined) return runFunction(ctx, name, argv.slice(1), io);
  const b = programOnly ? undefined : BUILTINS[name];
  if (b) return b(ctx, argv, io);
  const found = findCommand(ctx, name);
  if ('err' in found) {
    if (found.err === 'notFound') {
      io.err(`${shellPrefix(ctx)}${name}: command not found\n`);
      setExplain(ctx, 'linux.err.notFound', { name });
      ctx.events.push({ type: 'error', code: 'notFound' });
      return 127;
    }
    io.err(`${shellPrefix(ctx)}${name}: ${errText(found.err)}\n`);
    setExplain(ctx, found.err === 'EACCES' ? 'linux.err.noExec' : found.err === 'EISDIR' ? 'linux.err.isDirRun' : 'linux.err.noFile', { name });
    return found.err === 'ENOENT' ? 127 : 126;
  }
  const prog = programOf(ctx, found.path);
  ctx.curPid = ctx.st.nextPid++;
  if (prog) {
    const impl = PROGRAMS[prog];
    if (!impl) {
      io.err(`${shellPrefix(ctx)}${name}: command not found\n`);
      return 127;
    }
    return impl(ctx, argv, io);
  }
  // A text file: a script. The shebang picks the interpreter; bash runs it otherwise.
  const f = lookup(ctx.st, ctx.sh.user, found.path);
  if (!f.ok) return 127;
  if (!can(ctx.st, ctx.sh.user, f.node, 'r')) {
    io.err(`/usr/bin/bash: ${name}: Permission denied\n`);
    return 126;
  }
  return runScriptText(ctx, f.node.content ?? '', name, argv.slice(1), io);
}

export function runScriptText(ctx: Ctx, text: string, shown: string, args: string[], io: IO): number {
  const first = text.split('\n')[0] ?? '';
  const interp = /^#!\s*(\S+)(?:\s+(\S+))?/.exec(first);
  if (interp) {
    const prog = interp[1] === '/usr/bin/env' ? interp[2] : baseName(interp[1]!);
    if (prog && !['bash', 'sh', 'dash'].includes(prog)) {
      io.err(`${shellPrefix(ctx)}${shown}: ${interp[1]}: bad interpreter: No such file or directory\n`);
      return 126;
    }
  }
  const code = ctx.runSource(text, io, { arg0: shown, args, script: shown });
  ctx.st.scriptExits[absPath(ctx.sh.cwd, shown)] = code;
  if (ctx.forever) return becomeProcess(ctx, interp ? `/bin/bash ${shown}` : `bash ${shown}`, 'script', io) ?? code;
  setExplain(ctx, code === 0 ? 'linux.explain.scriptOk' : 'linux.explain.scriptFail', { name: shown, code });
  return code;
}

/** A script that never ends: it becomes a running process (foreground or background). */
export function becomeProcess(ctx: Ctx, args: string, kind: 'script' | 'other', _io: IO): number | null {
  ctx.forever = false;
  const comm = args.startsWith('/bin/bash ') || args.startsWith('bash ') ? 'bash' : baseName(args.split(' ')[0]!);
  const pid = spawn(ctx, { pid: ctx.curPid, args, comm, kind, state: 'R' });
  if (!ctx.bg && ctx.interactive) ctx.st.fg = { pid, cmd: args };
  setExplain(ctx, ctx.bg ? 'linux.explain.background' : 'linux.explain.foreground', { pid, n: 1 });
  return 0;
}

function runFunction(ctx: Ctx, name: string, args: string[], io: IO): number {
  const savedPos = ctx.positional;
  ctx.positional = args;
  try {
    const code = runIn(ctx, ctx.st.functions[name]!, io);
    if (ctx.flow.ret !== undefined) {
      const r = ctx.flow.ret;
      delete ctx.flow.ret;
      return r;
    }
    return code;
  } finally {
    ctx.positional = savedPos;
  }
}

/** Run something as another user (sudo, su -c): a temporary shell on top. */
export function runAs<T>(ctx: Ctx, user: string, fn: () => T): T {
  const saved = ctx.sh;
  const u = userByName(ctx.st, user)!;
  const sh: Shell = { ...saved, user, vars: { ...saved.vars }, exported: [...saved.exported] };
  sh.vars.USER = user;
  sh.vars.LOGNAME = user;
  sh.vars.HOME = u.home;
  if (u.uid === 0) sh.vars.PATH = SECURE_PATH;
  delete sh.vars.__UMASK;
  ctx.sh = sh;
  try {
    return fn();
  } finally {
    ctx.sh = saved;
  }
}

export const SECURE_PATH = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';
export const USER_PATH = '/usr/local/bin:/usr/bin:/bin:/usr/local/games:/usr/games';

// ---------------------------------------------------------------------------
// Builtins

type Builtin = (ctx: Ctx, argv: string[], io: IO) => number;

function cdTo(ctx: Ctx, target: string, io: IO): number {
  const path = absPath(ctx.sh.cwd, target);
  const f = lookup(ctx.st, ctx.sh.user, path);
  if (!f.ok || f.node.type !== 'dir' || !can(ctx.st, ctx.sh.user, f.node, 'x')) {
    const e: Errno = !f.ok ? f.err : f.node.type !== 'dir' ? 'ENOTDIR' : 'EACCES';
    io.err(`${shellPrefix(ctx)}cd: ${target}: ${errText(e)}\n`);
    setExplain(ctx, e === 'EACCES' ? 'linux.err.cdDenied' : e === 'ENOTDIR' ? 'linux.err.cdNotDir' : 'linux.err.cdMissing', { path: target });
    return 1;
  }
  ctx.sh.vars.OLDPWD = ctx.sh.cwd;
  // bash keeps the logical path (through symlinks).
  ctx.sh.cwd = path;
  ctx.sh.vars.PWD = path;
  ctx.events.push({ type: 'cwd', path });
  setExplain(ctx, 'linux.explain.cd', { path });
  return 0;
}

function echoText(args: string[], escapes: boolean): string {
  const s = args.join(' ');
  if (!escapes) return s;
  return s.replace(/\\(n|t|\\|e|a|c|0[0-7]{0,3})/g, (_m, c: string) => (c === 'n' ? '\n' : c === 't' ? '\t' : c === '\\' ? '\\' : c === 'e' ? '\x1b' : c === 'c' ? '\u0000' : c === 'a' ? '\x07' : String.fromCharCode(parseInt(c.slice(1) || '0', 8))));
}

export function printfFormat(fmt: string, args: string[]): string {
  let out = '';
  let ai = 0;
  const esc = (s: string) => s.replace(/\\(n|t|\\|"|'|0[0-7]{0,3})/g, (_m, c: string) => (c === 'n' ? '\n' : c === 't' ? '\t' : c === '\\' ? '\\' : c === '"' ? '"' : c === "'" ? "'" : String.fromCharCode(parseInt(c.slice(1) || '0', 8))));
  do {
    out += esc(fmt).replace(/%([-0 +#]*)(\d+)?(?:\.(\d+))?([sdifxXoc%b])/g, (_m, flags: string, width?: string, prec?: string, conv?: string) => {
      if (conv === '%') return '%';
      const a = args[ai++] ?? '';
      let s: string;
      if (conv === 's' || conv === 'b') s = prec !== undefined ? a.slice(0, Number(prec)) : conv === 'b' ? esc(a) : a;
      else if (conv === 'c') s = a.slice(0, 1);
      else if (conv === 'f') s = (Number(a) || 0).toFixed(prec !== undefined ? Number(prec) : 6);
      else if (conv === 'x' || conv === 'X' || conv === 'o') {
        s = Math.trunc(Number(a) || 0).toString(conv === 'o' ? 8 : 16);
        if (conv === 'X') s = s.toUpperCase();
      } else s = String(Math.trunc(Number(a) || 0));
      const w = Number(width ?? 0);
      if (s.length < w) {
        if (flags.includes('-')) s = s.padEnd(w);
        else if (flags.includes('0') && conv !== 's') s = s.startsWith('-') ? `-${s.slice(1).padStart(w - 1, '0')}` : s.padStart(w, '0');
        else s = s.padStart(w);
      }
      return s;
    });
  } while (ai > 0 && ai < args.length);
  return out;
}

export function testExpr(ctx: Ctx, args: string[], io: IO, name: string): number {
  const fileTest = (op: string, p: string): boolean => {
    const path = absPath(ctx.sh.cwd, p);
    const f = lookup(ctx.st, ctx.sh.user, path, op !== '-L' && op !== '-h');
    if (!f.ok) return false;
    switch (op) {
      case '-e':
        return true;
      case '-f':
        return f.node.type === 'file';
      case '-d':
        return f.node.type === 'dir';
      case '-L':
      case '-h':
        return f.node.type === 'link';
      case '-s':
        return f.node.type === 'dir' || (f.node.content ?? '').length > 0 || (f.node.size ?? 0) > 0;
      case '-r':
        return can(ctx.st, ctx.sh.user, f.node, 'r');
      case '-w':
        return can(ctx.st, ctx.sh.user, f.node, 'w');
      case '-x':
        return can(ctx.st, ctx.sh.user, f.node, 'x');
    }
    return false;
  };
  const num = (s: string): number | null => (/^\s*-?\d+\s*$/.test(s) ? Number(s) : null);
  let i = 0;
  const err = (m: string) => {
    io.err(`${shellPrefix(ctx)}${name}: ${m}\n`);
    throw new TestError();
  };
  const primary = (): boolean => {
    const a = args[i];
    if (a === '!') {
      i++;
      return !primary();
    }
    if (a === '(') {
      i++;
      const v = orExpr();
      i++;
      return v;
    }
    if (a !== undefined && /^-[efdLhsrwxzn]$/.test(a) && args[i + 1] !== undefined && !['=', '!=', '==', '-eq', '-ne', '-lt', '-le', '-gt', '-ge'].includes(args[i + 1]!)) {
      i += 2;
      const v = args[i - 1]!;
      if (a === '-z') return v === '';
      if (a === '-n') return v !== '';
      return fileTest(a, v);
    }
    const b = args[i + 1];
    if (b !== undefined && ['=', '==', '!=', '-eq', '-ne', '-lt', '-le', '-gt', '-ge', '<', '>'].includes(b)) {
      const c = args[i + 2] ?? '';
      i += 3;
      if (b === '=' || b === '==') return name === '[[' ? globToRegex(c).test(a ?? '') : a === c;
      if (b === '!=') return name === '[[' ? !globToRegex(c).test(a ?? '') : a !== c;
      if (b === '<') return (a ?? '') < c;
      if (b === '>') return (a ?? '') > c;
      const x = num(a ?? '');
      const y = num(c);
      if (x === null) err(`${a}: integer expression expected`);
      if (y === null) err(`${c}: integer expression expected`);
      return b === '-eq' ? x === y : b === '-ne' ? x !== y : b === '-lt' ? x! < y! : b === '-le' ? x! <= y! : b === '-gt' ? x! > y! : x! >= y!;
    }
    i++;
    return (a ?? '') !== '';
  };
  const andExpr = (): boolean => {
    let v = primary();
    while (args[i] === '-a' || args[i] === '&&') {
      i++;
      const w = primary();
      v = v && w;
    }
    return v;
  };
  const orExpr = (): boolean => {
    let v = andExpr();
    while (args[i] === '-o' || args[i] === '||') {
      i++;
      const w = andExpr();
      v = v || w;
    }
    return v;
  };
  try {
    if (!args.length) return 1;
    const v = orExpr();
    if (i < args.length) err(`too many arguments`);
    return v ? 0 : 1;
  } catch (e) {
    if (e instanceof TestError) return 2;
    throw e;
  }
}

class TestError extends Error {}

function typeOf(ctx: Ctx, name: string): string | null {
  if (ctx.st.aliases[name] && ctx.interactive) return `${name} is aliased to \`${ctx.st.aliases[name]}'`;
  if (['if', 'then', 'else', 'elif', 'fi', 'for', 'while', 'until', 'do', 'done', 'case', 'esac', 'in', '{', '}', '!', '[['].includes(name)) return `${name} is a shell keyword`;
  if (ctx.st.functions[name] !== undefined) return `${name} is a function`;
  if (BUILTINS[name]) return `${name} is a shell builtin`;
  const f = findCommand(ctx, name);
  if ('path' in f) return `${name} is ${f.path}`;
  return null;
}

export const BUILTINS: Record<string, Builtin> = {
  cd: (ctx, argv, io) => {
    const args = argv.slice(1).filter((a) => a !== '--');
    if (args.length > 1) {
      io.err(`${shellPrefix(ctx)}cd: too many arguments\n`);
      return 1;
    }
    let target = args[0] ?? ctx.sh.vars.HOME ?? '/';
    if (target === '-') {
      target = ctx.sh.vars.OLDPWD ?? '';
      if (!target) {
        io.err(`${shellPrefix(ctx)}cd: OLDPWD not set\n`);
        return 1;
      }
      const code = cdTo(ctx, target, io);
      if (code === 0) io.out(`${ctx.sh.cwd}\n`);
      return code;
    }
    return cdTo(ctx, target, io);
  },
  pwd: (ctx, _argv, io) => {
    io.out(`${ctx.sh.cwd}\n`);
    setExplain(ctx, 'linux.explain.pwd', { path: ctx.sh.cwd });
    return 0;
  },
  echo: (ctx, argv, io) => {
    let args = argv.slice(1);
    let newline = true;
    let escapes = false;
    while (args.length && /^-[neE]+$/.test(args[0]!)) {
      if (args[0]!.includes('n')) newline = false;
      if (args[0]!.includes('e')) escapes = true;
      if (args[0]!.includes('E')) escapes = false;
      args = args.slice(1);
    }
    const text = echoText(args, escapes);
    io.out(text + (newline ? '\n' : ''));
    setExplain(ctx, 'linux.explain.echo');
    return 0;
  },
  printf: (ctx, argv, io) => {
    if (argv.length < 2) {
      io.err(`${shellPrefix(ctx)}printf: usage: printf [-v var] format [arguments]\n`);
      return 2;
    }
    io.out(printfFormat(argv[1]!, argv.slice(2)));
    setExplain(ctx, 'linux.explain.printf');
    return 0;
  },
  true: () => 0,
  false: () => 1,
  ':': () => 0,
  test: (ctx, argv, io) => testExpr(ctx, argv.slice(1), io, 'test'),
  '[': (ctx, argv, io) => {
    if (argv[argv.length - 1] !== ']') {
      io.err(`${shellPrefix(ctx)}[: missing \`]'\n`);
      return 2;
    }
    return testExpr(ctx, argv.slice(1, -1), io, '[');
  },
  '[[': (ctx, argv, io) => {
    if (argv[argv.length - 1] !== ']]') {
      io.err(`${shellPrefix(ctx)}syntax error in conditional expression\n`);
      return 2;
    }
    return testExpr(ctx, argv.slice(1, -1), io, '[[');
  },
  export: (ctx, argv, io) => {
    const args = argv.slice(1).filter((a) => a !== '-n');
    if (!args.length || args[0] === '-p') {
      for (const k of [...ctx.sh.exported].sort()) if (ctx.sh.vars[k] !== undefined) io.out(`declare -x ${k}="${ctx.sh.vars[k]}"\n`);
      return 0;
    }
    let code = 0;
    for (const a of args) {
      const m = /^([A-Za-z_]\w*)(?:=([\s\S]*))?$/.exec(a);
      if (!m) {
        io.err(`${shellPrefix(ctx)}export: \`${a}': not a valid identifier\n`);
        code = 1;
        continue;
      }
      if (m[2] !== undefined) ctx.sh.vars[m[1]!] = m[2];
      if (!ctx.sh.exported.includes(m[1]!)) ctx.sh.exported.push(m[1]!);
      setExplain(ctx, 'linux.explain.export', { name: m[1]! });
    }
    return code;
  },
  unset: (ctx, argv) => {
    for (const a of argv.slice(1).filter((x) => !x.startsWith('-'))) {
      delete ctx.sh.vars[a];
      ctx.sh.exported = ctx.sh.exported.filter((x) => x !== a);
      delete ctx.st.functions[a];
      setExplain(ctx, 'linux.explain.unset', { name: a });
    }
    return 0;
  },
  readonly: (ctx, argv) => BUILTINS.export!(ctx, argv, { stdin: null, out: () => undefined, err: () => undefined, tty: false }) && 0,
  local: (ctx, argv) => {
    for (const a of argv.slice(1)) {
      const m = /^([A-Za-z_]\w*)(?:=([\s\S]*))?$/.exec(a);
      if (m) ctx.sh.vars[m[1]!] = m[2] ?? '';
    }
    return 0;
  },
  set: (ctx, argv, io) => {
    const args = argv.slice(1);
    if (!args.length) {
      for (const k of Object.keys(ctx.sh.vars).sort()) if (!k.startsWith('__')) io.out(`${k}=${ctx.sh.vars[k]}\n`);
      return 0;
    }
    for (let i = 0; i < args.length; i++) {
      const a = args[i]!;
      const on = a.startsWith('-');
      if (a === '--') {
        ctx.positional.splice(0, ctx.positional.length, ...args.slice(i + 1));
        break;
      }
      if (a === '-o' || a === '+o') {
        const name = args[++i];
        if (name === 'pipefail') ctx.opts.pipefail = on;
        else if (name === 'errexit') ctx.opts.errexit = on;
        else if (name === 'nounset') ctx.opts.nounset = on;
        else if (name === 'xtrace') ctx.opts.xtrace = on;
        else {
          io.err(`${shellPrefix(ctx)}set: ${name ?? ''}: invalid option name\n`);
          return 1;
        }
        continue;
      }
      if (!/^[-+][euxo]+$/.test(a)) {
        io.err(`${shellPrefix(ctx)}set: ${a.slice(0, 2)}: invalid option\n`);
        return 2;
      }
      for (const c of a.slice(1)) {
        const map: Record<string, keyof ShellOpts> = { e: 'errexit', u: 'nounset', x: 'xtrace' };
        if (c === 'o') {
          const name = args[++i];
          if (name === 'pipefail') ctx.opts.pipefail = on;
          continue;
        }
        if (map[c]) ctx.opts[map[c]!] = on;
      }
    }
    // Options typed at the prompt stay for the next commands.
    if (ctx.interactive) ctx.sh.vars.__SETOPTS = JSON.stringify(ctx.opts);
    setExplain(ctx, 'linux.explain.set');
    return 0;
  },
  shift: (ctx, argv) => {
    const n = Number(argv[1] ?? 1);
    if (n > ctx.positional.length) return 1;
    ctx.positional.splice(0, n);
    return 0;
  },
  exit: (ctx, argv, io) => {
    const code = argv[1] !== undefined ? Number(argv[1]) & 255 : ctx.st.lastExit;
    if (ctx.script || !ctx.interactive) {
      ctx.flow.exit = Number.isNaN(code) ? 2 : code;
      return ctx.flow.exit;
    }
    return leaveShell(ctx, io, code);
  },
  logout: (ctx, argv, io) => {
    if (ctx.script || !ctx.sh.login) {
      io.err(`${shellPrefix(ctx)}logout: not login shell: use \`exit'\n`);
      return 1;
    }
    return BUILTINS.exit!(ctx, argv, io);
  },
  return: (ctx, argv) => {
    ctx.flow.ret = argv[1] !== undefined ? Number(argv[1]) & 255 : ctx.st.lastExit;
    return ctx.flow.ret;
  },
  break: (ctx, argv) => {
    ctx.flow.brk = Number(argv[1] ?? 1);
    return 0;
  },
  continue: (ctx, argv) => {
    ctx.flow.cont = Number(argv[1] ?? 1);
    return 0;
  },
  source: (ctx, argv, io) => {
    const p = argv[1];
    if (!p) {
      io.err(`${shellPrefix(ctx)}source: filename argument required\nsource: usage: source filename [arguments]\n`);
      return 2;
    }
    const f = lookup(ctx.st, ctx.sh.user, absPath(ctx.sh.cwd, p.replace(/^~(?=\/)/, ctx.sh.vars.HOME ?? '~')));
    if (!f.ok || f.node.type !== 'file') {
      io.err(`${shellPrefix(ctx)}${p}: ${errText(f.ok ? 'EISDIR' : f.err)}\n`);
      return 1;
    }
    const code = runIn(ctx, f.node.content ?? '', io);
    setExplain(ctx, 'linux.explain.source', { name: p });
    return code;
  },
  '.': (ctx, argv, io) => BUILTINS.source!(ctx, argv, io),
  eval: (ctx, argv, io) => runIn(ctx, argv.slice(1).join(' '), io),
  type: (ctx, argv, io) => {
    let code = 0;
    const args = argv.slice(1).filter((a) => !a.startsWith('-'));
    const all = argv.includes('-a');
    for (const a of args) {
      if (all && BUILTINS[a]) {
        io.out(`${a} is a shell builtin\n`);
        for (const dir of ['/usr/bin', '/bin']) if (lookup(ctx.st, ctx.sh.user, `${dir}/${a}`).ok) io.out(`${a} is ${dir}/${a}\n`);
        continue;
      }
      const t = typeOf(ctx, a);
      if (t) io.out(`${t}\n`);
      else {
        io.err(`${shellPrefix(ctx)}type: ${a}: not found\n`);
        code = 1;
      }
    }
    setExplain(ctx, 'linux.explain.type');
    return code;
  },
  command: (ctx, argv, io) => {
    if (argv[1] === '-v') {
      const n = argv[2] ?? '';
      if (BUILTINS[n]) {
        io.out(`${n}\n`);
        return 0;
      }
      const f = findCommand(ctx, n);
      if ('path' in f) {
        io.out(`${f.path}\n`);
        return 0;
      }
      return 1;
    }
    const rest = argv.slice(1);
    if (!rest.length) return 0;
    const b = BUILTINS[rest[0]!];
    if (b) return b(ctx, rest, io);
    const saved = ctx.st.functions;
    ctx.st.functions = {};
    try {
      return runArgv(ctx, rest, io);
    } finally {
      ctx.st.functions = saved;
    }
  },
  alias: (ctx, argv, io) => {
    const args = argv.slice(1);
    if (!args.length) {
      for (const k of Object.keys(ctx.st.aliases).sort()) io.out(`alias ${k}='${ctx.st.aliases[k]}'\n`);
      return 0;
    }
    let code = 0;
    for (const a of args) {
      const m = /^([^=]+)=([\s\S]*)$/.exec(a);
      if (m) {
        ctx.st.aliases[m[1]!] = m[2]!;
        setExplain(ctx, 'linux.explain.alias', { name: m[1]! });
      } else if (ctx.st.aliases[a]) io.out(`alias ${a}='${ctx.st.aliases[a]}'\n`);
      else {
        io.err(`${shellPrefix(ctx)}alias: ${a}: not found\n`);
        code = 1;
      }
    }
    return code;
  },
  unalias: (ctx, argv, io) => {
    for (const a of argv.slice(1)) {
      if (a === '-a') ctx.st.aliases = {};
      else if (ctx.st.aliases[a]) delete ctx.st.aliases[a];
      else {
        io.err(`${shellPrefix(ctx)}unalias: ${a}: not found\n`);
        return 1;
      }
    }
    return 0;
  },
  umask: (ctx, argv, io) => {
    const args = argv.slice(1);
    const symbolic = args[0] === '-S';
    if (symbolic) args.shift();
    if (args[0] !== undefined) {
      if (!/^[0-7]{1,4}$/.test(args[0])) {
        io.err(`${shellPrefix(ctx)}umask: ${args[0]}: octal number out of range\n`);
        return 1;
      }
      ctx.sh.vars.__UMASK = (parseInt(args[0], 8) & 0o777).toString(8).padStart(3, '0');
      return 0;
    }
    const m = umaskOf(ctx);
    if (symbolic) {
      const part = (shift: number) => 'rwx'.split('').filter((_c, i) => !(m & (4 >> i) << shift)).join('');
      io.out(`u=${part(6)},g=${part(3)},o=${part(0)}\n`);
    } else io.out(`${m.toString(8).padStart(4, '0')}\n`);
    setExplain(ctx, 'linux.explain.umask', { mask: m.toString(8).padStart(4, '0') });
    return 0;
  },
  read: (ctx, argv, io) => {
    const p = parseOpts(argv.slice(1), 'r', [], ['p']);
    if (p.values.p) io.err(p.values.p);
    const input = io.stdin ?? '';
    const nl = input.indexOf('\n');
    if (!input.length) return 1;
    const line = nl < 0 ? input : input.slice(0, nl);
    const names = p.args.length ? p.args : ['REPLY'];
    const parts = line.trim().split(/\s+/);
    names.forEach((n, idx) => {
      ctx.sh.vars[n] = idx === names.length - 1 ? parts.slice(idx).join(' ') : (parts[idx] ?? '');
    });
    return 0;
  },
  history: (ctx, argv, io) => {
    if (argv[1] === '-c') {
      ctx.st.history = [];
      return 0;
    }
    ctx.st.history.forEach((h, i) => io.out(`${String(i + 1).padStart(5)}  ${h}\n`));
    setExplain(ctx, 'linux.explain.history');
    return 0;
  },
  trap: (ctx, argv) => {
    const action = argv[1] ?? '';
    for (const sig of argv.slice(2)) {
      const name = sig.replace(/^SIG/, '');
      if (name === 'EXIT' || name === '0') ctx.traps.EXIT = action;
      else ctx.traps[name] = action;
    }
    // A script that ignores TERM/INT is "stubborn": only kill -9 ends it.
    return 0;
  },
  wait: (ctx) => {
    for (const j of ctx.st.jobs) {
      const p = ctx.st.procs[j.pid];
      if (p?.ends !== undefined && p.ends > 0) ctx.st.clock = Math.max(ctx.st.clock, p.ends);
    }
    return 0;
  },
  jobs: (ctx, argv, io) => {
    const long = argv.includes('-l');
    const pOnly = argv.includes('-p');
    for (const j of ctx.st.jobs) {
      if (pOnly) io.out(`${j.pid}\n`);
      else io.out(`${jobLine(ctx.st, j, long)}\n`);
    }
    for (const j of ctx.st.jobs) if (j.state !== 'Running' && j.state !== 'Stopped') j.notify = false;
    ctx.st.jobs = ctx.st.jobs.filter((j) => j.state === 'Running' || j.state === 'Stopped');
    setExplain(ctx, ctx.st.jobs.length ? 'linux.explain.jobs' : 'linux.explain.noJobs');
    return 0;
  },
  fg: (ctx, argv, io) => jobControl(ctx, argv, io, 'fg'),
  bg: (ctx, argv, io) => jobControl(ctx, argv, io, 'bg'),
  kill: (ctx, argv, io) => killBuiltin(ctx, argv, io),
  /** Internal: write a whole file for a program (tee, sed -i, curl -o): __write path append|replace text [prog]. */
  __write: (ctx, argv, io) => {
    const [, path, mode, text, prog] = argv;
    const w = writeTarget(ctx, path!, mode === 'append');
    if (!w.ok) {
      io.err(`${prog ?? 'tee'}: ${path}: ${errText(w.err)}\n`);
      return 1;
    }
    w.write(text ?? '');
    return 0;
  },
  help: (ctx, _argv, io) => {
    io.out('GNU bash, version 5.2.37(1)-release (x86_64-pc-linux-gnu)\n');
    setExplain(ctx, 'linux.explain.help');
    return 0;
  },
};

/** %1, %+, %-, %sleep or a bare number → a job. */
function findJob(ctx: Ctx, spec: string | undefined): (typeof ctx.st.jobs)[number] | undefined {
  const live = ctx.st.jobs.filter((j) => j.state === 'Running' || j.state === 'Stopped');
  if (!spec || spec === '%' || spec === '%+' || spec === '%%') return live[live.length - 1];
  if (spec === '%-') return live[live.length - 2];
  const m = /^%?(\d+)$/.exec(spec);
  if (m) return live.find((j) => j.id === Number(m[1]));
  if (spec.startsWith('%')) return live.find((j) => j.cmd.startsWith(spec.slice(1)));
  return undefined;
}

function jobControl(ctx: Ctx, argv: string[], io: IO, which: 'fg' | 'bg'): number {
  if (ctx.script) {
    io.err(`${shellPrefix(ctx)}${which}: no job control\n`);
    return 1;
  }
  const j = findJob(ctx, argv[1]);
  if (!j) {
    io.err(`${shellPrefix(ctx)}${which}: ${argv[1] ?? 'current'}: no such job\n`);
    setExplain(ctx, 'linux.err.noJob');
    return 1;
  }
  const p = ctx.st.procs[j.pid];
  if (which === 'bg') {
    if (j.state === 'Running') {
      io.err(`${shellPrefix(ctx)}bg: job ${j.id} already in background\n`);
      return 0;
    }
    j.state = 'Running';
    if (p) p.state = p.kind === 'script' ? 'R' : 'S';
    if (!j.cmd.endsWith('&')) j.cmd = `${j.cmd} &`;
    io.out(`[${j.id}]+ ${j.cmd}\n`);
    setExplain(ctx, 'linux.explain.bg', { n: j.id });
    return 0;
  }
  const cmd = j.cmd.replace(/\s*&$/, '');
  io.out(`${cmd}\n`);
  j.state = 'Running';
  if (p) p.state = p.kind === 'script' ? 'R' : 'S';
  // In the foreground now: the terminal waits for it.
  ctx.st.jobs = ctx.st.jobs.filter((x) => x !== j);
  if (p) {
    delete p.job;
    if (p.ends !== undefined && p.ends > 0 && p.ends <= ctx.st.clock + 10) {
      ctx.st.clock = Math.max(ctx.st.clock, p.ends);
      delete ctx.st.procs[p.pid];
      setExplain(ctx, 'linux.explain.fgDone');
      return 0;
    }
    ctx.st.fg = { pid: p.pid, cmd };
  }
  setExplain(ctx, 'linux.explain.fg', { n: j.id });
  return 0;
}

function killBuiltin(ctx: Ctx, argv: string[], io: IO): number {
  const args = argv.slice(1);
  if (args[0] === '-l' || args[0] === '-L') {
    const code = bashKillList(shellPrefix(ctx), args.slice(1), io);
    if (!code) setExplain(ctx, 'linux.explain.killList');
    return code;
  }
  let sig = 'TERM';
  let rest = args;
  if (args[0]?.startsWith('-') && args[0] !== '-') {
    const s = args[0] === '-s' ? args[1] ?? '' : args[0].slice(1);
    rest = args[0] === '-s' ? args.slice(2) : args.slice(1);
    const n = signalNumber(s);
    if (n === null) {
      io.err(`${shellPrefix(ctx)}kill: ${s}: invalid signal specification\n`);
      return 1;
    }
    sig = SIGNALS[n - 1]!;
  }
  if (!rest.length) {
    io.err(`kill: usage: kill [-s sigspec | -n signum | -sigspec] pid | jobspec ... or kill -l [sigspec]\n`);
    return 2;
  }
  let code = 0;
  for (const target of rest) {
    let pid: number;
    if (target.startsWith('%')) {
      const j = findJob(ctx, target);
      if (!j) {
        io.err(`${shellPrefix(ctx)}kill: ${target}: no such job\n`);
        code = 1;
        continue;
      }
      pid = j.pid;
    } else if (/^\d+$/.test(target)) pid = Number(target);
    else {
      io.err(`${shellPrefix(ctx)}kill: ${target}: arguments must be process or job IDs\n`);
      code = 1;
      continue;
    }
    const r = signalProc(ctx, pid, sig);
    if (r !== 'ok') {
      io.err(`${shellPrefix(ctx)}kill: (${pid}) - ${r === 'ESRCH' ? 'No such process' : 'Operation not permitted'}\n`);
      setExplain(ctx, r === 'ESRCH' ? 'linux.err.noProcess' : 'linux.err.killDenied', { pid });
      code = 1;
      continue;
    }
    setExplain(ctx, sig === 'KILL' ? 'linux.explain.kill9' : 'linux.explain.kill', { pid, sig });
  }
  ctx.danger = ctx.danger || sig === 'KILL';
  return code;
}

/** `exit` typed in the learner's terminal: leave a sudo -i / su shell, or a note on the first one. */
function leaveShell(ctx: Ctx, io: IO, _code: number): number {
  const st = ctx.st;
  if (st.shells.length <= 1) {
    io.out('logout\n');
    setExplain(ctx, 'linux.explain.exitLast');
    return 0;
  }
  const top = st.shells.pop()!;
  const proc = Object.values(st.procs).filter((p) => p.kind === 'shell').pop();
  if (proc && proc.pid !== Object.values(st.procs).find((p) => p.kind === 'shell')?.pid) delete st.procs[proc.pid];
  if (top.login) io.out('logout\n');
  else io.out('exit\n');
  ctx.events.push({ type: 'userSwitched', user: shellOf(st).user });
  setExplain(ctx, 'linux.explain.exit', { user: shellOf(st).user });
  return 0;
}

export { procOf, stopProc, parentOf };
