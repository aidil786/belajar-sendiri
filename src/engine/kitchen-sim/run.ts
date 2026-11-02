// Run one line typed in the kitchen terminal: the laptop shell, `docker ...`, or input for
// a program that is waiting (a shell inside a container, a password, a y/N question).
import { closest } from '../git-sim/output';
import { makeCtx, runScript } from './cshell';
import { runDocker } from './docker';
import { echo, HOST_COMMANDS, KNOWN_HOST } from './host';
import { loginWith } from './imagecmds';
import { exitContainer, stopContainer, tick } from './lifecycle';
import { parseShell, type SimpleCommand } from './parse';
import { evalJs, evalPy } from './programs';
import { shellPrompt } from './containers';
import { nginxTime } from './format';
import { fail, line, ok, out, resolve, TICK } from './state';
import type { KitchenResult, KitchenState, Line } from './types';

/** Filters allowed after a pipe on the laptop: `docker ps | grep web`. */
function filter(cmd: SimpleCommand, input: string): { ok: boolean; text: string; code: number } {
  const [name, ...args] = cmd.words;
  const lines = input.replace(/\n$/, '').split('\n');
  switch (name) {
    case 'grep': {
      const flags = args.filter((a) => a.startsWith('-')).join('');
      const pat = args.find((a) => !a.startsWith('-')) ?? '';
      const re = new RegExp(pat.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*'), flags.includes('i') ? 'i' : '');
      const hits = lines.filter((l) => re.test(l) !== flags.includes('v'));
      return { ok: hits.length > 0, text: flags.includes('c') ? String(hits.length) : hits.join('\n'), code: hits.length ? 0 : 1 };
    }
    case 'head':
    case 'tail': {
      const nIdx = args.indexOf('-n');
      const n = nIdx >= 0 ? Number(args[nIdx + 1]) : Number(args.find((a) => /^-\d+$/.test(a))?.slice(1) ?? 10);
      return { ok: true, text: (name === 'head' ? lines.slice(0, n) : lines.slice(-n)).join('\n'), code: 0 };
    }
    case 'wc':
      return { ok: true, text: String(input ? lines.length : 0), code: 0 };
    case 'sort':
      return { ok: true, text: [...lines].sort().join('\n'), code: 0 };
    default:
      return { ok: false, text: '', code: 127 };
  }
}

const plainText = (output: Line[]) => output.map((l) => l.map((s) => s.t).join('')).join('\n');

/** Run one line. Time passes on the fake clock (a few seconds per command). */
export function run(state: KitchenState, input: string): KitchenResult {
  const session = state.session;
  if (session) {
    const r = answerSession(state, input);
    if (!r.state.session) r.state = { ...r.state, lastExit: r.exitCode ?? (r.ok ? 0 : 1) };
    return r;
  }
  const raw = input.trim();
  if (raw === '') return ok(state);
  const s = structuredClone(state);
  const timeEvents = tick(s, TICK);
  const r = runLine(s, raw);
  const res = { ...r, events: [...timeEvents, ...r.events] };
  res.state = { ...res.state, lastExit: res.exitCode ?? (res.ok ? 0 : 1) };
  return res;
}

function runLine(state: KitchenState, raw: string): KitchenResult {
  const p = parseShell(raw, {
    vars: (n) => (n === '?' ? String(state.lastExit) : n === 'PWD' ? state.cwd : state.env[n]),
    subst: (inner) => {
      const r = runLine(state, inner);
      return plainText(r.output);
    },
  });
  if (!p.ok) {
    if (p.error === 'unclosedQuote') return fail(state, out('Your quote is not closed. Add the missing quote at the end.'), 'unclosedQuote', { key: 'sim.docker.err.unclosedQuote' });
    return fail(state, out(`bash: syntax error near unexpected token \`${p.near ?? 'newline'}'`), 'syntax', { key: 'sim.docker.err.syntax' }, 2);
  }
  if (p.pipelines.length > 1 || p.pipelines.some((pl) => pl.background)) {
    return fail(state, out('Type one command at a time here.'), 'oneAtATime', { key: 'sim.docker.err.oneAtATime' });
  }
  const pl = p.pipelines[0];
  if (!pl) return ok(state);
  const [first, ...rest] = pl.commands;
  if (!first) return ok(state);
  // `echo $TOKEN | docker login -u you --password-stdin`, `docker ps | grep web`.
  if (rest.length) {
    const next = rest[0]!;
    if (rest.length === 1 && next.words[0] === 'docker' && next.words.includes('--password-stdin')) {
      const src = runSimple(state, first, undefined);
      return runSimple(src.state, next, `${plainText(src.output)}\n`);
    }
    if (rest.every((c) => ['grep', 'head', 'tail', 'wc', 'sort'].includes(c.words[0] ?? ''))) {
      let r = runSimple(state, first, undefined);
      let text = plainText(r.output);
      for (const c of rest) {
        const f = filter(c, text);
        text = f.text;
        r = { ...r, exitCode: f.code, ok: f.code === 0 };
      }
      return { ...r, output: text ? out(text) : [] };
    }
    return fail(state, out('Type one command at a time here.'), 'oneAtATime', { key: 'sim.docker.err.oneAtATime' });
  }
  return runSimple(state, first, undefined);
}

function runSimple(state: KitchenState, cmd: SimpleCommand, stdin: string | undefined): KitchenResult {
  const [name, ...args] = cmd.words;
  if (!name) {
    if (cmd.assigns.length) {
      const s = structuredClone(state);
      for (const [k, v] of cmd.assigns) s.env[k] = v;
      return ok(s);
    }
    return ok(state);
  }
  const raw = cmd.words.join(' ');
  const redirect = cmd.redirects.find((r) => r.fd === 1 && !r.target.startsWith('&')) ?? null;
  if (name === 'echo') return echo(state, args, redirect ? { target: redirect.target, append: redirect.append } : null);
  if (name === 'true') return ok(state);
  if (name === 'false') return { ...fail(state, [], 'false'), stopped: true };
  if (name === 'exit') return ok(state, [], [], { key: 'sim.docker.explain.exitLaptop' });
  let r: KitchenResult;
  if (name === 'docker') {
    const s = structuredClone(state);
    // docker run/exec/compose with env from `A=1 docker ...` is rare; assignments become host env for this one command.
    for (const [k, v] of cmd.assigns) s.env[k] = v;
    r = runDocker(s, args, { raw, stdin });
  } else if (HOST_COMMANDS[name]) {
    r = HOST_COMMANDS[name]!(state, args, { raw, stdin });
    if (name === 'sleep' && r.ok) {
      const s = structuredClone(r.state);
      const ev = tick(s, Number(args[0] ?? 0));
      r = { ...r, state: s, events: [...r.events, ...ev] };
    }
  } else if (name.startsWith('./') || name.startsWith('/') || ((name === 'bash' || name === 'sh') && args[0])) {
    r = runScriptFile(state, name === 'bash' || name === 'sh' ? args[0]! : name, name === 'bash' || name === 'sh');
  } else {
    const suggestion = closest(name, KNOWN_HOST);
    return fail(state, out(`${name}: command not found`), 'unknownCommand', suggestion ? { key: 'sim.docker.err.unknownCmdDidYouMean', params: { cmd: name, suggestion } } : { key: 'sim.docker.err.unknownCmd', params: { cmd: name } }, 127);
  }
  if (redirect && r.ok && name !== 'echo') {
    const s = structuredClone(r.state);
    const abs = resolve(s, redirect.target);
    s.fs.files[abs] = (redirect.append ? (s.fs.files[abs] ?? '') : '') + plainText(r.output) + (r.output.length ? '\n' : '');
    return { ...r, state: s, output: [] };
  }
  return r;
}

/** `./hello.sh` or `bash hello.sh`: run the lines (needs the x bit for ./). */
function runScriptFile(state: KitchenState, file: string, viaShell: boolean): KitchenResult {
  const abs = resolve(state, file);
  const text = state.fs.files[abs];
  if (text === undefined) return fail(state, out(`bash: ${file}: No such file or directory`), 'noSuchPath', { key: 'sim.docker.err.noSuchPath', params: { path: file } }, 127);
  if (!viaShell && !(state.fs.modes[abs] ?? '').includes('x')) {
    return fail(state, out(`bash: ${file}: Permission denied`), 'permissionDenied', { key: 'sim.docker.err.notExecutable', params: { file } }, 126);
  }
  let s = state;
  const output: Line[] = [];
  let code = 0;
  for (const l of text.split('\n')) {
    const t = l.trim();
    if (!t || t.startsWith('#')) continue;
    const m = /^exit\s+(\d+)$/.exec(t);
    if (m) {
      code = Number(m[1]);
      break;
    }
    const r = runLine(s, t);
    output.push(...r.output);
    s = r.state;
    code = r.exitCode ?? (r.ok ? 0 : 1);
  }
  return { state: s, output, events: [], ok: code === 0, exitCode: code, explain: { key: 'sim.docker.explain.script', params: { file, code: String(code) } } };
}

/** Input while a program waits: a shell in a container, a REPL, an attached run, a password, a y/N. */
function answerSession(state: KitchenState, input: string): KitchenResult {
  const ses = state.session!;
  const s = structuredClone(state);
  const text = input.trim();
  if (ses.kind === 'password') {
    s.session = null;
    return loginWith(s, ses.registry, ses.user, text, false);
  }
  if (ses.kind === 'confirm') {
    s.session = null;
    if (/^y(es)?$/i.test(text)) {
      const words = ses.command.split(/\s+/).slice(1);
      return runDocker(s, words, { raw: ses.command });
    }
    return ok(s, [], [], { key: 'sim.docker.explain.pruneCancelled' });
  }
  if (ses.kind === 'attached') {
    // Any key here is Ctrl+C: the container (or the compose project) stops.
    s.session = null;
    const lines: Line[] = [line('^C')];
    const events = [];
    if (ses.compose) {
      lines.push(line('Gracefully stopping... (press Ctrl+C again to force)'), [{ t: `[+] stop ${ses.containers.length}/${ses.containers.length}`, c: 'blue' }]);
      for (const id of [...ses.containers].reverse()) {
        const c = s.containers[id];
        if (!c) continue;
        events.push(...stopContainer(s, c, {}));
        lines.push([{ t: ` ✔ Container ${c.name} Stopped`, c: 'green' }]);
      }
      return ok(s, lines, events, { key: 'sim.docker.explain.ctrlC' });
    }
    for (const id of ses.containers) {
      const c = s.containers[id];
      if (!c) continue;
      const before = c.logs.length;
      if (c.proc?.kind === 'nginx') {
        const nt = nginxTime(s.clock);
        c.logs.push({ t: s.clock, s: 'e', text: `${nt} [notice] 1#1: signal 2 (SIGINT) received, exiting` });
        for (let i = 0; i < s.host.cpus; i++) c.logs.push({ t: s.clock, s: 'e', text: `${nt} [notice] ${20 + i}#${20 + i}: exiting` }, { t: s.clock, s: 'e', text: `${nt} [notice] ${20 + i}#${20 + i}: exit` });
        c.logs.push({ t: s.clock, s: 'e', text: `${nt} [notice] 1#1: exit` });
      }
      const code = c.proc?.kind === 'nginx' || c.proc?.kind === 'postgres' || c.proc?.kind === 'redis' ? 0 : 130;
      events.push(...exitContainer(s, c, code));
      lines.push(...c.logs.slice(before).map((l) => line(l.text)));
    }
    return { ...ok(s, lines, events, { key: 'sim.docker.explain.ctrlC' }), exitCode: 0 };
  }
  const c = s.containers[ses.container];
  if (!c || c.status !== 'running') {
    s.session = null;
    return ok(s);
  }
  if (ses.kind === 'repl') {
    if (['.exit', 'exit()', 'quit()', 'exit', '.quit'].includes(text)) {
      s.session = null;
      return ses.main ? { ...ok(s, [], exitContainer(s, c, 0)) } : ok(s);
    }
    const r = ses.lang === 'node' ? evalJs(text) : evalPy(text);
    const lines: Line[] = [];
    if (r.out !== null) lines.push(...out(r.out));
    if (r.err) lines.push(...out(r.err));
    if (ses.lang === 'node' && /^console\.log/.test(text)) lines.push(line('undefined'));
    if (r.out === null && !r.err && text) lines.push(line(ses.lang === 'node' ? 'undefined' : ''));
    return { ...ok(s, lines), prompt: ses.lang === 'node' ? '> ' : '>>> ' };
  }
  // A shell inside the container.
  if (!text) return { ...ok(s), prompt: shellPrompt(s) };
  const ctx = makeCtx(s, c, { user: ses.user, cwd: ses.cwd, tty: true });
  const r = runScript(ctx, text);
  const lines = [...r.out, ...r.err].map((l) => line(l));
  if (r.exit) {
    s.session = null;
    const events = ses.main ? exitContainer(s, c, r.code) : [];
    return { ...ok(s, lines, [...ctx.events, ...events], { key: ses.main ? 'sim.docker.explain.shellExitMain' : 'sim.docker.explain.shellExit', params: { name: c.name, code: String(r.code) } }), exitCode: r.code };
  }
  s.session = { ...ses, cwd: ctx.cwd };
  const res: KitchenResult = { state: s, output: lines, events: ctx.events, ok: r.code === 0, exitCode: r.code, prompt: shellPrompt(s) };
  if (r.code === 127 && /^docker\b/.test(text)) res.explain = { key: 'sim.docker.err.dockerInside' };
  return res;
}

/** Run several lines in a row. */
export function runAll(state: KitchenState, inputs: string[]): { state: KitchenState; results: KitchenResult[] } {
  const results: KitchenResult[] = [];
  let cur = state;
  for (const i of inputs) {
    const r = run(cur, i);
    results.push(r);
    cur = r.state;
  }
  return { state: cur, results };
}

/** The prompt to show now: the laptop's "~/shop $" or the waiting program's. */
export function promptOf(state: KitchenState): { path: string; custom?: string } {
  const ses = state.session;
  if (!ses) return { path: state.cwd === state.home ? '~' : state.cwd.startsWith(`${state.home}/`) ? `~/${state.cwd.slice(state.home.length + 1)}` : state.cwd };
  if (ses.kind === 'shell') return { path: '', custom: shellPrompt(state) };
  if (ses.kind === 'repl') return { path: '', custom: ses.lang === 'node' ? '> ' : '>>> ' };
  if (ses.kind === 'password') return { path: '', custom: 'Password: ' };
  if (ses.kind === 'confirm') return { path: '', custom: 'Are you sure you want to continue? [y/N] ' };
  return { path: '', custom: '^C' };
}
