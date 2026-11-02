// Pure logic for the ConveyorBelt interactive: tasks, the learner's fix, and
// the props check used by `npm run check:mdx`. The engine is src/engine/conveyor-sim.
import {
  beltLayout,
  canRun,
  DEFAULT_EVENTS,
  firstFailedStation,
  parseWorkflow,
  replaceLines,
  runScenario,
  type ConveyorScenario,
  type EventPreset,
  type JobRun,
  type Note,
  type RunResult,
  type Station,
  type StepRun,
  type World,
} from '~/engine/conveyor-sim';

export type ConveyorTask =
  /** Free play: done after the first finished run. */
  | { type: 'watch' }
  /** Make the run pass (pick or type a fix, or pick the right event). `forbid`: regexes the YAML must not match. */
  | { type: 'green'; forbid?: string[] }
  /** Tap the station that will stop the line (or "nothing"), then run. */
  | { type: 'predict' }
  /** Find an event where `job` ends with `result` ('notTriggered': the whole workflow does not start). */
  | { type: 'event'; job?: string; result: 'success' | 'skipped' | 'failure' | 'notTriggered' }
  /** Approve the environment that waits for a review; done when the run passes. */
  | { type: 'approve' }
  /** Run until a cache hits (run twice: the first run saves it). */
  | { type: 'cacheHit' };

export interface FixOption {
  label: string;
  /** YAML for the scenario's `fix` lines. */
  text: string;
  why?: string;
  /** false: it may turn green, but it is not the safe answer (e.g. write-all). */
  correct?: boolean;
}

export interface Verdict {
  done: boolean;
  /** Counts as a miss (fl:wrong). */
  wrong: boolean;
  /** i18n note for the feedback line. */
  note?: Note;
  /** Author text (an option's why) shown after the note. */
  extra?: string;
}

/** The first failed step (not continue-on-error) and its job. */
export function firstFailure(r: RunResult): { job: JobRun; step: StepRun | null } | null {
  const e = r.events.find((x) => x.type === 'stepFailed' && !x.continued);
  if (e && e.type === 'stepFailed') {
    const job = r.jobs.find((j) => j.key === e.job)!;
    return { job, step: job.steps[e.step] ?? null };
  }
  const job = r.jobs.find((j) => j.result === 'failure' || (j.result === 'cancelled' && j.why?.key === 'conveyor.why.timeout'));
  return job ? { job, step: null } : null;
}

/** The last real error line a failed step printed (shown before its plain translation). */
export function realError(r: RunResult): string | null {
  const f = firstFailure(r);
  if (!f) return null;
  const lines = f.step ? f.step.log : f.job.log;
  const errs = lines.filter((l) => l.kind === 'err').map((l) => l.text.trim());
  // The first line that says what broke (not the exit code, not npm's error code line).
  const meaningful = errs.filter((t) => !/^Error: Process completed with exit code|^npm error code /.test(t));
  // A test runner's "FAIL <file>" header followed by "Error: connect ECONNREFUSED …": the Error line is the cause.
  const cause = /^FAIL\s/.test(meaningful[0] ?? '') ? meaningful.find((t) => /^Error: /.test(t)) : undefined;
  return cause ?? meaningful[0] ?? errs[0] ?? null;
}

/** Why the run did not pass, as one i18n note. */
export function runNote(r: RunResult): Note | undefined {
  if (r.status === 'invalid') return { key: 'conveyor.why.invalid' };
  if (r.status === 'notTriggered') return r.why;
  const f = firstFailure(r);
  if (!f) return undefined;
  return f.step?.why ?? f.job.why;
}

export interface JudgeInput {
  task: ConveyorTask;
  result: RunResult;
  yaml: string;
  /** predict: the station id picked, or 'none'. */
  pick?: string | null;
  firstFailed?: Station | null;
  option?: FixOption | null;
}

/** Is the task done after this run? (Only called for runs that finished or did not start.) */
export function judgeRun({ task, result: r, yaml, pick, firstFailed, option }: JudgeInput): Verdict {
  switch (task.type) {
    case 'watch':
      return { done: r.status !== 'waiting', wrong: false };
    case 'green': {
      if (r.status !== 'success') {
        const note = runNote(r);
        return { done: false, wrong: true, ...(note ? { note } : {}), ...(option?.why ? { extra: option.why } : {}) };
      }
      const bad = (task.forbid ?? []).some((p) => new RegExp(p, 'm').test(yaml));
      if (bad || option?.correct === false) return { done: false, wrong: true, note: { key: 'conveyor.task.greenNotSafe' }, ...(option?.why ? { extra: option.why } : {}) };
      return { done: true, wrong: false };
    }
    case 'predict': {
      const answer = firstFailed?.id ?? 'none';
      if (pick === answer) return { done: true, wrong: false };
      return { done: false, wrong: true, note: { key: answer === 'none' ? 'conveyor.task.predictNone' : 'conveyor.task.predictOther' } };
    }
    case 'event': {
      if (task.result === 'notTriggered') return r.status === 'notTriggered' ? { done: true, wrong: false } : { done: false, wrong: false, note: { key: 'conveyor.task.eventRan' } };
      const legs = r.jobs.filter((j) => j.id === task.job);
      const ok = legs.length > 0 && legs.every((j) => j.result === task.result);
      return ok ? { done: true, wrong: false } : { done: false, wrong: false, note: { key: 'conveyor.task.eventTryAnother', params: { job: task.job ?? '' } } };
    }
    case 'approve':
      return r.status === 'success' ? { done: true, wrong: false } : { done: false, wrong: r.status === 'failure', ...(runNote(r) ? { note: runNote(r)! } : {}) };
    case 'cacheHit':
      return r.events.some((e) => e.type === 'cacheHit' && !e.partial) ? { done: true, wrong: false } : { done: false, wrong: false, note: { key: 'conveyor.task.cacheAgain' } };
  }
}

/** The workflow with the learner's text in the fix lines. */
export function applyFix(s: ConveyorScenario, text: string): string {
  if (!s.fix) return s.workflow;
  return replaceLines(s.workflow, s.fix.from, s.fix.to, text);
}

/** Lines (first, last) the fix covers after the learner's text is in. */
export function fixRange(s: ConveyorScenario, text: string): [number, number] | null {
  if (!s.fix) return null;
  const n = text.replace(/\n$/, '').split('\n').length;
  return [s.fix.from, s.fix.from + Math.max(1, n) - 1];
}

export interface ConveyorProps {
  scenario?: unknown;
  event?: unknown;
  events?: unknown;
  task?: unknown;
  editable?: unknown;
  fixes?: unknown;
}

/** Check a lesson's ConveyorBelt props against its scenario. Returns problems (empty = fine). */
export function checkConveyorProps(p: ConveyorProps, s: ConveyorScenario | undefined): string[] {
  const out: string[] = [];
  if (!s) return ['needs a cicd scenario (add course="cicd")'];
  const events = (p.events as EventPreset[] | undefined) ?? s.events ?? DEFAULT_EVENTS;
  const first = (p.event as EventPreset | undefined) ?? events[0]!;
  if (!events.includes(first)) out.push(`event "${first}" is not in events`);
  const task = (p.task as ConveyorTask | undefined) ?? { type: 'watch' };
  const types = ['watch', 'green', 'predict', 'event', 'approve', 'cacheHit'];
  if (!types.includes(task.type)) return [...out, `unknown task type "${String(task.type)}"`];
  const parsed = parseWorkflow(s.workflow);
  if (!parsed.workflow || !canRun(parsed.issues)) out.push('the scenario workflow does not run');
  const fixes = p.fixes as FixOption[] | undefined;
  if ((p.editable || fixes) && !s.fix) out.push('editable/fixes need a scenario with `fix` lines');
  const runAll = (yaml?: string, world?: Partial<World>) => events.map((e) => runScenario(s, e, { ...(yaml ? { yaml } : {}), ...(world ? { world } : {}) }));
  if (task.type === 'green') {
    if (runAll().some((r) => r.status === 'success') && !fixes && !p.editable) out.push('green: some event already passes, so there is nothing to fix');
    if (fixes) {
      const good = fixes.filter((f) => f.correct !== false && runAll(applyFix(s, f.text)).some((r) => r.status === 'success'));
      if (!good.length) out.push('green: no fix option turns the run green');
      for (const f of fixes) if (!f.label) out.push('green: every fix needs a label');
    }
    if (task.forbid) for (const re of task.forbid) {
      try {
        new RegExp(re);
      } catch {
        out.push(`green: bad forbid regex ${re}`);
      }
    }
  }
  if (task.type === 'predict') {
    const r = runScenario(s, first);
    const layout = parsed.workflow ? beltLayout(parsed.workflow) : null;
    if (!layout || (r.status !== 'success' && r.status !== 'failure')) out.push('predict: the first event must finish');
  }
  if (task.type === 'event') {
    const want = task.result;
    const hit = runAll().some((r) => (want === 'notTriggered' ? r.status === 'notTriggered' : r.jobs.some((j) => j.id === task.job) && r.jobs.filter((j) => j.id === task.job).every((j) => j.result === want)));
    if (!hit) out.push(`event: no event gives ${task.job ?? 'the workflow'} → ${want}`);
    if (want !== 'notTriggered' && !parsed.workflow?.jobs.some((j) => j.id === task.job)) out.push(`event: unknown job "${task.job ?? ''}"`);
  }
  if (task.type === 'approve' && !runAll().some((r) => r.status === 'waiting')) out.push('approve: no event waits for a review (add reviewers to an environment)');
  if (task.type === 'cacheHit') {
    const r1 = runScenario(s, first);
    const r2 = runScenario(s, first, { world: { cache: { warm: true, lockfileChanged: false, ...(r1.layersSaved ? { layers: true } : {}) } } });
    if (!r2.events.some((e) => e.type === 'cacheHit')) out.push('cacheHit: no cache to hit, even on a second run');
  }
  return out;
}

/** The station the predict task expects (null: nothing fails). */
export function predictAnswer(s: ConveyorScenario, event: EventPreset): Station | null {
  const wf = parseWorkflow(s.workflow).workflow;
  if (!wf) return null;
  return firstFailedStation(beltLayout(wf), runScenario(s, event));
}
