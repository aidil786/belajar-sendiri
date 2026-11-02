// The push/pull courier on the hidden test page /<lang>/dev/interactives/.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const PAGE = '/en/dev/interactives/';
const DEMOS = ['courier-fix', 'courier-team', 'courier-demo'];

async function open(page: Page, id: string) {
  const demo = page.locator(`[data-demo="${id}"]`);
  await demo.scrollIntoViewIfNeeded();
  await expect(demo.locator('astro-island[ssr]')).toHaveCount(0); // hydrated
  return demo;
}

test.describe('Courier', () => {
  test('a rejected push bounces with a kind note; pull --rebase, then push wins', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'courier-fix');
    const github = demo.getByRole('region', { name: 'GitHub' });
    const laptop = demo.getByRole('region', { name: 'Your laptop' });
    await expect(laptop).toContainText('1 ahead · 0 behind origin/main');
    await expect(github).toContainText('only on GitHub');

    await demo.getByRole('button', { name: /^Push/ }).click();
    const note = demo.locator('.courier-explain.is-err');
    await expect(note).toContainText("Rejected: the remote has commits you don't have");
    await expect(note.locator('svg')).toHaveCount(1); // red always comes with an icon
    await expect(demo).toHaveAttribute('data-wrong', '1');
    await expect(github).not.toContainText('Make titles teal');
    await expect(demo.locator('.courier-cmd')).toContainText('~/diary $ git push');

    // Git's own words are folded away.
    await demo.getByText('What Git printed').click();
    await expect(demo.locator('.courier-output pre')).toContainText('! [rejected]        main -> main (fetch first)');

    await demo.getByRole('button', { name: /Pull \(rebase\)/ }).click();
    await expect(laptop).toContainText("Add Aisyah's day 2");
    await expect(laptop).toContainText('1 ahead · 0 behind origin/main');
    await demo.getByRole('button', { name: /^Push/ }).click();
    await expect(demo).toHaveAttribute('data-done', 'true');
    await expect(github).toContainText('Make titles teal');
    await expect(laptop).toContainText('0 ahead · 0 behind origin/main');
    await expect(demo.locator('.feedback-right')).toContainText('Both commits are on GitHub now.');
    await expect(demo.locator('.courier-carried')).toContainText('Carried to GitHub:');
  });

  test('hints come after two refusals', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'courier-fix');
    await demo.getByRole('button', { name: /^Push/ }).click();
    await expect(demo.locator('.feedback-almost')).toHaveCount(0);
    await demo.getByRole('button', { name: /^Push/ }).click();
    await expect(demo.locator('.feedback-almost')).toContainText('Bring in Aisyah’s commit first');
    await demo.getByRole('button', { name: /Start again/ }).click();
    await expect(demo.locator('.feedback-almost')).toHaveCount(0);
    await expect(demo.locator('.courier-cmd')).toHaveCount(0);
  });

  test('a teammate pushes; fetch moves origin/main only; pull joins it (keyboard only)', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'courier-team');
    const github = demo.getByRole('region', { name: 'GitHub' });
    const laptop = demo.getByRole('region', { name: 'Your laptop' });
    const press = async (name: RegExp) => {
      const b = demo.getByRole('button', { name });
      await expect(b).toBeEnabled();
      await b.focus();
      await page.keyboard.press('Enter');
    };

    await press(/Aisyah pushes/);
    await expect(github).toContainText('Add Aisyah’s day 3');
    await expect(github).toContainText('only on GitHub');
    await expect(laptop).not.toContainText('Add Aisyah’s day 3');
    await expect(demo.locator('.courier-explain')).toContainText('Your laptop doesn\'t know yet');
    await expect(demo.getByRole('button', { name: /Aisyah pushes/ })).toBeDisabled(); // her one scripted commit is used

    await press(/^Fetch/);
    await expect(laptop).toContainText('Add Aisyah’s day 3');
    await expect(laptop).toContainText('0 ahead · 1 behind origin/main');
    await expect(laptop).toContainText('fetched, not in main yet');
    await expect(demo).not.toHaveAttribute('data-done', 'true');

    await press(/^Pull/);
    await expect(laptop).toContainText('0 ahead · 0 behind origin/main');
    await expect(demo).toHaveAttribute('data-done', 'true');
  });

  test('a demo plays once by itself, then can replay', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'courier-demo');
    const github = demo.getByRole('region', { name: 'GitHub' });
    await expect(github.locator('li')).toHaveCount(3, { timeout: 8000 });
    await expect(demo.locator('.courier-carried')).toContainText('Carried to GitHub:');
    await expect(demo.getByRole('region', { name: 'Your laptop' })).toContainText('0 ahead · 0 behind origin/main');
    const replay = demo.getByRole('button', { name: /Replay/ });
    await expect(replay).toBeEnabled({ timeout: 8000 });
    await replay.click();
    await expect(github).toContainText('Empty. No commits yet.');
    await expect(github.locator('li')).toHaveCount(3, { timeout: 8000 });
  });

  test('reduced motion: no travel, a before/after toggle instead', async ({ browser, baseURL }) => {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.goto(`${baseURL}${PAGE}`);
    const demo = await open(page, 'courier-demo');
    const github = demo.getByRole('region', { name: 'GitHub' });
    await expect(github.locator('li')).toHaveCount(3);
    await expect(demo.locator('.courier-parcel')).toHaveCount(0);
    await demo.getByRole('button', { name: 'Show before' }).click();
    await expect(github).toContainText('Empty. No commits yet.');
    await demo.getByRole('button', { name: 'Show after' }).click();
    await expect(github.locator('li')).toHaveCount(3);

    const fix = await open(page, 'courier-fix');
    await fix.getByRole('button', { name: /^Push/ }).click();
    await expect(fix.locator('.courier-parcel')).toHaveCount(0);
    await expect(fix.locator('.courier-explain.is-err')).toBeVisible();
    await expect(fix.getByRole('button', { name: 'Show before' })).toBeVisible();
    await context.close();
  });

  test('BM page uses Malay UI text', async ({ page }) => {
    await page.goto('/ms/dev/interactives/');
    const demo = await open(page, 'courier-team');
    await expect(demo.getByRole('region', { name: 'Laptop anda' })).toContainText('0 di depan · 0 di belakang origin/main');
    await demo.getByRole('button', { name: /Aisyah buat push/ }).click();
    await expect(demo.getByRole('region', { name: 'GitHub' })).toContainText('hanya di GitHub');
    await expect(demo.locator('.courier-explain')).toContainText('Laptop anda belum tahu');
  });

  test('no horizontal scroll at 360px', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    for (const path of [PAGE, '/ms/dev/interactives/']) {
      await page.goto(path);
      for (const id of DEMOS) await open(page, id);
      const fix = page.locator('[data-demo="courier-fix"]');
      await fix.getByRole('button', { name: /^Push/ }).click();
      await expect(fix.locator('.courier-explain.is-err')).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
  });

  for (const theme of ['light', 'dark'] as const) {
    for (const path of [PAGE, '/ms/dev/interactives/']) {
      test(`axe ${theme}: ${path}`, async ({ page }) => {
        await page.addInitScript((t) => {
          localStorage.setItem('fahamlah:v1', JSON.stringify({ v: 1, settings: { theme: t } }));
        }, theme);
        await page.goto(path);
        for (const id of DEMOS) await open(page, id);
        // Show the red note, a fetched commit and Git's output too.
        const fix = page.locator('[data-demo="courier-fix"]');
        await fix.locator('.courier-act').first().click();
        await expect(fix.locator('.courier-explain.is-err')).toBeVisible();
        await fix.locator('.courier-output summary').click();
        const team = page.locator('[data-demo="courier-team"]');
        await team.locator('.courier-act').nth(2).click();
        await expect(team.locator('.courier-act').nth(3)).toBeEnabled();
        await team.locator('.courier-act').nth(3).click();
        await expect(team.locator('.courier-commit.is-fetched')).toHaveCount(1);
        // Let the flying parcel land first: mid-flight it fades, which axe reads as low contrast.
        await expect(page.locator('.courier-parcel')).toHaveCount(0);
        const results = await new AxeBuilder({ page }).include('[data-demo^="courier"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
        const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
        expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
      });
    }
  }
});
