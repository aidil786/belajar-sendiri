// Scheduler Tetris: fit trays (pods) onto stalls (nodes). Requests are block sizes, allocatable is
// shelf space, taints are locks, tolerations are keys, nodeSelector/affinity are signs.
// Tap a tray, then a stall (or drag it). A tray that fits nowhere goes to Pending, and the real
// kube-scheduler message says why. Logic: src/lib/schedulerTetris.ts.
import { LayoutGroup, motion } from 'motion/react';
import { useId, useMemo, useRef, useState } from 'react';
import type { Lang } from '~/i18n';
import {
  checkBoard,
  cpuOf,
  fit,
  fitsOn,
  memOf,
  podYaml,
  schedulerMessage,
  taintText,
  tolerationText,
  usage,
  type Placement,
  type TetrisNode,
  type TetrisPod,
  type TetrisTask,
  type Toleration,
} from '~/lib/schedulerTetris';
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

export interface SchedulerTetrisProps {
  lang: Lang;
  nodes: TetrisNode[];
  pods: TetrisPod[];
  /** Default: place every tray; `pending` names trays that must end Pending. */
  task?: TetrisTask;
  /** Keys (tolerations) the learner can hand to trays. */
  keys?: Toleration[];
  prompt?: string;
  success?: string;
}

export function formatCpu(n: number): string {
  return Number.isInteger(n) ? String(n) : `${Math.round(n * 1000)}m`;
}

export function formatMem(b: number): string {
  if (b >= 2 ** 30) return `${Number((b / 2 ** 30).toFixed(2))}Gi`;
  return `${Math.round(b / 2 ** 20)}Mi`;
}

const needText = (p: TetrisPod) => [
  ...Object.entries(p.nodeSelector ?? {}).map(([k, v]) => `${k}=${v}`),
  ...(p.affinity ?? []).map(
    (a) =>
      `${a.key} ${a.operator === 'In' ? 'in' : a.operator === 'NotIn' ? 'not in' : a.operator === 'Exists' ? 'exists' : 'missing'}${a.values ? ` (${a.values.join(', ')})` : ''}`,
  ),
];

export default function SchedulerTetris({
  lang,
  nodes,
  pods,
  task = { type: 'placeAll' },
  keys = [],
  prompt,
  success,
}: SchedulerTetrisProps) {
  const t = useT(lang);
  const learner = useLearnerName();
  const motionOK = useMotionOK();
  const { ref, emit } = useCardEvents();
  const uid = useId();
  const [placement, setPlacement] = useState<Placement>(() =>
    Object.fromEntries(pods.map((p) => [p.name, p.node ?? null])),
  );
  const [picked, setPicked] = useState<string | null>(null);
  const [pickedKey, setPickedKey] = useState<number | null>(null);
  const [given, setGiven] = useState<Record<string, Toleration[]>>({});
  const [msg, setMsg] = useState<{ kind: 'right' | 'almost'; text: string; real?: string } | null>(
    null,
  );
  const [asked, setAsked] = useState<{ pod: string; text: string | null; fits: string[] } | null>(
    null,
  );
  const [bounce, setBounce] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [announce, setAnnounce] = useState('');
  const tries = useRef(0);
  const targets = useRef<Record<string, HTMLElement | null>>({});
  const byName = useMemo(() => new Map(pods.map((p) => [p.name, p])), [pods]);
  const tol = (p: TetrisPod) => [...(p.tolerations ?? []), ...(given[p.name] ?? [])];

  const targetAt = (x: number, y: number): string | null => {
    for (const [name, el] of Object.entries(targets.current)) {
      const r = el?.getBoundingClientRect();
      if (r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return name;
    }
    return null;
  };

  const nope = (pod: string, text: string, real?: string) => {
    setBounce(pod);
    window.setTimeout(() => setBounce(null), 450);
    setMsg({ kind: 'almost', text, real });
    setAnnounce(text);
    emit('fl:wrong');
  };

  const place = (podName: string, target: string) => {
    const pod = byName.get(podName);
    if (!pod || done) return;
    setPicked(null);
    setAsked(null);
    if (placement[podName] === target) return;
    tries.current++;
    const without: Placement = { ...placement, [podName]: null };
    if (target === 'pending') {
      const where = fitsOn(pod, nodes, pods, without, tol(pod));
      if (where.length)
        return nope(
          podName,
          t('k8sSched.fitsSomewhere', { pod: podName, nodes: where.join(', ') }),
        );
    } else {
      const node = nodes.find((n) => n.name === target)!;
      const f = fit(pod, node, pods, without, tol(pod));
      if (!f.fits) {
        const reason = f.reasons[0]!;
        const used = usage(node, pods, without, podName);
        const params = {
          pod: podName,
          node: node.name,
          taint: (node.taints ?? []).map(taintText).join(', '),
          need: needText(pod).join(', '),
          cpu: formatCpu(cpuOf(pod.cpu)),
          freeCpu: formatCpu(Math.max(0, cpuOf(node.cpu) - used.cpu)),
          mem: formatMem(memOf(pod.memory)),
          freeMem: formatMem(Math.max(0, memOf(node.memory) - used.memory)),
        };
        const real = {
          unschedulable: 'node(s) were unschedulable',
          taint: 'node(s) had untolerated taint(s)',
          affinity: "node(s) didn't match Pod's node affinity/selector",
          cpu: 'Insufficient cpu',
          memory: 'Insufficient memory',
        }[reason];
        return nope(podName, t(`k8sSched.no.${reason}`, params), real);
      }
    }
    const next = { ...placement, [podName]: target };
    setPlacement(next);
    const where = target === 'pending' ? t('k8sSched.pending') : target;
    setAnnounce(t('k8sSched.placed', { pod: podName, where }));
    const check = checkBoard(task, nodes, pods, next, given);
    if (check.done) {
      setDone(true);
      setMsg({
        kind: 'right',
        text: success ?? `${pickPraise(t, learner, tries.current)} ${t('k8sSched.done')}`,
      });
      emit('fl:done', { tries: tries.current });
    } else if (target === 'pending') {
      setMsg({
        kind: 'right',
        text: t('k8sSched.pendingOk', { pod: podName }),
        real: schedulerMessage(pod, nodes, pods, without, tol(pod)) ?? undefined,
      });
    } else setMsg(null);
  };

  const takeBack = (podName: string) => {
    if (done) return;
    setPlacement({ ...placement, [podName]: null });
    setMsg(null);
    setAnnounce(t('k8sSched.backToRack', { pod: podName }));
  };

  const tapTray = (podName: string) => {
    if (done) return;
    if (pickedKey !== null) {
      const key = keys[pickedKey]!;
      const have = given[podName] ?? [];
      setGiven({ ...given, [podName]: [...have, key] });
      setPickedKey(null);
      setAnnounce(t('k8sSched.keyGiven', { key: tolerationText(key), pod: podName }));
      return;
    }
    setPicked(picked === podName ? null : podName);
    setAsked(null);
  };

  const ask = () => {
    if (!picked) return;
    const pod = byName.get(picked)!;
    const without: Placement = { ...placement, [picked]: null };
    const fits = fitsOn(pod, nodes, pods, without, tol(pod));
    setAsked({ pod: picked, text: schedulerMessage(pod, nodes, pods, without, tol(pod)), fits });
    emit('fl:hint');
  };

  const tray = (pod: TetrisPod, where: 'rack' | 'shelf' | 'pending') => {
    const ks = tol(pod);
    const needs = needText(pod);
    const draggable = where === 'rack' && !done && pickedKey === null;
    const label = where === 'rack' ? undefined : t('k8sSched.takeBack', { pod: pod.name });
    return (
      <motion.li
        key={pod.name}
        layoutId={`${uid}-${pod.name}`}
        layout={motionOK}
        transition={{ duration: motionOK ? 0.45 : 0 }}
        className="k8g-tray-li"
      >
        <motion.button
          type="button"
          className={cx(
            'k8g-tray',
            `k8g-tray-${where}`,
            picked === pod.name && 'is-picked',
            bounce === pod.name && 'is-bounce',
            pickedKey !== null && 'is-key-target',
          )}
          aria-pressed={where === 'rack' ? picked === pod.name : undefined}
          aria-label={label}
          disabled={done}
          drag={draggable}
          dragSnapToOrigin
          dragElastic={0.6}
          whileDrag={{ scale: 1.05, zIndex: 5 }}
          onDrag={(_, info) =>
            setHover(targetAt(info.point.x - window.scrollX, info.point.y - window.scrollY))
          }
          onDragEnd={(_, info) => {
            setHover(null);
            const target = targetAt(info.point.x - window.scrollX, info.point.y - window.scrollY);
            if (target) place(pod.name, target);
          }}
          onClick={() =>
            where === 'rack' || pickedKey !== null ? tapTray(pod.name) : takeBack(pod.name)
          }
        >
          <span className="k8g-tray-head">
            <K8sIcon name="pod" />
            <span className="k8g-tray-name">{pod.name}</span>
          </span>
          <span className="k8g-tray-size">
            {t('k8sSched.size', {
              cpu: formatCpu(cpuOf(pod.cpu)),
              mem: formatMem(memOf(pod.memory)),
            })}
          </span>
          {needs.map((n) => (
            <span key={n} className="k8g-tag k8g-tag-sign">
              <K8sIcon name="sign" /> {t('k8sSched.needs', { label: n })}
            </span>
          ))}
          {ks.map((k, i) => (
            <span key={i} className="k8g-tag k8g-tag-key">
              <K8sIcon name="key" /> {tolerationText(k)}
            </span>
          ))}
        </motion.button>
      </motion.li>
    );
  };

  const bar = (label: string, used: number, total: number, fmt: (n: number) => string) => {
    const pct = Math.min(100, (used / total) * 100);
    return (
      <div className="k8g-bar">
        <span className="k8g-bar-label">
          {label}{' '}
          <span className="k8g-bar-num">
            {t('k8sSched.used', { used: fmt(used), total: fmt(total) })}
          </span>
        </span>
        <span className="k8g-bar-track" aria-hidden="true">
          <span
            className={cx('k8g-bar-fill', pct >= 99.9 && 'is-full')}
            style={{ width: `${pct}%` }}
          />
        </span>
      </div>
    );
  };

  const rack = pods.filter((p) => !placement[p.name]);
  const pending = pods.filter((p) => placement[p.name] === 'pending');

  return (
    <div className="k8g k8g-sched" ref={ref}>
      <p className="interactive-help">
        {prompt ?? (picked ? t('k8sSched.pickedHelp', { pod: picked }) : t('k8sSched.help'))}
      </p>
      <LayoutGroup id={uid}>
        <section className="k8g-rack" aria-label={t('k8sSched.rack')}>
          <h3 className="k8g-head">{t('k8sSched.rack')}</h3>
          {rack.length ? (
            <ul className="k8g-trays">{rack.map((p) => tray(p, 'rack'))}</ul>
          ) : (
            <p className="k8g-empty">{t('k8sSched.rackEmpty')}</p>
          )}
          {keys.length > 0 && !done && (
            <div className="k8g-keys">
              <h3 className="k8g-head">{t('k8sSched.keys')}</h3>
              <ul className="k8g-key-list">
                {keys.map((k, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      className={cx('k8g-keybtn', pickedKey === i && 'is-picked')}
                      aria-pressed={pickedKey === i}
                      onClick={() => setPickedKey(pickedKey === i ? null : i)}
                    >
                      <K8sIcon name="key" /> {tolerationText(k)}
                    </button>
                  </li>
                ))}
              </ul>
              {pickedKey !== null && <p className="k8g-note">{t('k8sSched.keyHelp')}</p>}
            </div>
          )}
          {picked && !done && (
            <button type="button" className="btn btn-ghost scene-btn" onClick={ask}>
              <span aria-hidden="true">? </span>
              {t('k8sSched.ask', { pod: picked })}
            </button>
          )}
        </section>

        <ul className="k8g-stalls">
          {nodes.map((n) => {
            const here = pods.filter((p) => placement[p.name] === n.name);
            const u = usage(n, pods, placement);
            return (
              <li
                key={n.name}
                ref={(el) => {
                  targets.current[n.name] = el;
                }}
                className={cx(
                  'k8g-stall',
                  hover === n.name && 'is-drop',
                  n.unschedulable && 'is-closed',
                )}
              >
                <div className="k8g-stall-head">
                  <K8sIcon name="node" />
                  <span className="k8g-stall-name">{n.name}</span>
                  {n.unschedulable && (
                    <span className="k8g-tag k8g-tag-lock">{t('k8sSched.cordoned')}</span>
                  )}
                </div>
                <div className="k8g-tags">
                  {Object.entries(n.labels ?? {}).map(([k, v]) => (
                    <span key={k} className="k8g-tag k8g-tag-sign">
                      <K8sIcon name="sign" /> {k}={v}
                    </span>
                  ))}
                  {(n.taints ?? []).map((tn) => (
                    <span key={taintText(tn)} className="k8g-tag k8g-tag-lock">
                      <K8sIcon name="lock" /> {taintText(tn)}
                    </span>
                  ))}
                </div>
                {bar(t('k8sSched.cpu'), u.cpu, cpuOf(n.cpu), formatCpu)}
                {bar(t('k8sSched.memory'), u.memory, memOf(n.memory), formatMem)}
                <ul className="k8g-trays k8g-shelf">{here.map((p) => tray(p, 'shelf'))}</ul>
                {picked && !done && (
                  <button
                    type="button"
                    className="btn btn-ghost scene-btn k8g-drop"
                    onClick={() => place(picked, n.name)}
                  >
                    {t('k8sSched.putHere', { pod: picked, node: n.name })}
                  </button>
                )}
              </li>
            );
          })}
          <li
            ref={(el) => {
              targets.current.pending = el;
            }}
            className={cx('k8g-stall k8g-pending', hover === 'pending' && 'is-drop')}
          >
            <div className="k8g-stall-head">
              <span className="k8g-stall-name">{t('k8sSched.pending')}</span>
            </div>
            <p className="k8g-note">{t('k8sSched.pendingNote')}</p>
            <ul className="k8g-trays k8g-shelf">{pending.map((p) => tray(p, 'pending'))}</ul>
            {picked && !done && (
              <button
                type="button"
                className="btn btn-ghost scene-btn k8g-drop"
                onClick={() => place(picked, 'pending')}
              >
                {t('k8sSched.leavePending', { pod: picked })}
              </button>
            )}
          </li>
        </ul>
      </LayoutGroup>

      {asked && (
        <div className="k8g-asked">
          {asked.text ? (
            <>
              <KubectlBox
                title={t('k8sSched.schedulerSays')}
                lines={[
                  {
                    text: `Warning  FailedScheduling  default-scheduler  ${asked.text}`,
                    tone: 'error',
                  },
                ]}
                label={t('k8sSched.schedulerSays')}
              />
              <PlainWords label={t('k8sGame.plain')}>
                {t('k8sSched.fitsNowhere', { pod: asked.pod })}
              </PlainWords>
            </>
          ) : (
            <PlainWords label={t('k8sGame.plain')}>
              {t('k8sSched.fitsOn', { pod: asked.pod, nodes: asked.fits.join(', ') })}
            </PlainWords>
          )}
        </div>
      )}
      {picked && !done && (
        <details className="k8g-yaml-peek">
          <summary>{t('k8sSched.showYaml', { pod: picked })}</summary>
          <pre className="k8g-yaml">{podYaml(byName.get(picked)!, given[picked] ?? [])}</pre>
        </details>
      )}
      {msg?.real && (
        <KubectlBox
          title={t('k8sSched.schedulerSays')}
          lines={[{ text: msg.real, tone: msg.kind === 'almost' ? 'error' : undefined }]}
          label={t('k8sSched.schedulerSays')}
        />
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
