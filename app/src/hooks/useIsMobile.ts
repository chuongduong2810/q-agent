import { useSyncExternalStore } from "react";

/**
 * Reactive "is this a phone-width viewport?" flag, driven by a `matchMedia`
 * query at the Tailwind `md` boundary (<768px = mobile). Below it the app
 * collapses its two sidebars into a slide-in drawer and swaps the desktop
 * top bar / run-context header for the compact mobile chrome; at `md` and up
 * the desktop layout renders unchanged. Uses `useSyncExternalStore` so it stays
 * correct across concurrent renders and needs no effect to hydrate.
 */
const QUERY = "(max-width: 767px)";

function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mql = window.matchMedia(QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

function getSnapshot(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(QUERY).matches;
}

export function useIsMobile(): boolean {
  // Server snapshot is `false` — desktop-first, matching SSR-less CSR here.
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
