// The Cloud with AWS rescue flows (rescue.yaml): every answer leads somewhere, every path asks 1–3
// questions (at least one asks 2+), results are bilingual with real `aws` (or shell) commands, link a
// real AWS lesson id (shown once that lesson is ready), anything that deletes is never marked safe,
// and the Malay stays Malaysian.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { sentences, words } from '../../../../scripts/check-readability/index';

interface Step {
  id: string;
  question?: { en: string; ms: string };
  answers?: { label: { en: string; ms: string }; next: string }[];
  result?: { text: { en: string; ms: string }; commands: { command: string; en: string; ms: string }[]; danger: string; lesson?: string };
}
interface Flow {
  id: string;
  title: { en: string; ms: string };
  start: string;
  steps: Step[];
}

const load = (p: string) => parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const flows = (load('./rescue.yaml').flows ?? []) as Flow[];
const outline = load('./course.yaml') as { worlds: { lessons: { id: string }[]; boss?: { id: string } }[] };
const lessonIds = new Set(outline.worlds.flatMap((w) => [...w.lessons.map((l) => l.id), ...(w.boss ? [w.boss.id] : [])]));
const NOT_MALAYSIAN = /(\bberkas|unduh|kata sandi|pengaturan|\bhapus)/i;

function paths(flow: Flow): string[][] {
  const byId = new Map(flow.steps.map((s) => [s.id, s]));
  const out: string[][] = [];
  const walk = (id: string, seen: string[]) => {
    const s = byId.get(id)!;
    if (s.result) return void out.push(seen);
    for (const a of s.answers ?? []) walk(a.next, [...seen, id]);
  };
  walk(flow.start, []);
  return out;
}

describe('AWS rescue flows', () => {
  it('has the five flows (access denied, bill, reach, leaked key, Region)', () => {
    expect(flows.map((f) => f.id)).toEqual(['aws-access-denied', 'aws-surprise-bill', 'aws-cant-reach-server', 'aws-leaked-key', 'aws-wrong-region']);
  });

  it.each(flows.map((f) => [f.id, f] as const))('%s: every step is reachable and every answer leads somewhere', (_id, flow) => {
    const ids = new Set(flow.steps.map((s) => s.id));
    expect(ids.has(flow.start)).toBe(true);
    const targets = new Set([flow.start]);
    for (const s of flow.steps) {
      expect(Boolean(s.question) !== Boolean(s.result), `${s.id}: a question or a result`).toBe(true);
      for (const a of s.answers ?? []) {
        expect(ids.has(a.next), `${s.id} → ${a.next}`).toBe(true);
        targets.add(a.next);
      }
    }
    expect([...ids].filter((i) => !targets.has(i))).toEqual([]);
    for (const p of paths(flow)) expect(p.length, p.join(' → ')).toBeGreaterThanOrEqual(1);
    for (const p of paths(flow)) expect(p.length, p.join(' → ')).toBeLessThanOrEqual(3);
    expect(Math.max(...paths(flow).map((p) => p.length))).toBeGreaterThanOrEqual(2);
  });

  it('results: bilingual, real commands, a real AWS lesson, honest danger', () => {
    for (const f of flows) {
      for (const s of f.steps.filter((x) => x.result)) {
        const r = s.result!;
        const where = `${f.id}#${s.id}`;
        expect(r.text.en && r.text.ms, where).toBeTruthy();
        expect(r.commands.length, where).toBeGreaterThan(0);
        for (const c of r.commands) {
          expect(c.command && c.en && c.ms, where).toBeTruthy();
          expect(c.command, where).toMatch(/^(aws |ss |curl |export )/);
        }
        expect(r.lesson && lessonIds.has(r.lesson), `${where}: lesson ${r.lesson}`).toBe(true);
        const deletes = r.commands.some((c) => /^aws \S+ (delete|terminate|release|enable|update-access-key|authorize)/.test(c.command));
        if (deletes) expect(r.danger, `${where}: changes or deletes something`).not.toBe('safe');
      }
    }
  });

  it('writes short sentences, and Malaysian (not Indonesian) Malay', () => {
    for (const f of flows) {
      const texts: string[] = [f.title.en, f.title.ms];
      for (const s of f.steps) {
        if (s.question) texts.push(s.question.en, s.question.ms);
        for (const a of s.answers ?? []) texts.push(a.label.en, a.label.ms);
        if (s.result) texts.push(s.result.text.en, s.result.text.ms, ...s.result.commands.flatMap((c) => [c.en, c.ms]));
      }
      for (const t of texts) for (const x of sentences(t)) expect(words(x).length, `${f.id}: ${x}`).toBeLessThanOrEqual(15);
      expect(JSON.stringify(f, (k, v: unknown) => (k === 'en' ? undefined : v))).not.toMatch(NOT_MALAYSIAN);
    }
  });
});
