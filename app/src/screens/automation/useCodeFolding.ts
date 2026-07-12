import { useCallback, useEffect, useMemo, useState } from "react";
import { computeFoldRanges } from "./CodeViewer";

/**
 * Encapsulates the read-only spec viewer's code-folding state. Fold ranges are
 * derived from `code`; `folded` holds the opener line indices currently
 * collapsed. Reset whenever `resetKey` changes so folds never carry over between
 * files.
 *
 * @param code Full spec source text (undefined when no spec is selected).
 * @param resetKey Identity of the selected spec — folds reset when it changes.
 */
export function useCodeFolding(code: string | undefined, resetKey: string) {
  const foldRanges = useMemo(() => (code ? computeFoldRanges(code) : []), [code]);
  const [folded, setFolded] = useState<Set<number>>(new Set());
  useEffect(() => {
    setFolded(new Set());
  }, [resetKey]);
  const toggleFold = useCallback((start: number) => {
    setFolded((prev) => {
      const next = new Set(prev);
      if (next.has(start)) next.delete(start);
      else next.add(start);
      return next;
    });
  }, []);
  const collapseAll = useCallback(() => {
    setFolded(new Set(foldRanges.map((r) => r.start)));
  }, [foldRanges]);
  const expandAll = useCallback(() => setFolded(new Set()), []);

  return { foldRanges, folded, toggleFold, collapseAll, expandAll };
}
