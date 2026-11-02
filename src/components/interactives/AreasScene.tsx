// Concept animation: files move between working folder, staging box and repository.
// Plays once when shown; always replayable. In calm mode or with reduced motion
// it shows a static before/after view instead.
import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { Lang } from '~/i18n';
import { FileIcon, TickIcon, ZoneIcon, type Zone } from './AreaIcons';
import { cx, useMotionOK, useT } from './shared';
import './areas.css';

export interface Chip {
  name: string;
  tag?: 'ready' | 'notReady' | 'new' | 'changed' | 'deleted';
  tick?: boolean;
  glow?: boolean;
  kind?: 'file' | 'commit';
}
export type ChipInput = string | Chip;
export type Frame = Partial<Record<Zone, ChipInput[]>>;

export interface AreasSceneProps {
  lang: Lang;
  frames: Frame[];
  zones?: Zone[];
  command?: string;
  effect?: 'wobble' | 'flash';
  /** Text alternative describing what moves. */
  label: string;
  /** Optional per-zone label override, e.g. "Desk". */
  zoneLabels?: Partial<Record<Zone, string>>;
}

const norm = (c: ChipInput): Chip => (typeof c === 'string' ? { name: c } : c);

export function ChipView({ chip, t, wobble }: { chip: Chip; t: (k: string) => string; wobble?: boolean }) {
  const isCommit = chip.kind === 'commit';
  return (
    <span className={cx('area-chip', isCommit && 'area-chip-commit', chip.glow && 'is-glow', wobble && 'is-wobble')}>
      {isCommit ? <ZoneIcon zone="repo" size={16} /> : <FileIcon />}
      <span className="area-chip-name">{chip.name}</span>
      {chip.tick && (
        <span className="area-chip-tick" title={t('areas.ready')}>
          <TickIcon />
          <span className="visually-hidden">{t('areas.ready')}</span>
        </span>
      )}
      {chip.tag && chip.tag !== 'ready' && <span className="area-chip-tag">{t(`areas.${chip.tag}`)}</span>}
    </span>
  );
}

export default function AreasScene({ lang, frames, zones, command, effect, label, zoneLabels }: AreasSceneProps) {
  const t = useT(lang);
  const motionOK = useMotionOK();
  const shownZones: Zone[] = zones ?? ['working', 'staging', 'repo'];
  const last = frames.length - 1;
  const [frame, setFrame] = useState(0);
  const [typed, setTyped] = useState(command ? '' : undefined);
  const [flash, setFlash] = useState(false);
  const [playing, setPlaying] = useState(false);
  const timers = useRef<number[]>([]);
  const rootRef = useRef<HTMLElement>(null);
  const playedOnce = useRef(false);
  const uid = useId();

  const clear = () => {
    timers.current.forEach((id) => window.clearTimeout(id));
    timers.current = [];
  };

  const play = useCallback(() => {
    clear();
    setFrame(0);
    setFlash(false);
    setPlaying(true);
    let at = 500;
    if (command) {
      setTyped('');
      for (let i = 1; i <= command.length; i++) {
        timers.current.push(window.setTimeout(() => setTyped(command.slice(0, i)), at));
        at += 40;
      }
      at += 300;
    }
    for (let f = 1; f <= last; f++) {
      const isLast = f === last;
      timers.current.push(
        window.setTimeout(() => {
          setFrame(f);
          if (effect === 'flash' && isLast) {
            setFlash(true);
            timers.current.push(window.setTimeout(() => setFlash(false), 350));
          }
        }, at),
      );
      at += 900;
    }
    timers.current.push(window.setTimeout(() => setPlaying(false), at));
  }, [command, effect, last]);

  // Play once, the first time the card is on screen.
  useEffect(() => {
    if (!motionOK) {
      setFrame(last);
      setTyped(command);
      return;
    }
    const el = rootRef.current;
    if (!el || playedOnce.current) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && !playedOnce.current) {
        playedOnce.current = true;
        play();
      }
    });
    io.observe(el);
    return () => {
      io.disconnect();
      clear();
    };
  }, [motionOK, play, last, command]);

  const current = frames[frame] ?? {};
  const wobble = effect === 'wobble' && frame === 0 && motionOK;

  return (
    <figure className="areas-scene" ref={rootRef}>
      <figcaption className="visually-hidden">{label}</figcaption>
      {command !== undefined && (
        <div className="scene-command" aria-hidden="true">
          <span className="scene-prompt">$</span> <code>{typed}</code>
          {playing && typed !== command && <span className="scene-caret" />}
        </div>
      )}
      <LayoutGroup id={uid}>
        <div className={cx('areas', `areas-${shownZones.length}`)} aria-hidden="true">
          {shownZones.map((zone) => {
            const chips = (current[zone] ?? []).map(norm);
            return (
              <div key={zone} className={cx('area', `area-${zone}`, flash && zone !== 'working' && 'is-flash')}>
                <div className="area-head">
                  <ZoneIcon zone={zone} />
                  <span>{zoneLabels?.[zone] ?? t(`areas.${zone}`)}</span>
                </div>
                <ul className="area-list">
                  <AnimatePresence initial={false}>
                    {chips.map((chip) => (
                      <motion.li
                        key={chip.name}
                        layoutId={`${uid}-${chip.name}`}
                        layout={motionOK}
                        initial={chip.kind === 'commit' && motionOK ? { opacity: 0, x: -60, scale: 0.6 } : false}
                        animate={{ opacity: 1, x: 0, scale: 1 }}
                        exit={motionOK ? { opacity: 0, scale: 0.8 } : { opacity: 0 }}
                        transition={{ duration: motionOK ? 0.6 : 0, ease: [0.22, 1, 0.36, 1] }}
                      >
                        <ChipView chip={chip} t={t} wobble={wobble} />
                      </motion.li>
                    ))}
                  </AnimatePresence>
                  {chips.length === 0 && <li className="area-empty">{t('areas.empty')}</li>}
                </ul>
              </div>
            );
          })}
        </div>
      </LayoutGroup>
      <div className="scene-controls">
        {motionOK ? (
          <button type="button" className="btn btn-ghost scene-btn" onClick={play}>
            ↺ {t('anim.replay')}
          </button>
        ) : (
          last > 0 && (
            <button
              type="button"
              className="btn btn-ghost scene-btn"
              aria-pressed={frame === 0}
              onClick={() => setFrame(frame === 0 ? last : 0)}
            >
              {frame === 0 ? t('anim.showAfter') : t('anim.showBefore')}
            </button>
          )
        )}
        {!motionOK && last > 0 && <span className="scene-state">{frame === 0 ? t('anim.before') : t('anim.after')}</span>}
      </div>
    </figure>
  );
}
