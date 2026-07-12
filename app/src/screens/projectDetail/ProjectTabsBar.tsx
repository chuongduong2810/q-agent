import { type ProjectTab } from "@/store/ui";

export const TABS: { id: ProjectTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "knowledge", label: "Project Knowledge" },
  { id: "tickets", label: "Tickets" },
  { id: "runs", label: "Runs" },
  { id: "settings", label: "Settings" },
];

/** Project detail tab bar. Highlights the active tab; each click is delegated to
 * `onSelect` (the screen routes tickets/runs away and query-syncs the rest). */
export function ProjectTabsBar({
  active,
  onSelect,
}: {
  active: ProjectTab;
  onSelect: (id: ProjectTab) => void;
}) {
  return (
    <div className="mb-[18px] flex flex-wrap gap-2 border-b border-white/[0.06] pb-4">
      {TABS.map((t) => {
        const isActive = active === t.id;
        return (
          <button
            key={t.id}
            onClick={() => onSelect(t.id)}
            className="cursor-pointer whitespace-nowrap rounded-[11px] border-none px-[15px] py-[9px] text-[13px] font-semibold"
            style={
              isActive
                ? {
                    background: "linear-gradient(135deg,rgba(139,92,246,.24),rgba(99,102,241,.12))",
                    color: "#fff",
                    boxShadow: "inset 0 0 0 1px rgba(139,92,246,.3)",
                  }
                : { background: "rgba(255,255,255,.04)", color: "#a0a0b2" }
            }
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
