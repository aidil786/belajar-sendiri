// Scenarios: the practice server's starting state for a lesson card, built from steps the
// truth check (npm run verify:linux) can replay on a real Debian 13 machine.
import { absPath, joinPath, parentOf, userByName } from './fs';
import { createMachine, START_CLOCK } from './machine';
import { APT_CATALOG } from './programs/sys';
import { spawn } from './procs';
import { run } from './run';
import { newCtx, shellOf } from './shell';
import type { LinuxState, RemoteHost, WebPage } from './types';

export type LinuxStep =
  /** A command typed by "you" (must succeed). */
  | string
  /** A command run as root (must succeed). */
  | { root: string }
  /** A file (paths under ~ or absolute). `owner` is "user" or "user:group"; `mode` octal like "644". */
  | { write: string; content: string; mode?: string; owner?: string }
  /** A package from the apt catalog (tree, htop, ncdu, jq, unzip), already installed. Real side: dpkg -i. */
  | { install: string }
  /** A program that keeps running in the background (a stuck script). Real side: started with setsid. */
  | { process: { cmd: string; user?: string; busy?: boolean; stubborn?: boolean } }
  /** Engine only: the DNS knows these names (name → IPv4). */
  | { dns: Record<string, string> }
  /** Engine only: a machine on the internet. */
  | { remote: { ip: string } & RemoteHost }
  /** Engine only: a big file that fills the disk (size in bytes). */
  | { bigFile: { path: string; size: number; owner?: string } }
  /** Engine only: a program listening on a port (e.g. a small app on 127.0.0.1:3000). */
  | { listen: { port: number; addr?: string; prog: string; user?: string; cmd?: string; pages?: Record<string, WebPage> } }
  /** Seconds pass. */
  | { wait: number };

export interface LinuxScenario {
  id: string;
  /** Where the learner starts (default /home/you). */
  cwd?: string;
  steps: LinuxStep[];
  /** Command lists the truth check runs in the engine and on real Debian 13 (as "you", from `cwd`). */
  verify?: string[][];
  /** Why the truth check can't run this one (it uses engine-only steps). */
  engineOnly?: string;
  /** Show the network panel in the state picture. */
  network?: boolean;
  /** A model task for this machine (examples and tests): the goal, and commands that reach it. */
  task?: { goal: import('./goals').LinuxGoal; solution: string[] };
}

export const ENGINE_ONLY_STEPS = ['dns', 'remote', 'bigFile', 'listen'] as const;

export function usesEngineOnlySteps(sc: LinuxScenario): boolean {
  return sc.steps.some((s) => typeof s === 'object' && ENGINE_ONLY_STEPS.some((k) => k in s));
}

function home(path: string): string {
  return path.startsWith('~/') ? `/home/you/${path.slice(2)}` : path === '~' ? '/home/you' : path;
}

export class ScenarioError extends Error {}

/** Apply one setup step. Throws when a command fails (scenarios must be valid). */
export function linuxStep(state: LinuxState, step: LinuxStep, id = '?'): LinuxState {
  if (typeof step === 'object' && 'install' in step) {
    if (!APT_CATALOG.some((p) => p.name === step.install)) throw new ScenarioError(`Scenario ${id}: ${step.install} is not in the apt catalog`);
    return linuxStep(state, { root: `apt-get install -y ${step.install}` }, id);
  }
  if (typeof step === 'string' || 'root' in step) {
    const cmd = typeof step === 'string' ? step : step.root;
    let st = state;
    if (typeof step !== 'string') {
      st = structuredClone(state);
      const vars: Record<string, string> = { ...shellOf(st).vars, HOME: '/root', USER: 'root', LOGNAME: 'root', PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin' };
      // Root's own login umask (022), not the learner's.
      delete vars.__UMASK;
      st.shells.push({ ...shellOf(st), user: 'root', vars, exported: [...shellOf(st).exported], login: false });
    }
    // Setup steps run like a script: no terminal, so nothing can stop to ask a question.
    const r = run(st, cmd, { tty: false });
    if (!r.ok) throw new ScenarioError(`Scenario ${id}: step failed: ${cmd}\n${r.output.map((l) => l.map((s) => s.t).join('')).join('\n')}`);
    const next = r.state;
    if (typeof step !== 'string') next.shells.pop();
    next.history = [];
    return next;
  }
  const st = structuredClone(state);
  if ('write' in step) {
    const path = home(step.write);
    const [user, group] = (step.owner ?? 'you').split(':') as [string, string | undefined];
    const u = userByName(st, user);
    if (!u) throw new ScenarioError(`Scenario ${id}: unknown owner ${user}`);
    const gid = group ? st.groups.find((g) => g.name === group)?.gid : u.gid;
    if (gid === undefined) throw new ScenarioError(`Scenario ${id}: unknown group ${group}`);
    // Parent folders must exist (make them with a step first).
    if (!st.fs[parentOf(path)]) throw new ScenarioError(`Scenario ${id}: folder ${parentOf(path)} does not exist for ${path}`);
    st.fs[path] = { type: 'file', mode: parseInt(step.mode ?? '644', 8), uid: u.uid, gid, mtime: st.clock, content: step.content };
    return st;
  }
  if ('process' in step) {
    const ctx = newCtx(st, shellOf(st), false);
    const user = step.process.user ?? 'you';
    spawn(ctx, { args: step.process.cmd, comm: step.process.cmd.split(' ')[0]!.split('/').pop()!, kind: 'script', user, tty: '?', ppid: 1, state: step.process.busy === false ? 'S' : 'R', ...(step.process.stubborn ? { stubborn: true } : {}) });
    return st;
  }
  if ('dns' in step) {
    for (const [name, ip] of Object.entries(step.dns)) st.net.dns[name] = [ip];
    return st;
  }
  if ('remote' in step) {
    const { ip, ...rest } = step.remote;
    st.net.hosts[ip] = rest;
    return st;
  }
  if ('bigFile' in step) {
    const path = home(step.bigFile.path);
    const u = userByName(st, step.bigFile.owner ?? 'root')!;
    let dir = parentOf(path);
    const missing: string[] = [];
    while (!st.fs[dir]) {
      missing.unshift(dir);
      dir = parentOf(dir);
    }
    for (const d of missing) st.fs[d] = { type: 'dir', mode: 0o755, uid: u.uid, gid: u.gid, mtime: st.clock };
    st.fs[path] = { type: 'file', mode: 0o644, uid: u.uid, gid: u.gid, mtime: st.clock, size: step.bigFile.size };
    return st;
  }
  if ('listen' in step) {
    const ctx = newCtx(st, shellOf(st), false);
    const pid = spawn(ctx, { args: step.listen.cmd ?? `${step.listen.prog} -m http.server ${step.listen.port}`, comm: step.listen.prog, kind: 'daemon', user: step.listen.user ?? 'you', tty: '?', ppid: 1 });
    st.net.listeners.push({ port: step.listen.port, addr: step.listen.addr ?? '0.0.0.0', pid, prog: step.listen.prog, ...(step.listen.pages ? { pages: step.listen.pages } : {}) });
    return st;
  }
  if ('wait' in step) {
    st.clock += step.wait;
    return st;
  }
  throw new ScenarioError(`Scenario ${id}: unknown step ${JSON.stringify(step)}`);
}

/** Setup runs a little before the learner arrives; the clock then starts at START_CLOCK. */
export function linuxStart(sc?: LinuxScenario): LinuxState {
  const st = createMachine();
  st.clock = START_CLOCK - 300;
  void sc;
  return st;
}

export function buildLinuxScenario(sc: LinuxScenario): LinuxState {
  let st = linuxStart(sc);
  for (const step of sc.steps) st = linuxStep(st, step, sc.id);
  st.clock = Math.max(st.clock, START_CLOCK);
  st.history = [];
  st.jobs = st.jobs.filter((j) => j.state === 'Running' || j.state === 'Stopped');
  const cwd = sc.cwd ? absPath('/home/you', sc.cwd.replace(/^~(?=\/|$)/, '/home/you')) : '/home/you';
  const sh = shellOf(st);
  sh.cwd = cwd;
  sh.vars.PWD = cwd;
  // Like ~/.profile at login: ~/bin and ~/.local/bin join PATH when they exist.
  for (const d of ['/home/you/bin', '/home/you/.local/bin']) if (st.fs[d]?.type === 'dir') sh.vars.PATH = `${d}:${sh.vars.PATH}`;
  return st;
}

const cache = new Map<string, LinuxState>();

/** Cached build (UI and checks): returns a fresh copy each time. */
export function buildLinuxScenarioCached(sc: LinuxScenario): LinuxState {
  const key = JSON.stringify(sc);
  if (!cache.has(key)) cache.set(key, buildLinuxScenario(sc));
  return structuredClone(cache.get(key)!);
}

export { joinPath };
