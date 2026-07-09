/**
 * PLACEHOLDER (#73 scaffold). The real account screen (identity card, personal
 * info form via `api.auth.updateMe`, password change, 2FA, active sessions,
 * delete account) lands in the Profile slice, which replaces this file. Renders
 * inside the app shell (child of `RequireAuth` → `App`).
 */
export function Profile() {
  return (
    <div className="mx-auto max-w-[720px] py-10">
      <h1 className="m-0 mb-2 text-[26px] font-black tracking-[-0.03em]">Your profile</h1>
      <p className="m-0 text-[13.5px] text-muted">Account settings coming soon.</p>
    </div>
  );
}
