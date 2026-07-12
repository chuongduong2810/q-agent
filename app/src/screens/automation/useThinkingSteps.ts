import { useEffect, useState } from "react";

export const THINKING_STEPS = [
  "Reading approved test cases",
  "Mapping steps to Playwright locators",
  "Writing assertions",
  "Formatting TypeScript specs",
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
