// All Git course scenarios, by id. Lessons refer to them as `scenario="w01-l03"`.
import type { Scenario } from '~/engine/git-sim';
import { w00 } from './w00';
import { w01 } from './w01';
import { w02 } from './w02';
import { w03 } from './w03';
import { w04 } from './w04';
import { w05 } from './w05';
import { w06 } from './w06';
import { w07 } from './w07';
import { w08 } from './w08';
import { w09 } from './w09';
import { w10 } from './w10';
import { w11 } from './w11';
import { w12 } from './w12';

export const allScenarios: Scenario[] = [
  ...w00,
  ...w01,
  ...w02,
  ...w03,
  ...w04,
  ...w05,
  ...w06,
  ...w07,
  ...w08,
  ...w09,
  ...w10,
  ...w11,
  ...w12,
];

export const scenarios: Record<string, Scenario> = Object.fromEntries(allScenarios.map((s) => [s.id, s]));

export function getScenario(id: string): Scenario {
  const s = scenarios[id];
  if (!s) throw new Error(`Unknown scenario: ${id}`);
  return s;
}
