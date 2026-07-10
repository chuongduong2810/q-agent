/**
 * Interactive product-tour overlay — a guided, multi-step walkthrough with a
 * spotlight on a highlighted UI element and a coach-mark card beside it. Drives
 * cross-route navigation (including diving into a seeded sample run) from the
 * declarative `@/tour/tourSteps` list, sequenced by `@/store/tour`.
 *
 * Rendering follows the project's overlay rules (CLAUDE.md): every layer is
 * portalled to `document.body` with `fixed` positioning, uses an OPAQUE card
 * background (no `backdrop-filter` over the animated app background), and lets
 * `AnimatePresence` be the direct parent of the animating `motion` element.
 */

import { AnimatePresence, motion, type MotionStyle } from "framer-motion";
import { Compass } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import { useEnsureSampleRun } from "@/hooks/queries";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { useAuth } from "@/store/auth";
import { hasSeenTour, useTour } from "@/store/tour";
import { TOUR_STEPS } from "@/tour/tourSteps";
import { placeCard, waitForTarget } from "./placement";

/** Fixed coach-mark width; height is measured from the rendered card. */
const CARD_W = 320;
/** Glide duration for the spotlight moving between targets. */
const GLIDE_MS = 280;

/** A padded viewport rectangle for the spotlight ring. */
interface Spot {
  top: number;
  left: number;
  width: number;
  height: number;
}

export function TourOverlay() {
  const active = useTour((s) => s.active);
  const stepIndex = useTour((s) => s.stepIndex);
  const start = useTour((s) => s.start);
  const stop = useTour((s) => s.stop);
  const next = useTour((s) => s.next);
  const prev = useTour((s) => s.prev);
  const setSampleRunId = useTour((s) => s.setSampleRunId);

  const user = useAuth((s) => s.user);
  const ensureSampleRun = useEnsureSampleRun();
  const navigate = useNavigate();
  const location = useLocation();
  const reduced = usePrefersReducedMotion();

  const [spot, setSpot] = useState<Spot | null>(null);
  const [cardPos, setCardPos] = useState<{ top: number; left: number } | null>(null);
  const [ready, setReady] = useState(false);

  const targetElRef = useRef<HTMLElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const autoStartedRef = useRef(false);

  const step = TOUR_STEPS[stepIndex];
  const centered = !step?.key;

  // Re-measure the spotlighted target and re-place the coach-mark. Reads the
  // live card height so placement stays correct once the card has rendered.
  const reposition = useCallback(() => {
    const s = TOUR_STEPS[stepIndex];
    const el = targetElRef.current;
    if (!s?.key || !el) return;
    const r = el.getBoundingClientRect();
    const pad = s.padding ?? 8;
    const next: Spot = {
      top: r.top - pad,
      left: r.left - pad,
      width: r.width + pad * 2,
      height: r.height + pad * 2,
    };
    setSpot(next);
    const cardH = cardRef.current?.offsetHeight ?? 190;
    const rect = new DOMRect(next.left, next.top, next.width, next.height);
    setCardPos(placeCard(rect, s.placement ?? "auto", CARD_W, cardH));
  }, [stepIndex]);

  // Per-step orchestration: finish at the end, ensure the sample run, navigate,
  // then wait for the target before measuring. Skips gracefully on timeout.
  useEffect(() => {
    if (!active) return;
    const s = TOUR_STEPS[stepIndex];
    if (!s) {
      stop(true);
      return;
    }

    let cancelled = false;
    setReady(false);

    (async () => {
      // Resolve the sample run lazily the first time a run-scoped step appears.
      let runId = useTour.getState().sampleRunId;
      if (s.route?.includes(":sampleRun") && runId == null) {
        try {
          const run = await ensureSampleRun.mutateAsync();
          if (cancelled) return;
          runId = run.id;
          setSampleRunId(run.id);
        } catch {
          if (cancelled) return;
          next(); // couldn't seed — skip past the run-scoped section
          return;
        }
      }

      const route = s.route?.replace(":sampleRun", String(runId));
      if (route && route !== location.pathname) navigate(route);

      if (!s.key) {
        // Centered intro / bridge / finish card — dim everything, no ring.
        if (cancelled) return;
        setSpot(null);
        setCardPos(null);
        setReady(true);
        return;
      }

      const el = await waitForTarget(s.key);
      if (cancelled) return;
      if (!el) {
        next(); // target never appeared — don't strand the user
        return;
      }
      el.scrollIntoView({ block: "nearest" });
      targetElRef.current = el;
      reposition();
      setReady(true);
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, stepIndex]);

  // Correct placement once the real card height is known, and keep the
  // spotlight glued to its target through scroll / resize / element changes.
  useEffect(() => {
    if (!active || !ready || centered) return;
    reposition();
    const el = targetElRef.current;
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    const ro = el ? new ResizeObserver(() => reposition()) : null;
    if (el && ro) ro.observe(el);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
      ro?.disconnect();
    };
  }, [active, ready, centered, reposition]);

  // Escape ends the tour.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") stop(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, stop]);

  // Auto-start once for a signed-in user who hasn't seen the tour, after first
  // paint settles. Public auth routes are excluded (defensive — the overlay
  // only mounts under RequireAuth).
  useEffect(() => {
    if (autoStartedRef.current || !user || hasSeenTour()) return;
    const p = location.pathname;
    if (p.startsWith("/login") || p.startsWith("/forgot") || p.startsWith("/signed-out")) return;
    // Set the guard INSIDE the timer, not before it: under React StrictMode (and
    // on the login→"/" pathname change) this effect runs, is torn down, and re-runs
    // within 600ms. Flipping the ref up-front would let the teardown cancel the one
    // scheduled timer while the re-run bails on the ref — so the tour never starts.
    const t = setTimeout(() => {
      autoStartedRef.current = true;
      start();
    }, 600);
    return () => clearTimeout(t);
  }, [user, location.pathname, start]);

  if (!active || !step) return null;

  const total = TOUR_STEPS.length;
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === total - 1;

  const cardStyle: MotionStyle = centered
    ? { top: "50%", left: "50%", x: "-50%", y: "-50%", background: "rgb(24,24,32)" }
    : { top: cardPos?.top ?? 0, left: cardPos?.left ?? 0, background: "rgb(24,24,32)" };

  return createPortal(
    <>
      {/* Full-screen click blocker — prevents interacting with the app during
          the tour. Opaque dim for centered cards; transparent when a spotlight
          ring supplies the dim via its box-shadow. */}
      <div
        className="fixed inset-0 z-[70]"
        style={{ background: spot ? "transparent" : "rgba(6,6,10,.72)" }}
        onMouseDown={(e) => e.preventDefault()}
      />

      {/* Spotlight ring — the huge box-shadow dims everything outside it. */}
      {spot && (
        <div
          className="fixed z-[70]"
          style={{
            top: spot.top,
            left: spot.left,
            width: spot.width,
            height: spot.height,
            borderRadius: 14,
            boxShadow:
              "0 0 0 9999px rgba(6,6,10,.72), 0 0 0 2px #8b5cf6, 0 0 26px 6px rgba(139,92,246,.5)",
            transition: reduced
              ? undefined
              : `top ${GLIDE_MS}ms ease, left ${GLIDE_MS}ms ease, width ${GLIDE_MS}ms ease, height ${GLIDE_MS}ms ease`,
          }}
        />
      )}

      {/* Coach-mark card. AnimatePresence must be the direct parent of motion. */}
      <AnimatePresence>
        {ready && (
          <motion.div
            key={stepIndex}
            ref={cardRef}
            data-testid="tour-card"
            initial={{ opacity: 0, scale: reduced ? 1 : 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: reduced ? 1 : 0.98 }}
            transition={{ duration: reduced ? 0 : 0.2, ease: "easeOut" }}
            className="fixed z-[70] w-[320px] rounded-[16px] border border-white/[0.12] p-[18px] shadow-[0_30px_70px_-20px_rgba(0,0,0,.8)]"
            style={cardStyle}
          >
            <div className="mb-2 flex items-center gap-2">
              <span className="accent-gradient flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[8px]">
                <Compass size={15} color="#fff" strokeWidth={2.4} />
              </span>
              <span className="text-[15px] font-extrabold text-ink">{step.title}</span>
            </div>
            <p className="text-[13px] leading-[1.55] text-ink-dim">{step.body}</p>
            <div className="mt-4 flex items-center justify-between">
              <button
                type="button"
                onClick={() => stop(true)}
                className="cursor-pointer text-[12px] font-medium text-muted transition-colors hover:text-ink"
              >
                Skip
              </button>
              <div className="flex items-center gap-2">
                <span className="mr-1 text-[11.5px] font-medium text-faint">
                  {stepIndex + 1} of {total}
                </span>
                {!isFirst && (
                  <button
                    type="button"
                    onClick={() => prev()}
                    className="cursor-pointer rounded-[9px] border border-white/10 bg-white/[0.05] px-3 py-1.5 text-[12.5px] font-semibold text-ink-soft transition-colors hover:bg-white/10"
                  >
                    Back
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => next()}
                  className="accent-gradient cursor-pointer rounded-[9px] px-3.5 py-1.5 text-[12.5px] font-semibold text-white"
                >
                  {isLast ? "Finish" : "Next"}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>,
    document.body,
  );
}
