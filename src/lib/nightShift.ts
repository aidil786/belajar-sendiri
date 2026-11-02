// Night shift drills: this week's pick, the done list and the exam timer text.
// Pure helpers (plus a small, separate localStorage key). The main progress schema is untouched.

/** Its own key, so the main progress data never changes shape. Version inside the data. */
export const NIGHT_SHIFT_KEY = 'fahamlah:nightshift:v1';
export const NIGHT_SHIFT_VERSION = 1;

export interface NightShiftData {
  v: number;
  /** drill id → the day (YYYY-MM-DD) it was first fixed. */
  done: Record<string, string>;
}

/** ISO 8601 week of a local date: weeks start on Monday; week 1 holds the year's first Thursday. */
export function isoWeek(d: Date): { year: number; week: number } {
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (day.getDay() + 6) % 7; // Monday = 0
  day.setDate(day.getDate() - dow + 3); // the Thursday of this week
  const year = day.getFullYear();
  const firstThursday = new Date(year, 0, 4);
  firstThursday.setDate(firstThursday.getDate() - ((firstThursday.getDay() + 6) % 7) + 3);
  const week = 1 + Math.round((day.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
  return { year, week };
}

/** This week's drill: the same for everyone in the same ISO week, and a new one each week. */
export function weeklyIndex(d: Date, count: number): number {
  if (count <= 0) return 0;
  const { year, week } = isoWeek(d);
  return (year * 53 + week) % count;
}

/**
 * This week's drill, rotating through the levels: week n gets level n mod (number of levels),
 * then the next drill of that level (in list order). The same for everyone in the same ISO week.
 * `levels`: each drill's level, in list order. Returns an index into that list.
 */
export function weeklyPick(d: Date, levels: readonly number[]): number {
  if (!levels.length) return 0;
  const { year, week } = isoWeek(d);
  const n = year * 53 + week;
  const distinct = [...new Set(levels)].sort((a, b) => a - b);
  const level = distinct[n % distinct.length]!;
  const ofLevel = levels.flatMap((l, i) => (l === level ? [i] : []));
  return ofLevel[Math.floor(n / distinct.length) % ofLevel.length]!;
}

/** Keep only well-formed data (saved data may be old, from a newer version, or hand-edited). */
export function cleanNightShift(raw: unknown): NightShiftData {
  const out: NightShiftData = { v: NIGHT_SHIFT_VERSION, done: {} };
  if (!raw || typeof raw !== 'object') return out;
  const done = (raw as { done?: unknown }).done;
  if (done && typeof done === 'object' && !Array.isArray(done)) {
    for (const [id, day] of Object.entries(done as Record<string, unknown>)) {
      if (/^[a-z0-9-]{1,60}$/.test(id) && typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day)) out.done[id] = day;
    }
  }
  return out;
}

export function loadNightShift(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): NightShiftData {
  try {
    const text = storage?.getItem(NIGHT_SHIFT_KEY);
    return cleanNightShift(text ? JSON.parse(text) : null);
  } catch {
    return cleanNightShift(null);
  }
}

/** Remember a fixed drill (the first day counts). Returns false when the browser blocks saving. */
export function markDrillDone(id: string, day: string, storage: Pick<Storage, 'getItem' | 'setItem'> | undefined = globalThis.localStorage): boolean {
  const data = loadNightShift(storage);
  if (!data.done[id]) data.done[id] = day;
  try {
    storage?.setItem(NIGHT_SHIFT_KEY, JSON.stringify(data));
    return Boolean(storage);
  } catch {
    return false;
  }
}

/**
 * Exam timer text. It counts up and never stops the learner. Calm mode shows whole minutes only,
 * so the text changes once a minute instead of every second.
 */
export function clockText(seconds: number, calm = false): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  if (calm) return String(m);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

/** The suggested time for one drill (no countdown: the page just says so kindly). */
export const DRILL_SECONDS = 5 * 60;
