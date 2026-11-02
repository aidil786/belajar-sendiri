// Example Linux scenarios: models for lesson writers (Level Up · Linux & Networking).
// Each `verify` list runs in the engine and, with `npm run verify:linux`, on a real Debian 13
// machine (systemd, nginx, cron, ssh) as the user "you". See docs/AUTHORING.md "Linux engine".
import type { LinuxScenario } from '~/engine/linux-sim';

const MENU = 'nasi lemak 5\nroti canai 2\nteh tarik 3\nmee goreng 6\n';

const ACCESS_LOG = `203.0.113.7 - - [01/Nov/2026:08:01:12 +0000] "GET / HTTP/1.1" 200 615
198.51.100.4 - - [01/Nov/2026:08:01:40 +0000] "GET /menu.html HTTP/1.1" 200 312
203.0.113.7 - - [01/Nov/2026:08:02:03 +0000] "GET /promo.html HTTP/1.1" 404 146
192.0.2.55 - - [01/Nov/2026:08:02:09 +0000] "GET / HTTP/1.1" 200 615
203.0.113.7 - - [01/Nov/2026:08:03:30 +0000] "GET /menu.html HTTP/1.1" 200 312
192.0.2.55 - - [01/Nov/2026:08:04:01 +0000] "GET /old.html HTTP/1.1" 404 146
`;

const BACKUP_BROKEN = `#!/bin/bash
set -euo pipefail
src="$HOME/kedai/menu"
dest="$HOME/backups"
cp -r "$src" "$dest/menu-$(date +%F)"
echo "backup done"
`;

export const examples: LinuxScenario[] = [
  {
    // L1: the shophouse. A home folder with a little shop inside: pwd, cd, ls, cat, head, tail.
    id: 'linux-home',
    task: { goal: { cwd: '~/kedai/menu', lastTyped: '^cat ' }, solution: ['cd kedai/menu', 'cat today.txt'] },
    steps: ['mkdir -p kedai/menu kedai/notes', { write: '~/kedai/menu/today.txt', content: MENU }, { write: '~/kedai/notes/todo.txt', content: 'buy rice\nfix the sign\n' }, { write: '~/kedai/.secret', content: 'pin 4321\n' }],
    verify: [
      ['pwd', 'ls', 'cd kedai', 'pwd', 'ls -a', 'ls -l', 'cat menu/today.txt', 'head -n 2 menu/today.txt', 'tail -n 1 menu/today.txt', 'cd ..', 'pwd'],
      ['cd nope', 'cat nope.txt', 'ls nope', 'cd kedai/menu', 'pwd', 'cd', 'pwd', 'cd /tmp', 'pwd', 'cd -', 'cat kedai'],
      ['ls -R kedai', 'ls -la kedai/notes', 'wc -l kedai/menu/today.txt', 'less kedai/notes/todo.txt'],
    ],
  },
  {
    // L1 boss: tidy a messy kitchen folder: mkdir, cp, mv, rm, find, wildcards.
    id: 'linux-messy',
    task: { goal: { dirExists: ['~/kitchen/recipes'], fileExists: ['~/kitchen/recipes/sambal.txt', '~/kitchen/recipes/rendang.txt'], fileMissing: ['~/kitchen/tmp1.tmp', '~/kitchen/tmp2.tmp'] }, solution: ['mkdir recipes', 'mv *.txt recipes/', 'rm *.tmp'] },
    cwd: '~/kitchen',
    steps: [
      'mkdir -p kitchen/old',
      { write: '~/kitchen/sambal.txt', content: 'chilli\nonion\n' },
      { write: '~/kitchen/rendang.txt', content: 'beef\ncoconut\n' },
      { write: '~/kitchen/notes.log', content: 'oven hot\n' },
      { write: '~/kitchen/tmp1.tmp', content: '' },
      { write: '~/kitchen/tmp2.tmp', content: '' },
      { write: '~/kitchen/old/kuih.txt', content: 'flour\n' },
    ],
    verify: [
      ['ls', 'mkdir recipes', 'mv *.txt recipes/', 'ls recipes', 'cp recipes/sambal.txt sambal-copy.txt', 'ls', 'rm *.tmp', 'ls', 'find . -name "*.txt"', 'find . -type d'],
      ['rm old', 'rmdir old', 'rm -r old', 'ls', 'mkdir recipes', 'mkdir recipes', 'cp old recipes', 'mv nope.txt x', 'rm nope.txt'],
      ['cp -r old old-copy', 'ls old-copy', 'mv notes.log old/', 'ls old', 'touch a.txt b.txt', 'ls *.txt', 'echo *.tmp'],
    ],
  },
  {
    // L1: search inside files and pipes: grep, wc, sort, uniq, cut, redirects.
    id: 'linux-logs',
    task: { goal: { fileContains: { '~/logs/errors.txt': '404' }, fileNotContains: { '~/logs/errors.txt': ' 200 ' } }, solution: ['grep 404 access.log > errors.txt'] },
    cwd: '~/logs',
    steps: ['mkdir logs', { write: '~/logs/access.log', content: ACCESS_LOG }],
    verify: [
      ['grep 404 access.log', 'grep -c 404 access.log', 'grep -n menu access.log', 'grep -v " 200 " access.log', 'grep -i GET access.log | wc -l', 'wc -l access.log'],
      ['cut -d" " -f1 access.log', 'cut -d" " -f1 access.log | sort | uniq -c | sort -rn', 'grep 404 access.log > errors.txt', 'cat errors.txt', 'echo "checked" >> errors.txt', 'tail -n 1 errors.txt', 'sort < errors.txt | head -n 1'],
      ['grep nope access.log', 'echo $?', 'grep -r 404 .', 'ls nope 2> err.txt', 'cat err.txt', 'grep 200 access.log && echo found', 'grep nope access.log || echo "not found"'],
    ],
  },
  {
    // L2: read rwx, chmod (letters and numbers), chown with sudo.
    id: 'linux-perms',
    task: { goal: { fileMode: { '~/shop/open.sh': 'x', '~/shop/secret.txt': '600' } }, solution: ['chmod +x open.sh', 'chmod 600 secret.txt'] },
    cwd: '~/shop',
    steps: [
      'mkdir shop',
      { write: '~/shop/open.sh', content: '#!/bin/bash\necho "Kedai is open"\n' },
      { write: '~/shop/prices.txt', content: 'teh 3\nkopi 3\n' },
      { write: '~/shop/secret.txt', content: 'safe code 1234\n' },
    ],
    verify: [
      ['ls -l', './open.sh', 'chmod +x open.sh', 'ls -l open.sh', './open.sh', 'chmod 600 secret.txt', 'ls -l secret.txt', 'chmod u=rw,go=r prices.txt', 'ls -l prices.txt'],
      ['chmod 750 open.sh', 'ls -l open.sh', 'chmod abc open.sh', 'chmod 644 nope', 'chown root prices.txt', 'sudo chown root:www-data prices.txt', 'ls -l prices.txt', 'cat /etc/shadow', 'chmod 644 /etc/hosts'],
      ['id', 'groups', 'whoami', 'sudo whoami', 'sudo -u www-data whoami', 'sudo -u www-data cat secret.txt', 'id www-data', 'groups www-data'],
    ],
  },
  {
    // L2: a stuck script eats the CPU: ps, kill, pkill.
    id: 'linux-stuck',
    task: { goal: { processGone: ['stock-check'] }, solution: ['pkill -f stock-check'] },
    steps: ['mkdir bin', { write: '~/bin/stock-check.sh', content: '#!/bin/bash\nwhile true; do\n  :\ndone\n', mode: '755' }, { process: { cmd: 'bash /home/you/bin/stock-check.sh' } }],
    verify: [
      ['pgrep -f stock-check', 'pkill -f stock-check', 'sleep 1', 'pgrep -f stock-check', 'echo $?'],
      ['ps aux | grep -c "[s]tock-check"', 'ps aux', 'pkill nope', 'echo $?', 'kill 999999', 'kill -9 abc'],
    ],
  },
  {
    // L2 boss: a service that won't start (a typo in the nginx config).
    id: 'linux-nginx-down',
    task: { goal: { serviceActive: ['nginx'], portListening: [80], reachable: { localhost: 200 } }, solution: ["sudo sed -i 's/lisen/listen/' /etc/nginx/sites-available/default", 'sudo systemctl start nginx'] },
    steps: [{ root: "sed -i 's/^\\tlisten 80 default_server;/\\tlisen 80 default_server;/' /etc/nginx/sites-available/default" }, { root: 'systemctl stop nginx' }],
    verify: [
      ['systemctl is-active nginx', 'curl -sS localhost', 'sudo systemctl start nginx', 'systemctl is-active nginx', 'sudo nginx -t'],
      ["sudo sed -i 's/lisen 80/listen 80/' /etc/nginx/sites-available/default", 'sudo nginx -t', 'sudo systemctl start nginx', 'systemctl is-active nginx', 'curl -sI localhost', 'systemctl stop nginx'],
    ],
  },
  {
    // L2: services and logs: systemctl status / stop / start / enable, journalctl.
    id: 'linux-services',
    task: { goal: { serviceDisabled: ['cron'], serviceInactive: ['cron'] }, solution: ['sudo systemctl disable --now cron'] },
    steps: [],
    verify: [
      ['systemctl is-active nginx cron ssh', 'systemctl is-enabled nginx', 'sudo systemctl stop nginx', 'systemctl is-active nginx', 'sudo systemctl start nginx', 'systemctl is-active nginx'],
      ['sudo systemctl disable nginx', 'systemctl is-enabled nginx', 'sudo systemctl enable nginx', 'systemctl is-enabled nginx', 'systemctl status nope', 'sudo systemctl restart nope'],
      ['systemctl status cron', 'sudo systemctl status cron', 'journalctl -u cron', 'sudo systemctl stop cron', 'sudo systemctl status cron'],
      ['sudo systemctl stop ssh', 'systemctl is-active ssh', 'sudo systemctl status ssh', 'sudo systemctl start ssh', 'ss -tln', 'sudo systemctl status nginx'],
    ],
  },
  {
    // L2: environment variables and PATH.
    id: 'linux-path',
    task: { goal: { envVar: { PATH: '/home/you/tools:.*' }, lastTyped: '^hello' }, solution: ['export PATH="$HOME/tools:$PATH"', 'hello'] },
    steps: ['mkdir tools', { write: '~/tools/hello', content: '#!/bin/bash\necho "Selamat datang, $USER"\n', mode: '755' }],
    verify: [
      ['echo $HOME', 'echo $SHELL', 'hello', 'export PATH="$HOME/tools:$PATH"', 'hello', 'which hello', 'which ls', 'which nope', 'echo $?'],
      ['SHOP=kedai', 'echo $SHOP', 'bash -c \'echo "[$SHOP]"\'', 'export SHOP', 'bash -c \'echo "[$SHOP]"\'', 'unset SHOP', 'echo "[$SHOP]"', 'printenv HOME', 'env | grep -c "^HOME="'],
    ],
  },
  {
    // L3: phone lines on one machine: ports, localhost, /etc/hosts, curl.
    id: 'linux-net',
    task: { goal: { resolves: { 'cafe.kedai': '10.0.0.30' } }, solution: ["echo '10.0.0.30 cafe.kedai' | sudo tee -a /etc/hosts"] },
    network: true,
    steps: [{ root: "printf '10.0.0.20\\tdb.kedai\\n' >> /etc/hosts" }],
    verify: [
      ['ss -tln', 'ss -tl', 'curl -sI localhost', 'curl -s localhost | head -n 4', 'curl -sS localhost:8080', 'echo $?'],
      ['getent hosts localhost', 'getent hosts db.kedai', 'getent hosts kedai', 'cat /etc/hosts', 'curl -s localhost/nope', 'curl -sS -o page.html localhost', 'wc -c page.html'],
      ['hostname', 'ping -c 2 localhost', 'ip route', 'ip -br addr'],
    ],
  },
  {
    // L3: DNS and the outside world (engine only: the practice internet has its own names).
    id: 'linux-dns',
    task: { goal: { fileContains: { '~/promo-ip.txt': '203\\.0\\.113\\.12' } }, solution: ['dig +short promo.kedai.example > promo-ip.txt'] },
    network: true,
    engineOnly: 'Uses the practice internet (DNS names and remote shops) that a real container cannot reach.',
    steps: [{ dns: { 'promo.kedai.example': '203.0.113.12' } }, { remote: { ip: '203.0.113.12', up: true, drops: true, rtt: 15 } }],
    verify: [['dig +short kedai.example', 'host www.kedai.example', 'curl -s kedai.example', 'curl -sS promo.kedai.example', 'ping -c 2 kedai.example']],
  },
  {
    // L4 boss: fix the nightly backup script (set -euo pipefail stops at the first problem).
    id: 'linux-backup',
    task: { goal: { scriptExitCode: { '~/backup.sh': 0 }, crontabHas: { you: 'backup\\.sh' } }, solution: ['mkdir backups', './backup.sh', 'echo "0 2 * * * /home/you/backup.sh" > jobs.txt', 'crontab jobs.txt'] },
    steps: ['mkdir -p kedai/menu', { write: '~/kedai/menu/today.txt', content: MENU }, { write: '~/backup.sh', content: BACKUP_BROKEN, mode: '755' }],
    verify: [
      ['./backup.sh', 'echo $?', 'mkdir backups', './backup.sh', 'echo $?', 'ls backups | wc -l'],
      ['crontab -l', 'echo "0 2 * * * /home/you/backup.sh" > jobs.txt', 'crontab jobs.txt', 'crontab -l', 'crontab -r', 'crontab -l'],
      ['bash -c "exit 3"', 'echo $?', 'bash -c "set -u; echo $NOPE_VAR"', 'bash -c \'set -u; echo "$NOPE_VAR"\'', 'echo $?', 'for f in a b; do echo "file-$f"; done', 'if [ -d kedai ]; then echo yes; fi'],
    ],
  },
  {
    // L4: disk space (engine only: a 17 GB log can't be made in a test container).
    id: 'linux-disk',
    task: { goal: { fileMissing: ['/var/log/kedai/debug.log'] }, solution: ['sudo rm /var/log/kedai/debug.log'] },
    engineOnly: 'A 17 GB log file fills the disk; a test container cannot hold one.',
    steps: [{ bigFile: { path: '/var/log/kedai/debug.log', size: 17_200_000_000, owner: 'root' } }],
    verify: [['df -h /', 'sudo du -sh /var/log/kedai', 'sudo find /var/log -size +1G', 'sudo rm /var/log/kedai/debug.log', 'df -h /']],
  },
  {
    // L2: users and groups with sudo.
    id: 'linux-users',
    task: { goal: { userExists: ['aina'], inGroup: { aina: 'www-data' } }, solution: ['sudo useradd -m -s /bin/bash aina', 'sudo usermod -aG www-data aina'] },
    steps: [],
    verify: [['sudo useradd -m -s /bin/bash aina', 'id aina', 'sudo usermod -aG www-data aina', 'groups aina', 'ls /home', 'sudo useradd aina', 'useradd bob']],
  },
];
