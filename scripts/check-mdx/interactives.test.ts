import { describe, expect, it } from 'vitest';
import { checkNewInteractive } from './interactives';

const ok = (name: string, props: Record<string, unknown>) => checkNewInteractive(name, props, 'x.mdx:1');

describe('MDX checks for the newer interactives', () => {
  it('Transcript', () => {
    expect(ok('Transcript', { lines: [{ cmd: 'gh --version' }], label: 'x' })).toEqual([]);
    expect(ok('Transcript', { lines: [{}], label: 'x' })[0]).toContain('needs cmd or out');
    expect(ok('Transcript', { lines: [{ out: 'x', color: 'pink' }], label: 'x' })[0]).toContain('unknown color');
  });

  it('PracticeRepo', () => {
    const base = {
      repo: { owner: 'a', name: 'b', files: [{ path: 'README.md', content: '' }] },
      issues: [{ number: 1, title: 't', body: 'b', state: 'open', author: 'x' }],
      pulls: [{ number: 2, title: 't', body: 'b', author: 'x', from: 'f', to: 'main', state: 'open' }],
    };
    expect(ok('PracticeRepo', { ...base, task: { type: 'merge', pr: 2 } })).toEqual([]);
    expect(ok('PracticeRepo', { ...base, task: { type: 'merge', pr: 9 } })[0]).toContain('not in pulls');
    expect(ok('PracticeRepo', { ...base, task: { type: 'openFile', path: 'nope.md' } })[0]).toContain('not in repo.files');
    expect(ok('PracticeRepo', { ...base, screen: 'wiki' })[0]).toContain('unknown screen');
    expect(ok('PracticeRepo', { ...base, task: { type: 'close', issue: 1 }, issues: [{ ...base.issues[0], state: 'closed' }] })[0]).toContain('already done');
  });

  it('MarkdownPlayground', () => {
    expect(ok('MarkdownPlayground', { goal: { mustMatch: ['^## '] } })).toEqual([]);
    expect(ok('MarkdownPlayground', { goal: { mustMatch: ['('] } })[0]).toContain('not valid');
    expect(ok('MarkdownPlayground', { initial: '## Hi', goal: { mustMatch: ['^## '] } })[0]).toContain('already met');
  });

  it('YamlBuilder', () => {
    const blocks = [
      { id: 'on', kind: 'trigger', label: 'Push', yaml: 'push:', means: 'm' },
      { id: 'job', kind: 'job', label: 'Job', yaml: 'test:\n  runs-on: ubuntu-latest', means: 'm' },
      { id: 'co', kind: 'step', label: 'Checkout', yaml: '- uses: actions/checkout@v7', means: 'm' },
    ];
    expect(ok('YamlBuilder', { workflow: 'CI', blocks, goal: { order: ['on', 'job', 'co'] } })).toEqual([]);
    expect(ok('YamlBuilder', { workflow: 'CI', blocks, goal: { order: ['on', 'nope'] } })[0]).toContain('unknown block');
    expect(ok('YamlBuilder', { workflow: 'CI', blocks: [...blocks, blocks[0]], goal: { order: ['on'] } })[0]).toContain('two blocks');
  });

  it('MissionCheck', () => {
    expect(ok('MissionCheck', { checks: [{ type: 'repo', label: 'x' }] })).toEqual([]);
    expect(ok('MissionCheck', { checks: [{ type: 'stars', label: 'x' }] })[0]).toContain('unknown type');
    expect(ok('MissionCheck', { checks: [{ type: 'file', label: 'x' }] })[0]).toContain('needs a path');
  });
});
