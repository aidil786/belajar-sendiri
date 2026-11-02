// Kubernetes World K7 (Self-Driving): finish the boss rooms by hand (GitOpsMirror, ManagersBoard,
// YamlDoctor), catch drift in the food-court terminal, tap YAML lines, and walk the Kubernetes
// rescue flows on the Ship It Rescue Center. Runs on both projects (phone = 360 px).
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const BASE = '/en/kubernetes/self-driving';

for (const path of [`${BASE}/boss/#c=try-drift`, `${BASE}/argo-or-flux/#c=see-argo`, '/ms/kubernetes/self-driving/mission-6-hands-off/#c=try-connect']) {
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
const done = (page: Page) => expect(active(page)).toHaveAttribute('data-done', 'true', { timeout: 30_000 });

async function noSideScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

const FIXED = 'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: shop\nspec:\n  replicas: 5\n  selector:\n    matchLabels:\n      app: shop\n  template:\n    metadata:\n      labels:\n        app: shop\n    spec:\n      containers:\n        - name: web\n          image: ghcr.io/kedai-kancil/shop:1.5.0\n';

test('K7 boss: Git drives, the inner loop heals, a broken commit is fixed, drift is undone', async ({ page }) => {
  await page.goto(`${BASE}/boss/`);
  await goTo(page, 'hook');
  await active(page).locator('.choice-btn', { hasText: 'In Git: change replicas and commit' }).click();
  await expect(active(page).locator('.feedback-right')).toBeVisible();

  // Room 1: replicas 3 → 5 in Git; the cluster follows.
  await goTo(page, 'try-scale');
  let card = active(page);
  await card.getByRole('button', { name: 'One replica more' }).click();
  await card.getByRole('button', { name: 'One replica more' }).click();
  await card.getByRole('button', { name: 'Commit to Git' }).click();
  await done(page);
  await expect(card.locator('.k8g-live')).toContainText('5/5 ready');
  await noSideScroll(page);

  // Room 2: the Deployment's own loop replaces a deleted tray.
  await goTo(page, 'try-heal');
  card = active(page);
  await expect(card.locator('.kube-board-want .kube-board-num')).toHaveText('5');
  await card.getByRole('button', { name: /Delete a pod/ }).click();
  await expect(card.locator('.kube-board-do')).toContainText('Make 1 more');
  await done(page);

  // Room 3: ship 1.5.0 through Git.
  await goTo(page, 'try-ship');
  card = active(page);
  await card.getByLabel('Image').selectOption('ghcr.io/kedai-kancil/shop:1.5.0');
  await card.getByRole('button', { name: 'Commit to Git' }).click();
  await done(page);
  await expect(card.locator('.k8g-live')).toContainText('image 1.5.0');

  // Room 4: the real kubectl error, then the fix in Git.
  await goTo(page, 'try-fix');
  card = active(page);
  await card.getByRole('button', { name: 'Apply' }).click();
  await expect(card.locator('.k8g-term')).toContainText('strict decoding error: unknown field "spec.template.spec.contianers"');
  await card.getByLabel('Manifest shop.yaml').fill(FIXED);
  await card.getByRole('button', { name: 'Apply' }).click();
  await expect(card.locator('.k8g-term')).toContainText('deployment.apps/shop created');
  await done(page);

  // Room 5: self-heal off, so drift stays until Sync.
  await goTo(page, 'try-drift');
  card = active(page);
  await card.getByRole('button', { name: /kubectl scale deployment shop --replicas=1 -n shop/ }).click();
  await expect(card.locator('.k8g-log')).toContainText('Self-heal is off.', { timeout: 10_000 });
  await expect(card.locator('.k8g-badges')).toContainText('OutOfSync');
  await card.getByRole('button', { name: 'Sync now' }).click();
  await done(page);
  await expect(card.locator('.k8g-live')).toContainText('5/5 ready');
  await noSideScroll(page);
});

test('K7.4 (BM): be the GitOps helper — spot the drift, apply the file back', async ({ page }) => {
  await page.goto('/ms/kubernetes/self-driving/self-heal-drift/');
  await goTo(page, 'try-catch');
  const card = active(page);
  await expect(card.locator('.kube-here')).toContainText('kind-dev');
  const input = card.locator('input[data-terminal-input]');
  await input.fill('kubectl get deployment shop');
  await input.press('Enter');
  await expect(card.locator('.kube-term, .terminal').first()).toContainText('1/1');
  await input.fill('kubectl apply -f shop.yaml');
  await input.press('Enter');
  await done(page);
  await noSideScroll(page);
});

test('K7.2 and K7.7: tap the YAML lines that matter', async ({ page }) => {
  await page.goto(`${BASE}/argo-or-flux/`);
  await goTo(page, 'see-argo');
  let card = active(page);
  await card.locator('.spot-line', { hasText: 'repoURL: https://github.com/you/gitops.git' }).click();
  await card.locator('.spot-line', { hasText: 'path: apps/kedai-kancil' }).click();
  await done(page);
  await noSideScroll(page);

  await page.goto(`${BASE}/progressive-delivery/`);
  await goTo(page, 'see-rollout');
  card = active(page);
  await card.locator('.spot-line', { hasText: 'setWeight: 20' }).click();
  await card.locator('.spot-line', { hasText: 'setWeight: 50' }).click();
  await done(page);
});

test('K7.8: the cluster has never heard of an Application (the real CRD error)', async ({ page }) => {
  await page.goto(`${BASE}/crds-operators/`);
  await goTo(page, 'hook');
  await expect(active(page)).toContainText('no matches for kind "Application" in version "argoproj.io/v1alpha1"', { timeout: 15_000 });
  await expect(active(page)).toContainText('ensure CRDs are installed first');
});

test('ship-it rescue: the 15 Kubernetes flows (12 + 3 K9 node flows), safe steps first, GitOps undo in Git', async ({ page }) => {
  await page.goto('/en/ship-it/rescue/#k8s-rollout-stuck');
  await expect(page.locator('[data-rescue-group="kubernetes"] [data-rescue-flow]')).toHaveCount(15);
  const step = page.locator('[data-rescue-step]');
  await step.getByRole('button', { name: 'ImagePullBackOff or CrashLoopBackOff' }).click();
  await step.getByRole('button', { name: 'Yes', exact: true }).click();
  await expect(step).toContainText('git revert <bad-commit>');
  await expect(step.getByRole('link', { name: 'Self-heal and drift' })).toHaveAttribute('href', '/en/kubernetes/self-driving/self-heal-drift/');

  await page.goto('/ms/ship-it/rescue/');
  await page.locator('[data-rescue-filter]').fill('OOMKilled');
  await expect(page.locator('[data-rescue-flow]:visible')).toHaveCount(1);
  await page.locator('[data-rescue-flow="k8s-oomkilled"]').click();
  const ms = page.locator('[data-rescue-step]');
  await ms.getByRole('button', { name: 'Ia perlukan banyak sejak awal' }).click();
  await ms.getByRole('button', { name: 'Ya', exact: true }).click();
  await expect(page.locator('.rescue-result')).toContainText('limits:');
  await expect(page.locator('.rescue-result')).toContainText('kubectl apply -f <file>.yaml --dry-run=server');
  await noSideScroll(page);
});
