import { describe, expect, it } from 'vitest';
import {
  doctorDemo,
  labelsDemo,
  mirrorApp,
  rbacDemo,
  rbacPredictDemo,
  schedDemo,
  templateDemo,
  traceDemo,
} from '../../src/lib/k8sDemos';
import { checkK8sInteractive } from './k8s-games';

const check = (name: string, a: Record<string, unknown>) => checkK8sInteractive(name, a, 'x');

describe('author checks for the Kubernetes games', () => {
  it('the dev page demos pass', () => {
    expect(check('SchedulerTetris', schedDemo)).toEqual([]);
    expect(check('LabelMatchmaker', labelsDemo)).toEqual([]);
    expect(check('LabelMatchmaker', templateDemo)).toEqual([]);
    expect(
      check('RequestTracer', {
        route: traceDemo,
        breaks: ['ready', 'policy'],
        task: { type: 'outcome', want: '503' },
      }),
    ).toEqual([]);
    expect(
      check('RequestTracer', {
        route: traceDemo,
        breaks: ['targetPort'],
        broken: ['targetPort'],
        task: { type: 'deliver' },
      }),
    ).toEqual([]);
    expect(
      check('YamlDoctor', {
        manifest: doctorDemo.broken,
        solution: doctorDemo.fixed,
        file: doctorDemo.file,
        keep: doctorDemo.keep,
      }),
    ).toEqual([]);
    expect(check('RbacSwitchboard', rbacDemo)).toEqual([]);
    expect(check('RbacSwitchboard', { ...rbacPredictDemo, task: { type: 'predict' } })).toEqual([]);
    expect(
      check('GitOpsMirror', {
        app: mirrorApp,
        task: { type: 'gitChange', field: 'replicas', to: 5 },
      }),
    ).toEqual([]);
  });

  it('catch impossible or already-done tasks', () => {
    expect(check('SchedulerTetris', { ...schedDemo, task: { type: 'placeAll' } })).toEqual([
      'x: SchedulerTetris has no solution (check sizes, locks, signs and task.pending)',
    ]);
    expect(
      check('LabelMatchmaker', { ...labelsDemo, task: { type: 'select', pods: ['tray-2'] } }),
    ).toEqual(['x: LabelMatchmaker task is already done before the learner starts']);
    expect(
      check('RequestTracer', {
        route: traceDemo,
        breaks: ['path'],
        task: { type: 'outcome', want: '503' },
      }),
    ).toEqual(['x: RequestTracer no single break gives "503"']);
    expect(check('YamlDoctor', { manifest: doctorDemo.fixed })).toEqual([
      'x: YamlDoctor manifest already applies; break it in one place',
    ]);
    expect(
      check('YamlDoctor', { manifest: doctorDemo.broken, solution: doctorDemo.broken })[0],
    ).toMatch(/solution does not apply/);
    expect(
      check('RbacSwitchboard', {
        ...rbacDemo,
        bindings: [
          {
            kind: 'RoleBinding',
            name: 'ok',
            namespace: 'shop',
            roleRef: { kind: 'Role', name: 'deployer' },
            subjects: [rbacDemo.subjects[0]],
          },
        ],
      }),
    ).toEqual(['x: RbacSwitchboard task is already done before the learner starts']);
    expect(
      check('GitOpsMirror', {
        app: mirrorApp,
        task: { type: 'gitChange', field: 'replicas', to: 3 },
      }),
    ).toEqual(['x: GitOpsMirror task is already done before the learner starts']);
  });
});
