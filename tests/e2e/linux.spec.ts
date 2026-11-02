// The Linux practice server (LinuxSim) on the hidden test page /<lang>/dev/interactives/:
// type commands, watch the state picture change, reach the goal; kind mistakes; root and the
// danger note; a busy program and Ctrl+C; the network panel; the phone key row; axe light + dark.
// Runs on both projects (360 px phone and desktop).
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';

const PAGE = '/en/dev/interactives/';
const MS = '/ms/dev/interactives/';
const DEMOS = ['linux-sim', 'linux-net'];

async function open(page: Page, id: string) {
  const demo = page.locator(`[data-demo="${id}"]`);
  await demo.scrollIntoViewIfNeeded();
  await expect(demo.locator('astro-island[ssr]')).toHaveCount(0); // hydrated
  return demo;
}

async function type(page: Page, demo: Locator, command: string) {
  const input = demo.locator('.term-input');
  await input.click();
  await input.fill(command);
  await page.keyboard.press('Enter');
}

test.describe('LinuxSim', () => {
  test('chmod +x makes the script runnable; the picture follows; the goal is met', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'linux-sim');
    const board = demo.getByRole('region', { name: 'State of the server' });
    await expect(board.locator('.lb-here')).toContainText('you@kedai:~/shop$');
    const script = board.locator('.lb-entry', { hasText: 'open.sh' });
    await expect(script.locator('.lb-mode')).toHaveText('-rw-r--r--');
    await expect(script.locator('.lb-tag-run')).toHaveCount(0);
    await type(page, demo, 'chmod +x open.sh');
    await expect(script.locator('.lb-mode')).toHaveText('-rwxr-xr-x');
    await expect(script.locator('.lb-tag-run')).toHaveText('can run');
    await expect(demo.locator('.sim-explain')).toContainText('chmod changed who may read, write or run open.sh');
    await expect(demo).not.toHaveAttribute('data-done', 'true');
    await type(page, demo, './open.sh');
    await expect(demo).toHaveAttribute('data-done', 'true');
    await expect(demo.locator('.feedback-right')).toContainText('The script can run now, and it opened the shop.');
  });

  test('mistakes get kind notes and then a hint, never a red WRONG', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'linux-sim');
    await type(page, demo, './open.sh');
    await expect(demo.locator('.sim-explain.sim-explain-err')).toContainText('has no x permission yet');
    await type(page, demo, 'gti status');
    await expect(demo.locator('.sim-explain')).toContainText('There is no command called gti');
    await expect(demo).toHaveAttribute('data-wrong', '2');
    await expect(demo.locator('.feedback-almost')).toContainText('Type chmod +x open.sh');
    await expect(demo).not.toContainText(/wrong/i);
    await demo.getByRole('button', { name: /Start again/ }).click();
    await expect(demo.locator('.feedback-almost')).toHaveCount(0);
  });

  test('sudo -i: the pink bar says root with an icon, the danger note shows; exit goes back', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'linux-sim');
    await type(page, demo, 'sudo -i');
    const here = demo.locator('.lb-here');
    await expect(here).toContainText('root@kedai:~#');
    await expect(here.locator('.lb-root svg')).toHaveCount(1);
    await expect(demo.locator('.lsim-danger')).toContainText('Careful');
    await expect(demo.locator('.lsim-danger svg')).toHaveCount(1);
    await expect(demo.locator('.term-custom-prompt')).toHaveText('root@kedai:~#');
    await type(page, demo, 'exit');
    await expect(demo.locator('.term-custom-prompt')).toHaveText('you@kedai:~/shop$');
    await expect(here.locator('.lb-root')).toHaveCount(0);
  });

  test('a long program holds the terminal; Ctrl+C gives it back (keyboard only)', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'linux-sim');
    const input = demo.locator('.term-input');
    await input.focus();
    await page.keyboard.type('sleep 100');
    await page.keyboard.press('Enter');
    await expect(demo.locator('.lsim-busy')).toBeVisible();
    await expect(demo.locator('.lb-proc')).toContainText('sleep 100');
    await demo.getByRole('button', { name: /Ctrl\+C/ }).focus();
    await page.keyboard.press('Enter');
    await expect(demo.locator('.lsim-busy')).toHaveCount(0);
    await expect(demo.locator('.lb-proc')).toHaveCount(0);
    await expect(demo.locator('.sim-explain')).toContainText('Ctrl+C stopped sleep 100');
  });

  test('a service that will not start: the lights, the ports, the fix', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'linux-net');
    const board = demo.getByRole('region', { name: 'State of the server' });
    const nginx = board.locator('.lb-svc', { hasText: 'nginx' });
    await expect(nginx).toContainText('stopped');
    await expect(board.locator('.lb-ports')).not.toContainText(':80');
    await type(page, demo, 'sudo systemctl start nginx');
    await expect(nginx).toContainText('failed');
    await expect(nginx.locator('svg')).toHaveCount(1); // red comes with an icon
    await type(page, demo, 'sudo nginx -t');
    await expect(demo.locator('.sim-explain')).toContainText('nginx -t found a problem');
    await type(page, demo, "sudo sed -i 's/lisen/listen/' /etc/nginx/sites-available/default");
    await type(page, demo, 'sudo systemctl start nginx');
    await expect(nginx).toContainText('running');
    await expect(board.locator('.lb-ports')).toContainText(':80');
    await expect(demo).toHaveAttribute('data-done', 'true');
  });

  test('the phone key row types words with a space and Tab completes names', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'linux-sim');
    await demo.locator('.term-key', { hasText: /^ls$/ }).click();
    await demo.locator('.term-key', { hasText: /^-l$/ }).click();
    await expect(demo.locator('.term-input')).toHaveValue('ls -l ');
    await demo.locator('.term-input').fill('cat pri');
    await demo.locator('.term-key', { hasText: /^Tab/ }).click();
    await expect(demo.locator('.term-input')).toHaveValue('cat prices.txt ');
  });

  test('no sideways scrolling at 360 px with the picture and the terminal', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto(PAGE);
    const demo = await open(page, 'linux-net');
    await type(page, demo, 'ls -la /etc/nginx/sites-available');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('Malay page: the picture and the notes speak Malay', async ({ page }) => {
    await page.goto(MS);
    const demo = await open(page, 'linux-sim');
    await expect(demo.getByRole('region', { name: 'Keadaan server' })).toContainText('Anda di sini');
    await type(page, demo, 'pwd');
    await expect(demo.locator('.sim-explain')).toContainText('pwd tunjuk di mana anda berada');
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`axe ${theme}`, async ({ page }) => {
      await page.addInitScript((t) => {
        localStorage.setItem('fahamlah:v1', JSON.stringify({ v: 1, settings: { theme: t } }));
      }, theme);
      await page.goto(PAGE);
      for (const id of DEMOS) await open(page, id);
      // The states with the most colour: root, a danger note, a busy program, a failed service.
      const sim = page.locator('[data-demo="linux-sim"]');
      await type(page, sim, 'sleep 100 &');
      await type(page, sim, 'sudo -i');
      const net = page.locator('[data-demo="linux-net"]');
      await type(page, net, 'sudo systemctl start nginx');
      await expect(net.locator('.lb-svc-failed')).toBeVisible();
      await page.evaluate(() => window.scrollTo(0, 0));
      let axe = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']);
      for (const id of DEMOS) axe = axe.include(`[data-demo="${id}"]`);
      const results = await axe.analyze();
      const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
    });
  }
});
