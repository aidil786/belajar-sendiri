import { describe, expect, it } from 'vitest';
import { escapeHtml, renderMarkdown, safeUrl, type MarkdownLabels } from './markdown';

const labels: MarkdownLabels = {
  alerts: { NOTE: 'Note', TIP: 'Tip', IMPORTANT: 'Important', WARNING: 'Warning', CAUTION: 'Caution' },
  image: 'Image',
  mermaid: 'Diagram code (Mermaid)',
  taskDone: 'Done',
  taskTodo: 'To do',
  newTab: '(opens in a new tab)',
};
const md = (src: string, opts: { breaks?: boolean; headingOffset?: number } = {}) => renderMarkdown(src, { labels, ...opts });

// Every tag and attribute the renderer may produce. Anything else means raw HTML leaked.
const TAGS = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'em', 'del', 'code', 'pre', 'ul', 'ol', 'li', 'input', 'a', 'span',
  'blockquote', 'div', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr', 'br', 'figure', 'figcaption',
]);
const ATTRS = new Set(['class', 'href', 'title', 'rel', 'target', 'type', 'disabled', 'checked', 'aria-label', 'aria-hidden', 'role', 'start', 'data-md-relative']);

function assertSafe(html: string) {
  for (const m of html.matchAll(/<\/?([a-zA-Z][\w-]*)([^>]*)>/g)) {
    expect(TAGS, `tag <${m[1]}> in ${html}`).toContain(m[1]!.toLowerCase());
    const attrs = m[2]!.replace(/"[^"]*"/g, '""');
    for (const a of attrs.matchAll(/([^\s=]+)(?:="")?/g)) {
      expect(ATTRS, `attribute ${a[1]} in ${m[0]}`).toContain(a[1]!.toLowerCase());
    }
    for (const h of m[2]!.matchAll(/href="([^"]*)"/g)) {
      // eslint-disable-next-line no-control-regex
      const value = h[1]!.replace(/&amp;/g, '&').replace(/[\s\u0000-\u001f]/g, '');
      expect(value).not.toMatch(/^(javascript|data|vbscript|file):/i);
    }
  }
}

describe('escapeHtml and safeUrl', () => {
  it('escapes the five HTML characters', () => {
    expect(escapeHtml(`<a href="x" onclick='y'>&</a>`)).toBe('&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
  });

  it('allows http, https, mailto and relative links only', () => {
    expect(safeUrl('https://example.com')).toBe('https://example.com');
    expect(safeUrl('http://example.com')).toBe('http://example.com');
    expect(safeUrl('mailto:me@example.com')).toBe('mailto:me@example.com');
    expect(safeUrl('docs/README.md')).toBe('docs/README.md');
    expect(safeUrl('#install')).toBe('#install');
    expect(safeUrl('../x')).toBe('../x');
    for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' javascript:alert(1)', 'java\tscript:alert(1)', 'java\nscript:x', '\u0000javascript:x', 'data:text/html,<b>', 'vbscript:x', 'file:///etc/passwd', '']) {
      expect(safeUrl(bad), bad).toBeNull();
    }
  });
});

describe('blocks', () => {
  it('headings, with the heading offset and closing hashes', () => {
    expect(md('# Hello')).toBe('<h1 class="md-h1">Hello</h1>');
    expect(md('## Hi ##', { headingOffset: 1 })).toBe('<h3 class="md-h2">Hi</h3>');
    expect(md('###### Six', { headingOffset: 2 })).toBe('<h6 class="md-h6">Six</h6>');
    expect(md('#hashtag')).toBe('<p>#hashtag</p>');
  });

  it('setext headings', () => {
    expect(md('Title\n=====')).toBe('<h1 class="md-h1">Title</h1>');
    expect(md('Sub\n---')).toBe('<h2 class="md-h2">Sub</h2>');
  });

  it('paragraphs and line breaks', () => {
    expect(md('one\ntwo\n\nthree')).toBe('<p>one\ntwo</p>\n<p>three</p>');
    expect(md('one\ntwo', { breaks: true })).toBe('<p>one<br>\ntwo</p>');
    expect(md('one  \ntwo')).toBe('<p>one<br>\ntwo</p>');
    expect(md('one\\\ntwo')).toBe('<p>one<br>\ntwo</p>');
  });

  it('horizontal rules', () => {
    expect(md('---')).toBe('<hr>');
    expect(md('* * *')).toBe('<hr>');
    expect(md('a\n\n___')).toBe('<p>a</p>\n<hr>');
  });

  it('fenced code keeps everything as text', () => {
    expect(md('```js\nconst a = "<b>";\n```')).toBe('<pre class="md-code"><code class="language-js">const a = &quot;&lt;b&gt;&quot;;</code></pre>');
    expect(md('~~~\n**not bold**\n~~~')).toBe('<pre class="md-code"><code>**not bold**</code></pre>');
    expect(md('```\nunclosed')).toBe('<pre class="md-code"><code>unclosed</code></pre>');
  });

  it('mermaid becomes a labelled code block (no diagram library)', () => {
    const html = md('```mermaid\ngraph TD; A-->B\n```');
    expect(html).toContain('<figure class="md-mermaid">');
    expect(html).toContain('Diagram code (Mermaid)');
    expect(html).toContain('graph TD; A--&gt;B');
  });

  it('bullet and numbered lists, nested', () => {
    expect(md('- a\n- b')).toBe('<ul>\n<li>a</li>\n<li>b</li>\n</ul>');
    expect(md('1. a\n2. b')).toBe('<ol>\n<li>a</li>\n<li>b</li>\n</ol>');
    expect(md('3. a\n4. b')).toBe('<ol start="3">\n<li>a</li>\n<li>b</li>\n</ol>');
    expect(md('- a\n  - b\n  - c\n- d')).toBe('<ul>\n<li>a\n<ul>\n<li>b</li>\n<li>c</li>\n</ul></li>\n<li>d</li>\n</ul>');
    expect(md('* one\n* two')).toContain('<li>two</li>');
  });

  it('loose lists wrap items in paragraphs', () => {
    expect(md('- a\n\n- b')).toBe('<ul>\n<li><p>a</p></li>\n<li><p>b</p></li>\n</ul>');
  });

  it('task lists render disabled checkboxes with names', () => {
    const html = md('- [x] Write README\n- [ ] Add licence');
    expect(html).toContain('<ul class="md-tasks">');
    expect(html).toContain('<li class="md-task"><input type="checkbox" disabled checked aria-label="Done"> Write README</li>');
    expect(html).toContain('<li class="md-task"><input type="checkbox" disabled aria-label="To do"> Add licence</li>');
  });

  it('blockquotes, nested', () => {
    expect(md('> hi\n> there')).toBe('<blockquote>\n<p>hi\nthere</p>\n</blockquote>');
    expect(md('> a\n>> b')).toContain('<blockquote>\n<p>b</p>\n</blockquote>');
  });

  it('GitHub alerts show an icon and a label, not only a colour', () => {
    for (const [kind, label] of [['NOTE', 'Note'], ['TIP', 'Tip'], ['IMPORTANT', 'Important'], ['WARNING', 'Warning'], ['CAUTION', 'Caution']] as const) {
      const html = md(`> [!${kind}]\n> Read this.`);
      expect(html).toContain(`<div class="md-alert md-alert-${kind.toLowerCase()}" role="note">`);
      expect(html).toContain(`aria-hidden="true">`);
      expect(html).toContain(` ${label}</p>`);
      expect(html).toContain('<p>Read this.</p>');
    }
    expect(md('> [!note]\n> lower case works')).toContain('md-alert-note');
    expect(md('> [!NOPE]\n> x')).toContain('<blockquote>');
  });

  it('tables with alignment', () => {
    const html = md('| Name | Age | City |\n| :--- | ---: | :---: |\n| Ali | 12 | KL |\n| Mei | 13 |');
    expect(html).toContain('<thead><tr><th class="md-al-left">Name</th><th class="md-al-right">Age</th><th class="md-al-center">City</th></tr></thead>');
    expect(html).toContain('<tr><td class="md-al-left">Ali</td><td class="md-al-right">12</td><td class="md-al-center">KL</td></tr>');
    expect(html).toContain('<tr><td class="md-al-left">Mei</td><td class="md-al-right">13</td><td class="md-al-center"></td></tr>');
    expect(md('a | b\n--- | ---\n1 | 2')).toContain('<td>1</td><td>2</td>');
    expect(md('| a \\| b |\n| --- |')).toContain('<th>a | b</th>');
  });

  it('a lone pipe line is just a paragraph', () => {
    expect(md('a | b')).toBe('<p>a | b</p>');
  });
});

describe('inline', () => {
  it('bold, italic, strike, code', () => {
    expect(md('**b** *i* _i_ __b__ ~~s~~ `c`')).toBe('<p><strong>b</strong> <em>i</em> <em>i</em> <strong>b</strong> <del>s</del> <code>c</code></p>');
    expect(md('***both***')).toBe('<p><em><strong>both</strong></em></p>');
    expect(md('*a **b** c*')).toBe('<p><em>a <strong>b</strong> c</em></p>');
    expect(md('snake_case_name')).toBe('<p>snake_case_name</p>');
    expect(md('2 * 3 * 4')).toBe('<p>2 * 3 * 4</p>');
    expect(md('``a ` b``')).toBe('<p><code>a ` b</code></p>');
    expect(md('\\*not em\\*')).toBe('<p>*not em*</p>');
  });

  it('links get rel and a new-tab note; relative links are marked', () => {
    expect(md('[Docs](https://docs.github.com "Help")')).toBe(
      '<p><a href="https://docs.github.com" title="Help" rel="noopener noreferrer nofollow" target="_blank">Docs<span class="visually-hidden"> (opens in a new tab)</span></a></p>',
    );
    expect(md('[Guide](CONTRIBUTING.md)')).toBe('<p><a href="CONTRIBUTING.md" rel="noopener noreferrer nofollow" data-md-relative="true">Guide</a></p>');
    expect(md('[Mail](mailto:a@b.co)')).toBe('<p><a href="mailto:a@b.co" rel="noopener noreferrer nofollow">Mail</a></p>');
    expect(md('<https://example.com>')).toContain('<a href="https://example.com"');
    expect(md('Go to https://example.com/a_(b). Done')).toContain('<a href="https://example.com/a_(b)"');
  });

  it('images never load: alt text placeholder', () => {
    const html = md('![A cat](https://example.com/cat.png)');
    expect(html).toBe('<p><span class="md-img"><span aria-hidden="true">🖼 </span>Image: A cat</span></p>');
    expect(html).not.toContain('<img');
  });

  it('#123 and @name are styled text, not links', () => {
    expect(md('Fixes #12, thanks @aina-dev!')).toBe('<p>Fixes <span class="md-ref">#12</span>, thanks <span class="md-mention">@aina-dev</span>!</p>');
    expect(md('mail you@example.com')).not.toContain('md-mention');
    expect(md('`#12 @x`')).toBe('<p><code>#12 @x</code></p>');
    expect(md('C#12')).not.toContain('md-ref');
  });
});

describe('XSS attempts stay harmless', () => {
  const attacks = [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '<svg onload=alert(1)>',
    '<a href="javascript:alert(1)">x</a>',
    '[x](javascript:alert(1))',
    '[x](JaVaScRiPt:alert(1))',
    '[x](<java script:alert(1)>)',
    '[x](javascript&colon;alert(1))',
    '[x](&#106;avascript:alert(1))',
    '[x](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)',
    '[x](vbscript:msgbox(1))',
    '![x](javascript:alert(1))',
    '![x" onerror="alert(1)](https://e.com/a.png)',
    '<javascript:alert(1)>',
    '[x](https://ok.com" onmouseover="alert(1))',
    '[x](https://ok.com "a\\" onmouseover=\\"alert(1)")',
    '[x](https://ok.com \'a" onmouseover="b\')',
    '**<b onmouseover=alert(1)>bold</b>**',
    '# <iframe src=//evil>',
    '| <script>x</script> | b |\n| --- | --- |\n| <img src=x onerror=y> | c |',
    '- [x] <script>alert(1)</script>',
    '> [!NOTE]\n> <style>body{display:none}</style>',
    '```"><script>alert(1)</script>\ncode\n```',
    '```js" onclick="alert(1)\nx\n```',
    '`</code><script>alert(1)</script>`',
    '@"><script>',
    '#1"><script>',
    'https://e.com/"onmouseover="alert(1)',
    'https://e.com/<script>alert(1)</script>',
    '<!-- comment --> <![CDATA[x]]> <?php ?>',
    '&lt;script&gt; &#60;script&#62;',
    '[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[]]]]]]]]]',
    '*'.repeat(5000),
    '*a '.repeat(3000),
    '>'.repeat(200) + ' deep',
  ];

  for (const a of attacks) {
    it(JSON.stringify(a.slice(0, 50)), () => {
      for (const opts of [{}, { breaks: true }]) {
        const html = md(a, opts);
        assertSafe(html);
        expect(html).not.toMatch(/<script|<img|<svg|<iframe|<style|<!--/i);
        // Event handlers outside quoted attribute values would run.
        expect(html.replace(/"[^"]*"/g, '""')).not.toMatch(/<[^>]*\son\w+\s*=/i);
      }
    });
  }

  it('entities in the source are shown as text, not decoded', () => {
    expect(md('&lt;b&gt;')).toBe('<p>&amp;lt;b&amp;gt;</p>');
  });

  it('a javascript link keeps its text but loses the link', () => {
    expect(md('[click me](javascript:alert(1))')).toBe('<p>click me</p>');
  });

  it('long input is fast enough', () => {
    const big = Array.from({ length: 400 }, (_, i) => `- item ${i} with **bold** and [link](https://e.com/${i}) and \`code\``).join('\n');
    const t0 = Date.now();
    md(big);
    md('*a _b ~~c '.repeat(1500));
    md('['.repeat(5000) + ']('.repeat(2000));
    // Generous on purpose: this guards against runaway (quadratic) parsing, not a slow CI machine.
    expect(Date.now() - t0).toBeLessThan(5000);
  });
});
