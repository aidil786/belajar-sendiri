// check:mdx for the kitchen engine (Docker lessons): KitchenReplay demos must run in the engine
// (except commands listed in `fails`), KitchenSim goals use known keys and aren't met at the start.
import { buildKitchenScenario, checkKitchenGoal, plain, run, type KitchenGoal } from '../../src/engine/kitchen-sim/index';
import { scenarios } from '../../src/content/courses/docker/scenarios/index';

export const KITCHEN_GOAL_KEYS = new Set([
  'running', 'exited', 'created', 'paused', 'healthy', 'notExists', 'portMapped', 'reachable', 'reachableContains', 'unreachable',
  'imageExists', 'imageMissing', 'imageMaxSize', 'imageUser', 'layers', 'cacheHits', 'maxRebuilt', 'volumeExists', 'volumeMissing',
  'fileInVolume', 'tableInVolume', 'networkExists', 'networkHas', 'composeUp', 'composeDown', 'containerEnv', 'containerUser',
  'readOnly', 'restartPolicy', 'logsContain', 'loggedIn', 'pushed', 'filesExist', 'fileContains', 'fileMode', 'cwd', 'envVar',
  'lastExit', 'count', 'typed', 'lastTyped',
]);

export function checkKitchenInteractive(name: string, a: Record<string, unknown>, where: string): string[] {
  if (name !== 'KitchenSim' && name !== 'KitchenReplay') return [];
  const errors: string[] = [];
  const id = a.scenario as string | undefined;
  const sc = id ? scenarios[id] : undefined;
  if (!sc) return errors; // unknown ids are reported by the main check
  if (name === 'KitchenReplay') {
    const fails = (a.fails as string[] | undefined) ?? [];
    let state = buildKitchenScenario(sc);
    for (const c of (a.commands as string[] | undefined) ?? []) {
      const r = run(state, c);
      if (fails.includes(c)) {
        if (r.ok) errors.push(`${where}: "${c}" is listed in fails, but it works in scenario ${id}`);
      } else if (!r.ok && !r.stopped) {
        errors.push(`${where}: demo command fails in scenario ${id}: "${c}"\n    ${plain(r.output).split('\n').slice(0, 6).join('\n    ')}`);
        break;
      }
      state = r.state;
    }
  }
  if (name === 'KitchenSim' && a.goal) {
    const goal = a.goal as KitchenGoal;
    for (const k of Object.keys(goal)) if (!KITCHEN_GOAL_KEYS.has(k)) errors.push(`${where}: unknown KitchenSim goal key "${k}"`);
    let state = buildKitchenScenario(sc);
    for (const c of (a.intro as string[] | undefined) ?? []) state = run(state, c).state;
    if (checkKitchenGoal(state, goal).ok) errors.push(`${where}: KitchenSim goal is already met before the learner starts`);
  }
  return errors;
}
