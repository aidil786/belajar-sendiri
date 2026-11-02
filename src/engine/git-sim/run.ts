// Run one line typed in the practice terminal.
import { closest, fail, line, lines } from './output';
import { parseLine } from './parse';
import { EXPLAIN_ONLY, GIT_COMMANDS, KNOWN_SHELL, LATER_COMMANDS, SHELL_COMMANDS } from './registry';
import { answerPatch } from './commands/git-save';
import { USAGE } from './commands/git-setup';
import { echo } from './commands/shell';
import { dotSlash } from './commands/shell-script';
import { findRepo, getConfig } from './state';
import type { CommandContext, CommandResult, SimState } from './types';

const GIT_ALIASES: Record<string, string> = { '--version': 'version', '-v': 'version', '--help': 'help', '-h': 'help' };

function runGit(state: SimState, args: string[], raw: string, depth = 0): CommandResult {
  const [first, ...rest] = args;
  const ctx: CommandContext = { raw, run: (s, l) => runLine(s, l, depth + 1), depth };
  if (!first) return GIT_COMMANDS.help!(state, [], ctx);
  const name = GIT_ALIASES[first] ?? first;
  const fn = GIT_COMMANDS[name];
  if (fn) {
    // `git <cmd> -h` prints a short usage; `git <cmd> --help` is like `git help <cmd>`.
    if (name !== 'help' && name !== 'version' && rest.includes('--help')) return GIT_COMMANDS.help!(state, [name], ctx);
    if (name !== 'help' && name !== 'version' && rest.length === 1 && rest[0] === '-h' && USAGE[name]) {
      return {
        state,
        output: USAGE[name]!.map((u) => line(u)),
        events: [],
        ok: true,
        explain: { key: 'sim.explain.usage', params: { cmd: name } },
      };
    }
    return fn(state, rest, ctx);
  }
  // Aliases (`git config --global alias.st status`). Built-in commands always win, like Git.
  const alias = getConfig(state, findRepo(state), `alias.${name}`);
  if (alias !== undefined) return runAlias(state, name, alias, rest, raw, depth);
  if (EXPLAIN_ONLY.includes(name)) {
    return {
      state,
      output: lines(`This practice terminal doesn't run git ${name}. The lesson shows what it does.`),
      events: [],
      ok: false,
      stopped: true,
      explain: { key: `sim.explain.notInSim.${name}`, params: { cmd: `git ${name}` } },
    };
  }
  const world = LATER_COMMANDS[name];
  if (world !== undefined) {
    return fail(state, lines(`git: '${name}' isn't in this practice terminal yet.`), 'later', {
      key: 'sim.err.later',
      params: { cmd: `git ${name}`, world: String(world) },
    });
  }
  const suggestion = closest(name, Object.keys(GIT_COMMANDS));
  const out = lines(`git: '${name}' is not a git command. See 'git --help'.`);
  if (suggestion) out.push(line(''), line('The most similar command is'), line(`\t${suggestion}`));
  return fail(state, out, 'unknownGitCommand', suggestion
    ? { key: 'sim.err.unknownGitDidYouMean', params: { cmd: name, suggestion } }
    : { key: 'sim.err.unknownGit', params: { cmd: name } });
}

/** `git st` → `git status` (plus any extra words). `!cmd` aliases run a terminal command. */
function runAlias(state: SimState, name: string, value: string, rest: string[], raw: string, depth: number): CommandResult {
  if (rest.includes('--help')) {
    return { state, output: [line(`'${name}' is aliased to '${value}'`)], events: [], ok: true, explain: { key: 'sim.explain.aliasHelp', params: { alias: name, cmd: value } } };
  }
  if (depth > 8) {
    return fail(state, lines(`fatal: alias loop detected: expansion of '${name}' does not terminate`), 'aliasLoop', { key: 'sim.err.aliasLoop', params: { alias: name } });
  }
  if (value.startsWith('!')) {
    const r = runLine(state, [value.slice(1), ...rest].join(' '), depth + 1);
    return r.ok ? { ...r, explain: { key: 'sim.explain.aliasShell', params: { alias: name, cmd: value.slice(1) } } } : r;
  }
  const words = parseLine(value).words;
  const r = runGit(state, [...words, ...rest], raw, depth + 1);
  // Keep a friendly error from the real command; otherwise say what the alias ran.
  if (!r.ok && !r.stopped) return r;
  return { ...r, explain: { key: 'sim.explain.alias', params: { alias: name, cmd: `git ${value}` } } };
}

/** Run one line typed in the practice terminal. */
export function run(state: SimState, input: string): CommandResult {
  return runLine(state, input, 0);
}

function runLine(state: SimState, input: string, depth: number): CommandResult {
  if (state.pending?.kind === 'addPatch') return answerPatch(state, input);

  const raw = input.trim();
  if (raw === '') return { state, output: [], events: [], ok: true };
  if (/(^|\s)(&&|\|\||;|\|)(\s|$)/.test(raw)) {
    return fail(state, lines('Type one command at a time here.'), 'oneAtATime', { key: 'sim.err.oneAtATime' });
  }
  const parsed = parseLine(raw);
  if (parsed.error === 'unclosedQuote') {
    return fail(state, lines('Your quote is not closed. Add the missing " at the end.'), 'unclosedQuote', {
      key: 'sim.err.unclosedQuote',
    });
  }
  if (parsed.error === 'missingTarget') {
    return fail(state, lines('bash: syntax error near unexpected token `newline\''), 'missingTarget', {
      key: 'sim.err.redirectTarget',
    });
  }
  const [cmd, ...args] = parsed.words;
  if (!cmd) return { state, output: [], events: [], ok: true };

  if (cmd === 'echo') return echo(state, args, parsed.redirect);
  if (parsed.redirect) {
    return fail(state, lines('In this practice terminal, > only works with echo.'), 'redirectEchoOnly', {
      key: 'sim.err.redirectEchoOnly',
    });
  }
  if (cmd === 'git') return runGit(state, args, raw, depth);
  const shellFn = SHELL_COMMANDS[cmd];
  if (shellFn) return shellFn(state, args, { raw, run: (s, l) => runLine(s, l, depth + 1), depth });
  if (cmd.startsWith('./') || cmd.startsWith('/')) return dotSlash(state, cmd);

  const suggestion = closest(cmd, KNOWN_SHELL);
  return fail(
    state,
    lines(`${cmd}: command not found`),
    'unknownCommand',
    suggestion
      ? { key: 'sim.err.unknownCmdDidYouMean', params: { cmd, suggestion } }
      : { key: 'sim.err.unknownCmd', params: { cmd } },
  );
}

/** Run several lines in a row; returns the final state and every result. */
export function runAll(state: SimState, inputs: string[]): { state: SimState; results: CommandResult[] } {
  const results: CommandResult[] = [];
  let cur = state;
  for (const input of inputs) {
    const r = run(cur, input);
    results.push(r);
    cur = r.state;
  }
  return { state: cur, results };
}
