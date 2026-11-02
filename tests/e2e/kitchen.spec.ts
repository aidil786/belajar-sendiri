// The kitchen engine (Docker) on the hidden test page /<lang>/dev/interactives/:
// KitchenSim (terminal + state picture) and KitchenReplay (transcript + picture).
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const PAGE = '/en/dev/interactives/';

async function open(page: Page, id: string) {
  const demo = page.locator(`[data-demo="${id}"]`);
  await demo.scrollIntoViewIfNeeded();
  await expect(demo.locator('astro-island[ssr]')).toHaveCount(0); // hydrated
  return demo;
}

async function type(page: Page, demo: ReturnType<Page['locator']>, command: string) {
  const input = demo.locator('.term-input');
  await input.click();
  await input.fill(command);
  await page.keyboard.press('Enter');
}

test.describe('KitchenSim', () => {
  test('run nginx with a port, see the state picture, reach it with curl', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'kitchen-sim');
    const board = demo.getByRole('region', { name: 'State of your kitchen' });
    await expect(board).toContainText('No containers yet');
    await expect(board).toContainText('nginx:1.30-alpine'); // already in the freezer
    await type(page, demo, 'docker run -d --name web -p 8080:80 nginx:1.30-alpine');
    await expect(demo.locator('.sim-explain')).toContainText('web runs in the background');
    const box = board.locator('.kb-box', { hasText: 'web' });
    await expect(box).toContainText('running');
    await expect(box).toHaveClass(/is-running/);
    await expect(board.locator('.kb-hatches')).toContainText('8080 → web:80');
    await expect(demo).not.toHaveAttribute('data-done', 'true');
    await type(page, demo, 'curl localhost:8080');
    await expect(demo).toHaveAttribute('data-done', 'true');
    await expect(demo.locator('.feedback-right')).toContainText('Your lunchbox serves the page through hatch 8080.');
  });

  test('a mistake gets a kind note and a hint, never a red WRONG', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'kitchen-sim');
    await type(page, demo, 'docker rn nginx');
    await expect(demo.locator('.sim-explain.sim-explain-err')).toContainText('Did you mean docker run?');
    await type(page, demo, 'curl localhost:8080');
    await expect(demo.locator('.sim-explain')).toContainText('Nothing answers on port 8080');
    await expect(demo).toHaveAttribute('data-wrong', '2');
    await expect(demo.locator('.feedback-almost')).toContainText('Type docker run -d --name web -p 8080:80 nginx:1.30-alpine');
    await expect(demo).not.toContainText(/wrong/i);
    await demo.getByRole('button', { name: /Start again/ }).click();
    await expect(demo.locator('.feedback-almost')).toHaveCount(0);
  });

  test('a shell inside a container, stopping, and the danger note (keyboard only)', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'kitchen-sim');
    const input = demo.locator('.term-input');
    await input.focus();
    await page.keyboard.type('docker run -d --name web nginx:1.30-alpine');
    await page.keyboard.press('Enter');
    await page.keyboard.type('docker exec -it web sh');
    await page.keyboard.press('Enter');
    await expect(demo.locator('.term-custom-prompt')).toHaveText('/ # ');
    await page.keyboard.type('exit');
    await page.keyboard.press('Enter');
    await expect(demo.locator('.term-path')).toHaveText('~');
    await page.keyboard.type('docker rm -f web');
    await page.keyboard.press('Enter');
    await expect(demo.locator('.ksim-danger')).toContainText('Careful: this command deletes things.');
    await expect(demo.locator('.ksim-danger svg')).toHaveCount(1); // red always comes with an icon
    await expect(demo.getByRole('region', { name: 'State of your kitchen' })).toContainText('No containers yet');
  });

  test('the Docker key row types words with a space', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'kitchen-sim');
    await demo.locator('.term-key', { hasText: /^docker$/ }).click();
    await demo.locator('.term-key', { hasText: /^-d$/ }).click();
    await expect(demo.locator('.term-input')).toHaveValue('docker -d ');
  });
});

test.describe('KitchenReplay', () => {
  test('the transcript and the picture follow the engine (calm mode: all at once)', async ({ browser, baseURL }) => {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.goto(`${baseURL}${PAGE}`);
    const demo = await open(page, 'kitchen-replay');
    await expect(demo.locator('.replay')).toContainText(' => => naming to docker.io/library/diary:1.0');
    await expect(demo.locator('.replay')).toContainText('<h1>My diary</h1>');
    await expect(demo.locator('figcaption')).toContainText('The recipe becomes the image diary:1.0');
    const board = demo.getByRole('region', { name: 'State of your kitchen' });
    await expect(board.locator('.kb-box', { hasText: 'diary' })).toContainText('running');
    await expect(board).toContainText('diary:1.0');
    await expect(demo.getByRole('button', { name: /Replay/ })).toHaveCount(0);
    await context.close();
  });

  test('plays line by line, then can replay', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'kitchen-replay');
    await expect(demo.locator('.replay-line').last()).not.toHaveClass(/replay-hidden/, { timeout: 15_000 });
    await demo.getByRole('button', { name: /Replay/ }).click();
    await expect(demo.locator('.replay-line').last()).not.toHaveClass(/replay-hidden/, { timeout: 15_000 });
  });
});

test.describe('kitchen pages', () => {
  test('BM page uses Malay UI text', async ({ page }) => {
    await page.goto('/ms/dev/interactives/');
    const demo = await open(page, 'kitchen-sim');
    const board = demo.getByRole('region', { name: 'Keadaan dapur anda' });
    await expect(board).toContainText('Laptop anda');
    await type(page, demo, 'docker ps');
    await expect(demo.locator('.sim-explain')).toContainText('Tiada container yang berjalan');
  });

  test('no horizontal scroll at 360px', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    for (const path of [PAGE, '/ms/dev/interactives/']) {
      await page.goto(path);
      const demo = await open(page, 'kitchen-sim');
      await type(page, demo, 'docker run -d --name web -p 8080:80 nginx:1.30-alpine');
      await open(page, 'kitchen-replay');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
  });

  for (const theme of ['light', 'dark'] as const) {
    for (const path of [PAGE, '/ms/dev/interactives/']) {
      test(`axe ${theme}: kitchen demos on ${path}`, async ({ page }) => {
        await page.addInitScript((t) => {
          localStorage.setItem('fahamlah:v1', JSON.stringify({ v: 1, settings: { theme: t, calm: true } }));
        }, theme);
        await page.goto(path);
        const demo = await open(page, 'kitchen-sim');
        await type(page, demo, 'docker run -d --name web -p 8080:80 nginx:1.30-alpine');
        await type(page, demo, 'docker run --name pg postgres:18-alpine');
        await open(page, 'kitchen-replay');
        const results = await new AxeBuilder({ page })
          .include('[data-demo="kitchen-sim"]')
          .include('[data-demo="kitchen-replay"]')
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
          .analyze();
        const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
        expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
      });
    }
  }
});
