import { describe, expect, it } from 'vitest';
import { resolveRev } from '../index';
import { exec, expectFail, expectOk, fresh, oneCommit, out, repoOf } from './helpers';

const threeCommits = () =>
  exec(oneCommit(), 'echo "<p>Day 1</p>" >> index.html', 'git commit -am "Add day 1"', 'echo "body{}" > style.css', 'git add .', 'git commit -m "Add style"')
    .state;

describe('revisions', () => {
  it('HEAD, HEAD~n, HEAD^, branch names, short hashes, HEAD@{n}', () => {
    const s = threeCommits();
    const repo = repoOf(s);
    const ids = Object.keys(repo.commits);
    const [c1, c2, c3] = ids as [string, string, string];
    const id = (rev: string) => {
      const r = resolveRev(repo, rev);
      return r.ok ? r.id : r.reason;
    };
    expect(id('HEAD')).toBe(c3);
    expect(id('@')).toBe(c3);
    expect(id('main')).toBe(c3);
    expect(id('HEAD~1')).toBe(c2);
    expect(id('HEAD~')).toBe(c2);
    expect(id('HEAD^')).toBe(c2);
    expect(id('HEAD^^')).toBe(c1);
    expect(id('HEAD~2')).toBe(c1);
    expect(id('main~2')).toBe(c1);
    expect(id(c2.slice(0, 7))).toBe(c2);
    expect(id(`${c2.slice(0, 7)}^`)).toBe(c1);
    expect(id('HEAD@{1}')).toBe(c2);
    expect(id('HEAD~3')).toBe('noParent');
    expect(id('nope')).toBe('unknown');
  });

  it('hashes are deterministic for the same steps', () => {
    expect(Object.keys(repoOf(threeCommits()).commits)).toEqual(Object.keys(repoOf(threeCommits()).commits));
  });
});

describe('git log', () => {
  it('long format with decoration', () => {
    const s = oneCommit();
    const id = repoOf(s).branches.main!;
    expect(out(exec(s, 'git log').last)).toBe(
      [`commit ${id} (HEAD -> main)`, 'Author: You <you@example.com>', 'Date:   Fri Oct 30 09:01:00 2026 +0800', '', '    Add home page'].join('\n'),
    );
  });

  it('--oneline, -n, -2', () => {
    const s = threeCommits();
    const lines = out(exec(s, 'git log --oneline').last).split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^[0-9a-f]{7} \(HEAD -> main\) Add style$/);
    expect(lines[2]).toMatch(/^[0-9a-f]{7} Add home page$/);
    expect(out(exec(s, 'git log --oneline -n 1').last).split('\n')).toHaveLength(1);
    expect(out(exec(s, 'git log --oneline -2').last).split('\n')).toHaveLength(2);
  });

  it('--graph draws stars; long graph uses bars', () => {
    const s = threeCommits();
    expect(out(exec(s, 'git log --oneline --graph').last).split('\n').every((l) => l.startsWith('* '))).toBe(true);
    const long = out(exec(s, 'git log --graph').last).split('\n');
    expect(long[0]).toMatch(/^\* commit /);
    expect(long[1]).toMatch(/^\| Author:/);
  });

  it('--all shows commits ahead of a detached HEAD, with a fork drawn', () => {
    const s = exec(threeCommits(), 'git switch --detach HEAD~1', 'touch t', 'git add t', 'git commit -m "Try idea"').state;
    const lines = out(exec(s, 'git log --oneline --graph --all').last).split('\n');
    expect(lines[0]).toMatch(/^\* [0-9a-f]{7} \(HEAD\) Try idea$/);
    expect(lines[1]).toMatch(/^\| \* [0-9a-f]{7} \(main\) Add style$/);
    // Real Git pads graph rows to the graph's width.
    expect(lines[2]).toBe('|/  ');
    expect(lines[3]).toMatch(/^\* [0-9a-f]{7} Add day 1$/);
    // Without --all, main's newest commit is hidden.
    expect(out(exec(s, 'git log --oneline').last)).not.toContain('Add style');
  });

  it('log of a path and of a revision', () => {
    const s = threeCommits();
    expect(out(exec(s, 'git log --oneline style.css').last).split('\n')).toHaveLength(1);
    expect(out(exec(s, 'git log --oneline HEAD~1').last).split('\n')).toHaveLength(2);
  });

  it('errors: no commits, bad revision, bad option', () => {
    const empty = exec(fresh('/home/you/p'), 'git init', 'git log').last;
    expectFail(empty, 'noCommits');
    expect(out(empty)).toBe("fatal: your current branch 'main' does not have any commits yet");
    expectFail(exec(oneCommit(), 'git log nope').last, 'badRevision');
    expectFail(exec(oneCommit(), 'git log --wat').last, 'badOption');
  });
});

describe('git show', () => {
  it('shows the commit and its diff', () => {
    const s = threeCommits();
    const text = out(exec(s, 'git show').last);
    expect(text).toContain('    Add style');
    expect(text).toContain('diff --git a/style.css b/style.css\nnew file mode 100644\nindex 0000000..');
    expect(text).toContain('--- /dev/null\n+++ b/style.css\n@@ -0,0 +1 @@\n+body{}');
  });

  it('show HEAD~1 shows a modification with a real blob id line', () => {
    const text = out(exec(threeCommits(), 'git show HEAD~1').last);
    // Real Git's blob id for "<h1>My Diary</h1>\n".
    expect(text).toMatch(/index [0-9a-f]{7}\.\.[0-9a-f]{7} 100644/);
    expect(text).toContain('@@ -1 +1,2 @@\n <h1>My Diary</h1>\n+<p>Day 1</p>');
  });

  it('--oneline and bad revision', () => {
    expect(out(exec(threeCommits(), 'git show --oneline --no-patch').last)).toMatch(/^[0-9a-f]{7} \(HEAD -> main\) Add style$/);
    expectFail(exec(threeCommits(), 'git show nope').last, 'badRevision');
  });
});

describe('git diff', () => {
  it('working changes vs the box', () => {
    const r = exec(oneCommit(), 'echo "<p>new</p>" >> index.html', 'git diff');
    expect(out(r.last)).toMatch(
      /^diff --git a\/index.html b\/index.html\nindex [0-9a-f]{7}\.\.[0-9a-f]{7} 100644\n--- a\/index.html\n\+\+\+ b\/index.html\n@@ -1 \+1,2 @@\n <h1>My Diary<\/h1>\n\+<p>new<\/p>$/,
    );
    expect(r.last.explain?.key).toBe('sim.explain.diff.working');
  });

  it('is empty after git add; --staged shows it instead', () => {
    const s = exec(oneCommit(), 'echo "<p>new</p>" >> index.html', 'git add .').state;
    expect(exec(s, 'git diff').last.output).toEqual([]);
    expect(exec(s, 'git diff').last.explain?.key).toBe('sim.explain.diffEmpty');
    expect(out(exec(s, 'git diff --staged').last)).toContain('+<p>new</p>');
    expect(out(exec(s, 'git diff --cached').last)).toContain('+<p>new</p>');
  });

  it('untracked files are not in git diff', () => {
    expect(exec(oneCommit(), 'touch new.txt', 'git diff').last.output).toEqual([]);
  });

  it('between two commits, with A..B, and against a commit', () => {
    const s = threeCommits();
    const two = out(exec(s, 'git diff HEAD~2 HEAD').last);
    expect(two).toContain('+<p>Day 1</p>');
    expect(two).toContain('+++ b/style.css');
    expect(out(exec(s, 'git diff HEAD~2..HEAD').last)).toBe(two);
    expect(out(exec(s, 'echo x >> style.css', 'git diff HEAD~1').last)).toContain('+x');
  });

  it('path filter and deleted files', () => {
    const s = exec(threeCommits(), 'echo x >> index.html', 'echo y >> style.css').state;
    expect(out(exec(s, 'git diff style.css').last)).not.toContain('index.html');
    expect(out(exec(s, 'git diff -- index.html').last)).not.toContain('style.css');
    const del = out(exec(oneCommit(), 'rm index.html', 'git diff').last);
    expect(del).toContain('deleted file mode 100644');
    expect(del).toContain('+++ /dev/null');
  });

  it('staged rename shows similarity', () => {
    expect(out(exec(oneCommit(), 'git mv index.html home.html', 'git diff --staged').last)).toBe(
      'diff --git a/index.html b/home.html\nsimilarity index 100%\nrename from index.html\nrename to home.html',
    );
  });

  it('bad revision and option', () => {
    expectFail(exec(oneCommit(), 'git diff nope').last, 'badRevision');
    expectFail(exec(oneCommit(), 'git diff --wat').last, 'badOption');
  });
});

describe('git reflog', () => {
  it('lists HEAD moves newest first', () => {
    const s = exec(threeCommits(), 'git reset --hard HEAD~1').state;
    const lines = out(exec(s, 'git reflog').last).split('\n');
    expect(lines[0]).toMatch(/^[0-9a-f]{7} \(HEAD -> main\) HEAD@\{0\}: reset: moving to HEAD~1$/);
    expect(lines[1]).toMatch(/^[0-9a-f]{7} HEAD@\{1\}: commit: Add style$/);
    expect(lines[3]).toMatch(/HEAD@\{3\}: commit \(initial\): Add home page$/);
    expect(out(exec(s, 'git reflog -n 1').last).split('\n')).toHaveLength(1);
  });

  it('errors', () => {
    expectFail(exec(fresh('/home/you/p'), 'git init', 'git reflog').last, 'noCommits');
    expectFail(exec(oneCommit(), 'git reflog expire').last, 'reflogOption');
  });
});

describe('git branch', () => {
  it('lists the current branch', () => {
    expect(out(exec(oneCommit(), 'git branch').last)).toBe('* main');
    expect(out(exec(oneCommit(), 'git branch --show-current').last)).toBe('main');
  });

  it('shows detached HEAD', () => {
    const s = exec(threeCommits(), 'git switch --detach HEAD~1').state;
    expect(out(exec(s, 'git branch').last)).toMatch(/^\* \(HEAD detached at [0-9a-f]{7}\)\n {2}main$/);
  });

  it('renames the current branch with -m', () => {
    const r = exec(oneCommit(), 'git branch -m trunk', 'git branch');
    expect(out(r.last)).toBe('* trunk');
    const unborn = exec(fresh('/home/you/p'), 'git init', 'git branch -m main2', 'git status');
    expect(out(unborn.last).split('\n')[0]).toBe('On branch main2');
    expectFail(exec(oneCommit(), 'git branch -m "-bad"').last);
  });

  it('creating a branch works now (World 3) and stays where you are', () => {
    const r = exec(oneCommit(), 'git branch feature').last;
    expectOk(r);
    expect(r.explain?.key).toBe('sim.explain.branchCreate');
    expect(repoOf(r.state).head).toEqual({ type: 'branch', name: 'main' });
  });

  it('works on an unborn repo', () => {
    expectOk(exec(fresh('/home/you/p'), 'git init', 'git branch').last);
  });
});

describe('--stat', () => {
  it('git diff --stat and git show --stat print a summary, like Git', () => {
    const s = exec(oneCommit(), 'echo "<p>new</p>" >> index.html').state;
    expect(out(exec(s, 'git diff --stat').last)).toBe(' index.html | 1 +\n 1 file changed, 1 insertion(+)');
    const shown = out(exec(threeCommits(), 'git show --stat').last).split('\n');
    expect(shown.slice(-2)).toEqual([' style.css | 1 +', ' 1 file changed, 1 insertion(+)']);
    expect(out(exec(threeCommits(), 'git show --stat').last)).not.toContain('diff --git');
  });
});
