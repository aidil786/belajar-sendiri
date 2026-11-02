// CI/CD World C1 (Pipeline Thinking): step through every lesson and the boss, finishing each
// interactive (conveyor belt tasks included). EN everywhere, BM for two. Runs on both projects.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';

const BASE = '/en/cicd/pipeline-thinking';

for (const path of [`${BASE}/stations-on-the-belt/#c=predict`, `${BASE}/robots-recap/#c=try-placement`, '/ms/cicd/pipeline-thinking/boss/#c=t3-run']) {
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

async function noSideScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

async function choose(page: Page, text: string) {
  await active(page).locator('.choice-btn', { hasText: text }).click();
  await expect(active(page).locator('.feedback-right')).toBeVisible();
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

async function timeline(card: Locator) {
  for (const dot of await card.locator('.timeline-dot').all()) await dot.click();
}

/** Tap YamlBuilder blocks by their exact label, in order, then run. */
async function stack(card: Locator, labels: string[]) {
  for (const l of labels) await card.locator('.yb-pick').filter({ has: card.page().locator('.yb-label', { hasText: exact(l) }) }).click();
  await card.locator('.yb-run').click();
}

// Conveyor belt helpers.
const run = (card: Locator) => card.getByRole('button', { name: /^▶ Run/ }).click();
const station = (card: Locator, text: string) => card.locator('.cv-station-btn', { hasText: text });
const summary = (card: Locator) => card.locator('.cv-summary');

/** Predict task: pick a station, run, and expect the task to be done. */
async function predict(page: Page, text: string) {
  const card = active(page);
  await station(card, text).click();
  await run(card);
  await done(page);
}

test('C1.1 robots recap: belt, recap and the placement test', async ({ page }) => {
  await page.goto(`${BASE}/robots-recap/`);
  await goTo(page, 'hook');
  await choose(page, 'Draw the stations first');
  await goTo(page, 'see-belt');
  await run(active(page));
  await expect(summary(active(page))).toContainText('Run passed', { timeout: 20_000 });
  await done(page);
  await goTo(page, 'try-sort');
  await sort(active(page), [
    ['on: push', 'When it runs'],
    ['pull_request:', 'When it runs'],
    ['ubuntu-latest', 'Where it runs'],
    ['windows-latest', 'Where it runs'],
    ['npm test', 'What it does'],
    ['actions/checkout@v7', 'What it does'],
  ]);
  await done(page);
  await noSideScroll(page);
  await goTo(page, 'predict-fork');
  await choose(page, 'No. Forks get no secrets');
  await goTo(page, 'try-placement');
  const card = active(page);
  const answers = ['.github/workflows/', 'pull_request', 'A repository secret', 'Continuous deployment', 'lint → test → build', 'A flaky test', 'Unit tests', 'The exact build', 'feature flag', 'Change fail rate', '.gitlab-ci.yml', 'packages: write', 'A service container'];
  for (const [i, a] of answers.entries()) {
    await expect(card.locator('.placement-count')).toContainText(`Question ${i + 1} of ${answers.length}`);
    await card.locator('.choice-btn', { hasText: a }).click();
  }
  await expect(card.locator('.feedback-right')).toContainText('You know 13 lessons already');
  await done(page);
  await goTo(page, 'check-habits');
  await swipe(active(page), [true, false, true, false]);
  await done(page);
  await goTo(page, 'win');
});

test('C1.2 delivery waits for a person; deployment does not', async ({ page }) => {
  await page.goto(`${BASE}/ci-delivery-deployment/`);
  await goTo(page, 'hook');
  await choose(page, 'Both of them');
  await goTo(page, 'try-delivery');
  let card = active(page);
  await run(card);
  const review = card.locator('.cv-approval');
  await expect(review).toContainText('“production” needs a review. Reviewer: aina', { timeout: 20_000 });
  await review.getByRole('button', { name: /Approve/ }).click();
  await done(page);
  await expect(summary(card)).toContainText('Run passed');
  await noSideScroll(page);
  await goTo(page, 'predict');
  await choose(page, 'It ships by itself');
  await goTo(page, 'see-deployment');
  card = active(page);
  await run(card);
  await expect(summary(card)).toContainText('Run passed', { timeout: 20_000 });
  await expect(card.locator('.cv-approval')).toHaveCount(0);
  await goTo(page, 'try-sort');
  await sort(active(page), [
    ['tested by a robot', 'CI'],
    ['Lint and tests run', 'CI'],
    ['A release is always ready', 'Continuous delivery'],
    ['Production waits', 'Continuous delivery'],
    ['Each merge to main', 'Continuous deployment'],
    ['Green means live', 'Continuous deployment'],
  ]);
  await done(page);
  await goTo(page, 'check');
  await choose(page, 'Continuous delivery');
  await goTo(page, 'win');
});

test('C1.3 stations: wrong order hurts, build the line, scan stops a bad pack', async ({ page }) => {
  await page.goto(`${BASE}/stations-on-the-belt/`);
  await goTo(page, 'hook');
  let card = active(page);
  await run(card);
  await expect(summary(card)).toContainText('Run failed', { timeout: 20_000 });
  await expect(card.locator('.cv-station.is-success', { hasText: 'npm run deploy' })).toBeVisible();
  await expect(card.locator('.cv-station.is-failure')).toContainText('npm test');
  await goTo(page, 'see-stations');
  await timeline(active(page));
  await done(page);
  await goTo(page, 'try-order');
  await order(active(page), ['Lint', 'Test', 'Build', 'Scan', 'Publish', 'Deploy']);
  await done(page);
  await goTo(page, 'see-line');
  card = active(page);
  await run(card);
  await expect(summary(card)).toContainText('Run passed', { timeout: 20_000 });
  await expect(card.locator('.cv-station.is-success')).toHaveCount(7);
  await goTo(page, 'try-build');
  await stack(active(page), ['On push to main', 'Job: line', 'Check out code', 'Install packages', 'Lint', 'Test', 'Build']);
  await done(page);
  await noSideScroll(page);
  await goTo(page, 'predict');
  card = active(page);
  // A miss first: kind words, then the scan station.
  await station(card, 'npm test').click();
  await run(card);
  await expect(card.locator('.feedback-almost')).toContainText('The red station stopped the line', { timeout: 20_000 });
  await expect(card.locator('.cv-station.is-skipped', { hasText: 'Publish to GHCR' })).toBeVisible();
  await predict(page, 'Scan the image');
  await goTo(page, 'check');
  await swipe(active(page), [true, false, true, false]);
  await done(page);
  await goTo(page, 'win');
});

test('C1.4 fast feedback: lint first, a cache shortcut, flaky tests', async ({ page }) => {
  await page.goto(`${BASE}/fast-feedback/`);
  await goTo(page, 'hook');
  await choose(page, 'Run the quick checks first');
  await goTo(page, 'try-predict');
  await predict(page, 'npm run lint');
  await expect(summary(active(page))).toContainText("'totl' is not defined");
  await goTo(page, 'try-order');
  await order(active(page), ['Lint (10 seconds)', 'Unit tests (1 minute)', 'Build (3 minutes)', 'End-to-end tests (12 minutes)']);
  await done(page);
  await goTo(page, 'see-cache');
  const card = active(page);
  await run(card);
  await expect(card.locator('.cv-hint')).toContainText('Press Run again', { timeout: 20_000 });
  await run(card);
  await done(page);
  await expect(card.locator('.cv-cache')).toContainText('Cache hit');
  await goTo(page, 'see-flaky');
  await timeline(active(page));
  await done(page);
  await goTo(page, 'try-swipe');
  await swipe(active(page), [false, true, true, true, false]);
  await done(page);
  await goTo(page, 'check');
  await choose(page, 'People stop trusting red');
  await goTo(page, 'win');
});

test('C1.5 testing pyramid: sort the layers; unit tests stop the line first', async ({ page }) => {
  await page.goto(`${BASE}/testing-pyramid/`);
  await goTo(page, 'hook');
  await choose(page, 'Add many small, fast tests');
  await goTo(page, 'see-pyramid');
  await timeline(active(page));
  await done(page);
  await goTo(page, 'try-sort');
  await sort(active(page), [
    ['tax maths', 'Unit'],
    ['RM 4.50', 'Unit'],
    ['real database', 'Integration'],
    ['login API', 'Integration'],
    ['robot browser', 'End-to-end'],
    ['Sign up, then log in', 'End-to-end'],
  ]);
  await done(page);
  await noSideScroll(page);
  await goTo(page, 'predict');
  await predict(page, 'npm run test:unit');
  await expect(active(page).locator('.cv-station.is-skipped', { hasText: 'npm run test:e2e' })).toBeVisible();
  await goTo(page, 'check');
  await swipe(active(page), [true, false, true, false]);
  await done(page);
  await goTo(page, 'win');
});

test('C1.6 build once, promote; staging stops a bad pack', async ({ page }) => {
  await page.goto(`${BASE}/build-once-promote/`);
  await goTo(page, 'hook');
  await choose(page, 'Production got a new build');
  await goTo(page, 'see-envs');
  await timeline(active(page));
  await done(page);
  await goTo(page, 'try-order');
  await order(active(page), ['Build and seal the artifact', 'Deploy it to staging', 'Check staging', 'Send the same artifact to production']);
  await done(page);
  await goTo(page, 'see-promote');
  const card = active(page);
  await run(card);
  await expect(summary(card)).toContainText('Run passed', { timeout: 20_000 });
  await expect(card.locator('.cv-station.is-success')).toHaveCount(3);
  await goTo(page, 'predict-rebuild');
  await choose(page, 'It may differ');
  await goTo(page, 'predict-stop');
  await predict(page, 'staging');
  await expect(active(page).locator('.cv-station.is-skipped')).toContainText('production');
  await noSideScroll(page);
  await goTo(page, 'check');
  await swipe(active(page), [true, false, true, false]);
  await done(page);
  await goTo(page, 'win');
});

test('C1.7 trunk-based work: both sides of a flag', async ({ page }) => {
  await page.goto(`${BASE}/trunk-feature-flags/`);
  await goTo(page, 'hook');
  await expect(active(page).getByRole('link', { name: 'Trunk-based and feature flags' })).toHaveAttribute('href', '/en/git/team-workflows/trunk-based/');
  await choose(page, 'It always passes the line');
  await goTo(page, 'see-day');
  await timeline(active(page));
  await done(page);
  await goTo(page, 'try-predict');
  await predict(page, 'npm test');
  await expect(active(page).locator('.cv-lane.is-success')).not.toHaveCount(0);
  await expect(active(page).locator('.cv-lane.is-failure')).not.toHaveCount(0);
  await goTo(page, 'try-sort');
  await sort(active(page), [
    ['Half-built checkout', 'Merge today'],
    ['tiny typo fix', 'Merge today'],
    ['a test fails', 'Not yet'],
    ['no switch', 'Not yet'],
  ]);
  await done(page);
  await goTo(page, 'predict');
  await choose(page, 'Switch the flag off');
  await goTo(page, 'check');
  await swipe(active(page), [true, false, true, false]);
  await done(page);
  await goTo(page, 'win');
});

test('C1.8 DORA: five metrics, two groups, one sum', async ({ page }) => {
  await page.goto(`${BASE}/dora-metrics/`);
  await goTo(page, 'hook');
  await choose(page, 'A few numbers');
  await goTo(page, 'see-five');
  await timeline(active(page));
  await done(page);
  await goTo(page, 'try-sort');
  await sort(active(page), [
    ['Deployment frequency', 'Throughput: how fast'],
    ['Change lead time', 'Throughput: how fast'],
    ['Failed deployment recovery time', 'Throughput: how fast'],
    ['Change fail rate', 'Instability: how often it goes wrong'],
    ['Deployment rework rate', 'Instability: how often it goes wrong'],
  ]);
  await done(page);
  await goTo(page, 'predict');
  await choose(page, '10%');
  await goTo(page, 'try-swipe');
  await swipe(active(page), [true, false, true, false]);
  await done(page);
  await goTo(page, 'check');
  await choose(page, 'Failed deployment recovery time');
  await goTo(page, 'win');
});

test('C1.9 other tools: spot Groovy, sort the clues, move a GitLab job', async ({ page }) => {
  await page.goto(`${BASE}/other-ci-tools/`);
  await goTo(page, 'hook');
  await choose(page, 'No. Same stations');
  await goTo(page, 'see-same');
  await active(page).locator('.spot-line', { hasText: "Jenkins: sh 'npm test'" }).click();
  await done(page);
  await noSideScroll(page);
  await goTo(page, 'see-words');
  await timeline(active(page));
  await done(page);
  await goTo(page, 'try-sort');
  await sort(active(page), [
    ['.gitlab-ci.yml', 'GitLab CI'],
    ['stages:', 'GitLab CI'],
    ['Jenkinsfile', 'Jenkins'],
    ['agent any', 'Jenkins'],
    ['azure-pipelines.yml', 'Azure Pipelines'],
    ['vmImage', 'Azure Pipelines'],
  ]);
  await done(page);
  await goTo(page, 'predict');
  await choose(page, 'The jobs in the next stage');
  await goTo(page, 'try-yaml');
  await stack(active(page), ['On push', 'Job: test', 'Check out code', 'Set up Node 24', 'Install packages', 'Run tests']);
  await done(page);
  await goTo(page, 'win');
});

test('C1 boss (EN): three teams, three lines', async ({ page }) => {
  await page.goto(`${BASE}/boss/`);
  await goTo(page, 'hook');
  await timeline(active(page));
  await done(page);
  await goTo(page, 't1-pick');
  await sort(active(page), [
    ['Lint', 'Needs it'],
    ['Tests', 'Needs it'],
    ['Build the site', 'Needs it'],
    ['Deploy on every merge', 'Needs it'],
    ['Scan a container image', 'Not needed'],
    ['Publish an image', 'Not needed'],
    ['A manager approves', 'Not needed'],
  ]);
  await done(page);
  await goTo(page, 't1-run');
  let card = active(page);
  await run(card);
  await expect(summary(card)).toContainText('Run passed', { timeout: 20_000 });
  await expect(card.locator('.feedback-almost, .cv-hint').first()).toBeVisible();
  await expect(card).not.toHaveAttribute('data-done', 'true');
  await card.getByLabel('Pull request', { exact: true }).check();
  await run(card);
  await done(page);
  await expect(card.locator('.cv-station.is-skipped')).toContainText('deploy');
  await goTo(page, 't2-order');
  await order(active(page), ['Lint the code', 'Run the tests', 'Build the image', 'Scan the image', 'Publish to GHCR', 'Deploy']);
  await done(page);
  await goTo(page, 't2-run');
  await predict(page, 'docker build');
  await expect(summary(active(page))).toContainText('failed to solve');
  await goTo(page, 't3-choose');
  await choose(page, 'Build once, then staging');
  await goTo(page, 't3-run');
  card = active(page);
  await run(card);
  const review = card.locator('.cv-approval');
  await expect(review).toContainText('Reviewer: dr-lim', { timeout: 20_000 });
  await review.getByRole('button', { name: /Approve/ }).click();
  await done(page);
  await noSideScroll(page);
  await goTo(page, 'check');
  await swipe(active(page), [false, true, false, true]);
  await done(page);
  await goTo(page, 'win');
});

test('C1 boss (BM): the belts speak Malay', async ({ page }) => {
  await page.goto('/ms/cicd/pipeline-thinking/boss/');
  await goTo(page, 't1-pick');
  await sort(active(page), [
    ['Lint', 'Perlu'],
    ['Ujian', 'Perlu'],
    ['Build laman', 'Perlu'],
    ['Deploy setiap kali merge', 'Perlu'],
    ['Scan image container', 'Tak perlu'],
    ['Publish image', 'Tak perlu'],
    ['Pengurus luluskan', 'Tak perlu'],
  ]);
  await done(page);
  await goTo(page, 't2-run');
  await predict(page, 'docker build');
  await goTo(page, 't3-run');
  const card = active(page);
  await run(card);
  await card.locator('.cv-approval').getByRole('button', { name: /Luluskan/ }).click({ timeout: 20_000 });
  await done(page);
  await noSideScroll(page);
});

test('C1.2 (BM): continuous delivery waits for Aina', async ({ page }) => {
  await page.goto('/ms/cicd/pipeline-thinking/ci-delivery-deployment/');
  await goTo(page, 'hook');
  await choose(page, 'Kedua-duanya');
  await goTo(page, 'try-delivery');
  const card = active(page);
  await run(card);
  await card.locator('.cv-approval').getByRole('button', { name: /Luluskan/ }).click({ timeout: 20_000 });
  await done(page);
  await goTo(page, 'try-sort');
  await sort(active(page), [
    ['diuji oleh robot', 'CI'],
    ['Lint dan ujian', 'CI'],
    ['Release sentiasa sedia', 'Continuous delivery'],
    ['Production tunggu', 'Continuous delivery'],
    ['Setiap merge ke main', 'Continuous deployment'],
    ['Hijau bermaksud live', 'Continuous deployment'],
  ]);
  await done(page);
});
