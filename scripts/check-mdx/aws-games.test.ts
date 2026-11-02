import { describe, expect, it } from 'vitest';
import {
  gateNaclDemo,
  gateSgDemo,
  iamEditDemo,
  iamPredictDemo,
  iamRoleDemo,
  idleDemo,
  subnetDemo,
  subnetVpcDemo,
} from '../../src/lib/aws/demos';
import { checkAwsGame } from './aws-games';

const check = (name: string, a: Record<string, unknown>) => checkAwsGame(name, a, 'x');

describe('author checks for the AWS games', () => {
  it('the dev page demos pass', () => {
    expect(check('IamJudge', iamPredictDemo)).toEqual([]);
    expect(check('IamJudge', iamRoleDemo)).toEqual([]);
    expect(check('IamJudge', iamEditDemo)).toEqual([]);
    expect(check('SubnetPlanner', subnetDemo)).toEqual([]);
    expect(check('SubnetPlanner', subnetVpcDemo)).toEqual([]);
    expect(check('SecurityGroupGate', gateSgDemo)).toEqual([]);
    expect(check('SecurityGroupGate', gateNaclDemo)).toEqual([]);
    expect(check('IdleBill', idleDemo)).toEqual([]);
    expect(check('IdleBill', {})).toEqual([]);
  });

  it('IamJudge refuses what the evaluator does not model, and impossible or finished edit tasks', () => {
    const star = { ...iamPredictDemo, policies: [{ name: 'p', kind: 'resource', doc: { Statement: { Effect: 'Allow', Principal: { AWS: '*' }, Action: 's3:*', Resource: '*' } } }] };
    expect(check('IamJudge', star)).toEqual(['x: IamJudge policy "p" is not modelled: principalType (*)']);
    expect(check('IamJudge', { ...iamEditDemo, task: { ...iamEditDemo.task, want: 'Deny' } })).toContain('x: IamJudge task is already done before the learner starts');
    expect(check('IamJudge', { ...iamEditDemo, solution: '"Action": "s3:*",' })).toContain('x: IamJudge solution matches `forbid`');
    expect(check('IamJudge', { ...iamEditDemo, solution: '"Action": "s3:ListBucket",' })).toContain('x: IamJudge solution does not make AWS say Allow');
    expect(check('IamJudge', { ...iamPredictDemo, request: { ...iamPredictDemo.request, principal: 'aina' } })[0]).toMatch(/request.principal/);
    const long = {
      ...iamPredictDemo,
      policies: [{ name: 'big', kind: 'identity', doc: { Version: '2012-10-17', Statement: [1, 2, 3].map((n) => ({ Sid: `S${n}`, Effect: 'Allow', Action: 's3:GetObject', Resource: '*' })) } }],
    };
    expect(check('IamJudge', long)[0]).toMatch(/lines on the card/);
  });

  it('SubnetPlanner: a brief that cannot fit, a plan already done, a bad VPC', () => {
    expect(check('SubnetPlanner', { vpc: '10.0.0.0/24', need: { public: 200, private: 200 } })).toEqual(['x: SubnetPlanner the brief cannot fit in this VPC']);
    expect(
      check('SubnetPlanner', {
        vpc: '10.0.0.0/16',
        tiers: ['public'],
        azs: ['a'],
        start: [{ tier: 'public', az: 'a', cidr: '10.0.0.0/24' }],
      }),
    ).toEqual(['x: SubnetPlanner task is already done before the learner starts']);
    expect(check('SubnetPlanner', { vpc: '10.0.0.0/8' })).toEqual(['x: SubnetPlanner vpc 10.0.0.0/8 is not a valid VPC block']);
  });

  it('SecurityGroupGate: done at the start, or impossible with the editable guard', () => {
    const open = { ...gateSgDemo, forbidOpen: [], sg: [{ protocol: 'tcp', ports: '443', source: '0.0.0.0/0' }, { protocol: 'tcp', ports: '22', source: '203.0.113.9/32' }] };
    expect(check('SecurityGroupGate', open)).toEqual(['x: SecurityGroupGate task is already done before the learner starts']);
    // A custom NACL blocks everything and the learner may only edit the security group.
    expect(check('SecurityGroupGate', { ...gateSgDemo, nacl: 'custom' })).toEqual([
      'x: SecurityGroupGate the task cannot be met by changing only the rules the learner may edit',
    ]);
    expect(check('SecurityGroupGate', { ...gateSgDemo, sg: [{ protocol: 'tcp', ports: '22', source: '203.0.113.9' }] })[0]).toMatch(/cidr/);
  });

  it('IdleBill: known items from both buckets', () => {
    expect(check('IdleBill', { items: ['natGateway', 'nope'] })).toContain('x: IdleBill unknown item "nope"');
    expect(check('IdleBill', { items: ['natGateway', 'ebsDetached'] })).toEqual(['x: IdleBill needs items from both buckets (costs and free)']);
  });
});
