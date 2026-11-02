// Shared helpers for the content scripts: find lesson files and split them into cards.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parse as parseYaml } from 'yaml';

export const COURSES_DIR = 'src/content/courses';
/** The first course (Git). Its lessons pin gitVersion; other courses pin tool + toolVersion. */
export { ROOT_COURSE } from '../../src/lib/catalog';

export interface LessonFile {
  course: string;
  dir: string; // e.g. w01-save-points/03-the-box
  lang: 'en' | 'ms';
  path: string;
  text: string;
}

export interface CardBlock {
  id: string;
  type: string;
  body: string;
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

export function lessonFiles(): LessonFile[] {
  const out: LessonFile[] = [];
  for (const course of readdirSync(COURSES_DIR)) {
    const base = join(COURSES_DIR, course);
    if (!statSync(base).isDirectory()) continue;
    for (const path of walk(base)) {
      const m = /\/(en|ms)\.mdx$/.exec(path);
      if (!m) continue;
      const rel = relative(base, path).replace(/\/(en|ms)\.mdx$/, '');
      out.push({ course, dir: rel, lang: m[1] as 'en' | 'ms', path, text: readFileSync(path, 'utf8') });
    }
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

export function frontmatter(text: string): Record<string, unknown> {
  const m = /^---\n([\s\S]*?)\n---/.exec(text);
  return m ? (parseYaml(m[1]!) as Record<string, unknown>) : {};
}

export function cards(text: string): CardBlock[] {
  const out: CardBlock[] = [];
  const re = /<Card\s+id="([^"]+)"\s+type="([^"]+)"[^>]*>([\s\S]*?)<\/Card>/g;
  for (const m of text.matchAll(re)) out.push({ id: m[1]!, type: m[2]!, body: m[3]! });
  return out;
}

export interface CourseYaml {
  id: string;
  worlds: {
    id: number;
    dir: string;
    lessons: { id: string; slug: string; minutes: number; xp: number; status: string }[];
    boss?: { id: string; xp: number; status: string };
  }[];
}

/** Every course folder that has a course.yaml (git, docker, cicd, kubernetes …). */
export function courseDirs(): string[] {
  return readdirSync(COURSES_DIR)
    .filter((name) => existsSync(join(COURSES_DIR, name, 'course.yaml')))
    .sort();
}

export function courseYaml(course: string): CourseYaml | null {
  const p = join(COURSES_DIR, course, 'course.yaml');
  return existsSync(p) ? (parseYaml(readFileSync(p, 'utf8')) as CourseYaml) : null;
}

/** Expected lesson folders for every ready lesson/boss in course.yaml. */
export function expectedDirs(c: CourseYaml): { id: string; dir: string; world: number; minutes?: number; xp: number }[] {
  const out: { id: string; dir: string; world: number; minutes?: number; xp: number }[] = [];
  for (const w of c.worlds) {
    w.lessons.forEach((l, i) => {
      if (l.status === 'ready') out.push({ id: l.id, dir: `${w.dir}/${String(i + 1).padStart(2, '0')}-${l.slug}`, world: w.id, minutes: l.minutes, xp: l.xp });
    });
    if (w.boss && w.boss.status === 'ready') out.push({ id: w.boss.id, dir: `${w.dir}/boss`, world: w.id, xp: w.boss.xp });
  }
  return out;
}
