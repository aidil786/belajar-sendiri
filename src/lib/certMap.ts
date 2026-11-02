// Certification map helpers (pure): which lessons count for an exam, and how many are done.
import type { CertWorld } from '~/content/courses/certifications';

interface ItemLike {
  id: string;
  status: string;
}
export interface CourseLike {
  id: string;
  worlds: { id: number; code?: string | undefined; title: { en: string; ms: string }; lessons: ItemLike[]; boss?: ItemLike | undefined }[];
}

/** The world a cert points at, or undefined when the outline has no such world (a typo). */
export function findWorld<C extends CourseLike>(courses: readonly C[], ref: CertWorld): { course: C; world: C['worlds'][number] } | undefined {
  const course = courses.find((c) => c.id === ref.course);
  const world = course?.worlds.find((w) => w.id === ref.world);
  return course && world ? { course, world } : undefined;
}

/** Ready lessons (and bosses) of the covering worlds, like the world map counts them. */
export function certLessonIds(courses: readonly CourseLike[], covers: readonly CertWorld[]): string[] {
  const ids: string[] = [];
  for (const ref of covers) {
    const hit = findWorld(courses, ref);
    if (!hit) continue;
    const { world } = hit;
    ids.push(...world.lessons.filter((l) => l.status === 'ready').map((l) => l.id));
    if (world.boss?.status === 'ready') ids.push(world.boss.id);
  }
  return [...new Set(ids)];
}

/** Done / total and a whole percent (0 when nothing is ready yet). */
export function certProgress(ids: readonly string[], completed: readonly string[]): { done: number; total: number; percent: number } {
  const set = new Set(completed);
  const done = ids.filter((id) => set.has(id)).length;
  const total = ids.length;
  return { done, total, percent: total ? Math.round((done / total) * 100) : 0 };
}
