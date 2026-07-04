import { useEffect } from "react";
import { Toaster } from "sonner";
import { NeuralBackground } from "@/components/background/NeuralBackground";
import { AppLayout } from "@/components/shell/AppLayout";
import { UrlStoreSync } from "@/components/shell/UrlStoreSync";
import { QueryProvider } from "@/app/QueryProvider";
import { useUI } from "@/store/ui";

import { KnowledgeBuildOverlay } from "@/screens/KnowledgeBuildOverlay";
import { CommandPalette } from "@/screens/CommandPalette";
import { CreateRunModal } from "@/screens/CreateRunModal";

/**
 * Root layout element for the data router (see router.tsx). Wraps the app in the
 * query provider and background, mounts the shell (`AppLayout` renders the
 * matched route via `<Outlet/>`), the URL→store bridge, and global overlays.
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
      <NeuralBackground />
      <UrlStoreSync />
      <AppLayout />
      <CommandPalette />
      <CreateRunModal />
      <KnowledgeBuildOverlay />
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
