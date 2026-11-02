import { describe, expect, it } from 'vitest';
import { buildScenario } from '../index';
import { verifyFixtures } from './fixtures';
import { exec, expectFail, expectOk, oneCommit, out, repoOf } from './helpers';

/** Hashes are fake but stable; mask them to compare with real Git's text. */
const masked = (s: string) => s.replace(/\b[0-9a-f]{7,40}\b/g, '<h>');
const fx = (id: string) => buildScenario(verifyFixtures.find((s) => s.id === id)!);
const run1 = (...cmds: string[]) => exec(fx('fx-branches'), ...cmds);

describe('git branch: list, create, -v, -vv, -a', () => {
  it('lists with a star and creates without moving HEAD', () => {
    const r = exec(oneCommit(), 'git branch feature', 'git branch');
    expect(out(r.last)).toBe('  feature\n* main');
    expect(r.all[0]!.events).toContainEqual(expect.objectContaining({ type: 'branchCreated', branch: 'feature' }));
  });

  it('-v pads names and shows hash + subject (like Git)', () => {
    const s = exec(oneCommit(), 'git branch feature').state;
    expect(masked(out(exec(s, 'git branch -v').last))).toBe('  feature <h> Add home page\n* main    <h> Add home page');
  });

  it('a branch at another commit, and bad start points', () => {
    const r = run1('git branch old about~1');
    expectOk(r.last);
    expect(r.last.explain?.key).toBe('sim.explain.branchCreateAt');
    expect(out(exec(r.state, 'git branch x HEAD~5').last)).toBe("fatal: not a valid object name: 'HEAD~5'");
    expect(out(exec(r.state, 'git branch old').last)).toBe("fatal: a branch named 'old' already exists");
    expect(out(exec(r.state, 'git branch bad..name').last)).toBe("fatal: 'bad..name' is not a valid branch name\nhint: See 'git help check-ref-format'");
  });

  it('--show-current, --merged and --no-merged', () => {
    expect(out(run1('git branch --show-current').last)).toBe('main');
    expect(out(run1('git branch --merged').last)).toBe('* main');
    expect(out(run1('git branch --no-merged').last)).toBe('  about');
    expect(out(run1('git merge about', 'git branch --merged').last)).toBe('  about\n* main');
  });

  it('detached HEAD shows in the list', () => {
    const s = run1('git switch --detach HEAD').state;
    expect(masked(out(exec(s, 'git branch').last))).toBe('* (HEAD detached at <h>)\n  about\n  main');
  });
});

describe('git branch -d / -D / -m', () => {
  it('-d refuses unmerged work with the hint, -D deletes', () => {
    const r = run1('git branch -d about');
    expectFail(r.last, 'branchDelete');
    expect(out(r.last)).toBe(
      [
        "error: the branch 'about' is not fully merged",
        "hint: If you are sure you want to delete it, run 'git branch -D about'",
        'hint: Disable this message with "git config set advice.forceDeleteBranch false"',
      ].join('\n'),
    );
    expect(r.last.explain?.key).toBe('sim.err.branchNotMerged');
    const d = run1('git branch -D about').last;
    expect(masked(out(d))).toBe('Deleted branch about (was <h>).');
    expect(repoOf(d.state).branches.about).toBeUndefined();
  });

  it('-d works after merging; not found; current branch', () => {
    expect(masked(out(run1('git merge about', 'git branch -d about').last))).toBe('Deleted branch about (was <h>).');
    expect(out(run1('git branch -d nope').last)).toBe("error: branch 'nope' not found");
    expect(out(run1('git branch -d main').last)).toBe("error: cannot delete branch 'main' used by worktree at '/home/you/diary'");
  });

  it('-m renames the current branch or another one, keeping upstream config', () => {
    const r = run1('git branch -m about info', 'git branch');
    expect(out(r.last)).toBe('  info\n* main');
    const s = run1('git branch -m trunk').state;
    expect(repoOf(s).head).toEqual({ type: 'branch', name: 'trunk' });
    expect(out(run1('git branch -m nope x').last)).toBe("fatal: no branch named 'nope'");
    expect(out(run1('git branch -m about main').last)).toBe("fatal: a branch named 'main' already exists");
  });
});

describe('git switch -c / -C / - and git checkout -b', () => {
  it('creates and moves, -C resets, - goes back', () => {
    expect(out(run1('git switch -c idea').last)).toBe("Switched to a new branch 'idea'");
    expect(out(run1('git switch -c about').last)).toBe("fatal: a branch named 'about' already exists");
    expect(out(run1('git switch -C about').last)).toBe("Switched to and reset branch 'about'");
    expect(out(run1('git switch -c x', 'git switch -C x main').last)).toBe("Reset branch 'x'");
    const back = run1('git switch about', 'git switch -');
    expect(out(back.last)).toBe("Switched to branch 'main'");
    expect(out(run1('git checkout -b idea about').last)).toBe("Switched to a new branch 'idea'");
    expect(out(run1('git switch -c y nope').last)).toBe('fatal: invalid reference: nope');
    expect(out(run1('git checkout -b y nope').last)).toBe("fatal: 'nope' is not a commit and a branch 'y' cannot be created from it");
  });

  it('carries changes when they do not clash, and lists them (M) when files change', () => {
    const r = run1('echo "x" >> index.html', 'git switch about');
    expect(out(r.last)).toBe("M\tindex.html\nSwitched to branch 'about'");
    expect(out(exec(r.state, 'git status -s').last)).toBe(' M index.html');
    // A new branch at HEAD changes no files: no M lines.
    expect(out(run1('echo "x" >> index.html', 'git switch -c keep').last)).toBe("Switched to a new branch 'keep'");
  });

  it('refuses when local changes would be overwritten (Git says "checkout" for switch too)', () => {
    const r = run1('echo "<h1>Mine</h1>" > about.html', 'git switch about').last;
    expectFail(r, 'untrackedOverwrite');
    expect(out(r)).toBe(
      'error: The following untracked working tree files would be overwritten by checkout:\n\tabout.html\nPlease move or remove them before you switch branches.\nAborting',
    );
    const s = run1('git switch about', 'echo "<p>edit</p>" >> about.html').state;
    const blocked = exec(s, 'git switch main').last;
    expect(out(blocked)).toBe(
      'error: Your local changes to the following files would be overwritten by checkout:\n\tabout.html\nPlease commit your changes or stash them before you switch branches.\nAborting',
    );
  });
});

describe('verb shapes', () => {
  it('branch and switch never change the input state', () => {
    expect(() => run1('git branch a', 'git branch -m a b', 'git branch -D b', 'git switch -c c', 'git switch -C c main', 'git checkout -b d')).not.toThrow();
  });
});
