/**
 * Shared Claude model catalog. Hoisted from Settings so the spec-chat model chip
 * and the per-action override dropdowns offer one identical list.
 */

/** The Claude models offered in the per-action override dropdowns. */
export const AI_MODEL_OPTIONS = [
  { value: "claude-opus-4-8", label: "Opus 4.8 — highest quality" },
  { value: "claude-sonnet-5", label: "Sonnet 5 — balanced" },
  { value: "claude-haiku-4-5-20251001", label: "Haiku 4.5 — fastest" },
];
