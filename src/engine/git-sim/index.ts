// Belajar Sendiri Git simulator: public API.
//
//   const r = run(state, 'git add index.html');
//   r.state   → the new state (the old one is never changed)
//   r.output  → coloured lines that look like real Git
//   r.events  → what happened, for animations
//   r.explain → an i18n key for the friendly one-line explanation
export * from './types';
export { run, runAll } from './run';
export {
  createState,
  findRepo,
  headId,
  headTree,
  workingTree,
  history,
  subject,
  identity,
  listDirNames,
  remoteNames,
  remoteUrl,
  upstreamOf,
  type Upstream,
} from './state';
export { computeStatus, type RepoStatus, type UnmergedEntry, type UnmergedKind } from './status';
export { plain, toAnsi } from './output';
export { resolveRev } from './revision';
export { shortHash, blobId, treeId, buildTrees, type TreeEntry, type TreeObject } from './hash';
export { prettyPath } from './paths';
export { buildScenario, scenarioStart, scenarioStep, DEFAULT_CONFIG, type Scenario, type ScenarioStep } from './scenario';
export { GIT_COMMANDS, LATER_COMMANDS, EXPLAIN_ONLY } from './registry';
// World 10: objects, refs, bisect, blame, worktrees.
export {
  objectStore,
  resolveObject,
  objectText,
  objectSize,
  treeLines,
  commitTree,
  snapshotTrees,
  allRefs,
  type GitObject,
  type ObjectResult,
} from './objects';
export { commitObjectText, mainRepo, allWorktrees } from './state';
export { dotGitFiles, packedRefsText } from './dotgit';
export { bisectInfo, bisectPick, estimateSteps, type BisectInfo, type BisectPick } from './commands/git-bisect';
export { blameLines, type BlameLine } from './commands/git-search';
export { worktreePaths } from './commands/git-worktree';
export { checkGoal, revExists, isCleanMessage, type Goal, type GoalResult, type ServerCheck } from './goals';
export { edit } from './edit';
export { mergeFile, mergeTrees, type FileMergeResult, type TreeMergeResult } from './merge';
export { refLabels, type RefLabel } from './refs';
// Engine helpers for interactives (see docs/AUTHORING.md "Engine helpers for interactives").
export {
  conflictInfo,
  resolveConflict,
  listServers,
  serverLog,
  aheadBehind,
  type ConflictFile,
  type ConflictInfo,
  type ServerInfo,
  type ServerBranch,
  type LogEntry,
  type AheadBehind,
} from './interactive';
export { rebaseInteractive, rebaseTodo, type TodoItem } from './commands/git-merge';
export { graphLanes, type LaneLayout, type LaneNode, type LaneEdge, type LaneOptions } from './lanes';
export { createServer, findServer } from './commands/git-remote';
