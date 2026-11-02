// Ship It polish: the certification map, night shift drills and exam mode.
// Both pages in EN and MS, axe clean, no sideways scroll at 360 px, this week's drill,
// a drill that is fixed and remembered after reload, and the exam timer + docs-only card.
// Drill levels: the list grouped by level, folded hints (level 2), and incidents (level 3):
// an alert first, no hints, two faults, then a root-cause question before the fixed note.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { NIGHT_SHIFT_KEY, weeklyPick } from '../../src/lib/nightShift';
import { drills } from '../../src/content/courses/nightshift';

const PAGES = [
  '/en/ship-it/certifications/',
  '/ms/ship-it/certifications/',
  '/en/ship-it/night-shift/',
  '/ms/ship-it/night-shift/',
  '/en/ship-it/night-shift/busy-hatch/',
  '/ms/ship-it/night-shift/crash-loop/',
  '/en/ship-it/night-shift/kitchen-blackout/',
  '/ms/ship-it/night-shift/lunch-rush-outage/',
];

async function seed(page: Page, data: Record<string, unknown>) {
  await page.addInitScript((d) => localStorage.setItem('fahamlah:v1', JSON.stringify(d)), data);
}

async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

async function type(page: Page, command: string) {
  const input = page.locator('.ns-sim .term-input');
  await input.click();
  await input.fill(command);
  await page.keyboard.press('Enter');
}

for (const theme of ['light', 'dark'] as const) {
  for (const path of PAGES) {
    test(`axe ${theme}: ${path}`, async ({ page }) => {
      await seed(page, { v: 2, settings: { theme, examMode: path.includes('crash-loop') } });
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      if (path.includes('/night-shift/') && !path.endsWith('night-shift/')) await expect(page.locator('.ns-sim .term-input')).toBeVisible();
      await axe(page);
    });
  }
}

test('no horizontal scroll at 360 px', async ({ page }) => {
  await seed(page, { v: 2, settings: { examMode: true } });
  await page.setViewportSize({ width: 360, height: 780 });
  // Plus the drills with the longest alert lines (quota, RBAC, the GHCR push error).
  for (const path of [
    ...PAGES,
    '/en/ship-it/night-shift/ghcr-denied/',
    '/ms/ship-it/night-shift/wrong-hatch/',
    '/en/ship-it/night-shift/lunch-release-quota/',
    '/ms/ship-it/night-shift/deploy-bot-forbidden/',
    '/en/ship-it/night-shift/ghcr-no-login/',
  ]) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, path).toBeLessThanOrEqual(0);
  }
});

test('the Ship It overview links both pages', async ({ page }) => {
  await page.goto('/en/ship-it/');
  await page.getByRole('link', { name: 'Open the night shift' }).click();
  await expect(page).toHaveURL(/\/en\/ship-it\/night-shift\/$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Night shift' })).toBeVisible();
  await page.goto('/ms/ship-it/');
  await page.getByRole('link', { name: 'Buka peta pensijilan' }).click();
  await expect(page).toHaveURL(/\/ms\/ship-it\/certifications\/$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Peta pensijilan' })).toBeVisible();
});

test('certification map: ten exams, world links, prices note and progress from the store', async ({ page }) => {
  await seed(page, { v: 2, completed: ['docker-d6-l01', 'docker-d6-l02'] });
  await page.goto('/en/ship-it/certifications/');
  await expect(page.locator('[data-cert]')).toHaveCount(10);
  await expect(page.locator('[data-cert-group="ship-it"] .cert-code')).toHaveText(['KCNA', 'CKAD', 'GH-200', 'CKA', 'CKS']);
  await expect(page.locator('[data-cert-group="level-up"] .cert-code')).toHaveText(['LFCS', 'PCA', 'Terraform', 'CLF-C02', 'SAA-C03']);
  await expect(page.getByText('Prices change. Check the official page, and look for a discount first.')).toBeVisible();
  await expect(page.getByText('Belajar Sendiri is not linked to these exams')).toBeVisible();
  const kcna = page.locator('[data-cert="kcna"]');
  await expect(kcna).toContainText('USD 250');
  await expect(kcna.locator('[data-cert-text]')).toHaveText(/^2 of \d+ lessons done$/);
  await expect(kcna.locator('progress')).toHaveAttribute('value', '2');
  await expect(page.locator('[data-cert="gh-200"]')).toContainText('Varies by country');
  await expect(page.locator('[data-cert="gh-200"] .cert-worlds a').first()).toHaveAttribute('href', '/en/git/#world-7');
  await kcna.getByRole('link', { name: /^D6/ }).click();
  await expect(page).toHaveURL(/\/en\/docker\/#world-6$/);

  await page.goto('/ms/ship-it/certifications/');
  await expect(page.locator('[data-cert="ckad"]')).toContainText('Ambil bila');
  await expect(page.locator('[data-cert="kcna"] [data-cert-text]')).toHaveText(/^2 daripada \d+ pelajaran siap$/);
});

test("night shift: this week's drill is picked by ISO week; every drill is listed", async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-31T10:00:00'));
  await page.goto('/en/ship-it/night-shift/');
  const want = drills[weeklyPick(new Date('2026-10-31T10:00:00'), drills.map((d) => d.level))]!;
  const week = page.locator('[data-week-card]:visible');
  await expect(week).toHaveCount(1);
  await expect(week).toHaveAttribute('data-week-card', want.id);
  await expect(page.locator('[data-drill-row]')).toHaveCount(drills.length);
  // Grouped by level (★, ★★, ★★★), each with a short explanation.
  await expect(page.locator('[data-drill-group]')).toHaveCount(new Set(drills.map((d) => d.level)).size);
  await expect(page.locator('[data-drill-group="3"] h3')).toContainText('Level 3: incidents');
  await expect(page.locator('[data-drill-group="3"] .group-text')).toContainText('No hints, but the Rescue Center stays open.');
  for (const d of drills) await expect(page.locator(`[data-drill-group="${d.level}"] [data-drill-row="${d.id}"]`)).toHaveCount(1);
  await expect(page.getByText('Pick any level. Nothing is locked.')).toBeVisible();
  // Nothing locked, no countdown on the list.
  await expect(page.getByText('No countdown and no score.', { exact: false })).toBeVisible();
  await expect(page.locator('[role="timer"]')).toHaveCount(0);
});

test('a drill can be fixed, and it is remembered after reload', async ({ page }) => {
  await page.goto('/en/ship-it/night-shift/busy-hatch/');
  await expect(page.getByRole('heading', { level: 1, name: 'Hatch 8080 is taken' })).toBeVisible();
  // Exam mode is off by default: no timer, help is there (folded).
  await expect(page.locator('[role="timer"]')).toHaveCount(0);
  const help = page.locator('[data-help]');
  await expect(help).toBeVisible();
  await help.locator('summary').click();
  await expect(help.locator('[data-rescue-link]')).toHaveAttribute('href', '/en/ship-it/rescue/#docker-port-allocated');
  await type(page, 'docker run -d --name web -p 8080:80 nginx:1.30-alpine');
  await expect(page.locator('.ns-sim .sim-explain')).not.toBeEmpty();
  await type(page, 'docker rm web');
  await type(page, 'docker stop old-web');
  await expect(page.locator('[data-drill-fixed]')).toHaveCount(0);
  await type(page, 'docker run -d --name web -p 8080:80 nginx:1.30-alpine');
  await expect(page.locator('[data-drill-fixed]')).toContainText('Fixed! We saved it on this device.');
  const saved = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? '{}'), NIGHT_SHIFT_KEY);
  expect(saved.v).toBe(1);
  expect(Object.keys(saved.done)).toEqual(['busy-hatch']);
  // The main progress schema is untouched.
  const main = await page.evaluate(() => localStorage.getItem('fahamlah:v1'));
  expect(main ?? '').not.toContain('busy-hatch');

  await page.reload();
  await expect(page.locator('[data-done-before]')).toContainText('You fixed this one before.');
  await page.goto('/en/ship-it/night-shift/');
  await expect(page.locator('[data-drill-row="busy-hatch"] [data-drill-done-tag]')).toBeVisible();
  await expect(page.locator('[data-drill-row="wrong-hatch"] [data-drill-done-tag]')).toBeHidden();
});

test('exam mode: the settings toggle adds a timer and a docs-only card; leaving brings help back', async ({ page }) => {
  await page.goto('/en/settings/');
  const toggle = page.getByRole('checkbox', { name: 'Exam mode' });
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await expect(page.locator('[data-saved]')).toBeVisible();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('fahamlah:v1') ?? '{}'));
  expect(stored.settings.examMode).toBe(true);

  await page.goto('/en/ship-it/night-shift/wrong-hatch/');
  const card = page.locator('[data-exam-card]');
  await expect(card.getByRole('heading', { name: 'Exam rules' })).toBeVisible();
  for (const site of ['kubernetes.io/docs', 'docs.docker.com', 'docs.github.com']) await expect(card.getByRole('link', { name: site })).toBeVisible();
  const timer = page.getByRole('timer', { name: 'Exam timer' });
  await expect(timer).toBeVisible();
  await expect(timer).toHaveAttribute('aria-live', 'off');
  await expect(timer).toHaveText(/^\d+:\d\d$/);
  await expect(page.locator('[data-help]')).toHaveCount(0);
  // Hints stay hidden in exam mode, even after mistakes.
  for (const c of ['docker rn web', 'curl localhost:9999', 'docker stat']) await type(page, c);
  await expect(page.locator('.ns-sim .feedback-almost')).toHaveCount(0);
  // Typing in the terminal never moves focus to the timer or the card (no key hijack).
  await expect(page.locator('.ns-sim .term-input')).toBeFocused();

  await card.getByRole('button', { name: 'Leave exam mode for this drill' }).click();
  await expect(page.getByText('Exam mode is off for this drill. Hints and help are back.')).toBeFocused();
  await expect(page.locator('[role="timer"]')).toHaveCount(0);
  await expect(page.locator('[data-help]')).toBeVisible();
  // The mistakes made in exam mode still count, so the next hint shows at once (the second one).
  await type(page, 'docker rn web');
  await expect(page.locator('.ns-sim .feedback-almost')).toContainText('Almost! Here\'s the trick: A hatch cannot change.');
});

test('exam mode on a belt: a text box instead of choices; calm mode shows whole minutes', async ({ page }) => {
  await seed(page, { v: 2, settings: { examMode: true, calm: true } });
  await page.goto('/ms/ship-it/night-shift/belt-never-started/');
  await expect(page.getByRole('timer', { name: 'Pemasa peperiksaan' })).toHaveText(/^\d+ min$/);
  await expect(page.locator('.ns-sim textarea')).toBeVisible();
  await expect(page.locator('.ns-sim .cv-fixes')).toHaveCount(0);
});

test('older saves without exam mode read as off', async ({ page }) => {
  await seed(page, { v: 1, settings: { calm: false } });
  await page.goto('/en/ship-it/night-shift/crash-loop/');
  await expect(page.locator('.ns-sim .term-input')).toBeVisible();
  await expect(page.locator('[role="timer"]')).toHaveCount(0);
  await page.goto('/en/settings/');
  await expect(page.getByRole('checkbox', { name: 'Exam mode' })).not.toBeChecked();
});

test('every drill opens its simulator with no console errors @desktop-only', async ({ page }) => {
  // Two pages per drill (35+ drills): give each page load its own few seconds.
  test.setTimeout(Math.max(60_000, drills.length * 2 * 4_000));
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  for (const d of drills) {
    for (const lang of ['en', 'ms']) {
      await page.goto(`/${lang}/ship-it/night-shift/${d.id}/`);
      // Belts: choices on level 1, a text box on levels 2–3 (the choices fold away as a hint).
      await expect(page.locator(d.kind === 'conveyor' ? (d.level === 1 ? '.ns-sim .cv-fixes' : '.ns-sim textarea') : '.ns-sim .term-input')).toBeVisible();
      // Let every lazy chunk finish: WebKit reports an import cut short by the next page.goto as an error.
      await page.waitForLoadState('networkidle');
    }
  }
  expect(errors).toEqual([]);
});

test.describe('no service worker', () => {
  // page.route() can't see requests a service worker answers, and the offline worker may take
  // over the page before the simulator is fetched. Block it so the failed download is real.
  test.use({ serviceWorkers: 'block' });

  test('a simulator that cannot download says so kindly and offers a retry @desktop-only', async ({ page }) => {
    await page.route(/\/_astro\/KitchenSim\.[^/]+\.js$/, (route) => route.abort());
    await page.goto('/en/ship-it/night-shift/wrong-hatch/');
    const box = page.locator('.ns-load-failed');
    await expect(box).toBeVisible();
    await expect(box).toContainText('did not load');
    await expect(box.getByRole('button', { name: 'Try again' })).toBeVisible();
  });
});

test('level 2: hints stay folded; the learner opens them one at a time', async ({ page }) => {
  await page.goto('/en/ship-it/night-shift/no-phone-line/');
  await expect(page.locator('[data-level-badge="2"]')).toContainText('★★');
  await expect(page.locator('[data-drill-alert]')).toContainText("wget: bad address 'menu'");
  for (const c of ['docker network ls', 'docker ps', 'docker inspect api', 'docker stat']) await type(page, c);
  // No hint pops up in the simulator, even after mistakes.
  await expect(page.locator('.ns-sim .feedback-almost')).toHaveCount(0);
  const fold = page.locator('[data-hints-fold]');
  await expect(fold.locator('[data-hint-item]')).toHaveCount(0);
  await fold.locator('summary').click();
  await fold.getByRole('button', { name: 'Show a hint' }).click();
  await expect(fold.locator('[data-hint-item]')).toHaveCount(1);
  await expect(fold.locator('[data-hint-item]').first()).toContainText('See it fail');
  await fold.getByRole('button', { name: 'Show the next hint' }).click();
  await expect(fold.locator('[data-hint-item]')).toHaveCount(2);
});

test('level 2 belt: a text box first; the choices are a folded hint', async ({ page }) => {
  await page.goto('/en/ship-it/night-shift/release-refused/');
  await expect(page.locator('.ns-sim textarea')).toBeVisible();
  await expect(page.locator('.ns-sim .cv-fixes')).toHaveCount(0);
  const fold = page.locator('[data-hints-fold]');
  await fold.locator('summary').click();
  await fold.getByRole('button', { name: 'Show the choices instead of the text box' }).click();
  await expect(page.locator('.ns-sim .cv-fixes')).toBeVisible();
  await expect(fold).toContainText('The choices are in the belt now.');
});

test('level 3 incident: an alert, no hints, two faults, then the root cause before the fixed note', async ({ page }) => {
  await page.goto('/en/ship-it/night-shift/kitchen-blackout/');
  await expect(page.locator('[data-level-badge="3"]')).toContainText('★★★');
  // The real-looking alert comes first, before "What broke".
  await expect(page.locator('.drill-brief > :first-child')).toHaveAttribute('data-drill-alert', '');
  await expect(page.locator('[data-drill-alert]')).toContainText('curl: (56) Recv failure: Connection reset by peer');
  await expect(page.getByText('2 faults at once.')).toBeVisible();
  await expect(page.locator('[data-incident-note]')).toContainText('An incident: no hints.');
  await expect(page.locator('[data-hints-fold]')).toHaveCount(0);
  // The Rescue Center link stays.
  const help = page.locator('[data-help]');
  await help.locator('summary').click();
  await expect(help.locator('[data-rescue-link]')).toHaveAttribute('href', '/en/ship-it/rescue/#docker-localhost-unreachable');
  for (const c of ['docker rn web', 'docker stat', 'curl localhost:9999']) await type(page, c);
  await expect(page.locator('.ns-sim .feedback-almost')).toHaveCount(0);

  // Fix one fault: not done yet.
  for (const c of ['docker rm -f web', 'docker run -d --name web -p 8080:80 nginx:1.30-alpine']) await type(page, c);
  await expect(page.locator('[data-root-cause]')).toHaveCount(0);
  for (const c of ['docker network create kedai-net', 'docker network connect kedai-net web', 'docker network connect kedai-net api']) await type(page, c);

  // The root-cause question comes before the fixed note.
  const root = page.locator('[data-root-cause]');
  await expect(root.getByText('Fixed! One last question before you go.')).toBeVisible();
  await expect(root.getByRole('heading', { name: 'Both faults came at once. What was the root cause?' })).toBeVisible();
  await expect(page.locator('[data-drill-fixed]')).toHaveCount(0);
  await root.getByRole('button', { name: /nginx stopped listening/ }).click();
  await expect(root.locator('.feedback-almost')).toContainText("Almost! Here's the trick: Look at what changed just before it broke.");
  await expect(page.locator('body')).not.toContainText(/\bwrong\b/i);
  await root.getByRole('button', { name: /started by hand, from memory/ }).click();
  await expect(root.locator('.feedback-right')).toContainText('A compose.yaml keeps ports and networks in one file.');
  const fixed = page.locator('[data-drill-fixed]');
  await expect(fixed).toContainText('Fixed! We saved it on this device.');
  await expect(fixed.locator('[data-problems] li')).toHaveCount(2);
  const saved = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? '{}'), NIGHT_SHIFT_KEY);
  expect(Object.keys(saved.done)).toEqual(['kitchen-blackout']);
});

test('level 3 incident on the food court (MS): fix both faults, then the root cause @desktop-only', async ({ page }) => {
  await page.goto('/ms/ship-it/night-shift/lunch-rush-outage/');
  await expect(page.locator('[data-drill-alert]')).toContainText('Connection refused');
  await expect(page.getByText('2 masalah serentak.')).toBeVisible();
  for (const c of ['kubectl rollout undo deployment/shop', `kubectl patch service shop -p '{"spec":{"selector":{"app":"shop"}}}'`]) await type(page, c);
  const root = page.locator('[data-root-cause]');
  for (let i = 0; i < 12 && !(await root.count()); i++) {
    await page.getByRole('button', { name: /^\+30s/ }).click();
    await page.waitForTimeout(150);
  }
  await expect(root).toBeVisible();
  await root.getByRole('button', { name: /tiada siapa semak dulu/ }).click();
  await expect(page.locator('[data-drill-fixed] [data-problems] li')).toHaveCount(2);
});
