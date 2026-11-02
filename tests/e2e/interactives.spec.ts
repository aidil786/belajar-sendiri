// The newer interactives (Transcript, PracticeRepo, MarkdownPlayground, YamlBuilder,
// MissionCheck) on the hidden test page /<lang>/dev/interactives/.
// No real network: the GitHub API is answered by page.route.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type Route } from '@playwright/test';

const PAGE = '/en/dev/interactives/';
const API = 'https://api.github.com';

async function open(page: Page, id: string) {
  const demo = page.locator(`[data-demo="${id}"]`);
  await demo.scrollIntoViewIfNeeded();
  await expect(demo.locator('astro-island[ssr]')).toHaveCount(0); // hydrated
  return demo;
}

type Answer = { status?: number; json?: unknown; headers?: Record<string, string> };

/** Answer GitHub API calls from a map of path → answer (404 otherwise). */
async function mockGithub(page: Page, answers: Record<string, Answer>, calls: string[] = []) {
  await page.route(`${API}/**`, async (route: Route) => {
    const url = route.request().url();
    calls.push(url);
    const a = answers[url.slice(API.length)] ?? { status: 404, json: { message: 'Not Found' } };
    await route.fulfill({
      status: a.status ?? 200,
      contentType: 'application/json',
      body: JSON.stringify(a.json ?? {}),
      headers: {
        'access-control-allow-origin': '*',
        'access-control-expose-headers': 'Link, Retry-After, X-RateLimit-Remaining, X-RateLimit-Reset',
        ...a.headers,
      },
    });
  });
  return calls;
}

test.describe('interactives test page', () => {
  test('is hidden from search engines', async ({ page }) => {
    await page.goto(PAGE);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
  });

  test('Transcript: lines appear, commands can be copied, replay works', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'transcript');
    await expect(demo.locator('.transcript-line').last()).toBeVisible();
    await expect(demo.locator('.transcript-screen')).toContainText('cat note.txt');
    await expect(demo.locator('.transcript-screen')).toContainText('hi');
    await expect(demo.getByRole('button', { name: 'Copy command: cat note.txt' })).toBeVisible();
    await expect(demo.locator('figcaption')).toHaveText(/Make a folder/);
    await demo.getByRole('button', { name: /Replay/ }).click();
    await expect(demo.locator('.transcript-line').last()).toBeVisible();
  });

  test('Transcript: reduced motion shows everything at once, no replay', async ({ browser, baseURL }) => {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.goto(`${baseURL}${PAGE}`);
    const demo = await open(page, 'transcript');
    await expect(demo.locator('.replay-hidden')).toHaveCount(0);
    await expect(demo.getByRole('button', { name: /Replay/ })).toHaveCount(0);
    await context.close();
  });

  test('PracticeRepo: branch rule blocks merge until approved; merging closes the issue', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'repo-merge');
    await expect(demo.getByText('Practice repo — not a real website')).toBeVisible();
    await expect(demo.locator('.prepo-blocked')).toContainText('needs one approving review');
    await expect(demo.getByRole('button', { name: 'Merge pull request' })).toBeDisabled();
    // Approve as a teammate.
    await demo.getByRole('radio', { name: 'Approve' }).check();
    await demo.getByRole('button', { name: 'Submit review' }).click();
    await expect(demo.locator('.prepo-timeline')).toContainText('You approved these changes');
    await expect(demo.locator('.prepo-blocked')).toHaveCount(0);
    await demo.getByRole('radio', { name: 'Squash and merge' }).check();
    await demo.getByRole('button', { name: 'Merge pull request' }).click();
    await expect(demo).toHaveAttribute('data-done', 'true');
    await expect(demo.locator('.prepo-sub .prepo-state')).toHaveText(/Merged/);
    await expect(demo.locator('.prepo-event')).toContainText('Squash and merge');
    // "Closes #3" closed the issue.
    await demo.getByRole('button', { name: /^Issues/ }).click();
    await demo.getByRole('button', { name: /Add a contact page/ }).click();
    await expect(demo.locator('.prepo-sub .prepo-state')).toHaveText(/Closed/);
    await expect(demo.locator('.prepo-linked')).toContainText('#7');
  });

  test('PracticeRepo: README links open files in the practice repo', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'repo-merge');
    await demo.getByRole('button', { name: 'Code' }).click();
    await expect(demo.locator('.md-alert-tip')).toContainText('Tip');
    await demo.getByRole('link', { name: 'guide' }).click();
    await expect(page).toHaveURL(/\/en\/dev\/interactives\/$/);
    await expect(demo.locator('.prepo-box-head')).toContainText('CONTRIBUTING.md');
    await demo.getByRole('button', { name: 'All files' }).click();
    await demo.getByRole('button', { name: /index\.html/ }).click();
    await expect(demo.locator('.prepo-codeview')).toContainText('<h1>My diary</h1>');
  });

  test('PracticeRepo: find the failing step in a workflow run', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'repo-run');
    await demo.getByRole('button', { name: /Check out code/ }).click();
    await expect(demo.locator('.feedback-almost')).toContainText('That step passed');
    await expect(demo.locator('.prepo-log')).toContainText('Fetching the repository');
    await demo.getByRole('button', { name: /Run tests/ }).click();
    await expect(demo.locator('.prepo-log').last()).toContainText('Expected "Diary" but got "Dairy"');
    await expect(demo).toHaveAttribute('data-done', 'true');
  });

  test('PracticeRepo: suggest a change on a line', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'repo-suggest');
    await demo.locator('button.prepo-dl', { hasText: '<h1>Contact</h1>' }).click();
    await demo.getByRole('button', { name: 'Suggest a change' }).click();
    const box = demo.getByLabel('Comment on line 2');
    await expect(box).toHaveValue('```suggestion\n<h1>Contact</h1>\n```');
    await demo.getByRole('button', { name: 'Add comment' }).click();
    await expect(demo.locator('.feedback-almost')).toContainText('Change the line inside the suggestion first');
    await box.fill('Friendlier?\n```suggestion\n<h1>Contact us</h1>\n```');
    await demo.getByRole('button', { name: 'Add comment' }).click();
    await expect(demo.locator('.prepo-suggestion')).toContainText('<h1>Contact us</h1>');
    await expect(demo).toHaveAttribute('data-done', 'true');
  });

  test('PracticeRepo: label an issue (keyboard only)', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'repo-label');
    await demo.getByRole('button', { name: /Typo on the home page/ }).focus();
    await page.keyboard.press('Enter');
    await demo.getByRole('button', { name: 'Edit labels' }).focus();
    await page.keyboard.press('Enter');
    await demo.getByRole('checkbox', { name: 'bug' }).focus();
    await page.keyboard.press('Space');
    await expect(demo).toHaveAttribute('data-done', 'true');
    await expect(demo.locator('.prepo-side')).toContainText('bug');
  });

  test('MarkdownPlayground: live preview, kind hints, goal', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'markdown');
    const input = demo.getByLabel('Your Markdown');
    await expect(demo.locator('.md-body .md-h1')).toHaveText('My project');
    await demo.getByRole('button', { name: 'Check' }).click();
    await expect(demo.locator('.feedback-almost')).toContainText('Start a line with ## Install');
    await input.fill('# My project\n\n## Install\n\n- [ ] Clone it\n- [x] Read it\n\n> [!WARNING]\n> Careful\n\n| a | b |\n| - | -: |\n| 1 | 2 |');
    await expect(demo.locator('.md-body .md-h2')).toHaveText('Install');
    await expect(demo.locator('.md-body input[type="checkbox"]')).toHaveCount(2);
    await expect(demo.locator('.md-alert-warning')).toContainText('Warning');
    await expect(demo.locator('.md-body td.md-al-right')).toHaveText('2');
    await expect(demo).toHaveAttribute('data-done', 'true');
    await expect(demo.locator('.feedback-right')).toContainText('Your README has a section');
  });

  test('MarkdownPlayground: raw HTML and script links stay harmless', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'markdown');
    await demo.getByLabel('Your Markdown').fill('<img src=x onerror="window.__xss=1">\n\n[click](javascript:window.__xss=2)\n\n<script>window.__xss=3</script>');
    await expect(demo.locator('.md-body')).toContainText('<img src=x');
    await expect(demo.locator('.md-body img, .md-body script')).toHaveCount(0);
    await expect(demo.locator('.md-body a')).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  });

  test('YamlBuilder: kind feedback for order, then the pipeline runs', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'yaml');
    const add = (label: string) => demo.locator('.yb-palette').getByRole('button', { name: label }).click();
    await add('On push');
    await add('Job: test');
    await add('Deploy');
    await demo.getByRole('button', { name: /Run workflow/ }).click();
    await expect(demo.locator('.feedback-almost')).toContainText('This workflow only tests');
    await demo.getByRole('button', { name: 'Remove: Deploy' }).click();
    await add('Check out code');
    await add('Run tests');
    await add('Set up Node');
    await demo.getByRole('button', { name: /Run workflow/ }).click();
    await expect(demo.locator('.feedback-almost')).toContainText('“Run tests” should go further down');
    await demo.getByRole('button', { name: 'Move up: Set up Node' }).click();
    await expect(demo.locator('.yb-yaml')).toContainText('runs-on: ubuntu-latest');
    await expect(demo.locator('.yb-yaml')).toContainText('- uses: actions/checkout@v7');
    await demo.getByRole('button', { name: /Run workflow/ }).click();
    await expect(demo).toHaveAttribute('data-done', 'true', { timeout: 10_000 });
    await expect(demo.locator('.yb-step.is-pass')).toHaveCount(3);
    await expect(demo.locator('.feedback-right')).toContainText('Every step passed');
  });

  test('MissionCheck: checks GitHub (mocked), remembers the username, only calls api.github.com', async ({ page }) => {
    const hosts = new Set<string>();
    page.on('request', (r) => hosts.add(new URL(r.url()).host));
    const answers: Record<string, Answer> = {
      '/repos/aina-codes/diary': { json: { full_name: 'aina-codes/diary', has_pages: false } },
      '/repos/aina-codes/diary/commits?per_page=1': {
        json: [{}],
        headers: { link: `<${API}/repositories/1/commits?per_page=1&page=2>; rel="next", <${API}/repositories/1/commits?per_page=1&page=4>; rel="last"` },
      },
    };
    const calls = await mockGithub(page, answers);
    await page.goto(PAGE);
    const demo = await open(page, 'mission');
    await expect(demo).toContainText('Your username is sent only to api.github.com.');
    await demo.getByLabel('Your GitHub username').fill('@aina-codes');
    await demo.getByRole('button', { name: 'Check now' }).click();
    const items = demo.locator('.ghc-item');
    await expect(items.nth(0)).toContainText('Done');
    await expect(items.nth(1)).toContainText('Done');
    await expect(items.nth(2)).toContainText("We can't find README.md yet. Did you push it?");
    await expect(demo).not.toHaveAttribute('data-done', 'true');

    answers['/repos/aina-codes/diary/contents/README.md'] = { json: { name: 'README.md' } };
    await demo.getByRole('button', { name: 'Check now' }).click();
    await expect(items.nth(2)).toContainText('Done');
    await expect(demo).toHaveAttribute('data-done', 'true');
    await expect(demo.locator('.feedback-right')).toContainText('GitHub can see your diary!');
    expect(calls.every((c) => c.startsWith(`${API}/repos/aina-codes/diary`))).toBe(true);
    expect([...hosts].filter((h) => !h.startsWith('localhost') && h !== 'api.github.com')).toEqual([]);

    // The username is saved for later missions.
    await page.reload();
    const again = await open(page, 'mission');
    await expect(again.getByLabel('Your GitHub username')).toHaveValue('aina-codes');
    await again.getByRole('button', { name: 'Forget my username' }).click();
    await expect(again.getByLabel('Your GitHub username')).toHaveValue('');
  });

  test('MissionCheck: kind messages for not found and rate limits', async ({ page }) => {
    const answers: Record<string, Answer> = {};
    await mockGithub(page, answers);
    await page.goto(PAGE);
    const demo = await open(page, 'mission');
    await demo.getByLabel('Your GitHub username').fill('not a name!');
    await demo.getByRole('button', { name: 'Check now' }).click();
    await expect(demo.locator('.feedback-almost')).toContainText("doesn't look like a GitHub username");

    await demo.getByLabel('Your GitHub username').fill('aina-codes');
    await demo.getByRole('button', { name: 'Check now' }).click();
    await expect(demo.locator('.ghc-item').first()).toContainText("We can't see it yet — is the repo public and the name right?");

    const reset = String(Math.floor(Date.now() / 1000) + 10 * 60);
    answers['/repos/aina-codes/diary'] = { status: 403, json: { message: 'API rate limit exceeded' }, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': reset } };
    await demo.getByRole('button', { name: 'Check now' }).click();
    await expect(demo.locator('.feedback-almost')).toContainText(/GitHub asks us to wait about (9|10) minutes/);
  });

  test('ObjectXray: commit → tree → folder → blob, with kind wrong turns and hints', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'xray');
    await expect(demo.locator('.xray-task')).toContainText('Find the blob that holds css/style.css.');
    // A hint before anything is open points at the HEAD commit.
    await demo.getByRole('button', { name: 'Hint' }).click();
    await expect(demo.locator('.feedback-almost')).toContainText(/Start with commit [0-9a-f]{7} in the list\./);
    await demo.getByRole('button', { name: /Add opening hours/ }).click();
    const panel = demo.locator('.xray-panel');
    await expect(panel.locator('.xray-badge')).toContainText('commit');
    await expect(panel.locator('.xray-body')).toContainText('author You <you@example.com>');
    // Focus moves to the first id in the new panel, so Enter opens the tree.
    await expect(panel.getByRole('button', { name: /^Open tree [0-9a-f]{40}$/ })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(panel.getByRole('button', { name: /^Open blob about\.html [0-9a-f]{40}$/ })).toBeFocused();
    await expect(panel.locator('.xray-badge')).toContainText('tree');
    // A wrong turn: index.html is a blob, but not the one we want.
    await panel.getByRole('button', { name: /^Open blob index\.html [0-9a-f]{40}$/ }).click();
    await expect(demo.locator('.feedback-almost')).toContainText('Almost! That blob is index.html. Go back and look for css/style.css.');
    await expect(demo).toHaveAttribute('data-wrong', '1');
    // Back with the trail, then into css/ and style.css.
    await demo.locator('.xray-trail').getByRole('button', { name: /tree/ }).click();
    await panel.getByRole('button', { name: /^Open tree css [0-9a-f]{40}$/ }).click();
    await panel.getByRole('button', { name: /^Open blob style\.css [0-9a-f]{40}$/ }).click();
    await expect(panel.locator('.xray-body')).toContainText('h1 { color: green; }');
    await expect(demo.locator('.feedback-right')).toContainText(/Blob [0-9a-f]{7} is the content of css\/style\.css\./);
    await expect(demo).toHaveAttribute('data-done', 'true');
    await expect(demo.locator('.xray-trail li')).toHaveCount(4);
  });

  test('BisectDetective: test, mark, halve, find the first bad commit', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'detective');
    await expect(demo.locator('.detective-row')).toHaveCount(10);
    await expect(demo.locator('.detective-row.is-good')).toHaveCount(1);
    await expect(demo.locator('.detective-row.is-bad')).toHaveCount(1);
    await demo.getByRole('button', { name: 'Start bisect' }).click();
    await expect(demo.locator('.detective-term')).toContainText('Bisecting: 4 revisions left to test after this (roughly 2 steps)');
    await expect(demo.locator('.detective-row.is-testing')).toContainText('Add a footer');
    // Focus follows the steps, so the keyboard never lands on the page itself.
    await expect(demo.getByRole('button', { name: 'Run the test' })).toBeFocused();
    // Marking before testing gets a kind nudge, not a mistake.
    await demo.getByRole('button', { name: 'Mark bad' }).click();
    await expect(demo.locator('.feedback-almost')).toContainText('Run the test first.');
    await demo.getByRole('button', { name: 'Run the test' }).click();
    await expect(demo.locator('.detective-verdict')).toContainText('The test passed. This commit is good.');
    await expect(demo.getByRole('button', { name: 'Mark good' })).toBeFocused();
    // The wrong button: kind feedback, nothing changes.
    await demo.getByRole('button', { name: 'Mark bad' }).click();
    await expect(demo.locator('.feedback-almost')).toContainText('Almost! The test passed here, so this commit is good.');
    await expect(demo).toHaveAttribute('data-wrong', '1');
    await demo.getByRole('button', { name: 'Mark good' }).click();
    await expect(demo.locator('.detective-term')).toContainText('$ git bisect good');
    // Keep testing until bisect names the culprit.
    for (let i = 0; i < 4 && (await demo.locator('.detective-found').count()) === 0; i++) {
      await demo.getByRole('button', { name: 'Run the test' }).click();
      const bad = (await demo.locator('.detective-verdict').textContent())?.includes('bad');
      await demo.getByRole('button', { name: bad ? 'Mark bad' : 'Mark good' }).click();
    }
    await expect(demo.locator('.detective-found')).toContainText(/Found it! [0-9a-f]{7} \(Tidy up spacing\) is the first bad commit\./);
    await expect(demo.locator('.detective-diff')).toContainText('+ <p class="price">RM0</p>');
    await expect(demo.locator('.detective-term')).toContainText("is the first 'bad' commit");
    await expect(demo.locator('.detective-row.is-found')).toHaveCount(1);
    await expect(demo.locator('.detective-steps')).toContainText('Tests used: 3. For 9 commits, bisect needs at most 4.');
    await expect(demo).toHaveAttribute('data-done', 'true');
    await demo.getByRole('button', { name: 'Start again' }).click();
    await expect(demo.getByRole('button', { name: 'Start bisect' })).toBeVisible();
  });

  test('BM page uses Malay UI text', async ({ page }) => {
    await page.goto('/ms/dev/interactives/');
    const demo = await open(page, 'repo-merge');
    await expect(demo.getByText('Repo latihan — bukan laman web sebenar')).toBeVisible();
    await expect(demo.getByRole('button', { name: 'Merge pull request' })).toBeDisabled();
    await expect(demo.locator('.prepo-blocked')).toContainText('Merge disekat');
    const xray = await open(page, 'xray');
    await expect(xray.getByText('Pilih satu commit untuk tengok isinya.')).toBeVisible();
    const detective = await open(page, 'detective');
    await expect(detective.getByRole('button', { name: 'Mula bisect' })).toBeVisible();
  });

  test('no horizontal scroll at 360px', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    for (const path of [PAGE, '/ms/dev/interactives/']) {
      await page.goto(path);
      for (const id of ['transcript', 'repo-merge', 'repo-run', 'repo-suggest', 'repo-label', 'markdown', 'yaml', 'mission', 'xray', 'detective']) await open(page, id);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
  });

  for (const theme of ['light', 'dark'] as const) {
    for (const path of [PAGE, '/ms/dev/interactives/']) {
      test(`axe ${theme}: ${path}`, async ({ page }) => {
        await page.addInitScript((t) => {
          localStorage.setItem('fahamlah:v1', JSON.stringify({ v: 1, settings: { theme: t } }));
        }, theme);
        await page.goto(path);
        for (const id of ['transcript', 'repo-merge', 'repo-run', 'repo-suggest', 'repo-label', 'markdown', 'yaml', 'mission', 'xray', 'detective']) await open(page, id);
        // Open a few inner states too.
        const yaml = page.locator('[data-demo="yaml"]');
        await yaml.locator('.yb-palette button').first().click();
        const suggest = page.locator('[data-demo="repo-suggest"]');
        await suggest.locator('button.prepo-dl').first().click();
        const xray = page.locator('[data-demo="xray"]');
        await xray.locator('.xray-commit').first().click();
        await xray.locator('.xray-ref').first().click();
        const detective = page.locator('[data-demo="detective"]');
        await detective.locator('.detective-actions .btn').first().click();
        await detective.locator('.detective-lab .btn-ghost').click();
        // A courier demo may still be flying its parcel: mid-fade text reads as low contrast. Let it land.
        await expect(page.locator('.courier-parcel')).toHaveCount(0);
        const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
        const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
        expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
      });
    }
  }
});
