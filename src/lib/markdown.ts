// A small, safe Markdown renderer (a GitHub-flavoured subset) for previews.
//
// Safety rules:
// - Raw HTML in the source is never passed through. Every character of source
//   text is escaped; the only tags in the output come from the fixed templates here.
// - Links: only http, https, mailto or relative URLs. Anything else (javascript:,
//   data:, vbscript:, …) renders as plain text.
// - Images never load: they become a text placeholder with the alt text.
//
// Supported: ATX + setext headings, paragraphs, **bold**, *italic*, ~~strike~~,
// `code`, fenced code, lists (nested, ordered, task lists), links, autolinks,
// images (placeholder), blockquotes, GitHub alerts (> [!NOTE] …), tables with
// alignment, horizontal rules, #123 and @name (styled text, not links), and
// ```mermaid blocks (shown as labelled code).

export const ALERT_KINDS = ['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION'] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];

/** Words the renderer itself shows. Components pass them from the i18n files. */
export interface MarkdownLabels {
  alerts: Record<AlertKind, string>;
  /** Placeholder prefix for images, e.g. "Image". */
  image: string;
  /** Caption for ```mermaid blocks. */
  mermaid: string;
  /** Screen-reader names for task list boxes. */
  taskDone: string;
  taskTodo: string;
  /** Screen-reader note on links that open a new tab. */
  newTab: string;
}

export interface MarkdownOptions {
  labels: MarkdownLabels;
  /** `#` becomes `<h{1 + headingOffset}>` (max h6). The look stays the same. */
  headingOffset?: number;
  /** Single line breaks become <br> (like comments on code sites). */
  breaks?: boolean;
}

interface Ctx extends MarkdownOptions {
  depth: number;
}

const MAX_SOURCE = 20_000;
const MAX_DEPTH = 12;
const MAX_SCAN = 2_000;

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESC[c]!);
}

/**
 * Returns the URL if it is safe to link to, or null.
 * Allowed: http, https, mailto, and relative URLs (no scheme).
 */
export function safeUrl(raw: string): string | null {
  // Browsers ignore control characters and whitespace in URLs, so remove them
  // before looking at the scheme (stops "java\tscript:" tricks).
  // eslint-disable-next-line no-control-regex
  const url = raw.replace(/[\u0000- \u007f-\u009f]/g, '');
  if (!url) return null;
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(url);
  if (!m) return url;
  const scheme = m[1]!.toLowerCase();
  return scheme === 'http' || scheme === 'https' || scheme === 'mailto' ? url : null;
}

function isExternal(url: string): boolean {
  return /^(https?:)?\/\//i.test(url);
}

// ---------------------------------------------------------------------------
// Inline

const PUNCT = /[!-/:-@[-`{-~]/;
const WORD = /[\p{L}\p{N}_]/u;
const SPACE = /\s/;

function runLength(s: string, i: number, ch: string): number {
  let n = 0;
  while (s[i + n] === ch) n++;
  return n;
}

/** Index of the closing backtick run of exactly `len`, or -1. */
function codeClose(s: string, from: number, len: number): number {
  let j = from;
  const end = Math.min(s.length, from + MAX_SCAN);
  while (j < end) {
    if (s[j] === '`') {
      const r = runLength(s, j, '`');
      if (r === len) return j;
      j += r;
    } else j++;
  }
  return -1;
}

/** Skip over a code span starting at j (if it is one). Returns the new index. */
function skipCode(s: string, j: number): number {
  const r = runLength(s, j, '`');
  const close = codeClose(s, j + r, r);
  return close >= 0 ? close + r : j + r;
}

interface LinkParts {
  text: string;
  url: string;
  title: string;
  end: number;
}

/** Parse `[text](url "title")` starting at the `[`. */
function parseLink(s: string, start: number): LinkParts | null {
  let depth = 0;
  let j = start;
  const limit = Math.min(s.length, start + MAX_SCAN);
  let close = -1;
  while (j < limit) {
    const c = s[j]!;
    if (c === '\\') j += 2;
    else if (c === '`') j = skipCode(s, j);
    else {
      if (c === '[') depth++;
      else if (c === ']' && --depth === 0) {
        close = j;
        break;
      }
      j++;
    }
  }
  if (close < 0 || s[close + 1] !== '(') return null;
  let k = close + 2;
  while (s[k] === ' ' || s[k] === '\n') k++;
  let url = '';
  if (s[k] === '<') {
    const gt = s.indexOf('>', k);
    if (gt < 0 || s.slice(k, gt).includes('\n')) return null;
    url = s.slice(k + 1, gt);
    k = gt + 1;
  } else {
    let parens = 0;
    while (k < s.length && k < limit + MAX_SCAN) {
      const c = s[k]!;
      if (SPACE.test(c)) break;
      if (c === '\\' && s[k + 1] !== undefined && PUNCT.test(s[k + 1]!)) {
        url += s[k + 1];
        k += 2;
        continue;
      }
      if (c === '(') parens++;
      if (c === ')') {
        if (parens === 0) break;
        parens--;
      }
      url += c;
      k++;
    }
  }
  let title = '';
  let ws = k;
  while (s[ws] === ' ' || s[ws] === '\n') ws++;
  const q = s[ws];
  if (ws > k && (q === '"' || q === "'" || q === '(')) {
    const closer = q === '(' ? ')' : q;
    const endQ = s.indexOf(closer, ws + 1);
    if (endQ < 0) return null;
    title = s.slice(ws + 1, endQ);
    k = endQ + 1;
    while (s[k] === ' ' || s[k] === '\n') k++;
  } else k = ws;
  if (s[k] !== ')') return null;
  return { text: s.slice(start + 1, close), url, title, end: k + 1 };
}

function linkHtml(href: string, inner: string, title: string, ctx: Ctx): string {
  const t = title ? ` title="${escapeHtml(title)}"` : '';
  if (isExternal(href)) {
    return `<a href="${escapeHtml(href)}"${t} rel="noopener noreferrer nofollow" target="_blank">${inner}<span class="visually-hidden"> ${escapeHtml(ctx.labels.newTab)}</span></a>`;
  }
  if (/^mailto:/i.test(href)) return `<a href="${escapeHtml(href)}"${t} rel="noopener noreferrer nofollow">${inner}</a>`;
  return `<a href="${escapeHtml(href)}"${t} rel="noopener noreferrer nofollow" data-md-relative="true">${inner}</a>`;
}

function imageHtml(alt: string, ctx: Ctx): string {
  const text = alt.trim() ? `${ctx.labels.image}: ${alt.trim()}` : ctx.labels.image;
  return `<span class="md-img"><span aria-hidden="true">🖼 </span>${escapeHtml(text)}</span>`;
}

/** Find the closing emphasis delimiter run (exact length first, then longer). */
function findCloser(s: string, from: number, ch: string, len: number, cache: Map<string, number>): number {
  const key = `${ch}${len}`;
  const failedFrom = cache.get(key);
  if (failedFrom !== undefined && from >= failedFrom) return -1;
  const limit = Math.min(s.length, from + MAX_SCAN);
  for (const exact of [true, false]) {
    let j = from;
    while (j < limit) {
      const c = s[j]!;
      if (c === '\\') {
        j += 2;
        continue;
      }
      if (c === '`') {
        j = skipCode(s, j);
        continue;
      }
      if (c === ch) {
        const r = runLength(s, j, ch);
        const prev = s[j - 1] ?? ' ';
        const after = s[j + r] ?? ' ';
        const flankOk = !SPACE.test(prev) && j > from && (ch !== '_' || !WORD.test(after));
        if (flankOk && (exact ? r === len : r > len)) return j;
        j += r;
        continue;
      }
      j++;
    }
  }
  if (limit === s.length) cache.set(key, Math.min(from, failedFrom ?? Infinity));
  return -1;
}

function inline(s: string, ctx: Ctx, noLinks = false): string {
  let out = '';
  let i = 0;
  const n = s.length;
  const cache = new Map<string, number>();
  while (i < n) {
    const c = s[i]!;

    if (c === '\\') {
      const nx = s[i + 1];
      if (nx === '\n') {
        out += '<br>\n';
        i += 2;
        continue;
      }
      if (nx !== undefined && PUNCT.test(nx)) {
        out += escapeHtml(nx);
        i += 2;
        continue;
      }
      out += '\\';
      i++;
      continue;
    }

    if (c === '`') {
      const r = runLength(s, i, '`');
      const close = codeClose(s, i + r, r);
      if (close >= 0) {
        let code = s.slice(i + r, close).replace(/\n/g, ' ');
        if (code.length > 2 && code.startsWith(' ') && code.endsWith(' ') && code.trim()) code = code.slice(1, -1);
        out += `<code>${escapeHtml(code)}</code>`;
        i = close + r;
      } else {
        out += '`'.repeat(r);
        i += r;
      }
      continue;
    }

    if (c === '!' && s[i + 1] === '[') {
      const l = parseLink(s, i + 1);
      if (l) {
        out += imageHtml(l.text, ctx);
        i = l.end;
        continue;
      }
    }

    if (c === '[' && !noLinks) {
      const l = parseLink(s, i);
      if (l) {
        const href = safeUrl(l.url);
        const inner = inline(l.text, ctx, true);
        out += href ? linkHtml(href, inner, l.title, ctx) : inner;
        i = l.end;
        continue;
      }
    }

    if (c === '<') {
      const m = /^<([a-z][a-z0-9+.-]{1,31}:[^\s<>]*)>/i.exec(s.slice(i, i + 500)) ?? /^<([^\s<>@]+@[^\s<>@]+\.[^\s<>@]+)>/.exec(s.slice(i, i + 500));
      if (m && !noLinks) {
        const raw = m[1]!;
        const href = safeUrl(raw.includes(':') ? raw : `mailto:${raw}`);
        out += href ? linkHtml(href, escapeHtml(raw), '', ctx) : escapeHtml(m[0]);
        i += m[0].length;
        continue;
      }
    }

    if ((c === 'h' || c === 'H') && !noLinks && !WORD.test(s[i - 1] ?? ' ')) {
      const m = /^https?:\/\/[^\s<]+/i.exec(s.slice(i, i + 2000));
      if (m) {
        let url = m[0];
        // Trailing punctuation is not part of the URL.
        for (;;) {
          const last = url[url.length - 1]!;
          if (/[.,:;!?"'*_~]/.test(last)) url = url.slice(0, -1);
          else if (last === ')' && (url.match(/\(/g)?.length ?? 0) < (url.match(/\)/g)?.length ?? 0)) url = url.slice(0, -1);
          else break;
        }
        const href = safeUrl(url);
        if (href && url.length > 8) {
          out += linkHtml(href, escapeHtml(url), '', ctx);
          i += url.length;
          continue;
        }
      }
    }

    if (c === '*' || c === '_' || (c === '~' && s[i + 1] === '~')) {
      const run = runLength(s, i, c);
      const prev = s[i - 1] ?? ' ';
      const next = s[i + run] ?? ' ';
      const canOpen = !SPACE.test(next) && (c !== '_' || !WORD.test(prev));
      if (canOpen) {
        const lens = c === '~' ? (run === 2 ? [2] : []) : [Math.min(run, 3), Math.min(run, 3) - 1, Math.min(run, 3) - 2].filter((x) => x > 0);
        let done = false;
        for (const len of lens) {
          const at = i + run - len; // the opener is the last `len` characters of the run
          const close = findCloser(s, at + len, c, len, cache);
          if (close > at + len) {
            const inner = inline(s.slice(at + len, close), ctx, noLinks);
            const wrapped =
              c === '~' ? `<del>${inner}</del>` : len === 3 ? `<em><strong>${inner}</strong></em>` : len === 2 ? `<strong>${inner}</strong>` : `<em>${inner}</em>`;
            out += escapeHtml(c.repeat(run - len)) + wrapped;
            i = close + len;
            done = true;
            break;
          }
        }
        if (done) continue;
      }
      out += escapeHtml(c.repeat(run));
      i += run;
      continue;
    }

    if (c === '#' && !WORD.test(s[i - 1] ?? ' ') && s[i - 1] !== '&') {
      const m = /^#(\d{1,7})(?![\p{L}\p{N}_])/u.exec(s.slice(i, i + 10));
      if (m) {
        out += `<span class="md-ref">${m[0]}</span>`;
        i += m[0].length;
        continue;
      }
    }

    if (c === '@' && !/[\p{L}\p{N}_.@/-]/u.test(s[i - 1] ?? ' ')) {
      const m = /^@([A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38})(?![A-Za-z0-9_-])/.exec(s.slice(i, i + 41));
      if (m) {
        out += `<span class="md-mention">${escapeHtml(m[0])}</span>`;
        i += m[0].length;
        continue;
      }
    }

    if (c === ' ') {
      const m = /^ {2,}\n/.exec(s.slice(i, i + 100));
      if (m) {
        out += '<br>\n';
        i += m[0].length;
        continue;
      }
    }

    if (c === '\n') {
      out += ctx.breaks ? '<br>\n' : '\n';
      i++;
      continue;
    }

    out += ESC[c] ?? c;
    i++;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Blocks

const FENCE = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const HEADING = /^ {0,3}(#{1,6})(?=[ \t]|$)(.*)$/;
const HR = /^ {0,3}([-*_])[ \t]*(?:\1[ \t]*){2,}$/;
const QUOTE = /^ {0,3}>/;
const LIST = /^( *)([-*+]|\d{1,9}[.)])([ \t]+|$)(.*)$/;
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;
const DELIM_ROW = /^ *\|? *:?-+:? *(?:\| *:?-+:? *)*\|? *$/;

const isBlank = (l: string) => l.trim() === '';
const indentOf = (l: string) => l.length - l.trimStart().length;

function isFenceOpen(l: string): RegExpExecArray | null {
  const m = FENCE.exec(l);
  if (!m) return null;
  if (m[2]![0] === '`' && m[3]!.includes('`')) return null;
  return m;
}

function splitRow(l: string): string[] {
  let row = l.trim();
  if (row.startsWith('|')) row = row.slice(1);
  if (row.endsWith('|') && !row.endsWith('\\|')) row = row.slice(0, -1);
  const cells: string[] = [];
  let cur = '';
  for (let i = 0; i < row.length; i++) {
    const c = row[i]!;
    if (c === '\\' && row[i + 1] === '|') {
      cur += '|';
      i++;
    } else if (c === '|') {
      cells.push(cur.trim());
      cur = '';
    } else cur += c;
  }
  cells.push(cur.trim());
  return cells;
}

function isTableStart(lines: string[], i: number): boolean {
  const head = lines[i];
  const delim = lines[i + 1];
  if (head === undefined || delim === undefined || !head.includes('|') || !DELIM_ROW.test(delim)) return false;
  if (!delim.includes('|') && !/^ *:?-+:? *$/.test(delim)) return false;
  return splitRow(head).length === splitRow(delim).length;
}

/** Can this line interrupt a paragraph? */
function startsBlock(l: string): boolean {
  if (isFenceOpen(l) || HEADING.test(l) || HR.test(l) || QUOTE.test(l)) return true;
  const m = LIST.exec(l);
  if (m && indentOf(l) < 4 && m[4]!.trim() !== '') {
    return !/\d/.test(m[2]!) || (m[2]!.startsWith('1') && m[2]!.length === 2);
  }
  return false;
}

function headingHtml(level: number, text: string, ctx: Ctx): string {
  const tag = Math.min(6, level + (ctx.headingOffset ?? 0));
  return `<h${tag} class="md-h${level}">${inline(text, ctx)}</h${tag}>`;
}

function codeHtml(code: string, info: string, ctx: Ctx): string {
  const lang = info.toLowerCase().replace(/[^a-z0-9+#-]/g, '').slice(0, 20);
  const body = `<pre class="md-code"><code${lang ? ` class="language-${lang}"` : ''}>${escapeHtml(code)}</code></pre>`;
  if (lang === 'mermaid') {
    return `<figure class="md-mermaid"><figcaption><span aria-hidden="true">◇ </span>${escapeHtml(ctx.labels.mermaid)}</figcaption>${body}</figure>`;
  }
  return body;
}

const ALERT_ICONS: Record<AlertKind, string> = { NOTE: 'ℹ', TIP: '★', IMPORTANT: '!', WARNING: '⚠', CAUTION: '⛔' };

function listHtml(lines: string[], start: number, ctx: Ctx): { html: string; next: number } {
  const first = LIST.exec(lines[start]!)!;
  const ordered = /\d/.test(first[2]!);
  const delim = ordered ? first[2]!.slice(-1) : first[2]!;
  const startNum = ordered ? parseInt(first[2]!, 10) : 1;
  const items: { lines: string[]; blankInside: boolean }[] = [];
  let loose = false;
  let i = start;
  const n = lines.length;
  const sameKind = (m: RegExpExecArray) => (ordered ? /\d/.test(m[2]!) && m[2]!.slice(-1) === delim : m[2] === delim);

  while (i < n) {
    const m = LIST.exec(lines[i]!);
    if (!m || !sameKind(m) || HR.test(lines[i]!)) break;
    const markerIndent = m[1]!.length;
    const spaces = m[3]!.length;
    const contentIndent = markerIndent + m[2]!.length + (spaces >= 1 && spaces <= 4 ? spaces : 1);
    const item = { lines: [m[4]!], blankInside: false };
    i++;
    while (i < n) {
      const l = lines[i]!;
      if (isBlank(l)) {
        let k = i;
        while (k < n && isBlank(lines[k]!)) k++;
        if (k < n && indentOf(lines[k]!) >= contentIndent && item.lines.some((x) => x.trim())) {
          for (; i < k; i++) item.lines.push('');
          item.blankInside = true;
          continue;
        }
        break;
      }
      if (indentOf(l) >= contentIndent) {
        item.lines.push(l.slice(contentIndent));
        i++;
        continue;
      }
      if (LIST.test(l) && !HR.test(l)) break;
      const last = item.lines[item.lines.length - 1] ?? '';
      if (last.trim() && !startsBlock(l)) {
        item.lines.push(l.trim());
        i++;
        continue;
      }
      break;
    }
    items.push(item);
    if (item.blankInside && item.lines.slice(1).some((x) => x.trim())) {
      // A blank line between two blocks inside one item makes the list loose,
      // unless the blank only separates a nested list.
      const firstBlank = item.lines.indexOf('');
      const afterBlank = item.lines.slice(firstBlank).find((x) => x.trim());
      if (afterBlank && !LIST.test(afterBlank)) loose = true;
    }
    let k = i;
    while (k < n && isBlank(lines[k]!)) k++;
    const nm = k < n ? LIST.exec(lines[k]!) : null;
    if (k > i && nm && sameKind(nm) && nm[1]!.length < contentIndent) {
      loose = true;
      i = k;
    } else if (k > i) break;
  }

  const lis = items.map(({ lines: itemLines }) => {
    const task = /^\[([ xX])\](?:[ \t]+|$)/.exec(itemLines[0] ?? '');
    const body = task ? [itemLines[0]!.slice(task[0].length), ...itemLines.slice(1)] : itemLines;
    let html = blocks(body, { ...ctx, depth: ctx.depth + 1 }, !loose);
    if (!task) return `<li>${html}</li>`;
    const checked = task[1] !== ' ';
    const box = `<input type="checkbox" disabled${checked ? ' checked' : ''} aria-label="${escapeHtml(checked ? ctx.labels.taskDone : ctx.labels.taskTodo)}"> `;
    html = html.startsWith('<p>') ? `<p>${box}${html.slice(3)}` : box + html;
    return `<li class="md-task">${html}</li>`;
  });
  const tag = ordered ? 'ol' : 'ul';
  const startAttr = ordered && startNum !== 1 ? ` start="${startNum}"` : '';
  const cls = items.some(({ lines: l }) => /^\[[ xX]\]/.test(l[0] ?? '')) ? ' class="md-tasks"' : '';
  return { html: `<${tag}${startAttr}${cls}>\n${lis.join('\n')}\n</${tag}>`, next: i };
}

function tableHtml(lines: string[], start: number, ctx: Ctx): { html: string; next: number } {
  const head = splitRow(lines[start]!);
  const aligns = splitRow(lines[start + 1]!).map((d) => {
    const l = d.startsWith(':');
    const r = d.endsWith(':');
    return l && r ? 'center' : r ? 'right' : l ? 'left' : '';
  });
  const cell = (tag: 'th' | 'td', text: string, col: number) => {
    const a = aligns[col];
    return `<${tag}${a ? ` class="md-al-${a}"` : ''}>${inline(text, ctx)}</${tag}>`;
  };
  let i = start + 2;
  const rows: string[] = [];
  while (i < lines.length) {
    const l = lines[i]!;
    if (isBlank(l) || startsBlock(l)) break;
    const cells = splitRow(l);
    rows.push(`<tr>${head.map((_, c) => cell('td', cells[c] ?? '', c)).join('')}</tr>`);
    i++;
  }
  const thead = `<thead><tr>${head.map((h, c) => cell('th', h, c)).join('')}</tr></thead>`;
  const tbody = rows.length ? `<tbody>${rows.join('')}</tbody>` : '';
  return { html: `<table class="md-table">${thead}${tbody}</table>`, next: i };
}

function blocks(lines: string[], ctx: Ctx, tight = false): string {
  const out: string[] = [];
  const n = lines.length;
  let i = 0;
  if (ctx.depth > MAX_DEPTH) return `<p>${escapeHtml(lines.join('\n'))}</p>`;

  while (i < n) {
    const line = lines[i]!;
    if (isBlank(line)) {
      i++;
      continue;
    }

    const fence = isFenceOpen(line);
    if (fence) {
      const indent = fence[1]!.length;
      const mark = fence[2]!;
      const info = fence[3]!.trim().split(/\s+/)[0] ?? '';
      const body: string[] = [];
      i++;
      while (i < n) {
        const l = lines[i]!;
        const cm = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(l);
        if (cm && cm[1]![0] === mark[0] && cm[1]!.length >= mark.length) {
          i++;
          break;
        }
        body.push(l.slice(Math.min(indent, indentOf(l))));
        i++;
      }
      out.push(codeHtml(body.join('\n'), info, ctx));
      continue;
    }

    const h = HEADING.exec(line);
    if (h) {
      const text = h[2]!.trim().replace(/(?:^|[ \t]+)#+[ \t]*$/, '').trim();
      out.push(headingHtml(h[1]!.length, text, ctx));
      i++;
      continue;
    }

    if (HR.test(line)) {
      out.push('<hr>');
      i++;
      continue;
    }

    if (QUOTE.test(line)) {
      const inner: string[] = [];
      while (i < n) {
        const l = lines[i]!;
        if (QUOTE.test(l)) inner.push(l.replace(/^ {0,3}> ?/, ''));
        else if (!isBlank(l) && inner.length && !isBlank(inner[inner.length - 1]!) && !startsBlock(l)) inner.push(l);
        else break;
        i++;
      }
      const alert = /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/i.exec(inner[0] ?? '');
      const sub = { ...ctx, depth: ctx.depth + 1 };
      if (alert) {
        const kind = alert[1]!.toUpperCase() as AlertKind;
        const title = `<p class="md-alert-title"><span class="md-alert-icon" aria-hidden="true">${ALERT_ICONS[kind]}</span> ${escapeHtml(ctx.labels.alerts[kind])}</p>`;
        out.push(`<div class="md-alert md-alert-${kind.toLowerCase()}" role="note">${title}\n${blocks(inner.slice(1), sub)}</div>`);
      } else out.push(`<blockquote>\n${blocks(inner, sub)}\n</blockquote>`);
      continue;
    }

    if (LIST.test(line)) {
      const r = listHtml(lines, i, ctx);
      out.push(r.html);
      i = r.next;
      continue;
    }

    if (isTableStart(lines, i)) {
      const r = tableHtml(lines, i, ctx);
      out.push(r.html);
      i = r.next;
      continue;
    }

    // Paragraph (or setext heading).
    const para: string[] = [line.trimStart()];
    i++;
    let setext = 0;
    while (i < n) {
      const l = lines[i]!;
      const st = SETEXT.exec(l);
      if (st) {
        setext = st[1]![0] === '=' ? 1 : 2;
        i++;
        break;
      }
      if (isBlank(l) || startsBlock(l)) break;
      para.push(l.trimStart());
      i++;
    }
    const text = para.join('\n').replace(/[ \t]+$/, '');
    if (setext) out.push(headingHtml(setext, text, ctx));
    else out.push(tight ? inline(text, ctx) : `<p>${inline(text, ctx)}</p>`);
  }
  return out.join('\n');
}

/** Render Markdown source to safe HTML. */
export function renderMarkdown(source: string, options: MarkdownOptions): string {
  const src = source.length > MAX_SOURCE ? source.slice(0, MAX_SOURCE) : source;
  const lines = src
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/^\t+/, (t) => '    '.repeat(t.length)));
  return blocks(lines, { ...options, depth: 0 });
}
