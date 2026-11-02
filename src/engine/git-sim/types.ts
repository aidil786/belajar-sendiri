// Core types for the Belajar Sendiri Git simulator.
// The engine is pure TypeScript: no DOM, no React, no i18n strings.

/** Path → file content. Paths are absolute (filesystem) or repo-relative (snapshots). */
export type FileMap = Record<string, string>;

export interface Author {
  name: string;
  email: string;
}

export interface Commit {
  /** 40-char SHA-1 of the commit object, like real Git (see hash.ts `commitText`). */
  id: string;
  parents: string[];
  message: string;
  author: Author;
  timestamp: number; // author date, unix seconds (what `git log` shows)
  /** Committer date. Differs from `timestamp` after cherry-pick, rebase and amend. Log order uses it. */
  committed?: number;
  /** Committer, when not the author (cherry-pick or rebase of someone else's commit). */
  committer?: Author;
  snapshot: FileMap; // repo-relative path → content
}

export type Head = { type: 'branch'; name: string } | { type: 'detached'; commit: string };

export interface ReflogEntry {
  commit: string;
  message: string; // e.g. "commit: Add home page"
}

/** An annotated tag object (`git tag -a`). Lightweight tags have none. */
export interface TagInfo {
  id: string; // SHA-1 of the tag object (see hash.ts `tagText`)
  tagger: Author;
  timestamp: number;
  message: string;
}

/** One `git stash` entry. Like Git, it is made of real commits. */
export interface StashEntry {
  /** Text after "stash@{n}: ", e.g. "WIP on main: a1b2c3d Add page" or "On main: draft". */
  message: string;
  base: string; // HEAD commit when stashed
  id: string; // the stash ("WIP") commit: parents [base, indexId(, untrackedId)]
  indexId: string; // commit holding the staged snapshot
  untrackedId: string | null; // commit holding untracked files (-u)
  index: FileMap; // staged snapshot
  working: FileMap; // tracked working files
  untracked: FileMap; // untracked files saved with -u (empty otherwise)
}

/** The three versions of a conflicted file (index stages 1, 2, 3). null = the file is absent there. */
export interface ConflictEntry {
  base: string | null;
  ours: string | null;
  theirs: string | null;
}

export type RebaseAction = 'pick' | 'reword' | 'squash' | 'fixup' | 'drop';

export interface RebaseStep {
  action: RebaseAction;
  commit: string; // full id of the commit to replay
  /** New message for reword / squash (the sim has no editor). */
  message?: string;
}

/** A merge, cherry-pick or rebase that stopped part-way (usually because of conflicts). */
export type Operation =
  | {
      kind: 'merge';
      /** MERGE_HEAD */
      theirs: string;
      /** Name used in conflict markers and messages (as typed, e.g. "feature"). */
      label: string;
      /** MERGE_MSG: the default merge commit message. */
      message: string;
      origHead: string;
    }
  | {
      kind: 'cherry-pick';
      /** CHERRY_PICK_HEAD */
      commit: string;
      /** Commits still to pick after this one (`git cherry-pick A B`). */
      todo: string[];
      origHead: string;
    }
  | {
      kind: 'rebase';
      /** Branch being rebased, or null for a detached HEAD. */
      branch: string | null;
      onto: string;
      /** Where the branch (or HEAD) was before the rebase. */
      origHead: string;
      /** Upstream as typed, for messages. */
      upstream: string;
      done: RebaseStep[];
      todo: RebaseStep[];
      /** The step that stopped (conflict); null when nothing is pending. */
      current: RebaseStep | null;
      /** Squash/fixup in progress: message so far for the combined commit. */
      squashMessage: string | null;
    };

export interface Repo {
  root: string; // absolute path of the working folder
  /** Staged snapshot (stage 0). Conflicted paths are NOT here: see `conflicts`. */
  index: FileMap;
  commits: Record<string, Commit>;
  branches: Record<string, string>; // name → commit id (absent while unborn)
  tags: Record<string, string>; // name → commit id (peeled, for annotated tags too)
  /** Annotated tag objects by tag name. */
  tagInfo: Record<string, TagInfo>;
  head: Head;
  /** Where HEAD was detached (for "HEAD detached at/from"). */
  detachedFrom: string | null;
  stash: StashEntry[]; // newest first (stash@{0})
  reflog: ReflogEntry[]; // newest first
  /**
   * --local config. Remotes and upstreams live here like in real Git:
   * remote.<name>.url, remote.<name>.fetch, branch.<name>.remote, branch.<name>.merge.
   */
  config: Record<string, string>;
  /** Remote-tracking branches: "origin/main" → commit id. */
  remoteRefs: Record<string, string>;
  /** refs/remotes/<remote>/HEAD: "origin" → "main". */
  remoteHeads: Record<string, string>;
  /** Unresolved conflicts: path → index stages. */
  conflicts: Record<string, ConflictEntry>;
  /** Merge / cherry-pick / rebase in progress. */
  op: Operation | null;
  /** ORIG_HEAD */
  origHead: string | null;

  // --- World 10 (all optional, so older saved states still load) ---
  /** Loose blobs written by `git hash-object -w` (id → content). */
  blobs?: Record<string, string>;
  /** `git bisect` in progress (per worktree, like real Git). */
  bisect?: BisectState | null;
  /** First bad commit of the last finished bisect (kept after `git bisect reset`, for goals). */
  bisectFound?: string | null;
  /** Refs written to .git/packed-refs (ref → id at packing time), e.g. by clone or `git pack-refs`. */
  packedRefs?: Record<string, string>;
  /** Linked worktrees (`git worktree add`), keyed by absolute path. Only on the main repo. */
  worktrees?: Record<string, LinkedWorktree>;
}

/** `git bisect` state (.git/BISECT_* and refs/bisect/* in real Git). */
export interface BisectState {
  /** Branch to go back to on `git bisect reset`, or a commit id when HEAD was detached. */
  start: string;
  startDetached: boolean;
  bad: string | null;
  good: string[];
  skip: string[];
  /** Lines of `git bisect log`. */
  log: string[];
  /** The first bad commit, once found. */
  found: string | null;
  /** The words in use: bad/good (default) or new/old. Unset until a mark or `start <bad> <good>` decides. */
  terms?: { bad: string; good: string } | null;
}

/**
 * A linked worktree: another working folder that shares the repo's commits, branches,
 * tags, config and stash, with its own HEAD, index and in-progress operations.
 */
export interface LinkedWorktree {
  path: string;
  /** Folder name under .git/worktrees/ (the path's last part, made unique). */
  name: string;
  head: Head;
  index: FileMap;
  detachedFrom: string | null;
  reflog: ReflogEntry[];
  conflicts: Record<string, ConflictEntry>;
  op: Operation | null;
  origHead: string | null;
  bisect: BisectState | null;
}

/** A hosted repository on the fake GitHub, keyed by URL (e.g. https://github.com/you/diary.git). Bare: no files. */
export interface Server {
  url: string;
  commits: Record<string, Commit>;
  branches: Record<string, string>;
  tags: Record<string, string>;
  tagInfo: Record<string, TagInfo>;
  /** The server's HEAD (default branch name), even while it has no commits. */
  head: string;
}

/** Interactive prompt in progress (simplified `git add -p`). */
export interface PendingPatch {
  kind: 'addPatch';
  repoRoot: string;
  queue: { path: string; hunkIndex: number }[];
  accepted: Record<string, number[]>; // path → accepted hunk indexes
  totals: Record<string, number>; // path → number of hunks (for "(1/2)")
  lastShown: string | null; // file whose header was printed last
}

export interface SimState {
  fs: { files: FileMap; dirs: string[] }; // absolute paths
  cwd: string;
  home: string;
  globalConfig: Record<string, string>;
  repos: Record<string, Repo>; // keyed by repo root
  /** Hosted repos on the fake GitHub, keyed by URL. */
  servers: Record<string, Server>;
  clock: number; // fake unix time (seconds)
  tz: number; // minutes east of UTC, e.g. 480 for +0800
  seed: string;
  counter: number; // increments for each hash
  lastDir: string | null; // for `cd -`
  pending: PendingPatch | null;
  gitVersion: string;
}

// ---------------------------------------------------------------------------
// Output

export type Color = 'red' | 'green' | 'yellow' | 'cyan' | 'blue' | 'magenta' | 'bold' | 'dim';

export interface Seg {
  t: string;
  c?: Color;
}

/** One output line made of coloured segments. */
export type Line = Seg[];

// ---------------------------------------------------------------------------
// Events: animations and boards listen to these.

export type SimEvent =
  | { type: 'repoInitialized'; root: string; reinit: boolean }
  | { type: 'fileChanged'; path: string }
  | { type: 'fileCreated'; path: string }
  | { type: 'fileDeleted'; path: string }
  | { type: 'fileStaged'; path: string; deleted?: boolean }
  | { type: 'fileUnstaged'; path: string }
  | { type: 'fileRestored'; path: string }
  | { type: 'fileMoved'; from: string; to: string }
  | { type: 'commitCreated'; id: string; amend?: boolean }
  | { type: 'headMoved'; from: string | null; to: string | null }
  | { type: 'headDetached'; commit: string }
  | { type: 'headAttached'; branch: string }
  | { type: 'branchMoved'; branch: string; from: string | null; to: string }
  | { type: 'resetApplied'; mode: 'soft' | 'mixed' | 'hard'; to: string }
  | { type: 'revertCreated'; id: string; reverted: string }
  | { type: 'filesCleaned'; paths: string[]; dryRun: boolean }
  | { type: 'configSet'; key: string; value: string; scope: 'global' | 'local' }
  | { type: 'cwdChanged'; cwd: string }
  | { type: 'cleared' }
  | { type: 'branchCreated'; branch: string; at: string }
  | { type: 'branchDeleted'; branch: string; was: string }
  | { type: 'branchRenamed'; from: string; to: string }
  | { type: 'upstreamSet'; branch: string; upstream: string | null }
  | { type: 'merged'; mode: 'fastForward' | 'merge' | 'upToDate'; theirs: string; id: string }
  | { type: 'conflict'; op: 'merge' | 'rebase' | 'cherry-pick' | 'stash'; paths: string[] }
  | { type: 'conflictResolved'; path: string }
  | { type: 'opAborted'; op: 'merge' | 'rebase' | 'cherry-pick' }
  | { type: 'opFinished'; op: 'merge' | 'rebase' | 'cherry-pick' }
  | { type: 'rebased'; branch: string | null; from: string; to: string; replayed: Record<string, string> }
  | { type: 'cherryPicked'; from: string; id: string }
  | { type: 'stashSaved'; id: string }
  | { type: 'stashApplied'; dropped: boolean }
  | { type: 'stashDropped'; id: string }
  | { type: 'tagCreated'; tag: string; commit: string; annotated: boolean }
  | { type: 'tagDeleted'; tag: string }
  | { type: 'remoteAdded'; name: string; url: string }
  | { type: 'remoteRemoved'; name: string }
  | { type: 'remoteRenamed'; from: string; to: string }
  | { type: 'pushed'; url: string; remote: string | null; updates: RefUpdate[] }
  | { type: 'pushRejected'; url: string; ref: string; reason: 'fetchFirst' | 'nonFastForward' | 'staleInfo' | 'alreadyExists' }
  | { type: 'fetched'; url: string; remote: string | null; updates: RefUpdate[] }
  | { type: 'cloned'; url: string; root: string }
  | { type: 'objectWritten'; id: string; kind: 'blob' }
  | { type: 'bisectStep'; testing: string; left: number }
  | { type: 'bisectFound'; id: string }
  | { type: 'bisectReset' }
  | { type: 'worktreeAdded'; path: string; branch: string | null }
  | { type: 'worktreeRemoved'; path: string }
  | { type: 'error'; code: string };

/** One ref that moved on a server (push) or in a repo (fetch). null = absent. */
export interface RefUpdate {
  /** "main", "tags/v1.0", "origin/main", ... */
  ref: string;
  from: string | null;
  to: string | null;
  forced?: boolean;
}

/** A friendly, translatable explanation shown under the output. */
export interface Explain {
  key: string; // i18n key, e.g. "sim.explain.add"
  params?: Record<string, string>;
}

export interface CommandResult {
  state: SimState;
  output: Line[];
  events: SimEvent[];
  ok: boolean;
  explain?: Explain;
  /** Prompt to show instead of `$` (used by `git add -p`). */
  prompt?: string;
  /**
   * Git stopped and wants the learner to act (e.g. merge conflicts). `ok` is false
   * like Git's exit code, but this is not a mistake: UIs should not count it as one.
   * Also used for other non-zero results that are not mistakes (grep finding nothing, a
   * command the terminal only explains).
   */
  stopped?: boolean;
  /** Exit status when it is not simply 0 / 1 (scripts run by `sh`, `git bisect run`). */
  exitCode?: number;
}

export interface CommandContext {
  /** The raw line the learner typed. */
  raw: string;
  /** Run another line (used by `git bisect run`, `sh script` and aliases). */
  run?: (state: SimState, line: string) => CommandResult;
  /** How deep we are in nested runs (aliases, scripts), to stop loops. */
  depth?: number;
}

export type CommandFn = (state: SimState, args: string[], ctx: CommandContext) => CommandResult;
