// Docker World D6 (Under the Hood): finish the simulator cards and the X-ray boss, EN and BM,
// and the Docker flows in the Ship It Rescue Center. Runs on both projects (360 px phone and desktop).
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';

const BASE = '/en/docker/under-the-hood';

for (const path of [`${BASE}/just-a-process/#c=try-inside`, `${BASE}/boss/#c=try-all`, '/ms/docker/under-the-hood/cgroups/#c=check-oom']) {
  test(`axe: ${path}`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  });
}

const active = (page: Page) => page.locator('.lesson-card.is-active');
const next = (page: Page) => page.locator('[data-next]').click();
const goTo = async (page: Page, id: string) => {
  for (let i = 0; i < 15; i++) {
    if ((await active(page).getAttribute('data-card-id')) === id) break;
    await next(page);
  }
  await expect(active(page)).toHaveAttribute('data-card-id', id);
  await expect(active(page).locator('astro-island[ssr]')).toHaveCount(0); // hydrated
};
const done = (page: Page) => expect(active(page)).toHaveAttribute('data-done', 'true', { timeout: 20_000 });
const exact = (text: string) => new RegExp(`^\\s*${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`);

async function noSideScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

async function choose(page: Page, text: string) {
  await active(page).locator('.choice-btn', { hasText: text }).click();
  await expect(active(page).locator('.feedback-right')).toBeVisible();
}

async function type(page: Page, command: string) {
  const input = active(page).locator('.term-input');
  await input.click();
  await input.fill(command);
  await page.keyboard.press('Enter');
}

async function sort(card: Locator, items: [string, string][]) {
  for (const [label, bucket] of items) {
    await card.locator('.sort-card', { hasText: label }).click();
    await card.locator('.sort-bucket-head', { hasText: exact(bucket) }).click();
  }
}

async function order(card: Locator, want: string[]) {
  for (let i = 0; i < want.length; i++) {
    const texts = (await card.locator('.order-item .order-text').allInnerTexts()).map((t) => t.trim());
    for (let j = texts.indexOf(want[i]!); j > i; j--) await card.locator('.order-item').nth(j).locator('.order-btn').first().click();
  }
  await card.locator('.order .btn').click();
}

const flip = async (page: Page, names: RegExp[]) => {
  for (const name of names) await active(page).getByRole('switch', { name }).click();
};

test('D6.1 one process, seen from inside, and sorted from a VM', async ({ page }) => {
  await page.goto(`${BASE}/just-a-process/`);
  await goTo(page, 'hook');
  await choose(page, 'From the web container you started');
  await goTo(page, 'try-inside');
  await type(page, 'docker exec web ps');
  await done(page);
  // xterm only keeps the rows in view in the page; on a phone the top rows have scrolled up.
  await expect(active(page).locator('.term')).toContainText('nginx: worker process');
  await noSideScroll(page);
  await goTo(page, 'check-sort');
  await sort(active(page), [
    ['Shows up in the laptop’s process list', 'Container (a process)'],
    ['Boots its own kernel', 'Virtual machine'],
    ['Shares the laptop’s kernel', 'Container (a process)'],
    ['Can run Windows on a Linux laptop', 'Virtual machine'],
  ]);
  await done(page);
  await goTo(page, 'win');
});

test('D6.3 a 256 MB portion shows in docker stats', async ({ page }) => {
  await page.goto(`${BASE}/cgroups/#c=try-limit`);
  await goTo(page, 'try-limit');
  await type(page, 'docker run -d --name web --memory 256m nginx:1.30-alpine');
  await expect(active(page)).not.toHaveAttribute('data-done', 'true');
  await type(page, 'docker stats --no-stream');
  await done(page);
  await expect(active(page).locator('.term')).toContainText('/ 256MiB');
  await noSideScroll(page);
});

test('D6.4 (BM) box2 cannot read the note on box1’s top sheet', async ({ page }) => {
  await page.goto('/ms/docker/under-the-hood/overlay-filesystem/#c=try-note');
  await goTo(page, 'try-note');
  await type(page, 'docker exec box2 cat /root/note.txt');
  await done(page);
  await expect(active(page).locator('.term')).toContainText("cat: can't open '/root/note.txt': No such file or directory");
});

test('D6 boss: X-ray, room by room', async ({ page }) => {
  await page.goto(`${BASE}/boss/`);
  await goTo(page, 'hook');
  await choose(page, 'A normal process with namespaces and cgroups switched on');
  await goTo(page, 'try-pid');
  await flip(page, [/^PID/]);
  await done(page);
  await expect(active(page).getByRole('region', { name: 'Processes it sees' })).toContainText('Docker also mounts a fresh /proc');
  await goTo(page, 'predict-proc');
  await choose(page, 'ps reads /proc');
  await goTo(page, 'try-docker');
  await expect(active(page).locator('.nsx-status')).toContainText('Just a process');
  await flip(page, [/^Mount/, /^Network/, /^UTS/, /^IPC/]);
  await done(page);
  await expect(active(page).locator('.nsx-status')).toContainText('A container now');
  await goTo(page, 'try-real');
  await type(page, 'docker exec web ps');
  await type(page, 'docker top web');
  await done(page);
  await goTo(page, 'try-all');
  await flip(page, [/^User/, /^Memory limit/, /^CPU limit/, /^Process limit/]);
  await done(page);
  await noSideScroll(page);
  await goTo(page, 'check-relay');
  await order(active(page), ['You type docker run', 'dockerd passes the order to containerd', 'containerd stacks the image layers with a fresh top sheet', 'runc switches on namespaces and cgroups', 'Your app starts as PID 1, and runc leaves']);
  await done(page);
  await goTo(page, 'win');
});

test('Ship It rescue: the ten Docker flows, with links to ready D6 lessons', async ({ page }) => {
  await page.goto('/en/ship-it/rescue/');
  await expect(page.locator('[data-rescue-group="docker"] [data-rescue-flow]')).toHaveCount(10);
  // The flows hydrate after load; on a busy machine the first tap can land before that.
  await expect(async () => {
    await page.locator('[data-rescue-flow="docker-exits-right-away"]').click();
    await expect(page.getByRole('button', { name: 'Exited (137)' })).toBeVisible({ timeout: 2000 });
  }).toPass();
  await page.getByRole('button', { name: 'Exited (137)' }).click();
  const result = page.locator('.rescue-result');
  await expect(result).toContainText("docker inspect -f '{{.State.OOMKilled}}' web");
  await expect(result.getByRole('link', { name: 'cgroups: what it can use' })).toHaveAttribute('href', '/en/docker/under-the-hood/cgroups/');
  await noSideScroll(page);
});

test('Ship It rescue (BM): a link opens the "can’t find by name" flow', async ({ page }) => {
  await page.goto('/ms/ship-it/rescue/#docker-name-not-found');
  await page.getByRole('button', { name: 'Yang lalai (bridge), atau tak pasti' }).click();
  await expect(page.locator('.rescue-result')).toContainText('docker network create shopnet');
  await noSideScroll(page);
});
