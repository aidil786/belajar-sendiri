import { describe, expect, it } from 'vitest';
import { checkGoal } from '../goals';
import { exec, fresh, oneCommit } from './helpers';

describe('checkGoal', () => {
  it('staged / notStaged (The Box)', () => {
    const s = exec(oneCommit(), 'touch style.css', 'touch about.html', 'echo x >> index.html', 'git add index.html').state;
    expect(checkGoal(s, { staged: ['index.html'], notStaged: ['style.css', 'about.html'] }).ok).toBe(true);
    const wrong = exec(s, 'git add .').state;
    expect(checkGoal(wrong, { staged: ['index.html'], notStaged: ['style.css', 'about.html'] })).toEqual({ ok: false, failed: ['notStaged'] });
  });

  it('commits, messages and last commit files', () => {
    const s = exec(oneCommit(), 'echo a > a.txt', 'git add a.txt', 'git commit -m "Add notes file"').state;
    expect(checkGoal(s, { commits: 2, lastMessage: '^add', messages: ['notes', 'home'], lastCommitHas: ['a.txt'], lastCommitFiles: ['a.txt', 'index.html'] }).ok).toBe(true);
    expect(checkGoal(s, { minCommits: 3 }).failed).toEqual(['minCommits']);
  });

  it('clean, untracked, modified, files', () => {
    const s = exec(oneCommit(), 'touch junk.txt', 'echo y >> index.html').state;
    expect(checkGoal(s, { untracked: ['junk.txt'], modified: ['index.html'], clean: false }).ok).toBe(true);
    const c = exec(s, 'git restore index.html').state;
    expect(checkGoal(c, { clean: true }).ok).toBe(true);
    expect(checkGoal(c, { clean: true, noUntracked: true }).ok).toBe(false);
    expect(checkGoal(c, { filesExist: ['junk.txt'], filesMissing: ['nope'], fileContains: { 'index.html': 'Diary' }, fileNotContains: { 'index.html': 'zzz' } }).ok).toBe(true);
  });

  it('detached HEAD, revert, cwd, config, typed', () => {
    const s = exec(oneCommit(), 'echo 2 >> index.html', 'git commit -am "Two"', 'git revert HEAD').state;
    expect(checkGoal(s, { lastIsRevert: true, headDetached: false }).ok).toBe(true);
    const d = exec(s, 'git switch --detach HEAD~2').state;
    expect(checkGoal(d, { headDetached: true, headAtMessage: 'home page' }).ok).toBe(true);
    const shell = exec(fresh(), 'mkdir site', 'cd site', 'git config --global user.name "Aiman"').state;
    expect(checkGoal(shell, { cwd: '/home/you/site', dirsExist: ['/home/you/site'], config: { 'user.name': 'Aiman' } }).ok).toBe(true);
    expect(checkGoal(shell, { typed: '^git config', lastTyped: 'user\\.name' }, ['pwd', 'git config --global user.name "Aiman"']).ok).toBe(true);
  });

  it('repo-dependent goals fail outside a repo', () => {
    expect(checkGoal(fresh(), { commits: 1 })).toEqual({ ok: false, failed: ['repo'] });
    expect(checkGoal(fresh(), { repoAt: '/home/you/x' }).ok).toBe(false);
  });
});

describe('isCleanMessage', () => {
  it('likes short, specific messages', async () => {
    const { isCleanMessage } = await import('../goals');
    expect(isCleanMessage('Add day 1 entry')).toBe(true);
    expect(isCleanMessage('feat: add contact form')).toBe(true);
    expect(isCleanMessage('fix(nav): close menu on tap')).toBe(true);
    expect(isCleanMessage('update')).toBe(false);
    expect(isCleanMessage('fix: stuff')).toBe(false);
    expect(isCleanMessage('Added the thing.')).toBe(false);
    expect(isCleanMessage('wip')).toBe(false);
    expect(isCleanMessage('x'.repeat(80))).toBe(false);
  });

  it('cleanMessages and configSet goals', () => {
    const s = exec(oneCommit(), 'echo a > a.txt', 'git add .', 'git commit -m "update"', 'echo b > b.txt', 'git add .', 'git commit -m "Add notes page"').state;
    expect(checkGoal(s, { cleanMessages: 2 }).ok).toBe(true);
    expect(checkGoal(s, { cleanMessages: 3 }).ok).toBe(false);
    expect(checkGoal(s, { configSet: ['user.name', 'init.defaultBranch'] }).ok).toBe(true);
    expect(checkGoal(s, { configSet: ['core.editor'] }).ok).toBe(false);
  });
});

describe('stagedContains', () => {
  it('checks what is inside the box', () => {
    const s = exec(oneCommit(), 'echo "<p>Day 4</p>" >> index.html', 'git add index.html', 'echo "<p>later</p>" >> index.html').state;
    expect(checkGoal(s, { stagedContains: { 'index.html': 'Day 4' }, stagedNotContains: { 'index.html': 'later' } }).ok).toBe(true);
    expect(checkGoal(s, { stagedContains: { 'index.html': 'later' } }).ok).toBe(false);
  });
});
