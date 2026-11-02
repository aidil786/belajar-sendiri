// /en/lessons.json, /ms/lessons.json: every lesson page in one language (all courses), plus the
// pages you need to find your way. Settings uses it for "Save all lessons for offline use".
import type { APIRoute, GetStaticPaths } from 'astro';
import { LANGS, type Lang } from '~/i18n';
import { lessonPages } from '~/lib/content';
import { getCourses } from '~/lib/course';
import { courseMapHref, toolHref } from '~/lib/catalog';

export const getStaticPaths = (() => LANGS.map((lang) => ({ params: { lang } }))) satisfies GetStaticPaths;

export const GET: APIRoute = async ({ params }) => {
  const lang = params.lang as Lang;
  const lessons = await lessonPages(lang);
  const tools = new Set<string>([`/${lang}/`, `/${lang}/review/`]);
  for (const course of await getCourses()) {
    tools.add(courseMapHref(lang, course.id));
    if (course.family) tools.add(`/${lang}/${course.family}/`);
    for (const page of ['glossary', 'cheatsheet', 'commands', 'rescue'] as const) tools.add(toolHref(lang, course, page));
  }
  return new Response(JSON.stringify({ lang, lessons, pages: [...tools, ...lessons] }), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};
