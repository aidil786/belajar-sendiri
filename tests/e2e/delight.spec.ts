// The livelier look: colour, card slides, confetti. Motion must stay short and must
// switch off in calm mode and with reduced motion (ADHD rules 8 and 11).
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const LESSON = '/en/git/save-points/the-box/';

/** What an interactive does when the learner finishes a card. */
async function finishActiveCard(page: Page) {
  await page.evaluate(() => {
    const el = document.querySelector('.lesson-card.is-active .card-content');
    el?.dispatchEvent(new CustomEvent('fl:done', { bubbles: true }));
  });
}

async function setCalm(page: Page, calm: boolean) {
  await page.goto('/en/');
  await page.evaluate((c) => {
    const key = 'fahamlah:v1';
    const saved = JSON.parse(localStorage.getItem(key) || '{}');
    saved.settings = { ...(saved.settings || {}), calm: c };
    localStorage.setItem(key, JSON.stringify(saved));
  }, calm);
}

test.describe('motion on', () => {
  test.use({ reducedMotion: 'no-preference' });

  test('finishing a card: a short confetti burst from Next, then it is gone', async ({ page }) => {
    await page.goto(LESSON);
    await finishActiveCard(page);
    const bits = page.locator('.party i');
    await expect(bits.first()).toBeAttached();
    expect(await bits.count()).toBeGreaterThanOrEqual(12);
    await expect(page.locator('.party')).toHaveAttribute('aria-hidden', 'true');
    await expect(page.locator('[data-next]')).toHaveClass(/is-ready/);
    // Never lingers: removed after about a second.
    await expect(page.locator('.party')).toHaveCount(0, { timeout: 3000 });
    // The same card done again: no second burst.
    await finishActiveCard(page);
    await expect(page.locator('.party')).toHaveCount(0);
  });

  test('Next slides the card in from the right, Back from the left', async ({ page }) => {
    await page.goto(LESSON);
    await page.locator('[data-next]').click();
    await expect(page.locator('[data-player]')).toHaveAttribute('data-dir', 'forward');
    await expect(page.locator('.lesson-card.is-active')).toHaveCSS('animation-name', 'card-in-forward');
    await page.locator('[data-back]').click();
    await expect(page.locator('[data-player]')).toHaveAttribute('data-dir', 'back');
    await expect(page.locator('.lesson-card.is-active')).toHaveCSS('animation-name', 'card-in-back');
  });

  test('each card type has its own colour strip', async ({ page }) => {
    await page.goto(LESSON);
    const hook = await page.locator('.lesson-card.is-active').evaluate((el) => getComputedStyle(el).borderTopColor);
    await page.locator('[data-next]').click();
    const next = await page.locator('.lesson-card.is-active').evaluate((el) => getComputedStyle(el).borderTopColor);
    expect(hook).not.toBe(next);
  });

  test('map tiles rise in one after another, and the animation ends', async ({ page }) => {
    await page.goto('/en/ship-it/');
    const tiles = page.locator('.tiles.pop-in > li');
    await expect(tiles.first()).toHaveCSS('animation-name', 'pop-in');
    const [d1, d3] = await Promise.all([tiles.nth(0), tiles.nth(2)].map((t) => t.evaluate((el) => parseFloat(getComputedStyle(el).animationDelay))));
    expect(d3!).toBeGreaterThan(d1!);
    // Finite: one run, no infinite loops.
    await expect(tiles.first()).toHaveCSS('animation-iteration-count', '1');
  });
});

test.describe('motion off', () => {
  test('calm mode: no confetti, no card slide', async ({ page }) => {
    await setCalm(page, true);
    await page.goto(LESSON);
    await finishActiveCard(page);
    await page.waitForTimeout(150);
    await expect(page.locator('.party')).toHaveCount(0);
    await page.locator('[data-next]').click();
    const dur = await page.locator('.lesson-card.is-active').evaluate((el) => parseFloat(getComputedStyle(el).animationDuration));
    expect(dur).toBeLessThan(0.01);
  });

  test.describe('reduced motion', () => {
    test.use({ reducedMotion: 'reduce' });
    test('no confetti and no tile entrance', async ({ page }) => {
      await page.goto(LESSON);
      await finishActiveCard(page);
      await page.waitForTimeout(150);
      await expect(page.locator('.party')).toHaveCount(0);
      await page.goto('/en/ship-it/');
      await expect(page.locator('.tiles.pop-in > li').first()).toHaveCSS('animation-name', 'none');
    });
  });
});

for (const scheme of ['light', 'dark'] as const) {
  test(`the new colours keep AA contrast (${scheme}) @desktop-only`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    for (const path of ['/en/', LESSON, '/en/ship-it/', '/ms/git/']) {
      await page.goto(path);
      const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze();
      expect(r.violations.map((v) => `${path}: ${v.id}`)).toEqual([]);
    }
  });
}
