// Deterministic ids and names: the same scenario always gives the same container ids,
// image ids and random names, so lessons and tests can rely on them.
import type { KitchenState } from './types';

/** 32-bit FNV-1a, mixed (good enough to spread hex digits; not a security hash). */
function fnv(text: string, salt: number): number {
  let h = (2166136261 ^ salt) >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995) >>> 0;
  h ^= h >>> 15;
  return h >>> 0;
}

/** A stable 64-hex id for any text. */
export function hexOf(text: string, length = 64): string {
  let out = '';
  let i = 0;
  while (out.length < length) out += fnv(text, i++).toString(16).padStart(8, '0');
  return out.slice(0, length);
}

/** A fresh 64-hex id from the scenario seed and a counter. Mutates the (cloned) state. */
export function nextId(state: KitchenState, kind: string): string {
  state.counter++;
  return hexOf(`${state.seed}:${kind}:${state.counter}`);
}

/** A BuildKit-style 25-char cache id (lowercase letters and digits). */
export function cacheId(text: string): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  let i = 0;
  while (out.length < 25) {
    const n = fnv(text, 100 + i++);
    out += alphabet[n % 36]! + alphabet[(n >>> 8) % 36]! + alphabet[(n >>> 16) % 36]!;
  }
  return out.slice(0, 25);
}

// A few words from Docker's own name generator (adjective_surname).
const LEFT = [
  'admiring', 'affectionate', 'amazing', 'brave', 'busy', 'charming', 'clever', 'cool', 'dazzling', 'eager',
  'elegant', 'festive', 'friendly', 'gifted', 'happy', 'hopeful', 'jolly', 'keen', 'kind', 'laughing',
  'loving', 'lucid', 'magical', 'modest', 'nice', 'optimistic', 'peaceful', 'quirky', 'relaxed', 'serene',
  'sharp', 'stoic', 'sweet', 'tender', 'trusting', 'vibrant', 'wizardly', 'youthful', 'zealous', 'zen',
];
const RIGHT = [
  'albattani', 'allen', 'babbage', 'bell', 'blackwell', 'bohr', 'curie', 'darwin', 'einstein', 'euler',
  'faraday', 'feynman', 'franklin', 'galileo', 'goldberg', 'goodall', 'hamilton', 'hawking', 'hopper', 'hypatia',
  'jemison', 'johnson', 'kalam', 'kepler', 'lamarr', 'lovelace', 'mayer', 'mclean', 'meitner', 'newton',
  'noether', 'pasteur', 'raman', 'ritchie', 'shannon', 'swanson', 'tesla', 'thompson', 'turing', 'wozniak',
];

/** A Docker-style random name (e.g. "quirky_hopper"), unique among `taken`. */
export function randomName(state: KitchenState, taken: Set<string>): string {
  for (let i = 0; i < 2000; i++) {
    state.counter++;
    const n = fnv(`${state.seed}:name:${state.counter}`, 7);
    const name = `${LEFT[n % LEFT.length]}_${RIGHT[(n >>> 10) % RIGHT.length]}`;
    if (!taken.has(name)) return name;
  }
  return `kitchen_${state.counter}`;
}

/** A MAC address like Docker 29 gives (random, locally administered). */
export function macOf(id: string): string {
  const h = hexOf(`mac:${id}`, 12);
  const first = ((parseInt(h.slice(0, 2), 16) & 0xfe) | 0x02).toString(16).padStart(2, '0');
  return [first, h.slice(2, 4), h.slice(4, 6), h.slice(6, 8), h.slice(8, 10), h.slice(10, 12)].join(':');
}

/** The laptop's PID of a running container's main process (`docker inspect` State.Pid, `docker top`, `ps aux`). */
export function hostPid(containerId: string): number {
  return 4000 + (parseInt(containerId.slice(0, 4), 16) % 5000);
}
