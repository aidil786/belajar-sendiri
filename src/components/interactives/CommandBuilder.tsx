// Command builder: snap pieces together in order. Each piece shows its plain meaning.
import { useMemo, useState } from 'react';
import type { Lang } from '~/i18n';
import { Feedback, pickPraise, seededShuffle, useCardEvents, useLearnerName, useT } from './shared';
import './widgets.css';

interface Piece {
  text: string;
  means: string;
}

export interface CommandBuilderProps {
  lang: Lang;
  pieces: Piece[];
  decoys?: Piece[];
  success?: string;
}

export default function CommandBuilder({ lang, pieces, decoys = [], success }: CommandBuilderProps) {
  const t = useT(lang);
  const name = useLearnerName();
  const { ref, emit } = useCardEvents();
  const pool = useMemo(() => seededShuffle([...pieces, ...decoys], pieces.map((p) => p.text).join(' ')), [pieces, decoys]);
  const [built, setBuilt] = useState<Piece[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [tries, setTries] = useState(0);
  const done = built.length === pieces.length;

  const tap = (p: Piece) => {
    if (done) return;
    setTries((n) => n + 1);
    const want = pieces[built.length]!;
    if (p.text === want.text) {
      const next = [...built, p];
      setBuilt(next);
      setMsg(null);
      if (next.length === pieces.length) emit('fl:done');
    } else {
      setMsg(`${t('feedback.almost')} ${want.means}`);
      emit('fl:wrong');
    }
  };

  // A real piece is used up once it's in the command as often as it's needed. Decoys stay tappable.
  const used = (p: Piece) => {
    const need = pieces.filter((x) => x.text === p.text).length;
    return need > 0 && built.filter((b) => b.text === p.text).length >= need;
  };

  return (
    <div className="builder" ref={ref}>
      <p className="interactive-help">{t('builder.instructions')}</p>
      <div className="builder-out" aria-label={t('builder.yourCommand')} aria-live="polite">
        <span className="scene-prompt" aria-hidden="true">
          ${' '}
        </span>
        {built.length === 0 && <span className="builder-placeholder">…</span>}
        {built.map((p, i) => (
          <span key={i} className="builder-piece-out">
            <code>{p.text}</code>
            <small>{p.means}</small>
          </span>
        ))}
      </div>
      <div className="builder-pool">
        {pool.map((p, i) => (
          <button key={i} type="button" className="builder-piece" disabled={done || used(p)} onClick={() => tap(p)} title={p.means}>
            <code>{p.text}</code>
          </button>
        ))}
      </div>
      {!done && built.length > 0 && (
        <div className="builder-tools">
          <button type="button" className="btn btn-quiet" onClick={() => setBuilt(built.slice(0, -1))}>
            {t('builder.undo')}
          </button>
          <button type="button" className="btn btn-quiet" onClick={() => setBuilt([])}>
            {t('builder.clear')}
          </button>
        </div>
      )}
      {msg && !done && <Feedback kind="almost">{msg}</Feedback>}
      {done && <Feedback kind="right">{success ?? pickPraise(t, name, tries)}</Feedback>}
    </div>
  );
}
