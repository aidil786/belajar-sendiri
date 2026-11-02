// Course helpers: URLs, lesson order, badges. Course-agnostic.
import { getCollection, getEntry, type CollectionEntry } from 'astro:content';
import { t, type Lang } from '~/i18n';
import { familyKeys, sortCourses, worldCode, worldList } from './catalog';

export type Course = CollectionEntry<'courses'>['data'];
export type World = Course['worlds'][number];
export type LessonRef = World['lessons'][number];
export type Badge = Course['badges'][number];

export interface FlatItem {
  id: string;
  kind: 'lesson' | 'boss';
  world: World;
  index: number; // 0-based within the world
  slug: string; // url segment ("boss" for bosses)
  dir: string; // content folder under the course
  title: { en: string; ms: string };
  minutes: number;
  xp: number;
  status: 'ready' | 'soon' | 'none';
  /** Capstone mission number (Ship It), if this lesson is one. */
  mission?: number | undefined;
}

export async function getCourse(id: string): Promise<Course> {
  const entry = await getEntry('courses', id);
  if (!entry) throw new Error(`Course not found: ${id}`);
  return entry.data;
}

/** Every course: the first course, then each family's parts in order. */
export async function getCourses(): Promise<Course[]> {
  return sortCourses((await getCollection('courses')).map((e) => e.data));
}

/** The parts of one family (Ship It), in order. */
export async function getFamily(family: string): Promise<Course[]> {
  return (await getCourses()).filter((c) => c.family === family);
}

const pad = (n: number) => String(n).padStart(2, '0');

export function flatten(course: Course): FlatItem[] {
  const out: FlatItem[] = [];
  for (const world of course.worlds) {
    world.lessons.forEach((l, i) => {
      out.push({
        id: l.id,
        kind: 'lesson',
        world,
        index: i,
        slug: l.slug,
        dir: `${world.dir}/${pad(i + 1)}-${l.slug}`,
        title: l.title,
        minutes: l.minutes,
        xp: l.xp,
        status: l.status,
        mission: l.mission,
      });
    });
    if (world.boss && world.boss.status !== 'none') {
      out.push({
        id: world.boss.id,
        kind: 'boss',
        world,
        index: world.lessons.length,
        slug: 'boss',
        dir: `${world.dir}/boss`,
        title: world.boss.title,
        minutes: 6,
        xp: world.boss.xp,
        status: world.boss.status,
      });
    }
  }
  return out;
}

export function itemUrl(lang: Lang, courseId: string, item: Pick<FlatItem, 'world' | 'slug'>): string {
  return `/${lang}/${courseId}/${item.world.slug}/${item.slug}/`;
}

export function mapUrl(lang: Lang, courseId: string, world?: World): string {
  return `/${lang}/${courseId}/${world ? `#world-${world.id}` : ''}`;
}

/** "World 3" (Git) or "World D1" / "Dunia D1" (Ship It). */
export function worldLabel(lang: Lang, world: World): string {
  return t(lang, 'map.world', { n: worldCode(world) });
}

/** The next ready item after `id`, in course order. */
export function nextReady(course: Course, id: string): FlatItem | undefined {
  const all = flatten(course);
  const i = all.findIndex((x) => x.id === id);
  return all.slice(i + 1).find((x) => x.status === 'ready');
}

/** Badge rules with world badges expanded into lesson lists (serialisable for the browser). */
export function badgeRules(course: Course): { id: string; lessons: string[] }[] {
  const all = flatten(course);
  return course.badges.map((b) => ({
    id: b.id,
    lessons:
      b.when.lessons ??
      all.filter((x) => x.world.id === b.when.world && x.status === 'ready').map((x) => x.id),
  }));
}

/** A badge's name: from course.yaml when given, else from i18n (`badge.<id>`). */
export function badgeName(lang: Lang, badge: Pick<Badge, 'id' | 'name'>): string {
  return badge.name?.[lang] ?? t(lang, `badge.${badge.id}`);
}

/** Every badge name in these courses (badges are earned per course but listed together). */
export function badgeNames(lang: Lang, courses: readonly Course[]): Record<string, string> {
  return Object.fromEntries(courses.flatMap((c) => c.badges.map((b) => [b.id, badgeName(lang, b)])));
}

export function readyCount(world: World): number {
  return world.lessons.filter((l) => l.status === 'ready').length;
}

/** Gentle "best after" hints, one line per course listed in `requires`. Never a lock. */
export function requiresHints(lang: Lang, course: Course, all: readonly Course[]): string[] {
  return course.requires.map((r) => {
    const other = all.find((c) => c.id === r.course);
    // Worlds with a code read "World C1" / "Worlds K1–K3"; Git worlds stay "World 4".
    const codeOf = (id: number) => {
      const w = other?.worlds.find((x) => x.id === id);
      return w ? worldCode(w) : String(id);
    };
    const list = worldList(r.worlds, codeOf);
    const worlds = list.text ? t(lang, list.many ? 'catalog.worldMany' : 'catalog.worldOne', { n: list.text }) : '';
    return t(lang, 'catalog.requires', { course: other?.title[lang] ?? r.course, worlds }).replace(', .', '.');
  });
}

/** "Part 1 · Dapur" for a family course, else ''. */
export function partLabel(lang: Lang, course: Course): string {
  return course.part && course.partName ? t(lang, 'catalog.part', { n: course.part, name: course.partName[lang] }) : '';
}

/** A family's name: "Ship It", "Level Up" / "Naik Tahap". */
export function familyTitle(lang: Lang, family: string): string {
  return t(lang, familyKeys(family).title);
}

/** The course's placement test, once it is ready. */
export function placementItem(course: Course): FlatItem | undefined {
  return course.placement ? flatten(course).find((x) => x.id === course.placement && x.status === 'ready') : undefined;
}
