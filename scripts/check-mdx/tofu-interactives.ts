// check:mdx for the OpenTofu interactives (TofuSim, PlanReader). Their scenarios always come from
// the iac course. TofuSim: known goal keys, intro commands that work, a goal not met at the start.
// PlanReader: the plan builds and has resource changes to read.
import { buildTofuScenario, checkTofuGoal, plain, run, TOFU_GOAL_KEYS, type TofuGoal, type TofuScenario } from '../../src/engine/tofu-sim/index';
import { scenarios } from '../../src/content/courses/iac/scenarios/index';
import { checkReaderProps } from '../../src/lib/planReader';

export const TOFU_REQUIRED: Record<string, string[]> = {
  TofuSim: ['scenario'],
  PlanReader: ['scenario'],
};

export function checkTofuInteractive(name: string, a: Record<string, unknown>, where: string): string[] {
  if (!(name in TOFU_REQUIRED)) return [];
  const errors: string[] = [];
  const id = a.scenario as string | undefined;
  const sc = id ? (scenarios[id] as TofuScenario | undefined) : undefined;
  if (!sc) return [`${where}: ${name} unknown iac scenario "${id}"`];
  if (name === 'PlanReader') return checkReaderProps(sc, a).map((e) => `${where}: PlanReader ${e}`);
  let state = buildTofuScenario(sc);
  const typed: string[] = [];
  for (const c of (a.intro as string[] | undefined) ?? []) {
    const r = run(state, c, { noColor: true });
    if (!r.ok && !r.stopped) {
      errors.push(`${where}: TofuSim intro command fails in scenario ${id}: "${c}"\n    ${plain(r.output).split('\n').filter(Boolean).slice(0, 4).join('\n    ')}`);
      break;
    }
    state = r.state;
  }
  const goal = a.goal as TofuGoal | undefined;
  if (goal) {
    for (const k of Object.keys(goal)) if (!(TOFU_GOAL_KEYS as readonly string[]).includes(k)) errors.push(`${where}: unknown TofuSim goal key "${k}"`);
    if (checkTofuGoal(state, goal, typed).ok) errors.push(`${where}: TofuSim goal is already met before the learner starts`);
  }
  return errors;
}
