// IAM policy evaluation for requests within ONE AWS account (Level Up · AWS, A2 "Keys & Guards").
// Pure functions, no DOM. The order and every rule come from the IAM User Guide (checked 2026-11-01):
//   Evaluation order:      https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic_policy-eval-denyallow.html
//   Single-account examples: https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic_policy-eval-basics.html
//   Explicit vs implicit deny: https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic_AccessPolicyLanguage_Interplay.html
//   Permissions boundaries: https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_boundaries.html
//   SCPs (idea level):      https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_scps_evaluation.html
//   Action / NotAction:     https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements_action.html
//                           https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements_notaction.html
//   Resource / NotResource: https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements_resource.html
//                           https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements_notresource.html
//   Conditions:             https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements_condition.html
//                           https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements_condition_operators.html
//                           https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_condition-logic-multiple-context-keys-or-values.html
//
// The order (denyallow doc): 1 any explicit Deny in any policy → Deny. 2 SCPs: every level needs an Allow,
// else Deny. 3 Resource-based policy: an Allow naming the IAM user or the role session → Allow (an implicit
// deny in identity policies or the boundary doesn't matter); an Allow naming the role ARN skips the identity
// check but still needs the boundary. 4 Identity-based policies need an Allow, else Deny. 5 A permissions
// boundary (if any) needs an Allow, else Deny. 6 Allow.
//
// Not modelled (the game refuses these policies, so it never guesses): the root user, cross-account requests,
// RCPs (always "RCPFullAWSAccess" here), session policies, federated-user sessions, Principal "*" / account /
// service principals, NotPrincipal, policy variables (${aws:username}), Numeric/Date/Binary operators,
// ForAllValues/ForAnyValue, IPv6 addresses, service-specific exceptions (role trust policies and KMS key
// policies must allow explicitly), and the management account / service-linked roles that SCPs don't touch.

import { containsIp, ipToNumber, parseIpOrCidr } from './cidr';

export type Effect = 'Allow' | 'Deny';
export type StrOrList = string | string[];

export interface Statement {
  Sid?: string;
  Effect: Effect;
  Action?: StrOrList;
  NotAction?: StrOrList;
  Resource?: StrOrList;
  NotResource?: StrOrList;
  /** Resource-based policies only: { AWS: user ARN | role ARN | role session ARN }. */
  Principal?: { AWS: StrOrList };
  Condition?: Record<string, Record<string, StrOrList | boolean>>;
}

export interface PolicyDoc {
  Version?: string;
  Statement: Statement | Statement[];
}

export type PolicyKind = 'identity' | 'boundary' | 'resource' | 'scp';

export interface NamedPolicy {
  name: string;
  kind: PolicyKind;
  doc: PolicyDoc;
  /** SCPs: where it is attached (root, an OU, the account). Every level needs an Allow. */
  level?: string;
}

export interface IamRequest {
  /**
   * The caller's ARN: an IAM user (arn:aws:iam::111122223333:user/aina)
   * or a role session (arn:aws:sts::111122223333:assumed-role/deployer/ci-run).
   */
  principal: string;
  action: string;
  resource: string;
  /** Request context keys present in this request (absent keys are simply missing). */
  context?: Record<string, string>;
}

// --- Wildcards ---------------------------------------------------------------------------

const globCache = new Map<string, RegExp>();
/** `*` = any characters (also none), `?` = exactly one character. */
export function glob(pattern: string, value: string, ignoreCase = false): boolean {
  const key = `${ignoreCase ? 'i' : 's'}${pattern}`;
  let re = globCache.get(key);
  if (!re) {
    const body = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
    re = new RegExp(`^${body}$`, ignoreCase ? 'is' : 's');
    globCache.set(key, re);
  }
  return re.test(value);
}

/** "The prefix and the action name are case insensitive." Wildcards may sit anywhere in the name. */
export function actionMatches(pattern: string, action: string): boolean {
  return glob(pattern, action, true);
}

/** Split an ARN into its six colon-delimited parts; the sixth keeps any further colons. */
export function splitArn(arn: string): string[] {
  const parts = arn.split(':');
  return parts.length <= 6 ? parts : [...parts.slice(0, 5), parts.slice(5).join(':')];
}

/**
 * Match an ARN pattern (Resource, ArnLike): each part is matched on its own, case-sensitively.
 * `*` can stretch over `/` inside a part; "If the * wildcard is the last character of a resource ARN
 * segment, it can expand to match beyond the colon boundaries."
 */
export function arnMatches(pattern: string, arn: string): boolean {
  if (pattern === '*') return true;
  const p = splitArn(pattern);
  const a = splitArn(arn);
  if (p.length < 6) {
    const last = p.length - 1;
    if (!p[last]!.endsWith('*')) return false;
    for (let i = 0; i < last; i++) if (!glob(p[i]!, a[i] ?? '')) return false;
    return glob(p[last]!, a.slice(last).join(':'));
  }
  if (a.length < 6) return false;
  return p.every((part, i) => glob(part, a[i]!));
}

// --- Principals --------------------------------------------------------------------------

export interface Caller {
  kind: 'user' | 'roleSession';
  arn: string;
  account: string;
  /** For a role session: the role's ARN (what aws:PrincipalArn holds). */
  roleArn?: string;
  name: string;
}

/** Principal ARNs this evaluator understands (IAM user, IAM role, role session). */
const USER_ARN = /^arn:aws:iam::(\d{12}):user\/(?:[\w+=,.@-]+\/)*([\w+=,.@-]+)$/;
const ROLE_ARN = /^arn:aws:iam::\d{12}:role\/[\w+=,.@-]+$/;
const SESSION_ARN = /^arn:aws:sts::(\d{12}):assumed-role\/([\w+=,.@-]+)\/([\w+=,.@-]+)$/;

export function parseCaller(arn: string): Caller | null {
  let m = USER_ARN.exec(arn);
  if (m) return { kind: 'user', arn, account: m[1]!, name: m[2]! };
  m = SESSION_ARN.exec(arn);
  if (m) return { kind: 'roleSession', arn, account: m[1]!, roleArn: `arn:aws:iam::${m[1]}:role/${m[2]}`, name: m[2]! };
  return null;
}

/** How a resource-based policy's Principal names the caller (denyallow doc, "Resource-based policies"). */
export type PrincipalHit = 'user' | 'session' | 'role' | null;

function principalHit(st: Statement, caller: Caller): PrincipalHit {
  const list = toList(st.Principal?.AWS);
  if (caller.kind === 'user' && list.includes(caller.arn)) return 'user';
  if (caller.kind === 'roleSession' && list.includes(caller.arn)) return 'session';
  if (caller.kind === 'roleSession' && caller.roleArn && list.includes(caller.roleArn)) return 'role';
  return null;
}

// --- Conditions --------------------------------------------------------------------------

const STRING_OPS = ['StringEquals', 'StringNotEquals', 'StringEqualsIgnoreCase', 'StringNotEqualsIgnoreCase', 'StringLike', 'StringNotLike'];
const ARN_OPS = ['ArnEquals', 'ArnLike', 'ArnNotEquals', 'ArnNotLike'];
const IP_OPS = ['IpAddress', 'NotIpAddress'];
const BASE_OPS = [...STRING_OPS, ...ARN_OPS, ...IP_OPS, 'Bool'];
/** Negated operators: a missing key makes them true, and several values work like NOR. */
const NEGATED = new Set(['StringNotEquals', 'StringNotEqualsIgnoreCase', 'StringNotLike', 'ArnNotEquals', 'ArnNotLike', 'NotIpAddress']);

export function isSupportedOperator(op: string): boolean {
  if (op === 'Null') return true;
  const base = op.endsWith('IfExists') ? op.slice(0, -'IfExists'.length) : op;
  return BASE_OPS.includes(base);
}

/** Why one key of a condition came out true or false (for the "why" trace). */
export interface KeyResult {
  operator: string;
  key: string;
  /** What the policy wants (one or more values). */
  want: string[];
  /** What the request has, or undefined if the key is not in the request. */
  got?: string;
  result: boolean;
  why: 'match' | 'noMatch' | 'missing' | 'missingIfExists' | 'missingNegated' | 'null';
}

function lookup(context: Record<string, string> | undefined, key: string): string | undefined {
  // "Context key names are not case-sensitive."
  if (!context) return undefined;
  const k = Object.keys(context).find((c) => c.toLowerCase() === key.toLowerCase());
  return k === undefined ? undefined : context[k];
}

function valueMatches(base: string, want: string, got: string): boolean {
  switch (base) {
    case 'StringEquals':
    case 'StringNotEquals':
      return want === got;
    case 'StringEqualsIgnoreCase':
    case 'StringNotEqualsIgnoreCase':
      return want.toLowerCase() === got.toLowerCase();
    case 'StringLike':
    case 'StringNotLike':
      return glob(want, got);
    case 'ArnEquals':
    case 'ArnLike':
    case 'ArnNotEquals':
    case 'ArnNotLike':
      // "ArnEquals and ArnLike … behave identically."
      return arnMatches(want, got);
    case 'IpAddress':
    case 'NotIpAddress': {
      // "If you specify an IP address without the associated routing prefix, IAM uses … /32."
      const range = parseIpOrCidr(want);
      const ip = ipToNumber(got);
      return range !== null && ip !== null && containsIp(range, ip);
    }
    case 'Bool':
      return want.toLowerCase() === got.toLowerCase();
    default:
      return false;
  }
}

export function evalConditionKey(
  operator: string,
  key: string,
  values: StrOrList | boolean,
  context: Record<string, string> | undefined,
): KeyResult {
  const want = (Array.isArray(values) ? values : [values]).map((v) => String(v));
  const got = lookup(context, key);
  if (operator === 'Null') {
    // "true (the key doesn't exist — it is null) or false (the key exists and its value is not null)".
    const absent = got === undefined || got === '';
    const result = want.some((w) => (w.toLowerCase() === 'true') === absent);
    return { operator, key, want, got, result, why: 'null' };
  }
  const ifExists = operator.endsWith('IfExists');
  const base = ifExists ? operator.slice(0, -'IfExists'.length) : operator;
  const negated = NEGATED.has(base);
  if (got === undefined) {
    // "If the key … is not present in the request context, the values do not match and the condition is
    // false. If the policy condition requires that the key is not matched … the condition is true."
    if (ifExists) return { operator, key, want, result: true, why: 'missingIfExists' };
    return { operator, key, want, result: negated, why: negated ? 'missingNegated' : 'missing' };
  }
  const anyHit = want.some((w) => valueMatches(base, w, got));
  // Several values: OR; for a negated operator: NOR ("true only if all values evaluate to false").
  const result = negated ? !anyHit : anyHit;
  return { operator, key, want, got, result, why: result ? 'match' : 'noMatch' };
}

/** All operators AND, all keys under one operator AND (multiple-keys doc). */
export function evalCondition(cond: Statement['Condition'], context: Record<string, string> | undefined): KeyResult[] {
  const out: KeyResult[] = [];
  for (const [op, keys] of Object.entries(cond ?? {})) {
    for (const [key, values] of Object.entries(keys)) out.push(evalConditionKey(op, key, values, context));
  }
  return out;
}

// --- Statements --------------------------------------------------------------------------

export function toList(v: StrOrList | undefined): string[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

export function statementsOf(doc: PolicyDoc): Statement[] {
  return Array.isArray(doc.Statement) ? doc.Statement : [doc.Statement];
}

export interface StatementMatch {
  policy: number;
  statement: number;
  sid?: string;
  effect: Effect;
  action: boolean;
  resource: boolean;
  /** Resource-based policies: how the Principal names the caller (null = not named). */
  principal: PrincipalHit | 'n/a';
  conditions: KeyResult[];
  /** Everything matched: this statement applies to the request. */
  applies: boolean;
}

export function matchStatement(st: Statement, req: IamRequest, kind: PolicyKind, caller: Caller | null): Omit<StatementMatch, 'policy' | 'statement'> {
  // NotAction "explicitly matches everything except the specified list of actions".
  const action = st.NotAction !== undefined
    ? !toList(st.NotAction).some((a) => actionMatches(a, req.action))
    : toList(st.Action).some((a) => actionMatches(a, req.action));
  // NotResource "explicitly matches every resource except those specified".
  const resource = st.NotResource !== undefined
    ? !toList(st.NotResource).some((r) => arnMatches(r, req.resource))
    : toList(st.Resource).some((r) => arnMatches(r, req.resource));
  const principal: PrincipalHit | 'n/a' = kind === 'resource' ? (caller ? principalHit(st, caller) : null) : 'n/a';
  const conditions = evalCondition(st.Condition, req.context);
  const applies = action && resource && principal !== null && conditions.every((c) => c.result);
  return { sid: st.Sid, effect: st.Effect, action, resource, principal, conditions, applies };
}

// --- Validation (only what the evaluator models) ------------------------------------------

export type PolicyIssue =
  | { code: 'notObject' | 'noStatement' }
  | { code: 'effect'; statement: number }
  | { code: 'needAction' | 'bothAction' | 'needResource' | 'bothResource'; statement: number }
  | { code: 'actionFormat'; statement: number; value: string }
  | { code: 'serviceWildcard'; statement: number; value: string }
  | { code: 'arnFormat'; statement: number; value: string }
  | { code: 'principalNeeded' | 'principalNotAllowed'; statement: number }
  | { code: 'principalType'; statement: number; value: string }
  | { code: 'operator'; statement: number; value: string }
  | { code: 'variable'; statement: number }
  | { code: 'unknownKey'; statement: number; value: string }
  | { code: 'ipv6'; statement: number; value: string };

const STATEMENT_KEYS = new Set(['Sid', 'Effect', 'Action', 'NotAction', 'Resource', 'NotResource', 'Principal', 'Condition']);

function checkArn(value: string): 'ok' | 'format' | 'service' {
  if (value === '*') return 'ok';
  const p = splitArn(value);
  if (p[0] !== 'arn' || p.length < 3) return 'format';
  if (/[*?]/.test(p[2]!)) return 'service';
  return 'ok';
}

/** Check that a policy uses only what this evaluator models (so the game never guesses). */
export function validatePolicy(doc: unknown, kind: PolicyKind): PolicyIssue[] {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return [{ code: 'notObject' }];
  const d = doc as PolicyDoc;
  if (d.Statement === undefined) return [{ code: 'noStatement' }];
  const issues: PolicyIssue[] = [];
  statementsOf(d).forEach((st, i) => {
    if (!st || typeof st !== 'object') {
      issues.push({ code: 'notObject' });
      return;
    }
    for (const k of Object.keys(st)) if (!STATEMENT_KEYS.has(k)) issues.push({ code: 'unknownKey', statement: i, value: k });
    if (st.Effect !== 'Allow' && st.Effect !== 'Deny') issues.push({ code: 'effect', statement: i });
    // "Statements must include either an Action or NotAction element" (same for Resource / NotResource).
    if (st.Action === undefined && st.NotAction === undefined) issues.push({ code: 'needAction', statement: i });
    if (st.Action !== undefined && st.NotAction !== undefined) issues.push({ code: 'bothAction', statement: i });
    if (st.Resource === undefined && st.NotResource === undefined) issues.push({ code: 'needResource', statement: i });
    if (st.Resource !== undefined && st.NotResource !== undefined) issues.push({ code: 'bothResource', statement: i });
    for (const a of [...toList(st.Action), ...toList(st.NotAction)]) {
      if (typeof a !== 'string' || !(a === '*' || /^[a-z0-9-*?]+:[A-Za-z0-9*?]+$/i.test(a)))
        issues.push({ code: 'actionFormat', statement: i, value: String(a) });
    }
    for (const r of [...toList(st.Resource), ...toList(st.NotResource)]) {
      const c = typeof r === 'string' ? checkArn(r) : 'format';
      if (c === 'format') issues.push({ code: 'arnFormat', statement: i, value: String(r) });
      if (c === 'service') issues.push({ code: 'serviceWildcard', statement: i, value: r });
    }
    if (kind === 'resource') {
      if (!st.Principal) issues.push({ code: 'principalNeeded', statement: i });
      else {
        const keys = Object.keys(st.Principal);
        if (typeof st.Principal !== 'object' || keys.length !== 1 || keys[0] !== 'AWS')
          issues.push({ code: 'principalType', statement: i, value: JSON.stringify(st.Principal) });
        else
          for (const p of toList(st.Principal.AWS))
            if (typeof p !== 'string' || !(USER_ARN.test(p) || ROLE_ARN.test(p) || SESSION_ARN.test(p)))
              issues.push({ code: 'principalType', statement: i, value: String(p) });
      }
    } else if (st.Principal !== undefined) issues.push({ code: 'principalNotAllowed', statement: i });
    for (const [op, keys] of Object.entries(st.Condition ?? {})) {
      if (!isSupportedOperator(op)) issues.push({ code: 'operator', statement: i, value: op });
      for (const vals of Object.values(keys ?? {})) {
        for (const v of Array.isArray(vals) ? vals : [vals]) {
          if (typeof v === 'string' && /^(Ip|NotIp)Address/.test(op) && v.includes(':')) issues.push({ code: 'ipv6', statement: i, value: v });
        }
      }
    }
    if (JSON.stringify(st).includes('${')) issues.push({ code: 'variable', statement: i });
  });
  return issues;
}

export interface ParsedPolicy {
  ok: boolean;
  doc?: PolicyDoc;
  /** JSON.parse's own message when the text is not JSON. */
  jsonError?: string;
  issues: PolicyIssue[];
}

export function parsePolicy(text: string, kind: PolicyKind): ParsedPolicy {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch (e) {
    return { ok: false, jsonError: (e as Error).message, issues: [] };
  }
  const issues = validatePolicy(doc, kind);
  return { ok: issues.length === 0, doc: issues.length ? undefined : (doc as PolicyDoc), issues };
}

// --- Evaluation --------------------------------------------------------------------------

export type StepId = 'deny' | 'scp' | 'resource' | 'identity' | 'boundary';

export interface Step {
  id: StepId;
  /**
   * stopDeny: the decision is Deny here. stopAllow: the decision is Allow here.
   * pass: this check is fine, go on. skip: nothing to check here (no such policy, or not needed).
   */
  outcome: 'stopDeny' | 'stopAllow' | 'pass' | 'skip';
  /** A short code for the reason, turned into words by the UI (i18n aws.iam.why.*). */
  reason: string;
  /** Statements that decided this step (for highlighting). */
  hits: StatementMatch[];
  /** SCP level that had no Allow. */
  level?: string;
}

export interface Evaluation {
  decision: Effect;
  /** Deny kind: explicit (a Deny statement) or implicit (no Allow). Null when allowed. */
  denyKind: 'explicit' | 'implicit' | null;
  decidedBy: StepId | 'end';
  steps: Step[];
  /** Every statement of every policy with its match details. */
  matches: StatementMatch[];
}

export function evaluate(req: IamRequest, policies: NamedPolicy[]): Evaluation {
  const caller = parseCaller(req.principal);
  const matches: StatementMatch[] = [];
  policies.forEach((p, pi) =>
    statementsOf(p.doc).forEach((st, si) => matches.push({ policy: pi, statement: si, ...matchStatement(st, req, p.kind, caller) })),
  );
  const of = (kind: PolicyKind) => matches.filter((m) => policies[m.policy]!.kind === kind);
  const allows = (list: StatementMatch[]) => list.filter((m) => m.applies && m.effect === 'Allow');
  const steps: Step[] = [];
  const done = (decision: Effect, denyKind: Evaluation['denyKind'], decidedBy: Evaluation['decidedBy']): Evaluation => ({
    decision,
    denyKind,
    decidedBy,
    steps,
    matches,
  });

  // 1. "If the enforcement code finds even one explicit deny that applies, … Deny."
  const denies = matches.filter((m) => m.applies && m.effect === 'Deny');
  if (denies.length) {
    steps.push({ id: 'deny', outcome: 'stopDeny', reason: 'explicitDeny', hits: denies });
    return done('Deny', 'explicit', 'deny');
  }
  steps.push({ id: 'deny', outcome: 'pass', reason: 'noDeny', hits: [] });

  // 2. SCPs: "there must be an explicit Allow statement at every level from the root … to the account".
  const scps = policies.map((p, i) => ({ p, i })).filter(({ p }) => p.kind === 'scp');
  if (!scps.length) steps.push({ id: 'scp', outcome: 'skip', reason: 'noScp', hits: [] });
  else {
    const levels = [...new Set(scps.map(({ p }) => p.level ?? 'account'))];
    const hits: StatementMatch[] = [];
    for (const level of levels) {
      const here = new Set(scps.filter(({ p }) => (p.level ?? 'account') === level).map(({ i }) => i));
      const ok = allows(matches.filter((m) => here.has(m.policy)));
      if (!ok.length) {
        steps.push({ id: 'scp', outcome: 'stopDeny', reason: 'scpNoAllow', hits: [], level });
        return done('Deny', 'implicit', 'scp');
      }
      hits.push(...ok);
    }
    steps.push({ id: 'scp', outcome: 'pass', reason: 'scpAllows', hits });
  }

  // 3. Resource-based policy (same account).
  const resAllows = allows(of('resource'));
  let roleArnAllow = false;
  if (!policies.some((p) => p.kind === 'resource')) steps.push({ id: 'resource', outcome: 'skip', reason: 'noResourcePolicy', hits: [] });
  else if (!resAllows.length) steps.push({ id: 'resource', outcome: 'pass', reason: 'resourceNoAllow', hits: [] });
  else {
    const direct = resAllows.filter((m) => m.principal === 'user' || m.principal === 'session');
    if (direct.length) {
      // "If a resource-based policy grants permission directly to the IAM user or the session principal …
      // an implicit deny in an identity-based policy, a permissions boundary, or a session policy does not
      // impact the final decision."
      steps.push({ id: 'resource', outcome: 'stopAllow', reason: direct[0]!.principal === 'user' ? 'resourceAllowsUser' : 'resourceAllowsSession', hits: direct });
      return done('Allow', null, 'resource');
    }
    // "Resource-based policies that grant permissions to an IAM role ARN are limited by an implicit deny in
    // a permissions boundary or session policy."
    roleArnAllow = true;
    steps.push({ id: 'resource', outcome: 'pass', reason: 'resourceAllowsRole', hits: resAllows });
  }

  // 4. Identity-based policies.
  const idAllows = allows(of('identity'));
  if (roleArnAllow) steps.push({ id: 'identity', outcome: 'skip', reason: 'identityNotNeeded', hits: idAllows });
  else if (!idAllows.length) {
    steps.push({ id: 'identity', outcome: 'stopDeny', reason: of('identity').length ? 'identityNoAllow' : 'noIdentityPolicy', hits: [] });
    return done('Deny', 'implicit', 'identity');
  } else steps.push({ id: 'identity', outcome: 'pass', reason: 'identityAllows', hits: idAllows });

  // 5. Permissions boundary: "If the policy that is used to set the permissions boundary does not allow the
  // requested action, then the request is implicitly denied."
  if (!policies.some((p) => p.kind === 'boundary')) steps.push({ id: 'boundary', outcome: 'skip', reason: 'noBoundary', hits: [] });
  else {
    const bAllows = allows(of('boundary'));
    if (!bAllows.length) {
      steps.push({ id: 'boundary', outcome: 'stopDeny', reason: 'boundaryNoAllow', hits: [] });
      return done('Deny', 'implicit', 'boundary');
    }
    steps.push({ id: 'boundary', outcome: 'pass', reason: 'boundaryAllows', hits: bAllows });
  }

  // 6. No session policy here: "If the principal is not a session principal … Allow"; a role session without
  // a session policy gets the default one, also Allow.
  return done('Allow', null, 'end');
}

// --- Formatting (≤ ~15 lines per policy on a card) ---------------------------------------

const INLINE_MAX = 68;
/** A policy on a card stays short (rule: code ≤ ~15 lines); `check:mdx` stops at this many lines. */
export const MAX_POLICY_LINES = 16;

function inline(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(inline).join(', ')}]`;
  if (v && typeof v === 'object')
    return `{ ${Object.entries(v as Record<string, unknown>).map(([k, x]) => `${JSON.stringify(k)}: ${inline(x)}`).join(', ')} }`;
  return JSON.stringify(v);
}

export interface FormattedPolicy {
  lines: string[];
  /** 1-based [first, last] line of each statement. */
  statementLines: [number, number][];
}

/**
 * Pretty-print a policy the way a card shows it: one key per line, short lists and condition blocks on
 * one line. The output is valid JSON (the edit game parses it back).
 */
export function formatPolicy(doc: PolicyDoc): FormattedPolicy {
  const lines: string[] = [];
  const statementLines: [number, number][] = [];
  const pad = (n: number) => '  '.repeat(n);
  const value = (key: string, v: unknown, depth: number, last: boolean) => {
    const head = `${pad(depth)}${JSON.stringify(key)}: `;
    const one = `${head}${inline(v)}${last ? '' : ','}`;
    if (one.length <= INLINE_MAX || (typeof v !== 'object' || v === null)) {
      lines.push(one);
      return;
    }
    if (Array.isArray(v)) {
      lines.push(`${head}[`);
      v.forEach((x, i) => lines.push(`${pad(depth + 1)}${inline(x)}${i < v.length - 1 ? ',' : ''}`));
      lines.push(`${pad(depth)}]${last ? '' : ','}`);
      return;
    }
    lines.push(`${head}{`);
    const entries = Object.entries(v as Record<string, unknown>);
    entries.forEach(([k, x], i) => value(k, x, depth + 1, i === entries.length - 1));
    lines.push(`${pad(depth)}}${last ? '' : ','}`);
  };
  lines.push('{');
  const top = Object.entries(doc).filter(([k]) => k !== 'Statement');
  for (const [k, v] of top) value(k, v, 1, false);
  const sts = statementsOf(doc);
  lines.push(`${pad(1)}"Statement": [`);
  sts.forEach((st, i) => {
    const start = lines.length + 1;
    lines.push(`${pad(2)}{`);
    const entries = Object.entries(st);
    entries.forEach(([k, v], j) => value(k, v, 3, j === entries.length - 1));
    lines.push(`${pad(2)}}${i < sts.length - 1 ? ',' : ''}`);
    statementLines.push([start, lines.length]);
  });
  lines.push(`${pad(1)}]`);
  lines.push('}');
  return { lines, statementLines };
}

/** Replace one line (1-based) of a formatted policy and parse the result. */
export function editLine(lines: string[], line: number, text: string, kind: PolicyKind): ParsedPolicy {
  const indent = /^\s*/.exec(lines[line - 1] ?? '')![0];
  const next = lines.map((l, i) => (i === line - 1 ? `${indent}${text.trim()}` : l));
  return parsePolicy(next.join('\n'), kind);
}
