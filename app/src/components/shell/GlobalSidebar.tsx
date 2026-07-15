import { LogOut, Sparkles, User, UserRound } from "lucide-react";
import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import { cn } from "@/lib/cn";
import { useTilt } from "@/hooks/useTilt";
import { useLogout } from "@/hooks/useLogout";
import emeLogo from "@/public/eme-3d-logo-cut.png";
import { useAuth } from "@/store/auth";
import {
  ADMIN_NAV,
  PRIMARY_NAV,
  SECONDARY_NAV,
  activeNavPath,
  type NavItem,
} from "@/components/shell/navConfig";

/** The global (non-run) sidebar: brand header, two global nav groups, account
 * footer. Structurally the pre-split sidebar, minus the run-scoped items. */
export function GlobalSidebar() {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  // Much stronger tilt for the hero brand logo than the default card tilt.
  const logoTilt = useTilt({ maxX: 20, maxY: 26, scale: 1.1, perspective: 760 });

  // Identity comes from the authenticated principal (/auth/me) — the app subtree
  // renders only behind RequireAuth, so `user` is present in normal use. The
  // settings.json userName/userRole fields were retired (#79).
  const user = useAuth((s) => s.user);

  const userInitials = user
    ? `${user.firstName?.[0] ?? ""}${user.lastName?.[0] ?? ""}`.toUpperCase()
    : "";
  const displayName = user ? `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() : "";
  const displayRole = user?.role ?? "";
  const hasIdentity = displayName.length > 0;
  const isAdmin = user?.role === "admin";

  // Single-active navigation (see activeNavPath): pick the ONE item whose path
  // is the longest boundary-aware match, so a nested admin route under
  // /settings/* highlights only its own item — never its "Settings" ancestor.
  const allNav = [...PRIMARY_NAV, ...SECONDARY_NAV, ...(isAdmin ? ADMIN_NAV : [])];
  const activePath = activeNavPath(allNav, pathname);
  const isActive = (path: string): boolean => path === activePath;

  const renderItem = (n: NavItem) => {
    const active = isActive(n.path);
    const Icon = n.icon;
    return (
      <button
        key={n.path}
        data-tour={`nav-${n.label.toLowerCase().replace(/\s+/g, "-")}`}
        onClick={() => navigate(n.path)}
        className={cn(
          "flex w-full items-center gap-3 rounded-xl border-none px-3 py-[9px] text-left text-[13.5px] font-semibold transition-colors",
          active ? "text-white" : "text-ink-dim hover:bg-white/[0.06]",
        )}
        // Inactive items get no inline background so the `hover:bg-white/[0.06]`
        // class can take effect — an inline `background:transparent` would
        // override the hover rule (inline styles beat :hover classes).
        style={
          active
            ? {
                background:
                  "linear-gradient(135deg,rgba(139,92,246,.22),rgba(99,102,241,.12))",
                boxShadow: "inset 0 0 0 1px rgba(139,92,246,.28)",
              }
            : undefined
        }
      >
        <span className="flex w-[18px] justify-center">
          <Icon size={18} strokeWidth={2} />
        </span>
        <span className="flex-1">{n.label}</span>
      </button>
    );
  };

  // Account popover: portalled to <body> with fixed positioning anchored to the
  // trigger's bounding rect (project rule — the sidebar's glass/backdrop-filter
  // creates a stacking context that would otherwise trap a child z-index).
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuRect, setMenuRect] = useState<DOMRect | null>(null);
  const menuOpen = menuRect !== null;

  const openMenu = () => {
    if (triggerRef.current) setMenuRect(triggerRef.current.getBoundingClientRect());
  };
  const closeMenu = () => setMenuRect(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      closeMenu();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMenu();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  const go = (path: string) => {
    closeMenu();
    navigate(path);
  };

  const logout = useLogout();
  const handleLogout = () => {
    closeMenu();
    logout();
  };

  const avatarInitials = userInitials;
  const avatar = (
    <div className="h-8 w-8 rounded-[10px] text-[13px]">
      {avatarInitials ? (
        <div
          className="flex h-full w-full items-center justify-center rounded-[10px] font-bold text-white"
          style={{ background: "linear-gradient(135deg,#f59e0b,#f43f5e)" }}
        >
          {avatarInitials}
        </div>
      ) : (
        <div className="flex h-full w-full items-center justify-center rounded-[10px] bg-white/[0.08] text-[#9494a6]">
          <User size={16} strokeWidth={2} />
        </div>
      )}
    </div>
  );

  return (
    <aside className="glass-strong flex w-[248px] shrink-0 flex-col rounded-[22px] p-[20px_14px] shadow-[0_24px_60px_-20px_rgba(0,0,0,.6)]">
      {/* EMESOFT 3D brand logo (background keyed out) — floats transparently on
          the sidebar with a cursor-tracked tilt (see useTilt). The tilt +
          pointer handlers live on a generously padded wrapper so the hover
          zone is a comfortable target, not the thin logo strip itself. */}
      <div className="px-1 pb-2 pt-1">
        <motion.div
          onPointerMove={logoTilt.onPointerMove}
          onPointerLeave={logoTilt.onPointerLeave}
          style={logoTilt.style}
          className="flex w-full cursor-pointer justify-center px-4 py-5"
        >
          <img
            src={emeLogo}
            alt="EMESOFT"
            draggable={false}
            className="h-auto w-full max-w-[204px] select-none drop-shadow-[0_10px_16px_rgba(0,0,0,0.5)]"
          />
        </motion.div>
      </div>

      <div className="flex items-center gap-[11px] px-2 pb-[18px] pt-1.5">
        <div className="accent-gradient flex h-[34px] w-[34px] items-center justify-center rounded-[11px] shadow-[0_6px_18px_-4px_rgba(139,92,246,.7)]">
          <Sparkles size={19} color="#fff" strokeWidth={2.2} />
        </div>
        <div>
          <div className="text-[16px] font-black leading-tight tracking-tight">Q&#8209;Agent</div>
          <div className="text-[10.5px] font-medium tracking-[0.04em] text-[#7a7a8c]">
            QA OPERATING SYSTEM
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-[9.5px] font-semibold tracking-[0.08em] text-[#5c5c6e]">
            <span className="h-1 w-1 rounded-full bg-[#8b5cf6]" />
            AN EMESOFT PRODUCT
          </div>
        </div>
      </div>

      <div className="px-2.5 pb-2 pt-1 text-[10px] font-semibold tracking-[0.11em] text-[#5c5c6e]">
        WORKSPACE
      </div>

      <nav className="-mx-1 flex flex-col gap-0.5 overflow-y-auto px-1">
        {PRIMARY_NAV.map(renderItem)}
        <hr className="mx-1.5 my-2 border-0 border-t border-white/[0.06]" />
        {SECONDARY_NAV.map(renderItem)}
        {isAdmin && (
          <>
            <div className="flex items-center gap-2 px-2.5 pb-2 pt-3.5">
              <span className="text-[10px] font-semibold tracking-[0.11em] text-[#5c5c6e]">
                ADMIN
              </span>
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-[7px] py-[1.5px] text-[8.5px] font-bold uppercase tracking-[0.07em] text-[#7a7a8c]">
                Restricted
              </span>
            </div>
            {ADMIN_NAV.map(renderItem)}
          </>
        )}
      </nav>

      <div className="mt-auto flex flex-col gap-3 pt-3">
        <button
          ref={triggerRef}
          onClick={() => (menuOpen ? closeMenu() : openMenu())}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          className={cn(
            "flex items-center gap-2.5 rounded-2xl px-2.5 py-1.5 text-left transition-colors hover:bg-white/[0.05]",
            menuOpen && "bg-white/[0.05]",
          )}
        >
          {avatar}
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12.5px] font-semibold">
              {hasIdentity ? displayName : "Set your identity"}
            </div>
            <div className="truncate text-[10.5px] capitalize text-[#7a7a8c]">
              {hasIdentity ? displayRole || "—" : "Settings → Profile"}
            </div>
          </div>
        </button>
      </div>

      {menuOpen &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            className="fixed z-[1000] overflow-hidden rounded-2xl border border-white/10 bg-[#16161f] p-1.5 shadow-[0_24px_60px_-16px_rgba(0,0,0,.7)]"
            style={{
              left: menuRect.left,
              bottom: window.innerHeight - menuRect.top + 8,
              width: Math.max(menuRect.width, 200),
            }}
          >
            <button
              role="menuitem"
              onClick={() => go("/profile")}
              className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[13px] font-medium text-ink-dim transition-colors hover:bg-white/[0.06] hover:text-white"
            >
              <UserRound size={16} strokeWidth={2} />
              <span>Profile</span>
            </button>
            <hr className="mx-1 my-1.5 border-0 border-t border-white/[0.08]" />
            <button
              role="menuitem"
              onClick={handleLogout}
              className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[13px] font-medium text-rose-300 transition-colors hover:bg-rose-500/10 hover:text-rose-200"
            >
              <LogOut size={16} strokeWidth={2} />
              <span>Log out</span>
            </button>
          </div>,
          document.body,
        )}
    </aside>
  );
}
