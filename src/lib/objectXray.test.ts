import { describe, expect, it } from 'vitest';
import { buildScenario, findRepo, plain, run } from '~/engine/git-sim';
import { getScenario } from '~/content/courses/git/scenarios';
import { xrayCommits, xrayRoute, xrayStart, xrayTarget, xrayView, xrayWrongTurn } from './objectXray';

const state = () => buildScenario(getScenario('w10-objects'));

describe('Object X-ray helpers', () => {
  it('lists HEAD history, newest first, with HEAD marked', () => {
    const list = xrayCommits(state());
    expect(list.map((c) => c.message)).toEqual(['Add opening hours', 'Add about page', 'Add shop page']);
    expect(list[0]!.head).toBe(true);
    expect(list[0]!.short).toHaveLength(7);
  });

  it('a commit view is git cat-file -p, with the tree and parent ids openable', () => {
    const s = state();
    const head = findRepo(s)!.branches.main!;
    const v = xrayView(s, head)!;
    expect(v.type).toBe('commit');
    const text = v.lines.map((l) => `${l.text}${l.ref?.id ?? ''}${l.after ?? ''}`).join('\n');
    expect(text).toBe(plain(run(s, 'git cat-file -p HEAD').output));
    expect(v.lines[0]!.ref?.type).toBe('tree');
    expect(v.lines[1]!.ref?.type).toBe('commit');
    expect(v.size).toBe(Number(plain(run(s, 'git cat-file -s HEAD').output)));
  });

  it('a tree view lists entries like ls-tree; blobs show the file', () => {
    const s = state();
    const tree = xrayTarget(s, { type: 'findTree' })!;
    const v = xrayView(s, tree)!;
    expect(v.lines.map((l) => `${l.text}${l.ref!.id}${l.after}`).join('\n')).toBe(plain(run(s, 'git ls-tree HEAD').output));
    const blob = xrayView(s, xrayTarget(s, { type: 'findBlob', path: 'css/style.css' })!)!;
    expect(blob.type).toBe('blob');
    expect(blob.lines.map((l) => l.text)).toEqual(['h1 { color: green; }']);
  });

  it('targets, start and route for tasks', () => {
    const s = state();
    const route = xrayRoute(s, { type: 'findBlob', path: 'css/style.css' });
    expect(route.map((r) => r.name).slice(1)).toEqual(['tree', 'css', 'style.css']);
    expect(route[0]!.id).toBe(xrayStart(s));
    expect(route.at(-1)!.id).toBe(xrayTarget(s, { type: 'findBlob', path: 'css/style.css' }));
    const parent = xrayTarget(s, { type: 'findParent' })!;
    expect(xrayView(s, parent)!.lines.at(-1)!.text).toBe('Add about page');
    expect(xrayTarget(s, { type: 'findBlob', path: 'nope.txt' })).toBeNull();
    expect(xrayTarget(s, { type: 'findBlob', path: 'css' })).toBeNull();
  });

  it('wrong turns are other blobs (or other commits for findParent)', () => {
    const task = { type: 'findBlob', path: 'index.html' } as const;
    expect(xrayWrongTurn(task, { id: 'a', type: 'blob' }, 'b')).toBe(true);
    expect(xrayWrongTurn(task, { id: 'a', type: 'tree' }, 'b')).toBe(false);
    expect(xrayWrongTurn(task, { id: 'b', type: 'blob' }, 'b')).toBe(false);
    expect(xrayWrongTurn({ type: 'findParent' }, { id: 'a', type: 'commit' }, 'b')).toBe(true);
  });
});
