/**
 * Signed-out confirmation (#74) — shown after an explicit logout (ADR 0007).
 * A gradient logout tile, a reassuring line about the session ending, and a
 * full-width "Sign back in" button that returns to `/login`. Ported from the
 * design source's "SIGNED OUT" section.
 */

import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { LogOut } from "lucide-react";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { useAuth } from "@/store/auth";

export function SignedOut() {
  const navigate = useNavigate();
  const { t } = useTranslation("auth");

  // Finalize the local logout here, once we're safely on this public route.
  // Clearing the session from the sidebar instead would race RequireAuth's
  // anon-guard (it would redirect to /login before this navigation commits).
  useEffect(() => {
    useAuth.getState().logout();
  }, []);

  return (
    <AuthLayout>
      <div className="text-center">
        <div
          className="mx-auto mb-5 flex h-[60px] w-[60px] items-center justify-center rounded-[19px]"
          style={{
            background: "linear-gradient(135deg,#8b5cf6,#6366f1)",
            boxShadow: "0 12px 30px -8px rgba(139,92,246,.7)",
            animation: "scaleIn .4s ease both",
          }}
        >
          <LogOut size={28} color="#fff" strokeWidth={2.2} />
        </div>
        <h2 className="m-0 mb-2 text-[24px] font-black tracking-[-0.02em]">{t("signedOut.title")}</h2>
        <p className="m-0 mb-6 text-[13.5px] leading-relaxed text-muted">{t("signedOut.body")}</p>
        <button
          type="button"
          onClick={() => navigate("/login")}
          className="flex h-[46px] w-full items-center justify-center rounded-xl border-none text-[14.5px] font-bold text-white transition-[filter] hover:brightness-110"
          style={{
            background: "linear-gradient(135deg,#8b5cf6,#6366f1)",
            boxShadow: "0 10px 26px -8px rgba(139,92,246,.8)",
          }}
        >
          {t("signedOut.signBackIn")}
        </button>
      </div>
    </AuthLayout>
  );
}
