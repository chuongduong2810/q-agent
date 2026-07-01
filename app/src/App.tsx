import { AnimatePresence, motion } from "framer-motion";
import { useEffect, type ComponentType } from "react";
import { Toaster } from "sonner";
import { NeuralBackground } from "@/components/background/NeuralBackground";
import { AppLayout } from "@/components/shell/AppLayout";
import { QueryProvider } from "@/app/QueryProvider";
import { useRuns } from "@/hooks/queries";
import { useUI } from "@/store/ui";
import type { Screen } from "@/types";

import { Dashboard } from "@/screens/Dashboard";
import { Projects } from "@/screens/Projects";
import { ProjectDetail } from "@/screens/ProjectDetail";
import { KnowledgeBuildOverlay } from "@/screens/KnowledgeBuildOverlay";
import { Tickets } from "@/screens/Tickets";
import { TicketDetail } from "@/screens/TicketDetail";
import { Runs } from "@/screens/Runs";
import { RunDetail } from "@/screens/RunDetail";
import { ReviewCenter } from "@/screens/ReviewCenter";
import { Automation } from "@/screens/Automation";
import { Execution } from "@/screens/Execution";
import { Evidence } from "@/screens/Evidence";
import { CommentPublish } from "@/screens/CommentPublish";
import { Reports } from "@/screens/Reports";
import { Settings } from "@/screens/Settings";
import { CommandPalette } from "@/screens/CommandPalette";
import { CreateRunModal } from "@/screens/CreateRunModal";

const SCREENS: Record<Screen, ComponentType> = {
  dashboard: Dashboard,
  projects: Projects,
  project: ProjectDetail,
  tickets: Tickets,
  ticket: TicketDetail,
  runs: Runs,
  run: RunDetail,
  review: ReviewCenter,
  automation: Automation,
  console: Execution,
  evidence: Evidence,
  comment: CommentPublish,
  reports: Reports,
  settings: Settings,
};

function Shell() {
  const screen = useUI((s) => s.screen);
  const activeRunId = useUI((s) => s.activeRunId);
  const setActiveRun = useUI((s) => s.setActiveRun);
  const togglePalette = useUI((s) => s.togglePalette);
  const closePalette = useUI((s) => s.closePalette);
  const closeCreateRun = useUI((s) => s.closeCreateRun);
  const { data: runs } = useRuns();

  // Default the "active run" to the in-progress run (or the most recent) once runs load.
  useEffect(() => {
    if (activeRunId == null && runs && runs.length) {
      const active = runs.find((r) => r.status !== "done") ?? runs[0];
      setActiveRun(active.id);
    }
  }, [runs, activeRunId, setActiveRun]);

  // Global keyboard: ⌘K / Ctrl-K toggles the palette; Escape closes overlays.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        togglePalette();
      }
      if (e.key === "Escape") {
        closePalette();
        closeCreateRun();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePalette, closePalette, closeCreateRun]);

  const ActiveScreen = SCREENS[screen];

  return (
    <>
      <AppLayout>
        <AnimatePresence mode="wait">
          <motion.div
            key={screen}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.28, ease: "easeOut" }}
            className="h-full"
          >
            <ActiveScreen />
          </motion.div>
        </AnimatePresence>
      </AppLayout>
      <CommandPalette />
      <CreateRunModal />
      <KnowledgeBuildOverlay />
    </>
  );
}

export default function App() {
  return (
    <QueryProvider>
      <NeuralBackground />
      <Shell />
      <Toaster
        theme="dark"
        position="bottom-right"
        toastOptions={{
          style: {
            background: "rgba(24,24,32,.92)",
            border: "1px solid rgba(255,255,255,.11)",
            color: "#ececf1",
            backdropFilter: "blur(20px)",
          },
        }}
      />
    </QueryProvider>
  );
}
