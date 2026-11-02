import { describe, expect, it } from 'vitest';
import { applyMode } from '..';
import { session } from './helpers';

describe('chmod modes', () => {
  it('numbers and letters', () => {
    expect(applyMode(0o644, '755', false)).toBe(0o755);
    expect(applyMode(0o644, 'u+x', false)).toBe(0o744);
    expect(applyMode(0o644, '+x', false)).toBe(0o755);
    expect(applyMode(0o777, 'go-w', false)).toBe(0o755);
    expect(applyMode(0o640, 'u=rwx,go=r', false)).toBe(0o744);
    expect(applyMode(0o644, 'a=', false)).toBe(0o000);
    expect(applyMode(0o644, 'abc', false)).toBeNull();
  });
});

describe('permissions in action', () => {
  it('a script needs x; chmod +x lets it run', () => {
    const s = session();
    s.sh("printf '#!/bin/bash\\necho open\\n' > open.sh");
    const denied = s.sh('./open.sh');
    expect(denied.text).toBe('-bash: ./open.sh: Permission denied');
    expect(denied.exitCode).toBe(126);
    s.sh('chmod +x open.sh');
    expect(s.out('ls -l open.sh')).toMatch(/^-rwxrwxr-x 1 you you 22 /);
    expect(s.out('./open.sh')).toBe('open');
    expect(s.out('bash open.sh')).toBe('open');
  });

  it('chmod errors', () => {
    const s = session();
    expect(s.out('chmod abc x')).toBe("chmod: invalid mode: ‘abc’\nTry 'chmod --help' for more information.");
    expect(s.out('chmod 755 nope')).toBe("chmod: cannot access 'nope': No such file or directory");
    expect(s.out('chmod 644 /etc/hosts')).toBe("chmod: changing permissions of '/etc/hosts': Operation not permitted");
  });

  it('chown needs root; sudo does it', () => {
    const s = session();
    s.sh('touch menu.txt');
    expect(s.out('chown root menu.txt')).toBe("chown: changing ownership of 'menu.txt': Operation not permitted");
    expect(s.out('chown nope menu.txt')).toBe('chown: invalid user: ‘nope’');
    s.sh('sudo chown root:www-data menu.txt');
    expect(s.out('ls -l menu.txt')).toMatch(/^-rw-rw-r-- 1 root www-data 0 /);
  });

  it('id, groups, whoami, sudo, sudo -u', () => {
    const s = session();
    expect(s.out('id')).toBe('uid=1000(you) gid=1000(you) groups=1000(you),27(sudo)');
    expect(s.out('groups')).toBe('you sudo');
    expect(s.out('id www-data')).toBe('uid=33(www-data) gid=33(www-data) groups=33(www-data)');
    expect(s.out('sudo whoami')).toBe('root');
    expect(s.out('sudo -u www-data whoami')).toBe('www-data');
    expect(s.out('sudo -u www-data ls /root')).toBe("ls: cannot open directory '/root': Permission denied");
    expect(s.out('sudo nope')).toBe('sudo: nope: command not found');
  });

  it('a relative name skips the folders above the current one', () => {
    const s = session();
    s.sh('mkdir shop');
    s.sh('echo safe > shop/note.txt');
    s.sh('cd shop');
    // /home/you is 0700, shop is 0755: from inside, www-data can read it by name.
    expect(s.out('sudo -u www-data cat note.txt')).toBe('safe');
    expect(s.out('sudo -u www-data ls')).toBe('note.txt');
    expect(s.out('sudo -u www-data cat /home/you/shop/note.txt')).toBe('cat: /home/you/shop/note.txt: Permission denied');
  });

  it('users and groups with useradd and usermod (sudo)', () => {
    const s = session();
    expect(s.out('useradd bob')).toBe('-bash: useradd: command not found');
    s.sh('sudo useradd -m -s /bin/bash aina');
    expect(s.out('id aina')).toBe('uid=1001(aina) gid=1001(aina) groups=1001(aina)');
    s.sh('sudo usermod -aG www-data aina');
    expect(s.out('groups aina')).toBe('aina : aina www-data');
    expect(s.out('sudo useradd aina')).toBe("useradd: user 'aina' already exists");
    expect(s.out('ls /home')).toBe('aina  you');
  });

  it('su as a normal user asks for a password; sudo -i works', () => {
    const s = session();
    expect(s.out('su -')).toBe('Password: \nsu: Authentication failure');
    s.sh('sudo -i');
    expect(s.out('whoami')).toBe('root');
    expect(s.out('pwd')).toBe('/root');
    s.sh('su - www-data');
    expect(s.out('whoami')).toBe('root');
    s.sh('exit');
    expect(s.out('whoami')).toBe('you');
  });
});
