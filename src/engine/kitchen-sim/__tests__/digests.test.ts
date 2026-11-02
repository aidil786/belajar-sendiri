// Digests (D5): `name@sha256:…` picks one exact image. The digest wins over the tag, and a digest the
// registry doesn't have is "not found" (checked on Docker 29.9 against a local registry:3).
import { describe, expect, it } from 'vitest';
import { checkKitchenGoal } from '../index';
import { buildKitchenScenario } from '../scenario';
import { kitchen, runs, text } from './helpers';

const NODE = 'sha256:8a32c8cf649a49915a66e81e7a609223c708d0adabf288ee3f4077d765542f85';
const NGINX = 'sha256:0e52bd054126cdc040b1276c0af347aeb02a41b9cfe305d6094767ac30e97949';
const BAD = `sha256:${'1'.repeat(64)}`;

describe('digests', () => {
  it('pulls the image with that digest, whatever tag is typed', () => {
    const r = runs(kitchen(), `docker pull node:24-alpine@${NODE}`);
    expect(text(r.last)).toContain(`Digest: ${NODE}`);
    expect(checkKitchenGoal(r.state, { imageExists: 'node:24-alpine' }).ok).toBe(true);
    // A digest alone finds the right tag's image too (not nginx:latest).
    const n = runs(kitchen(), `docker pull nginx@${NGINX}`);
    expect(text(n.last)).toContain(`Digest: ${NGINX}`);
    expect(checkKitchenGoal(n.state, { imageExists: 'nginx:1.30-alpine', imageMissing: ['nginx:latest'] }).ok).toBe(true);
  });

  it('a digest the registry does not have is not found, even with a good tag', () => {
    const r = runs(kitchen(), `docker pull node:24-alpine@${BAD}`);
    expect(r.last.ok).toBe(false);
    expect(text(r.last)).toBe(`Error response from daemon: failed to resolve reference "docker.io/library/node@${BAD}": docker.io/library/node@${BAD}: not found`);
    const run = runs(kitchen(), `docker run --rm node:24-alpine@${BAD} node --version`);
    expect(run.last.ok).toBe(false);
    expect(text(run.last)).toContain(`docker.io/library/node@${BAD}: not found`);
  });

  it('runs and builds from a pinned image that is already here', () => {
    const r = runs(kitchen(['node:24-alpine']), `docker run --rm node:24-alpine@${NODE} node --version`);
    expect(text(r.last)).toBe('v24.22.2');
  });

  it('works for images in the practice registry too', () => {
    const s = buildKitchenScenario({ id: 'dg', steps: [{ remoteImage: { ref: 'aisyah/shop:1.0', from: 'alpine:3.22' } }] });
    const ok = runs(s, 'docker pull aisyah/shop:1.0');
    const digest = /Digest: (sha256:[0-9a-f]{64})/.exec(text(ok.last))![1]!;
    expect(runs(s, `docker pull aisyah/shop@${digest}`).last.ok).toBe(true);
    expect(text(runs(s, `docker pull aisyah/shop@${BAD}`).last)).toContain(`docker.io/aisyah/shop@${BAD}: not found`);
  });
});
