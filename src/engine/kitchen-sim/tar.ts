// `tar` inside containers, for backing up and restoring a volume (World D3):
//   docker run --rm -v data:/from -v "$PWD":/to alpine:3.22 tar czf /to/backup.tar.gz -C /from .
//   docker run --rm -v data:/to -v "$PWD":/from alpine:3.22 tar xzf /from/backup.tar.gz -C /to
// Modes c (create), x (extract), t (list); flags z, v, f <file>, -C <dir>. Messages are BusyBox's
// on Alpine images and GNU tar's on Debian images (both checked on Docker 29: alpine:3.22,
// python:3.13-slim). The simulator has no bytes, so an archive is a text file that lists its
// members; real gzip bytes would look just as unreadable to `cat`.
import { normalize } from '../git-sim/paths';
import { imageOf, isDirC, listC, mkdirC, readC, writeC } from './cfs';
import type { ShellCtx, ShellOut } from './cshell';

const MAGIC = '\u0000fahamlah-tar-v1\n';

interface Member {
  /** As tar prints it: "./", "./orders.txt", "data/menu/". Folders end with "/". */
  name: string;
  content?: string;
}

interface TarArgs {
  mode: 'c' | 'x' | 't' | null;
  gzip: boolean;
  verbose: boolean;
  file: string | null;
  dir: string | null;
  members: string[];
}

function parseArgs(args: string[]): TarArgs {
  const r: TarArgs = { mode: null, gzip: false, verbose: false, file: null, dir: null, members: [] };
  const wantValue: ('f' | 'C')[] = [];
  const letters = (s: string) => {
    for (const ch of s) {
      if (ch === 'c' || ch === 'x' || ch === 't') r.mode = ch;
      else if (ch === 'z') r.gzip = true;
      else if (ch === 'v') r.verbose = true;
      else if (ch === 'f' || ch === 'C') wantValue.push(ch);
    }
  };
  args.forEach((a, i) => {
    if (i === 0 && !a.startsWith('-')) letters(a);
    else if (a.startsWith('--directory=')) r.dir = a.slice(12);
    else if (a.startsWith('--file=')) r.file = a.slice(7);
    else if (a.startsWith('-') && a.length > 1 && !a.startsWith('--')) letters(a.slice(1));
    else if (wantValue.length) {
      const which = wantValue.shift();
      if (which === 'f') r.file = a;
      else r.dir = a;
    } else r.members.push(a);
  });
  return r;
}

/** BusyBox prints its usage when no mode letter is given (the first lines, as in alpine:3.22). */
const BUSYBOX_USAGE = [
  'BusyBox v1.37.0 (2025-11-21 22:40:56 UTC) multi-call binary.',
  '',
  'Usage: tar c|x|t [-ZzJjahmvokO] [-f TARFILE] [-C DIR] [-T FILE] [-X FILE] [LONGOPT]... [FILE]...',
  '',
  'Create, extract, or list files from a tar file',
  '',
  '\tc\tCreate',
  '\tx\tExtract',
  '\tt\tList',
  "\t-f FILE\tName of TARFILE ('-' for stdin/out)",
  '\t-C DIR\tChange to DIR before operation',
  '\t-v\tVerbose',
  '\t-z\t(De)compress using gzip',
];

/** What each tar says, and the exit code it uses for errors. */
const BUSYBOX = {
  code: 1,
  noMode: BUSYBOX_USAGE,
  empty: ['tar: empty archive'],
  leading: "tar: removing leading '/' from member names",
  cantOpen: (f: string, why: string) => [`tar: can't open '${f}': ${why}`],
  cantCd: (d: string) => [`tar: can't change directory to '${d}': No such file or directory`],
  missing: (m: string) => [`tar: ${m}: No such file or directory`],
  delayed: 'tar: error exit delayed from previous errors',
  notArchive: (gzip: boolean) => (gzip ? ['tar: invalid magic', 'tar: short read'] : ['tar: invalid tar magic']),
  noFile: (gzip: boolean) => (gzip ? ['tar: invalid magic', 'tar: short read'] : ['tar: short read']),
};

const GNU: typeof BUSYBOX = {
  code: 2,
  noMode: ["tar: You must specify one of the '-Acdtrux', '--delete' or '--test-label' options", "Try 'tar --help' or 'tar --usage' for more information."],
  empty: ['tar: Cowardly refusing to create an empty archive', "Try 'tar --help' or 'tar --usage' for more information."],
  leading: "tar: Removing leading `/' from member names",
  cantOpen: (f: string, why: string) => [`tar: ${f}: Cannot open: ${why}`, 'tar: Error is not recoverable: exiting now'],
  cantCd: (d: string) => [`tar: ${d}: Cannot open: No such file or directory`, 'tar: Error is not recoverable: exiting now'],
  missing: (m: string) => [`tar: ${m}: Cannot stat: No such file or directory`],
  delayed: 'tar: Exiting with failure status due to previous errors',
  notArchive: (gzip: boolean) => (gzip ? ['', 'gzip: stdin: not in gzip format', 'tar: Child returned status 1', 'tar: Error is not recoverable: exiting now'] : ['tar: This does not look like a tar archive', 'tar: Exiting with failure status due to previous errors']),
  noFile: (gzip: boolean) => (gzip ? ['', 'gzip: stdin: unexpected end of file', 'tar: Child returned status 1', 'tar: Error is not recoverable: exiting now'] : ['tar: This does not look like a tar archive', 'tar: Exiting with failure status due to previous errors']),
};

function abs(ctx: ShellCtx, p: string): string {
  return p.startsWith('/') ? normalize(p) || '/' : normalize(`${ctx.cwd}/${p}`) || '/';
}

function join(dir: string, rel: string): string {
  return normalize(`${dir}/${rel}`) || '/';
}

/** Collect a member and everything under it (a folder, then its contents, sorted). */
function collect(ctx: ShellCtx, path: string, name: string, out: Member[]): void {
  const { state, c } = ctx;
  if (isDirC(state, c, path)) {
    const prefix = name.endsWith('/') ? name : `${name}/`;
    out.push({ name: prefix });
    for (const e of listC(state, c, path) ?? []) collect(ctx, join(path, e.name), `${prefix}${e.name}`, out);
    return;
  }
  const v = readC(state, c, path);
  if (typeof v === 'string') out.push({ name, content: v });
}

function readArchive(text: string): Member[] | null {
  if (!text.startsWith(MAGIC)) return null;
  try {
    return JSON.parse(text.slice(MAGIC.length)) as Member[];
  } catch {
    return null;
  }
}

export function tarIn(ctx: ShellCtx, args: string[]): ShellOut {
  const { state, c } = ctx;
  const img = imageOf(state, c);
  const debian = img?.kind === 'python' || img?.kind === 'debian' || Boolean(img?.files['/etc/os-release']?.includes('ID=debian'));
  const say = debian ? GNU : BUSYBOX;
  const a = parseArgs(args);
  const bad = (err: string[]): ShellOut => ({ out: [], err, code: say.code });
  if (!a.mode) return bad(say.noMode);
  const base = a.dir ? abs(ctx, a.dir) : ctx.cwd;

  if (a.mode === 'c') {
    if (!a.members.length) return bad(say.empty);
    // tar opens (and empties) the archive first, then changes folder.
    const archive = a.file ? abs(ctx, a.file) : null;
    if (archive) {
      const err = writeC(state, c, archive, '', ctx.uid);
      if (err) return bad(say.cantOpen(a.file!, err));
    }
    if (!isDirC(state, c, base)) return bad(say.cantCd(a.dir ?? base));
    const members: Member[] = [];
    const err: string[] = [];
    let missing = false;
    for (const m of a.members) {
      const name = m.startsWith('/') ? m.replace(/^\/+/, '') || '.' : m;
      if (m.startsWith('/') && !err.includes(say.leading)) err.push(say.leading);
      const path = m.startsWith('/') ? normalize(m) || '/' : join(base, m);
      if (readC(state, c, path) === null) {
        err.push(...say.missing(m));
        missing = true;
        continue;
      }
      collect(ctx, path, name === '.' ? './' : name, members);
    }
    if (missing) err.push(say.delayed);
    if (archive) writeC(state, c, archive, MAGIC + JSON.stringify(members), ctx.uid);
    return { out: a.verbose ? members.map((m) => m.name) : [], err, code: missing ? say.code : 0 };
  }

  // x and t read an archive. Without f they read an empty stdin.
  if (!a.file) return bad(say.noFile(a.gzip));
  const text = readC(state, c, abs(ctx, a.file));
  if (text === null) return bad(say.cantOpen(a.file, 'No such file or directory'));
  const members = typeof text === 'string' ? readArchive(text) : null;
  if (!members) return bad(say.notArchive(a.gzip));
  if (a.mode === 't') return { out: members.map((m) => m.name), err: [], code: 0 };

  if (!isDirC(state, c, base)) return bad(say.cantCd(a.dir ?? base));
  const out: string[] = [];
  for (const m of members) {
    const path = join(base, m.name);
    if (a.verbose) out.push(m.name);
    if (m.content === undefined) {
      if (isDirC(state, c, path)) continue;
      const err = mkdirC(state, c, path, ctx.uid, true);
      if (err) return { out, err: [`tar: ${m.name.replace(/\/$/, '')}: ${err}`], code: say.code };
      continue;
    }
    const err = writeC(state, c, path, m.content, ctx.uid);
    if (err === 'Read-only file system' && !debian) return { out, err: [`tar: can't remove old file ${m.name}: Read-only file system`], code: 1 };
    if (err) return { out, err: [`tar: ${m.name}: ${err}`], code: say.code };
  }
  return { out, err: [], code: 0 };
}
