// World 5 (Teamwork): step through lessons and finish every interactive, EN and BM.
// The boss is a teammate's PR over four practice-repo cards. Runs on both projects (360 px phone and desktop).
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';

for (const path of ['/en/git/teamwork/code-review/#c=try-suggest', '/ms/git/teamwork/markdown-extras/#c=try-alert', '/en/git/teamwork/boss/#c=try-merge']) {
  test(`axe: ${path}`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.lesson-card.is-active astro-island[ssr]')).toHaveCount(0);
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

async function choose(card: Locator, text: string) {
  await card.locator('.choice-btn', { hasText: text }).click();
  await expect(card.locator('.feedback-right')).toBeVisible();
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

async function swipe(card: Locator, goods: boolean[]) {
  for (const g of goods) await card.locator(g ? '.swipe-good' : '.swipe-bad').click();
}

async function markdown(card: Locator, text: string) {
  await card.locator('.mdplay-input').fill(text);
}

test('5.1 repo tour (EN): open a file, sort the tabs, say hello', async ({ page }) => {
  await page.goto('/en/git/teamwork/repo-tour/');
  await goTo(page, 'hook');
  await choose(active(page), 'The README');
  await goTo(page, 'see-code');
  await expect(active(page).getByText('Practice repo — not a real website')).toBeVisible();
  await active(page).getByRole('button', { name: /CONTRIBUTING\.md/ }).click();
  await expect(active(page).locator('.prepo-box-head')).toContainText('CONTRIBUTING.md');
  await done(page);
  await goTo(page, 'try-sort');
  await sort(active(page), [
    ['broken button', 'Issues'],
    ['new page', 'Issues'],
    ['Offer your code change', 'Pull requests'],
    ["teammate's code", 'Pull requests'],
    ['tests passed', 'Actions'],
    ['get published', 'Actions'],
  ]);
  await done(page);
  await goTo(page, 'try-issue');
  await active(page).getByLabel('Write a comment').fill('Hi! I like building games.');
  await active(page).getByRole('button', { name: 'Comment', exact: true }).click();
  await done(page);
  await expect(active(page).locator('.prepo-comment.is-mine')).toContainText('I like building games');
  await noSideScroll(page);
  await goTo(page, 'see-buttons');
  await choose(active(page), 'Watch');
  await goTo(page, 'check-swipe');
  await swipe(active(page), [true, true, false, false]);
  await done(page);
  await goTo(page, 'win');
});

test('5.2 Markdown basics (BM): headings and a list', async ({ page }) => {
  await page.goto('/ms/git/teamwork/markdown/');
  await goTo(page, 'hook');
  await expect(active(page).locator('.replay')).toContainText('# Laman Kelab');
  await goTo(page, 'see-render');
  await expect(active(page).locator('.md-body .md-h1')).toHaveText('Laman Kelab');
  await goTo(page, 'try-heading');
  await active(page).getByRole('button', { name: 'Semak' }).click();
  await expect(active(page).locator('.feedback-almost')).toContainText('Kelab Kod');
  await markdown(active(page), '# Kelab Kod\n\nKami berjumpa setiap Jumaat.\n\n## Apa kami buat\n\nKami bina laman web.\n');
  await done(page);
  await goTo(page, 'try-list');
  await markdown(active(page), '# Kelab Kod\n\nBarang yang kami perlu:\n\n- Laptop\n- Snek\n');
  await done(page);
  await noSideScroll(page);
  await goTo(page, 'check-sort');
  await sort(active(page), [
    ['## Pasang', 'Tajuk'],
    ['- Laptop', 'Senarai'],
    ['[Bantu]', 'Pautan'],
    ['### Peraturan', 'Tajuk'],
    ['1. Buka fail', 'Senarai'],
    ['[Sekolah]', 'Pautan'],
  ]);
  await done(page);
});

test('5.3 Markdown extras (EN): tick boxes, table header line, warning box', async ({ page }) => {
  await page.goto('/en/git/teamwork/markdown-extras/');
  await goTo(page, 'hook');
  await expect(active(page).locator('.md-alert-warning')).toBeVisible();
  await expect(active(page).locator('.md-body table')).toBeVisible();
  await goTo(page, 'try-tasks');
  await markdown(active(page), '## To do\n\n- [x] Pick a date\n- [ ] Print posters\n');
  await expect(active(page).locator('.md-body input[type="checkbox"]')).toHaveCount(2);
  await done(page);
  await goTo(page, 'try-table');
  await active(page).locator('.spot-line', { hasText: '| --- | --- |' }).click();
  await done(page);
  await goTo(page, 'try-alert');
  // On the same line it is not an alert yet: kind hint, not done.
  await markdown(active(page), '> [!WARNING] Back up your work first.\n');
  await active(page).getByRole('button', { name: 'Check' }).click();
  await expect(active(page).locator('.feedback-almost')).toContainText('> [!WARNING]');
  await markdown(active(page), '> [!WARNING]\n> Back up your work first.\n');
  await expect(active(page).locator('.md-alert-warning')).toContainText('Back up your work first.');
  await done(page);
  await noSideScroll(page);
  await goTo(page, 'predict');
  await choose(active(page), 'Three boxes');
});

test('5.7 pull requests (EN): a draft cannot merge until it is ready', async ({ page }) => {
  await page.goto('/en/git/teamwork/pull-requests/');
  await goTo(page, 'try-pr');
  await expect(active(page).locator('.prepo-blocked')).toBeVisible(); // own PR, needs a teammate's approval
  await active(page).getByLabel('Write a comment').fill('Yes, it works on my phone!');
  await active(page).getByRole('button', { name: 'Comment', exact: true }).click();
  await done(page);
  await goTo(page, 'try-sort');
  await sort(active(page), [
    ['PR description', 'Conversation'],
    ['Red and green', 'Files changed'],
    ['Comments and reviews', 'Conversation'],
    ['one line', 'Files changed'],
    ['merge button', 'Conversation'],
    ['Every changed file', 'Files changed'],
  ]);
  await done(page);
  await goTo(page, 'try-draft');
  const card = active(page);
  await expect(card.locator('.prepo-blocked')).toContainText('still a draft');
  await expect(card.getByRole('button', { name: 'Merge pull request' })).toBeDisabled();
  await card.getByRole('button', { name: 'Ready for review' }).click();
  await card.getByRole('button', { name: 'Merge pull request' }).click();
  await done(page);
  await expect(card.locator('.prepo-sub .prepo-state')).toHaveText(/Merged/);
  await noSideScroll(page);
  await goTo(page, 'check-order');
  await order(active(page), ['Commit on your own branch', 'Push the branch to GitHub', 'Open a pull request', 'Teammates review it', 'Merge it into main']);
  await done(page);
});

test('5.8 code review (BM): suggest a fix, then approve', async ({ page }) => {
  await page.goto('/ms/git/teamwork/code-review/');
  await goTo(page, 'hook');
  await swipe(active(page), [false, true, false, true]);
  await done(page);
  await goTo(page, 'try-suggest');
  const card = active(page);
  await card.locator('button.prepo-dl', { hasText: 'Wellcome' }).click();
  await card.getByRole('button', { name: 'Cadang perubahan' }).click();
  const box = card.getByLabel('Komen pada baris 2');
  await expect(box).toHaveValue('```suggestion\n<h1>Wellcome to Code Club</h1>\n```');
  await box.fill('Salah taip kecil!\n```suggestion\n<h1>Welcome to Code Club</h1>\n```');
  await card.getByRole('button', { name: 'Tambah komen' }).click();
  await expect(card.locator('.prepo-suggestion')).toContainText('<h1>Welcome to Code Club</h1>');
  await done(page);
  await noSideScroll(page);
  await goTo(page, 'try-approve');
  const approve = active(page);
  await expect(approve.locator('.prepo-blocked')).toContainText('minta perubahan');
  await approve.getByRole('radio', { name: 'Luluskan' }).check();
  await approve.getByRole('button', { name: 'Hantar review' }).click();
  await done(page);
  await expect(approve.locator('.prepo-blocked')).toHaveCount(0);
});

test('5.9 link PRs to issues (EN): Closes #16 closes the issue on merge', async ({ page }) => {
  await page.goto('/en/git/teamwork/closes-keyword/');
  await goTo(page, 'hook');
  await active(page).getByRole('button', { name: 'Close issue' }).click();
  await done(page);
  await goTo(page, 'see-keyword');
  await active(page).locator('.spot-line', { hasText: 'Closes #16' }).click();
  await done(page);
  await goTo(page, 'try-link');
  const card = active(page);
  await card.getByRole('button', { name: 'Edit description' }).click();
  await card.getByLabel('Description').fill('Adds a gallery page with 6 photos.\n\nCloses #16');
  await card.getByRole('button', { name: 'Save' }).click();
  await done(page);
  await expect(card.locator('.prepo-note').first()).toContainText('Merging this closes #16.');
  await goTo(page, 'check-swipe');
  await swipe(active(page), [true, false, true, false]);
  await done(page);
  await goTo(page, 'try-merge');
  const merge = active(page);
  await merge.getByRole('button', { name: 'Merge pull request' }).click();
  await done(page);
  await merge.getByRole('button', { name: /^Issues/ }).click();
  await merge.getByRole('button', { name: /Add a photo gallery/ }).click();
  await expect(merge.locator('.prepo-sub .prepo-state')).toHaveText(/Closed/);
  await noSideScroll(page);
});

test('5.10 merge methods (EN): the wrong method gets a kind retry', async ({ page }) => {
  await page.goto('/en/git/teamwork/merge-methods/');
  await goTo(page, 'predict-squash');
  await choose(active(page), 'One new commit');
  await goTo(page, 'try-squash');
  const card = active(page);
  await card.getByRole('radio', { name: 'Rebase and merge' }).check();
  await card.getByRole('button', { name: 'Merge pull request' }).click();
  await expect(card.locator('.feedback-almost')).toContainText('Squash and merge');
  await expect(card).not.toHaveAttribute('data-done', 'true');
  await expect(card.locator('.prepo-sub .prepo-state')).toHaveText(/Open/);
  await card.getByRole('radio', { name: 'Squash and merge' }).check();
  await card.getByRole('button', { name: 'Merge pull request' }).click();
  await done(page);
  await expect(card.locator('.prepo-event')).toContainText('Squash and merge');
  await noSideScroll(page);
  await goTo(page, 'predict-linear');
  await choose(active(page), 'Merge commit');
});

test('5.11 conflicts in a PR (EN): spot the markers, then remove them', async ({ page }) => {
  await page.goto('/en/git/teamwork/pr-conflicts/');
  await goTo(page, 'try-spot');
  for (const marker of ['<<<<<<< my-tagline', '=======', '>>>>>>> main']) await active(page).locator('.spot-line', { hasText: marker }).click();
  await done(page);
  await goTo(page, 'try-fix');
  await markdown(active(page), '# Club Site\nCode, snacks and friends. Every Friday!\n=======\n');
  await active(page).getByRole('button', { name: 'Check' }).click();
  await expect(active(page).locator('.feedback-almost')).toContainText('Delete the lines');
  await markdown(active(page), '# Club Site\nCode, snacks and friends. Every Friday!\n');
  await done(page);
  await noSideScroll(page);
  await goTo(page, 'check-order');
  await order(active(page), ['Open the conflict from the PR', 'Pick the words to keep', 'Delete the conflict markers', 'Mark the file as resolved', 'Commit the merge']);
  await done(page);
});

test('5.12 protection (EN): a rule blocks the failing PR', async ({ page }) => {
  await page.goto('/en/git/teamwork/protection/');
  await goTo(page, 'try-rules');
  const card = active(page);
  await card.getByRole('switch', { name: 'Require checks to pass' }).check();
  await done(page);
  await card.getByRole('button', { name: /^Pull requests/ }).click();
  await card.getByRole('button', { name: /Make the logo spin/ }).click();
  await expect(card.locator('.prepo-blocked')).toContainText('A check failed');
  await noSideScroll(page);
  await goTo(page, 'see-owners');
  await expect(active(page).locator('.replay')).toContainText('*.css    @mei');
  await goTo(page, 'predict');
  await choose(active(page), '@mei');
});

test('5.14 open source (BM): roles, the path, CONTRIBUTING.md and a good first issue', async ({ page }) => {
  await page.goto('/ms/git/teamwork/open-source/');
  await goTo(page, 'try-roles');
  await order(active(page), ['Read: tengok dan komen', 'Triage: susun issue dan PR', 'Write: push kod', 'Maintain: urus repo', 'Admin: kawalan penuh']);
  await done(page);
  await goTo(page, 'see-path');
  for (const dot of await active(page).locator('.timeline-dot').all()) await dot.click();
  await done(page);
  await goTo(page, 'try-contributing');
  await active(page).getByRole('link', { name: 'CONTRIBUTING.md' }).click();
  await done(page);
  await goTo(page, 'try-label');
  const card = active(page);
  await card.getByRole('button', { name: /Salah ejaan/ }).click();
  await card.getByRole('button', { name: 'Ubah label' }).click();
  await card.getByRole('checkbox', { name: 'good first issue' }).check();
  await done(page);
  await noSideScroll(page);
});

test('boss (EN): red check → request changes → approve the fix → squash, and #9 closes', async ({ page }) => {
  await page.goto('/en/git/teamwork/boss/');
  await goTo(page, 'hook');
  await choose(active(page), 'Open the check');

  await goTo(page, 'try-find');
  const find = active(page);
  await find.getByRole('button', { name: /Check out code/ }).click();
  await expect(find.locator('.feedback-almost')).toContainText('That step passed');
  await find.getByRole('button', { name: /Check links/ }).click();
  await expect(find.locator('.prepo-log').last()).toContainText('signup.htm not found');
  await done(page);
  await noSideScroll(page);

  await goTo(page, 'try-review');
  const review = active(page);
  await expect(review.locator('.prepo-checks')).toContainText('Failed');
  await review.getByRole('radio', { name: 'Request changes' }).check();
  await review.getByRole('button', { name: 'Submit review' }).click();
  await expect(review.locator('.feedback-almost')).toContainText('Say what to change'); // an empty request gets a kind nudge
  await review.getByLabel('Write a comment').fill('Great page! The sign-up link says signup.htm. Can you make it signup.html?');
  await review.getByRole('button', { name: 'Submit review' }).click();
  await done(page);
  await expect(review.locator('.prepo-timeline')).toContainText('You asked for changes');

  await goTo(page, 'try-approve');
  const approve = active(page);
  await approve.getByRole('button', { name: /Files changed/ }).click();
  await expect(approve.locator('.prepo-diff')).toContainText('signup.html');
  await approve.getByRole('button', { name: 'Conversation' }).click();
  await approve.getByRole('radio', { name: 'Approve' }).check();
  await approve.getByRole('button', { name: 'Submit review' }).click();
  await done(page);

  await goTo(page, 'try-merge');
  const merge = active(page);
  await merge.getByRole('radio', { name: 'Merge commit' }).check();
  await expect(merge.locator('.prepo-blocked')).toContainText('straight line');
  await expect(merge.getByRole('button', { name: 'Merge pull request' })).toBeDisabled();
  await merge.getByRole('radio', { name: 'Rebase and merge' }).check();
  await merge.getByRole('button', { name: 'Merge pull request' }).click();
  await expect(merge.locator('.feedback-almost')).toContainText('Squash and merge');
  await merge.getByRole('radio', { name: 'Squash and merge' }).check();
  await merge.getByRole('button', { name: 'Merge pull request' }).click();
  await done(page);
  await expect(merge.locator('.feedback-right')).toContainText('#9 closed by itself');
  await merge.getByRole('button', { name: /^Issues/ }).click();
  await merge.getByRole('button', { name: /Add a club events page/ }).click();
  await expect(merge.locator('.prepo-sub .prepo-state')).toHaveText(/Closed/);
  await expect(merge.locator('.prepo-linked')).toContainText('#12');
  await noSideScroll(page);

  await goTo(page, 'check-closes');
  await choose(active(page), 'Closes #9');
  await goTo(page, 'win');
});

test('boss (BM): squash and merge closes issue #9', async ({ page }) => {
  await page.goto('/ms/git/teamwork/boss/#c=try-merge');
  await goTo(page, 'try-merge');
  const merge = active(page);
  await merge.getByRole('radio', { name: 'Squash dan merge' }).check();
  await merge.getByRole('button', { name: 'Merge pull request' }).click();
  await done(page);
  await merge.getByRole('button', { name: /^Issues/ }).click();
  await merge.getByRole('button', { name: /Tambah halaman acara kelab/ }).click();
  await expect(merge.locator('.prepo-sub .prepo-state')).toHaveText(/Ditutup/);
});
