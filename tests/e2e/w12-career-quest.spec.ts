// World 12 (Career Quest): step through key lessons and finish their interactives, EN and BM.
// Runs on both projects (360 px phone and desktop). The GitHub API is answered by page.route.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page, type Route } from '@playwright/test';

const API = 'https://api.github.com';

for (const path of ['/en/git/career-quest/profile-readme/#c=try-write', '/ms/git/career-quest/first-oss-pr/#c=try-ask', '/en/git/career-quest/boss/#c=check-real']) {
  test(`axe: ${path}`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  });
}

const active = (page: Page) => page.locator('.lesson-card.is-active');
const next = (page: Page) => page.locator('[data-next]').click();
const goTo = async (page: Page, id: string) => {
  for (let i = 0; i < 15; i++) {
    if ((await active(page).getAttribute('data-card-id')) === id) break;
    await next(page);
  }
  await expect(active(page)).toHaveAttribute('data-card-id', id);
  await expect(active(page).locator('astro-island[ssr]')).toHaveCount(0); // hydrated
};
const done = (page: Page) => expect(active(page)).toHaveAttribute('data-done', 'true');
const exact = (text: string) => new RegExp(`^\\s*${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`);

async function noSideScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

async function sort(card: Locator, items: [string, string][]) {
  for (const [label, bucket] of items) {
    await card.locator('.sort-card', { hasText: label }).click();
    await card.locator('.sort-bucket-head', { hasText: exact(bucket) }).click();
  }
}

async function order(card: Locator, want: string[]) {
  for (let i = 0; i < want.length; i++) {
    const texts = (await card.locator('.order-item .order-text').allInnerTexts()).map((t) => t.trim());
    for (let j = texts.indexOf(want[i]!); j > i; j--) await card.locator('.order-item').nth(j).locator('.order-btn').first().click();
  }
  await card.locator('.order .btn').click();
}

async function build(card: Locator, pieces: string[]) {
  for (const p of pieces) await card.locator('.builder-piece', { hasText: exact(p) }).click();
}

/** Answer GitHub API calls from a map of path → JSON (404 otherwise). Returns the URLs called. */
async function mockGithub(page: Page, answers: Record<string, unknown>) {
  const calls: string[] = [];
  await page.route(`${API}/**`, async (route: Route) => {
    const url = route.request().url();
    calls.push(url);
    const path = url.slice(API.length);
    const hit = Object.entries(answers).find(([p]) => path.startsWith(p));
    await route.fulfill({
      status: hit ? 200 : 404,
      contentType: 'application/json',
      body: JSON.stringify(hit ? hit[1] : { message: 'Not Found' }),
      headers: { 'access-control-allow-origin': '*' },
    });
  });
  return calls;
}

test('12.1 profile README (EN): spot, name, sort, write Markdown, check GitHub', async ({ page }) => {
  const calls = await mockGithub(page, { '/repos/aina-codes/aina-codes/readme': {}, '/repos/aina-codes/aina-codes': {} });
  await page.goto('/en/git/career-quest/profile-readme/');
  await goTo(page, 'hook');
  for (const line of ['Bio: (empty)', 'repo: test2', 'repo: asdf']) await active(page).locator('.spot-line', { hasText: line }).click();
  await done(page);

  await goTo(page, 'predict-name');
  await active(page).locator('.choice-btn', { hasText: 'profile' }).first().click();
  await expect(active(page).locator('.feedback-almost')).toBeVisible();
  await active(page).locator('.choice-btn', { hasText: /aiman-dev\s*$/ }).click();
  await done(page);

  await goTo(page, 'try-sort');
  await sort(active(page), [
    ['One line about you', 'Put it in'],
    ['What you are learning now', 'Put it in'],
    ['Links to your best', 'Put it in'],
    ['Your home address', 'Leave it out'],
    ['Your phone number', 'Leave it out'],
    ['50 badges and gifs', 'Leave it out'],
  ]);
  await done(page);

  await goTo(page, 'try-write');
  const card = active(page);
  await card.getByRole('button', { name: 'Check', exact: true }).click();
  await expect(card.locator('.feedback-almost')).toContainText('Swap YOUR NAME');
  const src = card.getByLabel('Your Markdown');
  await src.fill((await src.inputValue()).replace('YOUR NAME', 'Aina') + '\nNow learning: Git\n');
  await expect(card.locator('.mdplay-preview-box')).toContainText('Hi, I am Aina');
  await done(page);
  await noSideScroll(page);

  await goTo(page, 'check-real');
  await active(page).getByLabel('Your GitHub username').fill('aina-codes');
  await active(page).getByRole('button', { name: 'Check now' }).click();
  await done(page);
  expect(calls.every((u) => u.startsWith(`${API}/`))).toBe(true);
});

test('12.3 first open-source PR (BM): ask on the issue, order the path, build the push', async ({ page }) => {
  await page.goto('/ms/git/career-quest/first-oss-pr/');
  await goTo(page, 'try-ask');
  const repo = active(page);
  await expect(repo.locator('.prepo-box-head')).toContainText('CONTRIBUTING.md');
  await repo.getByRole('button', { name: /^Issues/ }).click();
  await repo.getByRole('button', { name: /Fix typo in README/ }).click();
  await repo.getByLabel('Tulis komen').fill('Boleh saya ambil yang ini?');
  await repo.getByRole('button', { name: 'Komen', exact: true }).click();
  await done(page);
  await noSideScroll(page);

  await goTo(page, 'try-order');
  await order(active(page), [
    'Fork projek ke akaun anda',
    'Clone fork anda',
    'Buat branch baru',
    'Buat satu perubahan kecil dan commit',
    'Push branch ke fork anda',
    'Buka pull request',
    'Balas semakan dengan baik',
  ]);
  await done(page);

  await goTo(page, 'try-push');
  await build(active(page), ['git', 'push', '-u', 'origin', 'fix-readme-typo']);
  await done(page);
});

test('12.6 docs and changelogs (EN): commit the changelog in the simulator', async ({ page }) => {
  await page.goto('/en/git/career-quest/docs-changelogs/');
  await goTo(page, 'try-sort');
  await sort(active(page), [
    ['export to PDF', 'Added'],
    ['Malay translation', 'Added'],
    ['twice as fast', 'Changed'],
    ['Settings moved', 'Changed'],
    ['crash on empty notes', 'Fixed'],
    ['right time zone', 'Fixed'],
  ]);
  await done(page);

  await goTo(page, 'try-commit');
  const input = active(page).locator('.term-input');
  await expect(active(page).locator('.xterm')).toBeVisible();
  for (const c of ['git add CHANGELOG.md', 'git commit -m "docs: add changelog"']) {
    await input.fill(c);
    await input.press('Enter');
  }
  await done(page);
});

test('boss (EN): pick an issue, build the commit, check the PR on GitHub', async ({ page }) => {
  await mockGithub(page, { '/search/issues': { total_count: 1 } });
  await page.goto('/en/git/career-quest/boss/');
  await goTo(page, 'try-pick');
  await active(page).locator('.choice-btn', { hasText: 'Rewrite the database layer' }).click();
  await expect(active(page).locator('.feedback-almost')).toContainText('Too big');
  await active(page).locator('.choice-btn', { hasText: 'Fix a broken link' }).click();
  await done(page);

  await goTo(page, 'try-commit');
  await build(active(page), ['git', 'commit', '-m', '"docs: fix install link"']);
  await done(page);
  await noSideScroll(page);

  await goTo(page, 'check-real');
  await active(page).getByLabel('Your GitHub username').fill('aina-codes');
  await active(page).getByRole('button', { name: 'Check now' }).click();
  await done(page);
  await goTo(page, 'win');
  await expect(page.locator('[data-win-xp]')).toHaveText('+50 XP');
});
