// K9 node shell (CKA pack) on the hidden test page /<lang>/dev/interactives/: fix a NotReady
// node from inside it, restore etcd, and the replay of a control-plane node. Axe light + dark, 360 px.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';

const PAGE = '/en/dev/interactives/';
const DEMOS = ['k9-shell', 'k9-restore', 'k9-replay'];

async function open(page: Page, id: string): Promise<Locator> {
  const demo = page.locator(`[data-demo="${id}"]`);
  await demo.scrollIntoViewIfNeeded();
  await expect(demo.locator('astro-island[ssr]')).toHaveCount(0); // hydrated
  return demo;
}

async function type(demo: Locator, line: string) {
  const input = demo.locator('input[data-terminal-input]');
  await input.fill(line);
  await input.press('Enter');
}

test.describe('K9 node shell', () => {
  test('a NotReady node: ssh in, start the kubelet, exit, and the node is Ready again', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'k9-shell');
    await expect(demo.locator('.kube-node-shell')).toHaveCount(0);
    await type(demo, 'kubectl get nodes');
    await expect(demo.locator('.term-screen')).toContainText('NotReady');
    await type(demo, 'ssh dev-worker');
    await expect(demo.locator('.kube-node-shell')).toContainText('dev-worker');
    await expect(demo.locator('.term-prompt')).toContainText('root@dev-worker:~#');
    await type(demo, 'systemctl status kubelet');
    await expect(demo.locator('.sim-explain')).toContainText('is stopped');
    await type(demo, 'systemctl start kubelet');
    await expect(demo.locator('.kube-danger-badge')).toHaveCount(0);
    await type(demo, 'exit');
    await expect(demo.locator('.kube-node-shell')).toHaveCount(0);
    await expect(demo.locator('.term-prompt')).not.toContainText('root@');
    await expect(demo).toHaveAttribute('data-done', 'true', { timeout: 30_000 });
  });

  test('changing a node shows a danger note, and the stop-kubelet button carries a warning icon', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'k9-shell');
    const btn = demo.getByRole('button', { name: /Stop a kubelet/ });
    await expect(btn.locator('svg')).toHaveCount(1);
    await type(demo, 'docker exec -it dev-worker2 bash');
    await expect(demo.locator('.term-prompt')).toContainText('root@dev-worker2:/#');
    await type(demo, 'systemctl stop kubelet');
    await expect(demo.locator('.kube-danger-badge')).toContainText('dev-worker2');
    await expect(demo.locator('.sim-explain')).toContainText('stopped');
  });

  test('restore etcd from a snapshot: the deleted shop comes back', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'k9-restore');
    await type(demo, 'kubectl get deployments');
    await expect(demo.locator('.term-screen')).toContainText('No resources found');
    await type(demo, 'ssh dev-control-plane');
    await type(demo, 'etcdutl --data-dir /var/lib/etcd-restore snapshot restore /opt/backup.db');
    await expect(demo.locator('.sim-explain')).toContainText('now holds the snapshot');
    await type(demo, "sed -i 's#/var/lib/etcd$#/var/lib/etcd-restore#' /etc/kubernetes/manifests/etcd.yaml");
    await type(demo, 'exit');
    await demo.getByRole('button', { name: /\+30s/ }).click();
    await expect(demo).toHaveAttribute('data-done', 'true', { timeout: 30_000 });
    await type(demo, 'kubectl get deployment shop');
    await expect(demo.locator('.term-screen')).toContainText('3/3');
  });

  test('replay inside the control-plane node shows the root prompt and the certificate table', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'k9-replay');
    await expect(demo.locator('.replay-line').last()).toBeVisible({ timeout: 15_000 });
    await expect(demo.locator('.replay')).toContainText('root@dev-control-plane:/#');
    await expect(demo.locator('.replay')).toContainText('CERTIFICATE AUTHORITY');
    await expect(demo.locator('.replay')).toContainText('kube-scheduler.yaml');
  });

  test('Malay page and no sideways scroll at 360 px', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto('/ms/dev/interactives/');
    const demo = await open(page, 'k9-shell');
    for (const id of DEMOS.slice(1)) await open(page, id);
    await type(demo, 'ssh dev-worker');
    await expect(demo.locator('.kube-node-shell')).toContainText('Anda di dalam nod dev-worker');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`axe ${theme} (inside a node)`, async ({ page }) => {
      await page.addInitScript((t) => {
        localStorage.setItem('fahamlah:v1', JSON.stringify({ v: 1, settings: { theme: t, calm: true } }));
      }, theme);
      await page.goto(PAGE);
      for (const id of DEMOS) await open(page, id);
      await type(page.locator('[data-demo="k9-shell"]'), 'ssh dev-worker');
      await type(page.locator('[data-demo="k9-shell"]'), 'systemctl stop kubelet');
      await expect(page.locator('[data-demo="k9-shell"] .kube-node-shell')).toBeVisible();
      // Typing scrolled the input up to the sticky header; put the demo back in the middle of the screen.
      await page.locator('[data-demo="k9-shell"]').evaluate((el) => el.scrollIntoView({ block: 'center' }));
      const results = await new AxeBuilder({ page }).include('[data-demo^="k9"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
      const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
    });
  }
});
