// Observability course scenarios, by id. Lessons refer to them as `scenario="o2-shop-requests"`.
// Shape: ObsScenario (src/engine/promql-sim/scenario.ts: series in promtool notation, rules, verify
// lists). `npm run verify:promql` checks every scenario's verify list against the real promtool.
// Lesson helpers: add your world's scenarios in their own file (e.g. o2.ts) and spread them in below
// (one line per world). Components find them with findScenario<T>('observability', id).
import type { ObsScenario } from '~/engine/promql-sim';
import { examples } from './examples';
import { o1 } from './o1';
import { o2 } from './o2';
import { o3 } from './o3';
import { o4 } from './o4';

export const allObsScenarios: ObsScenario[] = [
  ...examples,
  ...o1,
  ...o2,
  ...o3,
  ...o4,
];

/** The same list, under the name the other course registries use. */
export const allScenarios = allObsScenarios;

export const scenarios: Record<string, ObsScenario> = Object.fromEntries(allObsScenarios.map((s) => [s.id, s]));
