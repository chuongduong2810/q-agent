import { Command } from "cmdk";
import { motion } from "framer-motion";
import {
  BarChart3,
  CheckSquare,
  FolderKanban,
  Image,
  LayoutDashboard,
  ListChecks,
  Plus,
  Settings as SettingsIcon,
  SquareStack,
  Terminal,
  Ticket,
} from "lucide-react";
import { type ComponentType, useEffect, useRef } from "react";
import { useUI } from "@/store/ui";
import type { Screen } from "@/types";

interface PaletteCommand {
  id: string;
  label: string;
  section: string;
  icon: ComponentType<{ size?: number; strokeWidth?: number }>;
  run: () => void;
}

/** Command palette overlay (⌘K) — cmdk-driven, matching Q-Agent.dc.html lines
 * 556-564 (frosted overlay, scaleIn card, ⌘K input, filtered result list). */
export function CommandPalette() {
  const open = useUI((s) => s.paletteOpen);
  const query = useUI((s) => s.paletteQuery);
  const setQuery = useUI((s) => s.setPaletteQuery);
  const closePalette = useUI((s) => s.closePalette);
  const navigate = useUI((s) => s.navigate);
  const openCreateRun = useUI((s) => s.openCreateRun);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  if (!open) return null;

  const go = (screen: Screen) => () => {
    navigate(screen);
    closePalette();
  };

  const commands: PaletteCommand[] = [
    { id: "dashboard", label: "Go to Dashboard", section: "Navigate", icon: LayoutDashboard, run: go("dashboard") },
    { id: "tickets", label: "Go to Tickets", section: "Navigate", icon: Ticket, run: go("tickets") },
    { id: "runs", label: "Go to Runs", section: "Navigate", icon: SquareStack, run: go("runs") },
    { id: "review", label: "Go to Review Center", section: "Navigate", icon: CheckSquare, run: go("review") },
    { id: "automation", label: "Go to Automation", section: "Navigate", icon: Terminal, run: go("automation") },
    { id: "console", label: "Go to Execution", section: "Navigate", icon: ListChecks, run: go("console") },
    { id: "evidence", label: "Go to Evidence", section: "Navigate", icon: Image, run: go("evidence") },
    { id: "reports", label: "Go to Reports", section: "Navigate", icon: BarChart3, run: go("reports") },
    { id: "settings", label: "Go to Settings", section: "Navigate", icon: SettingsIcon, run: go("settings") },
    {
      id: "create-run",
      label: "Create a Run",
      section: "Action",
      icon: Plus,
      run: () => {
        openCreateRun();
        closePalette();
      },
    },
    { id: "run-execution", label: "Run execution", section: "Action", icon: Terminal, run: go("console") },
  ];

  // Also route "Projects" — not in the design's default list but keeps
  // parity with the sidebar; kept out of the frozen command set above.

  return (
    <div
      onClick={closePalette}
      className="fixed inset-0 z-50 flex items-start justify-center animate-[fadeInUp_.2s_ease_both] pt-[14vh]"
      style={{ background: "rgba(6,6,10,.6)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)" }}
    >
      <motion.div
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.22, ease: "easeOut" }}
        className="w-[min(600px,92vw)] overflow-hidden rounded-[20px] border border-white/[0.11] shadow-[0_40px_90px_-20px_rgba(0,0,0,.8)]"
        style={{ background: "rgba(24,24,32,.9)", backdropFilter: "blur(40px)", WebkitBackdropFilter: "blur(40px)" }}
      >
        <Command shouldFilter value={query} onValueChange={setQuery} label="Command palette">
          <div className="flex items-center gap-3 border-b border-white/[0.07] px-5 py-4">
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3l1.9 5.3L19 10l-5.1 1.7L12 17l-1.9-5.3L5 10l5.1-1.7z" />
            </svg>
            <Command.Input
              ref={inputRef}
              value={query}
              onValueChange={setQuery}
              placeholder="Type a command or search…"
              className="flex-1 border-none bg-transparent text-[16px] text-ink outline-none placeholder:text-[#7a7a8c]"
            />
            <span className="rounded-md bg-white/[0.06] px-2 py-[3px] font-mono text-[11px] text-[#8b8b9e]">ESC</span>
          </div>
          <Command.List className="max-h-[340px] overflow-y-auto p-2">
            <Command.Empty className="px-3 py-6 text-center text-[13px] text-ink-dim">No matching commands.</Command.Empty>
            {commands.map((cmd) => {
              const Icon = cmd.icon;
              return (
                <Command.Item
                  key={cmd.id}
                  value={cmd.label}
                  onSelect={cmd.run}
                  className="flex w-full cursor-pointer items-center gap-[13px] rounded-xl px-[13px] py-[11px] text-left data-[selected=true]:bg-[rgba(139,92,246,.16)]"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-white/[0.06]">
                    <Icon size={15} strokeWidth={2} />
                  </span>
                  <span className="flex-1 text-[14px] font-medium text-ink">{cmd.label}</span>
                  <span className="text-[11px] font-medium text-[#7a7a8c]">{cmd.section}</span>
                </Command.Item>
              );
            })}
          </Command.List>
        </Command>
      </motion.div>
    </div>
  );
}
