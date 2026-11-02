// Every scenario builds, and every verify list runs cleanly in the engine.
import { describe, expect, it } from 'vitest';
import { buildScenario, plain, run } from '~/engine/git-sim';
import { allScenarios } from './index';

describe('git course scenarios', () => {
  it('have unique ids', () => {
    const ids = allScenarios.map((s) => s.id);
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
  });

  for (const s of allScenarios) {
    it(`${s.id} builds and its verify commands succeed`, () => {
      const start = buildScenario(s);
      for (const seq of s.verify ?? []) {
        let state = start;
        for (const cmd of seq) {
          const r = run(state, cmd);
          // A merge/rebase conflict is Git stopping for the learner, not a failure.
          expect(r.ok || Boolean(r.stopped), `${s.id}: "${cmd}" failed:\n${plain(r.output)}`).toBe(true);
          state = r.state;
        }
      }
    });
  }
});
