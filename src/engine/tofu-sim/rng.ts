// A small seeded random generator (mulberry32), so every random_* value replays the same way
// in a scenario. The truth check masks these values (real OpenTofu picks its own).

export interface Rng {
  next(): number;
  int(min: number, max: number): number;
  bytes(n: number): Uint8Array;
  pick<T>(xs: readonly T[]): T;
  /** The state to store back (TofuState.seed). */
  state(): number;
}

export function rng(seed: number): Rng {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    bytes: (n) => Uint8Array.from({ length: n }, () => Math.floor(next() * 256)),
    pick: (xs) => xs[Math.floor(next() * xs.length)]!,
    state: () => s,
  };
}

// Our own short word lists for random_pet (the real provider has its own, much longer lists).
export const PET_ADVERBS = ['quickly', 'gently', 'happily', 'quietly', 'boldly', 'warmly', 'kindly', 'brightly', 'calmly', 'neatly', 'really', 'truly'] as const;
export const PET_ADJECTIVES = ['brave', 'clever', 'cosy', 'eager', 'fresh', 'gentle', 'happy', 'jolly', 'lucky', 'merry', 'proud', 'quick', 'shiny', 'sunny', 'swift', 'tidy', 'warm', 'witty'] as const;
export const PET_NAMES = ['badger', 'civet', 'egret', 'gecko', 'heron', 'hornbill', 'kancil', 'kingfisher', 'macaque', 'mynah', 'otter', 'pangolin', 'tapir', 'tarsier', 'turtle', 'weasel'] as const;
