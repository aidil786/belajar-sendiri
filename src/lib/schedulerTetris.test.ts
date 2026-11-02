import { describe, expect, it } from 'vitest';
import {
  checkBoard,
  fit,
  fitsOn,
  podYaml,
  schedulerMessage,
  solve,
  taintText,
  tolerates,
  type Placement,
  type TetrisNode,
  type TetrisPod,
} from './schedulerTetris';
import { kubectlApply } from './k8sSchema';

// The same three nodes we gave a real kube-scheduler v1.37.2; every message below is what it printed.
const nodes: TetrisNode[] = [
  { name: 'stall-a', cpu: '2', memory: '4Gi', labels: { zone: 'front' } },
  { name: 'stall-b', cpu: '2', memory: '2Gi', labels: { zone: 'back' } },
  {
    name: 'stall-c',
    cpu: '4',
    memory: '8Gi',
    labels: { zone: 'back', gpu: 'yes' },
    taints: [{ key: 'dedicated', value: 'gpu', effect: 'NoSchedule' }],
  },
];
const none: Placement = {};
const msg = (pod: TetrisPod, pods: TetrisPod[] = [pod], placement: Placement = none, n = nodes) =>
  schedulerMessage(pod, n, pods, placement);
const NOT_HELPFUL =
  'preemption: 0/3 nodes are available: 3 Preemption is not helpful for scheduling.';

describe('kube-scheduler 1.37 FailedScheduling messages', () => {
  it('too much memory everywhere it may go', () => {
    expect(msg({ name: 'big-mem', cpu: '100m', memory: '6Gi' })).toBe(
      `0/3 nodes are available: 1 node(s) had untolerated taint(s), 2 Insufficient memory. ${NOT_HELPFUL}`,
    );
  });
  it('too much cpu', () => {
    expect(msg({ name: 'big-cpu', cpu: '3', memory: '100Mi' })).toBe(
      `0/3 nodes are available: 1 node(s) had untolerated taint(s), 2 Insufficient cpu. ${NOT_HELPFUL}`,
    );
  });
  it('both, counted separately', () => {
    expect(msg({ name: 'both', cpu: '3', memory: '6Gi' })).toBe(
      `0/3 nodes are available: 1 node(s) had untolerated taint(s), 2 Insufficient cpu, 2 Insufficient memory. ${NOT_HELPFUL}`,
    );
  });
  it('nodeSelector and node affinity', () => {
    const want = `0/3 nodes are available: 1 node(s) had untolerated taint(s), 2 node(s) didn't match Pod's node affinity/selector. ${NOT_HELPFUL}`;
    expect(
      msg({ name: 'selector', cpu: '100m', memory: '100Mi', nodeSelector: { disk: 'ssd' } }),
    ).toBe(want);
    expect(
      msg({
        name: 'aff',
        cpu: '100m',
        memory: '100Mi',
        affinity: [{ key: 'zone', operator: 'In', values: ['side'] }],
      }),
    ).toBe(want);
    expect(
      msg({ name: 'gpu-no-tol', cpu: '100m', memory: '100Mi', nodeSelector: { gpu: 'yes' } }),
    ).toBe(want);
  });
  it('a key (toleration) opens the lock', () => {
    const pod: TetrisPod = {
      name: 'tol-ok',
      cpu: '100m',
      memory: '100Mi',
      nodeSelector: { gpu: 'yes' },
      tolerations: [{ key: 'dedicated', operator: 'Equal', value: 'gpu', effect: 'NoSchedule' }],
    };
    expect(msg(pod)).toBeNull();
    expect(fitsOn(pod, nodes, [pod], none)).toEqual(['stall-c']);
  });
  it('full nodes: preemption finds no victims where the pod could fit an empty node', () => {
    const pods: TetrisPod[] = [
      { name: 'fill-a', cpu: '1500m', memory: '1Gi', node: 'stall-a' },
      { name: 'fill-b', cpu: '500m', memory: '1536Mi', node: 'stall-b' },
      { name: 't-cpu', cpu: '1', memory: '256Mi', node: 'stall-b' },
    ];
    const placement: Placement = { 'fill-a': 'stall-a', 'fill-b': 'stall-b', 't-cpu': 'stall-b' };
    const both: TetrisPod = { name: 't-both', cpu: '1', memory: '3Gi' };
    expect(msg(both, [...pods, both], placement)).toBe(
      '0/3 nodes are available: 1 Insufficient memory, 1 node(s) had untolerated taint(s), 2 Insufficient cpu. preemption: 0/3 nodes are available: 1 No preemption victims found for incoming pod, 2 Preemption is not helpful for scheduling.',
    );
    const mem: TetrisPod = {
      name: 't-mem',
      cpu: '100m',
      memory: '1Gi',
      nodeSelector: { zone: 'back' },
    };
    expect(msg(mem, [...pods, mem], placement)).toBe(
      "0/3 nodes are available: 1 Insufficient memory, 1 node(s) didn't match Pod's node affinity/selector, 1 node(s) had untolerated taint(s). preemption: 0/3 nodes are available: 1 No preemption victims found for incoming pod, 2 Preemption is not helpful for scheduling.",
    );
  });
  it('a cordoned node', () => {
    const cordoned = nodes.map((n) => (n.name === 'stall-a' ? { ...n, unschedulable: true } : n));
    expect(msg({ name: 't-cordon', cpu: '100m', memory: '3Gi' }, undefined, none, cordoned)).toBe(
      `0/3 nodes are available: 1 Insufficient memory, 1 node(s) had untolerated taint(s), 1 node(s) were unschedulable. ${NOT_HELPFUL}`,
    );
  });
});

describe('fit rules', () => {
  it('tolerations follow Kubernetes rules', () => {
    const taint = { key: 'dedicated', value: 'gpu', effect: 'NoSchedule' as const };
    expect(tolerates({ operator: 'Exists' }, taint)).toBe(true);
    expect(tolerates({ key: 'dedicated', operator: 'Exists' }, taint)).toBe(true);
    expect(tolerates({ key: 'dedicated', value: 'gpu' }, taint)).toBe(true);
    expect(tolerates({ key: 'dedicated', value: 'cpu' }, taint)).toBe(false);
    expect(tolerates({ key: 'dedicated', value: 'gpu', effect: 'NoExecute' }, taint)).toBe(false);
  });
  it('PreferNoSchedule does not block', () => {
    const n: TetrisNode = {
      name: 'soft',
      cpu: '1',
      memory: '1Gi',
      taints: [{ key: 'soft', value: 'yes', effect: 'PreferNoSchedule' }],
    };
    expect(fit({ name: 'p', cpu: '100m', memory: '64Mi' }, n, [], none).fits).toBe(true);
  });
  it('the scheduler checks taints before resources', () => {
    expect(fit({ name: 'p', cpu: '64', memory: '1Ti' }, nodes[2]!, [], none)).toEqual({
      fits: false,
      reasons: ['taint'],
      unresolvable: true,
    });
  });
});

describe('the board', () => {
  const pods: TetrisPod[] = [
    { name: 'tray-1', cpu: '1500m', memory: '1Gi' },
    { name: 'tray-2', cpu: '1', memory: '1Gi' },
    { name: 'tray-3', cpu: '500m', memory: '512Mi' },
    { name: 'giant', cpu: '8', memory: '1Gi' },
  ];
  const two = nodes.slice(0, 2);
  it('is done when every tray is on a stall, or Pending because it fits nowhere', () => {
    const board: Placement = {
      'tray-1': 'stall-a',
      'tray-2': 'stall-b',
      'tray-3': 'stall-a',
      giant: 'pending',
    };
    expect(checkBoard({ type: 'placeAll', pending: ['giant'] }, two, pods, board).done).toBe(true);
    expect(
      checkBoard({ type: 'placeAll', pending: ['giant'] }, two, pods, {
        ...board,
        'tray-3': 'pending',
      }),
    ).toMatchObject({ done: false, wrongPending: ['tray-3'] });
    expect(checkBoard({ type: 'placeAll' }, two, pods, { ...board, giant: null })).toMatchObject({
      done: false,
      waiting: ['giant'],
    });
  });
  it('can be solved by the author check', () => {
    const s = solve({ type: 'placeAll', pending: ['giant'] }, two, pods);
    expect(s).not.toBeNull();
    expect(s!.giant).toBe('pending');
    expect(solve({ type: 'placeAll' }, two, pods)).toBeNull();
  });
  it('a key handed to a tray counts', () => {
    const gpu: TetrisPod = {
      name: 'gpu-job',
      cpu: '2',
      memory: '4Gi',
      nodeSelector: { gpu: 'yes' },
    };
    expect(checkBoard({ type: 'placeAll' }, nodes, [gpu], { 'gpu-job': 'pending' }).done).toBe(
      true,
    );
    const keys = {
      'gpu-job': [
        {
          key: 'dedicated',
          operator: 'Equal' as const,
          value: 'gpu',
          effect: 'NoSchedule' as const,
        },
      ],
    };
    expect(
      checkBoard({ type: 'placeAll' }, nodes, [gpu], { 'gpu-job': 'pending' }, keys),
    ).toMatchObject({ done: false, wrongPending: ['gpu-job'] });
    expect(solve({ type: 'placeAll' }, nodes, [gpu], keys)).toEqual({ 'gpu-job': 'stall-c' });
  });
});

describe('YAML for the state panel', () => {
  it('is a valid Pod', () => {
    const y = podYaml({ name: 'gpu-job', cpu: '2', memory: '4Gi', nodeSelector: { gpu: 'yes' } }, [
      { key: 'dedicated', operator: 'Equal', value: 'gpu', effect: 'NoSchedule' },
    ]);
    expect(kubectlApply(y, 'pod.yaml').lines.map((l) => l.text)).toEqual(['pod/gpu-job created']);
    expect(y).toContain('nodeSelector:\n    gpu: "yes"');
  });
  it('writes taints like kubectl', () => {
    expect(taintText({ key: 'dedicated', value: 'gpu', effect: 'NoSchedule' })).toBe(
      'dedicated=gpu:NoSchedule',
    );
  });
});
