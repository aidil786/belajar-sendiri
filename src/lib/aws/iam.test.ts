// IAM evaluation tests. Each block names the IAM User Guide page whose worked example it replays
// (policies copied from the docs' examples, account 123456789012 / 111122223333 as in the docs).
import { describe, expect, it } from 'vitest';
import {
  actionMatches,
  arnMatches,
  editLine,
  evalConditionKey,
  evaluate,
  formatPolicy,
  parsePolicy,
  validatePolicy,
  type NamedPolicy,
  type PolicyDoc,
} from './iam';

const policy = (name: string, kind: NamedPolicy['kind'], doc: PolicyDoc, level?: string): NamedPolicy => ({ name, kind, doc, level });

describe('Action element (reference_policies_elements_action)', () => {
  it('"The prefix and the action name are case insensitive"', () => {
    expect(actionMatches('iam:ListAccessKeys', 'IAM:listaccesskeys')).toBe(true);
  });
  it('"iam:*AccessKey*" covers CreateAccessKey, DeleteAccessKey, ListAccessKeys and UpdateAccessKey', () => {
    for (const a of ['iam:CreateAccessKey', 'iam:DeleteAccessKey', 'iam:ListAccessKeys', 'iam:UpdateAccessKey'])
      expect(actionMatches('iam:*AccessKey*', a)).toBe(true);
    expect(actionMatches('iam:*AccessKey*', 'iam:CreateUser')).toBe(false);
  });
  it('"s3:*" applies to all S3 actions; ? is one character', () => {
    expect(actionMatches('s3:*', 's3:PutObject')).toBe(true);
    expect(actionMatches('s3:*', 'ec2:RunInstances')).toBe(false);
    expect(actionMatches('s3:?etObject', 's3:GetObject')).toBe(true);
  });
});

describe('Resource wildcards (reference_policies_elements_resource)', () => {
  const p = 'arn:aws:s3:::amzn-s3-demo-bucket/*/test/*';
  it('matches every object the doc lists', () => {
    for (const k of [
      'amzn-s3-demo-bucket/1/test/object.jpg',
      'amzn-s3-demo-bucket/1/2/test/object.jpg',
      'amzn-s3-demo-bucket/1/2/test/3/object.jpg',
      'amzn-s3-demo-bucket/1/2/3/test/4/object.jpg',
      'amzn-s3-demo-bucket/1///test///object.jpg',
      'amzn-s3-demo-bucket/1/test/.jpg',
      'amzn-s3-demo-bucket//test/object.jpg',
      'amzn-s3-demo-bucket/1/test/',
    ])
      expect(arnMatches(p, `arn:aws:s3:::${k}`), k).toBe(true);
  });
  it('and none of the objects it says do not match', () => {
    for (const k of ['amzn-s3-demo-bucket/1-test/object.jpg', 'amzn-s3-demo-bucket/test/object.jpg', 'amzn-s3-demo-bucket/1/2/test.jpg'])
      expect(arnMatches(p, `arn:aws:s3:::${k}`), k).toBe(false);
  });
  it('"In the Resource element, the IAM user name is case sensitive"', () => {
    expect(arnMatches('arn:aws:iam::123456789012:user/Bob', 'arn:aws:iam::123456789012:user/bob')).toBe(false);
  });
  it('"*" matches everything; a trailing * can reach past colons', () => {
    expect(arnMatches('*', 'arn:aws:sqs:us-east-2:123456789012:queue1')).toBe(true);
    expect(arnMatches('arn:aws:sqs:*', 'arn:aws:sqs:us-east-2:123456789012:queue1')).toBe(true);
    expect(arnMatches('arn:aws:sqs:us-east-2', 'arn:aws:sqs:us-east-2:123456789012:queue1')).toBe(false);
  });
  it('refuses a wildcard in the service part ("You can\'t use a wildcard in the service segment")', () => {
    const issues = validatePolicy({ Statement: { Effect: 'Allow', Action: 's3:*', Resource: 'arn:aws:s*:::x' } }, 'identity');
    expect(issues).toEqual([{ code: 'serviceWildcard', statement: 0, value: 'arn:aws:s*:::x' }]);
  });
});

describe('Explicit vs implicit deny (reference_policies_evaluation-logic_AccessPolicyLanguage_Interplay)', () => {
  const doc: PolicyDoc = {
    Version: '2012-10-17',
    Statement: [
      { Sid: 'AllowGetList', Effect: 'Allow', Action: ['iam:Get*', 'iam:List*'], Resource: '*' },
      { Sid: 'DenyReports', Effect: 'Deny', Action: 'iam:*Report', Resource: '*' },
    ],
  };
  const user = 'arn:aws:iam::123456789012:user/dev';
  const run = (action: string, extra: NamedPolicy[] = []) =>
    evaluate({ principal: user, action, resource: '*' }, [policy('p', 'identity', doc), ...extra]);
  it('Get* and List* are allowed', () => {
    expect(run('iam:GetUser')).toMatchObject({ decision: 'Allow', decidedBy: 'end' });
  });
  it('"All other actions in IAM, such as iam:CreatePolicy are implicitly denied"', () => {
    expect(run('iam:CreatePolicy')).toMatchObject({ decision: 'Deny', denyKind: 'implicit', decidedBy: 'identity' });
  });
  it('"iam:GetOrganizationsAccessReport" is explicitly denied, even though Get* allows it', () => {
    const e = run('iam:GetOrganizationsAccessReport');
    expect(e).toMatchObject({ decision: 'Deny', denyKind: 'explicit', decidedBy: 'deny' });
    expect(e.steps[0]!.hits.map((h) => h.sid)).toEqual(['DenyReports']);
  });
  it('another policy allowing iam:GenerateCredentialReport does not help: "still denied"', () => {
    const more = policy('more', 'identity', { Statement: { Effect: 'Allow', Action: 'iam:GenerateCredentialReport', Resource: '*' } });
    expect(run('iam:GenerateCredentialReport', [more])).toMatchObject({ decision: 'Deny', denyKind: 'explicit' });
  });
});

describe('Identity + resource-based policy, one account (reference_policies_evaluation-logic_policy-eval-basics: Carlos)', () => {
  const carlos = 'arn:aws:iam::123456789012:user/carlossalazar';
  const identity = policy('carlos', 'identity', {
    Version: '2012-10-17',
    Statement: [
      {
        Sid: 'AllowS3ListRead',
        Effect: 'Allow',
        Action: ['s3:GetBucketLocation', 's3:GetAccountPublicAccessBlock', 's3:ListAccessPoints', 's3:ListAllMyBuckets'],
        Resource: 'arn:aws:s3:::*',
      },
      {
        Sid: 'AllowS3Self',
        Effect: 'Allow',
        Action: 's3:*',
        Resource: ['arn:aws:s3:::amzn-s3-demo-bucket-carlossalazar/*', 'arn:aws:s3:::amzn-s3-demo-bucket-carlossalazar'],
      },
      { Sid: 'DenyS3Logs', Effect: 'Deny', Action: 's3:*', Resource: 'arn:aws:s3:::*log*' },
    ],
  });
  const bucket = policy('bucket', 'resource', {
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Principal: { AWS: carlos },
        Action: 's3:*',
        Resource: ['arn:aws:s3:::amzn-s3-demo-bucket-carlossalazar/*', 'arn:aws:s3:::amzn-s3-demo-bucket-carlossalazar'],
      },
    ],
  });
  it('saving to the -logs bucket: "It finds one … Carlos is denied access"', () => {
    const e = evaluate({ principal: carlos, action: 's3:PutObject', resource: 'arn:aws:s3:::amzn-s3-demo-bucket-carlossalazar-logs/report.txt' }, [identity, bucket]);
    expect(e).toMatchObject({ decision: 'Deny', denyKind: 'explicit', decidedBy: 'deny' });
    expect(e.steps[0]!.hits[0]).toMatchObject({ policy: 0, sid: 'DenyS3Logs' });
  });
  it('saving to his own bucket: "Both … allow the request. Therefore, AWS allows the request."', () => {
    const e = evaluate({ principal: carlos, action: 's3:PutObject', resource: 'arn:aws:s3:::amzn-s3-demo-bucket-carlossalazar/report.txt' }, [identity, bucket]);
    expect(e).toMatchObject({ decision: 'Allow', decidedBy: 'resource' });
  });
  it('"If one of the policy types allows the request and the other doesn\'t, the request is still allowed"', () => {
    const req = { principal: carlos, action: 's3:PutObject', resource: 'arn:aws:s3:::amzn-s3-demo-bucket-carlossalazar/report.txt' };
    expect(evaluate(req, [identity]).decision).toBe('Allow');
    expect(evaluate(req, [policy('none', 'identity', { Statement: [] }), bucket]).decision).toBe('Allow');
  });
});

describe('Permissions boundaries (access_policies_boundaries)', () => {
  const shirley = 'arn:aws:iam::123456789012:user/Shirley';
  const boundary = policy('boundary', 'boundary', { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: ['s3:*', 'cloudwatch:*', 'ec2:*'], Resource: '*' }] });
  const createUser = policy('create-user', 'identity', { Version: '2012-10-17', Statement: { Effect: 'Allow', Action: 'iam:CreateUser', Resource: '*' } });
  it('Shirley "tries to create a user, the operation fails" because the boundary does not allow it', () => {
    expect(evaluate({ principal: shirley, action: 'iam:CreateUser', resource: 'arn:aws:iam::123456789012:user/new' }, [createUser, boundary])).toMatchObject({
      decision: 'Deny',
      denyKind: 'implicit',
      decidedBy: 'boundary',
    });
  });
  it('"Given these two policies, Shirley does not have permission to perform any operations"', () => {
    expect(evaluate({ principal: shirley, action: 's3:ListBucket', resource: 'arn:aws:s3:::any' }, [createUser, boundary])).toMatchObject({
      decision: 'Deny',
      decidedBy: 'identity',
    });
  });

  // María delegates to Zhang (same page): DelegatedUserBoundary + DelegatedUserPermissions, trimmed to the
  // statements each test needs (no other statement could change these decisions).
  const zhang = 'arn:aws:iam::123456789012:user/Zhang';
  const zBoundary = policy('DelegatedUserBoundary', 'boundary', {
    Version: '2012-10-17',
    Statement: [
      {
        Sid: 'CreateOrChangeOnlyWithBoundary',
        Effect: 'Allow',
        Action: ['iam:AttachUserPolicy', 'iam:CreateUser', 'iam:DeleteUserPolicy', 'iam:DetachUserPolicy', 'iam:PutUserPermissionsBoundary', 'iam:PutUserPolicy'],
        Resource: '*',
        Condition: { StringEquals: { 'iam:PermissionsBoundary': 'arn:aws:iam::123456789012:policy/XCompanyBoundaries' } },
      },
      { Sid: 'CloudWatchAndOtherIAMTasks', Effect: 'Allow', Action: ['cloudwatch:*', 'iam:UpdateLoginProfile', 'iam:CreateAccessKey'], NotResource: 'arn:aws:iam::123456789012:user/Maria' },
      { Sid: 'NoBoundaryUserDelete', Effect: 'Deny', Action: 'iam:DeleteUserPermissionsBoundary', Resource: '*' },
    ],
  });
  const zPerms = policy('DelegatedUserPermissions', 'identity', {
    Version: '2012-10-17',
    Statement: [
      { Sid: 'IAM', Effect: 'Allow', Action: 'iam:*', Resource: '*' },
      { Sid: 'CloudWatchLimited', Effect: 'Allow', Action: ['cloudwatch:GetDashboard', 'cloudwatch:GetMetricData', 'cloudwatch:ListDashboards', 'cloudwatch:GetMetricStatistics', 'cloudwatch:ListMetrics'], Resource: '*' },
      { Sid: 'S3BucketContents', Effect: 'Allow', Action: 's3:ListBucket', Resource: 'arn:aws:s3:::ZhangBucket' },
    ],
  });
  const z = (action: string, resource: string, context?: Record<string, string>) =>
    evaluate({ principal: zhang, action, resource, context }, [zPerms, zBoundary]);
  it('"his permissions boundary does not allow any Amazon S3 action, so he cannot perform any S3 operations"', () => {
    expect(z('s3:ListBucket', 'arn:aws:s3:::ZhangBucket')).toMatchObject({ decision: 'Deny', decidedBy: 'boundary' });
  });
  it('CloudWatchLimited: "his effective CloudWatch permissions are limited only by his permissions policy"', () => {
    expect(z('cloudwatch:GetDashboard', '*').decision).toBe('Allow');
    expect(z('cloudwatch:PutDashboard', '*')).toMatchObject({ decision: 'Deny', decidedBy: 'identity' });
  });
  it('NotResource: he can reset passwords "for any IAM user not listed in the NotResource policy element"', () => {
    expect(z('iam:UpdateLoginProfile', 'arn:aws:iam::123456789012:user/Nikhil').decision).toBe('Allow');
    expect(z('iam:UpdateLoginProfile', 'arn:aws:iam::123456789012:user/Maria')).toMatchObject({ decision: 'Deny', decidedBy: 'boundary' });
  });
  it('creating a user without the XCompanyBoundaries boundary is denied; with it, allowed', () => {
    expect(z('iam:CreateUser', 'arn:aws:iam::123456789012:user/Nikhil')).toMatchObject({ decision: 'Deny', decidedBy: 'boundary' });
    expect(z('iam:CreateUser', 'arn:aws:iam::123456789012:user/Nikhil', { 'iam:PermissionsBoundary': 'arn:aws:iam::123456789012:policy/XCompanyBoundaries' }).decision).toBe('Allow');
  });
  it('NoBoundaryUserDelete is an explicit deny', () => {
    expect(z('iam:DeleteUserPermissionsBoundary', 'arn:aws:iam::123456789012:user/Nikhil')).toMatchObject({ decision: 'Deny', denyKind: 'explicit' });
  });

  // Nikhil has the XCompanyBoundaries boundary (trimmed: ServiceBoundaries + DenyS3Logs).
  const nikhil = 'arn:aws:iam::123456789012:user/Nikhil';
  const xBoundary = policy('XCompanyBoundaries', 'boundary', {
    Version: '2012-10-17',
    Statement: [
      { Sid: 'ServiceBoundaries', Effect: 'Allow', Action: ['s3:*', 'cloudwatch:*', 'ec2:*', 'dynamodb:*'], Resource: '*' },
      { Sid: 'DenyS3Logs', Effect: 'Deny', Action: 's3:*', Resource: ['arn:aws:s3:::logs', 'arn:aws:s3:::logs/*'] },
    ],
  });
  const readOnly = policy('S3ReadOnly', 'identity', { Statement: { Effect: 'Allow', Action: ['s3:Get*', 's3:List*'], Resource: '*' } });
  it('a bucket policy letting Nikhil into the logs bucket: "he still cannot access the bucket"', () => {
    const logsPolicy = policy('logs', 'resource', { Statement: { Effect: 'Allow', Principal: { AWS: nikhil }, Action: 's3:PutObject', Resource: 'arn:aws:s3:::logs/*' } });
    expect(evaluate({ principal: nikhil, action: 's3:PutObject', resource: 'arn:aws:s3:::logs/today.txt' }, [readOnly, xBoundary, logsPolicy])).toMatchObject({
      decision: 'Deny',
      denyKind: 'explicit',
    });
  });
  it('a secret\'s resource policy allows GetSecretValue: "Nikhil can retrieve and decrypt the secret"', () => {
    const secretArn = 'arn:aws:secretsmanager:us-east-1:123456789012:secret:kedai-db-AbCdEf';
    const secretPolicy = policy('secret', 'resource', { Statement: { Effect: 'Allow', Principal: { AWS: nikhil }, Action: 'secretsmanager:GetSecretValue', Resource: '*' } });
    expect(evaluate({ principal: nikhil, action: 'secretsmanager:GetSecretValue', resource: secretArn }, [readOnly, xBoundary, secretPolicy])).toMatchObject({
      decision: 'Allow',
      decidedBy: 'resource',
    });
  });
});

describe('Role sessions and resource-based policies (reference_policies_evaluation-logic_policy-eval-denyallow)', () => {
  const session = 'arn:aws:sts::111122223333:assumed-role/examplerole/examplerolesessionname';
  const roleArn = 'arn:aws:iam::111122223333:role/examplerole';
  const res = (who: string) =>
    policy('bucket', 'resource', { Statement: { Effect: 'Allow', Principal: { AWS: who }, Action: 's3:GetObject', Resource: 'arn:aws:s3:::menu/*' } });
  const boundary = policy('b', 'boundary', { Statement: { Effect: 'Allow', Action: 'ec2:*', Resource: '*' } });
  const req = { principal: session, action: 's3:GetObject', resource: 'arn:aws:s3:::menu/today.json' };
  it('granted to the role session ARN: "not limited by an implicit deny in … a permissions boundary"', () => {
    expect(evaluate(req, [res(session), boundary])).toMatchObject({ decision: 'Allow', decidedBy: 'resource' });
  });
  it('granted to the role ARN: "limited by an implicit deny in a permissions boundary"', () => {
    expect(evaluate(req, [res(roleArn), boundary])).toMatchObject({ decision: 'Deny', decidedBy: 'boundary' });
  });
  it('granted to the role ARN with no boundary: the identity policy is not needed', () => {
    const e = evaluate(req, [res(roleArn)]);
    expect(e).toMatchObject({ decision: 'Allow', decidedBy: 'end' });
    expect(e.steps.find((s) => s.id === 'identity')).toMatchObject({ outcome: 'skip', reason: 'identityNotNeeded' });
  });
  it('a resource policy naming someone else gives nothing', () => {
    expect(evaluate(req, [res('arn:aws:iam::111122223333:user/other')])).toMatchObject({ decision: 'Deny', decidedBy: 'identity' });
  });
});

describe('SCPs at idea level (orgs_manage_policies_scps, _scps_evaluation)', () => {
  const user = 'arn:aws:iam::111122223333:user/aina';
  const admin = policy('admin', 'identity', { Statement: { Effect: 'Allow', Action: '*', Resource: '*' } });
  const full = (level: string) => policy(`FullAWSAccess@${level}`, 'scp', { Statement: { Effect: 'Allow', Action: '*', Resource: '*' } }, level);
  const ec2Only = (level: string) => policy(`AllowEC2@${level}`, 'scp', { Statement: { Effect: 'Allow', Action: 'ec2:*', Resource: '*' } }, level);
  const denyS3 = (level: string) => policy(`DenyS3@${level}`, 'scp', { Statement: { Effect: 'Deny', Action: 's3:*', Resource: '*' } }, level);
  const s3 = { principal: user, action: 's3:GetObject', resource: 'arn:aws:s3:::menu/a' };
  const ec2 = { principal: user, action: 'ec2:RunInstances', resource: '*' };
  it('"A user without any IAM permission policies has no access, even if the applicable SCPs allow all"', () => {
    expect(evaluate(s3, [full('root'), full('account')])).toMatchObject({ decision: 'Deny', decidedBy: 'identity' });
  });
  it('Scenario 2: an OU that only allows EC2 leaves the account only EC2', () => {
    const set = [admin, full('root'), ec2Only('ou'), full('account')];
    expect(evaluate(ec2, set).decision).toBe('Allow');
    expect(evaluate(s3, set)).toMatchObject({ decision: 'Deny', denyKind: 'implicit', decidedBy: 'scp' });
    expect(evaluate(s3, set).steps.at(-1)!.level).toBe('ou');
  });
  it('Scenario 3: a Deny-only SCP at the root blocks every service', () => {
    expect(evaluate(ec2, [admin, denyS3('root'), full('account')])).toMatchObject({ decision: 'Deny', decidedBy: 'scp' });
  });
  it('Scenario 6: a root-level Deny wins over an Allow lower down', () => {
    expect(evaluate(s3, [admin, full('root'), denyS3('root'), full('account')])).toMatchObject({ decision: 'Deny', denyKind: 'explicit' });
  });
  it('SCPs and a boundary: "the boundary, the SCP, and the identity-based policy must all allow the action"', () => {
    const b = policy('b', 'boundary', { Statement: { Effect: 'Allow', Action: 's3:*', Resource: '*' } });
    expect(evaluate(ec2, [admin, full('root'), b]).decision).toBe('Deny');
    expect(evaluate(s3, [admin, full('root'), b]).decision).toBe('Allow');
  });
});

describe('NotAction (reference_policies_elements_notaction)', () => {
  const user = 'arn:aws:iam::111122223333:user/aina';
  it('"allows users to access every action in every AWS service except for IAM"', () => {
    const p = policy('p', 'identity', { Statement: { Effect: 'Allow', NotAction: 'iam:*', Resource: '*' } });
    expect(evaluate({ principal: user, action: 's3:GetObject', resource: 'arn:aws:s3:::a/b' }, [p]).decision).toBe('Allow');
    expect(evaluate({ principal: user, action: 'iam:CreateUser', resource: '*' }, [p]).decision).toBe('Deny');
  });
  it('Allow NotAction s3:DeleteBucket on arn:aws:s3:::* "does not allow actions in other services"', () => {
    const p = policy('p', 'identity', { Statement: { Effect: 'Allow', NotAction: 's3:DeleteBucket', Resource: 'arn:aws:s3:::*' } });
    expect(evaluate({ principal: user, action: 's3:PutObject', resource: 'arn:aws:s3:::a/b' }, [p]).decision).toBe('Allow');
    expect(evaluate({ principal: user, action: 's3:DeleteBucket', resource: 'arn:aws:s3:::a' }, [p]).decision).toBe('Deny');
    expect(evaluate({ principal: user, action: 'ec2:RunInstances', resource: 'arn:aws:ec2:us-east-1:111122223333:instance/*' }, [p]).decision).toBe('Deny');
  });
  it('Deny NotAction iam:* without MFA "would not grant the user access to any actions"', () => {
    const deny = policy('mfa', 'identity', {
      Statement: { Sid: 'DenyAllUsersNotUsingMFA', Effect: 'Deny', NotAction: 'iam:*', Resource: '*', Condition: { BoolIfExists: { 'aws:MultiFactorAuthPresent': 'false' } } },
    });
    const all = policy('all', 'identity', { Statement: { Effect: 'Allow', Action: '*', Resource: '*' } });
    const s3 = { principal: user, action: 's3:GetObject', resource: 'arn:aws:s3:::a/b' };
    expect(evaluate({ ...s3, context: { 'aws:MultiFactorAuthPresent': 'false' } }, [deny, all])).toMatchObject({ decision: 'Deny', denyKind: 'explicit' });
    // Long-term access keys: the key is absent, and BoolIfExists treats that as true: still denied.
    expect(evaluate(s3, [deny, all])).toMatchObject({ decision: 'Deny', denyKind: 'explicit' });
    expect(evaluate({ ...s3, context: { 'aws:MultiFactorAuthPresent': 'true' } }, [deny, all]).decision).toBe('Allow');
    expect(evaluate({ ...s3, context: { 'aws:MultiFactorAuthPresent': 'true' } }, [deny])).toMatchObject({ decision: 'Deny', denyKind: 'implicit' });
  });
});

describe('NotResource (reference_policies_elements_notresource)', () => {
  it('HRPayroll: S3 is denied everywhere except the Payroll folder, and nothing is granted', () => {
    const user = 'arn:aws:iam::111122223333:user/hr';
    const deny = policy('hr', 'identity', { Statement: { Effect: 'Deny', Action: 's3:*', NotResource: ['arn:aws:s3:::HRBucket/Payroll', 'arn:aws:s3:::HRBucket/Payroll/*'] } });
    expect(evaluate({ principal: user, action: 's3:GetObject', resource: 'arn:aws:s3:::HRBucket/Other/x' }, [deny])).toMatchObject({ denyKind: 'explicit' });
    expect(evaluate({ principal: user, action: 's3:GetObject', resource: 'arn:aws:s3:::HRBucket/Payroll/x' }, [deny])).toMatchObject({ denyKind: 'implicit' });
  });
});

describe('Condition operators (reference_policies_elements_condition_operators)', () => {
  const k = (op: string, key: string, want: string | string[], ctx?: Record<string, string>) => evalConditionKey(op, key, want, ctx).result;
  it('StringEquals aws:PrincipalTag/job-category: match, no match, missing = no match', () => {
    expect(k('StringEquals', 'aws:PrincipalTag/job-category', 'iamuser-admin', { 'aws:PrincipalTag/job-category': 'iamuser-admin' })).toBe(true);
    expect(k('StringEquals', 'aws:PrincipalTag/job-category', 'iamuser-admin', { 'aws:PrincipalTag/job-category': 'dev-ops' })).toBe(false);
    expect(k('StringEquals', 'aws:PrincipalTag/job-category', 'iamuser-admin', {})).toBe(false);
  });
  it('"Context key names are not case-sensitive"; StringEquals values are, StringEqualsIgnoreCase not', () => {
    expect(k('StringEquals', 'aws:SourceIP', '1', { 'AWS:SourceIp': '1' })).toBe(true);
    expect(k('StringEquals', 'aws:username', 'john', { 'aws:username': 'John' })).toBe(false);
    expect(k('StringEqualsIgnoreCase', 'aws:username', 'john', { 'aws:username': 'John' })).toBe(true);
  });
  it('StringLike with * and ?', () => {
    expect(k('StringLike', 's3:prefix', ['', 'home/', 'home/martha_rivera/*'], { 's3:prefix': 'home/martha_rivera/notes.txt' })).toBe(true);
    expect(k('StringLike', 's3:prefix', 'home/?/', { 's3:prefix': 'home/ab/' })).toBe(false);
  });
  it('Bool aws:SecureTransport "false": false → match, true → no match, missing → no match', () => {
    expect(k('Bool', 'aws:SecureTransport', 'false', { 'aws:SecureTransport': 'false' })).toBe(true);
    expect(k('Bool', 'aws:SecureTransport', 'false', { 'aws:SecureTransport': 'true' })).toBe(false);
    expect(k('Bool', 'aws:SecureTransport', 'false', {})).toBe(false);
  });
  it('IpAddress 203.0.113.0/24: 203.0.113.1 matches, 198.51.100.1 does not; a bare address is /32', () => {
    expect(k('IpAddress', 'aws:SourceIp', '203.0.113.0/24', { 'aws:SourceIp': '203.0.113.1' })).toBe(true);
    expect(k('IpAddress', 'aws:SourceIp', '203.0.113.0/24', { 'aws:SourceIp': '198.51.100.1' })).toBe(false);
    expect(k('IpAddress', 'aws:SourceIp', '203.0.113.7', { 'aws:SourceIp': '203.0.113.8' })).toBe(false);
    expect(k('NotIpAddress', 'aws:SourceIp', '203.0.113.0/24', { 'aws:SourceIp': '198.51.100.1' })).toBe(true);
  });
  it('ArnEquals aws:SourceArn: same topic matches, other account does not, missing does not', () => {
    const want = 'arn:aws:sns:us-west-2:123456789012:TOPIC-ID';
    expect(k('ArnEquals', 'aws:SourceArn', want, { 'aws:SourceArn': want })).toBe(true);
    expect(k('ArnEquals', 'aws:SourceArn', want, { 'aws:SourceArn': 'arn:aws:sns:us-west-2:777788889999:TOPIC-ID' })).toBe(false);
    expect(k('ArnLike', 'aws:SourceArn', want, {})).toBe(false);
  });
  it('a negated operator with a missing key is true; IfExists with a missing key is true', () => {
    expect(k('StringNotLike', 'aws:PrincipalTag/team', 'x', {})).toBe(true);
    expect(k('StringLikeIfExists', 'ec2:InstanceType', ['t1.*', 't2.*', 'm3.*'], { 'ec2:InstanceType': 't1.micro' })).toBe(true);
    expect(k('StringLikeIfExists', 'ec2:InstanceType', ['t1.*', 't2.*', 'm3.*'], { 'ec2:InstanceType': 'm2.micro' })).toBe(false);
    expect(k('StringLikeIfExists', 'ec2:InstanceType', ['t1.*', 't2.*', 'm3.*'], {})).toBe(true);
  });
  it('Null: true when the key is absent', () => {
    expect(k('Null', 'aws:TokenIssueTime', 'false', { 'aws:TokenIssueTime': '2026-11-01T00:00:00Z' })).toBe(true);
    expect(k('Null', 'aws:TokenIssueTime', 'false', {})).toBe(false);
  });
});

describe('Several keys and values (reference_policies_condition-logic-multiple-context-keys-or-values)', () => {
  const user = (name: string) => `arn:aws:iam::222222222222:user/${name}`;
  const cond = (arnOp: 'ArnLike' | 'ArnNotLike'): Record<string, Record<string, string[]>> => ({
    StringEquals: { 'aws:PrincipalTag/department': ['finance', 'hr', 'legal'], 'aws:PrincipalTag/role': ['audit', 'security'] },
    [arnOp]: { 'aws:PrincipalArn': [user('Ana'), user('Mary')] },
  });
  const run = (arnOp: 'ArnLike' | 'ArnNotLike', ctx: Record<string, string>) =>
    evaluate({ principal: user('x'), action: 's3:ListBucket', resource: 'arn:aws:s3:::amzn-s3-demo-bucket', context: ctx }, [
      policy('p', 'identity', { Statement: { Effect: 'Allow', Action: 's3:ListBucket', Resource: 'arn:aws:s3:::amzn-s3-demo-bucket', Condition: cond(arnOp) } }),
    ]).decision;
  const tags = (dep: string | null, role: string | null, arn: string) => ({
    ...(dep ? { 'aws:PrincipalTag/department': dep } : {}),
    ...(role ? { 'aws:PrincipalTag/role': role } : {}),
    'aws:PrincipalArn': arn,
  });
  it('AND across keys, OR across values: the doc table, row by row', () => {
    expect(run('ArnLike', tags('legal', 'audit', user('Mary')))).toBe('Allow');
    expect(run('ArnLike', tags('hr', 'audit', user('Nikki')))).toBe('Deny');
    expect(run('ArnLike', tags('hr', 'payroll', user('Mary')))).toBe('Deny');
    expect(run('ArnLike', tags('hr', null, user('Mary')))).toBe('Deny');
    expect(run('ArnLike', tags(null, null, user('Mary')))).toBe('Deny');
  });
  it('a negated operator with several values works like NOR: the doc table, row by row', () => {
    expect(run('ArnNotLike', tags('legal', 'audit', user('Nikki')))).toBe('Allow');
    expect(run('ArnNotLike', tags('hr', 'audit', user('Mary')))).toBe('Deny');
    expect(run('ArnNotLike', tags('hr', 'payroll', user('Nikki')))).toBe('Deny');
    expect(run('ArnNotLike', tags('hr', null, user('Nikki')))).toBe('Deny');
    expect(run('ArnNotLike', tags(null, null, user('Nikki')))).toBe('Deny');
  });
});

describe('Parsing, validating and formatting', () => {
  it('refuses what the evaluator does not model', () => {
    const issues = validatePolicy(
      {
        Statement: [
          { Effect: 'Allow', Action: 's3:GetObject', Resource: 'arn:aws:s3:::a/${aws:username}' },
          { Effect: 'Allow', Action: 's3:GetObject', Resource: '*', Condition: { NumericLessThan: { 's3:max-keys': '10' } } },
          { Effect: 'allow', Action: 's3:GetObject' },
        ],
      },
      'identity',
    );
    expect(issues.map((i) => i.code)).toEqual(['variable', 'operator', 'effect', 'needResource']);
    expect(validatePolicy({ Statement: { Effect: 'Allow', Principal: { AWS: '*' }, Action: 's3:*', Resource: '*' } }, 'resource')[0]!.code).toBe('principalType');
    expect(validatePolicy({ Statement: { Effect: 'Allow', Action: 's3:*', Resource: '*' } }, 'resource')[0]!.code).toBe('principalNeeded');
  });
  it('formats a short policy in ≤ 15 lines that parse back to the same document', () => {
    const doc: PolicyDoc = {
      Version: '2012-10-17',
      Statement: [
        { Sid: 'ReadMenu', Effect: 'Allow', Action: 's3:GetObject', Resource: 'arn:aws:s3:::kedai-menu/*' },
        { Sid: 'TlsOnly', Effect: 'Deny', Action: 's3:*', Resource: '*', Condition: { Bool: { 'aws:SecureTransport': 'false' } } },
      ],
    };
    const f = formatPolicy(doc);
    expect(f.lines).toHaveLength(18);
    expect(f.lines[14]).toBe('      "Condition": { "Bool": { "aws:SecureTransport": "false" } }');
    expect(JSON.parse(f.lines.join('\n'))).toEqual(doc);
    expect(f.statementLines).toEqual([
      [4, 9],
      [10, 16],
    ]);
    const short = formatPolicy({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: ['s3:GetObject', 's3:PutObject'], Resource: 'arn:aws:s3:::kedai-menu/*' }] });
    expect(short.lines).toHaveLength(10);
    expect(short.lines).toContain('      "Action": ["s3:GetObject", "s3:PutObject"],');
  });
  it('edits one line and parses the result', () => {
    const doc: PolicyDoc = { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: 's3:GetObject', Resource: 'arn:aws:s3:::kedai-menu/*' }] };
    const f = formatPolicy(doc);
    const line = f.lines.findIndex((l) => l.includes('"Action"')) + 1;
    expect(editLine(f.lines, line, '"Action": "s3:PutObject",', 'identity').doc).toMatchObject({ Statement: [{ Action: 's3:PutObject' }] });
    expect(editLine(f.lines, line, '"Action": s3:PutObject,', 'identity').jsonError).toBeTruthy();
    expect(parsePolicy('{', 'identity').ok).toBe(false);
  });
});
