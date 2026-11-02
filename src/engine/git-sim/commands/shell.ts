// Shell commands for World 0 and for editing files: pwd, ls, cd, mkdir, touch, cat, echo, rm, clear, help.
import { fail, line, lines, ok } from '../output';
import { basename, dirname, isInside, relative, resolve } from '../paths';
import {
  clone,
  deleteFile,
  dirExists,
  fileExists,
  findRepo,
  listDir,
  writeFile,
  ensureDir,
} from '../state';
import type { CommandFn, CommandResult, Line, SimEvent, SimState } from '../types';
import { dotGitDirs, dotGitFiles, locateDotGit, type DotGitHit } from '../dotgit';

function fileEvent(state: SimState, abs: string, type: 'fileCreated' | 'fileChanged' | 'fileDeleted'): SimEvent {
  const repo = findRepo(state, dirname(abs));
  return { type, path: repo ? relative(abs, repo.root) : abs };
}

export const pwd: CommandFn = (state) => ok(state, [line(state.cwd)], [], { key: 'sim.explain.pwd' });

export const ls: CommandFn = (state, args) => {
  const showAll = args.some((a) => /^-[a-zA-Z]*a/.test(a));
  const bad = args.find((a) => a.startsWith('-') && !/^-a+$/.test(a));
  if (bad) {
    return fail(state, lines(`ls: this practice terminal only knows "ls" and "ls -a"`), 'lsOption', {
      key: 'sim.err.lsOption',
    });
  }
  const targets = args.filter((a) => !a.startsWith('-'));
  const dir = targets[0] ? resolve(state.cwd, targets[0], state.home) : state.cwd;
  const hit = locateDotGit(state, dir);
  if (hit) return lsDotGit(state, hit, targets[0]!);
  if (fileExists(state, dir)) return ok(state, [line(targets[0]!)]);
  if (!dirExists(state, dir)) {
    return fail(state, lines(`ls: cannot access '${targets[0]}': No such file or directory`), 'noSuchPath', {
      key: 'sim.err.noSuchPath',
      params: { path: targets[0] ?? '' },
    });
  }
  const entries = listDir(state, dir);
  const segs: Line = [];
  const all: { name: string; isDir: boolean }[] = [];
  if (showAll) {
    all.push({ name: '.', isDir: true }, { name: '..', isDir: true });
    if (state.repos[dir]) all.push({ name: '.git', isDir: true });
    // A linked worktree has a small .git file instead of a folder.
    else if (Object.values(state.repos).some((r) => r.worktrees?.[dir])) all.push({ name: '.git', isDir: false });
  }
  for (const e of entries) {
    if (!showAll && e.name.startsWith('.')) continue;
    all.push(e);
  }
  all.forEach((e, i) => {
    if (i > 0) segs.push({ t: '  ' });
    segs.push(e.isDir ? { t: e.name, c: 'blue' } : { t: e.name });
  });
  return ok(state, segs.length ? [segs] : [], [], { key: showAll ? 'sim.explain.lsAll' : 'sim.explain.ls' });
};

/** `ls .git/refs/heads` and friends. The rest of .git is not modelled, so we say so. */
function lsDotGit(state: SimState, hit: DotGitHit, name: string): CommandResult {
  if (hit.gitFile !== null) return ok(state, [line(name)]);
  const files = dotGitFiles(state, hit.repo);
  if (files[hit.inner] !== undefined) return ok(state, [line(name)]);
  if (hit.inner === 'refs' || hit.inner.startsWith('refs/')) {
    const dirs = dotGitDirs(files);
    if (!dirs.has(hit.inner)) return fail(state, lines(`ls: cannot access '${name}': No such file or directory`), 'noSuchPath', { key: 'sim.err.noSuchPath', params: { path: name } });
    const children = new Map<string, boolean>();
    for (const d of dirs) if (d.startsWith(`${hit.inner}/`) && !d.slice(hit.inner.length + 1).includes('/')) children.set(d.slice(hit.inner.length + 1), true);
    for (const f of Object.keys(files)) if (f.startsWith(`${hit.inner}/`) && !f.slice(hit.inner.length + 1).includes('/')) children.set(f.slice(hit.inner.length + 1), false);
    const segs: Line = [];
    [...children.entries()].sort(([x], [y]) => x.localeCompare(y)).forEach(([n, isDir], i) => {
      if (i > 0) segs.push({ t: '  ' });
      segs.push(isDir ? { t: n, c: 'blue' } : { t: n });
    });
    return ok(state, segs.length ? [segs] : [], [], { key: 'sim.explain.lsRefs' });
  }
  return fail(state, lines('This practice terminal shows only part of .git. Try: cat .git/HEAD or ls .git/refs/heads'), 'dotGitList', { key: 'sim.err.dotGitList' });
}

export const cd: CommandFn = (state, args) => {
  const target = args[0];
  let dir: string;
  if (!target || target === '~') dir = state.home;
  else if (target === '-') {
    if (!state.lastDir) return fail(state, lines('cd: OLDPWD not set'), 'cdNoOld');
    dir = state.lastDir;
  } else dir = resolve(state.cwd, target, state.home);
  if (fileExists(state, dir)) {
    return fail(state, lines(`cd: ${target}: Not a directory`), 'notADir', {
      key: 'sim.err.notADir',
      params: { path: target ?? '' },
    });
  }
  if (!dirExists(state, dir)) {
    return fail(state, lines(`cd: ${target}: No such file or directory`), 'noSuchPath', {
      key: 'sim.err.noSuchPath',
      params: { path: target ?? '' },
    });
  }
  const next = clone(state);
  next.lastDir = state.cwd;
  next.cwd = dir;
  const out = target === '-' ? [line(dir)] : [];
  return ok(next, out, [{ type: 'cwdChanged', cwd: dir }], { key: 'sim.explain.cd', params: { dir: basename(dir) || '/' } });
};

export const mkdir: CommandFn = (state, args) => {
  const parents = args.includes('-p');
  const names = args.filter((a) => !a.startsWith('-'));
  if (names.length === 0) return fail(state, lines('mkdir: missing operand'), 'missingOperand');
  const next = clone(state);
  const out: Line[] = [];
  for (const name of names) {
    const abs = resolve(state.cwd, name, state.home);
    if (dirExists(next, abs) || fileExists(next, abs)) {
      if (!parents) out.push(line(`mkdir: cannot create directory ‘${name}’: File exists`));
      continue;
    }
    if (!parents && !dirExists(next, dirname(abs))) {
      out.push(line(`mkdir: cannot create directory ‘${name}’: No such file or directory`));
      continue;
    }
    ensureDir(next, abs);
  }
  if (out.length) return fail(state, out, 'mkdirFailed');
  return ok(next, [], [], { key: 'sim.explain.mkdir', params: { name: names.join(' ') } });
};

export const touch: CommandFn = (state, args) => {
  const names = args.filter((a) => !a.startsWith('-'));
  if (names.length === 0) return fail(state, lines('touch: missing file operand'), 'missingOperand');
  const next = clone(state);
  const events: SimEvent[] = [];
  for (const name of names) {
    const abs = resolve(state.cwd, name, state.home);
    if (dirExists(next, abs)) continue;
    if (!dirExists(next, dirname(abs))) {
      return fail(state, lines(`touch: cannot touch '${name}': No such file or directory`), 'noSuchPath');
    }
    if (!fileExists(next, abs)) {
      writeFile(next, abs, '');
      events.push(fileEvent(next, abs, 'fileCreated'));
    }
  }
  return ok(next, [], events, { key: 'sim.explain.touch', params: { name: names.join(' ') } });
};

export const cat: CommandFn = (state, args) => {
  const names = args.filter((a) => !a.startsWith('-'));
  if (names.length === 0) return fail(state, lines('cat: missing file operand'), 'missingOperand');
  const out: Line[] = [];
  let dotGit = false;
  // Like real cat: print what it can, report each problem, and fail at the end.
  const issue: { v: { code: string; explain?: { key: string; params: Record<string, string> } } | null } = { v: null };
  const missing = (name: string, key: string) => {
    out.push(line(`cat: ${name}: No such file or directory`));
    issue.v ??= { code: 'noSuchPath', explain: { key, params: { path: name } } };
  };
  const isDir = (name: string) => {
    out.push(line(`cat: ${name}: Is a directory`));
    issue.v ??= { code: 'isADir' };
  };
  for (const name of names) {
    const abs = resolve(state.cwd, name, state.home);
    // The hidden .git folder is virtual: show HEAD, refs and packed-refs from the repo.
    const hit = locateDotGit(state, abs);
    if (hit) {
      dotGit = true;
      if (hit.gitFile !== null) {
        out.push(line(hit.gitFile));
        continue;
      }
      const files = dotGitFiles(state, hit.repo);
      const content = files[hit.inner];
      if (hit.inner === '' || dotGitDirs(files).has(hit.inner)) isDir(name);
      else if (content === undefined) missing(name, 'sim.err.dotGitMissing');
      else out.push(...lines(content.endsWith('\n') ? content.slice(0, -1) : content));
      continue;
    }
    if (dirExists(state, abs)) {
      isDir(name);
      continue;
    }
    const content = state.fs.files[abs];
    if (content === undefined) {
      missing(name, 'sim.err.noSuchPath');
      continue;
    }
    const body = content.endsWith('\n') ? content.slice(0, -1) : content;
    if (body !== '' || content !== '') out.push(...lines(body));
  }
  if (issue.v) return fail(state, out, issue.v.code, issue.v.explain);
  return ok(state, out, [], { key: dotGit ? 'sim.explain.catDotGit' : 'sim.explain.cat' });
};

/** echo, with optional `> file` or `>> file`. */
export function echo(
  state: SimState,
  args: string[],
  redirect: { append: boolean; target: string } | null,
): CommandResult {
  const text = args.join(' ');
  if (!redirect) return ok(state, [line(text)]);
  const abs = resolve(state.cwd, redirect.target, state.home);
  if (dirExists(state, abs)) {
    return fail(state, lines(`bash: ${redirect.target}: Is a directory`), 'isADir');
  }
  if (!dirExists(state, dirname(abs))) {
    return fail(state, lines(`bash: ${redirect.target}: No such file or directory`), 'noSuchPath');
  }
  const next = clone(state);
  const existed = fileExists(state, abs);
  const before = state.fs.files[abs] ?? '';
  writeFile(next, abs, redirect.append ? `${before}${text}\n` : `${text}\n`);
  return ok(next, [], [fileEvent(next, abs, existed ? 'fileChanged' : 'fileCreated')], {
    key: redirect.append ? 'sim.explain.echoAppend' : 'sim.explain.echoWrite',
    params: { file: redirect.target },
  });
}

export const rm: CommandFn = (state, args) => {
  const recursive = args.some((a) => /^-[a-zA-Z]*r/i.test(a));
  const force = args.some((a) => /^-[a-zA-Z]*f/.test(a));
  const names = args.filter((a) => !a.startsWith('-'));
  if (names.length === 0) return fail(state, lines('rm: missing operand'), 'missingOperand');
  const next = clone(state);
  const events: SimEvent[] = [];
  for (const name of names) {
    const abs = resolve(state.cwd, name, state.home);
    // Deleting the hidden .git folder deletes the repo itself.
    if (basename(abs) === '.git' && next.repos[dirname(abs)]) {
      if (!recursive) return fail(state, lines(`rm: cannot remove '${name}': Is a directory`), 'isADir');
      delete next.repos[dirname(abs)];
      continue;
    }
    if (fileExists(next, abs)) {
      deleteFile(next, abs);
      events.push(fileEvent(next, abs, 'fileDeleted'));
    } else if (dirExists(next, abs)) {
      if (!recursive) return fail(state, lines(`rm: cannot remove '${name}': Is a directory`), 'isADir');
      if (abs === next.cwd || isInside(next.cwd, abs)) {
        return fail(state, lines(`rm: refusing to remove '${name}': you are inside it`), 'rmCwd');
      }
      for (const f of Object.keys(next.fs.files)) {
        if (isInside(f, abs)) {
          deleteFile(next, f);
          events.push(fileEvent(next, f, 'fileDeleted'));
        }
      }
      next.fs.dirs = next.fs.dirs.filter((d) => !isInside(d, abs));
      for (const root of Object.keys(next.repos)) if (isInside(root, abs)) delete next.repos[root];
    } else if (!force) {
      return fail(state, lines(`rm: cannot remove '${name}': No such file or directory`), 'noSuchPath', {
        key: 'sim.err.noSuchPath',
        params: { path: name },
      });
    }
  }
  return ok(next, [], events, { key: 'sim.explain.rm', params: { name: names.join(' ') } });
};

export const clear: CommandFn = (state) => ok(state, [], [{ type: 'cleared' }]);

export const help: CommandFn = (state) =>
  ok(
    state,
    [
      line('Practice terminal commands:', 'bold'),
      line('  pwd  ls  ls -a  cd  mkdir  touch  cat  echo "text" > file  rm  clear'),
      line('  git ...   (try: git help)'),
    ],
    [],
    { key: 'sim.explain.help' },
  );
