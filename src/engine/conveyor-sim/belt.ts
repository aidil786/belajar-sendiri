// The conveyor belt picture: stations in order, and what each one shows at any
// moment of a run. Pure, so the component only draws.
//
// - Several jobs: one station per job, in `needs` order (jobs that can run at the
//   same time share a column). A matrix job shows one lane per leg.
// - One job: one station per step, so the belt still has stations. Setup steps in
//   a row (checkout, setup-node, npm ci, cache…) share one "Get ready" station.
import { kindOf, stepKind, type StationKind } from './actions';
import type { JobResult, RunEvent, RunResult, RunStatus, Workflow } from './types';

export interface Station {
  id: string;
  /** Job name or step name, as written. Empty for a merged "Get ready" station. */
  label: string;
  kind: StationKind;
  /** Jobs mode: the job id. */
  job?: string;
  /** Steps mode: the step indexes of the one job. */
  steps?: number[];
  /** Column (0 = first). */
  depth: number;
  /** First YAML line of the station. */
  line: number;
}

export interface BeltLayout {
  mode: 'jobs' | 'steps';
  /** Steps mode: the only job's id. */
  job?: string;
  columns: Station[][];
}

const RANK: StationKind[] = ['other', 'prep', 'lint', 'test', 'build', 'scan', 'publish', 'deploy'];

export function beltLayout(wf: Workflow): BeltLayout {
  if (wf.jobs.length === 1 && !wf.jobs[0]!.uses) {
    const job = wf.jobs[0]!;
    const columns: Station[][] = [];
    let prep: Station | null = null;
    for (const s of job.steps) {
      const kind = stepKind(s);
      if (kind === 'prep') {
        if (!prep) {
          prep = { id: `s${s.index}`, label: '', kind: 'prep', steps: [], depth: columns.length, line: s.line };
          columns.push([prep]);
        }
        prep.steps!.push(s.index);
        continue;
      }
      prep = null;
      columns.push([{ id: `s${s.index}`, label: s.name ?? (s.run ? s.run.trim().split('\n')[0]! : (s.uses ?? '')), kind, steps: [s.index], depth: columns.length, line: s.line }]);
    }
    return { mode: 'steps', job: job.id, columns };
  }
  const depth = new Map<string, number>();
  const ids = new Set(wf.jobs.map((j) => j.id));
  const d = (id: string, seen = new Set<string>()): number => {
    if (depth.has(id)) return depth.get(id)!;
    if (seen.has(id)) return 0;
    seen.add(id);
    const job = wf.jobs.find((j) => j.id === id);
    const v = Math.max(-1, ...(job?.needs ?? []).filter((n) => ids.has(n)).map((n) => d(n, seen))) + 1;
    depth.set(id, v);
    return v;
  };
  const columns: Station[][] = [];
  for (const job of wf.jobs) {
    const at = d(job.id);
    while (columns.length <= at) columns.push([]);
    columns[at]!.push({ id: job.id, label: job.name ?? job.id, kind: jobKind(job), job: job.id, depth: at, line: job.line });
  }
  return { mode: 'jobs', columns };
}

function jobKind(job: Workflow['jobs'][number]): StationKind {
  const byName = kindOf(`${job.id} ${job.name ?? ''}`);
  if (byName !== 'other' && byName !== 'prep') return byName;
  if (job.environment) return 'deploy';
  let best: StationKind = byName;
  for (const s of job.steps) {
    const k = stepKind(s);
    if (RANK.indexOf(k) > RANK.indexOf(best)) best = k;
  }
  return best;
}

export type Live = 'idle' | 'running' | 'success' | 'failure' | 'skipped' | 'cancelled' | 'waiting';

export interface JobView {
  state: Live;
  steps: Live[];
  /** Steps that failed but continue-on-error kept the job going. */
  continued: Set<number>;
}

export interface RunView {
  /** Events applied so far. */
  applied: number;
  t: number;
  started: boolean;
  finished: boolean;
  status?: RunStatus;
  jobs: Record<string, JobView>;
  /** Matrix legs per job id (from matrixSplit). */
  legs: Record<string, string[]>;
  caches: { job: string; step: number; key: string; hit: boolean; partial?: boolean }[];
  saved: string[];
  artifacts: { name: string; from: string; to: string[] }[];
  approval?: { job: string; environment: string; reviewers: string[]; decided?: 'approved' | 'rejected' };
  olderCancelled: boolean;
  pending: boolean;
}

const fromJob = (r: JobResult): Live => r;

/** What the belt shows after the first `upto` events of a run. */
export function viewAt(result: RunResult, upto: number = result.events.length): RunView {
  const v: RunView = { applied: 0, t: 0, started: false, finished: false, jobs: {}, legs: {}, caches: [], saved: [], artifacts: [], olderCancelled: false, pending: false };
  for (const j of result.jobs) v.jobs[j.key] = { state: 'idle', steps: j.steps.map(() => 'idle'), continued: new Set() };
  const n = Math.min(upto, result.events.length);
  for (let i = 0; i < n; i++) apply(v, result.events[i]!, result);
  v.applied = n;
  return v;
}

function apply(v: RunView, e: RunEvent, r: RunResult) {
  v.t = e.t;
  const job = 'job' in e ? v.jobs[e.job] : undefined;
  switch (e.type) {
    case 'runQueued':
      v.started = true;
      break;
    case 'runPending':
      v.pending = true;
      break;
    case 'olderRunCancelled':
      v.olderCancelled = true;
      break;
    case 'matrixSplit':
      v.legs[e.job] = e.legs;
      break;
    case 'jobStarted':
      v.pending = false;
      if (job) job.state = 'running';
      break;
    case 'jobSkipped':
      if (job) {
        job.state = 'skipped';
        job.steps = job.steps.map(() => 'skipped');
      }
      break;
    case 'jobFinished':
      if (job) job.state = fromJob(e.result);
      break;
    case 'stepStarted':
      if (job) job.steps[e.step] = 'running';
      break;
    case 'stepPassed':
      if (job) job.steps[e.step] = 'success';
      break;
    case 'stepFailed':
      if (job) {
        job.steps[e.step] = 'failure';
        if (e.continued) job.continued.add(e.step);
      }
      break;
    case 'stepSkipped':
      if (job) job.steps[e.step] = 'skipped';
      break;
    case 'stepCancelled':
      if (job) job.steps[e.step] = 'cancelled';
      break;
    case 'cacheHit':
      v.caches.push({ job: e.job, step: e.step, key: e.key, hit: true, ...(e.partial ? { partial: true } : {}) });
      break;
    case 'cacheMiss':
      v.caches.push({ job: e.job, step: e.step, key: e.key, hit: false });
      break;
    case 'cacheSaved':
      v.saved.push(e.key);
      break;
    case 'artifactUploaded':
      v.artifacts.push({ name: e.name, from: e.job, to: [] });
      break;
    case 'artifactDownloaded': {
      const a = v.artifacts.find((x) => x.name === e.name);
      if (a && !a.to.includes(e.job)) a.to.push(e.job);
      break;
    }
    case 'approvalWaiting':
      v.approval = { job: e.job, environment: e.environment, reviewers: e.reviewers };
      if (job) job.state = 'waiting';
      break;
    case 'approved':
      if (v.approval) v.approval.decided = 'approved';
      break;
    case 'rejected':
      if (v.approval) v.approval.decided = 'rejected';
      break;
    case 'runFinished':
      v.finished = true;
      v.status = e.status;
      break;
  }
  // A job that waits for approval and never got a decision stays "waiting".
  if (e.type === 'runFinished') {
    for (const j of r.jobs) if (j.result === 'waiting' && v.jobs[j.key]) v.jobs[j.key]!.state = 'waiting';
  }
}

export interface Lane {
  key: string;
  /** Matrix values, e.g. "22" or "22, ubuntu-latest". Empty without a matrix. */
  label: string;
  state: Live;
}

export interface StationView {
  state: Live;
  lanes: Lane[];
  cache?: 'hit' | 'partial' | 'miss';
  /** A step in this station failed but continue-on-error let it pass. */
  continued: boolean;
}

function combine(states: Live[]): Live {
  if (!states.length) return 'idle';
  if (states.includes('running')) return 'running';
  if (states.includes('waiting')) return 'waiting';
  if (states.includes('failure')) return 'failure';
  if (states.includes('cancelled')) return 'cancelled';
  if (states.every((s) => s === 'skipped')) return 'skipped';
  if (states.every((s) => s === 'success' || s === 'skipped')) return 'success';
  if (states.some((s) => s === 'success')) return 'running';
  return 'idle';
}

/** The state of one station at this moment of the run. */
export function stationView(st: Station, layout: BeltLayout, result: RunResult | null, view: RunView | null): StationView {
  if (!result || !view) return { state: 'idle', lanes: [], continued: false };
  const jobId = layout.mode === 'jobs' ? st.job! : layout.job!;
  const legs = result.jobs.filter((j) => j.id === jobId);
  const lanes: Lane[] = legs.map((j) => {
    const jv = view.jobs[j.key];
    let state: Live = 'idle';
    if (jv) {
      if (layout.mode === 'jobs') state = jv.state;
      else {
        state = combine(st.steps!.map((i) => jv.steps[i] ?? 'idle'));
        if (state === 'idle' && (jv.state === 'skipped' || jv.state === 'cancelled')) state = jv.state;
        if (state === 'idle' && jv.state === 'waiting') state = 'waiting';
      }
    }
    return { key: j.key, label: j.matrix ? Object.values(j.matrix).map(String).join(', ') : '', state };
  });
  const caches = view.caches.filter((c) => legs.some((j) => j.key === c.job) && (layout.mode === 'jobs' || st.steps!.includes(c.step)));
  let cache: StationView['cache'];
  if (caches.length) cache = caches.some((c) => c.hit && !c.partial) ? 'hit' : caches.some((c) => c.partial) ? 'partial' : 'miss';
  const continued = legs.some((j) => {
    const jv = view.jobs[j.key];
    if (!jv) return false;
    return [...jv.continued].some((i) => layout.mode === 'jobs' || st.steps!.includes(i));
  });
  const out: StationView = { state: combine(lanes.map((l) => l.state)), lanes: lanes.length > 1 ? lanes : [], continued };
  if (cache) out.cache = cache;
  return out;
}

/** The station that failed first in a finished run (the one to predict), or null for a green run. */
export function firstFailedStation(layout: BeltLayout, result: RunResult): Station | null {
  const failed = result.events.find((e) => e.type === 'stepFailed' && !e.continued) as Extract<RunEvent, { type: 'stepFailed' }> | undefined;
  const rejected = result.jobs.find((j) => j.result === 'failure' && j.steps.every((s) => s.result !== 'failure'));
  let jobKey = failed?.job;
  const step = failed?.step;
  if (!failed && rejected) jobKey = rejected.key;
  if (!jobKey) return null;
  const job = result.jobs.find((j) => j.key === jobKey);
  if (!job) return null;
  for (const col of layout.columns) {
    for (const st of col) {
      if (layout.mode === 'jobs' && st.job === job.id) return st;
      if (layout.mode === 'steps' && step !== undefined && st.steps?.includes(step)) return st;
    }
  }
  return null;
}

/** All stations, first column first. */
export function stations(layout: BeltLayout): Station[] {
  return layout.columns.flat();
}
