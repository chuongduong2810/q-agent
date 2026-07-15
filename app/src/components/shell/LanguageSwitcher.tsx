import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import { SUPPORTED_LANGUAGES } from "@/i18n";

/**
 * Compact EN | VI segmented control. Writes through `i18n.changeLanguage`, which
 * the browser-language detector persists to `localStorage` (`qagent.lang`) — a
 * pure client-side display preference (ADR 0011). Used in the TopBar and the
 * Settings → INTERFACE section.
 */
export function LanguageSwitcher({ className }: { className?: string }) {
  const { i18n } = useTranslation();
  const current = i18n.resolvedLanguage ?? i18n.language;

  return (
    <div
      className={cn(
        "flex items-center gap-0.5 rounded-[10px] border border-white/[0.08] bg-white/[0.04] p-0.5",
        className,
      )}
    >
      {SUPPORTED_LANGUAGES.map((l) => {
        const active = current === l.code;
        return (
          <button
            key={l.code}
            type="button"
            onClick={() => void i18n.changeLanguage(l.code)}
            aria-pressed={active}
            title={l.label}
            className={cn(
              "rounded-[8px] px-2.5 py-1 text-[11.5px] font-semibold transition-colors",
              active ? "text-white" : "text-ink-dim hover:text-white",
            )}
            style={
              active
                ? { background: "linear-gradient(135deg,rgba(139,92,246,.9),rgba(99,102,241,.75))" }
                : undefined
            }
          >
            {l.short}
          </button>
        );
      })}
    </div>
  );
}
