// Course accents (--course-*) carry white text on the Level Up and Ship It overviews and the home
// catalog: each must pass WCAG AA (4.5:1) with white. Every course in the catalog has one.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');
const rootBlock = css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {')));

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

const accents = Object.fromEntries([...rootBlock.matchAll(/--course-([\w-]+):\s*(#[0-9a-f]{6});/gi)].map((m) => [m[1]!, m[2]!]));
const courseIds = readdirSync(new URL('../content/courses/', import.meta.url), { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(new URL(`../content/courses/${d.name}/course.yaml`, import.meta.url)))
  .map((d) => d.name);

describe('course accent tokens', () => {
  it('the contrast helper matches known values', () => {
    expect(contrast('#ffffff', '#000000')).toBeCloseTo(21, 5);
    expect(contrast('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
  });

  it('every course has an accent', () => {
    for (const id of courseIds) expect(accents[id], `--course-${id}`).toMatch(/^#[0-9a-f]{6}$/i);
    expect(Object.keys(accents)).toEqual(expect.arrayContaining(['linux', 'iac', 'observability', 'aws']));
  });

  it.each(Object.entries(accents))('white text on --course-%s passes AA (4.5:1)', (_id, hex) => {
    expect(contrast(hex, '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });
});
