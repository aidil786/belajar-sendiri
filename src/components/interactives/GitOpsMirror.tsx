// GitOps Mirror: Git on the left is the order board; the cluster on the right follows it.
// Change one line in Git and commit: an Argo CD-style controller sees OutOfSync → Syncing →
// Synced / Healthy. A manual kubectl edit in the cluster shows as drift: with self-heal on it snaps
// back, with self-heal off it stays until you press Sync. The clock can play, pause, or step.
// Logic: src/lib/gitopsMirror.ts.
import { useEffect, useId, useRef, useState } from 'react';
import type { Lang } from '~/i18n';
import {
  applicationYaml,
  commit,
  deploymentYaml,
  editCommand,
  head,
  initMirror,
  kubectlEdit,
  manualSync,
  runAll,
  setSelfHeal,
  step,
  taskDone,
  type Change,
  type GitopsApp,
  type GitopsTask,
  type MirrorState,
} from '~/lib/gitopsMirror';
import { K8sIcon, StateChip } from './k8sShared';
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

export interface GitOpsMirrorProps {
  lang: Lang;
  app: GitopsApp;
  /** Argo CD self-heal at the start (default true). */
  selfHeal?: boolean;
  task?: GitopsTask;
  /** Image tags the learner can pick in Git (default: the app's image and one newer tag). */
  images?: string[];
  /** The manual change the "kubectl" button makes (default: scale to 1). */
  drift?: Change;
  prompt?: string;
  success?: string;
}

const tagOf = (image: string) => image.split(':').pop() ?? image;

function nextTag(image: string): string {
  const m = /^(.*:)(\d+)\.(\d+)\.(\d+)$/.exec(image);
  return m ? `${m[1]}${m[2]}.${Number(m[3]) + 1}.0` : `${image}-next`;
}

export default function GitOpsMirror({
  lang,
  app,
  selfHeal = true,
  task,
  images,
  drift = { replicas: 1 },
  prompt,
  success,
}: GitOpsMirrorProps) {
  const t = useT(lang);
  const learner = useLearnerName();
  const motionOK = useMotionOK();
  const { ref, emit } = useCardEvents();
  const id = useId();
  const [s, setS] = useState<MirrorState>(() => initMirror(app, selfHeal));
  const [draft, setDraft] = useState<{ replicas: number; image: string }>({
    replicas: app.replicas,
    image: app.image,
  });
  const [playing, setPlaying] = useState(true);
  const [done, setDone] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'right' | 'almost'; text: string } | null>(null);
  const [announce, setAnnounce] = useState('');
  const tries = useRef(0);
  const tags = images ?? [app.image, nextTag(app.image)];
  const h = head(s);
  const dirty = draft.replicas !== h.replicas || draft.image !== h.image;
  const busy = s.queue.length > 0;

  // The clock: play steps one by one (or all at once when motion is off).
  useEffect(() => {
    if (!playing || !s.queue.length) return;
    if (!motionOK) {
      setS(runAll(s));
      return;
    }
    const timer = window.setTimeout(() => setS(step(s)), 600);
    return () => window.clearTimeout(timer);
  }, [s, playing, motionOK]);

  // Say what just happened, and check the task.
  const logLen = s.log.length;
  useEffect(() => {
    const last = s.log[logLen - 1];
    if (last) setAnnounce(t(`k8sGitops.log.${last.key}`, last.params));
    if (task && !done && taskDone(task, s)) {
      setDone(true);
      setMsg({
        kind: 'right',
        text:
          success ?? `${pickPraise(t, learner, tries.current)} ${t(`k8sGitops.done.${task.type}`)}`,
      });
      emit('fl:done', { tries: tries.current });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logLen, s.queue.length]);

  const doCommit = () => {
    if (!dirty || busy) return;
    tries.current++;
    const change: Change = {};
    if (draft.replicas !== h.replicas) change.replicas = draft.replicas;
    if (draft.image !== h.image) change.image = draft.image;
    const message = change.image
      ? t('k8sGitops.msgImage', { name: s.app.deployment, tag: tagOf(draft.image) })
      : t('k8sGitops.msgScale', { name: s.app.deployment, n: draft.replicas });
    if (
      task?.type === 'gitChange' &&
      String(change[task.field] ?? h[task.field]) !== String(task.to)
    ) {
      setMsg({
        kind: 'almost',
        text: t('k8sGitops.otherChange', {
          field: task.field,
          to: String(task.field === 'image' ? tagOf(String(task.to)) : task.to),
        }),
      });
      emit('fl:wrong');
    } else setMsg(null);
    setS(commit(s, change, message));
  };

  const doDrift = () => {
    if (busy) return;
    setS(kubectlEdit(s, drift));
    setMsg(null);
  };

  const nextText = s.queue[0] ? t(`k8sGitops.next.${s.queue[0]}`) : t('k8sGitops.next.none');
  const syncTone = s.op === 'syncing' ? 'wait' : s.sync === 'Synced' ? 'ok' : 'wait';
  const syncText = s.op === 'syncing' ? 'Syncing' : s.sync;
  const trays = Array.from({ length: s.live.replicas }, (_, i) => i < s.live.ready);

  return (
    <div className="k8g k8g-mirror" ref={ref}>
      <p className="interactive-help">{prompt ?? t(`k8sGitops.help.${task?.type ?? 'explore'}`)}</p>
      <div className="k8g-mirror-panels">
        <section className="k8g-panel k8g-panel-git" aria-labelledby={`${id}-git`}>
          <h3 className="k8g-head" id={`${id}-git`}>
            <K8sIcon name="commit" /> {t('k8sGitops.git')}
          </h3>
          <p className="k8g-path">
            <code>{s.app.path}/deployment.yaml</code>
          </p>
          <div className="k8g-yaml k8g-yaml-edit">
            <div>apiVersion: apps/v1</div>
            <div>kind: Deployment</div>
            <div>metadata:</div>
            <div>{`  name: ${s.app.deployment}`}</div>
            <div>spec:</div>
            <div className={cx('k8g-yaml-live', draft.replicas !== h.replicas && 'is-changed')}>
              {'  replicas: '}
              <span className="k8g-stepper">
                <button
                  type="button"
                  className="k8g-step-btn"
                  aria-label={t('k8sGitops.fewer')}
                  disabled={done || draft.replicas <= 0}
                  onClick={() => setDraft({ ...draft, replicas: draft.replicas - 1 })}
                >
                  −
                </button>
                <output aria-live="polite" aria-label={t('k8sGitops.replicas')}>
                  {draft.replicas}
                </output>
                <button
                  type="button"
                  className="k8g-step-btn"
                  aria-label={t('k8sGitops.more')}
                  disabled={done || draft.replicas >= 9}
                  onClick={() => setDraft({ ...draft, replicas: draft.replicas + 1 })}
                >
                  +
                </button>
              </span>
            </div>
            <div className="k8g-yaml-fold">{t('k8sGitops.folded')}</div>
            <div className={cx('k8g-yaml-live', draft.image !== h.image && 'is-changed')}>
              <span className="k8g-yaml-key">
                <span>{'          image: '}</span>
                <select
                  aria-label={t('k8sGitops.imageLabel')}
                  value={draft.image}
                  disabled={done}
                  onChange={(e) => setDraft({ ...draft, image: e.target.value })}
                >
                  {tags.map((im) => (
                    <option key={im} value={im}>
                      {im}
                    </option>
                  ))}
                </select>
              </span>
            </div>
          </div>
          <details className="k8g-yaml-peek">
            <summary>{t('k8sGitops.fullFile')}</summary>
            <pre className="k8g-yaml">{deploymentYaml(s)}</pre>
          </details>
          <button
            type="button"
            className="btn scene-btn"
            disabled={!dirty || busy || done}
            onClick={doCommit}
          >
            <span aria-hidden="true">✓ </span>
            {t('k8sGitops.commit')}
          </button>
          <h4 className="k8g-head">{t('k8sGitops.history')}</h4>
          <ol className="k8g-commits" reversed>
            {[...s.commits].reverse().map((c) => (
              <li key={c.sha} className={cx(c.sha === s.syncedSha && 'is-synced')}>
                <code>{c.sha}</code> {c.message}
                {c.sha === s.syncedSha && (
                  <span className="k8g-commit-tag">{t('k8sGitops.inCluster')}</span>
                )}
              </li>
            ))}
          </ol>
        </section>

        <section className="k8g-panel k8g-panel-cluster" aria-labelledby={`${id}-cl`}>
          <h3 className="k8g-head" id={`${id}-cl`}>
            <K8sIcon name="cluster" /> {t('k8sGitops.cluster', { ns: s.app.namespace })}
          </h3>
          <p className="k8g-badges">
            <span>
              {t('k8sGitops.sync')} <StateChip tone={syncTone}>{syncText}</StateChip>
            </span>
            <span>
              {t('k8sGitops.health')}{' '}
              <StateChip tone={s.health === 'Healthy' ? 'ok' : 'wait'}>{s.health}</StateChip>
            </span>
          </p>
          <p className="k8g-live">
            {t('k8sGitops.live', {
              name: s.app.deployment,
              ready: s.live.ready,
              replicas: s.live.replicas,
              tag: tagOf(s.live.image),
            })}
          </p>
          <ul className="k8g-tray-row" aria-hidden="true">
            {trays.map((ready, i) => (
              <li key={i} className={cx('k8g-mini-tray', ready ? 'is-ready' : 'is-starting')}>
                <K8sIcon name="pod" />
              </li>
            ))}
          </ul>
          <div className="k8g-drift">
            <span className="k8g-danger">
              <K8sIcon name="warn" /> {t('k8sGitops.manual')}
            </span>
            <button
              type="button"
              className="btn btn-ghost scene-btn"
              disabled={busy || done}
              onClick={doDrift}
            >
              <code>{editCommand(s, drift)}</code>
            </button>
          </div>
          <div className="k8g-switch-row">
            <button
              type="button"
              role="switch"
              aria-checked={s.selfHeal}
              className={cx('k8g-switch', s.selfHeal && 'is-on')}
              disabled={done}
              onClick={() => setS(setSelfHeal(s, !s.selfHeal))}
            >
              <span className="k8g-switch-knob" aria-hidden="true" />
              {t('k8sGitops.selfHeal')}
            </button>
            <pre className="k8g-yaml k8g-yaml-small">{`syncPolicy:\n  automated:\n    selfHeal: ${s.selfHeal}`}</pre>
          </div>
          {s.sync === 'OutOfSync' && !busy && !done && (
            <button type="button" className="btn scene-btn" onClick={() => setS(manualSync(s))}>
              <span aria-hidden="true">⟳ </span>
              {t('k8sGitops.syncNow')}
            </button>
          )}
          <details className="k8g-yaml-peek">
            <summary>{t('k8sGitops.appYaml')}</summary>
            <pre className="k8g-yaml">{applicationYaml(s)}</pre>
          </details>
        </section>
      </div>

      <div className="k8g-clock">
        <button
          type="button"
          className="btn btn-ghost scene-btn"
          aria-pressed={!playing}
          onClick={() => setPlaying(!playing)}
        >
          <span aria-hidden="true">{playing ? '⏸ ' : '▶ '}</span>
          {t(playing ? 'k8sGitops.pause' : 'k8sGitops.play')}
        </button>
        <button
          type="button"
          className="btn btn-ghost scene-btn"
          disabled={!busy}
          onClick={() => setS(step(s))}
        >
          <span aria-hidden="true">⏭ </span>
          {t('k8sGitops.step')}
        </button>
        <span className="k8g-next">{nextText}</span>
      </div>

      {s.log.length > 0 && (
        <ol className="k8g-log" aria-label={t('k8sGitops.logLabel')}>
          {s.log.map((e, i) => (
            <li key={i} className={cx('k8g-log-item', `is-${e.key}`)}>
              {t(`k8sGitops.log.${e.key}`, e.params)}
            </li>
          ))}
        </ol>
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
