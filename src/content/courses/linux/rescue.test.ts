// The Linux rescue flows (rescue.yaml): every answer leads somewhere, 1–3 questions on each path,
// results are bilingual and link a real Linux lesson, and anything that runs sudo, rm or a change
// to a service carries a danger badge (not "safe"). Sentences stay short (max 20 words here: the
// Rescue Center shows full sentences, still plain words), and the Malay avoids Indonesian words.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

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

const words = (s: string) => s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
const sentences = (s: string) => s.split(/(?<=[.!?])\s+/).filter((x) => words(x).length);

describe('Linux rescue flows', () => {
  it('has about five flows, ids start with linux-', () => {
    expect(flows.length).toBeGreaterThanOrEqual(5);
    for (const f of flows) expect(f.id).toMatch(/^linux-[a-z0-9-]+$/);
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
  });

  it('results: bilingual, a real lesson, honest danger, short sentences, Malaysian Malay', () => {
    for (const f of flows) {
      for (const s of f.steps.filter((x) => x.result)) {
        const r = s.result!;
        const where = `${f.id}#${s.id}`;
        expect(r.text.en && r.text.ms, where).toBeTruthy();
        expect(r.commands.length, where).toBeGreaterThan(0);
        for (const c of r.commands) expect(c.command && c.en && c.ms, where).toBeTruthy();
        expect(r.lesson && lessonIds.has(r.lesson), `${where}: lesson ${r.lesson}`).toBe(true);
        if (r.commands.some((c) => /(^|\s)(sudo\s+(rm|systemctl\s+(start|stop|restart)|ufw\s+allow|chown|chmod|apt\s+install)|rm\s)/.test(c.command))) {
          expect(r.danger, `${where}: changes the machine`).not.toBe('safe');
        }
        for (const t of [r.text.en, r.text.ms]) for (const x of sentences(t)) expect(words(x).length, `${where}: "${x}"`).toBeLessThanOrEqual(20);
        for (const t of [r.text.ms, ...r.commands.map((c) => c.ms)]) expect(t, where).not.toMatch(/\b(berkas|unduh|kata sandi|pengaturan|hapus)\b/i);
      }
    }
  });
});
