// Course catalog helpers: which course a page belongs to, where its tools live,
// world codes and the gentle "best after" hints. Pure (no Astro), so easy to test.
import type { Lang } from '~/i18n';

/** The first course. Its tool pages keep their short URLs (/en/glossary/, /en/rescue/ …). */
export const ROOT_COURSE = 'git';
/** The Ship It family (docker + cicd + kubernetes) has one overview map and one Rescue Center. */
export const SHIP_IT = 'ship-it';
/** The Level Up family (linux + iac + observability + aws): docs/LEVEL-UP-PLAN.md. */
export const LEVEL_UP = 'level-up';
/** Families with their own pages (/<lang>/<family>/ and /<lang>/<family>/rescue/), in catalog order. */
export const FAMILIES = [SHIP_IT, LEVEL_UP] as const;
export type Family = (typeof FAMILIES)[number];

/** The i18n prefix of a family's words: `shipit.title`, `levelup.title` … */
const FAMILY_KEYS: Record<Family, string> = { 'ship-it': 'shipit', 'level-up': 'levelup' };

/** i18n keys for a family's overview and Rescue Center (Ship It's rescue words predate the family pages). */
export function familyKeys(family: string) {
  const k = FAMILY_KEYS[family as Family] ?? family;
  const ship = family === SHIP_IT;
  return {
    title: `${k}.title`,
    subtitle: `${k}.subtitle`,
    summary: `${k}.summary`,
    intro: `${k}.intro`,
    mapTitle: `${k}.mapTitle`,
    before: `${k}.before`,
    missions: `${k}.missions`,
    missionsText: `${k}.missionsText`,
    rescueText: `${k}.rescueText`,
    finish: `${k}.finish`,
    openPart: `${k}.openPart`,
    rescueTitle: ship ? 'rescue.shipItTitle' : `${k}.rescueTitle`,
    rescueIntro: ship ? 'rescue.shipItIntro' : `${k}.rescueIntro`,
    rescueFilterHint: ship ? 'rescue.filterHintShip' : `${k}.rescueFilterHint`,
  };
}

/**
 * Kancil's outfit per course. Ship It: chef's hat (Docker), hard hat (CI/CD), captain's cap (Kubernetes).
 * Level Up: tool belt (Linux), pencil behind the ear (IaC), headset (Observability), staff lanyard (AWS).
 */
export const HATS = ['chef', 'hardhat', 'captain', 'toolbelt', 'pencil', 'headset', 'lanyard'] as const;
export type Hat = (typeof HATS)[number];

/**
 * Tools a lesson can be checked against (frontmatter `tool`, course `tool`). The Git course uses gitVersion.
 * Ship It: docker, github-actions, kubernetes. Level Up: linux (Debian 13), opentofu, prometheus, aws.
 * Each one needs a `tool.<id>` name in src/i18n/en.json and ms.json (catalog.test.ts checks).
 */
export const TOOLS = ['docker', 'github-actions', 'kubernetes', 'linux', 'opentofu', 'prometheus', 'aws'] as const;
export type Tool = (typeof TOOLS)[number];

/** How a toolVersion reads in "Checked with Linux (Debian 13)": "debian-13" → "(Debian 13)"; others stay as written. */
export function toolVersionText(version: string): string {
  const debian = /^debian-(\d+)$/.exec(version);
  return debian ? `(Debian ${debian[1]})` : version;
}

/** Tool pages every course has (rescue is shared per family). */
export const TOOL_PAGES = ['glossary', 'cheatsheet', 'commands', 'rescue'] as const;
export type ToolPage = (typeof TOOL_PAGES)[number];

/** Url segments a world slug must never use: they are tool pages under /<lang>/<course>/. */
export const RESERVED_SLUGS = [...TOOL_PAGES, 'review', 'settings', 'dev'] as const;

export interface CourseLike {
  id: string;
  family?: string | undefined;
  part?: number | undefined;
}

export interface WorldLike {
  id: number;
  code?: string | undefined;
  /** The finish line (Career Quest). */
  finale?: boolean | undefined;
  /** An optional extra pack (CKA = K9): "Extra pack" on the maps. Never locked. */
  extra?: boolean | undefined;
}

/** "D1" for Ship It worlds, "3" for Git worlds: used in "World {n}". */
export function worldCode(world: WorldLike): string {
  return world.code ?? String(world.id);
}

/** Where a course's tool page lives. */
export function toolHref(lang: Lang, course: CourseLike, page: ToolPage): string {
  if (page === 'rescue') return course.family ? `/${lang}/${course.family}/rescue/` : `/${lang}/rescue/`;
  return course.id === ROOT_COURSE ? `/${lang}/${page}/` : `/${lang}/${course.id}/${page}/`;
}

/** One command page. */
export function commandHref(lang: Lang, courseId: string, commandId: string): string {
  return courseId === ROOT_COURSE ? `/${lang}/commands/${commandId}/` : `/${lang}/${courseId}/commands/${commandId}/`;
}

/** The map for a course: its own world map. */
export function courseMapHref(lang: Lang, courseId: string): string {
  return `/${lang}/${courseId}/`;
}

/** The course (or family) a path belongs to: /en/docker/… → { course: 'docker' }, /en/ship-it/… → { family: 'ship-it' }. */
export function placeOfPath(pathname: string, courseIds: readonly string[]): { course?: string; family?: string } {
  const seg = pathname.split('/')[2] ?? '';
  if (courseIds.includes(seg)) return { course: seg };
  if ((FAMILIES as readonly string[]).includes(seg)) return { family: seg };
  return {};
}

/**
 * Root course first, then courses without a family, then each family (in FAMILIES order) with its
 * parts in order. Ship It stays before Level Up, so review card order never shifts for existing learners.
 */
export function sortCourses<C extends CourseLike>(courses: readonly C[]): C[] {
  const rank = (c: C) => {
    if (c.id === ROOT_COURSE) return -1;
    if (!c.family) return 0;
    const i = (FAMILIES as readonly string[]).indexOf(c.family);
    return 1 + (i === -1 ? FAMILIES.length : i);
  };
  return [...courses].sort(
    (a, b) => rank(a) - rank(b) || (a.family ?? '').localeCompare(b.family ?? '') || (a.part ?? 0) - (b.part ?? 0) || a.id.localeCompare(b.id),
  );
}

/** Worlds in map order: the outline's order, with the finish line (Career Quest) always last. */
export function mapOrder<W extends WorldLike>(worlds: readonly W[]): W[] {
  return [...worlds.filter((w) => !w.finale), ...worlds.filter((w) => w.finale)];
}

/**
 * Worlds as text: [0,1,2,3,4] → "0–4", [7] → "7", [1,3] → "1, 3". `many` tells "World" from "Worlds".
 * `codeOf` names each world by its code instead: [1] → "C1", [1,2,3] → "K1–K3".
 */
export function worldList(ids: readonly number[], codeOf: (id: number) => string = String): { text: string; many: boolean } {
  const sorted = [...new Set(ids)].sort((a, b) => a - b);
  if (sorted.length === 0) return { text: '', many: false };
  if (sorted.length === 1) return { text: codeOf(sorted[0]!), many: false };
  const consecutive = sorted.every((n, i) => i === 0 || n === sorted[i - 1]! + 1);
  return { text: consecutive ? `${codeOf(sorted[0]!)}–${codeOf(sorted[sorted.length - 1]!)}` : sorted.map(codeOf).join(', '), many: true };
}

/** Review card ids stay as they were for the first course; other courses get a prefix so ids never clash. */
export function reviewItemId(courseId: string, id: string): string {
  return courseId === ROOT_COURSE ? id : `${courseId}:${id}`;
}

/** Review distractors come from nearby worlds; courses sit far apart so they never mix. */
export function reviewWorld(courseIndex: number, world: number): number {
  return courseIndex * 1000 + world;
}
