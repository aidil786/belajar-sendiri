// Hashes. Every object id is a real SHA-1, computed the way Git does it:
// sha1("<type> <size>\0<body>"). Blobs hash file content, trees hash their entries,
// commits and annotated tags hash their text. The fake clock and fixed identity
// make ids deterministic, so every lesson replays the same way.
// `fakeHash` stays for things that are not Git objects.

function mix32(str: string, seed: number): number {
  let h = seed ^ 0x9e3779b9;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 0x85ebca6b);
    h = (h << 13) | (h >>> 19);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

/** A deterministic 40-character hex id. */
export function fakeHash(seed: string, counter: number, content: string): string {
  const base = `${seed}\u0000${counter}\u0000${content}`;
  let out = '';
  for (let i = 0; i < 5; i++) {
    out += mix32(base, 0x1234567 * (i + 1) + counter).toString(16).padStart(8, '0');
  }
  return out;
}

export function shortHash(id: string): string {
  return id.slice(0, 7);
}

function utf8(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

/** Plain SHA-1 (hex). Small and synchronous so it works in the browser. */
export function sha1(bytes: Uint8Array): string {
  const ml = bytes.length;
  const withPadding = ((ml + 9 + 63) >> 6) << 6;
  const buf = new Uint8Array(withPadding);
  buf.set(bytes);
  buf[ml] = 0x80;
  const view = new DataView(buf.buffer);
  const bitLen = ml * 8;
  view.setUint32(withPadding - 8, Math.floor(bitLen / 0x100000000));
  view.setUint32(withPadding - 4, bitLen >>> 0);

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;
  const w = new Uint32Array(80);

  for (let off = 0; off < withPadding; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 80; i++) {
      const x = (w[i - 3] ?? 0) ^ (w[i - 8] ?? 0) ^ (w[i - 14] ?? 0) ^ (w[i - 16] ?? 0);
      w[i] = (x << 1) | (x >>> 31);
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    for (let i = 0; i < 80; i++) {
      let f: number;
      let k: number;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const temp = (((a << 5) | (a >>> 27)) + f + e + k + (w[i] ?? 0)) >>> 0;
      e = d;
      d = c;
      c = (b << 30) | (b >>> 2);
      b = a;
      a = temp;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }
  return [h0, h1, h2, h3, h4].map((n) => n.toString(16).padStart(8, '0')).join('');
}

export type ObjectType = 'blob' | 'tree' | 'commit' | 'tag';

/** sha1("<type> <size>\0<body>"): the id of any Git object. */
export function hashObject(type: ObjectType, body: Uint8Array): string {
  const header = utf8(`${type} ${body.length}\u0000`);
  const all = new Uint8Array(header.length + body.length);
  all.set(header);
  all.set(body, header.length);
  return sha1(all);
}

const blobCache = new Map<string, string>();

/** The id Git gives a file's content ("blob" object). */
export function blobId(content: string): string {
  const hit = blobCache.get(content);
  if (hit) return hit;
  const id = hashObject('blob', utf8(content));
  if (blobCache.size > 2000) blobCache.clear();
  blobCache.set(content, id);
  return id;
}

/** Size in bytes (UTF-8), like `git cat-file -s`. */
export function byteLength(text: string): number {
  return utf8(text).length;
}

// ---------------------------------------------------------------------------
// Trees

export interface TreeEntry {
  mode: '100644' | '040000';
  type: 'blob' | 'tree';
  name: string;
  id: string;
}

export interface TreeObject {
  id: string;
  entries: TreeEntry[];
}

/** Git sorts tree entries by name, comparing a folder as if its name ended in "/". */
function entryKey(e: TreeEntry): string {
  return e.type === 'tree' ? `${e.name}/` : e.name;
}

function byteCompare(a: string, b: string): number {
  const x = utf8(a);
  const y = utf8(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i]! - y[i]!;
  return x.length - y.length;
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** One tree object's id from its entries (Git's binary format: "<mode> <name>\0<20-byte id>"). */
function treeObjectId(entries: TreeEntry[]): string {
  const parts: Uint8Array[] = [];
  for (const e of entries) parts.push(utf8(`${e.mode === '040000' ? '40000' : e.mode} ${e.name}\u0000`), hexToBytes(e.id));
  const body = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) {
    body.set(p, off);
    off += p.length;
  }
  return hashObject('tree', body);
}

/**
 * Every tree object of a snapshot (repo-relative path → content), keyed by folder path
 * ('' is the root tree). Files are plain blobs (mode 100644): the practice terminal has
 * no executable files or symlinks.
 */
export function buildTrees(snapshot: Record<string, string>): Map<string, TreeObject> {
  const files = new Map<string, Map<string, string>>(); // folder → name → content
  const folders = new Map<string, Set<string>>(); // folder → child folder names
  const addFolder = (dir: string) => {
    if (!folders.has(dir)) folders.set(dir, new Set());
    if (!files.has(dir)) files.set(dir, new Map());
  };
  addFolder('');
  for (const [path, content] of Object.entries(snapshot)) {
    const parts = path.split('/');
    let dir = '';
    for (let i = 0; i < parts.length - 1; i++) {
      addFolder(dir);
      folders.get(dir)!.add(parts[i]!);
      dir = dir ? `${dir}/${parts[i]}` : parts[i]!;
    }
    addFolder(dir);
    files.get(dir)!.set(parts[parts.length - 1]!, content);
  }
  const out = new Map<string, TreeObject>();
  const build = (dir: string): string => {
    const entries: TreeEntry[] = [];
    for (const [name, content] of files.get(dir) ?? []) entries.push({ mode: '100644', type: 'blob', name, id: blobId(content) });
    for (const name of folders.get(dir) ?? []) entries.push({ mode: '040000', type: 'tree', name, id: build(dir ? `${dir}/${name}` : name) });
    entries.sort((a, b) => byteCompare(entryKey(a), entryKey(b)));
    const id = treeObjectId(entries);
    out.set(dir, { id, entries });
    return id;
  };
  build('');
  return out;
}

const treeCache = new Map<string, string>();

/** The root tree id of a snapshot. */
export function treeId(snapshot: Record<string, string>): string {
  const key = JSON.stringify(Object.entries(snapshot).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  const hit = treeCache.get(key);
  if (hit) return hit;
  const id = buildTrees(snapshot).get('')!.id;
  if (treeCache.size > 500) treeCache.clear();
  treeCache.set(key, id);
  return id;
}

// ---------------------------------------------------------------------------
// Commits and annotated tags

export interface Ident {
  name: string;
  email: string;
}

/** "+0800" from minutes east of UTC. */
export function tzOffset(tz: number): string {
  const sign = tz >= 0 ? '+' : '-';
  const off = Math.abs(tz);
  return `${sign}${String(Math.floor(off / 60)).padStart(2, '0')}${String(off % 60).padStart(2, '0')}`;
}

/** "Name <email> 1793322060 +0800", as in commit and tag objects. */
export function identLine(who: Ident, when: number, tz: number): string {
  return `${who.name} <${who.email}> ${when} ${tzOffset(tz)}`;
}

/** Git stores a message with exactly one newline at the end. */
export function storedMessage(message: string): string {
  const body = message.replace(/\n+$/, '');
  return body === '' ? '' : `${body}\n`;
}

export interface CommitFields {
  tree: string;
  parents: string[];
  author: Ident;
  authorTime: number;
  committer: Ident;
  commitTime: number;
  tz: number;
  message: string;
}

/** The text of a commit object (what `git cat-file -p <commit>` prints). */
export function commitText(c: CommitFields): string {
  return (
    `tree ${c.tree}\n` +
    c.parents.map((p) => `parent ${p}\n`).join('') +
    `author ${identLine(c.author, c.authorTime, c.tz)}\n` +
    `committer ${identLine(c.committer, c.commitTime, c.tz)}\n` +
    `\n${storedMessage(c.message)}`
  );
}

export interface TagFields {
  object: string;
  name: string;
  tagger: Ident;
  time: number;
  tz: number;
  message: string;
}

/** The text of an annotated tag object (it always points at a commit here). */
export function tagText(t: TagFields): string {
  return `object ${t.object}\ntype commit\ntag ${t.name}\ntagger ${identLine(t.tagger, t.time, t.tz)}\n\n${storedMessage(t.message)}`;
}

/** Id of an object given as text (a commit or a tag). */
export function textObjectId(type: ObjectType, text: string): string {
  return hashObject(type, utf8(text));
}
