// World 10 (Deep Git): objects and real hashes, refs and the .git view, history search,
// bisect, aliases, worktrees and the commands the terminal explains instead of running.
// Every expected id below was checked against real Git (see `npm run verify:commands`).
import { describe, expect, it } from 'vitest';
import { getScenario } from '../../../content/courses/git/scenarios/index';
import {
  bisectInfo,
  bisectPick,
  buildScenario,
  checkGoal,
  estimateSteps,
  findRepo,
  objectStore,
  resolveObject,
  run,
  worktreePaths,
  type SimState,
} from '../index';
import { exec, expectFail, expectOk, out } from './helpers';

const scene = (id: string): SimState => buildScenario(getScenario(id));

/** The t2 probe repo: index.html (6 lines) and src/app.js, seven commits. */
function probe(): SimState {
  const steps = ['mkdir d', 'cd d', 'git init', 'echo "<h1>Shop</h1>" > index.html', 'git add .', 'git commit -m "Add home page"'];
  const more: [string, string][] = [
    ['<p>Price: 10</p>', 'Add price'],
    ['<p>Buy now</p>', 'Add buy button'],
    ['<footer>BUG</footer>', 'Add footer'],
    ['<p>Contact</p>', 'Add contact line'],
    ['<p>Hours</p>', 'Add opening hours'],
  ];
  for (const [l, m] of more) steps.push(`echo "${l}" >> index.html`, `git commit -am "${m}"`);
  steps.push('mkdir src', 'echo "x" > src/app.js', 'git add .', 'git commit -m "Add app"');
  return buildScenario({ id: 'probe', steps });
}

describe('objects and real SHA-1 ids', () => {
  it('commit, tree and blob ids match real Git', () => {
    const s = probe();
    expect(out(exec(s, 'git rev-parse HEAD').last)).toBe('2072271a2f36746b3a88b1540442777b276410b4');
    expect(out(exec(s, 'git rev-parse HEAD^{tree}').last)).toBe('67efdfe3ab0bfd7e96e85624e2616b3247685b0e');
    expect(out(exec(s, 'git rev-parse HEAD:index.html').last)).toBe('762e794dabead95ca3b72d808f92843ad1571056');
    expect(out(exec(s, 'git hash-object index.html').last)).toBe('762e794dabead95ca3b72d808f92843ad1571056');
  });

  it('cat-file -t, -s and -p show commits, trees and blobs', () => {
    const s = probe();
    expect(out(exec(s, 'git cat-file -t HEAD').last)).toBe('commit');
    expect(out(exec(s, 'git cat-file -s HEAD').last)).toBe('198');
    expect(out(exec(s, 'git cat-file -p HEAD').last)).toBe(
      [
        'tree 67efdfe3ab0bfd7e96e85624e2616b3247685b0e',
        'parent bd05d29bd2f010d0fec5115166e79f1077ab83b7',
        'author You <you@example.com> 1793322420 +0800',
        'committer You <you@example.com> 1793322420 +0800',
        '',
        'Add app',
      ].join('\n'),
    );
    expect(out(exec(s, 'git cat-file -p HEAD^{tree}').last)).toBe(
      '100644 blob 762e794dabead95ca3b72d808f92843ad1571056\tindex.html\n040000 tree 64a6982aa8abe91af57e7ca917a88578f42260aa\tsrc',
    );
    expect(out(exec(s, 'git cat-file -t HEAD:src').last)).toBe('tree');
    expect(out(exec(s, 'git cat-file -p HEAD:src/app.js').last)).toBe('x');
    const bad = exec(s, 'git cat-file -p nope').last;
    expectFail(bad, 'badObject');
    expect(out(bad)).toBe('fatal: Not a valid object name nope');
    expect(exec(s, 'git cat-file -e HEAD').last.ok).toBe(true);
    expect(exec(s, 'git cat-file -e 1234567').last.ok).toBe(false);
  });

  it('annotated tags are objects of their own', () => {
    const s = scene('w10-objects');
    expect(out(exec(s, 'git cat-file -t v1.0').last)).toBe('tag');
    const text = out(exec(s, 'git cat-file -p v1.0').last).split('\n');
    expect(text[1]).toBe('type commit');
    expect(text[2]).toBe('tag v1.0');
    expect(text.at(-1)).toBe('First shop release');
    const tagId = out(exec(s, 'git rev-parse v1.0').last);
    const peeled = out(exec(s, 'git rev-parse v1.0^{}').last);
    expect(tagId).not.toBe(peeled);
    expect(text[0]).toBe(`object ${peeled}`);
  });

  it('hash-object -w writes a blob that cat-file can read', () => {
    const s = exec(scene('w10-objects'), 'echo "Kuih lapis" > notes.txt').state;
    expect(exec(s, 'git cat-file -p 17e284d').last.ok).toBe(false);
    const w = exec(s, 'git hash-object -w notes.txt');
    expect(out(w.last)).toBe('17e284d888921eb1ed9c4f71bb4fad2fcc068a05');
    expect(w.last.events).toContainEqual({ type: 'objectWritten', id: '17e284d888921eb1ed9c4f71bb4fad2fcc068a05', kind: 'blob' });
    expect(out(exec(w.state, 'git cat-file -p 17e284d').last)).toBe('Kuih lapis');
    expect(checkGoal(w.state, { objectsWritten: ['17e284d'] }).ok).toBe(true);
    expectFail(exec(s, 'git hash-object nope.txt').last, 'noSuchPath');
  });

  it('ls-tree lists one tree, or everything with -r', () => {
    const s = scene('w10-objects');
    expect(out(exec(s, 'git ls-tree --name-only HEAD').last)).toBe('about.html\ncss\nindex.html');
    expect(out(exec(s, 'git ls-tree -r --name-only HEAD').last)).toBe('about.html\ncss/style.css\nindex.html');
    expect(out(exec(s, 'git ls-tree HEAD css').last)).toMatch(/^040000 tree [0-9a-f]{40}\tcss$/);
    expect(out(exec(s, 'git ls-tree HEAD css/').last)).toMatch(/^100644 blob [0-9a-f]{40}\tcss\/style\.css$/);
    expect(out(exec(s, 'git ls-tree -l HEAD').last).split('\n')[0]).toMatch(/^100644 blob [0-9a-f]{40} {6}\d\d\tabout\.html$/);
  });

  it('the object store has every commit, tree, blob and tag', () => {
    const s = scene('w10-objects');
    const repo = findRepo(s)!;
    const store = objectStore(repo);
    const types = [...store.values()].map((o) => o.type);
    expect(types.filter((t) => t === 'commit')).toHaveLength(3);
    expect(types.filter((t) => t === 'tag')).toHaveLength(1);
    const res = resolveObject(repo, 'HEAD:css/style.css');
    expect(res.ok && res.obj.type).toBe('blob');
  });
});

describe('refs and the .git folder', () => {
  it('rev-parse knows names, ranges and folders', () => {
    const s = probe();
    expect(out(exec(s, 'git rev-parse --short HEAD').last)).toBe('2072271');
    expect(out(exec(s, 'git rev-parse --abbrev-ref HEAD').last)).toBe('main');
    expect(out(exec(s, 'git rev-parse --show-toplevel').last)).toBe('/home/you/d');
    expect(out(exec(s, 'git rev-parse --git-dir').last)).toBe('.git');
    expect(out(exec(s, 'git rev-parse HEAD~2..HEAD').last)).toBe('2072271a2f36746b3a88b1540442777b276410b4\n^e8d8f4c80fd11e9d185ed3a6ba2833363000c114');
    const nope = exec(s, 'git rev-parse nope').last;
    expect(out(nope).split('\n')[0]).toBe('nope');
    expectFail(nope, 'badRevision');
    const sub = exec(s, 'cd src', 'git rev-parse --git-dir', 'git rev-parse --show-prefix');
    expect(out(sub.all[1]!)).toBe('/home/you/d/.git');
    expect(out(sub.all[2]!)).toBe('src/');
  });

  it('show-ref lists refs; cat .git/HEAD and refs show their text', () => {
    const s = scene('w10-objects');
    const refs = out(exec(s, 'git show-ref').last).split('\n');
    expect(refs.map((l) => l.split(' ')[1])).toEqual(['refs/heads/main', 'refs/tags/v1.0']);
    expect(out(exec(s, 'cat .git/HEAD').last)).toBe('ref: refs/heads/main');
    const main = out(exec(s, 'git rev-parse main').last);
    expect(out(exec(s, 'cat .git/refs/heads/main').last)).toBe(main);
    expect(out(exec(s, 'ls .git/refs').last)).toBe('heads  tags');
    expect(out(exec(s, 'ls .git/refs/heads').last)).toBe('main');
    const detached = exec(s, 'git switch --detach HEAD~1', 'cat .git/HEAD').last;
    expect(out(detached)).toMatch(/^[0-9a-f]{40}$/);
    expectFail(exec(s, 'cat .git/MERGE_HEAD').last, 'noSuchPath');
    expectFail(exec(s, 'ls .git').last, 'dotGitList');
  });

  it('pack-refs --all moves refs into packed-refs; a new commit writes a loose ref again', () => {
    const r = exec(scene('w10-objects'), 'git pack-refs --all', 'cat .git/packed-refs', 'cat .git/refs/heads/main');
    expect(out(r.all[1]!).split('\n')[0]).toBe('# pack-refs with: peeled fully-peeled sorted ');
    expect(out(r.all[1]!)).toMatch(/ refs\/heads\/main\n[0-9a-f]{40} refs\/tags\/v1\.0\n\^[0-9a-f]{40}$/);
    expectFail(r.all[2]!, 'noSuchPath');
    expect(checkGoal(r.state, { packedRefs: ['refs/heads/main'] }).ok).toBe(true);
    const after = exec(r.state, 'echo x >> about.html', 'git commit -am "More"', 'cat .git/refs/heads/main');
    expect(out(after.last)).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe('history search', () => {
  it('log -S, -G, --author and --grep find the right commits', () => {
    const s = scene('w10-search');
    const subjects = (cmd: string) => out(exec(s, cmd).last).split('\n').map((l) => l.replace(/^[0-9a-f]{7} (\(HEAD -> main\) )?/, ''));
    expect(subjects('git log -S "TODO" --oneline')).toEqual(['Fix the footer phone', 'Add a footer']);
    expect(subjects('git log -S "RM10" --oneline')).toEqual(['Add the price']);
    expect(subjects('git log -G "phone|Call" --oneline')).toEqual(['Fix the footer phone', 'Add a footer']);
    expect(subjects('git log --author=Ben --oneline')).toEqual(['Style the footer', 'Add a footer']);
    expect(subjects('git log --grep=FOOTER -i --oneline')).toEqual(['Fix the footer phone', 'Style the footer', 'Add a footer']);
    expect(out(exec(s, 'git log -G "Call" -p').last)).toContain('+<footer>Call 03-1234 5678</footer>');
  });

  it('git grep searches tracked files, or an old commit', () => {
    const s = scene('w10-search');
    expect(out(exec(s, 'git grep -n Kancil').last)).toBe('index.html:1:<h1>Kedai Kancil</h1>');
    expect(out(exec(s, 'git grep TODO HEAD~2').last)).toBe('HEAD~2:index.html:<footer>TODO: phone</footer>');
    const none = exec(s, 'git grep nothing-here').last;
    expect(none.ok).toBe(false);
    expect(none.events).toEqual([]);
    expect(none.explain?.key).toBe('sim.explain.grepNone');
  });

  it('blame names who last changed each line', () => {
    const s = scene('w10-search');
    const lines = out(exec(s, 'git blame index.html').last).split('\n');
    expect(lines[0]).toMatch(/^\^[0-9a-f]{7} \(You {4}2026-10-30 09:01:00 \+0800 1\) <h1>Kedai Kancil<\/h1>$/);
    expect(lines[1]).toMatch(/^[0-9a-f]{8} \(Aisyah 2026-10-30 09:02:00 \+0800 2\) <p>Price: RM10<\/p>$/);
    expect(lines[2]).toMatch(/^[0-9a-f]{8} \(Aisyah .* 3\) <footer>Call 03-1234 5678<\/footer>$/);
    // Git 2.56: 7 hex chars, or 8 when a ^boundary line is in the output (the full file above).
    const part = out(exec(s, 'git blame -L 2,3 index.html').last).split('\n');
    expect(part).toHaveLength(2);
    expect(part[0]).toMatch(/^[0-9a-f]{7} \(Aisyah /);
    expect(out(exec(s, 'git blame style.css').last)).toMatch(/^[0-9a-f]{7} \(Ben /);
    expectFail(exec(s, 'git blame nope.txt').last, 'noPath');
  });

  it('shortlog groups by author', () => {
    const s = scene('w10-search');
    expect(out(exec(s, 'git shortlog -sn HEAD').last)).toBe('     2\tAisyah\n     2\tBen\n     1\tYou');
    expect(out(exec(s, 'git shortlog').last).split('\n').slice(0, 4)).toEqual(['Aisyah (2):', '      Add the price', '      Fix the footer phone', '']);
  });

  it('revision syntax: ^2, A..B, A...B and --left-right', () => {
    const s = scene('w10-revisions');
    const log = (cmd: string) => out(exec(s, cmd).last);
    expect(log('git log --oneline -1 HEAD~2^2')).toMatch(/Add onde-onde$/);
    expect(log('git log --oneline main..prices')).toMatch(/^[0-9a-f]{7} \(prices\) Add a price$/);
    expect(log('git log --oneline --left-right main...prices').split('\n').map((l) => l.slice(0, 2))).toEqual(['< ', '> ']);
    expect(log('git diff main...prices')).toContain('+<p>Kuih lapis RM1</p>');
    expect(log('git rev-parse main...prices').split('\n')).toHaveLength(3);
  });
});

describe('git bisect', () => {
  it('halves the range like real Git and names the first bad commit', () => {
    const r = exec(scene('w10-bisect'), 'git bisect start HEAD HEAD~9');
    expect(out(r.last).split('\n')[0]).toBe('Bisecting: 4 revisions left to test after this (roughly 2 steps)');
    expect(out(r.last)).toMatch(/\] Add a footer$/);
    expect(checkGoal(r.state, { bisectActive: true }).ok).toBe(true);
    const done = exec(r.state, 'git bisect good', 'git bisect bad', 'git bisect bad');
    expect(out(done.last).split('\n')[0]).toMatch(/^[0-9a-f]{40} is the first 'bad' commit$/);
    // Git 2.56 decorates the commit line: HEAD was left on the culprit by the last test.
    expect(out(done.last).split('\n')[1]).toMatch(/^commit [0-9a-f]{40} \(HEAD\)$/);
    expect(out(done.last)).toContain('    Tidy up spacing');
    expect(done.last.explain?.key).toBe('sim.explain.bisectFound');
    expect(checkGoal(done.state, { bisectFound: 'Tidy up spacing' }).ok).toBe(true);
    const reset = exec(done.state, 'git bisect reset');
    expect(out(reset.last)).toMatch(/^Previous HEAD position was [0-9a-f]{7} Tidy up spacing\nSwitched to branch 'main'$/);
    // The find is remembered after reset, so a lesson goal can still pass.
    expect(checkGoal(reset.state, { bisectFound: 'spacing', bisectActive: false }).ok).toBe(true);
  });

  it('bisect run uses the script to test every step', () => {
    const r = exec(scene('w10-bisect'), 'git bisect start HEAD HEAD~9', 'git bisect run sh test.sh');
    expectOk(r.last);
    const text = out(r.last);
    expect(text.split('\n')[0]).toBe("running 'sh' 'test.sh'");
    expect(text).toMatch(/is the first 'bad' commit/);
    expect(text.endsWith("bisect found first 'bad' commit")).toBe(true);
    expect(bisectInfo(r.state).found).toBe(findRepo(r.state)!.bisectFound);
  });

  it('status, log, skip and mistakes look like real Git', () => {
    const s = scene('w10-bisect');
    expect(out(exec(s, 'git bisect start').last)).toBe("status: waiting for both 'good' and 'bad' commits");
    expect(out(exec(s, 'git bisect start', 'git bisect good HEAD~3').last)).toBe("status: waiting for 'bad' commit, 1 'good' commit known");
    expect(out(exec(s, 'git bisect start HEAD', 'git bisect log').last)).toMatch(/^# bad: \[[0-9a-f]{40}\] Update footer year\ngit bisect start 'HEAD'\n# status: waiting for 'good' commit\(s\), 'bad' commit known$/);
    // new/old terms: the first mark picks them, and mixing is refused like Git.
    const terms = exec(s, 'git bisect start', 'git bisect new', 'git bisect old HEAD~9', 'git bisect bad');
    expect(out(terms.all[1]!)).toBe("status: waiting for 'old' commit(s), 'new' commit known");
    expect(out(terms.all[2]!)).toMatch(/^Bisecting: /);
    expect(out(terms.last)).toBe("error: Invalid command: you're currently in a new/old bisect");
    expect(out(exec(terms.state, 'git bisect log').last)).toMatch(/\ngit bisect new [0-9a-f]{40}\n/);
    const st = exec(s, 'git bisect start HEAD HEAD~9', 'git status').last;
    expect(out(st)).toMatch(/^HEAD detached at [0-9a-f]{7}\nYou are currently bisecting, started from branch 'main'\./);
    const swapped = exec(s, 'git bisect start HEAD~9 HEAD').last;
    expectFail(swapped, 'bisectMistook');
    expect(out(swapped)).toMatch(/^Some 'good' revs are not ancestors of the 'bad' rev\.\n.*\nMaybe you mistook 'good' and 'bad' revs\?$/);
    expectFail(exec(s, 'git bisect good').last, 'notBisecting');
    // Git 2.56 prints nothing when there is no bisect to reset.
    expect(out(exec(s, 'git bisect reset').last)).toBe('');
  });

  it('skip steps away exactly like Git (checked against real Git 2.43)', () => {
    // History from the t4 probe: buy → side → break → merge → last (side branches off "price").
    const c = (id: string, parents: string[], t: number) => ({ id, parents, message: id, author: { name: 'x', email: 'x' }, timestamp: t, snapshot: {} });
    const commits = {
      price: c('c734c0845cc10b57ad6d0202a8f1957934faab3a', [], 1),
      buy: c('51775d73b4be5683a0637dde453f2c341109449d', ['c734c0845cc10b57ad6d0202a8f1957934faab3a'], 2),
      side: c('16a4be40e8b8043343b2f8246e9d540b44c7ddaf', ['c734c0845cc10b57ad6d0202a8f1957934faab3a'], 3),
      brk: c('b2def7248c95fddb2bcdd6ee3d341518d8cb54bc', ['51775d73b4be5683a0637dde453f2c341109449d'], 4),
      merge: c('0eb50ecfde09fdcfcf274c4ac73632cf97365611', ['b2def7248c95fddb2bcdd6ee3d341518d8cb54bc', '16a4be40e8b8043343b2f8246e9d540b44c7ddaf'], 5),
      last: c('d3c79e33b8d6f77cff9fc55ed45739cdd7c82b00', ['0eb50ecfde09fdcfcf274c4ac73632cf97365611'], 6),
    };
    const byId = Object.fromEntries(Object.values(commits).map((x) => [x.id, x]));
    const bad = commits.last.id;
    const good = [commits.price.id];
    expect(bisectPick(byId, bad, good, []).next).toBe(commits.brk.id);
    expect(bisectPick(byId, bad, good, [commits.brk.id]).next).toBe(commits.merge.id);
    expect(bisectPick(byId, bad, good, [commits.brk.id, commits.merge.id]).next).toBe(commits.side.id);
    expect(bisectPick(byId, bad, good, [commits.brk.id, commits.merge.id, commits.side.id]).next).toBe(commits.buy.id);
    const only = bisectPick(byId, bad, good, [commits.brk.id, commits.merge.id, commits.side.id, commits.buy.id]);
    expect(only.next).toBe(bad);
    expect(only.tried).toHaveLength(4);
  });

  it('estimates steps like Git', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 16].map(estimateSteps)).toEqual([0, 0, 1, 1, 1, 2, 2, 2, 2, 2, 3]);
  });
});

describe('aliases', () => {
  it('config alias.x makes git x work, like real Git', () => {
    const r = exec(scene('w10-aliases'), 'git config --global alias.st status', 'git config --global alias.lg "log --oneline --graph --all"', 'git st', 'git lg');
    expect(r.all[0]!.explain).toEqual({ key: 'sim.explain.configAlias', params: { alias: 'st', cmd: 'status' } });
    expect(out(r.all[2]!)).toMatch(/^On branch main\n/);
    expect(r.all[2]!.explain?.key).toBe('sim.explain.alias');
    expect(out(r.all[3]!).split('\n')[0]).toMatch(/^\* [0-9a-f]{7} \(HEAD -> main\) Add day 2$/);
    expect(checkGoal(r.state, { aliases: { st: 'status', lg: 'log --oneline --graph --all' } }).ok).toBe(true);
    expect(checkGoal(r.state, { aliases: { co: 'checkout' } }).ok).toBe(false);
    expect(out(exec(r.state, 'git st --help').last)).toBe("'st' is aliased to 'status'");
    expect(out(exec(r.state, 'git config --get-regexp alias').last)).toBe('alias.st status\nalias.lg log --oneline --graph --all');
  });

  it('built-in commands win and loops stop kindly', () => {
    const r = exec(scene('w10-aliases'), 'git config --global alias.status "log --oneline"', 'git status');
    expect(out(r.last)).toMatch(/^On branch main/);
    const loop = exec(scene('w10-aliases'), 'git config --global alias.a b', 'git config --global alias.b a', 'git a').last;
    expectFail(loop, 'aliasLoop');
  });
});

describe('git worktree', () => {
  it('adds a second working folder that shares commits and branches', () => {
    const r = exec(scene('w10-worktree'), 'git worktree add ../diary-fix -b fix');
    expect(out(r.last)).toMatch(/^Preparing worktree \(new branch 'fix'\)\nHEAD is now at [0-9a-f]{7} Add day 2$/);
    expect(worktreePaths(r.state)).toEqual(['/home/you/diary-fix']);
    expect(checkGoal(r.state, { worktrees: ['/home/you/diary-fix'] }).ok).toBe(true);
    expect(r.state.fs.files['/home/you/diary-fix/index.html']).toContain('Day 2');
    const list = out(exec(r.state, 'git worktree list').last).split('\n');
    expect(list[0]).toMatch(/^\/home\/you\/diary {5}[0-9a-f]{7} \[main\]$/);
    expect(list[1]).toMatch(/^\/home\/you\/diary-fix [0-9a-f]{7} \[fix\]$/);
    // Commit in the worktree; the main folder sees the branch move.
    const w = exec(r.state, 'cd ../diary-fix', 'git status', 'echo "<p>Fixed</p>" >> index.html', 'git commit -am "Fix a typo"', 'git rev-parse --git-dir', 'cd ../diary', 'git log --oneline --all');
    expect(out(w.all[1]!)).toBe('On branch fix\nnothing to commit, working tree clean');
    expect(out(w.all[4]!)).toBe('/home/you/diary/.git/worktrees/diary-fix');
    expect(out(w.last).split('\n')[0]).toMatch(/^[0-9a-f]{7} \(fix\) Fix a typo$/);
    expect(findRepo(w.state)!.head).toEqual({ type: 'branch', name: 'main' });
    expect(out(exec(w.state, 'cat ../diary-fix/.git').last)).toBe('gitdir: /home/you/diary/.git/worktrees/diary-fix');
  });

  it('a branch open in another worktree cannot be switched to or deleted', () => {
    const r = exec(scene('w10-worktree'), 'git worktree add ../diary-fix -b fix');
    const sw = exec(r.state, 'git switch fix').last;
    expectFail(sw, 'branchInUse');
    expect(out(sw)).toBe("fatal: 'fix' is already used by worktree at '/home/you/diary-fix'");
    expect(out(exec(r.state, 'git branch -d fix').last)).toBe("error: cannot delete branch 'fix' used by worktree at '/home/you/diary-fix'");
  });

  it('remove refuses changes unless --force; prune forgets deleted folders', () => {
    const r = exec(scene('w10-worktree'), 'git worktree add ../old HEAD~1', 'echo "x" > ../old/new.txt');
    expectFail(exec(r.state, 'git worktree remove ../old').last, 'worktreeDirty');
    const gone = exec(r.state, 'git worktree remove --force ../old');
    expectOk(gone.last);
    expect(worktreePaths(gone.state)).toEqual([]);
    expect(Object.keys(gone.state.fs.files).some((f) => f.startsWith('/home/you/old/'))).toBe(false);
    const pruned = exec(scene('w10-worktree'), 'git worktree add ../tmp', 'rm -rf ../tmp', 'git worktree list', 'git worktree prune');
    expect(out(pruned.all[2]!).split('\n')[1]).toMatch(/\[tmp\] prunable$/);
    expect(worktreePaths(pruned.state)).toEqual([]);
  });
});

describe('small shell helpers for bisect run', () => {
  it('sh runs a script line by line; grep and test give exit codes', () => {
    const s = scene('w10-bisect');
    const bad = exec(s, 'sh test.sh').last;
    expect(bad.exitCode).toBe(1);
    expect(bad.ok).toBe(false);
    const good = exec(s, 'git switch --detach HEAD~9', 'sh test.sh').last;
    expect(good.exitCode).toBe(0);
    expect(exec(s, 'grep -n Kancil index.html').last.output.length).toBeGreaterThan(0);
    expect(exec(s, 'grep -q nothing index.html').last.exitCode).toBe(1);
    expect(exec(s, 'test -f test.sh').last.ok).toBe(true);
    expect(exec(s, '[ -f nope ]').last.ok).toBe(false);
    expect(exec(s, 'sh -c "grep -q Kancil index.html"').last.exitCode).toBe(0);
    const dot = exec(s, './test.sh').last;
    expect(out(dot)).toBe('bash: ./test.sh: Permission denied');
    expect(dot.explain).toEqual({ key: 'sim.err.notExecutable', params: { file: 'test.sh' } });
  });
});

describe('commands the terminal only explains', () => {
  it.each(['gc', 'maintenance run', 'count-objects -v', 'submodule add x', 'lfs track "*.psd"', 'sparse-checkout set docs', 'range-diff A...B', 'rerere'])('git %s gives a kind note', (cmd) => {
    const r = run(scene('w10-objects'), `git ${cmd}`);
    expect(r.stopped).toBe(true);
    expect(r.explain?.key).toBe(`sim.explain.notInSim.${cmd.split(' ')[0]}`);
  });
});
