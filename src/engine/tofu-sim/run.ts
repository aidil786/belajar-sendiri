// The practice terminal for the OpenTofu simulator: `tofu …` commands plus a few shell commands
// (ls, cat, rm, echo, printf, mkdir, cp, mv, pwd, clear, export) on the project folder.
// run(state, line) never changes the state it was given.
import { parseLine } from '../git-sim/parse';
import { renderDiags } from './diag';
import { formatSource, unifiedDiff } from './fmt';
import { HclError } from './hcl';
import { loadConfig } from './config';
import {
  cmdApply,
  cmdImport,
  cmdInit,
  cmdOutput,
  cmdPlan,
  cmdProviders,
  cmdShow,
  cmdState,
  cmdValidate,
  cmdVersion,
  normal,
  parseFlags,
  PLAN_FILE_MARK,
  runApply,
  type Sess,
} from './tofu';
import type { Line, TofuResult, TofuState } from './types';

export const HOME = '/home/you';

export function initialState(files: Record<string, string>, opts: { seed?: number; dir?: string } = {}): TofuState {
  return { files: { ...files }, dirs: [], init: null, plans: {}, pending: null, env: {}, seed: opts.seed ?? 1, clock: 1793491200, dir: opts.dir ?? 'kedai', lastPlan: null };
}

export function promptOf(st: TofuState): { path: string; custom?: string } {
  if (st.pending) return { path: `~/${st.dir}`, custom: '  Enter a value: ' };
  return { path: `~/${st.dir}` };
}

const L = (t: string, c?: Line[number]['c']): Line => (t ? [c ? { t, c } : { t }] : []);

export const TOFU_COMMANDS = ['init', 'validate', 'plan', 'apply', 'destroy', 'fmt', 'show', 'output', 'state', 'import', 'providers', 'version', 'refresh', 'console', 'graph', 'taint', 'untaint', 'workspace', 'login', 'logout', 'test', 'force-unlock', 'get', 'metadata'];
export const SHELL_COMMANDS = ['ls', 'cat', 'rm', 'echo', 'printf', 'mkdir', 'cp', 'mv', 'pwd', 'clear', 'export', 'unset', 'env', 'cd', 'help', 'touch', 'terraform'];
/** Commands that delete real things (danger badge). */
export const DANGER = /^(tofu|terraform)\s+(destroy\b|apply\b.*-destroy\b|state\s+(rm|remove)\b)|^rm\s+(-\w*r\w*\s+)?\S*terraform\.tfstate/;

function sess(st: TofuState, color: boolean): Sess {
  return { st: structuredClone(st), out: [], events: [], color, exit: 0 };
}

function result(s: Sess, fallbackOk = true): TofuResult {
  const ok = s.exit === 0 && fallbackOk;
  const r: TofuResult = { state: s.st, output: trimEnd(s.out), events: s.events, ok: ok || Boolean(s.stopped), exitCode: s.exit };
  if (s.explain) r.explain = s.explain;
  if (s.stopped) r.stopped = true;
  if (!ok && !s.stopped) s.events.push({ type: 'error', code: s.explain?.key ?? 'failed' });
  return r;
}

function trimEnd(lines: Line[]): Line[] {
  const out = [...lines];
  while (out.length && !out[out.length - 1]!.map((x) => x.t).join('').trim()) out.pop();
  return out;
}

export interface RunOpts {
  /** Plain output like `-no-color` (the truth check uses it). Default: colour, like a terminal. */
  noColor?: boolean;
}

/** Run one line. The state passed in is never changed. */
export function run(state: TofuState, line: string, opts: RunOpts = {}): TofuResult {
  const st0 = { ...state, clock: state.clock + 1 };
  const trimmed = line.trim();
  // An answer to a question?
  if (st0.pending) return answer(st0, line, opts);
  if (!trimmed) return { state: st0, output: [], events: [], ok: true, exitCode: 0 };
  const parsed = parseLine(trimmed);
  if (parsed.error) {
    return { state: st0, output: [L(parsed.error === 'unclosedQuote' ? 'sh: syntax error: unterminated quoted string' : "sh: syntax error: unexpected newline")], events: [{ type: 'error', code: 'quote' }], ok: false, exitCode: 2, explain: { key: 'tofu.err.quote' } };
  }
  const argv = parsed.words;
  const redirect = parsed.redirect;
  const [cmd, ...rest] = argv;
  if (cmd === 'tofu' || cmd === 'terraform') {
    const color = !opts.noColor && !rest.includes('-no-color');
    return tofu(st0, rest, trimmed, color, cmd === 'terraform');
  }
  return shell(st0, cmd!, rest, trimmed, redirect);
}

function tofu(st: TofuState, argv: string[], line: string, color: boolean, isTerraform: boolean): TofuResult {
  const s = sess(st, color);
  if (isTerraform) {
    s.out.push(L('bash: terraform: command not found'));
    s.exit = 127;
    s.explain = { key: 'tofu.err.terraform' };
    return result(s);
  }
  // global options
  let args = argv.filter((a) => a !== '-no-color' && a !== '--no-color');
  if (args[0] === '-version' || args[0] === '--version' || args[0] === '-v') args = ['version'];
  const [sub, ...rest] = args;
  if (!sub || sub === '-help' || sub === '--help' || sub === '-h' || sub === 'help') {
    s.out.push(...HELP.split('\n').map((l) => L(l)));
    s.explain = { key: 'tofu.explain.help' };
    return result(s);
  }
  if (rest.includes('-help') || rest.includes('--help') || rest.includes('-h')) {
    s.out.push(L(`Usage: tofu [global options] ${sub} [options]`), [], L('  (The practice terminal keeps help short. Full help: opentofu.org/docs/cli/commands/)'));
    s.explain = { key: 'tofu.explain.help' };
    return result(s);
  }
  switch (sub) {
    case 'init':
      cmdInit(s, rest);
      break;
    case 'validate':
      cmdValidate(s, rest);
      break;
    case 'plan':
      cmdPlan(s, rest, line);
      break;
    case 'apply':
      cmdApply(s, rest, line, 'apply');
      break;
    case 'destroy':
      cmdApply(s, rest, line, 'destroy');
      break;
    case 'refresh':
      cmdApply(s, rest, line, 'refresh');
      break;
    case 'fmt':
      cmdFmt(s, rest);
      break;
    case 'show':
      cmdShow(s, rest);
      break;
    case 'output':
      cmdOutput(s, rest);
      break;
    case 'state':
      cmdState(s, rest);
      break;
    case 'import':
      cmdImport(s, rest);
      break;
    case 'providers':
      cmdProviders(s);
      break;
    case 'version':
      cmdVersion(s);
      break;
    case 'console':
    case 'graph':
    case 'taint':
    case 'untaint':
    case 'workspace':
    case 'login':
    case 'logout':
    case 'test':
    case 'force-unlock':
    case 'get':
    case 'metadata':
      s.explain = { key: 'tofu.explain.notHere', params: { cmd: `tofu ${sub}` } };
      s.stopped = true;
      s.exit = 1;
      return result(s);
    default:
      s.out.push(L(`OpenTofu has no command named "${sub}".`), [], L("To see all of OpenTofu's top-level commands, run:"), L('  tofu -help'));
      s.exit = 1;
      s.explain = { key: 'tofu.err.unknownCommand', params: { cmd: sub } };
  }
  s.st.clock += 2;
  return result(s);
}

/** The learner typed an answer to a question. */
function answer(st: TofuState, line: string, opts: RunOpts): TofuResult {
  const pending = st.pending!;
  const s = sess({ ...st, pending: null }, !opts.noColor);
  const value = line.replace(/\r/g, '');
  if (pending.kind === 'var') {
    const [name, ...more] = pending.names;
    const values = { ...pending.values, [name!]: value };
    if (more.length) {
      const config = loadConfig(st.files).config;
      const decl = config.root.variables[more[0]!];
      s.out.push(L(`var.${more[0]}`, 'bold'));
      if (decl?.description) s.out.push(L(`  ${decl.description}`), []);
      s.st.pending = { ...pending, names: more, values };
      s.stopped = true;
      s.explain = { key: 'tofu.explain.askVar', params: { name: more[0]! } };
      return result(s);
    }
    // Run the command again with the answers (OpenTofu prints a newline after reading one).
    s.out.push([]);
    const argv = parseLine(pending.line).words;
    const color = !opts.noColor && !argv.includes('-no-color');
    s.color = color;
    const [, sub, ...rest] = argv.filter((a) => a !== '-no-color');
    if (sub === 'plan') cmdPlan(s, rest, pending.line, values);
    else if (sub === 'apply' || sub === 'destroy' || sub === 'refresh') cmdApply(s, rest, pending.line, sub, values);
    return result(s);
  }
  // approve
  if (value.trim() !== 'yes') {
    s.out.push([]);
    s.out.push(L(`${pending.command === 'destroy' ? 'Destroy' : 'Apply'} cancelled.`));
    s.exit = 1;
    s.st.lastPlan = null;
    s.events.push({ type: 'cancelled' });
    s.explain = { key: 'tofu.explain.cancelled' };
    s.stopped = true;
    return result(s);
  }
  const { config } = loadConfig(st.files);
  s.out.push([]);
  runApply(s, config, pending.plan, pending.command);
  return result(s);
}

// ---------------------------------------------------------------------------
// fmt

function cmdFmt(s: Sess, argv: string[]) {
  const f = parseFlags(argv, ['list', 'write'], ['check', 'diff', 'recursive', 'no-color']);
  const list = !argv.some((a) => /^-+list=false$/.test(a));
  const check = f.bools.has('check');
  const write = !check && !argv.some((a) => /^-+write=false$/.test(a));
  const target = f.args[0];
  const files = s.st.files;
  let names = Object.keys(files).filter((p) => /\.(tf|tfvars)$/.test(p));
  if (target && target !== '.') {
    const t = normal(target);
    names = t in files ? [t] : names.filter((p) => p.startsWith(`${t}/`) && (f.bools.has('recursive') || !p.slice(t.length + 1).includes('/')));
  } else if (!f.bools.has('recursive')) names = names.filter((p) => !p.includes('/'));
  names.sort();
  const changed: string[] = [];
  for (const name of names) {
    let next: string;
    try {
      next = formatSource(files[name]!, name);
    } catch (e) {
      if (e instanceof HclError) {
        s.out.push(...renderDiags([{ severity: 'error', summary: e.summary, detail: e.detail, subject: e.range }], { [name]: files[name]! }, s.color));
        s.exit = 2;
        s.explain = { key: 'tofu.err.fmtSyntax' };
        return;
      }
      throw e;
    }
    if (next === files[name]) continue;
    changed.push(name);
    if (list) s.out.push(L(name));
    if (f.bools.has('diff')) {
      for (const l of unifiedDiff(files[name]!, next, name).split('\n')) {
        const c = l.startsWith('+') && !l.startsWith('+++') ? 'green' : l.startsWith('-') && !l.startsWith('---') ? 'red' : undefined;
        s.out.push([c ? { t: l, c } : { t: l }]);
      }
    }
    if (write) files[name] = next;
  }
  if (check && changed.length) {
    s.exit = 3;
    s.stopped = true;
    s.explain = { key: 'tofu.explain.fmtCheck', params: { n: changed.length } };
  } else s.explain = { key: changed.length ? 'tofu.explain.fmt' : 'tofu.explain.fmtClean', params: { n: changed.length } };
  s.events.push({ type: 'formatted', files: changed });
}

// ---------------------------------------------------------------------------
// shell

function shell(st: TofuState, cmd: string, args: string[], line: string, redirect: { append: boolean; target: string } | null): TofuResult {
  const s = sess(st, true);
  const files = s.st.files;
  const out = (t: string) => s.out.push(L(t));
  const fail = (t: string, key: string, code = 1) => {
    out(t);
    s.exit = code;
    s.explain = { key };
  };
  const isDir = (p: string) => p === '' || s.st.dirs.includes(p) || Object.keys(files).some((f) => f.startsWith(`${p}/`)) || p === '.terraform';
  switch (cmd) {
    case 'pwd':
      out(`${HOME}/${s.st.dir}`);
      break;
    case 'clear':
      s.events.push({ type: 'cleared' });
      break;
    case 'help':
      s.explain = { key: 'tofu.explain.shellHelp' };
      break;
    case 'cd':
      if (args[0] && args[0] !== '.' && args[0] !== '~' && args[0] !== `${HOME}/${s.st.dir}`) fail(`sh: cd: ${args[0]}: stay in the project folder here`, 'tofu.err.cd');
      break;
    case 'ls': {
      const all = args.some((a) => /^-\w*a/.test(a));
      const target = normal(args.find((a) => !a.startsWith('-')) ?? '.');
      if (target === '.terraform') {
        if (!s.st.init) return (fail("ls: cannot access '.terraform': No such file or directory", 'tofu.err.noFile', 2), result(s));
        const kids = [...(Object.keys(s.st.init.modules).length ? ['modules'] : []), ...(Object.keys(s.st.init.providers).length ? ['providers'] : [])];
        for (const k of kids) out(k);
        break;
      }
      if (target && !isDir(target)) {
        if (target in files) out(target);
        else fail(`ls: cannot access '${target}': No such file or directory`, 'tofu.err.noFile', 2);
        break;
      }
      const prefix = target ? `${target}/` : '';
      const names = new Set<string>();
      for (const f of Object.keys(files)) if (f.startsWith(prefix)) names.add(f.slice(prefix.length).split('/')[0]!);
      for (const d of s.st.dirs) if (d.startsWith(prefix) && d !== target) names.add(d.slice(prefix.length).split('/')[0]!);
      if (!target && s.st.init) names.add('.terraform');
      const shown = [...names].filter((n) => all || !n.startsWith('.')).sort((a, b) => a.replace(/^\./, '').localeCompare(b.replace(/^\./, '')));
      if (all) {
        out('.');
        out('..');
      }
      for (const n of shown) out(n);
      break;
    }
    case 'cat': {
      if (!args.length) return (fail('cat: missing file operand', 'tofu.err.noFile'), result(s));
      for (const a of args) {
        const p = normal(a);
        if (!(p in files)) {
          fail(isDir(p) ? `cat: ${a}: Is a directory` : `cat: ${a}: No such file or directory`, 'tofu.err.noFile');
          continue;
        }
        const c = files[p]!;
        if (c === PLAN_FILE_MARK) {
          out('PK\u0003\u0004 (a saved plan is a zip file: read it with tofu show)');
          s.explain = { key: 'tofu.explain.planFile' };
          continue;
        }
        const lines = c.split('\n');
        if (lines[lines.length - 1] === '') lines.pop();
        for (const l of lines) out(l);
      }
      if (!s.explain) s.explain = { key: /tfstate/.test(args.join(' ')) ? 'tofu.explain.catState' : 'tofu.explain.cat' };
      break;
    }
    case 'rm': {
      const rec = args.some((a) => /^-\w*r/.test(a));
      const force = args.some((a) => /^-\w*f/.test(a));
      for (const a of args.filter((x) => !x.startsWith('-'))) {
        const p = normal(a);
        if (p in files) {
          delete files[p];
          delete s.st.plans[p];
          s.events.push({ type: 'fileRemoved', path: p });
        } else if (p === '.terraform' && rec) {
          s.st.init = null;
        } else if (isDir(p)) {
          if (!rec) fail(`rm: cannot remove '${a}': Is a directory`, 'tofu.err.isDir');
          else {
            for (const f of Object.keys(files)) if (f.startsWith(`${p}/`)) delete files[f];
            s.st.dirs = s.st.dirs.filter((d) => d !== p && !d.startsWith(`${p}/`));
          }
        } else if (!force) fail(`rm: cannot remove '${a}': No such file or directory`, 'tofu.err.noFile');
      }
      if (!s.exit) s.explain = { key: /tfstate/.test(line) ? 'tofu.explain.rmState' : 'tofu.explain.rm' };
      break;
    }
    case 'mkdir':
      for (const a of args.filter((x) => !x.startsWith('-'))) {
        const p = normal(a);
        if (!s.st.dirs.includes(p)) s.st.dirs.push(p);
      }
      break;
    case 'touch':
      for (const a of args) {
        const p = normal(a);
        if (!(p in files)) files[p] = '';
      }
      break;
    case 'cp':
    case 'mv': {
      const [from, to] = args.filter((x) => !x.startsWith('-'));
      if (!from || !to) return (fail(`${cmd}: missing file operand`, 'tofu.err.noFile'), result(s));
      const a = normal(from);
      if (!(a in files)) return (fail(`${cmd}: cannot stat '${from}': No such file or directory`, 'tofu.err.noFile'), result(s));
      const b = isDir(normal(to)) ? `${normal(to)}/${a.split('/').pop()}`.replace(/^\//, '') : normal(to);
      files[b] = files[a]!;
      if (s.st.plans[a]) s.st.plans[b] = s.st.plans[a]!;
      if (cmd === 'mv') {
        delete files[a];
        delete s.st.plans[a];
      }
      break;
    }
    case 'echo':
    case 'printf': {
      let textOut: string;
      const parts = args;
      if (cmd === 'echo') textOut = `${parts.filter((x, i) => !(i === 0 && x === '-n')).join(' ')}${parts[0] === '-n' ? '' : '\n'}`;
      else textOut = (parts[0] ?? '').replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/%%/g, '%');
      if (redirect) {
        const p = normal(redirect.target);
        files[p] = redirect.append ? (files[p] ?? '') + textOut : textOut;
        s.events.push({ type: 'fileWritten', path: p });
        s.explain = { key: 'tofu.explain.wroteFile', params: { file: p } };
      } else for (const l of textOut.replace(/\n$/, '').split('\n')) out(l);
      break;
    }
    case 'export': {
      for (const a of args) {
        const m = /^([A-Za-z_]\w*)=(.*)$/s.exec(a);
        if (m) s.st.env[m[1]!] = m[2]!;
      }
      s.explain = { key: 'tofu.explain.export' };
      break;
    }
    case 'unset':
      for (const a of args) delete s.st.env[a];
      break;
    case 'env':
      for (const [k, v] of Object.entries(s.st.env).sort()) out(`${k}=${v}`);
      break;
    default:
      fail(`sh: ${cmd}: command not found`, 'tofu.err.unknownShell', 127);
      s.explain = { key: 'tofu.err.unknownShell', params: { cmd } };
  }
  return result(s);
}

const HELP = `Usage: tofu [global options] <subcommand> [args]

The available commands for execution are listed below.
The primary workflow commands are given first, followed by
less common or more advanced commands.

Main commands:
  init          Prepare your working directory for other commands
  validate      Check whether the configuration is valid
  plan          Show changes required by the current configuration
  apply         Create or update infrastructure
  destroy       Destroy previously-created infrastructure

All other commands:
  console       Try OpenTofu expressions at an interactive command prompt
  fmt           Reformat your configuration in the standard style
  force-unlock  Release a stuck lock on the current workspace
  get           Install or upgrade remote OpenTofu modules
  graph         Generate a Graphviz graph of the steps in an operation
  import        Associate existing infrastructure with a OpenTofu resource
  login         Obtain and save credentials for a remote host
  logout        Remove locally-stored credentials for a remote host
  metadata      Metadata related commands
  output        Show output values from your root module
  providers     Show the providers required for this configuration
  refresh       Update the state to match remote systems
  show          Show the current state or a saved plan
  state         Advanced state management
  taint         Mark a resource instance as not fully functional
  test          Execute integration tests for OpenTofu modules
  untaint       Remove the 'tainted' state from a resource instance
  version       Show the current OpenTofu version
  workspace     Workspace management

Global options (use these before the subcommand, if any):
  -chdir=DIR    Switch to a different working directory before executing the
                given subcommand.
  -help         Show this help output, or the help for a specified subcommand.
  -version      An alias for the "version" subcommand.`;

/** Run several lines (stops at the first that fails unless it is meant to wait). */
export function runAll(state: TofuState, lines: string[], opts: RunOpts = {}): { state: TofuState; results: TofuResult[] } {
  let st = state;
  const results: TofuResult[] = [];
  for (const l of lines) {
    const r = run(st, l, opts);
    results.push(r);
    st = r.state;
  }
  return { state: st, results };
}
