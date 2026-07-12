import type { SpecStatus } from "@/types/api";

/**
 * Fuchsia hue reserved for "product defect" so it reads as clearly distinct from
 * the script-failure red. Hardcoded here (the Execution slice uses the same hue).
 */
export const PRODUCT_DEFECT_HUE = "#d946ef";

/** Dot colour per normalised spec status (used in the left spec list). */
export const SPEC_STATUS_DOT: Record<SpecStatus, string> = {
  draft: "#3f3f4a",
  blocked: "#fbbf24",
  running: "#fbbf24",
  passed: "#34d399",
  failed: "#fb7185",
  product_defect: PRODUCT_DEFECT_HUE,
};

/**
 * Coerce a raw `spec.status` wire value to a known SpecStatus, defaulting unknown
 * or empty values to "draft" so the UI degrades gracefully before the backend
 * wiring that sets these lands.
 */
export function normalizeSpecStatus(raw: string | undefined): SpecStatus {
  switch (raw) {
    case "blocked":
    case "running":
    case "passed":
    case "failed":
    case "product_defect":
      return raw;
    default:
      return "draft";
  }
}

/**
 * The status to render for a spec: the authoritative `spec.status` when set,
 * otherwise fall back to the latest execution result so pass/fail dots keep
 * working while the backend status wiring is a separate slice.
 */
export function effectiveSpecStatus(specStatus: string | undefined, execStatus: string | undefined): SpecStatus {
  const s = normalizeSpecStatus(specStatus);
  if (s !== "draft") return s;
  if (execStatus === "pass") return "passed";
  if (execStatus === "fail") return "failed";
  if (execStatus === "running") return "running";
  return "draft";
}

/**
 * Defensively parse a `spec.gateReport` JSON string. Returns null for empty or
 * malformed input; never throws.
 */
export function parseGateReport(raw: string | undefined): { outcome?: string; reason?: string } | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as { outcome?: string; reason?: string }) : null;
  } catch {
    return null;
  }
}
