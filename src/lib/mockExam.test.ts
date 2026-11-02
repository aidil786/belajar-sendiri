import { describe, expect, it } from 'vitest';
import { CKAD_DOMAINS, CKAD_SET_SIZE, ckadTasks } from '~/content/exams/ckad';
import { KCNA_DOMAINS, KCNA_MOCK_SIZE, kcnaQuestions } from '~/content/exams/kcna';
import {
  cleanExamStore,
  EXAM_STORE_KEY,
  EXAM_STORE_VERSION,
  loadExams,
  MAX_ATTEMPTS,
  optionOrder,
  pickSet,
  quotas,
  rng,
  saveAttempt,
  saveInProgress,
  scoreByDomain,
  shuffle,
  targetMinutes,
  type Attempt,
} from './mockExam';

function memory(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => {
      data[k] = v;
    },
  };
}

const DOMAINS = [
  { id: 'a', weight: 44 },
  { id: 'b', weight: 28 },
  { id: 'c', weight: 16 },
  { id: 'd', weight: 12 },
];
const bank = (counts: Record<string, number>) => Object.entries(counts).flatMap(([domain, n]) => Array.from({ length: n }, (_, i) => ({ id: `${domain}-${i}`, domain })));

describe('seeded picks', () => {
  it('the same seed gives the same numbers; different seeds differ', () => {
    const a = rng(42);
    const b = rng(42);
    const xs = Array.from({ length: 5 }, () => a());
    expect(Array.from({ length: 5 }, () => b())).toEqual(xs);
    for (const x of xs) expect(x >= 0 && x < 1).toBe(true);
    expect(rng(43)()).not.toBe(xs[0]);
  });

  it('shuffle keeps every item and does not change the input', () => {
    const items = [1, 2, 3, 4, 5, 6];
    const out = shuffle(items, rng(7));
    expect([...out].sort()).toEqual(items);
    expect(items).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('a small bank: every item, in a seeded order', () => {
    const small = bank({ a: 5, b: 3, c: 2, d: 2 });
    const set = pickSet(small, 60, 1, DOMAINS);
    expect(set).toHaveLength(small.length);
    expect(new Set(set.map((q) => q.id))).toEqual(new Set(small.map((q) => q.id)));
    expect(pickSet(small, 60, 1, DOMAINS).map((q) => q.id)).toEqual(set.map((q) => q.id));
    expect(pickSet(small, 60, 2, DOMAINS).map((q) => q.id)).not.toEqual(set.map((q) => q.id));
    expect(pickSet(ckadTasks, CKAD_SET_SIZE, 9, CKAD_DOMAINS)).toHaveLength(Math.min(CKAD_SET_SIZE, ckadTasks.length));
  });

  it('the real KCNA bank: a mock is 60 questions in the official shares, seeded, no repeats', () => {
    expect(kcnaQuestions.length).toBeGreaterThan(KCNA_MOCK_SIZE);
    const set = pickSet(kcnaQuestions, KCNA_MOCK_SIZE, 1, KCNA_DOMAINS);
    expect(set).toHaveLength(KCNA_MOCK_SIZE);
    expect(new Set(set.map((q) => q.id)).size).toBe(KCNA_MOCK_SIZE);
    const count = (d: string) => set.filter((q) => q.domain === d).length;
    expect(KCNA_DOMAINS.map((d) => count(d.id))).toEqual([26, 17, 10, 7]);
    expect(pickSet(kcnaQuestions, KCNA_MOCK_SIZE, 1, KCNA_DOMAINS).map((q) => q.id)).toEqual(set.map((q) => q.id));
    expect(pickSet(kcnaQuestions, KCNA_MOCK_SIZE, 2, KCNA_DOMAINS).map((q) => q.id)).not.toEqual(set.map((q) => q.id));
  });

  it('the CKAD bank (bigger than a set): 15 tasks in the official shares (20/20/15/25/20 → 3/3/2/4/3)', () => {
    expect(ckadTasks.length).toBeGreaterThan(CKAD_SET_SIZE);
    for (const seed of [9, 10, 11]) {
      const set = pickSet(ckadTasks, CKAD_SET_SIZE, seed, CKAD_DOMAINS);
      expect(set).toHaveLength(CKAD_SET_SIZE);
      expect(new Set(set.map((x) => x.id)).size).toBe(CKAD_SET_SIZE);
      expect(CKAD_DOMAINS.map((d) => set.filter((x) => x.domain === d.id).length)).toEqual([3, 3, 2, 4, 3]);
    }
  });

  it('a big bank: 60 questions in the official shares (44/28/16/12 → 26/17/10/7), no repeats', () => {
    const big = bank({ a: 80, b: 50, c: 30, d: 25 });
    const set = pickSet(big, 60, 123, DOMAINS);
    expect(set).toHaveLength(60);
    expect(new Set(set.map((x) => x.id)).size).toBe(60);
    const count = (d: string) => set.filter((x) => x.domain === d).length;
    expect([count('a'), count('b'), count('c'), count('d')]).toEqual([26, 17, 10, 7]);
  });

  it('quotas: a domain with too few items gives its places to the others', () => {
    expect(quotas(DOMAINS, { a: 80, b: 50, c: 30, d: 25 }, 60)).toEqual({ a: 26, b: 17, c: 10, d: 7 });
    const q = quotas(DOMAINS, { a: 80, b: 50, c: 30, d: 2 }, 60);
    expect(q.d).toBe(2);
    expect(Object.values(q).reduce((n, x) => n + x, 0)).toBe(60);
    // Fewer items than places: everything is used, nothing invented.
    expect(quotas(DOMAINS, { a: 1, b: 1, c: 0, d: 0 }, 60)).toEqual({ a: 1, b: 1, c: 0, d: 0 });
  });

  it('option order: seeded per attempt and question; always a full permutation', () => {
    const o = optionOrder(5, 'kcna-fundamentals-001');
    expect([...o].sort()).toEqual([0, 1, 2, 3]);
    expect(optionOrder(5, 'kcna-fundamentals-001')).toEqual(o);
    const many = new Set(Array.from({ length: 30 }, (_, i) => optionOrder(i, 'kcna-fundamentals-001').join('')));
    expect(many.size).toBeGreaterThan(3);
  });
});

describe('scores and time', () => {
  it('scores overall and per domain, in the domains order, skipping empty domains', () => {
    const s = scoreByDomain(
      [
        { domain: 'b', right: true },
        { domain: 'a', right: false },
        { domain: 'a', right: true },
        { domain: 'a', right: true },
      ],
      DOMAINS,
    );
    expect(s).toEqual({
      right: 3,
      total: 4,
      percent: 75,
      domains: [
        { domain: 'a', right: 2, total: 3, percent: 67 },
        { domain: 'b', right: 1, total: 1, percent: 100 },
      ],
    });
    expect(scoreByDomain([], DOMAINS)).toEqual({ right: 0, total: 0, percent: 0, domains: [] });
  });

  it('the suggested time scales with the set (90 min for 60 questions; 120 min for 15 tasks)', () => {
    expect(targetMinutes(60, 60, 90)).toBe(90);
    expect(targetMinutes(12, 60, 90)).toBe(18);
    expect(targetMinutes(5, 15, 120)).toBe(40);
    expect(targetMinutes(1, 60, 90)).toBe(2);
    expect(targetMinutes(80, 60, 90)).toBe(90);
  });
});

describe('the attempts store (its own key)', () => {
  const attempt = (right: number, exam: Attempt['exam'] = 'kcna'): Attempt => ({ exam, day: '2026-11-01', mode: 'learn', right, total: 12, domains: [{ domain: 'fundamentals', right: Math.min(right, 3), total: 3 }] });

  it('saves attempts and the unfinished set under fahamlah:exams:v1, schema-versioned', () => {
    const s = memory();
    expect(saveInProgress('kcna', { seed: 9, mode: 'exam', ids: ['kcna-fundamentals-001'], at: 0, answers: { 'kcna-fundamentals-001': 2 }, started: 1000 }, s)).toBe(true);
    expect(loadExams(s).current.kcna?.answers).toEqual({ 'kcna-fundamentals-001': 2 });
    expect(saveAttempt(attempt(9), s)).toBe(true);
    const data = JSON.parse(s.data[EXAM_STORE_KEY]!);
    expect(data.v).toBe(EXAM_STORE_VERSION);
    expect(data.attempts).toHaveLength(1);
    // Finishing clears the unfinished set of that exam only.
    expect(data.current.kcna).toBeUndefined();
    expect(Object.keys(s.data)).toEqual([EXAM_STORE_KEY]);
  });

  it(`keeps the newest ${MAX_ATTEMPTS} attempts per exam`, () => {
    const s = memory();
    saveAttempt(attempt(1, 'ckad'), s);
    for (let i = 0; i < MAX_ATTEMPTS + 5; i++) saveAttempt(attempt(i % 12), s);
    const all = loadExams(s).attempts;
    expect(all.filter((a) => a.exam === 'kcna')).toHaveLength(MAX_ATTEMPTS);
    expect(all.filter((a) => a.exam === 'ckad')).toHaveLength(1);
  });

  it('blocked or broken storage never throws', () => {
    const blocked = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadExams(blocked)).toEqual({ v: 1, attempts: [], current: {} });
    expect(saveAttempt(attempt(3), blocked)).toBe(false);
    expect(loadExams(memory({ [EXAM_STORE_KEY]: '{not json' }))).toEqual({ v: 1, attempts: [], current: {} });
    expect(saveAttempt(attempt(3), undefined)).toBe(false);
  });

  it('drops malformed data (old, hand-edited or from a newer version)', () => {
    const clean = cleanExamStore({
      v: 7,
      attempts: [attempt(3), { exam: 'cka', day: '2026-11-01', mode: 'learn', right: 1, total: 2 }, { ...attempt(3), right: 20 }, { ...attempt(3), day: 'today' }],
      current: { kcna: { seed: 1, mode: 'learn', ids: ['ok', 'Bad Id'], at: 0, answers: {}, started: 1 }, ckad: { seed: 2, mode: 'exam', ids: ['ckad-a'], at: 9, answers: { 'ckad-a': 1, other: 1, 'ckad-b': 'x' }, started: 5 } },
    });
    expect(clean.attempts).toHaveLength(1);
    expect(clean.current.kcna).toBeUndefined();
    expect(clean.current.ckad).toEqual({ seed: 2, mode: 'exam', ids: ['ckad-a'], at: 1, answers: { 'ckad-a': 1 }, started: 5 });
  });
});
