// Laptop shell, volumes, networks, registry, goals, scenarios and i18n keys.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildKitchenScenario, checkKitchenGoal, kitchenStart, kitchenStep, run, type KitchenScenario } from '../index';
import { allScenarios } from '~/content/courses/docker/scenarios';
import en from '~/i18n/en.json';
import { kitchen, runs, text } from './helpers';

describe('the laptop shell', () => {
  it('files, permissions, env vars and exit codes', () => {
    const r = runs(
      kitchen(),
      'mkdir -p shop/site',
      'cd shop',
      'echo "echo hello from a script" > hello.sh',
      './hello.sh',
      'echo $?',
      'chmod +x hello.sh',
      './hello.sh',
      'ls -l',
      'export GREETING=hi',
      'echo $GREETING',
      'cat nope',
    );
    expect(text(r.all[3]!)).toBe('bash: ./hello.sh: Permission denied');
    expect(text(r.all[4]!)).toBe('126');
    expect(text(r.all[6]!)).toBe('hello from a script');
    expect(text(r.all[7]!)).toMatch(/-rwxr-xr-x 1 you you +\d+ Oct 31 \d\d:\d\d hello\.sh/);
    expect(text(r.all[9]!)).toBe('hi');
    expect(text(r.last)).toBe('cat: nope: No such file or directory');
  });

  it('one command at a time, except pipes into a filter or docker login', () => {
    const s = kitchen();
    expect(run(s, 'ls && pwd').explain?.key).toBe('sim.docker.err.oneAtATime');
    expect(text(run(s, 'echo hello | grep hell'))).toBe('hello');
  });
});

describe('volumes and networks', () => {
  it('a non-root user cannot write into a fresh volume', () => {
    const r = runs(kitchen(['alpine:3.22']), 'docker run --rm -u 1000 -v data:/data alpine:3.22 sh -c "echo hi > /data/x"', 'docker run --rm -v data:/data alpine:3.22 sh -c "echo hi > /data/x"', 'docker run --rm -v data:/data alpine:3.22 cat /data/x');
    expect(text(r.all[0]!)).toBe('sh: can\'t create /data/x: Permission denied');
    expect(text(r.last)).toBe('hi');
    expect(checkKitchenGoal(r.state, { fileInVolume: { data: 'x' }, volumeExists: ['data'] }).ok).toBe(true);
  });

  it('Postgres data survives docker rm in a named volume, and the old 17 path errors', () => {
    const sc = buildKitchenScenario({ id: 't', images: ['postgres:18-alpine'], steps: [] });
    const r = runs(
      sc,
      'docker run -d --name db -e POSTGRES_PASSWORD=x -v pgdata:/var/lib/postgresql postgres:18-alpine',
      'docker exec db psql -U postgres -c "create table notes (id int, text text)"',
      "docker exec db psql -U postgres -c \"insert into notes values (1, 'hi')\"",
      'docker rm -f db',
      'docker run -d --name db2 -e POSTGRES_PASSWORD=x -v pgdata:/var/lib/postgresql postgres:18-alpine',
      'docker exec db2 psql -U postgres -c "select * from notes"',
      'docker logs db2',
    );
    expect(text(r.all[5]!)).toBe(' id | text \n----+------\n  1 | hi\n(1 row)\n');
    expect(text(r.last)).toContain('PostgreSQL Database directory appears to contain a database; Skipping initialization');
    expect(text(r.last)).toContain('database system was not properly shut down; automatic recovery in progress');
    expect(checkKitchenGoal(r.state, { tableInVolume: { pgdata: 'notes' } }).ok).toBe(true);
    const old = run(sc, 'docker run --name pg -e POSTGRES_PASSWORD=x -v old:/var/lib/postgresql/data postgres:18-alpine');
    expect(old.exitCode).toBe(1);
    expect(text(old)).toContain('Error: in 18+, these Docker images are configured to store database data in a');
  });

  it('containers find each other by name only on a user-defined network', () => {
    const r = runs(kitchen(['nginx:1.30-alpine', 'alpine:3.22']), 'docker network create shopnet', 'docker run -d --name api --network shopnet nginx:1.30-alpine', 'docker run --rm --network shopnet alpine:3.22 wget -qO- http://api', 'docker run --rm alpine:3.22 wget -qO- http://api', 'docker network rm shopnet');
    expect(text(r.all[2]!)).toContain('Welcome to nginx!');
    expect(text(r.all[3]!)).toBe("wget: bad address 'api'");
    expect(text(r.last)).toMatch(/has active endpoints \(name:"api" id:"[0-9a-f]{12}"\)\nexit status 1$/);
    expect(checkKitchenGoal(r.state, { networkHas: { shopnet: ['api'] } }).ok).toBe(true);
  });

  it('prune asks first; y deletes, N keeps', () => {
    const s = runs(kitchen(['alpine:3.22']), 'docker run --name one alpine:3.22').state;
    const ask = run(s, 'docker container prune');
    expect(text(ask)).toBe('WARNING! This will remove all stopped containers.');
    expect(ask.prompt).toBe('Are you sure you want to continue? [y/N] ');
    expect(text(run(ask.state, 'N'))).toBe('');
    const yes = run(ask.state, 'y');
    expect(text(yes)).toMatch(/^Deleted Containers:\n[0-9a-f]{64}\n\nTotal reclaimed space: 4\.096kB$/);
  });
});

describe('registry', () => {
  const sc: KitchenScenario = { id: 'reg', images: ['alpine:3.22'], steps: [{ account: { user: 'you', token: 'dckr_pat_test123', password: 'hunter2' } }] };

  it('login with a token, tag, push; denied when not yours', () => {
    let s = buildKitchenScenario(sc);
    expect(text(run(s, 'docker push you/box:1'))).toContain('tag does not exist: you/box:1');
    s = runs(s, 'docker tag alpine:3.22 you/box:1').state;
    expect(text(run(s, 'docker push you/box:1'))).toContain('push access denied, repository does not exist or may require authorization');
    const bad = run(s, 'docker login -u you -p nope');
    expect(text(bad)).toContain('unauthorized: incorrect username or password');
    const good = run(s, 'echo dckr_pat_test123 | docker login -u you --password-stdin');
    expect(text(good)).toBe('Login Succeeded');
    const push = run(good.state, 'docker push you/box:1');
    expect(text(push)).toMatch(/The push refers to repository \[docker\.io\/you\/box\]\n63e7e49699e8: Pushed\n1: digest: sha256:[0-9a-f]{64} size: \d+/);
    expect(checkKitchenGoal(push.state, { pushed: ['you/box:1'], loggedIn: 'you' }).ok).toBe(true);
    const pw = runs(s, 'docker login -u you', 'hunter2');
    expect(pw.all[0]!.prompt).toBe('Password: ');
    expect(pw.last.explain?.key).toBe('sim.docker.explain.loginPassword');
  });

  it('Docker Hub 429 until you log in; unknown tags and repos', () => {
    let s = kitchenStep(kitchenStart({ id: 'r', steps: [] }), { flag: 'rateLimited' });
    const r = run(s, 'docker pull redis:8-alpine');
    expect(text(r)).toBe('Error response from daemon: unknown: failed to resolve reference "docker.io/library/redis:8-alpine": unexpected status from HEAD request to https://registry-1.docker.io/v2/library/redis/manifests/8-alpine: 429 Too Many Requests');
    s = kitchen();
    expect(text(run(s, 'docker run fl-nope:9'))).toContain("docker: Error response from daemon: pull access denied for fl-nope, repository does not exist or may require 'docker login'");
    expect(run(s, 'docker pull ubuntu').explain?.key).toBe('sim.docker.explain.notStocked');
    expect(text(run(s, 'docker pull nginx:9.9'))).toContain('docker.io/library/nginx:9.9: not found');
  });
});

describe('goals', () => {
  it('checks running, ports, reachability, images and typed commands', () => {
    const s = runs(kitchen(['nginx:1.30-alpine']), 'docker run -d --name web -p 8080:80 nginx:1.30-alpine').state;
    const ok = checkKitchenGoal(s, { running: ['web'], portMapped: { web: '8080:80' }, reachable: 'localhost:8080', reachableContains: { 'localhost:8080': 'Welcome' }, imageExists: 'nginx:1.30-alpine', unreachable: ['localhost:9090'], typed: 'docker run', count: { running: 1 } }, ['docker run -d --name web -p 8080:80 nginx:1.30-alpine']);
    expect(ok).toEqual({ ok: true, failed: [] });
    expect(checkKitchenGoal(s, { exited: ['web'], notExists: ['web'] }).failed).toEqual(['exited:web', 'notExists:web']);
  });
});

describe('docker course scenarios', () => {
  it('have unique ids', () => {
    const ids = allScenarios.map((s) => s.id);
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
  });
  for (const sc of allScenarios) {
    it(`${sc.id} builds and its verify commands run`, () => {
      const start = buildKitchenScenario(sc);
      for (const seq of sc.verify ?? []) {
        let s = start;
        for (const c of seq) s = { ...run(s, c).state, session: null };
      }
    });
  }
});

describe('i18n', () => {
  it('every sim.docker key the engine uses exists in en.json (also the ones built at run time)', () => {
    const dir = 'src/engine/kitchen-sim';
    const keys = new Set<string>();
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.ts'))) {
      for (const m of readFileSync(join(dir, f), 'utf8').matchAll(/'(sim\.docker\.(?:explain|err)\.[A-Za-z.]+)'/g)) keys.add(m[1]!);
    }
    for (const c of ['rateLimited', 'pullDenied', 'manifestUnknown', 'badRef', 'noSuchVolume', 'volumeInUse', 'noSuchNetwork', 'builtinNetwork', 'networkInUse', 'noSuchContainer', 'portTaken', 'startFailed', 'notRunning', 'alreadyPaused', 'notPaused', 'rmRunning', 'noSuchImage', 'imageInUse', 'connectionRefused', 'connectionReset', 'cantResolve', 'curlFailed']) keys.add(`sim.docker.err.${c}`);
    for (const c of ['noComposeFile', 'badYaml', 'badCompose', 'missingVar', 'envFile', 'undefinedVolume', 'undefinedNetwork', 'noImage']) keys.add(`sim.docker.err.compose.${c}`);
    for (const c of ['Start', 'Stop', 'Restart']) keys.add(`sim.docker.explain.compose${c}`);
    const missing = [...keys].filter((k) => !(k in en));
    expect(missing).toEqual([]);
  });
});
