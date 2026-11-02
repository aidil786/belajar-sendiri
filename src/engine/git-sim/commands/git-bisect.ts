// git bisect (World 10): binary search for the commit that broke something.
// The next commit to test is chosen with Git's own algorithm (bisect.c), including
// its "skip away" pseudo-random step, so the engine tests the same commits as real Git.
import { shortHash } from '../hash';
import { fail, line, lines, notARepo, ok } from '../output';
import { isAncestorOf, reachable, walk } from '../refs';
import { resolveRev } from '../revision';
import { clone, findRepo, gitDate, headId, subject } from '../state';
import type { BisectState, Commit, CommandContext, CommandFn, CommandResult, Line, Repo, SimEvent, SimState } from '../types';
import { commitStat, decoration, statLines, switchTrees } from './common';

// ---------------------------------------------------------------------------
// Git's bisection algorithm

export interface BisectPick {
  /** Every candidate (reachable from bad, not from any good), newest first. */
  candidates: string[];
  /** The commit to test next (may be the bad commit: then it is the first bad one). */
  next: string | null;
  /** Commits skipped and still candidates ("tried"), in Git's order. */
  tried: string[];
  /** "N revisions left to test after this". */
  left: number;
  /** "(roughly N steps)". */
  steps: number;
}

/** Git's estimate_bisect_steps(). */
export function estimateSteps(all: number): number {
  if (all < 3) return 0;
  const n = Math.floor(Math.log2(all));
  const e = 2 ** n;
  const x = all - e;
  return e < 3 * x ? n : n - 1;
}

/** Git's get_prn(): a tiny pseudo-random number generator (32-bit unsigned maths). */
function getPrn(count: number): number {
  const c = (Math.imul(count, 1103515245) + 12345) >>> 0;
  return Math.floor(c / 65536) % 32768;
}

/** Git's sqrti(): Newton's method in single-precision floats. */
function sqrti(val: number): number {
  if (!val) return 0;
  const f = Math.fround;
  let x = f(val);
  let d: number;
  do {
    const y = f(f(x + f(f(val) / x)) / 2);
    d = y > x ? f(y - x) : f(x - y);
    x = y;
  } while (d >= 0.5);
  return Math.trunc(x);
}

/** Choose the next commit to test, exactly like `git bisect` (bisect.c find_bisection + managed_skipped). */
export function bisectPick(commits: Record<string, Commit>, bad: string, good: string[], skip: string[]): BisectPick {
  const newestFirst = walk(commits, [bad], good);
  const candidates = newestFirst.map((c) => c.id);
  const inSet = new Set(candidates);
  const list = [...newestFirst].reverse(); // Git reverses the date-ordered list: oldest first.
  const nr = list.length;
  if (nr === 0) return { candidates, next: null, tried: [], left: 0, steps: 0 };
  const weight = new Map<string, number>();
  const interestingParents = (c: Commit) => c.parents.filter((p) => inSet.has(p));
  const all = skip.length > 0; // FIND_BISECTION_ALL when there are skipped commits
  const halfway = (w: number) => Math.abs(2 * w - nr) <= 1;
  let early: string | null = null;
  let counted = 0;
  for (const c of list) {
    const n = interestingParents(c).length;
    if (n === 0) {
      weight.set(c.id, 1);
      counted++;
    } else weight.set(c.id, n === 1 ? -1 : -2);
  }
  outer: {
    for (const c of list) {
      if (weight.get(c.id) !== -2) continue;
      const w = [...reachable(commits, [c.id])].filter((id) => inSet.has(id)).length;
      weight.set(c.id, w);
      if (!all && halfway(w)) {
        early = c.id;
        break outer;
      }
      counted++;
    }
    while (counted < nr) {
      let progress = false;
      for (const c of list) {
        if ((weight.get(c.id) ?? 0) >= 0) continue;
        const q = interestingParents(c).find((p) => (weight.get(p) ?? -1) >= 0);
        if (!q) continue;
        const w = weight.get(q)! + 1;
        weight.set(c.id, w);
        counted++;
        progress = true;
        if (!all && halfway(w)) {
          early = c.id;
          break outer;
        }
      }
      if (!progress) break;
    }
  }
  const dist = (id: string) => Math.min(weight.get(id)!, nr - weight.get(id)!);
  let best: string;
  let order: string[];
  if (early) {
    best = early;
    order = [early];
  } else if (!all) {
    best = list[0]!.id;
    let bestD = -1;
    for (const c of list) {
      const d = dist(c.id);
      if (d > bestD) {
        best = c.id;
        bestD = d;
      }
    }
    order = [best];
  } else {
    order = list.map((c) => c.id).sort((x, y) => dist(y) - dist(x) || (x < y ? -1 : x > y ? 1 : 0));
    best = order[0]!;
  }
  const left = nr - (weight.get(best) ?? 0) - 1;
  const steps = estimateSteps(nr);
  // managed_skipped(): step away from skipped commits.
  const skipped = new Set(skip);
  let tried: string[] = [];
  let next: string | null = order[0] ?? null;
  if (next !== null && skipped.has(next)) {
    // filter_skipped() + skip_away(): move away from the skipped best commit.
    tried = order.filter((id) => skipped.has(id));
    const filtered = order.filter((id) => !skipped.has(id));
    const count = filtered.length;
    if (count === 0) next = null;
    else {
      const prn = getPrn(count);
      const index = Math.floor((Math.floor((count * prn) / 32768) * sqrti(prn)) / sqrti(32768));
      const at = Math.min(index, count - 1);
      next = filtered[at] !== bad ? filtered[at]! : at > 0 ? filtered[at - 1]! : filtered[0]!;
    }
  }
  return { candidates, next, tried, left, steps };
}

// ---------------------------------------------------------------------------
// Helpers

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function logLine(c: Commit | undefined, id: string): string {
  return `[${id}] ${c ? subject(c.message) : ''}`;
}

function sq(args: string[]): string {
  return args.map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(' ');
}

/** The terms in use ("bad"/"good" unless the bisect uses "new"/"old"). */
function termsOf(b: BisectState): { bad: string; good: string } {
  return b.terms ?? { bad: 'bad', good: 'good' };
}

/** "status: waiting for ..." when bad or good is still missing (Git 2.56 quotes the terms). */
function statusLine(b: BisectState): string | null {
  if (b.bad && b.good.length) return null;
  const { bad, good } = termsOf(b);
  if (!b.bad && !b.good.length) return `status: waiting for both '${good}' and '${bad}' commits`;
  const n = b.good.length;
  if (n) return `status: waiting for '${bad}' commit, ${n} '${good}' commit${n === 1 ? '' : 's'} known`;
  return `status: waiting for '${good}' commit(s), '${bad}' commit known`;
}

function notBisecting(state: SimState): CommandResult {
  return fail(state, lines('You need to start by "git bisect start"'), 'notBisecting', { key: 'sim.err.bisectNotStarted' });
}

/** Detach HEAD at `id` for testing (like `git checkout -q <id>`). Mutates the cloned state. */
function checkoutForTest(state: SimState, repo: Repo, id: string): string[] | null {
  if (headId(repo) === id && repo.head.type === 'detached') return null;
  const { blocked, untrackedBlocked } = switchTrees(state, repo, repo.commits[id]!.snapshot);
  if (blocked.length || untrackedBlocked.length) return [...blocked, ...untrackedBlocked];
  const from = repo.head.type === 'branch' ? repo.head.name : repo.head.commit;
  repo.head = { type: 'detached', commit: id };
  repo.detachedFrom = id;
  repo.reflog.unshift({ commit: id, message: `checkout: moving from ${from} to ${id}` });
  return null;
}

function blockedLines(paths: string[]): Line[] {
  return lines(
    `error: Your local changes to the following files would be overwritten by checkout:\n${paths.map((p) => `\t${p}`).join('\n')}\nPlease commit your changes or stash them before you switch branches.\nAborting`,
  );
}

/**
 * "commit <id>" block printed under "<id> is the first 'bad' commit" (git show --stat --summary).
 * Like log, the commit line is decorated: "(HEAD)" when the test left HEAD there (refs/bisect/* never show).
 */
function firstBadLines(state: SimState, repo: Repo, c: Commit): Line[] {
  const out: Line[] = [[{ t: `commit ${c.id}`, c: 'yellow' }, ...decoration(repo, c.id)]];
  if (c.parents.length > 1) out.push(line(`Merge: ${c.parents.map((p) => shortHash(p)).join(' ')}`));
  out.push(line(`Author: ${c.author.name} <${c.author.email}>`), line(`Date:   ${gitDate(c.timestamp, state.tz)}`), line(''));
  for (const l of c.message.split('\n')) out.push(line(`    ${l}`));
  const parent = c.parents[0] ? repo.commits[c.parents[0]]!.snapshot : {};
  const stat = commitStatWithFiles(parent, c.snapshot);
  if (stat.length) out.push(line(''), ...stat);
  return out;
}

/** " file | 1 +" rows, the summary line and create/delete modes (show --stat --summary). */
function commitStatWithFiles(before: Record<string, string>, after: Record<string, string>): Line[] {
  const rows = statLines(before, after);
  if (!rows.length) return [];
  return [...rows.slice(0, -1), ...commitStat(before, after)];
}

export interface StepOutcome {
  output: Line[];
  events: SimEvent[];
  /** Bisect finished: the first bad commit (or null). */
  found: string | null;
  /** Only skipped commits are left. */
  onlySkipped: boolean;
  /** The checkout was blocked by local changes. */
  blocked: boolean;
}

/** After a mark: pick and check out the next commit, or report the first bad commit. Mutates state. */
function bisectNext(state: SimState, repo: Repo): StepOutcome {
  const b = repo.bisect!;
  const out: Line[] = [];
  const events: SimEvent[] = [];
  const status = statusLine(b);
  if (status) {
    b.log.push(`# ${status}`);
    return { output: [line(status)], events, found: null, onlySkipped: false, blocked: false };
  }
  const bad = b.bad!;
  const T = termsOf(b);
  // check_good_are_ancestors_of_bad(): a good commit newer than the bad one means a mix-up.
  const fromBad = reachable(repo.commits, [bad]);
  if (b.good.some((g) => !fromBad.has(g) && isAncestorOf(repo.commits, bad, g))) {
    return {
      output: lines(
        `Some '${T.good}' revs are not ancestors of the '${T.bad}' rev.\ngit bisect cannot work properly in this case.\nMaybe you mistook '${T.good}' and '${T.bad}' revs?`,
      ),
      events: [{ type: 'error', code: 'bisectMistook' }],
      found: null,
      onlySkipped: false,
      blocked: false,
    };
  }
  const pick = bisectPick(repo.commits, bad, b.good, b.skip);
  if (!pick.candidates.length) {
    return { output: [line(`${bad} was both '${T.good}' and '${T.bad}'`)], events: [{ type: 'error', code: 'bisectMistook' }], found: null, onlySkipped: false, blocked: false };
  }
  if (pick.next === null || pick.next === bad) {
    if (pick.tried.length) {
      out.push(line("There are only 'skip'ped commits left to test."), line(`The first '${T.bad}' commit could be any of:`));
      for (const id of pick.tried) out.push(line(id));
      if (pick.next === bad) out.push(line(bad));
      out.push(line('We cannot bisect more!'));
      b.log.push('# only skipped commits left to test');
      for (const id of pick.candidates) b.log.push(`# possible first '${T.bad}' commit: ${logLine(repo.commits[id], id)}`);
      return { output: out, events, found: null, onlySkipped: true, blocked: false };
    }
    const c = repo.commits[bad]!;
    out.push(line(`${bad} is the first '${T.bad}' commit`), ...firstBadLines(state, repo, c));
    b.found = bad;
    repo.bisectFound = bad;
    b.log.push(`# first '${T.bad}' commit: ${logLine(c, bad)}`);
    events.push({ type: 'bisectFound', id: bad });
    return { output: out, events, found: bad, onlySkipped: false, blocked: false };
  }
  const blocked = checkoutForTest(state, repo, pick.next);
  if (blocked) return { output: blockedLines(blocked), events: [{ type: 'error', code: 'bisectBlocked' }], found: null, onlySkipped: false, blocked: true };
  out.push(
    line(`Bisecting: ${plural(pick.left, 'revision')} left to test after this (roughly ${plural(pick.steps, 'step')})`),
    line(`[${pick.next}] ${subject(repo.commits[pick.next]!.message)}`),
  );
  events.push({ type: 'bisectStep', testing: pick.next, left: pick.left }, { type: 'headDetached', commit: pick.next });
  return { output: out, events, found: null, onlySkipped: false, blocked: false };
}

function mark(repo: Repo, kind: 'bad' | 'good' | 'skip', id: string): void {
  const b = repo.bisect!;
  const c = repo.commits[id];
  const word = kind === 'skip' ? 'skip' : termsOf(b)[kind];
  b.log.push(`# ${word}: ${logLine(c, id)}`, `git bisect ${word} ${id}`);
  if (kind === 'bad') b.bad = id;
  else if (kind === 'good') {
    if (!b.good.includes(id)) b.good.push(id);
  } else if (!b.skip.includes(id)) b.skip.push(id);
}

function result(state: SimState, next: SimState, step: StepOutcome, key: string, params: Record<string, string> = {}, keepMarks = false): CommandResult {
  if (step.blocked) return fail(state, step.output, 'bisectBlocked', { key: 'sim.err.bisectBlocked' });
  // A failed start cleans up; a mark that leads nowhere is still written to the log (like Git).
  if (step.events.some((e) => e.type === 'error')) return fail(keepMarks ? next : state, step.output, 'bisectMistook', { key: 'sim.err.bisectMistook' });
  if (step.found) return ok(next, step.output, step.events, { key: 'sim.explain.bisectFound', params: { hash: shortHash(step.found), message: subject(findRepo(next)!.commits[step.found]!.message) } });
  if (step.onlySkipped) return { state: next, output: step.output, events: step.events, ok: false, stopped: true, explain: { key: 'sim.explain.bisectOnlySkipped' } };
  const testing = step.events.find((e) => e.type === 'bisectStep');
  if (testing && testing.type === 'bisectStep') {
    return ok(next, step.output, step.events, { key: 'sim.explain.bisectTest', params: { hash: shortHash(testing.testing), left: String(testing.left), ...params } });
  }
  return ok(next, step.output, step.events, { key, params });
}

// ---------------------------------------------------------------------------
// Subcommands

function start(state: SimState, args: string[]): CommandResult {
  const repo = findRepo(state)!;
  const words = args.filter((x) => x !== '--no-checkout' && x !== '--first-parent');
  const dashDash = words.indexOf('--');
  const revs = dashDash === -1 ? words : words.slice(0, dashDash);
  const ids: string[] = [];
  for (const r of revs) {
    const res = resolveRev(repo, r);
    if (!res.ok) return fail(state, lines(`fatal: '${r}' does not appear to be a valid revision`), 'badRevision', { key: 'sim.err.badRevision', params: { rev: r } });
    ids.push(res.id);
  }
  if (!headId(repo)) return fail(state, lines("fatal: Bad HEAD - I need a HEAD"), 'noCommits', { key: 'sim.err.noCommits' });
  const next = clone(state);
  const r = findRepo(next)!;
  const prev = r.bisect;
  r.bisect = {
    start: prev ? prev.start : r.head.type === 'branch' ? r.head.name : r.head.commit,
    startDetached: prev ? prev.startDetached : r.head.type === 'detached',
    bad: null,
    good: [],
    skip: [],
    log: [],
    found: null,
    // `start <bad> <good>` fixes the terms to bad/good; a plain start lets the first mark choose.
    terms: revs.length ? { bad: 'bad', good: 'good' } : null,
  };
  const b = r.bisect;
  if (ids[0]) {
    b.bad = ids[0];
    b.log.push(`# bad: ${logLine(r.commits[ids[0]], ids[0])}`);
  }
  for (const g of ids.slice(1)) {
    if (!b.good.includes(g)) b.good.push(g);
    b.log.push(`# good: ${logLine(r.commits[g], g)}`);
  }
  b.log.push(revs.length ? `git bisect start ${sq(revs)}` : 'git bisect start');
  const step = bisectNext(next, r);
  return result(state, next, step, 'sim.explain.bisectStart');
}

function markCmd(state: SimState, word: string, revs: string[]): CommandResult {
  const repo = findRepo(state)!;
  if (!repo.bisect) return notBisecting(state);
  // check_and_set_terms(): bad/good or new/old, but never both in one bisect.
  const terms = repo.bisect.terms;
  if (word !== 'skip' && terms && word !== terms.bad && word !== terms.good) {
    return fail(state, lines(`error: Invalid command: you're currently in a ${terms.bad}/${terms.good} bisect`), 'bisectTerms', { key: 'sim.err.bisectTerms', params: { bad: terms.bad, good: terms.good } });
  }
  const chosen = terms ?? (word === 'new' || word === 'old' ? { bad: 'new', good: 'old' } : word === 'skip' ? null : { bad: 'bad', good: 'good' });
  const kind: 'bad' | 'good' | 'skip' = word === 'skip' ? 'skip' : chosen && word === chosen.bad ? 'bad' : 'good';
  const ids: string[] = [];
  for (const rv of revs.length ? revs : ['HEAD']) {
    const res = resolveRev(repo, rv);
    if (!res.ok) return fail(state, lines(`fatal: Bad rev input: ${rv}`), 'badRevision', { key: 'sim.err.badRevision', params: { rev: rv } });
    ids.push(res.id);
  }
  if (kind === 'bad' && ids.length > 1) return fail(state, lines(`error: 'git bisect ${word}' can take only one argument.`), 'bisectOneBad', { key: 'sim.err.bisectOneBad' });
  const next = clone(state);
  const r = findRepo(next)!;
  if (chosen && !r.bisect!.terms) r.bisect!.terms = chosen;
  for (const id of ids) mark(r, kind, id);
  const step = bisectNext(next, r);
  return result(state, next, step, kind === 'skip' ? 'sim.explain.bisectSkip' : `sim.explain.bisectMark.${kind}`, { hash: shortHash(ids[0]!) }, true);
}

function reset(state: SimState): CommandResult {
  const repo = findRepo(state)!;
  // Git 2.56 says nothing here (older Git printed "We are not bisecting.").
  if (!repo.bisect) return ok(state, [], [], { key: 'sim.explain.bisectNotBisecting' });
  const b = repo.bisect;
  const next = clone(state);
  const r = findRepo(next)!;
  const out: Line[] = [];
  const target = b.startDetached ? b.start : r.branches[b.start];
  if (target) {
    const { blocked, untrackedBlocked } = switchTrees(next, r, r.commits[target]!.snapshot);
    if (blocked.length || untrackedBlocked.length) return fail(state, blockedLines([...blocked, ...untrackedBlocked]), 'bisectBlocked', { key: 'sim.err.bisectBlocked' });
    const before = headId(repo);
    const wasDetached = repo.head.type === 'detached';
    if (wasDetached && (b.startDetached ? before !== target : true)) out.push(line(`Previous HEAD position was ${shortHash(before!)} ${subject(repo.commits[before!]!.message)}`));
    const from = repo.head.type === 'branch' ? repo.head.name : repo.head.commit;
    if (b.startDetached) {
      r.head = { type: 'detached', commit: target };
      r.detachedFrom = target;
      out.push(line(`HEAD is now at ${shortHash(target)} ${subject(r.commits[target]!.message)}`));
    } else if (repo.head.type === 'branch' && repo.head.name === b.start) {
      out.push(line(`Already on '${b.start}'`));
    } else {
      r.head = { type: 'branch', name: b.start };
      r.detachedFrom = null;
      out.push(line(`Switched to branch '${b.start}'`));
    }
    if (from !== (b.startDetached ? target : b.start)) r.reflog.unshift({ commit: target, message: `checkout: moving from ${from} to ${b.start}` });
  }
  r.bisect = null;
  return ok(next, out, [{ type: 'bisectReset' }, { type: 'headMoved', from: headId(repo), to: headId(r) }], { key: 'sim.explain.bisectReset', params: { branch: b.start } });
}

function runCmd(state: SimState, cmd: string[], ctx: CommandContext): CommandResult {
  const repo = findRepo(state)!;
  if (!repo.bisect) return notBisecting(state);
  if (!cmd.length) return fail(state, lines('error: bisect run failed: no command provided.'), 'bisectRunEmpty', { key: 'sim.err.bisectRunEmpty' });
  if (!repo.bisect.bad || !repo.bisect.good.length || !ctx.run) {
    return fail(state, lines('You need to give me at least one good and one bad revision.\n(You can use "git bisect bad" and "git bisect good" for that.)'), 'bisectNeedsBoth', { key: 'sim.err.bisectNeedsBoth' });
  }
  const lineText = cmd.map((w) => (/[\s"'>]/.test(w) || w === '' ? `"${w.replace(/(["\\])/g, '\\$1')}"` : w)).join(' ');
  let cur = state;
  const out: Line[] = [];
  const events: SimEvent[] = [];
  for (let i = 0; i < 64; i++) {
    out.push(line(`running ${sq(cmd)}`));
    const r = ctx.run(cur, lineText);
    out.push(...r.output);
    cur = r.state;
    const code = r.exitCode ?? (r.ok ? 0 : 1);
    if (code < 0 || code >= 128) {
      out.push(line(`bisect run failed: exit code ${code} from '${cmd.join(' ')}' is < 0 or >= 128`));
      return { state: cur, output: out, events: [...events, { type: 'error', code: 'bisectRunFailed' }], ok: false, explain: { key: 'sim.err.bisectRunFailed', params: { code: String(code) } } };
    }
    const kind = code === 0 ? 'good' : code === 125 ? 'skip' : 'bad';
    const next = clone(cur);
    const rr = findRepo(next)!;
    mark(rr, kind, headId(rr)!);
    const step = bisectNext(next, rr);
    out.push(...step.output);
    events.push(...step.events);
    if (step.blocked) return { state: cur, output: out, events: [...events, { type: 'error', code: 'bisectBlocked' }], ok: false, explain: { key: 'sim.err.bisectBlocked' } };
    cur = next;
    if (step.found) {
      out.push(line(`bisect found first '${termsOf(rr.bisect!).bad}' commit`));
      return ok(cur, out, events, { key: 'sim.explain.bisectRunFound', params: { hash: shortHash(step.found), message: subject(rr.commits[step.found]!.message) } });
    }
    if (step.onlySkipped) {
      out.push(line('bisect run cannot continue any more'));
      return { state: cur, output: out, events, ok: false, stopped: true, explain: { key: 'sim.explain.bisectOnlySkipped' } };
    }
  }
  return { state: cur, output: out, events, ok: false, explain: { key: 'sim.err.bisectRunFailed', params: { code: 'loop' } } };
}

const SUBS = ['start', 'bad', 'new', 'good', 'old', 'skip', 'reset', 'log', 'run'];

export const bisect: CommandFn = (state, args, ctx) => {
  const repo = findRepo(state);
  if (!repo) return notARepo(state);
  const [sub, ...rest] = args;
  if (!sub || !SUBS.includes(sub)) {
    return fail(
      state,
      lines('usage: git bisect start [<bad> [<good>...]]\n   or: git bisect (bad|good|skip) [<rev>...]\n   or: git bisect reset\n   or: git bisect log\n   or: git bisect run <cmd>...'),
      'bisectUsage',
      { key: 'sim.err.bisectUsage', params: { sub: sub ?? '' } },
    );
  }
  if (sub === 'start') return start(state, rest);
  if (sub === 'bad' || sub === 'new' || sub === 'good' || sub === 'old' || sub === 'skip') return markCmd(state, sub, rest);
  if (sub === 'reset') return reset(state);
  if (sub === 'log') {
    if (!repo.bisect) return fail(state, lines('error: We are not bisecting.'), 'notBisecting', { key: 'sim.err.bisectNotStarted' });
    return ok(state, repo.bisect.log.map((l) => line(l)), [], { key: 'sim.explain.bisectLog' });
  }
  return runCmd(state, rest, ctx);
};

// ---------------------------------------------------------------------------
// For interactives (BisectDetective) and goals

export interface BisectInfo {
  active: boolean;
  /** Branch (or commit) bisect started from. */
  start: string | null;
  bad: string | null;
  good: string[];
  skip: string[];
  /** The commit being tested (HEAD) while bisecting. */
  testing: string | null;
  /** Commits that could still be the first bad one, newest first (the bad commit included). */
  candidates: string[];
  /** First bad commit, once found (kept after reset). */
  found: string | null;
  /** Real Git's "(roughly N steps)" for the remaining range. */
  stepsLeft: number;
  log: string[];
}

export function bisectInfo(state: SimState): BisectInfo {
  const repo = findRepo(state);
  const b = repo?.bisect ?? null;
  const empty: BisectInfo = { active: false, start: null, bad: null, good: [], skip: [], testing: null, candidates: [], found: repo?.bisectFound ?? null, stepsLeft: 0, log: [] };
  if (!repo || !b) return empty;
  let candidates: string[] = [];
  let stepsLeft = 0;
  if (b.bad && b.good.length && !b.good.some((g) => isAncestorOf(repo.commits, b.bad!, g))) {
    const pick = bisectPick(repo.commits, b.bad, b.good, b.skip);
    candidates = pick.candidates;
    stepsLeft = pick.steps;
  }
  return {
    active: true,
    start: b.start,
    bad: b.bad,
    good: [...b.good],
    skip: [...b.skip],
    testing: b.found ? null : repo.head.type === 'detached' ? repo.head.commit : null,
    candidates,
    found: b.found ?? repo.bisectFound ?? null,
    stepsLeft,
    log: [...b.log],
  };
}
