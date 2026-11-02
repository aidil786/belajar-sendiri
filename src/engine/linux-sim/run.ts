// The top level: one line typed in the learner's terminal → a new state and what the screen shows.
import type { Color, Line, Seg } from '../git-sim/types';
import type { IO } from './ctx';
import { childNames, resetRelative, userByName } from './fs';
import { pingStats } from './programs/net';
import { cronCommand, cronDue, cronLines } from './programs/sys';
import { endProc, jobNotices, reapFinished, spawn, stopProc } from './procs';
import { Interrupted, NeedAnswer, setAnswers } from './ask';
import { journal } from './services';
import { newCtx, runIn, setTerminal, shellOf } from './shell';
import type { LinuxResult, LinuxState } from './types';

/** Seconds the clock moves per typed command. */
export const TICK = 2;

const RISKY = /(^|[;&|]\s*)(sudo\b|su\b|rm\s+(-\w*[rRf]|--recursive|--force)|chmod\s+(-R\s+)?777|kill\s+-9|killall|pkill|crontab\s+-r|userdel|apt(-get)?\s+(remove|purge))|curl[^|]*\|\s*(sudo\s+)?(ba)?sh/;

/** What the prompt shows: "you@kedai:~/shop$ " (root: "#"). */
export function promptOf(st: LinuxState): { user: string; host: string; path: string; sigil: '$' | '#'; text: string } {
  const sh = shellOf(st);
  const home = sh.vars.HOME ?? '';
  const path = home && (sh.cwd === home || sh.cwd.startsWith(`${home}/`)) ? `~${sh.cwd.slice(home.length)}` : sh.cwd;
  const sigil = userByName(st, sh.user)?.uid === 0 ? '#' : '$';
  return { user: sh.user, host: st.hostname, path, sigil, text: `${sh.user}@${st.hostname}:${path}${sigil} ` };
}

function toLines(chunks: { text: string; color?: Color }[]): Line[] {
  const lines: Line[] = [[]];
  for (const c of chunks) {
    const parts = c.text.split('\n');
    parts.forEach((p, i) => {
      if (i > 0) lines.push([]);
      if (p) lines[lines.length - 1]!.push(c.color ? ({ t: p, c: c.color } as Seg) : { t: p });
    });
  }
  if (lines.length && lines[lines.length - 1]!.length === 0) lines.pop();
  return lines;
}

/**
 * Run one typed line. Never changes the state passed in. `tty: false` runs it with no terminal on
 * stdin (scripts, setup steps, the truth check): programs that would ask get end of input instead.
 */
export function run(state: LinuxState, line: string, opts: { tty?: boolean } = {}): LinuxResult {
  if (state.ask) return answer(state, line);
  return runLine(state, line, opts.tty === false ? { answers: null, shown: 0 } : null);
}

/** The learner answered a program's question: replay the waiting line with every answer so far. */
function answer(state: LinuxState, line: string): LinuxResult {
  const ask = state.ask!;
  const trimmed = line.trim();
  const a = trimmed === '^C' || trimmed === '^D' ? trimmed : line;
  const base: LinuxState = { ...state, ask: null };
  // The screen already shows the question and the answer typed after it.
  const shown = ask.shown + (a === '^C' || a === '^D' ? 0 : ask.secret ? 1 : a.length + 1);
  return runLine(base, ask.line, { answers: [...ask.answers, a], shown });
}

type Chunk = { text: string; color?: Color };

/** The chunks without their first `n` characters. */
function dropChars(chunks: Chunk[], n: number): Chunk[] {
  const out: Chunk[] = [];
  let skip = n;
  for (const c of chunks) {
    if (skip >= c.text.length) {
      skip -= c.text.length;
      continue;
    }
    out.push({ ...c, text: c.text.slice(skip) });
    skip = 0;
  }
  return out;
}

/** The first `n` characters of the chunks. */
function takeChars(chunks: Chunk[], n: number): Chunk[] {
  const out: Chunk[] = [];
  let left = n;
  for (const c of chunks) {
    if (left <= 0) break;
    out.push({ ...c, text: c.text.slice(0, left) });
    left -= c.text.length;
  }
  return out;
}

/** A program asked a question at the terminal: nothing changes yet, the line waits for the answer. */
function waiting(base: LinuxState, line: string, replay: { answers: string[] | null; shown: number } | null, chunks: Chunk[], danger: boolean, secret: boolean): LinuxResult {
  const text = chunks.map((c) => c.text).join('');
  const from = replay?.shown ?? 0;
  // Whole lines go to the screen; the unfinished last line (the question) becomes the prompt.
  const end = Math.max(from, text.lastIndexOf('\n') + 1);
  const res: LinuxResult = {
    state: { ...base, ask: { line, answers: replay?.answers ?? [], prompt: text.slice(end), shown: text.length, ...(secret ? { secret: true } : {}) } },
    output: toLines(dropChars(takeChars(chunks, end), from)),
    events: [],
    ok: true,
    exitCode: 0,
    stopped: true,
    explain: { key: 'linux.explain.ask' },
  };
  if (danger || RISKY.test(line.trim())) res.danger = true;
  return res;
}

function runLine(state: LinuxState, line: string, replay: { answers: string[] | null; shown: number } | null): LinuxResult {
  resetRelative();
  const st = structuredClone(state);
  let chunks: Chunk[] = [];
  const term = (text: string, color?: Color) => chunks.push(color ? { text, color } : { text });
  const sh = shellOf(st);
  const ctx = newCtx(st, sh, true);
  const io: IO = { stdin: null, out: term, err: (t) => term(t), tty: true };
  const trimmed = line.trim();

  // A program holds the terminal: only Ctrl+C / Ctrl+Z reach it.
  if (st.fg) {
    const fg = st.fg;
    const p = st.procs[fg.pid];
    if (trimmed === '^C') {
      if (p?.stubborn) {
        term('^C\n');
        return finish(st, ctx, chunks, { key: 'linux.explain.ctrlCIgnored' }, 130, true);
      }
      term('^C\n');
      if (p?.kind === 'ping') for (const l of pingStats(ctx, fg.cmd)) term(`${l}\n`);
      if (p) endProc(ctx, fg.pid, 'INT');
      st.fg = null;
      return finish(st, ctx, chunks, { key: 'linux.explain.ctrlC', params: { cmd: fg.cmd } }, 130, true);
    }
    if (trimmed === '^Z') {
      const job = stopProc(st, fg.pid);
      term('^Z\n');
      if (job) term(`[${job.id}]+  ${'Stopped'.padEnd(24)}${job.cmd}\n`);
      return finish(st, ctx, chunks, { key: 'linux.explain.ctrlZ', params: { n: job?.id ?? 1 } }, 148, true);
    }
    if (trimmed === 'q' && p?.kind === 'top') {
      endProc(ctx, fg.pid, 'INT');
      st.fg = null;
      return finish(st, ctx, chunks, { key: 'linux.explain.topQuit' }, 0, true);
    }
    return { state, output: [], events: [], ok: true, exitCode: 0, stopped: true, explain: { key: 'linux.explain.busy', params: { cmd: fg.cmd } } };
  }

  if (!trimmed) return { state, output: [], events: [], ok: true, exitCode: 0 };
  if (trimmed === '^C') {
    term('^C\n');
    return finish(st, ctx, chunks, { key: 'linux.explain.ctrlCIdle' }, 130, true);
  }
  // Debian's ~/.bashrc sets HISTCONTROL=ignoreboth: a line that starts with a space, or repeats the
  // one before it, is not saved.
  if (!/^\s/.test(line) && st.history[st.history.length - 1] !== trimmed) st.history.push(trimmed);
  const before = st.clock;
  setTerminal(term);
  setAnswers(replay ? replay.answers : [], (t) => term(t));
  let code: number;
  let interrupted = false;
  try {
    code = runIn(ctx, line, io);
  } catch (e) {
    if (e instanceof NeedAnswer) return waiting(state, line, replay, chunks, ctx.danger, e.secret);
    if (!(e instanceof Interrupted)) throw e;
    // Ctrl+C at a question: the program stops there (what it already did stays done).
    code = 130;
    interrupted = true;
  } finally {
    setTerminal(null);
    setAnswers(null, null);
  }
  if (replay) chunks = dropChars(chunks, replay.shown);
  if (ctx.flow.exit !== undefined) delete ctx.flow.exit;
  if (ctx.forever && !st.fg && !interrupted) {
    // An endless loop typed at the prompt: the shell keeps running it until Ctrl+C.
    ctx.forever = false;
    const pid = spawn(ctx, { args: trimmed, comm: 'bash', kind: 'script', state: 'R' });
    st.fg = { pid, cmd: trimmed };
    ctx.explain = { key: 'linux.explain.foreground' };
  }
  st.lastExit = code;
  const explain = interrupted ? { key: 'linux.explain.ctrlC', params: { cmd: trimmed } } : ctx.explain;
  if (RISKY.test(trimmed)) ctx.danger = true;
  return finish(st, ctx, chunks, explain, code, interrupted, before);
}

function finish(st: LinuxState, ctx: ReturnType<typeof newCtx>, chunks: { text: string; color?: Color }[], explain: LinuxResult['explain'], code: number, signal: boolean, before = st.clock): LinuxResult {
  const io: IO = { stdin: null, out: (t, c) => chunks.push(c ? { text: t, color: c } : { text: t }), err: (t) => chunks.push({ text: t }), tty: true };
  st.clock = Math.max(st.clock, before) + TICK;
  cronTick(ctx, before, st.clock);
  reapFinished(ctx);
  for (const n of jobNotices(st)) io.out(`${n}\n`);
  void signal;
  const res: LinuxResult = {
    state: st,
    output: toLines(chunks),
    events: ctx.events,
    ok: code === 0,
    exitCode: code,
  };
  if (explain) res.explain = explain;
  if (ctx.danger) res.danger = true;
  // Not mistakes: grep finding nothing, a false test, Ctrl+C, a busy terminal.
  if (code !== 0 && (signal || /explain\.(grepNone|noMatch|findNone|whichNone|printenvNone|getentNone|crontabNone|status\.|isActive|isEnabled|digNone|sshOther)|err\.(passwdNoTyping|noEditor)/.test(explain?.key ?? '') || (explain?.key === 'linux.explain.scriptFail'))) res.stopped = true;
  return res;
}

/** Run every user's crontab lines that are due between two clock times (cron must be running). */
function cronTick(ctx: ReturnType<typeof newCtx>, from: number, to: number) {
  const st = ctx.st;
  if (st.services.cron?.active !== 'active') return;
  const start = Math.floor(from / 60) + 1;
  const end = Math.floor(to / 60);
  if (end < start) return;
  const dir = '/var/spool/cron/crontabs';
  for (let m = start; m <= Math.min(end, start + 120); m++) {
    const t = m * 60;
    for (const user of childNames(st, dir)) {
      const text = st.fs[`${dir}/${user}`]?.content ?? '';
      for (const line of cronLines(text)) {
        if (!cronDue(line, t)) continue;
        const cmd = cronCommand(line);
        const pid = st.nextPid++;
        const saved = st.clock;
        st.clock = t + 1;
        journal(st, 'cron', 'CRON', pid, `(${user}) CMD (${cmd})`);
        const u = userByName(st, user);
        if (u) {
          const sh = { user, cwd: u.home, vars: { HOME: u.home, USER: user, LOGNAME: user, SHELL: '/bin/sh', PATH: '/usr/bin:/bin' }, exported: ['HOME', 'USER', 'LOGNAME', 'SHELL', 'PATH'], login: false };
          const c = newCtx(st, sh, false);
          c.events = ctx.events;
          c.pid = pid;
          const sink = () => undefined;
          runIn(c, cmd, { stdin: null, out: sink, err: sink, tty: false });
        }
        journal(st, 'cron', 'CRON', pid, `(CRON) info (No MTA installed, discarding output)`);
        st.clock = Math.max(saved, st.clock);
      }
    }
  }
}

/** Run several lines in a row (tests, scenarios). */
export function runAll(state: LinuxState, lines: string[]): LinuxResult {
  let r: LinuxResult = { state, output: [], events: [], ok: true, exitCode: 0 };
  const out: Line[] = [];
  for (const l of lines) {
    r = run(r.state, l);
    out.push(...r.output);
  }
  return { ...r, output: out };
}
