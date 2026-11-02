// Git's object database, seen from engine state: every commit, tree, blob and
// annotated tag a repo holds, with real SHA-1 ids. Used by cat-file, ls-tree,
// rev-parse, show-ref and the Object X-ray interactive.
import { blobId, buildTrees, byteLength, tagText, type TreeEntry, type TreeObject } from './hash';
import { mergeBases } from './refs';
import { resolveRev, type RevResult } from './revision';
import { commitObjectText } from './state';
import type { Commit, FileMap, Repo, TagInfo } from './types';

export type GitObject =
  | { type: 'commit'; id: string; commit: Commit }
  | { type: 'tree'; id: string; entries: TreeEntry[] }
  | { type: 'blob'; id: string; content: string }
  | { type: 'tag'; id: string; name: string; info: TagInfo; target: string };

const treesCache = new Map<string, Map<string, TreeObject>>();

/** Every tree object of a snapshot, keyed by folder ('' = root). Cached by content. */
export function snapshotTrees(snapshot: FileMap): Map<string, TreeObject> {
  const key = JSON.stringify(Object.entries(snapshot).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  const hit = treesCache.get(key);
  if (hit) return hit;
  const trees = buildTrees(snapshot);
  if (treesCache.size > 300) treesCache.clear();
  treesCache.set(key, trees);
  return trees;
}

/** Root tree id of a commit. */
export function commitTree(c: Commit): string {
  return snapshotTrees(c.snapshot).get('')!.id;
}

/** Every object the repo has, by id. */
export function objectStore(repo: Repo): Map<string, GitObject> {
  const out = new Map<string, GitObject>();
  const addSnapshot = (snap: FileMap) => {
    for (const t of snapshotTrees(snap).values()) if (!out.has(t.id)) out.set(t.id, { type: 'tree', id: t.id, entries: t.entries });
    for (const content of Object.values(snap)) {
      const id = blobId(content);
      if (!out.has(id)) out.set(id, { type: 'blob', id, content });
    }
  };
  for (const c of Object.values(repo.commits)) {
    out.set(c.id, { type: 'commit', id: c.id, commit: c });
    addSnapshot(c.snapshot);
  }
  // `git add` writes blobs too, and conflict stages are blobs.
  for (const content of Object.values(repo.index)) {
    const id = blobId(content);
    if (!out.has(id)) out.set(id, { type: 'blob', id, content });
  }
  for (const entry of Object.values(repo.conflicts)) {
    for (const content of [entry.base, entry.ours, entry.theirs]) {
      if (content === null) continue;
      const id = blobId(content);
      if (!out.has(id)) out.set(id, { type: 'blob', id, content });
    }
  }
  for (const [id, content] of Object.entries(repo.blobs ?? {})) if (!out.has(id)) out.set(id, { type: 'blob', id, content });
  for (const [name, info] of Object.entries(repo.tagInfo)) {
    const target = repo.tags[name];
    if (target) out.set(info.id, { type: 'tag', id: info.id, name, info, target });
  }
  return out;
}

/** Body size in bytes, like `git cat-file -s`. A tree body is binary: "<mode> <name>\0" + 20 bytes per entry. */
export function objectSize(obj: GitObject, tz: number): number {
  if (obj.type === 'tree') return obj.entries.reduce((n, e) => n + byteLength(`${e.mode === '040000' ? '40000' : e.mode} ${e.name}`) + 1 + 20, 0);
  return byteLength(objectText(obj, tz));
}

/**
 * What `git cat-file -p` prints for an object. Trees print in `ls-tree` form;
 * blobs, commits and tags print their stored text.
 */
export function objectText(obj: GitObject, tz: number): string {
  if (obj.type === 'blob') return obj.content;
  if (obj.type === 'commit') return commitObjectText(obj.commit, tz);
  if (obj.type === 'tag') return tagText({ object: obj.target, name: obj.name, tagger: obj.info.tagger, time: obj.info.timestamp, tz, message: obj.info.message });
  return treeLines(obj.entries).map((l) => `${l}\n`).join('');
}

/** "100644 blob <id>\tname" lines (cat-file -p of a tree, ls-tree). */
export function treeLines(entries: TreeEntry[], prefix = ''): string[] {
  return entries.map((e) => `${e.mode} ${e.type} ${e.id}\t${prefix}${e.name}`);
}

export type ObjectResult =
  | { ok: true; obj: GitObject }
  | { ok: false; reason: 'unknown' | 'ambiguous' | 'noPath' | 'notTree'; path?: string; rev?: string };

/** The object at `path` inside a tree. '' is the tree itself. */
function walkTree(store: Map<string, GitObject>, tree: GitObject, path: string): GitObject | null {
  let cur: GitObject | undefined = tree;
  for (const part of path.split('/').filter(Boolean)) {
    if (!cur || cur.type !== 'tree') return null;
    const e: TreeEntry | undefined = cur.entries.find((x) => x.name === part);
    if (!e) return null;
    cur = store.get(e.id);
  }
  return cur ?? null;
}

function peel(store: Map<string, GitObject>, obj: GitObject, to: 'commit' | 'tree' | 'blob' | 'tag' | ''): GitObject | null {
  let cur: GitObject | null = obj;
  while (cur && cur.type === 'tag' && to !== 'tag') cur = store.get(cur.target) ?? null;
  if (!cur) return null;
  if (to === '' || to === cur.type) return cur;
  if (to === 'tree' && cur.type === 'commit') return store.get(commitTree(cur.commit)) ?? null;
  return null;
}

/**
 * Resolve an object name like real Git: revisions (HEAD~2, main, v1.0), full or short
 * ids of any object, `<rev>:<path>`, `:<path>` (the index), and peels like
 * `HEAD^{tree}`, `v1.0^{}`, `v1.0^{commit}`. A bare annotated tag name gives the tag object.
 */
export function resolveObject(repo: Repo, spec: string, store = objectStore(repo)): ObjectResult {
  // <rev>:<path>
  const colon = spec.indexOf(':');
  if (colon !== -1 && !/^[^:]*@\{/.test(spec.slice(0, colon + 2))) {
    const revPart = spec.slice(0, colon);
    const path = spec.slice(colon + 1).replace(/^\.\//, '').replace(/\/+$/, '');
    if (revPart === '') {
      const content = repo.index[path];
      if (content === undefined) return { ok: false, reason: 'noPath', path, rev: '' };
      const id = blobId(content);
      return { ok: true, obj: store.get(id) ?? { type: 'blob', id, content } };
    }
    const base = resolveObject(repo, revPart, store);
    if (!base.ok) return base;
    const tree = peel(store, base.obj, 'tree');
    if (!tree) return { ok: false, reason: 'notTree', rev: revPart };
    const found = walkTree(store, tree, path);
    return found ? { ok: true, obj: found } : { ok: false, reason: 'noPath', path, rev: revPart };
  }
  // <x>^{type}
  const peelMatch = /^(.*)\^\{(commit|tree|blob|tag|)\}$/.exec(spec);
  if (peelMatch) {
    const base = resolveObject(repo, peelMatch[1]!, store);
    if (!base.ok) return base;
    const obj = peel(store, base.obj, peelMatch[2] as 'commit' | 'tree' | 'blob' | 'tag' | '');
    return obj ? { ok: true, obj } : { ok: false, reason: 'unknown' };
  }
  // A bare annotated tag name is the tag object itself.
  const tagName = spec.replace(/^(refs\/)?tags\//, '');
  if (repo.tagInfo[tagName] && repo.branches[spec] === undefined) {
    const obj = store.get(repo.tagInfo[tagName]!.id);
    if (obj) return { ok: true, obj };
  }
  const rev: RevResult = resolveRev(repo, spec);
  if (rev.ok) {
    const obj = store.get(rev.id);
    if (obj) return { ok: true, obj };
  }
  if (/^[0-9a-f]{4,40}$/.test(spec)) {
    const hits = [...store.keys()].filter((id) => id.startsWith(spec));
    if (hits.length === 1) return { ok: true, obj: store.get(hits[0]!)! };
    if (hits.length > 1) return { ok: false, reason: 'ambiguous' };
  }
  return { ok: false, reason: rev.ok ? 'unknown' : rev.reason === 'ambiguous' ? 'ambiguous' : 'unknown' };
}

/** Every ref with the id it stores (annotated tags give the tag object), sorted by name. */
export function allRefs(repo: Repo): { name: string; id: string; peeled?: string }[] {
  const out: { name: string; id: string; peeled?: string }[] = [];
  for (const [b, id] of Object.entries(repo.branches)) out.push({ name: `refs/heads/${b}`, id });
  for (const [r, id] of Object.entries(repo.remoteRefs)) out.push({ name: `refs/remotes/${r}`, id });
  for (const [remote, b] of Object.entries(repo.remoteHeads)) {
    const id = repo.remoteRefs[`${remote}/${b}`];
    if (id) out.push({ name: `refs/remotes/${remote}/HEAD`, id });
  }
  if (repo.stash[0]) out.push({ name: 'refs/stash', id: repo.stash[0].id });
  for (const [t, id] of Object.entries(repo.tags)) {
    const info = repo.tagInfo[t];
    out.push(info ? { name: `refs/tags/${t}`, id: info.id, peeled: id } : { name: `refs/tags/${t}`, id });
  }
  for (const r of bisectRefs(repo)) out.push(r);
  return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** refs/bisect/bad, refs/bisect/good-<id>, refs/bisect/skip-<id> while bisecting. */
export function bisectRefs(repo: Repo): { name: string; id: string }[] {
  const b = repo.bisect;
  if (!b) return [];
  const out: { name: string; id: string }[] = [];
  if (b.bad) out.push({ name: 'refs/bisect/bad', id: b.bad });
  for (const g of b.good) out.push({ name: `refs/bisect/good-${g}`, id: g });
  for (const s of b.skip) out.push({ name: `refs/bisect/skip-${s}`, id: s });
  return out;
}

/** Ids for a range like `A..B` (B, ^A) or `A...B` (B, A, ^bases), as `git rev-parse` prints them. */
export function rangeIds(repo: Repo, left: string, right: string, symmetric: boolean): string[] {
  if (!symmetric) return [right, `^${left}`];
  return [right, left, ...mergeBases(repo.commits, left, right).map((b) => `^${b}`)];
}
