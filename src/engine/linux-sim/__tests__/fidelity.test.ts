// Behaviours checked against a real Debian 13 machine (the linux-fid-* scenarios run them there too).
import { describe, expect, it } from 'vitest';
import { createMachine, plain, run } from '..';
import { session } from './helpers';

describe('questions at the terminal (rm -i, cp -i, mv -i)', () => {
  it('rm -i waits for the answer, then acts on it', () => {
    const s = session();
    s.sh('touch a b');
    const q = s.sh('rm -i a');
    expect(q.text).toBe('');
    expect(s.st.ask?.prompt).toBe("rm: remove regular empty file 'a'? ");
    expect(q.explain?.key).toBe('linux.explain.ask');
    expect(s.st.fs['/home/you/a']).toBeDefined();
    const yes = s.sh('y');
    expect(yes.exitCode).toBe(0);
    expect(s.st.ask).toBeNull();
    expect(s.st.fs['/home/you/a']).toBeUndefined();
    s.sh('rm -i b');
    s.sh('no');
    expect(s.st.fs['/home/you/b']).toBeDefined();
    // The answers are not commands: history has the rm lines only.
    expect(s.st.history).toEqual(['touch a b', 'rm -i a', 'rm -i b']);
  });

  it('several questions in one line; output before and after each answer', () => {
    const s = session();
    s.sh('echo hi > full; touch e');
    s.sh('rm -iv e full');
    expect(s.st.ask?.prompt).toBe("rm: remove regular empty file 'e'? ");
    const r1 = s.sh('y');
    expect(r1.text).toBe("removed 'e'");
    expect(s.st.ask?.prompt).toBe("rm: remove regular file 'full'? ");
    const r2 = s.sh('y');
    expect(r2.text).toBe("removed 'full'");
    expect(s.st.ask).toBeNull();
    expect(s.out('ls')).toBe('');
  });

  it('Ctrl+C at a question stops the command; what was done stays done', () => {
    const s = session();
    s.sh('touch a b');
    s.sh('rm -i a b');
    s.sh('y');
    const c = s.sh('^C');
    expect(c.exitCode).toBe(130);
    expect(s.st.ask).toBeNull();
    expect(s.out('ls')).toBe('b');
  });

  it('cp -i and mv -i ask before overwriting; "no" exits 1', () => {
    const s = session();
    s.sh('echo hi > x; echo yo > y');
    s.sh('cp -i x y');
    expect(s.st.ask?.prompt).toBe("cp: overwrite 'y'? ");
    expect(s.sh('n').exitCode).toBe(1);
    expect(s.out('cat y')).toBe('yo');
    expect(plain(run(s.st, 'echo y | cp -iv x y').output)).toBe("cp: overwrite 'y'? 'x' -> 'y'");
    s.sh('mv -i x y');
    expect(s.st.ask?.prompt).toBe("mv: overwrite 'y'? ");
    s.sh('yes');
    expect(s.out('ls')).toBe('y');
  });

  it('a write-protected file: rm asks at a terminal, not without one', () => {
    const s = session();
    s.sh('touch p; chmod 444 p');
    s.sh('rm p');
    expect(s.st.ask?.prompt).toBe("rm: remove write-protected regular empty file 'p'? ");
    s.sh('n');
    expect(s.st.fs['/home/you/p']).toBeDefined();
    const r = run(s.st, 'rm p', { tty: false });
    expect(r.exitCode).toBe(0);
    expect(r.state.fs['/home/you/p']).toBeUndefined();
    expect(r.state.ask ?? null).toBeNull();
  });

  it('rm -ri descends, asks per entry; a kept file keeps its folder', () => {
    const s = session();
    s.sh('mkdir d; touch d/f');
    const r = run(s.st, "printf 'y\\nn\\ny\\n' | rm -ri d", { tty: false });
    expect(plain(r.output)).toBe("rm: descend into directory 'd'? rm: remove regular empty file 'd/f'? rm: remove directory 'd'? rm: cannot remove 'd': Directory not empty");
    expect(r.exitCode).toBe(1);
    expect(plain(run(s.st, 'echo n | rm -rI d').output)).toBe('rm: remove 1 argument recursively? ');
  });

  it('with no terminal and nothing piped in, the answer is no', () => {
    const st = createMachine();
    const a = run(st, 'touch y', { tty: false });
    const r = run(a.state, 'rm -i y', { tty: false });
    expect(plain(r.output)).toBe("rm: remove regular file 'y'? ".replace('regular file', 'regular empty file'));
    expect(r.state.fs['/home/you/y']).toBeDefined();
  });
});

describe('coreutils quoting under C.UTF-8', () => {
  it('mkdir errors use ‘locale quotes’; -v uses shell quotes', () => {
    const s = session();
    expect(s.out('mkdir a/b/c')).toBe('mkdir: cannot create directory ‘a/b/c’: No such file or directory');
    expect(s.out('mkdir /root/x')).toBe('mkdir: cannot create directory ‘/root/x’: Permission denied');
    expect(s.out('mkdir -p /root/x/y')).toBe('mkdir: cannot create directory ‘/root’: Permission denied');
    expect(s.out('mkdir -p /var/x/y')).toBe('mkdir: cannot create directory ‘/var/x’: Permission denied');
    expect(s.out('mkdir -pv deep/er')).toBe("mkdir: created directory 'deep'\nmkdir: created directory 'deep/er'");
    s.sh('touch f');
    expect(s.out('mkdir -p f/g')).toBe('mkdir: cannot create directory ‘f’: Not a directory');
    expect(s.out('mkdir -p ./f')).toBe('mkdir: cannot create directory ‘./f’: File exists');
    expect(s.out('id bob')).toBe('id: ‘bob’: no such user');
    expect(s.out('groups bob')).toBe('groups: ‘bob’: no such user');
    expect(s.out('sleep x')).toBe("sleep: invalid time interval ‘x’\nTry 'sleep --help' for more information.");
    expect(s.out('date -d xyz')).toBe('date: invalid date ‘xyz’');
  });

  it('rmdir -v and -p; chown -v says from and to', () => {
    const s = session();
    s.sh('mkdir -p r/s');
    expect(s.out('rmdir -pv r/s')).toBe("rmdir: removing directory, 'r/s'\nrmdir: removing directory, 'r'");
    s.sh('touch f');
    expect(s.out('chown -v you f')).toBe("ownership of 'f' retained as you");
    expect(s.out('chgrp -v you f')).toBe("group of 'f' retained as you");
    expect(s.out('sudo chown -v root:www-data f')).toBe("changed ownership of 'f' from you:you to root:www-data");
    expect(s.out('sudo chgrp -v you f')).toBe("changed group of 'f' from www-data to you");
    expect(s.out('sudo chown -c root f')).toBe('');
  });

  it('cp into itself makes the folder, then stops', () => {
    const s = session();
    s.sh('mkdir shop');
    expect(s.out('cp -r shop shop/in')).toBe("cp: cannot copy a directory, 'shop', into itself, 'shop/in'");
    expect(s.out('ls shop')).toBe('in');
  });
});

describe('kill -l', () => {
  it("bash's list, five a line, and number ↔ name", () => {
    const s = session();
    const list = s.out('kill -l').split('\n');
    expect(list[0]).toBe(' 1) SIGHUP\t 2) SIGINT\t 3) SIGQUIT\t 4) SIGILL\t 5) SIGTRAP');
    expect(list[5]).toBe('26) SIGVTALRM\t27) SIGPROF\t28) SIGWINCH\t29) SIGIO\t30) SIGPWR');
    expect(list[list.length - 1]).toBe('63) SIGRTMAX-1\t64) SIGRTMAX\t');
    expect(s.out('kill -l 9')).toBe('KILL');
    expect(s.out('kill -l KILL')).toBe('9');
    expect(s.out('kill -l 137')).toBe('KILL');
    expect(s.out('kill -l 9 15')).toBe('KILL\nTERM');
    const bad = s.sh('kill -l 65');
    expect(bad.text).toBe('-bash: kill: 65: invalid signal specification');
    expect(bad.exitCode).toBe(1);
  });

  it("procps' kill (sudo kill, /usr/bin/kill)", () => {
    const s = session();
    expect(s.out('sudo kill -l 15')).toBe('TERM');
    expect(s.out('/usr/bin/kill -l')).toBe('HUP INT QUIT ILL TRAP ABRT BUS FPE KILL USR1 SEGV USR2 PIPE ALRM TERM STKFLT\nCHLD CONT STOP TSTP TTIN TTOU URG XCPU XFSZ VTALRM PROF WINCH POLL PWR SYS');
    expect(s.out('/usr/bin/kill -L').split('\n')[0]).toBe(' 1 HUP      2 INT      3 QUIT     4 ILL      5 TRAP     6 ABRT     7 BUS');
    expect(s.out('/usr/bin/kill -l 99')).toBe('/usr/bin/kill: unknown signal name 99');
    expect(s.out('sudo kill 99999')).toBe('kill: (99999): No such process');
  });
});

describe('tree', () => {
  it('-L N is how deep it goes', () => {
    const s = session();
    s.sh('sudo apt install -y tree');
    s.sh('mkdir -p shop/stock/dry; touch shop/menu.txt shop/stock/rice.txt');
    expect(s.out('tree -L 1 shop')).toBe('shop\n├── menu.txt\n└── stock\n\n2 directories, 1 file');
    expect(s.out('tree -L1 shop')).toBe(s.out('tree -L 1 shop'));
    expect(s.out('tree shop')).toBe('shop\n├── menu.txt\n└── stock\n    ├── dry\n    └── rice.txt\n\n3 directories, 2 files');
    expect(s.out('tree -L 0')).toBe('tree: Invalid level, must be greater than 0.');
  });
});

describe('systemctl status after stop, disable and a failed start', () => {
  it('a stopped, disabled unit is unloaded: only "inactive (dead)"', () => {
    const s = session();
    s.sh('sudo systemctl disable --now nginx');
    expect(s.out('systemctl status nginx')).toBe(
      '○ nginx.service - A high performance web server and a reverse proxy server\n     Loaded: loaded (/usr/lib/systemd/system/nginx.service; disabled; preset: enabled)\n     Active: inactive (dead)\n       Docs: man:nginx(8)',
    );
  });

  it('a failed start shows no Main PID', () => {
    const s = session();
    s.sh('echo broken | sudo tee /etc/nginx/sites-enabled/bad');
    s.sh('sudo systemctl restart nginx');
    const out = s.out('systemctl status nginx');
    expect(out).toMatch(/Active: failed \(Result: exit-code\)/);
    expect(out).not.toMatch(/Main PID/);
    // nginx reached the end of the file still waiting for ";".
    expect(s.out('sudo journalctl -u nginx')).toMatch(/unexpected end of file, expecting ";" or "}" in \/etc\/nginx\/sites-enabled\/bad:2/);
    // stop leaves a failed unit failed; reset-failed (root only) clears it.
    s.sh('sudo systemctl stop nginx');
    expect(s.out('systemctl is-active nginx')).toBe('failed');
    const denied = s.sh('systemctl reset-failed nginx');
    expect(denied.text).toBe('Failed to reset failed state of unit nginx.service: Access denied');
    expect(denied.exitCode).toBe(1);
    s.sh('sudo systemctl reset-failed nginx');
    expect(s.out('systemctl is-active nginx')).toBe('inactive');
  });

  it('sudo runs the program, not the shell builtin', () => {
    const s = session();
    expect(s.out('sudo echo hi')).toBe('hi');
    expect(s.out('which echo')).toBe('/usr/bin/echo');
    expect(s.out('sudo kill 99999')).toBe('kill: (99999): No such process');
  });
});

describe('login umask, history', () => {
  it('you and www-data get 0002 (pam_umask), root 0022', () => {
    const s = session();
    expect(s.out('umask')).toBe('0002');
    expect(s.out('umask -S')).toBe('u=rwx,g=rwx,o=rx');
    s.sh('touch mine; mkdir den');
    expect(s.out('ls -l').split('\n').slice(1).map((l) => l.slice(0, 10))).toEqual(['drwxrwxr-x', '-rw-rw-r--']);
    expect(s.out('sudo -u www-data bash -c umask')).toBe('0002');
    expect(s.out('sudo bash -c umask')).toBe('0022');
    s.sh('umask 022');
    s.sh('touch after');
    expect(s.out('ls -l after').slice(0, 10)).toBe('-rw-r--r--');
    expect(s.out("bash -c 'umask'")).toBe('0022');
  });

  it('history skips lines that start with a space and repeats (ignoreboth)', () => {
    const s = session();
    s.sh(' echo hidden');
    s.sh('echo hi');
    s.sh('echo hi');
    expect(s.out('history')).toBe('    1  echo hi\n    2  history');
  });
});
