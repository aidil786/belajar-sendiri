// Exam practice (KCNA mock, CKAD task sets): seeded picks, scores per domain, and a small store of
// attempts in its own localStorage key. Pure helpers, unit-tested in mockExam.test.ts.
// The main progress store (fahamlah:v1) is never touched.

/** Its own key and version, so the main progress data never changes shape. */
export const EXAM_STORE_KEY = 'fahamlah:exams:v1';
export const EXAM_STORE_VERSION = 1;
/** Old attempts beyond this many per exam are dropped (newest kept). */
export const MAX_ATTEMPTS = 20;

export type ExamId = 'kcna' | 'ckad';
export type Mode = 'learn' | 'exam';

/** A small, fast, seeded random number generator (mulberry32). Same seed, same numbers. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A fresh seed for a new attempt (any 32-bit number). */
export function newSeed(): number {
  try {
    const buf = new Uint32Array(1);
    globalThis.crypto.getRandomValues(buf);
    return buf[0]! >>> 0;
  } catch {
    return Math.floor(Math.random() * 4294967296) >>> 0;
  }
}

/** Fisher–Yates with a seeded generator. Returns a new array. */
export function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * How many items each domain gets in a set of `size`, by weight (largest remainder), never more
 * than a domain has. Spare places go to the domains that still have items, biggest weight first.
 */
export function quotas(domains: readonly { id: string; weight: number }[], available: Record<string, number>, size: number): Record<string, number> {
  const total = domains.reduce((n, d) => n + d.weight, 0) || 1;
  const raw = domains.map((d) => ({ id: d.id, exact: (size * d.weight) / total }));
  const out: Record<string, number> = Object.fromEntries(raw.map((r) => [r.id, Math.min(Math.floor(r.exact), available[r.id] ?? 0)]));
  let left = size - Object.values(out).reduce((n, x) => n + x, 0);
  // Largest remainder first, then by weight; skip full domains. Repeat until placed or nothing is left.
  const order = [...raw].sort((a, b) => b.exact - Math.floor(b.exact) - (a.exact - Math.floor(a.exact)) || b.exact - a.exact);
  while (left > 0) {
    let placed = false;
    for (const r of order) {
      if (left <= 0) break;
      if ((out[r.id] ?? 0) < (available[r.id] ?? 0)) {
        out[r.id] = (out[r.id] ?? 0) + 1;
        left--;
        placed = true;
      }
    }
    if (!placed) break;
  }
  return out;
}

/**
 * A practice set: `size` items picked by domain weight, in a seeded random order. With a bank
 * no bigger than `size`, every item is used (shuffled).
 */
export function pickSet<T extends { id: string; domain: string }>(bank: readonly T[], size: number, seed: number, domains: readonly { id: string; weight: number }[]): T[] {
  const random = rng(seed);
  if (bank.length <= size) return shuffle(bank, random);
  const byDomain = new Map<string, T[]>();
  for (const item of bank) byDomain.set(item.domain, [...(byDomain.get(item.domain) ?? []), item]);
  const want = quotas(domains, Object.fromEntries([...byDomain].map(([k, v]) => [k, v.length])), size);
  const picked = domains.flatMap((d) => shuffle(byDomain.get(d.id) ?? [], random).slice(0, want[d.id] ?? 0));
  return shuffle(picked, random);
}

/** The order the 4 options show in for one question in one attempt (seeded, so a reload keeps it). */
export function optionOrder(seed: number, questionId: string, count = 4): number[] {
  let h = seed >>> 0;
  for (let i = 0; i < questionId.length; i++) h = Math.imul(h ^ questionId.charCodeAt(i), 2654435761) >>> 0;
  return shuffle(
    Array.from({ length: count }, (_, i) => i),
    rng(h),
  );
}

export interface DomainScore {
  domain: string;
  right: number;
  total: number;
  /** 0–100, rounded. */
  percent: number;
}

/** Score overall and per domain (in the domains' order; domains with no items are left out). */
export function scoreByDomain(items: readonly { domain: string; right: boolean }[], domains: readonly { id: string }[]): { right: number; total: number; percent: number; domains: DomainScore[] } {
  const pct = (r: number, t: number) => (t ? Math.round((100 * r) / t) : 0);
  const per = domains
    .map((d) => {
      const mine = items.filter((x) => x.domain === d.id);
      const right = mine.filter((x) => x.right).length;
      return { domain: d.id, right, total: mine.length, percent: pct(right, mine.length) };
    })
    .filter((d) => d.total > 0);
  const right = items.filter((x) => x.right).length;
  return { right, total: items.length, percent: pct(right, items.length), domains: per };
}

/**
 * The suggested time for a set: the real exam's minutes, scaled to the set size and rounded up
 * (60 questions in 90 minutes → 12 questions in 18 minutes). Nothing ever stops at this time.
 */
export function targetMinutes(count: number, fullCount: number, fullMinutes: number): number {
  if (count >= fullCount || fullCount <= 0) return fullMinutes;
  return Math.max(1, Math.ceil((fullMinutes * count) / fullCount));
}

// ---------------------------------------------------------------- the attempts store

/** A finished attempt (only numbers and ids: no answers text). */
export interface Attempt {
  exam: ExamId;
  /** The local day it was finished, YYYY-MM-DD. */
  day: string;
  mode: Mode;
  right: number;
  total: number;
  domains: { domain: string; right: number; total: number }[];
}

/** An unfinished set, so a reload (or tomorrow) carries on where the learner stopped. */
export interface InProgress {
  seed: number;
  mode: Mode;
  /** Item ids in the order shown. */
  ids: string[];
  /** Where the learner is (0-based). */
  at: number;
  /**
   * KCNA: the first answer per question id (the option index in the data, or -1 = left blank).
   * CKAD: 1 = solved, 0 = skipped.
   */
  answers: Record<string, number>;
  /** When the set started (ms since 1970), for the exam timer. */
  started: number;
}

export interface ExamStore {
  v: number;
  attempts: Attempt[];
  current: Partial<Record<ExamId, InProgress>>;
}

const EXAMS: readonly ExamId[] = ['kcna', 'ckad'];
const ID = /^[a-z0-9-]{1,80}$/;
const isInt = (x: unknown, min = 0): x is number => typeof x === 'number' && Number.isInteger(x) && x >= min;

function cleanAttempt(raw: unknown): Attempt | null {
  if (!raw || typeof raw !== 'object') return null;
  const a = raw as Record<string, unknown>;
  if (!EXAMS.includes(a.exam as ExamId) || (a.mode !== 'learn' && a.mode !== 'exam')) return null;
  if (typeof a.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(a.day) || !isInt(a.right) || !isInt(a.total, 1) || a.right > a.total) return null;
  const domains = Array.isArray(a.domains)
    ? a.domains.flatMap((d) => {
        const x = d as Record<string, unknown>;
        return x && typeof x.domain === 'string' && ID.test(x.domain) && isInt(x.right) && isInt(x.total, 1) && x.right <= x.total ? [{ domain: x.domain, right: x.right, total: x.total }] : [];
      })
    : [];
  return { exam: a.exam as ExamId, day: a.day, mode: a.mode, right: a.right, total: a.total, domains };
}

function cleanInProgress(raw: unknown): InProgress | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  if (!isInt(c.seed) || (c.mode !== 'learn' && c.mode !== 'exam') || !Array.isArray(c.ids) || !isInt(c.at) || !isInt(c.started)) return null;
  const ids = c.ids.filter((id): id is string => typeof id === 'string' && ID.test(id)).slice(0, 200);
  if (!ids.length || ids.length !== c.ids.length) return null;
  const answers: Record<string, number> = {};
  if (c.answers && typeof c.answers === 'object' && !Array.isArray(c.answers)) {
    for (const [id, v] of Object.entries(c.answers as Record<string, unknown>)) if (ids.includes(id) && isInt(v, -1) && v <= 3) answers[id] = v;
  }
  return { seed: c.seed, mode: c.mode, ids, at: Math.min(c.at, ids.length), answers, started: c.started };
}

/** Keep only well-formed data (it may be old, from a newer version, or hand-edited). */
export function cleanExamStore(raw: unknown): ExamStore {
  const out: ExamStore = { v: EXAM_STORE_VERSION, attempts: [], current: {} };
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  if (Array.isArray(r.attempts)) out.attempts = r.attempts.flatMap((a) => cleanAttempt(a) ?? []);
  if (r.current && typeof r.current === 'object') {
    for (const exam of EXAMS) {
      const c = cleanInProgress((r.current as Record<string, unknown>)[exam]);
      if (c) out.current[exam] = c;
    }
  }
  return out;
}

export function loadExams(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): ExamStore {
  try {
    const text = storage?.getItem(EXAM_STORE_KEY);
    return cleanExamStore(text ? JSON.parse(text) : null);
  } catch {
    return cleanExamStore(null);
  }
}

function save(data: ExamStore, storage: Pick<Storage, 'setItem'> | undefined): boolean {
  try {
    storage?.setItem(EXAM_STORE_KEY, JSON.stringify(data));
    return Boolean(storage);
  } catch {
    return false;
  }
}

/** Save (or clear, with null) the unfinished set. Returns false when the browser blocks saving. */
export function saveInProgress(exam: ExamId, current: InProgress | null, storage: Pick<Storage, 'getItem' | 'setItem'> | undefined = globalThis.localStorage): boolean {
  const data = loadExams(storage);
  if (current) data.current[exam] = current;
  else delete data.current[exam];
  return save(data, storage);
}

/** Save a finished attempt and clear the unfinished set. Keeps the newest MAX_ATTEMPTS per exam. */
export function saveAttempt(attempt: Attempt, storage: Pick<Storage, 'getItem' | 'setItem'> | undefined = globalThis.localStorage): boolean {
  const data = loadExams(storage);
  const mine = [...data.attempts.filter((a) => a.exam === attempt.exam), attempt].slice(-MAX_ATTEMPTS);
  data.attempts = [...data.attempts.filter((a) => a.exam !== attempt.exam), ...mine];
  delete data.current[attempt.exam];
  return save(data, storage);
}
