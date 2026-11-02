// Namespace X-ray: a plain Linux process. Flip namespaces on (what it can see) and cgroups
// (what it can use): its process list, files, network, hostname, shared memory, user id and
// limits change, until it looks like a container. Each switch sits next to the panel it
// changes. One animation per flip (that panel glows once, ~0.6 s); the panel also says what
// it showed before (a static before/after, so calm mode loses nothing).
import { useRef, useState, type ReactNode } from 'react';
import type { Lang } from '~/i18n';
import { ANSWER, CGROUP_FILE, CGROUPS, DOCKER_DEFAULT, HOW, isContainer, panelOf, shownSwitches, startSet, taskDone, view, type Switch, type XrayTask, type XrayView } from '~/lib/namespaceXray';
import { LunchboxIcon, XrayIcon } from './kitchenIcons';
import { Announce, Feedback, cx, pickPraise, useCardEvents, useLearnerName, useMotionOK, useT, type T } from './shared';
import './docker-games.css';

export interface NamespaceXrayProps {
  lang: Lang;
  /** `{ type: 'all' }` (default), `{ type: 'docker' }`, `{ type: 'find', what }` or `{ type: 'turnOn', switches }`. */
  task?: XrayTask;
  /** Switches already on at the start. */
  start?: Switch[];
  /** Show only these switches (and their panels), to keep a card short. Default: all nine. */
  switches?: Switch[];
  prompt?: string;
  success?: string;
}

type Panel = ReturnType<typeof panelOf>;
type Last = { s: Switch; before: XrayView; key: number };

/** Each row: the switch(es) and the panel they change. */
const SEE_ROWS: [Switch, Panel][] = [
  ['pid', 'processes'],
  ['mnt', 'files'],
  ['net', 'network'],
  ['uts', 'hostname'],
  ['ipc', 'ipc'],
  ['user', 'user'],
];

export default function NamespaceXray({ lang, task = { type: 'all' }, start, switches, prompt, success }: NamespaceXrayProps) {
  const t = useT(lang);
  const learner = useLearnerName();
  const motionOK = useMotionOK();
  const { ref, emit } = useCardEvents();
  const [on, setOn] = useState<Set<Switch>>(() => startSet(start));
  const [last, setLast] = useState<Last | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [announce, setAnnounce] = useState('');
  const tries = useRef(0);

  const v = view(on);
  const container = isContainer(on);
  const shown = shownSwitches(switches);
  const seeRows = SEE_ROWS.filter(([s]) => shown.includes(s));
  const useList = CGROUPS.filter((s) => shown.includes(s));

  const taskText = (): string => {
    if (prompt) return prompt;
    if (task.type === 'find') return t(`nsx.ask.${task.what}`);
    if (task.type === 'docker') return t('nsx.task.docker');
    if (task.type === 'turnOn') return t('nsx.task.turnOn', { list: task.switches.map((s) => t(`nsx.sw.${s}`)).join(', ') });
    return t('nsx.task.all');
  };

  const flip = (s: Switch) => {
    if (done) return;
    tries.current++;
    const next = new Set(on);
    if (next.has(s)) next.delete(s);
    else next.add(s);
    setLast({ s, before: v, key: (last?.key ?? 0) + 1 });
    setOn(next);
    const state = next.has(s) ? t('nsx.on') : t('nsx.off');
    setAnnounce(t('nsx.flipped', { sw: t(`nsx.sw.${s}`), state, panel: t(`nsx.panel.${panelOf(s)}`) }));
    if (taskDone(task, next, s, shown)) {
      setDone(true);
      setMsg(null);
      emit('fl:done', { tries: tries.current });
    } else if (task.type === 'find' && next.has(s)) {
      setMsg(`${t('feedback.almost')} ${t('nsx.almost.find', { got: t(`nsx.sw.${s}`), changed: t(`nsx.panel.${panelOf(s)}`) })} ${t('nsx.hint', { panel: t(`nsx.panel.${panelOf(ANSWER[task.what])}`) })}`);
      emit('fl:wrong');
    } else setMsg(null);
  };

  const glow = (p: Panel) => (last && panelOf(last.s) === p ? last : null);
  const sw = (s: Switch) => <SwitchButton key={s} t={t} s={s} on={on.has(s)} disabled={done} flip={flip} />;

  const content: Record<Panel, { body: ReactNode; was: (b: XrayView) => string }> = {
    processes: {
      body: (
        <>
          <ul className="nsx-list">
            {v.processes.map((p) => (
              <li key={p.pid} className={cx(p.mine && 'is-mine')}>
                <code>
                  {String(p.pid).padStart(4, ' ')} {p.cmd}
                </code>
                {p.mine && <span className="nsx-mine">{t('nsx.mine')}</span>}
              </li>
            ))}
          </ul>
          {v.procNote && <p className="nsx-note">{t('nsx.procNote')}</p>}
        </>
      ),
      was: (b) => t('nsx.was.processes', { n: b.processes.length }),
    },
    files: {
      body: (
        <>
          <ul className="nsx-list">
            {v.files.map((f) => (
              <li key={f}>
                <code>{f}</code>
              </li>
            ))}
          </ul>
          {on.has('mnt') && <p className="nsx-note">{t('nsx.rootNote')}</p>}
        </>
      ),
      was: (b) => t('nsx.was.files', { first: b.files[0]! }),
    },
    network: {
      body: (
        <>
          <ul className="nsx-list">
            {v.interfaces.map((i) => (
              <li key={i.name}>
                <code>
                  {i.name.padEnd(8, ' ')} {i.addr}
                </code>
              </li>
            ))}
          </ul>
          {on.has('net') && <p className="nsx-note">{t('nsx.vethNote')}</p>}
        </>
      ),
      was: (b) => t('nsx.was.network', { list: b.interfaces.map((i) => i.name).join(', ') }),
    },
    hostname: { body: <code className="nsx-big">{v.hostname}</code>, was: (b) => t('nsx.was.hostname', { name: b.hostname }) },
    ipc: {
      body: v.ipc.length ? (
        <ul className="nsx-list">
          {v.ipc.map((x) => (
            <li key={x}>{t('nsx.ipcFrom', { app: x })}</li>
          ))}
        </ul>
      ) : (
        <p className="nsx-empty">{t('nsx.ipcNone')}</p>
      ),
      was: (b) => t('nsx.was.ipc', { n: b.ipc.length }),
    },
    user: {
      body: (
        <>
          <p className="nsx-uid">
            {t('nsx.uidInside')} <code>uid=0(root)</code>
          </p>
          <p className={cx('nsx-uid', v.uid.outside === 0 && 'is-risk')}>
            {t('nsx.uidOutside')} <code>uid={v.uid.outside}</code> {v.uid.outside === 0 ? t('nsx.rootToo') : t('nsx.nobody')}
          </p>
          {!on.has('user') && <p className="nsx-note">{t('nsx.userNote')}</p>}
        </>
      ),
      was: (b) => t('nsx.was.user', { uid: b.uid.outside }),
    },
    limits: {
      body: (
        <dl className="nsx-limits">
          {CGROUPS.map((c) => {
            const val = v.limits[c];
            return (
              <div key={c}>
                <dt>{t(`nsx.limit.${c}`)}</dt>
                <dd>
                  {val === null ? t(`nsx.noLimit.${c}`) : t(`nsx.limitValue.${c}`, { v: val })}
                  {val !== null && <code className="nsx-cg">{CGROUP_FILE[c]}</code>}
                </dd>
              </div>
            );
          })}
        </dl>
      ),
      was: (b) => t('nsx.was.limits', { n: [b.limits.memory, b.limits.cpu, b.limits.pids].filter((x) => x !== null).length }),
    },
  };

  const panel = (id: Panel) => <PanelBox t={t} id={id} g={glow(id)} motionOK={motionOK} was={content[id].was} body={content[id].body} />;

  return (
    <div className="nsx" ref={ref}>
      <p className="interactive-help">{taskText()}</p>
      {DOCKER_DEFAULT.every((s) => shown.includes(s)) && (
        <p className={cx('nsx-status', container && 'is-container')} aria-live="polite">
          {container ? <LunchboxIcon size={18} /> : <XrayIcon size={18} />} {container ? t('nsx.status.container') : t('nsx.status.process')}
        </p>
      )}
      {seeRows.length > 0 && (
        <>
          <p className="dg-head">{t('nsx.see')}</p>
          <ul className="nsx-rows">
            {seeRows.map(([s, p]) => (
              <li key={s} className="nsx-row">
                {sw(s)}
                {panel(p)}
              </li>
            ))}
          </ul>
        </>
      )}
      {useList.length > 0 && (
        <>
          <p className="dg-head">{t('nsx.use')}</p>
          <ul className="nsx-rows">
            <li className="nsx-row">
              <div className="nsx-sw-stack">{useList.map(sw)}</div>
              {panel('limits')}
            </li>
          </ul>
        </>
      )}
      {msg && !done && <Feedback kind="almost">{msg}</Feedback>}
      {done && <Feedback kind="right">{success ?? `${pickPraise(t, learner, tries.current)} ${task.type === 'find' ? t('nsx.right.find', { sw: t(`nsx.sw.${ANSWER[task.what]}`) }) : t('nsx.right.all')}`}</Feedback>}
      <Announce text={announce} />
    </div>
  );
}

function SwitchButton({ t, s, on, disabled, flip }: { t: T; s: Switch; on: boolean; disabled: boolean; flip: (s: Switch) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} className={cx('nsx-sw', on && 'is-on')} disabled={disabled} onClick={() => flip(s)}>
      <span className="nsx-knob" aria-hidden="true" />
      <span className="nsx-sw-text">
        <span className="nsx-sw-name">{t(`nsx.sw.${s}`)}</span>
        <span className="nsx-sw-means">{t(`nsx.means.${s}`)}</span>
        <code className="nsx-how">{HOW[s]}</code>
      </span>
    </button>
  );
}

function PanelBox({ t, id, g, motionOK, was, body }: { t: T; id: Panel; g: Last | null; motionOK: boolean; was: (before: XrayView) => string; body: ReactNode }) {
  return (
    <section key={g ? `${id}-${g.key}` : id} className={cx('nsx-panel', g && 'is-changed', g && motionOK && 'is-glow')} aria-label={t(`nsx.panel.${id}`)}>
      <p className="nsx-panel-head">{t(`nsx.panel.${id}`)}</p>
      {body}
      {g && <p className="nsx-was">{was(g.before)}</p>}
    </section>
  );
}
