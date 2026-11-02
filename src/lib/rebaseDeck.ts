// Pure logic for the RebaseDeck: interactive rebase as a deck of commit cards.
// The engine does the real work (rebaseTodo / rebaseInteractive); this file only
// edits the deck and turns goal results into kind feedback keys.
import { findRepo, headId, history, subject, workingTree, type RebaseAction, type SimState, type TodoItem } from '~/engine/git-sim';

export const ACTIONS: RebaseAction[] = ['pick', 'reword', 'squash', 'fixup', 'drop'];

export interface DeckCard {
  commit: string;
  short: string;
  message: string;
  action: RebaseAction;
  /** New message for reword (and, optionally, squash). */
  newMessage: string;
}

/** Cards from `rebaseTodo`, oldest at the top (like Git's todo list). */
export function deckFromTodo(todo: TodoItem[]): DeckCard[] {
  return todo.map((t) => ({ commit: t.commit, short: t.short, message: t.message, action: 'pick', newMessage: '' }));
}

export function moveCard(cards: DeckCard[], i: number, dir: -1 | 1): DeckCard[] {
  const j = i + dir;
  if (i < 0 || j < 0 || i >= cards.length || j >= cards.length) return cards;
  const next = [...cards];
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
}

export function setAction(cards: DeckCard[], i: number, action: RebaseAction): DeckCard[] {
  return cards.map((c, k) => (k === i ? { ...c, action, newMessage: action === 'reword' && !c.newMessage ? c.message : c.newMessage } : c));
}

export function setMessage(cards: DeckCard[], i: number, newMessage: string): DeckCard[] {
  return cards.map((c, k) => (k === i ? { ...c, newMessage } : c));
}

/** The todo the engine runs. Reword keeps the old message if the new one is empty. */
export function toSteps(cards: DeckCard[]): { action: RebaseAction; commit: string; message?: string }[] {
  return cards.map((c) => {
    const msg = c.newMessage.trim();
    if (c.action === 'reword') return { action: 'reword', commit: c.commit, message: msg || c.message };
    if (c.action === 'squash' && msg) return { action: 'squash', commit: c.commit, message: msg };
    return { action: c.action, commit: c.commit };
  });
}

export type DeckProblem = { kind: 'squashFirst'; index: number; action: RebaseAction } | { kind: 'allDropped' } | { kind: 'unchanged' };

/** Problems we can explain before running anything. */
export function deckProblem(cards: DeckCard[], start: DeckCard[]): DeckProblem | null {
  const first = cards.findIndex((c) => c.action !== 'drop');
  if (first === -1) return { kind: 'allDropped' };
  const a = cards[first]!.action;
  if (a === 'squash' || a === 'fixup') return { kind: 'squashFirst', index: first, action: a };
  const same =
    cards.length === start.length &&
    cards.every((c, i) => c.commit === start[i]!.commit && c.action === 'pick');
  if (same) return { kind: 'unchanged' };
  return null;
}

/** "The commit whose message matches has this file content" (squash / fixup / reorder checks). */
export interface CommitFileCheck {
  message: string;
  file: string;
  contains?: string;
  lacks?: string;
}

/** Which commit-file checks fail (by index) in the history from HEAD. */
export function failedCommitChecks(state: SimState, checks: CommitFileCheck[] = []): number[] {
  const repo = findRepo(state);
  if (!repo) return checks.map((_, i) => i);
  const log = history(repo, headId(repo));
  return checks.flatMap((ch, i) => {
    const re = new RegExp(ch.message, 'i');
    const c = log.find((x) => re.test(subject(x.message)));
    const text = c?.snapshot[ch.file];
    const ok = text !== undefined && (ch.contains === undefined || text.includes(ch.contains)) && (ch.lacks === undefined || !text.includes(ch.lacks));
    return ok ? [] : [i];
  });
}

/** Commit subjects from HEAD, newest first, and how many there are. */
export function historySummary(state: SimState): { messages: string[]; files: string[] } {
  const repo = findRepo(state);
  if (!repo) return { messages: [], files: [] };
  return { messages: history(repo, headId(repo)).map((c) => subject(c.message)), files: Object.keys(workingTree(state, repo)).sort() };
}

/** The i18n key (and params) for the kindest useful hint, from checkGoal's failed list. */
export function feedbackFor(failed: string[], want: { commits?: number; got: number }): { key: string; params?: Record<string, string | number> } {
  if (failed.includes('commits') && want.commits !== undefined) {
    return { key: want.got > want.commits ? 'rebase.fb.tooMany' : 'rebase.fb.tooFew', params: { want: want.commits, got: want.got } };
  }
  if (failed.includes('filesMissing')) return { key: 'rebase.fb.filesMissing' };
  if (failed.includes('messages') || failed.includes('lastMessage')) return { key: 'rebase.fb.messages' };
  if (failed.some((f) => f.startsWith('commitFile'))) return { key: 'rebase.fb.commitFiles' };
  return { key: 'rebase.fb.other' };
}
