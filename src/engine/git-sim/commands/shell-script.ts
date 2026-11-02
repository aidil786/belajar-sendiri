// Tiny shell helpers for World 10 (`git bisect run`): sh/bash scripts, grep, test, true, false.
// Scripts run one practice-terminal command per line. `exit N`, `! cmd` and `set -e` work;
// pipes, && and ; do not (one command at a time, like the terminal).
import { fail, line, lines, ok } from '../output';
import { resolve } from '../paths';
import { dirExists, fileExists } from '../state';
import type { CommandContext, CommandFn, CommandResult, Line, SimState } from '../types';
import { gitRegex, type PatternOpts } from './git-search';
import { splitLines } from '../diff';

function withCode(r: CommandResult, code: number): CommandResult {
  return { ...r, exitCode: code };
}

/** Run script text line by line. */
function runScript(state: SimState, text: string, name: string, ctx: CommandContext): CommandResult {
  const runLine = ctx.run;
  if (!runLine) return fail(state, lines(`${name}: cannot run here`), 'noRunner');
  if ((ctx.depth ?? 0) > 5) return fail(state, lines(`${name}: scripts call each other too deeply`), 'scriptLoop', { key: 'sim.err.scriptLoop' });
  let cur = state;
  const out: Line[] = [];
  let code = 0;
  let stopOnError = false;
  for (const raw of text.split('\n')) {
    const l = raw.trim();
    if (!l || l.startsWith('#')) continue;
    if (l === 'set -e') {
      stopOnError = true;
      continue;
    }
    const exit = /^exit(?:\s+(\d+))?$/.exec(l);
    if (exit) {
      code = exit[1] === undefined ? code : Number(exit[1]);
      break;
    }
    const negate = l.startsWith('! ');
    const r = runLine(cur, negate ? l.slice(2) : l);
    cur = r.state;
    out.push(...r.output);
    code = r.exitCode ?? (r.ok ? 0 : 1);
    if (negate) code = code === 0 ? 1 : 0;
    if (stopOnError && code !== 0) break;
  }
  // A test script that says "no" is an answer, not a mistake.
  return { state: cur, output: out, events: [], ok: code === 0, exitCode: code, ...(code !== 0 ? { stopped: true } : {}), explain: { key: 'sim.explain.script', params: { file: name, code: String(code) } } };
}

/** `sh file`, `bash file`, `sh -c "command"`. */
export const sh: CommandFn = (state, args, ctx) => {
  const name = ctx.raw.trim().split(/\s+/)[0] ?? 'sh';
  if (args[0] === '-c') {
    if (args[1] === undefined) return fail(state, lines(`${name}: -c: option requires an argument`), 'shUsage');
    return runScript(state, args[1], name, { ...ctx, depth: (ctx.depth ?? 0) + 1 });
  }
  const file = args[0];
  if (!file) return fail(state, lines('This practice terminal runs scripts like this: sh test.sh'), 'shUsage', { key: 'sim.err.shUsage' });
  const abs = resolve(state.cwd, file, state.home);
  const text = state.fs.files[abs];
  if (text === undefined) {
    return withCode(fail(state, lines(`${name}: ${file}: No such file or directory`), 'noSuchPath', { key: 'sim.err.noSuchPath', params: { path: file } }), 127);
  }
  return runScript(state, text, file, { ...ctx, depth: (ctx.depth ?? 0) + 1 });
};

/** `./test.sh`: files in the practice terminal are never executable. */
export function dotSlash(state: SimState, cmd: string): CommandResult {
  const abs = resolve(state.cwd, cmd, state.home);
  if (!fileExists(state, abs) && !dirExists(state, abs)) {
    return withCode(fail(state, lines(`bash: ${cmd}: No such file or directory`), 'noSuchPath', { key: 'sim.err.noSuchPath', params: { path: cmd } }), 127);
  }
  if (dirExists(state, abs)) return withCode(fail(state, lines(`bash: ${cmd}: Is a directory`), 'isADir'), 126);
  return withCode(
    fail(state, lines(`bash: ${cmd}: Permission denied`), 'notExecutable', { key: 'sim.err.notExecutable', params: { file: cmd.replace(/^\.\//, '') } }),
    126,
  );
}

/** `grep [-q] [-n] [-i] [-v] [-c] [-w] [-E] [-F] <pattern> <file>...` (exit 0 found, 1 not found, 2 error). */
export const grepFiles: CommandFn = (state, args) => {
  const flags = new Set<string>();
  const words: string[] = [];
  for (const a of args) {
    if (/^-[a-zA-Z]+$/.test(a)) for (const ch of a.slice(1)) flags.add(ch);
    else words.push(a);
  }
  const unknown = [...flags].find((f) => !'qnivcwEFlsH'.includes(f));
  if (unknown) return withCode(fail(state, lines(`grep: invalid option -- '${unknown}'`), 'badOption', { key: 'sim.err.grepOption' }), 2);
  const [pattern, ...files] = words;
  if (pattern === undefined || !files.length) {
    return withCode(fail(state, lines('Usage: grep [OPTION]... PATTERNS [FILE]...'), 'grepUsage', { key: 'sim.err.grepUsage' }), 2);
  }
  const opts: PatternOpts = { ignoreCase: flags.has('i'), extended: flags.has('E'), fixed: flags.has('F'), word: flags.has('w') };
  const re = gitRegex(pattern, opts);
  if (!re) return withCode(fail(state, lines('grep: Invalid regular expression'), 'badPattern'), 2);
  const out: Line[] = [];
  let found = false;
  let error = false;
  const many = files.length > 1 || flags.has('H');
  for (const f of files) {
    const abs = resolve(state.cwd, f, state.home);
    if (dirExists(state, abs)) {
      out.push(line(`grep: ${f}: Is a directory`));
      error = true;
      continue;
    }
    const text = state.fs.files[abs];
    if (text === undefined) {
      if (!flags.has('s')) out.push(line(`grep: ${f}: No such file or directory`));
      error = true;
      continue;
    }
    const hits = splitLines(text).map((l, i) => ({ l, n: i + 1 })).filter(({ l }) => re.test(l) !== flags.has('v'));
    if (hits.length) found = true;
    if (flags.has('q')) continue;
    if (flags.has('l')) {
      if (hits.length) out.push(line(f));
      continue;
    }
    if (flags.has('c')) {
      out.push(line(many ? `${f}:${hits.length}` : String(hits.length)));
      continue;
    }
    for (const { l, n } of hits) out.push(line(`${many ? `${f}:` : ''}${flags.has('n') ? `${n}:` : ''}${l}`));
  }
  if (flags.has('q') && found) return { state, output: [], events: [], ok: true, exitCode: 0, explain: { key: 'sim.explain.grepFound', params: { pattern } } };
  const code = error && !(flags.has('q') && found) ? 2 : found ? 0 : 1;
  return {
    state,
    output: out,
    events: [],
    ok: code === 0,
    exitCode: code,
    ...(code === 1 ? { stopped: true } : {}),
    explain: { key: code === 0 ? 'sim.explain.grepFound' : code === 1 ? 'sim.explain.grepNotFound' : 'sim.err.grepError', params: { pattern } },
  };
};

/** `test EXPR` and `[ EXPR ]`: -f, -e, -d, -n, -z, =, != (exit 0 true, 1 false). */
export const testCmd: CommandFn = (state, args, ctx) => {
  let words = args;
  if (ctx.raw.trim().startsWith('[')) {
    if (words[words.length - 1] !== ']') return withCode(fail(state, lines("bash: [: missing `]'"), 'testUsage'), 2);
    words = words.slice(0, -1);
  }
  let negate = false;
  if (words[0] === '!') {
    negate = true;
    words = words.slice(1);
  }
  const path = (p: string) => resolve(state.cwd, p, state.home);
  let truth: boolean;
  const [a, b, c] = words;
  if (words.length === 2 && a === '-f') truth = fileExists(state, path(b!));
  else if (words.length === 2 && a === '-d') truth = dirExists(state, path(b!));
  else if (words.length === 2 && a === '-e') truth = fileExists(state, path(b!)) || dirExists(state, path(b!));
  else if (words.length === 2 && a === '-n') truth = b !== '';
  else if (words.length === 2 && a === '-z') truth = b === '';
  else if (words.length === 3 && (b === '=' || b === '==')) truth = a === c;
  else if (words.length === 3 && b === '!=') truth = a !== c;
  else if (words.length === 1) truth = a !== '';
  else if (words.length === 0) truth = false;
  else return withCode(fail(state, lines('This practice terminal knows: test -f FILE, -d DIR, -e PATH, -n TEXT, -z TEXT, A = B, A != B'), 'testUsage', { key: 'sim.err.testUsage' }), 2);
  if (negate) truth = !truth;
  return { state, output: [], events: [], ok: truth, exitCode: truth ? 0 : 1, ...(truth ? {} : { stopped: true }), explain: { key: truth ? 'sim.explain.testTrue' : 'sim.explain.testFalse' } };
};

export const trueCmd: CommandFn = (state) => ok(state, [], [], undefined);
export const falseCmd: CommandFn = (state) => ({ state, output: [], events: [], ok: false, exitCode: 1, stopped: true });
