// Bisect detective: find the first bad commit by halving the range, driven by
// the engine's `git bisect` (so it tests the same commits real Git would).
// Pure helpers (no React): the component and the tests use them.
import { bisectInfo, findRepo, headId, history, plain, resolveRev, run, subject, type CommandResult, type SimState } from '~/engine/git-sim';
import { splitLines } from '~/engine/git-sim/diff';

/** How to judge a commit: the file is "bad" when the regex matches it. */
export interface BisectTest {
  file: string;
  bad: string;
}

export interface Verdict {
  bad: boolean;
  /** The file at the tested commit (empty string when missing). */
  content: string;
  /** 1-based line that matched the bad regex, or null. */
  line: number | null;
}

export type RowStatus = 'good' | 'bad' | 'suspect' | 'testing' | 'skipped' | 'found';

export interface Row {
  id: string;
  short: string;
  message: string;
  status: RowStatus;
}

/** Judge the commit checked out now (HEAD), like running the test in the working folder. */
export function judge(state: SimState, test: BisectTest): Verdict {
  const repo = findRepo(state);
  const content = repo ? (state.fs.files[`${repo.root}/${test.file}`] ?? '') : '';
  const re = new RegExp(test.bad);
  const idx = splitLines(content).findIndex((l) => re.test(l));
  return { bad: idx !== -1 || re.test(content), content, line: idx === -1 ? null : idx + 1 };
}

/** Judge any commit without checking it out. */
export function judgeCommit(state: SimState, id: string, test: BisectTest): boolean {
  const c = findRepo(state)?.commits[id];
  return new RegExp(test.bad).test(c?.snapshot[test.file] ?? '');
}

/** The commits from `good` to `bad` (first-parent line), oldest first. */
export function rangeOf(state: SimState, good: string, bad: string): string[] {
  const repo = findRepo(state);
  if (!repo) return [];
  const out: string[] = [];
  for (const c of history(repo, bad)) {
    out.unshift(c.id);
    if (c.id === good) return out;
  }
  return [];
}

/** Default ends: bad = HEAD, good = the oldest commit on HEAD's line. */
export function defaultEnds(state: SimState, good?: string, bad?: string): { good: string; bad: string } | null {
  const repo = findRepo(state);
  if (!repo) return null;
  const b = resolveRev(repo, bad ?? 'HEAD');
  if (!b.ok) return null;
  const r = good ? resolveRev(repo, good) : null;
  const g = good ? (r?.ok ? r.id : null) : (history(repo, b.id).at(-1)?.id ?? null);
  return g ? { good: g, bad: b.id } : null;
}

/** Start bisecting: `git bisect start <bad> <good>` in the engine. */
export function startBisect(state: SimState, ends: { good: string; bad: string }): CommandResult {
  return run(state, `git bisect start ${ends.bad} ${ends.good}`);
}

/** Mark the commit under test: `git bisect good` / `git bisect bad`. */
export function markTested(state: SimState, kind: 'good' | 'bad'): CommandResult {
  return run(state, `git bisect ${kind}`);
}

/** Rows for the timeline, oldest first, with what bisect knows about each one. */
export function rowsFor(state: SimState, range: string[]): Row[] {
  const repo = findRepo(state);
  const info = bisectInfo(state);
  if (!repo) return [];
  if (!info.active) {
    // Before the start: only the two ends are known.
    return range.map((id, i) => ({
      id,
      short: id.slice(0, 7),
      message: subject(repo.commits[id]!.message),
      status: i === 0 ? 'good' : i === range.length - 1 ? 'bad' : 'suspect',
    }));
  }
  const suspects = new Set(info.candidates);
  const testing = info.active && !info.found ? headId(repo) : null;
  return range.map((id) => {
    const c = repo.commits[id]!;
    let status: RowStatus;
    if (info.found === id) status = 'found';
    else if (testing === id) status = 'testing';
    else if (info.skip.includes(id)) status = 'skipped';
    else if (suspects.has(id) && !info.found) status = 'suspect';
    else if (info.good.some((g) => isAncestor(state, id, g))) status = 'good';
    else status = 'bad';
    return { id, short: id.slice(0, 7), message: subject(c.message), status };
  });
}

function isAncestor(state: SimState, ancestor: string, of: string): boolean {
  const repo = findRepo(state)!;
  const stack = [of];
  const seen = new Set<string>();
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === ancestor) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    stack.push(...(repo.commits[cur]?.parents ?? []));
  }
  return false;
}

/** Most tests binary search needs for n suspects: ceil(log2(n)). */
export function maxSteps(n: number): number {
  return n <= 1 ? 0 : Math.ceil(Math.log2(n));
}

/** Terminal text of a result (for the little transcript). */
export function outputText(r: CommandResult): string {
  return plain(r.output);
}

/** The lines the first bad commit changed in the test file: [removed, added]. */
export function culpritChange(state: SimState, id: string, file: string): { removed: string[]; added: string[] } {
  const repo = findRepo(state);
  const c = repo?.commits[id];
  if (!repo || !c) return { removed: [], added: [] };
  const before = splitLines(c.parents[0] ? (repo.commits[c.parents[0]]?.snapshot[file] ?? '') : '');
  const after = splitLines(c.snapshot[file] ?? '');
  return { removed: before.filter((l) => !after.includes(l)), added: after.filter((l) => !before.includes(l)) };
}
