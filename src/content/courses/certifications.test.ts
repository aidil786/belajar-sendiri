// The certification map (docs/SHIP-IT-PLAN.md §12, docs/LEVEL-UP-PLAN.md §4): the ten exams, their
// facts as checked on the official pages on 2026-11-01, worlds that exist, official links, short sentences.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { certLessonIds, certProgress, findWorld, type CourseLike } from '~/lib/certMap';
import { sentences, words } from '../../../scripts/check-readability/index';
import { certifications, CERTS_CHECKED } from './certifications';

const load = (id: string) => ({ id, ...(parse(readFileSync(new URL(`./${id}/course.yaml`, import.meta.url), 'utf8')) as Omit<CourseLike, 'id'>) });
const courses: CourseLike[] = ['git', 'docker', 'cicd', 'kubernetes', 'linux', 'iac', 'observability', 'aws'].map(load);
const cert = (id: string) => certifications.find((c) => c.id === id)!;

describe('certification map', () => {
  it('lists the Ship It exams, then the Level Up exams, with the official prices', () => {
    expect(certifications.map((c) => c.code)).toEqual(['KCNA', 'CKAD', 'GH-200', 'CKA', 'CKS', 'LFCS', 'PCA', 'Terraform', 'CLF-C02', 'SAA-C03']);
    expect(Object.fromEntries(certifications.map((c) => [c.code, c.price]))).toEqual({
      KCNA: 250,
      CKAD: 445,
      'GH-200': 'varies',
      CKA: 445,
      CKS: 445,
      LFCS: 445,
      PCA: 250,
      Terraform: 70.5,
      'CLF-C02': 100,
      'SAA-C03': 150,
    });
    expect(certifications.map((c) => c.family)).toEqual([...Array(5).fill('ship-it'), ...Array(5).fill('level-up')]);
    expect(CERTS_CHECKED).toBe('2026-11-01');
    expect(cert('ckad').format.en).toContain('Kubernetes 1.37');
    expect(cert('cka').format.en).toContain('Kubernetes 1.37');
    expect(cert('cks').needs?.en).toMatch(/CKA/);
  });

  it('states the formats from the official pages (duration, style, validity)', () => {
    expect(cert('lfcs').format.en).toMatch(/^2 hours of hands-on tasks/);
    expect(cert('pca').format.en).toMatch(/^90 minutes of multiple choice/);
    expect(cert('terraform-associate').format.en).toMatch(/1-hour multiple-choice.*Terraform 1\.12.*No free retake/);
    expect(cert('aws-clf').format.en).toMatch(/^90 minutes, 65 multiple-choice questions.*3 years/);
    expect(cert('aws-saa').format.en).toMatch(/^130 minutes, 65 multiple-choice questions.*3 years/);
    // OpenTofu has no official exam: the Terraform card says so.
    expect(cert('terraform-associate').extra?.en).toMatch(/OpenTofu has no official exam/);
  });

  it('links official pages only (Linux Foundation, Microsoft Learn, HashiCorp, AWS)', () => {
    for (const c of certifications) {
      const url = new URL(c.url);
      expect(url.protocol).toBe('https:');
      expect(['training.linuxfoundation.org', 'learn.microsoft.com', 'developer.hashicorp.com', 'aws.amazon.com']).toContain(url.host);
    }
  });

  it('every covered world exists, and the plan mapping holds', () => {
    for (const c of certifications) for (const ref of c.covers) expect(findWorld(courses, ref), `${c.code} → ${ref.course} ${ref.world}`).toBeTruthy();
    const codes = (id: string) =>
      certifications
        .find((c) => c.id === id)!
        .covers.map((ref) => {
          const w = findWorld(courses, ref)!.world;
          return ref.course === 'git' ? `git-${w.id}` : w.code;
        });
    expect(codes('kcna')).toEqual(['D6', 'K1', 'K2', 'K3', 'K4', 'K5', 'K6', 'K7']);
    expect(codes('ckad')).toEqual(['D2', 'K1', 'K2', 'K3', 'K4', 'K5', 'K6']);
    expect(codes('gh-200')).toEqual(['git-7', 'C1', 'C2', 'C3', 'C4']);
    expect(codes('cka')).toEqual(['K9', 'K1', 'K2', 'K3', 'K4', 'K5', 'K6']);
    expect(codes('cks')).toEqual(['D5', 'C4', 'K6']);
    expect(codes('lfcs')).toEqual(['L1', 'L2', 'L3', 'L4']);
    expect(codes('pca')).toEqual(['O1', 'O2', 'O3']);
    expect(codes('terraform-associate')).toEqual(['T1', 'T2', 'T3', 'T4']);
    expect(codes('aws-clf')).toEqual(['A1', 'A2', 'A3', 'A4']);
    expect(codes('aws-saa')).toEqual(['A1', 'A2', 'A3', 'A4', 'L3']);
  });

  it('short sentences in both languages', () => {
    for (const c of certifications) {
      for (const lang of ['en', 'ms'] as const) {
        for (const text of [c.format[lang], c.takeWhen[lang], c.extra?.[lang] ?? '', c.needs?.[lang] ?? '']) {
          for (const s of sentences(text)) expect(words(s).length, `${c.code} ${lang}: ${s}`).toBeLessThanOrEqual(15);
        }
      }
    }
  });

  it('counts ready lessons and bosses of the covering worlds, like the world map', () => {
    const fake: CourseLike[] = [
      {
        id: 'kubernetes',
        worlds: [
          { id: 1, code: 'K1', title: { en: 'A', ms: 'A' }, lessons: [{ id: 'a', status: 'ready' }, { id: 'b', status: 'soon' }], boss: { id: 'k1-boss', status: 'ready' } },
          { id: 2, code: 'K2', title: { en: 'B', ms: 'B' }, lessons: [{ id: 'c', status: 'ready' }] },
        ],
      },
    ];
    const ids = certLessonIds(fake, [{ course: 'kubernetes', world: 1 }, { course: 'kubernetes', world: 2 }, { course: 'kubernetes', world: 9 }]);
    expect(ids).toEqual(['a', 'k1-boss', 'c']);
    expect(certProgress(ids, ['a', 'c', 'other'])).toEqual({ done: 2, total: 3, percent: 67 });
    expect(certProgress([], ['a'])).toEqual({ done: 0, total: 0, percent: 0 });
    // The real outline: KCNA covers some ready lessons already (D6 is ready).
    expect(certLessonIds(courses, certifications[0]!.covers).length).toBeGreaterThan(0);
  });
});
