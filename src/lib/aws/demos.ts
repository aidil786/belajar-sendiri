// Props for the AWS game demos on the hidden test page (/<lang>/dev/interactives/), shared with the
// check-mdx tests and tests/e2e/aws-games.spec.ts. Story: Kedai Kancil rents a unit in the mall.
// Account 111122223333 and the 192.0.2.x / 198.51.100.x / 203.0.113.x addresses are documentation examples.
import type { Visitor } from './gates';
import type { PolicyDoc } from './iam';

const ACCOUNT = '111122223333';
const aina = `arn:aws:iam::${ACCOUNT}:user/aina`;

/** Predict: Aina may put files in the menu bucket, but not over plain HTTP (an explicit Deny). */
export const iamPredictDemo = {
  request: {
    principal: aina,
    who: 'Aina',
    action: 's3:PutObject',
    resource: 'arn:aws:s3:::kedai-menu/today.json',
    context: { 'aws:SecureTransport': 'false' },
  },
  policies: [
    {
      name: 'menu-writer',
      kind: 'identity' as const,
      doc: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: 's3:PutObject', Resource: 'arn:aws:s3:::kedai-menu/*' }] } as PolicyDoc,
    },
    {
      name: 'tls-only',
      kind: 'identity' as const,
      doc: {
        Version: '2012-10-17',
        Statement: [{ Effect: 'Deny', Action: 's3:*', Resource: '*', Condition: { Bool: { 'aws:SecureTransport': 'false' } } }],
      } as PolicyDoc,
    },
  ],
};

/** Predict: the bucket names the CI role, but the role's fence (boundary) only allows ECR. */
export const iamRoleDemo = {
  request: {
    principal: `arn:aws:sts::${ACCOUNT}:assumed-role/ci-deployer/run-42`,
    who: 'ci-deployer',
    action: 's3:PutObject',
    resource: 'arn:aws:s3:::kedai-site/index.html',
  },
  policies: [
    {
      name: 'kedai-site',
      kind: 'resource' as const,
      doc: {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: { AWS: `arn:aws:iam::${ACCOUNT}:role/ci-deployer` },
            Action: 's3:PutObject',
            Resource: 'arn:aws:s3:::kedai-site/*',
          },
        ],
      } as PolicyDoc,
    },
    {
      name: 'ecr-only',
      kind: 'boundary' as const,
      doc: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: 'ecr:*', Resource: '*' }] } as PolicyDoc,
    },
  ],
};

/** Edit one line: let Aina also save today's menu, without opening every S3 action. */
export const iamEditDemo = {
  request: { principal: aina, who: 'Aina', action: 's3:PutObject', resource: 'arn:aws:s3:::kedai-menu/today.json' },
  policies: [
    {
      name: 'menu-reader',
      kind: 'identity' as const,
      doc: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: 's3:GetObject', Resource: 'arn:aws:s3:::kedai-menu/*' }] } as PolicyDoc,
    },
  ],
  task: { type: 'edit' as const, policy: 0, line: 6, want: 'Allow' as const, forbid: ['"\\*"', 's3:\\*'] },
  solution: '"Action": ["s3:GetObject", "s3:PutObject"],',
};

/** Two wings, a public and a private row in each. One public subnet is already there. */
export const subnetDemo = {
  vpc: '10.0.0.0/16',
  azs: ['ap-southeast-5a', 'ap-southeast-5b'],
  need: { public: 20, private: 200 },
  start: [{ tier: 'public' as const, az: 'ap-southeast-5a', cidr: '10.0.0.0/27' }],
};

/** The VPC block is too big at the start: fix it, then add one public subnet per wing. */
export const subnetVpcDemo = {
  vpc: '10.0.0.0/8',
  editVpc: true,
  tiers: ['public' as const],
  azs: ['ap-southeast-5a', 'ap-southeast-5b', 'ap-southeast-5c'],
};

/** Door guard (security group): shoppers on HTTPS from anywhere, SSH only from your laptop. */
export const gateSgDemo = {
  edit: 'sg' as const,
  forbidOpen: [22],
  visitors: [
    { id: 'shopper', label: 'Shopper', ip: '198.51.100.20', client: 'windows', protocol: 'tcp', port: 443, want: 'in' },
    { id: 'laptop', label: 'Your laptop (SSH)', ip: '203.0.113.9', client: 'linux', protocol: 'tcp', port: 22, want: 'in' },
    { id: 'stranger', label: 'Stranger (SSH)', ip: '192.0.2.77', protocol: 'tcp', port: 22, want: 'out' },
    { id: 'db', label: 'Stranger (database port)', ip: '192.0.2.77', protocol: 'tcp', port: 3306, want: 'out' },
  ] as Visitor[],
};

/** Row gate (network ACL): a new custom NACL denies everything; open HTTPS in and the replies out. */
export const gateNaclDemo = {
  edit: 'nacl' as const,
  nacl: 'custom' as const,
  sg: [{ protocol: 'tcp' as const, ports: '443', source: '0.0.0.0/0' }],
  visitors: [
    { id: 'win', label: 'Shopper on Windows', ip: '198.51.100.20', client: 'windows', protocol: 'tcp', port: 443, want: 'in' },
    { id: 'linux', label: 'Shopper on Linux', ip: '203.0.113.50', client: 'linux', protocol: 'tcp', port: 443, want: 'in' },
    { id: 'scan', label: 'Port scanner', ip: '192.0.2.66', protocol: 'tcp', port: 3389, want: 'out' },
  ] as Visitor[],
};

export const idleDemo = {
  items: ['natGateway', 'securityGroup', 'ebsDetached', 'vpc', 'elasticIpIdle', 'stoppedInstance', 'rdsStopped', 'internetGateway'],
  ordered: true,
};
