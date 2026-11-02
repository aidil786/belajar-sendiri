// Which event happened, and does it start this workflow?
// https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows
import { matchList } from './glob';
import type { EventPreset, Note, Trigger, Workflow } from './types';

export interface PresetOptions {
  defaultBranch?: string;
  /** Feature branch for push-branch and pr (default 'feature'). */
  branch?: string;
  /** Tag for the tag preset (default 'v1.2.0'). */
  tag?: string;
  changed?: string[];
}

export const PRESETS: EventPreset[] = ['push-main', 'push-branch', 'pr', 'fork-pr', 'tag', 'dispatch', 'schedule', 'release'];

/** Turn a button into an event. */
export function presetTrigger(preset: EventPreset, o: PresetOptions = {}): Trigger {
  const main = o.defaultBranch ?? 'main';
  const branch = o.branch ?? 'feature';
  const tag = o.tag ?? 'v1.2.0';
  const changed = o.changed ?? ['src/app.js'];
  switch (preset) {
    case 'push-main':
      return { event: 'push', branch: main, changed };
    case 'push-branch':
      return { event: 'push', branch, changed };
    case 'pr':
      return { event: 'pull_request', branch, base: main, action: 'opened', changed, number: 7 };
    case 'fork-pr':
      return { event: 'pull_request', branch, base: main, action: 'opened', fork: true, changed, number: 8 };
    case 'tag':
      return { event: 'push', tag, changed };
    case 'dispatch':
      return { event: 'workflow_dispatch', branch: main };
    case 'schedule':
      return { event: 'schedule', branch: main };
    case 'release':
      return { event: 'release', tag, action: 'published' };
  }
}

/** The ref GitHub sets for an event (github.ref). */
export function refOf(t: Trigger, defaultBranch = 'main'): string {
  if (t.event === 'pull_request' || t.event === 'pull_request_target') {
    return t.event === 'pull_request' ? `refs/pull/${t.number ?? 1}/merge` : `refs/heads/${t.base ?? defaultBranch}`;
  }
  if (t.tag) return `refs/tags/${t.tag}`;
  return `refs/heads/${t.branch ?? defaultBranch}`;
}

export type TriggerMatch = { ok: true; eventName: string } | { ok: false; why: Note };

const DEFAULT_PR_TYPES = ['opened', 'synchronize', 'reopened'];

/** Does this event start the workflow? Follows GitHub's filter rules. */
export function matchTrigger(wf: Workflow, t: Trigger): TriggerMatch {
  const on = wf.on;
  const miss = (key: string, params: Note['params'] = {}): TriggerMatch => ({ ok: false, why: { key: `conveyor.why.${key}`, params } });

  if (t.event === 'pull_request' || t.event === 'pull_request_target') {
    // One pull request event can start both kinds of workflow.
    const name = on.pull_request ? 'pull_request' : on.pull_request_target ? 'pull_request_target' : null;
    if (!name) return miss('noEvent', { event: t.event });
    const cfg = on[name]!;
    const types = (cfg.types as string[] | undefined) ?? DEFAULT_PR_TYPES;
    if (!types.includes(t.action ?? 'opened')) return miss('typeFilter', { event: name, type: t.action ?? 'opened' });
    const base = t.base ?? 'main';
    const branches = cfg.branches as string[] | undefined;
    const ignore = cfg['branches-ignore'] as string[] | undefined;
    if (branches && !matchList(branches, base)) return miss('baseFilter', { branch: base });
    if (ignore && matchList(ignore, base)) return miss('baseIgnored', { branch: base });
    const p = pathCheck(cfg, t.changed ?? []);
    if (p) return p;
    return { ok: true, eventName: name };
  }

  const cfg = on[t.event];
  if (!cfg) return miss('noEvent', { event: t.event });

  if (t.event === 'push') {
    const branches = cfg.branches as string[] | undefined;
    const branchesIgnore = cfg['branches-ignore'] as string[] | undefined;
    const tags = cfg.tags as string[] | undefined;
    const tagsIgnore = cfg['tags-ignore'] as string[] | undefined;
    const hasBranchFilter = Boolean(branches || branchesIgnore);
    const hasTagFilter = Boolean(tags || tagsIgnore);
    if (t.tag) {
      // Only branch filters: tag pushes don't run.
      if (!hasTagFilter && hasBranchFilter) return miss('onlyBranches', { tag: t.tag });
      if (tags && !matchList(tags, t.tag)) return miss('tagFilter', { tag: t.tag });
      if (tagsIgnore && matchList(tagsIgnore, t.tag)) return miss('tagIgnored', { tag: t.tag });
      // Path filters are not checked for tag pushes.
      return { ok: true, eventName: 'push' };
    }
    const branch = t.branch ?? 'main';
    if (!hasBranchFilter && hasTagFilter) return miss('onlyTags', { branch });
    if (branches && !matchList(branches, branch)) return miss('branchFilter', { branch });
    if (branchesIgnore && matchList(branchesIgnore, branch)) return miss('branchIgnored', { branch });
    const p = pathCheck(cfg, t.changed ?? []);
    if (p) return p;
    return { ok: true, eventName: 'push' };
  }

  if (t.event === 'release') {
    const types = cfg.types as string[] | undefined;
    if (types && !types.includes(t.action ?? 'published')) return miss('typeFilter', { event: 'release', type: t.action ?? 'published' });
  }
  return { ok: true, eventName: t.event };
}

function pathCheck(cfg: Record<string, unknown>, changed: string[]): TriggerMatch | null {
  const paths = cfg.paths as string[] | undefined;
  const ignore = cfg['paths-ignore'] as string[] | undefined;
  if (paths && !changed.some((f) => matchList(paths, f))) return { ok: false, why: { key: 'conveyor.why.pathFilter', params: { files: changed.join(', ') } } };
  if (ignore && changed.length > 0 && changed.every((f) => matchList(ignore, f))) {
    return { ok: false, why: { key: 'conveyor.why.pathIgnored', params: { files: changed.join(', ') } } };
  }
  return null;
}
