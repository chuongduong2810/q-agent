import type { ExploreStep } from "./useAutomationEvents";

/** Sky-blue accent for the DOM-exploration UI — distinct from generation
 * (violet), self-heal (emerald), and the Run action (cyan). */
export const EXPLORE_HUE = "#38bdf8";

/** Human-readable one-liner for an exploration step's action + args (ADR 0010
 * §3 action contract). Used by both the live step banner and the review trail. */
export function describeExploreStep(step: ExploreStep): string {
  const a = step.args ?? {};
  const target =
    typeof a.role === "string" && typeof a.name === "string"
      ? `${a.role} "${a.name}"`
      : typeof a.testId === "string"
        ? `[data-testid="${a.testId}"]`
        : typeof a.selector === "string"
          ? String(a.selector)
          : typeof a.label === "string"
            ? `"${a.label}"`
            : "";
  switch (step.action) {
    case "goto":
      return `Navigate to ${typeof a.url === "string" ? a.url : "a route"}`;
    case "click":
      return `Click ${target}`.trim();
    case "fill":
      return `Fill ${target}${typeof a.value === "string" ? ` = "${a.value}"` : ""}`.trim();
    case "expectVisible":
      return `Check ${target} is visible`.trim();
    case "done":
      return "Finished — goal reached";
    default:
      return step.action;
  }
}
