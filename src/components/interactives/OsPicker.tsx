// Pick your computer (Windows / macOS / Linux) and get tailored steps as a mission.
import { useEffect, useState } from 'react';
import type { Lang } from '~/i18n';
import { MissionList, type MissionStep } from './Mission';
import { cx, useCardEvents, useT } from './shared';
import './widgets.css';

type OS = 'windows' | 'macos' | 'linux';

export interface OsPickerProps {
  lang: Lang;
  id: string;
  options: { os: OS; steps: MissionStep[] }[];
}

function guessOS(): OS | null {
  if (typeof navigator === 'undefined') return null;
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('win')) return 'windows';
  if (ua.includes('mac')) return 'macos';
  if (ua.includes('linux') && !ua.includes('android')) return 'linux';
  return null;
}

export default function OsPicker({ lang, id, options }: OsPickerProps) {
  const t = useT(lang);
  const { ref, emit } = useCardEvents();
  const [os, setOs] = useState<OS | null>(null);
  const [guess, setGuess] = useState<OS | null>(null);
  useEffect(() => setGuess(guessOS()), []);
  const current = options.find((o) => o.os === os);

  return (
    <div className="ospicker" ref={ref}>
      <p className="interactive-help">{t('os.pick')}</p>
      <div className="ospicker-btns" role="group" aria-label={t('os.pick')}>
        {options.map((o) => (
          <button key={o.os} type="button" className={cx('btn', os === o.os ? '' : 'btn-ghost')} aria-pressed={os === o.os} onClick={() => setOs(o.os)}>
            {t(`os.${o.os}`)}
            {guess === o.os && os === null && <span aria-hidden="true"> ★</span>}
          </button>
        ))}
      </div>
      {current && <MissionList key={current.os} lang={lang} id={`${id}-${current.os}`} steps={current.steps} onDone={() => emit('fl:done')} />}
    </div>
  );
}
