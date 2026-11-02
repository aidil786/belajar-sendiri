// World D2 "Recipes" (Docker): the try cards really work, end to end, in EN and BM.
import { expect, test, type Locator, type Page } from '@playwright/test';

const active = (page: Page) => page.locator('.lesson-card.is-active');

async function card(page: Page, path: string, id: string): Promise<Locator> {
  await page.goto(`${path}#c=${id}`);
  const c = active(page);
  await expect(c).toHaveAttribute('data-card-id', id);
  await expect(c.locator('astro-island[ssr]')).toHaveCount(0); // hydrated
  return c;
}

async function type(page: Page, c: Locator, command: string) {
  const input = c.locator('.term-input');
  await input.click();
  await input.fill(command);
  await page.keyboard.press('Enter');
  await expect(input).toHaveValue('');
}

test.describe('World D2 try cards', () => {
  test('L01: build the first recipe and run it', async ({ page }) => {
    const c = await card(page, '/en/docker/recipes/first-dockerfile/', 'try-build');
    await type(page, c, 'docker build -t hello:1.0 .');
    await expect(c.locator('.sim-explain')).toBeVisible();
    await expect(c).not.toHaveAttribute('data-done', 'true');
    await type(page, c, 'docker run --rm hello:1.0');
    await expect(c).toHaveAttribute('data-done', 'true');
    await expect(c.locator('.feedback-right')).toContainText('Your first homemade image says hello!');
    await expect(c.getByRole('region', { name: 'State of your kitchen' })).toContainText('hello:1.0');
  });

  test('L06: reorder the kek lapis, then a code change keeps three layers CACHED (BM)', async ({ page }) => {
    const cake = await card(page, '/ms/docker/recipes/kek-lapis-cache/', 'try-cake');
    const build = cake.getByRole('button', { name: 'Ubah server.js dan bina semula' });
    await build.click();
    await expect(cake.locator('.feedback-almost')).toBeVisible({ timeout: 5000 });
    await expect(cake).not.toContainText(/salah|wrong/i);
    const down = cake.getByRole('button', { name: 'Turunkan: COPY . .' });
    await down.click();
    await down.click();
    await build.click();
    await expect(cake).toHaveAttribute('data-done', 'true', { timeout: 5000 });

    const c = await card(page, '/ms/docker/recipes/kek-lapis-cache/', 'try-cache');
    await type(page, c, 'echo "// v2" >> server.js');
    await type(page, c, 'docker build -t api:1.1 .');
    await expect(c).toHaveAttribute('data-done', 'true');
    await expect(c.locator('.sim-explain')).toContainText('3 langkah datang dari cache');
  });

  test('L12: a missing secret is a kind note; --secret builds without leaking it', async ({ page }) => {
    const c = await card(page, '/en/docker/recipes/cache-mounts-secrets/', 'try-secret');
    await type(page, c, 'docker build -t api:1.0 .');
    await expect(c.locator('.sim-explain')).toContainText('The build stopped.');
    await expect(c.locator('.term')).toContainText('npm_token: not found');
    await expect(c).not.toHaveAttribute('data-done', 'true');
    await type(page, c, 'docker build --secret id=npm_token,src=token.txt -t api:1.0 .');
    await expect(c).toHaveAttribute('data-done', 'true');
    await type(page, c, 'docker history --format "{{.CreatedBy}}" api:1.0');
    await expect(c.locator('.sim-explain')).toContainText('api:1.0');
    await expect(c.locator('.term')).not.toContainText('test-token-123');
  });

  test('Boss: plan with the shrink ray, then ship a small non-root diary', async ({ page }) => {
    const plan = await card(page, '/en/docker/recipes/boss/', 'try-plan');
    await plan.getByRole('button', { name: 'nginx:1.29-alpine' }).click();
    await expect(plan).not.toHaveAttribute('data-done', 'true'); // 78MB: still above 70MB
    await plan.getByRole('button', { name: /Add a \.dockerignore/ }).click();
    await expect(plan).toHaveAttribute('data-done', 'true');

    const c = await card(page, '/en/docker/recipes/boss/', 'try-nonroot');
    await type(page, c, 'echo "USER nginx" >> Dockerfile');
    await type(page, c, 'docker build -t diary:3.0 .');
    await type(page, c, 'docker run -d --name web -p 8080:80 diary:3.0');
    await expect(c).not.toHaveAttribute('data-done', 'true');
    await type(page, c, 'curl localhost:8080');
    await expect(c).toHaveAttribute('data-done', 'true');
    await expect(c.locator('.feedback-right')).toContainText('Shrink ray complete!');
  });

  test('L13: the real exec format error, then a matching build (BM)', async ({ page }) => {
    const hook = await card(page, '/ms/docker/recipes/multi-platform/', 'hook');
    await expect(hook).toContainText('exec /bin/cat: exec format error');
    const c = await card(page, '/ms/docker/recipes/multi-platform/', 'try-amd');
    await type(page, c, 'docker buildx build --platform linux/amd64,linux/arm64 -t hello:1.0 .');
    await expect(c.locator('.sim-explain')).toContainText('Dapur latihan ini tak jalankan');
    await type(page, c, 'docker build --platform linux/amd64 -t hello:amd64 .');
    await type(page, c, 'docker run --rm hello:amd64');
    await expect(c).toHaveAttribute('data-done', 'true');
  });
});
