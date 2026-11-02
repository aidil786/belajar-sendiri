import { describe, expect, it } from 'vitest';
import { buildScenario, mergeFile, mergeTrees } from '../index';
import { verifyFixtures } from './fixtures';
import { exec, expectFail, expectOk, out, repoOf } from './helpers';

const masked = (s: string) => s.replace(/\b[0-9a-f]{7,40}\b/g, '<h>');
const fx = (id: string) => buildScenario(verifyFixtures.find((s) => s.id === id)!);
const L = (...lines: string[]) => `${lines.join('\n')}\n`;
const labels = { ours: 'HEAD', theirs: 'feature' };

describe('mergeFile (three-way, like Git)', () => {
  const base = L('a', 'b', 'c', 'd', 'e', 'f', 'g');

  it('edits far apart merge cleanly', () => {
    const r = mergeFile(base, L('A', 'b', 'c', 'd', 'e', 'f', 'g'), L('a', 'b', 'c', 'd', 'e', 'f', 'G'), labels);
    expect(r).toEqual({ content: L('A', 'b', 'c', 'd', 'e', 'f', 'G'), conflict: false, conflicts: 0 });
  });

  it('edits on touching lines are a conflict (no unchanged line between them)', () => {
    const r = mergeFile(base, L('A', 'b', 'c', 'd', 'e', 'f', 'g'), L('a', 'B', 'c', 'd', 'e', 'f', 'g'), labels);
    expect(r.conflict).toBe(true);
    expect(r.content).toBe(L('<<<<<<< HEAD', 'A', 'b', '=======', 'a', 'B', '>>>>>>> feature', 'c', 'd', 'e', 'f', 'g'));
  });

  it('the same change on both sides is not a conflict', () => {
    const same = L('a', 'b', 'C', 'd', 'e', 'f', 'g');
    expect(mergeFile(base, same, same, labels).conflict).toBe(false);
  });

  it('identical lines inside a conflict are moved out (zealous refining)', () => {
    const r = mergeFile(base, L('a', 'X', 'c', 'Y', 'e', 'f', 'g'), L('a', 'Z', 'c', 'W', 'e', 'f', 'g'), labels);
    // Two changes 1 line apart on each side join into one conflict block.
    expect(r.conflicts).toBe(1);
    expect(r.content).toBe(L('a', '<<<<<<< HEAD', 'X', 'c', 'Y', '=======', 'Z', 'c', 'W', '>>>>>>> feature', 'e', 'f', 'g'));
  });

  it('add/add with common lines keeps them outside the markers', () => {
    const r = mergeFile('', L('same', 'mine'), L('same', 'theirs'), labels);
    expect(r.content).toBe(L('same', '<<<<<<< HEAD', 'mine', '=======', 'theirs', '>>>>>>> feature'));
  });

  it('mergeTrees reports Auto-merging and CONFLICT lines in path order', () => {
    const res = mergeTrees({ a: base, d: 'x\n' }, { a: L('A', 'b', 'c', 'd', 'e', 'f', 'g'), n: 'one\n', d: 'y\n' }, { a: L('B', 'b', 'c', 'd', 'e', 'f', 'g'), n: 'two\n' }, labels);
    expect(res.messages.map((l) => l.map((s) => s.t).join(''))).toEqual([
      'Auto-merging a',
      'CONFLICT (content): Merge conflict in a',
      'CONFLICT (modify/delete): d deleted in feature and modified in HEAD.  Version HEAD of d left in tree.',
      'Auto-merging n',
      'CONFLICT (add/add): Merge conflict in n',
    ]);
    expect(Object.keys(res.conflicts)).toEqual(['a', 'd', 'n']);
    expect(res.working.d).toBe('y\n');
  });
});

describe('git merge', () => {
  const branches = () => fx('fx-branches');

  it('fast-forward prints Updating, Fast-forward and a diffstat', () => {
    const r = exec(branches(), 'git merge about').last;
    expectOk(r);
    expect(masked(out(r))).toBe(
      ['Updating <h>..<h>', 'Fast-forward', ' about.html | 2 ++', ' 1 file changed, 2 insertions(+)', ' create mode 100644 about.html'].join('\n'),
    );
    expect(r.events).toContainEqual(expect.objectContaining({ type: 'merged', mode: 'fastForward' }));
    expect(out(exec(r.state, 'git merge about').last)).toBe('Already up to date.');
  });

  it('--no-ff makes a merge commit with the default message', () => {
    const r = exec(branches(), 'git merge --no-ff about');
    expect(out(r.last)).toBe(["Merge made by the 'ort' strategy.", ' about.html | 2 ++', ' 1 file changed, 2 insertions(+)', ' create mode 100644 about.html'].join('\n'));
    const head = repoOf(r.state).branches.main!;
    expect(repoOf(r.state).commits[head]!.message).toBe("Merge branch 'about'");
    expect(masked(out(exec(r.state, 'git log --oneline --graph').last))).toBe(
      ['*   <h> (HEAD -> main) Merge branch \'about\'', '|\\  ', '| * <h> (about) Say what I like', '| * <h> Add about page', '|/  ', '* <h> Add home page'].join('\n'),
    );
  });

  it('merging into another branch adds "into <branch>"', () => {
    const s = exec(branches(), 'git switch about', 'echo "x" >> about.html', 'git commit -am "More"', 'git switch main', 'echo "h1{}" >> style.css', 'git commit -am "Style"', 'git switch about', 'git merge main').state;
    const r = repoOf(s);
    expect(r.commits[r.branches.about!]!.message).toBe("Merge branch 'main' into about");
  });

  it('--ff-only refuses diverged branches with the hint', () => {
    const r = exec(branches(), 'echo "h1{}" >> style.css', 'git commit -am "Style"', 'git merge --ff-only about').last;
    expectFail(r, 'notFastForward');
    expect(out(r)).toContain('fatal: Not possible to fast-forward, aborting.');
    // A plain merge works: three-way, no conflict.
    const m = exec(branches(), 'echo "h1{}" >> style.css', 'git commit -am "Style"', 'git merge about').last;
    expect(out(m)).toBe(["Merge made by the 'ort' strategy.", ' about.html | 2 ++', ' 1 file changed, 2 insertions(+)', ' create mode 100644 about.html'].join('\n'));
  });

  it('unknown names and unborn errors', () => {
    expect(out(exec(branches(), 'git merge nope').last)).toBe('merge: nope - not something we can merge');
    expect(out(exec(branches(), 'git merge').last)).toBe('fatal: No remote for the current branch.');
  });
});

describe('merge conflicts', () => {
  const conflict = () => exec(fx('fx-conflicts'), 'git merge feature');

  it('stops with conflict lines, keeps markers, and is "stopped" (not a mistake)', () => {
    const r = conflict().last;
    expect(r.ok).toBe(false);
    expect(r.stopped).toBe(true);
    expect(out(r)).toBe(
      [
        'Auto-merging index.html',
        'CONFLICT (content): Merge conflict in index.html',
        'Auto-merging new.txt',
        'CONFLICT (add/add): Merge conflict in new.txt',
        'CONFLICT (modify/delete): style.css deleted in feature and modified in HEAD.  Version HEAD of style.css left in tree.',
        'Automatic merge failed; fix conflicts and then commit the result.',
      ].join('\n'),
    );
    expect(r.state.fs.files['/home/you/diary/index.html']).toContain('<<<<<<< HEAD\n<p>Day 2: main</p>\n=======\n<p>Day 2: feature</p>\n>>>>>>> feature\n');
    expect(r.events).toContainEqual({ type: 'conflict', op: 'merge', paths: ['index.html', 'new.txt', 'style.css'] });
  });

  it('status shows unmerged paths like Git', () => {
    const s = conflict().state;
    expect(out(exec(s, 'git status').last)).toBe(
      [
        'On branch main',
        'You have unmerged paths.',
        '  (fix conflicts and run "git commit")',
        '  (use "git merge --abort" to abort the merge)',
        '',
        'Unmerged paths:',
        '  (use "git add/rm <file>..." as appropriate to mark resolution)',
        '\tboth modified:   index.html',
        '\tboth added:      new.txt',
        '\tdeleted by them: style.css',
        '',
        'no changes added to commit (use "git add" and/or "git commit -a")',
      ].join('\n'),
    );
    expect(out(exec(s, 'git status -s').last)).toBe('UU index.html\nAA new.txt\nUD style.css');
  });

  it('git diff shows a combined diff', () => {
    const d = out(exec(conflict().state, 'git diff').last);
    expect(masked(d)).toContain(
      [
        'diff --cc index.html',
        'index <h>,<h>..<h>',
        '--- a/index.html',
        '+++ b/index.html',
        '@@@ -1,6 -1,6 +1,10 @@@',
        '  <h1>My Diary</h1>',
        '  <p>Day 1</p>',
        '++<<<<<<< HEAD',
        ' +<p>Day 2: main</p>',
        '++=======',
        '+ <p>Day 2: feature</p>',
        '++>>>>>>> feature',
        '  <p>Day 3</p>',
      ].join('\n'),
    );
    expect(d).toContain('index ');
    expect(d.split('\n')[1]).toMatch(/\.\.0000000$/);
    expect(d).toContain('* Unmerged path style.css');
  });

  it('commit refuses while unresolved; add/rm resolve; commit uses the default message', () => {
    const s = conflict().state;
    const refused = exec(s, 'git commit -m "Try"').last;
    expect(out(refused)).toBe(
      [
        'U\tindex.html',
        'U\tnew.txt',
        'U\tstyle.css',
        'error: Committing is not possible because you have unmerged files.',
        "hint: Fix them up in the work tree, and then use 'git add/rm <file>'",
        'hint: as appropriate to mark resolution and make a commit.',
        'fatal: Exiting because of an unresolved conflict.',
      ].join('\n'),
    );
    const fixed = exec(s, 'echo "<h1>My Diary</h1>" > index.html', 'git add index.html', 'git add new.txt', 'git rm style.css');
    expect(fixed.all[1]!.explain?.key).toBe('sim.explain.addResolvedSome');
    expect(fixed.all[2]!.explain?.key).toBe('sim.explain.addResolvedMarkers');
    expect(out(exec(fixed.state, 'git status').last)).toBe(
      [
        'On branch main',
        'All conflicts fixed but you are still merging.',
        '  (use "git commit" to conclude merge)',
        '',
        'Changes to be committed:',
        '\tmodified:   index.html',
        '\tmodified:   new.txt',
        '\tdeleted:    style.css',
        '',
      ].join('\n'),
    );
    const done = exec(fixed.state, 'git commit').last;
    expectOk(done);
    expect(masked(out(done))).toBe("[main <h>] Merge branch 'feature'");
    expect(done.explain).toEqual({ key: 'sim.explain.mergeCommitDefault', params: { message: "Merge branch 'feature'", hash: expect.any(String) } });
    const repo = repoOf(done.state);
    expect(repo.commits[repo.branches.main!]!.parents).toHaveLength(2);
    expect(repo.op).toBeNull();
  });

  it('--abort goes back; --continue needs a merge; merging again is refused', () => {
    const s = conflict().state;
    const a = exec(s, 'git merge --abort');
    expectOk(a.last);
    expect(out(exec(a.state, 'git status').last)).toBe('On branch main\nnothing to commit, working tree clean');
    expect(out(exec(a.state, 'git merge --abort').last)).toBe('fatal: There is no merge to abort (MERGE_HEAD missing).');
    expect(out(exec(a.state, 'git merge --continue').last)).toBe('fatal: There is no merge in progress (MERGE_HEAD missing).');
    expect(out(exec(s, 'git merge feature').last)).toContain('error: Merging is not possible because you have unmerged files.');
    const c = exec(s, 'git add .', 'git merge --continue').last;
    expect(masked(out(c))).toBe("[main <h>] Merge branch 'feature'");
  });

  it('restore/checkout refuse unmerged paths; switch refuses mid-merge; reset --hard ends it', () => {
    const s = conflict().state;
    expect(out(exec(s, 'git checkout -- index.html').last)).toBe("error: path 'index.html' is unmerged");
    expect(out(exec(s, 'git restore index.html').last)).toBe("error: path 'index.html' is unmerged");
    expect(out(exec(s, 'git switch feature').last)).toBe('fatal: cannot switch branch while merging\nConsider "git merge --quit" or "git worktree add".');
    const r = exec(s, 'git reset --hard');
    expect(repoOf(r.state).op).toBeNull();
    expect(out(exec(r.state, 'git status -s').last)).toBe('');
  });

  it('local changes in a file the merge needs block it', () => {
    const r = exec(fx('fx-conflicts'), 'echo "local" >> index.html', 'git merge feature').last;
    expect(out(r)).toBe(
      'error: Your local changes to the following files would be overwritten by merge:\n\tindex.html\nPlease commit your changes or stash them before you merge.\nAborting\nMerge with strategy ort failed.',
    );
  });
});
