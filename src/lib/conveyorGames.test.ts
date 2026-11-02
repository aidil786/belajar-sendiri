// Pure logic of the CI/CD games: ConveyorBelt tasks, SpotTheHole lines, TrafficDial numbers.
import { describe, expect, it } from 'vitest';
import { runScenario, type ConveyorScenario } from '~/engine/conveyor-sim';
import { scenarios } from '~/content/courses/cicd/scenarios';
import { applyFix, checkConveyorProps, fixRange, judgeRun, predictAnswer, realError, runNote, type FixOption } from './conveyorBelt';
import { checkHoleProps, holeLines } from './spotTheHole';
import { dialConfig, dialVerdict, keepOld, nextStep, playAll, playMinute, rollback, setWeight, smokeTest, spikeAt, startDial } from './trafficDial';
import { checkConveyorInteractive } from '../../scripts/check-mdx/conveyor-interactives';

const sc = (id: string) => scenarios[id] as ConveyorScenario;
const FIXES: FixOption[] = [
  { label: 'contents: write', text: 'permissions:\n  contents: write', why: 'Not packages.' },
  { label: 'write-all', text: 'permissions: write-all', why: 'Every key.', correct: false },
  { label: 'packages: write', text: 'permissions:\n  contents: read\n  packages: write' },
];

describe('ConveyorBelt logic', () => {
  it('green task: a failing run is a miss with the plain reason; write-all is green but not safe', () => {
    const s = sc('c2-fix-permissions');
    const red = runScenario(s, 'push-main');
    expect(judgeRun({ task: { type: 'green' }, result: red, yaml: s.workflow })).toMatchObject({ done: false, wrong: true, note: { key: 'conveyor.why.packagesWrite' } });
    expect(realError(red)).toContain('denied: permission_denied: write_package');
    const allYaml = applyFix(s, FIXES[1]!.text);
    const all = runScenario(s, 'push-main', { yaml: allYaml });
    expect(all.status).toBe('success');
    expect(judgeRun({ task: { type: 'green' }, result: all, yaml: allYaml, option: FIXES[1]! })).toMatchObject({ done: false, note: { key: 'conveyor.task.greenNotSafe' }, extra: 'Every key.' });
    expect(judgeRun({ task: { type: 'green', forbid: ['write-all'] }, result: all, yaml: allYaml })).toMatchObject({ done: false, wrong: true });
    const goodYaml = applyFix(s, FIXES[2]!.text);
    expect(judgeRun({ task: { type: 'green' }, result: runScenario(s, 'push-main', { yaml: goodYaml }), yaml: goodYaml, option: FIXES[2]! }).done).toBe(true);
    expect(fixRange(s, FIXES[2]!.text)).toEqual([5, 7]);
  });

  it('predict: the answer is the first red station', () => {
    const s = sc('c1-broken-test');
    const answer = predictAnswer(s, 'push-main');
    expect(answer?.kind).toBe('test');
    const r = runScenario(s, 'push-main');
    expect(judgeRun({ task: { type: 'predict' }, result: r, yaml: s.workflow, pick: answer!.id, firstFailed: answer }).done).toBe(true);
    expect(judgeRun({ task: { type: 'predict' }, result: r, yaml: s.workflow, pick: 'none', firstFailed: answer })).toMatchObject({ done: false, wrong: true });
  });

  it('event, approve and cacheHit tasks', () => {
    const c1 = sc('c1-first-pipeline');
    const nope = runScenario(c1, 'push-branch');
    expect(runNote(nope)).toEqual({ key: 'conveyor.why.branchFilter', params: { branch: 'feature' } });
    expect(judgeRun({ task: { type: 'event', result: 'notTriggered' }, result: nope, yaml: c1.workflow }).done).toBe(true);
    const first = runScenario(c1, 'push-main');
    expect(judgeRun({ task: { type: 'cacheHit' }, result: first, yaml: c1.workflow }).done).toBe(false);
    const second = runScenario(c1, 'push-main', { world: { cache: { warm: true } } });
    expect(judgeRun({ task: { type: 'cacheHit' }, result: second, yaml: c1.workflow }).done).toBe(true);
    const c3 = sc('c3-release');
    expect(judgeRun({ task: { type: 'approve' }, result: runScenario(c3, 'tag', { decisions: { production: 'approve' } }), yaml: c3.workflow }).done).toBe(true);
    expect(judgeRun({ task: { type: 'event', job: 'production', result: 'skipped' }, result: runScenario(sc('c3-canary'), 'tag'), yaml: '' }).done).toBe(true);
  });

  it('checkConveyorProps catches impossible tasks', () => {
    expect(checkConveyorProps({ task: { type: 'green' }, fixes: FIXES }, sc('c2-fix-permissions'))).toEqual([]);
    expect(checkConveyorProps({ task: { type: 'green' }, fixes: [FIXES[0]!, FIXES[1]!] }, sc('c2-fix-permissions'))).toEqual(['green: no fix option turns the run green']);
    expect(checkConveyorProps({ task: { type: 'green' } }, sc('c1-first-pipeline'))).toEqual(['green: some event already passes, so there is nothing to fix']);
    expect(checkConveyorProps({ task: { type: 'approve' } }, sc('c1-first-pipeline'))[0]).toMatch(/^approve:/);
    expect(checkConveyorProps({ task: { type: 'cacheHit' } }, sc('c1-first-pipeline'))).toEqual([]);
    expect(checkConveyorProps({ editable: true }, sc('c1-first-pipeline'))).toEqual(['editable/fixes need a scenario with `fix` lines']);
    expect(checkConveyorProps({ event: 'tag' }, sc('c1-first-pipeline'))).toEqual(['event "tag" is not in events']);
  });

  it('check:mdx wiring: outside the cicd course, a scenario needs course="cicd"', () => {
    expect(checkConveyorInteractive('ConveyorBelt', { scenario: 'c1-broken-test', task: { type: 'predict' } }, 'x')).toEqual(['x: ConveyorBelt scenario "c1-broken-test" needs course="cicd" (outside the cicd course)']);
    expect(checkConveyorInteractive('ConveyorBelt', { scenario: 'c1-broken-test', task: { type: 'predict' } }, 'x', 'cicd')).toEqual([]);
    expect(checkConveyorInteractive('ConveyorBelt', { course: 'cicd', scenario: 'c1-broken-test', task: { type: 'predict' } }, 'x')).toEqual([]);
    expect(checkConveyorInteractive('SpotTheHole', { course: 'cicd', scenario: 'c4-vulnerable' }, 'x')).toEqual([]);
    expect(checkConveyorInteractive('TrafficDial', { mode: 'canary', newErrorRate: 0.001, task: { type: 'rollback' } }, 'x')[0]).toMatch(/needs a buggy release/);
  });
});

describe('SpotTheHole logic', () => {
  const lines = ['on: issues', 'jobs:', '  a:', '    runs-on: ubuntu-latest', '    steps:', { text: '      - run: echo "${{ github.event.issue.title }}"', hole: { kind: 'injection' as const } }];
  it('numbers lines and keeps hole metadata', () => {
    expect(holeLines(lines).map((l) => `${l.n}:${l.hole?.kind ?? ''}`)).toEqual(['1:', '2:', '3:', '4:', '5:', '6:injection']);
  });
  it('marked holes must agree with the audit', () => {
    expect(checkHoleProps({ workflow: lines }, undefined)).toEqual([]);
    expect(checkHoleProps({ workflow: lines.slice(0, 5).concat(['      - run: echo "${{ github.event.issue.title }}"']) }, undefined)).toEqual([
      'mark at least one line with a hole',
      'line 6 has a hole (injection) that is not marked',
    ]);
    expect(checkHoleProps({ workflow: ['on: push', { text: 'jobs: {}', hole: { kind: 'writeAll' as const } }] }, undefined)[0]).toMatch(/doesn't find it/);
  });
});

describe('TrafficDial logic', () => {
  const cfg = dialConfig({ mode: 'canary', newErrorRate: 0.08, task: { type: 'rollback', maxHurt: 150 } });

  it('a canary at 5% shows the spike with few users hurt; rolling back wins', () => {
    let s = playAll(setWeight(startDial(), cfg, 5), cfg);
    expect(s.minutes).toHaveLength(4);
    expect(spikeAt(s, cfg)).toBe(1);
    expect(s.hurt).toBeLessThan(30);
    expect(dialVerdict(s, cfg, { type: 'rollback' })).toBe('playing');
    s = rollback(s, cfg);
    expect(dialVerdict(s, cfg, { type: 'rollback' })).toBe('win');
    s = playAll(s, cfg);
    expect(s.minutes.at(-1)!.newReq).toBe(0);
  });

  it('pushing on to 50% hurts too many users', () => {
    let s = startDial();
    for (const w of [5, 25, 50]) s = playAll(setWeight(s, cfg, w), cfg);
    expect(s.hurt).toBeGreaterThan(150);
    expect(dialVerdict(s, cfg, { type: 'rollback' })).toBe('tooLate');
  });

  it('steps go up one at a time; numbers are the same every time', () => {
    expect(nextStep(startDial(), cfg)).toBe(5);
    expect(nextStep(playAll(setWeight(startDial(), cfg, 25), cfg), cfg)).toBe(50);
    const a = playMinute(setWeight(startDial(), cfg, 25), cfg);
    const b = playMinute(setWeight(startDial(), cfg, 25), cfg);
    expect(a).toEqual(b);
  });

  it('a healthy rollout reaches 100% with no spike', () => {
    const ok = dialConfig({ newErrorRate: 0.002, task: { type: 'rollout' } });
    let s = startDial();
    for (const w of ok.steps) s = playAll(setWeight(s, ok, w), ok);
    expect(spikeAt(s, ok)).toBeNull();
    expect(dialVerdict(s, ok, { type: 'rollout' })).toBe('win');
  });

  it('blue/green: a private smoke test, then keep the old version', () => {
    const bg = dialConfig({ mode: 'bluegreen', newErrorRate: 0.1, task: { type: 'rollback' } });
    expect(bg.steps).toEqual([100]);
    const s = smokeTest(startDial(), bg);
    expect(s.smoke).toEqual({ requests: 20, errors: 2 });
    expect(s.hurt).toBe(0);
    expect(dialVerdict(keepOld(s), bg, { type: 'rollback' })).toBe('win');
  });
});
