import { Check, ChevronDown, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";

export interface Option {
  value: string;
  label: string;
  hint?: string;
}

/** Shared trigger + floating glass panel used by Select / MultiSelect (and any
 * custom-labeled dropdown, e.g. the Tickets connection picker). */
export function DropdownShell({
  active,
  label,
  onClear,
  children,
  minWidth = 200,
}: {
  active: boolean;
  label: ReactNode;
  onClear?: () => void;
  children: (close: () => void) => ReactNode;
  minWidth?: number;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Anchor the (portalled) panel to the trigger in viewport coordinates. Clamp
  // to the right edge so a trigger near the window border doesn't overflow.
  const place = () => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = Math.max(minWidth, r.width);
    setPos({ top: r.bottom + 6, left: Math.min(r.left, window.innerWidth - width - 12), width });
  };

  useEffect(() => {
    if (!open) return;
    place();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    const reposition = () => place();
    window.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 cursor-pointer items-center gap-2 rounded-[11px] border px-[13px] text-[12.5px] font-semibold transition-colors"
        style={
          active
            ? { background: "rgba(139,92,246,.2)", borderColor: "rgba(139,92,246,.35)", color: "#fff" }
            : { background: "rgba(255,255,255,.05)", borderColor: "rgba(255,255,255,.09)", color: "#dcdce4" }
        }
      >
        <span className="max-w-[180px] truncate">{label}</span>
        {active && onClear ? (
          <X
            size={13}
            className="text-ink-dim hover:text-white"
            onClick={(e) => {
              e.stopPropagation();
              onClear();
              setOpen(false);
            }}
          />
        ) : (
          <ChevronDown size={14} className="text-ink-dim" />
        )}
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            className="fixed z-[1000] max-h-[320px] overflow-y-auto rounded-[14px] border border-white/[0.12] p-1.5 shadow-[0_30px_70px_-20px_rgba(0,0,0,.8)]"
            style={{ top: pos.top, left: pos.left, minWidth: pos.width, background: "rgb(24,24,32)" }}
          >
            {children(() => setOpen(false))}
          </div>,
          document.body,
        )}
    </div>
  );
}

/** Styled single-select dropdown (replaces the native <select>). */
export function Select({
  value,
  options,
  placeholder,
  onChange,
  allowClear = true,
  emptyLabel,
}: {
  value: string | null;
  options: Option[];
  placeholder: string;
  onChange: (value: string | null) => void;
  allowClear?: boolean;
  emptyLabel?: string;
}) {
  const selected = options.find((o) => o.value === value) ?? null;
  return (
    <DropdownShell
      active={!!selected}
      label={selected ? selected.label : placeholder}
      onClear={allowClear ? () => onChange(null) : undefined}
    >
      {(close) => (
        <>
          {options.length === 0 && (
            <div className="px-3 py-4 text-center text-[12px] text-ink-dim">
              {emptyLabel ?? "No options"}
            </div>
          )}
          {options.map((o) => {
            const on = o.value === value;
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => {
                  onChange(on ? null : o.value);
                  close();
                }}
                className="flex w-full cursor-pointer items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left text-[13px] hover:bg-white/[0.06] data-[on=true]:bg-[rgba(139,92,246,.16)]"
                data-on={on}
              >
                <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                  {on && <Check size={13} className="text-violet" strokeWidth={3} />}
                </span>
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                {o.hint && <span className="shrink-0 text-[11px] text-ink-dim">{o.hint}</span>}
              </button>
            );
          })}
        </>
      )}
    </DropdownShell>
  );
}

/** Styled multi-select dropdown (checkbox list). */
export function MultiSelect({
  values,
  options,
  placeholder,
  onChange,
}: {
  values: string[];
  options: Option[];
  placeholder: string;
  onChange: (values: string[]) => void;
}) {
  const set = new Set(values);
  const label =
    values.length === 0
      ? placeholder
      : values.length === 1
        ? (options.find((o) => o.value === values[0])?.label ?? values[0])
        : `${placeholder} · ${values.length}`;
  const toggle = (v: string) => {
    const next = new Set(set);
    next.has(v) ? next.delete(v) : next.add(v);
    onChange([...next]);
  };
  return (
    <DropdownShell
      active={values.length > 0}
      label={label}
      onClear={values.length ? () => onChange([]) : undefined}
    >
      {() => (
        <>
          {options.length === 0 && (
            <div className="px-3 py-4 text-center text-[12px] text-ink-dim">No options</div>
          )}
          {options.map((o) => {
            const on = set.has(o.value);
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => toggle(o.value)}
                className="flex w-full cursor-pointer items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left text-[13px] hover:bg-white/[0.06]"
              >
                <span
                  className="flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-[5px] border"
                  style={{
                    background: on ? "linear-gradient(135deg,#8b5cf6,#6366f1)" : "rgba(255,255,255,.04)",
                    borderColor: on ? "transparent" : "rgba(255,255,255,.16)",
                  }}
                >
                  {on && <Check size={11} color="#fff" strokeWidth={3.2} />}
                </span>
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
              </button>
            );
          })}
        </>
      )}
    </DropdownShell>
  );
}
