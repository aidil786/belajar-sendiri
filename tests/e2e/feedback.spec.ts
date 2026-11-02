// Rate & feedback: three links to GitHub (a star, a feedback form, a problem form), in both languages.
// The site stores nothing; the links open GitHub in a new tab. Linked from the footer and the Tools menu.
import { expect, test } from '@playwright/test';

const REPO = 'https://github.com/aidil786/belajar-sendiri';

test('the feedback page links to GitHub: a star, a feedback form and a problem form', async ({ page }) => {
  await page.goto('/en/feedback/');
  await expect(page.getByRole('heading', { level: 1, name: 'Rate & feedback' })).toBeVisible();
  await expect(page.locator('[data-fb="star"]')).toHaveAttribute('href', REPO);
  await expect(page.locator('[data-fb="feedback"]')).toHaveAttribute('href', `${REPO}/issues/new?template=feedback.yml`);
  await expect(page.locator('[data-fb="problem"]')).toHaveAttribute('href', `${REPO}/issues/new?template=problem.yml`);
  await expect(page.locator('[data-fb="security"]')).toHaveAttribute('href', `${REPO}/security/advisories/new`);
  // Every outside link opens a new tab without giving GitHub a handle on this page, and says so.
  for (const a of await page.locator('[data-fb]').all()) {
    await expect(a).toHaveAttribute('target', '_blank');
    await expect(a).toHaveAttribute('rel', 'noopener');
    await expect(a).toContainText('opens GitHub in a new tab');
  }
  await expect(page.locator('main')).toContainText('Do not share private details.');
});

test('in Malay, and reachable from the footer of every page', async ({ page }) => {
  await page.goto('/ms/feedback/');
  await expect(page.getByRole('heading', { level: 1, name: 'Nilai & maklum balas' })).toBeVisible();
  await page.goto('/en/git/');
  await page.locator('.site-footer').getByRole('link', { name: 'Rate & feedback' }).click();
  await expect(page).toHaveURL(/\/en\/feedback\/$/);
});
