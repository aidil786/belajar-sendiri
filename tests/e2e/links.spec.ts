// Every internal link on the main pages answers 200 (no broken links, no missing lessons).
import { expect, test } from '@playwright/test';

const SHIP_IT = ['docker', 'cicd', 'kubernetes'].flatMap((c) => [`${c}/`, `${c}/glossary/`, `${c}/commands/`, `${c}/cheatsheet/`]);
const LEVEL_UP = ['linux', 'iac', 'observability', 'aws'].flatMap((c) => [`${c}/`, `${c}/glossary/`, `${c}/commands/`, `${c}/cheatsheet/`]);
const PAGES = ['', 'git/', 'glossary/', 'commands/', 'cheatsheet/', 'rescue/', 'review/', 'settings/', 'ship-it/', 'ship-it/rescue/', ...SHIP_IT, 'level-up/', 'level-up/rescue/', ...LEVEL_UP];

test('every internal link on the main pages works', { tag: '@desktop-only' }, async ({ page, request, baseURL }) => {
  test.setTimeout(180_000);
  const origin = new URL(baseURL!).origin;
  const found = new Map<string, string>(); // url → first page that links to it
  for (const lang of ['en', 'ms']) {
    for (const p of PAGES) {
      const from = `/${lang}/${p}`;
      const res = await page.goto(from, { waitUntil: 'domcontentloaded' });
      expect(res?.status(), from).toBe(200);
      const hrefs = await page.locator('a[href]').evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href));
      for (const href of hrefs) {
        const url = new URL(href);
        if (url.origin !== origin) continue;
        url.hash = '';
        if (!found.has(url.href)) found.set(url.href, from);
      }
    }
  }
  expect(found.size).toBeGreaterThan(50);
  const broken: string[] = [];
  const urls = [...found.keys()];
  // A few at a time keeps it quick without flooding the preview server.
  for (let i = 0; i < urls.length; i += 8) {
    await Promise.all(
      urls.slice(i, i + 8).map(async (url) => {
        const res = await request.get(url, { maxRedirects: 0 });
        if (res.status() !== 200) broken.push(`${res.status()} ${new URL(url).pathname} (linked from ${found.get(url)})`);
      }),
    );
  }
  expect(broken).toEqual([]);
});
