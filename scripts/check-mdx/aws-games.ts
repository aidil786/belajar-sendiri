// Author checks for the AWS games (Level Up): IamJudge, SubnetPlanner, SecurityGroupGate, IdleBill.
// The props make sense, every policy is one the evaluator models, the task is possible, and it isn't
// already done before the learner starts. Returns readable errors.
import { autoPlan, checkPlan, checkVpcCidr, prefixFor } from '../../src/lib/aws/cidr';
import {
  checkNaclRule,
  checkSgRule,
  DEFAULT_NACL,
  EPHEMERAL,
  gateDone,
  NEW_CUSTOM_NACL,
  type Nacl,
  type NaclRule,
  type SgRule,
  type Visitor,
} from '../../src/lib/aws/gates';
import { editLine, evaluate, formatPolicy, MAX_POLICY_LINES, parseCaller, validatePolicy, type NamedPolicy, type PolicyDoc } from '../../src/lib/aws/iam';
import { IDLE_BY_ID } from '../../src/lib/aws/idleCosts';

export const AWS_REQUIRED: Record<string, string[]> = {
  IamJudge: ['request', 'policies'],
  SubnetPlanner: ['vpc'],
  SecurityGroupGate: ['visitors'],
  IdleBill: [],
};

const KINDS = new Set(['identity', 'boundary', 'resource', 'scp']);

function badRegex(src: unknown): string | null {
  try {
    new RegExp(String(src));
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

export function checkAwsGame(name: string, a: Record<string, unknown>, where: string): string[] {
  const errors: string[] = [];
  const err = (m: string) => errors.push(`${where}: ${name} ${m}`);

  if (name === 'IamJudge') {
    const req = a.request as { principal?: string; action?: string; resource?: string } | undefined;
    if (!req?.principal || !parseCaller(req.principal)) err('request.principal must be an IAM user ARN or a role session ARN');
    if (!req?.action || !/^[a-z0-9-]+:[A-Za-z0-9]+$/.test(req.action)) err('request.action must look like s3:GetObject');
    if (!req?.resource || !(req.resource === '*' || req.resource.startsWith('arn:'))) err('request.resource must be an ARN or *');
    const policies = (a.policies ?? []) as { name?: string; kind?: string; level?: string; doc?: PolicyDoc }[];
    if (!policies.length) err('needs at least one policy');
    policies.forEach((p, i) => {
      if (!p.name) err(`policy ${i + 1} needs a name`);
      if (!KINDS.has(String(p.kind))) err(`policy ${i + 1} kind must be identity, boundary, resource or scp`);
      const issues = validatePolicy(p.doc, (p.kind ?? 'identity') as NamedPolicy['kind']);
      for (const is of issues) err(`policy "${p.name}" is not modelled: ${is.code}${'value' in is ? ` (${is.value})` : ''}`);
      if (!issues.length) {
        const lines = formatPolicy(p.doc!).lines.length;
        if (lines > MAX_POLICY_LINES) err(`policy "${p.name}" is ${lines} lines on the card (max ${MAX_POLICY_LINES}); split it`);
      }
    });
    if (errors.length) return errors;
    const named = policies as NamedPolicy[];
    const task = (a.task ?? { type: 'predict' }) as { type: string; policy?: number; line?: number; want?: string; forbid?: string[] };
    if (task.type === 'edit') {
      const p = named[task.policy ?? -1];
      if (!p) return [...errors, `${where}: ${name} task.policy must be the index of a policy`];
      const lines = formatPolicy(p.doc).lines;
      if (!task.line || task.line < 1 || task.line > lines.length) err(`task.line must be 1–${lines.length}`);
      if (task.want !== 'Allow' && task.want !== 'Deny') err('task.want must be Allow or Deny');
      for (const f of task.forbid ?? []) if (badRegex(f)) err(`forbid ${JSON.stringify(f)} is not a valid regex`);
      if (evaluate(req as never, named).decision === task.want) err('task is already done before the learner starts');
      if (a.solution === undefined) err('an edit task needs a `solution` line');
      else if (task.line) {
        const parsed = editLine(lines, task.line, String(a.solution), p.kind);
        if (!parsed.ok) err(`solution does not parse: ${parsed.jsonError ?? parsed.issues.map((x) => x.code).join(', ')}`);
        else {
          const next = named.map((x, i) => (i === task.policy ? { ...x, doc: parsed.doc! } : x));
          if (evaluate(req as never, next).decision !== task.want) err(`solution does not make AWS say ${task.want}`);
          if ((task.forbid ?? []).some((f) => !badRegex(f) && new RegExp(f).test(String(a.solution)))) err('solution matches `forbid`');
        }
      }
    } else if (task.type !== 'predict') err('task.type must be predict or edit');
  }

  if (name === 'SubnetPlanner') {
    const vpc = String(a.vpc ?? '');
    const azs = (a.azs ?? ['ap-southeast-5a', 'ap-southeast-5b']) as string[];
    const tiers = (a.tiers ?? ['public', 'private']) as string[];
    const need = (a.need ?? {}) as Record<string, number>;
    const start = (a.start ?? []) as { tier: string; az: string; cidr: string }[];
    if (!azs.length || !tiers.length) err('needs at least one AZ and one tier');
    for (const t of tiers) if (t !== 'public' && t !== 'private') err(`unknown tier "${t}" (public or private)`);
    for (const [t, n] of Object.entries(need)) {
      if (!tiers.includes(t)) err(`need names a tier that isn't planned: ${t}`);
      if (!Number.isInteger(n) || n < 1 || prefixFor(n) === null) err(`need.${t} must be a whole number a /16 can hold`);
    }
    for (const s of start) if (!tiers.includes(s.tier) || !azs.includes(s.az)) err(`start has an unknown cell ${s.tier}:${s.az}`);
    const vpcOk = checkVpcCidr(vpc).ok;
    if (!vpcOk && !a.editVpc) err(`vpc ${vpc} is not a valid VPC block`);
    if (vpcOk) {
      const cells = tiers.flatMap((t) => azs.map((az) => ({ id: `${t}:${az}`, need: need[t] ?? 1 })));
      if (!autoPlan(vpc, cells)) err('the brief cannot fit in this VPC');
      const plan = cells.map((c) => {
        const [t, az] = c.id.split(':');
        return { id: c.id, cidr: start.find((s) => s.tier === t && s.az === az)?.cidr ?? '', need: need[t!] };
      });
      if (plan.every((p) => p.cidr) && checkPlan(vpc, plan).every((c) => c.ok)) err('task is already done before the learner starts');
    }
  }

  if (name === 'SecurityGroupGate') {
    const visitors = (a.visitors ?? []) as Visitor[];
    const edit = (a.edit ?? 'sg') as string;
    const groups = (a.groups ?? []) as string[];
    const sg = (a.sg ?? []) as SgRule[];
    const naclProp = a.nacl ?? 'default';
    const nacl: Nacl = naclProp === 'default' ? DEFAULT_NACL : naclProp === 'custom' ? NEW_CUSTOM_NACL : (naclProp as Nacl);
    if (!['sg', 'nacl', 'both'].includes(edit)) err('edit must be sg, nacl or both');
    if (!visitors.length) err('needs at least one visitor');
    const ids = new Set<string>();
    for (const v of visitors) {
      if (ids.has(v.id)) err(`visitor id "${v.id}" is used twice`);
      ids.add(v.id);
      if (!/^\d+\.\d+\.\d+\.\d+$/.test(v.ip)) err(`visitor "${v.id}" needs an IPv4 address`);
      if (v.protocol !== 'tcp' && v.protocol !== 'udp') err(`visitor "${v.id}" protocol must be tcp or udp`);
      if (!Number.isInteger(v.port) || v.port < 0 || v.port > 65535) err(`visitor "${v.id}" port must be 0–65535`);
      if (v.want !== 'in' && v.want !== 'out') err(`visitor "${v.id}" want must be in or out`);
      if (v.client && !(v.client in EPHEMERAL)) err(`visitor "${v.id}" client must be one of ${Object.keys(EPHEMERAL).join(', ')}`);
    }
    for (const r of sg) {
      const bad = checkSgRule(r, groups);
      if (bad) err(`security group rule ${JSON.stringify(r)}: ${bad}`);
    }
    for (const dir of ['inbound', 'outbound'] as const)
      for (const r of nacl[dir]) {
        const bad = checkNaclRule(r, nacl[dir]);
        if (bad) err(`network ACL ${dir} rule ${r.number}: ${bad}`);
      }
    const goal = { visitors, forbidOpen: (a.forbidOpen ?? []) as number[] };
    if (!errors.length) {
      if (gateDone({ sg, nacl }, goal)) err('task is already done before the learner starts');
      // A tight answer: one /32 rule per visitor that should get in (its group, if it has one).
      const wanted = visitors.filter((v) => v.want === 'in');
      const tightSg: SgRule[] = wanted.map((v) => ({ protocol: v.protocol, ports: String(v.port), source: v.groups?.[0] ?? `${v.ip}/32` }));
      const tightNacl: Nacl = {
        inbound: wanted.map((v, i): NaclRule => ({ number: 100 + i, protocol: v.protocol, ports: String(v.port), cidr: `${v.ip}/32`, action: 'allow' })),
        outbound: wanted.map((v, i): NaclRule => {
          const [from, to] = EPHEMERAL[v.client ?? 'linux'];
          return { number: 100 + i, protocol: v.protocol, ports: `${from}-${to}`, cidr: `${v.ip}/32`, action: 'allow' };
        }),
      };
      const setup = { sg: edit === 'nacl' ? sg : tightSg, nacl: edit === 'sg' ? nacl : tightNacl };
      if (!gateDone(setup, goal)) err('the task cannot be met by changing only the rules the learner may edit');
    }
  }

  if (name === 'IdleBill') {
    const items = (a.items ?? []) as string[];
    if (a.items !== undefined) {
      if (items.length < 2) err('needs at least 2 items');
      for (const id of items) if (!IDLE_BY_ID.has(id)) err(`unknown item "${id}"`);
      const buckets = new Set(items.map((id) => IDLE_BY_ID.get(id)?.bucket));
      if (buckets.size < 2) err('needs items from both buckets (costs and free)');
    }
  }
  return errors;
}
