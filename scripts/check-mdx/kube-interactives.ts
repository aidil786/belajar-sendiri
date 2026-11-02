// check:mdx for the food-court interactives (FoodCourtSim / KubeSim, ManagersBoard, KubeReplay,
// YouAreHere): the scenario exists in the Kubernetes course, demo and intro commands work in
// the engine, goal keys exist and the goal is not already met when the learner starts.
import { buildScenario, checkGoal, GOAL_KEYS, plain, run, type KubeGoal, type KubeScenario, type KubeState } from '../../src/engine/foodcourt-sim/index';
import { scenarios } from '../../src/content/courses/kubernetes/scenarios/index';

export const KUBE_REQUIRED: Record<string, string[]> = {
  FoodCourtSim: ['scenario'],
  KubeSim: ['scenario'],
  ManagersBoard: ['scenario'],
  KubeReplay: ['scenario', 'commands', 'label'],
  YouAreHere: ['context', 'namespace'],
};

const FAULTS = ['deletePod', 'killNode', 'badImage', 'memoryLeak', 'readinessFail', 'crash', 'traffic', 'stopKubelet'];

/** `{pod:app=shop}` → the first matching pod's name (as KubeReplay does). */
function resolve(state: KubeState, cmd: string): string {
  return cmd.replace(/\{pod:([^}]+)\}/g, (_m, sel: string) => {
    const names = plain(run(state, `kubectl get pods -l ${sel} -o name`).output)
      .split('\n')
      .filter((l) => l.startsWith('pod/'))
      .map((l) => l.slice(4))
      .sort();
    return names[0] ?? 'pod-not-found';
  });
}

export function checkKubeInteractive(name: string, a: Record<string, unknown>, where: string): string[] {
  if (!(name in KUBE_REQUIRED) || name === 'YouAreHere') return [];
  const errors: string[] = [];
  const id = String(a.scenario ?? '');
  const sc = scenarios[id] as KubeScenario | undefined;
  if (!sc) return [`${where}: unknown Kubernetes scenario "${id}"`];
  let state: KubeState;
  try {
    state = buildScenario(sc);
  } catch (e) {
    return [`${where}: scenario ${id} does not build: ${(e as Error).message}`];
  }
  const runAll = (cmds: string[], fails: string[], what: string) => {
    for (const raw of cmds) {
      const c = resolve(state, raw);
      const r = run(state, c);
      if (fails.includes(raw)) {
        if (r.ok) errors.push(`${where}: "${raw}" is listed in fails, but it works in scenario ${id}`);
      } else if (!r.ok && !r.stopped) {
        errors.push(`${where}: ${what} command fails in scenario ${id}: "${raw}"\n    ${plain(r.output).split('\n').join('\n    ')}`);
        return;
      }
      state = r.state;
    }
  };
  if (name === 'KubeReplay') runAll((a.commands as string[]) ?? [], (a.fails as string[]) ?? [], 'demo');
  if (name === 'FoodCourtSim' || name === 'KubeSim') {
    runAll((a.intro as string[]) ?? [], [], 'intro');
    for (const f of (a.faults as string[]) ?? []) if (!FAULTS.includes(f)) errors.push(`${where}: unknown fault "${f}" (use ${FAULTS.join(', ')})`);
    const goal = a.goal as KubeGoal | undefined;
    if (goal) {
      for (const k of Object.keys(goal)) if (!(GOAL_KEYS as readonly string[]).includes(k)) errors.push(`${where}: unknown goal key "${k}"`);
      for (const k of ['typed', 'lastTyped'] as const) {
        try {
          if (goal[k]) new RegExp(goal[k]!);
        } catch {
          errors.push(`${where}: goal.${k} is not a valid regex`);
        }
      }
      if (checkGoal(state, goal, []).ok) errors.push(`${where}: goal is already met before the learner starts`);
    }
  }
  if (name === 'ManagersBoard') {
    for (const x of (a.actions as unknown[]) ?? []) {
      if (typeof x === 'string' && x !== 'deletePod' && x !== 'killNode') errors.push(`${where}: unknown board action "${x}"`);
      if (x && typeof x === 'object') {
        const cmd = String((x as { cmd?: string }).cmd ?? '');
        const r = run(state, cmd);
        if (!r.ok) errors.push(`${where}: board action fails in scenario ${id}: "${cmd}"`);
      }
    }
    const goal = (a.goal ?? {}) as Record<string, unknown>;
    for (const k of Object.keys(goal)) if (k !== 'healed' && k !== 'want') errors.push(`${where}: unknown board goal key "${k}" (use healed, want)`);
  }
  return errors;
}
