// Learner progress and settings, saved in localStorage after every card.
// No account, no server. Everything is wrapped in try/catch: the site works even
// when storage is blocked (progress then lasts until the tab closes).
import { atom } from 'nanostores';
import type { Lang } from '~/i18n';
import { answerCard, isDayKey, MAX_BOX, type CardStates } from '~/lib/review';

// The key name stays "v1" for good; the schema version lives inside the data.
export const STORAGE_KEY = 'fahamlah:v1';
export const SCHEMA_VERSION = 2;

export type Vote = 'fun' | 'confusing' | 'boring';

export interface Settings {
  lang: Lang | null;
  calm: boolean;
  font: 'atkinson' | 'lexend';
  theme: 'system' | 'light' | 'dark';
  sound: boolean;
  sprint: boolean;
  /** Ship It exam mode: night shift drills get a timer and a docs-only rule. Missing in older saves = off. */
  examMode: boolean;
  /** GitHub username for real-world mission checks, and the repo names the learner used. */
  github: GithubSettings;
}

export interface GithubSettings {
  user: string;
  /** Lesson's suggested repo name → the name the learner actually used. */
  repos: Record<string, string>;
}

export interface LessonState {
  cardId: string;
  seen: string[];
  done: string[]; // cards whose activity was completed
}

export interface Progress {
  v: number;
  name: string;
  nameAsked: boolean;
  resume: { lessonId: string; cardId: string; cardIndex: number; path: string } | null;
  lessons: Record<string, LessonState>;
  completed: string[];
  xp: number;
  badges: string[];
  known: string[];
  days: string[]; // YYYY-MM-DD, days with any learning
  minutes: Record<string, number>; // minutes learned per day
  votes: { lessonId: string; vote: Vote; at: string }[];
  missions: Record<string, string[]>; // mission id → ticked step ids
  session: { start: number; last: number; nudgedAt: number | null };
  lastVisit: string | null;
  settings: Settings;
  /** Daily review cards (v2): Leitner box and next day per card. */
  review: { cards: CardStates };
}

export const DEFAULT_SETTINGS: Settings = {
  lang: null,
  calm: false,
  font: 'atkinson',
  theme: 'system',
  sound: false,
  sprint: true,
  examMode: false,
  github: { user: '', repos: {} },
};

/** Keep only well-formed GitHub settings (older saves have none). */
export function cleanGithub(raw: unknown): GithubSettings {
  const out: GithubSettings = { user: '', repos: {} };
  if (!raw || typeof raw !== 'object') return out;
  const g = raw as Record<string, unknown>;
  if (typeof g.user === 'string') out.user = g.user.slice(0, 39);
  if (g.repos && typeof g.repos === 'object' && !Array.isArray(g.repos)) {
    for (const [k, v] of Object.entries(g.repos as Record<string, unknown>)) {
      if (typeof v === 'string' && k.length <= 100) out.repos[k] = v.slice(0, 100);
    }
  }
  return out;
}

export function emptyProgress(): Progress {
  return {
    v: SCHEMA_VERSION,
    name: '',
    nameAsked: false,
    resume: null,
    lessons: {},
    completed: [],
    xp: 0,
    badges: [],
    known: [],
    days: [],
    minutes: {},
    votes: [],
    missions: {},
    session: { start: 0, last: 0, nudgedAt: null },
    lastVisit: null,
    settings: { ...DEFAULT_SETTINGS, github: { user: '', repos: {} } },
    review: { cards: {} },
  };
}

/** Keep only well-formed review cards (saved data may be old or hand-edited). */
function cleanReview(raw: unknown): { cards: CardStates } {
  const cards: CardStates = {};
  const src = raw && typeof raw === 'object' ? (raw as { cards?: unknown }).cards : undefined;
  if (src && typeof src === 'object') {
    for (const [id, v] of Object.entries(src as Record<string, unknown>)) {
      const c = v as Partial<{ box: unknown; due: unknown; last: unknown }> | null;
      if (!c || typeof c.box !== 'number' || !Number.isInteger(c.box) || !isDayKey(c.due) || !isDayKey(c.last)) continue;
      cards[id] = { box: Math.min(MAX_BOX, Math.max(1, c.box)), due: c.due, last: c.last };
    }
  }
  return { cards };
}

/** Bring older saved data up to the current schema. */
export function migrate(raw: unknown): Progress {
  const base = emptyProgress();
  if (!raw || typeof raw !== 'object') return base;
  const data = raw as Partial<Progress> & { v?: number };
  // v1 → v2: daily review cards. v1 data simply starts with no cards.
  const review = (data.v ?? 1) < 2 ? base.review : cleanReview(data.review);
  return {
    ...base,
    ...data,
    v: SCHEMA_VERSION,
    settings: {
      ...DEFAULT_SETTINGS,
      ...(data.settings ?? {}),
      examMode: data.settings?.examMode === true,
      github: cleanGithub(data.settings?.github),
    },
    session: { ...base.session, ...(data.session ?? {}) },
    review,
  };
}

// ---------------------------------------------------------------------------
// Storage

export let storageOk = true;

function read(): Progress {
  try {
    const text = globalThis.localStorage?.getItem(STORAGE_KEY);
    return text ? migrate(JSON.parse(text)) : emptyProgress();
  } catch {
    storageOk = false;
    return emptyProgress();
  }
}

function write(p: Progress): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(p));
    storageOk = true;
  } catch {
    storageOk = false;
  }
}

export const $progress = atom<Progress>(typeof window === 'undefined' ? emptyProgress() : read());

export function update(fn: (p: Progress) => Progress): Progress {
  const next = fn(structuredClone($progress.get()));
  $progress.set(next);
  write(next);
  return next;
}

// Keep tabs in sync.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY) $progress.set(read());
  });
}

// ---------------------------------------------------------------------------
// Dates and streaks (pure, so they are easy to test)

export function dayKey(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseDay(key: string): Date {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** Monday of the week that holds `d`. */
function weekStart(d: Date): string {
  const day = (d.getDay() + 6) % 7;
  return dayKey(addDays(d, -day));
}

export const REST_DAYS_PER_WEEK = 2;

/**
 * Gentle streak: learning days in a row, where up to 2 missed days per week
 * count as rest. A longer gap simply starts a new streak (shown as "Welcome back!").
 */
export function streakInfo(days: string[], today: Date = new Date()): { learningDays: number; restLeft: number; welcomeBack: boolean } {
  const set = new Set(days);
  const todayKey = dayKey(today);
  const restUsed = new Map<string, number>();
  let learningDays = 0;
  let cursor = set.has(todayKey) ? today : addDays(today, -1);
  // Today never counts as a missed day.
  for (let i = 0; i < 400; i++) {
    const key = dayKey(cursor);
    if (set.has(key)) learningDays++;
    else {
      const w = weekStart(cursor);
      const used = restUsed.get(w) ?? 0;
      if (used >= REST_DAYS_PER_WEEK) break;
      restUsed.set(w, used + 1);
    }
    cursor = addDays(cursor, -1);
    if (learningDays === set.size) break;
  }
  // Rest days already used this week (before today).
  const thisWeek = weekStart(today);
  let missedThisWeek = 0;
  for (let d = parseDay(thisWeek); dayKey(d) !== todayKey; d = addDays(d, 1)) {
    if (!set.has(dayKey(d)) && days.some((x) => x < dayKey(d))) missedThisWeek++;
  }
  const restLeft = Math.max(0, REST_DAYS_PER_WEEK - missedThisWeek);
  const last = [...days].sort().pop();
  const gap = last ? Math.round((parseDay(todayKey).getTime() - parseDay(last).getTime()) / 86400000) : 0;
  return { learningDays, restLeft, welcomeBack: gap > 1 };
}

// ---------------------------------------------------------------------------
// Actions

/** Called on every card change: saves the resume point and learning time. */
export function recordCard(lessonId: string, cardId: string, cardIndex: number, path: string, now = Date.now()): Progress {
  return update((p) => {
    const lesson = p.lessons[lessonId] ?? { cardId, seen: [], done: [] };
    lesson.cardId = cardId;
    if (!lesson.seen.includes(cardId)) lesson.seen.push(cardId);
    p.lessons[lessonId] = lesson;
    p.resume = { lessonId, cardId, cardIndex, path };
    return tickTime(p, now);
  });
}

/** Add learning time (gaps over 3 minutes count as a break, not learning). */
export function tickTime(p: Progress, now = Date.now()): Progress {
  const today = dayKey(new Date(now));
  if (!p.days.includes(today)) p.days.push(today);
  const gap = p.session.last ? now - p.session.last : Infinity;
  if (gap > 10 * 60_000) {
    p.session = { start: now, last: now, nudgedAt: null };
  } else {
    const add = Math.min(gap, 3 * 60_000) / 60_000;
    p.minutes[today] = Math.round(((p.minutes[today] ?? 0) + add) * 100) / 100;
    p.session.last = now;
  }
  p.lastVisit = today;
  return p;
}

export function markCardDone(lessonId: string, cardId: string): void {
  update((p) => {
    const lesson = p.lessons[lessonId] ?? { cardId, seen: [cardId], done: [] };
    if (!lesson.done.includes(cardId)) lesson.done.push(cardId);
    p.lessons[lessonId] = lesson;
    return p;
  });
}

/** Mark a lesson finished. Returns the XP and badges newly earned. */
export function completeLesson(
  lessonId: string,
  xp: number,
  badgesFor: (p: Progress) => string[],
): { xp: number; badges: string[] } {
  let gained = 0;
  let newBadges: string[] = [];
  update((p) => {
    if (!p.completed.includes(lessonId)) {
      p.completed.push(lessonId);
      p.xp += xp;
      gained = xp;
    }
    newBadges = badgesFor(p).filter((b) => !p.badges.includes(b));
    p.badges.push(...newBadges);
    return p;
  });
  return { xp: gained, badges: newBadges };
}

export function vote(lessonId: string, v: Vote): void {
  update((p) => {
    p.votes = p.votes.filter((x) => x.lessonId !== lessonId);
    p.votes.push({ lessonId, vote: v, at: new Date().toISOString() });
    return p;
  });
}

export function setSettings(patch: Partial<Settings>): void {
  update((p) => {
    p.settings = { ...p.settings, ...patch };
    return p;
  });
  applySettings();
}

/** Remember the learner's GitHub username (and repo names) for later missions. */
export function setGithub(patch: { user?: string; repos?: Record<string, string> }): void {
  update((p) => {
    const g = cleanGithub(p.settings.github);
    if (patch.user !== undefined) g.user = patch.user.trim().slice(0, 39);
    if (patch.repos) Object.assign(g.repos, patch.repos);
    p.settings = { ...p.settings, github: g };
    return p;
  });
}

/** Forget the saved GitHub username and repo names. */
export function forgetGithub(): void {
  update((p) => {
    p.settings = { ...p.settings, github: { user: '', repos: {} } };
    return p;
  });
}

export function setName(name: string): void {
  update((p) => {
    p.name = name.trim().slice(0, 40);
    p.nameAsked = true;
    return p;
  });
}

export function markKnown(lessonIds: string[]): void {
  update((p) => {
    p.known = [...new Set([...p.known, ...lessonIds])];
    return p;
  });
}

export function tickMission(missionId: string, stepId: string, done: boolean): string[] {
  let result: string[] = [];
  update((p) => {
    const steps = new Set(p.missions[missionId] ?? []);
    if (done) steps.add(stepId);
    else steps.delete(stepId);
    result = [...steps];
    p.missions[missionId] = result;
    return p;
  });
  return result;
}

/** Save one review answer. Reviewing counts as learning today (gentle streak). */
export function recordReview(cardId: string, right: boolean, now = Date.now()): Progress {
  return update((p) => {
    p.review.cards[cardId] = answerCard(p.review.cards[cardId], right, dayKey(new Date(now)));
    return tickTime(p, now);
  });
}

/** Lessons whose words and commands can come back for review. */
export function learnedLessons(p: Progress): string[] {
  return [...new Set([...p.completed, ...p.known])];
}

export function resetProgress(): void {
  const settings = $progress.get().settings;
  const fresh = emptyProgress();
  fresh.settings = settings;
  $progress.set(fresh);
  write(fresh);
}

/** Should the gentle break banner show? (~25 min of continuous use) */
export function shouldNudge(p: Progress, now = Date.now()): boolean {
  const { start, last, nudgedAt } = p.session;
  if (!start || now - last > 10 * 60_000) return false;
  const since = nudgedAt ?? start;
  return now - since >= 25 * 60_000;
}

export function snoozeNudge(now = Date.now()): void {
  update((p) => {
    p.session.nudgedAt = now;
    return p;
  });
}

/** Mirror settings onto <html> so CSS can react (theme, calm, font). */
export function applySettings(): void {
  if (typeof document === 'undefined') return;
  const s = $progress.get().settings;
  const root = document.documentElement;
  root.dataset.calm = String(s.calm);
  root.dataset.font = s.font;
  if (s.theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = s.theme;
}

export function exportJson(kind: 'progress' | 'feedback'): string {
  const p = $progress.get();
  return JSON.stringify(kind === 'progress' ? p : { votes: p.votes }, null, 2);
}
