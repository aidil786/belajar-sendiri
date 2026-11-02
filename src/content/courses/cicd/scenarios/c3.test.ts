// C3 Release & Deploy scenarios: the runs the lessons rely on end the way the cards say.
// (scenarios.test.ts checks every scenario's `expect`; actionlint runs in `npm run verify:workflows`.)
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { replaceLines, runScenario, type ConveyorScenario, type EventPreset, type RunResult } from '~/engine/conveyor-sim';
import { checkConveyorProps, predictAnswer, realError } from '~/lib/conveyorBelt';
import { buildYaml, type YamlBlock } from '~/lib/yamlBuilder';
import { c3 } from './c3';

const LESSONS = new URL('../c3-release-deploy/', import.meta.url);

/** One JSX attribute of the tag starting at `start`: "text" or {expression} (quote-aware braces). */
function attr(src: string, start: number, key: string): unknown {
  let j = src.indexOf(`${key}=`, start) + key.length + 1;
  if (src[j] === '"') return src.slice(j + 1, src.indexOf('"', j + 1));
  const from = j;
  let depth = 0;
  let quote: string | null = null;
  for (; j < src.length; j++) {
    const ch = src[j]!;
    if (quote) {
      if (ch === '\\') j++;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) break;
  }
  return new Function(`return (${src.slice(from + 1, j)});`)();
}

const byId = (id: string) => c3.find((s) => s.id === id) as ConveyorScenario;
const job = (r: RunResult, id: string) => r.jobs.find((j) => j.id === id)!;
const logOf = (r: RunResult, id: string) => job(r, id).steps.flatMap((s) => s.log.map((l) => l.text));

describe('C3 scenarios', () => {
  it('l03: a reviewer lets production deploy; a feature branch may not deploy at all', () => {
    const s = byId('c3-reviewers');
    expect(runScenario(s, 'push-main', { decisions: { production: 'approve' } }).status).toBe('success');
    const branch = runScenario(s, 'push-branch');
    expect(job(branch, 'test').result).toBe('success');
    expect(job(branch, 'deploy').result).toBe('failure');
    expect(job(branch, 'deploy').log.map((l) => l.text)).toContain('Branch "feature" is not allowed to deploy to production due to environment protection rules.');
    expect(checkConveyorProps({ task: { type: 'event', job: 'deploy', result: 'failure' } }, s)).toEqual([]);
    expect(checkConveyorProps({ task: { type: 'approve' } }, byId('c3-release'))).toEqual([]);
  });

  it('l05: a fork gets no secrets, so its preview cannot deploy', () => {
    const s = byId('c3-preview');
    const ok = runScenario(s, 'pr');
    expect(logOf(ok, 'preview')).toContain('wrangler preview --name "pr-7"');
    const fork = runScenario(s, 'fork-pr');
    expect(realError(fork)).toMatch(/necessary to set a CLOUDFLARE_API_TOKEN/);
    expect(checkConveyorProps({ task: { type: 'event', job: 'preview', result: 'failure' } }, s)).toEqual([]);
  });

  it('l06: only a push to main deploys; the upload names the Worker', () => {
    const s = byId('c3-this-site');
    const main = runScenario(s, 'push-main');
    expect(job(main, 'deploy').result).toBe('success');
    expect(logOf(main, 'deploy')).toContain('Uploaded fahamlah');
    for (const e of ['pr', 'push-branch'] as EventPreset[]) expect(job(runScenario(s, e), 'deploy').result).toBe('skipped');
    expect(checkConveyorProps({ task: { type: 'event', job: 'deploy', result: 'skipped' } }, s)).toEqual([]);
  });

  it('l07 and boss: naming the environment unlocks its token; staging works too, but is the wrong key', () => {
    for (const id of ['c3-env-secret', 'c3-boss-rollback']) {
      const s = byId(id);
      const event = s.events![0]!;
      expect(realError(runScenario(s, event))).toMatch(/CLOUDFLARE_API_TOKEN/);
      const fixed = (text: string) => runScenario(s, event, { yaml: replaceLines(s.workflow, s.fix!.from, s.fix!.to, text) }).status;
      expect(fixed('    runs-on: ubuntu-latest\n    environment: production')).toBe('success');
      expect(fixed('    runs-on: ubuntu-latest\n    permissions: write-all')).toBe('failure');
    }
    const s = byId('c3-env-secret');
    expect(runScenario(s, 'push-main', { yaml: replaceLines(s.workflow, 9, 9, '    runs-on: ubuntu-latest\n    environment: staging') }).status).toBe('success');
  });

  it('l10: curl without --fail lets a broken site pass; with a rollback job, the smoke test stops it', () => {
    const weak = byId('c3-smoke-weak');
    expect(predictAnswer(weak, 'push-main')).toBeNull();
    const r = runScenario(byId('c3-auto-rollback'), 'push-main');
    expect(job(r, 'deploy').result).toBe('failure');
    expect(job(r, 'rollback').result).toBe('success');
    expect(logOf(r, 'rollback')).toContain('wrangler rollback --message "Smoke test failed"');
    expect(predictAnswer(byId('c3-canary'), 'tag')?.id).toBe('canary');
  });

  it('l11: the notify job runs only when the deploy failed', () => {
    const r = runScenario(byId('c3-notify'), 'push-main');
    expect(job(r, 'notify').result).toBe('success');
    const healthy = runScenario({ ...byId('c3-notify'), fail: {} }, 'push-main');
    expect(healthy.status).toBe('success');
    expect(job(healthy, 'notify').result).toBe('skipped');
  });

  it('boss: the canary script only echoes; the smoke test passes', () => {
    const r = runScenario(byId('c3-boss-canary'), 'tag');
    expect(logOf(r, 'canary')).toContain('> deploy:canary');
  });

  it('boss: pasting a token into the job env still leaves the step without one', () => {
    const s = byId('c3-boss-rollback');
    const yaml = replaceLines(s.workflow, 8, 8, '    runs-on: ubuntu-latest\n    env:\n      CLOUDFLARE_API_TOKEN: paste-token-here');
    expect(runScenario(s, 'dispatch', { yaml }).status).toBe('failure');
  });

  it('every YamlBuilder in the C3 lessons builds a registered scenario (so actionlint checks it)', () => {
    const workflows = new Set(c3.map((s) => s.workflow));
    let found = 0;
    for (const dir of readdirSync(LESSONS)) {
      for (const lang of ['en', 'ms']) {
        const src = readFileSync(new URL(`${dir}/${lang}.mdx`, LESSONS), 'utf8');
        for (let at = src.indexOf('name="YamlBuilder"'); at >= 0; at = src.indexOf('name="YamlBuilder"', at + 1)) {
          const goal = attr(src, at, 'goal') as { order: string[] };
          const blocks = attr(src, at, 'blocks') as YamlBlock[];
          const yaml = buildYaml(attr(src, at, 'workflow') as string, goal.order.map((id) => blocks.find((b) => b.id === id)!));
          expect(workflows.has(yaml), `${dir}/${lang}.mdx builds:\n${yaml}`).toBe(true);
          found++;
        }
      }
    }
    expect(found).toBeGreaterThan(0);
  });

  it('mission 3: a good tag waits for production; a bad tag rolls staging back', () => {
    const good = runScenario(byId('c3-mission'), 'tag');
    expect(job(good, 'canary').result).toBe('success');
    expect(logOf(good, 'canary')).toContain('Uploaded kedai-kancil-staging');
    expect(runScenario(byId('c3-mission'), 'tag', { decisions: { production: 'approve' } }).status).toBe('success');
    const bad = runScenario(byId('c3-mission-bad'), 'tag');
    expect(job(bad, 'canary').result).toBe('failure');
    expect(job(bad, 'production').result).toBe('skipped');
    expect(job(bad, 'rollback').result).toBe('success');
    expect(realError(bad)).toMatch(/curl: \(22\)/);
  });
});
