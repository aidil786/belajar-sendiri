// Conveyor scenarios: a workflow file plus the world around it (secrets, caches,
// environments, planned failures). Lessons pick one by id (`course="cicd"`).
import type { HoleKind } from './audit';
import { presetTrigger } from './events';
import { simulate } from './simulate';
import type { Decisions, EventPreset, RunResult, RunStatus, Trigger, World } from './types';

export interface TrafficSpec {
  mode: 'canary' | 'bluegreen';
  /** Share of requests the new version fails (0.08 = 8%). */
  newErrorRate: number;
  oldErrorRate?: number;
  /** Canary steps in percent, e.g. [5, 25, 50, 100]. */
  steps?: number[];
}

export interface ConveyorScenario extends World {
  id: string;
  /** Path of the workflow file (default `.github/workflows/ci.yml`). */
  file?: string;
  /** The workflow YAML. Keep it short: ~15 lines show at once. */
  workflow: string;
  /** Feature branch for "push to a branch" and pull requests (default `feature`). */
  branch?: string;
  /** Tag for the tag event (default `v1.2.0`). */
  tag?: string;
  /** Files changed by the push or pull request (for `paths` filters). */
  changed?: string[];
  /** Event buttons to offer (default push to main, PR, fork PR, tag). */
  events?: EventPreset[];
  /** Lines (1-based, inclusive) the learner may change in a fix task. */
  fix?: { from: number; to: number };
  /** The safe version of the workflow (C4). */
  fixed?: string;
  /** Holes on purpose (SpotTheHole). Tests check they match auditWorkflow(). `fix`: the fixed line(s). */
  holes?: { line: number; kind: HoleKind; fix?: string }[];
  /** actionlint findings this file shows on purpose (regexes). verify:workflows fails on any other finding. */
  actionlint?: string[];
  /** TrafficDial defaults. */
  traffic?: TrafficSpec;
  /** How a run ends, per event (checked by tests). */
  expect?: Partial<Record<EventPreset, RunStatus>>;
}

export const DEFAULT_EVENTS: EventPreset[] = ['push-main', 'pr', 'fork-pr', 'tag'];

export function scenarioTrigger(s: ConveyorScenario, preset: EventPreset): Trigger {
  return presetTrigger(preset, {
    defaultBranch: s.repo?.defaultBranch ?? 'main',
    ...(s.branch ? { branch: s.branch } : {}),
    ...(s.tag ? { tag: s.tag } : {}),
    ...(s.changed ? { changed: s.changed } : {}),
  });
}

export interface ScenarioRunOptions {
  /** Run this YAML instead of the scenario's (a learner's fix). */
  yaml?: string;
  decisions?: Decisions;
  /** Change the world for this run (e.g. a warm cache after the first run). */
  world?: Partial<World>;
}

/** Run a scenario for one event button. */
export function runScenario(s: ConveyorScenario, event: EventPreset | Trigger, o: ScenarioRunOptions = {}): RunResult {
  const trigger = typeof event === 'string' ? scenarioTrigger(s, event) : event;
  const world: World = { ...s, ...o.world, cache: { ...s.cache, ...o.world?.cache } };
  return simulate(o.yaml ?? s.workflow, { trigger, world, ...(o.decisions ? { decisions: o.decisions } : {}) });
}

/** Replace lines `from`..`to` (1-based, inclusive) with `replacement`. */
export function replaceLines(text: string, from: number, to: number, replacement: string): string {
  const lines = text.replace(/\n$/, '').split('\n');
  const next = replacement.replace(/\n$/, '');
  lines.splice(from - 1, to - from + 1, ...(next === '' ? [] : next.split('\n')));
  return lines.join('\n') + '\n';
}

/** The lines `from`..`to` (1-based, inclusive). */
export function linesOf(text: string, from: number, to: number): string {
  return text.replace(/\n$/, '').split('\n').slice(from - 1, to).join('\n');
}
