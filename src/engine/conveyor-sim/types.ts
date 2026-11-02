// Core types for the Belajar Sendiri conveyor simulator (CI/CD pipelines).
// The engine is pure TypeScript: no DOM, no React, no i18n strings.
// Messages are i18n keys (`conveyor.*`) plus params; components translate them.

/** A message for the learner, from validation or from a run. */
export interface Note {
  /** i18n key, e.g. 'conveyor.issue.unknownKey'. */
  key: string;
  params?: Record<string, string | number>;
}

/** A validation message about the workflow file. */
export interface Issue extends Note {
  /** error: GitHub would refuse the file (the run does not start). warning/info: it runs. */
  level: 'error' | 'warning' | 'info';
  /** 1-based line in the YAML, when known. */
  line?: number;
  /** What GitHub (or the tool) would print, in English, when there is a real message. */
  real?: string;
}

export type Scalar = string | number | boolean;
export type PermLevel = 'read' | 'write' | 'none';
/** After normalising: scope → level. Missing scopes are 'none'. */
export type Permissions = Record<string, PermLevel>;
/** As written: `read-all`, `write-all`, `{}` or a map. */
export type PermSpec = 'read-all' | 'write-all' | Permissions;

export interface Concurrency {
  group: string;
  cancelInProgress: boolean | string;
  queue?: 'single' | 'max';
}

export interface Step {
  index: number;
  id?: string;
  name?: string;
  uses?: string;
  run?: string;
  with: Record<string, string>;
  env: Record<string, string>;
  if?: string;
  continueOnError: boolean | string;
  timeoutMinutes?: number;
  /** Line of the step's first key (the `- ` line). */
  line: number;
  /** Lines of the `run:` value (first, last), when there is one. */
  runLines?: [number, number];
  /** Line of the `uses:` key. */
  usesLine?: number;
}

export interface Matrix {
  axes: Record<string, Scalar[]>;
  include: Record<string, Scalar>[];
  exclude: Record<string, Scalar>[];
}

export interface Job {
  id: string;
  name?: string;
  line: number;
  runsOn: string[];
  runsOnLine?: number;
  needs: string[];
  if?: string;
  permissions?: PermSpec;
  environment?: { name: string; url?: string };
  concurrency?: Concurrency;
  services: Record<string, { image: string }>;
  outputs: Record<string, string>;
  env: Record<string, string>;
  matrix?: Matrix;
  failFast: boolean;
  maxParallel?: number;
  continueOnError: boolean | string;
  timeoutMinutes: number;
  steps: Step[];
  /** A reusable workflow call (`uses:` on the job). */
  uses?: string;
  with: Record<string, string>;
}

/** Trigger config per event name. A bare event (`on: push`) is `{}`. */
export type Triggers = Record<string, Record<string, unknown>>;

export interface Workflow {
  name?: string;
  on: Triggers;
  /** Line of each event name under `on:`. */
  onLines: Record<string, number>;
  permissions?: PermSpec;
  permissionsLine?: number;
  concurrency?: Concurrency;
  env: Record<string, string>;
  jobs: Job[];
}

export interface ParseResult {
  workflow: Workflow | null;
  issues: Issue[];
}

/** What happened on GitHub: the event that may start the workflow. */
export interface Trigger {
  event: 'push' | 'pull_request' | 'pull_request_target' | 'workflow_dispatch' | 'schedule' | 'release' | 'workflow_call' | 'issues' | 'issue_comment';
  /** push: the pushed branch. pull_request: the head (source) branch. */
  branch?: string;
  /** push of a tag; release: its tag. */
  tag?: string;
  /** pull_request: the base (target) branch. */
  base?: string;
  /** pull_request from someone else's fork. */
  fork?: boolean;
  /** Activity type: 'opened', 'synchronize', 'published', … */
  action?: string;
  /** Changed files, for `paths` filters. */
  changed?: string[];
  inputs?: Record<string, string>;
  /** PR number (for `pr-N` tags). */
  number?: number;
}

/** The buttons a learner can pick. */
export type EventPreset = 'push-main' | 'push-branch' | 'pr' | 'fork-pr' | 'tag' | 'dispatch' | 'schedule' | 'release';

/** One approval decision per environment name. */
export type Decisions = Record<string, 'approve' | 'reject'>;

/** Scenario flags: the world around the workflow. Everything is optional. */
export interface World {
  repo?: { owner?: string; name?: string; defaultBranch?: string; private?: boolean; tokenDefault?: 'read' | 'write' };
  /** Repository secrets that exist (names only). */
  secrets?: string[];
  vars?: Record<string, string>;
  environments?: Record<string, EnvironmentRule>;
  cache?: {
    /** A previous run saved caches for this lockfile (npm cache, actions/cache keys). */
    warm?: boolean;
    /** package-lock.json changed since that run: keys with hashFiles(...) miss. */
    lockfileChanged?: boolean;
    /** The Docker layer cache (cache-from: type=gha) is warm. */
    layers?: boolean;
    /** Lockfile hash that hashFiles() returns (default 'a1b2c3d4e5'). */
    lockfile?: string;
  };
  fail?: FailFlags;
  /** An older run of this workflow on the same ref is still going. */
  olderRun?: boolean;
  /** Commit sha (default a fixed fake one). */
  sha?: string;
}

export interface EnvironmentRule {
  /** Required reviewers. With reviewers, the job waits for a decision. */
  reviewers?: string[];
  /** Deployment branch rule: only these branches (globs) may deploy. */
  branches?: string[];
  /** Environment secrets (names). */
  secrets?: string[];
  /** Decide automatically (for demos). */
  approve?: boolean;
}

export interface FailFlags {
  /** Failing test names. Empty or missing: tests pass. */
  tests?: string[];
  /** Only matrix legs that match these values fail the tests (e.g. { node: '22' }). */
  onlyIn?: Record<string, string>;
  /** Lint problems (file:line messages). */
  lint?: string[];
  build?: boolean;
  /** Highest severity of a known vulnerability in the image. */
  cve?: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  /** hadolint finds DL3007 (FROM ...:latest). */
  hadolint?: boolean;
  /** The smoke test (curl) gets an error page. */
  smoke?: boolean;
  /** Tests need a database: without a postgres service they cannot connect. */
  db?: boolean;
  /** A command (substring) that hangs until the job times out. */
  hang?: string;
}

// ---------- Run results ----------

export type StepResult = 'success' | 'failure' | 'skipped' | 'cancelled';
export type JobResult = 'success' | 'failure' | 'skipped' | 'cancelled' | 'waiting';
export type RunStatus = 'success' | 'failure' | 'cancelled' | 'waiting' | 'notTriggered' | 'invalid';

export interface LogLine {
  text: string;
  kind?: 'cmd' | 'ok' | 'err' | 'warn' | 'dim';
}

export interface StepRun {
  index: number;
  name: string;
  uses?: string;
  run?: string;
  line: number;
  result: StepResult;
  /** Result before continue-on-error. */
  outcome: StepResult;
  start: number;
  end: number;
  log: LogLine[];
  /** Plain-words reason when it failed. */
  why?: Note;
  outputs: Record<string, string>;
}

export interface JobRun {
  /** Unique key: the job id, or `test (22)` for a matrix leg. */
  key: string;
  id: string;
  name: string;
  matrix?: Record<string, Scalar>;
  needs: string[];
  result: JobResult;
  /** Seconds since the run started. */
  start: number;
  end: number;
  steps: StepRun[];
  environment?: string;
  outputs: Record<string, string>;
  /** Plain-words reason when it failed, was skipped or cancelled. */
  why?: Note;
  log: LogLine[];
}

export type RunEvent =
  | { type: 'runQueued'; t: number; event: string; ref: string }
  | { type: 'runPending'; t: number; group: string }
  | { type: 'olderRunCancelled'; t: number; group: string }
  | { type: 'matrixSplit'; t: number; job: string; legs: string[] }
  | { type: 'jobStarted'; t: number; job: string }
  | { type: 'jobSkipped'; t: number; job: string; why?: Note }
  | { type: 'jobFinished'; t: number; job: string; result: JobResult }
  | { type: 'stepStarted'; t: number; job: string; step: number; name: string }
  | { type: 'stepPassed'; t: number; job: string; step: number; name: string }
  | { type: 'stepFailed'; t: number; job: string; step: number; name: string; why?: Note; continued?: boolean }
  | { type: 'stepSkipped'; t: number; job: string; step: number; name: string }
  | { type: 'stepCancelled'; t: number; job: string; step: number; name: string }
  | { type: 'cacheHit'; t: number; job: string; step: number; key: string; partial?: boolean }
  | { type: 'cacheMiss'; t: number; job: string; step: number; key: string }
  | { type: 'cacheSaved'; t: number; job: string; key: string }
  | { type: 'artifactUploaded'; t: number; job: string; name: string }
  | { type: 'artifactDownloaded'; t: number; job: string; name: string }
  | { type: 'approvalWaiting'; t: number; job: string; environment: string; reviewers: string[] }
  | { type: 'approved'; t: number; job: string; environment: string }
  | { type: 'rejected'; t: number; job: string; environment: string }
  | { type: 'runFinished'; t: number; status: RunStatus };

export interface RunResult {
  status: RunStatus;
  triggered: boolean;
  /** Why the workflow did not start (notTriggered / invalid). */
  why?: Note;
  issues: Issue[];
  jobs: JobRun[];
  events: RunEvent[];
  /** Seconds on the fake clock. */
  duration: number;
  /** Artifact names uploaded in this run. */
  artifacts: string[];
  /** The event GitHub saw (github.event_name). */
  eventName: string;
  ref: string;
  /** The environment a waiting job needs a decision for. */
  waitingFor?: string;
  /** Cache keys saved by this run (the next run can hit them). */
  cachesSaved?: string[];
  /** The Docker layer cache was saved (cache-to: type=gha). */
  layersSaved?: boolean;
}
