// Remotes and the fake GitHub: git remote, push, fetch, pull, clone.
// Hosted repos live in `state.servers`, keyed by URL (e.g. https://github.com/you/diary.git).
import { shortHash } from '../hash';
import { fail, line, lines, notARepo, ok } from '../output';
import { Args } from '../parse';
import { basename, resolve } from '../paths';
import { isAncestorOf, isValidRefName } from '../refs';
import { resolveRev } from '../revision';
import {
  clone,
  dirExists,
  ensureDir,
  fileExists,
  findRepo,
  getConfig,
  hasConflicts,
  headId,
  listDir,
  makeCommit,
  newRepo,
  remoteNames,
  remoteUrl,
  setUpstream,
  upstreamOf,
  writeFile,
} from '../state';
import type { Commit, CommandFn, CommandResult, Line, RefUpdate, Repo, Server, SimEvent, SimState } from '../types';
import { cleanTreeError, divergingError, mergeInto, rebaseOnto } from './git-merge';
import { unmergedCommitError } from './common';

function badOption(state: SimState, opt: string): CommandResult {
  return fail(state, lines(`error: unknown option '${opt.replace(/^-+/, '')}'`), 'badOption', {
    key: 'sim.err.badOption',
    params: { option: opt },
  });
}

// ---------------------------------------------------------------------------
// Servers

/** Find a hosted repo by URL (with or without ".git" / a trailing slash). */
export function findServer(state: SimState, url: string): Server | undefined {
  const base = url.replace(/\/+$/, '').replace(/\.git$/, '');
  return state.servers[url] ?? state.servers[`${base}.git`] ?? state.servers[base];
}

/** Canonical server key for a URL: always ends in ".git". */
export function serverKey(url: string): string {
  const base = url.replace(/\/+$/, '').replace(/\.git$/, '');
  return `${base}.git`;
}

/** Create an empty hosted repo (like "New repository" on GitHub). Mutates `state`. */
export function createServer(state: SimState, url: string, defaultBranch?: string): Server {
  const key = serverKey(url);
  const server: Server = {
    url: key,
    commits: {},
    branches: {},
    tags: {},
    tagInfo: {},
    head: defaultBranch ?? state.globalConfig['init.defaultbranch'] ?? 'main',
  };
  state.servers[key] = server;
  return server;
}

/** Add a commit with `files` on the server's default branch (made in the browser). Mutates `state`. */
export function serverCommit(state: SimState, server: Server, files: Record<string, string>, message: string): string {
  const name = state.globalConfig['user.name'] ?? 'You';
  const email = state.globalConfig['user.email'] ?? 'you@example.com';
  const parent = server.branches[server.head];
  const commit = makeCommit(state, { commits: server.commits } as Repo, {
    message,
    parents: parent ? [parent] : [],
    snapshot: { ...(parent ? server.commits[parent]!.snapshot : {}), ...files },
    author: { name, email },
  });
  server.branches[server.head] = commit.id;
  return commit.id;
}

/** Copy every commit reachable from `tips` that `to` doesn't have yet. */
export function copyCommits(from: Record<string, Commit>, to: Record<string, Commit>, tips: (string | undefined)[]): void {
  const stack = tips.filter((t): t is string => Boolean(t));
  while (stack.length) {
    const id = stack.pop()!;
    if (to[id] || !from[id]) continue;
    to[id] = structuredClone(from[id]!);
    stack.push(...from[id]!.parents);
  }
}

/** "https://github.com/you/diary" (what `git fetch` prints after "From"). */
function displayUrl(url: string): string {
  return url.replace(/\/+$/, '').replace(/\.git$/, '');
}

/** Git's default remote: the branch's remote, else the only remote, else "origin". */
function defaultRemote(repo: Repo, branch: string | null): string {
  const fromBranch = branch ? repo.config[`branch.${branch}.remote`] : undefined;
  if (fromBranch && fromBranch !== '.') return fromBranch;
  const names = remoteNames(repo);
  return names.length === 1 ? names[0]! : 'origin';
}

function isUrl(word: string): boolean {
  return /^[a-z]+:\/\//.test(word) || /^git@/.test(word);
}

function notARepository(state: SimState, name: string): CommandResult {
  return fail(
    state,
    lines(
      `fatal: '${name}' does not appear to be a git repository\nfatal: Could not read from remote repository.\n\nPlease make sure you have the correct access rights\nand the repository exists.`,
    ),
    'noSuchRemote',
    { key: 'sim.err.noSuchRemote', params: { remote: name } },
  );
}

/** The error a missing hosted repo gives (GitHub over HTTPS). */
function repoNotFound(state: SimState, url: string, before: Line[] = []): CommandResult {
  // GitHub over SSH: the simulator has no SSH key, so GitHub can't tell who you are (World 11).
  if (/^(git@github\.com:|ssh:\/\/git@github\.com\/)/.test(url)) {
    return fail(
      state,
      [
        ...before,
        ...lines(
          'git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.\n\nPlease make sure you have the correct access rights\nand the repository exists.',
        ),
      ],
      'publickey',
      { key: 'sim.err.publickey' },
    );
  }
  if (/^https:\/\/github\.com\//.test(url)) {
    return fail(state, [...before, line('remote: Repository not found.'), line(`fatal: repository '${url}/' not found`)], 'repoNotFound', {
      key: 'sim.err.repoNotFound',
      params: { url },
    });
  }
  const host = /^[a-z]+:\/\/([^/]+)/.exec(url)?.[1] ?? url;
  return fail(state, [...before, line(`fatal: unable to access '${url}/': Could not resolve host: ${host}`)], 'repoNotFound', {
    key: 'sim.err.repoNotFound',
    params: { url },
  });
}

/** Turn a remote name or URL into { name, url, server }, or an error result. */
function connect(state: SimState, repo: Repo | undefined, nameOrUrl: string): { name: string | null; url: string; server: Server } | CommandResult {
  const url = repo ? remoteUrl(repo, nameOrUrl) : undefined;
  if (url === undefined && !isUrl(nameOrUrl)) return notARepository(state, nameOrUrl);
  const target = url ?? nameOrUrl;
  const server = findServer(state, target);
  if (!server) return repoNotFound(state, target);
  return { name: url !== undefined ? nameOrUrl : null, url: target, server };
}

// ---------------------------------------------------------------------------
// git remote

export const remote: CommandFn = (state, args) => {
  const repo = findRepo(state);
  if (!repo) return notARepo(state);
  const sub = args[0];
  if (sub === undefined || sub === '-v' || sub === '--verbose' || sub === 'show') {
    if (sub === 'show' && args[1]) return fail(state, [], 'remoteShow', { key: 'sim.err.mergeOptionLater', params: { option: 'remote show <name>' } });
    const names = remoteNames(repo);
    const out: Line[] = sub === '-v' || sub === '--verbose'
      ? names.flatMap((n) => [line(`${n}\t${remoteUrl(repo, n)} (fetch)`), line(`${n}\t${remoteUrl(repo, n)} (push)`)])
      : names.map((n) => line(n));
    return ok(state, out, [], { key: names.length ? (sub === '-v' ? 'sim.explain.remoteV' : 'sim.explain.remoteList') : 'sim.explain.remoteNone' });
  }
  const rest = args.slice(1).filter((x) => !x.startsWith('-'));
  const noSuch = (name: string, colon = true) =>
    fail(state, lines(colon ? `error: No such remote: '${name}'` : `error: No such remote '${name}'`), 'noSuchRemote', { key: 'sim.err.noSuchRemote', params: { remote: name } });
  switch (sub) {
    case 'add': {
      const [name, url] = rest;
      if (!name || !url) return fail(state, lines('usage: git remote add [<options>] <name> <url>'), 'usage', { key: 'sim.err.remoteAddUsage' });
      if (!isValidRefName(`refs/remotes/${name}/test`) || name.includes('/')) {
        return fail(state, lines(`fatal: '${name}' is not a valid remote name`), 'badRemoteName', { key: 'sim.err.badRemoteName', params: { remote: name } });
      }
      if (remoteUrl(repo, name) !== undefined) {
        return fail(state, lines(`error: remote ${name} already exists.`), 'remoteExists', { key: 'sim.err.remoteExists', params: { remote: name } });
      }
      const next = clone(state);
      const r = findRepo(next)!;
      r.config[`remote.${name}.url`] = url;
      r.config[`remote.${name}.fetch`] = `+refs/heads/*:refs/remotes/${name}/*`;
      return ok(next, [], [{ type: 'remoteAdded', name, url }], { key: 'sim.explain.remoteAdd', params: { remote: name, url } });
    }
    case 'remove':
    case 'rm': {
      const [name] = rest;
      if (!name) return fail(state, lines('usage: git remote remove <name>'), 'usage');
      if (remoteUrl(repo, name) === undefined) return noSuch(name);
      const next = clone(state);
      const r = findRepo(next)!;
      for (const k of Object.keys(r.config)) if (k.startsWith(`remote.${name}.`)) delete r.config[k];
      for (const k of Object.keys(r.config)) {
        const m = /^branch\.(.+)\.remote$/.exec(k);
        if (m && r.config[k] === name) {
          delete r.config[k];
          delete r.config[`branch.${m[1]}.merge`];
        }
      }
      for (const ref of Object.keys(r.remoteRefs)) if (ref.startsWith(`${name}/`)) delete r.remoteRefs[ref];
      delete r.remoteHeads[name];
      return ok(next, [], [{ type: 'remoteRemoved', name }], { key: 'sim.explain.remoteRemove', params: { remote: name } });
    }
    case 'rename': {
      const [from, to] = rest;
      if (!from || !to) return fail(state, lines('usage: git remote rename [--[no-]progress] <old> <new>'), 'usage');
      if (remoteUrl(repo, from) === undefined) return noSuch(from);
      if (remoteUrl(repo, to) !== undefined) return fail(state, lines(`error: remote ${to} already exists.`), 'remoteExists', { key: 'sim.err.remoteExists', params: { remote: to } });
      if (!isValidRefName(`refs/remotes/${to}/test`) || to.includes('/')) {
        return fail(state, lines(`fatal: '${to}' is not a valid remote name`), 'badRemoteName', { key: 'sim.err.badRemoteName', params: { remote: to } });
      }
      const next = clone(state);
      const r = findRepo(next)!;
      const config: Record<string, string> = {};
      for (const [k, v] of Object.entries(r.config)) {
        if (k.startsWith(`remote.${from}.`)) config[`remote.${to}.${k.slice(`remote.${from}.`.length)}`] = k.endsWith('.fetch') ? `+refs/heads/*:refs/remotes/${to}/*` : v;
        else if (/^branch\..+\.remote$/.test(k) && v === from) config[k] = to;
        else config[k] = v;
      }
      r.config = config;
      const refs: Record<string, string> = {};
      for (const [k, v] of Object.entries(r.remoteRefs)) refs[k.startsWith(`${from}/`) ? `${to}/${k.slice(from.length + 1)}` : k] = v;
      r.remoteRefs = refs;
      if (r.remoteHeads[from] !== undefined) {
        r.remoteHeads[to] = r.remoteHeads[from]!;
        delete r.remoteHeads[from];
      }
      return ok(next, [], [{ type: 'remoteRenamed', from, to }], { key: 'sim.explain.remoteRename', params: { from, to } });
    }
    case 'set-url': {
      const [name, url] = rest;
      if (!name || !url) return fail(state, lines('usage: git remote set-url [--push] <name> <newurl> [<oldurl>]'), 'usage');
      if (remoteUrl(repo, name) === undefined) return noSuch(name, false);
      const next = clone(state);
      findRepo(next)!.config[`remote.${name}.url`] = url;
      return ok(next, [], [], { key: 'sim.explain.remoteSetUrl', params: { remote: name, url } });
    }
    case 'get-url': {
      const [name] = rest;
      if (!name) return fail(state, lines('usage: git remote get-url [--push] [--all] <name>'), 'usage');
      const url = remoteUrl(repo, name);
      if (url === undefined) return noSuch(name, false);
      return ok(state, [line(url)], [], { key: 'sim.explain.remoteGetUrl', params: { remote: name } });
    }
    default:
      return fail(state, lines(`error: unknown subcommand: \`${sub}'`), 'badSub', { key: 'sim.err.remoteSub', params: { sub } });
  }
};

// ---------------------------------------------------------------------------
// git push

interface PushRef {
  kind: 'branch' | 'tag';
  src: string | null; // local name (null = delete)
  dst: string; // name on the server
  newId: string | null;
  force: boolean;
}

type Rejection = 'fetch first' | 'non-fast-forward' | 'stale info' | 'already exists';

const W = 17; // width of the summary column (2 × abbrev + 3)

function statusLine(flag: string, summary: string, from: string | null, to: string, msg?: string): Line {
  return line(` ${flag} ${summary.padEnd(W)} ${from ? `${from} -> ${to}` : to}${msg ? ` (${msg})` : ''}`);
}

const NO_PUSH_DEST = `fatal: No configured push destination.
Either specify the URL from the command-line or configure a remote repository using

    git remote add <name> <url>

and then push using the remote name

    git push <name>
`;

function noUpstreamError(state: SimState, branch: string, remoteName: string): CommandResult {
  return fail(
    state,
    lines(
      `fatal: The current branch ${branch} has no upstream branch.\nTo push the current branch and set the remote as upstream, use\n\n    git push --set-upstream ${remoteName} ${branch}\n\nTo have this happen automatically for branches without a tracking\nupstream, see 'push.autoSetupRemote' in 'git help config'.\n`,
    ),
    'noUpstream',
    { key: 'sim.err.pushNoUpstream', params: { branch, remote: remoteName } },
  );
}

export const push: CommandFn = (state, args) => {
  const repo = findRepo(state);
  if (!repo) return notARepo(state);
  let lease = false;
  const rest: string[] = [];
  for (const w of args) {
    if (w === '--force-with-lease' || w.startsWith('--force-with-lease=')) lease = true;
    else rest.push(w);
  }
  const a = new Args(rest, {
    flags: ['-u', '--set-upstream', '-f', '--force', '--tags', '-d', '--delete', '-q', '--quiet', '-v', '--verbose', '--all', '--follow-tags'],
    combined: true,
  });
  if (a.unknown.length) return badOption(state, a.unknown[0]!);
  const setUp = a.has('-u', '--set-upstream');
  const force = a.has('-f', '--force');
  const current = repo.head.type === 'branch' ? repo.head.name : null;

  // Which remote?
  let remoteArg = a.positional[0];
  if (!remoteArg) {
    const pushRemote = current ? getConfig(state, repo, `branch.${current}.pushRemote`) : undefined;
    remoteArg = pushRemote ?? defaultRemote(repo, current);
    if (remoteUrl(repo, remoteArg) === undefined) return fail(state, lines(NO_PUSH_DEST), 'noPushDest', { key: 'sim.err.pushNoRemote' });
  }
  const conn = connect(state, repo, remoteArg);
  if ('state' in conn) return conn;
  const { name: remoteName, url, server } = conn;
  const failPush = (msgs: string[], code: string, key: string, params: Record<string, string> = {}) =>
    fail(state, lines([...msgs, `error: failed to push some refs to '${url}'`].join('\n')), code, { key, params });

  // Which refs?
  const refs: PushRef[] = [];
  const specs = a.positional.slice(1);
  if (a.has('-d', '--delete')) {
    if (!specs.length) return fail(state, lines('fatal: --delete doesn\'t make sense without any refs'), 'deleteNoRefs', { key: 'sim.err.pushDeleteNeedRef' });
    for (const s of specs) refs.push({ kind: server.tags[s] !== undefined && server.branches[s] === undefined ? 'tag' : 'branch', src: null, dst: s, newId: null, force: false });
  } else if (specs.length) {
    for (let spec of specs) {
      let plus = false;
      if (spec.startsWith('+')) {
        plus = true;
        spec = spec.slice(1);
      }
      const [srcRaw, dstRaw] = spec.includes(':') ? (spec.split(':', 2) as [string, string]) : [spec, undefined];
      if (srcRaw === '') {
        refs.push({ kind: 'branch', src: null, dst: dstRaw!, newId: null, force: false });
        continue;
      }
      let src = srcRaw.replace(/^refs\/heads\//, '').replace(/^refs\/tags\//, '');
      if (src === 'HEAD') {
        if (!current && !dstRaw) {
          return fail(state, lines('error: The destination you provided is not a full refname (i.e.,\nstarting with "refs/"). We tried to guess what you meant by:'), 'pushHead');
        }
        src = current ?? 'HEAD';
      }
      const isTag = repo.tags[src] !== undefined && repo.branches[src] === undefined;
      const id = isTag ? repo.tags[src] : repo.branches[src] ?? (src === 'HEAD' ? headId(repo) ?? undefined : undefined);
      if (!id) {
        const res = resolveRev(repo, srcRaw);
        if (!res.ok || !dstRaw) return failPush([`error: src refspec ${srcRaw} does not match any`], 'badRefspec', 'sim.err.pushBadRefspec', { ref: srcRaw });
        refs.push({ kind: 'branch', src: srcRaw, dst: dstRaw.replace(/^refs\/heads\//, ''), newId: res.id, force: plus });
        continue;
      }
      refs.push({ kind: isTag ? 'tag' : 'branch', src, dst: (dstRaw ?? src).replace(/^refs\/heads\//, '').replace(/^refs\/tags\//, ''), newId: id, force: plus });
    }
  } else if (a.has('--tags')) {
    // Only tags.
  } else if (a.has('--all')) {
    for (const [b, id] of Object.entries(repo.branches).sort()) refs.push({ kind: 'branch', src: b, dst: b, newId: id, force: false });
  } else {
    // push.default=simple
    if (!current) {
      return fail(
        state,
        lines(`fatal: You are not currently on a branch.\nTo push the history leading to the current (detached HEAD)\nstate now, use\n\n    git push ${remoteArg} HEAD:<name-of-remote-branch>\n`),
        'detachedPush',
        { key: 'sim.err.pushDetached' },
      );
    }
    const up = upstreamOf(repo, current);
    const autoSetup = getConfig(state, repo, 'push.autoSetupRemote') === 'true';
    let dst = current;
    if (up && up.remote === (remoteName ?? '')) {
      if (up.branch !== current) {
        return fail(
          state,
          lines(
            `fatal: The upstream branch of your current branch does not match\nthe name of your current branch.  To push to the upstream branch\non the remote, use\n\n    git push ${remoteArg} HEAD:${up.branch}\n\nTo push to the branch of the same name on the remote, use\n\n    git push ${remoteArg} HEAD\n\nTo choose either option permanently, see push.default in 'git help config'.\n\nTo avoid automatically configuring an upstream branch when its name\nwon't match the local branch, see option 'track' of branch.autoSetupMerge\nin 'git help config'.\n`,
          ),
          'upstreamMismatch',
          { key: 'sim.err.pushUpstreamMismatch' },
        );
      }
      dst = up.branch;
    } else if (!up && !autoSetup && remoteName && (!a.positional[0] || remoteName === 'origin' || remoteNames(repo).length === 1)) {
      return noUpstreamError(state, current, remoteName);
    }
    const id = repo.branches[current];
    if (!id) return failPush([`error: src refspec ${current} does not match any`], 'badRefspec', 'sim.err.pushBadRefspec', { ref: current });
    refs.push({ kind: 'branch', src: current, dst, newId: id, force: false });
  }
  if (a.has('--tags') || a.has('--follow-tags')) {
    for (const [t, id] of Object.entries(repo.tags).sort()) {
      if (refs.some((r) => r.kind === 'tag' && r.dst === t)) continue;
      if (a.has('--follow-tags') && !a.has('--tags') && !refs.some((r) => r.newId && isAncestorOf(repo.commits, id, r.newId))) continue;
      refs.push({ kind: 'tag', src: t, dst: t, newId: id, force: false });
    }
  }

  // Decide each update.
  const okLines: Line[] = [];
  const rejected: { ref: PushRef; reason: Rejection }[] = [];
  const accepted: { ref: PushRef; old: string | null }[] = [];
  const errors: string[] = [];
  for (const ref of refs) {
    const table = ref.kind === 'tag' ? server.tags : server.branches;
    const old = table[ref.dst] ?? null;
    if (ref.newId === null) {
      if (old === null) {
        errors.push(`error: unable to delete '${ref.dst}': remote ref does not exist`);
        continue;
      }
      accepted.push({ ref, old });
      okLines.push(statusLine('-', '[deleted]', null, ref.dst));
      continue;
    }
    if (old === ref.newId) continue; // up to date
    if (old === null) {
      accepted.push({ ref, old });
      okLines.push(statusLine('*', ref.kind === 'tag' ? '[new tag]' : '[new branch]', ref.src, ref.dst));
      continue;
    }
    if (ref.kind === 'tag') {
      if (force || ref.force) {
        accepted.push({ ref, old });
        okLines.push(statusLine('+', `${shortHash(old)}...${shortHash(ref.newId)}`, ref.src, ref.dst, 'forced update'));
      } else rejected.push({ ref, reason: 'already exists' });
      continue;
    }
    const ff = Boolean(repo.commits[old]) && isAncestorOf(repo.commits, old, ref.newId);
    if (lease && !force && !ref.force) {
      const expected = remoteName ? (repo.remoteRefs[`${remoteName}/${ref.dst}`] ?? null) : null;
      if (expected !== old) {
        rejected.push({ ref, reason: 'stale info' });
        continue;
      }
    }
    if (ff) {
      accepted.push({ ref, old });
      okLines.push(statusLine(' ', `${shortHash(old)}..${shortHash(ref.newId)}`, ref.src, ref.dst));
    } else if (force || lease || ref.force) {
      accepted.push({ ref, old });
      okLines.push(statusLine('+', `${shortHash(old)}...${shortHash(ref.newId)}`, ref.src, ref.dst, 'forced update'));
    } else rejected.push({ ref, reason: repo.commits[old] ? 'non-fast-forward' : 'fetch first' });
  }
  if (errors.length && !accepted.length && !rejected.length) {
    return failPush(errors, 'pushDeleteMissing', 'sim.err.pushDeleteMissing', { ref: refs[0]?.dst ?? '' });
  }

  const next = clone(state);
  const r = findRepo(next)!;
  const srv = next.servers[server.url]!;
  const updates: RefUpdate[] = [];
  const wasEmpty = Object.keys(srv.branches).length === 0;
  const remoteLines: Line[] = [];
  for (const { ref, old } of accepted) {
    const table = ref.kind === 'tag' ? srv.tags : srv.branches;
    if (ref.newId === null) {
      delete table[ref.dst];
      if (ref.kind === 'tag') delete srv.tagInfo[ref.dst];
      else if (remoteName) delete r.remoteRefs[`${remoteName}/${ref.dst}`];
    } else {
      copyCommits(r.commits, srv.commits, [ref.newId]);
      table[ref.dst] = ref.newId;
      if (ref.kind === 'tag') {
        if (r.tagInfo[ref.src!]) srv.tagInfo[ref.dst] = structuredClone(r.tagInfo[ref.src!]!);
        else delete srv.tagInfo[ref.dst];
      } else if (remoteName) r.remoteRefs[`${remoteName}/${ref.dst}`] = ref.newId;
      if (ref.kind === 'branch' && old === null) {
        if (wasEmpty && updates.every((u) => u.ref.startsWith('tags/'))) srv.head = ref.dst;
        else if (/^https:\/\/github\.com\//.test(url) && ref.dst !== srv.head) {
          const web = displayUrl(srv.url);
          remoteLines.push(
            line('remote: '),
            line(`remote: Create a pull request for '${ref.dst}' on GitHub by visiting:`),
            line(`remote:      ${web}/pull/new/${ref.dst}`),
            line('remote: '),
          );
        }
      }
    }
    updates.push({ ref: ref.kind === 'tag' ? `tags/${ref.dst}` : ref.dst, from: old, to: ref.newId, ...(old !== null && ref.newId !== null && !isAncestorOf(r.commits, old, ref.newId) ? { forced: true } : {}) });
  }
  // -u: remember where each pushed branch goes (also when it was already up to date).
  const tracking: Line[] = [];
  const events: SimEvent[] = [];
  if (setUp && remoteName && !rejected.length) {
    for (const ref of refs) {
      if (ref.kind !== 'branch' || !ref.src || ref.newId === null || r.branches[ref.src] === undefined) continue;
      setUpstream(r, ref.src, remoteName, ref.dst);
      tracking.push(line(`branch '${ref.src}' set up to track '${remoteName}/${ref.dst}'.`));
      events.push({ type: 'upstreamSet', branch: ref.src, upstream: `${remoteName}/${ref.dst}` });
    }
  } else if (!setUp && remoteName && current && getConfig(state, repo, 'push.autoSetupRemote') === 'true' && !upstreamOf(r, current) && refs.length === 1 && refs[0]!.src === current && !rejected.length) {
    setUpstream(r, current, remoteName, refs[0]!.dst);
    tracking.push(line(`branch '${current}' set up to track '${remoteName}/${refs[0]!.dst}'.`));
  }

  const out: Line[] = [...remoteLines];
  if (!a.has('-q', '--quiet') || rejected.length) {
    if (okLines.length || rejected.length) {
      out.push(line(`To ${url}`), ...okLines);
      for (const { ref, reason } of rejected) out.push(statusLine('!', '[rejected]', ref.src, ref.dst, reason));
    } else if (!errors.length) out.push(line('Everything up-to-date'));
  }
  for (const e of errors) out.push(line(e));
  if (updates.length) events.unshift({ type: 'pushed', url: srv.url, remote: remoteName, updates });
  if (rejected.length || errors.length) {
    out.push(line(`error: failed to push some refs to '${url}'`));
    const reasons = new Set(rejected.map((x) => x.reason));
    if (reasons.has('fetch first')) {
      out.push(...lines(
        "hint: Updates were rejected because the remote contains work that you do not\nhint: have locally. This is usually caused by another repository pushing to\nhint: the same ref. If you want to integrate the remote changes, use\nhint: 'git pull' before pushing again.\nhint: See the 'Note about fast-forwards' in 'git push --help' for details.",
      ));
    } else if (reasons.has('non-fast-forward')) {
      const isCurrent = rejected.some((x) => x.reason === 'non-fast-forward' && x.ref.src === current);
      out.push(...lines(
        isCurrent
          ? "hint: Updates were rejected because the tip of your current branch is behind\nhint: its remote counterpart. If you want to integrate the remote changes,\nhint: use 'git pull' before pushing again.\nhint: See the 'Note about fast-forwards' in 'git push --help' for details."
          : "hint: Updates were rejected because a pushed branch tip is behind its remote\nhint: counterpart. If you want to integrate the remote changes, use 'git pull'\nhint: before pushing again.\nhint: See the 'Note about fast-forwards' in 'git push --help' for details.",
      ));
    } else if (reasons.has('already exists')) {
      out.push(line('hint: Updates were rejected because the tag already exists in the remote.'));
    }
    for (const x of rejected) events.push({ type: 'pushRejected', url: srv.url, ref: x.ref.dst, reason: x.reason === 'fetch first' ? 'fetchFirst' : x.reason === 'non-fast-forward' ? 'nonFastForward' : x.reason === 'stale info' ? 'staleInfo' : 'alreadyExists' });
    const reason = rejected[0]?.reason;
    const key = reason === 'stale info' ? 'sim.err.pushStale' : reason === 'fetch first' ? 'sim.err.pushFetchFirst' : reason === 'non-fast-forward' ? 'sim.err.pushNonFF' : reason === 'already exists' ? 'sim.err.pushTagExists' : 'sim.err.pushDeleteMissing';
    // Accepted refs in the same push still went through.
    return { state: updates.length ? next : state, output: [...out, ...tracking], events: [...events, { type: 'error', code: 'pushRejected' }], ok: false, explain: { key, params: { ref: rejected[0]?.ref.dst ?? refs[0]?.dst ?? '', remote: remoteArg } } };
  }
  out.push(...tracking);
  const forced = updates.some((u) => u.forced);
  const key = !updates.length
    ? 'sim.explain.pushUpToDate'
    : forced
      ? 'sim.explain.pushForced'
      : updates.some((u) => u.to === null)
        ? 'sim.explain.pushDelete'
        : updates.every((u) => u.ref.startsWith('tags/'))
          ? 'sim.explain.pushTags'
          : updates.some((u) => u.from === null)
            ? 'sim.explain.pushNewBranch'
            : 'sim.explain.push';
  return ok(next, out, events, { key, params: { branch: refs[0]?.dst ?? '', remote: remoteArg } });
};

// ---------------------------------------------------------------------------
// git fetch

interface FetchResult {
  lines: Line[];
  updates: RefUpdate[];
}

/** Fetch from one remote into the (cloned) repo. Optional `only` = a single branch (pull <remote> <branch>). */
function fetchInto(repo: Repo, remoteName: string | null, server: Server, opts: { prune?: boolean; tags?: boolean; only?: string }): FetchResult {
  type Row = { flag: string; summary: string; from: string; to: string; msg?: string };
  const rows: Row[] = [];
  const pruneRows: Row[] = [];
  const updates: RefUpdate[] = [];
  copyCommits(server.commits, repo.commits, [...Object.values(server.branches), ...Object.values(server.tags)]);
  if (remoteName && opts.prune && !opts.only) {
    for (const ref of Object.keys(repo.remoteRefs).sort()) {
      if (!ref.startsWith(`${remoteName}/`)) continue;
      const b = ref.slice(remoteName.length + 1);
      if (server.branches[b] === undefined) {
        pruneRows.push({ flag: '-', summary: '[deleted]', from: '(none)', to: ref });
        updates.push({ ref, from: repo.remoteRefs[ref]!, to: null });
        delete repo.remoteRefs[ref];
        if (repo.remoteHeads[remoteName] === b) delete repo.remoteHeads[remoteName];
      }
    }
  }
  const names = Object.keys(server.branches).sort();
  if (opts.only) rows.push({ flag: '*', summary: 'branch', from: opts.only, to: 'FETCH_HEAD' });
  for (const b of names) {
    if (!remoteName) break;
    if (opts.only && b !== opts.only) continue;
    const ref = `${remoteName}/${b}`;
    const old = repo.remoteRefs[ref] ?? null;
    const now = server.branches[b]!;
    if (old === now) continue;
    if (old === null) rows.push({ flag: '*', summary: '[new branch]', from: b, to: ref });
    else if (isAncestorOf(repo.commits, old, now)) rows.push({ flag: ' ', summary: `${shortHash(old)}..${shortHash(now)}`, from: b, to: ref });
    else rows.push({ flag: '+', summary: `${shortHash(old)}...${shortHash(now)}`, from: b, to: ref, msg: ' (forced update)' });
    repo.remoteRefs[ref] = now;
    updates.push({ ref, from: old, to: now, ...(old && !isAncestorOf(repo.commits, old, now) ? { forced: true } : {}) });
  }
  // Tags: all with --tags, else the ones pointing into what we have now.
  for (const t of Object.keys(server.tags).sort()) {
    const id = server.tags[t]!;
    if (repo.tags[t] !== undefined) continue;
    if (!opts.tags && opts.only) continue;
    repo.tags[t] = id;
    if (server.tagInfo[t]) repo.tagInfo[t] = structuredClone(server.tagInfo[t]!);
    rows.push({ flag: '*', summary: '[new tag]', from: t, to: t });
    updates.push({ ref: `tags/${t}`, from: null, to: id });
  }
  // Git 2.48+: create refs/remotes/<remote>/HEAD when it is missing.
  if (remoteName && !opts.only && repo.remoteHeads[remoteName] === undefined && server.branches[server.head] !== undefined) {
    repo.remoteHeads[remoteName] = server.head;
  }
  const all = [...pruneRows, ...rows];
  if (!all.length) return { lines: [], updates };
  const width = Math.max(10, ...rows.filter((x) => x.summary !== 'branch').map((x) => x.from.length));
  const out: Line[] = [line(`From ${displayUrl(server.url)}`)];
  for (const x of all) out.push(line(` ${x.flag} ${x.summary.padEnd(W)} ${x.from.padEnd(width)} -> ${x.to}${x.msg ? ` ${x.msg}` : ''}`));
  return { lines: out, updates };
}

export const fetch: CommandFn = (state, args) => {
  const repo = findRepo(state);
  if (!repo) return notARepo(state);
  const a = new Args(args, { flags: ['--all', '-p', '--prune', '--tags', '-t', '-q', '--quiet', '-v', '--verbose'], combined: true });
  if (a.unknown.length) return badOption(state, a.unknown[0]!);
  const current = repo.head.type === 'branch' ? repo.head.name : null;
  let names: string[];
  if (a.has('--all')) names = remoteNames(repo);
  else if (a.positional[0]) names = [a.positional[0]];
  else {
    // With no remotes at all, `git fetch` quietly does nothing.
    if (!remoteNames(repo).length) return ok(state, [], [], { key: 'sim.explain.fetchNoRemote' });
    names = [defaultRemote(repo, current)];
  }
  const next = clone(state);
  const r = findRepo(next)!;
  const out: Line[] = [];
  const events: SimEvent[] = [];
  for (const name of names) {
    const conn = connect(next, r, name);
    if ('state' in conn) return { ...conn, state };
    const only = a.positional[1];
    if (only && conn.server.branches[only] === undefined) return fail(state, lines(`fatal: couldn't find remote ref ${only}`), 'noRemoteRef', { key: 'sim.err.noRemoteRef', params: { ref: only } });
    const res = fetchInto(r, conn.name, conn.server, { prune: a.has('-p', '--prune'), tags: a.has('--tags', '-t'), ...(only ? { only } : {}) });
    if (!a.has('-q', '--quiet')) out.push(...res.lines);
    events.push({ type: 'fetched', url: conn.server.url, remote: conn.name, updates: res.updates });
  }
  const changed = events.some((e) => e.type === 'fetched' && e.updates.length > 0);
  return ok(next, out, events, { key: changed ? 'sim.explain.fetch' : 'sim.explain.fetchNothing', params: { remote: names.join(', ') } });
};

// ---------------------------------------------------------------------------
// git pull

const DIVERGENT = `hint: You have divergent branches and need to specify how to reconcile them.
hint: You can do so by running one of the following commands sometime before
hint: your next pull:
hint:
hint:   git config pull.rebase false  # merge
hint:   git config pull.rebase true   # rebase
hint:   git config pull.ff only       # fast-forward only
hint:
hint: You can replace "git config" with "git config --global" to set a default
hint: preference for all repositories. You can also pass --rebase, --no-rebase,
hint: or --ff-only on the command line to override the configured default per
hint: invocation.
fatal: Need to specify how to reconcile divergent branches.`;

export const pull: CommandFn = (state, args) => {
  const repo = findRepo(state);
  if (!repo) return notARepo(state);
  const a = new Args(args, { flags: ['--rebase', '-r', '--no-rebase', '--ff-only', '--ff', '--no-ff', '-q', '--quiet', '-v', '--verbose', '--all'], combined: true });
  if (a.unknown.length) return badOption(state, a.unknown[0]!);
  if (hasConflicts(repo)) return fail(state, unmergedCommitError(repo, 'Pulling'), 'unmerged', { key: 'sim.err.unmerged' });
  if (repo.op?.kind === 'merge') {
    return fail(state, lines('fatal: You have not concluded your merge (MERGE_HEAD exists).\nPlease, commit your changes before you merge.'), 'mergeInProgress', { key: 'sim.err.mergeInProgress' });
  }
  const current = repo.head.type === 'branch' ? repo.head.name : null;
  const up = current ? upstreamOf(repo, current) : null;
  let remoteName = a.positional[0];
  let branchName = a.positional[1];
  if (!remoteName) {
    if (!up || up.remote === '.') {
      const remotes = remoteNames(repo);
      const hintRemote = remotes.length === 1 ? remotes[0]! : '<remote>';
      const error = lines(
        `There is no tracking information for the current branch.\nPlease specify which branch you want to merge with.\nSee git-pull(1) for details.\n\n    git pull <remote> <branch>\n\nIf you wish to set tracking information for this branch you can do so with:\n\n    git branch --set-upstream-to=${hintRemote}/<branch> ${current ?? '<branch>'}\n`,
      );
      // Git still fetches from the default remote first.
      let after = state;
      const fetchedLines: Line[] = [];
      if (remotes.length) {
        const conn0 = connect(state, repo, defaultRemote(repo, current));
        if ('state' in conn0) return conn0;
        after = clone(state);
        fetchedLines.push(...fetchInto(findRepo(after)!, conn0.name, conn0.server, {}).lines);
      }
      const res = fail(after, [...fetchedLines, ...error], 'noUpstream', { key: 'sim.err.pullNoUpstream' });
      return res;
    }
    remoteName = up.remote;
    branchName = up.branch;
  } else if (!branchName) {
    if (up && up.remote === remoteName) branchName = up.branch;
    else {
      return fail(
        state,
        lines(
          `You asked to pull from the remote '${remoteName}', but did not specify\na branch. Because this is not the default configured remote\nfor your current branch, you must specify a branch on the command line.`,
        ),
        'pullNeedBranch',
        { key: 'sim.err.pullNeedBranch', params: { remote: remoteName } },
      );
    }
  }
  const conn = connect(state, repo, remoteName);
  if ('state' in conn) return conn;
  const explicit = a.positional[1] !== undefined;
  if (conn.server.branches[branchName] === undefined) {
    if (explicit) return fail(state, lines(`fatal: couldn't find remote ref ${branchName}`), 'noRemoteRef', { key: 'sim.err.noRemoteRef', params: { ref: branchName } });
    return fail(
      state,
      lines(`Your configuration specifies to merge with the ref 'refs/heads/${branchName}'\nfrom the remote, but no such ref was fetched.`),
      'upstreamGone',
      { key: 'sim.err.pullUpstreamGone', params: { ref: branchName } },
    );
  }
  // 1. Fetch.
  const fetched = clone(state);
  const fr = findRepo(fetched)!;
  // `git pull origin main` fetches into FETCH_HEAD and also updates origin/main.
  const fres = fetchInto(fr, conn.name, conn.server, explicit ? { only: branchName } : {});
  const fetchLines = a.has('-q', '--quiet') ? [] : fres.lines;
  const theirs = conn.server.branches[branchName]!;
  const head = headId(fr);
  const withFetch = (r: CommandResult): CommandResult => {
    const events: SimEvent[] = [{ type: 'fetched', url: conn.server.url, remote: conn.name, updates: fres.updates }, ...r.events];
    // A failed integration still keeps what was fetched.
    if (!r.ok && !r.stopped) return { ...r, state: fetched, output: [...fetchLines, ...r.output], events };
    return { ...r, output: [...fetchLines, ...r.output], events };
  };
  // 2. Merge or rebase.
  const cfgRebase = current ? (fr.config[`branch.${current}.rebase`] ?? getConfig(state, repo, 'pull.rebase')) : getConfig(state, repo, 'pull.rebase');
  const rebaseMode = a.has('--rebase', '-r') ? true : a.has('--no-rebase') ? false : cfgRebase === undefined ? null : cfgRebase !== 'false';
  const cfgFF = getConfig(state, repo, 'pull.ff');
  const ffMode = a.has('--ff-only') ? 'only' : a.has('--no-ff') ? 'false' : a.has('--ff') ? 'true' : (cfgFF ?? null);
  const label = branchName;
  if (!head) {
    // Pulling into a branch with no commits yet: Git just checks the commit out, quietly.
    const into = mergeInto(fetched, theirs, label, { reflog: 'pull' });
    return { ...into, output: [...fetchLines, ...(into.ok ? [] : into.output)], events: [{ type: 'fetched', url: conn.server.url, remote: conn.name, updates: fres.updates }, ...into.events] };
  }
  if (rebaseMode) {
    const dirty = cleanTreeError(fetched, fr, 'pull with rebase');
    if (dirty) return { ...dirty, output: [...fetchLines, ...dirty.output], state: fetched };
    if (!head || isAncestorOf(fr.commits, head, theirs)) {
      return withFetch(mergeInto(fetched, theirs, label, { ffOnly: true, reflog: 'pull --rebase' }));
    }
    return withFetch(rebaseOnto(fetched, conn.name ? `${conn.name}/${branchName}` : theirs, theirs));
  }
  const canFF = !head || isAncestorOf(fr.commits, head, theirs);
  const upToDate = head !== null && isAncestorOf(fr.commits, theirs, head);
  if (rebaseMode === null && ffMode === null && !canFF && !upToDate) {
    return { state: fetched, output: [...fetchLines, ...lines(DIVERGENT)], events: [{ type: 'fetched', url: conn.server.url, remote: conn.name, updates: fres.updates }, { type: 'error', code: 'divergent' }], ok: false, explain: { key: 'sim.err.pullDivergent' } };
  }
  if (ffMode === 'only' && !canFF && !upToDate) {
    const d = divergingError(fetched);
    return { ...d, state: fetched, output: [...fetchLines, ...d.output] };
  }
  return withFetch(
    mergeInto(fetched, theirs, label, {
      noFF: ffMode === 'false',
      url: conn.url,
      markerLabel: theirs,
      reflog: 'pull',
    }),
  );
};

// ---------------------------------------------------------------------------
// git clone

export const cloneCmd: CommandFn = (state, args) => {
  const a = new Args(args, { flags: ['-q', '--quiet', '--no-checkout'], values: ['-b', '--branch', '--depth'] });
  if (a.unknown.length) return badOption(state, a.unknown[0]!);
  const url = a.positional[0];
  if (!url) return fail(state, lines('fatal: You must specify a repository to clone.'), 'cloneUsage', { key: 'sim.err.cloneNeedUrl' });
  const dirArg = a.positional[1] ?? basename(url.replace(/\/+$/, '')).replace(/\.git$/, '');
  const root = resolve(state.cwd, dirArg, state.home);
  if (fileExists(state, root) || (dirExists(state, root) && listDir(state, root).length > 0)) {
    return fail(state, lines(`fatal: destination path '${dirArg}' already exists and is not an empty directory.`), 'destExists', {
      key: 'sim.err.cloneExists',
      params: { dir: dirArg },
    });
  }
  const quiet = a.has('-q', '--quiet');
  const head = quiet ? [] : [line(`Cloning into '${dirArg}'...`)];
  const server = findServer(state, url);
  if (!server) return repoNotFound(state, url, head);
  const branchOpt = a.get('-b', '--branch');
  if (branchOpt !== undefined && server.branches[branchOpt] === undefined) {
    return fail(state, [...head, line(`warning: Could not find remote branch ${branchOpt} to clone.`), line(`fatal: Remote branch ${branchOpt} not found in upstream origin`)], 'noBranch', {
      key: 'sim.err.noRemoteRef',
      params: { ref: branchOpt },
    });
  }
  const next = clone(state);
  ensureDir(next, root);
  const empty = Object.keys(server.branches).length === 0;
  const branch = branchOpt ?? server.head;
  const repo = newRepo(root, branch);
  next.repos[root] = repo;
  copyCommits(server.commits, repo.commits, [...Object.values(server.branches), ...Object.values(server.tags)]);
  for (const [b, id] of Object.entries(server.branches)) repo.remoteRefs[`origin/${b}`] = id;
  for (const [t, id] of Object.entries(server.tags)) repo.tags[t] = id;
  for (const [t, info] of Object.entries(server.tagInfo)) repo.tagInfo[t] = structuredClone(info);
  repo.config['remote.origin.url'] = url;
  repo.config['remote.origin.fetch'] = '+refs/heads/*:refs/remotes/origin/*';
  setUpstream(repo, branch, 'origin', branch);
  const out = [...head];
  if (empty) {
    if (!quiet) out.push(line('warning: You appear to have cloned an empty repository.'));
  } else {
    repo.remoteHeads.origin = server.head;
    const tip = server.branches[branch]!;
    repo.branches[branch] = tip;
    const snap = repo.commits[tip]!.snapshot;
    repo.index = { ...snap };
    if (!a.has('--no-checkout')) for (const [p, content] of Object.entries(snap)) writeFile(next, `${root}/${p}`, content);
    repo.reflog.unshift({ commit: tip, message: `clone: from ${url}` });
  }
  return ok(next, out, [{ type: 'cloned', url: server.url, root }, { type: 'repoInitialized', root, reinit: false }], {
    key: empty ? 'sim.explain.cloneEmpty' : 'sim.explain.clone',
    params: { dir: dirArg, url },
  });
};
