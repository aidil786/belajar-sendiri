// Docker course scenarios, by id. Lessons refer to them as `scenario="d1-nginx"`.
// Shape: KitchenScenario (src/engine/kitchen-sim/scenario.ts). Add a file per world (d1.ts, d2.ts, ...)
// and spread it into `allScenarios` below (one per line).
import type { KitchenScenario } from '~/engine/kitchen-sim';
import { examples } from './examples';
import { d0 } from './d0';
import { d1 } from './d1';
import { d2 } from './d2';
import { d3 } from './d3';
import { d4 } from './d4';
import { d5 } from './d5';
import { d6 } from './d6';
import { nightshift } from './nightshift';

export const allScenarios: KitchenScenario[] = [
  ...examples,
  ...d0,
  ...d1,
  ...d2,
  ...d3,
  ...d4,
  ...d5,
  ...d6,
  ...nightshift,
];

export const scenarios: Record<string, KitchenScenario> = Object.fromEntries(allScenarios.map((s) => [s.id, s]));
