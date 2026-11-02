import { describe, expect, it } from 'vitest';
import { buildScenario, findServer, type Scenario } from '../index';
import { diary, verifyFixtures } from './fixtures';
import { exec, expectFail, expectOk, out, repoOf } from './helpers';

const masked = (s: string) => s.replace(/\b[0-9a-f]{7,40}\b/g, '<h>');
const URL = 'https://github.com/you/diary.git';
const team = () => buildScenario(verifyFixtures.find((s) => s.id === 'fx-teamwork')!);
/** The diary and an empty repo on GitHub; no remote yet. */
const local = () => buildScenario({ id: 'remote-test', steps: [{ server: URL }, ...diary] });

describe('git remote', () => {
  it('add, list, -v, rename, set-url, get-url, remove', () => {
    const s = exec(local(), `git remote add origin ${URL}`).state;
    expect(out(exec(s, 'git remote').last)).toBe('origin');
    expect(out(exec(s, 'git remote -v').last)).toBe(`origin\t${URL} (fetch)\norigin\t${URL} (push)`);
    expect(out(exec(s, `git remote add origin ${URL}`).last)).toBe('error: remote origin already exists.');
    expect(out(exec(s, 'git remote get-url origin').last)).toBe(URL);
    const renamed = exec(s, 'git remote rename origin up', 'git remote').state;
    expect(out(exec(renamed, 'git remote').last)).toBe('up');
    expect(out(exec(s, 'git remote remove nope').last)).toBe("error: No such remote: 'nope'");
    expect(out(exec(s, 'git remote set-url nope x').last)).toBe("error: No such remote 'nope'");
    expect(out(exec(s, 'git remote add "bad name" x').last)).toBe("fatal: 'bad name' is not a valid remote name");
    expect(out(exec(s, 'git remote remove origin', 'git remote').last)).toBe('');
    expect(out(exec(s, 'git config --list --local').last)).toContain('remote.origin.fetch=+refs/heads/*:refs/remotes/origin/*');
  });
});

describe('git push', () => {
  it('first push needs -u, then sets up tracking (output in terminal order)', () => {
    const s = exec(local(), `git remote add origin ${URL}`).state;
    const noUp = exec(s, 'git push').last;
    expectFail(noUp, 'noUpstream');
    expect(out(noUp)).toContain('fatal: The current branch main has no upstream branch.');
    expect(out(noUp)).toContain('    git push --set-upstream origin main');
    const r = exec(s, 'git push -u origin main');
    expect(out(r.last)).toBe(`To ${URL}\n * [new branch]      main -> main\nbranch 'main' set up to track 'origin/main'.`);
    expect(r.last.events[0]).toMatchObject({ type: 'pushed', url: URL, remote: 'origin', updates: [{ ref: 'main', from: null }] });
    expect(findServer(r.state, URL)!.branches.main).toBe(repoOf(r.state).branches.main);
    expect(out(exec(r.state, 'git status').last)).toBe("On branch main\nYour branch is up to date with 'origin/main'.\n\nnothing to commit, working tree clean");
    expect(out(exec(r.state, 'git push').last)).toBe('Everything up-to-date');
  });

  it('a fast-forward push, a new branch (with GitHub\'s pull-request tip) and --delete', () => {
    const s = exec(local(), `git remote add origin ${URL}`, 'git push -u origin main', 'echo "x" > x.txt', 'git add x.txt', 'git commit -m "Add x"').state;
    expect(masked(out(exec(s, 'git status -sb').last))).toBe('## main...origin/main [ahead 1]');
    expect(masked(out(exec(s, 'git push').last))).toBe(`To ${URL}\n   <h>..<h>  main -> main`);
    const f = exec(s, 'git switch -c feature', 'git push origin feature').last;
    expect(out(f)).toBe(
      [
        'remote: ',
        "remote: Create a pull request for 'feature' on GitHub by visiting:",
        'remote:      https://github.com/you/diary/pull/new/feature',
        'remote: ',
        `To ${URL}`,
        ' * [new branch]      feature -> feature',
      ].join('\n'),
    );
    expect(out(exec(f.state, 'git push origin --delete feature').last)).toBe(`To ${URL}\n - [deleted]         feature`);
    expect(out(exec(f.state, 'git push origin --delete nope').last)).toBe(
      `error: unable to delete 'nope': remote ref does not exist\nerror: failed to push some refs to '${URL}'`,
    );
  });

  it('rejected: "fetch first" before fetching, "non-fast-forward" after', () => {
    const s = exec(team(), 'echo "x" > x.txt', 'git add x.txt', 'git commit -m "Add x"').state;
    const first = exec(s, 'git push').last;
    expectFail(first, 'pushRejected');
    expect(out(first)).toBe(
      [
        `To ${URL}`,
        ' ! [rejected]        main -> main (fetch first)',
        `error: failed to push some refs to '${URL}'`,
        'hint: Updates were rejected because the remote contains work that you do not',
        'hint: have locally. This is usually caused by another repository pushing to',
        'hint: the same ref. If you want to integrate the remote changes, use',
        "hint: 'git pull' before pushing again.",
        "hint: See the 'Note about fast-forwards' in 'git push --help' for details.",
      ].join('\n'),
    );
    expect(first.explain?.key).toBe('sim.err.pushFetchFirst');
    const after = exec(s, 'git fetch', 'git push').last;
    expect(out(after)).toContain(' ! [rejected]        main -> main (non-fast-forward)');
    expect(out(after)).toContain('hint: Updates were rejected because the tip of your current branch is behind');
  });

  it('--force-with-lease refuses stale info, then forces after a fetch', () => {
    const s = exec(team(), 'git commit --amend -m "Start the diary"').state;
    const stale = exec(s, 'git push --force-with-lease').last;
    expect(out(stale)).toBe(`To ${URL}\n ! [rejected]        main -> main (stale info)\nerror: failed to push some refs to '${URL}'`);
    expect(stale.explain?.key).toBe('sim.err.pushStale');
    const forced = exec(s, 'git fetch', 'git push --force-with-lease').last;
    expect(masked(out(forced))).toBe(`To ${URL}\n + <h>...<h> main -> main (forced update)`);
    expect(forced.events[0]).toMatchObject({ type: 'pushed', updates: [{ ref: 'main', forced: true }] });
    expect(masked(out(exec(s, 'git push --force').last))).toBe(`To ${URL}\n + <h>...<h> main -> main (forced update)`);
  });

  it('tags: one tag, --tags, and Everything up-to-date', () => {
    const s = exec(team(), 'git tag v1.0', 'git tag -a v1.1 -m "Version 1.1"').state;
    expect(out(exec(s, 'git push origin v1.0').last)).toBe(`To ${URL}\n * [new tag]         v1.0 -> v1.0`);
    const all = exec(s, 'git push --tags');
    expect(out(all.last)).toBe(`To ${URL}\n * [new tag]         v1.0 -> v1.0\n * [new tag]         v1.1 -> v1.1`);
    expect(out(exec(all.state, 'git push --tags').last)).toBe('Everything up-to-date');
    expect(findServer(all.state, URL)!.tagInfo['v1.1']?.message).toBe('Version 1.1');
  });

  it('errors: unknown remote, unknown branch, missing repo on GitHub', () => {
    const s = team();
    expect(out(exec(s, 'git push nope main').last)).toContain("fatal: 'nope' does not appear to be a git repository");
    expect(out(exec(s, 'git push origin nope').last)).toBe(`error: src refspec nope does not match any\nerror: failed to push some refs to '${URL}'`);
    const missing = exec(s, 'git remote add other https://github.com/you/nope.git', 'git push other main').last;
    expect(out(missing)).toBe("remote: Repository not found.\nfatal: repository 'https://github.com/you/nope.git/' not found");
    expect(out(exec(local(), 'git push').last)).toContain('fatal: No configured push destination.');
  });

  it('an SSH address gets "Permission denied (publickey)": the simulator has no SSH key', () => {
    const s = exec(team(), 'git remote set-url origin git@github.com:you/diary.git').state;
    const denied =
      'git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.\n\nPlease make sure you have the correct access rights\nand the repository exists.';
    const push = exec(s, 'git push').last;
    expectFail(push);
    expect(out(push)).toBe(denied);
    expect(push.explain?.key).toBe('sim.err.publickey');
    expect(out(exec(s, 'git fetch').last)).toBe(denied);
    expect(out(exec(local(), 'git clone ssh://git@github.com/you/diary.git copy').last)).toBe(`Cloning into 'copy'...\n${denied}`);
    // Back to HTTPS: it works again.
    expectOk(exec(s, `git remote set-url origin ${URL}`, 'git fetch').last);
  });
});

describe('git fetch and git pull', () => {
  it('fetch shows "From" without .git and moves origin/main only', () => {
    const r = exec(team(), 'git fetch');
    expect(masked(out(r.last))).toBe('From https://github.com/you/diary\n   <h>..<h>  main       -> origin/main');
    expect(masked(out(exec(r.state, 'git status').last))).toBe(
      "On branch main\nYour branch is behind 'origin/main' by 1 commit, and can be fast-forwarded.\n  (use \"git pull\" to update your local branch)\n\nnothing to commit, working tree clean",
    );
    expect(masked(out(exec(r.state, 'git branch -vv').last))).toBe('* main <h> [origin/main: behind 1] Add home page');
    expect(out(exec(r.state, 'git fetch').last)).toBe('');
  });

  it('pull fast-forwards and prints the fetch first', () => {
    const r = exec(team(), 'git pull').last;
    expect(masked(out(r))).toBe(
      [
        'From https://github.com/you/diary',
        '   <h>..<h>  main       -> origin/main',
        'Updating <h>..<h>',
        'Fast-forward',
        ' index.html | 2 +-',
        ' 1 file changed, 1 insertion(+), 1 deletion(-)',
      ].join('\n'),
    );
  });

  it('diverged: Git 2.56 asks how to reconcile; --no-rebase merges; --rebase replays', () => {
    const s = exec(team(), 'echo "x" > x.txt', 'git add x.txt', 'git commit -m "Add x"').state;
    const ask = exec(s, 'git pull').last;
    expect(out(ask)).toContain('hint: You have divergent branches and need to specify how to reconcile them.');
    expect(out(ask).endsWith('fatal: Need to specify how to reconcile divergent branches.')).toBe(true);
    expect(ask.explain?.key).toBe('sim.err.pullDivergent');
    // The fetch still happened.
    expect(out(exec(ask.state, 'git status').last)).toContain("Your branch and 'origin/main' have diverged,\nand have 1 and 1 different commits each, respectively.");
    expect(out(exec(s, 'git pull --ff-only').last)).toContain('fatal: Not possible to fast-forward, aborting.');
    const merged = exec(s, 'git pull --no-rebase');
    expect(out(merged.last)).toContain("Merge made by the 'ort' strategy.");
    const r = repoOf(merged.state);
    expect(r.commits[r.branches.main!]!.message).toBe("Merge branch 'main' of https://github.com/you/diary");
    const rebased = exec(s, 'git pull --rebase');
    expect(out(rebased.last).endsWith('Successfully rebased and updated refs/heads/main.')).toBe(true);
    expect(out(exec(rebased.state, 'git status').last)).toContain("Your branch is ahead of 'origin/main' by 1 commit.");
    const cfg = exec(s, 'git config pull.rebase true', 'git pull');
    expect(out(cfg.last).endsWith('Successfully rebased and updated refs/heads/main.')).toBe(true);
  });

  it('pull with no upstream still fetches, then explains', () => {
    const s = exec(team(), 'git switch -c side', 'git pull').last;
    expect(out(s)).toContain('There is no tracking information for the current branch.');
    expect(out(s)).toContain('git branch --set-upstream-to=origin/<branch> side');
  });
});

describe('git clone', () => {
  it('clones, sets origin and tracking, checks out the default branch', () => {
    const s = exec(team(), 'cd /home/you', `git clone ${URL} copy`);
    expect(out(s.last)).toBe("Cloning into 'copy'...");
    const repo = repoOf(s.state, '/home/you/copy');
    expect(repo.head).toEqual({ type: 'branch', name: 'main' });
    expect(repo.remoteHeads.origin).toBe('main');
    expect(repo.config['branch.main.merge']).toBe('refs/heads/main');
    expect(s.state.fs.files['/home/you/copy/index.html']).toContain('Aisyah');
    const inside = exec(s.state, 'cd copy', 'git branch -a').last;
    expect(out(inside)).toBe('* main\n  remotes/origin/HEAD -> origin/main\n  remotes/origin/main');
    expect(out(exec(s.state, `git clone ${URL} copy`).last)).toBe("fatal: destination path 'copy' already exists and is not an empty directory.");
    expect(out(exec(s.state, 'git clone https://github.com/you/nope.git').last)).toBe(
      "Cloning into 'nope'...\nremote: Repository not found.\nfatal: repository 'https://github.com/you/nope.git/' not found",
    );
  });

  it('an empty repo, and a repo made with a README', () => {
    const sc: Scenario = {
      id: 'clone-test',
      steps: [{ server: 'https://github.com/you/empty.git' }, { server: 'https://github.com/you/notes.git', files: { 'README.md': '# Notes\n' } }],
    };
    const s = buildScenario(sc);
    expect(out(exec(s, 'git clone https://github.com/you/empty.git').last)).toBe("Cloning into 'empty'...\nwarning: You appear to have cloned an empty repository.");
    expect(out(exec(s, 'git clone https://github.com/you/empty.git', 'cd empty', 'git status -sb').last)).toBe('## No commits yet on main...origin/main [gone]');
    const notes = exec(s, 'git clone https://github.com/you/notes.git', 'cd notes', 'git log --oneline').last;
    expect(masked(out(notes))).toBe('<h> (HEAD -> main, origin/main, origin/HEAD) Initial commit');
  });
});

describe('teammates and switching to remote branches', () => {
  it('git switch <name> creates a tracking branch from origin/<name>', () => {
    const s = exec(team(), 'cd /home/aisyah/diary', 'git switch -c topic', 'echo t > t.txt', 'git add t.txt', 'git commit -m "Topic"', 'git push -u origin topic', 'cd /home/you/diary', 'git fetch').state;
    const r = exec(s, 'git switch topic').last;
    expect(out(r)).toBe("branch 'topic' set up to track 'origin/topic'.\nSwitched to a new branch 'topic'");
    expect(repoOf(r.state).config['branch.topic.remote']).toBe('origin');
  });

  it('pull, push, fetch and clone never change their input state', () => {
    expect(() => exec(team(), 'git fetch', 'git pull', 'echo x > x.txt', 'git add x.txt', 'git commit -m x', 'git push', 'git push --tags', 'cd /home/you', `git clone ${URL} again`)).not.toThrow();
    expectOk(exec(team(), 'git fetch --prune').last);
  });
});
