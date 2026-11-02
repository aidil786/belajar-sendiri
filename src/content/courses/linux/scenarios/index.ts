// linux course scenarios, by id. Lessons refer to them as `scenario="linux-home"`.
// Shape: LinuxScenario (src/engine/linux-sim/scenario.ts, a Debian 13 machine); `npm run verify:linux`
// runs their command lists on a real Debian 13 machine. Lesson helpers: add your world's scenarios in
// their own file (e.g. l1.ts) and spread them in below (one line per world). Components find them with
// findScenario<T>('linux', id).
import type { LinuxScenario } from '~/engine/linux-sim';
import { examples } from './examples';
import { fidelity } from './fidelity';
import { l1 } from './l1';
import { l2 } from './l2';
import { l3 } from './l3';
import { l4 } from './l4';

export const allScenarios: LinuxScenario[] = [
  ...examples,
  ...l1,
  ...l2,
  ...l3,
  ...l4,
  ...fidelity,
];

export const scenarios: Record<string, LinuxScenario> = Object.fromEntries(allScenarios.map((s) => [s.id, s]));
