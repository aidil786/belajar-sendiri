// Ship It night shift drills (docs/SHIP-IT-PLAN.md §12): optional 5-minute scenarios where
// something is broken in a simulator and the learner fixes it. Shown at /<lang>/ship-it/night-shift/
// (the list, "this week's drill") and /<lang>/ship-it/night-shift/<id>/ (one drill).
// Scenarios live in each course's scenarios/nightshift.ts (or reuse a lesson's scenario).
// `src/content/courses/nightshift.test.ts` checks every drill: the scenario builds, the goal is
// not met at the start, the solution meets it, the rescue flow and docs links look right.
// How to add one: docs/AUTHORING.md, "Night shift drills".
import type { EventPreset } from '~/engine/conveyor-sim';
import type { KubeGoal } from '~/engine/foodcourt-sim';
import type { KitchenGoal } from '~/engine/kitchen-sim';
import type { Bilingual } from '~/i18n';

export type DrillPart = 'docker' | 'cicd' | 'kubernetes';

/**
 * How hard a drill is (docs/LEVEL-UP-PLAN.md §3). Nothing is ever locked.
 * 1 ★: one fault, hints open (they show after mistakes).
 * 2 ★★: one fault, hints folded (the learner opens them).
 * 3 ★★★: an incident: two or three faults at once, no hints (the Rescue Center link stays),
 *    then a "what was the root cause?" question.
 */
export type DrillLevel = 1 | 2 | 3;
export const DRILL_LEVELS: readonly DrillLevel[] = [1, 2, 3];

/** The question after an incident is fixed. Kind feedback; the learner may try again. */
export interface RootCause {
  question: Bilingual;
  /** 3–4 short options. */
  options: Bilingual[];
  /** Index of the right option. */
  answer: number;
  /** Why it is the root cause (shown after the right pick). */
  why: Bilingual;
}

/** One fault of an incident, and the commands that fix it (tests only: each fault must matter). */
export interface DrillProblem {
  what: Bilingual;
  fix: string[];
}

interface DrillBase {
  /** URL slug: /<lang>/ship-it/night-shift/<id>/ */
  id: string;
  /** The course the scenario (and the rescue flow) belongs to. */
  part: DrillPart;
  level: DrillLevel;
  title: Bilingual;
  /**
   * The first thing on the page: a real line the learner would see (an error, a status), copied
   * from what the engine prints (its outputs are checked against the real tool). Not translated.
   */
  alert?: string;
  /** What broke. One or two short sentences (the hook). */
  story: Bilingual;
  /** What "fixed" looks like. One short sentence. */
  task: Bilingual;
  /** Rescue Center flow id (the "help" path). If it doesn't exist yet, the page links the Rescue Center. */
  rescue: string;
  /** Official docs (the only help allowed in exam mode). */
  docs: { label: string; url: string }[];
  success: Bilingual;
  /** Level 3: asked after the fix. */
  rootCause?: RootCause;
}

export interface KitchenDrill extends DrillBase {
  kind: 'kitchen';
  scenario: string;
  goal: KitchenGoal;
  /** Level 1: shown after mistakes. Level 2: folded. Level 3 and exam mode: never shown. */
  hints: Bilingual[];
  /** Commands that fix it (tests only; never shown). With `problems`: their fixes, in order. */
  solution: string[];
  /** Level 3: the faults of the incident (shown after the fix, as "what you fixed"). */
  problems?: DrillProblem[];
}

export interface KubeDrill extends DrillBase {
  kind: 'kube';
  scenario: string;
  goal: KubeGoal;
  hints: Bilingual[];
  solution: string[];
  problems?: DrillProblem[];
}

export interface ConveyorDrill extends DrillBase {
  kind: 'conveyor';
  scenario: string;
  event?: EventPreset;
  /** Choices for the scenario's fix lines (normal mode). Exam mode shows a text box instead. */
  fixes: { label: string; text: string; why?: Bilingual; correct?: boolean }[];
  /** Exam mode (a text box): regexes the fixed YAML must not match (e.g. write-all). */
  forbid?: string[];
  /** The fix text that turns the belt green (tests only). */
  solution: string;
}

export type Drill = KitchenDrill | KubeDrill | ConveyorDrill;

const NGINX = 'nginx:1.30-alpine';
const PG = 'postgres:18-alpine';

/** CI fix text: buildx, then a login step (registry ghcr.io unless `registry` is false). */
function ghcrLogin(password: string, registry = true): string {
  return [
    '      - uses: docker/setup-buildx-action@v4',
    '      - uses: docker/login-action@v4',
    '        with:',
    ...(registry ? ['          registry: ghcr.io'] : []),
    '          username: ${{ github.actor }}',
    `          password: \${{ ${password} }}`,
  ].join('\n');
}

/** CI fix text: a Postgres service container for the test job. */
const TEST_DB = '    runs-on: ubuntu-latest\n    services:\n      postgres:\n        image: postgres:18-alpine\n        env:\n          POSTGRES_PASSWORD: test\n        ports:\n          - 5432:5432';

export const drills: Drill[] = [
  // ---------------------------------------------------------------- Docker (KitchenSim)
  {
    id: 'wrong-hatch',
    part: 'docker',
    kind: 'kitchen',
    scenario: 'ns-docker-wrong-hatch',
    level: 1,
    title: { en: 'The page will not open', ms: 'Halaman tak mahu buka' },
    alert: 'curl: (56) Recv failure: Connection reset by peer',
    story: {
      en: 'The web box runs, but localhost:8080 shows nothing. The hatch leads to a door where nobody listens.',
      ms: 'Bekas web berjalan, tapi localhost:8080 kosong. Tingkap itu menuju ke pintu yang tiada siapa dengar.',
    },
    task: {
      en: 'Make localhost:8080 show the nginx page. Inside, nginx listens on port 80.',
      ms: 'Buat localhost:8080 tunjuk halaman nginx. Di dalam, nginx dengar pada port 80.',
    },
    goal: { running: ['web'], portMapped: { web: '8080:80' }, reachable: 'localhost:8080' },
    hints: [
      { en: 'Look at the hatch: docker port web', ms: 'Lihat tingkap itu: docker port web' },
      { en: 'A hatch cannot change. Remove the box: docker rm -f web', ms: 'Tingkap tak boleh ditukar. Buang bekas itu: docker rm -f web' },
      { en: `Start it again: docker run -d --name web -p 8080:80 ${NGINX}`, ms: `Mulakan semula: docker run -d --name web -p 8080:80 ${NGINX}` },
    ],
    solution: ['docker rm -f web', `docker run -d --name web -p 8080:80 ${NGINX}`],
    success: { en: 'Hatch 8080 now leads to port 80. The page is back.', ms: 'Tingkap 8080 kini menuju ke port 80. Halaman dah kembali.' },
    rescue: 'docker-localhost-unreachable',
    docs: [
      { label: 'Docker: port publishing', url: 'https://docs.docker.com/engine/network/port-publishing/' },
      { label: 'docker container run', url: 'https://docs.docker.com/reference/cli/docker/container/run/' },
    ],
  },
  {
    id: 'busy-hatch',
    part: 'docker',
    kind: 'kitchen',
    scenario: 'ns-docker-busy-hatch',
    level: 2,
    title: { en: 'Hatch 8080 is taken', ms: 'Tingkap 8080 dah berpenghuni' },
    alert: 'Bind for 0.0.0.0:8080 failed: port is already allocated',
    story: {
      en: "Today's web box must serve on hatch 8080. Yesterday's old-web box still holds it.",
      ms: 'Bekas web hari ini mesti melayan di tingkap 8080. Bekas old-web semalam masih pegangnya.',
    },
    task: {
      en: `Get a box called web running on hatch 8080, from ${NGINX}. Nobody needs old-web now.`,
      ms: `Jalankan bekas bernama web pada tingkap 8080, daripada ${NGINX}. Tiada siapa perlukan old-web lagi.`,
    },
    goal: { running: ['web'], portMapped: { web: '8080:80' }, reachable: 'localhost:8080' },
    hints: [
      { en: 'One hatch, one box. Stop the old one: docker stop old-web', ms: 'Satu tingkap, satu bekas. Hentikan yang lama: docker stop old-web' },
      { en: 'A failed run leaves web behind. Remove it: docker rm web', ms: 'Run yang gagal tinggalkan web. Buang ia: docker rm web' },
      { en: `Then run it again: docker run -d --name web -p 8080:80 ${NGINX}`, ms: `Kemudian run semula: docker run -d --name web -p 8080:80 ${NGINX}` },
    ],
    solution: ['docker stop old-web', `docker run -d --name web -p 8080:80 ${NGINX}`],
    success: { en: 'old-web is resting. web serves on hatch 8080.', ms: 'old-web dah berehat. web melayan di tingkap 8080.' },
    rescue: 'docker-port-allocated',
    docs: [
      { label: 'Docker: port publishing', url: 'https://docs.docker.com/engine/network/port-publishing/' },
      { label: 'docker container stop', url: 'https://docs.docker.com/reference/cli/docker/container/stop/' },
    ],
  },
  {
    id: 'no-phone-line',
    part: 'docker',
    kind: 'kitchen',
    scenario: 'ns-docker-no-name',
    level: 2,
    title: { en: 'api cannot find menu', ms: 'api tak jumpa menu' },
    alert: "wget: bad address 'menu'",
    story: {
      en: "The api box asks for the menu box by name. It gets: bad address 'menu'.",
      ms: "Bekas api panggil bekas menu ikut nama. Jawapannya: bad address 'menu'.",
    },
    task: {
      en: 'Give both boxes a phone line called kedai-net, so names work.',
      ms: 'Beri kedua-dua bekas talian telefon bernama kedai-net, supaya nama berfungsi.',
    },
    goal: { networkHas: { 'kedai-net': ['api', 'menu'] } },
    hints: [
      { en: 'See it fail: docker exec api wget -qO- menu', ms: 'Lihat ia gagal: docker exec api wget -qO- menu' },
      { en: 'The default network has no name lookup. Make one: docker network create kedai-net', ms: 'Rangkaian lalai tiada carian nama. Buat satu: docker network create kedai-net' },
      { en: 'Join both: docker network connect kedai-net menu, then the same for api.', ms: 'Sambung kedua-duanya: docker network connect kedai-net menu, kemudian sama untuk api.' },
    ],
    solution: ['docker network create kedai-net', 'docker network connect kedai-net menu', 'docker network connect kedai-net api'],
    success: { en: 'Same phone line, so api can call menu by name.', ms: 'Talian telefon yang sama, jadi api boleh panggil menu ikut nama.' },
    rescue: 'docker-name-not-found',
    docs: [
      { label: 'Docker: networking overview', url: 'https://docs.docker.com/engine/network/' },
      { label: 'docker network connect', url: 'https://docs.docker.com/reference/cli/docker/network/connect/' },
    ],
  },
  {
    id: 'quits-at-once',
    part: 'docker',
    kind: 'kitchen',
    scenario: 'ns-docker-quits',
    level: 1,
    title: { en: 'The timer box quits at once', ms: 'Bekas timer terus berhenti' },
    alert: 'timer   Exited (127)',
    story: {
      en: 'The timer box should wait for an hour. It stops the moment it starts.',
      ms: 'Bekas timer patut tunggu sejam. Ia berhenti sebaik sahaja bermula.',
    },
    task: {
      en: 'Find out why, then get a timer box running: alpine:3.22, sleep 3600.',
      ms: 'Cari sebabnya, kemudian jalankan bekas timer: alpine:3.22, sleep 3600.',
    },
    goal: { running: ['timer'] },
    hints: [
      { en: 'Ask the box what it said: docker logs timer', ms: 'Tanya bekas itu apa katanya: docker logs timer' },
      { en: 'A typo! Remove the box first: docker rm timer', ms: 'Salah ejaan! Buang bekas itu dulu: docker rm timer' },
      { en: 'Start it right: docker run -d --name timer alpine:3.22 sleep 3600', ms: 'Mulakan dengan betul: docker run -d --name timer alpine:3.22 sleep 3600' },
    ],
    solution: ['docker rm timer', 'docker run -d --name timer alpine:3.22 sleep 3600'],
    success: { en: 'The logs showed the typo. The timer now runs.', ms: 'Log tunjuk salah ejaan itu. Timer kini berjalan.' },
    rescue: 'docker-exits-right-away',
    docs: [
      { label: 'docker container logs', url: 'https://docs.docker.com/reference/cli/docker/container/logs/' },
      { label: 'docker container run', url: 'https://docs.docker.com/reference/cli/docker/container/run/' },
    ],
  },
  {
    id: 'kitchen-blackout',
    part: 'docker',
    kind: 'kitchen',
    scenario: 'ns-docker-incident-restart',
    level: 3,
    title: { en: 'Kitchen blackout', ms: 'Dapur gelap' },
    alert: 'curl: (56) Recv failure: Connection reset by peer',
    story: {
      en: 'The kitchen laptop restarted. Someone started the boxes again from memory. Now nothing works.',
      ms: 'Laptop dapur dihidupkan semula. Seseorang mulakan bekas-bekas itu ikut ingatan. Kini semuanya tak jalan.',
    },
    task: {
      en: 'Make localhost:8080 show the nginx page. Let api call web by name, on a network called kedai-net.',
      ms: 'Buat localhost:8080 tunjuk halaman nginx. Benarkan api panggil web ikut nama, pada rangkaian bernama kedai-net.',
    },
    goal: { running: ['web', 'api'], portMapped: { web: '8080:80' }, reachable: 'localhost:8080', networkHas: { 'kedai-net': ['api', 'web'] } },
    hints: [],
    problems: [
      {
        what: { en: "web's hatch led to port 8080 inside, but nginx listens on 80.", ms: 'Tingkap web menuju ke port 8080 di dalam, tapi nginx dengar pada port 80.' },
        fix: ['docker rm -f web', `docker run -d --name web -p 8080:80 ${NGINX}`],
      },
      {
        what: { en: 'api and web shared no network, so names did not work.', ms: 'api dan web tiada rangkaian yang sama, jadi nama tak berfungsi.' },
        fix: ['docker network create kedai-net', 'docker network connect kedai-net web', 'docker network connect kedai-net api'],
      },
    ],
    solution: ['docker rm -f web', `docker run -d --name web -p 8080:80 ${NGINX}`, 'docker network create kedai-net', 'docker network connect kedai-net web', 'docker network connect kedai-net api'],
    success: { en: 'The page is back, and api can call web by name.', ms: 'Halaman dah kembali, dan api boleh panggil web ikut nama.' },
    rootCause: {
      question: { en: 'Both faults came at once. What was the root cause?', ms: 'Kedua-dua masalah datang serentak. Apakah punca sebenarnya?' },
      options: [
        { en: 'nginx stopped listening on port 80', ms: 'nginx berhenti dengar pada port 80' },
        { en: 'The boxes were started by hand, from memory', ms: 'Bekas-bekas itu dimulakan dengan tangan, ikut ingatan' },
        { en: 'The laptop ran out of disk space', ms: 'Laptop itu kehabisan ruang cakera' },
      ],
      answer: 1,
      why: {
        en: 'Settings typed from memory get lost. A compose.yaml keeps ports and networks in one file.',
        ms: 'Tetapan yang ditaip ikut ingatan mudah hilang. compose.yaml simpan port dan rangkaian dalam satu fail.',
      },
    },
    rescue: 'docker-localhost-unreachable',
    docs: [
      { label: 'Docker: port publishing', url: 'https://docs.docker.com/engine/network/port-publishing/' },
      { label: 'Docker: networking overview', url: 'https://docs.docker.com/engine/network/' },
      { label: 'Docker Compose', url: 'https://docs.docker.com/compose/' },
    ],
  },
  {
    id: 'no-db-password',
    part: 'docker',
    kind: 'kitchen',
    scenario: 'ns-docker-no-password',
    level: 1,
    title: { en: 'The database box will not stay up', ms: 'Bekas pangkalan data tak mahu hidup' },
    alert: 'Error: Database is uninitialized and superuser password is not specified.',
    story: {
      en: 'The db box starts, then stops at once. The shop has no database tonight.',
      ms: 'Bekas db bermula, kemudian terus berhenti. Kedai tiada pangkalan data malam ini.',
    },
    task: {
      en: `Get db running from ${PG}, with a password and the pgdata locker.`,
      ms: `Jalankan db daripada ${PG}, dengan kata laluan dan loker pgdata.`,
    },
    goal: { running: ['db'], containerEnv: { db: ['POSTGRES_PASSWORD'] } },
    hints: [
      { en: 'Ask the box why: docker logs db', ms: 'Tanya bekas itu kenapa: docker logs db' },
      { en: 'Remove the stopped box, so the name is free: docker rm db', ms: 'Buang bekas yang berhenti, supaya nama itu bebas: docker rm db' },
      { en: `Add a password: docker run -d --name db -e POSTGRES_PASSWORD=devpass -v pgdata:/var/lib/postgresql ${PG}`, ms: `Tambah kata laluan: docker run -d --name db -e POSTGRES_PASSWORD=devpass -v pgdata:/var/lib/postgresql ${PG}` },
    ],
    solution: ['docker rm db', `docker run -d --name db -e POSTGRES_PASSWORD=devpass -v pgdata:/var/lib/postgresql ${PG}`],
    success: { en: 'The logs named the missing password. db is up.', ms: 'Log sebut kata laluan yang tiada. db dah hidup.' },
    rescue: 'docker-exits-right-away',
    docs: [
      { label: 'docker container logs', url: 'https://docs.docker.com/reference/cli/docker/container/logs/' },
      { label: 'docker container run: environment', url: 'https://docs.docker.com/reference/cli/docker/container/run/#env' },
    ],
  },
  {
    id: 'old-locker-path',
    part: 'docker',
    kind: 'kitchen',
    scenario: 'ns-docker-pg18-path',
    level: 2,
    title: { en: 'Postgres 18 refuses its locker', ms: 'Postgres 18 tolak lokernya' },
    alert: 'Error: in 18+, these Docker images are configured to store database data in a',
    story: {
      en: 'Someone moved db to Postgres 18 with the old run line. It stops at once.',
      ms: 'Seseorang pindahkan db ke Postgres 18 dengan arahan run lama. Ia terus berhenti.',
    },
    task: {
      en: 'Get db running, with the pgdata locker where Postgres 18 wants it.',
      ms: 'Jalankan db, dengan loker pgdata di tempat yang Postgres 18 mahu.',
    },
    goal: { running: ['db'], fileInVolume: { pgdata: '18/docker/PG_VERSION' } },
    hints: [
      { en: 'Read the whole message: docker logs db', ms: 'Baca mesej penuh: docker logs db' },
      { en: 'Postgres 18 wants the locker at /var/lib/postgresql, one level up.', ms: 'Postgres 18 mahu loker itu di /var/lib/postgresql, satu tingkat ke atas.' },
      { en: 'Remove db, then run it again with -v pgdata:/var/lib/postgresql.', ms: 'Buang db, kemudian run semula dengan -v pgdata:/var/lib/postgresql.' },
    ],
    solution: ['docker rm db', `docker run -d --name db -e POSTGRES_PASSWORD=devpass -v pgdata:/var/lib/postgresql ${PG}`],
    success: { en: 'The locker sits at /var/lib/postgresql. Postgres 18 is happy.', ms: 'Loker itu kini di /var/lib/postgresql. Postgres 18 gembira.' },
    rescue: 'docker-exits-right-away',
    docs: [
      { label: 'Docker: volumes', url: 'https://docs.docker.com/engine/storage/volumes/' },
      { label: 'docker container run', url: 'https://docs.docker.com/reference/cli/docker/container/run/' },
    ],
  },
  {
    id: 'read-only-web',
    part: 'docker',
    kind: 'kitchen',
    scenario: 'ns-docker-read-only',
    level: 2,
    title: { en: 'Locked down, and now it will not start', ms: 'Dikunci, kini ia tak mahu mula' },
    alert: 'nginx: [emerg] mkdir() "/var/cache/nginx/client_temp" failed (30: Read-only file system)',
    story: {
      en: 'Security asked for a read-only web box. Now nginx stops the moment it starts.',
      ms: 'Pasukan keselamatan minta bekas web baca sahaja. Kini nginx berhenti sebaik sahaja bermula.',
    },
    task: {
      en: 'Keep web read-only, on hatch 8080. Give nginx only the scratch folders it needs.',
      ms: 'Kekalkan web baca sahaja, pada tingkap 8080. Beri nginx hanya folder sementara yang ia perlu.',
    },
    goal: { running: ['web'], readOnly: ['web'], portMapped: { web: '8080:80' }, reachable: 'localhost:8080' },
    hints: [
      { en: 'See what nginx says: docker logs web', ms: 'Lihat apa kata nginx: docker logs web' },
      { en: 'nginx writes to /var/cache/nginx and /run. A tmpfs is a small scratch folder.', ms: 'nginx tulis ke /var/cache/nginx dan /run. tmpfs ialah folder sementara yang kecil.' },
      { en: 'Remove web, then add --tmpfs /var/cache/nginx --tmpfs /run to the run line.', ms: 'Buang web, kemudian tambah --tmpfs /var/cache/nginx --tmpfs /run pada arahan run.' },
    ],
    solution: ['docker rm web', `docker run -d --name web --read-only --tmpfs /var/cache/nginx --tmpfs /run -p 8080:80 ${NGINX}`],
    success: { en: 'Still read-only, with two scratch folders. nginx serves again.', ms: 'Masih baca sahaja, dengan dua folder sementara. nginx melayan semula.' },
    rescue: 'docker-exits-right-away',
    docs: [
      { label: 'Docker: tmpfs mounts', url: 'https://docs.docker.com/engine/storage/tmpfs/' },
      { label: 'docker container run', url: 'https://docs.docker.com/reference/cli/docker/container/run/' },
    ],
  },
  {
    id: 'env-file-spaces',
    part: 'docker',
    kind: 'kitchen',
    scenario: 'ns-docker-env-file',
    level: 2,
    title: { en: 'The env file is refused', ms: 'Fail env ditolak' },
    alert: "docker: --env-file: invalid env file (db.env): variable 'POSTGRES_PASSWORD ' contains whitespaces",
    story: {
      en: 'The db password lives in db.env. Every run with --env-file fails before db is made.',
      ms: 'Kata laluan db ada dalam db.env. Setiap run dengan --env-file gagal sebelum db dibuat.',
    },
    task: {
      en: `Fix db.env and keep the password devpass. Then run db from ${PG} with --env-file db.env.`,
      ms: `Baiki db.env dan kekalkan kata laluan devpass. Kemudian run db daripada ${PG} dengan --env-file db.env.`,
    },
    goal: { running: ['db'], containerEnv: { db: ['POSTGRES_PASSWORD=devpass'] } },
    hints: [
      { en: 'Look at the file: cat db.env', ms: 'Tengok fail itu: cat db.env' },
      { en: 'An env file wants NAME=value, with no spaces around the equals sign.', ms: 'Fail env mahu NAMA=nilai, tanpa ruang di sekeliling tanda sama dengan.' },
      { en: 'Write it again: echo "POSTGRES_PASSWORD=devpass" > db.env', ms: 'Tulis semula: echo "POSTGRES_PASSWORD=devpass" > db.env' },
    ],
    solution: ['echo "POSTGRES_PASSWORD=devpass" > db.env', `docker run -d --name db --env-file db.env -v pgdata:/var/lib/postgresql ${PG}`],
    success: { en: 'No spaces, so Docker reads the password. db is up.', ms: 'Tiada ruang, jadi Docker baca kata laluan itu. db dah hidup.' },
    rescue: 'docker-exits-right-away',
    docs: [
      { label: 'docker container run: env file', url: 'https://docs.docker.com/reference/cli/docker/container/run/#env' },
      { label: 'Docker: environment variables', url: 'https://docs.docker.com/compose/how-tos/environment-variables/' },
    ],
  },
  {
    id: 'night-script',
    part: 'docker',
    kind: 'kitchen',
    scenario: 'ns-docker-incident-night-script',
    level: 3,
    title: { en: 'The 2 a.m. script', ms: 'Skrip pukul 2 pagi' },
    alert: 'Bind for 0.0.0.0:8080 failed: port is already allocated',
    story: {
      en: 'A new night script ran at 2 a.m. It stopped at web with this error. db is down too.',
      ms: 'Skrip malam baharu berjalan pukul 2 pagi. Ia berhenti di web dengan ralat ini. db pun mati.',
    },
    task: {
      en: `Serve web on hatch 8080, from ${NGINX}. Run db with a password. web-test was only a test.`,
      ms: `Layan web pada tingkap 8080, daripada ${NGINX}. Jalankan db dengan kata laluan. web-test cuma ujian.`,
    },
    goal: { running: ['web', 'db'], portMapped: { web: '8080:80' }, reachable: 'localhost:8080', containerEnv: { db: ['POSTGRES_PASSWORD'] } },
    hints: [],
    problems: [
      {
        what: { en: "Yesterday's web-test box still held hatch 8080.", ms: 'Bekas web-test semalam masih pegang tingkap 8080.' },
        fix: ['docker stop web-test', `docker run -d --name web -p 8080:80 ${NGINX}`],
      },
      {
        what: { en: 'The script started db without POSTGRES_PASSWORD, so Postgres stopped.', ms: 'Skrip itu mulakan db tanpa POSTGRES_PASSWORD, jadi Postgres berhenti.' },
        fix: ['docker rm db', `docker run -d --name db -e POSTGRES_PASSWORD=devpass -v pgdata:/var/lib/postgresql ${PG}`],
      },
    ],
    solution: ['docker stop web-test', `docker run -d --name web -p 8080:80 ${NGINX}`, 'docker rm db', `docker run -d --name db -e POSTGRES_PASSWORD=devpass -v pgdata:/var/lib/postgresql ${PG}`],
    success: { en: 'web serves on 8080, and db has its password.', ms: 'web melayan di 8080, dan db ada kata laluannya.' },
    rootCause: {
      question: { en: 'Both faults came from one place. What was the root cause?', ms: 'Kedua-dua masalah datang dari satu tempat. Apakah punca sebenarnya?' },
      options: [
        { en: 'Postgres 18 does not run at night', ms: 'Postgres 18 tak boleh jalan waktu malam' },
        { en: 'The new script was never tried before the night shift', ms: 'Skrip baharu itu tak pernah dicuba sebelum syif malam' },
        { en: 'Docker Hub was down at 2 a.m.', ms: 'Docker Hub tutup pukul 2 pagi' },
      ],
      answer: 1,
      why: {
        en: 'One test run in the day shows both errors. Try a new script before you trust it.',
        ms: 'Satu cubaan pada waktu siang tunjuk kedua-dua ralat. Cuba skrip baharu sebelum anda percaya.',
      },
    },
    rescue: 'docker-port-allocated',
    docs: [
      { label: 'Docker: port publishing', url: 'https://docs.docker.com/engine/network/port-publishing/' },
      { label: 'docker container run: environment', url: 'https://docs.docker.com/reference/cli/docker/container/run/#env' },
    ],
  },
  {
    id: 'old-menu-after-pull',
    part: 'docker',
    kind: 'kitchen',
    scenario: 'ns-docker-incident-pull',
    level: 3,
    title: { en: 'Old menu after the pull', ms: 'Menu lama selepas pull' },
    alert: 'error while interpolating services.db.environment.POSTGRES_PASSWORD: required variable DB_PASSWORD is missing a value: add DB_PASSWORD to .env',
    story: {
      en: 'You ran git pull in kedai-kancil. Now docker compose up fails. The new menu must go live tonight.',
      ms: 'Anda jalankan git pull dalam kedai-kancil. Kini docker compose up gagal. Menu baharu mesti keluar malam ini.',
    },
    task: {
      en: 'Start the whole shop with Compose. localhost:8080 must show the new menu. Use the password devpass.',
      ms: 'Mulakan seluruh kedai dengan Compose. localhost:8080 mesti tunjuk menu baharu. Guna kata laluan devpass.',
    },
    goal: { composeUp: 'kedai-kancil', reachableContains: { 'localhost:8080': 'new menu' } },
    hints: [],
    problems: [
      {
        what: { en: 'The pull moved the db password to .env, but this laptop had no .env.', ms: 'Pull itu pindahkan kata laluan db ke .env, tapi laptop ini tiada .env.' },
        fix: ['echo "DB_PASSWORD=devpass" > .env', 'docker compose up -d'],
      },
      {
        what: { en: 'up -d reused the old web image. The new page needed a rebuild (--build).', ms: 'up -d guna semula image web lama. Halaman baharu perlukan bina semula (--build).' },
        fix: ['docker compose up -d --build'],
      },
    ],
    solution: ['echo "DB_PASSWORD=devpass" > .env', 'docker compose up -d', 'docker compose up -d --build'],
    success: { en: 'The shop is up, and the new menu is live.', ms: 'Kedai dah hidup, dan menu baharu dah keluar.' },
    rootCause: {
      question: { en: 'Both faults came with one change. What was the root cause?', ms: 'Kedua-dua masalah datang dengan satu perubahan. Apakah punca sebenarnya?' },
      options: [
        { en: 'nginx keeps old pages in its memory', ms: 'nginx simpan halaman lama dalam memorinya' },
        { en: 'Compose forgot the password by itself', ms: 'Compose lupa kata laluan itu sendiri' },
        { en: 'The pull needed new steps, and the restart skipped them', ms: 'Pull itu perlukan langkah baharu, dan restart tadi langkau langkah itu' },
      ],
      answer: 2,
      why: {
        en: 'New code can need a new .env and a rebuild. Read what changed, then run up -d --build.',
        ms: 'Kod baharu mungkin perlukan .env baharu dan bina semula. Baca apa yang berubah, kemudian jalankan up -d --build.',
      },
    },
    rescue: 'docker-exits-right-away',
    docs: [
      { label: 'Compose: variable interpolation', url: 'https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/' },
      { label: 'docker compose up', url: 'https://docs.docker.com/reference/cli/docker/compose/up/' },
    ],
  },
  {
    id: 'hardening-night',
    part: 'docker',
    kind: 'kitchen',
    scenario: 'ns-docker-incident-hardening',
    level: 3,
    title: { en: 'Lock-down night', ms: 'Malam semua dikunci' },
    alert: 'nginx: [emerg] chown("/var/cache/nginx/client_temp", 101) failed (1: Operation not permitted)',
    story: {
      en: 'Tonight both nginx boxes were locked down at once. Now web and menu both stop at start.',
      ms: 'Malam ini kedua-dua bekas nginx dikunci serentak. Kini web dan menu berhenti sebaik bermula.',
    },
    task: {
      en: 'Keep web read-only, and keep --cap-drop ALL on menu. Add only what nginx needs. Serve on 8080 and 8081.',
      ms: 'Kekalkan web baca sahaja, dan kekalkan --cap-drop ALL pada menu. Tambah hanya apa yang nginx perlu. Layan pada 8080 dan 8081.',
    },
    goal: { running: ['web', 'menu'], readOnly: ['web'], reachable: ['localhost:8080', 'localhost:8081'] },
    hints: [],
    problems: [
      {
        what: { en: 'web was read-only, so nginx could not make its cache folder.', ms: 'web baca sahaja, jadi nginx tak dapat buat folder cache.' },
        fix: ['docker rm web', `docker run -d --name web --read-only --tmpfs /var/cache/nginx --tmpfs /run -p 8080:80 ${NGINX}`],
      },
      {
        what: { en: 'menu had no capabilities, so nginx could not chown or switch users.', ms: 'menu tiada capability, jadi nginx tak dapat chown atau tukar pengguna.' },
        fix: ['docker rm menu', `docker run -d --name menu --cap-drop ALL --cap-add CHOWN --cap-add SETGID --cap-add SETUID -p 8081:80 ${NGINX}`],
      },
    ],
    solution: [
      'docker rm web',
      `docker run -d --name web --read-only --tmpfs /var/cache/nginx --tmpfs /run -p 8080:80 ${NGINX}`,
      'docker rm menu',
      `docker run -d --name menu --cap-drop ALL --cap-add CHOWN --cap-add SETGID --cap-add SETUID -p 8081:80 ${NGINX}`,
    ],
    success: { en: 'Both boxes stay locked, and both serve again.', ms: 'Kedua-dua bekas kekal dikunci, dan kedua-duanya melayan semula.' },
    rootCause: {
      question: { en: 'Both boxes broke on the same night. What was the root cause?', ms: 'Kedua-dua bekas rosak pada malam yang sama. Apakah punca sebenarnya?' },
      options: [
        { en: 'Locking boxes down is bad, so undo it', ms: 'Mengunci bekas itu buruk, jadi buang sahaja' },
        { en: 'Both locks went live at once, with no test run first', ms: 'Kedua-dua kunci dipasang serentak, tanpa cubaan dulu' },
        { en: 'nginx 1.30 has a bug in its cache folder', ms: 'nginx 1.30 ada pepijat pada folder cache' },
      ],
      answer: 1,
      why: {
        en: 'Locks are good. Add one at a time, run the box, and read its logs.',
        ms: 'Kunci itu bagus. Tambah satu demi satu, jalankan bekas, dan baca lognya.',
      },
    },
    rescue: 'docker-exits-right-away',
    docs: [
      { label: 'Docker: tmpfs mounts', url: 'https://docs.docker.com/engine/storage/tmpfs/' },
      { label: 'Docker: Linux capabilities', url: 'https://docs.docker.com/engine/containers/run/#runtime-privilege-and-linux-capabilities' },
      { label: 'Docker Engine security', url: 'https://docs.docker.com/engine/security/' },
    ],
  },
  {
    id: 'new-laptop',
    part: 'docker',
    kind: 'kitchen',
    scenario: 'ns-docker-incident-new-laptop',
    level: 3,
    title: { en: 'Moved to a new laptop', ms: 'Pindah ke laptop baharu' },
    alert: "ping: bad address 'db'",
    story: {
      en: 'The shop moved to a new laptop tonight. Its compose.yaml stayed behind, so every box was typed again.',
      ms: 'Kedai pindah ke laptop baharu malam ini. compose.yaml tertinggal, jadi setiap bekas ditaip semula.',
    },
    task: {
      en: 'localhost:8080 shows the nginx page. db runs with a password. api reaches db by name on kedai-net.',
      ms: 'localhost:8080 tunjuk halaman nginx. db berjalan dengan kata laluan. api sampai ke db ikut nama pada kedai-net.',
    },
    goal: {
      running: ['web', 'api', 'db'],
      portMapped: { web: '8080:80' },
      reachable: 'localhost:8080',
      containerEnv: { db: ['POSTGRES_PASSWORD'] },
      networkHas: { 'kedai-net': ['api', 'db'] },
    },
    hints: [],
    problems: [
      {
        what: { en: "web's hatch led to 8080 inside, but nginx listens on 80.", ms: 'Tingkap web menuju ke 8080 di dalam, tapi nginx dengar pada 80.' },
        fix: ['docker rm -f web', `docker run -d --name web -p 8080:80 ${NGINX}`],
      },
      {
        what: { en: 'db had no POSTGRES_PASSWORD, so Postgres stopped at once.', ms: 'db tiada POSTGRES_PASSWORD, jadi Postgres terus berhenti.' },
        fix: ['docker rm db', `docker run -d --name db -e POSTGRES_PASSWORD=devpass -v pgdata:/var/lib/postgresql ${PG}`],
      },
      {
        what: { en: 'api and db shared no network, so the name db meant nothing.', ms: 'api dan db tiada rangkaian yang sama, jadi nama db tak bermakna.' },
        fix: ['docker network create kedai-net', 'docker network connect kedai-net db', 'docker network connect kedai-net api'],
      },
    ],
    solution: [
      'docker rm -f web',
      `docker run -d --name web -p 8080:80 ${NGINX}`,
      'docker rm db',
      `docker run -d --name db -e POSTGRES_PASSWORD=devpass -v pgdata:/var/lib/postgresql ${PG}`,
      'docker network create kedai-net',
      'docker network connect kedai-net db',
      'docker network connect kedai-net api',
    ],
    success: { en: 'Page, password and phone line are back.', ms: 'Halaman, kata laluan dan talian telefon dah kembali.' },
    rootCause: {
      question: { en: 'Three faults at once. What was the root cause?', ms: 'Tiga masalah serentak. Apakah punca sebenarnya?' },
      options: [
        { en: 'The new laptop is too slow for three boxes', ms: 'Laptop baharu terlalu perlahan untuk tiga bekas' },
        { en: 'The setup lived in a file that did not move', ms: 'Tetapan itu ada dalam fail yang tak ikut pindah' },
        { en: 'Docker 29 removed the default network', ms: 'Docker 29 buang rangkaian lalai' },
      ],
      answer: 1,
      why: {
        en: 'compose.yaml holds ports, passwords and networks. Keep it in Git, and it moves with you.',
        ms: 'compose.yaml simpan port, kata laluan dan rangkaian. Simpan dalam Git, dan ia ikut anda.',
      },
    },
    rescue: 'docker-name-not-found',
    docs: [
      { label: 'Docker: networking overview', url: 'https://docs.docker.com/engine/network/' },
      { label: 'Docker: port publishing', url: 'https://docs.docker.com/engine/network/port-publishing/' },
      { label: 'Docker Compose', url: 'https://docs.docker.com/compose/' },
    ],
  },

  // ---------------------------------------------------------------- CI/CD (ConveyorBelt)
  {
    id: 'belt-never-started',
    part: 'cicd',
    kind: 'conveyor',
    scenario: 'ns-ci-not-triggered',
    event: 'push-main',
    level: 1,
    title: { en: 'The belt never started', ms: 'Tali sawat tak pernah bermula' },
    story: {
      en: 'You pushed to main. No run appeared at all.',
      ms: 'Anda push ke main. Tiada run langsung yang muncul.',
    },
    task: {
      en: 'Fix line 4 so a push to main starts the belt.',
      ms: 'Baiki baris 4 supaya push ke main mulakan tali sawat.',
    },
    fixes: [
      { label: 'branches: [main]', text: '    branches: [main]' },
      { label: 'branches: [master, develop]', text: '    branches: [master, develop]', why: { en: 'Your branch is called main.', ms: 'Branch anda bernama main.' } },
      { label: "branches: ['*']", text: "    branches: ['*']", correct: false, why: { en: 'It runs, but on every branch. Ask only for main.', ms: 'Ia berjalan, tapi pada setiap branch. Minta main sahaja.' } },
    ],
    forbid: ['branches:.*\\*'],
    solution: '    branches: [main]',
    success: { en: 'The filter says main now. The belt starts.', ms: 'Penapis kini sebut main. Tali sawat bermula.' },
    rescue: 'ci-workflow-not-triggered',
    docs: [
      { label: 'Events that trigger workflows', url: 'https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows' },
      { label: 'Workflow syntax', url: 'https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax' },
    ],
  },
  {
    id: 'ghcr-denied',
    part: 'cicd',
    kind: 'conveyor',
    scenario: 'c2-fix-permissions',
    event: 'push-main',
    level: 1,
    title: { en: 'The push to GHCR is refused', ms: 'Push ke GHCR ditolak' },
    story: {
      en: 'The belt builds the image, then the push stops with permission_denied.',
      ms: 'Tali sawat bina image, kemudian push berhenti dengan permission_denied.',
    },
    task: {
      en: 'Give the token only the key it needs (lines 5–6).',
      ms: 'Beri token hanya kunci yang ia perlu (baris 5–6).',
    },
    fixes: [
      { label: 'contents: write', text: 'permissions:\n  contents: write', why: { en: 'Writing code is not writing packages.', ms: 'Tulis kod bukan sama dengan tulis package.' } },
      { label: 'write-all', text: 'permissions: write-all', correct: false, why: { en: 'Every step would get every key.', ms: 'Setiap langkah akan dapat semua kunci.' } },
      { label: 'contents: read, packages: write', text: 'permissions:\n  contents: read\n  packages: write' },
    ],
    forbid: ['write-all'],
    solution: 'permissions:\n  contents: read\n  packages: write',
    success: { en: 'packages: write, and nothing more. The image is on GHCR.', ms: 'packages: write, dan tiada lagi. Image dah ada di GHCR.' },
    rescue: 'ci-ghcr-push-denied',
    docs: [
      { label: 'GITHUB_TOKEN', url: 'https://docs.github.com/en/actions/concepts/security/github_token' },
      { label: 'Publishing Docker images', url: 'https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images' },
    ],
  },
  {
    id: 'release-refused',
    part: 'cicd',
    kind: 'conveyor',
    scenario: 'c4-release-perms',
    event: 'tag',
    level: 2,
    title: { en: 'The release step is refused', ms: 'Langkah release ditolak' },
    alert: 'Resource not accessible by integration',
    story: {
      en: 'You pushed tag v1.4.0. The last step says: Resource not accessible by integration.',
      ms: 'Anda push tag v1.4.0. Langkah terakhir kata: Resource not accessible by integration.',
    },
    task: {
      en: 'Let this job make a release, and nothing more (lines 5–6).',
      ms: 'Benarkan job ini buat release, dan tiada lagi (baris 5–6).',
    },
    fixes: [
      { label: 'contents: write', text: 'permissions:\n  contents: write' },
      { label: 'packages: write', text: 'permissions:\n  packages: write', why: { en: 'A release lives with the code, under contents.', ms: 'Release tinggal bersama kod, di bawah contents.' } },
      { label: 'write-all', text: 'permissions: write-all', correct: false, why: { en: 'Every step would get every key.', ms: 'Setiap langkah akan dapat semua kunci.' } },
    ],
    forbid: ['write-all'],
    solution: 'permissions:\n  contents: write',
    success: { en: 'contents: write lets the job publish v1.4.0.', ms: 'contents: write benarkan job itu terbitkan v1.4.0.' },
    rescue: 'ci-resource-not-accessible',
    docs: [
      { label: 'GITHUB_TOKEN', url: 'https://docs.github.com/en/actions/concepts/security/github_token' },
      { label: 'About releases', url: 'https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases' },
    ],
  },
  {
    id: 'ghcr-no-login',
    part: 'cicd',
    kind: 'conveyor',
    scenario: 'ns-ci-no-login',
    event: 'push-main',
    level: 1,
    title: { en: 'The push to GHCR has no login', ms: 'Push ke GHCR tanpa log masuk' },
    alert: 'ERROR: failed to push ghcr.io/you/kedai-kancil:3f9c2a7e1b4d8c6f0a5e9d2b7c4f1a8e6d3b0c95: unauthorized: authentication required',
    story: {
      en: 'The job may write packages. Still, every push to GHCR ends with unauthorized.',
      ms: 'Job itu boleh tulis package. Tapi setiap push ke GHCR berakhir dengan unauthorized.',
    },
    task: {
      en: 'Log in to GHCR after line 12, before the build pushes.',
      ms: 'Log masuk ke GHCR selepas baris 12, sebelum bina itu push.',
    },
    fixes: [
      {
        label: 'login-action without registry',
        text: ghcrLogin('secrets.GITHUB_TOKEN', false),
        why: { en: 'No registry means Docker Hub. Name ghcr.io.', ms: 'Tanpa registry bermaksud Docker Hub. Sebut ghcr.io.' },
      },
      { label: 'login-action, registry: ghcr.io, GITHUB_TOKEN', text: ghcrLogin('secrets.GITHUB_TOKEN') },
      {
        label: 'login-action, registry: ghcr.io, GHCR_PASSWORD',
        text: ghcrLogin('secrets.GHCR_PASSWORD'),
        why: { en: 'This repo has no such secret. The built-in token is enough.', ms: 'Repo ini tiada secret itu. Token terbina dalam sudah cukup.' },
      },
    ],
    solution: ghcrLogin('secrets.GITHUB_TOKEN'),
    success: { en: 'Logged in with the built-in token. The image is on GHCR.', ms: 'Log masuk dengan token terbina dalam. Image dah ada di GHCR.' },
    rescue: 'ci-ghcr-push-denied',
    docs: [
      { label: 'Publishing Docker images', url: 'https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images' },
      { label: 'GITHUB_TOKEN', url: 'https://docs.github.com/en/actions/concepts/security/github_token' },
    ],
  },
  {
    id: 'gh-needs-token',
    part: 'cicd',
    kind: 'conveyor',
    scenario: 'ns-ci-gh-token',
    event: 'tag',
    level: 1,
    title: { en: 'gh cannot find its token', ms: 'gh tak jumpa tokennya' },
    alert: 'gh: To use GitHub CLI in a GitHub Actions workflow, set the GH_TOKEN environment variable. Example:',
    story: {
      en: 'You pushed tag v1.5.0. The job may write, yet the release step stops at once.',
      ms: 'Anda push tag v1.5.0. Job itu boleh menulis, tapi langkah release terus berhenti.',
    },
    task: {
      en: 'Hand the built-in token to gh on line 12.',
      ms: 'Serahkan token terbina dalam kepada gh pada baris 12.',
    },
    fixes: [
      {
        label: 'env: GH_TOKEN: ${{ github.token }}',
        text: '      - run: gh release create "$GITHUB_REF_NAME" --generate-notes\n        env:\n          GH_TOKEN: ${{ github.token }}',
      },
      {
        label: 'env: GH_TOKEN: ${{ secrets.MY_PAT }}',
        text: '      - run: gh release create "$GITHUB_REF_NAME" --generate-notes\n        env:\n          GH_TOKEN: ${{ secrets.MY_PAT }}',
        why: { en: 'This repo has no such secret. The built-in token is enough.', ms: 'Repo ini tiada secret itu. Token terbina dalam sudah cukup.' },
      },
    ],
    solution: '      - run: gh release create "$GITHUB_REF_NAME" --generate-notes\n        env:\n          GH_TOKEN: ${{ github.token }}',
    success: { en: 'gh has the token now. Release v1.5.0 is out.', ms: 'gh kini ada token itu. Release v1.5.0 dah keluar.' },
    rescue: 'ci-resource-not-accessible',
    docs: [
      { label: 'GITHUB_TOKEN', url: 'https://docs.github.com/en/actions/concepts/security/github_token' },
      { label: 'Workflow syntax', url: 'https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax' },
    ],
  },
  {
    id: 'no-test-database',
    part: 'cicd',
    kind: 'conveyor',
    scenario: 'ns-ci-no-db',
    event: 'pr',
    level: 2,
    title: { en: 'Green on laptops, red on the runner', ms: 'Hijau di laptop, merah di runner' },
    alert: 'Error: connect ECONNREFUSED 127.0.0.1:5432',
    story: {
      en: 'The order tests pass on every laptop. On the runner, they fail on every pull request.',
      ms: 'Ujian pesanan lulus di setiap laptop. Di runner, ia gagal pada setiap pull request.',
    },
    task: {
      en: 'Give the job its own Postgres on port 5432 (line 8). The password is test.',
      ms: 'Beri job itu Postgres sendiri pada port 5432 (baris 8). Kata laluannya test.',
    },
    fixes: [
      {
        label: 'runs-on: ubuntu-24.04',
        text: '    runs-on: ubuntu-24.04',
        why: { en: 'A newer runner still has no database running.', ms: 'Runner yang lebih baharu pun tiada pangkalan data berjalan.' },
      },
      { label: 'services: postgres', text: TEST_DB },
      {
        label: 'services: redis',
        text: '    runs-on: ubuntu-latest\n    services:\n      cache:\n        image: redis:8-alpine\n        ports:\n          - 6379:6379',
        why: { en: 'The tests call Postgres on 5432, not Redis.', ms: 'Ujian itu panggil Postgres pada 5432, bukan Redis.' },
      },
    ],
    solution: TEST_DB,
    success: { en: 'A fresh Postgres in every job. The tests pass on the runner too.', ms: 'Postgres baharu dalam setiap job. Ujian lulus di runner juga.' },
    rescue: 'ci-flaky-test',
    docs: [
      { label: 'Creating PostgreSQL service containers', url: 'https://docs.github.com/en/actions/tutorials/use-containerized-services/create-postgresql-service-containers' },
      { label: 'Docker service containers', url: 'https://docs.github.com/en/actions/tutorials/use-containerized-services/use-docker-service-containers' },
    ],
  },
  {
    id: 'attestation-refused',
    part: 'cicd',
    kind: 'conveyor',
    scenario: 'ns-ci-attest',
    event: 'push-main',
    level: 2,
    title: { en: 'The attestation step stops', ms: 'Langkah attestation berhenti' },
    alert: 'Error: Unable to get ACTIONS_ID_TOKEN_REQUEST_URL env variable',
    story: {
      en: 'The image reaches GHCR. Then the new attestation step stops the belt.',
      ms: 'Image sampai ke GHCR. Kemudian langkah attestation baharu hentikan tali sawat.',
    },
    task: {
      en: 'Give the job just the keys an attestation needs (lines 8–10).',
      ms: 'Beri job itu kunci yang attestation perlu sahaja (baris 8–10).',
    },
    fixes: [
      {
        label: '+ id-token: write',
        text: '    permissions:\n      contents: read\n      packages: write\n      id-token: write',
        why: { en: 'Almost! It also needs attestations: write to save the proof.', ms: 'Hampir! Ia juga perlu attestations: write untuk simpan bukti itu.' },
      },
      { label: 'write-all', text: '    permissions: write-all', correct: false, why: { en: 'Every step would get every key.', ms: 'Setiap langkah akan dapat semua kunci.' } },
      { label: '+ id-token: write, attestations: write', text: '    permissions:\n      contents: read\n      packages: write\n      id-token: write\n      attestations: write' },
    ],
    forbid: ['write-all'],
    solution: '    permissions:\n      contents: read\n      packages: write\n      id-token: write\n      attestations: write',
    success: { en: 'Two small keys more. The image now carries its proof.', ms: 'Dua kunci kecil lagi. Image itu kini bawa buktinya.' },
    rescue: 'ci-resource-not-accessible',
    docs: [
      { label: 'Artifact attestations', url: 'https://docs.github.com/en/actions/concepts/security/artifact-attestations' },
      { label: 'Use artifact attestations', url: 'https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations' },
    ],
  },
  {
    id: 'pr-comment-refused',
    part: 'cicd',
    kind: 'conveyor',
    scenario: 'ns-ci-pr-comment',
    event: 'pr',
    level: 2,
    title: { en: 'The pull request comment is refused', ms: 'Komen pada pull request ditolak' },
    alert: 'HTTP 403: Resource not accessible by integration (https://api.github.com/repos/you/kedai-kancil/issues/7/comments)',
    story: {
      en: 'The tests pass on every pull request. Then the last step cannot leave its comment.',
      ms: 'Ujian lulus pada setiap pull request. Kemudian langkah terakhir tak dapat tinggalkan komen.',
    },
    task: {
      en: 'Let the job comment on pull requests, and nothing more (lines 4–5).',
      ms: 'Benarkan job itu komen pada pull request, dan tiada lagi (baris 4–5).',
    },
    fixes: [
      { label: 'contents: write', text: 'permissions:\n  contents: write', why: { en: 'A comment is not code. It lives under pull-requests.', ms: 'Komen bukan kod. Ia di bawah pull-requests.' } },
      { label: 'contents: read, pull-requests: write', text: 'permissions:\n  contents: read\n  pull-requests: write' },
      { label: 'write-all', text: 'permissions: write-all', correct: false, why: { en: 'Every step would get every key.', ms: 'Setiap langkah akan dapat semua kunci.' } },
    ],
    forbid: ['write-all'],
    solution: 'permissions:\n  contents: read\n  pull-requests: write',
    success: { en: 'pull-requests: write, and the comment lands.', ms: 'pull-requests: write, dan komen itu sampai.' },
    rescue: 'ci-resource-not-accessible',
    docs: [
      { label: 'GITHUB_TOKEN', url: 'https://docs.github.com/en/actions/concepts/security/github_token' },
      { label: 'Workflow syntax: permissions', url: 'https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#permissions' },
    ],
  },
  {
    id: 'build-timed-out',
    part: 'cicd',
    kind: 'conveyor',
    scenario: 'ns-ci-timeout',
    event: 'push-main',
    level: 2,
    title: { en: 'The image build is cut off', ms: 'Bina image terhenti di tengah jalan' },
    alert: 'The job running on runner GitHub Actions 2 has exceeded the maximum execution time of 1 minutes.',
    story: {
      en: 'Someone set a short time limit to save minutes. Now every image build is cancelled.',
      ms: 'Seseorang letak had masa pendek untuk jimat minit. Kini setiap bina image dibatalkan.',
    },
    task: {
      en: 'Give the job a sane limit on line 10. The build needs more than 2 minutes.',
      ms: 'Beri job itu had yang munasabah pada baris 10. Bina itu perlu lebih 2 minit.',
    },
    fixes: [
      { label: 'timeout-minutes: 2', text: '    timeout-minutes: 2', why: { en: 'Still too tight. The build needs more than 2 minutes.', ms: 'Masih terlalu ketat. Bina itu perlu lebih 2 minit.' } },
      { label: 'timeout-minutes: 15', text: '    timeout-minutes: 15' },
      { label: 'timeout-minutes: 360', text: '    timeout-minutes: 360', correct: false, why: { en: '360 is the default. A stuck job could burn six hours.', ms: '360 ialah nilai lalai. Job yang tersekat boleh bakar enam jam.' } },
    ],
    forbid: ['timeout-minutes:\\s*360'],
    solution: '    timeout-minutes: 15',
    success: { en: 'Room to build, and still a guard if a step hangs.', ms: 'Ada ruang untuk bina, dan masih ada pengawal jika langkah tersekat.' },
    rescue: 'ci-pipeline-slow',
    docs: [{ label: 'Workflow syntax: timeout-minutes', url: 'https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax' }],
  },

  // ---------------------------------------------------------------- Kubernetes (FoodCourtSim)
  {
    id: 'crash-loop',
    part: 'kubernetes',
    kind: 'kube',
    scenario: 'ns-k8s-crashloop',
    level: 1,
    title: { en: 'Version 2 keeps crashing', ms: 'Versi 2 asyik crash' },
    alert: 'shop-655f8cb4b9-hd4bf   0/1   CrashLoopBackOff',
    story: {
      en: 'Someone shipped version 2 of the shop. Its new tray crashes again and again.',
      ms: 'Seseorang hantar versi 2 kedai. Dulang barunya crash berulang kali.',
    },
    task: {
      en: 'Go back to the version that worked. Then 3 trays serve, with no crash.',
      ms: 'Kembali ke versi yang berfungsi. Kemudian 3 dulang melayan, tanpa crash.',
    },
    goal: { rolloutComplete: { name: 'shop' }, podsReady: { selector: 'app=shop', count: 3, exact: true }, noPodStatus: { selector: 'app=shop', status: 'CrashLoopBackOff' } },
    hints: [
      { en: 'Look first: kubectl get pods', ms: 'Lihat dulu: kubectl get pods' },
      { en: 'Each change is a revision: kubectl rollout history deployment/shop', ms: 'Setiap perubahan ialah revision: kubectl rollout history deployment/shop' },
      { en: 'Go back one: kubectl rollout undo deployment/shop', ms: 'Undur satu: kubectl rollout undo deployment/shop' },
    ],
    solution: ['kubectl rollout undo deployment/shop'],
    success: { en: 'Back on the old recipe. Three trays, no crash.', ms: 'Kembali ke resepi lama. Tiga dulang, tiada crash.' },
    rescue: 'k8s-crashloop',
    docs: [
      { label: 'kubectl rollout undo', url: 'https://kubernetes.io/docs/reference/kubectl/generated/kubectl_rollout/kubectl_rollout_undo/' },
      { label: 'Debug pods', url: 'https://kubernetes.io/docs/tasks/debug/debug-application/debug-pods/' },
    ],
  },
  {
    id: 'image-typo',
    part: 'kubernetes',
    kind: 'kube',
    scenario: 'ns-k8s-imagepull',
    level: 1,
    title: { en: 'The new tray has no meal pack', ms: 'Dulang baharu tiada pek makanan' },
    alert: 'shop-5b97784975-m5nrm   0/1   ImagePullBackOff',
    story: {
      en: 'An update asked for nginx:1.299. That tag does not exist, so the pull fails.',
      ms: 'Satu kemas kini minta nginx:1.299. Tag itu tiada, jadi pull gagal.',
    },
    task: {
      en: 'Point container web back at nginx:1.29-alpine and finish the rollout.',
      ms: 'Tukar container web kembali ke nginx:1.29-alpine dan siapkan rollout.',
    },
    goal: { rolloutComplete: { name: 'shop' }, deploymentImage: { name: 'shop', image: 'nginx:1.29-alpine' } },
    hints: [
      { en: 'Find the stuck tray: kubectl get pods', ms: 'Cari dulang yang tersekat: kubectl get pods' },
      { en: 'Its events name the image: kubectl describe pod <name>', ms: 'Event pod itu sebut image: kubectl describe pod <name>' },
      { en: 'Fix the tag: kubectl set image deployment/shop web=nginx:1.29-alpine', ms: 'Baiki tag itu: kubectl set image deployment/shop web=nginx:1.29-alpine' },
    ],
    solution: ['kubectl set image deployment/shop web=nginx:1.29-alpine'],
    success: { en: 'Right tag, real meal pack. The rollout is done.', ms: 'Tag betul, pek makanan sebenar. Rollout dah siap.' },
    rescue: 'k8s-imagepull',
    docs: [
      { label: 'kubectl set image', url: 'https://kubernetes.io/docs/reference/kubectl/generated/kubectl_set/kubectl_set_image/' },
      { label: 'Debug pods', url: 'https://kubernetes.io/docs/tasks/debug/debug-application/debug-pods/' },
    ],
  },
  {
    id: 'no-endpoints',
    part: 'kubernetes',
    kind: 'kube',
    scenario: 'ns-k8s-no-endpoints',
    level: 2,
    title: { en: 'The order number reaches nobody', ms: 'Nombor pesanan tak sampai kepada sesiapa' },
    alert: "wget: can't connect to remote host (10.96.252.164): Connection refused",
    story: {
      en: 'Three shop trays are ready. Yet the shop Service has no endpoints.',
      ms: 'Tiga dulang shop dah sedia. Tapi Service shop tiada endpoint.',
    },
    task: {
      en: 'Make the Service pick the trays labelled app=shop.',
      ms: 'Buat Service itu pilih dulang berlabel app=shop.',
    },
    goal: { serviceEndpoints: { name: 'shop', count: 3 } },
    hints: [
      { en: 'Compare: kubectl describe service shop and kubectl get pods --show-labels', ms: 'Banding: kubectl describe service shop dan kubectl get pods --show-labels' },
      { en: 'The selector has a typo: app=shopp.', ms: 'Selector itu salah ejaan: app=shopp.' },
      {
        en: `Patch it: kubectl patch service shop -p '{"spec":{"selector":{"app":"shop"}}}'`,
        ms: `Patch ia: kubectl patch service shop -p '{"spec":{"selector":{"app":"shop"}}}'`,
      },
    ],
    solution: [`kubectl patch service shop -p '{"spec":{"selector":{"app":"shop"}}}'`],
    success: { en: 'The selector matches. The order number reaches 3 trays.', ms: 'Selector dah padan. Nombor pesanan sampai ke 3 dulang.' },
    rescue: 'k8s-no-endpoints',
    docs: [
      { label: 'Kubernetes: Service', url: 'https://kubernetes.io/docs/concepts/services-networking/service/' },
      { label: 'kubectl patch', url: 'https://kubernetes.io/docs/reference/kubectl/generated/kubectl_patch/' },
    ],
  },
  {
    id: 'stuck-pending',
    part: 'kubernetes',
    kind: 'kube',
    scenario: 'ns-k8s-pending',
    level: 2,
    title: { en: 'The soup pot waits forever', ms: 'Periuk sup tunggu tanpa henti' },
    alert: "0/3 nodes are available: 1 node(s) had untolerated taint(s), 2 node(s) didn't match Pod's node affinity/selector.",
    story: {
      en: 'The soup tray stays Pending. It only goes to a stall with the sign disk=ssd.',
      ms: 'Dulang sup kekal Pending. Ia cuma pergi ke gerai dengan papan disk=ssd.',
    },
    task: {
      en: 'Give the stall dev-worker that sign, so the soup gets a place.',
      ms: 'Beri gerai dev-worker papan itu, supaya sup dapat tempat.',
    },
    goal: { podsReady: { selector: 'app=soup', count: 1 } },
    hints: [
      { en: 'Ask why: kubectl describe pod -l app=soup', ms: 'Tanya kenapa: kubectl describe pod -l app=soup' },
      { en: 'See the signs: kubectl get nodes --show-labels', ms: 'Lihat papan-papan itu: kubectl get nodes --show-labels' },
      { en: 'Add the sign: kubectl label node dev-worker disk=ssd', ms: 'Tambah papan itu: kubectl label node dev-worker disk=ssd' },
    ],
    solution: ['kubectl label node dev-worker disk=ssd'],
    success: { en: 'dev-worker has the sign. The soup is served.', ms: 'dev-worker ada papan itu. Sup dah dihidang.' },
    rescue: 'k8s-pending',
    docs: [
      { label: 'Assign pods to nodes', url: 'https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/' },
      { label: 'kubectl label', url: 'https://kubernetes.io/docs/reference/kubectl/generated/kubectl_label/' },
    ],
  },
  {
    id: 'lunch-rush-outage',
    part: 'kubernetes',
    kind: 'kube',
    scenario: 'ns-k8s-incident-release',
    level: 3,
    title: { en: 'Lunch rush outage', ms: 'Kedai gelap waktu puncak' },
    alert: "wget: can't connect to remote host (10.96.100.130): Connection refused",
    story: {
      en: 'A release went out at noon. Now customers get no answer from the shop.',
      ms: 'Satu release keluar tengah hari tadi. Kini pelanggan tak dapat jawapan daripada kedai.',
    },
    task: {
      en: 'Pod client must reach http://shop again. The shop rollout must finish, with no tray stuck.',
      ms: 'Pod client mesti sampai ke http://shop semula. Rollout shop mesti siap, tanpa dulang yang tersekat.',
    },
    goal: {
      reachable: { url: 'http://shop', from: 'client' },
      serviceEndpoints: { name: 'shop', count: 3 },
      rolloutComplete: { name: 'shop' },
      noPodStatus: { selector: 'app=shop', status: 'ImagePullBackOff' },
    },
    hints: [],
    problems: [
      {
        what: { en: 'The new image tag nginx:1.299 does not exist, so the rollout was stuck.', ms: 'Tag image baharu nginx:1.299 tidak wujud, jadi rollout itu tersekat.' },
        fix: ['kubectl rollout undo deployment/shop'],
      },
      {
        what: { en: 'The Service asked for app=shop-v2, so it matched no tray.', ms: 'Service itu minta app=shop-v2, jadi ia tak padan dengan mana-mana dulang.' },
        fix: [`kubectl patch service shop -p '{"spec":{"selector":{"app":"shop"}}}'`],
      },
    ],
    solution: ['kubectl rollout undo deployment/shop', `kubectl patch service shop -p '{"spec":{"selector":{"app":"shop"}}}'`],
    success: { en: 'Three trays serve again behind the order number.', ms: 'Tiga dulang melayan semula di belakang nombor pesanan itu.' },
    rootCause: {
      question: { en: 'Both faults started at noon. What was the root cause?', ms: 'Kedua-dua masalah bermula tengah hari. Apakah punca sebenarnya?' },
      options: [
        { en: 'The stalls ran out of memory', ms: 'Gerai-gerai kehabisan memori' },
        { en: 'Kubernetes changed the Service by itself', ms: 'Kubernetes tukar Service itu sendiri' },
        { en: 'One release changed two things, and nobody checked it first', ms: 'Satu release tukar dua benda, dan tiada siapa semak dulu' },
      ],
      answer: 2,
      why: {
        en: 'One unchecked change broke two things. `kubectl diff` or a review would catch both.',
        ms: 'Satu perubahan tanpa semakan rosakkan dua benda. `kubectl diff` atau semakan rakan boleh tangkap kedua-duanya.',
      },
    },
    rescue: 'k8s-no-endpoints',
    docs: [
      { label: 'Kubernetes: Service', url: 'https://kubernetes.io/docs/concepts/services-networking/service/' },
      { label: 'kubectl rollout undo', url: 'https://kubernetes.io/docs/reference/kubectl/generated/kubectl_rollout/kubectl_rollout_undo/' },
      { label: 'kubectl diff', url: 'https://kubernetes.io/docs/reference/kubectl/generated/kubectl_diff/' },
    ],
  },
  {
    id: 'soup-out-of-memory',
    part: 'kubernetes',
    kind: 'kube',
    scenario: 'ns-k8s-oom',
    level: 1,
    title: { en: 'The soup pot keeps falling over', ms: 'Periuk sup asyik tumbang' },
    alert: 'soup-547fd97fb4-r8n7q   0/1   CrashLoopBackOff   3 (19s ago)   52s',
    story: {
      en: 'The soup tray restarts again and again. Its logs look fine.',
      ms: 'Dulang sup mula semula berulang kali. Lognya nampak okey.',
    },
    task: {
      en: 'Find out why, then give soup enough memory to stay up.',
      ms: 'Cari sebabnya, kemudian beri soup memori yang cukup untuk terus hidup.',
    },
    goal: {
      rolloutComplete: { name: 'soup', minRevision: 2 },
      podsReady: { selector: 'app=soup', count: 1 },
      noPodStatus: { selector: 'app=soup', status: 'CrashLoopBackOff' },
    },
    hints: [
      { en: 'Look closer: kubectl describe pod -l app=soup', ms: 'Lihat lebih dekat: kubectl describe pod -l app=soup' },
      { en: 'Last State says OOMKilled. The pot needs about 150 MB, and its cap is 100Mi.', ms: 'Last State kata OOMKilled. Periuk itu perlu kira-kira 150 MB, dan hadnya 100Mi.' },
      { en: 'Raise the cap: kubectl set resources deployment/soup --limits=memory=256Mi', ms: 'Naikkan had: kubectl set resources deployment/soup --limits=memory=256Mi' },
    ],
    solution: ['kubectl set resources deployment/soup --limits=memory=256Mi'],
    success: { en: 'Room to breathe. The soup tray stays up.', ms: 'Ada ruang bernafas. Dulang sup kekal hidup.' },
    rescue: 'k8s-oomkilled',
    docs: [
      { label: 'Resources for containers', url: 'https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/' },
      { label: 'kubectl set resources', url: 'https://kubernetes.io/docs/reference/kubectl/generated/kubectl_set/kubectl_set_resources/' },
    ],
  },
  {
    id: 'deploy-bot-forbidden',
    part: 'kubernetes',
    kind: 'kube',
    scenario: 'ns-k8s-bot-forbidden',
    level: 2,
    title: { en: 'The deploy bot is locked out', ms: 'Bot deploy terkunci di luar' },
    alert: 'Error from server (Forbidden): deployments "shop" is forbidden: User "system:serviceaccount:default:ci-bot" cannot patch resource "deployments" in API group "apps" in the namespace "default"',
    story: {
      en: 'After a tidy-up of old access rules, every deploy from the pipeline fails.',
      ms: 'Selepas peraturan akses lama dikemas, setiap deploy dari pipeline gagal.',
    },
    task: {
      en: 'Let ci-bot patch Deployments again, and still not delete them.',
      ms: 'Benarkan ci-bot patch Deployment semula, tapi masih tak boleh padam.',
    },
    goal: {
      canI: [
        { verb: 'patch', resource: 'deployments', as: 'system:serviceaccount:default:ci-bot', allowed: true },
        { verb: 'delete', resource: 'deployments', as: 'system:serviceaccount:default:ci-bot', allowed: false },
      ],
    },
    hints: [
      { en: 'Ask for the bot: kubectl auth can-i patch deployments --as=system:serviceaccount:default:ci-bot', ms: 'Tanya bagi pihak bot: kubectl auth can-i patch deployments --as=system:serviceaccount:default:ci-bot' },
      { en: 'The Role deployer is still there. Its RoleBinding is gone.', ms: 'Role deployer masih ada. RoleBinding untuknya dah hilang.' },
      { en: 'Bind it again: kubectl create rolebinding ci-bot-deployer --role=deployer --serviceaccount=default:ci-bot', ms: 'Ikat semula: kubectl create rolebinding ci-bot-deployer --role=deployer --serviceaccount=default:ci-bot' },
    ],
    solution: ['kubectl create rolebinding ci-bot-deployer --role=deployer --serviceaccount=default:ci-bot'],
    success: { en: 'The bot can patch, and still cannot delete.', ms: 'Bot itu boleh patch, dan masih tak boleh padam.' },
    rescue: 'k8s-forbidden',
    docs: [
      { label: 'Using RBAC authorization', url: 'https://kubernetes.io/docs/reference/access-authn-authz/rbac/' },
      { label: 'kubectl create rolebinding', url: 'https://kubernetes.io/docs/reference/kubectl/generated/kubectl_create/kubectl_create_rolebinding/' },
    ],
  },
  {
    id: 'missing-menu-note',
    part: 'kubernetes',
    kind: 'kube',
    scenario: 'ns-k8s-configmap',
    level: 2,
    title: { en: 'Version 2 waits for a note', ms: 'Versi 2 tunggu satu nota' },
    alert: 'Error: configmap "menu-config" not found',
    story: {
      en: "Version 2 of the shop reads today's special from a note. Its new tray never starts.",
      ms: 'Versi 2 kedai baca menu istimewa hari ini daripada nota. Dulang barunya tak pernah bermula.',
    },
    task: {
      en: 'Ship version 2. Its note menu-config needs special=laksa.',
      ms: 'Hantar versi 2. Nota menu-config perlukan special=laksa.',
    },
    goal: {
      objectExists: ['configmap/menu-config'],
      rolloutComplete: { name: 'shop' },
      noPodStatus: { selector: 'app=shop', status: 'CreateContainerConfigError' },
    },
    hints: [
      { en: 'Find the stuck tray: kubectl get pods', ms: 'Cari dulang yang tersekat: kubectl get pods' },
      { en: 'Its events name what is missing: kubectl describe pod <name>', ms: 'Event pod itu sebut apa yang tiada: kubectl describe pod <name>' },
      { en: 'Make the note: kubectl create configmap menu-config --from-literal=special=laksa', ms: 'Buat nota itu: kubectl create configmap menu-config --from-literal=special=laksa' },
    ],
    solution: ['kubectl create configmap menu-config --from-literal=special=laksa'],
    success: { en: 'The note exists, so version 2 rolls out.', ms: 'Nota itu dah ada, jadi versi 2 berjaya rollout.' },
    rescue: 'k8s-rollout-stuck',
    docs: [
      { label: 'ConfigMaps', url: 'https://kubernetes.io/docs/concepts/configuration/configmap/' },
      { label: 'kubectl create configmap', url: 'https://kubernetes.io/docs/reference/kubectl/generated/kubectl_create/kubectl_create_configmap/' },
    ],
  },
  {
    id: 'lunch-release-quota',
    part: 'kubernetes',
    kind: 'kube',
    scenario: 'ns-k8s-incident-quota',
    level: 3,
    title: { en: 'The lunch release', ms: 'Release waktu makan tengah hari' },
    alert: 'Error creating: pods "shop-5b97784975-c4qd7" is forbidden: exceeded quota: pods-cap, requested: pods=1, used: pods=4, limited: pods=4',
    story: {
      en: 'At noon, someone typed a release straight into the cluster. Customers now get no answer.',
      ms: 'Tengah hari tadi, seseorang taip release terus ke dalam kluster. Pelanggan kini tak dapat jawapan.',
    },
    task: {
      en: 'Serve the lunch rush on 5 shop trays. Pod client must reach http://shop.',
      ms: 'Layan waktu puncak dengan 5 dulang shop. Pod client mesti sampai ke http://shop.',
    },
    goal: {
      podsReady: { selector: 'app=shop', count: 5 },
      rolloutComplete: { name: 'shop' },
      serviceEndpoints: { name: 'shop', count: 5 },
      reachable: { url: 'http://shop', from: 'client' },
    },
    hints: [],
    problems: [
      {
        what: {
          en: 'The quota had room for 4 pods. Lunch needs 5 trays, the client and spare room. Raise it first: after each refusal, Kubernetes waits longer before it tries again.',
          ms: 'Kuota itu ada ruang untuk 4 pod. Waktu puncak perlu 5 dulang, client dan ruang lebih. Naikkan dulu: selepas setiap penolakan, Kubernetes tunggu lebih lama sebelum cuba lagi.',
        },
        fix: [`kubectl patch resourcequota pods-cap -p '{"spec":{"hard":{"pods":"12"}}}'`],
      },
      {
        what: { en: 'The Service asked for app=shop-v2, so it matched no tray.', ms: 'Service itu minta app=shop-v2, jadi ia tak padan dengan mana-mana dulang.' },
        fix: [`kubectl patch service shop -p '{"spec":{"selector":{"app":"shop"}}}'`],
      },
      {
        what: { en: 'The new tag nginx:1.299 does not exist.', ms: 'Tag baharu nginx:1.299 tidak wujud.' },
        fix: ['kubectl rollout undo deployment/shop'],
      },
    ],
    // Quota first: on a real cluster a ReplicaSet refused by the quota backs off (longer each time),
    // so undoing first can leave the trays short for minutes (seen on kind in CI).
    solution: [
      `kubectl patch resourcequota pods-cap -p '{"spec":{"hard":{"pods":"12"}}}'`,
      `kubectl patch service shop -p '{"spec":{"selector":{"app":"shop"}}}'`,
      'kubectl rollout undo deployment/shop',
    ],
    success: { en: 'Five trays serve the lunch rush behind the order number.', ms: 'Lima dulang layan waktu puncak di belakang nombor pesanan.' },
    rootCause: {
      question: { en: 'Three faults from one release. What was the root cause?', ms: 'Tiga masalah daripada satu release. Apakah punca sebenarnya?' },
      options: [
        { en: 'The quota broke by itself at noon', ms: 'Kuota itu rosak sendiri tengah hari' },
        { en: 'The release was typed by hand on the live cluster, not sent through the pipeline', ms: 'Release itu ditaip terus pada kluster sebenar, bukan melalui pipeline' },
        { en: 'nginx cannot run five copies', ms: 'nginx tak boleh jalan lima salinan' },
      ],
      answer: 1,
      why: {
        en: 'A pipeline runs a diff and a staging test first. All three faults show up there.',
        ms: 'Pipeline jalankan diff dan ujian staging dulu. Ketiga-tiga masalah akan nampak di situ.',
      },
    },
    rescue: 'k8s-rollout-stuck',
    docs: [
      { label: 'Resource quotas', url: 'https://kubernetes.io/docs/concepts/policy/resource-quotas/' },
      { label: 'Kubernetes: Service', url: 'https://kubernetes.io/docs/concepts/services-networking/service/' },
      { label: 'kubectl rollout undo', url: 'https://kubernetes.io/docs/reference/kubectl/generated/kubectl_rollout/kubectl_rollout_undo/' },
    ],
  },
  {
    id: 'guessed-sizes',
    part: 'kubernetes',
    kind: 'kube',
    scenario: 'ns-k8s-incident-sizes',
    level: 3,
    title: { en: 'Guessed sizes', ms: 'Saiz yang diteka' },
    alert: '0/3 nodes are available: 1 node(s) had untolerated taint(s), 2 Insufficient memory. preemption: 0/3 nodes are available: 3 Preemption is not helpful for scheduling.',
    story: {
      en: 'Today the kitchen got new memory numbers. Now soup keeps falling over, and rice never starts.',
      ms: 'Hari ini dapur dapat nombor memori baharu. Kini soup asyik tumbang, dan rice tak pernah bermula.',
    },
    task: {
      en: 'Get one soup tray and one rice tray running. Give each a sane memory size.',
      ms: 'Jalankan satu dulang soup dan satu dulang rice. Beri setiap satu saiz memori yang munasabah.',
    },
    goal: {
      podsReady: { selector: 'app=rice', count: 1 },
      rolloutComplete: { name: 'soup', minRevision: 2 },
      noPodStatus: { selector: 'app=soup', status: 'CrashLoopBackOff' },
    },
    hints: [],
    problems: [
      {
        what: { en: "soup's cap (100Mi) was below what it uses, so it was OOMKilled.", ms: 'Had soup (100Mi) lebih rendah daripada yang ia guna, jadi ia kena OOMKilled.' },
        fix: ['kubectl set resources deployment/soup --limits=memory=256Mi'],
      },
      {
        what: { en: 'rice asked for 16Gi, more than any stall has, so it stayed Pending.', ms: 'rice minta 16Gi, lebih daripada mana-mana gerai ada, jadi ia kekal Pending.' },
        fix: ['kubectl set resources deployment/rice --requests=memory=256Mi'],
      },
    ],
    solution: ['kubectl set resources deployment/soup --limits=memory=256Mi', 'kubectl set resources deployment/rice --requests=memory=256Mi'],
    success: { en: 'Both trays fit their stalls, and both stay up.', ms: 'Kedua-dua dulang muat dalam gerai, dan kedua-duanya kekal hidup.' },
    rootCause: {
      question: { en: 'Both faults came with the new numbers. What was the root cause?', ms: 'Kedua-dua masalah datang dengan nombor baharu. Apakah punca sebenarnya?' },
      options: [
        { en: 'The stalls are broken and lost memory', ms: 'Gerai-gerai rosak dan hilang memori' },
        { en: 'The memory numbers were guessed, not measured', ms: 'Nombor memori itu diteka, bukan diukur' },
        { en: 'Kubernetes 1.37 changed how memory works', ms: 'Kubernetes 1.37 tukar cara memori berfungsi' },
      ],
      answer: 1,
      why: {
        en: 'Measure real use first, for example with kubectl top. Then set requests and limits with some room.',
        ms: 'Ukur penggunaan sebenar dulu, contohnya dengan kubectl top. Kemudian tetapkan requests dan limits dengan sedikit ruang.',
      },
    },
    rescue: 'k8s-pending',
    docs: [
      { label: 'Resources for containers', url: 'https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/' },
      { label: 'kubectl set resources', url: 'https://kubernetes.io/docs/reference/kubectl/generated/kubectl_set/kubectl_set_resources/' },
    ],
  },
  {
    id: 'copied-yaml',
    part: 'kubernetes',
    kind: 'kube',
    scenario: 'ns-k8s-incident-copied',
    level: 3,
    title: { en: 'The noodle stall never opens', ms: 'Gerai mi tak pernah buka' },
    alert: 'Readiness probe failed: Get "http://10.244.1.3:8080/": dial tcp 10.244.1.3:8080: connect: connection refused',
    story: {
      en: "The new noodle stall was made from the burger stall's files. Its trays run, but nobody gets noodles.",
      ms: 'Gerai mi baharu dibuat daripada fail gerai burger. Dulangnya berjalan, tapi tiada siapa dapat mi.',
    },
    task: {
      en: 'Pod client must reach http://noodle, through 3 ready trays. nginx listens on port 80.',
      ms: 'Pod client mesti sampai ke http://noodle, melalui 3 dulang yang sedia. nginx dengar pada port 80.',
    },
    goal: {
      serviceEndpoints: { name: 'noodle', count: 3 },
      reachable: { url: 'http://noodle', from: 'client' },
    },
    hints: [],
    problems: [
      {
        what: { en: 'The readiness probe checked port 8080, but nginx listens on 80.', ms: 'Readiness probe semak port 8080, tapi nginx dengar pada 80.' },
        fix: [`kubectl patch deployment noodle -p '{"spec":{"template":{"spec":{"containers":[{"name":"web","readinessProbe":{"httpGet":{"port":80}}}]}}}}'`],
      },
      {
        what: { en: 'The Service sent traffic to targetPort 8080 too.', ms: 'Service itu juga hantar trafik ke targetPort 8080.' },
        fix: [`kubectl patch service noodle -p '{"spec":{"ports":[{"port":80,"targetPort":80}]}}'`],
      },
    ],
    solution: [
      `kubectl patch deployment noodle -p '{"spec":{"template":{"spec":{"containers":[{"name":"web","readinessProbe":{"httpGet":{"port":80}}}]}}}}'`,
      `kubectl patch service noodle -p '{"spec":{"ports":[{"port":80,"targetPort":80}]}}'`,
    ],
    success: { en: 'Probe and Service both say 80. Noodles are served.', ms: 'Probe dan Service kedua-duanya sebut 80. Mi dah dihidang.' },
    rootCause: {
      question: { en: 'Both faults share one cause. What was it?', ms: 'Kedua-dua masalah ada satu punca. Apakah ia?' },
      options: [
        { en: 'nginx moved to port 8080 in a new version', ms: 'nginx pindah ke port 8080 dalam versi baharu' },
        { en: 'The client pod is too slow to connect', ms: 'Pod client terlalu perlahan untuk sambung' },
        { en: 'The YAML was copied from burger, which listens on 8080', ms: 'YAML itu disalin daripada burger, yang dengar pada 8080' },
      ],
      answer: 2,
      why: {
        en: "Copied YAML keeps the old app's numbers. Check every port against the new app.",
        ms: 'YAML yang disalin bawa nombor aplikasi lama. Semak setiap port dengan aplikasi baharu.',
      },
    },
    rescue: 'k8s-no-endpoints',
    docs: [
      { label: 'Liveness, readiness and startup probes', url: 'https://kubernetes.io/docs/concepts/configuration/liveness-readiness-startup-probes/' },
      { label: 'Kubernetes: Service', url: 'https://kubernetes.io/docs/concepts/services-networking/service/' },
    ],
  },
  {
    id: 'meant-for-dev',
    part: 'kubernetes',
    kind: 'kube',
    scenario: 'ns-k8s-incident-wrong-cluster',
    level: 3,
    title: { en: 'Meant for dev', ms: 'Sepatutnya untuk dev' },
    alert: 'shop-5b97784975-fs4tz   0/1   ImagePullBackOff   0   28s',
    story: {
      en: 'A teammate tried a new tag and a smaller size "on dev". Minutes later, prod-like customers waited.',
      ms: 'Seorang rakan cuba tag baharu dan saiz lebih kecil "pada dev". Beberapa minit kemudian, pelanggan prod-like menunggu.',
    },
    task: {
      en: 'On prod-like, namespace shop: 3 ready trays of nginx:1.29-alpine, rollout done.',
      ms: 'Pada prod-like, namespace shop: 3 dulang sedia nginx:1.29-alpine, rollout siap.',
    },
    goal: {
      contextIs: 'prod-like',
      deploymentImage: { name: 'shop', image: 'nginx:1.29-alpine', namespace: 'shop' },
      podsReady: { selector: 'app=shop', count: 3, namespace: 'shop' },
      rolloutComplete: { name: 'shop', namespace: 'shop' },
    },
    hints: [],
    problems: [
      {
        what: { en: 'The tag nginx:1.299 went to prod-like, and it does not exist.', ms: 'Tag nginx:1.299 pergi ke prod-like, dan ia tidak wujud.' },
        fix: ['kubectl config use-context prod-like', 'kubectl rollout undo deployment/shop'],
      },
      {
        what: { en: 'The shop on prod-like was scaled down to 1 tray.', ms: 'Kedai pada prod-like dikecilkan kepada 1 dulang.' },
        fix: ['kubectl scale deployment shop --replicas=3'],
      },
    ],
    solution: ['kubectl config use-context prod-like', 'kubectl rollout undo deployment/shop', 'kubectl scale deployment shop --replicas=3'],
    success: { en: 'prod-like is back on 3 trays of the old tag.', ms: 'prod-like kembali dengan 3 dulang tag lama.' },
    rootCause: {
      question: { en: 'Both changes were meant for dev. What was the root cause?', ms: 'Kedua-dua perubahan itu untuk dev. Apakah punca sebenarnya?' },
      options: [
        { en: 'prod-like has less memory than dev', ms: 'prod-like ada kurang memori daripada dev' },
        { en: 'Kubernetes copied the change to both clusters', ms: 'Kubernetes salin perubahan itu ke kedua-dua kluster' },
        { en: "The teammate's terminal pointed at prod-like, and nobody checked", ms: 'Terminal rakan itu menunjuk ke prod-like, dan tiada siapa semak' },
      ],
      answer: 2,
      why: {
        en: 'Read the you-are-here sign before every change: kubectl config current-context.',
        ms: 'Baca papan anda-di-sini sebelum setiap perubahan: kubectl config current-context.',
      },
    },
    rescue: 'k8s-wrong-cluster',
    docs: [
      { label: 'Configure access to multiple clusters', url: 'https://kubernetes.io/docs/tasks/access-application-cluster/configure-access-multiple-clusters/' },
      { label: 'kubectl rollout undo', url: 'https://kubernetes.io/docs/reference/kubectl/generated/kubectl_rollout/kubectl_rollout_undo/' },
    ],
  },
  {
    id: 'half-moved',
    part: 'kubernetes',
    kind: 'kube',
    scenario: 'ns-k8s-incident-move',
    level: 3,
    title: { en: 'Half a move', ms: 'Pindah separuh jalan' },
    alert: "wget: bad address 'shop.food'",
    story: {
      en: 'Tonight the shop moved from namespace default to food. The client now gets no shop at all.',
      ms: 'Malam ini kedai pindah dari namespace default ke food. Client kini langsung tak jumpa kedai.',
    },
    task: {
      en: 'In namespace food: 3 ready shop trays. Pod client must reach http://shop.food.',
      ms: 'Dalam namespace food: 3 dulang shop yang sedia. Pod client mesti sampai ke http://shop.food.',
    },
    goal: {
      podsReady: { selector: 'app=shop', count: 3, namespace: 'food' },
      reachable: { url: 'http://shop.food', from: 'client' },
    },
    hints: [],
    problems: [
      {
        what: { en: 'The note menu-config stayed in default, so the trays in food could not start.', ms: 'Nota menu-config tinggal dalam default, jadi dulang dalam food tak dapat bermula.' },
        fix: ['kubectl apply -f menu.yaml -n food'],
      },
      {
        what: { en: 'The order number shop stayed in default, so shop.food did not exist.', ms: 'Nombor pesanan shop tinggal dalam default, jadi shop.food tidak wujud.' },
        fix: ['kubectl apply -f service.yaml -n food'],
      },
    ],
    solution: ['kubectl apply -f menu.yaml -n food', 'kubectl apply -f service.yaml -n food'],
    success: { en: 'Note and order number moved too. shop.food answers.', ms: 'Nota dan nombor pesanan pun dah pindah. shop.food menjawab.' },
    rootCause: {
      question: { en: 'Both faults came from the move. What was the root cause?', ms: 'Kedua-dua masalah datang daripada perpindahan itu. Apakah punca sebenarnya?' },
      options: [
        { en: 'Namespaces block all traffic by default', ms: 'Namespace sekat semua trafik secara lalai' },
        { en: 'Only the Deployment moved, and the pieces it needs stayed behind', ms: 'Hanya Deployment yang pindah, dan bahagian yang ia perlu tertinggal' },
        { en: 'The client pod must live in food too', ms: 'Pod client mesti tinggal dalam food juga' },
      ],
      answer: 1,
      why: {
        en: 'A move takes every piece the app needs. List them all in the old namespace first.',
        ms: 'Perpindahan bawa setiap bahagian yang aplikasi perlu. Senaraikan semuanya dalam namespace lama dulu.',
      },
    },
    rescue: 'k8s-no-endpoints',
    docs: [
      { label: 'Namespaces', url: 'https://kubernetes.io/docs/concepts/overview/working-with-objects/namespaces/' },
      { label: 'DNS for Services and Pods', url: 'https://kubernetes.io/docs/concepts/services-networking/dns-pod-service/' },
      { label: 'ConfigMaps', url: 'https://kubernetes.io/docs/concepts/configuration/configmap/' },
    ],
  },
  // K9 node drills (Level Up CKA pack): inside a node with ssh, systemctl and the static pod manifests.
  // Scenarios: src/content/courses/kubernetes/scenarios/k9-admin.ts (ns-k8s-kubelet-stopped, …).
  {
    id: 'kubelet-stopped',
    part: 'kubernetes',
    kind: 'kube',
    scenario: 'ns-k8s-kubelet-stopped',
    level: 1,
    title: { en: 'A stall went quiet', ms: 'Satu gerai senyap' },
    alert: 'Node dev-worker2 status is now: NodeNotReady',
    story: {
      en: 'After a disk check, stall dev-worker2 stopped reporting. Nobody watches its trays now.',
      ms: 'Selepas semakan cakera, gerai dev-worker2 berhenti melapor. Kini tiada siapa jaga dulangnya.',
    },
    task: {
      en: 'Make dev-worker2 Ready again.',
      ms: 'Jadikan dev-worker2 Ready semula.',
    },
    goal: { nodeReady: { name: 'dev-worker2' } },
    hints: [
      { en: 'Which stall? kubectl get nodes', ms: 'Gerai mana? kubectl get nodes' },
      { en: 'Look inside it: ssh dev-worker2, then systemctl status kubelet', ms: 'Lihat ke dalamnya: ssh dev-worker2, kemudian systemctl status kubelet' },
      { en: 'Start it: systemctl start kubelet, then exit', ms: 'Hidupkannya: systemctl start kubelet, kemudian exit' },
    ],
    solution: ['ssh dev-worker2', 'systemctl start kubelet', 'exit'],
    success: { en: 'The kubelet runs again. dev-worker2 is Ready.', ms: 'Kubelet berjalan semula. dev-worker2 sudah Ready.' },
    rescue: 'k8s-node-kubelet',
    docs: [
      { label: 'Kubernetes: troubleshooting clusters', url: 'https://kubernetes.io/docs/tasks/debug/debug-cluster/' },
      { label: 'kubelet', url: 'https://kubernetes.io/docs/reference/command-line-tools-reference/kubelet/' },
    ],
  },
  {
    id: 'scheduler-typo',
    part: 'kubernetes',
    kind: 'kube',
    scenario: 'ns-k8s-static-typo',
    level: 2,
    title: { en: 'The fourth tray waits forever', ms: 'Dulang keempat menunggu tanpa henti' },
    alert: 'Error: unknown flag: --bind-adress',
    story: {
      en: 'Someone edited the scheduler’s manifest last night. Now new trays wait in Pending.',
      ms: 'Seseorang ubah manifest scheduler malam tadi. Kini dulang baharu menunggu dalam Pending.',
    },
    task: {
      en: 'Fix the scheduler, so all 4 shop trays run.',
      ms: 'Baiki scheduler, supaya semua 4 dulang shop berjalan.',
    },
    goal: { staticPodRunning: { name: 'kube-scheduler' }, podsReady: { selector: 'app=shop', count: 4 } },
    hints: [
      { en: 'Check the office: kubectl get pods -n kube-system -l component=kube-scheduler', ms: 'Semak pejabat: kubectl get pods -n kube-system -l component=kube-scheduler' },
      { en: 'Its log ends with the reason: kubectl logs -n kube-system kube-scheduler-dev-control-plane', ms: 'Log-nya berakhir dengan sebabnya: kubectl logs -n kube-system kube-scheduler-dev-control-plane' },
      {
        en: "On dev-control-plane: sed -i 's/bind-adress/bind-address/' /etc/kubernetes/manifests/kube-scheduler.yaml",
        ms: "Di dev-control-plane: sed -i 's/bind-adress/bind-address/' /etc/kubernetes/manifests/kube-scheduler.yaml",
      },
    ],
    solution: ['ssh dev-control-plane', "sed -i 's/bind-adress/bind-address/' /etc/kubernetes/manifests/kube-scheduler.yaml", 'exit'],
    success: { en: 'The scheduler runs again. The waiting tray found a stall.', ms: 'Scheduler berjalan semula. Dulang yang menunggu dapat gerai.' },
    rescue: 'k8s-control-plane-down',
    docs: [
      { label: 'Kubernetes: static pods', url: 'https://kubernetes.io/docs/tasks/configure-pod-container/static-pod/' },
      { label: 'kube-scheduler', url: 'https://kubernetes.io/docs/reference/command-line-tools-reference/kube-scheduler/' },
    ],
  },
  {
    id: 'maintenance-left-open',
    part: 'kubernetes',
    kind: 'kube',
    scenario: 'ns-k8s-incident-node',
    level: 3,
    title: { en: 'The night shift forgot to undo', ms: 'Syif malam terlupa pulihkan semula' },
    alert: 'shop-747bf9cf8-7598d   0/1   Pending',
    story: {
      en: 'The lunch order asks for 5 shop trays. Two wait in Pending, and one stall is quiet.',
      ms: 'Pesanan tengah hari minta 5 dulang shop. Dua menunggu dalam Pending, dan satu gerai senyap.',
    },
    task: {
      en: 'All 5 shop trays run, every stall is Ready, and the scheduler runs.',
      ms: 'Semua 5 dulang shop berjalan, setiap gerai Ready, dan scheduler berjalan.',
    },
    goal: { nodeReady: { name: 'dev-worker2' }, staticPodRunning: { name: 'kube-scheduler' }, podsReady: { selector: 'app=shop', count: 5 } },
    hints: [],
    problems: [
      {
        what: { en: 'The kubelet on dev-worker2 was stopped, so the stall was NotReady.', ms: 'Kubelet di dev-worker2 dihentikan, jadi gerai itu NotReady.' },
        fix: ['ssh dev-worker2', 'systemctl start kubelet', 'exit'],
      },
      {
        what: { en: 'The scheduler’s manifest sat in /root, so no new tray got a stall.', ms: 'Manifest scheduler ada di /root, jadi tiada dulang baharu dapat gerai.' },
        fix: ['ssh dev-control-plane', 'mv /root/kube-scheduler.yaml /etc/kubernetes/manifests/', 'exit'],
      },
    ],
    solution: ['ssh dev-worker2', 'systemctl start kubelet', 'exit', 'ssh dev-control-plane', 'mv /root/kube-scheduler.yaml /etc/kubernetes/manifests/', 'exit'],
    success: { en: 'Five trays serve, and every stall reports again.', ms: 'Lima dulang melayan, dan setiap gerai melapor semula.' },
    rootCause: {
      question: { en: 'Both faults came from the same night. What was the root cause?', ms: 'Kedua-dua masalah datang dari malam yang sama. Apakah punca sebenarnya?' },
      options: [
        { en: 'The stalls ran out of memory', ms: 'Gerai-gerai kehabisan memori' },
        { en: 'Kubernetes moved the manifest by itself', ms: 'Kubernetes alih manifest itu sendiri' },
        { en: 'Maintenance steps were never undone', ms: 'Langkah penyelenggaraan tak pernah dipulihkan semula' },
        { en: 'The shop image had a typo', ms: 'Image shop ada salah ejaan' },
      ],
      answer: 2,
      why: {
        en: 'Someone paused two things for maintenance and forgot to undo them. A checklist with an undo step catches both.',
        ms: 'Seseorang hentikan dua benda untuk penyelenggaraan, lalu terlupa pulihkannya. Senarai semak dengan langkah pulihkan boleh tangkap kedua-duanya.',
      },
    },
    rescue: 'k8s-node-kubelet',
    docs: [
      { label: 'Kubernetes: troubleshooting clusters', url: 'https://kubernetes.io/docs/tasks/debug/debug-cluster/' },
      { label: 'Kubernetes: static pods', url: 'https://kubernetes.io/docs/tasks/configure-pod-container/static-pod/' },
      { label: 'kubelet', url: 'https://kubernetes.io/docs/reference/command-line-tools-reference/kubelet/' },
    ],
  },
];

/** The sites exam mode allows (shown on the rule card). */
export const EXAM_DOCS = ['kubernetes.io/docs', 'docs.docker.com', 'docs.github.com'] as const;
