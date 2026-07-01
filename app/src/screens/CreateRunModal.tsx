import { useUI } from "@/store/ui";

/** Create-Run modal overlay. Feature agent implements the full form. */
export function CreateRunModal() {
  const open = useUI((s) => s.createRunOpen);
  if (!open) return null;
  return null;
}
