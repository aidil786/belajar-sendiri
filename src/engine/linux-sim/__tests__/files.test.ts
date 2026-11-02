import { describe, expect, it } from 'vitest';
import { columns, human, lsDate } from '../programs/files';
import { session } from './helpers';

describe('ls', () => {
  it('lists the home folder like GNU ls 9.7', () => {
    const s = session();
    expect(s.out('ls -la')).toBe(
      [
        'total 20',
        'drwx------ 2 you  you  4096 Nov  1 08:50 .',
        'drwxr-xr-x 3 root root 4096 Oct 28 07:41 ..',
        '-rw-r--r-- 1 you  you   220 Jul 12  2025 .bash_logout',
        '-rw-r--r-- 1 you  you  3526 Jul 12  2025 .bashrc',
        '-rw-r--r-- 1 you  you   807 Jul 12  2025 .profile',
      ].join('\n'),
    );
  });

  it('columns in a terminal, bad options, missing names', () => {
    const s = session();
    s.sh('mkdir kedai notes; touch menu.txt');
    expect(s.out('ls')).toBe('kedai  menu.txt  notes');
    expect(s.out('ls -z')).toBe("ls: invalid option -- 'z'\nTry 'ls --help' for more information.");
    expect(s.sh('ls -z').exitCode).toBe(2);
    expect(s.out('ls nope')).toBe("ls: cannot access 'nope': No such file or directory");
    expect(s.out('ls /root')).toBe("ls: cannot open directory '/root': Permission denied");
  });

  it('-R walks folders; -h shows sizes like 4.0K', () => {
    const s = session();
    s.sh('mkdir -p a/b');
    s.sh('touch a/b/c.txt');
    expect(s.out('ls -R a')).toBe('a:\nb\n\na/b:\nc.txt');
    expect(s.out('ls -lh a')).toMatch(/^total 4.0K\ndrwxrwxr-x 2 you you 4\.0K Nov {2}1 09:00 b$/);
  });

  it('helpers: human sizes, dates, columns', () => {
    expect(human(4096)).toBe('4.0K');
    expect(human(3526)).toBe('3.5K');
    expect(human(15000)).toBe('15K');
    expect(human(17_200_000_000)).toBe('17G');
    expect(lsDate(1793523600, 1793523600 - 3600)).toBe('Nov  1 08:00');
    expect(lsDate(1793523600, 1752339480)).toBe('Jul 12  2025');
    expect(columns(['a', 'bb', 'ccc'])).toEqual(['a  bb  ccc']);
  });
});

describe('reading files', () => {
  it('cat, head, tail, wc, less', () => {
    const s = session();
    s.sh("printf 'one\\ntwo\\nthree\\nfour\\n' > n.txt");
    expect(s.out('cat n.txt')).toBe('one\ntwo\nthree\nfour');
    expect(s.out('head -n 2 n.txt')).toBe('one\ntwo');
    expect(s.out('tail -n 1 n.txt')).toBe('four');
    expect(s.out('tail -n +3 n.txt')).toBe('three\nfour');
    expect(s.out('wc -l n.txt')).toBe('4 n.txt');
    expect(s.out('wc n.txt')).toBe(' 4  4 19 n.txt');
    expect(s.out('cat n.txt | wc -l')).toBe('4');
    expect(s.out('less n.txt')).toBe('one\ntwo\nthree\nfour');
    expect(s.out('cat -n n.txt')).toBe('     1\tone\n     2\ttwo\n     3\tthree\n     4\tfour');
  });

  it('errors use coreutils words', () => {
    const s = session();
    s.sh('mkdir d');
    expect(s.out('cat nope')).toBe('cat: nope: No such file or directory');
    expect(s.out('cat d')).toBe('cat: d: Is a directory');
    expect(s.out('cat /etc/shadow')).toBe('cat: /etc/shadow: Permission denied');
    expect(s.out('head nope')).toBe("head: cannot open 'nope' for reading: No such file or directory");
  });
});

describe('making, copying, moving, deleting', () => {
  it('mkdir, mkdir -p, touch, cp, cp -r, mv, rm, rm -r, rmdir', () => {
    const s = session();
    expect(s.out('mkdir a/b')).toBe('mkdir: cannot create directory ‘a/b’: No such file or directory');
    s.sh('mkdir -p a/b');
    expect(s.out('mkdir a')).toBe('mkdir: cannot create directory ‘a’: File exists');
    s.sh('touch a/x.txt');
    expect(s.out('cp a b2')).toBe("cp: -r not specified; omitting directory 'a'");
    s.sh('cp -r a a2');
    expect(s.out('ls a2')).toBe('b  x.txt');
    s.sh('mv a2/x.txt a2/y.txt');
    expect(s.out('ls a2')).toBe('b  y.txt');
    expect(s.out('rm a2')).toBe("rm: cannot remove 'a2': Is a directory");
    expect(s.out('rmdir a2')).toBe("rmdir: failed to remove 'a2': Directory not empty");
    const r = s.sh('rm -r a2');
    expect(r.danger).toBe(true);
    expect(s.out('ls')).toBe('a');
    expect(s.out('rm -r /')).toBe("rm: it is dangerous to operate recursively on '/'\nrm: use --no-preserve-root to override this failsafe");
    expect(s.out('touch /etc/x')).toBe("touch: cannot touch '/etc/x': Permission denied");
    expect(s.out('mv nope x')).toBe("mv: cannot stat 'nope': No such file or directory");
  });

  it('ln -s makes a link that ls -l shows', () => {
    const s = session();
    s.sh('touch real.txt');
    s.sh('ln -s real.txt link.txt');
    expect(s.out('ls -l link.txt')).toMatch(/^lrwxrwxrwx 1 you you 8 Nov {2}1 09:00 link\.txt -> real\.txt$/);
  });
});

describe('finding and searching', () => {
  it('find -name, -type, -size; permission errors use locale quotes', () => {
    const s = session();
    s.sh('mkdir -p k/r');
    s.sh('touch k/a.txt k/r/b.txt k/c.log');
    expect(s.out('find k -name "*.txt"')).toBe('k/a.txt\nk/r/b.txt');
    expect(s.out('find k -type d')).toBe('k\nk/r');
    expect(s.out('find k -size +0')).toBe('');
    expect(s.out('find /root -name x')).toBe('find: ‘/root’: Permission denied');
  });

  it('grep -i -n -v -c -r, exit codes', () => {
    const s = session();
    s.sh("printf 'GET / 200\\nGET /x 404\\nPOST /y 200\\n' > log");
    expect(s.out('grep 404 log')).toBe('GET /x 404');
    expect(s.out('grep -c 200 log')).toBe('2');
    expect(s.out('grep -n POST log')).toBe('3:POST /y 200');
    expect(s.out('grep -v 200 log')).toBe('GET /x 404');
    expect(s.out('grep -i post log')).toBe('POST /y 200');
    const none = s.sh('grep nope log');
    expect(none.exitCode).toBe(1);
    expect(none.stopped).toBe(true);
    expect(s.out('grep x nope')).toBe('grep: nope: No such file or directory');
    s.sh('mkdir d; cp log d/');
    expect(s.out('grep -r 404 d')).toBe('d/log:GET /x 404');
  });

  it('pipes: cut, sort, uniq -c, sort -rn, tr, sed, awk', () => {
    const s = session();
    s.sh("printf 'a 1\\nb 2\\na 3\\n' > t");
    expect(s.out('cut -d" " -f1 t | sort | uniq -c | sort -rn')).toBe('      2 a\n      1 b');
    expect(s.out("echo hello | tr a-z A-Z")).toBe('HELLO');
    expect(s.out("sed 's/a/A/' t")).toBe('A 1\nb 2\nA 3');
    expect(s.out("awk '{print $2}' t")).toBe('1\n2\n3');
    expect(s.out('sort -n -k2 t | head -n 1')).toBe('a 1');
    expect(s.out('cat t | tee copy.txt | wc -l')).toBe('3');
    expect(s.out('cat copy.txt | wc -l')).toBe('3');
  });
});
