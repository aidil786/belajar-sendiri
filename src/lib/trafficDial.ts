// Pure logic for the TrafficDial interactive: send a share of users to the new
// version, watch both error rates minute by minute, roll back. Deterministic: no
// randomness, so every learner (and every test) sees the same numbers.

export type DialMode = 'canary' | 'bluegreen';

export type DialTask = { type: 'rollback'; maxHurt?: number } | { type: 'rollout' } | { type: 'explore' };

export interface DialConfig {
  mode: DialMode;
  /** Share of requests the new version fails (0.08 = 8%). */
  newErrorRate: number;
  oldErrorRate: number;
  /** Canary steps, percent of traffic on the new version. */
  steps: number[];
  /** Alarm line for the error rate (0.02 = 2%). */
  threshold: number;
  usersPerMinute: number;
  /** Minutes that play after each move. */
  minutesPerMove: number;
  /** Users who may hit the bug before it counts as too late. */
  maxHurt: number;
}

export interface Minute {
  /** 1-based minute. */
  n: number;
  /** Percent on the new version. */
  weight: number;
  oldReq: number;
  newReq: number;
  oldErr: number;
  newErr: number;
}

export interface DialState {
  weight: number;
  minutes: Minute[];
  /** Minutes still to play after the last move. */
  queued: number;
  /** Users who hit an error on the new version. */
  hurt: number;
  /** The new version took real traffic at least once. */
  wentLive: boolean;
  rolledBack: boolean;
  /** Blue/green: the private smoke test ran (requests, errors). */
  smoke?: { requests: number; errors: number };
  /** Blue/green: kept the old version after a bad smoke test. */
  keptOld: boolean;
}

export interface DialInput {
  mode?: DialMode;
  newErrorRate?: number;
  oldErrorRate?: number;
  steps?: number[];
  threshold?: number;
  usersPerMinute?: number;
  task?: DialTask;
}

export function dialConfig(p: DialInput): DialConfig {
  const mode = p.mode ?? 'canary';
  const steps = (p.steps?.length ? p.steps : mode === 'bluegreen' ? [100] : [5, 25, 50, 100]).filter((s) => s > 0 && s <= 100);
  return {
    mode,
    newErrorRate: clamp(p.newErrorRate ?? 0.08, 0, 1),
    oldErrorRate: clamp(p.oldErrorRate ?? 0.005, 0, 1),
    steps: mode === 'bluegreen' ? [100] : [...new Set(steps)].sort((a, b) => a - b),
    threshold: p.threshold ?? 0.02,
    usersPerMinute: p.usersPerMinute ?? 1000,
    minutesPerMove: mode === 'bluegreen' ? 6 : 4,
    maxHurt: p.task?.type === 'rollback' ? (p.task.maxHurt ?? 150) : 150,
  };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export function startDial(): DialState {
  return { weight: 0, minutes: [], queued: 0, hurt: 0, wentLive: false, rolledBack: false, keptOld: false };
}

// A small, fixed wobble so the lines look alive but never random.
const WOBBLE = [1, 1.15, 0.9, 1.05, 0.95, 1.1, 0.85];

export function errorsFor(req: number, rate: number, n: number): number {
  return Math.round(req * rate * WOBBLE[n % WOBBLE.length]!);
}

/** Set the share of traffic on the new version; minutes are queued to play. */
export function setWeight(s: DialState, cfg: DialConfig, weight: number): DialState {
  const w = clamp(Math.round(weight), 0, 100);
  return { ...s, weight: w, queued: cfg.minutesPerMove, wentLive: s.wentLive || w > 0, rolledBack: s.rolledBack && w === 0 };
}

/** Play one queued minute. */
export function playMinute(s: DialState, cfg: DialConfig): DialState {
  if (s.queued <= 0) return s;
  const n = s.minutes.length + 1;
  const newReq = Math.round((cfg.usersPerMinute * s.weight) / 100);
  const oldReq = cfg.usersPerMinute - newReq;
  const m: Minute = { n, weight: s.weight, oldReq, newReq, oldErr: errorsFor(oldReq, cfg.oldErrorRate, n), newErr: errorsFor(newReq, cfg.newErrorRate, n + 3) };
  return { ...s, minutes: [...s.minutes, m], queued: s.queued - 1, hurt: s.hurt + m.newErr };
}

/** Play every queued minute at once (calm mode, tests). */
export function playAll(s: DialState, cfg: DialConfig): DialState {
  let x = s;
  while (x.queued > 0) x = playMinute(x, cfg);
  return x;
}

/** Roll back: all traffic to the old version, two calm minutes queued. */
export function rollback(s: DialState, cfg: DialConfig): DialState {
  return { ...s, weight: 0, queued: Math.min(2, cfg.minutesPerMove), rolledBack: s.wentLive };
}

/** Blue/green: test the new version privately (no real users). */
export function smokeTest(s: DialState, cfg: DialConfig): DialState {
  const requests = 20;
  return { ...s, smoke: { requests, errors: Math.max(cfg.newErrorRate > 0.01 ? 1 : 0, Math.round(requests * cfg.newErrorRate)) } };
}

export function keepOld(s: DialState): DialState {
  return { ...s, keptOld: true, queued: 0 };
}

export const rate = (err: number, req: number) => (req > 0 ? err / req : 0);

/** First minute where the new version's error rate crossed the alarm line. */
export function spikeAt(s: DialState, cfg: DialConfig): number | null {
  const m = s.minutes.find((x) => x.newReq > 0 && rate(x.newErr, x.newReq) > cfg.threshold);
  return m ? m.n : null;
}

export type DialVerdict = 'playing' | 'win' | 'tooLate' | 'healthyRollback' | 'none';

/** How the task stands right now. */
export function dialVerdict(s: DialState, cfg: DialConfig, task: DialTask): DialVerdict {
  if (task.type === 'explore') return 'none';
  if (task.type === 'rollback') {
    if (s.hurt > cfg.maxHurt) return 'tooLate';
    if (s.keptOld && s.smoke && s.smoke.errors > 0) return 'win';
    if (s.rolledBack) return 'win';
    return 'playing';
  }
  // rollout: all users on the new version, no spike on the way.
  if (s.rolledBack && spikeAt(s, cfg) === null) return 'healthyRollback';
  if (s.weight === 100 && s.queued === 0 && spikeAt(s, cfg) === null) return 'win';
  if (spikeAt(s, cfg) !== null && s.hurt > cfg.maxHurt) return 'tooLate';
  return 'playing';
}

/** The next canary step above the current weight (null at 100%). */
export function nextStep(s: DialState, cfg: DialConfig): number | null {
  return cfg.steps.find((x) => x > s.weight) ?? null;
}
