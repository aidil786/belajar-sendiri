// `npm run deploy:dry`: check the Cloudflare Pages setup without deploying (no token needed).
// wrangler.jsonc must point Pages at dist/, and dist/ must hold a deployable site.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const fail = (msg) => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};
// wrangler.jsonc allows comments; drop whole-line // comments before parsing.
const config = JSON.parse(readFileSync('wrangler.jsonc', 'utf8').replace(/^\s*\/\/.*$/gm, ''));
if (!config.name) fail('wrangler.jsonc has no "name" (the Pages project, e.g. belajarsendiri).');
// The address is <name>.pages.dev, so the name must be plain: lowercase letters, digits and dashes.
if (!/^[a-z0-9-]{1,58}$/.test(config.name)) fail(`wrangler.jsonc "name" ${config.name} is not a valid Pages project name.`);
if (!config.pages_build_output_dir) fail('wrangler.jsonc has no "pages_build_output_dir".');
const dir = config.pages_build_output_dir;
for (const f of ['index.html', '404.html', 'en/index.html', 'ms/index.html', '_headers']) {
  if (!existsSync(join(dir, f))) fail(`${dir}/${f} is missing. Run the build first.`);
}
// The build fills the Content-Security-Policy (scripts/csp-headers.mjs); never ship the placeholder.
if (/__CSP_[A-Z_]+__/.test(readFileSync(join(dir, '_headers'), 'utf8'))) fail(`${dir}/_headers still has a __CSP_…__ placeholder. Use npm run build.`);
// Pages limits (free plan): 20,000 files per deployment, 25 MiB per file.
let files = 0;
let biggest = { path: '', size: 0 };
const walk = (d) => {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) walk(p);
    else {
      files++;
      const size = statSync(p).size;
      if (size > biggest.size) biggest = { path: p, size };
    }
  }
};
walk(dir);
if (files > 20000) fail(`${files} files: Pages allows 20,000 per deployment.`);
if (biggest.size > 25 * 1024 * 1024) fail(`${biggest.path} is over 25 MiB.`);
console.log(`✓ Pages project "${config.name}" → https://${config.name}.pages.dev`);
console.log(`✓ ${dir}: ${files} files, largest ${(biggest.size / 1024).toFixed(0)} KiB (${biggest.path})`);
