import { forwardRef, type ButtonHTMLAttributes, type MouseEvent } from "react";
import { cn } from "@/lib/cn";
import { useMagnetic } from "@/hooks/useMagnetic";

type Variant = "primary" | "glass" | "ghost" | "white" | "success" | "danger";
type Size = "sm" | "md" | "lg";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const base =
  "inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-[filter,background,border-color] cursor-pointer border select-none disabled:opacity-50 disabled:cursor-not-allowed";

const variants: Record<Variant, string> = {
  primary:
    "border-transparent text-white accent-gradient hover:brightness-110 shadow-[0_8px_22px_-8px_rgba(139,92,246,.8)]",
  glass:
    "border-white/10 bg-white/[0.05] text-ink-soft hover:bg-white/[0.1]",
  ghost: "border-transparent bg-transparent text-ink-dim hover:bg-white/[0.06]",
  white: "border-transparent bg-white text-[#12121a] font-bold hover:brightness-95",
  success:
    "border-[rgba(16,185,129,.3)] bg-[rgba(16,185,129,.16)] text-[#6ee7b7] hover:bg-[rgba(16,185,129,.24)]",
  danger:
    "border-[rgba(244,63,94,.28)] bg-[rgba(244,63,94,.13)] text-[#fb7185] hover:bg-[rgba(244,63,94,.2)]",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-[12px]",
  md: "h-[38px] px-4 text-[13px]",
  lg: "h-11 px-5 text-[14px]",
};

/** Shared button matching the design's button family, with a subtle magnetic
 * lean toward the cursor on hover (springs back on leave). */
export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = "glass", size = "md", className, onMouseMove, onMouseLeave, ...rest },
  ref,
) {
  const mag = useMagnetic<HTMLButtonElement>();

  const setRef = (node: HTMLButtonElement | null) => {
    mag.ref.current = node;
    if (typeof ref === "function") ref(node);
    else if (ref) ref.current = node;
  };

  const handleMove = (e: MouseEvent<HTMLButtonElement>) => {
    mag.onMouseMove(e);
    onMouseMove?.(e);
  };
  const handleLeave = (e: MouseEvent<HTMLButtonElement>) => {
    mag.onMouseLeave();
    onMouseLeave?.(e);
  };

  return (
    <button
      ref={setRef}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
      className={cn(base, variants[variant], sizes[size], className)}
      {...rest}
    />
  );
});
