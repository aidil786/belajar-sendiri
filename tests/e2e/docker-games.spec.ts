// Ship It Docker games on the hidden test page /<lang>/dev/interactives/:
// KekLapisBuilder, OrderHatch, LockerTest, ComposeCanvas, ShrinkRay, NamespaceXray.
// Runs on both projects (360 px phone and desktop).
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';

const PAGE = '/en/dev/interactives/';
const MS = '/ms/dev/interactives/';
const DEMOS = ['kek-order', 'kek-pick', 'hatch-map', 'hatch-conflict', 'locker', 'compose', 'shrink', 'shrink-site', 'nsx-find', 'nsx-all'];

async function open(page: Page, id: string) {
  const demo = page.locator(`[data-demo="${id}"]`);
  await demo.scrollIntoViewIfNeeded();
  await expect(demo.locator('astro-island[ssr]')).toHaveCount(0); // hydrated
  return demo;
}

/** Press a control with the keyboard only. */
async function press(page: Page, target: Locator, key = 'Enter') {
  await expect(target).toBeEnabled();
  await target.focus();
  await page.keyboard.press(key);
}

async function guess(demo: Locator, answers: Record<string, 'Stays' | 'Gone'>) {
  for (const [file, pick] of Object.entries(answers)) await demo.getByRole('group', { name: `Does ${file} stay?` }).getByRole('button', { name: pick }).click();
}

test.describe('Docker games', () => {
  test('KekLapisBuilder: copying everything first re-bakes the install; reorder fixes it', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'kek-order');
    await demo.getByRole('button', { name: 'Change index.html and build again' }).click();
    await expect(demo.locator('.feedback-almost')).toContainText('RUN npm ci --omit=dev baked again', { timeout: 5000 });
    await expect(demo.locator('.feedback-almost')).toContainText('Move COPY . . below it');
    await expect(demo).toHaveAttribute('data-wrong', '1');
    await expect(demo.locator('.kek-summary')).toHaveText('1 of 4 steps stayed CACHED. Baked again: 12.9MB.');

    // Move "COPY . ." below the install (two steps down).
    await demo.getByRole('button', { name: 'Move down: COPY . .' }).click();
    await demo.getByRole('button', { name: 'Move down: COPY . .' }).click();
    await expect(demo.locator('.kek-summary')).toHaveCount(0); // a new recipe needs a new build
    await demo.getByRole('button', { name: 'Change index.html and build again' }).click();
    await expect(demo).toHaveAttribute('data-done', 'true', { timeout: 5000 });
    await expect(demo.locator('.kek-layer.is-cached')).toHaveCount(3);
    await expect(demo.locator('.kek-layer.is-rebaked')).toHaveCount(1);
    await expect(demo.locator('.kek-summary')).toHaveText('3 of 4 steps stayed CACHED. Baked again: 36.9kB.');
    await demo.getByText('What docker build printed').click();
    await expect(demo.locator('.dg-output pre')).toContainText(' => CACHED [4/5] RUN npm ci --omit=dev');
    await expect(demo.locator('.dg-output pre')).toContainText(' => [5/5] COPY . .');
    // Sizes are the measured ones.
    await expect(demo.locator('.kek-k-base')).toContainText('181MB');
    await expect(demo.getByRole('button', { name: 'Replay' })).toBeEnabled();
  });

  test('KekLapisBuilder: pick a better line (keyboard only)', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'kek-pick');
    const select = demo.getByRole('combobox', { name: 'Pick line 3' });
    await select.focus();
    await select.selectOption('COPY package.json package-lock.json ./');
    await press(page, demo.getByRole('button', { name: 'Change server.js and build again' }));
    await expect(demo).toHaveAttribute('data-done', 'true', { timeout: 5000 });
    await expect(demo.locator('.kek-layer', { hasText: 'RUN npm ci' })).toContainText('CACHED');
  });

  test('OrderHatch: a cable to the wrong box gets a kind note; the right one sends a request', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'hatch-map');
    await demo.getByRole('button', { name: 'Laptop port 8080' }).click();
    await demo.getByRole('button', { name: 'api port 3000' }).click();
    await expect(demo.locator('.hatch-note')).toContainText('Laptop port 8080 goes to api:3000. It should go to web:80.');
    await expect(demo).toHaveAttribute('data-wrong', '1');
    await expect(demo.locator('.dg-term')).toContainText('$ docker run -d --name api -p 8080:3000 node:24-alpine');
    await demo.getByRole('button', { name: 'Unplug laptop port 8080' }).click();
    await demo.getByRole('button', { name: 'web port 80' }).click();
    await demo.getByRole('button', { name: 'Laptop port 8080' }).click();
    await expect(demo).toHaveAttribute('data-done', 'true');
    await expect(demo.locator('.dg-term')).toContainText('$ docker run -d --name web -p 8080:80 nginx:1.29-alpine');
    await expect(demo.locator('.hatch-cables')).toContainText('-p 8080:80');
    await expect(demo.locator('.hatch-trip')).toContainText('Your browser asked localhost:8080', { timeout: 5000 });
    await expect(demo.locator('.hatch-ok')).toHaveText('200 OK');
    await expect(demo.locator('.hatch-wire')).toHaveCount(1);
  });

  test('OrderHatch: two cables on one laptop port spark with Docker’s words (keyboard only)', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'hatch-conflict');
    await press(page, demo.getByRole('button', { name: 'Laptop port 8080, cable to web:80' }));
    await press(page, demo.getByRole('button', { name: 'api port 3000' }));
    const err = demo.locator('.dg-error');
    await expect(err).toContainText('Bind for 0.0.0.0:8080 failed: port is already allocated');
    await expect(err).toContainText('Laptop port 8080 already goes to web. One port, one cable.');
    await expect(err.locator('svg')).toHaveCount(1); // red always comes with an icon
    await expect(demo).toHaveAttribute('data-wrong', '1');
    await expect(demo.locator('.dg-term-line.is-err')).toContainText('docker run -d --name api -p 8080:3000 node:24-alpine');
    await press(page, demo.getByRole('button', { name: 'Laptop port 8081' }));
    await press(page, demo.getByRole('button', { name: 'api port 3000' }));
    await expect(demo).toHaveAttribute('data-done', 'true');
    await expect(demo.locator('.dg-error')).toHaveCount(0);
    await expect(demo.locator('.dg-term')).toContainText('$ docker run -d --name api -p 8081:3000 node:24-alpine');
  });

  test('LockerTest: predict, reveal, retry, three questions', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'locker');
    const run = demo.getByRole('button', { name: 'Run it' });
    await expect(run).toBeDisabled();
    await expect(demo.locator('.dg-term').first()).toContainText('docker run -d --name kedai -v kedai-data:/data -v ./menu:/menu --tmpfs /tmp/cache nginx:1.29-alpine');

    // 1. restart: tmpfs is the trap.
    await expect(demo.locator('.locker-action')).toContainText('$ docker restart kedai');
    await guess(demo, { 'today.txt': 'Stays', 'orders.db': 'Stays', 'menu.md': 'Stays', 'cache.bin': 'Stays' });
    await run.click();
    await expect(demo.locator('.feedback-almost')).toContainText('tmpfs lives only in memory', { timeout: 5000 });
    await expect(demo).toHaveAttribute('data-wrong', '1');
    await expect(demo.locator('.locker-truth.is-gone')).toHaveCount(1);
    await expect(demo.locator('.locker-truth.is-gone svg')).toHaveCount(1);
    await demo.getByRole('button', { name: 'Try again' }).click();
    await guess(demo, { 'today.txt': 'Stays', 'orders.db': 'Stays', 'menu.md': 'Stays', 'cache.bin': 'Gone' });
    await run.click();
    await expect(demo.locator('.feedback-right')).toContainText('4 of 4 right.', { timeout: 5000 });
    await demo.getByRole('button', { name: 'Replay' }).click();
    await expect(demo.locator('.feedback-right')).toContainText('4 of 4 right.', { timeout: 5000 });

    // 2. rm + run
    await demo.getByRole('button', { name: /Next question/ }).click();
    await expect(demo.locator('.locker-progress')).toHaveText('Question 2 of 3');
    await expect(demo.locator('.locker-action')).toContainText('$ docker rm -f kedai');
    await guess(demo, { 'today.txt': 'Gone', 'orders.db': 'Stays', 'menu.md': 'Stays', 'cache.bin': 'Gone' });
    await run.click();
    await expect(demo.locator('.feedback-right')).toContainText('4 of 4 right.', { timeout: 5000 });

    // 3. volume rm
    await demo.getByRole('button', { name: /Next question/ }).click();
    await expect(demo.locator('.locker-action')).toContainText('$ docker volume rm kedai-data');
    await guess(demo, { 'today.txt': 'Gone', 'orders.db': 'Gone', 'menu.md': 'Stays', 'cache.bin': 'Gone' });
    await run.click();
    await expect(demo).toHaveAttribute('data-done', 'true', { timeout: 5000 });
  });

  test('ComposeCanvas: compose.yaml writes itself; the goal is checked; compose up', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'compose');
    const yaml = demo.locator('.cc-yaml');
    await expect(yaml).toContainText('image: nginx:1.29-alpine');
    await demo.getByRole('button', { name: 'Add api' }).click();
    await demo.getByRole('button', { name: 'Add db' }).click();
    await expect(yaml).toContainText('build: ./api');
    await demo.getByRole('button', { name: 'Order the set meal' }).click();
    await expect(demo.locator('.feedback-almost')).toContainText('db needs the locker db-data');
    await expect(demo).toHaveAttribute('data-wrong', '1');

    await demo.getByRole('combobox', { name: 'Locker for db' }).selectOption('db-data');
    await expect(yaml).toContainText('- db-data:/var/lib/postgresql');
    const net = (svc: string, n: string) => demo.locator(`[data-service="${svc}"]`).getByRole('checkbox', { name: n });
    await net('web', 'front').check();
    await net('api', 'front').check();
    await net('api', 'back').check();
    await net('db', 'back').check();
    await demo.getByRole('combobox', { name: 'api waits for db' }).selectOption('service_healthy');
    await expect(yaml).toContainText('condition: service_healthy');
    await expect(yaml).toContainText('pg_isready');

    // Rule 18: about 15 lines show at once; the rest scrolls.
    const box = await yaml.evaluate((el) => ({ lines: el.querySelectorAll('.cc-line').length, scrolls: el.scrollHeight > el.clientHeight + 4, fits: el.clientHeight < 16 * parseFloat(getComputedStyle(el).lineHeight) + 24 }));
    expect(box.lines).toBeGreaterThan(15);
    expect(box.scrolls).toBe(true);
    expect(box.fits).toBe(true);
    await expect(yaml.locator('.cc-guide').first()).toBeAttached();

    await demo.getByRole('button', { name: 'Order the set meal' }).click();
    await expect(demo).toHaveAttribute('data-done', 'true', { timeout: 5000 });
    await expect(demo.locator('[data-service="db"]')).toContainText('healthy');
    await expect(demo.locator('[data-service="web"]')).toContainText('running');
    await expect(demo.locator('.dg-term')).toContainText('$ docker compose up -d');
  });

  test('ComposeCanvas: drag a dish onto the table', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Mouse drag is a desktop check; phones use tap (covered above).');
    await page.goto(PAGE);
    const demo = await open(page, 'compose');
    const chip = demo.getByRole('button', { name: 'Add cache' });
    const table = demo.locator('.cc-table');
    await chip.scrollIntoViewIfNeeded();
    const a = (await chip.boundingBox())!;
    const b = (await table.boundingBox())!;
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(a.x + a.width / 2 + 5, a.y + a.height / 2 + 5, { steps: 3 });
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
    await page.mouse.up();
    await expect(demo.locator('[data-service="cache"]')).toBeVisible();
    await expect(demo.locator('.cc-yaml')).toContainText('image: redis:8-alpine');
  });

  test('ShrinkRay: refused moves explain why; measured sizes shrink to the target', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'shrink');
    const meter = demo.getByRole('meter', { name: 'Image size' });
    await expect(meter).toHaveAttribute('aria-valuetext', '1.36GB');
    await demo.getByRole('button', { name: 'gcr.io/distroless/nodejs24-debian13' }).click();
    await expect(demo.locator('.feedback-almost')).toContainText('has no npm or shell');
    await demo.getByRole('button', { name: /Ship without dev tools/ }).click();
    await expect(demo.locator('.feedback-almost')).toContainText('The build needs TypeScript');
    await expect(demo).toHaveAttribute('data-wrong', '2');

    await demo.getByRole('button', { name: /Add a \.dockerignore/ }).click();
    await expect(meter).toHaveAttribute('aria-valuetext', '1.3GB');
    await demo.getByRole('button', { name: 'node:24-alpine' }).click();
    await expect(meter).toHaveAttribute('aria-valuetext', '260MB');
    await demo.getByRole('button', { name: /Add a build stage/ }).click();
    await expect(meter).toHaveAttribute('aria-valuetext', '243MB');
    await expect(demo.locator('.dg-code').first()).toContainText('FROM node:24-alpine AS build');
    await demo.getByRole('button', { name: /Ship without dev tools/ }).click();
    await expect(meter).toHaveAttribute('aria-valuetext', '190MB');
    await expect(demo).toHaveAttribute('data-done', 'true');
    await expect(demo.locator('.dg-code').first()).toContainText('RUN npm prune --omit=dev');
    await expect(demo.locator('.feedback-right')).toContainText('Under the target at 190MB.');
    await demo.getByRole('button', { name: 'Replay' }).click();
    await expect(demo.locator('.shrink-fill.is-rewind')).toHaveCount(0);
    await expect(meter).toHaveAttribute('aria-valuetext', '190MB');
  });

  test('ShrinkRay: static site with nginx alpine (keyboard only)', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'shrink-site');
    await press(page, demo.getByRole('button', { name: 'nginx:1.29-alpine' }));
    await expect(demo).toHaveAttribute('data-done', 'true');
    await expect(demo.getByRole('meter', { name: 'Image size' })).toHaveAttribute('aria-valuetext', '78MB');
  });

  test('NamespaceXray: find the switch that hides other processes', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'nsx-find');
    const processes = demo.getByRole('region', { name: 'Processes it sees' });
    await expect(processes).toContainText('4242 node server.js');
    await demo.getByRole('switch', { name: /UTS \(hostname\)/ }).click();
    await expect(demo.getByRole('region', { name: 'Hostname' })).toContainText('3f9c2a7b1d04');
    await expect(demo.getByRole('region', { name: 'Hostname' })).toContainText('Before: aina-laptop.');
    await expect(demo.locator('.feedback-almost')).toContainText('UTS (hostname) changed: Hostname.');
    await expect(demo).toHaveAttribute('data-wrong', '1');
    await demo.getByRole('switch', { name: /^PID/ }).click();
    await expect(demo).toHaveAttribute('data-done', 'true');
    await expect(processes.locator('li')).toHaveCount(1);
    await expect(processes).toContainText('1 node server.js');
    await expect(processes).toContainText('Docker also mounts a fresh /proc');
  });

  test('NamespaceXray: every switch, keyboard only; Docker’s default set makes a container', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'nsx-all');
    const status = demo.locator('.nsx-status');
    await expect(status).toContainText('Just a process');
    for (const name of [/^PID/, /^Mount/, /^Network/, /^UTS/, /^IPC/]) await press(page, demo.getByRole('switch', { name }), ' ');
    await expect(status).toContainText('A container now');
    await expect(demo.getByRole('switch', { name: /^PID/ })).toHaveAttribute('aria-checked', 'true');
    await expect(demo).not.toHaveAttribute('data-done', 'true');
    for (const name of [/^User/, /^Memory limit/, /^CPU limit/, /^Process limit/]) await press(page, demo.getByRole('switch', { name }), ' ');
    await expect(demo).toHaveAttribute('data-done', 'true');
    const limits = demo.getByRole('region', { name: 'Limits' });
    await expect(limits).toContainText('memory.max = 536870912');
    await expect(limits).toContainText('cpu.max = 150000 100000');
    await expect(limits).toContainText('pids.max = 100');
    await expect(demo.getByRole('region', { name: 'User' })).toContainText('uid=100000');
  });

  test('reduced motion: results at once, with Before/After toggles', async ({ browser, baseURL }) => {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.goto(`${baseURL}${PAGE}`);
    const kek = await open(page, 'kek-order');
    await kek.getByRole('button', { name: 'Change index.html and build again' }).click();
    await expect(kek.locator('.feedback-almost')).toBeVisible();
    await expect(kek.locator('.kek-layer.is-waiting, .kek-layer.is-baking')).toHaveCount(0);
    await kek.getByRole('button', { name: 'Show before' }).click();
    await expect(kek.locator('.scene-state')).toHaveText('First build');
    await expect(kek.locator('.kek-layer.is-rebaked')).toHaveCount(0);
    await kek.getByRole('button', { name: 'Show after' }).click();
    await expect(kek.locator('.kek-layer.is-rebaked')).toHaveCount(3);

    const hatch = await open(page, 'hatch-map');
    await hatch.getByRole('button', { name: 'Laptop port 8080' }).click();
    await hatch.getByRole('button', { name: 'web port 80' }).click();
    await expect(hatch.locator('.hatch-trip')).toBeVisible();
    await expect(hatch.locator('.hatch-dot')).toHaveCount(0);
    await hatch.getByRole('button', { name: 'Show before' }).click();
    await expect(hatch.locator('.hatch-trip')).toHaveCount(0);

    const shrink = await open(page, 'shrink');
    await shrink.getByRole('button', { name: 'node:24-slim' }).click();
    await expect(shrink.locator('.shrink-compare')).toHaveText('Before: 1.36GB → After: 390MB');
    await context.close();
  });

  test('BM page uses Malay UI text', async ({ page }) => {
    await page.goto(MS);
    const kek = await open(page, 'kek-order');
    await expect(kek.getByRole('button', { name: 'Ubah index.html dan bina semula' })).toBeVisible();
    const locker = await open(page, 'locker');
    await expect(locker.getByRole('group', { name: 'Adakah orders.db kekal?' }).getByRole('button', { name: 'Kekal' })).toBeVisible();
    const hatch = await open(page, 'hatch-conflict');
    await hatch.getByRole('button', { name: 'Port laptop 8080, kabel ke web:80' }).click();
    await hatch.getByRole('button', { name: 'api port 3000' }).click();
    await expect(hatch.locator('.dg-error')).toContainText('Satu port, satu kabel.');
    const nsx = await open(page, 'nsx-all');
    await expect(nsx.locator('.nsx-status')).toContainText('Hanya satu proses');
  });

  test('no horizontal scroll at 360px', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    for (const path of [PAGE, MS]) {
      await page.goto(path);
      for (const id of DEMOS) await open(page, id);
      const compose = page.locator('[data-demo="compose"]');
      for (const name of ['api', 'db', 'cache']) await compose.locator('.cc-chip').filter({ hasText: name }).first().click();
      const hatch = page.locator('[data-demo="hatch-conflict"]');
      await hatch.locator('[data-host="8080"]').click();
      await hatch.locator('[data-box="api:3000"]').click();
      await expect(hatch.locator('.dg-error')).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
  });

  for (const theme of ['light', 'dark'] as const) {
    for (const path of [PAGE, MS]) {
      test(`axe ${theme}: ${path}`, async ({ page }) => {
        await page.addInitScript((t) => {
          localStorage.setItem('fahamlah:v1', JSON.stringify({ v: 1, settings: { theme: t } }));
        }, theme);
        await page.goto(path);
        for (const id of DEMOS) await open(page, id);
        // Show the states with the most colour: a spark, a reveal, a full stack, a refused move, a changed panel.
        const hatch = page.locator('[data-demo="hatch-conflict"]');
        await hatch.locator('[data-host="8080"]').click();
        await hatch.locator('[data-box="api:3000"]').click();
        await expect(hatch.locator('.dg-error')).toBeVisible();
        const locker = page.locator('[data-demo="locker"]');
        for (const b of await locker.locator('.locker-guess').all()) await b.locator('.locker-pick').first().click();
        await locker.locator('.scene-controls .btn').first().click();
        await expect(locker.locator('.locker-truth').first()).toBeVisible({ timeout: 5000 });
        const compose = page.locator('[data-demo="compose"]');
        await compose.locator('.cc-chip').nth(1).click();
        await compose.locator('.cc-chip').nth(2).click();
        const shrink = page.locator('[data-demo="shrink"]');
        await shrink.locator('.shrink-move').nth(3).click();
        await expect(shrink.locator('.feedback-almost')).toBeVisible();
        const nsx = page.locator('[data-demo="nsx-all"]');
        await nsx.getByRole('switch').first().click();
        const kek = page.locator('[data-demo="kek-order"]');
        await kek.locator('.scene-controls .btn').first().click();
        await expect(kek.locator('.feedback-almost')).toBeVisible({ timeout: 5000 });
        // Let animations settle: mid-fade colours read as low contrast.
        await page.waitForTimeout(1500);
        // Scroll back up so the sticky top bar doesn't sit over a button (axe counts that as a tiny target).
        await page.evaluate(() => window.scrollTo(0, 0));
        let axe = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']);
        for (const id of DEMOS) axe = axe.include(`[data-demo="${id}"]`);
        const results = await axe.analyze();
        const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
        expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
      });
    }
  }
});
