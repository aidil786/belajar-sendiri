// Level Up · the four AWS games on the hidden test page /<lang>/dev/interactives/.
// Demo props live in src/lib/aws/demos.ts; the rules in src/lib/aws/ (unit-tested with the AWS docs' examples).
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';

const PAGE = '/en/dev/interactives/';
const DEMOS = ['aws-iam-predict', 'aws-iam-role', 'aws-iam-edit', 'aws-subnets', 'aws-subnets-vpc', 'aws-gate-sg', 'aws-gate-nacl', 'aws-idle'];

async function open(page: Page, id: string) {
  const demo = page.locator(`[data-demo="${id}"]`);
  await demo.scrollIntoViewIfNeeded();
  await expect(demo.locator('astro-island[ssr]')).toHaveCount(0); // hydrated
  return demo;
}

const cell = (demo: Locator, legend: string) => demo.locator('fieldset', { has: demo.page().locator('legend', { hasText: legend }) });

test.describe('AWS games', () => {
  test('IamJudge: predict, kind hint, then the guard posts in order', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'aws-iam-predict');
    await expect(demo.locator('.awg-request')).toContainText('s3:PutObject');
    await expect(demo.locator('.awg-request')).toContainText('aws:SecureTransport = false');
    await demo.getByRole('button', { name: 'Allow', exact: true }).click();
    await expect(demo.locator('.feedback-almost')).toContainText('Look for a Deny that fits first. One Deny beats every Allow.');
    await expect(demo).toHaveAttribute('data-wrong', '1');
    await demo.getByRole('button', { name: 'Deny', exact: true }).click();
    await expect(demo).toHaveAttribute('data-done', 'true');
    await expect(demo.locator('.awg-verdict')).toContainText('Deny. A Deny statement said no (explicit deny).');
    await expect(demo.locator('.awg-step').first()).toContainText('tls-only, statement 1 says Deny, and it fits.');
    await expect(demo.locator('.awg-step-cond').first()).toContainText('Bool aws:SecureTransport is false → true');
    // The Deny statement is red with a warning mark; nothing else is highlighted.
    await expect(demo.locator('.awg-code-line.is-deny')).toHaveCount(6);
    await expect(demo.locator('.awg-code-line.is-deny .awg-code-mark').first()).toHaveText('⚠');
  });

  test('IamJudge: a resource policy naming the role still needs the fence', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'aws-iam-role');
    await demo.getByRole('button', { name: 'Deny', exact: true }).click();
    await expect(demo).toHaveAttribute('data-done', 'true');
    // Steps: 0 Deny? 1 SCPs (none) 2 resource policy 3 identity (not needed) 4 fence.
    await expect(demo.locator('.awg-step').nth(2)).toContainText('names the role. The fence still gets a say.');
    await expect(demo.locator('.awg-step').nth(3)).toContainText('Not needed: the resource policy already allows the role.');
    await expect(demo.locator('.awg-step').nth(4)).toContainText('Stop: Deny');
    await expect(demo.locator('.awg-verdict')).toContainText('Deny. Nothing said Allow (implicit deny).');
  });

  test('IamJudge: edit one line, kindly, until AWS says Allow', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'aws-iam-edit');
    const line = demo.getByRole('textbox', { name: 'Line 6 of menu-reader' });
    await expect(line).toHaveValue('"Action": "s3:GetObject",');
    await demo.getByRole('button', { name: 'Check with the AWS rules' }).click();
    await expect(demo.locator('.feedback-almost')).toContainText('AWS says Deny. The goal is Allow.');
    await line.fill('"Action": s3:PutObject,');
    await demo.getByRole('button', { name: 'Check with the AWS rules' }).click();
    await expect(demo.locator('.feedback-almost')).toContainText("That line doesn't read as JSON yet.");
    await line.fill('"Action": "s3:*",');
    await demo.getByRole('button', { name: 'Check with the AWS rules' }).click();
    await expect(demo.locator('.feedback-almost')).toContainText('That works, but it opens too much.');
    await line.fill('"Action": ["s3:GetObject", "s3:PutObject"],');
    await demo.getByRole('button', { name: 'Check with the AWS rules' }).click();
    await expect(demo).toHaveAttribute('data-done', 'true');
    await expect(demo.locator('.awg-verdict')).toContainText('Allow. The door opens.');
    await expect(demo.locator('.feedback-right')).toContainText('AWS now says Allow.');
  });

  test('SubnetPlanner: overlap and size checks, then a plan that meets the brief', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'aws-subnets');
    await expect(demo.locator('.awg-vpc')).toContainText('65,536 addresses in this VPC.');
    await demo.getByRole('button', { name: 'Check the plan' }).click();
    await expect(demo.locator('.feedback-almost')).toContainText('Public · ap-southeast-5b has no subnet yet.');
    const privA = cell(demo, 'Private subnet (the back rooms) · ap-southeast-5a');
    await privA.getByLabel('CIDR').fill('10.0.0.0/24');
    await expect(privA.locator('.awg-mark.is-bad')).toContainText('It overlaps Public · ap-southeast-5a.');
    await expect(demo.locator('.awg-map-block.is-bad')).toHaveCount(2);
    await privA.getByLabel('CIDR').fill('10.0.1.0/28');
    await expect(privA.locator('.awg-mark.is-bad')).toContainText('Only 11 usable. The brief needs 200.');
    // Pick sizes: each lands on the first free block.
    await privA.getByLabel('Size').selectOption('24');
    await expect(privA.getByLabel('CIDR')).toHaveValue('10.0.1.0/24');
    await expect(privA.locator('.awg-mark.is-ok')).toContainText('256 addresses, 251 usable (AWS keeps 5).');
    await cell(demo, 'Private subnet (the back rooms) · ap-southeast-5b').getByLabel('Size').selectOption('24');
    await cell(demo, 'Public subnet (faces the street) · ap-southeast-5b').getByLabel('Size').selectOption('27');
    await expect(cell(demo, 'Public subnet (faces the street) · ap-southeast-5b').getByLabel('CIDR')).toHaveValue('10.0.0.32/27');
    await expect(demo).toHaveAttribute('data-done', 'true');
    await expect(demo.locator('.feedback-right')).toContainText('Every row has its own road, and nothing overlaps.');
    await demo.locator('.awg-peek > summary').click();
    await expect(demo.locator('.awg-peek')).toContainText('10.0.0.31 broadcast (a VPC has no broadcast)');
  });

  test('SubnetPlanner: the VPC must be /16 to /28 first', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'aws-subnets-vpc');
    await expect(demo.locator('.awg-vpc .awg-mark.is-bad')).toContainText('/8 is too big. A VPC is /16 to /28.');
    await demo.getByLabel('VPC CIDR').fill('172.17.0.0/16');
    await expect(demo.locator('.awg-vpc')).toContainText('Some AWS services use 172.17.0.0/16.');
    await demo.getByLabel('VPC CIDR').fill('10.20.0.0/16');
    for (const az of ['ap-southeast-5a', 'ap-southeast-5b', 'ap-southeast-5c'])
      await cell(demo, `Public subnet (faces the street) · ${az}`).getByLabel('Size').selectOption('24');
    await expect(demo).toHaveAttribute('data-done', 'true');
    await expect(cell(demo, 'Public subnet (faces the street) · ap-southeast-5c').getByLabel('CIDR')).toHaveValue('10.20.2.0/24');
  });

  test('SecurityGroupGate: the door lets in HTTPS from anyone, SSH only from your laptop', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'aws-gate-sg');
    await expect(demo.getByText('No In rules yet: nothing gets in.')).toBeVisible();
    await demo.getByRole('button', { name: 'Let them try' }).click();
    await expect(demo.locator('.feedback-almost')).toContainText('Shopper (should get in): Stopped at the door: no rule lets it in.');
    await expect(demo.locator('.awg-track.is-door')).toHaveCount(4);
    // HTTPS 443 from anywhere (the form's defaults).
    await demo.getByRole('button', { name: 'Add rule' }).click();
    // SSH from everywhere is too open.
    await demo.getByLabel('Port or range').fill('22');
    await demo.getByLabel('From (CIDR or group)').fill('0.0.0.0/0');
    await demo.getByRole('button', { name: 'Add rule' }).click();
    await demo.getByRole('button', { name: 'Let them try' }).click();
    await expect(demo.locator('.feedback-almost')).toContainText('Stranger (SSH) (keep out): Got in, and the reply got out.');
    await demo.getByRole('button', { name: 'Remove rule TCP 22 · 0.0.0.0/0' }).click();
    // A single address needs /32.
    await demo.getByLabel('From (CIDR or group)').fill('203.0.113.9');
    await demo.getByRole('button', { name: 'Add rule' }).click();
    await expect(demo.locator('.feedback-almost')).toContainText('Write an address range like 203.0.113.9/32.');
    await demo.getByLabel('From (CIDR or group)').fill('203.0.113.9/32');
    await demo.getByRole('button', { name: 'Add rule' }).click();
    await demo.getByRole('button', { name: 'Let them try' }).click();
    await expect(demo).toHaveAttribute('data-done', 'true');
    await expect(demo.locator('.awg-visitor.is-ok')).toHaveCount(4);
    await expect(demo.locator('.awg-visitor', { hasText: 'Your laptop' })).toContainText('Reply: the door remembers, so it may leave');
  });

  test('SecurityGroupGate: the row gate forgets, so replies need their ephemeral ports', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'aws-gate-nacl');
    await demo.getByRole('button', { name: 'Let them try' }).click();
    await expect(demo.locator('.feedback-almost')).toContainText('Shopper on Windows (should get in): Stopped at the row gate (rule *).');
    // Inbound 100: HTTPS from anywhere (the defaults).
    await demo.getByRole('button', { name: 'Add rule' }).click();
    await demo.getByRole('button', { name: 'Let them try' }).click();
    await expect(demo.locator('.feedback-almost')).toContainText('Got in, but the gate stopped the reply (rule *).');
    // Outbound: only the Windows range first.
    await demo.getByLabel('Direction').selectOption('outbound');
    await expect(demo.getByLabel('Rule number')).toHaveValue('100');
    await demo.getByLabel('Port or range').fill('49152-65535');
    await demo.getByRole('button', { name: 'Add rule' }).click();
    await demo.getByRole('button', { name: 'Let them try' }).click();
    await expect(demo.locator('.feedback-almost')).toContainText('Shopper on Linux (should get in): Got in, but replies to ports 32768–49151 are stopped.');
    await demo.getByLabel('Port or range').fill('32768-65535');
    await demo.getByRole('button', { name: 'Add rule' }).click();
    await demo.getByRole('button', { name: 'Let them try' }).click();
    await expect(demo).toHaveAttribute('data-done', 'true');
    await expect(demo.locator('.awg-visitor', { hasText: 'Port scanner' })).toContainText('Stopped at the row gate (rule *).');
  });

  test('IdleBill: sort one at a time, with the why and the official page', async ({ page }) => {
    await page.goto(PAGE);
    const demo = await open(page, 'aws-idle');
    await expect(demo.locator('.awg-now')).toContainText('1 of 8');
    await expect(demo.locator('.awg-now-name')).toHaveText('NAT gateway with no traffic');
    await demo.getByRole('button', { name: 'Free when idle' }).click();
    await expect(demo.locator('.feedback-almost')).toContainText('It is billed for every hour it exists');
    const answers = ['costs', 'free', 'costs', 'free', 'costs', 'free', 'costs', 'free'];
    for (const a of answers) await demo.getByRole('button', { name: a === 'costs' ? 'Costs money idle' : 'Free when idle' }).click();
    await expect(demo).toHaveAttribute('data-done', 'true');
    await expect(demo.locator('.awg-col.is-costs .awg-sorted-item')).toHaveCount(4);
    await expect(demo.locator('.awg-cleanup li')).toHaveCount(4);
    await expect(demo.locator('.awg-cleanup')).toContainText('Prices change');
    const link = demo.locator('.awg-col.is-costs a', { hasText: 'Pricing for NAT gateways' });
    await expect(link).toHaveAttribute('href', 'https://docs.aws.amazon.com/vpc/latest/userguide/nat-gateway-pricing.html');
    await expect(demo.locator('.awg-cols')).not.toContainText('$');
  });

  test('calm mode: the verdict and the walk show at once, nothing moves', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('fahamlah:v1', JSON.stringify({ v: 1, settings: { calm: true } })));
    await page.goto(PAGE);
    const iam = await open(page, 'aws-iam-predict');
    await iam.getByRole('button', { name: 'Deny', exact: true }).click();
    await expect(iam.locator('.awg-verdict')).toBeVisible({ timeout: 500 });
    await expect(iam.getByRole('button', { name: 'Replay' })).toHaveCount(0);
    const gate = await open(page, 'aws-gate-sg');
    await gate.getByRole('button', { name: 'Let them try' }).click();
    await expect(gate.locator('.awg-track').first()).not.toHaveClass(/can-move/);
    const anim = await gate.locator('.awg-track-line').first().evaluate((el) => getComputedStyle(el).animationName);
    expect(anim).toBe('none');
  });

  test('BM page uses Malay UI text', async ({ page }) => {
    await page.goto('/ms/dev/interactives/');
    const edit = await open(page, 'aws-iam-edit');
    await expect(edit.getByRole('button', { name: 'Semak dengan peraturan AWS' })).toBeVisible();
    const subnets = await open(page, 'aws-subnets');
    await expect(subnets.locator('.awg-vpc')).toContainText('alamat dalam VPC ini.');
    const gate = await open(page, 'aws-gate-sg');
    await expect(gate.getByRole('button', { name: 'Biar mereka cuba' })).toBeVisible();
    const idle = await open(page, 'aws-idle');
    await expect(idle.getByRole('button', { name: 'Kena bayar walau dibiar' })).toBeVisible();
  });

  test('no horizontal scroll at 360px', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    for (const path of [PAGE, '/ms/dev/interactives/']) {
      await page.goto(path);
      for (const id of DEMOS) await open(page, id);
      await page.locator('[data-demo="aws-iam-predict"] .awg-predict .btn').last().click();
      await page.locator('[data-demo="aws-gate-nacl"] .awg-row .btn').last().click();
      await page.locator('[data-demo="aws-subnets"] .awg-peek > summary').click();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
  });

  for (const theme of ['light', 'dark'] as const) {
    for (const path of [PAGE, '/ms/dev/interactives/']) {
      test(`axe ${theme}: AWS games on ${path}`, async ({ page }) => {
        await page.addInitScript((t) => {
          localStorage.setItem('fahamlah:v1', JSON.stringify({ v: 1, settings: { theme: t } }));
        }, theme);
        await page.goto(path);
        for (const id of DEMOS) await open(page, id);
        // Inner states: a revealed verdict, an edit error, checks, walks, a sorted item.
        await page.locator('[data-demo="aws-iam-predict"] .awg-predict .btn').last().click();
        await page.locator('[data-demo="aws-iam-role"] .awg-predict .btn').first().click();
        await page.locator('[data-demo="aws-iam-edit"] .awg-row .btn').first().click();
        await page.locator('[data-demo="aws-subnets"] .awg-row .btn').click();
        await page.locator('[data-demo="aws-subnets"] .awg-peek > summary').click();
        await page.locator('[data-demo="aws-gate-sg"] .awg-row .btn').last().click();
        await page.locator('[data-demo="aws-gate-nacl"] .awg-row .btn').last().click();
        await page.locator('[data-demo="aws-idle"] .awg-say').first().click();
        await page.locator('[data-demo="aws-idle"] .awg-say').last().click();
        await expect(page.locator('[data-demo="aws-iam-predict"] .awg-verdict')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('[data-demo="aws-iam-edit"] .awg-verdict')).toBeVisible({ timeout: 5000 });
        // Let the one-off animations finish before measuring contrast.
        await page.waitForTimeout(1200);
        const results = await new AxeBuilder({ page })
          .include('[data-demo^="aws-"]')
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
          .analyze();
        const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
        expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => `${n.target.join(' ')} (${n.failureSummary ?? ''})`).join(', ')}`)).toEqual([]);
      });
    }
  }
});
