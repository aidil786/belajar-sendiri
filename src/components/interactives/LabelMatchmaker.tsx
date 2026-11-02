// Label Matchmaker: stick labels on trays (pods); the order number (Service) lights up every tray
// its selector matches. No match = no endpoints. In template mode, a Deployment's selector must
// match its own pod template labels, or the API server refuses it (the real 1.37 error).
// Drag a label onto a tray, or tap the label and then the tray. Logic: src/lib/labelMatchmaker.ts.
import { AnimatePresence, motion } from 'motion/react';
import { useRef, useState } from 'react';
import type { Lang } from '~/i18n';
import {
  applyDeployment,
  endpointSliceCommand,
  endpointSliceTable,
  isDone,
  matched,
  missingPair,
  parseLabel,
  withLabel,
  withoutLabel,
  type Labels,
  type LmPod,
  type LmTask,
} from '~/lib/labelMatchmaker';
import { nameSuffix } from '~/lib/k8sMessages';
import { K8sIcon, KubectlBox, PlainWords } from './k8sShared';
import {
  Announce,
  Feedback,
  cx,
  pickPraise,
  useCardEvents,
  useLearnerName,
  useMotionOK,
  useT,
} from './shared';
import './k8s-games.css';

export interface LabelMatchmakerProps {
  lang: Lang;
  /** Trays and their starting labels (template mode: leave empty). */
  pods: LmPod[];
  /** Label chips the learner can use, e.g. ['app=shop', 'tier=web']. */
  labels: string[];
  /** The Service's (or Deployment's) selector. */
  selector: Labels;
  task: LmTask;
  /** Service or Deployment name (default "shop"). */
  service?: string;
  port?: number;
  /** Template mode: the pod template's starting labels. */
  templateLabels?: Labels;
  prompt?: string;
  success?: string;
}

const chip = (k: string, v: string) => `${k}=${v}`;

export default function LabelMatchmaker({
  lang,
  pods: start,
  labels,
  selector,
  task,
  service = 'shop',
  port = 80,
  templateLabels = {},
  prompt,
  success,
}: LabelMatchmakerProps) {
  const t = useT(lang);
  const learner = useLearnerName();
  const motionOK = useMotionOK();
  const { ref, emit } = useCardEvents();
  const [pods, setPods] = useState<LmPod[]>(start);
  const [tmpl, setTmpl] = useState<Labels>(templateLabels);
  const [picked, setPicked] = useState<string | null>(null);
  const [applied, setApplied] = useState<{ ok: boolean; text: string } | null>(null);
  const [msg, setMsg] = useState<{ kind: 'right' | 'almost'; text: string } | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [announce, setAnnounce] = useState('');
  const tries = useRef(0);
  const targets = useRef<Record<string, HTMLElement | null>>({});
  const template = task.type === 'template';

  const finish = () => {
    setDone(true);
    setPicked(null);
    setMsg({
      kind: 'right',
      text:
        success ??
        `${pickPraise(t, learner, tries.current)} ${t(template ? 'k8sLabels.doneTemplate' : 'k8sLabels.done')}`,
    });
    emit('fl:done', { tries: tries.current });
  };

  const stick = (label: string, target: string) => {
    if (done || !parseLabel(label)) return;
    setPicked(null);
    setApplied(null);
    if (target === '__template') {
      setTmpl(withLabel(tmpl, label));
      setAnnounce(t('k8sLabels.stuckTemplate', { label }));
      setMsg(null);
      return;
    }
    const next = pods.map((p) =>
      p.name === target ? { ...p, labels: withLabel(p.labels, label) } : p,
    );
    setPods(next);
    setAnnounce(t('k8sLabels.stuck', { label, pod: target, n: matched(selector, next).length }));
    setMsg(null);
    if (isDone(task, selector, next)) finish();
  };

  const unstick = (target: string, key: string) => {
    if (done) return;
    setApplied(null);
    if (target === '__template') setTmpl(withoutLabel(tmpl, key));
    else {
      const next = pods.map((p) =>
        p.name === target ? { ...p, labels: withoutLabel(p.labels, key) } : p,
      );
      setPods(next);
      if (isDone(task, selector, next)) finish();
    }
    setAnnounce(t('k8sLabels.removed', { key }));
    setMsg(null);
  };

  const check = () => {
    tries.current++;
    if (task.type !== 'select') return;
    const got = matched(selector, pods);
    const extra = got.find((p) => !task.pods.includes(p));
    const missing = task.pods.find((p) => !got.includes(p));
    if (!extra && !missing) return finish();
    const text = extra
      ? t('k8sLabels.extra', { pod: extra })
      : (() => {
          const pod = pods.find((p) => p.name === missing)!;
          const m = missingPair(selector, pod.labels)!;
          return t('k8sLabels.missing', { pod: pod.name, label: chip(m.key, m.want) });
        })();
    setMsg({ kind: 'almost', text });
    emit('fl:wrong');
  };

  const apply = () => {
    tries.current++;
    const r = applyDeployment(service, selector, tmpl);
    setApplied(r);
    if (r.ok) finish();
    else {
      setMsg({ kind: 'almost', text: t('k8sLabels.mismatch') });
      emit('fl:wrong');
    }
  };

  const targetAt = (x: number, y: number) => {
    for (const [name, el] of Object.entries(targets.current)) {
      const r = el?.getBoundingClientRect();
      if (r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return name;
    }
    return null;
  };

  const labelChips = (owner: string, l: Labels, removable: boolean) => (
    <ul className="k8g-labels">
      {Object.entries(l).map(([k, v]) => (
        <li key={k} className="k8g-label">
          <K8sIcon name="sign" />
          <span>{chip(k, v)}</span>
          {removable && !done && (
            <button
              type="button"
              className="k8g-x"
              aria-label={t('k8sLabels.remove', {
                label: chip(k, v),
                pod: owner === '__template' ? t('k8sLabels.template') : owner,
              })}
              onClick={() => unstick(owner, k)}
            >
              ✕
            </button>
          )}
        </li>
      ))}
      {!Object.keys(l).length && <li className="k8g-empty">{t('k8sLabels.noLabels')}</li>}
    </ul>
  );

  const hits = new Set(template ? [] : matched(selector, pods));
  // A Deployment's pods are named <deployment>-<template hash>-<random>.
  const stamped = applied?.ok
    ? [1, 2, 3].map((i) => ({
        name: `${service}-${nameSuffix(`${service}-rs`, 9)}-${nameSuffix(`${service}-${i}`)}`,
        labels: tmpl,
      }))
    : [];

  return (
    <div className="k8g k8g-labels-game" ref={ref}>
      <p className="interactive-help">
        {prompt ??
          (picked
            ? t('k8sLabels.pickedHelp', { label: picked })
            : t(template ? 'k8sLabels.helpTemplate' : 'k8sLabels.help'))}
      </p>

      <section
        className={cx('k8g-owner', template ? 'is-deploy' : 'is-service')}
        aria-label={t(template ? 'k8sLabels.deployment' : 'k8sLabels.service', { name: service })}
      >
        <p className="k8g-owner-title">
          <K8sIcon name={template ? 'role' : 'service'} />
          <span>
            {t(template ? 'k8sLabels.deployment' : 'k8sLabels.service', { name: service })}
          </span>
        </p>
        <p className="k8g-owner-row">
          <span className="k8g-owner-key">{t('k8sLabels.selector')}</span>
          {Object.entries(selector).map(([k, v]) => (
            <span key={k} className="k8g-label is-selector">
              {chip(k, v)}
            </span>
          ))}
        </p>
        {template && (
          <div
            ref={(el) => {
              targets.current.__template = el;
            }}
            className={cx('k8g-template', hover === '__template' && 'is-drop')}
          >
            <span className="k8g-owner-key">{t('k8sLabels.templateLabels')}</span>
            {labelChips('__template', tmpl, true)}
            {picked && !done && (
              <button
                type="button"
                className="btn btn-ghost scene-btn k8g-drop"
                onClick={() => stick(picked, '__template')}
              >
                {t('k8sLabels.stickTemplate', { label: picked })}
              </button>
            )}
          </div>
        )}
        {!template && <p className="k8g-owner-count">{t('k8sLabels.picks', { n: hits.size })}</p>}
      </section>

      {!done && (
        <section aria-label={t('k8sLabels.palette')}>
          <h3 className="k8g-head">{t('k8sLabels.palette')}</h3>
          <ul className="k8g-palette">
            {labels.map((l) => (
              <li key={l}>
                <motion.button
                  type="button"
                  className={cx('k8g-label k8g-label-btn', picked === l && 'is-picked')}
                  aria-pressed={picked === l}
                  drag
                  dragSnapToOrigin
                  dragElastic={0.6}
                  whileDrag={{ scale: 1.08, zIndex: 5 }}
                  onDrag={(_, info) =>
                    setHover(targetAt(info.point.x - window.scrollX, info.point.y - window.scrollY))
                  }
                  onDragEnd={(_, info) => {
                    setHover(null);
                    const target = targetAt(
                      info.point.x - window.scrollX,
                      info.point.y - window.scrollY,
                    );
                    if (target) stick(l, target);
                  }}
                  onClick={() => setPicked(picked === l ? null : l)}
                >
                  <K8sIcon name="sign" />
                  {l}
                </motion.button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!template && (
        <ul className="k8g-pods">
          {pods.map((p) => {
            const hit = hits.has(p.name);
            const m = hit ? null : missingPair(selector, p.labels);
            return (
              <li
                key={p.name}
                ref={(el) => {
                  targets.current[p.name] = el;
                }}
                className={cx('k8g-pod', hit && 'is-hit', hover === p.name && 'is-drop')}
              >
                <p className="k8g-pod-name">
                  <K8sIcon name="pod" />
                  <span>{p.name}</span>
                </p>
                {labelChips(p.name, p.labels, true)}
                <p className="k8g-pod-state">
                  {hit ? (
                    <>
                      <span aria-hidden="true">✓ </span>
                      {t('k8sLabels.picked', { service })}
                    </>
                  ) : (
                    m && t('k8sLabels.needs', { label: chip(m.key, m.want) })
                  )}
                </p>
                {picked && !done && (
                  <button
                    type="button"
                    className="btn btn-ghost scene-btn k8g-drop"
                    onClick={() => stick(picked, p.name)}
                  >
                    {t('k8sLabels.stick', { label: picked, pod: p.name })}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {!template && (
        <>
          <KubectlBox
            command={endpointSliceCommand(service)}
            lines={endpointSliceTable(service, pods, selector, port).map((text) => ({ text }))}
            label={t('k8sLabels.slices')}
          />
          {hits.size === 0 && (
            <p className="k8g-alert" role="status">
              <K8sIcon name="warn" />
              <span>{t('k8sLabels.noEndpoints', { service })}</span>
            </p>
          )}
          {!done && (
            <button type="button" className="btn scene-btn" onClick={check}>
              {t('k8sLabels.check')}
            </button>
          )}
        </>
      )}

      {template && (
        <>
          {!done && (
            <button type="button" className="btn scene-btn k8g-apply" onClick={apply}>
              <span aria-hidden="true">▶ </span>
              {t('k8sLabels.apply')}
            </button>
          )}
          {applied && (
            <KubectlBox
              command={`kubectl apply -f ${service}.yaml`}
              lines={[{ text: applied.text, tone: applied.ok ? 'ok' : 'error' }]}
              label={t('k8sLabels.output')}
            />
          )}
          {applied && !applied.ok && (
            <PlainWords label={t('k8sGame.plain')}>{t('k8sLabels.plainMismatch')}</PlainWords>
          )}
          <AnimatePresence>
            {stamped.length > 0 && (
              <motion.ul
                className="k8g-pods"
                initial={motionOK ? { opacity: 0, y: 8 } : false}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: motionOK ? 0.4 : 0 }}
              >
                {stamped.map((p) => (
                  <li key={p.name} className="k8g-pod is-hit">
                    <p className="k8g-pod-name">
                      <K8sIcon name="pod" />
                      <span>{p.name}</span>
                    </p>
                    {labelChips(p.name, p.labels, false)}
                  </li>
                ))}
              </motion.ul>
            )}
          </AnimatePresence>
        </>
      )}

      {msg && (
        <Feedback kind={msg.kind}>
          {msg.kind === 'almost' ? `${t('feedback.almost')} ${msg.text}` : msg.text}
        </Feedback>
      )}
      <Announce text={announce} />
    </div>
  );
}
