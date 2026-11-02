// Writing rules for content kept in TypeScript (drills, exam questions, tasks), shared by their tests.
// Lessons use `npm run check:readability`; this applies the same sentence rule to plain strings.
import { sentences, words } from '../../scripts/check-readability/index';

/** Indonesian words that have a Malaysian Malay form (fail, muat turun, kata laluan, tetapan, padam). */
export const NOT_MALAYSIAN = /\b(berkas|unduh|mengunduh|kata sandi|pengaturan|hapus)\b/i;

/** Sentences above `max` words (code in backticks does not count). */
export function longSentences(text: string, max = 15): string[] {
  return sentences(text.replace(/`[^`]*`/g, ' ')).filter((s) => words(s).length > max);
}

/** The `code` spans of a text, sorted: EN and MS should name the same commands and objects. */
export function codeSpans(text: string): string[] {
  return [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1]!).sort();
}
