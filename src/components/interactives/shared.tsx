// Small helpers shared by all interactive cards.
import { useStore } from '@nanostores/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { t as translate, type Lang } from '~/i18n';
import { $progress } from '~/stores/progress';
import { playSound } from '~/lib/sound';

export type T = (key: string, params?: Record<string, string | number>) => string;

export function useT(lang: Lang): T {
  return (key, params) => translate(lang, key, params);
}

/** False when the learner wants less motion (calm mode or the OS setting). */
export function useMotionOK(): boolean {
  const calm = useStore($progress).settings.calm;
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const on = () => setReduced(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return !calm && !reduced;
}

export function useLearnerName(): string {
  return useStore($progress).name;
}

/**
 * Tell the lesson player what happened. Events bubble from the island up to
 * the card, which marks itself done and lets the mascot react.
 */
export function useCardEvents() {
  const ref = useRef<HTMLDivElement>(null);
  const emit = (type: 'fl:done' | 'fl:wrong' | 'fl:hint', detail: Record<string, unknown> = {}) => {
    ref.current?.dispatchEvent(new CustomEvent(type, { bubbles: true, detail }));
    if (type === 'fl:done') playSound('win');
    if (type === 'fl:wrong') playSound('oops');
  };
  return { ref, emit };
}

export function pickPraise(t: T, name: string, seed: number): string {
  if (name && seed % 3 === 0) return t('praise.named', { name });
  return t(`praise.${(seed % 4) + 1}`);
}

/** Kind inline feedback. Never a red "WRONG". */
export function Feedback({ kind, children }: { kind: 'right' | 'almost'; children: ReactNode }) {
  return (
    <div className={`feedback ${kind === 'right' ? 'feedback-right' : 'feedback-almost'}`} role="status">
      <span aria-hidden="true">{kind === 'right' ? '✓ ' : '↻ '}</span>
      {children}
    </div>
  );
}

/** Live region for screen readers. */
export function Announce({ text }: { text: string }) {
  return (
    <p className="visually-hidden" aria-live="polite">
      {text}
    </p>
  );
}

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

/** Deterministic shuffle so every learner (and every test) sees the same order. */
export function seededShuffle<T>(items: T[], seed: string): T[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  const rand = () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
