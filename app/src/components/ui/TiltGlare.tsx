import { motion, useMotionTemplate, type MotionValue } from "framer-motion";
import { cn } from "@/lib/cn";

interface TiltGlareProps {
  /** Cursor position + hover fade from {@link useTilt}. */
  px: MotionValue<number>;
  py: MotionValue<number>;
  glow: MotionValue<number>;
  className?: string;
}

/**
 * Glass-reflection overlay for a tilted surface. Renders a soft radial highlight
 * that tracks the cursor (via {@link useTilt}'s `px`/`py`) and fades with `glow`,
 * so a glass card catches the light as it tilts. `soft-light` blending keeps it
 * a sheen rather than a wash, preserving the content's legibility.
 *
 * Absolutely positioned + `pointer-events-none`; drop it inside a `relative`
 * tilted element. Inherits the parent's `border-radius` so it stays clipped to
 * rounded corners. Decorative — hidden from assistive tech.
 */
export function TiltGlare({ px, py, glow, className }: TiltGlareProps) {
  const background = useMotionTemplate`radial-gradient(circle at ${px}% ${py}%, rgba(255,255,255,0.35), rgba(255,255,255,0.06) 40%, rgba(255,255,255,0) 62%)`;
  return (
    <motion.div
      aria-hidden
      className={cn("pointer-events-none absolute inset-0 rounded-[inherit]", className)}
      style={{ background, opacity: glow, mixBlendMode: "soft-light" }}
    />
  );
}
