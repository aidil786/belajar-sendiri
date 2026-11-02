// git branch (list, create, delete, rename, upstream) and git tag.
import { shortHash, tagText, textObjectId } from '../hash';
import { fail, line, lines, notARepo, ok } from '../output';
import { Args } from '../parse';
import { isAncestorOf, isValidBranchName, isValidRefName, trackInfoText } from '../refs';
import { resolveRev } from '../revision';
import { branchUsedElsewhere, clone, findRepo, headId, identity, remoteNames, setUpstream, subject, unsetUpstream, upstreamOf } from '../state';
import type { CommandFn, CommandResult, Line, Repo, Seg, SimEvent, SimState } from '../types';

function badOption(state: SimState, opt: string): CommandResult {
  return fail(state, lines(`error: unknown option '${opt.replace(/^-+/, '')}'`), 'badOption', {
    key: 'sim.err.badOption',
    params: { option: opt },
  });
}

/** Glob match for `git branch --list 'f*'` and `git tag -l 'v1.*'`. */
function globMatch(pattern: string, name: string): boolean {
  const re = pattern
    .split('')
    .map((ch) => (ch === '*' ? '.*' : ch === '?' ? '.' : ch.replace(/[.+^${}()|[\]\\]/g, '\\$&')))
    .join('');
  return new RegExp(`^${re}$`).test(name);
}

/** If `name` is a remote-tracking branch ("origin/main"), its remote and branch. */
export function asRemoteBranch(repo: Repo, name: string): { remote: string; branch: string } | null {
  const short = name.replace(/^refs\/remotes\//, '').replace(/^remotes\//, '');
  if (repo.remoteRefs[short] === undefined) return null;
  for (const r of remoteNames(repo)) {
    if (short.startsWith(`${r}/`)) return { remote: r, branch: short.slice(r.length + 1) };
  }
  return null;
}

/** Set up tracking like branch.autoSetupMerge=true does: only when starting from a remote-tracking branch. */
export function autoTrack(repo: Repo, branch: string, start: string): Line[] {
  const rb = asRemoteBranch(repo, start);
  if (!rb) return [];
  setUpstream(repo, branch, rb.remote, rb.branch);
  return [line(`branch '${branch}' set up to track '${rb.remote}/${rb.branch}'.`)];
}

function worktreeError(state: SimState, root: string, name: string): CommandResult {
  return fail(state, lines(`error: cannot delete branch '${name}' used by worktree at '${root}'`), 'deleteCurrent', {
    key: 'sim.err.branchDeleteCurrent',
    params: { branch: name },
  });
}

// ---------------------------------------------------------------------------

interface ListEntry {
  name: string; // as shown
  current: boolean;
  remote: boolean;
  id: string | null;
  symref?: string; // "origin/main" for remotes/origin/HEAD
  local?: string; // local branch name (for -vv)
}

function listBranches(repo: Repo, opts: { all: boolean; remotes: boolean; verbose: number; merged: string | null; noMerged: string | null; patterns: string[] }): Line[] {
  const entries: ListEntry[] = [];
  const head = headId(repo);
  if (repo.head.type === 'detached' && !opts.remotes) {
    let label: string;
    if (repo.op?.kind === 'rebase') label = repo.op.branch ? `(no branch, rebasing ${repo.op.branch})` : '(no branch, rebasing detached HEAD)';
    else {
      const at = repo.detachedFrom && repo.detachedFrom !== repo.head.commit ? 'from' : 'at';
      label = `(HEAD detached ${at} ${shortHash(repo.detachedFrom ?? repo.head.commit)})`;
    }
    entries.push({ name: label, current: true, remote: false, id: repo.head.commit });
  }
  if (!opts.remotes) {
    for (const name of Object.keys(repo.branches).sort()) {
      entries.push({ name, current: repo.head.type === 'branch' && repo.head.name === name, remote: false, id: repo.branches[name]!, local: name });
    }
  }
  if (opts.remotes || opts.all) {
    const prefix = opts.all ? 'remotes/' : '';
    const names = [...Object.keys(repo.remoteRefs), ...Object.keys(repo.remoteHeads).map((r) => `${r}/HEAD`)].sort();
    for (const name of names) {
      if (name.endsWith('/HEAD') && repo.remoteHeads[name.slice(0, -5)] !== undefined && repo.remoteRefs[name] === undefined) {
        const remote = name.slice(0, -5);
        const target = `${remote}/${repo.remoteHeads[remote]}`;
        if (repo.remoteRefs[target] === undefined) continue;
        entries.push({ name: `${prefix}${name}`, current: false, remote: true, id: repo.remoteRefs[target]!, symref: target });
      } else entries.push({ name: `${prefix}${name}`, current: false, remote: true, id: repo.remoteRefs[name]! });
    }
  }
  let shown = entries;
  const filterRev = opts.merged ?? opts.noMerged;
  if (filterRev) {
    const res = resolveRev(repo, filterRev);
    const target = res.ok ? res.id : null;
    shown = shown.filter((e) => {
      if (!e.id || !target) return false;
      const merged = isAncestorOf(repo.commits, e.id, target);
      return opts.merged ? merged : !merged;
    });
  }
  if (opts.patterns.length) shown = shown.filter((e) => opts.patterns.some((p) => globMatch(p, e.name.replace(/^remotes\//, ''))));
  void head;
  const width = Math.max(0, ...shown.map((e) => e.name.length));
  return shown.map((e) => {
    const color = e.current ? 'green' : e.remote ? 'red' : undefined;
    const segs: Seg[] = [{ t: e.current ? '* ' : '  ' }];
    if (e.symref) {
      segs.push({ t: `${e.name} -> ${e.symref}`, ...(color ? { c: color } : {}) });
      return segs;
    }
    if (!opts.verbose) {
      segs.push({ t: e.name, ...(color ? { c: color } : {}) });
      return segs;
    }
    segs.push({ t: e.name.padEnd(width), ...(color ? { c: color } : {}) });
    const c = e.id ? repo.commits[e.id] : undefined;
    segs.push({ t: ` ${e.id ? shortHash(e.id) : ''} ` });
    if (opts.verbose > 1 && e.local) {
      const up = upstreamOf(repo, e.local);
      if (up) {
        const info = trackInfoText(repo, e.local);
        segs.push({ t: '[' }, { t: up.ref, c: 'blue' }, { t: `${info ? `: ${info}` : ''}] ` });
      }
    } else if (e.local) {
      // -v shows ahead/behind without the upstream name.
      const info = upstreamOf(repo, e.local) ? trackInfoText(repo, e.local) : '';
      if (info) segs.push({ t: `[${info}] ` });
    }
    segs.push({ t: c ? subject(c.message) : '' });
    return segs;
  });
}

// ---------------------------------------------------------------------------

export const branch: CommandFn = (state, rawArgs) => {
  const repo = findRepo(state);
  if (!repo) return notARepo(state);
  // Count -v / -vv / --verbose; read --merged [commit] / --no-merged [commit].
  let verbose = 0;
  let merged: string | null = null;
  let noMerged: string | null = null;
  const args: string[] = [];
  for (let i = 0; i < rawArgs.length; i++) {
    const w = rawArgs[i]!;
    if (/^-[a-zA-Z]*v[a-zA-Z]*$/.test(w) && !/[mMdDuc]/.test(w.slice(1))) {
      // -v, -vv, -av, -avv, -rv ...
      verbose += (w.match(/v/g) ?? []).length;
      const rest = w.slice(1).replace(/v/g, '');
      if (rest) args.push(`-${rest}`);
    } else if (w === '--verbose') verbose++;
    else if (w === '--merged' || w === '--no-merged') {
      const next = rawArgs[i + 1];
      const value = next !== undefined && !next.startsWith('-') ? next : 'HEAD';
      if (value !== 'HEAD' || next === 'HEAD') i++;
      if (w === '--merged') merged = value;
      else noMerged = value;
    } else if (w.startsWith('--merged=')) merged = w.slice(9);
    else if (w.startsWith('--no-merged=')) noMerged = w.slice(12);
    else args.push(w);
  }
  const a = new Args(args, {
    flags: ['-a', '--all', '-r', '--remotes', '--list', '-l', '--show-current', '-d', '--delete', '-D', '-m', '--move', '-M', '-f', '--force', '--unset-upstream', '-q', '--quiet', '--no-track', '--track', '-t'],
    values: ['-u', '--set-upstream-to'],
    combined: true,
  });
  if (a.unknown.length) return badOption(state, a.unknown[0]!);
  const force = a.has('-f', '--force');

  if (a.has('--show-current')) {
    return ok(state, repo.head.type === 'branch' ? [line(repo.head.name)] : [], [], { key: 'sim.explain.branchShowCurrent' });
  }
  if (a.has('--unset-upstream')) return unsetUp(state, repo, a.positional[0]);
  const upstream = a.get('-u', '--set-upstream-to');
  if (upstream !== undefined) return setUp(state, repo, upstream, a.positional[0]);
  if (a.has('-d', '--delete', '-D')) return deleteBranches(state, repo, a.positional, a.has('-D') || force, a.has('-r', '--remotes'));
  if (a.has('-m', '--move', '-M')) return renameBranch(state, repo, a.positional, a.has('-M') || force);

  const listing = a.has('--list', '-l') || a.positional.length === 0 || merged !== null || noMerged !== null || verbose > 0;
  if (listing) {
    const out = listBranches(repo, {
      all: a.has('-a', '--all'),
      remotes: a.has('-r', '--remotes'),
      verbose,
      merged,
      noMerged,
      patterns: a.positional,
    });
    return ok(state, out, [], { key: merged ? 'sim.explain.branchMerged' : noMerged ? 'sim.explain.branchNoMerged' : a.has('-a', '--all', '-r', '--remotes') ? 'sim.explain.branchAll' : verbose > 1 ? 'sim.explain.branchVV' : 'sim.explain.branch' });
  }
  return createBranch(state, repo, a.positional[0]!, a.positional[1], force, !a.has('--no-track'));
};

function createBranch(state: SimState, repo: Repo, name: string, startArg: string | undefined, force: boolean, track: boolean): CommandResult {
  if (!isValidBranchName(name)) {
    return fail(state, lines(`fatal: '${name}' is not a valid branch name\nhint: See 'git help check-ref-format'`), 'badBranchName', { key: 'sim.err.badBranchName', params: { branch: name } });
  }
  const exists = repo.branches[name] !== undefined;
  if (exists && !force) {
    return fail(state, lines(`fatal: a branch named '${name}' already exists`), 'branchExists', { key: 'sim.err.branchExists', params: { branch: name } });
  }
  if (exists && repo.head.type === 'branch' && repo.head.name === name) {
    return fail(state, lines(`fatal: cannot force update the branch '${name}' used by worktree at '${repo.root}'`), 'branchCurrent', {
      key: 'sim.err.branchForceCurrent',
      params: { branch: name },
    });
  }
  const start = startArg ?? 'HEAD';
  const res = resolveRev(repo, start);
  if (!res.ok) {
    const shown = startArg ?? (repo.head.type === 'branch' ? repo.head.name : 'HEAD');
    return fail(state, lines(`fatal: not a valid object name: '${shown}'`), 'badStart', { key: 'sim.err.branchBadStart', params: { rev: shown } });
  }
  const next = clone(state);
  const r = findRepo(next)!;
  r.branches[name] = res.id;
  const out = track ? autoTrack(r, name, start) : [];
  const events: SimEvent[] = [{ type: 'branchCreated', branch: name, at: res.id }];
  if (out.length) events.push({ type: 'upstreamSet', branch: name, upstream: upstreamOf(r, name)?.ref ?? null });
  return ok(next, out, events, {
    key: startArg ? 'sim.explain.branchCreateAt' : 'sim.explain.branchCreate',
    params: { branch: name, rev: startArg ?? 'HEAD', hash: shortHash(res.id) },
  });
}

function deleteBranches(state: SimState, repo: Repo, names: string[], force: boolean, remote: boolean): CommandResult {
  if (names.length === 0) return fail(state, lines('fatal: branch name required'), 'needBranch', { key: 'sim.err.branchNeedName' });
  const next = clone(state);
  const r = findRepo(next)!;
  const out: Line[] = [];
  const events: SimEvent[] = [];
  let failed = false;
  let firstKey: { key: string; params: Record<string, string> } | null = null;
  for (const name of names) {
    if (remote) {
      const id = r.remoteRefs[name];
      if (id === undefined) {
        out.push(line(`error: remote-tracking branch '${name}' not found`));
        failed = true;
        firstKey ??= { key: 'sim.err.branchNotFound', params: { branch: name } };
        continue;
      }
      delete r.remoteRefs[name];
      out.push(line(`Deleted remote-tracking branch ${name} (was ${shortHash(id)}).`));
      continue;
    }
    const id = r.branches[name];
    if (id === undefined) {
      out.push(line(`error: branch '${name}' not found`));
      failed = true;
      firstKey ??= { key: 'sim.err.branchNotFound', params: { branch: name } };
      continue;
    }
    // The branch may be checked out here or in another worktree (`git worktree add`).
    const usedAt = r.head.type === 'branch' && r.head.name === name ? r.root : branchUsedElsewhere(state, repo, name);
    if (usedAt) {
      if (names.length === 1) return worktreeError(state, usedAt, name);
      out.push(line(`error: cannot delete branch '${name}' used by worktree at '${usedAt}'`));
      failed = true;
      continue;
    }
    if (!force) {
      // Git checks against the upstream if there is one, else against HEAD.
      const head = headId(r);
      const up = upstreamOf(r, name);
      const upTip = up ? (up.remote === '.' ? r.branches[up.ref] : r.remoteRefs[up.ref]) : undefined;
      const reference = upTip ?? head;
      const isMerged = reference ? isAncestorOf(r.commits, id, reference) : false;
      if (upTip && head && upTip !== head) {
        const toHead = isAncestorOf(r.commits, id, head);
        const full = up!.remote === '.' ? `refs/heads/${up!.ref}` : `refs/remotes/${up!.ref}`;
        if (isMerged && !toHead) out.push(line(`warning: deleting branch '${name}' that has been merged to`), line(`         '${full}', but not yet merged to HEAD`));
        if (!isMerged && toHead) out.push(line(`warning: not deleting branch '${name}' that is not yet merged to`), line(`         '${full}', even though it is merged to HEAD`));
      }
      if (!isMerged) {
        out.push(
          line(`error: the branch '${name}' is not fully merged`),
          line(`hint: If you are sure you want to delete it, run 'git branch -D ${name}'`),
          line('hint: Disable this message with "git config set advice.forceDeleteBranch false"'),
        );
        failed = true;
        firstKey ??= { key: 'sim.err.branchNotMerged', params: { branch: name } };
        continue;
      }
    }
    delete r.branches[name];
    unsetUpstream(r, name);
    out.push(line(`Deleted branch ${name} (was ${shortHash(id)}).`));
    events.push({ type: 'branchDeleted', branch: name, was: id });
  }
  if (failed) {
    const res = fail(state, out, 'branchDelete', firstKey ?? undefined);
    // Some branches may still have been deleted (Git carries on).
    if (events.length) return { ...res, state: next, events: [...events, ...res.events] };
    return res;
  }
  return ok(next, out, events, { key: force ? 'sim.explain.branchForceDelete' : 'sim.explain.branchDelete', params: { branch: names.join(', ') } });
}

function renameBranch(state: SimState, repo: Repo, names: string[], force: boolean): CommandResult {
  let oldName: string;
  let newName: string;
  if (names.length >= 2) [oldName, newName] = names as [string, string];
  else if (names.length === 1) {
    if (repo.head.type !== 'branch') {
      return fail(state, lines('fatal: cannot rename the current branch while not on any'), 'renameDetached', { key: 'sim.err.branchRenameDetached' });
    }
    oldName = repo.head.name;
    newName = names[0]!;
  } else return fail(state, lines('fatal: branch name required'), 'needBranch', { key: 'sim.err.branchNeedName' });
  const isCurrent = repo.head.type === 'branch' && repo.head.name === oldName;
  if (repo.branches[oldName] === undefined && !isCurrent) {
    return fail(state, lines(`fatal: no branch named '${oldName}'`), 'noSuchBranch', { key: 'sim.err.noSuchBranch', params: { branch: oldName } });
  }
  if (!isValidBranchName(newName)) {
    return fail(state, lines(`fatal: '${newName}' is not a valid branch name\nhint: See 'git help check-ref-format'`), 'badBranchName', { key: 'sim.err.badBranchName', params: { branch: newName } });
  }
  if (repo.branches[newName] !== undefined && newName !== oldName && !force) {
    return fail(state, lines(`fatal: a branch named '${newName}' already exists`), 'branchExists', { key: 'sim.err.branchExists', params: { branch: newName } });
  }
  const next = clone(state);
  const r = findRepo(next)!;
  const tip = r.branches[oldName];
  delete r.branches[oldName];
  if (tip) r.branches[newName] = tip;
  // Upstream config moves with the branch.
  const up = upstreamOf(r, oldName);
  unsetUpstream(r, oldName);
  if (up) setUpstream(r, newName, up.remote, up.branch);
  const events: SimEvent[] = [{ type: 'branchRenamed', from: oldName, to: newName }];
  if (isCurrent) {
    r.head = { type: 'branch', name: newName };
    events.push({ type: 'headAttached', branch: newName });
  }
  return ok(next, [], events, { key: 'sim.explain.branchRename', params: { from: oldName, to: newName } });
}

function setUp(state: SimState, repo: Repo, upstream: string, branchArg: string | undefined): CommandResult {
  const name = branchArg ?? (repo.head.type === 'branch' ? repo.head.name : null);
  if (!name) return fail(state, lines('fatal: could not set upstream of HEAD to origin/main when it does not point to any branch.'), 'detached');
  if (repo.branches[name] === undefined) {
    return fail(state, lines(`fatal: branch '${name}' does not exist`), 'noSuchBranch', { key: 'sim.err.noSuchBranch', params: { branch: name } });
  }
  const rb = asRemoteBranch(repo, upstream);
  if (!rb && repo.branches[upstream] === undefined) {
    return fail(
      state,
      lines(
        [
          `fatal: the requested upstream branch '${upstream}' does not exist`,
          'hint:',
          'hint: If you are planning on basing your work on an upstream',
          'hint: branch that already exists at the remote, you may need to',
          'hint: run "git fetch" to retrieve it.',
          'hint:',
          'hint: If you are planning to push out a new local branch that',
          'hint: will track its remote counterpart, you may want to use',
          'hint: "git push -u" to set the upstream config as you push.',
          'hint: Disable this message with "git config set advice.setUpstreamFailure false"',
        ].join('\n'),
      ),
      'noUpstreamBranch',
      { key: 'sim.err.upstreamMissing', params: { upstream } },
    );
  }
  const next = clone(state);
  const r = findRepo(next)!;
  if (rb) setUpstream(r, name, rb.remote, rb.branch);
  else setUpstream(r, name, '.', upstream);
  const shown = rb ? `${rb.remote}/${rb.branch}` : upstream;
  return ok(next, [line(`branch '${name}' set up to track '${shown}'.`)], [{ type: 'upstreamSet', branch: name, upstream: shown }], {
    key: 'sim.explain.upstreamSet',
    params: { branch: name, upstream: shown },
  });
}

function unsetUp(state: SimState, repo: Repo, branchArg: string | undefined): CommandResult {
  const name = branchArg ?? (repo.head.type === 'branch' ? repo.head.name : 'HEAD');
  if (!upstreamOf(repo, name)) {
    return fail(state, lines(`fatal: branch '${name}' has no upstream information`), 'noUpstream', { key: 'sim.err.noUpstream', params: { branch: name } });
  }
  const next = clone(state);
  unsetUpstream(findRepo(next)!, name);
  return ok(next, [], [{ type: 'upstreamSet', branch: name, upstream: null }], { key: 'sim.explain.upstreamUnset', params: { branch: name } });
}

// ---------------------------------------------------------------------------
// git tag

export const tag: CommandFn = (state, args) => {
  const repo = findRepo(state);
  if (!repo) return notARepo(state);
  const a = new Args(args, {
    flags: ['-a', '--annotate', '-d', '--delete', '-l', '--list', '-f', '--force', '-n'],
    values: ['-m', '--message'],
    combined: true,
  });
  if (a.unknown.length) return badOption(state, a.unknown[0]!);
  if (a.has('-d', '--delete')) {
    if (!a.positional.length) return fail(state, lines('fatal: tag name required'), 'needTag');
    const next = clone(state);
    const r = findRepo(next)!;
    const out: Line[] = [];
    const events: SimEvent[] = [];
    let failed = false;
    for (const name of a.positional) {
      const id = r.tags[name];
      if (id === undefined) {
        out.push(line(`error: tag '${name}' not found.`));
        failed = true;
        continue;
      }
      out.push(line(`Deleted tag '${name}' (was ${shortHash(r.tagInfo[name]?.id ?? id)})`));
      delete r.tags[name];
      delete r.tagInfo[name];
      events.push({ type: 'tagDeleted', tag: name });
    }
    if (failed) {
      const res = fail(state, out, 'tagNotFound', { key: 'sim.err.tagNotFound', params: { tag: a.positional[0]! } });
      return events.length ? { ...res, state: next, events: [...events, ...res.events] } : res;
    }
    return ok(next, out, events, { key: 'sim.explain.tagDelete', params: { tag: a.positional.join(', ') } });
  }
  const message = a.get('-m', '--message');
  const annotate = a.has('-a', '--annotate') || message !== undefined;
  if (a.has('-l', '--list') || a.positional.length === 0) {
    if (annotate && a.positional.length === 0 && !a.has('-l', '--list')) {
      return fail(state, lines('usage: git tag [-a] [-m <msg>] <tagname> [<commit>]'), 'needTag', { key: 'sim.err.tagNeedName' });
    }
    const names = Object.keys(repo.tags)
      .sort()
      .filter((n) => !a.positional.length || a.positional.some((p) => globMatch(p, n)));
    return ok(state, names.map((n) => line(n)), [], { key: names.length ? 'sim.explain.tagList' : 'sim.explain.tagListEmpty' });
  }
  const [name, rev] = a.positional as [string, string | undefined];
  if (!isValidRefName(name)) {
    return fail(state, lines(`fatal: '${name}' is not a valid tag name.`), 'badTagName', { key: 'sim.err.badTagName', params: { tag: name } });
  }
  const existed = repo.tags[name];
  if (existed !== undefined && !a.has('-f', '--force')) {
    return fail(state, lines(`fatal: tag '${name}' already exists`), 'tagExists', { key: 'sim.err.tagExists', params: { tag: name } });
  }
  const res = resolveRev(repo, rev ?? 'HEAD');
  if (!res.ok) {
    return fail(state, lines(`fatal: Failed to resolve '${rev ?? 'HEAD'}' as a valid ref.`), 'badRevision', {
      key: 'sim.err.badRevision',
      params: { rev: rev ?? 'HEAD' },
    });
  }
  if (annotate && message === undefined) {
    return fail(state, [], 'tagNeedMessage', { key: 'sim.err.tagNeedMessage' });
  }
  const next = clone(state);
  const r = findRepo(next)!;
  const out: Line[] = existed !== undefined ? [line(`Updated tag '${name}' (was ${shortHash(repo.tagInfo[name]?.id ?? existed)})`)] : [];
  r.tags[name] = res.id;
  delete r.tagInfo[name];
  if (annotate) {
    const tagger = identity(next, r);
    if (!tagger) return fail(state, lines('Author identity unknown\n\n*** Please tell me who you are.'), 'noIdentity', { key: 'sim.err.noIdentity' });
    next.counter += 1;
    next.clock += 60;
    r.tagInfo[name] = {
      id: textObjectId('tag', tagText({ object: res.id, name, tagger, time: next.clock, tz: next.tz, message: message! })),
      tagger,
      timestamp: next.clock,
      message: message!,
    };
  }
  return ok(next, out, [{ type: 'tagCreated', tag: name, commit: res.id, annotated: annotate }], {
    key: annotate ? 'sim.explain.tagAnnotated' : 'sim.explain.tagCreate',
    params: { tag: name, hash: shortHash(res.id), message: subject(repo.commits[res.id]?.message ?? '') },
  });
};
