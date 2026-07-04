import type { ReactNode } from "react";

/**
 * Temporary placeholder used by not-yet-implemented screens so the shell renders
 * end-to-end. Feature agents replace each screen file's contents entirely.
 */
export function ScreenScaffold({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="px-1 pb-10 pt-0.5">
      <h1 className="m-0 text-[28px] font-black tracking-tight">{title}</h1>
      <p className="mt-2 text-[13px] text-ink-dim">Coming online…</p>
      {children}
    </div>
  );
}
