// git log, show, diff, reflog.
import { combinedDiff } from '../combined';
import { graphPrinter } from '../graph';
import { shortHash } from '../hash';
import { fail, line, lines, notARepo, ok } from '../output';
import { Args } from '../parse';
import { resolve as resolvePath } from '../paths';
import { mergeBases, reachable, topoOrder, walk } from '../refs';
import { resolveRev, revProblem } from '../revision';
import { dirExists, findRepo, gitDate, headId, headTree, subject, workingTree } from '../state';
import type { Commit, CommandFn, CommandResult, Line, Repo, SimState } from '../types';
import { commitHeader, decoration, matches, statLines, toPathspec, treeDiff } from './common';
import { gitRegex, pickaxeG, pickaxeS } from './git-search';

function badOption(state: SimState, opt: string): CommandResult {
  return fail(state, lines(`error: unknown option '${opt.replace(/^-+/, '')}'`), 'badOption', {
    key: 'sim.err.badOption',
    params: { option: opt },
  });
}

function badRevision(state: SimState, rev: string): CommandResult {
  return fail(
    state,
    lines(
      `fatal: ambiguous argument '${rev}': unknown revision or path not in the working tree.\nUse '--' to separate paths from revisions, like this:\n'git <command> [<revision>...] -- [<file>...]'`,
    ),
    'badRevision',
    { key: 'sim.err.badRevision', params: { rev } },
  );
}

function noCommitsYet(state: SimState, repo: Repo): CommandResult {
  const branch = repo.head.type === 'branch' ? repo.head.name : 'HEAD';
  return fail(state, lines(`fatal: your current branch '${branch}' does not have any commits yet`), 'noCommits', {
    key: 'sim.err.noCommits',
  });
}

/** Every ref tip `--all` starts from: branches, remote-tracking refs, tags, the stash and HEAD. */
export function allTips(repo: Repo): string[] {
  const tips = [...Object.values(repo.branches), ...Object.values(repo.remoteRefs), ...Object.values(repo.tags)];
  if (repo.stash[0]) tips.push(repo.stash[0].id);
  const head = headId(repo);
  if (head) tips.push(head);
  return tips;
}

/** History-search options of `git log` (-S, -G, --author, --grep, -i, -p, --left-right). */
interface LogSearch {
  pickaxe: string | null;
  pickaxeRegex: boolean;
  diffRegex: string | null;
  authors: string[];
  greps: string[];
  allMatch: boolean;
  ignoreCase: boolean;
  extended: boolean;
  fixed: boolean;
  patch: boolean;
  leftRight: boolean;
}

/** Take the search options out of the arguments (they can repeat and glue: -Stext, --grep=x). */
function takeSearchArgs(args: string[]): { rest: string[]; s: LogSearch } {
  const s: LogSearch = { pickaxe: null, pickaxeRegex: false, diffRegex: null, authors: [], greps: [], allMatch: false, ignoreCase: false, extended: false, fixed: false, patch: false, leftRight: false };
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const x = args[i]!;
    if (x === '--') {
      rest.push(...args.slice(i));
      break;
    }
    const glued = /^-([SG])(.+)$/.exec(x);
    if (x === '-S' || x === '-G') {
      const v = args[++i];
      if (v === undefined) {
        rest.push(x);
        continue;
      }
      if (x === '-S') s.pickaxe = v;
      else s.diffRegex = v;
    } else if (glued) {
      if (glued[1] === 'S') s.pickaxe = glued[2]!;
      else s.diffRegex = glued[2]!;
    } else if (x.startsWith('--author=')) s.authors.push(x.slice(9));
    else if (x === '--author' && args[i + 1] !== undefined) s.authors.push(args[++i]!);
    else if (x.startsWith('--grep=')) s.greps.push(x.slice(7));
    else if (x === '--grep' && args[i + 1] !== undefined) s.greps.push(args[++i]!);
    else if (x === '--all-match') s.allMatch = true;
    else if (x === '-i' || x === '--regexp-ignore-case') s.ignoreCase = true;
    else if (x === '-E' || x === '--extended-regexp') s.extended = true;
    else if (x === '-F' || x === '--fixed-strings') s.fixed = true;
    else if (x === '--pickaxe-regex') s.pickaxeRegex = true;
    else if (x === '-p' || x === '-u' || x === '--patch') s.patch = true;
    else if (x === '--left-right') s.leftRight = true;
    else rest.push(x);
  }
  return { rest, s };
}

export const log: CommandFn = (state, rawArgs) => {
  const repo = findRepo(state);
  if (!repo) return notARepo(state);
  const { rest: args, s: search } = takeSearchArgs(rawArgs);
  const a = new Args(args, {
    flags: ['--oneline', '--graph', '--all', '--decorate', '--no-decorate', '--reverse', '--merges', '--no-merges', '--first-parent'],
    values: ['-n', '--max-count'],
  });
  let limit: number | undefined;
  const n = a.get('-n', '--max-count');
  if (n !== undefined) limit = Number(n);
  for (const u of a.unknown) {
    if (u.startsWith('--max-count=')) limit = Number(u.split('=')[1]);
    else return badOption(state, u);
  }
  // `-3` is short for `-n 3`.
  const positional: string[] = [];
  let dashDash = a.beforeDashDash;
  a.positional.forEach((p, i) => {
    if (/^-\d+$/.test(p) && i < a.beforeDashDash) {
      limit = Number(p.slice(1));
      if (dashDash !== Infinity) dashDash--;
    } else positional.push(p);
  });
  if (limit !== undefined && (!Number.isFinite(limit) || limit < 0)) return badOption(state, `-n ${n}`);

  if (a.has('--reverse') && a.has('--graph')) {
    return fail(state, lines("fatal: options '--reverse' and '--graph' cannot be used together"), 'badOption', {
      key: 'sim.err.badOption',
      params: { option: '--reverse' },
    });
  }

  const include: string[] = [];
  const exclude: string[] = [];
  const paths: string[] = [];
  const revOf = (p: string): string | CommandResult => {
    const res = resolveRev(repo, p === '' ? 'HEAD' : p);
    if (res.ok) return res.id;
    const problem = revProblem(p, res);
    if (problem) return fail(state, lines(problem), 'badRevision', { key: 'sim.err.badRevision', params: { rev: p } });
    return badRevision(state, p);
  };
  let sides: { left: Set<string>; right: Set<string> } | null = null;
  for (const [i, p] of positional.entries()) {
    if (i >= dashDash) {
      paths.push(p);
      continue;
    }
    const sym = /^(.*?)\.\.\.(.*)$/.exec(p);
    const range = sym ? null : /^(.*?)\.\.(.*)$/.exec(p);
    if (sym || range) {
      const m = (sym ?? range)!;
      const left = revOf(m[1]!);
      const right = revOf(m[2]!);
      if (typeof left !== 'string') return left;
      if (typeof right !== 'string') return right;
      include.push(right);
      if (range) exclude.push(left);
      else {
        include.push(left);
        exclude.push(...mergeBases(repo.commits, left, right));
        sides = { left: reachable(repo.commits, [left]), right: reachable(repo.commits, [right]) };
      }
      continue;
    }
    if (p.startsWith('^')) {
      const id = revOf(p.slice(1));
      if (typeof id !== 'string') return id;
      exclude.push(id);
      continue;
    }
    const res = resolveRev(repo, p);
    const abs = resolvePath(state.cwd, p, state.home);
    if (res.ok) include.push(res.id);
    else if (abs in state.fs.files || dirExists(state, abs) || p in repo.index) paths.push(p);
    else {
      const id = revOf(p);
      if (typeof id !== 'string') return id;
    }
  }
  const head = headId(repo);
  if (a.has('--all')) include.push(...allTips(repo));
  if (!include.length) {
    if (!head) return noCommitsYet(state, repo);
    include.push(head);
  }

  let list = walk(repo.commits, include, exclude);
  if (a.has('--first-parent')) {
    const firstParents = new Set<string>();
    const skip = new Set(walk(repo.commits, exclude).map((c) => c.id));
    for (const tip of include) for (let cur: string | undefined = tip; cur && !skip.has(cur); cur = repo.commits[cur]?.parents[0]) firstParents.add(cur);
    list = list.filter((c) => firstParents.has(c.id));
  }
  const specs = paths.map((p) => toPathspec(state, repo, p));
  const inPaths = (p: string) => !specs.length || specs.some((s) => matches(s, p));
  if (paths.length) {
    // A merge that keeps a parent's version of the path is skipped (history simplification).
    list = list.filter((c) => {
      const parents = c.parents.length ? c.parents.map((id) => repo.commits[id]?.snapshot ?? {}) : [{}];
      return parents.every((parent) => Object.keys({ ...parent, ...c.snapshot }).some((p) => inPaths(p) && parent[p] !== c.snapshot[p]));
    });
  }
  // History search: -S (count of a text changed), -G (a changed line matches), --author, --grep.
  const reOpts = { ignoreCase: search.ignoreCase, extended: search.extended, fixed: search.fixed };
  if (search.pickaxe !== null) {
    const text = search.pickaxe;
    const re = search.pickaxeRegex ? gitRegex(text, { ...reOpts, extended: true }) : null;
    list = list.filter((c) => c.parents.length <= 1 && pickaxeS(repo, c, text, re).some(inPaths));
  }
  if (search.diffRegex !== null) {
    const re = gitRegex(search.diffRegex, { ...reOpts, extended: true, fixed: false });
    if (!re) return fail(state, lines(`fatal: invalid regex: ${search.diffRegex}`), 'badPattern', { key: 'sim.err.badPattern', params: { pattern: search.diffRegex } });
    list = list.filter((c) => c.parents.length <= 1 && pickaxeG(repo, c, re).some(inPaths));
  }
  if (search.authors.length) {
    const res = search.authors.map((x) => gitRegex(x, reOpts));
    list = list.filter((c) => res.some((re) => re?.test(`${c.author.name} <${c.author.email}>`)));
  }
  if (search.greps.length) {
    const res = search.greps.map((x) => gitRegex(x, reOpts));
    list = list.filter((c) => (search.allMatch ? res.every((re) => re?.test(c.message)) : res.some((re) => re?.test(c.message))));
  }
  if (a.has('--merges')) list = list.filter((c) => c.parents.length > 1);
  if (a.has('--no-merges')) list = list.filter((c) => c.parents.length <= 1);
  const graph = a.has('--graph');
  if (graph) list = topoOrder(list);
  const interesting = new Set(list.map((c) => c.id));
  let commits = limit !== undefined ? list.slice(0, limit) : list;
  if (a.has('--reverse')) commits = [...commits].reverse();
  const decorate = !a.has('--no-decorate');
  const oneline = a.has('--oneline');
  const parentsOf = (id: string) => (a.has('--first-parent') ? (repo.commits[id]?.parents.slice(0, 1) ?? []) : (repo.commits[id]?.parents ?? []));
  const printer = graph ? graphPrinter((id) => interesting.has(id), parentsOf) : null;

  const out: Line[] = [];
  const mark = (id: string) => (search.leftRight && sides ? (sides.left.has(id) && !sides.right.has(id) ? '< ' : '> ') : '');
  // -p: the patch after each non-merge commit (only the matching files for -S/-G or paths).
  const patchFor = (c: Commit): Line[] => {
    if (!search.patch || c.parents.length > 1) return [];
    const parent = c.parents[0] ? (repo.commits[c.parents[0]]?.snapshot ?? {}) : {};
    let keep = inPaths;
    if (search.pickaxe !== null) {
      const hits = new Set(pickaxeS(repo, c, search.pickaxe, search.pickaxeRegex ? gitRegex(search.pickaxe, { ...reOpts, extended: true }) : null));
      keep = (p) => inPaths(p) && hits.has(p);
    } else if (search.diffRegex !== null) {
      const hits = new Set(pickaxeG(repo, c, gitRegex(search.diffRegex, { ...reOpts, extended: true, fixed: false })!));
      keep = (p) => inPaths(p) && hits.has(p);
    }
    return treeDiff(parent, c.snapshot, { renames: true, filter: keep });
  };
  commits.forEach((c, i) => {
    const text: Line[] = oneline
      ? [[{ t: `${mark(c.id)}${shortHash(c.id)}`, c: 'yellow' }, ...(decorate ? decoration(repo, c.id) : []), { t: ` ${subject(c.message)}` }]]
      : commitHeader(state, repo, c);
    if (!oneline && !decorate) text[0] = [{ t: `commit ${c.id}`, c: 'yellow' }];
    if (!oneline && mark(c.id)) text[0] = [{ t: `commit ${mark(c.id)}${c.id}`, c: 'yellow' }, ...text[0]!.slice(1)];
    const patch = patchFor(c);
    if (patch.length) text.push(...(oneline ? [] : [line('')]), ...patch);
    if (!printer) {
      if (!oneline && i > 0) out.push(line(''));
      out.push(...text);
      return;
    }
    printer.update(c.id);
    if (!oneline && i > 0) out.push(printer.padding());
    const { before, prefix } = printer.start(c.id);
    out.push(...before);
    text.forEach((l, j) => out.push([...(j === 0 ? prefix : printer.next()), ...l]));
    out.push(...printer.remainder());
  });
  return ok(state, out, [], { key: oneline ? 'sim.explain.logOneline' : 'sim.explain.log' });
};

/** "--cc" diff of a merge commit: only paths that differ from every parent. */
function mergeDiff(repo: Repo, c: Commit): Line[] {
  const parents = c.parents.map((p) => repo.commits[p]!.snapshot);
  const paths = [...new Set([...Object.keys(c.snapshot), ...parents.flatMap((s) => Object.keys(s))])].sort();
  const out: Line[] = [];
  for (const p of paths) {
    const result = c.snapshot[p];
    if (result === undefined) continue;
    if (parents.some((s) => s[p] === result)) continue;
    out.push(...combinedDiff(p, parents.map((s) => s[p] ?? null), result));
  }
  return out;
}

export const show: CommandFn = (state, args) => {
  const repo = findRepo(state);
  if (!repo) return notARepo(state);
  const a = new Args(args, { flags: ['--stat', '--oneline', '--no-patch', '-s'] });
  if (a.unknown.length) return badOption(state, a.unknown[0]!);
  const rev = a.positional[0] ?? 'HEAD';
  if (!headId(repo) && rev === 'HEAD') return noCommitsYet(state, repo);
  const res = resolveRev(repo, rev);
  if (!res.ok) {
    const problem = revProblem(rev, res);
    if (problem) return fail(state, lines(problem), 'badRevision', { key: 'sim.err.badRevision', params: { rev } });
    return badRevision(state, rev);
  }
  const c = repo.commits[res.id]!;
  const parent = c.parents[0] ? repo.commits[c.parents[0]]!.snapshot : {};
  const tagName = rev.replace(/^(refs\/)?tags\//, '');
  const tagObj = repo.tags[tagName] !== undefined && repo.branches[tagName] === undefined ? repo.tagInfo[tagName] : undefined;
  const out: Line[] = [];
  if (tagObj && !a.has('--oneline')) {
    out.push(
      line(`tag ${tagName}`, 'yellow'),
      line(`Tagger: ${tagObj.tagger.name} <${tagObj.tagger.email}>`),
      line(`Date:   ${gitDate(tagObj.timestamp, state.tz)}`),
      line(''),
      ...tagObj.message.split('\n').map((l) => line(l)),
      line(''),
    );
  }
  out.push(...(a.has('--oneline')
    ? [[{ t: shortHash(c.id), c: 'yellow' as const }, ...decoration(repo, c.id), { t: ` ${subject(c.message)}` }]]
    : commitHeader(state, repo, c)));
  if (c.parents.length > 1) {
    if (!a.has('--stat', '--no-patch', '-s')) {
      const diff = mergeDiff(repo, c);
      if (diff.length) {
        if (!a.has('--oneline')) out.push(line(''));
        out.push(...diff);
      }
    }
  } else if (a.has('--stat')) {
    const stat = statLines(parent, c.snapshot);
    if (stat.length && !a.has('--oneline')) out.push(line(''));
    out.push(...stat);
  } else if (!a.has('--no-patch', '-s')) {
    const diff = treeDiff(parent, c.snapshot, { renames: true });
    if (diff.length) {
      if (!a.has('--oneline')) out.push(line(''));
      out.push(...diff);
    }
  }
  return ok(state, out, [], { key: 'sim.explain.show', params: { hash: shortHash(c.id) } });
};

export const diff: CommandFn = (state, args) => {
  const repo = findRepo(state);
  if (!repo) return notARepo(state);
  const a = new Args(args, { flags: ['--staged', '--cached', '--stat', '--name-only'] });
  if (a.unknown.length) return badOption(state, a.unknown[0]!);

  const revs: string[] = [];
  const paths: string[] = [];
  a.positional.forEach((p, i) => {
    if (i >= a.beforeDashDash) paths.push(p);
  });
  for (const p of a.positional.slice(0, Math.min(a.beforeDashDash, a.positional.length))) {
    // A...B: what B changed since it split from A (from their merge base to B).
    const sym = /^(.*?)\.\.\.(.*)$/.exec(p);
    if (sym) {
      const l = resolveRev(repo, sym[1] || 'HEAD');
      const r = resolveRev(repo, sym[2] || 'HEAD');
      if (!l.ok) return badRevision(state, sym[1]!);
      if (!r.ok) return badRevision(state, sym[2]!);
      const base = mergeBases(repo.commits, l.id, r.id)[0];
      if (!base) return fail(state, lines(`fatal: ${p}: no merge base`), 'noMergeBase', { key: 'sim.err.noMergeBase', params: { range: p } });
      revs.push(base, sym[2] || 'HEAD');
      continue;
    }
    const range = /^(.*?)\.\.(.*)$/.exec(p);
    if (range) {
      revs.push(range[1] || 'HEAD', range[2] || 'HEAD');
      continue;
    }
    const res = resolveRev(repo, p);
    if (res.ok && paths.length === 0) revs.push(p);
    else if (`${repo.root}/${p}` in state.fs.files || p in repo.index || p === '.') paths.push(p);
    else return badRevision(state, p);
  }
  const specs = paths.map((p) => toPathspec(state, repo, p));
  const filter = specs.length ? (p: string) => specs.some((s) => matches(s, p)) : undefined;
  const opts = filter ? { filter } : {};

  const treeOf = (rev: string) => {
    const res = resolveRev(repo, rev);
    return res.ok ? repo.commits[res.id]!.snapshot : null;
  };

  let before: Record<string, string>;
  let after: Record<string, string>;
  let mode: 'working' | 'staged' | 'commits' | 'commitWorking';
  if (a.has('--staged', '--cached')) {
    before = revs[0] ? (treeOf(revs[0]) ?? {}) : headTree(repo);
    after = repo.index;
    mode = 'staged';
  } else if (revs.length >= 2) {
    const x = treeOf(revs[0]!);
    const y = treeOf(revs[1]!);
    if (!x) return badRevision(state, revs[0]!);
    if (!y) return badRevision(state, revs[1]!);
    before = x;
    after = y;
    mode = 'commits';
  } else if (revs.length === 1) {
    const x = treeOf(revs[0]!);
    if (!x) return badRevision(state, revs[0]!);
    before = x;
    const work = workingTree(state, repo);
    // Only tracked paths (in the index or the commit) count.
    after = Object.fromEntries(
      Object.entries(work).filter(([p]) => p in repo.index || p in x),
    );
    mode = 'commitWorking';
  } else {
    before = repo.index;
    const work = workingTree(state, repo);
    after = {};
    for (const p of Object.keys(repo.index)) if (p in work) after[p] = work[p]!;
    mode = 'working';
  }
  if (a.has('--stat')) {
    return ok(state, statLines(before, after, filter), [], { key: 'sim.explain.diffNames' });
  }
  let out = treeDiff(before, after, { ...opts, renames: mode !== 'working' });
  const conflicted = Object.keys(repo.conflicts).filter((p) => !filter || filter(p));
  if ((mode === 'working' || mode === 'staged') && conflicted.length) {
    // Unmerged paths: a combined diff of the working file against "ours" and "theirs".
    const work = workingTree(state, repo);
    const paths = [...new Set([...Object.keys(before), ...Object.keys(after), ...conflicted])].filter((p) => !filter || filter(p)).sort();
    out = [];
    for (const p of paths) {
      const c = repo.conflicts[p];
      if (!c) {
        out.push(...treeDiff(before, after, { filter: (q) => q === p }));
        continue;
      }
      if (mode === 'staged' || c.ours === null || c.theirs === null || !(p in work)) out.push(line(`* Unmerged path ${p}`));
      else out.push(...combinedDiff(p, [c.ours, c.theirs], work[p]!, { resultHash: null, always: true }));
    }
  }
  if (a.has('--name-only')) {
    const names = out
      .filter((l) => /^diff --(git|cc) |^\* Unmerged path /.test(l[0]?.t ?? ''))
      .map((l) => {
        const t = l[0]!.t;
        return line(t.startsWith('diff --git') ? (t.split(' b/')[1] ?? '') : t.replace(/^diff --cc |^\* Unmerged path /, ''));
      });
    return ok(state, names, [], { key: 'sim.explain.diffNames' });
  }
  return ok(state, out, [], {
    key: out.length === 0 ? 'sim.explain.diffEmpty' : `sim.explain.diff.${mode}`,
  });
};

export const reflog: CommandFn = (state, args) => {
  const repo = findRepo(state);
  if (!repo) return notARepo(state);
  const a = new Args(args, { flags: ['--oneline'], values: ['-n'] });
  const rest = a.positional.filter((p) => p !== 'show' && p !== 'HEAD');
  if (a.unknown.some((u) => !/^-\d+$/.test(u)) || rest.length) {
    return fail(state, lines('This practice terminal shows the HEAD reflog only. Try: git reflog'), 'reflogOption', {
      key: 'sim.err.reflogOption',
    });
  }
  if (repo.reflog.length === 0) return noCommitsYet(state, repo);
  let limit = repo.reflog.length;
  const n = a.get('-n') ?? a.unknown.find((u) => /^-\d+$/.test(u))?.slice(1);
  if (n !== undefined) limit = Number(n);
  const out: Line[] = repo.reflog.slice(0, limit).map((e, i) => [
    { t: shortHash(e.commit), c: 'yellow' },
    ...decoration(repo, e.commit),
    { t: ` HEAD@{${i}}: ${e.message}` },
  ]);
  return ok(state, out, [], { key: 'sim.explain.reflog' });
};

