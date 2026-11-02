// The Kubernetes rescue flows (rescue.yaml): every answer leads somewhere, every flow has
// 1–3 questions on each path, safe steps start by checking the context, and `lesson:` links
// point at real Kubernetes lesson ids (they show once that lesson is ready).
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
const flows = load('./rescue.yaml').flows as Flow[];
const outline = load('./course.yaml') as { worlds: { lessons: { id: string }[]; boss?: { id: string } }[] };
const lessonIds = new Set(outline.worlds.flatMap((w) => [...w.lessons.map((l) => l.id), ...(w.boss ? [w.boss.id] : [])]));

/** Every path from start to a result, as the list of question ids on the way. */
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

describe('Kubernetes rescue flows', () => {
  it('has the 12 flows from the plan (§8), then the 3 K9 node flows', () => {
    expect(flows.map((f) => f.id)).toEqual([
      'k8s-crashloop', 'k8s-imagepull', 'k8s-pending', 'k8s-oomkilled', 'k8s-no-endpoints', 'k8s-gateway-404-503',
      'k8s-dns', 'k8s-pvc-pending', 'k8s-rollout-stuck', 'k8s-forbidden', 'k8s-wrong-cluster', 'k8s-node-notready',
      // K9 Cluster Admin (Level Up CKA pack)
      'k8s-node-kubelet', 'k8s-control-plane-down', 'k8s-etcd-restore',
    ]);
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

  it('results: bilingual, linked to a real lesson, and changes check the context first', () => {
    for (const f of flows) {
      for (const s of f.steps.filter((x) => x.result)) {
        const r = s.result!;
        const where = `${f.id}#${s.id}`;
        expect(r.text.en && r.text.ms, where).toBeTruthy();
        expect(r.commands.length, where).toBeGreaterThan(0);
        for (const c of r.commands) expect(c.command && c.en && c.ms, where).toBeTruthy();
        expect(r.lesson && lessonIds.has(r.lesson), `${where}: lesson ${r.lesson}`).toBe(true);
        const kubectlChange = r.commands.some((c) => /^kubectl (apply|create|delete|patch|label|set|scale|rollout (undo|restart)|cordon|drain)\b/.test(c.command) && !/--dry-run/.test(c.command));
        if (kubectlChange) {
          expect(r.danger, `${where}: changes the cluster`).not.toBe('safe');
          expect(r.commands.some((c) => c.command === 'kubectl config current-context'), `${where}: check the context first`).toBe(true);
        }
      }
    }
  });
});
