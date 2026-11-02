// IPv4 CIDR maths for VPCs and subnets (Level Up · AWS, A3 "The Mall's Roads").
// Pure functions, no DOM. Every rule below comes from the Amazon VPC User Guide (checked 2026-11-01):
//   VPC CIDR blocks:     https://docs.aws.amazon.com/vpc/latest/userguide/vpc-cidr-blocks.html
//   Subnet CIDR blocks:  https://docs.aws.amazon.com/vpc/latest/userguide/subnet-sizing.html
//   Subnets and AZs:     https://docs.aws.amazon.com/vpc/latest/userguide/configure-subnets.html
// Story words: the VPC is the mall's land, a subnet is one row of shop units, an AZ is a wing.
// Not modelled: IPv6, secondary VPC CIDR blocks and their association restrictions, BYOIP
// (which lets you use the network and broadcast addresses), subnet CIDR reservations.

/** Smallest and largest allowed netmask for a VPC and for a subnet (both docs: /16 to /28). */
export const MIN_PREFIX = 16;
export const MAX_PREFIX = 28;
/** "The first four IP addresses and the last IP address in each subnet CIDR block are not available." */
export const RESERVED_PER_SUBNET = 5;

export interface Cidr {
  /** The network address as a 32-bit unsigned number. */
  base: number;
  prefix: number;
  /** Canonical text, e.g. 10.0.0.0/24. */
  text: string;
}

export type CidrError = 'format' | 'octet' | 'prefix';

export interface ParsedCidr {
  ok: boolean;
  cidr?: Cidr;
  error?: CidrError;
  /** The address part had host bits set: AWS stores the canonical form instead (subnet-sizing doc). */
  canonicalised?: boolean;
}

export function ipToNumber(ip: string): number | null {
  const parts = ip.trim().split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n;
}

export function numberToIp(n: number): string {
  return [24, 16, 8, 0].map((s) => Math.floor(n / 2 ** s) % 256).join('.');
}

export function blockSize(prefix: number): number {
  return 2 ** (32 - prefix);
}

/**
 * Parse "a.b.c.d/n". Host bits are cleared, like the API does:
 * "if you specify 100.68.0.18/18 for the CIDR block, we create a CIDR block of 100.68.0.0/18."
 */
export function parseCidr(text: string): ParsedCidr {
  const m = /^\s*([\d.]+)\/(\d{1,2})\s*$/.exec(text);
  if (!m) return { ok: false, error: 'format' };
  const ip = ipToNumber(m[1]!);
  if (ip === null) return { ok: false, error: /^\d+\.\d+\.\d+\.\d+$/.test(m[1]!) ? 'octet' : 'format' };
  const prefix = Number(m[2]);
  if (prefix > 32) return { ok: false, error: 'prefix' };
  const size = blockSize(prefix);
  const base = Math.floor(ip / size) * size;
  return {
    ok: true,
    cidr: { base, prefix, text: `${numberToIp(base)}/${prefix}` },
    canonicalised: base !== ip,
  };
}

/** Parse a plain IPv4 address or CIDR (a bare address means /32, like IAM's IpAddress operator). */
export function parseIpOrCidr(text: string): Cidr | null {
  const t = text.trim();
  if (!t.includes('/')) {
    const n = ipToNumber(t);
    return n === null ? null : { base: n, prefix: 32, text: `${t}/32` };
  }
  const p = parseCidr(t);
  return p.ok ? p.cidr! : null;
}

export function lastAddress(c: Cidr): number {
  return c.base + blockSize(c.prefix) - 1;
}

export function containsIp(c: Cidr, ip: number): boolean {
  return ip >= c.base && ip <= lastAddress(c);
}

/** True when `inner` lies completely inside `outer`. */
export function containsCidr(outer: Cidr, inner: Cidr): boolean {
  return inner.base >= outer.base && lastAddress(inner) <= lastAddress(outer);
}

/** "If you create more than one subnet in a VPC, the CIDR blocks of the subnets cannot overlap." */
export function overlaps(a: Cidr, b: Cidr): boolean {
  return a.base <= lastAddress(b) && b.base <= lastAddress(a);
}

export interface Reserved {
  ip: string;
  role: 'network' | 'router' | 'dns' | 'future' | 'broadcast';
}

/**
 * The five addresses AWS keeps in every subnet (subnet-sizing doc, example 10.0.0.0/24):
 * .0 network, .1 VPC router, .2 DNS (base + 2), .3 future use, last = network broadcast.
 */
export function reservedAddresses(c: Cidr): Reserved[] {
  return [
    { ip: numberToIp(c.base), role: 'network' },
    { ip: numberToIp(c.base + 1), role: 'router' },
    { ip: numberToIp(c.base + 2), role: 'dns' },
    { ip: numberToIp(c.base + 3), role: 'future' },
    { ip: numberToIp(lastAddress(c)), role: 'broadcast' },
  ];
}

/** Addresses you can give to your own things: the block size minus the five AWS keeps. */
export function usableAddresses(prefix: number): number {
  return Math.max(0, blockSize(prefix) - RESERVED_PER_SUBNET);
}

/** First and last address you can use (after the first four, before the broadcast). */
export function usableRange(c: Cidr): [string, string] {
  return [numberToIp(c.base + 4), numberToIp(lastAddress(c) - 1)];
}

// --- VPC checks --------------------------------------------------------------------------

/** "You can't specify the following CIDR blocks for your VPCs" (vpc-cidr-blocks doc). */
export const FORBIDDEN_VPC_RANGES = ['0.0.0.0/8', '127.0.0.0/8', '169.254.0.0/16', '224.0.0.0/4'];
/** "Some AWS services use the 172.17.0.0/16 CIDR range … don't use this range when creating your VPC." */
export const AVOID_VPC_RANGE = '172.17.0.0/16';
/** RFC 1918 private ranges, recommended for VPCs (vpc-cidr-blocks doc table). */
export const RFC1918 = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'];

export type VpcIssue =
  | { code: 'format' | 'octet' | 'prefix' }
  | { code: 'tooBig' | 'tooSmall'; prefix: number }
  | { code: 'forbidden'; range: string }
  | { code: 'avoid172'; range: string }
  | { code: 'publicRange' }
  | { code: 'canonical'; canonical: string };

export interface VpcCheck {
  ok: boolean;
  cidr?: Cidr;
  /** Problems that stop AWS from creating it. */
  errors: VpcIssue[];
  /** Advice from the docs (the VPC is still allowed). */
  notes: VpcIssue[];
}

const cidrOf = (text: string) => parseCidr(text).cidr!;

export function isPrivateRange(c: Cidr): boolean {
  return RFC1918.some((r) => containsCidr(cidrOf(r), c));
}

export function checkVpcCidr(text: string): VpcCheck {
  const p = parseCidr(text);
  if (!p.ok) return { ok: false, errors: [{ code: p.error! }], notes: [] };
  const c = p.cidr!;
  const errors: VpcIssue[] = [];
  const notes: VpcIssue[] = [];
  if (c.prefix < MIN_PREFIX) errors.push({ code: 'tooBig', prefix: c.prefix });
  if (c.prefix > MAX_PREFIX) errors.push({ code: 'tooSmall', prefix: c.prefix });
  for (const r of FORBIDDEN_VPC_RANGES) if (overlaps(cidrOf(r), c)) errors.push({ code: 'forbidden', range: r });
  if (overlaps(cidrOf(AVOID_VPC_RANGE), c)) notes.push({ code: 'avoid172', range: AVOID_VPC_RANGE });
  if (!errors.length && !isPrivateRange(c)) notes.push({ code: 'publicRange' });
  if (p.canonicalised) notes.push({ code: 'canonical', canonical: c.text });
  return { ok: errors.length === 0, cidr: c, errors, notes };
}

// --- Subnet checks -----------------------------------------------------------------------

export type SubnetIssue =
  | { code: 'format' | 'octet' | 'prefix' }
  | { code: 'tooBig' | 'tooSmall'; prefix: number }
  | { code: 'outside'; vpc: string }
  | { code: 'overlap'; other: string }
  | { code: 'tooFewIps'; usable: number; need: number }
  | { code: 'canonical'; canonical: string };

export interface PlannedSubnet {
  /** A stable id, e.g. "public:ap-southeast-5a". */
  id: string;
  cidr: string;
  /** How many usable addresses this subnet must have (the brief). */
  need?: number;
}

export interface SubnetCheck {
  id: string;
  ok: boolean;
  cidr?: Cidr;
  size: number;
  usable: number;
  errors: SubnetIssue[];
  notes: SubnetIssue[];
}

/** Check one subnet on its own, then against the VPC and the other subnets of the plan. */
export function checkPlan(vpcText: string, subnets: PlannedSubnet[]): SubnetCheck[] {
  const vpc = parseCidr(vpcText).cidr;
  const parsed = subnets.map((s) => ({ s, p: parseCidr(s.cidr) }));
  return parsed.map(({ s, p }, i) => {
    if (!p.ok) return { id: s.id, ok: false, size: 0, usable: 0, errors: [{ code: p.error! }], notes: [] };
    const c = p.cidr!;
    const errors: SubnetIssue[] = [];
    const notes: SubnetIssue[] = [];
    // "The allowed IPv4 CIDR block size for a subnet is between a /28 netmask and /16 netmask."
    if (c.prefix < MIN_PREFIX) errors.push({ code: 'tooBig', prefix: c.prefix });
    if (c.prefix > MAX_PREFIX) errors.push({ code: 'tooSmall', prefix: c.prefix });
    // The subnet's block is "the same as the CIDR block for the VPC … or a subset of" it.
    if (vpc && !containsCidr(vpc, c)) errors.push({ code: 'outside', vpc: vpc.text });
    parsed.forEach(({ s: o, p: q }, j) => {
      if (j !== i && q.ok && overlaps(c, q.cidr!)) errors.push({ code: 'overlap', other: o.id });
    });
    const usable = usableAddresses(c.prefix);
    if (s.need !== undefined && usable < s.need) errors.push({ code: 'tooFewIps', usable, need: s.need });
    if (p.canonicalised) notes.push({ code: 'canonical', canonical: c.text });
    return { id: s.id, ok: errors.length === 0, cidr: c, size: blockSize(c.prefix), usable, errors, notes };
  });
}

/** The biggest prefix (smallest block) whose usable addresses cover `need`. Null if even /16 is too small. */
export function prefixFor(need: number): number | null {
  for (let p = MAX_PREFIX; p >= MIN_PREFIX; p--) if (usableAddresses(p) >= need) return p;
  return null;
}

/**
 * The first block of size /prefix inside the VPC that touches none of `taken` (aligned, lowest first).
 * Used by the "find a free spot" button and to prove a brief can be met.
 */
export function firstFreeBlock(vpcText: string, prefix: number, taken: string[]): string | null {
  const vpc = parseCidr(vpcText).cidr;
  if (!vpc || prefix < vpc.prefix || prefix > 32) return null;
  const used = taken.map((t) => parseCidr(t).cidr).filter((c): c is Cidr => Boolean(c));
  const size = blockSize(prefix);
  for (let base = vpc.base; base + size - 1 <= lastAddress(vpc); base += size) {
    const cand: Cidr = { base, prefix, text: `${numberToIp(base)}/${prefix}` };
    const hit = used.find((u) => overlaps(u, cand));
    if (!hit) return cand.text;
    // Jump past the block in the way (keeps the search short in a /16).
    const next = Math.ceil((lastAddress(hit) + 1 - vpc.base) / size) * size + vpc.base;
    if (next > base + size) base = next - size;
  }
  return null;
}

/**
 * Split a VPC into `count` equal subnets of size /prefix, from the start
 * (the doc's example: 10.0.0.0/24 → 10.0.0.0/25 and 10.0.0.128/25).
 */
export function splitVpc(vpcText: string, prefix: number, count: number): string[] | null {
  const vpc = parseCidr(vpcText).cidr;
  if (!vpc || prefix < vpc.prefix) return null;
  const size = blockSize(prefix);
  if (count * size > blockSize(vpc.prefix)) return null;
  return Array.from({ length: count }, (_, i) => `${numberToIp(vpc.base + i * size)}/${prefix}`);
}

/**
 * Lay one subnet per (tier, AZ) cell with the smallest size that meets each need,
 * biggest first so the blocks stay aligned. Returns null if they cannot all fit.
 */
export function autoPlan(vpcText: string, cells: { id: string; need: number }[]): Record<string, string> | null {
  const order = [...cells].sort((a, b) => b.need - a.need);
  const out: Record<string, string> = {};
  for (const cell of order) {
    const prefix = prefixFor(cell.need);
    if (prefix === null) return null;
    const spot = firstFreeBlock(vpcText, prefix, Object.values(out));
    if (!spot) return null;
    out[cell.id] = spot;
  }
  return out;
}
