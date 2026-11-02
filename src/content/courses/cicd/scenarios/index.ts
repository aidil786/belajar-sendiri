// cicd course scenarios, by id. The conveyor simulator defines their shape
// (ConveyorScenario in src/engine/conveyor-sim/scenario.ts). One file per world.
import type { ConveyorScenario } from '~/engine/conveyor-sim';
import { c1 } from './c1';
import { c2 } from './c2';
import { c3 } from './c3';
import { c4 } from './c4';
import { nightshift } from './nightshift';

export const allConveyorScenarios: ConveyorScenario[] = [
  ...c1,
  ...c2,
  ...c3,
  ...c4,
  ...nightshift,
];

export const scenarios: Record<string, unknown> = Object.fromEntries(allConveyorScenarios.map((s) => [s.id, s]));
