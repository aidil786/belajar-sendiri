// Mark lessons as done / known on the world map and island cards (browser only).
import { $progress } from '~/stores/progress';

export function applyMapMarks(doneTemplate: string): void {
  const render = () => {
    const p = $progress.get();
    const done = new Set(p.completed);
    const known = new Set(p.known);
    for (const row of document.querySelectorAll<HTMLElement>('[data-lesson-row]')) {
      const id = row.dataset.lessonRow!;
      const d = row.querySelector<HTMLElement>('[data-done-tag]');
      const k = row.querySelector<HTMLElement>('[data-known-tag]');
      if (d) d.hidden = !done.has(id);
      if (k) k.hidden = done.has(id) || !known.has(id);
    }
    for (const isl of document.querySelectorAll<HTMLElement>('[data-island]')) {
      const ids = (isl.dataset.lessons ?? '').split(',').filter(Boolean);
      const n = ids.filter((id) => done.has(id)).length;
      const prog = isl.querySelector<HTMLElement>('[data-island-progress]');
      if (prog && ids.length) prog.textContent = ` · ${doneTemplate.replace('{done}', String(n)).replace('{total}', String(ids.length))}`;
      const star = isl.querySelector<HTMLElement>('[data-island-done]');
      if (star) star.hidden = !(ids.length > 0 && n === ids.length);
    }
  };
  render();
  $progress.listen(render);
}
