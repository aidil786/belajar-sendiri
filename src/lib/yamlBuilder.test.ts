import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { buildYaml, checkOrder, highlightYaml, pipeline, yamlString, type YamlBlock } from './yamlBuilder';

const B: Record<string, YamlBlock> = {
  push: { id: 'push', kind: 'trigger', label: 'On push to main', yaml: 'push:\n  branches: [main]', means: 'Run when someone pushes to main.' },
  pr: { id: 'pr', kind: 'trigger', label: 'On pull request', yaml: 'pull_request:', means: 'Run for every pull request.' },
  perms: { id: 'perms', kind: 'permissions', label: 'Read-only token', yaml: 'contents: read', means: 'The robot can only read the code.' },
  env: { id: 'env', kind: 'env', label: 'Production mode', yaml: 'NODE_ENV: production', means: 'Set a variable.' },
  job: { id: 'job', kind: 'job', label: 'Job: test', yaml: 'test:\n  runs-on: ubuntu-latest', means: 'A fresh Linux computer.' },
  deploy: { id: 'deploy', kind: 'job', label: 'Job: deploy', yaml: 'deploy:\n  needs: test\n  runs-on: ubuntu-latest', means: 'Deploy after tests.' },
  checkout: { id: 'checkout', kind: 'step', label: 'Check out code', yaml: '- uses: actions/checkout@v7', means: 'Copy the code onto the robot.' },
  node: { id: 'node', kind: 'step', label: 'Set up Node', yaml: 'uses: actions/setup-node@v7\nwith:\n  node-version: 24', means: 'Install Node.' },
  install: { id: 'install', kind: 'step', label: 'Install', yaml: 'run: npm ci', means: 'Install packages.' },
  test: { id: 'test', kind: 'step', label: 'Run tests', yaml: '- name: Run tests\n  run: npm test', means: 'Run the tests.' },
  publish: { id: 'publish', kind: 'step', label: 'Publish', yaml: 'run: npm run deploy', means: 'Ship it.' },
};
const pick = (...ids: string[]) => ids.map((id) => B[id]!);

describe('buildYaml', () => {
  it('the goal order makes a valid workflow with the right shape', () => {
    const text = buildYaml('CI', pick('push', 'pr', 'perms', 'job', 'checkout', 'node', 'install', 'test'));
    const doc = parse(text);
    expect(doc).toEqual({
      name: 'CI',
      on: { push: { branches: ['main'] }, pull_request: null },
      permissions: { contents: 'read' },
      jobs: {
        test: {
          'runs-on': 'ubuntu-latest',
          steps: [
            { uses: 'actions/checkout@v7' },
            { uses: 'actions/setup-node@v7', with: { 'node-version': 24 } },
            { run: 'npm ci' },
            { name: 'Run tests', run: 'npm test' },
          ],
        },
      },
    });
  });

  it('exact text: keys, nesting and two-space indents', () => {
    expect(buildYaml('CI', pick('push', 'job', 'checkout', 'test'))).toBe(
      [
        'name: CI',
        'on:',
        '  push:',
        '    branches: [main]',
        'jobs:',
        '  test:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - uses: actions/checkout@v7',
        '      - name: Run tests',
        '        run: npm test',
        '',
      ].join('\n'),
    );
  });

  it('two jobs keep their own steps; env/permissions below a job belong to that job', () => {
    const doc = parse(buildYaml('Ship', pick('push', 'env', 'job', 'checkout', 'deploy', 'perms', 'publish')));
    expect(doc.env).toEqual({ NODE_ENV: 'production' });
    expect(doc.permissions).toBeUndefined();
    expect(doc.jobs.test.steps).toEqual([{ uses: 'actions/checkout@v7' }]);
    expect(doc.jobs.deploy).toEqual({ needs: 'test', 'runs-on': 'ubuntu-latest', permissions: { contents: 'read' }, steps: [{ run: 'npm run deploy' }] });
  });

  it('steps with no job above become comments, and the file still parses', () => {
    const text = buildYaml('CI', pick('push', 'checkout', 'job', 'test'), 'needs a job above');
    expect(text).toContain('  # needs a job above:\n  # - uses: actions/checkout@v7');
    const doc = parse(text);
    expect(doc.jobs.test.steps).toEqual([{ name: 'Run tests', run: 'npm test' }]);
  });

  it('every partial stack still parses as YAML', () => {
    const ids = ['push', 'perms', 'job', 'checkout', 'node', 'test'];
    for (let n = 0; n <= ids.length; n++) expect(() => parse(buildYaml('CI', pick(...ids.slice(0, n))))).not.toThrow();
  });

  it('quotes names YAML would misread', () => {
    expect(yamlString('CI')).toBe('CI');
    expect(yamlString('Build and test')).toBe('Build and test');
    expect(yamlString('Deploy: prod')).toBe('"Deploy: prod"');
    expect(yamlString('#1 build')).toBe('"#1 build"');
    expect(parse(buildYaml('Deploy: "prod" #1', [])).name).toBe('Deploy: "prod" #1');
  });
});

describe('pipeline', () => {
  it('groups steps under the job above them', () => {
    const p = pipeline(pick('test', 'push', 'job', 'checkout', 'deploy', 'publish'));
    expect(p.triggers.map((b) => b.id)).toEqual(['push']);
    expect(p.jobs.map((j) => [j.job.id, j.steps.map((s) => s.id)])).toEqual([
      ['job', ['checkout']],
      ['deploy', ['publish']],
    ]);
    expect(p.orphans.map((b) => b.id)).toEqual(['test']);
  });
});

describe('checkOrder', () => {
  const goal = ['push', 'job', 'checkout', 'test'];
  it('right order', () => expect(checkOrder(goal, [...goal])).toEqual({ ok: true }));
  it('missing blocks', () => expect(checkOrder(goal, ['push', 'job'])).toEqual({ ok: false, reason: 'missing', index: 2, needed: 'checkout' }));
  it('a decoy', () => expect(checkOrder(goal, ['push', 'job', 'publish'])).toEqual({ ok: false, reason: 'decoy', index: 2, id: 'publish' }));
  it('wrong order', () => expect(checkOrder(goal, ['push', 'job', 'test', 'checkout'])).toEqual({ ok: false, reason: 'order', index: 2, id: 'test', belongs: 3 }));
});

describe('highlightYaml', () => {
  it('colours keys, dashes, strings, numbers and comments', () => {
    expect(highlightYaml('      - uses: actions/checkout@v7')).toEqual([
      { t: '      ' },
      { t: '- ', c: 'dash' },
      { t: 'uses', c: 'key' },
      { t: ':', c: 'punct' },
      { t: ' ' },
      { t: 'actions/checkout@v7' },
    ]);
    expect(highlightYaml('  node-version: 24')).toContainEqual({ t: '24', c: 'num' });
    expect(highlightYaml('name: "CI"')).toContainEqual({ t: '"CI"', c: 'str' });
    expect(highlightYaml('  # note')).toEqual([{ t: '  ' }, { t: '# note', c: 'comment' }]);
    expect(highlightYaml('on:')).toEqual([{ t: 'on', c: 'key' }, { t: ':', c: 'punct' }]);
  });

  it('joins back to the same text', () => {
    for (const line of buildYaml('CI', pick('push', 'pr', 'perms', 'job', 'checkout', 'node', 'test')).split('\n')) {
      expect(highlightYaml(line).map((t) => t.t).join('')).toBe(line);
    }
  });
});
