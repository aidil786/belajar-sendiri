// axe: no serious or critical violations on key pages, in both themes and calm mode.
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const PAGES = ['/en/', '/ms/', '/en/git/', '/en/git/save-points/the-box/', '/ms/git/save-points/the-box/#c=try-type', '/en/settings/', '/en/glossary/', '/en/rescue/', '/en/commands/add/', '/en/git/start-here/git-in-vs-code/#c=try-tour', '/en/git/undo-magic/reset-lab/#c=try-lab', '/ms/git/undo-magic/boss/#c=try-escape', '/en/git/start-here/why-save-versions/', '/en/review/', '/ms/rescue/', '/offline/', '/en/ship-it/', '/ms/ship-it/rescue/', '/en/docker/', '/ms/kubernetes/', '/en/cicd/glossary/', '/en/docker/commands/', '/en/feedback/', '/ms/feedback/'];

for (const theme of ['light', 'dark'] as const) {
  for (const path of PAGES) {
    test(`axe ${theme}: ${path}`, async ({ page }) => {
      await page.addInitScript((t) => {
        localStorage.setItem('fahamlah:v1', JSON.stringify({ v: 1, settings: { theme: t } }));
      }, theme);
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
      const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
    });
  }
}

test('calm mode turns off motion and hides XP', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('fahamlah:v1', JSON.stringify({ v: 1, settings: { calm: true } }));
  });
  await page.goto('/en/git/save-points/the-box/#c=see-box');
  await expect(page.locator('html')).toHaveAttribute('data-calm', 'true');
  // Calm mode: static before/after view instead of an animation.
  await expect(page.locator('.lesson-card.is-active').getByRole('button', { name: 'Show before' })).toBeVisible();
  await page.goto('/en/');
  await expect(page.locator('[data-stat-xp]')).toBeHidden();
});

test('prefers-reduced-motion shows the static view', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce', baseURL });
  const page = await context.newPage();
  await page.goto('/en/git/save-points/the-box/#c=see-box');
  await expect(page.locator('.lesson-card.is-active').getByRole('button', { name: 'Show before' })).toBeVisible();
  await context.close();
});

test('no horizontal scroll at 360px', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  for (const path of ['/en/', '/en/git/', '/en/git/save-points/the-box/#c=try-type', '/ms/settings/', '/en/review/', '/en/rescue/', '/offline/', '/ms/ship-it/', '/en/ship-it/rescue/', '/ms/docker/', '/en/kubernetes/glossary/']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, path).toBeLessThanOrEqual(0);
  }
});
