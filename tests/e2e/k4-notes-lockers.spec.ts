// Kubernetes World K4 (Notes, Lockers & Packages): finish the simulator cards, the games and the
// three-kitchens boss, EN and BM. Runs on both projects (360 px phone and desktop).
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';

const BASE = '/en/kubernetes/notes-lockers-packages';

for (const path of [`${BASE}/pv-pvc/#c=try-survive`, `${BASE}/boss/#c=try-fix`, '/ms/kubernetes/notes-lockers-packages/deprecations-kyaml/#c=see-kyaml']) {
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
const exact = (text: string) => new RegExp(`^\\s*${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`);

async function noSideScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

async function choose(page: Page, text: string, exactName = false) {
  if (exactName) await active(page).getByRole('button', { name: text, exact: true }).click();
  else await active(page).locator('.choice-btn', { hasText: text }).click();
  await expect(active(page).locator('.feedback-right')).toBeVisible();
}

async function type(page: Page, command: string) {
  const input = active(page).locator('.term-input');
  await input.click();
  await input.fill(command);
  await page.keyboard.press('Enter');
}

async function sort(card: Locator, items: [string, string][]) {
  for (const [label, bucket] of items) {
    await card.locator('.sort-card', { hasText: label }).click();
    await card.locator('.sort-bucket-head', { hasText: exact(bucket) }).click();
  }
}

test('K4.1 a ConfigMap: pin it up, read it two ways, sort the facts', async ({ page }) => {
  await page.goto(`${BASE}/configmaps/`);
  await goTo(page, 'try-create');
  await type(page, 'kubectl create configmap settings --from-literal=GREETING=Hai');
  await type(page, 'kubectl apply -f shop.yaml');
  await done(page);
  await goTo(page, 'try-read');
  await type(page, 'kubectl exec deploy/shop -- printenv GREETING');
  await type(page, 'kubectl exec deploy/shop -- cat /etc/notes/GREETING');
  await done(page);
  await expect(active(page).locator('.term')).toContainText('Selamat datang');
  await noSideScroll(page);
  await goTo(page, 'predict');
  await choose(page, 'The file changes. The env var stays old.');
  await goTo(page, 'check-sort');
  await sort(active(page), [
    ['Read once, when the box starts', 'Env var'],
    ['Catches up after a short wait', 'File from a volume'],
    ['printenv GREETING shows it', 'Env var'],
    ['cat /etc/notes/GREETING shows it', 'File from a volume'],
  ]);
  await done(page);
});

test('K4.2 a Secret: the till gets its password; the hand-written Secret is fixed', async ({ page }) => {
  await page.goto(`${BASE}/secrets/`);
  await goTo(page, 'try-till');
  await type(page, 'kubectl create secret generic till --from-literal=PASSWORD=sup3r-rahsia');
  await type(page, 'kubectl apply -f till.yaml');
  await expect(active(page).locator('.kube-tray-ready')).toHaveCount(1, { timeout: 30_000 });
  await type(page, 'kubectl exec deploy/till -- printenv PASSWORD');
  await done(page);
  await goTo(page, 'try-fix');
  const card = active(page);
  await card.getByRole('button', { name: 'Apply' }).click();
  await expect(card.locator('.k8g-term')).toContainText('illegal base64 data at input byte 8');
  await card.getByLabel('Manifest secret.yaml').fill('apiVersion: v1\nkind: Secret\nmetadata:\n  name: spice-box\ntype: Opaque\nstringData:\n  password: kancil123\n');
  await card.getByRole('button', { name: 'Apply' }).click();
  await expect(card.locator('.k8g-term')).toContainText('secret/spice-box created');
  await done(page);
});

test('K4.4 emptyDir (BM): the helper sees the cook’s onions', async ({ page }) => {
  await page.goto('/ms/kubernetes/notes-lockers-packages/emptydir/');
  await goTo(page, 'try-share');
  await type(page, 'kubectl exec deploy/prep -c cook -- touch /table/onions.txt');
  await type(page, 'kubectl exec deploy/prep -c helper -- ls /table');
  await done(page);
  await expect(active(page).locator('.term')).toContainText('onions.txt');
  await noSideScroll(page);
});

test('K4.5 a locker: the claim binds, and the order outlives the pod', async ({ page }) => {
  await page.goto(`${BASE}/pv-pvc/`);
  await goTo(page, 'try-bind');
  await type(page, 'kubectl apply -f claim.yaml');
  await type(page, 'kubectl apply -f cashier.yaml');
  await expect(active(page).locator('.kube-tray-ready')).toHaveCount(1, { timeout: 30_000 });
  await type(page, 'kubectl get pvc');
  await done(page);
  await expect(active(page).locator('.term')).toContainText('Bound');
  await goTo(page, 'try-survive');
  await type(page, 'kubectl delete pod cashier');
  await type(page, 'kubectl apply -f cashier.yaml');
  await expect(active(page).locator('.kube-tray-ready')).toHaveCount(1, { timeout: 30_000 });
  await type(page, 'kubectl exec cashier -- cat /data/orders.txt');
  await done(page);
  await expect(active(page).locator('.term')).toContainText('nasi lemak x2');
});

test('K4.8 Kustomize: preview prod, then open it with apply -k', async ({ page }) => {
  await page.goto(`${BASE}/kustomize/`);
  await goTo(page, 'try-build');
  await type(page, 'kubectl kustomize overlays/prod');
  await done(page);
  await goTo(page, 'predict');
  await choose(page, 'None');
  await goTo(page, 'try-apply');
  await type(page, 'kubectl apply -k overlays/prod');
  await done(page);
  await expect(active(page).locator('.kube-tray-ready')).toHaveCount(3);
  await noSideScroll(page);
});

test('K4 boss: three kitchens, a fixed note, and prod as the "you are here" zone', async ({ page }) => {
  await page.goto(`${BASE}/boss/`);
  await goTo(page, 'try-dev');
  await type(page, 'kubectl kustomize overlays/dev');
  await type(page, 'kubectl apply -k overlays/dev');
  await done(page);
  await goTo(page, 'try-fix');
  const card = active(page);
  await card.getByRole('button', { name: 'Apply' }).click();
  await expect(card.locator('.k8g-term')).toContainText('cannot unmarshal bool into Go struct field ConfigMap.data of type string');
  await card.getByLabel('Manifest settings-patch.yaml').fill('apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: settings\ndata:\n  LOG_LEVEL: info\n  CACHE: "true"\n');
  await card.getByRole('button', { name: 'Apply' }).click();
  await expect(card.locator('.k8g-term')).toContainText('configmap/settings created');
  await done(page);
  await goTo(page, 'try-staging-prod');
  await type(page, 'kubectl apply -k overlays/staging');
  await type(page, 'kubectl apply -k overlays/prod');
  await done(page);
  await goTo(page, 'check-level');
  await choose(page, 'info', true);
  await goTo(page, 'try-where');
  await type(page, 'kubectl config set-context --current --namespace=prod');
  await expect(active(page).locator('.kube-here')).toContainText('prod');
  await type(page, 'kubectl get pods');
  await done(page);
  await noSideScroll(page);
});
