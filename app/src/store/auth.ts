/**
 * Auth session state (Zustand) — ADR 0007. Companion to the UI store
 * (`store/ui.ts`), but for the authenticated principal + access token rather
 * than ephemeral UI.
 *
 * The access token is held **in memory only** — never persisted to
 * localStorage. The durable credential is the backend's httpOnly refresh
 * cookie; a fresh page load restores the session via `bootstrap()`, which
 * exchanges that cookie for a new access token. `lib/api.ts` reads the token
 * from here (`useAuth.getState()`) to attach the `Authorization` header and to
 * drive the silent 401 → refresh → retry flow.
 */

import { create } from "zustand";
import { api } from "@/lib/api";
import type { User } from "@/types/api";

export type AuthStatus = "idle" | "loading" | "authed" | "anon";

interface AuthState {
  user: User | null;
  accessToken: string | null;
  /** "idle" until `bootstrap()` runs; "loading" while refreshing; then
   * "authed" (session restored) or "anon" (no valid session). */
  status: AuthStatus;
  /** Install a freshly minted access token + principal (login / refresh). */
  setSession: (session: { accessToken: string; user: User }) => void;
  /** Clear all session state. Call after a server logout or a failed refresh. */
  logout: () => void;
  /** Restore a session from the refresh cookie. Safe to call once on app load
   * (RequireAuth guards on `status === "idle"`); concurrent calls are ignored. */
  bootstrap: () => Promise<void>;
}

export const useAuth = create<AuthState>((set, get) => ({
  user: null,
  accessToken: null,
  status: "idle",

  setSession: ({ accessToken, user }) => set({ accessToken, user, status: "authed" }),

  logout: () => set({ user: null, accessToken: null, status: "anon" }),

  bootstrap: async () => {
    if (get().status === "loading") return;
    set({ status: "loading" });
    try {
      const { accessToken, user } = await api.auth.refresh();
      set({ accessToken, user, status: "authed" });
    } catch {
      set({ user: null, accessToken: null, status: "anon" });
    }
  },
}));
