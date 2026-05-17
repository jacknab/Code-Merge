import { useEffect, useState } from "react";

export interface TargetRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * Tracks the bounding rect of the first element matching `[data-testid="<testid>"]`.
 * Re-measures on scroll, resize, and via requestAnimationFrame while active.
 */
export function useTargetRect(testid: string | null, active: boolean): TargetRect | null {
  const [rect, setRect] = useState<TargetRect | null>(null);

  useEffect(() => {
    if (!active || !testid) {
      setRect(null);
      return;
    }
    let raf = 0;
    let last = "";
    const tick = () => {
      const el = document.querySelector<HTMLElement>(`[data-testid="${CSS.escape(testid)}"]`);
      if (el) {
        const r = el.getBoundingClientRect();
        const next: TargetRect = { top: r.top, left: r.left, width: r.width, height: r.height };
        const key = `${next.top}|${next.left}|${next.width}|${next.height}`;
        if (key !== last) {
          last = key;
          setRect(next);
        }
      } else if (last !== "") {
        last = "";
        setRect(null);
      }
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [testid, active]);

  return rect;
}
