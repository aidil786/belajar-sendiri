import { describe, expect, it } from 'vitest';
import { bisectInfo, buildScenario, plain, run } from '~/engine/git-sim';
import { getScenario } from '~/content/courses/git/scenarios';
import { culpritChange, defaultEnds, judge, judgeCommit, markTested, maxSteps, rangeOf, rowsFor, startBisect } from './bisectDetective';

const test = { file: 'index.html', bad: 'RM0' };
const state = () => buildScenario(getScenario('w10-bisect'));

describe('Bisect detective helpers', () => {
  it('default ends are the oldest commit (good) and HEAD (bad)', () => {
    const s = state();
    const ends = defaultEnds(s)!;
    const range = rangeOf(s, ends.good, ends.bad);
    expect(range).toHaveLength(10);
    expect(range[0]).toBe(ends.good);
    expect(range.at(-1)).toBe(ends.bad);
    expect(judgeCommit(s, ends.good, test)).toBe(false);
    expect(judgeCommit(s, ends.bad, test)).toBe(true);
    expect(rowsFor(s, range).map((r) => r.status)).toEqual(['good', ...Array(8).fill('suspect'), 'bad']);
  });

  it('plays a whole bisect with the engine and finds the bug', () => {
    let s = state();
    const ends = defaultEnds(s)!;
    const range = rangeOf(s, ends.good, ends.bad);
    const started = startBisect(s, ends);
    expect(plain(started.output)).toMatch(/^Bisecting: 4 revisions left to test after this \(roughly 2 steps\)/);
    s = started.state;
    let tests = 0;
    while (!bisectInfo(s).found) {
      const rows = rowsFor(s, range);
      expect(rows.filter((r) => r.status === 'testing')).toHaveLength(1);
      const v = judge(s, test);
      s = markTested(s, v.bad ? 'bad' : 'good').state;
      tests++;
      expect(tests).toBeLessThanOrEqual(maxSteps(range.length - 1));
    }
    const found = bisectInfo(s).found!;
    expect(rowsFor(s, range).find((r) => r.id === found)!.status).toBe('found');
    expect(rowsFor(s, range).find((r) => r.id === found)!.message).toBe('Tidy up spacing');
    expect(culpritChange(s, found, 'index.html')).toEqual({ removed: ['<p class="price">RM10</p>'], added: ['<p class="price">RM0</p>'] });
  });

  it('judge reads the checked-out file and finds the line', () => {
    const s = run(state(), 'git switch --detach HEAD~2').state;
    expect(judge(s, test)).toMatchObject({ bad: true, line: 3 });
    const ok = run(state(), 'git switch --detach HEAD~9').state;
    expect(judge(ok, test)).toMatchObject({ bad: false, line: null });
  });

  it('maxSteps is ceil(log2(n))', () => {
    expect([1, 2, 3, 4, 5, 8, 9, 16, 17].map(maxSteps)).toEqual([0, 1, 2, 2, 3, 3, 4, 4, 5]);
  });
});
