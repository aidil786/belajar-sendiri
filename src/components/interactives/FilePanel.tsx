// File panel: edit files by clicking, no typing of echo commands needed.
import { useState } from 'react';
import { findRepo, workingTree, type SimState } from '~/engine/git-sim';
import type { T } from './shared';

export default function FilePanel({ t, state, onSave }: { t: T; state: SimState; onSave: (path: string, content: string) => void }) {
  const repo = findRepo(state);
  const files = repo ? workingTree(state, repo) : {};
  const names = Object.keys(files).sort();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  if (!repo) return null;
  const abs = (p: string) => `${repo.root}/${p}`;
  return (
    <details className="file-panel">
      <summary>
        {t('term.files')} ({names.length})
      </summary>
      <ul className="file-list">
        {names.map((p) => (
          <li key={p} className="file-row">
            <code>{p}</code>
            {editing === p ? (
              <form
                className="file-edit"
                onSubmit={(e) => {
                  e.preventDefault();
                  onSave(abs(p), draft.endsWith('\n') || draft === '' ? draft : `${draft}\n`);
                  setEditing(null);
                }}
              >
                <label className="visually-hidden" htmlFor={`edit-${p}`}>
                  {t('term.editLabel', { file: p })}
                </label>
                <textarea id={`edit-${p}`} value={draft} rows={4} onChange={(e) => setDraft(e.target.value)} />
                <div className="file-edit-actions">
                  <button type="submit" className="btn">
                    {t('term.save')}
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={() => setEditing(null)}>
                    {t('term.cancel')}
                  </button>
                </div>
              </form>
            ) : (
              <span className="file-actions">
                <button
                  type="button"
                  className="btn btn-ghost file-btn"
                  onClick={() => {
                    setEditing(p);
                    setDraft(files[p] ?? '');
                  }}
                >
                  {t('term.edit')}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost file-btn"
                  onClick={() => onSave(abs(p), `${files[p] ?? ''}new line ${(files[p] ?? '').split('\n').length}\n`)}
                >
                  + {t('term.addLine')}
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}
