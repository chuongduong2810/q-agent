import { useMotionValue, useSpring, type MotionStyle } from "framer-motion";
import { useCallback } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

export interface TiltOptions {
  /** Max up/down tilt in degrees (rotateX). */
  maxX?: number;
  /** Max left/right tilt in degrees (rotateY). */
  maxY?: number;
  /** Scale applied while hovered (1 = no grow). */
  scale?: number;
  /** CSS perspective in px — smaller = more dramatic depth. */
  perspective?: number;
}

export interface TiltBinding {
  /** Framer Motion style to spread onto a `motion.*` element. */
  style: MotionStyle;
  onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerLeave: () => void;
}

/**
 * Cursor-tracked 3D tilt hover (see `design/tilt-effect.html`).
 *
 * Returns a Framer Motion `style` plus pointer handlers to spread onto any
 * `motion.*` element. Driven by motion values + springs (not `el.style`) so it
 * never fights Framer's own transform system on the target.
 *
 * The pivot is pinned to the element's TOP edge (`transformOrigin: '50% 0%'`)
 * with no translate, so a tilted element grows and rotates *downward* — its top
 * never rises, and a first-row card can't slide under a fixed header/nav.
 *
 * Honours `prefers-reduced-motion` (handlers become inert) and ignores touch
 * input (tilt is a fine-pointer affordance).
 *
 * @param options tilt strength — see {@link TiltOptions}. Defaults are a subtle
 *   card tilt (7° / 9° / scale 1.03 / perspective 780); the sidebar logo passes
 *   stronger values.
 * @returns `{ style, onPointerMove, onPointerLeave }` — see {@link TiltBinding}.
 */
export function useTilt(options: TiltOptions = {}): TiltBinding {
  const { maxX = 7, maxY = 9, scale = 1.03, perspective = 780 } = options;

  const rotateX = useMotionValue(0);
  const rotateY = useMotionValue(0);
  const cardScale = useMotionValue(1);

  // Spring the raw targets for a smooth follow + graceful settle back to rest.
  const spring = { stiffness: 220, damping: 22, mass: 0.6 };
  const springX = useSpring(rotateX, spring);
  const springY = useSpring(rotateY, spring);
  const springScale = useSpring(cardScale, spring);

  const prefersReducedMotion =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (prefersReducedMotion || e.pointerType === "touch") return;
      const r = e.currentTarget.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width; // 0…1 across
      const py = (e.clientY - r.top) / r.height; // 0…1 down
      rotateX.set((0.5 - py) * maxX); // tilt up/down
      rotateY.set((px - 0.5) * maxY); // tilt left/right
      cardScale.set(scale);
    },
    [prefersReducedMotion, maxX, maxY, scale, rotateX, rotateY, cardScale],
  );

  const onPointerLeave = useCallback(() => {
    rotateX.set(0);
    rotateY.set(0);
    cardScale.set(1);
  }, [rotateX, rotateY, cardScale]);

  const style: MotionStyle = {
    rotateX: springX,
    rotateY: springY,
    scale: springScale,
    transformPerspective: perspective,
    transformOrigin: "50% 0%",
    transformStyle: "preserve-3d",
    willChange: "transform",
  };

  return { style, onPointerMove, onPointerLeave };
}
