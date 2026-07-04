import { AnimatePresence, motion } from "framer-motion";
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
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.28, ease: "easeOut" }}
              className="h-full"
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
      <CursorLight />
      <ClickRipples />
    </div>
  );
}
