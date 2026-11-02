// Helpers shared by the git commands.
import { blobId, shortHash } from '../hash';
import { countChanges, diffLines, makeHunks, renderHunks } from '../diff';
import { fail, line, lines } from '../output';
import { isInside, relative, resolve } from '../paths';
import { computeStatus, collapseUntracked } from '../status';
import {
  currentBranch,
  deleteFile,
  gitDate,
  headId,
  headTree,
  history,
  pruneEmptyDirs,
  subject,
  upstreamOf,
  upstreamTip,
  workingTree,
  writeFile,
} from '../state';
import { displayPath } from '../paths';
import { countAheadBehind, decorationSegs, trackingLines } from '../refs';
import type { Commit, CommandResult, ConflictEntry, FileMap, Line, RebaseStep, Repo, Seg, SimState } from '../types';

// ---------------------------------------------------------------------------
// Pathspecs

export interface Pathspec {
  raw: string;
  /** Repo-relative prefix ('' means the whole repo) or exact file. */
  rel: string;
  glob: RegExp | null;
  outside: boolean;
}

export function toPathspec(state: SimState, repo: Repo, raw: string): Pathspec {
  const abs = resolve(state.cwd, raw, state.home);
  if (!isInside(abs, repo.root)) return { raw, rel: '', glob: null, outside: true };
  const rel = relative(abs, repo.root);
  if (/[*?]/.test(rel)) {
    const re = rel
      .split('')
      .map((ch) => (ch === '*' ? '.*' : ch === '?' ? '.' : ch.replace(/[.+^${}()|[\]\\]/g, '\\$&')))
      .join('');
    return { raw, rel, glob: new RegExp(`^${re}$`), outside: false };
  }
  return { raw, rel, glob: null, outside: false };
}

export function matches(spec: Pathspec, path: string): boolean {
  if (spec.outside) return false;
  if (spec.glob) return spec.glob.test(path);
  if (spec.rel === '') return true;
  return path === spec.rel || path.startsWith(`${spec.rel}/`);
}

export function outsideRepo(state: SimState, spec: Pathspec, repo: Repo): CommandResult {
  return fail(state, lines(`fatal: ${spec.raw}: '${spec.raw}' is outside repository at '${repo.root}'`), 'outsideRepo');
}

// ---------------------------------------------------------------------------
// Working tree updates

/** Write repo-relative files into the fake filesystem (null = delete). */
export function applyToWorking(state: SimState, repo: Repo, changes: Record<string, string | null>): void {
  const removed: string[] = [];
  for (const [rel, content] of Object.entries(changes)) {
    const abs = `${repo.root}/${rel}`;
    if (content === null) {
      if (abs in state.fs.files) removed.push(abs);
      deleteFile(state, abs);
    } else writeFile(state, abs, content);
  }
  pruneEmptyDirs(state, repo.root, removed);
}

/**
 * Move index + working folder from the current HEAD tree to `target`, keeping local
 * changes where it is safe. Returns paths that block the move.
 */
export function switchTrees(state: SimState, repo: Repo, target: FileMap): { blocked: string[]; untrackedBlocked: string[] } {
  const cur = headTree(repo);
  const work = workingTree(state, repo);
  const paths = new Set([...Object.keys(cur), ...Object.keys(target)]);
  const blocked: string[] = [];
  const untrackedBlocked: string[] = [];
  const changes: Record<string, string | null> = {};
  for (const p of paths) {
    if (cur[p] === target[p]) continue;
    const inIndex = Object.hasOwn(repo.index, p);
    if (!inIndex && p in work && target[p] !== undefined && work[p] !== target[p]) {
      untrackedBlocked.push(p);
      continue;
    }
    if (repo.index[p] !== cur[p] || (inIndex && work[p] !== repo.index[p])) {
      blocked.push(p);
      continue;
    }
    changes[p] = target[p] ?? null;
  }
  if (blocked.length || untrackedBlocked.length) return { blocked, untrackedBlocked };
  for (const [p, content] of Object.entries(changes)) {
    if (content === null) delete repo.index[p];
    else repo.index[p] = content;
  }
  applyToWorking(state, repo, changes);
  return { blocked, untrackedBlocked };
}

// ---------------------------------------------------------------------------
// Output pieces

/** "(HEAD -> main, tag: v1, origin/main)" decoration for a commit, in Git's order. */
export function decoration(repo: Repo, id: string): Seg[] {
  return decorationSegs(repo, id);
}

export function commitHeader(state: SimState, repo: Repo, c: Commit): Line[] {
  const out: Line[] = [[{ t: `commit ${c.id}`, c: 'yellow' }, ...decoration(repo, c.id)]];
  if (c.parents.length > 1) out.push(line(`Merge: ${c.parents.map((p) => shortHash(p)).join(' ')}`));
  out.push(line(`Author: ${c.author.name} <${c.author.email}>`));
  out.push(line(`Date:   ${gitDate(c.timestamp, state.tz)}`));
  out.push(line(''));
  for (const l of c.message.split('\n')) out.push(line(`    ${l}`));
  return out;
}

/** Unified diff between two trees, Git style. */
export function treeDiff(a: FileMap, b: FileMap, opts: { renames?: boolean; filter?: (p: string) => boolean } = {}): Line[] {
  const filter = opts.filter ?? (() => true);
  const paths = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(filter).sort();
  const added = paths.filter((p) => !(p in a) && p in b);
  const removed = paths.filter((p) => p in a && !(p in b));
  const renamedFrom = new Map<string, string>(); // new → old
  if (opts.renames) {
    for (const r of removed) {
      const match = added.find((x) => b[x] === a[r] && ![...renamedFrom.keys()].includes(x));
      if (match) renamedFrom.set(match, r);
    }
  }
  const renamedOld = new Set(renamedFrom.values());
  const out: Line[] = [];
  for (const p of paths) {
    if (renamedOld.has(p)) continue;
    const before = a[p];
    const after = b[p];
    if (before === after) continue;
    const from = renamedFrom.get(p);
    if (from) {
      out.push(line(`diff --git a/${from} b/${p}`, 'bold'));
      out.push(line('similarity index 100%', 'bold'));
      out.push(line(`rename from ${from}`, 'bold'));
      out.push(line(`rename to ${p}`, 'bold'));
      continue;
    }
    out.push(line(`diff --git a/${p} b/${p}`, 'bold'));
    const ops = diffLines(before ?? '', after ?? '');
    const hunks = makeHunks(ops);
    if (before === undefined) {
      out.push(line('new file mode 100644', 'bold'));
      out.push(line(`index 0000000..${shortHash(blobId(after ?? ''))}`, 'bold'));
    } else if (after === undefined) {
      out.push(line('deleted file mode 100644', 'bold'));
      out.push(line(`index ${shortHash(blobId(before))}..0000000`, 'bold'));
    } else {
      out.push(line(`index ${shortHash(blobId(before))}..${shortHash(blobId(after))} 100644`, 'bold'));
    }
    if (hunks.length === 0) continue;
    out.push(line(before === undefined ? '--- /dev/null' : `--- a/${p}`, 'bold'));
    out.push(line(after === undefined ? '+++ /dev/null' : `+++ b/${p}`, 'bold'));
    out.push(...renderHunks(ops, hunks));
  }
  return out;
}

/** " 2 files changed, 3 insertions(+), 1 deletion(-)" plus create/delete mode lines. */
export function commitStat(before: FileMap, after: FileMap): Line[] {
  const paths = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  const added = paths.filter((p) => !(p in before) && p in after);
  const removed = paths.filter((p) => p in before && !(p in after));
  const renames: [string, string][] = [];
  for (const r of removed) {
    const m = added.find((x) => after[x] === before[r] && !renames.some(([, n]) => n === x));
    if (m) renames.push([r, m]);
  }
  let files = 0;
  let ins = 0;
  let del = 0;
  const extra: Line[] = [];
  for (const p of paths) {
    if (before[p] === after[p]) continue;
    if (renames.some(([o, n]) => o === p || n === p)) continue;
    files++;
    const c = countChanges(diffLines(before[p] ?? '', after[p] ?? ''));
    ins += c.insertions;
    del += c.deletions;
    if (!(p in before)) extra.push(line(` create mode 100644 ${p}`));
    if (!(p in after)) extra.push(line(` delete mode 100644 ${p}`));
  }
  files += renames.length;
  for (const [o, n] of renames) extra.push(line(` rename ${o} => ${n} (100%)`));
  const parts = [` ${files} file${files === 1 ? '' : 's'} changed`];
  if (ins > 0 || del === 0) parts.push(`${ins} insertion${ins === 1 ? '' : 's'}(+)`);
  if (del > 0 || ins === 0) parts.push(`${del} deletion${del === 1 ? '' : 's'}(-)`);
  return [line(parts.join(', ')), ...extra.sort((x, y) => (x[0]!.t < y[0]!.t ? -1 : 1))];
}

// ---------------------------------------------------------------------------
// Status rendering (shared by `git status` and `git commit` with nothing staged)

const KIND_WIDTH = 12;

function kindLabel(kind: string): string {
  return `${kind}:`.padEnd(KIND_WIDTH, ' ');
}

export function headLine(repo: Repo): Line {
  if (repo.head.type === 'branch') return line(`On branch ${repo.head.name}`);
  if (repo.op?.kind === 'rebase') {
    return [{ t: 'interactive rebase in progress; onto ', c: 'red' }, { t: shortHash(repo.op.onto) }];
  }
  const at = repo.detachedFrom && repo.detachedFrom !== repo.head.commit ? 'from' : 'at';
  const shown = repo.detachedFrom ?? repo.head.commit;
  return [{ t: `HEAD detached ${at} `, c: 'red' }, { t: shortHash(shown), c: 'red' }];
}

/** "pick 39ce4e9 Fix day 1" */
export function todoLine(repo: Repo, step: RebaseStep): string {
  const c = repo.commits[step.commit];
  // Git 2.45+ writes the subject as a comment: `pick 1a2b3c4 # Add page`.
  return `${step.action} ${shortHash(step.commit)} # ${c ? subject(c.message) : ''}`;
}

/** The "rebase / merge / cherry-pick in progress" block of `git status`. */
function stateLines(repo: Repo, unmerged: boolean): Line[] {
  return [...opLines(repo, unmerged), ...bisectLines(repo)];
}

/** "You are currently bisecting" block of `git status`. */
function bisectLines(repo: Repo): Line[] {
  const b = repo.bisect;
  if (!b) return [];
  return [
    line(b.startDetached ? 'You are currently bisecting.' : `You are currently bisecting, started from branch '${b.start}'.`),
    line('  (use "git bisect reset" to get back to the original branch)'),
    line(''),
  ];
}

function opLines(repo: Repo, unmerged: boolean): Line[] {
  const op = repo.op;
  if (!op) return [];
  const out: Line[] = [];
  if (op.kind === 'merge') {
    if (unmerged) {
      out.push(line('You have unmerged paths.'), line('  (fix conflicts and run "git commit")'), line('  (use "git merge --abort" to abort the merge)'));
    } else out.push(line('All conflicts fixed but you are still merging.'), line('  (use "git commit" to conclude merge)'));
  } else if (op.kind === 'cherry-pick') {
    out.push(line(`You are currently cherry-picking commit ${shortHash(op.commit)}.`));
    out.push(line(unmerged ? '  (fix conflicts and run "git cherry-pick --continue")' : '  (all conflicts fixed: run "git cherry-pick --continue")'));
    out.push(line('  (use "git cherry-pick --skip" to skip this patch)'), line('  (use "git cherry-pick --abort" to cancel the cherry-pick operation)'));
  } else {
    const done = [...op.done, ...(op.current ? [op.current] : [])];
    if (done.length === 0) out.push(line('No commands done.'));
    else {
      const n = done.length;
      out.push(line(n === 1 ? 'Last command done (1 command done):' : `Last commands done (${n} commands done):`));
      for (const s of done.slice(-2)) out.push(line(`   ${todoLine(repo, s)}`));
      if (n > 2) out.push(line('  (see more in file .git/rebase-merge/done)'));
    }
    if (op.todo.length === 0) out.push(line('No commands remaining.'));
    else {
      const n = op.todo.length;
      out.push(line(n === 1 ? 'Next command to do (1 remaining command):' : `Next commands to do (${n} remaining commands):`));
      for (const s of op.todo.slice(0, 2)) out.push(line(`   ${todoLine(repo, s)}`));
      out.push(line('  (use "git rebase --edit-todo" to view and edit)'));
    }
    const where = op.branch ? `You are currently rebasing branch '${op.branch}' on '${shortHash(op.onto)}'.` : 'You are currently rebasing.';
    out.push(line(where));
    if (unmerged) {
      out.push(
        line('  (fix conflicts and then run "git rebase --continue")'),
        line('  (use "git rebase --skip" to skip this patch)'),
        line('  (use "git rebase --abort" to check out the original branch)'),
      );
    } else out.push(line('  (all conflicts fixed: run "git rebase --continue")'));
  }
  out.push(line(''));
  return out;
}

const UNMERGED_WIDTH = 17;

export function renderLongStatus(state: SimState, repo: Repo): Line[] {
  const st = computeStatus(state, repo);
  const noCommits = headId(repo) === null;
  const show = (p: string) => displayPath(p, repo.root, state.cwd);
  const out: Line[] = [headLine(repo)];
  if (repo.head.type === 'branch' && !noCommits) {
    const tracking = trackingLines(repo, repo.head.name);
    if (tracking.length) out.push(...tracking, line(''));
  }
  out.push(...stateLines(repo, st.unmerged.length > 0));
  if (noCommits) out.push(line(''), line('No commits yet'), line(''));
  // During a merge or cherry-pick Git hides the "unstage" hints.
  const fromCommit = repo.op?.kind !== 'merge' && repo.op?.kind !== 'cherry-pick';

  if (st.staged.length) {
    out.push(line('Changes to be committed:'));
    if (fromCommit) {
      out.push(
        line(
          noCommits
            ? '  (use "git rm --cached <file>..." to unstage)'
            : '  (use "git restore --staged <file>..." to unstage)',
        ),
      );
    }
    for (const e of st.staged) {
      const name = e.kind === 'renamed' ? `${show(e.from!)} -> ${show(e.path)}` : show(e.path);
      out.push([{ t: '\t' }, { t: `${kindLabel(e.kind)}${name}`, c: 'green' }]);
    }
    out.push(line(''));
  }
  if (st.unmerged.length) {
    out.push(line('Unmerged paths:'));
    if (fromCommit) out.push(line('  (use "git restore --staged <file>..." to unstage)'));
    const deletes = st.unmerged.filter((e) => e.kind === 'deleted by us' || e.kind === 'deleted by them').length;
    const bothDeleted = st.unmerged.some((e) => e.kind === 'both deleted');
    const others = st.unmerged.length - deletes - (bothDeleted ? 1 : 0);
    if (!bothDeleted) {
      out.push(line(deletes ? '  (use "git add/rm <file>..." as appropriate to mark resolution)' : '  (use "git add <file>..." to mark resolution)'));
    } else if (!deletes && !others) out.push(line('  (use "git rm <file>..." to mark resolution)'));
    else out.push(line('  (use "git add/rm <file>..." as appropriate to mark resolution)'));
    for (const e of st.unmerged) {
      out.push([{ t: '\t' }, { t: `${`${e.kind}:`.padEnd(UNMERGED_WIDTH, ' ')}${show(e.path)}`, c: 'red' }]);
    }
    out.push(line(''));
  }
  if (st.unstaged.length) {
    const anyDeleted = st.unstaged.some((e) => e.kind === 'deleted');
    out.push(line('Changes not staged for commit:'));
    out.push(
      line(
        anyDeleted
          ? '  (use "git add/rm <file>..." to update what will be committed)'
          : '  (use "git add <file>..." to update what will be committed)',
      ),
    );
    out.push(line('  (use "git restore <file>..." to discard changes in working directory)'));
    for (const e of st.unstaged) out.push([{ t: '\t' }, { t: `${kindLabel(e.kind)}${show(e.path)}`, c: 'red' }]);
    out.push(line(''));
  }
  const untracked = collapseUntracked(st.untracked, { ...repo.index, ...repo.conflicts });
  if (untracked.length) {
    out.push(line('Untracked files:'));
    out.push(line('  (use "git add <file>..." to include in what will be committed)'));
    for (const p of untracked) out.push([{ t: '\t' }, { t: show(p), c: 'red' }]);
    out.push(line(''));
  }
  if (!st.staged.length) {
    if (st.unstaged.length || st.unmerged.length) out.push(line('no changes added to commit (use "git add" and/or "git commit -a")'));
    else if (untracked.length) out.push(line('nothing added to commit but untracked files present (use "git add" to track)'));
    else if (noCommits) out.push(line('nothing to commit (create/copy files and use "git add" to track)'));
    else out.push(line('nothing to commit, working tree clean'));
  }
  return out;
}

/** "## main...origin/main [ahead 1, behind 2]" for `git status -sb`. */
export function shortBranchLine(repo: Repo): Line {
  const segs: Seg[] = [{ t: '## ' }];
  if (repo.head.type !== 'branch') return [...segs, { t: 'HEAD (no branch)', c: 'red' }];
  const name = repo.head.name;
  if (headId(repo) === null) segs.push({ t: 'No commits yet on ' });
  segs.push({ t: name, c: 'green' });
  const up = upstreamOf(repo, name);
  if (!up) return segs;
  segs.push({ t: '...' }, { t: up.ref, c: 'red' });
  const tip = upstreamTip(repo, up);
  const local = repo.branches[name];
  if (!tip) return [...segs, { t: ' [gone]' }];
  if (!local) return segs;
  const { ahead, behind } = countAheadBehind(repo.commits, local, tip);
  if (!ahead && !behind) return segs;
  segs.push({ t: ' [' });
  if (!ahead) segs.push({ t: 'behind ' }, { t: String(behind), c: 'red' });
  else if (!behind) segs.push({ t: 'ahead ' }, { t: String(ahead), c: 'green' });
  else segs.push({ t: 'ahead ' }, { t: String(ahead), c: 'green' }, { t: ', behind ' }, { t: String(behind), c: 'red' });
  segs.push({ t: ']' });
  return segs;
}

export function renderShortStatus(state: SimState, repo: Repo): Line[] {
  const st = computeStatus(state, repo);
  const show = (p: string) => displayPath(p, repo.root, state.cwd);
  const rows = new Map<string, { x: string; y: string; label: string }>();
  const code = { 'new file': 'A', modified: 'M', deleted: 'D', renamed: 'R' } as const;
  for (const e of st.staged) {
    const label = e.kind === 'renamed' ? `${show(e.from!)} -> ${show(e.path)}` : show(e.path);
    rows.set(e.path, { x: code[e.kind], y: ' ', label });
  }
  for (const e of st.unstaged) {
    const row = rows.get(e.path) ?? { x: ' ', y: ' ', label: show(e.path) };
    row.y = e.kind === 'modified' ? 'M' : 'D';
    rows.set(e.path, row);
  }
  const out: Line[] = [...rows.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, r]) => [
      { t: r.x, c: 'green' as const },
      { t: r.y, c: 'red' as const },
      { t: ` ${r.label}` },
    ]);
  // Git lists unmerged paths in the same path order as the rest.
  for (const e of st.unmerged) {
    const at = out.findIndex((l) => (l[2]?.t.slice(1) ?? '') > show(e.path));
    const row: Line = [{ t: e.code, c: 'red' }, { t: ` ${show(e.path)}` }];
    if (at === -1) out.push(row);
    else out.splice(at, 0, row);
  }
  for (const p of collapseUntracked(st.untracked, { ...repo.index, ...repo.conflicts })) out.push([{ t: '??', c: 'red' }, { t: ` ${show(p)}` }]);
  return out;
}

/** Diffstat as printed by `git merge` / `git pull`: file lines, summary, then create/delete modes. */
export function mergeStat(before: FileMap, after: FileMap): Line[] {
  const stat = statLines(before, after);
  if (!stat.length) return [];
  const modes: Line[] = [];
  for (const p of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
    if (!(p in before) && p in after) modes.push(line(` create mode 100644 ${p}`));
    else if (p in before && !(p in after)) modes.push(line(` delete mode 100644 ${p}`));
  }
  return [...stat, ...modes];
}

/** Local changes that a tree switch to `target` would overwrite (tracked) or untracked files in the way. */
export function blockingChanges(state: SimState, repo: Repo, target: FileMap): { dirty: string[]; untracked: string[] } {
  const cur = headTree(repo);
  const work = workingTree(state, repo);
  const dirty: string[] = [];
  const untracked: string[] = [];
  for (const p of [...new Set([...Object.keys(cur), ...Object.keys(target)])].sort()) {
    if (cur[p] === target[p]) continue;
    const inIndex = Object.hasOwn(repo.index, p);
    if (!inIndex && !(p in cur)) {
      if (p in work && target[p] !== undefined && work[p] !== target[p]) untracked.push(p);
      continue;
    }
    if (repo.index[p] !== cur[p] || work[p] !== repo.index[p]) dirty.push(p);
  }
  return { dirty, untracked };
}

/**
 * Write a merge result: index becomes `index`, the given conflicts are recorded,
 * and working files change only where the result differs from HEAD.
 */
export function applyMergeResult(
  state: SimState,
  repo: Repo,
  result: { index: FileMap; working: FileMap; conflicts: Record<string, ConflictEntry> },
): void {
  const cur = headTree(repo);
  const changes: Record<string, string | null> = {};
  for (const p of new Set([...Object.keys(cur), ...Object.keys(result.working)])) {
    if (cur[p] !== result.working[p]) changes[p] = result.working[p] ?? null;
  }
  // Keep local edits in files the merge doesn't touch.
  const newIndex: FileMap = { ...result.index };
  for (const [p, v] of Object.entries(repo.index)) {
    if (cur[p] === result.index[p] && !(p in result.conflicts) && v !== cur[p]) newIndex[p] = v;
  }
  repo.index = newIndex;
  repo.conflicts = { ...result.conflicts };
  applyToWorking(state, repo, changes);
}

/** "U\tpath" lines plus Git's refusal when unmerged files block a commit. */
export function unmergedCommitError(repo: Repo, verb: 'Committing' | 'Merging' | 'Cherry-picking' | 'Reverting' | 'Pulling' = 'Committing'): Line[] {
  const out: Line[] = verb === 'Committing' ? Object.keys(repo.conflicts).sort().map((p) => line(`U\t${p}`)) : [];
  out.push(
    line(`error: ${verb} is not possible because you have unmerged files.`),
    line("hint: Fix them up in the work tree, and then use 'git add/rm <file>'"),
    line('hint: as appropriate to mark resolution and make a commit.'),
    line(verb === 'Cherry-picking' ? 'fatal: cherry-pick failed' : 'fatal: Exiting because of an unresolved conflict.'),
  );
  return out;
}

export function shortLine(c: Commit): string {
  return `${shortHash(c.id)} ${subject(c.message)}`;
}

/** Commits reachable from HEAD that no branch can reach (lost when leaving detached HEAD). */
export function orphanedFromHead(repo: Repo): Commit[] {
  const id = headId(repo);
  if (!id || repo.head.type === 'branch') return [];
  const reachable = new Set<string>();
  for (const tip of [...Object.values(repo.branches), ...Object.values(repo.tags), ...Object.values(repo.remoteRefs)]) {
    const stack = [tip];
    while (stack.length) {
      const cur = stack.pop()!;
      if (reachable.has(cur)) continue;
      reachable.add(cur);
      stack.push(...(repo.commits[cur]?.parents ?? []));
    }
  }
  return history(repo, id).filter((c) => !reachable.has(c.id));
}

export function branchLabel(repo: Repo): string {
  return currentBranch(repo) ?? 'detached HEAD';
}

/** `--stat` view: " file | 3 ++-" lines plus the summary line. */
export function statLines(before: FileMap, after: FileMap, filter: (p: string) => boolean = () => true): Line[] {
  const paths = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(filter).sort();
  const rows: { name: string; ins: number; del: number }[] = [];
  for (const p of paths) {
    if (before[p] === after[p]) continue;
    const c = countChanges(diffLines(before[p] ?? '', after[p] ?? ''));
    rows.push({ name: p, ins: c.insertions, del: c.deletions });
  }
  if (!rows.length) return [];
  const nameW = Math.max(...rows.map((r) => r.name.length));
  const numW = Math.max(...rows.map((r) => String(r.ins + r.del).length));
  const out: Line[] = rows.map((r) => [
    { t: ` ${r.name.padEnd(nameW)} | ${String(r.ins + r.del).padStart(numW)} ` },
    { t: '+'.repeat(Math.min(r.ins, 50)), c: 'green' },
    { t: '-'.repeat(Math.min(r.del, 50)), c: 'red' },
  ]);
  const ins = rows.reduce((n, r) => n + r.ins, 0);
  const del = rows.reduce((n, r) => n + r.del, 0);
  const parts = [` ${rows.length} file${rows.length === 1 ? '' : 's'} changed`];
  if (ins > 0 || del === 0) parts.push(`${ins} insertion${ins === 1 ? '' : 's'}(+)`);
  if (del > 0 || ins === 0) parts.push(`${del} deletion${del === 1 ? '' : 's'}(-)`);
  out.push(line(parts.join(', ')));
  return out;
}
