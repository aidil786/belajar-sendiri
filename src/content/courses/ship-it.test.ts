// The Ship It outline (docs/SHIP-IT-PLAN.md §4–8, §12) is the contract every Ship It helper builds on.
// Lesson counts per world, ids, folders, world codes and capstone missions must match the plan.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { RESERVED_SLUGS } from '~/lib/catalog';

interface Lesson {
  id: string;
  slug: string;
  minutes: number;
  xp: number;
  status: string;
  mission?: number;
  title: { en: string; ms: string };
}
interface World {
  id: number;
  code: string;
  slug: string;
  dir: string;
  finale?: boolean;
  extra?: boolean;
  title: { en: string; ms: string };
  summary: { en: string; ms: string };
  lessons: Lesson[];
  boss?: { id: string; status: string; xp: number; title: { en: string; ms: string }; summary: { en: string; ms: string } };
}
interface Outline {
  id: string;
  family: string;
  part: number;
  partName: { en: string; ms: string };
  hat: string;
  tool: string;
  toolVersion: string;
  placement: string;
  worlds: World[];
  badges: { id: string; name?: { en: string; ms: string } }[];
}
const load = (c: string) => parse(readFileSync(new URL(`./${c}/course.yaml`, import.meta.url), 'utf8')) as Outline;

const PLAN: Record<string, { prefix: string; part: number; hat: string; tool: string; toolVersion: string; worlds: Record<string, [string, number]> }> = {
  docker: {
    prefix: 'docker',
    part: 1,
    hat: 'chef',
    tool: 'docker',
    toolVersion: '29',
    worlds: {
      D0: ['d0-start-here', 10],
      D1: ['d1-first-containers', 11],
      D2: ['d2-recipes', 13],
      D3: ['d3-lockers-phone-lines', 9],
      D4: ['d4-set-meals', 10],
      D5: ['d5-ship-shield', 9],
      D6: ['d6-under-the-hood', 7],
    },
  },
  cicd: {
    prefix: 'cicd',
    part: 2,
    hat: 'hardhat',
    tool: 'github-actions',
    toolVersion: '2026-10',
    worlds: { C1: ['c1-pipeline-thinking', 9], C2: ['c2-container-pipelines', 13], C3: ['c3-release-deploy', 11], C4: ['c4-pipeline-shields', 9] },
  },
  kubernetes: {
    prefix: 'k8s',
    part: 3,
    hat: 'captain',
    tool: 'kubernetes',
    toolVersion: '1.37',
    worlds: {
      K1: ['k1-food-court', 13],
      K2: ['k2-trays-orders', 14],
      K3: ['k3-counters-doors', 11],
      K4: ['k4-notes-lockers-packages', 12],
      K5: ['k5-lunch-rush', 12],
      K6: ['k6-guards', 10],
      K7: ['k7-self-driving', 9],
      K8: ['k8-career-quest', 8],
      // Level Up's CKA pack (docs/LEVEL-UP-PLAN.md §2): an optional extra pack after the finale.
      K9: ['k9-cluster-admin', 12],
    },
  },
};
const MISSIONS: Record<string, number> = {
  'docker-d4-m1': 1,
  'cicd-c2-m2': 2,
  'cicd-c3-m3': 3,
  'k8s-k5-m4': 4,
  'k8s-k6-m5': 5,
  'k8s-k7-m6': 6,
};

describe.each(Object.keys(PLAN))('Ship It outline: %s', (course) => {
  const plan = PLAN[course]!;
  const o = load(course);

  it('belongs to the Ship It family with its part, hat and tool', () => {
    expect(o).toMatchObject({ id: course, family: 'ship-it', part: plan.part, hat: plan.hat, tool: plan.tool, toolVersion: plan.toolVersion });
    expect(o.partName.en && o.partName.ms).toBeTruthy();
  });

  it('has the worlds, codes, folders and lesson counts of the plan', () => {
    expect(o.worlds.map((w) => w.code)).toEqual(Object.keys(plan.worlds));
    for (const w of o.worlds) {
      const [dir, count] = plan.worlds[w.code]!;
      expect(w.dir, w.code).toBe(dir);
      expect(w.id, w.code).toBe(Number(w.code.slice(1)));
      expect(w.lessons.filter((l) => !l.mission).length, `${w.code} lessons`).toBe(count);
      expect(RESERVED_SLUGS as readonly string[], `${w.code} slug`).not.toContain(w.slug);
      expect(w.title.en && w.title.ms && w.summary.en && w.summary.ms, `${w.code} text`).toBeTruthy();
    }
  });

  it('names lessons, missions and bosses by the shared id pattern', () => {
    for (const w of o.worlds) {
      const code = w.code.toLowerCase();
      w.lessons
        .filter((l) => !l.mission)
        .forEach((l, i) => expect(l.id, `${w.code} lesson ${i + 1}`).toBe(`${plan.prefix}-${code}-l${String(i + 1).padStart(2, '0')}`));
      for (const l of w.lessons.filter((x) => x.mission)) {
        expect(l.id).toBe(`${plan.prefix}-${code}-m${l.mission}`);
        expect(MISSIONS[l.id]).toBe(l.mission);
        expect(w.lessons[w.lessons.length - 1], 'missions come last in their world').toBe(l);
        expect(l.title.en).toMatch(new RegExp(`^Capstone mission ${l.mission}: `));
        expect(l.title.ms).toMatch(new RegExp(`^Misi capstone ${l.mission}: `));
      }
      expect(w.boss?.id, `${w.code} boss`).toBe(`${plan.prefix}-${code}-boss`);
    }
  });

  it('keeps lessons 3–5 minutes, bilingual and "Coming soon" until written', () => {
    for (const w of o.worlds) {
      for (const l of w.lessons) {
        expect(l.minutes, l.id).toBeGreaterThanOrEqual(3);
        expect(l.minutes, l.id).toBeLessThanOrEqual(5);
        expect(l.xp, l.id).toBeGreaterThan(0);
        expect(l.title.en && l.title.ms, l.id).toBeTruthy();
        expect(l.slug, l.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
        expect(['ready', 'soon'], l.id).toContain(l.status);
      }
      expect(w.boss!.title.en && w.boss!.title.ms && w.boss!.summary.en && w.boss!.summary.ms, `${w.code} boss text`).toBeTruthy();
    }
  });

  it('points its placement test at a real lesson, and names every badge in both languages', () => {
    expect(o.worlds.flatMap((w) => w.lessons.map((l) => l.id))).toContain(o.placement);
    for (const b of o.badges) expect(b.name?.en && b.name?.ms, b.id).toBeTruthy();
  });
});

describe('Ship It as a whole', () => {
  const all = Object.keys(PLAN).map(load);
  const lessons = all.flatMap((o) => o.worlds.filter((w) => !w.finale && !w.extra).flatMap((w) => w.lessons.filter((l) => !l.mission)));

  it('has 69 + 42 + 81 lessons, Career Quest 8, and the six capstone missions', () => {
    expect(lessons.length).toBe(192);
    const career = all.flatMap((o) => o.worlds.filter((w) => w.finale));
    expect(career.map((w) => w.code)).toEqual(['K8']);
    expect(career[0]!.lessons.length).toBe(8);
    const missions = all.flatMap((o) => o.worlds.flatMap((w) => w.lessons.filter((l) => l.mission).map((l) => l.id)));
    expect(missions.sort()).toEqual(Object.keys(MISSIONS).sort());
  });

  it('keeps Career Quest the finale; the CKA pack (K9) is the only extra pack, open and after it', () => {
    const k8s = load('kubernetes');
    expect(k8s.worlds.filter((w) => w.finale).map((w) => w.code)).toEqual(['K8']);
    expect(all.flatMap((o) => o.worlds.filter((w) => w.extra).map((w) => w.code))).toEqual(['K9']);
    const k9 = k8s.worlds.find((w) => w.code === 'K9')!;
    expect(k9).toMatchObject({ slug: 'cluster-admin', dir: 'k9-cluster-admin', extra: true });
    expect(k9.finale).toBeFalsy();
    expect(k9.boss?.id).toBe('k8s-k9-boss');
  });

  it('has the skill badges from the plan', () => {
    const ids = all.flatMap((o) => o.badges.map((b) => b.id));
    for (const id of ['kek-lapis-master', 'shrink-ray', 'green-line', 'hole-patcher', 'self-healer', 'zero-downtime', 'gatekeeper', 'hands-off']) {
      expect(ids).toContain(id);
    }
  });

  it('keeps the sample lesson "Want 3, See 2" as K1 lesson 4 (4 min, 20 XP)', () => {
    const k1 = load('kubernetes').worlds.find((w) => w.code === 'K1')!;
    expect(k1.lessons[3]).toMatchObject({ id: 'k8s-k1-l04', minutes: 4, xp: 20, title: { en: 'Want 3, See 2' } });
  });
});
