import { expect } from 'vitest';
import { buildScenario, plain, run, type CommandResult, type SimState } from '../index';

export function deepFreeze<T>(obj: T): T {
  if (obj && typeof obj === 'object' && !Object.isFrozen(obj)) {
    Object.freeze(obj);
    for (const v of Object.values(obj)) deepFreeze(v);
  }
  return obj;
}

/** A fresh learner home with identity + main as default branch. */
export function fresh(cwd?: string): SimState {
  return buildScenario({ id: 'test', steps: cwd ? [`mkdir -p ${cwd}`, `cd ${cwd}`] : [] });
}

/** A repo at ~/diary with one commit (index.html). */
export function oneCommit(): SimState {
  return buildScenario({
    id: 'test',
    steps: [
      'mkdir diary',
      'cd diary',
      'git init',
      'echo "<h1>My Diary</h1>" > index.html',
      'git add index.html',
      'git commit -m "Add home page"',
    ],
  });
}

/** Run lines in order. Each input state is frozen to prove commands never mutate. */
export function exec(state: SimState, ...inputs: string[]): { state: SimState; last: CommandResult; all: CommandResult[] } {
  let cur = state;
  const all: CommandResult[] = [];
  for (const input of inputs) {
    deepFreeze(cur);
    const r = run(cur, input);
    all.push(r);
    cur = r.state;
  }
  return { state: cur, last: all[all.length - 1]!, all };
}

export function out(r: CommandResult): string {
  return plain(r.output);
}

export function expectOk(r: CommandResult): void {
  expect(r.ok, out(r)).toBe(true);
}

export function expectFail(r: CommandResult, code?: string): void {
  expect(r.ok, out(r)).toBe(false);
  if (code) expect(r.events).toContainEqual({ type: 'error', code });
}

export function repoOf(state: SimState, root = '/home/you/diary') {
  const repo = state.repos[root];
  if (!repo) throw new Error(`no repo at ${root}`);
  return repo;
}
