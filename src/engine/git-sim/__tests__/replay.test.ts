// Stash, rebase (incl. the interactive API) and cherry-pick.
import { describe, expect, it } from 'vitest';
import { buildScenario, rebaseInteractive, rebaseTodo, subject } from '../index';
import { verifyFixtures } from './fixtures';
import { deepFreeze, exec, expectFail, expectOk, out, repoOf } from './helpers';

const masked = (s: string) => s.replace(/\b[0-9a-f]{7,40}\b/g, '<h>');
const base = () => buildScenario(verifyFixtures.find((s) => s.id === 'fx-stash-rebase-pick-tag')!);
const log = (state: ReturnType<typeof base>) => masked(out(exec(state, 'git log --oneline').last));

describe('git stash', () => {
  it('push, list, show, pop', () => {
    const r = exec(base(), 'echo "/* draft */" >> style.css', 'echo "todo" > notes.txt', 'git stash', 'git stash list', 'git status -s', 'git stash show');
    expect(masked(out(r.all[2]!))).toBe('Saved working directory and index state WIP on main: <h> Improve day 1');
    expect(masked(out(r.all[3]!))).toBe('stash@{0}: WIP on main: <h> Improve day 1');
    expect(out(r.all[4]!)).toBe('?? notes.txt');
    expect(out(r.all[5]!)).toBe(' style.css | 1 +\n 1 file changed, 1 insertion(+)');
    const pop = exec(r.state, 'git stash pop').last;
    expect(masked(out(pop))).toBe(
      [
        'On branch main',
        'Changes not staged for commit:',
        '  (use "git add <file>..." to update what will be committed)',
        '  (use "git restore <file>..." to discard changes in working directory)',
        '\tmodified:   style.css',
        '',
        'Untracked files:',
        '  (use "git add <file>..." to include in what will be committed)',
        '\tnotes.txt',
        '',
        'no changes added to commit (use "git add" and/or "git commit -a")',
        'Dropped refs/stash@{0} (<h>)',
      ].join('\n'),
    );
    expect(repoOf(pop.state).stash).toHaveLength(0);
  });

  it('-m, -u, apply keeps the entry, drop, clear, empty cases', () => {
    const s = exec(base(), 'echo "/* a */" >> style.css', 'git stash push -m "style draft"', 'echo "todo" > notes.txt', 'git stash -u').state;
    expect(masked(out(exec(s, 'git stash list').last))).toBe('stash@{0}: WIP on main: <h> Improve day 1\nstash@{1}: On main: style draft');
    expect(out(exec(s, 'git status -s').last)).toBe('');
    const applied = exec(s, 'git stash apply');
    expect(out(applied.last).startsWith('Already up to date.')).toBe(true);
    expect(repoOf(applied.state).stash).toHaveLength(2);
    expect(masked(out(exec(applied.state, 'git stash drop').last))).toBe('Dropped refs/stash@{0} (<h>)');
    expect(out(exec(s, 'git stash clear', 'git stash list').last)).toBe('');
    expect(out(exec(base(), 'git stash').last)).toBe('No local changes to save');
    expect(out(exec(base(), 'git stash pop').last)).toBe('No stash entries found.');
    expect(out(exec(s, 'git stash drop stash@{5}').last)).toBe("fatal: log for 'stash' only has 2 entries");
  });

  it('a conflicting pop keeps the stash and marks the file unmerged', () => {
    const r = exec(base(), 'echo "/* a */" >> style.css', 'git stash', 'echo "/* b */" >> style.css', 'git commit -am "B"', 'git stash pop').last;
    expect(r.ok).toBe(false);
    expect(r.stopped).toBe(true);
    const text = out(r);
    expect(text.startsWith('Auto-merging style.css\nCONFLICT (content): Merge conflict in style.css\nOn branch main\nUnmerged paths:')).toBe(true);
    expect(text).toContain('  (use "git restore --staged <file>..." to unstage)');
    expect(text.endsWith('The stash entry is kept in case you need it again.')).toBe(true);
    expect(r.state.fs.files['/home/you/diary/style.css']).toBe(
      'body { color: purple; }\n<<<<<<< Updated upstream\n/* b */\n=======\n/* a */\n>>>>>>> Stashed changes\n',
    );
    expect(repoOf(r.state).stash).toHaveLength(1);
    expect(out(exec(r.state, 'git stash').last)).toBe('style.css: needs merge');
  });
});

describe('git rebase', () => {
  it('replays a branch on top of main', () => {
    const r = exec(base(), 'git switch feature', 'git rebase main');
    expect(out(r.last)).toBe('Successfully rebased and updated refs/heads/feature.');
    expect(log(r.state)).toBe(['<h> (HEAD -> feature) Add contact page', '<h> Write day 7', '<h> (main) Improve day 1', '<h> Add home page'].join('\n'));
    expect(out(exec(r.state, 'git rebase main').last)).toBe('Current branch feature is up to date.');
    expect(r.last.events[0]).toMatchObject({ type: 'rebased', branch: 'feature' });
  });

  it('stops on a conflict, shows rebase status, and continues', () => {
    const stop = exec(base(), 'git switch fix', 'git rebase main').last;
    expect(stop.stopped).toBe(true);
    expect(masked(out(stop))).toBe(
      [
        'Auto-merging index.html',
        'CONFLICT (content): Merge conflict in index.html',
        'error: could not apply <h>... Fix day 1',
        'hint: Resolve all conflicts manually, mark them as resolved with',
        'hint: "git add/rm <conflicted_files>", then run "git rebase --continue".',
        'hint: You can instead skip this commit: run "git rebase --skip".',
        'hint: To abort and get back to the state before "git rebase", run "git rebase --abort".',
        'hint: Disable this message with "git config set advice.mergeConflict false"',
        'Could not apply <h>... # Fix day 1',
      ].join('\n'),
    );
    expect(masked(out(exec(stop.state, 'git status').last))).toBe(
      [
        'interactive rebase in progress; onto <h>',
        'Last command done (1 command done):',
        '   pick <h> # Fix day 1',
        'No commands remaining.',
        "You are currently rebasing branch 'fix' on '<h>'.",
        '  (fix conflicts and then run "git rebase --continue")',
        '  (use "git rebase --skip" to skip this patch)',
        '  (use "git rebase --abort" to check out the original branch)',
        '',
        'Unmerged paths:',
        '  (use "git restore --staged <file>..." to unstage)',
        '  (use "git add <file>..." to mark resolution)',
        '\tboth modified:   index.html',
        '',
        'no changes added to commit (use "git add" and/or "git commit -a")',
      ].join('\n'),
    );
    expect(masked(out(exec(stop.state, 'git branch').last))).toBe('* (no branch, rebasing fix)\n  feature\n  fix\n  main');
    expect(out(exec(stop.state, 'git rebase --continue').last)).toBe(
      'index.html: needs merge\nYou must edit all merge conflicts and then\nmark them as resolved using git add',
    );
    const done = exec(stop.state, 'echo "<p>both</p>" > index.html', 'git add index.html', 'git rebase --continue');
    expect(masked(out(done.last))).toBe('[detached HEAD <h>] Fix day 1\n 1 file changed, 1 insertion(+), 8 deletions(-)\nSuccessfully rebased and updated refs/heads/fix.');
    expect(repoOf(done.state).head).toEqual({ type: 'branch', name: 'fix' });
  });

  it('--skip and --abort', () => {
    const stop = exec(base(), 'git switch fix', 'git rebase main').state;
    const skipped = exec(stop, 'git rebase --skip');
    expect(out(skipped.last)).toBe('Successfully rebased and updated refs/heads/fix.');
    expect(log(skipped.state)).toBe('<h> (HEAD -> fix, main) Improve day 1\n<h> Add home page');
    const aborted = exec(stop, 'git rebase --abort');
    expect(log(aborted.state)).toBe('<h> (HEAD -> fix) Fix day 1\n<h> Add home page');
    expect(out(exec(aborted.state, 'git rebase --abort').last)).toBe('fatal: No rebase in progress?');
  });

  it('errors: dirty tree, no upstream, unknown upstream, -i, already rebasing', () => {
    const dirty = exec(base(), 'git switch fix', 'echo "x" >> style.css');
    expect(out(exec(dirty.state, 'git rebase main').last)).toBe('error: cannot rebase: You have unstaged changes.\nerror: Please commit or stash them.');
    expect(out(exec(dirty.state, 'git rebase nope').last)).toBe("fatal: invalid upstream 'nope'");
    expect(out(exec(dirty.state, 'git rebase').last)).toContain('There is no tracking information for the current branch.');
    const i = exec(base(), 'git rebase -i main').last;
    expectFail(i, 'rebaseInteractive');
    expect(i.output).toEqual([]);
    expect(i.explain?.key).toBe('sim.err.rebaseInteractive');
    const stop = exec(base(), 'git switch fix', 'git rebase main').state;
    expect(out(exec(stop, 'git rebase main').last)).toContain('fatal: It seems that there is already a rebase-merge directory');
    expect(out(exec(stop, 'git switch main').last)).toContain('fatal: cannot switch branch while rebasing');
  });

  it('a merged branch is linearised again (Git drops merge commits)', () => {
    const r = exec(base(), 'git switch feature', 'git merge main', 'git rebase main');
    expect(out(r.last)).toBe('Successfully rebased and updated refs/heads/feature.');
    expect(repoOf(r.state).commits[repoOf(r.state).branches.feature!]!.parents).toHaveLength(1);
  });
});

describe('rebaseInteractive API (for the rebase card deck)', () => {
  const onFeature = () => exec(base(), 'git switch feature').state;

  it('rebaseTodo lists the picks, oldest first', () => {
    const todo = rebaseTodo(onFeature(), 'main');
    expect(todo.map((t) => [t.action, t.message])).toEqual([
      ['pick', 'Write day 7'],
      ['pick', 'Add contact page'],
    ]);
    expect(todo[0]!.short).toHaveLength(7);
    expect(rebaseTodo(onFeature(), 'nope')).toEqual([]);
  });

  it('squash, reword, drop and reorder', () => {
    const s = deepFreeze(onFeature());
    const [a, b] = rebaseTodo(s, 'main');
    const squashed = rebaseInteractive(s, 'main', [
      { action: 'pick', commit: a!.commit },
      { action: 'squash', commit: b!.commit },
    ]);
    expectOk(squashed);
    const r = repoOf(squashed.state);
    const tip = r.commits[r.branches.feature!]!;
    expect(tip.message).toBe('Write day 7\n\nAdd contact page');
    expect(subject(r.commits[tip.parents[0]!]!.message)).toBe('Improve day 1');
    const fixed = rebaseInteractive(s, 'main', [
      { action: 'reword', commit: a!.commit, message: 'Day 7 entry' },
      { action: 'fixup', commit: b!.commit },
    ]);
    expect(repoOf(fixed.state).commits[repoOf(fixed.state).branches.feature!]!.message).toBe('Day 7 entry');
    const dropped = rebaseInteractive(s, 'main', [
      { action: 'drop', commit: a!.commit },
      { action: 'pick', commit: b!.commit },
    ]);
    expect(log(dropped.state)).toBe('<h> (HEAD -> feature) Add contact page\n<h> (main) Improve day 1\n<h> Add home page');
    const reordered = rebaseInteractive(s, 'main', [
      { action: 'pick', commit: b!.commit },
      { action: 'pick', commit: a!.commit },
    ]);
    expect(log(reordered.state).split('\n').slice(0, 2)).toEqual(['<h> (HEAD -> feature) Write day 7', '<h> Add contact page']);
  });

  it('squash first is refused; conflicts stop like git rebase', () => {
    const s = onFeature();
    const [a] = rebaseTodo(s, 'main');
    expect(rebaseInteractive(s, 'main', [{ action: 'squash', commit: a!.commit }]).explain?.key).toBe('sim.err.rebaseSquashFirst');
    const fix = exec(base(), 'git switch fix').state;
    const [f] = rebaseTodo(fix, 'main');
    const stopped = rebaseInteractive(fix, 'main', [{ action: 'pick', commit: f!.commit }]);
    expect(stopped.stopped).toBe(true);
    expect(repoOf(stopped.state).op?.kind).toBe('rebase');
  });
});

describe('git cherry-pick', () => {
  it('copies a commit with the original author date shown', () => {
    const r = exec(base(), 'git cherry-pick feature~1').last;
    expectOk(r);
    // Both sides touched index.html (at far-apart lines), so Git merges it quietly.
    expect(masked(out(r))).toMatch(/^Auto-merging index.html\n\[main <h>\] Write day 7\n Date: \w{3} \w{3} \d+ [\d:]+ 2026 \+0800\n 1 file changed, 1 insertion\(\+\), 1 deletion\(-\)$/);
    expect(r.events).toContainEqual(expect.objectContaining({ type: 'cherryPicked' }));
  });

  it('an already-applied commit is empty: Git stops and suggests --skip', () => {
    const r = exec(base(), 'git cherry-pick feature~1', 'git cherry-pick feature~1').last;
    expect(r.stopped).toBe(true);
    expect(out(r)).toContain('The previous cherry-pick is now empty, possibly due to conflict resolution.');
    expect(out(exec(r.state, 'git cherry-pick --skip', 'git status').last)).toBe('On branch main\nnothing to commit, working tree clean');
  });

  it('conflict, status, continue and abort', () => {
    const stop = exec(base(), 'git cherry-pick fix').last;
    expect(masked(out(stop))).toBe(
      [
        'Auto-merging index.html',
        'CONFLICT (content): Merge conflict in index.html',
        'error: could not apply <h>... Fix day 1',
        'hint: After resolving the conflicts, mark them with',
        'hint: "git add/rm <pathspec>", then run',
        'hint: "git cherry-pick --continue".',
        'hint: You can instead skip this commit with "git cherry-pick --skip".',
        'hint: To abort and get back to the state before "git cherry-pick",',
        'hint: run "git cherry-pick --abort".',
        'hint: Disable this message with "git config set advice.mergeConflict false"',
      ].join('\n'),
    );
    expect(masked(out(exec(stop.state, 'git status').last))).toContain('You are currently cherry-picking commit <h>.\n  (fix conflicts and run "git cherry-pick --continue")');
    const cont = exec(stop.state, 'echo "<p>both</p>" > index.html', 'git add index.html', 'git cherry-pick --continue').last;
    expect(masked(out(cont)).split('\n')[0]).toBe('[main <h>] Fix day 1');
    const aborted = exec(stop.state, 'git cherry-pick --abort');
    expect(out(exec(aborted.state, 'git status -s').last)).toBe('');
    expect(out(exec(aborted.state, 'git cherry-pick --abort').last)).toBe('error: no cherry-pick or revert in progress\nfatal: cherry-pick failed');
  });

  it('errors: bad revision, dirty tree, merge commits', () => {
    expect(out(exec(base(), 'git cherry-pick nope').last)).toBe("fatal: bad revision 'nope'");
    expect(out(exec(base(), 'echo x >> style.css', 'git cherry-pick fix').last)).toBe(
      'error: your local changes would be overwritten by cherry-pick.\nhint: commit your changes or stash them to proceed.\nfatal: cherry-pick failed',
    );
    const merged = exec(base(), 'git merge --no-ff feature', 'git switch fix', 'git cherry-pick main').last;
    expect(out(merged)).toMatch(/^error: commit [0-9a-f]{40} is a merge but no -m option was given\.\nfatal: cherry-pick failed$/);
  });
});

describe('git tag', () => {
  it('lightweight and annotated tags, show, delete', () => {
    const s = exec(base(), 'git tag v1.0', 'git tag -a v1.1 -m "Version 1.1"').state;
    expect(out(exec(s, 'git tag').last)).toBe('v1.0\nv1.1');
    expect(masked(out(exec(s, 'git log --oneline -1').last))).toBe('<h> (HEAD -> main, tag: v1.1, tag: v1.0) Improve day 1');
    const shown = out(exec(s, 'git show v1.1').last).split('\n');
    expect(shown.slice(0, 5)).toEqual(['tag v1.1', 'Tagger: You <you@example.com>', shown[2], '', 'Version 1.1']);
    expect(shown[2]).toMatch(/^Date: {3}\w{3} /);
    expect(out(exec(s, 'git tag v1.0').last)).toBe("fatal: tag 'v1.0' already exists");
    expect(masked(out(exec(s, 'git tag -d v1.0').last))).toBe("Deleted tag 'v1.0' (was <h>)");
    expect(out(exec(s, 'git tag -d nope').last)).toBe("error: tag 'nope' not found.");
    expect(out(exec(s, 'git tag bad..tag').last)).toBe("fatal: 'bad..tag' is not a valid tag name.");
    expect(exec(s, 'git tag -a v2.0').last.explain?.key).toBe('sim.err.tagNeedMessage');
    expect(out(exec(s, 'git tag x nope').last)).toBe("fatal: Failed to resolve 'nope' as a valid ref.");
  });
});
