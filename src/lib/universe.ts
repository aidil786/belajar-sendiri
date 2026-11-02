// Pure logic for the UniverseSplitter: each local branch is a "universe" (a lane
// of the commit graph). Lanes come from the engine's graphLanes, so we never
// invent Git behaviour here.
import { checkGoal, findRepo, graphLanes, workingTree, type SimState } from '~/engine/git-sim';

export interface Universe {
  branch: string;
  /** Graph row of the branch tip (0 = main line). */
  lane: number;
  tip: string;
  current: boolean;
}

export type UniverseTask =
  /** Visit every universe (or the listed ones). The starting one counts as visited. */
  | { type: 'visitAll'; branches?: string[] }
  /** Switch to this branch. */
  | { type: 'switch'; branch: string }
  /** Put a new branch on the commit whose message matches `at` (regex). `switch` also moves onto it. */
  | { type: 'create'; at: string; name?: string; switch?: boolean };

/** Every local branch with the graph lane of its tip, sorted by lane then name. */
export function universes(state: SimState): Universe[] {
  const lanes = graphLanes(state, { showRemotes: false, showTags: false });
  const out: Universe[] = [];
  for (const n of lanes.nodes) {
    for (const b of n.branches) out.push({ branch: b, lane: n.lane, tip: n.id, current: lanes.head.branch === b });
  }
  return out.sort((a, b) => a.lane - b.lane || a.branch.localeCompare(b.branch));
}

/** The branch a tap on this lane switches to (null = nothing new there). */
export function laneTarget(list: Universe[], lane: number): string | null {
  const here = list.filter((u) => u.lane === lane);
  if (here.some((u) => u.current) && here.length === 1) return null;
  return here.find((u) => !u.current)?.branch ?? null;
}

export function currentBranch(state: SimState): string | null {
  const repo = findRepo(state);
  return repo?.head.type === 'branch' ? repo.head.name : null;
}

/** Files (repo-relative) in the working folder right now. */
export function filesIn(state: SimState): Record<string, string> {
  const repo = findRepo(state);
  return repo ? workingTree(state, repo) : {};
}

/** Is the task done? `visited` holds every branch the learner has been on (start included). */
export function taskDone(task: UniverseTask, state: SimState, visited: Set<string>, startBranches: string[]): boolean {
  if (task.type === 'visitAll') {
    const want = task.branches ?? universes(state).map((u) => u.branch);
    return want.length > 0 && want.every((b) => visited.has(b));
  }
  if (task.type === 'switch') return currentBranch(state) === task.branch;
  const names = task.name ? [task.name] : universes(state).map((u) => u.branch).filter((b) => !startBranches.includes(b));
  return names.some((name) => {
    const goal = { branches: [name], branchAt: { [name]: task.at }, ...(task.switch ? { currentBranch: name } : {}) };
    return checkGoal(state, goal).ok;
  });
}

/** The command a "create" action runs. */
export function createCommand(name: string, short: string, moveOnto: boolean): string {
  const n = name.trim();
  const arg = /^[\w./-]+$/.test(n) ? n : `"${n.replace(/"/g, '')}"`;
  return moveOnto ? `git switch -c ${arg} ${short}` : `git branch ${arg} ${short}`;
}
