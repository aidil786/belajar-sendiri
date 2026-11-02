// Security Group Gate (Level Up · AWS, A3): visitors walk to a shop unit. First the row's gate guard
// (network ACL: numbered list, lowest first, allow or deny, remembers nothing), then the unit's door guard
// (security group: allow rules only, remembers who came in). The learner adds and removes rules until the
// right visitors get in and their replies get back out. Logic: src/lib/aws/gates.ts (Amazon VPC docs).
import { useId, useMemo, useRef, useState } from 'react';
import type { Lang } from '~/i18n';
import {
  checkNaclRule,
  checkSgRule,
  DEFAULT_NACL,
  EPHEMERAL,
  gateDone,
  NEW_CUSTOM_NACL,
  openToWorld,
  parsePorts,
  sortedRules,
  visit,
  visitOk,
  type Nacl,
  type NaclRule,
  type Proto,
  type SgRule,
  type Visit,
  type Visitor,
} from '~/lib/aws/gates';
import { AwsIcon, Mark } from './awsShared';
import { Announce, Feedback, cx, pickPraise, useCardEvents, useLearnerName, useMotionOK, useT, type T } from './shared';
import './aws-games.css';

export interface SecurityGroupGateProps {
  lang: Lang;
  visitors: Visitor[];
  /** Whose rules the learner changes. Default 'sg'. */
  edit?: 'sg' | 'nacl' | 'both';
  /** Inbound security group rules at the start (default none: a new group lets nothing in). */
  sg?: SgRule[];
  /** The subnet's network ACL: 'default' (allows all, the default), 'custom' (a new one: denies all) or rules. */
  nacl?: Nacl | 'default' | 'custom';
  /** Security group ids that exist, for rules that name a group (e.g. ['sg-web']). */
  groups?: string[];
  /** Ports that must not be open to 0.0.0.0/0 in the security group (e.g. [22]). */
  forbidOpen?: number[];
  prompt?: string;
  success?: string;
}

const PROTOS: Proto[] = ['tcp', 'udp', 'all'];

export function rulePorts(t: T, protocol: Proto, ports?: string): string {
  if (protocol === 'all') return t('aws.gate.all');
  const r = parsePorts(ports);
  if (!r) return ports ?? '';
  const p = r.from === 0 && r.to === 65535 ? t('aws.gate.allPorts') : r.from === r.to ? String(r.from) : `${r.from}–${r.to}`;
  return `${protocol.toUpperCase()} ${p}`;
}

const stopOf: Record<Visit['outcome'], number> = { gateIn: 0.33, door: 0.66, gateOut: 1, replySometimes: 1, in: 1 };

export default function SecurityGroupGate({
  lang,
  visitors,
  edit = 'sg',
  sg: startSg = [],
  nacl: startNacl = 'default',
  groups = [],
  forbidOpen = [],
  prompt,
  success,
}: SecurityGroupGateProps) {
  const t = useT(lang);
  const learner = useLearnerName();
  const motionOK = useMotionOK();
  const { ref, emit } = useCardEvents();
  const id = useId();
  const tries = useRef(0);
  const initialNacl = startNacl === 'default' ? DEFAULT_NACL : startNacl === 'custom' ? NEW_CUSTOM_NACL : startNacl;
  const [sg, setSg] = useState<SgRule[]>(startSg);
  const [nacl, setNacl] = useState<Nacl>(initialNacl);
  const [visits, setVisits] = useState<Visit[] | null>(null);
  const [run, setRun] = useState(0);
  const [msg, setMsg] = useState<{ kind: 'right' | 'almost'; text: string } | null>(null);
  const [done, setDone] = useState(false);
  const [announce, setAnnounce] = useState('');
  // Rule forms
  const [sgForm, setSgForm] = useState<{ protocol: Proto; ports: string; source: string }>({ protocol: 'tcp', ports: '443', source: '0.0.0.0/0' });
  const nextNumber = (rules: NaclRule[]) => (rules.length ? Math.min(32766, Math.max(...rules.map((r) => r.number)) + 10) : 100);
  const [nForm, setNForm] = useState<{ dir: 'inbound' | 'outbound'; number: string; protocol: Proto; ports: string; cidr: string; action: 'allow' | 'deny' }>(() => ({
    dir: 'inbound',
    number: String(nextNumber(initialNacl.inbound)),
    protocol: 'tcp',
    ports: '443',
    cidr: '0.0.0.0/0',
    action: 'allow',
  }));
  const editSg = (edit === 'sg' || edit === 'both') && !done;
  const editNacl = (edit === 'nacl' || edit === 'both') && !done;
  const showNacl = edit !== 'sg' || startNacl !== 'default';
  const setup = useMemo(() => ({ sg, nacl }), [sg, nacl]);

  const changed = () => {
    setVisits(null);
    if (msg) setMsg(null);
  };

  const addSg = () => {
    const rule: SgRule = { protocol: sgForm.protocol, ports: sgForm.protocol === 'all' ? undefined : sgForm.ports.trim(), source: sgForm.source.trim() };
    const bad = checkSgRule(rule, groups);
    if (bad) {
      setMsg({ kind: 'almost', text: t(`aws.gate.badRule.${bad}`) });
      emit('fl:wrong');
      return;
    }
    setSg([...sg, rule]);
    setAnnounce(t('aws.gate.added', { rule: `${rulePorts(t, rule.protocol, rule.ports)} · ${rule.source}` }));
    changed();
  };

  const addNacl = () => {
    const rule: NaclRule = {
      number: Number(nForm.number),
      protocol: nForm.protocol,
      ports: nForm.protocol === 'all' ? undefined : nForm.ports.trim(),
      cidr: nForm.cidr.trim(),
      action: nForm.action,
    };
    const list = nacl[nForm.dir];
    const bad = checkNaclRule(rule, list);
    if (bad) {
      setMsg({ kind: 'almost', text: t(`aws.gate.badRule.${bad}`) });
      emit('fl:wrong');
      return;
    }
    const next = { ...nacl, [nForm.dir]: [...list, rule] };
    setNacl(next);
    setNForm({ ...nForm, number: String(nextNumber(next[nForm.dir])) });
    setAnnounce(t('aws.gate.added', { rule: `${rule.number} · ${rulePorts(t, rule.protocol, rule.ports)} · ${rule.cidr}` }));
    changed();
  };

  const removeNacl = (dir: 'inbound' | 'outbound', r: NaclRule) => {
    setNacl({ ...nacl, [dir]: nacl[dir].filter((x) => x !== r) });
    setAnnounce(t('aws.gate.removed', { rule: String(r.number) }));
    changed();
  };

  const tryNow = () => {
    if (done) return;
    tries.current++;
    const vs = visitors.map((v) => visit(setup, v));
    setVisits(vs);
    setRun((n) => n + 1);
    const open = forbidOpen.find((p) => openToWorld(setup, p));
    if (gateDone(setup, { visitors, forbidOpen })) {
      setDone(true);
      setMsg({ kind: 'right', text: success ?? `${pickPraise(t, learner, tries.current)} ${t('aws.gate.done')}` });
      setAnnounce(t('aws.gate.done'));
      emit('fl:done', { tries: tries.current });
      return;
    }
    const first = vs.find((x) => !visitOk(x));
    const text = first
      ? t('aws.gate.wrong', { label: first.visitor.label, result: resultText(first), want: t(`aws.gate.want.${first.visitor.want}`) })
      : t('aws.gate.forbidOpen', { port: open ?? '' });
    setMsg({ kind: 'almost', text });
    setAnnounce(text);
    emit('fl:wrong');
  };

  const resultText = (x: Visit): string => {
    switch (x.outcome) {
      case 'gateIn':
        return t('aws.gate.result.gateIn', { rule: String(x.gateIn.rule) });
      case 'door':
        return t('aws.gate.result.door');
      case 'gateOut':
        return t('aws.gate.result.gateOut', { rule: String(x.gateOut![0]!.rule) });
      case 'replySometimes': {
        const blocked = x.gateOut!.find((p) => !p.allowed)!;
        return t('aws.gate.result.replySometimes', { from: blocked.from, to: blocked.to });
      }
      default:
        return t('aws.gate.result.in');
    }
  };

  const naclTable = (dir: 'inbound' | 'outbound') => (
    <div className="awg-rules" key={dir} tabIndex={0} role="region" aria-label={`${t('aws.gate.nacl')} · ${t(`aws.gate.${dir}`)}`}>
      <h4 className="awg-subhead">{t(`aws.gate.${dir}`)}</h4>
      <table className="awg-table">
        <thead>
          <tr>
            <th scope="col">{t('aws.gate.colNumber')}</th>
            <th scope="col">{t('aws.gate.colTraffic')}</th>
            <th scope="col">{t(dir === 'inbound' ? 'aws.gate.colSource' : 'aws.gate.colDest')}</th>
            <th scope="col">{t('aws.gate.colAction')}</th>
            {editNacl && (
              <th scope="col">
                <span className="visually-hidden">{t('aws.gate.remove')}</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {sortedRules(nacl[dir]).map((r) => (
            <tr key={`${r.number}`}>
              <td>{r.number}</td>
              <td>{rulePorts(t, r.protocol, r.ports)}</td>
              <td>
                <code>{r.cidr}</code>
              </td>
              <td className={cx('awg-act', `is-${r.action}`)}>{t(`aws.gate.${r.action}`)}</td>
              {editNacl && (
                <td>
                  <button type="button" className="btn btn-quiet awg-x" onClick={() => removeNacl(dir, r)} aria-label={t('aws.gate.removeLabel', { rule: String(r.number) })}>
                    {t('aws.gate.remove')}
                  </button>
                </td>
              )}
            </tr>
          ))}
          <tr className="awg-star">
            <td>*</td>
            <td>{t('aws.gate.all')}</td>
            <td>
              <code>0.0.0.0/0</code>
            </td>
            <td className="awg-act is-deny">{t('aws.gate.deny')}</td>
            {editNacl && <td />}
          </tr>
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="awg awg-gate" ref={ref}>
      <p className="interactive-help">{prompt ?? t(`aws.gate.help.${edit}`)}</p>

      <section aria-labelledby={`${id}-who`}>
        <h3 className="awg-head" id={`${id}-who`}>
          <AwsIcon name="user" />
          {t('aws.gate.visitors')}
        </h3>
        <ul className="awg-visitors">
          {visitors.map((v, i) => {
            const x = visits?.[i];
            return (
              <li key={v.id} className={cx('awg-visitor', x && (visitOk(x) ? 'is-ok' : 'is-bad'))}>
                <span className="awg-visitor-who">
                  <AwsIcon name={v.groups?.length ? 'server' : 'globe'} />
                  <strong>{v.label}</strong>
                  <span className={cx('awg-want', `is-${v.want}`)}>{t(`aws.gate.want.${v.want}`)}</span>
                </span>
                <span className="awg-visitor-line">
                  <code>
                    {v.protocol.toUpperCase()} {v.port}
                  </code>{' '}
                  {v.groups?.length ? t('aws.gate.fromGroup', { ip: v.ip, group: v.groups.join(', ') }) : t('aws.gate.fromIp', { ip: v.ip })}
                </span>
                {x && (
                  <>
                    <div
                      key={run}
                      className={cx('awg-track', motionOK && 'can-move', `is-${x.outcome}`, visitOk(x) ? 'is-good' : 'is-bad')}
                      style={{ ['--stop' as string]: String(stopOf[x.outcome]), ['--i' as string]: String(i) }}
                      aria-hidden="true"
                    >
                      <span className="awg-track-line" />
                      {(['gate', 'door', 'out'] as const).map((at) => {
                        const stopHere =
                          (at === 'gate' && x.outcome === 'gateIn') ||
                          (at === 'door' && x.outcome === 'door') ||
                          (at === 'out' && (x.outcome === 'gateOut' || x.outcome === 'replySometimes'));
                        // Stopped where the task wanted it stopped: a calm stop sign. Stopped by mistake: red + warning.
                        const icon = stopHere ? (visitOk(x) ? 'stop' : 'warn') : at === 'out' && x.outcome === 'in' ? 'ok' : at === 'door' ? 'door' : 'gate';
                        return (
                          <span key={at} className={cx('awg-track-stop', `at-${at}`, stopHere && 'is-stop', at === 'out' && x.outcome === 'in' && 'is-in')}>
                            <AwsIcon name={icon} />
                          </span>
                        );
                      })}
                    </div>
                    <Mark ok={visitOk(x)} label={resultText(x)} />
                    <ul className="awg-trace">
                      <li>{t('aws.gate.trace.gateIn', { rule: String(x.gateIn.rule), action: t(x.gateIn.allowed ? 'aws.gate.allow' : 'aws.gate.deny') })}</li>
                      {x.door && <li>{x.door.allowed ? t('aws.gate.trace.door', { n: (x.door.rule ?? 0) + 1 }) : t('aws.gate.trace.doorNo')}</li>}
                      {x.gateOut && <li>{t('aws.gate.trace.stateful')}</li>}
                      {x.gateOut?.map((p, j) => (
                        <li key={j}>
                          {t('aws.gate.trace.gateOut', { from: p.from, to: p.to, rule: String(p.rule), action: t(p.allowed ? 'aws.gate.allow' : 'aws.gate.deny') })}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {!x && <span className="awg-note">{t('aws.gate.client', { from: EPHEMERAL[v.client ?? 'linux'][0], to: EPHEMERAL[v.client ?? 'linux'][1] })}</span>}
              </li>
            );
          })}
        </ul>
      </section>

      <div className="awg-guards">
        {showNacl && (
          <section className="awg-guard is-gate" aria-labelledby={`${id}-nacl`}>
            <h3 className="awg-head" id={`${id}-nacl`}>
              <AwsIcon name="gate" />
              {t('aws.gate.nacl')}
            </h3>
            <p className="awg-note">{t('aws.gate.naclNote')}</p>
            {naclTable('inbound')}
            {naclTable('outbound')}
            {editNacl && (
              <div className="awg-form" role="group" aria-label={t('aws.gate.addNacl')}>
                <div className="awg-field">
                  <label htmlFor={`${id}-nd`}>{t('aws.gate.direction')}</label>
                  <select id={`${id}-nd`} value={nForm.dir} onChange={(e) => {
                    const dir = e.target.value as 'inbound' | 'outbound';
                    setNForm({ ...nForm, dir, number: String(nextNumber(nacl[dir])) });
                  }}>
                    <option value="inbound">{t('aws.gate.inbound')}</option>
                    <option value="outbound">{t('aws.gate.outbound')}</option>
                  </select>
                </div>
                <div className="awg-field">
                  <label htmlFor={`${id}-nn`}>{t('aws.gate.number')}</label>
                  <input id={`${id}-nn`} className="awg-input awg-num" inputMode="numeric" value={nForm.number} onChange={(e) => setNForm({ ...nForm, number: e.target.value })} />
                </div>
                <div className="awg-field">
                  <label htmlFor={`${id}-np`}>{t('aws.gate.protocol')}</label>
                  <select id={`${id}-np`} value={nForm.protocol} onChange={(e) => setNForm({ ...nForm, protocol: e.target.value as Proto })}>
                    {PROTOS.map((p) => (
                      <option key={p} value={p}>
                        {t(`aws.gate.proto.${p}`)}
                      </option>
                    ))}
                  </select>
                </div>
                {nForm.protocol !== 'all' && (
                  <div className="awg-field">
                    <label htmlFor={`${id}-nr`}>{t('aws.gate.ports')}</label>
                    <input id={`${id}-nr`} className="awg-input awg-mono" value={nForm.ports} onChange={(e) => setNForm({ ...nForm, ports: e.target.value })} spellCheck={false} />
                  </div>
                )}
                <div className="awg-field">
                  <label htmlFor={`${id}-nc`}>{t(nForm.dir === 'inbound' ? 'aws.gate.colSource' : 'aws.gate.colDest')}</label>
                  <input id={`${id}-nc`} className="awg-input awg-mono" value={nForm.cidr} onChange={(e) => setNForm({ ...nForm, cidr: e.target.value })} spellCheck={false} autoCapitalize="off" />
                </div>
                <div className="awg-field">
                  <label htmlFor={`${id}-na`}>{t('aws.gate.colAction')}</label>
                  <select id={`${id}-na`} value={nForm.action} onChange={(e) => setNForm({ ...nForm, action: e.target.value as 'allow' | 'deny' })}>
                    <option value="allow">{t('aws.gate.allow')}</option>
                    <option value="deny">{t('aws.gate.deny')}</option>
                  </select>
                </div>
                <button type="button" className="btn btn-ghost scene-btn" onClick={addNacl}>
                  {t('aws.gate.addRule')}
                </button>
              </div>
            )}
          </section>
        )}

        <section className="awg-guard is-door" aria-labelledby={`${id}-sg`}>
          <h3 className="awg-head" id={`${id}-sg`}>
            <AwsIcon name="door" />
            {t('aws.gate.sg')}
          </h3>
          <p className="awg-note">{t('aws.gate.sgNote')}</p>
          <h4 className="awg-subhead">{t('aws.gate.inbound')}</h4>
          {sg.length ? (
            <ul className="awg-sg-rules">
              {sg.map((r, i) => (
                <li key={i}>
                  <span>
                    {rulePorts(t, r.protocol, r.ports)} · {t('aws.gate.from')} <code>{r.source}</code>
                  </span>
                  {editSg && (
                    <button
                      type="button"
                      className="btn btn-quiet awg-x"
                      onClick={() => {
                        setSg(sg.filter((_, j) => j !== i));
                        setAnnounce(t('aws.gate.removed', { rule: `${rulePorts(t, r.protocol, r.ports)} · ${r.source}` }));
                        changed();
                      }}
                      aria-label={t('aws.gate.removeLabel', { rule: `${rulePorts(t, r.protocol, r.ports)} · ${r.source}` })}
                    >
                      {t('aws.gate.remove')}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="awg-note">{t('aws.gate.noRules')}</p>
          )}
          <p className="awg-note">{t('aws.gate.sgOut')}</p>
          {editSg && (
            <div className="awg-form" role="group" aria-label={t('aws.gate.addSg')}>
              <div className="awg-field">
                <label htmlFor={`${id}-sp`}>{t('aws.gate.protocol')}</label>
                <select id={`${id}-sp`} value={sgForm.protocol} onChange={(e) => setSgForm({ ...sgForm, protocol: e.target.value as Proto })}>
                  {PROTOS.map((p) => (
                    <option key={p} value={p}>
                      {t(`aws.gate.proto.${p}`)}
                    </option>
                  ))}
                </select>
              </div>
              {sgForm.protocol !== 'all' && (
                <div className="awg-field">
                  <label htmlFor={`${id}-sr`}>{t('aws.gate.ports')}</label>
                  <input id={`${id}-sr`} className="awg-input awg-mono" value={sgForm.ports} onChange={(e) => setSgForm({ ...sgForm, ports: e.target.value })} spellCheck={false} />
                </div>
              )}
              <div className="awg-field">
                <label htmlFor={`${id}-ss`}>{t('aws.gate.source')}</label>
                <input
                  id={`${id}-ss`}
                  className="awg-input awg-mono"
                  value={sgForm.source}
                  onChange={(e) => setSgForm({ ...sgForm, source: e.target.value })}
                  list={groups.length ? `${id}-groups` : undefined}
                  spellCheck={false}
                  autoCapitalize="off"
                />
                {groups.length > 0 && (
                  <datalist id={`${id}-groups`}>
                    {groups.map((g) => (
                      <option key={g} value={g} />
                    ))}
                  </datalist>
                )}
              </div>
              <button type="button" className="btn btn-ghost scene-btn" onClick={addSg}>
                {t('aws.gate.addRule')}
              </button>
            </div>
          )}
        </section>
      </div>

      {!done && (
        <div className="awg-row">
          <button type="button" className="btn scene-btn" onClick={tryNow}>
            {t('aws.gate.run')}
          </button>
        </div>
      )}
      {msg && <Feedback kind={msg.kind}>{msg.kind === 'almost' ? `${t('feedback.almost')} ${msg.text}` : msg.text}</Feedback>}
      <Announce text={announce} />
    </div>
  );
}
