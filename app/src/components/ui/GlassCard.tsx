import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

interface GlassCardProps {
  children: ReactNode;
  className?: string;
  hover?: boolean;
  /** stagger index for the fade-in-up entrance */
  index?: number;
  onClick?: () => void;
  style?: React.CSSProperties;
}

/** Frosted glass surface — the design's default panel. Optional hover lift. */
export function GlassCard({ children, className, hover, index = 0, onClick, style }: GlassCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: Math.min(index * 0.04, 0.3), ease: "easeOut" }}
      whileHover={
        hover
          ? {
              y: -4,
              borderColor: "rgba(139,92,246,.4)",
              boxShadow:
                "0 20px 45px -20px rgba(139,92,246,.5), 0 0 26px -10px rgba(34,211,238,.35)",
              transition: { duration: 0.18 },
            }
          : undefined
      }
      onClick={onClick}
      style={style}
      className={cn(
        "glass rounded-[20px]",
        hover && "cursor-pointer",
        onClick && "cursor-pointer",
        className,
      )}
    >
      {children}
    </motion.div>
  );
}
