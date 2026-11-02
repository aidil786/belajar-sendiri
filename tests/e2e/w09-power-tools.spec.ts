// World 9 (Power Tools): step through lessons and finish every interactive, EN and BM.
// The boss ends with a real-world MissionCheck; the GitHub API is mocked (page.route).
// Runs on both projects (360 px phone and desktop).
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page, type Route } from '@playwright/test';

for (const path of [
  '/en/git/power-tools/gh-cli/#c=see-gh',
  '/en/git/power-tools/pages/#c=try-home',
  '/ms/git/power-tools/review-ai-code/#c=try-review',
  '/en/git/power-tools/boss/#c=check-pr',
]) {
  test(`axe: ${path}`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  });
}

const API = 'https://api.github.com';
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
  // A too-wide element also makes phones zoom out; then the layout is wider than the screen.
  const layout = await page.evaluate(() => window.innerWidth);
  expect(layout).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
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

async function swipe(card: Locator, goods: boolean[]) {
  for (const g of goods) await card.locator(g ? '.swipe-good' : '.swipe-bad').click();
}

async function build(card: Locator, pieces: string[]) {
  for (const p of pieces) await card.locator('.builder-piece', { hasText: exact(p) }).click();
}

async function tapAll(card: Locator, selector: string) {
  for (const dot of await card.locator(selector).all()) await dot.click();
}

/** Answer GitHub API calls for the learner "aina-codes" (404 otherwise). Returns the URLs asked for. */
async function mockGithub(page: Page, opts: { pages?: boolean; prs?: number } = {}) {
  const calls: string[] = [];
  await page.route(`${API}/**`, async (route: Route) => {
    const url = route.request().url();
    calls.push(url);
    const path = url.slice(API.length);
    let status = 200;
    let json: unknown = { message: 'Not Found' };
    if (path === '/repos/aina-codes/diary') json = { full_name: 'aina-codes/diary', has_pages: opts.pages ?? false };
    else if (path.startsWith('/search/issues?') && decodeURIComponent(path).includes('author:aina-codes')) json = { total_count: opts.prs ?? 0, items: [] };
    else status = 404;
    await route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(json),
      headers: { 'access-control-allow-origin': '*' },
    });
  });
  return calls;
}

test('9.1 GitHub CLI (EN): sort gh groups, build a command, judge habits', async ({ page }) => {
  await page.goto('/en/git/power-tools/gh-cli/');
  await goTo(page, 'hook');
  await active(page).locator('.choice-btn', { hasText: 'talks to GitHub' }).click();
  await done(page);
  await goTo(page, 'see-gh');
  await expect(active(page).locator('.transcript-screen')).toContainText('https://github.com/aina-codes/diary/issues/5');
  await expect(active(page).getByRole('button', { name: 'Copy command: gh auth login' })).toBeVisible();
  await goTo(page, 'try-sort');
  await sort(active(page), [
    ['Copy a project', 'gh repo'],
    ['Report a bug', 'gh issue'],
    ['Ask to merge', 'gh pr'],
    ['See the open bugs', 'gh issue'],
    ['Make a new repo', 'gh repo'],
    ["teammate's pull request", 'gh pr'],
  ]);
  await done(page);
  await noSideScroll(page);
  await goTo(page, 'try-build');
  // A decoy first: kind feedback, no "wrong".
  await build(active(page), ['gh', 'pr']);
  await expect(active(page).locator('.feedback-almost')).toContainText('work with issues');
  await build(active(page), ['issue', 'list', '--label', 'bug']);
  await done(page);
  await goTo(page, 'predict');
  await active(page).locator('.choice-btn', { hasText: 'new diary folder' }).click();
  await expect(active(page).locator('.feedback-right')).toBeVisible();
  await goTo(page, 'check-habits');
  await swipe(active(page), [true, true, false, false]);
  await done(page);
  await goTo(page, 'win');
});

test('9.2 github.dev and Codespaces (BM): tour the editor, sort, predict', async ({ page }) => {
  await page.goto('/ms/git/power-tools/github-dev-codespaces/');
  await goTo(page, 'see-dot');
  await tapAll(active(page), '.timeline-dot');
  await done(page);
  await goTo(page, 'try-tour');
  await tapAll(active(page), '.hotspot');
  await done(page);
  await noSideScroll(page);
  await goTo(page, 'try-sort');
  await sort(active(page), [
    ['sekelip mata', 'github.dev'],
    ['terminal sebenar', 'Codespace'],
    ['Percuma untuk sesiapa', 'github.dev'],
    ['jalankan ujian', 'Codespace'],
    ['had percuma bulanan', 'Codespace'],
    ['salah ejaan', 'github.dev'],
  ]);
  await done(page);
  await goTo(page, 'predict');
  await active(page).locator('.choice-btn', { hasText: 'Codespace' }).click();
  await expect(active(page).locator('.feedback-right')).toBeVisible();
});

test('9.3 GitHub Pages (EN): order, Markdown home page, real mission (mocked)', async ({ page }) => {
  await mockGithub(page, { pages: true });
  await page.goto('/en/git/power-tools/pages/');
  await goTo(page, 'try-order');
  await order(active(page), ['Open your repo on GitHub', 'Go to Settings, then Pages', 'Pick Deploy from a branch', 'Choose main and the root folder', 'Click Save, then wait a few minutes']);
  await done(page);
  await goTo(page, 'predict');
  await active(page).locator('.choice-btn', { hasText: 'aina-codes.github.io/diary' }).click();
  await expect(active(page).locator('.feedback-right')).toBeVisible();
  await goTo(page, 'try-home');
  await active(page).getByLabel('Your Markdown').fill('# My Diary\n\nSee [my code](https://github.com).\n');
  await expect(active(page).locator('.md-body .md-h1')).toHaveText('My Diary');
  await done(page);
  await noSideScroll(page);
  await goTo(page, 'check-sort');
  await sort(active(page), [
    ['portfolio', 'Pages can host it'],
    ['quiz game', 'Pages can host it'],
    ['database', 'Needs a server'],
    ['saves orders', 'Needs a server'],
    ['Markdown', 'Pages can host it'],
  ]);
  await done(page);
  await goTo(page, 'try-mission');
  await active(page).getByLabel('Your GitHub username').fill('aina-codes');
  await active(page).getByRole('button', { name: 'Check now' }).click();
  await done(page);
  await expect(active(page).locator('.feedback-right')).toContainText('Your site is live!');
});

test('9.4 Desktop and editor tools (EN): ticked files, buttons = commands, real git log', async ({ page }) => {
  await page.goto('/en/git/power-tools/desktop-apps/');
  await goTo(page, 'see-desktop');
  await active(page).locator('.spot-line', { hasText: 'index.html' }).click();
  await active(page).locator('.spot-line', { hasText: 'style.css' }).click();
  await done(page);
  await goTo(page, 'try-sort');
  await sort(active(page), [
    ['Tick a file', 'git add'],
    ['Click +', 'git add'],
    ['Type a summary', 'git commit'],
    ['Click Push', 'git push'],
  ]);
  await done(page);
  await goTo(page, 'check-log');
  await expect(active(page).locator('.replay')).toContainText('Add contact page');
});

test('9.5 Copilot (EN): ask the agent for a test in the practice repo', async ({ page }) => {
  await page.goto('/en/git/power-tools/copilot/');
  await goTo(page, 'see-modes');
  await tapAll(active(page), '.timeline-dot');
  await done(page);
  await goTo(page, 'try-order');
  await order(active(page), ['You write a clear issue', 'You assign the issue to Copilot', 'It works on a branch in the cloud', 'It opens a pull request', 'You review, test and decide']);
  await done(page);
  await goTo(page, 'try-comment');
  const repo = active(page).locator('.prepo');
  await expect(repo.getByText('Practice repo — not a real website')).toBeVisible();
  await repo.getByLabel('Write a comment').fill('Please add a test for an empty entry.');
  await repo.getByRole('button', { name: 'Comment', exact: true }).click();
  await done(page);
  await noSideScroll(page);
  await goTo(page, 'check-safe');
  await swipe(active(page), [true, false, true, false]);
  await done(page);
});

test('9.6 Review AI-written code (EN): spot the key, then request changes', async ({ page }) => {
  await page.goto('/en/git/power-tools/review-ai-code/');
  await goTo(page, 'try-spot');
  await active(page).locator('.spot-line', { hasText: 'export function' }).click();
  await expect(active(page)).not.toHaveAttribute('data-done', 'true');
  await active(page).locator('.spot-line', { hasText: 'API_KEY = ' }).click();
  await done(page);
  await goTo(page, 'try-swipe');
  await swipe(active(page), [true, false, false, true, false]);
  await done(page);
  await goTo(page, 'predict');
  await active(page).locator('.choice-btn', { hasText: 'arrays have no sum' }).click();
  await expect(active(page).locator('.feedback-right')).toBeVisible();
  await goTo(page, 'try-review');
  const repo = active(page).locator('.prepo');
  await expect(repo.locator('.prepo-diff')).toContainText('fake_demo_key_123');
  await repo.getByRole('button', { name: 'Conversation' }).click();
  await expect(repo.locator('.prepo-timeline')).toContainText('No problems found.');
  await repo.getByRole('radio', { name: 'Request changes' }).check();
  await repo.getByRole('button', { name: 'Submit review' }).click();
  await expect(active(page).locator('.feedback-almost')).toBeVisible(); // kind nudge: say what to fix
  await repo.getByLabel('Write a comment').fill('Please move the key into a secret.');
  await repo.getByRole('button', { name: 'Submit review' }).click();
  await done(page);
  await noSideScroll(page);
  await goTo(page, 'check');
  await active(page).locator('.choice-btn', { hasText: 'AI review can miss things' }).click();
  await expect(active(page).locator('.feedback-right')).toBeVisible();
});

test('Boss (EN): ship with gh and a Codespace, then GitHub sees the pull request', async ({ page }) => {
  const calls = await mockGithub(page, { prs: 0 });
  await page.goto('/en/git/power-tools/boss/');
  await goTo(page, 'hook');
  await tapAll(active(page), '.timeline-dot');
  await done(page);
  await goTo(page, 'see-codespace');
  await expect(active(page).locator('.transcript-screen')).toContainText('gh codespace create --repo YOUR-NAME/diary');
  await goTo(page, 'try-order');
  await order(active(page), ['Make a branch: git switch -c fix-typo', 'Fix the typo in README.md', 'Commit the fix', 'Push the branch', 'Run gh pr create']);
  await done(page);
  await noSideScroll(page);
  await goTo(page, 'try-build');
  await build(active(page), ['gh', 'pr', 'create', '--fill']);
  await done(page);
  await goTo(page, 'see-pr');
  await expect(active(page).locator('.transcript-screen')).toContainText('https://github.com/YOUR-NAME/diary/pull/1');
  await goTo(page, 'predict');
  await active(page).locator('.choice-btn', { hasText: 'Your commit message' }).click();
  await expect(active(page).locator('.feedback-right')).toBeVisible();
  await goTo(page, 'try-mission');
  for (const box of await active(page).locator('.mission-check input').all()) await box.check();
  await done(page);
  await noSideScroll(page);

  await goTo(page, 'check-pr');
  const card = active(page);
  await card.getByLabel('Your GitHub username').fill('aina-codes');
  await card.getByRole('button', { name: 'Check now' }).click();
  const items = card.locator('.ghc-item');
  await expect(items.nth(0)).toContainText('Done');
  await expect(items.nth(1)).toContainText('We found 0. You need 1.');
  await expect(card).not.toHaveAttribute('data-done', 'true');

  // The learner opens the pull request, then checks again.
  await page.unroute(`${API}/**`);
  await mockGithub(page, { prs: 1 });
  await card.getByRole('button', { name: 'Check now' }).click();
  await expect(items.nth(1)).toContainText('Done');
  await done(page);
  await expect(card.locator('.feedback-right')).toContainText('Boss beaten!');
  expect(calls.every((c) => c.startsWith(API))).toBe(true);
  await goTo(page, 'win');
});

test('Boss (BM): route, build the command, mission check (mocked)', async ({ page }) => {
  await mockGithub(page, { prs: 2 });
  await page.goto('/ms/git/power-tools/boss/');
  await goTo(page, 'try-order');
  await order(active(page), ['Buat branch: git switch -c fix-typo', 'Baiki salah ejaan dalam README.md', 'Commit pembaikan itu', 'Push branch itu', 'Jalankan gh pr create']);
  await done(page);
  await goTo(page, 'try-build');
  await build(active(page), ['gh', 'pr', 'create', '--fill']);
  await done(page);
  await goTo(page, 'check-pr');
  await active(page).getByLabel('Nama pengguna GitHub anda').fill('aina-codes');
  await active(page).getByRole('button', { name: 'Semak sekarang' }).click();
  await done(page);
  await expect(active(page).locator('.feedback-right')).toContainText('Boss tewas!');
  await noSideScroll(page);
});
