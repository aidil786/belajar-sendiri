// Card ids (and types) must match between en.mdx and ms.mdx: Peek depends on it.
// Also checks that every "ready" lesson in course.yaml has both files with matching frontmatter.
import { cards, courseDirs, courseYaml, expectedDirs, frontmatter, lessonFiles, ROOT_COURSE } from '../lib/lessons';

const files = lessonFiles();
const errors: string[] = [];
const byKey = new Map<string, { en?: (typeof files)[number]; ms?: (typeof files)[number] }>();
for (const f of files) {
  const key = `${f.course}/${f.dir}`;
  const entry = byKey.get(key) ?? {};
  entry[f.lang] = f;
  byKey.set(key, entry);
}

for (const [key, pair] of byKey) {
  if (!pair.en || !pair.ms) {
    errors.push(`${key}: needs both en.mdx and ms.mdx`);
    continue;
  }
  const a = cards(pair.en.text);
  const b = cards(pair.ms.text);
  const sa = a.map((c) => `${c.id}:${c.type}`).join(', ');
  const sb = b.map((c) => `${c.id}:${c.type}`).join(', ');
  if (sa !== sb) errors.push(`${key}: card ids/types differ\n  en: ${sa}\n  ms: ${sb}`);
  const dup = a.map((c) => c.id).filter((id, i, all) => all.indexOf(id) !== i);
  if (dup.length) errors.push(`${key}: duplicate card ids: ${dup.join(', ')}`);
  const main = a.filter((c) => c.type !== 'deeper');
  if (main.length < 6 || main.length > 10) errors.push(`${key}: has ${main.length} cards (want 6–10, not counting deeper)`);
  if (main[0]?.type !== 'hook' && main[0]?.type !== 'try') errors.push(`${key}: first card should be the hook`);
  if (main[main.length - 1]?.type !== 'win') errors.push(`${key}: last card should be the win card`);
  const fa = frontmatter(pair.en.text);
  const fb = frontmatter(pair.ms.text);
  for (const field of ['id', 'world', 'minutes', 'xp', 'scenario', 'kind', 'tool', 'toolVersion', 'gitVersion']) {
    if (JSON.stringify(fa[field]) !== JSON.stringify(fb[field])) errors.push(`${key}: frontmatter "${field}" differs between en and ms`);
  }
  if (fb.bmReviewed !== false && fb.bmReviewed !== true) errors.push(`${key}: ms.mdx needs bmReviewed`);
  // Ship It lessons say which tool version they were checked against; Git lessons say which Git.
  if (pair.en.course === ROOT_COURSE) {
    if (!fa.gitVersion) errors.push(`${key}: Git lessons need gitVersion`);
  } else if (!fa.tool || !fa.toolVersion) errors.push(`${key}: needs tool and toolVersion in the frontmatter`);
}

// Every course with an outline, even one with no lesson files yet.
const courses = new Set([...files.map((f) => f.course), ...courseDirs()]);
for (const course of courses) {
  const c = courseYaml(course);
  if (!c) continue;
  for (const exp of expectedDirs(c)) {
    const pair = byKey.get(`${course}/${exp.dir}`);
    if (!pair?.en || !pair.ms) {
      errors.push(`${course}/${exp.dir}: listed as ready in course.yaml but files are missing`);
      continue;
    }
    const fm = frontmatter(pair.en.text);
    if (fm.id !== exp.id) errors.push(`${course}/${exp.dir}: id "${String(fm.id)}" should be "${exp.id}"`);
    if (fm.world !== exp.world) errors.push(`${course}/${exp.dir}: world should be ${exp.world}`);
    if (fm.xp !== exp.xp) errors.push(`${course}/${exp.dir}: xp should be ${exp.xp} (course.yaml)`);
    if (exp.minutes !== undefined && fm.minutes !== exp.minutes) errors.push(`${course}/${exp.dir}: minutes should be ${exp.minutes} (course.yaml)`);
  }
}

if (errors.length) {
  console.error(`✗ Card id check failed (${errors.length}):\n${errors.map((e) => `- ${e}`).join('\n')}`);
  process.exit(1);
}
console.log(`✓ Card ids match in ${byKey.size} lessons (en + ms).`);
