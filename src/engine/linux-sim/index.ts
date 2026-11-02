// FahamLah Linux simulator: a small Debian 13 server ("kedai") in pure TypeScript.
//
//   const r = run(state, 'ls -l');
//   r.state   → the new state (the old one is never changed)
//   r.output  → coloured lines like a real terminal (GNU coreutils 9.7, bash 5.2, systemd 257 …)
//   r.events  → what happened, for the state picture
//   r.explain → an i18n key (linux.*) for the friendly one-line explanation
//   r.danger  → the command deletes things or runs as root (show a "Careful" note)
export * from './types';
export { run, runAll, promptOf, TICK } from './run';
export { createMachine, START_CLOCK, BOOT, HOSTS_FILE } from './machine';
export { buildLinuxScenario, buildLinuxScenarioCached, linuxStart, linuxStep, usesEngineOnlySteps, ENGINE_ONLY_STEPS, ScenarioError, type LinuxScenario, type LinuxStep } from './scenario';
export { checkLinuxGoal, LINUX_GOAL_KEYS, type LinuxGoal, type GoalResult } from './goals';
export { linuxPicture, type LinuxPicture, type PicEntry } from './picture';
export { PROGRAMS } from './programs';
export { BUILTINS, shellOf } from './shell';
export { APT_CATALOG, NOT_INSTALLED, randomart } from './programs/sys';
export { applyMode } from './programs/users';
export { plain, toAnsi } from '../git-sim/output';

import { PROGRAMS } from './programs';
import { BUILTINS } from './shell';

/** Every command name the terminal knows (for Tab completion). */
export const LINUX_COMMANDS: string[] = [...new Set([...Object.keys(PROGRAMS).filter((p) => p !== 'mawk' && p !== 'dash'), 'awk', 'sh', ...Object.keys(BUILTINS).filter((b) => !b.startsWith('_') && b !== ':' && b !== '[' && b !== '[[' && b !== '.')])].sort();
