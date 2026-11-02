// A slow clock for the food-court simulator: calls `onTick` every `ms` while `active`,
// but only while the card is on screen and the browser tab is visible.
import { useEffect, useRef, type RefObject } from 'react';

export function useSimClock(el: RefObject<HTMLElement | null>, active: boolean, ms: number, onTick: () => void): void {
  const fn = useRef(onTick);
  fn.current = onTick;
  const visible = useRef(true);
  useEffect(() => {
    const node = el.current;
    if (!node || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => {
      visible.current = entries.some((e) => e.isIntersecting);
    });
    io.observe(node);
    return () => io.disconnect();
  }, [el]);
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => {
      if (!visible.current || document.hidden) return;
      fn.current();
    }, ms);
    return () => window.clearInterval(id);
  }, [active, ms]);
}
