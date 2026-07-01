/** A labeled row with a description and a pill toggle switch — matches the
 * design's `settingsToggles.*` track/knob styling (Q-Agent.dc.html 543-545). */
export function ToggleRow({
  title,
  description,
  checked,
  onChange,
  bordered = true,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  bordered?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between py-[13px] ${bordered ? "border-b border-white/[0.06]" : ""}`}
    >
      <div>
        <div className="text-[14px] font-semibold">{title}</div>
        <div className="text-[12px] text-muted">{description}</div>
      </div>
      <div
        onClick={() => onChange(!checked)}
        className="h-[26px] w-[46px] shrink-0 cursor-pointer rounded-full p-[3px] transition-colors"
        style={{ background: checked ? "linear-gradient(135deg,#8b5cf6,#6366f1)" : "rgba(255,255,255,.1)" }}
      >
        <div
          className="h-5 w-5 rounded-full bg-white transition-transform"
          style={{ transform: checked ? "translateX(20px)" : "translateX(0)" }}
        />
      </div>
    </div>
  );
}
