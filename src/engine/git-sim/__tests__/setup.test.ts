import { describe, expect, it } from 'vitest';
import { buildScenario } from '../index';
import { exec, expectFail, expectOk, fresh, out, repoOf } from './helpers';

describe('git --version and help', () => {
  it('prints the taught version', () => {
    expect(out(exec(fresh(), 'git --version').last)).toBe('git version 2.56.0');
    expect(out(exec(fresh(), 'git version').last)).toBe('git version 2.56.0');
  });

  it('git help, git help <cmd>, git <cmd> -h, git <cmd> --help', () => {
    expect(out(exec(fresh(), 'git help').last)).toContain('usage: git');
    expect(out(exec(fresh(), 'git').last)).toContain('usage: git');
    expect(out(exec(fresh(), 'git help commit').last)).toContain('https://git-scm.com/docs/git-commit');
    expect(out(exec(fresh(), 'git commit --help').last)).toContain('GIT-COMMIT(1)');
    const h = exec(fresh(), 'git add -h').last;
    expect(out(h)).toContain('usage: git add');
    expect(h.explain?.key).toBe('sim.explain.usage');
    expectFail(exec(fresh(), 'git help nonsense').last, 'noManual');
  });
});

describe('git config', () => {
  it('sets and gets global values', () => {
    const r = exec(fresh(), 'git config --global user.name "Aiman Hakim"', 'git config user.name');
    expect(out(r.last)).toBe('Aiman Hakim');
    expect(r.all[0]!.events).toEqual([{ type: 'configSet', key: 'user.name', value: 'Aiman Hakim', scope: 'global' }]);
  });

  it('keys are case-insensitive and listed in lower case', () => {
    const s = buildScenario({ id: 't', config: {}, steps: ['git config --global init.defaultBranch main'] });
    expect(s.globalConfig['init.defaultbranch']).toBe('main');
    expect(out(exec(s, 'git config --list').last)).toBe('init.defaultbranch=main');
    expect(out(exec(s, 'git config init.DEFAULTBRANCH').last)).toBe('main');
  });

  it('missing key returns nothing and fails quietly', () => {
    const r = exec(fresh(), 'git config core.editor').last;
    expect(r.ok).toBe(false);
    expect(r.output).toEqual([]);
  });

  it('local config needs a repo; local overrides global', () => {
    expectFail(exec(fresh(), 'git config user.name Ali').last, 'notARepo');
    expectFail(exec(fresh(), 'git config --local user.name Ali').last, 'notARepo');
    const r = exec(fresh('/home/you/p'), 'git init', 'git config user.name Ali', 'git config user.name');
    expect(out(r.last)).toBe('Ali');
    expect(out(exec(r.state, 'git config --global user.name').last)).toBe('You');
    expect(out(exec(r.state, 'git config --list --local').last)).toContain('user.name=Ali');
  });

  it('new-style subcommands: list, get, set, unset', () => {
    const r = exec(fresh(), 'git config set --global core.editor "code --wait"', 'git config get core.editor');
    expect(out(r.last)).toBe('code --wait');
    const u = exec(r.state, 'git config unset --global core.editor', 'git config core.editor');
    expect(u.last.output).toEqual([]);
    expect(out(exec(fresh(), 'git config list').last)).toContain('user.email=you@example.com');
  });

  it('rejects keys without a section and unknown options', () => {
    expect(out(exec(fresh(), 'git config --global name Ali').last)).toBe('error: key does not contain a section: name');
    expectFail(exec(fresh(), 'git config --wat').last, 'badOption');
    expectFail(exec(fresh(), 'git config --system user.name x').last, 'noSystem');
  });
});

describe('git init', () => {
  it('creates a repo on the default branch from config', () => {
    const r = exec(fresh('/home/you/diary'), 'git init');
    expectOk(r.last);
    expect(out(r.last)).toBe('Initialized empty Git repository in /home/you/diary/.git/');
    expect(repoOf(r.state).head).toEqual({ type: 'branch', name: 'main' });
    expect(r.last.events).toEqual([{ type: 'repoInitialized', root: '/home/you/diary', reinit: false }]);
  });

  it("uses 'master' with a hint when init.defaultBranch is not set", () => {
    const s = buildScenario({ id: 't', config: { 'user.name': 'A', 'user.email': 'a@b.c' }, steps: ['mkdir p', 'cd p'] });
    const r = exec(s, 'git init');
    expect(out(r.last)).toContain("hint: Using 'master' as the name for the initial branch.");
    expect(r.state.repos['/home/you/p']!.head).toEqual({ type: 'branch', name: 'master' });
    expect(r.last.explain?.key).toBe('sim.explain.initMaster');
  });

  it('git init <dir> and -b <name>', () => {
    const r = exec(fresh(), 'git init -b trunk site');
    expect(r.state.repos['/home/you/site']!.head).toEqual({ type: 'branch', name: 'trunk' });
    expect(r.state.fs.dirs).toContain('/home/you/site');
  });

  it('reinitialising is safe', () => {
    const r = exec(fresh('/home/you/p'), 'git init', 'git init');
    expect(out(r.last)).toBe('Reinitialized existing Git repository in /home/you/p/.git/');
  });

  it('git commands outside a repo fail kindly', () => {
    const r = exec(fresh(), 'git status').last;
    expectFail(r, 'notARepo');
    expect(out(r)).toBe('fatal: not a git repository (or any of the parent directories): .git');
    expect(r.explain?.key).toBe('sim.err.notARepo');
  });

  it('works from a subfolder of the repo', () => {
    const r = exec(fresh('/home/you/p'), 'git init', 'mkdir css', 'cd css', 'touch a.css', 'git status -s');
    expect(out(r.last)).toBe('?? ./');
  });
});
