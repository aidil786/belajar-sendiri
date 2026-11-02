// The KCNA practice bank: every question is well formed in both languages, tagged with a current
// official domain, points at a ready lesson, and follows the writing rules.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { codeSpans, longSentences, NOT_MALAYSIAN } from '../textRules';
import { KCNA_DOMAINS, KCNA_URL, kcnaQuestions, type KcnaQuestion } from './kcna';

const courseDir = new URL('../courses/', import.meta.url);
const ready = new Set(
  readdirSync(courseDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(new URL(`${d.name}/course.yaml`, courseDir)))
    .flatMap((d) => {
      const c = parse(readFileSync(new URL(`${d.name}/course.yaml`, courseDir), 'utf8')) as { worlds: { lessons: { id: string; status: string }[]; boss?: { id: string; status: string } }[] };
      return c.worlds.flatMap((w) => [...w.lessons, ...(w.boss ? [w.boss] : [])].filter((l) => l.status === 'ready').map((l) => l.id));
    }),
);

const texts = (q: KcnaQuestion, lang: 'en' | 'ms') => [q[lang].question, ...q[lang].options, q[lang].why];

describe('KCNA bank', () => {
  it('the four current official domains, with weights that add up to 100', () => {
    expect(KCNA_DOMAINS.map((d) => d.name.en)).toEqual(['Kubernetes Fundamentals', 'Container Orchestration', 'Cloud Native Application Delivery', 'Cloud Native Architecture']);
    expect(KCNA_DOMAINS.reduce((n, d) => n + d.weight, 0)).toBe(100);
    expect(new URL(KCNA_URL).host).toBe('training.linuxfoundation.org');
  });

  it('has at least 3 questions per domain, with unique, url-safe ids', () => {
    const ids = kcnaQuestions.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const q of kcnaQuestions) expect(q.id).toMatch(new RegExp(`^kcna-${q.domain}-\\d{3}$`));
    for (const d of KCNA_DOMAINS) expect(kcnaQuestions.filter((q) => q.domain === d.id).length, d.id).toBeGreaterThanOrEqual(3);
  });

  it('is big enough for fresh mocks: 160+ questions (a mock takes 60)', () => {
    expect(kcnaQuestions.length).toBeGreaterThanOrEqual(160);
  });

  it('each domain holds its official share of the bank, within 3 points', () => {
    for (const d of KCNA_DOMAINS) {
      const share = (100 * kcnaQuestions.filter((q) => q.domain === d.id).length) / kcnaQuestions.length;
      expect(Math.abs(share - d.weight), `${d.id}: ${share.toFixed(1)}% vs ${d.weight}%`).toBeLessThanOrEqual(3);
    }
  });

  it('no question is asked twice (in either language)', () => {
    const norm = (s: string) => s.toLowerCase().replace(/[`’'".,?!:]/g, '').replace(/\s+/g, ' ').trim();
    for (const lang of ['en', 'ms'] as const) {
      const seen = new Map<string, string>();
      for (const q of kcnaQuestions) {
        const key = norm(q[lang].question);
        expect(seen.get(key), `${lang}: ${q.id} repeats ${seen.get(key)}`).toBeUndefined();
        seen.set(key, q.id);
      }
    }
  });

  it('the right answer sits in every position about equally (20–30% each, 15%+ per domain)', () => {
    const share = (qs: KcnaQuestion[], i: number) => (100 * qs.filter((q) => q.answer === i).length) / qs.length;
    for (const i of [0, 1, 2, 3]) {
      expect(share(kcnaQuestions, i), `position ${i}`).toBeGreaterThanOrEqual(20);
      expect(share(kcnaQuestions, i), `position ${i}`).toBeLessThanOrEqual(30);
      for (const d of KCNA_DOMAINS) expect(share(kcnaQuestions.filter((q) => q.domain === d.id), i), `${d.id}, position ${i}`).toBeGreaterThanOrEqual(15);
    }
  });

  for (const q of kcnaQuestions) {
    describe(q.id, () => {
      it('a known domain, 4 different options in each language, one answer, a ready lesson', () => {
        expect(KCNA_DOMAINS.map((d) => d.id)).toContain(q.domain);
        expect([0, 1, 2, 3]).toContain(q.answer);
        for (const lang of ['en', 'ms'] as const) {
          expect(q[lang].options).toHaveLength(4);
          // Compared as shown on screen (code marks dropped), so every option is easy to tell apart.
          expect(new Set(q[lang].options.map((o) => o.replace(/`/g, '').trim().toLowerCase())).size, `${lang}: options repeat`).toBe(4);
          for (const o of q[lang].options) expect(o.replace(/`/g, '').trim().toLowerCase(), `${lang}: option repeats the question`).not.toBe(q[lang].question.replace(/`/g, '').trim().toLowerCase());
        }
        expect(ready.has(q.lesson), `lesson ${q.lesson} is missing or not ready`).toBe(true);
      });

      it('EN and MS match: same code in the question, in each option and in the why', () => {
        expect(codeSpans(q.ms.question)).toEqual(codeSpans(q.en.question));
        expect(codeSpans(q.ms.why)).toEqual(codeSpans(q.en.why));
        q.en.options.forEach((o, i) => expect(codeSpans(q.ms.options[i]!), `option ${i}`).toEqual(codeSpans(o)));
      });

      it('words: short sentences, kind, Malaysian Malay', () => {
        for (const lang of ['en', 'ms'] as const) {
          for (const text of texts(q, lang)) {
            expect(text.trim().length).toBeGreaterThan(0);
            expect(longSentences(text), `${lang}: ${text}`).toEqual([]);
          }
        }
        expect(texts(q, 'en').join(' ')).not.toMatch(/\bwrong\b/i);
        expect(texts(q, 'ms').join(' ')).not.toMatch(NOT_MALAYSIAN);
        // Every question ends with a question mark, in both languages.
        expect(q.en.question.trim()).toMatch(/\?$/);
        expect(q.ms.question.trim()).toMatch(/\?$/);
      });
    });
  }
});
