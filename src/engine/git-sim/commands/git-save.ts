// git status, add (incl. simplified -p), commit, rm, mv.
import { applyHunks, diffLines, makeHunks, renderHunks } from '../diff';
import { blobId, shortHash } from '../hash';
import { fail, line, lines, notARepo, ok } from '../output';
import { Args } from '../parse';
import { isInside, relative, resolve } from '../paths';
import { computeStatus } from '../status';
import {
  clone,
  deleteFile,
  dirExists,
  findRepo,
  gitDate,
  hasConflicts,
  headId,
  headTree,
  identity,
  ignoreRules,
  isIgnored,
  makeCommit,
  moveHead,
  pruneEmptyDirs,
  subject,
  workingTree,
  writeFile,
} from '../state';
import type { CommandFn, CommandResult, Line, PendingPatch, SimEvent, SimState } from '../types';
import { trackingInfo } from '../refs';
import { concludeMerge, continueCherryPick, continueRebase } from './git-merge';
import {
  commitStat,
  matches,
  outsideRepo,
  renderLongStatus,
  renderShortStatus,
  shortBranchLine,
  toPathspec,
  unmergedCommitError,
} from './common';

function badOption(state: SimState, opt: string): CommandResult {
  return fail(state, lines(`error: unknown option '${opt.replace(/^-+/, '')}'`), 'badOption', {
    key: 'sim.err.badOption',
    params: { option: opt },
  });
}

// ---------------------------------------------------------------------------

export const status: CommandFn = (state, args) => {
  const repo = findRepo(state);
  if (!repo) return notARepo(state);
  const a = new Args(args, { flags: ['-s', '--short', '-b', '--branch', '--long'], combined: true });
  if (a.unknown.length) return badOption(state, a.unknown[0]!);
  if (a.has('-s', '--short')) {
    const out = renderShortStatus(state, repo);
    if (a.has('-b', '--branch')) out.unshift(shortBranchLine(repo));
    return ok(state, out, [], { key: 'sim.explain.statusShort' });
  }
  const st = computeStatus(state, repo);
  const t = repo.head.type === 'branch' && headId(repo) ? trackingInfo(repo, repo.head.name) : null;
  let key = st.staged.length || st.unstaged.length || st.untracked.length ? 'sim.explain.status' : 'sim.explain.statusClean';
  if (repo.op?.kind === 'merge') key = st.unmerged.length ? 'sim.explain.statusMergeConflict' : 'sim.explain.statusMergeReady';
  else if (repo.op?.kind === 'rebase') key = st.unmerged.length ? 'sim.explain.statusRebaseConflict' : 'sim.explain.statusRebaseReady';
  else if (repo.op?.kind === 'cherry-pick') key = st.unmerged.length ? 'sim.explain.statusPickConflict' : 'sim.explain.statusPickReady';
  else if (st.unmerged.length) key = 'sim.explain.statusConflict';
  else if (t?.gone) key = 'sim.explain.statusGone';
  else if (t && t.ahead && t.behind) key = 'sim.explain.statusDiverged';
  else if (t && t.ahead) key = 'sim.explain.statusAhead';
  else if (t && t.behind) key = 'sim.explain.statusBehind';
  return ok(state, renderLongStatus(state, repo), [], { key, params: { upstream: t?.upstream.ref ?? '', ahead: String(t?.ahead ?? 0), behind: String(t?.behind ?? 0) } });
};

// ---------------------------------------------------------------------------

export const add: CommandFn = (state, args) => {
  const repo = findRepo(state);
  if (!repo) return notARepo(state);
  const a = new Args(args, {
    flags: ['-A', '--all', '-u', '--update', '-f', '--force', '-p', '--patch', '-v', '--verbose', '--renormalize'],
    combined: true,
  });
  if (a.unknown.length) return badOption(state, a.unknown[0]!);
  if (a.has('-p', '--patch')) return startPatch(state, a.positional);

  const all = a.has('-A', '--all');
  // --renormalize re-adds tracked files with fresh line endings and implies -u.
  // The simulator stores every file with LF already, so it works like -u (World 11).
  const update = a.has('-u', '--update', '--renormalize');
  if (!all && !update && a.positional.length === 0) {
    return fail(
      state,
      lines(
        "Nothing specified, nothing added.\nhint: Maybe you wanted to say 'git add .'?\nhint: Turn this message off by running\nhint: \"git config advice.addEmptyPathspec false\"",
      ),
      'nothingSpecified',
      { key: 'sim.err.addNothing' },
    );
  }

  const work = workingTree(state, repo);
  const rules = ignoreRules(state, repo);
  const specs = (all || update) && a.positional.length === 0 ? [toPathspec(state, repo, repo.root)] : a.positional.map((p) => toPathspec(state, repo, p));
  const force = a.has('-f', '--force');

  const candidates = new Set<string>();
  const ignoredHits: string[] = [];
  for (const spec of specs) {
    if (spec.outside) return outsideRepo(state, spec, repo);
    let hit = false;
    for (const p of new Set([...Object.keys(work), ...Object.keys(repo.index), ...Object.keys(repo.conflicts)])) {
      if (!matches(spec, p)) continue;
      const tracked = Object.hasOwn(repo.index, p) || Object.hasOwn(repo.conflicts, p);
      if (update && !tracked) continue;
      if (!tracked && isIgnored(rules, p) && !force) {
        // Ignored files only complain when named exactly.
        if (spec.rel === p) ignoredHits.push(p);
        hit = hit || spec.rel === p;
        continue;
      }
      candidates.add(p);
      hit = true;
    }
    if (!hit && !update) {
      return fail(state, lines(`fatal: pathspec '${spec.raw}' did not match any files`), 'pathspecNoMatch', {
        key: 'sim.err.pathspec',
        params: { path: spec.raw },
      });
    }
  }

  const next = clone(state);
  const r = findRepo(next)!;
  const events: SimEvent[] = [];
  const staged: string[] = [];
  const resolved: string[] = [];
  for (const p of [...candidates].sort()) {
    if (Object.hasOwn(r.conflicts, p)) {
      // Adding a conflicted file marks it as resolved (with whatever is in the file now).
      delete r.conflicts[p];
      if (p in work) r.index[p] = work[p]!;
      else delete r.index[p];
      events.push({ type: 'conflictResolved', path: p }, { type: 'fileStaged', path: p, ...(p in work ? {} : { deleted: true }) });
      staged.push(p);
      resolved.push(p);
      continue;
    }
    if (p in work) {
      if (r.index[p] !== work[p]) {
        r.index[p] = work[p]!;
        events.push({ type: 'fileStaged', path: p });
        staged.push(p);
      }
    } else if (p in r.index) {
      delete r.index[p];
      events.push({ type: 'fileStaged', path: p, deleted: true });
      staged.push(p);
    }
  }

  if (ignoredHits.length) {
    const out = lines(
      `The following paths are ignored by one of your .gitignore files:\n${ignoredHits.join('\n')}\nhint: Use -f if you really want to add them.\nhint: Turn this message off by running\nhint: "git config advice.addIgnoredFile false"`,
    );
    return { state: next, output: out, events: [...events, { type: 'error', code: 'ignored' }], ok: false, explain: { key: 'sim.err.addIgnored', params: { path: ignoredHits[0]! } } };
  }
  const verbose: Line[] = a.has('-v', '--verbose') ? staged.map((p) => line(`add '${p}'`)) : [];
  if (resolved.length) {
    const left = Object.keys(r.conflicts).length;
    const markers = resolved.filter((p) => /^(<{7}|={7}|>{7})( |$)/m.test(work[p] ?? ''));
    return ok(next, verbose, events, {
      key: markers.length ? 'sim.explain.addResolvedMarkers' : left ? 'sim.explain.addResolvedSome' : 'sim.explain.addResolvedAll',
      params: { file: markers[0] ?? resolved[0]!, count: String(left) },
    });
  }
  return ok(next, verbose, events, {
    key: staged.length === 0 ? 'sim.explain.addNoop' : staged.length === 1 ? 'sim.explain.addOne' : 'sim.explain.addMany',
    params: { file: staged[0] ?? '', count: String(staged.length) },
  });
};

// Simplified `git add -p`: one question per hunk. Answers: y, n, q, a, d, ?

const PATCH_PROMPT_HELP = [
  'y - stage this hunk',
  'n - do not stage this hunk',
  'q - quit; do not stage this hunk or any of the remaining ones',
  'a - stage this hunk and all later hunks in the file',
  'd - do not stage this hunk or any of the later hunks in the file',
  '? - print help',
];

function patchView(state: SimState, pending: PendingPatch): { output: Line[]; prompt: string } {
  const repo = state.repos[pending.repoRoot]!;
  const work = workingTree(state, repo);
  const first = pending.queue[0]!;
  const ops = diffLines(repo.index[first.path] ?? '', work[first.path] ?? '');
  const hunks = makeHunks(ops);
  const out: Line[] = [];
  const before = repo.index[first.path] ?? '';
  const after = work[first.path] ?? '';
  // Like Git, the file header shows once per file; the counter is per file too.
  if (pending.lastShown !== first.path) {
    out.push(line(`diff --git a/${first.path} b/${first.path}`, 'bold'));
    out.push(line(`index ${shortHash(blobId(before))}..${shortHash(blobId(after))} 100644`, 'bold'));
    out.push(line(`--- a/${first.path}`, 'bold'));
    out.push(line(`+++ b/${first.path}`, 'bold'));
    pending.lastShown = first.path;
  }
  const h = hunks[first.hunkIndex];
  if (h) out.push(...renderHunks(ops, [h]));
  const total = pending.totals[first.path] ?? 1;
  return { output: out, prompt: `(${first.hunkIndex + 1}/${total}) Stage this hunk [y,n,q,a,d,?]? ` };
}

function startPatch(state: SimState, paths: string[]): CommandResult {
  const repo = findRepo(state)!;
  const work = workingTree(state, repo);
  const specs = paths.length ? paths.map((p) => toPathspec(state, repo, p)) : [toPathspec(state, repo, repo.root)];
  const queue: PendingPatch['queue'] = [];
  const totals: Record<string, number> = {};
  for (const path of Object.keys(repo.index).sort()) {
    if (!specs.some((s) => matches(s, path))) continue;
    if (!(path in work) || work[path] === repo.index[path]) continue;
    const hunks = makeHunks(diffLines(repo.index[path]!, work[path]!));
    totals[path] = hunks.length;
    hunks.forEach((_, i) => queue.push({ path, hunkIndex: i }));
  }
  if (queue.length === 0) return ok(state, [line('No changes.')], [], { key: 'sim.explain.patchNone' });
  const next = clone(state);
  next.pending = { kind: 'addPatch', repoRoot: repo.root, queue, accepted: {}, totals, lastShown: null };
  const view = patchView(next, next.pending);
  return { state: next, output: view.output, events: [], ok: true, prompt: view.prompt, explain: { key: 'sim.explain.patchStart' } };
}

function finishPatch(state: SimState): CommandResult {
  const pending = state.pending!;
  const next = clone(state);
  const repo = next.repos[pending.repoRoot]!;
  const work = workingTree(next, repo);
  const events: SimEvent[] = [];
  for (const [path, accepted] of Object.entries(pending.accepted)) {
    if (!accepted.length) continue;
    const ops = diffLines(repo.index[path] ?? '', work[path] ?? '');
    repo.index[path] = applyHunks(ops, makeHunks(ops), accepted);
    events.push({ type: 'fileStaged', path });
  }
  next.pending = null;
  return ok(next, [], events, { key: events.length ? 'sim.explain.patchDone' : 'sim.explain.patchNone' });
}

export function answerPatch(state: SimState, answer: string): CommandResult {
  const pending = state.pending!;
  const key = answer.trim().toLowerCase();
  const current = pending.queue[0]!;
  const next = clone(state);
  const p = next.pending!;
  const accept = (item: { path: string; hunkIndex: number }) => {
    (p.accepted[item.path] ??= []).push(item.hunkIndex);
  };
  switch (key) {
    case 'y':
      accept(current);
      p.queue.shift();
      break;
    case 'n':
      p.queue.shift();
      break;
    case 'a':
      while (p.queue[0]?.path === current.path) accept(p.queue.shift()!);
      break;
    case 'd':
      while (p.queue[0]?.path === current.path) p.queue.shift();
      break;
    case 'q':
      p.queue = [];
      break;
    default: {
      const view = patchView(state, { ...pending, lastShown: pending.queue[0]?.path ?? null });
      return {
        state,
        output: PATCH_PROMPT_HELP.map((l) => line(l, 'red')),
        events: [],
        ok: true,
        prompt: view.prompt,
        explain: { key: 'sim.explain.patchHelp' },
      };
    }
  }
  if (p.queue.length === 0) return finishPatch(next);
  const view = patchView(next, p);
  return { state: next, output: view.output, events: [], ok: true, prompt: view.prompt };
}

// ---------------------------------------------------------------------------

export const commit: CommandFn = (state, args, ctx) => {
  const repo = findRepo(state);
  if (!repo) return notARepo(state);
  const a = new Args(args, {
    flags: ['-a', '--all', '--amend', '--no-edit', '--allow-empty', '-q', '--quiet'],
    values: ['-m', '--message'],
    combined: true,
  });
  if (a.unknown.length) return badOption(state, a.unknown[0]!);
  // Several -m flags join as paragraphs.
  const messages: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const w = args[i]!;
    if (w === '-m' || w === '--message' || /^-[a-zA-Z]*m$/.test(w)) {
      const v = args[i + 1];
      if (v !== undefined) messages.push(v);
      i++;
    } else if (w.startsWith('--message=')) messages.push(w.slice('--message='.length));
  }
  const amend = a.has('--amend');
  const noEdit = a.has('--no-edit');
  const parentId = headId(repo);
  const head = parentId ? repo.commits[parentId] : undefined;

  // A stopped merge / cherry-pick / rebase, or unresolved conflicts.
  if (!amend && (repo.op || hasConflicts(repo))) {
    let cur = state;
    if (a.has('-a', '--all') && hasConflicts(repo)) {
      // `commit -a` adds conflicted files as they are now (markers and all), like Git.
      cur = clone(state);
      const r0 = findRepo(cur)!;
      const work0 = workingTree(cur, r0);
      for (const p of Object.keys(r0.conflicts)) {
        if (p in work0) r0.index[p] = work0[p]!;
        else delete r0.index[p];
      }
      r0.conflicts = {};
      if (!r0.op) return commit(cur, args, ctx);
    }
    const r1 = findRepo(cur)!;
    if (hasConflicts(r1)) return fail(state, unmergedCommitError(r1), 'unmerged', { key: 'sim.err.unmerged' });
    const msg = messages.length ? messages.join('\n\n') : undefined;
    if (a.has('-a', '--all')) {
      cur = cur === state ? clone(state) : cur;
      const r2 = findRepo(cur)!;
      const w2 = workingTree(cur, r2);
      for (const p of Object.keys(r2.index)) {
        if (!(p in w2)) delete r2.index[p];
        else r2.index[p] = w2[p]!;
      }
    }
    const op = findRepo(cur)!.op;
    if (op?.kind === 'merge') return concludeMerge(cur, msg);
    if (op?.kind === 'cherry-pick') return continueCherryPick(cur, msg);
    if (op?.kind === 'rebase' && op.current) {
      const r3 = findRepo(cur)!;
      if (JSON.stringify(sortKeys(r3.index)) !== JSON.stringify(sortKeys(headTree(r3)))) return continueRebase(cur, msg, true);
    }
  }

  if (amend && !head) {
    return fail(state, lines('fatal: You have nothing to amend.'), 'nothingToAmend', { key: 'sim.err.nothingToAmend' });
  }
  if (messages.length === 0 && !amend && !a.has('--allow-empty')) {
    // Git says "nothing to commit" before it would ever open an editor.
    let wouldCommit = repo.index;
    if (a.has('-a', '--all')) {
      const work = workingTree(state, repo);
      wouldCommit = Object.fromEntries(Object.keys(repo.index).filter((p) => p in work).map((p) => [p, work[p]!]));
    }
    if (JSON.stringify(sortKeys(wouldCommit)) === JSON.stringify(sortKeys(headTree(repo)))) {
      return fail(state, renderLongStatus(state, repo), 'nothingToCommit', {
        key: computeStatus(state, repo).unstaged.length ? 'sim.err.nothingStaged' : 'sim.err.nothingToCommit',
      });
    }
  }
  if (messages.length === 0 && !(amend && noEdit)) {
    return fail(
      state,
      lines('hint: This practice terminal has no text editor.\nhint: Add a message with -m "your message"'),
      'needMessage',
      { key: 'sim.err.needMessage' },
    );
  }
  const message = messages.length ? messages.join('\n\n') : head!.message;
  if (message.trim() === '') {
    return fail(state, lines('Aborting commit due to empty commit message.'), 'emptyMessage', { key: 'sim.err.emptyMessage' });
  }
  const author = identity(state, repo);
  if (!author) {
    return fail(
      state,
      lines(
        [
          'Author identity unknown',
          '',
          '*** Please tell me who you are.',
          '',
          'Run',
          '',
          '  git config --global user.email "you@example.com"',
          '  git config --global user.name "Your Name"',
          '',
          "to set your account's default identity.",
          'Omit --global to set the identity only in this repository.',
          '',
          "fatal: unable to auto-detect email address (got 'you@practice.(none)')",
        ].join('\n'),
      ),
      'noIdentity',
      { key: 'sim.err.noIdentity' },
    );
  }

  const next = clone(state);
  const r = findRepo(next)!;
  const events: SimEvent[] = [];
  if (a.has('-a', '--all')) {
    const work = workingTree(next, r);
    for (const p of Object.keys(r.index)) {
      if (!(p in work)) {
        delete r.index[p];
        events.push({ type: 'fileStaged', path: p, deleted: true });
      } else if (work[p] !== r.index[p]) {
        r.index[p] = work[p]!;
        events.push({ type: 'fileStaged', path: p });
      }
    }
  }

  const base = amend ? (head!.parents[0] ? r.commits[head!.parents[0]]!.snapshot : {}) : headTree(r);
  const sameAsBase = JSON.stringify(sortKeys(r.index)) === JSON.stringify(sortKeys(base));
  if (!amend && sameAsBase && !a.has('--allow-empty')) {
    const out = renderLongStatus(state, repo);
    return fail(state, out, 'nothingToCommit', {
      key: computeStatus(state, repo).unstaged.length ? 'sim.err.nothingStaged' : 'sim.err.nothingToCommit',
    });
  }

  const parents = amend ? [...head!.parents] : parentId ? [parentId] : [];
  const created = makeCommit(next, r, {
    message,
    parents,
    snapshot: r.index,
    author: amend ? head!.author : author,
    ...(amend ? { timestamp: head!.timestamp } : {}),
  });
  const reflogMsg = amend ? 'commit (amend)' : parents.length === 0 ? 'commit (initial)' : 'commit';
  const before = headId(r);
  moveHead(r, created.id, `${reflogMsg}: ${subject(message)}`);
  if (r.head.type === 'detached' && !r.detachedFrom) r.detachedFrom = before;
  events.push({ type: 'commitCreated', id: created.id, ...(amend ? { amend: true } : {}) });
  if (r.head.type === 'branch') events.push({ type: 'branchMoved', branch: r.head.name, from: before, to: created.id });
  events.push({ type: 'headMoved', from: before, to: created.id });

  const where = r.head.type === 'branch' ? r.head.name : 'detached HEAD';
  const root = parents.length === 0 ? ' (root-commit)' : '';
  const out: Line[] = [];
  if (!a.has('-q', '--quiet')) {
    out.push(line(`[${where}${root} ${shortHash(created.id)}] ${subject(message)}`));
    if (amend) out.push(line(` Date: ${gitDate(created.timestamp, next.tz)}`));
    out.push(...commitStat(base, created.snapshot));
  }
  return ok(next, out, events, {
    key: amend ? 'sim.explain.amend' : parents.length === 0 ? 'sim.explain.commitFirst' : 'sim.explain.commit',
    params: { hash: shortHash(created.id), message: subject(message) },
  });
};

function sortKeys(m: Record<string, string>): [string, string][] {
  return Object.entries(m).sort(([x], [y]) => x.localeCompare(y));
}

// ---------------------------------------------------------------------------

export const rm: CommandFn = (state, args) => {
  const repo = findRepo(state);
  if (!repo) return notARepo(state);
  const a = new Args(args, { flags: ['--cached', '-f', '--force', '-r', '-q', '--quiet'], combined: true });
  if (a.unknown.length) return badOption(state, a.unknown[0]!);
  if (a.positional.length === 0) {
    return fail(state, lines('usage: git rm [-f | --force] [--cached] [-r] [--] <pathspec>...'), 'usage');
  }
  const cached = a.has('--cached');
  const force = a.has('-f', '--force');
  const recursive = a.has('-r');
  const head = headTree(repo);
  const work = workingTree(state, repo);
  const targets: string[] = [];
  for (const raw of a.positional) {
    const spec = toPathspec(state, repo, raw);
    if (spec.outside) return outsideRepo(state, spec, repo);
    const hits = [...Object.keys(repo.index), ...Object.keys(repo.conflicts)].filter((p) => matches(spec, p));
    if (hits.length === 0) {
      return fail(state, lines(`fatal: pathspec '${raw}' did not match any files`), 'pathspecNoMatch', {
        key: 'sim.err.rmPathspec',
        params: { path: raw },
      });
    }
    const isDirSpec = !spec.glob && spec.rel !== '' && !(spec.rel in repo.index) && !(spec.rel in repo.conflicts);
    if (isDirSpec && !recursive) {
      return fail(state, lines(`fatal: not removing '${raw}' recursively without -r`), 'needR', { key: 'sim.err.rmNeedR' });
    }
    targets.push(...hits);
  }
  if (!force) {
    // Conflicted files can always be removed: that is how you choose "delete" as the resolution.
    const checked = targets.filter((p) => !Object.hasOwn(repo.conflicts, p));
    const stagedChanges = checked.filter((p) => repo.index[p] !== head[p]);
    const localMods = checked.filter((p) => p in work && work[p] !== repo.index[p]);
    if (!cached && stagedChanges.length) {
      return fail(
        state,
        lines(
          `error: the following file${stagedChanges.length > 1 ? 's have' : ' has'} changes staged in the index:\n${stagedChanges
            .map((p) => `    ${p}`)
            .join('\n')}\n(use --cached to keep the file, or -f to force removal)`,
        ),
        'rmStaged',
        { key: 'sim.err.rmStaged' },
      );
    }
    if (!cached && localMods.length) {
      return fail(
        state,
        lines(
          `error: the following file${localMods.length > 1 ? 's have' : ' has'} local modifications:\n${localMods
            .map((p) => `    ${p}`)
            .join('\n')}\n(use --cached to keep the file, or -f to force removal)`,
        ),
        'rmLocal',
        { key: 'sim.err.rmLocal' },
      );
    }
  }
  const next = clone(state);
  const r = findRepo(next)!;
  const events: SimEvent[] = [];
  const out: Line[] = [];
  for (const p of [...new Set(targets)].sort()) {
    delete r.index[p];
    if (Object.hasOwn(r.conflicts, p)) {
      delete r.conflicts[p];
      events.push({ type: 'conflictResolved', path: p });
    }
    if (!cached) {
      deleteFile(next, `${r.root}/${p}`);
      pruneEmptyDirs(next, r.root, [`${r.root}/${p}`]);
    }
    events.push({ type: 'fileStaged', path: p, deleted: true });
    if (!a.has('-q', '--quiet')) out.push(line(`rm '${p}'`));
  }
  return ok(next, out, events, {
    key: cached ? 'sim.explain.gitRmCached' : 'sim.explain.gitRm',
    params: { file: targets[0] ?? '' },
  });
};

export const mv: CommandFn = (state, args) => {
  const repo = findRepo(state);
  if (!repo) return notARepo(state);
  const a = new Args(args, { flags: ['-f', '--force', '-v'] });
  if (a.unknown.length) return badOption(state, a.unknown[0]!);
  if (a.positional.length !== 2) {
    return fail(state, lines('usage: git mv [<options>] <source>... <destination>'), 'usage');
  }
  const [srcRaw, dstRaw] = a.positional as [string, string];
  const srcAbs = resolve(state.cwd, srcRaw, state.home);
  let dstAbs = resolve(state.cwd, dstRaw, state.home);
  if (!isInside(srcAbs, repo.root) || !isInside(dstAbs, repo.root)) {
    return fail(state, lines(`fatal: '${srcRaw}' is outside repository`), 'outsideRepo');
  }
  if (dirExists(state, dstAbs)) dstAbs = `${dstAbs}/${srcAbs.slice(srcAbs.lastIndexOf('/') + 1)}`;
  const src = relative(srcAbs, repo.root);
  const dst = relative(dstAbs, repo.root);
  const where = `source=${srcRaw}, destination=${dstRaw}`;
  if (!(srcAbs in state.fs.files)) {
    return fail(state, lines(`fatal: bad source, ${where}`), 'badSource', { key: 'sim.err.mvBadSource', params: { path: srcRaw } });
  }
  if (!(src in repo.index)) {
    return fail(state, lines(`fatal: not under version control, ${where}`), 'notTracked', {
      key: 'sim.err.mvNotTracked',
      params: { path: srcRaw },
    });
  }
  if (dstAbs in state.fs.files && !a.has('-f', '--force')) {
    return fail(state, lines(`fatal: destination exists, ${where}`), 'destExists', { key: 'sim.err.mvDestExists' });
  }
  const next = clone(state);
  const r = findRepo(next)!;
  const content = next.fs.files[srcAbs]!;
  deleteFile(next, srcAbs);
  writeFile(next, dstAbs, content);
  r.index[dst] = r.index[src]!;
  delete r.index[src];
  pruneEmptyDirs(next, r.root, [srcAbs]);
  return ok(next, a.has('-v') ? [line(`Renaming ${src} to ${dst}`)] : [], [{ type: 'fileMoved', from: src, to: dst }], {
    key: 'sim.explain.mv',
    params: { from: src, to: dst },
  });
};
