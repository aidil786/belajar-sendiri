// Every Linux scenario builds, its verify lists run to the end in the engine, and each example's
// model task starts unmet and is met after its solution.
import { describe, expect, it } from 'vitest';
import { buildLinuxScenario, checkLinuxGoal, LINUX_GOAL_KEYS, run, usesEngineOnlySteps } from '~/engine/linux-sim';
import { allScenarios, scenarios } from './scenarios';
import { examples } from './scenarios/examples';

describe('linux scenarios', () => {
  it('ids are unique and look like linux-…', () => {
    expect(new Set(allScenarios.map((s) => s.id)).size).toBe(allScenarios.length);
    for (const s of allScenarios) expect(s.id).toMatch(/^linux-[a-z0-9-]+$/);
    expect(Object.keys(scenarios)).toHaveLength(allScenarios.length);
  });

  for (const sc of allScenarios) {
    it(`${sc.id}: builds and every verify list finishes`, () => {
      const st = buildLinuxScenario(sc);
      for (const list of sc.verify ?? []) {
        let s = st;
        for (const c of list) {
          const r = run(s, c);
          s = r.state;
          expect(s.fg, `"${c}" keeps the terminal busy`).toBeNull();
        }
      }
      if (usesEngineOnlySteps(sc)) expect(sc.engineOnly, 'engine-only steps need an engineOnly reason').toBeTruthy();
    });
  }

  it('has about ten examples, each with a model task', () => {
    expect(examples.length).toBeGreaterThanOrEqual(10);
    for (const sc of examples) expect(sc.task, sc.id).toBeTruthy();
  });

  for (const sc of examples) {
    it(`${sc.id}: the task is unmet at the start and met after its solution`, () => {
      const { goal, solution } = sc.task!;
      for (const k of Object.keys(goal)) expect(LINUX_GOAL_KEYS).toContain(k);
      let st = buildLinuxScenario(sc);
      expect(checkLinuxGoal(st, goal, []).ok).toBe(false);
      const typed: string[] = [];
      for (const c of solution) {
        st = run(st, c).state;
        typed.push(c);
      }
      expect(checkLinuxGoal(st, goal, typed).failed).toEqual([]);
    });
  }
});
