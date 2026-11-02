// World 8 (Shields): step through lessons and finish every interactive, EN and BM.
// Runs on both projects (360 px phone and desktop).
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';

for (const path of ['/en/git/shields/never-commit-secrets/#c=try-sim', '/ms/git/shields/leaked-key/#c=try-order', '/en/git/shields/boss/#c=try-drill']) {
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

async function type(card: Locator, ...commands: string[]) {
  const input = card.locator('.term-input');
  await expect(card.locator('.xterm')).toBeVisible();
  for (const c of commands) {
    await input.fill(c);
    await input.press('Enter');
  }
}

async function swipe(card: Locator, goods: boolean[]) {
  for (const g of goods) await card.locator(g ? '.swipe-good' : '.swipe-bad').click();
}

async function build(card: Locator, pieces: string[]) {
  for (const p of pieces) await card.locator('.builder-piece', { hasText: exact(p) }).click();
}

test('8.1 2FA and passkeys (EN)', async ({ page }) => {
  await page.goto('/en/git/shields/two-factor-passkeys/');
  await goTo(page, 'hook');
  await active(page).locator('.choice-btn', { hasText: 'A second check' }).click();
  await done(page);
  await goTo(page, 'see-2fa');
  for (const dot of await active(page).locator('.timeline-dot').all()) await dot.click();
  await goTo(page, 'try-sort');
  await sort(active(page), [
    ['Your password', 'Something you know'],
    ['authenticator app', 'Something you have'],
    ['security key', 'Something you have'],
    ['A PIN', 'Something you know'],
    ['text message', 'Something you have'],
  ]);
  await done(page);
  await noSideScroll(page);
  await goTo(page, 'predict');
  await active(page).locator('.choice-btn', { hasText: 'wrong website' }).click();
  await expect(active(page).locator('.feedback-right')).toBeVisible();
  await goTo(page, 'check-habits');
  await swipe(active(page), [true, true, false, false]);
  await done(page);
  await goTo(page, 'try-mission');
  for (const box of await active(page).locator('.mission-check input').all()) await box.check();
  await done(page);
  await goTo(page, 'win');
});

test('8.2 never commit secrets (EN): hide .env in the simulator', async ({ page }) => {
  await page.goto('/en/git/shields/never-commit-secrets/');
  await goTo(page, 'see-ignore');
  await expect(active(page).locator('.replay')).toContainText('M .gitignore');
  await goTo(page, 'try-sort');
  await sort(active(page), [
    ['An API key', 'Secret: keep out'],
    ['database password', 'Secret: keep out'],
    ['private SSH key', 'Secret: keep out'],
    ['index.html', 'Safe to commit'],
    ['.gitignore', 'Safe to commit'],
    ['.env.example', 'Safe to commit'],
  ]);
  await done(page);
  await goTo(page, 'try-sim');
  // The kind path: grab .env by mistake, then fix it.
  await type(active(page), 'git add .', 'git restore --staged .env', 'echo ".env" >> .gitignore', 'git add .');
  await done(page);
  await noSideScroll(page);
  await goTo(page, 'predict');
  await active(page).locator('.choice-btn', { hasText: 'Git stops' }).click();
  await expect(active(page).locator('.feedback-right')).toBeVisible();
  await goTo(page, 'check-code');
  await swipe(active(page), [true, false, true, false]);
  await done(page);
});

test('8.4 leaked key (EN): time machine, rescue order, filter-repo builder', async ({ page }) => {
  await page.goto('/en/git/shields/leaked-key/');
  await goTo(page, 'hook');
  await expect(active(page).locator('.replay')).toContainText('.env');
  await goTo(page, 'try-history');
  const slider = active(page).locator('.tm-slider');
  await slider.focus();
  await page.keyboard.press('Home');
  await expect(active(page).locator('.tm-commit')).toContainText('Add README');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(active(page).locator('.tm-file')).toContainText('fake_demo_key_123');
  await page.keyboard.press('End');
  await done(page);
  await goTo(page, 'try-order');
  await order(active(page), [
    'Rotate the key: cancel it, make a new one',
    'Untrack .env and add it to .gitignore',
    'Rewrite history with git filter-repo',
    'Force-push and tell your team',
    'Check the secret scanning alert, then close it',
  ]);
  await done(page);
  await goTo(page, 'try-command');
  await build(active(page), ['git', 'filter-repo', '--sensitive-data-removal', '--invert-paths', '--path .env']);
  await done(page);
  await noSideScroll(page);
  await goTo(page, 'predict');
  await active(page).locator('.choice-btn', { hasText: 'No. Copies' }).click();
  await goTo(page, 'check-swipe');
  await swipe(active(page), [true, false, true, false]);
  await done(page);
});

test('8.8 signed commits (BM): build and set the signing config', async ({ page }) => {
  await page.goto('/ms/git/shields/signed-commits/');
  await goTo(page, 'hook');
  await expect(active(page).locator('.replay')).toContainText('Author: Siti');
  await goTo(page, 'try-build');
  await build(active(page), ['git', 'config', '--global', 'gpg.format', 'ssh']);
  await done(page);
  await goTo(page, 'try-sim');
  await type(active(page), 'git config --global gpg.format ssh', 'git config --global user.signingkey ~/.ssh/id_ed25519.pub', 'git config --global commit.gpgsign true');
  await done(page);
  await noSideScroll(page);
  await goTo(page, 'check-sort');
  await sort(active(page), [
    ['signing key anda ada di GitHub', 'Verified'],
    ['kunci tiada di GitHub', 'Unverified'],
    ['Langsung tak bertandatangan', 'Tiada lencana'],
    ['editor web GitHub', 'Verified'],
  ]);
  await done(page);
});

test('boss: leak drill (EN), three rooms then the pushed plan', async ({ page }) => {
  await page.goto('/en/git/shields/boss/');
  await goTo(page, 'try-drill');
  const card = active(page);
  await type(card, 'git rm --cached .env');
  await expect(card.locator('.challenge-next')).toBeVisible();
  await card.locator('.challenge-next').click();
  await type(card, 'echo ".env" >> .gitignore', 'git add .gitignore');
  await card.locator('.challenge-next').click();
  // A new commit is the wrong fix: the key would stay in the old commit.
  await type(card, 'git commit -m "Remove .env"');
  await expect(card).not.toHaveAttribute('data-done', 'true');
  await expect(card.locator('.sim-explain')).not.toBeEmpty();
  await card.locator('.sim-toolbar button').click(); // Start again: the room resets
  await type(card, 'git commit --amend --no-edit');
  await done(page);
  await noSideScroll(page);
  await goTo(page, 'check-first');
  await active(page).getByRole('button', { name: 'Rotate the key', exact: true }).click();
  await expect(active(page).locator('.feedback-right')).toBeVisible();
  await goTo(page, 'check-order');
  await order(active(page), ['Rotate the key', 'Untrack .env and add it to .gitignore', 'Rewrite history with git filter-repo', 'Force-push and tell your team', 'Close the secret scanning alert']);
  await done(page);
  await goTo(page, 'win');
});
