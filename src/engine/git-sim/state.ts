// State helpers. Commands clone the state, change the clone and return it.
import { commitText, textObjectId, treeId } from './hash';
import { basename, dirname, isInside, relative, resolve as resolvePath } from './paths';
import type { Author, Commit, FileMap, Head, LinkedWorktree, Repo, SimState } from './types';

export const DEFAULT_GIT_VERSION = '2.56.0';

export interface CreateOptions {
  home?: string;
  cwd?: string;
  seed?: string;
  /** Start time as unix seconds. Default: 30 Oct 2026, 09:00 in Malaysia. */
  clock?: number;
  tz?: number;
  globalConfig?: Record<string, string>;
}

export function createState(opts: CreateOptions = {}): SimState {
  const home = opts.home ?? '/home/you';
  return {
    fs: { files: {}, dirs: ['/', '/home', home] },
    cwd: opts.cwd ?? home,
    home,
    globalConfig: { ...(opts.globalConfig ?? {}) },
    repos: {},
    servers: {},
    clock: opts.clock ?? Date.UTC(2026, 9, 30, 1, 0, 0) / 1000,
    tz: opts.tz ?? 480,
    seed: opts.seed ?? 'fahamlah',
    counter: 0,
    lastDir: null,
    pending: null,
    gitVersion: DEFAULT_GIT_VERSION,
  };
}

export function clone<T>(value: T): T {
  return structuredClone(value);
}

// ---------------------------------------------------------------------------
// Filesystem

export function dirExists(state: SimState, path: string): boolean {
  return state.fs.dirs.includes(path);
}

export function fileExists(state: SimState, path: string): boolean {
  return Object.hasOwn(state.fs.files, path);
}

/** Make a folder and all its parents. Mutates the given (cloned) state. */
export function ensureDir(state: SimState, path: string): void {
  let p = path;
  const toAdd: string[] = [];
  while (p !== '/' && !dirExists(state, p)) {
    toAdd.push(p);
    p = dirname(p);
  }
  state.fs.dirs.push(...toAdd.reverse());
  state.fs.dirs.sort();
}

export function writeFile(state: SimState, path: string, content: string): void {
  ensureDir(state, dirname(path));
  state.fs.files[path] = content;
}

export function deleteFile(state: SimState, path: string): void {
  delete state.fs.files[path];
}

/** Files and folders directly inside `dir`. */
export function listDir(state: SimState, dir: string): { name: string; isDir: boolean }[] {
  const out = new Map<string, boolean>();
  for (const d of state.fs.dirs) {
    if (d !== dir && dirname(d) === dir) out.set(basename(d), true);
  }
  for (const f of Object.keys(state.fs.files)) {
    if (dirname(f) === dir) out.set(basename(f), false);
  }
  return [...out.entries()]
    .map(([name, isDir]) => ({ name, isDir }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Remove folders above `paths` that became empty, stopping at `root` and never
 * removing the current folder. Git doesn't keep empty folders.
 */
export function pruneEmptyDirs(state: SimState, root: string, paths: string[]): void {
  for (const path of paths) {
    let d = dirname(path);
    while (d !== root && isInside(d, root) && d !== state.cwd && !isInside(state.cwd, d)) {
      const hasChild =
        state.fs.dirs.some((x) => x !== d && dirname(x) === d) ||
        Object.keys(state.fs.files).some((f) => dirname(f) === d);
      if (hasChild) break;
      state.fs.dirs = state.fs.dirs.filter((x) => x !== d);
      d = dirname(d);
    }
  }
}

// ---------------------------------------------------------------------------
// Repos

export function findRepo(state: SimState, cwd = state.cwd): Repo | undefined {
  let best: Repo | undefined;
  let bestRoot = '';
  for (const repo of Object.values(state.repos)) {
    if (isInside(cwd, repo.root) && (!best || repo.root.length > bestRoot.length)) {
      best = repo;
      bestRoot = repo.root;
    }
    for (const wt of Object.values(repo.worktrees ?? {})) {
      if (isInside(cwd, wt.path) && (!best || wt.path.length > bestRoot.length)) {
        best = worktreeView(repo, wt);
        bestRoot = wt.path;
      }
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Linked worktrees: a view that reads and writes HEAD, the index and in-progress
// operations in the worktree, and everything else (commits, refs, config) in the
// main repo. Commands use it like any Repo.

const PER_WORKTREE = new Set<PropertyKey>(['head', 'index', 'detachedFrom', 'reflog', 'conflicts', 'op', 'origHead', 'bisect']);
const MAIN_ROOT = Symbol('mainRoot');

function worktreeView(main: Repo, wt: LinkedWorktree): Repo {
  // The proxy target is an empty object, so frozen states (tests) never trip proxy invariants.
  const m = main as unknown as Record<PropertyKey, unknown>;
  const w = wt as unknown as Record<PropertyKey, unknown>;
  const read = (key: PropertyKey): unknown => (key === 'root' ? wt.path : key === MAIN_ROOT ? main.root : PER_WORKTREE.has(key) ? w[key] : m[key]);
  const keys = () => [...new Set([...Object.keys(main), ...PER_WORKTREE].map(String))];
  return new Proxy({} as Repo, {
    get: (_t, key) => read(key),
    set(_t, key, value) {
      if (key === 'root') return false;
      if (PER_WORKTREE.has(key)) w[key] = value;
      else m[key] = value;
      return true;
    },
    deleteProperty(_t, key) {
      if (PER_WORKTREE.has(key)) delete w[key];
      else delete m[key];
      return true;
    },
    has: (_t, key) => key === MAIN_ROOT || keys().includes(String(key)),
    ownKeys: () => keys(),
    getOwnPropertyDescriptor: (_t, key) =>
      keys().includes(String(key)) ? { value: read(key), writable: true, enumerable: true, configurable: true } : undefined,
  });
}

/** The main repo's root for a linked-worktree view (or the repo's own root). */
export function mainRootOf(repo: Repo): string {
  return ((repo as unknown as Record<PropertyKey, unknown>)[MAIN_ROOT] as string | undefined) ?? repo.root;
}

/** The main repo a (possibly linked-worktree) repo belongs to. */
export function mainRepo(state: SimState, repo: Repo): Repo {
  return state.repos[mainRootOf(repo)] ?? repo;
}

/** Every working folder of a repo with its HEAD: the main one first, then linked ones by path. */
export function allWorktrees(state: SimState, repo: Repo): { path: string; head: Head; linked: boolean; bisect: boolean }[] {
  const main = mainRepo(state, repo);
  const linked = Object.values(main.worktrees ?? {}).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return [
    { path: main.root, head: main.head, linked: false, bisect: Boolean(main.bisect) },
    ...linked.map((w) => ({ path: w.path, head: w.head, linked: true, bisect: Boolean(w.bisect) })),
  ];
}

/** The other working folder that has `branch` checked out (or is bisecting on it), if any. */
export function branchUsedElsewhere(state: SimState, repo: Repo, branch: string): string | null {
  for (const w of allWorktrees(state, repo)) {
    if (w.path === repo.root) continue;
    if (w.head.type === 'branch' && w.head.name === branch) return w.path;
  }
  return null;
}

export function newRepo(root: string, branch: string): Repo {
  return {
    root,
    index: {},
    commits: {},
    branches: {},
    tags: {},
    tagInfo: {},
    head: { type: 'branch', name: branch },
    detachedFrom: null,
    stash: [],
    reflog: [],
    config: {},
    remoteRefs: {},
    remoteHeads: {},
    conflicts: {},
    op: null,
    origHead: null,
  };
}

/** Working files of a repo, keyed by repo-relative path. */
export function workingTree(state: SimState, repo: Repo): FileMap {
  const out: FileMap = {};
  for (const [path, content] of Object.entries(state.fs.files)) {
    if (isInside(path, repo.root) && path !== repo.root) out[relative(path, repo.root)] = content;
  }
  return out;
}

export function headId(repo: Repo): string | null {
  if (repo.head.type === 'detached') return repo.head.commit;
  return repo.branches[repo.head.name] ?? null;
}

export function headTree(repo: Repo): FileMap {
  const id = headId(repo);
  return id ? (repo.commits[id]?.snapshot ?? {}) : {};
}

export function currentBranch(repo: Repo): string | null {
  return repo.head.type === 'branch' ? repo.head.name : null;
}

export function getConfig(state: SimState, repo: Repo | undefined, key: string): string | undefined {
  const k = key.toLowerCase();
  if (repo) {
    const local = Object.entries(repo.config).find(([name]) => name.toLowerCase() === k);
    if (local) return local[1];
  }
  const global = Object.entries(state.globalConfig).find(([name]) => name.toLowerCase() === k);
  return global?.[1];
}

export function identity(state: SimState, repo: Repo): Author | null {
  const name = getConfig(state, repo, 'user.name');
  const email = getConfig(state, repo, 'user.email');
  if (!name || !email) return null;
  return { name, email };
}

/** Walk first parents from `id` (newest first). */
export function history(repo: Repo, id: string | null): Commit[] {
  const out: Commit[] = [];
  let cur = id;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const c = repo.commits[cur];
    if (!c) break;
    out.push(c);
    cur = c.parents[0] ?? null;
  }
  return out;
}

export function isAncestor(repo: Repo, ancestor: string, of: string): boolean {
  const stack = [of];
  const seen = new Set<string>();
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === ancestor) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    stack.push(...(repo.commits[cur]?.parents ?? []));
  }
  return false;
}

/**
 * Create a commit object. Mutates state (counter, clock) and repo (commits).
 * The id is the real SHA-1 of the commit object, so it matches real Git given the
 * same files, parents, identity, dates and message.
 */
export function makeCommit(
  state: SimState,
  repo: Repo,
  data: { message: string; parents: string[]; snapshot: FileMap; author: Author; timestamp?: number; committer?: Author },
): Commit {
  state.counter += 1;
  state.clock += 60;
  // The committer is whoever runs the command (cherry-pick and rebase keep the author).
  const me = repo.config ? identity(state, repo) : null;
  const committer = data.committer ?? me ?? data.author;
  const commit: Commit = {
    id: '',
    parents: [...data.parents],
    message: data.message,
    author: { ...data.author },
    timestamp: data.timestamp ?? state.clock,
    committed: state.clock,
    snapshot: { ...data.snapshot },
  };
  if (committer.name !== data.author.name || committer.email !== data.author.email) commit.committer = { ...committer };
  commit.id = textObjectId('commit', commitObjectText(commit, state.tz));
  repo.commits[commit.id] = commit;
  return commit;
}

/** The commit object's text, exactly as real Git stores it (`git cat-file -p`). */
export function commitObjectText(c: Commit, tz: number): string {
  return commitText({
    tree: treeId(c.snapshot),
    parents: c.parents,
    author: c.author,
    authorTime: c.timestamp,
    committer: c.committer ?? c.author,
    commitTime: commitTime(c),
    tz,
    message: c.message,
  });
}

/** Committer time: what `git log` sorts by. */
export function commitTime(c: Commit): number {
  return c.committed ?? c.timestamp;
}

/** Paths Git tracks: the index plus unresolved conflicts. */
export function trackedPaths(repo: Repo): string[] {
  return [...new Set([...Object.keys(repo.index), ...Object.keys(repo.conflicts)])].sort();
}

export function hasConflicts(repo: Repo): boolean {
  return Object.keys(repo.conflicts).length > 0;
}

// ---------------------------------------------------------------------------
// Remotes and upstreams (stored in the repo config, like real Git)

/** Remote names, sorted (like `git remote`). */
export function remoteNames(repo: Repo): string[] {
  const names = new Set<string>();
  for (const key of Object.keys(repo.config)) {
    const m = /^remote\.(.+)\.url$/.exec(key);
    if (m) names.add(m[1]!);
  }
  return [...names].sort();
}

export function remoteUrl(repo: Repo, name: string): string | undefined {
  return repo.config[`remote.${name}.url`];
}

export interface Upstream {
  remote: string;
  branch: string; // branch name on the remote
  ref: string; // remote-tracking ref, e.g. "origin/main" (or the local branch for remote ".")
}

/** The upstream of a local branch (branch.<b>.remote + branch.<b>.merge), if set. */
export function upstreamOf(repo: Repo, branch: string): Upstream | null {
  const remote = repo.config[`branch.${branch}.remote`];
  const merge = repo.config[`branch.${branch}.merge`];
  if (!remote || !merge) return null;
  const name = merge.replace(/^refs\/heads\//, '');
  return { remote, branch: name, ref: remote === '.' ? name : `${remote}/${name}` };
}

export function setUpstream(repo: Repo, branch: string, remote: string, remoteBranch: string): void {
  repo.config[`branch.${branch}.remote`] = remote;
  repo.config[`branch.${branch}.merge`] = `refs/heads/${remoteBranch}`;
}

export function unsetUpstream(repo: Repo, branch: string): void {
  delete repo.config[`branch.${branch}.remote`];
  delete repo.config[`branch.${branch}.merge`];
}

/** Tip of an upstream ref (remote-tracking or local), or null if it is gone. */
export function upstreamTip(repo: Repo, up: Upstream): string | null {
  return (up.remote === '.' ? repo.branches[up.ref] : repo.remoteRefs[up.ref]) ?? null;
}

/** Point HEAD (and its branch) at `id`, and write a reflog line. */
export function moveHead(repo: Repo, id: string, reflogMessage: string): void {
  if (repo.head.type === 'branch') repo.branches[repo.head.name] = id;
  else repo.head = { type: 'detached', commit: id };
  repo.reflog.unshift({ commit: id, message: reflogMessage });
}

export function subject(message: string): string {
  return message.split('\n')[0] ?? '';
}

// ---------------------------------------------------------------------------
// .gitignore (a simple, faithful subset)

function globToRegex(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i]!;
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        re += '.*';
        i++;
        if (glob[i + 1] === '/') i++;
      } else re += '[^/]*';
    } else if (ch === '?') re += '[^/]';
    else re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

interface IgnoreRule {
  negate: boolean;
  dirOnly: boolean;
  anchored: boolean;
  re: RegExp;
}

export function parseIgnore(content: string): IgnoreRule[] {
  const rules: IgnoreRule[] = [];
  for (const raw of content.split('\n')) {
    let line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const negate = line.startsWith('!');
    if (negate) line = line.slice(1);
    const dirOnly = line.endsWith('/');
    if (dirOnly) line = line.slice(0, -1);
    const anchored = line.includes('/');
    if (line.startsWith('/')) line = line.slice(1);
    rules.push({ negate, dirOnly, anchored, re: globToRegex(line) });
  }
  return rules;
}

/** Is a repo-relative file path ignored by the root .gitignore? */
export function isIgnored(rules: IgnoreRule[], path: string): boolean {
  const parts = path.split('/');
  let ignored = false;
  for (const rule of rules) {
    let hit = false;
    // Check each parent folder, then the file itself.
    for (let i = 1; i <= parts.length; i++) {
      const isDir = i < parts.length;
      if (rule.dirOnly && !isDir) continue;
      const sub = parts.slice(0, i).join('/');
      const name = parts[i - 1]!;
      if (rule.anchored ? rule.re.test(sub) : rule.re.test(name)) {
        hit = true;
        break;
      }
    }
    if (hit) ignored = !rule.negate;
  }
  return ignored;
}

export function ignoreRules(state: SimState, repo: Repo): IgnoreRule[] {
  const content = state.fs.files[`${repo.root}/.gitignore`];
  return content ? parseIgnore(content) : [];
}

// ---------------------------------------------------------------------------
// Dates

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Format like Git: "Fri Oct 30 09:00:00 2026 +0800". */
export function gitDate(unix: number, tz: number): string {
  const d = new Date((unix + tz * 60) * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const sign = tz >= 0 ? '+' : '-';
  const off = Math.abs(tz);
  return (
    `${DAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} ` +
    `${d.getUTCFullYear()} ${sign}${pad(Math.floor(off / 60))}${pad(off % 60)}`
  );
}

/** Names inside the folder a partly typed path points at (folders end with "/"). For Tab. */
export function listDirNames(state: SimState, partial: string): string[] {
  const dirPart = partial.includes('/') ? partial.slice(0, partial.lastIndexOf('/') + 1) : '';
  const dir = dirPart ? resolvePath(state.cwd, dirPart, state.home) : state.cwd;
  return listDir(state, dir).map((e) => (e.isDir ? `${e.name}/` : e.name));
}
