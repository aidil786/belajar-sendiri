// Lesson goals: "is the learner's simulator in the state we asked for?"
// Pure and data-driven, so lesson files can describe goals as plain objects.
import { findServer } from './commands/git-remote';
import { reachable, trackingInfo } from './refs';
import { resolveRev } from './revision';
import { findRepo, getConfig, headId, history, mainRepo, remoteUrl, subject, upstreamOf, workingTree } from './state';
import { computeStatus } from './status';
import type { SimState } from './types';

export interface Goal {
  /** These paths are staged (in the box). */
  staged?: string[];
  /** These paths are NOT staged. */
  notStaged?: string[];
  /** These tracked paths have unstaged changes. */
  modified?: string[];
  untracked?: string[];
  /** Working tree and box match HEAD exactly (untracked files allowed unless `noUntracked`). */
  clean?: boolean;
  noUntracked?: boolean;
  /** Number of commits reachable from HEAD. */
  commits?: number;
  minCommits?: number;
  /** Regex the newest commit message must match. */
  lastMessage?: string;
  /** Each commit message from HEAD (newest first) matches the regex at the same index. */
  messages?: string[];
  headDetached?: boolean;
  /** HEAD sits on the commit whose message matches this regex. */
  headAtMessage?: string;
  /** The newest commit is a revert. */
  lastIsRevert?: boolean;
  /** These files exist in the working folder (repo-relative). */
  filesExist?: string[];
  filesMissing?: string[];
  /** File (repo-relative) contains text. */
  fileContains?: Record<string, string>;
  fileNotContains?: Record<string, string>;
  /** The box (index) version of a file contains / doesn't contain text. */
  stagedContains?: Record<string, string>;
  stagedNotContains?: Record<string, string>;
  /** The newest commit contains exactly these files / includes these files. */
  lastCommitFiles?: string[];
  lastCommitHas?: string[];
  lastCommitLacks?: string[];
  /** Absolute folder the learner must be in. */
  cwd?: string;
  /** Absolute paths that must exist as folders. */
  dirsExist?: string[];
  /** A repo exists at this absolute path. */
  repoAt?: string;
  /** Global config values (exact). */
  config?: Record<string, string>;
  /** Global config keys that must be set (any value). */
  configSet?: string[];
  /** At least this many commits (from HEAD) have clean messages. */
  cleanMessages?: number;
  /** Regex that at least one typed command must match. */
  typed?: string;
  /** Regex the last typed command must match. */
  lastTyped?: string;

  // --- Branches, merging, rebasing (World 3) ---
  /** HEAD is on this branch. */
  currentBranch?: string;
  /** These local branches exist. */
  branches?: string[];
  /** These local branches do NOT exist. */
  branchesMissing?: string[];
  /** Each branch's tip commit message matches the regex: { feature: 'Add about' }. */
  branchAt?: Record<string, string>;
  /** HEAD is (true) / is not (false) a merge commit. */
  mergeCommit?: boolean;
  /** No merge commits reachable from HEAD (true), or at least one (false). */
  linearHistory?: boolean;
  /** A merge is stopped (true) / not in progress (false). */
  inMerge?: boolean;
  /** A rebase is stopped (true) / not in progress (false). */
  inRebase?: boolean;
  /** These paths are still unresolved conflicts. */
  conflicts?: string[];
  /** No unresolved conflicts left. */
  noConflicts?: boolean;
  /** Number of stash entries. */
  stashCount?: number;
  /** These tags exist. */
  tags?: string[];

  // --- Remotes (World 4) ---
  /** Remotes with these exact URLs: { origin: 'https://github.com/you/diary.git' }. */
  remotes?: Record<string, string>;
  /** Branch upstreams: { main: 'origin/main' }. */
  upstream?: Record<string, string>;
  /** These local branches are on their remote, at the same commit. */
  pushed?: string[];
  /** A hosted repo has this branch, with a tip message matching the regex (or just existing). */
  serverHas?: ServerCheck | ServerCheck[];
  /** The current branch is this many commits ahead / behind its upstream. */
  aheadBehind?: { ahead?: number; behind?: number };

  // --- Deep Git (World 10) ---
  /** `git bisect` found a first bad commit whose message matches this regex (still true after reset). */
  bisectFound?: string;
  /** A bisect is in progress (true) / not in progress (false). */
  bisectActive?: boolean;
  /** Aliases set (global or local config): { st: 'status', lg: 'log --oneline --graph --all' }. */
  aliases?: Record<string, string>;
  /** These linked worktrees exist (absolute paths). */
  worktrees?: string[];
  /** These blob ids were written with `git hash-object -w` (full or short ids). */
  objectsWritten?: string[];
  /** These refs are in .git/packed-refs (e.g. ['refs/heads/main']). */
  packedRefs?: string[];
}

export interface ServerCheck {
  url: string;
  branch: string;
  /** Regex for the tip commit message. Omit to only check that the branch exists. */
  messageRegex?: string;
  /** Regex that some commit on that branch must match. */
  hasMessage?: string;
}

export interface GoalResult {
  ok: boolean;
  failed: string[]; // names of the checks that failed (for debugging and hints)
}

export function checkGoal(state: SimState, goal: Goal, typed: string[] = []): GoalResult {
  const failed: string[] = [];
  const check = (name: string, pass: boolean) => {
    if (!pass) failed.push(name);
  };

  if (goal.cwd !== undefined) check('cwd', state.cwd === goal.cwd);
  if (goal.dirsExist) check('dirsExist', goal.dirsExist.every((d) => state.fs.dirs.includes(d)));
  if (goal.repoAt !== undefined) check('repoAt', Boolean(state.repos[goal.repoAt]));
  if (goal.config) {
    for (const [k, v] of Object.entries(goal.config)) check(`config:${k}`, state.globalConfig[k.toLowerCase()] === v || state.globalConfig[k] === v);
  }
  if (goal.configSet) {
    for (const k of goal.configSet) check(`configSet:${k}`, Boolean(state.globalConfig[k.toLowerCase()] ?? state.globalConfig[k]));
  }
  if (goal.typed) check('typed', typed.some((c) => new RegExp(goal.typed!).test(c)));
  if (goal.lastTyped) check('lastTyped', new RegExp(goal.lastTyped).test(typed[typed.length - 1] ?? ''));

  if (goal.serverHas) {
    for (const s of Array.isArray(goal.serverHas) ? goal.serverHas : [goal.serverHas]) {
      const server = findServer(state, s.url);
      const tip = server?.branches[s.branch];
      let pass = Boolean(server && tip);
      if (pass && s.messageRegex) pass = new RegExp(s.messageRegex, 'i').test(subject(server!.commits[tip!]!.message));
      if (pass && s.hasMessage) {
        const re = new RegExp(s.hasMessage, 'i');
        pass = [...reachable(server!.commits, [tip])].some((id) => re.test(server!.commits[id]!.message));
      }
      check(`serverHas:${s.url}#${s.branch}`, pass);
    }
  }

  const needsRepo = [
    goal.staged, goal.notStaged, goal.modified, goal.untracked, goal.clean, goal.commits, goal.minCommits,
    goal.lastMessage, goal.messages, goal.headDetached, goal.headAtMessage, goal.lastIsRevert, goal.filesExist,
    goal.filesMissing, goal.fileContains, goal.fileNotContains, goal.lastCommitFiles, goal.lastCommitHas, goal.lastCommitLacks,
    goal.cleanMessages, goal.stagedContains, goal.stagedNotContains,
    goal.currentBranch, goal.branches, goal.branchesMissing, goal.branchAt, goal.mergeCommit, goal.linearHistory, goal.inMerge,
    goal.inRebase, goal.conflicts, goal.noConflicts, goal.stashCount, goal.tags, goal.remotes, goal.upstream, goal.pushed,
    goal.aheadBehind, goal.bisectFound, goal.bisectActive, goal.worktrees, goal.objectsWritten, goal.packedRefs,
  ].some((v) => v !== undefined);
  if (goal.aliases) {
    const repo = findRepo(state);
    for (const [name, expansion] of Object.entries(goal.aliases)) {
      const set = getConfig(state, repo, `alias.${name}`);
      check(`aliases:${name}`, set !== undefined && set.trim().replace(/\s+/g, ' ') === expansion.trim().replace(/\s+/g, ' '));
    }
  }
  if (!needsRepo) return { ok: failed.length === 0, failed };

  const repo = findRepo(state);
  if (!repo) return { ok: false, failed: [...failed, 'repo'] };
  const st = computeStatus(state, repo);
  const stagedPaths = st.staged.flatMap((e) => (e.from ? [e.path, e.from] : [e.path]));
  const head = headId(repo);
  const log = history(repo, head);
  const work = workingTree(state, repo);

  if (goal.staged) check('staged', goal.staged.every((p) => stagedPaths.includes(p)));
  if (goal.notStaged) check('notStaged', goal.notStaged.every((p) => !stagedPaths.includes(p)));
  if (goal.modified) check('modified', goal.modified.every((p) => st.unstaged.some((e) => e.path === p)));
  if (goal.untracked) check('untracked', goal.untracked.every((p) => st.untracked.includes(p)));
  if (goal.clean !== undefined) {
    const clean = st.staged.length === 0 && st.unstaged.length === 0 && (!goal.noUntracked || st.untracked.length === 0);
    check('clean', clean === goal.clean);
  } else if (goal.noUntracked) check('noUntracked', st.untracked.length === 0);
  if (goal.commits !== undefined) check('commits', log.length === goal.commits);
  if (goal.minCommits !== undefined) check('minCommits', log.length >= goal.minCommits);
  if (goal.lastMessage) check('lastMessage', new RegExp(goal.lastMessage, 'i').test(log[0]?.message ?? ''));
  if (goal.messages) check('messages', goal.messages.every((re, i) => new RegExp(re, 'i').test(subject(log[i]?.message ?? ''))));
  if (goal.cleanMessages !== undefined) check('cleanMessages', log.filter((c) => isCleanMessage(c.message)).length >= goal.cleanMessages);
  if (goal.headDetached !== undefined) check('headDetached', (repo.head.type === 'detached') === goal.headDetached);
  if (goal.headAtMessage) {
    check('headAtMessage', new RegExp(goal.headAtMessage, 'i').test(subject(log[0]?.message ?? '')));
  }
  if (goal.lastIsRevert !== undefined) check('lastIsRevert', /^Revert "/.test(log[0]?.message ?? '') === goal.lastIsRevert);
  if (goal.filesExist) check('filesExist', goal.filesExist.every((p) => p in work));
  if (goal.filesMissing) check('filesMissing', goal.filesMissing.every((p) => !(p in work)));
  if (goal.fileContains) {
    for (const [p, text] of Object.entries(goal.fileContains)) check(`fileContains:${p}`, (work[p] ?? '').includes(text));
  }
  if (goal.fileNotContains) {
    for (const [p, text] of Object.entries(goal.fileNotContains)) check(`fileNotContains:${p}`, !(work[p] ?? '').includes(text));
  }
  if (goal.stagedContains) {
    for (const [p, text] of Object.entries(goal.stagedContains)) check(`stagedContains:${p}`, (repo.index[p] ?? '').includes(text));
  }
  if (goal.stagedNotContains) {
    for (const [p, text] of Object.entries(goal.stagedNotContains)) check(`stagedNotContains:${p}`, !(repo.index[p] ?? '').includes(text));
  }
  const lastSnap = log[0]?.snapshot ?? {};
  if (goal.lastCommitFiles) check('lastCommitFiles', JSON.stringify(Object.keys(lastSnap).sort()) === JSON.stringify([...goal.lastCommitFiles].sort()));
  if (goal.lastCommitHas) check('lastCommitHas', goal.lastCommitHas.every((p) => p in lastSnap));
  if (goal.lastCommitLacks) check('lastCommitLacks', goal.lastCommitLacks.every((p) => !(p in lastSnap)));

  // Branches, merging, rebasing
  if (goal.currentBranch !== undefined) check('currentBranch', repo.head.type === 'branch' && repo.head.name === goal.currentBranch);
  if (goal.branches) check('branches', goal.branches.every((b) => repo.branches[b] !== undefined));
  if (goal.branchesMissing) check('branchesMissing', goal.branchesMissing.every((b) => repo.branches[b] === undefined));
  if (goal.branchAt) {
    for (const [b, re] of Object.entries(goal.branchAt)) {
      const tip = repo.branches[b];
      check(`branchAt:${b}`, Boolean(tip) && new RegExp(re, 'i').test(subject(repo.commits[tip!]!.message)));
    }
  }
  if (goal.mergeCommit !== undefined) check('mergeCommit', ((head && repo.commits[head]!.parents.length > 1) || false) === goal.mergeCommit);
  if (goal.linearHistory !== undefined) {
    const merges = [...reachable(repo.commits, [head])].some((id) => repo.commits[id]!.parents.length > 1);
    check('linearHistory', !merges === goal.linearHistory);
  }
  if (goal.inMerge !== undefined) check('inMerge', (repo.op?.kind === 'merge') === goal.inMerge);
  if (goal.inRebase !== undefined) check('inRebase', (repo.op?.kind === 'rebase') === goal.inRebase);
  if (goal.conflicts) check('conflicts', goal.conflicts.every((p) => Object.hasOwn(repo.conflicts, p)));
  if (goal.noConflicts !== undefined) check('noConflicts', (Object.keys(repo.conflicts).length === 0) === goal.noConflicts);
  if (goal.stashCount !== undefined) check('stashCount', repo.stash.length === goal.stashCount);
  if (goal.tags) check('tags', goal.tags.every((t) => repo.tags[t] !== undefined));

  // Remotes
  if (goal.remotes) for (const [name, url] of Object.entries(goal.remotes)) check(`remotes:${name}`, remoteUrl(repo, name) === url);
  if (goal.upstream) for (const [b, up] of Object.entries(goal.upstream)) check(`upstream:${b}`, upstreamOf(repo, b)?.ref === up);
  if (goal.pushed) {
    for (const b of goal.pushed) {
      const up = upstreamOf(repo, b);
      const remote = up?.remote ?? (remoteUrl(repo, 'origin') !== undefined ? 'origin' : undefined);
      const url = remote ? remoteUrl(repo, remote) : undefined;
      const server = url ? findServer(state, url) : undefined;
      const name = up?.branch ?? b;
      check(`pushed:${b}`, Boolean(server && repo.branches[b] && server.branches[name] === repo.branches[b]));
    }
  }
  if (goal.aheadBehind) {
    const t = repo.head.type === 'branch' ? trackingInfo(repo, repo.head.name) : null;
    const want = goal.aheadBehind;
    check('aheadBehind', Boolean(t && !t.gone) && (want.ahead === undefined || t!.ahead === want.ahead) && (want.behind === undefined || t!.behind === want.behind));
  }

  // Deep Git
  if (goal.bisectFound !== undefined) {
    const found = repo.bisect?.found ?? repo.bisectFound ?? null;
    check('bisectFound', Boolean(found && repo.commits[found] && new RegExp(goal.bisectFound, 'i').test(repo.commits[found]!.message)));
  }
  if (goal.bisectActive !== undefined) check('bisectActive', Boolean(repo.bisect) === goal.bisectActive);
  if (goal.worktrees) {
    const main = mainRepo(state, repo);
    check('worktrees', goal.worktrees.every((p) => Boolean(main.worktrees?.[p])));
  }
  if (goal.objectsWritten) {
    const ids = Object.keys(mainRepo(state, repo).blobs ?? {});
    check('objectsWritten', goal.objectsWritten.every((x) => ids.some((id) => id.startsWith(x))));
  }
  if (goal.packedRefs) {
    const packed = mainRepo(state, repo).packedRefs ?? {};
    check('packedRefs', goal.packedRefs.every((r) => r in packed));
  }
  return { ok: failed.length === 0, failed };
}

/** Is `rev` resolvable in the current repo? Handy for UI checks. */
export function revExists(state: SimState, rev: string): boolean {
  const repo = findRepo(state);
  return Boolean(repo && resolveRev(repo, rev).ok);
}

const VAGUE = /^(update|updates|fix|fixes|stuff|changes?|misc|wip|asdf+|test|commit|save|done|edit|new|ok|final|temp|tmp|\.+)$/i;

/** A friendly heuristic for "clean" commit messages (used by goals and LogCheck). */
export function isCleanMessage(message: string): boolean {
  const subj = subject(message).trim();
  if (subj.length < 8 || subj.length > 72) return false;
  if (subj.endsWith('.')) return false;
  const body = subj.replace(/^(feat|fix|docs|style|refactor|test|chore|perf|build|ci)(\([^)]*\))?!?:\s*/i, '');
  if (VAGUE.test(body)) return false;
  return body.trim().split(/\s+/).length >= 2;
}
