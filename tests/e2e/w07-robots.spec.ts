// World 7 (Robots: Actions & CI/CD): step through lessons and finish every interactive, EN and BM.
// Runs on both projects (360 px phone and desktop).
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';

for (const path of ['/en/git/robots/workflow-anatomy/#c=try-build', '/ms/git/robots/status-checks/#c=check-merge', '/en/git/robots/deploy/#c=try-pages', '/en/git/robots/boss/#c=try-run']) {
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
const done = (page: Page) => expect(active(page)).toHaveAttribute('data-done', 'true', { timeout: 10_000 });
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

async function spot(card: Locator, texts: string[]) {
  for (const t of texts) await card.locator('.spot-line', { hasText: t }).click();
}

async function timeline(card: Locator) {
  for (const dot of await card.locator('.timeline-dot').all()) await dot.click();
}

/** Tap YamlBuilder blocks by their exact label, in order. */
async function stack(card: Locator, labels: string[]) {
  for (const l of labels) await card.locator('.yb-pick').filter({ has: card.page().locator('.yb-label', { hasText: exact(l) }) }).click();
}

const runBtn = (card: Locator) => card.locator('.yb-run');

test('7.1 what CI/CD means (EN)', async ({ page }) => {
  await page.goto('/en/git/robots/what-is-ci/');
  await goTo(page, 'hook');
  await choose(page, 'A robot, on every push');
  await goTo(page, 'see-ci');
  await timeline(active(page));
  await done(page);
  await goTo(page, 'see-cd');
  await active(page).getByRole('button', { name: /Publish site/ }).click();
  await expect(active(page).locator('.prepo-log')).toContainText('The new diary is live.');
  await goTo(page, 'try-sort');
  await sort(active(page), [
    ['Run the tests', 'CI: check it'],
    ['code style', 'CI: check it'],
    ['on the commit', 'CI: check it'],
    ['Publish the site', 'CD: ship it'],
    ['new app version', 'CD: ship it'],
  ]);
  await done(page);
  await noSideScroll(page);
  await goTo(page, 'see-actions');
  await expect(active(page).locator('.transcript-screen')).toContainText('deploy.yml');
  await goTo(page, 'predict');
  await choose(page, 'Marks the commit');
  await goTo(page, 'check-habits');
  await swipe(active(page), [true, false, true, false]);
  await done(page);
  await goTo(page, 'win');
});

test('7.2 workflow anatomy (EN): build the YAML, then commit it', async ({ page }) => {
  await page.goto('/en/git/robots/workflow-anatomy/');
  await goTo(page, 'hook');
  await expect(active(page).locator('.replay')).toContainText('runs-on: ubuntu-latest');
  await goTo(page, 'see-on');
  await spot(active(page), ['on: push']);
  await done(page);
  await goTo(page, 'see-job');
  await choose(page, 'A fresh Linux computer');
  await goTo(page, 'see-steps');
  await sort(active(page), [
    ['actions/checkout@v7', 'uses: a ready-made action'],
    ['npm test', 'run: a command'],
    ['actions/setup-node@v7', 'uses: a ready-made action'],
    ['npm ci', 'run: a command'],
  ]);
  await done(page);
  await goTo(page, 'try-build');
  const card = active(page);
  // A decoy first: kind feedback, no "wrong".
  await stack(card, ['On push', 'Job: test', 'Deploy']);
  await runBtn(card).click();
  await expect(card.locator('.feedback-almost')).toContainText('This workflow only tests');
  await card.getByRole('button', { name: 'Remove: Deploy' }).click();
  await stack(card, ['Check out code', 'Set up Node', 'Install packages', 'Run tests']);
  await expect(card.locator('.yb-yaml')).toContainText('node-version: 24');
  await runBtn(card).click();
  await done(page);
  await expect(card.locator('.yb-step.is-pass')).toHaveCount(4);
  await noSideScroll(page);
  await goTo(page, 'predict');
  await choose(page, 'The step fails');
  await goTo(page, 'try-commit');
  const input = active(page).locator('.term-input');
  await expect(active(page).locator('.xterm')).toBeVisible();
  for (const c of ['git status', 'git add .github', 'git commit -m "Add CI workflow"']) {
    await input.fill(c);
    await input.press('Enter');
  }
  await done(page);
  await noSideScroll(page);
});

test('7.7 status checks (EN): find the failure, turn on the rule, add a badge, merge the safe PR', async ({ page }) => {
  await page.goto('/en/git/robots/status-checks/');
  await goTo(page, 'see-check');
  const run = active(page);
  await run.getByRole('button', { name: /Install packages/ }).click();
  await expect(run.locator('.feedback-almost')).toContainText('That step passed');
  await run.getByRole('button', { name: /Run tests/ }).click();
  await expect(run.locator('.prepo-log').last()).toContainText('Received "Contcat"');
  await done(page);
  await goTo(page, 'predict');
  await choose(page, 'GitHub blocks the merge');
  await goTo(page, 'try-rule');
  await active(page).getByRole('switch', { name: 'Require status checks to pass before merging' }).check();
  await done(page);
  await goTo(page, 'try-badge');
  const md = active(page);
  await md.getByRole('button', { name: 'Check' }).click();
  await expect(md.locator('.feedback-almost')).toContainText('right before [CI]');
  await md
    .getByLabel('Your Markdown')
    .fill('# My Diary\n\n![CI](https://github.com/aina-codes/diary/actions/workflows/ci.yml/badge.svg)\n\nA tiny diary website.\n');
  await done(page);
  await noSideScroll(page);
  await goTo(page, 'check-merge');
  const repo = active(page);
  await repo.getByRole('button', { name: /Add contact page/ }).click();
  await expect(repo.locator('.prepo-blocked')).toContainText('A check failed');
  await expect(repo.getByRole('button', { name: 'Merge pull request' })).toBeDisabled();
  await repo.getByRole('button', { name: 'All pull requests' }).click();
  await repo.getByRole('button', { name: /Fix typo on home page/ }).click();
  await repo.getByRole('button', { name: 'Merge pull request' }).click();
  await done(page);
  await noSideScroll(page);
});

test('7.9 deploy (EN): Pages workflow, wrangler command, who deploys', async ({ page }) => {
  await page.goto('/en/git/robots/deploy/');
  await goTo(page, 'see-flow');
  await order(active(page), ['A push lands on main', 'Check out the code', 'Install and test', 'Build the site', 'Upload it to the host']);
  await done(page);
  await goTo(page, 'try-pages');
  const card = active(page);
  // Permissions after the job: kind feedback says where it belongs.
  await stack(card, ['On push to main', 'Job: deploy to github-pages', 'Pages permissions']);
  await runBtn(card).click();
  await expect(card.locator('.feedback-almost')).toBeVisible();
  await card.getByRole('button', { name: 'Move up: Pages permissions' }).click();
  await stack(card, ['Check out code', 'Set up Node', 'Install and build', 'Pack the site for Pages', 'Deploy to Pages']);
  await expect(card.locator('.yb-yaml')).toContainText('id-token: write');
  await expect(card.locator('.yb-yaml')).toContainText('actions/deploy-pages@v5');
  await runBtn(card).click();
  await done(page);
  await noSideScroll(page);
  await goTo(page, 'see-cloudflare');
  for (const p of ['npx', 'wrangler', 'deploy']) await active(page).locator('.builder-piece', { hasText: exact(p) }).click();
  await done(page);
  await goTo(page, 'see-alt');
  await sort(active(page), [
    ['deploy steps in YAML', 'GitHub Actions deploys'],
    ['Cloudflare dashboard', 'Workers Builds deploys'],
    ['Tests and deploy', 'GitHub Actions deploys'],
    ['No Cloudflare token', 'Workers Builds deploys'],
  ]);
  await done(page);
  await goTo(page, 'predict');
  await choose(page, 'It is skipped');
});

test('7.11 keep workflows safe (EN): permissions, risky lines, habits', async ({ page }) => {
  await page.goto('/en/git/robots/workflow-security/');
  await goTo(page, 'see-token');
  await timeline(active(page));
  await done(page);
  await goTo(page, 'see-permissions');
  await sort(active(page), [
    ['Run the tests', 'contents: read'],
    ['Build the site', 'contents: read'],
    ['new release', 'contents: write'],
    ['GitHub Pages', 'pages: write'],
  ]);
  await done(page);
  await goTo(page, 'try-spot');
  await spot(active(page), ['write-all', 'random-dev/helper@main', 'secrets.DEPLOY_TOKEN']);
  await done(page);
  await noSideScroll(page);
  await goTo(page, 'see-prt');
  await active(page).getByRole('button', { name: 'pull_request', exact: true }).click();
  await expect(active(page).locator('.feedback-right')).toBeVisible();
  await goTo(page, 'check-habits');
  await swipe(active(page), [true, true, false, false]);
  await done(page);
});

test('boss (EN): build the deploy robot, find the failing step, explain the order', async ({ page }) => {
  await page.goto('/en/git/robots/boss/');
  await goTo(page, 'see-plan');
  await timeline(active(page));
  await done(page);
  await goTo(page, 'try-build');
  const card = active(page);
  // Decoys get kind feedback with their reason.
  await stack(card, ['On pull request']);
  await runBtn(card).click();
  await expect(card.locator('.feedback-almost')).toContainText("A PR isn't merged yet");
  await card.getByRole('button', { name: 'Remove: On pull request' }).click();
  await stack(card, ['On push to main', 'Read-only token', 'Job: deploy', 'Check out code', 'Set up Node', 'Install packages', 'Run tests', 'Build site', 'Deploy (key typed in)']);
  await runBtn(card).click();
  await expect(card.locator('.feedback-almost')).toContainText('Never type a key into the file');
  await card.getByRole('button', { name: 'Remove: Deploy (key typed in)' }).click();
  await stack(card, ['Deploy (keys from secrets)']);
  await expect(card.locator('.yb-yaml')).toContainText('${{ secrets.CLOUDFLARE_API_TOKEN }}');
  await expect(card.locator('.yb-yaml')).toContainText('branches: [main]');
  await runBtn(card).click();
  await done(page);
  await expect(card.locator('.yb-step.is-pass')).toHaveCount(6);
  await noSideScroll(page);
  await goTo(page, 'try-run');
  const run = active(page);
  await run.getByRole('button', { name: /Check out code/ }).click();
  await expect(run.locator('.feedback-almost')).toContainText('That step passed');
  await run.getByRole('button', { name: /Run tests/ }).click();
  await expect(run.locator('.prepo-log').last()).toContainText('Received "Day 4"');
  await done(page);
  await expect(run.locator('.feedback-right')).toContainText('build and deploy were skipped');
  await noSideScroll(page);
  await goTo(page, 'check-why');
  await choose(page, 'So broken code never reaches your readers');
  await goTo(page, 'win');
});

test('boss (BM): the same robot, in Malay', async ({ page }) => {
  await page.goto('/ms/git/robots/boss/');
  await goTo(page, 'try-build');
  const card = active(page);
  await stack(card, ['Bila push ke main', 'Token baca sahaja', 'Job: deploy', 'Ambil kod', 'Sediakan Node', 'Pasang pakej', 'Jalankan ujian', 'Bina laman', 'Deploy (kunci dari secrets)']);
  await runBtn(card).click();
  await done(page);
  await goTo(page, 'try-run');
  await active(page).getByRole('button', { name: /Jalankan ujian/ }).click();
  await done(page);
  await noSideScroll(page);
  await goTo(page, 'check-why');
  await choose(page, 'Supaya kod rosak');
  await goTo(page, 'win');
});
