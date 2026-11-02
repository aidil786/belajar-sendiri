// Author checks for UniverseSplitter, ConflictResolver and RebaseDeck props.
import { describe, expect, it } from 'vitest';
import { checkBranchInteractive } from './branch-interactives';

const check = (name: string, a: Record<string, unknown>) => checkBranchInteractive(name, a, 'x.mdx:1');

describe('World 3 interactive checks', () => {
  it('UniverseSplitter tasks', () => {
    expect(check('UniverseSplitter', { scenario: 'w03-l02-split', task: { type: 'visitAll' } })).toEqual([]);
    expect(check('UniverseSplitter', { scenario: 'w03-l01', task: { type: 'visitAll' } })[0]).toMatch(/at least two branches/);
    expect(check('UniverseSplitter', { scenario: 'w03-l02-split', task: { type: 'switch', branch: 'main' } })[0]).toMatch(/already on "main"/);
    expect(check('UniverseSplitter', { scenario: 'w03-l02-split', task: { type: 'switch', branch: 'nope' } })[0]).toMatch(/does not exist/);
    expect(check('UniverseSplitter', { scenario: 'w03-l01', task: { type: 'create', at: '^Add day 1 page$', name: 'idea' } })).toEqual([]);
    expect(check('UniverseSplitter', { scenario: 'w03-l01', task: { type: 'create', at: '^Nope$' } })[0]).toMatch(/no commit matches/);
    expect(check('UniverseSplitter', { scenario: 'w03-l01', task: { type: 'create', at: '(' } })[0]).toMatch(/not a valid regex/);
    expect(check('UniverseSplitter', { scenario: 'w03-l01', commands: ['git merge nope'], task: { type: 'visitAll' } })[0]).toMatch(/command fails/);
  });

  it('ConflictResolver needs a conflict and a reachable answer', () => {
    const base = { scenario: 'w03-l06', commands: ['git merge cake'] };
    expect(check('ConflictResolver', { ...base, expect: ['branches', 'cake'] })).toEqual([]);
    expect(check('ConflictResolver', { scenario: 'w03-l06' })[0]).toMatch(/no conflict to fix/);
    expect(check('ConflictResolver', { ...base, expect: 'zebra' })[0]).toMatch(/no mix of yours \/ theirs \/ both/);
    expect(check('ConflictResolver', { ...base, expect: { 'nope.txt': 'x' } })[0]).toMatch(/not a conflicted file/);
    expect(check('ConflictResolver', { ...base, file: 'nope.txt' })[0]).toMatch(/has no conflict/);
    expect(check('ConflictResolver', { ...base, finish: ['git rebase --continue'] })[0]).toMatch(/finish command fails/);
  });

  it('RebaseDeck needs an upstream with commits to replay', () => {
    expect(check('RebaseDeck', { scenario: 'w03-l11b', upstream: 'main' })).toEqual([]);
    expect(check('RebaseDeck', { scenario: 'w03-l11b', upstream: 'nope' })[0]).toMatch(/does not exist/);
    expect(check('RebaseDeck', { scenario: 'w03-l11b', upstream: 'HEAD' })[0]).toMatch(/no commits to replay/);
    expect(check('RebaseDeck', { scenario: 'w03-l11b', upstream: 'main', commitFiles: [{ message: '(', file: '' }] })).toHaveLength(2);
  });
});
