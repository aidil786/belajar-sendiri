import { describe, expect, it } from 'vitest';
import { earnedBadges } from '~/lib/badges';
import { $progress, SCHEMA_VERSION, dayKey, emptyProgress, learnedLessons, migrate, recordReview, shouldNudge, streakInfo, tickTime } from './progress';

const d = (s: string) => new Date(`${s}T12:00:00`);

describe('gentle streak', () => {
  it('counts learning days in a row', () => {
    expect(streakInfo(['2026-10-28', '2026-10-29', '2026-10-30'], d('2026-10-30')).learningDays).toBe(3);
  });

  it("today not learned yet doesn't break it", () => {
    expect(streakInfo(['2026-10-28', '2026-10-29'], d('2026-10-30')).learningDays).toBe(2);
  });

  it('up to 2 missed days a week are free rest days', () => {
    // Mon 26, Tue 27 (rest), Wed 28 (rest), Thu 29, Fri 30
    const info = streakInfo(['2026-10-26', '2026-10-29', '2026-10-30'], d('2026-10-30'));
    expect(info.learningDays).toBe(3);
    expect(info.restLeft).toBe(0);
  });

  it('a long gap starts fresh and says welcome back (never "you lost")', () => {
    const info = streakInfo(['2026-10-01', '2026-10-02'], d('2026-10-30'));
    expect(info.learningDays).toBe(0);
    expect(info.welcomeBack).toBe(true);
  });

  it('no days yet', () => {
    expect(streakInfo([], d('2026-10-30'))).toEqual({ learningDays: 0, restLeft: 2, welcomeBack: false });
  });
});

describe('progress helpers', () => {
  it('migrate fills missing fields and keeps settings', () => {
    const p = migrate({ xp: 40, settings: { calm: true } });
    expect(p.xp).toBe(40);
    expect(p.settings.calm).toBe(true);
    expect(p.settings.font).toBe('atkinson');
    expect(p.completed).toEqual([]);
    expect(migrate('garbage').v).toBe(SCHEMA_VERSION);
  });

  it('migrate v1 → v2 adds empty review cards and keeps everything else', () => {
    const v1 = { v: 1, xp: 120, completed: ['git-w01-l03'], known: ['git-w00-l01'], settings: { lang: 'ms' } };
    const p = migrate(v1);
    expect(p.v).toBe(2);
    expect(p.review).toEqual({ cards: {} });
    expect(p.xp).toBe(120);
    expect(p.completed).toEqual(['git-w01-l03']);
    expect(p.settings.lang).toBe('ms');
    expect(learnedLessons(p).sort()).toEqual(['git-w00-l01', 'git-w01-l03']);
  });

  it('migrate v2 keeps good review cards and drops broken ones', () => {
    const p = migrate({
      v: 2,
      review: {
        cards: {
          'term:commit': { box: 3, due: '2026-11-03', last: '2026-10-30' },
          'cmd:add': { box: 9, due: '2026-11-03', last: '2026-10-30' },
          broken: { box: 'x', due: 'soon' },
          gone: null,
        },
      },
    });
    expect(p.review.cards).toEqual({
      'term:commit': { box: 3, due: '2026-11-03', last: '2026-10-30' },
      'cmd:add': { box: 6, due: '2026-11-03', last: '2026-10-30' },
    });
    expect(migrate({ v: 2 }).review).toEqual({ cards: {} });
  });

  it('recordReview saves the box and counts as a learning day', () => {
    $progress.set(emptyProgress());
    const now = new Date('2026-10-30T10:00:00').getTime();
    recordReview('term:commit', true, now);
    let p = $progress.get();
    expect(p.review.cards['term:commit']).toEqual({ box: 1, due: '2026-10-31', last: '2026-10-30' });
    expect(p.days).toEqual(['2026-10-30']);
    recordReview('term:commit', true, new Date('2026-10-31T09:00:00').getTime());
    recordReview('term:commit', false, new Date('2026-11-02T09:00:00').getTime());
    p = $progress.get();
    expect(p.review.cards['term:commit']).toEqual({ box: 1, due: '2026-11-03', last: '2026-11-02' });
  });

  it('migrate adds GitHub mission settings to old saves and cleans bad ones', () => {
    expect(migrate({ settings: { calm: true } }).settings.github).toEqual({ user: '', repos: {} });
    expect(migrate({ settings: { github: { user: 'aina', repos: { diary: 'my-diary' } } } }).settings.github).toEqual({ user: 'aina', repos: { diary: 'my-diary' } });
    expect(migrate({ settings: { github: { user: 42, repos: ['x'] } } }).settings.github).toEqual({ user: '', repos: {} });
    expect(migrate({ settings: { github: { user: 'a', repos: { ok: 'x', bad: 3 } } } }).settings.github.repos).toEqual({ ok: 'x' });
    expect(emptyProgress().settings.github).not.toBe(emptyProgress().settings.github);
  });

  it('tickTime adds minutes and records the day; long gaps start a new session', () => {
    const t0 = new Date('2026-10-30T10:00:00').getTime();
    let p = tickTime(emptyProgress(), t0);
    p = tickTime(p, t0 + 60_000);
    p = tickTime(p, t0 + 120_000);
    expect(p.minutes[dayKey(new Date(t0))]).toBe(2);
    expect(p.days).toEqual([dayKey(new Date(t0))]);
    p = tickTime(p, t0 + 60 * 60_000);
    expect(p.session.start).toBe(t0 + 60 * 60_000);
  });

  it('break nudge after ~25 minutes of continuous use, then snoozes', () => {
    const p = emptyProgress();
    const start = 1_000_000;
    p.session = { start, last: start + 24 * 60_000, nudgedAt: null };
    expect(shouldNudge(p, start + 24 * 60_000)).toBe(false);
    p.session.last = start + 25 * 60_000;
    expect(shouldNudge(p, start + 25 * 60_000)).toBe(true);
    p.session.nudgedAt = start + 25 * 60_000;
    expect(shouldNudge(p, start + 30 * 60_000)).toBe(false);
  });

  it('badges come from finishing lessons, never from time', () => {
    const rules = [
      { id: 'first-commit', lessons: ['git-w01-l05'] },
      { id: 'world-0', lessons: ['a', 'b'] },
    ];
    expect(earnedBadges(rules, ['git-w01-l05', 'a'])).toEqual(['first-commit']);
    expect(earnedBadges(rules, ['a', 'b'])).toEqual(['world-0']);
  });
});
