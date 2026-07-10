/**
 * Pure geometry helpers for the product tour's coach-mark card.
 *
 * Kept free of React so they're trivially testable and reusable. `placeCard`
 * mirrors the viewport-clamping idiom in `ui/Dropdown.tsx`'s `place()`.
 */

import type { TourPlacement } from "@/tour/tourSteps";

/** Viewport-edge breathing room, matching DropdownShell's 12px clamp. */
const MARGIN = 12;
/** Gap between the spotlighted target and the coach-mark card. */
const GAP = 14;

/** Clamp `v` into the inclusive `[min, max]` range. */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Compute the top/left (viewport coordinates) for a coach-mark card of size
 * `cardW`×`cardH` placed beside a target `rect`.
 *
 * @param rect       The spotlighted target's bounding rect.
 * @param placement  Preferred side; `"auto"` picks the side with the most room.
 * @param cardW      Card width in px.
 * @param cardH      Card height in px.
 * @returns          `{ top, left }` clamped to a 12px viewport inset.
 */
export function placeCard(
  rect: DOMRect,
  placement: TourPlacement,
  cardW: number,
  cardH: number,
): { top: number; left: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const side = placement === "auto" ? pickSide(rect, cardW, cardH, vw, vh) : placement;

  let top: number;
  let left: number;

  switch (side) {
    case "top":
      top = rect.top - cardH - GAP;
      left = rect.left + rect.width / 2 - cardW / 2;
      break;
    case "bottom":
      top = rect.bottom + GAP;
      left = rect.left + rect.width / 2 - cardW / 2;
      break;
    case "left":
      top = rect.top + rect.height / 2 - cardH / 2;
      left = rect.left - cardW - GAP;
      break;
    case "right":
    default:
      top = rect.top + rect.height / 2 - cardH / 2;
      left = rect.right + GAP;
      break;
  }

  return {
    top: clamp(top, MARGIN, Math.max(MARGIN, vh - cardH - MARGIN)),
    left: clamp(left, MARGIN, Math.max(MARGIN, vw - cardW - MARGIN)),
  };
}

/** Choose the side around `rect` with the most free space for the card. */
function pickSide(
  rect: DOMRect,
  cardW: number,
  cardH: number,
  vw: number,
  vh: number,
): Exclude<TourPlacement, "auto"> {
  const space = {
    right: vw - rect.right,
    left: rect.left,
    bottom: vh - rect.bottom,
    top: rect.top,
  };
  // Prefer horizontal placement (keeps the card clear of top-bar / sidebar
  // targets), falling back to whichever axis actually fits.
  if (space.right >= cardW + GAP + MARGIN) return "right";
  if (space.left >= cardW + GAP + MARGIN) return "left";
  if (space.bottom >= cardH + GAP + MARGIN) return "bottom";
  if (space.top >= cardH + GAP + MARGIN) return "top";
  // Nothing fits cleanly — go with the roomiest side; clamping handles overflow.
  return (Object.keys(space) as Array<keyof typeof space>).reduce((a, b) =>
    space[a] >= space[b] ? a : b,
  );
}

/**
 * Poll (via requestAnimationFrame) until a `[data-tour="key"]` element exists,
 * to absorb the route-change fade and async screen data.
 *
 * @param key        The `data-tour` value to wait for.
 * @param timeoutMs  Give up after this long (default 2500ms).
 * @returns          The element, or `null` if it never appeared in time.
 */
export function waitForTarget(key: string, timeoutMs = 2500): Promise<HTMLElement | null> {
  return new Promise((resolve) => {
    const start = performance.now();
    const tick = () => {
      const el = document.querySelector<HTMLElement>(`[data-tour="${key}"]`);
      if (el) {
        resolve(el);
        return;
      }
      if (performance.now() - start >= timeoutMs) {
        resolve(null);
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
