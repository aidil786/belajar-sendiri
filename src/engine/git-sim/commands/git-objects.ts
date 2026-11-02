// Plumbing (World 10): git cat-file, hash-object, ls-tree, rev-parse, show-ref, pack-refs.
// Ids are real SHA-1s (see hash.ts), so the output matches real Git.
import { blobId, shortHash } from '../hash';
import { allRefs, objectSize, objectStore, objectText, rangeIds, resolveObject, snapshotTrees, type GitObject, type ObjectResult } from '../objects';
import { fail, line, lines, notARepo, ok } from '../output';
import { Args } from '../parse';
import { isInside, relative, resolve } from '../paths';
import { resolveRev, revProblem } from '../revision';
import { clone, dirExists, findRepo, headId, mainRepo, mainRootOf } from '../state';
import type { CommandFn, CommandResult, Line, Repo, SimState } from '../types';

function badOption(state: SimState, opt: string): CommandResult {
  return fail(state, lines(`error: unknown option '${opt.replace(/^-+/, '')}'`), 'badOption', { key: 'sim.err.badOption', params: { option: opt } });
}

/** Text → output lines, dropping the final newline like a terminal shows it. */
function textLines(text: string): Line[] {
  if (text === '') return [];
  return lines(text.endsWith('\n') ? text.slice(0, -1) : text);
}

function objectProblem(state: SimState, spec: string, res: Exclude<ObjectResult, { ok: true }>): CommandResult {
  if (res.reason === 'noPath') {
    const msg = res.rev === '' ? `fatal: path '${res.path}' does not exist (neither on disk nor in the index)` : `fatal: path '${res.path}' does not exist in '${res.rev}'`;
    return fail(state, lines(msg), 'noPath', { key: 'sim.err.objectNoPath', params: { path: res.path ?? '', rev: res.rev ?? '' } });
  }
  return fail(state, lines(`fatal: Not a valid object name ${spec}`), 'badObject', { key: 'sim.err.badObject', params: { name: spec } });
}

/** Shortest unique prefix of `id` with at least `min` characters (Git's --short / abbrev). */
export function abbrev(repo: Repo, id: string, min = 7): string {
  const ids = [...objectStore(repo).keys()];
  for (let n = Math.max(4, min); n < 40; n++) {
    const p = id.slice(0, n);
    if (ids.filter((x) => x.startsWith(p)).length <= 1) return p;
  }
  return id;
}

// ---------------------------------------------------------------------------
// git cat-file

const CAT_USAGE = [
  'usage: git cat-file <type> <object>',
  '   or: git cat-file (-e | -p) <object>',
  '   or: git cat-file (-t | -s) <object>',
];

export const catFile: CommandFn = (state, args) => {
  const repo = findRepo(state);
  if (!repo) return notARepo(state);
  const a = new Args(args, { flags: ['-t', '-s', '-p', '-e'] });
  if (a.unknown.length) return badOption(state, a.unknown[0]!);
  const modes = ['-t', '-s', '-p', '-e'].filter((m) => a.has(m));
  const mode = modes[0];
  let spec = a.positional[0];
  let wantType: string | null = null;
  if (!mode && a.positional.length === 2) {
    wantType = a.positional[0]!;
    spec = a.positional[1];
  }
  if (modes.length > 1 || (!mode && !wantType) || !spec || a.positional.length > (wantType ? 2 : 1)) {
    return { state, output: CAT_USAGE.map((u) => line(u)), events: [{ type: 'error', code: 'usage' }], ok: false, explain: { key: 'sim.err.catFileUsage' } };
  }
  const res = resolveObject(repo, spec);
  if (mode === '-e') return res.ok ? ok(state, [], [], { key: 'sim.explain.catFileExists', params: { name: spec } }) : { state, output: [], events: [{ type: 'error', code: 'badObject' }], ok: false, explain: { key: 'sim.err.badObject', params: { name: spec } } };
  if (!res.ok) return objectProblem(state, spec, res);
  const obj = res.obj;
  const params = { name: spec, type: obj.type, hash: shortHash(obj.id) };
  if (mode === '-t') return ok(state, [line(obj.type)], [], { key: `sim.explain.catFileType.${obj.type}`, params });
  if (mode === '-s') return ok(state, [line(String(objectSize(obj, state.tz)))], [], { key: 'sim.explain.catFileSize', params: { ...params, size: String(objectSize(obj, state.tz)) } });
  if (wantType) {
    if (!['blob', 'commit', 'tag', 'tree'].includes(wantType)) {
      return fail(state, lines(`fatal: invalid object type "${wantType}"`), 'badType', { key: 'sim.err.badObjectType', params: { type: wantType } });
    }
    if (wantType === 'tree') return fail(state, lines('A tree is stored as binary. Try: git cat-file -p <tree>'), 'binaryTree', { key: 'sim.err.catFileTreeRaw' });
    if (wantType !== obj.type) return fail(state, lines(`fatal: git cat-file ${spec}: bad file`), 'badType', { key: 'sim.err.catFileWrongType', params: { name: spec, type: obj.type, want: wantType } });
  }
  return ok(state, textLines(objectText(obj, state.tz)), [], { key: `sim.explain.catFilePretty.${obj.type}`, params });
};

// ---------------------------------------------------------------------------
// git hash-object

export const hashObject: CommandFn = (state, args) => {
  const a = new Args(args, { flags: ['-w', '--stdin', '--no-filters'], values: ['-t'] });
  if (a.unknown.length) return badOption(state, a.unknown[0]!);
  if (a.has('--stdin')) {
    return fail(state, lines('This practice terminal has no pipes. Give a file name: git hash-object <file>'), 'noStdin', { key: 'sim.err.hashObjectStdin' });
  }
  const type = a.get('-t');
  if (type !== undefined && type !== 'blob') {
    return fail(state, lines('This practice terminal hashes files as blobs only.'), 'badType', { key: 'sim.err.hashObjectType', params: { type } });
  }
  const write = a.has('-w');
  const repo = findRepo(state);
  if (write && !repo) return notARepo(state);
  if (a.positional.length === 0) {
    return { state, output: [line('usage: git hash-object [-t <type>] [-w] <file>...')], events: [{ type: 'error', code: 'usage' }], ok: false, explain: { key: 'sim.err.hashObjectUsage' } };
  }
  const out: Line[] = [];
  const found: { id: string; content: string }[] = [];
  for (const name of a.positional) {
    const abs = resolve(state.cwd, name, state.home);
    if (dirExists(state, abs)) return fail(state, [...out, line(`fatal: Unable to hash ${name}`)], 'hashDir', { key: 'sim.err.hashObjectDir', params: { path: name } });
    const content = state.fs.files[abs];
    if (content === undefined) {
      return fail(state, [...out, line(`fatal: could not open '${name}' for reading: No such file or directory`)], 'noSuchPath', { key: 'sim.err.noSuchPath', params: { path: name } });
    }
    const id = blobId(content);
    found.push({ id, content });
    out.push(line(id));
  }
  const hash = shortHash(found[0]!.id);
  if (!write) return ok(state, out, [], { key: 'sim.explain.hashObject', params: { hash, file: a.positional[0]! } });
  const next = clone(state);
  const main = mainRepo(next, findRepo(next)!);
  main.blobs = { ...(main.blobs ?? {}) };
  for (const f of found) main.blobs[f.id] = f.content;
  return ok(next, out, found.map((f) => ({ type: 'objectWritten' as const, id: f.id, kind: 'blob' as const })), {
    key: 'sim.explain.hashObjectWrite',
    params: { hash, file: a.positional[0]! },
  });
};

// ---------------------------------------------------------------------------
// git ls-tree

interface FlatEntry {
  path: string; // full repo path
  mode: string;
  type: 'blob' | 'tree';
  id: string;
  size: string;
}

export const lsTree: CommandFn = (state, args) => {
  const repo = findRepo(state);
  if (!repo) return notARepo(state);
  const a = new Args(args, { flags: ['-r', '-t', '-d', '--name-only', '--name-status', '-l', '--long', '--full-tree', '--full-name'], combined: true });
  if (a.unknown.length) return badOption(state, a.unknown[0]!);
  const [spec, ...rawPaths] = a.positional;
  if (!spec) {
    return { state, output: [line('usage: git ls-tree [<options>] <tree-ish> [<path>...]')], events: [{ type: 'error', code: 'usage' }], ok: false, explain: { key: 'sim.err.lsTreeUsage' } };
  }
  const store = objectStore(repo);
  const res = resolveObject(repo, spec, store);
  if (!res.ok) return objectProblem(state, spec, res);
  let root: GitObject | undefined = res.obj;
  while (root && root.type === 'tag') root = store.get(root.target);
  if (root?.type === 'commit') root = store.get(snapshotTrees(root.commit.snapshot).get('')!.id);
  if (!root || root.type !== 'tree') return fail(state, lines('fatal: not a tree object'), 'notTree', { key: 'sim.err.notTree', params: { name: spec } });

  // Flatten the tree (with folders), in Git's order.
  const flat: FlatEntry[] = [];
  const walkTree = (tree: Extract<GitObject, { type: 'tree' }>, prefix: string) => {
    for (const e of tree.entries) {
      const path = `${prefix}${e.name}`;
      const obj = store.get(e.id);
      const size = obj && obj.type === 'blob' ? String(objectSize(obj, state.tz)) : '-';
      flat.push({ path, mode: e.mode, type: e.type, id: e.id, size });
      if (obj?.type === 'tree') walkTree(obj, `${path}/`);
    }
  };
  walkTree(root, '');

  // ls-tree works relative to the current folder (unless --full-tree).
  const prefix = a.has('--full-tree') || !isInside(state.cwd, repo.root) || state.cwd === repo.root ? '' : `${relative(state.cwd, repo.root)}/`;
  const specs = (rawPaths.length ? rawPaths : prefix ? ['.'] : []).map((p) => {
    const dirOnly = p.endsWith('/') || p === '.' || p === './';
    const full = `${prefix}${p}`.replace(/(^|\/)\.\/?$/, '$1').replace(/^\.\//, '').replace(/\/+$/, '');
    return { full, dirOnly };
  });
  const recurse = a.has('-r');
  const depth = (p: string) => p.split('/').length;
  const shown = flat.filter((e) => {
    if (a.has('-d') && e.type !== 'tree') return false;
    if (specs.length === 0) {
      if (!recurse) return depth(e.path) === 1;
      return e.type === 'blob' || a.has('-t') || a.has('-d');
    }
    return specs.some((s) => {
      const inside = s.full === '' ? e.path : e.path.startsWith(`${s.full}/`) ? e.path.slice(s.full.length + 1) : null;
      if (!s.dirOnly && e.path === s.full) return true; // the entry itself
      if (inside === null) {
        // A folder on the way to the pathspec: shown with -t when recursing.
        return recurse && a.has('-t') && e.type === 'tree' && s.full.startsWith(`${e.path}/`);
      }
      if (s.dirOnly && !recurse) return depth(inside) === 1;
      if (!recurse) return false;
      return e.type === 'blob' || a.has('-t') || a.has('-d');
    });
  });
  const show = (p: string) => (a.has('--full-name') || !prefix ? p : p.startsWith(prefix) ? p.slice(prefix.length) : p);
  const long = a.has('-l', '--long');
  const out = shown.map((e) => {
    if (a.has('--name-only', '--name-status')) return line(show(e.path));
    return line(`${e.mode} ${e.type} ${e.id}${long ? ` ${e.size.padStart(7)}` : ''}\t${show(e.path)}`);
  });
  return ok(state, out, [], { key: recurse ? 'sim.explain.lsTreeRecursive' : 'sim.explain.lsTree', params: { name: spec, hash: shortHash(root.id) } });
};

// ---------------------------------------------------------------------------
// git rev-parse

function adminDir(state: SimState, repo: Repo): string {
  const mainRoot = mainRootOf(repo);
  if (mainRoot === repo.root) return `${repo.root}/.git`;
  const wt = Object.values(state.repos[mainRoot]?.worktrees ?? {}).find((w) => w.path === repo.root);
  return `${mainRoot}/.git/worktrees/${wt?.name ?? ''}`;
}

export const revParse: CommandFn = (state, args) => {
  const repo = findRepo(state);
  const a = new Args(args, {
    flags: ['--abbrev-ref', '--show-toplevel', '--git-dir', '--absolute-git-dir', '--git-common-dir', '--is-inside-work-tree', '--is-inside-git-dir', '--show-prefix', '--show-cdup', '--verify', '-q', '--quiet', '--symbolic-full-name', '--short'],
  });
  let shortLen: number | null = a.has('--short') ? 7 : null;
  for (const u of a.unknown) {
    const m = /^--short=(\d+)$/.exec(u);
    if (m) shortLen = Number(m[1]);
    else return badOption(state, u);
  }
  if (!repo) return notARepo(state);
  const out: Line[] = [];
  if (a.has('--show-toplevel')) out.push(line(repo.root));
  if (a.has('--git-dir')) {
    const dir = adminDir(state, repo);
    out.push(line(dir === `${repo.root}/.git` && state.cwd === repo.root ? '.git' : dir));
  }
  if (a.has('--absolute-git-dir')) out.push(line(adminDir(state, repo)));
  if (a.has('--git-common-dir')) out.push(line(mainRootOf(repo) === repo.root && state.cwd === repo.root ? '.git' : `${mainRootOf(repo)}/.git`));
  if (a.has('--is-inside-work-tree')) out.push(line('true'));
  if (a.has('--is-inside-git-dir')) out.push(line('false'));
  if (a.has('--show-prefix')) out.push(line(state.cwd === repo.root ? '' : `${relative(state.cwd, repo.root)}/`));
  if (a.has('--show-cdup')) out.push(line(state.cwd === repo.root ? '' : relative(state.cwd, repo.root).split('/').map(() => '../').join('')));

  const verify = a.has('--verify');
  const quiet = a.has('-q', '--quiet');
  if (verify && a.positional.length !== 1) {
    return quiet ? { state, output: [], events: [{ type: 'error', code: 'badRevision' }], ok: false } : fail(state, lines('fatal: Needed a single revision'), 'badRevision', { key: 'sim.err.revParseVerify' });
  }
  const store = objectStore(repo);
  const fmt = (id: string) => (shortLen !== null ? abbrev(repo, id, shortLen) : id);
  for (const p of a.positional) {
    if (a.has('--abbrev-ref', '--symbolic-full-name')) {
      const full = symbolicName(repo, p);
      if (full === null) {
        const res = resolveRev(repo, p);
        if (!res.ok) return unknownRev(state, out, p, verify, quiet);
        if (a.has('--abbrev-ref')) out.push(line(p === '@' ? 'HEAD' : p));
        continue;
      }
      out.push(line(a.has('--abbrev-ref') ? full.replace(/^refs\/(heads|tags|remotes)\//, '') : full));
      continue;
    }
    const range = /^(.*?)(\.\.\.?)(.*)$/.exec(p);
    if (range && !verify) {
      const left = resolveRev(repo, range[1] || 'HEAD');
      const right = resolveRev(repo, range[3] || 'HEAD');
      if (!left.ok || !right.ok) return unknownRev(state, out, p, verify, quiet);
      for (const id of rangeIds(repo, left.id, right.id, range[2] === '...')) out.push(line(id.startsWith('^') ? `^${fmt(id.slice(1))}` : fmt(id)));
      continue;
    }
    if (p.startsWith('^') && !p.startsWith('^{')) {
      const res = resolveObject(repo, p.slice(1), store);
      if (!res.ok) return unknownRev(state, out, p, verify, quiet);
      out.push(line(`^${fmt(res.obj.id)}`));
      continue;
    }
    const res = resolveObject(repo, p, store);
    if (!res.ok) {
      const rev = resolveRev(repo, p);
      const problem = !rev.ok ? revProblem(p, rev) : null;
      if (problem) return fail(state, [...out, line(problem)], 'badRevision', { key: 'sim.err.badRevision', params: { rev: p } });
      if (res.reason === 'noPath') return objectProblem(state, p, res);
      return unknownRev(state, out, p, verify, quiet);
    }
    out.push(line(fmt(res.obj.id)));
  }
  const first = a.positional[0];
  let key = 'sim.explain.revParse';
  if (a.has('--show-toplevel')) key = 'sim.explain.revParseToplevel';
  else if (a.has('--git-dir', '--absolute-git-dir')) key = 'sim.explain.revParseGitDir';
  else if (a.has('--abbrev-ref')) key = 'sim.explain.revParseAbbrevRef';
  else if (shortLen !== null) key = 'sim.explain.revParseShort';
  return ok(state, out, [], { key, params: { rev: first ?? 'HEAD' } });
};

/** "refs/heads/main" for HEAD, main, heads/main...; null when not a ref name. */
function symbolicName(repo: Repo, p: string): string | null {
  if (p === 'HEAD' || p === '@') {
    if (repo.head.type === 'branch') return headId(repo) ? `refs/heads/${repo.head.name}` : null;
    return 'HEAD';
  }
  const name = p.replace(/^refs\//, '');
  if (repo.tags[name.replace(/^tags\//, '')] !== undefined && !name.startsWith('heads/')) return `refs/tags/${name.replace(/^tags\//, '')}`;
  if (repo.branches[name.replace(/^heads\//, '')] !== undefined) return `refs/heads/${name.replace(/^heads\//, '')}`;
  if (repo.remoteRefs[name.replace(/^remotes\//, '')] !== undefined) return `refs/remotes/${name.replace(/^remotes\//, '')}`;
  return null;
}

function unknownRev(state: SimState, out: Line[], p: string, verify: boolean, quiet: boolean): CommandResult {
  if (verify) {
    if (quiet) return { state, output: out, events: [{ type: 'error', code: 'badRevision' }], ok: false };
    return fail(state, [...out, line('fatal: Needed a single revision')], 'badRevision', { key: 'sim.err.badRevision', params: { rev: p } });
  }
  // Like real Git, rev-parse echoes what it could not resolve before the error.
  return fail(
    state,
    [
      ...out,
      line(p),
      ...lines(`fatal: ambiguous argument '${p}': unknown revision or path not in the working tree.\nUse '--' to separate paths from revisions, like this:\n'git <command> [<revision>...] -- [<file>...]'`),
    ],
    'badRevision',
    { key: 'sim.err.badRevision', params: { rev: p } },
  );
}

// ---------------------------------------------------------------------------
// git show-ref

export const showRef: CommandFn = (state, args) => {
  const repo = findRepo(state);
  if (!repo) return notARepo(state);
  const a = new Args(args, { flags: ['--heads', '--branches', '--tags', '-d', '--dereference', '--head', '-s', '--hash', '--verify', '-q', '--quiet'] });
  if (a.unknown.length) return badOption(state, a.unknown[0]!);
  let refs = allRefs(repo);
  const heads = a.has('--heads', '--branches');
  const tags = a.has('--tags');
  if (heads || tags) refs = refs.filter((r) => (heads && r.name.startsWith('refs/heads/')) || (tags && r.name.startsWith('refs/tags/')));
  if (a.has('--verify')) {
    refs = refs.filter((r) => a.positional.includes(r.name));
    if (refs.length !== a.positional.length || !refs.length) {
      const missing = a.positional.find((p) => !refs.some((r) => r.name === p)) ?? '';
      return fail(state, a.has('-q', '--quiet') ? [] : lines(`fatal: '${missing}' - not a valid ref`), 'badRef', { key: 'sim.err.showRefMissing', params: { ref: missing } });
    }
  } else if (a.positional.length) {
    refs = refs.filter((r) => a.positional.some((p) => r.name === p || r.name.endsWith(`/${p}`)));
  }
  const out: Line[] = [];
  const hashOnly = a.has('-s', '--hash');
  const head = headId(repo);
  if (a.has('--head') && head && !a.positional.length) out.push(line(hashOnly ? head : `${head} HEAD`));
  for (const r of refs) {
    out.push(line(hashOnly ? r.id : `${r.id} ${r.name}`));
    if (a.has('-d', '--dereference') && r.peeled) out.push(line(hashOnly ? r.peeled : `${r.peeled} ${r.name}^{}`));
  }
  if (a.has('-q', '--quiet')) return ok(state, [], [], { key: 'sim.explain.showRef' });
  if (!out.length) return { state, output: [], events: [], ok: false, stopped: true, explain: { key: 'sim.explain.showRefNone' } };
  return ok(state, out, [], { key: 'sim.explain.showRef' });
};

// ---------------------------------------------------------------------------
// git pack-refs

export const packRefs: CommandFn = (state, args) => {
  const repo = findRepo(state);
  if (!repo) return notARepo(state);
  const a = new Args(args, { flags: ['--all', '--prune', '--no-prune'] });
  if (a.unknown.length) return badOption(state, a.unknown[0]!);
  const next = clone(state);
  const main = mainRepo(next, findRepo(next)!);
  const packed: Record<string, string> = { ...(main.packedRefs ?? {}) };
  for (const r of allRefs(main)) {
    if (r.name === 'refs/stash' || r.name.endsWith('/HEAD') || r.name.startsWith('refs/bisect/')) continue;
    // Without --all, Git packs tags and refs that are already packed.
    if (a.has('--all') || r.name.startsWith('refs/tags/') || r.name in packed) packed[r.name] = r.id;
  }
  main.packedRefs = packed;
  return ok(next, [], [], { key: a.has('--all') ? 'sim.explain.packRefsAll' : 'sim.explain.packRefs' });
};
