// Order hatch: port mapping as cables. Tap a laptop port, then a container port (or the
// other way round): a cable joins them and the matching `docker run -p` line appears.
// Two cables on one laptop port spark: red + icon, Docker's real words, a plain translation.
// When the task is done, one request travels laptop → cable → container (once, ~1.2 s).
import { motion } from 'motion/react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Lang } from '~/i18n';
import { allocatedError, checkHatch, hostPortList, plug, requestPort, route, runCommand, unplug, wanted, type Cable, type HatchContainer, type HatchTask } from '~/lib/orderHatch';
import { DangerIcon } from './AreaIcons';
import { LaptopIcon, LunchboxIcon } from './kitchenIcons';
import { Announce, Feedback, cx, pickPraise, useCardEvents, useLearnerName, useMotionOK, useT, type T } from './shared';
import './docker-games.css';

export interface OrderHatchProps {
  lang: Lang;
  containers: HatchContainer[];
  task: HatchTask;
  /** Laptop ports to offer (default: the ones the task and start use, plus 3000 and 8080). */
  hostPorts?: number[];
  /** Cables already plugged at the start (e.g. web already on 8080, to practise a conflict). */
  start?: Cable[];
  prompt?: string;
  success?: string;
}

type Sel = { side: 'host'; port: number } | { side: 'box'; container: string; port: number } | null;
type Spark = { host: number; attempt: Cable; by: Cable };
type Wire = { key: string; d: string; x1: number; y1: number; x2: number; y2: number };

const TRAVEL_S = 1.2;

export default function OrderHatch({ lang, containers, task, hostPorts, start = [], prompt, success }: OrderHatchProps) {
  const t = useT(lang);
  const learner = useLearnerName();
  const motionOK = useMotionOK();
  const { ref, emit } = useCardEvents();
  const board = useRef<HTMLDivElement>(null);
  const [cables, setCables] = useState<Cable[]>(start);
  const [sel, setSel] = useState<Sel>(null);
  const [spark, setSpark] = useState<Spark | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [wires, setWires] = useState<Wire[]>([]);
  const [trip, setTrip] = useState(0); // >0 while the request travels; key for replays
  const [answered, setAnswered] = useState(false);
  const [announce, setAnnounce] = useState('');
  const tries = useRef(0);
  const ports = hostPortList(task, start, hostPorts);

  // Draw the cables: measure the two buttons each cable joins.
  const measure = useCallback(() => {
    const b = board.current;
    if (!b) return;
    const box = b.getBoundingClientRect();
    const next: Wire[] = [];
    for (const c of cables) {
      const a = b.querySelector<HTMLElement>(`[data-host="${c.host}"]`)?.getBoundingClientRect();
      const z = b.querySelector<HTMLElement>(`[data-box="${c.container}:${c.port}"]`)?.getBoundingClientRect();
      if (!a || !z) continue;
      const x1 = a.right - box.left;
      const y1 = a.top + a.height / 2 - box.top;
      const x2 = z.left - box.left;
      const y2 = z.top + z.height / 2 - box.top;
      const mid = (x1 + x2) / 2;
      next.push({ key: `${c.host}-${c.container}-${c.port}`, d: `M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`, x1, y1, x2, y2 });
    }
    setWires((old) => (JSON.stringify(old) === JSON.stringify(next) ? old : next));
  }, [cables]);

  useLayoutEffect(measure, [measure]);
  useEffect(() => {
    const b = board.current;
    if (!b || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(b);
    return () => ro.disconnect();
  }, [measure]);

  const portName = (c: Cable) => `${c.container}:${c.port}`;
  const target = done ? requestPort(task, cables) : null;
  const goal = wanted(task)[0];

  const taskText = (): string => {
    if (prompt) return prompt;
    if (!goal) return t('hatch.help');
    return goal.host === undefined ? t('hatch.task.any', { container: goal.container, port: goal.port }) : t('hatch.task.map', { host: goal.host, container: goal.container, port: goal.port });
  };

  const connect = (cable: Cable) => {
    setSel(null);
    tries.current++;
    const r = plug(cables, cable);
    if (!r.ok) {
      if (r.reason === 'same') {
        setNote(t('hatch.already', { host: cable.host, to: portName(cable) }));
        return;
      }
      setSpark({ host: cable.host, attempt: cable, by: r.by });
      setNote(null);
      setAnnounce(`${allocatedError(cable.host)}. ${t('hatch.spark.plain', { host: cable.host, by: r.by.container })}`);
      emit('fl:wrong');
      return;
    }
    setSpark(null);
    setCables(r.cables);
    const v = checkHatch(task, r.cables);
    setAnnounce(t('hatch.plugged', { host: cable.host, to: portName(cable) }));
    if (v.ok) {
      setDone(true);
      setNote(null);
      emit('fl:done', { tries: tries.current });
      setAnswered(!motionOK);
      if (motionOK) setTrip((n) => n + 1);
    } else if (v.wrong) {
      setNote(`${t('feedback.almost')} ${t('hatch.almost.wrongBox', { host: v.wrong.host, got: portName(v.wrong), want: `${v.missing.container}:${v.missing.port}` })}`);
      emit('fl:wrong');
    } else {
      // A cable that isn't part of the task: fine, but say what still needs doing.
      const miss = v.missing;
      setNote(miss.host === undefined ? t('hatch.next.any', { container: miss.container, port: miss.port }) : t('hatch.next.map', { host: miss.host, container: miss.container, port: miss.port }));
    }
  };

  const tapHost = (port: number) => {
    if (done) return;
    setSpark(null);
    if (sel?.side === 'box') connect({ host: port, container: sel.container, port: sel.port });
    else setSel(sel?.side === 'host' && sel.port === port ? null : { side: 'host', port });
  };

  const tapBox = (container: string, port: number) => {
    if (done) return;
    setSpark(null);
    if (sel?.side === 'host') connect({ host: sel.port, container, port });
    else setSel(sel?.side === 'box' && sel.container === container && sel.port === port ? null : { side: 'box', container, port });
  };

  const remove = (host: number) => {
    if (done) return;
    setCables(unplug(cables, host));
    setSpark(null);
    setNote(null);
    setAnnounce(t('hatch.unplugged', { host }));
  };

  const howto = sel ? (sel.side === 'host' ? t('hatch.pickedHost', { port: sel.port }) : t('hatch.pickedBox', { to: `${sel.container}:${sel.port}` })) : t('hatch.howto');
  const travelWire = target !== null ? wires.find((w) => w.key.startsWith(`${target}-`)) : undefined;
  const answer = target !== null ? route(cables, target) : null;

  return (
    <div className="hatch" ref={ref}>
      <p className="interactive-help">{taskText()}</p>
      {!done && <p className="hatch-howto">{howto}</p>}
      <div className="hatch-board" ref={board}>
        <section className="hatch-laptop" aria-label={t('hatch.laptop')}>
          <p className="dg-head">
            <LaptopIcon size={16} /> {t('hatch.laptop')}
          </p>
          <ul className="hatch-ports">
            {ports.map((p) => {
              const cable = cables.find((c) => c.host === p);
              const label = cable ? t('hatch.hostPortTo', { port: p, to: portName(cable) }) : t('hatch.hostPort', { port: p });
              return (
                <li key={p}>
                  <button
                    type="button"
                    data-host={p}
                    className={cx('hatch-port hatch-port-host', cable && 'is-plugged', sel?.side === 'host' && sel.port === p && 'is-picked', spark?.host === p && 'is-spark')}
                    aria-pressed={sel?.side === 'host' && sel.port === p}
                    aria-label={label}
                    disabled={done}
                    onClick={() => tapHost(p)}
                  >
                    <span className="hatch-port-num">{p}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
        <svg className="hatch-wires" aria-hidden="true">
          {wires.map((w) => (
            <path key={w.key} d={w.d} className={cx('hatch-wire', travelWire?.key === w.key && answered && 'is-ok')} />
          ))}
          {motionOK && trip > 0 && travelWire && (
            <motion.circle
              key={trip}
              r={7}
              className="hatch-dot"
              initial={{ cx: travelWire.x1 - 40, cy: travelWire.y1, opacity: 0 }}
              animate={{ cx: [travelWire.x1 - 40, travelWire.x1, (travelWire.x1 + travelWire.x2) / 2, travelWire.x2], cy: [travelWire.y1, travelWire.y1, (travelWire.y1 + travelWire.y2) / 2, travelWire.y2], opacity: [0, 1, 1, 1] }}
              transition={{ duration: TRAVEL_S, ease: 'easeInOut' }}
              onAnimationComplete={() => {
                setAnswered(true);
                setTrip(0);
              }}
            />
          )}
        </svg>
        <section className="hatch-boxes" aria-label={t('hatch.containers')}>
          {containers.map((c) => (
            <div key={c.name} className="hatch-box">
              <p className="hatch-box-name">
                <LunchboxIcon size={16} /> {c.name}
              </p>
              <ul className="hatch-ports">
                {c.ports.map((p) => {
                  const plugged = cables.filter((x) => x.container === c.name && x.port === p);
                  const picked = sel?.side === 'box' && sel.container === c.name && sel.port === p;
                  const ok = answered && answer?.container === c.name && answer.port === p;
                  return (
                    <li key={p}>
                      <button
                        type="button"
                        data-box={`${c.name}:${p}`}
                        className={cx('hatch-port hatch-port-box', plugged.length > 0 && 'is-plugged', picked && 'is-picked', ok && 'is-answer')}
                        aria-pressed={picked}
                        aria-label={plugged.length ? t('hatch.boxPortFrom', { name: c.name, port: p, hosts: plugged.map((x) => x.host).join(', ') }) : t('hatch.boxPort', { name: c.name, port: p })}
                        disabled={done}
                        onClick={() => tapBox(c.name, p)}
                      >
                        <span className="hatch-port-num">{p}</span>
                      </button>
                      {ok && <span className="dg-chip dg-chip-ok hatch-ok">200 OK</span>}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </section>
      </div>

      {cables.length > 0 && (
        <ul className="hatch-cables" aria-label={t('hatch.cables')}>
          {cables.map((c) => (
            <li key={c.host}>
              <code>-p {c.host}:{c.port}</code>
              <span>{t('hatch.cableWords', { host: c.host, to: portName(c) })}</span>
              {!done && (
                <button type="button" className="dg-icon-btn" aria-label={t('hatch.unplug', { host: c.host })} onClick={() => remove(c.host)}>
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <Commands t={t} containers={containers} cables={cables} spark={spark} />

      {spark && (
        <div className="dg-error" role="status">
          <DangerIcon />
          <div>
            <code className="dg-error-real">{allocatedError(spark.host)}</code>
            <p className="dg-error-plain">{t('hatch.spark.plain', { host: spark.host, by: spark.by.container })}</p>
          </div>
        </div>
      )}
      {note && !spark && <p className="hatch-note">{note}</p>}

      {done && (
        <div className="scene-controls">
          {motionOK ? (
            <button type="button" className="btn btn-ghost scene-btn" disabled={trip > 0} onClick={() => setTrip((n) => n + 1)}>
              ↺ {t('anim.replay')}
            </button>
          ) : (
            <>
              <button type="button" className="btn btn-ghost scene-btn" aria-pressed={!answered} onClick={() => setAnswered(!answered)}>
                {answered ? t('anim.showBefore') : t('anim.showAfter')}
              </button>
              <span className="scene-state">{answered ? t('anim.after') : t('anim.before')}</span>
            </>
          )}
        </div>
      )}
      {done && answer && answered && <p className="hatch-trip">{t('hatch.trip', { host: answer.host, to: portName(answer) })}</p>}
      {done && <Feedback kind="right">{success ?? pickPraise(t, learner, tries.current)}</Feedback>}
      <Announce text={announce} />
    </div>
  );
}

function Commands({ t, containers, cables, spark }: { t: T; containers: HatchContainer[]; cables: Cable[]; spark: Spark | null }) {
  const lines = containers.map((c) => ({ c, cmd: runCommand(c, cables) }));
  const failing = spark ? containers.find((c) => c.name === spark.attempt.container) : undefined;
  return (
    <div className="dg-term" aria-label={t('hatch.commands')} role="group">
      {lines.map(({ c, cmd }) => (
        <code key={c.name} className="dg-term-line">
          $ {cmd}
        </code>
      ))}
      {failing && spark && (
        <code className="dg-term-line is-err">
          $ {runCommand(failing, [...cables.filter((x) => x.container === failing.name), spark.attempt])}
          {'\n'}docker: Error response from daemon: … {allocatedError(spark.host)}
        </code>
      )}
    </div>
  );
}
