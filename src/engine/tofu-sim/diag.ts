// Diagnostics (errors and warnings) and how OpenTofu prints them.
// Plain mode (-no-color): a blank line, "Error: summary", the source snippet, the detail wrapped
// at 77 columns. Colour mode (a real terminal): the same inside a red "╷ │ ╵" gutter, wrapped at
// 75 columns, followed by a blank line.
import type { Range } from './hcl';
import type { Line, Seg } from './types';

export interface Diag {
  severity: 'error' | 'warning';
  summary: string;
  detail: string;
  subject?: Range;
  /** Expression values shown under the snippet ("var.tables is 20"). */
  values?: string[];
  /** "with data.local_file.recipe," above the snippet. */
  address?: string;
  /** Overrides the "in resource …" context line text (null = no context). */
  context?: string | null;
}

export class DiagError extends Error {
  constructor(public diags: Diag[]) {
    super(diags[0]?.summary ?? 'error');
  }
}

export const err = (summary: string, detail: string, subject?: Range, extra: Partial<Diag> = {}): Diag => ({ severity: 'error', summary, detail, ...(subject ? { subject } : {}), ...extra });
export const warn = (summary: string, detail: string, subject?: Range, extra: Partial<Diag> = {}): Diag => ({ severity: 'warning', summary, detail, ...(subject ? { subject } : {}), ...extra });

/** Go's wordwrap.WrapString: break at spaces so lines fit `limit`; long words stay whole. */
export function wordWrap(text: string, limit: number): string {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    const words = para.split(' ');
    let line = '';
    for (const w of words) {
      if (!line.length) line = w;
      else if (line.length + 1 + w.length <= limit) line += ` ${w}`;
      else {
        out.push(line);
        line = w;
      }
    }
    out.push(line);
  }
  return out.join('\n');
}

export interface SourceFiles {
  [file: string]: string;
}

/**
 * "in resource "random_pet" "stall"": the top-level block whose range (from its type keyword to
 * its closing brace) holds the byte at `byte`. OpenTofu asks for the byte just before a
 * diagnostic's subject, so a subject on a block's `{` (a missing argument) names the block, and
 * one on the block's first word does not.
 */
export function contextOf(src: string, byte: number): string | null {
  if (byte < 0) return null;
  let depth = 0;
  let header: string | null = null;
  let i = 0;
  let lineStart = 0;
  let inStr = false;
  let heredoc: string | null = null;
  while (i < src.length && i < byte) {
    const c = src[i]!;
    if (heredoc) {
      if (c === '\n') {
        const next = src.slice(i + 1, src.indexOf('\n', i + 1) < 0 ? undefined : src.indexOf('\n', i + 1)).trim();
        if (next === heredoc) heredoc = null;
      }
      i++;
      continue;
    }
    if (inStr) {
      if (c === '\\') i++;
      else if (c === '"') inStr = false;
      i++;
      continue;
    }
    if (c === '#' || (c === '/' && src[i + 1] === '/')) {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (c === '<' && src[i + 1] === '<') {
      const m = /^<<-?([A-Za-z_][\w-]*)\n/.exec(src.slice(i));
      if (m) {
        heredoc = m[1]!;
        i += m[0].length - 1;
        continue;
      }
    }
    if (c === '"') inStr = true;
    else if (c === '{') {
      if (depth === 0) {
        const head = src.slice(lineStart, i).trim();
        header = /^[A-Za-z_][\w-]*(\s+("[^"]*"|[A-Za-z_][\w-]*))*$/.test(head) ? head.replace(/\s+/g, ' ') : null;
      }
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 0) header = null;
    } else if (c === '\n') lineStart = i + 1;
    i++;
  }
  if (depth > 0) return header;
  if (inStr || heredoc) return null;
  // Not inside a body: maybe on a block's header line (`resource "x" "y" {`).
  const end = src.indexOf('\n', lineStart);
  const line = src.slice(lineStart, end < 0 ? undefined : end);
  const m = /^(\s*)([A-Za-z_][\w-]*(?:\s+(?:"[^"]*"|[A-Za-z_][\w-]*))*)\s*\{/.exec(line);
  if (!m || byte < lineStart + m[1]!.length) return null;
  return m[2]!.replace(/\s+/g, ' ');
}

function snippet(d: Diag, sources: SourceFiles): string[] {
  if (!d.subject) return [];
  const src = sources[d.subject.file];
  const out: string[] = [];
  if (d.address) out.push(`  with ${d.address},`);
  const ctx = d.context !== undefined ? d.context : src !== undefined ? contextOf(src, d.subject.start.byte - 1) : null;
  out.push(`  on ${d.subject.file} line ${d.subject.start.line}${ctx ? `, in ${ctx}` : ''}:`);
  if (src !== undefined) {
    const lines = src.split('\n');
    const last = Math.min(d.subject.end.line, d.subject.start.line + 4);
    for (let n = d.subject.start.line; n <= Math.max(d.subject.start.line, last); n++) {
      if (n === d.subject.end.line && d.subject.end.col === 1 && n !== d.subject.start.line) break;
      out.push(`${String(n).padStart(4)}: ${lines[n - 1] ?? ''}`);
    }
  }
  if (d.values?.length) {
    out.push('    ├────────────────');
    for (const v of d.values) out.push(`    │ ${v}`);
  }
  out.push('');
  return out;
}

/** The text of one diagnostic, as lines (no gutter). */
function body(d: Diag, sources: SourceFiles, width: number): { head: string; rest: string[] } {
  const rest: string[] = [];
  rest.push('');
  rest.push(...snippet(d, sources));
  if (d.detail) {
    for (const line of d.detail.split('\n')) rest.push(...(line.startsWith(' ') ? [line] : wordWrap(line, width - 1).split('\n')));
  }
  return { head: `${d.severity === 'error' ? 'Error' : 'Warning'}: ${d.summary}`, rest };
}

export function renderDiags(diags: Diag[], sources: SourceFiles, color: boolean): Line[] {
  const out: Line[] = [];
  for (const d of diags) {
    const c: Seg['c'] = d.severity === 'error' ? 'red' : 'yellow';
    if (!color) {
      const { head, rest } = body(d, sources, 78);
      out.push([]);
      out.push([{ t: head }]);
      for (const r of rest) out.push(r ? [{ t: r }] : []);
      continue;
    }
    const { head, rest } = body(d, sources, 76);
    out.push([{ t: '╷', c }]);
    out.push([{ t: '│ ', c }, { t: `${d.severity === 'error' ? 'Error' : 'Warning'}: `, c }, { t: head.replace(/^(Error|Warning): /, ''), c: 'bold' }]);
    for (const r of rest) out.push([{ t: '│ ', c }, ...(r ? [{ t: r }] : [])]);
    out.push([{ t: '╵', c }]);
    out.push([]);
  }
  return out;
}
