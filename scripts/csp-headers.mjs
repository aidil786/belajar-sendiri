// After `astro build`: finish the Content-Security-Policy in dist/_headers.
//
// The policy lives in public/_headers so it is easy to read and review. Scripts are only
// allowed from this site, plus the few small inline scripts Astro and our layout write into
// the HTML. Those inline scripts are allowed one by one, by their SHA-256 hash, so a script
// someone manages to inject into a page will not run.
//
// This script:
//   1. hashes every inline <script> in dist (not JSON data blocks, not external files),
//   2. puts the hashes where public/_headers says __CSP_SCRIPT_HASHES__,
//   3. adds the Cloudflare Web Analytics hosts only if the beacon is in the pages,
//   4. fails the build on inline event handlers (onclick="…"), javascript: links, or a
//      header line over Cloudflare's 2,000-character limit.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DIST = 'dist';
const HEADERS = join(DIST, '_headers');
const MAX_LINE = 2000; // Cloudflare Pages: characters per _headers line

function* htmlFiles(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* htmlFiles(p);
    else if (name.endsWith('.html')) yield p;
  }
}

const fail = (msg) => {
  console.error(`✗ csp-headers: ${msg}`);
  process.exit(1);
};

const hashes = new Set();
let pages = 0;
let beacon = false;
const problems = [];
for (const file of htmlFiles(DIST)) {
  pages++;
  const html = readFileSync(file, 'utf8');
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const [, attrs, body] = m;
    if (/\bsrc\s*=/i.test(attrs)) {
      if (/static\.cloudflareinsights\.com/.test(attrs)) beacon = true;
      continue;
    }
    if (/type\s*=\s*["']?application\/(ld\+)?json/i.test(attrs)) continue;
    hashes.add(`'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`);
  }
  // Inline handlers and javascript: URLs cannot be allowed by hashes; keep them out of the site.
  for (const tag of html.match(/<[a-z][^>]*>/gi) ?? []) {
    if (/\son[a-z]+\s*=/i.test(tag)) problems.push(`${file}: inline event handler in ${tag.slice(0, 80)}`);
    if (/\s(href|src|action)\s*=\s*["']?\s*javascript:/i.test(tag)) problems.push(`${file}: javascript: URL in ${tag.slice(0, 80)}`);
  }
}
if (problems.length) fail(`${problems.length} problem(s):\n  ${problems.slice(0, 10).join('\n  ')}`);

let headers = readFileSync(HEADERS, 'utf8');
if (!headers.includes('__CSP_SCRIPT_HASHES__')) fail('dist/_headers has no __CSP_SCRIPT_HASHES__ placeholder (public/_headers changed?)');
headers = headers
  .replace('__CSP_SCRIPT_HASHES__', [...hashes].sort().join(' ') + (beacon ? ' https://static.cloudflareinsights.com' : ''))
  .replace('__CSP_CONNECT_EXTRA__', beacon ? 'https://cloudflareinsights.com' : '')
  .replace(/ +;/g, ';');
const long = headers.split('\n').find((l) => l.length > MAX_LINE);
if (long) fail(`a _headers line has ${long.length} characters (Cloudflare allows ${MAX_LINE}): ${long.slice(0, 60)}…`);
writeFileSync(HEADERS, headers);
console.log(`✓ csp-headers: ${hashes.size} inline script hash(es) from ${pages} pages${beacon ? ', analytics allowed' : ''}.`);
