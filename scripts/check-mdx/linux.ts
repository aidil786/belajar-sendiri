// check:mdx for the Linux practice server (LinuxSim): the scenario exists in the Linux course and
// builds, intro commands work, goal keys and regexes are valid, and the goal isn't met at the start.
// With a `solution` (commands, never shown) the goal must be met after them: the task is reachable.
import { buildLinuxScenario, checkLinuxGoal, LINUX_GOAL_KEYS, plain, run, type LinuxGoal, type LinuxState } from '../../src/engine/linux-sim/index';
import { scenarios } from '../../src/content/courses/linux/scenarios/index';

export const LINUX_REQUIRED: Record<string, string[]> = {
  LinuxSim: ['scenario'],
};

const REGEX_KEYS = ['typed', 'lastTyped'] as const;

export function checkLinuxInteractive(name: string, a: Record<string, unknown>, where: string): string[] {
  if (!(name in LINUX_REQUIRED)) return [];
  const errors: string[] = [];
  const id = String(a.scenario ?? '');
  const sc = scenarios[id];
  if (!sc) return [`${where}: unknown Linux scenario "${id}" (src/content/courses/linux/scenarios/)`];
  let state: LinuxState;
  try {
    state = buildLinuxScenario(sc);
  } catch (e) {
    return [`${where}: scenario ${id} does not build: ${(e as Error).message}`];
  }
  for (const c of (a.intro as string[] | undefined) ?? []) {
    const r = run(state, c);
    if (!r.ok && !r.stopped) {
      errors.push(`${where}: intro command fails in scenario ${id}: "${c}"\n    ${plain(r.output).split('\n').slice(0, 4).join('\n    ')}`);
      return errors;
    }
    state = r.state;
  }
  if (a.keys !== undefined && (!Array.isArray(a.keys) || a.keys.some((k) => typeof k !== 'string'))) errors.push(`${where}: keys must be a list of strings`);
  const goal = a.goal as LinuxGoal | undefined;
  if (goal) {
    for (const k of Object.keys(goal)) if (!(LINUX_GOAL_KEYS as readonly string[]).includes(k)) errors.push(`${where}: unknown LinuxSim goal key "${k}"`);
    for (const k of REGEX_KEYS) {
      try {
        if (goal[k]) new RegExp(goal[k]!);
      } catch {
        errors.push(`${where}: goal.${k} is not a valid regex`);
      }
    }
    for (const k of ['fileContains', 'fileNotContains', 'crontabHas', 'envVar'] as const) {
      for (const [p, re] of Object.entries(goal[k] ?? {})) {
        try {
          new RegExp(re);
        } catch {
          errors.push(`${where}: goal.${k}["${p}"] is not a valid regex`);
        }
      }
    }
    if (checkLinuxGoal(state, goal, []).ok) errors.push(`${where}: LinuxSim goal is already met before the learner starts`);
    const solution = a.solution as string[] | undefined;
    if (solution) {
      let s = state;
      const typed: string[] = [];
      for (const c of solution) {
        const r = run(s, c);
        s = r.state;
        typed.push(c);
      }
      const res = checkLinuxGoal(s, goal, typed);
      if (!res.ok) errors.push(`${where}: the solution does not reach the goal (still missing: ${res.failed.join(', ')})`);
    }
  }
  return errors;
}
