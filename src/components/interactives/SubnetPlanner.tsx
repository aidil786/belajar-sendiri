// Subnet Planner (Level Up · AWS, A3 "The Mall's Roads"): the VPC is the mall's land; each row of units
// (a subnet) needs its own block of addresses, in each wing (Availability Zone). Pick a size (it lands on
// the first free spot) or type a CIDR. Live checks: inside the VPC, /16–/28, no overlaps, enough usable
// addresses after the five AWS keeps. Logic: src/lib/aws/cidr.ts (Amazon VPC User Guide rules).
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Lang } from '~/i18n';
import {
  blockSize,
  checkPlan,
  checkVpcCidr,
  firstFreeBlock,
  lastAddress,
  MAX_PREFIX,
  MIN_PREFIX,
  numberToIp,
  parseCidr,
  reservedAddresses,
  usableAddresses,
  type SubnetIssue,
  type VpcIssue,
} from '~/lib/aws/cidr';
import { AwsIcon, Mark } from './awsShared';
import { Announce, Feedback, cx, pickPraise, useCardEvents, useLearnerName, useT, type T } from './shared';
import './aws-games.css';

export type SubnetTier = 'public' | 'private';

export interface SubnetPlannerProps {
  lang: Lang;
  /** The VPC's CIDR block, e.g. 10.0.0.0/16. */
  vpc: string;
  /** Availability Zones (wings), default the Malaysia Region's first two. */
  azs?: string[];
  /** Rows to plan, default both. */
  tiers?: SubnetTier[];
  /** Usable addresses each subnet of a tier needs, e.g. { public: 20, private: 200 }. */
  need?: Partial<Record<SubnetTier, number>>;
  /** Subnets already there: { tier, az, cidr }. */
  start?: { tier: SubnetTier; az: string; cidr: string }[];
  /** Let the learner change the VPC block too. */
  editVpc?: boolean;
  prompt?: string;
  success?: string;
}

export const cellId = (tier: SubnetTier, az: string) => `${tier}:${az}`;

function subnetIssueText(t: T, issue: SubnetIssue, cellName: (id: string) => string): string {
  switch (issue.code) {
    case 'tooBig':
    case 'tooSmall':
      return t(`aws.subnet.err.${issue.code}`, { prefix: issue.prefix });
    case 'outside':
      return t('aws.subnet.err.outside', { vpc: issue.vpc });
    case 'overlap':
      return t('aws.subnet.err.overlap', { other: cellName(issue.other) });
    case 'tooFewIps':
      return t('aws.subnet.err.tooFewIps', { usable: issue.usable, need: issue.need });
    case 'canonical':
      return t('aws.subnet.note.canonical', { canonical: issue.canonical });
    default:
      return t(`aws.subnet.err.${issue.code}`);
  }
}

function vpcIssueText(t: T, issue: VpcIssue): string {
  switch (issue.code) {
    case 'tooBig':
    case 'tooSmall':
      return t(`aws.subnet.vpcErr.${issue.code}`, { prefix: issue.prefix });
    case 'forbidden':
    case 'avoid172':
      return t(`aws.subnet.vpcErr.${issue.code}`, { range: issue.range });
    case 'canonical':
      return t('aws.subnet.note.canonical', { canonical: issue.canonical });
    case 'publicRange':
      return t('aws.subnet.vpcErr.publicRange');
    default:
      return t(`aws.subnet.err.${issue.code}`);
  }
}

export default function SubnetPlanner({
  lang,
  vpc: startVpc,
  azs = ['ap-southeast-5a', 'ap-southeast-5b'],
  tiers = ['public', 'private'],
  need = {},
  start = [],
  editVpc = false,
  prompt,
  success,
}: SubnetPlannerProps) {
  const t = useT(lang);
  const learner = useLearnerName();
  const { ref, emit } = useCardEvents();
  const id = useId();
  const tries = useRef(0);
  const nf = useMemo(() => new Intl.NumberFormat(lang === 'ms' ? 'ms-MY' : 'en-US'), [lang]);
  const cells = useMemo(() => tiers.flatMap((tier) => azs.map((az) => ({ id: cellId(tier, az), tier, az }))), [tiers, azs]);
  const [vpc, setVpc] = useState(startVpc);
  const [plan, setPlan] = useState<Record<string, string>>(() =>
    Object.fromEntries(cells.map((c) => [c.id, start.find((s) => s.tier === c.tier && s.az === c.az)?.cidr ?? ''])),
  );
  const [msg, setMsg] = useState<{ kind: 'right' | 'almost'; text: string } | null>(null);
  const [done, setDone] = useState(false);
  const [announce, setAnnounce] = useState('');

  const vpcCheck = checkVpcCidr(vpc);
  const filled = cells.filter((c) => plan[c.id]!.trim() !== '');
  const checks = checkPlan(
    vpc,
    filled.map((c) => ({ id: c.id, cidr: plan[c.id]!, need: need[c.tier] })),
  );
  const checkOf = (cid: string) => checks.find((c) => c.id === cid);
  const cellName = (cid: string) => {
    const c = cells.find((x) => x.id === cid)!;
    return t('aws.subnet.cellLabel', { tier: t(`aws.subnet.tierShort.${c.tier}`), az: c.az });
  };
  const complete = vpcCheck.ok && filled.length === cells.length && checks.every((c) => c.ok);

  // Done as soon as the plan meets the brief (the live checks already show why, line by line).
  useEffect(() => {
    if (complete && !done) {
      setDone(true);
      setMsg({ kind: 'right', text: success ?? `${pickPraise(t, learner, tries.current)} ${t('aws.subnet.done')}` });
      setAnnounce(t('aws.subnet.done'));
      emit('fl:done', { tries: tries.current });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [complete]);

  const setCell = (cid: string, cidr: string) => {
    if (done) return;
    setPlan((p) => ({ ...p, [cid]: cidr }));
    if (msg?.kind === 'almost') setMsg(null);
  };

  const pickSize = (cid: string, prefix: number) => {
    if (done) return;
    tries.current++;
    const others = Object.entries(plan)
      .filter(([k, v]) => k !== cid && v.trim() !== '')
      .map(([, v]) => v);
    const spot = firstFreeBlock(vpc, prefix, others);
    if (!spot) {
      setMsg({ kind: 'almost', text: t('aws.subnet.noRoom', { prefix }) });
      emit('fl:wrong');
      return;
    }
    setCell(cid, spot);
    setAnnounce(t('aws.subnet.placed', { cell: cellName(cid), cidr: spot }));
  };

  const checkNow = () => {
    if (done) return;
    tries.current++;
    if (!vpcCheck.ok) {
      setMsg({ kind: 'almost', text: vpcIssueText(t, vpcCheck.errors[0]!) });
    } else {
      const missing = cells.find((c) => plan[c.id]!.trim() === '');
      const bad = checks.find((c) => !c.ok);
      if (missing) setMsg({ kind: 'almost', text: t('aws.subnet.missing', { cell: cellName(missing.id) }) });
      else if (bad) setMsg({ kind: 'almost', text: t('aws.subnet.notYet', { cell: cellName(bad.id), problem: subnetIssueText(t, bad.errors[0]!, cellName) }) });
    }
    emit('fl:wrong');
  };

  // The address map: the smallest aligned window that holds every subnet (at least a /24), so small
  // subnets in a big VPC stay visible. Positions are in addresses, drawn as percentages.
  const vpcCidr = vpcCheck.cidr;
  const valid = checks.filter((c) => c.cidr && vpcCidr && c.cidr.base >= vpcCidr.base && lastAddress(c.cidr) <= lastAddress(vpcCidr));
  let win = vpcCidr ? { base: vpcCidr.base, size: blockSize(vpcCidr.prefix) } : null;
  if (vpcCidr && win) {
    const top = Math.max(vpcCidr.base + 255, ...valid.map((c) => lastAddress(c.cidr!)));
    let size = 256;
    while (vpcCidr.base + size - 1 < top && size < win.size) size *= 2;
    win = { base: vpcCidr.base, size: Math.min(size, win.size) };
  }
  const firstValid = valid.find((c) => c.ok) ?? valid[0];

  return (
    <div className="awg awg-subnets" ref={ref}>
      <p className="interactive-help">{prompt ?? t('aws.subnet.help')}</p>

      <section className="awg-vpc" aria-labelledby={`${id}-vpc`}>
        <h3 className="awg-head" id={`${id}-vpc`}>
          <AwsIcon name="mall" />
          {t('aws.subnet.vpc')}
        </h3>
        {editVpc && !done ? (
          <div className="awg-field">
            <label htmlFor={`${id}-vpcin`}>{t('aws.subnet.vpcInput')}</label>
            <input
              id={`${id}-vpcin`}
              className="awg-input awg-mono"
              value={vpc}
              onChange={(e) => setVpc(e.target.value)}
              spellCheck={false}
              autoCapitalize="off"
              autoComplete="off"
            />
          </div>
        ) : (
          <p className="awg-vpc-cidr">
            <code>{vpc}</code>
          </p>
        )}
        {vpcCheck.cidr && vpcCheck.ok && (
          <p className="awg-note">{t('aws.subnet.vpcSize', { count: nf.format(blockSize(vpcCheck.cidr.prefix)) })}</p>
        )}
        {vpcCheck.errors.map((e, i) => (
          <Mark key={`e${i}`} ok={false} label={vpcIssueText(t, e)} />
        ))}
        {vpcCheck.notes.map((n, i) => (
          <p key={`n${i}`} className="awg-note">
            {vpcIssueText(t, n)}
          </p>
        ))}
      </section>

      <section className="awg-brief" aria-labelledby={`${id}-brief`}>
        <h3 className="awg-head" id={`${id}-brief`}>
          <AwsIcon name="sign" />
          {t('aws.subnet.brief')}
        </h3>
        <ul className="awg-brief-list">
          {tiers.map((tier) => (
            <li key={tier}>
              {need[tier] !== undefined
                ? t('aws.subnet.briefNeed', { tier: t(`aws.subnet.tier.${tier}`), n: azs.length, need: need[tier]! })
                : t('aws.subnet.briefAny', { tier: t(`aws.subnet.tier.${tier}`), n: azs.length })}
            </li>
          ))}
        </ul>
      </section>

      {win && vpcCidr && (
        <figure className="awg-map" aria-labelledby={`${id}-map`}>
          <figcaption id={`${id}-map`} className="awg-head">
            <AwsIcon name="road" />
            {t('aws.subnet.map', { from: numberToIp(win.base), to: numberToIp(win.base + win.size - 1) })}
          </figcaption>
          <div className="awg-map-bar">
            {valid.map((c) => {
              const cell = cells.find((x) => x.id === c.id)!;
              const left = ((c.cidr!.base - win.base) / win.size) * 100;
              const width = (blockSize(c.cidr!.prefix) / win.size) * 100;
              if (left >= 100) return null;
              return (
                <span
                  key={c.id}
                  className={cx('awg-map-block', `is-${cell.tier}`, !c.ok && 'is-bad')}
                  style={{ left: `${left}%`, width: `max(6px, ${Math.min(width, 100 - left)}%)` }}
                  title={`${cellName(c.id)} ${c.cidr!.text}`}
                />
              );
            })}
          </div>
          <ul className="awg-map-key">
            {valid.map((c) => (
              <li key={c.id} className={cx(!c.ok && 'is-bad')}>
                <span className={cx('awg-swatch', `is-${cells.find((x) => x.id === c.id)!.tier}`)} aria-hidden="true" />
                {cellName(c.id)} <code>{c.cidr!.text}</code>
                {!c.ok && <AwsIcon name="warn" />}
              </li>
            ))}
          </ul>
        </figure>
      )}

      <div className="awg-cells">
        {cells.map((c) => {
          const chk = checkOf(c.id);
          const cur = parseCidr(plan[c.id]!).cidr;
          return (
            <fieldset key={c.id} className={cx('awg-cell', `is-${c.tier}`, chk && !chk.ok && 'is-bad', chk?.ok && 'is-ok')}>
              <legend>{t('aws.subnet.cellLabel', { tier: t(`aws.subnet.tier.${c.tier}`), az: c.az })}</legend>
              <div className="awg-cell-fields">
                <div className="awg-field">
                  <label htmlFor={`${id}-${c.id}-size`}>{t('aws.subnet.size')}</label>
                  <select
                    id={`${id}-${c.id}-size`}
                    value={cur && cur.prefix >= MIN_PREFIX && cur.prefix <= MAX_PREFIX ? String(cur.prefix) : ''}
                    onChange={(e) => e.target.value && pickSize(c.id, Number(e.target.value))}
                    disabled={done}
                  >
                    <option value="">{t('aws.subnet.pick')}</option>
                    {Array.from({ length: MAX_PREFIX - MIN_PREFIX + 1 }, (_, i) => MAX_PREFIX - i).map((p) => (
                      <option key={p} value={p}>
                        {t('aws.subnet.sizeOption', { prefix: p, usable: nf.format(usableAddresses(p)) })}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="awg-field">
                  <label htmlFor={`${id}-${c.id}-cidr`}>{t('aws.subnet.cidr')}</label>
                  <input
                    id={`${id}-${c.id}-cidr`}
                    className="awg-input awg-mono"
                    value={plan[c.id]}
                    placeholder="10.0.1.0/24"
                    onChange={(e) => setCell(c.id, e.target.value)}
                    spellCheck={false}
                    autoCapitalize="off"
                    autoComplete="off"
                    disabled={done}
                  />
                </div>
              </div>
              {need[c.tier] !== undefined && <p className="awg-note">{t('aws.subnet.needs', { need: need[c.tier]! })}</p>}
              {!chk && <p className="awg-note">{t('aws.subnet.empty')}</p>}
              {chk?.ok && <Mark ok label={t('aws.subnet.ok', { size: nf.format(chk.size), usable: nf.format(chk.usable) })} />}
              {chk?.errors.map((e, i) => <Mark key={i} ok={false} label={subnetIssueText(t, e, cellName)} />)}
              {chk?.notes.map((n, i) => (
                <p key={`n${i}`} className="awg-note">
                  {subnetIssueText(t, n, cellName)}
                </p>
              ))}
            </fieldset>
          );
        })}
      </div>

      {firstValid?.cidr && (
        <details className="awg-peek">
          <summary>{t('aws.subnet.reserved', { cidr: firstValid.cidr.text })}</summary>
          <ul>
            {reservedAddresses(firstValid.cidr).map((r) => (
              <li key={r.ip}>
                <code>{r.ip}</code> {t(`aws.subnet.role.${r.role}`)}
              </li>
            ))}
          </ul>
        </details>
      )}

      {!done && (
        <div className="awg-row">
          <button type="button" className="btn scene-btn" onClick={checkNow}>
            {t('aws.subnet.check')}
          </button>
        </div>
      )}

      {msg && <Feedback kind={msg.kind}>{msg.kind === 'almost' ? `${t('feedback.almost')} ${msg.text}` : msg.text}</Feedback>}
      <Announce text={announce} />
    </div>
  );
}
