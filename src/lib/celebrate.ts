// A short confetti burst (under a second) for a win: a card done, a lesson finished.
// It never loops, never makes a sound, and never runs in calm mode or with reduced
// motion. The pieces are decoration only (aria-hidden) and are removed afterwards.

const COLOURS = ['--party-1', '--party-2', '--party-3', '--party-4', '--party-5'];

/** True when the learner asked for less motion (calm mode or the system setting). */
export function quietMotion(): boolean {
  if (typeof window === 'undefined') return true;
  return (
    document.documentElement.dataset.calm === 'true' || window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * Burst from the middle-top of `from` (an element on screen), mostly upwards.
 * `pieces`: how many bits of confetti (18 for a card, more for a whole lesson).
 */
export function celebrate(from: Element, pieces = 18): void {
  if (quietMotion()) return;
  const r = from.getBoundingClientRect();
  if (!r.width && !r.height) return;
  const box = document.createElement('div');
  box.className = 'party';
  box.setAttribute('aria-hidden', 'true');
  // Keep the burst on screen even when `from` is partly scrolled away.
  const clamp = (v: number, max: number) => Math.round(Math.min(Math.max(v, 40), max - 40));
  box.style.setProperty('--x', `${clamp(r.left + r.width / 2, window.innerWidth)}px`);
  box.style.setProperty('--y', `${clamp(r.top + Math.min(r.height / 2, 24), window.innerHeight)}px`);
  for (let i = 0; i < pieces; i++) {
    const bit = document.createElement('i');
    // Spread over the upper half circle, with a little randomness so no two bursts match.
    const angle = Math.PI + (i / (pieces - 1)) * Math.PI + (Math.random() - 0.5) * 0.35;
    const dist = 70 + Math.random() * 80;
    bit.style.setProperty('--dx', `${Math.round(Math.cos(angle) * dist)}px`);
    bit.style.setProperty('--dy', `${Math.round(Math.sin(angle) * dist - 20)}px`);
    bit.style.setProperty('--rot', `${Math.round(Math.random() * 540 - 270)}deg`);
    bit.style.setProperty('--c', `var(${COLOURS[i % COLOURS.length]})`);
    bit.style.setProperty('--d', `${Math.round(Math.random() * 90)}ms`);
    if (i % 3 === 0) bit.className = 'round';
    box.append(bit);
  }
  document.body.append(box);
  window.setTimeout(() => box.remove(), 1300);
}
