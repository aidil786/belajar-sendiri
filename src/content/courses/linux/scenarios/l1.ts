// World L1 "The Shophouse": the shell and files. Kancil's shop lives in ~/kedai on the server
// "kedai": rooms are folders (menu, kitchen, store, counter). Each `verify` list runs in the engine
// and, with `npm run verify:linux`, on a real Debian 13 machine as "you".
import type { LinuxScenario, LinuxStep } from '~/engine/linux-sim';

const MENU = 'nasi lemak 5\nroti canai 2\nteh tarik 3\nmee goreng 6\n';

/** The counter's order book: 15 orders. nasi-lemak 6, teh-tarik 4, roti-canai 3, mee-goreng 2. */
export const ORDERS = `08:01 T1 nasi-lemak 5 paid
08:04 T3 teh-tarik 3 paid
08:07 T2 roti-canai 2 paid
08:10 T5 nasi-lemak 5 UNPAID
08:12 T1 teh-tarik 3 paid
08:15 T4 mee-goreng 6 paid
08:19 T2 nasi-lemak 5 paid
08:22 T6 roti-canai 2 UNPAID
08:25 T3 nasi-lemak 5 paid
08:28 T5 teh-tarik 3 paid
08:31 T4 nasi-lemak 5 paid
08:35 T1 mee-goreng 6 paid
08:38 T6 teh-tarik 3 paid
08:41 T2 nasi-lemak 5 Unpaid
08:44 T3 roti-canai 2 paid
`;

/** The shophouse: ~/kedai with four rooms and one hidden note. */
const shop: LinuxStep[] = [
  'mkdir -p kedai/menu kedai/kitchen kedai/store kedai/counter',
  { write: '~/kedai/menu/today.txt', content: MENU },
  { write: '~/kedai/menu/drinks.txt', content: 'teh tarik 3\nkopi o 2\nsirap 2\n' },
  { write: '~/kedai/kitchen/sambal.txt', content: 'chilli\nonion\nbelacan\n' },
  { write: '~/kedai/kitchen/rendang.txt', content: 'beef\ncoconut\nlemongrass\n' },
  { write: '~/kedai/store/stock.txt', content: 'rice 20kg\nflour 10kg\noil 5L\n' },
  { write: '~/kedai/counter/orders.log', content: ORDERS },
  { write: '~/kedai/.keys', content: 'back door key: under the mat\n' },
];

/** The messy kitchen (L1 boss), before any tidying. */
const messy: LinuxStep[] = [
  'mkdir -p kitchen/old/box',
  { write: '~/kitchen/sambal.txt', content: 'chilli\nonion\nbelacan\n' },
  { write: '~/kitchen/rendang.txt', content: 'beef\ncoconut\nlemongrass\n' },
  { write: '~/kitchen/kuih.txt', content: 'flour\nsugar\npandan\n' },
  { write: '~/kitchen/oven.log', content: '07:00 oven on\n07:45 oven hot\n' },
  { write: '~/kitchen/tmp1.tmp', content: '' },
  { write: '~/kitchen/tmp2.tmp', content: '' },
  { write: '~/kitchen/tmp3.tmp', content: '' },
  { write: '~/kitchen/old/menu-2025.md', content: 'old menu\n' },
  { write: '~/kitchen/old/box/supplier.md', content: 'Mak Su brings eggs on Monday\nPak Ali brings chilli on Friday\nCall the gas man if the stove clicks\n' },
];

export const l1: LinuxScenario[] = [
  {
    // L1-01 + L1-02: the shophouse. You start in your own room (/home/you).
    id: 'linux-l1-shop',
    steps: shop,
    verify: [
      ['whoami', 'hostname', 'pwd', 'echo hello', 'whoamii', 'cat today.txt', 'ls'],
      ['pwd', 'ls', 'cd kedai', 'pwd', 'ls', 'cd kitchen', 'pwd', 'ls', 'cd ..', 'pwd', 'cd /home/you/kedai/menu', 'ls', 'cd', 'pwd', 'cd /', 'ls', 'cd ~', 'ls -a kedai'],
      ['cd kedai/store', 'pwd', 'cd ../counter', 'pwd', 'cd -', 'cd ~/kedai', 'ls -l', 'cd kitchn', 'ls menu'],
    ],
  },
  {
    // L1-03 (read files), L1-07 (grep), L1-08 (pipes): you stand at the counter with the order book.
    id: 'linux-l1-counter',
    cwd: '~/kedai/counter',
    steps: shop,
    verify: [
      ['ls', 'cat orders.log', 'head -n 3 orders.log', 'tail -n 3 orders.log', 'head orders.log', 'tail -n 1 orders.log', 'wc -l orders.log', 'cat -n ../menu/today.txt', 'less ../menu/drinks.txt'],
      ['grep UNPAID orders.log', 'grep -i unpaid orders.log', 'grep -c nasi-lemak orders.log', 'grep -n T6 orders.log', 'grep -v paid orders.log', 'grep -ic unpaid orders.log', 'grep laksa orders.log', 'echo $?', 'grep -r belacan ~/kedai', 'grep -rl 5 ~/kedai/menu'],
      ['grep -i unpaid orders.log | wc -l', 'cut -d" " -f3 orders.log', 'cut -d" " -f3 orders.log | sort | uniq -c', 'cut -d" " -f3 orders.log | sort | uniq -c | sort -rn', 'cut -d" " -f3 orders.log | sort | uniq -c | sort -rn | head -n 1'],
      ['grep -i unpaid orders.log > unpaid.txt', 'cat unpaid.txt', 'echo "checked 09:00" >> unpaid.txt', 'tail -n 2 unpaid.txt', 'echo oops > unpaid.txt', 'cat unpaid.txt', 'ls nope', 'ls nope 2> errors.txt', 'cat errors.txt', 'sort -r < ../menu/today.txt'],
    ],
  },
  {
    // L1-04: make, copy, move. A promo draft sits loose in ~/kedai.
    id: 'linux-l1-make',
    cwd: '~/kedai',
    steps: [...shop, { write: '~/kedai/draft.txt', content: 'Promo: 2 teh tarik for RM5\n' }],
    verify: [
      ['mkdir boxes', 'ls', 'mkdir -p store/2026/nov', 'ls store/2026', 'mkdir boxes'],
      ['cp menu/today.txt menu/today.bak', 'ls menu', 'mv draft.txt promo.txt', 'ls', 'mv promo.txt menu/', 'ls menu', 'cp kitchen kitchen-copy', 'cp -r kitchen kitchen-copy', 'ls kitchen-copy', 'cp menu/nope.txt .'],
      ['touch notes.txt', 'ls -l notes.txt', 'mv notes.txt store/', 'cp menu/today.txt store/', 'ls store', 'mv draft.txt', 'cp -r menu menu-old', 'ls menu-old'],
    ],
  },
  {
    // L1-05: delete with care. Old menus and empty temp files clutter ~/kedai.
    id: 'linux-l1-delete',
    cwd: '~/kedai',
    steps: [
      ...shop,
      'mkdir kedai/old',
      { write: '~/kedai/old/menu-2025.txt', content: 'nasi lemak 4\n' },
      { write: '~/kedai/old/prices-2025.txt', content: 'teh tarik 2\n' },
      { write: '~/kedai/a.tmp', content: '' },
      { write: '~/kedai/b.tmp', content: '' },
    ],
    verify: [
      ['ls', 'rm a.tmp', 'ls', 'rm b.tmp', 'ls', 'rm b.tmp'],
      ['ls *.tmp', 'rm *.tmp', 'ls', 'rm old', 'rmdir old', 'ls old', 'rm -r old', 'ls'],
      ['rm -v a.tmp b.tmp', 'rm -r old', 'ls', 'mkdir empty', 'rmdir empty', 'ls'],
    ],
  },
  {
    // L1-06: find. Mak's sambal recipe is lost in a box in the store room.
    id: 'linux-l1-find',
    steps: [
      ...shop,
      'mkdir -p kedai/store/box1 kedai/store/box2/old',
      { write: '~/kedai/store/box2/old/Sambal-Mak.txt', content: "Mak's sambal: chilli, shallot, belacan, tamarind\n" },
      { write: '~/kedai/store/delivery.log', content: '07:30 rice 20kg\n07:35 eggs 60\n' },
      { write: '~/kedai/store/box2/eggs.txt', content: 'eggs 60\n' },
    ],
    verify: [
      ['find kedai -name sambal.txt', 'find kedai -name "Sambal*"', 'find kedai -iname "sambal*"', 'find kedai -name "*.log"', 'find kedai -type d', 'find kedai -type d -empty', 'find ~ -name nope.txt'],
      ['find kedai/store', 'find kedai -type f -name "*.txt"', 'find kedai -maxdepth 2 -name "*.txt"', 'find / -name delivery.log 2> /dev/null', 'find kedai -name "*.log" -exec wc -l {} \\;'],
    ],
  },
  {
    // L1-09: wildcards and Tab. A messy inbox of photos and menus.
    id: 'linux-l1-wild',
    cwd: '~/kedai/inbox',
    steps: [
      ...shop,
      'mkdir kedai/inbox',
      { write: '~/kedai/inbox/nasi.jpg', content: 'photo\n' },
      { write: '~/kedai/inbox/roti.jpg', content: 'photo\n' },
      { write: '~/kedai/inbox/teh.jpg', content: 'photo\n' },
      { write: '~/kedai/inbox/menu1.txt', content: 'week 1\n' },
      { write: '~/kedai/inbox/menu2.txt', content: 'week 2\n' },
      { write: '~/kedai/inbox/menu10.txt', content: 'week 10\n' },
      { write: '~/kedai/inbox/notes.md', content: 'buy rice\n' },
      { write: '~/kedai/inbox/.secret.jpg', content: 'photo\n' },
    ],
    verify: [
      ['ls', 'echo *.jpg', 'ls *.jpg', 'echo menu?.txt', 'echo menu*.txt', 'echo menu[12].txt', 'echo *.png', 'ls *.png', 'echo "*.jpg"'],
      ['mkdir photos', 'mv *.jpg photos/', 'ls', 'ls photos', 'ls -a photos', 'ls -a', 'cat menu1.txt menu2.txt'],
    ],
  },
  {
    // L1 boss, stage 1: the messy kitchen as the day cook left it.
    id: 'linux-l1-boss',
    cwd: '~/kitchen',
    steps: messy,
    verify: [
      ['ls', 'ls -a', 'find . -type f', 'mkdir recipes', 'mv *.txt recipes/', 'ls', 'ls recipes', 'ls recipes | wc -l'],
      ['mkdir recipes', 'mv * recipes/', 'ls'],
    ],
  },
  {
    // L1 boss, stage 2: recipes are in their folder; the temp files are still there.
    id: 'linux-l1-boss-2',
    cwd: '~/kitchen',
    steps: [...messy, 'mkdir kitchen/recipes', 'mv kitchen/sambal.txt kitchen/rendang.txt kitchen/kuih.txt kitchen/recipes/'],
    verify: [['ls', 'ls *.tmp', 'rm *.tmp', 'ls', 'find . -name "*.tmp"']],
  },
  {
    // L1 boss, stage 3: a tidy kitchen; the supplier note is lost in old/box.
    id: 'linux-l1-boss-3',
    cwd: '~/kitchen',
    steps: [...messy, 'mkdir kitchen/recipes', 'mv kitchen/sambal.txt kitchen/rendang.txt kitchen/kuih.txt kitchen/recipes/', 'rm kitchen/tmp1.tmp kitchen/tmp2.tmp kitchen/tmp3.tmp'],
    verify: [
      ['find . -name "*supplier*"', 'cat old/box/supplier.md', 'grep -r "Pak Ali" .', 'grep "Pak Ali" old/box/supplier.md > todo.txt', 'cat todo.txt', 'grep -c brings old/box/supplier.md', 'ls recipes | wc -l', 'ls'],
    ],
  },
];
