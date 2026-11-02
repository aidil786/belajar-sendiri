// World 11 (Rescue Center): practise the fixes in the simulator, EN and BM, and the
// Rescue Center page with one flow per World 11 lesson. Runs on both projects (360 px phone and desktop).
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';

for (const path of ['/en/git/rescue-center/merge-panic/#c=try-abort', '/ms/git/rescue-center/permission-denied-publickey/#c=try-https', '/en/git/rescue-center/protected-branch/#c=try-merge']) {
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
const done = (page: Page) => expect(active(page)).toHaveAttribute('data-done', 'true');
const exact = (text: string) => new RegExp(`^\\s*${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`);

async function noSideScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

async function type(card: Locator, ...commands: string[]) {
  const input = card.locator('.term-input');
  await expect(card.locator('.xterm')).toBeVisible();
  for (const c of commands) {
    await input.fill(c);
    await input.press('Enter');
  }
}

async function sort(card: Locator, items: [string, string][]) {
  for (const [label, bucket] of items) {
    await card.locator('.sort-card', { hasText: label }).click();
    await card.locator('.sort-bucket-head', { hasText: exact(bucket) }).click();
  }
}

test('11.1 wrong branch (BM): move the commit to its own branch', async ({ page }) => {
  await page.goto('/ms/git/rescue-center/wrong-branch/');
  await goTo(page, 'decide');
  await active(page).locator('.choice-btn', { hasText: 'Pindahkan commit' }).click();
  await expect(active(page).locator('.feedback-right')).toBeVisible();
  await goTo(page, 'try-move');
  await type(active(page), 'git branch about', 'git reset --hard HEAD~1', 'git switch about');
  await done(page);
  await noSideScroll(page);
  await goTo(page, 'check-pushed');
  await sort(active(page), [
    ['Hanya dalam laptop', 'Pindahkan (branch + reset)'],
    ['Dah ada di GitHub', 'Batalkan (revert)'],
    ['Kawan sepasukan dah pull', 'Batalkan (revert)'],
    ['Baru buat, belum push', 'Pindahkan (branch + reset)'],
  ]);
  await done(page);
});

test('11.6 merge panic (EN): find the exit, then abort the merge', async ({ page }) => {
  await page.goto('/en/git/rescue-center/merge-panic/');
  await goTo(page, 'spot-exit');
  await active(page).locator('.spot-lines button', { hasText: 'git merge --abort' }).click();
  await done(page);
  await goTo(page, 'try-abort');
  await expect(active(page).locator('.xterm')).toContainText('CONFLICT');
  await type(active(page), 'git merge --abort');
  await done(page);
  await noSideScroll(page);
});

test('11.11 messy pull (EN): back out of a stopped rebase', async ({ page }) => {
  await page.goto('/en/git/rescue-center/messy-pull/#c=try-abort');
  await expect(active(page)).toHaveAttribute('data-card-id', 'try-abort');
  await expect(active(page).locator('astro-island[ssr]')).toHaveCount(0);
  await type(active(page), 'git status', 'git rebase --abort');
  await done(page);
});

test('11.14 publickey (EN): the SSH push is denied, HTTPS works', async ({ page }) => {
  await page.goto('/en/git/rescue-center/permission-denied-publickey/');
  await goTo(page, 'hook');
  await expect(active(page).locator('.replay')).toContainText('Permission denied (publickey)');
  await goTo(page, 'try-https');
  const card = active(page);
  await type(card, 'git push');
  await expect(card.locator('.sim-explain')).toContainText('no SSH key');
  await expect(card).not.toHaveAttribute('data-done', 'true');
  await type(card, 'git remote set-url origin https://github.com/you/diary.git', 'git push');
  await done(page);
  await noSideScroll(page);
});

test('11.15 protected branch (EN): push a branch, then merge the approved PR', async ({ page }) => {
  await page.goto('/en/git/rescue-center/protected-branch/');
  await goTo(page, 'try-push');
  await type(active(page), 'git switch -c fix-title', 'git push -u origin fix-title');
  await done(page);
  await goTo(page, 'try-merge');
  await active(page).getByRole('button', { name: 'Merge pull request' }).click();
  await done(page);
  await noSideScroll(page);
});

test('rescue page: one flow per World 11 lesson, each linking to its lesson', async ({ page }) => {
  await page.goto('/en/rescue/');
  await expect(page.locator('[data-rescue-flow]')).toHaveCount(15);
  for (const group of ['Commits and messages', 'Branches and HEAD', 'Push, pull and GitHub', 'Secrets and big files', 'Setup and sign-in']) {
    await expect(page.getByRole('heading', { name: group })).toBeVisible();
  }
  await page.locator('[data-rescue-flow="publickey"]').click();
  await page.getByRole('button', { name: 'No, switch to HTTPS' }).click();
  const result = page.locator('.rescue-result');
  await expect(result).toContainText('git remote set-url origin');
  await expect(result.getByRole('link', { name: 'Permission denied (publickey)' })).toHaveAttribute('href', '/en/git/rescue-center/permission-denied-publickey/');
  await expect(page.getByRole('link', { name: 'Open World 11: Rescue Center' })).toHaveAttribute('href', '/en/git/#world-11');
  await noSideScroll(page);
});

test('rescue page (BM): a link opens the merge panic flow', async ({ page }) => {
  await page.goto('/ms/rescue/#merge-panic');
  await page.getByRole('button', { name: 'Ya, ia berhenti dengan konflik' }).click();
  await expect(page.locator('.rescue-result')).toContainText('git merge --abort');
  await expect(page.locator('.rescue-result').getByRole('link', { name: 'Panik merge' })).toBeVisible();
});
