// Check that ComposeCanvas writes files real Docker Compose accepts.
// Test-only (needs Docker with Compose v2+; not part of `npm test`):
//
//   npx tsx scripts/docker-games/verify-compose.ts
//
// For a set of canvases it writes compose.yaml with composeYaml() and runs
// `docker compose config` on it (validates and normalises; starts nothing, creates nothing),
// then compares the services, networks, volumes and depends_on Compose reports.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { composeYaml, emptyService, type CanvasService } from '../../src/lib/composeCanvas';
import { KEDAI_DONE, KEDAI_PALETTE } from '../../src/lib/composeSamples';

const cases: [string, CanvasService[]][] = [
  ['empty canvas', []],
  ['one service', [emptyService('web')]],
  ['web + api + db, default network', [emptyService('web'), { ...emptyService('api'), dependsOn: { db: 'service_started' } }, { ...emptyService('db'), volume: 'db-data' }]],
  ['the full Kedai stack', KEDAI_DONE],
  ['finished job condition', [{ ...emptyService('api'), dependsOn: { db: 'service_completed_successfully' } }, emptyService('db')]],
];

type Config = {
  services?: Record<string, { networks?: Record<string, unknown>; depends_on?: Record<string, { condition: string }>; volumes?: { type: string; source: string; target: string }[] }>;
  networks?: Record<string, unknown>;
  volumes?: Record<string, unknown>;
};

const dir = mkdtempSync(join(tmpdir(), 'fl-ui-compose-'));
let failed = 0;
try {
  for (const [name, canvas] of cases) {
    const yaml = composeYaml(KEDAI_PALETTE, canvas);
    const file = join(dir, 'compose.yaml');
    writeFileSync(file, yaml);
    try {
      const out = execFileSync('docker', ['compose', '-p', 'fl-ui-verify', '-f', file, 'config', '--format', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      const cfg = JSON.parse(out) as Config;
      const problems: string[] = [];
      const services = Object.keys(cfg.services ?? {}).sort();
      const want = canvas.map((s) => s.id).sort();
      if (services.join() !== want.join()) problems.push(`services ${services.join()} != ${want.join()}`);
      for (const s of canvas) {
        const got = cfg.services?.[s.id];
        const nets = Object.keys(got?.networks ?? {}).sort();
        const wantNets = s.networks.length ? [...s.networks].sort() : ['default'];
        if (nets.join() !== wantNets.join()) problems.push(`${s.id} networks ${nets.join()} != ${wantNets.join()}`);
        const deps = Object.entries(got?.depends_on ?? {}).map(([k, v]) => `${k}:${v.condition}`).sort();
        const wantDeps = Object.entries(s.dependsOn).filter(([k]) => canvas.some((c) => c.id === k)).map(([k, v]) => `${k}:${v}`).sort();
        if (deps.join() !== wantDeps.join()) problems.push(`${s.id} depends_on ${deps.join()} != ${wantDeps.join()}`);
        const vol = got?.volumes?.find((v) => v.type === 'volume');
        if ((vol?.source ?? null) !== s.volume) problems.push(`${s.id} volume ${vol?.source ?? 'none'} != ${s.volume ?? 'none'}`);
      }
      if (problems.length) {
        failed++;
        console.error(`✗ ${name}:\n  ${problems.join('\n  ')}\n${yaml}`);
      } else console.log(`✓ ${name} (${yaml.split('\n').length - 1} lines)`);
    } catch (e) {
      failed++;
      console.error(`✗ ${name}: docker compose config refused it\n${(e as { stderr?: string }).stderr ?? String(e)}\n${yaml}`);
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
if (failed) process.exit(1);
console.log('✓ docker compose config accepts every ComposeCanvas file.');
