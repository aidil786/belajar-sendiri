// Run a workflow on a fake runner with a fake clock. Pure: same input, same result.
//
//   const r = simulate(yaml, { trigger: presetTrigger('push-main'), world });
//   r.status → 'success' | 'failure' | 'cancelled' | 'waiting' | 'notTriggered' | 'invalid'
//   r.jobs   → every job (matrix legs too) with steps, logs and times
//   r.events → what happened, in time order, for animations
import { parseUses } from './actions';
import { matchTrigger, refOf } from './events';
import { evalIf, evaluate, interpolate, truthy, type ExprContext, type Value } from './expr';
import { matchList } from './glob';
import { canRun, parseWorkflow, PERMISSION_SCOPES } from './parse';
import { runAction, runScript, secretValue, TOKEN_VALUE, fakeHex, type JobState, type Repo, type RunState, type StepCtx, type StepMark } from './steps';
import type {
  Decisions, Job, JobResult, JobRun, LogLine, Matrix, Note, Permissions, PermSpec, RunEvent, RunResult, RunStatus, Scalar, StepRun, Trigger, Workflow, World,
} from './types';

export interface RunOptions {
  trigger: Trigger;
  world?: World;
  /** Approve or reject environments that need a review. */
  decisions?: Decisions;
}

export const DEFAULT_SHA = '3f9c2a7e1b4d8c6f0a5e9d2b7c4f1a8e6d3b0c95';
const QUEUE = 3; // waiting for a runner
const SETUP = 2; // "Set up job"
const APPROVAL_WAIT = 30;
const OLDER_RUN_LEFT = 40;

/** All matrix combinations, with include/exclude like GitHub. */
export function expandMatrix(m: Matrix): Record<string, Scalar>[] {
  const keys = Object.keys(m.axes);
  let combos: Record<string, Scalar>[] = keys.length ? [{}] : [];
  for (const k of keys) combos = combos.flatMap((c) => m.axes[k]!.map((v) => ({ ...c, [k]: v })));
  combos = combos.filter((c) => !m.exclude.some((ex) => Object.entries(ex).every(([k, v]) => String(c[k]) === String(v))));
  for (const inc of m.include) {
    let added = false;
    for (const c of combos) {
      const clash = Object.entries(inc).some(([k, v]) => keys.includes(k) && k in c && String(c[k]) !== String(v));
      if (!clash) {
        Object.assign(c, inc);
        added = true;
      }
    }
    if (!added) combos.push({ ...inc });
  }
  return combos;
}

export function legKey(job: Job, leg: Record<string, Scalar> | undefined): string {
  const base = job.name && !job.name.includes('${{') ? job.name : job.id;
  if (!leg) return base;
  return `${base} (${Object.values(leg).map(String).join(', ')})`;
}

/** Jobs in run order: needs first, then file order. */
export function jobOrder(wf: Workflow): Job[] {
  const done = new Set<string>();
  const out: Job[] = [];
  const left = [...wf.jobs];
  while (left.length) {
    const i = left.findIndex((j) => j.needs.every((n) => done.has(n) || !wf.jobs.some((x) => x.id === n)));
    const next = left.splice(i === -1 ? 0 : i, 1)[0]!;
    done.add(next.id);
    out.push(next);
  }
  return out;
}

/** GITHUB_TOKEN permissions for a job. */
export function tokenPermissions(wf: Workflow, job: Job, world: World, fork: boolean): Permissions {
  const spec: PermSpec | undefined = job.permissions ?? wf.permissions;
  const all = [...PERMISSION_SCOPES];
  let p: Permissions = {};
  if (spec === undefined) {
    if (world.repo?.tokenDefault === 'write') {
      for (const s of all) p[s] = s === 'id-token' ? 'none' : 'write';
    } else {
      p = { contents: 'read', packages: 'read' };
    }
  } else if (spec === 'read-all') {
    for (const s of all) p[s] = s === 'id-token' ? 'none' : 'read';
  } else if (spec === 'write-all') {
    for (const s of all) p[s] = 'write';
  } else p = { ...spec };
  if (fork) {
    for (const s of Object.keys(p)) if (p[s] === 'write') p[s] = s === 'id-token' ? 'none' : 'read';
  }
  return p;
}

interface LegInfo {
  run: JobRun;
  approval?: { at: number; decidedAt?: number; decision?: 'approve' | 'reject'; reviewers: string[] };
  saves: { key: string; t: number }[];
  /** Steps cut off by fail-fast: no events. */
  silent: Set<number>;
  marks: Map<number, StepMark[]>;
  /** Time the failing step ended (for fail-fast). */
  failedAt?: number;
  continueOnError: boolean;
  /** The Docker layer cache was saved (cache-to: type=gha). */
  layers?: boolean;
}

export function simulate(text: string, o: RunOptions): RunResult {
  const world = o.world ?? {};
  const t = o.trigger;
  const defaultBranch = world.repo?.defaultBranch ?? 'main';
  const ref = refOf(t, defaultBranch);
  const parsed = parseWorkflow(text);
  const empty = { issues: parsed.issues, jobs: [], events: [], duration: 0, artifacts: [], eventName: t.event, ref };
  if (!parsed.workflow || !canRun(parsed.issues)) {
    return { ...empty, status: 'invalid', triggered: false, why: { key: 'conveyor.why.invalid' } };
  }
  const wf = parsed.workflow;
  const match = matchTrigger(wf, t);
  if (!match.ok) return { ...empty, status: 'notTriggered', triggered: false, why: match.why };

  const eventName = match.eventName;
  const isPr = eventName === 'pull_request' || eventName === 'pull_request_target';
  const fork = Boolean(t.fork) && eventName === 'pull_request';
  const owner = world.repo?.owner ?? 'you';
  const repo: Repo = {
    owner,
    name: world.repo?.name ?? 'shop',
    full: `${owner}/${world.repo?.name ?? 'shop'}`,
    private: Boolean(world.repo?.private),
    defaultBranch,
  };
  const realRef = eventName === 'pull_request_target' ? `refs/heads/${t.base ?? defaultBranch}` : ref;
  const sha = world.sha ?? DEFAULT_SHA;
  const lockBase = world.cache?.lockfile ?? 'a1b2c3d4e5f6';
  const lockHash = world.cache?.lockfileChanged ? fakeHex(lockBase, 12) : lockBase;
  const refName = realRef.replace(/^refs\/(heads|tags|pull)\//, '');
  const github: Record<string, Value> = {
    event_name: eventName,
    ref: realRef,
    ref_name: refName,
    ref_type: t.tag && !isPr ? 'tag' : 'branch',
    sha,
    repository: repo.full,
    repository_owner: owner,
    actor: fork ? 'stranger' : owner,
    head_ref: isPr ? (t.branch ?? 'feature') : '',
    base_ref: isPr ? (t.base ?? defaultBranch) : '',
    workflow: wf.name ?? 'CI',
    run_id: '1234567890',
    run_number: '42',
    run_attempt: '1',
    token: TOKEN_VALUE,
    server_url: 'https://github.com',
    event: {
      ref: realRef,
      repository: { default_branch: defaultBranch, private: repo.private, full_name: repo.full },
      ...(isPr
        ? {
            number: t.number ?? 1,
            pull_request: {
              number: t.number ?? 1,
              title: 'Add a feature',
              body: 'Please merge.',
              head: { ref: t.branch ?? 'feature', sha: fakeHex(sha + 'pr', 40), repo: { fork: Boolean(t.fork), full_name: t.fork ? `stranger/${repo.name}` : repo.full } },
              base: { ref: t.base ?? defaultBranch },
            },
          }
        : {}),
      ...(t.event === 'release' ? { release: { tag_name: t.tag ?? 'v1.2.0' } } : {}),
      ...(t.event === 'issues' || t.event === 'issue_comment' ? { issue: { title: 'Bug report', body: 'It broke.' }, comment: { body: 'Me too.' } } : {}),
      inputs: t.inputs ?? {},
    },
  };
  const dispatchInputs = (wf.on.workflow_dispatch?.inputs ?? {}) as Record<string, Record<string, string>>;
  const inputs: Record<string, Value> = {};
  for (const [k, def] of Object.entries(dispatchInputs)) inputs[k] = def.default ?? '';
  Object.assign(inputs, t.inputs ?? {});

  const hashFiles = (patterns: string[]) => (patterns.some((p) => /lock|package/.test(p)) ? lockHash : fakeHex(patterns.join(','), 12));
  const baseCtx = (extra: Record<string, Value | undefined>, status?: ExprContext['status']): ExprContext => ({
    context: (name) => (name === 'github' ? github : name === 'vars' ? (world.vars ?? {}) : name === 'inputs' ? inputs : name === 'runner' ? { os: 'Linux', arch: 'X64', temp: '/home/runner/work/_temp' } : extra[name]),
    status,
    hashFiles,
  });
  const safeInterp = (s: string, ctx: ExprContext) => {
    try {
      return interpolate(s, ctx);
    } catch {
      return s;
    }
  };

  const events: RunEvent[] = [];
  let start = 0;
  events.push({ type: 'runQueued', t: 0, event: eventName, ref: realRef });

  // Concurrency with an older run of the same workflow on the same ref.
  if (world.olderRun && wf.concurrency) {
    const mine = safeInterp(wf.concurrency.group, baseCtx({}));
    const olderGithub = { ...github, run_id: '1234567889', run_number: '41', run_attempt: '1', sha: fakeHex(sha + 'old', 40) };
    const older = safeInterp(wf.concurrency.group, { ...baseCtx({}), context: (n) => (n === 'github' ? olderGithub : baseCtx({}).context(n)) });
    if (mine === older) {
      const cip = wf.concurrency.cancelInProgress;
      const cancel = typeof cip === 'boolean' ? cip : truthy(safeEval(cip, baseCtx({})));
      if (cancel) events.push({ type: 'olderRunCancelled', t: 0, group: mine });
      else {
        events.push({ type: 'runPending', t: 0, group: mine });
        start = OLDER_RUN_LEFT;
      }
    }
  }

  const rs: RunState = { artifacts: new Map() };
  const order = jobOrder(wf);
  const runs = new Map<string, LegInfo[]>(); // job id → legs
  const skipped = new Map<string, Note>();
  const skippedAt = new Map<string, number>();
  const waiting = new Set<string>();
  let waitingFor: string | undefined;
  let layersSaved = false;

  for (const job of order) {
    const needLegs = job.needs.map((n) => ({ id: n, legs: runs.get(n) ?? [] }));
    const needResult = (id: string): JobResult => {
      if (skipped.has(id)) return 'skipped';
      if (waiting.has(id)) return 'waiting';
      const legs = runs.get(id) ?? [];
      if (legs.some((l) => l.run.result === 'failure' && !l.continueOnError)) return 'failure';
      if (legs.some((l) => l.run.result === 'cancelled')) return 'cancelled';
      return 'success';
    };
    if (job.needs.some((n) => needResult(n) === 'waiting')) {
      waiting.add(job.id);
      continue;
    }
    const ready = Math.max(start, ...needLegs.flatMap((n) => n.legs.map((l) => l.run.end)), ...job.needs.map((n) => skippedAt.get(n) ?? 0));
    const ancestors = allNeeds(wf, job.id);
    const anyFailed = [...ancestors].some((a) => needResult(a) === 'failure');
    const anyCancelled = [...ancestors].some((a) => needResult(a) === 'cancelled');
    const needsCtx: Record<string, Value> = {};
    for (const n of job.needs) {
      const legs = runs.get(n) ?? [];
      const outputs: Record<string, Value> = {};
      for (const l of legs) Object.assign(outputs, l.run.outputs);
      needsCtx[n] = { result: needResult(n), outputs };
    }
    const status: ExprContext['status'] = anyFailed ? 'failure' : anyCancelled ? 'cancelled' : 'success';
    const ctx = baseCtx({ needs: needsCtx, env: {}, secrets: {} }, status);
    let runIt: boolean;
    let skipWhy: Note | undefined;
    const hasStatusFn = job.if !== undefined && /\b(success|failure|always|cancelled)\s*\(/i.test(job.if);
    if (!hasStatusFn && job.needs.some((n) => needResult(n) !== 'success')) {
      runIt = false;
      const bad = job.needs.find((n) => needResult(n) !== 'success')!;
      skipWhy = { key: needResult(bad) === 'skipped' ? 'conveyor.why.needSkipped' : 'conveyor.why.needFailed', params: { job: job.id, need: bad } };
    } else {
      try {
        runIt = evalIf(job.if, { ...ctx, status: hasStatusFn ? status : 'success' });
      } catch {
        runIt = false;
      }
      if (!runIt) skipWhy = { key: 'conveyor.why.ifFalse', params: { job: job.id, cond: job.if ?? '' } };
    }
    if (!runIt) {
      skipped.set(job.id, skipWhy!);
      skippedAt.set(job.id, ready);
      continue;
    }

    const combos = job.matrix ? expandMatrix(job.matrix) : [];
    const legs: (Record<string, Scalar> | undefined)[] = combos.length ? combos : [undefined];
    if (combos.length) events.push({ type: 'matrixSplit', t: ready, job: job.id, legs: legs.map((l) => legKey(job, l)) });
    const infos: LegInfo[] = [];
    const maxPar = job.maxParallel && job.maxParallel > 0 ? job.maxParallel : legs.length;
    legs.forEach((leg, i) => {
      const legStart = i < maxPar ? ready : Math.max(ready, infos[i - maxPar]!.run.end);
      const info = runLeg({
        wf, job, leg, legIndex: i, legTotal: legs.length, start: legStart, world, trigger: t, eventName, repo, sha, fork, rs, github, needsCtx, baseCtx, lockHash, oldLockHash: lockBase, decisions: o.decisions ?? {}, refName,
      });
      infos.push(info);
    });
    // fail-fast: the first failing leg cancels the legs still running.
    if (combos.length && job.failFast) {
      const failing = infos.filter((l) => l.failedAt !== undefined && !l.continueOnError).sort((a, b) => a.failedAt! - b.failedAt!)[0];
      if (failing) {
        const tf = failing.failedAt!;
        for (const l of infos) {
          if (l === failing || l.run.result === 'failure' || l.run.end <= tf || l.run.result === 'waiting') continue;
          cutLeg(l, tf, failing.run.key, rs);
        }
      }
    }
    for (const l of infos) {
      if (l.run.result === 'waiting') {
        waiting.add(job.id);
        waitingFor = l.run.environment;
      }
      if (l.run.result === 'success' && l.layers) layersSaved = true;
    }
    runs.set(job.id, infos);
  }

  // Build the job list and the event list.
  const jobs: JobRun[] = [];
  const seq: { e: RunEvent; n: number }[] = events.map((e, n) => ({ e, n }));
  let n = seq.length;
  const push = (e: RunEvent) => seq.push({ e, n: n++ });
  for (const job of order) {
    if (skipped.has(job.id)) {
      const why = skipped.get(job.id)!;
      jobs.push({ key: legKey(job, undefined), id: job.id, name: job.name ?? job.id, needs: job.needs, result: 'skipped', start: skippedAt.get(job.id) ?? 0, end: skippedAt.get(job.id) ?? 0, steps: skippedSteps(job, skippedAt.get(job.id) ?? 0), outputs: {}, why, log: [] });
      push({ type: 'jobSkipped', t: skippedAt.get(job.id) ?? 0, job: legKey(job, undefined), why });
      continue;
    }
    const infos = runs.get(job.id);
    if (!infos) {
      jobs.push({ key: legKey(job, undefined), id: job.id, name: job.name ?? job.id, needs: job.needs, result: 'waiting', start: 0, end: 0, steps: skippedSteps(job, 0).map((s) => ({ ...s, result: 'skipped' })), outputs: {}, log: [] });
      continue;
    }
    for (const l of infos) {
      jobs.push(l.run);
      for (const e of legEvents(l)) push(e);
    }
  }
  const finished = jobs.filter((j) => j.result !== 'waiting');
  const duration = Math.max(start, ...finished.map((j) => j.end), 0);
  let status: RunStatus;
  if (jobs.some((j) => j.result === 'waiting')) status = 'waiting';
  else if (jobs.some((j) => j.result === 'failure' && !jobContinues(wf, j))) status = 'failure';
  else if (jobs.some((j) => j.result === 'cancelled')) status = 'cancelled';
  else status = 'success';
  if (status !== 'waiting') push({ type: 'runFinished', t: duration, status });
  seq.sort((a, b) => a.e.t - b.e.t || a.n - b.n);
  const result: RunResult = {
    status,
    triggered: true,
    issues: parsed.issues,
    jobs,
    events: seq.map((s) => s.e),
    duration,
    artifacts: [...rs.artifacts.keys()],
    eventName,
    ref: realRef,
  };
  if (waitingFor !== undefined) result.waitingFor = waitingFor;
  if (layersSaved) result.layersSaved = true;
  const saved = seq.filter((s) => s.e.type === 'cacheSaved').map((s) => (s.e as { key: string }).key);
  if (saved.length) result.cachesSaved = saved;
  return result;

  function safeEval(src: string, ctx: ExprContext): Value | undefined {
    try {
      return evaluate(src.replace(/^\$\{\{([\s\S]*)\}\}$/, '$1'), ctx);
    } catch {
      return undefined;
    }
  }
}

function jobContinues(wf: Workflow, j: JobRun): boolean {
  const job = wf.jobs.find((x) => x.id === j.id);
  return job?.continueOnError === true;
}

function allNeeds(wf: Workflow, id: string, seen = new Set<string>()): Set<string> {
  for (const n of wf.jobs.find((j) => j.id === id)?.needs ?? []) {
    if (seen.has(n)) continue;
    seen.add(n);
    allNeeds(wf, n, seen);
  }
  return seen;
}

function stepTitle(s: { name?: string; uses?: string; run?: string }): string {
  if (s.name) return s.name;
  if (s.uses) return `Run ${s.uses}`;
  return `Run ${(s.run ?? '').trim().split('\n')[0]}`;
}

function skippedSteps(job: Job, at: number): StepRun[] {
  return job.steps.map((s) => ({ index: s.index, name: stepTitle(s), ...(s.uses ? { uses: s.uses } : {}), ...(s.run ? { run: s.run } : {}), line: s.line, result: 'skipped', outcome: 'skipped', start: at, end: at, log: [], outputs: {} }));
}

interface LegArgs {
  wf: Workflow;
  job: Job;
  leg: Record<string, Scalar> | undefined;
  legIndex: number;
  legTotal: number;
  start: number;
  world: World;
  trigger: Trigger;
  eventName: string;
  repo: Repo;
  sha: string;
  fork: boolean;
  rs: RunState;
  github: Record<string, Value>;
  needsCtx: Record<string, Value>;
  baseCtx: (extra: Record<string, Value | undefined>, status?: ExprContext['status']) => ExprContext;
  lockHash: string;
  oldLockHash: string;
  decisions: Decisions;
  refName: string;
}

function runLeg(a: LegArgs): LegInfo {
  const { wf, job, leg, world } = a;
  const key = legKey(job, leg);
  const perms = tokenPermissions(wf, job, world, a.fork);
  const envName = job.environment ? safe(() => interpolate(job.environment!.name, a.baseCtx({ matrix: leg ?? {} })), job.environment.name) : undefined;
  const rule = envName ? world.environments?.[envName] : undefined;
  const noSecrets = a.fork;
  const secrets: Record<string, Value> = { GITHUB_TOKEN: TOKEN_VALUE };
  if (!noSecrets) {
    for (const s of world.secrets ?? []) secrets[s] = secretValue(s);
    for (const s of rule?.secrets ?? []) secrets[s] = secretValue(s);
  }
  const jobLog: LogLine[] = [{ text: 'Waiting for a runner to pick up this job...', kind: 'dim' }];
  const info: LegInfo = {
    run: { key, id: job.id, name: key, needs: job.needs, result: 'success', start: a.start, end: a.start, steps: [], outputs: {}, log: jobLog },
    saves: [],
    silent: new Set(),
    marks: new Map(),
    continueOnError: false,
  };
  if (leg) info.run.matrix = leg;
  if (envName) info.run.environment = envName;
  const strategy = { 'fail-fast': job.failFast, 'job-index': a.legIndex, 'job-total': a.legTotal, 'max-parallel': job.maxParallel ?? a.legTotal };
  const matrixCtx: Value = leg ? { ...leg } : {};
  let t = a.start + QUEUE;

  // Environment rules: deployment branches, then reviewers.
  if (envName && rule) {
    if (rule.branches?.length) {
      const isTag = a.github.ref_type === 'tag';
      const allowed = !isTag && matchList(rule.branches, a.refName);
      if (!allowed) {
        const what = isTag ? 'Tag' : 'Branch';
        const line = `${what} "${a.refName}" is not allowed to deploy to ${envName} due to environment protection rules.`;
        info.run.result = 'failure';
        info.run.why = { key: 'conveyor.why.envBranch', params: { env: envName, branch: a.refName } };
        info.run.log.push({ text: line, kind: 'err' });
        info.run.steps = skippedSteps(job, t);
        info.run.start = t;
        info.run.end = t;
        info.failedAt = t;
        return info;
      }
    }
    if (rule.reviewers?.length) {
      const decision = a.decisions[envName] ?? (rule.approve === true ? 'approve' : rule.approve === false ? 'reject' : undefined);
      info.approval = { at: t, reviewers: rule.reviewers };
      if (!decision) {
        info.run.result = 'waiting';
        info.run.start = t;
        info.run.end = t;
        info.run.steps = skippedSteps(job, t);
        info.run.log.push({ text: `Waiting for review: ${envName} needs approval to start deploying changes.`, kind: 'warn' });
        return info;
      }
      info.approval.decision = decision;
      info.approval.decidedAt = t + APPROVAL_WAIT;
      t += APPROVAL_WAIT;
      if (decision === 'reject') {
        info.run.result = 'failure';
        info.run.why = { key: 'conveyor.why.rejected', params: { env: envName } };
        info.run.steps = skippedSteps(job, t);
        info.run.start = t;
        info.run.end = t;
        info.failedAt = t;
        return info;
      }
    }
  }
  info.run.start = t;
  jobLog.push({ text: 'Job is about to start running on the runner: GitHub Actions 2 (hosted)', kind: 'dim' });
  for (const [name, svc] of Object.entries(job.services)) {
    jobLog.push({ text: `Starting ${name} service container (${svc.image})`, kind: 'dim' });
    t += 8;
  }
  t += SETUP;
  const limit = info.run.start + job.timeoutMinutes * 60;
  const js: JobState = { checkedOut: false, deps: false, npmCache: null, builder: false, qemu: false, loggedIn: {}, saves: [], layersSaved: false, env: {} };
  const stepsCtx: Record<string, Value> = {};
  let status: 'success' | 'failure' | 'cancelled' = 'success';
  let timedOut = false;
  const masks = Object.values(secrets).map(String).filter(Boolean);
  const mask = (s: string) => masks.reduce((acc, m) => acc.split(m).join('***'), s);

  for (const step of job.steps) {
    const title = safe(() => interpolate(stepTitle(step), a.baseCtx({ matrix: matrixCtx, needs: a.needsCtx, steps: stepsCtx, strategy, env: {} })), stepTitle(step));
    const sr: StepRun = { index: step.index, name: title, line: step.line, result: 'skipped', outcome: 'skipped', start: t, end: t, log: [], outputs: {} };
    if (step.uses) sr.uses = step.uses;
    if (step.run) sr.run = step.run;
    info.run.steps.push(sr);
    if (timedOut) {
      sr.result = sr.outcome = 'cancelled';
      info.silent.add(step.index);
      continue;
    }
    const envBase: Record<string, string> = {};
    const ctxFor = (env: Record<string, string>) =>
      a.baseCtx({ matrix: matrixCtx, needs: a.needsCtx, steps: stepsCtx, strategy, env, secrets, job: { status } }, status);
    for (const [k, v] of Object.entries({ ...wf.env, ...job.env })) envBase[k] = safe(() => interpolate(v, ctxFor(envBase)), v);
    Object.assign(envBase, js.env);
    const env = { ...envBase };
    for (const [k, v] of Object.entries(step.env)) env[k] = safe(() => interpolate(v, ctxFor(envBase)), v);
    const ctx = ctxFor(env);
    let go: boolean;
    try {
      go = evalIf(step.if, ctx);
    } catch {
      go = false;
    }
    if (!go) {
      stepsCtx[step.id ?? `__${step.index}`] = { outputs: {}, outcome: 'skipped', conclusion: 'skipped' };
      continue;
    }
    const withVals: Record<string, string> = {};
    for (const [k, v] of Object.entries(step.with)) withVals[k] = safe(() => interpolate(v, ctx), v);
    const sc: StepCtx = {
      world, trigger: a.trigger, eventName: a.eventName, repo: a.repo, sha: a.sha, perms, noSecrets, job, jobKey: key, legIndex: a.legIndex, env, with: withVals, rawWith: step.with, js, rs: a.rs, now: t, lockHash: a.lockHash, oldLockHash: a.oldLockHash,
    };
    if (leg) sc.leg = leg;
    const res = step.uses
      ? runAction(step.uses, sc)
      : runScript(safe(() => interpolate(step.run ?? '', ctx), step.run ?? ''), sc);
    const head: LogLine = { text: step.uses ? `Run ${step.uses}` : `Run ${(step.run ?? '').trim().split('\n')[0]}`, kind: 'cmd' };
    sr.log = [head, ...res.log].map((l) => ({ ...l, text: mask(l.text) }));
    if (res.marks?.length) info.marks.set(step.index, res.marks);
    if (res.note) sr.why = res.note;
    sr.start = t;
    let end = t + res.seconds;
    let ok = res.ok;
    let why = res.why;
    const stepCap = step.timeoutMinutes !== undefined ? step.timeoutMinutes * 60 : Infinity;
    if (t + Math.min(res.seconds, stepCap) > limit) {
      // The job ran out of time: GitHub cancels it.
      end = Math.max(t, limit);
      sr.result = sr.outcome = 'cancelled';
      sr.end = end;
      sr.log.push({ text: `The job running on runner GitHub Actions 2 has exceeded the maximum execution time of ${job.timeoutMinutes} minutes.`, kind: 'err' });
      sr.why = { key: 'conveyor.why.timeout', params: { minutes: job.timeoutMinutes } };
      info.run.why = sr.why;
      status = 'cancelled';
      timedOut = true;
      t = end;
      continue;
    }
    if (res.seconds > stepCap) {
      end = t + stepCap;
      ok = false;
      sr.log.push({ text: `Error: The action '${title}' has timed out after ${step.timeoutMinutes} minutes.`, kind: 'err' });
      why = { key: 'conveyor.why.stepTimeout', params: { minutes: step.timeoutMinutes! } };
    }
    sr.end = end;
    sr.outputs = res.outputs ?? {};
    if (ok) {
      sr.result = sr.outcome = 'success';
    } else {
      sr.outcome = 'failure';
      if (why) sr.why = why;
      const coe = typeof step.continueOnError === 'boolean' ? step.continueOnError : truthy(safe(() => evaluate(step.continueOnError.toString().replace(/^\$\{\{([\s\S]*)\}\}$/, '$1'), ctx), false));
      if (coe) sr.result = 'success';
      else {
        sr.result = 'failure';
        status = 'failure';
        if (info.failedAt === undefined) info.failedAt = end;
        if (why) info.run.why = why;
      }
    }
    stepsCtx[step.id ?? `__${step.index}`] = { outputs: sr.outputs, outcome: sr.outcome, conclusion: sr.result };
    t = end;
  }
  // Post-job: caches are saved only when the job succeeded.
  if (status === 'success') {
    for (const k of js.saves) {
      info.saves.push({ key: k, t });
      jobLog.push({ text: `Cache saved with key: ${k}`, kind: 'ok' });
      t += 3;
    }
    if (js.layersSaved) info.layers = true;
  }
  t += 1; // "Complete job"
  info.run.end = t;
  info.run.result = status === 'success' ? 'success' : status;
  const outCtx = a.baseCtx({ matrix: matrixCtx, needs: a.needsCtx, steps: stepsCtx, strategy, env: {} });
  for (const [k, v] of Object.entries(job.outputs)) info.run.outputs[k] = safe(() => interpolate(v, outCtx), '');
  const coeJob = typeof job.continueOnError === 'boolean' ? job.continueOnError : truthy(safe(() => evaluate(String(job.continueOnError).replace(/^\$\{\{([\s\S]*)\}\}$/, '$1'), outCtx), false));
  info.continueOnError = coeJob;
  if (job.uses) {
    // A reusable workflow: one step that calls it.
    info.run.steps = [{ index: 0, name: `Call ${job.uses}`, uses: job.uses, line: job.line, result: 'success', outcome: 'success', start: info.run.start, end: info.run.start + 30, log: [{ text: `Run ${parseUses(job.uses).name}`, kind: 'cmd' }], outputs: {} }];
    info.run.end = info.run.start + 31;
  }
  return info;
}

/** fail-fast: stop a leg at time tf. */
function cutLeg(l: LegInfo, tf: number, failingKey: string, rs: RunState) {
  for (const s of l.run.steps) {
    if (s.result === 'skipped' && s.start >= tf) continue;
    if (s.start >= tf) {
      s.result = s.outcome = 'cancelled';
      s.start = s.end = tf;
      l.silent.add(s.index);
    } else if (s.end > tf) {
      s.result = s.outcome = 'cancelled';
      s.end = tf;
      s.log.push({ text: 'Error: The operation was canceled.', kind: 'err' });
      l.marks.delete(s.index);
    }
  }
  for (const [name, art] of rs.artifacts) if (art.job === l.run.key && art.t > tf) rs.artifacts.delete(name);
  l.saves = [];
  l.layers = false;
  l.run.result = 'cancelled';
  l.run.end = tf;
  l.run.why = { key: 'conveyor.why.failFast', params: { leg: failingKey } };
}

function legEvents(l: LegInfo): RunEvent[] {
  const out: RunEvent[] = [];
  const job = l.run.key;
  if (l.approval) {
    out.push({ type: 'approvalWaiting', t: l.approval.at, job, environment: l.run.environment ?? '', reviewers: l.approval.reviewers });
    if (l.approval.decision === 'approve') out.push({ type: 'approved', t: l.approval.decidedAt!, job, environment: l.run.environment ?? '' });
    if (l.approval.decision === 'reject') out.push({ type: 'rejected', t: l.approval.decidedAt!, job, environment: l.run.environment ?? '' });
  }
  if (l.run.result === 'waiting') return out;
  out.push({ type: 'jobStarted', t: l.run.start, job });
  for (const s of l.run.steps) {
    if (l.silent.has(s.index)) continue;
    const base = { job, step: s.index, name: s.name };
    if (s.result === 'skipped' && s.outcome === 'skipped') {
      out.push({ type: 'stepSkipped', t: s.start, ...base });
      continue;
    }
    out.push({ type: 'stepStarted', t: s.start, ...base });
    for (const m of l.marks.get(s.index) ?? []) {
      if (m.type === 'cacheHit') out.push({ type: 'cacheHit', t: s.start, job, step: s.index, key: m.key, ...(m.partial ? { partial: true } : {}) });
      if (m.type === 'cacheMiss') out.push({ type: 'cacheMiss', t: s.start, job, step: s.index, key: m.key });
      if (m.type === 'artifactDownloaded') out.push({ type: 'artifactDownloaded', t: s.end, job, name: m.key });
      if (m.type === 'artifactUploaded') out.push({ type: 'artifactUploaded', t: s.end, job, name: m.key });
    }
    if (s.result === 'cancelled') out.push({ type: 'stepCancelled', t: s.end, ...base });
    else if (s.outcome === 'failure') out.push({ type: 'stepFailed', t: s.end, ...base, ...(s.why ? { why: s.why } : {}), ...(s.result === 'success' ? { continued: true } : {}) });
    else out.push({ type: 'stepPassed', t: s.end, ...base });
  }
  for (const s of l.saves) out.push({ type: 'cacheSaved', t: s.t, job, key: s.key });
  out.push({ type: 'jobFinished', t: l.run.end, job, result: l.run.result });
  return out;
}

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}
