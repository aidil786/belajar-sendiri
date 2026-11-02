// Scenarios: a project folder (files) plus setup steps, replayed the same way every time.
import { initialState, run } from './run';
import type { TofuScenario, TofuState } from './types';

export class ScenarioError extends Error {}

/** Build a scenario's starting state. Every command step must succeed (an answer step follows a question). */
export function buildTofuScenario(sc: TofuScenario): TofuState {
  let st = initialState(sc.files, { seed: sc.seed ?? 1, ...(sc.dir ? { dir: sc.dir } : {}) });
  for (const step of sc.steps ?? []) {
    if (typeof step === 'string') {
      const r = run(st, step, { noColor: true });
      if (!r.ok && !r.stopped) {
        throw new ScenarioError(`Scenario ${sc.id}: step failed: ${step}\n${r.output.map((l) => l.map((x) => x.t).join('')).join('\n')}`);
      }
      st = r.state;
    } else if ('write' in step) st = { ...st, files: { ...st.files, [step.write]: step.content } };
    else st = { ...st, files: Object.fromEntries(Object.entries(st.files).filter(([k]) => k !== step.delete)) };
  }
  return st;
}

const cache = new Map<string, TofuState>();
/** Cached build (scenarios are pure data, so the same id always builds the same state). */
export function buildTofuScenarioCached(sc: TofuScenario): TofuState {
  const hit = cache.get(sc.id);
  if (hit) return structuredClone(hit);
  const st = buildTofuScenario(sc);
  cache.set(sc.id, st);
  return structuredClone(st);
}
