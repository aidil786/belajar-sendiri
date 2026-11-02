// Ship It part 2 (CI/CD) games on the hidden test page /<lang>/dev/interactives/:
// ConveyorBelt, SpotTheHole, TrafficDial. Runs on both projects (360 px phone and desktop).
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';

const PAGE = '/en/dev/interactives/';
const DEMOS = ['conveyor-predict', 'conveyor-fix', 'conveyor-edit', 'conveyor-matrix', 'conveyor-approve', 'conveyor-cache', 'holes', 'holes-lines', 'traffic-canary', 'traffic-bluegreen', 'traffic-rollout'];

async function open(page: Page, id: string) {
  const demo = page.locator(`[data-demo="${id}"]`);
  await demo.scrollIntoViewIfNeeded();
  await expect(demo.locator('astro-island[ssr]')).toHaveCount(0); // hydrated
  return demo;
}

const run = (demo: Locator) => demo.getByRole('button', { name: /^▶ Run/ }).click();
const station = (demo: Locator, text: string) => demo.locator('.cv-station-btn', { hasText: text });
const done = (demo: Locator) => expect(demo).toHaveAttribute('data-done', 'true', { timeout: 20_000 });
const summary = (demo: Locator) => demo.locator('.cv-summary');

test.describe('ConveyorBelt', () => {
  test('predict: a wrong pick gets a kind hint; the test station is right', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'conveyor-predict');
    await expect(demo.locator('.cv-yaml')).toContainText('npm test');
    // Run without a pick asks for one first.
    await run(demo);
    await expect(demo.locator('.cv-hint')).toContainText('Tap a station first');
    await station(demo, 'npm run lint').click();
    await run(demo);
    await expect(demo.locator('.feedback-almost')).toContainText('The red station stopped the line', { timeout: 20_000 });
    await expect(summary(demo)).toContainText('Run failed');
    await expect(summary(demo)).toContainText('FAIL  tests/cart.test.js > cart > adds 6% tax');
    await expect(summary(demo)).toContainText('Tests failed: 1');
    await expect(demo.locator('.cv-station.is-failure')).toContainText('npm test');
    await expect(demo.locator('.cv-station.is-skipped')).toContainText('npm run build');
    await station(demo, 'npm test').click();
    await run(demo);
    await done(demo);
  });

  test('fix by choice: contents: write fails, write-all is not safe, packages: write passes', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'conveyor-fix');
    await expect(demo.locator('.cv-line.is-fix')).toHaveCount(2);
    await demo.getByLabel('contents: write', { exact: true }).check();
    await run(demo);
    await expect(demo.locator('.feedback-almost')).toContainText('packages: write', { timeout: 20_000 });
    await expect(demo.locator('.cv-real').first()).toContainText('denied: permission_denied: write_package');
    await demo.getByLabel('write-all', { exact: true }).check();
    await run(demo);
    await expect(demo.locator('.feedback-almost')).toContainText('more keys than the job needs', { timeout: 20_000 });
    await demo.getByLabel('contents: read and packages: write').check();
    await expect(demo.locator('.cv-line.is-fix')).toHaveCount(3);
    await run(demo);
    await done(demo);
    await expect(demo.locator('.feedback-right')).toContainText('The whole line is green');
  });

  test('fix by typing in the yellow lines; a typo shows the line and the real words', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'conveyor-edit');
    const box = demo.locator('textarea');
    await box.fill('permissions:\n  package: write');
    await expect(demo.locator('.cv-issues')).toContainText('“package” is not a permission');
    await expect(demo.locator('.cv-line.is-issue')).toHaveCount(1);
    await box.fill('permissions:\n  contents: read\n  packages: write');
    await expect(demo.locator('.cv-issues')).toHaveCount(0);
    await run(demo);
    await done(demo);
  });

  test('matrix: lanes, pause and step, logs per lane; a fork PR is read-only but still green', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'conveyor-matrix');
    await expect(demo.getByLabel('Pull request', { exact: true })).toBeChecked();
    await expect(demo.locator('.cv-station')).toHaveCount(3);
    await run(demo);
    await demo.getByRole('button', { name: /Pause/ }).click();
    const step = demo.getByRole('button', { name: /^⏭ Step/ });
    await expect(step).toBeEnabled();
    for (let i = 0; i < 4; i++) await step.click();
    await expect(summary(demo)).toHaveCount(0);
    await demo.getByRole('button', { name: /^▶ Play/ }).click();
    await expect(summary(demo)).toContainText('Run passed', { timeout: 20_000 });
    await expect(demo.locator('.cv-lane')).toHaveCount(2);
    await expect(demo.locator('.cv-station.is-skipped')).toContainText('scan');
    await station(demo, 'test').click();
    await expect(demo.locator('.cv-log')).toContainText('test (22)');
    await demo.getByRole('button', { name: 'test (24)' }).click();
    await expect(demo.locator('.cv-term')).toContainText('Tests  42 passed');
    // A fork: same result, but the token can't write.
    await demo.getByLabel('Pull request from a fork').check();
    await run(demo);
    await expect(summary(demo)).toContainText('Run passed', { timeout: 20_000 });
    await expect(demo).toHaveAttribute('data-done', 'true');
  });

  test('approve: production waits for a review, then ships', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'conveyor-approve');
    await run(demo);
    const review = demo.locator('.cv-approval');
    await expect(review).toContainText('“production” needs a review. Reviewer: aina', { timeout: 20_000 });
    await expect(demo.locator('.cv-station.is-waiting')).toContainText('production');
    await review.getByRole('button', { name: /Approve/ }).click();
    await done(demo);
    await expect(summary(demo)).toContainText('Run passed');
  });

  test('cache: the first run misses, the second takes the shortcut', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'conveyor-cache');
    await run(demo);
    await expect(summary(demo)).toContainText('Run passed', { timeout: 20_000 });
    await expect(demo.locator('.cv-cache')).toContainText('Cache miss');
    await expect(demo.locator('.cv-hint')).toContainText('Press Run again');
    await run(demo);
    await done(demo);
    await expect(demo.locator('.cv-cache')).toContainText('Cache hit');
  });
});

test.describe('SpotTheHole', () => {
  test('a safe line is kind; every hole reveals the attack and the fix', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'holes');
    const line = (n: number) => demo.locator('.sth-line').nth(n - 1).locator('.sth-btn');
    await line(1).click();
    await expect(demo.locator('.feedback-almost')).toContainText('Line 1 is safe.');
    await line(2).click();
    await expect(demo.locator('.feedback-almost')).toContainText('Hint:');
    await line(14).click();
    await expect(demo.locator('.sth-reveal')).toContainText('tj-actions/changed-files');
    await expect(demo.locator('.sth-fixcode')).toContainText('@0123456789abcdef0123456789abcdef01234567');
    for (const n of [6, 9, 13, 15, 16]) await line(n).click();
    await done(demo);
    await expect(demo.locator('.sth-line.is-found')).toHaveCount(6);
    await demo.getByRole('button', { name: 'Show the fixed workflow' }).click();
    await expect(demo.locator('.sth-fixed-code')).toContainText('TITLE: ${{ github.event.issue.title }}');
  });

  test('lines written in the lesson', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'holes-lines');
    await demo.locator('.sth-line').nth(8).locator('.sth-btn').click();
    await done(demo);
    await expect(demo.locator('.sth-reveal')).toContainText('Put the value in an env variable');
  });
});

test.describe('TrafficDial', () => {
  test('canary: 5% shows the spike; rolling back wins', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'traffic-canary');
    await expect(demo.getByRole('button', { name: /Roll back/ })).toBeDisabled();
    await demo.getByRole('button', { name: '5% to v2', exact: true }).click();
    await expect(demo.locator('.td-alert')).toContainText('Errors jump on v2', { timeout: 10_000 });
    await demo.getByRole('button', { name: /Roll back/ }).click();
    await done(demo);
    await expect(demo.locator('.td-split-text')).toContainText('100% on v1');
  });

  test('canary: pushing on hurts too many users, then start again', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'traffic-canary');
    for (const pct of [5, 25, 50]) {
      const btn = demo.getByRole('button', { name: `${pct}% to v2`, exact: true });
      await expect(btn).toBeEnabled({ timeout: 10_000 });
      await btn.click();
    }
    await expect(demo.locator('.feedback-almost')).toContainText('users hit the bug', { timeout: 10_000 });
    await demo.getByRole('button', { name: 'Start again' }).click();
    await expect(demo.locator('.td-split-text')).toContainText('0% on v2');
  });

  test('blue/green: test v2 first, keep v1', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'traffic-bluegreen');
    await demo.getByRole('button', { name: 'Test v2 first (no users)' }).click();
    await expect(demo.locator('.td-smoke')).toContainText('20 requests to v2, 2 errors');
    await demo.getByRole('button', { name: 'Keep v1 live' }).click();
    await done(demo);
  });

  test('rollout: a healthy release reaches 100%', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'traffic-rollout');
    for (const pct of [5, 25, 50, 100]) {
      const btn = demo.getByRole('button', { name: `${pct}% to v2`, exact: true });
      await expect(btn).toBeEnabled({ timeout: 10_000 });
      await btn.click();
    }
    await done(demo);
    await expect(demo.locator('.td-alert')).toHaveCount(0);
  });
});

test.describe('calm motion and layout', () => {
  test('reduced motion: runs show the end at once; the dial steps minute by minute', async ({ browser, baseURL }) => {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.goto(`${baseURL}${PAGE}`);
    const cache = await open(page, 'conveyor-cache');
    await run(cache);
    await expect(summary(cache)).toContainText('Run passed');
    await expect(cache.locator('.cv-belt.is-moving')).toHaveCount(0);
    await cache.getByRole('button', { name: /Step through/ }).click();
    await expect(cache.locator('.cv-station.is-success')).toHaveCount(0);
    await cache.getByRole('button', { name: /^⏭ Step/ }).click();
    const dial = await open(page, 'traffic-canary');
    await dial.getByRole('button', { name: '5% to v2', exact: true }).click();
    await expect(dial.locator('.td-numbers')).toHaveAttribute('open', '');
    await dial.getByRole('button', { name: /Next minute/ }).click();
    await expect(dial.locator('.td-numbers tbody tr')).toHaveCount(1);
    await expect(dial.locator('.td-alert')).toBeVisible();
    await context.close();
  });

  test('no sideways scroll on the page after a run', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'conveyor-matrix');
    await run(demo);
    await expect(summary(demo)).toBeVisible({ timeout: 20_000 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  for (const theme of ['light', 'dark'] as const) {
    for (const path of [PAGE, '/ms/dev/interactives/']) {
      test(`axe ${theme}: ${path}`, async ({ page }) => {
        await page.addInitScript((t) => {
          localStorage.setItem('fahamlah:v1', JSON.stringify({ v: 1, settings: { theme: t } }));
        }, theme);
        await page.goto(path);
        for (const id of DEMOS) await open(page, id);
        // Show a red run with its log, found holes, and the dial with a spike.
        const predict = page.locator('[data-demo="conveyor-predict"]');
        await predict.locator('.cv-station-btn').nth(1).click();
        await run(predict);
        await expect(predict.locator('.cv-summary')).toBeVisible({ timeout: 20_000 });
        const holes = page.locator('[data-demo="holes"]');
        await holes.locator('.sth-line').nth(13).locator('.sth-btn').click();
        await holes.locator('.sth-line').nth(0).locator('.sth-btn').click();
        const dial = page.locator('[data-demo="traffic-canary"]');
        await dial.locator('.td-step').first().click();
        await expect(dial.locator('.td-alert')).toBeVisible({ timeout: 10_000 });
        await expect(dial.locator('.td-numbers tbody tr')).toHaveCount(4, { timeout: 10_000 });
        const results = await new AxeBuilder({ page })
          .include('[data-demo^="conveyor"]')
          .include('[data-demo^="holes"]')
          .include('[data-demo^="traffic"]')
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
          .analyze();
        const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
        expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
      });
    }
  }
});
