// Run one line typed in the kubectl practice terminal.
//   const r = run(state, 'kubectl get pods');
//   r.state  → the new state (the old one is never changed)
//   r.output → lines that look like real kubectl 1.37
//   r.events → what happened, for the food-court picture and the Manager's board
//   r.explain → an i18n key for the friendly one-line explanation
import { closest, fail, line, lines } from '../git-sim/output';
import { parseLine } from '../git-sim/parse';
import { tick } from './clock';
import { helm } from './helm';
import { curlOutput, parseCurl } from './kubectl/http';
import { kubectl } from './kubectl';
import { absPath, isDir } from './kubectl/ctx';
import { httpGet } from './network';
import { nodeOnce, nodePrompt, nodeShell, openNodeShell } from './node/shell';
import { currentCluster } from './store';
import type { KubeResult, KubeState } from './types';
import { clone } from './util';

export const SHELL = ['ls', 'cat', 'cd', 'pwd', 'clear', 'curl', 'sleep', 'help', 'kubectl', 'k', 'helm', 'kind', 'ssh', 'docker'];

function shellFail(state: KubeState, text: string, key: string, params: Record<string, string> = {}): KubeResult {
  return fail(state as never, lines(text), key, { key, params }) as unknown as KubeResult;
}

function pretty(state: KubeState, p: string): string {
  return p === state.home ? '~' : p.startsWith(`${state.home}/`) ? `~${p.slice(state.home.length)}` : p;
}

export function prompt(state: KubeState): string {
  return nodePrompt(state) ?? pretty(state, state.cwd);
}

/** The prompt in parts: a path (the laptop, shown as "~/shop $") or a whole custom prompt (a node shell: "root@dev-worker:/# "). */
export function promptParts(state: KubeState): { path: string; custom?: string } {
  const node = nodePrompt(state);
  return node ? { path: '', custom: node } : { path: pretty(state, state.cwd) };
}

/** `docker exec -it NODE bash` → { node, argv: [] }; `docker exec NODE crictl ps` → { node, argv: [crictl, ps] }. */
function dockerExec(args: string[]): { node: string; argv: string[]; shell: boolean } | null {
  if (args[0] !== 'exec') return null;
  let i = 1;
  let tty = false;
  while (i < args.length && args[i]!.startsWith('-')) {
    if (/^-[it]+$/.test(args[i]!) || args[i] === '--interactive' || args[i] === '--tty') tty = tty || /t|tty/.test(args[i]!);
    else if (['-u', '--user', '-w', '--workdir', '-e', '--env'].includes(args[i]!)) i++;
    i++;
  }
  const node = args[i];
  if (!node) return null;
  const argv = args.slice(i + 1);
  const shell = argv.length === 1 && /^(\/bin\/|\/usr\/bin\/)?(bash|sh)$/.test(argv[0]!);
  void tty;
  return { node, argv, shell };
}

export function run(state: KubeState, input: string): KubeResult {
  const raw = input.trim();
  if (!raw) return { state, output: [], events: [], ok: true };
  if (state.shell) return nodeShell(state, raw);
  if (/(^|\s)(&&|\|\||;|\|)(\s|$)/.test(raw)) return shellFail(state, 'Type one command at a time here.', 'kube.err.oneAtATime');
  const parsed = parseLine(raw);
  if (parsed.error === 'unclosedQuote') return shellFail(state, 'Your quote is not closed. Add the missing quote at the end.', 'kube.err.unclosedQuote');
  if (parsed.redirect) return shellFail(state, 'In this practice terminal, > is not available. Run the command on its own.', 'kube.err.redirect');
  const [cmd, ...args] = parsed.words;
  if (!cmd) return { state, output: [], events: [], ok: true };
  switch (cmd) {
    case 'kubectl':
    case 'k':
      return kubectl(state, args, raw);
    case 'helm':
      return helm(state, args);
    case 'ssh': {
      const host = args.find((a) => !a.startsWith('-'));
      if (!host) return shellFail(state, 'usage: ssh destination', 'k9.err.sshUsage');
      if (args.filter((a) => !a.startsWith('-')).length > 1) return { state, output: [line(`# ssh ${host} <command>: open the node shell first (ssh ${host}), then type the command`, 'dim')], events: [], ok: false, stopped: true, explain: { key: 'k9.explain.sshOneCommand', params: { node: host } } };
      return openNodeShell(state, host, 'ssh');
    }
    case 'docker': {
      const ex = dockerExec(args);
      if (!ex) return { state, output: [line(`# docker ${args.join(' ')}: this practice terminal only does docker exec into a kind node`, 'dim')], events: [], ok: false, stopped: true, explain: { key: 'k9.explain.dockerOnlyExec' } };
      if (ex.shell) return openNodeShell(state, ex.node, 'docker');
      if (!ex.argv.length) return shellFail(state, '"docker exec" requires at least 2 arguments.', 'k9.err.dockerExecUsage');
      return nodeOnce(state, ex.node, ex.argv, raw);
    }
    case 'kind':
      return { state, output: [line(`# kind ${args.join(' ')}: shown in the lesson, not run in this practice terminal`, 'dim')], events: [], ok: false, stopped: true, explain: { key: 'kube.explain.notInSim', params: { cmd: 'kind' } } };
    case 'clear':
      return { state, output: [], events: [{ type: 'cleared' }], ok: true };
    case 'pwd':
      return { state, output: [line(state.cwd)], events: [], ok: true, explain: { key: 'kube.explain.pwd' } };
    case 'help':
      return { state, output: lines('Try: kubectl get pods · kubectl get nodes · kubectl describe pod <name> · kubectl apply -f <file>\nAlso: ls, cat <file>, cd <folder>, curl <url>, sleep <seconds>, clear'), events: [], ok: true, explain: { key: 'kube.explain.help' } };
    case 'ls': {
      const target = absPath(state, args.find((a) => !a.startsWith('-')) ?? '.');
      if (state.files[target] !== undefined) return { state, output: [line(args.find((a) => !a.startsWith('-')) ?? target)], events: [], ok: true };
      if (!isDir(state, target)) return shellFail(state, `ls: cannot access '${args[0]}': No such file or directory`, 'kube.err.noFile', { file: args[0] ?? '' });
      const names = new Set<string>();
      for (const f of Object.keys(state.files)) if (f.startsWith(`${target}/`)) names.add(f.slice(target.length + 1).split('/')[0]!);
      for (const d of state.dirs) if (d.startsWith(`${target}/`)) names.add(d.slice(target.length + 1).split('/')[0]!);
      return { state, output: names.size ? [line([...names].sort().join('  '))] : [], events: [], ok: true, explain: { key: 'kube.explain.ls' } };
    }
    case 'cat': {
      if (!args[0]) return shellFail(state, 'cat: missing file name', 'kube.err.catUsage');
      const p = absPath(state, args[0]);
      const content = state.files[p];
      if (content === undefined) {
        if (isDir(state, p)) return shellFail(state, `cat: ${args[0]}: Is a directory`, 'kube.err.catDir', { file: args[0] });
        return shellFail(state, `cat: ${args[0]}: No such file or directory`, 'kube.err.noFile', { file: args[0] });
      }
      return { state, output: lines(content.replace(/\n$/, '')), events: [], ok: true, explain: { key: 'kube.explain.cat', params: { file: args[0] } } };
    }
    case 'cd': {
      const target = absPath(state, args[0] ?? '~');
      if (!isDir(state, target) && target !== state.home) return shellFail(state, `bash: cd: ${args[0]}: No such file or directory`, 'kube.err.noDir', { dir: args[0] ?? '' });
      const s = clone(state);
      s.cwd = target;
      return { state: s, output: [], events: [], ok: true, explain: { key: 'kube.explain.cd', params: { dir: pretty(s, target) } } };
    }
    case 'sleep': {
      const n = Math.min(600, Math.max(0, Number(String(args[0] ?? '1').replace(/s$/, '')) || 0));
      const r = tick(state, n);
      return { state: r.state, output: [], events: r.events, ok: true, explain: { key: 'kube.explain.sleep', params: { n: String(n) } } };
    }
    case 'curl': {
      const o = parseCurl(args);
      if ('error' in o) return shellFail(state, o.error, 'kube.err.curlUsage');
      const s = clone(state);
      const c = currentCluster(s);
      if (!c) return shellFail(state, `curl: (6) Could not resolve host: ${o.url}`, 'kube.err.curlDns');
      const ev: KubeResult['events'] = [];
      const r = httpGet({ state: s, c, ev }, { kind: 'laptop', context: s.currentContext }, o.url, { ...(o.host ? { hostHeader: o.host } : {}), events: ev });
      const out = curlOutput(o, r, s.clock, false);
      const fwd = /^(https?:\/\/)?(localhost|127\.0\.0\.1)/.test(o.url);
      const key = out.code === 0 ? (r.status && r.status >= 400 ? (r.error === 'noRoute' ? 'kube.explain.curl404' : r.error === 'noEndpoints' ? 'kube.explain.curl503' : 'kube.explain.curlError') : 'kube.explain.curl') : r.error === 'dns' ? 'kube.err.curlDns' : r.error === 'timeout' ? 'kube.err.curlTimeout' : fwd ? 'kube.err.curlNoForward' : 'kube.err.curlRefused';
      return { state: s, output: lines(out.lines.join('\n') || '').filter((l, _i, a) => !(a.length === 1 && l[0]?.t === '')), events: ev, ok: out.code === 0, ...(out.code ? { exitCode: out.code, stopped: true } : {}), explain: { key, params: { url: o.url, status: String(r.status ?? '') } } };
    }
    default: {
      const near = closest(cmd, SHELL);
      return shellFail(state, `${cmd}: command not found`, near ? 'kube.err.unknownCmdDidYouMean' : 'kube.err.unknownCmd', { cmd, suggestion: near ?? '' });
    }
  }
}

/** Run several lines in a row; returns the final state and every result. */
export function runAll(state: KubeState, inputs: string[]): { state: KubeState; results: KubeResult[] } {
  const results: KubeResult[] = [];
  let cur = state;
  for (const i of inputs) {
    const r = run(cur, i);
    results.push(r);
    cur = r.state;
  }
  return { state: cur, results };
}
