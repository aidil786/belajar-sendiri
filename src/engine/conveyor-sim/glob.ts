// GitHub Actions filter patterns (branches, tags, paths).
// https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#filter-pattern-cheat-sheet
//   *   zero or more characters, but not /
//   **  zero or more of any character
//   ?   zero or one of the preceding character
//   +   one or more of the preceding character
//   []  one character from the set or range
//   !   at the start: a negative pattern (only in lists that allow it)

const cache = new Map<string, RegExp>();

export function globToRegExp(pattern: string): RegExp {
  const hit = cache.get(pattern);
  if (hit) return hit;
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]!;
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        re += '.*';
        i++;
      } else re += '[^/]*';
    } else if (ch === '?' || ch === '+') re += ch;
    else if (ch === '[') {
      const close = pattern.indexOf(']', i + 1);
      if (close === -1) re += '\\[';
      else {
        re += `[${pattern.slice(i + 1, close).replace(/\\/g, '\\\\')}]`;
        i = close;
      }
    } else re += ch.replace(/[.^$|(){}\\/]/g, '\\$&');
  }
  const out = new RegExp(`^${re}$`);
  cache.set(pattern, out);
  return out;
}

export function globMatch(pattern: string, value: string): boolean {
  return globToRegExp(pattern).test(value);
}

/** Patterns in order; a later `!pattern` removes a match, a later plain pattern adds it back. */
export function matchList(patterns: string[], value: string): boolean {
  let matched = false;
  for (const p of patterns) {
    if (p.startsWith('!')) {
      if (globMatch(p.slice(1), value)) matched = false;
    } else if (globMatch(p, value)) matched = true;
  }
  return matched;
}
