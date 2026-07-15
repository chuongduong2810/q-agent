import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { useTilt } from "@/hooks/useTilt";

interface GlassCardProps {
  children: ReactNode;
  className?: string;
  hover?: boolean;
  /** stagger index for the fade-in-up entrance */
  index?: number;
  onClick?: () => void;
  style?: React.CSSProperties;
}

/**
 * Frosted glass surface — the design's default panel. Every card follows the
 * cursor with a subtle 3D tilt and brightens on hover (the design applies this
 * to all glass panels — see `useTilt` / `design/tilt-effect.html`). The tilt
 * pivots from the top edge, so a card grows *downward* and never rises under a
 * header. Cards flagged `hover` or given an `onClick` are interactive: they get
 * the richer border-highlight + cyan glow and a pointer cursor on top of the
 * tilt.
 */
export function GlassCard({ children, className, hover, index = 0, onClick, style }: GlassCardProps) {
  const interactive = hover || Boolean(onClick);
  const tilt = useTilt();
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: Math.min(index * 0.04, 0.3), ease: "easeOut" }}
      whileHover={{
        // No translate — the tilt owns the transform and pivots from the top so
        // the card never rises (design intent). Hover only brightens the frame.
        zIndex: 20,
        ...(interactive ? { borderColor: "rgba(139,92,246,.4)" } : {}),
        boxShadow: interactive
          ? "0 20px 45px -20px rgba(139,92,246,.5), 0 0 26px -10px rgba(34,211,238,.35)"
          : "0 18px 50px -22px rgba(139,92,246,.5)",
        transition: { duration: 0.25, ease: [0.2, 0.8, 0.2, 1] },
      }}
      onClick={onClick}
      onPointerMove={tilt.onPointerMove}
      onPointerLeave={tilt.onPointerLeave}
      // tilt.style provides the perspective + rotate/scale motion values; the
      // caller's `style` may override cosmetics but never the transform keys.
      style={{ ...tilt.style, ...style }}
      className={cn(
        "glass relative rounded-[20px]",
        hover && "cursor-pointer",
        onClick && "cursor-pointer",
        className,
      )}
    >
      {children}
    </motion.div>
  );
}
