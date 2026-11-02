// World L2 "Keys & Staff": users, permissions, processes, services and packages on the server
// "kedai". Users are staff, groups are teams, permissions are keys, root holds every key.
// Each `verify` list runs in the engine and, with `npm run verify:linux`, on a real Debian 13
// machine as "you" (apt is engine-only: it needs the real mirrors).
import type { LinuxScenario, LinuxStep } from '~/engine/linux-sim';

const OPEN_SH = '#!/bin/bash\necho "Kedai is open"\n';

/** ~/shop: a script, a price list, a secret and the staff room. */
const shop = (secretMode: string): LinuxStep[] => [
  'mkdir -p shop/staff',
  { write: '~/shop/open.sh', content: OPEN_SH, mode: '644' },
  { write: '~/shop/prices.txt', content: 'teh tarik 3\nkopi o 2\n', mode: '644' },
  { write: '~/shop/secret.txt', content: 'safe code 4321\n', mode: secretMode },
  { write: '~/shop/staff/roster.txt', content: 'Mon Aina\nTue Ben\n', mode: '644' },
  'chmod 750 shop/staff',
];

/** A busy script that ignores Ctrl+C and polite kill: only kill -9 ends it. */
const STUBBORN = '#!/bin/bash\ntrap "" TERM INT\nwhile true; do\n  :\ndone\n';
/** A busy script that eats the CPU but stops when asked. */
const BUSY = '#!/bin/bash\nwhile true; do\n  :\ndone\n';

/** nginx's site file with one typo (lisen), the way the L2 boss finds it. */
const LISEN = "sed -i 's/^\\tlisten 80 default_server;/\\tlisen 80 default_server;/' /etc/nginx/sites-available/default";
/** nginx's site file with a missing semicolon after root. */
const NO_SEMI = "sed -i 's|^\\troot /var/www/html;|\\troot /var/www/html|' /etc/nginx/sites-available/default";

export const l2: LinuxScenario[] = [
  {
    // L2-01: users, groups and sudo. A "kitchen" team exists; Aina is a new cook.
    id: 'linux-l2-users',
    steps: [{ root: 'groupadd kitchen' }],
    verify: [
      ['whoami', 'id', 'groups', 'cat /etc/shadow', 'sudo whoami', 'sudo -u www-data whoami', 'id www-data'],
      ['useradd aina', 'sudo useradd -m -s /bin/bash aina', 'id aina', 'sudo usermod -aG kitchen aina', 'groups aina', 'ls /home', 'getent group kitchen'],
    ],
  },
  {
    // L2-02: read rwx. secret.txt is already private (600); the staff room is 750.
    id: 'linux-l2-perms',
    cwd: '~/shop',
    steps: shop('600'),
    verify: [['ls -l', './open.sh', 'ls -l open.sh', 'ls -ld staff', 'cat /etc/shadow', 'ls -l /etc/hostname', 'ls -ld /home/you']],
  },
  {
    // L2-03: chmod. open.sh can't run yet, and secret.txt is readable by everyone (644).
    id: 'linux-l2-chmod',
    cwd: '~/shop',
    steps: shop('644'),
    verify: [
      ['./open.sh', 'chmod +x open.sh', 'ls -l open.sh', './open.sh', 'chmod 600 secret.txt', 'ls -l secret.txt', 'chmod 755 open.sh', 'ls -l open.sh'],
      ['chmod u=rw,go=r prices.txt', 'ls -l prices.txt', 'chmod go-r secret.txt', 'ls -l secret.txt', 'chmod abc open.sh', 'chmod 777 prices.txt', 'ls -l prices.txt', 'chmod 644 nope.txt'],
    ],
  },
  {
    // L2-04: chown. The web staff (www-data) must save photos in /srv/kedai/uploads, but you own it.
    id: 'linux-l2-chown',
    cwd: '/srv/kedai',
    steps: [{ root: 'mkdir -p /srv/kedai/uploads' }, { root: 'chmod 755 /srv/kedai /srv/kedai/uploads' }, { root: 'chown -R you:you /srv/kedai' }, { write: '/srv/kedai/menu.html', content: '<h1>Menu</h1>\n' }],
    verify: [['ls -l', 'sudo -u www-data touch uploads/a.jpg', 'chown www-data uploads', 'sudo chown www-data:www-data uploads', 'ls -l', 'sudo -u www-data touch uploads/a.jpg', 'ls uploads', 'sudo chown you menu.html', 'ls -l menu.html']],
  },
  {
    // L2-05: processes. A stock-check script is stuck in a loop and eats the CPU.
    id: 'linux-l2-procs',
    steps: ['mkdir bin', { write: '~/bin/stock-check.sh', content: BUSY, mode: '755' }, { process: { cmd: 'bash /home/you/bin/stock-check.sh' } }],
    verify: [['pgrep -f stock-check', 'ps aux | grep -c "[s]tock-check"', 'pkill -f stock-check', 'sleep 1', 'pgrep -f stock-check', 'echo $?']],
  },
  {
    // L2-06: signals and jobs. The oven timer ignores polite signals; only kill -9 stops it.
    id: 'linux-l2-signals',
    steps: ['mkdir bin', { write: '~/bin/oven-timer.sh', content: STUBBORN, mode: '755' }, { process: { cmd: 'bash /home/you/bin/oven-timer.sh', stubborn: true } }],
    verify: [['pgrep -f oven-timer', 'pkill -f oven-timer', 'sleep 1', 'pgrep -f oven-timer | wc -l', 'pkill -9 -f oven-timer', 'sleep 1', 'pgrep -f oven-timer', 'echo $?']],
  },
  {
    // L2-06: jobs. A quiet server for &, jobs, fg, bg (job notices only show in a terminal).
    id: 'linux-l2-jobs',
    steps: [],
    verify: [['sleep 1', 'echo $?', 'jobs', 'sleep 2 && echo baked']],
  },
  {
    // L2-07: environment variables and PATH. A helper script lives in ~/tools, not on the PATH yet.
    id: 'linux-l2-path',
    steps: ['mkdir tools', { write: '~/tools/menu', content: '#!/bin/bash\necho "Today at $SHOP: nasi lemak"\n', mode: '755' }],
    verify: [
      ['echo $HOME', 'echo $USER', 'echo $PATH', 'menu', 'tools/menu', 'export PATH="$HOME/tools:$PATH"', 'menu', 'which menu', 'which ls'],
      ['SHOP=Kancil', 'echo $SHOP', 'tools/menu', 'export SHOP', 'tools/menu', 'printenv SHOP', 'unset SHOP', 'tools/menu', 'env | grep -c "^HOME="'],
    ],
  },
  {
    // L2-08: services. After a power cut the web server stayed off, and it is off at boot.
    id: 'linux-l2-services',
    network: true,
    steps: [{ root: 'systemctl disable --now nginx' }],
    verify: [
      ['systemctl is-active nginx', 'systemctl is-enabled nginx', 'curl -sS localhost', 'sudo systemctl start nginx', 'systemctl is-active nginx', 'curl -sI localhost'],
      ['sudo systemctl enable --now nginx', 'systemctl is-active nginx', 'systemctl is-enabled nginx', 'sudo systemctl restart nginx', 'systemctl is-active nginx', 'systemctl is-active cron ssh'],
      ['systemctl start nginx', 'sudo systemctl stop cron', 'systemctl is-active cron', 'sudo systemctl start cron', 'sudo systemctl status nope'],
    ],
  },
  {
    // L2-09: logs. nginx failed to start this morning: a semicolon is missing in its site file.
    id: 'linux-l2-journal',
    steps: [{ root: 'systemctl stop nginx' }, { root: NO_SEMI }, { root: 'systemctl start nginx || true' }],
    verify: [
      ['systemctl is-active nginx', 'sudo journalctl -u nginx -n 5 --no-pager', 'sudo journalctl -u nginx -g emerg --no-pager', 'sudo nginx -t'],
      ["sudo sed -i 's|^\\troot /var/www/html$|\\troot /var/www/html;|' /etc/nginx/sites-available/default", 'sudo nginx -t', 'sudo systemctl start nginx', 'systemctl is-active nginx', 'sudo journalctl -u nginx -n 2 --no-pager'],
    ],
  },
  {
    // L2-10: packages with apt (engine only: apt needs the real Debian mirrors).
    id: 'linux-l2-apt',
    engineOnly: 'apt talks to the Debian mirrors; its offline catalog was measured on Debian 13 (Nov 2026).',
    steps: ['mkdir -p kedai/menu kedai/kitchen', { write: '~/kedai/menu/today.txt', content: 'nasi lemak 5\n' }, { write: '~/kedai/kitchen/sambal.txt', content: 'chilli\nonion\n' }],
    verify: [['tree', 'apt install tree', 'sudo apt update', 'apt search tree', 'apt show tree', 'sudo apt install tree', 'which tree', 'sudo apt remove tree', 'which tree']],
  },
  {
    // L2 boss, stage 1: nginx won't start this morning (a typo: lisen).
    id: 'linux-l2-boss',
    network: true,
    steps: [{ root: 'systemctl stop nginx' }, { root: LISEN }, { root: 'systemctl start nginx || true' }],
    verify: [
      ['curl -sS localhost', 'systemctl is-active nginx', 'sudo journalctl -u nginx -n 5 --no-pager', 'sudo nginx -t'],
      ["sudo sed -i 's/lisen/listen/' /etc/nginx/sites-available/default", 'sudo nginx -t', 'sudo systemctl start nginx', 'systemctl is-active nginx', 'curl -sI localhost'],
    ],
  },
  {
    // L2 boss, stage 2: the typo is fixed; nginx is still down.
    id: 'linux-l2-boss-2',
    network: true,
    steps: [{ root: 'systemctl stop nginx' }, { root: LISEN }, { root: 'systemctl start nginx || true' }, { root: "sed -i 's/lisen/listen/' /etc/nginx/sites-available/default" }],
    verify: [['sudo nginx -t', 'systemctl is-active nginx', 'sudo systemctl start nginx', 'systemctl is-active nginx', 'systemctl is-enabled nginx', 'curl -s localhost | head -n 4']],
  },
];
