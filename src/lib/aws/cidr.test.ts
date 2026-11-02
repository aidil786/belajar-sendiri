// Every expectation below is a worked example or a stated rule from the Amazon VPC User Guide:
//   VPC CIDR blocks:    https://docs.aws.amazon.com/vpc/latest/userguide/vpc-cidr-blocks.html
//   Subnet CIDR blocks: https://docs.aws.amazon.com/vpc/latest/userguide/subnet-sizing.html
import { describe, expect, it } from 'vitest';
import {
  autoPlan,
  blockSize,
  checkPlan,
  checkVpcCidr,
  firstFreeBlock,
  parseCidr,
  prefixFor,
  reservedAddresses,
  splitVpc,
  usableAddresses,
  usableRange,
} from './cidr';

describe('CIDR parsing', () => {
  it('reads a.b.c.d/n and keeps the canonical form', () => {
    expect(parseCidr('10.0.0.0/16')).toMatchObject({ ok: true, cidr: { prefix: 16, text: '10.0.0.0/16' }, canonicalised: false });
  });
  it('clears host bits like the API (subnet-sizing: 100.68.0.18/18 → 100.68.0.0/18)', () => {
    expect(parseCidr('100.68.0.18/18')).toMatchObject({ ok: true, cidr: { text: '100.68.0.0/18' }, canonicalised: true });
  });
  it('refuses broken text kindly', () => {
    expect(parseCidr('10.0.0/16').error).toBe('format');
    expect(parseCidr('10.0.0.256/16').error).toBe('octet');
    expect(parseCidr('10.0.0.0/33').error).toBe('prefix');
    expect(parseCidr('ten/8').error).toBe('format');
  });
});

describe('VPC size and ranges (vpc-cidr-blocks)', () => {
  it('"/16 netmask (65,536 IP addresses) and /28 netmask (16 IP addresses)"', () => {
    expect(blockSize(16)).toBe(65536);
    expect(blockSize(28)).toBe(16);
    expect(checkVpcCidr('10.0.0.0/16').ok).toBe(true);
    expect(checkVpcCidr('10.0.0.0/28').ok).toBe(true);
    expect(checkVpcCidr('10.0.0.0/15').errors).toEqual([{ code: 'tooBig', prefix: 15 }]);
    expect(checkVpcCidr('10.0.0.0/29').errors).toEqual([{ code: 'tooSmall', prefix: 29 }]);
  });
  it('accepts the doc table examples (10.0.0.0/16, 172.31.0.0/16, 192.168.0.0/20)', () => {
    for (const c of ['10.0.0.0/16', '172.31.0.0/16', '192.168.0.0/20']) expect(checkVpcCidr(c)).toMatchObject({ ok: true, notes: [] });
  });
  it('refuses the ranges "You can\'t specify"', () => {
    expect(checkVpcCidr('127.0.0.0/16').errors).toContainEqual({ code: 'forbidden', range: '127.0.0.0/8' });
    expect(checkVpcCidr('169.254.0.0/16').errors).toContainEqual({ code: 'forbidden', range: '169.254.0.0/16' });
    expect(checkVpcCidr('224.0.0.0/16').errors).toContainEqual({ code: 'forbidden', range: '224.0.0.0/4' });
    expect(checkVpcCidr('0.0.0.0/16').errors).toContainEqual({ code: 'forbidden', range: '0.0.0.0/8' });
  });
  it('warns about 172.17.0.0/16 (used by some AWS services) and about public ranges', () => {
    expect(checkVpcCidr('172.17.0.0/16')).toMatchObject({ ok: true, notes: [{ code: 'avoid172', range: '172.17.0.0/16' }] });
    expect(checkVpcCidr('100.68.0.0/18')).toMatchObject({ ok: true, notes: [{ code: 'publicRange' }] });
  });
});

describe('Subnets (subnet-sizing)', () => {
  it('the five reserved addresses of 10.0.0.0/24', () => {
    expect(reservedAddresses(parseCidr('10.0.0.0/24').cidr!)).toEqual([
      { ip: '10.0.0.0', role: 'network' },
      { ip: '10.0.0.1', role: 'router' },
      { ip: '10.0.0.2', role: 'dns' },
      { ip: '10.0.0.3', role: 'future' },
      { ip: '10.0.0.255', role: 'broadcast' },
    ]);
    expect(usableAddresses(24)).toBe(251);
    expect(usableAddresses(28)).toBe(11);
    expect(usableRange(parseCidr('10.0.0.0/24').cidr!)).toEqual(['10.0.0.4', '10.0.0.254']);
  });
  it('splits 10.0.0.0/24 into 10.0.0.0/25 and 10.0.0.128/25 (the doc example)', () => {
    expect(splitVpc('10.0.0.0/24', 25, 2)).toEqual(['10.0.0.0/25', '10.0.0.128/25']);
    expect(splitVpc('10.0.0.0/24', 25, 3)).toBeNull();
  });
  it('a subnet may equal the VPC block, must sit inside it, and must not overlap another', () => {
    expect(checkPlan('10.0.0.0/24', [{ id: 'only', cidr: '10.0.0.0/24' }])[0]!.ok).toBe(true);
    const [a, b, c] = checkPlan('10.0.0.0/16', [
      { id: 'a', cidr: '10.0.0.0/24' },
      { id: 'b', cidr: '10.0.0.128/25' },
      { id: 'c', cidr: '10.1.0.0/24' },
    ]);
    expect(a!.errors).toEqual([{ code: 'overlap', other: 'b' }]);
    expect(b!.errors).toEqual([{ code: 'overlap', other: 'a' }]);
    expect(c!.errors).toEqual([{ code: 'outside', vpc: '10.0.0.0/16' }]);
  });
  it('subnet sizes are /16 to /28', () => {
    expect(checkPlan('10.0.0.0/16', [{ id: 'x', cidr: '10.0.0.0/29' }])[0]!.errors).toEqual([{ code: 'tooSmall', prefix: 29 }]);
  });
  it('counts usable addresses against the brief', () => {
    expect(checkPlan('10.0.0.0/16', [{ id: 'x', cidr: '10.0.0.0/28', need: 12 }])[0]!.errors).toEqual([
      { code: 'tooFewIps', usable: 11, need: 12 },
    ]);
    expect(prefixFor(12)).toBe(27);
    expect(prefixFor(251)).toBe(24);
    expect(prefixFor(252)).toBe(23);
    expect(prefixFor(70000)).toBeNull();
  });
});

describe('Planning helpers', () => {
  it('finds the first free aligned block', () => {
    expect(firstFreeBlock('10.0.0.0/16', 24, [])).toBe('10.0.0.0/24');
    expect(firstFreeBlock('10.0.0.0/16', 24, ['10.0.0.0/24', '10.0.1.0/24'])).toBe('10.0.2.0/24');
    expect(firstFreeBlock('10.0.0.0/16', 24, ['10.0.0.0/20'])).toBe('10.0.16.0/24');
    expect(firstFreeBlock('10.0.0.0/28', 28, ['10.0.0.0/28'])).toBeNull();
  });
  it('lays out a whole plan, biggest first', () => {
    const plan = autoPlan('10.0.0.0/22', [
      { id: 'public:a', need: 20 },
      { id: 'private:a', need: 200 },
      { id: 'public:b', need: 20 },
      { id: 'private:b', need: 200 },
    ])!;
    expect(plan).toEqual({ 'private:a': '10.0.0.0/24', 'private:b': '10.0.1.0/24', 'public:a': '10.0.2.0/27', 'public:b': '10.0.2.32/27' });
    expect(checkPlan('10.0.0.0/22', Object.entries(plan).map(([id, cidr]) => ({ id, cidr }))).every((s) => s.ok)).toBe(true);
    expect(autoPlan('10.0.0.0/24', [{ id: 'a', need: 200 }, { id: 'b', need: 200 }])).toBeNull();
  });
});
