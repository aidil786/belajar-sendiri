import { afterEach, describe, expect, it } from 'vitest';
import { cleanNightShift, clockText, isoWeek, loadNightShift, markDrillDone, NIGHT_SHIFT_KEY, weeklyIndex, weeklyPick } from './nightShift';

const day = (s: string) => {
  const [y, m, d] = s.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d, 12);
};

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    data,
  };
}

describe('ISO week', () => {
  it('matches ISO 8601 at year edges', () => {
    expect(isoWeek(day('2026-01-01'))).toEqual({ year: 2026, week: 1 }); // a Thursday
    expect(isoWeek(day('2021-01-03'))).toEqual({ year: 2020, week: 53 }); // Sunday of 2020's week 53
    expect(isoWeek(day('2024-12-30'))).toEqual({ year: 2025, week: 1 }); // Monday, already 2025 week 1
    expect(isoWeek(day('2026-12-31'))).toEqual({ year: 2026, week: 53 });
    expect(isoWeek(day('2027-01-04'))).toEqual({ year: 2027, week: 1 });
    expect(isoWeek(day('2026-10-31'))).toEqual({ year: 2026, week: 44 });
  });

  describe('in other time zones and across daylight saving', () => {
    const original = process.env.TZ;
    afterEach(() => {
      process.env.TZ = original;
    });
    it('a local date gives the same week anywhere', () => {
      for (const tz of ['Asia/Kuala_Lumpur', 'America/Los_Angeles', 'Europe/Berlin', 'UTC']) {
        process.env.TZ = tz;
        expect(isoWeek(day('2026-03-29'))).toEqual({ year: 2026, week: 13 }); // EU clocks change
        expect(isoWeek(day('2026-11-01'))).toEqual({ year: 2026, week: 44 }); // US clocks change, a Sunday
        expect(isoWeek(day('2026-11-02'))).toEqual({ year: 2026, week: 45 });
      }
    });
  });
});

describe("this week's drill", () => {
  it('is the same all week, Monday to Sunday', () => {
    const monday = weeklyIndex(day('2026-10-26'), 11);
    for (const d of ['2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01']) expect(weeklyIndex(day(d), 11)).toBe(monday);
  });

  it('changes every week, stays in range and visits every drill', () => {
    const seen = new Set<number>();
    let last = -1;
    for (let i = 0; i < 60; i++) {
      const d = day('2026-01-05');
      d.setDate(d.getDate() + i * 7);
      const n = weeklyIndex(d, 11);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(11);
      expect(n).not.toBe(last);
      last = n;
      seen.add(n);
    }
    expect(seen.size).toBe(11);
    expect(weeklyIndex(day('2026-10-31'), 0)).toBe(0);
  });

  it('rotates through the levels (★, ★★, ★★★), and visits every drill of each level', () => {
    const levels = [1, 2, 1, 3, 2, 1, 2, 3, 1];
    const monday = weeklyPick(day('2026-10-26'), levels);
    for (const d of ['2026-10-28', '2026-11-01']) expect(weeklyPick(day(d), levels)).toBe(monday);
    const seen = new Set<number>();
    const levelRun: number[] = [];
    for (let i = 0; i < 36; i++) {
      const d = day('2026-01-05');
      d.setDate(d.getDate() + i * 7);
      const n = weeklyPick(d, levels);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(levels.length);
      seen.add(n);
      levelRun.push(levels[n]!);
    }
    expect(seen.size).toBe(levels.length);
    // Never the same level two weeks in a row (within one year).
    for (let i = 1; i < 20; i++) expect(levelRun[i], `week ${i}`).not.toBe(levelRun[i - 1]);
    expect(weeklyPick(day('2026-10-31'), [])).toBe(0);
    expect(weeklyPick(day('2026-10-31'), [2, 2])).toBeLessThan(2);
  });
});

describe('the done list (its own localStorage key)', () => {
  it('saves the first day a drill was fixed, with a schema version', () => {
    const s = memoryStorage();
    expect(markDrillDone('wrong-hatch', '2026-10-31', s)).toBe(true);
    expect(markDrillDone('wrong-hatch', '2026-11-02', s)).toBe(true);
    expect(JSON.parse(s.data.get(NIGHT_SHIFT_KEY)!)).toEqual({ v: 1, done: { 'wrong-hatch': '2026-10-31' } });
    expect(loadNightShift(s).done).toEqual({ 'wrong-hatch': '2026-10-31' });
    expect(NIGHT_SHIFT_KEY).not.toBe('fahamlah:v1');
  });

  it('survives broken, odd or blocked storage', () => {
    expect(loadNightShift(memoryStorage({ [NIGHT_SHIFT_KEY]: '{not json' })).done).toEqual({});
    expect(cleanNightShift({ v: 9, done: { ok: '2026-10-31', 'Bad Id': '2026-10-31', late: 'tomorrow', arr: [] } }).done).toEqual({ ok: '2026-10-31' });
    expect(cleanNightShift({ done: ['x'] }).done).toEqual({});
    const blocked = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadNightShift(blocked).done).toEqual({});
    expect(markDrillDone('wrong-hatch', '2026-10-31', blocked)).toBe(false);
  });
});

describe('exam timer text', () => {
  it('counts up in m:ss, or whole minutes in calm mode', () => {
    expect(clockText(0)).toBe('0:00');
    expect(clockText(65.9)).toBe('1:05');
    expect(clockText(600)).toBe('10:00');
    expect(clockText(-3)).toBe('0:00');
    expect(clockText(299, true)).toBe('4');
    expect(clockText(300, true)).toBe('5');
  });
});
