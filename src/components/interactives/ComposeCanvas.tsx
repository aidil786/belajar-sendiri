// Compose canvas: a set meal ordered in one go. Drag dishes (services) from the menu onto the
// table, or tap them; join them to phone lines (networks) and lockers (volumes); say who waits
// for whom (depends_on). compose.yaml writes itself beside it: 15 lines show at once, with
// indent guides; it scrolls. "Order" checks the goal, then `docker compose up -d` lights the
// services in start order (one animation, under 2 s). Calm mode: Before/After.
import { motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { Lang } from '~/i18n';
import { changedLines, checkCompose, composeYaml, CONDITIONS, emptyService, indentLevels, offered, startOrder, type CanvasService, type ComposeGoal, type Condition, type PaletteService } from '~/lib/composeCanvas';
import { highlightYaml } from '~/lib/yamlBuilder';
import { LockerIcon, LunchboxIcon } from './kitchenIcons';
import { Announce, Feedback, cx, pickPraise, useCardEvents, useLearnerName, useMotionOK, useT, type T } from './shared';
import './yaml-builder.css';
import './docker-games.css';

export interface ComposeCanvasProps {
  lang: Lang;
  /** Services the learner can add (the menu). */
  palette: PaletteService[];
  /** Required structure. Without a goal, Order is always fine (free play). */
  goal?: ComposeGoal;
  /** Network names to offer (default: the ones the goal uses). */
  networks?: string[];
  /** Named volumes to offer (default: the ones the goal uses). */
  volumes?: string[];
  /** Services already on the table: ids, or full `{ id, networks, volume, dependsOn }`. */
  start?: (string | Partial<CanvasService> & { id: string })[];
  prompt?: string;
  success?: string;
}

const STEP_MS = 320;
const COND_KEY: Record<Condition, string> = { service_started: 'started', service_healthy: 'healthy', service_completed_successfully: 'finished' };

export default function ComposeCanvas({ lang, palette, goal = {}, networks, volumes, start = [], prompt, success }: ComposeCanvasProps) {
  const t = useT(lang);
  const learner = useLearnerName();
  const motionOK = useMotionOK();
  const { ref, emit } = useCardEvents();
  const offer = useMemo(() => offered(goal, networks, volumes), [goal, networks, volumes]);
  const first = useMemo<CanvasService[]>(
    () => start.filter((s) => palette.some((p) => p.id === (typeof s === 'string' ? s : s.id))).map((s) => (typeof s === 'string' ? emptyService(s) : { ...emptyService(s.id), ...s })),
    [start, palette],
  );
  const [canvas, setCanvas] = useState<CanvasService[]>(first);
  const [fresh, setFresh] = useState<number[]>([]);
  const [msg, setMsg] = useState<{ kind: 'right' | 'almost'; text: string } | null>(null);
  const [done, setDone] = useState(false);
  // Compose up: how many services (in start order) are running. -1: not started.
  const [up, setUp] = useState(-1);
  const [hover, setHover] = useState(false);
  const [announce, setAnnounce] = useState('');
  const table = useRef<HTMLDivElement>(null);
  const yamlBox = useRef<HTMLPreElement>(null);
  const timer = useRef(0);
  const tries = useRef(0);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const yaml = composeYaml(palette, canvas);
  const order = startOrder(canvas);
  const byId = (id: string) => palette.find((p) => p.id === id);
  const label = (id: string) => byId(id)?.label ?? id;

  // Bring the first changed line into view inside the YAML box (never scrolls the page).
  useEffect(() => {
    const box = yamlBox.current;
    const line = fresh.length ? box?.querySelector<HTMLElement>(`[data-line="${fresh[0]}"]`) : null;
    if (!box || !line) return;
    if (line.offsetTop < box.scrollTop || line.offsetTop + line.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = Math.max(0, line.offsetTop - box.clientHeight / 3);
  }, [fresh]);

  const update = (next: CanvasService[], say: string) => {
    if (done) return;
    window.clearTimeout(timer.current);
    setFresh(changedLines(yaml, composeYaml(palette, next)));
    setCanvas(next);
    setUp(-1);
    setMsg(null);
    setAnnounce(say);
  };

  const add = (id: string) => {
    if (canvas.some((s) => s.id === id)) return;
    update([...canvas, emptyService(id)], t('compose.added', { name: label(id) }));
  };
  const remove = (id: string) =>
    update(
      canvas.filter((s) => s.id !== id).map((s) => ({ ...s, dependsOn: Object.fromEntries(Object.entries(s.dependsOn).filter(([k]) => k !== id)) })),
      t('compose.removed', { name: label(id) }),
    );
  const edit = (id: string, change: (s: CanvasService) => CanvasService, say: string) => update(canvas.map((s) => (s.id === id ? change(s) : s)), say);

  const onTable = (x: number, y: number) => {
    const r = table.current?.getBoundingClientRect();
    return !!r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  };

  const verdictText = (): string | null => {
    const v = checkCompose(goal, canvas, palette);
    if (v.ok) return null;
    switch (v.reason) {
      case 'missing':
        return t('compose.almost.missing', { name: label(v.service) });
      case 'extra':
        return t('compose.almost.extra', { name: label(v.service) });
      case 'volume':
        return t('compose.almost.volume', { name: label(v.service), volume: v.volume });
      case 'network':
        return t('compose.almost.network', { name: label(v.service), network: v.network });
      case 'dependsOn':
        return t('compose.almost.dependsOn', { name: label(v.service), on: label(v.on), cond: t(`compose.cond.${COND_KEY[v.condition]}`) });
      case 'noHealthcheck':
        return t('compose.almost.noHealthcheck', { name: label(v.service), on: label(v.on) });
      case 'cycle':
        return t('compose.almost.cycle', { path: v.path.map(label).join(' → ') });
    }
  };

  const orderMeal = () => {
    tries.current++;
    const problem = verdictText();
    if (problem) {
      setMsg({ kind: 'almost', text: `${t('feedback.almost')} ${problem}` });
      setAnnounce(problem);
      emit('fl:wrong');
      return;
    }
    const finish = () => {
      setUp(order.length);
      setDone(true);
      setMsg({ kind: 'right', text: success ?? pickPraise(t, learner, tries.current) });
      setAnnounce(t('compose.upDone', { list: order.map(label).join(', ') }));
      emit('fl:done', { tries: tries.current });
    };
    if (!motionOK || order.length === 0) {
      finish();
      return;
    }
    playUp(finish);
  };

  const playUp = (then?: () => void) => {
    window.clearTimeout(timer.current);
    const step = Math.min(STEP_MS, Math.floor(1800 / Math.max(1, order.length)));
    let i = 0;
    setUp(0);
    const tick = () => {
      i++;
      setUp(i);
      if (i < order.length) timer.current = window.setTimeout(tick, step);
      else then?.();
    };
    timer.current = window.setTimeout(tick, step);
  };

  const running = up >= 0 && up < order.length;
  const comparing = done && up < 0;

  return (
    <div className="cc" ref={ref}>
      <p className="interactive-help">{prompt ?? t('compose.help')}</p>

      <p className="dg-head">{t('compose.menu')}</p>
      <ul className="cc-menu">
        {palette.map((p) => {
          const used = canvas.some((s) => s.id === p.id);
          return (
            <li key={p.id}>
              <motion.button
                type="button"
                className={cx('cc-chip', used && 'is-used')}
                disabled={used || done}
                drag={!used && !done && motionOK}
                dragSnapToOrigin
                dragElastic={0.5}
                whileDrag={{ scale: 1.05, zIndex: 5 }}
                onDrag={(_, info) => setHover(onTable(info.point.x - window.scrollX, info.point.y - window.scrollY))}
                onDragEnd={(_, info) => {
                  setHover(false);
                  if (onTable(info.point.x - window.scrollX, info.point.y - window.scrollY)) add(p.id);
                }}
                onClick={() => add(p.id)}
              >
                <span className="cc-chip-name">
                  {!used && <span className="visually-hidden">{t('compose.addWord')} </span>}
                  <LunchboxIcon size={16} /> {label(p.id)}
                </span>
                <code className="cc-chip-img">{p.image ?? `build: ${p.build ?? `./${p.id}`}`}</code>
                {p.means && <span className="cc-chip-means">{p.means}</span>}
                {used && <span className="visually-hidden"> ({t('compose.onTableWord')})</span>}
                <span className="cc-chip-plus" aria-hidden="true">
                  {used ? '✓' : '+'}
                </span>
              </motion.button>
            </li>
          );
        })}
      </ul>

      <div className="cc-grid">
        <section className={cx('cc-table', hover && 'is-drop-target')} ref={table} aria-label={t('compose.table')}>
          <p className="dg-head">{t('compose.table')}</p>
          {canvas.length === 0 && <p className="cc-empty">{t('compose.empty')}</p>}
          <ul className="cc-services">
            {canvas.map((s) => (
              <ServiceCard
                key={s.id}
                t={t}
                s={s}
                p={byId(s.id)}
                canvas={canvas}
                offer={offer}
                label={label}
                disabled={done}
                state={up < 0 ? null : order.indexOf(s.id) < up ? (byId(s.id)?.healthcheck ? 'healthy' : 'running') : 'waiting'}
                onRemove={() => remove(s.id)}
                onEdit={(change, say) => edit(s.id, change, say)}
              />
            ))}
          </ul>
        </section>

        <section className="cc-file" aria-label="compose.yaml">
          <p className="dg-head">
            <span className="dg-file">compose.yaml</span> <span className="cc-lines">{t('compose.lines', { n: yaml.split('\n').length - 1 })}</span>
          </p>
          <YamlView t={t} yaml={yaml} fresh={motionOK ? fresh : []} boxRef={yamlBox} />
        </section>
      </div>

      <div className="scene-controls">
        {!done && (
          <button type="button" className="btn" disabled={running} onClick={orderMeal}>
            {t('compose.order')}
          </button>
        )}
        {done && motionOK && (
          <button type="button" className="btn btn-ghost scene-btn" disabled={running} onClick={() => playUp()}>
            ↺ {t('anim.replay')}
          </button>
        )}
        {done && !motionOK && (
          <>
            <button type="button" className="btn btn-ghost scene-btn" aria-pressed={comparing} onClick={() => setUp(comparing ? order.length : -1)}>
              {comparing ? t('anim.showAfter') : t('anim.showBefore')}
            </button>
            <span className="scene-state">{comparing ? t('anim.before') : t('anim.after')}</span>
          </>
        )}
      </div>
      {up >= 0 && (
        <div className="dg-term" role="group" aria-label={t('compose.upCmd')}>
          <code className="dg-term-line">$ docker compose up -d</code>
        </div>
      )}
      {msg && !running && <Feedback kind={msg.kind}>{msg.text}</Feedback>}
      <Announce text={announce} />
    </div>
  );
}

function ServiceCard({
  t,
  s,
  p,
  canvas,
  offer,
  label,
  disabled,
  state,
  onRemove,
  onEdit,
}: {
  t: T;
  s: CanvasService;
  p: PaletteService | undefined;
  canvas: CanvasService[];
  offer: { networks: string[]; volumes: string[] };
  label: (id: string) => string;
  disabled: boolean;
  state: 'waiting' | 'running' | 'healthy' | null;
  onRemove: () => void;
  onEdit: (change: (s: CanvasService) => CanvasService, say: string) => void;
}) {
  const name = label(s.id);
  const others = canvas.filter((x) => x.id !== s.id);
  return (
    <li className={cx('cc-service', state && `is-${state}`)} data-service={s.id}>
      <div className="cc-service-head">
        <span className="cc-service-name">
          <LunchboxIcon size={18} /> {name}
        </span>
        {state === 'running' && <span className="dg-chip dg-chip-ok">{t('compose.running')}</span>}
        {state === 'healthy' && <span className="dg-chip dg-chip-ok">{t('compose.healthy')}</span>}
        {state === 'waiting' && <span className="dg-chip dg-chip-wait">{t('compose.waiting')}</span>}
        {!disabled && (
          <button type="button" className="dg-icon-btn" aria-label={t('compose.remove', { name })} onClick={onRemove}>
            ✕
          </button>
        )}
      </div>
      <code className="cc-chip-img">{p?.image ?? `build: ${p?.build ?? `./${s.id}`}`}</code>

      {offer.networks.length > 0 && (
        <fieldset className="cc-field">
          <legend>{t('compose.networks')}</legend>
          <div className="cc-checks">
            {offer.networks.map((n) => (
              <label key={n} className="cc-check">
                <input
                  type="checkbox"
                  checked={s.networks.includes(n)}
                  disabled={disabled}
                  onChange={(e) => {
                    const on = e.target.checked;
                    onEdit((x) => ({ ...x, networks: on ? [...x.networks, n] : x.networks.filter((y) => y !== n) }), t(on ? 'compose.joined' : 'compose.left', { name, network: n }));
                  }}
                />
                <span>{n}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {p?.volumeTarget && offer.volumes.length > 0 && (
        <label className="cc-select-row">
          <span>
            <LockerIcon size={16} /> {t('compose.volume', { path: p.volumeTarget })}
          </span>
          <select
            value={s.volume ?? ''}
            aria-label={t('compose.volumeLabel', { name })}
            disabled={disabled}
            onChange={(e) => {
              const v = e.target.value || null;
              onEdit((x) => ({ ...x, volume: v }), v ? t('compose.volumeSet', { name, volume: v }) : t('compose.volumeNone', { name }));
            }}
          >
            <option value="">{t('compose.noVolume')}</option>
            {offer.volumes.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
      )}

      {others.length > 0 && (
        <fieldset className="cc-field">
          <legend>{t('compose.waitsFor')}</legend>
          {others.map((o) => (
            <label key={o.id} className="cc-select-row">
              <span>{label(o.id)}</span>
              <select
                value={s.dependsOn[o.id] ?? ''}
                disabled={disabled}
                aria-label={t('compose.waitLabel', { name, on: label(o.id) })}
                onChange={(e) => {
                  const c = (e.target.value || undefined) as Condition | undefined;
                  onEdit(
                    (x) => {
                      const dependsOn = { ...x.dependsOn };
                      if (c) dependsOn[o.id] = c;
                      else delete dependsOn[o.id];
                      return { ...x, dependsOn };
                    },
                    c ? t('compose.waitSet', { name, on: label(o.id), cond: t(`compose.cond.${COND_KEY[c]}`) }) : t('compose.waitNone', { name, on: label(o.id) }),
                  );
                }}
              >
                <option value="">{t('compose.noWait')}</option>
                {CONDITIONS.map((c) => (
                  <option key={c} value={c}>
                    {t(`compose.cond.${COND_KEY[c]}`)} ({c})
                  </option>
                ))}
              </select>
            </label>
          ))}
        </fieldset>
      )}
    </li>
  );
}

function YamlView({ t, yaml, fresh, boxRef }: { t: T; yaml: string; fresh: number[]; boxRef: RefObject<HTMLPreElement | null> }) {
  const lines = yaml.replace(/\n$/, '').split('\n');
  const levels = indentLevels(yaml);
  return (
    <pre className="cc-yaml" ref={boxRef} tabIndex={0} aria-label={t('compose.fileLabel', { n: lines.length })}>
      {lines.map((line, i) => (
        <span key={`${i}-${line}`} data-line={i} className={cx('cc-line', fresh.includes(i) && 'is-fresh')}>
          <span className="cc-ln" aria-hidden="true">
            {i + 1}
          </span>
          {Array.from({ length: levels[i]! }, (_, k) => (
            <span key={k} className="cc-guide" aria-hidden="true">
              {'  '}
            </span>
          ))}
          {highlightYaml(line.trimStart()).map((tok, j) => (
            <span key={j} className={tok.c ? `ybt-${tok.c}` : undefined}>
              {tok.t}
            </span>
          ))}
          {'\n'}
        </span>
      ))}
    </pre>
  );
}
