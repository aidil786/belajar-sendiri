// Try-it: drag files between the areas (or tap a file, then tap an area).
// A wrong move bounces back with a kind message. The matching command appears.
import { LayoutGroup, motion } from 'motion/react';
import { useId, useRef, useState } from 'react';
import type { Lang } from '~/i18n';
import { ZoneIcon, type Zone } from './AreaIcons';
import { ChipView, type Chip } from './AreasScene';
import { Announce, Feedback, cx, pickPraise, useCardEvents, useLearnerName, useMotionOK, useT } from './shared';
import './areas.css';

export interface DragItem extends Chip {
  target: Zone;
  /** Message when dropped in the wrong area. Default: "Not ready yet!" */
  wrong?: string;
}

export interface DragToAreaProps {
  lang: Lang;
  items: DragItem[];
  zones?: Zone[];
  start?: Zone;
  /** Shown when everything is in place. */
  success?: string;
}

const COMMAND: Record<string, (f: string) => string> = {
  'working>staging': (f) => `git add ${f}`,
  'staging>working': (f) => `git restore --staged ${f}`,
  'staging>repo': () => 'git commit -m "…"',
};

export default function DragToArea({ lang, items, zones = ['working', 'staging'], start = 'working', success }: DragToAreaProps) {
  const t = useT(lang);
  const name = useLearnerName();
  const motionOK = useMotionOK();
  const { ref, emit } = useCardEvents();
  const uid = useId();
  const [where, setWhere] = useState<Record<string, Zone>>(() => Object.fromEntries(items.map((i) => [i.name, start])));
  const [picked, setPicked] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: 'right' | 'almost'; text: string } | null>(null);
  const [command, setCommand] = useState<string | null>(null);
  const [bounce, setBounce] = useState<string | null>(null);
  const [hover, setHover] = useState<Zone | null>(null);
  const [done, setDone] = useState(false);
  const [announce, setAnnounce] = useState('');
  const zoneRefs = useRef<Partial<Record<Zone, HTMLDivElement | null>>>({});
  const tries = useRef(0);

  const zoneAt = (x: number, y: number): Zone | null => {
    for (const z of zones) {
      const r = zoneRefs.current[z]?.getBoundingClientRect();
      if (r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return z;
    }
    return null;
  };

  const move = (itemName: string, to: Zone) => {
    const item = items.find((i) => i.name === itemName);
    const from = where[itemName];
    setPicked(null);
    if (!item || !from || from === to) return;
    tries.current++;
    if (item.target !== to) {
      setBounce(itemName);
      window.setTimeout(() => setBounce(null), 450);
      setMessage({ kind: 'almost', text: item.wrong ?? t('areas.notReadyYet') });
      setAnnounce(item.wrong ?? t('areas.notReadyYet'));
      emit('fl:wrong');
      return;
    }
    const next = { ...where, [itemName]: to };
    setWhere(next);
    setCommand(COMMAND[`${from}>${to}`]?.(itemName) ?? null);
    const allDone = items.every((i) => next[i.name] === i.target);
    setAnnounce(t('drag.placed', { item: itemName, zone: t(`areas.${to}`) }));
    if (allDone) {
      setDone(true);
      setMessage({ kind: 'right', text: success ?? pickPraise(t, name, tries.current) });
      emit('fl:done');
    } else setMessage(null);
  };

  return (
    <div className="drag-areas" ref={ref}>
      <p className="interactive-help">{picked ? t('areas.selected', { file: picked }) : t('areas.pickFile')}</p>
      <LayoutGroup id={uid}>
        <div className={cx('areas', `areas-${zones.length}`)}>
          {zones.map((zone) => {
            const here = items.filter((i) => where[i.name] === zone);
            return (
              <div
                key={zone}
                ref={(el) => {
                  zoneRefs.current[zone] = el;
                }}
                className={cx('area', `area-${zone}`, (hover === zone || (picked && where[picked] !== zone)) && 'is-drop-target')}
              >
                <button
                  type="button"
                  className="area-head area-drop"
                  disabled={!picked}
                  onClick={() => picked && move(picked, zone)}
                  aria-label={picked ? t('areas.moveTo', { file: picked, zone: t(`areas.${zone}`) }) : t(`areas.${zone}`)}
                >
                  <ZoneIcon zone={zone} />
                  <span>{t(`areas.${zone}`)}</span>
                </button>
                <ul className="area-list">
                  {here.map((item) => (
                    <motion.li key={item.name} layoutId={`${uid}-${item.name}`} layout={motionOK} transition={{ duration: motionOK ? 0.45 : 0 }}>
                      <motion.button
                        type="button"
                        className={cx('drag-chip', picked === item.name && 'is-picked', bounce === item.name && 'is-bounce')}
                        aria-pressed={picked === item.name}
                        disabled={done}
                        drag={!done}
                        dragSnapToOrigin
                        dragElastic={0.6}
                        whileDrag={{ scale: 1.06, zIndex: 5 }}
                        onDrag={(_, info) => setHover(zoneAt(info.point.x - window.scrollX, info.point.y - window.scrollY))}
                        onDragEnd={(_, info) => {
                          setHover(null);
                          const z = zoneAt(info.point.x - window.scrollX, info.point.y - window.scrollY);
                          if (z) move(item.name, z);
                        }}
                        onClick={() => setPicked(picked === item.name ? null : item.name)}
                      >
                        <ChipView chip={item} t={t} />
                      </motion.button>
                    </motion.li>
                  ))}
                  {here.length === 0 && <li className="area-empty">{t('areas.dropHere')}</li>}
                </ul>
              </div>
            );
          })}
        </div>
      </LayoutGroup>
      {command && (
        <p className="drag-command">
          <span className="visually-hidden">{t('areas.commandShown', { command })}</span>
          <code aria-hidden="true">$ {command}</code>
        </p>
      )}
      {message && <Feedback kind={message.kind}>{message.text}</Feedback>}
      <Announce text={announce} />
    </div>
  );
}
