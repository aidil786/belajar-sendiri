// World 3 interactives on the hidden test page /<lang>/dev/interactives/:
// UniverseSplitter, ConflictResolver, RebaseDeck. Clicks, keyboard, 360 px and axe.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const PAGE = '/en/dev/interactives/';
const DEMOS = ['universe', 'universe-create', 'conflict', 'conflict-three', 'rebase'];

async function open(page: Page, id: string) {
  const demo = page.locator(`[data-demo="${id}"]`);
  await demo.scrollIntoViewIfNeeded();
  await expect(demo.locator('astro-island[ssr]')).toHaveCount(0); // hydrated
  return demo;
}

test.describe('World 3 interactives', () => {
  test('UniverseSplitter: switch universes with the buttons; files change; done after both', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'universe');
    const files = demo.locator('.us-files');
    await expect(files).toContainText('Your folder in the main universe');
    await expect(files.locator('.us-file')).toContainText('Day 2: I learned branches.');
    await expect(files.locator('.us-chip', { hasText: 'about.html' })).toHaveCount(0);
    await demo.getByRole('radio', { name: /about/ }).check();
    await expect(demo.locator('.us-term')).toContainText("Switched to branch 'about'");
    await expect(files).toContainText('Your folder in the about universe');
    await expect(files.locator('.us-chip', { hasText: 'about.html' })).toHaveCount(1);
    await expect(files.locator('.us-file')).not.toContainText('Day 2');
    await expect(demo).toHaveAttribute('data-done', 'true');
    await expect(demo.locator('.feedback-right')).toContainText('Each one keeps its own files');
  });

  test('UniverseSplitter: keyboard arrows and lane taps switch too', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'universe');
    await demo.getByRole('radio', { name: /main/ }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(demo.getByRole('radio', { name: /about/ })).toBeChecked();
    await expect(demo).toHaveAttribute('data-done', 'true');
    // Tap the main lane to go back.
    await demo.locator('.us-band.is-target').click();
    await expect(demo.getByRole('radio', { name: /main/ })).toBeChecked();
    await expect(demo.locator('.us-term')).toContainText("Switched to branch 'main'");
  });

  test('UniverseSplitter: create a branch on the right commit, with kind feedback first', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'universe-create');
    await expect(demo.getByRole('button', { name: 'Stick it here' })).toBeDisabled();
    await demo.getByRole('button', { name: /Add style/ }).click();
    await demo.getByRole('button', { name: 'Stick it here' }).click();
    await expect(demo.locator('.feedback-almost')).toContainText('That one is “Add style”');
    await expect(demo).toHaveAttribute('data-wrong', '1');
    // Keyboard: focus the right commit, press Enter.
    await demo.getByRole('button', { name: /Add day 1 page/ }).focus();
    await page.keyboard.press('Enter');
    await expect(demo.getByLabel('Name for the new branch')).toHaveValue('idea');
    await demo.getByRole('button', { name: 'Stick it here' }).click();
    await expect(demo).toHaveAttribute('data-done', 'true');
    await expect(demo.locator('.us-term')).toContainText(/git branch idea [0-9a-f]{7}/);
    await expect(demo.locator('.graph-label-branch', { hasText: 'idea' })).toHaveCount(1);
  });

  test('ConflictResolver: real markers, kind checks, edit by hand, then finish the merge', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'conflict');
    await expect(demo.locator('.cr-marker').first()).toContainText('<<<<<<< HEAD');
    await expect(demo.locator('.cr-marker').last()).toContainText('>>>>>>> cake');
    await expect(demo.locator('.cr-marker .cr-warn')).toHaveCount(3); // red plus an icon
    await expect(demo.locator('.graph-conflict')).toHaveCount(1);
    await expect(demo.getByRole('button', { name: /finish the merge/ })).toBeDisabled();

    // One side only is not what the task wants.
    await demo.getByRole('button', { name: 'Accept Current Change' }).click();
    await expect(demo.locator('.cr-badge')).toContainText('Conflicts left: 0 of 1');
    await demo.getByRole('button', { name: /finish the merge/ }).click();
    await expect(demo.locator('.feedback-almost')).toContainText("index.html isn't quite right yet");
    await expect(demo.locator('.feedback-almost')).toContainText('Keep both day 2 lines.');

    // Edit by hand: markers left → a kind nudge; without markers → accepted.
    await demo.getByRole('button', { name: /^Change/ }).click();
    await demo.getByRole('button', { name: /Edit/ }).click();
    const box = demo.getByLabel('Edit conflict 1. Delete the marker lines too.');
    await expect(box).toHaveValue(/<<<<<<< HEAD/);
    await demo.getByRole('button', { name: /Done/ }).click();
    await expect(demo.locator('.feedback-almost')).toContainText('Delete the marker lines too');
    await box.fill('<p>Day 2: I learned branches.</p>\n<p>Day 2: I baked a cake.</p>');
    await demo.getByRole('button', { name: /Done/ }).click();
    await expect(demo.locator('.cr-fixed-head')).toContainText('your own edit');

    await demo.getByRole('button', { name: /finish the merge/ }).click();
    await expect(demo).toHaveAttribute('data-done', 'true');
    await expect(demo.locator('.cr-log')).toContainText('git add index.html');
    await expect(demo.locator('.cr-log')).toContainText("Merge branch 'cake'");
    await expect(demo.locator('.graph-conflict')).toHaveCount(0);
    await expect(demo.locator('.graph-node.is-merge')).toHaveCount(1);
  });

  test('ConflictResolver: three conflicts in two files (keyboard only)', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'conflict-three');
    await expect(demo.locator('.cr-badge')).toContainText('Conflicts left: 3 of 3');
    const press = async (group: string, name: string) => {
      await demo.getByRole('group', { name: group }).getByRole('button', { name }).focus();
      await page.keyboard.press('Enter');
    };
    await press('Conflict 1: choose what stays', 'Keep yours');
    await press('Conflict 2: choose what stays', 'Keep both');
    await demo.getByRole('button', { name: /style\.css/ }).focus();
    await page.keyboard.press('Enter');
    await expect(demo.locator('.cr-file-head')).toContainText('style.css');
    await press('Choose what stays', 'Keep theirs');
    await expect(demo.locator('.cr-badge')).toContainText('Conflicts left: 0 of 3');
    await demo.getByRole('button', { name: /finish the merge/ }).focus();
    await page.keyboard.press('Enter');
    await expect(demo).toHaveAttribute('data-done', 'true');
    await expect(demo.locator('.cr-log')).toContainText('git add style.css');
  });

  test('RebaseDeck: kind feedback, then move + fixup + drop gives a clean history', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'rebase');
    await expect(demo.locator('.rd-card')).toHaveCount(4);
    await expect(demo.locator('.rd-card').first()).toContainText('Add gallery page');
    await demo.getByRole('button', { name: /Run rebase/ }).click();
    await expect(demo.locator('.feedback-almost')).toContainText('Every card still says pick');

    // Fixup without moving folds the fix into the wrong commit: a kind hint.
    await demo.getByLabel('Action for fix typo').selectOption('fixup');
    await demo.getByLabel('Action for debug log').selectOption('drop');
    await demo.getByRole('button', { name: /Run rebase/ }).click();
    await expect(demo.locator('.feedback-almost')).toContainText('A fix landed in another commit');
    await expect(demo.locator('.feedback-almost')).toContainText('Move “fix typo” right under “Add gallery page”.');
    await expect(demo.locator('.rd-graph-head')).toContainText('History after');

    await demo.getByRole('button', { name: 'Move up: fix typo' }).click();
    await expect(demo.locator('.rd-card').nth(1)).toContainText('fix typo');
    await expect(demo.locator('.rd-graph-head')).toContainText('History before');
    await demo.getByRole('button', { name: /Run rebase/ }).click();
    await expect(demo).toHaveAttribute('data-done', 'true');
    await expect(demo.locator('.feedback-right')).toContainText('Clean history');
    await expect(demo.locator('.rd-graph-head')).toContainText('Commits from newest: Add photo captions, Add gallery page, Add style');
    await demo.getByRole('button', { name: 'Show before' }).click();
    await expect(demo.locator('.rd-graph-head')).toContainText('History before');
  });

  test('RebaseDeck: reword and squash-first message', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'rebase');
    await demo.getByLabel('Action for Add gallery page').selectOption('squash');
    await expect(demo.locator('.rd-joins').first()).toContainText('Nothing above to join');
    await demo.getByRole('button', { name: /Run rebase/ }).click();
    await expect(demo.locator('.feedback-almost')).toContainText("The first card can't use squash");
    await demo.getByLabel('Action for Add gallery page').selectOption('reword');
    await expect(demo.getByLabel('New message')).toHaveValue('Add gallery page');
  });

  test('BM page uses Malay UI text', async ({ page }) => {
    await page.goto('/ms/dev/interactives/');
    const three = await open(page, 'conflict-three');
    await expect(three.locator('.cr-badge')).toContainText('Konflik tinggal: 3 daripada 3');
    await expect(three.getByRole('button', { name: 'Kekalkan milik anda' }).first()).toBeVisible();
    const deck = await open(page, 'rebase');
    await expect(deck.getByRole('button', { name: /Jalankan rebase/ })).toBeVisible();
    const universe = await open(page, 'universe');
    await expect(universe.locator('.us-files')).toContainText('Folder anda dalam alam main');
  });

  test('reduced motion: no drag grip, numbers instead; everything still works', async ({ browser, baseURL }) => {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.goto(`${baseURL}${PAGE}`);
    const deck = await open(page, 'rebase');
    await expect(deck.locator('.rd-grip')).toHaveCount(0);
    await expect(deck.locator('.rd-num').first()).toHaveText('1');
    const demo = await open(page, 'universe');
    await demo.getByRole('radio', { name: /about/ }).check();
    await expect(demo).toHaveAttribute('data-done', 'true');
    await context.close();
  });

  test('no horizontal scroll at 360px', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    for (const path of [PAGE, '/ms/dev/interactives/']) {
      await page.goto(path);
      for (const id of DEMOS) await open(page, id);
      // Open the busiest states too.
      await page.locator('[data-demo="conflict"]').getByRole('button', { name: /Edit/ }).click();
      await page.locator('[data-demo="rebase"] .rd-select').first().selectOption('reword');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
  });

  for (const theme of ['light', 'dark'] as const) {
    for (const path of [PAGE, '/ms/dev/interactives/']) {
      test(`axe ${theme}: ${path} (World 3 demos)`, async ({ page }) => {
        await page.addInitScript((t) => {
          localStorage.setItem('fahamlah:v1', JSON.stringify({ v: 1, settings: { theme: t } }));
        }, theme);
        await page.goto(path);
        for (const id of DEMOS) await open(page, id);
        const scan = async () => {
          const results = await new AxeBuilder({ page })
            .include(DEMOS.map((id) => `[data-demo="${id}"]`))
            .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
            .analyze();
          return results.violations
            .filter((v) => v.impact === 'serious' || v.impact === 'critical')
            .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
        };
        // First as the learner first sees them.
        expect(await scan()).toEqual([]);
        // Inner states: a switched universe, a picked commit, a fixed conflict, a reworded card.
        await page.locator('[data-demo="universe"] input[type="radio"]').nth(1).check();
        await page.locator('[data-demo="universe-create"] .graph-node[role="button"]').first().click();
        await page.locator('[data-demo="conflict-three"] .cr-act').first().click();
        await page.locator('[data-demo="rebase"] .rd-select').nth(1).selectOption('reword');
        expect(await scan()).toEqual([]);
      });
    }
  }
});
