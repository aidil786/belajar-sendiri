// Daily review cards: only from finished lessons, max 10 a day, kind feedback, keyboard works.
import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { parse } from 'yaml';
import { commandLabel } from '../../src/lib/review';

type Lang = 'en' | 'ms';
type Bi = { term: string; meaning: string };
const glossary = (parse(readFileSync('src/content/glossary/git.yaml', 'utf8')) as { terms: { id: string; en: Bi; ms: Bi }[] }).terms;
const commands = (parse(readFileSync('src/content/courses/git/commands.yaml', 'utf8')) as { commands: { id: string; syntax: string }[] }).commands;

/** The right option for a card id like "term:commit", "meaning:commit" or "cmd:add". */
function rightAnswer(cardId: string, lang: Lang): string {
  const [kind, id] = cardId.split(':') as [string, string];
  if (kind === 'cmd') return commandLabel(commands.find((c) => c.id === id)!.syntax);
  const term = glossary.find((t) => t.id === id)!;
  return kind === 'term' ? term[lang].meaning : term[lang].term;
}

/** Saved progress for the first page load only (reloads keep what the page saved). */
async function seed(page: Page, data: Record<string, unknown>) {
  await page.addInitScript((d) => {
    if (sessionStorage.getItem('seeded')) return;
    localStorage.setItem('fahamlah:v1', JSON.stringify(d));
    sessionStorage.setItem('seeded', '1');
  }, data);
}

const saved = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('fahamlah:v1') ?? '{}'));
const today = (page: Page) =>
  page.evaluate(() => {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  });
const plusDays = (key: string, n: number) => new Date(Date.parse(`${key}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

const WORLD_0_1 = ['git-w00-l01', 'git-w00-l02', 'git-w00-l03', 'git-w00-l04', 'git-w01-l01', 'git-w01-l02', 'git-w01-l03', 'git-w01-l04', 'git-w01-l05'];

test('nothing to review before any lesson, and no link on home', async ({ page }) => {
  await page.goto('/en/');
  await expect(page.locator('[data-continue]')).toBeVisible();
  await expect(page.locator('[data-review-link]')).toBeHidden();
  await page.goto('/en/review/');
  await expect(page.getByRole('heading', { name: 'Nothing to review yet' })).toBeVisible();
  await expect(page.locator('[data-review-continue]')).toHaveText('Start learning');
  await expect(page.locator('[data-review-continue]')).toHaveAttribute('href', '/en/git/start-here/why-save-versions/');
});

test('finished lessons give max 10 cards; right moves up, a miss moves gently down', async ({ page }) => {
  await seed(page, {
    v: 2,
    completed: WORLD_0_1,
    resume: { lessonId: 'git-w01-l05', cardId: 'hook', cardIndex: 0, path: '/en/git/save-points/first-save-point/' },
    // An old card in box 4, due long ago: it comes first.
    review: { cards: { 'cmd:add': { box: 4, due: '2026-01-08', last: '2026-01-01' } } },
  });
  await page.goto('/en/');
  const link = page.locator('[data-review-link]');
  await expect(link).toBeVisible();
  await expect(link).toHaveText('10 cards to review today');
  await link.click();
  await expect(page).toHaveURL(/\/en\/review\/$/);

  const count = page.locator('[data-review-count]');
  const card = page.locator('[data-review-card]');
  await expect(count).toContainText('Card 1 of 10');
  await expect(card).toHaveAttribute('data-review-card', 'cmd:add');
  await expect(card).toContainText('Which command does this?');

  // A miss: kind feedback, the answer is shown, the card drops one box (4 → 3), not to box 1.
  const wrong = card.locator('.choice-btn').filter({ hasNotText: /^\d?git add$/ }).first();
  await wrong.click();
  await expect(card.locator('.feedback-almost')).toContainText("Almost! Here's the answer: git add");
  await expect(card.locator('.choice-btn.is-right')).toContainText('git add');
  const day = await today(page);
  expect((await saved(page)).review.cards['cmd:add']).toEqual({ box: 3, due: plusDays(day, 4), last: day });

  // Enter on the focused Next button goes on.
  await expect(page.locator('[data-review-next]')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(count).toContainText('Card 2 of 10');

  // Right answers, the rest with the keyboard (1–3 pick, Enter goes on).
  for (let n = 2; n <= 10; n++) {
    await expect(count).toContainText(`Card ${n} of 10`);
    const id = (await card.getAttribute('data-review-card'))!;
    const options = await card.locator('.choice-btn').allInnerTexts();
    const i = options.findIndex((o) => o.replace(/^\d\s*/, '').trim() === rightAnswer(id, 'en'));
    expect(i, `${id}: ${options.join(' / ')}`).toBeGreaterThanOrEqual(0);
    if (n % 2) await page.keyboard.press(String(i + 1));
    else await card.locator('.choice-btn').nth(i).click();
    await expect(card.locator('.feedback-right')).toBeVisible();
    expect((await saved(page)).review.cards[id]).toMatchObject({ box: 1, due: plusDays(day, 1) });
    expect(await page.locator('body').innerText()).not.toMatch(/\bWRONG\b/);
    await page.keyboard.press('Enter');
  }
  await expect(page.getByRole('heading', { name: 'Done for today!' })).toBeVisible();
  await expect(page.getByText('You reviewed 10 cards. See you tomorrow.')).toBeVisible();
  await expect(page.locator('[data-review-continue]')).toHaveAttribute('href', '/en/git/save-points/first-save-point/#c=hook');

  // Max 10 a day: a reload stays done, and home shows no link.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Done for today!' })).toBeVisible();
  await page.goto('/en/');
  await expect(page.locator('[data-review-link]')).toBeHidden();
});

test('works in Malay, and calm mode shows no XP or decoration', async ({ page }) => {
  await seed(page, { v: 2, completed: ['git-w01-l03'], settings: { calm: true } });
  await page.goto('/ms/review/');
  await expect(page.locator('html')).toHaveAttribute('data-calm', 'true');
  const card = page.locator('[data-review-card]');
  await expect(page.locator('[data-review-count]')).toContainText(/Kad 1 daripada \d+/);
  const id = (await card.getAttribute('data-review-card'))!;
  await card.locator('.choice-btn').filter({ hasText: rightAnswer(id, 'ms') }).click();
  await expect(card.locator('.feedback-right')).toBeVisible();
  await expect(page.locator('body')).not.toContainText('XP');
  // Finish the rest, then the end screen.
  while (await page.locator('[data-review-next]').isVisible()) await page.locator('[data-review-next]').click();
  await expect(page.getByRole('heading', { name: 'Siap untuk hari ini!' })).toBeVisible();
  await expect(page.locator('.review-end-star')).toBeHidden();
});

test('the language switch keeps the review going', async ({ page }) => {
  await seed(page, { v: 2, completed: WORLD_0_1 });
  await page.goto('/en/review/');
  await page.locator('[data-review-card] .choice-btn').first().click();
  await page.locator('[data-review-next]').click();
  await expect(page.locator('[data-review-count]')).toContainText('Card 2 of 10');
  await page.locator('.topbar [data-lang-toggle]').click();
  await expect(page).toHaveURL(/\/ms\/review\/$/);
  await expect(page.locator('[data-review-count]')).toContainText('Kad 2 daripada 10');
});

test('axe: a review card has no serious or critical problems', async ({ page }) => {
  await seed(page, { v: 2, completed: WORLD_0_1 });
  await page.goto('/en/review/');
  await page.locator('[data-review-card] .choice-btn').first().click();
  // Scan from the top: mid-scroll, the sticky bar half-covers the sprint button and axe reads that as a tiny target.
  await page.evaluate(() => window.scrollTo(0, 0));
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
});
