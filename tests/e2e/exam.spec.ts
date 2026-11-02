// Exam practice: the hub, the KCNA mock and the CKAD practice, in EN and MS.
// Axe clean (light + dark), no sideways scroll at 360 px, one item per screen with "X of Y",
// kind feedback, results per domain with a working lesson link, the timer only in exam mode,
// a CKAD task solved in the simulator and scored, and a separate attempts store.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { CKAD_SET_SIZE, ckadTasks } from '../../src/content/exams/ckad';
import { KCNA_DOMAINS, KCNA_MOCK_SIZE, kcnaQuestions } from '../../src/content/exams/kcna';
import { EXAM_STORE_KEY } from '../../src/lib/mockExam';

/** Items in one set: all of a small bank, else the set size. */
const KCNA_N = Math.min(KCNA_MOCK_SIZE, kcnaQuestions.length);
const CKAD_N = Math.min(CKAD_SET_SIZE, ckadTasks.length);
const PAGES = ['/en/ship-it/exam/', '/ms/ship-it/exam/', '/en/ship-it/exam/kcna/', '/ms/ship-it/exam/kcna/', '/en/ship-it/exam/ckad/', '/ms/ship-it/exam/ckad/'];
const plain = (s: string) => s.replace(/`/g, '');
const exact = (s: string) => new RegExp(`^${plain(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);

async function seed(page: Page, data: Record<string, unknown>) {
  await page.addInitScript((d) => localStorage.setItem('fahamlah:v1', JSON.stringify(d)), data);
}

async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

/** The question on screen, from the bank. */
async function current(page: Page) {
  const id = await page.locator('[data-question]').getAttribute('data-question');
  const q = kcnaQuestions.find((x) => x.id === id);
  expect(q, `question ${id}`).toBeTruthy();
  return q!;
}

function option(page: Page, text: string) {
  return page.locator('[data-option]').filter({ has: page.locator('span:nth-child(2)', { hasText: exact(text) }) });
}

async function answer(page: Page, lang: 'en' | 'ms', right: boolean) {
  const q = await current(page);
  const text = right ? q[lang].options[q.answer] : q[lang].options.find((_, i) => i !== q.answer)!;
  await option(page, text).click();
  return q;
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
      await seed(page, { v: 2, settings: { theme, examMode: path.includes('/ms/') } });
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      if (path.endsWith('/kcna/') || path.endsWith('/ckad/')) {
        await page.locator('[data-mock-start]').click();
        await expect(page.locator(path.endsWith('/kcna/') ? '[data-question]' : '.ns-sim .term-input')).toBeVisible();
      }
      await axe(page);
    });
  }
}

test('no horizontal scroll at 360 px (hub, a question, a task with the simulator, results)', async ({ page }) => {
  await seed(page, { v: 2, settings: { examMode: true } });
  await page.setViewportSize({ width: 360, height: 780 });
  const noScroll = async (what: string) => {
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, what).toBeLessThanOrEqual(0);
  };
  for (const path of ['/en/ship-it/exam/', '/ms/ship-it/exam/']) {
    await page.goto(path);
    await noScroll(path);
  }
  await page.goto('/ms/ship-it/exam/kcna/');
  await page.locator('[data-mock-start]').click();
  await expect(page.locator('[data-question]')).toBeVisible();
  await noScroll('kcna question');
  await page.goto('/en/ship-it/exam/ckad/');
  await page.locator('[data-mock-start]').click();
  await expect(page.locator('.ns-sim .term-input')).toBeVisible();
  await page.waitForLoadState('networkidle');
  await noScroll('ckad task');
});

test('the hub explains both, says "practice, not the real exam", and links the official pages', async ({ page }) => {
  await page.goto('/en/ship-it/exam/');
  await expect(page.getByRole('heading', { level: 1, name: 'Exam practice' })).toBeVisible();
  await expect(page.locator('[data-not-real]')).toContainText('This is practice, not the real exam.');
  await expect(page.locator('[data-hub-exam]')).toHaveCount(2);
  await expect(page.getByRole('link', { name: 'Official KCNA page →' })).toHaveAttribute('href', /training\.linuxfoundation\.org\/certification\/kubernetes-cloud-native-associate\/$/);
  await expect(page.getByRole('link', { name: 'Official CKAD page →' })).toHaveAttribute('href', /certified-kubernetes-application-developer-ckad\/$/);
  await page.locator('[data-hub-exam="kcna"] summary').click();
  for (const d of KCNA_DOMAINS) await expect(page.locator('[data-hub-exam="kcna"]')).toContainText(d.name.en);
  await page.getByRole('link', { name: 'Open the KCNA mock →' }).click();
  await expect(page).toHaveURL(/\/en\/ship-it\/exam\/kcna\/$/);
  await expect(page.getByRole('heading', { level: 1, name: 'KCNA mock' })).toBeVisible();

  await page.goto('/ms/ship-it/exam/');
  await expect(page.getByRole('heading', { level: 1, name: 'Latihan peperiksaan' })).toBeVisible();
  await expect(page.locator('[data-not-real]')).toContainText('Ini latihan, bukan peperiksaan sebenar.');
  await page.getByRole('link', { name: 'Buka latihan CKAD →' }).click();
  await expect(page).toHaveURL(/\/ms\/ship-it\/exam\/ckad\/$/);
});

test('the certification map and the Ship It overview link the practice pages', async ({ page }) => {
  await page.goto('/en/ship-it/certifications/');
  await expect(page.locator('[data-cert="kcna"] [data-cert-practice]')).toHaveAttribute('href', '/en/ship-it/exam/kcna/');
  await expect(page.locator('[data-cert="ckad"] [data-cert-practice]')).toHaveAttribute('href', '/en/ship-it/exam/ckad/');
  await expect(page.locator('[data-cert="gh-200"] [data-cert-practice]')).toHaveCount(0);
  await page.goto('/ms/ship-it/');
  await page.locator('[data-exam-link] a').click();
  await expect(page).toHaveURL(/\/ms\/ship-it\/exam\/$/);
});

test('KCNA learn mode: one question per screen, kind feedback, try again; the first answer counts', async ({ page }) => {
  await page.goto('/en/ship-it/exam/kcna/');
  // Learn mode is the default; no timer without exam mode.
  await expect(page.getByRole('radio', { name: /Learn mode/ })).toBeChecked();
  await expect(page.locator('.mock-meta')).toContainText(`This set has ${KCNA_N} questions. No timer.`);
  await page.locator('[data-mock-start]').click();
  await expect(page.locator('[data-mock-count]')).toHaveText(`Question 1 of ${KCNA_N}`);
  await expect(page.getByRole('progressbar', { name: 'Progress' })).toHaveAttribute('aria-valuenow', '1');
  await expect(page.locator('[data-question]')).toBeFocused();
  await expect(page.locator('[data-question]')).toHaveCount(1);
  await expect(page.locator('[data-option]')).toHaveCount(4);
  await expect(page.locator('[role="timer"]')).toHaveCount(0);

  const q = await answer(page, 'en', false);
  const almost = page.locator('.feedback-almost');
  await expect(almost).toContainText("Almost! Here's the trick:");
  await expect(almost).toContainText('Try once more.');
  await expect(page.locator('body')).not.toContainText(/\bwrong\b/i);
  await expect(page.locator('.mock-note')).toContainText('Only your first answer counts for the score.');
  await option(page, q.en.options[q.answer]).click();
  await expect(page.locator('.feedback-right')).toContainText(plain(q.en.why));
  await page.locator('[data-mock-next]').click();
  await expect(page.locator('[data-mock-count]')).toHaveText(`Question 2 of ${KCNA_N}`);
  await expect(page.locator('[data-question]')).toBeFocused();

  // Saved after every answer, in its own key: a reload offers to continue.
  const saved = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? '{}'), EXAM_STORE_KEY);
  expect(saved.v).toBe(1);
  expect(saved.current.kcna.answers[q.id]).not.toBe(q.answer);
  expect((await page.evaluate(() => localStorage.getItem('fahamlah:v1'))) ?? '').not.toContain('kcna');
  await page.reload();
  await page.getByRole('button', { name: `Continue: question 2 of ${KCNA_N}` }).click();
  await expect(page.locator('[data-mock-count]')).toHaveText(`Question 2 of ${KCNA_N}`);
});

test('KCNA exam style (MS): answers at the end, a score per domain, review links to the lesson', async ({ page }) => {
  await page.goto('/ms/ship-it/exam/kcna/');
  await page.getByRole('radio', { name: /Gaya peperiksaan/ }).check();
  await page.locator('[data-mock-start]').click();
  let missed: (typeof kcnaQuestions)[number] | null = null;
  const seen: string[] = [];
  for (let i = 0; i < KCNA_N; i++) {
    await expect(page.locator('[data-mock-count]')).toHaveText(`Soalan ${i + 1} daripada ${KCNA_N}`);
    // Miss the first question; get the rest right. No feedback until the end.
    const q = await answer(page, 'ms', i > 0);
    if (i === 0) missed = q;
    seen.push(q.domain);
    await expect(page.locator('.feedback-almost, .feedback-right')).toHaveCount(0);
    await expect(page.locator('.mock-note')).toContainText('Dipilih.');
    await page.locator('[data-mock-next]').click();
  }
  await expect(page.getByRole('heading', { name: 'Keputusan anda' })).toBeFocused();
  const n = KCNA_N;
  const inDomain = seen.filter((d) => d === missed!.domain).length;
  await expect(page.locator('[data-mock-score]')).toHaveText(`${n - 1} daripada ${n} betul (${Math.round((100 * (n - 1)) / n)}%)`);
  await expect(page.locator('[data-mock-domains] li')).toHaveCount(new Set(seen).size);
  expect(new Set(seen).size).toBeLessThanOrEqual(KCNA_DOMAINS.length);
  await expect(page.locator(`[data-mock-domains] [data-domain="${missed!.domain}"]`)).toContainText(`${inDomain - 1} daripada ${inDomain}`);
  const item = page.locator(`[data-review="${missed!.id}"]`);
  await expect(page.locator('[data-review]')).toHaveCount(1);
  await expect(item).toContainText(plain(missed!.ms.options[missed!.answer]));
  await expect(item).toContainText(plain(missed!.ms.why));
  const saved = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? '{}'), EXAM_STORE_KEY);
  expect(saved.attempts).toHaveLength(1);
  expect(saved.attempts[0]).toMatchObject({ exam: 'kcna', mode: 'exam', right: n - 1, total: n });
  expect(saved.current.kcna).toBeUndefined();
  await item.locator('[data-review-lesson]').click();
  // Most questions point at a Kubernetes lesson; some at Docker or CI/CD lessons.
  await expect(page).toHaveURL(/\/ms\/(kubernetes|docker|cicd|git)\/[a-z0-9-]+\/[a-z0-9-]+\/(#.*)?$/);
  await expect(page.locator('h1')).toBeVisible();

  await page.goto('/ms/ship-it/exam/kcna/');
  await expect(page.locator('[data-mock-last]')).toContainText(`Kali lepas: ${n - 1} daripada ${n} betul`);
});

test('KCNA: the exam timer shows only in exam mode, counts up and never blocks', async ({ page }) => {
  await seed(page, { v: 2, settings: { examMode: true, calm: true } });
  await page.goto('/en/ship-it/exam/kcna/');
  await expect(page.locator('.mock-meta')).toContainText('Exam mode is on, so a timer runs.');
  await page.locator('[data-mock-start]').click();
  const timer = page.getByRole('timer', { name: 'Exam timer' });
  await expect(timer).toBeVisible();
  await expect(timer).toHaveAttribute('aria-live', 'off');
  // Calm mode: whole minutes only.
  await expect(timer).toHaveText(/^\d+ min$/);
  await expect(page.locator('.mock-target')).toContainText(/Suggested: \d+ min/);
  await answer(page, 'en', true);
  await page.locator('[data-mock-next]').click();
  await expect(page.locator('[data-mock-count]')).toHaveText(`Question 2 of ${KCNA_N}`);
});

test('CKAD: exam mode adds the docs-only card and a timer, and hides hints', async ({ page }) => {
  await seed(page, { v: 2, settings: { examMode: true } });
  await page.goto('/en/ship-it/exam/ckad/');
  await page.locator('[data-mock-start]').click();
  const card = page.locator('[data-exam-card]');
  for (const site of ['kubernetes.io/docs', 'kubernetes.io/blog', 'helm.sh/docs']) await expect(card.getByRole('link', { name: site })).toBeVisible();
  await expect(page.getByRole('timer', { name: 'Exam timer' })).toHaveText(/^\d+:\d\d$/);
  await expect(page.locator('[data-task-hint]')).toHaveCount(0);
  await expect(page.locator('[data-task-docs]')).toHaveAttribute('href', /^https:\/\/kubernetes\.io\/docs\//);
  // No editor in the practice terminal: the tools line stays visible even with hints hidden.
  await expect(page.locator('[data-task-tools]')).toContainText('No text editor here');
});

test('CKAD: a task is solved in the simulator, Skip and Next always work, and the set is scored per domain @desktop-only', async ({ page }) => {
  await page.goto('/en/ship-it/exam/ckad/');
  await expect(page.locator('.mock-meta')).toContainText(`This set has ${CKAD_N} tasks. No timer.`);
  await page.locator('[data-mock-start]').click();
  await expect(page.locator('[role="timer"]')).toHaveCount(0);
  // Solve the first task with its reference commands (the clock's +30s moves time on), skip the rest.
  const firstId = await page.locator('[data-task]').getAttribute('data-task');
  const first = ckadTasks.find((x) => x.id === firstId)!;
  // Hints are folded (exam mode is off).
  await page.locator('[data-task-hint] summary').click();
  await expect(page.locator('[data-task-hint]')).toContainText(plain(first.en.hint));
  await expect(page.locator('.ns-sim .term-input')).toBeVisible();
  for (const c of first.solution) await type(page, c);
  const solved = page.locator('[data-mock="ckad"][data-task-solved="true"]');
  for (let i = 0; i < 12 && !(await solved.count()); i++) {
    await page.getByRole('button', { name: /^\+30s/ }).click();
    await page.waitForTimeout(150);
  }
  await expect(solved).toHaveCount(1);
  await expect(page.locator('.ns-sim .feedback-right')).toContainText('Solved! The engine checked it.');
  await page.locator('[data-mock-next]').click();
  for (let i = 1; i < CKAD_N; i++) {
    await expect(page.locator('[data-mock-count]')).toHaveText(`Task ${i + 1} of ${CKAD_N}`);
    await expect(page.locator('.ns-sim .term-input')).toBeVisible();
    await expect(page.locator('[data-mock-next]')).toBeVisible();
    await page.locator('[data-mock-skip]').click();
  }
  await expect(page.getByRole('heading', { name: 'Your results' })).toBeFocused();
  await expect(page.locator('[data-mock-score]')).toHaveText(`1 of ${CKAD_N} tasks done (${Math.round(100 / CKAD_N)}%)`);
  await expect(page.locator(`[data-mock-domains] [data-domain="${first.domain}"] .mock-domain-score`)).toHaveText(/^1 of \d+$/);
  await expect(page.locator('[data-review]')).toHaveCount(CKAD_N - 1);
  await expect(page.locator(`[data-review="${first.id}"]`)).toHaveCount(0);
  const saved = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? '{}'), EXAM_STORE_KEY);
  expect(saved.attempts[0]).toMatchObject({ exam: 'ckad', right: 1, total: CKAD_N });
  await page.locator('[data-mock-again]').click();
  await expect(page.locator('[data-mock-count]')).toHaveText(`Task 1 of ${CKAD_N}`);
});
