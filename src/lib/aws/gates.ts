// Security groups and network ACLs: which traffic reaches a server in a subnet, and whether the reply
// gets back out (Level Up · AWS, A3). Pure functions, no DOM. Rules from the Amazon VPC User Guide
// (checked 2026-11-01):
//   Security groups:   https://docs.aws.amazon.com/vpc/latest/userguide/vpc-security-groups.html
//   SG rules:          https://docs.aws.amazon.com/vpc/latest/userguide/security-group-rules.html
//   Network ACLs:      https://docs.aws.amazon.com/vpc/latest/userguide/vpc-network-acls.html
//   NACL rules:        https://docs.aws.amazon.com/vpc/latest/userguide/nacl-rules.html
//   Default NACL:      https://docs.aws.amazon.com/vpc/latest/userguide/default-network-acl.html
//   Custom NACL + ephemeral ports: https://docs.aws.amazon.com/vpc/latest/userguide/custom-network-acl.html
//   SG vs NACL table:  https://docs.aws.amazon.com/vpc/latest/userguide/nacl-examples.html
// Story words: the subnet's gate guard (NACL) checks a numbered list both ways and remembers nothing;
// the unit's door guard (security group) only has "let in" rules and remembers who came in, so the
// reply always goes back out.
// Not modelled: ICMP types/codes, IPv6 rules, prefix lists, traffic the instance starts itself (outbound SG
// rules), traffic inside one subnet (NACLs are checked "when traffic enters and leaves the subnet"), and the
// services neither guard filters (Amazon DNS, DHCP, instance metadata, Time Sync …).

import { containsIp, ipToNumber, parseIpOrCidr } from './cidr';

export type Proto = 'tcp' | 'udp' | 'all';

export interface SgRule {
  protocol: Proto;
  /** '443', '1024-65535'; omitted (or 'all') for every port. */
  ports?: string;
  /** A CIDR (203.0.113.0/24, 0.0.0.0/0, one address as /32) or a security group id (sg-…). */
  source: string;
}

export interface NaclRule {
  /** "Each rule has a number from 1 to 32766." Lowest first; the first match wins. */
  number: number;
  protocol: Proto;
  ports?: string;
  /** Source (inbound) or destination (outbound) CIDR. */
  cidr: string;
  action: 'allow' | 'deny';
}

export interface Nacl {
  inbound: NaclRule[];
  outbound: NaclRule[];
}

/** "A default network ACL is configured to allow all traffic to flow in and out" (rule 100 + the * rule). */
export const DEFAULT_NACL: Nacl = {
  inbound: [{ number: 100, protocol: 'all', cidr: '0.0.0.0/0', action: 'allow' }],
  outbound: [{ number: 100, protocol: 'all', cidr: '0.0.0.0/0', action: 'allow' }],
};
/** A new custom NACL has only the * rules: it denies everything until you add rules. */
export const NEW_CUSTOM_NACL: Nacl = { inbound: [], outbound: [] };

/** Who starts the conversation picks the reply port (custom-network-acl doc, "Ephemeral ports"). */
export type ClientKind = 'linux' | 'windows' | 'windowsOld' | 'elb' | 'nat' | 'lambda';
export const EPHEMERAL: Record<ClientKind, [number, number]> = {
  linux: [32768, 61000], // "Many Linux kernels (including the Amazon Linux kernel) use ports 32768-61000."
  windows: [49152, 65535], // "Windows Server 2008 and later versions use ports 49152-65535." (the doc's Windows 10 example too)
  windowsOld: [1025, 5000], // "Windows operating systems through Windows Server 2003 use ports 1025-5000."
  elb: [1024, 65535], // "Requests originating from Elastic Load Balancing use ports 1024-65535."
  nat: [1024, 65535], // "A NAT gateway uses ports 1024-65535."
  lambda: [1024, 65535], // "AWS Lambda functions use ports 1024-65535."
};

export interface PortRange {
  from: number;
  to: number;
}

export function parsePorts(text: string | undefined): PortRange | null {
  if (text === undefined || text.trim() === '' || text.trim().toLowerCase() === 'all') return { from: 0, to: 65535 };
  const m = /^\s*(\d{1,5})\s*(?:-\s*(\d{1,5}))?\s*$/.exec(text);
  if (!m) return null;
  const from = Number(m[1]);
  const to = m[2] === undefined ? from : Number(m[2]);
  if (from > to || to > 65535) return null;
  return { from, to };
}

const rangeOf = (protocol: Proto, ports?: string): PortRange | null => (protocol === 'all' ? { from: 0, to: 65535 } : parsePorts(ports));

export function protoMatches(rule: Proto, packet: 'tcp' | 'udp'): boolean {
  return rule === 'all' || rule === packet;
}

function cidrHas(cidr: string, ip: string): boolean {
  const c = parseIpOrCidr(cidr);
  const n = ipToNumber(ip);
  return c !== null && n !== null && containsIp(c, n);
}

// --- Validation --------------------------------------------------------------------------

export type RuleIssue = 'ports' | 'cidr' | 'number' | 'duplicate' | 'source';

export function checkSgRule(r: SgRule, knownGroups: string[] = []): RuleIssue | null {
  if (r.protocol !== 'all' && !parsePorts(r.ports)) return 'ports';
  if (r.source.startsWith('sg-')) return knownGroups.length && !knownGroups.includes(r.source) ? 'source' : null;
  // "A single IPv4 address. You must use the /32 prefix length."
  if (!r.source.includes('/') || !parseIpOrCidr(r.source)) return 'cidr';
  return null;
}

export function checkNaclRule(r: NaclRule, others: NaclRule[] = []): RuleIssue | null {
  if (!Number.isInteger(r.number) || r.number < 1 || r.number > 32766) return 'number';
  if (others.some((o) => o !== r && o.number === r.number)) return 'duplicate';
  if (r.protocol !== 'all' && !parsePorts(r.ports)) return 'ports';
  if (!r.cidr.includes('/') || !parseIpOrCidr(r.cidr)) return 'cidr';
  return null;
}

// --- Security group (stateful, allow rules only) ---------------------------------------------

export interface Visitor {
  id: string;
  /** Who it is, in the lesson's words ("A shopper's browser"). */
  label: string;
  ip: string;
  /** Security groups of the instance the visitor comes from (for rules that name a group). */
  groups?: string[];
  /** Which kind of client starts the connection (picks the reply ports). Default linux. */
  client?: ClientKind;
  protocol: 'tcp' | 'udp';
  port: number;
  /** Should it get in (and its reply get out), or be kept out? */
  want: 'in' | 'out';
}

export interface SgVerdict {
  allowed: boolean;
  /** Index of the first rule that lets it in (all rules are checked; any one is enough). */
  rule: number | null;
}

/**
 * "Evaluates all rules before deciding whether to allow traffic"; "You can specify allow rules, but not deny
 * rules"; a new group "has no inbound rules … no inbound traffic is allowed". A rule naming a group lets in
 * traffic from the instances in that group ("using the private IP addresses").
 */
export function sgAllows(rules: SgRule[], v: Visitor): SgVerdict {
  const i = rules.findIndex((r) => {
    if (!protoMatches(r.protocol, v.protocol)) return false;
    const range = rangeOf(r.protocol, r.ports);
    if (!range || v.port < range.from || v.port > range.to) return false;
    return r.source.startsWith('sg-') ? (v.groups ?? []).includes(r.source) : cidrHas(r.source, v.ip);
  });
  return { allowed: i >= 0, rule: i >= 0 ? i : null };
}

// --- Network ACL (stateless, numbered, first match wins) ------------------------------------

export interface NaclVerdict {
  allowed: boolean;
  /** The rule that decided, or '*' (nothing matched: the final deny). */
  rule: number | '*';
  /** Rules looked at in order (number + matched?), for the "why" trace. */
  checked: { number: number; matched: boolean }[];
}

export function sortedRules(rules: NaclRule[]): NaclRule[] {
  return [...rules].sort((a, b) => a.number - b.number);
}

/**
 * "Rules are evaluated starting with the lowest numbered rule. As soon as a rule matches traffic, it's applied
 * regardless of any higher-numbered rule that might contradict it." Nothing matched → the * rule denies.
 */
export function naclDecides(rules: NaclRule[], protocol: 'tcp' | 'udp', port: number, ip: string): NaclVerdict {
  const checked: NaclVerdict['checked'] = [];
  for (const r of sortedRules(rules)) {
    const range = rangeOf(r.protocol, r.ports);
    const matched = protoMatches(r.protocol, protocol) && !!range && port >= range.from && port <= range.to && cidrHas(r.cidr, ip);
    checked.push({ number: r.number, matched });
    if (matched) return { allowed: r.action === 'allow', rule: r.number, checked };
  }
  return { allowed: false, rule: '*', checked };
}

export interface RangePiece {
  from: number;
  to: number;
  allowed: boolean;
  rule: number | '*';
}

/**
 * Check a whole port range (the client's ephemeral ports): the reply goes to one port the client picked,
 * so a rule that covers only part of the range lets some replies out and stops others.
 */
export function naclRange(rules: NaclRule[], protocol: 'tcp' | 'udp', range: PortRange, ip: string): RangePiece[] {
  const cuts = new Set<number>([range.from, range.to + 1]);
  for (const r of rules) {
    const rr = rangeOf(r.protocol, r.ports);
    if (!rr) continue;
    if (rr.from > range.from && rr.from <= range.to) cuts.add(rr.from);
    if (rr.to + 1 > range.from && rr.to + 1 <= range.to) cuts.add(rr.to + 1);
  }
  const points = [...cuts].sort((a, b) => a - b);
  const out: RangePiece[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i]!;
    const to = points[i + 1]! - 1;
    const v = naclDecides(rules, protocol, from, ip);
    const last = out[out.length - 1];
    if (last && last.allowed === v.allowed && last.rule === v.rule) last.to = to;
    else out.push({ from, to, allowed: v.allowed, rule: v.rule });
  }
  return out;
}

// --- One visit: gate in → door → reply → gate out ---------------------------------------

export type Outcome = 'in' | 'gateIn' | 'door' | 'gateOut' | 'replySometimes';

export interface Visit {
  visitor: Visitor;
  outcome: Outcome;
  gateIn: NaclVerdict;
  door: SgVerdict | null;
  /** The reply's ports (the client's ephemeral range) and how the outbound NACL treats them. */
  replyPorts: PortRange;
  gateOut: RangePiece[] | null;
}

export interface GateSetup {
  sg: SgRule[];
  nacl: Nacl;
}

/**
 * Traffic from outside the subnet: the inbound NACL, then the security group at the instance. The reply:
 * the security group remembers the conversation ("Responses to allowed inbound traffic are allowed to leave
 * the instance, regardless of the outbound rules"), but the NACL does not ("responses to that traffic are not
 * automatically allowed"), so its outbound rules must allow the client's ephemeral ports.
 */
export function visit(setup: GateSetup, v: Visitor): Visit {
  const replyPorts = { from: EPHEMERAL[v.client ?? 'linux'][0], to: EPHEMERAL[v.client ?? 'linux'][1] };
  const gateIn = naclDecides(setup.nacl.inbound, v.protocol, v.port, v.ip);
  if (!gateIn.allowed) return { visitor: v, outcome: 'gateIn', gateIn, door: null, replyPorts, gateOut: null };
  const door = sgAllows(setup.sg, v);
  if (!door.allowed) return { visitor: v, outcome: 'door', gateIn, door, replyPorts, gateOut: null };
  const gateOut = naclRange(setup.nacl.outbound, v.protocol, replyPorts, v.ip);
  const open = gateOut.filter((p) => p.allowed).length;
  const outcome: Outcome = open === gateOut.length ? 'in' : open === 0 ? 'gateOut' : 'replySometimes';
  return { visitor: v, outcome, gateIn, door, replyPorts, gateOut };
}

/** True when this visit ended the way the task wants. */
export function visitOk(x: Visit): boolean {
  return x.visitor.want === 'in' ? x.outcome === 'in' : x.outcome !== 'in';
}

/** Rules that leave a port open to the whole internet (doc best practice: never for 22 or 3389). */
export function openToWorld(setup: GateSetup, port: number): boolean {
  return setup.sg.some((r) => {
    const range = rangeOf(r.protocol, r.ports);
    return !!range && r.source === '0.0.0.0/0' && port >= range.from && port <= range.to;
  });
}

export interface GateGoal {
  visitors: Visitor[];
  /** Ports that must not be open to 0.0.0.0/0 in the security group (e.g. [22]). */
  forbidOpen?: number[];
}

export function gateDone(setup: GateSetup, goal: GateGoal): boolean {
  if ((goal.forbidOpen ?? []).some((p) => openToWorld(setup, p))) return false;
  return goal.visitors.every((v) => visitOk(visit(setup, v)));
}
