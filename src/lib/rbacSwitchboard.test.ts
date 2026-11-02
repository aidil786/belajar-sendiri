import { describe, expect, it } from 'vitest';
import { kubectlApply } from './k8sSchema';
import {
  allAnswered,
  bindingYaml,
  canBind,
  canI,
  canIOutput,
  makeBinding,
  roleYaml,
  ruleAllows,
  type RbacModel,
} from './rbacSwitchboard';

// The same roles and bindings we created on a real kube-apiserver v1.37.2 (RBAC on).
// Every expected answer below is what `kubectl auth can-i` printed there.
const model: RbacModel = {
  roles: [
    {
      kind: 'Role',
      name: 'deployer',
      namespace: 'shop',
      rules: [
        {
          apiGroups: ['apps'],
          resources: ['deployments'],
          verbs: ['get', 'list', 'watch', 'update', 'patch'],
        },
      ],
    },
    {
      kind: 'ClusterRole',
      name: 'pod-reader',
      rules: [{ apiGroups: [''], resources: ['pods', 'pods/log'], verbs: ['get', 'list'] }],
    },
    {
      kind: 'ClusterRole',
      name: 'everything',
      rules: [{ apiGroups: ['*'], resources: ['*'], verbs: ['*'] }],
    },
    {
      kind: 'ClusterRole',
      name: 'node-viewer',
      rules: [{ apiGroups: [''], resources: ['nodes'], verbs: ['get', 'list'] }],
    },
  ],
  bindings: [
    {
      kind: 'RoleBinding',
      name: 'ci-deployer',
      namespace: 'shop',
      roleRef: { kind: 'Role', name: 'deployer' },
      subjects: [{ kind: 'ServiceAccount', name: 'ci-bot', namespace: 'ci' }],
    },
    {
      kind: 'RoleBinding',
      name: 'mei-reads-pods',
      namespace: 'shop',
      roleRef: { kind: 'ClusterRole', name: 'pod-reader' },
      subjects: [{ kind: 'User', name: 'mei' }],
    },
    {
      kind: 'ClusterRoleBinding',
      name: 'sam-reads-pods',
      roleRef: { kind: 'ClusterRole', name: 'pod-reader' },
      subjects: [{ kind: 'User', name: 'sam' }],
    },
    {
      kind: 'RoleBinding',
      name: 'aina-everything-in-shop',
      namespace: 'shop',
      roleRef: { kind: 'ClusterRole', name: 'everything' },
      subjects: [{ kind: 'User', name: 'aina' }],
    },
    {
      kind: 'RoleBinding',
      name: 'aina-nodes',
      namespace: 'shop',
      roleRef: { kind: 'ClusterRole', name: 'node-viewer' },
      subjects: [{ kind: 'User', name: 'aina' }],
    },
    {
      kind: 'RoleBinding',
      name: 'all-ci-sas-read',
      namespace: 'shop',
      roleRef: { kind: 'ClusterRole', name: 'pod-reader' },
      subjects: [{ kind: 'Group', name: 'system:serviceaccounts:ci' }],
    },
  ],
};
const BOT = 'ServiceAccount:ci:ci-bot';
const ask = (as: string, verb: string, resource: string, namespace?: string) =>
  canIOutput(canI(model, { as, verb, resource, namespace })).join('\n');

describe('kubectl auth can-i, as Kubernetes 1.37 answers', () => {
  it.each([
    [BOT, 'patch', 'deployments', 'shop', 'yes'],
    [BOT, 'patch', 'deployments.apps', 'shop', 'yes'],
    [BOT, 'delete', 'deployments', 'shop', 'no'],
    [BOT, 'patch', 'deployments', 'default', 'no'],
    [BOT, 'get', 'secrets', 'shop', 'no'],
    [BOT, 'list', 'pods', 'shop', 'yes'],
    [BOT, 'get', 'pods/log', 'shop', 'yes'],
    [BOT, 'create', 'deployments', 'shop', 'no'],
    ['User:mei', 'list', 'pods', 'shop', 'yes'],
    ['User:mei', 'list', 'pods', 'default', 'no'],
    ['User:sam', 'list', 'pods', 'default', 'yes'],
    ['User:sam', 'list', 'pods', '*', 'yes'],
    ['User:mei', 'list', 'pods', '*', 'no'],
    ['User:aina', 'delete', 'secrets', 'shop', 'yes'],
    ['User:aina', 'delete', 'secrets', 'ci', 'no'],
    ['ServiceAccount:ci:other', 'get', 'pods', 'shop', 'yes'],
  ])('%s %s %s -n %s → %s', (as, verb, resource, ns, want) => {
    expect(ask(as, verb, resource, ns)).toBe(want);
  });

  it('warns first for cluster-wide resources, unknown resources and verbs', () => {
    expect(ask('User:aina', 'list', 'nodes')).toBe(
      "Warning: resource 'nodes' is not namespace scoped\n\nno",
    );
    // A RoleBinding in shop says yes when you ask inside shop, even for nodes (and kubectl warns).
    expect(ask('User:aina', 'list', 'nodes', 'shop')).toBe(
      "Warning: resource 'nodes' is not namespace scoped\n\nyes",
    );
    expect(ask('User:sam', 'list', 'nodes')).toBe(
      "Warning: resource 'nodes' is not namespace scoped\n\nno",
    );
    expect(ask('User:aina', 'list', 'foos', 'shop')).toBe(
      "Warning: the server doesn't have a resource type 'foos'\n\nyes",
    );
    expect(ask(BOT, 'fly', 'deployments', 'shop')).toBe(
      "Warning: verb 'fly' is not a known verb\n\nno",
    );
    expect(ask('User:aina', 'create', 'namespaces')).toBe(
      "Warning: resource 'namespaces' is not namespace scoped\n\nno",
    );
  });

  it('builds the command', () => {
    expect(
      canI(model, { as: BOT, verb: 'patch', resource: 'deployments', namespace: 'shop' }).command,
    ).toBe('kubectl auth can-i patch deployments -n shop --as=system:serviceaccount:ci:ci-bot');
    expect(
      canI(model, { as: 'User:sam', verb: 'list', resource: 'pods', namespace: '*' }).command,
    ).toBe('kubectl auth can-i list pods -A --as=sam');
    expect(
      canI(model, { as: BOT, verb: 'get', resource: 'pods/log', namespace: 'shop' }).command,
    ).toBe(
      'kubectl auth can-i get pods --subresource=log -n shop --as=system:serviceaccount:ci:ci-bot',
    );
  });

  it('says which binding allowed it', () => {
    expect(
      canI(model, { as: BOT, verb: 'patch', resource: 'deployments', namespace: 'shop' }).by
        ?.binding.name,
    ).toBe('ci-deployer');
  });
});

describe('rules', () => {
  it('match verbs, groups, resources, subresources', () => {
    const r = { apiGroups: [''], resources: ['pods', '*/log'], verbs: ['get'] };
    expect(ruleAllows(r, 'get', '', 'pods')).toBe(true);
    expect(ruleAllows(r, 'get', '', 'services', 'log')).toBe(true);
    expect(ruleAllows(r, 'get', 'apps', 'pods')).toBe(false);
    expect(ruleAllows({ ...r, resourceNames: ['menu'] }, 'get', '', 'pods')).toBe(false);
  });
  it('a Role can only be bound in its own namespace', () => {
    expect(canBind(model.roles[0]!, 'shop')).toBe(true);
    expect(canBind(model.roles[0]!, 'default')).toBe(false);
    expect(canBind(model.roles[0]!, '*')).toBe(false);
    expect(canBind(model.roles[1]!, '*')).toBe(true);
  });
  it('checks a CI-bot task', () => {
    const empty: RbacModel = { roles: model.roles, bindings: [] };
    const qs = [
      { as: BOT, verb: 'patch', resource: 'deployments', namespace: 'shop', expect: true },
      { as: BOT, verb: 'get', resource: 'secrets', namespace: 'shop', expect: false },
    ];
    expect(allAnswered(empty, qs)).toBe(false);
    const wired = {
      ...empty,
      bindings: [
        makeBinding(
          { kind: 'ServiceAccount', name: 'ci-bot', namespace: 'ci' },
          model.roles[0]!,
          'shop',
        ),
      ],
    };
    expect(allAnswered(wired, qs)).toBe(true);
    const tooMuch = {
      ...empty,
      bindings: [
        makeBinding(
          { kind: 'ServiceAccount', name: 'ci-bot', namespace: 'ci' },
          model.roles[2]!,
          '*',
        ),
      ],
    };
    expect(allAnswered(tooMuch, qs)).toBe(false);
  });
});

describe('YAML', () => {
  it('bindings and roles apply', () => {
    const files = [
      ...model.roles.map(roleYaml),
      ...model.bindings.map(bindingYaml),
      bindingYaml(makeBinding({ kind: 'User', name: 'mei' }, model.roles[1]!, '*')),
    ].join('---\n');
    const r = kubectlApply(files, 'rbac.yaml', { namespaces: ['shop'] });
    expect(r.ok).toBe(true);
    expect(r.lines).toHaveLength(11);
  });
});
