import { afterEach, describe, expect, it } from 'vitest';
import { dayKey } from '~/stores/progress';
import {
  INTERVALS,
  MAX_PER_DAY,
  addDays,
  answerCard,
  buildPool,
  buildQuestion,
  cardsFor,
  commandLabel,
  daysBetween,
  decodeSlots,
  dueToday,
  encodeSlots,
  lessonsForTerm,
  nextReviewDay,
  termPhrases,
  type CardStates,
  type PoolInput,
  type ReviewItem,
  type ReviewSlot,
} from './review';

const slot = (id: string, needs = ['l1'], order = 0, after?: string): ReviewSlot => ({ id, needs, order, after });

describe('day keys', () => {
  it('adds days across months, years and leap days', () => {
    expect(addDays('2026-10-30', 1)).toBe('2026-10-31');
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-11-01', -1)).toBe('2026-10-31');
    expect(daysBetween('2026-10-30', '2026-11-29')).toBe(30);
  });

  it('daylight saving changes never add or lose a day', () => {
    // US clocks change on 2026-03-08 and 2026-11-01; EU on 2026-03-29 and 2026-10-25.
    for (const day of ['2026-03-08', '2026-11-01', '2026-03-29', '2026-10-25']) {
      expect(daysBetween(addDays(day, -1), addDays(day, 1))).toBe(2);
    }
  });

  describe('in different time zones', () => {
    const original = process.env.TZ;
    afterEach(() => {
      process.env.TZ = original;
    });

    it('the day comes from the local clock, and intervals count local days', () => {
      // 16:30 UTC is already the next day in Kuala Lumpur (UTC+8), but not in Los Angeles.
      const instant = new Date('2026-10-30T16:30:00Z');
      const answers: Record<string, string> = {};
      for (const tz of ['Asia/Kuala_Lumpur', 'America/Los_Angeles', 'Pacific/Kiritimati', 'UTC']) {
        process.env.TZ = tz;
        const today = dayKey(instant);
        answers[tz] = today;
        const s = answerCard(undefined, true, today);
        expect(daysBetween(today, s.due)).toBe(INTERVALS[0]);
      }
      expect(answers['Asia/Kuala_Lumpur']).toBe('2026-10-31');
      expect(answers['America/Los_Angeles']).toBe('2026-10-30');
      expect(answers['Pacific/Kiritimati']).toBe('2026-10-31');
      expect(answers.UTC).toBe('2026-10-30');
    });

    it('late at night and just after midnight are different review days', () => {
      process.env.TZ = 'Asia/Kuala_Lumpur';
      const late = dayKey(new Date('2026-10-30T15:59:00Z')); // 23:59 in KL
      const early = dayKey(new Date('2026-10-30T16:01:00Z')); // 00:01 in KL
      expect(daysBetween(late, early)).toBe(1);
      const states: CardStates = { a: answerCard(undefined, true, late) };
      expect(dueToday([slot('a')], states, ['l1'], late)).toEqual([]);
      expect(dueToday([slot('a')], states, ['l1'], early)).toEqual(['a']);
    });
  });
});

describe('Leitner boxes', () => {
  it('a right answer moves up one box, with intervals 1, 2, 4, 7, 14, 30 days', () => {
    let s = answerCard(undefined, true, '2026-10-30');
    expect(s).toEqual({ box: 1, due: '2026-10-31', last: '2026-10-30' });
    const days = [s];
    for (let i = 0; i < 6; i++) {
      s = answerCard(s, true, s.due);
      days.push(s);
    }
    expect(days.map((d) => d.box)).toEqual([1, 2, 3, 4, 5, 6, 6]);
    expect(days.map((d) => daysBetween(d.last, d.due))).toEqual([1, 2, 4, 7, 14, 30, 30]);
  });

  it('a miss moves gently down one box, never straight to box 1', () => {
    expect(answerCard({ box: 5, due: '2026-10-30', last: '2026-10-16' }, false, '2026-10-30')).toEqual({
      box: 4,
      due: '2026-11-06',
      last: '2026-10-30',
    });
    expect(answerCard({ box: 1, due: '2026-10-30', last: '2026-10-29' }, false, '2026-10-30').box).toBe(1);
    expect(answerCard(undefined, false, '2026-10-30')).toEqual({ box: 1, due: '2026-10-31', last: '2026-10-30' });
  });
});

describe('due selection', () => {
  const today = '2026-10-30';

  it('only cards from finished or known lessons', () => {
    const slots = [slot('a', ['l1']), slot('b', ['l2']), slot('c', ['l1', 'l2']), slot('d', [])];
    expect(dueToday(slots, {}, ['l1'], today)).toEqual(['a']);
    expect(dueToday(slots, {}, ['l1', 'l2'], today)).toEqual(['a', 'b', 'c']);
  });

  it('never more than 10 a day, counting cards already answered today', () => {
    const slots = Array.from({ length: 25 }, (_, i) => slot(`c${i}`, ['l1'], i));
    expect(dueToday(slots, {}, ['l1'], today)).toHaveLength(MAX_PER_DAY);
    const states: CardStates = {};
    for (let i = 0; i < 4; i++) states[`c${i}`] = answerCard(undefined, true, today);
    const due = dueToday(slots, states, ['l1'], today);
    expect(due).toHaveLength(6);
    expect(due[0]).toBe('c4');
    for (let i = 4; i < 10; i++) states[`c${i}`] = answerCard(undefined, i % 2 === 0, today);
    expect(dueToday(slots, states, ['l1'], today)).toEqual([]);
    // Tomorrow is a fresh day.
    expect(dueToday(slots, states, ['l1'], addDays(today, 1))).toHaveLength(10);
  });

  it('reviews that are due come before new cards, oldest first', () => {
    const slots = [slot('new1', ['l1'], 0), slot('old', ['l1'], 1), slot('older', ['l1'], 2), slot('later', ['l1'], 3)];
    const states: CardStates = {
      old: { box: 2, due: '2026-10-29', last: '2026-10-27' },
      older: { box: 3, due: '2026-10-20', last: '2026-10-16' },
      later: { box: 4, due: '2026-11-03', last: '2026-10-27' },
    };
    expect(dueToday(slots, states, ['l1'], today)).toEqual(['older', 'old', 'new1']);
  });

  it('the reverse question waits for a later day', () => {
    const slots = [slot('term:x', ['l1'], 0), slot('meaning:x', ['l1'], 1, 'term:x')];
    expect(dueToday(slots, {}, ['l1'], today)).toEqual(['term:x']);
    const states: CardStates = { 'term:x': answerCard(undefined, true, today) };
    expect(dueToday(slots, states, ['l1'], today)).toEqual([]);
    expect(dueToday(slots, states, ['l1'], addDays(today, 1))).toEqual(['term:x', 'meaning:x']);
  });

  it('knows when the next cards come back', () => {
    const slots = [slot('a'), slot('b')];
    const states: CardStates = { a: { box: 3, due: '2026-11-03', last: today }, b: { box: 2, due: '2026-11-01', last: today } };
    expect(nextReviewDay(slots, states, ['l1'], today)).toBe('2026-11-01');
    expect(nextReviewDay(slots, states, [], today)).toBeNull();
  });

  it('the compact index keeps every card', () => {
    const slots = [slot('term:x', ['l1'], 0), slot('meaning:x', ['l1'], 1, 'term:x'), slot('cmd:add', ['l2', 'l1'], 2)];
    expect(decodeSlots(encodeSlots(slots))).toEqual(slots);
  });
});

describe('pool and questions', () => {
  const input: PoolInput = {
    lang: 'en',
    lessons: [
      { id: 'w0-l1', world: 0, text: 'Git keeps every version of your work.' },
      { id: 'w1-l1', world: 1, text: 'Make a repository with git init.' },
      { id: 'w1-l2', world: 1, text: 'The <Term id="staging-area">box</Term> holds ready changes.' },
      { id: 'w1-l3', world: 1, text: 'A commit is a save point.' },
      { id: 'w2-l1', world: 2, text: 'Restore a file.' },
    ],
    terms: [
      { id: 'git', world: 0, en: { term: 'Git', meaning: 'A tool that saves versions.' }, ms: { term: 'Git', meaning: 'Alat yang simpan versi.' } },
      { id: 'repository', world: 1, en: { term: 'repository (repo)', meaning: 'A project folder Git looks after.' }, ms: { term: 'repo', meaning: 'Folder projek yang Git jaga.' } },
      { id: 'staging-area', world: 1, en: { term: 'staging area', meaning: 'A box for ready changes.' }, ms: { term: 'kawasan staging', meaning: 'Kotak untuk perubahan yang siap.' } },
      { id: 'commit', world: 1, en: { term: 'commit', meaning: 'A save point, like in a game.' }, ms: { term: 'commit', meaning: 'Titik simpan.' } },
      { id: 'hunk', world: 1, en: { term: 'hunk', meaning: 'One piece of change inside a file.' }, ms: { term: 'hunk', meaning: 'Satu bahagian perubahan.' } },
      { id: 'later', world: 3, en: { term: 'merge', meaning: 'Join two storylines.' }, ms: { term: 'merge', meaning: 'Gabung.' } },
    ],
    commands: [
      { id: 'init', syntax: 'git init [folder]', lesson: 'w1-l1', what: { en: 'Makes a folder into a Git repo.', ms: 'Jadikan folder repo Git.' } },
      { id: 'commit', syntax: 'git commit -m "<message>"', lesson: 'w1-l3', what: { en: 'Saves the box as a save point.', ms: 'Simpan isi kotak.' } },
      { id: 'revert', syntax: 'git revert <commit>', lesson: 'w2-l1', what: { en: 'Makes a new commit that undoes an old one.', ms: 'Buat commit baru.' } },
      { id: 'restore', syntax: 'git restore [--staged] <file>', lesson: 'w2-l1', what: { en: 'Puts a file back.', ms: 'Kembalikan fail.' } },
      { id: 'soon', syntax: 'git merge <branch>', lesson: 'w3-l1', what: { en: 'Joins branches.', ms: 'Gabung branch.' } },
    ],
  };

  it('short command labels', () => {
    expect(commandLabel('git add <file> | . | -p')).toBe('git add');
    expect(commandLabel('git --version')).toBe('git --version');
    expect(commandLabel('ls [-a] [folder]')).toBe('ls');
    expect(commandLabel('git help <command>  ·  git <command> -h')).toBe('git help');
    expect(commandLabel('git commit -m "<message>"')).toBe('git commit');
    expect(termPhrases('repository (repo)')).toEqual(['repository', 'repo']);
    expect(termPhrases('push / pull')).toEqual(['push', 'pull']);
  });

  it('a word belongs to the lesson that tags it, else the first that mentions it, else the whole world', () => {
    const [git, repo, staging, commit, hunk, later] = input.terms;
    expect(lessonsForTerm(staging!, input.lessons)).toEqual(['w1-l2']);
    expect(lessonsForTerm(repo!, input.lessons)).toEqual(['w1-l1']);
    expect(lessonsForTerm(commit!, input.lessons)).toEqual(['w1-l3']);
    expect(lessonsForTerm(git!, input.lessons)).toEqual(['w0-l1']);
    expect(lessonsForTerm(hunk!, input.lessons)).toEqual(['w1-l1', 'w1-l2', 'w1-l3']);
    expect(lessonsForTerm(later!, input.lessons)).toEqual([]); // world 3 has no ready lessons yet
  });

  it('builds items in course order, skipping lessons that are not ready', () => {
    const items = buildPool(input);
    expect(items.map((i) => `${i.kind}:${i.id}`)).toEqual([
      'term:git',
      'term:repository',
      'command:init',
      'term:staging-area',
      'term:commit',
      'term:hunk',
      'command:commit',
      'command:revert',
      'command:restore',
    ]);
    const ms = buildPool({ ...input, lang: 'ms' });
    expect(ms.find((i) => i.id === 'staging-area')?.label).toBe('kawasan staging');
    expect(cardsFor(items).filter((c) => c.kind === 'meaning')).toHaveLength(5);
  });

  it('questions have 3 options, one right, from the same or a nearby world', () => {
    const items = buildPool(input);
    const cards = cardsFor(items);
    for (const card of cards) {
      const q = buildQuestion(card, items, '2026-10-30');
      expect(q.options.length, card.id).toBeGreaterThanOrEqual(2);
      expect(q.options.length).toBeLessThanOrEqual(3);
      expect(new Set(q.options).size).toBe(q.options.length);
      const right = card.kind === 'term' ? card.item.text : card.item.label;
      expect(q.options[q.answer]).toBe(right);
      // Same seed, same question (a reload shows the same card).
      expect(buildQuestion(card, items, '2026-10-30')).toEqual(q);
    }
    const commitTerm = cards.find((c) => c.id === 'term:commit')!;
    const q = buildQuestion(commitTerm, items, 'x');
    const worlds = q.options.map((o) => items.find((i) => i.text === o)!.world);
    expect(worlds.every((w) => w === 1)).toBe(true);
  });

  it('never offers an option that the question itself names', () => {
    const items = buildPool(input);
    const revert = cardsFor(items).find((c) => c.id === 'cmd:revert')!;
    for (const seed of ['a', 'b', 'c', 'd', 'e']) {
      expect(buildQuestion(revert, items, seed).options).not.toContain('git commit');
    }
  });

  it('near-synonyms marked confusable are never wrong answers for each other', () => {
    const lessons = [{ id: 'l1', world: 2, text: '' }];
    const what = (en: string) => ({ en, ms: en });
    const items = buildPool({
      lang: 'en',
      lessons,
      terms: [],
      commands: [
        { id: 'switch', syntax: 'git switch <branch>', lesson: 'l1', what: what('Moves HEAD to a branch.'), confusable: ['checkout'] },
        { id: 'checkout', syntax: 'git checkout <commit>', lesson: 'l1', what: what('The older way to visit commits.') },
        { id: 'clean', syntax: 'git clean -n', lesson: 'l1', what: what('Deletes junk files.') },
        { id: 'reflog', syntax: 'git reflog', lesson: 'l1', what: what('Shows where HEAD has been.') },
      ],
    });
    const cards = cardsFor(items);
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f']) {
      expect(buildQuestion(cards.find((c) => c.id === 'cmd:switch')!, items, seed).options).not.toContain('git checkout');
      expect(buildQuestion(cards.find((c) => c.id === 'cmd:checkout')!, items, seed).options).not.toContain('git switch');
    }
  });

  it('works for a tiny pool', () => {
    const items: ReviewItem[] = [
      { id: 'a', kind: 'command', world: 0, order: 0, needs: ['l'], label: 'pwd', text: 'Shows where you are.' },
      { id: 'b', kind: 'command', world: 0, order: 1, needs: ['l'], label: 'ls', text: 'Lists files.' },
    ];
    const q = buildQuestion(cardsFor(items)[0]!, items, 's');
    expect(q.options.sort()).toEqual(['ls', 'pwd']);
  });
});
