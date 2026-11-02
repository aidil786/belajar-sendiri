// Level Up · Observability: the PromQL engine's interactives on the hidden test page
// /<lang>/dev/interactives/: PromQLPlayground and AlertRuleBuilder. Runs on both projects
// (360 px phone and desktop).
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';

const PAGE = '/en/dev/interactives/';
const DEMOS = ['promql-rate', 'promql-latency', 'alert-down', 'alert-flappy'];

async function open(page: Page, id: string) {
  const demo = page.locator(`[data-demo="${id}"]`);
  await demo.scrollIntoViewIfNeeded();
  await expect(demo.locator('astro-island[ssr]')).toHaveCount(0); // hydrated
  return demo;
}

const box = (demo: Locator) => demo.getByRole('textbox', { name: 'PromQL query' });
async function query(demo: Locator, q: string) {
  await box(demo).fill(q);
  await demo.getByRole('button', { name: /Run$/ }).click();
}

test.describe('PromQLPlayground', () => {
  test('run queries: table at the eval time, graph over time, kind misses, then the goal', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'promql-rate');
    await expect(box(demo)).toHaveValue('http_requests_total');

    // The raw counters: six series, a table and a graph with six lines.
    await demo.getByRole('button', { name: /Run$/ }).click();
    await expect(demo.locator('.pq-result .pq-head')).toHaveText('6 series at 10m');
    await expect(demo.locator('.pq-result tbody tr')).toHaveCount(6);
    await expect(demo.locator('.pq-result tbody tr').first()).toContainText('http_requests_total{code="200", instance="shop-1", job="shop"}');
    await expect(demo.locator('.pq-result tbody tr').first()).toContainText('600');
    await expect(demo.locator('.pq-series')).toHaveCount(6);
    await expect(demo.getByRole('img', { name: /Line graph of 6 series from 0 to 30m/ })).toBeVisible();
    await expect(demo.locator('.feedback-almost')).toContainText('Use rate in your query.');
    await expect(demo).toHaveAttribute('data-wrong', '1');

    // A real mistake: Prometheus's words first, then a plain line.
    await query(demo, 'rate(http_requests_total)');
    await expect(demo.locator('.pq-error-real')).toContainText('1:6: parse error: expected type range vector in call to function "rate", got instant vector');
    await expect(demo.locator('.pq-error-plain')).toHaveText('This spot needs a value of type range vector, but it got instant vector.');

    // A metric chip goes in at the caret.
    await box(demo).fill('rate([5m])');
    await box(demo).evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(5, 5));
    await demo.getByRole('button', { name: 'http_requests_total' }).click();
    await expect(box(demo)).toHaveValue('rate(http_requests_total[5m])');

    // After two misses the hint opens by itself.
    await query(demo, 'sum(rate(http_requests_total[5m]))');
    await expect(demo.locator('.feedback-almost')).toContainText('You got 1 series. The task wants 3.');
    await expect(demo.locator('.pq-hint')).toBeVisible();

    // The answer: Enter runs it too.
    await box(demo).fill('sum by (code) (rate(http_requests_total[5m]))');
    await box(demo).press('Enter');
    await expect(demo).toHaveAttribute('data-done', 'true');
    await expect(demo.locator('.feedback-right')).toBeVisible();
    await expect(demo.locator('.pq-result tbody tr')).toHaveCount(3);
    await expect(demo.locator('.pq-legend li')).toHaveCount(3);
  });

  test('the eval-time slider moves "now": the table follows, the pink line moves', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'promql-rate');
    await query(demo, 'http_requests_total{instance="shop-2", code="200"}');
    await expect(demo.locator('.pq-result td').first()).toHaveText('1200');
    const slider = demo.getByRole('slider', { name: /Eval time/ });
    const before = await demo.locator('.pq-eval line').getAttribute('x1');
    await slider.focus();
    for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight');
    await expect(demo.getByText('Eval time: 16m')).toBeVisible();
    // shop-2 restarted at 16m: its counter starts again from 0.
    await expect(demo.locator('.pq-result td').first()).toHaveText('0');
    expect(await demo.locator('.pq-eval line').getAttribute('x1')).not.toBe(before);
  });

  test('a series lights up from the legend; the graph has a table view', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'promql-rate');
    await query(demo, 'sum by (code) (rate(http_requests_total[5m]))');
    const legend = demo.getByRole('button', { name: /Light up \{code="500"\}/ });
    await legend.focus();
    await expect(demo.locator('.pq-series.is-hi')).toHaveCount(1);
    await expect(demo.locator('.pq-series.is-dim')).toHaveCount(2);
    await legend.click();
    await expect(legend).toHaveAttribute('aria-pressed', 'true');
    await demo.locator('summary', { hasText: 'Graph as a table' }).click();
    const table = demo.locator('.pq-graph .pq-table');
    await expect(table.locator('tbody tr')).toHaveCount(31);
    await expect(table.locator('tbody tr.is-eval th')).toHaveText('10m');
    // A range vector: a table of samples, no graph line.
    await query(demo, 'http_requests_total{code="404"}[3m]');
    await expect(demo.locator('.pq-samples')).toHaveText('8 @8m · 9 @9m · 10 @10m');
    await expect(demo.locator('.pq-graph-note')).toContainText('Wrap it in a function like rate()');
  });

  test('p95 latency from a histogram', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'promql-latency');
    await expect(demo.getByText('Eval time: 18m')).toBeVisible();
    await query(demo, 'histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket[5m])))');
    await expect(demo.locator('.pq-result .pq-head')).toHaveText('1 series at 18m');
    await expect(demo).toHaveAttribute('data-done', 'true');
  });
});

test.describe('AlertRuleBuilder', () => {
  test('a short blip pages too early; waiting 5m and the right label and message fire once, for shop-1', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'alert-down');
    const yaml = demo.locator('.pq-yaml pre');
    await expect(yaml).toContainText('- alert: InstanceDown');
    await expect(yaml).toContainText('expr: up == 0');
    await expect(yaml).not.toContainText('for:');
    // No wait: the db-1 blip fires.
    await expect(demo.locator('.ar-row')).toHaveCount(2);
    await expect(demo.locator('.ar-summary').first()).toContainText('firing 6m to 8m');
    await demo.getByRole('button', { name: /Test the rule/ }).click();
    await expect(demo.locator('.feedback-almost')).toContainText('At 7m it is firing, but nothing is wrong then.');

    await demo.getByRole('radio', { name: '5m', exact: true }).check();
    await expect(yaml).toContainText('for: 5m');
    await expect(demo.locator('.ar-summary').first()).toContainText('pending 6m to 8m');
    await expect(demo.locator('.ar-summary').nth(1)).toContainText('pending 11m to 15m · 🔔 firing 16m to 31m');
    await demo.getByRole('button', { name: /Test the rule/ }).click();
    await expect(demo.locator('.feedback-almost')).toContainText('Add the label severity: page');

    await demo.getByRole('radio', { name: 'severity: page' }).check();
    await demo.getByRole('radio', { name: '{{ $labels.instance }} is down' }).check();
    await expect(yaml).toContainText('summary: "{{ $labels.instance }} is down"');
    // What the on-call person sees at the "look" time.
    const look = demo.getByRole('slider', { name: /Look at time/ });
    await look.focus();
    await page.keyboard.press('End');
    await expect(demo.locator('.ar-notice.is-firing')).toContainText('shop-1 is down');
    await demo.getByRole('button', { name: /Test the rule/ }).click();
    await expect(demo).toHaveAttribute('data-done', 'true');
    await expect(demo.locator('.feedback-right')).toContainText('The alert fires when it should');
  });

  test('flapping: waiting 3m turns five alarms into one; keep_firing_for holds it', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'alert-flappy');
    await expect(demo.getByRole('img', { name: /Line graph of 1 series/ })).toBeVisible();
    await expect(demo.locator('.pq-threshold')).toContainText('threshold 25');
    await demo.getByRole('button', { name: /Test the rule/ }).click();
    await expect(demo.locator('.feedback-almost')).toContainText('fires 5 separate times');
    await demo.getByRole('radio', { name: '3m', exact: true }).check();
    await expect(demo.locator('.ar-summary')).toContainText('firing 12m to 15m');
    await demo.getByRole('radio', { name: '5m', exact: true }).check();
    await expect(demo.locator('.ar-summary')).toContainText('firing 12m to 26m');
    await demo.locator('summary', { hasText: 'Timeline as a table' }).click();
    await expect(demo.locator('details', { hasText: 'Timeline as a table' }).locator('td.is-firing')).toHaveCount(15);
    await demo.getByRole('button', { name: /Test the rule/ }).click();
    await expect(demo).toHaveAttribute('data-done', 'true');
  });
});

test.describe('calm, layout and accessibility', () => {
  test('calm mode: nothing moves; the graph is there at once', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('fahamlah:v1', JSON.stringify({ v: 1, settings: { calm: true } })));
    await page.goto(PAGE);
    const demo = await open(page, 'promql-rate');
    await query(demo, 'rate(http_requests_total[5m])');
    await expect(demo.locator('.pq-series')).toHaveCount(6);
    const dur = await demo.locator('.pq-series').first().evaluate((el) => parseFloat(getComputedStyle(el).transitionDuration));
    expect(dur).toBeLessThan(0.01);
  });

  test('no sideways scroll on the page after runs', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'promql-rate');
    await query(demo, 'http_requests_total');
    await demo.locator('summary', { hasText: 'Graph as a table' }).click();
    await open(page, 'alert-down');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('Malay words', async ({ page }) => {
    await page.goto('/ms/dev/interactives/');
    const demo = await open(page, 'promql-rate');
    await demo.getByRole('button', { name: /Jalankan$/ }).click();
    await expect(demo.locator('.pq-result .pq-head')).toHaveText('6 siri pada 10m');
    await expect(demo.locator('.feedback-almost')).toContainText('Guna rate dalam query anda.');
    const alert = await open(page, 'alert-down');
    await expect(alert.getByRole('button', { name: /Uji rule/ })).toBeVisible();
  });

  for (const theme of ['light', 'dark'] as const) {
    for (const path of [PAGE, '/ms/dev/interactives/']) {
      test(`axe ${theme}: ${path}`, async ({ page }) => {
        await page.addInitScript((t) => {
          localStorage.setItem('fahamlah:v1', JSON.stringify({ v: 1, settings: { theme: t } }));
        }, theme);
        await page.goto(path);
        for (const id of DEMOS) await open(page, id);
        // Show a result, a graph with its table, an error, and an alert timeline with a notice.
        const rate = page.locator('[data-demo="promql-rate"]');
        await rate.locator('.pq-run').click();
        await rate.locator('.pq-details summary').click();
        const lat = page.locator('[data-demo="promql-latency"]');
        await lat.locator('textarea').fill('rate(http_request_duration_seconds_bucket)');
        await lat.locator('.pq-run').click();
        await expect(lat.locator('.pq-error')).toBeVisible();
        const down = page.locator('[data-demo="alert-down"]');
        await down.locator('.ar-test').click();
        for (const s of await down.locator('summary').all()) await s.click();
        const results = await new AxeBuilder({ page })
          .include('[data-demo^="promql"]')
          .include('[data-demo^="alert"]')
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
          .analyze();
        const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
        expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
      });
    }
  }
});
