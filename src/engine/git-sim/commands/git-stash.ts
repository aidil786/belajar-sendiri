// git stash: push (-m, -u), list, show, pop, apply, drop, clear.
// Like real Git, a stash is a set of commits: WIP (working tree), index, and untracked.
import { mergeTrees } from '../merge';
import { shortHash } from '../hash';
import { fail, line, lines, notARepo, ok } from '../output';
import { Args } from '../parse';
import { computeStatus } from '../status';
import { clone, findRepo, headId, identity, makeCommit, subject, workingTree } from '../state';
import type { CommandFn, CommandResult, FileMap, Line, Repo, SimEvent, SimState, StashEntry } from '../types';
import { applyToWorking, blockingChanges, renderLongStatus, statLines, treeDiff } from './common';

function badOption(state: SimState, opt: string): CommandResult {
  return fail(state, lines(`error: unknown option '${opt.replace(/^-+/, '')}'`), 'badOption', {
    key: 'sim.err.badOption',
    params: { option: opt },
  });
}

function needsMerge(state: SimState, repo: Repo, kept: boolean): CommandResult {
  const out = Object.keys(repo.conflicts).sort().map((p) => line(`${p}: needs merge`));
  if (kept) out.push(line('The stash entry is kept in case you need it again.'));
  return fail(state, out, 'unmerged', { key: 'sim.err.stashConflicts' });
}

const SUBS = ['push', 'save', 'list', 'show', 'pop', 'apply', 'drop', 'clear', 'branch', 'create', 'store'];

export const stash: CommandFn = (state, args) => {
  const repo = findRepo(state);
  if (!repo) return notARepo(state);
  const sub = SUBS.includes(args[0] ?? '') ? args[0]! : 'push';
  const rest = SUBS.includes(args[0] ?? '') ? args.slice(1) : args;
  switch (sub) {
    case 'push':
    case 'save':
      return push(state, repo, rest, sub === 'save');
    case 'list':
      return list(state, repo);
    case 'show':
      return show(state, repo, rest);
    case 'pop':
    case 'apply':
      return apply(state, repo, rest, sub === 'pop');
    case 'drop':
      return drop(state, repo, rest);
    case 'clear': {
      const next = clone(state);
      findRepo(next)!.stash = [];
      return ok(next, [], [], { key: 'sim.explain.stashClear' });
    }
    default:
      return fail(state, [], 'stashLater', { key: 'sim.err.mergeOptionLater', params: { option: `stash ${sub}` } });
  }
};

function push(state: SimState, repo: Repo, args: string[], save: boolean): CommandResult {
  const a = new Args(args, { flags: ['-u', '--include-untracked', '-q', '--quiet', '-k', '--keep-index'], values: ['-m', '--message'], combined: true });
  if (a.unknown.length) return badOption(state, a.unknown[0]!);
  if (a.has('-k', '--keep-index')) return fail(state, [], 'stashLater', { key: 'sim.err.mergeOptionLater', params: { option: '--keep-index' } });
  let message = a.get('-m', '--message');
  if (save && a.positional.length) message = a.positional.join(' ');
  else if (a.positional.length) return fail(state, [], 'stashPaths', { key: 'sim.err.stashPaths' });
  if (Object.keys(repo.conflicts).length) return needsMerge(state, repo, false);
  const head = headId(repo);
  if (!head) return fail(state, lines('You do not have the initial commit yet'), 'noCommits', { key: 'sim.err.stashNoCommit' });
  const withUntracked = a.has('-u', '--include-untracked');
  const st = computeStatus(state, repo);
  const untrackedPaths = withUntracked ? st.untracked : [];
  if (!st.staged.length && !st.unstaged.length && !untrackedPaths.length) {
    return ok(state, [line('No local changes to save')], [], { key: 'sim.explain.stashNothing' });
  }
  const author = identity(state, repo);
  if (!author) return fail(state, lines('Author identity unknown\n\n*** Please tell me who you are.'), 'noIdentity', { key: 'sim.err.noIdentity' });
  const next = clone(state);
  const r = findRepo(next)!;
  const headCommit = r.commits[head]!;
  const branch = r.head.type === 'branch' ? r.head.name : '(no branch)';
  const where = `${branch}: ${shortHash(head)} ${subject(headCommit.message)}`;
  const work = workingTree(next, r);
  const index = { ...r.index };
  const working: FileMap = {};
  for (const p of Object.keys(index)) if (p in work) working[p] = work[p]!;
  const untracked: FileMap = {};
  for (const p of untrackedPaths) untracked[p] = work[p]!;
  const text = message !== undefined ? `On ${branch}: ${message}` : `WIP on ${where}`;
  const indexCommit = makeCommit(next, r, { message: `index on ${where}`, parents: [head], snapshot: index, author });
  const untrackedCommit = withUntracked && untrackedPaths.length
    ? makeCommit(next, r, { message: `untracked files on ${where}`, parents: [], snapshot: untracked, author })
    : null;
  const wip = makeCommit(next, r, {
    message: text,
    parents: [head, indexCommit.id, ...(untrackedCommit ? [untrackedCommit.id] : [])],
    snapshot: working,
    author,
  });
  const entry: StashEntry = { message: text, base: head, id: wip.id, indexId: indexCommit.id, untrackedId: untrackedCommit?.id ?? null, index, working, untracked };
  r.stash.unshift(entry);
  // Then `git reset --hard` (and remove the untracked files that were saved).
  const tree = headCommit.snapshot;
  const changes: Record<string, string | null> = {};
  for (const p of new Set([...Object.keys(index), ...Object.keys(tree)])) if (work[p] !== tree[p]) changes[p] = tree[p] ?? null;
  for (const p of untrackedPaths) changes[p] = null;
  r.index = { ...tree };
  applyToWorking(next, r, changes);
  r.reflog.unshift({ commit: head, message: 'reset: moving to HEAD' });
  const out = a.has('-q', '--quiet') ? [] : [line(`Saved working directory and index state ${text}`)];
  return ok(next, out, [{ type: 'stashSaved', id: wip.id }], {
    key: withUntracked ? 'sim.explain.stashPushUntracked' : 'sim.explain.stashPush',
    params: { message: text },
  });
}

function list(state: SimState, repo: Repo): CommandResult {
  const out: Line[] = repo.stash.map((e, i) => [{ t: `stash@{${i}}`, c: 'yellow' }, { t: `: ${e.message}` }]);
  return ok(state, out, [], { key: out.length ? 'sim.explain.stashList' : 'sim.explain.stashListEmpty' });
}

/** Which entry an argument like "stash@{1}" or "1" means. */
function pickEntry(state: SimState, repo: Repo, arg: string | undefined): { index: number; name: string } | CommandResult {
  if (repo.stash.length === 0) {
    if (arg === undefined) return fail(state, lines('No stash entries found.'), 'noStash', { key: 'sim.err.noStash' });
    return fail(state, lines(`error: ${arg} is not a valid reference`), 'badStash', { key: 'sim.err.noStash' });
  }
  if (arg === undefined) return { index: 0, name: 'refs/stash@{0}' };
  const m = /^(?:(?:refs\/)?stash@\{(\d+)\}|(\d+))$/.exec(arg);
  if (!m) return fail(state, lines(`error: ${arg} is not a valid reference`), 'badStash', { key: 'sim.err.badStash', params: { ref: arg } });
  const n = Number(m[1] ?? m[2]);
  if (n >= repo.stash.length) {
    return fail(state, lines(`fatal: log for 'stash' only has ${repo.stash.length} entries`), 'badStash', { key: 'sim.err.badStash', params: { ref: arg } });
  }
  return { index: n, name: m[2] !== undefined ? `stash@{${n}}` : arg };
}

function show(state: SimState, repo: Repo, args: string[]): CommandResult {
  const a = new Args(args, { flags: ['-p', '--patch', '--stat'] });
  if (a.unknown.length) return badOption(state, a.unknown[0]!);
  const which = pickEntry(state, repo, a.positional[0]);
  if ('state' in which) return which;
  const e = repo.stash[which.index]!;
  const base = repo.commits[e.base]!.snapshot;
  const out = a.has('-p', '--patch') ? treeDiff(base, e.working) : statLines(base, e.working);
  return ok(state, out, [], { key: 'sim.explain.stashShow' });
}

function drop(state: SimState, repo: Repo, args: string[]): CommandResult {
  const which = pickEntry(state, repo, args.find((x) => !x.startsWith('-')));
  if ('state' in which) return which;
  const next = clone(state);
  const r = findRepo(next)!;
  const [gone] = r.stash.splice(which.index, 1);
  return ok(next, [line(`Dropped ${which.name} (${gone!.id})`)], [{ type: 'stashDropped', id: gone!.id }], { key: 'sim.explain.stashDrop' });
}

function apply(state: SimState, repo: Repo, args: string[], pop: boolean): CommandResult {
  const a = new Args(args, { flags: ['--index', '-q', '--quiet'] });
  if (a.unknown.length) return badOption(state, a.unknown[0]!);
  const which = pickEntry(state, repo, a.positional[0]);
  if ('state' in which) return which;
  if (Object.keys(repo.conflicts).length) return needsMerge(state, repo, pop);
  const e = repo.stash[which.index]!;
  const base = repo.commits[e.base]!.snapshot;
  const current = { ...repo.index };
  const res = mergeTrees(base, current, e.working, { ours: 'Updated upstream', theirs: 'Stashed changes' });
  const kept = pop ? [line('The stash entry is kept in case you need it again.')] : [];
  // Local changes in files the stash touches block it, like a merge.
  const { dirty } = blockingChanges(state, repo, res.working);
  const work = workingTree(state, repo);
  const reallyDirty = dirty.filter((p) => work[p] !== repo.index[p]);
  const untrackedClash = Object.keys(e.untracked).filter((p) => p in work);
  if (reallyDirty.length) {
    return fail(
      state,
      [
        ...lines(`error: Your local changes to the following files would be overwritten by merge:\n${reallyDirty.map((p) => `\t${p}`).join('\n')}\nPlease commit your changes or stash them before you merge.\nAborting`),
        ...renderLongStatus(state, repo),
        ...kept,
      ],
      'localChanges',
      { key: 'sim.err.stashDirty' },
    );
  }
  if (untrackedClash.length) {
    return fail(state, [...untrackedClash.map((p) => line(`${p} already exists, no checkout`)), line('error: could not restore untracked files from stash'), ...kept], 'untrackedClash', {
      key: 'sim.err.stashUntracked',
    });
  }
  const next = clone(state);
  const r = findRepo(next)!;
  const tracked = { ...r.index };
  // Working files: merge result for tracked files (only where it changes something).
  const changes: Record<string, string | null> = {};
  for (const p of new Set([...Object.keys(tracked), ...Object.keys(res.working)])) {
    if ((work[p] ?? null) !== (res.working[p] ?? null) && (tracked[p] !== res.working[p] || Object.hasOwn(res.conflicts, p))) {
      changes[p] = res.working[p] ?? null;
    }
  }
  for (const [p, v] of Object.entries(e.untracked)) changes[p] = v;
  applyToWorking(next, r, changes);
  const conflicted = Object.keys(res.conflicts);
  if (conflicted.length) {
    r.index = { ...res.index };
    r.conflicts = { ...res.conflicts };
  } else if (a.has('--index')) {
    r.index = { ...e.index };
  } else {
    // Without --index the box is left as it was, except files the stash added stay added.
    const newIndex = { ...tracked };
    for (const [p, v] of Object.entries(res.index)) if (!(p in tracked) && !(p in base)) newIndex[p] = v;
    for (const p of Object.keys(tracked)) if (!(p in res.index) && p in base && !(p in e.working)) delete newIndex[p];
    r.index = newIndex;
  }
  const out: Line[] = [];
  const quiet = a.has('-q', '--quiet');
  const upToDate = JSON.stringify(Object.entries(e.working).sort()) === JSON.stringify(Object.entries(base).sort());
  if (!quiet) {
    if (upToDate) out.push(line('Already up to date.'));
    out.push(...res.messages, ...renderLongStatus(next, r));
  }
  const events: SimEvent[] = [];
  if (conflicted.length) {
    events.push({ type: 'conflict', op: 'stash', paths: conflicted });
    return { state: next, output: [...out, ...kept], events, ok: false, stopped: true, explain: { key: 'sim.explain.stashConflict', params: { file: conflicted[0]! } } };
  }
  if (pop) {
    const [gone] = r.stash.splice(which.index, 1);
    if (!quiet) out.push(line(`Dropped ${which.name} (${gone!.id})`));
    events.push({ type: 'stashDropped', id: gone!.id });
  }
  events.unshift({ type: 'stashApplied', dropped: pop });
  return ok(next, out, events, { key: pop ? 'sim.explain.stashPop' : 'sim.explain.stashApply' });
}
