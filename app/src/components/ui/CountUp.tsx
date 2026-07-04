import { useLayoutEffect, useMemo, useRef } from "react";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";

interface CountUpProps {
  /** The formatted target value, e.g. "12", "94.2%", "128s", "1,204" or "—". */
  value: string;
  className?: string;
  style?: React.CSSProperties;
  /** Total effect duration in ms (default 680, matching the design). */
  durationMs?: number;
}

interface Parsed {
  prefix: string;
  target: number;
  decimals: number;
  grouped: boolean;
  suffix: string;
}

/**
 * Splits a display string into an animatable number plus its non-numeric
 * prefix/suffix (e.g. "94.2%" -> {target: 94.2, decimals: 1, suffix: "%"}).
 * Returns null for strings with no number (like "—"), which should not animate.
 */
function parseNumeric(value: string): Parsed | null {
  const match = value.match(/^(.*?)(-?\d[\d,]*(?:\.\d+)?)(.*)$/);
  if (!match) return null;
  const raw = match[2];
  const decimals = raw.includes(".") ? raw.split(".")[1].length : 0;
  return {
    prefix: match[1],
    target: parseFloat(raw.replace(/,/g, "")),
    decimals,
    grouped: raw.includes(","),
    suffix: match[3],
  };
}

/** Formats an in-flight value back to the target's shape (decimals + grouping). */
function format(value: number, { decimals, grouped }: Parsed): string {
  const fixed = Math.max(0, value).toFixed(decimals);
  if (!grouped) return fixed;
  const [int, frac] = fixed.split(".");
  const withCommas = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return frac ? `${withCommas}.${frac}` : withCommas;
}

/**
 * Dashboard metric that counts up from zero to its value — a faithful port of
 * the design prototype's `countUp` (easeOutCubic over 680ms). The digits spin
 * rapidly up before easing onto the final figure. Original formatting (%, s,
 * thousands separators) is preserved; non-numeric placeholders like "—" render
 * verbatim, and reduced-motion users jump straight to the value.
 */
export function CountUp({ value, className, style, durationMs = 680 }: CountUpProps) {
  const reduced = usePrefersReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const parsed = useMemo(() => parseNumeric(value), [value]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!parsed || reduced) {
      el.textContent = value;
      return;
    }

    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
      el.textContent = `${parsed.prefix}${format(parsed.target * eased, parsed)}${parsed.suffix}`;
      if (p < 1) raf = requestAnimationFrame(tick);
      else el.textContent = value;
    };
    el.textContent = `${parsed.prefix}${format(0, parsed)}${parsed.suffix}`;
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, parsed, reduced, durationMs]);

  return (
    <span ref={ref} className={className} style={style}>
      {value}
    </span>
  );
}
