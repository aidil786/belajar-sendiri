// Content collections: lessons (MDX, one file per language), course outlines,
// glossaries, command pages and rescue flows. All course content lives in
// src/content/courses/<course>/ so a second course can reuse every component.
import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';
import { RESCUE_GROUPS } from './lib/rescue';
import { HATS, TOOLS } from './lib/catalog';

const bilingual = z.object({ en: z.string(), ms: z.string() });

/** Tools a lesson can be checked against (src/lib/catalog.ts). The Git course uses gitVersion instead. */
export { TOOLS };

const lessons = defineCollection({
  // id: git/w01-save-points/03-the-box/en
  loader: glob({ base: './src/content/courses', pattern: '**/*.mdx', generateId: ({ entry }) => entry.replace(/\.mdx$/, '') }),
  schema: z
    .object({
      id: z.string(),
      world: z.number().int(),
      title: z.string(),
      summary: z.string(),
      minutes: z.number().int().min(1).max(10),
      xp: z.number().int(),
      interactives: z.array(z.string()).default([]),
      needs: z.array(z.string()).default([]),
      scenario: z.string().optional(),
      /** Git course: the Git version the lesson was checked against. */
      gitVersion: z.string().optional(),
      /** Ship It: the tool and version the lesson was checked against (shown in the lesson frame). */
      tool: z.enum(TOOLS).optional(),
      toolVersion: z.string().optional(),
      lastChecked: z.coerce.date(),
      bmReviewed: z.boolean(),
      kind: z.enum(['lesson', 'boss']).default('lesson'),
      docs: z.array(z.object({ label: z.string(), url: z.url() })).default([]),
    })
    .refine((d) => Boolean(d.gitVersion) || Boolean(d.tool && d.toolVersion), {
      message: 'Set gitVersion (Git course) or tool + toolVersion (Ship It courses)',
    }),
});

const lessonRef = z.object({
  id: z.string(),
  slug: z.string(),
  title: bilingual,
  minutes: z.number().int(),
  xp: z.number().int(),
  status: z.enum(['ready', 'soon']),
  /** Capstone missions (Kedai Kancil): Ship It 1–6, Level Up 7–10. The map shows an "M1" tag. */
  mission: z.number().int().min(1).max(10).optional(),
});

const courses = defineCollection({
  loader: glob({ base: './src/content/courses', pattern: '*/course.yaml', generateId: ({ entry }) => entry.split('/')[0]! }),
  schema: z.object({
    id: z.string(),
    title: bilingual,
    summary: bilingual,
    /** World map intro. Without it, the Git course text from i18n is used. */
    intro: bilingual.optional(),
    /** Courses shown together on one map (Ship It = docker + cicd + kubernetes). */
    family: z.string().optional(),
    /** Part number inside the family (1, 2, 3) and its name (Dapur, Kilang, Medan Selera). */
    part: z.number().int().optional(),
    partName: bilingual.optional(),
    /** One line of the food story for this part. */
    story: bilingual.optional(),
    /** Kancil's hat or outfit in this course (src/lib/catalog.ts HATS). */
    hat: z.enum(HATS).optional(),
    /** Default tool + version for lessons that don't set their own. */
    tool: z.enum(TOOLS).optional(),
    toolVersion: z.string().optional(),
    /** The placement test (a lesson or boss id). Home links to it. */
    placement: z.string().optional(),
    /** A gentle "best after" hint (other courses' worlds). Never a lock. */
    requires: z.array(z.object({ course: z.string(), worlds: z.array(z.number().int()).default([]) })).default([]),
    worlds: z.array(
      z.object({
        id: z.number().int(),
        /** Short code shown on maps: "D1" → "World D1". Without it, the id is shown. */
        code: z.string().optional(),
        /** The finish line (Career Quest): drawn in its own box on the family map. */
        finale: z.boolean().default(false),
        /** An optional extra pack (CKA = K9): tagged "Extra pack" on the maps. Never locked. */
        extra: z.boolean().default(false),
        slug: z.string(),
        dir: z.string(),
        icon: z.string(),
        color: z.enum(['working', 'staging', 'repo', 'remote', 'head', 'danger']),
        title: bilingual,
        summary: bilingual,
        topics: bilingual.optional(),
        openAnyTime: z.boolean().default(false),
        lessons: z.array(lessonRef),
        boss: z
          .object({
            id: z.string(),
            title: bilingual,
            summary: bilingual,
            xp: z.number().int(),
            status: z.enum(['ready', 'soon', 'none']),
          })
          .optional(),
      }),
    ),
    badges: z.array(
      z.object({
        id: z.string(),
        icon: z.string(),
        /** Badge name. Without it, i18n `badge.<id>` is used (Git course). */
        name: bilingual.optional(),
        when: z.object({ lessons: z.array(z.string()).optional(), world: z.number().int().optional() }),
      }),
    ),
  }),
});

/**
 * A list that may still be empty in the file: `terms:` followed only by world marker comments
 * reads as null, so a new course's glossary, commands and rescue files can start with just
 * the markers. Helpers then add entries under their marker without touching the key line.
 */
const listOf = <T extends z.ZodType>(item: T) => z.preprocess((v) => v ?? [], z.array(item));

const glossary = defineCollection({
  loader: glob({ base: './src/content/glossary', pattern: '*.yaml', generateId: ({ entry }) => entry.replace(/\.yaml$/, '') }),
  schema: z.object({
    terms: listOf(
      z.object({
        id: z.string(),
        en: z.object({ term: z.string(), meaning: z.string() }),
        ms: z.object({ term: z.string(), meaning: z.string() }),
        world: z.number().int().optional(),
        /** Ids that mean nearly the same: daily review never offers one as a wrong answer for the other. */
        confusable: z.array(z.string()).default([]),
      }),
    ),
  }),
});

const commands = defineCollection({
  loader: glob({ base: './src/content/courses', pattern: '*/commands.yaml', generateId: ({ entry }) => entry.split('/')[0]! }),
  schema: z.object({
    groups: listOf(z.object({ id: z.string(), title: bilingual })),
    commands: listOf(
      z.object({
        id: z.string(),
        group: z.string(),
        syntax: z.string(),
        danger: z.enum(['safe', 'careful', 'lose']),
        lesson: z.string().optional(),
        /** Ids that mean nearly the same: daily review never offers one as a wrong answer for the other. */
        confusable: z.array(z.string()).default([]),
        docs: z.url(),
        what: bilingual,
        when: bilingual,
        example: z.object({ command: z.string(), en: z.string(), ms: z.string() }),
        variants: z.array(z.object({ command: z.string(), en: z.string(), ms: z.string() })).default([]),
      }),
    ),
  }),
});

const rescueStep = z.object({
  id: z.string(),
  question: bilingual.optional(),
  answers: z.array(z.object({ label: bilingual, next: z.string() })).optional(),
  result: z
    .object({
      text: bilingual,
      commands: z.array(z.object({ command: z.string(), en: z.string(), ms: z.string() })),
      danger: z.enum(['safe', 'careful', 'lose']),
      lesson: z.string().optional(),
    })
    .optional(),
});

// Rescue Center sections (commits, branches, remote, secrets, setup), in page order.
// Flows without a group go under "Other problems".
const rescue = defineCollection({
  loader: glob({ base: './src/content/courses', pattern: '*/rescue.yaml', generateId: ({ entry }) => entry.split('/')[0]! }),
  schema: z.object({
    flows: listOf(
      z.object({
        id: z.string(),
        title: bilingual,
        group: z.enum(RESCUE_GROUPS).optional(),
        start: z.string(),
        steps: z.array(rescueStep),
      }),
    ),
  }),
});

export const collections = { lessons, courses, glossary, commands, rescue };
