// git restore, reset, revert, checkout, switch, clean.
import { shortHash } from '../hash';
import { fail, line, lines, notARepo, ok } from '../output';
import { Args } from '../parse';
import { isValidBranchName, trackingLines } from '../refs';
import { previousBranch, resolveRev } from '../revision';
import { mergeTrees } from '../merge';
import { computeStatus, collapseUntracked } from '../status';
import {
  branchUsedElsewhere,
  clone,
  deleteFile,
  findRepo,
  headId,
  headTree,
  identity,
  makeCommit,
  moveHead,
  pruneEmptyDirs,
  remoteNames,
  subject,
  upstreamOf,
  workingTree,
} from '../state';
import { displayPath } from '../paths';
import type { CommandFn, CommandResult, FileMap, Line, Repo, SimEvent, SimState } from '../types';
import { applyToWorking, commitStat, matches, orphanedFromHead, outsideRepo, shortLine, switchTrees, toPathspec } from './common';
import { autoTrack } from './git-branch';

function badOption(state: SimState, opt: string): CommandResult {
  return fail(state, lines(`error: unknown option '${opt.replace(/^-+/, '')}'`), 'badOption', {
    key: 'sim.err.badOption',
    params: { option: opt },
  });
}

function badRevision(state: SimState, rev: string): CommandResult {
  return fail(state, lines(`fatal: invalid reference: ${rev}`), 'badRevision', { key: 'sim.err.badRevision', params: { rev } });
}

// ---------------------------------------------------------------------------

export const restore: CommandFn = (state, args) => {
  const repo = findRepo(state);
  if (!repo) return notARepo(state);
  const a = new Args(args, {
    flags: ['--staged', '-S', '--worktree', '-W', '-q', '--quiet'],
    values: ['--source', '-s'],
    combined: true,
  });
  if (a.unknown.length) return badOption(state, a.unknown[0]!);
  if (a.positional.length === 0) {
    return fail(state, lines('fatal: you must specify path(s) to restore'), 'needPath', { key: 'sim.err.restoreNeedPath' });
  }
  const staged = a.has('--staged', '-S');
  const worktree = a.has('--worktree', '-W') || !staged;
  const sourceRev = a.get('--source', '-s');

  let source: FileMap;
  if (sourceRev) {
    const res = resolveRev(repo, sourceRev);
    if (!res.ok) return badRevision(state, sourceRev);
    source = repo.commits[res.id]!.snapshot;
  } else if (staged) {
    source = headTree(repo);
  } else {
    source = repo.index;
  }

  const work = workingTree(state, repo);
  const next = clone(state);
  const r = findRepo(next)!;
  const events: SimEvent[] = [];
  const changed: string[] = [];
  for (const raw of a.positional) {
    const spec = toPathspec(state, repo, raw);
    if (spec.outside) return outsideRepo(state, spec, repo);
    // Paths known to Git: in the source, the index, or (for staged) HEAD.
    const known = new Set<string>([...Object.keys(source), ...Object.keys(repo.index)]);
    if (worktree && sourceRev) for (const p of Object.keys(work)) if (p in repo.index) known.add(p);
    for (const p of Object.keys(repo.conflicts)) known.add(p);
    const hits = [...known].filter((p) => matches(spec, p));
    if (hits.length === 0) {
      return fail(state, lines(`error: pathspec '${raw}' did not match any file(s) known to git`), 'pathspecNoMatch', {
        key: 'sim.err.pathspecKnown',
        params: { path: raw },
      });
    }
    const unmerged = hits.filter((p) => Object.hasOwn(repo.conflicts, p));
    if (unmerged.length && worktree && !sourceRev) {
      return fail(state, unmerged.map((p) => line(`error: path '${p}' is unmerged`)), 'unmergedPath', {
        key: 'sim.err.pathUnmerged',
        params: { path: unmerged[0]! },
      });
    }
    for (const p of hits) {
      if (Object.hasOwn(r.conflicts, p)) {
        delete r.conflicts[p];
        events.push({ type: 'conflictResolved', path: p });
      }
      if (staged) {
        if (p in source) {
          if (r.index[p] !== source[p]) {
            r.index[p] = source[p]!;
            events.push({ type: 'fileUnstaged', path: p });
            changed.push(p);
          }
        } else if (p in r.index) {
          delete r.index[p];
          events.push({ type: 'fileUnstaged', path: p });
          changed.push(p);
        }
      }
      if (worktree) {
        // Without --source, `restore` only touches tracked files.
        if (!sourceRev && !staged && !(p in repo.index)) continue;
        const want = source[p];
        const abs = `${r.root}/${p}`;
        if (want === undefined) {
          if (abs in next.fs.files) {
            applyToWorking(next, r, { [p]: null });
            events.push({ type: 'fileRestored', path: p });
            changed.push(p);
          }
        } else if (next.fs.files[abs] !== want) {
          applyToWorking(next, r, { [p]: want });
          events.push({ type: 'fileRestored', path: p });
          changed.push(p);
        }
      }
    }
  }
  const key = staged && worktree ? 'sim.explain.restoreBoth' : staged ? 'sim.explain.restoreStaged' : 'sim.explain.restore';
  return ok(next, [], events, { key, params: { file: changed[0] ?? a.positional[0]! } });
};

// ---------------------------------------------------------------------------

function unstagedSummary(state: SimState, repo: Repo): Line[] {
  const st = computeStatus(state, repo);
  if (!st.unstaged.length) return [];
  return [
    line('Unstaged changes after reset:'),
    ...st.unstaged.map((e) => line(`${e.kind === 'modified' ? 'M' : 'D'}\t${displayPath(e.path, repo.root, state.cwd)}`)),
  ];
}

export const reset: CommandFn = (state, args) => {
  const repo = findRepo(state);
  if (!repo) return notARepo(state);
  const a = new Args(args, { flags: ['--soft', '--mixed', '--hard', '-q', '--quiet', '--keep', '--merge'] });
  if (a.unknown.length) return badOption(state, a.unknown[0]!);
  if (a.has('--keep', '--merge')) {
    return fail(state, lines('This practice terminal knows --soft, --mixed and --hard.'), 'resetMode', { key: 'sim.err.resetMode' });
  }
  const modes = (['--soft', '--mixed', '--hard'] as const).filter((m) => a.has(m));
  if (modes.length > 1) return fail(state, lines('fatal: --soft, --mixed and --hard cannot be used together'), 'resetModes');
  const mode = (modes[0]?.slice(2) ?? 'mixed') as 'soft' | 'mixed' | 'hard';

  // First word is a commit if it resolves (and isn't after --); the rest are paths.
  let revArg: string | undefined;
  const paths: string[] = [];
  a.positional.forEach((p, i) => {
    if (i === 0 && i < a.beforeDashDash && resolveRev(repo, p).ok) revArg = p;
    else paths.push(p);
  });
  const head = headId(repo);

  if (paths.length) {
    if (mode === 'soft') return fail(state, lines('fatal: Cannot do soft reset with paths.'), 'softPaths');
    if (mode === 'hard') return fail(state, lines('fatal: Cannot do hard reset with paths.'), 'hardPaths');
    const revRes = revArg ? resolveRev(repo, revArg) : null;
    const source = revRes && revRes.ok ? repo.commits[revRes.id]!.snapshot : headTree(repo);
    const next = clone(state);
    const r = findRepo(next)!;
    const events: SimEvent[] = [];
    for (const raw of paths) {
      const spec = toPathspec(state, repo, raw);
      if (spec.outside) return outsideRepo(state, spec, repo);
      const hits = [...new Set([...Object.keys(source), ...Object.keys(repo.index), ...Object.keys(repo.conflicts)])].filter((p) => matches(spec, p));
      if (hits.length === 0) {
        if (!revArg && !resolveRev(repo, raw).ok && !(`${repo.root}/${raw}` in state.fs.files)) {
          return fail(
            state,
            lines(`fatal: ambiguous argument '${raw}': unknown revision or path not in the working tree.`),
            'badRevision',
            { key: 'sim.err.badRevision', params: { rev: raw } },
          );
        }
        continue;
      }
      for (const p of hits) {
        if (p in source) r.index[p] = source[p]!;
        else delete r.index[p];
        if (Object.hasOwn(r.conflicts, p)) {
          delete r.conflicts[p];
          events.push({ type: 'conflictResolved', path: p });
        }
        events.push({ type: 'fileUnstaged', path: p });
      }
    }
    return ok(next, a.has('-q', '--quiet') ? [] : unstagedSummary(next, r), events, {
      key: 'sim.explain.resetPath',
      params: { file: paths[0]! },
    });
  }

  let target: string | null = head;
  if (revArg) {
    const res = resolveRev(repo, revArg);
    if (res.ok) target = res.id;
  }
  else if (a.positional[0] && a.beforeDashDash > 0) return badRevision(state, a.positional[0]);
  if (mode === 'soft' && (repo.op?.kind === 'merge' || Object.keys(repo.conflicts).length)) {
    return fail(state, lines('fatal: Cannot do a soft reset in the middle of a merge.'), 'softMerge', { key: 'sim.err.resetSoftMerge' });
  }
  const next = clone(state);
  const r = findRepo(next)!;
  const events: SimEvent[] = [];
  // A reset ends a stopped merge or cherry-pick (not a rebase) and clears conflicts.
  const conflictPaths = Object.keys(r.conflicts);
  if (mode !== 'soft') r.conflicts = {};
  if (r.op && r.op.kind !== 'rebase') {
    events.push({ type: 'opAborted', op: r.op.kind });
    r.op = null;
  }

  if (!target) {
    // Unborn branch: only the index can be reset.
    if (mode === 'soft') return ok(state);
    for (const p of Object.keys(r.index)) events.push({ type: 'fileUnstaged', path: p });
    r.index = {};
    return ok(next, [], events, { key: 'sim.explain.resetMixed', params: { rev: 'HEAD' } });
  }

  const snapshot = r.commits[target]!.snapshot;
  const oldIndex = { ...r.index };
  // Git writes a reflog line even when HEAD stays put.
  r.origHead = head;
  moveHead(r, target, `reset: moving to ${revArg ?? 'HEAD'}`);
  if (r.head.type === 'branch') events.push({ type: 'branchMoved', branch: r.head.name, from: head, to: target });
  events.push({ type: 'headMoved', from: head, to: target });
  if (mode !== 'soft') r.index = { ...snapshot };
  if (mode === 'hard') {
    const changes: Record<string, string | null> = {};
    for (const p of new Set([...Object.keys(oldIndex), ...Object.keys(snapshot), ...conflictPaths])) changes[p] = snapshot[p] ?? null;
    applyToWorking(next, r, changes);
  }
  events.push({ type: 'resetApplied', mode, to: target });

  const c = r.commits[target]!;
  const out: Line[] = a.has('-q', '--quiet')
    ? []
    : mode === 'hard'
      ? [line(`HEAD is now at ${shortLine(c)}`)]
      : mode === 'mixed'
        ? unstagedSummary(next, r)
        : [];
  return ok(next, out, events, {
    key: `sim.explain.reset${mode[0]!.toUpperCase()}${mode.slice(1)}`,
    params: { rev: revArg ?? 'HEAD', hash: shortHash(target) },
  });
};

// ---------------------------------------------------------------------------

export const revert: CommandFn = (state, args) => {
  const repo = findRepo(state);
  if (!repo) return notARepo(state);
  const a = new Args(args, { flags: ['--no-edit', '--edit', '-e', '--no-commit', '-n'], values: ['-m', '--mainline'] });
  if (a.unknown.length) return badOption(state, a.unknown[0]!);
  // -m <n>: undo a merge commit, keeping parent n's side (World 11 "merge panic").
  const mainlineArg = a.get('-m', '--mainline');
  const mainline = mainlineArg === undefined ? undefined : Number(mainlineArg);
  if (a.has('--no-commit', '-n')) {
    return fail(state, lines('This practice terminal makes the revert commit straight away. Try without -n.'), 'revertNoCommit');
  }
  const rev = a.positional[0];
  if (!rev) return fail(state, lines('usage: git revert [--[no-]edit] <commit>...'), 'usage', { key: 'sim.err.revertNeedCommit' });
  if (a.positional.length > 1) {
    return fail(state, lines('This practice terminal reverts one commit at a time.'), 'revertMany', { key: 'sim.err.revertMany' });
  }
  const res = resolveRev(repo, rev);
  if (!res.ok) return fail(state, lines(`fatal: bad revision '${rev}'`), 'badRevision', { key: 'sim.err.badRevision', params: { rev } });
  const author = identity(state, repo);
  if (!author) return fail(state, lines('Author identity unknown\n\n*** Please tell me who you are.'), 'noIdentity', { key: 'sim.err.noIdentity' });

  const st = computeStatus(state, repo);
  if (st.staged.length || st.unstaged.length) {
    return fail(
      state,
      lines(
        'error: your local changes would be overwritten by revert.\nhint: commit your changes or stash them to proceed.\nfatal: revert failed',
      ),
      'dirty',
      { key: 'sim.err.revertDirty' },
    );
  }
  const target = repo.commits[res.id]!;
  if (mainline !== undefined) {
    if (target.parents.length < 2) {
      return fail(state, lines(`error: mainline was specified but commit ${target.id} is not a merge.\nfatal: revert failed`), 'revertNotMerge', {
        key: 'sim.err.revertNotMerge',
      });
    }
    if (!Number.isInteger(mainline) || mainline < 1 || mainline > target.parents.length) {
      return fail(state, lines(`error: commit ${target.id} does not have parent ${mainlineArg}\nfatal: revert failed`), 'revertBadParent', {
        key: 'sim.err.revertNotMerge',
      });
    }
  }
  const parentId = target.parents[(mainline ?? 1) - 1];
  const parentSnap = parentId ? repo.commits[parentId]!.snapshot : {};
  const head = headTree(repo);
  // Like Git: a three-way merge with the reverted commit as the base, HEAD as "ours"
  // and its parent as "theirs". Later edits elsewhere in the same file are kept.
  const merged = mergeTrees(target.snapshot, head, parentSnap, { ours: 'HEAD', theirs: `parent of ${shortLine(target)}` });
  if (Object.keys(merged.conflicts).length) {
    // Real Git would stop with conflict markers; the practice terminal doesn't run a conflicting revert.
    return fail(state, lines(`error: could not revert ${shortLine(target)}`), 'revertConflict', { key: 'sim.err.revertConflict' });
  }
  const newTree: FileMap = merged.index;
  const next = clone(state);
  const r = findRepo(next)!;
  const message =
    mainline !== undefined
      ? `Revert "${subject(target.message)}"\n\nThis reverts commit ${target.id}, reversing\nchanges made to ${parentId}.`
      : `Revert "${subject(target.message)}"\n\nThis reverts commit ${target.id}.`;
  const before = headId(r);
  const created = makeCommit(next, r, { message, parents: before ? [before] : [], snapshot: newTree, author });
  r.index = { ...newTree };
  const changes: Record<string, string | null> = {};
  for (const p of new Set([...Object.keys(head), ...Object.keys(newTree)])) {
    if (head[p] !== newTree[p]) changes[p] = newTree[p] ?? null;
  }
  applyToWorking(next, r, changes);
  moveHead(r, created.id, `revert: ${subject(message)}`);
  const events: SimEvent[] = [
    { type: 'revertCreated', id: created.id, reverted: target.id },
    { type: 'commitCreated', id: created.id },
    { type: 'headMoved', from: before, to: created.id },
  ];
  if (r.head.type === 'branch') events.push({ type: 'branchMoved', branch: r.head.name, from: before, to: created.id });
  const where = r.head.type === 'branch' ? r.head.name : 'detached HEAD';
  const out: Line[] = [line(`[${where} ${shortHash(created.id)}] ${subject(message)}`), ...commitStat(head, newTree)];
  return ok(next, out, events, {
    key: 'sim.explain.revert',
    params: { hash: shortHash(target.id), newHash: shortHash(created.id), message: subject(target.message) },
  });
};

// ---------------------------------------------------------------------------
// checkout / switch

const DETACHED_ADVICE = `You are in 'detached HEAD' state. You can look around, make experimental
changes and commit them, and you can discard any commits you make in this
state without impacting any branches by switching back to a branch.

If you want to create a new branch to retain commits you create, you may
do so (now or later) by using -c with the switch command. Example:

  git switch -c <new-branch-name>

Or undo this operation with:

  git switch -

Turn off this advice by setting config variable advice.detachedHead to false
`;

type Verb = 'checkout' | 'switch';

function leavingDetachedLines(repo: Repo): Line[] {
  if (repo.head.type !== 'detached') return [];
  const lost = orphanedFromHead(repo);
  if (lost.length === 0) return [line(`Previous HEAD position was ${shortLine(repo.commits[repo.head.commit]!)}`)];
  const n = lost.length;
  return lines(
    `Warning: you are leaving ${n} commit${n > 1 ? 's' : ''} behind, not connected to\nany of your branches:\n\n${lost
      .map((c) => `  ${shortLine(c)}`)
      .join('\n')}\n\nIf you want to keep ${n > 1 ? 'them' : 'it'} by creating a new branch, this may be a good time\nto do so with:\n\n git branch <new-branch-name> ${shortHash(lost[0]!.id)}\n`,
    'yellow',
  );
}

/** Git says "checkout" here for `git switch` too. */
function blockedResult(state: SimState, blocked: string[], untracked: string[]): CommandResult {
  if (untracked.length) {
    return fail(
      state,
      lines(
        `error: The following untracked working tree files would be overwritten by checkout:\n${untracked
          .map((p) => `\t${p}`)
          .join('\n')}\nPlease move or remove them before you switch branches.\nAborting`,
      ),
      'untrackedOverwrite',
      { key: 'sim.err.switchUntracked' },
    );
  }
  return fail(
    state,
    lines(
      `error: Your local changes to the following files would be overwritten by checkout:\n${blocked
        .map((p) => `\t${p}`)
        .join('\n')}\nPlease commit your changes or stash them before you switch branches.\nAborting`,
    ),
    'localChanges',
    { key: 'sim.err.switchDirty' },
  );
}

/** `git switch` refuses during a merge/rebase/cherry-pick; both refuse with unresolved conflicts. */
function blockedByOperation(state: SimState, repo: Repo, verb: Verb, movesTree = true): CommandResult | null {
  if (verb === 'switch' && repo.op) {
    const what = repo.op.kind === 'merge' ? 'merging' : repo.op.kind === 'rebase' ? 'rebasing' : 'cherry-picking';
    return fail(state, lines(`fatal: cannot switch branch while ${what}\nConsider "git ${repo.op.kind} --quit" or "git worktree add".`), 'opInProgress', {
      key: 'sim.err.switchDuringOp',
      params: { op: repo.op.kind },
    });
  }
  if (verb === 'checkout' && repo.op?.kind === 'rebase') {
    return fail(state, lines('fatal: cannot switch branch while rebasing\nConsider "git rebase --quit" or "git worktree add".'), 'opInProgress', {
      key: 'sim.err.switchDuringOp',
      params: { op: 'rebase' },
    });
  }
  if (movesTree && Object.keys(repo.conflicts).length) {
    const needs = Object.keys(repo.conflicts).sort().map((p) => `${p}: needs merge`);
    return fail(state, lines(`${needs.join('\n')}\nerror: you need to resolve your current index first`), 'unmerged', { key: 'sim.err.unmerged' });
  }
  return null;
}

/** The "M\tfile" lines `git checkout` prints for changes it carries to the new branch. */
function carriedChanges(state: SimState, repo: Repo): Line[] {
  const head = headTree(repo);
  const work = workingTree(state, repo);
  const out: Line[] = [];
  for (const p of [...new Set([...Object.keys(head), ...Object.keys(repo.index)])].sort()) {
    if (!(p in repo.index)) out.push(line(`D\t${p}`));
    else if (!(p in head)) out.push(line(`A\t${p}`));
    else if (repo.index[p] !== head[p] || work[p] !== repo.index[p]) out.push(line(p in work ? `M\t${p}` : `D\t${p}`));
  }
  return out;
}

/** After switching: a merge or cherry-pick that was fully resolved is dropped, like Git. */
function endStoppedOp(repo: Repo): void {
  if (repo.op && repo.op.kind !== 'rebase') repo.op = null;
}

function goToBranch(state: SimState, name: string, verb: Verb): CommandResult {
  const repo = findRepo(state)!;
  const stop = blockedByOperation(state, repo, verb);
  if (stop) return stop;
  const usedAt = branchUsedElsewhere(state, repo, name);
  if (usedAt) {
    return fail(state, lines(`fatal: '${name}' is already used by worktree at '${usedAt}'`), 'branchInUse', {
      key: 'sim.err.branchInUse',
      params: { branch: name, path: usedAt },
    });
  }
  if (repo.head.type === 'branch' && repo.head.name === name) {
    const next = clone(state);
    findRepo(next)!.reflog.unshift({ commit: headId(repo) ?? '', message: `checkout: moving from ${name} to ${name}` });
    return ok(next, [line(`Already on '${name}'`), ...trackingLines(repo, name)], [], { key: 'sim.explain.alreadyOn', params: { branch: name } });
  }
  const tip = repo.branches[name]!;
  const next = clone(state);
  const r = findRepo(next)!;
  const { blocked, untrackedBlocked } = switchTrees(next, r, r.commits[tip]!.snapshot);
  if (blocked.length || untrackedBlocked.length) return blockedResult(state, blocked, untrackedBlocked);
  const leaving = leavingDetachedLines(repo);
  const from = repo.head.type === 'branch' ? repo.head.name : repo.head.commit;
  const before = headId(repo);
  r.head = { type: 'branch', name };
  r.detachedFrom = null;
  r.reflog.unshift({ commit: tip, message: `checkout: moving from ${from} to ${name}` });
  endStoppedOp(r);
  // Changes you carry along are listed first ("M\tfile"), then the switch itself.
  const out = [...carriedChanges(next, r), ...leaving];
  void verb;
  out.push(line(`Switched to branch '${name}'`), ...trackingLines(r, name));
  return ok(next, out, [{ type: 'headAttached', branch: name }, { type: 'headMoved', from: before, to: tip }], {
    key: 'sim.explain.switchBranch',
    params: { branch: name },
  });
}

/** `git switch -c/-C`, `git checkout -b/-B` and the remote-branch shortcut. */
function createAndSwitch(state: SimState, name: string, startArg: string | undefined, verb: Verb, opts: { force: boolean; track: boolean }): CommandResult {
  const repo = findRepo(state)!;
  // A new branch at HEAD changes no files, so Git allows it even with conflicts.
  const startRes = startArg === undefined ? null : resolveRev(repo, startArg);
  const atHead = !startRes || (startRes.ok && startRes.id === headId(repo));
  const stop = blockedByOperation(state, repo, verb, !atHead);
  if (stop) return stop;
  if (!isValidBranchName(name)) {
    return fail(state, lines(`fatal: '${name}' is not a valid branch name\nhint: See 'git help check-ref-format'`), 'badBranchName', { key: 'sim.err.badBranchName', params: { branch: name } });
  }
  const exists = repo.branches[name] !== undefined;
  if (exists && !opts.force) {
    return fail(state, lines(`fatal: a branch named '${name}' already exists`), 'branchExists', { key: 'sim.err.branchExists', params: { branch: name } });
  }
  const before = headId(repo);
  let start: string | null = before;
  if (startArg !== undefined) {
    const res = resolveRev(repo, startArg);
    if (!res.ok) {
      const msg = verb === 'switch' ? `fatal: invalid reference: ${startArg}` : `fatal: '${startArg}' is not a commit and a branch '${name}' cannot be created from it`;
      return fail(state, lines(msg), 'badStart', { key: 'sim.err.branchBadStart', params: { rev: startArg } });
    }
    start = res.id;
  }
  const next = clone(state);
  const r = findRepo(next)!;
  const from = repo.head.type === 'branch' ? repo.head.name : repo.head.commit;
  const out: Line[] = [];
  if (start === null) {
    // No commits yet: just give the unborn branch a new name.
    r.head = { type: 'branch', name };
    return ok(next, [line(`Switched to a new branch '${name}'`)], [{ type: 'headAttached', branch: name }], { key: 'sim.explain.switchCreate', params: { branch: name } });
  }
  if (start !== before) {
    const { blocked, untrackedBlocked } = switchTrees(next, r, r.commits[start]!.snapshot);
    if (blocked.length || untrackedBlocked.length) return blockedResult(state, blocked, untrackedBlocked);
  }
  const leaving = repo.head.type === 'detached' && start !== before ? leavingDetachedLines(repo) : [];
  r.branches[name] = start;
  const tracking = opts.track && startArg !== undefined ? autoTrack(r, name, startArg) : [];
  out.push(...tracking);
  r.head = { type: 'branch', name };
  r.detachedFrom = null;
  r.reflog.unshift({ commit: start, message: `checkout: moving from ${from} to ${name}` });
  endStoppedOp(r);
  // A new branch at HEAD skips the file update, so Git lists no carried changes then.
  if (start !== before) out.push(...carriedChanges(next, r));
  out.push(...leaving);
  // Git doesn't report tracking for a branch it has just created.
  const resetCurrent = exists && repo.head.type === 'branch' && repo.head.name === name;
  out.push(line(resetCurrent ? `Reset branch '${name}'` : exists ? `Switched to and reset branch '${name}'` : `Switched to a new branch '${name}'`));
  const events: SimEvent[] = [
    { type: 'branchCreated', branch: name, at: start },
    { type: 'headAttached', branch: name },
    { type: 'headMoved', from: before, to: start },
  ];
  if (tracking.length) events.push({ type: 'upstreamSet', branch: name, upstream: upstreamOf(r, name)?.ref ?? null });
  return ok(next, out, events, {
    key: tracking.length ? 'sim.explain.switchCreateTrack' : startArg !== undefined ? 'sim.explain.switchCreateAt' : 'sim.explain.switchCreate',
    params: { branch: name, rev: startArg ?? 'HEAD', upstream: upstreamOf(r, name)?.ref ?? '' },
  });
}

/** `git switch topic` when only origin/topic exists: make a local branch that tracks it. */
function remoteGuess(repo: Repo, name: string): string | null {
  const hits = remoteNames(repo).filter((rm) => repo.remoteRefs[`${rm}/${name}`] !== undefined);
  return hits.length === 1 ? `${hits[0]}/${name}` : null;
}

function detachAt(state: SimState, rev: string, id: string, verb: Verb): CommandResult {
  const repo = findRepo(state)!;
  const stop = blockedByOperation(state, repo, verb);
  if (stop) return stop;
  const next = clone(state);
  const r = findRepo(next)!;
  const { blocked, untrackedBlocked } = switchTrees(next, r, r.commits[id]!.snapshot);
  if (blocked.length || untrackedBlocked.length) return blockedResult(state, blocked, untrackedBlocked);
  const wasDetached = repo.head.type === 'detached';
  const leaving = wasDetached && repo.head.type === 'detached' && repo.head.commit !== id ? leavingDetachedLines(repo) : [];
  const from = repo.head.type === 'branch' ? repo.head.name : repo.head.commit;
  const before = headId(repo);
  r.head = { type: 'detached', commit: id };
  r.detachedFrom = id;
  r.reflog.unshift({ commit: id, message: `checkout: moving from ${from} to ${rev}` });
  endStoppedOp(r);
  const out: Line[] = [...carriedChanges(next, r), ...leaving];
  const advice = verb === 'checkout' && !wasDetached && next.globalConfig['advice.detachedhead'] !== 'false';
  if (advice) out.push(line(`Note: switching to '${rev}'.`), line(''), ...lines(DETACHED_ADVICE));
  out.push(line(`HEAD is now at ${shortLine(r.commits[id]!)}`));
  return ok(next, out, [{ type: 'headDetached', commit: id }, { type: 'headMoved', from: before, to: id }], {
    key: 'sim.explain.detached',
    params: { hash: shortHash(id) },
  });
}

function goBack(state: SimState, verb: Verb): CommandResult {
  const repo = findRepo(state)!;
  const prev = previousBranch(repo);
  if (!prev) {
    return fail(state, lines('fatal: invalid reference: @{-1}'), 'noPrevious', { key: 'sim.err.noPrevious' });
  }
  if (repo.branches[prev]) return goToBranch(state, prev, verb);
  const res = resolveRev(repo, prev);
  if (!res.ok) return fail(state, lines('fatal: invalid reference: @{-1}'), 'noPrevious', { key: 'sim.err.noPrevious' });
  return detachAt(state, res.id, res.id, verb);
}

/** `--track origin/x` without a name: the branch is called x. */
function trackName(start: string): string {
  return start.replace(/^(refs\/)?remotes\//, '').replace(/^[^/]+\//, '');
}

export const switchCmd: CommandFn = (state, args) => {
  const repo = findRepo(state);
  if (!repo) return notARepo(state);
  const a = new Args(args, {
    flags: ['--detach', '-d', '-q', '--quiet', '--discard-changes', '-t', '--track', '--no-track', '--guess', '--no-guess'],
    values: ['-c', '-C', '--create', '--force-create'],
  });
  if (a.unknown.length) return badOption(state, a.unknown[0]!);
  const track = !a.has('--no-track');
  const create = a.get('-c', '--create');
  const forceCreate = a.get('-C', '--force-create');
  if (create !== undefined || forceCreate !== undefined) {
    return createAndSwitch(state, (create ?? forceCreate)!, a.positional[0], 'switch', { force: forceCreate !== undefined, track });
  }
  const target = a.positional[0];
  if (a.has('-t', '--track') && target) return createAndSwitch(state, trackName(target), target, 'switch', { force: false, track: true });
  if (target === '-') return goBack(state, 'switch');
  if (a.has('--detach', '-d')) {
    const rev = target ?? 'HEAD';
    const res = resolveRev(repo, rev);
    if (!res.ok) return badRevision(state, rev);
    return detachAt(state, rev, res.id, 'switch');
  }
  if (!target) return fail(state, lines('fatal: missing branch or commit argument'), 'missingBranch', { key: 'sim.err.switchNeedBranch' });
  if (repo.branches[target] !== undefined) return goToBranch(state, target, 'switch');
  if (repo.head.type === 'branch' && repo.head.name === target) {
    return ok(state, [line(`Already on '${target}'`)], [], { key: 'sim.explain.alreadyOn', params: { branch: target } });
  }
  const guess = !a.has('--no-guess') ? remoteGuess(repo, target) : null;
  if (guess) return createAndSwitch(state, target, guess, 'switch', { force: false, track: true });
  if (resolveRev(repo, target).ok) {
    return fail(
      state,
      lines(
        `fatal: a branch is expected, got commit '${target}'\nhint: If you want to detach HEAD at the commit, try again with the --detach option.`,
      ),
      'branchExpected',
      { key: 'sim.err.switchNeedsDetach', params: { rev: target } },
    );
  }
  return fail(state, lines(`fatal: invalid reference: ${target}`), 'badRevision', { key: 'sim.err.noSuchBranch', params: { branch: target } });
};

export const checkout: CommandFn = (state, args) => {
  const repo = findRepo(state);
  if (!repo) return notARepo(state);
  const a = new Args(args, { flags: ['--detach', '-q', '--quiet', '-f', '--force', '-t', '--track', '--no-track'], values: ['-b', '-B'] });
  if (a.unknown.length) return badOption(state, a.unknown[0]!);
  const track = !a.has('--no-track');
  const newBranch = a.get('-b');
  const resetBranch = a.get('-B');
  if (newBranch !== undefined || resetBranch !== undefined) {
    return createAndSwitch(state, (newBranch ?? resetBranch)!, a.positional[0], 'checkout', { force: resetBranch !== undefined, track });
  }
  const before = a.positional.slice(0, Math.min(a.beforeDashDash, a.positional.length));
  const after = a.positional.slice(before.length);
  if (a.has('-t', '--track') && before[0]) return createAndSwitch(state, trackName(before[0]), before[0], 'checkout', { force: false, track: true });
  // Old-style file restore: git checkout -- <file>  /  git checkout <file>
  const first = before[0];
  const fileMode =
    a.afterDashDash ||
    (first !== undefined && first !== '-' && !resolveRev(repo, first).ok && repo.branches[first] === undefined && !remoteGuess(repo, first));
  if (fileMode) {
    let sourceRev: string | undefined;
    let files = [...before, ...after];
    if (a.afterDashDash && before.length === 1) {
      sourceRev = before[0];
      files = after;
    }
    if (files.length === 0) return fail(state, lines('fatal: you must specify path(s) to restore'), 'needPath');
    const res = sourceRev ? resolveRev(repo, sourceRev) : null;
    if (res && !res.ok) return badRevision(state, sourceRev!);
    const source = res && res.ok ? repo.commits[res.id]!.snapshot : repo.index;
    const next = clone(state);
    const r = findRepo(next)!;
    const events: SimEvent[] = [];
    for (const raw of files) {
      const spec = toPathspec(state, repo, raw);
      if (!res) {
        const unmerged = Object.keys(repo.conflicts).filter((p) => matches(spec, p));
        if (unmerged.length) {
          return fail(state, unmerged.map((p) => line(`error: path '${p}' is unmerged`)), 'unmergedPath', { key: 'sim.err.pathUnmerged', params: { path: unmerged[0]! } });
        }
      }
      const hits = Object.keys(source).filter((p) => matches(spec, p));
      if (hits.length === 0) {
        return fail(state, lines(`error: pathspec '${raw}' did not match any file(s) known to git`), 'pathspecNoMatch', {
          key: 'sim.err.pathspecKnown',
          params: { path: raw },
        });
      }
      for (const p of hits) {
        if (res && res.ok) {
          r.index[p] = source[p]!;
          delete r.conflicts[p];
        }
        applyToWorking(next, r, { [p]: source[p]! });
        events.push({ type: 'fileRestored', path: p });
      }
    }
    return ok(next, [], events, { key: 'sim.explain.checkoutFile', params: { file: files[0]! } });
  }
  const target = first;
  if (!target) return ok(state, [], [], { key: 'sim.explain.checkoutNothing' });
  if (target === '-') return goBack(state, 'checkout');
  if (repo.branches[target] !== undefined && !a.has('--detach')) return goToBranch(state, target, 'checkout');
  if (repo.head.type === 'branch' && repo.head.name === target && !headId(repo)) {
    return ok(state, [line(`Already on '${target}'`)]);
  }
  const guess = !a.has('--detach') && repo.branches[target] === undefined ? remoteGuess(repo, target) : null;
  if (guess && !(repo.tags[target] !== undefined)) return createAndSwitch(state, target, guess, 'checkout', { force: false, track: true });
  const res = resolveRev(repo, target);
  if (!res.ok) {
    return fail(state, lines(`error: pathspec '${target}' did not match any file(s) known to git`), 'badRevision', {
      key: 'sim.err.badRevision',
      params: { rev: target },
    });
  }
  return detachAt(state, target, res.id, 'checkout');
};

// ---------------------------------------------------------------------------

export const clean: CommandFn = (state, args) => {
  const repo = findRepo(state);
  if (!repo) return notARepo(state);
  const a = new Args(args, { flags: ['-n', '--dry-run', '-f', '--force', '-d', '-x', '-X', '-q', '-i'], combined: true });
  if (a.unknown.length) return badOption(state, a.unknown[0]!);
  if (a.has('-i')) {
    return fail(state, lines('This practice terminal has no interactive clean. Try git clean -n first.'), 'cleanInteractive');
  }
  if (a.has('-x', '-X')) {
    return fail(state, lines('This practice terminal keeps ignored files safe. Try git clean -n or -f.'), 'cleanIgnored', { key: 'sim.err.cleanIgnored' });
  }
  const dry = a.has('-n', '--dry-run');
  if (!dry && !a.has('-f', '--force')) {
    return fail(
      state,
      lines('fatal: clean.requireForce defaults to true and neither -i, -n, nor -f given; refusing to clean'),
      'requireForce',
      { key: 'sim.err.cleanRequireForce' },
    );
  }
  const st = computeStatus(state, repo);
  const specs = a.positional.map((p) => toPathspec(state, repo, p));
  const inScope = (p: string) => (specs.length ? specs.some((s) => matches(s, p)) : true);
  const shown = collapseUntracked(st.untracked.filter(inScope), repo.index).filter((p) => a.has('-d') || !p.endsWith('/'));
  const verb = dry ? 'Would remove' : 'Removing';
  const out: Line[] = shown.map((p) => line(`${verb} ${displayPath(p, repo.root, state.cwd)}`));
  if (dry) {
    return ok(state, out, [{ type: 'filesCleaned', paths: shown, dryRun: true }], {
      key: shown.length ? 'sim.explain.cleanDry' : 'sim.explain.cleanNothing',
      params: { count: String(shown.length) },
    });
  }
  const next = clone(state);
  const r = findRepo(next)!;
  for (const p of shown) {
    if (p.endsWith('/')) {
      const dir = `${r.root}/${p.slice(0, -1)}`;
      for (const f of Object.keys(next.fs.files)) if (f.startsWith(`${dir}/`)) deleteFile(next, f);
      next.fs.dirs = next.fs.dirs.filter((d) => d !== dir && !d.startsWith(`${dir}/`));
    } else {
      deleteFile(next, `${r.root}/${p}`);
      pruneEmptyDirs(next, r.root, [`${r.root}/${p}`]);
    }
  }
  return ok(next, out, [{ type: 'filesCleaned', paths: shown, dryRun: false }], {
    key: shown.length ? 'sim.explain.cleanForce' : 'sim.explain.cleanNothing',
    params: { count: String(shown.length) },
  });
};
