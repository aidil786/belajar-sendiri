// Make the app icons (PWA manifest + home screen) from Kancil, our original mouse deer.
// Run: PW_CHROMIUM_PATH=/path/to/chromium npm run icons
// Writes public/icons/*.png and kancil.svg. Commit the results.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

// Colours from src/styles/tokens.css (light theme): --mascot-* and --c-repo-soft.
const C = { fur: '#a8703f', furDark: '#6e4a2b', light: '#f6e7d2', ink: '#2a1d14', bg: '#dcfce7' };

// Same shapes as src/components/ui/Mascot.astro (idle mood), drawn in a 120×120 box.
const kancil = `
  <ellipse cx="62" cy="78" rx="30" ry="18" fill="${C.fur}"/>
  <path d="M44 92 L42 112 M52 94 L52 112 M74 94 L76 112 M82 91 L86 111" fill="none" stroke="${C.furDark}" stroke-width="4" stroke-linecap="round"/>
  <path d="M91 72 q8 -4 6 -10" fill="none" stroke="${C.furDark}" stroke-width="4" stroke-linecap="round"/>
  <path d="M40 72 Q34 54 42 42" fill="none" stroke="${C.fur}" stroke-width="14" stroke-linecap="round"/>
  <ellipse cx="44" cy="40" rx="17" ry="13" fill="${C.fur}"/>
  <ellipse cx="29" cy="46" rx="8" ry="6" fill="${C.light}"/>
  <circle cx="23.5" cy="45" r="2.4" fill="${C.ink}"/>
  <ellipse cx="52" cy="24" rx="5" ry="10" transform="rotate(18 52 24)" fill="${C.fur}"/>
  <ellipse cx="52" cy="25" rx="2.4" ry="6" transform="rotate(18 52 25)" fill="${C.light}"/>
  <ellipse cx="60" cy="86" rx="18" ry="7" fill="${C.light}"/>
  <circle cx="42" cy="37" r="4.2" fill="${C.ink}"/>
  <circle cx="43.2" cy="35.8" r="1.4" fill="${C.light}"/>
  <path d="M27 52 q4 3 8 0" fill="none" stroke="${C.ink}" stroke-width="2.6" stroke-linecap="round"/>`;

// The drawing's centre in its 120 box (it spans about x 21–99, y 14–113).
const CX = 60;
const CY = 63.5;

/** One square icon. `scale` is how big Kancil is; maskable icons keep him inside the safe circle. */
function icon(size: number, scale: number, rounded: boolean): string {
  const s = (scale * size) / 512;
  const tx = size / 2 - CX * s;
  const ty = size / 2 - CY * s + size * 0.01;
  const r = rounded ? size * 0.22 : 0;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${r}" fill="${C.bg}"/>
  <g transform="translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${s.toFixed(4)})">${kancil}
  </g>
</svg>
`;
}

const out = join(process.cwd(), 'public', 'icons');
mkdirSync(out, { recursive: true });
const jobs = [
  { file: 'icon-192.png', svg: icon(192, 4, true) },
  { file: 'icon-512.png', svg: icon(512, 4, true) },
  { file: 'maskable-512.png', svg: icon(512, 3, false) },
  { file: 'apple-touch-icon.png', svg: icon(180, 3.4, false) },
];
writeFileSync(join(out, 'kancil.svg'), icon(512, 4, true));

const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const job of jobs) {
  const size = Number(/width="(\d+)"/.exec(job.svg)![1]);
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">${job.svg}</body></html>`);
  await page.locator('svg').screenshot({ path: join(out, job.file), omitBackground: true });
  console.log(`wrote public/icons/${job.file}`);
}
await browser.close();
