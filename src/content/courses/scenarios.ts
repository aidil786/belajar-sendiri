// Scenario registry for every course, so generic components stay course-agnostic.
// Each course's engine has its own scenario shape; components cast to the one they expect.
import type { Scenario } from '~/engine/git-sim';
import { scenarios as git } from './git/scenarios';
import { scenarios as docker } from './docker/scenarios';
import { scenarios as cicd } from './cicd/scenarios';
import { scenarios as kubernetes } from './kubernetes/scenarios';
// Level Up (docs/LEVEL-UP-PLAN.md): one registry per course, filled by the lesson helpers.
import { scenarios as linux } from './linux/scenarios';
import { scenarios as iac } from './iac/scenarios';
import { scenarios as observability } from './observability/scenarios';
import { scenarios as aws } from './aws/scenarios';

/** course id → scenario id → scenario. `npm run check:mdx` uses it to check `scenario="…"` ids. */
export const scenariosByCourse: Record<string, Record<string, unknown>> = { git, docker, cicd, kubernetes, linux, iac, observability, aws };

export function findScenario<T = Scenario>(course: string, id: string): T {
  const s = scenariosByCourse[course]?.[id];
  if (!s) throw new Error(`Unknown scenario "${id}" in course "${course}"`);
  return s as T;
}
