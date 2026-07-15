/**
 * Shared shell for the unauthenticated auth screens (ADR 0007) — a split
 * screen: a brand/marketing panel on the left and the form (`children`) on the
 * right. Ported from the design source (`design/…/Q-Agent Auth.dc.html`).
 * Renders full-screen and OUTSIDE the app shell (these are top-level public
 * routes, siblings of `<App/>`), so it owns its own background + ambient glows.
 *
 * SSO buttons are intentionally NOT rendered (deferred).
 */

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Check, Sparkles } from "lucide-react";

const BRAND_POINT_KEYS = [
  "brand.points.pipeline",
  "brand.points.integrations",
  "brand.points.evidence",
];

/** The Q-Agent logo mark (violet→indigo rounded square with a sparkle). */
function LogoMark({ size = 40, radius = 13 }: { size?: number; radius?: number }) {
  return (
    <div
      className="flex shrink-0 items-center justify-center"
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: "linear-gradient(135deg,#8b5cf6,#6366f1)",
        boxShadow: "0 8px 22px -6px rgba(139,92,246,.8)",
      }}
    >
      <Sparkles size={size * 0.55} color="#fff" strokeWidth={2.2} />
    </div>
  );
}

export function AuthLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation("auth");
  return (
    <div className="fixed inset-0 overflow-y-auto bg-base text-ink">
      {/* ambient glows */}
      <div
        className="pointer-events-none fixed z-0"
        style={{
          top: "-12%",
          left: "-6%",
          width: 620,
          height: 620,
          borderRadius: "50%",
          background: "radial-gradient(circle,rgba(139,92,246,.26),transparent 62%)",
          filter: "blur(30px)",
          animation: "glowPulse 9s ease-in-out infinite",
        }}
      />
      <div
        className="pointer-events-none fixed z-0"
        style={{
          bottom: "-18%",
          right: "-6%",
          width: 700,
          height: 700,
          borderRadius: "50%",
          background: "radial-gradient(circle,rgba(99,102,241,.22),transparent 62%)",
          filter: "blur(30px)",
          animation: "glowPulse 11s ease-in-out infinite 1s",
        }}
      />

      <div className="relative z-[2] flex min-h-full items-stretch">
        {/* brand panel */}
        <div
          className="relative hidden flex-1 flex-col justify-between overflow-hidden border-r border-white/[0.06] p-[54px_50px] md:flex"
          style={{
            background: "linear-gradient(150deg,rgba(139,92,246,.16),rgba(99,102,241,.05))",
          }}
        >
          <div
            className="pointer-events-none absolute"
            style={{
              top: "20%",
              right: -40,
              width: 280,
              height: 280,
              borderRadius: "50%",
              background: "radial-gradient(circle,rgba(139,92,246,.3),transparent 65%)",
              filter: "blur(24px)",
              animation: "floaty 8s ease-in-out infinite",
            }}
          />
          <div className="relative flex items-center gap-3">
            <LogoMark />
            <div>
              <div className="text-[18px] font-black leading-tight tracking-tight">Q&#8209;Agent</div>
              <div className="text-[10.5px] font-semibold tracking-[0.05em] text-[#a99fce]">
                {t("brand.tagline")}
              </div>
            </div>
          </div>

          <div className="relative max-w-[400px]">
            <h1 className="m-0 mb-4 text-[34px] font-black leading-[1.15] tracking-[-0.03em]">
              {t("brand.heading")}
            </h1>
            <p className="m-0 mb-[26px] text-[14.5px] leading-relaxed text-[#c3c3d4]">
              {t("brand.description")}
            </p>
            <div className="flex flex-col gap-[13px]">
              {BRAND_POINT_KEYS.map((key) => (
                <div key={key} className="flex items-center gap-[11px]">
                  <span
                    className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[7px]"
                    style={{ background: "rgba(16,185,129,.16)" }}
                  >
                    <Check size={13} color="#6ee7b7" strokeWidth={3} />
                  </span>
                  <span className="text-[13.5px] font-medium text-[#dcdce4]">{t(key)}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="relative flex items-center gap-[9px] text-[12px] text-muted">
            <span
              className="h-[7px] w-[7px] rounded-full"
              style={{ background: "#22c55e", boxShadow: "0 0 8px #22c55e" }}
            />
            {t("brand.compliance")}
          </div>
        </div>

        {/* form panel */}
        <div className="flex w-full shrink-0 items-center justify-center p-[40px_30px] md:w-[min(520px,46vw)]">
          <div className="w-full max-w-[380px]" style={{ animation: "fadeInUp .5s ease both" }}>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Full-screen post-login transition: a pulsing logo with expanding rings and a
 * sliding progress bar. Shown while the session bootstraps / the workspace
 * loads. Ported from the design's "AUTH LOADING" overlay.
 */
export function RedirectLoader({ label }: { label?: string }) {
  const { t } = useTranslation("auth");
  const text = label ?? t("redirect.loading");
  return (
    <div
      className="fixed inset-0 z-[90] flex flex-col items-center justify-center gap-[34px] bg-base"
      style={{ animation: "fadeInUp .4s ease both" }}
    >
      <div
        className="pointer-events-none absolute"
        style={{
          top: "-12%",
          left: "-6%",
          width: 620,
          height: 620,
          borderRadius: "50%",
          background: "radial-gradient(circle,rgba(139,92,246,.24),transparent 62%)",
          filter: "blur(30px)",
          animation: "glowPulse 4s ease-in-out infinite",
        }}
      />
      <div
        className="pointer-events-none absolute"
        style={{
          bottom: "-16%",
          right: "-6%",
          width: 600,
          height: 600,
          borderRadius: "50%",
          background: "radial-gradient(circle,rgba(99,102,241,.2),transparent 62%)",
          filter: "blur(30px)",
          animation: "glowPulse 5s ease-in-out infinite 1s",
        }}
      />

      <div className="relative flex h-[132px] w-[132px] items-center justify-center">
        <span
          className="absolute"
          style={{
            width: 96,
            height: 96,
            borderRadius: "50%",
            background: "radial-gradient(circle,rgba(139,92,246,.45),transparent 68%)",
            filter: "blur(10px)",
            animation: "logoHalo 2.6s ease-in-out infinite",
          }}
        />
        {[0, 0.8, 1.6].map((delay) => (
          <span
            key={delay}
            className="absolute inset-0"
            style={{
              borderRadius: "50%",
              border: "1.5px solid rgba(167,139,250,.4)",
              animation: `ring 2.4s ease-out infinite ${delay}s`,
            }}
          />
        ))}
        <span
          className="relative flex h-16 w-16 items-center justify-center"
          style={{
            borderRadius: "50%",
            background: "linear-gradient(135deg,#8b5cf6,#6366f1)",
            boxShadow: "0 0 44px -4px rgba(139,92,246,.9)",
            animation: "logoPulse 2.2s ease-in-out infinite",
          }}
        >
          <Sparkles size={34} color="#fff" strokeWidth={2.2} />
        </span>
      </div>

      <div className="relative text-center">
        <div className="text-[22px] font-black tracking-[-0.02em]">Q&#8209;Agent</div>
        <div className="mt-1.5 text-[12.5px] tracking-[0.03em] text-muted">{text}</div>
      </div>

      <div
        className="relative h-[3px] w-[200px] overflow-hidden rounded-[3px]"
        style={{ background: "rgba(255,255,255,.08)" }}
      >
        <div
          className="absolute top-0 h-full w-[42%] rounded-[3px]"
          style={{
            background: "linear-gradient(90deg,transparent,#a78bfa,#8b5cf6,transparent)",
            animation: "authSlide 1.2s ease-in-out infinite",
          }}
        />
      </div>
    </div>
  );
}
