// Bring a real capture into the K9 node shell's fixture.
//
//   npx tsx scripts/capture-cka/import.ts cka-capture.json [--dry-run]
//
// cka-capture.json is the artifact of .github/workflows/capture-cka.yml (scripts/capture-cka.sh run
// on a 3-node kind cluster). Every output whose key the fixture uses (or lists under "pending")
// replaces the recorded one and becomes source "kind-capture"; the files (manifests, kubelet unit
// and config) are replaced too. Extra keys (kubectl views of the same moments) are kept under
// "reference" so lessons can quote them. Then run:
//   npx vitest run src/engine/foodcourt-sim && npm run verify:k8s
import { readFileSync, writeFileSync } from 'node:fs';

interface Captured {
  source: string;
  node: string | null;
  ip: string;
  cmd: string;
  exit: number;
  vars?: Record<string, string>;
  text: string;
}

const FIXTURE = 'src/engine/foodcourt-sim/fixtures/cka.json';
const [input, flag] = process.argv.slice(2);
if (!input) {
  console.error('Usage: npx tsx scripts/capture-cka/import.ts cka-capture.json [--dry-run]');
  process.exit(1);
}
const cap = JSON.parse(readFileSync(input, 'utf8')) as { captured: string; kind: string; kubectl: string; nodeImage: string; outputs: Record<string, Captured>; files: Record<string, { node: string; text: string }> };
const fx = JSON.parse(readFileSync(FIXTURE, 'utf8')) as {
  outputs: Record<string, any>;
  files: Record<string, any>;
  pending: Record<string, string>;
  reference?: Record<string, any>;
  captured?: Record<string, string>;
};

/** The kubelet lines a start writes (the same set the first recording kept). */
const START = /systemd\[1\]: (Starting|Started) kubelet|"(Kubelet version|Golang settings|Adding static pod path|Adding apiserver pod source|Container runtime initialized|Started kubelet|Starting to listen|Starting Kubelet Volume Manager|Reconciler: start to sync state)"/;

/** Small clean-ups so a capture fits the fixture's meaning. */
function shape(key: string, c: Captured): string | null {
  let text = c.text;
  // kubectl exec adds this after a failing command; the engine adds it itself.
  text = text.replace(/\ncommand terminated with exit code \d+$/, '');
  if (key === 'journal-kubelet-start') {
    const lines = text.split('\n');
    const from = lines.map((l) => /systemd\[1\]: Starting kubelet/.test(l)).lastIndexOf(true);
    const kept = lines.slice(Math.max(0, from)).filter((l) => START.test(l));
    return kept.length >= 3 ? kept.join('\n') : null;
  }
  if (key === 'kubelet-manifest-error') {
    const kept = text.split('\n').filter((l) => /manifest/i.test(l) && /kubelet\[\d+\]: E\d{4}/.test(l));
    return kept.length ? kept.slice(-1).join('\n') : null;
  }
  if (key === 'command-not-found') return text.split('\n').filter(Boolean).pop() ?? null;
  return text;
}

/** Keys that were renamed since older captures were made (old capture key → fixture key). */
const RENAMED: Record<string, string> = { 'kubectl-no-kubeconfig': 'kubectl-in-control-plane' };

const replaced: string[] = [];
const referenced: string[] = [];
const skipped: string[] = [];
for (const [capKey, c] of Object.entries(cap.outputs)) {
  const key = RENAMED[capKey] ?? capKey;
  const known = key in fx.outputs || key in fx.pending;
  const text = shape(key, c);
  if (text === null) {
    skipped.push(key);
    continue;
  }
  const entry = { source: 'kind-capture', cmd: c.cmd, exit: c.exit, ...(c.node ? { node: c.node } : {}), ...(c.ip ? { ip: c.ip } : {}), ...(c.vars && Object.keys(c.vars).length ? { vars: c.vars } : {}), text };
  if (known) {
    // Keep the variables the engine needs when the capture has none (e.g. the API address).
    const old = fx.outputs[key];
    if (old?.vars && !entry.vars) Object.assign(entry, { vars: old.vars });
    fx.outputs[key] = entry;
    delete fx.pending[key];
    replaced.push(key);
  } else {
    fx.reference = fx.reference ?? {};
    fx.reference[key] = entry;
    referenced.push(key);
  }
}
for (const [path, f] of Object.entries(cap.files)) {
  fx.files[path] = { source: 'kind-capture', node: f.node, text: f.text };
}
fx.captured = { at: cap.captured, kind: cap.kind, kubectl: cap.kubectl, nodeImage: cap.nodeImage };

console.log(`Replaced ${replaced.length} outputs: ${replaced.join(', ')}`);
console.log(`Kept ${referenced.length} extra outputs under "reference": ${referenced.join(', ')}`);
if (skipped.length) console.log(`Skipped (nothing usable in them): ${skipped.join(', ')}`);
console.log(`Replaced ${Object.keys(cap.files).length} files.`);
const left = Object.entries(fx.outputs).filter(([, o]) => o.source !== 'kind-capture').map(([k, o]) => `${k} (${o.source})`);
if (left.length) console.log(`Still not from kind: ${left.join(', ')}`);
if (flag === '--dry-run') {
  console.log('Dry run: nothing written.');
} else {
  writeFileSync(FIXTURE, `${JSON.stringify(fx, null, 2)}\n`);
  console.log(`Wrote ${FIXTURE}. Now run: npx vitest run src/engine/foodcourt-sim && npm run verify:k8s`);
}
