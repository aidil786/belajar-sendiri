// git merge, git cherry-pick and git rebase (plus the interactive-rebase API).
// They share one "pick" step: a three-way merge of a commit onto HEAD.
import { mergeTrees } from '../merge';
import { shortHash } from '../hash';
import { fail, line, lines, notARepo, ok } from '../output';
import { Args } from '../parse';
import { countAheadBehind, isAncestorOf, mergeBase, topoOrder, walk } from '../refs';
import { resolveRev, revProblem } from '../revision';
import { computeStatus } from '../status';
import {
  clone,
  findRepo,
  getConfig,
  gitDate,
  hasConflicts,
  headId,
  headTree,
  identity,
  makeCommit,
  moveHead,
  subject,
  upstreamOf,
  upstreamTip,
} from '../state';
import type {
  CommandFn,
  CommandResult,
  Commit,
  FileMap,
  Line,
  Operation,
  RebaseStep,
  Repo,
  SimEvent,
  SimState,
} from '../types';
import { applyMergeResult, applyToWorking, blockingChanges, commitStat, mergeStat, renderLongStatus, unmergedCommitError } from './common';

type RebaseOp = Extract<Operation, { kind: 'rebase' }>;

function badOption(state: SimState, opt: string): CommandResult {
  return fail(state, lines(`error: unknown option '${opt.replace(/^-+/, '')}'`), 'badOption', {
    key: 'sim.err.badOption',
    params: { option: opt },
  });
}

const sameTree = (a: FileMap, b: FileMap) => {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => Object.hasOwn(b, k) && a[k] === b[k]);
};

/** "abc1234 (Add about)": how a picked commit is named in markers and messages. */
function pickLabel(c: Commit): string {
  return `${shortHash(c.id)} (${subject(c.message)})`;
}

/** Hard-reset index + working files for every path that differs from `tree` in the index or conflicts. */
function resetTouched(state: SimState, repo: Repo, tree: FileMap, hard = false): void {
  const paths = new Set([...Object.keys(repo.index), ...Object.keys(repo.conflicts), ...Object.keys(tree)]);
  const changes: Record<string, string | null> = {};
  const cur = headTree(repo);
  for (const p of paths) {
    const touched = hard || Object.hasOwn(repo.conflicts, p) || repo.index[p] !== cur[p];
    if (!touched) continue;
    changes[p] = tree[p] ?? null;
  }
  const newIndex: FileMap = {};
  for (const [p, v] of Object.entries(tree)) newIndex[p] = v;
  repo.index = newIndex;
  repo.conflicts = {};
  applyToWorking(state, repo, changes);
}

// ---------------------------------------------------------------------------
// Merge

/** Default merge commit message, like `git fmt-merge-msg`. */
export function defaultMergeMessage(repo: Repo, label: string, opts: { url?: string } = {}): string {
  let what: string;
  if (opts.url) what = `branch '${label}' of ${opts.url.replace(/\.git$/, '')}`;
  else if (repo.branches[label] !== undefined) what = `branch '${label}'`;
  else if (repo.tags[label] !== undefined) what = `tag '${label}'`;
  else if (repo.remoteRefs[label] !== undefined) what = `remote-tracking branch '${label}'`;
  else what = `commit '${label}'`;
  const into = repo.head.type === 'branch' ? repo.head.name : 'HEAD';
  const suffix = into === 'main' || into === 'master' ? '' : ` into ${into}`;
  return `Merge ${what}${suffix}`;
}

export interface MergeOptions {
  noFF?: boolean;
  ffOnly?: boolean;
  message?: string;
  /** Name in conflict markers (defaults to `label`). */
  markerLabel?: string;
  /** For `git pull`: message names the remote URL. */
  url?: string;
  /** Reflog prefix, e.g. "merge feature" or "pull". */
  reflog?: string;
}

const DIVERGING_HINT = [
  "hint: Diverging branches can't be fast-forwarded, you need to either:",
  'hint:',
  'hint: \tgit merge --no-ff',
  'hint:',
  'hint: or:',
  'hint:',
  'hint: \tgit rebase',
  'hint:',
  'hint: Disable this message with "git config set advice.diverging false"',
  'fatal: Not possible to fast-forward, aborting.',
];

export function divergingError(state: SimState): CommandResult {
  return fail(state, lines(DIVERGING_HINT.join('\n')), 'notFastForward', { key: 'sim.err.mergeFFOnly' });
}

/** Merge commit `theirs` (named `label`) into HEAD. Used by `git merge` and `git pull`. */
export function mergeInto(state: SimState, theirs: string, label: string, opts: MergeOptions = {}): CommandResult {
  const repo = findRepo(state)!;
  const head = headId(repo);
  const reflogName = opts.reflog ?? `merge ${label}`;
  if (head && isAncestorOf(repo.commits, theirs, head)) {
    return ok(state, [line('Already up to date.')], [{ type: 'merged', mode: 'upToDate', theirs, id: head }], {
      key: 'sim.explain.mergeUpToDate',
      params: { branch: label },
    });
  }
  const target = repo.commits[theirs]!.snapshot;
  // Fast-forward (also when the branch has no commits yet).
  if (!head || (isAncestorOf(repo.commits, head, theirs) && !opts.noFF)) {
    const header: Line[] = head ? [line(`Updating ${shortHash(head)}..${shortHash(theirs)}`)] : [];
    const { dirty, untracked } = blockingChanges(state, repo, target);
    if (untracked.length) {
      return fail(
        state,
        [...header, ...lines(`error: The following untracked working tree files would be overwritten by merge:\n${untracked.map((p) => `\t${p}`).join('\n')}\nPlease move or remove them before you merge.\nAborting`)],
        'untrackedOverwrite',
        { key: 'sim.err.mergeUntracked' },
      );
    }
    if (dirty.length) {
      return fail(
        state,
        [...header, ...lines(`error: Your local changes to the following files would be overwritten by merge:\n${dirty.map((p) => `\t${p}`).join('\n')}\nPlease commit your changes or stash them before you merge.\nAborting`)],
        'localChanges',
        { key: 'sim.err.mergeDirty' },
      );
    }
    const next = clone(state);
    const r = findRepo(next)!;
    const before = headTree(r);
    const changes: Record<string, string | null> = {};
    for (const p of new Set([...Object.keys(before), ...Object.keys(target)])) {
      if (before[p] !== target[p]) {
        changes[p] = target[p] ?? null;
        if (target[p] === undefined) delete r.index[p];
        else r.index[p] = target[p]!;
      }
    }
    applyToWorking(next, r, changes);
    r.origHead = head;
    moveHead(r, theirs, `${reflogName}: Fast-forward`);
    const events: SimEvent[] = [{ type: 'merged', mode: 'fastForward', theirs, id: theirs }];
    if (r.head.type === 'branch') events.push({ type: 'branchMoved', branch: r.head.name, from: head, to: theirs });
    events.push({ type: 'headMoved', from: head, to: theirs });
    return ok(next, [...header, line('Fast-forward'), ...mergeStat(before, target)], events, {
      key: 'sim.explain.mergeFastForward',
      params: { branch: label },
    });
  }
  if (opts.ffOnly) return divergingError(state);

  const author = identity(state, repo);
  if (!author) return fail(state, lines('Committer identity unknown\n\n*** Please tell me who you are.'), 'noIdentity', { key: 'sim.err.noIdentity' });
  // A real merge needs a clean index.
  const st = computeStatus(state, repo);
  if (st.staged.length) {
    const names = st.staged.flatMap((e) => (e.from ? [e.from, e.path] : [e.path]));
    return fail(
      state,
      lines(`error: Your local changes to the following files would be overwritten by merge:\n  ${names.join(' ')}\nMerge with strategy ort failed.`),
      'localChanges',
      { key: 'sim.err.mergeDirty' },
    );
  }
  const baseId = mergeBase(repo.commits, head, theirs);
  const base = baseId ? repo.commits[baseId]!.snapshot : {};
  const ours = headTree(repo);
  const markerLabel = opts.markerLabel ?? label;
  const res = mergeTrees(base, ours, target, { ours: 'HEAD', theirs: markerLabel });
  const { dirty, untracked } = blockingChanges(state, repo, res.working);
  if (untracked.length || dirty.length) {
    const text = untracked.length
      ? `error: The following untracked working tree files would be overwritten by merge:\n${untracked.map((p) => `\t${p}`).join('\n')}\nPlease move or remove them before you merge.\nAborting\nMerge with strategy ort failed.`
      : `error: Your local changes to the following files would be overwritten by merge:\n${dirty.map((p) => `\t${p}`).join('\n')}\nPlease commit your changes or stash them before you merge.\nAborting\nMerge with strategy ort failed.`;
    return fail(state, lines(text), untracked.length ? 'untrackedOverwrite' : 'localChanges', {
      key: untracked.length ? 'sim.err.mergeUntracked' : 'sim.err.mergeDirty',
    });
  }
  const message = opts.message ?? defaultMergeMessage(repo, label, opts.url ? { url: opts.url } : {});
  const next = clone(state);
  const r = findRepo(next)!;
  applyMergeResult(next, r, res);
  r.origHead = head;
  const conflicted = Object.keys(res.conflicts);
  if (conflicted.length) {
    r.op = { kind: 'merge', theirs, label: markerLabel, message, origHead: head };
    return {
      state: next,
      output: [...res.messages, line('Automatic merge failed; fix conflicts and then commit the result.')],
      events: [{ type: 'conflict', op: 'merge', paths: conflicted }],
      ok: false,
      stopped: true,
      explain: { key: conflicted.length === 1 ? 'sim.explain.mergeConflictOne' : 'sim.explain.mergeConflictMany', params: { file: conflicted[0]!, count: String(conflicted.length), branch: label } },
    };
  }
  const created = makeCommit(next, r, { message, parents: [head, theirs], snapshot: r.index, author });
  moveHead(r, created.id, `${reflogName}: Merge made by the 'ort' strategy.`);
  const events: SimEvent[] = [{ type: 'merged', mode: 'merge', theirs, id: created.id }, { type: 'commitCreated', id: created.id }];
  if (r.head.type === 'branch') events.push({ type: 'branchMoved', branch: r.head.name, from: head, to: created.id });
  events.push({ type: 'headMoved', from: head, to: created.id });
  return ok(next, [...res.messages, line("Merge made by the 'ort' strategy."), ...mergeStat(ours, created.snapshot)], events, {
    key: 'sim.explain.mergeCommit',
    params: { branch: label, hash: shortHash(created.id) },
  });
}

/** Refuse to start a new operation while one is stopped. */
function busy(state: SimState, repo: Repo, verb: 'Merging' | 'Cherry-picking' | 'Pulling'): CommandResult | null {
  if (hasConflicts(repo)) return fail(state, unmergedCommitError(repo, verb), 'unmerged', { key: 'sim.err.unmerged' });
  return null;
}

export const merge: CommandFn = (state, args) => {
  const repo = findRepo(state);
  if (!repo) return notARepo(state);
  const a = new Args(args, {
    flags: ['--no-ff', '--ff-only', '--ff', '--abort', '--continue', '--no-edit', '--edit', '-e', '-q', '--quiet', '--squash', '--no-commit', '--quit'],
    values: ['-m', '--message'],
  });
  if (a.unknown.length) return badOption(state, a.unknown[0]!);
  if (a.has('--squash', '--no-commit', '--quit')) {
    const opt = a.has('--squash') ? '--squash' : a.has('--quit') ? '--quit' : '--no-commit';
    return fail(state, [], 'mergeOption', { key: 'sim.err.mergeOptionLater', params: { option: opt } });
  }
  if (a.has('--abort')) {
    if (repo.op?.kind !== 'merge') {
      return fail(state, lines('fatal: There is no merge to abort (MERGE_HEAD missing).'), 'noMerge', { key: 'sim.err.noMergeToAbort' });
    }
    const next = clone(state);
    const r = findRepo(next)!;
    resetTouched(next, r, headTree(r));
    r.op = null;
    return ok(next, [], [{ type: 'opAborted', op: 'merge' }], { key: 'sim.explain.mergeAbort' });
  }
  if (a.has('--continue')) {
    if (repo.op?.kind !== 'merge') {
      return fail(state, lines('fatal: There is no merge in progress (MERGE_HEAD missing).'), 'noMerge', { key: 'sim.err.noMergeInProgress' });
    }
    return concludeMerge(state, undefined);
  }
  if (repo.op?.kind === 'merge') {
    if (hasConflicts(repo)) return fail(state, unmergedCommitError(repo, 'Merging'), 'unmerged', { key: 'sim.err.unmerged' });
    return fail(state, lines('fatal: You have not concluded your merge (MERGE_HEAD exists).\nPlease, commit your changes before you merge.'), 'mergeInProgress', {
      key: 'sim.err.mergeInProgress',
    });
  }
  const stop = busy(state, repo, 'Merging');
  if (stop) return stop;
  // --ff, --no-ff and --ff-only set one switch: the last one wins, like Git.
  const ffFlag = [...args].reverse().find((x) => x === '--ff' || x === '--no-ff' || x === '--ff-only');
  let label = a.positional[0];
  if (a.positional.length > 1) {
    return fail(state, [], 'octopus', { key: 'sim.err.mergeOne' });
  }
  if (!label) {
    const up = repo.head.type === 'branch' ? upstreamOf(repo, repo.head.name) : null;
    if (!up) return fail(state, lines('fatal: No remote for the current branch.'), 'noRemote', { key: 'sim.err.mergeNeedBranch' });
    label = up.ref;
  }
  const res = resolveRev(repo, label);
  if (!res.ok) {
    const problem = revProblem(label, res);
    return fail(state, lines(problem ?? `merge: ${label} - not something we can merge`), 'badMerge', { key: 'sim.err.mergeUnknown', params: { branch: label } });
  }
  const message = a.get('-m', '--message');
  const cfgFF = getConfig(state, repo, 'merge.ff');
  const ff = ffFlag ?? (cfgFF === 'only' ? '--ff-only' : cfgFF === 'false' ? '--no-ff' : '--ff');
  return mergeInto(state, res.id, label, {
    noFF: ff === '--no-ff',
    ffOnly: ff === '--ff-only',
    ...(message !== undefined ? { message } : {}),
  });
};

/** Finish a stopped merge with a merge commit (`git commit` / `git merge --continue`). */
export function concludeMerge(state: SimState, message: string | undefined): CommandResult {
  const repo = findRepo(state)!;
  const op = repo.op as Extract<Operation, { kind: 'merge' }>;
  if (hasConflicts(repo)) return fail(state, unmergedCommitError(repo), 'unmerged', { key: 'sim.err.unmerged' });
  const author = identity(state, repo);
  if (!author) return fail(state, lines('Author identity unknown\n\n*** Please tell me who you are.'), 'noIdentity', { key: 'sim.err.noIdentity' });
  const next = clone(state);
  const r = findRepo(next)!;
  const head = headId(r)!;
  const msg = message ?? op.message;
  const created = makeCommit(next, r, { message: msg, parents: [head, op.theirs], snapshot: r.index, author });
  moveHead(r, created.id, `commit (merge): ${subject(msg)}`);
  r.op = null;
  const where = r.head.type === 'branch' ? r.head.name : 'detached HEAD';
  const events: SimEvent[] = [{ type: 'commitCreated', id: created.id }, { type: 'opFinished', op: 'merge' }];
  if (r.head.type === 'branch') events.push({ type: 'branchMoved', branch: r.head.name, from: head, to: created.id });
  events.push({ type: 'headMoved', from: head, to: created.id });
  return ok(next, [line(`[${where} ${shortHash(created.id)}] ${subject(msg)}`)], events, {
    key: message === undefined ? 'sim.explain.mergeCommitDefault' : 'sim.explain.mergeConcluded',
    params: { message: subject(msg), hash: shortHash(created.id) },
  });
}

// ---------------------------------------------------------------------------
// The pick step (cherry-pick and rebase)

type PickOutcome =
  | { kind: 'committed'; id: string; out: Line[] }
  | { kind: 'empty'; out: Line[] }
  | { kind: 'conflict'; paths: string[]; out: Line[] };

/**
 * Apply commit `id` on top of HEAD. Mutates the (cloned) state. With `squashInto`,
 * the result replaces HEAD (squash / fixup).
 */
function pick(state: SimState, repo: Repo, id: string, opts: { message?: string; squash?: boolean; reflog: string; summary: 'cherry-pick' | 'none' }): PickOutcome {
  const c = repo.commits[id]!;
  const head = headId(repo)!;
  const headCommit = repo.commits[head]!;
  const base = c.parents[0] ? repo.commits[c.parents[0]]!.snapshot : {};
  const ours = headCommit.snapshot;
  const res = mergeTrees(base, ours, c.snapshot, { ours: 'HEAD', theirs: pickLabel(c) });
  const conflicted = Object.keys(res.conflicts);
  if (conflicted.length) {
    applyMergeResult(state, repo, res);
    return { kind: 'conflict', paths: conflicted, out: res.messages };
  }
  if (!opts.squash && sameTree(res.index, ours)) return { kind: 'empty', out: res.messages };
  applyMergeResult(state, repo, res);
  const message = opts.message ?? c.message;
  const parents = opts.squash ? [...headCommit.parents] : [head];
  const author = opts.squash ? headCommit.author : c.author;
  const timestamp = opts.squash ? headCommit.timestamp : c.timestamp;
  const created = makeCommit(state, repo, { message, parents, snapshot: res.index, author, timestamp });
  moveHead(repo, created.id, `${opts.reflog}: ${subject(message)}`);
  const out: Line[] = [...res.messages];
  if (opts.summary === 'cherry-pick') {
    const where = repo.head.type === 'branch' ? repo.head.name : 'detached HEAD';
    out.push(line(`[${where} ${shortHash(created.id)}] ${subject(message)}`), line(` Date: ${gitDate(created.timestamp, state.tz)}`), ...commitStat(ours, created.snapshot));
  }
  return { kind: 'committed', id: created.id, out };
}

// ---------------------------------------------------------------------------
// Cherry-pick

const CHERRY_HINTS = [
  'hint: After resolving the conflicts, mark them with',
  'hint: "git add/rm <pathspec>", then run',
  'hint: "git cherry-pick --continue".',
  'hint: You can instead skip this commit with "git cherry-pick --skip".',
  'hint: To abort and get back to the state before "git cherry-pick",',
  'hint: run "git cherry-pick --abort".',
  'hint: Disable this message with "git config set advice.mergeConflict false"',
];

/** Pick `ids` one by one. Stops on a conflict or an empty pick. Mutates the clone. */
function runPicks(state: SimState, repo: Repo, ids: string[], origHead: string, out: Line[], events: SimEvent[]): 'done' | 'stopped' | 'empty' {
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]!;
    const c = repo.commits[id]!;
    const r = pick(state, repo, id, { reflog: 'cherry-pick', summary: 'cherry-pick' });
    if (r.kind === 'conflict') {
      out.push(...r.out, line(`error: could not apply ${shortHash(id)}... ${subject(c.message)}`), ...lines(CHERRY_HINTS.join('\n')));
      repo.op = { kind: 'cherry-pick', commit: id, todo: ids.slice(i + 1), origHead };
      events.push({ type: 'conflict', op: 'cherry-pick', paths: r.paths });
      return 'stopped';
    }
    if (r.kind === 'empty') {
      out.push(...r.out);
      repo.op = { kind: 'cherry-pick', commit: id, todo: ids.slice(i + 1), origHead };
      return 'empty';
    }
    out.push(...r.out);
    events.push({ type: 'cherryPicked', from: id, id: r.id }, { type: 'commitCreated', id: r.id });
  }
  repo.op = null;
  return 'done';
}

function emptyPickLines(state: SimState, repo: Repo): Line[] {
  return [
    ...renderLongStatus(state, repo),
    ...lines(
      "The previous cherry-pick is now empty, possibly due to conflict resolution.\nIf you wish to commit it anyway, use:\n\n    git commit --allow-empty\n\nOtherwise, please use 'git cherry-pick --skip'",
    ),
  ];
}

function pickResult(state: SimState, next: SimState, outcome: 'done' | 'stopped' | 'empty', out: Line[], events: SimEvent[], first: Commit): CommandResult {
  const r = findRepo(next)!;
  if (outcome === 'empty') {
    return { state: next, output: [...out, ...emptyPickLines(next, r)], events, ok: false, stopped: true, explain: { key: 'sim.explain.cherryPickEmpty' } };
  }
  if (outcome === 'stopped') {
    const paths = Object.keys(r.conflicts);
    return {
      state: next,
      output: out,
      events,
      ok: false,
      stopped: true,
      explain: { key: 'sim.explain.cherryPickConflict', params: { file: paths[0] ?? '', count: String(paths.length) } },
    };
  }
  void state;
  return ok(next, out, events, { key: 'sim.explain.cherryPick', params: { hash: shortHash(first.id), message: subject(first.message) } });
}

export const cherryPick: CommandFn = (state, args) => {
  const repo = findRepo(state);
  if (!repo) return notARepo(state);
  const a = new Args(args, { flags: ['--abort', '--continue', '--skip', '--quit', '-x', '--no-commit', '-n', '-e', '--edit'], values: ['-m', '--mainline'] });
  if (a.unknown.length) return badOption(state, a.unknown[0]!);
  const op = repo.op?.kind === 'cherry-pick' ? repo.op : null;
  const none = () => fail(state, lines('error: no cherry-pick or revert in progress\nfatal: cherry-pick failed'), 'noCherryPick', { key: 'sim.err.noCherryPick' });
  if (a.has('--abort') || a.has('--quit')) {
    if (!op) return none();
    const next = clone(state);
    const r = findRepo(next)!;
    if (a.has('--abort')) {
      const target = r.commits[op.origHead]!.snapshot;
      resetTouched(next, r, target, false);
      // Commits picked earlier in this run are undone too.
      if (headId(r) !== op.origHead) {
        const changes: Record<string, string | null> = {};
        const cur = headTree(r);
        for (const p of new Set([...Object.keys(cur), ...Object.keys(target)])) if (cur[p] !== target[p]) changes[p] = target[p] ?? null;
        applyToWorking(next, r, changes);
        r.index = { ...target };
        moveHead(r, op.origHead, 'cherry-pick: abort');
      }
    }
    r.op = null;
    return ok(next, [], [{ type: 'opAborted', op: 'cherry-pick' }], { key: a.has('--abort') ? 'sim.explain.cherryPickAbort' : 'sim.explain.cherryPickQuit' });
  }
  if (a.has('--skip')) {
    if (!op) return none();
    const next = clone(state);
    const r = findRepo(next)!;
    resetTouched(next, r, headTree(r));
    r.op = null;
    if (!op.todo.length) return ok(next, [], [], { key: 'sim.explain.cherryPickSkip' });
    const out: Line[] = [];
    const events: SimEvent[] = [];
    const outcome = runPicks(next, r, op.todo, op.origHead, out, events);
    return pickResult(state, next, outcome, out, events, r.commits[op.todo[0]!]!);
  }
  if (a.has('--continue')) {
    if (!op) return none();
    return continueCherryPick(state, undefined);
  }
  if (a.has('--no-commit', '-n')) return fail(state, [], 'cherryNoCommit', { key: 'sim.err.mergeOptionLater', params: { option: '--no-commit' } });
  if (!a.positional.length) return fail(state, lines('usage: git cherry-pick [--edit] [-n] [-m <parent-number>] [-s] [-x] [--ff] <commit>...'), 'usage', { key: 'sim.err.cherryPickNeedCommit' });
  // Git reads the commits first.
  const ids: string[] = [];
  for (const rev of a.positional) {
    const res = resolveRev(repo, rev);
    if (!res.ok) return fail(state, lines(`fatal: bad revision '${rev}'`), 'badRevision', { key: 'sim.err.badRevision', params: { rev } });
    ids.push(res.id);
  }
  // A single pick may start even while another one is stopped; a sequence may not.
  if (op && ids.length > 1) {
    return fail(state, lines('error: cherry-pick is already in progress\nhint: try "git cherry-pick (--continue | --abort | --quit)"\nfatal: cherry-pick failed'), 'cherryPickBusy', {
      key: 'sim.err.cherryPickBusy',
    });
  }
  if (hasConflicts(repo)) return fail(state, unmergedCommitError(repo, 'Cherry-picking'), 'unmerged', { key: 'sim.err.unmerged' });
  for (const id of ids) {
    if (repo.commits[id]!.parents.length > 1) {
      return fail(state, lines(`error: commit ${id} is a merge but no -m option was given.\nfatal: cherry-pick failed`), 'pickMerge', { key: 'sim.err.cherryPickMerge' });
    }
  }
  const head = headId(repo);
  if (!head) return fail(state, lines("fatal: your current branch 'main' does not have any commits yet"), 'noCommits', { key: 'sim.err.noCommits' });
  const st = computeStatus(state, repo);
  if (st.staged.length || st.unstaged.length) {
    return fail(state, lines('error: your local changes would be overwritten by cherry-pick.\nhint: commit your changes or stash them to proceed.\nfatal: cherry-pick failed'), 'dirty', {
      key: 'sim.err.cherryPickDirty',
    });
  }
  if (!identity(state, repo)) return fail(state, lines('Committer identity unknown\n\n*** Please tell me who you are.'), 'noIdentity', { key: 'sim.err.noIdentity' });
  const next = clone(state);
  const r = findRepo(next)!;
  r.origHead = head;
  const out: Line[] = [];
  const events: SimEvent[] = [];
  const outcome = runPicks(next, r, ids, head, out, events);
  return pickResult(state, next, outcome, out, events, repo.commits[ids[0]!]!);
};

/** `git cherry-pick --continue` and `git commit` during a cherry-pick. */
export function continueCherryPick(state: SimState, message: string | undefined): CommandResult {
  const repo = findRepo(state)!;
  const op = repo.op as Extract<Operation, { kind: 'cherry-pick' }>;
  if (hasConflicts(repo)) return fail(state, unmergedCommitError(repo), 'unmerged', { key: 'sim.err.unmerged' });
  const next = clone(state);
  const r = findRepo(next)!;
  const c = r.commits[op.commit]!;
  const head = headId(r)!;
  const ours = headTree(r);
  if (sameTree(r.index, ours)) {
    return { state, output: emptyPickLines(state, repo), events: [{ type: 'error', code: 'emptyPick' }], ok: false, stopped: true, explain: { key: 'sim.explain.cherryPickEmpty' } };
  }
  const msg = message ?? c.message;
  const created = makeCommit(next, r, { message: msg, parents: [head], snapshot: r.index, author: c.author, timestamp: c.timestamp });
  moveHead(r, created.id, `commit (cherry-pick): ${subject(msg)}`);
  const where = r.head.type === 'branch' ? r.head.name : 'detached HEAD';
  const out: Line[] = [line(`[${where} ${shortHash(created.id)}] ${subject(msg)}`), line(` Date: ${gitDate(created.timestamp, next.tz)}`), ...commitStat(ours, created.snapshot)];
  const events: SimEvent[] = [{ type: 'cherryPicked', from: c.id, id: created.id }, { type: 'commitCreated', id: created.id }];
  r.op = null;
  if (op.todo.length) {
    const outcome = runPicks(next, r, op.todo, op.origHead, out, events);
    if (outcome !== 'done') return pickResult(state, next, outcome, out, events, c);
  }
  events.push({ type: 'opFinished', op: 'cherry-pick' });
  return ok(next, out, events, {
    key: message === undefined ? 'sim.explain.cherryPickContinue' : 'sim.explain.cherryPick',
    params: { hash: shortHash(c.id), message: subject(c.message) },
  });
}

// ---------------------------------------------------------------------------
// Rebase

const REBASE_HINTS = [
  'hint: Resolve all conflicts manually, mark them as resolved with',
  'hint: "git add/rm <conflicted_files>", then run "git rebase --continue".',
  'hint: You can instead skip this commit: run "git rebase --skip".',
  'hint: To abort and get back to the state before "git rebase", run "git rebase --abort".',
  'hint: Disable this message with "git config set advice.mergeConflict false"',
];

const REBASE_BUSY = `fatal: It seems that there is already a rebase-merge directory, and
I wonder if you are in the middle of another rebase.  If that is the
case, please try
\tgit rebase (--continue | --abort | --skip)
If that is not the case, please
\trm -fr ".git/rebase-merge"
and run me again.  I am stopping in case you still have something
valuable there.
`;

/** A canonical form of what a commit changes, to spot commits already applied upstream. */
function patchOf(repo: Repo, c: Commit): string {
  const before = c.parents[0] ? repo.commits[c.parents[0]]!.snapshot : {};
  const paths = [...new Set([...Object.keys(before), ...Object.keys(c.snapshot)])].sort();
  return JSON.stringify(paths.filter((p) => before[p] !== c.snapshot[p]).map((p) => [p, before[p] ?? null, c.snapshot[p] ?? null]));
}

export interface TodoItem {
  action: 'pick';
  commit: string;
  short: string;
  message: string;
}

/** Commits a rebase onto `ontoId` would replay (oldest first), and those skipped as already upstream. */
function rebaseCommits(repo: Repo, ontoId: string): { picks: Commit[]; skipped: Commit[] } {
  const head = headId(repo)!;
  const mine = topoOrder(walk(repo.commits, [head], [ontoId])).reverse().filter((c) => c.parents.length <= 1);
  const upstreamPatches = new Set(walk(repo.commits, [ontoId], [head]).filter((c) => c.parents.length <= 1).map((c) => patchOf(repo, c)));
  const picks: Commit[] = [];
  const skipped: Commit[] = [];
  for (const c of mine) (upstreamPatches.has(patchOf(repo, c)) ? skipped : picks).push(c);
  return { picks, skipped };
}

/** The todo list `git rebase -i <upstream>` would start with (oldest first). For the rebase card deck. */
export function rebaseTodo(state: SimState, upstream: string): TodoItem[] {
  const repo = findRepo(state);
  if (!repo || !headId(repo)) return [];
  const res = resolveRev(repo, upstream);
  if (!res.ok) return [];
  return rebaseCommits(repo, res.id).picks.map((c) => ({ action: 'pick', commit: c.id, short: shortHash(c.id), message: subject(c.message) }));
}

function cleanTreeError(state: SimState, repo: Repo, verb: string): CommandResult | null {
  const st = computeStatus(state, repo);
  const unstaged = st.unstaged.length > 0;
  const staged = st.staged.length > 0;
  if (!unstaged && !staged) return null;
  const text = unstaged && staged
    ? `error: cannot ${verb}: You have unstaged changes.\nerror: additionally, your index contains uncommitted changes.\nerror: Please commit or stash them.`
    : unstaged
      ? `error: cannot ${verb}: You have unstaged changes.\nerror: Please commit or stash them.`
      : `error: cannot ${verb}: Your index contains uncommitted changes.\nerror: Please commit or stash them.`;
  return fail(state, lines(text), 'dirty', { key: verb === 'rebase' ? 'sim.err.rebaseDirty' : 'sim.err.pullDirty' });
}

function finishRebase(state: SimState, repo: Repo, op: RebaseOp, out: Line[], events: SimEvent[]): void {
  const tip = headId(repo)!;
  if (op.branch) {
    repo.branches[op.branch] = tip;
    repo.head = { type: 'branch', name: op.branch };
    repo.detachedFrom = null;
    repo.reflog.unshift({ commit: tip, message: `rebase (finish): returning to refs/heads/${op.branch}` });
    out.push(line(`Successfully rebased and updated refs/heads/${op.branch}.`));
    events.push({ type: 'branchMoved', branch: op.branch, from: op.origHead, to: tip }, { type: 'headAttached', branch: op.branch });
  } else {
    out.push(line('Successfully rebased and updated detached HEAD.'));
  }
  repo.origHead = op.origHead;
  repo.op = null;
  void state;
  events.push({ type: 'opFinished', op: 'rebase' });
}

/** Run the todo list until it ends or stops. Mutates the clone. */
function runRebase(state: SimState, repo: Repo, out: Line[], events: SimEvent[], replayed: Record<string, string>): 'done' | 'stopped' {
  const op = repo.op as RebaseOp;
  while (op.todo.length) {
    const step = op.todo.shift()!;
    const c = repo.commits[step.commit]!;
    if (step.action === 'drop') {
      op.done.push(step);
      continue;
    }
    const squash = step.action === 'squash' || step.action === 'fixup';
    let message: string | undefined = step.message;
    if (squash) {
      const prev = op.squashMessage ?? repo.commits[headId(repo)!]!.message;
      message = step.message ?? (step.action === 'fixup' ? prev : `${prev}\n\n${c.message}`);
    }
    const r = pick(state, repo, step.commit, {
      ...(message !== undefined ? { message } : {}),
      squash,
      reflog: `rebase (${step.action})`,
      summary: 'none',
    });
    if (r.kind === 'conflict') {
      op.current = step;
      op.squashMessage = squash ? (message ?? null) : null;
      out.push(...r.out, line(`error: could not apply ${shortHash(c.id)}... ${subject(c.message)}`), ...lines(REBASE_HINTS.join('\n')));
      out.push(line(`Could not apply ${shortHash(c.id)}... # ${subject(c.message)}`));
      events.push({ type: 'conflict', op: 'rebase', paths: r.paths });
      return 'stopped';
    }
    op.done.push(step);
    op.squashMessage = null;
    if (r.kind === 'committed') {
      replayed[step.commit] = r.id;
      events.push({ type: 'commitCreated', id: r.id });
    }
  }
  return 'done';
}

function rebaseResult(state: SimState, next: SimState, outcome: 'done' | 'stopped', out: Line[], events: SimEvent[], replayed: Record<string, string>, from: string): CommandResult {
  const r = findRepo(next)!;
  if (outcome === 'stopped') {
    const paths = Object.keys(r.conflicts);
    return {
      state: next,
      output: out,
      events,
      ok: false,
      stopped: true,
      explain: { key: 'sim.explain.rebaseConflict', params: { file: paths[0] ?? '', count: String(paths.length) } },
    };
  }
  const op = r.op as RebaseOp;
  const branch = op.branch;
  finishRebase(next, r, op, out, events);
  events.unshift({ type: 'rebased', branch, from, to: headId(r)!, replayed });
  void state;
  return ok(next, out, events, { key: 'sim.explain.rebaseDone', params: { branch: branch ?? 'HEAD', count: String(Object.keys(replayed).length) } });
}

/** Start a rebase of HEAD onto `ontoId` with the given steps. */
function startRebase(state: SimState, ontoId: string, upstreamName: string, steps: RebaseStep[], skipped: Commit[]): CommandResult {
  const repo = findRepo(state)!;
  const head = headId(repo)!;
  const next = clone(state);
  const r = findRepo(next)!;
  const out: Line[] = [];
  for (const c of skipped) out.push(line(`warning: skipped previously applied commit ${shortHash(c.id)}`));
  if (skipped.length) {
    out.push(line('hint: use --reapply-cherry-picks to include skipped commits'), line('hint: Disable this message with "git config set advice.skippedCherryPicks false"'));
  }
  const op: RebaseOp = {
    kind: 'rebase',
    branch: r.head.type === 'branch' ? r.head.name : null,
    onto: ontoId,
    origHead: head,
    upstream: upstreamName,
    done: [],
    todo: steps.map((s) => ({ ...s })),
    current: null,
    squashMessage: null,
  };
  r.op = op;
  // Check out `onto` (detached), like Git's "rebase (start)".
  const target = r.commits[ontoId]!.snapshot;
  const cur = headTree(r);
  const changes: Record<string, string | null> = {};
  for (const p of new Set([...Object.keys(cur), ...Object.keys(target)])) if (cur[p] !== target[p]) changes[p] = target[p] ?? null;
  r.index = { ...target };
  applyToWorking(next, r, changes);
  r.head = { type: 'detached', commit: ontoId };
  r.detachedFrom = ontoId;
  r.reflog.unshift({ commit: ontoId, message: `rebase (start): checkout ${upstreamName}` });
  const events: SimEvent[] = [{ type: 'headDetached', commit: ontoId }, { type: 'headMoved', from: head, to: ontoId }];
  const replayed: Record<string, string> = {};
  const outcome = runRebase(next, r, out, events, replayed);
  return rebaseResult(state, next, outcome, out, events, replayed, head);
}

function checkCanRebase(state: SimState, repo: Repo, clean = true): CommandResult | null {
  if (repo.op?.kind === 'rebase') return fail(state, lines(REBASE_BUSY), 'rebaseBusy', { key: 'sim.err.rebaseBusy' });
  if (hasConflicts(repo)) return fail(state, unmergedCommitError(repo, 'Committing'), 'unmerged', { key: 'sim.err.unmerged' });
  if (!headId(repo)) return fail(state, lines("fatal: invalid upstream 'HEAD'"), 'noCommits', { key: 'sim.err.noCommits' });
  return clean ? cleanTreeError(state, repo, 'rebase') : null;
}

/** Rebase HEAD onto `upstream` (a revision). Shared by `git rebase` and `git pull --rebase`. */
export function rebaseOnto(state: SimState, upstream: string, ontoId: string): CommandResult {
  const repo = findRepo(state)!;
  const head = headId(repo)!;
  const branchName = repo.head.type === 'branch' ? repo.head.name : 'HEAD';
  // Already on top of `onto` with a straight line of commits: nothing to replay.
  const linear = walk(repo.commits, [head], [ontoId]).every((c) => c.parents.length <= 1);
  if (isAncestorOf(repo.commits, ontoId, head) && linear) {
    const text = repo.head.type === 'branch' ? `Current branch ${branchName} is up to date.` : 'HEAD is up to date.';
    return ok(state, [line(text)], [], { key: 'sim.explain.rebaseUpToDate', params: { branch: branchName } });
  }
  const { picks, skipped } = rebaseCommits(repo, ontoId);
  if (picks.length === 0 && !skipped.length && isAncestorOf(repo.commits, head, ontoId)) {
    // Nothing of ours to replay: just move forward.
    return startRebase(state, ontoId, upstream, [], []);
  }
  return startRebase(state, ontoId, upstream, picks.map((c) => ({ action: 'pick', commit: c.id })), skipped);
}

export const rebase: CommandFn = (state, args) => {
  const repo = findRepo(state);
  if (!repo) return notARepo(state);
  const a = new Args(args, { flags: ['--continue', '--abort', '--skip', '--quit', '-i', '--interactive', '--edit-todo', '-q', '--quiet'], values: ['--onto'] });
  if (a.has('-i', '--interactive', '--edit-todo')) {
    return fail(state, [], 'rebaseInteractive', { key: 'sim.err.rebaseInteractive' });
  }
  if (a.unknown.length) return badOption(state, a.unknown[0]!);
  if (a.get('--onto') !== undefined) return fail(state, [], 'rebaseOnto', { key: 'sim.err.mergeOptionLater', params: { option: '--onto' } });
  const op = repo.op?.kind === 'rebase' ? repo.op : null;
  if (a.has('--abort', '--quit', '--continue', '--skip') && !op) {
    return fail(state, lines('fatal: No rebase in progress?'), 'noRebase', { key: 'sim.err.noRebase' });
  }
  if (a.has('--abort') || a.has('--quit')) {
    const next = clone(state);
    const r = findRepo(next)!;
    const o = r.op as RebaseOp;
    if (a.has('--abort')) {
      const target = r.commits[o.origHead]!.snapshot;
      const cur = headTree(r);
      const changes: Record<string, string | null> = {};
      for (const p of new Set([...Object.keys(cur), ...Object.keys(target), ...Object.keys(r.conflicts), ...Object.keys(r.index)])) {
        changes[p] = target[p] ?? null;
      }
      applyToWorking(next, r, changes);
      r.index = { ...target };
      r.conflicts = {};
      if (o.branch) {
        r.branches[o.branch] = o.origHead;
        r.head = { type: 'branch', name: o.branch };
        r.detachedFrom = null;
        r.reflog.unshift({ commit: o.origHead, message: `rebase (abort): returning to refs/heads/${o.branch}` });
      } else {
        r.head = { type: 'detached', commit: o.origHead };
        r.reflog.unshift({ commit: o.origHead, message: 'rebase (abort): returning to HEAD' });
      }
    }
    r.op = null;
    const events: SimEvent[] = [{ type: 'opAborted', op: 'rebase' }];
    if (a.has('--abort')) events.push({ type: 'headMoved', from: headId(repo), to: o.origHead });
    return ok(next, [], events, { key: a.has('--abort') ? 'sim.explain.rebaseAbort' : 'sim.explain.rebaseQuit' });
  }
  if (a.has('--skip')) {
    const next = clone(state);
    const r = findRepo(next)!;
    const o = r.op as RebaseOp;
    resetTouched(next, r, headTree(r), true);
    if (o.current) o.done.push({ ...o.current, action: 'drop' });
    o.current = null;
    o.squashMessage = null;
    const out: Line[] = [];
    const events: SimEvent[] = [];
    const replayed: Record<string, string> = {};
    const outcome = runRebase(next, r, out, events, replayed);
    return rebaseResult(state, next, outcome, out, events, replayed, o.origHead);
  }
  if (a.has('--continue')) return continueRebase(state, undefined);
  // Git checks the upstream before it looks at your local changes.
  const busy = checkCanRebase(state, repo, false);
  if (busy) return busy;
  let upstream = a.positional[0];
  if (!upstream) {
    const up = repo.head.type === 'branch' ? upstreamOf(repo, repo.head.name) : null;
    const tip = up ? upstreamTip(repo, up) : null;
    if (!up || !tip) {
      const branch = repo.head.type === 'branch' ? repo.head.name : '<branch>';
      return fail(
        state,
        lines(
          `There is no tracking information for the current branch.\nPlease specify which branch you want to rebase against.\nSee git-rebase(1) for details.\n\n    git rebase '<branch>'\n\nIf you wish to set tracking information for this branch you can do so with:\n\n    git branch --set-upstream-to=<remote>/<branch> ${branch}\n`,
        ),
        'noUpstream',
        { key: 'sim.err.rebaseNeedUpstream' },
      );
    }
    upstream = up.ref;
  }
  const res = resolveRev(repo, upstream);
  if (!res.ok) return fail(state, lines(`fatal: invalid upstream '${upstream}'`), 'badUpstream', { key: 'sim.err.rebaseBadUpstream', params: { rev: upstream } });
  const dirty = cleanTreeError(state, repo, 'rebase');
  if (dirty) return dirty;
  return rebaseOnto(state, upstream, res.id);
};

/** `git rebase --continue` (and `git commit` during a stopped rebase, with a message). */
export function continueRebase(state: SimState, message: string | undefined, commitOnly = false): CommandResult {
  const repo = findRepo(state)!;
  if (hasConflicts(repo)) {
    if (commitOnly) return fail(state, unmergedCommitError(repo), 'unmerged', { key: 'sim.err.unmerged' });
    const needs = Object.keys(repo.conflicts).sort().map((p) => `${p}: needs merge`);
    return fail(state, lines(`${needs.join('\n')}\nYou must edit all merge conflicts and then\nmark them as resolved using git add`), 'unmerged', { key: 'sim.err.rebaseContinueConflicts' });
  }
  const next = clone(state);
  const r = findRepo(next)!;
  const op = r.op as RebaseOp;
  const out: Line[] = [];
  const events: SimEvent[] = [];
  const replayed: Record<string, string> = {};
  const step = op.current;
  if (step) {
    const c = r.commits[step.commit]!;
    const head = headId(r)!;
    const headCommit = r.commits[head]!;
    const squash = step.action === 'squash' || step.action === 'fixup';
    const ours = squash ? (headCommit.parents[0] ? r.commits[headCommit.parents[0]]!.snapshot : {}) : headCommit.snapshot;
    if (squash || !sameTree(r.index, headCommit.snapshot)) {
      const msg = message ?? (squash ? (op.squashMessage ?? headCommit.message) : (step.message ?? c.message));
      const created = makeCommit(next, r, {
        message: msg,
        parents: squash ? [...headCommit.parents] : [head],
        snapshot: r.index,
        author: squash ? headCommit.author : c.author,
        timestamp: squash ? headCommit.timestamp : c.timestamp,
      });
      moveHead(r, created.id, `rebase (continue): ${subject(msg)}`);
      out.push(line(`[detached HEAD ${shortHash(created.id)}] ${subject(msg)}`), ...commitStat(ours, created.snapshot));
      replayed[step.commit] = created.id;
      events.push({ type: 'commitCreated', id: created.id });
    }
    op.done.push(step);
    op.current = null;
    op.squashMessage = null;
  }
  if (commitOnly) {
    return ok(next, out, events, { key: 'sim.explain.rebaseCommitted' });
  }
  const outcome = runRebase(next, r, out, events, replayed);
  return rebaseResult(state, next, outcome, out, events, replayed, op.origHead);
}

/**
 * Interactive rebase without an editor, for the card-deck UI: replay `todo`
 * (oldest first) onto `upstream`. Stops on conflicts exactly like `git rebase`.
 */
export function rebaseInteractive(state: SimState, upstream: string, todo: RebaseStep[]): CommandResult {
  const repo = findRepo(state);
  if (!repo) return notARepo(state);
  const busy = checkCanRebase(state, repo);
  if (busy) return busy;
  const res = resolveRev(repo, upstream);
  if (!res.ok) return fail(state, lines(`fatal: invalid upstream '${upstream}'`), 'badUpstream', { key: 'sim.err.rebaseBadUpstream', params: { rev: upstream } });
  const steps: RebaseStep[] = [];
  for (const s of todo) {
    const found = resolveRev(repo, s.commit);
    if (!found.ok) return fail(state, lines(`error: invalid line: ${s.action} ${s.commit}`), 'badTodo', { key: 'sim.err.badRevision', params: { rev: s.commit } });
    steps.push({ ...s, commit: found.id });
  }
  const firstKept = steps.find((s) => s.action !== 'drop');
  if (firstKept && (firstKept.action === 'squash' || firstKept.action === 'fixup')) {
    return fail(state, lines(`error: cannot '${firstKept.action}' without a previous commit`), 'badTodo', { key: 'sim.err.rebaseSquashFirst' });
  }
  return startRebase(state, res.id, upstream, steps, []);
}

/** For `git pull` with diverged history. */
export function aheadBehindOf(repo: Repo, a: string, b: string): { ahead: number; behind: number } {
  return countAheadBehind(repo.commits, a, b);
}

export { cleanTreeError };
