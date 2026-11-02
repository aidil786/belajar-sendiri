// World D3 additions: tar backups of a volume, $PWD, --network none and env files.
// Expected texts were checked on Docker 29.9 (alpine:3.22 BusyBox tar, python:3.13-slim GNU tar).
import { describe, expect, it } from 'vitest';
import { kitchen, runs, text, write } from './helpers';

describe('backing up a volume with tar', () => {
  it('backs up, restores into a new volume, lists and reads the archive', () => {
    const r = runs(
      kitchen(['alpine:3.22']),
      'echo $PWD',
      'docker run --rm -v kedai-data:/data alpine:3.22 sh -c "echo nasi lemak > /data/orders.txt; mkdir /data/menu; echo teh tarik > /data/menu/drinks.txt"',
      'docker run --rm -v kedai-data:/from -v "$PWD":/to alpine:3.22 tar czf /to/backup.tar.gz -C /from .',
      'ls',
      'docker run --rm -v "$PWD":/backup alpine:3.22 tar tzf /backup/backup.tar.gz',
      'docker run --rm -v kedai-copy:/to -v "$PWD":/from alpine:3.22 tar xzvf /from/backup.tar.gz -C /to',
      'docker run --rm -v kedai-copy:/data alpine:3.22 cat /data/orders.txt /data/menu/drinks.txt',
    );
    expect(text(r.all[0]!)).toBe('/home/you');
    expect(r.all[2]!.ok).toBe(true);
    expect(text(r.all[2]!)).toBe('');
    expect(text(r.all[3]!)).toContain('backup.tar.gz');
    expect(text(r.all[4]!).split('\n')).toEqual(['./', './menu/', './menu/drinks.txt', './orders.txt']);
    expect(text(r.all[5]!).split('\n')).toEqual(['./', './menu/', './menu/drinks.txt', './orders.txt']);
    expect(text(r.last).split('\n')).toEqual(['nasi lemak', 'teh tarik']);
    expect(Object.keys(r.state.volumes['kedai-copy']!.files).sort()).toEqual(['menu/drinks.txt', 'orders.txt']);
  });

  it('says what BusyBox tar says when something is off', () => {
    let s = write(kitchen(['alpine:3.22']), 'notes.txt', 'hello\n');
    const r = runs(
      s,
      'docker run --rm -v kedai-data:/data -v "$PWD":/backup alpine:3.22 tar czf /backup/b.tgz /data',
      'docker run --rm -v "$PWD":/to alpine:3.22 tar czf /to/x.tgz -C /etc nope',
      'docker run --rm -v "$PWD":/from alpine:3.22 tar xzf /from/nope.tgz -C /tmp',
      'docker run --rm -v "$PWD":/from alpine:3.22 tar xzf /from/notes.txt -C /tmp',
      'docker run --rm -v "$PWD":/to alpine:3.22 tar czf /to/y.tgz -C /nope .',
      'docker run --rm -v "$PWD":/to alpine:3.22 tar czf /to/z.tgz',
    );
    s = r.state;
    expect(r.all[0]!.ok).toBe(true);
    expect(text(r.all[0]!)).toBe("tar: removing leading '/' from member names");
    expect(text(r.all[1]!)).toBe('tar: nope: No such file or directory\ntar: error exit delayed from previous errors');
    expect(text(r.all[2]!)).toBe("tar: can't open '/from/nope.tgz': No such file or directory");
    expect(text(r.all[3]!)).toBe('tar: invalid magic\ntar: short read');
    expect(text(r.all[4]!)).toBe("tar: can't change directory to '/nope': No such file or directory");
    expect(text(r.all[5]!)).toBe('tar: empty archive');
    expect(r.all.slice(1).every((x) => !x.ok)).toBe(true);
    expect(s.fs.files['/home/you/y.tgz']).toBe('');
  });

  it('a read-only locker refuses the restore', () => {
    const r = runs(
      kitchen(['alpine:3.22']),
      'docker run --rm -v kedai-data:/data alpine:3.22 sh -c "echo hi > /data/a.txt"',
      'docker run --rm -v kedai-data:/from -v "$PWD":/to alpine:3.22 tar czf /to/b.tgz -C /from .',
      'docker run --rm -v kedai-data:/to:ro -v "$PWD":/from alpine:3.22 tar xzf /from/b.tgz -C /to',
    );
    expect(text(r.last)).toBe("tar: can't remove old file ./a.txt: Read-only file system");
  });

  it('Debian images print GNU tar words', () => {
    const r = runs(kitchen(['python:3.13-slim']), 'docker run --rm python:3.13-slim tar czf /tmp/x.tgz /etc/hostname', 'docker run --rm python:3.13-slim tar czf /tmp/x.tgz -C /etc nope');
    expect(text(r.all[0]!)).toBe("tar: Removing leading `/' from member names");
    expect(text(r.last)).toBe('tar: nope: Cannot stat: No such file or directory\ntar: Exiting with failure status due to previous errors');
  });
});

describe('phone lines', () => {
  it('--network none has no line out, not even by IP', () => {
    const r = runs(kitchen(['alpine:3.22']), 'docker run --rm --network none alpine:3.22 ping -c 1 8.8.8.8', 'docker run --rm --network none alpine:3.22 wget -qO- http://example.com');
    expect(text(r.all[0]!)).toBe('PING 8.8.8.8 (8.8.8.8): 56 data bytes\nping: sendto: Network unreachable');
    expect(r.all[0]!.ok).toBe(false);
    expect(text(r.last)).toBe("wget: bad address 'example.com'");
  });

  it('the default bridge has no names; BusyBox wget names the address as typed', () => {
    const r = runs(
      kitchen(['alpine:3.22', 'nginx:1.30-alpine']),
      'docker run -d --name web nginx:1.30-alpine',
      'docker run -d --name db nginx:1.30-alpine',
      'docker exec web wget -qO- http://db',
      'docker exec web wget -qO- http://db:5432',
    );
    expect(text(r.all[2]!)).toBe("wget: bad address 'db'");
    expect(text(r.last)).toBe("wget: bad address 'db:5432'");
  });
});

describe('env files', () => {
  it('keeps quotes, skips comments, and leaves out a bare name the laptop lacks', () => {
    let s = write(kitchen(['alpine:3.22']), 'shop.env', 'SHOP_NAME="Kedai Kancil"\n# a comment\nTZ=Asia/Kuala_Lumpur\nEMPTY=\nAPI_KEY\n');
    s = write(s, 'bad.env', 'SPACED = x\n');
    const r = runs(s, 'docker run --rm --env-file shop.env alpine:3.22 env', 'docker run --rm --env-file bad.env alpine:3.22 env', 'docker run --rm --env-file nope.env alpine:3.22 env');
    expect(text(r.all[0]!).split('\n').slice(2)).toEqual(['SHOP_NAME="Kedai Kancil"', 'TZ=Asia/Kuala_Lumpur', 'EMPTY=', 'HOME=/root']);
    expect(text(r.all[1]!)).toContain("docker: --env-file: invalid env file (bad.env): variable 'SPACED ' contains whitespaces");
    expect(r.all[1]!.explain?.key).toBe('sim.docker.err.envFileSpace');
    expect(text(r.last)).toContain('docker: --env-file: open nope.env: no such file or directory');
  });

  it('a bare name passes the laptop value when it is exported', () => {
    const s = write(kitchen(['alpine:3.22']), 'p.env', 'API_KEY\n');
    const r = runs(s, 'export API_KEY=from-laptop', 'docker run --rm --env-file p.env alpine:3.22 printenv API_KEY');
    expect(text(r.last)).toBe('from-laptop');
  });
});
