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
        className="absolute inset-y-0 left-0 w-1/2"
        style={{
          background:
            "linear-gradient(105deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.55) 50%, rgba(255,255,255,0) 100%)",
          mixBlendMode: "soft-light",
        }}
        initial={{ x: "-120%" }}
        animate={{ x: "220%" }}
        transition={{ duration: 0.85, ease: [0.22, 0.7, 0.3, 1] }}
      />
    </div>
  );
}
