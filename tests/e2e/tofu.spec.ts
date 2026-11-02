// The OpenTofu interactives on the hidden test page /<lang>/dev/interactives/:
// TofuSim (files + terminal + "blueprint vs built") and PlanReader.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';

const PAGE = '/en/dev/interactives/';

async function open(page: Page, id: string) {
  const demo = page.locator(`[data-demo="${id}"]`);
  await demo.scrollIntoViewIfNeeded();
  await expect(demo.locator('astro-island[ssr]')).toHaveCount(0); // hydrated
  return demo;
}

async function type(_page: Page, demo: Locator, command: string) {
  // fill + press: no pointer, so islands still settling higher up the long test page can't get in the way.
  const input = demo.locator('.term-input');
  await input.fill(command);
  await input.press('Enter');
}

test.describe('TofuSim', () => {
  test('edit a file, init, plan, apply: the picture follows', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'tofu-sim');
    const board = demo.getByRole('figure', { name: 'The blueprint and what is built' });
    await expect(board).toContainText('needs tofu init');
    await expect(board).toContainText('Nothing built yet.');
    await expect(board.locator('.tofu-blueprint .tofu-item')).toHaveCount(2);

    // Edit main.tf in the tab: a longer stall name.
    await demo.getByRole('tab', { name: /main\.tf/ }).click();
    const editor = demo.getByLabel('Edit main.tf');
    const text = await editor.inputValue();
    await editor.fill(text.replace('length = 2', 'length = 3'));
    await expect(editor).toHaveValue(/length = 3/);

    await type(page, demo, 'tofu init');
    await expect(demo.locator('.sim-explain')).toContainText('init set up this folder');
    await expect(board).toContainText('init done');

    await type(page, demo, 'tofu plan');
    await expect(demo.locator('.sim-explain')).toContainText('2 to add');
    await expect(board.locator('.tofu-blueprint .tofu-item.is-create')).toHaveCount(2);
    await expect(demo).not.toHaveAttribute('data-done', 'true');

    await type(page, demo, 'tofu apply');
    await expect(demo.locator('.sim-explain')).toContainText('Type yes');
    await expect(demo.locator('.term-custom-prompt')).toContainText('Enter a value:');
    await type(page, demo, 'yes');
    await expect(demo).toHaveAttribute('data-done', 'true');
    await expect(demo.locator('.feedback-right')).toContainText('Built from the blueprint');
    await expect(board.locator('.tofu-built .tofu-item')).toHaveCount(2);
    // length = 3: three words in the stall name
    await expect(board.locator('.tofu-outputs')).toContainText(/stall_name\s*=?\s*[a-z]+-[a-z]+-[a-z]+/);
  });

  test('destroy carries the danger note; answering no keeps everything', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'tofu-sim');
    await type(page, demo, 'tofu init');
    await type(page, demo, 'tofu apply -auto-approve');
    await expect(demo).toHaveAttribute('data-done', 'true');
    await type(page, demo, 'tofu destroy');
    await expect(demo.locator('.tofu-danger')).toContainText('Careful');
    await expect(demo.locator('.tofu-built .tofu-item.is-delete')).toHaveCount(2);
    await type(page, demo, 'no');
    await expect(demo.locator('.sim-explain')).toContainText('Nothing was changed');
    await expect(demo.locator('.tofu-built .tofu-item')).toHaveCount(2);
  });

  test('in Malay the explanation is Malay too', async ({ page }) => {
    await page.goto('/ms/dev/interactives/');
    const demo = await open(page, 'tofu-sim');
    await expect(demo.getByRole('figure', { name: 'Pelan dan apa yang sudah dibina' })).toBeVisible();
    await type(page, demo, 'tofu plan');
    await expect(demo.locator('.sim-explain')).toContainText('tofu init dulu');
  });
});

test.describe('PlanReader', () => {
  test('tap what happens to each resource, then why the replace', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'tofu-reader');
    const items = demo.locator('.tofu-reader-item');
    await expect(items).toHaveCount(4);
    await expect(demo.locator('.tofu-reader-count')).toContainText('0 of 4 read');
    // The plan text hides "will be created" but keeps the symbols.
    await expect(items.first()).not.toContainText('will be');

    const menu = items.filter({ hasText: 'local_file.menu' });
    await menu.getByRole('button', { name: 'destroy', exact: true }).click();
    await expect(menu.locator('.tofu-reader-msg')).toContainText('Almost!');
    await menu.getByRole('button', { name: 'create', exact: true }).click();
    await expect(menu.locator('.tofu-reader-msg')).toContainText('+ means it will be created');

    await items.filter({ hasText: 'local_file.old_menu' }).getByRole('button', { name: 'destroy', exact: true }).click();
    await items.filter({ hasText: 'terraform_data.board' }).getByRole('button', { name: 'update in place', exact: true }).click();
    const stall = items.filter({ hasText: 'random_pet.stall' });
    await stall.getByRole('button', { name: 'replace', exact: true }).click();
    await expect(stall).toContainText('Which argument forces the replacement?');
    await expect(demo).not.toHaveAttribute('data-done', 'true');
    await stall.getByRole('button', { name: 'length', exact: true }).click();
    await expect(demo).toHaveAttribute('data-done', 'true');
    await expect(demo.locator('.tofu-reader-summary')).toContainText('Plan: 2 to add, 1 to change, 2 to destroy.');
  });
});

test.describe('layout and accessibility', () => {
  test('no horizontal scroll at 360px', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    for (const path of [PAGE, '/ms/dev/interactives/']) {
      await page.goto(path);
      const demo = await open(page, 'tofu-sim');
      await type(page, demo, 'tofu init');
      await type(page, demo, 'tofu plan');
      await open(page, 'tofu-reader');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`axe ${theme}: TofuSim and PlanReader`, async ({ page }) => {
      await page.addInitScript((t) => {
        localStorage.setItem('fahamlah:v1', JSON.stringify({ v: 1, settings: { theme: t, calm: true } }));
      }, theme);
      await page.goto(PAGE);
      const demo = await open(page, 'tofu-sim');
      await type(page, demo, 'tofu init');
      await type(page, demo, 'tofu apply -auto-approve');
      await type(page, demo, 'tofu destroy');
      const reader = await open(page, 'tofu-reader');
      await reader.locator('.tofu-reader-item').first().getByRole('button', { name: 'destroy', exact: true }).click();
      const results = await new AxeBuilder({ page })
        .include('[data-demo="tofu-sim"]')
        .include('[data-demo="tofu-reader"]')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
    });
  }
});
