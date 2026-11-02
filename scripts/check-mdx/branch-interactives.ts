// Author checks for the World 3 interactives: UniverseSplitter, ConflictResolver, RebaseDeck.
// Returns readable errors; an empty list means the props make sense.
import { buildScenario, conflictInfo, graphLanes, plain, rebaseTodo, resolveConflict, revExists, run, type SimState } from '../../src/engine/git-sim/index';
import { allScenarios } from '../../src/content/courses/git/scenarios/index';
import { applyChoices, normalizeExpect, parseConflicts, solveWithQuickChoices, type ExpectSpec } from '../../src/lib/conflictResolver';
import { currentBranch, universes, type UniverseTask } from '../../src/lib/universe';

const byId = new Map(allScenarios.map((s) => [s.id, s]));

function badRegex(src: unknown): string | null {
  if (typeof src !== 'string') return 'not a string';
  try {
    new RegExp(src);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

/** The scenario plus `commands`. Commands may stop on a conflict (Git waits), but must not fail. */
function startState(a: Record<string, unknown>, err: (m: string) => void): SimState | null {
  const sc = byId.get(String(a.scenario));
  if (!sc) return null;
  let s = buildScenario(sc);
  for (const c of (a.commands as string[] | undefined) ?? []) {
    const r = run(s, c);
    if (!r.ok && !r.stopped) {
      err(`command fails in scenario ${sc.id}: "${c}"\n    ${plain(r.output).split('\n').join('\n    ')}`);
      return null;
    }
    s = r.state;
  }
  return s;
}

export function checkBranchInteractive(name: string, a: Record<string, unknown>, where: string): string[] {
  const errors: string[] = [];
  const err = (m: string) => errors.push(`${where}: ${name} ${m}`);
  if (!['UniverseSplitter', 'ConflictResolver', 'RebaseDeck'].includes(name)) return errors;
  const start = startState(a, err);
  if (!start) return errors;

  if (name === 'UniverseSplitter') {
    const task = a.task as UniverseTask | undefined;
    const list = universes(start);
    if (!task || !['visitAll', 'switch', 'create'].includes(task.type)) err('needs task.type visitAll, switch or create');
    else if (task.type === 'visitAll') {
      const want = task.branches ?? list.map((u) => u.branch);
      if (want.length < 2) err('visitAll needs at least two branches');
      for (const b of want) if (!list.some((u) => u.branch === b)) err(`task branch "${b}" does not exist`);
    } else if (task.type === 'switch') {
      if (!list.some((u) => u.branch === task.branch)) err(`task branch "${task.branch}" does not exist`);
      if (currentBranch(start) === task.branch) err(`already on "${task.branch}" before the learner starts`);
    } else {
      const bad = badRegex(task.at);
      if (bad) err(`task.at is not a valid regex: ${bad}`);
      else if (!graphLanes(start).nodes.some((n) => new RegExp(task.at, 'i').test(n.message))) err(`no commit matches task.at "${task.at}"`);
      if (task.name && list.some((u) => u.branch === task.name)) err(`branch "${task.name}" already exists`);
    }
    if (a.file !== undefined && typeof a.file !== 'string') err('file must be a path');
  }

  if (name === 'ConflictResolver') {
    const info = conflictInfo(start);
    if (!info || !info.files.length) {
      err('has no conflict to fix (add commands like "git merge <branch>")');
      return errors;
    }
    const files = info.files.filter((f) => a.file === undefined || f.path === a.file);
    if (!files.length) err(`file "${String(a.file)}" has no conflict`);
    const first = files[0]?.path ?? '';
    const want = normalizeExpect(a.expect as ExpectSpec | undefined, first);
    const avoid = normalizeExpect(a.avoid as ExpectSpec | undefined, first);
    for (const [path, list] of [...Object.entries(want), ...Object.entries(avoid)]) {
      if (!files.some((f) => f.path === path)) err(`expect/avoid names "${path}", which is not a conflicted file here`);
      for (const r of list) {
        const bad = badRegex(r);
        if (bad) err(`regex ${JSON.stringify(r)} is not valid: ${bad}`);
      }
    }
    if (errors.length) return errors;
    // Quick choices (yours / theirs / both) must be able to reach the expected text.
    let s = start;
    for (const f of files) {
      if (f.ours === null || f.theirs === null) {
        s = resolveConflict(s, f.path, f.merged ?? f.ours ?? f.theirs).state;
        continue;
      }
      const parsed = parseConflicts(f.merged ?? '');
      const solution = solveWithQuickChoices(parsed, want[f.path], avoid[f.path]);
      if (!solution) {
        err(`no mix of yours / theirs / both gives what expect/avoid want in ${f.path}`);
        continue;
      }
      s = resolveConflict(s, f.path, applyChoices(parsed, solution)).state;
    }
    if (!errors.length && !conflictInfo(s)?.files.length) {
      const fallback = info.op === 'merge' ? ['git commit --no-edit'] : info.op === 'rebase' ? ['git rebase --continue'] : info.op === 'cherry-pick' ? ['git cherry-pick --continue'] : [];
      for (const c of (a.finish as string[] | undefined) ?? fallback) {
        const r = run(s, c);
        if (!r.ok && !r.stopped) err(`finish command fails: "${c}"\n    ${plain(r.output).split('\n').join('\n    ')}`);
        s = r.state;
      }
    }
  }

  if (name === 'RebaseDeck') {
    const upstream = String(a.upstream ?? '');
    if (!revExists(start, upstream)) err(`upstream "${upstream}" does not exist`);
    else if (!rebaseTodo(start, upstream).length) err(`has no commits to replay onto "${upstream}"`);
    for (const [i, c] of ((a.commitFiles as { message: string; file: string }[] | undefined) ?? []).entries()) {
      const bad = badRegex(c.message);
      if (bad) err(`commitFiles ${i + 1} message regex is not valid: ${bad}`);
      if (!c.file) err(`commitFiles ${i + 1} needs a file`);
    }
  }
  return errors;
}
