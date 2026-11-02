import { describe, expect, it } from 'vitest';
import { checkPlaygroundProps, evaluate, getPath, goalMet, kindOf, problemText, toTree, type YamlExpect } from './yamlPlayground';

describe('yamlPlayground', () => {
  it('reads keys, lists and nesting into a tree', () => {
    const r = evaluate('dish: nasi lemak\nprice: 5\nspicy: true\nsides:\n  - sambal\n  - egg\n');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual({ dish: 'nasi lemak', price: 5, spicy: true, sides: ['sambal', 'egg'] });
    const tree = toTree(r.value);
    expect(tree.kind).toBe('map');
    expect(tree.children?.map((c) => [c.key, c.kind])).toEqual([
      ['dish', 'text'],
      ['price', 'number'],
      ['spicy', 'bool'],
      ['sides', 'list'],
    ]);
    expect(tree.children?.[3]?.children?.map((c) => [c.index, c.text])).toEqual([
      [0, 'sambal'],
      [1, 'egg'],
    ]);
  });

  it('knows the kinds', () => {
    expect(kindOf(null)).toBe('null');
    expect(kindOf([])).toBe('list');
    expect(kindOf({})).toBe('map');
    expect(kindOf(3)).toBe('number');
    expect(kindOf(false)).toBe('bool');
    expect(kindOf('x')).toBe('text');
  });

  it('follows dotted paths through maps and lists', () => {
    const v = { tiffin: { top: 'rice', bottom: ['egg', 'cucumber'] } };
    expect(getPath(v, 'tiffin.top')).toEqual({ found: true, value: 'rice' });
    expect(getPath(v, 'tiffin.bottom.1')).toEqual({ found: true, value: 'cucumber' });
    expect(getPath(v, 'tiffin.bottom.2').found).toBe(false);
    expect(getPath(v, 'top').found).toBe(false);
    expect(getPath(v, '').value).toBe(v);
  });

  it('gives go-yaml words for the usual traps', () => {
    const tab = evaluate('dish: nasi lemak\nsides:\n\t- sambal\n');
    expect(tab.ok).toBe(false);
    if (!tab.ok) {
      expect(tab.problem.code).toBe('tab');
      expect(problemText(tab.problem)).toBe('yaml: line 3: found character that cannot start any token');
    }
    const indent = evaluate('tiffin:\n  top: rice\n middle: curry\n');
    expect(!indent.ok && indent.problem.code).toBe('indentKey');
    const dash = evaluate('sides:\n  - sambal\n  egg\n');
    expect(!dash.ok && dash.problem.code).toBe('indentDash');
    const colon = evaluate('title: Nasi lemak: the best\n');
    expect(!colon.ok && colon.problem.code).toBe('colonInValue');
  });

  it('shows the YAML 1.1 surprises (yes is true, a leading zero is lost)', () => {
    const r = evaluate('spicy: yes\nphone: 0123456789\nquoted: "0123456789"\n');
    expect(r.ok && r.value).toEqual({ spicy: true, phone: 123456789, quoted: '0123456789' });
  });

  it('checks expectations', () => {
    const exp: YamlExpect[] = [
      { path: 'sides', type: 'list', count: 3, includes: 'cucumber' },
      { path: 'dish', equals: 'nasi lemak' },
    ];
    expect(goalMet('dish: nasi lemak\nsides:\n  - sambal\n  - egg\n', exp)).toBe(false);
    expect(goalMet('dish: nasi lemak\nsides:\n  - sambal\n  - egg\n  - cucumber\n', exp)).toBe(true);
    expect(goalMet('dish: nasi lemak\nsides: [sambal, egg, cucumber]\n', exp)).toBe(true);
    // A parse error is never done.
    expect(goalMet('dish: nasi lemak\nsides:\n\t- sambal\n', exp)).toBe(false);
    // equals compares as text; type tells "5" and 5 apart.
    expect(goalMet('price: "5"\n', [{ path: 'price', equals: 5 }])).toBe(true);
    expect(goalMet('price: "5"\n', [{ path: 'price', type: 'number' }])).toBe(false);
    // count works for maps too.
    expect(goalMet('tiffin:\n  top: rice\n  middle: curry\n', [{ path: 'tiffin', type: 'map', count: 2 }])).toBe(true);
    // No expectations: never "done" (free play).
    expect(goalMet('a: 1\n', [])).toBe(false);
  });

  it('reports the failed expectations in order', () => {
    const r = evaluate('dish: laksa\n', [{ path: 'dish', equals: 'nasi lemak', hint: 'Change the dish.' }, { path: 'sides', type: 'list' }]);
    expect(r.ok && r.failed.map((f) => f.path)).toEqual(['dish', 'sides']);
  });

  it('validates MDX props', () => {
    const expect1: YamlExpect[] = [{ path: 'sides', type: 'list', count: 3 }];
    expect(checkPlaygroundProps({ initial: 'sides:\n  - a\n  - b\n', expect: expect1, solution: 'sides:\n  - a\n  - b\n  - c\n' })).toEqual([]);
    expect(checkPlaygroundProps({ initial: 'sides:\n  - a\n  - b\n  - c\n', expect: expect1, solution: 'sides: [a, b, c]\n' }).join()).toMatch(/already done/);
    expect(checkPlaygroundProps({ initial: 'x: 1\n', expect: expect1, solution: 'sides: [a]\n' }).join()).toMatch(/does not meet/);
    expect(checkPlaygroundProps({ initial: 'x: 1\n', expect: expect1 }).join()).toMatch(/needs a "solution"/);
    expect(checkPlaygroundProps({ initial: 'x: 1\n' })).toEqual([]);
  });
});
