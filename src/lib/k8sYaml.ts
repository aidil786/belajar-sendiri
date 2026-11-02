// Read Kubernetes YAML the way kubectl 1.37 does.
//
// kubectl splits a file into documents on `---` lines, then turns each document into JSON with
// sigs.k8s.io/yaml, which uses go-yaml v2 (YAML 1.1: `yes`, `on`, `y` are booleans). go-yaml's
// error messages are well known to learners, so this file copies them for the usual mistakes:
// tabs, wrong indentation, a missing space after `:`, two `:` on one line, unclosed quotes or lists.
// Its line numbers follow go-yaml too: scanner errors name the line, parser errors the line before.
// Real kubectl output was captured from kubectl v1.37.2 (see src/lib/k8sFixtures.ts).
import { isMap, isPair, isScalar, isSeq, parseDocument, type Document, type Node } from 'yaml';

export interface YamlDocPart {
  text: string;
  /** 1-based line of the document's first line in the whole file. */
  startLine: number;
}

/** kubectl's document splitter: a line that starts with `---` and has only spaces or a comment after it. */
export function splitDocuments(text: string): YamlDocPart[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const out: YamlDocPart[] = [];
  let buf: string[] = [];
  let start = 1;
  lines.forEach((line, i) => {
    if (/^---(\s.*)?$/.test(line) && (line.length === 3 || /^---\s*(#.*)?$/.test(line))) {
      out.push({ text: buf.join('\n'), startLine: start });
      buf = [];
      start = i + 2;
    } else buf.push(line);
  });
  out.push({ text: buf.join('\n'), startLine: start });
  // Documents with nothing but comments and blank lines are skipped, like kubectl does.
  return out.filter((d) => d.text.split('\n').some((l) => l.trim() && !l.trim().startsWith('#')));
}

export type YamlErrorCode =
  | 'tab'
  | 'indentKey'
  | 'indentDash'
  | 'colonInValue'
  | 'missingColon'
  | 'unclosedQuote'
  | 'unclosedFlow'
  | 'badChar'
  | 'other';

export interface YamlProblem {
  code: YamlErrorCode;
  /** go-yaml's message, e.g. "did not find expected key". */
  message: string;
  /** The line number go-yaml prints (document-relative). */
  goLine: number;
  /** The 1-based document line where the mistake really is (for highlighting). */
  line: number;
}

const MSG: Record<YamlErrorCode, string> = {
  tab: 'found character that cannot start any token',
  badChar: 'found character that cannot start any token',
  indentKey: 'did not find expected key',
  indentDash: "did not find expected '-' indicator",
  colonInValue: 'mapping values are not allowed in this context',
  missingColon: "could not find expected ':'",
  unclosedQuote: 'found unexpected end of stream',
  unclosedFlow: "did not find expected ',' or ']'",
  other: 'did not find expected key',
};

type Block = { kind: 'map' | 'seq'; indent: number; indentless?: boolean };
type Pending = 'none' | 'plain' | 'closed' | 'emptyKey' | 'emptyItem';

/** Strip a trailing comment (a `#` after a space, outside quotes). */
function stripComment(s: string): string {
  let q: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (q) {
      if (c === q) {
        if (q === "'" && s[i + 1] === "'") i++;
        else q = null;
      } else if (q === '"' && c === '\\') i++;
    } else if (c === '"' || c === "'") {
      // Quotes only open at the start of a scalar.
      const prev = s.slice(0, i).trimEnd();
      if (prev === '' || /[:\-[{,]$/.test(prev)) q = c;
    } else if (c === '#' && (i === 0 || /\s/.test(s[i - 1]!))) return s.slice(0, i);
  }
  return s;
}

/** Position of the `:` that ends a plain or quoted key, or -1. */
function keyColon(s: string): number {
  if (s.startsWith('"') || s.startsWith("'")) {
    const q = s[0]!;
    let i = 1;
    for (; i < s.length; i++) {
      if (s[i] === '\\' && q === '"') i++;
      else if (s[i] === q) {
        if (q === "'" && s[i + 1] === "'") i++;
        else break;
      }
    }
    const rest = s.slice(i + 1);
    const m = /^\s*:(\s|$)/.exec(rest);
    return m ? i + 1 + m[0].indexOf(':') : -1;
  }
  if (/^[[{]/.test(s)) return -1;
  for (let i = 0; i < s.length; i++)
    if (s[i] === ':' && (i + 1 === s.length || s[i + 1] === ' ')) return i;
  return -1;
}

/** Bracket depth change of a flow value, ignoring quoted parts. */
function flowDepth(s: string, start = 0): number {
  let d = start;
  let q: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (q) {
      if (c === '\\' && q === '"') i++;
      else if (c === q) q = null;
    } else if (c === '"' || c === "'") q = c;
    else if (c === '[' || c === '{') d++;
    else if (c === ']' || c === '}') d--;
  }
  return d;
}

/** Does a quoted scalar starting at s[0] close on this line? */
function quoteCloses(s: string): boolean {
  const q = s[0]!;
  for (let i = 1; i < s.length; i++) {
    if (s[i] === '\\' && q === '"') i++;
    else if (s[i] === q) {
      if (q === "'" && s[i + 1] === "'") i++;
      else return true;
    }
  }
  return false;
}

/**
 * Find the first go-yaml error in one document, or null. Covers block-style YAML (what
 * Kubernetes manifests use). Anything unusual is left to the full parser.
 */
export function goYamlProblem(doc: string): YamlProblem | null {
  const lines = doc.replace(/\r\n?/g, '\n').split('\n');
  const eofLine = lines.length - 1; // 0-based line of the end of the stream
  const stack: Block[] = [];
  // Kept in an object: closures below change it, and TypeScript must not narrow it.
  const st: { pending: Pending } = { pending: 'none' };
  let emptyKeyCol = -1;
  let blockScalarParent: number | null = null;
  let openQuote: string | null = null;
  let flow = 0;
  const problem = (
    code: YamlErrorCode,
    line0: number,
    parser: boolean,
    realLine = line0 + 1,
  ): YamlProblem => ({
    code,
    message: MSG[code],
    goLine: parser ? line0 : line0 + 1,
    line: realLine,
  });
  const top = () => stack[stack.length - 1];
  const topIndent = () => top()?.indent ?? -1;

  // Analyse a value after `key: ` or `- `. Returns a problem or null.
  const value = (v: string, i: number, col: number): YamlProblem | null => {
    if (v === '') return null;
    if (v.startsWith('&')) v = v.replace(/^&\S+\s*/, '');
    if (v.startsWith('!')) v = v.replace(/^!\S*\s*/, '');
    if (v === '') {
      st.pending = 'emptyKey';
      emptyKeyCol = col;
      return null;
    }
    if (v.startsWith('@') || v.startsWith('`')) return problem('badChar', i, false);
    if (v.startsWith('"') || v.startsWith("'")) {
      if (!quoteCloses(v)) openQuote = v[0]!;
      st.pending = 'closed';
      return null;
    }
    if (v.startsWith('[') || v.startsWith('{')) {
      flow = flowDepth(v);
      st.pending = 'closed';
      return null;
    }
    if (v.startsWith('|') || v.startsWith('>')) {
      blockScalarParent = topIndent();
      st.pending = 'closed';
      return null;
    }
    if (v.startsWith('*')) {
      st.pending = 'closed';
      return null;
    }
    if (/:(\s|$)/.test(v)) return problem('colonInValue', i, false);
    st.pending = 'plain';
    return null;
  };

  // A `key: value` or bare scalar at column col (the block is already pushed).
  const entry = (content: string, i: number, col: number): YamlProblem | null => {
    const c = keyColon(content);
    if (c < 0) {
      // A bare word where a key belongs: go-yaml says so at the next token.
      let next = i + 1;
      while (next < lines.length && (!lines[next]!.trim() || lines[next]!.trim().startsWith('#')))
        next++;
      return problem('missingColon', Math.min(next, eofLine), false, i + 1);
    }
    if (content.slice(0, c).startsWith('?')) return null;
    st.pending = 'none';
    const v = content.slice(c + 1).trim();
    if (v === '') {
      st.pending = 'emptyKey';
      emptyKeyCol = col;
      return null;
    }
    return value(v, i, col);
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    // Inside a block scalar (| or >): more-indented and blank lines are text.
    if (blockScalarParent !== null) {
      const ind = raw.length - raw.trimStart().length;
      if (!raw.trim() || ind > blockScalarParent) continue;
      blockScalarParent = null;
    }
    // Inside a quoted scalar that spans lines.
    if (openQuote) {
      if (quoteCloses(openQuote + raw.trimStart())) openQuote = null;
      continue;
    }
    // Inside a flow list or map that spans lines.
    if (flow > 0) {
      flow = flowDepth(stripComment(raw), flow);
      continue;
    }
    const lead = /^[ \t]*/.exec(raw)![0];
    if (lead.includes('\t') && raw.length > lead.length) return problem('tab', i, false);
    if (lead.includes('\t') && /^ *\t/.test(raw)) return problem('tab', i, false);
    const body = stripComment(raw).trimEnd();
    if (!body.trim()) continue;
    const col = lead.length;
    const content = body.slice(col);
    const isDash = content === '-' || content.startsWith('- ');

    // A plain scalar continues on deeper lines; a `: ` there is not allowed.
    if (st.pending === 'plain' && col > topIndent()) {
      if (/:(\s|$)/.test(content)) return problem('colonInValue', i, false);
      continue;
    }

    // Close blocks we have left.
    let popped = false;
    while (
      stack.length &&
      (top()!.indent > col || (top()!.indentless && top()!.indent === col && !isDash))
    ) {
      stack.pop();
      popped = true;
    }
    const t = top();
    const ti = topIndent();
    if (col > ti) {
      const opens = !t || (!popped && (st.pending === 'emptyKey' || st.pending === 'emptyItem'));
      if (!opens) return problem(t!.kind === 'seq' ? 'indentDash' : 'indentKey', i, true);
      if (!isDash && keyColon(content) < 0 && st.pending === 'emptyKey') {
        // `key:` then a more-indented plain value on the next line.
        const p = value(content, i, col);
        if (p) return p;
        continue;
      }
      stack.push({ kind: isDash ? 'seq' : 'map', indent: col });
    } else if (t && t.kind === 'map' && isDash) {
      if (st.pending === 'emptyKey' && emptyKeyCol === col)
        stack.push({ kind: 'seq', indent: col, indentless: true });
      else return problem('indentKey', i, true);
    } else if (t && t.kind === 'seq' && !isDash) {
      return problem('indentDash', i, true);
    }
    st.pending = 'none';

    if (!isDash) {
      const p = entry(content, i, col);
      if (p) return p;
      continue;
    }
    // Sequence entries: `-`, `- value`, `- key: value`, `- - nested`.
    let rest = content.slice(1);
    let itemCol = col + 1;
    while (rest.startsWith(' ')) {
      rest = rest.slice(1);
      itemCol++;
    }
    while (rest === '-' || rest.startsWith('- ')) {
      stack.push({ kind: 'seq', indent: itemCol });
      rest = rest.slice(1);
      itemCol++;
      while (rest.startsWith(' ')) {
        rest = rest.slice(1);
        itemCol++;
      }
    }
    if (rest === '') {
      st.pending = 'emptyItem';
      continue;
    }
    if (keyColon(rest) >= 0 && !/^[[{"']/.test(rest)) {
      stack.push({ kind: 'map', indent: itemCol });
      const p = entry(rest, i, itemCol);
      if (p) return p;
      continue;
    }
    if (/^["']/.test(rest) && keyColon(rest) >= 0) {
      stack.push({ kind: 'map', indent: itemCol });
      const p = entry(rest, i, itemCol);
      if (p) return p;
      continue;
    }
    const p = value(rest, i, itemCol);
    if (p) return p;
  }
  if (openQuote) return problem('unclosedQuote', eofLine, false);
  if (flow > 0) {
    const p = problem('unclosedFlow', eofLine, true);
    // A `{` list says '}' instead.
    const opener = /[[{][^[{]*$/.exec(doc)?.[0]?.[0];
    if (opener === '{') p.message = "did not find expected ',' or '}'";
    return p;
  }
  return null;
}

// --- Full parse (YAML 1.1, like go-yaml v2) -------------------------------------------------

type TagLike = { tag: string; format?: string };
const yamlOptions = {
  version: '1.1' as const,
  uniqueKeys: false,
  // go-yaml v2 keeps times and base-60 numbers ("12:30") as strings when making JSON.
  customTags: (tags: TagLike[]) =>
    tags.filter((t) => t.tag !== 'tag:yaml.org,2002:timestamp' && t.format !== 'TIME'),
};

export interface ParsedDoc {
  value: unknown;
  doc: Document;
}

export type ParseResult = { ok: true; parsed: ParsedDoc } | { ok: false; problem: YamlProblem };

/** Parse one document. Errors use go-yaml's words and line numbers. */
export function parseYamlDoc(text: string): ParseResult {
  const p = goYamlProblem(text);
  if (p) return { ok: false, problem: p };
  const doc = parseDocument(text, yamlOptions as never);
  if (doc.errors.length) {
    const e = doc.errors[0]!;
    const line = e.linePos?.[0]?.line ?? 1;
    const code: YamlErrorCode =
      e.code === 'TAB_AS_INDENT'
        ? 'tab'
        : e.code === 'MULTILINE_IMPLICIT_KEY'
          ? 'colonInValue'
          : e.code === 'MISSING_CHAR'
            ? 'unclosedQuote'
            : 'other';
    const scanner = code === 'tab' || code === 'colonInValue';
    return {
      ok: false,
      problem: { code, message: MSG[code], goLine: scanner ? line : Math.max(1, line - 1), line },
    };
  }
  let value: unknown;
  try {
    value = doc.toJS({ maxAliasCount: 100 });
  } catch {
    return { ok: false, problem: { code: 'other', message: MSG.other, goLine: 1, line: 1 } };
  }
  return { ok: true, parsed: { value: normalise(value), doc } };
}

/** JSON-like value: map keys become strings, like sigs.k8s.io/yaml does. */
function normalise(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(normalise);
  if (v instanceof Map)
    return Object.fromEntries([...v].map(([k, x]) => [String(k), normalise(x)]));
  if (v && typeof v === 'object')
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, normalise(x)]));
  return v;
}

/** 1-based document line of the node at `path` (the key's line for map entries). Falls back to the nearest parent. */
export function lineOfPath(doc: Document, text: string, path: (string | number)[]): number {
  let node: unknown = doc.contents;
  let offset = (doc.contents as Node | null)?.range?.[0] ?? 0;
  for (const seg of path) {
    if (isMap(node)) {
      const pair = node.items.find(
        (p) => isPair(p) && isScalar(p.key) && String(p.key.value) === String(seg),
      );
      if (!pair) break;
      offset = (pair.key as Node).range?.[0] ?? offset;
      node = pair.value;
    } else if (isSeq(node) && typeof seg === 'number') {
      const item = node.items[seg] as Node | undefined;
      if (!item) break;
      offset = item.range?.[0] ?? offset;
      node = item;
    } else break;
  }
  return text.slice(0, offset).split('\n').length;
}
