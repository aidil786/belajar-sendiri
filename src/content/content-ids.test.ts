// Shared content files are edited by many lessons. Ids must stay unique — per file, and across
// courses wherever they share one page or one saved progress (lessons, badges, rescue flows).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const load = (path: string) => parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const dupes = (ids: string[]) => ids.filter((id, i) => ids.indexOf(id) !== i);

const courseIds = readdirSync(new URL('./courses/', import.meta.url), { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(new URL(`./courses/${d.name}/course.yaml`, import.meta.url)))
  .map((d) => d.name)
  .sort();
const glossaries = readdirSync(new URL('./glossary/', import.meta.url))
  .filter((f) => f.endsWith('.yaml'))
  .map((f) => f.replace(/\.yaml$/, ''))
  .sort();

interface Outline {
  id: string;
  badges: { id: string; when: { lessons?: string[]; world?: number } }[];
  worlds: { id: number; slug: string; dir: string; lessons: { id: string; slug: string }[]; boss?: { id: string } }[];
}
const outline = (course: string) => load(`./courses/${course}/course.yaml`) as Outline;
const itemIds = (c: Outline) => c.worlds.flatMap((w) => [...w.lessons.map((l) => l.id), ...(w.boss ? [w.boss.id] : [])]);

describe('content ids are unique', () => {
  it('finds every course and glossary', () => {
    expect(courseIds).toEqual(expect.arrayContaining(['git', 'docker', 'cicd', 'kubernetes']));
    expect(glossaries).toEqual(expect.arrayContaining(['git', 'docker', 'cicd', 'kubernetes']));
  });

  it('every course has a glossary, commands.yaml and rescue.yaml (the id is the file name)', () => {
    for (const c of courseIds) {
      expect(glossaries, c).toContain(c);
      expect(existsSync(new URL(`./courses/${c}/commands.yaml`, import.meta.url)), `${c}/commands.yaml`).toBe(true);
      expect(existsSync(new URL(`./courses/${c}/rescue.yaml`, import.meta.url)), `${c}/rescue.yaml`).toBe(true);
      expect(outline(c).id, `${c}/course.yaml id`).toBe(c);
    }
  });

  // A new course's lists may hold only world marker comments for now (they read as null).
  it.each(glossaries)('glossary terms (%s)', (g) => {
    expect(dupes((load(`./glossary/${g}.yaml`).terms ?? []).map((t: { id: string }) => t.id))).toEqual([]);
  });

  it.each(courseIds)('command pages (%s)', (c) => {
    const { groups, commands } = load(`./courses/${c}/commands.yaml`) as { groups: { id: string }[] | null; commands: { id: string; group: string }[] | null };
    expect(dupes((commands ?? []).map((x) => x.id))).toEqual([]);
    const groupIds = new Set((groups ?? []).map((g) => g.id));
    for (const x of commands ?? []) expect(groupIds.has(x.group), `${c}: ${x.id} → group ${x.group}`).toBe(true);
  });

  it('rescue flows (each family shares one page, so ids are unique across courses)', () => {
    const ids = courseIds.flatMap((c) => ((load(`./courses/${c}/rescue.yaml`).flows ?? []) as { id: string }[]).map((f) => f.id));
    expect(dupes(ids)).toEqual([]);
  });

  it('lesson ids across every course, and slugs inside each world', () => {
    expect(dupes(courseIds.flatMap((c) => itemIds(outline(c))))).toEqual([]);
    for (const c of courseIds) {
      for (const w of outline(c).worlds) expect(dupes(w.lessons.map((l) => l.slug)), `${c} world ${w.id}`).toEqual([]);
      expect(dupes(outline(c).worlds.map((w) => w.slug)), `${c} world slugs`).toEqual([]);
      expect(dupes(outline(c).worlds.map((w) => String(w.id))), `${c} world ids`).toEqual([]);
    }
  });

  it('badges: unique across courses (progress keeps them in one list), and rules point at real lessons', () => {
    expect(dupes(courseIds.flatMap((c) => outline(c).badges.map((b) => b.id)))).toEqual([]);
    for (const c of courseIds) {
      const o = outline(c);
      const items = new Set(itemIds(o));
      const worlds = new Set(o.worlds.map((w) => w.id));
      for (const b of o.badges) {
        for (const l of b.when.lessons ?? []) expect(items.has(l), `${c} badge ${b.id} → ${l}`).toBe(true);
        if (b.when.world !== undefined) expect(worlds.has(b.when.world), `${c} badge ${b.id} → world ${b.when.world}`).toBe(true);
      }
    }
  });

  it.each(glossaries.filter((g) => courseIds.includes(g)))('glossary worlds exist in the course (%s)', (g) => {
    const worlds = new Set(outline(g).worlds.map((w) => w.id));
    for (const t of (load(`./glossary/${g}.yaml`).terms ?? []) as { id: string; world?: number }[]) {
      if (t.world !== undefined) expect(worlds.has(t.world), `${g}: ${t.id} world ${t.world}`).toBe(true);
    }
  });
});
