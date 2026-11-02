// Gate test for Phase 0: "The Box" works end to end in EN and BM.
import { expect, test, type Page } from '@playwright/test';

const LESSON = '/en/git/save-points/the-box/';
const count = (page: Page) => page.locator('[data-count]');
const active = (page: Page) => page.locator('.lesson-card.is-active');
const next = (page: Page) => page.locator('[data-next]').click();

test('complete The Box in English', async ({ page }) => {
  await page.goto(LESSON);
  await expect(count(page)).toContainText('Card 1 of 9');
  await expect(active(page)).toContainText('You changed 3 files');

  await next(page); // see-box
  await next(page); // see-add
  await next(page); // try-drag
  await expect(active(page)).toHaveAttribute('data-card-id', 'try-drag');
  await expect(active(page).locator('astro-island[ssr]')).toHaveCount(0); // hydrated
  // Wrong file bounces back with a kind message.
  await active(page).locator('.drag-chip', { hasText: 'style.css' }).click();
  await active(page).locator('.area-drop', { hasText: 'Staging area' }).click();
  await expect(active(page).locator('.feedback-almost')).toContainText('Not ready yet!');
  // The ready file goes in the box.
  await active(page).locator('.drag-chip', { hasText: 'index.html' }).click();
  await active(page).locator('.area-drop', { hasText: 'Staging area' }).click();
  await expect(active(page)).toHaveAttribute('data-done', 'true');

  await next(page); // try-type
  await expect(active(page).locator('.xterm')).toBeVisible(); // the island has loaded
  const input = active(page).locator('.term-input');
  await input.fill('git add index.html');
  await input.press('Enter');
  await expect(active(page).locator('.sim-explain')).toContainText('You put index.html in the box.');
  await expect(active(page)).toHaveAttribute('data-done', 'true');

  await next(page); // see-commit
  await next(page); // predict
  await expect(active(page).locator('astro-island[ssr]')).toHaveCount(0);
  await active(page).getByRole('button', { name: /Only/ }).click();
  await expect(active(page).locator('.feedback-right')).toBeVisible();

  await next(page); // check-status
  await expect(active(page).locator('.replay')).toContainText('new file:   index.html');
  await next(page); // win
  await expect(active(page)).toHaveAttribute('data-card-type', 'win');
  await expect(page.locator('[data-win-extras]')).toBeVisible();
  await expect(page.locator('[data-win-xp]')).toHaveText('+20 XP');
  await page.getByRole('button', { name: 'Fun' }).click();
  await expect(page.locator('[data-vote-thanks]')).toBeVisible();
});

test('switch to BM mid-lesson keeps the card; Peek shows the other language', async ({ page }) => {
  await page.goto(`${LESSON}#c=see-add`);
  await expect(count(page)).toContainText('Card 3 of 9');
  await page.locator('[data-peek-btn]').click();
  await expect(page.locator('[data-peek-body]')).toContainText('masukkan satu fail ke dalam kotak');
  await page.locator('.lesson-bar [data-lang-toggle]').click();
  await expect(page).toHaveURL(/\/ms\/git\/save-points\/the-box\/#c=see-add/);
  await expect(count(page)).toContainText('Kad 3 daripada 9');
  await expect(active(page)).toContainText('masukkan satu fail');
  await page.locator('[data-peek-btn]').click();
  await expect(page.locator('[data-peek-body]')).toContainText('puts one file in the box');
});

test('reload resumes the same card', async ({ page }) => {
  await page.goto(LESSON);
  await next(page);
  await next(page);
  await next(page);
  await expect(count(page)).toContainText('Card 4 of 9');
  await page.goto(LESSON); // no hash: the saved card is used
  await expect(count(page)).toContainText('Card 4 of 9');
  await page.reload();
  await expect(count(page)).toContainText('Card 4 of 9');
  // Home "Continue" goes to the exact card.
  await page.goto('/en/');
  await expect(page.locator('[data-continue]')).toContainText('Continue');
  await page.locator('[data-continue]').click();
  await expect(count(page)).toContainText('Card 4 of 9');
});

test('keyboard: Space next, Backspace back, ? hint', async ({ page }) => {
  await page.goto(LESSON);
  await page.locator('body').click({ position: { x: 5, y: 300 } });
  await page.keyboard.press('Space');
  await expect(count(page)).toContainText('Card 2 of 9');
  await page.keyboard.press('Backspace');
  await expect(count(page)).toContainText('Card 1 of 9');
  await page.goto(`${LESSON}#c=try-drag`);
  await page.locator('h1').click();
  await page.keyboard.press('?');
  await expect(active(page).locator('[data-hint]')).toBeVisible();
});

test('root redirects to a language', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/(en|ms)\/$/);
});
