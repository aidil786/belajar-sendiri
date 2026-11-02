// Truth check: replay every scenario's `verify` command lists in the engine AND in
// real Git (in a temp folder, fixed identity), then compare structure:
// staged files, working-tree changes, untracked and unmerged files, history, branches
// (local and remote-tracking), tags, stash, upstreams, remotes, the hosted repos,
// HEAD state, a stopped merge/rebase/cherry-pick, file contents and selected outputs.
// Real Git runs on the engine's clock (each command gets the engine's time after it),
// so object ids match whenever the engine makes the same objects. Hashes are masked
// unless a scenario sets `exactHashes` (stash and rebase make several commits at
// slightly different engine times, so their ids differ).
//
// Hosted repos: https://github.com/<path> maps to a local bare repo in the temp folder
// (via `url.<dir>.insteadOf`), and the mapped paths are turned back into URLs before comparing.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import {
  computeStatus,
  findRepo,
  headId,
  plain,
  run,
  subject,
  upstreamOf,
  workingTree,
  remoteNames,
  remoteUrl,
  type Scenario,
  type SimState,
} from '../../src/engine/git-sim/index';
import { walk } from '../../src/engine/git-sim/refs';
import { DEFAULT_CONFIG, scenarioStart, scenarioStep } from '../../src/engine/git-sim/scenario';
import { parseLine } from '../../src/engine/git-sim/parse';
import { allScenarios } from '../../src/content/courses/git/scenarios/index';
import { verifyFixtures } from '../../src/engine/git-sim/__tests__/fixtures';

const SIM_HOME = '/home/you';
const START = Date.UTC(2026, 9, 30, 1, 0, 0) / 1000; // 30 Oct 2026, 09:00 in Malaysia
const PATCH_ANSWER = /^[ynqad?]$/i;

interface Snapshot {
  ok: boolean[];
  staged: string[];
  unstaged: string[];
  untracked: string[];
  unmerged: string[];
  commits: number;
  messages: string[];
  branches: string[];
  tags: string[];
  stash: number;
  upstreams: string[];
  remotes: string[];
  servers: string[];
  op: string;
  head: string;
  statusShort: string;
  files: Record<string, string>;
  outputs: Record<string, string>;
}

/** Mask every hex id in outputs (unless the scenario compares exact hashes). */
let exact = false;
const maskHashes = (text: string) => (exact ? text : text.replace(/\b[0-9a-f]{7,40}\b/g, '<hash>'));

/** Make engine and real output comparable across Git versions (2.43 locally, newer in CI). */
function normalize(text: string): string {
  return maskHashes(text)
    .replace(/\w{3} \w{3} \d+ \d\d:\d\d:\d\d \d{4} [+-]\d{4}/g, '<date>')
    .split('\n')
    // A carriage return redraws the line (progress output): keep what a terminal would show.
    .flatMap((l) => {
      if (!l.includes('\r')) return [l];
      const shown = l.slice(l.lastIndexOf('\r') + 1);
      return shown.trim() ? [shown] : [];
    })
    .map((l) => l.replace(/\s+$/, '').replace(/^\s+(Successfully rebased)/, '$1').replace(/^Rebasing \(\d+\/\d+\)\s*/, ''))
    .filter((l) => l !== 'done.' && !/^remote:/.test(l) && !/^hint: Disable this message with /.test(l))
    // Newer Git adds this hint after a bad branch name.
    .filter((l) => l !== "hint: See 'git help check-ref-format'")
    // Remote HEAD: Git 2.48+ creates it on fetch, older Git only on clone.
    .filter((l) => !/^\s*(remotes\/)?\w+\/HEAD -> /.test(l))
    .map((l) =>
      l
        .replace(/, \w+\/HEAD(?=[,)])/g, '')
        .replace(/ \(\w+\/HEAD\)/g, '')
        .replace(/\(\w+\/HEAD, /g, '(')
        // `git branch -d` wording before Git 2.45.
        .replace(/^(error: the branch '.+' is not fully merged)\.$/, '$1')
        .replace(/^If you are sure you want to delete it, run /, 'hint: If you are sure you want to delete it, run ')
        // Rebase todo lines: Git 2.45+ writes the subject as a comment (`pick <hash> # Fix`).
        .replace(/^(Could not apply <hash>\.\.\. )# /, '$1')
        .replace(/^(\s+(pick|reword|edit|squash|fixup|drop) <hash> )# /, '$1'),
    )
    .join('\n')
    .trim();
}

// Outputs compared line by line, and outputs compared as sorted lines (real Git
// interleaves stdout and stderr differently from a terminal).
const COMPARE_OUTPUT = new RegExp(
  [
    /^git (status( -s| -sb)?|diff( --staged| --cached)?|clean -n.*|rm .*|mv .*|merge( .*)?|branch( .*)?|tag( .*)?|stash (list|show.*)|log --oneline.*|cherry-pick .*|rebase( .*)?|remote( -v)?|show [^-].*)$/.source,
    // World 10: plumbing, history search, bisect, worktrees, aliases, the .git view and tiny scripts.
    /^git (cat-file|hash-object|ls-tree|rev-parse|show-ref|pack-refs|grep|blame|shortlog|bisect) .*$/.source,
    /^git (log (-S|-G|--author|--grep|-p|--left-right).*|diff \S+\.\.\.\S*|worktree (list|remove|prune).*|config (--global )?--get-regexp.*)$/.source,
    /^cat \.git\/.*$|^(sh|bash|grep|test) .*$/.source,
  ].join('|'),
);
const COMPARE_SORTED = /^git (push|fetch|pull|clone|switch|checkout|worktree add|stash( (pop|apply|push|drop).*)?$)/;

// ---------------------------------------------------------------------------
// Real git side

class RealShell {
  root: string;
  home: string;
  srv: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  /** Unix time for the next Git call: the engine's clock after the same step. */
  clock = START;

  constructor(config: Record<string, string>) {
    this.root = mkdtempSync(join(tmpdir(), 'fahamlah-verify-'));
    this.home = join(this.root, 'home', 'you');
    this.srv = join(this.root, 'srv');
    mkdirSync(this.home, { recursive: true });
    mkdirSync(this.srv, { recursive: true });
    this.cwd = this.home;
    this.env = {
      PATH: process.env.PATH,
      HOME: this.home,
      XDG_CONFIG_HOME: join(this.home, '.config'),
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_EDITOR: 'true',
      GIT_PAGER: 'cat',
      PAGER: 'cat',
      LANG: 'C',
      LC_ALL: 'C',
      TERM: 'dumb',
    };
    for (const [k, v] of Object.entries(config)) this.git(['config', '--global', k, v]);
    this.git(['config', '--global', `url.${this.srv}/.insteadOf`, 'https://github.com/']);
    this.git(['config', '--global', 'log.decorate', 'short']);
  }

  map(p: string): string {
    if (p === '~') return this.home;
    if (p.startsWith('~/')) return join(this.home, p.slice(2));
    if (p.startsWith(SIM_HOME)) return join(this.home, p.slice(SIM_HOME.length));
    if (p.startsWith('/')) return join(this.root, p);
    return join(this.cwd, p);
  }

  /** Real Git uses the engine's clock, so commits get the same dates (and ids). */
  private dateEnv(): NodeJS.ProcessEnv {
    const date = `@${this.clock} +0800`;
    return { ...this.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date };
  }

  git(args: string[], input?: string, cwd = this.cwd): { ok: boolean; out: string } {
    const r = spawnSync('git', args, { cwd, env: this.dateEnv(), input, encoding: 'utf8' });
    return { ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
  }

  /** Turn sandbox paths back into the paths and URLs the learner sees. */
  unmap(text: string): string {
    return text.replaceAll(`${this.srv}/`, 'https://github.com/').replaceAll(this.srv, 'https://github.com').replaceAll(this.root, '');
  }

  /** Create a hosted repo (bare), optionally with a first commit. */
  server(url: string, files?: Record<string, string>, message?: string, defaultBranch?: string): void {
    const dir = join(this.srv, url.replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '') + '.git');
    mkdirSync(dirname(dir), { recursive: true });
    this.git(['init', '-q', '--bare', ...(defaultBranch ? ['-b', defaultBranch] : []), dir]);
    if (!files) return;
    const work = join(this.root, 'tmp-init');
    this.git(['clone', '-q', dir, work]);
    for (const [p, content] of Object.entries(files)) {
      mkdirSync(dirname(join(work, p)), { recursive: true });
      writeFileSync(join(work, p), content);
    }
    this.git(['add', '.'], undefined, work);
    this.git(['commit', '-q', '-m', message ?? 'Initial commit'], undefined, work);
    this.git(['push', '-q', 'origin', 'HEAD'], undefined, work);
    rmSync(work, { recursive: true, force: true });
  }

  /** Run one scenario line. Shell commands are done with Node's fs. */
  exec(line: string, input?: string): { ok: boolean; out: string } {
    const parsed = parseLine(line);
    const [cmd, ...args] = parsed.words;
    const names = args.filter((a) => !a.startsWith('-'));
    try {
      switch (cmd) {
        case 'git': {
          // Absolute paths (e.g. `git clone <url> /home/aisyah/diary`) stay in the sandbox.
          const r = this.git(args.map((a) => (a.startsWith('/home/') ? this.map(a) : a)), input);
          return { ok: r.ok, out: this.unmap(r.out) };
        }
        case 'mkdir':
          for (const n of names) mkdirSync(this.map(n), { recursive: args.includes('-p') });
          return { ok: true, out: '' };
        case 'cd':
          this.cwd = names[0] ? this.map(names[0]) : this.home;
          return { ok: existsSync(this.cwd), out: '' };
        case 'touch':
          for (const n of names) if (!existsSync(this.map(n))) writeFileSync(this.map(n), '');
          return { ok: true, out: '' };
        case 'echo': {
          const text = `${args.join(' ')}\n`;
          if (!parsed.redirect) return { ok: true, out: text };
          const target = this.map(parsed.redirect.target);
          writeFileSync(target, parsed.redirect.append && existsSync(target) ? readFileSync(target, 'utf8') + text : text);
          return { ok: true, out: '' };
        }
        case 'rm':
          for (const n of names) rmSync(this.map(n), { recursive: /-\w*r/i.test(args.join(' ')), force: /-\w*f/.test(args.join(' ')) });
          return { ok: true, out: '' };
        case 'cat':
          // The engine shows a read-only view of .git: compare it with the real files.
          if (names.every((n) => n.startsWith('.git/'))) return this.sh(line);
          return { ok: true, out: '' };
        case 'sh':
        case 'bash':
        case 'grep':
        case 'test':
          return this.sh(line);
        case 'ls':
        case 'pwd':
        case 'clear':
        case 'help':
          return { ok: true, out: '' };
        default:
          return { ok: false, out: `unknown command ${cmd}` };
      }
    } catch (e) {
      return { ok: false, out: String(e) };
    }
  }

  /** A tiny shell command (cat .git/HEAD, sh test.sh, grep ...), run by a real shell. */
  sh(line: string): { ok: boolean; out: string } {
    const r = spawnSync('sh', ['-c', line], { cwd: this.cwd, env: this.dateEnv(), encoding: 'utf8' });
    return { ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.replace(/^sh: \d+: /gm, 'bash: ') };
  }

  write(path: string, content: string) {
    const p = this.map(path);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
  }

  repoRoot(): string | null {
    const r = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: this.cwd, env: this.env, encoding: 'utf8' });
    return r.status === 0 ? r.stdout.trim() : null;
  }

  /** Every bare repo under srv/, as its URL. */
  private serverDirs(): { url: string; dir: string }[] {
    const out: { url: string; dir: string }[] = [];
    const walkDir = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (!statSync(p).isDirectory()) continue;
        if (name.endsWith('.git')) out.push({ url: `https://github.com/${relative(this.srv, p)}`, dir: p });
        else walkDir(p);
      }
    };
    walkDir(this.srv);
    return out;
  }

  snapshot(ok: boolean[], outputs: Record<string, string>): Snapshot {
    const root = this.repoRoot();
    const lines = (args: string[], cwd = root ?? this.cwd) => {
      const r = spawnSync('git', args, { cwd, env: this.env, encoding: 'utf8' });
      return r.status === 0 ? r.stdout.split('\n').filter(Boolean) : [];
    };
    const files: Record<string, string> = {};
    if (root) {
      const walkFiles = (dir: string) => {
        for (const name of readdirSync(dir)) {
          if (name === '.git') continue;
          const p = join(dir, name);
          if (statSync(p).isDirectory()) walkFiles(p);
          else files[relative(root, p)] = readFileSync(p, 'utf8');
        }
      };
      walkFiles(root);
    }
    const gitDir = root ? join(root, '.git') : '';
    const hasHead = root ? this.git(['rev-parse', '-q', '--verify', 'HEAD'], undefined, root).ok : false;
    const sym = root ? this.git(['symbolic-ref', '-q', '--short', 'HEAD'], undefined, root) : { ok: false, out: '' };
    const headSubject = hasHead ? (lines(['log', '-1', '--format=%s'])[0] ?? '') : '';
    const op = !root
      ? ''
      : existsSync(join(gitDir, 'MERGE_HEAD'))
        ? 'merge'
        : existsSync(join(gitDir, 'rebase-merge'))
          ? 'rebase'
          : existsSync(join(gitDir, 'CHERRY_PICK_HEAD'))
            ? 'cherry-pick'
            : '';
    const refs = lines(['for-each-ref', '--format=%(refname) %(subject)', 'refs/heads', 'refs/remotes'])
      .filter((l) => !/^refs\/remotes\/[^ ]+\/HEAD /.test(l))
      .map((l) => l.replace(/^refs\/(heads|remotes)\//, ''));
    const servers: string[] = [];
    for (const { url, dir } of this.serverDirs()) {
      const fmt = '--format=%(refname) %(if)%(*objectname)%(then)%(*subject)%(else)%(subject)%(end)';
      for (const l of lines(['--git-dir', dir, 'for-each-ref', fmt, 'refs/heads', 'refs/tags'], this.root)) {
        servers.push(`${url} ${l.replace(/^refs\/(heads|tags)\//, (m) => (m.includes('tags') ? 'tag:' : ''))}`);
      }
    }
    // Unmerged paths are compared on their own (Git also lists them as changed).
    const unmerged = [...new Set(lines(['diff', '--name-only', '--diff-filter=U']))].sort();
    const notUnmerged = (l: string) => !l.startsWith('U') && !unmerged.includes(l.split('\t')[1] ?? '');
    for (const [p, content] of Object.entries(files)) files[p] = maskHashes(content);
    return {
      ok,
      staged: lines(['diff', '--cached', '--name-status', '-M']).filter(notUnmerged).map(normNameStatus).sort(),
      unstaged: lines(['diff', '--name-status']).filter(notUnmerged).map(normNameStatus).sort(),
      untracked: lines(['ls-files', '--others', '--exclude-standard']).sort(),
      unmerged,
      commits: hasHead ? Number(lines(['rev-list', '--count', 'HEAD'])[0] ?? 0) : 0,
      messages: hasHead ? lines(['log', '--format=%s']).map((m) => this.unmap(m)) : [],
      branches: refs.map((l) => this.unmap(l)).sort(),
      tags: lines(['for-each-ref', '--format=%(refname:short) %(if)%(*objectname)%(then)%(*subject)%(else)%(subject)%(end)', 'refs/tags']).sort(),
      stash: lines(['stash', 'list']).length,
      upstreams: lines(['for-each-ref', '--format=%(refname:short) %(upstream:short)', 'refs/heads']).filter((l) => / \S/.test(l)).sort(),
      remotes: lines(['remote', '-v'])
        .filter((l) => l.endsWith('(fetch)'))
        .map((l) => this.unmap(l.replace(/\t/, ' ').replace(/ \(fetch\)$/, '')))
        .sort(),
      servers: servers.map((s) => this.unmap(s)).sort(),
      op,
      head: !root ? 'no repo' : sym.ok ? `branch ${sym.out.trim()}` : `detached at "${headSubject}"`,
      statusShort: root ? spawnSync('git', ['status', '-s'], { cwd: this.cwd, env: this.env, encoding: 'utf8' }).stdout.trimEnd() : '',
      files,
      outputs,
    };
  }

  cleanup() {
    rmSync(this.root, { recursive: true, force: true });
  }
}

function normNameStatus(line: string): string {
  const [code, ...paths] = line.split('\t');
  if (code!.startsWith('R')) return `R ${paths[0]} -> ${paths[1]}`;
  return `${code} ${paths[0]}`;
}

// ---------------------------------------------------------------------------
// Engine side

function engineSnapshot(state: SimState, ok: boolean[], outputs: Record<string, string>): Snapshot {
  const repo = findRepo(state);
  const servers = Object.values(state.servers)
    .flatMap((s) => [
      ...Object.entries(s.branches).map(([b, id]) => `${s.url} ${b} ${subject(s.commits[id]!.message)}`),
      ...Object.entries(s.tags).map(([t, id]) => `${s.url} tag:${t} ${subject(s.commits[id]!.message)}`),
    ])
    .sort();
  if (!repo) {
    return {
      ok, staged: [], unstaged: [], untracked: [], unmerged: [], commits: 0, messages: [], branches: [], tags: [], stash: 0,
      upstreams: [], remotes: [], servers, op: '', head: 'no repo', statusShort: '', files: {}, outputs,
    };
  }
  const st = computeStatus(state, repo);
  const code = { 'new file': 'A', modified: 'M', deleted: 'D' } as const;
  const head = headId(repo);
  const log = head ? walk(repo.commits, [head]) : [];
  return {
    ok,
    staged: st.staged.map((e) => (e.kind === 'renamed' ? `R ${e.from} -> ${e.path}` : `${code[e.kind]} ${e.path}`)).sort(),
    unstaged: st.unstaged.map((e) => `${e.kind === 'modified' ? 'M' : 'D'} ${e.path}`).sort(),
    untracked: [...st.untracked].sort(),
    unmerged: st.unmerged.map((e) => e.path).sort(),
    commits: log.length,
    messages: log.map((c) => subject(c.message)),
    branches: [
      ...Object.entries(repo.branches).map(([b, id]) => `${b} ${subject(repo.commits[id]!.message)}`),
      ...Object.entries(repo.remoteRefs).map(([b, id]) => `${b} ${subject(repo.commits[id]!.message)}`),
    ].sort(),
    tags: Object.entries(repo.tags).map(([t, id]) => `${t} ${subject(repo.commits[id]!.message)}`).sort(),
    stash: repo.stash.length,
    upstreams: Object.keys(repo.branches)
      .map((b) => [b, upstreamOf(repo, b)] as const)
      .filter(([, u]) => u)
      .map(([b, u]) => `${b} ${u!.ref}`)
      .sort(),
    remotes: remoteNames(repo).map((n) => `${n} ${remoteUrl(repo, n)}`).sort(),
    servers,
    op: repo.op?.kind ?? '',
    head: repo.head.type === 'branch' ? `branch ${repo.head.name}` : `detached at "${subject(repo.commits[repo.head.commit]!.message)}"`,
    statusShort: plain(run(state, 'git status -s').output).trimEnd(),
    // Conflict markers name commits by hash.
    files: Object.fromEntries(Object.entries(workingTree(state, repo)).map(([p, c]) => [p, maskHashes(c)])),
    outputs,
  };
}

// ---------------------------------------------------------------------------

/** Group `git add -p` with the answers that follow it. */
function group(commands: string[]): { cmd: string; answers: string[] }[] {
  const out: { cmd: string; answers: string[] }[] = [];
  for (const c of commands) {
    const last = out[out.length - 1];
    if (last && /^git add (-p|--patch)\b/.test(last.cmd) && PATCH_ANSWER.test(c.trim())) last.answers.push(c.trim());
    else out.push({ cmd: c, answers: [] });
  }
  return out;
}

function compareKey(cmd: string): 'exact' | 'sorted' | null {
  if (COMPARE_SORTED.test(cmd)) return 'sorted';
  if (COMPARE_OUTPUT.test(cmd)) return 'exact';
  return null;
}

function shaped(cmd: string, text: string): string {
  let n = normalize(text);
  if (OLDER_THAN_TARGET) n = olderGit(cmd, n);
  return compareKey(cmd) === 'sorted' ? n.split('\n').sort().join('\n') : n;
}

// The engine prints Git 2.56 output. When the local Git is older (2.43 here, 2.56 in CI),
// both sides are smoothed the same way so they still compare; CI compares exactly.
const version = execFileSync('git', ['--version'], { encoding: 'utf8' }).trim();
const [, major = '0', minor = '0'] = /(\d+)\.(\d+)/.exec(version) ?? [];
const OLDER_THAN_TARGET = Number(major) < 2 || (Number(major) === 2 && Number(minor) < 56);

function olderGit(cmd: string, text: string): string {
  const out: string[] = [];
  for (const l of text.split('\n')) {
    let x = l;
    // Git 2.56 quotes the bisect terms: "is the first 'bad' commit", "waiting for both 'good' and 'bad' commits"...
    if (/status: waiting|first .*commit|was both|revs? (are not|\?)|mistook|bisect found first/.test(x)) x = x.replace(/'(good|bad|new|old)'/g, '$1');
    // Git 2.56 decorates the commit line under "is the first bad commit" (e.g. "(HEAD)").
    if (/^commit \S+ \(.*\)$/.test(x) && /is the first (bad|new) commit$/.test(out[out.length - 1] ?? '')) x = x.replace(/ \(.*\)$/, '');
    // Git 2.56 prints nothing for `git bisect reset` when not bisecting.
    if (x === 'We are not bisecting.' && /^git bisect reset/.test(cmd)) continue;
    // Git 2.56 blame ids are 7 hex chars (+1 only when a ^boundary line is shown); 2.43 always used 8.
    if (/^git blame/.test(cmd)) x = x.replace(/^(\^?)([0-9a-f]{7})[0-9a-f]? \(/, '$1$2 (');
    // Git 2.56 pads the worktree path column with one space after the longest path; 2.43 used two.
    if (/^git worktree list/.test(cmd)) x = x.replace(/^(\S+) +/, '$1 ');
    out.push(x);
  }
  return out.join('\n');
}

function verifySequence(s: Scenario, seq: string[]): string[] {
  const problems: string[] = [];
  const config = s.config ?? DEFAULT_CONFIG;
  exact = Boolean(s.exactHashes);
  // Engine (step by step, remembering the clock after each step for real Git)
  let state = scenarioStart(s);
  const stepClocks: number[] = [];
  for (const step of s.steps) {
    state = scenarioStep(state, step, s.id);
    stepClocks.push(state.clock);
  }
  const eOk: boolean[] = [];
  const eOut: Record<string, string> = {};
  const cmdClocks: number[] = [];
  for (const { cmd, answers } of group(seq)) {
    let r = run(state, cmd);
    state = r.state;
    for (const a of answers) {
      r = run(state, a);
      state = r.state;
    }
    cmdClocks.push(state.clock);
    eOk.push(r.ok);
    if (compareKey(cmd)) eOut[cmd] = shaped(cmd, plain(r.output));
  }
  // Real git
  const real = new RealShell(config);
  try {
    if (s.cwd) {
      mkdirSync(real.map(s.cwd), { recursive: true });
      real.cwd = real.map(s.cwd);
    }
    for (const [i, step] of s.steps.entries()) {
      real.clock = stepClocks[i]!;
      if (typeof step === 'string') {
        const r = real.exec(step);
        if (!r.ok) problems.push(`real git: setup step failed: ${step}\n${r.out}`);
      } else if ('write' in step) real.write(step.write, step.content);
      else if ('server' in step) real.server(step.server, step.files, step.message, step.defaultBranch);
      else unlinkSync(real.map(step.delete));
    }
    const rOk: boolean[] = [];
    const rOut: Record<string, string> = {};
    for (const [i, { cmd, answers }] of group(seq).entries()) {
      real.clock = cmdClocks[i]!;
      const r = real.exec(cmd, answers.length ? `${answers.join('\n')}\n` : undefined);
      rOk.push(r.ok);
      if (compareKey(cmd)) rOut[cmd] = shaped(cmd, r.out);
    }
    const a = engineSnapshot(state, eOk, eOut);
    const b = real.snapshot(rOk, rOut);
    const sortObj = (o: unknown) =>
      o && typeof o === 'object' && !Array.isArray(o) ? Object.fromEntries(Object.entries(o).sort(([p], [q]) => p.localeCompare(q))) : o;
    for (const key of Object.keys(a) as (keyof Snapshot)[]) {
      const x = JSON.stringify(sortObj(a[key]));
      const y = JSON.stringify(sortObj(b[key]));
      if (x !== y) problems.push(`${key} differs\n      engine:   ${x}\n      real git: ${y}`);
    }
  } finally {
    real.cleanup();
  }
  return problems;
}

console.log(`Real Git used: ${version} (course target: Git 2.56)${OLDER_THAN_TARGET ? ' — smoothing 2.56 wording differences' : ''}`);
const failures: string[] = [];
let count = 0;
// VERIFY_ONLY=w10 checks only scenarios whose id starts with that text (handy while writing them).
const only = process.env.VERIFY_ONLY;
for (const s of [...allScenarios, ...verifyFixtures].filter((x) => !only || x.id.startsWith(only))) {
  for (const seq of s.verify ?? []) {
    count++;
    const problems = verifySequence(s, seq);
    if (problems.length) failures.push(`✗ ${s.id}: [${seq.join(' ; ')}]\n    - ${problems.join('\n    - ')}`);
  }
}
if (failures.length) {
  console.error(`\n${failures.join('\n\n')}\n\n✗ ${failures.length} of ${count} command lists differ from real Git.`);
  process.exit(1);
}
console.log(`✓ ${count} command lists match real Git.`);
