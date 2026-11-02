// OpenTofu simulator (OpenTofu 1.13.5 with hashicorp/random, local, null and terraform_data).
// Pure TypeScript: no DOM, no React. See docs/AUTHORING.md "OpenTofu engine (TofuSim, PlanReader)".
export * from './types';
export { run, runAll, initialState, promptOf, TOFU_COMMANDS, SHELL_COMMANDS, DANGER, HOME, type RunOpts } from './run';
export { buildTofuScenario, buildTofuScenarioCached, ScenarioError } from './scenario';
export { parseState, serializeState, listInstances, STATE_FILE, TOFU_VERSION, type TfState } from './state';
export { loadConfig } from './config';
export { formatSource, unifiedDiff } from './fmt';
export { parseFile, parseExpr, lex } from './hcl';
export { checkTofuGoal, tofuPicture, TOFU_GOAL_KEYS, type TofuGoal, type TofuPicture, type PictureItem } from './goals';
export { renderChange, changeHeader, outputChangeLines, RULER } from './render';
export { plain, toAnsi } from '../git-sim/output';
