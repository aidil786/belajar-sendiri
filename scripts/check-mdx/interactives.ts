// Author checks for Transcript, PracticeRepo, MarkdownPlayground, YamlBuilder, MissionCheck,
// ObjectXray and BisectDetective. Returns readable errors; an empty list means the props make sense.
import { parse as parseYaml } from 'yaml';
import type { SimState } from '../../src/engine/git-sim/index';
import { defaultEnds, judgeCommit, rangeOf, type BisectTest } from '../../src/lib/bisectDetective';
import { xrayTarget, type XrayTask } from '../../src/lib/objectXray';
import { CHECK_TYPES, type MissionCheckSpec } from '../../src/lib/missionCheck';
import { initialState, isTaskDone, type RepoTask } from '../../src/lib/practiceRepo';
import { buildYaml, type YamlBlock } from '../../src/lib/yamlBuilder';

const SCREENS = ['code', 'issues', 'issue', 'pulls', 'pull', 'pull-files', 'actions', 'run', 'settings', 'markdown-file'];
const KINDS = ['trigger', 'job', 'step', 'permissions', 'env'];
const COLORS = ['green', 'red', 'yellow', 'cyan', 'dim'];

function badRegex(src: unknown): string | null {
  if (typeof src !== 'string') return 'not a string';
  try {
    new RegExp(src);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

export function checkNewInteractive(name: string, a: Record<string, unknown>, where: string): string[] {
  const errors: string[] = [];
  const err = (m: string) => errors.push(`${where}: ${name} ${m}`);

  if (name === 'Transcript') {
    const lines = a.lines as { cmd?: string; out?: string; color?: string }[];
    if (!Array.isArray(lines) || !lines.length) err('needs at least one line');
    else
      for (const [i, l] of lines.entries()) {
        if (l.cmd === undefined && l.out === undefined) err(`line ${i + 1} needs cmd or out`);
        if (l.color && !COLORS.includes(l.color)) err(`line ${i + 1} has unknown color "${l.color}"`);
      }
  }

  if (name === 'PracticeRepo') {
    const repo = a.repo as { owner?: string; name?: string; files?: { path: string }[] } | undefined;
    if (!repo?.owner || !repo.name) err('repo needs owner and name');
    if (a.screen !== undefined && !SCREENS.includes(String(a.screen))) err(`unknown screen "${String(a.screen)}"`);
    const issues = (a.issues ?? []) as { number: number }[];
    const pulls = (a.pulls ?? []) as { number: number }[];
    const runs = (a.runs ?? []) as { id: string | number }[];
    const rules = ((a.settings as { rules?: { id: string }[] } | undefined)?.rules ?? []) as { id: string }[];
    const task = a.task as RepoTask | undefined;
    if (task) {
      const t = task as Record<string, unknown>;
      if (t.pr !== undefined && !pulls.some((p) => p.number === t.pr)) err(`task pr #${String(t.pr)} is not in pulls`);
      if (t.issue !== undefined && !issues.some((i) => i.number === t.issue)) err(`task issue #${String(t.issue)} is not in issues`);
      if (t.run !== undefined && !runs.some((r) => String(r.id) === String(t.run))) err(`task run ${String(t.run)} is not in runs`);
      if (t.rule !== undefined && !rules.some((r) => r.id === t.rule)) err(`task rule "${String(t.rule)}" is not in settings.rules`);
      if (task.type === 'openFile' && !(repo?.files ?? []).some((f) => f.path === task.path)) err(`task file "${task.path}" is not in repo.files`);
      if (task.type === 'comment' && task.mustInclude !== undefined && badRegex(task.mustInclude)) err(`task mustInclude is not a valid regex`);
      if (task.type === 'comment' && task.pr === undefined && task.issue === undefined) err('comment task needs pr or issue');
      if (task.type === 'findFailingStep') {
        const run = runs.find((r) => String(r.id) === String(task.run)) as { jobs?: { steps: { status: string }[] }[] } | undefined;
        if (run && !run.jobs?.some((j) => j.steps.some((s) => s.status === 'fail'))) err(`run ${String(task.run)} has no failing step`);
      }
      try {
        const start = initialState({ issues: a.issues as never, pulls: a.pulls as never, runs: a.runs as never, rules: rules as never });
        if (task.type !== 'toggleRule' && isTaskDone(task, start)) err('task is already done before the learner starts');
      } catch (e) {
        err(`data is not valid: ${(e as Error).message}`);
      }
    }
  }

  if (name === 'MarkdownPlayground') {
    const goal = a.goal as { mustMatch?: unknown[]; hint?: unknown[] } | undefined;
    if (goal) {
      if (!Array.isArray(goal.mustMatch) || !goal.mustMatch.length) err('goal.mustMatch needs at least one regex');
      else {
        for (const r of goal.mustMatch) {
          const bad = badRegex(r);
          if (bad) err(`goal regex ${JSON.stringify(r)} is not valid: ${bad}`);
        }
        const initial = String(a.initial ?? '');
        if (goal.mustMatch.every((r) => !badRegex(r) && new RegExp(String(r), 'm').test(initial))) err('goal is already met by the initial text');
      }
    }
  }

  if (name === 'YamlBuilder') {
    const blocks = a.blocks as YamlBlock[];
    const order = (a.goal as { order?: string[] } | undefined)?.order;
    if (!Array.isArray(blocks) || !blocks.length) err('needs blocks');
    else {
      const ids = new Set<string>();
      for (const b of blocks) {
        if (ids.has(b.id)) err(`has two blocks with id "${b.id}"`);
        ids.add(b.id);
        if (!KINDS.includes(b.kind)) err(`block "${b.id}" has unknown kind "${b.kind}"`);
        if (!b.label || !b.yaml || !b.means) err(`block "${b.id}" needs label, yaml and means`);
      }
      if (!Array.isArray(order) || !order.length) err('goal.order needs block ids');
      else {
        for (const id of order) if (!ids.has(id)) err(`goal.order has unknown block "${id}"`);
        const chosen = order.map((id) => blocks.find((b) => b.id === id)).filter((b): b is YamlBlock => Boolean(b));
        try {
          const doc = parseYaml(buildYaml(String(a.workflow ?? 'CI'), chosen)) as { on?: unknown; jobs?: Record<string, unknown> };
          if (!doc?.on || !doc.jobs) err('goal order should make a workflow with on: and jobs:');
        } catch (e) {
          err(`goal order makes invalid YAML: ${(e as Error).message}`);
        }
      }
    }
  }

  if (name === 'MissionCheck') {
    const checks = a.checks as MissionCheckSpec[];
    if (!Array.isArray(checks) || !checks.length) err('needs at least one check');
    else
      for (const [i, c] of checks.entries()) {
        if (!CHECK_TYPES.includes(c.type)) err(`check ${i + 1} has unknown type "${String(c.type)}"`);
        if (!c.label) err(`check ${i + 1} needs a label`);
        if (c.type === 'file' && !c.path) err(`check ${i + 1} (file) needs a path`);
      }
  }

  return errors;
}

/**
 * World 10: ObjectXray's task must point at a real object; BisectDetective's test must say
 * "good" at the good end and "bad" at the bad end, so there is a first bad commit to find.
 */
export function checkDeepInteractive(name: string, a: Record<string, unknown>, state: SimState, where: string): string[] {
  const errors: string[] = [];
  const err = (m: string) => errors.push(`${where}: ${name} ${m}`);
  if (name === 'ObjectXray' && a.task) {
    const task = a.task as XrayTask;
    if (!['findBlob', 'findTree', 'findParent'].includes(task.type)) err(`task has unknown type "${String(task.type)}"`);
    else if (!xrayTarget(state, task)) err(`task points at nothing in the scenario: ${JSON.stringify(task)}`);
  }
  if (name === 'BisectDetective') {
    const test = a.test as Partial<BisectTest> | undefined;
    if (!test?.file || !test.bad) {
      err('test needs file and bad (a regex)');
      return errors;
    }
    const bad = badRegex(test.bad);
    if (bad) {
      err(`test.bad is not a valid regex: ${bad}`);
      return errors;
    }
    const ends = defaultEnds(state, a.good as string | undefined, a.bad as string | undefined);
    if (!ends) {
      err('good or bad is not a commit in the scenario');
      return errors;
    }
    const range = rangeOf(state, ends.good, ends.bad);
    if (range.length < 3) err('needs at least one commit between good and bad');
    if (judgeCommit(state, ends.good, test as BisectTest)) err('the test already fails at the good commit');
    if (!judgeCommit(state, ends.bad, test as BisectTest)) err('the test passes at the bad commit, so there is no bug to find');
  }
  return errors;
}
