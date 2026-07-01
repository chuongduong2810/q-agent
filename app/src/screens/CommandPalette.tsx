import { useUI } from "@/store/ui";

/** Command palette overlay (⌘K). Feature agent implements the full cmdk UI. */
export function CommandPalette() {
  const open = useUI((s) => s.paletteOpen);
  if (!open) return null;
  return null;
}
