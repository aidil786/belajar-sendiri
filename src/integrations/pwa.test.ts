import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assetRefs, fileFor, fillServiceWorker, latinFonts } from './pwa';

describe('PWA build step', () => {
  it('finds hashed build files in HTML and in JS imports', () => {
    const html = `<link rel="stylesheet" href="/_astro/i18n.CNHBXtts.css"><astro-island component-url="/_astro/Choice.Di_12k4Q.js" renderer-url="/_astro/client.OzTcoKK0.js"><a href="/en/git/">x</a>`;
    expect(assetRefs(html)).toEqual(['/_astro/i18n.CNHBXtts.css', '/_astro/Choice.Di_12k4Q.js', '/_astro/client.OzTcoKK0.js']);
    const js = `import{r as e}from"./react.DvXU6kJ2.js";import"./index.astro_astro_type_script_index_0_lang.OYfC7O5H.js";const x="./not-a-chunk.js";`;
    expect(assetRefs(js)).toEqual(['/_astro/react.DvXU6kJ2.js', '/_astro/index.astro_astro_type_script_index_0_lang.OYfC7O5H.js']);
  });

  it('precaches only the basic Latin fonts', () => {
    const css = `@font-face{src:url(/_astro/lexend-latin-wght-normal.ci0D1wrL.woff2) format("woff2")}@font-face{src:url(/_astro/lexend-latin-ext-wght-normal.B6JQhE1e.woff2)}`;
    expect(latinFonts(css)).toEqual(['/_astro/lexend-latin-wght-normal.ci0D1wrL.woff2']);
  });

  it('fills the build id and file list into the real sw.js template', () => {
    const template = readFileSync('public/sw.js', 'utf8');
    const out = fillServiceWorker(template, 'abc123', ['/', '/en/']);
    expect(out).toContain(`const BUILD = "abc123";`);
    expect(out).toContain(`const PRECACHE = ["/","/en/"];`);
    expect(out).not.toContain('__FAHAMLAH_');
    expect(() => fillServiceWorker('nothing here', 'x', [])).toThrow(/markers/);
  });

  it('maps URLs to files in dist', () => {
    expect(fileFor('/')).toBe('index.html');
    expect(fileFor('/en/review/')).toBe('en/review/index.html');
    expect(fileFor('/manifest.webmanifest')).toBe('manifest.webmanifest');
  });
});
