// World L4 "Remote Kitchens": SSH keys and config, disk space, cron, bash scripts, nginx, and the
// nightly backup boss, on the practice server "kedai". Story: a branch kitchen you run from far away;
// a key pair is a padlock you hang on its door (public) and the one key that opens it (private).
// Scenarios with `verify` also run on a real Debian 13 machine (npm run verify:linux).
import type { LinuxScenario } from '~/engine/linux-sim';

/** A practice public key (made up: not a real key). */
export const AINA_PUB = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBq7m2XrYwPq0N8tVd3kLx5sGfJ1cHaZe9uR4oTiMbWy aina@laptop\n';

const MENU = 'nasi lemak 5\nroti canai 2\nteh tarik 3\n';

const OPEN_SH = `#!/bin/bash
# open.sh: open the shop and greet the first worker.
shop="Kedai Kancil"
worker=$1
if [ -z "$worker" ]; then
  echo "Who is opening? Try: ./open.sh Aina"
  exit 1
fi
echo "$worker opens $shop."
if [ -f "$HOME/menu.txt" ]; then
  echo "The menu is ready."
else
  echo "No menu yet!"
fi
`;

const CHECK_SH = `#!/bin/bash
# check.sh: is every dish on today's menu?
missing=0
for dish in nasi-lemak roti-canai teh-tarik; do
  if [ -f "menu/$dish.txt" ]; then
    echo "ok: $dish"
  else
    echo "missing: $dish"
    missing=$((missing + 1))
  fi
done
exit "$missing"
`;

const TIDY_SH = `#!/bin/bash
# set -euo pipefail
cd "$HOME/kedai/tmp"
rm -f *.txt
echo "tidy done"
`;

const HELLO_SH = `#!/bin/bash
echo "$(date +%H:%M) Kedai is open"
`;

const BOSS_BACKUP = `#!/bin/bash
# backup.sh: copy the menu to the backups folder, every night.
# set -euo pipefail
src="$HOME/kedai/menu"
dest="$HOME/backup"
cp -r "$src" "$dest/menu-$(date +%F)"
echo "backup done"
`;

const SITE_8080 = `server {
\tlisten 8080;
\troot /var/www/html;
\tindex index.html;
}
`;

const SITE_BROKEN = `server {
\tlisten 8080;
\troot /var/www/html
\tindex index.html;
}
`;

export const l4: LinuxScenario[] = [
  {
    // L4-01: make a key pair (engine only: the keys are made up for practice).
    id: 'linux-l4-keygen',
    engineOnly: 'ssh-keygen makes a new random key every time, so no two machines print the same key.',
    steps: [],
    task: { goal: { fileExists: ['~/.ssh/id_ed25519', '~/.ssh/id_ed25519.pub'] }, solution: ['ssh-keygen -t ed25519 -N "" -C "you@kedai"'] },
    verify: [['ssh-keygen -t ed25519 -N "" -C "you@laptop"', 'ls -l ~/.ssh', 'cat ~/.ssh/id_ed25519.pub', 'ssh-keygen -l -f ~/.ssh/id_ed25519.pub', 'ssh you@10.0.0.7']],
  },
  {
    // L4-01: the server side: hang Aina's padlock (her public key) on the door.
    id: 'linux-l4-authkeys',
    steps: ['mkdir -m 700 .ssh', { write: '~/aina.pub', content: AINA_PUB }],
    task: { goal: { fileContains: { '~/.ssh/authorized_keys': 'aina@laptop' }, fileMode: { '~/.ssh/authorized_keys': '600' } }, solution: ['cat aina.pub >> ~/.ssh/authorized_keys', 'chmod 600 ~/.ssh/authorized_keys'] },
    verify: [['ls -la ~/.ssh', 'cat aina.pub', 'cat aina.pub >> ~/.ssh/authorized_keys', 'chmod 600 ~/.ssh/authorized_keys', 'ls -l ~/.ssh', 'cat ~/.ssh/authorized_keys']],
  },
  {
    // L4-02: a speed-dial list that is missing a line and is open to everyone.
    id: 'linux-l4-sshconfig',
    steps: ['mkdir -m 700 .ssh', { write: '~/.ssh/config', content: 'Host kedai\n    HostName 10.0.0.5\n', mode: '666' }],
    task: { goal: { fileContains: { '~/.ssh/config': 'User you' }, fileMode: { '~/.ssh/config': '600' } }, solution: ["echo '    User you' >> ~/.ssh/config", 'chmod 600 ~/.ssh/config'] },
    verify: [['ls -l ~/.ssh', 'cat ~/.ssh/config', "echo '    User you' >> ~/.ssh/config", 'chmod 600 ~/.ssh/config', 'ls -l ~/.ssh/config', 'cat ~/.ssh/config']],
  },
  {
    // L4-04: the storeroom is full (engine only: a 17 GB log can't be made in a test container).
    id: 'linux-l4-disk',
    engineOnly: 'A 17 GB debug log fills the disk; a test container cannot hold one.',
    steps: [
      'mkdir -p kedai/menu',
      { write: '~/kedai/menu/today.txt', content: MENU },
      { bigFile: { path: '/var/log/kedai/debug.log', size: 17_200_000_000, owner: 'root' } },
      { bigFile: { path: '/var/log/kedai/orders.log', size: 48_000_000, owner: 'root' } },
    ],
    task: { goal: { fileMissing: ['/var/log/kedai/debug.log'], fileExists: ['/var/log/kedai/orders.log'] }, solution: ['sudo rm /var/log/kedai/debug.log'] },
    verify: [['df -h /', 'du -sh ~', 'sudo du -sh /var/log/*', 'sudo du -sh /var/log/kedai/*', 'ls -lh /var/log/kedai', 'sudo rm /var/log/kedai/debug.log', 'df -h /']],
  },
  {
    // L4-05: cron: install a crontab from a file and watch it run (the clock starts at 09:00:40).
    id: 'linux-l4-cron',
    steps: [
      { write: '~/hello.sh', content: HELLO_SH, mode: '755' },
      { write: '~/jobs.txt', content: '* * * * * /home/you/hello.sh >> /home/you/cron.log\n' },
      { wait: 340 },
    ],
    task: { goal: { crontabHas: { you: 'hello\\.sh' }, fileContains: { '~/cron.log': 'Kedai is open' } }, solution: ['crontab jobs.txt', 'crontab -l', 'sleep 15'] },
    verify: [['crontab -l', 'cat jobs.txt', 'crontab jobs.txt', 'crontab -l', 'crontab -r', 'crontab -l'], ['systemctl is-active cron', './hello.sh | grep -c "Kedai is open"']],
  },
  {
    // L4-06: variables and if: a script that needs a name.
    id: 'linux-l4-vars',
    steps: [{ write: '~/open.sh', content: OPEN_SH, mode: '755' }],
    task: { goal: { scriptExitCode: { '~/open.sh': 0 }, lastTyped: '^\\./open\\.sh \\S' }, solution: ['./open.sh Aina'] },
    verify: [
      ['cat open.sh', './open.sh', 'echo $?', './open.sh Aina', 'echo $?', 'echo "nasi lemak" > menu.txt', './open.sh Ali'],
      ['name=Aina', 'echo "Hi $name"', "echo 'Hi $name'", 'if [ -f open.sh ]; then echo "found"; fi', 'if [ -d nope ]; then echo yes; else echo no; fi', '[ 5 -gt 3 ] && echo bigger'],
    ],
  },
  {
    // L4-07: loops and exit codes: one dish is missing, so the script exits 1.
    id: 'linux-l4-loops',
    steps: ['mkdir menu', 'touch menu/nasi-lemak.txt menu/roti-canai.txt', { write: '~/check.sh', content: CHECK_SH, mode: '755' }],
    task: { goal: { scriptExitCode: { '~/check.sh': 0 }, fileExists: ['~/menu/teh-tarik.txt'] }, solution: ['touch menu/teh-tarik.txt', './check.sh'] },
    verify: [
      ['./check.sh', 'echo $?', './check.sh && echo "Open the shop"', './check.sh || echo "Not yet"', 'touch menu/teh-tarik.txt', './check.sh', 'echo $?'],
      ['for i in 1 2 3; do echo "table $i"; done', 'for f in menu/*.txt; do echo "$f"; done', 'ls nope', 'echo $?', 'true', 'echo $?'],
    ],
  },
  {
    // L4-08: without strict mode, a failed cd lets rm run in the wrong folder.
    id: 'linux-l4-strict',
    steps: ['mkdir kedai', { write: '~/menu.txt', content: MENU }, { write: '~/prices.txt', content: 'teh 3\nkopi 3\n' }, { write: '~/tidy.sh', content: TIDY_SH, mode: '755' }],
    task: { goal: { fileContains: { '~/tidy.sh': '^set -euo pipefail' }, scriptExitCode: { '~/tidy.sh': 1 }, fileExists: ['~/menu.txt', '~/prices.txt'] }, solution: ["sed -i 's/^# set/set/' tidy.sh", './tidy.sh'] },
    verify: [
      ['cat tidy.sh', "sed -i 's/^# set/set/' tidy.sh", 'head -n 2 tidy.sh', './tidy.sh', 'echo $?', 'ls'],
      ['./tidy.sh', 'echo $?', 'ls'],
      ['bash -c \'set -u; echo "[$NOPE]"\'', 'echo $?', 'bash -c "grep -c x nope.txt | sort"', 'echo $?', 'bash -c "set -o pipefail; grep -c x nope.txt | sort"', 'echo $?'],
    ],
  },
  {
    // L4-09: the default page, then your own sign (sudo tee into /var/www/html).
    id: 'linux-l4-nginx-page',
    network: true,
    steps: [],
    task: { goal: { reachable: { localhost: { status: 200, contains: 'Kedai Kancil' } } }, solution: ["echo '<h1>Kedai Kancil</h1>' | sudo tee /var/www/html/index.html"] },
    verify: [['curl -s localhost | grep title', "echo '<h1>Kedai Kancil</h1>' | sudo tee /var/www/html/index.html", 'curl -s localhost', 'ls -l /var/www/html']],
  },
  {
    // L4-09: nginx: the front counter. Put up your own page; turn on a second door (port 8080).
    id: 'linux-l4-nginx',
    network: true,
    steps: [
      { write: '/etc/nginx/sites-available/kedai', content: SITE_8080, owner: 'root' },
      { write: '/var/www/html/index.html', content: '<h1>Kedai Kancil</h1>\n', owner: 'root' },
    ],
    task: { goal: { portListening: [8080], reachable: { 'localhost:8080': 200 } }, solution: ['sudo ln -s /etc/nginx/sites-available/kedai /etc/nginx/sites-enabled/', 'sudo nginx -t', 'sudo systemctl reload nginx'] },
    verify: [
      ['curl -s localhost', 'ls -l /var/www/html'],
      ['cat /etc/nginx/sites-available/kedai', 'sudo ln -s /etc/nginx/sites-available/kedai /etc/nginx/sites-enabled/', 'ss -tln', 'sudo nginx -t', 'sudo systemctl reload nginx', 'sleep 1', 'ss -tln', 'curl -sI localhost:8080'],
    ],
  },
  {
    // L4-09: a missing semicolon: nginx -t catches it before a reload can break anything.
    id: 'linux-l4-nginx-typo',
    network: true,
    steps: [
      { write: '/etc/nginx/sites-available/kedai', content: SITE_BROKEN, owner: 'root' },
      { root: 'ln -s /etc/nginx/sites-available/kedai /etc/nginx/sites-enabled/' },
    ],
    task: {
      goal: { portListening: [8080], serviceActive: ['nginx'] },
      solution: ["sudo sed -i 's#root /var/www/html$#root /var/www/html;#' /etc/nginx/sites-available/kedai", 'sudo nginx -t', 'sudo systemctl reload nginx'],
    },
    verify: [
      ['sudo nginx -t', 'sudo systemctl reload nginx', 'systemctl is-active nginx', 'curl -sI localhost | head -n 1'],
      ["sudo sed -i 's#root /var/www/html$#root /var/www/html;#' /etc/nginx/sites-available/kedai", 'sudo nginx -t', 'sudo systemctl reload nginx', 'sleep 1', 'ss -tln'],
    ],
  },
  {
    // L4 boss: the nightly backup "worked" (exit 0) but saved nothing. Make it loud, fix it, schedule it.
    id: 'linux-l4-boss',
    steps: ['mkdir -p kedai/menu backups', { write: '~/kedai/menu/today.txt', content: MENU }, { write: '~/backup.sh', content: BOSS_BACKUP, mode: '755' }],
    task: {
      goal: { fileContains: { '~/backup.sh': '^set -euo pipefail' }, scriptExitCode: { '~/backup.sh': 0 }, crontabHas: { you: '^0 2 \\* \\* \\* /home/you/backup\\.sh' } },
      solution: ["sed -i 's/^# set/set/' backup.sh", "sed -i 's#/backup\"#/backups\"#' backup.sh", './backup.sh', "echo '0 2 * * * /home/you/backup.sh' | crontab -"],
    },
    verify: [
      ['./backup.sh', 'echo $?', 'ls backups', "sed -i 's/^# set/set/' backup.sh", './backup.sh', 'echo $?'],
      ["sed -i 's/^# set/set/' backup.sh", "sed -i 's#/backup\"#/backups\"#' backup.sh", 'grep dest= backup.sh', './backup.sh', 'echo $?', 'ls backups'],
      ["echo '0 2 * * * /home/you/backup.sh' | crontab -", 'crontab -l', 'systemctl is-active cron'],
    ],
  },
];
