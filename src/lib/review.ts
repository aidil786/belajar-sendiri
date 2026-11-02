// Daily review cards: spaced repetition with Leitner boxes.
// Words (glossary) and commands come back only after the learner finished
// (or placement-tested out of) the lesson that taught them. Max 10 a day.
// Pure functions, no DOM and no Astro: easy to test, reusable for any course.
import { reviewItemId, reviewWorld } from './catalog';

/** Days to wait before a card comes back, for box 1..6. */
export const INTERVALS = [1, 2, 4, 7, 14, 30] as const;
export const MAX_BOX = INTERVALS.length;
export const MAX_PER_DAY = 10;

export type ItemKind = 'term' | 'command';
/** term: "What does X mean?"; meaning: "Which word means …?"; command: "Which command …?" */
export type CardKind = 'term' | 'meaning' | 'command';

/** One thing to remember, in one language. */
export interface ReviewItem {
  id: string;
  kind: ItemKind;
  world: number;
  /** Course order (smaller = taught earlier). */
  order: number;
  /** Lesson ids. The item is ready for review when all are finished or known. */
  needs: string[];
  /** The word or the short command, e.g. "commit" or "git add". */
  label: string;
  /** The plain meaning, or what the command does. */
  text: string;
  /** Ids of near-synonyms: never offered as a wrong answer for this item (or it for them). */
  avoid?: string[] | undefined;
}

/** A schedulable card. `after`: another card that must be reviewed on an earlier day first. */
export interface ReviewSlot {
  id: string;
  needs: string[];
  order: number;
  after?: string | undefined;
}

export interface ReviewCard extends ReviewSlot {
  kind: CardKind;
  item: ReviewItem;
}

/** Saved per card. Dates are local day keys (YYYY-MM-DD) from `dayKey()`. */
export interface CardState {
  box: number;
  due: string;
  last: string;
}
export type CardStates = Record<string, CardState>;

// ---------------------------------------------------------------------------
// Day keys. Math on the key itself (UTC), so time zones and daylight saving
// can never add or lose a day. The key comes from the learner's local clock.

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const pad = (n: number) => String(n).padStart(2, '0');

export function isDayKey(value: unknown): value is string {
  return typeof value === 'string' && DAY_RE.test(value);
}

function keyToUtc(key: string): number {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
}

export function addDays(key: string, n: number): string {
  const x = new Date(keyToUtc(key) + n * 86_400_000);
  return `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-${pad(x.getUTCDate())}`;
}

export function daysBetween(from: string, to: string): number {
  return Math.round((keyToUtc(to) - keyToUtc(from)) / 86_400_000);
}

// ---------------------------------------------------------------------------
// Leitner boxes

/**
 * Right: up one box. Miss: gently down one box (never straight back to box 1).
 * A brand-new card starts in box 0, so its first answer lands in box 1.
 */
export function answerCard(prev: CardState | undefined, right: boolean, today: string): CardState {
  const box = prev ? prev.box : 0;
  const next = right ? Math.min(MAX_BOX, box + 1) : Math.max(1, box - 1);
  return { box: next, due: addDays(today, INTERVALS[next - 1]!), last: today };
}

export function isLearned(needs: readonly string[], learned: ReadonlySet<string>): boolean {
  return needs.length > 0 && needs.every((id) => learned.has(id));
}

/** Cards already answered today. */
export function reviewedToday(states: CardStates, today: string): number {
  return Object.values(states).filter((s) => s.last === today).length;
}

function readyToStart(slot: ReviewSlot, states: CardStates, today: string): boolean {
  if (!slot.after) return true;
  const first = states[slot.after];
  return Boolean(first && first.last < today);
}

/**
 * Today's cards, in order: overdue reviews first (oldest due, lowest box),
 * then new cards in course order. Never more than `max` a day in total.
 */
export function dueToday(
  slots: readonly ReviewSlot[],
  states: CardStates,
  learned: Iterable<string>,
  today: string,
  max: number = MAX_PER_DAY,
): string[] {
  const left = max - reviewedToday(states, today);
  if (left <= 0) return [];
  const known = new Set(learned);
  const reviews: ReviewSlot[] = [];
  const fresh: ReviewSlot[] = [];
  for (const slot of slots) {
    if (!isLearned(slot.needs, known)) continue;
    const s = states[slot.id];
    if (!s) {
      if (readyToStart(slot, states, today)) fresh.push(slot);
    } else if (s.last !== today && s.due <= today) reviews.push(slot);
  }
  const st = (slot: ReviewSlot) => states[slot.id]!;
  reviews.sort((a, b) => (st(a).due < st(b).due ? -1 : st(a).due > st(b).due ? 1 : st(a).box - st(b).box || a.order - b.order));
  fresh.sort((a, b) => a.order - b.order);
  return [...reviews, ...fresh].slice(0, left).map((s) => s.id);
}

/** The next day any learned card will be ready (null when nothing is learned yet). */
export function nextReviewDay(slots: readonly ReviewSlot[], states: CardStates, learned: Iterable<string>, today: string): string | null {
  const known = new Set(learned);
  let best: string | null = null;
  for (const slot of slots) {
    if (!isLearned(slot.needs, known)) continue;
    const s = states[slot.id];
    const day = s ? (s.due > today ? s.due : addDays(today, 1)) : addDays(today, 1);
    if (!best || day < best) best = day;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Building the pool from course content

export interface PoolLesson {
  id: string;
  world: number;
  /** The lesson's MDX body (English), used to find where a word is taught. */
  text: string;
}

export interface PoolTerm {
  id: string;
  world?: number | undefined;
  confusable?: string[] | undefined;
  en: { term: string; meaning: string };
  ms: { term: string; meaning: string };
}

export interface PoolCommand {
  id: string;
  syntax: string;
  lesson?: string | undefined;
  confusable?: string[] | undefined;
  what: { en: string; ms: string };
}

export interface PoolInput {
  lang: 'en' | 'ms';
  /** Ready lessons and bosses, in course order. */
  lessons: PoolLesson[];
  terms: PoolTerm[];
  commands: PoolCommand[];
}

/** "git add <file> | . | -p" → "git add"; "git --version" → "git --version"; "ls [-a]" → "ls". */
export function commandLabel(syntax: string): string {
  const first = syntax.split(/\s+·\s+/)[0]!.trim();
  const words: string[] = [];
  for (const tok of first.split(/\s+/)) {
    if (/^[a-z][\w-]*$/i.test(tok)) words.push(tok);
    else if (words.length === 1 && words[0] === 'git' && /^--[a-z]/.test(tok)) {
      words.push(tok);
      break;
    } else break;
  }
  return words.join(' ') || first;
}

/** The phrases a learner would recognise: "repository (repo)" → ["repository", "repo"]. */
export function termPhrases(term: string): string[] {
  const out: string[] = [];
  for (const part of term.split(/\s*\/\s*/)) {
    const m = /^(.*?)\s*\((.*)\)\s*$/.exec(part);
    if (m) out.push(m[1]!, m[2]!);
    else out.push(part);
  }
  return out.map((p) => p.trim().toLowerCase()).filter((p) => p.length > 0);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whole-word, case-insensitive search. */
export function mentions(text: string, phrase: string): boolean {
  if (!phrase) return false;
  return new RegExp(`(?<![\\w-])${escapeRe(phrase)}(?![\\w-])`, 'i').test(text);
}

/** Which lessons teach a glossary word: a <Term> tag, else the first mention, else the whole world. */
export function lessonsForTerm(term: PoolTerm, lessons: readonly PoolLesson[]): string[] {
  if (term.world === undefined) return [];
  const inWorld = lessons.filter((l) => l.world === term.world);
  const tagged = inWorld.find((l) => l.text.includes(`<Term id="${term.id}"`));
  if (tagged) return [tagged.id];
  const main = termPhrases(term.en.term)[0] ?? '';
  const mentioned = inWorld.find((l) => mentions(l.text, main));
  if (mentioned) return [mentioned.id];
  return inWorld.map((l) => l.id);
}

export function buildPool({ lang, lessons, terms, commands }: PoolInput): ReviewItem[] {
  const index = new Map(lessons.map((l, i) => [l.id, i]));
  const items: ReviewItem[] = [];
  const orderOf = (needs: string[], i: number) => Math.max(...needs.map((id) => index.get(id) ?? 0)) * 1000 + i;

  terms.forEach((term, i) => {
    const needs = lessonsForTerm(term, lessons);
    if (needs.length === 0) return;
    items.push({
      id: term.id,
      kind: 'term',
      world: term.world ?? 0,
      order: orderOf(needs, i),
      needs,
      label: term[lang].term,
      text: term[lang].meaning,
      avoid: term.confusable ?? [],
    });
  });

  commands.forEach((cmd, i) => {
    if (!cmd.lesson || !index.has(cmd.lesson)) return;
    const lesson = lessons[index.get(cmd.lesson)!]!;
    items.push({
      id: cmd.id,
      kind: 'command',
      world: lesson.world,
      order: orderOf([cmd.lesson], 500 + i),
      needs: [cmd.lesson],
      label: commandLabel(cmd.syntax),
      text: cmd.what[lang],
      avoid: cmd.confusable ?? [],
    });
  });

  return items.sort((a, b) => a.order - b.order);
}

/**
 * One daily deck from every course's items, in course order (pass every course, even empty ones).
 * Ids from courses after the first get a course prefix (docker:image), so they never clash;
 * worlds and order are spread per course, so wrong answers come from the same course.
 */
export function mergeCoursePools(pools: readonly { courseId: string; items: readonly ReviewItem[] }[]): ReviewItem[] {
  const out: ReviewItem[] = [];
  pools.forEach(({ courseId, items }, i) => {
    for (const item of items) {
      out.push({
        ...item,
        id: reviewItemId(courseId, item.id),
        world: reviewWorld(i, item.world),
        order: i * 10_000_000 + item.order,
        avoid: item.avoid?.map((a) => reviewItemId(courseId, a)),
      });
    }
  });
  return out;
}

/** Every card for these items. A word is asked both ways; the reverse comes on a later day. */
export function cardsFor(items: readonly ReviewItem[]): ReviewCard[] {
  const cards: ReviewCard[] = [];
  items.forEach((item, i) => {
    const base = { needs: item.needs, item };
    if (item.kind === 'command') {
      cards.push({ ...base, id: `cmd:${item.id}`, kind: 'command', order: i * 2 });
    } else {
      cards.push({ ...base, id: `term:${item.id}`, kind: 'term', order: i * 2 });
      cards.push({ ...base, id: `meaning:${item.id}`, kind: 'meaning', order: i * 2 + 1, after: `term:${item.id}` });
    }
  });
  return cards;
}

// Compact form for pages that only need to count due cards (the home page).
export type SlotIndex = { l: string[]; c: [string, number[], string?][] };

export function encodeSlots(slots: readonly ReviewSlot[]): SlotIndex {
  const l: string[] = [];
  const at = (id: string) => {
    let i = l.indexOf(id);
    if (i < 0) i = l.push(id) - 1;
    return i;
  };
  return { l, c: slots.map((s) => (s.after ? [s.id, s.needs.map(at), s.after] : [s.id, s.needs.map(at)])) };
}

export function decodeSlots(index: SlotIndex): ReviewSlot[] {
  return index.c.map(([id, needs, after], order) => ({ id, needs: needs.map((i) => index.l[i] ?? ''), order, after }));
}

// ---------------------------------------------------------------------------
// Questions: 3 options, picked from the same or a nearby world.

export interface Question {
  cardId: string;
  kind: CardKind;
  /** The word (term card) or the meaning / what-it-does text. */
  ask: string;
  options: string[];
  answer: number;
}

/** Small seeded random numbers, so a reload shows the same question. */
export function seededRandom(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const norm = (s: string) => s.trim().toLowerCase();
const mainWords = (label: string) => termPhrases(label.replace(/^git\s+/i, '')).filter((p) => p.length >= 3 && p !== 'git');

/** Would this other item make the question unfair or confusing? */
function clashes(kind: CardKind, item: ReviewItem, other: ReviewItem): boolean {
  if (norm(other.label) === norm(item.label) || norm(other.text) === norm(item.text)) return true;
  // Near-synonyms marked in the content (e.g. git switch and git checkout).
  if (item.avoid?.includes(other.id) || other.avoid?.includes(item.id)) return true;
  // The question text names the other option ("…undoes an old commit" vs "git commit").
  if (kind !== 'term') return mainWords(other.label).some((w) => mentions(item.text, w));
  // A wrong meaning that uses the word being asked about.
  return mainWords(item.label).some((w) => mentions(other.text, w));
}

export function buildQuestion(card: ReviewCard, items: readonly ReviewItem[], seed: string, size = 3): Question {
  const rand = seededRandom(`${card.id}|${seed}`);
  const pool = items
    .filter((x) => x.kind === card.item.kind && x.id !== card.item.id && !clashes(card.kind, card.item, x))
    .map((x) => ({ x, dist: Math.abs(x.world - card.item.world), r: rand() }))
    .sort((a, b) => a.dist - b.dist || a.r - b.r);
  const picked: ReviewItem[] = [];
  for (const { x } of pool) {
    if (picked.length >= size - 1) break;
    const show = card.kind === 'term' ? x.text : x.label;
    if (picked.some((p) => norm(card.kind === 'term' ? p.text : p.label) === norm(show))) continue;
    picked.push(x);
  }
  const shown = (x: ReviewItem) => (card.kind === 'term' ? x.text : x.label);
  const options = [card.item, ...picked].map((x) => ({ text: shown(x), right: x === card.item, r: rand() }));
  options.sort((a, b) => a.r - b.r);
  return {
    cardId: card.id,
    kind: card.kind,
    ask: card.kind === 'term' ? card.item.label : card.item.text,
    options: options.map((o) => o.text),
    answer: options.findIndex((o) => o.right),
  };
}
