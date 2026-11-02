// The idle-cost knowledge set: every item has words in both languages and an official source, and no
// price ever appears (prices change; the pricing pages are linked instead). Also checks that every i18n key
// the AWS games build at run time exists.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import en from '../../i18n/en.json';
import ms from '../../i18n/ms.json';
import { IDLE_DEFAULT, IDLE_ITEMS, idleItems } from './idleCosts';

const EN = en as Record<string, string>;
const MS = ms as Record<string, string>;

describe('idle-cost knowledge set', () => {
  it('every item has a name and a why in English and Malay', () => {
    for (const it of IDLE_ITEMS) {
      for (const field of ['name', 'why']) {
        const key = `aws.idle.item.${it.id}.${field}`;
        expect(EN[key], key).toBeTruthy();
        expect(MS[key], key).toBeTruthy();
      }
    }
  });
  it('every source is an official AWS page over https', () => {
    for (const it of IDLE_ITEMS) {
      expect(it.sources.length, it.id).toBeGreaterThan(0);
      for (const s of [...it.sources.map((x) => x.url), ...(it.pricing ? [it.pricing] : [])])
        expect(s, it.id).toMatch(/^https:\/\/(docs\.aws\.amazon\.com|aws\.amazon\.com)\//);
    }
  });
  it('never states a price', () => {
    const texts = Object.entries({ ...EN, ...Object.fromEntries(Object.entries(MS).map(([k, v]) => [`ms:${k}`, v])) })
      .filter(([k]) => k.includes('aws.idle.'))
      .map(([, v]) => v);
    for (const v of texts) expect(v).not.toMatch(/\$|USD|RM\s?\d|\d+\.\d+\s*(per|\/)|cents?\b|sen\b/i);
  });
  it('ids are unique, both buckets exist, and the default set is balanced', () => {
    expect(new Set(IDLE_ITEMS.map((i) => i.id)).size).toBe(IDLE_ITEMS.length);
    const d = idleItems(IDLE_DEFAULT);
    expect(d.filter((i) => i.bucket === 'costs')).toHaveLength(4);
    expect(d.filter((i) => i.bucket === 'free')).toHaveLength(4);
    expect(() => idleItems(['nope'])).toThrow(/Unknown idle item/);
  });
});

describe('AWS game words', () => {
  it('every literal aws.* key used by the components exists in both languages', () => {
    const dir = 'src/components/interactives';
    const files = readdirSync(dir).filter((f) => /^(IamJudge|SubnetPlanner|SecurityGroupGate|IdleBill)\.tsx$/.test(f));
    expect(files).toHaveLength(4);
    const keys = new Set<string>();
    for (const f of files) for (const m of readFileSync(join(dir, f), 'utf8').matchAll(/'(aws\.[A-Za-z0-9.]+)'/g)) keys.add(m[1]!);
    const missing = [...keys].filter((k) => !k.endsWith('.') && !(k in EN && k in MS));
    expect(missing).toEqual([]);
  });
  it('keys built at run time exist', () => {
    const built = [
      ...['deny', 'scp', 'resource', 'identity', 'boundary'].map((s) => `aws.iam.step.${s}`),
      ...['pass', 'skip', 'stopDeny', 'stopAllow'].map((s) => `aws.iam.outcome.${s}`),
      ...[
        'explicitDeny', 'noDeny', 'noScp', 'scpNoAllow', 'scpAllows', 'noResourcePolicy', 'resourceNoAllow', 'resourceAllowsUser',
        'resourceAllowsSession', 'resourceAllowsRole', 'identityNotNeeded', 'identityNoAllow', 'noIdentityPolicy', 'identityAllows',
        'noBoundary', 'boundaryNoAllow', 'boundaryAllows',
      ].map((s) => `aws.iam.why.${s}`),
      ...['deny', 'scp', 'identity', 'boundary', 'allow', 'resource'].map((s) => `aws.iam.hint.${s}`),
      ...[
        'notObject', 'noStatement', 'effect', 'needAction', 'bothAction', 'needResource', 'bothResource', 'actionFormat',
        'serviceWildcard', 'arnFormat', 'principalNeeded', 'principalNotAllowed', 'principalType', 'operator', 'variable',
        'unknownKey', 'ipv6',
      ].map((s) => `aws.iam.issueCode.${s}`),
      ...['identity', 'boundary', 'resource', 'scp'].map((s) => `aws.iam.policyKind.${s}`),
      ...['user', 'roleSession'].map((s) => `aws.iam.kind.${s}`),
      ...['predict', 'edit'].flatMap((s) => [`aws.iam.help.${s}`, `aws.iam.done.${s}`]),
      ...['format', 'octet', 'prefix', 'tooBig', 'tooSmall', 'outside', 'overlap', 'tooFewIps'].map((s) => `aws.subnet.err.${s}`),
      ...['tooBig', 'tooSmall', 'forbidden', 'avoid172', 'publicRange'].map((s) => `aws.subnet.vpcErr.${s}`),
      ...['network', 'router', 'dns', 'future', 'broadcast'].map((s) => `aws.subnet.role.${s}`),
      ...['public', 'private'].flatMap((s) => [`aws.subnet.tier.${s}`, `aws.subnet.tierShort.${s}`]),
      ...['sg', 'nacl', 'both'].map((s) => `aws.gate.help.${s}`),
      ...['in', 'out'].map((s) => `aws.gate.want.${s}`),
      ...['tcp', 'udp', 'all'].map((s) => `aws.gate.proto.${s}`),
      ...['in', 'gateIn', 'door', 'gateOut', 'replySometimes'].map((s) => `aws.gate.result.${s}`),
      ...['ports', 'cidr', 'number', 'duplicate', 'source'].map((s) => `aws.gate.badRule.${s}`),
      ...['inbound', 'outbound', 'allow', 'deny'].map((s) => `aws.gate.${s}`),
      ...['costs', 'free'].map((s) => `aws.idle.${s}`),
    ];
    expect(built.filter((k) => !(k in EN && k in MS))).toEqual([]);
  });
});
