// Security group and network ACL tests, each from a worked example or rule in the Amazon VPC User Guide:
//   custom-network-acl.html (example tables, "Ephemeral ports"), nacl-examples.html (SSH from a remote
//   computer), default-network-acl.html, vpc-security-groups.html, security-group-rules.html.
import { describe, expect, it } from 'vitest';
import {
  checkNaclRule,
  checkSgRule,
  DEFAULT_NACL,
  EPHEMERAL,
  gateDone,
  naclDecides,
  naclRange,
  NEW_CUSTOM_NACL,
  openToWorld,
  parsePorts,
  sgAllows,
  visit,
  type NaclRule,
  type SgRule,
  type Visitor,
} from './gates';

// custom-network-acl.html, "Example inbound rules" / "Example outbound rules" (IPv4 rows).
const exampleIn: NaclRule[] = [
  { number: 100, protocol: 'tcp', ports: '80', cidr: '0.0.0.0/0', action: 'allow' },
  { number: 110, protocol: 'tcp', ports: '443', cidr: '0.0.0.0/0', action: 'allow' },
  { number: 120, protocol: 'tcp', ports: '22', cidr: '192.0.2.0/24', action: 'allow' },
  { number: 140, protocol: 'tcp', ports: '32768-65535', cidr: '0.0.0.0/0', action: 'allow' },
];
const exampleOut: NaclRule[] = [
  { number: 100, protocol: 'tcp', ports: '80', cidr: '0.0.0.0/0', action: 'allow' },
  { number: 110, protocol: 'tcp', ports: '443', cidr: '0.0.0.0/0', action: 'allow' },
  { number: 120, protocol: 'tcp', ports: '1024-65535', cidr: '192.0.2.0/24', action: 'allow' },
  { number: 140, protocol: 'tcp', ports: '32768-65535', cidr: '0.0.0.0/0', action: 'allow' },
];

describe('Network ACL rule order (custom-network-acl, nacl-rules)', () => {
  it('"IPv4 traffic destined for the HTTPS port (443) … doesn\'t match rule 100 … It matches rule 110"', () => {
    const v = naclDecides(exampleIn, 'tcp', 443, '198.51.100.20');
    expect(v).toMatchObject({ allowed: true, rule: 110 });
    expect(v.checked).toEqual([
      { number: 100, matched: false },
      { number: 110, matched: true },
    ]);
  });
  it('"If the packet had been destined for port 139 (NetBIOS) … the * rule … ultimately denies the packet"', () => {
    expect(naclDecides(exampleIn, 'tcp', 139, '198.51.100.20')).toMatchObject({ allowed: false, rule: '*' });
  });
  it('rules are checked lowest number first, whatever order they were written in', () => {
    const shuffled = [exampleIn[3]!, exampleIn[1]!, exampleIn[0]!, exampleIn[2]!];
    expect(naclDecides(shuffled, 'tcp', 443, '198.51.100.20').rule).toBe(110);
  });
  it('a deny placed earlier than a wide allow wins ("place the deny rules earlier in the table")', () => {
    const rules: NaclRule[] = [
      { number: 90, protocol: 'tcp', ports: '4444', cidr: '0.0.0.0/0', action: 'deny' },
      { number: 100, protocol: 'tcp', ports: '1024-65535', cidr: '0.0.0.0/0', action: 'allow' },
    ];
    expect(naclDecides(rules, 'tcp', 4444, '203.0.113.5')).toMatchObject({ allowed: false, rule: 90 });
    expect(naclDecides(rules, 'tcp', 5000, '203.0.113.5')).toMatchObject({ allowed: true, rule: 100 });
    // The other way round, the allow is met first.
    const late = [{ ...rules[0]!, number: 200 }, rules[1]!];
    expect(naclDecides(late, 'tcp', 4444, '203.0.113.5')).toMatchObject({ allowed: true, rule: 100 });
  });
  it('the default NACL allows everything; a new custom NACL denies everything', () => {
    expect(naclDecides(DEFAULT_NACL.inbound, 'udp', 53, '8.8.8.8')).toMatchObject({ allowed: true, rule: 100 });
    expect(naclDecides(NEW_CUSTOM_NACL.inbound, 'tcp', 80, '8.8.8.8')).toMatchObject({ allowed: false, rule: '*' });
  });
  it('rule numbers are 1 to 32766 and unique; ports and CIDRs must read', () => {
    expect(checkNaclRule({ number: 0, protocol: 'tcp', ports: '80', cidr: '0.0.0.0/0', action: 'allow' })).toBe('number');
    expect(checkNaclRule({ number: 32767, protocol: 'tcp', ports: '80', cidr: '0.0.0.0/0', action: 'allow' })).toBe('number');
    expect(checkNaclRule(exampleIn[0]!, exampleIn)).toBeNull();
    expect(checkNaclRule({ ...exampleIn[0]!, ports: '80' }, exampleIn)).toBe('duplicate');
    expect(checkNaclRule({ ...exampleIn[0]!, number: 5, ports: '90-80' })).toBe('ports');
    expect(checkNaclRule({ ...exampleIn[0]!, number: 5, cidr: '10.0.0.1' })).toBe('cidr');
  });
});

describe('Ephemeral ports (custom-network-acl, "Ephemeral ports")', () => {
  it('the client picks the range', () => {
    expect(EPHEMERAL).toEqual({
      linux: [32768, 61000],
      windows: [49152, 65535],
      windowsOld: [1025, 5000],
      elb: [1024, 65535],
      nat: [1024, 65535],
      lambda: [1024, 65535],
    });
  });
  it('"a Windows 10 client … your network ACL must have an outbound rule to enable traffic destined for ports 49152-65535"', () => {
    expect(naclRange(exampleOut, 'tcp', { from: 49152, to: 65535 }, '198.51.100.20')).toEqual([{ from: 49152, to: 65535, allowed: true, rule: 140 }]);
    const narrow: NaclRule[] = [{ number: 100, protocol: 'tcp', ports: '1024-5000', cidr: '0.0.0.0/0', action: 'allow' }];
    expect(naclRange(narrow, 'tcp', { from: 49152, to: 65535 }, '198.51.100.20')).toEqual([{ from: 49152, to: 65535, allowed: false, rule: '*' }]);
  });
  it('the example\'s 32768-65535 covers Linux clients but only part of a load balancer\'s 1024-65535', () => {
    expect(naclRange(exampleOut, 'tcp', { from: 32768, to: 61000 }, '198.51.100.20').every((p) => p.allowed)).toBe(true);
    expect(naclRange(exampleOut, 'tcp', { from: 1024, to: 65535 }, '198.51.100.20')).toEqual([
      { from: 1024, to: 32767, allowed: false, rule: '*' },
      { from: 32768, to: 65535, allowed: true, rule: 140 },
    ]);
  });
  it('"to cover the different types of clients … you can open ephemeral ports 1024-65535"', () => {
    const wide: NaclRule[] = [{ number: 100, protocol: 'tcp', ports: '1024-65535', cidr: '0.0.0.0/0', action: 'allow' }];
    for (const r of Object.values(EPHEMERAL)) expect(naclRange(wide, 'tcp', { from: r[0], to: r[1] }, '203.0.113.9').every((p) => p.allowed)).toBe(true);
  });
});

describe('Security groups (vpc-security-groups, security-group-rules)', () => {
  const browser: Visitor = { id: 'b', label: 'browser', ip: '198.51.100.20', protocol: 'tcp', port: 443, want: 'in' };
  it('"When you first create a security group, it has no inbound rules"', () => {
    expect(sgAllows([], browser)).toEqual({ allowed: false, rule: null });
  });
  it('allow rules only, and any one matching rule is enough ("Evaluates all rules")', () => {
    const rules: SgRule[] = [
      { protocol: 'tcp', ports: '22', source: '203.0.113.0/24' },
      { protocol: 'tcp', ports: '443', source: '0.0.0.0/0' },
    ];
    expect(sgAllows(rules, browser)).toEqual({ allowed: true, rule: 1 });
    expect(sgAllows(rules, { ...browser, port: 22 }).allowed).toBe(false);
  });
  it('a rule naming a security group lets in its instances (the doc\'s web → database example)', () => {
    const db: SgRule[] = [{ protocol: 'tcp', ports: '3306', source: 'sg-web' }];
    const web: Visitor = { id: 'w', label: 'web server', ip: '10.0.1.20', groups: ['sg-web'], protocol: 'tcp', port: 3306, want: 'in' };
    expect(sgAllows(db, web).allowed).toBe(true);
    expect(sgAllows(db, { ...web, groups: [], ip: '198.51.100.20' }).allowed).toBe(false);
  });
  it('a single address needs /32; group ids must exist', () => {
    expect(checkSgRule({ protocol: 'tcp', ports: '22', source: '203.0.113.1' })).toBe('cidr');
    expect(checkSgRule({ protocol: 'tcp', ports: '22', source: '203.0.113.1/32' })).toBeNull();
    expect(checkSgRule({ protocol: 'tcp', ports: '22', source: 'sg-nope' }, ['sg-web'])).toBe('source');
  });
  it('ports read as one number, a range, or all', () => {
    expect(parsePorts('22')).toEqual({ from: 22, to: 22 });
    expect(parsePorts('7000-8000')).toEqual({ from: 7000, to: 8000 });
    expect(parsePorts(undefined)).toEqual({ from: 0, to: 65535 });
    expect(parsePorts('70000')).toBeNull();
  });
});

describe('A whole visit: NACL in → SG → reply → NACL out', () => {
  // nacl-examples.html: only the remote computer 172.31.1.2 may SSH in.
  const remote: Visitor = { id: 'admin', label: 'remote computer', ip: '172.31.1.2', protocol: 'tcp', port: 22, want: 'in' };
  const stranger: Visitor = { ...remote, id: 'x', ip: '198.51.100.7', want: 'out' };
  const setup = {
    sg: [{ protocol: 'tcp', ports: '22', source: '172.31.1.2/32' }] as SgRule[],
    nacl: {
      inbound: [{ number: 100, protocol: 'tcp', ports: '22', cidr: '172.31.1.2/32', action: 'allow' }] as NaclRule[],
      outbound: [{ number: 100, protocol: 'tcp', ports: '1024-65535', cidr: '172.31.1.2/32', action: 'allow' }] as NaclRule[],
    },
  };
  it('the remote computer gets in and the reply gets out', () => {
    expect(visit(setup, remote).outcome).toBe('in');
  });
  it('anyone else stops at the gate', () => {
    expect(visit(setup, stranger)).toMatchObject({ outcome: 'gateIn', gateIn: { rule: '*' } });
  });
  it('"if you accidentally update the security group to allow inbound SSH access from anywhere, the network ACL still restricts access"', () => {
    const loose = { ...setup, sg: [{ protocol: 'tcp', ports: '22', source: '0.0.0.0/0' }] as SgRule[] };
    expect(visit(loose, stranger).outcome).toBe('gateIn');
    expect(openToWorld(loose, 22)).toBe(true);
  });
  it('security groups are stateful: no outbound SG rules are needed for the reply', () => {
    const open = { sg: [{ protocol: 'tcp', ports: '443', source: '0.0.0.0/0' }] as SgRule[], nacl: DEFAULT_NACL };
    expect(visit(open, { id: 'b', label: 'b', ip: '198.51.100.20', protocol: 'tcp', port: 443, want: 'in' }).outcome).toBe('in');
  });
  it('NACLs are stateless: without an outbound rule the reply is stopped', () => {
    const noOut = { ...setup, nacl: { ...setup.nacl, outbound: [] } };
    expect(visit(noOut, remote)).toMatchObject({ outcome: 'gateOut', gateOut: [{ allowed: false, rule: '*' }] });
  });
  it('a reply rule that covers only part of the client\'s range lets only some replies out', () => {
    const half = { ...setup, nacl: { ...setup.nacl, outbound: [{ number: 100, protocol: 'tcp', ports: '49152-65535', cidr: '0.0.0.0/0', action: 'allow' }] as NaclRule[] } };
    expect(visit(half, remote).outcome).toBe('replySometimes');
    expect(visit(half, { ...remote, client: 'windows' }).outcome).toBe('in');
  });
  it('a visitor stopped by the security group never reaches the reply check', () => {
    expect(visit({ ...setup, sg: [] }, remote)).toMatchObject({ outcome: 'door', gateOut: null });
  });
  it('the goal: every visitor ends the way the task wants, nothing forbidden is open', () => {
    expect(gateDone(setup, { visitors: [remote, stranger] })).toBe(true);
    const loose = { ...setup, sg: [{ protocol: 'tcp', ports: '22', source: '0.0.0.0/0' }] as SgRule[] };
    expect(gateDone(loose, { visitors: [remote, stranger] })).toBe(true);
    expect(gateDone(loose, { visitors: [remote, stranger], forbidOpen: [22] })).toBe(false);
  });
});
