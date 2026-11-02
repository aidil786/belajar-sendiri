// World 5 scenarios (Teamwork). Most of World 5 happens on the practice repo page
// (PracticeRepo), so these are small: the code club's site with a few text files to read
// with `cat`. Each "-ms" twin holds the same file in Malay for the BM lesson.
import type { Scenario, ScenarioStep } from '~/engine/git-sim';

/** The code club's site: one commit with a home page, plus the given files. */
function clubSite(files: Record<string, string>): ScenarioStep[] {
  return [
    'mkdir club-site',
    'cd club-site',
    'git init',
    { write: 'index.html', content: '<h1>Code Club</h1>\n<p>We meet every Friday.</p>\n' },
    ...Object.entries(files).map(([path, content]) => ({ write: path, content })),
    'git add .',
    'git commit -m "Add club site"',
  ];
}

const lines = (...l: string[]) => `${l.join('\n')}\n`;

// 5.2 Markdown basics: a README full of Markdown signs, read raw with cat.
const README_EN = lines(
  '# Club Site',
  '',
  'The website for our **school code club**.',
  '',
  '## Get started',
  '',
  '1. Download the files.',
  '2. Open `index.html` in your browser.',
  '',
  '## Links',
  '',
  '- [How to help](CONTRIBUTING.md)',
  '- [Our school](https://example.com)',
);
const README_MS = lines(
  '# Laman Kelab',
  '',
  'Laman web untuk **kelab kod sekolah** kami.',
  '',
  '## Mula di sini',
  '',
  '1. Muat turun fail-fail ini.',
  '2. Buka `index.html` dalam pelayar anda.',
  '',
  '## Pautan',
  '',
  '- [Cara membantu](CONTRIBUTING.md)',
  '- [Sekolah kami](https://example.com)',
);

// 5.6 Issue templates: a bug report template (front matter + blanks to fill).
const TEMPLATE_EN = lines(
  '---',
  'name: Bug report',
  'about: Tell us what is broken',
  'labels: bug',
  '---',
  '',
  '## What happened?',
  '',
  '## Steps to see it',
  '1.',
  '',
  '## Phone or computer?',
);
const TEMPLATE_MS = lines(
  '---',
  'name: Laporan pepijat',
  'about: Beritahu kami apa yang rosak',
  'labels: bug',
  '---',
  '',
  '## Apa yang berlaku?',
  '',
  '## Langkah untuk nampak masalah',
  '1.',
  '',
  '## Telefon atau komputer?',
);

// 5.12 CODEOWNERS: the last matching line wins, so the catch-all comes first.
const OWNERS_EN = lines('# Aina reviews everything...', '*        @aina', '# ...except these.', '*.css    @mei', '/docs/   @ravi');
const OWNERS_MS = lines('# Aina semak semua fail...', '*        @aina', '# ...kecuali yang ini.', '*.css    @mei', '/docs/   @ravi');

export const w05: Scenario[] = [
  { id: 'w05-l02', steps: clubSite({ 'README.md': README_EN }), verify: [['cat README.md', 'git status -s']] },
  { id: 'w05-l02-ms', steps: clubSite({ 'README.md': README_MS }), verify: [['cat README.md', 'git status -s']] },
  {
    id: 'w05-l06',
    steps: clubSite({ '.github/ISSUE_TEMPLATE/bug_report.md': TEMPLATE_EN }),
    verify: [['cat .github/ISSUE_TEMPLATE/bug_report.md', 'git status -s']],
  },
  {
    id: 'w05-l06-ms',
    steps: clubSite({ '.github/ISSUE_TEMPLATE/bug_report.md': TEMPLATE_MS }),
    verify: [['cat .github/ISSUE_TEMPLATE/bug_report.md', 'git status -s']],
  },
  { id: 'w05-l12', steps: clubSite({ '.github/CODEOWNERS': OWNERS_EN }), verify: [['cat .github/CODEOWNERS', 'git status -s']] },
  { id: 'w05-l12-ms', steps: clubSite({ '.github/CODEOWNERS': OWNERS_MS }), verify: [['cat .github/CODEOWNERS', 'git status -s']] },
];
