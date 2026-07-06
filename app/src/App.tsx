import { useEffect } from "react";
import { Toaster } from "sonner";
import { AppBackground } from "@/components/background/AppBackground";
import { AppLayout } from "@/components/shell/AppLayout";
import { QueryProvider } from "@/app/QueryProvider";
import { useUI } from "@/store/ui";

import { KnowledgeBuildOverlay } from "@/screens/KnowledgeBuildOverlay";
import { CommandPalette } from "@/screens/CommandPalette";
import { CreateRunModal } from "@/screens/CreateRunModal";

/**
 * Root layout element for the data router (see router.tsx). Wraps the app in the
 * query provider and background, mounts the shell (`AppLayout` renders the
 * matched route via `<Outlet/>`), and global overlays.
 */
export default function App() {
  const togglePalette = useUI((s) => s.togglePalette);
  const closePalette = useUI((s) => s.closePalette);
  const closeCreateRun = useUI((s) => s.closeCreateRun);

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

  return (
    <QueryProvider>
      <AppBackground />
      <AppLayout />
      <CommandPalette />
      <CreateRunModal />
      <KnowledgeBuildOverlay />
      <Toaster
        theme="dark"
        position="bottom-center"
        toastOptions={{
          style: {
            background: "rgba(22,22,30,.9)",
            backdropFilter: "blur(24px) saturate(1.3)",
            WebkitBackdropFilter: "blur(24px) saturate(1.3)",
            border: "1px solid rgba(255,255,255,.1)",
            borderRadius: "11px",
            boxShadow: "0 16px 40px -16px rgba(0,0,0,.8)",
            color: "#f4f4f8",
            fontSize: "13px",
            fontWeight: 600,
            padding: "9px 14px",
          },
        }}
      />
    </QueryProvider>
  );
}
