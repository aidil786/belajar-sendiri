// Push/pull courier: the pure logic behind the Courier interactive.
// It runs the courier's actions (push, fetch, pull, a new commit, a teammate's push)
// in the Git engine, works out what the courier carried, and describes both sides
// ("Your laptop" and "GitHub") for drawing. No DOM, no React: unit-tested in courier.test.ts.
import {
  checkGoal,
  edit,
  findRepo,
  findServer,
  plain,
  prettyPath,
  remoteUrl,
  run,
  shortHash,
  subject,
  upstreamOf,
  type CommandResult,
  type Commit,
  type Explain,
  type Goal,
  type Repo,
  type Server,
  type SimState,
} from '~/engine/git-sim';
import { reachable, walk } from '~/engine/git-sim/refs';

// ---------------------------------------------------------------------------
// Props-level types

/** Built-in action buttons. Anything else is written as `{ cmd, label? }`. */
export type ActionId = 'push' | 'fetch' | 'pull' | 'commit' | 'teammate';
export type ActionSpec = ActionId | { cmd: string; label?: string };

/** One commit made by the "Make a commit" button or by the teammate. */
export interface CommitSpec {
  /** File to change, relative to the repo root. */
  file: string;
  message: string;
  /** Text added at the end of the file (default: a short line). */
  append?: string;
  /** Or: the whole new content of the file. */
  content?: string;
}

export interface TeammateSpec {
  name: string;
  /** Absolute folder of the teammate's clone, e.g. /home/aisyah/diary. */
  dir: string;
  /** Their commits, in order. Without a list, each push adds a small note file. */
  commits?: CommitSpec[];
}

/** Engine goals plus `serverTags`: tags that must be on the courier's GitHub repo. */
export interface CourierGoal extends Goal {
  serverTags?: string[];
}

export const ACTION_IDS: ActionId[] = ['push', 'fetch', 'pull', 'commit', 'teammate'];
const BUILT_IN_CMD: Record<'push' | 'fetch' | 'pull', string> = { push: 'git push', fetch: 'git fetch', pull: 'git pull' };

/** Demo steps: a Git command, or `@commit` / `@teammate`. */
export type DemoStep = string;

// ---------------------------------------------------------------------------
// Results

export interface TripCommit {
  id: string;
  short: string;
  message: string;
}

/** What the courier does after an action. */
export interface Trip {
  /** up: towards GitHub; down: towards your laptop. */
  dir: 'up' | 'down';
  /** Who sends the parcel. */
  from: 'laptop' | 'github' | 'teammate';
  commits: TripCommit[];
  /** Tags that travelled with it. */
  tags: string[];
  /** GitHub said no: the parcel comes back. */
  bounced: boolean;
  /** A forced push: commits GitHub no longer has on that branch. */
  dropped: TripCommit[];
}

export interface StepLine {
  /** Prompt folder, e.g. "~/diary" or "/home/aisyah/diary". */
  where: string;
  cmd: string;
  output: string;
}

export interface ActionResult {
  state: SimState;
  /** false: Git refused or failed (a rejected push, a pull that needs a choice...). */
  ok: boolean;
  /** Git stopped for the learner (a conflict). Not a mistake. */
  stopped: boolean;
  lines: StepLine[];
  /** Friendly explanation: an i18n key (engine keys, or courier.* keys). */
  explain: Explain | null;
  trip: Trip | null;
  /** Commands the learner "typed" (for goals with typed / lastTyped). */
  typed: string[];
  /** Updated counters for the next commit / teammate push. */
  mineUsed: number;
  teamUsed: number;
}

export interface Counters {
  mineUsed: number;
  teamUsed: number;
}

export interface CourierOptions {
  mine?: CommitSpec[] | undefined;
  teammate?: TeammateSpec | undefined;
}

// ---------------------------------------------------------------------------
// Helpers

/** The command and default label of an action. */
export function actionCommand(a: ActionSpec): string | null {
  if (typeof a !== 'string') return a.cmd;
  if (a === 'push' || a === 'fetch' || a === 'pull') return BUILT_IN_CMD[a];
  return null;
}

export function mineSpec(opts: CourierOptions, i: number): CommitSpec | null {
  if (opts.mine) return opts.mine[i] ?? null;
  return { file: `entry-${i + 1}.txt`, content: `Entry ${i + 1}\n`, message: `Add entry ${i + 1}` };
}

export function teammateSpec(opts: CourierOptions, i: number): CommitSpec | null {
  const tm = opts.teammate;
  if (!tm) return null;
  if (tm.commits) return tm.commits[i] ?? null;
  const slug = tm.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'teammate';
  return { file: `${slug}-${i + 1}.txt`, content: `${tm.name} was here.\n`, message: `Add ${tm.name}'s note ${i + 1}` };
}

const quote = (s: string) => `"${s.replace(/(["\\])/g, '\\$1')}"`;

function tripCommit(c: Commit): TripCommit {
  return { id: c.id, short: shortHash(c.id), message: subject(c.message) };
}

/** Every commit any hosted repo can reach (branches and tags), by id. */
function serverReach(state: SimState): Map<string, Commit> {
  const out = new Map<string, Commit>();
  for (const s of Object.values(state.servers)) {
    for (const id of reachable(s.commits, [...Object.values(s.branches), ...Object.values(s.tags)])) out.set(id, s.commits[id]!);
  }
  return out;
}

/** Commits a repo can reach from all its refs (local, remote-tracking, tags). */
function repoReach(repo: Repo | undefined, onlyRemote = false): Set<string> {
  if (!repo) return new Set();
  const tips = [...Object.values(repo.remoteRefs), ...(onlyRemote ? [] : [...Object.values(repo.branches), ...Object.values(repo.tags)])];
  return reachable(repo.commits, tips);
}

function sortNewest(list: Commit[]): Commit[] {
  return [...list].sort((a, b) => (b.committed ?? b.timestamp) - (a.committed ?? a.timestamp));
}

/** Work out what the courier carried, from the states before and after one command. */
export function tripFor(before: SimState, after: SimState, r: CommandResult, from: 'laptop' | 'teammate' = 'laptop'): Trip | null {
  const pushed = r.events.find((e) => e.type === 'pushed');
  const rejected = r.events.some((e) => e.type === 'pushRejected');
  const fetched = r.events.filter((e) => e.type === 'fetched');
  if (pushed || rejected) {
    const was = serverReach(before);
    const now = serverReach(after);
    const commits = sortNewest([...now.values()].filter((c) => !was.has(c.id))).map(tripCommit);
    const dropped: TripCommit[] = [];
    if (pushed && pushed.type === 'pushed' && pushed.updates.some((u) => u.forced)) {
      const server = findServer(after, pushed.url);
      const old = findServer(before, pushed.url);
      if (server && old) {
        const keep = reachable(server.commits, [...Object.values(server.branches), ...Object.values(server.tags)]);
        for (const u of pushed.updates) {
          if (!u.forced || !u.from) continue;
          for (const id of reachable(old.commits, [u.from])) if (!keep.has(id)) dropped.push(tripCommit(old.commits[id]!));
        }
      }
    }
    const tags = pushed && pushed.type === 'pushed' ? pushed.updates.filter((u) => u.ref.startsWith('tags/') && u.to).map((u) => u.ref.slice(5)) : [];
    let tried: TripCommit[] = [];
    if (rejected && !commits.length) {
      // What the courier tried to deliver: your commits that GitHub doesn't have.
      const repo = findRepo(before);
      const tip = repo && repo.head.type === 'branch' ? repo.branches[repo.head.name] : undefined;
      if (repo && tip) tried = walk(repo.commits, [tip]).filter((c) => !was.has(c.id)).map(tripCommit);
    }
    if (!commits.length && !tags.length && !dropped.length && !rejected) return null;
    return { dir: 'up', from, commits: rejected && !commits.length ? tried : commits, tags, bounced: rejected && !pushed, dropped };
  }
  if (fetched.some((e) => e.type === 'fetched' && e.updates.length > 0)) {
    const was = repoReach(findRepo(before));
    const repo = findRepo(after);
    const now = repoReach(repo, true);
    const commits = sortNewest([...now].filter((id) => !was.has(id)).map((id) => repo!.commits[id]!)).map(tripCommit);
    const tags = fetched.flatMap((e) => (e.type === 'fetched' ? e.updates.filter((u) => u.ref.startsWith('tags/') && u.to).map((u) => u.ref.slice(5)) : []));
    if (!commits.length && !tags.length) return null;
    return { dir: 'down', from: 'github', commits, tags, bounced: false, dropped: [] };
  }
  return null;
}

/** Write a commit spec's change into the working folder (paths relative to the repo root). */
function applySpec(state: SimState, spec: CommitSpec): SimState {
  const repo = findRepo(state);
  const abs = `${repo ? repo.root : state.cwd}/${spec.file}`;
  const old = state.fs.files[abs] ?? '';
  const content = spec.content ?? `${old}${spec.append ?? `${spec.message}\n`}`;
  return edit(state, abs, content).state;
}

function line(state: SimState, cmd: string, r: CommandResult): StepLine {
  return { where: prettyPath(state.cwd, state.home), cmd, output: plain(r.output) };
}

/** Run one line in the engine and keep a printable copy. */
function step(state: SimState, cmd: string, lines: StepLine[]): CommandResult {
  const r = run(state, cmd);
  lines.push(line(state, cmd, r));
  return r;
}

// ---------------------------------------------------------------------------
// Actions

/** Run one courier action (a button, or a demo step) and say what happened. */
export function runAction(state: SimState, action: ActionSpec | DemoStep, opts: CourierOptions, counters: Counters): ActionResult {
  const base = { mineUsed: counters.mineUsed, teamUsed: counters.teamUsed };
  const id = typeof action === 'string' && action.startsWith('@') ? action.slice(1) : action;

  if (id === 'commit') {
    const spec = mineSpec(opts, counters.mineUsed);
    if (!spec) return { ...base, state, ok: false, stopped: false, lines: [], explain: { key: 'courier.noMore' }, trip: null, typed: [] };
    const lines: StepLine[] = [];
    let s = applySpec(state, spec);
    const add = step(s, `git add ${spec.file}`, lines);
    s = add.state;
    const cmd = `git commit -m ${quote(spec.message)}`;
    const c = step(s, cmd, lines);
    const ok = add.ok && c.ok;
    return {
      state: ok ? c.state : state,
      ok,
      stopped: false,
      lines,
      explain: ok ? { key: 'courier.committed', params: { message: spec.message } } : (c.explain ?? add.explain ?? null),
      trip: null,
      typed: [`git add ${spec.file}`, cmd],
      mineUsed: counters.mineUsed + (ok ? 1 : 0),
      teamUsed: counters.teamUsed,
    };
  }

  if (id === 'teammate') {
    const tm = opts.teammate;
    const spec = teammateSpec(opts, counters.teamUsed);
    if (!tm || !spec) return { ...base, state, ok: false, stopped: false, lines: [], explain: { key: 'courier.noMore' }, trip: null, typed: [] };
    const home = state.cwd;
    const lines: StepLine[] = [];
    let s = run(state, `cd ${tm.dir}`).state;
    const repo = findRepo(s);
    const branch = repo && repo.head.type === 'branch' ? repo.head.name : 'main';
    // The teammate starts from the latest GitHub version (they have no unpushed work).
    s = run(s, 'git fetch -q').state;
    if (repo && findRepo(s)?.remoteRefs[`origin/${branch}`]) s = run(s, `git reset -q --hard origin/${branch}`).state;
    s = applySpec(s, spec);
    s = run(s, `git add ${spec.file}`).state;
    const c = run(s, `git commit -m ${quote(spec.message)}`);
    const before = c.state;
    const push = c.ok ? step(before, 'git push', lines) : c;
    const back = run(push.state, `cd ${home}`).state;
    const ok = c.ok && push.ok;
    return {
      state: ok ? back : state,
      ok,
      stopped: false,
      lines,
      explain: ok ? { key: 'courier.teammatePushed', params: { name: tm.name, message: spec.message } } : (push.explain ?? null),
      trip: ok ? tripFor(before, push.state, push, 'teammate') : null,
      typed: [],
      mineUsed: counters.mineUsed,
      teamUsed: counters.teamUsed + (ok ? 1 : 0),
    };
  }

  const cmd = typeof action === 'string' ? (actionCommand(action as ActionSpec) ?? action) : action.cmd;
  const lines: StepLine[] = [];
  const r = step(state, cmd, lines);
  return {
    ...base,
    state: r.state,
    ok: r.ok,
    stopped: Boolean(r.stopped),
    lines,
    explain: r.explain ?? null,
    trip: tripFor(state, r.state, r),
    typed: [cmd],
  };
}

/** Is the courier's goal met? Engine goals, plus tags on the GitHub repo. */
export function courierGoalMet(state: SimState, goal: CourierGoal, typed: string[], url?: string): boolean {
  const { serverTags, ...rest } = goal;
  if (Object.keys(rest).length && !checkGoal(state, rest, typed).ok) return false;
  if (serverTags) {
    const server = courierServer(state, url);
    if (!server || !serverTags.every((t) => server.tags[t] !== undefined)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// What to draw

export interface ViewLabel {
  name: string;
  kind: 'branch' | 'remote' | 'tag';
  /** HEAD is on this branch. */
  head?: boolean;
}

export type CommitStatus = 'synced' | 'local' | 'fetched' | 'remote';

export interface ViewCommit {
  id: string;
  short: string;
  message: string;
  /** Author name when it isn't the learner (e.g. "Aisyah"), else null. */
  by: string | null;
  /**
   * Laptop: local = only on your branch (not in origin/main yet), fetched = only in origin/main,
   * synced = both. GitHub: remote = your laptop doesn't have it at all, synced = it does.
   */
  status: CommitStatus;
  labels: ViewLabel[];
}

export interface LaptopView {
  where: string;
  branch: string | null;
  /** e.g. "origin/main" (null: no upstream yet). */
  upstream: string | null;
  ahead: number;
  behind: number;
  hasRemote: boolean;
  commits: ViewCommit[];
  /** Older commits not drawn. */
  more: number;
}

export interface GithubView {
  url: string;
  /** "github.com/you/diary" (what a learner reads). */
  where: string;
  branch: string;
  commits: ViewCommit[];
  more: number;
}

export interface CourierView {
  laptop: LaptopView | null;
  github: GithubView | null;
}

/** The GitHub repo the courier talks to: origin's, else `url`, else the only one. */
export function courierServer(state: SimState, url?: string): Server | undefined {
  const repo = findRepo(state);
  const origin = repo ? remoteUrl(repo, 'origin') : undefined;
  const byOrigin = origin ? findServer(state, origin) : undefined;
  if (byOrigin) return byOrigin;
  if (url) return findServer(state, url);
  const all = Object.values(state.servers);
  return all.length === 1 ? all[0] : undefined;
}

function byWhom(state: SimState, c: Commit): string | null {
  const me = state.globalConfig['user.name'];
  return c.author.name && c.author.name !== me ? c.author.name : null;
}

export function courierView(state: SimState, opts: { url?: string; limit?: number } = {}): CourierView {
  const limit = opts.limit ?? 5;
  const repo = findRepo(state);
  const server = courierServer(state, opts.url);

  let laptop: LaptopView | null = null;
  let trackBranch: string | null = null;
  if (repo) {
    const branch = repo.head.type === 'branch' ? repo.head.name : null;
    const up = branch ? upstreamOf(repo, branch) : null;
    const remoteName = up?.remote && up.remote !== '.' ? up.remote : 'origin';
    trackBranch = up && up.remote !== '.' ? up.branch : branch;
    const trackRef = trackBranch ? `${remoteName}/${trackBranch}` : null;
    const localTip = branch ? (repo.branches[branch] ?? null) : repo.head.type === 'detached' ? repo.head.commit : null;
    const trackTip = trackRef ? (repo.remoteRefs[trackRef] ?? null) : null;
    const onLocal = reachable(repo.commits, [localTip]);
    const onTrack = reachable(repo.commits, [trackTip]);
    const all = walk(repo.commits, [localTip, trackTip].filter((x): x is string => Boolean(x)));
    const tagsAt = new Map<string, string[]>();
    for (const [t, id] of Object.entries(repo.tags)) tagsAt.set(id, [...(tagsAt.get(id) ?? []), t]);
    const commits = all.map((c): ViewCommit => {
      const labels: ViewLabel[] = [];
      if (c.id === localTip && branch) labels.push({ name: branch, kind: 'branch', head: true });
      if (c.id === trackTip && trackRef) labels.push({ name: trackRef, kind: 'remote' });
      for (const t of (tagsAt.get(c.id) ?? []).sort()) labels.push({ name: t, kind: 'tag' });
      const status: CommitStatus = onLocal.has(c.id) && onTrack.has(c.id) ? 'synced' : onLocal.has(c.id) ? 'local' : 'fetched';
      return { id: c.id, short: shortHash(c.id), message: subject(c.message), by: byWhom(state, c), status, labels };
    });
    const counts = { ahead: commits.filter((c) => c.status === 'local').length, behind: commits.filter((c) => c.status === 'fetched').length };
    laptop = {
      where: prettyPath(repo.root, state.home),
      branch,
      upstream: up && up.remote !== '.' ? up.ref : null,
      ...(trackTip ? counts : { ahead: 0, behind: 0 }),
      hasRemote: Object.keys(repo.config).some((k) => /^remote\..+\.url$/.test(k)),
      commits: commits.slice(0, limit),
      more: Math.max(0, commits.length - limit),
    };
  }

  let github: GithubView | null = null;
  if (server) {
    const name = trackBranch && server.branches[trackBranch] !== undefined ? trackBranch : server.head;
    const tip = server.branches[name];
    const known = repoReach(repo);
    const tagsAt = new Map<string, string[]>();
    for (const [t, id] of Object.entries(server.tags)) tagsAt.set(id, [...(tagsAt.get(id) ?? []), t]);
    const all = tip ? walk(server.commits, [tip]) : [];
    const commits = all.map((c): ViewCommit => {
      const labels: ViewLabel[] = [];
      if (c.id === tip) labels.push({ name, kind: 'branch' });
      for (const t of (tagsAt.get(c.id) ?? []).sort()) labels.push({ name: t, kind: 'tag' });
      return { id: c.id, short: shortHash(c.id), message: subject(c.message), by: byWhom(state, c), status: known.has(c.id) ? 'synced' : 'remote', labels };
    });
    github = {
      url: server.url,
      where: server.url.replace(/^https?:\/\//, '').replace(/\.git$/, ''),
      branch: name,
      commits: commits.slice(0, limit),
      more: Math.max(0, commits.length - limit),
    };
  }
  return { laptop, github };
}

/** Ids that are new in `after` compared with `before` (for the arrival glow). */
export function freshIds(before: CourierView, after: CourierView): Set<string> {
  const key = (c: ViewCommit) => `${c.id}:${c.status}`;
  const was = new Set([...(before.laptop?.commits ?? []), ...(before.github?.commits ?? [])].map(key));
  const out = new Set<string>();
  for (const c of [...(after.laptop?.commits ?? []), ...(after.github?.commits ?? [])]) if (!was.has(key(c))) out.add(c.id);
  return out;
}

/** Validate Courier props (used by the MDX checker). Returns readable problems. */
export function checkCourierProps(a: { actions?: unknown; commands?: unknown; teammate?: unknown; mine?: unknown; label?: unknown }): string[] {
  const errors: string[] = [];
  const actions = a.actions as ActionSpec[] | undefined;
  const commands = a.commands as string[] | undefined;
  if (actions !== undefined) {
    if (!Array.isArray(actions)) errors.push('actions must be a list');
    else
      for (const x of actions) {
        if (typeof x === 'string' && !ACTION_IDS.includes(x as ActionId)) errors.push(`unknown action "${x}"`);
        if (typeof x === 'object' && (!x || typeof x.cmd !== 'string' || !x.cmd.startsWith('git '))) errors.push('a custom action needs cmd: "git ..."');
      }
  }
  if (commands !== undefined && (!Array.isArray(commands) || commands.some((c) => typeof c !== 'string'))) errors.push('commands must be a list of strings');
  if (commands?.length && !a.label) errors.push('a demo (commands) needs a label (text alternative)');
  const wantsTeammate = (actions ?? []).includes('teammate') || (commands ?? []).includes('@teammate');
  const tm = a.teammate as TeammateSpec | undefined;
  if (wantsTeammate && (!tm || !tm.name || !tm.dir?.startsWith('/'))) errors.push('the teammate action needs teammate={{ name, dir: "/home/..." }}');
  return errors;
}
