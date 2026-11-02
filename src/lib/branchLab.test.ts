// Pure logic of the World 3 interactives: UniverseSplitter, ConflictResolver, RebaseDeck.
import { describe, expect, it } from 'vitest';
import { buildScenario, checkGoal, conflictInfo, rebaseInteractive, rebaseTodo, resolveConflict, run, type SimState } from '~/engine/git-sim';
import { getScenario } from '~/content/courses/git/scenarios';
import {
  applyChoices,
  checkResolved,
  conflictCount,
  hasMarkers,
  normalizeExpect,
  parseConflicts,
  solveWithQuickChoices,
} from './conflictResolver';
import { deckFromTodo, deckProblem, failedCommitChecks, feedbackFor, moveCard, setAction, setMessage, toSteps } from './rebaseDeck';
import { createCommand, currentBranch, filesIn, laneTarget, taskDone, universes } from './universe';

const sc = (id: string) => buildScenario(getScenario(id));
const exec = (s: SimState, ...cmds: string[]) => cmds.reduce((st, c) => run(st, c).state, s);

describe('conflictResolver', () => {
  const merged = exec(sc('w03-l06'), 'git merge cake');
  const file = conflictInfo(merged)!.files[0]!;

  it('parses Git markers into text and conflict blocks', () => {
    const p = parseConflicts(file.merged!);
    expect(conflictCount(p)).toBe(1);
    expect(p.endsWithNewline).toBe(true);
    const c = p.segments.find((s) => s.kind === 'conflict')!;
    expect(c).toMatchObject({ ours: ['<p>Day 2: I learned branches.</p>'], theirs: ['<p>Day 2: I baked a cake.</p>'], oursLabel: 'HEAD', theirsLabel: 'cake', base: null });
    expect(c.kind === 'conflict' && c.raw).toHaveLength(5);
    // Untouched: no choice keeps the markers.
    expect(applyChoices(p, [null])).toBe(file.merged);
  });

  it('applies yours / theirs / both / edit', () => {
    const p = parseConflicts(file.merged!);
    expect(applyChoices(p, ['ours'])).toBe(file.ours);
    expect(applyChoices(p, ['theirs'])).toBe(file.theirs);
    expect(applyChoices(p, ['both'])).toContain('branches.</p>\n<p>Day 2: I baked');
    expect(applyChoices(p, [{ edit: '<p>Both!</p>\n' }])).toBe('<h1>My Diary</h1>\n<p>Day 1: I learned Git.</p>\n<p>Both!</p>\n');
  });

  it('spots markers, checks expect / avoid, and solves with quick choices', () => {
    expect(hasMarkers(file.merged!)).toBe(true);
    expect(hasMarkers('a ======= b\n<<<<<<<< not eight\n')).toBe(false);
    expect(checkResolved(file.merged!, [], []).markers).toBe(true);
    const both = applyChoices(parseConflicts(file.merged!), ['both']);
    expect(checkResolved(both, ['baked a cake', 'learned branches']).ok).toBe(true);
    expect(checkResolved(both, ['nope'], ['cake'])).toMatchObject({ ok: false, missing: ['nope'], unwanted: ['cake'] });
    expect(solveWithQuickChoices(parseConflicts(file.merged!), ['cake', 'branches'])).toEqual(['both']);
    expect(solveWithQuickChoices(parseConflicts(file.merged!), ['zebra'])).toBeNull();
  });

  it('handles several blocks and a diff3 base section', () => {
    const text = 'a\n<<<<<<< HEAD\nb\n||||||| base\nx\n=======\nc\n>>>>>>> topic\nd\n<<<<<<< HEAD\ne\n=======\nf\n>>>>>>> topic\n';
    const p = parseConflicts(text);
    expect(conflictCount(p)).toBe(2);
    expect(p.segments[1]).toMatchObject({ kind: 'conflict', base: ['x'], ours: ['b'], theirs: ['c'] });
    expect(applyChoices(p, ['theirs', 'ours'])).toBe('a\nc\nd\ne\n');
    // A block without its end marker stays plain text.
    expect(conflictCount(parseConflicts('<<<<<<< HEAD\nb\n=======\n'))).toBe(0);
  });

  it('normalizes expect for one file or many', () => {
    expect(normalizeExpect('x', 'index.html')).toEqual({ 'index.html': ['x'] });
    expect(normalizeExpect(['x', 'y'], 'index.html')).toEqual({ 'index.html': ['x', 'y'] });
    expect(normalizeExpect({ 'a.txt': 'x', 'b.txt': ['y'] }, 'index.html')).toEqual({ 'a.txt': ['x'], 'b.txt': ['y'] });
    expect(normalizeExpect(undefined, 'index.html')).toEqual({});
  });

  it('the boss: three conflicts in two files, solved with yours / both / theirs', () => {
    const boss = exec(sc('w03-boss-merge'), 'git merge party');
    const info = conflictInfo(boss)!;
    expect(info.files.map((f) => f.path)).toEqual(['index.html', 'style.css']);
    const index = parseConflicts(info.files[0]!.merged!);
    expect(conflictCount(index) + conflictCount(parseConflicts(info.files[1]!.merged!))).toBe(3);
    expect(solveWithQuickChoices(index, ['My Git Diary', 'I fixed conflicts', 'Party time'], ['Party Diary'])).toEqual(['ours', 'both']);
    // Applied with the engine, the merge can be finished.
    let s = resolveConflict(boss, 'index.html', applyChoices(index, ['ours', 'both'])).state;
    s = resolveConflict(s, 'style.css', info.files[1]!.theirs).state;
    const done = run(s, 'git commit --no-edit');
    expect(done.ok).toBe(true);
    expect(checkGoal(done.state, { mergeCommit: true, noConflicts: true, fileContains: { 'style.css': 'hotpink' } }).ok).toBe(true);
  });
});

describe('rebaseDeck', () => {
  const start = sc('w03-l11b');
  const deck = deckFromTodo(rebaseTodo(start, 'main'));

  it('starts from the todo list, oldest first, all pick', () => {
    expect(deck.map((c) => c.message)).toEqual(['Add gallery page', 'Add photo captions', 'fix typo', 'debug log']);
    expect(deck.every((c) => c.action === 'pick')).toBe(true);
    expect(deckProblem(deck, deck)).toEqual({ kind: 'unchanged' });
  });

  it('moves cards, sets actions and messages', () => {
    const moved = moveCard(deck, 2, -1);
    expect(moved.map((c) => c.message)).toEqual(['Add gallery page', 'fix typo', 'Add photo captions', 'debug log']);
    expect(moveCard(deck, 0, -1)).toBe(deck);
    const reworded = setAction(deck, 1, 'reword');
    expect(reworded[1]).toMatchObject({ action: 'reword', newMessage: 'Add photo captions' });
    expect(toSteps(setMessage(reworded, 1, '  ')).at(1)).toMatchObject({ action: 'reword', message: 'Add photo captions' });
    expect(toSteps(setMessage(setAction(deck, 1, 'squash'), 1, 'Joined')).at(1)).toMatchObject({ action: 'squash', message: 'Joined' });
    expect(toSteps(setAction(deck, 1, 'squash')).at(1)).toEqual({ action: 'squash', commit: deck[1]!.commit });
  });

  it('explains problems before running', () => {
    expect(deckProblem(setAction(deck, 0, 'fixup'), deck)).toEqual({ kind: 'squashFirst', index: 0, action: 'fixup' });
    expect(deckProblem(setAction(setAction(deck, 0, 'drop'), 1, 'squash'), deck)).toMatchObject({ kind: 'squashFirst', index: 1 });
    expect(deckProblem(deck.map((c) => ({ ...c, action: 'drop' as const })), deck)).toEqual({ kind: 'allDropped' });
    expect(deckProblem(setAction(deck, 3, 'drop'), deck)).toBeNull();
  });

  it('the full tidy: move + fixup, drop; checked with goals and commit-file checks', () => {
    let d = moveCard(deck, 2, -1);
    d = setAction(d, 1, 'fixup');
    d = setAction(d, 3, 'drop');
    const r = rebaseInteractive(start, 'main', toSteps(d));
    expect(r.ok).toBe(true);
    expect(checkGoal(r.state, { messages: ['^Add photo captions$', '^Add gallery page$', '^Add style$'], commits: 5, filesMissing: ['debug.txt'] }).ok).toBe(true);
    expect(failedCommitChecks(r.state, [{ message: '^Add gallery page$', file: 'gallery.html', contains: 'My Gallery' }])).toEqual([]);
    // Fixup without moving folds the fix into the captions commit instead.
    const lazy = rebaseInteractive(start, 'main', toSteps(setAction(setAction(deck, 2, 'fixup'), 3, 'drop')));
    expect(failedCommitChecks(lazy.state, [{ message: '^Add gallery page$', file: 'gallery.html', contains: 'My Gallery' }])).toEqual([0]);
  });

  it('turns failed goal checks into kind feedback keys', () => {
    expect(feedbackFor(['commits', 'messages'], { commits: 5, got: 6 })).toEqual({ key: 'rebase.fb.tooMany', params: { want: 5, got: 6 } });
    expect(feedbackFor(['commits'], { commits: 5, got: 4 }).key).toBe('rebase.fb.tooFew');
    expect(feedbackFor(['messages'], { got: 5 }).key).toBe('rebase.fb.messages');
    expect(feedbackFor(['filesMissing'], { got: 5 }).key).toBe('rebase.fb.filesMissing');
    expect(feedbackFor(['commitFile:0'], { got: 5 }).key).toBe('rebase.fb.commitFiles');
    expect(feedbackFor(['branches'], { got: 5 }).key).toBe('rebase.fb.other');
  });
});

describe('universe', () => {
  const split = sc('w03-l02-split');

  it('lists universes (branches) with their lanes', () => {
    const us = universes(split);
    expect(us.map((u) => [u.branch, u.lane, u.current])).toEqual([
      ['main', 0, true],
      ['about', 1, false],
    ]);
    expect(laneTarget(us, 1)).toBe('about');
    expect(laneTarget(us, 0)).toBeNull();
    expect(laneTarget(us, 7)).toBeNull();
  });

  it('switching changes the files you see', () => {
    expect(Object.keys(filesIn(split))).not.toContain('about.html');
    const there = run(split, 'git switch about').state;
    expect(currentBranch(there)).toBe('about');
    expect(Object.keys(filesIn(there))).toContain('about.html');
    expect(filesIn(there)['index.html']).not.toContain('Day 2');
  });

  it('checks tasks', () => {
    const there = run(split, 'git switch about').state;
    expect(taskDone({ type: 'visitAll' }, split, new Set(['main']), ['main', 'about'])).toBe(false);
    expect(taskDone({ type: 'visitAll' }, there, new Set(['main', 'about']), ['main', 'about'])).toBe(true);
    expect(taskDone({ type: 'switch', branch: 'about' }, there, new Set(), [])).toBe(true);
    const base = sc('w03-l01');
    const made = run(base, createCommand('idea', 'HEAD~1', false));
    expect(made.ok).toBe(true);
    expect(taskDone({ type: 'create', at: '^Add day 1 page$', name: 'idea' }, made.state, new Set(), ['main'])).toBe(true);
    expect(taskDone({ type: 'create', at: '^Add day 1 page$' }, made.state, new Set(), ['main'])).toBe(true);
    expect(taskDone({ type: 'create', at: '^Add style$' }, made.state, new Set(), ['main'])).toBe(false);
    expect(taskDone({ type: 'create', at: '^Add day 1 page$', name: 'idea', switch: true }, made.state, new Set(), ['main'])).toBe(false);
  });

  it('quotes odd branch names so Git can explain them', () => {
    expect(createCommand('feature/x', 'a1b2c3d', true)).toBe('git switch -c feature/x a1b2c3d');
    expect(createCommand('my idea', 'a1b2c3d', false)).toBe('git branch "my idea" a1b2c3d');
    expect(run(sc('w03-l01'), createCommand('my idea', 'HEAD', false)).ok).toBe(false);
  });
});
