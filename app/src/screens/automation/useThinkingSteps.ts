import { useEffect, useState } from "react";

/** `pipeline` namespace translation keys for the generation "thinking" ticker;
 * the consuming component (`ThinkingBanner`) maps each to `t()` for display. */
export const THINKING_STEPS = [
  "progress.thinking.steps.reading",
  "progress.thinking.steps.mapping",
  "progress.thinking.steps.assertions",
  "progress.thinking.steps.formatting",
];

/**
 * Advances the "thinking" step ticker used by the generation placeholder card.
 * Steps forward once every 1100ms, clamped to the last step, and resets to 0
 * whenever `thinking` is false.
 *
 * @param thinking Whether the generation placeholder is currently shown.
 * @returns The current step index.
 */
export function useThinkingSteps(thinking: boolean) {
  const [thinkStep, setThinkStep] = useState(0);
  useEffect(() => {
    if (!thinking) {
      setThinkStep(0);
      return;
    }
    const id = setInterval(() => {
      setThinkStep((n) => Math.min(n + 1, THINKING_STEPS.length - 1));
    }, 1100);
    return () => clearInterval(id);
  }, [thinking]);
  return thinkStep;
}
