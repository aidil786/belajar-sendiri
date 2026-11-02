// The Level Up outline (docs/LEVEL-UP-PLAN.md §1–2) is the contract every Level Up helper builds on:
// family, parts, outfits, tools, world codes and folders, lesson counts and ids, missions M7–M10,
// bosses, badges, "best after" hints and the story text. Lessons stay "Coming soon" until written.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { HATS, LEVEL_UP, RESERVED_SLUGS, TOOLS } from '~/lib/catalog';
import { sentences, words } from '../../../scripts/check-readability/index';

interface Text {
  en: string;
  ms: string;
}
interface Lesson {
  id: string;
  slug: string;
  minutes: number;
  xp: number;
  status: string;
  mission?: number;
  title: Text;
}
interface World {
  id: number;
  code: string;
  slug: string;
  dir: string;
  icon: string;
  color: string;
  finale?: boolean;
  extra?: boolean;
  title: Text;
  summary: Text;
  topics?: Text;
  lessons: Lesson[];
  boss?: { id: string; status: string; xp: number; title: Text; summary: Text };
}
interface Outline {
  id: string;
  family: string;
  part: number;
  partName: Text;
  story: Text;
  hat: string;
  tool: string;
  toolVersion: string;
  title: Text;
  summary: Text;
  intro: Text;
  requires: { course: string; worlds: number[] }[];
  worlds: World[];
  badges: { id: string; icon: string; name?: Text; when: { lessons?: string[]; world?: number } }[];
}
const load = (c: string) => parse(readFileSync(new URL(`./${c}/course.yaml`, import.meta.url), 'utf8')) as Outline;

const PLAN: Record<
  string,
  { prefix: string; part: number; hat: string; tool: string; toolVersion: string; title: Text; requires: Outline['requires']; mission: number; worlds: Record<string, [string, number]> }
> = {
  linux: {
    prefix: 'linux',
    part: 1,
    hat: 'toolbelt',
    tool: 'linux',
    toolVersion: 'debian-13',
    title: { en: 'Linux & Networking', ms: 'Linux & Rangkaian' },
    requires: [],
    mission: 7,
    worlds: { L1: ['l1-shophouse', 9], L2: ['l2-keys-staff', 10], L3: ['l3-phone-lines', 10], L4: ['l4-remote-kitchens', 9] },
  },
  iac: {
    prefix: 'iac',
    part: 2,
    hat: 'pencil',
    tool: 'opentofu',
    toolVersion: '1.13',
    title: { en: 'Terraform & OpenTofu', ms: 'Terraform & OpenTofu' },
    requires: [
      { course: 'git', worlds: [4] },
      { course: 'cicd', worlds: [1] },
    ],
    mission: 8,
    worlds: { T1: ['t1-blueprints', 8], T2: ['t2-inputs-outputs', 8], T3: ['t3-state-teams', 8], T4: ['t4-modules-pipelines', 8] },
  },
  observability: {
    prefix: 'obs',
    part: 3,
    hat: 'headset',
    tool: 'prometheus',
    toolVersion: '3',
    title: { en: 'Monitoring & Observability', ms: 'Pemantauan & Observability' },
    requires: [{ course: 'kubernetes', worlds: [5] }],
    mission: 9,
    worlds: { O1: ['o1-control-room', 8], O2: ['o2-counters', 9], O3: ['o3-alarms-screens', 8], O4: ['o4-diary-one-order', 8] },
  },
  aws: {
    prefix: 'aws',
    part: 4,
    hat: 'lanyard',
    tool: 'aws',
    toolVersion: '2026-11',
    title: { en: 'Cloud with AWS', ms: 'Cloud dengan AWS' },
    requires: [
      { course: 'linux', worlds: [3] },
      { course: 'docker', worlds: [4] },
    ],
    mission: 10,
    worlds: { A1: ['a1-renting-a-unit', 8], A2: ['a2-keys-guards', 8], A3: ['a3-mall-roads', 8], A4: ['a4-containers-cloud', 8] },
  },
};
const COLORS = ['working', 'staging', 'repo', 'remote', 'head', 'danger'];
// Indonesian words that slip into Malay (CLAUDE.md §4): never in Level Up text.
const NOT_MALAYSIAN = /(\bberkas|unduh|kata sandi|pengaturan|\bhapus)/i;
const short = (text: string, where: string) => {
  for (const s of sentences(text)) expect(words(s).length, `${where}: ${s}`).toBeLessThanOrEqual(15);
};

describe.each(Object.keys(PLAN))('Level Up outline: %s', (course) => {
  const plan = PLAN[course]!;
  const o = load(course);

  it('belongs to the Level Up family with its part, outfit, tool and title', () => {
    expect(o).toMatchObject({ id: course, family: LEVEL_UP, part: plan.part, hat: plan.hat, tool: plan.tool, toolVersion: plan.toolVersion, title: plan.title });
    expect(HATS as readonly string[]).toContain(o.hat);
    expect(TOOLS as readonly string[]).toContain(o.tool);
    expect(o.partName.en && o.partName.ms && o.story.en && o.story.ms && o.summary.en && o.summary.ms && o.intro.en && o.intro.ms).toBeTruthy();
  });

  it('gives gentle "best after" hints from the plan (never locks)', () => {
    expect(o.requires).toEqual(plan.requires);
  });

  it('has the worlds, codes, folders and lesson counts of the plan', () => {
    expect(o.worlds.map((w) => w.code)).toEqual(Object.keys(plan.worlds));
    for (const w of o.worlds) {
      const [dir, count] = plan.worlds[w.code]!;
      expect(w.dir, w.code).toBe(dir);
      expect(w.dir, w.code).toBe(`${w.code.toLowerCase()}-${w.slug}`);
      expect(w.id, w.code).toBe(Number(w.code.slice(1)));
      expect(w.lessons.filter((l) => !l.mission).length, `${w.code} lessons`).toBe(count);
      expect(RESERVED_SLUGS as readonly string[], `${w.code} slug`).not.toContain(w.slug);
      expect(COLORS, `${w.code} colour`).toContain(w.color);
      expect(w.finale || w.extra, `${w.code}: no finish line or extra pack in Level Up`).toBeFalsy();
      expect(w.title.en && w.title.ms && w.summary.en && w.summary.ms && w.topics?.en && w.topics?.ms, `${w.code} text`).toBeTruthy();
    }
  });

  it('names lessons, the mission and bosses by the shared id pattern', () => {
    for (const w of o.worlds) {
      const code = w.code.toLowerCase();
      w.lessons
        .filter((l) => !l.mission)
        .forEach((l, i) => expect(l.id, `${w.code} lesson ${i + 1}`).toBe(`${plan.prefix}-${code}-l${String(i + 1).padStart(2, '0')}`));
      expect(w.boss?.id, `${w.code} boss`).toBe(`${plan.prefix}-${code}-boss`);
      expect(w.boss!.xp).toBe(50);
    }
    const missions = o.worlds.flatMap((w) => w.lessons.filter((l) => l.mission).map((l) => ({ w, l })));
    expect(missions, 'one capstone mission per course').toHaveLength(1);
    const { w, l } = missions[0]!;
    expect(w, 'the mission sits in the last world').toBe(o.worlds[o.worlds.length - 1]);
    expect(l.mission).toBe(plan.mission);
    expect(l.id).toBe(`${plan.prefix}-${w.code.toLowerCase()}-m${plan.mission}`);
    expect(w.lessons[w.lessons.length - 1], 'missions come last in their world').toBe(l);
    expect(l.title.en).toMatch(new RegExp(`^Capstone mission ${plan.mission}: `));
    expect(l.title.ms).toMatch(new RegExp(`^Misi capstone ${plan.mission}: `));
    expect(l.xp).toBe(100);
  });

  it('keeps lessons 3–5 minutes with XP to match, bilingual, and "Coming soon" until written', () => {
    for (const w of o.worlds) {
      for (const l of w.lessons) {
        expect(l.minutes, l.id).toBeGreaterThanOrEqual(3);
        expect(l.minutes, l.id).toBeLessThanOrEqual(5);
        if (!l.mission) expect(l.xp, l.id).toBe(l.minutes * 5);
        expect(l.title.en && l.title.ms, l.id).toBeTruthy();
        expect(l.slug, l.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
        expect(['ready', 'soon'], l.id).toContain(l.status);
        // A lesson marked ready has its two files (npm run check:cards checks the rest).
        const dir = `./${course}/${w.dir}/${String(w.lessons.indexOf(l) + 1).padStart(2, '0')}-${l.slug}/`;
        if (l.status === 'ready') expect(existsSync(new URL(`${dir}en.mdx`, import.meta.url)), `${l.id} files`).toBe(true);
      }
      expect(w.boss!.title.en && w.boss!.title.ms && w.boss!.summary.en && w.boss!.summary.ms, `${w.code} boss text`).toBeTruthy();
    }
  });

  it('has a badge for every world and at least one skill badge earned on a boss, named in both languages', () => {
    const worldBadges = o.badges.filter((b) => b.when.world !== undefined);
    expect(worldBadges.map((b) => b.id)).toEqual(o.worlds.map((w) => `${plan.prefix}-world-${w.id}`));
    const skill = o.badges.filter((b) => b.when.lessons);
    expect(skill.length).toBeGreaterThanOrEqual(1);
    const bosses = new Set(o.worlds.map((w) => w.boss!.id));
    for (const b of skill) for (const id of b.when.lessons!) expect(bosses.has(id), `${b.id} → ${id}`).toBe(true);
    for (const b of o.badges) expect(b.name?.en && b.name?.ms, b.id).toBeTruthy();
  });

  it('writes short sentences, and Malaysian (not Indonesian) Malay', () => {
    const texts: [string, Text][] = [
      ['story', o.story],
      ['summary', o.summary],
      ['intro', o.intro],
      ...o.worlds.flatMap((w): [string, Text][] => [
        [`${w.code} summary`, w.summary],
        [`${w.code} boss`, w.boss!.summary],
      ]),
    ];
    for (const [where, text] of texts) {
      short(text.en, `${where} (en)`);
      short(text.ms, `${where} (ms)`);
    }
    const allMs = JSON.stringify(o, (k, v: unknown) => (k === 'en' ? undefined : v));
    expect(allMs).not.toMatch(NOT_MALAYSIAN);
  });
});

describe('Level Up as a whole', () => {
  const all = Object.keys(PLAN).map(load);

  it('has 38 + 32 + 33 + 32 lessons and the missions M7–M10, one per part', () => {
    const lessons = all.map((o) => o.worlds.flatMap((w) => w.lessons.filter((l) => !l.mission)).length);
    expect(lessons).toEqual([38, 32, 33, 32]);
    const missions = all.flatMap((o) => o.worlds.flatMap((w) => w.lessons.filter((l) => l.mission).map((l) => l.mission)));
    expect(missions).toEqual([7, 8, 9, 10]);
  });

  it('parts 1–4 in order, each with its own outfit', () => {
    expect(all.map((o) => o.part)).toEqual([1, 2, 3, 4]);
    expect(new Set(all.map((o) => o.hat)).size).toBe(4);
  });

  it('every course has its glossary (world markers), commands, rescue and scenario registry', () => {
    for (const o of all) {
      const glossary = readFileSync(new URL(`../glossary/${o.id}.yaml`, import.meta.url), 'utf8');
      for (const w of o.worlds) expect(glossary, `${o.id} glossary marker ${w.code}`).toContain(`# --- World ${w.code} terms`);
      const commands = parse(readFileSync(new URL(`./${o.id}/commands.yaml`, import.meta.url), 'utf8')) as { groups: { id: string }[] };
      expect(commands.groups.length, `${o.id} command groups`).toBeGreaterThan(0);
      expect(existsSync(new URL(`./${o.id}/rescue.yaml`, import.meta.url)), `${o.id} rescue`).toBe(true);
      expect(existsSync(new URL(`./${o.id}/scenarios/index.ts`, import.meta.url)), `${o.id} scenarios`).toBe(true);
    }
  });
});
