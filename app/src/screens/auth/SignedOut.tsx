import { Link } from "react-router-dom";
import { LogOut } from "lucide-react";
import { AuthLayout } from "@/components/auth/AuthLayout";

/**
 * PLACEHOLDER (#73 scaffold). Confirmation screen shown after an explicit
 * logout. The refined copy/animation lands in a later slice; the "Sign back
 * in" link is already wired.
 */
export function SignedOut() {
  return (
    <AuthLayout>
      <div className="text-center">
        <div
          className="mx-auto mb-5 flex h-[60px] w-[60px] items-center justify-center rounded-[19px]"
          style={{
            background: "linear-gradient(135deg,#8b5cf6,#6366f1)",
            boxShadow: "0 12px 30px -8px rgba(139,92,246,.7)",
          }}
        >
          <LogOut size={28} color="#fff" strokeWidth={2.2} />
        </div>
        <h2 className="m-0 mb-2 text-[24px] font-black tracking-[-0.02em]">You&#8217;re signed out</h2>
        <p className="m-0 mb-6 text-[13.5px] leading-relaxed text-muted">
          Your session on this device has ended. Sign back in whenever you&#8217;re ready to pick up
          where you left off.
        </p>
        <Link
          to="/login"
          className="flex h-[46px] items-center justify-center rounded-xl text-[14.5px] font-bold text-white"
          style={{
            background: "linear-gradient(135deg,#8b5cf6,#6366f1)",
            boxShadow: "0 10px 26px -8px rgba(139,92,246,.8)",
          }}
        >
          Sign back in
        </Link>
      </div>
    </AuthLayout>
  );
}
