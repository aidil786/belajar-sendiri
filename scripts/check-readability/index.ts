// Readability check: max 15 words per sentence (12 is the target), max 40 words of
// prose per card. Code, JSX components and hints don't count toward the card limit.
import { cards, lessonFiles } from '../lib/lessons';

const HARD_SENTENCE = 15;
const SOFT_SENTENCE = 12;
const CARD_WORDS = 40;

/** Strip MDX down to the words a learner reads in the card body. */
export function prose(body: string): { main: string; hints: string } {
  let text = body;
  const hints: string[] = [];
  text = text.replace(/<Hint>([\s\S]*?)<\/Hint>/g, (_, h: string) => {
    hints.push(h);
    return ' ';
  });
  const clean = (s: string) =>
    s
      .replace(/<Interactive\b[\s\S]*?\/>/g, ' ') // self-closing interactives (may span lines)
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`[^`]*`/g, ' CODE ')
      .replace(/<Term\s+id="[^"]*"[^>]*>([\s\S]*?)<\/Term>/g, '$1')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/[*_#>]/g, ' ');
  return { main: clean(text), hints: clean(hints.join(' ')) };
}

export function words(s: string): string[] {
  return s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w) && w !== 'CODE');
}

export function sentences(s: string): string[] {
  return s
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?…]["'”’)]*)\s+|\n/)
    .map((x) => x.trim())
    .filter((x) => words(x).length > 0);
}

if (process.argv[1]?.includes('check-readability')) {
  const errors: string[] = [];
  const warnings: string[] = [];
  let cardCount = 0;
  for (const f of lessonFiles()) {
    for (const card of cards(f.text)) {
      cardCount++;
      const { main, hints } = prose(card.body);
      const where = `${f.course}/${f.dir}/${f.lang} #${card.id}`;
      const count = words(main).length;
      if (count > CARD_WORDS && card.type !== 'deeper') errors.push(`${where}: ${count} words (max ${CARD_WORDS})`);
      if (count > CARD_WORDS + 20 && card.type === 'deeper') errors.push(`${where}: ${count} words (deeper max ${CARD_WORDS + 20})`);
      for (const s of [...sentences(main), ...sentences(hints)]) {
        const n = words(s).length;
        if (n > HARD_SENTENCE) errors.push(`${where}: ${n}-word sentence: "${s}"`);
        else if (n > SOFT_SENTENCE) warnings.push(`${where}: ${n} words: "${s}"`);
      }
    }
  }
  if (warnings.length) console.log(`ℹ ${warnings.length} sentences above the 12-word target (allowed up to 15):\n${warnings.map((w) => `  - ${w}`).join('\n')}`);
  if (errors.length) {
    console.error(`✗ Readability check failed (${errors.length}):\n${errors.map((e) => `- ${e}`).join('\n')}`);
    process.exit(1);
  }
  console.log(`✓ Readability OK in ${cardCount} cards.`);
}
