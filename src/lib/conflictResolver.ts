// Pure logic for the ConflictResolver game: read conflict markers, apply the
// learner's choices, and check the result. No DOM, no React.

/** One piece of a conflicted file: plain lines, or a conflict between two sides. */
export type Segment =
  | { kind: 'text'; lines: string[] }
  | {
      kind: 'conflict';
      ours: string[];
      theirs: string[];
      /** Lines of the base section (diff3 style), if the file has one. */
      base: string[] | null;
      oursLabel: string;
      theirsLabel: string;
      /** The block exactly as Git wrote it, markers included. */
      raw: string[];
    };

/** What the learner did with one conflict. `null` = not decided yet (markers stay). */
export type Choice = 'ours' | 'theirs' | 'both' | { edit: string } | null;

export interface ParsedFile {
  segments: Segment[];
  /** The file ended with a newline. */
  endsWithNewline: boolean;
}

const START = /^<{7}(?: (.*))?$/;
const BASE = /^\|{7}(?: .*)?$/;
const MID = /^={7}$/;
const END = /^>{7}(?: (.*))?$/;
const ANY_MARKER = /^(?:<{7}(?: .*)?|\|{7}(?: .*)?|={7}|>{7}(?: .*)?)$/m;

function splitLines(text: string): { lines: string[]; endsWithNewline: boolean } {
  if (text === '') return { lines: [], endsWithNewline: false };
  const endsWithNewline = text.endsWith('\n');
  return { lines: (endsWithNewline ? text.slice(0, -1) : text).split('\n'), endsWithNewline };
}

/** Split a file into plain text and conflict blocks. A block without its end marker stays plain text. */
export function parseConflicts(text: string): ParsedFile {
  const { lines, endsWithNewline } = splitLines(text);
  const segments: Segment[] = [];
  const pushText = (ls: string[]) => {
    if (!ls.length) return;
    const last = segments[segments.length - 1];
    if (last?.kind === 'text') last.lines.push(...ls);
    else segments.push({ kind: 'text', lines: [...ls] });
  };
  let i = 0;
  while (i < lines.length) {
    const start = START.exec(lines[i]!);
    if (!start) {
      pushText([lines[i]!]);
      i++;
      continue;
    }
    // Look for the rest of the block: (base)? mid, end.
    let j = i + 1;
    const ours: string[] = [];
    let base: string[] | null = null;
    const theirs: string[] = [];
    let part: 'ours' | 'base' | 'theirs' = 'ours';
    let end: RegExpExecArray | null = null;
    for (; j < lines.length; j++) {
      const l = lines[j]!;
      if (part === 'ours' && BASE.test(l)) {
        part = 'base';
        base = [];
        continue;
      }
      if (part !== 'theirs' && MID.test(l)) {
        part = 'theirs';
        continue;
      }
      if (part === 'theirs' && (end = END.exec(l))) break;
      if (START.test(l)) break; // a new block started: this one is broken
      (part === 'ours' ? ours : part === 'base' ? base! : theirs).push(l);
    }
    if (!end) {
      pushText([lines[i]!]);
      i++;
      continue;
    }
    segments.push({
      kind: 'conflict',
      ours,
      theirs,
      base,
      oursLabel: start[1] ?? '',
      theirsLabel: end[1] ?? '',
      raw: lines.slice(i, j + 1),
    });
    i = j + 1;
  }
  return { segments, endsWithNewline };
}

/** How many conflict blocks a parsed file has. */
export function conflictCount(file: ParsedFile): number {
  return file.segments.filter((s) => s.kind === 'conflict').length;
}

/** The lines one choice puts in place of a conflict block. */
export function choiceLines(seg: Extract<Segment, { kind: 'conflict' }>, choice: Choice): string[] {
  if (choice === null) return seg.raw;
  if (choice === 'ours') return seg.ours;
  if (choice === 'theirs') return seg.theirs;
  if (choice === 'both') return [...seg.ours, ...seg.theirs];
  return splitLines(choice.edit).lines;
}

/** The file text after applying one choice per conflict block (in order). */
export function applyChoices(file: ParsedFile, choices: Choice[]): string {
  const out: string[] = [];
  let k = 0;
  for (const seg of file.segments) {
    if (seg.kind === 'text') out.push(...seg.lines);
    else out.push(...choiceLines(seg, choices[k++] ?? null));
  }
  if (!out.length) return '';
  return out.join('\n') + (file.endsWithNewline ? '\n' : '');
}

/** True while any conflict marker line is left in the text. */
export function hasMarkers(text: string): boolean {
  return ANY_MARKER.test(text);
}

/** Expected text per file: a regex (or several) that must match, or must not match. */
export type ExpectSpec = string | string[] | Record<string, string | string[]>;

/** Turn the author's `expect` / `avoid` prop into regex lists per file. A bare string or list is for `firstFile`. */
export function normalizeExpect(spec: ExpectSpec | undefined, firstFile: string): Record<string, string[]> {
  if (spec === undefined) return {};
  if (typeof spec === 'string') return { [firstFile]: [spec] };
  if (Array.isArray(spec)) return { [firstFile]: [...spec] };
  return Object.fromEntries(Object.entries(spec).map(([path, v]) => [path, Array.isArray(v) ? [...v] : [v]]));
}

/** Regexes are multi-line (^ and $ match each line) and ignore case. */
export function makeRegex(src: string): RegExp {
  return new RegExp(src, 'mi');
}

export interface FileCheck {
  ok: boolean;
  /** Markers are still in the text. */
  markers: boolean;
  /** `expect` regexes that did not match. */
  missing: string[];
  /** `avoid` regexes that matched. */
  unwanted: string[];
}

/** Is this resolved text what the lesson wants? */
export function checkResolved(text: string, expect: string[] = [], avoid: string[] = []): FileCheck {
  const markers = hasMarkers(text);
  const missing = expect.filter((r) => !makeRegex(r).test(text));
  const unwanted = avoid.filter((r) => makeRegex(r).test(text));
  return { ok: !markers && !missing.length && !unwanted.length, markers, missing, unwanted };
}

/**
 * Can quick choices (yours / theirs / both) reach the expected text? For author checks.
 * Returns one working list of choices, or null.
 */
export function solveWithQuickChoices(file: ParsedFile, expect: string[] = [], avoid: string[] = []): Choice[] | null {
  const n = conflictCount(file);
  const options: Choice[] = ['ours', 'theirs', 'both'];
  const total = 3 ** n;
  for (let code = 0; code < total; code++) {
    const choices: Choice[] = [];
    for (let k = 0, c = code; k < n; k++, c = Math.floor(c / 3)) choices.push(options[c % 3]!);
    if (checkResolved(applyChoices(file, choices), expect, avoid).ok) return choices;
  }
  return null;
}
