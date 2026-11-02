// IAM Judge (Level Up · AWS, A2 "Keys & Guards"): a request arrives at the mall with its keys (policies).
// Predict Allow or Deny, then watch the guard posts decide, one by one, in the documented order.
// Or change one line of a policy until AWS gives the answer the task wants.
// Logic: src/lib/aws/iam.ts (the IAM User Guide's evaluation order, unit-tested with its examples).
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Lang } from '~/i18n';
import {
  editLine,
  evaluate,
  formatPolicy,
  parseCaller,
  type Effect,
  type Evaluation,
  type NamedPolicy,
  type PolicyDoc,
  type PolicyIssue,
  type PolicyKind,
  type StatementMatch,
  type Step,
} from '~/lib/aws/iam';
import { AwsIcon, PolicyBox, type AwsIconName, type CodeLine } from './awsShared';
import { Announce, Feedback, cx, pickPraise, useCardEvents, useLearnerName, useMotionOK, useT, type T } from './shared';
import './aws-games.css';

export interface IamJudgeRequest {
  /** The caller's ARN: an IAM user or a role session (arn:aws:sts::…:assumed-role/role/session). */
  principal: string;
  action: string;
  resource: string;
  /** Request context keys this request has (e.g. { 'aws:SecureTransport': 'false' }). */
  context?: Record<string, string>;
  /** A friendly name for the caller (default: the name in the ARN). */
  who?: string;
}

export interface IamJudgePolicy {
  name: string;
  kind: PolicyKind;
  /** SCPs: root, an OU name, or account. */
  level?: string;
  doc: PolicyDoc;
}

export type IamJudgeTask =
  | { type: 'predict' }
  | { type: 'edit'; policy: number; line: number; want: Effect; forbid?: string[] };

export interface IamJudgeProps {
  lang: Lang;
  request: IamJudgeRequest;
  policies: IamJudgePolicy[];
  /** Default { type: 'predict' }. */
  task?: IamJudgeTask;
  /** Edit task only: a replacement line that works (never shown; `check:mdx` tries it). */
  solution?: string;
  prompt?: string;
  success?: string;
}

const STEP_ICON: Record<Step['id'], AwsIconName> = { deny: 'stop', scp: 'mall', resource: 'sign', identity: 'key', boundary: 'fence' };
const KIND_ICON: Record<PolicyKind, AwsIconName> = { identity: 'key', boundary: 'fence', resource: 'sign', scp: 'mall' };
const STEP_MS = 320;

export function issueText(t: T, issue: PolicyIssue): string {
  return t('aws.iam.issue', { what: t(`aws.iam.issueCode.${issue.code}`) });
}

function where(t: T, policies: IamJudgePolicy[], hit: StatementMatch): string {
  const policy = policies[hit.policy]!.name;
  return hit.sid ? t('aws.iam.where', { policy, sid: hit.sid }) : t('aws.iam.whereN', { policy, n: hit.statement + 1 });
}

function hintKey(e: Evaluation): string {
  if (e.decision === 'Allow') return e.decidedBy === 'resource' ? 'aws.iam.hint.resource' : 'aws.iam.hint.allow';
  return `aws.iam.hint.${e.decidedBy}`;
}

export default function IamJudge({ lang, request, policies, task = { type: 'predict' }, prompt, success }: IamJudgeProps) {
  const t = useT(lang);
  const learner = useLearnerName();
  const motionOK = useMotionOK();
  const { ref, emit } = useCardEvents();
  const id = useId();
  const tries = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  const formatted = useMemo(() => policies.map((p) => formatPolicy(p.doc)), [policies]);
  const named: NamedPolicy[] = useMemo(() => policies.map((p) => ({ name: p.name, kind: p.kind, level: p.level, doc: p.doc })), [policies]);
  const editTask = task.type === 'edit' ? task : null;
  const startLine = editTask ? (formatted[editTask.policy]?.lines[editTask.line - 1] ?? '').trim() : '';

  const [value, setValue] = useState(startLine);
  const [result, setResult] = useState<Evaluation | null>(null);
  const [shown, setShown] = useState(0);
  const [msg, setMsg] = useState<{ kind: 'right' | 'almost'; text: string; detail?: string } | null>(null);
  const [done, setDone] = useState(false);
  const [announce, setAnnounce] = useState('');

  useEffect(() => () => window.clearTimeout(timer.current), []);

  /** Show the guard posts one by one (all at once in calm mode). Plays once; Replay plays it again. */
  const play = (e: Evaluation) => {
    window.clearTimeout(timer.current);
    const total = e.steps.length + 1;
    if (!motionOK) {
      setShown(total);
      return;
    }
    setShown(0);
    const tick = (n: number) => {
      setShown(n);
      if (n < total) timer.current = window.setTimeout(() => tick(n + 1), STEP_MS);
    };
    timer.current = window.setTimeout(() => tick(1), 60);
  };

  const finalText = (e: Evaluation) =>
    e.decision === 'Allow' ? t('aws.iam.final.allow') : t(e.denyKind === 'explicit' ? 'aws.iam.final.denyExplicit' : 'aws.iam.final.denyImplicit');

  const finish = (e: Evaluation) => {
    setDone(true);
    const base = success ?? `${pickPraise(t, learner, tries.current)} ${t(`aws.iam.done.${task.type}`, { want: editTask?.want ?? '' })}`;
    setMsg({ kind: 'right', text: base });
    setAnnounce(finalText(e));
    emit('fl:done', { tries: tries.current });
  };

  // --- Predict ---------------------------------------------------------------------------
  const truth = useMemo(() => evaluate(request, named), [request, named]);
  const guess = (answer: Effect) => {
    if (done) return;
    tries.current++;
    if (answer !== truth.decision) {
      setMsg({ kind: 'almost', text: t(hintKey(truth)) });
      emit('fl:wrong', { answer });
      return;
    }
    setResult(truth);
    play(truth);
    finish(truth);
  };

  // --- Edit one line ---------------------------------------------------------------------
  const check = () => {
    if (!editTask || done) return;
    tries.current++;
    const kind = policies[editTask.policy]!.kind;
    const parsed = editLine(formatted[editTask.policy]!.lines, editTask.line, value, kind);
    if (parsed.jsonError) {
      setResult(null);
      setMsg({ kind: 'almost', text: t('aws.iam.jsonError'), detail: parsed.jsonError });
      emit('fl:wrong');
      return;
    }
    if (!parsed.ok) {
      setResult(null);
      setMsg({ kind: 'almost', text: issueText(t, parsed.issues[0]!) });
      emit('fl:wrong');
      return;
    }
    const next = named.map((p, i) => (i === editTask.policy ? { ...p, doc: parsed.doc! } : p));
    const e = evaluate(request, next);
    setResult(e);
    play(e);
    const forbidden = (editTask.forbid ?? []).some((f) => new RegExp(f).test(value));
    if (e.decision === editTask.want && !forbidden) {
      finish(e);
      return;
    }
    setMsg({
      kind: 'almost',
      text: forbidden ? t('aws.iam.forbid') : `${t('aws.iam.gotWant', { got: e.decision, want: editTask.want })} ${t(hintKey(e))}`,
    });
    setAnnounce(finalText(e));
    emit('fl:wrong');
  };

  const reset = () => {
    if (done) return;
    window.clearTimeout(timer.current);
    setValue(startLine);
    setResult(null);
    setShown(0);
    setMsg(null);
  };

  // Lines of each policy, with the statements that decided highlighted (after a reveal).
  const linesFor = (pi: number): CodeLine[] => {
    const f = formatted[pi]!;
    const lines: CodeLine[] = f.lines.map((text) => ({ text }));
    if (!result || shown < result.steps.length + 1) return lines;
    for (const step of result.steps) {
      if (step.outcome === 'skip') continue;
      for (const h of step.hits) {
        if (h.policy !== pi) continue;
        const [a, b] = f.statementLines[h.statement]!;
        for (let n = a; n <= b; n++) lines[n - 1] = { ...lines[n - 1]!, tone: h.effect === 'Deny' ? 'deny' : 'allow', mark: n === a };
      }
    }
    return lines;
  };

  const caller = parseCaller(request.principal);
  const who = request.who ?? caller?.name ?? request.principal;
  const callerKind = caller?.kind ?? 'user';
  const ctx = Object.entries(request.context ?? {});

  return (
    <div className="awg awg-iam" ref={ref}>
      <p className="interactive-help">{prompt ?? t(`aws.iam.help.${task.type}`, { want: editTask?.want ?? '' })}</p>

      <section className="awg-request" aria-labelledby={`${id}-req`}>
        <h3 className="awg-head" id={`${id}-req`}>
          <AwsIcon name="unit" />
          {t('aws.iam.request')}
        </h3>
        <dl className="awg-facts">
          <div>
            <dt>{t('aws.iam.who')}</dt>
            <dd>
              <AwsIcon name={callerKind === 'user' ? 'user' : 'role'} /> <strong>{who}</strong> ({t(`aws.iam.kind.${callerKind}`)})
              <code className="awg-arn">{request.principal}</code>
            </dd>
          </div>
          <div>
            <dt>{t('aws.iam.wants')}</dt>
            <dd>
              <code>{request.action}</code>
            </dd>
          </div>
          <div>
            <dt>{t('aws.iam.on')}</dt>
            <dd>
              <code className="awg-arn">{request.resource}</code>
            </dd>
          </div>
          {ctx.length > 0 && (
            <div>
              <dt>{t('aws.iam.context')}</dt>
              <dd>
                {ctx.map(([k, v]) => (
                  <code key={k} className="awg-ctx">
                    {k} = {v}
                  </code>
                ))}
              </dd>
            </div>
          )}
        </dl>
      </section>

      <section className="awg-policies" aria-label={t('aws.iam.policies')}>
        {policies.map((p, pi) => (
          <PolicyBox
            key={pi}
            title={`${t(`aws.iam.policyKind.${p.kind}`, { level: p.level ?? 'account' })} · ${p.name}`}
            icon={KIND_ICON[p.kind]}
            label={t('aws.iam.policyLabel', { name: p.name })}
            lines={linesFor(pi)}
            edit={
              editTask && editTask.policy === pi
                ? {
                    line: editTask.line,
                    value,
                    onChange: (v) => {
                      setValue(v);
                      if (msg?.kind === 'almost') setMsg(null);
                    },
                    inputLabel: t('aws.iam.lineLabel', { n: editTask.line, policy: p.name }),
                    disabled: done,
                  }
                : undefined
            }
          />
        ))}
      </section>

      {task.type === 'predict' && !done && (
        <div className="awg-row awg-predict" role="group" aria-label={t('aws.iam.predict')}>
          <span className="awg-predict-q">{t('aws.iam.predict')}</span>
          <button type="button" className="btn btn-ghost scene-btn" onClick={() => guess('Allow')}>
            {t('aws.iam.sayAllow')}
          </button>
          <button type="button" className="btn btn-ghost scene-btn" onClick={() => guess('Deny')}>
            {t('aws.iam.sayDeny')}
          </button>
        </div>
      )}

      {editTask && !done && (
        <div className="awg-row">
          <button type="button" className="btn scene-btn" onClick={check}>
            {t('aws.iam.check')}
          </button>
          <button type="button" className="btn btn-ghost scene-btn" onClick={reset}>
            {t('aws.iam.reset')}
          </button>
        </div>
      )}

      {result && (
        <section className="awg-ladder" aria-labelledby={`${id}-steps`}>
          <h3 className="awg-head" id={`${id}-steps`}>
            <AwsIcon name="road" />
            {t('aws.iam.steps')}
          </h3>
          <ol className="awg-steps">
            {result.steps.map((s, i) => {
              const visible = i < shown;
              return (
                <li key={s.id} className={cx('awg-step', `is-${s.outcome}`, !visible && 'is-waiting', motionOK && 'can-move')}>
                  <span className="awg-step-icon">
                    <AwsIcon name={STEP_ICON[s.id]} />
                  </span>
                  <span className="awg-step-body">
                    <span className="awg-step-title">{t(`aws.iam.step.${s.id}`)}</span>
                    {visible && (
                      <>
                        <span className={cx('awg-step-outcome', `is-${s.outcome}`)}>
                          {s.outcome === 'stopDeny' && <AwsIcon name="warn" />}
                          {(s.outcome === 'pass' || s.outcome === 'stopAllow') && <AwsIcon name="ok" />}
                          {t(`aws.iam.outcome.${s.outcome}`)}
                        </span>
                        <span className="awg-step-why">
                          {t(`aws.iam.why.${s.reason}`, {
                            where: s.hits[0] ? where(t, policies, s.hits[0]) : '',
                            level: s.level ?? '',
                          })}
                        </span>
                        {s.hits.slice(0, 1).flatMap((h) =>
                          h.conditions.map((c, ci) => (
                            <span key={ci} className="awg-step-cond">
                              <code>
                                {c.operator} {c.key}
                              </code>{' '}
                              {c.got === undefined ? t('aws.iam.condMissing') : t('aws.iam.condGot', { got: c.got })}
                              {' → '}
                              {t(c.result ? 'aws.iam.condTrue' : 'aws.iam.condFalse')}
                            </span>
                          )),
                        )}
                      </>
                    )}
                  </span>
                </li>
              );
            })}
          </ol>
          {shown >= result.steps.length + 1 && (
            <p className={cx('awg-verdict', result.decision === 'Allow' ? 'is-allow' : 'is-deny')}>
              <AwsIcon name={result.decision === 'Allow' ? 'door' : 'warn'} />
              <strong>{finalText(result)}</strong>
            </p>
          )}
          {motionOK && (
            <button type="button" className="btn btn-quiet scene-btn" onClick={() => play(result)}>
              {t('aws.iam.replay')}
            </button>
          )}
        </section>
      )}

      {msg && (
        <Feedback kind={msg.kind}>
          {msg.kind === 'almost' ? `${t('feedback.almost')} ${msg.text}` : msg.text}
          {msg.detail && <span className="awg-detail">{msg.detail}</span>}
        </Feedback>
      )}
      <Announce text={announce} />
    </div>
  );
}
