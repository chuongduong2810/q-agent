import { useEffect, useRef, useState } from "react";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";

/**
 * Reveal `target` character-by-character (the Claude-in-a-code-editor effect) over
 * the REAL returned text — the backend returns the full reply at once (see the plan;
 * true token streaming is a documented follow-up), so this is a client-side reveal.
 *
 * Reveals ~2 chars / 16ms. When the OS "reduce motion" preference is on, the full
 * string appears immediately (no animation). Returns the currently-shown substring
 * and whether the reveal has finished (drives the blinking caret / thinking dots).
 *
 * @param target The full text to reveal (empty string while the reply is pending).
 * @param animate When false (e.g. a historical message re-shown after the panel
 *   was closed and reopened), the full string appears instantly — no re-typing.
 */
export function useTypewriter(target: string, animate = true): { shown: string; done: boolean } {
  const reduced = usePrefersReducedMotion();
  const [shown, setShown] = useState("");
  const iRef = useRef(0);

  useEffect(() => {
    // Reset whenever the target changes (a new reply for this message).
    iRef.current = 0;
    setShown("");
    if (!target) return;
    if (reduced || !animate) {
      setShown(target);
      return;
    }
    const id = setInterval(() => {
      iRef.current = Math.min(iRef.current + 2, target.length);
      setShown(target.slice(0, iRef.current));
      if (iRef.current >= target.length) clearInterval(id);
    }, 16);
    return () => clearInterval(id);
  }, [target, reduced, animate]);

  return { shown, done: shown.length >= target.length };
}
