// The food-court interactives (Kubernetes) on the hidden test page /<lang>/dev/interactives/:
// FoodCourtSim, ManagersBoard, KubeReplay and the pink YouAreHere bar.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const PAGE = '/en/dev/interactives/';
const DEMOS = ['kube-here', 'kube-sim', 'kube-board', 'kube-replay'];

async function open(page: Page, id: string) {
  const demo = page.locator(`[data-demo="${id}"]`);
  await demo.scrollIntoViewIfNeeded();
  await expect(demo.locator('astro-island[ssr]')).toHaveCount(0); // hydrated
  return demo;
}

test.describe('food-court interactives', () => {
  test('FoodCourtSim: the pink bar, three ready trays, then kubectl scale to 5', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'kube-sim');
    await expect(demo.locator('.kube-here')).toContainText('kind-dev');
    await expect(demo.locator('.kube-here')).toContainText('default');
    await expect(demo.locator('.kube-tray-ready')).toHaveCount(3);
    await expect(demo.locator('.kube-board-want .kube-board-num')).toHaveText('3');
    const input = demo.locator('input[data-terminal-input]');
    await input.fill('kubectl get pods');
    await input.press('Enter');
    await expect(demo.locator('.sim-explain')).not.toBeEmpty();
    await input.fill('kubectl scale deployment shop --replicas=5');
    await input.press('Enter');
    await expect(demo.locator('.kube-board-want .kube-board-num')).toHaveText('5');
    await expect(demo).toHaveAttribute('data-done', 'true', { timeout: 30_000 });
    await expect(demo.locator('.kube-tray-ready')).toHaveCount(5);
  });

  test('FoodCourtSim: deleting a tray makes the manager replace it', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'kube-sim');
    const tray = demo.locator('.kube-tray-ready').first();
    const name = (await tray.getAttribute('title')) ?? '';
    await tray.getByRole('button', { name: new RegExp(`^Delete pod ${name}`) }).click();
    await expect(demo.locator('.kube-board-note').last()).toContainText('Gaps fixed: 1');
    // A new tray (new name) gets ready; the deleted one goes away.
    await expect(demo.locator('.kube-tray-ready')).toHaveCount(3, { timeout: 30_000 });
    await expect(demo.locator(`.kube-tray[title="${name}"]`)).toHaveCount(0, { timeout: 30_000 });
  });

  test('ManagersBoard: Want 3, See 2, Make 1 more — then healed', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'kube-board');
    await expect(demo.locator('.kube-board-want .kube-board-num')).toHaveText('3');
    await demo.getByRole('button', { name: /Delete a pod/ }).click();
    await expect(demo.locator('.kube-board-do')).toContainText('Make 1 more');
    await expect(demo.locator('.kube-board-see .kube-board-num')).toHaveText('2');
    await expect(demo).toHaveAttribute('data-done', 'true', { timeout: 30_000 });
    await demo.getByRole('button', { name: /Order 5 trays/ }).click();
    await expect(demo.locator('.kube-board-want .kube-board-num')).toHaveText('5');
  });

  test('KubeReplay: the crash loop and its last words', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'kube-replay');
    await expect(demo.locator('.replay-line').last()).toBeVisible({ timeout: 15_000 });
    await expect(demo.locator('.replay')).toContainText('CrashLoopBackOff');
    await expect(demo.locator('.replay')).toContainText('oh no, no gas');
    await expect(demo.locator('.kube-replay > figcaption')).toContainText('oops pod keeps crashing');
  });

  test('reduced motion: replay shows everything at once', async ({ browser, baseURL }) => {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.goto(`${baseURL}${PAGE}`);
    const demo = await open(page, 'kube-replay');
    await expect(demo.locator('.replay-hidden')).toHaveCount(0);
    await expect(demo.getByRole('button', { name: /Replay/ })).toHaveCount(0);
    await context.close();
  });

  test('YouAreHere: a production-like cluster warns with an icon and words', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'kube-here');
    await expect(demo.locator('.kube-here-prod')).toBeVisible();
    await expect(demo.locator('.kube-here-warn svg')).toHaveCount(1);
    await expect(demo.locator('.kube-here')).toContainText('prod-like');
  });

  test('Malay page and no sideways scroll', async ({ page }) => {
    await page.goto('/ms/dev/interactives/');
    for (const id of DEMOS) await open(page, id);
    await expect(page.locator('[data-demo="kube-sim"] .kube-here')).toContainText('Anda di sini');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`axe ${theme}`, async ({ page }) => {
      await page.addInitScript((t) => {
        localStorage.setItem('fahamlah:v1', JSON.stringify({ v: 1, settings: { theme: t, calm: true } }));
      }, theme);
      await page.goto(PAGE);
      for (const id of DEMOS) await open(page, id);
      const results = await new AxeBuilder({ page }).include('[data-demo^="kube"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
      const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
    });
  }
});
