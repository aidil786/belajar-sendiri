// CI/CD World C4 (Pipeline Shields): step through lessons and finish their games, plus the
// CI/CD Rescue Center flows. Runs on both projects (360 px phone and desktop).
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';

for (const path of ['/en/cicd/pipeline-shields/least-permissions/#c=try-fix', '/ms/cicd/pipeline-shields/boss/#c=try-spot', '/en/ship-it/rescue/#ci-secret-in-logs']) {
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
const done = (page: Page) => expect(active(page)).toHaveAttribute('data-done', 'true', { timeout: 20_000 });
const exact = (text: string) => new RegExp(`^\\s*${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`);
const run = (card: Locator) => card.getByRole('button', { name: /^▶ Run/ }).click();

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

async function stack(card: Locator, labels: string[]) {
  for (const l of labels) await card.locator('.yb-pick').filter({ has: card.page().locator('.yb-label', { hasText: exact(l) }) }).click();
}

async function swipe(card: Locator, goods: boolean[]) {
  for (const g of goods) await card.locator(g ? '.swipe-good' : '.swipe-bad').click();
}

test('C4.4 least privilege (EN): the real error, a fix on the belt, the job keys', async ({ page }) => {
  await page.goto('/en/cicd/pipeline-shields/least-permissions/');
  await goTo(page, 'hook');
  await expect(active(page)).toContainText('Resource not accessible by integration');
  await active(page).locator('.choice-btn', { hasText: "may not open this door" }).click();
  await done(page);
  await goTo(page, 'see-least');
  await sort(active(page), [
    ['Create a release', 'contents: write'],
    ['Comment on a PR', 'pull-requests: write'],
    ['Add a label to a PR', 'pull-requests: write'],
    ['Push an image to GHCR', 'packages: write'],
  ]);
  await done(page);
  await goTo(page, 'see-levels');
  await active(page).locator('.spot-line', { hasText: '      contents: write' }).click();
  await done(page);

  await goTo(page, 'try-fix');
  const belt = active(page);
  await expect(belt.locator('.cv-line.is-fix')).toHaveCount(2);
  await belt.getByLabel('write-all', { exact: true }).check();
  await run(belt);
  await expect(belt.locator('.feedback-almost')).toContainText('more keys than the job needs', { timeout: 20_000 });
  await belt.getByLabel('contents: read + packages: write').check();
  await run(belt);
  await expect(belt.locator('.cv-real').first()).toContainText('Resource not accessible by integration', { timeout: 20_000 });
  await belt.getByLabel('contents: write', { exact: true }).check();
  await run(belt);
  await done(page);
  await noSideScroll(page);

  await goTo(page, 'try-build');
  const yb = active(page);
  await stack(yb, ['On pull request', 'Whole file: write lots']);
  await yb.locator('.yb-run').click();
  await expect(yb.locator('.feedback-almost')).toContainText('No job here changes code or packages');
  await yb.locator('.yb-stack .yb-item').last().getByRole('button', { name: /Remove|Buang/ }).click();
  await stack(yb, ['Whole file: read code', 'Job: report', 'This job: read code, write PRs', 'Check out code', 'Install and test', 'Comment on the PR']);
  await yb.locator('.yb-run').click();
  await done(page);
  await expect(yb.locator('.yb-yaml')).toContainText('pull-requests: write');
});

test('C4.5 forks (EN): a fork PR stops safely; pull_request_target runs green', async ({ page }) => {
  await page.goto('/en/cicd/pipeline-shields/pull-request-target/');
  await goTo(page, 'try-fork');
  const belt = active(page);
  await run(belt);
  await expect(belt.locator('.cv-summary')).toContainText('Run passed', { timeout: 20_000 });
  await belt.getByLabel('Pull request from a fork').check();
  await run(belt);
  await done(page);
  await expect(belt.locator('.cv-summary')).toContainText('no secrets');
  await goTo(page, 'see-green');
  await run(active(page));
  await expect(active(page).locator('.cv-summary')).toContainText('Run passed', { timeout: 20_000 });
  await goTo(page, 'try-spot');
  await active(page).locator('.sth-line').nth(3).locator('.sth-btn').click();
  await active(page).locator('.sth-line').nth(10).locator('.sth-btn').click();
  await done(page);
});

test('C4.7 masking (MS): the log shows *** for the token', async ({ page }) => {
  await page.goto('/ms/cicd/pipeline-shields/secrets-in-logs/');
  await goTo(page, 'see-mask');
  const belt = active(page);
  await run(belt);
  await expect(belt.locator('.cv-summary')).toBeVisible({ timeout: 20_000 });
  await belt.locator('.cv-station-btn', { hasText: 'echo' }).click();
  await expect(belt.locator('.cv-term')).toContainText('Using token ***');
  await expect(belt.locator('.cv-term')).not.toContainText('fl-secret');
  await done(page);
});

test('C4 boss (EN): spot 5 holes, build the fix, prove it green with one key', async ({ page }) => {
  await page.goto('/en/cicd/pipeline-shields/boss/');
  await goTo(page, 'try-spot');
  const spot = active(page);
  await expect(spot.locator('.sth-count')).toContainText('Holes found: 0 of 5');
  // A safe line first: kind words, no red.
  await spot.locator('.sth-line').nth(0).locator('.sth-btn').click();
  await expect(spot.locator('.feedback-almost')).toContainText('Line 1 is safe');
  for (const n of [4, 7, 11, 12, 13]) await spot.locator('.sth-line').nth(n - 1).locator('.sth-btn').click();
  await done(page);
  await expect(spot.locator('.sth-line.is-found')).toHaveCount(5);
  await spot.getByRole('button', { name: 'Show the fixed workflow' }).click();
  await expect(spot.locator('.sth-fixed-code')).toContainText('TITLE: ${{ github.event.pull_request.title }}');
  await noSideScroll(page);

  await goTo(page, 'try-build');
  const yb = active(page);
  await stack(yb, ['On pull_request_target']);
  await yb.locator('.yb-run').click();
  await expect(yb.locator('.feedback-almost')).toContainText("hands your keys to the stranger's code");
  await yb.locator('.yb-stack .yb-item').last().getByRole('button', { name: /Remove/ }).click();
  await stack(yb, ['On pull_request', 'Read code only', 'Job on a hosted runner', 'Check out code', 'Size check (pinned)', 'Print the title (in env)', 'Install and test']);
  await yb.locator('.yb-run').click();
  await done(page);

  await goTo(page, 'try-prove');
  const belt = active(page);
  await run(belt);
  await expect(belt.locator('.cv-real').first()).toContainText('Resource not accessible by integration', { timeout: 20_000 });
  await belt.getByLabel('contents: read + pull-requests: write').check();
  await run(belt);
  await done(page);

  await goTo(page, 'check');
  await swipe(active(page), [true, false, true, false, true]);
  await done(page);
});

test('ship-it rescue: CI/CD flows open by link, give safe steps and link their lesson', async ({ page }) => {
  await page.goto('/en/ship-it/rescue/#ci-secret-in-logs');
  const step = page.locator('[data-rescue-step]');
  await step.getByRole('button', { name: 'The real value, or an encoded copy' }).click();
  await step.getByRole('button', { name: 'Yes, public' }).click();
  await expect(step).toContainText('gh secret set CLOUDFLARE_API_TOKEN');
  await expect(step.getByRole('link', { name: 'Secrets in logs' })).toHaveAttribute('href', '/en/cicd/pipeline-shields/secrets-in-logs/');
  await expect(page.locator('[data-rescue-group="cicd"] [data-rescue-flow]')).toHaveCount(8);

  await page.goto('/ms/ship-it/rescue/');
  await page.locator('[data-rescue-filter]').fill('integration');
  await expect(page.locator('[data-rescue-flow]:visible')).toHaveCount(1);
  await page.locator('[data-rescue-flow="ci-resource-not-accessible"]').click();
  await page.getByRole('button', { name: 'Push atau pull request saya sendiri' }).click();
  await page.getByRole('button', { name: 'Komen atau label PR' }).click();
  await expect(page.locator('.rescue-result')).toContainText('pull-requests: write');
});
