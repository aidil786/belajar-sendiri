// Ship It · the six Kubernetes games on the hidden test page /<lang>/dev/interactives/.
// Demo props live in src/lib/k8sDemos.ts.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const PAGE = '/en/dev/interactives/';
const DEMOS = [
  'k8s-sched',
  'k8s-labels',
  'k8s-template',
  'k8s-trace',
  'k8s-trace-fix',
  'k8s-doctor',
  'k8s-doctor-typo',
  'k8s-rbac',
  'k8s-rbac-predict',
  'k8s-mirror',
  'k8s-mirror-drift',
];

async function open(page: Page, id: string) {
  const demo = page.locator(`[data-demo="${id}"]`);
  await demo.scrollIntoViewIfNeeded();
  await expect(demo.locator('astro-island[ssr]')).toHaveCount(0); // hydrated
  return demo;
}

test.describe('Kubernetes games', () => {
  test('SchedulerTetris: locks, keys, full stalls and the real scheduler message', async ({
    page,
  }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'k8s-sched');
    const place = async (pod: string, node: string) => {
      await demo
        .getByRole('button', { name: new RegExp(`^${pod}\\b`) })
        .first()
        .click();
      await demo
        .getByRole('button', { name: node === 'pending' ? `Leave ${pod} Pending` : `Put ${pod} on ${node}` })
        .click();
    };
    // A lock with no key: kind feedback, the scheduler's own words.
    await place('tray-1', 'stall-c');
    await expect(demo.locator('.feedback-almost')).toContainText(
      'stall-c has a lock (dedicated=gpu:NoSchedule). tray-1 has no key for it.',
    );
    await expect(demo.locator('.k8g-term')).toContainText('node(s) had untolerated taint(s)');
    await expect(demo).toHaveAttribute('data-wrong', '1');
    await place('tray-1', 'stall-a');
    // Not enough room left on stall-a.
    await place('tray-2', 'stall-a');
    await expect(demo.locator('.feedback-almost')).toContainText(
      'stall-a has 500m CPU free. tray-2 needs 1.',
    );
    await expect(demo.locator('.k8g-term')).toContainText('Insufficient cpu');
    await place('tray-2', 'stall-b');
    // Pending is only for trays that fit nowhere.
    await demo.getByRole('button', { name: /^tray-3\b/ }).click();
    await demo.getByRole('button', { name: 'Leave tray-3 Pending' }).click();
    await expect(demo.locator('.feedback-almost')).toContainText(
      'tray-3 still fits on stall-a, stall-b.',
    );
    await place('tray-3', 'stall-a');
    // Without a key, gpu-job fits nowhere, so Pending is right for now.
    await place('gpu-job', 'pending');
    await expect(demo.locator('.feedback-right')).toContainText(
      'gpu-job fits on no stall, so it stays Pending.',
    );
    // Hand gpu-job the key (tap the key, then the tray), and it fits on the GPU stall.
    await demo
      .getByRole('button', { name: /dedicated=gpu:NoSchedule/ })
      .first()
      .click();
    await demo.locator('.k8g-pending .k8g-tray', { hasText: 'gpu-job' }).click();
    await expect(demo.locator('.k8g-pending .k8g-tray', { hasText: 'gpu-job' })).toContainText(
      'dedicated=gpu:NoSchedule',
    );
    await demo.getByRole('button', { name: 'Take gpu-job back' }).click();
    await place('gpu-job', 'stall-c');
    // The giant fits nowhere: ask the scheduler, then leave it Pending.
    await demo.getByRole('button', { name: /^giant\b/ }).click();
    await demo.getByRole('button', { name: 'Ask the scheduler about giant' }).click();
    await expect(demo.locator('.k8g-asked')).toContainText(
      '0/3 nodes are available: 1 Insufficient memory, 1 node(s) had untolerated taint(s), 2 Insufficient cpu. preemption: 0/3 nodes are available: 3 Preemption is not helpful for scheduling.',
    );
    await demo.getByRole('button', { name: 'Leave giant Pending' }).click();
    await expect(demo).toHaveAttribute('data-done', 'true');
    await expect(demo.locator('.feedback-right')).toContainText('Every tray has its place');
  });

  test('LabelMatchmaker: a label makes the Service pick a tray (keyboard only)', async ({
    page,
  }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'k8s-labels');
    await expect(demo.locator('.k8g-owner-count')).toHaveText('Picks 1 trays.');
    await expect(demo.locator('.k8g-term')).toContainText(
      'kubectl get endpointslices -l kubernetes.io/service-name=shop',
    );
    await demo.getByRole('button', { name: 'Check' }).click();
    await expect(demo.locator('.feedback-almost')).toContainText(
      "tray-1 isn't picked yet. It needs tier=web.",
    );
    await demo.locator('.k8g-palette').getByRole('button', { name: 'tier=web' }).focus();
    await page.keyboard.press('Enter');
    await demo.getByRole('button', { name: 'Stick tier=web on tray-1' }).focus();
    await page.keyboard.press('Enter');
    await expect(demo).toHaveAttribute('data-done', 'true');
    await expect(demo.locator('.k8g-pod.is-hit')).toHaveCount(2);
    await expect(demo.locator('.k8g-term')).toContainText(
      /IPv4\s+80\s+10\.244\.\d+\.\d+,10\.244\.\d+\.\d+/,
    );
  });

  test('LabelMatchmaker: no endpoints shows a red warning with an icon', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'k8s-labels');
    await demo.getByRole('button', { name: 'Remove tier=web from tray-2' }).click();
    await expect(demo.locator('.k8g-alert')).toContainText('No endpoints: shop picks no trays');
    await expect(demo.locator('.k8g-alert svg')).toHaveCount(1);
    await expect(demo.locator('.k8g-term')).toContainText(/<unset>\s+<unset>/);
  });

  test('LabelMatchmaker: the Deployment selector must match the template', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'k8s-template');
    await demo.getByRole('button', { name: 'Apply' }).click();
    await expect(demo.locator('.k8g-term')).toContainText(
      'The Deployment "shop" is invalid: spec.template.metadata.labels: Invalid value: {"app":"web"}: `selector` does not match template `labels`',
    );
    await expect(demo.locator('.k8g-plain')).toContainText(
      'Its selector must match the template labels.',
    );
    await demo.locator('.k8g-palette').getByRole('button', { name: 'app=shop' }).click();
    await demo.getByRole('button', { name: 'Stick app=shop on the pod template' }).click();
    await demo.getByRole('button', { name: 'Apply' }).click();
    await expect(demo.locator('.k8g-term')).toContainText('deployment.apps/shop created');
    await expect(demo).toHaveAttribute('data-done', 'true');
    await expect(demo.locator('.k8g-pod')).toHaveCount(3);
  });

  test('RequestTracer: break a hop to get a 503, with the evidence', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'k8s-trace');
    await demo.getByRole('button', { name: 'Send request' }).click();
    await expect(demo.locator('.k8g-outcome')).toContainText('HTTP/1.1 200 OK', { timeout: 5000 });
    await expect(demo.locator('.feedback-almost')).toContainText(
      'That gave 200 OK. We want 503 Service Unavailable.',
    );
    await demo.getByRole('button', { name: 'Ask for /menu' }).click();
    await demo.getByRole('button', { name: 'Send request' }).click();
    // /menu still matches the "/" rule, so it reaches the web pod.
    await expect(demo.locator('.k8g-outcome')).toContainText(
      'curl -i -m 5 http://kedai.example/menu',
    );
    await demo.getByRole('button', { name: 'Ask for /menu' }).click();
    await demo.getByRole('button', { name: 'Use port 8080' }).click();
    await demo.getByRole('button', { name: /Send/ }).click();
    await expect(demo.locator('.k8g-outcome')).toContainText(
      "curl: (7) Failed to connect to kedai.example port 8080 after 0 ms: Couldn't connect to server",
    );
    await demo.getByRole('button', { name: 'Use port 8080' }).click();
    await demo.getByRole('button', { name: 'Pods not ready' }).click();
    await demo.getByRole('button', { name: /Send/ }).click();
    await expect(demo.locator('.k8g-outcome')).toContainText('HTTP/1.1 503 Service Unavailable');
    await expect(demo.locator('.k8g-outcome')).toContainText('kubectl get pods -l app=api');
    await expect(demo.locator('.k8g-hop.is-fail')).toContainText('EndpointSlice');
    await expect(demo).toHaveAttribute('data-done', 'true');
  });

  test('RequestTracer: step hop by hop, then fix the targetPort', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'k8s-trace-fix');
    const step = demo.getByRole('button', { name: 'Step' });
    await step.click();
    await expect(demo.locator('.k8g-hop').nth(0)).toHaveClass(/is-wait/);
    for (let i = 0; i < 5; i++) await step.click();
    await expect(demo.locator('.k8g-hop').nth(5)).toHaveClass(/is-fail/);
    await expect(demo.locator('.k8g-plain')).toContainText(
      'The Service sends to port 9090, but the pod listens on 3000.',
    );
    await expect(demo.locator('.k8g-outcome')).toContainText(/IPv4\s+9090/);
    await demo.getByRole('button', { name: 'targetPort 9090' }).click();
    await demo.getByRole('button', { name: 'Send request' }).click();
    await expect(demo).toHaveAttribute('data-done', 'true', { timeout: 5000 });
    await expect(demo.locator('.k8g-hop.is-ok')).toHaveCount(6);
  });

  test('YamlDoctor: the real kubectl error, the line marked, fixed with one space', async ({
    page,
  }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'k8s-doctor');
    await demo.getByRole('button', { name: 'Apply' }).click();
    await expect(demo.locator('.k8g-term')).toContainText('$ kubectl apply -f tray.yaml');
    await expect(demo.locator('.k8g-term')).toContainText(
      "error: error parsing tray.yaml: error converting YAML to JSON: yaml: line 8: did not find expected '-' indicator",
    );
    await expect(demo.locator('.k8g-plain')).toContainText(
      'Line 9 is not lined up with the list item above it.',
    );
    await expect(demo.locator('.k8g-eline.is-bad .k8g-enum')).toContainText('9');
    // Put the caret on line 9 and add one space.
    const box = demo.getByLabel('Manifest tray.yaml');
    await box.evaluate((el: HTMLTextAreaElement) => {
      const at = el.value.split('\n').slice(0, 8).join('\n').length + 1;
      el.focus();
      el.setSelectionRange(at, at);
    });
    await demo.getByRole('button', { name: 'Add a space' }).click();
    await expect(box).toHaveValue(/\n {6}ports:\n/);
    await demo.getByRole('button', { name: 'Apply' }).click();
    await expect(demo.locator('.k8g-term')).toContainText('pod/tray created');
    await expect(demo).toHaveAttribute('data-done', 'true');
  });

  test('YamlDoctor: deleting the problem is not a fix', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'k8s-doctor');
    await demo.getByRole('button', { name: 'Hint' }).click();
    await expect(demo.locator('.k8g-hint')).toContainText('Line up ports: with image:');
    await demo
      .getByLabel('Manifest tray.yaml')
      .fill(
        'apiVersion: v1\nkind: Pod\nmetadata:\n  name: tray\nspec:\n  containers:\n    - name: web\n      image: nginx:1.29-alpine\n',
      );
    await demo.getByRole('button', { name: 'Apply' }).click();
    await expect(demo.locator('.k8g-term')).toContainText('pod/tray created');
    await expect(demo.locator('.feedback-almost')).toContainText(
      'Fix the mistake instead of deleting it.',
    );
    await expect(demo).not.toHaveAttribute('data-done', 'true');
  });

  test('YamlDoctor: a misspelt field', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'k8s-doctor-typo');
    await demo.getByRole('button', { name: 'Apply' }).click();
    await expect(demo.locator('.k8g-term')).toContainText(
      'Error from server (BadRequest): error when creating "shop.yaml": Deployment in version "v1" cannot be handled as a Deployment: strict decoding error: unknown field "spec.template.spec.contianers"',
    );
    await expect(demo.locator('.k8g-plain')).toContainText(
      "Kubernetes doesn't know the field contianers.",
    );
    const box = demo.getByLabel('Manifest shop.yaml');
    await box.fill((await box.inputValue()).replace('contianers', 'containers'));
    await demo.getByRole('button', { name: 'Apply' }).click();
    await expect(demo.locator('.k8g-term')).toContainText('deployment.apps/shop created');
    await expect(demo).toHaveAttribute('data-done', 'true');
  });

  test('RbacSwitchboard: give the CI bot only what it needs', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'k8s-rbac');
    const qs = demo.locator('.k8g-q');
    await expect(qs.nth(1)).toContainText(
      'kubectl auth can-i get secrets -n shop --as=system:serviceaccount:ci:ci-bot',
    );
    await expect(qs.nth(1).locator('.k8g-chip')).toHaveText(/yes/);
    // A Role only works in its own namespace.
    await demo.getByLabel('Role', { exact: true }).selectOption({ label: 'Role deployer (shop)' });
    await demo
      .getByLabel('Where')
      .first()
      .selectOption({ label: 'everywhere (ClusterRoleBinding)' });
    await demo.getByRole('button', { name: 'Connect' }).click();
    await expect(demo.locator('.feedback-almost')).toContainText(
      'A Role works only in its own namespace.',
    );
    await demo.getByRole('button', { name: 'Unplug ci-bot-everything' }).click();
    await expect(qs.nth(0).locator('.k8g-chip')).toHaveText(/no/);
    await demo.getByLabel('Where').first().selectOption({ label: 'in namespace shop' });
    await demo.getByRole('button', { name: 'Connect' }).click();
    await expect(demo).toHaveAttribute('data-done', 'true');
    await expect(qs.nth(0)).toContainText('Allowed by ci-bot-deployer → deployer.');
    await demo.getByText('Show ci-bot-deployer as YAML').click();
    await expect(demo.locator('.k8g-wire .k8g-yaml')).toContainText('kind: RoleBinding');
  });

  test('RbacSwitchboard: predict yes or no', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'k8s-rbac-predict');
    const q = (i: number) => demo.locator('.k8g-q').nth(i);
    await q(0).getByRole('button', { name: 'Yes' }).click();
    await expect(q(0).locator('.k8g-chip')).toHaveText(/yes/);
    await q(1).getByRole('button', { name: 'Yes' }).click();
    await expect(demo.locator('.feedback-almost')).toContainText('Kubernetes says no here.');
    // Kind feedback, then a retry.
    await q(1).getByRole('button', { name: 'No' }).click();
    await expect(q(1).locator('.k8g-chip')).toHaveText(/no/);
    await q(2).getByRole('button', { name: 'Yes' }).click();
    await expect(demo).toHaveAttribute('data-done', 'true');
    await demo.getByText('Ask your own question').click();
    await demo.locator('.k8g-own').getByLabel('Resource').selectOption('nodes');
    await expect(demo.locator('.k8g-own .k8g-term')).toContainText(
      "Warning: resource 'nodes' is not namespace scoped",
    );
  });

  test('GitOpsMirror: one line in Git, and the cluster follows', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'k8s-mirror');
    await expect(demo.locator('.k8g-badges')).toContainText('Synced');
    await demo.getByRole('button', { name: 'One replica more' }).click();
    await demo.getByRole('button', { name: 'One replica more' }).click();
    await demo.getByRole('button', { name: 'Commit to Git' }).click();
    await expect(demo.locator('.k8g-log')).toContainText('Commit');
    await expect(demo).toHaveAttribute('data-done', 'true', { timeout: 8000 });
    await expect(demo.locator('.k8g-log')).toContainText('OutOfSync');
    await expect(demo.locator('.k8g-log')).toContainText('Healthy');
    await expect(demo.locator('.k8g-live')).toContainText('5/5 ready');
    await expect(demo.locator('.k8g-mini-tray')).toHaveCount(5);
  });

  test('GitOpsMirror: drift stays without self-heal, until Sync', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'k8s-mirror-drift');
    await demo
      .getByRole('button', { name: /kubectl scale deployment shop --replicas=1 -n shop/ })
      .click();
    await expect(demo.locator('.k8g-log')).toContainText('Self-heal is off.', { timeout: 5000 });
    await expect(demo.locator('.k8g-badges')).toContainText('OutOfSync');
    await expect(demo.locator('.k8g-live')).toContainText('1/1 ready');
    await demo.getByRole('button', { name: 'Sync now' }).click();
    await expect(demo).toHaveAttribute('data-done', 'true', { timeout: 8000 });
    await expect(demo.locator('.k8g-live')).toContainText('3/3 ready');
  });

  test('GitOpsMirror: pause and step through self-heal', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'k8s-mirror-drift');
    await demo.getByRole('button', { name: 'Pause' }).click();
    await demo.getByRole('switch', { name: 'Self-heal' }).click();
    await expect(demo.getByRole('switch', { name: 'Self-heal' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await demo.getByRole('button', { name: /kubectl scale/ }).click();
    await expect(demo.locator('.k8g-next')).toContainText('Argo CD compares Git with the cluster');
    const step = demo.getByRole('button', { name: 'Step' });
    await step.click();
    await expect(demo.locator('.k8g-log')).toContainText('Self-heal is on');
    await step.click();
    await step.click();
    await step.click();
    await expect(demo).toHaveAttribute('data-done', 'true');
    await expect(demo.locator('.k8g-live')).toContainText('3/3 ready');
  });

  test('calm mode: results without animation', async ({ page }) => {
    await page.addInitScript(() =>
      localStorage.setItem('fahamlah:v1', JSON.stringify({ v: 1, settings: { calm: true } })),
    );
    await page.goto(PAGE);
    const trace = await open(page, 'k8s-trace-fix');
    await trace.getByRole('button', { name: 'Send request' }).click();
    await expect(trace.locator('.k8g-outcome')).toContainText('HTTP/1.1 503 Service Unavailable');
    const mirror = await open(page, 'k8s-mirror');
    await mirror.getByRole('button', { name: 'One replica more' }).click();
    await mirror.getByRole('button', { name: 'Commit to Git' }).click();
    await expect(mirror.locator('.k8g-live')).toContainText('4/4 ready');
  });

  test('BM page uses Malay UI text', async ({ page }) => {
    await page.goto('/ms/dev/interactives/');
    const sched = await open(page, 'k8s-sched');
    await expect(sched.getByText('Dulang menunggu')).toBeVisible();
    const doctor = await open(page, 'k8s-doctor');
    await doctor.getByRole('button', { name: 'Apply' }).click();
    await expect(doctor.locator('.k8g-plain')).toContainText(
      'Baris 9 tidak sejajar dengan item senarai di atasnya.',
    );
    const rbac = await open(page, 'k8s-rbac');
    await expect(rbac.getByRole('button', { name: 'Sambung' })).toBeVisible();
    const mirror = await open(page, 'k8s-mirror');
    await expect(mirror.getByRole('button', { name: 'Commit ke Git' })).toBeVisible();
  });

  test('no horizontal scroll at 360px', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    for (const path of [PAGE, '/ms/dev/interactives/']) {
      await page.goto(path);
      for (const id of DEMOS) await open(page, id);
      // Open some inner states too.
      await page.locator('[data-demo="k8s-doctor"]').getByRole('button', { name: 'Apply' }).click();
      await page
        .locator('[data-demo="k8s-trace"]')
        .getByRole('button', { name: /Send|Hantar/ })
        .first()
        .click();
      await page.locator('[data-demo="k8s-sched"] .k8g-tray').first().click();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
  });

  for (const theme of ['light', 'dark'] as const) {
    for (const path of [PAGE, '/ms/dev/interactives/']) {
      test(`axe ${theme}: Kubernetes games on ${path}`, async ({ page }) => {
        await page.addInitScript((t) => {
          localStorage.setItem('fahamlah:v1', JSON.stringify({ v: 1, settings: { theme: t } }));
        }, theme);
        await page.goto(path);
        for (const id of DEMOS) await open(page, id);
        // Inner states: errors, outcomes, picked items, open details.
        await page.locator('[data-demo="k8s-doctor"] .k8g-apply').click();
        await page.locator('[data-demo="k8s-template"] .k8g-apply').click();
        await page.locator('[data-demo="k8s-sched"] .k8g-tray').first().click();
        await page.locator('[data-demo="k8s-labels"] .k8g-label-btn').first().click();
        await page.locator('[data-demo="k8s-trace-fix"] .k8g-row .btn').first().click();
        await page.locator('[data-demo="k8s-rbac"] .k8g-own > summary').click();
        await page.locator('[data-demo="k8s-mirror-drift"] .k8g-drift .btn').click();
        await expect(page.locator('[data-demo="k8s-trace-fix"] .k8g-outcome')).toBeVisible({
          timeout: 5000,
        });
        await expect(page.locator('[data-demo="k8s-mirror-drift"] .k8g-log')).toContainText(
          // Wait until the clock has finished, so nothing moves while axe measures.
          /Self-heal is off|Self-heal mati/,
          { timeout: 5000 },
        );
        const results = await new AxeBuilder({ page })
          .include('[data-demo^="k8s-"]')
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
          .analyze();
        const bad = results.violations.filter(
          (v) => v.impact === 'serious' || v.impact === 'critical',
        );
        expect(
          bad.map(
            (v) =>
              `${v.id}: ${v.nodes.map((n) => `${n.target.join(' ')} (${n.failureSummary ?? ''})`).join(', ')}`,
          ),
        ).toEqual([]);
      });
    }
  }
});
