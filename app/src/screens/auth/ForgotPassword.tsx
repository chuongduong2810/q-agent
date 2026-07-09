import { AuthLayout } from "@/components/auth/AuthLayout";

/**
 * PLACEHOLDER (#73 scaffold). The real reset-request form (email → sent
 * confirmation, `api.auth.requestReset`) lands in the Forgot slice, which
 * replaces this file.
 */
export function ForgotPassword() {
  return (
    <AuthLayout>
      <div className="mb-6">
        <h2 className="m-0 mb-1.5 text-[26px] font-black tracking-[-0.02em]">Reset password</h2>
        <p className="m-0 text-[13.5px] leading-relaxed text-muted">
          Enter your work email and we&#8217;ll send you a secure reset link.
        </p>
      </div>
      <p className="text-[13px] text-faint">Reset form coming soon.</p>
    </AuthLayout>
  );
}
