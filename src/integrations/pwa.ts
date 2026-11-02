// Astro integration: after the build, fill dist/sw.js with a build id and the
// app-shell file list (home EN/MS, review, offline page, their CSS/JS, icons).
// A new build id means new cache names, so learners always get fresh files.
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AstroIntegration } from 'astro';

/** Pages that should work offline from the first visit. */
export const SHELL_PAGES = ['/', '/en/', '/ms/', '/en/review/', '/ms/review/', '/offline/'];
export const SHELL_FILES = ['/manifest.webmanifest', '/favicon.svg', '/icons/icon-192.png', '/icons/icon-512.png'];

const BUILD_MARK = "'__FAHAMLAH_BUILD__'";
const PRECACHE_MARK = "['__FAHAMLAH_PRECACHE__']";

/** Hashed build files referenced by HTML or JS: "/_astro/x.AbCd1234.js" or "./x.AbCd1234.js". */
export function assetRefs(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/["'`(](?:\/_astro\/|\.\/)([\w@.-]+\.[\w-]{8}\.(?:js|css))["'`)]/g)) out.add(`/_astro/${m[1]}`);
  return [...out];
}

/** The basic Latin font files a stylesheet uses (other scripts load on demand). */
export function latinFonts(css: string): string[] {
  const out = new Set<string>();
  for (const m of css.matchAll(/url\((?:["']?)(\/_astro\/[\w@.-]+-latin-wght-normal\.[\w-]{8}\.woff2)/g)) out.add(m[1]!);
  return [...out];
}

export function fillServiceWorker(template: string, build: string, precache: string[]): string {
  if (!template.includes(BUILD_MARK) || !template.includes(PRECACHE_MARK)) {
    throw new Error('public/sw.js is missing the __FAHAMLAH_BUILD__ / __FAHAMLAH_PRECACHE__ markers');
  }
  return template.replace(BUILD_MARK, JSON.stringify(build)).replace(PRECACHE_MARK, JSON.stringify(precache));
}

/** "/en/" → "en/index.html", "/manifest.webmanifest" → "manifest.webmanifest". */
export function fileFor(path: string): string {
  return path.endsWith('/') ? `${path.slice(1)}index.html` : path.slice(1);
}

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)])));
  return nested.flat();
}

export async function writeServiceWorker(root: string): Promise<{ build: string; precache: string[] }> {
  const read = (path: string) => readFile(join(root, fileFor(path)), 'utf8');
  // Build id: a hash of every output file, so any change makes new caches.
  const files = (await walk(root)).filter((f) => relative(root, f) !== 'sw.js').sort();
  const hash = createHash('sha256');
  for (const f of files) {
    hash.update(relative(root, f).split(sep).join('/'));
    hash.update(await readFile(f));
  }
  const build = hash.digest('hex').slice(0, 12);

  // Shell pages + the CSS/JS they load (and what that JS imports) + fonts.
  const assets = new Set<string>();
  const queue: string[] = [];
  for (const p of SHELL_PAGES) queue.push(...assetRefs(await read(p)));
  while (queue.length) {
    const a = queue.shift()!;
    if (assets.has(a)) continue;
    assets.add(a);
    const text = await read(a);
    if (a.endsWith('.js')) queue.push(...assetRefs(text));
    else for (const font of latinFonts(text)) assets.add(font);
  }
  const precache = [...SHELL_PAGES, ...SHELL_FILES, ...[...assets].sort()];
  const swPath = join(root, 'sw.js');
  await writeFile(swPath, fillServiceWorker(await readFile(swPath, 'utf8'), build, precache));
  return { build, precache };
}

export default function pwa(): AstroIntegration {
  return {
    name: 'fahamlah-pwa',
    hooks: {
      'astro:build:done': async ({ dir, logger }) => {
        const { build, precache } = await writeServiceWorker(fileURLToPath(dir));
        logger.info(`sw.js: build ${build}, ${precache.length} files precached`);
      },
    },
  };
}
