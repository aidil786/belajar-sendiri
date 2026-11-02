// The food-court picture (Ship It rule 16: show the state after every command).
// Stalls are nodes, trays are pods (green Ready, amber waiting, red + icon failed),
// order numbers are Services, the entrance is a Gateway. Trays can be buttons when the
// lesson lets learners delete them; stalls can be closed (kill node). Reduced motion /
// calm mode: no movement, the picture just shows the new state.
import { AnimatePresence, motion } from 'motion/react';
import type { Picture, Stall, Tray } from '~/engine/foodcourt-sim';
import { cx, type T } from './shared';
import { WarnIcon } from './YouAreHere';
import './kube.css';

export interface FoodCourtProps {
  t: T;
  picture: Picture;
  motionOK: boolean;
  /** Trays become "delete" buttons. */
  onDeleteTray?: ((tray: Tray) => void) | undefined;
  /** Stalls get a "close stall" (kill node) / "open again" button. */
  onToggleStall?: ((stall: Stall) => void) | undefined;
  /** Stalls whose kubelet the learner stopped. */
  downStalls?: string[];
  /** Tray names to glow once (new or replaced). */
  glow?: string[];
  /** Hide the control-plane stall when it has no trays. */
  compact?: boolean;
}

function TrayIcon({ state }: { state: Tray['state'] }) {
  if (state === 'ready' || state === 'done')
    return (
      <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false">
        <path d="M2 6.5 5 9.5 10 3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  if (state === 'failed') return <WarnIcon />;
  if (state === 'terminating')
    return (
      <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false">
        <path d="M3 3l6 6M9 3 3 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  return (
    <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false">
      <circle cx="6" cy="6" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M6 3.5V6l1.8 1.2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function StallIcon() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false">
      <path d="M2 7 4 3h12l2 4H2Z" fill="currentColor" opacity=".85" />
      <path d="M3 8h14v9H3z" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 17v-5h4v5" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

/** "shop-7d9c8b6f5d-x2b4k" → "x2b4k" (the part that changes), keeping short names whole. */
export function shortName(name: string): string {
  const parts = name.split('-');
  return parts.length >= 3 ? `${parts[0]}·${parts[parts.length - 1]}` : name;
}

export function trayLabel(t: T, tray: Tray, stall?: string): string {
  return t('kube.tray.label', { name: tray.name, status: tray.status, ready: tray.ready, restarts: String(tray.restarts), stall: stall ?? t('kube.court.noStall') });
}

function TrayChip({ t, tray, stall, motionOK, onDelete, glow }: { t: T; tray: Tray; stall?: string; motionOK: boolean; onDelete?: ((tray: Tray) => void) | undefined; glow: boolean }) {
  const label = trayLabel(t, tray, stall);
  const body = (
    <>
      <span className="kube-tray-icon">
        <TrayIcon state={tray.state} />
      </span>
      <span className="kube-tray-name">{shortName(tray.name)}</span>
      {tray.restarts > 0 && <span className="kube-tray-restarts">↻{tray.restarts}</span>}
      {tray.state === 'failed' || tray.state === 'starting' || tray.state === 'pending' ? <span className="kube-tray-status">{tray.status}</span> : null}
    </>
  );
  return (
    <motion.li
      layout={motionOK ? 'position' : false}
      initial={motionOK ? { opacity: 0, scale: 0.6 } : false}
      animate={{ opacity: tray.state === 'terminating' ? 0.55 : 1, scale: 1 }}
      exit={motionOK ? { opacity: 0, scale: 0.6, transition: { duration: 0.4 } } : { opacity: 0, transition: { duration: 0 } }}
      transition={{ duration: motionOK ? 0.45 : 0 }}
      className={cx('kube-tray', `kube-tray-${tray.state}`, glow && motionOK && 'is-glow')}
      title={tray.name}
    >
      {onDelete && tray.state !== 'terminating' ? (
        <button type="button" className="kube-tray-btn" onClick={() => onDelete(tray)}>
          <span className="visually-hidden">{t('kube.tray.delete', { name: tray.name })}: </span>
          {body}
          <span className="kube-danger-dot" aria-hidden="true">
            <WarnIcon />
          </span>
        </button>
      ) : (
        <span className="kube-tray-body" role="img" aria-label={label}>
          {body}
        </span>
      )}
    </motion.li>
  );
}

export default function FoodCourt({ t, picture, motionOK, onDeleteTray, onToggleStall, downStalls = [], glow = [], compact }: FoodCourtProps) {
  const stalls = picture.stalls.filter((s) => !compact || s.role === 'worker' || s.trays.length);
  const trays = picture.stalls.flatMap((s) => s.trays.filter((x) => !x.system));
  const ready = trays.filter((x) => x.state === 'ready').length;
  const summary = t('kube.court.summary', { stalls: String(picture.stalls.length), trays: String(trays.length), ready: String(ready), waiting: String(picture.waiting.length) });
  return (
    <figure className="kube-court" aria-label={t('kube.court.label')}>
      <figcaption className="visually-hidden">{summary}</figcaption>
      {picture.gateways.map((g) => (
        <div key={g.name} className={cx('kube-entrance', !g.programmed && 'is-waiting')}>
          <span className="kube-entrance-title">
            {t('kube.court.entrance')} <code>{g.name}</code> {g.address && <code className="kube-muted">{g.address}</code>}
          </span>
          <span className="kube-entrance-routes">
            {g.routes.map((r) => (
              <span key={`${r.path}-${r.service}`} className="kube-route">
                <code>{r.path}</code> → <code>{r.service}</code>
              </span>
            ))}
          </span>
        </div>
      ))}
      {picture.services.length > 0 && (
        <ul className="kube-orders" aria-label={t('kube.court.orders')}>
          {picture.services.map((s) => (
            <li key={`${s.namespace}/${s.name}`} className={cx('kube-order', s.ready === 0 && 'is-empty')} aria-label={t('kube.order.label', { name: s.name, ready: String(s.ready), total: String(s.total) })}>
              <span className="kube-order-tag" aria-hidden="true">
                #
              </span>
              <code>{s.name}</code>
              <span className="kube-order-count">{t('kube.order.count', { ready: String(s.ready), total: String(s.total) })}</span>
              {s.ready === 0 && (
                <span className="kube-order-warn">
                  <WarnIcon /> {t('kube.order.none')}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="kube-stalls">
        {stalls.map((s) => {
          const down = downStalls.includes(s.name);
          const mine = s.trays.filter((x) => !x.system);
          return (
            <section key={s.name} className={cx('kube-stall', s.ready !== 'ready' && 'is-down', s.cordoned && 'is-cordoned', s.role === 'control-plane' && 'is-cp')} aria-label={t('kube.stall.label', { name: s.name, status: t(`kube.stall.${s.ready}`), count: String(mine.length) })}>
              <header className="kube-stall-head">
                <span className="kube-stall-icon">
                  <StallIcon />
                </span>
                <code className="kube-stall-name">{s.name}</code>
                <span className={cx('kube-chip', s.ready === 'ready' ? 'kube-chip-ok' : 'kube-chip-bad')}>
                  {s.ready !== 'ready' && <WarnIcon />}
                  {t(`kube.stall.${s.ready}`)}
                </span>
                {s.cordoned && <span className="kube-chip kube-chip-wait">{t('kube.stall.cordoned')}</span>}
                {s.role === 'control-plane' && <span className="kube-chip">{t('kube.stall.manager')}</span>}
                {onToggleStall && s.role === 'worker' && (
                  <button type="button" className={cx('btn btn-quiet kube-stall-btn', !down && 'kube-danger-btn')} onClick={() => onToggleStall(s)}>
                    {!down && <WarnIcon />} {down ? t('kube.stall.open') : t('kube.stall.close')}
                  </button>
                )}
              </header>
              {mine.length ? (
                <ul className="kube-trays">
                  <AnimatePresence initial={false}>
                    {mine.map((x) => (
                      <TrayChip key={x.name} t={t} tray={x} stall={s.name} motionOK={motionOK} onDelete={onDeleteTray} glow={glow.includes(x.name)} />
                    ))}
                  </AnimatePresence>
                </ul>
              ) : (
                <p className="kube-empty">{t('kube.stall.empty')}</p>
              )}
            </section>
          );
        })}
      </div>
      {picture.waiting.filter((x) => !x.system).length > 0 && (
        <section className="kube-queue" aria-label={t('kube.court.queue')}>
          <span className="kube-queue-title">{t('kube.court.queue')}</span>
          <ul className="kube-trays">
            <AnimatePresence initial={false}>
              {picture.waiting
                .filter((x) => !x.system)
                .map((x) => (
                  <TrayChip key={x.name} t={t} tray={x} motionOK={motionOK} onDelete={onDeleteTray} glow={glow.includes(x.name)} />
                ))}
            </AnimatePresence>
          </ul>
        </section>
      )}
    </figure>
  );
}
