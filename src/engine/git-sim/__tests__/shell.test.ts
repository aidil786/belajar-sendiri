import { describe, expect, it } from 'vitest';
import { exec, expectFail, expectOk, fresh, out } from './helpers';

describe('shell commands', () => {
  it('pwd prints the current folder', () => {
    const { last } = exec(fresh(), 'pwd');
    expect(out(last)).toBe('/home/you');
  });

  it('mkdir + cd + pwd', () => {
    const { last, state } = exec(fresh(), 'mkdir diary', 'cd diary', 'pwd');
    expect(out(last)).toBe('/home/you/diary');
    expect(state.cwd).toBe('/home/you/diary');
  });

  it('cd .. and cd ~ and cd -', () => {
    const r = exec(fresh(), 'mkdir -p a/b', 'cd a/b', 'cd ..');
    expect(r.state.cwd).toBe('/home/you/a');
    expect(exec(r.state, 'cd ~').state.cwd).toBe('/home/you');
    expect(exec(r.state, 'cd').state.cwd).toBe('/home/you');
    const back = exec(r.state, 'cd /home', 'cd -');
    expect(back.state.cwd).toBe('/home/you/a');
    expect(out(back.last)).toBe('/home/you/a');
  });

  it('cd into a missing folder fails kindly', () => {
    const { last } = exec(fresh(), 'cd nowhere');
    expectFail(last, 'noSuchPath');
    expect(out(last)).toBe('cd: nowhere: No such file or directory');
    expect(last.explain?.key).toBe('sim.err.noSuchPath');
  });

  it('cd into a file fails', () => {
    expectFail(exec(fresh(), 'touch a.txt', 'cd a.txt').last, 'notADir');
  });

  it('mkdir errors: exists, missing parent, missing operand', () => {
    expect(out(exec(fresh(), 'mkdir a', 'mkdir a').last)).toContain('File exists');
    expect(out(exec(fresh(), 'mkdir a/b').last)).toContain('No such file or directory');
    expectFail(exec(fresh(), 'mkdir').last, 'missingOperand');
    expectOk(exec(fresh(), 'mkdir -p a/b/c', 'cd a/b/c').last);
  });

  it('ls hides dot files unless -a, and shows .git for a repo', () => {
    const s = exec(fresh(), 'mkdir p', 'cd p', 'git init', 'touch index.html', 'echo x > .gitignore').state;
    expect(out(exec(s, 'ls').last)).toBe('index.html');
    expect(out(exec(s, 'ls -a').last)).toBe('.  ..  .git  .gitignore  index.html');
  });

  it('ls lists folders and a given path; bad option and bad path fail', () => {
    const s = exec(fresh(), 'mkdir docs', 'touch readme.md').state;
    expect(out(exec(s, 'ls').last)).toBe('docs  readme.md');
    expect(exec(s, 'ls').last.output[0]?.[0]).toEqual({ t: 'docs', c: 'blue' });
    expect(out(exec(s, 'ls docs').last)).toBe('');
    expectFail(exec(s, 'ls -l').last, 'lsOption');
    expectFail(exec(s, 'ls nope').last, 'noSuchPath');
  });

  it('touch, echo >, echo >>, cat', () => {
    const r = exec(fresh(), 'touch a.txt', 'echo "Hello there" > b.txt', "echo 'line 2' >> b.txt", 'cat b.txt');
    expect(out(r.last)).toBe('Hello there\nline 2');
    expect(r.state.fs.files['/home/you/a.txt']).toBe('');
    expect(r.state.fs.files['/home/you/b.txt']).toBe('Hello there\nline 2\n');
    expect(r.all[1]!.events).toEqual([{ type: 'fileCreated', path: '/home/you/b.txt' }]);
    expect(r.all[2]!.events).toEqual([{ type: 'fileChanged', path: '/home/you/b.txt' }]);
  });

  it('echo without redirect prints; touch in missing folder fails', () => {
    expect(out(exec(fresh(), 'echo hi there').last)).toBe('hi there');
    expectFail(exec(fresh(), 'touch x/y.txt').last, 'noSuchPath');
    expectFail(exec(fresh(), 'echo hi > x/y.txt').last, 'noSuchPath');
  });

  it('cat errors', () => {
    expectFail(exec(fresh(), 'cat nope.txt').last, 'noSuchPath');
    expectFail(exec(fresh(), 'mkdir d', 'cat d').last, 'isADir');
    expectFail(exec(fresh(), 'cat').last, 'missingOperand');
  });

  it('rm removes files; folders need -r', () => {
    const s = exec(fresh(), 'mkdir d', 'touch d/a.txt', 'touch b.txt').state;
    expect(exec(s, 'rm b.txt').state.fs.files['/home/you/b.txt']).toBeUndefined();
    expectFail(exec(s, 'rm d').last, 'isADir');
    const r = exec(s, 'rm -r d');
    expectOk(r.last);
    expect(r.state.fs.dirs).not.toContain('/home/you/d');
    expectFail(exec(s, 'rm nope').last, 'noSuchPath');
    expectOk(exec(s, 'rm -f nope').last);
  });

  it('rm -rf .git deletes the repo', () => {
    const s = exec(fresh(), 'mkdir p', 'cd p', 'git init', 'rm -rf .git').state;
    expect(s.repos['/home/you/p']).toBeUndefined();
    expectFail(exec(s, 'git status').last, 'notARepo');
  });

  it('clear emits an event; help lists commands', () => {
    expect(exec(fresh(), 'clear').last.events).toEqual([{ type: 'cleared' }]);
    expect(out(exec(fresh(), 'help').last)).toContain('pwd');
  });
});
