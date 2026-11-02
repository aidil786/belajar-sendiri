// What keeps costing money while it sits idle, and what doesn't (Level Up · AWS, A1 safety + A4 costs).
// No prices here on purpose: they change. Each item points to the official page that states how it is
// charged; the words for each item live in i18n (aws.idle.item.<id>.name / .why), checked 2026-11-01.
// The quoted sentence in each `basis` comment is from the linked page.

export const IDLE_CHECKED = '2026-11-01';

export type IdleBucket = 'costs' | 'free';

export interface IdleSource {
  label: string;
  url: string;
}

export interface IdleItem {
  id: string;
  bucket: IdleBucket;
  /** The official page(s) that say how it is charged (docs.aws.amazon.com first). */
  sources: IdleSource[];
  /** The pricing page to check today's price (never copied here). */
  pricing?: string;
}

const VPC_PRICING = 'https://aws.amazon.com/vpc/pricing/';

export const IDLE_ITEMS: IdleItem[] = [
  // --- Costs money while idle -----------------------------------------------------------
  {
    // "you are charged for each hour that your NAT gateway is available and each gigabyte of data that it processes."
    id: 'natGateway',
    bucket: 'costs',
    sources: [{ label: 'Amazon VPC: Pricing for NAT gateways', url: 'https://docs.aws.amazon.com/vpc/latest/userguide/nat-gateway-pricing.html' }],
    pricing: VPC_PRICING,
  },
  {
    // "There is a charge for all Elastic IP addresses whether they are in use … or idle (created in your account but unallocated)."
    id: 'elasticIpIdle',
    bucket: 'costs',
    sources: [{ label: 'Amazon EC2: Elastic IP address pricing', url: 'https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/elastic-ip-addresses-eip.html#eip-pricing' }],
    pricing: VPC_PRICING,
  },
  {
    // "Elastic IP addresses associated with the instance. Note that when the instance is stopped, you are charged for the associated Elastic IP addresses."
    id: 'elasticIpStopped',
    bucket: 'costs',
    sources: [{ label: 'Amazon EC2: How stop and start works', url: 'https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/how-ec2-instance-stop-start-works.html' }],
    pricing: VPC_PRICING,
  },
  {
    // "After you detach a volume, you are still charged for volume storage … You must delete a volume to avoid incurring further charges."
    id: 'ebsDetached',
    bucket: 'costs',
    sources: [{ label: 'Amazon EBS: Detach a volume', url: 'https://docs.aws.amazon.com/ebs/latest/userguide/ebs-detaching-volume.html' }],
    pricing: 'https://aws.amazon.com/ebs/pricing/',
  },
  {
    // "Stopping … You are not charged for usage or data transfer fees for a stopped instance. Charges are incurred to store Amazon EBS storage volumes."
    id: 'ebsOfStopped',
    bucket: 'costs',
    sources: [{ label: 'Amazon EC2: Costs related to stop and start', url: 'https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/how-ec2-instance-stop-start-works.html#ec2-stop-start-costs' }],
    pricing: 'https://aws.amazon.com/ebs/pricing/',
  },
  {
    // "In this state, you are charged for storing 10 GiB of snapshot data" (snapshot storage is billed until deleted).
    id: 'ebsSnapshot',
    bucket: 'costs',
    sources: [{ label: 'Amazon EBS: Delete a snapshot', url: 'https://docs.aws.amazon.com/ebs/latest/userguide/ebs-deleting-snapshot.html' }],
    pricing: 'https://aws.amazon.com/ebs/pricing/',
  },
  {
    // "You are charged for each hour or partial hour that an Application Load Balancer is running."
    id: 'loadBalancer',
    bucket: 'costs',
    sources: [{ label: 'Elastic Load Balancing pricing', url: 'https://aws.amazon.com/elasticloadbalancing/pricing/' }],
  },
  {
    // A running DB instance bills DB instance hours; stopping it is what stops them ("you're not charged for DB instance hours").
    id: 'rdsRunning',
    bucket: 'costs',
    sources: [{ label: 'Amazon RDS: Stopping a DB instance', url: 'https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_StopInstance.html' }],
    pricing: 'https://aws.amazon.com/rds/pricing/',
  },
  {
    // "While your DB instance is stopped, you are charged for provisioned storage … backup storage" and it restarts after seven days.
    id: 'rdsStopped',
    bucket: 'costs',
    sources: [{ label: 'Amazon RDS: Stopping a DB instance', url: 'https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_StopInstance.html' }],
    pricing: 'https://aws.amazon.com/rds/pricing/',
  },
  {
    // "All Amazon EKS clusters have a per cluster per hour fee based on the cluster's Kubernetes version."
    id: 'eksCluster',
    bucket: 'costs',
    sources: [{ label: 'Amazon EKS pricing', url: 'https://aws.amazon.com/eks/pricing/' }],
  },
  {
    // "You will be billed for each hour that your VPC endpoint remains provisioned in each Availability Zone".
    id: 'interfaceEndpoint',
    bucket: 'costs',
    sources: [{ label: 'AWS PrivateLink pricing', url: 'https://aws.amazon.com/privatelink/pricing/' }],
  },
  {
    // "With Secrets Manager, you pay based on the number of secrets stored and API calls made."
    id: 'secret',
    bucket: 'costs',
    sources: [{ label: 'AWS Secrets Manager pricing', url: 'https://aws.amazon.com/secrets-manager/pricing/' }],
  },
  {
    // "A hosted zone is charged at the time it is created and on the first day of each subsequent month."
    id: 'hostedZone',
    bucket: 'costs',
    sources: [{ label: 'Amazon Route 53 pricing', url: 'https://aws.amazon.com/route53/pricing/' }],
  },
  {
    // "You pay for storing objects in your S3 buckets."
    id: 's3Objects',
    bucket: 'costs',
    sources: [{ label: 'Amazon S3 pricing', url: 'https://aws.amazon.com/s3/pricing/' }],
  },
  {
    // "You pay only for the amount of data you store in your public or private repositories".
    id: 'ecrImages',
    bucket: 'costs',
    sources: [{ label: 'Amazon ECR pricing', url: 'https://aws.amazon.com/ecr/pricing/' }],
  },
  {
    // "You pay for the amount of concurrency you configure, and for the period of time you configure it."
    id: 'lambdaProvisioned',
    bucket: 'costs',
    sources: [{ label: 'AWS Lambda pricing', url: 'https://aws.amazon.com/lambda/pricing/' }],
  },
  // --- Free while idle (you still pay for what runs on or through it) ---------------------
  {
    // "There's no additional charge for using a VPC. There are, however, charges for some VPC components".
    id: 'vpc',
    bucket: 'free',
    sources: [{ label: 'Amazon VPC: Pricing', url: 'https://docs.aws.amazon.com/vpc/latest/userguide/what-is-amazon-vpc.html#pricing' }],
  },
  {
    // "There is no additional charge for using security groups."
    id: 'securityGroup',
    bucket: 'free',
    sources: [{ label: 'Amazon VPC: Security groups', url: 'https://docs.aws.amazon.com/vpc/latest/userguide/vpc-security-groups.html' }],
  },
  {
    // "There is no additional charge for using network ACLs."
    id: 'networkAcl',
    bucket: 'free',
    sources: [{ label: 'Amazon VPC: Network ACLs', url: 'https://docs.aws.amazon.com/vpc/latest/userguide/vpc-network-acls.html' }],
  },
  {
    // "There is no charge for an internet gateway, but there are data transfer charges for EC2 instances that use internet gateways."
    id: 'internetGateway',
    bucket: 'free',
    sources: [{ label: 'Amazon VPC: Internet gateways', url: 'https://docs.aws.amazon.com/vpc/latest/userguide/VPC_Internet_Gateway.html' }],
  },
  {
    // "There are no data processing or hourly charges for using Gateway Type VPC endpoints."
    id: 'gatewayEndpoint',
    bucket: 'free',
    sources: [{ label: 'Amazon VPC pricing', url: VPC_PRICING }],
  },
  {
    // "Private IPv4 addresses (RFC 1918) are not charged."
    id: 'privateIp',
    bucket: 'free',
    sources: [{ label: 'Amazon VPC: Pricing for public IPv4 addresses', url: 'https://docs.aws.amazon.com/vpc/latest/userguide/what-is-amazon-vpc.html#pricing' }],
  },
  {
    // "IAM … IAM Identity Center and … AWS STS are features of your AWS account offered at no additional charge."
    id: 'iam',
    bucket: 'free',
    sources: [{ label: 'IAM: Service cost information', url: 'https://docs.aws.amazon.com/IAM/latest/UserGuide/introduction.html' }],
  },
  {
    // "There is no additional charge for Amazon ECS orchestration." (ECS Managed Instances and ECS Anywhere have fees.)
    id: 'ecsCluster',
    bucket: 'free',
    sources: [{ label: 'Amazon ECS pricing', url: 'https://aws.amazon.com/ecs/pricing/' }],
  },
  {
    // "You are not charged for usage or data transfer fees for a stopped instance." (its EBS volumes still cost: ebsOfStopped)
    id: 'stoppedInstance',
    bucket: 'free',
    sources: [{ label: 'Amazon EC2: Costs related to stop and start', url: 'https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/how-ec2-instance-stop-start-works.html#ec2-stop-start-costs' }],
  },
  {
    // "Lambda Event Functions are priced per request and execution duration." No requests, no duration.
    id: 'lambdaFunction',
    bucket: 'free',
    sources: [{ label: 'AWS Lambda pricing', url: 'https://aws.amazon.com/lambda/pricing/' }],
  },
];

export const IDLE_BY_ID = new Map(IDLE_ITEMS.map((i) => [i.id, i]));

/** A balanced default set for the game (4 + 4). */
export const IDLE_DEFAULT = ['natGateway', 'elasticIpIdle', 'ebsDetached', 'rdsStopped', 'vpc', 'securityGroup', 'internetGateway', 'stoppedInstance'];

/** The free tier changes: lessons link this page instead of stating its rules. */
export const FREE_TIER_URL = 'https://aws.amazon.com/free/';

export function idleItems(ids: string[] = IDLE_DEFAULT): IdleItem[] {
  return ids.map((id) => {
    const item = IDLE_BY_ID.get(id);
    if (!item) throw new Error(`Unknown idle item "${id}"`);
    return item;
  });
}
