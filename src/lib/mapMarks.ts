// Mark lessons as done / known on the world map and island cards (browser only).
import { $progress } from '~/stores/progress';

export function applyMapMarks(doneTemplate: string): void {
  const render = () => {
    const p = $progress.get();
    const done = new Set(p.completed);
    const known = new Set(p.known);
    // "You are here": the lesson you stopped in, if you have not finished it yet.
    const here = p.resume && !done.has(p.resume.lessonId) ? p.resume.lessonId : undefined;
    for (const row of document.querySelectorAll<HTMLElement>('[data-lesson-row]')) {
      const id = row.dataset.lessonRow!;
      const d = row.querySelector<HTMLElement>('[data-done-tag]');
      const k = row.querySelector<HTMLElement>('[data-known-tag]');
      const h = row.querySelector<HTMLElement>('[data-here-tag]');
      if (d) d.hidden = !done.has(id);
      if (k) k.hidden = done.has(id) || !known.has(id);
      if (h) h.hidden = id !== here;
      const state = id === here ? 'here' : done.has(id) ? 'done' : known.has(id) ? 'known' : '';
      if (state) row.dataset.state = state;
      else delete row.dataset.state;
      const link = row.querySelector('a');
      if (link) {
        if (id === here) link.setAttribute('aria-current', 'step');
        else link.removeAttribute('aria-current');
      }
    }
    for (const isl of document.querySelectorAll<HTMLElement>('[data-island]')) {
      const ids = (isl.dataset.lessons ?? '').split(',').filter(Boolean);
      const n = ids.filter((id) => done.has(id)).length;
      const prog = isl.querySelector<HTMLElement>('[data-island-progress]');
      // A bare progress (world map cards) has no " · " in front: it stands on its own line.
      const text = doneTemplate.replace('{done}', String(n)).replace('{total}', String(ids.length));
      if (prog && ids.length) prog.textContent = prog.hasAttribute('data-bare') ? text : ` · ${text}`;
      const star = isl.querySelector<HTMLElement>('[data-island-done]');
      if (star) star.hidden = !(ids.length > 0 && n === ids.length);
    }
  };
  render();
  $progress.listen(render);
}
