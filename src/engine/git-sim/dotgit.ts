// A read-only view of a few files inside the hidden .git folder, built from engine
// state: HEAD, loose refs, packed-refs, ORIG_HEAD, MERGE_HEAD and the bisect log.
// The practice terminal's `cat` and `ls` use it (e.g. `cat .git/HEAD`).
import { allRefs } from './objects';
import { isInside, relative } from './paths';
import { mainRepo } from './state';
import type { Repo, SimState } from './types';

export interface DotGitHit {
  repo: Repo;
  /** Path inside .git, e.g. "refs/heads/main" ('' for the .git folder itself). */
  inner: string;
  /** For a linked worktree, `.git` is a small file pointing at the real folder. */
  gitFile: string | null;
}

/** If `abs` is inside some repo's .git folder (or is a worktree's .git file), say where. */
export function locateDotGit(state: SimState, abs: string): DotGitHit | null {
  for (const repo of Object.values(state.repos)) {
    const dir = `${repo.root}/.git`;
    if (abs === dir || isInside(abs, dir)) return { repo, inner: abs === dir ? '' : relative(abs, dir), gitFile: null };
    for (const wt of Object.values(repo.worktrees ?? {})) {
      if (abs === `${wt.path}/.git`) return { repo, inner: '', gitFile: `gitdir: ${repo.root}/.git/worktrees/${wt.name}` };
    }
  }
  return null;
}

/** Loose ref files (refs/...) and their content. A ref stays packed until it changes. */
export function looseRefs(repo: Repo): Record<string, string> {
  const packed = repo.packedRefs ?? {};
  const out: Record<string, string> = {};
  for (const r of allRefs(repo)) {
    if (r.name === 'refs/stash' || r.name.endsWith('/HEAD')) continue;
    if (packed[r.name] === r.id) continue;
    out[r.name] = `${r.id}\n`;
  }
  for (const [remote, b] of Object.entries(repo.remoteHeads)) {
    if (repo.remoteRefs[`${remote}/${b}`]) out[`refs/remotes/${remote}/HEAD`] = `ref: refs/remotes/${remote}/${b}\n`;
  }
  if (repo.stash[0]) out['refs/stash'] = `${repo.stash[0].id}\n`;
  return out;
}

/** The text of .git/packed-refs, or null when there is none. */
export function packedRefsText(repo: Repo): string | null {
  const packed = repo.packedRefs;
  if (!packed || Object.keys(packed).length === 0) return null;
  const current = new Map(allRefs(repo).map((r) => [r.name, r]));
  const lines = ['# pack-refs with: peeled fully-peeled sorted '];
  for (const name of Object.keys(packed).sort()) {
    // Deleting a ref removes it from packed-refs too.
    const now = current.get(name);
    if (!now) continue;
    lines.push(`${packed[name]} ${name}`);
    if (now.peeled && packed[name] === now.id) lines.push(`^${now.peeled}`);
  }
  return `${lines.join('\n')}\n`;
}

/** Every file of the .git view (path inside .git → content). */
export function dotGitFiles(state: SimState, repo: Repo): Record<string, string> {
  const main = mainRepo(state, repo);
  const files: Record<string, string> = {};
  files.HEAD = main.head.type === 'branch' ? `ref: refs/heads/${main.head.name}\n` : `${main.head.commit}\n`;
  files.description = "Unnamed repository; edit this file 'description' to name the repository.\n";
  for (const [name, content] of Object.entries(looseRefs(main))) files[name] = content;
  const packed = packedRefsText(main);
  if (packed) files['packed-refs'] = packed;
  if (main.origHead) files.ORIG_HEAD = `${main.origHead}\n`;
  if (main.op?.kind === 'merge') files.MERGE_HEAD = `${main.op.theirs}\n`;
  if (main.op?.kind === 'cherry-pick') files.CHERRY_PICK_HEAD = `${main.op.commit}\n`;
  if (main.bisect) files.BISECT_LOG = main.bisect.log.map((l) => `${l}\n`).join('');
  for (const wt of Object.values(main.worktrees ?? {})) {
    files[`worktrees/${wt.name}/HEAD`] = wt.head.type === 'branch' ? `ref: refs/heads/${wt.head.name}\n` : `${wt.head.commit}\n`;
    files[`worktrees/${wt.name}/gitdir`] = `${wt.path}/.git\n`;
  }
  return files;
}

/** Folders of the .git view that `ls` may list (refs and below). */
export function dotGitDirs(files: Record<string, string>): Set<string> {
  const dirs = new Set<string>(['refs', 'refs/heads', 'refs/tags']);
  for (const f of Object.keys(files)) {
    const parts = f.split('/');
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
  }
  return dirs;
}
