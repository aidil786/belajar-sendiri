import { describe, expect, it } from 'vitest';
import { safeJson } from './safe-json';

describe('safeJson', () => {
  it('never lets data close the script block, and parses back to the same value', () => {
    const data = { title: '</script><script>alert(1)</script>', line: 'a b' };
    const out = safeJson(data);
    expect(out).not.toContain('<');
    expect(out).not.toContain(' ');
    expect(JSON.parse(out)).toEqual(data);
  });
});
