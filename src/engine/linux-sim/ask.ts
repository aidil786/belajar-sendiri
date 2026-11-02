// Programs that ask a question and read the answer (rm -i, cp -i, mv -i, rm on a write-protected
// file): from a pipe (`echo y | rm -i x`) or from the learner typing at the terminal.
//
// The engine is synchronous, so a question at the terminal works by replay: the first run stops at
// the question (NeedAnswer) and the typed line waits in `state.ask`; each answer re-runs the line from
// the same starting state with the answers so far, and shows only the output that is new.
import type { Ctx, IO } from './ctx';

/** Thrown when a program reads the terminal and the learner has not answered yet. */
export class NeedAnswer extends Error {
  /** A password: the terminal does not show what is typed. */
  secret: boolean;
  constructor(secret = false) {
    super('waiting for an answer');
    this.secret = secret;
  }
}

/** Thrown when the learner answers a question with Ctrl+C: the whole command line stops. */
export class Interrupted extends Error {
  constructor() {
    super('interrupted');
  }
}

/** The answers typed so far for the line being run (null: no terminal, so end of input). */
let answers: string[] | null = null;
let used = 0;
let echo: ((t: string) => void) | null = null;

/** run() sets the terminal's answers (and where the terminal echoes them) for one typed line. */
export function setAnswers(list: string[] | null, termEcho: ((t: string) => void) | null) {
  answers = list;
  used = 0;
  echo = termEcho;
}

/** Where each program is in its piped input (several questions read several lines). */
const cursors = new WeakMap<IO, number>();

/**
 * Print `question` on stderr and read one line of input. Returns the line (without its newline), or
 * null at the end of input (nothing piped in, Ctrl+D, a script with no terminal).
 */
export function askLine(ctx: Ctx, io: IO, question: string, secret = false): string | null {
  io.err(question);
  if (io.stdin !== null) {
    const pos = cursors.get(io) ?? 0;
    if (pos >= io.stdin.length) return null;
    const nl = io.stdin.indexOf('\n', pos);
    const line = nl < 0 ? io.stdin.slice(pos) : io.stdin.slice(pos, nl);
    cursors.set(io, nl < 0 ? io.stdin.length : nl + 1);
    return line;
  }
  // A background job can't read the terminal; cron and setup steps have none.
  if (answers === null || ctx.bg) return null;
  if (used < answers.length) {
    const a = answers[used++]!;
    if (a === '^C') throw new Interrupted();
    if (a === '^D') return null;
    // The terminal echoes what the learner typed (only the Enter for a password).
    echo?.(secret ? '\n' : `${a}\n`);
    return a;
  }
  throw new NeedAnswer(secret);
}

/**
 * A question asked on the terminal itself (/dev/tty), whatever stdin is: ssh's host key question.
 * Returns null when there is no terminal (a script, the truth check) or at Ctrl+D.
 */
export function askTerminal(ctx: Ctx, io: IO, question: string, secret = false): string | null {
  return askLine(ctx, { ...io, stdin: null }, question, secret);
}

/** The command runs with the learner's terminal (not a script with no terminal, not cron). */
export function hasTerminal(ctx: Ctx): boolean {
  return answers !== null && !ctx.bg;
}

/** isatty(0): stdin is the learner's terminal (not a pipe, a file, a script with no terminal). */
export function stdinIsTty(ctx: Ctx, io: IO): boolean {
  return io.stdin === null && answers !== null && !ctx.bg;
}

/** GNU yesno(): an answer starting with y or Y means yes (C.UTF-8's yesexpr is ^[yY]). */
export function yes(answer: string | null): boolean {
  return answer !== null && /^[yY]/.test(answer);
}
