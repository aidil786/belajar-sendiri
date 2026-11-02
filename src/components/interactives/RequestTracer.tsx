// Request Tracer: follow one request from the browser to a pod, hop by hop:
// browser → Gateway (listener) → HTTPRoute (path) → Service (port → targetPort) → EndpointSlice → Pod.
// Break a hop and see what the user gets (404 / 500 / 503 / connection refused / timeout), with the
// real-looking output and what Kubernetes shows. Play once, or step one hop at a time.
// Logic: src/lib/requestTracer.ts.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Lang } from '~/i18n';
import {
  applyBreaks,
  HOPS,
  taskDone,
  trace,
  type BreakId,
  type HopId,
  type Trace,
  type TraceConfig,
  type TraceTask,
} from '~/lib/requestTracer';
import { K8sIcon, KubectlBox, PlainWords, StateChip, type IconName } from './k8sShared';
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

export interface RequestTracerProps {
  lang: Lang;
  /** A working setup: gateway, route rules, services, pods, request. */
  route: TraceConfig;
  /** Hops the learner may break (toggles). */
  breaks?: BreakId[];
  /** Breaks already in place at the start (e.g. for a "deliver" task). */
  broken?: BreakId[];
  /** Default { type: 'trace' }. */
  task?: TraceTask;
  prompt?: string;
  success?: string;
}

const ICON: Record<HopId, IconName> = {
  browser: 'browser',
  gateway: 'door',
  route: 'route',
  service: 'service',
  endpoints: 'slice',
  pod: 'pod',
};

export default function RequestTracer({
  lang,
  route,
  breaks = [],
  broken = [],
  task = { type: 'trace' },
  prompt,
  success,
}: RequestTracerProps) {
  const t = useT(lang);
  const learner = useLearnerName();
  const motionOK = useMotionOK();
  const { ref, emit } = useCardEvents();
  const [active, setActive] = useState<BreakId[]>(broken);
  const [run, setRun] = useState<{ tr: Trace; at: number } | null>(null);
  const [done, setDone] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'right' | 'almost'; text: string } | null>(null);
  const [announce, setAnnounce] = useState('');
  const timer = useRef(0);
  const tries = useRef(0);
  const cfg = useMemo(() => applyBreaks(route, active), [route, active]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const last = (tr: Trace) => HOPS.indexOf(tr.stopAt);
  const finished = run !== null && run.at >= last(run.tr);

  const finish = (tr: Trace) => {
    tries.current++;
    const ok = taskDone(task, tr);
    const outcome = t(`k8sTrace.outcome.${tr.outcome}`);
    setAnnounce(t('k8sTrace.arrived', { outcome }));
    if (ok && !done) {
      setDone(true);
      setMsg({
        kind: 'right',
        text:
          success ?? `${pickPraise(t, learner, tries.current)} ${t(`k8sTrace.done.${task.type}`)}`,
      });
      emit('fl:done', { tries: tries.current });
    } else if (!ok && !done) {
      const want =
        task.type === 'outcome' ? t(`k8sTrace.outcome.${task.want}`) : t('k8sTrace.outcome.200');
      setMsg({ kind: 'almost', text: t('k8sTrace.notYet', { got: outcome, want }) });
      emit('fl:wrong');
    }
  };

  const advance = (tr: Trace, at: number, auto: boolean) => {
    setRun({ tr, at });
    const hop = HOPS[at]!;
    setAnnounce(t('k8sTrace.at', { hop: t(`k8sTrace.hop.${hop}`) }));
    if (at >= last(tr)) {
      finish(tr);
      return;
    }
    if (auto) timer.current = window.setTimeout(() => advance(tr, at + 1, true), 320);
  };

  const send = () => {
    window.clearTimeout(timer.current);
    setMsg(null);
    const tr = trace(cfg);
    if (!motionOK) {
      setRun({ tr, at: last(tr) });
      finish(tr);
      return;
    }
    advance(tr, 0, true);
  };

  const stepOnce = () => {
    window.clearTimeout(timer.current);
    if (!run || finished) {
      setMsg(null);
      advance(trace(cfg), 0, false);
    } else advance(run.tr, run.at + 1, false);
  };

  const toggle = (b: BreakId) => {
    if (done && task.type !== 'trace') return;
    window.clearTimeout(timer.current);
    setRun(null);
    setMsg(null);
    const next = active.includes(b) ? active.filter((x) => x !== b) : [...active, b];
    setActive(next);
    setAnnounce(
      t(next.includes(b) ? 'k8sTrace.broke' : 'k8sTrace.fixed', { what: t(`k8sTrace.break.${b}`) }),
    );
  };

  const view = run?.tr ?? trace(cfg);
  const state = (i: number): 'ok' | 'fail' | 'wait' | 'idle' => {
    if (!run) return 'idle';
    if (i > run.at) return 'idle';
    if (i < run.at) return 'ok';
    if (!finished) return 'wait';
    return run.tr.outcome === '200' ? 'ok' : 'fail';
  };
  const detail = (hop: HopId): string => {
    const r = view.rule;
    const s = view.service;
    switch (hop) {
      case 'browser':
        return t('k8sTrace.d.browser', { path: cfg.request.path, port: cfg.request.port ?? 80 });
      case 'gateway':
        return t('k8sTrace.d.gateway', { name: cfg.gateway.name, port: cfg.gateway.port });
      case 'route':
        return r
          ? t('k8sTrace.d.route', { path: r.path, service: r.service, port: r.port })
          : t('k8sTrace.d.noRoute', { path: cfg.request.path });
      case 'service': {
        const svc = s ?? cfg.services.find((x) => x.name === r?.service);
        return svc
          ? t('k8sTrace.d.service', { name: svc.name, port: svc.port, target: svc.targetPort })
          : t('k8sTrace.d.noService', { name: r?.service ?? '?' });
      }
      case 'endpoints': {
        const svc = s ?? cfg.services.find((x) => x.name === r?.service);
        const sel = svc
          ? cfg.pods.filter((p) =>
              Object.entries(svc.selector).every(([k, v]) => p.labels[k] === v),
            )
          : [];
        return t('k8sTrace.d.endpoints', {
          ready: sel.filter((p) => p.ready !== false).length,
          total: sel.length,
        });
      }
      case 'pod': {
        const p = view.pods[0] ?? cfg.pods[0];
        return p ? t('k8sTrace.d.pod', { name: p.name, port: p.containerPort }) : '';
      }
    }
  };

  const outLines =
    run && finished
      ? [
          {
            text: run.tr.answer,
            tone: run.tr.outcome === '200' ? ('ok' as const) : ('error' as const),
          },
        ]
      : [];

  return (
    <div className="k8g k8g-trace" ref={ref}>
      <p className="interactive-help">
        {prompt ??
          t(
            `k8sTrace.help.${task.type}`,
            task.type === 'outcome' ? { want: t(`k8sTrace.outcome.${task.want}`) } : {},
          )}
      </p>
      <ol className="k8g-hops" aria-label={t('k8sTrace.path')}>
        {HOPS.map((hop, i) => {
          const st = state(i);
          return (
            <li key={hop} className={cx('k8g-hop', `is-${st}`, motionOK && 'can-move')}>
              <span className="k8g-hop-icon">
                <K8sIcon name={ICON[hop]} />
              </span>
              <span className="k8g-hop-text">
                <span className="k8g-hop-name">{t(`k8sTrace.hop.${hop}`)}</span>
                <span className="k8g-hop-detail">{detail(hop)}</span>
              </span>
              {st !== 'idle' && <StateChip tone={st}>{t(`k8sTrace.state.${st}`)}</StateChip>}
            </li>
          );
        })}
      </ol>

      <div className="k8g-row">
        <button
          type="button"
          className="btn scene-btn"
          onClick={send}
          disabled={run !== null && !finished}
        >
          <span aria-hidden="true">{run && finished ? '↺ ' : '▶ '}</span>
          {run && finished ? t('k8sTrace.again') : t('k8sTrace.send')}
        </button>
        <button type="button" className="btn btn-ghost scene-btn" onClick={stepOnce}>
          <span aria-hidden="true">⏭ </span>
          {t('k8sTrace.step')}
        </button>
      </div>

      {breaks.length > 0 && (
        <fieldset className="k8g-breaks">
          <legend className="k8g-head">{t('k8sTrace.breaks')}</legend>
          <ul className="k8g-break-list">
            {breaks.map((b) => (
              <li key={b}>
                <button
                  type="button"
                  className={cx('k8g-break', active.includes(b) && 'is-on')}
                  aria-pressed={active.includes(b)}
                  onClick={() => toggle(b)}
                >
                  <span aria-hidden="true">{active.includes(b) ? '⚠ ' : '○ '}</span>
                  {t(`k8sTrace.break.${b}`)}
                </button>
              </li>
            ))}
          </ul>
        </fieldset>
      )}

      {run && finished && (
        <div className="k8g-outcome">
          <KubectlBox
            title={t('k8sTrace.userSees')}
            command={run.tr.command}
            lines={outLines}
            label={t('k8sTrace.userSees')}
          />
          {run.tr.evidence.map((e) => (
            <KubectlBox
              key={e.command}
              title={t('k8sTrace.k8sSays')}
              command={e.command}
              lines={e.lines.map((text) => ({ text }))}
              label={t('k8sTrace.k8sSays')}
            />
          ))}
          <PlainWords label={t('k8sGame.plain')}>
            {t(`k8sTrace.why.${run.tr.why}`, {
              path: cfg.request.path,
              port: cfg.request.port ?? 80,
              service: run.tr.rule?.service ?? '',
              target: run.tr.service?.targetPort ?? '',
              listen: run.tr.pods[0]?.containerPort ?? '',
            })}
          </PlainWords>
        </div>
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
