// Object X-ray: look inside Git's object database, one object at a time.
// Pure helpers (no React): the component and the tests use them.
import {
  findRepo,
  headId,
  history,
  objectSize,
  objectStore,
  resolveObject,
  subject,
  type GitObject,
  type SimState,
} from '~/engine/git-sim';

/** A line of `git cat-file -p` output; ids in it can be opened. */
export interface XrayLine {
  /** Text before the id (e.g. "tree ", "100644 blob "), or the whole line. */
  text: string;
  /** An object id the learner can open, with what it is. */
  ref?: { id: string; type: GitObject['type']; name?: string };
  /** Text after the id (e.g. "\tindex.html"). */
  after?: string;
}

export interface XrayView {
  id: string;
  short: string;
  type: GitObject['type'];
  size: number;
  lines: XrayLine[];
}

export type XrayTask =
  | { type: 'findBlob'; path: string; from?: string }
  | { type: 'findTree'; path?: string; from?: string }
  | { type: 'findParent'; of?: string };

export interface XrayStep {
  id: string;
  type: GitObject['type'];
  /** How we got here: "tree", "parent", a file or folder name. */
  via: string;
}

/** Commits on HEAD's first-parent line, newest first. */
export function xrayCommits(state: SimState): { id: string; short: string; message: string; head: boolean }[] {
  const repo = findRepo(state);
  if (!repo) return [];
  const head = headId(repo);
  return history(repo, head).map((c) => ({ id: c.id, short: c.id.slice(0, 7), message: subject(c.message), head: c.id === head }));
}

/** The cat-file -p view of one object, with openable ids. */
export function xrayView(state: SimState, id: string): XrayView | null {
  const repo = findRepo(state);
  if (!repo) return null;
  const store = objectStore(repo);
  const obj = store.get(id);
  if (!obj) return null;
  const typeOf = (x: string): GitObject['type'] => store.get(x)?.type ?? 'commit';
  const tz = state.tz;
  const off = `${tz >= 0 ? '+' : '-'}${String(Math.floor(Math.abs(tz) / 60)).padStart(2, '0')}${String(Math.abs(tz) % 60).padStart(2, '0')}`;
  const lines: XrayLine[] = [];
  if (obj.type === 'commit') {
    const c = obj.commit;
    const tree = resolveObject(repo, `${c.id}^{tree}`, store);
    if (tree.ok) lines.push({ text: 'tree ', ref: { id: tree.obj.id, type: 'tree' } });
    for (const p of c.parents) lines.push({ text: 'parent ', ref: { id: p, type: typeOf(p) } });
    const who = c.committer ?? c.author;
    lines.push({ text: `author ${c.author.name} <${c.author.email}> ${c.timestamp} ${off}` });
    lines.push({ text: `committer ${who.name} <${who.email}> ${c.committed ?? c.timestamp} ${off}` });
    lines.push({ text: '' });
    for (const l of c.message.replace(/\n+$/, '').split('\n')) lines.push({ text: l });
  } else if (obj.type === 'tree') {
    for (const e of obj.entries) lines.push({ text: `${e.mode} ${e.type} `, ref: { id: e.id, type: e.type, name: e.name }, after: `\t${e.name}` });
  } else if (obj.type === 'blob') {
    const body = obj.content.endsWith('\n') ? obj.content.slice(0, -1) : obj.content;
    for (const l of body === '' ? [] : body.split('\n')) lines.push({ text: l });
  } else {
    lines.push({ text: 'object ', ref: { id: obj.target, type: 'commit' } });
    lines.push({ text: 'type commit' }, { text: `tag ${obj.name}` });
    lines.push({ text: `tagger ${obj.info.tagger.name} <${obj.info.tagger.email}> ${obj.info.timestamp} ${off}` }, { text: '' });
    for (const l of obj.info.message.replace(/\n+$/, '').split('\n')) lines.push({ text: l });
  }
  return { id: obj.id, short: obj.id.slice(0, 7), type: obj.type, size: objectSize(obj, state.tz), lines };
}

/** The object a task wants the learner to open, or null if the task doesn't fit the scenario. */
export function xrayTarget(state: SimState, task: XrayTask): string | null {
  const repo = findRepo(state);
  if (!repo) return null;
  let spec: string;
  if (task.type === 'findBlob') spec = `${task.from ?? 'HEAD'}:${task.path}`;
  else if (task.type === 'findTree') spec = task.path ? `${task.from ?? 'HEAD'}:${task.path}` : `${task.from ?? 'HEAD'}^{tree}`;
  else spec = `${task.of ?? 'HEAD'}~1`;
  const res = resolveObject(repo, spec);
  if (!res.ok) return null;
  const want = task.type === 'findBlob' ? 'blob' : task.type === 'findTree' ? 'tree' : 'commit';
  return res.obj.type === want ? res.obj.id : null;
}

export type { GitObject };

/** Where the learner should start for a task: the commit named by from / of (default HEAD). */
export function xrayStart(state: SimState, task?: XrayTask): string | null {
  const repo = findRepo(state);
  if (!repo) return null;
  const spec = !task ? 'HEAD' : task.type === 'findParent' ? (task.of ?? 'HEAD') : (task.from ?? 'HEAD');
  const res = resolveObject(repo, `${spec}^{commit}`);
  return res.ok ? res.obj.id : null;
}

/**
 * The ids to open, in order, from the start commit to the target (commit → tree → ... → blob).
 * Used for hints: the first one not opened yet is the next step.
 */
export function xrayRoute(state: SimState, task: XrayTask): { id: string; name: string }[] {
  const repo = findRepo(state);
  const start = xrayStart(state, task);
  if (!repo || !start) return [];
  if (task.type === 'findParent') {
    const parent = xrayTarget(state, task);
    return parent ? [{ id: start, name: start.slice(0, 7) }, { id: parent, name: 'parent' }] : [];
  }
  const route = [{ id: start, name: start.slice(0, 7) }];
  const root = resolveObject(repo, `${start}^{tree}`);
  if (!root.ok) return route;
  route.push({ id: root.obj.id, name: 'tree' });
  const parts = (task.path ?? '').split('/').filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    const res = resolveObject(repo, `${start}:${parts.slice(0, i + 1).join('/')}`);
    if (!res.ok) break;
    route.push({ id: res.obj.id, name: parts[i]! });
  }
  return route;
}

/** Is this opened object a "wrong turn" for the task (a blob or commit that isn't the target)? */
export function xrayWrongTurn(task: XrayTask, opened: { id: string; type: GitObject['type'] }, target: string | null): boolean {
  if (opened.id === target) return false;
  if (task.type === 'findBlob') return opened.type === 'blob';
  if (task.type === 'findTree') return opened.type === 'blob';
  return opened.type === 'commit';
}
