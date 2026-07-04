import { motion } from "framer-motion";
import { Outlet, useLocation } from "react-router-dom";
import { Sidebar } from "@/components/shell/Sidebar";
import { TopBar } from "@/components/shell/TopBar";
import { CursorLight } from "@/components/effects/CursorLight";
import { ClickRipples } from "@/components/effects/ClickRipples";

/** The persistent frame: sidebar + top bar + a scrollable content region. */
export function AppLayout() {
  const location = useLocation();
  return (
    <div className="relative z-[2] flex h-screen w-screen gap-3.5 p-3.5">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col gap-3.5">
        <TopBar />
        <main className="min-h-0 flex-1 overflow-y-auto rounded-[20px]">
          {/*
           * One keyed fade-in per route. No AnimatePresence/exit + `mode="wait"`:
           * that ran exit-then-enter (felt delayed) and let the incoming page
           * paint at full opacity for a frame before `initial` applied (a flash,
           * then a second fade). A plain keyed motion.div applies `initial`
           * inline on first paint, so the page fades in once, immediately.
           */}
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.24, ease: "easeOut" }}
            className="h-full"
          >
            <Outlet />
          </motion.div>
        </main>
      </div>
      <CursorLight />
      <ClickRipples />
    </div>
  );
}
