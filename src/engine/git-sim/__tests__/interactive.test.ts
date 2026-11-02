// Goals for Worlds 3–4, the engine helpers for interactives, and the log graph.
import { describe, expect, it } from 'vitest';
import {
  aheadBehind,
  buildScenario,
  checkGoal,
  conflictInfo,
  graphLanes,
  listServers,
  plain,
  resolveConflict,
  run,
  serverLog,
} from '../index';
import { verifyFixtures } from './fixtures';
import { exec, expectOk, out, repoOf } from './helpers';

const fx = (id: string) => buildScenario(verifyFixtures.find((s) => s.id === id)!);
const URL = 'https://github.com/you/diary.git';
const masked = (s: string) => s.replace(/\b[0-9a-f]{7,40}\b/g, '<h>');

describe('fixtures', () => {
  for (const s of verifyFixtures) {
    it(`${s.id} builds and every verify command runs in the engine`, () => {
      const start = buildScenario(s);
      for (const seq of s.verify ?? []) {
        let state = start;
        for (const cmd of seq) state = run(state, cmd).state;
        expect(state).toBeTruthy();
      }
    });
  }
});

describe('World 3–4 goals', () => {
  it('branches, current branch, branchAt, merge commit, linear history', () => {
    const s = exec(fx('fx-branches'), 'git merge --no-ff about', 'git branch old').state;
    expect(checkGoal(s, { currentBranch: 'main', branches: ['about', 'old'], branchesMissing: ['nope'] }).ok).toBe(true);
    expect(checkGoal(s, { branchAt: { about: 'Say what I like', main: "Merge branch 'about'" } }).ok).toBe(true);
    expect(checkGoal(s, { mergeCommit: true, linearHistory: false }).ok).toBe(true);
    expect(checkGoal(fx('fx-branches'), { mergeCommit: false, linearHistory: true }).ok).toBe(true);
    expect(checkGoal(s, { currentBranch: 'about' }).failed).toEqual(['currentBranch']);
  });

  it('inMerge, conflicts, noConflicts, stashCount, tags, inRebase', () => {
    const m = exec(fx('fx-conflicts'), 'git merge feature').state;
    expect(checkGoal(m, { inMerge: true, conflicts: ['index.html', 'new.txt'], noConflicts: false }).ok).toBe(true);
    const fixed = exec(m, 'git add .').state;
    expect(checkGoal(fixed, { inMerge: true, noConflicts: true }).ok).toBe(true);
    const s = exec(fx('fx-stash-rebase-pick-tag'), 'echo x >> style.css', 'git stash', 'git tag v1.0').state;
    expect(checkGoal(s, { stashCount: 1, tags: ['v1.0'], inRebase: false }).ok).toBe(true);
    const r = exec(fx('fx-stash-rebase-pick-tag'), 'git switch fix', 'git rebase main').state;
    expect(checkGoal(r, { inRebase: true, conflicts: ['index.html'] }).ok).toBe(true);
  });

  it('remotes, upstream, pushed, serverHas, aheadBehind', () => {
    const s = fx('fx-teamwork');
    expect(checkGoal(s, { remotes: { origin: URL }, upstream: { main: 'origin/main' } }).ok).toBe(true);
    // Aisyah pushed after you, so your main is not what the server has.
    expect(checkGoal(s, { pushed: ['main'] }).failed).toEqual(['pushed:main']);
    expect(checkGoal(s, { serverHas: { url: URL, branch: 'main', messageRegex: "Aisyah's day" } }).ok).toBe(true);
    expect(checkGoal(s, { serverHas: [{ url: URL, branch: 'main', hasMessage: 'Add home page' }, { url: URL, branch: 'nope' }] }).failed).toEqual([
      `serverHas:${URL}#nope`,
    ]);
    const behind = exec(s, 'git fetch').state;
    expect(checkGoal(behind, { aheadBehind: { ahead: 0, behind: 1 }, pushed: ['main'] }).failed).toEqual(['pushed:main']);
    const pushed = exec(behind, 'git pull', 'echo x > x.txt', 'git add x.txt', 'git commit -m "Add x"').state;
    expect(checkGoal(pushed, { aheadBehind: { ahead: 1 } }).ok).toBe(true);
    expect(checkGoal(exec(pushed, 'git push').state, { pushed: ['main'], aheadBehind: { ahead: 0, behind: 0 } }).ok).toBe(true);
  });
});

describe('engine helpers for interactives', () => {
  it('conflictInfo gives base / ours / theirs / merged per file', () => {
    const m = exec(fx('fx-conflicts'), 'git merge feature').state;
    const info = conflictInfo(m)!;
    expect(info.op).toBe('merge');
    expect(info.labels).toEqual({ ours: 'HEAD', theirs: 'feature' });
    expect(info.files.map((f) => [f.path, f.kind])).toEqual([
      ['index.html', 'both modified'],
      ['new.txt', 'both added'],
      ['style.css', 'deleted by them'],
    ]);
    const index = info.files[0]!;
    expect(index.ours).toContain('Day 2: main');
    expect(index.theirs).toContain('Day 2: feature');
    expect(index.base).toContain('<p>Day 2</p>');
    expect(index.merged).toContain('<<<<<<< HEAD');
    expect(info.files[2]!.theirs).toBeNull();
    expect(conflictInfo(fx('fx-conflicts'))).toBeNull();
  });

  it('resolveConflict writes + adds (or removes), like doing it by hand', () => {
    const m = exec(fx('fx-conflicts'), 'git merge feature').state;
    let s = resolveConflict(m, 'index.html', '<h1>My Diary</h1>\n').state;
    s = resolveConflict(s, 'new.txt', 'from both\n').state;
    const last = resolveConflict(s, 'style.css', null);
    expectOk(last);
    expect(conflictInfo(last.state)!.files).toEqual([]);
    expect(last.state.fs.files['/home/you/diary/style.css']).toBeUndefined();
    const done = exec(last.state, 'git commit').last;
    expectOk(done);
    expect(repoOf(done.state).op).toBeNull();
  });

  it('conflictInfo for a rebase names the commit being replayed', () => {
    const r = exec(fx('fx-stash-rebase-pick-tag'), 'git switch fix', 'git rebase main').state;
    const info = conflictInfo(r)!;
    expect(info.op).toBe('rebase');
    expect(info.labels.theirs).toMatch(/^[0-9a-f]{7} \(Fix day 1\)$/);
  });

  it('listServers, serverLog and aheadBehind', () => {
    const s = fx('fx-teamwork');
    const [server] = listServers(s);
    expect(server).toMatchObject({ url: URL, defaultBranch: 'main', empty: false });
    expect(server!.branches.map((b) => [b.name, b.message])).toEqual([['main', "Add Aisyah's day"]]);
    expect(serverLog(s, URL).map((c) => c.message)).toEqual(["Add Aisyah's day", 'Add home page']);
    expect(serverLog(s, 'https://github.com/you/diary').length).toBe(2);
    expect(aheadBehind(s)).toEqual({ branch: 'main', upstream: 'origin/main', ahead: 0, behind: 0, gone: false });
    expect(aheadBehind(exec(s, 'git fetch').state)).toMatchObject({ behind: 1 });
  });

  it('graphLanes puts branches on their own lanes and merges join them', () => {
    const s = exec(fx('fx-stash-rebase-pick-tag'), 'git tag v1.0 feature').state;
    const g = graphLanes(s);
    const by = (msg: string) => g.nodes.find((n) => n.message === msg)!;
    expect(by('Add home page').lane).toBe(0);
    expect(by('Improve day 1').lane).toBe(0);
    expect(by('Write day 7').lane).toBeGreaterThan(0);
    expect(by('Add contact page').branches).toEqual(['feature']);
    expect(by('Add contact page').tags).toEqual(['v1.0']);
    expect(by('Improve day 1').isHead).toBe(true);
    expect(by('Fix day 1').lane).not.toBe(by('Write day 7').lane);
    expect(g.head).toEqual({ branch: 'main', detached: false, id: by('Improve day 1').id });
    const merged = graphLanes(exec(s, 'git merge feature').state);
    const tip = merged.nodes.find((n) => n.isHead)!;
    expect(tip.merge).toBe(true);
    expect(merged.edges.filter((e) => e.to === tip.id).map((e) => e.kind)).toEqual(['first', 'merge']);
  });

  it('graphLanes shows remote-tracking refs and a pending conflict', () => {
    const s = exec(fx('fx-teamwork'), 'git fetch').state;
    const g = graphLanes(s);
    const theirs = g.nodes.find((n) => n.message === "Add Aisyah's day")!;
    expect(theirs.remotes).toEqual(['origin/main']);
    expect(theirs.lane).toBeGreaterThan(0);
    const m = graphLanes(exec(fx('fx-conflicts'), 'git merge feature').state);
    expect(m.pending).toMatchObject({ op: 'merge', paths: ['index.html', 'new.txt', 'style.css'] });
  });
});

describe('git log --graph (Git\'s layout)', () => {
  it('a long-format merge graph', () => {
    const s = exec(fx('fx-conflicts'), 'git merge feature', 'git add .', 'git commit -m "Merge feature"').state;
    const text = masked(plain(run(s, 'git log --graph').output)).replace(/Date: {3}.*/g, 'Date:   <date>');
    expect(text.split('\n').slice(0, 14)).toEqual([
      '*   commit <h> (HEAD -> main)',
      '|\\  Merge: <h> <h>',
      '| | Author: You <you@example.com>',
      '| | Date:   <date>',
      '| | ',
      '| |     Merge feature',
      '| | ',
      '| * commit <h> (feature)',
      '| | Author: You <you@example.com>',
      '| | Date:   <date>',
      '| | ',
      '| |     Feature work',
      '| | ',
      '* | commit <h>',
    ]);
    expect(text.split('\n')[14]).toBe('|/  Author: You <you@example.com>');
  });

  it('log ranges and merge filters', () => {
    const s = exec(fx('fx-stash-rebase-pick-tag'), 'git merge --no-ff feature').state;
    expect(masked(out(exec(s, 'git log --oneline --merges').last))).toBe("<h> (HEAD -> main) Merge branch 'feature'");
    expect(out(exec(s, 'git log --oneline --no-merges').last).split('\n')).toHaveLength(4);
    expect(masked(out(exec(s, 'git log --oneline main..fix').last))).toBe('<h> (fix) Fix day 1');
    expect(masked(out(exec(s, 'git log --oneline fix...main').last)).split('\n')).toHaveLength(5);
    expect(out(exec(s, 'git log --oneline @{u}').last)).toBe("fatal: no upstream configured for branch 'main'");
  });
});
