// Multi-course site: the course catalog on home, the Ship It overview, each part's world map,
// per-course tool pages, the Ship It Rescue Center and the course switcher in the top bar.
import { expect, test, type Page } from '@playwright/test';

async function seed(page: Page, data: Record<string, unknown>) {
  await page.addInitScript((d) => localStorage.setItem('fahamlah:v1', JSON.stringify(d)), data);
}

test('home: the catalog lists Git & GitHub and the three Ship It parts', async ({ page }) => {
  await page.goto('/en/');
  const catalog = page.locator('.catalog');
  await expect(catalog.getByRole('heading', { name: 'Git & GitHub' })).toBeVisible();
  await expect(catalog.getByRole('heading', { name: 'Ship It' })).toBeVisible();
  const card = catalog.locator('[data-course-card="ship-it"]');
  for (const [id, name] of [
    ['docker', 'Docker'],
    ['cicd', 'CI/CD'],
    ['kubernetes', 'Kubernetes'],
  ] as const) {
    await expect(card.locator(`.part-row[data-course-card="${id}"]`).getByRole('link', { name, exact: true })).toHaveAttribute('href', `/en/${id}/`);
  }
  // Home stays short: the gentle tips (never a lock) live on the Ship It page.
  await expect(catalog).not.toContainText('Not a lock.');
  await page.goto('/en/ship-it/');
  await expect(page.locator('main')).toContainText('best after Git & GitHub, Worlds 0–4. Not a lock.');
  await expect(page.locator('main')).toContainText('World 7');
  await expect(page.locator('[data-mascot][data-hat="chef"]').first()).toHaveAttribute('aria-label', "Kancil the mouse deer in a chef's hat");
});

test('home: a family card says Continue when you are in one of its parts', async ({ page }) => {
  await seed(page, { v: 2, resume: { lessonId: 'docker-d1-l07', cardId: 'hook', cardIndex: 0, path: '/en/docker/first-containers/port-mapping/' } });
  await page.goto('/en/');
  const go = page.locator('[data-course-go="ship-it"]');
  await expect(go).toHaveText('Continue');
  await expect(go).toHaveAttribute('href', '/en/docker/first-containers/port-mapping/#c=hook');
  await expect(page.locator('[data-course-go="level-up"]')).toHaveText('Start');
});

test('home: Continue resumes in any course; each course card shows its own progress', async ({ page }) => {
  await seed(page, {
    v: 2,
    completed: ['git-w00-l01', 'git-w00-l02'],
    resume: { lessonId: 'git-w01-l03', cardId: 'hook', cardIndex: 0, path: '/en/git/save-points/the-box/' },
  });
  await page.goto('/en/');
  await expect(page.locator('[data-continue]')).toHaveAttribute('href', '/en/git/save-points/the-box/#c=hook');
  await expect(page.locator('[data-course-progress="git"]')).toHaveText(/^2 of \d+ lessons done$/);
  const go = page.locator('[data-course-go="git"]');
  await expect(go).toHaveText('Continue');
  await expect(go).toHaveAttribute('href', '/en/git/save-points/the-box/#c=hook');
});

test('ship-it: three parts with world codes, missions M1–M6, Rescue Center and Career Quest', async ({ page }) => {
  await page.goto('/en/ship-it/');
  await expect(page.getByRole('heading', { level: 1, name: 'Ship It' })).toBeVisible();
  await expect(page.locator('[data-part]')).toHaveCount(3);
  await expect(page.locator('[data-part="docker"] .tile')).toHaveCount(7);
  await expect(page.locator('[data-part="cicd"] .tile')).toHaveCount(4);
  // K1–K7 plus the CKA extra pack (K9); Career Quest (K8) has its own finish-line box.
  await expect(page.locator('[data-part="kubernetes"] .tile')).toHaveCount(8);
  await expect(page.locator('[data-part="kubernetes"] .tile').last()).toContainText('Extra pack');
  await expect(page.locator('[data-part="kubernetes"] .tile-code').last()).toHaveText('K9');
  await expect(page.locator('[data-part="docker"] .tile-code').first()).toHaveText('D0');
  await expect(page.locator('.tile-mission')).toHaveText(['M1', 'M2', 'M3', 'M4', 'M5', 'M6'].map((m) => new RegExp(`^${m}`)));
  // A tile opens that world on its part's map.
  await page.locator('[data-part="kubernetes"] .tile', { hasText: 'Guards' }).click();
  await expect(page).toHaveURL(/\/en\/kubernetes\/#world-6$/);
  await expect(page.locator('#world-6 details.island-lessons')).toHaveAttribute('open', '');
  await page.goBack();
  await page.getByRole('link', { name: 'Ship It Rescue Center' }).click();
  await expect(page).toHaveURL(/\/en\/ship-it\/rescue\/$/);
});

test('course maps: world codes, part name, hats, missions and "Coming soon"', async ({ page }) => {
  await page.goto('/en/docker/');
  await expect(page.getByRole('heading', { level: 1, name: 'Docker map' })).toBeVisible();
  await expect(page.locator('.map-part')).toContainText('Part 1 · Dapur');
  await expect(page.locator('[data-island]')).toHaveCount(7);
  await expect(page.locator('#world-1 .island-num')).toHaveText('World D1');
  await expect(page.locator('#world-4 .mission-tag')).toContainText('M1');
  await page.locator('#world-4 details.island-lessons summary').click();
  await expect(page.locator('[data-lesson-row="docker-d4-m1"]')).toContainText('Mission 1');
  // The "Lessons are on the way" note only shows while a course has no ready lesson; Docker has some now.
  await expect(page.getByText('Lessons are on the way.')).toHaveCount(0);

  await page.goto('/ms/kubernetes/');
  await expect(page.locator('#world-1 .island-num')).toHaveText('Dunia K1');
  await expect(page.locator('.map-part')).toContainText('Bahagian 3 · Medan Selera');
  await expect(page.locator('[data-mascot][data-hat="captain"]')).toHaveAttribute('aria-label', 'Sang Kancil memakai topi kapten');
  await expect(page.locator('[data-island]')).toHaveCount(9);
  // The CKA pack (K9) is an open extra pack; Career Quest (K8) stays the last island.
  await expect(page.locator('#world-9 [data-extra-pack]')).toContainText('Pek tambahan');
  await expect(page.locator('[data-island]').last()).toHaveAttribute('id', 'world-8');
});

test('per-course tools: glossary, commands and cheat sheet; Git keeps its URLs', async ({ page }) => {
  await page.goto('/en/docker/glossary/');
  await expect(page.getByRole('heading', { level: 1, name: 'Docker glossary' })).toBeVisible();
  await expect(page.locator('#container dt')).toHaveText('container');
  await page.getByLabel('Filter words').fill('locker');
  await expect(page.locator('[data-g-item]:visible')).toHaveCount(1);

  await page.goto('/ms/kubernetes/glossary/');
  await expect(page.locator('#cluster dt')).toContainText('cluster (kluster)');

  await page.goto('/en/cicd/commands/');
  await expect(page.getByRole('heading', { level: 1, name: 'CI/CD commands' })).toBeVisible();
  await page.goto('/en/kubernetes/cheatsheet/');
  await expect(page.getByRole('heading', { level: 1, name: 'Kubernetes cheat sheet' })).toBeVisible();

  await page.goto('/en/glossary/');
  await expect(page.getByRole('heading', { level: 1, name: 'Glossary' })).toBeVisible();
  await expect(page.locator('#commit')).toBeVisible();
});

test('ship-it rescue: one section per part, calm "coming soon", a link to the Git one', async ({ page }) => {
  await page.goto('/ms/ship-it/rescue/');
  await expect(page.getByRole('heading', { level: 1, name: 'Pusat Bantuan Ship It' })).toBeVisible();
  const soon = page.locator('[data-rescue-soon], [data-rescue-group]');
  await expect(soon).toHaveCount(3);
  // Parts with flows come first (one filter box), then the parts still "coming soon".
  await expect(soon.filter({ hasText: 'Bahagian 1 · Dapur' })).toHaveCount(1);
  await expect(soon.filter({ hasText: 'Bahagian 2 · Kilang' })).toHaveCount(1);
  await page.getByRole('link', { name: 'Buka Pusat Bantuan Git' }).click();
  await expect(page).toHaveURL(/\/ms\/rescue\/$/);
});

test('top bar: the course switcher, and tools that follow the course', async ({ page }) => {
  await page.goto('/en/docker/');
  const nav = page.getByRole('navigation', { name: 'Main menu' });
  const courseMenu = nav.locator('[data-course-menu] summary');
  await expect(courseMenu).toContainText('Docker');
  await courseMenu.click();
  await expect(nav.getByRole('link', { name: 'Part 3 · Kubernetes' })).toBeVisible();
  await expect(nav.locator('[data-course-menu] a[aria-current="page"]')).toHaveText(/Docker/);
  await page.keyboard.press('Escape');
  await expect(nav.getByRole('link', { name: 'Part 3 · Kubernetes' })).toBeHidden();
  await nav.locator('details.tools summary').click();
  await expect(nav.getByRole('link', { name: 'Glossary' })).toHaveAttribute('href', '/en/docker/glossary/');
  await expect(nav.getByRole('link', { name: 'Rescue Center' })).toHaveAttribute('href', '/en/ship-it/rescue/');
  await expect(nav.getByRole('link', { name: 'World map' })).toHaveAttribute('href', '/en/docker/');

  // Pages without a course follow the learner's course.
  await seed(page, { v: 2, resume: { lessonId: 'docker-d1-l07', cardId: 'hook', cardIndex: 0, path: '/en/docker/first-containers/port-mapping/' } });
  await page.goto('/en/settings/');
  await expect(nav.getByRole('link', { name: 'World map' })).toHaveAttribute('href', '/en/docker/');
  await expect(nav.locator('[data-tool-link="glossary"]')).toHaveAttribute('href', '/en/docker/glossary/');

  // The Git course keeps its short tool URLs.
  await page.goto('/en/git/');
  await expect(nav.locator('[data-tool-link="glossary"]')).toHaveAttribute('href', '/en/glossary/');
  await expect(nav.locator('[data-tool-link="rescue"]')).toHaveAttribute('href', '/en/rescue/');
});
