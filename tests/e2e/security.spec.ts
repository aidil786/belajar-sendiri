// The security headers from dist/_headers (filled in by scripts/csp-headers.mjs) really hold:
// with the same Content-Security-Policy Cloudflare will send, pages and every kind of interactive
// load and run with no policy violation. `astro preview` ignores _headers, so the test adds them
// to each page itself. HSTS is left out here (it only matters on https).
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

function siteHeaders(): Record<string, string> {
  const text = readFileSync('dist/_headers', 'utf8');
  const block = text.split(/\n(?=\S)/).find((b) => b.startsWith('/*\n'));
  if (!block) throw new Error('dist/_headers has no "/*" block: run npm run build');
  const out: Record<string, string> = {};
  for (const line of block.split('\n').slice(1)) {
    const m = /^\s+([A-Za-z-]+):\s*(.+)$/.exec(line);
    if (m) out[m[1]!] = m[2]!;
  }
  return out;
}

const HEADERS = siteHeaders();
delete HEADERS['Strict-Transport-Security'];

async function withSiteHeaders(page: Page) {
  await page.route('**/*', async (route) => {
    const req = route.request();
    if (new URL(req.url()).origin !== new URL(page.url() === 'about:blank' ? req.url() : page.url()).origin) return route.continue();
    const res = await route.fetch();
    await route.fulfill({ response: res, headers: { ...res.headers(), ...HEADERS } });
  });
  await page.addInitScript(() => {
    const w = window as unknown as { __csp: string[] };
    w.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => w.__csp.push(`${e.violatedDirective} ← ${e.blockedURI || 'inline'} (${e.sourceFile}:${e.lineNumber})`));
  });
}

test.use({ serviceWorkers: 'block' });

test('the policy is complete: no unsafe-inline or eval for scripts, no framing, only this site and the GitHub API', () => {
  const csp = HEADERS['Content-Security-Policy'] ?? '';
  const script = /script-src ([^;]+)/.exec(csp)?.[1] ?? '';
  expect(script).toContain("'self'");
  expect(script).not.toContain('unsafe-inline');
  expect(script).not.toContain('unsafe-eval');
  expect(script).not.toContain('__CSP');
  expect(script.match(/'sha256-[A-Za-z0-9+/=]+'/g)?.length ?? 0).toBeGreaterThan(0);
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("object-src 'none'");
  expect(csp).toMatch(/connect-src 'self' https:\/\/api\.github\.com(;|$)/);
  expect(HEADERS['X-Frame-Options']).toBe('DENY');
  expect(HEADERS['X-Content-Type-Options']).toBe('nosniff');
});

const PAGES = [
  '/en/',
  '/ms/',
  '/en/git/',
  '/en/git/save-points/the-box/',
  '/en/settings/',
  '/en/feedback/',
  '/en/rescue/',
  '/en/level-up/rescue/',
  '/en/ship-it/exam/',
  '/en/ship-it/night-shift/',
  '/en/linux/glossary/',
  '/en/dev/interactives/',
];

for (const path of PAGES) {
  test(`no policy violation: ${path}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error' && /Content Security Policy|Refused to/i.test(m.text())) errors.push(m.text());
    });
    await withSiteHeaders(page);
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    // Scroll through so every island (client:visible) hydrates.
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 700) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 40));
      }
    });
    await page.waitForLoadState('networkidle');
    const violations = await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp);
    expect([...violations, ...errors]).toEqual([]);
  });
}

test('a lesson still works under the policy: the terminal runs commands', async ({ page }) => {
  await withSiteHeaders(page);
  await page.goto('/en/git/save-points/the-box/');
  await expect(page.locator('[data-player-root]')).toBeVisible();
  await page.keyboard.press('Enter');
  const violations = await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp);
  expect(violations).toEqual([]);
});
