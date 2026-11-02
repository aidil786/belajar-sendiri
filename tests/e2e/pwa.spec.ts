// Offline support: manifest, service worker, visited lessons work offline, "save all lessons".
import { expect, test, type Page } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

/** Wait until the service worker controls this page. */
async function controlled(page: Page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise((resolve) => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
    }
  });
}

/** Is this page saved, with every island's JS file too? */
const fullySaved = (page: Page, url: string) =>
  page.evaluate(async (u) => {
    const res = await caches.match(u, { ignoreVary: true });
    if (!res) return false;
    const html = await res.text();
    const files = [...html.matchAll(/(?:component|renderer)-url="([^"]+)"/g)].map((m) => m[1]!);
    for (const f of files) if (!(await caches.match(f, { ignoreVary: true }))) return false;
    return true;
  }, url);

test('manifest and icons are served', { tag: '@desktop-only' }, async ({ request }) => {
  const res = await request.get('/manifest.webmanifest');
  expect(res.status()).toBe(200);
  const manifest = await res.json();
  expect(manifest).toMatchObject({ name: 'Belajar Sendiri', start_url: '/', display: 'standalone' });
  expect(manifest.icons.map((i: { purpose: string }) => i.purpose)).toContain('maskable');
  for (const icon of manifest.icons as { src: string; type: string }[]) {
    const r = await request.get(icon.src);
    expect(r.status(), icon.src).toBe(200);
    expect(r.headers()['content-type']).toContain(icon.type);
  }
  const sw = await request.get('/sw.js');
  expect(sw.status()).toBe(200);
  const text = await sw.text();
  expect(text).not.toContain('__FAHAMLAH_');
  expect(text).toMatch(/const BUILD = "[0-9a-f]{12}";/);
});

test('the service worker registers, and a visited lesson works offline', { tag: '@desktop-only' }, async ({ page, context }) => {
  test.setTimeout(60_000);
  await page.goto('/en/');
  await controlled(page);
  const lesson = '/en/git/save-points/the-box/';
  await page.goto(lesson);
  await expect(page.locator('[data-count]')).toContainText('Card 1 of 9');
  await expect.poll(() => fullySaved(page, lesson), { timeout: 20_000 }).toBe(true);

  await context.setOffline(true);
  // A card whose island never loaded online still wakes up offline.
  await page.goto(`${lesson}#c=predict`);
  await expect(page.locator('[data-count]')).toContainText('Card 7 of 9');
  const card = page.locator('.lesson-card.is-active');
  await expect(card.locator('astro-island[ssr]')).toHaveCount(0);
  await card.getByRole('button', { name: /Only/ }).click();
  await expect(card.locator('.feedback-right')).toBeVisible();

  // A page never opened: the friendly bilingual offline page, listing saved pages.
  await page.goto('/en/glossary/');
  await expect(page.getByRole('heading', { name: 'You are offline' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Anda di luar talian' })).toBeVisible();
  await expect(page.locator('[data-saved-list]')).toContainText('The Box');
  // Home was saved at install time.
  await page.goto('/ms/');
  await expect(page.locator('[data-continue]')).toBeVisible();
  await context.setOffline(false);
});

test('settings can save all lessons for offline use', { tag: '@desktop-only' }, async ({ page, context }) => {
  // Level Up roughly doubled the lesson pages, so saving them all takes longer on a busy runner.
  test.setTimeout(300_000);
  await page.goto('/en/settings/');
  await controlled(page);
  await page.getByRole('button', { name: 'Save all lessons for offline use' }).click();
  await expect(page.locator('[data-offline-status]')).toContainText(/Done! \d+ pages saved on this device\./, { timeout: 240_000 });

  await context.setOffline(true);
  await page.goto('/en/git/undo-magic/reflog-safety-net/');
  await expect(page.locator('[data-count]')).toContainText('Card 1 of');
  await page.goto('/en/git/');
  await expect(page.getByRole('heading', { name: 'World map' })).toBeVisible();
  await context.setOffline(false);
});
