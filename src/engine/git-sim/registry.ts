// Command registry. Adding a command = one line here plus its function.
import type { CommandFn } from './types';
import * as shell from './commands/shell';
import * as setup from './commands/git-setup';
import * as save from './commands/git-save';
import * as hist from './commands/git-history';
import * as undo from './commands/git-undo';
import * as branches from './commands/git-branch';
import * as merging from './commands/git-merge';
import * as stashing from './commands/git-stash';
import * as remotes from './commands/git-remote';
import * as objects from './commands/git-objects';
import * as search from './commands/git-search';
import * as bisecting from './commands/git-bisect';
import * as worktrees from './commands/git-worktree';
import * as script from './commands/shell-script';

export const GIT_COMMANDS: Record<string, CommandFn> = {
  version: setup.version,
  help: setup.help,
  config: setup.config,
  init: setup.init,
  clone: remotes.cloneCmd,
  status: save.status,
  add: save.add,
  commit: save.commit,
  rm: save.rm,
  mv: save.mv,
  log: hist.log,
  show: hist.show,
  diff: hist.diff,
  reflog: hist.reflog,
  branch: branches.branch,
  tag: branches.tag,
  restore: undo.restore,
  reset: undo.reset,
  revert: undo.revert,
  checkout: undo.checkout,
  switch: undo.switchCmd,
  clean: undo.clean,
  merge: merging.merge,
  rebase: merging.rebase,
  'cherry-pick': merging.cherryPick,
  stash: stashing.stash,
  remote: remotes.remote,
  push: remotes.push,
  fetch: remotes.fetch,
  pull: remotes.pull,
  // World 10
  'cat-file': objects.catFile,
  'hash-object': objects.hashObject,
  'ls-tree': objects.lsTree,
  'rev-parse': objects.revParse,
  'show-ref': objects.showRef,
  'pack-refs': objects.packRefs,
  grep: search.grep,
  blame: search.blame,
  shortlog: search.shortlog,
  bisect: bisecting.bisect,
  worktree: worktrees.worktree,
};

/** Real Git commands this course teaches later, with the world that teaches them. */
export const LATER_COMMANDS: Record<string, number> = {
  'filter-repo': 8,
};

/**
 * Real Git commands (and tools) the practice terminal doesn't run: their lessons explain
 * them instead. Typing one prints a kind note (sim.explain.notInSim.<name>), never fake output.
 */
export const EXPLAIN_ONLY = [
  'rerere',
  'range-diff',
  'submodule',
  'subtree',
  'lfs',
  'sparse-checkout',
  'gc',
  'maintenance',
  'count-objects',
  'repack',
  'prune',
  'fsck',
  'whatchanged',
  'hook',
  'refs',
];

export const SHELL_COMMANDS: Record<string, CommandFn> = {
  pwd: shell.pwd,
  ls: shell.ls,
  cd: shell.cd,
  mkdir: shell.mkdir,
  touch: shell.touch,
  cat: shell.cat,
  rm: shell.rm,
  clear: shell.clear,
  help: shell.help,
  // World 10 (for `git bisect run`)
  sh: script.sh,
  bash: script.sh,
  grep: script.grepFiles,
  test: script.testCmd,
  '[': script.testCmd,
  true: script.trueCmd,
  false: script.falseCmd,
};

/** Commands the practice terminal knows, for "did you mean" hints. */
export const KNOWN_SHELL = [...Object.keys(SHELL_COMMANDS), 'echo', 'git'];
