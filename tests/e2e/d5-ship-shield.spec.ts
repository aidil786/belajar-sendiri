// Docker World D5 (Ship & Shield): finish the kitchen simulators (registry push, token login, digest pin,
// pull limit, least privilege, history leak, boss rooms) and a few quiz cards. EN everywhere, BM for one.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';

const BASE = '/en/docker/ship-shield';

for (const path of [`${BASE}/registries/#c=try-push`, `${BASE}/least-privilege/#c=check-nginx`, '/ms/docker/ship-shield/boss/#c=try-push']) {
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

async function type(page: Page, command: string) {
  const input = active(page).locator('.term-input');
  await input.fill(command);
  await input.press('Enter');
}

async function choose(page: Page, text: string) {
  await active(page).locator('.choice-btn', { hasText: text }).click();
  await expect(active(page).locator('.feedback-right')).toBeVisible();
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

async function build(card: Locator, pieces: string[]) {
  for (const p of pieces) await card.locator('.builder-piece', { has: card.page().locator('code', { hasText: exact(p) }) }).click();
}

test('D5.1 registries: Mei is denied, you tag and push, Mei pulls', async ({ page }) => {
  await page.goto(`${BASE}/registries/`);
  await goTo(page, 'hook');
  await expect(active(page)).toContainText('pull access denied for you/kedai-api');
  await goTo(page, 'see-name');
  await order(active(page), ['ghcr.io', '/you', '/kedai-api', ':1.0']);
  await done(page);
  await goTo(page, 'try-push');
  const board = active(page).getByRole('region', { name: 'State of your kitchen' });
  await type(page, 'docker push kedai-api:1.0');
  await expect(active(page)).toContainText('push access denied');
  await expect(active(page)).not.toHaveAttribute('data-done', 'true');
  await type(page, 'docker tag kedai-api:1.0 you/kedai-api:1.0');
  await type(page, 'docker push you/kedai-api:1.0');
  await done(page);
  await expect(board).toContainText('you/kedai-api:1.0');
  await noSideScroll(page);
  await goTo(page, 'predict');
  await choose(page, 'Docker Hub');
});

test('D5.2 login: the token, through a pipe', async ({ page }) => {
  await page.goto(`${BASE}/login-with-tokens/#c=see-stdin`);
  await goTo(page, 'see-stdin');
  await build(active(page), ['echo', '$DOCKER_TOKEN', '|', 'docker login', '-u you', '--password-stdin']);
  await done(page);
  await goTo(page, 'try-login');
  await type(page, 'echo $DOCKER_TOKEN | docker login -u you --password-stdin');
  await done(page);
});

test('D5.3 tags: one build, two honest tags', async ({ page }) => {
  await page.goto(`${BASE}/tag-strategy/#c=try-tags`);
  await goTo(page, 'try-tags');
  await type(page, 'docker build -t kedai-api:1.4.2 -t kedai-api:sha-3f9c2e1 .');
  await done(page);
});

test('D5.4 digest: a wrong one is not found, $PIN runs', async ({ page }) => {
  await page.goto(`${BASE}/pin-by-digest/#c=try-run`);
  await goTo(page, 'try-run');
  await type(page, 'docker run --rm node:24-alpine@sha256:1111111111111111111111111111111111111111111111111111111111111111 node --version');
  await expect(active(page)).toContainText('not found');
  await expect(active(page)).not.toHaveAttribute('data-done', 'true');
  await type(page, 'docker run --rm node:24-alpine@$PIN node --version');
  await done(page);
  await goTo(page, 'see-recipe');
  await active(page).locator('.spot-line', { hasText: '@sha256:8a32c8cf649a' }).click();
  await done(page);
});

test('D5.5 pull limit: 429 until you log in (BM)', async ({ page }) => {
  await page.goto('/ms/docker/ship-shield/pull-limits-licence/#c=try-login');
  await goTo(page, 'try-login');
  await type(page, 'docker pull redis:8-alpine');
  await expect(active(page)).toContainText('429 Too Many Requests');
  await type(page, 'echo $DOCKER_TOKEN | docker login -u you --password-stdin');
  await type(page, 'docker pull redis:8-alpine');
  await done(page);
  await goTo(page, 'see-licence');
  await sort(active(page), [
    ['Anda, belajar di rumah', 'Docker Desktop percuma'],
    ['Satu kelas sekolah', 'Docker Desktop percuma'],
    ['Kedai Kancil', 'Docker Desktop percuma'],
    ['Bank dengan 5,000 pekerja', 'Perlu pelan berbayar'],
    ['Syarikat dengan 100 pekerja', 'Perlu pelan berbayar'],
    ['Pejabat kerajaan', 'Perlu pelan berbayar'],
  ]);
  await done(page);
});

test('D5.8 least privilege: three shields, and the API still answers', async ({ page }) => {
  await page.goto(`${BASE}/least-privilege/#c=try-shields`);
  await goTo(page, 'try-shields');
  await type(page, 'docker run -d --name web --read-only nginx:1.30-alpine');
  await type(page, 'docker logs web');
  await expect(active(page)).toContainText('(30: Read-only file system)');
  await type(page, 'docker run -d --name api --read-only --cap-drop ALL -p 3000:3000 kedai-api:1.0');
  await done(page);
  await type(page, 'docker exec api touch /app/x');
  await expect(active(page)).toContainText('touch: /app/x: Read-only file system');
  await noSideScroll(page);
});

test('D5.9 history: the detective finds the token', async ({ page }) => {
  await page.goto(`${BASE}/history-leaks/#c=try-find`);
  await goTo(page, 'try-find');
  await type(page, 'docker history menu:1.0');
  await expect(active(page)).not.toHaveAttribute('data-done', 'true');
  await type(page, 'docker history --no-trunc menu:1.0');
  await done(page);
});

test('D5 boss: not root, a clean scan, pushed to GHCR', async ({ page }) => {
  await page.goto(`${BASE}/boss/`);
  await goTo(page, 'try-root');
  await type(page, 'echo "USER node" >> Dockerfile');
  await type(page, 'docker build -t kedai-api:1.0 .');
  await done(page);
  await goTo(page, 'check-scan');
  await sort(active(page), [
    ['CRITICAL, fix available', 'Stops the release'],
    ['CRITICAL, no fix yet', 'Stops the release'],
    ['HIGH, fix available', 'Ship, and plan a fix'],
    ['LOW, no fix yet', 'Ship, and plan a fix'],
  ]);
  await done(page);
  await goTo(page, 'try-push');
  await type(page, 'echo $CR_PAT | docker login ghcr.io -u you --password-stdin');
  await type(page, 'docker tag kedai-api:1.0 ghcr.io/you/kedai-api:1.0');
  await type(page, 'docker push ghcr.io/you/kedai-api:1.0');
  await done(page);
  await goTo(page, 'check-sbom');
  await build(active(page), ['docker buildx build', '--sbom=true', '-t ghcr.io/you/kedai-api:1.0', '--push', '.']);
  await done(page);
  await noSideScroll(page);
});
