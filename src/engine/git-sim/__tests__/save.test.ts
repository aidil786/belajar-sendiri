import { describe, expect, it } from 'vitest';
import { buildScenario } from '../index';
import { exec, expectFail, expectOk, fresh, oneCommit, out, repoOf } from './helpers';

const newRepo = () => exec(fresh('/home/you/diary'), 'git init').state;

describe('git status', () => {
  it('empty repo', () => {
    expect(out(exec(newRepo(), 'git status').last)).toBe(
      'On branch main\n\nNo commits yet\n\nnothing to commit (create/copy files and use "git add" to track)',
    );
  });

  it('untracked files before the first commit', () => {
    const r = exec(newRepo(), 'touch index.html', 'touch style.css', 'git status');
    expect(out(r.last)).toBe(
      [
        'On branch main',
        '',
        'No commits yet',
        '',
        'Untracked files:',
        '  (use "git add <file>..." to include in what will be committed)',
        '\tindex.html',
        '\tstyle.css',
        '',
        'nothing added to commit but untracked files present (use "git add" to track)',
      ].join('\n'),
    );
  });

  it('staged before first commit uses "git rm --cached" hint and green', () => {
    const r = exec(newRepo(), 'touch index.html', 'git add index.html', 'git status');
    expect(out(r.last)).toContain('  (use "git rm --cached <file>..." to unstage)\n\tnew file:   index.html');
    const fileLine = r.last.output.find((l) => l.some((s) => s.t.includes('new file:')));
    expect(fileLine?.[1]?.c).toBe('green');
  });

  it('staged, unstaged and untracked together', () => {
    const r = exec(
      oneCommit(),
      'echo "<p>Hi</p>" >> index.html',
      'echo "body {}" > style.css',
      'git add style.css',
      'echo "todo" > notes.txt',
      'git status',
    );
    expect(out(r.last)).toBe(
      [
        'On branch main',
        'Changes to be committed:',
        '  (use "git restore --staged <file>..." to unstage)',
        '\tnew file:   style.css',
        '',
        'Changes not staged for commit:',
        '  (use "git add <file>..." to update what will be committed)',
        '  (use "git restore <file>..." to discard changes in working directory)',
        '\tmodified:   index.html',
        '',
        'Untracked files:',
        '  (use "git add <file>..." to include in what will be committed)',
        '\tnotes.txt',
        '',
      ].join('\n'),
    );
    expect(out(exec(r.state, 'git status -s').last)).toBe(' M index.html\nA  style.css\n?? notes.txt');
  });

  it('clean tree', () => {
    expect(out(exec(oneCommit(), 'git status').last)).toBe('On branch main\nnothing to commit, working tree clean');
    expect(exec(oneCommit(), 'git status').last.explain?.key).toBe('sim.explain.statusClean');
  });

  it('deleted files use the add/rm hint; short shows D', () => {
    const r = exec(oneCommit(), 'rm index.html', 'git status');
    expect(out(r.last)).toContain('(use "git add/rm <file>..." to update what will be committed)');
    expect(out(r.last)).toContain('\tdeleted:    index.html');
    expect(out(exec(r.state, 'git status -s').last)).toBe(' D index.html');
  });

  it('MM when staged and changed again', () => {
    const r = exec(oneCommit(), 'echo a >> index.html', 'git add .', 'echo b >> index.html', 'git status -s');
    expect(out(r.last)).toBe('MM index.html');
  });

  it('-sb shows the branch; bad option fails', () => {
    expect(out(exec(oneCommit(), 'git status -sb').last)).toBe('## main');
    expectFail(exec(oneCommit(), 'git status --porcelain=v9').last, 'badOption');
  });

  it('untracked folders collapse to folder/', () => {
    const r = exec(newRepo(), 'mkdir build', 'touch build/a.js', 'touch build/b.js', 'git status -s');
    expect(out(r.last)).toBe('?? build/');
  });

  it('ignored files are hidden', () => {
    const r = exec(newRepo(), 'echo "*.log" > .gitignore', 'touch debug.log', 'git status -s');
    expect(out(r.last)).toBe('?? .gitignore');
  });
});

describe('git add', () => {
  it('stages one file', () => {
    const r = exec(newRepo(), 'touch index.html', 'touch style.css', 'git add index.html');
    expectOk(r.last);
    expect(repoOf(r.state).index).toEqual({ 'index.html': '' });
    expect(r.last.events).toEqual([{ type: 'fileStaged', path: 'index.html' }]);
    expect(r.last.explain).toEqual({ key: 'sim.explain.addOne', params: { file: 'index.html', count: '1' } });
  });

  it('git add . stages everything under the folder, including deletions', () => {
    const r = exec(oneCommit(), 'rm index.html', 'touch a.txt', 'git add .', 'git status -s');
    expect(out(r.last)).toBe('A  a.txt\nD  index.html');
  });

  it('-A from a subfolder stages the whole repo; . only the subfolder', () => {
    const base = exec(newRepo(), 'mkdir css', 'touch css/a.css', 'touch b.txt', 'cd css').state;
    expect(Object.keys(repoOf(exec(base, 'git add .').state).index)).toEqual(['css/a.css']);
    expect(Object.keys(repoOf(exec(base, 'git add -A').state).index).sort()).toEqual(['b.txt', 'css/a.css']);
  });

  it('-u only stages tracked files', () => {
    const r = exec(oneCommit(), 'echo x >> index.html', 'touch new.txt', 'git add -u', 'git status -s');
    expect(out(r.last)).toBe('M  index.html\n?? new.txt');
  });

  it('--renormalize works like -u (the simulator keeps LF endings already)', () => {
    const r = exec(oneCommit(), 'echo x >> index.html', 'touch new.txt', 'git add --renormalize .', 'git status -s');
    expect(out(r.last)).toBe('M  index.html\n?? new.txt');
    expectOk(exec(oneCommit(), 'git add --renormalize .').last);
  });

  it('glob pathspec', () => {
    const r = exec(newRepo(), 'touch a.html', 'touch b.html', 'touch c.css', 'git add *.html', 'git status -s');
    expect(out(r.last)).toBe('A  a.html\nA  b.html\n?? c.css');
  });

  it('nothing specified', () => {
    const r = exec(newRepo(), 'git add').last;
    expectFail(r, 'nothingSpecified');
    expect(out(r)).toContain("Maybe you wanted to say 'git add .'?");
  });

  it('missing path fails with pathspec error', () => {
    const r = exec(newRepo(), 'git add nope.txt').last;
    expectFail(r, 'pathspecNoMatch');
    expect(out(r)).toBe("fatal: pathspec 'nope.txt' did not match any files");
    expect(r.explain?.params?.path).toBe('nope.txt');
  });

  it('naming an ignored file warns; -f forces', () => {
    const base = exec(newRepo(), 'echo ".env" > .gitignore', 'echo "KEY=1" > .env').state;
    const r = exec(base, 'git add .env').last;
    expectFail(r, 'ignored');
    expect(out(r)).toContain('The following paths are ignored by one of your .gitignore files:\n.env');
    expect(repoOf(exec(base, 'git add .').state).index['.env']).toBeUndefined();
    expect(repoOf(exec(base, 'git add -f .env').state).index['.env']).toBe('KEY=1\n');
  });

  it('outside the repo fails', () => {
    expectFail(exec(newRepo(), 'git add /home/you/x').last, 'outsideRepo');
  });

  it('unknown option fails', () => {
    expectFail(exec(newRepo(), 'git add --wat').last, 'badOption');
  });

  it('-v lists added files', () => {
    expect(out(exec(newRepo(), 'touch a', 'git add -v a').last)).toBe("add 'a'");
  });
});

describe('git add -p (simplified)', () => {
  const twoHunks = () =>
    buildScenario({
      id: 'p',
      steps: [
        'mkdir diary',
        'cd diary',
        'git init',
        { write: 'page.txt', content: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'].join('\n') + '\n' },
        'git add .',
        'git commit -m "Add page"',
        { write: 'page.txt', content: ['ONE', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', 'TWELVE'].join('\n') + '\n' },
      ],
    });

  it('asks per hunk and stages only accepted ones', () => {
    const r1 = exec(twoHunks(), 'git add -p');
    expect(r1.last.prompt).toBe('(1/2) Stage this hunk [y,n,q,a,d,?]? ');
    expect(out(r1.last)).toContain('-1\n+ONE');
    const r2 = exec(r1.state, 'y');
    expect(r2.last.prompt).toBe('(2/2) Stage this hunk [y,n,q,a,d,?]? ');
    // The file header shows once per file, like Git.
    expect(out(r2.last)).not.toContain('diff --git');
    expect(exec(r1.state, 'n').last.prompt).toBe('(2/2) Stage this hunk [y,n,q,a,d,?]? ');
    const r3 = exec(r2.state, 'n');
    expect(r3.state.pending).toBeNull();
    expect(repoOf(r3.state).index['page.txt']).toContain('ONE\n2');
    expect(repoOf(r3.state).index['page.txt']).toContain('11\n12\n');
    expect(out(exec(r3.state, 'git status -s').last)).toBe('MM page.txt');
  });

  it('q stops, a takes the rest, ? shows help', () => {
    const s = exec(twoHunks(), 'git add -p').state;
    expect(exec(s, 'q').state.pending).toBeNull();
    expect(repoOf(exec(s, 'q').state).index['page.txt']).toContain('1\n2');
    const all = exec(s, 'a').state;
    expect(repoOf(all).index['page.txt']).toContain('TWELVE');
    const help = exec(s, '?').last;
    expect(out(help)).toContain('y - stage this hunk');
    expect(help.prompt).toContain('Stage this hunk');
    expect(exec(s, 'd').state.pending).toBeNull();
  });

  it('no changes', () => {
    expect(out(exec(oneCommit(), 'git add -p').last)).toBe('No changes.');
  });
});

describe('git commit', () => {
  it('first commit is a root commit', () => {
    const r = exec(newRepo(), 'echo "<h1>Hi</h1>" > index.html', 'git add index.html', 'git commit -m "Add home page"');
    expectOk(r.last);
    const lines = out(r.last).split('\n');
    expect(lines[0]).toMatch(/^\[main \(root-commit\) [0-9a-f]{7}\] Add home page$/);
    expect(lines[1]).toBe(' 1 file changed, 1 insertion(+)');
    expect(lines[2]).toBe(' create mode 100644 index.html');
    const repo = repoOf(r.state);
    const id = repo.branches.main!;
    expect(repo.commits[id]).toMatchObject({ parents: [], message: 'Add home page', author: { name: 'You', email: 'you@example.com' } });
    expect(repo.reflog[0]).toEqual({ commit: id, message: 'commit (initial): Add home page' });
    expect(r.last.events.map((e) => e.type)).toEqual(['commitCreated', 'branchMoved', 'headMoved']);
  });

  it('second commit links to its parent and counts changes', () => {
    const r = exec(oneCommit(), 'echo "<p>a</p>" >> index.html', 'echo x > b.txt', 'git add .', 'git commit -m "More"');
    const repo = repoOf(r.state);
    const c = repo.commits[repo.branches.main!]!;
    expect(c.parents).toHaveLength(1);
    expect(out(r.last).split('\n').slice(1)).toEqual([' 2 files changed, 2 insertions(+)', ' create mode 100644 b.txt']);
  });

  it('only what is staged gets saved', () => {
    const r = exec(oneCommit(), 'echo a > a.txt', 'echo b > b.txt', 'git add a.txt', 'git commit -m "Add a"');
    const repo = repoOf(r.state);
    expect(Object.keys(repo.commits[repo.branches.main!]!.snapshot).sort()).toEqual(['a.txt', 'index.html']);
    expect(out(exec(r.state, 'git status -s').last)).toBe('?? b.txt');
  });

  it('deletions and empty files are counted like Git', () => {
    const del = exec(oneCommit(), 'git rm index.html', 'git commit -m "Remove"');
    expect(out(del.last).split('\n').slice(1)).toEqual([' 1 file changed, 1 deletion(-)', ' delete mode 100644 index.html']);
    const empty = exec(oneCommit(), 'touch e.txt', 'git add e.txt', 'git commit -m "Empty"');
    expect(out(empty.last).split('\n')[1]).toBe(' 1 file changed, 0 insertions(+), 0 deletions(-)');
  });

  it('nothing staged shows the status and fails kindly', () => {
    const r = exec(oneCommit(), 'echo x >> index.html', 'git commit -m "x"').last;
    expectFail(r, 'nothingToCommit');
    expect(out(r)).toContain('no changes added to commit (use "git add" and/or "git commit -a")');
    expect(r.explain?.key).toBe('sim.err.nothingStaged');
    const clean = exec(oneCommit(), 'git commit -m "x"').last;
    expect(out(clean)).toContain('nothing to commit, working tree clean');
    expect(clean.explain?.key).toBe('sim.err.nothingToCommit');
  });

  it('needs a message (no editor here) and rejects empty messages', () => {
    const base = exec(newRepo(), 'touch a', 'git add a').state;
    expect(exec(base, 'git commit').last.explain?.key).toBe('sim.err.needMessage');
    expectFail(exec(base, 'git commit -m ""').last, 'emptyMessage');
  });

  it('several -m flags become paragraphs', () => {
    const r = exec(newRepo(), 'touch a', 'git add a', 'git commit -m "Title" -m "Body text"');
    const repo = repoOf(r.state);
    expect(repo.commits[repo.branches.main!]!.message).toBe('Title\n\nBody text');
  });

  it('-am stages tracked changes first (not untracked)', () => {
    const r = exec(oneCommit(), 'echo x >> index.html', 'touch new.txt', 'git commit -am "Update home"', 'git status -s');
    expect(out(r.last)).toBe('?? new.txt');
    expect(out(exec(oneCommit(), 'echo x >> index.html', 'git commit -a -m "Update"').last)).toMatch(/^\[main [0-9a-f]{7}\] Update/);
  });

  it('asks who you are when identity is missing', () => {
    const s = buildScenario({ id: 't', config: { 'init.defaultBranch': 'main' }, steps: ['mkdir p', 'cd p', 'git init', 'touch a', 'git add a'] });
    const r = exec(s, 'git commit -m "x"').last;
    expectFail(r, 'noIdentity');
    expect(out(r)).toContain('*** Please tell me who you are.');
    expect(out(r)).toContain('git config --global user.email "you@example.com"');
  });

  it('--amend replaces the last commit (message and files)', () => {
    const base = oneCommit();
    const oldId = repoOf(base).branches.main!;
    const r = exec(base, 'touch forgot.txt', 'git add forgot.txt', 'git commit --amend -m "Add home page and notes"');
    expectOk(r.last);
    const repo = repoOf(r.state);
    const c = repo.commits[repo.branches.main!]!;
    expect(c.id).not.toBe(oldId);
    expect(c.parents).toEqual([]);
    expect(c.message).toBe('Add home page and notes');
    expect(Object.keys(c.snapshot).sort()).toEqual(['forgot.txt', 'index.html']);
    expect(out(r.last).split('\n')[1]).toMatch(/^ Date: Fri Oct 30 /);
    expect(repo.reflog[0]?.message).toBe('commit (amend): Add home page and notes');
    expect(out(exec(r.state, 'git log --oneline').last).split('\n')).toHaveLength(1);
  });

  it('--amend --no-edit keeps the message', () => {
    const r = exec(oneCommit(), 'touch b', 'git add b', 'git commit --amend --no-edit');
    const repo = repoOf(r.state);
    expect(repo.commits[repo.branches.main!]!.message).toBe('Add home page');
  });

  it('--amend with no commits fails', () => {
    expectFail(exec(newRepo(), 'git commit --amend -m x').last, 'nothingToAmend');
  });

  it('commit while detached says "detached HEAD"', () => {
    const base = exec(oneCommit(), 'echo 2 >> index.html', 'git commit -am "Two"', 'git checkout HEAD~1').state;
    const r = exec(base, 'touch t', 'git add t', 'git commit -m "Try"');
    expect(out(r.last)).toMatch(/^\[detached HEAD [0-9a-f]{7}\] Try/);
    expect(out(exec(r.state, 'git status').last).split('\n')[0]).toMatch(/^HEAD detached from [0-9a-f]{7}$/);
  });
});

describe('git rm', () => {
  it('removes from folder and box', () => {
    const r = exec(oneCommit(), 'git rm index.html');
    expect(out(r.last)).toBe("rm 'index.html'");
    expect(r.state.fs.files['/home/you/diary/index.html']).toBeUndefined();
    expect(out(exec(r.state, 'git status -s').last)).toBe('D  index.html');
  });

  it('--cached keeps the file but stops tracking it', () => {
    const r = exec(oneCommit(), 'git rm --cached index.html', 'git status -s');
    expect(out(r.last)).toBe('D  index.html\n?? index.html');
  });

  it('refuses when there are local or staged changes', () => {
    const local = exec(oneCommit(), 'echo x >> index.html', 'git rm index.html').last;
    expectFail(local, 'rmLocal');
    expect(out(local)).toBe(
      'error: the following file has local modifications:\n    index.html\n(use --cached to keep the file, or -f to force removal)',
    );
    expectFail(exec(oneCommit(), 'echo x >> index.html', 'git add .', 'git rm index.html').last, 'rmStaged');
    expectOk(exec(oneCommit(), 'echo x >> index.html', 'git rm -f index.html').last);
  });

  it('pathspec errors and folders need -r', () => {
    expect(out(exec(oneCommit(), 'git rm nope.txt').last)).toBe("fatal: pathspec 'nope.txt' did not match any files");
    const base = exec(oneCommit(), 'mkdir css', 'touch css/a.css', 'git add .', 'git commit -m css').state;
    expectFail(exec(base, 'git rm css').last, 'needR');
    expectOk(exec(base, 'git rm -r css').last);
    expectFail(exec(oneCommit(), 'git rm').last, 'usage');
  });
});

describe('git mv', () => {
  it('renames and status shows R', () => {
    const r = exec(oneCommit(), 'git mv index.html home.html', 'git status -s');
    expect(out(r.last)).toBe('R  index.html -> home.html');
    expect(r.all[0]!.events).toEqual([{ type: 'fileMoved', from: 'index.html', to: 'home.html' }]);
    const commit = exec(r.state, 'git commit -m "Rename"').last;
    expect(out(commit).split('\n').slice(1)).toEqual([' 1 file changed, 0 insertions(+), 0 deletions(-)', ' rename index.html => home.html (100%)']);
  });

  it('moves into a folder', () => {
    const r = exec(oneCommit(), 'mkdir pages', 'git mv index.html pages', 'git status -s');
    expect(out(r.last)).toBe('R  index.html -> pages/index.html');
  });

  it('errors match Git', () => {
    expect(out(exec(oneCommit(), 'git mv nope.txt x.txt').last)).toBe('fatal: bad source, source=nope.txt, destination=x.txt');
    expect(out(exec(oneCommit(), 'touch z.txt', 'git mv z.txt q.txt').last)).toBe(
      'fatal: not under version control, source=z.txt, destination=q.txt',
    );
    expect(out(exec(oneCommit(), 'touch b.txt', 'git mv index.html b.txt').last)).toBe(
      'fatal: destination exists, source=index.html, destination=b.txt',
    );
    expectFail(exec(oneCommit(), 'git mv index.html').last, 'usage');
  });
});
