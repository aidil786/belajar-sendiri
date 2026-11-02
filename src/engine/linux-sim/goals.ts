// Goals for LinuxSim cards: checked after every command.
import { gidName, gidsOf, groupByName, lookup, modeString, uidName, userByName } from './fs';
import { listeners, nginxServe, resolve } from './programs/net';
import { cronLines } from './programs/sys';
import { shellOf } from './shell';
import type { LinuxState } from './types';

export interface LinuxGoal {
  /** Paths that must exist (absolute or ~/…). */
  fileExists?: string[];
  fileMissing?: string[];
  dirExists?: string[];
  /** path → regex the file's text must match. */
  fileContains?: Record<string, string>;
  fileNotContains?: Record<string, string>;
  /** path → "755", "rwxr-xr-x", or "x" (the owner may run it) / "-x" (nobody may run it). */
  fileMode?: Record<string, string>;
  /** path → "user" or "user:group". */
  owner?: Record<string, string>;
  /** Folder the learner is in. */
  cwd?: string;
  /** Who the learner is now (whoami). */
  user?: string;
  serviceActive?: string[];
  serviceInactive?: string[];
  serviceEnabled?: string[];
  serviceDisabled?: string[];
  serviceFailed?: string[];
  portListening?: number[];
  portClosed?: number[];
  /** Regexes on process command lines that must be gone / running. */
  processGone?: string[];
  processRunning?: string[];
  /** script path → its last exit code. */
  scriptExitCode?: Record<string, number>;
  /** Exported variables in the learner's shell: NAME → value (regex). */
  envVar?: Record<string, string>;
  packageInstalled?: string[];
  userExists?: string[];
  /** user → group they must be in. */
  inGroup?: Record<string, string>;
  /** user → regex one of their crontab lines must match. */
  crontabHas?: Record<string, string>;
  /** curl from the server: url → expected status, or { status?, contains? }. */
  reachable?: Record<string, number | { status?: number; contains?: string }>;
  /** /etc/hosts or DNS resolves name → ip. */
  resolves?: Record<string, string>;
  /** Number of jobs in the shell. */
  jobs?: number;
  /** The terminal is free (no program in the foreground). */
  noForeground?: boolean;
  lastExit?: number;
  typed?: string;
  lastTyped?: string;
}

export const LINUX_GOAL_KEYS = [
  'fileExists', 'fileMissing', 'dirExists', 'fileContains', 'fileNotContains', 'fileMode', 'owner', 'cwd', 'user', 'serviceActive', 'serviceInactive',
  'serviceEnabled', 'serviceDisabled', 'serviceFailed', 'portListening', 'portClosed', 'processGone', 'processRunning', 'scriptExitCode', 'envVar',
  'packageInstalled', 'userExists', 'inGroup', 'crontabHas', 'reachable', 'resolves', 'jobs', 'noForeground', 'lastExit', 'typed', 'lastTyped',
] as const;

export interface GoalResult {
  ok: boolean;
  failed: string[];
}

function p(path: string): string {
  return path.startsWith('~/') ? `/home/you/${path.slice(2)}` : path === '~' ? '/home/you' : path;
}

function modeOk(mode: number, want: string): boolean {
  if (/^[0-7]{3,4}$/.test(want)) return (mode & 0o7777) === parseInt(want, 8);
  if (want === 'x') return (mode & 0o100) !== 0;
  if (want === '-x') return (mode & 0o111) === 0;
  if (/^[-rwxsStT]{9}$/.test(want)) return modeString({ type: 'file', mode, uid: 0, gid: 0, mtime: 0 }).slice(1) === want;
  return false;
}

export function checkLinuxGoal(st: LinuxState, goal: LinuxGoal, typed: string[] = []): GoalResult {
  const failed: string[] = [];
  const fail = (k: string) => failed.push(k);
  const node = (path: string) => {
    const f = lookup(st, 'root', p(path), false);
    return f.ok ? f.node : null;
  };
  for (const f of goal.fileExists ?? []) if (!node(f)) fail(`fileExists:${f}`);
  for (const f of goal.fileMissing ?? []) if (node(f)) fail(`fileMissing:${f}`);
  for (const f of goal.dirExists ?? []) if (node(f)?.type !== 'dir') fail(`dirExists:${f}`);
  for (const [f, re] of Object.entries(goal.fileContains ?? {})) if (!new RegExp(re, 'm').test(node(f)?.content ?? '\u0000')) fail(`fileContains:${f}`);
  for (const [f, re] of Object.entries(goal.fileNotContains ?? {})) if (new RegExp(re, 'm').test(node(f)?.content ?? '')) fail(`fileNotContains:${f}`);
  for (const [f, want] of Object.entries(goal.fileMode ?? {})) {
    const n = node(f);
    if (!n || !modeOk(n.mode, want)) fail(`fileMode:${f}`);
  }
  for (const [f, want] of Object.entries(goal.owner ?? {})) {
    const n = node(f);
    const [u, g] = want.split(':');
    if (!n || uidName(st, n.uid) !== u || (g && gidName(st, n.gid) !== g)) fail(`owner:${f}`);
  }
  const sh = shellOf(st);
  if (goal.cwd !== undefined && sh.cwd !== p(goal.cwd)) fail('cwd');
  if (goal.user !== undefined && sh.user !== goal.user) fail('user');
  for (const s of goal.serviceActive ?? []) if (st.services[s]?.active !== 'active') fail(`serviceActive:${s}`);
  for (const s of goal.serviceInactive ?? []) if (st.services[s]?.active === 'active') fail(`serviceInactive:${s}`);
  for (const s of goal.serviceFailed ?? []) if (st.services[s]?.active !== 'failed') fail(`serviceFailed:${s}`);
  for (const s of goal.serviceEnabled ?? []) if (!st.services[s]?.enabled) fail(`serviceEnabled:${s}`);
  for (const s of goal.serviceDisabled ?? []) if (st.services[s]?.enabled !== false) fail(`serviceDisabled:${s}`);
  const ports = new Set(listeners(st).map((l) => l.port));
  for (const port of goal.portListening ?? []) if (!ports.has(port)) fail(`portListening:${port}`);
  for (const port of goal.portClosed ?? []) if (ports.has(port)) fail(`portClosed:${port}`);
  const procs = Object.values(st.procs);
  for (const re of goal.processGone ?? []) if (procs.some((x) => new RegExp(re).test(x.args))) fail(`processGone:${re}`);
  for (const re of goal.processRunning ?? []) if (!procs.some((x) => new RegExp(re).test(x.args) && x.state !== 'T')) fail(`processRunning:${re}`);
  for (const [f, code] of Object.entries(goal.scriptExitCode ?? {})) if (st.scriptExits[p(f)] !== code) fail(`scriptExitCode:${f}`);
  for (const [k, re] of Object.entries(goal.envVar ?? {})) if (!sh.exported.includes(k) || !new RegExp(`^(?:${re})$`).test(sh.vars[k] ?? '')) fail(`envVar:${k}`);
  for (const pkg of goal.packageInstalled ?? []) if (!st.apt.installed[pkg]) fail(`packageInstalled:${pkg}`);
  for (const u of goal.userExists ?? []) if (!userByName(st, u)) fail(`userExists:${u}`);
  for (const [u, g] of Object.entries(goal.inGroup ?? {})) {
    const grp = groupByName(st, g);
    if (!grp || !gidsOf(st, u).includes(grp.gid)) fail(`inGroup:${u}`);
  }
  for (const [u, re] of Object.entries(goal.crontabHas ?? {})) {
    const text = st.fs[`/var/spool/cron/crontabs/${u}`]?.content ?? '';
    if (!cronLines(text).some((l) => new RegExp(re).test(l))) fail(`crontabHas:${u}`);
  }
  for (const [url, want] of Object.entries(goal.reachable ?? {})) {
    const status = fetchStatus(st, url);
    const w = typeof want === 'number' ? { status: want } : want;
    if (status === null || (w.status !== undefined && status.status !== w.status) || (w.contains && !status.body.includes(w.contains))) fail(`reachable:${url}`);
  }
  for (const [name, ip] of Object.entries(goal.resolves ?? {})) if (resolve(st, name) !== ip) fail(`resolves:${name}`);
  if (goal.jobs !== undefined && st.jobs.filter((j) => j.state === 'Running' || j.state === 'Stopped').length !== goal.jobs) fail('jobs');
  if (goal.noForeground && st.fg) fail('noForeground');
  if (goal.lastExit !== undefined && st.lastExit !== goal.lastExit) fail('lastExit');
  if (goal.typed && !typed.some((t) => new RegExp(goal.typed!).test(t))) fail('typed');
  if (goal.lastTyped && !new RegExp(goal.lastTyped).test(typed[typed.length - 1] ?? '')) fail('lastTyped');
  return { ok: failed.length === 0, failed };
}

/** What http://host[:port]/path answers from the server (nginx and local listeners). */
function fetchStatus(st: LinuxState, url: string): { status: number; body: string } | null {
  const m = /^(?:https?:\/\/)?([^/:]+)(?::(\d+))?(\/.*)?$/.exec(url);
  if (!m) return null;
  const ip = resolve(st, m[1]!);
  if (!ip) return null;
  const port = Number(m[2] ?? 80);
  const path = m[3] ?? '/';
  const local = ip.startsWith('127.') || st.net.ifaces.some((i) => i.ipv4 === ip);
  if (local) {
    const l = listeners(st).find((x) => x.port === port && (x.addr === '0.0.0.0' || ip.startsWith('127.')));
    if (!l) return null;
    if (l.prog === 'nginx') {
      const page = nginxServe(st, path, port);
      return { status: page.status, body: page.body };
    }
    const prog = st.net.listeners.find((x) => x.pid === l.pids[0]);
    const page = prog?.pages?.[path];
    return page ? { status: page.status, body: page.body } : { status: 404, body: '' };
  }
  const remote = st.net.hosts[ip];
  if (!remote?.up) return null;
  const page = remote.pages?.[path];
  return page ? { status: page.status, body: page.body } : { status: 404, body: '' };
}
