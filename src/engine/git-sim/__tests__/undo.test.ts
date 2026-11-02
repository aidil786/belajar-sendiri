import { describe, expect, it } from 'vitest';
import { exec, expectFail, expectOk, oneCommit, out, repoOf } from './helpers';

const FILE = '/home/you/diary/index.html';
const twoCommits = () => exec(oneCommit(), 'echo "<p>Day 1</p>" >> index.html', 'git commit -am "Add day 1"').state;

describe('git restore', () => {
  it('throws away a working change', () => {
    const r = exec(oneCommit(), 'echo "oops" >> index.html', 'git restore index.html');
    expectOk(r.last);
    expect(r.state.fs.files[FILE]).toBe('<h1>My Diary</h1>\n');
    expect(r.last.events).toEqual([{ type: 'fileRestored', path: 'index.html' }]);
    expect(r.last.explain?.key).toBe('sim.explain.restore');
  });

  it('restores from the box, not from HEAD', () => {
    const r = exec(oneCommit(), 'echo a >> index.html', 'git add .', 'echo b >> index.html', 'git restore index.html');
    expect(r.state.fs.files[FILE]).toBe('<h1>My Diary</h1>\na\n');
  });

  it('brings back a deleted file', () => {
    expect(exec(oneCommit(), 'rm index.html', 'git restore index.html').state.fs.files[FILE]).toBe('<h1>My Diary</h1>\n');
  });

  it('--staged takes a file out of the box but keeps the change', () => {
    const r = exec(oneCommit(), 'echo a >> index.html', 'git add .', 'git restore --staged index.html', 'git status -s');
    expect(out(r.last)).toBe(' M index.html');
    expect(r.all[2]!.events).toEqual([{ type: 'fileUnstaged', path: 'index.html' }]);
  });

  it('--staged on a new file makes it untracked again', () => {
    expect(out(exec(oneCommit(), 'touch n.txt', 'git add n.txt', 'git restore --staged n.txt', 'git status -s').last)).toBe('?? n.txt');
  });

  it('--source takes an older version', () => {
    const r = exec(twoCommits(), 'git restore --source=HEAD~1 index.html', 'git status -s');
    expect(r.state.fs.files[FILE]).toBe('<h1>My Diary</h1>\n');
    expect(out(r.last)).toBe(' M index.html');
    expect(exec(twoCommits(), 'git restore -s HEAD~1 index.html').state.fs.files[FILE]).toBe('<h1>My Diary</h1>\n');
  });

  it('--staged --worktree resets both', () => {
    const r = exec(oneCommit(), 'echo a >> index.html', 'git add .', 'git restore --staged --worktree index.html', 'git status -s');
    expect(out(r.last)).toBe('');
  });

  it('restore . restores everything tracked, leaving untracked files', () => {
    const r = exec(oneCommit(), 'echo a >> index.html', 'touch keep.txt', 'git restore .', 'git status -s');
    expect(out(r.last)).toBe('?? keep.txt');
  });

  it('errors', () => {
    expect(out(exec(oneCommit(), 'git restore nope.txt').last)).toBe("error: pathspec 'nope.txt' did not match any file(s) known to git");
    expectFail(exec(oneCommit(), 'git restore').last, 'needPath');
    expectFail(exec(oneCommit(), 'git restore --source=nope index.html').last, 'badRevision');
    expectFail(exec(oneCommit(), 'git restore --wat x').last, 'badOption');
  });
});

describe('git reset', () => {
  const dirty = () => exec(twoCommits(), 'echo staged > s.txt', 'git add s.txt', 'echo work >> index.html').state;

  it('--soft moves the branch only (changes stay in the box)', () => {
    const r = exec(twoCommits(), 'git reset --soft HEAD~1', 'git status -s');
    expect(out(r.last)).toBe('M  index.html');
    expect(r.all[0]!.output).toEqual([]);
    expect(r.all[0]!.events.map((e) => e.type)).toEqual(['branchMoved', 'headMoved', 'resetApplied']);
  });

  it('--mixed (default) empties the box but keeps files', () => {
    const r = exec(twoCommits(), 'git reset HEAD~1');
    expect(out(r.last)).toBe('Unstaged changes after reset:\nM\tindex.html');
    expect(out(exec(r.state, 'git status -s').last)).toBe(' M index.html');
    expect(exec(twoCommits(), 'git reset --mixed HEAD~1').last.explain?.key).toBe('sim.explain.resetMixed');
  });

  it('--hard wipes changes in the box and the folder (untracked survive)', () => {
    const r = exec(dirty(), 'touch untracked.txt', 'git reset --hard HEAD~1');
    expect(out(r.last)).toBe('HEAD is now at ' + repoOf(r.state).branches.main!.slice(0, 7) + ' Add home page');
    expect(r.state.fs.files[FILE]).toBe('<h1>My Diary</h1>\n');
    expect(r.state.fs.files['/home/you/diary/s.txt']).toBeUndefined();
    expect(out(exec(r.state, 'git status -s').last)).toBe('?? untracked.txt');
  });

  it('git reset with no commit unstages everything', () => {
    expect(out(exec(dirty(), 'git reset', 'git status -s').last)).toBe(' M index.html\n?? s.txt');
  });

  it('git reset <file> unstages one file', () => {
    const r = exec(dirty(), 'git add index.html', 'git reset s.txt', 'git status -s');
    expect(out(r.last)).toBe('M  index.html\n?? s.txt');
  });

  it('reflog lets you undo a hard reset', () => {
    const before = repoOf(twoCommits()).branches.main!;
    const r = exec(twoCommits(), 'git reset --hard HEAD~1', 'git reset --hard HEAD@{1}');
    expect(repoOf(r.state).branches.main).toBe(before);
    expect(r.state.fs.files[FILE]).toContain('Day 1');
  });

  it('errors', () => {
    expectFail(exec(twoCommits(), 'git reset --soft --hard HEAD~1').last, 'resetModes');
    expectFail(exec(twoCommits(), 'git reset --soft HEAD index.html').last, 'softPaths');
    expectFail(exec(twoCommits(), 'git reset nope').last, 'badRevision');
    expectFail(exec(twoCommits(), 'git reset --keep HEAD').last, 'resetMode');
    expectFail(exec(twoCommits(), 'git reset --wat').last, 'badOption');
  });
});

describe('git revert', () => {
  it('makes a new undo commit', () => {
    const r = exec(twoCommits(), 'git revert HEAD');
    expectOk(r.last);
    const repo = repoOf(r.state);
    const head = repo.commits[repo.branches.main!]!;
    const reverted = Object.values(repo.commits).find((c) => c.message === 'Add day 1')!;
    expect(head.message).toBe(`Revert "Add day 1"\n\nThis reverts commit ${reverted.id}.`);
    expect(out(r.last).split('\n')).toEqual([`[main ${head.id.slice(0, 7)}] Revert "Add day 1"`, ' 1 file changed, 1 deletion(-)']);
    expect(r.state.fs.files[FILE]).toBe('<h1>My Diary</h1>\n');
    expect(repo.reflog[0]!.message).toBe('revert: Revert "Add day 1"');
    expect(r.last.events[0]).toEqual({ type: 'revertCreated', id: head.id, reverted: reverted.id });
    expect(out(exec(r.state, 'git log --oneline').last).split('\n')).toHaveLength(3);
  });

  it('can revert an older commit when later commits do not touch it', () => {
    const s = exec(twoCommits(), 'echo b > b.txt', 'git add .', 'git commit -m "Add b"').state;
    const r = exec(s, 'git revert HEAD~1');
    expectOk(r.last);
    expect(r.state.fs.files['/home/you/diary/b.txt']).toBe('b\n');
    expect(r.state.fs.files[FILE]).toBe('<h1>My Diary</h1>\n');
  });

  it('reverts an older commit even when a later commit changed other lines of the same file', () => {
    const s = exec(
      oneCommit(),
      'echo a > n.txt', 'echo b >> n.txt', 'echo c >> n.txt', 'echo d >> n.txt', 'echo e >> n.txt',
      'git add n.txt', 'git commit -m "Add notes"',
      'echo a > n.txt', 'echo b >> n.txt', 'echo c >> n.txt', 'echo d >> n.txt', 'echo E >> n.txt',
      'git commit -am "Shout e"',
      'echo A > n.txt', 'echo b >> n.txt', 'echo c >> n.txt', 'echo d >> n.txt', 'echo E >> n.txt',
      'git commit -am "Shout a"',
    ).state;
    const r = exec(s, 'git revert --no-edit HEAD~1');
    expectOk(r.last);
    // The later "Shout a" edit stays; only "Shout e" is undone.
    expect(r.state.fs.files['/home/you/diary/n.txt']).toBe('A\nb\nc\nd\ne\n');
    expect(out(r.last)).toMatch(/Revert "Shout e"/);
  });

  it('reverting a file-adding commit deletes the file', () => {
    const r = exec(oneCommit(), 'echo b > b.txt', 'git add .', 'git commit -m "Add b"', 'git revert --no-edit HEAD');
    expect(out(r.last)).toContain(' delete mode 100644 b.txt');
    expect(r.state.fs.files['/home/you/diary/b.txt']).toBeUndefined();
  });

  it('refuses with local changes, and on overlapping later changes', () => {
    expectFail(exec(twoCommits(), 'echo x >> index.html', 'git revert HEAD').last, 'dirty');
    const s = exec(twoCommits(), 'echo "<p>Day 2</p>" >> index.html', 'git commit -am "Add day 2"').state;
    expectFail(exec(s, 'git revert HEAD~1').last, 'revertConflict');
  });

  it('usage errors', () => {
    expectFail(exec(twoCommits(), 'git revert').last, 'usage');
    expectFail(exec(twoCommits(), 'git revert nope').last, 'badRevision');
    expectFail(exec(twoCommits(), 'git revert HEAD HEAD~1').last, 'revertMany');
    expectFail(exec(twoCommits(), 'git revert -n HEAD').last, 'revertNoCommit');
  });

  it('-m 1 undoes a merge, keeping the first parent', () => {
    const s = exec(
      oneCommit(),
      'git switch -c about',
      'echo "<h1>About</h1>" > about.html',
      'git add about.html',
      'git commit -m "Add about"',
      'git switch main',
      'echo "<p>Day 1</p>" >> index.html',
      'git commit -am "Add day 1"',
      'git merge about',
    ).state;
    const r = exec(s, 'git revert -m 1 HEAD');
    expectOk(r.last);
    const repo = repoOf(r.state);
    const head = repo.commits[repo.branches.main!]!;
    const merge = repo.commits[head.parents[0]!]!;
    expect(head.message).toBe(`Revert "Merge branch 'about'"\n\nThis reverts commit ${merge.id}, reversing\nchanges made to ${merge.parents[0]}.`);
    expect(r.state.fs.files['/home/you/diary/about.html']).toBeUndefined();
    expect(r.state.fs.files[FILE]).toBe('<h1>My Diary</h1>\n<p>Day 1</p>\n');
    expectFail(exec(twoCommits(), 'git revert -m 1 HEAD').last, 'revertNotMerge');
    expectFail(exec(s, 'git revert -m 3 HEAD').last, 'revertBadParent');
  });
});

describe('checkout / switch and detached HEAD', () => {
  it('git checkout <commit> detaches with advice', () => {
    const r = exec(twoCommits(), 'git checkout HEAD~1');
    expectOk(r.last);
    const text = out(r.last);
    expect(text.startsWith("Note: switching to 'HEAD~1'.\n\nYou are in 'detached HEAD' state.")).toBe(true);
    expect(text).toMatch(/HEAD is now at [0-9a-f]{7} Add home page$/);
    expect(r.state.fs.files[FILE]).toBe('<h1>My Diary</h1>\n');
    expect(repoOf(r.state).head.type).toBe('detached');
    expect(r.last.events[0]).toMatchObject({ type: 'headDetached' });
    expect(out(exec(r.state, 'git status').last).split('\n')[0]).toMatch(/^HEAD detached at [0-9a-f]{7}$/);
    expect(repoOf(r.state).reflog[0]!.message).toBe('checkout: moving from main to HEAD~1');
  });

  it('git switch --detach has no advice; switch main comes back', () => {
    const r = exec(twoCommits(), 'git switch --detach HEAD~1');
    expect(out(r.last)).toMatch(/^HEAD is now at [0-9a-f]{7} Add home page$/);
    const back = exec(r.state, 'git switch main');
    expect(out(back.last)).toMatch(/^Previous HEAD position was [0-9a-f]{7} Add home page\nSwitched to branch 'main'$/);
    expect(back.state.fs.files[FILE]).toContain('Day 1');
  });

  it('switch - goes back; checkout - too', () => {
    const r = exec(twoCommits(), 'git switch --detach HEAD~1', 'git switch -');
    expect(repoOf(r.state).head).toEqual({ type: 'branch', name: 'main' });
    const again = exec(r.state, 'git checkout -');
    expect(repoOf(again.state).head.type).toBe('detached');
  });

  it('warns about commits left behind', () => {
    const r = exec(twoCommits(), 'git checkout HEAD~1', 'touch t', 'git add t', 'git commit -m "Lonely"', 'git switch main');
    expect(out(r.last)).toMatch(/^Warning: you are leaving 1 commit behind, not connected to\nany of your branches:\n\n {2}[0-9a-f]{7} Lonely\n/);
    expect(out(r.last)).toMatch(/Switched to branch 'main'$/);
  });

  it('switch to a commit without --detach fails with a hint', () => {
    const r = exec(twoCommits(), 'git switch HEAD~1').last;
    expectFail(r, 'branchExpected');
    expect(out(r)).toBe(
      "fatal: a branch is expected, got commit 'HEAD~1'\nhint: If you want to detach HEAD at the commit, try again with the --detach option.",
    );
  });

  it('already on, unknown branch, missing arg; -c and -b create branches', () => {
    expect(out(exec(twoCommits(), 'git switch main').last)).toBe("Already on 'main'");
    expectFail(exec(twoCommits(), 'git switch nope').last, 'badRevision');
    expectFail(exec(twoCommits(), 'git switch').last, 'missingBranch');
    expect(out(exec(twoCommits(), 'git switch -c feature').last)).toBe("Switched to a new branch 'feature'");
    expect(out(exec(twoCommits(), 'git checkout -b feature').last)).toBe("Switched to a new branch 'feature'");
  });

  it('refuses to overwrite local changes', () => {
    const r = exec(twoCommits(), 'echo x >> index.html', 'git checkout HEAD~1').last;
    expectFail(r, 'localChanges');
    expect(out(r)).toContain('Your local changes to the following files would be overwritten by checkout:\n\tindex.html');
  });

  it('carries unrelated local changes along', () => {
    const r = exec(twoCommits(), 'echo x > other.txt', 'git switch --detach HEAD~1', 'git status -s');
    expect(out(r.last)).toBe('?? other.txt');
  });

  it('old-style checkout -- file restores from the box', () => {
    const r = exec(oneCommit(), 'echo x >> index.html', 'git checkout -- index.html');
    expect(r.state.fs.files[FILE]).toBe('<h1>My Diary</h1>\n');
    expect(exec(oneCommit(), 'echo x >> index.html', 'git checkout index.html').state.fs.files[FILE]).toBe('<h1>My Diary</h1>\n');
    expectFail(exec(oneCommit(), 'git checkout nope').last, 'pathspecNoMatch');
  });
});

describe('git clean', () => {
  const junk = () => exec(oneCommit(), 'touch notes.txt', 'mkdir build', 'touch build/out.js', 'echo "*.log" > .gitignore', 'git add .gitignore', 'git commit -m "Ignore logs"', 'touch debug.log').state;

  it('refuses without -n or -f', () => {
    const r = exec(junk(), 'git clean').last;
    expectFail(r, 'requireForce');
    expect(out(r)).toBe('fatal: clean.requireForce defaults to true and neither -i, -n, nor -f given; refusing to clean');
  });

  it('-n lists files only; -nd adds folders; ignored files stay', () => {
    expect(out(exec(junk(), 'git clean -n').last)).toBe('Would remove notes.txt');
    expect(out(exec(junk(), 'git clean -nd').last)).toBe('Would remove build/\nWould remove notes.txt');
    expect(exec(junk(), 'git clean -n').state.fs.files['/home/you/diary/notes.txt']).toBe('');
  });

  it('-f and -fd remove them', () => {
    const f = exec(junk(), 'git clean -f');
    expect(out(f.last)).toBe('Removing notes.txt');
    expect(f.state.fs.files['/home/you/diary/build/out.js']).toBe('');
    const fd = exec(junk(), 'git clean -fd');
    expect(out(fd.last)).toBe('Removing build/\nRemoving notes.txt');
    expect(fd.state.fs.dirs).not.toContain('/home/you/diary/build');
    expect(fd.state.fs.files['/home/you/diary/debug.log']).toBe('');
    expect(fd.last.events).toEqual([{ type: 'filesCleaned', paths: ['build/', 'notes.txt'], dryRun: false }]);
  });

  it('nothing to clean; -x refused', () => {
    expect(exec(oneCommit(), 'git clean -n').last.explain?.key).toBe('sim.explain.cleanNothing');
    expectFail(exec(junk(), 'git clean -fx').last, 'cleanIgnored');
  });
});
