import { AuthLayout } from "@/components/auth/AuthLayout";

/**
 * PLACEHOLDER (#73 scaffold). The real sign-in form (email/password, MFA
 * challenge, "keep me signed in", bootstrap-on-success) lands in the Login
 * slice, which replaces this file. Intentionally no SSO buttons.
 */
export function Login() {
  return (
    <AuthLayout>
      <div className="mb-6">
        <h2 className="m-0 mb-1.5 text-[26px] font-black tracking-[-0.02em]">Welcome back</h2>
        <p className="m-0 text-[13.5px] text-muted">Sign in to your Q&#8209;Agent workspace.</p>
      </div>
      <p className="text-[13px] text-faint">Sign-in form coming soon.</p>
    </AuthLayout>
  );
}
