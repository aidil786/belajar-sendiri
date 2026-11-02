// Level Up platform (docs/LEVEL-UP-PLAN.md §1): the overview in EN and MS, the shared Rescue Center with
// flows for every part, each course map with its lessons and Kancil's outfit, per-course tool pages,
// the course switcher, the home catalog card, the new exams on the certification map, axe in both themes
// and no sideways scroll at 360 px.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const COURSES = [
  { id: 'linux', title: 'Linux & Networking', ms: 'Linux & Rangkaian', hat: 'toolbelt', codes: ['L1', 'L2', 'L3', 'L4'], mission: 'M7' },
  { id: 'iac', title: 'Terraform & OpenTofu', ms: 'Terraform & OpenTofu', hat: 'pencil', codes: ['T1', 'T2', 'T3', 'T4'], mission: 'M8' },
  { id: 'observability', title: 'Monitoring & Observability', ms: 'Pemantauan & Observability', hat: 'headset', codes: ['O1', 'O2', 'O3', 'O4'], mission: 'M9' },
  { id: 'aws', title: 'Cloud with AWS', ms: 'Cloud dengan AWS', hat: 'lanyard', codes: ['A1', 'A2', 'A3', 'A4'], mission: 'M10' },
] as const;

async function seed(page: Page, data: Record<string, unknown>) {
  await page.addInitScript((d) => localStorage.setItem('fahamlah:v1', JSON.stringify(d)), data);
}

async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

test('overview: four parts in their colours, world codes, missions M7–M10, tips, Rescue Center', async ({ page }) => {
  await page.goto('/en/level-up/');
  await expect(page.getByRole('heading', { level: 1, name: 'Level Up' })).toBeVisible();
  await expect(page.locator('[data-part]')).toHaveCount(4);
  for (const [i, c] of COURSES.entries()) {
    const part = page.locator(`[data-part="${c.id}"]`);
    await expect(part.getByRole('heading', { level: 2, name: c.title })).toBeVisible();
    await expect(part.locator('.part-num')).toHaveText(`Part ${i + 1}`);
    await expect(part.locator('.tile-code')).toHaveText([...c.codes]);
    // Every world is written: no tile says "Coming soon".
    await expect(part.locator('.tile', { hasText: 'Coming soon' })).toHaveCount(0);
    await expect(part.locator(`[data-mascot][data-hat="${c.hat}"]`)).toHaveCount(1);
  }
  // Each part wears its own accent (--course-<id>).
  await expect(page.locator('[data-part="linux"]')).toHaveCSS('border-top-color', 'rgb(77, 124, 15)');
  await expect(page.locator('[data-part="aws"] .part-num')).toHaveCSS('background-color', 'rgb(161, 98, 7)');
  await expect(page.locator('.tile-mission')).toHaveText(COURSES.map((c) => new RegExp(`^${c.mission}`)));
  const missions = page.locator('[data-missions] .mission-list li');
  await expect(missions).toHaveCount(4);
  await expect(missions.first()).toContainText('A server from scratch');
  await expect(page.locator('[data-missions]')).toContainText('(M7–M10)');
  // Gentle "best after" tips, with world codes; never a lock.
  const before = page.locator('.ship-before');
  await expect(before).toContainText('best after Git & GitHub, World 4. Not a lock.');
  await expect(before).toContainText('best after CI/CD, World C1.');
  await expect(before).toContainText('best after Kubernetes, World K5.');
  await expect(before).toContainText('best after Linux & Networking, World L3.');
  await expect(before).toContainText('best after Docker, World D4.');
  // No finish line in Level Up; the Rescue Center is open (Observability has flows, so no "Coming soon").
  await expect(page.getByText('Finish line')).toHaveCount(0);
  await expect(page.locator('[data-rescue-link]')).toBeVisible();
  await expect(page.locator('[data-rescue-link]')).not.toContainText('Coming soon');
  // A tile opens that world on its part's map.
  await page.locator('[data-part="observability"] .tile', { hasText: 'Counters' }).click();
  await expect(page).toHaveURL(/\/en\/observability\/#world-2$/);
  await expect(page.locator('#world-2 details.island-lessons')).toHaveAttribute('open', '');
  await page.goBack();
  await page.getByRole('link', { name: 'Level Up Rescue Center' }).click();
  await expect(page).toHaveURL(/\/en\/level-up\/rescue\/$/);
});

test('overview in Malay, and the certification map link', async ({ page }) => {
  await page.goto('/ms/level-up/');
  await expect(page.getByRole('heading', { level: 1, name: 'Naik Tahap' })).toBeVisible();
  await expect(page.locator('[data-part="linux"] .part-num')).toHaveText('Bahagian 1');
  await expect(page.locator('[data-part="linux"] .part-label')).toContainText('Rumah Kedai');
  await expect(page.locator('[data-part="aws"] .part-label')).toContainText('Pusat Beli-belah');
  await expect(page.locator('[data-part="iac"] .tile-code').first()).toHaveText('T1');
  await expect(page.locator('.ship-before')).toContainText('Dunia C1');
  await expect(page.locator('[data-mascot][data-hat="headset"]')).toHaveAttribute('aria-label', 'Sang Kancil memakai headset');
  await expect(page.locator('[data-mascot][data-hat="lanyard"]')).toHaveAttribute('aria-label', 'Sang Kancil memakai tali pas pekerja');
  await page.getByRole('link', { name: 'Buka peta pensijilan' }).click();
  await expect(page).toHaveURL(/\/ms\/ship-it\/certifications\/$/);
  await expect(page.locator('[data-cert-group="level-up"]')).toContainText('Naik Tahap');
});

test('rescue: every part has flows; a flow opens by link; Git help is one link away', async ({ page }) => {
  await page.goto('/en/level-up/rescue/#aws-access-denied');
  await expect(page.getByRole('heading', { level: 1, name: 'Level Up Rescue Center' })).toBeVisible();
  await expect(page.locator('.rescue-all-soon')).toHaveCount(0);
  await expect(page.locator('[data-rescue-soon]')).toHaveCount(0);
  for (const c of COURSES) {
    expect(await page.locator(`[data-rescue-group="${c.id}"] [data-rescue-flow]`).count(), c.id).toBeGreaterThanOrEqual(3);
  }
  await expect(page.locator('[data-rescue-step]')).toBeVisible();
  await page.goto('/ms/level-up/rescue/');
  await expect(page.getByRole('heading', { level: 1, name: 'Pusat Bantuan Naik Tahap' })).toBeVisible();
  await expect(page.locator('.crumb a')).toHaveAttribute('href', '/ms/level-up/');
  await page.getByRole('link', { name: 'Buka Pusat Bantuan Git' }).click();
  await expect(page).toHaveURL(/\/ms\/rescue\/$/);
});

for (const c of COURSES) {
  test(`${c.id} map: four worlds, Kancil's outfit, every lesson ready to open`, async ({ page }) => {
    await page.goto(`/en/${c.id}/`);
    await expect(page.getByRole('heading', { level: 1, name: `${c.title} map` })).toBeVisible();
    await expect(page.locator('.map-part')).toContainText('Level Up ·');
    await expect(page.locator('.map-part a')).toHaveAttribute('href', '/en/level-up/');
    await expect(page.locator('[data-island]')).toHaveCount(4);
    await expect(page.locator('.island-num')).toHaveText(c.codes.map((code) => `World ${code}`));
    await expect(page.locator(`[data-mascot][data-hat="${c.hat}"]`)).toHaveAttribute('aria-label', /^Kancil the mouse deer/);
    // Every lesson, boss and mission is written: nothing says "coming soon".
    await expect(page.locator('.lesson-soon')).toHaveCount(0);
    await expect(page.getByText('Lessons are on the way.')).toHaveCount(0);
    expect(await page.locator('#world-1 .island-lessons a').count()).toBeGreaterThanOrEqual(6);
    await expect(page.locator('#world-4 .mission-tag')).toContainText(c.mission);
    // The first world's first lesson opens.
    const href = await page.locator('#world-1 .island-lessons a').first().getAttribute('href');
    expect(href).toMatch(new RegExp(`^/en/${c.id}/[a-z0-9-]+/[a-z0-9-]+/$`));
    await page.goto(href!);
    await expect(page.locator('[data-player-root]')).toBeVisible();
  });
}

test('Malay map and per-course tool pages (glossary, commands, cheat sheet)', async ({ page }) => {
  await page.goto('/ms/aws/');
  await expect(page.getByRole('heading', { level: 1, name: 'Peta Cloud dengan AWS' })).toBeVisible();
  await expect(page.locator('#world-1 .island-num')).toHaveText('Dunia A1');
  await expect(page.locator('.map-part')).toContainText('Naik Tahap · Bahagian 4 · Pusat Beli-belah');

  await page.goto('/en/linux/glossary/');
  await expect(page.getByRole('heading', { level: 1, name: 'Linux & Networking glossary' })).toBeVisible();
  await expect(page.getByText('Words arrive with the lessons.')).toHaveCount(0);
  expect(await page.locator('[data-g-item]').count()).toBeGreaterThanOrEqual(40);
  await expect(page.getByLabel('Filter words')).toBeVisible();
  await page.goto('/en/iac/commands/');
  await expect(page.getByRole('heading', { level: 1, name: 'Terraform & OpenTofu commands' })).toBeVisible();
  await expect(page.getByText('Command pages arrive with the lessons.')).toHaveCount(0);
  await expect(page.getByRole('link', { name: /tofu init/ }).first()).toBeVisible();
  await page.goto('/ms/observability/cheatsheet/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Pemantauan & Observability');
});

test('top bar: the course switcher lists Level Up and its parts; tools follow the course', async ({ page }) => {
  await page.goto('/en/linux/');
  const nav = page.getByRole('navigation', { name: 'Main menu' });
  const courseMenu = nav.locator('[data-course-menu] summary');
  await expect(courseMenu).toContainText('Linux & Networking');
  await courseMenu.click();
  await expect(nav.getByRole('link', { name: 'Level Up', exact: true })).toHaveAttribute('href', '/en/level-up/');
  await expect(nav.getByRole('link', { name: 'Ship It', exact: true })).toBeVisible();
  for (const [i, c] of COURSES.entries()) await expect(nav.getByRole('link', { name: `Part ${i + 1} · ${c.title}` })).toHaveAttribute('href', `/en/${c.id}/`);
  await expect(nav.locator('[data-course-menu] a[aria-current="page"]')).toHaveText(/Linux & Networking/);
  await page.keyboard.press('Escape');
  await nav.locator('details.tools summary').click();
  await expect(nav.getByRole('link', { name: 'Glossary' })).toHaveAttribute('href', '/en/linux/glossary/');
  await expect(nav.getByRole('link', { name: 'Rescue Center' })).toHaveAttribute('href', '/en/level-up/rescue/');
  await expect(nav.getByRole('link', { name: 'World map' })).toHaveAttribute('href', '/en/linux/');

  // The family overview is its own map; the switcher names the family.
  await page.goto('/ms/level-up/');
  await expect(page.locator('[data-course-menu] summary')).toContainText('Naik Tahap');
  await expect(page.locator('[data-tool-link="map"]')).toHaveAttribute('href', '/ms/level-up/');
  await expect(page.locator('[data-tool-link="map"]')).toHaveAttribute('aria-current', 'page');
});

test('home: a Level Up card with its four parts, a first-step tip and the overview link', async ({ page }) => {
  await page.goto('/en/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Linux and the cloud');
  const card = page.locator('.catalog [data-course-card="level-up"]');
  await expect(card.getByRole('heading', { level: 3, name: 'Level Up' })).toBeVisible();
  await expect(card.locator('.part-row')).toHaveCount(4);
  await expect(card).toContainText('New here? Linux needs no other course first.');
  await expect(card).toContainText('Part 4 · Pusat Beli-belah: Tip: best after Linux & Networking, World L3.');
  for (const c of COURSES) {
    const row = card.locator(`.part-row[data-course-card="${c.id}"]`);
    await expect(row.getByRole('link', { name: c.title, exact: true })).toHaveAttribute('href', `/en/${c.id}/`);
    await expect(row).not.toContainText('Coming soon');
    await expect(row.locator(`[data-mascot][data-hat="${c.hat}"]`)).toHaveCount(1);
  }
  await card.getByRole('link', { name: /See the map/ }).click();
  await expect(page).toHaveURL(/\/en\/level-up\/$/);
  // Ship It's card is still there, before Level Up.
  await page.goto('/en/');
  await expect(page.locator('.catalog [data-course-card]').filter({ has: page.locator('h3') })).toHaveText([/Git & GitHub/, /Ship It/, /Level Up/]);
});

test('certification map: the Level Up exams, prices, the OpenTofu note and CKA → K9', async ({ page }) => {
  await page.goto('/en/ship-it/certifications/');
  const group = page.locator('[data-cert-group="level-up"]');
  await expect(group.getByRole('heading', { level: 2, name: 'Level Up' })).toBeVisible();
  await expect(group.locator('[data-cert]')).toHaveCount(5);
  await expect(page.locator('[data-cert="lfcs"]')).toContainText('USD 445');
  await expect(page.locator('[data-cert="pca"]')).toContainText('USD 250');
  await expect(page.locator('[data-cert="terraform-associate"]')).toContainText('USD 70.50');
  await expect(page.locator('[data-cert="terraform-associate"]')).toContainText('OpenTofu has no official exam.');
  await expect(page.locator('[data-cert="aws-clf"]')).toContainText('USD 100');
  await expect(page.locator('[data-cert="aws-saa"]')).toContainText('USD 150');
  await expect(page.getByText('Prices change. Check the official page, and look for a discount first.')).toBeVisible();
  // The lessons are written: no "on the way" line.
  await expect(page.locator('[data-cert="lfcs"]')).not.toContainText('The lessons for this one are on the way.');
  await expect(page.locator('[data-cert="lfcs"] .cert-worlds a').first()).toHaveAttribute('href', '/en/linux/#world-1');
  await page.locator('[data-cert="cka"]').getByRole('link', { name: /^K9/ }).click();
  await expect(page).toHaveURL(/\/en\/kubernetes\/#world-9$/);
  await expect(page.locator('#world-9 [data-extra-pack]')).toContainText('Extra pack');
});

const AXE_PAGES = ['/en/level-up/', '/ms/level-up/', '/en/level-up/rescue/', '/ms/level-up/rescue/', '/en/linux/', '/ms/iac/', '/en/observability/', '/ms/aws/', '/en/aws/glossary/', '/en/kubernetes/', '/ms/'];
for (const theme of ['light', 'dark'] as const) {
  for (const path of AXE_PAGES) {
    test(`axe ${theme}: ${path}`, async ({ page }) => {
      await seed(page, { v: 2, settings: { theme } });
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await axe(page);
    });
  }
}

test('no horizontal scroll at 360 px', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  for (const path of ['/en/level-up/', '/ms/level-up/', '/en/level-up/rescue/', '/ms/linux/', '/en/iac/', '/ms/observability/', '/en/aws/', '/en/', '/ms/kubernetes/', '/en/ship-it/certifications/']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, path).toBeLessThanOrEqual(0);
  }
});

test('the course switcher fits a phone screen and scrolls if it must', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto('/en/aws/');
  await page.locator('[data-course-menu] summary').click();
  const list = page.locator('[data-course-menu] .menu-list');
  await expect(list).toBeVisible();
  const box = (await list.boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(640);
  await list.getByRole('link', { name: 'All courses' }).scrollIntoViewIfNeeded();
  await expect(list.getByRole('link', { name: 'All courses' })).toBeInViewport();
});
