// kubernetes course scenarios, by id. The food-court engine (src/engine/foodcourt-sim) defines their shape.
// Lesson helpers: add your world's scenarios in their own file (e.g. k1.ts) and list them here (one per line).
import type { KubeScenario } from '~/engine/foodcourt-sim';
import { modelScenarios } from './model';
import { k1Scenarios } from './k1';
import { k2Scenarios } from './k2';
import { k3Scenarios } from './k3';
import { k4Scenarios } from './k4';
import { k5Scenarios } from './k5';
import { k6Scenarios } from './k6';
import { k7Scenarios } from './k7';
import { k9Scenarios } from './k9';
import { k9AdminScenarios } from './k9-admin';
import { nightshift } from './nightshift';
import { examScenarios } from './exam';

export const allScenarios: KubeScenario[] = [
  ...modelScenarios,
  ...k1Scenarios,
  ...k2Scenarios,
  ...k3Scenarios,
  ...k4Scenarios,
  ...k5Scenarios,
  ...k6Scenarios,
  ...k7Scenarios,
  ...k9Scenarios,
  ...k9AdminScenarios,
  ...nightshift,
  ...examScenarios,
];

export const scenarios: Record<string, unknown> = Object.fromEntries(allScenarios.map((s) => [s.id, s]));
