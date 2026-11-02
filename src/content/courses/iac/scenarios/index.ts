// IaC course (Terraform & OpenTofu) scenarios, by id. Lessons refer to them as `scenario="t1-first-blueprint"`.
// Shape: TofuScenario (src/engine/tofu-sim/types.ts); `npm run verify:tofu` runs each verify list with real
// OpenTofu 1.13.5. Lesson helpers: add your world's scenarios in their own file (e.g. t1.ts) and spread
// them in below (one line per world). Components find them with findScenario<T>('iac', id).
import type { TofuScenario } from '~/engine/tofu-sim';
import { examples } from './examples';
import { t1 } from './t1';
import { t2 } from './t2';
import { t3 } from './t3';
import { t4 } from './t4';
import { fidelity } from './fidelity';

export const allScenarios: TofuScenario[] = [
  ...examples,
  ...t1,
  ...t2,
  ...t3,
  ...t4,
  ...fidelity,
];

export const scenarios: Record<string, TofuScenario> = Object.fromEntries(allScenarios.map((s) => [s.id, s]));
