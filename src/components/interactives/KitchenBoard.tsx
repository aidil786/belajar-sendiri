// The kitchen's state picture (Ship It rule 16: show the state after every command).
// Your laptop with its open hatches (ports), containers as lunchboxes, images as stacked
// layers, volumes as lockers, networks as phone lines, and the registry (the shop freezer).
// Colour = state (green running, amber created/paused, grey stopped, red + icon failed); shape = thing.
import { AnimatePresence, motion } from 'motion/react';
import type { ReactNode } from 'react';
import type { BoxState, Picture, PictureContainer } from '~/engine/kitchen-sim';
import { DangerIcon } from './AreaIcons';
import { cx, type T } from './shared';
import './kitchen.css';

const SVG = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };

export function LaptopIcon() {
  return (
    <svg {...SVG}>
      <rect x="4" y="5" width="16" height="11" rx="1.5" />
      <path d="M2 19h20" />
    </svg>
  );
}

/** A lunchbox: a box with a lid and a clip. */
export function LunchboxIcon() {
  return (
    <svg {...SVG}>
      <rect x="3" y="8" width="18" height="12" rx="2" />
      <path d="M3 12h18" />
      <path d="M9 8V6a3 3 0 0 1 6 0v2" />
    </svg>
  );
}

/** Stacked layers: kek lapis. */
export function LayersIcon() {
  return (
    <svg {...SVG}>
      <path d="M12 3l9 4.5-9 4.5-9-4.5z" />
      <path d="M3 12l9 4.5 9-4.5" />
      <path d="M3 16.5l9 4.5 9-4.5" />
    </svg>
  );
}

export function LockerIcon() {
  return (
    <svg {...SVG}>
      <rect x="5" y="3" width="14" height="18" rx="1.5" />
      <path d="M9 7h6M9 10h6" />
      <circle cx="15" cy="15" r="1" />
    </svg>
  );
}

/** Two phones joined by a line. */
export function PhoneLineIcon() {
  return (
    <svg {...SVG}>
      <rect x="2" y="9" width="5" height="8" rx="1" />
      <rect x="17" y="9" width="5" height="8" rx="1" />
      <path d="M7 13c3-4 7-4 10 0" />
    </svg>
  );
}

export function HatchIcon() {
  return (
    <svg {...SVG}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M8 19V11h8v8" />
    </svg>
  );
}

export function FreezerIcon() {
  return (
    <svg {...SVG}>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M4 10h16" />
      <path d="M12 5.5v2.5M10.8 6.2l2.4 1.4M13.2 6.2l-2.4 1.4" />
    </svg>
  );
}

function stateText(t: T, c: PictureContainer): string {
  const base = c.state === 'failed' ? t('kitchen.state.failed', { code: c.exitCode }) : t(`kitchen.state.${c.state}`);
  return c.health ? `${base} · ${t(`kitchen.health.${c.health}`)}` : base;
}

const STATE_CLASS: Record<BoxState, string> = {
  running: 'is-running',
  paused: 'is-waiting',
  created: 'is-waiting',
  restarting: 'is-waiting',
  exited: 'is-stopped',
  failed: 'is-failed',
};

function Item({ motionOK, children, id }: { motionOK: boolean; children: ReactNode; id: string }) {
  return (
    <motion.li
      key={id}
      layout={motionOK}
      initial={motionOK ? { opacity: 0, scale: 0.92 } : false}
      animate={{ opacity: 1, scale: 1 }}
      exit={motionOK ? { opacity: 0, scale: 0.92 } : { opacity: 0 }}
      transition={{ duration: motionOK ? 0.32 : 0 }}
    >
      {children}
    </motion.li>
  );
}

export default function KitchenBoard({ t, picture, motionOK }: { t: T; picture: Picture; motionOK: boolean }) {
  const p = picture;
  const running = p.containers.filter((c) => c.state === 'running').length;
  return (
    <div className="kitchen" role="region" aria-label={t('kitchen.board')}>
      <section className="kb-zone kb-laptop" aria-label={t('kitchen.laptop')}>
        <h4 className="kb-head">
          <LaptopIcon />
          <span>{t('kitchen.laptop')}</span>
          <code className="kb-cwd">{p.laptop.cwd.replace(/^\/home\/you/, '~')}</code>
        </h4>
        <ul className="kb-list kb-hatches" aria-label={t('kitchen.hatches')}>
          <AnimatePresence initial={false}>
            {p.laptop.ports.map((h) => (
              <Item key={`${h.host}`} id={`${h.host}`} motionOK={motionOK}>
                <span className="kb-hatch">
                  <HatchIcon />
                  <span className="visually-hidden">{t('kitchen.hatch', { host: h.host, name: h.container, port: h.containerPort })}</span>
                  <span aria-hidden="true">
                    <b>{h.host}</b> → {h.container}:{h.containerPort}
                  </span>
                </span>
              </Item>
            ))}
          </AnimatePresence>
          {!p.laptop.ports.length && <li className="kb-empty">{t('kitchen.noHatches')}</li>}
        </ul>
      </section>

      <section className="kb-zone kb-containers" aria-label={t('kitchen.containers')}>
        <h4 className="kb-head">
          <LunchboxIcon />
          <span>{t('kitchen.containers')}</span>
        </h4>
        <ul className="kb-list">
          <AnimatePresence initial={false}>
            {p.containers.map((c) => (
              <Item key={c.id} id={c.id} motionOK={motionOK}>
                <div className={cx('kb-box', STATE_CLASS[c.state])}>
                  <div className="kb-box-top">
                    {c.state === 'failed' ? <DangerIcon size={18} /> : <LunchboxIcon />}
                    <span className="kb-name">{c.name}</span>
                    <span className="kb-state">{stateText(t, c)}</span>
                  </div>
                  <div className="kb-meta">
                    <span>{t('kitchen.from', { image: c.image })}</span>
                    {c.ports.map((pt) => (
                      <span key={pt.host} className="kb-chip">
                        <HatchIcon /> {pt.host}→{pt.container}
                      </span>
                    ))}
                    {c.networks.filter((n) => n !== 'bridge').map((n) => (
                      <span key={n} className="kb-chip">
                        <PhoneLineIcon /> {n}
                      </span>
                    ))}
                    {c.volumes.map((v) => (
                      <span key={`${v.name}${v.target}`} className="kb-chip">
                        <LockerIcon /> {v.anonymous ? t('kitchen.anonymous') : v.bind ? v.name.replace(/^\/home\/you/, '~') : v.name} → {v.target}
                      </span>
                    ))}
                  </div>
                </div>
              </Item>
            ))}
          </AnimatePresence>
          {!p.containers.length && <li className="kb-empty">{t('kitchen.noContainers')}</li>}
        </ul>
      </section>

      <section className="kb-zone kb-images" aria-label={t('kitchen.images')}>
        <h4 className="kb-head">
          <LayersIcon />
          <span>{t('kitchen.images')}</span>
        </h4>
        <ul className="kb-list kb-shelf">
          <AnimatePresence initial={false}>
            {p.images.map((img) => (
              <Item key={img.ref} id={img.ref} motionOK={motionOK}>
                <div className={cx('kb-pack', img.used && 'is-used')}>
                  <span className="kb-stack" aria-hidden="true">
                    {Array.from({ length: Math.min(5, Math.max(1, img.layers)) }, (_, i) => (
                      <span key={i} className="kb-layer" />
                    ))}
                  </span>
                  <span className="kb-name">{img.ref}</span>
                  <span className="kb-small">
                    {t('kitchen.layers', { n: img.layers, size: img.size })}
                    {img.used ? ` · ${t('kitchen.inUse')}` : ''}
                  </span>
                </div>
              </Item>
            ))}
          </AnimatePresence>
          {!p.images.length && <li className="kb-empty">{t('kitchen.noImages')}</li>}
        </ul>
      </section>

      {(p.volumes.length > 0 || p.networks.some((n) => !n.builtin)) && (
        <section className="kb-zone kb-storage" aria-label={`${t('kitchen.volumes')}, ${t('kitchen.networks')}`}>
          {p.volumes.length > 0 && (
            <>
              <h4 className="kb-head">
                <LockerIcon />
                <span>{t('kitchen.volumes')}</span>
              </h4>
              <ul className="kb-list">
                {p.volumes.map((v) => (
                  <li key={v.name} className="kb-locker">
                    <span className="kb-name">{v.anonymous ? `${v.name.slice(0, 12)}… (${t('kitchen.anonymous')})` : v.name}</span>
                    <span className="kb-small">
                      {t('kitchen.files', { n: v.files })}
                      {v.usedBy.length ? ` · ${t('kitchen.usedBy', { names: v.usedBy.join(', ') })}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {p.networks.some((n) => !n.builtin) && (
            <>
              <h4 className="kb-head">
                <PhoneLineIcon />
                <span>{t('kitchen.networks')}</span>
              </h4>
              <ul className="kb-list">
                {p.networks.filter((n) => !n.builtin).map((n) => (
                  <li key={n.name} className="kb-line">
                    <span className="kb-name">{n.name}</span>
                    <span className="kb-small">{n.containers.join(' ↔ ') || '—'}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      {(p.registry.length > 0 || p.loggedIn) && (
        <section className="kb-zone kb-registry" aria-label={t('kitchen.registry')}>
          <h4 className="kb-head">
            <FreezerIcon />
            <span>{t('kitchen.registry')}</span>
          </h4>
          {p.loggedIn && <p className="kb-small">{t('kitchen.loggedIn', { user: p.loggedIn })}</p>}
          <ul className="kb-list">
            {p.registry.map((r) => (
              <li key={r.ref} className="kb-chip">
                <LayersIcon /> {r.ref}
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="visually-hidden">
        {t('kitchen.summary', { containers: p.containers.length, running, images: p.images.length, volumes: p.volumes.length })}
      </p>
    </div>
  );
}
