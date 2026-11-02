// Reading workflow YAML: kind validation messages with line numbers, expressions, triggers.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { evalIf, evaluate, globMatch, interpolate, matchList, matchTrigger, parseWorkflow, presetTrigger, type ExprContext, type Value } from '../index';
import en from '../../../i18n/en.json';
import ms from '../../../i18n/ms.json';

const keys = (text: string) => parseWorkflow(text).issues.map((i) => `${i.level}:${i.key}@${i.line ?? '?'}`);

const ok = `name: CI
on: push
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - run: npm test
`;

describe('parseWorkflow', () => {
  it('reads a small workflow with no issues', () => {
    const { workflow, issues } = parseWorkflow(ok);
    expect(issues).toEqual([]);
    expect(workflow!.name).toBe('CI');
    expect(Object.keys(workflow!.on)).toEqual(['push']);
    expect(workflow!.jobs[0]!.steps.map((s) => s.uses ?? s.run)).toEqual(['actions/checkout@v7', 'npm test']);
    expect(workflow!.jobs[0]!.steps[1]!.runLines).toEqual([8, 8]);
  });

  it('unknown keys are errors with the line and the real GitHub words', () => {
    const r = parseWorkflow(ok.replace('    runs-on: ubuntu-latest', '    runs_on: ubuntu-latest'));
    const unknown = r.issues.find((i) => i.key === 'conveyor.issue.unknownKey')!;
    expect(unknown).toMatchObject({ level: 'error', line: 5, params: { key: 'runs_on' }, real: "Unexpected value 'runs_on'" });
    expect(r.issues.some((i) => i.key === 'conveyor.issue.missing' && i.params?.key === 'runs-on')).toBe(true);
  });

  it('YAML syntax errors give a line', () => {
    const r = parseWorkflow('on: push\njobs:\n  a:\n    steps:\n      - run: echo "a: b" : c\n');
    expect(r.workflow).toBeNull();
    expect(r.issues[0]).toMatchObject({ level: 'error', key: 'conveyor.issue.yaml' });
    expect(r.issues[0]!.line).toBeGreaterThan(0);
  });

  it('needs: unknown job and cycles', () => {
    expect(keys(`on: push\njobs:\n  a:\n    needs: b\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n`)).toContain('error:conveyor.issue.unknownNeed@3');
    const cyc = `on: push\njobs:\n  a:\n    needs: b\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo a\n  b:\n    needs: a\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo b\n`;
    expect(keys(cyc).some((k) => k.startsWith('error:conveyor.issue.cycle'))).toBe(true);
  });

  it('runner labels, permissions, filters and concurrency are checked', () => {
    expect(keys(ok.replace('ubuntu-latest', 'ubuntu-lastest'))).toContain('error:conveyor.issue.badLabel@5');
    expect(keys(ok.replace('on: push', 'on: push\npermissions:\n  package: write'))).toContain('error:conveyor.issue.badScope@4');
    expect(keys(ok.replace('on: push', 'on: push\npermissions:\n  contents: admin'))).toContain('error:conveyor.issue.badLevel@4');
    expect(keys(ok.replace('on: push', 'on:\n  push:\n    branches: [main]\n    branches-ignore: [x]'))).toContain('error:conveyor.issue.bothFilters@3');
    expect(keys(ok.replace('on: push', 'on: push\nconcurrency:\n  group: ci\n  cancel-in-progress: true\n  queue: max'))).toContain('error:conveyor.issue.queueMaxCancel@6');
    expect(keys(ok.replace('on: push', 'on: pushh'))).toContain('error:conveyor.issue.unknownEvent@2');
  });

  it('steps need uses or run; expressions must parse', () => {
    expect(keys(ok.replace('      - run: npm test', '      - name: nothing'))).toContain('error:conveyor.issue.stepEmpty@8');
    expect(keys(ok.replace('npm test', 'echo ${{ github.ref == }}'))).toContain('error:conveyor.issue.exprSyntax@8');
    expect(keys(ok.replace('npm test', 'echo ${{ github.ref'))).toContain('error:conveyor.issue.exprUnclosed@8');
  });

  it('old majors and unknown actions are warnings, not errors', () => {
    expect(keys(ok.replace('checkout@v7', 'checkout@v4'))).toEqual(['warning:conveyor.issue.oldMajor@7']);
    expect(keys(ok.replace('actions/checkout@v7', 'some/thing@v1'))).toEqual(['info:conveyor.issue.unknownAction@7']);
    expect(keys(ok.replace('actions/checkout@v7', 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1'))).toEqual([]);
    expect(keys(ok.replace('      - uses: actions/checkout@v7', '      - uses: actions/checkout@v7\n        with:\n          fetch_depth: 0'))).toEqual(['warning:conveyor.issue.unknownInput@7']);
  });
});

describe('expressions', () => {
  const ctx = (status: ExprContext['status'] = 'success'): ExprContext => ({
    context: (n): Value | undefined =>
      ({
        github: { ref: 'refs/heads/main', event_name: 'push', event: { commits: [{ message: 'a' }, { message: 'b' }] } },
        needs: { build: { result: 'success', outputs: { tag: 'v1' } } },
        matrix: { node: 24 },
      })[n] as Value | undefined,
    status,
    hashFiles: () => 'abc123',
  });

  it('compares like GitHub: strings without case, numbers loosely', () => {
    expect(evaluate("github.ref == 'REFS/HEADS/MAIN'", ctx())).toBe(true);
    expect(evaluate("matrix.node == '24'", ctx())).toBe(true);
    expect(evaluate("needs.build.result == 'success' && needs.build.outputs.tag", ctx())).toBe('v1');
    expect(evaluate("contains(github.event.commits.*.message, 'b')", ctx())).toBe(true);
    expect(evaluate("startsWith(github.ref, 'refs/tags/') || 'no'", ctx())).toBe('no');
    expect(evaluate("format('{0}-{1}', 'a', 1)", ctx())).toBe('a-1');
    expect(interpolate("key-${{ hashFiles('**/package-lock.json') }}", ctx())).toBe('key-abc123');
  });

  it('if: adds success() unless a status function is used', () => {
    expect(evalIf("github.event_name == 'push'", ctx())).toBe(true);
    expect(evalIf("github.event_name == 'push'", ctx('failure'))).toBe(false);
    expect(evalIf('failure()', ctx('failure'))).toBe(true);
    expect(evalIf('always()', ctx('cancelled'))).toBe(true);
    expect(evalIf("${{ github.ref == 'refs/heads/main' }}", ctx())).toBe(true);
    expect(evalIf(undefined, ctx('failure'))).toBe(false);
  });
});

describe('filters and triggers', () => {
  it('glob patterns follow the cheat sheet', () => {
    expect(globMatch('feature/*', 'feature/login')).toBe(true);
    expect(globMatch('feature/*', 'feature/a/b')).toBe(false);
    expect(globMatch('feature/**', 'feature/a/b')).toBe(true);
    expect(globMatch('v[12].*', 'v2.0')).toBe(true);
    expect(globMatch('**.js', 'src/app.js')).toBe(true);
    expect(matchList(['releases/**', '!releases/**-alpha'], 'releases/1.0-alpha')).toBe(false);
    expect(matchList(['releases/**', '!releases/**-alpha'], 'releases/1.0')).toBe(true);
  });

  const wf = (on: string) => parseWorkflow(ok.replace('on: push', on)).workflow!;
  const hit = (on: string, t: Parameters<typeof matchTrigger>[1]) => {
    const m = matchTrigger(wf(on), t);
    return m.ok ? 'run' : m.why.key.replace('conveyor.why.', '');
  };

  it('branches, tags and paths', () => {
    const branches = 'on:\n  push:\n    branches: [main]';
    expect(hit(branches, presetTrigger('push-main'))).toBe('run');
    expect(hit(branches, presetTrigger('push-branch'))).toBe('branchFilter');
    expect(hit(branches, presetTrigger('tag'))).toBe('onlyBranches');
    expect(hit('on:\n  push:\n    tags: [v*]', presetTrigger('push-main'))).toBe('onlyTags');
    expect(hit('on:\n  push:\n    tags: [v*]', presetTrigger('tag'))).toBe('run');
    expect(hit('on:\n  push:\n    paths: [docs/**]', presetTrigger('push-main'))).toBe('pathFilter');
    expect(hit('on:\n  push:\n    paths-ignore: [docs/**]', presetTrigger('push-main', { changed: ['docs/a.md'] }))).toBe('pathIgnored');
    expect(hit('on:\n  push:\n    branches-ignore: [main]', presetTrigger('push-main'))).toBe('branchIgnored');
  });

  it('pull requests: base branch, types, and pull_request_target', () => {
    expect(hit('on:\n  pull_request:\n    branches: [main]', presetTrigger('pr'))).toBe('run');
    expect(hit('on:\n  pull_request:\n    branches: [release]', presetTrigger('pr'))).toBe('baseFilter');
    expect(hit('on:\n  pull_request:\n    types: [closed]', presetTrigger('pr'))).toBe('typeFilter');
    expect(hit('on: push', presetTrigger('pr'))).toBe('noEvent');
    const m = matchTrigger(wf('on: pull_request_target'), presetTrigger('fork-pr'));
    expect(m).toEqual({ ok: true, eventName: 'pull_request_target' });
  });
});

describe('i18n', () => {
  it('every conveyor.* key the engine uses exists in both languages', () => {
    const dir = 'src/engine/conveyor-sim';
    const files = readdirSync(dir).map((n) => join(dir, n)).filter((p) => statSync(p).isFile() && p.endsWith('.ts'));
    const used = new Set<string>();
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/'(conveyor\.(?:issue|why|note)\.[A-Za-z]+)'/g)) used.add(m[1]!);
      // why('key') and `conveyor.why.${key}` helpers in events.ts / steps.ts
      for (const m of src.matchAll(/\bwhy\('([A-Za-z]+)'/g)) used.add(`conveyor.why.${m[1]}`);
      for (const m of src.matchAll(/\bmiss\('([A-Za-z]+)'/g)) used.add(`conveyor.why.${m[1]}`);
    }
    expect(used.size).toBeGreaterThan(40);
    const missing = [...used].filter((k) => !(k in en) || !(k in ms));
    expect(missing).toEqual([]);
  });
});
