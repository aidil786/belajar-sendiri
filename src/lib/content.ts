// Loaders for the course reference data (commands, rescue flows, glossary, review cards).
// Every course has its own files; review cards from all courses are merged into one daily deck.
import { getCollection, getEntry } from 'astro:content';
import { flatten, getCourse, getCourses, itemUrl } from './course';
import { buildPool, cardsFor, encodeSlots, mergeCoursePools, type ReviewItem, type SlotIndex } from './review';
import type { Lang } from '~/i18n';

export async function getCommands(course: string) {
  const e = await getEntry('commands', course);
  if (!e) throw new Error(`No commands.yaml for ${course}`);
  return e.data;
}

export async function getRescue(course: string) {
  const e = await getEntry('rescue', course);
  if (!e) throw new Error(`No rescue.yaml for ${course}`);
  return e.data;
}

export async function getGlossary(course: string) {
  const e = await getEntry('glossary', course);
  if (!e) throw new Error(`No glossary for ${course}`);
  return e.data;
}

/** lesson id → { url, title } for links from reference pages (one course or several). */
export async function lessonLinks(lang: Lang, courseIds: string | readonly string[]) {
  const out: Record<string, { url: string; title: string }> = {};
  for (const courseId of typeof courseIds === 'string' ? [courseIds] : courseIds) {
    const course = await getCourse(courseId);
    for (const x of flatten(course)) {
      if (x.status === 'ready') out[x.id] = { url: itemUrl(lang, courseId, x), title: x.title[lang] };
    }
  }
  return out;
}

/** Ready lessons and bosses that have both language files, in course order, with their English MDX body. */
async function readyLessons(courseId: string) {
  const course = await getCourse(courseId);
  const entries = await getCollection('lessons');
  const bodies = new Map(entries.map((e) => [e.id, e.body ?? '']));
  return flatten(course).filter(
    (x) => x.status === 'ready' && bodies.has(`${courseId}/${x.dir}/en`) && bodies.has(`${courseId}/${x.dir}/ms`),
  ).map((x) => ({ item: x, body: bodies.get(`${courseId}/${x.dir}/en`)! }));
}

/** Every lesson page that exists in one language, in every course (for "Save all lessons for offline use"). */
export async function lessonPages(lang: Lang): Promise<string[]> {
  const out: string[] = [];
  for (const course of await getCourses()) out.push(...(await readyLessons(course.id)).map(({ item }) => itemUrl(lang, course.id, item)));
  return out;
}

/** One course's review items. */
async function coursePool(lang: Lang, courseId: string): Promise<ReviewItem[]> {
  const lessons = (await readyLessons(courseId)).map(({ item, body }) => ({ id: item.id, world: item.world.id, text: body }));
  if (lessons.length === 0) return [];
  const [{ terms }, { commands }] = await Promise.all([getGlossary(courseId), getCommands(courseId)]);
  return buildPool({ lang, lessons, terms, commands });
}

/**
 * Daily review: words and commands, each tied to the lesson(s) that teach it, from every course.
 * Only ready lessons count, so "Coming soon" lessons never add cards.
 * Ids from courses after the first get a course prefix, so they never clash.
 */
export async function getReviewPool(lang: Lang): Promise<ReviewItem[]> {
  const pools: { courseId: string; items: ReviewItem[] }[] = [];
  for (const course of await getCourses()) pools.push({ courseId: course.id, items: await coursePool(lang, course.id) });
  return mergeCoursePools(pools);
}

/** Just enough to count today's cards (used on the home page). */
export async function getReviewIndex(): Promise<SlotIndex> {
  return encodeSlots(cardsFor(await getReviewPool('en')));
}
