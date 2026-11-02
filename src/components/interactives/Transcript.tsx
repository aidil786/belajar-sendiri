// A static, real-looking terminal for tools the simulator doesn't run (gh, ssh-keygen, npm…).
// Lines appear one by one once when shown (all at once in calm / reduced motion). Replayable.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Lang } from '~/i18n';
import { cx, useMotionOK, useT } from './shared';
import './quiz.css';
import './transcript.css';

export interface TranscriptLine {
  cmd?: string;
  out?: string;
  color?: 'green' | 'red' | 'yellow' | 'cyan' | 'dim';
}

export interface TranscriptProps {
  lang: Lang;
  lines: TranscriptLine[];
  /** Text alternative: what the transcript shows, in plain words. */
  label: string;
  prompt?: string;
  title?: string;
}

type Row = { kind: 'cmd'; text: string } | { kind: 'out'; text: string; color?: TranscriptLine['color'] };

export function transcriptRows(lines: TranscriptLine[]): Row[] {
  const rows: Row[] = [];
  for (const l of lines) {
    if (l.cmd !== undefined) rows.push({ kind: 'cmd', text: l.cmd });
    if (l.out !== undefined) for (const text of l.out.split('\n')) rows.push({ kind: 'out', text, color: l.color });
  }
  return rows;
}

export default function Transcript({ lang, lines, label, prompt = '$', title }: TranscriptProps) {
  const t = useT(lang);
  const motionOK = useMotionOK();
  const rows = useMemo(() => transcriptRows(lines), [lines]);
  const [shown, setShown] = useState(rows.length);
  const [copied, setCopied] = useState<number | null>(null);
  const screen = useRef<HTMLDivElement>(null);
  const started = useRef(false);
  const timers = useRef<number[]>([]);

  const play = () => {
    timers.current.forEach((id) => window.clearTimeout(id));
    timers.current = [];
    setShown(0);
    let at = 250;
    rows.forEach((r, i) => {
      at += r.kind === 'cmd' ? 450 : 90;
      timers.current.push(window.setTimeout(() => setShown(i + 1), at));
    });
  };

  useEffect(() => {
    if (!motionOK) return;
    const node = screen.current;
    if (!node) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && !started.current) {
        started.current = true;
        play();
      }
    });
    io.observe(node);
    return () => {
      io.disconnect();
      timers.current.forEach((id) => window.clearTimeout(id));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [motionOK, rows]);

  const copy = async (i: number, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(i);
      window.setTimeout(() => setCopied((c) => (c === i ? null : c)), 1500);
    } catch {
      /* clipboard blocked: the command is still visible to copy by hand */
    }
  };

  const visible = motionOK ? shown : rows.length;

  return (
    <figure className="transcript">
      <div className="transcript-bar">
        <span className="transcript-dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        <span className="transcript-title">{title ?? t('transcript.window')}</span>
      </div>
      <div className="replay transcript-screen" ref={screen}>
        {rows.map((r, i) => (
          <div key={i} className={cx('replay-line transcript-line', i >= visible && 'replay-hidden')}>
            {r.kind === 'cmd' ? (
              <>
                <span className="transcript-text">
                  <span className="replay-prompt" aria-hidden="true">
                    {prompt}{' '}
                  </span>
                  <span className="replay-cmd">{r.text}</span>
                </span>
                <button
                  type="button"
                  className="transcript-copy"
                  aria-label={t('transcript.copyLabel', { cmd: r.text })}
                  onClick={() => copy(i, r.text)}
                >
                  {copied === i ? t('transcript.copied') : t('transcript.copy')}
                </button>
              </>
            ) : (
              <span className={cx('transcript-text', r.color && `seg-${r.color}`)}>{r.text || ' '}</span>
            )}
          </div>
        ))}
      </div>
      <figcaption className="visually-hidden">{label}</figcaption>
      {motionOK && (
        <button type="button" className="btn btn-ghost scene-btn" onClick={play}>
          ↺ {t('anim.replay')}
        </button>
      )}
    </figure>
  );
}
