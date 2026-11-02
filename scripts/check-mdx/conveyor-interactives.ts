// check:mdx for the CI/CD games (ConveyorBelt, SpotTheHole, TrafficDial).
// Their scenarios live in the cicd course: lessons in src/content/courses/cicd find them by
// themselves; anywhere else (a Kubernetes lesson, the dev page) passes course="cicd".
import { scenarios as cicd } from '../../src/content/courses/cicd/scenarios/index';
import type { ConveyorScenario } from '../../src/engine/conveyor-sim/index';
import { checkConveyorProps } from '../../src/lib/conveyorBelt';
import { checkHoleProps } from '../../src/lib/spotTheHole';

export const CONVEYOR_INTERACTIVES = new Set(['ConveyorBelt', 'SpotTheHole', 'TrafficDial']);

/** A cicd scenario by id, or undefined. */
export function cicdScenario(id: string): ConveyorScenario | undefined {
  return cicd[id] as ConveyorScenario | undefined;
}

export function checkConveyorInteractive(name: string, a: Record<string, unknown>, where: string, lessonCourse = 'git'): string[] {
  if (!CONVEYOR_INTERACTIVES.has(name)) return [];
  const out: string[] = [];
  const id = a.scenario as string | undefined;
  const s = id ? cicdScenario(id) : undefined;
  if (id && String(a.course ?? lessonCourse) !== 'cicd') out.push(`${where}: ${name} scenario "${id}" needs course="cicd" (outside the cicd course)`);
  if (id && !s) out.push(`${where}: ${name} unknown cicd scenario "${id}"`);
  if (name === 'ConveyorBelt' && s) out.push(...checkConveyorProps(a, s).map((e) => `${where}: ConveyorBelt ${e}`));
  if (name === 'SpotTheHole' && (!id || s)) out.push(...checkHoleProps(a, s?.workflow).map((e) => `${where}: SpotTheHole ${e}`));
  if (name === 'TrafficDial') {
    const mode = a.mode ?? s?.traffic?.mode;
    if (mode !== undefined && mode !== 'canary' && mode !== 'bluegreen') out.push(`${where}: TrafficDial mode must be canary or bluegreen`);
    const rate = (a.newErrorRate ?? s?.traffic?.newErrorRate) as number | undefined;
    if (rate !== undefined && (typeof rate !== 'number' || rate < 0 || rate > 1)) out.push(`${where}: TrafficDial newErrorRate is a share from 0 to 1 (0.08 = 8%)`);
    const task = a.task as { type?: string } | undefined;
    if (task && !['rollback', 'rollout', 'explore'].includes(String(task.type))) out.push(`${where}: TrafficDial unknown task "${String(task.type)}"`);
    if (task?.type === 'rollback' && (rate ?? 0.08) <= 0.02) out.push(`${where}: TrafficDial rollback needs a buggy release (newErrorRate above 0.02)`);
    if (task?.type === 'rollout' && (rate ?? 0.08) > 0.02) out.push(`${where}: TrafficDial rollout needs a healthy release (newErrorRate 0.02 or less)`);
  }
  return out;
}
