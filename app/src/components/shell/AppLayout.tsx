import type { ReactNode } from "react";
import { Sidebar } from "@/components/shell/Sidebar";
import { TopBar } from "@/components/shell/TopBar";

/** The persistent frame: sidebar + top bar + a scrollable content region. */
export function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative z-[2] flex h-screen w-screen gap-3.5 p-3.5">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col gap-3.5">
        <TopBar />
        <main className="min-h-0 flex-1 overflow-y-auto rounded-[20px]">{children}</main>
      </div>
    </div>
  );
}
