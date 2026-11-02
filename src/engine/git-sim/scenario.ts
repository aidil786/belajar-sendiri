// Lesson scenarios: a starting state built by replaying simple steps.
// The same steps run in real Git in scripts/verify-commands, so both stay in sync.
import { run } from './run';
import { resolve } from './paths';
import { clone, createState, ensureDir, writeFile, deleteFile } from './state';
import { createServer, serverCommit } from './commands/git-remote';
import type { SimState } from './types';

export type ScenarioStep =
  | string // a command, e.g. 'git add index.html'
  | { write: string; content: string } // write a whole file (path relative to cwd)
  | { delete: string }
  /**
   * Create a hosted repo on the fake GitHub, like "New repository" on github.com.
   * Empty by default. With `files`, it starts with one commit (like ticking "Add a README").
   */
  | { server: string; files?: Record<string, string>; message?: string; defaultBranch?: string };

export interface Scenario {
  id: string;
  /** Global Git config to start with. Default: a learner identity and init.defaultBranch=main. */
  config?: Record<string, string>;
  /** Folder to start in before the steps run. Default: /home/you */
  cwd?: string;
  steps: ScenarioStep[];
  /**
   * Command sequences this lesson teaches. `npm run verify:commands` runs each one
   * after the steps, in the engine and in real Git, and compares the results.
   */
  verify?: string[][];
  /**
   * Compare object ids too in `npm run verify:commands` (real Git runs on the engine's
   * clock). Use it when the steps make one commit per command (no stash or rebase).
   */
  exactHashes?: boolean;
}

export const DEFAULT_CONFIG: Record<string, string> = {
  'user.name': 'You',
  'user.email': 'you@example.com',
  'init.defaultBranch': 'main',
};

function normKey(key: string): string {
  const first = key.indexOf('.');
  const last = key.lastIndexOf('.');
  if (first === -1) return key.toLowerCase();
  return `${key.slice(0, first).toLowerCase()}${key.slice(first, last)}.${key.slice(last + 1).toLowerCase()}`;
}

export function buildScenario(s: Scenario, overrides: Record<string, string> = {}): SimState {
  const config: Record<string, string> = {};
  for (const [k, v] of Object.entries({ ...(s.config ?? DEFAULT_CONFIG), ...overrides })) config[normKey(k)] = v;
  let state = createState({ globalConfig: config, seed: s.id });
  if (s.cwd) {
    state = clone(state);
    ensureDir(state, s.cwd);
    state.cwd = s.cwd;
  }
  for (const step of s.steps) state = scenarioStep(state, step, s.id);
  // A fresh reflog for HEAD movements made while building is still useful (2.9 reflog).
  ensureDir(state, state.cwd);
  return state;
}

/** Apply one scenario step. Throws if a command step fails. */
export function scenarioStep(state: SimState, step: ScenarioStep, id = 'scenario'): SimState {
  if (typeof step === 'string') {
    const r = run(state, step);
    if (!r.ok) throw new Error(`Scenario ${id}: step failed: ${step}\n${r.output.map((l) => l.map((x) => x.t).join('')).join('\n')}`);
    return r.state;
  }
  const next = clone(state);
  if ('write' in step) writeFile(next, resolve(next.cwd, step.write, next.home), step.content);
  else if ('server' in step) {
    const server = createServer(next, step.server, step.defaultBranch);
    if (step.files) serverCommit(next, server, step.files, step.message ?? 'Initial commit');
  } else deleteFile(next, resolve(next.cwd, step.delete, next.home));
  return next;
}

/** The starting state before any step (identity, cwd). Used with `scenarioStep`. */
export function scenarioStart(s: Scenario, overrides: Record<string, string> = {}): SimState {
  return buildScenario({ ...s, steps: [] }, overrides);
}
