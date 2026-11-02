// YamlPlayground (Docker D0 YAML lessons) on the hidden test page /<lang>/dev/interactives/.
// Runs on both projects (360 px phone and desktop).
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const PAGE = '/en/dev/interactives/';
const MS = '/ms/dev/interactives/';

async function open(page: Page, id: string) {
  const demo = page.locator(`[data-demo="${id}"]`);
  await demo.scrollIntoViewIfNeeded();
  await expect(demo.locator('astro-island[ssr]')).toHaveCount(0); // hydrated
  return demo;
}

test.describe('YamlPlayground', () => {
  test('add a list item: the tree follows, Check is kind, the task finishes', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'yaml-list');
    const tree = demo.locator('.yp-reads');
    await expect(tree).toContainText('sides');
    await expect(tree).toContainText('list · 2 items');
    await expect(tree.locator('.yp-node.is-text').first()).toContainText('nasi lemak');

    await demo.getByRole('button', { name: 'Check' }).click();
    await expect(demo.locator('.feedback-almost')).toContainText('two spaces, a dash, a space, then cucumber');
    await expect(demo).toHaveAttribute('data-wrong', '1');

    const editor = demo.getByRole('textbox', { name: 'YAML file order.yaml' });
    await editor.focus();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('  - cucumber\n');
    await expect(demo).toHaveAttribute('data-done', 'true');
    await expect(tree).toContainText('list · 3 items');
    await expect(demo.locator('.feedback-right')).toContainText('Three sides!');
  });

  test('a broken indent shows the reader’s words and a plain line, then "Add a space" fixes it', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'yaml-indent');
    await expect(demo.locator('.yp-error')).toHaveText('yaml: line 2: did not find expected key');
    await expect(demo.locator('.yp-plain')).toContainText("Line 3 isn't lined up.");
    await expect(demo.locator('.k8g-eline.is-bad')).toHaveCount(1);

    const editor = demo.getByRole('textbox', { name: 'YAML file tiffin.yaml' });
    // Put the caret on line 3, then use the phone-friendly button.
    await editor.evaluate((el: HTMLTextAreaElement) => {
      const at = el.value.split('\n').slice(0, 2).join('\n').length + 1;
      el.focus();
      el.setSelectionRange(at, at);
    });
    await demo.getByRole('button', { name: 'Add a space' }).click();
    await expect(demo).toHaveAttribute('data-done', 'true');
    await expect(demo.locator('.yp-error')).toHaveCount(0);
    await expect(demo.locator('.yp-reads')).toContainText('map · 3 keys');
  });

  test('a tab shows the tab error after typing stops', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'yaml-list');
    const editor = demo.getByRole('textbox', { name: 'YAML file order.yaml' });
    await editor.fill('dish: nasi lemak\nsides:\n\t- sambal\n');
    await expect(demo.locator('.yp-error')).toHaveText('yaml: line 3: found character that cannot start any token');
    await expect(demo.locator('.yp-plain')).toContainText('Line 3 has a tab.');
    await demo.getByRole('button', { name: 'Start over' }).click();
    await expect(demo.locator('.yp-error')).toHaveCount(0);
    await expect(demo.locator('.yp-reads')).toContainText('list · 2 items');
  });

  test('Malay words and no serious axe issues', async ({ page }) => {
    await page.goto(MS);
    const demo = await open(page, 'yaml-indent');
    await expect(demo.locator('.yp-reads h4')).toHaveText('Cara komputer membacanya');
    await expect(demo.getByRole('button', { name: 'Tambah satu ruang' })).toBeVisible();
    const results = await new AxeBuilder({ page }).include('[data-demo^="yaml-"]').analyze();
    const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(serious, serious.map((v) => `${v.id}: ${v.help}`).join('\n')).toEqual([]);
  });
});
