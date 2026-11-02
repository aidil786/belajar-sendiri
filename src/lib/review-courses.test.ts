// Daily review across every course, from the real content files: Ship It words and commands
// (docker, cicd, kubernetes) join the deck with a course prefix and never clash with Git's.
// Mirrors getReviewPool in content.ts (which needs Astro), using the same pure helpers.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { sortCourses } from './catalog';
import { buildPool, cardsFor, mergeCoursePools, type PoolInput, type ReviewItem } from './review';

const root = new URL('../content/', import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), 'utf8');

interface Item {
  id: string;
  slug: string;
  status: string;
}
interface Outline {
  id: string;
  family?: string;
  part?: number;
  worlds: { id: number; dir: string; lessons: Item[]; boss?: { id: string; status: string } }[];
}

const outlines = sortCourses(
  ['git', 'docker', 'cicd', 'kubernetes'].map((id) => ({ ...(parse(read(`courses/${id}/course.yaml`)) as Omit<Outline, 'id'>), id })),
);
const pad = (n: number) => String(n).padStart(2, '0');

/** Ready lessons with both language files, in course order, with the English body (like readyLessons()). */
function readyLessons(c: Outline): PoolInput['lessons'] {
  const out: PoolInput['lessons'] = [];
  for (const w of c.worlds) {
    const items = [...w.lessons.map((l, i) => ({ id: l.id, status: l.status, dir: `${w.dir}/${pad(i + 1)}-${l.slug}` }))];
    if (w.boss && w.boss.status !== 'none') items.push({ id: w.boss.id, status: w.boss.status, dir: `${w.dir}/boss` });
    for (const x of items) {
      const en = `courses/${c.id}/${x.dir}/en.mdx`;
      if (x.status !== 'ready' || !existsSync(new URL(en, root)) || !existsSync(new URL(`courses/${c.id}/${x.dir}/ms.mdx`, root))) continue;
      out.push({ id: x.id, world: w.id, text: read(en).replace(/^---[\s\S]*?\n---\n/, '') });
    }
  }
  return out;
}

function pool(lang: 'en' | 'ms'): { merged: ReviewItem[]; lessons: Record<string, Set<string>> } {
  const lessons: Record<string, Set<string>> = {};
  const pools = outlines.map((c) => {
    const ls = readyLessons(c);
    lessons[c.id] = new Set(ls.map((l) => l.id));
    if (!ls.length) return { courseId: c.id, items: [] };
    const { terms } = parse(read(`glossary/${c.id}.yaml`)) as { terms: PoolInput['terms'] };
    const { commands } = parse(read(`courses/${c.id}/commands.yaml`)) as { commands: PoolInput['commands'] };
    return { courseId: c.id, items: buildPool({ lang, lessons: ls, terms, commands }) };
  });
  return { merged: mergeCoursePools(pools), lessons };
}

describe('daily review across courses (real content)', () => {
  const { merged, lessons } = pool('en');
  const shipIt = ['docker', 'cicd', 'kubernetes'];

  it('Git comes first and keeps its ids; Ship It parts follow in order', () => {
    expect(outlines.map((c) => c.id)).toEqual(['git', 'docker', 'cicd', 'kubernetes']);
    expect(merged.some((x) => !x.id.includes(':'))).toBe(true);
  });

  it('every Ship It part with ready lessons adds prefixed words or commands', () => {
    for (const id of shipIt) {
      const items = merged.filter((x) => x.id.startsWith(`${id}:`));
      if (lessons[id]!.size === 0) continue;
      if (id !== 'kubernetes') expect(items.length, id).toBeGreaterThan(0);
      for (const x of items) {
        expect(x.world).toBeGreaterThanOrEqual(1000);
        for (const n of x.needs) expect(lessons[id]!.has(n), `${x.id} needs ${n}`).toBe(true);
        for (const a of x.avoid ?? []) expect(a.startsWith(`${id}:`), `${x.id} avoids ${a}`).toBe(true);
      }
    }
    expect(merged.filter((x) => x.id.startsWith('docker:') && x.kind === 'command').length).toBeGreaterThan(0);
    expect(merged.filter((x) => x.id.startsWith('docker:') && x.kind === 'term').length).toBeGreaterThan(0);
    expect(merged.filter((x) => x.id.startsWith('cicd:')).length).toBeGreaterThan(0);
  });

  it('ids are unique per kind (cards are term:… / cmd:…), worlds of different courses never mix, and order follows the courses', () => {
    const ids = merged.map((x) => `${x.kind}:${x.id}`);
    expect(new Set(ids).size).toBe(ids.length);
    const cardIds = cardsFor(merged).map((c) => c.id);
    expect(new Set(cardIds).size).toBe(cardIds.length);
    const courseOf = (x: ReviewItem) => (x.id.includes(':') ? x.id.split(':')[0]! : 'git');
    for (const x of merged) expect(Math.floor(x.world / 1000)).toBe(outlines.findIndex((c) => c.id === courseOf(x)));
    const firstShip = merged.findIndex((x) => x.id.includes(':'));
    expect(merged.slice(firstShip).every((x) => x.id.includes(':'))).toBe(true);
  });

  it('cards build for the whole deck; Malay has the same cards', () => {
    const cards = cardsFor(merged);
    expect(cards.length).toBeGreaterThan(merged.length - 1);
    const ms = pool('ms').merged;
    expect(ms.map((x) => x.id)).toEqual(merged.map((x) => x.id));
    expect(ms.find((x) => x.id.startsWith('docker:'))!.text).not.toBe(merged.find((x) => x.id.startsWith('docker:'))!.text);
  });
});
