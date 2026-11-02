// RBAC Switchboard: wire people and ServiceAccounts (plugs) to Roles and ClusterRoles (sockets)
// with RoleBindings and ClusterRoleBindings (wires). Then ask "can-i?" and get yes or no, decided
// the way Kubernetes RBAC decides it. Task: give a CI bot only the rights it needs.
// Wires are made with three plain selects (no dragging needed). Logic: src/lib/rbacSwitchboard.ts.
import { useId, useMemo, useRef, useState } from 'react';
import type { Lang } from '~/i18n';
import {
  allAnswered,
  bindingYaml,
  canBind,
  canI,
  canIOutput,
  makeBinding,
  ruleSummary,
  subjectId,
  RESOURCES,
  VERBS,
  type CanIQuestion,
  type RbacBinding,
  type RbacRole,
  type RbacSubject,
  type RbacTask,
} from '~/lib/rbacSwitchboard';
import { K8sIcon, KubectlBox, StateChip, type IconName } from './k8sShared';
import { Announce, Feedback, cx, pickPraise, useCardEvents, useLearnerName, useT } from './shared';
import './k8s-games.css';

export interface RbacSwitchboardProps {
  lang: Lang;
  subjects: RbacSubject[];
  roles: RbacRole[];
  /** Wires at the start. */
  bindings?: RbacBinding[];
  /** can-i questions; `expect` is the answer the task wants. */
  questions: CanIQuestion[];
  /** Default { type: 'wire' }. */
  task?: RbacTask;
  /** Namespaces offered for new RoleBindings (default: the ones in roles, bindings and questions). */
  namespaces?: string[];
  prompt?: string;
  success?: string;
}

const subjectIcon = (s: RbacSubject): IconName =>
  s.kind === 'ServiceAccount' ? 'bot' : s.kind === 'Group' ? 'group' : 'user';

export default function RbacSwitchboard({
  lang,
  subjects,
  roles,
  bindings: start = [],
  questions,
  task = { type: 'wire' },
  namespaces,
  prompt,
  success,
}: RbacSwitchboardProps) {
  const t = useT(lang);
  const learner = useLearnerName();
  const { ref, emit } = useCardEvents();
  const id = useId();
  const [bindings, setBindings] = useState<RbacBinding[]>(start);
  const [who, setWho] = useState(subjectId(subjects[0]!));
  const [roleIdx, setRoleIdx] = useState(0);
  const scopes = useMemo(() => {
    const set = new Set<string>(namespaces ?? []);
    if (!namespaces) {
      for (const r of roles) if (r.namespace) set.add(r.namespace);
      for (const b of start) if (b.namespace) set.add(b.namespace);
      for (const q of questions) if (q.namespace && q.namespace !== '*') set.add(q.namespace);
    }
    return [...set];
  }, [namespaces, roles, start, questions]);
  const [scope, setScope] = useState(scopes[0] ?? '*');
  const [predicted, setPredicted] = useState<Record<number, boolean>>({});
  const [own, setOwn] = useState<CanIQuestion>({
    as: subjectId(subjects[0]!),
    verb: 'get',
    resource: 'pods',
    namespace: scopes[0],
  });
  const [msg, setMsg] = useState<{ kind: 'right' | 'almost'; text: string } | null>(null);
  const [done, setDone] = useState(false);
  const [announce, setAnnounce] = useState('');
  const tries = useRef(0);
  const model = { roles, bindings };

  const finish = () => {
    setDone(true);
    setMsg({
      kind: 'right',
      text: success ?? `${pickPraise(t, learner, tries.current)} ${t(`k8sRbac.done.${task.type}`)}`,
    });
    emit('fl:done', { tries: tries.current });
  };

  const changed = (next: RbacBinding[], said: string) => {
    setBindings(next);
    setAnnounce(said);
    if (task.type === 'wire' && allAnswered({ roles, bindings: next }, questions)) finish();
    else setMsg(null);
  };

  const connect = () => {
    if (done) return;
    tries.current++;
    const subject = subjects.find((s) => subjectId(s) === who)!;
    const role = roles[roleIdx]!;
    if (!canBind(role, scope)) {
      setMsg({
        kind: 'almost',
        text: t('k8sRbac.wrongScope', { role: role.name, ns: role.namespace ?? '' }),
      });
      emit('fl:wrong');
      return;
    }
    const b = makeBinding(subject, role, scope);
    if (bindings.some((x) => x.name === b.name && x.namespace === b.namespace)) {
      setMsg({ kind: 'almost', text: t('k8sRbac.already') });
      return;
    }
    changed(
      [...bindings, b],
      t('k8sRbac.connected', {
        who: subject.name,
        role: role.name,
        where: scope === '*' ? t('k8sRbac.everywhere') : t('k8sRbac.inNs', { ns: scope }),
      }),
    );
  };

  const unplug = (b: RbacBinding) => {
    if (done) return;
    changed(
      bindings.filter((x) => x !== b),
      t('k8sRbac.unplugged', { name: b.name }),
    );
  };

  const predict = (i: number, yes: boolean) => {
    if (done) return;
    tries.current++;
    const real = canI(model, questions[i]!).allowed;
    if (real !== yes) {
      // Kind hint, and the learner tries again (the answer stays hidden).
      setMsg({ kind: 'almost', text: t(real ? 'k8sRbac.predictYes' : 'k8sRbac.predictNo') });
      emit('fl:wrong');
      return;
    }
    const next = { ...predicted, [i]: yes };
    setPredicted(next);
    setMsg(null);
    if (questions.every((q, j) => next[j] === canI(model, q).allowed)) finish();
  };

  const where = (b: RbacBinding) =>
    b.kind === 'ClusterRoleBinding'
      ? t('k8sRbac.everywhere')
      : t('k8sRbac.inNs', { ns: b.namespace ?? '' });
  const subjectName = (s: RbacSubject) =>
    s.kind === 'ServiceAccount'
      ? `${s.name} (${t('k8sRbac.kind.ServiceAccount')} · ${s.namespace})`
      : `${s.name} (${t(`k8sRbac.kind.${s.kind}`)})`;
  const ownAnswer = canI(model, own);

  return (
    <div className="k8g k8g-rbac" ref={ref}>
      <p className="interactive-help">{prompt ?? t(`k8sRbac.help.${task.type}`)}</p>
      <div className="k8g-board">
        <section aria-labelledby={`${id}-who`}>
          <h3 className="k8g-head" id={`${id}-who`}>
            {t('k8sRbac.subjects')}
          </h3>
          <ul className="k8g-cards">
            {subjects.map((s) => (
              <li key={subjectId(s)} className="k8g-card k8g-plug">
                <K8sIcon name={subjectIcon(s)} />
                <span>{subjectName(s)}</span>
              </li>
            ))}
          </ul>
        </section>
        <section aria-labelledby={`${id}-roles`}>
          <h3 className="k8g-head" id={`${id}-roles`}>
            {t('k8sRbac.roles')}
          </h3>
          <ul className="k8g-cards">
            {roles.map((r) => (
              <li key={`${r.kind}/${r.namespace}/${r.name}`} className="k8g-card k8g-socket">
                <span className="k8g-card-title">
                  <K8sIcon name="role" />
                  <span>
                    {r.kind} <strong>{r.name}</strong>
                    {r.namespace ? ` · ${r.namespace}` : ` · ${t('k8sRbac.clusterWide')}`}
                  </span>
                </span>
                <ul className="k8g-rules">
                  {r.rules.map((rule, i) => (
                    <li key={i}>
                      <code>{ruleSummary(rule)}</code>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section aria-labelledby={`${id}-wires`}>
        <h3 className="k8g-head" id={`${id}-wires`}>
          {t('k8sRbac.wires')}
        </h3>
        {bindings.length ? (
          <ul className="k8g-wires">
            {bindings.map((b) => (
              <li
                key={`${b.kind}/${b.namespace}/${b.name}`}
                className={cx('k8g-wire', b.kind === 'ClusterRoleBinding' && 'is-cluster')}
              >
                <span className="k8g-wire-text">
                  {b.subjects.map((s) => s.name).join(', ')}
                  <span className="k8g-wire-line" aria-hidden="true">
                    {' '}
                    ━━▶{' '}
                  </span>
                  <span className="visually-hidden"> {t('k8sRbac.to')} </span>
                  <strong>{b.roleRef.name}</strong>
                  <span className="k8g-wire-kind">
                    {b.kind} · {where(b)}
                  </span>
                </span>
                <details className="k8g-yaml-peek">
                  <summary>{t('k8sRbac.yaml', { name: b.name })}</summary>
                  <pre className="k8g-yaml">{bindingYaml(b)}</pre>
                </details>
                {task.type === 'wire' && !done && (
                  <button
                    type="button"
                    className="btn btn-ghost scene-btn"
                    onClick={() => unplug(b)}
                    aria-label={t('k8sRbac.unplugLabel', { name: b.name })}
                  >
                    {t('k8sRbac.unplug')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="k8g-empty">{t('k8sRbac.noWires')}</p>
        )}
        {task.type === 'wire' && !done && (
          <div className="k8g-maker">
            <div className="k8g-field">
              <label htmlFor={`${id}-f1`}>{t('k8sRbac.who')}</label>
              <select id={`${id}-f1`} value={who} onChange={(e) => setWho(e.target.value)}>
                {subjects.map((s) => (
                  <option key={subjectId(s)} value={subjectId(s)}>
                    {subjectName(s)}
                  </option>
                ))}
              </select>{' '}
            </div>
            <div className="k8g-field">
              <label htmlFor={`${id}-f2`}>{t('k8sRbac.role')}</label>
              <select
                id={`${id}-f2`}
                value={roleIdx}
                onChange={(e) => setRoleIdx(Number(e.target.value))}
              >
                {roles.map((r, i) => (
                  <option key={i} value={i}>
                    {r.kind} {r.name}
                    {r.namespace ? ` (${r.namespace})` : ''}
                  </option>
                ))}
              </select>{' '}
            </div>
            <div className="k8g-field">
              <label htmlFor={`${id}-f3`}>{t('k8sRbac.where')}</label>
              <select id={`${id}-f3`} value={scope} onChange={(e) => setScope(e.target.value)}>
                {scopes.map((s) => (
                  <option key={s} value={s}>
                    {t('k8sRbac.inNs', { ns: s })}
                  </option>
                ))}
                <option value="*">{t('k8sRbac.everywhere')}</option>
              </select>{' '}
            </div>
            <button type="button" className="btn scene-btn" onClick={connect}>
              <span aria-hidden="true">🔌 </span>
              {t('k8sRbac.connect')}
            </button>
          </div>
        )}
      </section>

      <section aria-labelledby={`${id}-qs`}>
        <h3 className="k8g-head" id={`${id}-qs`}>
          {t('k8sRbac.questions')}
        </h3>
        <ol className="k8g-qs">
          {questions.map((q, i) => {
            const a = canI(model, q);
            const show = task.type !== 'predict' || predicted[i] !== undefined;
            const good = q.expect === undefined || a.allowed === q.expect;
            return (
              <li
                key={i}
                className={cx(
                  'k8g-q',
                  show && task.type === 'wire' && (good ? 'is-good' : 'is-not-yet'),
                )}
              >
                <code className="k8g-q-cmd">{a.command}</code>
                <span className="k8g-q-row">
                  {show ? (
                    <StateChip tone={a.allowed ? 'ok' : 'idle'}>
                      {t(a.allowed ? 'k8sRbac.yes' : 'k8sRbac.no')}
                    </StateChip>
                  ) : (
                    <span className="k8g-q-predict">
                      <button
                        type="button"
                        className="btn btn-ghost scene-btn"
                        onClick={() => predict(i, true)}
                      >
                        {t('k8sRbac.sayYes')}
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost scene-btn"
                        onClick={() => predict(i, false)}
                      >
                        {t('k8sRbac.sayNo')}
                      </button>
                    </span>
                  )}
                  {task.type === 'wire' && q.expect !== undefined && (
                    <span className="k8g-q-want">
                      {t('k8sRbac.want', { answer: t(q.expect ? 'k8sRbac.yes' : 'k8sRbac.no') })}{' '}
                      {good ? <span aria-hidden="true">✓</span> : <span aria-hidden="true">↻</span>}
                      <span className="visually-hidden">
                        {t(good ? 'k8sRbac.matches' : 'k8sRbac.notYet')}
                      </span>
                    </span>
                  )}
                </span>
                {show && a.by && (
                  <span className="k8g-q-why">
                    {t('k8sRbac.because', { binding: a.by.binding.name, role: a.by.role.name })}
                  </span>
                )}
                {show && !a.allowed && <span className="k8g-q-why">{t('k8sRbac.nothing')}</span>}
              </li>
            );
          })}
        </ol>
      </section>

      <details className="k8g-own">
        <summary>{t('k8sRbac.askOwn')}</summary>
        <div className="k8g-maker">
          <div className="k8g-field">
            <label htmlFor={`${id}-f4`}>{t('k8sRbac.who')}</label>
            <select
              id={`${id}-f4`}
              value={own.as}
              onChange={(e) => setOwn({ ...own, as: e.target.value })}
            >
              {subjects.map((s) => (
                <option key={subjectId(s)} value={subjectId(s)}>
                  {subjectName(s)}
                </option>
              ))}
            </select>{' '}
          </div>
          <div className="k8g-field">
            <label htmlFor={`${id}-f5`}>{t('k8sRbac.verb')}</label>
            <select
              id={`${id}-f5`}
              value={own.verb}
              onChange={(e) => setOwn({ ...own, verb: e.target.value })}
            >
              {VERBS.slice(0, 8).map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>{' '}
          </div>
          <div className="k8g-field">
            <label htmlFor={`${id}-f6`}>{t('k8sRbac.resource')}</label>
            <select
              id={`${id}-f6`}
              value={own.resource}
              onChange={(e) => setOwn({ ...own, resource: e.target.value })}
            >
              {Object.keys(RESOURCES).map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>{' '}
          </div>
          <div className="k8g-field">
            <label htmlFor={`${id}-f7`}>{t('k8sRbac.where')}</label>
            <select
              id={`${id}-f7`}
              value={own.namespace ?? '*'}
              onChange={(e) => setOwn({ ...own, namespace: e.target.value })}
            >
              {scopes.map((s) => (
                <option key={s} value={s}>
                  {t('k8sRbac.inNs', { ns: s })}
                </option>
              ))}
              <option value="*">{t('k8sRbac.allNs')}</option>
            </select>{' '}
          </div>
        </div>
        <KubectlBox
          command={ownAnswer.command}
          lines={canIOutput(ownAnswer).map((text) => ({
            text,
            tone: text === 'yes' ? 'ok' : undefined,
          }))}
          label={t('k8sRbac.answer')}
        />
      </details>

      {msg && (
        <Feedback kind={msg.kind}>
          {msg.kind === 'almost' ? `${t('feedback.almost')} ${msg.text}` : msg.text}
        </Feedback>
      )}
      <Announce text={announce} />
    </div>
  );
}
