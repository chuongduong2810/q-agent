import type { TFunction } from "i18next";
import type { ExploreStep } from "./useAutomationEvents";

/** Sky-blue accent for the DOM-exploration UI — distinct from generation
 * (violet), self-heal (emerald), and the Run action (cyan). */
export const EXPLORE_HUE = "#38bdf8";

/** Human-readable one-liner for an exploration step's action + args (ADR 0010
 * §3 action contract). Used by both the live step banner and the review trail.
 * `t` is the `pipeline` namespace translator supplied by the calling component. */
export function describeExploreStep(step: ExploreStep, t: TFunction): string {
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
      return t("progress.explore.step.goto", {
        target: typeof a.url === "string" ? a.url : t("progress.explore.aRoute"),
      });
    case "click":
      return t("progress.explore.step.click", { target }).trim();
    case "fill":
      return (
        typeof a.value === "string"
          ? t("progress.explore.step.fillValue", { target, value: a.value })
          : t("progress.explore.step.fill", { target })
      ).trim();
    case "expectVisible":
      return t("progress.explore.step.expectVisible", { target }).trim();
    case "done":
      return t("progress.explore.step.done");
    default:
      return step.action;
  }
}
