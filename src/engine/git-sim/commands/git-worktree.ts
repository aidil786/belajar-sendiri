// git worktree (World 10): extra working folders that share one repo.
// Each linked worktree has its own HEAD, index and in-progress operations; commits,
// branches, tags and config are shared (see state.ts `findRepo`).
import { shortHash } from '../hash';
import { fail, line, lines, notARepo, ok } from '../output';
import { Args } from '../parse';
import { basename, isInside, resolve } from '../paths';
import { isValidBranchName } from '../refs';
import { resolveRev } from '../revision';
import { allWorktrees, clone, dirExists, ensureDir, fileExists, findRepo, headId, listDir, mainRepo, subject, writeFile } from '../state';
import { computeStatus } from '../status';
import type { CommandFn, CommandResult, Head, Line, Repo, SimState } from '../types';

function badOption(state: SimState, opt: string): CommandResult {
  return fail(state, lines(`error: unknown option '${opt.replace(/^-+/, '')}'`), 'badOption', { key: 'sim.err.badOption', params: { option: opt } });
}

function add(state: SimState, args: string[]): CommandResult {
  const repo = findRepo(state)!;
  const a = new Args(args, { flags: ['--detach', '-f', '--force', '-q', '--quiet'], values: ['-b', '-B'] });
  if (a.unknown.length) return badOption(state, a.unknown[0]!);
  const [pathArg, commitArg] = a.positional;
  if (!pathArg) {
    return fail(state, lines('usage: git worktree add [-f] [--detach] [-b <new-branch>] <path> [<commit-ish>]'), 'worktreeUsage', { key: 'sim.err.worktreeUsage' });
  }
  const path = resolve(state.cwd, pathArg, state.home);
  const pathTaken = fileExists(state, path) || (dirExists(state, path) && listDir(state, path).length > 0);
  const head = headId(repo);
  if (!head) return fail(state, lines('fatal: invalid reference: HEAD'), 'noCommits', { key: 'sim.err.noCommits' });
  const newBranch = a.get('-b') ?? a.get('-B');
  let target = head;
  let wtHead: Head;
  let note: string;
  let createBranch: string | null = null;
  if (commitArg !== undefined) {
    const res = resolveRev(repo, commitArg);
    if (!res.ok) return fail(state, lines(`fatal: invalid reference: ${commitArg}`), 'badRevision', { key: 'sim.err.badRevision', params: { rev: commitArg } });
    target = res.id;
  }
  if (newBranch !== undefined) {
    if (!isValidBranchName(newBranch)) {
      return fail(state, lines(`fatal: '${newBranch}' is not a valid branch name\nhint: See 'git help check-ref-format'`), 'badBranchName', { key: 'sim.err.badBranchName', params: { branch: newBranch } });
    }
    if (repo.branches[newBranch] !== undefined && a.get('-b') !== undefined) {
      return fail(state, lines(`fatal: a branch named '${newBranch}' already exists`), 'branchExists', { key: 'sim.err.branchExists', params: { branch: newBranch } });
    }
    createBranch = newBranch;
    wtHead = { type: 'branch', name: newBranch };
    note = `Preparing worktree (new branch '${newBranch}')`;
  } else if (a.has('--detach') || (commitArg !== undefined && repo.branches[commitArg] === undefined)) {
    wtHead = { type: 'detached', commit: target };
    note = `Preparing worktree (detached HEAD ${shortHash(target)})`;
  } else {
    // `git worktree add <path> [<branch>]`: check out that branch, or make one named after the folder.
    const name = commitArg ?? basename(path);
    if (repo.branches[name] !== undefined) {
      target = repo.branches[name]!;
      wtHead = { type: 'branch', name };
      note = `Preparing worktree (checking out '${name}')`;
      const used = allWorktrees(state, repo).find((w) => w.head.type === 'branch' && w.head.name === name)?.path;
      if (used) return fail(state, [line(note), line(`fatal: '${name}' is already used by worktree at '${used}'`)], 'branchInUse', { key: 'sim.err.branchInUse', params: { branch: name, path: used } });
    } else {
      if (!isValidBranchName(name)) {
        return fail(state, lines(`fatal: '${name}' is not a valid branch name\nhint: See 'git help check-ref-format'`), 'badBranchName', { key: 'sim.err.badBranchName', params: { branch: name } });
      }
      createBranch = name;
      wtHead = { type: 'branch', name };
      note = `Preparing worktree (new branch '${name}')`;
    }
  }
  const next = clone(state);
  const main = mainRepo(next, findRepo(next)!);
  if (createBranch) main.branches[createBranch] = target;
  if (pathTaken) {
    // Like Git, the new branch is already made when it finds the folder taken.
    return fail(createBranch ? next : state, [line(note), line(`fatal: '${pathArg}' already exists`)], 'worktreeExists', {
      key: 'sim.err.worktreeExists',
      params: { path: pathArg },
    });
  }
  const taken = new Set(Object.values(main.worktrees ?? {}).map((w) => w.name));
  let name = basename(path);
  for (let i = 1; taken.has(name); i++) name = `${basename(path)}${i}`;
  const snapshot = main.commits[target]!.snapshot;
  main.worktrees = { ...(main.worktrees ?? {}) };
  main.worktrees[path] = {
    path,
    name,
    head: wtHead,
    index: { ...snapshot },
    detachedFrom: wtHead.type === 'detached' ? target : null,
    reflog: [],
    conflicts: {},
    op: null,
    origHead: null,
    bisect: null,
  };
  ensureDir(next, path);
  for (const [p, content] of Object.entries(snapshot)) writeFile(next, `${path}/${p}`, content);
  const out: Line[] = a.has('-q', '--quiet') ? [] : [line(note), line(`HEAD is now at ${shortHash(target)} ${subject(main.commits[target]!.message)}`)];
  return ok(next, out, [{ type: 'worktreeAdded', path, branch: wtHead.type === 'branch' ? wtHead.name : null }], {
    key: wtHead.type === 'branch' ? 'sim.explain.worktreeAdd' : 'sim.explain.worktreeAddDetached',
    params: { path: pathArg, branch: wtHead.type === 'branch' ? wtHead.name : '', hash: shortHash(target) },
  });
}

function list(state: SimState, args: string[]): CommandResult {
  const repo = findRepo(state)!;
  const a = new Args(args, { flags: ['--porcelain', '-v', '--verbose'] });
  if (a.unknown.length) return badOption(state, a.unknown[0]!);
  const main = mainRepo(state, repo);
  const all = allWorktrees(state, repo);
  const idOf = (h: Head) => (h.type === 'detached' ? h.commit : (main.branches[h.name] ?? null));
  const out: Line[] = [];
  if (a.has('--porcelain')) {
    for (const w of all) {
      const id = idOf(w.head);
      out.push(line(`worktree ${w.path}`), line(`HEAD ${id ?? '0'.repeat(40)}`));
      out.push(line(w.head.type === 'branch' ? `branch refs/heads/${w.head.name}` : 'detached'));
      if (w.linked && !dirExists(state, w.path)) out.push(line('prunable gitdir file points to non-existent location'));
      out.push(line(''));
    }
    return ok(state, out, [], { key: 'sim.explain.worktreeList' });
  }
  const width = Math.max(...all.map((w) => w.path.length));
  for (const w of all) {
    const id = idOf(w.head);
    const where = w.head.type === 'branch' ? `[${w.head.name}]` : '(detached HEAD)';
    const prunable = w.linked && !dirExists(state, w.path) ? ' prunable' : '';
    // Git 2.56 pads the path to the longest one, then one space.
    out.push([{ t: `${w.path.padEnd(width)} ` }, { t: id ? shortHash(id) : '0000000', c: 'yellow' }, { t: ` ${where}${prunable}` }]);
  }
  return ok(state, out, [], { key: 'sim.explain.worktreeList', params: { count: String(all.length) } });
}

function findLinked(state: SimState, repo: Repo, arg: string): { path: string; main: Repo } | CommandResult {
  const main = mainRepo(state, repo);
  const abs = resolve(state.cwd, arg, state.home);
  if (abs === main.root) return fail(state, lines(`fatal: '${arg}' is a main working tree`), 'mainWorktree', { key: 'sim.err.worktreeMain', params: { path: arg } });
  const wt = main.worktrees?.[abs] ?? Object.values(main.worktrees ?? {}).find((w) => w.name === arg);
  if (!wt) return fail(state, lines(`fatal: '${arg}' is not a working tree`), 'notWorktree', { key: 'sim.err.notWorktree', params: { path: arg } });
  return { path: wt.path, main };
}

function remove(state: SimState, args: string[]): CommandResult {
  const repo = findRepo(state)!;
  const a = new Args(args, { flags: ['-f', '--force'] });
  if (a.unknown.length) return badOption(state, a.unknown[0]!);
  const arg = a.positional[0];
  if (!arg) return fail(state, lines('usage: git worktree remove [-f] <worktree>'), 'worktreeUsage', { key: 'sim.err.worktreeUsage' });
  const found = findLinked(state, repo, arg);
  if ('state' in found) return found;
  if (state.cwd === found.path || isInside(state.cwd, found.path)) {
    return fail(state, lines(`You are inside '${arg}'. Go to another folder first (try: cd ..).`), 'worktreeHere', { key: 'sim.err.worktreeHere', params: { path: arg } });
  }
  if (!a.has('-f', '--force') && dirExists(state, found.path)) {
    const view = findRepo(state, found.path)!;
    const st = computeStatus({ ...state, cwd: found.path }, view);
    if (st.staged.length || st.unstaged.length || st.untracked.length || st.unmerged.length) {
      return fail(state, lines(`fatal: '${arg}' contains modified or untracked files, use --force to delete it`), 'worktreeDirty', { key: 'sim.err.worktreeDirty', params: { path: arg } });
    }
  }
  const next = clone(state);
  const main = next.repos[found.main.root]!;
  main.worktrees = { ...(main.worktrees ?? {}) };
  delete main.worktrees[found.path];
  for (const f of Object.keys(next.fs.files)) if (isInside(f, found.path)) delete next.fs.files[f];
  next.fs.dirs = next.fs.dirs.filter((d) => d !== found.path && !isInside(d, found.path));
  return ok(next, [], [{ type: 'worktreeRemoved', path: found.path }], { key: 'sim.explain.worktreeRemove', params: { path: arg } });
}

function prune(state: SimState, args: string[]): CommandResult {
  const repo = findRepo(state)!;
  const a = new Args(args, { flags: ['-n', '--dry-run', '-v', '--verbose'] });
  if (a.unknown.length) return badOption(state, a.unknown[0]!);
  const main = mainRepo(state, repo);
  const gone = Object.values(main.worktrees ?? {}).filter((w) => !dirExists(state, w.path));
  const out = a.has('-v', '--verbose', '-n', '--dry-run') ? gone.map((w) => line(`Removing worktrees/${w.name}: gitdir file points to non-existent location`)) : [];
  if (a.has('-n', '--dry-run') || !gone.length) return ok(state, out, [], { key: 'sim.explain.worktreePrune', params: { count: String(gone.length) } });
  const next = clone(state);
  const m = next.repos[main.root]!;
  m.worktrees = { ...(m.worktrees ?? {}) };
  for (const w of gone) delete m.worktrees[w.path];
  return ok(next, out, gone.map((w) => ({ type: 'worktreeRemoved' as const, path: w.path })), { key: 'sim.explain.worktreePrune', params: { count: String(gone.length) } });
}

export const worktree: CommandFn = (state, args) => {
  const repo = findRepo(state);
  if (!repo) return notARepo(state);
  const [sub, ...rest] = args;
  if (sub === 'add') return add(state, rest);
  if (sub === 'list') return list(state, rest);
  if (sub === 'remove') return remove(state, rest);
  if (sub === 'prune') return prune(state, rest);
  if (sub && ['move', 'lock', 'unlock', 'repair'].includes(sub)) {
    return { state, output: [line(`This practice terminal doesn't run git worktree ${sub}.`)], events: [], ok: false, stopped: true, explain: { key: 'sim.explain.worktreeNotInSim', params: { sub } } };
  }
  return fail(
    state,
    lines('usage: git worktree add [-f] [--detach] [-b <new-branch>] <path> [<commit-ish>]\n   or: git worktree list [--porcelain]\n   or: git worktree prune [-n] [-v]\n   or: git worktree remove [-f] <worktree>'),
    'worktreeUsage',
    { key: 'sim.err.worktreeUsage' },
  );
};

/** Paths of linked worktrees (for goals and UIs). */
export function worktreePaths(state: SimState): string[] {
  const repo = findRepo(state);
  if (!repo) return [];
  return Object.keys(mainRepo(state, repo).worktrees ?? {}).sort();
}
