// Smoke test for every ready lesson and boss of every course, in English and Malay.
// The list comes from each course's course.yaml at test time, so new lessons are covered
// as soon as they turn `ready`. One test per lesson + language, so they run in parallel.
// Desktop runs everything; the phone project runs a small subset (see tags).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { parse } from 'yaml';

type Lang = 'en' | 'ms';
interface Ref {
  id: string;
  slug: string;
  status: string;
}
interface World {
  id: number;
  slug: string;
  lessons: Ref[];
  boss?: { id: string; status: string };
}

// This test checks content and layout, not motion: with reduced motion the card slides,
// confetti and page fades are off, so stepping thousands of cards stays fast.
// tests/e2e/delight.spec.ts checks the animations themselves.
test.use({ reducedMotion: 'reduce' });

const COURSES = 'src/content/courses';
const courses = readdirSync(COURSES)
  .filter((name) => existsSync(`${COURSES}/${name}/course.yaml`))
  .map((name) => parse(readFileSync(`${COURSES}/${name}/course.yaml`, 'utf8')) as { id: string; worlds: World[] });
const dict = (lang: Lang) => JSON.parse(readFileSync(`src/i18n/${lang}.json`, 'utf8')) as Record<string, string>;
const strings = { en: dict('en'), ms: dict('ms') };
/** "Card {n} of {total}" → /Card (\d+) of (\d+)/ */
const cardOf = (lang: Lang) => new RegExp(strings[lang]['lesson.cardOf']!.replace('{n}', '(\\d+)').replace('{total}', '(\\d+)'));

interface Item {
  id: string;
  path: string; // after /<lang>/
  phone: boolean; // also run on the phone project
}

const items: Item[] = courses.flatMap((course) =>
  course.worlds.flatMap((w) => {
    const ready = w.lessons.filter((l) => l.status === 'ready');
    const out: Item[] = ready.map((l, i) => ({ id: l.id, path: `${course.id}/${w.slug}/${l.slug}/`, phone: i === 0 }));
    if (w.boss && w.boss.status === 'ready') out.push({ id: w.boss.id, path: `${course.id}/${w.slug}/boss/`, phone: false });
    return out;
  }),
);

/**
 * One look at the page (one round trip keeps ~300 tests fast): the card counter,
 * islands still asleep on the active card, and the visible text of the active card
 * (or the whole page) plus any visible feedback.
 */
function look(page: Page, scope: 'card' | 'page') {
  return page.evaluate((where) => {
    const card = document.querySelector<HTMLElement>('.lesson-card.is-active');
    const root = where === 'card' ? card : document.body;
    const feedback = [...document.querySelectorAll<HTMLElement>('.feedback')].filter((el) => el.offsetParent !== null);
    // Anything poking out past the card's right edge (outside a scroll box) is cut off on phones.
    const sticksOut: string[] = [];
    if (card) {
      const edge = card.getBoundingClientRect().right + 1;
      const scrolls = (el: Element | null): boolean => {
        for (let e = el; e && e !== card; e = e.parentElement) {
          if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(e).overflowX)) return true;
        }
        return false;
      };
      for (const el of card.querySelectorAll<HTMLElement>('*')) {
        if (el.offsetParent === null || el.closest('[hidden], .visually-hidden')) continue;
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.right > edge && !scrolls(el.parentElement)) {
          sticksOut.push(`<${el.tagName.toLowerCase()} class="${el.className}"> ${(el.textContent ?? '').trim().slice(0, 50)}`);
        }
      }
    }
    return {
      count: document.querySelector('[data-count]')?.textContent ?? '',
      asleep: card?.querySelectorAll('astro-island[ssr]').length ?? 0,
      text: root?.innerText ?? '',
      feedback: feedback.map((el) => el.innerText),
      sticksOut: sticksOut.slice(0, 3),
    };
  }, scope);
}

/** Red "WRONG" feedback is never allowed. Lowercase "wrong" in normal text is fine ("the wrong branch"). */
function expectNoWrong({ text, feedback }: { text: string; feedback: string[] }) {
  expect(text, 'no shouty WRONG').not.toMatch(/\bWRONG\b/);
  expect(text, 'no bare "Wrong" feedback').not.toMatch(/(^|\n)\s*[✗×]?\s*Wrong[.!]?\s*($|\n)/);
  for (const fb of feedback) expect(fb).not.toMatch(/wrong/i);
}

// Phone width: layout bugs show up here first. Interactions are the same as on desktop.
test.use({ serviceWorkers: 'block', viewport: { width: 360, height: 780 } });

for (const item of items) {
  for (const lang of ['en', 'ms'] as const) {
    const phone = item.phone && lang === 'en';
    test(`${item.id} ${lang}: every card to the win card`, { tag: phone ? [] : ['@desktop-only'] }, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(`console: ${m.text()}`);
      });

      // The player runs before DOMContentLoaded; no need to wait for fonts and images.
      await page.goto(`/${lang}/${item.path}`, { waitUntil: 'domcontentloaded' });
      const count = page.locator('[data-count]');
      const re = cardOf(lang);
      await expect(count).toHaveText(re);
      const [, first, totalText] = re.exec((await count.textContent()) ?? '')!;
      expect(Number(first)).toBe(1);
      const total = Number(totalText);
      expect(total).toBeGreaterThan(1);

      const active = page.locator('.lesson-card.is-active');
      const next = page.locator('[data-next]');
      await expect(next).toBeVisible();
      await expect(next).toBeEnabled();
      for (let n = 1; n <= total; n++) {
        const now = await look(page, 'card');
        expect(now.count).toContain(strings[lang]['lesson.cardOf']!.replace('{n}', String(n)).replace('{total}', String(total)));
        // Let this card's islands wake up (only cards that move have any).
        if (now.asleep > 0) await expect(active.locator('astro-island[ssr]')).toHaveCount(0);
        const settled = now.asleep > 0 ? await look(page, 'card') : now;
        expectNoWrong(settled);
        expect(settled.sticksOut, `card ${n}: nothing sticks out past the card at 360 px`).toEqual([]);
        // A real mouse click on Next. `force` skips the "is it still moving?" wait (halves the
        // run time); if anything covered the button, the card counter check above would fail.
        if (n < total) await next.click({ force: true });
      }
      expectNoWrong(await look(page, 'page'));
      await expect(active).toHaveAttribute('data-card-type', 'win');
      await expect(page.locator('[data-win-extras]')).toBeVisible();

      // The language switch keeps the same card.
      const winId = await active.getAttribute('data-card-id');
      const other: Lang = lang === 'en' ? 'ms' : 'en';
      await page.locator('.lesson-bar [data-lang-toggle]').click();
      await expect(page).toHaveURL(new RegExp(`/${other}/${item.path}#c=${winId}$`));
      await expect(page.locator('[data-count]')).toContainText(
        strings[other]['lesson.cardOf']!.replace('{n}', String(total)).replace('{total}', String(total)),
      );
      await expect(page.locator('.lesson-card.is-active')).toHaveAttribute('data-card-id', winId!);

      expect(errors).toEqual([]);
    });
  }
}
