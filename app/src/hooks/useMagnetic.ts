import { useEffect, useRef, type MouseEvent } from "react";
import { useSpring } from "framer-motion";

interface Magnetic<T extends HTMLElement> {
  ref: React.MutableRefObject<T | null>;
  onMouseMove: (e: MouseEvent<T>) => void;
  onMouseLeave: () => void;
}

/**
 * Makes an element lean subtly toward the cursor while hovered, springing back
 * on leave. The offset is written straight to `style.transform` via a Framer
 * spring (no React re-render per move) and is capped at `strength` pixels.
 *
 * @param strength Maximum translation in pixels (default 6).
 * @returns A ref plus mouse handlers to spread onto the target element.
 */
export function useMagnetic<T extends HTMLElement>(strength = 6): Magnetic<T> {
  const ref = useRef<T | null>(null);
  const x = useSpring(0, { stiffness: 260, damping: 18, mass: 0.5 });
  const y = useSpring(0, { stiffness: 260, damping: 18, mass: 0.5 });

  useEffect(() => {
    const apply = () => {
      const el = ref.current;
      if (el) el.style.transform = `translate(${x.get()}px, ${y.get()}px)`;
    };
    const unsubX = x.on("change", apply);
    const unsubY = y.on("change", apply);
    return () => {
      unsubX();
      unsubY();
    };
  }, [x, y]);

  const onMouseMove = (e: MouseEvent<T>) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    x.set(Math.max(-strength, Math.min(strength, dx * 0.4)));
    y.set(Math.max(-strength, Math.min(strength, dy * 0.4)));
  };

  const onMouseLeave = () => {
    x.set(0);
    y.set(0);
  };

  return { ref, onMouseMove, onMouseLeave };
}
