import { motion } from "framer-motion";
import { cn } from "@/lib/cn";

const prefersReducedMotion = (): boolean =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * One-shot left→right shine sweep for a glass surface — the "glass reflection".
 * A single mount plays one diagonal light pass across the card; parents bump
 * this element's `key` on each hover-enter to replay it.
 *
 * Absolutely positioned, clipped to the parent's rounded shape, and
 * `pointer-events-none` — drop it inside a `relative` glass surface. Renders
 * nothing under `prefers-reduced-motion`. Decorative — hidden from assistive tech.
 */
export function TiltSweep({ className }: { className?: string }) {
  if (prefersReducedMotion()) return null;
  return (
    <div
      aria-hidden
      className={cn("pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]", className)}
    >
      <motion.div
        className="absolute inset-0"
        style={{
          // 135deg gradient → the bright band runs at a 45° diagonal ("/"),
          // and translating x sweeps that diagonal streak across the card.
          background:
            "linear-gradient(135deg, rgba(255,255,255,0) 38%, rgba(255,255,255,0.55) 50%, rgba(255,255,255,0) 62%)",
          mixBlendMode: "soft-light",
        }}
        initial={{ x: "-100%" }}
        animate={{ x: "100%" }}
        transition={{ duration: 1.2, ease: [0.22, 0.7, 0.3, 1] }}
      />
    </div>
  );
}
