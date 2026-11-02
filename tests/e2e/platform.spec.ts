// Rescue Center sections + filter, world map and home preview with many worlds.
import { expect, test, type Page } from '@playwright/test';

async function seed(page: Page, data: Record<string, unknown>) {
  await page.addInitScript((d) => localStorage.setItem('fahamlah:v1', JSON.stringify(d)), data);
}

test('rescue: problems sit in sections, and the filter narrows them', async ({ page }) => {
  await page.goto('/en/rescue/');
  await expect(page.getByRole('heading', { name: 'Commits and messages' })).toBeVisible();
  const flows = page.locator('[data-rescue-flow]');
  const total = await flows.count();
  expect(total).toBeGreaterThanOrEqual(4);

  const filter = page.getByLabel('Find your problem');
  await filter.fill('message');
  await expect(page.locator('[data-rescue-flow]:visible')).toHaveCount(1);
  await expect(page.locator('[data-rescue-flow]:visible')).toHaveText('Fix a bad commit message');
  await expect(page.locator('[data-rescue-count]')).toHaveText(`1 of ${total} shown`);

  await filter.fill('zebra');
  await expect(page.locator('[data-rescue-flow]:visible')).toHaveCount(0);
  await expect(page.getByText('No match. Try another word, or show all.')).toBeVisible();
  await page.getByRole('button', { name: 'Show all' }).click();
  await expect(page.locator('[data-rescue-flow]:visible')).toHaveCount(total);

  // Answer the questions to get safe commands.
  await page.locator('[data-rescue-flow="bad-message"]').click();
  await page.getByRole('button', { name: 'Yes', exact: true }).click();
  await expect(page.locator('.rescue-result')).toContainText('git commit --amend');
});

test('rescue: a link can open one problem; Malay works too', async ({ page }) => {
  await page.goto('/ms/rescue/#lost-commits');
  await expect(page.locator('[data-rescue-step]')).toContainText('git reset --hard');
  await expect(page.getByRole('heading', { name: 'Commit dan mesej' })).toBeVisible();
  await page.getByLabel('Cari masalah anda').fill('ditolak tiada');
  await expect(page.getByText('Tiada padanan.', { exact: false })).toBeVisible();
});

test('rescue: without JavaScript every problem is listed', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(test.info().project.use.baseURL + '/en/rescue/');
  await expect(page.getByRole('button', { name: 'Undo my last commit' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'I lost commits after a reset' })).toBeVisible();
  await context.close();
});

test('map: the link from a lesson opens that world; a returning learner sees their world', async ({ page }) => {
  await page.goto('/en/git/#world-2');
  await expect(page.locator('#world-2 details.island-lessons')).toHaveAttribute('open', '');
  await expect(page.locator('#world-0 details.island-lessons')).not.toHaveAttribute('open', '');

  await seed(page, { v: 2, resume: { lessonId: 'git-w01-l03', cardId: 'hook', cardIndex: 0, path: '/en/git/save-points/the-box/' } });
  await page.goto('/en/git/');
  await expect(page.locator('#world-1 details.island-lessons')).toHaveAttribute('open', '');
  await expect(page.locator('#world-2 details.island-lessons')).not.toHaveAttribute('open', '');
  // Every world is on the map, and World 11 is open any time.
  await expect(page.locator('[data-island]')).toHaveCount(13);
  await expect(page.locator('#world-11')).toContainText('Open any time');
});

test('home: the world preview starts at the learner’s world', async ({ page }) => {
  await page.goto('/en/');
  const shown = page.locator('.worlds-grid [data-island]:visible');
  await expect(shown).toHaveCount(5);
  await expect(shown.first()).toHaveAttribute('id', 'world-0');

  await seed(page, { v: 2, resume: { lessonId: 'git-w02-l03', cardId: 'hook', cardIndex: 0, path: '/en/git/undo-magic/fix-the-last-commit/' } });
  await page.goto('/en/');
  await expect(shown).toHaveCount(5);
  await expect(shown.first()).toHaveAttribute('id', 'world-2');
  await expect(shown.last()).toHaveAttribute('id', 'world-6');
});
