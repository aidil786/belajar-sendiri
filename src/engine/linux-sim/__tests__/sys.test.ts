import { describe, expect, it } from 'vitest';
import { buildLinuxScenario, checkLinuxGoal, linuxPicture, randomart } from '..';
import { cronDue } from '../programs/sys';
import { session } from './helpers';

describe('scripts', () => {
  it('set -euo pipefail stops at the first problem; exit codes reach $?', () => {
    const s = session();
    s.sh("printf '#!/bin/bash\\nset -euo pipefail\\ncp missing.txt /tmp/\\necho never\\n' > b.sh");
    s.sh('chmod +x b.sh');
    const r = s.sh('./b.sh');
    expect(r.text).toBe("cp: cannot stat 'missing.txt': No such file or directory");
    expect(r.exitCode).toBe(1);
    expect(s.out('echo $?')).toBe('1');
    expect(s.out('bash -c "exit 3"; echo $?')).toBe('3');
    expect(s.out('bash -c \'set -u; echo "$NOPE"\'; echo $?')).toBe('bash: line 1: NOPE: unbound variable\n127');
  });

  it('a script with arguments, a loop and if', () => {
    const s = session();
    s.sh('printf \'for f in "$@"; do\\n  if [ -e "$f" ]; then echo "have $f"; else echo "no $f"; fi\\ndone\\n\' > check.sh');
    s.sh('touch a');
    expect(s.out('bash check.sh a b')).toBe('have a\nno b');
  });
});

describe('cron', () => {
  it('crontab -l / install / -r', () => {
    const s = session();
    expect(s.out('crontab -l')).toBe('no crontab for you');
    s.sh('echo "*/2 * * * * date >> /home/you/ticks.txt" > jobs.txt');
    s.sh('crontab jobs.txt');
    expect(s.out('crontab -l')).toBe('*/2 * * * * date >> /home/you/ticks.txt');
    expect(s.out('crontab -e')).toMatch(/editor: not found$/);
    const r = s.sh('crontab -r');
    expect(r.danger).toBe(true);
    expect(s.out('crontab -l')).toBe('no crontab for you');
    expect(s.out('echo "61 * * * * x" | crontab -')).toMatch(/bad minute/);
  });

  it('cron runs due jobs when the clock passes them', () => {
    const s = session();
    s.sh('echo "* * * * * echo tick >> /home/you/ticks.txt" | crontab -');
    for (let i = 0; i < 7; i++) s.sh('sleep 10');
    expect((s.st.fs['/home/you/ticks.txt']?.content ?? '').split('\n').filter(Boolean).length).toBeGreaterThanOrEqual(1);
    expect(s.out('sudo journalctl -u cron -n 2')).toMatch(/CRON\[\d+\]: \(you\) CMD \(echo tick >> \/home\/you\/ticks\.txt\)/);
  });

  it('cron time fields', () => {
    const t = Date.UTC(2026, 10, 1, 2, 0, 0) / 1000;
    expect(cronDue('0 2 * * * x', t)).toBe(true);
    expect(cronDue('*/5 * * * * x', t)).toBe(true);
    expect(cronDue('30 2 * * * x', t)).toBe(false);
  });
});

describe('apt (offline catalog)', () => {
  it('needs root; installs tree; tree then works', () => {
    const s = session();
    expect(s.out('tree')).toBe('-bash: tree: command not found');
    expect(s.sh('apt install tree').exitCode).toBe(100);
    const r = s.sh('sudo apt install -y tree');
    expect(r.text).toMatch(/^Installing:\n {2}tree\n\nSummary:\n {2}Upgrading: 0, Installing: 1, Removing: 0, Not Upgrading: 0\n {2}Download size: 59\.4 kB/m);
    expect(r.text).toMatch(/^Setting up tree \(2\.2\.1-1\) \.\.\.$/m);
    s.sh('mkdir -p k/r');
    expect(s.out('tree k')).toBe('k\n└── r\n\n2 directories, 0 files');
    expect(s.out('sudo apt install nope')).toMatch(/Error: Unable to locate package nope$/);
  });
});

describe('ssh-keygen', () => {
  it('makes a key pair with real file names and a randomart box', () => {
    const s = session();
    const out = s.out('ssh-keygen -t ed25519 -N "" -f ~/.ssh/id_ed25519');
    expect(out).toMatch(/^Generating public\/private ed25519 key pair\.\nCreated directory '\/home\/you\/\.ssh'\.\nYour identification has been saved in \/home\/you\/\.ssh\/id_ed25519\n/);
    expect(out).toMatch(/^SHA256:[A-Za-z0-9+/]{43} you@kedai$/m);
    expect(s.out('ls -l .ssh')).toMatch(/-rw------- 1 you you .* id_ed25519\n-rw-r--r-- 1 you you .* id_ed25519\.pub$/);
    expect(randomart([0, 1, 2, 3], 'ED25519 256')[0]).toBe('+--[ED25519 256]--+');
  });
});

describe('disk and memory', () => {
  it('df -h shows a full disk when a big log grows', () => {
    const st = buildLinuxScenario({ id: 't', steps: [{ bigFile: { path: '/var/log/kedai/debug.log', size: 17_200_000_000 } }] });
    const s = session(st);
    expect(s.out('df -h /')).toMatch(/^\/dev\/vda1 +20G +19G +\S+ +9[0-9]% \/$/m);
    expect(s.out('sudo du -sh /var/log/kedai')).toBe('17G\t/var/log/kedai');
    s.sh('sudo rm /var/log/kedai/debug.log');
    expect(s.out('df -h /')).toMatch(/^\/dev\/vda1 +20G +2\.1G +17G +11% \/$/m);
  });
});

describe('goals and the picture', () => {
  it('checks files, modes, services, ports and typed commands', () => {
    const s = session();
    s.sh('touch run.sh');
    const goal = { fileMode: { '~/run.sh': 'x' }, serviceActive: ['nginx'], portListening: [80], lastTyped: '^chmod' };
    expect(checkLinuxGoal(s.st, goal, ['touch run.sh']).failed).toEqual(['fileMode:~/run.sh', 'lastTyped']);
    s.sh('chmod +x run.sh');
    expect(checkLinuxGoal(s.st, goal, ['touch run.sh', 'chmod +x run.sh']).ok).toBe(true);
  });

  it('the picture shows the folder, who you are and the services', () => {
    const s = session();
    s.sh('mkdir shop; touch shop/a.txt menu.txt');
    const pic = linuxPicture(s.st);
    expect(pic.user).toBe('you');
    expect(pic.cwdShort).toBe('~');
    expect(pic.entries.map((e) => `${e.name} ${e.mode} ${e.owner}`)).toEqual(['menu.txt -rw-rw-r-- you', 'shop drwxrwxr-x you']);
    expect(pic.entries[1]!.children).toEqual(['a.txt']);
    expect(pic.hidden).toBe(3);
    expect(pic.services.map((x) => `${x.name}:${x.active}`)).toEqual(['cron:active', 'ssh:active', 'nginx:active']);
    expect(pic.ports.map((p) => p.port)).toEqual([22, 80]);
  });
});
