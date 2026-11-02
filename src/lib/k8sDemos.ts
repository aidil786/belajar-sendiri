// Props for the Kubernetes game demos on the hidden test page (/<lang>/dev/interactives/).
// `npm run verify:manifests` renders the YAML these demos show and checks it with kubeconform,
// so the page and the checks always use the same data.
import { fixture } from './k8sFixtures';
import type { TraceConfig } from './requestTracer';
import type { RbacBinding, RbacRole, RbacSubject, CanIQuestion } from './rbacSwitchboard';
import type { TetrisNode, TetrisPod, Toleration } from './schedulerTetris';

export const schedDemo = {
  nodes: [
    { name: 'stall-a', cpu: '2', memory: '4Gi', labels: { zone: 'front' } },
    { name: 'stall-b', cpu: '2', memory: '2Gi', labels: { zone: 'back' } },
    {
      name: 'stall-c',
      cpu: '4',
      memory: '8Gi',
      labels: { zone: 'back', gpu: 'yes' },
      taints: [{ key: 'dedicated', value: 'gpu', effect: 'NoSchedule' }],
    },
  ] as TetrisNode[],
  pods: [
    { name: 'tray-1', cpu: '1500m', memory: '1Gi' },
    { name: 'tray-2', cpu: '1', memory: '1Gi' },
    { name: 'tray-3', cpu: '500m', memory: '512Mi' },
    { name: 'gpu-job', cpu: '2', memory: '4Gi', nodeSelector: { gpu: 'yes' } },
    { name: 'giant', cpu: '8', memory: '2Gi' },
  ] as TetrisPod[],
  keys: [
    { key: 'dedicated', operator: 'Equal', value: 'gpu', effect: 'NoSchedule' },
  ] as Toleration[],
  task: { type: 'placeAll' as const, pending: ['giant'] },
};

export const labelsDemo = {
  pods: [
    { name: 'tray-1', labels: { app: 'shop' } },
    { name: 'tray-2', labels: { app: 'shop', tier: 'web' } },
    { name: 'tray-3', labels: { app: 'api' } },
  ],
  labels: ['tier=web', 'app=shop', 'app=api'],
  selector: { app: 'shop', tier: 'web' },
  task: { type: 'select' as const, pods: ['tray-1', 'tray-2'] },
};

export const templateDemo = {
  pods: [],
  labels: ['app=shop', 'tier=web'],
  selector: { app: 'shop' },
  templateLabels: { app: 'web' },
  task: { type: 'template' as const },
};

export const traceDemo: TraceConfig = {
  host: 'kedai.example',
  gateway: { name: 'entrance', port: 80 },
  route: {
    name: 'shop',
    rules: [
      { path: '/api', service: 'api', port: 80 },
      { path: '/', service: 'web', port: 80 },
    ],
  },
  services: [
    { name: 'api', port: 80, targetPort: 3000, selector: { app: 'api' } },
    { name: 'web', port: 80, targetPort: 8080, selector: { app: 'web' } },
  ],
  pods: [
    { name: 'api-7d4f9-x2kq4', labels: { app: 'api' }, containerPort: 3000 },
    { name: 'api-7d4f9-m8wzt', labels: { app: 'api' }, containerPort: 3000 },
    { name: 'web-5c8b6-p5rjc', labels: { app: 'web' }, containerPort: 8080 },
  ],
  policy: { name: 'lock-api', allowGateway: true },
  request: { path: '/api/menu' },
};

export const rbacDemo = {
  subjects: [
    { kind: 'ServiceAccount', name: 'ci-bot', namespace: 'ci' },
    { kind: 'User', name: 'mei' },
  ] as RbacSubject[],
  roles: [
    {
      kind: 'Role',
      name: 'deployer',
      namespace: 'shop',
      rules: [{ apiGroups: ['apps'], resources: ['deployments'], verbs: ['get', 'list', 'patch'] }],
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
  ] as RbacRole[],
  bindings: [
    {
      kind: 'ClusterRoleBinding',
      name: 'ci-bot-everything',
      roleRef: { kind: 'ClusterRole', name: 'everything' },
      subjects: [{ kind: 'ServiceAccount', name: 'ci-bot', namespace: 'ci' }],
    },
  ] as RbacBinding[],
  questions: [
    {
      as: 'ServiceAccount:ci:ci-bot',
      verb: 'patch',
      resource: 'deployments',
      namespace: 'shop',
      expect: true,
    },
    {
      as: 'ServiceAccount:ci:ci-bot',
      verb: 'get',
      resource: 'secrets',
      namespace: 'shop',
      expect: false,
    },
    {
      as: 'ServiceAccount:ci:ci-bot',
      verb: 'delete',
      resource: 'deployments',
      namespace: 'shop',
      expect: false,
    },
    {
      as: 'ServiceAccount:ci:ci-bot',
      verb: 'patch',
      resource: 'deployments',
      namespace: 'default',
      expect: false,
    },
  ] as CanIQuestion[],
};

export const rbacPredictDemo = {
  subjects: rbacDemo.subjects,
  roles: rbacDemo.roles,
  bindings: [
    {
      kind: 'RoleBinding',
      name: 'ci-bot-deployer',
      namespace: 'shop',
      roleRef: { kind: 'Role', name: 'deployer' },
      subjects: [{ kind: 'ServiceAccount', name: 'ci-bot', namespace: 'ci' }],
    },
    {
      kind: 'ClusterRoleBinding',
      name: 'mei-pod-reader',
      roleRef: { kind: 'ClusterRole', name: 'pod-reader' },
      subjects: [{ kind: 'User', name: 'mei' }],
    },
  ] as RbacBinding[],
  questions: [
    { as: 'ServiceAccount:ci:ci-bot', verb: 'patch', resource: 'deployments', namespace: 'shop' },
    {
      as: 'ServiceAccount:ci:ci-bot',
      verb: 'patch',
      resource: 'deployments',
      namespace: 'default',
    },
    { as: 'User:mei', verb: 'list', resource: 'pods', namespace: 'ci' },
  ] as CanIQuestion[],
};

export const mirrorApp = {
  name: 'shop',
  namespace: 'shop',
  replicas: 3,
  image: 'ghcr.io/kedai-kancil/shop:1.4.0',
};

export const doctorDemo = {
  ...fixture('indent'),
  hint: 'Line up ports: with image: (6 spaces).',
  keep: ['containerPort: 80'],
};
export const doctorTypoDemo = {
  ...fixture('typo'),
  hint: 'Look at the word under spec: in the template.',
  keep: ['replicas: 3', 'image: nginx'],
};
