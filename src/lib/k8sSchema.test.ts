import { describe, expect, it } from 'vitest';
import corpus from './__fixtures__/kubectl-1.37.2.json';
import { K8S_FIXTURES } from './k8sFixtures';
import {
  base64ErrorAt,
  cronError,
  kubectlApply,
  parseQuantity,
  selectorMismatchMessage,
} from './k8sSchema';
import { goYamlProblem, splitDocuments } from './k8sYaml';

const out = (text: string, file: string, namespaces?: string[]) =>
  kubectlApply(text, file, { namespaces })
    .lines.map((l) => l.text)
    .join('\n');

describe('kubectlApply matches real kubectl 1.37.2', () => {
  it.each(corpus.cases.map((c) => [c.file, c] as const))('%s', (_name, c) => {
    const r = kubectlApply(c.yaml, c.file, { namespaces: ['shop', 'ci'] });
    expect(r.lines.map((l) => l.text).join('\n')).toBe(c.output);
    expect(r.ok).toBe(c.exit === 0);
  });
});

describe('YamlDoctor fixtures', () => {
  it.each(K8S_FIXTURES.map((f) => [f.id, f] as const))(
    '%s: broken prints the real error, fixed applies',
    (_id, f) => {
      const broken = kubectlApply(f.broken, f.file, { namespaces: ['shop'] });
      expect(broken.ok).toBe(false);
      expect(broken.lines.map((l) => l.text).join('\n')).toBe(f.real);
      expect(broken.issues[0]!.line).toBeGreaterThan(0);
      const fixed = kubectlApply(f.fixed, f.file, { namespaces: ['shop'] });
      expect(fixed.ok).toBe(true);
      expect(fixed.lines).toHaveLength(1);
      expect(fixed.lines[0]!.text).toMatch(/ created$/);
    },
  );

  it('fixtures stay small (about 15 lines, rule 18; a whole Deployment needs 17)', () => {
    for (const f of K8S_FIXTURES) {
      expect(f.broken.trimEnd().split('\n').length).toBeLessThanOrEqual(17);
      expect(f.fixed.trimEnd().split('\n').length).toBeLessThanOrEqual(17);
    }
  });

  it('points at the line with the mistake', () => {
    const line = (id: string) =>
      kubectlApply(K8S_FIXTURES.find((f) => f.id === id)!.broken, 'x.yaml', {
        namespaces: ['shop'],
      }).issues[0]!.line;
    expect(line('indent')).toBe(9); // the real problem line (go-yaml says "line 8")
    expect(line('tab')).toBe(6);
    expect(line('colon-space')).toBe(8);
    expect(line('typo')).toBe(15);
    expect(line('string-int')).toBe(6);
    expect(line('old-api')).toBe(1);
    expect(line('selector')).toBe(12);
    expect(line('route-path')).toBe(12);
  });

  it('gives plain-language codes', () => {
    const code = (id: string) =>
      kubectlApply(K8S_FIXTURES.find((f) => f.id === id)!.broken, 'x.yaml', {
        namespaces: ['shop'],
      }).issues[0]!.code;
    expect(code('indent')).toBe('yaml.indentDash');
    expect(code('tab')).toBe('yaml.tab');
    expect(code('colon-space')).toBe('yaml.missingColon');
    expect(code('old-api')).toBe('noMatch');
    expect(code('typo')).toBe('unknownField');
    expect(code('selector')).toBe('selectorMismatch');
    expect(code('missing-image')).toBe('required');
    expect(code('string-int')).toBe('typeMismatch');
    expect(code('service-protocol')).toBe('unsupported');
    expect(code('secret-base64')).toBe('base64');
    expect(code('cron')).toBe('cron');
  });
});

describe('more kubectl behaviour', () => {
  it('an empty file has no objects', () => {
    expect(out('', 'x.yaml')).toBe('error: no objects passed to apply');
    expect(out('# just a comment\n', 'x.yaml')).toBe('error: no objects passed to apply');
  });

  it('a namespace must exist, unless the file makes it first', () => {
    const pod =
      'apiVersion: v1\nkind: Pod\nmetadata:\n  name: tray\n  namespace: lunch\nspec:\n  containers:\n    - name: web\n      image: nginx:1.29-alpine\n';
    expect(out(pod, 'tray.yaml')).toBe(
      'Error from server (NotFound): error when creating "tray.yaml": namespaces "lunch" not found',
    );
    expect(
      out(`apiVersion: v1\nkind: Namespace\nmetadata:\n  name: lunch\n---\n${pod}`, 'tray.yaml'),
    ).toBe('namespace/lunch created\npod/tray created');
  });

  it('cluster-scoped kinds ignore the namespace', () => {
    expect(
      out(
        'apiVersion: rbac.authorization.k8s.io/v1\nkind: ClusterRole\nmetadata:\n  name: reader\nrules:\n  - apiGroups: [""]\n    resources: ["pods"]\n    verbs: ["get"]\n',
        'r.yaml',
      ),
    ).toBe('clusterrole.rbac.authorization.k8s.io/reader created');
  });

  it('records what was applied', () => {
    const r = kubectlApply(K8S_FIXTURES.find((f) => f.id === 'selector')!.fixed, 'shop.yaml');
    expect(r.objects).toEqual([
      expect.objectContaining({
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        name: 'shop',
        namespace: 'default',
      }),
    ]);
  });

  it('builds the selector message the API server prints', () => {
    expect(selectorMismatchMessage('Deployment', 'shop', { app: 'web' })).toBe(
      'The Deployment "shop" is invalid: spec.template.metadata.labels: Invalid value: {"app":"web"}: `selector` does not match template `labels`',
    );
  });
});

describe('helpers', () => {
  it('parses quantities like Kubernetes', () => {
    expect(parseQuantity('500m')).toEqual({ value: 0.5 });
    expect(parseQuantity('1Gi')).toEqual({ value: 2 ** 30 });
    expect(parseQuantity(2)).toEqual({ value: 2 });
    expect(parseQuantity('128mb')).toHaveProperty('error');
    expect(parseQuantity('2 cores')).toHaveProperty('error');
    expect(parseQuantity('5mi')).toEqual({ error: "unable to parse quantity's suffix" });
  });

  it('finds base64 errors where Go does', () => {
    expect(base64ErrorAt('a2FuY2lsMTIz')).toBe(-1);
    expect(base64ErrorAt('hunter2!')).toBe(7);
    expect(base64ErrorAt('abc')).toBe(0);
    expect(base64ErrorAt('abcde')).toBe(4);
    expect(base64ErrorAt('kancil123')).toBe(8);
    expect(base64ErrorAt('YQ==')).toBe(-1);
  });

  it('checks cron schedules like the CronJob controller', () => {
    expect(cronError('0 3 * * *')).toBeNull();
    expect(cronError('*/15 9-17 * * mon-fri')).toBeNull();
    expect(cronError('@daily')).toBeNull();
    expect(cronError('every day')).toBe('expected exactly 5 fields, found 2: [every day]');
    expect(cronError('0 25 * * *')).toBe('end of range (25) above maximum (23): 25');
  });
});

describe('go-yaml errors', () => {
  it('accepts normal Kubernetes YAML', () => {
    const ok = [
      'a: 1\nb:\n  - x\n  - y\n',
      'containers:\n- name: web\n  image: nginx\nkind: Pod\n',
      'data:\n  script: |\n    echo "a: b"\n      indented: fine\n  other: x\n',
      'command: ["sh", "-c",\n  "echo hi"]\nnext: 1\n',
      'labels: {app: shop, "tier": web}\n',
      'note: "a: b # not a comment"\n# comment\nx: 1 # trailing\n',
      "msg: 'it''s fine'\n",
      'list:\n  - - a\n    - b\n  -\n    name: c\n',
      'key:\n  plain value\n  on two lines\n',
      '"quoted key": 1\n',
    ];
    for (const y of ok) expect(goYamlProblem(y), y).toBeNull();
  });

  it('copies go-yaml messages and line numbers', () => {
    expect(goYamlProblem('a: 1\n\tb: 2\n')).toMatchObject({ code: 'tab', goLine: 2 });
    expect(goYamlProblem('a:\n  b: 1\n c: 2\n')).toMatchObject({
      code: 'indentKey',
      goLine: 2,
      line: 3,
    });
    expect(goYamlProblem('a: x: y\n')).toMatchObject({ code: 'colonInValue', goLine: 1 });
    expect(goYamlProblem('a: "open\nb: 2\n')).toMatchObject({ code: 'unclosedQuote', goLine: 3 });
    expect(goYamlProblem('a: [1, 2\n')).toMatchObject({
      code: 'unclosedFlow',
      goLine: 1,
      message: "did not find expected ',' or ']'",
    });
  });

  it('splits documents like kubectl', () => {
    const docs = splitDocuments('a: 1\n---\nb: 2\n--- # two\n# only a comment\n---\nc: 3\n');
    expect(docs.map((d) => [d.text.trim(), d.startLine])).toEqual([
      ['a: 1', 1],
      ['b: 2', 3],
      ['c: 3', 7],
    ]);
  });
});
