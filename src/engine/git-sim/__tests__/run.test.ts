import { describe, expect, it } from 'vitest';
import { buildScenario, createState, plain, run, runAll, toAnsi } from '../index';
import { parseLine } from '../parse';
import { exec, expectFail, fresh, oneCommit, out } from './helpers';

describe('parser', () => {
  it('splits words and keeps quoted text together', () => {
    expect(parseLine('git commit -m "Add home page"').words).toEqual(['git', 'commit', '-m', 'Add home page']);
    expect(parseLine("echo 'a b' > x.txt")).toEqual({ words: ['echo', 'a b'], redirect: { append: false, target: 'x.txt' }, error: null });
    expect(parseLine('echo hi >> x.txt').redirect).toEqual({ append: true, target: 'x.txt' });
    expect(parseLine('echo "say \\"hi\\""').words).toEqual(['echo', 'say "hi"']);
    expect(parseLine('git commit -m ""').words).toEqual(['git', 'commit', '-m', '']);
    expect(parseLine('echo "oops').error).toBe('unclosedQuote');
    expect(parseLine('echo hi >').error).toBe('missingTarget');
  });
});

describe('friendly errors', () => {
  it('typo in a git command suggests the right one', () => {
    const r = exec(oneCommit(), 'git comit -m "x"').last;
    expectFail(r, 'unknownGitCommand');
    expect(out(r)).toBe("git: 'comit' is not a git command. See 'git --help'.\n\nThe most similar command is\n\tcommit");
    expect(r.explain).toEqual({ key: 'sim.err.unknownGitDidYouMean', params: { cmd: 'comit', suggestion: 'commit' } });
  });

  it('typo in the program name', () => {
    const r = exec(fresh(), 'gti status').last;
    expect(out(r)).toBe('gti: command not found');
    expect(r.explain).toEqual({ key: 'sim.err.unknownCmdDidYouMean', params: { cmd: 'gti', suggestion: 'git' } });
    expect(exec(fresh(), 'xyzzyx').last.explain?.key).toBe('sim.err.unknownCmd');
    expect(exec(fresh(), 'git xyzzyx').last.explain?.key).toBe('sim.err.unknownGit');
  });

  it('commands from later worlds say when they come', () => {
    const r = exec(oneCommit(), 'git filter-repo --path secret.txt --invert-paths').last;
    expect(r.explain).toEqual({ key: 'sim.err.later', params: { cmd: 'git filter-repo', world: '8' } });
  });

  it('commands the terminal never runs get a kind note, not fake output (and no mistake)', () => {
    const r = exec(oneCommit(), 'git rerere').last;
    expect(out(r)).toBe("This practice terminal doesn't run git rerere. The lesson shows what it does.");
    expect(r.explain).toEqual({ key: 'sim.explain.notInSim.rerere', params: { cmd: 'git rerere' } });
    expect(r.stopped).toBe(true);
    expect(r.events).toEqual([]);
  });

  it('one command at a time; quotes; redirects only with echo', () => {
    expect(exec(fresh(), 'git add . && git commit -m x').last.explain?.key).toBe('sim.err.oneAtATime');
    expect(exec(fresh(), 'echo "hi').last.explain?.key).toBe('sim.err.unclosedQuote');
    expect(exec(fresh(), 'echo hi >').last.explain?.key).toBe('sim.err.redirectTarget');
    expect(exec(fresh(), 'cat x > y').last.explain?.key).toBe('sim.err.redirectEchoOnly');
  });

  it('empty input does nothing', () => {
    const s = fresh();
    const r = run(s, '   ');
    expect(r.ok).toBe(true);
    expect(r.state).toBe(s);
  });
});

describe('purity and determinism', () => {
  it('never mutates the input state', () => {
    // exec() freezes every input state; any mutation would throw.
    expect(() =>
      exec(
        oneCommit(),
        'echo a >> index.html',
        'git add -A',
        'git commit -m a',
        'git reset --hard HEAD~1',
        'git reflog',
        'git checkout HEAD@{1}',
        'git switch main',
        'git revert HEAD',
        'touch j',
        'git clean -f',
        'git config --global user.name X',
      ),
    ).not.toThrow();
  });

  it('a failed command returns the same state object', () => {
    const s = oneCommit();
    expect(run(s, 'git add nope').state).toBe(s);
  });

  it('runAll returns every result', () => {
    const { state, results } = runAll(createState(), ['mkdir a', 'cd a', 'pwd']);
    expect(results).toHaveLength(3);
    expect(state.cwd).toBe('/home/you/a');
  });

  it('scenarios replay identically', () => {
    const steps = ['mkdir d', 'cd d', 'git init', 'touch a', 'git add a', 'git commit -m one'];
    const a = buildScenario({ id: 'same', steps });
    const b = buildScenario({ id: 'same', steps });
    const c = buildScenario({ id: 'other', steps });
    expect(a).toEqual(b);
    // Ids are real SHA-1s of the objects, so they depend on content, not on the scenario id.
    expect(Object.keys(a.repos['/home/you/d']!.commits)).toEqual(Object.keys(c.repos['/home/you/d']!.commits));
  });

  it('commit and tag ids are the SHA-1s real Git computes (same files, identity, dates and message)', () => {
    // Checked with real Git: You <you@example.com>, dates @1793322060 / @1793322120 / @1793322180 +0800.
    const s = buildScenario({
      id: 'ids',
      steps: ['mkdir d', 'cd d', 'git init', 'touch a', 'mkdir src', 'echo hi > src/x.txt', 'git add .', 'git commit -m one',
        'echo more >> a', 'git commit -am "two words"', 'git tag -a v1 -m "First release"'],
    });
    const repo = s.repos['/home/you/d']!;
    expect(repo.branches.main).toBe('d637dab8393a0661972f1ffbc12af9469c66f1a1');
    expect(repo.commits[repo.branches.main!]!.parents).toEqual(['6c5f90e336165e961cfa90e14dc54250e0731b24']);
  });

  it('scenario steps can write and delete files, and failures throw', () => {
    const s = buildScenario({ id: 'w', steps: [{ write: 'a.txt', content: 'x\n' }, { write: 'b.txt', content: 'y' }, { delete: 'b.txt' }] });
    expect(s.fs.files['/home/you/a.txt']).toBe('x\n');
    expect(s.fs.files['/home/you/b.txt']).toBeUndefined();
    expect(() => buildScenario({ id: 'bad', steps: ['git status'] })).toThrow(/step failed/);
  });
});

describe('output helpers', () => {
  it('toAnsi colours segments; plain strips them', () => {
    const r = exec(oneCommit(), 'echo x >> index.html', 'git status -s').last;
    expect(plain(r.output)).toBe(' M index.html');
    expect(toAnsi(r.output)).toBe('\x1b[32m \x1b[0m\x1b[31mM\x1b[0m index.html');
  });
});
